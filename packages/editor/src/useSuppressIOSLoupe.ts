import { useEffect, RefObject } from 'react';
import type { View } from 'react-native';
import { isInWebView } from '@/native-shell/bridge/webBridge';
// Reused rather than re-derived: the same "is this a field the user types
// into" test the Delete shortcut uses. It is pure and DOM-free.
import { isTypingTarget, KeyTarget } from '@/editor/deleteKeyShortcut';

// iOS WKWebView's UITextInteraction recognizer arms on raw touchstart and
// can summon the text-selection magnifier (loupe) before CSS user-select
// rules take effect. preventDefault on touchstart is the only web-side
// hook that disarms it. Pointer events dispatch independently on iOS, so
// existing onPointerDown/Move/Up handlers keep working — including the user
// activation a pointerup handler needs to open a file picker.
//
// Shared by every canvas in the shared editor: an armed
// recognizer that never gets a matching touchend — which is what happens when
// a native sheet (the `<input type="file">` upload panel) covers the WebView
// mid-gesture — draws the loupe anyway, a stray round magnifier over the
// canvas that lingers until its own fade-out timer clears it.
//
// Detection is layered because no single signal covers every case:
//   • Inside the native shell, Platform.OS reports 'web' (react-native-web)
//     and on iPad the WKWebView UA reports as 'Macintosh' by default
//     (iPadOS 13+ drops the iPad token), so UA matching alone misses iPad.
//     __FACET_NATIVE_SHELL is set by injectedJavaScriptBeforeContentLoaded
//     before any web JS runs, so it's the load-bearing signal here.
//   • In mobile Safari the iPhone UA still contains 'iPhone', and iPad
//     mobile Safari uses the same desktop-Mac UA but is identifiable via
//     navigator.platform + maxTouchPoints. Cover both for dev preview.
/** The environment half of the hook, split out so it is unit-testable without
 *  a DOM: does this browser need the loupe disarmed? */
export function shouldSuppressIOSLoupe(
  nav: { userAgent: string; platform: string; maxTouchPoints?: number },
  inWebView: boolean,
): boolean {
  const isMobileIOSUA = /iPhone|iPad|iPod/.test(nav.userAgent);
  const isIPadOSDesktopUA =
    nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1;
  return inWebView || isMobileIOSUA || isIPadOSDesktopUA;
}

/** preventDefault on touchstart disarms the loupe, but it also cancels the
 *  other thing that default does: moving focus. WebKit blurs the focused text
 *  field when you tap elsewhere as part of that default, so suppressing it
 *  wholesale leaves the text-edit overlay's textarea focused and the keyboard
 *  up when you tap the canvas — the edit never commits. Blur it by hand.
 *
 *  Only typing targets, and only ones outside the canvas subtree: focus that
 *  already lives in the canvas is the canvas's own business. */
export function shouldBlurOnSuppressedTouch(
  active: KeyTarget | null,
  activeIsInsideContainer: boolean,
): boolean {
  if (!active || activeIsInsideContainer) return false;
  return isTypingTarget(active);
}

export function useSuppressIOSLoupe(
  ref: RefObject<View | HTMLElement | null>,
): void {
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    if (!shouldSuppressIOSLoupe(navigator, isInWebView())) return;
    const el = ref.current as unknown as HTMLElement | null;
    if (!el) return;
    const onTouchStart = (e: TouchEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (active && shouldBlurOnSuppressedTouch(active, el.contains(active))) {
        active.blur();
      }
      e.preventDefault();
    };
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    return () => el.removeEventListener('touchstart', onTouchStart);
  }, [ref]);
}
