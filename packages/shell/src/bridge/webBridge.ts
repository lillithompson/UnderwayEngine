/**
 * Web-side bridge for communicating with the native shell.
 *
 * When running inside the native WebView, uses postMessage.
 * When running in a normal browser, falls back to standard web APIs.
 *
 * This file is imported by the web app code (engine/components/app).
 */

import type { NativeToWebMessage } from './protocol';

declare global {
  interface Window {
    __FACET_NATIVE_SHELL?: boolean;
    __facetBridgeHandler?: (msg: NativeToWebMessage) => void;
    ReactNativeWebView?: {
      postMessage(data: string): void;
    };
  }
}

/** Returns true if the app is running inside the native WebView shell. */
export function isInWebView(): boolean {
  return typeof window !== 'undefined' && window.__FACET_NATIVE_SHELL === true;
}

/** Send a message to the native shell. No-op if not in WebView. */
function postToNative(message: object): void {
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }
}

/**
 * Wait for a SHARE_RESULT message from native after posting a SHARE_FILE.
 * Mirrors the handler-swap pattern used by savePngToCameraRoll.
 */
function awaitShareResult(): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const prevHandler = window.__facetBridgeHandler;
    window.__facetBridgeHandler = (msg: NativeToWebMessage) => {
      if (msg.type === 'SHARE_RESULT') {
        window.__facetBridgeHandler = prevHandler;
        resolve(msg.payload);
      } else {
        if (prevHandler) prevHandler(msg);
      }
    };

    setTimeout(() => {
      if (window.__facetBridgeHandler !== prevHandler) {
        window.__facetBridgeHandler = prevHandler;
        resolve({ success: false, error: 'timeout' });
      }
    }, 30000);
  });
}

/**
 * Share/export a file. In WebView, sends to native for share sheet and waits
 * for the SHARE_RESULT round-trip so callers can surface failures.
 * In browser, triggers a download.
 */
export function shareFile(
  data: string,
  filename: string,
  mimeType: string,
  uti?: string,
): Promise<{ success: boolean; error?: string }> {
  if (isInWebView()) {
    const promise = awaitShareResult();
    postToNative({
      type: 'SHARE_FILE',
      payload: { data, filename, mimeType, uti },
    });
    return promise;
  }
  return (async () => {
    const isBase64 = (mimeType.startsWith('image/') && !mimeType.includes('svg')) || filename.endsWith('.png');
    let blob: Blob;
    if (isBase64) {
      const byteString = atob(data);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
      blob = new Blob([ab], { type: mimeType });
    } else {
      blob = new Blob([data], { type: mimeType });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return { success: true };
  })();
}

/**
 * Save an image to the camera roll. In WebView, sends to native for MediaLibrary save.
 * On mobile web, uses Web Share API to present the share sheet with "Save Image".
 * On desktop, triggers a file download.
 *
 * `mimeType` labels the Blob/File handed to the share sheet or download; it
 * defaults to PNG for the original callers. Pass the real type when the bytes
 * aren't PNG (e.g. 'image/jpeg') — a mislabelled File is what the share sheet
 * names and saves.
 */
export function savePngToCameraRoll(
  base64Data: string,
  filename: string,
  mimeType: string = 'image/png',
): Promise<{ success: boolean; error?: string }> {
  if (isInWebView()) {
    return new Promise((resolve) => {
      const prevHandler = window.__facetBridgeHandler;
      window.__facetBridgeHandler = (msg: NativeToWebMessage) => {
        if (msg.type === 'CAMERA_ROLL_RESULT') {
          window.__facetBridgeHandler = prevHandler;
          resolve(msg.payload);
        } else {
          if (prevHandler) prevHandler(msg);
        }
      };

      postToNative({
        type: 'SAVE_TO_CAMERA_ROLL',
        payload: { data: base64Data, filename },
      });

      setTimeout(() => {
        if (window.__facetBridgeHandler !== prevHandler) {
          window.__facetBridgeHandler = prevHandler;
          resolve({ success: false, error: 'timeout' });
        }
      }, 30000);
    });
  } else {
    return (async () => {
      const byteString = atob(base64Data);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
      const blob = new Blob([ab], { type: mimeType });

      if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
          && navigator.share && navigator.canShare) {
        const file = new File([blob], filename, { type: mimeType });
        if (navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file] });
            return { success: true };
          } catch {
            return { success: false, error: 'cancelled' };
          }
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      return { success: true };
    })();
  }
}

