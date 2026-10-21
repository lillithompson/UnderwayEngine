import { BASE_CELL_PX } from './cameraMath';
import type { EditableRegion } from './editableRegion';
import type { WorldTransform } from './symmetryAxesScreen';

// The editable region's chrome, in SCREEN space (docs/social_game_spec.md
// §7.3): a grey veil over everything that is not the turn's, a dotted
// line on the midline, and green circles on the connection points — all drawn in
// the same viewport-sized <svg> as the paint veil and the symmetry axes,
// re-anchored through the camera on every pan/zoom frame (applyLiveCamera)
// and never as React state. A world-space overlay crashed WKWebView once
// (§1.3); nothing here widens the world layer.

/** The veil's fill over everything that is not yours. */
export const REGION_VEIL_FILL = 'rgba(120,124,128,0.55)';
/** The midline's ink. */
export const MIDLINE_COLOR = 'rgba(40,40,40,0.7)';
/** The midline's dash period, screen px. */
export const MIDLINE_DASH_PX = 8;

/**
 * The BOARD's outline (§7.3): the edge of the whole creature — every
 * part of it, yours and the ones still to be drawn — in the dividing
 * lines' own ink, solid where they are dotted.
 *
 * The same ink because the two say one kind of thing: this is where the
 * game is. Solid and a shade heavier because they say opposite halves of
 * it — a dotted line is a seam between parts, an unbroken frame is the
 * end of the board, and neither should be mistaken for the other. It is
 * drawn OVER the veil as well as over your own clear band, so what a
 * turn sees is the whole creature's ground with its own part cut out of
 * the grey, rather than a clear strip and grey going on for ever.
 */
export const BOARD_OUTLINE_COLOR = MIDLINE_COLOR;
export const BOARD_OUTLINE_WIDTH = 2;

/**
 * …and OUTSIDE that frame the screen goes darker still (§7.3): the veil
 * greys the parts of the creature that are not this turn's, and the same
 * grey ran on past the board's edge over paper that is not the game at
 * all. Two different things were being said in one shade — *somebody
 * else is drawing here* and *there is nothing here* — so the second is
 * said darker.
 *
 * A black mask at {@link OUTSIDE_DARKEN} over whatever is already there,
 * which is what "30% darker" IS: black at alpha a leaves (1 − a) of what
 * it covers, so 0.3 leaves 0.7 of the shading inside the board. Written
 * as the factor rather than as a second grey, so it stays true if the
 * veil's own colour is ever changed.
 */
export const OUTSIDE_DARKEN = 0.3;
export const OUTSIDE_MASK_FILL = `rgba(0,0,0,${OUTSIDE_DARKEN})`;
/**
 * The TARGETS (UX §4.1): every grid point of the line a turn must connect
 * on, drawn as a faint dot before anything is drawn there. A connection
 * is a line END on one of these points, and the rule was invisible until
 * a turn was refused for it — the dots put where a line can land on the
 * board from the start. Faint and small, in the dividing line's own ink,
 * so they read as part of the line rather than as green points owed.
 */
export const TARGET_RADIUS_PX = 2.5;
export const TARGET_FILL = 'rgba(40,40,40,0.35)';

/** A connection point's radius, screen pt. */
export const MARKER_RADIUS_PX = 6;

/** A connection point's ink: green while all is well. */
export const MARKER_FILL = '#2E9E5B';

/**
 * …and RED, for a point the game has just refused you over (§7.3): press
 * *I'm Done* with a point of the move before still not carried on, and
 * the notice says how many are left — but not WHICH, and on a board you
 * may be zoomed into, "one left" is a hunt. The point the notice is
 * about says so itself: it turns red and pops once where it stands —
 * the very pop a connection gets ({@link MARKER_POP_ANIMATION}), so the
 * game has one gesture for *look here* rather than two — and the camera
 * glides over to it (EditorShell's `revealRect`). It STAYS red after the
 * pop: the colour is the standing debt, the pop is the press that just
 * named it. Connect a line to it and it is met like any other point —
 * green again, with the pop that answers every connection.
 */
