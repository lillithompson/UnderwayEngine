import type { BorderEffect, GlowEffect, ImageFraming, ImageTintFill, ShadowEffect, SVGObject } from '@/engine/types';
import {
  DEFAULT_GLOW_EFFECT,
  DEFAULT_IMAGE_FRAMING,
  DEFAULT_SHADOW_EFFECT,
  borderEffectToModel,
  borderModelToEffect,
  endpointsModelOf,
  framingEffectToModel,
  framingModelToEffect,
  glowEffectKey,
  glowEffectToModel,
  glowModelToEffect,
  shadowEffectToModel,
  shadowModelToEffect,
  tintFillToModel,
  tintModelToFill,
} from '../panelEffectModels';

// The panel's models ↔ the engine's records. Each pair round-trips, each
// `…ToModel` resolves the absent fields the rows need concrete, and each
// `…ToEffect` clamps what the sliders can overshoot.

describe('shadow', () => {
  test('round-trips, and a model clamps its opacity', () => {
    expect(shadowModelToEffect(shadowEffectToModel(DEFAULT_SHADOW_EFFECT)))
      .toEqual(DEFAULT_SHADOW_EFFECT);
    const m = shadowEffectToModel(DEFAULT_SHADOW_EFFECT);
    expect(shadowModelToEffect({ ...m, opacity: 2, blur: -5 }))
      .toMatchObject({ alpha: 1, blur: 0 });
    // Spread may be negative — it erodes the shape.
    expect(shadowModelToEffect({ ...m, spread: -0.5 }).spread).toBe(-0.5);
  });

  test('an absent spread reads as none', () => {
    const e = { ...DEFAULT_SHADOW_EFFECT, spread: undefined } as unknown as ShadowEffect;
    expect(shadowEffectToModel(e).spread).toBe(0);
  });
});

describe('glow', () => {
  test('which slot each way of the light writes', () => {
    expect(glowEffectKey('outer')).toBe('glow');
    expect(glowEffectKey('inner')).toBe('innerGlow');
  });

  test('round-trips, radius clamped at zero', () => {
    expect(glowModelToEffect(glowEffectToModel(DEFAULT_GLOW_EFFECT))).toEqual(DEFAULT_GLOW_EFFECT);
    const m = glowEffectToModel(DEFAULT_GLOW_EFFECT);
    expect(glowModelToEffect({ ...m, blur: -3, opacity: 9 })).toMatchObject({ radius: 0, alpha: 1 });
  });
});

describe('border', () => {
  const border: BorderEffect = {
    width: 0.375, position: 'inside', dash: 3, color: { r: 10, g: 20, b: 30 },
  };

  test('round-trips, and the dash is clamped to the row’s ten steps', () => {
    expect(borderModelToEffect(borderEffectToModel(border))).toEqual(border);
    const m = borderEffectToModel(border);
    expect(borderModelToEffect({ ...m, dash: 99 }).dash).toBe(10);
    expect(borderModelToEffect({ ...m, dash: -4 }).dash).toBe(0);
    expect(borderModelToEffect({ ...m, width: -1 }).width).toBe(0);
  });

  test('an absent position reads as centre', () => {
    const e = { width: 1, color: { r: 0, g: 0, b: 0 } } as BorderEffect;
    expect(borderEffectToModel(e)).toMatchObject({ position: 'center', dash: 0 });
  });
});

describe('image framing', () => {
  test('round-trips the default, and the zoom is clamped to its range', () => {
    expect(framingModelToEffect(framingEffectToModel(DEFAULT_IMAGE_FRAMING)))
      .toEqual(DEFAULT_IMAGE_FRAMING);
    const m = framingEffectToModel(DEFAULT_IMAGE_FRAMING);
    expect(framingModelToEffect({ ...m, zoom: 0.2 }).zoom).toBe(1);
    expect(framingModelToEffect({ ...m, zoom: 9 }).zoom).toBe(3);
    expect(framingModelToEffect({ ...m, angle: 90 }).angle).toBe(45);
    expect(framingModelToEffect({ ...m, angle: -90 }).angle).toBe(-45);
  });

  test('a record carrying only its mode reads as the design defaults', () => {
    const e = { mode: 'fit' } as ImageFraming;
    expect(framingEffectToModel(e)).toEqual({
      mode: 'fit', zoom: 1.3, margin: 0.875, ratio: 'square', angle: 0,
      tileScale: 0.46, tileGap: 0.375,
    });
  });
});

describe('image tint', () => {
  const tint: ImageTintFill = {
    type: 'linear',
    solid: { r: 1, g: 2, b: 3 },
    stops: [{ offset: 0, color: { r: 0, g: 0, b: 0 } }, { offset: 1, color: { r: 255, g: 255, b: 255 } }],
    angle: 45,
    opacity: 0.5,
    blend: 'normal',
  };

  test('offset ↔ position round-trips, and the angle is folded into one turn', () => {
    expect(tintModelToFill(tintFillToModel(tint))).toEqual(tint);
    const m = tintFillToModel(tint);
    expect(tintModelToFill({ ...m, angle: 405 }).angle).toBe(45);
    expect(tintModelToFill({ ...m, angle: -45 }).angle).toBe(315);
    expect(tintModelToFill({ ...m, opacity: 4 }).opacity).toBe(1);
  });

  test('the selected stop is held inside the stops it has', () => {
    expect(tintFillToModel(tint, 5).selectedStop).toBe(1);
    expect(tintFillToModel(tint, -2).selectedStop).toBe(0);
    expect(tintFillToModel({ ...tint, stops: [] }).selectedStop).toBe(0);
  });
});

describe('endpoints', () => {
  test('a path with no record reads as the bar’s own defaults', () => {
    const svg = { id: 'svg_1' } as unknown as SVGObject;
    expect(endpointsModelOf(svg)).toEqual({
      startMarker: 'none', endMarker: 'none', startCap: 'round', endCap: 'round',
    });
  });

  test('…and what it does carry comes through', () => {
    const svg = {
      id: 'svg_1', endpoints: { startMarker: 'arrow', endCap: 'butt' },
    } as unknown as SVGObject;
    expect(endpointsModelOf(svg)).toEqual({
      startMarker: 'arrow', endMarker: 'none', startCap: 'round', endCap: 'butt',
    });
  });
});

describe('the defaults an Add button materializes', () => {
  test('a glow is the shadow’s softness with nowhere to fall, in white', () => {
    const glow: GlowEffect = DEFAULT_GLOW_EFFECT;
    expect(glow.radius).toBe(DEFAULT_SHADOW_EFFECT.blur);
    expect(glow.spread).toBe(DEFAULT_SHADOW_EFFECT.spread);
    expect(glow.color).toEqual({ r: 255, g: 255, b: 255 });
    expect(DEFAULT_SHADOW_EFFECT.color).toEqual({ r: 0, g: 0, b: 0 });
  });
});
