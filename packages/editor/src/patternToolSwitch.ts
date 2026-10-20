import {
  PATTERN_ARM_TOOLS, PATTERN_GRID_ACTIONS, PATTERN_SYMMETRY_ENTRIES,
  PATTERN_TILE_TRANSFORM_IDENTITY, rotatePatternTileTransform,
} from '@/editor-ui/logic/patternEdit';
import type { CellTransform } from '@/engine/types';
import { sliderModeCapsuleOptions, type SliderModeCapsuleOption, type SliderModeOption } from './sliderModeMenu';

// The tile brush picker's model: Random | Erase | Close as a RADIAL menu
// in the lower right (SliderModeTarget — the same control style the raster
// paint and rig sliders wear), standing where the old three-way capsule
// across the top stood. Kept pure so the option table is node-testable the
// way sliderModeMenu.ts is for the chrome it stands behind.

/** The three brush arms, in display order, wearing the shared words and
 *  glyphs: Random and Erase are PATTERN_ARM_TOOLS' own entries (the Tiles
 *  bar renders the same two), and Close is the reconcile action's label
 *  from PATTERN_GRID_ACTIONS — the user's one word for reconciling,
 *  whether one press sweeps the grid (the actions capsule) or a brush
 *  closes one tile at a time. Each option's KEY is the armable
 *  PatternSubTool kind, so a radial pick feeds onPatternArmTool directly;
 *  Random leads, and the overlays' arrival reset seats the switch there
 *  (the radial's default choice). */
export const TILE_RADIAL_MODES: SliderModeOption[] = [
  ...PATTERN_ARM_TOOLS.map(({ tool, label, icon }) => ({ key: tool, icon, label })),
  {
    key: 'reconcile',
    icon: 'auto-fix',
    label: PATTERN_GRID_ACTIONS.find(({ action }) => action === 'reconcile')!.label,
  },
];

// ── The Choose fan ──────────────────────────────────────────────────
// The radial's fourth option: up to four tiles and a trailing '…' that
// takes over the screen with the whole menu (PatternTileModal). The four
// start as the head of the CURATED set below and become the user's most
// recently used as they pick — from the fan, the Tiles bar, or the
// takeover — with the curated tiles backfilling whatever the recents
// leave open. Picking one arms it exactly as a pick from the Tiles menu
// would.

/** One Choose pick: the sprite, and the pose it stamps in. */
export interface TileChoosePick {
  spriteId: string;
  transform?: CellTransform;
}

const TURN_90: CellTransform = { rotation: 90, mirrorH: false, mirrorV: false };

/** How many tile picks the fan holds; with the '…' that is five options.
 *  Four, down from five: the capsule's segments read better with a little
 *  more room each, and the fifth was the one least often reached for. */
export const TILE_RADIAL_PICKS = 4;

/** The fan's last option: the door to the full tile-choosing takeover.
 *  Shaped so tileChooseIndex reads it as "not a pick". */
export const TILE_CHOOSE_MORE_KEY = 'choose-more';

/** The curated Choose set, in fan order — what the fan offers before the
 *  user has a history, and what backfills behind their recents. */
export const TILE_CHOOSE_TILES: readonly TileChoosePick[] = [
  { spriteId: 'angular/tile_00010001' },
  { spriteId: 'angular/tile_10001000' },
  { spriteId: 'angular/tile_10001000', transform: TURN_90 },
  { spriteId: 'angular/tile_01001001' },
  { spriteId: 'angular/tile_01000001' },
  { spriteId: 'curved/curve_00011011' },
  { spriteId: 'curved/curve_00100001' },
  { spriteId: 'curved/curveB_00010001' },
];

/** The pick keys ride the shared option plumbing as `choose-<i>`; the
 *  shell decodes them with {@link tileChooseIndex} and arms the tile
 *  instead of arming a brush. */
export function tileChooseKey(i: number): string {
  return `choose-${i}`;
}

