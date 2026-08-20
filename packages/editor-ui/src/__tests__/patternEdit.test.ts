import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  PATTERN_ARM_TOOLS,
  PATTERN_DEFAULT_TILE_SETS,
  PATTERN_EDIT_OPTIONS,
  PATTERN_GRID_ACTIONS,
  PATTERN_RECENT_TILES,
  PATTERN_SYMMETRY_ENTRIES,
  PATTERN_SYMMETRY_FLAGS_OFF,
  PATTERN_TILE_DOUBLE_TAP_MS,
  PATTERN_TILE_GRID_COLUMNS,
  PATTERN_TILE_TRANSFORM_IDENTITY,
  type PatternTileRow,
  type PatternTileTransform,
  groupPatternTiles,
  isPatternTileDoubleTap,
  mirrorPatternTileTransform,
  patternTileThumbTransforms,
  pushRecentPatternTile,
  recentPatternTiles,
  rotatePatternTileTransform,
  patternActionOfSubmenu,
  patternActionSubmenu,
  patternSymmetryForKey,
  patternSymmetryKey,
  patternTileSetLabel,
  patternTileSetRows,
} from '../logic/patternEdit';
import { submenuHeight } from '../logic/submenuHeight';

describe('the pattern options row', () => {
  it('offers Tiles, Tools and Symmetry, in that order', () => {
    expect(PATTERN_EDIT_OPTIONS.map((o) => o.action)).toEqual(['tiles', 'tools', 'symmetry']);
    for (const o of PATTERN_EDIT_OPTIONS) expect(o.label.length).toBeGreaterThan(0);
  });

  it('the Tools bar runs Flood, Reconcile and Clear on the grid', () => {
    expect(PATTERN_GRID_ACTIONS.map((a) => a.action)).toEqual(['flood', 'reconcile', 'clear']);
  });

  it('maps each action to its submenu key and back', () => {
    for (const o of PATTERN_EDIT_OPTIONS) {
      const sub = patternActionSubmenu(o.action);
      expect(patternActionOfSubmenu(sub)).toBe(o.action);
      // Every pattern bar has a height — the exhaustiveness guard would
      // make a missing case a compile error, but a zero would stunt it.
      expect(submenuHeight(sub)).toBeGreaterThan(0);
    }
    expect(patternActionOfSubmenu('shadow')).toBeNull();
  });
});

describe('the symmetry grid', () => {
  it('carries the 11 modes of the old modal, each an exclusive flag set', () => {
    expect(PATTERN_SYMMETRY_ENTRIES.map((e) => e.key)).toEqual(
      ['h', 'v', 'hv', 'd1', 'd2', 'dx', 'row', 'col', 'quad', 'rot', 'star'],
    );
    for (const e of PATTERN_SYMMETRY_ENTRIES) {
      const litFlags = Object.values(e.flags).filter(Boolean).length;
      // Exactly one mode's flags — H+V is the one two-flag entry.
      expect(litFlags).toBe(e.key === 'hv' ? 2 : 1);
    }
  });

  it('round-trips key ↔ flags, with off as the empty set', () => {
    for (const e of PATTERN_SYMMETRY_ENTRIES) {
      expect(patternSymmetryKey(patternSymmetryForKey(e.key))).toBe(e.key);
    }
    expect(patternSymmetryForKey('off')).toBeUndefined();
    expect(patternSymmetryKey(undefined)).toBe('off');
    expect(patternSymmetryKey(PATTERN_SYMMETRY_FLAGS_OFF)).toBe('off');
  });

  it('reads an unknown flag combination as off rather than mislabeling it', () => {
    expect(patternSymmetryKey({ ...PATTERN_SYMMETRY_FLAGS_OFF, mirrorH: true, mirrorStar: true }))
      .toBe('off');
  });
});

