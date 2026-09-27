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

// The Tiles chooser: every tile the menu offers, laid out as a grid of
// square buttons. Tapping one arms it and the page STAYS — a pick is not
// a dismissal, so tiles can be browsed and re-picked freely, and a tile
// keeps the same pose gestures as the bar's recent grid (a second tap
// inside the double-tap window turns it a quarter clockwise; a long press
// opens the transform modal over this one — the hint under the title says
// so).
//
// It is a PUSHED PAGE (AppModal's `page`), not a takeover: in from the
// right, out by the chevron in the top left, the shape Settings and
// Profile have. It had a floating Done capsule over the foot of the
// scroll and an X in the corner — two ways out of a page that has nothing
// to confirm, since every tap has already armed what it picked. Going
// back IS the confirmation; a Done button sat there looking like a
// decision still to be taken, and the capsule spent the bottom of the
// grid saying so.
//
// The title and the hint head the scroll rather than standing in a fixed
// band, so they go up with the tiles and a phone screen spends none of
// its height holding one word still. Nothing rules them off from the grid
// either — the break in the content says where the reading stops.
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

/** What the last row of the grid keeps clear of the screen's bottom curve
 *  and home indicator. It used to be the floating Done capsule's height
 *  and standoff; with the capsule gone the grid still wants a foot, and
 *  a shorter one. */
const GRID_FOOT = 32;

export function PatternTileModal({ visible, tiles, activeId, transforms, onPick, onSetTransform, onClose }: {
  visible: boolean;
  tiles: readonly PatternTileRow[];
  activeId: string | null;
  /** Each tile's pose, keyed by sprite id (identity when missing). */
  transforms?: Record<string, PatternTileTransform>;
  onPick: (id: string) => void;
  onSetTransform?: (id: string, transform: PatternTileTransform) => void;
  onClose: () => void;
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

  return (
    // A pushed page (AppModal's `page`): in from the right under a "<
    // Tiles" row, back out by the chevron. This page takes no clearance
    // prop, so no host can hand it a taller header than the app's own.
    <AppModal visible={visible} title="Tiles" onClose={onClose} page>
      <View style={styles.sheet} onLayout={(e) => setSheetWidth(e.nativeEvent.layout.width)}>
        <ScrollView
          // A foot under the last row, clear of the screen's bottom curve.
          contentContainerStyle={[styles.body, { paddingBottom: GRID_FOOT + 24 }]}
        >
          {/* The page's own hint — inside the scroll, so it goes up with
              the tiles. The page's NAME is the header row's now, beside
              the chevron: a second, larger "Tiles" two lines under it was
              the word said twice. */}
          <Text style={styles.hint}>double tap to rotate, long press to mirror</Text>
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
        {/* No Done button. Every tap has already armed the tile it
            landed on, so there is nothing here left to confirm — the
            chevron in the header takes the page back, and what is armed
            is what the grid is showing selected. */}
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
  // The hint at the head of the scroll; the body's gap holds it off the
  // first section.
  hint: {
    fontStyle: 'italic',
    fontSize: 15,
    lineHeight: 20,
    color: PANEL_INK_DIM,
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
});
