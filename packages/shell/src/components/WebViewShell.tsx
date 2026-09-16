import React, { useRef, useState, useEffect, useCallback } from 'react';
import { StyleSheet, View, ActivityIndicator, Image, AppState, AppStateStatus, Text, TouchableOpacity } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalServer } from '../server/useLocalServer';
import { handleNativeMessage } from '../bridge/nativeBridge';
import { NativeToWebMessage } from '../bridge/protocol';
import { recordTermination, resetGuard } from '../bridge/webContentRecovery';
import { shouldProbeOnResume, WATCHDOG_MS } from '../bridge/resumeLivenessWatchdog';
import { ACCENT_SECONDARY, BG_HEADER, BG_DARK } from '@/engine/colors';
import { DIAGNOSTICS } from '../profiling';

export interface WebViewShellProps {
  /**
   * Let Safari's Web Inspector attach to the page (Develop menu → the
   * device → the page): the one way to see the WebContent process's own
   * memory, layers and timeline from outside — and, since iOS 16.4, one a
   * WKWebView must opt into or it does not appear in the menu at all.
   *
   * Defaults to DIAGNOSTICS — a dev build or a profiling one. The default
   * matters more than it looks: this app's only device script builds
   * Release (`npm run ios:device`), so __DEV__ alone meant no build that
   * ever ran on a phone was inspectable.
   */
  debuggable?: boolean;
  /**
   * Optional suffix appended verbatim to the loaded page URL (e.g.
   * '?entryId=abc&format=haiku'). Lets the host app route/parameterize
   * the web bundle at load time with no bridge round-trip. Applied to
   * both the Metro dev-server URL and the bundled static-server URL,
   * which are each origin-only (no path/query), so a '?…' suffix always
   * composes into a valid URL.
   *
   * The FIRST value is what the page is loaded with. Changing it later
   * re-points the page over the bridge (NAVIGATE_TO) rather than
   * reloading it, so a host that learns which page to open after the
   * WebView is up — or that keeps one WebView across several pages —
   * pays the bundle's cost once. The ready latch drops on the change,
   * so the splash covers the new route until the page says it is up.
   */
  urlSuffix?: string;
  /**
   * Called when the WKWebView begins loading the page — the first thing
   * that happens inside the WebView after the host mounts it, and the
   * only way the native side can see where the boundary between "native
   * pushed a screen" and "the page is loading" falls.
   *
   * For instrumentation (CozyJournal's open trace): the host records a
   * mark and nothing else, so a build that measures nothing passes
   * nothing and this stays unwired.
   */
  onLoadStart?: () => void;
  /**
   * What covers the WebView until the page says READY, in place of the
   * app's logo on black.
   *
   * The dark splash is right for a cold launch and wrong for a
   * transition: mid-gesture it reads as the app restarting. A host that
   * knows what the page will look like — its chrome, its colour — can
   * hand a stand-in for it here and the wait reads as the page arriving.
   *
   * It covers the load only. A content process that dies and cannot be
   * recovered still falls back to the logo and its failure panel: that
   * one IS the app in trouble, and must look like it.
   */
  splash?: React.ReactNode;
  /**
   * Handed the WebView's own ref once it is mounted, and null when it goes
   * away — so the host can photograph exactly what the page is showing
   * (react-native-view-shot's captureRef takes a ref object).
   *
   * The ref, not a capture function: the shell owns the view and nothing
   * else, and what a picture of it is FOR is the host's business. Pass a
   * stable callback — it is an effect's dependency.
   */
  onWebViewRef?: (ref: React.RefObject<unknown> | null) => void;
}

