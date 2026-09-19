import React, { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  ASIDE_GAP, GROUP_GAP, GROUP_PAD, ROW_GAP, ROW_SEGMENTED, ROW_SLIDER, ROW_SWITCH, SLIDER_CONTROL,
  SLIDER_LABEL, SLIDER_LABEL_GAP,
} from '../logic/submenuHeight';
import { percentText, percentToValue } from '../logic/slider';
import {
  PANEL_CONTROL,
  PANEL_GROUP_WELL,
  PANEL_INK,
  PANEL_INK_DIM,
  PANEL_INK_LABEL,
  PANEL_INK_MUTED,
  PANEL_SHEET_BG,
  PANEL_SHEET_BORDER,
  PANEL_SHEET_ROW_ACTIVE,
  PANEL_TRACK,
  STATE_ACTIVE,
  PANEL_SWATCH_BORDER,
} from '../theme';
import { SLIDER_TRACK, Slider } from './Slider';
import { ColorSwatchFill } from './ColorSwatch';
import { hueRampColors, hueSliderSV, rgbCss, rgbToHsv, withHue } from '../logic/hsv';
import type { RGBLike } from '../adapter';

// Shared grammar for the property pages (Drop Shadow, Border, Crop, …) that
// the Edit sheet shows in its content area: the row grammar (a slider row is
// its caption over the track, with the value box on the right; a segmented
// row keeps the 50pt label column) and the page body that lays a page's rows
// beside its aside column (the Shadow page's offset pad). The pages are
// siblings of the same design, so this is their single source of truth —
// each page supplies only its specific controls. The sheet around them
// (tabs, the content area's well, the Remove line) is
// components/EditSheet.tsx. A colour is a row of the page that owns the thing
// it colours — the Stroke page's, the Fill page's, the Shadow page's — on the
// slider's own proportions with the hue wheel as its track (ColorSliderRow).

type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

// ── Design tokens (shared by every page) ─────────────────────────────
// Every token here is the light-scheme value; nothing in a properties menu
// should reach for a raw color.
export const LABEL = PANEL_INK_LABEL;
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
const SEG_TRACK = PANEL_TRACK;
const SEG_ACTIVE = PANEL_CONTROL;
const SEG_TEXT = PANEL_INK_DIM;

/** A page's body: its rows stacked (ROW_GAP apart) and, when the page has
 *  one, its `aside` column to their left — the Shadow page's offset pad.
 *  `spread` spaces the rows out to the aside's full height instead of
 *  stacking them at the top (the Shadow page, whose three sliders sit
 *  beside a taller column). submenuHeight counts the same metrics: the
 *  taller of the aside and the row stack. (Colours are not asides any
 *  more: each is a row of the page that owns what it colours —
 *  ColorSliderRow.) */
export function BarBody({ aside, spread, children }: {
  aside?: React.ReactNode;
  spread?: boolean;
  children: React.ReactNode;
}) {
  if (!aside) return <View style={styles.rows}>{children}</View>;
  return (
    <View style={styles.body}>
      <View style={styles.aside}>{aside}</View>
      <View style={[styles.rows, styles.rowsBeside, spread ? styles.rowsSpread : null]}>{children}</View>
    </View>
  );
}

/** A GROUP of rows: a rounded box, a shade darker than the well it sits in,
 *  around rows that are one setting in several parts — the Copies page's
 *  two offsets, its two scales, its count beside its turn. Each row keeps
 *  its own full width inside the box, so the halves read as a pair without
 *  the squeeze of sharing one line (which halved every track and set two
 *  readouts fighting for the width — the dual slider row this replaced).
 *  submenuHeight's rowGroupHeight counts the same padding. */