/** The pick index a key names, or null for a brush arm. */
export function tileChooseIndex(key: string): number | null {
  const m = /^choose-(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
}

/** A pick's identity for matching and dedupe: the sprite in its pose. */
function poseKey(spriteId: string, transform?: CellTransform): string {
  return `${spriteId}@${transform?.rotation ?? 0}${transform?.mirrorH ? 'H' : ''}${
    transform?.mirrorV ? 'V' : ''}`;
}

/** The Choose key of the ARMED tile when it is one of the fan's picks —
 *  sprite and pose both matching — so the fan can light the pick that is
 *  actually in hand; null for any other armed tile. Matched against the
 *  fan's CURRENT pick list, since the list follows the user's recents. */
export function tileChooseKeyOf(
  picks: readonly TileChoosePick[],
  spriteId: string,
  transform?: CellTransform,
): string | null {
  const armed = poseKey(spriteId, transform);
  const i = picks.findIndex((t) => poseKey(t.spriteId, t.transform) === armed);
  return i >= 0 ? tileChooseKey(i) : null;
}

/**
 * The fan's tile picks: the user's most recently used tiles first — each
 * in its Tiles-menu pose (`transforms`), the same pose a pick from the
 * grid would arm — backfilled from the curated set, deduped by
 * sprite-and-pose, capped at TILE_RADIAL_PICKS. `offeredIds` is what the
 * Tiles menu currently offers: a tile whose set was switched off drops
 * out here exactly as it does from the Tiles grid (recentPatternTiles'
 * own rule), rather than offering a stamp Random can't reach.
 */
export function tileChoosePicks(
  recent: readonly string[],
  transforms: Readonly<Record<string, CellTransform>>,
  offeredIds: ReadonlySet<string>,
): TileChoosePick[] {
  const picks: TileChoosePick[] = [];
  const seen = new Set<string>();
  const take = (t: TileChoosePick) => {
    if (!offeredIds.has(t.spriteId)) return;
    const k = poseKey(t.spriteId, t.transform);
    if (seen.has(k)) return;
    seen.add(k);
    picks.push(t);
  };
  for (const id of recent) {
    if (picks.length === TILE_RADIAL_PICKS) return picks;
    take({ spriteId: id, ...(transforms[id] ? { transform: transforms[id] } : {}) });
  }
  for (const t of TILE_CHOOSE_TILES) {
    if (picks.length === TILE_RADIAL_PICKS) break;
    take(t);
  }
  return picks;
}

/**
 * The pick a Choose key names, turned a quarter clockwise — what a double
 * tap on the capsule's segment (or the takeover grid's tile) does: the
 * sprite keeps its mirrors and its seat, the pose the segment SHOWS is
 * what turns (a pick with no pose turns from identity). Null for the '…'
 * door or a key past the picks.
 */
export function tileChooseTurned(
  picks: readonly TileChoosePick[],
  key: string,
): { spriteId: string; transform: CellTransform } | null {
  const i = tileChooseIndex(key);
  const pick = i != null ? picks[i] : undefined;
  if (!pick) return null;
  return {
    spriteId: pick.spriteId,
    transform: rotatePatternTileTransform(pick.transform ?? PATTERN_TILE_TRANSFORM_IDENTITY),
  };
}

/**
 * Keep the fan's picks IN PLACE across selections: arming a tile that is
 * already on the fan bumps the MRU underneath, but the fan itself must
 * not shuffle under the finger — a pick is a selection, not a promotion.
 * A pick whose POSE changed — the capsule's double-tap turn, the
 * transform card's flip — keeps its seat too, wearing the new pose: the
 * finger is on that segment, and the turn must happen under it, not
 * send it to the front. Only a change in WHICH tiles the fan offers — a
 * new one reached through More's takeover, a set switched off — adopts
 * the fresh MRU order; while the offering is the same five, the previous
 * arrangement stands (identically, when no pose moved — the memo can
 * keep the array).
 */
export function stableTilePicks(
  prev: readonly TileChoosePick[],
  next: readonly TileChoosePick[],
): readonly TileChoosePick[] {
  if (prev.length !== next.length) return next;
  const unused = new Map(next.map((t) => [poseKey(t.spriteId, t.transform), t]));
  const seated: (TileChoosePick | null)[] = prev.map((t) => {
    const k = poseKey(t.spriteId, t.transform);
    const hit = unused.get(k);
    if (hit) unused.delete(k);
    return hit ?? null;
  });
  let reposed = false;
  for (let i = 0; i < seated.length; i++) {
    if (seated[i]) continue;
    // The same sprite in another pose, not yet seated: it takes the old
    // pose's seat.
    const sprite = prev[i].spriteId;
    const entry = [...unused.entries()].find(([, t]) => t.spriteId === sprite);
    if (!entry) return next;
    unused.delete(entry[0]);
    seated[i] = entry[1];
    reposed = true;
  }
  return reposed ? (seated as TileChoosePick[]) : prev;
}

/**
 * The full radial: the three brush arms plus Choose, whose children are
 * the fan's tile picks (tileChoosePicks — recents over the curated set)
 * wearing their own art, then the '…' that opens the full tile-choosing
 * takeover. `thumb` renders one sprite's data-URIs — the rest ink for the
 * dark button ground and the re-ink the hover invert swaps in — and comes
 * from the host (the sprite registry lives there); a sprite it cannot
 * render falls back to a plain glyph. Releasing on Choose itself picks
 * the first tile, the a-parent-is-a-doorway rule the other fans use.
 *
 * The Choose ROOT always wears its own 'shape' glyph: the armed tile's
 * art lives on the COLLAPSED target ring instead ({@link tileRingArt}),
 * so the closed menu names what a touch will stamp while the opened fan's
 * first level stays the stable set of brushes-and-a-door.
 */
/** The Choose fan's own glyph — the mark for "a tile, chosen". The tile
 *  TOOL's bar button wears it too (toolbarMeta), read from here rather than
 *  copied, so the button and the menu it opens onto cannot drift apart. */
export const TILE_CHOOSE_ICON = 'shape';

/** The Choose option itself — the fan of picks and its '…' door. Its own
 *  function because two radials carry it: the pattern OBJECT's (the brush
 *  arms plus Choose) and a shape FILL's (Size, Resolution, Symmetry plus
 *  Choose). One table, so the tile you reach for is the same reach in
 *  both.
 *
 *  `random` seats the RANDOM arm at the head of the fan, ahead of every
 *  pick. The fill radial asks for it: its four roots hold no brush arm, so
 *  once a tile is in hand there is nowhere on that radial to put it down
 *  again, and every cell the fill is touched with goes on being that one
 *  stamp. Random is the resting arm — the connectivity roll a cell gets
 *  with no tile armed — so it belongs where the tile was chosen, and it
 *  stands FIRST so its seat never moves under the finger the way the
 *  recents-ordered picks behind it do. The object's radial passes it by:
 *  Random is a root of that fan already, and the same word twice on one
 *  menu names two different reaches. */
export function tileChooseOption(
  thumb: (spriteId: string) => { uri: string; hoverUri: string } | null,
  picks: readonly TileChoosePick[],
  opts: { random?: boolean } = {},
): SliderModeOption {
  // The Tiles bar's own Random — word and glyph read from the shared table
  // rather than re-typed, so the arm cannot be named one thing here and
  // another there.
  const random = PATTERN_ARM_TOOLS.find(({ tool }) => tool === 'random')!;
  return {
    key: 'choose',
    icon: TILE_CHOOSE_ICON,
    label: 'Choose',
    // A release on the parent still lands on a TILE (the fan's doorway
    // rule): Random is what the fill already does before a pick, so
    // flicking past the menu to arm it would be a flick that changes
    // nothing.
    defaultChildKey: picks.length > 0 ? tileChooseKey(0) : TILE_CHOOSE_MORE_KEY,
    children: [
      // …and in the CAPSULE it wears that glyph too (capsuleIcon): it
      // stands first in a row of tiles, and the one word among pictures
      // was the only segment there that had to be read.
      ...(opts.random
        ? [{ key: random.tool, icon: random.icon, label: random.label, capsuleIcon: true }]
        : []),
      ...picks.map((t, i) => ({
        key: tileChooseKey(i),
        icon: 'square-outline',
        label: 'Choose',
        ...(thumb(t.spriteId) ?? {}),
        ...(t.transform?.rotation ? { rotate: t.transform.rotation } : {}),
      })),
      // The door to everything the fan doesn't hold.
      { key: TILE_CHOOSE_MORE_KEY, icon: 'dots-horizontal', label: 'More' },
    ],
  };
}

export function tileRadialModes(
  thumb: (spriteId: string) => { uri: string; hoverUri: string } | null,
  picks: readonly TileChoosePick[] = TILE_CHOOSE_TILES.slice(0, TILE_RADIAL_PICKS),
): SliderModeOption[] {
  return [...TILE_RADIAL_MODES, tileChooseOption(thumb, picks)];
}

// ── The pattern FILL radial ─────────────────────────────────────────
// A shape's cloth, opened by double-tapping the filled shape, asks
// different questions from a pattern object's grid. The object is a grid
// you paint cell by cell, so its radial is brushes — Random, Erase, Close.
// A fill is a TILE that repeats inside an outline, and what you reach for
// is how big the repeat draws, how finely it is cut, what mirror it is
// laid under, and which tile goes in it: Size · Resolution · Symmetry ·
// Choose, the Pattern property page's own questions, in the corner where
// the hand already is.
//
// Size and Resolution are VALUES, so they arm the floating slider (the
// paint brush's Opacity and Size do the same through their own radial).
// Symmetry is a set of states, so it raises a capsule of them. Choose is
// the same fan the object's radial carries.

/** The two value modes, and the one the slider is pointed at. */
export type PatternFillValueMode = 'size' | 'resolution';

/** The four symmetries the capsule offers outright — the mirrors reached
 *  for most, with the rest (diagonals, rows, quads, rotation) behind
 *  More. */
export const PATTERN_FILL_SYMMETRY_KEYS: readonly string[] = ['h', 'v', 'hv', 'star'];

/** The Symmetry fan's last child: the door to the full grid of modes
 *  (the shell's SymmetryModal), the way Blend's More opens its grid.
 *  Decoded as no mode, like every other doorway. */
export const PATTERN_SYMMETRY_MORE_KEY = 'symmetry-more';

/** Symmetry keys ride the option plumbing as `symmetry-<key>`, so they
 *  cannot collide with a brush arm or a value mode. */
export function patternSymmetryRadialKey(key: string): string {
  return `symmetry-${key}`;
}

/** The symmetry a picked key names — 'off' included, which clears the
 *  mirror — or null for anything else (More included: it is a door, not
 *  a mode). */
export function patternSymmetryRadialMode(key: string): string | null {
  if (key === PATTERN_SYMMETRY_MORE_KEY) return null;
  const m = /^symmetry-(.+)$/.exec(key);
  if (!m) return null;
  return m[1] === 'off' || PATTERN_SYMMETRY_ENTRIES.some((e) => e.key === m[1])
    ? m[1] : null;
}

/** The Symmetry fan's children: H, V, H+V, Star — each wearing the grid's
 *  own glyph and word, read from PATTERN_SYMMETRY_ENTRIES rather than
 *  copied — and last, always, the More door. */
export function patternFillSymmetryChildren(): SliderModeOption[] {
  return [
    ...PATTERN_FILL_SYMMETRY_KEYS.map((key) => {
      const entry = PATTERN_SYMMETRY_ENTRIES.find((e) => e.key === key)!;
      return {
        key: patternSymmetryRadialKey(entry.key),
        icon: entry.icon,
        label: entry.label,
      };
    }),
    { key: PATTERN_SYMMETRY_MORE_KEY, icon: 'dots-horizontal', label: 'More' },
  ];
}

/** The pattern-fill radial, in fan order: Size, Resolution, Symmetry,
 *  Choose. Symmetry is a doorway only (`openOnly`) — its children CONFIRM
 *  a mirror, and a release on the parent that armed one would re-lay the
 *  tile for the sake of opening a menu, exactly as the Blend fan's would
 *  drop a stroke's mode to Normal. */
export function patternFillRadialModes(
  thumb: (spriteId: string) => { uri: string; hoverUri: string } | null,
  picks: readonly TileChoosePick[] = TILE_CHOOSE_TILES.slice(0, TILE_RADIAL_PICKS),
): SliderModeOption[] {
  return [
    { key: 'size', icon: 'arrow-expand-all', label: 'Size' },
    { key: 'resolution', icon: 'grid', label: 'Resolution' },
    {
      key: 'symmetry',
      icon: 'flip-horizontal',
      label: 'Symmetry',
      openOnly: true,
      children: patternFillSymmetryChildren(),
    },
    tileChooseOption(thumb, picks, { random: true }),
  ];
}

/**
 * The Choose CAPSULE's segments — the fan's children as the top capsule
 * shows them (sliderModeCapsuleOptions) — with each pick's art re-inked
 * in the ACTIVE color: the capsule previews what a stamp will be laid in,
 * where the fan's buttons wear the chrome's own rest ink (white, which on
 * the capsule's light ground all but vanished). The LIT segment — the
 * tile in hand, on the accent-blue ground — draws a white bake instead
 * (`activeUri`), the Tiles takeover's rule for its blue grounds, so an
 * active color near the accent never hides the armed tile. `inkThumb`
 * renders one sprite both ways and comes from the host, like the fan's
 * thumbnailer; a sprite it cannot render keeps whatever the fan gave the
 * segment. The '…' door is a word and is left alone.
 */
export function tileChooseCapsuleOptions(
  options: readonly SliderModeOption[],
  picks: readonly TileChoosePick[],
  inkThumb: (spriteId: string) => { uri: string; activeUri: string } | null,
): SliderModeCapsuleOption[] {
  return sliderModeCapsuleOptions(options, 'choose').map((o) => {
    const i = tileChooseIndex(o.key);
    const art = i != null && picks[i] ? inkThumb(picks[i].spriteId) : null;
    return art ? { ...o, uri: art.uri, activeUri: art.activeUri } : o;
  });
}

/**
 * The art the COLLAPSED target ring wears while a specific tile is armed
 * (`pick` — the fan's own arm, a Tiles-bar pick, or the takeover's): that
 * tile's dark re-ink (`hoverUri` — the ring draws dark chrome on the
 * light canvas, the same ink the hover invert re-inks the fan's buttons
 * with), posed by the pick's rotation. The closed menu then names what a
 * touch will stamp; the fan's Choose root keeps its generic glyph — one
 * place wears the tile, not two. The mirror flags have no art variant
 * (rotate is the only pose the ring renders), so a mirrored pick shows
 * its unmirrored face — near enough for a 24px badge. Null — the ring
 * keeps the active brush's glyph — with no tile armed, or for a sprite
 * the host cannot render.
 */
export function tileRingArt(
  thumb: (spriteId: string) => { uri: string; hoverUri: string } | null,
  pick?: TileChoosePick | null,
): { uri: string; rotate?: number } | null {
  if (!pick) return null;
  const art = thumb(pick.spriteId);
  if (!art) return null;
  return {
    uri: art.hoverUri,
    ...(pick.transform?.rotation ? { rotate: pick.transform.rotation } : {}),
  };
}
