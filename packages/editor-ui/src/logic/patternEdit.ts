// The pattern-object option rows the ObjectPropertiesPanel shows when an
// inline tile pattern is selected, plus the pure data behind its three
// bars: the symmetry mode grid (ported from the old tile editor's
// SymmetryModal), the tile menu's connection-count grouping, and the Tools
// bar's action set. Kept pure (no react-native) so all of it is
// unit-tested in node, mirroring imageEdit.ts / svgEdit.ts.

/** The ten symmetry flags a pattern's painting can mirror by. Structurally
 *  identical to the engine's PatternSymmetry (declared here too so this
 *  package stays engine-import-free). */
export interface PatternSymmetryFlags {
  mirrorH: boolean;
  mirrorV: boolean;
  mirrorRotate: boolean;
  mirrorQuad: boolean;
  mirrorRow: boolean;
  mirrorCol: boolean;
  mirrorDiag1: boolean;
  mirrorDiag2: boolean;
  mirrorDiagBoth: boolean;
  mirrorStar: boolean;
}

export const PATTERN_SYMMETRY_FLAGS_OFF: PatternSymmetryFlags = {
  mirrorH: false, mirrorV: false, mirrorRotate: false, mirrorQuad: false,
  mirrorRow: false, mirrorCol: false, mirrorDiag1: false, mirrorDiag2: false,
  mirrorDiagBoth: false, mirrorStar: false,
};

/** One entry of the symmetry grid: the mode's key, the word the bar shows,
 *  and the exact flag set it stands for. The grid is EXCLUSIVE — one mode
 *  at a time — so each entry spreads from all-false. */
export interface PatternSymmetryEntry {
  key: string;
  label: string;
  flags: PatternSymmetryFlags;
}

const OFF = PATTERN_SYMMETRY_FLAGS_OFF;

/** The symmetry modes, in display order (the old modal's 4×3 grid, read in
 *  rows). The panel renders them as three segmented rows of four. */
export const PATTERN_SYMMETRY_ENTRIES: readonly PatternSymmetryEntry[] = [
  { key: 'h', label: 'H', flags: { ...OFF, mirrorH: true } },
  { key: 'v', label: 'V', flags: { ...OFF, mirrorV: true } },
  { key: 'hv', label: 'H+V', flags: { ...OFF, mirrorH: true, mirrorV: true } },
  { key: 'd1', label: 'Diag \\', flags: { ...OFF, mirrorDiag1: true } },
  { key: 'd2', label: 'Diag /', flags: { ...OFF, mirrorDiag2: true } },
  { key: 'dx', label: 'Diag X', flags: { ...OFF, mirrorDiagBoth: true } },
  { key: 'row', label: 'Row', flags: { ...OFF, mirrorRow: true } },
  { key: 'col', label: 'Col', flags: { ...OFF, mirrorCol: true } },
  { key: 'quad', label: 'Quad', flags: { ...OFF, mirrorQuad: true } },
  { key: 'rot', label: 'Rotate', flags: { ...OFF, mirrorRotate: true } },
  { key: 'star', label: 'Star', flags: { ...OFF, mirrorStar: true } },
];

function flagsEqual(a: PatternSymmetryFlags, b: PatternSymmetryFlags): boolean {
  return a.mirrorH === b.mirrorH && a.mirrorV === b.mirrorV
    && a.mirrorRotate === b.mirrorRotate && a.mirrorQuad === b.mirrorQuad
    && a.mirrorRow === b.mirrorRow && a.mirrorCol === b.mirrorCol
    && a.mirrorDiag1 === b.mirrorDiag1 && a.mirrorDiag2 === b.mirrorDiag2
    && a.mirrorDiagBoth === b.mirrorDiagBoth && a.mirrorStar === b.mirrorStar;
}

/** The grid key the flag set stands on, or 'off' when no mode matches
 *  (symmetry off, or a flag combination the grid doesn't offer). */
export function patternSymmetryKey(flags: PatternSymmetryFlags | undefined): string {
  if (!flags) return 'off';
  const entry = PATTERN_SYMMETRY_ENTRIES.find((e) => flagsEqual(e.flags, flags));
  return entry?.key ?? 'off';
}

/** The flag set a grid key stands for; undefined for 'off' (symmetry
 *  cleared) — which is also what tapping the ACTIVE mode again means. */
export function patternSymmetryForKey(key: string): PatternSymmetryFlags | undefined {
  return PATTERN_SYMMETRY_ENTRIES.find((e) => e.key === key)?.flags;
}

// ── The tile menu ───────────────────────────────────────────────────

/** One tile the Tiles bar offers: the sprite id the cell will carry, how
 *  many of its 8 connection points are live (the section it files under),
 *  and a data-URI thumbnail the host baked from the tile's vector source
 *  (this package renders it as an <Image>; it never touches the engine's
 *  sprite registry itself). */
export interface PatternTileRow {
  id: string;
  connections: number;
  uri: string;
}

