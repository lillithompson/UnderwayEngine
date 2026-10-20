/**
 * What the node layer draws, read off the scene graph (P5 of CozyJournal's
 * docs/transform-refactor.md).
 *
 * Every leaf is drawn the same way: its LOCAL content — a box with its
 * origin at (0, 0), or an svg's path centred on its origin — laid out in
 * an inner element, and that element placed with one CSS `matrix()`: the
 * node's world matrix, translated into the coordinates of an outer
 * element that spans the node's world AABB. The outer element is what the
 * gestures move (`data-node-id`): it carries no transform of its own, and
 * its centre is the content centre's image (a parallelogram is centred on
 * its centre), so a preview `matrix()` written onto it pivots about the
 * same point the graph does.
 *
 * Nothing here reads a legacy pose field. The `rotate(angleDeg)
 * rotate(rotation) scaleX(-1)` chain the layer used to build, the
 * width/height swap on a quarter turn, the "type scaled by the smaller
 * factor" rule and the nearest-rectangle reading of a sheared member are
 * all gone: the matrix is applied as it is.
 *
 * No React and no react-native imports, so it can be tested under node.
 */

import type { CompItemKind, PatternObject, SVGObject } from '@/engine/types';
import {
  LegacyLeaf, SceneGraph, SceneNode, flattenLeaves, getNode, leafNodeFromLegacy,
  worldMatrix,
} from '@/engine/sceneGraph';
import {
  Bbox, MAT_IDENTITY, Mat2D, axisScaleSplit, localMatrix, matApplyBbox, matApplyCorners,
  matApplyPoint, matEquals, matInvert, matMul, unstretchedBoxPose,
} from '@/engine/sceneTransform';
import {
  patternSVGView, patternViewNodeMarkup, shapePatternFillTiles,
} from '@/engine/patternObjectRender';
import { buildSVGObjectContent, buildSVGObjectLayers, svgDrawsOwnInnerGlow, svgIsFilled } from '@/engine/svgPathBuilder';
import { strokeScaleForUnits, svgStrokeWidthCells } from '@/engine/svgStroke';
import { localContentBox } from '@/engine/sceneHitFrame';
import {
  SvgLocalGeometry, patternLocalGeometry, patternLocalObject, svgLocalGeometry,
} from '@/engine/sceneDrawnContent';
import { SVG_UNITS_PER_L0_CELL } from '@/engine/svgExport';
import { cssMatrix, gestureAbout } from './transformGestures';
import { innerGlowSvgFilter } from './effectsBoxShadow';

/** A leaf as the layer draws it: the node (content + local geometry) and
 *  the matrix that puts its local space in the world. */
export interface DrawnLeaf {
  readonly node: SceneNode;
  readonly world: Mat2D;
}

/** Avoid zero-sized boxes for H/V lines. */
export const EPS_CELLS = 0.05;

// ── Reading the graph ──────────────────────────────────────────────────

/**
 * Every leaf of `graph`, keyed by id, identity-stable against `prev`.
 *
 * The layers are memoised on their `drawn` prop, so a leaf that has not
 * moved must be handed back as the very object it was last time: a node
 * untouched by an op is the same object (the graph is copy-on-write), and
 * its world matrix is compared entry-wise — a member of a group the op
 * did not move has a new matrix object with the same numbers.
 */
export function drawnLeaves(
  graph: SceneGraph, prev?: ReadonlyMap<string, DrawnLeaf>,
): Map<string, DrawnLeaf> {
  const out = new Map<string, DrawnLeaf>();
  for (const node of flattenLeaves(graph)) {
    const world = worldMatrix(graph, node.id);
    const was = prev?.get(node.id);
    out.set(node.id, was && was.node === node && matEquals(was.world, world) ? was : { node, world });
  }
  return out;
}

/** One leaf of `graph` as drawn, or undefined for a group or an unknown
 *  id. Not identity-cached — for a reader that caches per stroke (the
 *  colour brush's frames), not per render. */
