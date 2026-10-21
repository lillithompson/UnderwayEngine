import { CAPSULE_SIZE } from '@/editor-ui/theme';
import { overlayNearPoint, TAP_EXCLUSION_RADIUS } from '../tapExclusion';

// The tile tool paints wherever the canvas is tapped, and the canvas is the
// whole screen — so a thumb reaching for the tile radial or the capsules
// along the bottom and falling a few points short placed a tile instead.
// A tap within one undo-button radius of any floating control is refused.

/** A DOM stand-in: `canvas` with a child, and a control outside it. */
function fakeDom() {
  const canvas = { children: [] as unknown[] } as unknown as Element;
  const node = {} as Element;
  const root = {} as Element;
  const control = {} as Element;
  (canvas as unknown as { contains: (e: Element) => boolean }).contains =
    (e: Element) => e === canvas || e === node;
  (node as unknown as { contains: (e: Element) => boolean }).contains = (e) => e === node;
  (control as unknown as { contains: (e: Element) => boolean }).contains = (e) => e === control;
  // The shell's full-screen wrapper: it holds the canvas.
  (root as unknown as { contains: (e: Element) => boolean }).contains = () => true;
  return { canvas, node, root, control };
}

describe('TAP_EXCLUSION_RADIUS', () => {
  test('is the undo / redo button’s radius, the size the report named', () => {
    expect(TAP_EXCLUSION_RADIUS).toBe(CAPSULE_SIZE / 2);
  });
});

describe('overlayNearPoint', () => {
  const { canvas, node, root, control } = fakeDom();

  test('plain canvas all round is not near a control', () => {
    expect(overlayNearPoint(100, 100, canvas, 22, () => canvas)).toBe(false);
    // …including the canvas’s own children — the grid, the world, a node.
    expect(overlayNearPoint(100, 100, canvas, 22, () => node)).toBe(false);
  });

  test('a control on ANY side refuses the tap', () => {
    // One sample in each of the eight directions, one at a time.
    const dirs = [
      [22, 0], [-22, 0], [0, 22], [0, -22],
      [15.56, 15.56], [-15.56, 15.56], [15.56, -15.56], [-15.56, -15.56],
    ];
    for (const [dx, dy] of dirs) {
      const hit = (x: number, y: number) =>
        (Math.abs(x - (100 + dx)) < 0.01 && Math.abs(y - (100 + dy)) < 0.01 ? control : canvas);
      expect(overlayNearPoint(100, 100, canvas, 22, hit)).toBe(true);
    }
  });

  test('a control just outside the ring leaves the tap alone', () => {
    // The samples sit ON the ring; a control reached only past it is missed.
    const far = (x: number) => (x > 130 ? control : canvas);
    expect(overlayNearPoint(100, 100, canvas, 22, (x) => far(x))).toBe(false);
  });

  // The guards that keep this from refusing EVERY tap.
  test('a sample off the document is not a control', () => {
    expect(overlayNearPoint(0, 0, canvas, 22, () => null)).toBe(false);
  });

  test('a wrapper ABOVE the canvas is not a control', () => {
    // The shell's own full-screen layers contain the canvas; answering with
    // one of them must not read as chrome.
    expect(overlayNearPoint(100, 100, canvas, 22, () => root)).toBe(false);
  });

  test('no canvas, or no radius, excludes nothing', () => {
    expect(overlayNearPoint(100, 100, null, 22, () => control)).toBe(false);
    expect(overlayNearPoint(100, 100, canvas, 0, () => control)).toBe(false);
  });
});
