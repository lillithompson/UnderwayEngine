import React, { useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ObjectPropertiesModel } from '../adapter';
import {
  BAR_BORDER, BAR_CONTROLS_TOP, BAR_PAD_BOTTOM, BAR_PAD_HORIZONTAL, BAR_PAD_TOP,
  PATTERN_TILE_BUTTON, PATTERN_TILE_GRID_GAP, ROW_GAP, ROW_SEGMENTED,
} from '../logic/submenuHeight';
import {
  PATTERN_ARM_TOOLS,
  PATTERN_GRID_ACTIONS,
  PATTERN_SYMMETRY_ENTRIES,
  PATTERN_TILE_TRANSFORM_IDENTITY,
  isPatternTileDoubleTap,
  patternTileThumbTransforms,
  rotatePatternTileTransform,
} from '../logic/patternEdit';
import { PANEL_INK, PANEL_INK_DIM, PANEL_TRACK, STATE_ACTIVE } from '../theme';
import { ActionRow, BAR_BG, EffectBarHeader, HAIRLINE, SegmentedRow } from './effectBar';
import { PatternSetsModal } from './PatternSetsModal';
import { PatternTileModal } from './PatternTileModal';
import { PatternTileTransformModal } from './PatternTileTransformModal';

// The pattern object's three submenu bars — siblings of the effect bars,
// sharing their chrome and row grammar (effectBar.tsx):
//
//   • Tiles    — the ARMING grid: Random, Erase, the five most recently
//                used tiles, and a '...' that takes over the screen with
//                the whole menu. Exactly one button is lit, because all
//                eight answer one question — what does the next canvas
//                press paint?
//   • Tools    — the grid actions (Flood / Reconcile / Clear run now, one
//                undo step each), the Borders rule connectivity honors at
//                the grid edge, and the tile-set filter.
//   • Symmetry — the painting-mirror grid (the old symmetry modal's modes),
//                exclusive, with Off closing the set.

function barTitle(kind: 'tiles' | 'tools' | 'symmetry'): string {
  return kind === 'tiles' ? 'TILES' : kind === 'tools' ? 'TOOLS' : 'SYMMETRY';
}

export function PatternTilesBar({ model, onBack }: {
  model: ObjectPropertiesModel;
  onBack: () => void;
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
  // six (PATTERN_TILE_GRID_COLUMNS) exactly — the bar's height is the same
  // whatever is in hand.
  return (
    <View style={styles.bar}>
      <EffectBarHeader title={barTitle('tiles')} chevron onBack={onBack} />
      <View style={styles.controls}>
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
      </View>
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

export function PatternToolsBar({ model, onBack }: {
  model: ObjectPropertiesModel;
  onBack: () => void;
}) {
  // The Sets row's 'Tiles' button takes over the screen with the tile-set
  // filter (Facet's Randomization Settings) rather than flipping the bar
  // to a chip page — see PatternSetsModal.
  const [showSets, setShowSets] = useState(false);
  const sets = model.patternTileSets ?? [];
  return (
    <View style={styles.bar}>
      <EffectBarHeader title={barTitle('tools')} chevron onBack={onBack} />
      <View style={styles.controls}>
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
        {model.onToggleRepeat && (
          // Repeat: lay the grid across the bounding box as a tile instead
          // of stretching it to fill. Named for what each choice does to
          // the drawing, since 'Repeat / off' says nothing about the other
          // half. A grouped pattern can't repeat, and gets no row.
          <SegmentedRow
            label="Repeat"
            options={[
              { value: 'stretch' as const, label: 'Stretch' },
              { value: 'tile' as const, label: 'Tile' },
            ]}
            value={model.repeat ? 'tile' : 'stretch'}
            onChange={(v) => {
              if ((v === 'tile') !== !!model.repeat) model.onToggleRepeat?.();
            }}
          />
        )}
        {sets.length > 0 && (
          <ActionRow
            label="Sets"
            options={[{ value: 'tiles' as const, label: 'Tiles' }]}
            onPress={() => setShowSets(true)}
          />
        )}
      </View>
      <PatternSetsModal
        visible={showSets}
        sets={sets}
        allowBorder={model.patternAllowBorder !== false}
        onToggleSet={(family) => model.onPatternToggleTileSet?.(family)}
        onToggleBorder={() => model.onPatternToggleBorder?.()}
        onClose={() => setShowSets(false)}
      />
    </View>
  );
}

export function PatternSymmetryBar({ model, onBack }: {
  model: ObjectPropertiesModel;
  onBack: () => void;
}) {
  const current = model.patternSymmetry ?? 'off';
  // The 11 modes + Off as a 4×3 grid of rectangles (the old modal's grid,
  // read in rows, with Off closing the set). No label column: the cells
  // stretch to split the bar's full width evenly.
  const cells = [
    ...PATTERN_SYMMETRY_ENTRIES.map((e) => ({ value: e.key, label: e.label })),
    { value: 'off', label: 'Off' },
  ];
  const rows = [cells.slice(0, 4), cells.slice(4, 8), cells.slice(8, 12)];
  return (
    <View style={styles.bar}>
      <EffectBarHeader title={barTitle('symmetry')} chevron onBack={onBack} />
      <View style={styles.controls}>
        {rows.map((row, i) => (
          <View key={i} style={styles.symRow}>
            {row.map((o) => {
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
                  accessibilityLabel={o.label}
                >
                  <Text style={[styles.symWord, active && styles.symWordActive]} numberOfLines={1}>
                    {o.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const TILE = PATTERN_TILE_BUTTON;

const styles = StyleSheet.create({
  bar: {
    backgroundColor: BAR_BG,
    borderTopWidth: BAR_BORDER,
    borderTopColor: HAIRLINE,
    paddingTop: BAR_PAD_TOP,
    paddingHorizontal: BAR_PAD_HORIZONTAL,
    paddingBottom: BAR_PAD_BOTTOM,
  },
  controls: { marginTop: BAR_CONTROLS_TOP, gap: ROW_GAP },
  // Fixed-size squares wrapping COLUMN-WISE inside the two-row height
  // submenuHeight reserves (Facet's sectionWrap): the first column is
  // Random over Erase, and six columns of twelve buttons fit a phone's bar.
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
  // The symmetry grid's rows: four flex cells splitting the full bar width
  // (no label column), each row at the segmented-row height so the bar's
  // reserved height (submenuHeight's three ROW_SEGMENTED) still fits.
  symRow: { flexDirection: 'row', gap: PATTERN_TILE_GRID_GAP, height: ROW_SEGMENTED },
  symCell: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: PANEL_TRACK,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  symCellActive: { borderColor: STATE_ACTIVE },
  symWord: { color: PANEL_INK_DIM, fontSize: 11, fontWeight: '600' },
  symWordActive: { color: PANEL_INK },
});