export function drawnLeaf(graph: SceneGraph, id: string): DrawnLeaf | undefined {
  const node = getNode(graph, id);
  if (!node || node.kind === 'group') return undefined;
  return { node, world: worldMatrix(graph, id) };
}

const bareLeaves = new WeakMap<object, DrawnLeaf>();

/**
 * A legacy object that lives in no graph — a ghost, a live-resize preview,
 * a stamp not yet committed — drawn as the node `fromLegacy` would make of
 * it, at its world pose. Cached per object, so a layer memoised on the
 * result re-renders only when the object is replaced.
 */
export function drawnLeafOf(kind: CompItemKind, leaf: LegacyLeaf): DrawnLeaf {
  const hit = bareLeaves.get(leaf);
  if (hit) return hit;
  const node = leafNodeFromLegacy(kind, leaf);
  const drawn: DrawnLeaf = { node, world: localMatrix(node.transform) };
  bareLeaves.set(leaf, drawn);
  return drawn;
}

/**
 * The drawn leaf for a legacy object a caller is holding: off the GRAPH
 * when the graph holds this very object, else off the object alone.
 *
 * The identity check is the honest one. `toLegacyView` hands an untouched
 * leaf back as the very object the node carries as `content`, so `===`
 * means "the graph is describing this"; anything else is a ghost, a live
 * preview, an ad-hoc variant a caller built with a field changed — and
 * those have no node, only their own world fields. Without the graph half,
 * a leaf inside a bound group is read as if the group were not there.
 */
export function drawnLeafFor(
  kind: CompItemKind, leaf: LegacyLeaf, graph?: SceneGraph,
): DrawnLeaf {
  const node = graph?.nodes.get(leaf.id);
  if (graph && node && node.kind !== 'group' && node.content === leaf) {
    return { node, world: worldMatrix(graph, leaf.id) };
  }
  return drawnLeafOf(kind, leaf);
}

/** The node's content box in its own space: the stored box for a bbox
 *  kind (and a repeat-mode svg's region), else the path's own bounds.
 *
 *  The engine's {@link localContentBox} — the hit test asks the same
 *  question of the same node and must get the same box, or a tap lands
 *  somewhere the layer did not draw. */
export const drawnLocalBox = localContentBox;

/** The node's world AABB — the outer element's box. */
export function drawnAabb(d: DrawnLeaf): Bbox {
  return matApplyBbox(d.world, drawnLocalBox(d.node));
}

/** The four world corners of the content box, in local corner order. */
export function drawnCorners(d: DrawnLeaf): [number, number][] {
  return matApplyCorners(d.world, drawnLocalBox(d.node));
}

// ── The two elements ───────────────────────────────────────────────────

export interface DrawnFrame {
  /** The outer, untransformed element on the world AABB, in px. */
  outer: { left: number; top: number; width: number; height: number };
  /** The inner element: the local box's size in px, and the `matrix()`
   *  (origin at its top-left) that lands it where the world matrix says. */
  inner: { width: number; height: number; transform: string };
}

/**
 * The outer and inner element geometry for a drawn leaf.
 *
 * `geometry` lets a kind draw something other than the node's own local
 * box through the node's own matrix — the svg layer draws its path scaled
 * up by everything it takes back out of the matrix (see
 * {@link svgDrawnGeometry}). The outer box is the true world AABB either
 * way.
 */
export function drawnFrame(
  d: DrawnLeaf, pxPerCell: number,
  geometry?: { box: Bbox; matrix: Mat2D },
): DrawnFrame {
  const box = geometry?.box ?? drawnLocalBox(d.node);
  const m = geometry?.matrix ?? d.world;
  return boxFrame(drawnAabb(d), box, m, pxPerCell);
}

/**
 * The same two elements for a box that is not any one leaf's: `aabb` is
 * the outer element's world box, `box` the content drawn through `m`
 * inside it. {@link drawnFrame} is this over a leaf; Sol's composite plant
 * layer is this over a plant's subtree.
 */