/**
 * Import a file. In WebView, asks native to open document picker.
 * In browser, opens a file input.
 * Returns a promise that resolves with the file content, or null if cancelled.
 */
export function importFile(accept: string): Promise<{ name: string; content: string } | null> {
  if (isInWebView()) {
    return new Promise((resolve) => {
      // Set up one-time listener for the FILE_IMPORTED response
      const prevHandler = window.__facetBridgeHandler;
      window.__facetBridgeHandler = (msg: NativeToWebMessage) => {
        if (msg.type === 'FILE_IMPORTED') {
          window.__facetBridgeHandler = prevHandler;
          resolve({ name: msg.payload.name, content: msg.payload.content });
        } else {
          // Pass through other messages
          if (prevHandler) prevHandler(msg);
        }
      };

      postToNative({
        type: 'IMPORT_FILE',
        payload: { accept },
      });

      // Timeout: if no response in 60s, restore handler and resolve null
      setTimeout(() => {
        if (window.__facetBridgeHandler !== prevHandler) {
          window.__facetBridgeHandler = prevHandler;
          resolve(null);
        }
      }, 60000);
    });
  } else {
    // Browser fallback: use file input
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) { resolve(null); return; }
        const content = await file.text();
        resolve({ name: file.name, content });
      };
      // Handle cancel (focus returns without change)
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  }
}

/**
 * Share/export a binary file. In WebView, base64-encodes and sends to native,
 * then awaits the SHARE_RESULT round-trip.
 * In browser, triggers a download from the raw Uint8Array.
 */
export function shareBinaryFile(
  data: Uint8Array,
  filename: string,
  mimeType: string,
  uti?: string,
): Promise<{ success: boolean; error?: string }> {
  if (isInWebView()) {
    const promise = awaitShareResult();
    let binary = '';
    for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
    const b64 = btoa(binary);
    postToNative({
      type: 'SHARE_FILE',
      payload: { data: b64, filename, mimeType, uti },
    });
    return promise;
  }
  return (async () => {
    const blob = new Blob([data as BlobPart], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return { success: true };
  })();
}

/**
 * Tagged result for importBinaryFile. `cancelled` keeps the silent-return
 * UX users expect from picker-cancel; `error` carries a stage breadcrumb so
 * the caller can surface a useful toast instead of swallowing failures.
 */
export type ImportBinaryFileResult =
  | { status: 'ok'; name: string; data: Uint8Array }
  | { status: 'error'; error: string; stage?: string }
  | { status: 'cancelled' };

/**
 * Import a binary file. In WebView, asks native for base64-encoded content.
 * In browser, reads the file as ArrayBuffer.
 */
export function importBinaryFile(accept: string): Promise<ImportBinaryFileResult> {
  if (isInWebView()) {
    return new Promise((resolve) => {
      const prevHandler = window.__facetBridgeHandler;
      const finish = (result: ImportBinaryFileResult) => {
        window.__facetBridgeHandler = prevHandler;
        resolve(result);
      };
      window.__facetBridgeHandler = (msg: NativeToWebMessage) => {
        if (msg.type === 'BINARY_FILE_IMPORTED') {
          // TEMP diagnostic — silent-import bug investigation.
          logToNative('log', 'importBinaryFile', `received OK, base64Length=${msg.payload.data.length}, name=${msg.payload.name}`);
          const b64 = msg.payload.data;
          const binary = atob(b64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          finish({ status: 'ok', name: msg.payload.name, data: bytes });
        } else if (msg.type === 'BINARY_FILE_IMPORT_FAILED') {
          logToNative('warn', 'importBinaryFile', `received FAIL stage=${msg.payload.stage} error=${msg.payload.error}`);
          finish({ status: 'error', error: msg.payload.error, stage: msg.payload.stage });
        } else {
          if (prevHandler) prevHandler(msg);
        }
      };

      postToNative({
        type: 'IMPORT_BINARY_FILE',
        payload: { accept },
      });

      // 60 s safety net. Native-side now sends explicit
      // BINARY_FILE_IMPORT_FAILED on every failure path, so this only
      // fires when the user cancels (no native message at all on cancel)
      // or takes a long time browsing photos. Treating it as cancel
      // matches the prior silent UX for both cases.
      setTimeout(() => {
        if (window.__facetBridgeHandler !== prevHandler) {
          finish({ status: 'cancelled' });
        }
      }, 60000);
    });
  } else {
    return new Promise((resolve) => {
      const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
      const extensions = accept.split(',').map(s => s.trim()).filter(s => s.startsWith('.')).map(s => s.toLowerCase());
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = isIOS ? 'application/octet-stream' : accept;
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) { resolve({ status: 'cancelled' }); return; }
        if (isIOS && extensions.length > 0) {
          const name = file.name.toLowerCase();
          if (!extensions.some(ext => name.endsWith(ext))) { resolve({ status: 'cancelled' }); return; }
        }
        const buffer = await file.arrayBuffer();
        resolve({ status: 'ok', name: file.name, data: new Uint8Array(buffer) });
      };
      input.addEventListener('cancel', () => resolve({ status: 'cancelled' }));
      input.click();
    });
  }
}

