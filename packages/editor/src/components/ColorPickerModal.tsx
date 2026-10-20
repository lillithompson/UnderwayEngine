import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GestureResponderEvent,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { GLView } from 'expo-gl';
import type { ExpoWebGLRenderingContext } from 'expo-gl';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { HsvPickerRenderer } from '@/engine/gl/hsvPickerRenderer';
import { hsvToRgb, rgbToHex, rgbToHsv } from '@/engine/colorConvert';
import { RGBColor } from '@/engine/types';
import { DragZone, hitTest, svToUV, touchToUV, uvToHue, uvToSV } from '@/engine/hsvPickerMath';
import { MODAL_BG, MODAL_RAISED, STATE_ACTIVE } from '@/editor-ui/theme';
import { CheckerboardFill } from '@/editor-ui/components/ColorSwatch';
import { swatchInk } from '@/editor-ui/logic/hsv';
import { SliderRow } from '@/editor-ui/components/effectBar';
import { ROW_SLIDER } from '@/editor-ui/logic/submenuHeight';
import { ToolPopover } from '@/editor/components/ToolPopover';
import { RECENT_COLORS_MAX } from '../activeColor';

// UnderwayEngine's WebGL HSV color picker (the engine ships the renderer,
// shaders, and picker math in packages/engine/src/gl + hsvPickerMath.ts).
// This is CozyJournal's focused port of Facet's ColorPickerModal — the HSV
// wheel + SV square driven by HsvPickerRenderer, plus the default palette
// swatches and Facet's two color-picking extras: the eyedropper (lift a color
// off the canvas) and an opacity slider. Facet-only leftovers (file colors,
// settings) stay out. Color AND opacity commit together, once, on close via
// onConfirm.
//
// It picks a COLOUR and nothing else. Facet's blend-mode grid used to ride
// along for the colour tool's own picker, and the brush strength with it —
// but both are brush settings rather than parts of a colour, and both now
// live where the brush itself is held: the colour tool's radial menu (its
// Blend fan, whose More opens the same grid as BlendPickerModal, and its
// Opacity mode on the bottom slider). A full-screen takeover is a long way
// to go for a setting you change mid-stroke.
//
// A SHEET rising from the bottom (ToolPopover), not a takeover — the same
// shape Shapes, Symmetry and Blend take. A colour is chosen BECAUSE of
// what is on the page: you pick the red that sits next to the blue already
// there, and a full-screen picker answered that by hiding the page it was
// being picked for. The sheet leaves the drawing in view above it and puts
// the wheel on the hand's own side of the screen.
//
// The sheet's header IS the swatch (ToolPopover's headerBackground /
// headerForeground hooks): checkerboard under the colour at its own alpha,
// the hex as the title, its ink flipped black/white by luma. There is no
// close X — the backdrop is the way out, as in every other tool sheet, and
// dismissing COMMITS the colour (see `settle`), so nothing is lost by
// tapping off it.
//
// Opacity is part of the color, not a second setting: it rides the same
// confirm the color does, and the host stores it on whatever alpha channel the
// target it opened for actually has (see EditorShell's picker table). Targets
// with no such channel pass `showOpacity={false}` rather than being handed an
// opacity that would be silently dropped.

/** The biggest a swatch gets; on a narrow screen the row shrinks its cells
 *  to fit rather than wrapping — a second line is the thing this row
 *  replaced. */
const SWATCH_MAX = 40;
const SWATCH_MIN = 26;
const SWATCH_GAP = 8;
/** Cells in the row: the eyedropper, then one per remembered colour. */
const SWATCH_CELLS = 1 + RECENT_COLORS_MAX;
const HUE_GRAB_SCALE = 1.48;
const SV_GRAB_SCALE = 1.6;
/** Vertical room the sheet needs around the GL square: the popover's header
 *  block (grabber + hex title), the body's own padding, and the swatch row
 *  under the wheel. The optional blocks below are added to it, and the GL
 *  square shrinks to make room — exactly as the tile editor's picker does.
 *  Anything that still does not fit scrolls, which is the sheet's own floor
 *  under this arithmetic. */
