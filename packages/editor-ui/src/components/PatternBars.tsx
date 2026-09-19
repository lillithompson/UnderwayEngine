import React, { useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ObjectPropertiesModel } from '../adapter';
import {
  PATTERN_SYMMETRY_BUTTON, PATTERN_SYMMETRY_GRID_WIDTH,
  PATTERN_TILE_BUTTON, PATTERN_TILE_GRID_GAP,
} from '../logic/submenuHeight';
import {
  PATTERN_ARM_TOOLS,
  PATTERN_GRID_ACTIONS,
  PATTERN_SYMMETRY_ENTRIES,
  PATTERN_SYMMETRY_OFF_ICON,
  PATTERN_TILE_TRANSFORM_IDENTITY,
  isPatternTileDoubleTap,
  patternTileThumbTransforms,
  rotatePatternTileTransform,
} from '../logic/patternEdit';
import { PANEL_INK, PANEL_INK_DIM, PANEL_TRACK, STATE_ACTIVE } from '../theme';
import { ActionRow, BarBody, EffectButton, SegmentedRow, SwitchRow } from './effectBar';
import { PatternSetsModal } from './PatternSetsModal';
import { PatternTileModal } from './PatternTileModal';
import { PatternTileTransformModal } from './PatternTileTransformModal';

// The pattern object's three property pages — siblings of the effect pages,
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
 * One definition, shown as the whole of the Tile page and as a row of the
 * Tools page, so the two can never offer the setting differently.
 */
export function PatternRepeatRow({ model, trailing }: {
  model: ObjectPropertiesModel;
  /** Hung at the row's right end — the Tile page's Edit button. */
  trailing?: React.ReactNode;
}) {
  if (!model.onToggleRepeat) return null;
  return (
    <SwitchRow
      label="Repeat"
      trailing={trailing}
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
 * The Tile page: the object's Repeat toggle, and — at the far right of
 * that same line — the way INTO the grid, Edit.
 *
 * Edit opens the pattern for editing: the double border comes up on it, it
 * becomes the one grid the Tile tool may rework, and the tile tool is armed
 * for it. The host's floating Edit capsule does exactly this from the
 * canvas (one callback, so the two can't come to mean different things);
 * the page offers it as well because the page is where you already are when
 * you have gone looking for what this object can do.
 *
 * It shares the switch's line rather than taking one of its own: a page
 * holding a single setting has the width to spare, and a second row for one
 * button would make the sheet taller for nothing. The style is the Add
 * pages' button (EffectButton — "Add Stroke", "Add Fill"), in its inline
 * form: this is the page's one ACT, which is the same kind of thing those
 * are, so it looks the same.
 */
export function PatternTileBar({ model }: { model: ObjectPropertiesModel }) {
  return (
    <BarBody>
      <PatternRepeatRow
        model={model}
        trailing={model.onPatternEdit ? (
          <EffectButton label="Edit" icon="pencil" inline onPress={model.onPatternEdit} />
        ) : null}
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

export function PatternSymmetryBar({ model }: {
  model: ObjectPropertiesModel;
}) {
  const current = model.patternSymmetry ?? 'off';
  // The 11 modes + Off, as the canvas Symmetry takeover's SQUARE buttons —
  // glyph over a small word — but on this page's own tile-button scale
  // (PATTERN_TILE_BUTTON, six across), so the whole grid is two rows inside
  // the sheet instead of a screen of its own. The takeover leads with None
  // and this page closes with Off: the word differs because the cell does
  // — there it is a first-class pick among modes, here it is the way out of
  // the one the pattern is in.
  //
  // Same twelve cells, same glyphs (PATTERN_SYMMETRY_ENTRIES carries them),
  // so a mode looks the same wherever it is picked.
  const cells = [
    ...PATTERN_SYMMETRY_ENTRIES.map((e) => ({
      value: e.key, label: e.label, icon: e.icon, mirrored: e.mirrored,
    })),
    { value: 'off', label: 'Off', icon: PATTERN_SYMMETRY_OFF_ICON, mirrored: undefined },
  ];
  return (
    <View>
      <BarBody>
        <View style={styles.symGrid}>
          {cells.map((o) => {
            const active = o.value === current;
            return (
              <Pressable
                key={o.value}
                // Tapping the ACTIVE mode again turns symmetry off, like
                // the old modal's toggle.
                onPress={() => model.onPatternSymmetry?.(active ? 'off' : o.value)}
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
        </View>
      </BarBody>
    </View>
  );
}

/** The one glyph drawn flipped (Diag \ against Diag /). Hoisted so the
 *  style object is not minted per cell per render. */
const MIRRORED_GLYPH = { transform: [{ scaleX: -1 }] } as const;

const TILE = PATTERN_TILE_BUTTON;

const styles = StyleSheet.create({
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
  // The symmetry grid: twelve square buttons wrapping six to a row, which
  // is the two rows submenuHeight reserves (PATTERN_SYMMETRY_GRID). The
  // CAP is what guarantees it: at exactly six buttons wide the grid wraps
  // the same way on a phone and on a desktop sheet, where an uncapped row
  // stretched all twelve across a wide one and left the page's second row
  // empty. Row-wise, unlike the Tiles grid's column flow: these cells are a
  // LIST of modes read left to right, where that one is two stacked columns
  // of arming choices.
  symGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: PATTERN_TILE_GRID_GAP,
    maxWidth: PATTERN_SYMMETRY_GRID_WIDTH,
  },
  symCell: {
    width: PATTERN_SYMMETRY_BUTTON,
    height: PATTERN_SYMMETRY_BUTTON,
    borderRadius: 8,
    backgroundColor: PANEL_TRACK,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  symCellActive: { borderColor: STATE_ACTIVE },
  // A 9pt caption under a 20pt glyph — Facet's Random/Erase dress, which
  // the arming buttons beside these already wear.
  symWord: { color: PANEL_INK_DIM, fontSize: 9, fontWeight: '600', marginTop: 2 },
  symWordActive: { color: PANEL_INK },
});
