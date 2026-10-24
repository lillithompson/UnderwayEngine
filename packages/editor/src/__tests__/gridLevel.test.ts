import { PATTERN_SYMMETRY_OFF, type CompositionState } from '@/engine/types';
import { makeBlankComposition } from '../blankComposition';
import {
  MAX_GRID_LEVEL, MIN_FORMAT_GRID_LEVEL, MIN_GRID_LEVEL, clampGridLevel, openingGridLevel,
} from '../gridLevel';

// The grid facts every Underway app shares, byte-identical in CozyJournal's
// and Sol's copies before stage 6.5a of docs/shared-editor.md. The ONE
// level an app works at, and the rule that holds a page there while its
// format hides the grid controls, are each app's own.
//
// The left-column capsules step the grid by ±1 — "finer" requests level−1,
// "coarser" level+1 (GridQuickActionPanel) — and the shell clamps the
// result through `clampGridLevel`, so these lock the window's bounds and
// the stepping that pairing produces.

describe('clampGridLevel — the usable resolution window', () => {
  it('passes through levels already inside it', () => {
    for (let l = MIN_GRID_LEVEL; l <= MAX_GRID_LEVEL; l++) expect(clampGridLevel(l)).toBe(l);
  });

  it('clamps below MIN and above MAX rather than wrapping', () => {
    expect(clampGridLevel(MIN_GRID_LEVEL - 1)).toBe(MIN_GRID_LEVEL);
    expect(clampGridLevel(-10)).toBe(MIN_GRID_LEVEL);
    expect(clampGridLevel(MAX_GRID_LEVEL + 1)).toBe(MAX_GRID_LEVEL);
    expect(clampGridLevel(99)).toBe(MAX_GRID_LEVEL);
  });

  it('snaps a fractional level to an integer one', () => {
    expect(clampGridLevel(2.4)).toBe(2);
    expect(clampGridLevel(2.5)).toBe(3);
  });

  it('has a well-ordered window', () => {
    expect(MIN_FORMAT_GRID_LEVEL).toBeLessThan(MIN_GRID_LEVEL);
    expect(MIN_GRID_LEVEL).toBeLessThan(MAX_GRID_LEVEL);
  });
});

describe('the per-format floor (canvas.minGridLevel)', () => {
  it('opens the window downward — Reimagine’s five extra subdivisions', () => {
    for (let l = -5; l <= MAX_GRID_LEVEL; l++) expect(clampGridLevel(l, -5)).toBe(l);
    expect(clampGridLevel(-6, -5)).toBe(-5);
  });

  it('never opens past the persistence-exact floor', () => {
    expect(clampGridLevel(-99, -99)).toBe(MIN_FORMAT_GRID_LEVEL);
  });

  it('only ever widens: a floor above the app-wide one is ignored', () => {
    expect(clampGridLevel(0, 3)).toBe(MIN_GRID_LEVEL);
  });

  it('absent, the classic window stands', () => {
    expect(clampGridLevel(-3)).toBe(MIN_GRID_LEVEL);
  });
});

describe('finer / coarser stepping — the panel’s ±1, then the clamp', () => {
  const finer = (l: number) => clampGridLevel(l - 1);
  const coarser = (l: number) => clampGridLevel(l + 1);

  it('finer lowers the level and bottoms out', () => {
    expect(finer(5)).toBe(4);
    let l = 3;
    for (let i = 0; i < 10; i++) l = finer(l);
    expect(l).toBe(MIN_GRID_LEVEL);
  });

  it('coarser raises it and tops out', () => {
    expect(coarser(4)).toBe(5);
    let l = 3;
    for (let i = 0; i < 10; i++) l = coarser(l);
    expect(l).toBe(MAX_GRID_LEVEL);
  });

  it('the two undo each other away from the bounds', () => {
    expect(coarser(finer(3))).toBe(3);
  });
});

// The level a page minted THIS open starts at: the pane it opens on
// (firstSelectionName) sets it when that pane is a grid the Tile tool can
// work; else the format's declared level; else the page's own.
describe('openingGridLevel', () => {
  const pane = (id: string, name: string, step: number, over: object = {}) => ({
    id, name, cellX: 0, cellY: 0, cellWidth: step * 2, cellHeight: step * 2, cols: 2, rows: 2,
    cells: [null, null, null, null], symmetry: PATTERN_SYMMETRY_OFF, ...over,
  });
  const page = (...panes: object[]): CompositionState => {
    const blank = makeBlankComposition('c1', 'Window');
    return {
      ...blank, gridLevel: 1,
      patternObjects: panes as never, sceneOrder: panes.map((p) => (p as { id: string }).id),
    };
  };
  const window = { firstSelectionName: 'Center', canvas: { gridLevel: 3, minGridLevel: -1 } };

  it('is the named pane’s own level — whatever the file or the format says', () => {
    expect(openingGridLevel(window, page(pane('pat_c', 'Center', 8)))).toBe(3);
    expect(openingGridLevel(window, page(pane('pat_c', 'Center', 16)))).toBe(4);
    expect(openingGridLevel(window, page(pane('pat_c', 'Center', 0.5)))).toBe(-1);
    // The first so named in paint order, as the selection itself resolves.
    expect(openingGridLevel(window, page(pane('pat_a', 'Center', 2), pane('pat_b', 'Center', 8)))).toBe(1);
  });

  it('clamps that level to the format’s window', () => {
    expect(openingGridLevel(window, page(pane('pat_c', 'Center', 0.25)))).toBe(-1);
    expect(openingGridLevel(window, page(pane('pat_c', 'Center', 256)))).toBe(MAX_GRID_LEVEL);
    expect(openingGridLevel(
      { ...window, canvas: { gridLevel: 3 } }, page(pane('pat_c', 'Center', 0.5)),
    )).toBe(MIN_GRID_LEVEL);
  });

  it('falls back to the declared level when the pane is missing or not a workable grid', () => {
    expect(openingGridLevel(window, page())).toBe(3);
    expect(openingGridLevel(window, page(pane('pat_c', 'Middle', 8)))).toBe(3);
    // A repeating border, an off-power step: no level the tool joins them at.
    expect(openingGridLevel(window, page(pane('pat_c', 'Center', 8, { tileMode: 'repeat' })))).toBe(3);
    expect(openingGridLevel(window, page(pane('pat_c', 'Center', 3)))).toBe(3);
    // A format that names no node: the declared level, clamped as ever.
    expect(openingGridLevel({ canvas: { gridLevel: 9 } }, page(pane('pat_c', 'Center', 8)))).toBe(MAX_GRID_LEVEL);
  });

  it('leaves the page’s own level alone when the format declares none and names nothing', () => {
    expect(openingGridLevel({ canvas: {} }, page())).toBe(1);
    expect(openingGridLevel({ canvas: {} }, page(pane('pat_c', 'Center', 8)))).toBe(1);
  });
});
