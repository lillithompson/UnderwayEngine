import { readFileSync } from 'fs';
import { resolve } from 'path';
import { svgEditOptions, SVG_EDIT_OPTIONS } from '../logic/svgEdit';
import { ROW_GAP, ROW_SEGMENTED, ROW_SLIDER, submenuHeight } from '../logic/submenuHeight';
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
    expect(svgEditOptions('line').map((o) => o.action)).toEqual(['stroke', 'endpoints', 'transform']);
  });

  it('has a page height of three slider rows and a button row — no rotation row', () => {
    // Three doubled rows (offsets, scales, turn + count) and the button.
    // Measured against the Opacity page (two slider rows, same chrome).
    expect(submenuHeight('transform', {}) - submenuHeight('opacity', {}))
      .toBe((ROW_SLIDER + ROW_GAP) + (ROW_SEGMENTED + ROW_GAP));
    expect(submenuHeight('transform', {})).toBeGreaterThan(submenuHeight('endpoints', {}));
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
    // The copy settings pair up: offsets, scales, then the turn beside the
    // count — each half reading out in its own unit.
    for (const [left, right] of [['Offset X', 'Offset Y'], ['Scale X', 'Scale Y'], ['Rotation offset', 'Copies']]) {
      expect(SRC).toContain(`leftLabel="${left}"`);
      expect(SRC).toContain(`rightLabel="${right}"`);
    }
    expect(SRC.match(/<DualSliderRow/g)).toHaveLength(3);
    expect(SRC.match(/<SliderRow/g)).toBeNull();
    expect(SRC).toContain("leftReadout={{ text: factorText(copies.sx), commit: (n) => set({ sx: clamp(n / 100, SCALE_MIN, SCALE_MAX) }) }}");
    expect(SRC).toContain("rightReadout={{ text: factorText(copies.sy), commit: (n) => set({ sy: clamp(n / 100, SCALE_MIN, SCALE_MAX) }) }}");
    expect(SRC).toContain("onPress={() => onCopies(copies)}");
    expect(SRC).toContain("label: 'Create copies'");
    // The button stands without a label column: "Create copies" says it,
    // and a "Copies" beside it clashed with the Copies SLIDER above —
    // which is the count this button acts on.
    expect(SRC).toContain('<ActionRow options={CREATE_OPTION} onPress={() => onCopies(copies)} />');
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
