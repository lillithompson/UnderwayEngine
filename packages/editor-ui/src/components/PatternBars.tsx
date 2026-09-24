import React, { useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ObjectPropertiesModel } from '../adapter';
import {
  PATTERN_SYMMETRY_BUTTON, PATTERN_SYMMETRY_COLUMNS,
  PATTERN_TILE_BUTTON, PATTERN_TILE_GRID_GAP, PATTERN_TILE_SET_BUTTON, ROW_GAP,
} from '../logic/submenuHeight';
import {
  PATTERN_ARM_TOOLS,
  PATTERN_GRID_ACTIONS,
  PATTERN_SYMMETRY_ENTRIES,
  PATTERN_SYMMETRY_OFF_ICON,
  PATTERN_TILE_TRANSFORM_IDENTITY,
  isPatternTileDoubleTap,
  patternTileSetLines,
  patternTileThumbTransforms,
  rotatePatternTileTransform,
} from '../logic/patternEdit';
import type { PatternTileSetRow } from '../logic/patternEdit';
import { PANEL_INK, PANEL_INK_DIM, PANEL_TRACK, STATE_ACTIVE } from '../theme';
import {
  ActionRow, BarBody, EffectButton, SegmentedRow, SwitchRow,
} from './effectBar';
import { PatternSetsModal } from './PatternSetsModal';
import { PatternTileModal } from './PatternTileModal';
import { PatternTileTransformModal } from './PatternTileTransformModal';

// The pattern object's property pages — siblings of the effect pages,
// sharing their row grammar (effectBar.tsx):
//
//   • Tiles    — the ARMING grid: Random, Erase, the five most recently
//                used tiles, and a '...' that takes over the screen with
//                the whole menu. Exactly one button is lit, because all
//                eight answer one question — what does the next canvas
//                press paint?
//   • Tools    — the grid actions (Flood / Close / Clear run now, one
//                undo step each), the Borders rule connectivity honors at
//                the grid edge, and the tile-set filter.
//   • Symmetry — the painting-mirror grid (the old symmetry modal's modes),
//                exclusive, with Off closing the set.
//   • Shapes   — WHAT THE PATTERN IS MADE OF: one square per sprite family,
//                lit while that family's tiles are in the Tiles menu and
//                in Random's pool. Not exclusive — a pattern is made of
//                however many families are lit, and the page refuses the
//                press that would put the last one out.

