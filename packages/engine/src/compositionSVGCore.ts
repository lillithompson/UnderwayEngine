/**
 * Pure composition→SVG generator. No IndexedDB, no DOM, no WebGL — just
 * composition data in, SVG document string out. The browser path
 * (`compositionExport.ts::exportCompositionSVG`) threads IndexedDB through
 * the loaders; the module is kept pure so Node-side tooling can call it
 * with pre-deserialized embedded files.
 */

import { CompItemKind, CompositionFigure, CompositionState, FileConfig, SVGObject, ImageObject, PaintObject, PatternObject, TextObject, Layer, ClipBox, GroupNode, Paint, NodeEffects, BorderEffect, RGBColor } from './types';
import { patternSVGView } from './patternObjectRender';
import { patternLocalObject, svgLocalGeometry } from './sceneDrawnContent';
import {
  LegacyLeaf, SceneGraph, SceneNode, fromLegacy, graphDescribes, leafNodeFromLegacy, worldMatrix,
} from './sceneGraph';
import { leafHitFrame, localContentBox, localHitObject } from './sceneHitFrame';
import {
  Bbox, Mat2D, axisScaleSplit, localMatrix, matApplyBbox, matApplyPoint, matMul, matTranslate,
  matrixString,
} from './sceneTransform';
import { effectiveFontWeight } from './fontWeight';
import { toBase64 } from './pngcodec';
import { exportLayersToSVGInner, SVG_UNITS_PER_L0_CELL } from './svgExport';
import { buildFigureSVGContent, buildBlockSVGContent, wrapWithColorOverride, type CachedFigureSVG } from './svgFigureBuilders';
import { buildPathD, buildClosedFillPathD, buildTiledSVGObjectRegionMarkup, svgFillPresentation, svgStrokePresentation, withSVGObjectStrokeColor, wrapSVGObjectOpacity } from './svgPathBuilder';
import { roundPathCorners, strokeScaleForUnits, svgStrokeRadiusCells, svgStrokeWidthCells } from './svgStroke';
import { svgEndpointsMarkup } from './svgEndpoints';
import { arcBoundingBox } from './compositionArcHitTest';
import { buildActiveMaskMap, clipRectToNodeMasks } from './compositionMask';
import { frameGroupIdForNode } from './compositionFrame';
import { hiddenGroupIds } from './compositionOps';
import { buildMaskClipDefs, wrapWithMaskClip } from './compositionMaskSVG';
import { effectiveStrokeMultiplier, normalizeStrokeScale } from './strokeScale';
import { simplifySVG } from './simplifySVG';
import { patternFillBackground } from './patternFill';
import { paintToSvg, blurSigma, effectsFilterOutset, effectsToSvgFilter, tintToFeColorMatrix, borderToSvgRect } from './paintSvg';
import { tintFillToPaint } from './imageTintFill';
import { overlayPngDataUri, paintBlendCss, PaintInk, shapePaintOverlaySVG } from './imagePaintOverlay';
import { flattenPaintTiles } from './canvasPaint';
import { textArcPaths, textBend, textBendRise } from './textArc';
import { charColorRuns, contentBoxCells, DEFAULT_LINE_HEIGHT, layoutText } from './textLayout';
import { STICKER_BORDER_CELLS, STICKER_SHADOW_CELLS, stickerColors } from './stickerStyle';
import { resolveFraming, coverImageRect, straightenCoverScale, tileGeometry, ResolvedFraming } from './imageFraming';

/** Layer set + dimensions returned by a figure loader. Mirrors the relevant
 *  subset of what `loadFileStateLite` provides. */
export interface CompositionFigureLoadResult {
  layers: Layer[];
  widthL0: number;
  heightL0: number;
  originL0X: number;
  originL0Y: number;
  clipBox: ClipBox | null;
}

/**
 * Font-embedding hook for text-node export. Given a `TextStyle.fontId`,
 * return WOFF2 bytes (base64) to embed as an `@font-face` data URI, or
 * null/undefined to skip. When no resolver is provided (or it returns
 * nothing for every used font), text elements reference the family by
 * name only — the viewer must have the font installed/registered, and the
 * `<img>`-based rasterizer (which cannot see page-registered fonts) falls
 * back to the platform's default face, so exported text stops matching the
 * editor. Supply one for any export that will be rasterized.
 *
 * May be async, so a host can fetch a face on first use and cache it
 * instead of holding every bundled font in memory.
 */
export type SVGFontFace = { woff2Base64?: string } | null;
export type SVGFontResolver = (fontId: string) => SVGFontFace | Promise<SVGFontFace>;

/** The visible scene handed to a {@link CompositionSubsetSelector} — the nodes
 *  that would be drawn, after `hidden` filtering, plus the group hierarchy. */
export interface CompositionSubsetScene {
  figures: readonly CompositionFigure[];
  svgObjects: readonly SVGObject[];
  images: readonly ImageObject[];
  texts: readonly TextObject[];
  /** Paint island scene nodes (v52+). Optional for selector back-compat. */
  paints?: readonly PaintObject[];
  groups: readonly GroupNode[];
}

/**
 * Picks which of the visible scene's nodes to draw, by id. Called once per
 * export with the whole scene, so a selector can answer questions no per-node
 * predicate could ("the word stickers that sit inside a frame, unless none
 * do") without the caller re-loading the composition.
 *
 * Returning every id is NOT the same as passing no selector: a subset export
 * also drops the canvas background and ignores frame bounds (see
 * {@link CompositionSVGInputs.subset}).
 */
export type CompositionSubsetSelector = (scene: CompositionSubsetScene) => ReadonlySet<string>;

/**
 * Inputs for the pure SVG-generation core. Decoupled from IndexedDB so
 * Node-side tooling can call this, threading pre-deserialized figure data
 * through `loadFigure`.
 */
