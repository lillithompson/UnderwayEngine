import { CompositionState, PATTERN_SYMMETRY_OFF, PatternObject, PatternSymmetry } from '@/engine/types';
import {
  applySymmetryAffine,
  applySymmetryAffineVec,
  canvasSymmetryOn,
  canvasSymmetrySpecOf,
  patternOwnSymmetry,
  canvasWideSymmetry,
  canvasSymmetryStamps,
  SYMMETRY_MENU_MODES,
  symmetryMenuFlags,
  symmetryMenuKeyOf,
  symmetryMenuLabel,
  symmetryAffineMaps,
  symmetryOverlayModel,
  symmetryToolbarIcon,
} from '../canvasSymmetry';
import { makeBlankComposition } from '../blankComposition';

// The canvas Symmetry control (Facet's tile-editor mirror, ported): the
// toolbar cycle + modal choose the mode, the frame is planted on the view
// at toggle-on, and Tile stamps mirror about it. These pin the pure logic;
// each app's own shell and canvas wiring is pinned in its own tree
// (docs/shared-editor.md §4.2 item 5).

const OFF = PATTERN_SYMMETRY_OFF;
const H: PatternSymmetry = { ...OFF, mirrorH: true };
const HV: PatternSymmetry = { ...OFF, mirrorH: true, mirrorV: true };
const V: PatternSymmetry = { ...OFF, mirrorV: true };

describe('the pushdown menu modes', () => {
  test('the curated five, None leading, keys ⇄ flags round-tripping', () => {
    // Quad left the capsule (the full modal still offers it, and a page
    // saved under it still mirrors — see the retired-mode test below).
    expect(SYMMETRY_MENU_MODES.map((m) => m.key)).toEqual([
      'none', 'h', 'v', 'hv', 'star',
    ]);
    expect(SYMMETRY_MENU_MODES.map((m) => m.label)).toEqual([
      'None', 'H', 'V', 'HV', 'Star',
    ]);
    expect(symmetryMenuFlags('none')).toBeUndefined();
    expect(symmetryMenuFlags('h')).toEqual(H);
    expect(symmetryMenuFlags('hv')).toEqual(HV);
    expect(symmetryMenuFlags('star')).toEqual({ ...OFF, mirrorStar: true });
    for (const m of SYMMETRY_MENU_MODES) {
      expect(symmetryMenuKeyOf(symmetryMenuFlags(m.key))).toBe(m.key);
      expect(symmetryMenuLabel(m.key)).toBe(m.label);
    }
  });

  test('a stored mode the menu does not offer lights nothing — reads as none', () => {
    // A page saved under Diag, Row, Col or Rotate still mirrors by it; the
    // menu simply has no segment to claim it.
    expect(symmetryMenuKeyOf({ ...OFF, mirrorDiag1: true })).toBe('none');
    expect(symmetryMenuKeyOf({ ...OFF, mirrorRow: true })).toBe('none');
    expect(symmetryMenuKeyOf({ ...OFF, mirrorCol: true })).toBe('none');
    expect(symmetryMenuKeyOf({ ...OFF, mirrorRotate: true })).toBe('none');
    expect(symmetryMenuKeyOf({ ...OFF, mirrorQuad: true })).toBe('none');
    expect(symmetryMenuKeyOf(undefined)).toBe('none');
  });

  test('canvasSymmetryOn reads any flag as on', () => {
    expect(canvasSymmetryOn(undefined)).toBe(false);
    expect(canvasSymmetryOn(OFF)).toBe(false);
    expect(canvasSymmetryOn({ ...OFF, mirrorDiag2: true })).toBe(true);
  });
});

describe('the button glyph', () => {
  test('wears the active mode’s icon (Facet’s priority chain)', () => {
    expect(symmetryToolbarIcon(undefined).icon).toBe('flip-horizontal');
    expect(symmetryToolbarIcon(H).icon).toBe('flip-horizontal');
    expect(symmetryToolbarIcon(V).icon).toBe('flip-vertical');
    expect(symmetryToolbarIcon(HV).icon).toBe('arrow-all');
    expect(symmetryToolbarIcon({ ...OFF, mirrorStar: true }).icon).toBe('star-four-points-outline');
    expect(symmetryToolbarIcon({ ...OFF, mirrorQuad: true }).icon).toBe('view-grid');
    // Diag \ shares Diag /'s glyph, drawn flipped.
    const d1 = symmetryToolbarIcon({ ...OFF, mirrorDiag1: true });
    expect(d1).toEqual({ icon: 'arrow-top-right-bottom-left', mirrorIcon: true });
  });
});