export function RowGroup({ children }: { children: React.ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

/** A page whose rows are GROUPS: the same stack, spaced by GROUP_GAP so the
 *  boxes read as separate rather than as one long field. */
export function GroupedBody({ children }: { children: React.ReactNode }) {
  return <View style={styles.groupedRows}>{children}</View>;
}

/** A dim hint line under a control, indented to the control column (label
 *  column + gap = 60pt). Used by the Crop page's Fill / Fit modes. */
export function Hint({ children }: { children: React.ReactNode }) {
  return <Text style={styles.hint}>{children}</Text>;
}

/**
 * The page an ABSENT effect opens: one full-width "Add …" button and nothing
 * else (there being nothing to recolor or remove yet). Opening a menu must
 * never edit the object, so the effect is created only by this press: the
 * host materializes it (one undo step), presence flips, and the panel
 * re-renders the page as its normal controls in place.
 */
export function EmptyEffectBar({ addLabel, onAdd }: {
  /** The button's text (and accessibility label), e.g. "Add Drop Shadow". */
  addLabel: string;
  onAdd: () => void;
}) {
  return <EffectButton label={addLabel} onPress={onAdd} />;
}

/**
 * The full-width filled button an effect page uses for the one thing it
 * DOES rather than adjusts — "Add Drop Shadow" on an absent effect, and
 * "Replace" on the Image page, which swaps the pixels behind the node.
 *
 * One button for both because they are one kind of thing: a page of
 * sliders with a single act on it, and that act should look the same
 * wherever it appears. Replace wore a segmented ActionRow — the shape the
 * pages use for CHOOSING between states — which read as a setting with
 * one option.
 *
 * It fires straight out of the press, with nothing deferred: the Image
 * page's host opens a file picker, and WebKit only shows the dialog while
 * the gesture's activation is live.
 */
export function EffectButton({ label, icon = 'plus', inline = false, onPress }: {
  label: string;
  /** The glyph before the word. Defaults to the plus an "Add …" wears. */
  icon?: string;
  /** Stand BESIDE something rather than filling the page's width: the
   *  button hugs its own word and takes a row's height, for a page that
   *  puts its one act at the end of a row it shares with a setting (the
   *  pattern Tile page's Edit, right of the Repeat switch). Same ink, same
   *  height, same press — only the width is given up, so the two read as
   *  one button in two places rather than as two buttons. */
  inline?: boolean;
  onPress: () => void;
}) {
  const button = (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.addButton,
        inline && styles.addButtonInline,
        pressed && styles.addButtonPressed,
      ]}
    >
      <MaterialCommunityIcons name={icon as MCIName} size={16} color={PANEL_INK} />
      <Text style={styles.addLabel}>{label}</Text>
    </Pressable>
  );
  // Full width: its own one-row-tall line. Inline: the row it joins owns
  // the height, so the wrapper would only add a second one.
  return inline ? button : <View style={styles.emptyControls}>{button}</View>;
}

/** The tap-to-type value box every slider row wears on its right: a white
 *  pill-high cell (one track tall, the raised cell of the segmented rows)
 *  with the value written in full-strength ink. Tapping arms a numeric
 *  field seeded with the current text; a draft that parses commits on blur
 *  / done, and an unfinished edit is abandoned, not guessed at (the toolbar
 *  hex field's rule).
 *
 *  The pad is the DECIMAL one. Every value behind this box is a real
 *  number — a width in points, a scale factor, an offset in cells — and the
 *  plain number pad has no decimal separator on it, so a field that parses
 *  9.5 perfectly well could not be told 9.5: the only way to a fraction was
 *  the slider, at whatever step it happened to land on. Nothing is lost by
 *  asking for the decimal pad, which is the number pad with the separator
 *  on it (neither carries a minus sign, so a negative offset is typed the
 *  way it always was, on a hardware keyboard).
 *
 *  While the field is armed a DONE chip stands beside it. The field wants
 *  the number pad — typing a count on a QWERTY keyboard is the wrong
 *  trade — and iOS's number pad carries no return key, while the WebView
 *  suppresses the system accessory bar that would otherwise hold a Done
 *  (shell WebViewShell's hideKeyboardAccessoryView, for the text-edit bar's
 *  sake). So the page supplies its own, the way the text bar does: one tap
 *  takes the keyboard down and commits. Enter does the same wherever a
 *  keyboard has one (desktop web, a hardware keyboard on iPad). */
