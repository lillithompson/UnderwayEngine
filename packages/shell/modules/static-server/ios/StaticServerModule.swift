import ExpoModulesCore
import GCDWebServer
import os
import UIKit

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
  // Fixed port keeps the origin stable across launches so IndexedDB data persists.
  private let preferredPorts: [UInt] = [18730, 18731, 18732]

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
    }

    OnDestroy {
      if let observer = self.foregroundObserver {
        NotificationCenter.default.removeObserver(observer)
        self.foregroundObserver = nil
      }
    }

    AsyncFunction("startServer") { (documentRoot: String) -> String in
      return try self.startServerInternal(documentRoot: documentRoot)
    }

    AsyncFunction("stopServer") { () -> Void in
      self.server?.stop()
      self.server = nil
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

  private func handleForegroundTransition() {
    guard let documentRoot = self.documentRoot else {
      // Server was never started by JS — nothing to do.
      return
    }
    // Always rebind on foreground. `isRunning` cannot be trusted here: it
    // tracks GCDWebServer's own start/stop calls, not the actual liveness
    // of the kernel-owned listening socket.
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      guard let self = self else { return }
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
    //      origin is a stable fixed-port localhost URL (see preferredPorts
    //      below, which we keep fixed for IndexedDB persistence) and
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

    // Try preferred fixed ports first to keep a stable origin for IndexedDB persistence.
    for port in self.preferredPorts {
      do {
        try server.start(options: [
          GCDWebServerOption_Port: port,
          GCDWebServerOption_BindToLocalhost: true,
          GCDWebServerOption_AutomaticallySuspendInBackground: false,
        ])
        self.server = server
        // COLD-START diag — pin the moment the loopback socket is bound.
        staticServerLog.log("[server] listening on port \(server.port, privacy: .public) (preferred)")
        return server.serverURL!.absoluteString
      } catch {
        server.stop()
      }
    }

    // Last resort: random port (app works but data won't persist across launches)
    try server.start(options: [
      GCDWebServerOption_Port: 0,
      GCDWebServerOption_BindToLocalhost: true,
      GCDWebServerOption_AutomaticallySuspendInBackground: false,
    ])

    self.server = server
    // COLD-START diag — random-port fallback also logs.
    staticServerLog.log("[server] listening on port \(server.port, privacy: .public) (random fallback)")
    return server.serverURL!.absoluteString
  }
}
