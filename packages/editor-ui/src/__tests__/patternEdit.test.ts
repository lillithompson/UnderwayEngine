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
  PATTERN_TILE_GRID_COLUMNS,
  type PatternTileRow,
  groupPatternTiles,
  pushRecentPatternTile,
  recentPatternTiles,
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

  it('the Tools bar grows to hold whichever page is taller', () => {
    const plain = submenuHeight('patternTools');
    const withSets = submenuHeight('patternTools', { patternTileSetCount: 5 });
    // No sets: Grid and Borders, two rows (Random and Erase moved to the
    // Tiles bar). Five sets: the Sets row makes three, and the chip page
    // (2 chip rows + Done) ties it.
    expect(withSets).toBeGreaterThan(plain);
    // Ten sets: the chip page (4 rows + Done) overtakes the main page.
    expect(submenuHeight('patternTools', { patternTileSetCount: 10 }))
      .toBeGreaterThan(withSets);
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

  it("the '...' button opens the takeover, which arms and dismisses", () => {
    expect(tilesBar).toContain('onPress={() => setShowAll(true)}');
    expect(tilesBar).toContain('<PatternTileModal');
    expect(tilesBar).toContain('tiles={model.patternTiles ?? []}');
    expect(tilesBar).toContain('onPick={(id) => { setShowAll(false); model.onPatternPickTile?.(id); }}');
  });
});