/**
 * Trigger a native haptic impact. No-op outside the WebView shell.
 */
export function triggerHaptic(style: 'light' | 'medium' | 'heavy' | 'selection'): void {
  if (isInWebView()) {
    postToNative({ type: 'HAPTIC_FEEDBACK', payload: { style } });
  }
}

/**
 * Play a short sound effect by id. In the WebView shell, routes to native via
 * the bridge (expo-audio). In a plain browser dev server, falls back to
 * HTMLAudioElement so dev sessions hear feedback too.
 */
export function playSoundEffect(sound: 'click' | 'longPress' | 'swipe', volume: number = 1): void {
  if (isInWebView()) {
    postToNative({ type: 'AUDIO_FEEDBACK', payload: { sound, volume } });
    return;
  }
  playSoundWeb(sound, volume);
}

// Cached HTMLAudioElement per sound id. Reused so each press is gesture-cheap
// and so we don't pay decode cost more than once.
const webAudioPlayers = new Map<string, HTMLAudioElement>();

function getWebSoundUrl(sound: string): string | null {
  // Metro returns either a string URL or an object with `uri` for static
  // assets on web — handle both shapes.
  let mod: unknown;
  try {
    switch (sound) {
      case 'click':
        mod = require('../assets/sounds/click.wav');
        break;
      case 'longPress':
        mod = require('../assets/sounds/longPress.wav');
        break;
      case 'swipe':
        mod = require('../assets/sounds/swipe.wav');
        break;
      default:
        return null;
    }
  } catch {
    return null;
  }
  if (typeof mod === 'string') return mod;
  if (mod && typeof (mod as { uri?: unknown }).uri === 'string') {
    return (mod as { uri: string }).uri;
  }
  return null;
}

function playSoundWeb(sound: string, volume: number): void {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return;
  try {
    let player = webAudioPlayers.get(sound);
    if (!player) {
      const url = getWebSoundUrl(sound);
      if (!url) {
        console.warn('[audio] web: no URL for sound', sound);
        return;
      }
      player = new Audio(url);
      webAudioPlayers.set(sound, player);
    }
    player.volume = Math.max(0, Math.min(1, volume));
    player.currentTime = 0;
    void player.play().catch((e) => {
      console.warn('[audio] web play() rejected:', e);
    });
  } catch (e) {
    console.warn('[audio] web play failed:', e);
  }
}

