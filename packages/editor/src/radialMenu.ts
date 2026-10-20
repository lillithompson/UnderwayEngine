/**
 * Radial quick-action menu model: button geometry and the action sets for
 * the long-press menus on the editor canvas. Ported from Facet's
 * CanvasRadialMenu (geometry) and CompositionEditor (action sets); the
 * UI/animation half lives in components/CanvasRadialMenu.tsx, which
 * imports from here. Kept pure so the geometry is testable in node.
 */
import { TEXT_PRIMARY } from '@/engine/colors';

/** Diameter of each circular action button (screen px). */
export const BTN_SIZE = 44;
/** Distance from the press point to each button's center (screen px). */
export const RADIAL_DISTANCE = 120;
/** How much a button grows while the finger hovers it. */
export const HOVER_SCALE = 1.3;
/** Gap kept between a (hovered-size) button's edge and the viewport edge. */
export const RADIAL_EDGE_MARGIN = 8;
/** Direction the fan points by default: up and to the LEFT, at 45° from the
 *  press point.
 *
 *  A menu is raised by a finger, and a finger comes from below and to the
 *  right of what it is holding — a right hand's does, and the hand is on
 *  the screen while the menu is open. Fanning straight up put the middle
 *  buttons under the knuckles. Angling the fan into the upper-left corner
 *  turns it out from under the hand while keeping every button the same
 *  reach away.
 *
 *  Only the DEFAULT: a press with no room that way still rotates to
 *  wherever the fan fits (see {@link pickRadialBaseAngle}). */
export const RADIAL_BASE_ANGLE = -3 * Math.PI / 4;
/** Angular width of the fan: a half circle, so the buttons ride the arc
 *  from the press point's left round to its right rather than crowding a
 *  narrow wedge above it. */
export const RADIAL_SPREAD = Math.PI;
/** The quarter-circle spread a CORNER fan uses: a menu opened from the
 *  lower-right target (SliderModeTarget) fills exactly the 90° arc of that
 *  corner — from straight up round to straight left, centered on
 *  {@link RADIAL_BASE_ANGLE}'s up-left diagonal. */
export const RADIAL_QUARTER_SPREAD = Math.PI / 2;
/** Angular width of a SECOND-LEVEL fan: two thirds of the half circle the
 *  long-press menus use. Over the full 180°, a four-child fan's end
 *  buttons stood a quarter turn off the parent's own direction — right
 *  over the ROOT fan's neighbouring buttons — so a finger sliding out for
 *  the last child (the hand fan's wrist Bend) crossed a sibling root on
 *  the way and swapped fans instead of selecting. At 120° the children
 *  stay bunched on the parent's far side, clear of its siblings; a fuller
 *  set that would collide at this sweep grows its radius instead
 *  (radialDistanceFor), exactly as the pinned corner fan does. */
export const RADIAL_SUBMENU_SPREAD = (2 * Math.PI) / 3;

/** Granularity of the rotation search in `pickRadialBaseAngle` (3°). */
const RADIAL_ANGLE_STEP = Math.PI / 60;

/** Half-width of the screen box a button needs, hover growth included. */
export const RADIAL_BTN_CLEARANCE = (BTN_SIZE * HOVER_SCALE) / 2 + RADIAL_EDGE_MARGIN;

/** Stacking layer of the menu overlay. The fan blooms 120px around the
 *  press point, so it regularly reaches the edge-hugging capsule columns —
 *  it must paint OVER the undo/redo stack (zIndex 60) and the grid
 *  quick-action column (zIndex 100), both of which sit at the vertical
 *  center of the canvas where a long press most often lands. Still below
 *  the full-screen sheets (view settings 300, outline 400, instructions
 *  500), which replace the canvas rather than float over it. */
export const RADIAL_MENU_Z = 150;

/** The wash a SCRIM menu drops over the whole screen while its fan is
 *  open: dark enough to sink the crowded chrome underneath (slider rows,
 *  capsule columns, the drawing itself), translucent enough that the page
 *  stays legible as the place the menu floats over. The buttons paint on
 *  top, so they are the one bright thing left — the point of the scrim.
 *  Opt-in per menu (CanvasRadialMenu's `scrim`): the slider-mode fans
 *  (rig and raster paint) take it; the canvas long-press menus, whose
 *  press point IS on the drawing being edited, do not. */
export const RADIAL_SCRIM_COLOR = 'rgba(0,0,0,0.5)';

