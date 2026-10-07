import { readFileSync } from 'fs';
import { join } from 'path';

// The local server's port is part of the page's origin, and the origin is
// the key to everything the web side stores. A launch on a second port
// opened an empty journal and lost a page (StaticServerModule.swift `port`).
// Swift and react-native can't run here, so these read the source, as
// webViewShellRecoveryEvent.test.ts does.

const SWIFT = readFileSync(join(__dirname, '..', '..', '..', 'modules', 'static-server', 'ios', 'StaticServerModule.swift'), 'utf8');
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

  it('serializes the foreground restart with JS starts', () => {
    expect(SWIFT).toContain('try self.serverQueue.sync {');
    expect(SWIFT).toContain('serverQueue.async { [weak self] in');
  });

  it('turns a failed start into the shell\'s retry panel, not a page', () => {
    expect(HOOK).toContain('if (!cancelled) setState({ url: null, ready: false, failed: true });');
    expect(HOOK).toContain('serverPromise = startLocalServer();');
    expect(SHELL).toContain('const { url, ready, failed: serverFailed, retry: retryServer } = useLocalServer();');
    expect(SHELL).toContain('<TouchableOpacity onPress={retryServer} style={styles.retryButton}>');
  });
});
