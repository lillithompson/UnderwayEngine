import { readFileSync } from 'fs';
import { join } from 'path';

// The recovery-failed panel is the one place the shell's own words name
// the app, and they named the app the shell came out of: a host passes
// its own name (appName), and a host that passes none reads the sentence
// it always did. WebViewShell pulls in react-native and cannot be
// imported here, so this reads the source, as
// webViewShellRecoveryEvent.test.ts does.

const SRC = readFileSync(join(__dirname, '..', 'WebViewShell.tsx'), 'utf8');

/** The JSX between two markers that each occur once. */
function between(from: string, to: string): string {
  const start = SRC.indexOf(from);
  expect(start).toBeGreaterThan(0);
  expect(SRC.indexOf(from, start + 1)).toBe(-1);
  const end = SRC.indexOf(to, start);
  expect(end).toBeGreaterThan(start);
  return SRC.slice(start, end);
}

const RECOVERY_PANEL = () => between(') : recoveryFailed ? (', ') : (');
const SERVER_PANEL = () => between('{serverFailed ? (', ') : recoveryFailed ? (');

describe('WebViewShell appName', () => {
  it('is an optional string prop with no default of its own', () => {
    expect(SRC).toContain('appName?: string;');
    expect(SRC).toContain('  appName,\n');
  });

  it('names the app on the recovery-failed panel when the host passes it', () => {
    expect(RECOVERY_PANEL()).toContain('`${appName} ran out of memory and couldn\'t recover.`');
  });

  it('leaves a host that passes none reading the sentence it always did', () => {
    const panel = RECOVERY_PANEL();
    expect(panel).toContain('{appName === undefined');
    expect(panel).toContain('? "Facet ran out of memory and couldn\'t recover."');
    // …spelled out whole, once, and only there.
    expect(SRC.split("Facet ran out of memory and couldn't recover.")).toHaveLength(2);
    expect(panel).toContain('Force-quit the app and reopen to continue.');
  });

  it('leaves the server’s failure panel as it was: its words name no app', () => {
    const panel = SERVER_PANEL();
    expect(panel).not.toContain('appName');
    expect(panel).toContain("Couldn't open your saved work.");
  });
});