const CHROME_H = 148;
/** The swatch row's share of that: its top margin plus a full-size cell.
 *  Given back when there is no row to draw — see `hasSwatches`. */
const SWATCH_BLOCK_H = 24 + SWATCH_MAX;
/** How much of the screen the picker's sheet may take. Taller than the tool
 *  menus' 72%: the wheel is one block that cannot usefully scroll in halves,
 *  and a wheel squeezed to fit would be the control you aim with. Still a
 *  fraction — the drawing stays in view above it, which is why this is a
 *  sheet. */
const SHEET_MAX_HEIGHT = '86%';
/** …and the same fraction as a number, to budget the GL square against. */
const SHEET_MAX_FRACTION = 0.86;
/** The Opacity block: its top margin plus one shared slider row. */
const OPACITY_BLOCK_H = 20 + ROW_SLIDER;

interface ColorPickerModalProps {
  visible: boolean;
  initialColor: RGBColor;
  /** Opacity of the color being edited, 0–1. Default 1 (opaque). */
  initialAlpha?: number;
  /** Show the opacity slider (default true). False where the target has no
   *  alpha channel to store it in — an opacity the user set there would be
   *  dropped on confirm, which is worse than not offering it. */
  showOpacity?: boolean;
  /** Confirmed color + opacity. `alpha` is 1 whenever the slider is hidden.
   *
   *  `colorTouched` says whether the COLOUR is part of what the confirm
   *  means: true when the reader picked one (or pressed SET having touched
   *  nothing, which is how a multi-selection is told to take the seed),
   *  false when the only thing they moved was the opacity slider. A caller
   *  that fans out over several targets must not write a colour when it is
   *  false — that is how moving a group's opacity used to repaint every
   *  member in the first one's colour. */
  onConfirm: (color: RGBColor, alpha: number, colorTouched: boolean) => void;
  onDismiss: () => void;
  /** Tap on the eyedropper button. The host closes the picker and arms canvas
   *  sampling — the picker itself would cover the pixels being sampled. Unset
   *  = no eyedropper button. */
  onEyedropper?: () => void;
  /** The swatch row, newest first — the picker's whole palette, after the
   *  eyedropper. A tap adopts one exactly as the wheel would. The host
   *  keeps it (EditorShell's recentColors, padded out of the default
   *  spectrum), and rewrites it when this picker CLOSES, so the cells
   *  never move under the finger choosing from them. */
  recentColors?: RGBColor[];
  /** The colour the wheel is showing right now, reported as it changes —
   *  for chrome outside the sheet that mirrors the choice live, which is
   *  the toolbar swatch. The header band inside the sheet needs no such
   *  callback: it is rendered from the same state. Must be stable
   *  (useCallback / a setState), since it fires on every wheel frame. */
  onPreview?: (color: RGBColor) => void;
  /** Home-indicator clearance under the sheet's content; the host knows
   *  it. Budgeted against the GL square too — the wheel has to end above
   *  the indicator, not behind it. */
  bottomInset?: number;
}