function SliderReadout({ text, commit }: { text: string; commit: (n: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  // What the field was armed WITH. iOS keeps a focused field focused while
  // the finger is on a non-focusable control, so a tap on the number
  // followed by a slider drag leaves the field armed through the drag and
  // blurs it later — committing the number it opened on, over the value
  // the slider had just set. A draft the user never changed is not an edit.
  const [seeded, setSeeded] = useState(text);
  const inputRef = useRef<TextInput>(null);
  // ONE finish per armed field. Done and Enter both blur the field
  // themselves, and that blur runs `finish` in its own right — without this
  // the number would commit twice, which is two undo steps for one edit.
  const finished = useRef(false);
  if (!editing) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Edit value, currently ${text}`}
        onPress={() => { setDraft(text); setSeeded(text); finished.current = false; setEditing(true); }}
        hitSlop={6}
        style={styles.readout}
      >
        <Text style={styles.readoutText}>{text}</Text>
      </Pressable>
    );
  }
  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    setEditing(false);
    if (draft === seeded) return;
    const n = parseFloat(draft.replace(',', '.'));
    if (Number.isFinite(n)) commit(n);
  };
  // Blur FIRST, then commit: unmounting a focused field is not reliably
  // enough to take the iOS keyboard down, and the field must be gone from
  // the screen before the row re-renders with the new number.
  const submit = () => { inputRef.current?.blur(); finish(); };
  return (
    <>
      <View style={styles.readout}>
        <TextInput
          ref={inputRef}
          accessibilityLabel="Value"
          style={styles.readoutText}
          value={draft}
          onChangeText={setDraft}
          onBlur={finish}
          onSubmitEditing={submit}
          keyboardType="decimal-pad"
          autoFocus
          selectTextOnFocus
          returnKeyType="done"
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Done"
        onPress={submit}
        hitSlop={6}
        style={({ pressed }) => [styles.readoutDone, pressed && styles.readoutDonePressed]}
      >
        <Text style={styles.readoutDoneText}>Done</Text>
      </Pressable>
    </>
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

/** The circle a colour-bearing row wears where a slider row reads its
 *  number: the colour itself, at the thumb's own size so the row's line is
 *  unbroken, and a press on it opens the host's full picker. Shared by the
 *  hue row below and by the Fade row, which are the two rows that end in a
 *  colour rather than a value. */
function ColorEndButton({ label, color, onPress }: {
  /** The row's own label, for the spoken name of the button. */
  label: string;
  color: RGBLike;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} color, open picker`}
      onPress={onPress}
      hitSlop={6}
      style={styles.colorEnd}
    >
      <View style={styles.colorEndClip}><ColorSwatchFill color={color} /></View>
    </Pressable>
  );
}

/**
 * A COLOUR row built on the slider's own proportions: the same label
 * column, the same track and thumb, with the hue wheel as its ramp — so
 * left-to-right walks the hues — and, where a number would read, a circle
 * of the colour itself that opens the full picker.
 *
 * The thumb wears the colour, not the accent blue: the handle is the thing
 * being chosen. Saturation and brightness are the picker's; this row moves
 * the hue and leaves them as they are (logic/hsv withHue), which is what
 * makes it a quick reach rather than a second picker.
 */
export function ColorSliderRow({ label, color, onColor, onOpenPicker }: {
  label: string;
  color: RGBLike;
  /** The colour the hue landed on — live while dragging, once on release. */
  onColor: (color: RGBLike, committed: boolean) => void;
  /** The trailing circle's press: the host's full colour picker. */
  onOpenPicker: () => void;
}) {
  // The track is drawn at the colour's own saturation and value, so the
  // stop under the thumb is the colour the thumb writes (hueSliderSV —
  // the same rule withHue keeps below). Memoized on those two numbers
  // rather than on `color`, which is a fresh object every render.
  const { s: rampS, v: rampV } = hueSliderSV(color);
  const ramp = useMemo(() => hueRampColors(rampS, rampV), [rampS, rampV]);
  const hue = rgbToHsv(color).h;
  const apply = (t: number, committed: boolean) =>
    onColor(withHue(color, Math.max(0, Math.min(360, t * 360))), committed);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowControl}>
        <View style={styles.rowSlider}>
          <Slider
            value={hue / 360}
            accent={rgbCss(color)}
            trackColor={TRACK}
            ramp={ramp}
            onChange={(v) => apply(v, false)}
            onCommit={(v) => apply(v, true)}
          />
        </View>
        <ColorEndButton label={label} color={color} onPress={onOpenPicker} />
      </View>
    </View>
  );
}