// No test renderer for the panel component, so its flag-enumeration sites
// are pinned by source — the bug this guards: showPatternOptions had a
// typeSpecs branch but was missing from `hasTypeOptions`, so the type page
// carrying Tiles / Tools / Symmetry was never offered for a pattern
// selection.
describe('the panel offers the pattern type page', () => {
  const SRC = readFileSync(
    resolve(__dirname, '..', 'components', 'ObjectPropertiesPanel.tsx'), 'utf8',
  );

  it('counts showPatternOptions into hasTypeOptions and the type signature', () => {
    const hasTypeOptions = SRC.slice(
      SRC.indexOf('const hasTypeOptions ='),
      SRC.indexOf('const hasMultiOptions ='),
    );
    expect(hasTypeOptions).toContain('model.showPatternOptions');
    const typeSig = SRC.slice(SRC.indexOf('const typeSig ='), SRC.indexOf('const prevTypeSig'));
    expect(typeSig).toContain('showPatternOptions');
  });

  it('lets a pattern selection keep the Stroke bar open', () => {
    // The fold-away guard closes strokeOpen when the selection stops
    // offering the bar. It must count patterns as offering it — the bug
    // this pins: the guard knew only showSvgOptions, so opening Stroke on
    // a pattern was immediately folded away and the previously open
    // pattern bar snapped back.
    const guard = SRC.slice(
      SRC.indexOf('const strokeable ='),
      SRC.indexOf('if ((!model.visible || !svgFillable)'),
    );
    expect(guard).toContain('model.showPatternOptions');
    expect(guard).toContain('if ((!model.visible || !strokeable) && model.strokeOpen)');
  });

  it('builds the pattern typeSpecs branch, with the shared Stroke bar', () => {
    expect(SRC).toContain('else if (model.showPatternOptions) {');
    const order = SRC.slice(
      SRC.indexOf('const typeSubmenuOrder'),
      SRC.indexOf('const submenuOrder'),
    );
    // The pattern's pages plus the vectors' Stroke bar ride the carousel.
    expect(order).toContain('model.showPatternOptions');
    expect(order).toContain("'stroke' as const");
  });
});

describe('the tile-set filter', () => {
  it('defaults to Angular and Curved on', () => {
    expect([...PATTERN_DEFAULT_TILE_SETS]).toEqual(['angular', 'curved']);
  });

  it('builds deduped, alphabetical chip rows with capitalized labels', () => {
    const rows = patternTileSetRows(
      ['curved', 'angular', 'petal', 'curved', 'cloud'],
      new Set(['angular', 'curved']),
    );
    expect(rows).toEqual([
      { family: 'angular', label: 'Angular', enabled: true },
      { family: 'cloud', label: 'Cloud', enabled: false },
      { family: 'curved', label: 'Curved', enabled: true },
      { family: 'petal', label: 'Petal', enabled: false },
    ]);
    expect(patternTileSetLabel('craftsman')).toBe('Craftsman');
  });

  it('the Tools bar reserves one Sets row, however many sets there are', () => {
    const plain = submenuHeight('patternTools');
    const withSets = submenuHeight('patternTools', { patternTileSetCount: 5 });
    // No sets: Grid and Borders, two rows (Random and Erase moved to the
    // Tiles bar). Any sets: the Sets row makes three.
    expect(withSets).toBeGreaterThan(plain);
    // The filter itself opens as a full-screen takeover (PatternSetsModal),
    // so MORE sets never grow the bar.
    expect(submenuHeight('patternTools', { patternTileSetCount: 10 })).toBe(withSets);
  });
});

