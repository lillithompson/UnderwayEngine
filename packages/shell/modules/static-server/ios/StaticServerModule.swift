import ExpoModulesCore
import GCDWebServer
import os
import UIKit
import WebKit

// COLD-START diag — Use os.Logger instead of NSLog. In iOS Release builds,
// third-party app NSLog output is fully redacted to <private> in unified
// logging, hiding even the format-string prefix. Logger with explicit
// privacy: .public marks the message body public so it surfaces in
// Console.app under search filters like `[server]`.
private let staticServerLog = Logger(subsystem: "com.underwaytech.eidol", category: "static-server")

public class StaticServerModule: Module {
  private var server: GCDWebServer?
  // Remembered so we can restart on foreground without JS re-passing it.
  private var documentRoot: String?
  private var foregroundObserver: NSObjectProtocol?
  private var backgroundObserver: NSObjectProtocol?
  // ONE fixed port, never a fallback. The port is part of the page's origin
  // (http://localhost:<port>), and the origin is the key to everything the
  // web side stores — IndexedDB, localStorage. A launch that came up on a
  // second port opened an EMPTY journal: pages made there were saved where
  // the next launch on the usual port never looks, and the editor, finding
  // nothing, wiped them from the native lists too (2026-10-06: a Facets page
  // drawn on 18731 vanished when the app came back on 18730). So a busy
  // port is retried, and when it stays busy the start FAILS and the shell
  // says so — an app that cannot open its journal must not open another.
  //
  // The loopback port is device-wide, so EVERY APP NAMES ITS OWN (Info.plist
  // `UnderwayStaticServerPort`; who holds which is the engine README's
  // "Loopback ports"). Two apps on one port can never both be up: a
  // backgrounded Mmoment kept 18730 and DrawBots could not open
  // (2026-10-09), and with Tileodile and Mmoment both on screen (iPad
  // multitasking) the second to start failed outright (2026-10-28). The
  // default is Tileodile's, the port the first app on this shell shipped
  // with, and it is kept for that app only.
  //
  // Changing a shipped app's port strands its installs' data on the old
  // origin, exactly as a fallback would — unless the app also names the
  // port it is leaving (`legacyPort`), in which case the first start on the
  // new port copies the saved work across before any page loads.
  //
  // The server still lets go of its port in the background and takes it
  // back on foreground (`handleBackgroundTransition`): the socket does not
  // reliably survive suspension anyway, and a port nobody holds while
  // suspended is one fewer way for two apps to collide.
  private let port: UInt = {
    if let n = Bundle.main.object(forInfoDictionaryKey: "UnderwayStaticServerPort") as? NSNumber, n.uintValue > 0 {
      return n.uintValue
    }
    return 18730
  }()
  // The port this app's EARLIER builds bound (Info.plist
  // `UnderwayStaticServerLegacyPort`), whose origin may hold an install's
  // saved work. Set when an app moves off a port it has shipped on; nil for
  // an app that never moved. See `adoptLegacyOrigin`.
  private let legacyPort: UInt? = {
    if let n = Bundle.main.object(forInfoDictionaryKey: "UnderwayStaticServerLegacyPort") as? NSNumber, n.uintValue > 0 {
      return n.uintValue
    }
    return nil
  }()
  // The copy in flight, if any — held so its hidden WKWebView lives until it
  // reports. Main thread only.
  private var originMigration: OriginMigrationRun?
  // How long a busy port is retried before the start gives up: a listener
  // that is going away (a restart's old socket, a dying instance) lets go
  // well inside this.
  private let bindAttempts = 15
  private let bindRetryDelay: TimeInterval = 0.2
  // Every start/stop runs here, one at a time: the foreground restart and
  // a JS startServer must never interleave on `server`.
  private let serverQueue = DispatchQueue(label: "underway.static-server")

