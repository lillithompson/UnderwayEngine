import { readFileSync } from 'fs';
import { join } from 'path';

// An iPad's WKWebView defaults to DESKTOP content mode, and with it a user
// agent that reads "Macintosh" — no "iPad", no "Safari". Every library that
// branches on the user agent then takes its desktop path on a tablet. One of
// them (expo-font's web loader) waited on a font observer WebKit breaks, with
// a 12 000 ms timeout, unless the agent named an iPhone, iPad or Safari: on
// the iPad 10th gen that was 12.8 s from tap to canvas, on every editor open.
// The page is a phone-shaped editor everywhere, so the shell says so.
//
// WebViewShell pulls in react-native and reads __DEV__ at module scope, so it
// cannot be imported here; this reads the source, as the inspectable test does.

const SRC = readFileSync(join(__dirname, '..', 'WebViewShell.tsx'), 'utf8');

describe('the WebView presents as a phone on every device', () => {
  it('asks WKWebView for mobile content mode', () => {
    expect(SRC).toContain('contentMode="mobile"');
  });

  it('sets it on the WebView element itself, not somewhere a prop could override', () => {
    // The prop must sit inside the <WebView …> element, between its opening
    // tag and the closing `/>`, so it is always passed.
    const open = SRC.indexOf('<WebView');
    const close = SRC.indexOf('/>', open);
    expect(open).toBeGreaterThan(-1);
    expect(SRC.slice(open, close)).toContain('contentMode="mobile"');
  });
});
