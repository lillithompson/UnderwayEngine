import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { RGBLike } from '../adapter';
import {
  BAR_BORDER, BAR_CONTROLS_TOP, BAR_HEADER, BAR_PAD_BOTTOM, BAR_PAD_HORIZONTAL, BAR_PAD_TOP,
  ROW_SEGMENTED, ROW_SLIDER, SLIDER_CONTROL, SLIDER_LABEL, SLIDER_LABEL_GAP,
} from '../logic/submenuHeight';
import { percentText, percentToValue } from '../logic/slider';
import {
  PANEL_BG,
  PANEL_CONTROL,
  PANEL_INK,
  PANEL_INK_DIM,
  PANEL_INK_HAIRLINE,
  PANEL_INK_LABEL,
  PANEL_INK_MUTED,
  PANEL_SHEET_BG,
  PANEL_SHEET_BORDER,
  PANEL_SHEET_ROW_ACTIVE,
  PANEL_SWATCH_BORDER,
  PANEL_TRACK,
  STATE_ACTIVE,
} from '../theme';
import { ColorSwatchFill } from './ColorSwatch';
import { SLIDER_TRACK, Slider } from './Slider';

// Shared chrome for the image-effect editing bars (Drop Shadow, Border): the
// full-width light bar's header (back · color swatch · trash) and the row
// grammar (a slider row is its caption over the track, with the value box
// on the right; a segmented row keeps the 50pt label column). Both bars are
// siblings of the same design, so this is their single source of truth — the
// bars themselves only supply their specific controls (the shadow XY pad, the
// border segmented control) and container padding.

type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

// ── Design tokens (shared by every effect bar) ───────────────────────
// Submenu (effect bar) surface — matches the object-properties panel's light
// grey so the two read as one continuous surface, and that surface is the
// toolbar's (see PANEL_BG in theme.ts). Every token here is the light-scheme
// value; nothing in a properties menu should reach for a raw color.
export const BAR_BG = PANEL_BG;
export const HAIRLINE = PANEL_INK_HAIRLINE;
export const LABEL_DIM = PANEL_INK_DIM;
export const LABEL = PANEL_INK_LABEL;
export const TRASH = PANEL_INK_DIM;
export const TRACK = PANEL_TRACK;
// The filled portion of any value control — every slider, and the Shadow bar's
// XY pad handle, which is the same control on two axes. Selection blue, so a
// slider carrying a value reads as "set" in the same color the toolbar lights
// an active tool in.
export const CONTROL_ACCENT = STATE_ACTIVE; // #38BDF8
// Text-weight accent: the sheets' "Done" and their checkmark glyph. Stays the
// deeper iOS blue — selection blue is a fill color, and at 13px on a near-white
// sheet it drops to roughly 2:1 against the background.
export const ACCENT = '#0A84FF';
// Popover sheets presented over a bar (the Font list, the Tint presets). Both
// bars drew these identically from their own private copies; they live here so
// the two can't drift.
export const SHEET_BG = PANEL_SHEET_BG;
export const SHEET_BORDER = PANEL_SHEET_BORDER;
export const SHEET_LABEL = PANEL_INK_DIM;
export const SHEET_ROW_ACTIVE = PANEL_SHEET_ROW_ACTIVE;
export const SHEET_TEXT = PANEL_INK;
export const PILL_TRACK = PANEL_TRACK;
export const PILL_CHEVRON = PANEL_INK_DIM;
const SWATCH_BORDER = PANEL_SWATCH_BORDER;
const SEG_TRACK = PANEL_TRACK;
const SEG_ACTIVE = PANEL_CONTROL;
const SEG_TEXT = PANEL_INK_DIM;

/** Bar header: a back-Pressable (title, with an optional chevron) on the
 *  left, and — when a color is supplied — a color swatch, then the trash, on
 *  the right. The Crop bar omits the swatch (no color); bars that pass no
 *  `onRemove` omit the trash entirely (Text / Crop). */
