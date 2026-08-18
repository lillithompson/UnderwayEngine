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
 *  counts — the old TilePalette's horizontally scrolled sections. */
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

/** The Tools bar's two ARMING choices (what the next press paints) — the
 *  'tile' arm lives in the Tiles bar, on the tile itself. */
export const PATTERN_ARM_TOOLS: readonly { tool: 'random' | 'erase'; label: string }[] = [
  { tool: 'random', label: 'Random' },
  { tool: 'erase', label: 'Erase' },
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
