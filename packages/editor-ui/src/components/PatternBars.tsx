import React, { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ObjectPropertiesModel } from '../adapter';
import {
  BAR_BORDER, BAR_CONTROLS_TOP, BAR_PAD_BOTTOM, BAR_PAD_HORIZONTAL, BAR_PAD_TOP,
  PATTERN_TILE_STRIP, ROW_GAP,
} from '../logic/submenuHeight';
import {
  PATTERN_ARM_TOOLS,
  PATTERN_GRID_ACTIONS,
  PATTERN_SYMMETRY_ENTRIES,
  groupPatternTiles,
} from '../logic/patternEdit';
import { PANEL_INK, PANEL_INK_DIM, PANEL_TRACK, STATE_ACTIVE } from '../theme';
import { ActionRow, BAR_BG, EffectBarHeader, HAIRLINE, MultiToggleRow, SegmentedRow } from './effectBar';

// The pattern object's three submenu bars — siblings of the effect bars,
// sharing their chrome and row grammar (effectBar.tsx):
//
//   • Tiles    — the horizontally scrolled tile menu, sectioned by how many
//                of a tile's 8 connection points are live (the old
//                TilePalette's grouping). Tapping a tile ARMS it: the next
//                canvas press inside the pattern stamps that tile.
//   • Tools    — the brush row (Random / Erase arm the sub-tool), the grid
//                actions (Reconcile / Clear run now, one undo step each),
//                and the Borders rule connectivity honors at the grid edge.
//   • Symmetry — the painting-mirror grid (the old symmetry modal's modes),
//                exclusive, with Off closing the set.

function barTitle(kind: 'tiles' | 'tools' | 'symmetry'): string {
  return kind === 'tiles' ? 'TILES' : kind === 'tools' ? 'TOOLS' : 'SYMMETRY';
}

export function PatternTilesBar({ model, onBack }: {
  model: ObjectPropertiesModel;
  onBack: () => void;
}) {
  const groups = groupPatternTiles(model.patternTiles ?? []);
  const activeId = model.patternTool === 'tile' ? model.patternActiveTileId : null;
  return (
    <View style={styles.bar}>
      <EffectBarHeader title={barTitle('tiles')} chevron onBack={onBack} />
      <View style={styles.controls}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ height: PATTERN_TILE_STRIP }}
        >
          {groups.map((g) => (
            <View key={g.connections} style={styles.tileSection}>
              <Text style={styles.tileCaption}>{g.connections}</Text>
              <View style={styles.tileRow}>
                {g.tiles.map((t) => {
                  const active = t.id === activeId;
                  return (
                    <Pressable
                      key={t.id}
                      onPress={() => model.onPatternPickTile?.(t.id)}
                      style={[styles.tile, active && styles.tileActive]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={t.id}
                    >
                      <Image source={{ uri: t.uri }} style={styles.tileImage} />
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

export function PatternToolsBar({ model, onBack }: {
  model: ObjectPropertiesModel;
  onBack: () => void;
}) {
  // The bar's second page: the tile-set filter the Sets row's 'Tiles'
  // button opens (Facet's Randomization Settings, as chip rows). Local —
  // it is a view of the same bar, not another submenu.
  const [showSets, setShowSets] = useState(false);
  const tool = model.patternTool === 'random' || model.patternTool === 'erase'
    ? model.patternTool
    : ('' as 'random'); // a tile is armed — neither brush cell lights
  const sets = model.patternTileSets ?? [];
  if (showSets) {
    // Chips in rows of three, then the Done row back to the tools.
    const chipRows: (typeof sets)[] = [];
    for (let i = 0; i < sets.length; i += 3) chipRows.push(sets.slice(i, i + 3));
    return (
      <View style={styles.bar}>
        <EffectBarHeader title={barTitle('tools')} chevron onBack={onBack} />
        <View style={styles.controls}>
          {chipRows.map((row, i) => (
            <MultiToggleRow
              key={i}
              label={i === 0 ? 'Sets' : ' '}
              options={row.map((s) => ({ value: s.family, label: s.label, active: s.enabled }))}
              onToggle={(family) => model.onPatternToggleTileSet?.(family)}
            />
          ))}
          <ActionRow
            label=" "
            options={[{ value: 'done' as const, label: 'Done' }]}
            onPress={() => setShowSets(false)}
          />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.bar}>
      <EffectBarHeader title={barTitle('tools')} chevron onBack={onBack} />
      <View style={styles.controls}>
        <SegmentedRow
          label="Brush"
          options={PATTERN_ARM_TOOLS.map((t) => ({ value: t.tool, label: t.label }))}
          value={tool}
          onChange={(t) => model.onPatternArmTool?.(t)}
        />
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
        {sets.length > 0 && (
          <ActionRow
            label="Sets"
            options={[{ value: 'tiles' as const, label: 'Tiles' }]}
            onPress={() => setShowSets(true)}
          />
        )}
      </View>
    </View>
  );
}

export function PatternSymmetryBar({ model, onBack }: {
  model: ObjectPropertiesModel;
  onBack: () => void;
}) {
  const current = model.patternSymmetry ?? 'off';
  // The 11 modes + Off, as three segmented rows of four (the old modal's
  // grid, read in rows, with Off closing the set).
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
          <SegmentedRow
            key={i}
            label={i === 0 ? 'Mirror' : ' '}
            options={row}
            value={current}
            // Tapping the ACTIVE mode again turns symmetry off, like the
            // old modal's toggle.
            onChange={(key) => model.onPatternSymmetry?.(key === current ? 'off' : key)}
          />
        ))}
      </View>
    </View>
  );
}

const TILE = 44;

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
  tileSection: { marginRight: 14 },
  tileCaption: {
    color: PANEL_INK_DIM,
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 0,
  },
  tileRow: { flexDirection: 'row', gap: 6 },
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
  tileActive: { borderColor: STATE_ACTIVE },
  tileImage: { width: TILE - 8, height: TILE - 8 },
});
