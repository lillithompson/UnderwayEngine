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
import { PANEL_BORDER, PANEL_INK, PANEL_INK_DIM, PANEL_TRACK, STATE_ACTIVE } from '../theme';
import { AppModal, AppModalDoneButton } from './AppModal';
import { PatternTileTransformModal } from './PatternTileTransformModal';

// The Tiles bar's takeover: every tile the menu offers, laid out as a grid
// of square buttons. Tapping one arms it and the sheet STAYS — the standard
// AppModal rule: a pick is not a dismissal, so tiles can be browsed and
// re-picked freely, and a tile keeps the same pose gestures as the bar's
// recent grid (a second tap inside the double-tap window turns it a quarter
// clockwise; a long press opens the transform modal over this one — the
// hint under the title says so). The way out is the floating Done capsule
// riding over the scroll's foot — the selection blue, the standard
// AppModalDoneButton in its floating form — or the X floating at the top
// right. There is still no confirm — the arming already happened on the
// first tap.
//
// The sheet is ALL grid: the title and the hint are the first thing in the
// scroll rather than a fixed band above it (AppModal's floatingClose), so
// they scroll away with the tiles and a phone screen spends none of its
// height holding one word still. Nothing rules them off from the grid
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

/** How far the floating Done capsule stands off the sheet's bottom edge —
 *  clear of a phone screen's bottom curve and home indicator. */
const DONE_BOTTOM = 32;

/** The capsule's own height — AppModalDoneButton's 44pt, named here so the
 *  scroll's foot can pad past it. */
const DONE_HEIGHT = 44;

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
  // The capsule spans the grid it closes — the same width the rows have, so
  // it reads as the foot of this content rather than a pill dropped on it.
  const doneWidth = sheetWidth > 0
    ? Math.max(tile, sheetWidth - PATTERN_MODAL_PAD * 2) : undefined;

  return (
    // No header band at all (floatingClose): the title rides in the scroll
    // below and the X floats over the grid. The band it replaces was the
    // chrome's DEFAULT header — never seated on the toolbar — and this
    // sheet still takes no clearance prop, so no host can hand it a taller
    // one.
    <AppModal visible={visible} title="Tiles" onClose={onClose} floatingClose>
      <View style={styles.sheet} onLayout={(e) => setSheetWidth(e.nativeEvent.layout.width)}>
        <ScrollView
          // The foot pads past the floating Done capsule, so the last row
          // can always scroll up from under it.
          contentContainerStyle={[styles.body, { paddingBottom: DONE_HEIGHT + DONE_BOTTOM + 24 }]}
        >
          {/* The sheet's own title and hint — inside the scroll, so they go
              up with the tiles. The title is bigger than a header band's
              because it is a page heading now, not chrome, and it has the
              room. The close X floats clear of it, on the right. */}
          <View style={styles.head}>
            <Text style={styles.title}>Tiles</Text>
            <Text style={styles.hint}>double tap to rotate, long press to mirror</Text>
          </View>
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
        {/* Done: picks don't dismiss (see the note up top), so the sheet
            still needs a way out — the STANDARD takeover Done button in its
            floating form (a wide capsule), riding over the scroll. It
            carries the word alone now: the armed tile it used to wear named
            what closing keeps, but the grid says the same thing right there
            in the selected cell, and a picture inside a button reads as a
            second thing to press. No footer strip behind it: the grid
            scrolls underneath, and it stands DONE_BOTTOM clear of the
            screen's bottom curve. */}
        <View style={styles.doneWrap} pointerEvents="box-none">
          <AppModalDoneButton floating width={doneWidth} onPress={onClose} />
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
  // Title + hint as one block at the head of the scroll. The gap between
  // them is the pair's own; the body's gap holds it off the first section.
  head: { gap: 6 },
  title: { fontSize: 30, fontWeight: '700', color: PANEL_INK },
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
  doneWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: DONE_BOTTOM,
    alignItems: 'center',
  },
});
