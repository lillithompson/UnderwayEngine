import { readFileSync } from 'fs';
import { resolve } from 'path';
import { hueRampColors } from '../logic/hsv';

// The colour swatch when the brush in hand does not lay the armed colour.
// Two shapes, one wheel: SOLID under a Random blend, which deposits a
// colour that walks as the stroke goes, and a RING — the wheel with its
// middle out — under Rotate, which deposits nothing of its own and spins
// the hue already under the dab. No renderer here; the fills are pinned
// at the source, as the other panel suites do.

const SWATCH = readFileSync(resolve(__dirname, '..', 'components', 'ColorSwatch.tsx'), 'utf8');
const TOPBAR = readFileSync(resolve(__dirname, '..', 'components', 'TopBar.tsx'), 'utf8');
const ADAPTER = readFileSync(resolve(__dirname, '..', 'adapter.ts'), 'utf8');

describe('the rainbow swatch', () => {
  it('is asked for by shape, not by a boolean — one field cannot name two', () => {
    expect(ADAPTER).toContain("export type SwatchRainbow = 'wheel' | 'ring';");
    expect(ADAPTER).toContain('swatchRainbow?: SwatchRainbow;');
    expect(TOPBAR).toContain('rainbow={tool.swatchRainbow}');
    const glyph = TOPBAR.slice(TOPBAR.indexOf('function SwatchGlyph('), TOPBAR.indexOf('function ToolGlyph('));
    expect(glyph).toContain("rainbow === 'ring' ? <RainbowRingFill size={size} />");
    expect(glyph).toContain("rainbow === 'wheel' ? <RainbowSwatchFill />");
    expect(glyph).toContain('<ColorSwatchFill color={color} />');
  });

  it('draws both shapes from ONE ramp — the hue slider\'s own', () => {
    // Two rainbows for one wheel drift the moment either is touched.
    expect(SWATCH.match(/hueRampColors\(\)/g)).toHaveLength(1);
    expect(SWATCH).toContain('function HueRampFill() {');
    expect(SWATCH).toContain('export function RainbowSwatchFill() {\n  return <HueRampFill />;');
    expect(SWATCH).toContain('<HueRampFill />\n      <View');
    // …and the ramp is a real gradient list, so the fill has something to
    // interpolate between rather than one flat colour.
    expect(hueRampColors().length).toBeGreaterThan(2);
  });

  it('punches the ring\'s hole with a painted disc, centred, on the surface it sits on', () => {
    // A gradient cannot be masked with the primitives this package draws
    // in, so the hole is painted — and it wears the toolbar's own
    // background unless a caller on another surface names one.
    expect(SWATCH).toContain(
      'export function RainbowRingFill({ size, hole = HEADER_BG }: { size: number; hole?: string }) {',
    );
    expect(SWATCH).toContain('const band = Math.max(2, Math.round(size * RING_BAND));');
    for (const side of ['top', 'left', 'right', 'bottom']) {
      expect(SWATCH).toContain(`${side}: band,`);
    }
    expect(SWATCH).toContain('borderRadius: Math.max(0, size - band * 2) / 2,');
    expect(SWATCH).toContain('backgroundColor: hole,');
    // The band leaves a hole at the size the toolbar draws the swatch
    // (ICON_SIZE - 4 = 24): a ring, not a disc with a dot missing.
    const band = Math.max(2, Math.round(24 * 0.3));
    expect(24 - band * 2).toBeGreaterThan(4);
    expect(band).toBeGreaterThan(2);
  });
});