export const MARKER_FLAG_FILL = '#D93B30';

/** How long a NEW connection point's pop runs, ms (§7.3). */
export const MARKER_POP_MS = 340;

/** The pop itself: the circle arrives small, overshoots and settles. A
 *  green point is the news this game gives you while you draw, and it
 *  comes two ways: one APPEARS — the line you just ended connected, and
 *  the next player has something to carry on from — or one that was
 *  waiting for you is MET, the line the move before left you now picked
 *  up. Either is a thing that just happened, and a dot that simply sits
 *  there on the next frame says neither. Both are announced the way the
 *  app announces everything else it has accepted: a small spring and a
 *  tap on the finger.
 *
 *  Scaled about the circle's own centre (`transform-box: fill-box`), so
 *  it stays put as the camera re-anchors it mid-pop — the alternative,
 *  a transform-origin in user units, would have to be rewritten on every
 *  camera frame alongside cx/cy. One compositor keyframe and no JS per
 *  frame (the 90 fps rule). */
export const MARKER_POP_ANIMATION = 'cj-region-marker-pop';
export const MARKER_POP_KEYFRAMES = `@keyframes ${MARKER_POP_ANIMATION} {
  0% { transform: scale(0.2); }
  55% { transform: scale(1.5); }
  78% { transform: scale(0.92); }
  100% { transform: scale(1); }
}`;

/**
 * The pop as a circle wears it — the one shorthand both the points that
 * announce themselves and the points a refusal NAMES are written with.
 *
 * A flagged point used to hop in place for ever instead, which put a
 * second, private vocabulary on the board — one animation for *this
 * happened*, another for *this is owed* — and left something moving on
 * screen for as long as the debt stood. One gesture says it better: the
 * point swells and settles exactly as a connection does, and the red it
 * keeps afterwards is the debt. Pressing *I'm Done* again pops it again
 * (the flag carries the press; see {@link RegionMarker.flagged}), so the
 * answer to *which one?* is always one press away.
 */
export const MARKER_POP_STYLE = `${MARKER_POP_ANIMATION} ${MARKER_POP_MS}ms ease-out both`;

/**
 * A connection point as the chrome draws it: where it is, and whether a
 * line of THIS turn's ends on it (§7.3). The points the move before left
 * for you arrive unmet and turn met as you connect to them; the ones you
 * make for the next player are met from birth — you drew them.
 */
export interface RegionMarker {
  x: number;
  y: number;
  met: boolean;
  /** The point a refused *I'm Done* was ABOUT: still not carried on when
   *  the turn tried to end (socialRules.creatureDoneRule). Red until it
   *  is met, then green like any other. Only ever set on an unmet point
   *  — meeting it is what takes the flag off.
   *
   *  The value is the PRESS that named it (EditorShell's `refusedPoints`
   *  key, the same one the camera flies on), not a bare `true`: a second
   *  refusal over a point already red has to pop it again, and only a
   *  changed value tells the writer that a new press asked. */
  flagged?: string;
}

/** A point's identity among the markers — what a circle is reused by, so
 *  a point that was already on the line keeps its element (and does not
 *  re-pop) when another appears BEFORE it in the sorted list. Rounded to
 *  a thousandth of a cell: these are grid points, and the float they
 *  arrive as has been through a rotate and a snap.
 *
 *  `met` is part of the identity, not a dressing on it: connecting to a
 *  point is the other piece of news this game gives you while you draw,
 *  and a changed key is what retires the old circle and mints one that
 *  pops (see {@link writeRegionChrome}). */
export function markerKey(x: number, y: number, met: boolean): string {
  return `${Math.round(x * 1000)},${Math.round(y * 1000)},${met ? 1 : 0}`;
}

