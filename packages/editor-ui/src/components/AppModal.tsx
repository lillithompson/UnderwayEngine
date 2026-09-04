import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
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

/** The status-bar clearance a takeover header wears when the host names
 *  none: Facet's webview constant, kept as the fallback so a modal outside
 *  the editor still clears a notch. Editor hosts pass `safeTop` (the
 *  toolbar's own top edge) instead — see the prop. */
const DEFAULT_SAFE_TOP = 48;

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
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.screen, background ? { backgroundColor: background } : null]}>
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
        <View style={styles.body}>{children}</View>
      </View>
    </Modal>
  );
}

/** The takeover's Done button — the STANDARD way out of an AppModal whose
 *  picks don't dismiss it (the Symmetry grid, the Layout aligns, the Tiles
 *  sheet). The color picker's Set Color button is the layout this follows —
 *  full content width, 44pt, bold 15 label — with the selection blue for a
 *  face where Set Color wears the chosen color itself. Pass `width` to match
 *  the content block it closes (a grid's row width); omitted, it stretches. */
export function AppModalDoneButton({ onPress, width }: {
  onPress: () => void;
  width?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Done"
      onPress={onPress}
      style={[styles.done, width != null ? { width } : styles.doneStretch]}
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
  title: { fontSize: 18, fontWeight: '700', flex: 1, paddingLeft: 4 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  closeIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
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
  doneLabel: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
