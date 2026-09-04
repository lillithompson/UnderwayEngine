import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  PATTERN_MODAL_GRID_GAP,
  PATTERN_MODAL_PAD,
  PATTERN_TILE_TRANSFORM_IDENTITY,
  groupPatternTiles,
  isPatternTileDoubleTap,
  patternModalTileSize,
  patternTileThumbTransforms,
  rotatePatternTileTransform,
  type PatternTileRow,
  type PatternTileTransform,
} from '../logic/patternEdit';
import { PANEL_BORDER, PANEL_INK_DIM, PANEL_TRACK, STATE_ACTIVE } from '../theme';
import { AppModal } from './AppModal';
import { PatternTileTransformModal } from './PatternTileTransformModal';

// The Tiles bar's takeover: every tile the menu offers, laid out as a grid
// of square buttons. Tapping one arms it and the sheet STAYS — the standard
// AppModal rule: a pick is not a dismissal, so tiles can be browsed and
// re-picked freely, and a tile keeps the same pose gestures as the bar's
// recent grid (a second tap inside the double-tap window turns it a quarter
// clockwise; a long press opens the transform modal over this one — the
// hint under the header says so). The way out is the floating Done square
// riding over the scroll's foot — the selection blue, wearing the armed
// tile itself so it names what closing keeps — or the header's X. There is
// still no confirm — the arming already happened on the first tap.
//
// This sheet wears the unified takeover chrome (AppModal — the PANEL
// scheme, not the dark MODAL one the floating rename card uses), and that
// is not a stylistic whim: the host bakes tile thumbnails in PANEL_INK for
// the light bar, so on a #3f3f3f card the entire grid would be
// near-invisible dark-on-dark. The SELECTED cell inverts: selection-blue
// ground, the tile's white bake (PatternTileRow.activeUri) over it.
//
// The grouping by connection count is the old TilePalette's, kept because
// with the whole registry on screen at once it is the only thing that makes
// a particular tile findable — but it shows as a light rule between the
// sections now, not a caption: the counts named plumbing, the break alone
// says "a different family starts here".

export { PATTERN_MODAL_TILE } from '../logic/patternEdit';

/** How far the floating Done square stands off the sheet's bottom edge —
 *  clear of a phone screen's bottom curve and home indicator. */
const DONE_BOTTOM = 32;