/**
 * The markers with a refused *I'm Done*'s points flagged on them
 * (EditorShell's `refusedPoints`). A named connection point is flagged by
 * POINT, at {@link markerKey}'s rounding, and only while still unmet: one
 * picked up since the refusal is simply a green point again.
 *
 * A named point that is no connection point at all — a line END that fell
 * short of the dotted line (socialRules.nearMissEnds, UX §4.1) — is added
 * as a red point where it lies, but only while the scene is still the one
 * that was refused (`drawingNow === refused.drawing` — the scene's
 * `svgObjects`, which a selection or a camera move leaves as it was, so
 * only an edit to the drawing clears it): nothing can *meet* an
 * end, so the edit that answers the refusal is what takes it away.
 */
export function flagRefusedMarkers(
  all: readonly RegionMarker[],
  refused: { points: readonly { x: number; y: number }[]; key: string; drawing: unknown },
  drawingNow: unknown,
): RegionMarker[] {
  const flags = new Set(refused.points.map((pt) => markerKey(pt.x, pt.y, false)));
  const flagged = all.map((m) => (
    !m.met && flags.has(markerKey(m.x, m.y, false))
      ? { ...m, flagged: refused.key } : m
  ));
  if (drawingNow !== refused.drawing) return flagged;
  const known = new Set(all.map((m) => markerKey(m.x, m.y, false)));
  const extra = refused.points
    .filter((pt) => !known.has(markerKey(pt.x, pt.y, false)))
    .map((pt) => ({ x: pt.x, y: pt.y, met: false, flagged: refused.key }));
  return extra.length > 0 ? [...flagged, ...extra] : flagged;
}

const sy = (t: WorldTransform, cellY: number): number => t.translateY + cellY * BASE_CELL_PX * t.scale;
const sx = (t: WorldTransform, cellX: number): number => t.translateX + cellX * BASE_CELL_PX * t.scale;

/**
 * The veil's path: everything in view that is NOT this turn's band —
 * the view's rectangle with the band punched out of it (`fill-rule:
 * evenodd`, set on the element once).
 *
 * The band is a finite board now (creatureGeometry: 8 × 12 grid squares,
 * each move 8 × 6 of them or 8 × 4), so "not yours" has four sides and
 * the grey has to have them too: above the band, below it, and — this is
 * the new half — the paper to either side of the page, which a player
 * could once pan to and draw on for ever. What the clamp refuses and
 * what the veil greys are read off the same rect, so they cannot
 * disagree anywhere.
 *
 * A band with no sides (`xMin`/`xMax` absent) greys full-width strips
 * above and below itself, which is what the two-rectangle version did.
 *
 * It was the page's rectangle minus the band for a while, which put an
 * edge where the drawing ends: zoomed out you saw a shaded oblong
 * floating on clear canvas rather than a half of the world greyed off.
 * The veil still reaches the view's edges for that reason — it is the
 * BAND that is bounded, not the grey.
 *
 * The outside MASK is this same shape with the board in place of the
 * band ({@link OUTSIDE_MASK_FILL}) — everything in view that is not the
 * game, punched to the very rect the outline is stroked on, so the dark
 * cannot begin anywhere but at that line.
 *
 * Empty when the scale is not positive.
 */
export function regionVeilPath(
  region: EditableRegion,
  t: WorldTransform,
  view: { width: number; height: number },
): string {
  if (!(t.scale > 0)) return '';
  const top = sy(t, region.yMin);
  const bottom = sy(t, region.yMax);
  const left = region.xMin === undefined ? 0 : sx(t, region.xMin);
  const right = region.xMax === undefined ? view.width : sx(t, region.xMax);
  return `M0 0H${view.width}V${view.height}H0Z`
    + `M${left} ${top}H${right}V${bottom}H${left}Z`;
}

/**
 * The board's rect through the camera — what the outline is stroked on.
 * Null when the scale is not positive, as the rest of the chrome is.
 *
 * Not clipped to the view: a stroked rect that runs off the screen runs
 * off the screen, and the two edges still in view are the two edges the
 * player can see. Clamping it would put a line where the board does not
 * end, which is the one thing this frame must never say.
 */
