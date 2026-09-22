import React, { useRef } from 'react';
import { GestureResponderEvent, PanResponder, StyleSheet, View } from 'react-native';
import type { EffectKind, RGBLike, ShadowModel } from '../adapter';
import { ROW_GAP, SHADOW_PAD_SIZE } from '../logic/submenuHeight';
import {
  BarBody, ColorSliderRow, CONTROL_ACCENT, EffectButton, EffectButtonRow, SliderRow,
} from './effectBar';
import { beginValueDrag, endValueDrag, padOffsetFromTouch, VALUE_DRAG_SURFACE } from '../logic/slider';
import { rgbCss, withAlpha } from '../logic/hsv';

// The three effects an object can cast over its own paint — a drop shadow,
// and a glow each way — and the two pages they take.
//
// THE EFFECTS PAGE ({@link EffectsBar}) is three buttons side by side, one
// per effect, in the shape every page's one act wears ("Add Fill"). Off,
// a button is bare ink and its press ADDS that effect; on, it is filled in
// selection blue and its press takes it away again. It is the only page in
// the sheet that changes how many tabs there are: adding an effect puts a
// tab of its own on the row (and the panel opens it at once), removing it
// takes that tab away.
//
// AN EFFECT'S OWN PAGE ({@link EffectBar}) is the controls — design "2a":
// the XY offset pad on the left and Blur / Spread / Opacity beside it, the
// sliders spread to the pad's height so the two columns square off against
// each other. The pad is exactly as tall as those three rows
// (SHADOW_PAD_SIZE) and exactly as wide — a direction chooser has to read
// the same distance on both axes, and a smaller square parked in a taller
// column read as squat.
//
// A GLOW is that same page with the pad taken away, and that is the only
// difference between the three: a glow is a shadow cast in every direction
// at once, so it has blur, dilation, opacity and ink and nothing to point
// them at. Which way the light goes — out from the edge or in from it — is
// which tab you are on, not a control.
//
// Values are the app's world-cell units (see the ranges below, mapped from
// the design's iOS-point ranges at 16px/cell). The slider rows and the body
// layout come from the shared page grammar (see effectBar.tsx); the sheet
// around them — the tabs and the Remove line — is the Edit sheet's.
//
// The effect's own colour reads UNDER both columns, full width. It is the
// one setting on the page that belongs to neither the direction nor the
// amount, and standing it between Spread and Opacity broke the run of
// "how much" sliders in half and squeezed the column it sat in against
// the pad.
//
// ONE set of pages, shared: an image, a frame and a TEXT all open these, so
// the layout is the same wherever an effect is cast.

// ── Ranges (world cells; design pt ÷ 16) ─────────────────────────────
const MAX_OFFSET = 1.5; // ±  (≈ ±24pt)
const MAX_BLUR = 3.75; // 0…60pt
const MIN_SPREAD = -0.75; // −12pt
const MAX_SPREAD = 1.5; // 24pt

// The pad is a recessed well on the light page: a faint dark wash with a
// slightly stronger edge, its guides darker still so they stay readable.
const PAD_FILL = 'rgba(42,42,42,0.08)';
const PAD_BORDER = 'rgba(42,42,42,0.16)';
const CROSSHAIR = 'rgba(42,42,42,0.16)';
const CENTER_DOT = 'rgba(42,42,42,0.34)';

const PAD_SIZE = SHADOW_PAD_SIZE;
const PAD_HANDLE = 26;

/** The three effects, in the order the buttons stand and the tabs follow:
 *  the shadow first — the effect this page has always held, and the one
 *  with somewhere to fall — then the glow that leaves the object and the
 *  glow that stays inside it. */
export const EFFECT_KINDS: readonly EffectKind[] = ['shadow', 'outer', 'inner'];

/** What one effect is called — on its button, on the tab it creates, and in
 *  the Remove line at the foot of that tab's page. ONE name for all three
 *  places, so the button you press and the tab you land on say the same
 *  word. */
/** …and what the image TINT's button is called. Not an EffectKind: the
 *  three above each open a page of controls, and a tint has none of its
 *  own — the colour brush is what lays it on. One name here for the
 *  button and for anything that speaks it. */
export const TINT_EFFECT_LABEL = 'Tint';

export function effectLabel(kind: EffectKind): string {
  return kind === 'shadow' ? 'Shadow' : kind === 'outer' ? 'Outer Glow' : 'Inner Glow';
}