export function ColorPickerModal({
  visible,
  initialColor,
  initialAlpha = 1,
  showOpacity = true,
  onConfirm,
  onDismiss,
  onEyedropper,
  recentColors,
  onPreview,
  bottomInset = 0,
}: ColorPickerModalProps) {
  const { width: winW, height: winH } = useWindowDimensions();
  const contentWidth = Math.min(winW, 420) - 32;
  // Is there a swatch row at all? The eyedropper and the recents are both
  // optional, and a host that passes neither — the profile's colour, which
  // has no canvas to sample and keeps no history — was still being given
  // the row's height: an empty line under the wheel, holding the sheet up
  // by the space its missing swatches would have taken. Nothing to draw,
  // nothing to budget, and the sheet rises only as far as the wheel.
  const hasSwatches = Boolean(onEyedropper) || (recentColors?.length ?? 0) > 0;
  const chromeH = CHROME_H + bottomInset
    + (showOpacity ? OPACITY_BLOCK_H : 0)
    - (hasSwatches ? 0 : SWATCH_BLOCK_H);
  // The square is budgeted against the SHEET's ceiling, not the screen's:
  // the picker is a popover over the canvas now, so the height it has to
  // spend is the fraction of the window it may rise to.
  const glSize = Math.max(160, Math.min(contentWidth, winH * SHEET_MAX_FRACTION - chromeH));

  const initHsv = rgbToHsv(initialColor.r, initialColor.g, initialColor.b);
  const [hue, setHue] = useState(initHsv[0]);
  const [sat, setSat] = useState(initHsv[1]);
  const [val, setVal] = useState(initHsv[2]);
  const [alpha, setAlpha] = useState(initialAlpha);

  const rendererRef = useRef<HsvPickerRenderer | null>(null);
  const dragZoneRef = useRef<DragZone>('none');
  const animRef = useRef<number | null>(null);
  const userChangedRef = useRef(false);
  // …and of those edits, the ones that were a COLOUR. The opacity slider
  // flips `userChanged` too (an open-slide-close has to commit), so that
  // flag alone cannot tell "I chose this colour" from "I only moved the
  // opacity" — and the difference decides whether a confirm over a
  // multi-selection paints every member the first one's colour.
  const colorChangedRef = useRef(false);

  const hueSpring = useRef({ val: 1, vel: 0, target: 1 });
  const svSpring = useRef({ val: 1, vel: 0, target: 1 });
  const hsvRef = useRef({ h: hue, s: sat, v: val });
  hsvRef.current = { h: hue, s: sat, v: val };
  // Read at close time, like the HSV refs — a slider release and the backdrop
  // press can land in the same commit, and state would still be one behind.
  const alphaRef = useRef(alpha);
  alphaRef.current = alpha;

  useEffect(() => () => {
    if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    animRef.current = null;
    rendererRef.current?.dispose();
    rendererRef.current = null;
  }, []);

  // The seed, read at OPEN time only — see the effect below for why it is a
  // ref rather than a dependency.
  const seedRef = useRef({ color: initialColor, alpha: initialAlpha });
  seedRef.current = { color: initialColor, alpha: initialAlpha };
  const openedRef = useRef(false);

  // Reseed HSV + opacity from the target whenever the modal OPENS, so the
  // wheel and the slider both start where that target already is.
  //
  // Only on the way open. This used to list the seed color and alpha as
  // dependencies, so any change to them RE-seeded a picker that was already
  // up — and the host recomputes them on every render of the editor, from
  // whatever is selected at that moment. A render landing mid-drag (a save
  // settling, the selection clearing, the canvas repainting) therefore threw
  // away the opacity the finger was holding and snapped the slider back to
  // the value it opened on. The seed is a starting point; once the picker is
  // open the user owns these, until they close it and it commits.
  useEffect(() => {
    if (!visible) { openedRef.current = false; return; }
    if (openedRef.current) return;
    openedRef.current = true;
    const { color, alpha: seedAlpha } = seedRef.current;
    const [h, s, v] = rgbToHsv(color.r, color.g, color.b);
    setHue(h); setSat(s); setVal(v);
    setAlpha(seedAlpha);
    userChangedRef.current = false;
    colorChangedRef.current = false;
  }, [visible]);

  const stepSpring = useCallback((s: { val: number; vel: number; target: number }, dt: number) => {
    const force = -300 * (s.val - s.target) - 15 * s.vel;
    s.vel += force * dt;
    s.val += s.vel * dt;
  }, []);

  const scheduleAnim = useCallback(() => {
    if (animRef.current !== null) return;
    let lastT = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - lastT) / 1000, 0.033);
      lastT = now;
      stepSpring(hueSpring.current, dt);
      stepSpring(svSpring.current, dt);
      const renderer = rendererRef.current;
      if (renderer) {
        const { h, s, v } = hsvRef.current;
        const [su, sv] = svToUV(s, v);
        renderer.render(h, su, sv, hueSpring.current.val, svSpring.current.val);
      }
      const hs = hueSpring.current;
      const ss = svSpring.current;
      const settled =
        Math.abs(hs.val - hs.target) < 0.001 && Math.abs(hs.vel) < 0.01 &&
        Math.abs(ss.val - ss.target) < 0.001 && Math.abs(ss.vel) < 0.01;
      if (settled) {
        hs.val = hs.target; ss.val = ss.target; hs.vel = 0; ss.vel = 0;
        animRef.current = null;
        if (renderer) {
          const { h, s, v } = hsvRef.current;
          const [su, sv] = svToUV(s, v);
          renderer.render(h, su, sv, hs.val, ss.val);
        }
      } else {
        animRef.current = requestAnimationFrame(tick);
      }
    };
    animRef.current = requestAnimationFrame(tick);
  }, [stepSpring]);

  // Re-render GL on HSV change.
  useEffect(() => {
    if (!rendererRef.current) return;
    const [su, sv] = svToUV(sat, val);
    rendererRef.current.render(hue, su, sv, hueSpring.current.val, svSpring.current.val);
  }, [hue, sat, val]);

  const [curR, curG, curB] = useMemo(() => hsvToRgb(hue, sat, val), [hue, sat, val]);

  // Tell the host what the wheel is showing, so chrome OUTSIDE the sheet can
  // follow it — the toolbar swatch, which is the disc this picker was opened
  // from. Keyed on the resolved RGB rather than on h/s/v, so a drag along the
  // grey axis (where a thousand hues are one colour) reports once.
  useEffect(() => {
    if (visible) onPreview?.({ r: curR, g: curG, b: curB });
  }, [visible, curR, curG, curB, onPreview]);

  const onContextCreate = useCallback((gl: ExpoWebGLRenderingContext) => {
    const renderer = new HsvPickerRenderer(gl, gl.drawingBufferWidth, gl.drawingBufferHeight);
    rendererRef.current = renderer;
    const { h, s, v } = hsvRef.current;
    const [su, sv] = svToUV(s, v);
    renderer.render(h, su, sv);
  }, []);

  // Where the finger is ON THE WHEEL, as a 0..1 UV.
  //
  // `locationX/locationY` — the touch relative to the responder view — and
  // not `pageX/pageY` minus a measured origin. The measured origin was the
  // bug that came with the sheet: `onLayout` fires while the popover is
  // still SLIDING up, so the page coordinate it recorded was wherever the
  // wheel happened to be mid-animation, and every touch afterwards mapped
  // to a point that far off. (The takeover this replaced faded rather than
  // moved, which is the only reason a measurement taken at layout time was
  // ever right.) The responder coordinate is resolved against the view's
  // live rect at read time, so it cannot go stale — not to the slide, not
  // to the sheet's scroll, not to a resize. The size is `glSize`, the
  // square's own prop, rather than a second thing measured off it.
  const handleTouch = useCallback((evt: GestureResponderEvent, isStart: boolean) => {
    const touch = evt.nativeEvent;
    const [u, v] = touchToUV(touch.locationX, touch.locationY, glSize);
    if (isStart) {
      dragZoneRef.current = hitTest(u, v);
      if (dragZoneRef.current === 'ring') {
        userChangedRef.current = true;
        colorChangedRef.current = true;
        hueSpring.current.target = HUE_GRAB_SCALE;
        scheduleAnim();
      } else if (dragZoneRef.current === 'sv') {
        userChangedRef.current = true;
        colorChangedRef.current = true;
        svSpring.current.target = SV_GRAB_SCALE;
        scheduleAnim();
      }
    }
    const zone = dragZoneRef.current;
    if (zone === 'ring') {
      setHue(uvToHue(u, v));
    } else if (zone === 'sv') {
      const [s, v2] = uvToSV(u, v);
      setSat(s); setVal(v2);
    }
  }, [scheduleAnim, glSize]);

  const onTouchEnd = useCallback(() => {
    const zone = dragZoneRef.current;
    dragZoneRef.current = 'none';
    if (zone === 'ring') { hueSpring.current.target = 1; scheduleAnim(); }
    else if (zone === 'sv') { svSpring.current.target = 1; scheduleAnim(); }
  }, [scheduleAnim]);

  // The ONE way out, however it is reached: the backdrop, a swipe down, or
  // the hardware back. Commit the choice when the user touched anything,
  // dismiss when they did not — a look with no touch sets nothing.
  //
  // There is no confirm BUTTON. The sheet's own dismissal is the confirm,
  // which is what a sheet that follows your finger already says; a Set
  // Color button under the wheel was the takeover's way of ending
  // something the reader could not simply put down.
  const close = useCallback(() => {
    if (!userChangedRef.current) { onDismiss(); return; }
    const [r, g, b] = hsvToRgb(hsvRef.current.h, hsvRef.current.s, hsvRef.current.v);
    // Is the COLOUR part of what this means? It is when the reader chose
    // one. It is NOT when the only thing they moved was the opacity: then
    // each target keeps the colour it has, rather than every member of a
    // multi-selection taking the first one's (opacityOnlyKeepsColors).
    const colorTouched = colorChangedRef.current;
    onConfirm({ r, g, b }, showOpacity ? alphaRef.current : 1, colorTouched);
  }, [onConfirm, onDismiss, showOpacity]);

  // A drag of the opacity slider is a color edit like any other — it has to
  // flip `userChanged`, or an open-slide-close would commit nothing.
  const onAlpha = useCallback((v: number) => {
    userChangedRef.current = true;
    setAlpha(v);
  }, []);

  // One row, always: the eyedropper and every remembered colour, sized to
  // the wheel's width. It SHRINKS to fit rather than wrapping — a second
  // line is exactly what this row replaced.
  const swatchSize = Math.max(SWATCH_MIN, Math.min(
    SWATCH_MAX,
    Math.floor((glSize - SWATCH_GAP * (SWATCH_CELLS - 1)) / SWATCH_CELLS),
  ));

  if (!visible) return null;
  const translucent = showOpacity && alpha < 1;
  // A translucent header sits over the checkerboard's light squares, so pick
  // the foreground against what is actually behind the text, not against a
  // color that is only partly there — which is exactly what swatchInk does,
  // and it is the same rule the toolbar swatch inks its mode badge by.
  const headerFg = swatchInk({ r: curR, g: curG, b: curB, a: translucent ? alpha : 1 });

  return (
    // The shared bottom sheet (ToolPopover — the shape Shapes, Symmetry and
    // Blend take). The header IS the swatch, so it has to show opacity: a
    // 20%-alpha color painted flat would read as a pale but SOLID color.
    // Checkerboard underneath, color over it at its own alpha — the same
    // signal every other swatch in the editor uses. The title is the hex;
    // its ink flips black/white by luma since it sits on the color itself.
    // Dismissing KEEPS the color: this picker commits on close, so a tap
    // on the backdrop — or a swipe down anywhere but the wheel — lands the
    // choice rather than throwing it away.
    <ToolPopover
      visible
      title={`${rgbToHex(curR, curG, curB)}${translucent ? `  ${Math.round(alpha * 100)}%` : ''}`}
      onDismiss={close}
      bottomInset={bottomInset}
      maxHeight={SHEET_MAX_HEIGHT}
      // The picker reads against the dark modal grey (Facet's original
      // sheet): the wheel, the swatches and the color itself all sit better
      // on dark than on the light panel surface the tool menus use.
      background={MODAL_BG}
      headerForeground={headerFg}
      headerBackground={(
        <>
          {translucent ? <CheckerboardFill /> : null}
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: `rgba(${curR},${curG},${curB},${alpha})` },
            ]}
          />
        </>
      )}
    >
          <View style={styles.body}>
            <View
              style={{ width: glSize, height: glSize }}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              // The wheel is dragged in every direction, downwards
              // included — and the sheet around it dismisses on a downward
              // drag. Refusing to hand the gesture over is what keeps a
              // drag to the bottom of the hue ring from closing the picker
              // instead of picking a colour.
              onResponderTerminationRequest={() => false}
              onResponderGrant={(e) => handleTouch(e, true)}
              onResponderMove={(e) => handleTouch(e, false)}
              onResponderRelease={onTouchEnd}
              onResponderTerminate={onTouchEnd}
            >
              <GLView style={{ width: glSize, height: glSize }} onContextCreate={onContextCreate} />
            </View>
            {/* ONE row: the eyedropper, then the colours last worked in,
                newest first. The eyedropper never moves — it leads because
                it picks a colour the same way a swatch does, just off the
                canvas instead of off the row — and the cells to its right
                are the recents, so the most recent sits next to it and the
                rightmost is the one about to be forgotten. */}
            {hasSwatches ? (
            <View style={[styles.swatchRow, { width: glSize }]}>
              {onEyedropper ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Pick a color from the canvas"
                  onPress={onEyedropper}
                  style={[
                    styles.swatch,
                    styles.eyedropper,
                    { width: swatchSize, height: swatchSize },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="eyedropper"
                    size={Math.round(swatchSize * 0.6)}
                    color="#ddd"
                  />
                </Pressable>
              ) : null}
              {(recentColors ?? []).map((c, i) => {
                const selected = c.r === curR && c.g === curG && c.b === curB;
                return (
                  <Pressable
                    key={`${c.r}-${c.g}-${c.b}-${i}`}
                    accessibilityLabel={`rgb(${c.r},${c.g},${c.b})`}
                    onPress={() => {
                      const [h, s, v] = rgbToHsv(c.r, c.g, c.b);
                      setHue(h); setSat(s); setVal(v);
                      userChangedRef.current = true;
                      colorChangedRef.current = true;
                    }}
                    style={[
                      styles.swatch,
                      { width: swatchSize, height: swatchSize },
                      { backgroundColor: `rgb(${c.r},${c.g},${c.b})` },
                      selected && styles.swatchSelected,
                    ]}
                  />
                );
              })}
            </View>
            ) : null}
            {/* Opacity, under the swatches: the editor's shared slider row —
                the same caption-over-track control every property bar uses,
                value box on the right — with its ramp painted in the color
                itself over the alpha checker, so the track reads as "how much
                of THIS color". A drag and its release both go through onAlpha
                (the color commits once, on close). */}
            {showOpacity ? (
              <View style={[styles.opacitySection, { width: glSize }]}>
                <SliderRow
                  label="Opacity"
                  value={alpha}
                  accent={`rgb(${curR},${curG},${curB})`}
                  checker
                  onDark
                  apply={(v) => onAlpha(v)}
                />
              </View>
            ) : null}
          </View>
    </ToolPopover>
  );
}

const styles = StyleSheet.create({
  // Inside the sheet's scroll, which already centres and pads the sides:
  // no flex (a scroll's content sizes to itself) and no side padding of
  // its own to double it.
  body: { alignItems: 'center' },
  // One line, never wrapping: the cells shrink to fit instead (swatchSize),
  // because a second line is exactly what this row replaced.
  swatchRow: {
    flexDirection: 'row',
    gap: SWATCH_GAP,
    marginTop: 24,
    justifyContent: 'center',
  },
  swatch: { borderRadius: 8, borderWidth: 3, borderColor: 'transparent' },
  // The selected swatch wears the editor-wide selection ring (a white ring
  // was Facet's dark-card cue; on the light takeover it vanishes).
  swatchSelected: {
    borderColor: STATE_ACTIVE,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  // Facet's eyedropperSwatch, on the raised modal grey so it reads as a
  // control and visibly not one of the colors.
  eyedropper: { backgroundColor: MODAL_RAISED, alignItems: 'center', justifyContent: 'center' },
  opacitySection: { marginTop: 20 },
});
