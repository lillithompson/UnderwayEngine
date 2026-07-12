import { useState, useEffect } from 'react';

export interface LocalServerState {
  url: string | null;
  ready: boolean;
}

/**
 * Get the Metro dev server URL using the Mac's real LAN IP.
 *
 * On a physical device connected via USB, `localhost` goes through a USB tunnel
 * for the RN bridge but NOT for WKWebView. We need the actual IP.
 * RCTBundleURLProvider on the native side knows the real packager host.
 */
function getDevServerUrl(): string {
  try {
    const { getPackagerHost } = require('../../modules/static-server/src/StaticServerModule');
    const host = getPackagerHost();
    if (host) {
      // host may include port (e.g. "192.168.1.5:8081") or just IP
      if (host.includes(':')) return `http://${host}`;
      return `http://${host}:8081`;
    }
  } catch {}

  // Fallback: try extracting from the JS bundle source URL
  try {
    const { NativeModules } = require('react-native');
    const scriptURL: string | undefined = NativeModules.SourceCode?.scriptURL;
    if (scriptURL) {
      const match = scriptURL.match(/^(https?:\/\/[^/]+)/);
      if (match) return match[1];
    }
  } catch {}

  return 'http://localhost:8081';
}

// Start the production server eagerly at module-load time so it runs in
// parallel with React Native's component tree setup, rather than waiting
// for useEffect after mount.
let serverPromise: Promise<string> | null = null;
// COLD-START diag — pin the moment serverPromise resolves on the JS side.
// Cross-reference with native NSLog "[server] listening on port …" to see
// the kernel-bind → JS-resolve gap and the resolve → first-request gap.
let serverStartTimeMs = 0;

if (!__DEV__) {
  try {
    const { startServer, getWebBundlePath } = require('../../modules/static-server/src/StaticServerModule');
    const docRoot = getWebBundlePath();
    if (docRoot) {
      serverStartTimeMs = Date.now();
      serverPromise = startServer(docRoot);
    }
  } catch (e) {
    console.error('Failed to eagerly start local server:', e);
  }
}

/**
 * Returns the URL and readiness state of the local web server.
 *
 * In __DEV__ mode, points to the Metro dev server for hot reload.
 * In production, waits for the eagerly-started GCDWebServer.
 */
export function useLocalServer(): LocalServerState {
  const [state, setState] = useState<LocalServerState>(() => {
    if (__DEV__) {
      return { url: getDevServerUrl(), ready: true };
    }
    return { url: null, ready: false };
  });

  useEffect(() => {
    if (__DEV__ || !serverPromise) return;

    let cancelled = false;
    serverPromise.then((url) => {
      // COLD-START diag — record when the server URL became known to the JS
      // tree. import() is dynamic to avoid pulling ring.ts into the eager
      // module-load path of the native shell.
      const elapsed = Date.now() - serverStartTimeMs;
      void import('@/engine/debug/ring').then(m =>
        m.mark('server.resolved', { url, elapsedMs: elapsed }),
      ).catch(() => {});
      if (!cancelled) {
        setState({ url, ready: true });
      }
    }).catch((e) => {
      console.error('Failed to start local server:', e);
      void import('@/engine/debug/ring').then(m =>
        m.mark('server.rejected', { err: String((e as Error)?.message ?? e) }),
      ).catch(() => {});
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
