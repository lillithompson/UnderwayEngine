import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, Easing, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { HEADER_HEIGHT, PANEL_BG, PANEL_BORDER, PANEL_INK, STATE_ACTIVE } from '../theme';

// The ONE full-screen modal shell — Facet's AppModal, in its compact
// (phone) form, on the editor's light panel scheme. Every full-screen
// takeover wears this chrome: a header band with the title on the left
// (18/700, exactly Facet's) and a close X on the right, a hairline under
// it, and a body that fills the rest of the screen. Fade animation, like
// Facet — a takeover is a place you look at, not a sheet that arrives.
//
// The panel (light) scheme is deliberate where Facet's is dark: the host
// bakes tile thumbnails in PANEL_INK for the light bars, so a dark sheet
// would render the Tiles takeover near-invisible (see PatternTileModal's
// note). The floating CARD modals (rename, tile transform) are a different
// species — they float over the editor and stay on the dark modal scheme.
//
// `headerStyle` / `headerForeground` / `headerBackground` exist for the
// color picker, whose header IS the current color: a background node
// (checkerboard + color wash) painted behind the title row, with the ink
// flipped black/white by luma — the same override hooks Facet's AppModal
// grew for the same customer.
//
// `floatingClose` drops the band entirely and floats the X over the body,
// for a takeover whose content is the whole page: the Tiles grid draws its
// own title at the head of its scroll, so the title scrolls away with the
// tiles instead of holding a fixed strip of a phone screen to say one word.
//
// `page` is the third shape, and a different KIND of thing: a screen
// PUSHED over the editor rather than a sheet laid on top of it. It slides
// in from the right and is taken back by a chevron in the top left — the
// app's own pushed-page pattern (Settings and Profile, whose routes ask
// for slide_from_right over a PeerHeader "< Title" row). A takeover whose
// picks take effect AS THEY ARE MADE has nothing left to confirm, so it
// wants no Done button and no X standing in for one: going back is the
// confirmation, which is what a chevron says and what a Done button —
// sitting there like a decision still to be taken — does not.

/** The status-bar clearance a takeover header wears when the host names
 *  none: Facet's webview constant, kept as the fallback so a modal outside
 *  the editor still clears a notch. Editor hosts pass `safeTop` (the
 *  toolbar's own top edge) instead — see the prop. */
const DEFAULT_SAFE_TOP = 48;

/** How long the pushed page takes to come in from the right, and to go
 *  back out. Longer than the panels' PANEL_ANIM_MS: this is a whole
 *  screen's width of travel, and at 150ms it reads as a jump. */
export const PAGE_SLIDE_MS = 240;