describe("the Tiles bar's arming grid", () => {
  const tile = (id: string): PatternTileRow => ({ id, connections: 0, uri: `u:${id}` });
  const MENU = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(tile);

  it('the grid is eight buttons in four columns — two rows, always', () => {
    // Random + Erase + the recents + '...'. The Tiles bar's height is
    // reserved on that count, so if any of the three changes, so must
    // PATTERN_TILE_GRID.
    expect(PATTERN_ARM_TOOLS.length + PATTERN_RECENT_TILES + 1)
      .toBe(PATTERN_TILE_GRID_COLUMNS * 2);
  });

  it('a fresh session is backed by the head of the menu', () => {
    expect(recentPatternTiles([], MENU).map((t) => t.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('a pick moves to the head and the padding fills in behind it', () => {
    const recent = pushRecentPatternTile([], 'g');
    expect(recentPatternTiles(recent, MENU).map((t) => t.id))
      .toEqual(['g', 'a', 'b', 'c', 'd']);
  });

  it('re-picking a remembered tile promotes it rather than duplicating it', () => {
    let recent: readonly string[] = [];
    for (const id of ['a', 'b', 'c', 'a']) recent = pushRecentPatternTile(recent, id);
    expect(recent).toEqual(['a', 'c', 'b']);
    expect(recentPatternTiles(recent, MENU).map((t) => t.id))
      .toEqual(['a', 'c', 'b', 'd', 'e']);
  });

  it('remembers only the last five', () => {
    let recent: readonly string[] = [];
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) recent = pushRecentPatternTile(recent, id);
    expect(recent).toEqual(['f', 'e', 'd', 'c', 'b']);
  });

  it('drops a remembered tile whose set was switched off, and backfills', () => {
    // 'f' and 'g' are gone from the menu — the grid must not offer a brush
    // the filter has taken away, so they fall out and the menu pads back up.
    let recent: readonly string[] = [];
    for (const id of ['f', 'g', 'a']) recent = pushRecentPatternTile(recent, id);
    const narrowed = MENU.filter((t) => t.id !== 'f' && t.id !== 'g');
    expect(recentPatternTiles(recent, narrowed).map((t) => t.id))
      .toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('shows fewer than five only when the menu itself holds fewer', () => {
    expect(recentPatternTiles(['b'], MENU.slice(0, 3)).map((t) => t.id))
      .toEqual(['b', 'a', 'c']);
    expect(recentPatternTiles(['x'], [])).toEqual([]);
  });
});

describe('the tile menu grouping', () => {
  it('sections by connection count, ascending, skipping empty counts', () => {
    const tiles = [
      { id: 'a/tile_11111111', connections: 8, uri: 'u1' },
      { id: 'a/tile_00000000', connections: 0, uri: 'u2' },
      { id: 'a/tile_10101010', connections: 4, uri: 'u3' },
      { id: 'b/tile_01010101', connections: 4, uri: 'u4' },
    ];
    const groups = groupPatternTiles(tiles);
    expect(groups.map((g) => g.connections)).toEqual([0, 4, 8]);
    expect(groups[1].tiles.map((t) => t.id)).toEqual(['a/tile_10101010', 'b/tile_01010101']);
  });

  it('is empty for an empty menu', () => {
    expect(groupPatternTiles([])).toEqual([]);
  });
});

// The bars are react-native and never render in node, so their wiring is
// pinned by source. What this guards: Random and Erase moving out of the
// Tools bar is only half the change — if they don't land in the Tiles
// grid, the pattern tool loses its eraser entirely.
describe('the Tiles bar carries the arming grid', () => {
  const SRC = readFileSync(resolve(__dirname, '..', 'components', 'PatternBars.tsx'), 'utf8');
  const tilesBar = SRC.slice(
    SRC.indexOf('export function PatternTilesBar'),
    SRC.indexOf('export function PatternToolsBar'),
  );
  const toolsBar = SRC.slice(
    SRC.indexOf('export function PatternToolsBar'),
    SRC.indexOf('export function PatternSymmetryBar'),
  );

  it('arms Random and Erase from the Tiles bar, not the Tools bar', () => {
    expect(tilesBar).toContain('PATTERN_ARM_TOOLS.map');
    expect(tilesBar).toContain('model.onPatternArmTool?.(t.tool)');
    expect(toolsBar).not.toContain('PATTERN_ARM_TOOLS');
    expect(toolsBar).not.toContain('onPatternArmTool');
  });

  it('shows the recents, not the whole menu, and lights exactly one button', () => {
    expect(tilesBar).toContain('model.patternRecentTiles ?? []');
    expect(tilesBar).toContain("const activeId = tool === 'tile' ? model.patternActiveTileId ?? null : null");
    // A tile's square lights on its own id; the two word buttons light on
    // the armed kind — so whichever is in hand, one and only one is lit.
    expect(tilesBar).toContain('const active = t.id === activeId;');
    expect(tilesBar).toContain('const active = tool === t.tool;');
  });

  it("the '...' button opens the takeover, which arms on pick", () => {
    expect(tilesBar).toContain('onPress={() => setShowAll(true)}');
    expect(tilesBar).toContain('<PatternTileModal');
    expect(tilesBar).toContain('tiles={model.patternTiles ?? []}');
    // Dismissal is the modal's own business now (it waits out the
    // double-tap window); the bar just arms.
    expect(tilesBar).toContain('onPick={(id) => model.onPatternPickTile?.(id)}');
  });
});

// The Symmetry bar's modes as a plain 4×3 grid — no 'Mirror' label column,
// every cell a flex rectangle splitting the bar's full width.
describe('the Symmetry bar is a label-less 4×3 grid', () => {
  const SRC = readFileSync(resolve(__dirname, '..', 'components', 'PatternBars.tsx'), 'utf8');
  const symBar = SRC.slice(
    SRC.indexOf('export function PatternSymmetryBar'),
    SRC.indexOf('const TILE = PATTERN_TILE_BUTTON'),
  );

  it("has no 'Mirror' label and no labeled segmented rows", () => {
    expect(symBar).not.toContain("'Mirror'");
    expect(symBar).not.toContain('<SegmentedRow');
  });

  it('lays the 11 modes + Off out four to a row, cells stretching', () => {
    expect(symBar).toContain('cells.slice(0, 4), cells.slice(4, 8), cells.slice(8, 12)');
    expect(symBar).toContain('styles.symRow');
    // flex: 1 on the cell is what makes the rectangles split the width.
    expect(SRC).toMatch(/symCell:\s*\{\s*flex:\s*1/);
  });

  it('still toggles the active mode back to off', () => {
    expect(symBar).toContain("model.onPatternSymmetry?.(active ? 'off' : o.value)");
  });
});

// The Sets filter as a full-screen takeover (Facet's Randomization
// Settings), replacing the old in-bar chip page.
describe('the Sets filter opens as a full-screen takeover', () => {
  const BARS = readFileSync(resolve(__dirname, '..', 'components', 'PatternBars.tsx'), 'utf8');
  const MODAL = readFileSync(resolve(__dirname, '..', 'components', 'PatternSetsModal.tsx'), 'utf8');
  const toolsBar = BARS.slice(
    BARS.indexOf('export function PatternToolsBar'),
    BARS.indexOf('export function PatternSymmetryBar'),
  );

  it('the Tools bar opens the modal instead of flipping to a chip page', () => {
    expect(toolsBar).toContain('<PatternSetsModal');
    expect(toolsBar).toContain('onPress={() => setShowSets(true)}');
    expect(toolsBar).not.toContain('MultiToggleRow');
  });

  it("copies Facet's layout: full-width set cells, then the border switch, no multi-layer fill", () => {
    expect(MODAL).toContain('title="Randomization Settings"');
    expect(MODAL).toContain('onToggleSet(s.family)');
    expect(MODAL).toContain('Border Connections');
    // Exactly ONE switch renders — Border Connections. Facet's second
    // (Multi-layer Fill) is deliberately not copied.
    expect(MODAL.match(/<Switch/g)).toHaveLength(1);
  });

  it('the switch drives the same border rule as the Borders row', () => {
    expect(toolsBar).toContain('allowBorder={model.patternAllowBorder !== false}');
    expect(toolsBar).toContain('onToggleBorder={() => model.onPatternToggleBorder?.()}');
  });
});

// The Facet tile-editor's pose UX, ported: a second tap on a tile inside
// the double-tap window turns it a quarter clockwise, and a long press
// opens the transform modal (rotate + the two flips). Both the Tiles bar's
// recent grid and the '...' takeover speak it, and both draw their
// thumbnails in the stored pose — the button must show what the stamp will
// lay.
describe('the tile pose gestures (double-tap turn, long-press transform)', () => {
  const BARS = readFileSync(resolve(__dirname, '..', 'components', 'PatternBars.tsx'), 'utf8');
  const MODAL = readFileSync(
    resolve(__dirname, '..', 'components', 'PatternTileModal.tsx'), 'utf8',
  );
  const XFORM = readFileSync(
    resolve(__dirname, '..', 'components', 'PatternTileTransformModal.tsx'), 'utf8',
  );
  const tilesBar = BARS.slice(
    BARS.indexOf('export function PatternTilesBar'),
    BARS.indexOf('export function PatternToolsBar'),
  );

  it('a double tap rotates a quarter clockwise, keeping the mirrors', () => {
    expect(rotatePatternTileTransform({ rotation: 0, mirrorH: true, mirrorV: false }))
      .toEqual({ rotation: 90, mirrorH: true, mirrorV: false });
    expect(rotatePatternTileTransform({ rotation: 270, mirrorH: false, mirrorV: true }))
      .toEqual({ rotation: 0, mirrorH: false, mirrorV: true });
  });

  it('four double taps come back around', () => {
    let t = PATTERN_TILE_TRANSFORM_IDENTITY;
    for (let i = 0; i < 4; i++) t = rotatePatternTileTransform(t);
    expect(t).toEqual(PATTERN_TILE_TRANSFORM_IDENTITY);
  });

  it("a flip is VISUAL — it inverts the rotation, as the engine's applyVisualMirror does", () => {
    // The engine bakes mirrors first, then rotation; a visual flip of a
    // rotated tile therefore flips the flag AND runs the rotation backwards.
    expect(mirrorPatternTileTransform({ rotation: 90, mirrorH: false, mirrorV: false }, 'h'))
      .toEqual({ rotation: 270, mirrorH: true, mirrorV: false });
    expect(mirrorPatternTileTransform({ rotation: 0, mirrorH: false, mirrorV: true }, 'v'))
      .toEqual({ rotation: 0, mirrorH: false, mirrorV: false });
    // Self-inverse: flipping twice is the pose you started in.
    const posed: PatternTileTransform = { rotation: 180, mirrorH: true, mirrorV: false };
    expect(mirrorPatternTileTransform(mirrorPatternTileTransform(posed, 'h'), 'h')).toEqual(posed);
    expect(mirrorPatternTileTransform(mirrorPatternTileTransform(posed, 'v'), 'v')).toEqual(posed);
  });

  it('the double-tap window: same tile inside the window only', () => {
    const last = { id: 'a', time: 1000 };
    expect(isPatternTileDoubleTap(last, 'a', 1000 + PATTERN_TILE_DOUBLE_TAP_MS - 1)).toBe(true);
    expect(isPatternTileDoubleTap(last, 'a', 1000 + PATTERN_TILE_DOUBLE_TAP_MS)).toBe(false);
    expect(isPatternTileDoubleTap(last, 'b', 1001)).toBe(false);
    expect(isPatternTileDoubleTap({ id: '', time: 0 }, 'a', 1)).toBe(false);
  });

  it("thumbnails pose rotate-first, Facet's TileSvgThumbnail order, and identity adds nothing", () => {
    expect(patternTileThumbTransforms({ rotation: 90, mirrorH: true, mirrorV: true }))
      .toEqual([{ rotate: '90deg' }, { scaleX: -1 }, { scaleY: -1 }]);
    expect(patternTileThumbTransforms(PATTERN_TILE_TRANSFORM_IDENTITY)).toEqual([]);
    expect(patternTileThumbTransforms(undefined)).toEqual([]);
  });

  it('both grids speak both gestures, through the one host callback', () => {
    for (const src of [tilesBar, MODAL]) {
      expect(src).toContain('isPatternTileDoubleTap(lastTapRef.current, t.id, now)');
      expect(src).toContain('rotatePatternTileTransform');
      expect(src).toContain('onLongPress={');
      expect(src).toContain('<PatternTileTransformModal');
    }
    expect(tilesBar).toContain('model.onPatternSetTileTransform?.(t.id, rotatePatternTileTransform(xform))');
    expect(MODAL).toContain('onSetTransform?.(t.id, rotatePatternTileTransform(poseOf(t.id)))');
    // A long press also ARMS the tile (Facet's palette does), so the pose
    // being edited is the pose in hand.
    expect(tilesBar).toContain('model.onPatternPickTile?.(t.id);\n                  setTransformId(t.id);');
    expect(MODAL).toContain('onPick(t.id);\n                        setTransformId(t.id);');
  });

  it('both grids draw their thumbnails in the stored pose', () => {
    expect(tilesBar).toContain('transform: patternTileThumbTransforms(xform)');
    expect(MODAL).toContain('transform: patternTileThumbTransforms(poseOf(t.id))');
  });

  it('the takeover waits out the double-tap window before dismissing', () => {
    expect(MODAL).toContain('closeTimerRef.current = setTimeout(onClose, PATTERN_TILE_DOUBLE_TAP_MS);');
    // ...and a rotate keeps it up: the second tap cancels the pending exit.
    const doubleTapBranch = MODAL.slice(
      MODAL.indexOf('if (isPatternTileDoubleTap(lastTapRef.current, t.id, now)) {'),
      MODAL.indexOf('} else {'),
    );
    expect(doubleTapBranch).toContain('cancelClose();');
  });

  it('the transform modal offers rotate and the two flips, previewed in the pose', () => {
    expect(XFORM).toContain('onChange(rotatePatternTileTransform(transform))');
    expect(XFORM).toContain("onChange(mirrorPatternTileTransform(transform, 'h'))");
    expect(XFORM).toContain("onChange(mirrorPatternTileTransform(transform, 'v'))");
    expect(XFORM).toContain('transform: patternTileThumbTransforms(transform)');
  });
});

// Repeat used to be a lit capsule beside Tiles / Tools / Symmetry. It is a
// setting, not a page, and the pattern's top row was already four pages
// long — so it moved down into the Tools bar. The svg branch keeps its own
// capsule: legacy tiled vectors have no Tools bar to move it into.
describe('Repeat rides the Tools bar', () => {
  const BARS = readFileSync(resolve(__dirname, '..', 'components', 'PatternBars.tsx'), 'utf8');
  const PANEL = readFileSync(
    resolve(__dirname, '..', 'components', 'ObjectPropertiesPanel.tsx'), 'utf8',
  );
  const patternBranch = PANEL.slice(
    PANEL.indexOf('} else if (model.showPatternOptions) {'),
    PANEL.indexOf('} else if (model.showEdit || model.showTextStyle) {'),
  );

  it('is a row on the Tools bar, toggled through the same handler', () => {
    const toolsBar = BARS.slice(
      BARS.indexOf('export function PatternToolsBar'),
      BARS.indexOf('export function PatternSymmetryBar'),
    );
    expect(toolsBar).toContain('{model.onToggleRepeat && (');
    expect(toolsBar).toContain("value={model.repeat ? 'tile' : 'stretch'}");
    // Pressing the side already showing must not toggle back off.
    expect(toolsBar).toContain("if ((v === 'tile') !== !!model.repeat) model.onToggleRepeat?.();");
  });

  it("is gone from the pattern's type row, but kept on the svg branch", () => {
    expect(patternBranch).not.toContain('onToggleRepeat');
    const svgBranch = PANEL.slice(
      PANEL.indexOf('} else if (model.showSvgOptions) {'),
      PANEL.indexOf('} else if (model.showInvert) {'),
    );
    expect(svgBranch).toContain("key: 'repeat',");
  });

  it('the bar reserves the row exactly when it will render it', () => {
    // The guard in the bar is `model.onToggleRepeat`; the height context
    // must be measured off the same thing, or a grouped pattern's bar
    // opens with a row of empty space.
    expect(PANEL).toContain('patternCanRepeat: !!model.onToggleRepeat,');
    const withRepeat = submenuHeight('patternTools', { patternCanRepeat: true });
    expect(withRepeat).toBeGreaterThan(submenuHeight('patternTools'));
    // Repeat and Sets stack — both rows, not one standing in for the other.
    expect(submenuHeight('patternTools', { patternCanRepeat: true, patternTileSetCount: 3 }))
      .toBeGreaterThan(withRepeat);
  });
});
