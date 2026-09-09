import { readFileSync } from 'fs';
import { resolve } from 'path';
import { svgEditOptions, SVG_EDIT_OPTIONS } from '../logic/svgEdit';
import { submenuHeight } from '../logic/submenuHeight';
import { COPIES_MAX, COPIES_MIN, DEFAULT_COPIES, OFFSET_MAX, ROTATE_MAX, ROTATE_MIN } from '../logic/transform';

// The Transform bar: every vector subtype's last option — Rotation, and
// Create copies with a count, a position offset and a rotation offset.

const read = (file: string) => readFileSync(resolve(__dirname, '..', 'components', file), 'utf8');

describe('the Transform option', () => {
  it('is on every vector subtype, last, with one label and glyph', () => {
    for (const options of Object.values(SVG_EDIT_OPTIONS)) {
      const last = options[options.length - 1];
      expect(last).toEqual({ action: 'transform', label: 'Transform', icon: 'rotate-right' });
    }
    expect(svgEditOptions('line').map((o) => o.action)).toEqual(['stroke', 'endpoints', 'transform']);
  });

  it('has a bar height of five sliders and a button row', () => {
    expect(submenuHeight('transform', {})).toBeGreaterThan(submenuHeight('endpoints', {}));
    expect(submenuHeight('transform', {})).toBeGreaterThan(submenuHeight('stroke', { strokeRows: { radius: true, position: true } }));
  });
});

describe('the Transform bar', () => {
  const SRC = read('TransformBar.tsx');

  it('turns the full circle and keeps the copies request sane', () => {
    expect([ROTATE_MIN, ROTATE_MAX]).toEqual([-180, 180]);
    // The count runs down to none: the bar opens at 0 and a press with 0
    // lays down nothing, so a fresh bar never mints copies by surprise.
    expect(COPIES_MIN).toBe(0);
    expect(COPIES_MAX).toBeGreaterThanOrEqual(12);
    expect(OFFSET_MAX).toBeGreaterThan(0);
    expect(DEFAULT_COPIES.count).toBe(0);
  });

  it('rotation is live-then-commit on the object; the copy settings are the bar’s own draft', () => {
    expect(SRC).toContain('apply={(t, c) => onRotate(fromT(t, ROTATE_MIN, ROTATE_MAX), c)}');
    expect(SRC).toContain('const [copies, setCopies] = useState<TransformCopiesSpec>(DEFAULT_COPIES);');
    for (const label of ['"Rotation"', '"Copies"', '"Offset X"', '"Offset Y"', '"Rotation offset"']) {
      expect(SRC).toContain(`label=${label}`);
    }
    expect(SRC).toContain("onPress={() => onCopies(copies)}");
    expect(SRC).toContain("label: 'Create copies'");
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

  it('is wired into the panel like its sibling bars', () => {
    const panel = read('ObjectPropertiesPanel.tsx');
    expect(panel).toContain("...(svgTransformable ? (['transform'] as const) : []),");
    expect(panel).toContain(": model.transformOpen ? 'transform'");
    expect(panel).toContain("else if (key === 'transform') model.onTransformOpenChange?.(true);");
    expect(panel).toContain("onRotate={(deg, committed) => model.onTransformRotate?.(deg, committed)}");
    expect(panel).toContain("onCopies={(spec) => model.onTransformCopies?.(spec)}");
    expect(panel).toContain("onCopiesPreview={(spec) => model.onTransformCopiesPreview?.(spec)}");
    // Dismiss and fold-away reach it too.
    expect(panel.match(/model\.onTransformOpenChange\?\.\(false\);/g)!.length).toBeGreaterThanOrEqual(2);
  });
});