export function boxFrame(aabb: Bbox, box: Bbox, m: Mat2D, pxPerCell: number): DrawnFrame {
  const [ox, oy] = matApplyPoint(m, box.x, box.y);
  return {
    outer: {
      left: aabb.x * pxPerCell,
      top: aabb.y * pxPerCell,
      width: Math.max(aabb.width, EPS_CELLS) * pxPerCell,
      height: Math.max(aabb.height, EPS_CELLS) * pxPerCell,
    },
    inner: {
      width: Math.max(box.width, EPS_CELLS) * pxPerCell,
      height: Math.max(box.height, EPS_CELLS) * pxPerCell,
      transform: cssMatrix({ ...m, e: ox - aabb.x, f: oy - aabb.y }, pxPerCell),
    },
  };
}

// ── Per-kind local content ─────────────────────────────────────────────

/** The engine's {@link SvgLocalGeometry}. Named for the layer that reads
 *  it; the SVG export reads the same one. */
export type SvgDrawnGeometry = SvgLocalGeometry;

/**
 * An svg's local content, ready for `buildSVGObjectContent` — the engine's
 * {@link svgLocalGeometry}, which the exporter draws from too.
 *
 * A stroke width is a WORLD quantity and the markup builder draws it in
 * user space, so everything but the matrix's TURN is folded into the
 * VERTICES and divided back out of the matrix the element wears — which
 * leaves a frame that cannot stretch a stroke, off-square or not. See the
 * engine module for the whole of it.
 *
 * `content` stands in for the node's own record — a live preview's reading
 * of the same object, mid-stroke: the brushed pattern cells, the brushed
 * fill. The node supplies the GEOMETRY either way (its local segments, its
 * box, its matrix), so an override may differ from the committed record in
 * what it is DRAWN WITH and not in where it is drawn; anything that moves
 * a vertex has to move through the graph instead.
 */
export function svgDrawnGeometry(d: DrawnLeaf, content?: SVGObject): SvgDrawnGeometry {
  return svgLocalGeometry(d.node, d.world, content);
}

/**
 * An image's box and matrix as its layer draws them: the node's local box
 * grown to the proportions it is DRAWN at, and the matrix with that
 * anisotropy taken back out ({@link anisotropySplit}).
 *
 * The bitmap is laid out inside the box (cover, contain, tiles —
 * FramedImage), so it is the box's proportions that decide its aspect. A
 * corner drag off the picture's ratio, or a group pulled off square, lands
 * as a per-axis scale on the matrix; drawn through it, the picture was
 * framed into the old box and then stretched. The export frames it the
 * same way (compositionSVGCore). What stays on the matrix is a turn and a
 * uniform scale, so a border, a shadow and the framing lengths grow with
 * the image as they always have.
 */
export function imageDrawnGeometry(d: DrawnLeaf): { box: Bbox; matrix: Mat2D } {
  return unstretchedBoxPose(drawnLocalBox(d.node), d.world);
}

/**
 * A pattern's content as the bake wants it, in the node's own space — the
 * engine's {@link patternLocalObject}.
 */
export function patternDrawnObject(d: DrawnLeaf): PatternObject {
  return patternLocalObject(d.node);
}

/**
 * A pattern's local content, on the same terms as an svg's — the engine's
 * {@link patternLocalGeometry}. Null when the grid is empty, which is the
 * case that draws nothing.
 */
export function patternDrawnGeometry(d: DrawnLeaf): SvgDrawnGeometry | null {
  return patternLocalGeometry(d.node, d.world, patternSVGView(patternDrawnObject(d)));
}

/**
 * The `<svg>` a pattern is drawn in: its viewBox over the box the geometry
 * grew to, and the baked markup inside it. One recipe for the React layer
 * and for the imperative previews that swap a mounted pattern's markup
 * mid-stroke, so a stroke previews where its commit renders.
 *
 * The viewBox grows WITH the element, so the user-space-to-pixel ratio
 * inside it never changes and a stroke keeps its authored world width —
 * which is the whole point of the grow (plan §5.10). Falls back to the
 * plain local box when the grid is empty and there is no markup anyway.
 */
