import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { RGBLike } from '../adapter';
import {
  CONTENT_PAD, SHEET_CONTENT_TOP, SHEET_PAD_HORIZONTAL, SHEET_PAD_TOP, sheetBottomInset,
  SHEET_REMOVE, SHEET_TABS,
} from '../logic/submenuHeight';
import {
  PANEL_BG, PANEL_BG_CLEAR, PANEL_CONTENT_WELL, PANEL_INK, PANEL_INK_MUTED,
  PANEL_SWATCH_BORDER, STATE_ACTIVE,
} from '../theme';
import { ColorSwatchFill } from './ColorSwatch';

// The Edit sheet: the type-specific half of the object-properties panel,
// popped up OVER the panel's common-actions row.
//
//   Crop  Shadow  Border  …    ← one tab per option, from the left
//   ┌────────────────────────┐
//   │ the showing page's     │ ← a slightly darkened, rounded well holding
//   │ controls               │   the lit tab's controls (a property page)
//   └────────────────────────┘
//                      Remove ← when the page's effect can be removed
//
// Tabs are the selection's options — what its KIND offers (crop / shadow /
// border …) followed by what the SELECTION offers (Layout · Group · Merge on
// a multi-selection). A tab that opens a page lights up in selection blue
// while its page is showing; a tab that is a one-press action (Group, Edit)
// fires and stays unlit; a toggle (Repeat, Invert) lights in its own colour
// while on. The row runs from the left edge, one gap apart, and SCROLLS when
// it outgrows the sheet.
//
// An overflowing row runs EDGE TO EDGE: the tab strip cancels the sheet's
// side padding and scrolls the full width of the screen (its content keeps
// that padding, so the first tab still lines up with everything below it).
// That is what makes the last reachable tab visibly CUT — it is clipped by
// the screen rather than stopping neatly inside a margin, which read as a
// row that simply ended — and the fade laid over the cut turns the clip
// into a soft edge that says there is more to swipe to. There is no swiping between
// pages: the tabs are the navigation. No title over the tabs: the lit tab
// says what the sheet is showing, and a heading only pushed it down.
//
// The sheet is presentational: the panel (ObjectPropertiesPanel) owns which
// tab is lit, what the well holds, the slide-up / swipe-down and the height
// animation between pages of different heights — this lays the pieces out
// at the metrics logic/submenuHeight predicts, so the two can't drift.

/** One tab, described rather than rendered. */
export interface EditTabSpec {
  key: string;
  /** Accessibility name (often longer than the visible word). */
  label: string;
  /** Visible word, when it differs from `label`. */
  caption?: string;
  /** True while this tab's page is the one showing — lights it. */
  selected?: boolean;
  /** An independent on/off state (Repeat, Invert) — lights the tab in
   *  `tint` while on, whatever page is showing. */
  toggled?: boolean;
  /** Fill for a toggled tab; defaults to selection blue. */
  tint?: string;
  /** Renders a small swatch of this color before the word — for a tab whose
   *  state is a color rather than on/off (the frame's Fill). */
  swatchColor?: RGBLike;
  onPress?: () => void;
}

/** The fade at either end of an overflowing tab row. Wide enough to take a
 *  word from ink to nothing across it, so the cut-off tab under it reads as
 *  fading out rather than as chopped. */
const TAB_FADE = 44;
/** The space between neighbouring tabs, the same whatever the row holds. */
const TAB_GAP = 12;

function EditTab({ tab }: { tab: EditTabSpec }) {
  const lit = !!tab.selected || !!tab.toggled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tab.label}
      accessibilityState={tab.selected !== undefined || tab.toggled !== undefined ? { selected: lit } : undefined}
      onPress={tab.onPress}
      style={styles.tab}
    >
      <View
        style={[
          styles.tabPill,
          tab.selected ? styles.tabPillSelected : null,
          tab.toggled ? { backgroundColor: tab.tint ?? STATE_ACTIVE } : null,
        ]}
      >
        {tab.swatchColor ? (
          <View style={styles.tabSwatch}>
            <ColorSwatchFill color={tab.swatchColor} />
          </View>
        ) : null}
        <Text style={[styles.tabLabel, lit && styles.tabLabelLit]} numberOfLines={1}>
          {tab.caption ?? tab.label}
        </Text>
      </View>
    </Pressable>
  );
}

/** The tab row: left-justified, a horizontal scroller when the tabs outgrow
 *  it, with the overflowing end faded into the sheet. The fades are
 *  worked out from the row's measured width, its content's, and the scroll
 *  offset — and held as the two booleans they decide, so a scroll re-renders
 *  the row only when a fade actually appears or goes. */