/**
 * The FADE row: a plain 0–1 amount on the slider's own proportions, ending
 * in the colour circle the hue row ends in rather than in a number —
 * because what the far end of this slider MEANS is that colour, and the row
 * would otherwise say "100%" without ever saying 100% of what.
 *
 * One number and one target, and every colour the object draws with is
 * mixed that far toward the target from its own value (engine/fade.ts): at
 * 0 nothing moves, at 1 the object is a flat silhouette of the circle. So
 * the row reads left to right as the thing it does — push this object that
 * far toward THAT.
 *
 * The TRACK is that walk, drawn: a ramp from the colour the object draws in
 * right now to the target the circle shows. The value is a POSITION on it,
 * which is what the slider's `ramp` is for — the same reading a hue
 * slider's rainbow gets — so the row can be read without being dragged.
 *
 * It wore the pages' selection blue before, which named neither end: a bar
 * of blue under a row about walking from one colour to another. The worry
 * that kept it there was the default target, white, vanishing on a
 * near-white sheet — but the ramp runs from the object's OWN ink, so the
 * left end is the object and only the far end goes pale, which is exactly
 * what fading to white does and is the thing worth seeing.
 *
 * `from` is the object as it draws NOW, its standing fade included, so the
 * left end is always where the object actually is (see the panel, which
 * opens the slider there). A kind with no ink of its own passes none and
 * the ramp starts from the panel's track.
 */
export function FadeSliderRow({ label, value, color, from, apply, onOpenPicker }: {
  label: string;
  /** How far toward the target, 0…1. */
  value: number;
  /** The target itself — what the trailing circle shows and the picker edits. */
  color: RGBLike;
  /** What the object draws in now — the ramp's near end. */
  from?: RGBLike;
  apply: (t: number, committed: boolean) => void;
  onOpenPicker: () => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowControl}>
        <View style={styles.rowSlider}>
          <Slider
            value={value}
            trackColor={TRACK}
            ramp={[from ? rgbCss(from) : TRACK, rgbCss(color)]}
            onChange={(v) => apply(v, false)}
            onCommit={(v) => apply(v, true)}
          />
        </View>
        <ColorEndButton label={label} color={color} onPress={onOpenPicker} />
      </View>
    </View>
  );
}

/**
 * A label, a switch, and the state in a word — "Repeat [switch] ON".
 *
 * For a setting that is simply ON or OFF, where a two-cell segmented
 * control had to invent a word for each half and then say which half was
 * lit. The word after the switch is INFO, not a control: it says what the
 * switch is set to, so the row can be read without reading the switch as a
 * picture.
 */
export function SwitchRow({ label, value, mixed, onValueChange, trailing }: {
  label: string;
  value: boolean;
  /** The selection does not AGREE — several objects, set differently. The
   *  switch rests off and the word says Multiple rather than showing one
   *  side's value as if it were everyone's; flipping it forces ON, the
   *  value every member then shares. */
  mixed?: boolean;
  onValueChange: (next: boolean) => void;
  /** Something to hang at the FAR END of the row — pushed hard right, clear
   *  of the state word. For a page whose whole content is one switch, and
   *  which would otherwise spend a second line on a single button. */
  trailing?: React.ReactNode;
}) {
  const on = !mixed && value;
  return (
    <View style={styles.switchRow}>
      <Text style={styles.segLabel}>{label}</Text>
      <Switch
        value={on}
        onValueChange={onValueChange}
        trackColor={{ false: TRACK, true: CONTROL_ACCENT }}
        accessibilityLabel={label}
        accessibilityState={mixed ? { checked: 'mixed' } : undefined}
      />
      <Text style={styles.switchState}>{mixed ? 'MULTIPLE' : on ? 'ON' : 'OFF'}</Text>
      {trailing ? <View style={styles.switchTrailing}>{trailing}</View> : null}
    </View>
  );
}

/** One segmented row: a 50pt label column + an equal-width segmented control.
 *  Selection applies immediately. An option may carry an `icon` (MCI glyph)
 *  to render in place of its text label (the align row), keeping its `label`
 *  for accessibility. Without a `label` the control spans the whole row
 *  (the Crop page's Fill / Fit / Crop / Tile, which names itself). */
