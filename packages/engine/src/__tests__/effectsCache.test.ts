/**
 * Effects raster cache (effectsCache.ts). Pins the 90 fps keying rule for
 * pre-blurred shadow/glow textures: shadow dx/dy are draw-time offsets
 * and must NOT be in the key; blur radii / colors / alphas and the node's
 * contentVersion must be. Border-only nodes skip the raster pass.
 */

import {
  effectsRasterKey,
  createEffectsCache,
  EffectsRasterEntry,
  EffectsRenderPass,
} from '../effectsCache';
import { NodeEffects, ShadowEffect } from '../types';

const shadow = (overrides: Partial<ShadowEffect> = {}): ShadowEffect => ({
  dx: 1, dy: 2, blur: 4, color: { r: 0, g: 0, b: 0 }, alpha: 0.5, ...overrides,
});

function makeCountingPass(width = 10, height = 10): { pass: EffectsRenderPass; calls: number[] } {
  const calls: number[] = [];
  const pass: EffectsRenderPass = (): EffectsRasterEntry => {
    calls.push(calls.length + 1);
    return { width, height, data: { call: calls.length } };
  };
  return { pass, calls };
}

describe('effectsRasterKey', () => {
  test('null when the node has no shadow and no glow', () => {
    expect(effectsRasterKey('n1', 0, {})).toBeNull();
  });

  test('null for a border-only effects block', () => {
    const effects: NodeEffects = {
      border: { width: 2, color: { r: 255, g: 0, b: 0 }, radius: 1 },
    };
    expect(effectsRasterKey('n1', 0, effects)).toBeNull();
  });

  test('shadow dx/dy are NOT in the key (draw-time offset)', () => {
    const a = effectsRasterKey('n1', 0, { shadow: shadow({ dx: 1, dy: 2 }) });
    const b = effectsRasterKey('n1', 0, { shadow: shadow({ dx: 9, dy: -7 }) });
    expect(a).not.toBeNull();
    expect(b).toBe(a);
  });

  test('shadow blur IS in the key', () => {
    const a = effectsRasterKey('n1', 0, { shadow: shadow({ blur: 4 }) });
    const b = effectsRasterKey('n1', 0, { shadow: shadow({ blur: 8 }) });
    expect(b).not.toBe(a);
  });

  test('shadow color and alpha ARE in the key', () => {
    const base = effectsRasterKey('n1', 0, { shadow: shadow() });
    expect(effectsRasterKey('n1', 0, { shadow: shadow({ color: { r: 10, g: 20, b: 30 } }) }))
      .not.toBe(base);
    expect(effectsRasterKey('n1', 0, { shadow: shadow({ alpha: 0.9 }) }))
      .not.toBe(base);
  });

  test('glow radius / color / alpha ARE in the key', () => {
    const glow = { radius: 3, color: { r: 255, g: 200, b: 0 }, alpha: 0.8 };
    const base = effectsRasterKey('n1', 0, { glow });
    expect(base).not.toBeNull();
    expect(effectsRasterKey('n1', 0, { glow: { ...glow, radius: 6 } })).not.toBe(base);
    expect(effectsRasterKey('n1', 0, { glow: { ...glow, color: { r: 0, g: 0, b: 255 } } })).not.toBe(base);
    expect(effectsRasterKey('n1', 0, { glow: { ...glow, alpha: 0.1 } })).not.toBe(base);
  });

  test('border params never affect the key', () => {
    const a = effectsRasterKey('n1', 0, { shadow: shadow() });
    const b = effectsRasterKey('n1', 0, {
      shadow: shadow(),
      border: { width: 5, color: { r: 1, g: 2, b: 3 }, radius: 2 },
    });
    expect(b).toBe(a);
  });

  test('nodeId and contentVersion ARE in the key', () => {
    const base = effectsRasterKey('n1', 0, { shadow: shadow() });
    expect(effectsRasterKey('n2', 0, { shadow: shadow() })).not.toBe(base);
    expect(effectsRasterKey('n1', 1, { shadow: shadow() })).not.toBe(base);
    expect(effectsRasterKey('n1', 'hashA', { shadow: shadow() })).not.toBe(base);
  });

  test('shadow-only, glow-only, and both produce distinct keys', () => {
    const glow = { radius: 3, color: { r: 0, g: 0, b: 0 }, alpha: 0.5 };
    const shadowOnly = effectsRasterKey('n1', 0, { shadow: shadow() });
    const glowOnly = effectsRasterKey('n1', 0, { glow });
    const both = effectsRasterKey('n1', 0, { shadow: shadow(), glow });
    expect(new Set([shadowOnly, glowOnly, both]).size).toBe(3);
  });
});

