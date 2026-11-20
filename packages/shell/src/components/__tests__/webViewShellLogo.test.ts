import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// The picture the shell draws over the WebView itself — where the host
// passes no splash, and on both failure panels whatever it passes — is a
// prop (logo), so a host shows its own mark there rather than the shell's,
// and a host that passes nothing draws the file the shell always drew.
// WebViewShell pulls in react-native and cannot be imported here, so this
// reads the source, as webViewShellRecoveryEvent.test.ts does.

const SRC = readFileSync(join(__dirname, '..', 'WebViewShell.tsx'), 'utf8');

const OVERLAY_OPEN = '{!webReady && (splash === undefined || recoveryFailed || serverFailed) && (';

/** The fallback overlay's JSX: from its condition to the end of the component. */
function overlay(): string {
  const start = SRC.indexOf(OVERLAY_OPEN);
  const end = SRC.indexOf('const styles = StyleSheet.create(');
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe('WebViewShell logo', () => {
  it('is an optional prop of an image source', () => {
    expect(SRC).toContain('logo?: ImageSourcePropType;');
    expect(SRC).toMatch(/import \{[^}]*\bImageSourcePropType\b[^}]*\} from 'react-native';/);
  });

  it('defaults to the shell’s own file, so a host that passes none draws what it always did', () => {
    expect(SRC).toContain("const SHELL_LOGO: ImageSourcePropType = require('../../assets/images/splash-icon.png');");
    expect(SRC).toContain('  logo = SHELL_LOGO,\n');
    expect(existsSync(join(__dirname, '..', '..', '..', 'assets', 'images', 'splash-icon.png'))).toBe(true);
    // …and that default is the only picture the file names: no Image
    // draws a file of its own past the prop.
    expect(SRC.match(/require\('[^']*\.(png|jpe?g|gif|webp)'\)/g)).toEqual([
      "require('../../assets/images/splash-icon.png')",
    ]);
  });

  it('is what the one Image draws, in the no-splash load and on both failure panels', () => {
    const jsx = overlay();
    // One Image in the whole shell, and it is the overlay's.
    expect(SRC.match(/<Image\b/g)).toHaveLength(1);
    const image = jsx.indexOf('<Image');
    expect(image).toBeGreaterThan(0);
    expect(jsx.slice(image, jsx.indexOf('/>', image))).toContain('source={logo}');
    // It sits above the choice of what goes under it — the server's
    // failure panel, the content process's, or the spinner of a load —
    // so it is drawn in all three.
    const serverPanel = jsx.indexOf('{serverFailed ? (');
    const recoveryPanel = jsx.indexOf(') : recoveryFailed ? (');
    const loading = jsx.indexOf('<ActivityIndicator');
    expect(image).toBeLessThan(serverPanel);
    expect(serverPanel).toBeLessThan(recoveryPanel);
    expect(recoveryPanel).toBeLessThan(loading);
  });
});