/**
 * The Effects page: one button per effect, side by side.
 *
 * `present` says which the selection already wears — those read as toggled
 * ON — and a press hands the kind back either way: the host adds what is
 * absent and removes what is there. Both are one undo step, and both change
 * the tab row, which is what makes this page unlike every other one in the
 * sheet.
 */
export function EffectsBar({ present, onToggle, tint }: {
  present: (kind: EffectKind) => boolean;
  onToggle: (kind: EffectKind, add: boolean) => void;
  /** An image's TINT, where the host has one to offer: the wash of colour
   *  the colour brush lays over a photo (there being no smaller part of a
   *  photo that owns a colour). It stands on this page as a fourth
   *  button, because that is what it IS — something cast over the object's
   *  own paint that can be taken off again, which is the whole of what
   *  this page is for. A tint used to be visible only as a change to the
   *  picture: nothing said it was there, and nothing took it away.
   *
   *  Unlike the three, it carries no page: the brush is what colours it,
   *  and the button adds one in the colour in hand. */
  tint?: { present: boolean; onToggle: (add: boolean) => void };
}) {
  const button = (key: string, label: string, on: boolean, press: () => void) => (
    <EffectButton
      key={key}
      layout="column"
      label={label}
      // A plus to add; a check to say it is already there — the same
      // glyph pair the pattern page's Edit / Editing button uses.
      icon={on ? 'check' : 'plus'}
      active={on}
      accessibilityLabel={`${on ? 'Remove' : 'Add'} ${label}`}
      onPress={press}
    />
  );
  return (
    <EffectButtonRow>
      {EFFECT_KINDS.map((kind) => button(
        kind, effectLabel(kind), present(kind), () => onToggle(kind, !present(kind)),
      ))}
      {tint ? button(
        'tint', TINT_EFFECT_LABEL, tint.present, () => tint.onToggle(!tint.present),
      ) : null}
    </EffectButtonRow>
  );
}

/** The XY offset pad: drag (or tap) anywhere to set the shadow offset; the
 *  handle jumps to the touch and tracks. X→dx (right positive), Y→dy (down
 *  positive), each mapped linearly to ±MAX_OFFSET. */
function XYPad({ dx, dy, onChange, onCommit }: {
  dx: number;
  dy: number;
  onChange: (dx: number, dy: number) => void;
  onCommit: (dx: number, dy: number) => void;
}) {
  const cbRef = useRef({ onChange, onCommit });
  cbRef.current = { onChange, onCommit };
  // Where this gesture has dragged the offset to, and what the release
  // commits — see the Slider's dragRef for the whole story: an un-locatable
  // release event plus a props value that is one React batch behind is what
  // made a released handle spring back to the angle it started at.
  const dragRef = useRef<[number, number]>([dx, dy]);
  const draggingRef = useRef(false);
  if (!draggingRef.current) dragRef.current = [dx, dy];
  const track = (e: GestureResponderEvent): [number, number] => {
    dragRef.current = padOffsetFromTouch(
      e.nativeEvent.locationX, e.nativeEvent.locationY, PAD_SIZE, MAX_OFFSET, dragRef.current,
    );
    return dragRef.current;
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Keep the touch once the pad is grabbed so the sheet's swipe-to-dismiss
      // can't steal it mid-drag (see Slider for the same guard).
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => { draggingRef.current = true; beginValueDrag(); const [x, y] = track(e); cbRef.current.onChange(x, y); },
      onPanResponderMove: (e) => { const [x, y] = track(e); cbRef.current.onChange(x, y); },
      // The release reads its own position (the lift point), the terminate
      // keeps the gesture's — see the Slider's release handler for why the
      // last processed move is not where the finger let go.
      onPanResponderRelease: (e) => { draggingRef.current = false; endValueDrag(); const [x, y] = track(e); cbRef.current.onCommit(x, y); },
      onPanResponderTerminate: () => { draggingRef.current = false; endValueDrag(); cbRef.current.onCommit(...dragRef.current); },
    }),
  ).current;
  const clampN = (v: number) => Math.max(-1, Math.min(1, v / MAX_OFFSET));
  const hx = (clampN(dx) + 1) / 2 * PAD_SIZE;
  const hy = (clampN(dy) + 1) / 2 * PAD_SIZE;
  return (
    <View style={styles.pad} {...pan.panHandlers}>
      <View style={styles.padCrossV} />
      <View style={styles.padCrossH} />
      <View style={styles.padCenter} />
      <View style={[styles.padHandle, { left: hx - PAD_HANDLE / 2, top: hy - PAD_HANDLE / 2 }]} />
    </View>
  );
}