  // iOS defaults URLCache.shared to ~20 MB disk, shared across the WebView,
  // system networking, and every other URLSession. That's too small to keep
  // dynamic-sample thumbnails resident across cold launches — eviction shows
  // up as black thumbnail cards on app relaunch. Replace it with a 100 MB
  // disk / 16 MB memory cache at module-registration time so the WebView's
  // first fetches already see the larger budget. Static-let one-shot fires
  // exactly once per process.
  private static let urlCacheConfigured: Void = {
    URLCache.shared = URLCache(
      memoryCapacity: 16 * 1024 * 1024,
      diskCapacity:  100 * 1024 * 1024
    )
  }()

  public func definition() -> ModuleDefinition {
    Name("StaticServer")

    OnCreate {
      _ = Self.urlCacheConfigured
      // Foreground-restart: GCDWebServer's loopback socket does not survive
      // long iOS background suspension. iOS can close the socket out from
      // under the process while leaving GCDWebServer's internal `_options`
      // (and therefore `isRunning`) stale, so the next chunk fetch from
      // WKWebView gets connection-refused (-1004) before any of our request
      // logging fires. Rebind on every foreground transition; the cost is
      // ~130 ms off the main thread and the user will not notice.
      self.foregroundObserver = NotificationCenter.default.addObserver(
        forName: UIApplication.willEnterForegroundNotification,
        object: nil,
        queue: nil
      ) { [weak self] _ in
        self?.handleForegroundTransition()
      }
      self.backgroundObserver = NotificationCenter.default.addObserver(
        forName: UIApplication.didEnterBackgroundNotification,
        object: nil,
        queue: nil
      ) { [weak self] _ in
        self?.handleBackgroundTransition()
      }
    }

    OnDestroy {
      if let observer = self.foregroundObserver {
        NotificationCenter.default.removeObserver(observer)
        self.foregroundObserver = nil
      }
      if let observer = self.backgroundObserver {
        NotificationCenter.default.removeObserver(observer)
        self.backgroundObserver = nil
      }
    }

    AsyncFunction("startServer") { (documentRoot: String) -> String in
      return try self.serverQueue.sync {
        try self.startServerInternal(documentRoot: documentRoot)
      }
    }

    AsyncFunction("stopServer") { () -> Void in
      self.serverQueue.sync {
        self.server?.stop()
        self.server = nil
      }
    }

    // Bring an install's saved work from `legacyPort`'s origin to `port`'s,
    // once. The shell calls this after startServer and before it loads the
    // page: a page that opened on the new origin first would find an empty
    // journal, and the editor, finding nothing, wipes the native lists too.
    // Resolves `{ status }` — "none" (no legacy port), "done" (copied on an
    // earlier launch), "fresh" (nothing was ever stored on this install),
    // "migrated" (copied now, with its counts) — and rejects when the copy
    // could not be completed, in which case nothing is marked and the next
    // call starts it over.
    AsyncFunction("adoptLegacyOrigin") { (promise: Promise) in
      DispatchQueue.main.async {
        self.adoptLegacyOrigin(promise)
      }
    }

    Function("getPort") { () -> Int in
      return Int(self.server?.port ?? 0)
    }

    // Return the path to web-bundle/ inside the app's main bundle, or nil if not found.
    Function("getWebBundlePath") { () -> String? in
      return Bundle.main.path(forResource: "web-bundle", ofType: nil)
    }

    // Return the Metro packager host from RCTBundleURLProvider (available in dev builds).
    Function("getPackagerHost") { () -> String? in
      #if DEBUG
      guard let providerClass = NSClassFromString("RCTBundleURLProvider") as? NSObject.Type,
            let provider = providerClass.perform(NSSelectorFromString("sharedSettings"))?.takeUnretainedValue() as? NSObject,
            let host = provider.perform(NSSelectorFromString("packagerServerHost"))?.takeUnretainedValue() as? String else {
        return nil
      }
      return host
      #else
      return nil
      #endif
    }
  }