export interface CompositionSVGInputs {
  /** Used as the SVG root element's id (sanitized). */
  name: string;
  figures: CompositionFigure[];
  svgObjects: SVGObject[];
  images: ImageObject[];
  imageBlobs: Record<string, Uint8Array>;
  /** Text scene nodes (v29+). Optional: absent and empty behave the same. */
  texts?: TextObject[];
  /** Canvas background paint (v29+). When set, a full-viewBox rect is
   *  painted behind every scene element. Absent = transparent, matching
   *  the pre-v29 export appearance. */
  background?: Paint;
  /** Paint island scene nodes (v52+): the raster brush's strokes as
   *  first-class objects. Each exports as a transform group of tile
   *  <image>s at its z-slot in `sceneOrder`, exactly like any other node —
   *  the retired v50/v51 under-everything canvas layer is gone. */
  paintObjects?: PaintObject[];
  /** Inline tile-pattern scene nodes (v54+). Each exports through its
   *  derived SVGObject view (patternSVGView) at its z-slot in
   *  `sceneOrder` — the same markup the canvas renders, tiled region
   *  included. Empty patterns export as nothing. */
  patternObjects?: PatternObject[];
  /** Optional font-embedding hook — see {@link SVGFontResolver}. */
  fontResolver?: SVGFontResolver;
  /** Group hierarchy — needed to resolve "Use as mask" clip regions.
   *  Optional: when absent, no masking is applied (back-compat). */
  groups?: GroupNode[];
  /** Back→front paint order; drives first-wins active-mask resolution.
   *  Optional: falls back to `svgObjects` order when absent. */
  sceneOrder?: string[];
  /**
   * The live scene graph, when the caller has one.
   *
   * Poses are read from the graph (`exportGraph` below), so a caller that
   * holds a state the editor has been transforming should pass its
   * `state.graph` rather than let the export rebuild one: the arrays are
   * the graph's legacy VIEW of itself, and a view cannot spell a world
   * scale or a shear. Rebuilding from them throws away the very thing the
   * export would otherwise be missing.
   *
   * Ignored (and rebuilt) when it does not describe the arrays passed
   * beside it — a preview path that spreads new arrays over an old state
   * keeps a graph that is a gesture behind the picture. Absent is the
   * ordinary case: every storage-backed export loads a `.tile` and hands
   * over its arrays, and a graph built from those says exactly what they
   * already say.
   */
  graph?: SceneGraph;
  /** Raw composition-level stroke scale (0–1). Normalized internally. */
  strokeScale?: number;
  /**
   * Grow the export frame by this fraction of the frame's LONGER edge on
   * every side — a uniform breathing margin around the content, painted with
   * the canvas background (which covers the full viewBox) or left
   * transparent/backdrop-colored when there is none. For exports whose frame
   * is the tight content union (an unframed freeform page), where the
   * outermost marks would otherwise touch the image edge. Ignored when a
   * Figma-style frame pins the bounds (the frame is the page the user
   * framed; padding it would add page background outside that board), so
   * hosts can pass it unconditionally. 0/absent keeps the exact frame every
   * existing export has.
   */
  viewBoxPadFraction?: number;
  /**
   * Frame each SVG object on its INKED extent — its geometry grown by the
   * stroke half-width — the way a subset cutout already does. A stroke is
   * centered on its path, so a frame on the bare geometry slices the
   * outermost strokes down their length; that is invisible when the frame is
   * a page (the page is bigger than the ink), but an export framed on the
   * content union clips exactly half the boundary stroke. Off by default so
   * page-framed and legacy content-framed exports keep the frame they have
   * always had.
   */
  frameInkExtents?: boolean;
  /**
   * Draw only part of the scene — a CUTOUT of the composition rather than the
   * page. When set, three things change together, because they are one
   * intent ("give me just these objects, framed on themselves"):
   *   1. only the selected nodes are drawn;
   *   2. the viewBox is the tight union of what's left, so frames no longer
   *      pin it to page bounds (a cutout is zoomed by definition), and text
   *      is framed on its glyphs rather than on the roomy box it lays out in
   *      (see {@link paintedTextBounds});
   *   3. the canvas background is skipped, so the result is transparent.
   *
   * Masks are unaffected: they resolve from the unfiltered scene, so a node
   * that was clipped by its frame stays clipped by it. Returning an empty set
   * (or selecting nothing that is visible) yields null, like an empty scene.
   */
  subset?: CompositionSubsetSelector;
  /**
   * Paint every glyph this color, whatever the node's authored text color is.
   * For an export that lands on a backdrop the page never had — a cutout on a
   * card's colored tint well — where the author's ink was chosen to read
   * against the page (dark type over a photo) and would vanish or clash there.
   *
   * Any authored text OUTLINE is dropped with it: an outline is a color
   * decision too, and keeping a dark one around forced-white glyphs would put
   * back exactly the contrast the override is removing.
   *
   * Sticker text is exempt. A sticker's ink and its card come as a pair from
   * `stickerColors` (the ink also strokes the card's border), so recoloring
   * one of the two would put white type on a white card.
   */
  textColorOverride?: RGBColor;
  /**
   * Stroke every line an SVG object draws in this color, whatever the node's
   * authored one is — the shape's own color, each of its stroked subpaths, and
   * a pattern's per-copy segment overrides.
   *
   * The `textColorOverride` argument, for line art: a cutout of the marks on a
   * page lands on the card's colored tint well, where the dark inks a user
   * naturally draws with go muddy against it and a tinted one clashes.
   *
   * FILLS keep their authored paint. A fill is an area, not a line — it reads
   * against the well on its own, and flooding it too would collapse a drawing
   * into a silhouette. See {@link silhouette} for the objects that WANT that.
   */
  strokeColorOverride?: RGBColor;
  /**
   * Objects `strokeColorOverride` REACHES — every other SVG object keeps its
   * authored ink. Absent, the override reaches every object drawn.
   *
   * For an export that singles one thing out on an otherwise faithful page:
   * a "reveal" of the day's seed shape inside the user's finished drawing,
   * say, where the seed is re-inked and the rest of the page has to match
   * the plain export stroke for stroke. Selected the way {@link subset} is,
   * by a host callback given the unfiltered scene. Names nothing → nothing
   * is re-inked. No-op without `strokeColorOverride`.
   */
  strokeOverrideOnly?: CompositionSubsetSelector;
  /**
   * SVG objects laid OVER the scene — drawn after everything else, exactly as
   * given, in their own ink and at their own opacity — and FRAMED ON like
   * content: a content-framed export grows to hold them. They are not part
   * of the composition otherwise: `subset`, `strokeColorOverride`, masks and
   * `sceneOrder` never see them.
   *
   * For a reveal whose singled-out thing is no longer ON the page: a
   * Reimagine page whose day's seed the user deleted or redrew still has a
   * seed to show — the one the issue dealt — so the host hands that geometry
   * in here, re-inked, over the page. The plain export it is laid over
   * passes the same overlay with `drawOverlay: false`, so the two frame
   * identically (the seed's room is in both) and the pair lines up pixel for
   * pixel under a slider, the whole seed in view.
   */
  overlaySvgObjects?: SVGObject[];
  /**
   * Whether `overlaySvgObjects` are painted (default) or only framed on — the
   * plain twin of an overlaid export, which must share its frame without
   * showing the overlay. Meaningless without `overlaySvgObjects`.
   */
  drawOverlay?: boolean;
  /**
   * With `subset`: draw only the selected objects, but FRAME as the plain
   * export of the whole page would — the full scene (and any overlay), with
   * the same ink padding rule — so the cutout lines up pixel for pixel over
   * that plain export. For an export that is laid OVER another picture of
   * the same page: a reveal that paints one object on a wash, to sit on the
   * page's own image under a slider. A subset naming nothing is fine here
   * when an overlay is drawn: the page frames the picture, the overlay is
   * what it shows. Ignored without `subset`.
   */
  frameOnScene?: boolean;
  /**
   * A full-frame wash painted under everything drawn — a cutout's too,
   * unlike `background`, which a cutout drops. For an export laid over
   * another picture of the same page (see `frameOnScene`): a translucent
   * paint in the ground's own colour quiets that picture where the overlay
   * lands, so the one thing drawn on it stands out.
   */
  backdrop?: Paint;
  /**
   * Objects whose FILLS take `strokeColorOverride` as well — the silhouette
   * the fill rule above refuses by default.
   *
   * It exists for pictures made ONLY of fills, where "leave the areas alone"
   * means "leave the whole object alone": a baked Figgie rig is a stack of
   * filled subpaths with not one stroke among them, so the line override
   * slides straight off and a tan mannequin sits in a cutout that whited
   * everything drawn around it. Naming those objects — rather than flooding
   * every fill — keeps a drawing's coloured-in areas from collapsing into
   * blocks in the same pass.
   *
   * Selected the same way as {@link subset}, by a host callback given the
   * scene, because which objects those are is the host's question (the engine
   * has no notion of a rig). No-op without `strokeColorOverride`: this says
   * how far that ink reaches, not what it is.
   */
  silhouette?: CompositionSubsetSelector;
  /**
   * Repaint every PAINT ISLAND in this color, whatever colors were brushed
   * into it, keeping each texel's alpha — so the brushwork keeps its shape,
   * its softness and its pressure, and loses only its hue.
   *
   * The `strokeColorOverride` argument for the raster brush: a cutout of the
   * marks on a page lands on the card's colored tint well, and a stroke laid
   * down to read against the paper goes muddy or clashes there. The two are
   * separate knobs because a page's line art and its brushwork are separate
   * decisions — a format may want its pen strokes left alone and its paint
   * flattened, or the reverse.
   *
   * Blend modes are already baked into the texels (the brush composites at
   * stamp time), so there is nothing left here for a recolor to disagree with:
   * whatever the stroke ended up looking like, it ends up this color.
   *
   * Image and shape paint OVERLAYS are exempt. Those are paint applied TO an
   * object — a wash over a photo, a scribble inside a shape — and the object
   * they sit on comes along with the cutout, so their color was chosen against
   * a backdrop that did not get left behind.
   *
   * A TONE (a function of the texel's own colour — see {@link PaintInk})
   * re-inks each texel from what it was instead of flattening the lot: the
   * same alpha rule, with the wash's light-and-dark carried through.
   */
  paintColorOverride?: PaintInk;
  /**
   * Drop the AUTHORED drop shadow from every text node.
   *
   * The `textColorOverride` argument again, for the effect rather than the
   * ink: a shadow under type was cast to lift it off the page it was written
   * on. A cutout leaves that page behind, so the shadow arrives on a backdrop
   * it was never measured against — and at tile size a soft dark halo under
   * small glyphs is a smudge, not depth.
   *
   * A sticker's own fixed card shadow is untouched: it comes with the card
   * rather than from the author, exactly as the DOM layer treats it.
   */
  dropTextShadow?: boolean;
  /** When true, emit each image from its higher-resolution `originalImageId`
   *  blob (falling back to `imageId` when absent). Off by default so cheap
   *  consumers — thumbnails, previews — keep rasterizing the small display
   *  blob; real file exports (SVG/PNG/zip) turn it on for full fidelity.
   *
   *  Pair it with {@link rasterLongEdgePx}: the flag then reads as "full
   *  fidelity for the pixels this export actually draws" rather than
   *  "always the master". */
  preferOriginalImages?: boolean;
  /**
   * The long edge, in pixels, of the raster this SVG is about to be drawn
   * into — which turns {@link preferOriginalImages} from a boolean into a
   * BUDGET: a node whose drawn size in that raster is no bigger than its own
   * display copy is emitted from the display copy, master or no master.
   *
   * The master is the expensive half of an image by an order of magnitude
   * (ORIGINAL_MAX_EDGE_PX 4096 vs MAX_EDGE_PX 1024 — ~3.4 MB against
   * ~340 KB for a phone photo), and it costs three times over: the bytes are
   * base64'd into this string at 4/3 size, the string is copied again into
   * the rasterizer's <img>, and WebKit then decodes 4096² RGBA — ~67 MB of
   * IOSurface — to sample it down. Doing that for a 300 px card thumbnail
   * was the single most disproportionate call in the export path.
   *
   * Omit it for an export with no raster size (a real .svg file, whose
   * consumer may draw it at any scale): every image then takes the master,
   * exactly as before.
   */
  rasterLongEdgePx?: number;
  /** Resolves a figure's layer/dimension/clipBox data by `fileId`. May be
   *  async (browser path threads through IndexedDB) or effectively sync
   *  (a Node caller can pre-deserialize embedded files into memory and
   *  return `Promise.resolve(...)`). */
  loadFigure: (fileId: string) => Promise<CompositionFigureLoadResult | null>;
  /** Raster fallback for asset figures with no vector data. Browser path
   *  threads through `bake.ts::loadBakedFigurePng` (a legacy-only read —
   *  see bake.ts); omitting it skips asset figures silently. */
  loadBakedFigurePng?: (fig: CompositionFigure) => Promise<string | null>;
}

/**
 * Would sampling this node's export MASTER put more pixels on the raster than
 * its display copy already carries?
 *
 * `pxPerUnit` is the output raster's pixels per SVG unit (null when the
 * export named no raster size — then the answer is always yes, because the
 * consumer may draw the document at any scale). `drawnUnits` is the node's
 * longer drawn edge in SVG units.
 *
 * The display copy's own longer edge is the yardstick, read off the node
 * (`pixelWidth`/`pixelHeight` record the DISPLAY bytes' dimensions — see
 * compositionImageImport). A node whose drawn edge lands inside that is
 * already at or above 1:1 from the small blob, and the master would only be
 * decoded at 4096² to be thrown away.
 */
export function drawsAboveDisplayCopy(
  img: Pick<ImageObject, 'pixelWidth' | 'pixelHeight'>,
  pxPerUnit: number | null,
  drawnUnits: number,
): boolean {
  if (pxPerUnit === null) return true;
  const displayEdge = Math.max(img.pixelWidth ?? 0, img.pixelHeight ?? 0);
  if (!(displayEdge > 0)) return true;
  return drawnUnits * pxPerUnit > displayEdge;
}

/** Escape text content / attribute values for XML. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Scale a NodeEffects' world-unit geometry (shadow offset/blur, glow
 * radius, border width/radius) into SVG units. The paintSvg builders are
 * unit-agnostic; export space is L0 cells × SVG_UNITS_PER_L0_CELL, so the
 * effect geometry must scale the same way node bboxes do.
 */
function scaleEffectsToSvgUnits(effects: NodeEffects, u: number): NodeEffects {
  const out: NodeEffects = {};
  if (effects.shadow) {
    out.shadow = {
      ...effects.shadow,
      dx: effects.shadow.dx * u,
      dy: effects.shadow.dy * u,
      blur: effects.shadow.blur * u,
      spread: effects.shadow.spread !== undefined ? effects.shadow.spread * u : undefined,
    };
  }
  if (effects.glow) {
    out.glow = { ...effects.glow, radius: effects.glow.radius * u };
  }
  if (effects.border) {
    out.border = {
      ...effects.border,
      width: effects.border.width * u,
      radius: effects.border.radius !== undefined ? effects.border.radius * u : undefined,
    };
  }
  return out;
}

/** Bbox a border effect is stroked around — a node's own box, or a frame's. */
interface BorderBox {
  cellX: number; cellY: number; cellWidth: number; cellHeight: number; cornerRadius?: number;
}

/**
 * A border effect as a stroked `<rect>` over `box`, in SVG units. World-unit
 * geometry (width, radius) is scaled here, so callers pass a world-space box.
 * Shared by the per-node effects wrapper and the frame-border overlay so the
 * two can't disagree about where a border sits.
 */
function borderRectForBox(border: BorderEffect, box: BorderBox, u: number): string {
  const scaled = scaleEffectsToSvgUnits({ border }, u).border!;
  // Round the stroke to the node's own corner rounding when it has one
  // (images carry cornerRadius as a fraction of the shorter side) so the
  // border hugs the rounded image; otherwise use the border's own radius.
  const cornerR = box.cornerRadius
    ? Math.min(0.5, box.cornerRadius) * Math.min(box.cellWidth, box.cellHeight) * u
    : (scaled.radius ?? 0);
  return borderToSvgRect({ ...scaled, radius: cornerR }, {
    cellX: box.cellX * u,
    cellY: box.cellY * u,
    cellWidth: box.cellWidth * u,
    cellHeight: box.cellHeight * u,
  }, u);
}

/**
 * Wrap node markup with its NodeEffects: shadow/glow become a `<filter>`
 * def referenced by a wrapping `<g>`; a border becomes a stroked rect drawn
 * OVER the content at the `node` bbox passed in. The caller picks that frame:
 * svg/text pass their world bbox (effects sit in world space, then any node
 * rotation wraps the whole result); images pass a LOCAL frame [0,0,iw,ih] and
 * wrap this output in their transform group, so the filter offset and border
 * rotate/mirror with the bitmap. Def ids are prefixed with the node id so
 * multiple effected nodes coexist in one document.
 */
function applyNodeEffects(
  markup: string,
  effects: NodeEffects | undefined,
  nodeId: string,
  node: BorderBox,
  u: number,
): string {
  if (!effects) return markup;
  const scaled = scaleEffectsToSvgUnits(effects, u);
  let out = markup;
  // The node's box, in the same user space the filter is referenced from —
  // world for svg/text, the local bitmap frame for images. Sizing the region
  // to it (rather than to a fixed ±50%) is what stops a shadow reaching past
  // a small node's own box from being cut off with a hard edge.
  const { defs, filterRef } = effectsToSvgFilter(scaled, `fx_${nodeId}`, {
    x: node.cellX * u,
    y: node.cellY * u,
    width: node.cellWidth * u,
    height: node.cellHeight * u,
  });
  if (defs && filterRef) {
    out = `<defs>${defs}</defs><g filter="${filterRef}">${out}</g>`;
  }
  if (effects.border) out += borderRectForBox(effects.border, node, u);
  return out;
}

/** Fallback family tail appended after the node's own font, mirroring the
 *  DOM node layer's stack so an un-embedded family (or `fontId: 'system'`)
 *  lands on the same platform face in the export that the editor shows. */
const FALLBACK_FAMILY_STACK = "system-ui, -apple-system, &apos;Segoe UI&apos;, sans-serif";

