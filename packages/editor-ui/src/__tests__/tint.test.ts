import {
  DEFAULT_TINT_MODEL,
  TINT_BLENDS,
  TINT_TYPES,
  addStop,
  canRemoveStop,
  moveStop,
  nearestStopIndex,
  rampGradient,
  removeStop,
  roundStopPosition,
  sortedStops,
  tintBlendLabel,
} from '../logic/tint';
import type { TintModel } from '../adapter';

describe('tint option lists', () => {
  test('Type lists Solid / Linear / Radial in order', () => {
    expect(TINT_TYPES.map((t) => t.value)).toEqual(['solid', 'linear', 'radial']);
  });
  test('Blend lists the design\'s 8 modes in order, incl. soft-light + saturation', () => {
    expect(TINT_BLENDS.map((b) => b.value)).toEqual([
      'normal', 'multiply', 'darken', 'lighten', 'soft-light', 'color', 'hue', 'saturation',
    ]);
  });
  test('blend values are valid CSS mix-blend-mode keywords', () => {
    // Every value doubles as a CSS keyword so the preview needs no lookup.
    for (const b of TINT_BLENDS) expect(b.value).toMatch(/^[a-z-]+$/);
  });
  test('tintBlendLabel maps to the display label', () => {
    expect(tintBlendLabel('soft-light')).toBe('Soft Light');
    expect(tintBlendLabel('multiply')).toBe('Multiply');
  });
});

describe('DEFAULT_TINT_MODEL', () => {
  test('matches the app defaults', () => {
    expect(DEFAULT_TINT_MODEL.type).toBe('linear');
    expect(DEFAULT_TINT_MODEL.angle).toBe(90);
    expect(DEFAULT_TINT_MODEL.opacity).toBeCloseTo(0.5);
    expect(DEFAULT_TINT_MODEL.blend).toBe('normal');
    expect(DEFAULT_TINT_MODEL.stops).toHaveLength(2);
    expect(DEFAULT_TINT_MODEL.stops[0].position).toBe(0);
    expect(DEFAULT_TINT_MODEL.stops[1].position).toBe(1);
    expect(DEFAULT_TINT_MODEL.solid).toEqual({ r: 0x12, g: 0x30, b: 0x47 });
  });
});

describe('roundStopPosition', () => {
  test('clamps to 0…1', () => {
    expect(roundStopPosition(-0.2)).toBe(0);
    expect(roundStopPosition(1.5)).toBe(1);
  });
  test('quantizes to whole percent', () => {
    expect(roundStopPosition(0.337)).toBeCloseTo(0.34);
    expect(roundStopPosition(0.335)).toBeCloseTo(0.34);
  });
});

describe('sortedStops', () => {
  test('orders ascending without mutating the input', () => {
    const stops = [
      { position: 1, color: { r: 1, g: 1, b: 1 } },
      { position: 0, color: { r: 2, g: 2, b: 2 } },
    ];
    expect(sortedStops(stops).map((s) => s.position)).toEqual([0, 1]);
    expect(stops[0].position).toBe(1); // untouched
  });
});

describe('nearestStopIndex', () => {
  const tint: TintModel = {
    ...DEFAULT_TINT_MODEL,
    stops: [
      { position: 0, color: { r: 0, g: 0, b: 0 } },
      { position: 0.5, color: { r: 0, g: 0, b: 0 } },
      { position: 1, color: { r: 0, g: 0, b: 0 } },
    ],
  };
  test('picks the closest stop', () => {
    expect(nearestStopIndex(tint, 0.05)).toBe(0);
    expect(nearestStopIndex(tint, 0.45)).toBe(1);
    expect(nearestStopIndex(tint, 0.95)).toBe(2);
  });
});

describe('moveStop', () => {
  test('moves the stop, selects it, keeps array order + count', () => {
    const next = moveStop(DEFAULT_TINT_MODEL, 1, 0.25);
    expect(next.stops).toHaveLength(2);
    expect(next.stops[1].position).toBeCloseTo(0.25);
    expect(next.stops[0].position).toBe(0); // unmoved
    expect(next.selectedStop).toBe(1);
  });
  test('clamps out-of-range positions', () => {
    expect(moveStop(DEFAULT_TINT_MODEL, 0, -1).stops[0].position).toBe(0);
    expect(moveStop(DEFAULT_TINT_MODEL, 0, 2).stops[0].position).toBe(1);
  });
});

describe('addStop', () => {
  test('adds midway between the outermost stops, inheriting the first color, and selects it', () => {
    const next = addStop(DEFAULT_TINT_MODEL);
    expect(next.stops).toHaveLength(3);
    const added = next.stops[next.selectedStop];
    expect(next.selectedStop).toBe(2);
    expect(added.position).toBeCloseTo(0.5);
    expect(added.color).toEqual(DEFAULT_TINT_MODEL.stops[0].color);
  });
});

describe('removeStop / canRemoveStop', () => {
  test('deletes the selected stop above the minimum', () => {
    const three = addStop(DEFAULT_TINT_MODEL); // 3 stops, selected index 2
    const next = removeStop({ ...three, selectedStop: 2 });
    expect(next.stops).toHaveLength(2);
    expect(next.selectedStop).toBeLessThanOrEqual(1);
  });
  test('is disabled / a no-op at the 2-stop minimum', () => {
    expect(canRemoveStop(DEFAULT_TINT_MODEL)).toBe(false);
    expect(removeStop(DEFAULT_TINT_MODEL).stops).toHaveLength(2);
  });
  test('clamps the selection when the last stop is removed', () => {
    const three = addStop(DEFAULT_TINT_MODEL);
    const next = removeStop({ ...three, selectedStop: 2 });
    expect(next.selectedStop).toBe(1);
  });
});

describe('rampGradient', () => {
  test('returns ascending colors + locations of equal length', () => {
    const { colors, locations } = rampGradient([
      { position: 1, color: { r: 255, g: 0, b: 0 } },
      { position: 0, color: { r: 0, g: 0, b: 255 } },
    ]);
    expect(colors).toEqual(['rgb(0, 0, 255)', 'rgb(255, 0, 0)']);
    expect(locations).toEqual([0, 1]);
    expect(colors).toHaveLength(locations.length);
  });
});