/**
 * Signal that the web app has finished loading.
 */
export function signalReady(): void {
  if (isInWebView()) {
    postToNative({ type: 'READY' });
  }
}

/**
 * Post an app-defined event to the native shell (APP_EVENT). The shell is
 * app-agnostic about `kind`/`data`; the native side handles them via
 * `setAppEventHandler` (nativeBridge). No-op outside the WebView.
 */
export function postAppEvent(kind: string, data?: unknown): void {
  if (isInWebView()) {
    postToNative({ type: 'APP_EVENT', payload: { kind, data } });
  }
}

/**
 * Forward a log line to the native side so it appears in the Xcode console.
 * No-op in non-WebView environments (browser's own console is already visible).
 */
export function logToNative(
  level: 'log' | 'warn' | 'error',
  tag: string,
  text: string,
): void {
  if (isInWebView()) {
    postToNative({ type: 'LOG', payload: { level, tag, text } });
  }
}

/** Register a handler for messages from native. */
export function onNativeMessage(handler: (msg: NativeToWebMessage) => void): () => void {
  const prev = window.__facetBridgeHandler;
  window.__facetBridgeHandler = (msg) => {
    handler(msg);
    if (prev) prev(msg);
  };
  return () => {
    window.__facetBridgeHandler = prev;
  };
}

/**
 * Apply safe area insets as CSS custom properties on the document root.
 * Call this when receiving SAFE_AREA_INSETS from native.
 */
export function applySafeAreaInsets(insets: { top: number; bottom: number; left: number; right: number }): void {
  const root = document.documentElement;
  root.style.setProperty('--sat', `${insets.top}px`);
  root.style.setProperty('--sab', `${insets.bottom}px`);
  root.style.setProperty('--sal', `${insets.left}px`);
  root.style.setProperty('--sar', `${insets.right}px`);
}

/**
 * Initialize the bridge: register native-message handlers, install the global
 * error/recovery handlers, and arm a fallback splash-dismiss timer. The app's
 * first screen is expected to call signalReady() itself within
 * a few hundred ms of mounting; the timer here is a safety net so the native
 * splash is never stuck if mounting/hydration/storage stalls.
 */
export function initBridge(): void {
  if (!isInWebView()) return;

  installGlobalErrorHandlers();

  onNativeMessage((msg) => {
    if (msg.type === 'SAFE_AREA_INSETS') {
      applySafeAreaInsets(msg.payload);
    } else if (msg.type === 'APP_STATE') {
      // Re-broadcast as a window-level CustomEvent so any component (e.g.,
      // the figure editor's Canvas) can subscribe without coupling to this
      // module. Native AppState is more reliable than visibilitychange
      // inside WKWebView for the figure-editor WebGL recovery path.
      void import('@/engine/debug/ring').then(m =>
        m.mark('appState.transition', { to: msg.payload.state, source: 'native' })
      );
      try {
        window.dispatchEvent(new CustomEvent('facet:appstate', { detail: msg.payload }));
      } catch {
        // CustomEvent unavailable in some old envs — ignore.
      }
    } else if (msg.type === 'RESUME_HEALTH_PING') {
      // Pong from inside a requestAnimationFrame callback. The point is not
      // the postMessage itself (JS is alive even on a dead surface) but that
      // the paint loop has actually ticked. If the WKWebView surface was
      // evicted during suspension, rAF will not deliver in time and the
      // native-side watchdog will reload us.
      const { nonce } = msg.payload;
      requestAnimationFrame(() => {
        postToNative({ type: 'RESUME_HEALTH_PONG', payload: { nonce } });
      });
    }
  });

  // Splash-dismiss fallback. Native onMessage handles READY idempotently, so
  // calling signalReady() twice (here + the first screen) is harmless.
  // Picked at 4 s — long enough that the normal first-screen rAF path always
  // wins on a healthy launch, short enough that a stalled first paint is not
  // a permanent splash.
  setTimeout(signalReady, 4000);
}

