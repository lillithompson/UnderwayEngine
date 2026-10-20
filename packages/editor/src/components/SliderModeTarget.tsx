import React, { CSSProperties, ReactNode, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ACCENT_CYAN, TEXT_PRIMARY } from '@/engine/colors';
import { CAPSULE_EDGE_MARGIN, CAPSULE_SIZE } from '@/editor-ui/theme';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import CanvasRadialMenu, { CanvasRadialMenuRef } from '@/editor/components/CanvasRadialMenu';
import { FLOATING_SLOT_ANIM_MS } from '@/editor/components/PatternActionsCapsule';
import { FLOATING_CAPSULE_BG, FLOATING_CAPSULE_GLYPH_SIZE, FLOATING_CAPSULE_INK } from '@/editor/components/floatingCapsuleStyle';
import { RADIAL_QUARTER_SPREAD, RadialAction } from '@/editor/radialMenu';
import { sliderModeIcon, sliderModeIsActive, type SliderModeOption } from '../sliderModeMenu';
import type { ToolIconProps } from '@/editor/components/ToolIcons';

// The slider-mode target: whenever a floating slider stands at the bottom
// of the screen (the paint brush's row, the rig's), a hollow circle the
// slider handle's own size sits in the lower right — on the undo/redo
// column's vertical line, on the slider's horizontal one — wearing the
// ACTIVE mode's level-1 glyph (a child mode shows its parent's; the family
// is the readable thing at ring size), and holding it opens a radial menu
// of what that slider can mean. The menu IS the
// long-press quick-action menu (CanvasRadialMenu, same buttons, same
// press-slide-release, same hover invert), pinned to fill the 90° arc of
// the lower-right corner from the target's center instead of auto-fitting
// around a canvas press. One component for every slider that offers modes;
// the option tables live in sliderModeMenu.ts.
//
// The circle owns the whole gesture through pointer capture: press opens
// the fan, the still-held finger drags over a button (forwarded to the
// menu's updateDrag), and the release commits whatever is hovered
// (releaseDrag) — the menu overlay itself stays pointer-inert,
// exactly like the canvas long-press menus. The menu portals to
// document.body so its absolute-fill overlay spans the screen rather than
// the 44px strip this target sits in (the editor is web-only DOM).

/** = the floating slider handle (CAPSULE_SIZE) and the radial buttons. */
const TARGET_SIZE = 44;

/** The mode badge's disc, and the glyph inside it. Small enough to read as
 *  a mark ON the ring rather than a second control beside it, big enough
 *  that the glyph inside survives — the ring's own icon stays the biggest
 *  thing in the corner. */
const BADGE_SIZE = 20;
const BADGE_GLYPH_SIZE = 13;
/** Above the floating slider rows (205) — the fan blooms from beside them. */
const TARGET_MENU_Z = 300;

/** The ring every lower-right target wears: the floating capsules' own
 *  dress — their rim ink over their grey ground (Flood | Close | Clear,
 *  the rig's Left | Right) — so the ring is one more piece of that
 *  floating chrome, seated on the undo/redo column's line. */
const RING_STYLE: CSSProperties = {
  position: 'absolute',
  right: CAPSULE_EDGE_MARGIN,
  top: 0,
  width: TARGET_SIZE,
  height: TARGET_SIZE,
  borderRadius: TARGET_SIZE / 2,
  border: `2px solid ${FLOATING_CAPSULE_INK}`,
  background: FLOATING_CAPSULE_BG,
  boxSizing: 'border-box',
  cursor: 'pointer',
  touchAction: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  // Both hosts wrap the target in a pointer-inert strip (FloatingTargetStrip
  // / RN box-none); a raw div doesn't get the child re-enable RN views do,
  // so it opts back in itself.
  pointerEvents: 'auto',
};

/** The badge's ink: its rim and its glyph, white on the ring's own grey.
 *  The disc is the ring's ground (FLOATING_CAPSULE_BG), so it reads as a
 *  part of the button rather than a swatch pinned to it; the white rim is
 *  what separates it from the ring's rim where the two overlap. */
