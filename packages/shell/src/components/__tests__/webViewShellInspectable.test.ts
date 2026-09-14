import { readFileSync } from 'fs';
import { join } from 'path';

// Since iOS 16.4 a WKWebView is invisible to Safari's Web Inspector unless it
// opts in, and this app's only device script builds Release
// (`npm run ios:device`). So a default of __DEV__ alone meant that no build
// which ever ran on a phone could be inspected — the Develop menu listed the
// device and then said "No inspectable applications".
//
// WebViewShell pulls in react-native and reads __DEV__ at module scope, so it
// cannot be imported here. These read the source, as featureFlags.test.ts
// does for the same reason.

const SRC = readFileSync(join(__dirname, '..', 'WebViewShell.tsx'), 'utf8');
const FLAG_SRC = readFileSync(join(__dirname, '..', '..', 'profiling.ts'), 'utf8');

describe('the WebView opts into Web Inspector on a profiling build', () => {
  it('defaults debuggable to a dev build OR a profiling one', () => {
    expect(SRC).toContain('debuggable = DIAGNOSTICS');
    expect(FLAG_SRC).toContain('__DEV__ === true) || PROFILING');
  });

  it('takes the profiling flag from the build, not from a runtime lookup', () => {
    // EXPO_PUBLIC_* is inlined by Expo at bundle time, so PROFILING is a
    // constant in the shipped JS rather than something a device can flip.
    expect(FLAG_SRC).toContain("export const PROFILING = process.env.EXPO_PUBLIC_WEBVIEW_INSPECTABLE === '1'");
  });

  it('leaves a build that sets nothing uninspectable', () => {
    // The property worth keeping: App Store builds set no flag and are not
    // inspectable. Nothing may make PROFILING true by default — no `!==`,
    // no `?? true`, no bare truthiness on the env var.
    const line = FLAG_SRC.split('\n').find((l) => l.startsWith('export const PROFILING'));
    expect(line).toBeDefined();
    expect(line).toMatch(/===\s*'1'/);
    expect(line).not.toMatch(/!==|\?\?\s*true/);
  });

  it('still lets a caller force it either way', () => {
    // The prop remains optional and overridable; the default is only a
    // default. A profiling harness that wants it off can still say so.
    expect(SRC).toContain('debuggable?: boolean;');
  });
});