/**
 * Build SVG markup for a text node: one `<text>` element per layout line
 * (via `layoutText` with the shared measurer — the app-registered one when
 * present, else the deterministic default), wrapped in the same
 * translate/rotate/mirror group images use. Layout runs in
 * world units against the node's bbox width, then scales into SVG units.
 * Sticker nodes get a card background behind the lines.
 *
 * Deliberately mirrors the DOM node layer line for line, because these two
 * renderers must produce the same picture — the editor draws the node with
 * DOM text, this draws the image the journal stores:
 *
 *  • Same `layoutText` call (same measurer), so lines break identically.
 *  • Lines are placed at the layout's own `x` with no `text-anchor`, so
 *    alignment comes from the shared layout rather than from the two
 *    renderers' independent glyph metrics.
 *  • The baseline uses `dominant-baseline="central"` at the line box's
 *    center, which is exactly where CSS puts it (half-leading + ascent —
 *    verified equal in Blink and WebKit). A fixed ascent constant sat
 *    ~0.12 em high and drifted per family.
 *
 * `colorOverride` repaints the glyphs (and drops any authored outline) for
 * exports that land on a backdrop the page never had — see
 * {@link CompositionSVGInputs.textColorOverride}. Geometry is untouched: it
 * changes paint only, so the layout and the framing math still agree.
 */
function buildTextSVGContent(text: TextObject, u: number, colorOverride?: RGBColor): string {
  const style = text.style;
  // `text` is the node spelled in its OWN space (`sceneHitFrame.localHitObject`):
  // its box is at the origin and it carries no pose channels at all, so the
  // card and the type are laid out here and the caller's single `matrix()`
  // carries them into the world. The `translate() rotate(angleDeg)
  // rotate(rotation) translate() scale(-1)` chain this used to compose off
  // the legacy fields is gone with them (P5 of docs/transform-refactor.md).
  //
  // `contentBoxCells` is a no-op on a local node — its quarter turn has been
  // spent — and it stays because it is the box's NAME here: what the type
  // lays out in.
  const content = contentBoxCells(text);
  const cw = content.width * u;
  const ch = content.height * u;

  // A sticker's node bbox IS its card: the scaffold already grew the box by
  // the interior margin on every side, so the text lays out against the full
  // box here exactly as it does in the DOM layer. Insetting again would
  // wrap earlier than the editor does.
  const layout = layoutText(text.content, style, {
    maxWidth: content.width,
    maxHeight: content.height,
  });

  const fontSize = style.size * u;
  const lineHeight = style.size * (style.lineHeight ?? DEFAULT_LINE_HEIGHT);
  const colors = text.sticker ? stickerColors(text.invert) : null;
  // A sticker's ink is half of its card's palette, so the override skips it.
  const override = text.sticker ? undefined : colorOverride;
  const ink = override ?? style.color;
  const fill = colors ? colors.fg : `rgb(${ink.r},${ink.g},${ink.b})`;

  let attrs = `font-family="&apos;${escapeXml(style.fontId)}&apos;, ${FALLBACK_FAMILY_STACK}"` +
    ` font-size="${fontSize}" dominant-baseline="central"`;
  const weight = effectiveFontWeight(style);
  if (weight !== 400) attrs += ` font-weight="${weight}"`;
  if (style.italic) attrs += ' font-style="italic"';
  attrs += ` fill="${fill}"`;
  // Whole-text ink opacity (v55): `opacity` rather than fill-opacity so the
  // outline stroke and any per-char brush colors fade with the fill, exactly
  // as the DOM layer's CSS opacity does. A sticker's ink is its card scheme's,
  // so its alpha is the WHOLE MAGNET's — card, border, shadow and ink fade
  // together, on the node group below (the Word properties' Opacity page).
  if (!text.sticker && style.alpha != null && style.alpha < 1) {
    attrs += ` opacity="${style.alpha}"`;
  }
  const stickerOpacity = text.sticker && style.alpha != null && style.alpha < 1
    ? ` opacity="${style.alpha}"`
    : '';
  if (style.letterSpacing !== undefined && style.letterSpacing !== 0) {
    // letterSpacing is authored in em units; SVG letter-spacing is a length.
    attrs += ` letter-spacing="${style.letterSpacing * fontSize}"`;
  }
  if (style.stroke && !override) {
    // paint-order="stroke" draws the outline behind the fill, matching
    // the runtime glyph renderer's outline-under-fill compositing.
    const sc = style.stroke.color;
    attrs += ` stroke="rgb(${sc.r},${sc.g},${sc.b})" stroke-width="${style.stroke.width * u}" stroke-linejoin="round" paint-order="stroke"`;
  } else {
    // Unstroked text must say so: the root <svg> carries stroke="white" for
    // the figure paths, and glyphs would otherwise inherit it as a hairline
    // outline that thins them against the DOM layer's.
    attrs += ' stroke="none"';
  }

  let inner = '';
  if (colors) {
    // The card fills the node bbox exactly (bbox === card), bordered and
    // drop-shadowed like the DOM layer's div. CSS draws its border inside
    // the box (border-box sizing) while an SVG stroke straddles the edge,
    // so the rect is inset by half the stroke to land in the same place.
    const bw = STICKER_BORDER_CELLS * u;
    const sh = STICKER_SHADOW_CELLS;
    const filterId = `stk_${text.id}`;
    // Region sized from the shadow's actual reach, like every other effect
    // filter here (`applyNodeEffects`): the old relative ±20% is only a few
    // authored pixels on a small magnet, which clipped the card's shadow with
    // the same hard edge. The outset takes the CSS radius and converts, so
    // this hands it the radius and keeps σ only for the primitive itself.
    const stkSigma = blurSigma(sh.blur) * u;
    const stkOut = effectsFilterOutset({
      shadow: {
        dx: sh.dx * u, dy: sh.dy * u, blur: sh.blur * u,
        color: { r: 0, g: 0, b: 0 }, alpha: sh.opacity,
      },
    });
    inner +=
      `<defs><filter id="${filterId}" filterUnits="userSpaceOnUse"` +
      ` x="${-stkOut.left}" y="${-stkOut.top}"` +
      ` width="${cw + stkOut.left + stkOut.right}" height="${ch + stkOut.top + stkOut.bottom}">` +
      `<feDropShadow dx="${sh.dx * u}" dy="${sh.dy * u}" stdDeviation="${stkSigma}"` +
      ` flood-color="#000000" flood-opacity="${sh.opacity}"/></filter></defs>` +
      `<rect x="${bw / 2}" y="${bw / 2}" width="${cw - bw}" height="${ch - bw}"` +
      ` fill="${colors.bg}" stroke="${colors.fg}" stroke-width="${bw}"` +
      ` filter="url(#${filterId})"/>`;
  }
  // Brush-colored characters (`charColors`) override the base fill per run
  // of same-colored characters — tspans inside the line's <text>, split by
  // the SAME rule the DOM layer splits its spans (charColorRuns), so the two
  // renderers lose kerning at identical boundaries. A sticker's forced ink
  // and a colorOverride both flatten the text to one color, so both drop
  // the per-character brushwork.
  const charColors = colors || override ? undefined : style.charColors;
  const bend = textBend(style);
  // The block's arcs, one per line (textArcPaths — shared with the editor's
  // line layer): every line concentric with the widest one's ring, each on
  // the `central` midline its flat glyphs would center on.
  const arcs = bend !== 0
    ? textArcPaths(layout.lines.map((l) => ({ x: l.x * u, y: (l.y + lineHeight / 2) * u, width: l.width * u })), bend)
    : null;
  for (const [i, line] of layout.lines.entries()) {
    if (line.text.length === 0) continue;
    // Lines carry the align offset from the shared layout, so the export
    // and the DOM layer place them identically; `central` puts the baseline
    // where CSS's half-leading does.
    const lx = line.x * u;
    const ly = (line.y + lineHeight / 2) * u;
    const runs = charColors ? charColorRuns(line.text, line.start, charColors) : null;
    const body = runs && runs.some((r) => r.color !== null)
      ? runs.map((r) => (r.color
        ? `<tspan fill="rgb(${r.color.r},${r.color.g},${r.color.b})">${escapeXml(r.text)}</tspan>`
        : `<tspan>${escapeXml(r.text)}</tspan>`)).join('')
      : escapeXml(line.text);
    if (arcs && line.width > 0) {
      // Bent line: the glyphs ride a <textPath> along the block's arc for
      // it — same `central` baseline, so the path IS the line the flat
      // glyphs would center on and bend → 0 converges on the flat
      // rendering below.
      const pathId = `tba_${text.id}_${i}`;
      inner += `<defs><path id="${pathId}" d="${arcs[i]}" fill="none"/></defs>` +
        `<text ${attrs}><textPath href="#${pathId}">${body}</textPath></text>`;
    } else {
      inner += `<text x="${lx}" y="${ly}" ${attrs}>${body}</text>`;
    }
  }
  if (!inner) return '';
  return `<g${stickerOpacity}>${inner}</g>`;
}

/**
 * Fraction of a line's measured width kept as slack on each side when framing
 * a cutout on the glyphs. Without an app-registered measurer `layoutText`
 * falls back to a deterministic approximation (the engine has no font
 * metrics), while the glyphs themselves are drawn by the browser from the
 * real face, so the two can drift by a few percent — proportionally, since
 * the error accumulates per character. (A registered canvas measurer shrinks
 * the drift to shaping-level noise, but the slack must still cover the
 * fallback.) 4% is comfortably over the drift on ordinary copy without
 * reading as padding.
 */
const MEASURER_SLACK = 0.04;

/**
 * How far a text node's paint can spill past the box it lays out in: the
 * sticker card's fixed drop shadow, plus any authored shadow / glow / border.
 * One scalar applied on all four sides — the sticker's shadow rotates with its
 * card, so a directional outset would be wrong for a tilted magnet, and
 * erring outward costs a hair of margin while erring inward clips paint.
 *
 * Only the cutout framing needs this. A page export is pinned to the page, so
 * a shadow running off the edge is cropped there, as it is on paper.
 */
function textPaintOutset(text: TextObject): number {
  let out = 0;
  if (text.sticker) {
    // Measured the same way as the authored shadow below, so the card's fixed
    // shadow and the filter region that draws it agree — both take the CSS
    // radius and let the outset convert it to σ.
    const s = STICKER_SHADOW_CELLS;
    const o = effectsFilterOutset({
      shadow: {
        dx: s.dx, dy: s.dy, blur: s.blur,
        color: { r: 0, g: 0, b: 0 }, alpha: s.opacity,
      },
    });
    out = Math.max(o.left, o.right, o.top, o.bottom);
  }
  const fx = text.effects;
  if (fx) {
    // The same reach the filter region is sized from, so a cutout can't frame
    // tighter than the shadow the export then draws — that would crop it at
    // the image edge, which is the other way this shadow gets a hard line.
    const o = effectsFilterOutset(fx);
    out = Math.max(out, o.left, o.right, o.top, o.bottom);
  }
  if (fx?.border) {
    const pos = fx.border.position ?? 'center';
    out = Math.max(out, pos === 'outside' ? fx.border.width : pos === 'center' ? fx.border.width / 2 : 0);
  }
  out += textBendRise(text);
  return out;
}

/**
 * The world box a text node actually PAINTS INTO, for cutout framing.
 *
 * A text node's bbox is the box its content is laid out in, and it is usually
 * much bigger than the words: a haiku slot is 28 cells wide whatever the line
 * says, so framing on bboxes would surround the poem with the empty space it
 * was given to grow into. This returns the glyph block instead — the union of
 * the non-empty line boxes — so the cutout zooms to the words themselves.
 *
 * A sticker is the exception, and not a special case: its card is painted to
 * fill its bbox, so on a magnet the bbox already IS the paint.
 *
 * The result is a world axis-aligned box: the node's rotation and mirroring
 * are applied to the local paint rect's corners first (a tilted magnet's
 * corners have to land inside the frame), then the effect outset is added.
 * Null when the node paints nothing — an empty text node, which the generator
 * also skips drawing, must not pad the frame either.
 */