const BADGE_INK = '#FFFFFF';

/** The badge's seat: hung off the ring's lower-left, overlapping its rim,
 *  which is the one edge of the circle with nothing beside it — the screen
 *  edge is right, the undo/redo column above, the slider row level with it
 *  to the left but a whole handle away. */
const BADGE_STYLE: CSSProperties = {
  position: 'absolute',
  left: -3,
  bottom: -3,
  width: BADGE_SIZE,
  height: BADGE_SIZE,
  borderRadius: BADGE_SIZE / 2,
  border: `2px solid ${BADGE_INK}`,
  background: FLOATING_CAPSULE_BG,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  // The ring under it owns the gesture: a press anywhere on the target —
  // the badge included — opens the fan. The badge is a readout, never a
  // second button, so it must not swallow the press that lands on it.
  pointerEvents: 'none',
};

/** A setting the target carries that its own glyph cannot say: the blend
 *  mode the brush is in, as its mark. Drawn in the ring's own grey with a
 *  white rim and glyph — one fixed dress, so the corner reads the same
 *  whatever colour the brush holds. It was a disc of the live colour once,
 *  inked black or white to suit; the colour is already on the bar's
 *  swatch, and here it competed with the mark it was meant to carry. */
export interface SliderModeBadge {
  Icon: React.ComponentType<ToolIconProps>;
}

/**
 * The strip a lower-right target stands in: a full-width, one-handle-tall
 * band seated `bottom` px up the screen, above the floating slider rows'
 * own z-order. A positioning aid, not a surface — only the target circle
 * inside it takes touches. `animated` makes the seat ride at the floating
 * slot's pace (the tile targets, which follow the object-properties panel
 * exactly as the Flood/Close/Clear capsule does); the brush target's seat
 * never moves, so it does not.
 */
export function FloatingTargetStrip({ bottom, animated = false, children }: {
  bottom: number;
  animated?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom,
        transition: animated ? `bottom ${FLOATING_SLOT_ANIM_MS}ms ease` : undefined,
        height: CAPSULE_SIZE,
        zIndex: 205,
        pointerEvents: 'none',
      }}
    >
      {children}
    </div>
  );
}

