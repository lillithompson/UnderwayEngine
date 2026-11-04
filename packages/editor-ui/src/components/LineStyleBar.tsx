import React, { useRef, useState } from 'react';
import { GestureResponderEvent, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { LineStyleGlyphKind, LineStyleModel } from '../adapter';
import { ROW_GAP, SHADOW_PAD_SIZE } from '../logic/submenuHeight';
import {
  LINE_STYLE_GLYPH_OPTIONS, MAX_GLYPH_SIZE, MIN_GLYPH_SIZE, padPointFromTouch, padPolylines,
  strokesAfterDraw,
} from '../logic/lineStyle';
import { BarBody, CONTROL_ACCENT, SliderRow, SegmentedRow } from './effectBar';
import { beginValueDrag, endValueDrag, VALUE_DRAG_SURFACE } from '../logic/slider';
import { PANEL_INK, PANEL_INK_DIM } from '../theme';
import { clamp01 } from '../appTheme';

// The STYLE page: a vector's stroke replaced by a run of glyphs laid along
// the path — the fourth tab the Effects page can make, and the one page of
// that family with a face of its own.
//
// The glyph row leads: a dash (which makes a dashed line), a circle, a
// sparkle, a heart, and Draw. Under it the page takes the Shadow page's
// shape — a square pad in the aside column, the sliders beside it — with
// the PAD doing two jobs: it shows the glyph the path is wearing, and a
// finger drawn across it draws a new one. Drawing is what chooses Draw;
// there is no empty box to be sent to first. Each stroke lifted is a
// commit, so a two-stroke glyph is two undo steps and the second stroke
// lands on the first. Clear, under the pad, takes the drawing away and the
// glyph goes back to the circle.
//
// Five sliders: Density and Size, then the three random ones — where a
// glyph stands (Scatter), which way it faces (Spin), how big it is (Vary).
// No colour row: the glyphs are outlined in the Stroke page's ink, width
// and dash, which is what makes them the LINE's style rather than a
// decoration laid over it.

type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** The glyph row's options with their icons typed for the row that draws
 *  them (the logic module keeps them as plain names, being engine-side of
 *  the icon set). */
const GLYPH_OPTIONS: readonly { value: LineStyleGlyphKind; label: string; icon: MCIName }[] =
  LINE_STYLE_GLYPH_OPTIONS.map((o) => ({ ...o, icon: o.icon as MCIName }));

const PAD_SIZE = SHADOW_PAD_SIZE;
const PREVIEW_STROKE = 2;

// The pad is the Shadow page's recessed well.
const PAD_FILL = 'rgba(42,42,42,0.08)';
const PAD_BORDER = 'rgba(42,42,42,0.16)';


/** One polyline as views: a hairline per piece, turned to lie along it.
 *  React Native has no path primitive, and a pad of a few dozen short
 *  rotated views is cheap. */
function Polyline({ points, color }: { points: readonly [number, number][]; color: string }) {
  const pieces: React.ReactNode[] = [];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const dx = (x1 - x0) * PAD_SIZE;
    const dy = (y1 - y0) * PAD_SIZE;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) continue;
    const mx = (x0 + x1) / 2 * PAD_SIZE;
    const my = (y0 + y1) / 2 * PAD_SIZE;
    const angle = Math.atan2(dy, dx);
    pieces.push(
      <View
        key={i}
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: mx - len / 2,
          top: my - PREVIEW_STROKE / 2,
          width: len,
          height: PREVIEW_STROKE,
          borderRadius: PREVIEW_STROKE / 2,
          backgroundColor: color,
          transform: [{ rotate: `${angle}rad` }],
        }}
      />,
    );
  }
  return <>{pieces}</>;
}