describe('mirrored stamps', () => {
  const frame = { cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8 };

  test('H mirrors a stamp across the frame center', () => {
    const { partners, self } = canvasSymmetryStamps(1, 2, 1, { flags: H, frame });
    expect(partners).toEqual([{ x: 6, y: 2, mH: true, mV: false, rot: 0 }]);
    expect(self).toBeUndefined();
  });

  test('the stamp step scales the mapping — coarser cells mirror as cells', () => {
    const big = { cellX: 0, cellY: 0, cellWidth: 16, cellHeight: 16 };
    const { partners } = canvasSymmetryStamps(2, 4, 2, { flags: H, frame: big });
    expect(partners).toEqual([{ x: 12, y: 4, mH: true, mV: false, rot: 0 }]);
  });

  test('a stamp ON the axis has no partner and reports its symmetry', () => {
    const odd = { cellX: 0, cellY: 0, cellWidth: 7, cellHeight: 7 };
    const { partners, self } = canvasSymmetryStamps(3, 2, 1, { flags: H, frame: odd });
    expect(partners).toEqual([]);
    expect(self).toEqual({ h: true, v: false, d1: false, d2: false });
  });

  test('the mirror applies far outside the frame — the origin, not a fence', () => {
    // The view moved and the stamp landed way past the toggle-time window:
    // it still reflects about the same axis (x = 4 → partner at −13).
    const { partners } = canvasSymmetryStamps(20, 2, 1, { flags: H, frame });
    expect(partners).toEqual([{ x: -13, y: 2, mH: true, mV: false, rot: 0 }]);
  });

  test('quad keeps its center mirror outside the frame’s block grid', () => {
    const { partners } = canvasSymmetryStamps(
      20, 2, 1, { flags: { ...OFF, mirrorQuad: true }, frame },
    );
    expect(partners).toContainEqual({ x: -13, y: 2, mH: true, mV: false, rot: 0 });
    expect(partners).toContainEqual({ x: -13, y: 5, mH: true, mV: true, rot: 0 });
    expect(partners).toContainEqual({ x: 20, y: 5, mH: false, mV: true, rot: 0 });
  });

  test('H+V yields the three-partner orbit', () => {
    const { partners } = canvasSymmetryStamps(1, 2, 1, { flags: HV, frame });
    expect(partners).toHaveLength(3);
    expect(partners).toContainEqual({ x: 6, y: 2, mH: true, mV: false, rot: 0 });
    expect(partners).toContainEqual({ x: 1, y: 5, mH: false, mV: true, rot: 0 });
    expect(partners).toContainEqual({ x: 6, y: 5, mH: true, mV: true, rot: 0 });
  });

  test('a diagonal reflects across the DRAWN line — the tile it bisects self-maps', () => {
    const DIAG: PatternSymmetry = { ...OFF, mirrorDiag1: true };
    // An odd frame: center (4.5, 4.5), the / -partner diagonal runs
    // corner-to-corner through the cells x = y, bisecting each.
    const odd = { cellX: 0, cellY: 0, cellWidth: 9, cellHeight: 9 };
    const off = canvasSymmetryStamps(1, 2, 1, { flags: DIAG, frame: odd });
    expect(off.partners).toEqual([{ x: 2, y: 1, mH: true, mV: false, rot: 270 }]);
    // A stamp ON the line: no partner, the bisected tile reports its axis
    // (the pick is then constrained to self-symmetric tiles).
    const on = canvasSymmetryStamps(3, 3, 1, { flags: DIAG, frame: odd });
    expect(on.partners).toEqual([]);
    // The self record carries d1 (the axis) — plus h, which rides along
    // from the diag op's transform flags (mH is part of the reflection's
    // mirror+turn composition; the engine's self-capture has always read
    // it as an axis too).
    expect(on.self).toEqual({ h: true, v: false, d1: true, d2: false });
  });

  test('a non-square matched-parity frame still reflects about the true center diagonal', () => {
    const DIAG: PatternSymmetry = { ...OFF, mirrorDiag1: true };
    // 10×8: center (5, 4) — both on edges, one parity. The drawn diagonal
    // is x − y = 1 in cell terms; (3, 1) reflects to (2, 2).
    const frame10x8 = { cellX: 0, cellY: 0, cellWidth: 10, cellHeight: 8 };
    const { partners } = canvasSymmetryStamps(3, 1, 1, { flags: DIAG, frame: frame10x8 });
    expect(partners).toEqual([{ x: 2, y: 2, mH: true, mV: false, rot: 270 }]);
  });
});