export function boardOutlineRect(
  board: { xMin: number; xMax: number; yMin: number; yMax: number },
  t: WorldTransform,
): { x: number; y: number; width: number; height: number } | null {
  if (!(t.scale > 0)) return null;
  const x = sx(t, board.xMin);
  const y = sy(t, board.yMin);
  return { x, y, width: sx(t, board.xMax) - x, height: sy(t, board.yMax) - y };
}

/** The midline as one screen-space segment across the view, or null when
 *  it is off screen. `dashOffset` phases the dashes to the world's x = 0
 *  so they stick to the page while the view moves. */
export function midlineSegment(
  view: { width: number; height: number },
  cellY: number,
  t: WorldTransform,
): { x1: number; y1: number; x2: number; y2: number; dashOffset: number } | null {
  if (!(t.scale > 0)) return null;
  const y = sy(t, cellY);
  if (y < -1 || y > view.height + 1) return null;
  const phase = ((-sx(t, 0)) % MIDLINE_DASH_PX + MIDLINE_DASH_PX) % MIDLINE_DASH_PX;
  return { x1: 0, y1: y, x2: view.width, y2: y, dashOffset: phase };
}

/** World points through the camera, for the marker circles. */
export function markerScreenPoints(
  points: readonly RegionMarker[],
  t: WorldTransform,
): { cx: number; cy: number }[] {
  if (!(t.scale > 0)) return [];
  return points.map((m) => ({ cx: sx(t, m.x), cy: sy(t, m.y) }));
}

/**
 * Play `animation` on an element that may already be wearing it. Writing
 * the same shorthand a second time is a no-op to the browser — the
 * animation carries on where it was — and a point named by a SECOND
 * refusal has to pop again, so the running one is cleared and flushed
 * (reading a layout box is what makes the clear take effect) before the
 * new one is set. Once per refusal press, never on a camera frame.
 */
function restartAnimation(el: SVGElement, animation: string): void {
  el.style.animation = 'none';
  (el as { getBoundingClientRect?: () => unknown }).getBoundingClientRect?.();
  el.style.animation = animation;
}

/** Write the chrome into its group: the veil path, the midline and the
 *  markers, as attributes on elements minted once. Called per camera
 *  frame and per render, never through React state.
 *
 *  Returns how many connection points are NEWS — made by this call, or
 *  connected to by it, and therefore popping. Zero on a camera frame,
 *  which is what lets the caller ring the haptic exactly once per point
 *  however many writers run: the first one to see the point mints it,
 *  and every writer after that finds it already there (§7.3). */