function paintedTextBounds(
  text: TextObject, world: Mat2D,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  // `text` is the node spelled in its OWN space (`localHitObject`) and
  // `world` the matrix that carries that space out, which is exactly what
  // `buildTextSVGContent` is handed — so this measures the box the glyphs
  // are really laid out in, and maps it the way they are really drawn.
  const content = contentBoxCells(text);
  const cw = content.width;
  const ch = content.height;
  // Local paint rect. A sticker's card fills its content box; plain text
  // covers only its laid-out lines. The layout call mirrors
  // buildTextSVGContent's exactly, so the two can't disagree about where the
  // glyphs land.
  let lx = 0, ly = 0, rx = cw, by = ch;
  if (!text.sticker) {
    const layout = layoutText(text.content, text.style, { maxWidth: cw, maxHeight: ch });
    const lineHeight = text.style.size * (text.style.lineHeight ?? DEFAULT_LINE_HEIGHT);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const line of layout.lines) {
      if (line.text.length === 0) continue; // not emitted, so not framed
      // Line widths come from the deterministic measurer, but the glyphs are
      // drawn by the browser from the real font, so the two disagree by a few
      // percent — and the error grows with the line. A slack proportional to
      // the line absorbs it; without it a long line risks losing its last
      // glyph to the viewBox edge. Horizontal only: line height is exactly
      // `size × lineHeight`, font-independent, and already generous over the
      // cap height.
      const slack = line.width * MEASURER_SLACK;
      if (line.x - slack < minX) minX = line.x - slack;
      if (line.x + line.width + slack > maxX) maxX = line.x + line.width + slack;
      if (line.y < minY) minY = line.y;
      if (line.y + lineHeight > maxY) maxY = line.y + lineHeight;
    }
    if (minX === Infinity) return null;
    lx = minX; ly = minY; rx = maxX; by = maxY;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of [[lx, ly], [rx, ly], [rx, by], [lx, by]] as const) {
    const [wx, wy] = matApplyPoint(world, px, py);
    if (wx < minX) minX = wx;
    if (wx > maxX) maxX = wx;
    if (wy < minY) minY = wy;
    if (wy > maxY) maxY = wy;
  }
  const pad = textPaintOutset(text);
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/**
 * Framing-aware inner markup for an image, in the node's local frame space
 * [0,0,iw,ih] (the caller's `<g transform>` handles translate/rotate/mirror).
 * `fu` is the resolved framing already scaled to SVG units (margin/tileGap/
 * offset × U). Fill/Crop draw a cover viewport clipped to the frame; Fit uses
 * `meet` inside a margin inset; Tile fills a `<pattern>`. `tintAttr` (the tint
 * filter ref) rides each `<image>`; `cornerR` (SVG units, 0 = square) rounds
 * the frame clip. Mirrors {@link framedImageStyle} in the DOM preview.
 */
function framedImageSVG(
  fu: ResolvedFraming,
  dataUri: string,
  iw: number,
  ih: number,
  imageAspect: number,
  tintAttr: string,
  cornerR: number,
  idPrefix: string,
): string {
  const round = cornerR > 0;
  const clipId = `frame_${idPrefix}`;
  const clipDef = round
    ? `<defs><clipPath id="${clipId}">` +
      `<rect x="0" y="0" width="${iw}" height="${ih}" rx="${cornerR}" ry="${cornerR}"/></clipPath></defs>`
    : '';
  const clipAttr = round ? ` clip-path="url(#${clipId})"` : '';

  if (fu.mode === 'fit') {
    const m = Math.min(Math.max(0, fu.margin), Math.min(iw, ih) / 2);
    const w = Math.max(0, iw - 2 * m);
    const h = Math.max(0, ih - 2 * m);
    return clipDef +
      `<g${clipAttr}><image x="${m}" y="${m}" width="${w}" height="${h}" ` +
      `href="${dataUri}" preserveAspectRatio="xMidYMid meet"${tintAttr}/></g>`;
  }

  if (fu.mode === 'tile') {
    const g = tileGeometry(iw, ih, imageAspect, fu.tileScale, fu.tileGap);
    const patId = `tilepat_${idPrefix}`;
    return clipDef +
      `<defs><pattern id="${patId}" patternUnits="userSpaceOnUse" ` +
      `x="0" y="0" width="${g.stepX}" height="${g.stepY}">` +
      `<image x="0" y="0" width="${g.tileW}" height="${g.tileH}" href="${dataUri}" ` +
      `preserveAspectRatio="xMidYMid slice"${tintAttr}/></pattern></defs>` +
      `<g${clipAttr}><rect x="0" y="0" width="${iw}" height="${ih}" fill="url(#${patId})"/></g>`;
  }

  // Fill + Crop: the full bitmap drawn at its cover size (scaled by zoom /
  // straighten) and panned by the offset, clipped to the frame; Crop rotates.
  const scale = fu.mode === 'crop' ? straightenCoverScale(fu.angle, iw, ih) : fu.zoom;
  const r = coverImageRect(iw, ih, imageAspect, scale, fu.offsetX, fu.offsetY);
  const image = `<image x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" ` +
    `href="${dataUri}" preserveAspectRatio="xMidYMid slice"${tintAttr}/>`;
  const inner = fu.mode === 'crop' && fu.angle !== 0
    ? `<g transform="rotate(${fu.angle} ${iw / 2} ${ih / 2})">${image}</g>`
    : image;
  if (round) return clipDef + `<g${clipAttr}>${inner}</g>`;
  // Square frame: a nested <svg> viewport clips the overflow to the frame rect.
  return `<svg x="0" y="0" width="${iw}" height="${ih}" overflow="hidden" viewBox="0 0 ${iw} ${ih}">${inner}</svg>`;
}

/**
 * The graph this export reads poses off.
 *
 * The caller's own graph when it describes the arrays that came with it
 * (see {@link CompositionSVGInputs.graph}), else one built from those
 * arrays — one O(n) pass, before any filtering, so every node the export
 * might draw is in it and can be found by id.
 *
 * By id, deliberately, and not by the `content === leaf` identity check
 * the host's `drawnPose.drawnLeafFor` makes: this generator hands its own
 * per-kind loops objects it has REPLACED — an svg recoloured by
 * `strokeColorOverride`, a pattern's derived `patternSVGView` — and those
 * carry the node's id and none of its pose. The graph is still the right
 * answer for them; an identity check would quietly send them back to the
 * legacy fields, which is where a member of a stretched bound group loses
 * its group.
 */
export function exportGraph(input: CompositionSVGInputs): SceneGraph {
  const arrays: Partial<CompositionState> = {
    figures: input.figures,
    svgObjects: input.svgObjects,
    images: input.images,
    texts: input.texts,
    paintObjects: input.paintObjects,
    patternObjects: input.patternObjects,
    groups: input.groups,
    sceneOrder: input.sceneOrder,
  };
  if (input.graph && graphDescribes(input.graph, arrays)) return input.graph;
  return fromLegacy(arrays as CompositionState);
}

/**
 * A leaf as the export draws it: the node, whose content is spelled in its
 * OWN space, and the matrix that puts that space in the world.
 *
 * The same pair the screen draws through (`drawnPose.DrawnLeaf`), read by
 * id — see {@link exportGraph}. The fallback is for a node the graph never
 * saw: the OVERLAY objects are framed and drawn with the scene but are not
 * in its arrays, so they have no node to find, and `leafNodeFromLegacy` is
 * the very conversion `fromLegacy` would have made of them.
 */
export interface ExportPose {
  readonly node: SceneNode;
  readonly world: Mat2D;
  /** The node's content box in its own space. */
  readonly box: Bbox;
  /** `transform` for a `<g>` holding that box's content at the origin, in
   *  SVG units. */
  readonly transform: string;
  /** The box's drawn size in SVG units — its local size through the
   *  matrix's per-axis scale. What the matrix makes of the box, which is
   *  not the box, once a node carries a scale of its own. */
  readonly drawnWidth: number;
  readonly drawnHeight: number;
}

export function exportPose(graph: SceneGraph, kind: CompItemKind, leaf: LegacyLeaf): ExportPose {
  const found = graph.nodes.get(leaf.id);
  const node = found && found.kind !== 'group' ? found : leafNodeFromLegacy(kind, leaf);
  const world = found && found.kind !== 'group'
    ? worldMatrix(graph, leaf.id)
    : localMatrix(node.transform);
  const box = localContentBox(node);
  const { sx, sy } = axisScaleSplit(world);
  return {
    node, world, box,
    // The box's own origin is folded into the matrix, so the content is
    // emitted at [0, 0, w, h] whatever the kind's box is centred on.
    transform: matrixString(matMul(world, matTranslate(box.x, box.y)), SVG_UNITS_PER_L0_CELL),
    drawnWidth: box.width * sx * SVG_UNITS_PER_L0_CELL,
    drawnHeight: box.height * sy * SVG_UNITS_PER_L0_CELL,
  };
}

