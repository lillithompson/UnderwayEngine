import React, { useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { TintModel } from '../adapter';
import { isTranslucent } from '../logic/hsv';
import {
  TINT_ANGLE_MAX,
  TINT_BLENDS,
  TINT_TYPES,
  addStop,
  canRemoveStop,
  moveStop,
  nearestStopIndex,
  rampGradient,
  removeStop,
  tintBlendLabel,
} from '../logic/tint';
import { PANEL_INK, PANEL_INK_DIM, PANEL_TRACK } from '../theme';
import { CheckerboardFill, ColorSwatchFill } from './ColorSwatch';
import {
  BAR_BORDER, BAR_CONTROLS_TOP, BAR_PAD_BOTTOM, BAR_PAD_HORIZONTAL, BAR_PAD_TOP,
  ROW_GAP, ROW_PILL,
} from '../logic/submenuHeight';
import {
  ACCENT, BAR_BG, EffectBarHeader, HAIRLINE, LABEL, PILL_CHEVRON, PILL_TRACK,
  SegmentedRow, SHEET_BG, SHEET_BORDER, SHEET_LABEL, SHEET_ROW_ACTIVE,
  SHEET_TEXT, SliderRow,
} from './effectBar';

// The image Tint bar (design "6a"): a full-width light bar whose contents vary by
// Type. A header (chevron · TINT · gradient swatch) sits above:
//   • Type      — segmented Solid / Linear / Radial (always).
//   • Stops     — a positional gradient editor with draggable stops + add /
//                 delete (gradient modes only).
//   • Angle     — the linear gradient angle (Linear only).
//   • Opacity   — the whole tint layer's opacity (always).
//   • Blend     — a pill opening the blend-mode sheet (always).
// It's a sibling of the Shadow / Border / Crop / Text bars and shares their
// chrome + row grammar (see effectBar.tsx); the slide-in / swipe-out is the
// ObjectPropertiesPanel's, shared with those bars. The tint is a non-destructive
// overlay composited onto the image with the chosen blend mode + opacity.

// Sheet tokens are shared with the Text bar's font sheet (design 5a/6a) and
// come from effectBar.tsx — this file used to keep a private copy of all six.
// Stop-editor tokens: a stop rides ON the gradient ramp, so its ring is drawn
// against arbitrary colors, not the bar. Unselected stays white-ish (readable
// over a dark stop); selected is the panel's ink, matching the toolbar.
const STOP_BAR_BORDER = 'rgba(42,42,42,0.18)';
const BTN_TRACK = PANEL_TRACK;
const STOP_SELECTED = PANEL_INK;
const STOP_UNSELECTED = 'rgba(255,255,255,0.85)';

/** A small gradient fill (expo LinearGradient) used by the header swatch and the
 *  stop bar. `diagonal` renders a 135°-ish preview (the swatch); otherwise it's
 *  a left→right ramp (the stop bar's positional view). */
function Ramp({ tint, diagonal }: { tint: TintModel; diagonal?: boolean }) {
  if (tint.type === 'solid') {
    return <ColorSwatchFill color={tint.solid} />;
  }
  const { colors, locations } = rampGradient(tint.stops);
  return (
    <>
      {/* rampGradient emits rgba() for any stop the picker gave an opacity, so
          a partly-transparent ramp needs the checker behind it to read as
          transparent rather than as a muddier gradient. */}
      {tint.stops.some((s) => isTranslucent(s.color)) ? <CheckerboardFill /> : null}
      <LinearGradient
        colors={colors as [string, string, ...string[]]}
        locations={locations as [number, number, ...number[]]}
        start={{ x: 0, y: 0 }}
        end={diagonal ? { x: 1, y: 1 } : { x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
    </>
  );
}

/** The Stops row: a positional gradient editor (always a left→right ramp) with
 *  draggable stop handles, plus + (add) and trash (delete) buttons. */
function StopBar({ tint, onChange, onCommit, onAdd, onRemove, onDragActiveChange }: {
  tint: TintModel;
  onChange: (t: TintModel) => void;
  onCommit: (t: TintModel) => void;
  onAdd: () => void;
  onRemove: () => void;
  /** Fires true on touch-down and false on release so the panel can suspend its
   *  carousel-swipe / swipe-to-dismiss while a stop is being dragged. */
  onDragActiveChange?: (active: boolean) => void;
}) {
  const [barWidth, setBarWidth] = useState(0);
  // The PanResponder is created once; refs feed it the latest tint / geometry,
  // the stop it grabbed on touch-down, and the current callbacks.
  const tintRef = useRef(tint);
  tintRef.current = tint;
  const widthRef = useRef(0);
  widthRef.current = barWidth;
  const activeIdx = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const onDragActiveRef = useRef(onDragActiveChange);
  onDragActiveRef.current = onDragActiveChange;

  const posFor = (locationX: number): number => {
    const w = widthRef.current || 1;
    return Math.max(0, Math.min(1, locationX / w));
  };

  const endDrag = () => {
    onCommitRef.current(tintRef.current);
    onDragActiveRef.current?.(false);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Keep the drag: don't let the panel's carousel / dismiss pan steal it
      // mid-gesture (a horizontal / downward stop drag isn't a menu swipe).
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        // Touch-down selects the nearest stop and jumps it to the touch point.
        // Signal the panel to stand its swipe gestures down for the drag.
        onDragActiveRef.current?.(true);
        const pos = posFor(e.nativeEvent.locationX);
        activeIdx.current = nearestStopIndex(tintRef.current, pos);
        onChangeRef.current(moveStop(tintRef.current, activeIdx.current, pos));
      },
      onPanResponderMove: (e) => {
        onChangeRef.current(moveStop(tintRef.current, activeIdx.current, posFor(e.nativeEvent.locationX)));
      },
      // One coalesced undo entry per continuous drag.
      onPanResponderRelease: endDrag,
      onPanResponderTerminate: endDrag,
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => setBarWidth(e.nativeEvent.layout.width);

  return (
    <View style={styles.stopRow}>
      <Text style={styles.rowLabel}>Stops</Text>
      {/* The bar owns the drag; its hit area extends the full row height (≥44pt)
          so a stop is easy to grab. */}
      <View style={styles.stopBarHit} {...pan.panHandlers}>
        <View style={styles.stopBar} onLayout={onLayout}>
          {/* Clip the ramp fill to the rounded bar; handles sit above and
              overflow it (the outer bar is overflow-visible). */}
          <View style={styles.stopBarClip}>
            <Ramp tint={tint} />
          </View>
          {tint.stops.map((s, i) => (
            <View
              key={i}
              pointerEvents="none"
              style={[
                styles.stopHandle,
                {
                  left: s.position * barWidth - STOP_HANDLE / 2,
                  borderWidth: i === tint.selectedStop ? 3 : 1.5,
                  borderColor: i === tint.selectedStop ? STOP_SELECTED : STOP_UNSELECTED,
                },
              ]}
            >
              {/* Inner clip layer, not `overflow: hidden` on the handle: that
                  would clip the handle's own drop shadow away too. */}
              <View style={styles.stopHandleClip}>
                <ColorSwatchFill color={s.color} />
              </View>
            </View>
          ))}
        </View>
      </View>
      <Pressable style={styles.stopBtn} onPress={onAdd} accessibilityRole="button" accessibilityLabel="Add stop">
        <MaterialCommunityIcons name="plus" size={17} color={PANEL_INK} />
      </Pressable>
      <Pressable
        style={[styles.stopBtn, !canRemoveStop(tint) && styles.stopBtnDisabled]}
        onPress={canRemoveStop(tint) ? onRemove : undefined}
        disabled={!canRemoveStop(tint)}
        accessibilityRole="button"
        accessibilityLabel="Delete stop"
        accessibilityState={{ disabled: !canRemoveStop(tint) }}
      >
        <MaterialCommunityIcons name="trash-can-outline" size={17} color={PANEL_INK_DIM} />
      </Pressable>
    </View>
  );
}

/** The Blend row: a pill showing the current mode, tapping it opens the sheet. */
function BlendRow({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <View style={styles.pillRow}>
      <Text style={styles.rowLabel}>Blend</Text>
      <Pressable style={styles.pill} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Blend: ${label}`}>
        <Text style={styles.pillText} numberOfLines={1}>{label}</Text>
        <MaterialCommunityIcons name="chevron-down" size={16} color={PILL_CHEVRON} />
      </Pressable>
    </View>
  );
}

/** The blend sheet: presented over the bar; a scrollable list of modes with a
 *  checkmark on the current one, and Done. (Same pattern as the font sheet.) */
function BlendSheet({ current, onPick, onClose }: {
  current: TintModel['blend'];
  onPick: (blend: TintModel['blend']) => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.sheet}>
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle}>BLEND MODE</Text>
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Done">
          <Text style={styles.sheetDone}>Done</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.sheetList} keyboardShouldPersistTaps="handled">
        {TINT_BLENDS.map((b) => {
          const active = b.value === current;
          return (
            <Pressable
              key={b.value}
              onPress={() => onPick(b.value)}
              style={[styles.sheetRow, active && styles.sheetRowActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={b.label}
            >
              <Text style={styles.sheetRowLabel} numberOfLines={1}>{b.label}</Text>
              {active ? <MaterialCommunityIcons name="check" size={18} color={ACCENT} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function TintBar({ title = 'TINT', removeLabel, tint, onChange, onCommit, onBack, onRemove, onPickColor, onAddStop, onSheetOpenChange }: {
  /** Bar title. Defaults to the image tint; the Fill bar passes 'FILL' — it is
   *  this same bar pointed at a closed shape's interior (see `svgHasFill`). */
  title?: string;
  /** Accessibility label for the header trash (defaults to `Remove <title>`). */
  removeLabel?: string;
  tint: TintModel;
  /** Live preview (stop / slider drag, stop selection). */
  onChange: (t: TintModel) => void;
  /** Commit as one undo step (release, Type / blend pick, stop add / delete). */
  onCommit: (t: TintModel) => void;
  onBack: () => void;
  /** Remove the whole tint layer (header trash, beside the swatch). */
  onRemove: () => void;
  /** Open the color picker for the solid color / the selected stop. */
  onPickColor: () => void;
  /** Add a stop (commits) then open the color picker on it — the app sequences
   *  the picker so a fresh stop is never a dead end. */
  onAddStop: () => void;
  /** Fires when the blend sheet opens / closes so the panel can suspend its
   *  swipe-to-dismiss gesture (same as the Text bar's font sheet). */
  onSheetOpenChange?: (open: boolean) => void;
}) {
  const [sheetOpen, setSheetOpenState] = useState(false);
  const setSheetOpen = (open: boolean) => {
    setSheetOpenState(open);
    onSheetOpenChange?.(open);
  };
  const set = (patch: Partial<TintModel>, committed: boolean) =>
    (committed ? onCommit : onChange)({ ...tint, ...patch });

  const isGradient = tint.type !== 'solid';

  return (
    <View style={styles.bar}>
      <EffectBarHeader
        title={title}
        chevron
        // The swatch previews the tint: solid color, a 135° linear preview, or
        // the radial gradient. Tapping it targets the solid / selected stop.
        // The trash beside it removes the whole tint layer.
        swatch={<Ramp tint={tint} diagonal />}
        removeLabel={removeLabel ?? 'Remove tint'}
        onBack={onBack}
        onRemove={onRemove}
        onPickColor={onPickColor}
      />
      <View style={styles.controls}>
        <SegmentedRow
          label="Type"
          options={TINT_TYPES}
          value={tint.type}
          onChange={(type) => set({ type }, true)}
        />
        {isGradient ? (
          <StopBar
            tint={tint}
            onChange={(t) => onChange(t)}
            onCommit={(t) => onCommit(t)}
            onAdd={onAddStop}
            onRemove={() => onCommit(removeStop(tint))}
            // Suspend the panel's carousel-swipe / dismiss while dragging a stop
            // (reuses the same stand-down flag the blend sheet raises).
            onDragActiveChange={onSheetOpenChange}
          />
        ) : null}
        {tint.type === 'linear' ? (
          <SliderRow
            label="Angle"
            value={tint.angle / TINT_ANGLE_MAX}
            apply={(t, c) => set({ angle: Math.round(t * TINT_ANGLE_MAX) }, c)}
            readout={{
              text: `${Math.round(tint.angle)}°`,
              commit: (n) => set({ angle: Math.round(Math.min(Math.max(n, 0), TINT_ANGLE_MAX)) }, true),
            }}
          />
        ) : null}
        <SliderRow
          label="Opacity"
          value={tint.opacity}
          apply={(t, c) => set({ opacity: t }, c)}
        />
        <BlendRow label={tintBlendLabel(tint.blend)} onOpen={() => setSheetOpen(true)} />
      </View>
      {sheetOpen ? (
        <BlendSheet
          current={tint.blend}
          onPick={(blend) => { set({ blend }, true); setSheetOpen(false); }}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </View>
  );
}

// The stop handle diameter (design: 20pt).
const STOP_HANDLE = 20;

const styles = StyleSheet.create({
  bar: {
    backgroundColor: BAR_BG,
    borderTopWidth: BAR_BORDER,
    borderTopColor: HAIRLINE,
    paddingTop: BAR_PAD_TOP,
    paddingHorizontal: BAR_PAD_HORIZONTAL,
    paddingBottom: BAR_PAD_BOTTOM,
  },
  // 10pt header→controls gap; rows self-space (32/36pt tall) with a 2pt gap.
  controls: { marginTop: BAR_CONTROLS_TOP, gap: ROW_GAP },
  rowLabel: { width: 50, color: LABEL, fontSize: 12 },
  // Stops row: label + gradient bar (fills) + the two 28pt buttons.
  stopRow: { flexDirection: 'row', alignItems: 'center', height: ROW_PILL, gap: 10 },
  // The drag hit area fills the row height (≥44pt effective) around the 28pt bar.
  stopBarHit: { flex: 1, height: ROW_PILL, justifyContent: 'center' },
  stopBar: {
    height: 28, borderRadius: 8, borderWidth: 1, borderColor: STOP_BAR_BORDER, overflow: 'visible',
  },
  // Inner clip carrying the gradient fill (rounded to match the bar).
  stopBarClip: { ...StyleSheet.absoluteFillObject, borderRadius: 8, overflow: 'hidden', backgroundColor: PANEL_TRACK },
  stopHandle: {
    position: 'absolute', top: (28 - STOP_HANDLE) / 2, width: STOP_HANDLE, height: STOP_HANDLE,
    borderRadius: STOP_HANDLE / 2,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
  // The stop's color is a ColorSwatchFill child (so a translucent stop shows
  // its checkerboard), clipped to the handle's circle inside its border.
  stopHandleClip: { ...StyleSheet.absoluteFillObject, borderRadius: STOP_HANDLE / 2, overflow: 'hidden' },
  stopBtn: {
    width: 28, height: 28, borderRadius: 8, backgroundColor: BTN_TRACK,
    alignItems: 'center', justifyContent: 'center',
  },
  stopBtnDisabled: { opacity: 0.4 },
  // Blend pill row.
  pillRow: { flexDirection: 'row', alignItems: 'center', height: ROW_PILL },
  pill: {
    flex: 1, height: 32, flexDirection: 'row', alignItems: 'center',
    backgroundColor: PILL_TRACK, borderRadius: 9, paddingHorizontal: 12,
  },
  pillText: { flex: 1, color: SHEET_TEXT, fontSize: 13.5 },
  // Blend sheet — presented over the bar (inset from its sides + bottom).
  sheet: {
    position: 'absolute', left: 16, right: 16, bottom: 14, maxHeight: 320,
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
