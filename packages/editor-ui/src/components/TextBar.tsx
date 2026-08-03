import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { TextFontOption, TextHAlign, TextStyleModel, TextVAlign, TextWeight } from '../adapter';
import { ACCENT, BAR_BG, DualSliderRow, EffectBarHeader, HAIRLINE, LABEL, SegmentedRow, SliderRow } from './effectBar';

// The Text typography bar (design "5a"), split into two carousel pages the
// ObjectPropertiesPanel cycles between:
//   • FONT  — color (header swatch) · Font (a pill that opens a font sheet) ·
//     Weight (segmented) · Size (slider).
//   • ALIGN — Character / Line spacing (dual slider) · horizontal justification
//     (left/center/right) · vertical alignment (top/middle/bottom).
// Both pages share this component (via `page`), the container, header and row
// grammar of the image-effect bars (Drop Shadow / Border / Crop; see
// effectBar.tsx). The slide-in / swipe-out chrome is the
// ObjectPropertiesPanel's, shared with those bars.

type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

// ── Ranges (world-cell units where the design's pt/percent map onto these) ─
const SIZE_MIN = 0.5; // 8pt ÷ 16
const SIZE_MAX = 6; // 96pt ÷ 16
const LS_MIN = -0.05; // letter spacing (em), design −0.5pt-ish
const LS_MAX = 0.5; // em, design 2.0pt-ish
const LH_MIN = 0.8; // line height 80%
const LH_MAX = 2.0; // line height 200%

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

// Sheet tokens (design 5a font sheet).
const SHEET_BG = 'rgba(58,58,60,0.98)';
const SHEET_BORDER = 'rgba(255,255,255,0.14)';
const SHEET_LABEL = 'rgba(255,255,255,0.55)';
const SHEET_ROW_ACTIVE = 'rgba(255,255,255,0.18)';
const PILL_TRACK = 'rgba(0,0,0,0.30)';
const PILL_CHEVRON = 'rgba(255,255,255,0.5)';

/** The Font row: a full-width pill showing the current family, tapping it
 *  opens the font sheet. */
function FontRow({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>Font</Text>
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

export function TextBar({ page, style, fonts, onChange, onCommit, onBack, onReset, onPickColor, onSheetOpenChange }: {
  /** Which carousel page to render: font controls or alignment controls. */
  page: 'font' | 'align';
  style: TextStyleModel;
  fonts: readonly TextFontOption[];
  /** Live preview (slider drag). */
  onChange: (s: TextStyleModel) => void;
  /** Commit as one undo step (slider release, segment / font pick). */
  onCommit: (s: TextStyleModel) => void;
  onBack: () => void;
  /** Reset type settings to defaults (trash); the bar stays open. */
  onReset: () => void;
  onPickColor: () => void;
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
    <View style={styles.bar}>
      <EffectBarHeader
        title={isFont ? 'FONT' : 'ALIGN'}
        // Color is a font property: only the Font page shows the swatch.
        color={isFont ? style.color : undefined}
        chevron
        // Both pages share one reset (size / spacing / weight → defaults,
        // keeping font, color and alignment), so the label stays neutral.
        removeLabel="Reset type settings"
        onBack={onBack}
        onRemove={onReset}
        onPickColor={isFont ? onPickColor : undefined}
      />
      <View style={styles.controls}>
        {isFont ? (
          <>
            <FontRow label={currentLabel} onOpen={() => setSheetOpen(true)} />
            <SegmentedRow
              label="Weight"
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
        ) : (
          <>
            {/* Character (letter spacing) + Line (line height) share one row to
                keep the bar within the shared object-menu height. */}
            <DualSliderRow
              leftLabel="Char"
              leftValue={(style.letterSpacing - LS_MIN) / (LS_MAX - LS_MIN)}
              leftApply={(t, c) => set({ letterSpacing: LS_MIN + t * (LS_MAX - LS_MIN) }, c)}
              rightLabel="Line"
              rightValue={(style.lineHeight - LH_MIN) / (LH_MAX - LH_MIN)}
              rightApply={(t, c) => set({ lineHeight: LH_MIN + t * (LH_MAX - LH_MIN) }, c)}
            />
            <SegmentedRow
              label="Align"
              options={ALIGNS}
              value={style.align}
              onChange={(align) => set({ align }, true)}
            />
            <SegmentedRow
              label="Vertical"
              options={VALIGNS}
              value={style.vAlign}
              onChange={(vAlign) => set({ vAlign }, true)}
            />
          </>
        )}
      </View>
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
  bar: {
    backgroundColor: BAR_BG,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
    paddingTop: 10,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  // 10pt header→controls gap; rows self-space (32/36pt tall) with a 2pt gap.
  controls: { marginTop: 10, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', height: 36 },
  rowLabel: { width: 50, color: LABEL, fontSize: 12 },
  pill: {
    flex: 1, height: 32, flexDirection: 'row', alignItems: 'center',
    backgroundColor: PILL_TRACK, borderRadius: 9, paddingHorizontal: 12,
  },
  pillText: { flex: 1, color: '#FFFFFF', fontSize: 13.5 },
  // Font sheet — presented over the bar (inset from its sides + bottom).
  sheet: {
    position: 'absolute', left: 16, right: 16, bottom: 14, maxHeight: 288,
    backgroundColor: SHEET_BG, borderWidth: 1, borderColor: SHEET_BORDER,
    borderRadius: 14, padding: 8,
    shadowColor: '#000', shadowOpacity: 0.65, shadowRadius: 34, shadowOffset: { width: 0, height: 12 }, elevation: 12,
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 8, paddingTop: 4, paddingBottom: 8 },
  sheetTitle: { color: SHEET_LABEL, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  sheetDone: { color: ACCENT, fontSize: 13 },
  sheetList: { flexGrow: 0 },
  sheetRow: { height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 9, paddingHorizontal: 12 },
  sheetRowActive: { backgroundColor: SHEET_ROW_ACTIVE },
  sheetRowLabel: { flex: 1, color: '#FFFFFF', fontSize: 15 },
});