export function patternLayerMarkup(
  d: DrawnLeaf, strokeScale: number,
): { viewBox: string; html: string } {
  const u = SVG_UNITS_PER_L0_CELL;
  const geometry = patternDrawnGeometry(d);
  const box = geometry?.box ?? drawnLocalBox(d.node);
  return {
    viewBox: `0 0 ${Math.max(box.width, EPS_CELLS) * u} ${Math.max(box.height, EPS_CELLS) * u}`,
    html: geometry ? patternViewNodeMarkup(geometry.object, strokeScale) : '',
  };
}

/**
 * The `<svg>` an SVG OBJECT is drawn in: its viewBox over the node's grown
 * local box, and the engine's canonical markup inside it — the path, its
 * fill, the color tool's paint layer and, over them, the PATTERN fill's
 * tiles clipped to the same outline — wrapped in the shape's INNER GLOW
 * filter where it has one.
 *
 * The twin of {@link patternLayerMarkup}, and for the same reason: the
 * React layer (NodeLayer's SvgNodeLayer) and the imperative previews that
 * swap a mounted shape's markup mid-stroke — a tile stroke painting into
 * a shape's pattern fill, the Color brush recolouring its fill — must
 * mount the same recipe, or a stroke previews as something other than
 * what it commits.
 *
 * The inner glow is part of that recipe because it lives INSIDE this
 * `<svg>`: it is the one cast effect with no CSS counterpart at all (see
 * innerGlowSvgFilter), so the export's own `<filter>` rides along in the
 * markup, wrapping what it lights. When the wrapper was the layer's own
 * to add, a recolour preview mounted the bare content and the glow went
 * out for the length of the drag, coming back on the drop.
 *
 * …and absent where the shape has already PAINTED its band, inside the
 * outline it encloses — an unfilled shape's alpha is its stroke, and light
 * gathered inside a stroke lies on both sides of the line instead of
 * inside the shape. That band comes up in the content itself, through the
 * markup builder both renderers share (svgDrawsOwnInnerGlow). The filter
 * is left for the one case that has no inside at all: an OPEN path, where
 * the outline width is what gives the light somewhere to be.
 *
 * `outlineCells` comes back with the markup: the stroke the shape draws,
 * when that outline is the whole of what it has to cast from. `undefined`
 * on a filled shape, which casts from its own solid alpha like every other
 * node — and so the flag for which of the two pictures this node is,
 * asked ONCE, so the inner glow's dilation here and the layer's drawn
 * rings and dropped CSS filter cannot disagree about it.
 *
 * `geometry` is the caller's reading of {@link svgDrawnGeometry} when it
 * has one (it is cached per node, so passing it only saves a lookup).
 */
export function svgLayerMarkup(
  d: DrawnLeaf, strokeScale: number, geometry?: SvgDrawnGeometry,
): { viewBox: string; html: string; outlineCells: number | undefined } {
  const { u, object, viewBox, outlineCells, innerGlow, patternFillMarkup } = svgLayerRecipe(d, strokeScale, geometry);
  // Strokes are USER-SPACE (no non-scaling-stroke), the same convention
  // every pattern render site uses: a line's width is a WORLD quantity,
  // so it scales with the camera like the tiles beside it. See the
  // stroke note in patternObjectRender.ts.
  const content = buildSVGObjectContent(
    object, strokeScaleForUnits(strokeScale, u), u,
    {
      nonScaling: false,
      paintOverlaySlot: 'canvas',
      patternFillMarkup,
    },
  );
  return {
    viewBox,
    // Nothing is mounted for a node without a glow: the markup passes
    // straight through, which is the case for nearly every node on a page.
    html: innerGlow.defs && innerGlow.filterRef
      ? `<defs>${innerGlow.defs}</defs><g filter="${innerGlow.filterRef}">${content}</g>`
      : content,
    outlineCells,
  };
}