export async function generateCompositionSVGCore(
  input: CompositionSVGInputs,
  cancelled?: () => boolean,
): Promise<string | null> {
  const { imageBlobs } = input;
  // Where every pose in this document is read from. Built (or adopted)
  // before any filtering, so a node the export might draw is in it — the
  // per-kind loops look up by id and the subset/hidden filters never
  // narrow the ids they can find.
  const graph = exportGraph(input);
  // A node is dropped from the drawn set when its OWN `hidden` flag is set or
  // when it sits inside a hidden group (an inherited hide — the group carries
  // the flag, its members keep their individual settings).
  const hiddenGroups = hiddenGroupIds(input.groups ?? []);
  const shown = (n: { hidden?: boolean; groupId?: string }): boolean =>
    !n.hidden && !(n.groupId !== undefined && hiddenGroups.has(n.groupId));
  let figures = input.figures.filter(shown);
  let svgObjects = input.svgObjects.filter(shown);
  let images = input.images.filter(shown);
  let texts = (input.texts ?? []).filter(shown);
  let paints = (input.paintObjects ?? []).filter(shown);

  // Patterns export through their derived SVGObject views (same id, so
  // sceneOrder / subset / mask resolution all see them as svg nodes —
  // exactly what the canvas renders). Empty patterns bake to null and
  // export as nothing.
  const patternViewIds = new Set<string>();
  // …and a SECOND view of each, baked in the node's own space. A pattern's
  // cells are baked into the frame they are drawn in, so the one the svg
  // loop emits has to be baked in the LOCAL box that its matrix carries;
  // the world view above stays, because the masks, the frame union and
  // `sceneOrder` all still read the scene in world coordinates.
  const localPatternViews = new Map<string, { object: SVGObject; pose: ExportPose }>();
  for (const p of (input.patternObjects ?? []).filter(shown)) {
    const view = patternSVGView(p);
    if (!view) continue;
    svgObjects.push(view);
    patternViewIds.add(view.id);
    const pose = exportPose(graph, 'pattern', p);
    const local = patternSVGView(patternLocalObject(pose.node));
    if (local) localPatternViews.set(view.id, { object: local, pose });
  }

  // The overlay (`overlaySvgObjects`) is framed on with the scene — drawn or
  // not (`drawOverlay`) — so an overlaid export and its plain twin share one
  // frame, with room for the overlay in both.
  const overlay = input.overlaySvgObjects ?? [];
  const drawnOverlay = input.drawOverlay === false ? [] : overlay;

  // Nothing to draw.
  const noObjects = () =>
    figures.length === 0 && svgObjects.length === 0 && images.length === 0
    && texts.length === 0 && paints.length === 0 && drawnOverlay.length === 0;
  if (noObjects()) return null;

  // Active masks resolve from the UNFILTERED svg objects: a hidden mask
  // still clips (invisible-mask behavior) even though it isn't drawn.
  const groups = input.groups ?? [];

  // What the FRAME measures: the drawn set — or, for a cutout that keeps its
  // page's frame (`frameOnScene`), the whole scene as the plain export sees
  // it, so the cutout lays over that export exactly.
  const framed = { figures, svgObjects, images, texts, paints };
  const frameOnScene = !!input.subset && !!input.frameOnScene;

  // Cutout export: narrow the drawn set to the selector's ids. Everything
  // downstream — the bbox union, the viewBox, the background — then sees only
  // this subset, which is what tightens the frame onto it (unless the frame
  // is the page's, `frameOnScene`).
  if (input.subset) {
    const keep = input.subset({ figures, svgObjects, images, texts, paints, groups });
    const kept = (n: { id: string }): boolean => keep.has(n.id);
    figures = figures.filter(kept);
    svgObjects = svgObjects.filter(kept);
    images = images.filter(kept);
    texts = texts.filter(kept);
    paints = paints.filter(kept);
    if (!frameOnScene) Object.assign(framed, { figures, svgObjects, images, texts, paints });
    if (noObjects()) return null;
  }

  // Ink override for line art. Applied to the DRAWN nodes only, and only to
  // what they stroke — geometry is identical, so the bbox union below and the
  // masks (which resolve from the unfiltered scene) see exactly what they would
  // have. Doing it here, once, rather than at each `stroke="…"` site is what
  // keeps the tiled, subpath and endpoint markup from each needing its own
  // notion of the override.
  const strokeInk = input.strokeColorOverride;
  let inkOverride: (s: SVGObject) => SVGObject = (s) => s;
  if (strokeInk) {
    // …and the objects that are nothing BUT fills take it on those too, or
    // they'd sit out the override entirely (see `silhouette`).
    //
    // Asked of the UNFILTERED scene, the same rule the masks below follow:
    // what marks an object as one of these is often a node that is never
    // drawn — a rig is known by its hidden record node — so a selector shown
    // only the drawn subset would find nothing to name. Narrowing still
    // happens, because only the objects actually being drawn are mapped.
    const flooded = input.silhouette?.({
      figures: input.figures,
      svgObjects: input.svgObjects,
      images: input.images,
      texts: input.texts ?? [],
      paints: input.paintObjects ?? [],
      groups,
    });
    // A PATTERN is flooded without being named. Its whole picture is the ink
    // of its tiles — there is no authored fill underneath to preserve, and
    // the bake happens to emit closed tiles as fill paths, so sparing them
    // (the ordinary rule for an area) left every pattern sitting out the
    // override in its own colours while the pen lines beside it went white.
    // Flooding one loses nothing, for the same reason it loses nothing on a
    // rig: the picture IS the silhouette.
    // …and the override may be told to reach only some of them. Asked of the
    // unfiltered scene for the same reason `silhouette` is.
    const only = input.strokeOverrideOnly?.({
      figures: input.figures,
      svgObjects: input.svgObjects,
      images: input.images,
      texts: input.texts ?? [],
      paints: input.paintObjects ?? [],
      groups,
    });
    // One decision, applied twice: to the WORLD objects here (what the
    // masks, the frame union and `patternFillBackground` go on reading) and
    // again to the LOCAL twin each is drawn from below. A pure function of
    // the object, so asking it twice cannot give two answers.
    inkOverride = (s: SVGObject): SVGObject => {
      if (only && !only.has(s.id)) return s;
      return withSVGObjectStrokeColor(
        s, strokeInk,
        flooded?.has(s.id) || patternViewIds.has(s.id) ? { floodFills: true } : undefined,
      );
    };
    svgObjects = svgObjects.map(inkOverride);
  }

  const maskMap = buildActiveMaskMap({
    groups,
    svgObjects: input.svgObjects,
    sceneOrder: input.sceneOrder ?? input.svgObjects.map(s => s.id),
  });
  const maskDefs = buildMaskClipDefs(maskMap, groups);

  // A FRAME's border paints OVER the frame's contents, not with the boundary
  // rect that carries it. A frame's border lives on its boundary rect's
  // `effects` (that rect is the frame's clip mask), and the boundary is the
  // BACK-MOST member of the frame group — so drawing the border with the node
  // buries it under everything inside the frame: a page frame's white mat
  // vanishes entirely behind a full-page photo. The canvas draws it as an
  // overlay just after the frame's clipped run (CanvasSurface's BorderOverlay,
  // outside the clip wrapper), and this mirrors that: the border is stripped
  // from the boundary node's own effects here and emitted after the frame's run
  // in `sceneOrder` below.
  //
  // frameGroupId → the overlay markup; the boundary ids are collected so the
  // paint loop knows which nodes must not draw their own border (and can't
  // draw it twice).
  const frameBorders = new Map<string, string>();
  const frameBorderBoundaryIds = new Set<string>();
  for (const g of groups) {
    if (!g.isFrame || hiddenGroups.has(g.id)) continue;
    const boundary = maskMap.get(g.id);
    const border = boundary?.effects?.border;
    if (!boundary || !border || border.width <= 0) continue;
    // A cutout draws only what its selector asked for, so a frame's border
    // rides along only when the boundary rect itself was selected. (A hidden
    // boundary — the invisible clip rect a frame without a background uses —
    // still shows its border, matching the canvas overlay, which reads the
    // mask's effects regardless of the node's own `hidden`.)
    if (input.subset && !svgObjects.some(s => s.id === boundary.id)) continue;
    // A tilted frame's border turns with it (the clip does the same in
    // buildMaskClipDefs, the canvas overlay in CanvasSurface) — and a
    // stretched one's does not LEAN with it: the scale is split per axis
    // into the rect's own size, leaving a turn on the matrix, so the border
    // stays the width it was authored at through a frame resize. The
    // canvas's `drawnPose.drawnClip` splits it the same way, for the same
    // reason.
    const pose = exportPose(graph, 'svg', boundary);
    const { sx, sy, matrix } = axisScaleSplit(pose.world);
    const borderRect = borderRectForBox(border, {
      cellX: pose.box.x * sx, cellY: pose.box.y * sy,
      cellWidth: pose.box.width * sx, cellHeight: pose.box.height * sy,
    }, SVG_UNITS_PER_L0_CELL);
    frameBorders.set(g.id,
      `<g transform="${matrixString(matrix, SVG_UNITS_PER_L0_CELL)}">${borderRect}</g>`);
    frameBorderBoundaryIds.add(boundary.id);
  }

  // Resolved before the frame is measured as well as used to paint, because a
  // cutout's frame has to allow for the width the strokes will be drawn at.
  const storedStrokeScale = normalizeStrokeScale(input.strokeScale);
  // SVG objects: the composition-wide fallback width restated in SVG units, so
  // an object with no stroke block exports at the SAME world width the DOM
  // node layer draws it at (STROKE_SCALE_CELLS × strokeScale). Passing the
  // stored scale straight through would measure the DOM layer's base-pixel
  // number in SVG units and draw the line 1/16 of its width; the old
  // `effectiveStrokeMultiplier` (×200, MAX_LINE_WIDTH/SVG_STROKE_WIDTH) drew
  // it 12.5× TOO WIDE — a page stroke came out at 3.9 cells against the
  // canvas's 0.3125, which is why every exported drawing read as a fat marker
  // beside the page it was drawn on.
  const svgStrokeScale = strokeScaleForUnits(storedStrokeScale, SVG_UNITS_PER_L0_CELL);
  // Figures keep the legacy ×200: their strokes are baked layer geometry, not
  // the node layer's markup, so they were never on the DOM side of the
  // mismatch above and nothing here re-weights them.
  const effectiveStrokeScale = effectiveStrokeMultiplier(storedStrokeScale);

  // Compute the visible bounding box in L0 cells. Each object's full extent
  // is clipped to its ancestor-mask chain (via clipRectToNodeMasks) so the
  // frame bounds only what the mask leaves visible — content hidden by a mask
  // doesn't pad the thumbnail. With no masks, every clip is a no-op and this
  // reduces to the plain union of object bboxes.
  let minCX = Infinity, minCY = Infinity, maxCX = -Infinity, maxCY = -Infinity;
  // Accumulate the unclipped union too, as a fallback for the degenerate case
  // where every drawn object is clipped away (e.g. a hidden mask leaves no
  // drawn content) — we must never emit an empty/degenerate frame.
  let uMinCX = Infinity, uMinCY = Infinity, uMaxCX = -Infinity, uMaxCY = -Infinity;

  const accept = (
    node: { id: string; groupId?: string },
    rMinX: number, rMinY: number, rMaxX: number, rMaxY: number,
  ) => {
    if (rMinX < uMinCX) uMinCX = rMinX;
    if (rMinY < uMinCY) uMinCY = rMinY;
    if (rMaxX > uMaxCX) uMaxCX = rMaxX;
    if (rMaxY > uMaxCY) uMaxCY = rMaxY;
    const r = clipRectToNodeMasks(maskMap, groups, node, rMinX, rMinY, rMaxX, rMaxY);
    if (!r) return;
    if (r.minX < minCX) minCX = r.minX;
    if (r.minY < minCY) minCY = r.minY;
    if (r.maxX > maxCX) maxCX = r.maxX;
    if (r.maxY > maxCY) maxCY = r.maxY;
  };

  // Cutouts and ink-framed exports frame on the INKED extent: a stroke is
  // centered on its path, so a tight geometric frame slices the outermost
  // strokes down their length (a horizontal line along the top of the bbox
  // loses half its width). Grow each object's rect by its own stroke
  // half-width — 0 for a subset with no paths in it, so the text-only
  // recipes are unaffected. A plain page export keeps the geometric bounds:
  // its frame is already the page, and padding it would move every existing
  // freeform export's viewBox — an export that instead frames on its content
  // opts in via frameInkExtents.
  const inkFramed = (!!input.subset && !frameOnScene) || !!input.frameInkExtents;

  /** A rect in a node's OWN space, as the world AABB of what it draws. */
  const drawnRect = (
    world: Mat2D, x: number, y: number, width: number, height: number,
  ): { minX: number; minY: number; maxX: number; maxY: number } => {
    const b = matApplyBbox(world, { x, y, width, height });
    return { minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height };
  };

  for (const f of framed.figures) {
    // The node's own box through its matrix, like every other kind. The old
    // reading took the stored world rect, which is the nearest UPRIGHT
    // rectangle around a figure inside a group that has been stretched off
    // its axes — the one pose a figure's own fields cannot spell (plan Q1).
    const pose = exportPose(graph, 'figure', f);
    const r = drawnRect(pose.world, 0, 0, pose.box.width, pose.box.height);
    accept(f, r.minX, r.minY, r.maxX, r.maxY);
  }
  for (const entry of overlay.length > 0 ? [...framed.svgObjects, ...overlay] : framed.svgObjects) {
    // Measured in the node's own space and carried out by its matrix, the
    // way it is drawn. A pattern hands over the view baked in its local box;
    // its world twin has no path of its own to measure.
    const pattern = localPatternViews.get(entry.id);
    const pose = pattern ? pattern.pose : exportPose(graph, 'svg', entry);
    const geo = pattern ? null : svgLocalGeometry(pose.node, pose.world, entry);
    const object = pattern ? pattern.object : geo!.object;
    const matrix = pattern ? pose.world : geo!.matrix;
    // Cutouts and ink-framed exports frame on the INKED extent: a stroke is
    // centered on its path, so a tight geometric frame slices the outermost
    // strokes down their length (a horizontal line along the top of the bbox
    // loses half its width). Grow each object's rect by its own stroke
    // half-width — 0 for a subset with no paths in it, so the text-only
    // recipes are unaffected. A plain page export keeps the geometric bounds:
    // its frame is already the page, and padding it would move every existing
    // freeform export's viewBox — an export that instead frames on its content
    // opts in via frameInkExtents.
    const pad = inkFramed
      ? svgStrokeWidthCells(object, svgStrokeScale, SVG_UNITS_PER_L0_CELL) / 2
      : 0;
    const raw = object.tileMode === 'repeat'
      ? { minX: object.cellX, minY: object.cellY,
          maxX: object.cellX + object.cellWidth, maxY: object.cellY + object.cellHeight }
      : arcBoundingBox(object.segments);
    if (!raw) continue;
    const r = drawnRect(
      matrix, raw.minX - pad, raw.minY - pad,
      (raw.maxX - raw.minX) + 2 * pad, (raw.maxY - raw.minY) + 2 * pad,
    );
    accept(entry, r.minX, r.minY, r.maxX, r.maxY);
  }
  for (const img of framed.images) {
    // The node's own box through its matrix — the quad the markup draws.
    // The old reading turned the WORLD box about its centre, which for a
    // quarter-turned non-square image is not the box it occupies at all.
    // Mirrors flip within the box and don't move its bounds.
    const pose = exportPose(graph, 'image', img);
    const r = drawnRect(pose.world, 0, 0, pose.box.width, pose.box.height);
    accept(img, r.minX, r.minY, r.maxX, r.maxY);
  }
  for (const txt of framed.texts) {
    const pose = exportPose(graph, 'text', txt);
    const local = localHitObject(pose.node) as TextObject;
    // A cutout frames on the glyphs, not on the box they were laid out in —
    // see paintedTextBounds. A page export keeps using the node bbox: its
    // viewBox is the page, and tightening it would move every existing
    // freeform export's frame — so does a cutout that keeps the page's frame.
    if (input.subset && !frameOnScene) {
      const b = paintedTextBounds(local, pose.world);
      if (b) accept(txt, b.minX, b.minY, b.maxX, b.maxY);
      continue;
    }
    // The node box, grown first by a bend's bow — glyphs hanging outside the
    // box (textBendRise), a length in the same local units the type is laid
    // out in. Without it a content-framed page export (the journal's) cut
    // bent text off at the flat box; an unbent text's frame is exactly the
    // box, where it always was.
    const bow = textBendRise(local);
    const r = drawnRect(
      pose.world, -bow, -bow, pose.box.width + 2 * bow, pose.box.height + 2 * bow,
    );
    accept(txt, r.minX, r.minY, r.maxX, r.maxY);
  }

  for (const p of framed.paints) {
    // The island's own frame through its matrix. Its box is the ink bounds
    // at last stroke, so a page whose only content is brushwork frames on it.
    const pose = exportPose(graph, 'paint', p);
    const r = drawnRect(pose.world, 0, 0, pose.box.width, pose.box.height);
    accept(p, r.minX, r.minY, r.maxX, r.maxY);
  }

  // Degenerate-frame guard: if masking clipped away every drawn object, fall
  // back to the unclipped union so the thumbnail still frames something.
  if (minCX === Infinity) {
    minCX = uMinCX; minCY = uMinCY; maxCX = uMaxCX; maxCY = uMaxCY;
  }

  // Frame override: when the scene contains Figma-style frames, the export
  // region is exactly the union of the frames' rects (each frame's active
  // rect mask bbox) — fixed page dims including empty areas inside the frame —
  // rather than the tight bounds of the (clipped) content. Content outside the
  // frame is already excluded by the per-node clip (buildMaskClipDefs +
  // wrapWithMaskClip), so this only pins the outer viewBox.
  //
  // A cutout export skips it: `subset` asked for those objects framed on
  // themselves, and pinning to the page would undo the zoom.
  let fMinCX = Infinity, fMinCY = Infinity, fMaxCX = -Infinity, fMaxCY = -Infinity;
  for (const g of input.subset ? [] : groups) {
    if (!g.isFrame) continue;
    const mask = maskMap.get(g.id);
    if (!mask) continue;
    // The region the frame's rect COVERS, which for a tilted frame is the
    // box its turned corners fit in, not the box it is stored as. The clip
    // turns with the rect (buildMaskClipDefs), so a viewBox on the stored
    // box cropped a tilted frame's own corners off its page.
    const pose = exportPose(graph, 'svg', mask);
    const b = matApplyBbox(pose.world, pose.box);
    if (b.x < fMinCX) fMinCX = b.x;
    if (b.y < fMinCY) fMinCY = b.y;
    if (b.x + b.width > fMaxCX) fMaxCX = b.x + b.width;
    if (b.y + b.height > fMaxCY) fMaxCY = b.y + b.height;
  }
  const framePinned = fMinCX !== Infinity;
  if (framePinned) {
    minCX = fMinCX; minCY = fMinCY; maxCX = fMaxCX; maxCY = fMaxCY;
  }

  if (maxCX === minCX) { minCX -= 0.5; maxCX += 0.5; }
  if (maxCY === minCY) { minCY -= 0.5; maxCY += 0.5; }

  // Breathing margin (see viewBoxPadFraction) — content-framed exports only.
  // Applied last, after the degenerate guards, sized off the longer edge so
  // the margin is the same width on all four sides. A frame-pinned export
  // ignores it: the frame IS the page the user (or the format) framed, and
  // padding it would only add page background outside that board — so hosts
  // can pass the pad unconditionally and framed pages keep their exact edge.
  const padFraction = framePinned ? 0 : (input.viewBoxPadFraction ?? 0);
  if (padFraction > 0) {
    const pad = Math.max(maxCX - minCX, maxCY - minCY) * padFraction;
    minCX -= pad; minCY -= pad; maxCX += pad; maxCY += pad;
  }

  const U = SVG_UNITS_PER_L0_CELL;
  const vbX = minCX * U;
  const vbY = minCY * U;
  const bboxW = (maxCX - minCX) * U;
  const bboxH = (maxCY - minCY) * U;

  // Paint markup is collected keyed by node id, then emitted in `sceneOrder`
  // (back→front) so figures, images, and SVG objects z-sort against each other
  // exactly like the live editor's slice ordering. Building it kind-by-kind
  // would force every SVG object on top of every figure/image regardless of
  // scene order — invisible for thin strokes but obvious for opaque fills.
  // Map insertion order (images → figures → svgs) is the legacy paint order,
  // preserved as the fallback when `sceneOrder` is absent.
  const elementsById = new Map<string, string>();

  // Output pixels per SVG unit, for the pixel budget behind
  // `preferOriginalImages` (see rasterLongEdgePx). The raster's LONG edge is
  // the frame's long edge, so one ratio serves both axes. Null when the
  // caller named no raster size — then every image is drawn "as large as it
  // gets" and the master always wins, which is right for an .svg file.
  const frameLongEdge = Math.max(bboxW, bboxH);
  const pxPerUnit = input.rasterLongEdgePx && frameLongEdge > 0
    ? input.rasterLongEdgePx / frameLongEdge
    : null;

  for (const img of images) {
    if (cancelled?.()) return null;
    // The image's LOCAL frame, placed by one matrix (P5 of
    // docs/transform-refactor.md). The content below was already drawn
    // into a local [0, 0, iw, ih] — its framing, border, rounded-corner
    // clip, tint and soften mask all measure from that origin — so the
    // whole of it now scales with the node the way NodeLayer's element
    // does, and the ImageFraming lengths (the Fit letterbox `margin`, the
    // Tile `tileGap`, the offsets) come along for free instead of staying
    // at their authored size inside a grown box.
    const pose = exportPose(graph, 'image', img);
    const iw = pose.box.width * U;
    const ih = pose.box.height * U;
    // Real exports prefer the higher-res original; thumbnails/previews keep
    // the small display blob. Fall back to the display blob whenever the
    // original is absent (old saves, or a source that already fit the cap) —
    // and whenever the master would buy nothing, because this export draws
    // the node no larger than its display copy already is (rasterLongEdgePx).
    // The DRAWN edge, not the local one: a node inside a stretched group
    // puts more pixels on the raster than its own box asks for.
    const bytes = (input.preferOriginalImages && img.originalImageId
      && drawsAboveDisplayCopy(img, pxPerUnit, Math.max(pose.drawnWidth, pose.drawnHeight))
      ? imageBlobs[img.originalImageId]
      : undefined) ?? imageBlobs[img.imageId];
    if (!bytes) continue;
    const dataUri = `data:${img.mimeType};base64,${toBase64(bytes)}`;
    const opacityAttr = img.opacity != null && img.opacity < 1
      ? ` opacity="${img.opacity}"`
      : '';
    // Tint is a filter on the <image> element itself; node effects wrap
    // the outer group. Nesting (not merging) the filters keeps the order
    // correct — the shadow/glow is cast by the already-tinted image —
    // and both stay independently valid SVG.
    let tintDefs = '';
    let tintAttr = '';
    if (img.tint) {
      const tintId = `tint_${img.id}`;
      tintDefs = `<defs><filter id="${tintId}" color-interpolation-filters="sRGB">` +
        `<feColorMatrix type="matrix" values="${tintToFeColorMatrix(img.tint)}"/></filter></defs>`;
      tintAttr = ` filter="url(#${tintId})"`;
    }
    // Rounded corners: clip the <image> to a rounded rect of its own box, so
    // the tint (a filter on the same element) and any wrapping node effects
    // all follow the rounded shape.
    let clipDefs = '';
    let clipAttr = '';
    const cornerR = img.cornerRadius ? Math.min(0.5, img.cornerRadius) * Math.min(iw, ih) : 0;
    if (cornerR > 0) {
      const clipId = `round_${img.id}`;
      clipDefs = `<defs><clipPath id="${clipId}">` +
        `<rect x="0" y="0" width="${iw}" height="${ih}" rx="${cornerR}" ry="${cornerR}"/></clipPath></defs>`;
      clipAttr = ` clip-path="url(#${clipId})"`;
    }
    // Framing (Crop bar) replaces the legacy stretch: Fill/Fit/Crop/Tile lay
    // the bitmap out inside the frame (see framedImageSVG). Untouched images
    // keep the exact `preserveAspectRatio="none"` stretch for back-compat.
    let framedContent: string;
    if (img.framing) {
      const rf = resolveFraming(img.framing);
      const fu: ResolvedFraming = {
        ...rf,
        margin: rf.margin * U,
        tileGap: rf.tileGap * U,
        offsetX: rf.offsetX * U,
        offsetY: rf.offsetY * U,
      };
      const imageAspect = img.pixelHeight > 0 ? img.pixelWidth / img.pixelHeight : 1;
      framedContent = framedImageSVG(fu, dataUri, iw, ih, imageAspect, tintAttr, cornerR, img.id);
    } else {
      framedContent = clipDefs +
        `<image x="0" y="0" width="${iw}" height="${ih}" ` +
        `href="${dataUri}" preserveAspectRatio="none"${tintAttr}${clipAttr}/>`;
    }
    // Node effects (shadow/glow filter + border) are applied in the image's
    // LOCAL frame [0,0,iw,ih] and then wrapped by the transform group below,
    // so they rotate/mirror with the bitmap — matching the editor preview and
    // the svg-object path (whose effects also sit inside the rotation). The
    // filter therefore operates in the rotated user space (offset turns with
    // the image) and the border rect rides along instead of staying axis-
    // aligned. Opacity stays on the image content so the border/shadow aren't
    // dimmed with it.
    // v35 gradient tint overlay (design 6a): a rect of the tint Paint blended
    // over the bitmap, clipped to the (rounded) frame, wrapped with the image
    // in an isolated group so the blend is confined to the image (matching the
    // editor preview's `isolation: isolate`). Sits inside the image's local
    // content so a drop shadow is cast by the already-tinted image.
    let tintedContent = framedContent;
    if (img.tintFill) {
      const p = paintToSvg(tintFillToPaint(img.tintFill), `tintfill_${img.id}`);
      const foAttr = p.fillOpacity != null ? ` fill-opacity="${p.fillOpacity}"` : '';
      let ovClipDefs = '';
      let ovClipAttr = '';
      if (cornerR > 0) {
        const ovClipId = `tintfillclip_${img.id}`;
        ovClipDefs = `<defs><clipPath id="${ovClipId}">` +
          `<rect x="0" y="0" width="${iw}" height="${ih}" rx="${cornerR}" ry="${cornerR}"/></clipPath></defs>`;
        ovClipAttr = ` clip-path="url(#${ovClipId})"`;
      }
      const overlay = ovClipDefs + (p.defs ? `<defs>${p.defs}</defs>` : '') +
        `<rect x="0" y="0" width="${iw}" height="${ih}" fill="${p.fill}"${foAttr}` +
        ` opacity="${img.tintFill.opacity}" style="mix-blend-mode:${img.tintFill.blend}"${ovClipAttr}/>`;
      tintedContent = `<g style="isolation:isolate">${framedContent}${overlay}</g>`;
    }
    // v48 color-tool paint overlay: the low-res brush layer stretched over
    // the image's local frame and blended with its one mode, clipped and
    // isolated exactly like the tint overlay above (its own isolate group,
    // so tint blends against the image and paint blends against the tinted
    // result — the editor preview's layer order). The PNG comes from the
    // engine encoder shared with the DOM layer, so the two can't drift.
    if (img.paintOverlay) {
      const po = img.paintOverlay;
      let ovClipDefs = '';
      let ovClipAttr = '';
      if (cornerR > 0) {
        const ovClipId = `paintclip_${img.id}`;
        ovClipDefs = `<defs><clipPath id="${ovClipId}">` +
          `<rect x="0" y="0" width="${iw}" height="${ih}" rx="${cornerR}" ry="${cornerR}"/></clipPath></defs>`;
        ovClipAttr = ` clip-path="url(#${ovClipId})"`;
      }
      const overlay = ovClipDefs +
        `<image x="0" y="0" width="${iw}" height="${ih}" href="${overlayPngDataUri(po)}"` +
        ` preserveAspectRatio="none" style="mix-blend-mode:${paintBlendCss(po.blend) ?? 'normal'}"${ovClipAttr}/>`;
      tintedContent = `<g style="isolation:isolate">${tintedContent}${overlay}</g>`;
    }
    // v42 edge soften: an eroded-then-blurred silhouette mask over the framed
    // content — a white rect of the (rounded) frame, eroded inward by half
    // the feather depth (`edgeSoften × half the shorter side`) and blurred by
    // a fifth of it, so the ramp's 2.5σ tail ENDS at the frame edge: the edge
    // is at 0 opacity, fully opaque a feather-depth in (a plain blur would
    // leave the edge at ~50%; same math as wrapSVGObjectOpacity for shapes).
    // A mask (not a filter on the content) so the bitmap itself is untouched;
    // regions are explicit userSpaceOnUse boxes in the image's LOCAL frame
    // because the defaults resolve against the viewport (see the
    // stroke-alignment mask's caveat in svgPathBuilder).
    let softenDefs = '';
    let softenAttr = '';
    const soften = img.edgeSoften != null ? Math.max(0, Math.min(1, img.edgeSoften)) : 0;
    if (soften > 0 && iw > 0 && ih > 0) {
      const depth = soften * 0.5 * Math.min(iw, ih);
      const erode = depth / 2;
      const sigma = depth / 5;
      const pad = sigma * 3 + U;
      const softenFilterId = `softenf_${img.id}`;
      const softenMaskId = `softenm_${img.id}`;
      const region = `x="${-pad}" y="${-pad}" width="${iw + 2 * pad}" height="${ih + 2 * pad}"`;
      const rxAttr = cornerR > 0 ? ` rx="${cornerR}" ry="${cornerR}"` : '';
      softenDefs = `<defs><filter id="${softenFilterId}" filterUnits="userSpaceOnUse" ${region}>`
        + `<feMorphology operator="erode" radius="${erode}"/>`
        + `<feGaussianBlur stdDeviation="${sigma}"/></filter>`
        + `<mask id="${softenMaskId}" maskUnits="userSpaceOnUse" ${region}>`
        + `<g filter="url(#${softenFilterId})">`
        + `<rect x="0" y="0" width="${iw}" height="${ih}"${rxAttr} fill="white"/></g>`
        + `</mask></defs>`;
      softenAttr = ` mask="url(#${softenMaskId})"`;
    }
    const localContent = opacityAttr || softenAttr
      ? softenDefs + `<g${opacityAttr}${softenAttr}>${tintedContent}</g>`
      : tintedContent;
    const effected = applyNodeEffects(
      localContent, img.effects, img.id,
      { cellX: 0, cellY: 0, cellWidth: pose.box.width, cellHeight: pose.box.height, cornerRadius: img.cornerRadius },
      U,
    );
    const imgMarkup = tintDefs + `<g transform="${pose.transform}">${effected}</g>`;
    elementsById.set(img.id, wrapWithMaskClip(imgMarkup, maskMap, groups, img));
  }

  for (const p of paints) {
    if (cancelled?.()) return null;
    if (p.tiles.length === 0 || !(p.contentW > 0) || !(p.contentH > 0)) continue;
    // The island's LOCAL frame, placed by one matrix. It is the frame the
    // old `orientedInnerStyle` recipe built by hand — dims swapped on a
    // quarter turn, centred back in the world bbox — which is exactly what
    // the node's local box is and what its matrix does with it, so both
    // the swap and the centring step below are gone.
    const pose = exportPose(graph, 'paint', p);
    const iw = pose.box.width * U;
    const ih = pose.box.height * U;
    // ONE <image> for the whole island: its sparse tiles flattened into a
    // single bitmap over the content rect, stretched onto the inner frame.
    // Not one per tile — a rasterizer fades every image's edge texels into
    // the transparency around it, so tile-sized images meet in hairline
    // seams (a faint grid across any wash wider than a tile). Export-time
    // flatten + PNG encode is fine here — this path never runs per-frame,
    // which is also why an ink override can be done in the TEXELS (exact,
    // and no filter for the rasterizer to get wrong) rather than as an SVG
    // color matrix over them.
    const flat = flattenPaintTiles(p);
    if (!flat) continue;
    const tileImages = `<image x="0" y="0" width="${iw}" height="${ih}"` +
      ` href="${overlayPngDataUri(flat, input.paintColorOverride)}" preserveAspectRatio="none"/>`;
    const opacityAttr = p.opacity != null && p.opacity < 1 ? ` opacity="${p.opacity}"` : '';
    // Edge soften: the images' eroded-then-blurred silhouette mask, built in
    // the INNER frame's coordinates so it stays glued to the tiles through
    // the centering translate below (see the image loop for the ramp math).
    let softenDefs = '';
    let softenAttr = '';
    const soften = p.edgeSoften != null ? Math.max(0, Math.min(1, p.edgeSoften)) : 0;
    if (soften > 0 && iw > 0 && ih > 0) {
      const depth = soften * 0.5 * Math.min(iw, ih);
      const erode = depth / 2;
      const sigma = depth / 5;
      const pad = sigma * 3 + U;
      const softenFilterId = `softenf_${p.id}`;
      const softenMaskId = `softenm_${p.id}`;
      const region = `x="${-pad}" y="${-pad}" width="${iw + 2 * pad}" height="${ih + 2 * pad}"`;
      softenDefs = `<defs><filter id="${softenFilterId}" filterUnits="userSpaceOnUse" ${region}>`
        + `<feMorphology operator="erode" radius="${erode}"/>`
        + `<feGaussianBlur stdDeviation="${sigma}"/></filter>`
        + `<mask id="${softenMaskId}" maskUnits="userSpaceOnUse" ${region}>`
        + `<g filter="url(#${softenFilterId})">`
        + `<rect x="0" y="0" width="${iw}" height="${ih}" fill="white"/></g>`
        + `</mask></defs>`;
      softenAttr = ` mask="url(#${softenMaskId})"`;
    }
    const localContent = opacityAttr || softenAttr
      ? softenDefs + `<g${opacityAttr}${softenAttr}>${tileImages}</g>`
      : tileImages;
    const paintMarkup = `<g transform="${pose.transform}">${localContent}</g>`;
    elementsById.set(p.id, wrapWithMaskClip(paintMarkup, maskMap, groups, p));
  }

  for (const fig of figures) {
    if (cancelled?.()) return null;

    const figPose = exportPose(graph, 'figure', fig);
    // A figure draws in its CONTENT frame — its box at the origin, its quads
    // as they are stored — which is the frame the hit test already measures
    // one in (`quadSpinDeg`), and `frame.toNode` is the way back out of it.
    //
    // What goes onto the matrix and what stays on the object is the whole of
    // this: the MIRRORS are pose, so they go, and the builders would
    // otherwise apply them a second time. The quarter `rotation` STAYS,
    // because for a figure that is not a pose at all but an instruction about
    // CONTENT — which way to lay the cached art into a box whose width and
    // height the same quarter has already swapped. `toNode` divides that
    // quarter back out of the frame and the world matrix puts it on again, so
    // the two cancel and the builder's turn is the only one left.
    const figFrame = leafHitFrame(figPose.node, figPose.world);
    const figTransform = matrixString(matMul(figPose.world, figFrame.toNode), U);
    const localFig: CompositionFigure = {
      ...fig,
      cellX: 0, cellY: 0,
      cellWidth: figFrame.box.width, cellHeight: figFrame.box.height,
      mirrorH: false, mirrorV: false,
    };

    let content: string | null = null;

    if (fig.fileId) {
      const fileState = await input.loadFigure(fig.fileId);
      if (fileState) {
        const fileConfig: FileConfig = {
          id: fig.fileId,
          name: '',
          widthL0: fileState.widthL0,
          heightL0: fileState.heightL0,
          originL0X: fileState.originL0X,
          originL0Y: fileState.originL0Y,
          clipBox: fileState.clipBox ?? undefined,
        };
        const result = exportLayersToSVGInner(fileState.layers, fileConfig);
        const cached: CachedFigureSVG = {
          elements: simplifySVG(result.elements),
          svgWidth: result.widthL0 * U,
          svgHeight: result.heightL0 * U,
        };

        content = fig.tileMode === 'repeat'
          ? buildBlockSVGContent(localFig, cached, effectiveStrokeScale, true)
          : buildFigureSVGContent(localFig, cached, effectiveStrokeScale);
      }
    }

    if (!content && input.loadBakedFigurePng) {
      const dataUri = await input.loadBakedFigurePng(fig);
      if (dataUri) {
        const fw = figFrame.box.width * U;
        const fh = figFrame.box.height * U;
        const imageSvg = `<image x="0" y="0" width="${fw}" height="${fh}" ` +
          `href="${dataUri}" preserveAspectRatio="none"/>`;
        content = wrapWithColorOverride(imageSvg, fig);
      }
    }

    // Pattern-fill background: a solid rect of the sibling mask's fillColor
    // painted under the tiles (clipped to the mask), so the shape's background
    // color shows through the gaps in the pattern.
    const bg = patternFillBackground(fig, svgObjects);
    let bgRect = '';
    if (bg) {
      const { r, g, b } = bg.fillColor;
      const oa = bg.fillOpacity != null && bg.fillOpacity < 1 ? ` fill-opacity="${bg.fillOpacity}"` : '';
      bgRect = `<rect x="0" y="0" ` +
        `width="${figFrame.box.width * U}" height="${figFrame.box.height * U}" ` +
        `fill="rgb(${r},${g},${b})"${oa} stroke="none" />`;
    }

    if (content || bgRect) {
      const figMarkup = `<g transform="${figTransform}">${bgRect}${content ?? ''}</g>`;
      elementsById.set(fig.id, wrapWithMaskClip(figMarkup, maskMap, groups, fig));
    }
  }

  // The overlay paints after the scene's own objects — it is not in
  // `sceneOrder`, so the emission below appends it after every ordered node,
  // and with no order it follows insertion order, which is this loop's. The
  // plain twin of an overlaid export frames on it (above) but skips it here.
  /**
   * What an svg-loop entry actually draws: its content in the NODE's own
   * space, and the `transform` that carries that space to the world.
   *
   * A pattern hands over the view baked in its local box. Everything else
   * goes through `svgLocalGeometry`, the reader the node layer draws from
   * — which grows the path by the matrix's uniform scale and divides that
   * scale back out of the matrix, so a stroke width (a WORLD quantity the
   * markup draws in user space) stays the authored width through a pinch.
   * `entry` carries the non-geometry fields, which is how an object the
   * generator has REPLACED — one recoloured by `strokeColorOverride` —
   * keeps its new colours while taking the node's exact geometry.
   */
  const svgDrawnContent = (entry: SVGObject): { object: SVGObject; transform: string } => {
    const pattern = localPatternViews.get(entry.id);
    if (pattern) return { object: inkOverride(pattern.object), transform: pattern.pose.transform };
    const pose = exportPose(graph, 'svg', entry);
    const geo = svgLocalGeometry(pose.node, pose.world, entry);
    return { object: geo.object, transform: matrixString(geo.matrix, U) };
  };

  /**
   * The node's markup, posed and then clipped — in that order, so an
   * ancestor group's "Use as mask" clips in WORLD space. The old emission
   * wrapped the rotation OUTSIDE the clip, which clipped a turned node
   * against a turned copy of the mask; the image path has always nested
   * them this way round.
   */
  const posedAndClipped = (
    id: string, node: { id: string; groupId?: string }, transform: string, markup: string,
  ): void => {
    elementsById.set(id, wrapWithMaskClip(
      `<g transform="${transform}">${markup}</g>`, maskMap, groups, node,
    ));
  };

  for (const entry of drawnOverlay.length > 0 ? [...svgObjects, ...drawnOverlay] : svgObjects) {
    if (cancelled?.()) return null;
    if (entry.segments.length === 0) continue;
    const drawn = svgDrawnContent(entry);
    const svg = drawn.object;
    if (svg.tileMode === 'repeat') {
      // Pattern mode: the shared region builder (also the live DOM layer's
      // path via buildSVGObjectContent) emits the repeating markup — the
      // sparse-override <g>-per-copy expansion or the <pattern> + rect.
      posedAndClipped(entry.id, entry, drawn.transform, applyNodeEffects(
        buildTiledSVGObjectRegionMarkup(svg, svgStrokeScale),
        svg.effects, entry.id, svg, U,
      ));
      continue;
    }
    // Per-object stroke (width / radius / position / dash) comes from the same
    // helper the live DOM layer uses, so an authored stroke can't render one
    // way on the canvas and another in the export. Export draws in SVG units,
    // hence `U` as the unit-per-cell and no non-scaling vector-effect. An
    // object with no stroke block gets exactly the legacy attrs.
    const strokePres = svgStrokePresentation(svg, svgStrokeScale, U);
    const attrs = strokePres.attrs;
    const strokeSegments = strokePres.segments;
    const strokeDefs = strokePres.defs;
    // Fill path — rendered before strokes. The paint (fill / fill-opacity /
    // blend, and any gradient defs) comes from the same helper the live DOM
    // layer uses, so an authored fill can't render one way on the canvas and
    // another in the export. A pattern-fill mask is skipped in there: it
    // renders outline only, its fill painted as the tiled figure's background.
    let fillElement = '';
    const fillPres = svgFillPresentation(svg, `grad_${svg.id}`);
    // Fill (and the paint layer's clip) follow the same (possibly
    // corner-rounded) outline the stroke does. Built loop by loop, exactly as
    // the live DOM layer builds it (buildClosedFillPathD): a shape whose
    // outline is SEVERAL closed loops — a merge of two closed shapes, a union
    // with a hole — fills every loop under `fill-rule="nonzero"`. Chaining it
    // into one path instead, as this did, filled nothing at all for those:
    // they have no single chain, so the export dropped a fill the canvas drew.
    const closedD = fillPres || svg.paintOverlay ? buildClosedFillPathD(strokeSegments) : '';
    if (fillPres && closedD) {
      fillElement = `${fillPres.defs}<path d="${closedD}" ${fillPres.attrs} stroke="none" fill-rule="nonzero" />`;
    }
    // v49 color-tool paint layer: the low-res bitmap clipped to the shape's
    // outline and isolated with the fill, exactly as buildSVGObjectContent
    // emits it for the live DOM layer — same shared markup helper, so the
    // export can't drift from the canvas.
    if (svg.paintOverlay && closedD) {
      const overlay = shapePaintOverlaySVG(
        svg.paintOverlay, entry.id, closedD,
        svg.cellX * U, svg.cellY * U, svg.cellWidth * U, svg.cellHeight * U,
      );
      fillElement = `<g style="isolation:isolate">${fillElement}${overlay}</g>`;
    }

    let paths = strokeDefs + fillElement;
    if (Array.isArray(svg.subpaths) && svg.subpaths.length > 0) {
      const radius = svgStrokeRadiusCells(svg);
      // Fill subpaths first so stroke subpaths draw on top (matches
      // buildSVGObjectContent in svgPathBuilder.ts).
      for (const sub of svg.subpaths) {
        if (!sub.fill) continue;
        const fd = buildClosedFillPathD(sub.segments);
        if (fd) {
          const { r, g, b } = sub.color;
          paths += `<path d="${fd}" fill="rgb(${r},${g},${b})" stroke="none" fill-rule="nonzero" />`;
        }
      }
      for (const sub of svg.subpaths) {
        if (sub.fill) continue;
        const d = buildPathD(radius > 0 ? roundPathCorners(sub.segments, radius) : sub.segments);
        if (d) {
          const { r, g, b } = sub.color;
          paths += `<path d="${d}" ${attrs} stroke="rgb(${r},${g},${b})" />`;
        }
      }
    } else {
      const d = buildPathD(strokeSegments);
      if (d) {
        const { r, g, b } = svg.color;
        paths += `<path d="${d}" ${attrs} stroke="rgb(${r},${g},${b})" />`;
      }
    }
    // Endpoint decorations last, on top of the stroke they cap. Same helper
    // the live DOM layer uses, so an arrow can't point one way on the canvas
    // and another in the export.
    paths += svgEndpointsMarkup(svg, strokeSegments, svgStrokeWidthCells(svg, svgStrokeScale, U));
    // Whole-object opacity + edge soften (the Opacity bar) wrap everything
    // the object drew, INSIDE the node effects so a drop shadow is cast by
    // the already-faded shape. Same helper as the live DOM layer.
    paths = wrapSVGObjectOpacity(svg, paths, svgStrokeScale);
    if (paths) {
      // A frame boundary's border is emitted as an overlay over the frame's
      // whole run instead (see frameBorders) — its shadow/glow still belong
      // to the node, behind the frame's contents.
      const effects = frameBorderBoundaryIds.has(entry.id)
        ? { ...svg.effects, border: undefined }
        : svg.effects;
      posedAndClipped(entry.id, entry, drawn.transform,
        applyNodeEffects(paths, effects, entry.id, svg, U));
    }
  }

  for (const txt of texts) {
    if (cancelled?.()) return null;
    // Laid out in the node's LOCAL box with the CONTENT's own style, and
    // placed by one matrix — what NodeLayer does. The legacy view scales a
    // scaled node's `style.size` into world cells and grows its box to
    // match; the content underneath is at scale 1 against the local box,
    // and the matrix stretches the glyphs. Reading the view here instead
    // would lay out type sized for the grown box inside the local one.
    const pose = exportPose(graph, 'text', txt);
    const content = buildTextSVGContent(
      localHitObject(pose.node) as TextObject, U, input.textColorOverride,
    );
    if (!content) continue;
    // The authored shadow goes with the page it was cast against — see
    // dropTextShadow. Only that one: a sticker's fixed card shadow is added
    // downstream, with the card.
    const effects = input.dropTextShadow && txt.effects?.shadow
      ? { ...txt.effects, shadow: undefined }
      : txt.effects;
    // The effects wrap the posed group, not the content inside it, which is
    // what keeps a text shadow a WORLD size — the one kind whose shadow the
    // screen deliberately does not scale with the node
    // (`effectsBoxShadow.worldOffsetInNodeFrame`).
    elementsById.set(txt.id, wrapWithMaskClip(
      applyNodeEffects(`<g transform="${pose.transform}">${content}</g>`, effects, txt.id, txt, U),
      maskMap, groups, txt,
    ));
  }

  // Emit in scene order (back→front). Ids missing from `sceneOrder` (or the
  // whole map when `sceneOrder` is absent) fall back to insertion order, which
  // is the legacy images→figures→svgs paint order.
  const allElements: string[] = [];
  const order = input.sceneOrder;
  if (order && order.length > 0) {
    // Frame borders go in right after the frame's last member. A group's
    // members are contiguous in `sceneOrder`, so that lands the border over the
    // frame's own content and under anything painted after it — exactly where
    // the canvas puts its overlay. Membership is read from the UNFILTERED nodes
    // so a hidden member still ends the run at the same place the canvas does.
    const borderAfterIndex = new Map<number, string>();
    const placedFrames = new Set<string>();
    if (frameBorders.size > 0) {
      const groupIdByNode = new Map<string, string | undefined>();
      for (const n of input.figures) groupIdByNode.set(n.id, n.groupId);
      for (const n of input.svgObjects) groupIdByNode.set(n.id, n.groupId);
      for (const n of input.images) groupIdByNode.set(n.id, n.groupId);
      for (const n of input.texts ?? []) groupIdByNode.set(n.id, n.groupId);
      const lastIndexByFrame = new Map<string, number>();
      order.forEach((id, i) => {
        const fid = frameGroupIdForNode(groups, groupIdByNode.get(id));
        if (fid !== undefined && frameBorders.has(fid)) lastIndexByFrame.set(fid, i);
      });
      for (const [fid, i] of lastIndexByFrame) {
        borderAfterIndex.set(i, frameBorders.get(fid)!);
        placedFrames.add(fid);
      }
    }
    const emitted = new Set<string>();
    order.forEach((id, i) => {
      const el = elementsById.get(id);
      if (el !== undefined) { allElements.push(el); emitted.add(id); }
      const border = borderAfterIndex.get(i);
      if (border) allElements.push(border);
    });
    for (const [id, el] of elementsById) {
      if (!emitted.has(id)) allElements.push(el);
    }
    // A frame with no member in `sceneOrder` (a bare board, or a legacy record
    // whose order is incomplete) still gets its border, on top.
    for (const [fid, border] of frameBorders) {
      if (!placedFrames.has(fid)) allElements.push(border);
    }
  } else {
    for (const el of elementsById.values()) allElements.push(el);
    for (const border of frameBorders.values()) allElements.push(border);
  }

  const compName = (input.name ?? 'composition').replace(/[^a-zA-Z0-9_-]/g, '_');

  // Font embedding: when a resolver is provided and yields WOFF2 bytes
  // for a used font, emit an @font-face <style> block so text renders
  // with the right glyphs in standalone viewers (and in the <img>-based
  // PNG rasterizer, which cannot reach page-registered fonts). Without a
  // resolver, families are referenced by name only.
  let fontStyleBlock = '';
  if (input.fontResolver && texts.length > 0) {
    const faces: string[] = [];
    const seen = new Set<string>();
    for (const txt of texts) {
      const fontId = txt.style.fontId;
      if (seen.has(fontId)) continue;
      seen.add(fontId);
      const resolved = await input.fontResolver(fontId);
      if (resolved?.woff2Base64) {
        faces.push(
          `@font-face{font-family:"${escapeXml(fontId)}";` +
          `src:url(data:font/woff2;base64,${resolved.woff2Base64}) format("woff2");}`,
        );
      }
    }
    if (faces.length > 0) fontStyleBlock = `<style>${faces.join('')}</style>`;
  }

  // Canvas background: a full-viewBox rect painted behind everything.
  // Gradient backgrounds emit their def alongside the rect. A cutout export
  // omits it — the point of one is the objects on transparency.
  let backgroundRect = '';
  if (input.background && !input.subset) {
    const p = paintToSvg(input.background, 'bg_paint');
    const oa = p.fillOpacity !== undefined ? ` fill-opacity="${p.fillOpacity}"` : '';
    backgroundRect = (p.defs ? `<defs>${p.defs}</defs>` : '') +
      `<rect x="${vbX}" y="${vbY}" width="${bboxW}" height="${bboxH}" fill="${p.fill}"${oa} stroke="none"/>`;
  }

  // A backdrop: a translucent wash over the whole frame, under everything
  // drawn, a cutout's too (see `backdrop`).
  let backdropRect = '';
  if (input.backdrop) {
    const p = paintToSvg(input.backdrop, 'backdrop_paint');
    const oa = p.fillOpacity !== undefined ? ` fill-opacity="${p.fillOpacity}"` : '';
    backdropRect = (p.defs ? `<defs>${p.defs}</defs>` : '') +
      `<rect x="${vbX}" y="${vbY}" width="${bboxW}" height="${bboxH}" fill="${p.fill}"${oa} stroke="none"/>`;
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg id="${compName}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${bboxW / 10}" height="${bboxH / 10}" ` +
    `viewBox="${vbX} ${vbY} ${bboxW} ${bboxH}" ` +
    `fill="none" stroke="white">`,
    ...(fontStyleBlock ? [fontStyleBlock] : []),
    ...(backgroundRect ? [backgroundRect] : []),
    ...(backdropRect ? [backdropRect] : []),
    ...(maskDefs ? [maskDefs] : []),
    ...allElements,
    `</svg>`,
  ].join('\n');
}