// AsyncRequireError recovery. Metro caches the rejected promise from a failed
// chunk fetch, so any subsequent `import()` of the same module keeps returning
// that rejection within the JS session. The only escape is a hard reload.
//
// On cold-install iPhones the failing chunk (e.g. the 26 MB CompositionEditor
// bundle) is also missing from iOS's file cache, so a naive reload right after
// the failure tends to fail again with NSURLErrorDomain -1004 — the loopback
// socket / GCDWebServer accept loop is still in the bad state that caused the
// original chunk-fetch failure. So before reloading we (1) poll the server
// origin until it actually responds, and (2) warm-fetch the failing chunk via
// raw `fetch()` — which bypasses Metro's poisoned AsyncRequire cache and
// commits the bytes to iOS's file cache for the post-reload retry.
//
// `sessionStorage` survives `window.location.reload()` but not app kill, which
// is exactly the lifetime we need: cap retries within a single launch, then
// fall through to ErrorBoundary so the user can see the real error.
//
// The handlers themselves `import('@/engine/debug/ring')`, so a debug/ring
// chunk-load failure would recurse here; the in-flight flag stops it.
const RECOVERY_KEY = 'facet:asyncRequireRecovery';
const MAX_RECOVERIES = 2;
let recoveryInFlight = false;

function isAsyncRequireError(msg: string): boolean {
  return msg.includes('AsyncRequireError')
    || (msg.includes('Loading module') && msg.includes('localhost:'));
}

function extractChunkUrl(msg: string): string | null {
  const m = msg.match(/https?:\/\/[^\s)'"]+\.js/);
  return m ? m[0] : null;
}

async function pollServerHealthy(serverOrigin: string, maxMs: number): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  let delay = 200;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(serverOrigin + '/index.html', { cache: 'reload' });
      if (r.ok) return true;
    } catch {
      // server still unreachable — keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 1500);
  }
  return false;
}

async function warmChunk(chunkUrl: string): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(chunkUrl, { cache: 'reload' });
      if (r.ok) {
        // Drain the body so iOS commits the file to its page cache before reload.
        await r.arrayBuffer();
        return true;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (i + 1)));
  }
  return false;
}

