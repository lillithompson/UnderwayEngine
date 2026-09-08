import { readFileSync } from 'fs';
import { resolve } from 'path';

// The toolbar's colour swatch bounces when the colour is confirmed away
// from it (the paint radial's swatch capsule). No renderer here; the spring
// and its trigger are pinned at the source, as the other panel suites do.

const TOPBAR = readFileSync(resolve(__dirname, '..', 'components', 'TopBar.tsx'), 'utf8');
const ADAPTER = readFileSync(resolve(__dirname, '..', 'adapter.ts'), 'utf8');

describe('the toolbar swatch bounce', () => {
  it('is asked for through the tool model, one bounce per new key', () => {
    expect(ADAPTER).toContain('swatchBounceKey?: number;');
    expect(TOPBAR).toContain('bounceKey={tool.swatchBounceKey}');
    const glyph = TOPBAR.slice(TOPBAR.indexOf('function SwatchGlyph('), TOPBAR.indexOf('export function TopBar('));
    expect(glyph).toContain('if (bounceKey === undefined || bounceKey === lastKey.current) return undefined;');
    expect(glyph).toContain('lastKey.current = bounceKey;');
  });

  it('is the capsule\'s overshoot spring on the swatch\'s own scale', () => {
    const glyph = TOPBAR.slice(TOPBAR.indexOf('function SwatchGlyph('), TOPBAR.indexOf('export function TopBar('));
    expect(glyph).toContain('scale.setValue(0.6);');
    expect(glyph).toContain('friction: 4,');
    expect(glyph).toContain('tension: 220,');
    expect(glyph).toContain('useNativeDriver: true,');
    expect(glyph).toContain('<Animated.View style={[styles.swatchWrap, { transform: [{ scale }] }]}>');
    // The ring pair still rides the swatch when the tool is armed.
    expect(glyph).toContain('<View style={ring(size + 8, STATE_ACTIVE)} />');
  });
});
