import { readFileSync } from 'fs';
import { resolve } from 'path';
import { svgEditOptions, SVG_EDIT_OPTIONS } from '../logic/svgEdit';
import {
  BAR_CUSHION, CONTENT_PAD, GROUP_GAP, GROUP_PAD, ROW_GAP, ROW_SEGMENTED, ROW_SLIDER,
  pageIsWelled, rowGroupHeight, submenuHeight,
} from '../logic/submenuHeight';
import {
  COPIES_MAX, COPIES_MIN, DEFAULT_COPIES, OFFSET_MAX, ROTATE_MAX, ROTATE_MIN, SCALE_MAX, SCALE_MIN,
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
      .toEqual(['stroke', 'endpoints', 'shadow', 'opacity', 'transform']);
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
    const tabbed = rowGroupHeight([ROW_SEGMENTED, ROW_SLIDER, ROW_SLIDER]);
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
  });

  it('the copy settings are the page’s own draft; the object’s rotation is not here', () => {
    expect(SRC).toContain('const [copies, setCopies] = useState<TransformCopiesSpec>(DEFAULT_COPIES);');
    expect(SRC).not.toContain('label="Rotation"');
    expect(SRC).not.toContain('onRotate');
    expect(SRC).not.toContain('TransformModel');
    // Six sliders, a line each, in three groups of two: the count beside
    // the turn, then the offsets and the scales. They shared a line per
    // pair before, which halved every track and set two readouts fighting
    // for the width.
    for (const label of ['Offset X', 'Offset Y', 'Scale X', 'Scale Y', 'Copies', 'Rotation offset']) {
      expect(SRC).toContain(`label="${label}"`);
    }
    expect(SRC.match(/<SliderRow/g)).toHaveLength(6);
    expect(SRC).not.toContain('<DualSliderRow');
    // All three pairs SHARE one box, its tabs switching which shows (the
    // panel holds which, so the sheet's height is one number known before
    // the render). Copies leads: it is what a press lays down.
    expect(SRC.match(/<RowGroup>/g)).toHaveLength(1);
    expect(SRC).not.toContain('CollapsibleRowGroup');
    expect(SRC).toContain('<SegmentedRow options={SECTIONS} value={section} onChange={onSection} />');
    expect(SRC).toContain("{ value: 'copies' as const, label: 'Copies' },");
    expect(SRC).toContain("{ value: 'offset' as const, label: 'Offset' },");
    expect(SRC).toContain("{ value: 'scale' as const, label: 'Scale' },");
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
    expect(SRC).toContain("label: 'Create'");
    expect(SRC).not.toContain("label: 'Create copies'");
    // The button stands without a label column: a "Copies" beside it
    // clashed with the Copies SLIDER above — which is the count this
    // button acts on. It sits BELOW the three groups, on the bare well:
    // it is the thing they describe, not one more of them.
    expect(SRC).toContain('<ActionRow options={CREATE_OPTION} onPress={() => onCopies(copies)} />');
    expect(SRC.indexOf('<ActionRow')).toBeGreaterThan(SRC.lastIndexOf('</RowGroup>'));
    // The group's chrome is the shared one, counted by the same metrics.
    const bar = read('effectBar.tsx');
    expect(bar).toContain('export function RowGroup(');
    expect(bar).toContain('export function GroupedBody(');
    expect(bar).toMatch(/group: \{\s*padding: GROUP_PAD,[^}]*backgroundColor: PANEL_GROUP_WELL/s);
    expect(bar).toMatch(/groupedRows: \{ gap: GROUP_GAP \}/);
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
    const fold = panel.slice(
      panel.indexOf('    if ((!model.visible || !strokeable) && model.strokeOpen) {'),
      panel.indexOf('  // Fold the Layout page away'),
    );
    expect(fold).toContain('if ((!model.visible || !transformable) && model.transformOpen) {');
    // The vector-only flag is gone from the guard AND from its deps, or the
    // effect would go on running against the old question.
    expect(fold).not.toContain('svgTransformable');
    expect(panel).toContain('svgEndable, model.endpointsOpen, transformable, model.transformOpen]);');
    // svgTransformable still says what it always said — which vectors
    // repeat — and is read only where the vector branch builds its tabs.
    expect(panel.match(/svgTransformable/g)).toHaveLength(3); // decl, the svg branch, the note
  });

  // The kinds that carry the tab, from the tab order itself: if one of
  // these ever stops listing 'transform', `transformable` follows it and
  // the guard stays honest — that is the whole point of deriving it.
  it('an image, a text and a vector all list Copies', () => {
    const panel = read('ObjectPropertiesPanel.tsx');
    const order = panel.slice(
      panel.indexOf('  const typeSubmenuOrder: SubmenuKey[] ='),
      panel.indexOf('  const transformable ='),
    );
    const branch = (from: string, to: string) => order.slice(order.indexOf(from), order.indexOf(to));
    expect(branch('model.showImageEdit ?', 'model.showFrameOptions')).toContain("'transform'");
    expect(branch('model.showTextStyle ?', 'model.showInvert ?')).toContain("'transform'");
    expect(branch('model.showSvgOptions', '    : [];')).toContain("'transform'");
    // …and the kinds that do NOT: a word sticker and a paint island.
    expect(branch('model.showInvert ?', 'model.showPaintOptions')).not.toContain("'transform'");
  });

  it('is wired into the panel like its sibling pages, and the model carries no rotation', () => {
    const panel = read('ObjectPropertiesPanel.tsx');
    expect(panel).toContain("...(svgTransformable ? (['transform'] as const) : []),");
    expect(panel).toContain(": model.transformOpen ? 'transform'");
    expect(panel).toContain("else if (key === 'transform') model.onTransformOpenChange?.(true);");
    expect(panel).not.toContain('onTransformRotate');
    expect(panel).toContain("onCopies={(spec) => model.onTransformCopies?.(spec)}");
    expect(panel).toContain("onCopiesPreview={(spec) => model.onTransformCopiesPreview?.(spec)}");
    // Dismiss and fold-away reach it too.
    expect(panel.match(/model\.onTransformOpenChange\?\.\(false\);/g)!.length).toBeGreaterThanOrEqual(2);
    const adapter = readFileSync(resolve(__dirname, '..', 'adapter.ts'), 'utf8');
    expect(adapter).not.toContain('TransformModel');
    expect(adapter).not.toContain('onTransformRotate');
  });
});
