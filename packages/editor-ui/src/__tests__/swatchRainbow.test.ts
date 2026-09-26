import { readFileSync } from 'fs';
import { resolve } from 'path';
import { RANDOM_SWATCH_SVG, ROTATE_SWATCH_SVG } from '../components/rainbowSwatchSvg';

// The colour swatch when the brush in hand does not lay the armed colour:
// a rainbow ring round a grey disc carrying the mode's blend-picker glyph —
// a die under a Random blend, which deposits a colour that walks as the
// stroke goes, and the rotate arrow under Rotate, which deposits nothing
// of its own and spins the hue already under the dab. No renderer here;
// the fills are pinned at the source, as the other panel suites do.

const SWATCH = readFileSync(resolve(__dirname, '..', 'components', 'ColorSwatch.tsx'), 'utf8');
const TOPBAR = readFileSync(resolve(__dirname, '..', 'components', 'TopBar.tsx'), 'utf8');
const ADAPTER = readFileSync(resolve(__dirname, '..', 'adapter.ts'), 'utf8');
const GLYPH = TOPBAR.slice(TOPBAR.indexOf('function SwatchGlyph('), TOPBAR.indexOf('function ToolGlyph('));

/** MaterialCommunityIcons outlines, as their `d` begins. */
const DIE_D = 'M5.02 3H18.98';
const ROTATE_RIGHT_D = 'M16.88 15.52 18.33 16.88';
const DICE_MULTIPLE_D = 'M19.78 3H11.2';

describe('the rainbow swatch', () => {
  it('is asked for by mode, not by a boolean — one field cannot name two', () => {
    expect(ADAPTER).toContain("export type SwatchRainbow = 'random' | 'rotate';");
    expect(ADAPTER).toContain('swatchRainbow?: SwatchRainbow;');
    expect(TOPBAR).toContain('rainbow={tool.swatchRainbow}');
    expect(GLYPH).toContain('{rainbow ? <RainbowSwatchFill mode={rainbow} /> : <ColorSwatchFill color={color} />}');
  });

  it('draws either at the lit ring\'s size, with no black ring, without moving the bar', () => {
    expect(TOPBAR).toContain('const SWATCH_RING_GROWTH = 8;');
    expect(GLYPH).toContain('const disc = rainbow ? size + SWATCH_RING_GROWTH : size;');
    // Overhangs its slot by half the growth each side: the layout footprint
    // stays `size`, as the absolutely placed lit ring's did.
    expect(GLYPH).toContain('const overhang = rainbow ? -SWATCH_RING_GROWTH / 2 : 0;');
    expect(GLYPH).toContain('width: disc, height: disc, margin: overhang, borderRadius: disc / 2');
    expect(GLYPH).toContain('{active && !rainbow ? <View style={ring(size + SWATCH_RING_GROWTH, SWATCH_ACTIVE_RING)} /> : null}');
  });

  it('is one image per mode, decoded once from a hoisted source', () => {
    expect(SWATCH).toContain("import { RANDOM_SWATCH_SVG, ROTATE_SWATCH_SVG } from './rainbowSwatchSvg';");
    expect(SWATCH).toContain('random: svgSource(RANDOM_SWATCH_SVG),');
    expect(SWATCH).toContain('rotate: svgSource(ROTATE_SWATCH_SVG),');
    expect(SWATCH).toContain('export function RainbowSwatchFill({ mode }: { mode: SwatchRainbow }) {\n'
      + '  return <Image source={RAINBOW_SWATCH_SOURCES[mode]}');
    // The gradient ring Rotate used to wear is gone, not left beside it.
    expect(SWATCH).not.toContain('RainbowRingFill');
    expect(SWATCH).not.toContain('LinearGradient');
  });

  it.each([
    ['Random', RANDOM_SWATCH_SVG, DIE_D],
    ['Rotate', ROTATE_SWATCH_SVG, ROTATE_RIGHT_D],
  ])('%s is the ring round a grey disc carrying its white glyph', (_mode, svg, glyph) => {
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('viewBox="-2 -2 104 104"');
    // The export's provenance block is dropped: bytes nobody draws.
    expect(svg).not.toContain('metadata');
    // The grey disc, then the glyph drawn after it so it sits on top: the
    // icon font's 24-unit box scaled to 48 and centred on the disc.
    const disc = svg.indexOf('<circle id="Red dot" cx="50" cy="50" r="32" fill="#838383"></circle>');
    expect(disc).toBeGreaterThan(0);
    const at = svg.indexOf(`<path transform="translate(26 26) scale(2)" d="${glyph}`);
    expect(at).toBeGreaterThan(disc);
    expect(svg.slice(at)).toContain('fill="white"/></svg>');
    expect(26 + 12 * 2).toBe(50);
    // A ring of many hues, not one colour.
    const hues = new Set(svg.match(/fill="#[0-9A-F]{6}"/g));
    expect(hues.size).toBeGreaterThan(50);
    // No quote that would end the data URI's attribute.
    expect(svg).not.toContain("'");
  });

  it('keeps the glyphs inside the grey disc', () => {
    // dice-3 spans 3..21 on both axes; its corners stay inside r=32.
    expect(Math.hypot(9 * 2, 9 * 2)).toBeLessThan(32);
    // rotate-right spans x 3.98..19.92, y 0.98..19.92 in the 24 box: its
    // furthest reach from the centre (12,12) is the arrow's tip.
    expect(Math.hypot((12 - 3.98) * 2, (12 - 0.98) * 2)).toBeLessThan(32);
  });

  it('draws ONE die for Random, not the blend menu\'s pair, and the modes apart', () => {
    expect(RANDOM_SWATCH_SVG).not.toContain(DICE_MULTIPLE_D);
    expect(RANDOM_SWATCH_SVG).not.toContain(ROTATE_RIGHT_D);
    expect(ROTATE_SWATCH_SVG).not.toContain(DIE_D);
  });
});