describe('createEffectsCache', () => {
  test('renders on miss, returns the cached entry on hit', () => {
    const { pass, calls } = makeCountingPass();
    const cache = createEffectsCache(pass);
    const effects: NodeEffects = { shadow: shadow() };
    const first = cache.get('n1', 0, effects);
    expect(first).not.toBeNull();
    expect(calls).toHaveLength(1);
    const second = cache.get('n1', 0, effects);
    expect(second).toBe(first);
    expect(calls).toHaveLength(1);
    expect(cache.entryCount()).toBe(1);
    expect(cache.size()).toBe(10 * 10 * 4);
  });

  test('changing only dx/dy is a cache hit (zero re-blurs)', () => {
    const { pass, calls } = makeCountingPass();
    const cache = createEffectsCache(pass);
    const first = cache.get('n1', 0, { shadow: shadow({ dx: 0, dy: 0 }) });
    const second = cache.get('n1', 0, { shadow: shadow({ dx: 25, dy: -25 }) });
    expect(second).toBe(first);
    expect(calls).toHaveLength(1);
  });

  test('border-only nodes return null without invoking the render pass', () => {
    const { pass, calls } = makeCountingPass();
    const cache = createEffectsCache(pass);
    const result = cache.get('n1', 0, {
      border: { width: 1, color: { r: 0, g: 0, b: 0 } },
    });
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
    expect(cache.entryCount()).toBe(0);
  });

  test('contentVersion bump re-renders', () => {
    const { pass, calls } = makeCountingPass();
    const cache = createEffectsCache(pass);
    const effects: NodeEffects = { shadow: shadow() };
    cache.get('n1', 0, effects);
    cache.get('n1', 1, effects);
    expect(calls).toHaveLength(2);
  });

  test('invalidateNode drops that node\'s entries only', () => {
    const { pass, calls } = makeCountingPass();
    const cache = createEffectsCache(pass);
    const effects: NodeEffects = { shadow: shadow() };
    cache.get('n1', 0, effects);
    cache.get('n1', 1, effects); // second content version, same node
    const n2Entry = cache.get('n2', 0, effects);
    expect(cache.entryCount()).toBe(3);
    cache.invalidateNode('n1');
    expect(cache.entryCount()).toBe(1);
    expect(cache.peek(effectsRasterKey('n1', 0, effects)!)).toBeUndefined();
    expect(cache.peek(effectsRasterKey('n1', 1, effects)!)).toBeUndefined();
    expect(cache.peek(effectsRasterKey('n2', 0, effects)!)).toBe(n2Entry);
    // Re-get after invalidation re-renders.
    cache.get('n1', 0, effects);
    expect(calls).toHaveLength(4);
  });

  test('evicts oldest entries under a small byte budget', () => {
    const { pass } = makeCountingPass(10, 10); // 400 bytes each
    const cache = createEffectsCache(pass, 1000);
    const effects: NodeEffects = { shadow: shadow() };
    cache.get('n1', 0, effects);
    cache.get('n2', 0, effects);
    cache.get('n3', 0, effects); // 1200 > 1000 → evict n1's entry
    expect(cache.entryCount()).toBe(2);
    expect(cache.peek(effectsRasterKey('n1', 0, effects)!)).toBeUndefined();
    expect(cache.peek(effectsRasterKey('n3', 0, effects)!)).toBeDefined();
  });

  test('clear empties everything', () => {
    const { pass } = makeCountingPass();
    const cache = createEffectsCache(pass);
    cache.get('n1', 0, { shadow: shadow() });
    cache.clear();
    expect(cache.entryCount()).toBe(0);
    expect(cache.size()).toBe(0);
  });
});