export function SegmentedRow<T extends string>({ label, options, value, onChange }: {
  label?: string;
  options: readonly { value: T; label: string; icon?: MCIName }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmentedRow}>
      {label ? <Text style={styles.segLabel}>{label}</Text> : null}
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
  /** The 50pt label column; without one the cells span the whole row (the
   *  rig's Reset, which names itself). */
  label?: string;
  options: readonly { value: T; label: string; icon?: MCIName }[];
  onPress: (v: T) => void;
}) {
  return (
    <View style={styles.segmentedRow}>
      {label ? <Text style={styles.segLabel}>{label}</Text> : null}
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
  /** The 50pt label column; without one the chips span the whole row. */
  label?: string;
  options: readonly { value: T; label: string; active: boolean }[];
  onToggle: (v: T) => void;
}) {
  return (
    <View style={styles.segmentedRow}>
      {label ? <Text style={styles.segLabel}>{label}</Text> : null}
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

/** Two segmented controls sharing one row, split down the middle, for a page
 *  that has the same choice to offer about two related things (the Endpoints
 *  page's per-end cap). Selection applies immediately, as in
 *  {@link SegmentedRow}. Two SLIDERS no longer share a row anywhere — a pair
 *  of those is a {@link RowGroup} now, each on its own full-width line. */
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
  // A page's rows, stacked — the metrics submenuHeight's `stack` counts.
  rows: { gap: ROW_GAP },
  // …and a page of GROUPS, spaced wider (submenuHeight's GROUP_GAP).
  groupedRows: { gap: GROUP_GAP },
  group: {
    padding: GROUP_PAD,
    borderRadius: 12,
    backgroundColor: PANEL_GROUP_WELL,
    gap: ROW_GAP,
  },

  // …and beside an aside column: the column hugs its content, the rows take
  // the rest.
  body: { flexDirection: 'row', alignItems: 'flex-start', gap: ASIDE_GAP },
  aside: { alignItems: 'center', gap: ASIDE_GAP },
  rowsBeside: { flex: 1, alignSelf: 'stretch' },
  rowsSpread: { justifyContent: 'space-between' },
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
  // The colour row's trailing circle, where a slider row reads its number:
  // the same height as the thumb, so the row's line is unbroken.
  colorEnd: {
    width: SLIDER_TRACK,
    height: SLIDER_TRACK,
    borderRadius: SLIDER_TRACK / 2,
    borderWidth: 1.5,
    borderColor: PANEL_SWATCH_BORDER,
  },
  colorEndClip: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: SLIDER_TRACK / 2,
    overflow: 'hidden',
  },
  // The 50pt label column the segmented rows keep.
  segLabel: { width: 50, color: LABEL, fontSize: 12 },
  // The switch row: the same label column the segmented rows keep, the
  // control, then the state word — dim and spaced like the pages' captions,
  // so it reads as a readout rather than as a second thing to press.
  switchRow: { flexDirection: 'row', alignItems: 'center', height: ROW_SWITCH, gap: 12 },
  switchState: {
    color: LABEL, fontSize: 11, fontWeight: '600', letterSpacing: 0.6,
  },
  // The row's far end: an auto margin, so whatever hangs here is flush with
  // the page's right edge however wide the state word runs.
  switchTrailing: { marginLeft: 'auto' },
  segmentedRow: { flexDirection: 'row', alignItems: 'center', height: ROW_SEGMENTED },
  // Two segmented controls in one row: the shared label column, then two
  // equal halves each with a compact label of its own.
  dualSegmentedRow: { flexDirection: 'row', alignItems: 'center', height: ROW_SEGMENTED, gap: 10 },
  dualSegLabel: { width: 36, color: LABEL, fontSize: 12 },
  // One half of a dual row: its own compact label over its control.
  dualHalf: { flex: 1, height: ROW_SLIDER, gap: SLIDER_LABEL_GAP },
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
  // The Done chip beside an armed value box: the accent as a fill, since it
  // is the one thing on the row that ENDS the edit rather than adjusting a
  // value. It stands only while the field is armed, so the track it shortens
  // is only ever shortened mid-edit.
  readoutDone: {
    height: SLIDER_TRACK,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readoutDonePressed: { opacity: 0.7 },
  readoutDoneText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  // Hint line under a slider row: flush with its track, dim.
  hint: { marginTop: 2, paddingBottom: 2, color: PANEL_INK_MUTED, fontSize: 11 },
  // The absent-effect page (EmptyEffectBar): one segmented-row-tall Add
  // button as its only control.
  emptyControls: { height: ROW_SEGMENTED, flexDirection: 'row' },
  // The Add button is bare ink on the well — no fill: a filled pill read as
  // a control already set, when the page's whole point is that nothing is.
  // The word is full-strength ink, not the white it wore while the pill was
  // filled: white on a light sheet is a button you have to hunt for.
  addButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderRadius: 9,
  },
  // Beside a setting instead of under one: it gives up the flex that makes
  // it span the page and hugs its word, keeping a row's own height so it
  // lines up with whatever it stands next to.
  addButtonInline: { flex: 0, height: ROW_SEGMENTED, paddingHorizontal: 12 },
  addButtonPressed: { opacity: 0.7 },
  addLabel: { color: PANEL_INK, fontSize: 14, fontWeight: '600' },
});
