import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { TextFontOption, TextHAlign, TextStyleModel, TextVAlign, TextWeight } from '../adapter';
import { ROW_PILL } from '../logic/submenuHeight';
import {
  ACCENT, BarBody,
  PILL_CHEVRON, PILL_TRACK, SegmentedRow, SHEET_BG, SHEET_BORDER, SHEET_LABEL,
  SHEET_ROW_ACTIVE, SHEET_TEXT, SliderRow,
} from './effectBar';

// The Text typography controls (design "5a"), split into three pages — three
// tabs of the Edit sheet (the text's colour is the Color page's):
//   • Type    — Font (a pill that opens a font sheet) · Weight (segmented)
//     · Size (slider).
//   • Spacing — Character spacing · Line spacing · Bend (arc curvature,
//     slider centered at flat), a slider row each.
//   • Align   — horizontal justification (left/center/right) · vertical
//     alignment (top/middle/bottom), unlabelled: the glyphs say it.
// All three share this component (via `page`) and the row grammar of the
// image-effect pages (Drop Shadow / Border / Crop; see effectBar.tsx). The
// sheet around them is the ObjectPropertiesPanel's, shared with those pages.

export type TextPage = 'font' | 'spacing' | 'align';

type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

// ── Ranges (world-cell units where the design's pt/percent map onto these) ─
const SIZE_MIN = 0.5; // 8pt ÷ 16
const SIZE_MAX = 6; // 96pt ÷ 16
const LS_MIN = -0.05; // letter spacing (em), design −0.5pt-ish
const LS_MAX = 0.5; // em, design 2.0pt-ish
const LH_MIN = 0.8; // line height 80%
const LH_MAX = 2.0; // line height 200%
// Bend: −1 (full arc down) … +1 (full arc up), 0 = flat — so the slider
// STARTS IN THE MIDDLE and pushing either way curves the text that way.
const BEND_MIN = -1;
const BEND_MAX = 1;

const WEIGHTS: readonly { value: TextWeight; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'regular', label: 'Regular' },
  { value: 'semibold', label: 'Semibold' },
  { value: 'bold', label: 'Bold' },
];

const ALIGNS: readonly { value: TextHAlign; label: string; icon: MCIName }[] = [
  { value: 'left', label: 'Align left', icon: 'format-align-left' },
  { value: 'center', label: 'Align center', icon: 'format-align-center' },
  { value: 'right', label: 'Align right', icon: 'format-align-right' },
];

const VALIGNS: readonly { value: TextVAlign; label: string; icon: MCIName }[] = [
  { value: 'top', label: 'Align top', icon: 'format-align-top' },
  { value: 'middle', label: 'Align middle', icon: 'format-align-middle' },
  { value: 'bottom', label: 'Align bottom', icon: 'format-align-bottom' },
];

/** The Font row: a full-width pill showing the current family, tapping it
 *  opens the font sheet. No label column — the family's name says what the
 *  pill is. */
