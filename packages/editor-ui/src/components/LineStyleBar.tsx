import React, { useRef, useState } from 'react';
import { GestureResponderEvent, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { LineStyleGlyphKind, LineStyleModel } from '../adapter';
import { GROUP_PAD, SHADOW_PAD_SIZE } from '../logic/submenuHeight';
import {
  LINE_STYLE_GLYPH_OPTIONS, LINE_STYLE_SECTIONS, MAX_GLYPH_ROTATION, MAX_GLYPH_SIZE, MIN_GLYPH_SIZE,
  type LineStyleSection, padGlyphPathD, padPointFromTouch, padPolylinePathD, strokesAfterDraw,
} from '../logic/lineStyle';
import {
  BarBody, CONTROL_ACCENT, GroupedBody, RowGroup, SECTION_TABS_GROUP_RADIUS, SectionTabs, SliderRow,
  SegmentedRow,
} from './effectBar';
import { beginValueDrag, endValueDrag, VALUE_DRAG_SURFACE } from '../logic/slider';
import { PANEL_INK, PANEL_INK_DIM } from '../theme';
import { clamp01 } from '../appTheme';

// The STYLE page: a vector's stroke replaced by a run of glyphs laid along
// the path — the fourth tab the Effects page can make, and the one page of
// that family with a face of its own.
//
// It takes the Copies page's shape: ONE shaded box whose tabs switch the
// rows under them, so the three questions a style answers each get a face
// and one place on the page. GLYPH leads — which glyph, how closely they
// stand (Density) and how far each may stray from its place (Scatter) —
// with the drawing pad beside those rows, where the Shadow page's offset
// pad stands: it shows the glyph the path is wearing, and a finger drawn
// across it draws a new one. Drawing is what chooses Draw; there is no
// empty box to be sent to first. Each stroke lifted is a commit, so a
// two-stroke glyph is two undo steps and the second stroke lands on the
// first. Clear, in the pad's corner while there is a drawing, takes it
// away and the glyph goes back to the circle. ROTATION is how far every
// glyph is turned from the path's direction, and how far each may turn on
// its own (Spin). SCALE is the glyph's Size, and how much each may vary
// from it.
//
// Every face stands the same height — the Glyph face's, which the pad sets
// — so the page never resizes under a tab press, as the Copies page's
// doesn't. No colour row: the glyphs are outlined in the Stroke page's
// ink, width and dash, which is what makes them the LINE's style rather
// than a decoration laid over it.

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

const degText = (deg: number) => `${Math.round(deg)}°`;

/** The pad's drawing: one inline `<svg>` over the pad, a path for the
 *  glyph and one for the stroke under the finger. A plain DOM svg rather
 *  than views turned to lie along the curve (which left a gap at every
 *  join) for the reason the toolbar's shape icons are (ToolIcons.tsx): the
 *  shared editor is a DOM tree, react-native-svg is no app's dependency,
 *  and this chrome is only ever mounted on the web target. */
function PadInk({ glyphD, strokeD }: { glyphD: string; strokeD: string | null }) {
  return (
    <svg
      width={PAD_SIZE}
      height={PAD_SIZE}
      viewBox={`0 0 ${PAD_SIZE} ${PAD_SIZE}`}
      fill="none"
      style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
    >
      <path d={glyphD} stroke={PANEL_INK} strokeWidth={PREVIEW_STROKE} strokeLinecap="round" strokeLinejoin="round" />
      {strokeD ? (
        <path d={strokeD} stroke={CONTROL_ACCENT} strokeWidth={PREVIEW_STROKE} strokeLinecap="round" strokeLinejoin="round" />
      ) : null}
    </svg>
  );
}

/** The pad: the glyph, drawn; and a surface to draw one on. `onClear` is
 *  given while there is a drawing to clear, and stands as a small word in
 *  the pad's corner. */
function GlyphPad({ style, onDraw, onClear }: {
  style: LineStyleModel;
  onDraw: (stroke: readonly [number, number][]) => void;
  onClear?: () => void;
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
  return (
    <View style={styles.padHolder}>
      <View
        style={styles.pad}
        accessibilityRole="image"
        accessibilityLabel="Glyph pad: draw here to make your own glyph"
        {...pan.panHandlers}
      >
        <PadInk
          glyphD={padGlyphPathD(style, PAD_SIZE)}
          strokeD={drawing ? padPolylinePathD(drawing, PAD_SIZE) : null}
        />
      </View>
      {onClear ? (
        <Pressable
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel="Clear drawing"
          style={styles.clear}
        >
          <Text style={styles.clearLabel}>Clear</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The Style page's controls — the page its own tab opens.
 *
 * A glyph choice and a lifted stroke commit at once; the sliders fire live
 * (`onChange`) and commit on release, the contract every other page keeps.
 * Which face shows is the panel's (`section` / `onSection`), as the Copies
 * page's is: the sheet's height is computed ahead of the render.
 */
export function LineStyleBar({ style, section, onSection, onChange, onCommit }: {
  style: LineStyleModel;
  section: LineStyleSection;
  onSection: (section: LineStyleSection) => void;
  onChange: (s: LineStyleModel) => void;
  onCommit: (s: LineStyleModel) => void;
}) {
  const set = (patch: Partial<LineStyleModel>, committed: boolean) =>
    (committed ? onCommit : onChange)({ ...style, ...patch });
  const sizeT = (style.size - MIN_GLYPH_SIZE) / (MAX_GLYPH_SIZE - MIN_GLYPH_SIZE);
  const drawn = style.glyph === 'custom' && !!style.custom && style.custom.length > 0;
  return (
    <GroupedBody>
      <RowGroup>
        <SectionTabs
          options={LINE_STYLE_SECTIONS}
          value={section}
          onChange={onSection}
          pad={GROUP_PAD}
          radius={SECTION_TABS_GROUP_RADIUS}
        />
        {/* Every face is as tall as the pad, so the sheet never moves under
            a tab press; the rows of a face without the pad spread to that
            same height. */}
        <View style={styles.face}>
          {section === 'glyph' ? (
            <BarBody
              spread
              aside={(
                <GlyphPad
                  style={style}
                  onDraw={(stroke) => {
                    const custom = strokesAfterDraw(style, stroke);
                    if (custom) set({ glyph: 'custom', custom }, true);
                  }}
                  onClear={drawn ? () => set({ glyph: 'circle', custom: undefined }, true) : undefined}
                />
              )}
            >
              <SegmentedRow
                options={GLYPH_OPTIONS}
                value={style.glyph}
                onChange={(glyph) => set({ glyph }, true)}
              />
              <SliderRow label="Density" value={clamp01(style.density)} apply={(t, c) => set({ density: t }, c)} />
              <SliderRow label="Scatter" value={clamp01(style.randomPlacement)} apply={(t, c) => set({ randomPlacement: t }, c)} />
            </BarBody>
          ) : section === 'rotation' ? (
            <BarBody spread>
              <SliderRow
                label="Rotation"
                value={clamp01(style.rotation / MAX_GLYPH_ROTATION)}
                apply={(t, c) => set({ rotation: Math.round(t * MAX_GLYPH_ROTATION) }, c)}
                readout={{
                  text: degText(style.rotation),
                  commit: (n) => set({ rotation: Math.round(clamp01(n / MAX_GLYPH_ROTATION) * MAX_GLYPH_ROTATION) }, true),
                }}
              />
              <SliderRow label="Spin" value={clamp01(style.randomRotation)} apply={(t, c) => set({ randomRotation: t }, c)} />
            </BarBody>
          ) : (
            <BarBody spread>
              <SliderRow
                label="Size"
                value={clamp01(sizeT)}
                apply={(t, c) => set({ size: MIN_GLYPH_SIZE + t * (MAX_GLYPH_SIZE - MIN_GLYPH_SIZE) }, c)}
              />
              <SliderRow label="Vary" value={clamp01(style.randomSize)} apply={(t, c) => set({ randomSize: t }, c)} />
            </BarBody>
          )}
        </View>
      </RowGroup>
    </GroupedBody>
  );
}

const styles = StyleSheet.create({
  face: { height: PAD_SIZE, justifyContent: 'center' },
  padHolder: { width: PAD_SIZE, height: PAD_SIZE },
  pad: {
    width: PAD_SIZE, height: PAD_SIZE, borderRadius: 12, backgroundColor: PAD_FILL,
    borderWidth: 1, borderColor: PAD_BORDER, overflow: 'hidden',
    ...VALUE_DRAG_SURFACE,
  },
  // Clear sits in the pad's top-right corner, over it, so the pad keeps
  // the whole of the face's height.
  clear: { position: 'absolute', top: 2, right: 2, paddingVertical: 4, paddingHorizontal: 8 },
  clearLabel: { color: PANEL_INK_DIM, fontSize: 12, fontWeight: '600' },
});
