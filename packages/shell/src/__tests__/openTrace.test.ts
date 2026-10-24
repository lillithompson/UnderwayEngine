import { formatOpenTrace, markOpen, openTraceMarks, resetOpenTrace, sanitizeOpenTrace } from '../openTrace';

// An editor open crosses two JS contexts — the native one that pushes the
// route and the WebView's, which loads a multi-megabyte bundle before it can
// draw — so the only way to see where its time goes is to have both sides
// record marks on one wall clock and print them together.
//
// The RECORDER is what is here, and it is pure. The WIRING that feeds it is
// each app's and is pinned at the source there, since every site of it is
// one of that app's components or router screens (stage 6.4b of
// docs/shared-editor.md; CozyJournal's docs/response_open_speed.md Phase 0
// is where the measurement was taken).

describe('the recorder', () => {
  afterEach(resetOpenTrace);

  test('a shipping build records nothing at all — the flag is inlined, so the calls fold away', () => {
    // Jest defines no __DEV__ and sets no EXPO_PUBLIC_WEBVIEW_INSPECTABLE,
    // which is exactly what an App Store build looks like.
    markOpen('push');
    markOpen('glReady');
    expect(openTraceMarks()).toEqual([]);
  });

  test('…and a profiling build records name, wall clock and the note beside it', () => {
    jest.isolateModules(() => {
      process.env.EXPO_PUBLIC_WEBVIEW_INSPECTABLE = '1';
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const trace = require('../openTrace') as typeof import('../openTrace');
        trace.markOpen('push', 'respond', 1000);
        trace.markOpen('glReady', undefined, 1900);
        expect(trace.openTraceMarks()).toEqual([
          { name: 'push', t: 1000, note: 'respond' },
          { name: 'glReady', t: 1900 },
        ]);
        // Printed, then forgotten: the next open starts from its own tap.
        trace.resetOpenTrace();
        expect(trace.openTraceMarks()).toEqual([]);
      } finally {
        delete process.env.EXPO_PUBLIC_WEBVIEW_INSPECTABLE;
      }
    });
  });
});

describe('the table', () => {
  test('is offset from the first mark, with each step beside it', () => {
    const out = formatOpenTrace([
      { name: 'push', t: 1000 },
      { name: 'loadStart', t: 1040 },
      { name: 'glReady', t: 2500 },
    ]);
    expect(out).toContain('1500ms total');
    expect(out).toMatch(/0ms\s+\+0\s+push/);
    expect(out).toMatch(/40ms\s+\+40\s+loadStart/);
    expect(out).toMatch(/1500ms\s+\+1460\s+glReady/);
  });

  test('sorts by time, not by arrival — the web posts its whole list at the end', () => {
    const out = formatOpenTrace([
      { name: 'mount', t: 1200 },
      { name: 'push', t: 1000 },
    ]);
    expect(out.indexOf('push')).toBeLessThan(out.indexOf('mount'));
  });

  test('a note rides beside its mark', () => {
    expect(formatOpenTrace([{ name: 'thumbDone', t: 1, note: '1.9 MB' }])).toContain('(1.9 MB)');
  });

  test('nothing to print says so rather than throwing', () => {
    expect(formatOpenTrace([])).toContain('no marks');
  });
});

describe('what crosses the bridge', () => {
  test('a malformed post is dropped rather than printed half-built', () => {
    expect(sanitizeOpenTrace(null)).toBeNull();
    expect(sanitizeOpenTrace({})).toBeNull();
    expect(sanitizeOpenTrace({ marks: 'no' })).toBeNull();
    expect(sanitizeOpenTrace({ marks: [{ name: '', t: 1 }] })).toBeNull();
    expect(sanitizeOpenTrace({ marks: [{ name: 'x', t: 'soon' }] })).toBeNull();
  });

  test('…and a good one keeps every mark that survived the JSON round trip', () => {
    expect(sanitizeOpenTrace({
      marks: [{ name: 'mount', t: 2 }, 'junk', { name: 'routeSet', t: 3, note: 'new' }],
    })).toEqual({ marks: [{ name: 'mount', t: 2 }, { name: 'routeSet', t: 3, note: 'new' }] });
  });
});