/** Group the tile menu by connection count, ascending, skipping empty
 *  counts — the old TilePalette's horizontally scrolled sections. The full
 *  menu is now the takeover modal's business; the Tiles bar itself shows
 *  only the recent grid (see recentPatternTiles). */
export function groupPatternTiles(
  tiles: readonly PatternTileRow[],
): { connections: number; tiles: PatternTileRow[] }[] {
  const byCount = new Map<number, PatternTileRow[]>();
  for (const t of tiles) {
    const list = byCount.get(t.connections) ?? [];
    list.push(t);
    byCount.set(t.connections, list);
  }
  return [...byCount.entries()]
    .sort(([a], [b]) => a - b)
    .map(([connections, list]) => ({ connections, tiles: list }));
}

// ── The Tiles bar's button grid ─────────────────────────────────────

/** How many recently-used tiles the Tiles bar keeps on its grid. */
export const PATTERN_RECENT_TILES = 9;

/** The grid is six buttons wide, and holds exactly twelve: Random over
 *  Erase in the leftmost column, the nine recent tiles, and the '...'
 *  that opens the full menu — two rows, always (the grid fills column by
 *  column, Facet's palette flow), so the bar's height never moves. */
export const PATTERN_TILE_GRID_COLUMNS = 6;

/** Move `id` to the head of the most-recently-used list, dropping any
 *  earlier appearance and trimming to PATTERN_RECENT_TILES. */
export function pushRecentPatternTile(
  recent: readonly string[],
  id: string,
): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, PATTERN_RECENT_TILES);
}

/** The tiles the grid shows: the remembered ones the menu still offers —
 *  a tile whose set was switched off drops out rather than arming a brush
 *  Random can't reach — padded from the head of `offered` so a user who
 *  has picked nothing yet still finds a full grid of tiles under their
 *  thumb. Returns fewer than PATTERN_RECENT_TILES only when the menu
 *  itself holds fewer. */
export function recentPatternTiles(
  recent: readonly string[],
  offered: readonly PatternTileRow[],
): PatternTileRow[] {
  const byId = new Map(offered.map((t) => [t.id, t]));
  const rows: PatternTileRow[] = [];
  const seen = new Set<string>();
  const take = (row: PatternTileRow | undefined) => {
    if (!row || seen.has(row.id)) return;
    seen.add(row.id);
    rows.push(row);
  };
  for (const id of recent) {
    if (rows.length === PATTERN_RECENT_TILES) return rows;
    take(byId.get(id));
  }
  for (const row of offered) {
    if (rows.length === PATTERN_RECENT_TILES) break;
    take(row);
  }
  return rows;
}

// ── Tile transforms (the Facet tile-editor's pose UX) ───────────────

/** The pose a tile is armed and painted in — a discrete rotation plus the
 *  two mirrors. Structurally identical to the engine's CellTransform
 *  (declared here too so this package stays engine-import-free). */
export interface PatternTileTransform {
  rotation: 0 | 90 | 180 | 270;
  mirrorH: boolean;
  mirrorV: boolean;
}

export const PATTERN_TILE_TRANSFORM_IDENTITY: PatternTileTransform = {
  rotation: 0, mirrorH: false, mirrorV: false,
};

/** How close two taps on the same tile must land to read as a double tap
 *  (Facet's TilePalette window). */
export const PATTERN_TILE_DOUBLE_TAP_MS = 400;

/** Is a tap at `now` on `id` the second half of a double tap, given the
 *  last tap seen? The first tap arms the tile; this one rotates it. */
export function isPatternTileDoubleTap(
  last: { id: string; time: number },
  id: string,
  now: number,
): boolean {
  return last.id === id && now - last.time < PATTERN_TILE_DOUBLE_TAP_MS;
}

/** A quarter turn clockwise, keeping the mirrors — what a double tap does. */
export function rotatePatternTileTransform(t: PatternTileTransform): PatternTileTransform {
  return { ...t, rotation: ((t.rotation + 90) % 360) as 0 | 90 | 180 | 270 };
}

/** Left-compose a VISUAL mirror onto the pose — flip what the eye sees,
 *  whatever rotation it is already under. Flipping a rotated tile is not
 *  just toggling its mirror flag: the engine bakes mirrors first, then
 *  rotation, so the visual flip lands on the near side of the rotation and
 *  the rotation has to invert to compensate (the engine's applyVisualMirror,
 *  ported verbatim — the two must agree or the modal's Flip button would
 *  show one tile and stamp another). */
export function mirrorPatternTileTransform(
  t: PatternTileTransform,
  axis: 'h' | 'v',
): PatternTileTransform {
  return {
    rotation: ((360 - t.rotation) % 360) as 0 | 90 | 180 | 270,
    mirrorH: axis === 'h' ? !t.mirrorH : t.mirrorH,
    mirrorV: axis === 'v' ? !t.mirrorV : t.mirrorV,
  };
}

/** The react-native style `transform` list that shows a thumbnail in its
 *  pose. Rotate leads, mirrors follow — RN applies the list right-to-left,
 *  so the image mirrors first and then rotates, exactly the order the
 *  engine's bake composes them in (and the order Facet's TileSvgThumbnail
 *  uses). Empty for the identity, so an unposed tile adds no style. */