describe('the continuous orbit (strokes, shapes, paint dabs)', () => {
  const frame = { cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8 };
  const spec = (flags: PatternSymmetry) => ({ flags, frame });

  test('each mode yields its orbit size', () => {
    expect(symmetryAffineMaps(spec(H), 1, 2, 2)).toHaveLength(1);
    expect(symmetryAffineMaps(spec(HV), 1, 2, 2)).toHaveLength(3);
    expect(symmetryAffineMaps(spec({ ...OFF, mirrorRotate: true }), 1, 2, 2)).toHaveLength(3);
    expect(symmetryAffineMaps(spec({ ...OFF, mirrorDiagBoth: true }), 1, 2, 2)).toHaveLength(3);
    expect(symmetryAffineMaps(spec({ ...OFF, mirrorStar: true }), 1, 2, 2)).toHaveLength(7);
    expect(symmetryAffineMaps(spec({ ...OFF, mirrorQuad: true }), 1, 2, 2)).toHaveLength(15);
    expect(symmetryAffineMaps(spec({ ...OFF, mirrorRow: true }), 1, 2, 2)).toHaveLength(3);
    expect(symmetryAffineMaps(spec({ ...OFF, mirrorCol: true }), 1, 2, 2)).toHaveLength(3);
  });

  test('H reflects points about the center axis; vectors lose the translation', () => {
    const [m] = symmetryAffineMaps(spec(H), 1, 2, 2);
    expect(applySymmetryAffine(m, 1, 2)).toEqual([7, 2]);
    expect(applySymmetryAffine(m, 4, 5)).toEqual([4, 5]); // on the axis
    expect(applySymmetryAffineVec(m, 1, 0.5)).toEqual([-1, 0.5]);
  });

  test('the rotate orbit turns travel vectors with the points', () => {
    const maps = symmetryAffineMaps(spec({ ...OFF, mirrorRotate: true }), 1, 2, 2);
    const r90 = maps.find((m) => m.kind === 'r90')!;
    // 90° CW in y-down: a rightward drag becomes a downward one.
    expect(applySymmetryAffineVec(r90, 1, 0)).toEqual([0, 1]);
    expect(applySymmetryAffine(r90, 4, 2)).toEqual([6, 4]);
  });

  test('quad keeps only the center mirror outside its block grid', () => {
    const outside = symmetryAffineMaps(spec({ ...OFF, mirrorQuad: true }), 1, 20, 2);
    expect(outside).toHaveLength(3);
    const images = outside.map((m) => applySymmetryAffine(m, 20, 2).join(','));
    expect(images.sort()).toEqual(['-12,2', '-12,6', '20,6']);
  });
});

describe('the axis overlay', () => {
  test('off → nothing', () => {
    expect(symmetryOverlayModel(undefined, undefined, 1)).toBeNull();
    expect(symmetryOverlayModel(OFF, { cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8 }, 1)).toBeNull();
  });

  test('H draws one vertical center line; solid on a cell edge, dashed mid-cell', () => {
    const even = symmetryOverlayModel(H, { cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8 }, 0)!;
    expect(even.lines).toEqual([{ kind: 'v', at: 4, dashed: false }]);
    const odd = symmetryOverlayModel(H, { cellX: 0, cellY: 0, cellWidth: 7, cellHeight: 7 }, 0)!;
    expect(odd.lines).toEqual([{ kind: 'v', at: 3.5, dashed: true }]);
  });

  test('quad lights both center lines plus the four within-half quarter lines', () => {
    const m = symmetryOverlayModel(
      { ...OFF, mirrorQuad: true }, { cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8 }, 0,
    )!;
    const centers = m.lines.filter((l) => !l.quarter);
    const quarters = m.lines.filter((l) => l.quarter);
    expect(centers.map((l) => `${l.kind}${l.at}`).sort()).toEqual(['h4', 'v4']);
    expect(quarters.map((l) => `${l.kind}${l.at}`).sort()).toEqual(['h2', 'h6', 'v2', 'v6']);
  });

  test('star and the diag modes turn the diagonals on', () => {
    const frame = { cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8 };
    const star = symmetryOverlayModel({ ...OFF, mirrorStar: true }, frame, 0)!;
    expect(star.diag1 && star.diag2).toBe(true);
    const d1 = symmetryOverlayModel({ ...OFF, mirrorDiag1: true }, frame, 0)!;
    expect(d1.diag1).toBe(true);
    expect(d1.diag2).toBe(false);
    expect(d1.lines).toEqual([]);
  });

  test('the dash rhythm is CONSTANT — regridding never changes the dotting', () => {
    const frame = { cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8 };
    expect(symmetryOverlayModel(H, frame, 0)!.dashPeriod).toBe(0.5);
    expect(symmetryOverlayModel(H, frame, 1)!.dashPeriod).toBe(0.5);
    expect(symmetryOverlayModel(H, frame, 3)!.dashPeriod).toBe(0.5);
    expect(symmetryOverlayModel(H, frame, -2)!.dashPeriod).toBe(0.5);
  });
});