  // Release the port while backgrounded so another app on this shell can
  // bind it (see `port`). `documentRoot` is kept, so the foreground
  // restart below brings the same server back on the same port. A
  // background task holds off suspension until the socket is closed.
  private func handleBackgroundTransition() {
    // Posted on main; `task` is only ever touched there, and ended once.
    var task: UIBackgroundTaskIdentifier = .invalid
    let endTask = {
      guard task != .invalid else { return }
      UIApplication.shared.endBackgroundTask(task)
      task = .invalid
    }
    task = UIApplication.shared.beginBackgroundTask(withName: "static-server-release", expirationHandler: endTask)
    serverQueue.async { [weak self] in
      defer { DispatchQueue.main.async(execute: endTask) }
      guard let self = self, let server = self.server else { return }
      staticServerLog.log("[server] background transition — releasing port \(self.port, privacy: .public)")
      server.stop()
      self.server = nil
    }
  }

  private func handleForegroundTransition() {
    // Always rebind on foreground. `isRunning` cannot be trusted here: it
    // tracks GCDWebServer's own start/stop calls, not the actual liveness
    // of the kernel-owned listening socket.
    serverQueue.async { [weak self] in
      guard let self = self else { return }
      guard let documentRoot = self.documentRoot else {
        // Server was never started by JS — nothing to do.
        return
      }
      staticServerLog.log("[server] foreground transition — restarting socket")
      self.server?.stop()
      self.server = nil
      do {
        _ = try self.startServerInternal(documentRoot: documentRoot)
      } catch {
        staticServerLog.error("[server] foreground restart failed: \(String(describing: error), privacy: .public)")
      }
    }
  }

  private func adoptLegacyOrigin(_ promise: Promise) {
    guard let legacy = self.legacyPort, legacy != self.port else {
      promise.resolve(["status": "none"])
      return
    }
    let flagKey = "UnderwayStaticServer.adopted.\(legacy).\(self.port)"
    if UserDefaults.standard.bool(forKey: flagKey) {
      promise.resolve(["status": "done"])
      return
    }
    if self.originMigration != nil {
      promise.reject("E_MIGRATION_RUNNING", "an origin migration is already running")
      return
    }
    // The importer page is served by this server, on the new origin.
    let serving = self.serverQueue.sync { self.server?.isRunning ?? false }
    guard serving else {
      promise.reject("E_SERVER_DOWN", "the static server is not running")
      return
    }
    // A fresh install has nothing to bring: no record for localhost in the
    // data store the app's WKWebView uses (react-native-webview's default).
    // The record names the host only, never the port, which is why the
    // copy itself must still verify the origin it was given.
    let types: Set<String> = [WKWebsiteDataTypeIndexedDBDatabases, WKWebsiteDataTypeLocalStorage]
    WKWebsiteDataStore.default().fetchDataRecords(ofTypes: types) { records in
      let stored = records.contains { $0.displayName == "localhost" }
      guard stored else {
        staticServerLog.log("[server] origin migration: nothing stored on this install — marking \(legacy, privacy: .public) → \(self.port, privacy: .public) done")
        UserDefaults.standard.set(true, forKey: flagKey)
        promise.resolve(["status": "fresh"])
        return
      }
      staticServerLog.log("[server] origin migration: copying localhost:\(legacy, privacy: .public) → localhost:\(self.port, privacy: .public)")
      let run = OriginMigrationRun(legacyPort: legacy, port: self.port) { [weak self] result in
        self?.originMigration = nil
        switch result {
        case .success(let totals):
          staticServerLog.log("[server] origin migration: done — \(totals.databases, privacy: .public) databases, \(totals.records, privacy: .public) records, \(totals.localStorage, privacy: .public) localStorage entries")
          UserDefaults.standard.set(true, forKey: flagKey)
          promise.resolve([
            "status": "migrated",
            "databases": totals.databases,
            "records": totals.records,
            "localStorage": totals.localStorage,
          ])
        case .failure(let error):
          staticServerLog.error("[server] origin migration failed: \(String(describing: error), privacy: .public)")
          promise.reject("E_MIGRATION_FAILED", String(describing: error))
        }
      }
      self.originMigration = run
      run.start()
    }
  }

