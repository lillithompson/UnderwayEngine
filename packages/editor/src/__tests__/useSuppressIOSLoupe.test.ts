import {
  shouldSuppressIOSLoupe,
  shouldBlurOnSuppressedTouch,
} from '../useSuppressIOSLoupe';

// The loupe suppressor guards the shared editor's canvas. Its detection is
// layered because no single signal covers iPhone, iPad-in-WebView and
// desktop dev preview — these lock that layering in.

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
// iPadOS 13+ drops the iPad token and reports as a desktop Mac.
const IPAD_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
const MAC_UA = IPAD_DESKTOP_UA;

describe('shouldSuppressIOSLoupe', () => {
  test('suppresses inside the native shell whatever the UA claims', () => {
    // Under react-native-web the WebView UA is indistinguishable from a Mac,
    // so __FACET_NATIVE_SHELL is the load-bearing signal.
    expect(
      shouldSuppressIOSLoupe(
        { userAgent: MAC_UA, platform: 'MacIntel', maxTouchPoints: 0 },
        true,
      ),
    ).toBe(true);
  });

  test('suppresses on mobile Safari iPhone', () => {
    expect(
      shouldSuppressIOSLoupe(
        { userAgent: IPHONE_UA, platform: 'iPhone', maxTouchPoints: 5 },
        false,
      ),
    ).toBe(true);
  });

  test('suppresses on iPad reporting the desktop Mac UA (touch points give it away)', () => {
    expect(
      shouldSuppressIOSLoupe(
        { userAgent: IPAD_DESKTOP_UA, platform: 'MacIntel', maxTouchPoints: 5 },
        false,
      ),
    ).toBe(true);
  });

  test('leaves a real desktop Mac alone', () => {
    expect(
      shouldSuppressIOSLoupe(
        { userAgent: MAC_UA, platform: 'MacIntel', maxTouchPoints: 0 },
        false,
      ),
    ).toBe(false);
  });

  test('treats a missing maxTouchPoints as no touch', () => {
    expect(
      shouldSuppressIOSLoupe({ userAgent: MAC_UA, platform: 'MacIntel' }, false),
    ).toBe(false);
  });

  test('leaves a desktop non-Mac alone', () => {
    expect(
      shouldSuppressIOSLoupe(
        {
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          platform: 'Win32',
          maxTouchPoints: 10,
        },
        false,
      ),
    ).toBe(false);
  });
});

// Suppressing touchstart's default also suppresses the focus change it would
// have caused, so the hook has to blur the text-edit field itself. Without
// this, tapping the canvas mid-edit left the keyboard up and the edit
// uncommitted.
describe('shouldBlurOnSuppressedTouch', () => {
  const textarea = { tagName: 'TEXTAREA', isContentEditable: false };

  test('blurs the text-edit overlay field on a canvas tap', () => {
    expect(shouldBlurOnSuppressedTouch(textarea, false)).toBe(true);
  });

  test('blurs a panel input (hex field, rename box) too', () => {
    expect(
      shouldBlurOnSuppressedTouch({ tagName: 'input', isContentEditable: false }, false),
    ).toBe(true);
  });

  test('blurs a contenteditable host', () => {
    expect(
      shouldBlurOnSuppressedTouch({ tagName: 'DIV', isContentEditable: true }, false),
    ).toBe(true);
  });

  test('leaves focus inside the canvas subtree alone', () => {
    expect(shouldBlurOnSuppressedTouch(textarea, true)).toBe(false);
  });

  test('does nothing when a non-typing element holds focus', () => {
    expect(
      shouldBlurOnSuppressedTouch({ tagName: 'BUTTON', isContentEditable: false }, false),
    ).toBe(false);
  });

  test('does nothing when nothing is focused', () => {
    expect(shouldBlurOnSuppressedTouch(null, false)).toBe(false);
  });
});
