/**
 * Whether this build carries diagnostics a shipping build has no reason to.
 *
 * Expo inlines EXPO_PUBLIC_* at bundle time, so PROFILING is a constant in
 * the shipped JS rather than a runtime lookup — and a build that sets
 * nothing, which is every App Store build, gets none of it.
 * `npm run ios:profile` sets it, and because that script runs `build:web`
 * inside the same environment, the native bundle and the WebView's bundle
 * are both built with it: one flag, both sides.
 *
 * Two things ride DIAGNOSTICS:
 *  - the WKWebView opts into Safari's Web Inspector (WebViewShell), which
 *    since iOS 16.4 it must do explicitly or it does not appear in the
 *    Develop menu at all;
 *  - the page exposes window.__perf, the image pipeline's cost counters
 *    (docs/image_refactor.md §5).
 *
 * A dev build gets both without asking — that is the ordinary way to reach
 * them, Metro plus a Debug build, and a profiling build is how to reach
 * them on a RELEASE bundle, where the memory numbers are representative.
 *
 * `typeof` rather than a bare `__DEV__`: this module is imported by
 * webBridge, which the test suites do import, and Jest defines no __DEV__.
 */
declare const __DEV__: boolean | undefined;

export const PROFILING = process.env.EXPO_PUBLIC_WEBVIEW_INSPECTABLE === '1';

export const DIAGNOSTICS = (typeof __DEV__ !== 'undefined' && __DEV__ === true) || PROFILING;
