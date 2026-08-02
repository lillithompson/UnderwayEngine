import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { RGBLike } from '../adapter';
import { rgbCss } from '../logic/hsv';
import { Slider } from './Slider';

// Shared chrome for the image-effect editing bars (Drop Shadow, Border): the
// full-width dark bar's header (back · color swatch · trash) and the row
// grammar (50pt label column + a control filling the rest). Both bars are
// siblings of the same design, so this is their single source of truth — the
// bars themselves only supply their specific controls (the shadow XY pad, the
// border segmented control) and container padding.

type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

// ── Design tokens (shared by every effect bar) ───────────────────────
export const BAR_BG = '#4B4B4D';
export const HAIRLINE = 'rgba(255,255,255,0.09)';
export const LABEL_DIM = 'rgba(255,255,255,0.55)';
export const LABEL = 'rgba(255,255,255,0.75)';
export const TRASH = 'rgba(255,255,255,0.62)';
export const TRACK = 'rgba(0,0,0,0.34)';
export const ACCENT = '#0A84FF';
const SWATCH_BORDER = 'rgba(255,255,255,0.75)';
const SEG_TRACK = 'rgba(0,0,0,0.30)';
const SEG_ACTIVE = 'rgba(255,255,255,0.22)';
const SEG_TEXT = 'rgba(255,255,255,0.6)';

/** Bar header: a back-Pressable (title, with an optional chevron) on the
 *  left, and — when a color is supplied — a color swatch, then the trash, on
 *  the right. The Crop bar omits the swatch (no color). */
export function EffectBarHeader({ title, color, chevron, align = 'center', removeLabel, onBack, onRemove, onPickColor }: {
  title: string;
  /** Swatch color; omit (with onPickColor) for a bar without a color control. */
  color?: RGBLike;
  /** Show a leading chevron before the title (Border/Crop do; Shadow doesn't). */
  chevron?: boolean;
  /** 'top' aligns the swatch's top with the title's top (Shadow's tweak);
   *  'center' vertically centers the cluster (Border's default). */
  align?: 'top' | 'center';
  /** Accessibility label for the trash (defaults to `Remove <title>`). */
  removeLabel?: string;
  onBack: () => void;
  onRemove: () => void;
  onPickColor?: () => void;
}) {
  return (
    <View style={[styles.header, { alignItems: align === 'top' ? 'flex-start' : 'center' }]}>
      <Pressable style={styles.back} onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back to edit options">
        {chevron ? <MaterialCommunityIcons name="chevron-left" size={19} color={LABEL_DIM} /> : null}
        <Text style={styles.title}>{title}</Text>
      </Pressable>
      <View style={styles.headerRight}>
        {color && onPickColor ? (
          <Pressable
            onPress={onPickColor}
            accessibilityRole="button"
            accessibilityLabel={`${title} color`}
            style={[styles.swatch, { backgroundColor: rgbCss(color) }]}
          />
        ) : null}
        <Pressable onPress={onRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel={removeLabel ?? `Remove ${title.toLowerCase()}`}>
          <MaterialCommunityIcons name={'trash-can-outline' as MCIName} size={22} color={TRASH} />
        </Pressable>
      </View>
    </View>
  );
}

/** A dim hint line under a control, indented to the control column (label
 *  column + gap = 60pt). Used by the Crop bar's Fill / Fit modes. */
export function Hint({ children }: { children: React.ReactNode }) {
  return <Text style={styles.hint}>{children}</Text>;
}

/** One slider row: a 50pt label column + a 0–1 slider filling the rest.
 *  `apply(t, committed)` fires live (false) and once on release (true). */
export function SliderRow({ label, value, apply }: {
  label: string;
  value: number;
  apply: (t: number, committed: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowSlider}>
        <Slider value={value} accent={ACCENT} trackColor={TRACK} onChange={(v) => apply(v, false)} onCommit={(v) => apply(v, true)} />
      </View>
    </View>
  );
}

/** One segmented row: a 50pt label column + an equal-width segmented control.
 *  Selection applies immediately. An option may carry an `icon` (MCI glyph)
 *  to render in place of its text label (the align row), keeping its `label`
 *  for accessibility. */
export function SegmentedRow<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: readonly { value: T; label: string; icon?: MCIName }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmentedRow}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.segmented}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              style={[styles.segment, active && styles.segmentActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={o.label}
            >
              {o.icon ? (
                <MaterialCommunityIcons name={o.icon} size={18} color={active ? '#FFFFFF' : SEG_TEXT} />
              ) : (
                <Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={1}>{o.label}</Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', minHeight: 22 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  title: { color: LABEL_DIM, fontSize: 11, lineHeight: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  swatch: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.8, borderColor: SWATCH_BORDER,
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
  },
  row: { flexDirection: 'row', alignItems: 'center', height: 32 },
  rowLabel: { width: 50, color: LABEL, fontSize: 12 },
  rowSlider: { flex: 1 },
  segmentedRow: { flexDirection: 'row', alignItems: 'center', height: 36 },
  segmented: { flex: 1, flexDirection: 'row', backgroundColor: SEG_TRACK, borderRadius: 9, padding: 2, gap: 2 },
  segment: { flex: 1, paddingVertical: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },
  segmentActive: { backgroundColor: SEG_ACTIVE },
  segmentText: { color: SEG_TEXT, fontSize: 11.5, fontWeight: '600' },
  segmentTextActive: { color: '#FFFFFF' },
  // Hint line: indented to the control column (50pt label + 10pt gap), dim.
  hint: { marginLeft: 60, marginTop: 2, paddingBottom: 2, color: 'rgba(255,255,255,0.42)', fontSize: 11 },
});
