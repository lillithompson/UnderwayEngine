import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PATTERN_SYMMETRY_ENTRIES, PATTERN_SYMMETRY_OFF_ICON } from '@/editor-ui/logic/patternEdit';
import { SYMMETRY_MODE_ICONS } from '../components/symmetryModalMeta';
import { FLOATING_ROW_TRACK_W } from '../components/floatingRowTrack';

// The three sheets the canvas raises and the row it floats, all four
// byte-identical in the apps that had them before stage 6.5a of
// docs/shared-editor.md.

const SRC = (...parts: string[]) =>
  readFileSync(resolve(__dirname, '..', 'components', ...parts), 'utf8');

describe('SYMMETRY_MODE_ICONS — derived, not restated', () => {
  it('is the grid’s own table, widened by the modal’s leading None cell', () => {
    // A second hand-written table was a second chance for the two pictures
    // of one mode to drift apart.
    expect(Object.keys(SYMMETRY_MODE_ICONS)).toHaveLength(PATTERN_SYMMETRY_ENTRIES.length + 1);
    expect(SYMMETRY_MODE_ICONS.off).toEqual({ icon: PATTERN_SYMMETRY_OFF_ICON });
  });

  it('every grid entry’s glyph is the glyph the grid carries', () => {
    for (const e of PATTERN_SYMMETRY_ENTRIES) {
      expect(SYMMETRY_MODE_ICONS[e.key].icon).toBe(e.icon);
    }
  });

  it('a mirrored mode carries the flag, and an unmirrored one carries no key at all', () => {
    for (const e of PATTERN_SYMMETRY_ENTRIES) {
      if (e.mirrored) expect(SYMMETRY_MODE_ICONS[e.key].mirrored).toBe(true);
      else expect('mirrored' in SYMMETRY_MODE_ICONS[e.key]).toBe(false);
    }
  });

  it('the table is read off the grid at module scope, not written out', () => {
    expect(SRC('symmetryModalMeta.ts')).toContain('PATTERN_SYMMETRY_ENTRIES.map');
  });
});

// Read as text, not imported: a .tsx is typechecked in the three apps,
// where real react-native and the app's own tsconfig are.
describe('the two sheets and the hue row', () => {
  it('each export the one component named after the file', () => {
    expect(SRC('ShapePickerModal.tsx')).toContain('export function ShapePickerModal(');
    expect(SRC('SymmetryModal.tsx')).toContain('export function SymmetryModal(');
    expect(SRC('BrushColorRow.tsx')).toContain('export function BrushColorRow(');
  });

  it('both sheets are the one grid sheet, filled — not two grids', () => {
    for (const f of ['ShapePickerModal.tsx', 'SymmetryModal.tsx']) {
      expect(SRC(f)).toContain(`import { ToolGridSheet, type ToolGridCell } from './ToolGridSheet';`);
    }
  });

  it('the shape sheet takes its default set from the shapes module, overridable per host', () => {
    expect(SRC('ShapePickerModal.tsx')).toContain('shapes = SHAPE_MODAL_SHAPES');
    expect(SRC('ShapePickerModal.tsx')).toMatch(/import \{[\s\S]*?SHAPE_MODAL_SHAPES/);
  });

  it('the hue row stands the height of a bare control, having no caption over it', () => {
    expect(SRC('BrushColorRow.tsx')).toContain('BRUSH_COLOR_ROW_HEIGHT = SLIDER_CONTROL');
  });

  it('the hue row reports live AND on release, so the canvas can paint as it drags', () => {
    expect(SRC('BrushColorRow.tsx')).toContain('onColor: (color: RGBColor, committed: boolean) => void;');
  });

  it('the hue row draws the one track width every floated row reads', () => {
    // DrawBots' Speed row reads the same number; a literal written back
    // out here is the copy that module exists to prevent.
    expect(FLOATING_ROW_TRACK_W).toBe(260);
    expect(SRC('BrushColorRow.tsx')).toContain('const TRACK_W = FLOATING_ROW_TRACK_W;');
    expect(SRC('BrushColorRow.tsx')).not.toMatch(/TRACK_W = d/);
  });

  it('the hue row lets presses through everywhere but its own track', () => {
    expect(SRC('BrushColorRow.tsx')).toContain('pointerEvents="box-none"');
  });
});