  private func startServerInternal(documentRoot: String) throws -> String {
    if let existing = self.server, existing.isRunning {
      return existing.serverURL!.absoluteString
    }

    self.documentRoot = documentRoot

    let server = GCDWebServer()
    // Custom GET handler. Two reasons we don't use the built-in
    // addGETHandler(forBasePath:…) convenience:
    //   1. cacheAge: 0 — the web bundle lives on-disk in the app, so there is
    //      no bandwidth cost to re-serving it. A non-zero cacheAge made
    //      WKWebView keep old JS/HTML across app reinstalls, because the
    //      origin is a stable fixed-port localhost URL (see `port`
    //      above, which we keep fixed for IndexedDB persistence) and
    //      WKWebView's HTTP cache survives between launches keyed on that
    //      origin.
    //   2. gzip — GCDWebServer's gzipContentEncodingEnabled is per-response,
    //      not enabled by addGETHandler. We turn it on for textual content
    //      so the entry/common JS chunks transfer 3–5x smaller.
    let textualSuffixes = [".html", ".js", ".css", ".json", ".svg", ".txt", ".map"]
    let normalizedRoot = (documentRoot as NSString).standardizingPath
    server.addHandler(
      forMethod: "GET",
      pathRegex: ".*",
      request: GCDWebServerRequest.self
    ) { request -> GCDWebServerResponse? in
      // COLD-START diag — log every request so we can see, on the next
      // AsyncRequireError repro, whether the failing chunk request actually
      // reached the server.
      let start = CFAbsoluteTimeGetCurrent()
      var relativePath = request.path
      if relativePath == "/" || relativePath.isEmpty {
        relativePath = "/index.html"
      }
      if relativePath.hasPrefix("/") {
        relativePath.removeFirst()
      }
      let filePath = (normalizedRoot as NSString).appendingPathComponent(relativePath)
      let normalizedPath = (filePath as NSString).standardizingPath
      guard normalizedPath == normalizedRoot
        || normalizedPath.hasPrefix(normalizedRoot + "/") else {
        let durMs = (CFAbsoluteTimeGetCurrent() - start) * 1000
        staticServerLog.log("[server] \(request.method, privacy: .public) \(request.path, privacy: .public) → 403 0b \(durMs, format: .fixed(precision: 1), privacy: .public)ms")
        return GCDWebServerResponse(statusCode: 403)
      }
      var isDir: ObjCBool = false
      guard FileManager.default.fileExists(atPath: normalizedPath, isDirectory: &isDir),
            !isDir.boolValue,
            let response = GCDWebServerFileResponse(file: normalizedPath) else {
        let durMs = (CFAbsoluteTimeGetCurrent() - start) * 1000
        staticServerLog.log("[server] \(request.method, privacy: .public) \(request.path, privacy: .public) → 404 0b \(durMs, format: .fixed(precision: 1), privacy: .public)ms")
        return GCDWebServerResponse(statusCode: 404)
      }
      response.cacheControlMaxAge = 0
      let lower = normalizedPath.lowercased()
      if textualSuffixes.contains(where: { lower.hasSuffix($0) }) {
        response.isGZipContentEncodingEnabled = true
      }
      // COLD-START diag — log success too. File size (uncompressed) is the
      // best easily-available proxy for transferred bytes; gzip means actual
      // wire bytes will be smaller, but the size still flags large files
      // (e.g. the 26 MB CompositionEditor) for cross-referencing with any
      // mid-stream failure.
      var sizeBytes: Int64 = -1
      if let attrs = try? FileManager.default.attributesOfItem(atPath: normalizedPath),
         let s = attrs[.size] as? NSNumber {
        sizeBytes = s.int64Value
      }
      let durMs = (CFAbsoluteTimeGetCurrent() - start) * 1000
      staticServerLog.log("[server] \(request.method, privacy: .public) \(request.path, privacy: .public) → 200 \(sizeBytes, privacy: .public)b \(durMs, format: .fixed(precision: 1), privacy: .public)ms")
      return response
    }

    // The copy's importer page, on this origin (`adoptLegacyOrigin`): the
    // top-level document that writes the saved work where this app's own
    // page will read it. Added after the catch-all, which GCDWebServer
    // therefore consults second.
    if self.legacyPort != nil {
      let port = self.port
      server.addHandler(forMethod: "GET", path: OriginMigrationRun.importerPath, request: GCDWebServerRequest.self) { _ -> GCDWebServerResponse? in
        let response = GCDWebServerDataResponse(html: OriginMigrationRun.importerPage(port: port))
        response?.cacheControlMaxAge = 0
        return response
      }
    }

    // The one port, retried while it is busy — never another (see `port`).
    var lastError: Error?
    for attempt in 1...self.bindAttempts {
      do {
        try server.start(options: [
          GCDWebServerOption_Port: self.port,
          GCDWebServerOption_BindToLocalhost: true,
          GCDWebServerOption_AutomaticallySuspendInBackground: false,
        ])
        self.server = server
        // COLD-START diag — pin the moment the loopback socket is bound.
        staticServerLog.log("[server] listening on port \(server.port, privacy: .public) (attempt \(attempt, privacy: .public))")
        return server.serverURL!.absoluteString
      } catch {
        server.stop()
        lastError = error
        if attempt < self.bindAttempts { Thread.sleep(forTimeInterval: self.bindRetryDelay) }
      }
    }
    staticServerLog.error("[server] port \(self.port, privacy: .public) unavailable after \(self.bindAttempts, privacy: .public) attempts: \(String(describing: lastError), privacy: .public)")
    throw StaticServerPortUnavailable(port: self.port)
  }
}