/**
 * The same shape in TWO `<svg>`s — its fill and its strokes — for the node
 * whose paint layer is an HTML `<canvas>` mounted BETWEEN them
 * (shapePaintDom.ts): a painted shape, or one a paint stroke is previewing
 * on. The engine's {@link buildSVGObjectLayers} says why the canvas lives
 * outside the svg; this is that reader with the same fade, stroke and
 * pattern-fill conventions as {@link svgLayerMarkup}, so the two forms of a
 * shape cannot disagree about anything but where the paint is carried.
 *
 * The inner glow's filter wraps the FILL half: the glow is light gathered
 * inside the shape's alpha, and with the halves apart the fill is the
 * alpha that has an inside. (The strokes half is drawn over it, as it is
 * in the one-svg form — the band the glow lays along the inner edge is
 * simply under the outline's inner half, where the outline covered it
 * anyway.) `opacity` is the whole-object row for the host to wear, and
 * `paintClipId` the fill half's clip for the canvas to be cut with.
 */
export interface SvgLayerSplit {
  viewBox: string;
  fill: string;
  strokes: string;
  opacity: number;
  paintClipId: string | null;
  outlineCells: number | undefined;
}

export function svgLayerSplitMarkup(
  d: DrawnLeaf, strokeScale: number, geometry?: SvgDrawnGeometry,
): SvgLayerSplit {
  const { u, object, viewBox, outlineCells, innerGlow, patternFillMarkup } = svgLayerRecipe(d, strokeScale, geometry);
  const layers = buildSVGObjectLayers(
    object, strokeScaleForUnits(strokeScale, u), u,
    { nonScaling: false, patternFillMarkup },
  );
  return {
    viewBox,
    fill: innerGlow.defs && innerGlow.filterRef
      ? `<defs>${innerGlow.defs}</defs><g filter="${innerGlow.filterRef}">${layers.fill}</g>`
      : layers.fill,
    strokes: layers.strokes,
    opacity: layers.opacity,
    paintClipId: layers.paintClipId,
    outlineCells,
  };
}

/** What the two svg readers share: the drawn (faded, grown) object, the
 *  viewBox over its box, the outline flag, the inner glow's filter and the
 *  pattern fill's baked tiles. One reading, so neither form of a shape can
 *  answer any of these differently from the other. */
function svgLayerRecipe(d: DrawnLeaf, strokeScale: number, geometry?: SvgDrawnGeometry) {
  const u = SVG_UNITS_PER_L0_CELL;
  const geo = geometry ?? svgDrawnGeometry(d);
  const box = geo.box;
  const w = Math.max(box.width, EPS_CELLS);
  const h = Math.max(box.height, EPS_CELLS);
  const object = geo.object;
  const outlineCells = object.effects && !svgIsFilled(object)
    ? svgStrokeWidthCells(object, strokeScaleForUnits(strokeScale, u), u)
    : undefined;
  const innerGlow = svgDrawsOwnInnerGlow(object)
    ? { defs: null, filterRef: null }
    : innerGlowSvgFilter(object.effects, `ig_${object.id}`, u, outlineCells);
  return {
    u,
    object,
    viewBox: `${box.x * u} ${box.y * u} ${w * u} ${h * u}`,
    outlineCells,
    innerGlow,
    patternFillMarkup: shapePatternFillTiles(object, strokeScale, { gx: geo.growX, gy: geo.growY }),
  };
}

// ── The frame clip ─────────────────────────────────────────────────────

