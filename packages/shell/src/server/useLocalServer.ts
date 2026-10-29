import { useState, useEffect, useCallback } from 'react';

/** Why the page is not being served: the port, or the saved work's move. */
export type LocalServerFailure = 'port' | 'migration';

export interface LocalServerState {
  url: string | null;
  ready: boolean;
  /** The page cannot be opened: the server could not take its port
   *  (StaticServerModule.swift `port`), or the install's saved work could
   *  not be brought to this port from the one earlier builds used
   *  (`adoptLegacyOrigin`). There is deliberately no other port to fall
   *  back to, and no opening the page without the saved work — a page on
   *  any other origin, or on this one too soon, opens an empty journal —
   *  so the shell shows this and offers {@link retry} instead of a page. */
  failed: boolean;
  failure: LocalServerFailure | null;
  /** The saved work is being copied to this port, and the wait is long
   *  enough to say so (a journal of any size takes seconds). */
  migrating: boolean;
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

// The saved work's move to this port, once per process: a remount must not
// start a second copy beside the first. Null until the server is up, and
// again after a failure, so retry starts it over.
let adoptionPromise: Promise<void> | null = null;

// How long the copy runs before the splash says what the wait is. The
// native call answers at once for an install with nothing to move, and
// the splash must not flash a message on every launch for that.
const MIGRATING_NOTICE_MS = 400;

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

function adoptLegacyOrigin(): Promise<void> {
  const { adoptLegacyOrigin: adopt } = require('../../modules/static-server/src/StaticServerModule');
  return adopt().then((result: { status: string; records?: number }) => {
    if (result.status === 'migrated') {
      console.log(`[useLocalServer] saved work moved to this port: ${result.records ?? 0} records`);
    }
  });
}

if (!__DEV__) serverPromise = startLocalServer();

/**
 * Returns the URL and readiness state of the local web server.
 *
 * In __DEV__ mode, points to the Metro dev server for hot reload.
 * In production, waits for the eagerly-started GCDWebServer, then for the
 * install's saved work to be on its origin (adoptLegacyOrigin) — the page
 * is ready only once both are.
 */
export function useLocalServer(): LocalServerState {
  const [state, setState] = useState<Omit<LocalServerState, 'retry'>>(() => {
    if (__DEV__) {
      return { url: getDevServerUrl(), ready: true, failed: false, failure: null, migrating: false };
    }
    return { url: null, ready: false, failed: false, failure: null, migrating: false };
  });
  // Bumped by retry, which re-runs the effect on a fresh start.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (__DEV__ || !serverPromise) return;

    let cancelled = false;
    let notice: ReturnType<typeof setTimeout> | null = null;
    serverPromise.then((url) => {
      if (cancelled) return;
      if (!adoptionPromise) adoptionPromise = adoptLegacyOrigin();
      notice = setTimeout(() => {
        if (!cancelled) setState((s) => ({ ...s, migrating: true }));
      }, MIGRATING_NOTICE_MS);
      return adoptionPromise.then(() => {
        if (notice) clearTimeout(notice);
        if (!cancelled) setState({ url, ready: true, failed: false, failure: null, migrating: false });
      }, (e) => {
        if (notice) clearTimeout(notice);
        console.error('Failed to move the saved work to this port:', e);
        adoptionPromise = null;
        if (!cancelled) setState({ url: null, ready: false, failed: true, failure: 'migration', migrating: false });
      });
    }).catch((e) => {
      console.error('Failed to start local server:', e);
      serverPromise = null;
      if (!cancelled) setState({ url: null, ready: false, failed: true, failure: 'port', migrating: false });
    });

    return () => {
      cancelled = true;
      if (notice) clearTimeout(notice);
    };
  }, [attempt]);

  const retry = useCallback(() => {
    if (__DEV__) return;
    // A failed start leaves nothing running, so this is a whole new try at
    // the same port; every shell mounted shares it. A server that is up
    // stays up, and only the copy is tried again.
    if (!serverPromise) serverPromise = startLocalServer();
    setState({ url: null, ready: false, failed: false, failure: null, migrating: false });
    setAttempt((n) => n + 1);
  }, []);

  return { ...state, retry };
}