/** The area the fan must stay inside. `Viewport` satisfies this shape. */
export interface RadialBounds {
  width: number;
  height: number;
  topInset?: number;
  rightInset?: number;
  bottomInset?: number;
  leftInset?: number;
}

/** Whether there is a selection for a quick-action menu to act on: one
 *  object, or the 2+ members of a multi-selection — which carries a NULL
 *  `selectedId` (the members are the selection), so a plain `selectedId`
 *  check would neither open the menu on a combined box nor keep it open.
 *  The same predicate gates the open and closes the menu the moment it goes
 *  false, so the two can't disagree. */
export function hasRadialSelection(sel: {
  selectedId: string | null;
  selectedIds: readonly string[];
}): boolean {
  return !!sel.selectedId || sel.selectedIds.length >= 2;
}

export interface RadialAction {
  icon: string;
  activeIcon?: string;
  getColor: (isLocked: boolean) => string;
  /** A SWATCH button (the paint menu's recent colors): its color IS the
   *  content, so the hover invert brightens the button behind it but never
   *  repaints the glyph — a hovered red swatch must stay red. */
  swatch?: boolean;
  /** An IMAGE button (the tile Choose fan): a data-URI drawn in the
   *  glyph's place. `hoverUri` swaps in under the hover invert — the
   *  button ground lightens, so the art re-inks dark — and `rotate` turns
   *  the image (degrees CW), so a posed tile draws its pose. */
  uri?: string;
  hoverUri?: string;
  rotate?: number;
}

// Actions for the normal long-press radial menu. The two z-order moves
// lead: they have no panel button at all and are the menu's own reason to
// exist for an object buried under another, so they get the first reach.
// Behind them come the properties panel's copy / lock / delete — same
// handlers, same icons — so the menu is also that panel's quick form under
// the finger. Plain up/down arrows say which way the object travels in the
// stack more directly than the layered-rectangle glyphs did.
export const DEFAULT_RADIAL_ACTIONS: RadialAction[] = [
  {
    icon: 'arrow-up',
    getColor: () => TEXT_PRIMARY,
  },
  {
    icon: 'arrow-down',
    getColor: () => TEXT_PRIMARY,
  },
  {
    icon: 'content-copy',
    getColor: () => TEXT_PRIMARY,
  },
  {
    icon: 'lock-open-outline',
    activeIcon: 'lock',
    getColor: () => TEXT_PRIMARY,
  },
  {
    icon: 'delete-outline',
    getColor: () => TEXT_PRIMARY,
  },
];

export const DEFAULT_LOCK_ACTION_INDEX = 3;

// Actions for the super long press (punch-through) radial menu.
// Order: duplicate, unlock, delete.
export const SUPER_RADIAL_ACTIONS: RadialAction[] = [
  { icon: 'content-copy', getColor: () => TEXT_PRIMARY },
  { icon: 'lock', getColor: () => '#FFFFFF' },
  { icon: 'delete-outline', getColor: () => TEXT_PRIMARY },
];

/** Closest two button centers may sit, in screen px: the button itself plus
 *  a thumb-sized gap, so neighbours stay separately hittable (and don't
 *  collide when one grows under the finger). */
export const RADIAL_MIN_CENTER_GAP = BTN_SIZE + 12;

/**
 * The fan a menu of `n` buttons actually sweeps, given the one it was
 * asked for. Two buttons over the whole arc sit at its far ends with a
 * hole between them — they read as two unrelated targets rather than a
 * pair to choose between, and the finger has to travel the long way to
 * change its mind. Two get HALF the arc; three or more get all of it.
 *
 * Only for a menu that PINS its fan (the slider-mode target's corner
 * quarter — see CanvasRadialMenu's `spread`). A menu that picks its own
 * sweep from the press point passes `undefined` through untouched.
 */
export function radialSpreadFor(n: number, spread?: number): number | undefined {
  return spread !== undefined && n === 2 ? spread / 2 : spread;
}

/**
 * The arc a fan of `n` buttons rides on. {@link RADIAL_DISTANCE} whenever
 * the buttons already clear each other on it, and pushed out just far
 * enough when they wouldn't — a fuller menu grows its circle rather than
 * widening its sweep, which would swing the end buttons past the
 * horizontal and make the fan much harder to fit beside a screen edge.
 *
 * At the half-circle spread every menu the editor offers (up to six
 * buttons) already clears at exactly RADIAL_DISTANCE, so the push-out is
 * headroom for a longer set rather than something today's menus hit.
 */