// The native splash overlay (logo + spinner on dark) covers the WebView until
// the web side posts READY. READY is sent from the first screen
// (compositions.tsx) after its first paint with real data, not on a timer, so
// the splash hides directly onto a frame with the final UI — no skeleton, no
// resize flash, no intermediate handoff.
export default function WebViewShell({
  urlSuffix,
  onLoadStart,
  splash,
  onWebViewRef,
  debuggable = DIAGNOSTICS,
}: WebViewShellProps = {}) {
  const { url, ready } = useLocalServer();
  const [webReady, setWebReady] = useState(false);
  // What the page was LOADED with. The WebView's source must not change
  // after that: a new source is a fresh load, which is the cost this is
  // here to avoid. Everything after the first value is a route change,
  // sent over the bridge below.
  const loadedSuffix = useRef(urlSuffix);
  // …and where it has been re-pointed since, so a page that asks (having
  // loaded before the host knew) is answered rather than left waiting.
  const routeSuffix = useRef(urlSuffix);
  const [recoveryFailed, setRecoveryFailed] = useState(false);
  const webViewRef = useRef<WebView>(null);
  const insets = useSafeAreaInsets();

  const sendToWeb = useCallback((message: NativeToWebMessage) => {
    const json = JSON.stringify(message);
    webViewRef.current?.injectJavaScript(`window.__onNativeMessage(${json}); true;`);
  }, []);

  // Bridge iOS app lifecycle to the web side. The figure editor's WebGL
  // canvas can go blank after the app is backgrounded; we need a
  // deterministic resume signal because document.visibilitychange inside
  // WKWebView is not reliable enough to be the sole trigger.
  //
  // Long-suspension recovery (liveness ping-pong): if the app was backgrounded
  // past LONG_BACKGROUND_MS, iOS may have reclaimed the WKWebView's IOSurface
  // drawables while the WebContent process itself survived — the layer tree
  // "unhides" on resume but to a dead surface, presenting as an entirely
  // black, unresponsive screen. On resume past the threshold we ping the
  // web side with a nonce; it pongs back from inside a requestAnimationFrame
  // callback. A live surface round-trips in ~one frame; a dead one fails to
  // tick the paint loop and the watchdog reloads the WebView. Short / healthy
  // resumes never ping and stay completely undisturbed.
  const backgroundedAtRef = useRef<number | null>(null);
  const pendingNonceRef = useRef<string | null>(null);
  const watchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearWatchdog = useCallback(() => {
    if (watchdogTimerRef.current !== null) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
    pendingNonceRef.current = null;
  }, []);

  useEffect(() => {
    if (!webReady) return;
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'background') {
        clearWatchdog();
        backgroundedAtRef.current = Date.now();
        console.log('[webViewShell] AppState →', state);
        sendToWeb({ type: 'APP_STATE', payload: { state } });
        return;
      }
      if (state !== 'active') return;
      const bgAt = backgroundedAtRef.current;
      backgroundedAtRef.current = null;
      console.log('[webViewShell] AppState →', state);
      sendToWeb({ type: 'APP_STATE', payload: { state } });
      if (!shouldProbeOnResume(bgAt, Date.now())) return;
      const elapsed = Date.now() - (bgAt as number);
      const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
      pendingNonceRef.current = nonce;
      console.log('[webViewShell] long background', elapsed, 'ms — pinging for liveness');
      sendToWeb({ type: 'RESUME_HEALTH_PING', payload: { nonce } });
      watchdogTimerRef.current = setTimeout(() => {
        watchdogTimerRef.current = null;
        if (pendingNonceRef.current !== nonce) return;
        pendingNonceRef.current = null;
        console.warn('[webViewShell] liveness watchdog expired — reloading WebView to recover dead surface');
        setWebReady(false);
        webViewRef.current?.reload();
      }, WATCHDOG_MS);
    });
    return () => {
      sub.remove();
      clearWatchdog();
    };
  }, [webReady, sendToWeb, clearWatchdog]);

  // The view itself, offered to the host for as long as it is mounted.
  useEffect(() => {
    onWebViewRef?.(webViewRef);
    return () => onWebViewRef?.(null);
  }, [onWebViewRef]);

  // A route the host worked out after the page was loaded: sent, not
  // reloaded. The page re-resolves and signals READY again — until it
  // does, the splash is back over it, exactly as it is over a load.
  useEffect(() => {
    if (urlSuffix === undefined || urlSuffix === routeSuffix.current) return;
    routeSuffix.current = urlSuffix;
    setWebReady(false);
    sendToWeb({ type: 'NAVIGATE_TO', payload: { search: urlSuffix } });
  }, [urlSuffix, sendToWeb]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    let data: any;
    try {
      data = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }

    handleNativeMessage(data, sendToWeb);

    if (data.type === 'READY') {
      // A successful handshake is the strongest signal that recovery
      // worked; clear the termination guard so a single later kill
      // doesn't immediately exhaust the budget.
      resetGuard();
      setWebReady(true);
      sendToWeb({
        type: 'SAFE_AREA_INSETS',
        payload: { top: insets.top, bottom: insets.bottom, left: insets.left, right: insets.right },
      });
    } else if (data.type === 'ROUTE_REQUEST') {
      // A page loaded without its query, asking what it is for. Answered
      // only when there is something it does not already have: the send
      // above covers the other order, where the host learned the route
      // while the page was still parsing its bundle and the message it
      // sent then had no handler to land on.
      if (routeSuffix.current !== undefined && routeSuffix.current !== loadedSuffix.current) {
        sendToWeb({ type: 'NAVIGATE_TO', payload: { search: routeSuffix.current } });
      }
    } else if (data.type === 'RESUME_HEALTH_PONG' && data.payload?.nonce === pendingNonceRef.current) {
      console.log('[webViewShell] RESUME_HEALTH_PONG received — surface alive');
      clearWatchdog();
    }
  }, [insets, sendToWeb, clearWatchdog]);

  // iOS only: react-native-webview fires this when the WKWebView's
  // content process is terminated by the OS (typically jetsam under
  // memory pressure after extended editing of a large file pushed the
  // renderer past its budget). Without recovery the user sees a black
  // canvas on resume. Reload the WebView, fronted by the existing
  // splash overlay; if it keeps happening, surface a terminal error
  // panel rather than pinwheeling.
  const onContentProcessDidTerminate = useCallback(() => {
    const { allowReload, attempt } = recordTermination();
    if (allowReload) {
      console.error('[webContentRecovery] terminated, reloading (attempt', attempt + ')');
      setWebReady(false);
      webViewRef.current?.reload();
    } else {
      console.error('[webContentRecovery] giving up after', attempt, 'terminations within 60s');
      setRecoveryFailed(true);
      setWebReady(false);
    }
  }, []);

  const onRetryAfterFailure = useCallback(() => {
    resetGuard();
    setRecoveryFailed(false);
    setWebReady(false);
    webViewRef.current?.reload();
  }, []);

  return (
    <View style={styles.root}>
      {ready && url && (
        <View style={styles.container}>
          <WebView
            ref={webViewRef}
            source={{ uri: loadedSuffix.current ? url + loadedSuffix.current : url }}
            style={styles.webview}
            onMessage={onMessage}
            onLoadStart={onLoadStart}
            onError={(e) => {
              // Surface the full nativeEvent so we get the
              // underlying NSError code/domain when WKWebView reports a
              // navigation-level failure (e.g. -1004 socket-not-connected).
              const ne = e.nativeEvent as unknown as Record<string, unknown>;
              console.error('[WebViewShell] Error:', JSON.stringify({
                description: ne.description, code: ne.code, domain: ne.domain,
                url: ne.url, didFailProvisionalNavigation: ne.didFailProvisionalNavigation,
              }));
            }}
            onHttpError={(e) => {
              const ne = e.nativeEvent as unknown as Record<string, unknown>;
              console.error('[WebViewShell] HTTP Error:', JSON.stringify({
                statusCode: ne.statusCode, url: ne.url, description: ne.description,
              }));
            }}
            onContentProcessDidTerminate={onContentProcessDidTerminate}
            webviewDebuggingEnabled={debuggable}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            allowsInlineMediaPlayback
            bounces={false}
            scalesPageToFit={false}
            scrollEnabled={false}
            allowsBackForwardNavigationGestures={false}
            keyboardDisplayRequiresUserAction={false}
            // Suppress iOS's native keyboard accessory bar (the ‹ › + Done
            // toolbar WKWebView adds above the keyboard for form fields). The
            // in-WebView editor supplies its own Done control on the text-edit
            // bar, so the accessory view is redundant chrome — and it steals
            // vertical space the editor already lifts its input above.
            hideKeyboardAccessoryView
            injectedJavaScriptBeforeContentLoaded={`
              window.__FACET_NATIVE_SHELL = true;
              window.__onNativeMessage = function(msg) {
                if (window.__facetBridgeHandler) {
                  window.__facetBridgeHandler(msg);
                }
              };
              true;
            `}
          />
        </View>
      )}
      {!webReady && splash !== undefined && !recoveryFailed && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">{splash}</View>
      )}
      {!webReady && (splash === undefined || recoveryFailed) && (
        <View style={styles.splashOverlay} pointerEvents={recoveryFailed ? 'auto' : 'none'}>
          <Image
            source={require('../../assets/images/splash-icon.png')}
            style={styles.splashLogo}
            resizeMode="contain"
            fadeDuration={0}
          />
          {recoveryFailed ? (
            <View style={styles.failurePanel}>
              <Text style={styles.failureText}>
                Facet ran out of memory and couldn't recover.
              </Text>
              <Text style={styles.failureText}>
                Force-quit the app and reopen to continue.
              </Text>
              <TouchableOpacity onPress={onRetryAfterFailure} style={styles.retryButton}>
                <Text style={styles.retryButtonText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ActivityIndicator size="small" color={ACCENT_SECONDARY} style={styles.loadingSpinner} />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG_DARK,
  },
  container: {
    flex: 1,
    backgroundColor: BG_HEADER,
  },
  webview: {
    flex: 1,
    backgroundColor: BG_DARK,
  },
  splashOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: BG_DARK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashLogo: {
    width: 160,
    height: 160,
  },
  loadingSpinner: {
    marginTop: 32,
  },
  failurePanel: {
    marginTop: 32,
    paddingHorizontal: 32,
    alignItems: 'center',
    maxWidth: 360,
  },
  failureText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: ACCENT_SECONDARY,
    borderRadius: 6,
  },
  retryButtonText: {
    color: ACCENT_SECONDARY,
    fontSize: 15,
  },
});
