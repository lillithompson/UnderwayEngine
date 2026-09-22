import { readFileSync } from 'fs';
import { resolve } from 'path';
import { svgEditOptions, SVG_EDIT_OPTIONS } from '../logic/svgEdit';
import {
  BAR_CUSHION, CONTENT_PAD, GROUP_GAP, GROUP_PAD, ROW_GAP, ROW_SEGMENTED, ROW_SLIDER,
  SECTION_TABS_ROW, pageIsWelled, rowGroupHeight, submenuHeight,
} from '../logic/submenuHeight';
import {
  COPIES_MAX, COPIES_MIN, DEFAULT_COPIES, OFFSET_MAX, ROTATE_MAX, ROTATE_MIN, SCALE_MAX, SCALE_MIN,
  copiesSeededFrom, copyInkStep, rememberedCopies,
} from '../logic/transform';

// The Copies page (the 'transform' page — its key predates the rename):
// every vector subtype's last option — Create copies with a count, a
// position offset, a scale and a rotation offset, the settings paired two
// to a row. The object's own rotation is not on it.

const read = (file: string) => readFileSync(resolve(__dirname, '..', 'components', file), 'utf8');

describe('the Copies option', () => {
  it('is on every vector subtype, last, with one label and glyph', () => {
    for (const options of Object.values(SVG_EDIT_OPTIONS)) {
      const last = options[options.length - 1];
      expect(last).toEqual({ action: 'transform', label: 'Copies', icon: 'content-copy' });
    }
    expect(svgEditOptions('line').map((o) => o.action))
      .toEqual(['stroke', 'endpoints', 'effects', 'opacity', 'transform']);
  });

  it('stands as ONE tabbed section and a button row — no rotation row, and no well', () => {
    // The group's own padding is counted, and the group is spaced from the
    // button below it by GROUP_GAP, wider than the gap between bare rows.
    expect(rowGroupHeight([ROW_SLIDER, ROW_SLIDER])).toBe(GROUP_PAD * 2 + ROW_SLIDER * 2 + ROW_GAP);
    // Its group IS its box, so the sheet draws no well around it — that
    // framed the section twice — and the height counts none of the well's
    // padding.
    expect(pageIsWelled('transform')).toBe(false);
    // The box is ONE section with tabs: its row of tabs and the two sliders
    // the lit tab shows. Every face stands the same height, so the page is
    // one number and never resizes under a tab press.
    // The tab strip heads the box flush, so it is counted at
    // SECTION_TABS_ROW — its height less the gap it puts padding in place of.
    const tabbed = rowGroupHeight([SECTION_TABS_ROW, ROW_SLIDER, ROW_SLIDER]);
    expect(submenuHeight('transform', {}))
      .toBe(BAR_CUSHION + tabbed + ROW_SEGMENTED + GROUP_GAP);
    expect(GROUP_GAP).toBeGreaterThan(ROW_GAP);
    // Every other page keeps the well, and is measured with its padding.
    expect(pageIsWelled('opacity')).toBe(true);
    expect(submenuHeight('opacity', {})).toBe(CONTENT_PAD * 2 + BAR_CUSHION + ROW_SLIDER * 2 + ROW_GAP);
    // The sheet asks the same predicate the arithmetic does, so a page
    // cannot be measured one way and drawn the other.
    const panel = read('ObjectPropertiesPanel.tsx');
    expect(panel).toContain('welled={!displaySub || pageIsWelled(displaySub)}');
    const sheet = readFileSync(resolve(__dirname, '..', 'components', 'EditSheet.tsx'), 'utf8');
    expect(sheet).toContain('<View style={welled ? styles.well : styles.bare}>{content}</View>');
    expect(sheet).toContain('bare: { marginTop: SHEET_CONTENT_TOP },');
  });
});