export function EditTabs({ tabs }: { tabs: readonly EditTabSpec[] }) {
  const [viewW, setViewW] = useState(0);
  const [contentW, setContentW] = useState(0);
  const [scrollX, setScrollX] = useState(0);
  const overflow = contentW > viewW + 1;
  const fadeRight = overflow && scrollX < contentW - viewW - 1;
  const fadeLeft = overflow && scrollX > 1;
  return (
    <View style={styles.tabs} onLayout={(e) => setViewW(e.nativeEvent.layout.width)}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsContent}
        onContentSizeChange={(w) => setContentW(w)}
        onScroll={(e) => {
          const x = e.nativeEvent.contentOffset.x;
          // Only the edges matter; a scroll that changes neither is not a
          // render.
          setScrollX((prev) => {
            const was = { l: prev > 1, r: prev < contentW - viewW - 1 };
            const now = { l: x > 1, r: x < contentW - viewW - 1 };
            return was.l === now.l && was.r === now.r ? prev : x;
          });
        }}
        scrollEventThrottle={32}
      >
        {tabs.map((t) => <EditTab key={t.key} tab={t} />)}
      </ScrollView>
      {fadeLeft ? (
        <LinearGradient
          pointerEvents="none"
          colors={[PANEL_BG, PANEL_BG_CLEAR]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.fade, styles.fadeLeft]}
        />
      ) : null}
      {fadeRight ? (
        <LinearGradient
          pointerEvents="none"
          colors={[PANEL_BG_CLEAR, PANEL_BG]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.fade, styles.fadeRight]}
        />
      ) : null}
    </View>
  );
}

export function EditSheet({ tabs, content, welled = true, remove, safeBottom = 0 }: {
  tabs: readonly EditTabSpec[];
  /** The showing page's controls, held in the well; null when no tab has a
   *  page showing (every tab is an action), which drops the well. */
  content: React.ReactNode | null;
  /** Draw the well around the content. False for a page that brings its own
   *  boxes (the Copies page's row groups), where a well would frame every
   *  section a second time — see logic/submenuHeight's pageIsWelled, which
   *  is what decides it and what measures the page to match. */
  welled?: boolean;
  /** The Remove line under the well, for a page whose effect can be
   *  removed (a drop shadow, a border) or reset (opacity). `label` is its
   *  accessibility name; the visible word is always Remove. */
  remove?: { label: string; onPress: () => void };
  /** The device's bottom safe-area inset. The sheet reserves the larger of
   *  it and SHEET_EDGE_CLEAR under its last line, so a draggable last row
   *  (the hue rows) is never left inside the screen's edge-gesture band —
   *  see logic/submenuHeight's sheetBottomInset, which is also what
   *  editSheetHeight measures. */
  safeBottom?: number;
}) {
  return (
    <View style={[styles.sheet, { paddingBottom: sheetBottomInset(safeBottom) }]}>
      <EditTabs tabs={tabs} />
      {content != null ? (
        <View style={welled ? styles.well : styles.bare}>{content}</View>
      ) : null}
      {content != null && remove ? (
        <View style={styles.removeRow}>
          <Pressable
            onPress={remove.onPress}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={remove.label}
          >
            <Text style={styles.removeLabel}>Remove</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingTop: SHEET_PAD_TOP,
    paddingHorizontal: SHEET_PAD_HORIZONTAL,
  },
  // Edge to edge: the strip cancels the sheet's side padding so an
  // overflowing row is cut by the SCREEN, and its content puts that padding
  // back so the first tab still lines up with the well below it.
  tabs: { height: SHEET_TABS, marginHorizontal: -SHEET_PAD_HORIZONTAL },
  // The tabs run from the LEFT edge, one gap apart — not spread across the
  // row — so a sheet with two tabs and one with six start the same way, and
  // a row that outgrows the sheet simply continues past the edge (which is
  // what makes it scroll).
  tabsContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: TAB_GAP,
    paddingHorizontal: SHEET_PAD_HORIZONTAL,
  },
  tab: { height: SHEET_TABS, justifyContent: 'center' },
  tabPill: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  tabPillSelected: { backgroundColor: STATE_ACTIVE },
  tabLabel: { fontSize: 17, fontWeight: '400', color: PANEL_INK },
  tabLabelLit: { color: '#ffffff', fontWeight: '600' },
  // A color-valued tab (the frame's Fill) keeps a small swatch ahead of its
  // word — on/off the tab can say itself, a color it can't.
  tabSwatch: {
    width: 12, height: 12, borderRadius: 6, overflow: 'hidden',
    borderWidth: 1, borderColor: PANEL_SWATCH_BORDER,
  },
  fade: { position: 'absolute', top: 0, bottom: 0, width: TAB_FADE },
  fadeLeft: { left: 0 },
  fadeRight: { right: 0 },
  // The content well: the showing page's controls in a slightly darkened,
  // rounded box. Its padding is submenuHeight's CONTENT_PAD.
  well: {
    marginTop: SHEET_CONTENT_TOP,
    padding: CONTENT_PAD,
    borderRadius: 16,
    backgroundColor: PANEL_CONTENT_WELL,
  },
  // A page that brings its own boxes takes the same seat under the tabs
  // with none of the well's dress — no fill, no radius, no padding.
  bare: { marginTop: SHEET_CONTENT_TOP },
  // The Remove line: right-aligned under the well, dim — a way out of the
  // effect, not one of its controls.
  removeRow: { height: SHEET_REMOVE, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'flex-end', paddingHorizontal: 4 },
  removeLabel: { fontSize: 16, color: PANEL_INK_MUTED },
});
