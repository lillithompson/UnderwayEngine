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
import { patternModalTileSize } from '../logic/patternEdit';
import {
  BAR_CUSHION, CONTENT_PAD, PATTERN_SYMMETRY_BUTTON, PATTERN_SYMMETRY_GRID_WIDTH,
  PATTERN_TILE_GRID_GAP, ROW_GAP, ROW_SEGMENTED, ROW_SLIDER, ROW_SWITCH,
  SHEET_PAD_HORIZONTAL, submenuHeight,
} from '../logic/submenuHeight';

describe('the pattern options row', () => {
  it('offers Tile and Symmetry — the panel adds Stroke and Opacity beside them', () => {
    // Tiles and Tools stay off the row (their work is the canvas's tools
    // and the host's floating capsule). Repeat came BACK on it as the Tile
    // page, and Symmetry came back beside it: both are properties of the
    // object, which is what this panel is for. The mirror in particular is
    // the pattern's OWN now, not the mode the canvas toolbar is in.
    expect(PATTERN_EDIT_OPTIONS.map((o) => [o.action, o.label]))
      .toEqual([['tile', 'Tile'], ['symmetry', 'Symmetry']]);
    // The bars all stand, keyed and sized — the two off the row for a
    // host that opens them itself, the two pages for this one.
    for (const action of ['tile', 'tiles', 'tools', 'symmetry'] as const) {
      const sub = patternActionSubmenu(action);
      expect(patternActionOfSubmenu(sub)).toBe(action);
      expect(submenuHeight(sub)).toBeGreaterThan(0);
    }
  });

  it('the Tools bar runs Flood, Close and Clear on the grid', () => {
    expect(PATTERN_GRID_ACTIONS.map((a) => a.action)).toEqual(['flood', 'reconcile', 'clear']);
    // The UI's word for reconciling is "Close" — closing a tile's open
    // ends into its neighbours; the 'reconcile' id stays the internal name.
    expect(PATTERN_GRID_ACTIONS.map((a) => a.label)).toEqual(['Flood', 'Close', 'Clear']);
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
// carrying the pattern's options was never offered for a pattern
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
    // The fold-away closes a page when the selection stops offering it,
    // and it must count patterns as offering Stroke — the bug this pins:
    // the guard knew only showSvgOptions, so opening Stroke on a pattern
    // was immediately folded away and the previously open pattern bar
    // snapped back. There is no separate guard to keep honest any more:
    // the rule reads the TAB ROW, and the pattern branch lists 'stroke'.
    expect(SRC).toContain('const strokeable = !!model.showSvgOptions || !!model.showPatternOptions');
    const order = SRC.slice(
      SRC.indexOf('const typeSubmenuOrder'),
      SRC.indexOf('const submenuOrder'),
    );
    const pattern = order.slice(order.indexOf('model.showPatternOptions'), order.indexOf('model.showStrokeOptions'));
    expect(pattern).toContain("'stroke' as const,");
  });

  it('the Opacity tab a pattern grew does not flicker — one rule answers for it', () => {
    // The bug: Opacity was added to a pattern's tab row and the panel's
    // per-page fold-away was not told, so `canOpacity` said a pattern has
    // no Opacity page. Tapping the tab opened the page, the fold-away shut
    // it on the next render, the landing rule reopened the remembered page
    // because the ROW still offered it, and the tab flickered on and off
    // for as long as it was looked at.
    //
    // The fold-away asks the row now, so the row and the rule cannot
    // disagree — about Opacity or about anything a row is taught later.
    const order = SRC.slice(
      SRC.indexOf('const typeSubmenuOrder'),
      SRC.indexOf('const submenuOrder'),
    );
    const pattern = order.slice(
      order.indexOf('model.showPatternOptions'), order.indexOf('model.showStrokeOptions'),
    );
    expect(pattern).toContain("'opacity' as const,");
    expect(SRC).toContain('orderRef.current.includes(activeSubRef.current)');
    // The hand-written per-page questions are gone, `canOpacity` included.
    expect(SRC).not.toContain('canOpacity');
    expect(SRC).not.toContain('const canShadow');
    expect(SRC).not.toContain('const canBorder');
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

  it('the grid is twelve buttons in six columns — two rows, always', () => {
    // Random + Erase + the recents + '...'. The Tiles bar's height is
    // reserved on that count, so if any of the three changes, so must
    // PATTERN_TILE_GRID.
    expect(PATTERN_ARM_TOOLS.length + PATTERN_RECENT_TILES + 1)
      .toBe(PATTERN_TILE_GRID_COLUMNS * 2);
  });

  it('a fresh session is backed by the head of the menu', () => {
    expect(recentPatternTiles([], MENU).map((t) => t.id))
      .toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });

  it('a pick moves to the head and the padding fills in behind it', () => {
    const recent = pushRecentPatternTile([], 'g');
    expect(recentPatternTiles(recent, MENU).map((t) => t.id))
      .toEqual(['g', 'a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('re-picking a remembered tile promotes it rather than duplicating it', () => {
    let recent: readonly string[] = [];
    for (const id of ['a', 'b', 'c', 'a']) recent = pushRecentPatternTile(recent, id);
    expect(recent).toEqual(['a', 'c', 'b']);
    expect(recentPatternTiles(recent, MENU).map((t) => t.id))
      .toEqual(['a', 'c', 'b', 'd', 'e', 'f', 'g']);
  });

  it('remembers only the last nine', () => {
    let recent: readonly string[] = [];
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
      recent = pushRecentPatternTile(recent, id);
    }
    expect(recent).toEqual(['j', 'i', 'h', 'g', 'f', 'e', 'd', 'c', 'b']);
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

  it('shows fewer than the cap only when the menu itself holds fewer', () => {
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

  it("Random sits over Erase, wearing Facet's palette glyphs", () => {
    // The grid fills column by column (a fixed two-row height wrapping a
    // column stack), so the two arm tools lead the leftmost column…
    expect(SRC).toMatch(/tileGrid:\s*\{\s*flexDirection:\s*'column',\s*flexWrap:\s*'wrap'/);
    // …and wear Facet Tile Palette's icon-over-word dress.
    expect(PATTERN_ARM_TOOLS.map((t) => [t.tool, t.icon])).toEqual([
      ['random', 'shuffle-variant'],
      ['erase', 'eraser'],
    ]);
    expect(tilesBar).toContain('name={t.icon as never}');
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

// The Symmetry page: the canvas modal's SQUARE glyph buttons, on the
// pattern pages' own tile-button scale so the whole grid is two rows
// inside the sheet rather than a screen of its own.
describe('the Symmetry page is a compact grid of square glyph buttons', () => {
  const SRC = readFileSync(resolve(__dirname, '..', 'components', 'PatternBars.tsx'), 'utf8');
  // The grid and the bar that wraps it: the cells moved into a component
  // of their own (PatternSymmetryGrid) when a shape's pattern FILL grew a
  // Symmetry section of its own — one grid, two pages.
  const symBar = SRC.slice(
    SRC.indexOf('export function PatternSymmetryGrid'),
    SRC.indexOf('const MIRRORED_GLYPH'),
  );

  it("has no 'Mirror' label and no labeled segmented rows", () => {
    expect(symBar).not.toContain("'Mirror'");
    expect(symBar).not.toContain('<SegmentedRow');
  });

  it('lays the 11 modes + Off out as one wrapping run of squares', () => {
    // One flat list that WRAPS, where it was three hand-sliced rows of
    // four: the cell is a fixed square now, so the row breaks itself.
    expect(symBar).not.toContain('cells.slice(');
    expect(symBar).toContain('styles.symGrid');
    expect(SRC).toMatch(/symGrid:\s*\{\s*flexDirection: 'row',\s*flexWrap: 'wrap'/);
    // …CAPPED at six buttons wide, which is what makes it two rows at every
    // sheet width: uncapped, a wide desktop sheet stretched all twelve into
    // one row under a page that had reserved two.
    expect(SRC).toContain('maxWidth: PATTERN_SYMMETRY_GRID_WIDTH,');
    expect(PATTERN_SYMMETRY_GRID_WIDTH)
      .toBe(PATTERN_SYMMETRY_BUTTON * 6 + PATTERN_TILE_GRID_GAP * 5);
    // …and it fits the narrowest sheet there is: an SE's 375, less the
    // sheet's own padding and the content area's.
    expect(PATTERN_SYMMETRY_GRID_WIDTH)
      .toBeLessThanOrEqual(375 - 2 * SHEET_PAD_HORIZONTAL - 2 * CONTENT_PAD);
    // Square, and the page's height is exactly the two rows of them.
    expect(SRC).toMatch(/symCell:\s*\{\s*width: PATTERN_SYMMETRY_BUTTON,\s*height: PATTERN_SYMMETRY_BUTTON/);
    expect(submenuHeight('patternSymmetry'))
      .toBe(CONTENT_PAD * 2 + PATTERN_SYMMETRY_BUTTON * 2 + PATTERN_TILE_GRID_GAP + BAR_CUSHION);
  });

  it('wears each mode’s glyph over its word, the canvas modal’s dress', () => {
    // The glyphs come off the shared entries (PATTERN_SYMMETRY_ENTRIES) —
    // the same table the host's canvas Symmetry modal reads — so one mode
    // looks the same wherever it is picked.
    expect(symBar).toContain('value: e.key, label: e.label, icon: e.icon, mirrored: e.mirrored,');
    expect(symBar).toContain("{ value: 'off', label: 'Off', icon: PATTERN_SYMMETRY_OFF_ICON");
    expect(symBar).toContain('<MaterialCommunityIcons');
    expect(symBar).toContain('style={o.mirrored ? MIRRORED_GLYPH : undefined}');
  });

  it('still toggles the active mode back to off', () => {
    // The toggle is the GRID's, so both pages get it without either
    // special-casing the active cell.
    expect(symBar).toContain("onPick(active ? 'off' : o.value)");
    expect(symBar).toContain('onPick={(key) => model.onPatternSymmetry?.(key)}');
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

  it('a pick keeps the takeover up; Done (or the X) is the way out', () => {
    // The sheet used to excuse itself after the double-tap window
    // (setTimeout(onClose, …)); a pick is not a dismissal any more, so
    // tiles can be browsed, re-picked and posed freely, and the floating
    // Done square closes the sheet (its shape is pinned below).
    expect(MODAL).not.toContain('setTimeout(onClose');
    expect(MODAL).not.toContain('closeTimerRef');
    expect(MODAL).toContain('onPress={onClose}');
    // The double-tap rotate still lands as before.
    const doubleTapBranch = MODAL.slice(
      MODAL.indexOf('if (isPatternTileDoubleTap(lastTapRef.current, t.id, now)) {'),
      MODAL.indexOf('} else {'),
    );
    expect(doubleTapBranch).toContain('rotatePatternTileTransform');
  });

  it('the Tiles takeover wears its redesigned dress', () => {
    // Six to a row: the cell size shrinks to seat six wherever the sheet is
    // narrower than six standard tiles (the old fixed 56 wrapped a phone's
    // rows at five with the sixth nearly fitting)…
    expect(patternModalTileSize(390)).toBe(53); // a phone: shrunk to fit six
    expect(390 - 2 * 16).toBeGreaterThanOrEqual(6 * patternModalTileSize(390) + 5 * 8);
    expect(patternModalTileSize(800)).toBe(56); // a wide sheet: the standard cell
    expect(patternModalTileSize(0)).toBe(56); // unmeasured: the standard cell
    // …the selected cell inverts to selection-blue ground + the white bake…
    expect(MODAL).toContain('tileActive: { backgroundColor: STATE_ACTIVE, borderColor: STATE_ACTIVE }');
    expect(MODAL).toContain('uri: active ? t.activeUri ?? t.uri : t.uri');
    // …the sections separate on a light rule, with no caption text…
    expect(MODAL).not.toContain("'1 connection'");
    expect(MODAL).not.toContain('connections`');
    expect(MODAL).toContain('backgroundColor: PANEL_BORDER');
    // …the title and the hint are the head of the SCROLL, not a band over
    // it: they go up with the tiles, with no rule between them and the
    // grid. The title is a page heading's size, well past the 18 a header
    // band wears; the hint is readable rather than fine print.
    expect(MODAL).toContain('<View style={styles.head}>');
    expect(MODAL).toContain('<Text style={styles.title}>Tiles</Text>');
    expect(MODAL).toContain('double tap to rotate, long press to mirror');
    expect(MODAL).toContain("title: { fontSize: 30, fontWeight: '700', color: PANEL_INK }");
    expect(MODAL).toMatch(/hint:\s*\{\s*fontStyle:\s*'italic',\s*fontSize:\s*15,\s*lineHeight:\s*20,/);
    // …the head block sits INSIDE the ScrollView's content, ahead of the
    // sections, so nothing about it is pinned to the screen.
    expect(MODAL.indexOf('<ScrollView')).toBeLessThan(MODAL.indexOf('<View style={styles.head}>'));
    expect(MODAL.indexOf('<View style={styles.head}>')).toBeLessThan(MODAL.indexOf('{groups.map('));
    // …and Done floats over the scroll as a WIDE CAPSULE — the shared
    // AppModalDoneButton in its floating form, spanning the grid it
    // closes, no footer strip behind it, standing clear of the screen's
    // bottom curve, and carrying the word alone (the armed tile it used to
    // wear is gone; the selected cell already says which tile is armed).
    expect(MODAL).toContain('<AppModalDoneButton floating width={doneWidth} onPress={onClose} />');
    expect(MODAL).toContain('const DONE_BOTTOM = 32;');
    expect(MODAL).toContain("position: 'absolute'");
    expect(MODAL).not.toContain('styles.footer');
    expect(MODAL).not.toContain('activeRow');
    expect(MODAL).not.toContain('doneSize');
    // The scroll's foot pads past the capsule so the last row can always
    // escape from under it.
    expect(MODAL).toContain('paddingBottom: DONE_HEIGHT + DONE_BOTTOM + 24');
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
describe('Repeat is the Tile page, and a row of the Tools bar', () => {
  const BARS = readFileSync(resolve(__dirname, '..', 'components', 'PatternBars.tsx'), 'utf8');
  const PANEL = readFileSync(
    resolve(__dirname, '..', 'components', 'ObjectPropertiesPanel.tsx'), 'utf8',
  );
  const patternBranch = PANEL.slice(
    PANEL.indexOf('} else if (model.showPatternOptions) {'),
    PANEL.indexOf('} else if (model.showTextStyle) {'),
  );

  it('the switch row says Repeat, then the switch, then ON or OFF', () => {
    const EB = readFileSync(resolve(__dirname, '..', 'components', 'effectBar.tsx'), 'utf8');
    const row = EB.slice(EB.indexOf('export function SwitchRow'), EB.indexOf('/** One segmented row:'));
    // In that order: the label column, the control, the state word.
    expect(row.indexOf('styles.segLabel')).toBeLessThan(row.indexOf('<Switch'));
    expect(row.indexOf('<Switch')).toBeLessThan(row.indexOf('styles.switchState'));
    expect(row).toContain("{mixed ? 'MULTIPLE' : on ? 'ON' : 'OFF'}");
    // The word is a readout, not a second control: nothing presses it.
    expect(row).not.toContain('Pressable');
    // Measured as a segmented row, so a page that mixes the two keeps one
    // rhythm and the sheet's height arithmetic is unchanged.
    expect(EB).toContain('height: ROW_SWITCH');
    expect(ROW_SWITCH).toBe(ROW_SEGMENTED);
    // The Tile page is that one row: as tall as any other single-row page.
    expect(submenuHeight('patternTile')).toBe(submenuHeight('card'));
  });

  // Several patterns set differently: the switch showed one side's value as
  // if it were everyone's, so it quietly misreported half the objects it
  // was speaking for.
  it('a selection that disagrees reads Multiple, and flipping it forces ON', () => {
    const EB = readFileSync(resolve(__dirname, '..', 'components', 'effectBar.tsx'), 'utf8');
    const row = EB.slice(EB.indexOf('export function SwitchRow'), EB.indexOf('/** One segmented row:'));
    // Mixed rests OFF, whatever `value` says…
    expect(row).toContain('const on = !mixed && value;');
    expect(row).toContain('value={on}');
    // …says so in the word and to the screen reader…
    expect(row).toContain("{mixed ? 'MULTIPLE' : on ? 'ON' : 'OFF'}");
    expect(row).toContain("accessibilityState={mixed ? { checked: 'mixed' } : undefined}");
    // …and a flip from mixed reaches the host, which converges the
    // selection (buildTogglePatternRepeatMulti: not-all-repeating → all on).
    const bars = readFileSync(resolve(__dirname, '..', 'components', 'PatternBars.tsx'), 'utf8');
    expect(bars).toContain('mixed={!!model.repeatMixed}');
    expect(bars).toContain('if (model.repeatMixed || next !== !!model.repeat) model.onToggleRepeat?.();');
    const adapter = readFileSync(resolve(__dirname, '..', 'adapter.ts'), 'utf8');
    expect(adapter).toContain('repeatMixed?: boolean;');
  });

  it('is ONE row definition, shown by both pages', () => {
    // Two copies could offer the setting differently; there is one.
    const row = BARS.slice(
      BARS.indexOf('export function PatternRepeatRow'),
      BARS.indexOf('export function PatternTileBar'),
    );
    expect(row).toContain('if (!model.onToggleRepeat) return null;');
    // A SWITCH with the state in a word beside it (effectBar's SwitchRow),
    // not a two-cell segmented control: Repeat is simply on or off, and
    // Stretch | Tile had to name the off side to have a second cell.
    expect(row).toContain('<SwitchRow');
    expect(row).toContain('label="Repeat"');
    expect(row).toContain('value={!!model.repeat}');
    expect(row).not.toContain('SegmentedRow');
    // Setting it to the side it already shows must not toggle back off.
    expect(row).toContain('if (model.repeatMixed || next !== !!model.repeat) model.onToggleRepeat?.();');
    // The Tile page is that row (carrying Edit at its end, below) and
    // nothing else; the Tools bar shows the same row, bare.
    const tileBar = BARS.slice(
      BARS.indexOf('export function PatternTileBar'),
      BARS.indexOf('export function PatternToolsBar'),
    );
    expect(tileBar).toContain('<PatternRepeatRow');
    const toolsBar = BARS.slice(
      BARS.indexOf('export function PatternToolsBar'),
      BARS.indexOf('export function PatternSymmetryBar'),
    );
    expect(toolsBar).toContain('<PatternRepeatRow model={model} />');
    // …and the panel renders the page the Tile tab names.
    expect(PANEL).toContain("} else if (displaySub === 'patternTile') {");
    expect(PANEL).toContain('<PatternTileBar model={model} />');
  });

  it('carries Edit at the right end of that same line', () => {
    // The way INTO the grid, on the page that is already about this object.
    // It shares the switch's line rather than taking one of its own: a page
    // holding a single setting has the width, and a second row for one
    // button would make the sheet taller for nothing — so the page's
    // reserved height is still the switch row alone.
    const tileBar = BARS.slice(
      BARS.indexOf('export function PatternTileBar'),
      BARS.indexOf('export function PatternToolsBar'),
    );
    expect(tileBar).toContain('trailing={model.onPatternEdit ? (');
    expect(tileBar).toContain(
      '<EffectButton label="Edit" icon="pencil" layout="inline" onPress={model.onPatternEdit} />',
    );
    // …and the row hangs it hard right, clear of the ON / OFF word.
    const effects = readFileSync(resolve(__dirname, '..', 'components', 'effectBar.tsx'), 'utf8');
    expect(effects).toContain('{trailing ? <View style={styles.switchTrailing}>{trailing}</View> : null}');
    expect(effects).toContain("switchTrailing: { marginLeft: 'auto' }");
    // It is the Add pages' button (Add Stroke / Add Fill) in its inline
    // form — the page's one ACT, which is the same kind of thing those are
    // — NOT a second button drawn to look like them.
    expect(effects).toContain('addButtonInline: { flex: 0, height: ROW_SEGMENTED, paddingHorizontal: 12 }');
    expect(effects).toContain(
      "return layout === 'block' ? <View style={styles.emptyControls}>{button}</View> : button;",
    );
    expect(BARS).toContain("import { ActionRow, BarBody, EffectButton, SegmentedRow, SwitchRow } from './effectBar';");
  });

  it('takes the way in as a host callback, so a host can withhold it', () => {
    // Unset when there is no grid to open — no single pattern selected, or
    // the one selected is already open — and the button goes with it.
    const adapter = readFileSync(resolve(__dirname, '..', 'adapter.ts'), 'utf8');
    expect(adapter).toContain('onPatternEdit?(): void;');
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

describe("a shape's pattern fill picks its mirror from the same grid", () => {
  const PANEL = readFileSync(
    resolve(__dirname, '..', 'components', 'ObjectPropertiesPanel.tsx'), 'utf8',
  );

  it('splits the Pattern page into Tile, Symmetry and Stroke sections', () => {
    // Sub-tabs under the one tab, rather than tabs of their own: the tile
    // is one thing with three questions about it. (A pattern OBJECT asks
    // them as tabs, having no other property pages to share a row with.)
    expect(PANEL).toContain("{ value: 'tile' as const, label: 'Tile' },");
    expect(PANEL).toContain("{ value: 'symmetry' as const, label: 'Symmetry' },");
    expect(PANEL).toContain("{ value: 'stroke' as const, label: 'Stroke' },");
    expect(PANEL).toContain('options={SVG_PATTERN_SECTIONS}');
    expect(PANEL).toContain("useState<'tile' | 'symmetry' | 'stroke'>('tile')");
  });

  it('gives the TILES their own line — width, dash and ink', () => {
    // The Border page's own rows, pointed at the mark INSIDE the shape
    // rather than at the outline around it: one component, so the
    // pattern's line is set with the same ranges as every other line.
    expect(PANEL).toContain("svgPatternSection === 'stroke' ? (");
    expect(PANEL).toContain('border={svgPatternStrokeForBar}');
    // No Position row: a mark inside a clip has no side to align to.
    expect(PANEL).toContain('showPosition={false}');
    expect(PANEL).toContain('onOpenColorPicker={() => model.onPickSvgPatternStrokeColor?.()}');
    // Its own draft, so a drag here is never read back as the SHAPE's.
    expect(PANEL).toContain('setSvgPatternStrokeDraft(b);');
    expect(PANEL).toContain('color: model.svgPatternStroke?.color ?? svgPatternStrokeDraft.color,');
  });

  it('measures the Stroke section as the Border page without Position', () => {
    const stroke = submenuHeight('svgPattern', { svgPatternSection: 'stroke' });
    expect(stroke).toBe(
      CONTENT_PAD * 2 + ROW_SEGMENTED + ROW_GAP
      + ROW_SLIDER + ROW_GAP + ROW_SLIDER + ROW_GAP + ROW_SLIDER + BAR_CUSHION,
    );
  });

  it('calls the cells-per-edge row RESOLUTION, not Size', () => {
    // More cells per edge is a DENSER tile, not a bigger one — the stored
    // field is still `size`, but the word on the page was the wrong one
    // and it was the word "Size" that the repeat's drawn size wanted.
    expect(PANEL).toContain('label="Resolution"');
    // …and the readout stays the cells-per-edge pair it always was.
    expect(PANEL).toContain('text: `${size}×${size}`,');
  });

  it('puts a SIZE row under Resolution, for how big the repeat draws', () => {
    // Two independent questions about one tile: Resolution cuts it finer,
    // Size scales the whole motif. The Size row is measured in grid
    // squares and steps in quarters, which keeps the tile lattice a
    // sub-lattice of the page's own.
    expect(PANEL).toContain('const MIN_SVG_PATTERN_SPAN = 0.25;');
    expect(PANEL).toContain('const MAX_SVG_PATTERN_SPAN = 8;');
    expect(PANEL).toContain('const SVG_PATTERN_SPAN_STEP = 0.25;');
    expect(PANEL).toContain('label="Size"');
    expect(PANEL).toContain('model.onSvgPatternSpan?.(next);');
    // …under Resolution, not over it.
    expect(PANEL.indexOf('label="Resolution"')).toBeLessThan(PANEL.indexOf('label="Size"'));
    // Its own draft handle, reset on its own quantity: the two rows are
    // independent, so a Size commit must not drop a Resolution drag.
    expect(PANEL).toContain('setSvgPatternSpanDraft(null);');
    expect(PANEL).toContain('}, [model.svgPatternSpan, model.svgPatternPresent]);');
  });

  it('reserves the Tile section s SECOND slider row', () => {
    // The page is measured before any layout happens, so a row that is
    // rendered and not counted opens the sheet short of its own controls.
    const tile = submenuHeight('svgPattern', { svgPatternSection: 'tile' });
    expect(tile).toBe(
      CONTENT_PAD * 2 + ROW_SEGMENTED + ROW_GAP + ROW_SLIDER + ROW_GAP
      + ROW_SLIDER + ROW_GAP + ROW_SEGMENTED + BAR_CUSHION,
    );
  });

  it('draws the very grid the pattern object draws, bound to the shape', () => {
    expect(PANEL).toContain('<PatternSymmetryGrid');
    expect(PANEL).toContain("value={model.svgPatternSymmetry ?? 'off'}");
    expect(PANEL).toContain('onPick={(key) => model.onSvgPatternSymmetry?.(key)}');
  });

  it('measures the page by the section showing', () => {
    // The mirror grid stands two rows of square buttons where the Tile
    // section is two sliders and a button, so the sheet animates between
    // them rather than reserving the taller of the two. (Tile is the
    // taller of the two now that it asks its second question; before the
    // Size row it was the shorter. The point of the measurement is that
    // the sheet tracks whichever is showing, either way.)
    const tile = submenuHeight('svgPattern', { svgPatternSection: 'tile' });
    const symmetry = submenuHeight('svgPattern', { svgPatternSection: 'symmetry' });
    expect(symmetry).not.toBe(tile);
    expect(symmetry).toBe(
      CONTENT_PAD * 2 + ROW_SEGMENTED + ROW_GAP
      + PATTERN_SYMMETRY_BUTTON * 2 + PATTERN_TILE_GRID_GAP + BAR_CUSHION,
    );
    // …and with nothing said it is the Tile section, the one it opens on.
    expect(submenuHeight('svgPattern')).toBe(tile);
  });
});