describe('the Copies page', () => {
  const SRC = read('TransformBar.tsx');

  it('keeps the copies request sane', () => {
    expect([ROTATE_MIN, ROTATE_MAX]).toEqual([-180, 180]);
    // The count runs down to none: the page opens at 0 and a press with 0
    // lays down nothing, so a fresh page never mints copies by surprise.
    expect(COPIES_MIN).toBe(0);
    expect(COPIES_MAX).toBeGreaterThanOrEqual(12);
    expect(OFFSET_MAX).toBeGreaterThan(0);
    expect(DEFAULT_COPIES.count).toBe(0);
    // Scale is a per-copy factor either side of 1, and a fresh page keeps
    // the copies the original's size.
    expect(SCALE_MIN).toBeLessThan(1);
    expect(SCALE_MAX).toBeGreaterThan(1);
    expect(DEFAULT_COPIES).toMatchObject({ sx: 1, sy: 1 });
    // …and the ink a run ENDS on, which a bar told the object's own seeds
    // from it instead: solid and unfaded, where almost every object stands.
    expect(DEFAULT_COPIES).toMatchObject({ finalFade: 0, finalOpacity: 1 });
    expect(copiesSeededFrom({ opacity: 0.4, fade: 0.25 }))
      .toMatchObject({ finalFade: 0.25, finalOpacity: 0.4 });
    expect(copiesSeededFrom()).toEqual(DEFAULT_COPIES);
  });

  it('the ink sliders name the LAST copy, and the run walks there in even steps', () => {
    // A per-copy step made the reader do the division: "how much fainter is
    // each one" cannot be pictured, while "how faint is the last one" is the
    // thing being looked at. So the step falls out of the count — twelve
    // copies to the same end is a gentler dissolve than three, not a longer
    // one past it.
    expect(copyInkStep(0, 1, 4)).toBeCloseTo(0.25, 9);
    expect(copyInkStep(0, 1, 8)).toBeCloseTo(0.125, 9);
    expect(copyInkStep(0.5, 1, 2)).toBeCloseTo(0.25, 9);
    // A run that ends where it started moves nothing, and a run of none has
    // no step to take.
    expect(copyInkStep(0.4, 0.4, 6)).toBe(0);
    expect(copyInkStep(0, 1, 0)).toBe(0);
  });

  it('the copy settings are the page’s own draft; the object’s rotation is not here', () => {
    // Seeded from the object's own ink at the OPEN, so the Color tab's two
    // sliders start under the values the object already carries and a press
    // with nothing touched lays copies that look like it.
    expect(SRC).toContain(
      'const [copies, setCopies] = useState<TransformCopiesSpec>(() => copiesSeededFrom(ink, sticky));',
    );
    expect(SRC).not.toContain('label="Rotation"');
    expect(SRC).not.toContain('onRotate');
    expect(SRC).not.toContain('TransformModel');
    // Eight sliders, a line each, in four groups of two: the count beside
    // the turn, then the offsets, the scales and the ink. They shared a
    // line per pair before, which halved every track and set two readouts
    // fighting for the width.
    for (const label of [
      'Offset X', 'Offset Y', 'Scale X', 'Scale Y', 'Copies', 'Rotation offset',
      'Fade', 'Opacity',
    ]) {
      expect(SRC).toContain(`label="${label}"`);
    }
    // Seven plain sliders and one FADE row: the Color tab wears the Opacity
    // page's own two rows — the checkered opacity ramp, and the fade's walk
    // from the object's ink to the target, ending in the circle that picks
    // it — because those are the rows this tab is about.
    expect(SRC.match(/<SliderRow/g)).toHaveLength(7);
    expect(SRC.match(/<FadeSliderRow/g)).toHaveLength(1);
    expect(SRC).toContain('value={copies.finalOpacity}\n              checker');
    expect(SRC).toContain('color={fadeColor}');
    expect(SRC).toContain('from={fadeInk}');
    expect(SRC).not.toContain('<DualSliderRow');
    // All four pairs SHARE one box, its tabs switching which shows (the
    // panel holds which, so the sheet's height is one number known before
    // the render). Copies leads: it is what a press lays down.
    expect(SRC.match(/<RowGroup>/g)).toHaveLength(1);
    expect(SRC).not.toContain('CollapsibleRowGroup');
    // …and they head that box as one solid line, edge to edge, rather than
    // floating in it as a control: they say which pair you are looking at,
    // not what any setting is.
    expect(SRC).toContain('<SectionTabs');
    expect(SRC).toContain('options={SECTIONS}');
    expect(SRC).toContain('pad={GROUP_PAD}');
    expect(SRC).toContain('radius={SECTION_TABS_GROUP_RADIUS}');
    expect(SRC).not.toContain('<SegmentedRow');
    expect(SRC).toContain("{ value: 'copies' as const, label: 'Copies' },");
    expect(SRC).toContain("{ value: 'offset' as const, label: 'Offset' },");
    expect(SRC).toContain("{ value: 'scale' as const, label: 'Scale' },");
    // …and what each copy is MADE of, which is the other way a run reads
    // as a run: a shape stepping across the page and dissolving as it
    // goes says "was here, and here, and is here now".
    expect(SRC).toContain("{ value: 'color' as const, label: 'Color' },");
    expect(SRC.indexOf("label: 'Scale'")).toBeLessThan(SRC.indexOf("label: 'Color'"));
    expect(SRC.indexOf("label: 'Copies'")).toBeLessThan(SRC.indexOf("label: 'Offset'"));
    expect(SRC).toContain("{section === 'copies' ? (");
    const panelSrc = read('ObjectPropertiesPanel.tsx');
    expect(panelSrc).toContain("const [copiesSection, setCopiesSection] = useState<CopiesSection>('copies');");
    expect(panelSrc).toContain('section={copiesSection}');
    expect(panelSrc).toContain('onSection={setCopiesSection}');
    // Nothing about the page's height depends on which face shows.
    expect(readFileSync(resolve(__dirname, '..', 'logic', 'submenuHeight.ts'), 'utf8'))
      .not.toContain('copiesOffsetOpen');
    // Each reads out in its own unit.
    expect(SRC).toContain("readout={{ text: factorText(copies.sx), commit: (n) => set({ sx: clamp(n / 100, SCALE_MIN, SCALE_MAX) }) }}");
    expect(SRC).toContain("readout={{ text: factorText(copies.sy), commit: (n) => set({ sy: clamp(n / 100, SCALE_MIN, SCALE_MAX) }) }}");
    expect(SRC).toContain("onPress={() => onCopies(copies)}");
    // "Create", not "Create copies": the page is Copies and the slider
    // above says how many, so the button naming them again repeated them.
    expect(SRC).toContain('label="Create"');
    expect(SRC).not.toContain('label="Create copies"');
    // It is the Add pages' button — the page's one ACT, the same kind of
    // thing "Add Fill" is, so it takes the same shape: full width, a
    // segmented row tall, the word in ink behind a plus. A one-cell
    // ActionRow (the shape the pages use for CHOOSING between states) read
    // as a setting with a single option.
    expect(SRC).toContain('<EffectButton label="Create" onPress={() => onCopies(copies)} />');
    expect(SRC).not.toContain('<ActionRow');
    expect(SRC).not.toContain('CREATE_OPTION');
    // The button stands without a label column: a "Copies" beside it
    // clashed with the Copies SLIDER above — which is the count this
    // button acts on. It sits BELOW the three groups, on the bare well:
    // it is the thing they describe, not one more of them.
    expect(SRC.indexOf('<EffectButton')).toBeGreaterThan(SRC.lastIndexOf('</RowGroup>'));
    // Same height as the row it replaced, so the page's arithmetic (a
    // ROW_SEGMENTED under the tabbed box) still measures what is drawn.
    expect(read('effectBar.tsx')).toContain('emptyControls: { height: ROW_SEGMENTED, flexDirection: \'row\' },');
    // The group's chrome is the shared one, counted by the same metrics.
    const bar = read('effectBar.tsx');
    expect(bar).toContain('export function RowGroup(');
    expect(bar).toContain('export function GroupedBody(');
    expect(bar).toMatch(/group: \{\s*padding: GROUP_PAD,[^}]*backgroundColor: PANEL_GROUP_WELL/s);
    expect(bar).toMatch(/groupedRows: \{ gap: GROUP_GAP \}/);
  });

  it('remembers every setting but the count, from one object to the next', () => {
    // The ask: dial an offset and a turn once and the page opens on them
    // again, whatever shape is selected next. The count does NOT travel —
    // it says what THIS press lays down, and a page re-opening at six
    // would mint six copies from a button that was never touched.
    const sticky = rememberedCopies({}, { dx: 2.5, dAngleDeg: 90, count: 6 });
    expect(sticky).toEqual({ dx: 2.5, dAngleDeg: 90 });
    expect(sticky).not.toHaveProperty('count');
    expect(copiesSeededFrom(undefined, sticky))
      .toMatchObject({ dx: 2.5, dAngleDeg: 90, count: DEFAULT_COPIES.count });
    // Later changes fold in beside the earlier ones rather than replacing
    // them, so a scale set on one shape joins the offset set on another.
    expect(rememberedCopies(sticky, { sx: 1.2, sy: 1.2 }))
      .toEqual({ dx: 2.5, dAngleDeg: 90, sx: 1.2, sy: 1.2 });
  });

  it('lets the SELECTED object seat any ink slider that was never moved', () => {
    // Fade and opacity are absolute values about the object in hand, not
    // about copying: carrying the last object's across would quietly fade a
    // run nobody asked to fade. So they stick only once MOVED — an
    // untouched key isn't in the memory at all, and the seed wins.
    const untouched = rememberedCopies({}, { dx: 3 });
    expect(copiesSeededFrom({ opacity: 0.4, fade: 0.25 }, untouched))
      .toMatchObject({ dx: 3, finalOpacity: 0.4, finalFade: 0.25 });
    // …and once moved, it travels like everything else.
    const touched = rememberedCopies(untouched, { finalFade: 0.8 });
    expect(copiesSeededFrom({ opacity: 0.4, fade: 0.25 }, touched))
      .toMatchObject({ finalFade: 0.8, finalOpacity: 0.4 });
    // No memory at all is the page as it always opened.
    expect(copiesSeededFrom()).toEqual(DEFAULT_COPIES);
    expect(copiesSeededFrom(undefined, {})).toEqual(DEFAULT_COPIES);
  });

  it('remembers a level up, so the memory outlives the page and the selection', () => {
    // The bar is seeded per mount and unmounts with the page, so the
    // memory cannot live in it. The PANEL holds it, exactly where it
    // already holds which face shows.
    expect(SRC).toContain('sticky?: StickyCopies;');
    expect(SRC).toContain('onSticky?: (patch: Partial<TransformCopiesSpec>) => void;');
    // Reported as the patch the control wrote — that is what makes
    // "touched" mean the keys a slider actually set.
    expect(SRC).toContain('stickyRef.current?.(patch);');
    const panel = read('ObjectPropertiesPanel.tsx');
    expect(panel).toContain('const [copiesSticky, setCopiesSticky] = useState<StickyCopies>({});');
    expect(panel).toContain('sticky={copiesSticky}');
    expect(panel).toContain('onSticky={(patch) => setCopiesSticky((s) => rememberedCopies(s, patch))}');
    // Next to the section it lives beside, not inside the bar.
    expect(SRC).not.toContain('useState<StickyCopies>');
  });

  it('reports the copies draft live — on mount, on every change, and null as it unmounts', () => {
    expect(SRC).toContain('onCopiesPreview?: (spec: TransformCopiesSpec | null) => void;');
    // Keyed on the draft alone, through a ref, so a host's fresh closure
    // each render never re-announces an unchanged draft.
    expect(SRC).toContain('const previewRef = useRef(onCopiesPreview);');
    expect(SRC).toContain('useEffect(() => { previewRef.current?.(copies); }, [copies]);');
    expect(SRC).toContain('useEffect(() => () => { previewRef.current?.(null); }, []);');
    // The press itself is not a preview.
    expect(SRC).not.toContain('onCopiesPreview?.(copies)');
  });

  // Tapping Copies on a TEXT flickered the tab on and off for as long as
  // it was looked at: the page opened, the fold-away closed it on the next
  // render for not being a vector, the landing rule re-opened the
  // remembered page, and round it went. The tab row offers Copies to an
  // image and a text as well as to every vector — so the guard has to ask
  // the same question the tab row asks, not "is this a vector".
  it('folds away on what the TAB ROW offers, not on the vector flag', () => {
    const panel = read('ObjectPropertiesPanel.tsx');
    expect(panel).toContain('const transformable = typeSubmenuOrder.includes(\'transform\');');
    // The reading this bug forced is now the panel's ONLY fold-away rule,
    // for every page: a page closes when the row it rides stops listing
    // it. Six hand-written per-page answers to that question became one
    // derived from the row itself, so a page and its tab can no longer
    // disagree — and this loop is no longer sayable for any of them.
    const fold = panel.slice(
      panel.indexOf('  // ── The one fold-away rule'),
      panel.indexOf('  // Seed the effect / border drafts'),
    );
    expect(fold).toContain('if (!activeSubRef.current) return;');
    expect(fold).toContain('isHostOnlyPage(activeSubRef.current) || orderRef.current.includes(activeSubRef.current)');
    expect(fold).toContain('dismissSubmenuRef.current();');
    expect(fold).toContain("}, [model.visible, activeSub, submenuOrder.join('|')]);");
    // No per-page predicate survives in it, the vector-only flag least of
    // all: that flag is read only where the vector branch builds its tabs.
    expect(fold).not.toContain('svgTransformable');
    expect(fold).not.toContain('model.transformOpen');
    expect(panel.match(/svgTransformable/g)).toHaveLength(2); // its decl and the svg branch
  });

  // The kinds that carry the tab, from the tab order itself: if one of
  // these ever stops listing 'transform', `transformable` follows it and
  // the guard stays honest — that is the whole point of deriving it.
  it('an image, a text and a vector all list Copies', () => {
    const panel = read('ObjectPropertiesPanel.tsx');
    const order = panel.slice(
      panel.indexOf('  const kindSubmenuOrder: SubmenuKey[] ='),
      panel.indexOf('  const transformable ='),
    );
    const branch = (from: string, to: string) => order.slice(order.indexOf(from), order.indexOf(to));
    expect(branch('model.showImageEdit ?', 'model.showFrameOptions')).toContain("'transform'");
    expect(branch('model.showTextStyle ?', 'model.showInvert ?')).toContain("'transform'");
    expect(branch('model.showSvgOptions', '    : [];')).toContain("'transform'");
    // …and the kinds that do NOT: a word sticker and a paint island.
    expect(branch('model.showInvert ?', 'model.showPaintOptions')).not.toContain("'transform'");
  });

  // A GROUP's row carried the tab (its members share a kind, so it rode
  // that kind's order) and the page stood down for a multi-selection: the
  // tab lit nothing and copied nothing. A group is copied as a group now,
  // so the tab is offered on the SELECTION's own account too — which is
  // also what gives a mixed group, with no kind row at all, a Copies page.
  it('offers Copies to a multi-selection, once, whatever its members are', () => {
    const panel = read('ObjectPropertiesPanel.tsx');
    expect(panel).toContain('const showCopies = multi && !!model.onTransformCopies;');
    // Appended to the tab order only where the kind's own order has none,
    // so a uniform selection's row shows it once and in its usual place.
    expect(panel).toContain("const typeSubmenuOrder: SubmenuKey[] = showCopies && !kindSubmenuOrder.includes('transform')");
    expect(panel).toContain("if (showCopies && !typeSpecs?.some((spec) => spec.key === 'transform')) {");
    // …and it counts as a type option, so a mixed group's sheet opens at
    // all rather than being a panel with nothing on it.
    expect(panel).toContain('|| showUngroup || showCopies;');
    // The signature the landing rule re-lands on knows about it: a
    // selection that gains the tab re-seats the sheet.
    expect(panel).toContain("${showCopies ? 'c' : ''}");
  });

  it('is wired into the panel like its sibling pages, and the model carries no rotation', () => {
    const panel = read('ObjectPropertiesPanel.tsx');
    expect(panel).toContain("...(svgTransformable ? (['transform'] as const) : []),");
    expect(panel).toContain(": model.transformOpen ? 'transform'");
    expect(panel).toContain("else if (key === 'transform') model.onTransformOpenChange?.(true);");
    expect(panel).not.toContain('onTransformRotate');
    expect(panel).toContain("onCopies={(spec) => model.onTransformCopies?.(spec)}");
    expect(panel).toContain("onCopiesPreview={(spec) => model.onTransformCopiesPreview?.(spec)}");
    // The Color tab's rows are fed the object's own ink and the same fade
    // picker the Opacity page opens — straight off the model, never the
    // Opacity page's draft, which re-bases fade to the left.
    expect(panel).toContain('ink={model.objectOpacity}');
    expect(panel).toContain('fadeColor={model.onPickFadeColor ? fadeTarget : undefined}');
    expect(panel).toContain('fadeInk={fadeInk}');
    // Closing reaches it through the one closer every page closes by —
    // which is also what the fold-away calls, so there is exactly one.
    expect(panel).toContain('model.onTransformOpenChange?.(false);');
    expect(panel.match(/model\.onTransformOpenChange\?\.\(false\);/g)).toHaveLength(1);
    const adapter = readFileSync(resolve(__dirname, '..', 'adapter.ts'), 'utf8');
    expect(adapter).not.toContain('TransformModel');
    expect(adapter).not.toContain('onTransformRotate');
  });
});