// COLD-START diag — parallel raw-fetch probe of the failing chunk URL.
// We want to know which bucket the failure falls into:
//   • TypeError / network error → loopback socket / GCDWebServer accept loop
//     never received the request (cross-reference with native [server] log:
//     no matching line means socket race).
//   • non-2xx status → file-path or 404 (cross-reference with [server] log
//     showing the same status).
//   • 200 OK but content-length mismatches arrayBuffer().byteLength → mid-
//     stream truncation (gzip pipeline / WKWebView memory pressure).
//   • 200 OK with full bytes → server delivered fine; AsyncRequire's own
//     module evaluation rejected (parse error, runtime exception in the
//     module). Different fix entirely — look at the chunk's eval output.
async function probeChunk(chunkUrl: string): Promise<void> {
  const start = Date.now();
  try {
    const r = await fetch(chunkUrl, { cache: 'reload' });
    // headers may be absent on minimal mock Responses; keep the probe robust.
    let cl: string | null = null;
    try { cl = r.headers?.get?.('content-length') ?? null; } catch { cl = null; }
    let bodyBytes = -1;
    let bodyError: string | null = null;
    try {
      const buf = await r.arrayBuffer();
      bodyBytes = buf.byteLength;
    } catch (e) {
      bodyError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
    const elapsed = Date.now() - start;
    logToNative('warn', 'asyncRequireRecovery.probe',
      `status=${r.status ?? '?'} content-length=${cl ?? '?'} body=${bodyBytes}b bodyError=${bodyError ?? 'none'} ${elapsed}ms`);
  } catch (e) {
    const elapsed = Date.now() - start;
    const name = e instanceof Error ? e.name : 'unknown';
    const message = e instanceof Error ? e.message : String(e);
    logToNative('warn', 'asyncRequireRecovery.probe',
      `network-error name=${name} msg=${message} ${elapsed}ms`);
  }
}

async function recoverFromAsyncRequireFailure(msg: string): Promise<void> {
  if (recoveryInFlight) return;
  if (!isAsyncRequireError(msg)) return;
  recoveryInFlight = true;

  let count = 0;
  try {
    count = Number(sessionStorage.getItem(RECOVERY_KEY) ?? '0');
  } catch {
    // sessionStorage unavailable — treat as first attempt and skip the loop guard
  }

  if (count >= MAX_RECOVERIES) {
    logToNative('error', 'asyncRequireRecovery', `giving up after ${count} attempts`);
    try { sessionStorage.removeItem(RECOVERY_KEY); } catch {}
    return; // Let ErrorBoundary surface the original error.
  }

  try { sessionStorage.setItem(RECOVERY_KEY, String(count + 1)); } catch {}

  const chunkUrl = extractChunkUrl(msg);
  const origin = chunkUrl
    ? new URL(chunkUrl).origin
    : (typeof window !== 'undefined' ? window.location.origin : '');

  logToNative('warn', 'asyncRequireRecovery', `attempt ${count + 1}, chunk=${chunkUrl ?? '?'}`);

  // COLD-START diag — probe the failing chunk independently. Do this BEFORE
  // pollServerHealthy so the very first network event after the failure is
  // captured, not whatever pollServerHealthy's `/index.html` fetch turns up.
  if (chunkUrl) {
    await probeChunk(chunkUrl);
  }

  // COLD-START diag — persist the live ring so the post-reload boot can
  // forward the pre-failure timeline via ring.replay.
  try {
    const ringMod = await import('@/engine/debug/ring');
    ringMod.flushToSession('asyncRequireRecovery');
  } catch {
    // ring import itself could fail under chunk-load pressure — non-fatal.
  }

  const serverOk = await pollServerHealthy(origin, 5000);
  logToNative('warn', 'asyncRequireRecovery', `server healthy=${serverOk}`);

  if (chunkUrl && serverOk) {
    const warm = await warmChunk(chunkUrl);
    logToNative('warn', 'asyncRequireRecovery', `chunk warm=${warm}`);
  }

  window.location.reload();
}

/**
 * Reset the AsyncRequire recovery counter. Call after a successful boot so the
 * next failure starts with a fresh budget. Safe to call from any environment.
 */
export function clearAsyncRequireRecoveryCounter(): void {
  try { sessionStorage.removeItem(RECOVERY_KEY); } catch {}
}

// Internal hooks for unit testing. Not part of the public API.
export const __asyncRequireInternals = {
  isAsyncRequireError,
  extractChunkUrl,
  recoverFromAsyncRequireFailure,
  resetForTest(): void { recoveryInFlight = false; },
  RECOVERY_KEY,
  MAX_RECOVERIES,
};

/**
 * Forward uncaught errors and unhandled promise rejections to the native console.
 * Also flushes the diagnostic ring buffer so the failure has a timeline attached.
 */
function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (e) => {
    const err = e.error;
    const msg = err?.stack || err?.message || e.message || 'unknown error';
    // TEMP diagnostic — flush ring buffer so the timeline reaches native.
    void import('@/engine/debug/ring').then(m => m.flush('window.error'));
    logToNative('error', 'window.error', String(msg));
    void recoverFromAsyncRequireFailure(String(msg));
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason: unknown = e.reason;
    const msg = reason instanceof Error
      ? (reason.stack || reason.message)
      : safeStringify(reason);
    // TEMP diagnostic — flush ring buffer so the timeline reaches native.
    void import('@/engine/debug/ring').then(m => m.flush('unhandledrejection'));
    logToNative('error', 'unhandledrejection', String(msg));
    void recoverFromAsyncRequireFailure(String(msg));
  });
}

function safeStringify(v: unknown): string {
  try { return typeof v === 'string' ? v : JSON.stringify(v); } catch { return '[unserializable]'; }
}