describe('patternOwnSymmetry — the mirror a pattern paints under', () => {
  test('its own stored mode, or none at all', () => {
    expect(patternOwnSymmetry({ symmetry: H })).toBe(H);
    expect(patternOwnSymmetry({ symmetry: OFF })).toBeUndefined();
    expect(patternOwnSymmetry({})).toBeUndefined();
    expect(patternOwnSymmetry(null)).toBeUndefined();
    expect(patternOwnSymmetry(undefined)).toBeUndefined();
  });
});

describe('a selected pattern scopes the mirror to itself', () => {
  // With a pattern object selected, the mirror is THAT pattern's, flags
  // and all: its own stored mode (set on its Symmetry property page), its
  // own box as the frame (axes on its centre, stopping at its edges), tile
  // stamps mirrored inside its grid alone, and the canvas-wide consumers
  // standing down.
  const canvasFrame = { cellX: -40, cellY: -40, cellWidth: 96, cellHeight: 96 };
  const pattern: PatternObject = {
    id: 'pat_1', cellX: 10, cellY: 20, cellWidth: 8, cellHeight: 6,
    cols: 4, rows: 3, cells: new Array(12).fill(null), symmetry: H,
  };

  /** The page the mirror reads: one pattern carrying its own mode, and a
   *  canvas frame planted where the view was. A REAL composition, because
   *  the scoped frame now comes off the graph — the pattern as it is
   *  drawn, not as its legacy fields happen to spell it. */
  function patternState(extra: Partial<PatternObject> = {}): CompositionState {
    return {
      ...makeBlankComposition('sym'),
      symmetry: H,
      symmetryFrame: canvasFrame,
      patternObjects: [{ ...pattern, ...extra }],
      sceneOrder: ['pat_1'],
    };
  }
  const state = patternState();

  test('the spec becomes the pattern’s box, named as the only target', () => {
    expect(canvasSymmetrySpecOf(state, 'pat_1')).toEqual({
      flags: H, frame: { cellX: 10, cellY: 20, cellWidth: 8, cellHeight: 6 }, only: 'pat_1',
    });
    // Any other selection — or none — keeps the canvas frame, unscoped.
    expect(canvasSymmetrySpecOf(state, 'svg_9')).toEqual({ flags: H, frame: canvasFrame });
    expect(canvasSymmetrySpecOf(state, null)).toEqual({ flags: H, frame: canvasFrame });
    expect(canvasSymmetrySpecOf(state)).toEqual({ flags: H, frame: canvasFrame });
    // A hidden pattern is not in hand.
    expect(canvasSymmetrySpecOf(patternState({ hidden: true }), 'pat_1'))
      .toEqual({ flags: H, frame: canvasFrame });
  });

  test('the two mirrors do not reach into each other', () => {
    // The pattern's own mode is the whole of its mirror: the toolbar's
    // canvas setting neither turns it on nor off. A grid with no mode of
    // its own paints unmirrored under a mirrored canvas…
    expect(canvasSymmetrySpecOf({ ...state, patternObjects: [{ ...pattern, symmetry: undefined }] }, 'pat_1'))
      .toBeUndefined();
    expect(canvasSymmetrySpecOf({ ...state, patternObjects: [{ ...pattern, symmetry: OFF }] }, 'pat_1'))
      .toBeUndefined();
    // …and keeps its own under a canvas with none.
    expect(canvasSymmetrySpecOf({ ...state, symmetry: OFF }, 'pat_1')).toEqual({
      flags: H, frame: { cellX: 10, cellY: 20, cellWidth: 8, cellHeight: 6 }, only: 'pat_1',
    });
    // The canvas frame still answers to the canvas setting alone.
    expect(canvasSymmetrySpecOf({ ...state, symmetry: OFF }, null)).toBeUndefined();
  });

  test('the canvas-wide consumers read nothing from a scoped spec', () => {
    const scoped = canvasSymmetrySpecOf(state, 'pat_1');
    expect(canvasWideSymmetry(scoped)).toBeUndefined();
    const wide = canvasSymmetrySpecOf(state, null);
    expect(canvasWideSymmetry(wide)).toBe(wide);
    expect(canvasWideSymmetry(undefined)).toBeUndefined();
  });

  test('stamps mirror about the pattern’s centre, inside its box, and nowhere outside it', () => {
    const scoped = canvasSymmetrySpecOf(state, 'pat_1')!;
    // A cell in the pattern's grid: its H partner across the pattern's own
    // centre (x = 14), a cell of the same grid.
    expect(canvasSymmetryStamps(10, 21, 1, scoped).partners)
      .toEqual([{ x: 17, y: 21, mH: true, mV: false, rot: 0 }]);
    // A cell OUTSIDE the pattern is not the pattern's: no partners, no
    // self-symmetry constraint.
    expect(canvasSymmetryStamps(30, 21, 1, scoped)).toEqual({ partners: [], self: undefined });
    expect(canvasSymmetryStamps(10, 19, 1, scoped)).toEqual({ partners: [], self: undefined });
    // Unscoped, the same canvas frame mirrors far outside itself as ever.
    const wide = canvasSymmetrySpecOf(state, null)!;
    expect(canvasSymmetryStamps(30, 21, 1, wide).partners).toHaveLength(1);
  });

  test('a turned pattern carries its angle on the spec and the bounded model, so the axes turn with it', () => {
    const spec = canvasSymmetrySpecOf(patternState({ angleDeg: 30 }), 'pat_1')!;
    expect(spec.angleDeg).toBe(30);
    expect(symmetryOverlayModel(spec.flags, spec.frame, 0, true, spec.angleDeg)!.angleDeg).toBe(30);
    // Unturned: no field at all (the pins above compare whole objects).
    expect('angleDeg' in canvasSymmetrySpecOf(state, 'pat_1')!).toBe(false);
    // The canvas frame never turns: the angle is a bounded model's alone.
    expect('angleDeg' in symmetryOverlayModel(H, canvasFrame, 0, false, 30)!).toBe(false);
  });

  test('a QUARTER turn turns the axes too - the graph has one turn, not two', () => {
    // The legacy reading took `angleDeg` alone, and a pattern spells a
    // quarter turn in a channel of its own: a pattern turned 90 kept
    // upright axes over a grid that plainly was not.
    const spec = canvasSymmetrySpecOf(patternState({ rotation: 90 }), 'pat_1')!;
    expect(spec.angleDeg).toBe(90);
    // The FOIL: what the legacy fields say, and went on saying.
    expect(patternState({ rotation: 90 }).patternObjects![0].angleDeg).toBeUndefined();
    // The box is the grid's OWN, un-turned - which for a quarter turn is
    // the stored footprint swapped back, on the same centre - with the
    // turn beside it. Same rectangle on screen, and now the axes are the
    // grid's own axes rather than the page's.
    expect(spec.frame).toEqual({ cellX: 11, cellY: 19, cellWidth: 6, cellHeight: 8 });
  });

  test('the overlay model is bounded to the frame only for a scoped mirror', () => {
    const scoped = canvasSymmetrySpecOf(state, 'pat_1')!;
    const m = symmetryOverlayModel(scoped.flags, scoped.frame, 0, !!scoped.only)!;
    expect(m.bounded).toBe(true);
    expect(m.frame).toEqual(scoped.frame);
    expect(m.lines).toEqual([{ kind: 'v', at: 14, dashed: false }]);
    const wide = canvasSymmetrySpecOf(state, null)!;
    expect(symmetryOverlayModel(wide.flags, wide.frame, 0, !!wide.only)!.bounded).toBe(false);
    expect(symmetryOverlayModel(H, canvasFrame, 0)!.bounded).toBe(false);
  });
});

// The shell/canvas wiring is DOM-bound; pin the source, the established
// pattern for RN-shell behaviours the node suite can't render.