/**
 * One effect's controls — the page its own tab opens.
 *
 * `directional` brings the XY offset pad, which only the drop shadow has a
 * use for; the rows beside it are the same rows either way, which is why
 * the two faces stand at exactly the same height and the sheet never moves
 * between them.
 */
export function EffectBar({
  effect, directional, color, onColor, onOpenColorPicker, onChange, onCommit,
}: {
  /** The effect's values. `dx`/`dy` are read only when `directional`. */
  effect: ShadowModel;
  directional: boolean;
  /** The effect's own ink, shown as a hue row under both columns. Given
   *  with `onColor` and `onOpenColorPicker` — omit all three and the row is
   *  absent (a page whose host has no colour to write).
   *
   *  Read off the MODEL, not the panel's draft: the full picker changes it
   *  externally, and a row fed by its own writes would stand still while
   *  the effect recoloured. */
  color?: RGBLike;
  onColor?: (color: RGBLike, committed: boolean) => void;
  onOpenColorPicker?: () => void;
  onChange: (s: ShadowModel) => void;
  onCommit: (s: ShadowModel) => void;
}) {
  const set = (patch: Partial<ShadowModel>, committed: boolean) =>
    (committed ? onCommit : onChange)({ ...effect, ...patch });
  return (
    <View style={styles.page}>
      <BarBody
        spread={directional}
        aside={directional ? (
          <XYPad
            dx={effect.dx}
            dy={effect.dy}
            onChange={(dx, dy) => set({ dx, dy }, false)}
            onCommit={(dx, dy) => set({ dx, dy }, true)}
          />
        ) : undefined}
      >
        {/* How much of an effect there is, in one run: how far it softens,
            how far it is dilated, and how much of it shows. */}
        <SliderRow label="Blur" value={effect.blur / MAX_BLUR} apply={(t, c) => set({ blur: t * MAX_BLUR }, c)} />
        <SliderRow
          label="Spread"
          value={(effect.spread - MIN_SPREAD) / (MAX_SPREAD - MIN_SPREAD)}
          apply={(t, c) => set({ spread: MIN_SPREAD + t * (MAX_SPREAD - MIN_SPREAD) }, c)}
        />
        {/* The effect's own color ramping up over the alpha checker — "how
            much of THIS effect", as the color picker's Opacity reads. */}
        <SliderRow
          label="Opacity"
          value={effect.opacity}
          accent={rgbCss(withAlpha(effect.color, 1))}
          checker
          apply={(t, c) => set({ opacity: t }, c)}
        />
      </BarBody>
      {/* …and what colour it is, across the foot of the page — under the
          pad and the sliders alike: the hue wheel along the track, the
          colour under the thumb, and the circle at the end opening the
          full picker for saturation and brightness. */}
      {color && onColor && onOpenColorPicker ? (
        <ColorSliderRow
          label="Color"
          color={color}
          onColor={onColor}
          onOpenPicker={onOpenColorPicker}
        />
      ) : null}
    </View>
  );
}


const styles = StyleSheet.create({
  // The two-column block, then the colour row beneath it — the same gap the
  // rows inside the block keep, so the page reads as one stack.
  page: { gap: ROW_GAP },
  pad: {
    width: PAD_SIZE, height: PAD_SIZE, borderRadius: 12, backgroundColor: PAD_FILL,
    borderWidth: 1, borderColor: PAD_BORDER,
    ...VALUE_DRAG_SURFACE,
  },
  padCrossV: { position: 'absolute', left: PAD_SIZE / 2, top: 0, bottom: 0, width: 1, backgroundColor: CROSSHAIR },
  padCrossH: { position: 'absolute', top: PAD_SIZE / 2, left: 0, right: 0, height: 1, backgroundColor: CROSSHAIR },
  padCenter: {
    position: 'absolute', left: PAD_SIZE / 2 - 2.5, top: PAD_SIZE / 2 - 2.5,
    width: 5, height: 5, borderRadius: 2.5, backgroundColor: CENTER_DOT,
  },
  padHandle: {
    position: 'absolute', width: PAD_HANDLE, height: PAD_HANDLE, borderRadius: PAD_HANDLE / 2,
    // Selection blue, same as the Blur / Spread / Opacity sliders beside it —
    // the pad is those sliders on two axes.
    backgroundColor: CONTROL_ACCENT, borderWidth: 2, borderColor: '#ffffff',
    // Softer than the dark scheme's: the handle only needs enough lift to
    // separate from the pale well behind it.
    shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
});