/// The start's failure when the app's port stays busy. The message reaches
/// JS as the rejection's text; useLocalServer turns it into the shell's
/// "can't open" panel rather than a page on some other origin.
struct StaticServerPortUnavailable: Error, CustomStringConvertible {
  let port: UInt
  var description: String { "static server port \(port) is in use" }
}

/// One copy of an install's saved work from the origin of `legacyPort` to the
/// origin of `port` (StaticServerModule `adoptLegacyOrigin`). The work is the
/// embedded script's (OriginMigrationScript.swift, from
/// web/originMigration.js); this runs its two pages one after the other, each
/// as the TOP document of one hidden WKWebView:
///
///  - the EXPORTER, given the OLD origin through `loadHTMLString(_:baseURL:)`
///    — WebKit grants a document the origin of its base URL, so the page
///    reads the old origin's IndexedDB and localStorage and no server need
///    listen on the old port, which another app may well hold (the reason
///    for the move). It posts every message here, and each is spooled to a
///    file under the temporary directory before its post is answered, so
///    the page holds one message in flight and the process holds none;
///  - the IMPORTER, served by this app's server on the NEW origin
///    (`importerPath`) and loaded into the same web view once the exporter
///    has said `exported`. It asks for the spool one message at a time
///    (`next`, answered with the message or `end`), writes, counts what is
///    now on its own origin against what the exporter read, and says `done`
///    with the totals or `error`.
///
/// Both are top-level documents, and the script refuses to run as anything
/// else. The importer used to be an IFRAME in the exporter's page: WebKit
/// keys a cross-origin frame's storage by (top origin, frame origin) and
/// keeps that partition in memory, so the frame's writes went nowhere the
/// app's own page would read while its counts agreed and the install was
/// marked done over an empty journal (2026-10-29). The messages are plain
/// JSON — WKScriptMessageHandlerWithReply carries nothing else — and the
/// script encodes bytes, dates and the rest itself.
///
/// The caller marks the install migrated only on `done`; a failure, a dead
/// content process or a silence longer than `idleTimeout` leaves it
/// unmarked for the next launch to try again. The spool is removed either
/// way, and the old origin's data is never deleted.
final class OriginMigrationRun: NSObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
  struct Totals {
    let databases: Int
    let records: Int
    let localStorage: Int
  }

  static let importerPath = "/__underway/origin-migration"
  static let handlerName = "underwayOriginMigration"
  static let idleTimeout: TimeInterval = 120

  private enum Phase: String {
    case exporting
    case importing
  }

  private let legacyPort: UInt
  private let port: UInt
  private let completion: (Result<Totals, Error>) -> Void
  private let spoolDirectory: URL
  private var webView: WKWebView?
  private var watchdog: DispatchWorkItem?
  private var finished = false
  private var phase: Phase = .exporting
  /// Messages the exporter has handed over, each in its own file.
  private var spooled = 0
  /// …and how many of them the importer has taken back.
  private var delivered = 0

  init(legacyPort: UInt, port: UInt, completion: @escaping (Result<Totals, Error>) -> Void) {
    self.legacyPort = legacyPort
    self.port = port
    self.completion = completion
    self.spoolDirectory = FileManager.default.temporaryDirectory
      .appendingPathComponent("underway-origin-migration-\(UUID().uuidString)", isDirectory: true)
  }

  /// Main thread.
  func start() {
    do {
      try FileManager.default.createDirectory(at: spoolDirectory, withIntermediateDirectories: true)
    } catch {
      finish(.failure(error))
      return
    }
    let configuration = WKWebViewConfiguration()
    // The default data store: the one react-native-webview gives the app's
    // page, so this reads and writes the same origins it does.
    configuration.websiteDataStore = WKWebsiteDataStore.default()
    configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: Self.handlerName)
    let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 1, height: 1), configuration: configuration)
    webView.navigationDelegate = self
    // In a window, behind everything: a view WebKit considers invisible
    // may not load at all.
    if let window = Self.keyWindow() {
      window.insertSubview(webView, at: 0)
    }
    self.webView = webView
    armWatchdog()
    webView.loadHTMLString(Self.exporterPage(legacyPort: legacyPort), baseURL: URL(string: "http://localhost:\(legacyPort)/"))
  }

  private static func keyWindow() -> UIWindow? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let windows = scenes.flatMap { $0.windows }
    return windows.first { $0.isKeyWindow } ?? windows.first
  }

  private func armWatchdog() {
    watchdog?.cancel()
    let item = DispatchWorkItem { [weak self] in
      self?.finish(.failure(OriginMigrationError.timedOut(Self.idleTimeout)))
    }
    watchdog = item
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.idleTimeout, execute: item)
  }

  private func finish(_ result: Result<Totals, Error>) {
    guard !finished else { return }
    finished = true
    watchdog?.cancel()
    watchdog = nil
    if let webView = webView {
      webView.configuration.userContentController.removeScriptMessageHandler(forName: Self.handlerName, contentWorld: .page)
      webView.navigationDelegate = nil
      webView.stopLoading()
      webView.removeFromSuperview()
    }
    webView = nil
    try? FileManager.default.removeItem(at: spoolDirectory)
    completion(result)
  }

  // MARK: The spool

  private func spoolURL(_ index: Int) -> URL {
    return spoolDirectory.appendingPathComponent("\(index).json")
  }

  private func spool(_ body: [String: Any]) throws {
    let data = try JSONSerialization.data(withJSONObject: body)
    try data.write(to: spoolURL(spooled), options: .atomic)
    spooled += 1
  }

  private func unspool(_ index: Int) throws -> Any {
    let data = try Data(contentsOf: spoolURL(index))
    return try JSONSerialization.jsonObject(with: data)
  }

  // MARK: WKScriptMessageHandlerWithReply

  func userContentController(
    _ userContentController: WKUserContentController,
    didReceive message: WKScriptMessage,
    replyHandler: @escaping (Any?, String?) -> Void
  ) {
    guard let body = message.body as? [String: Any], let type = body["type"] as? String else {
      replyHandler(nil, "not a migration message")
      return
    }
    guard !finished else {
      replyHandler(nil, "the migration has finished")
      return
    }
    // Every message is progress of a kind: the watchdog measures silence.
    armWatchdog()
    switch (phase, type) {
    case (_, "error"):
      replyHandler(nil, nil)
      finish(.failure(OriginMigrationError.page(body["message"] as? String ?? "unknown")))
    case (.exporting, "progress"):
      if let records = body["records"] as? Int {
        staticServerLog.log("[server] origin migration: \(records, privacy: .public) records read so far")
      }
      replyHandler(nil, nil)
    case (.exporting, "database"), (.exporting, "records"), (.exporting, "localStorage"), (.exporting, "finish"):
      do {
        try spool(body)
        replyHandler(nil, nil)
      } catch {
        replyHandler(nil, String(describing: error))
        finish(.failure(error))
      }
    case (.exporting, "exported"):
      staticServerLog.log("[server] origin migration: read \(body["records"] as? Int ?? 0, privacy: .public) records on localhost:\(self.legacyPort, privacy: .public); writing them on localhost:\(self.port, privacy: .public)")
      phase = .importing
      replyHandler(nil, nil)
      guard let url = URL(string: "http://localhost:\(port)\(Self.importerPath)") else {
        finish(.failure(OriginMigrationError.page("bad importer URL")))
        return
      }
      webView?.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
    case (.importing, "next"):
      guard delivered < spooled else {
        replyHandler(["type": "end"], nil)
        return
      }
      do {
        let next = try unspool(delivered)
        delivered += 1
        replyHandler(next, nil)
      } catch {
        replyHandler(nil, String(describing: error))
        finish(.failure(error))
      }
    case (.importing, "done"):
      replyHandler(nil, nil)
      finish(.success(Totals(
        databases: body["databases"] as? Int ?? 0,
        records: body["records"] as? Int ?? 0,
        localStorage: body["localStorage"] as? Int ?? 0
      )))
    default:
      replyHandler(nil, "unexpected \(type) while \(phase.rawValue)")
      finish(.failure(OriginMigrationError.page("unexpected message \(type) while \(phase.rawValue)")))
    }
  }

  // MARK: WKNavigationDelegate

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    finish(.failure(error))
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    finish(.failure(error))
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    finish(.failure(OriginMigrationError.contentProcessTerminated))
  }

  // MARK: The pages

  private static func page(bootstrap: String) -> String {
    return "<!doctype html><html><head><meta charset=\"utf-8\"><title>Underway origin migration</title></head><body><script>\n"
      + originMigrationScript
      + "\n</script><script>\n"
      + bootstrap
      + "\n</script></body></html>"
  }

  /// `post(message)` returns the handler's reply as a promise
  /// (WKScriptMessageHandlerWithReply): the spool's acknowledgement for the
  /// exporter, the next spooled message for the importer.
  private static let postFunction = "function (message) { return window.webkit.messageHandlers.\(handlerName).postMessage(message); }"

  static func exporterPage(legacyPort: UInt) -> String {
    let bootstrap = "UnderwayOriginMigration.runExporterInPage({"
      + " expectedOrigin: \"http://localhost:\(legacyPort)\","
      + " post: \(postFunction)"
      + " });"
    return page(bootstrap: bootstrap)
  }

  static func importerPage(port: UInt) -> String {
    let bootstrap = "UnderwayOriginMigration.runImporterInPage({"
      + " expectedOrigin: \"http://localhost:\(port)\","
      + " post: \(postFunction)"
      + " });"
    return page(bootstrap: bootstrap)
  }
}

enum OriginMigrationError: Error, CustomStringConvertible {
  case page(String)
  case timedOut(TimeInterval)
  case contentProcessTerminated

  var description: String {
    switch self {
    case .page(let message): return "origin migration: \(message)"
    case .timedOut(let seconds): return "origin migration: no progress for \(Int(seconds)) s"
    case .contentProcessTerminated: return "origin migration: the content process was terminated"
    }
  }
}