export function PatternTileModal({ visible, tiles, activeId, transforms, onPick, onSetTransform, onClose, safeTop }: {
  visible: boolean;
  tiles: readonly PatternTileRow[];
  activeId: string | null;
  /** Each tile's pose, keyed by sprite id (identity when missing). */
  transforms?: Record<string, PatternTileTransform>;
  onPick: (id: string) => void;
  onSetTransform?: (id: string, transform: PatternTileTransform) => void;
  onClose: () => void;
  /** Header clearance — see AppModal's safeTop. */
  safeTop?: number;
}) {
  const groups = groupPatternTiles(tiles);
  const [transformId, setTransformId] = useState<string | null>(null);
  const [sheetWidth, setSheetWidth] = useState(0);
  const lastTapRef = useRef<{ id: string; time: number }>({ id: '', time: 0 });
  // A re-open must not inherit the previous visit's half-open transform
  // card or double-tap arm.
  useEffect(() => {
    if (!visible) {
      setTransformId(null);
      lastTapRef.current = { id: '', time: 0 };
    }
  }, [visible]);

  const poseOf = (id: string) => transforms?.[id] ?? PATTERN_TILE_TRANSFORM_IDENTITY;
  const transformUri = transformId
    ? tiles.find((t) => t.id === transformId)?.uri ?? null
    : null;

  const tile = patternModalTileSize(sheetWidth);
  const doneSize = Math.round(tile * 1.5);
  const activeRow = activeId ? tiles.find((t) => t.id === activeId) ?? null : null;

  return (
    <AppModal visible={visible} title="Tiles" onClose={onClose} safeTop={safeTop}>
      <View style={styles.sheet} onLayout={(e) => setSheetWidth(e.nativeEvent.layout.width)}>
        <Text style={styles.hint}>double tap to rotate, long press to mirror</Text>
        <ScrollView
          // The foot pads past the floating Done square, so the last row
          // can always scroll up from under it.
          contentContainerStyle={[styles.body, { paddingBottom: doneSize + DONE_BOTTOM + 24 }]}
        >
          {groups.map((g, i) => (
            <View key={g.connections} style={styles.section}>
              {/* A light rule where one connection-count family ends and
                  the next begins — the caption that used to say so is
                  gone. */}
              {i > 0 ? <View style={styles.rule} /> : null}
              <View style={styles.grid}>
                {g.tiles.map((t) => {
                  const active = t.id === activeId;
                  return (
                    <Pressable
                      key={t.id}
                      onPress={() => {
                        const now = Date.now();
                        if (isPatternTileDoubleTap(lastTapRef.current, t.id, now)) {
                          onSetTransform?.(t.id, rotatePatternTileTransform(poseOf(t.id)));
                          lastTapRef.current = { id: '', time: 0 };
                        } else {
                          onPick(t.id);
                          lastTapRef.current = { id: t.id, time: now };
                        }
                      }}
                      onLongPress={() => {
                        onPick(t.id);
                        setTransformId(t.id);
                      }}
                      style={[
                        styles.tile,
                        { width: tile, height: tile },
                        active && styles.tileActive,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={t.id}
                    >
                      <Image
                        // The selected cell paints selection-blue, so it
                        // draws the WHITE bake — the panel ink would sink
                        // into the fill.
                        source={{ uri: active ? t.activeUri ?? t.uri : t.uri }}
                        style={[
                          { width: tile - 12, height: tile - 12 },
                          { transform: patternTileThumbTransforms(poseOf(t.id)) },
                        ]}
                      />
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
        {/* Done: picks don't dismiss (see the header note), so the sheet
            still needs a way out — a floating square over the scroll, 1.5
            tiles big, wearing the armed tile over its label so it shows
            what closing keeps. No footer strip behind it: the grid scrolls
            underneath, and it stands DONE_BOTTOM clear of the screen's
            bottom curve. */}
        <View style={styles.doneWrap} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Done"
            onPress={onClose}
            style={[styles.done, { width: doneSize, height: doneSize }]}
          >
            {activeRow ? (
              <Image
                source={{ uri: activeRow.activeUri ?? activeRow.uri }}
                style={[
                  { width: Math.round(doneSize * 0.55), height: Math.round(doneSize * 0.55) },
                  { transform: patternTileThumbTransforms(poseOf(activeRow.id)) },
                ]}
              />
            ) : null}
            <Text style={styles.doneLabel}>Done</Text>
          </Pressable>
        </View>
      </View>
      <PatternTileTransformModal
        visible={transformId != null}
        uri={transformUri}
        transform={transformId ? poseOf(transformId) : PATTERN_TILE_TRANSFORM_IDENTITY}
        onChange={(xform) => {
          if (transformId) onSetTransform?.(transformId, xform);
        }}
        onClose={() => setTransformId(null)}
      />
    </AppModal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  hint: {
    fontStyle: 'italic',
    fontSize: 12,
    lineHeight: 16,
    color: PANEL_INK_DIM,
    paddingHorizontal: PATTERN_MODAL_PAD,
    paddingTop: 10,
  },
  body: { padding: PATTERN_MODAL_PAD, gap: 18 },
  section: { gap: 18 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: PANEL_BORDER, alignSelf: 'stretch' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: PATTERN_MODAL_GRID_GAP },
  tile: {
    borderRadius: 8,
    backgroundColor: PANEL_TRACK,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  tileActive: { backgroundColor: STATE_ACTIVE, borderColor: STATE_ACTIVE },
  doneWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: DONE_BOTTOM,
    alignItems: 'center',
  },
  done: {
    borderRadius: 14,
    backgroundColor: STATE_ACTIVE,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  doneLabel: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
