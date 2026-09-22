import { readFileSync } from 'fs';
import { join } from 'path';

// The shell's recovery events reach the host through one optional prop
// (onRecoveryEvent), from every place the page is reloaded or fails to
// load. WebViewShell pulls in react-native and cannot be imported here,
// so this reads the source, as webViewShellInspectable.test.ts does.

const SRC = readFileSync(join(__dirname, '..', 'WebViewShell.tsx'), 'utf8');

describe('WebViewShell onRecoveryEvent', () => {
  it('is an optional prop, read through a ref so callbacks need not re-subscribe', () => {
    expect(SRC).toContain('onRecoveryEvent?: (kind: RecoveryEventKind, detail?: string) => void;');
    expect(SRC).toContain("export type RecoveryEventKind = 'terminated' | 'gaveUp' | 'watchdog' | 'loadError' | 'httpError';");
    expect(SRC).toContain('const onRecoveryEventRef = useRef(onRecoveryEvent);');
    expect(SRC).toContain('onRecoveryEventRef.current = onRecoveryEvent;');
  });

  it('fires from every recovery path, and from both load failures', () => {
    for (const kind of ['terminated', 'gaveUp', 'watchdog', 'loadError', 'httpError']) {
      expect(SRC).toContain(`onRecoveryEventRef.current?.('${kind}'`);
    }
  });

  it('never hands the host the page URL (it carries route parameters)', () => {
    const calls = [...SRC.matchAll(/onRecoveryEventRef\.current\?\.\([^\n]*\)/g)].map((m) => m[0]);
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const call of calls) expect(call).not.toContain('url');
  });

  it('keeps the console lines it always wrote', () => {
    expect(SRC).toContain("console.error('[webContentRecovery] terminated, reloading (attempt', attempt + ')');");
    expect(SRC).toContain("console.warn('[webViewShell] liveness watchdog expired — reloading WebView to recover dead surface');");
  });
});