export function radialDistanceFor(n: number, spread: number = RADIAL_SPREAD): number {
  return Math.max(RADIAL_DISTANCE, radialMinDistanceFor(n, spread));
}

/** The tightest arc `n` buttons can ride without colliding — the floor the
 *  fan may be pulled in to when the viewport is too narrow for the full
 *  {@link RADIAL_DISTANCE}. A half-circle fan is 2·R across whichever way
 *  it rotates, so on a phone the roomy default only fits a press near the
 *  horizontal middle; rather than fling buttons off-screen where the
 *  finger can never reach them, {@link radialDistanceIn} draws the whole
 *  fan in toward the thumb until it fits or hits this floor. */
export function radialMinDistanceFor(n: number, spread: number = RADIAL_SPREAD): number {
  if (n < 2) return RADIAL_DISTANCE;
  // Chord between adjacent centers is 2·R·sin(Δθ/2); solve it for R.
  const half = spread / (n - 1) / 2;
  const chordPerPx = 2 * Math.sin(half);
  if (chordPerPx <= 0) return RADIAL_DISTANCE;
  return RADIAL_MIN_CENTER_GAP / chordPerPx;
}

/** Button-center offsets from the press point: `n` buttons spread over
 *  {@link RADIAL_SPREAD} on the arc {@link radialDistanceFor} picks,
 *  centered on `baseAngle` (straight up unless the fan had to rotate to
 *  stay on screen). */
export function getRadialOffsets(
  n: number,
  baseAngle: number = RADIAL_BASE_ANGLE,
  distance: number = radialDistanceFor(n),
  spread: number = RADIAL_SPREAD,
): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => {
    // A lone button sits on the base angle itself — the spread step below
    // would divide by zero.
    const angle = n === 1
      ? baseAngle
      : baseAngle + (i - (n - 1) / 2) * (spread / (n - 1));
    return {
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
    };
  });
}

/** Absolute button centers for a menu opened at `(screenX, screenY)`. */
export function getRadialCenters(
  screenX: number,
  screenY: number,
  n: number,
  baseAngle: number = RADIAL_BASE_ANGLE,
  distance: number = radialDistanceFor(n),
  spread: number = RADIAL_SPREAD,
): { x: number; y: number }[] {
  return getRadialOffsets(n, baseAngle, distance, spread).map((off) => ({
    x: screenX + off.x,
    y: screenY + off.y,
  }));
}

/** Total px by which the fan's buttons stick out past `bounds` (0 = the
 *  whole menu fits). Summed over every button and every edge, so it also
 *  ranks bad-but-less-bad rotations when nothing fits. */
export function radialFanOverflow(
  screenX: number,
  screenY: number,
  n: number,
  bounds: RadialBounds,
  baseAngle: number,
  distance: number = radialDistanceFor(n),
  spread: number = RADIAL_SPREAD,
): number {
  const minX = (bounds.leftInset ?? 0) + RADIAL_BTN_CLEARANCE;
  const maxX = bounds.width - (bounds.rightInset ?? 0) - RADIAL_BTN_CLEARANCE;
  const minY = (bounds.topInset ?? 0) + RADIAL_BTN_CLEARANCE;
  const maxY = bounds.height - (bounds.bottomInset ?? 0) - RADIAL_BTN_CLEARANCE;
  let total = 0;
  for (const c of getRadialCenters(screenX, screenY, n, baseAngle, distance, spread)) {
    total += Math.max(0, minX - c.x) + Math.max(0, c.x - maxX)
      + Math.max(0, minY - c.y) + Math.max(0, c.y - maxY);
  }
  return total;
}

/** The angle to center the fan on so every button stays inside `bounds`.
 *  Straight up whenever that already fits; otherwise the smallest
 *  rotation away from it that does, searched outward in 3° steps in both
 *  directions. If nothing fits (a press cornered in a tiny viewport) the
 *  least-overflowing angle wins, so the menu degrades instead of
 *  vanishing off-screen. */