/** The pad: the glyph, drawn; and a surface to draw one on. */
function GlyphPad({ style, onDraw }: {
  style: LineStyleModel;
  onDraw: (stroke: readonly [number, number][]) => void;
}) {
  const cbRef = useRef(onDraw);
  cbRef.current = onDraw;
  const strokeRef = useRef<[number, number][]>([]);
  const [drawing, setDrawing] = useState<[number, number][] | null>(null);
  const add = (e: GestureResponderEvent) => {
    const p = padPointFromTouch(e.nativeEvent.locationX, e.nativeEvent.locationY, PAD_SIZE);
    if (!p) return;
    strokeRef.current.push(p);
    setDrawing(strokeRef.current.slice());
  };
  const finish = () => {
    endValueDrag();
    const stroke = strokeRef.current;
    strokeRef.current = [];
    setDrawing(null);
    cbRef.current(stroke);
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Keep the touch once the pad is grabbed so the sheet's swipe-to-dismiss
      // can't steal it mid-stroke (see Slider for the same guard).
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => { beginValueDrag(); strokeRef.current = []; add(e); },
      onPanResponderMove: (e) => add(e),
      onPanResponderRelease: (e) => { add(e); finish(); },
      onPanResponderTerminate: () => finish(),
    }),
  ).current;
  const drawn = padPolylines(style);
  return (
    <View
      style={styles.pad}
      accessibilityRole="image"
      accessibilityLabel="Glyph pad: draw here to make your own glyph"
      {...pan.panHandlers}
    >
      {drawn.map((poly, i) => <Polyline key={i} points={poly} color={PANEL_INK} />)}
      {drawing ? <Polyline points={drawing} color={CONTROL_ACCENT} /> : null}
    </View>
  );
}

/**
 * The Style page's controls — the page its own tab opens.
 *
 * A glyph choice and a lifted stroke commit at once; the sliders fire live
 * (`onChange`) and commit on release, the contract every other page keeps.
 */
export function LineStyleBar({ style, onChange, onCommit }: {
  style: LineStyleModel;
  onChange: (s: LineStyleModel) => void;
  onCommit: (s: LineStyleModel) => void;
}) {
  const set = (patch: Partial<LineStyleModel>, committed: boolean) =>
    (committed ? onCommit : onChange)({ ...style, ...patch });
  const sizeT = (style.size - MIN_GLYPH_SIZE) / (MAX_GLYPH_SIZE - MIN_GLYPH_SIZE);
  const drawn = style.glyph === 'custom' && !!style.custom && style.custom.length > 0;
  return (
    <View style={styles.page}>
      <SegmentedRow
        label="Glyph"
        options={GLYPH_OPTIONS}
        value={style.glyph}
        onChange={(glyph) => set({ glyph }, true)}
      />
      <BarBody
        spread
        aside={(
          <View style={styles.asideColumn}>
            <GlyphPad
              style={style}
              onDraw={(stroke) => {
                const custom = strokesAfterDraw(style, stroke);
                if (custom) set({ glyph: 'custom', custom }, true);
              }}
            />
            {/* Clear stands under the pad only while there is a drawing to
                clear; the glyph goes back to the circle. */}
            <Pressable
              onPress={() => set({ glyph: 'circle', custom: undefined }, true)}
              disabled={!drawn}
              accessibilityRole="button"
              accessibilityLabel="Clear drawing"
              style={[styles.clear, !drawn && styles.clearHidden]}
            >
              <Text style={styles.clearLabel}>Clear</Text>
            </Pressable>
          </View>
        )}
      >
        <SliderRow label="Density" value={clamp01(style.density)} apply={(t, c) => set({ density: t }, c)} />
        <SliderRow
          label="Size"
          value={clamp01(sizeT)}
          apply={(t, c) => set({ size: MIN_GLYPH_SIZE + t * (MAX_GLYPH_SIZE - MIN_GLYPH_SIZE) }, c)}
        />
        {/* The random three: where a glyph stands, which way it faces, how
            big it is. */}
        <SliderRow label="Scatter" value={clamp01(style.randomPlacement)} apply={(t, c) => set({ randomPlacement: t }, c)} />
        <SliderRow label="Spin" value={clamp01(style.randomRotation)} apply={(t, c) => set({ randomRotation: t }, c)} />
        <SliderRow label="Vary" value={clamp01(style.randomSize)} apply={(t, c) => set({ randomSize: t }, c)} />
      </BarBody>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: ROW_GAP },
  asideColumn: { alignItems: 'center', gap: 6 },
  pad: {
    width: PAD_SIZE, height: PAD_SIZE, borderRadius: 12, backgroundColor: PAD_FILL,
    borderWidth: 1, borderColor: PAD_BORDER, overflow: 'hidden',
    ...VALUE_DRAG_SURFACE,
  },
  clear: { paddingVertical: 4, paddingHorizontal: 10 },
  clearHidden: { opacity: 0 },
  clearLabel: { color: PANEL_INK_DIM, fontSize: 13, fontWeight: '600' },
});