function FontRow({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <View style={styles.row}>
      <Pressable style={styles.pill} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Font: ${label}`}>
        <Text style={styles.pillText} numberOfLines={1}>{label}</Text>
        <MaterialCommunityIcons name="chevron-down" size={16} color={PILL_CHEVRON} />
      </Pressable>
    </View>
  );
}

/** The font sheet: presented over the bar; a scrollable list of families each
 *  rendered in its own face, a checkmark on the current one, and Done. */
function FontSheet({ fonts, current, onPick, onClose }: {
  fonts: readonly TextFontOption[];
  current: string;
  onPick: (fontId: string) => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.sheet}>
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle}>FONT</Text>
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Done">
          <Text style={styles.sheetDone}>Done</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.sheetList} keyboardShouldPersistTaps="handled">
        {fonts.map((f) => {
          const active = f.fontId === current;
          return (
            <Pressable
              key={f.fontId}
              onPress={() => onPick(f.fontId)}
              style={[styles.sheetRow, active && styles.sheetRowActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={f.label}
            >
              <Text style={[styles.sheetRowLabel, f.fontFamily ? { fontFamily: f.fontFamily } : null]} numberOfLines={1}>
                {f.label}
              </Text>
              {active ? <MaterialCommunityIcons name="check" size={18} color={ACCENT} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function TextBar({ page, style, fonts, onChange, onCommit, onSheetOpenChange }: {
  /** Which page to render: font, spacing or alignment controls. */
  page: TextPage;
  style: TextStyleModel;
  fonts: readonly TextFontOption[];
  /** Live preview (slider drag). */
  onChange: (s: TextStyleModel) => void;
  /** Commit as one undo step (slider release, segment / font pick). */
  onCommit: (s: TextStyleModel) => void;
  /** Fires when the font sheet opens / closes so the panel can suspend its
   *  swipe-to-dismiss gesture — otherwise scrolling the font list reads as a
   *  downward dismiss swipe. */
  onSheetOpenChange?: (open: boolean) => void;
}) {
  const [sheetOpen, setSheetOpenState] = useState(false);
  const setSheetOpen = (open: boolean) => {
    setSheetOpenState(open);
    onSheetOpenChange?.(open);
  };
  const set = (patch: Partial<TextStyleModel>, committed: boolean) =>
    (committed ? onCommit : onChange)({ ...style, ...patch });

  const currentLabel = fonts.find((f) => f.fontId === style.fontId)?.label ?? style.fontId;
  const isFont = page === 'font';

  return (
    <View>
      {/* Nothing to remove on any page: the text's type is edited in place. */}
      <BarBody>
        {isFont ? (
          <>
            <FontRow label={currentLabel} onOpen={() => setSheetOpen(true)} />
            {/* Light / Regular / Semibold / Bold name themselves: no label. */}
            <SegmentedRow
              options={WEIGHTS}
              value={style.weight}
              onChange={(weight) => set({ weight }, true)}
            />
            <SliderRow
              label="Size"
              value={(style.size - SIZE_MIN) / (SIZE_MAX - SIZE_MIN)}
              apply={(t, c) => set({ size: SIZE_MIN + t * (SIZE_MAX - SIZE_MIN) }, c)}
            />
          </>
        ) : page === 'spacing' ? (
          <>
            {/* Character (letter spacing) and Line (line height), a row each. */}
            <SliderRow
              label="Char"
              value={(style.letterSpacing - LS_MIN) / (LS_MAX - LS_MIN)}
              apply={(t, c) => set({ letterSpacing: LS_MIN + t * (LS_MAX - LS_MIN) }, c)}
            />
            <SliderRow
              label="Line"
              value={(style.lineHeight - LH_MIN) / (LH_MAX - LH_MIN)}
              apply={(t, c) => set({ lineHeight: LH_MIN + t * (LH_MAX - LH_MIN) }, c)}
            />
            {/* Bend: curve the lines along an arc — up past the middle,
                down before it; the readout speaks signed percent (0% flat). */}
            <SliderRow
              label="Bend"
              value={(style.bend - BEND_MIN) / (BEND_MAX - BEND_MIN)}
              apply={(t, c) => set({ bend: BEND_MIN + t * (BEND_MAX - BEND_MIN) }, c)}
              readout={{
                text: `${Math.round(style.bend * 100)}%`,
                commit: (n) => set({ bend: Math.max(BEND_MIN, Math.min(BEND_MAX, n / 100)) }, true),
              }}
            />
          </>
        ) : (
          <>
            {/* Horizontal, then vertical — unlabelled: the align glyphs say
                which row is which. */}
            <SegmentedRow
              options={ALIGNS}
              value={style.align}
              onChange={(align) => set({ align }, true)}
            />
            <SegmentedRow
              options={VALIGNS}
              value={style.vAlign}
              onChange={(vAlign) => set({ vAlign }, true)}
            />
          </>
        )}
      </BarBody>
      {isFont && sheetOpen ? (
        <FontSheet
          fonts={fonts}
          current={style.fontId}
          onPick={(fontId) => { set({ fontId }, true); setSheetOpen(false); }}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', height: ROW_PILL },
  pill: {
    flex: 1, height: 32, flexDirection: 'row', alignItems: 'center',
    backgroundColor: PILL_TRACK, borderRadius: 9, paddingHorizontal: 12,
  },
  pillText: { flex: 1, color: SHEET_TEXT, fontSize: 13.5 },
  // Font sheet — presented over the page, rising from its foot.
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: 288,
    backgroundColor: SHEET_BG, borderWidth: 1, borderColor: SHEET_BORDER,
    borderRadius: 14, padding: 8,
    // Half the dark scheme's shadow opacity: over a light bar this only has to
    // read as a layer above, not as a hole punched through it.
    shadowColor: '#000', shadowOpacity: 0.32, shadowRadius: 34, shadowOffset: { width: 0, height: 12 }, elevation: 12,
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 8, paddingTop: 4, paddingBottom: 8 },
  sheetTitle: { color: SHEET_LABEL, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  sheetDone: { color: ACCENT, fontSize: 13 },
  sheetList: { flexGrow: 0 },
  sheetRow: { height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 9, paddingHorizontal: 12 },
  sheetRowActive: { backgroundColor: SHEET_ROW_ACTIVE },
  sheetRowLabel: { flex: 1, color: SHEET_TEXT, fontSize: 15 },
});
