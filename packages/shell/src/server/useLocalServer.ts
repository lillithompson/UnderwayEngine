import { useState, useEffect, useCallback } from 'react';

export interface LocalServerState {
  url: string | null;
  ready: boolean;
  /** The server could not take its port (StaticServerModule.swift `port`).
   *  There is deliberately no other port to fall back to — a page on any
   *  other origin opens an empty journal — so the shell shows this and
   *  offers {@link retry} instead of a page. */
  failed: boolean;
  /** Start again after {@link failed}. */
  retry: () => void;
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

function startLocalServer(): Promise<string> | null {
  try {
    const { startServer, getWebBundlePath } = require('../../modules/static-server/src/StaticServerModule');
    const docRoot = getWebBundlePath();
    return docRoot ? startServer(docRoot) : null;
  } catch (e) {
    console.error('Failed to eagerly start local server:', e);
    return null;
  }
}

if (!__DEV__) serverPromise = startLocalServer();

/**
 * Returns the URL and readiness state of the local web server.
 *
 * In __DEV__ mode, points to the Metro dev server for hot reload.
 * In production, waits for the eagerly-started GCDWebServer.
 */
export function useLocalServer(): LocalServerState {
  const [state, setState] = useState<{ url: string | null; ready: boolean; failed: boolean }>(() => {
    if (__DEV__) {
      return { url: getDevServerUrl(), ready: true, failed: false };
    }
    return { url: null, ready: false, failed: false };
  });
  // Bumped by retry, which re-runs the effect on a fresh start.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (__DEV__ || !serverPromise) return;

    let cancelled = false;
    serverPromise.then((url) => {
      if (!cancelled) {
        setState({ url, ready: true, failed: false });
      }
    }).catch((e) => {
      console.error('Failed to start local server:', e);
      if (!cancelled) setState({ url: null, ready: false, failed: true });
    });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    if (__DEV__) return;
    // A failed start leaves nothing running, so this is a whole new try at
    // the same port; every shell mounted shares it.
    serverPromise = startLocalServer();
    setState({ url: null, ready: false, failed: false });
    setAttempt((n) => n + 1);
  }, []);

  return { ...state, retry };
}
