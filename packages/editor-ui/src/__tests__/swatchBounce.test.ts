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
    const hook = TOPBAR.slice(TOPBAR.indexOf('function useBounceScale('), TOPBAR.indexOf('function SwatchGlyph('));
    expect(hook).toContain('if (bounceKey === undefined || bounceKey === lastKey.current) return undefined;');
    expect(hook).toContain('lastKey.current = bounceKey;');
    const glyph = TOPBAR.slice(TOPBAR.indexOf('function SwatchGlyph('), TOPBAR.indexOf('function ToolGlyph('));
    expect(glyph).toContain('const scale = useBounceScale(bounceKey);');
  });

  it('is the capsule\'s overshoot spring on the swatch\'s own scale', () => {
    const hook = TOPBAR.slice(TOPBAR.indexOf('function useBounceScale('), TOPBAR.indexOf('function SwatchGlyph('));
    expect(hook).toContain('scale.setValue(0.6);');
    expect(hook).toContain('friction: 4,');
    expect(hook).toContain('tension: 220,');
    expect(hook).toContain('useNativeDriver: true,');
    const glyph = TOPBAR.slice(TOPBAR.indexOf('function SwatchGlyph('), TOPBAR.indexOf('function ToolGlyph('));
    expect(glyph).toContain('<Animated.View style={[styles.swatchWrap, { transform: [{ scale }] }]}>');
    // The ring pair still rides the swatch when the tool is armed.
    expect(glyph).toContain('<View style={ring(size + 8, STATE_ACTIVE)} />');
  });
});

describe('the whole-button bounce', () => {
  it('is asked for per tool through the same model, on the same spring, wrapping whichever glyph the tool wears', () => {
    // A tool armed away from the bar (a floating Edit target handing a
    // selected object's tool back) bounces its button, the way a colour
    // confirmed away from the swatch bounces the swatch.
    expect(ADAPTER).toContain('bounceKey?: number;');
    const glyph = TOPBAR.slice(TOPBAR.indexOf('function ToolGlyph('), TOPBAR.indexOf('export function TopBar('));
    expect(glyph).toContain('const scale = useBounceScale(tool.bounceKey);');
    expect(glyph).toContain('<Animated.View style={{ transform: [{ scale }] }}>');
    expect(glyph).toContain('<SwatchGlyph');
    expect(glyph).toContain('<tool.IconComponent');
    expect(glyph).toContain('<MaterialCommunityIcons');
    expect(TOPBAR).toContain('<ToolGlyph tool={tool} swatchSize={swatchSize} />');
  });
});