export function SliderModeTarget({
  options, activeKey, onSelect, onOpenChildren, ringArt, badge, litKeys,
}: {
  options: SliderModeOption[];
  /** The mode currently driving the slider — its button wears the accent. */
  activeKey: string;
  onSelect: (key: string) => void;
  /** A release landed on a parent option: its second level should come up
   *  as a CAPSULE menu (the host renders it — at the top of the screen, or
   *  under the rig's Left/Right pill). The child fans are retired; the
   *  default child is still selected first, so the flick-and-release that
   *  never reads the capsule keeps landing the most natural move. */
  onOpenChildren?: (parentKey: string) => void;
  /** Art the COLLAPSED ring wears in the glyph's place (the tile radial's
   *  armed tile — tileRingArt): a dark-ink data-URI, turned to its pose.
   *  The fan's own buttons are untouched; this dresses only the closed
   *  ring, so the resting menu names what a touch will do. */
  ringArt?: { uri: string; rotate?: number } | null;
  /** A SETTING hung on the ring's edge (the brush's blend mode, whenever
   *  it is anything but Normal) — see {@link SliderModeBadge}. The ring's
   *  own glyph is untouched: it goes on naming what the slider drives, and
   *  the badge answers the other question the corner could not. Null — the
   *  resting case — hangs nothing. */
  badge?: SliderModeBadge | null;
  /** Options that are SWITCHES and currently on (the Color brush's
   *  Eraser): they wear the accent like the active mode does, since the
   *  one active key can only name what the slider drives. */
  litKeys?: readonly string[];
}) {
  const menuRef = useRef<CanvasRadialMenuRef | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const actions: RadialAction[] = options.map((o) => ({
    icon: o.icon,
    // The active mode's icon wears the accent at rest — a parent stands
    // for its whole second level, so it lights while any child mode is on;
    // the hover invert (CanvasRadialMenu's own) still wins while the
    // finger is on it.
    getColor: () => (sliderModeIsActive(o, activeKey) || litKeys?.includes(o.key) ? ACCENT_CYAN : TEXT_PRIMARY),
    // A level-1 option may wear art of its own, the way image children do —
    // the tile Choose button shows the ARMED tile so the menu names what a
    // touch will stamp. Undefined for glyph options, and the menu then
    // renders the icon.
    uri: o.uri,
    hoverUri: o.hoverUri,
    rotate: o.rotate,
  }));
  // A parent with children is a doorway: releasing on it picks its default
  // child — the part's most natural move — and raises the second level as
  // a capsule menu (onOpenChildren) for the finer picks. The old
  // hover-bloomed child fans are gone. An `openOnly` parent skips the pick
  // entirely — its second level CONFIRMS a setting (a color, a blend), and
  // auto-picking one would clobber what the user already has just for
  // opening the menu.
  //
  // `openOnly` also OPENS on its own, with no children to list: the Color
  // option's second level is one control (the hue row), not a menu of
  // picks, so there is nothing for it to fan — and a doorway that opened
  // only when it had children would leave that option with nowhere to go.
  const callbacks = options.map((o) => () => {
    if (!o.openOnly) onSelect(o.defaultChildKey ?? o.key);
    if (o.children || o.openOnly) onOpenChildren?.(o.key);
  });

  return (
    <>
      <div
        aria-label="Slider mode"
        role="button"
        onPointerDown={(e) => {
          // The fan radiates from the target's center — the hit point the
          // task of picking a mode begins at — whatever pixel of the circle
          // the finger landed on.
          const rect = e.currentTarget.getBoundingClientRect();
          setMenu({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
          // Capture so the drag keeps reporting as the finger leaves the
          // little circle on its way up the fan.
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (menu) menuRef.current?.updateDrag(e.clientX, e.clientY);
        }}
        onPointerUp={() => {
          menuRef.current?.releaseDrag();
        }}
        onPointerCancel={() => {
          menuRef.current?.releaseDrag();
        }}
        style={RING_STYLE}
      >
        {ringArt ? (
          // The armed tile's own art in the glyph's place — the fan
          // buttons' badge size, posed by its rotation.
          <img
            src={ringArt.uri}
            width={24}
            height={24}
            style={ringArt.rotate ? { transform: `rotate(${ringArt.rotate}deg)` } : undefined}
            alt=""
            draggable={false}
          />
        ) : (
          <MaterialCommunityIcons
            name={sliderModeIcon(options, activeKey) as never}
            size={FLOATING_CAPSULE_GLYPH_SIZE}
            color={FLOATING_CAPSULE_INK}
          />
        )}
        {badge ? (
          <div style={BADGE_STYLE}>
            <badge.Icon size={BADGE_GLYPH_SIZE} color={BADGE_INK} />
          </div>
        ) : null}
      </div>
      {menu && typeof document !== 'undefined' ? createPortal(
        <CanvasRadialMenu
          ref={menuRef}
          visible
          screenX={menu.x}
          screenY={menu.y}
          isLocked={false}
          actions={actions}
          actionCallbacks={callbacks}
          // Pinned corner fan: quarter spread on the default up-left base
          // angle — straight up round to straight left, the lower-right
          // corner's own 90°. The pin (`spread`) keeps the ROOT out of the
          // auto-rotating fitter; `bounds` is the screen the menu portals
          // over. No childActions: a parent's second level is the capsule
          // menu now (onOpenChildren), not a fan.
          bounds={{ width: window.innerWidth, height: window.innerHeight }}
          spread={RADIAL_QUARTER_SPREAD}
          menuZ={TARGET_MENU_Z}
          // The corner this fan opens over is the editor's most crowded —
          // the slider rows, the undo/redo column, the drawing itself — so
          // the menu drops its full-screen scrim while open: everything but
          // the options dims, fading in with the bloom and out with the
          // release (the wash rides the menu's own open/close opacity).
          scrim
          onClose={() => setMenu(null)}
        />,
        document.body,
      ) : null}
    </>
  );
}
