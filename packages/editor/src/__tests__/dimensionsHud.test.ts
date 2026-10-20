import {
  DIM_HUD_EDGE_PAD,
  dimensionsHudPlacement,
  dimensionsHudTransform,
  formatGridDim,
  rotationHudText,
} from '../dimensionsHud';

// A square screen box for a square cell box, so the projection is 1 cell =
// `ppc` px and the expected anchors are easy to read off.
function screenBoxFor(
  bbox: { cellX: number; cellY: number; cellWidth: number; cellHeight: number },
  ppc = 10,
  origin = { x: 100, y: 200 },
) {
  return {
    left: origin.x + bbox.cellX * ppc,
    top: origin.y + bbox.cellY * ppc,
    width: bbox.cellWidth * ppc,
    height: bbox.cellHeight * ppc,
  };
}

describe('formatGridDim', () => {
  it('renders whole numbers without a decimal', () => {
    expect(formatGridDim(4)).toBe('4');
    expect(formatGridDim(0)).toBe('0');
    // Float slop from a division still reads as the integer.
    expect(formatGridDim(3.0000000001)).toBe('3');
  });

  it('renders sub-square sizes with one decimal', () => {
    expect(formatGridDim(0.5)).toBe('0.5');
    expect(formatGridDim(2.25)).toBe('2.3');
  });
});

describe('dimensionsHudPlacement', () => {
  it('reports size in visible grid squares, not engine cells', () => {
    // gridLevel 3 → one visible square spans 2^3 = 8 cells.
    const bbox = { cellX: 0, cellY: 0, cellWidth: 16, cellHeight: 8 };
    const p = dimensionsHudPlacement(bbox, screenBoxFor(bbox), 3);
    expect(p?.text).toBe('2 × 1');
  });

  it('labels raw cells at grid level 0', () => {
    const bbox = { cellX: 0, cellY: 0, cellWidth: 16, cellHeight: 8 };
    const p = dimensionsHudPlacement(bbox, screenBoxFor(bbox), 0);
    expect(p?.text).toBe('16 × 8');
  });

  it('centers the label inside a two-axis box', () => {
    const bbox = { cellX: 1, cellY: 2, cellWidth: 4, cellHeight: 2 };
    const s = screenBoxFor(bbox);
    const p = dimensionsHudPlacement(bbox, s, 0);
    expect(p).toMatchObject({ hAnchor: 'center', vAnchor: 'middle' });
    expect(p!.x).toBe(s.left + s.width / 2);
    expect(p!.y).toBe(s.top + s.height / 2);
  });

  it('shows only the width for a horizontal line, clear of the stroke', () => {
    const bbox = { cellX: 1, cellY: 2, cellWidth: 4, cellHeight: 0 };
    const s = screenBoxFor(bbox);
    const p = dimensionsHudPlacement(bbox, s, 0);
    // "4 × 0" would be noise — the locked axis never changes.
    expect(p?.text).toBe('4');
    expect(p).toMatchObject({ hAnchor: 'center', vAnchor: 'bottom' });
    expect(p!.y).toBe(s.top - DIM_HUD_EDGE_PAD);
  });

  it('shows only the height for a vertical line, clear of the stroke', () => {
    const bbox = { cellX: 1, cellY: 2, cellWidth: 0, cellHeight: 3 };
    const s = screenBoxFor(bbox);
    const p = dimensionsHudPlacement(bbox, s, 0);
    expect(p?.text).toBe('3');
    expect(p).toMatchObject({ hAnchor: 'left', vAnchor: 'middle' });
    expect(p!.x).toBe(s.left + s.width + DIM_HUD_EDGE_PAD);
  });

  it('returns null for a box with no extent at all', () => {
    const bbox = { cellX: 4, cellY: 4, cellWidth: 0, cellHeight: 0 };
    expect(dimensionsHudPlacement(bbox, screenBoxFor(bbox), 0)).toBeNull();
  });
});

describe('rotationHudText', () => {
  it('shows the angle to one decimal place, wearing the degree sign', () => {
    expect(rotationHudText(23.46)).toBe('23.5°');
    expect(rotationHudText(0)).toBe('0.0°');
    expect(rotationHudText(-45)).toBe('-45.0°');
    expect(rotationHudText(90)).toBe('90.0°');
  });

  it('reads as the pose the object is in, not the finger path: (−180, 180]', () => {
    // A multi-turn twist keeps accumulating past 360; the readout doesn't.
    expect(rotationHudText(365)).toBe('5.0°');
    expect(rotationHudText(359.5)).toBe('-0.5°');
    expect(rotationHudText(-190)).toBe('170.0°');
    // Both half-turn spellings land on the same readout.
    expect(rotationHudText(180)).toBe('180.0°');
    expect(rotationHudText(-180)).toBe('180.0°');
  });

  it('never shows −0.0 — a twist that settled home is home', () => {
    expect(rotationHudText(360)).toBe('0.0°');
    expect(rotationHudText(-0.01)).toBe('0.0°');
  });
});

describe('dimensionsHudTransform', () => {
  it('pulls the label onto its anchor point without measuring it', () => {
    expect(dimensionsHudTransform('center', 'middle')).toBe('translate(-50%, -50%)');
    expect(dimensionsHudTransform('center', 'bottom')).toBe('translate(-50%, -100%)');
    expect(dimensionsHudTransform('left', 'middle')).toBe('translate(0%, -50%)');
    expect(dimensionsHudTransform('right', 'top')).toBe('translate(-100%, 0%)');
  });
});
