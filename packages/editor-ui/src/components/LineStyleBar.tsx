import React, { useRef, useState } from 'react';
import {
  GestureResponderEvent, PanResponder, Pressable, type StyleProp, StyleSheet, Text, type TextStyle, View, type ViewStyle,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { LineStyleGlyphKind, LineStyleModel } from '../adapter';
import { GLYPH_BUTTON, GLYPH_GRID_GAP, GROUP_PAD, SHADOW_PAD_SIZE } from '../logic/submenuHeight';
import {
  LINE_STYLE_GLYPH_OPTIONS, LINE_STYLE_SECTIONS, MAX_GLYPH_ROTATION, MAX_GLYPH_SIZE, MIN_GLYPH_SIZE,
  type LineStyleSection, padGlyphPathD, padPointFromTouch, padPolylinePathD, strokesAfterDraw,
} from '../logic/lineStyle';
import {
  BarBody, CONTROL_ACCENT, GroupedBody, RowGroup, SECTION_TABS_GROUP_RADIUS, SectionTabs, SliderRow,
  PAD_WELL_STYLE, SQUARE_BUTTON_ON_STYLE, SQUARE_BUTTON_STYLE,
} from './effectBar';
import { beginValueDrag, endValueDrag, VALUE_DRAG_SURFACE } from '../logic/slider';
import { PANEL_INK, PANEL_INK_DIM } from '../theme';
import { clamp01 } from '../appTheme';

// The STYLE page: a vector's stroke replaced by a run of glyphs laid along
// the path — the fourth tab the Effects page can make, and the one page of
// that family with a face of its own.
//
// It takes the Copies page's shape: ONE shaded box whose tabs switch the
// rows under them, so the four questions a style answers each get a face
// and one place on the page. GLYPH leads — which glyph, as a grid of
// square buttons (the four built-in shapes and Draw; a segmented row until
// DrawBots report 99b5fb2e) — with the drawing pad beside the grid, where
// the Shadow page's offset pad stands: it shows the glyph the path is
// wearing, and a finger drawn across it draws a new one. Drawing is what
// chooses Draw; a press on Draw itself leaves the pad BLANK for the drawing
// it asks for (the same report; it showed the circle the path stamps in
// the meantime until then), and shows a drawing already made. Each stroke
// lifted is a commit, so a two-stroke glyph is two undo steps and the
// second stroke lands on the first. Clear, in the pad's corner while there
// is a drawing, takes it away and the glyph goes back to the circle.
// PLACEMENT is how closely the glyphs stand (Density) and how far each may
// stray from its place (Scatter) — a face of their own since the same
// report; they stood under the glyph row until then. ROTATION is how far
// every glyph is turned from the path's direction, and how far each may
// turn on its own (Spin). SCALE is the glyph's Size, and how much each may
// vary from it.
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
/** A glyph square's icon, px: the segmented row's 18 a shade larger, the
 *  square having the room. */
const GLYPH_ICON = 22;

const degText = (deg: number) => `${Math.round(deg)}°`;

/** The Glyph face's grid: one square button a glyph (DrawBots report
 *  99b5fb2e), fixed squares (`GLYPH_BUTTON`) that WRAP beside the pad —
 *  three to a line on the narrowest sheet, all five on a tablet — and
 *  stand centred in the face's height whatever they wrap to. The one
 *  chosen is filled with the lit border, the pattern pages' square
 *  (`SQUARE_BUTTON_STYLE`), the rest outlined. A choice commits at once. */
function GlyphGrid({ value, onChange }: { value: LineStyleGlyphKind; onChange: (glyph: LineStyleGlyphKind) => void }) {
  return (
    <View style={styles.grid}>
      {GLYPH_OPTIONS.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.gridCell, active && styles.gridCellActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={o.label}
          >
            <MaterialCommunityIcons name={o.icon} size={GLYPH_ICON} color={active ? PANEL_INK : PANEL_INK_DIM} />
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * How a {@link GlyphPad} is dressed: its side, its inks and the styles of
 * its square and its Clear. The pad is one component for every host that
 * shows a line style's glyph and takes a drawing of one — this page, in the
 * panel's own dress ({@link PANEL_GLYPH_PAD}), and a host's own page in the
 * host's (DrawBots' Changes style effect, in its Notebook skin) — so a host
 * hands over a skin, never a second pad.
 */
export interface GlyphPadSkin {
  /** The pad's side, px. */
  size: number;
  /** The glyph's ink, and the stroke under the finger's. */
  ink: string;
  accent: string;
  /** The inks' width, px. */
  strokeWidth: number;
  /** The square itself: its ground and its edge, `size` each way. */
  pad: StyleProp<ViewStyle>;
  /** Clear, in the pad's corner, and its word. */
  clear: StyleProp<ViewStyle>;
  clearLabel: StyleProp<TextStyle>;
  /** Over the whole pad while it is locked. */
  locked?: StyleProp<ViewStyle>;
}

/** The pad's drawing: one inline `<svg>` over the pad, a path for the
 *  glyph and one for the stroke under the finger. A plain DOM svg rather
 *  than views turned to lie along the curve (which left a gap at every
 *  join) for the reason the toolbar's shape icons are (ToolIcons.tsx): the
 *  shared editor is a DOM tree, react-native-svg is no app's dependency,
 *  and this chrome is only ever mounted on the web target. */
function PadInk({ glyphD, strokeD, skin }: { glyphD: string; strokeD: string | null; skin: GlyphPadSkin }) {
  return (
    <svg
      width={skin.size}
      height={skin.size}
      viewBox={`0 0 ${skin.size} ${skin.size}`}
      fill="none"
      style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
    >
      <path d={glyphD} stroke={skin.ink} strokeWidth={skin.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      {strokeD ? (
        <path d={strokeD} stroke={skin.accent} strokeWidth={skin.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      ) : null}
    </svg>
  );
}

/** The pad: the glyph, drawn; and a surface to draw one on. `onClear` is
 *  given while there is a drawing to clear, and stands as a small word in
 *  the pad's corner.
 *
 *  Exported for a host's own page of a line style (see {@link GlyphPadSkin}),
 *  with the two things such a page may need that this one does not:
 *  `locked` — the pad inert, its Clear gone, dressed in the skin's `locked`
 *  (a host whose page can be read but not written, as DrawBots' is while a
 *  run is live) — and `touch: 'box'`, which reads the pad's box ONCE as a
 *  stroke is claimed and places every move in it, where the default reads
 *  each event's own `locationX`/`locationY` (which the web target answers
 *  from the element's box per event). A stroke's every other rule is the
 *  same for both: a lifted finger commits, a terminated stroke commits what
 *  it had, the release adds no point. */
export function GlyphPad({ style, onDraw, onClear, skin = PANEL_GLYPH_PAD, locked = false, touch = 'location' }: {
  style: LineStyleModel;
  onDraw: (stroke: readonly [number, number][]) => void;
  onClear?: () => void;
  skin?: GlyphPadSkin;
  locked?: boolean;
  touch?: 'location' | 'box';
}) {
  const cbRef = useRef(onDraw);
  cbRef.current = onDraw;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const touchRef = useRef(touch);
  touchRef.current = touch;
  const sizeRef = useRef(skin.size);
  sizeRef.current = skin.size;
  const padRef = useRef<HTMLElement | null>(null);
  const boxRef = useRef<{ left: number; top: number; side: number } | null>(null);
  const strokeRef = useRef<[number, number][]>([]);
  const [drawing, setDrawing] = useState<[number, number][] | null>(null);
  const add = (e: GestureResponderEvent) => {
    const box = boxRef.current;
    const p = box
      ? padPointFromTouch(e.nativeEvent.pageX - box.left, e.nativeEvent.pageY - box.top, box.side)
      : padPointFromTouch(e.nativeEvent.locationX, e.nativeEvent.locationY, sizeRef.current);
    if (!p) return;
    strokeRef.current.push(p);
    setDrawing(strokeRef.current.slice());
  };
  const finish = () => {
    endValueDrag();
    const stroke = strokeRef.current;
    strokeRef.current = [];
    boxRef.current = null;
    setDrawing(null);
    cbRef.current(stroke);
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !lockedRef.current,
      onMoveShouldSetPanResponder: () => !lockedRef.current,
      // Keep the touch once the pad is grabbed so the sheet's swipe-to-dismiss
      // can't steal it mid-stroke (see Slider for the same guard).
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        beginValueDrag();
        strokeRef.current = [];
        // The box once per stroke, never per move, for a host that asks.
        const r = touchRef.current === 'box' ? padRef.current?.getBoundingClientRect?.() : undefined;
        boxRef.current = r && r.width > 0 ? { left: r.left, top: r.top, side: r.width } : null;
        add(e);
      },
      onPanResponderMove: (e) => add(e),
      // The release adds no point: its location is not where the finger
      // let go (see the Slider's and the XYPad's release handlers), and the
      // last move already is.
      onPanResponderRelease: () => finish(),
      onPanResponderTerminate: () => finish(),
    }),
  ).current;
  return (
    <View style={[{ width: skin.size, height: skin.size }, locked ? skin.locked : null]}>
      <View
        ref={(el) => { padRef.current = el as unknown as HTMLElement | null; }}
        style={skin.pad}
        accessibilityRole="image"
        accessibilityLabel="Glyph pad: draw here to make your own glyph"
        pointerEvents={locked ? 'none' : 'auto'}
        {...pan.panHandlers}
      >
        <PadInk
          glyphD={padGlyphPathD(style, skin.size)}
          strokeD={drawing ? padPolylinePathD(drawing, skin.size) : null}
          skin={skin}
        />
      </View>
      {onClear && !locked ? (
        <Pressable
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel="Clear drawing"
          style={skin.clear}
        >
          <Text style={skin.clearLabel}>Clear</Text>
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
              <GlyphGrid value={style.glyph} onChange={(glyph) => set({ glyph }, true)} />
            </BarBody>
          ) : section === 'placement' ? (
            <BarBody spread>
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
  // The glyph grid: fixed squares that wrap, the lines centred in the
  // column's height (the pad's), one grid gap apart each way.
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignContent: 'center', gap: GLYPH_GRID_GAP },
  gridCell: { width: GLYPH_BUTTON, height: GLYPH_BUTTON, ...SQUARE_BUTTON_STYLE },
  gridCellActive: SQUARE_BUTTON_ON_STYLE,
  pad: { ...PAD_WELL_STYLE, overflow: 'hidden', ...VALUE_DRAG_SURFACE },
  // Clear sits in the pad's top-right corner, over it, so the pad keeps
  // the whole of the face's height.
  clear: { position: 'absolute', top: 2, right: 2, paddingVertical: 4, paddingHorizontal: 8 },
  clearLabel: { color: PANEL_INK_DIM, fontSize: 12, fontWeight: '600' },
});

/** The pad as this page wears it: the Shadow page's pad well, the panel's
 *  ink for the glyph and the controls' accent for the stroke in hand. */
export const PANEL_GLYPH_PAD: GlyphPadSkin = {
  size: PAD_SIZE, ink: PANEL_INK, accent: CONTROL_ACCENT, strokeWidth: PREVIEW_STROKE,
  pad: styles.pad, clear: styles.clear, clearLabel: styles.clearLabel,
};
