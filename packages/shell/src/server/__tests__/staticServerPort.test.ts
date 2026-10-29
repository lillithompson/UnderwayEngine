import { readFileSync } from 'fs';
import { join } from 'path';

// The local server's port is part of the page's origin, and the origin is
// the key to everything the web side stores. A launch on a second port
// opened an empty journal and lost a page (StaticServerModule.swift `port`).
// Swift and react-native can't run here, so these read the source, as
// webViewShellRecoveryEvent.test.ts does.

const MODULE = join(__dirname, '..', '..', '..', 'modules', 'static-server');
const SWIFT = readFileSync(join(MODULE, 'ios', 'StaticServerModule.swift'), 'utf8');
const EMBEDDED = readFileSync(join(MODULE, 'ios', 'OriginMigrationScript.swift'), 'utf8');
const SCRIPT = readFileSync(join(MODULE, 'web', 'originMigration.js'), 'utf8');
const WRAPPER = readFileSync(join(MODULE, 'src', 'StaticServerModule.ts'), 'utf8');
const HOOK = readFileSync(join(__dirname, '..', 'useLocalServer.ts'), 'utf8');
const SHELL = readFileSync(join(__dirname, '..', '..', 'components', 'WebViewShell.tsx'), 'utf8');

describe('static server port', () => {
  it('binds one port and never falls back to another', () => {
    expect(SWIFT).not.toMatch(/\[\s*18730\s*,/);
    expect(SWIFT).not.toContain('GCDWebServerOption_Port: 0');
    expect(SWIFT).not.toContain('preferredPorts');
    expect(SWIFT).toContain('GCDWebServerOption_Port: self.port,');
    expect(SWIFT).toContain('return 18730');
  });

  it('retries the busy port, then fails the start', () => {
    expect(SWIFT).toContain('for attempt in 1...self.bindAttempts {');
    expect(SWIFT).toContain('throw StaticServerPortUnavailable(port: self.port)');
  });

  it('lets an app name its own port', () => {
    expect(SWIFT).toContain('forInfoDictionaryKey: "UnderwayStaticServerPort"');
  });

  // Every app on this shell defaults to the same device-wide port; one that
  // held it while suspended locked the others out (Mmoment vs DrawBots).
  it('releases the port in the background and takes it back on foreground', () => {
    expect(SWIFT).toContain('forName: UIApplication.didEnterBackgroundNotification,');
    expect(SWIFT).toContain('self?.handleBackgroundTransition()');
    expect(SWIFT).toContain('forName: UIApplication.willEnterForegroundNotification,');
    expect(SWIFT).toContain('self?.handleForegroundTransition()');
    // Stopped on the same queue as every start, under a background task so
    // the app is not suspended with the socket still open.
    const release = SWIFT.slice(SWIFT.indexOf('private func handleBackgroundTransition()'), SWIFT.indexOf('private func handleForegroundTransition()'));
    expect(release).toContain('beginBackgroundTask(withName: "static-server-release"');
    expect(release).toContain('serverQueue.async { [weak self] in');
    expect(release).toContain('server.stop()');
    // documentRoot survives, or the foreground restart has nothing to serve.
    expect(release).not.toContain('documentRoot = nil');
  });

  it('serializes the foreground restart with JS starts', () => {
    expect(SWIFT).toContain('try self.serverQueue.sync {');
    expect(SWIFT).toContain('serverQueue.async { [weak self] in');
  });

  it('turns a failed start into the shell\'s retry panel, not a page', () => {
    expect(HOOK).toContain("if (!cancelled) setState({ url: null, ready: false, failed: true, failure: 'port', migrating: false });");
    expect(HOOK).toContain('if (!serverPromise) serverPromise = startLocalServer();');
    expect(SHELL).toContain('const { url, ready, failed: serverFailed, failure: serverFailure, migrating, retry: retryServer } = useLocalServer();');
    expect(SHELL).toContain('<TouchableOpacity onPress={retryServer} style={styles.retryButton}>');
  });
});

// An app that moves off a port it has shipped on names the port it is
// leaving, and the first start on the new port copies the install's saved
// work across — before the page loads, since a page that opened on the new
// origin first would find an empty journal and wipe the native lists too.
describe('the move to a new port brings the saved work along', () => {
  it('lets an app name the port its earlier builds used', () => {
    expect(SWIFT).toContain('forInfoDictionaryKey: "UnderwayStaticServerLegacyPort"');
    expect(SWIFT).toContain('private let legacyPort: UInt? = {');
  });

  it('copies through a hidden page GIVEN the old origin, so the old port need not be free', () => {
    expect(SWIFT).toContain('webView.loadHTMLString(Self.parentPage(legacyPort: legacyPort, port: port), baseURL: URL(string: "http://localhost:\\(legacyPort)/"))');
    // …into an iframe this server serves on the new origin.
    expect(SWIFT).toContain('static let childPath = "/__underway/origin-migration"');
    expect(SWIFT).toContain('server.addHandler(forMethod: "GET", path: OriginMigrationRun.childPath, request: GCDWebServerRequest.self)');
    // The same data store as the app's page, or it would copy between the
    // wrong origins.
    expect(SWIFT).toContain('configuration.websiteDataStore = WKWebsiteDataStore.default()');
  });

  it('marks the install done only on a verified copy, or when there was nothing to copy', () => {
    const adopt = SWIFT.slice(SWIFT.indexOf('private func adoptLegacyOrigin('), SWIFT.indexOf('private func startServerInternal('));
    expect(adopt.match(/UserDefaults\.standard\.set\(true, forKey: flagKey\)/g)).toHaveLength(2);
    // Nothing stored on the install (a fresh one): done without a copy.
    expect(adopt).toContain('let stored = records.contains { $0.displayName == "localhost" }');
    // Copied: done on the page's `done`, which the script sends only after
    // the counts on both sides agree. Any failure rejects, and marks nothing.
    expect(adopt).toContain('case .success(let totals):');
    expect(adopt).toContain('promise.reject("E_MIGRATION_FAILED", String(describing: error))');
    // The old origin's data is never deleted — a wrong copy must stay recoverable.
    expect(SWIFT).not.toContain('removeData(ofTypes');
  });

  it('gives up on silence and on a dead content process, never hangs', () => {
    expect(SWIFT).toContain('static let idleTimeout: TimeInterval = 120');
    expect(SWIFT).toContain('func webViewWebContentProcessDidTerminate(_ webView: WKWebView)');
    const handler = SWIFT.slice(SWIFT.indexOf('case "progress":'), SWIFT.indexOf('case "done":'));
    expect(handler).toContain('armWatchdog()');
  });

  it('ships the script inside the Swift module, verbatim', () => {
    // OriginMigrationScript.swift is generated from web/originMigration.js
    // by web/embed.js; an edit to the script without the regeneration is
    // the drift this catches.
    expect(EMBEDDED).toContain('let originMigrationScript = #' + '"""');
    expect(EMBEDDED).toContain(SCRIPT.trimEnd());
    expect(SCRIPT).not.toContain('"""' + '#');
    // Both pages run the embedded script, then their bootstrap.
    expect(SWIFT).toContain('+ originMigrationScript');
    expect(SWIFT).toContain('UnderwayOriginMigration.runParentInPage({');
    expect(SWIFT).toContain('UnderwayOriginMigration.runChildInPage({');
  });

  it('is the step between the server coming up and the page being ready', () => {
    expect(WRAPPER).toContain('export function adoptLegacyOrigin(): Promise<LegacyOriginAdoption>');
    const effect = HOOK.slice(HOOK.indexOf('serverPromise.then((url) => {'), HOOK.indexOf('}).catch((e) => {'));
    expect(effect).toContain('if (!adoptionPromise) adoptionPromise = adoptLegacyOrigin();');
    expect(effect).toContain('if (!cancelled) setState({ url, ready: true, failed: false, failure: null, migrating: false });');
    expect(effect.indexOf('adoptionPromise = adoptLegacyOrigin()')).toBeLessThan(effect.indexOf('ready: true'));
    // A failed copy is the retry panel, with its own words, and the next
    // try starts the copy over.
    expect(effect).toContain("failure: 'migration'");
    expect(effect).toContain('adoptionPromise = null;');
    expect(SHELL).toContain("serverFailure === 'migration'");
    // …and a long copy says so under the splash.
    expect(SHELL).toContain('Preparing your saved work…');
  });
});