export function pickRadialBaseAngle(
  screenX: number,
  screenY: number,
  n: number,
  bounds?: RadialBounds | null,
  distance: number = radialDistanceFor(n),
  spread: number = RADIAL_SPREAD,
): number {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return RADIAL_BASE_ANGLE;

  let best = RADIAL_BASE_ANGLE;
  let bestOverflow = radialFanOverflow(screenX, screenY, n, bounds, best, distance, spread);
  if (bestOverflow <= 0) return best;

  const steps = Math.ceil(Math.PI / RADIAL_ANGLE_STEP);
  for (let k = 1; k <= steps; k++) {
    for (const dir of [1, -1]) {
      const angle = RADIAL_BASE_ANGLE + dir * k * RADIAL_ANGLE_STEP;
      const overflow = radialFanOverflow(screenX, screenY, n, bounds, angle, distance, spread);
      if (overflow < bestOverflow - 1e-9) {
        best = angle;
        bestOverflow = overflow;
        if (overflow <= 0) return best;
      }
    }
  }
  return best;
}

/** How many radii the fit search tries between the roomy default and the
 *  no-overlap floor. Eight steps put the coarsest jump under 4px on a
 *  phone — finer than the eye reads — and the whole search runs once per
 *  menu open, never per frame. */
const RADIAL_DISTANCE_STEPS = 8;

/**
 * Where to hang a fan of `n` buttons pressed at (screenX, screenY): the
 * roomiest arc that fits `bounds`, and the rotation that fits it there.
 *
 * The half-circle spread makes the fan 2·R wide however it turns, so on a
 * phone the full {@link RADIAL_DISTANCE} only fits a press near the
 * horizontal middle. Rather than let buttons fly off-screen where no
 * finger can reach them, the search walks the radius in from the default
 * toward {@link radialMinDistanceFor} — the tightest arc that still keeps
 * the buttons apart — and takes the first radius some rotation fits at.
 * A press jammed against an edge admits no fit at any radius; there the
 * default distance and its least-overflowing angle win, so the menu
 * degrades exactly as it did before instead of vanishing.
 */
export function radialFanLayout(
  screenX: number,
  screenY: number,
  n: number,
  bounds?: RadialBounds | null,
  spread: number = RADIAL_SPREAD,
): { distance: number; baseAngle: number } {
  const full = radialDistanceFor(n, spread);
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return { distance: full, baseAngle: RADIAL_BASE_ANGLE };
  }
  const floor = Math.min(full, radialMinDistanceFor(n, spread));
  for (let k = 0; k <= RADIAL_DISTANCE_STEPS; k++) {
    const distance = full - ((full - floor) * k) / RADIAL_DISTANCE_STEPS;
    const baseAngle = pickRadialBaseAngle(screenX, screenY, n, bounds, distance, spread);
    if (radialFanOverflow(screenX, screenY, n, bounds, baseAngle, distance, spread) <= 0) {
      return { distance, baseAngle };
    }
  }
  return {
    distance: full,
    baseAngle: pickRadialBaseAngle(screenX, screenY, n, bounds, full, spread),
  };
}

/** Which button (index into `centers`) the point lands on, or -1. */
export function hitTestRadial(
  locX: number,
  locY: number,
  centers: { x: number; y: number }[],
): number {
  const r = BTN_SIZE / 2;
  for (let i = 0; i < centers.length; i++) {
    const dx = locX - centers[i].x;
    const dy = locY - centers[i].y;
    if (dx * dx + dy * dy < r * r) return i;
  }
  return -1;
}

// ── Second-level fans ────────────────────────────────────────────────
// A radial option may lead to MORE radial options: the moment the finger
// hovers it, its children bloom from that button's own center, laid out by
// the quick-action rules above (half-circle spacing, the up-left default
// angle, radialFanLayout's edge avoidance) — even when the root fan was
// pinned to a corner quarter, since the parent button can sit anywhere on
// screen. Not every option has children — the ones that do behave exactly
// like a fresh menu one level out.

/** What the non-selected LEVEL-1 buttons fade to while a second level is
 *  open: present enough to slide onto (they stay live targets — though a
 *  guarded one must be DWELT on to steal, see siblingStealsInstantly), dim
 *  enough that the bloomed children read as the menu now. */
export const RADIAL_DIMMED_OPACITY = 0.1;

export type RadialSubmenuHit =
  | { kind: 'child'; index: number }
  | { kind: 'root'; index: number }
  | { kind: 'parent' }
  | { kind: 'none' };

/**
 * Hit-test while a submenu is open: the CHILDREN own the finger first (they
 * bloomed nearest it and may overlap their aunts), then the OTHER root
 * buttons (sliding to a sibling abandons this submenu for that option).
 * The parent's own disc reports as 'parent' — it keeps the submenu open
 * exactly like the gap does, but the component reads it as the finger
 * coming home to level one (which unpins the fan, see below). Empty space
 * is 'none'.
 */