/**
 * Where a frame clips, and where its members are drawn inside the clip.
 *
 * A frame is its boundary rect (compositionFrame.buildFrameRectMap), and
 * that rect is a leaf like any other: it is DRAWN as its local box through
 * its world matrix. So the clip element is that box, placed by that matrix
 * — the `rotate(angleDeg)` wrapper the layer used to build is gone, and a
 * frame inside a bound group, or one its group has scaled or turned, clips
 * where it is drawn.
 *
 * The members are NOT the frame's to pose: each one carries the group's
 * transform in its own world matrix already. So the inner element undoes
 * the clip's pose ({@link DrawnClip.rebase}) and the members render at
 * their own world coordinates inside it — which is what the export has
 * always done (compositionSVGCore rotates a tilted frame's clip path and
 * border, never its contents).
 */
export interface DrawnClip {
  /** Where the element sits with no transform, and the size of the region
   *  it clips to, in px. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** The element's `matrix()` (transform-origin `0 0`), or `''` when the
   *  pose is a pure translation — which every upright frame is, and which
   *  `left` / `top` already say. An untouched page's DOM is unchanged. */
  transform: string;
  /** The inner element the members render in: the offset and the matrix
   *  that put them back in world px. An upright clip needs only the
   *  offset, and it is the one the layer has always carried. */
  rebase: { left: number; top: number; transform: string };
  /** The element's layout origin, in cells, and the pose it wears on top
   *  — what {@link drawnClipGesture} composes a live gesture onto. */
  origin: readonly [number, number];
  rest: Mat2D;
}

/**
 * The clip geometry for a frame's boundary rect.
 *
 * The rect's local box, grown by the matrix's per-axis scale and that
 * scale divided back out of the matrix ({@link axisScaleSplit}): the
 * element's px size is then the frame's world size, so its border stroke
 * and its drop shadow stay as authored through a frame resize — which
 * commits as a scale on the frame's group, and so lives on the matrix
 * from then on.
 */
export function drawnClip(d: DrawnLeaf, pxPerCell: number): DrawnClip {
  const lb = drawnLocalBox(d.node);
  const { sx, sy, matrix } = axisScaleSplit(d.world);
  const box: Bbox = { x: lb.x * sx, y: lb.y * sy, width: lb.width * sx, height: lb.height * sy };
  const [ox, oy] = matApplyPoint(matrix, box.x, box.y);
  const width = Math.max(box.width, EPS_CELLS) * pxPerCell;
  const height = Math.max(box.height, EPS_CELLS) * pxPerCell;
  if (matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1) {
    const left = ox * pxPerCell;
    const top = oy * pxPerCell;
    return {
      left, top, width, height, transform: '',
      rebase: { left: -left, top: -top, transform: '' },
      origin: [ox, oy], rest: MAT_IDENTITY,
    };
  }
  const rest: Mat2D = { ...matrix, e: ox, f: oy };
  let inv: Mat2D | null;
  try { inv = matInvert(rest); } catch { inv = null; }
  return {
    left: 0, top: 0, width, height,
    transform: cssMatrix(rest, pxPerCell),
    rebase: { left: 0, top: 0, transform: inv ? cssMatrix(inv, pxPerCell) : '' },
    origin: [0, 0], rest,
  };
}

/**
 * The clip element's `matrix()` while a world `gesture` is being previewed
 * live — the frame resize under the finger.
 *
 * The members ride it for FREE: `rebase` holds the clip's RESTING inverse,
 * so whatever the element wears on top of it reaches the members as itself.
 * One style write moves the clip and everything in it, however many members
 * the frame holds — which is what let the old CSS path track the finger at
 * 90 fps, and is why this is not `previewGesture` per leaf. It is exact for
 * the same reason: a frame commits as ONE transform on its group, so the
 * ride that transform gives IS every member's. Hand it the affine the
 * release's own entry lands (`transformGestures.previewWorldGesture`), not
 * the resize's ideal box-to-box map: the two part company on a tilted
 * frame, whose stretch asks for a shear a group cannot store.
 */
export function drawnClipGesture(clip: DrawnClip, gesture: Mat2D, pxPerCell: number): string {
  return cssMatrix(matMul(gestureAbout(gesture, clip.origin), clip.rest), pxPerCell);
}