export function writeRegionChrome(
  group: SVGGElement | null,
  view: { width: number; height: number },
  t: WorldTransform,
  chrome: {
    region: EditableRegion;
    /** The band's dividing lines, world cells: the one above it, the one
     *  below it, or both (§7.3a). Each gets its own dashed line, kept in
     *  place across renders the way the markers are. */
    midlineYs: readonly number[];
    markers: readonly RegionMarker[];
    veil: boolean;
    /** The whole board, outlined over the veil as well as over the band
     *  (creatureGeometry.creatureBoard). Absent on a region that is a
     *  pair of lines across an open canvas rather than a board. */
    board?: { xMin: number; xMax: number; yMin: number; yMax: number };
    /** World points drawn as faint target dots ({@link TARGET_FILL}) —
     *  the grid points of the line a turn connects on. */
    targets?: readonly [number, number][];
  } | null,
): number {
  if (!group) return 0;
  if (chrome === null) {
    if (group.childNodes.length > 0) group.replaceChildren();
    return 0;
  }
  const ns = 'http://www.w3.org/2000/svg';
  let veil = group.querySelector<SVGPathElement>('path[data-region-veil]');
  if (!veil) {
    veil = document.createElementNS(ns, 'path');
    veil.setAttribute('data-region-veil', '');
    veil.setAttribute('fill', REGION_VEIL_FILL);
    veil.setAttribute('fill-rule', 'evenodd');
    group.appendChild(veil);
  }
  veil.setAttribute('d', chrome.veil ? regionVeilPath(chrome.region, t, view) : '');
  // …and outside the board, the dark over the top of that grey: the same
  // punched shape with the BOARD as its hole, so the paper that is not
  // the game at all reads as a different thing from the parts of the
  // creature somebody else is drawing.
  let outside = group.querySelector<SVGPathElement>('path[data-region-outside]');
  if (!outside) {
    outside = document.createElementNS(ns, 'path');
    outside.setAttribute('data-region-outside', '');
    outside.setAttribute('fill', OUTSIDE_MASK_FILL);
    outside.setAttribute('fill-rule', 'evenodd');
    veil.after(outside);
  }
  outside.setAttribute('d', chrome.board === undefined ? '' : regionVeilPath(chrome.board, t, view));
  // The board's frame, minted straight after the two of them so it is
  // drawn ON them: the outline runs round the grey the next players will
  // draw in just as it runs round the clear band that is yours, and the
  // dark stops at it rather than over it. Kept (hidden) rather than
  // removed when there is no board, so the one element holds its place in
  // front of the veil and behind the lines and points.
  let frame = group.querySelector<SVGRectElement>('rect[data-region-board]');
  if (!frame) {
    frame = document.createElementNS(ns, 'rect');
    frame.setAttribute('data-region-board', '');
    frame.setAttribute('fill', 'none');
    frame.setAttribute('stroke', BOARD_OUTLINE_COLOR);
    frame.setAttribute('stroke-width', String(BOARD_OUTLINE_WIDTH));
    outside.after(frame);
  }
  const box = chrome.board === undefined ? null : boardOutlineRect(chrome.board, t);
  if (box === null) {
    frame.setAttribute('visibility', 'hidden');
  } else {
    frame.removeAttribute('visibility');
    frame.setAttribute('x', String(box.x));
    frame.setAttribute('y', String(box.y));
    frame.setAttribute('width', String(box.width));
    frame.setAttribute('height', String(box.height));
  }
  // One <line> per dividing line, minted once and reused — a band with a
  // line on each side of it (a three-move Creature's middle) draws two.
  const lines = group.querySelectorAll<SVGLineElement>('line[data-region-midline]');
  for (let i = lines.length - 1; i >= chrome.midlineYs.length; i--) lines[i].remove();
  chrome.midlineYs.forEach((cellY, i) => {
    let line = lines[i];
    if (!line) {
      line = document.createElementNS(ns, 'line');
      line.setAttribute('data-region-midline', '');
      line.setAttribute('stroke', MIDLINE_COLOR);
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('stroke-dasharray', `${MIDLINE_DASH_PX / 2} ${MIDLINE_DASH_PX / 2}`);
      group.appendChild(line);
    }
    const seg = midlineSegment(view, cellY, t);
    if (seg === null) {
      line.setAttribute('visibility', 'hidden');
      return;
    }
    line.removeAttribute('visibility');
    line.setAttribute('x1', String(seg.x1));
    line.setAttribute('y1', String(seg.y1));
    line.setAttribute('x2', String(seg.x2));
    line.setAttribute('y2', String(seg.y2));
    line.setAttribute('stroke-dashoffset', String(seg.dashOffset));
  });
  // The targets: one <g> minted once after the lines (so the connection
  // points, appended below, sit on top of them) and its dots reused by
  // position — they never pop, so nothing rides on which element is which.
  // Minted only once there are targets to hold, so a region without them
  // draws exactly what it always did.
  const want = chrome.targets ?? [];
  let targets = group.querySelector<SVGGElement>('g[data-region-targets]');
  if (!targets && want.length > 0) {
    targets = document.createElementNS(ns, 'g');
    targets.setAttribute('data-region-targets', '');
    targets.setAttribute('fill', TARGET_FILL);
    group.appendChild(targets);
  }
  const dots = targets ? Array.from(targets.children) : [];
  for (let i = dots.length - 1; i >= want.length; i--) dots[i].remove();
  for (let i = dots.length; i < want.length; i++) {
    const d = document.createElementNS(ns, 'circle');
    d.setAttribute('r', String(TARGET_RADIUS_PX));
    targets!.appendChild(d);
    dots.push(d);
  }
  want.forEach(([x, y], i) => {
    dots[i].setAttribute('cx', String(sx(t, x)));
    dots[i].setAttribute('cy', String(sy(t, y)));
  });
  // The markers, reused BY POINT rather than by position in the list.
  // They were positional, and the list is sorted by x: a point made to
  // the LEFT of one already there shifted every circle down a slot, so
  // the last one read as new and popped while the point that had really
  // just been made kept an old element and did not. Keyed, the elements
  // follow their points and only a genuinely new point mints one.
  const held = new Map<string, SVGCircleElement>();
  const existing = group.querySelectorAll<SVGCircleElement>('circle[data-region-marker]');
  for (let i = 0; i < existing.length; i++) {
    held.set(existing[i].getAttribute('data-region-marker') ?? '', existing[i]);
  }
  const pts = markerScreenPoints(chrome.markers, t);
  let fresh = 0;
  chrome.markers.forEach((m, i) => {
    const key = markerKey(m.x, m.y, m.met);
    const p = pts[i];
    if (p === undefined) return;
    let c = held.get(key);
    if (c) {
      held.delete(key);
    } else {
      // The same point in its other state — connected to just now, or
      // that connection undone. Its circle is retired either way and a
      // new one minted, which is what runs the pop; but only a point
      // that has just been MET is news. An undo puts it back quietly.
      const wasKey = markerKey(m.x, m.y, !m.met);
      const was = held.get(wasKey);
      if (was) { held.delete(wasKey); was.remove(); }
      const announce = was === undefined || m.met;
      // A point minted already FLAGGED — a refused line end that fell
      // short of the line (UX §4.1) — pops but is no news to ring for:
      // being told off is not connecting.
      if (announce && !(m.flagged !== undefined && !m.met)) fresh++;
      c = document.createElementNS(ns, 'circle');
      c.setAttribute('data-region-marker', key);
      c.setAttribute('r', String(MARKER_RADIUS_PX));
      c.setAttribute('fill', MARKER_FILL);
      c.setAttribute('stroke', '#FFFFFF');
      c.setAttribute('stroke-width', '1.5');
      // Scaled about its own centre so the camera can move it mid-pop.
      c.style.transformBox = 'fill-box';
      c.style.transformOrigin = 'center';
      if (announce) c.style.animation = MARKER_POP_STYLE;
      group.appendChild(c);
    }
    // The flag is dressing written onto the circle the point already has,
    // not part of its key: re-minting it would ring the haptic, and being
    // told off is not the same news as connecting. Written only on a
    // CHANGE — the camera path runs this per frame, and a write per frame
    // would stamp on the pop it just started. The value is the press, so
    // a second refusal over the same point IS a change and pops again.
    const flag = !m.met && m.flagged !== undefined ? m.flagged : '';
    if ((c.getAttribute('data-region-flag') ?? '') !== flag) {
      c.setAttribute('data-region-flag', flag);
      c.setAttribute('fill', flag ? MARKER_FLAG_FILL : MARKER_FILL);
      if (flag) restartAnimation(c, MARKER_POP_STYLE);
      else c.style.animation = '';
    }
    c.setAttribute('cx', String(p.cx));
    c.setAttribute('cy', String(p.cy));
  });
  // Whatever is left held is a point that has gone — a stroke undone, or
  // a turn that moved on.
  held.forEach((c) => c.remove());
  return fresh;
}