export function hitTestRadialWithSubmenu(
  locX: number,
  locY: number,
  rootCenters: { x: number; y: number }[],
  subCenters: { x: number; y: number }[],
  parentIndex: number,
): RadialSubmenuHit {
  const child = hitTestRadial(locX, locY, subCenters);
  if (child >= 0) return { kind: 'child', index: child };
  const root = hitTestRadial(locX, locY, rootCenters);
  if (root === parentIndex) return { kind: 'parent' };
  if (root >= 0) return { kind: 'root', index: root };
  return { kind: 'none' };
}

// ── Guards against accidental fan swaps ──────────────────────────────
// The children bloom RADIAL_DISTANCE around their parent, but the sibling
// roots sit only a finger-gap apart on the root arc — so a finger arcing
// BETWEEN two children (or overshooting one) clips a sibling's disc on the
// way and swapped the whole fan mid-selection. The deliberate switch has a
// different signature: the finger slides ALONG the root arc, parent to
// neighbour, never leaving the arc band and never touching a child. Three
// guards tell the two apart:
//
//  1. ADJACENCY — only the parent's arc neighbours (index ±1) can EVER
//     steal: a non-adjacent sibling never takes the fan, not instantly and
//     not by dwelling (the dwell used to let any parked-on sibling steal,
//     and a slow arc between two children read as "parked" on a disc three
//     buttons over — the jump this rules out for good). A deliberate slide
//     passes through neighbours one at a time anyway (each hop
//     re-parents), so the whole arc stays reachable.
//  2. ENGAGEMENT PIN — once the finger has engaged level two (hovered any
//     child, or travelled beyond the root arc band toward the children,
//     hasDepartedRootArc) even the neighbours lose instant steal. Coming
//     home to rest on the PARENT's own disc unpins: release commits in
//     these menus, so re-touching the parent is the deliberate "back to
//     level one" gesture, not a lift-and-press-again.
//  3. DWELL — a guarded NEIGHBOUR can still be chosen by PARKING on it for
//     RADIAL_SIBLING_DWELL_MS. An accidental crossing is moving and brief;
//     a parked finger is intent. The neighbour brightens from its dim
//     while the dwell charges, and release over it still fires it at once
//     (the menu's release-over-a-button contract holds either way).

/** How long a guarded sibling root must be held under the finger before it
 *  steals the fan. Long enough that an arcing crossing (well under 150ms
 *  over a 44px disc) never trips it; short enough that a parked finger
 *  isn't kept waiting. */
export const RADIAL_SIBLING_DWELL_MS = 250;

/** How far past the root arc the finger must travel before it counts as
 *  having LEFT level one for the children: a full button diameter, which
 *  clears the hover-grown disc (~29px past the arc) plus finger wobble. */
export const RADIAL_ARC_DEPART_SLACK = BTN_SIZE;

/** Whether the finger has moved up and away from the first-level arc —
 *  further from the menu origin than the arc the root buttons ride, by
 *  more than {@link RADIAL_ARC_DEPART_SLACK}. Child territory: the
 *  component pins the open submenu once this trips. */
export function hasDepartedRootArc(
  locX: number,
  locY: number,
  originX: number,
  originY: number,
  rootDistance: number,
): boolean {
  return Math.hypot(locX - originX, locY - originY)
    > rootDistance + RADIAL_ARC_DEPART_SLACK;
}

/** Whether two first-level indices sit side by side on the root arc — the
 *  ONLY siblings allowed to trade the fan at all. A non-adjacent sibling
 *  is inert while a submenu is open: reaching it takes hopping through
 *  the neighbours (each hop re-parents) or coming home to the parent
 *  first, never a jump. */
export function radialSiblingsAdjacent(
  parentIndex: number,
  siblingIndex: number,
): boolean {
  return Math.abs(siblingIndex - parentIndex) === 1;
}

/** Whether a sibling root hit swaps the fan the moment it is touched:
 *  only an arc NEIGHBOUR of the parent ({@link radialSiblingsAdjacent}),
 *  and only while the fan is not pinned by second-level engagement. A
 *  pinned neighbour must earn the swap by dwelling
 *  ({@link RADIAL_SIBLING_DWELL_MS}); a non-neighbour never gets it. */
export function siblingStealsInstantly(
  parentIndex: number,
  siblingIndex: number,
  pinned: boolean,
): boolean {
  return !pinned && radialSiblingsAdjacent(parentIndex, siblingIndex);
}