export function patternTileThumbTransforms(
  t: PatternTileTransform | undefined,
): ({ rotate: string } | { scaleX: number } | { scaleY: number })[] {
  const out: ({ rotate: string } | { scaleX: number } | { scaleY: number })[] = [];
  if (!t) return out;
  if (t.rotation !== 0) out.push({ rotate: `${t.rotation}deg` });
  if (t.mirrorH) out.push({ scaleX: -1 });
  if (t.mirrorV) out.push({ scaleY: -1 });
  return out;
}

// ── Tile sets (the family filter) ───────────────────────────────────

/** One toggleable tile set of the Tools bar's Sets page: a sprite family,
 *  the capitalized word the chip shows, and whether it is currently on.
 *  Off sets vanish from the Tiles menu and from what Random may pick. */
export interface PatternTileSetRow {
  family: string;
  label: string;
  enabled: boolean;
}

/** The sets a fresh editor starts with — Angular and Curved on, every
 *  other family off. */
export const PATTERN_DEFAULT_TILE_SETS: readonly string[] = ['angular', 'curved'];

/** The chip word for a family: its name, capitalized. */
export function patternTileSetLabel(family: string): string {
  return family.charAt(0).toUpperCase() + family.slice(1);
}

/** Build the Sets page's rows from the host's family list and its enabled
 *  set — deduped, alphabetical, so the chips sit in a stable order. */
export function patternTileSetRows(
  families: Iterable<string>,
  enabled: ReadonlySet<string>,
): PatternTileSetRow[] {
  const seen = new Set<string>();
  const rows: PatternTileSetRow[] = [];
  for (const family of families) {
    if (seen.has(family)) continue;
    seen.add(family);
    rows.push({ family, label: patternTileSetLabel(family), enabled: enabled.has(family) });
  }
  return rows.sort((a, b) => a.family.localeCompare(b.family));
}

// ── The Tools bar ───────────────────────────────────────────────────

/** The pattern sub-tool a canvas press paints with, as the panel speaks of
 *  it. 'tile' is selected implicitly by picking a tile in the Tiles bar. */
export type PatternPanelTool = 'random' | 'erase' | 'tile';

/** The two ARMING choices that aren't a tile. They lead the Tiles bar's
 *  grid — Random over Erase in the leftmost column, wearing Facet Tile
 *  Palette's glyphs — beside the recent tiles, because all three answer
 *  the same question — what does the next canvas press paint? — and
 *  exactly one of the grid's buttons is lit at a time. */
export const PATTERN_ARM_TOOLS: readonly { tool: 'random' | 'erase'; label: string; icon: string }[] = [
  { tool: 'random', label: 'Random', icon: 'shuffle-variant' },
  { tool: 'erase', label: 'Erase', icon: 'eraser' },
];

/** A one-press whole-grid action of the Tools bar. */
export type PatternGridAction = 'flood' | 'reconcile' | 'clear';

/** The Tools bar's one-press ACTIONS (they run on the whole grid now).
 *  Flood REPLACES the grid with the armed choice: a selected tile fills
 *  every cell, mirrored to the symmetry mode; Random (or the eraser) wipes
 *  the grid and re-rolls it with connectivity-respecting picks. */
export const PATTERN_GRID_ACTIONS: readonly { action: PatternGridAction; label: string }[] = [
  { action: 'flood', label: 'Flood' },
  { action: 'reconcile', label: 'Reconcile' },
  { action: 'clear', label: 'Clear' },
];

// ── The options row ─────────────────────────────────────────────────

export type PatternEditAction = 'symmetry' | 'tiles' | 'tools';

export interface PatternEditOption {
  action: PatternEditAction;
  label: string;
}

/** The pattern type options, in display order. Tiles leads — picking what
 *  to paint with is the main loop — then the Tools that operate on the
 *  grid, then the Symmetry the painting mirrors by. (Repeat is not here:
 *  it is a toggle, added by the panel exactly as the legacy svg pattern's
 *  Repeat is.) */
export const PATTERN_EDIT_OPTIONS: readonly PatternEditOption[] = [
  { action: 'tiles', label: 'Tiles' },
  { action: 'tools', label: 'Tools' },
  { action: 'symmetry', label: 'Symmetry' },
];

/** The submenu key an action's bar rides under (see submenuHeight's
 *  SubmenuKey), and its inverse — the same pairing rigEdit keeps. */
export function patternActionSubmenu(
  action: PatternEditAction,
): 'patternTiles' | 'patternTools' | 'patternSymmetry' {
  return action === 'tiles' ? 'patternTiles'
    : action === 'tools' ? 'patternTools'
    : 'patternSymmetry';
}

export function patternActionOfSubmenu(key: string): PatternEditAction | null {
  return key === 'patternTiles' ? 'tiles'
    : key === 'patternTools' ? 'tools'
    : key === 'patternSymmetry' ? 'symmetry'
    : null;
}