export function EffectBarHeader({ title, color, swatch, chevron, align = 'center', removeLabel, onBack, onRemove, onPickColor }: {
  title: string;
  /** Swatch color; omit (with onPickColor) for a bar without a color control. */
  color?: RGBLike;
  /** Custom swatch fill (e.g. the Tint bar's gradient preview), rendered inside
   *  the circular swatch instead of a flat `color`. Clipped to the circle. */
  swatch?: React.ReactNode;
  /** Show a leading down-chevron before the title (the bar dismisses downward). */
  chevron?: boolean;
  /** 'top' aligns the swatch's top with the title's top (Shadow's tweak);
   *  'center' vertically centers the cluster (Border's default). */
  align?: 'top' | 'center';
  /** Accessibility label for the trash (defaults to `Remove <title>`). */
  removeLabel?: string;
  onBack: () => void;
  /** Removes / resets the effect (renders a trash affordance). Omit to hide
   *  the trash for bars that shouldn't offer it (Text, Crop). */
  onRemove?: () => void;
  onPickColor?: () => void;
}) {
  return (
    <View style={[styles.header, { alignItems: align === 'top' ? 'flex-start' : 'center' }]}>
      <Pressable style={styles.back} onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back to edit options">
        {chevron ? <MaterialCommunityIcons name="chevron-down" size={19} color={LABEL_DIM} /> : null}
        <Text style={styles.title}>{title}</Text>
      </Pressable>
      <View style={styles.headerRight}>
        {(color || swatch) && onPickColor ? (
          <Pressable
            onPress={onPickColor}
            accessibilityRole="button"
            accessibilityLabel={`${title} color`}
            style={styles.swatch}
          >
            {/* A flat color renders as a ColorSwatchFill (not a background
                color) so a picked opacity shows as a checkerboard behind it,
                the same as the picker's own preview. The clip is its own inner
                layer because `overflow: hidden` on the outer would take the
                swatch's drop shadow with it (RN maps it to clipsToBounds). */}
            <View style={styles.swatchClip}>{swatch ?? <ColorSwatchFill color={color!} />}</View>
          </Pressable>
        ) : null}
        {onRemove ? (
          <Pressable onPress={onRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel={removeLabel ?? `Remove ${title.toLowerCase()}`}>
            <MaterialCommunityIcons name={'trash-can-outline' as MCIName} size={22} color={TRASH} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** A dim hint line under a control, indented to the control column (label
 *  column + gap = 60pt). Used by the Crop bar's Fill / Fit modes. */
export function Hint({ children }: { children: React.ReactNode }) {
  return <Text style={styles.hint}>{children}</Text>;
}

/**
 * The bar an ABSENT effect opens: the standard chrome (hairline, padding,
 * the header with its back chevron — no swatch and no trash, there being
 * nothing to recolor or remove yet) over one full-width "Add …" button.
 * Opening a menu must never edit the object, so the effect is created only
 * by this press: the host materializes it (one undo step), presence flips,
 * and the panel re-renders the bar as its normal controls in place.
 */
export function EmptyEffectBar({ title, addLabel, onBack, onAdd }: {
  title: string;
  /** The button's text (and accessibility label), e.g. "Add Drop Shadow". */
  addLabel: string;
  onBack: () => void;
  onAdd: () => void;
}) {
  return (
    <View style={styles.emptyBar}>
      <EffectBarHeader title={title} chevron onBack={onBack} />
      <View style={styles.emptyControls}>
        <Pressable
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel={addLabel}
          style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
        >
          <MaterialCommunityIcons name={'plus' as MCIName} size={16} color="#fff" />
          <Text style={styles.addLabel}>{addLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The tap-to-type value box every slider row wears on its right: a white
 *  pill-high cell (one track tall, the raised cell of the segmented rows)
 *  with the value written in full-strength ink. Tapping arms a numeric
 *  field seeded with the current text; a draft that parses commits on blur
 *  / done, and an unfinished edit is abandoned, not guessed at (the toolbar
 *  hex field's rule). */
function SliderReadout({ text, commit }: { text: string; commit: (n: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  if (!editing) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit value, currently ${text}`}
        onPress={() => { setDraft(text); setEditing(true); }}
        hitSlop={6}
        style={styles.readout}
      >
        <Text style={styles.readoutText}>{text}</Text>
      </Pressable>
    );
  }
  const finish = () => {
    setEditing(false);
    const n = parseFloat(draft.replace(',', '.'));
    if (Number.isFinite(n)) commit(n);
  };
  return (
    <View style={styles.readout}>
      <TextInput
        accessibilityLabel="Value"
        style={styles.readoutText}
        value={draft}
        onChangeText={setDraft}
        onBlur={finish}
        onSubmitEditing={finish}
        keyboardType="numeric"
        autoFocus
        selectTextOnFocus
        returnKeyType="done"
      />
    </View>
  );
}

/** One slider row, in the Opacity slider's layout: the label as a small
 *  caption OVER a full-width 0–1 slider, with the value box on the right
 *  ({@link SliderReadout}). `apply(t, committed)` fires live (false) and
 *  once on release (true). `readout` spells the value in its own unit and
 *  says what a typed number in that unit means; without one the box shows
 *  the 0–1 value as a percent and takes a percent back. */
export function SliderRow({ label, value, apply, readout, accent, checker, onDark }: {
  label: string;
  value: number;
  apply: (t: number, committed: boolean) => void;
  readout?: { text: string; commit: (n: number) => void };
  /** The slider's color (ramp + thumb). Defaults to the selection-blue
   *  CONTROL_ACCENT; a color picker's Opacity row passes the color itself. */
  accent?: string;
  /** Show the alpha checkerboard under the ramp — an opacity row. */
  checker?: boolean;
  /** The row on a dark sheet (the color pickers): the caption goes white. */
  onDark?: boolean;
}) {
  const text = readout ? readout.text : percentText(value);
  const commit = readout ? readout.commit : (n: number) => apply(percentToValue(n), true);
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, onDark ? styles.rowLabelDark : null]}>{label}</Text>
      <View style={styles.rowControl}>
        <View style={styles.rowSlider}>
          <Slider value={value} accent={accent ?? CONTROL_ACCENT} trackColor={TRACK} checker={checker} onChange={(v) => apply(v, false)} onCommit={(v) => apply(v, true)} />
        </View>
        <SliderReadout text={text} commit={commit} />
      </View>
    </View>
  );
}

/** Two sliders sharing one row, each in the SliderRow dress (caption over
 *  the track, value box beside it), split down the middle. Lets a bar pack
 *  two related controls (e.g. the Text bar's Character + Line spacing) into
 *  a single slider row instead of two, shaving a row's height off the bar.
 *  Each half's `apply(t, committed)` fires live (false) and once on release
 *  (true), same as SliderRow; both read out as a percent. */
export function DualSliderRow({ leftLabel, leftValue, leftApply, rightLabel, rightValue, rightApply }: {
  leftLabel: string;
  leftValue: number;
  leftApply: (t: number, committed: boolean) => void;
  rightLabel: string;
  rightValue: number;
  rightApply: (t: number, committed: boolean) => void;
}) {
  const half = (label: string, value: number, apply: (t: number, committed: boolean) => void) => (
    <View style={styles.dualHalf}>
      <Text style={styles.segLabel}>{label}</Text>
      <View style={styles.rowControl}>
        <View style={styles.rowSlider}>
          <Slider value={value} accent={CONTROL_ACCENT} trackColor={TRACK} onChange={(v) => apply(v, false)} onCommit={(v) => apply(v, true)} />
        </View>
        <SliderReadout text={percentText(value)} commit={(n) => apply(percentToValue(n), true)} />
      </View>
    </View>
  );
  return (
    <View style={styles.dualRow}>
      {half(leftLabel, leftValue, leftApply)}
      {half(rightLabel, rightValue, rightApply)}
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
      <Text style={styles.segLabel}>{label}</Text>
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
                <MaterialCommunityIcons name={o.icon} size={18} color={active ? PANEL_INK : SEG_TEXT} />
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

/** One row of ACTIONS: the same 50pt label column + equal-width track as
 *  {@link SegmentedRow}, but every cell is a button that fires and stays
 *  unlit — there is no selected value to show. The Layout bar's align rows
 *  are the case this exists for: "align left" is something you do, not a
 *  state an object is in, so lighting a segment would lie about it. Cells
 *  dim while held, which is the only feedback a stateless control can give. */
export function ActionRow<T extends string>({ label, options, onPress }: {
  label: string;
  options: readonly { value: T; label: string; icon?: MCIName }[];
  onPress: (v: T) => void;
}) {
  return (
    <View style={styles.segmentedRow}>
      <Text style={styles.segLabel}>{label}</Text>
      <View style={styles.segmented}>
        {options.map((o) => (
          <Pressable
            key={o.value}
            onPress={() => onPress(o.value)}
            style={({ pressed }) => [styles.segment, pressed && styles.segmentActive]}
            accessibilityRole="button"
            accessibilityLabel={o.label}
          >
            {o.icon ? (
              <MaterialCommunityIcons name={o.icon} size={18} color={SEG_TEXT} />
            ) : (
              <Text style={styles.segmentText} numberOfLines={1}>{o.label}</Text>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** One row of independent ON/OFF chips: {@link SegmentedRow}'s layout, but
 *  every cell lights on its own — the row answers several yes/no questions
 *  rather than one multiple-choice one (the pattern Tools bar's tile-set
 *  filter is the case this exists for). */
export function MultiToggleRow<T extends string>({ label, options, onToggle }: {
  label: string;
  options: readonly { value: T; label: string; active: boolean }[];
  onToggle: (v: T) => void;
}) {
  return (
    <View style={styles.segmentedRow}>
      <Text style={styles.segLabel}>{label}</Text>
      <View style={styles.segmented}>
        {options.map((o) => (
          <Pressable
            key={o.value}
            onPress={() => onToggle(o.value)}
            style={[styles.segment, o.active && styles.segmentActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: o.active }}
            accessibilityLabel={o.label}
          >
            <Text style={[styles.segmentText, o.active && styles.segmentTextActive]} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** Two segmented controls sharing one row, split down the middle — the
 *  segmented sibling of {@link DualSliderRow}, for a bar that has the same
 *  choice to offer about two related things (the Endpoints bar's per-end cap).
 *  Selection applies immediately, as in {@link SegmentedRow}. */
export function DualSegmentedRow<T extends string>({ label, options, leftLabel, leftValue, onLeftChange, rightLabel, rightValue, onRightChange }: {
  label: string;
  /** The same choices on both halves — the point of the row is that they ask
   *  one question twice. */
  options: readonly { value: T; label: string }[];
  leftLabel: string;
  leftValue: T;
  onLeftChange: (v: T) => void;
  rightLabel: string;
  rightValue: T;
  onRightChange: (v: T) => void;
}) {
  const half = (halfLabel: string, value: T, onChange: (v: T) => void) => (
    <View style={styles.dualHalf}>
      <Text style={styles.dualSegLabel}>{halfLabel}</Text>
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
              accessibilityLabel={`${halfLabel} ${o.label}`}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={1}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
  return (
    <View style={styles.dualSegmentedRow}>
      <Text style={styles.segLabel}>{label}</Text>
      {half(leftLabel, leftValue, onLeftChange)}
      {half(rightLabel, rightValue, onRightChange)}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', minHeight: BAR_HEADER },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  title: { color: LABEL_DIM, fontSize: 11, lineHeight: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  swatch: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.8, borderColor: SWATCH_BORDER,
    // Lighter than the dark scheme's drop shadow: on a light surface the same
    // 0.5 black reads as grime around the swatch rather than lift.
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
  },
  // Clips the swatch's fill — flat color or a custom one (the Tint bar's
  // gradient preview) — to the circle, inside the border.
  swatchClip: { ...StyleSheet.absoluteFillObject, borderRadius: 11, overflow: 'hidden' },
  // A slider row stacks: caption, gap, then the control line (track + value
  // box). The three metrics are submenuHeight's, so its arithmetic and this
  // layout are one number.
  row: { height: ROW_SLIDER, gap: SLIDER_LABEL_GAP },
  rowLabel: {
    color: LABEL, fontSize: 11, lineHeight: SLIDER_LABEL, fontWeight: '600',
    letterSpacing: 0.6, textTransform: 'uppercase',
  },
  rowLabelDark: { color: 'rgba(255, 255, 255, 0.75)' },
  rowControl: { flexDirection: 'row', alignItems: 'center', gap: 10, height: SLIDER_CONTROL },
  rowSlider: { flex: 1 },
  // Dual-slider row: two caption-over-track halves split evenly with a gap between.
  dualRow: { flexDirection: 'row', alignItems: 'center', height: ROW_SLIDER, gap: 16 },
  dualHalf: { flex: 1, height: ROW_SLIDER, gap: SLIDER_LABEL_GAP },
  // The 50pt label column the segmented rows keep.
  segLabel: { width: 50, color: LABEL, fontSize: 12 },
  segmentedRow: { flexDirection: 'row', alignItems: 'center', height: ROW_SEGMENTED },
  // Two segmented controls in one row: the shared label column, then two
  // equal halves each with a compact label of its own.
  dualSegmentedRow: { flexDirection: 'row', alignItems: 'center', height: ROW_SEGMENTED, gap: 10 },
  dualSegLabel: { width: 36, color: LABEL, fontSize: 12 },
  segmented: { flex: 1, flexDirection: 'row', backgroundColor: SEG_TRACK, borderRadius: 9, padding: 2, gap: 2 },
  segment: { flex: 1, paddingVertical: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },
  // The selected cell is the one thing LIGHTER than the recessed track — the
  // inverse of the dark scheme, where it was the one thing lighter than a
  // black track. A hairline lift keeps it from floating off the surface.
  segmentActive: {
    backgroundColor: SEG_ACTIVE,
    shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  segmentText: { color: SEG_TEXT, fontSize: 11.5, fontWeight: '600' },
  segmentTextActive: { color: PANEL_INK },
  // The value box: the segmented rows' raised white cell, one track tall,
  // wide enough for "100%" without reflowing as the value changes.
  readout: {
    height: SLIDER_TRACK,
    minWidth: 60,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: PANEL_CONTROL,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  readoutText: {
    color: PANEL_INK,
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    padding: 0,
  },
  // Hint line under a slider row: flush with its track, dim.
  hint: { marginTop: 2, paddingBottom: 2, color: PANEL_INK_MUTED, fontSize: 11 },
  // The absent-effect bar (EmptyEffectBar): the stacked bars' standard
  // container, one segmented-row-tall Add button as its only control.
  emptyBar: {
    backgroundColor: BAR_BG,
    borderTopWidth: BAR_BORDER,
    borderTopColor: HAIRLINE,
    paddingTop: BAR_PAD_TOP,
    paddingHorizontal: BAR_PAD_HORIZONTAL,
    paddingBottom: BAR_PAD_BOTTOM,
  },
  emptyControls: { marginTop: BAR_CONTROLS_TOP, height: ROW_SEGMENTED, flexDirection: 'row' },
  // The Add button wears the control accent (a filled pill, like a selected
  // segment lit in the value color): pressing it is what SETS a value.
  addButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderRadius: 9, backgroundColor: CONTROL_ACCENT,
  },
  addButtonPressed: { opacity: 0.7 },
  addLabel: { color: '#fff', fontSize: 12.5, fontWeight: '600' },
});
