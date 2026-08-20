import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { PANEL_BG, PANEL_BORDER, PANEL_INK } from '../theme';

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

export function AppModal({
  visible,
  title,
  onClose,
  headerRight,
  headerStyle,
  headerForeground = PANEL_INK,
  headerBackground,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  /** Extra controls between the title and the close X. */
  headerRight?: React.ReactNode;
  /** Style override for the header band (e.g. a flat color). */
  headerStyle?: object;
  /** Ink for the title and close icon (e.g. luma-picked over a color). */
  headerForeground?: string;
  /** Node painted absolutely behind the header row (e.g. checkerboard). */
  headerBackground?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={[styles.header, headerStyle]}>
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: PANEL_BG },
  // Facet's compact header metrics (paddingVertical 18, title 18/700),
  // with the editor webview's status-bar clearance on top and the panel
  // hairline underneath. overflow:hidden clips headerBackground to the band.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 48,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: PANEL_BORDER,
    overflow: 'hidden',
  },
  title: { fontSize: 18, fontWeight: '700', flex: 1, paddingLeft: 4 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  closeIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
});