export function AppModal({
  visible,
  title,
  onClose,
  safeTop = DEFAULT_SAFE_TOP,
  headerRight,
  headerStyle,
  headerForeground = PANEL_INK,
  headerBackground,
  background,
  floatingClose = false,
  page = false,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  /** Clearance above the header's content row. The header's TOTAL height is
   *  safeTop + HEADER_HEIGHT, so when the host passes the editor toolbar's
   *  top edge (EditorShell's toolbarTop), the header's bottom hairline
   *  lands exactly on the toolbar's own bottom edge — opening a takeover
   *  never moves the chrome's 'top edge'. */
  safeTop?: number;
  /** Extra controls between the title and the close X. */
  headerRight?: React.ReactNode;
  /** Style override for the header band (e.g. a flat color). */
  headerStyle?: object;
  /** Ink for the title and close icon (e.g. luma-picked over a color). */
  headerForeground?: string;
  /** Node painted absolutely behind the header row (e.g. checkerboard). */
  headerBackground?: React.ReactNode;
  /** Sheet color behind the body. Default is the light panel surface; the
   *  color picker passes the dark modal grey (its swatches and wheel read
   *  against dark, like Facet's original picker sheet). */
  background?: string;
  /** NO header band: the close X floats over the body's top-right corner
   *  and the takeover draws its own title, usually inside its scroll so
   *  the title scrolls away with the content instead of standing over it
   *  in a band. The band's hairline goes with it — there is nothing left
   *  to rule off. The body still clears the status bar by `safeTop`; the
   *  `title` is kept as the screen's accessibility label, since there is
   *  no longer a <Text> carrying it. For a takeover whose content IS the
   *  page (the Tiles grid), where a fixed band spent a title's height of
   *  a phone screen saying one word. */
  floatingClose?: boolean;
  /** A PUSHED PAGE rather than a sheet: in from the right, out by a
   *  chevron in the top left, no X and no Done (see the note up top).
   *  Takes precedence over `floatingClose` — a pushed page is headed by
   *  the "< Title" row the chevron hangs in. */
  page?: boolean;
  children: React.ReactNode;
}) {
  // The pushed page's travel. The Modal has to OUTLIVE `visible` for the
  // way out to be seen at all — one unmounted the frame the flag drops
  // takes its own exit animation with it — so the slide drives a
  // `mounted` flag of its own and the Modal reads that.
  const { width } = useWindowDimensions();
  const slide = useRef(new Animated.Value(1)).current;
  const [mounted, setMounted] = useState(visible);
  useEffect(() => {
    if (!page) { setMounted(visible); return undefined; }
    if (visible) setMounted(true);
    const anim = Animated.timing(slide, {
      toValue: visible ? 0 : 1,
      duration: PAGE_SLIDE_MS,
      // Decelerating in, accelerating out: the page arrives under the
      // finger that asked for it and leaves the way it came.
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      // A transform alone, so the whole travel runs off the JS thread —
      // the canvas underneath is still drawing.
      useNativeDriver: true,
    });
    anim.start(({ finished }) => { if (finished && !visible) setMounted(false); });
    return () => anim.stop();
  }, [page, visible, slide]);

  // Held against the two things it is built from: a fresh animated node
  // every render would be attached and torn down mid-slide.
  const pageX = useMemo(() => Animated.multiply(slide, width), [slide, width]);

  const Screen = page ? Animated.View : View;
  return (
    <Modal
      visible={page ? mounted : visible}
      transparent
      // The pushed page animates itself, edge to edge; a fade over the
      // top of that would be two entrances at once.
      animationType={page ? 'none' : 'fade'}
      onRequestClose={onClose}
    >
      <Screen
        style={[
          styles.screen,
          background ? { backgroundColor: background } : null,
          page ? { transform: [{ translateX: pageX }] } : null,
        ]}
        // Headerless, there is no <Text> carrying the title — the screen
        // takes it, so the takeover still announces itself.
        accessibilityLabel={floatingClose && !page ? title : undefined}
      >
        {page ? (
          // The app's own pushed-page header: the chevron in the gutter
          // on the left, the title beside it. No X and no Done — going
          // back is the way out and the confirmation both.
          <View
            style={[
              styles.header,
              styles.headerBack,
              { paddingTop: safeTop, height: safeTop + HEADER_HEIGHT },
              headerStyle,
            ]}
          >
            {headerBackground}
            <Pressable
              style={styles.backIcon}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={'Back from ' + title}
            >
              <MaterialCommunityIcons name="chevron-left" size={32} color={headerForeground} />
            </Pressable>
            <Text style={[styles.title, { color: headerForeground }]} numberOfLines={1}>
              {title}
            </Text>
            {headerRight}
          </View>
        ) : null}
        {page || floatingClose ? null : (
          <View
            style={[
              styles.header,
              // Sized, not padded, to the editor's own chrome: clearance
              // above, one HEADER_HEIGHT row of content below (see the
              // safeTop prop).
              { paddingTop: safeTop, height: safeTop + HEADER_HEIGHT },
              headerStyle,
            ]}
          >
            {headerBackground}
            <Text style={[styles.title, { color: headerForeground }]} numberOfLines={1}>
              {title}
            </Text>
            <View style={styles.headerActions}>
              {headerRight}
              <Pressable
                style={styles.closeIcon}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <MaterialCommunityIcons name="close" size={26} color={headerForeground} />
              </Pressable>
            </View>
          </View>
        )}
        {/* With no band above it the body takes the status-bar clearance
            itself, so the takeover's own first line starts where the
            header's title would have. */}
        <View style={[styles.body, floatingClose && !page ? { paddingTop: safeTop } : null]}>
          {children}
        </View>
        {/* …and the X rides OVER that body rather than in a band above it:
            a panel-colored chip, so it stays legible over whatever scrolls
            beneath it. */}
        {floatingClose && !page ? (
          <Pressable
            style={[styles.floatingClose, { top: safeTop + 4 }]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <MaterialCommunityIcons name="close" size={26} color={PANEL_INK} />
          </Pressable>
        ) : null}
      </Screen>
    </Modal>
  );
}

/** The takeover's Done button — the STANDARD way out of an AppModal whose
 *  picks don't dismiss it (the Symmetry grid, the Layout aligns, the Tiles
 *  sheet). The color picker's Set Color button is the layout this follows —
 *  full content width, 44pt, bold 15 label — with the selection blue for a
 *  face where Set Color wears the chosen color itself. Pass `width` to match
 *  the content block it closes (a grid's row width); omitted, it stretches. */
export function AppModalDoneButton({ onPress, width, floating = false }: {
  onPress: () => void;
  width?: number;
  /** Riding OVER a scrolling body rather than sitting in the flow beneath
   *  it (the Tiles sheet, whose grid runs on under it): a full CAPSULE, and
   *  no top margin — the scroll's own foot pads the last row clear of it. */
  floating?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Done"
      onPress={onPress}
      style={[
        styles.done,
        floating ? styles.doneFloating : null,
        width != null ? { width } : styles.doneStretch,
      ]}
    >
      <Text style={styles.doneLabel}>Done</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: PANEL_BG },
  // The band: status-bar clearance on top (the inline paddingTop/height —
  // safeTop + HEADER_HEIGHT, matching the editor toolbar's bottom edge),
  // Facet's title type (18/700), and the panel hairline underneath.
  // overflow:hidden clips headerBackground to the band.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: PANEL_BORDER,
    overflow: 'hidden',
  },
  // The pushed page's row: the chevron leads, so the title follows it
  // rather than being pushed off the far side by a trailing action.
  headerBack: { justifyContent: 'flex-start', paddingHorizontal: 2, gap: 2 },
  title: { fontSize: 18, fontWeight: '700', flex: 1, paddingLeft: 4 },
  // The same 40pt target the close X wears, in the left gutter.
  backIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  closeIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  // The headerless variant's X: the same 40pt target, rounded and filled
  // with the sheet's own surface so it reads over a scrolling grid.
  floatingClose: {
    position: 'absolute',
    right: 8,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PANEL_BG,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PANEL_BORDER,
  },
  body: { flex: 1 },
  // The Set Color button's metrics (ColorPickerModal.confirmButton).
  done: {
    marginTop: 20,
    height: 44,
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: STATE_ACTIVE,
  },
  doneStretch: { alignSelf: 'stretch' },
  // Height 44 → radius 22: a capsule, not a rounded rectangle.
  doneFloating: { marginTop: 0, borderRadius: 22 },
  doneLabel: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