export function PatternTilesBar({ model }: {
  model: ObjectPropertiesModel;
}) {
  const [showAll, setShowAll] = useState(false);
  // The tile whose pose the long-press transform modal is editing, if any.
  const [transformId, setTransformId] = useState<string | null>(null);
  // The last tile tap, for the double-tap quarter turn (Facet's window).
  const lastTapRef = useRef<{ id: string; time: number }>({ id: '', time: 0 });
  const tool = model.patternTool;
  const activeId = tool === 'tile' ? model.patternActiveTileId ?? null : null;
  const recent = model.patternRecentTiles ?? [];
  const transforms = model.patternTileTransforms ?? {};
  const transformUri = transformId
    ? (model.patternTiles ?? []).find((t) => t.id === transformId)?.uri ?? null
    : null;
  // Random, Erase, the recent tiles, then '...' — the grid FILLS COLUMN BY
  // COLUMN (Facet's palette flow: a fixed two-row height wraps a column
  // stack), so Random sits over Erase in the leftmost column, the nine
  // recents make the next columns, and the twelve buttons fill two rows of
  // six (PATTERN_TILE_GRID_COLUMNS) exactly — the page's height is the same
  // whatever is in hand.
  return (
    <View>
      <BarBody>
        <View style={styles.tileGrid}>
          {PATTERN_ARM_TOOLS.map((t) => {
            const active = tool === t.tool;
            return (
              <Pressable
                key={t.tool}
                onPress={() => model.onPatternArmTool?.(t.tool)}
                style={[styles.tile, active && styles.tileActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t.label}
              >
                <MaterialCommunityIcons
                  name={t.icon as never}
                  size={22}
                  color={active ? PANEL_INK : PANEL_INK_DIM}
                />
                <Text style={[styles.tileCaption, active && styles.tileWordActive]}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
          {recent.map((t) => {
            const active = t.id === activeId;
            const xform = transforms[t.id] ?? PATTERN_TILE_TRANSFORM_IDENTITY;
            return (
              <Pressable
                key={t.id}
                // First tap arms; a second within the window turns the tile a
                // quarter clockwise instead (Facet's TilePalette double-tap).
                onPress={() => {
                  const now = Date.now();
                  if (isPatternTileDoubleTap(lastTapRef.current, t.id, now)) {
                    model.onPatternSetTileTransform?.(t.id, rotatePatternTileTransform(xform));
                    lastTapRef.current = { id: '', time: 0 };
                  } else {
                    model.onPatternPickTile?.(t.id);
                    lastTapRef.current = { id: t.id, time: now };
                  }
                }}
                // Holding arms the tile AND opens its pose controls, as
                // Facet's palette does.
                onLongPress={() => {
                  model.onPatternPickTile?.(t.id);
                  setTransformId(t.id);
                }}
                style={[styles.tile, active && styles.tileActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t.id}
              >
                <Image
                  source={{ uri: t.uri }}
                  style={[styles.tileImage, { transform: patternTileThumbTransforms(xform) }]}
                />
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => setShowAll(true)}
            style={styles.tile}
            accessibilityRole="button"
            accessibilityLabel="All tiles"
          >
            <Text style={styles.tileWord}>•••</Text>
          </Pressable>
        </View>
      </BarBody>
      <PatternTileModal
        visible={showAll}
        tiles={model.patternTiles ?? []}
        activeId={activeId}
        transforms={transforms}
        onPick={(id) => model.onPatternPickTile?.(id)}
        onSetTransform={(id, xform) => model.onPatternSetTileTransform?.(id, xform)}
        onClose={() => setShowAll(false)}
      />
      <PatternTileTransformModal
        visible={transformId != null}
        uri={transformUri}
        transform={(transformId ? transforms[transformId] : undefined) ?? PATTERN_TILE_TRANSFORM_IDENTITY}
        onChange={(xform) => {
          if (transformId) model.onPatternSetTileTransform?.(transformId, xform);
        }}
        onClose={() => setTransformId(null)}
      />
    </View>
  );
}

/**
 * Repeat: lay the grid across the bounding box as a tile instead of
 * stretching it to fill. A grouped pattern can't repeat, and gets no row
 * at all.
 *
 * A SWITCH, with the state in a word beside it. It was a two-cell
 * segmented control — Stretch | Tile — which had to name the off side to
 * have something to put in the other cell, and then say which cell was lit;
 * Repeat is one setting that is simply on or off, and a switch says so
 * without inventing a word for "not repeating".
 *
 * One definition, shown as the whole of the Tile page's well and as a row
 * of the Tools page, so the two can never offer the setting differently.
 */
export function PatternRepeatRow({ model }: { model: ObjectPropertiesModel }) {
  if (!model.onToggleRepeat) return null;
  return (
    <SwitchRow
      label="Repeat"
      value={!!model.repeat}
      // Several patterns, set differently: the row says Multiple instead of
      // showing one side's value as everyone's, and flipping it FORCES the
      // new value on all of them (the host's toggle converges).
      mixed={!!model.repeatMixed}
      onValueChange={(next) => {
        if (model.repeatMixed || next !== !!model.repeat) model.onToggleRepeat?.();
      }}
    />
  );
}

/**
 * The Tile page: one row in the sheet's well — the object's Repeat toggle
 * on the left half, and on the right half the page's one ACT, Make
 * Colorable.
 *
 * Make Colorable turns the pattern into a plain drawing over one blank
 * closed shape per region its lines cut its own bounding box into — the
 * Patchwork game's patches, of this pattern instead of the day's line —
 * the lot grouped as "Colorable", in one undo step. The object is not a
 * pattern afterwards: the grid, the tiles and the symmetry go with it, and
 * what is left is a merged collection of lines the shape tools edit. That
 * is why it is a button and not a row of controls — it does not SET
 * anything about the pattern, it ends the pattern.
 *
 * It had a tab of its own for a day (Patchwork) and lost it: a whole page
 * holding a single button is a place to go for something that could simply
 * be pressed, and this page had the width to spare. It stands where the
 * Edit button used to (2026-09-21) — the way into the grid is the canvas's
 * floating Edit capsule, which is where you are when you want it.
 *
 * It shares the switch's row rather than taking one of its own: a page
 * holding a single setting has the width to spare, and a second row for
 * one button would make the sheet taller for nothing. The style is the Add
 * pages' button (EffectButton — "Add Stroke", "Add Fill") in its block
 * form, filling its half of the row: this is the same kind of act those
 * are, so it looks the same — minus their plus, because it adds no effect,
 * and with a hairline round it, because beside a switch a bare word reads
 * as the switch's caption rather than as a thing to press. A host that
 * offers no callback — a selection with nothing to convert — gets no
 * button, and the row is the switch alone.
 */
export function PatternTileBar({ model }: { model: ObjectPropertiesModel }) {
  return (
    <BarBody>
      <View style={styles.tileRow}>
        <View style={styles.tileHalf}>
          <PatternRepeatRow model={model} />
        </View>
        {model.onPatternMakeColorable ? (
          <View style={styles.tileHalf}>
            <EffectButton
              label="Make Colorable"
              icon={null}
              bordered
              onPress={model.onPatternMakeColorable}
            />
          </View>
        ) : null}
      </View>
    </BarBody>
  );
}

/**
 * The tile-set filter as ROWS OF SQUARE BUTTONS: one per sprite family, lit
 * while the pattern is made of it, five across (patternEdit's
 * PATTERN_TILE_SET_COLUMNS — as many as fit the narrowest sheet there is),
 * so today's five families are one line and a longer list grows a line at a
 * time.
 *
 * FIXED squares, on the arming grid's own scale (PATTERN_TILE_SET_BUTTON),
 * rather than cells that divide their row: every family is the same size
 * whichever line it lands on, where stretched chips made a short last row's
 * two buttons half the width of the row above them. A family is a thing the
 * pattern is made of, not a share of a control, so it reads as a button of
 * its own — the dress the Tiles and Symmetry grids beside it wear.
 *
 * Shared by the two places a pattern's families are set — a pattern
 * OBJECT's Shapes page and the Shapes section of a shape's Pattern page —
 * because the two ask exactly the same question of exactly the same
 * field, and a second copy of this could drift in how it wraps (which is
 * the arithmetic submenuHeight predicts the sheet's height from).
 *
 * Not a segmented control: these are not exclusive choices but a set of
 * switches, so several light at once. Nothing here refuses a press — the
 * HOST decides whether a toggle is legal, and simply does nothing when it is
 * not (togglePatternTileSet returns null for the last set on).
 */
export function PatternTileSetLines({ sets, onToggle }: {
  sets: readonly PatternTileSetRow[];
  onToggle?: (family: string) => void;
}) {
  return (
    <View style={styles.setGrid}>
      {patternTileSetLines(sets).map((line, i) => (
        <View
          key={line.map((s) => s.family).join(',') || `empty-${i}`}
          style={styles.setRow}
        >
          {line.map((s) => (
            <Pressable
              key={s.family}
              onPress={() => onToggle?.(s.family)}
              style={[styles.setCell, s.enabled && styles.setCellActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: s.enabled }}
              accessibilityLabel={s.label}
            >
              <Text
                style={[styles.setWord, s.enabled && styles.setWordActive]}
                numberOfLines={1}
              >
                {s.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * The pattern object's SHAPES page: the chips, and nothing else. What a
 * pattern is made of is one question, and the page is the answer to it.
 */
export function PatternShapesBar({ model }: { model: ObjectPropertiesModel }) {
  return (
    <BarBody>
      <PatternTileSetLines
        sets={model.patternTileSets ?? []}
        onToggle={(family) => model.onPatternToggleTileSet?.(family)}
      />
    </BarBody>
  );
}

export function PatternToolsBar({ model }: {
  model: ObjectPropertiesModel;
}) {
  // The Sets row's 'Tiles' button takes over the screen with the tile-set
  // filter (Facet's Randomization Settings) rather than flipping the page
  // to a chip page — see PatternSetsModal.
  const [showSets, setShowSets] = useState(false);
  const sets = model.patternTileSets ?? [];
  return (
    <View>
      <BarBody>
        <ActionRow
          label="Grid"
          options={PATTERN_GRID_ACTIONS.map((a) => ({ value: a.action, label: a.label }))}
          onPress={(a) => model.onPatternGridAction?.(a)}
        />
        <SegmentedRow
          label="Borders"
          options={[
            { value: 'connect' as const, label: 'Connect' },
            { value: 'closed' as const, label: 'Closed' },
          ]}
          value={model.patternAllowBorder !== false ? 'connect' : 'closed'}
          onChange={(v) => {
            const allow = v === 'connect';
            if (allow !== (model.patternAllowBorder !== false)) model.onPatternToggleBorder?.();
          }}
        />
        <PatternRepeatRow model={model} />
        {sets.length > 0 && (
          <ActionRow
            label="Sets"
            options={[{ value: 'tiles' as const, label: 'Tiles' }]}
            onPress={() => setShowSets(true)}
          />
        )}
      </BarBody>
      <PatternSetsModal
        visible={showSets}
        safeTop={model.safeTop}
        sets={sets}
        allowBorder={model.patternAllowBorder !== false}
        onToggleSet={(family) => model.onPatternToggleTileSet?.(family)}
        onToggleBorder={() => model.onPatternToggleBorder?.()}
        onClose={() => setShowSets(false)}
      />
    </View>
  );
}

/**
 * The painting-mirror grid: the eleven modes and Off, as the canvas
 * Symmetry takeover's buttons — glyph over a small word — laid out six to a
 * row on the pattern pages' own button height, so the whole set is two rows
 * inside the sheet instead of a screen of its own. The takeover leads with
 * None and this closes with Off: the word differs because the cell does —
 * there it is a first-class pick among modes, here it is the way out of the
 * one in force.
 *
 * The cells SHARE THE ROW's width rather than each holding a fixed square:
 * six stretching cells one gap apart, so the grid ends at the well's edge on
 * a wide sheet instead of leaving half of it empty. Six to a row is still
 * what makes it two rows (PATTERN_SYMMETRY_COLUMNS), so the height
 * submenuHeight reserves is unchanged — only the width each cell takes of it
 * is; the rows are hand-sliced for that reason, since a wrapping run cannot
 * stretch its cells.
 *
 * Same twelve cells, same glyphs (PATTERN_SYMMETRY_ENTRIES carries them),
 * so a mode looks the same wherever it is picked — which is the point of
 * this being a component rather than a shape it is drawn in twice: a
 * pattern OBJECT picks its mirror here, and so does the tile a shape
 * repeats as its pattern fill (the Pattern page's Symmetry section).
 */
export function PatternSymmetryGrid({ value, onPick }: {
  /** The grid key in force ('h', 'quad', …), or 'off'. */
  value: string;
  /** The key picked. Pressing the ACTIVE mode hands back 'off', like the
   *  old modal's toggle — the caller need not special-case it. */
  onPick: (key: string) => void;
}) {
  const cells = [
    ...PATTERN_SYMMETRY_ENTRIES.map((e) => ({
      value: e.key, label: e.label, icon: e.icon, mirrored: e.mirrored,
    })),
    { value: 'off', label: 'Off', icon: PATTERN_SYMMETRY_OFF_ICON, mirrored: undefined },
  ];
  // The same chunker the Shapes chips line up with, asked for six columns
  // instead of three — one line-slicer for both pattern grids.
  const rows = patternTileSetLines(cells, PATTERN_SYMMETRY_COLUMNS);
  return (
    <View style={styles.symGrid}>
      {rows.map((row) => (
        <View key={row.map((o) => o.value).join(',')} style={styles.symRow}>
          {row.map((o) => {
            const active = o.value === value;
            return (
              <Pressable
                key={o.value}
                onPress={() => onPick(active ? 'off' : o.value)}
                style={[styles.symCell, active && styles.symCellActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Symmetry: ${o.label}`}
              >
                <MaterialCommunityIcons
                  name={o.icon as never}
                  size={20}
                  color={active ? PANEL_INK : PANEL_INK_DIM}
                  style={o.mirrored ? MIRRORED_GLYPH : undefined}
                />
                <Text
                  style={[styles.symWord, active && styles.symWordActive]}
                  numberOfLines={1}
                >
                  {o.label}
                </Text>
              </Pressable>
            );
          })}
          {/* A short row (never with today's twelve cells, but the entries
              are a table anyone may add to) keeps its cells the width of the
              rows above rather than stretching them across the gap. */}
          {Array.from(
            { length: PATTERN_SYMMETRY_COLUMNS - row.length },
            (_, i) => <View key={`pad-${i}`} style={styles.symCellPad} />,
          )}
        </View>
      ))}
    </View>
  );
}

/** A pattern OBJECT's Symmetry page: the grid, in the sheet's own body. */
export function PatternSymmetryBar({ model }: {
  model: ObjectPropertiesModel;
}) {
  return (
    <View>
      <BarBody>
        <PatternSymmetryGrid
          value={model.patternSymmetry ?? 'off'}
          onPick={(key) => model.onPatternSymmetry?.(key)}
        />
      </BarBody>
    </View>
  );
}

/** The one glyph drawn flipped (Diag \ against Diag /). Hoisted so the
 *  style object is not minted per cell per render. */
const MIRRORED_GLYPH = { transform: [{ scaleX: -1 }] } as const;

const TILE = PATTERN_TILE_BUTTON;

const styles = StyleSheet.create({
  // The Tile page's one row: the switch's half and the button's half, on
  // the switch row's own height (the block button's line is the same
  // height, ROW_SEGMENTED), so the page is still one row tall.
  tileRow: { flexDirection: 'row', alignItems: 'center', gap: ROW_GAP },
  tileHalf: { flex: 1, justifyContent: 'center' },
  // Fixed-size squares wrapping COLUMN-WISE inside the two-row height
  // submenuHeight reserves (Facet's sectionWrap): the first column is
  // Random over Erase, and six columns of twelve buttons fit a phone's page.
  tileGrid: {
    flexDirection: 'column',
    flexWrap: 'wrap',
    alignContent: 'flex-start',
    height: TILE * 2 + PATTERN_TILE_GRID_GAP,
    gap: PATTERN_TILE_GRID_GAP,
  },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: 8,
    backgroundColor: PANEL_TRACK,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  // Border-only, as the old tile strip lit its pick: the thumbnails are
  // baked in PANEL_INK, and filling the square with STATE_ACTIVE would
  // tint the very artwork the button exists to show.
  tileActive: { borderColor: STATE_ACTIVE },
  tileImage: { width: TILE - 12, height: TILE - 12 },
  tileWord: { color: PANEL_INK_DIM, fontSize: 11, fontWeight: '600' },
  // Facet Tile Palette's Random/Erase dress: a 22pt glyph over a 9pt word.
  tileCaption: { color: PANEL_INK_DIM, fontSize: 9, fontWeight: '600', marginTop: 2 },
  tileWordActive: { color: PANEL_INK },
  // The Shapes page's family grid: rows of FIXED squares, left-aligned, so
  // a short last row's buttons are the width of a full row's rather than
  // stretching to fill it. Same column of rows as the symmetry grid below,
  // on the same gap — the two pattern grids read as one kind of thing.
  setGrid: { gap: PATTERN_TILE_GRID_GAP },
  setRow: { flexDirection: 'row', gap: PATTERN_TILE_GRID_GAP },
  setCell: {
    width: PATTERN_TILE_SET_BUTTON,
    height: PATTERN_TILE_SET_BUTTON,
    borderRadius: 8,
    backgroundColor: PANEL_TRACK,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  setCellActive: { borderColor: STATE_ACTIVE },
  // The grid's 9pt caption, as the arming and symmetry cells wear it — here
  // it is the whole cell, a family having no glyph of its own.
  setWord: { color: PANEL_INK_DIM, fontSize: 9, fontWeight: '600', textAlign: 'center' },
  setWordActive: { color: PANEL_INK },
  // The symmetry grid: twelve buttons in two SLICED rows of six, which is
  // the two rows submenuHeight reserves (PATTERN_SYMMETRY_GRID). Sliced
  // rather than wrapped because the cells STRETCH: six of them share the
  // well's width, so the grid fills a desktop sheet edge to edge instead of
  // stopping at a phone's worth of squares, and a narrow sheet still breaks
  // at six rather than at however many happen to fit. (A wrapping run could
  // do neither — flex-wrapped children cannot flex.) Row-wise, unlike the
  // Tiles grid's column flow: these cells are a LIST of modes read left to
  // right, where that one is two stacked columns of arming choices.
  symGrid: { gap: PATTERN_TILE_GRID_GAP },
  symRow: { flexDirection: 'row', gap: PATTERN_TILE_GRID_GAP },
  symCell: {
    // Width is the row's to divide; the HEIGHT is the fixed one the page's
    // two rows are measured from.
    flex: 1,
    minWidth: 0,
    height: PATTERN_SYMMETRY_BUTTON,
    borderRadius: 8,
    backgroundColor: PANEL_TRACK,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  // An unfilled place in a short row: it takes a cell's share of the width
  // and draws nothing.
  symCellPad: { flex: 1 },
  symCellActive: { borderColor: STATE_ACTIVE },
  // A 9pt caption under a 20pt glyph — Facet's Random/Erase dress, which
  // the arming buttons beside these already wear.
  symWord: { color: PANEL_INK_DIM, fontSize: 9, fontWeight: '600', marginTop: 2 },
  symWordActive: { color: PANEL_INK },
});
