import { readFileSync } from 'fs';
import { resolve } from 'path';

// One full-screen chrome for the whole editor: every takeover renders
// through AppModal (Facet's compact AppModal, on the panel scheme). The
// components are react-native and never render in node, so the contract is
// pinned by source — the shell's chrome itself, and each takeover's use of
// it. The floating CARD modals (rename, tile transform) are a different
// species and deliberately not held to this.

const read = (f: string) =>
  readFileSync(resolve(__dirname, '..', 'components', f), 'utf8');

describe('the unified takeover chrome (AppModal)', () => {
  const shell = read('AppModal.tsx');

  it("is Facet's compact chrome: 18/700 title left, close X right, fade", () => {
    expect(shell).toContain("animationType={page ? 'none' : 'fade'}");
    expect(shell).toMatch(/title:\s*\{\s*fontSize:\s*18,\s*fontWeight:\s*'700'/);
    expect(shell).toContain("accessibilityLabel=\"Close\"");
    // The color picker's hooks: a painted header band with luma-picked ink.
    expect(shell).toContain('headerBackground');
    expect(shell).toContain('headerForeground');
  });

  it('every full-screen takeover renders through it, none roll their own', () => {
    for (const f of ['PatternTileModal.tsx', 'PatternSetsModal.tsx']) {
      const src = read(f);
      expect(src).toContain('<AppModal');
      // No bespoke <Modal> chrome of its own. (Nested card modals like the
      // tile-transform popover are fine — they are not takeover chrome.)
      expect(src).not.toContain('<Modal ');
    }
  });

  it('the Tiles chooser is a PUSHED PAGE: in from the right, out by a chevron', () => {
    // Not a sheet laid over the editor but a screen pushed over it, the
    // shape Settings and Profile have. It still takes no safeTop, so no
    // host can hand it a taller chrome.
    const tiles = read('PatternTileModal.tsx');
    expect(tiles).not.toContain('safeTop');
    expect(tiles).toContain('<AppModal visible={visible} title="Tiles" onClose={onClose} page>');
    const bars = read('PatternBars.tsx');
    const at = bars.indexOf('<PatternTileModal');
    expect(bars.slice(at, bars.indexOf('/>', at))).not.toContain('safeTop');
    // The Sets takeover still seats on the toolbar, band and all.
    expect(bars.match(/safeTop=\{model\.safeTop\}/g)?.length).toBe(1);
    expect(read('PatternSetsModal.tsx')).not.toContain('floatingClose');
    expect(read('PatternSetsModal.tsx')).not.toContain(' page>');
  });

  it('the pushed page slides in from the right and outlives its own flag', () => {
    // A modal unmounted the frame `visible` drops takes its exit
    // animation with it, so the slide drives a `mounted` flag the Modal
    // reads instead.
    expect(shell).toContain('page = false,');
    expect(shell).toContain('visible={page ? mounted : visible}');
    expect(shell).toContain('toValue: visible ? 0 : 1,');
    expect(shell).toContain('easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),');
    expect(shell).toContain('transform: [{ translateX: pageX }] }');
    // Held against the two things it is built from: a fresh animated node
    // every render would be attached and torn down mid-slide.
    expect(shell).toContain('useMemo(() => Animated.multiply(slide, width), [slide, width])');
    expect(shell).toContain('if (finished && !visible) setMounted(false);');
    // A transform alone, so the travel runs off the JS thread — the
    // canvas underneath is still drawing.
    expect(shell).toContain('useNativeDriver: true,');
  });

  it('…and is headed by the chevron, with no X and no Done beside it', () => {
    // Going back IS the confirmation on a page whose picks take effect as
    // they are made; a Done button sat there like a decision still to be
    // taken.
    expect(shell).toContain('name="chevron-left"');
    expect(shell).toContain("accessibilityLabel={'Back from ' + title}");
    expect(shell).toContain('{page || floatingClose ? null : (');
    expect(shell).toContain('{floatingClose && !page ? (');
    const tiles = read('PatternTileModal.tsx');
    expect(tiles).not.toContain('AppModalDoneButton');
    expect(tiles).not.toContain('doneWrap');
  });

  it('the headerless variant floats the X over the body and keeps the title for a11y', () => {
    // No band means no bottom hairline to rule the title off from the
    // content, and no <Text> carrying the title — so the screen takes it as
    // its accessibility label instead.
    expect(shell).toContain('floatingClose = false,');
    expect(shell).toContain('accessibilityLabel={floatingClose && !page ? title : undefined}');
    expect(shell).toContain(
      '<View style={[styles.body, floatingClose && !page ? { paddingTop: safeTop } : null]}>',
    );
    expect(shell).toMatch(/floatingClose:\s*\{\s*position:\s*'absolute',/);
    // The chip is filled with the sheet's own surface so the X stays
    // legible over whatever scrolls beneath it.
    expect(shell).toContain('backgroundColor: PANEL_BG,');
  });

  it('carries the standard Done button, in the Set Color layout', () => {
    // AppModalDoneButton is THE way out of a takeover whose picks don't
    // dismiss it: full content width, 44pt, bold 15 label, the selection
    // blue with white ink.
    expect(shell).toContain('export function AppModalDoneButton(');
    expect(shell).toContain("accessibilityLabel=\"Done\"");
    expect(shell).toMatch(/done:\s*\{\s*marginTop:\s*20,\s*height:\s*44,\s*borderRadius:\s*10,/);
    expect(shell).toContain('backgroundColor: STATE_ACTIVE,');
    expect(shell).toContain("doneLabel: { fontSize: 15, fontWeight: '700', color: '#fff' }");
    // …and in its FLOATING form — riding over a scrolling body rather than
    // sitting in the flow under it — the same button becomes a capsule
    // (height 44 → radius 22) and drops the top margin the flow needed.
    expect(shell).toContain("doneFloating: { marginTop: 0, borderRadius: 22 }");
  });

  it('the pick grids keep their page up, and each has ONE way out', () => {
    // A pick is not a dismissal: the Tiles page no longer excuses itself
    // after the double-tap window (the old setTimeout(onClose, …) exit).
    // The Sets takeover stands the shared Done at its foot; the Tiles
    // page has no Done at all — it goes back by its chevron, which is
    // where its onClose now lives (in AppModal, not in the grid).
    expect(read('PatternSetsModal.tsx')).toContain('<AppModalDoneButton onPress={onClose} />');
    for (const f of ['PatternTileModal.tsx', 'PatternSetsModal.tsx']) {
      const src = read(f);
      expect(src).toContain('onClose={onClose}');
      expect(src).not.toContain('setTimeout(onClose');
    }
  });
});
