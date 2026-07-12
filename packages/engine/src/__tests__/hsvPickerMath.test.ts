import {
  touchToUV,
  hitTest,
  uvToHue,
  uvToSV,
  svToUV,
  hueToUV,
  RING_INNER,
  RING_OUTER,
  SV_RADIUS,
} from '../hsvPickerMath';

describe('touchToUV', () => {
  it('converts center touch', () => {
    expect(touchToUV(150, 150, 300)).toEqual([0.5, 0.5]);
  });

  it('converts origin touch', () => {
    expect(touchToUV(0, 0, 300)).toEqual([0, 0]);
  });
});

describe('hitTest', () => {
  it('detects center as SV zone', () => {
    expect(hitTest(0.5, 0.5)).toBe('sv');
  });

  it('detects point in SV circle', () => {
    expect(hitTest(0.5 + SV_RADIUS * 0.5, 0.5)).toBe('sv');
  });

  it('detects point on ring', () => {
    const mid = (RING_INNER + RING_OUTER) / 2;
    expect(hitTest(0.5 + mid, 0.5)).toBe('ring');
  });

  it('detects point outside as none', () => {
    expect(hitTest(1, 1)).toBe('none');
  });

  it('detects point between SV and ring as none', () => {
    // Just outside SV_RADIUS but inside RING_INNER
    const gap = (SV_RADIUS + RING_INNER) / 2;
    expect(hitTest(0.5 + gap, 0.5)).toBe('none');
  });
});

describe('uvToHue', () => {
  it('right side is 0°', () => {
    expect(uvToHue(1, 0.5)).toBeCloseTo(0, 0);
  });

  it('bottom is 90°', () => {
    expect(uvToHue(0.5, 1)).toBeCloseTo(90, 0);
  });

  it('left is 180°', () => {
    expect(uvToHue(0, 0.5)).toBeCloseTo(180, 0);
  });

  it('top is 270°', () => {
    expect(uvToHue(0.5, 0)).toBeCloseTo(270, 0);
  });
});

describe('uvToSV', () => {
  it('center maps to (0.5, 0.5)', () => {
    const [s, v] = uvToSV(0.5, 0.5);
    expect(s).toBeCloseTo(0.5);
    expect(v).toBeCloseTo(0.5);
  });

  it('right edge maps to high saturation', () => {
    const [s, v] = uvToSV(0.5 + SV_RADIUS, 0.5);
    expect(s).toBeCloseTo(1);
    expect(v).toBeCloseTo(0.5);
  });

  it('top edge maps to high value', () => {
    const [s, v] = uvToSV(0.5, 0.5 - SV_RADIUS);
    expect(s).toBeCloseTo(0.5);
    expect(v).toBeCloseTo(1);
  });

  it('clamps points outside circle', () => {
    const [s, v] = uvToSV(1, 0.5);
    // Should be clamped to circle edge
    expect(s).toBeCloseTo(1);
    expect(v).toBeCloseTo(0.5);
  });
});

describe('svToUV round-trip', () => {
  it('round-trips through uvToSV and svToUV', () => {
    const origU = 0.5 + SV_RADIUS * 0.3;
    const origV = 0.5 - SV_RADIUS * 0.7;
    const [s, val] = uvToSV(origU, origV);
    const [u2, v2] = svToUV(s, val);
    expect(u2).toBeCloseTo(origU, 5);
    expect(v2).toBeCloseTo(origV, 5);
  });
});

describe('hueToUV round-trip', () => {
  it.each([0, 45, 90, 135, 180, 225, 270, 315])('round-trips hue %d°', (hue) => {
    const [u, v] = hueToUV(hue);
    const recovered = uvToHue(u, v);
    expect(recovered).toBeCloseTo(hue, 3);
  });
});
