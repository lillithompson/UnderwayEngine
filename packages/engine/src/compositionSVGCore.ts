/**
 * Pure composition→SVG generator. No IndexedDB, no DOM, no WebGL — just
 * composition data in, SVG document string out. The browser path
 * (`compositionExport.ts::exportCompositionSVG`) threads IndexedDB through
 * the loaders; the module is kept pure so Node-side tooling can call it
 * with pre-deserialized embedded files.
 */

import { CompositionFigure, FileConfig, SVGObject, ImageObject, PaintObject, PatternObject, TextObject, Layer, ClipBox, GroupNode, Paint, NodeEffects, BorderEffect, RGBColor } from './types';
import { patternSVGView } from './patternObjectRender';
import { effectiveFontWeight } from './fontWeight';
import { toBase64 } from './pngcodec';
import { exportLayersToSVGInner, SVG_UNITS_PER_L0_CELL } from './svgExport';
import { buildFigureSVGContent, buildBlockSVGContent, wrapWithColorOverride, type CachedFigureSVG } from './svgFigureBuilders';
import { buildPathD, buildClosedFillPathD, buildTiledSVGObjectRegionMarkup, svgFillPresentation, svgStrokePresentation, withSVGObjectStrokeColor, wrapSVGObjectOpacity } from './svgPathBuilder';
import { roundPathCorners, strokeScaleForUnits, svgStrokeRadiusCells, svgStrokeWidthCells } from './svgStroke';
import { svgEndpointsMarkup } from './svgEndpoints';
import { rotatePointAboutCW } from './compositionArcMath';
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
import { overlayPngDataUri, paintBlendCss, shapePaintOverlaySVG } from './imagePaintOverlay';
import { islandHeightCells } from './canvasPaint';
import { charColorRuns, DEFAULT_LINE_HEIGHT, layoutText } from './textLayout';
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
  /** Raw composition-level stroke scale (0–1). Normalized internally. */
  strokeScale?: number;
  /**
   * Grow the export frame by this fraction of the frame's LONGER edge on
   * every side — a uniform breathing margin around the content, painted with
   * the canvas background (which covers the full viewBox) or left
   * transparent/backdrop-colored when there is none. For exports whose frame
   * is the tight content union (an unframed freeform page), where the
   * outermost marks would otherwise touch the image edge. 0/absent keeps the
   * exact frame every existing export has.
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
   */
  paintColorOverride?: RGBColor;
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
   *  blob; real file exports (SVG/PNG/zip) turn it on for full fidelity. */
  preferOriginalImages?: boolean;
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
  const tx = text.cellX * u;
  const ty = text.cellY * u;
  const tw = text.cellWidth * u;
  const th = text.cellHeight * u;

  // Node transform — same pattern as image nodes: position, then rotate
  // about the bbox center, then mirror within the bbox.
  const parts: string[] = [`translate(${tx}, ${ty})`];
  // Free rotation is layered OUTERMOST (about the bbox center), matching the
  // editor's render order, then the discrete rotation + mirror.
  if (text.angleDeg) parts.push(`rotate(${text.angleDeg} ${tw / 2} ${th / 2})`);
  const rot = text.rotation ?? 0;
  if (rot !== 0) parts.push(`rotate(${rot} ${tw / 2} ${th / 2})`);
  if (text.mirrorH) parts.push(`translate(${tw}, 0) scale(-1, 1)`);
  if (text.mirrorV) parts.push(`translate(0, ${th}) scale(1, -1)`);

  // A sticker's node bbox IS its card: the scaffold already grew the box by
  // the interior margin on every side, so the text lays out against the full
  // bbox here exactly as it does in the DOM layer. Insetting again would
  // wrap earlier than the editor does.
  const layout = layoutText(text.content, style, {
    maxWidth: text.cellWidth,
    maxHeight: text.cellHeight,
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
      ` width="${tw + stkOut.left + stkOut.right}" height="${th + stkOut.top + stkOut.bottom}">` +
      `<feDropShadow dx="${sh.dx * u}" dy="${sh.dy * u}" stdDeviation="${stkSigma}"` +
      ` flood-color="#000000" flood-opacity="${sh.opacity}"/></filter></defs>` +
      `<rect x="${bw / 2}" y="${bw / 2}" width="${tw - bw}" height="${th - bw}"` +
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
  for (const line of layout.lines) {
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
    inner += `<text x="${lx}" y="${ly}" ${attrs}>${body}</text>`;
  }
  if (!inner) return '';
  return `<g transform="${parts.join(' ')}">${inner}</g>`;
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
  return out;
}

/** Rotate (x, y) clockwise by `deg` about (cx, cy) in the y-down world frame —
 *  the forward of {@link unrotatePointForNode}, matching the `rotate()` the
 *  text markup emits. The shared primitive, so the markup here and the bake in
 *  compositionMergeObjects can't drift apart on which way a twist turns. */
const rotateAboutCW = rotatePointAboutCW;

/**
 * Axis-aligned bounds of a rect after rotating it `deg` clockwise about
 * (cx, cy) — the frame-side counterpart of the `rotate()` transform the paint
 * markup emits for images, texts, and freely-rotated SVG objects. The frame
 * must measure the corners where the viewer will actually see them: a
 * rotated node bounded by its unrotated box pokes out of the frame (up to
 * ~40% of a long shape at 45°), which for a page-pinned export merely hangs
 * off the page but for a content-framed one is clipped out of the image.
 * `deg` 0/undefined returns the rect unchanged.
 */
function rotatedRectAabb(
  minX: number, minY: number, maxX: number, maxY: number,
  deg: number | undefined, cx: number, cy: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  if (!deg) return { minX, minY, maxX, maxY };
  let rMinX = Infinity, rMinY = Infinity, rMaxX = -Infinity, rMaxY = -Infinity;
  for (const [x, y] of [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]] as const) {
    const [wx, wy] = rotateAboutCW(x, y, cx, cy, deg);
    if (wx < rMinX) rMinX = wx;
    if (wy < rMinY) rMinY = wy;
    if (wx > rMaxX) rMaxX = wx;
    if (wy > rMaxY) rMaxY = wy;
  }
  return { minX: rMinX, minY: rMinY, maxX: rMaxX, maxY: rMaxY };
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
  text: TextObject,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const tw = text.cellWidth;
  const th = text.cellHeight;
  // Local paint rect. A sticker's card fills the bbox; plain text covers only
  // its laid-out lines. The layout call mirrors buildTextSVGContent's exactly,
  // so the two can't disagree about where the glyphs land.
  let lx = 0, ly = 0, rx = tw, by = th;
  if (!text.sticker) {
    const layout = layoutText(text.content, text.style, { maxWidth: tw, maxHeight: th });
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

  // Through the node transform, in the order buildTextSVGContent composes it:
  // mirrors innermost, then the discrete rotation, then the free rotation.
  const cx = tw / 2;
  const cy = th / 2;
  const rot = text.rotation ?? 0;
  const toWorld = (x: number, y: number): [number, number] => {
    if (text.mirrorV) y = th - y;
    if (text.mirrorH) x = tw - x;
    if (rot) [x, y] = rotateAboutCW(x, y, cx, cy, rot);
    if (text.angleDeg) [x, y] = rotateAboutCW(x, y, cx, cy, text.angleDeg);
    return [text.cellX + x, text.cellY + y];
  };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of [[lx, ly], [rx, ly], [rx, by], [lx, by]] as const) {
    const [wx, wy] = toWorld(px, py);
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

export async function generateCompositionSVGCore(
  input: CompositionSVGInputs,
  cancelled?: () => boolean,
): Promise<string | null> {
  const { imageBlobs } = input;
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
  for (const p of (input.patternObjects ?? []).filter(shown)) {
    const view = patternSVGView(p);
    if (view) svgObjects.push(view);
  }

  // Nothing to draw.
  const noObjects = () =>
    figures.length === 0 && svgObjects.length === 0 && images.length === 0
    && texts.length === 0 && paints.length === 0;
  if (noObjects()) return null;

  // Active masks resolve from the UNFILTERED svg objects: a hidden mask
  // still clips (invisible-mask behavior) even though it isn't drawn.
  const groups = input.groups ?? [];

  // Cutout export: narrow the drawn set to the selector's ids. Everything
  // downstream — the bbox union, the viewBox, the background — then sees only
  // this subset, which is what tightens the frame onto it.
  if (input.subset) {
    const keep = input.subset({ figures, svgObjects, images, texts, paints, groups });
    const kept = (n: { id: string }): boolean => keep.has(n.id);
    figures = figures.filter(kept);
    svgObjects = svgObjects.filter(kept);
    images = images.filter(kept);
    texts = texts.filter(kept);
    paints = paints.filter(kept);
    if (noObjects()) return null;
  }

  // Ink override for line art. Applied to the DRAWN nodes only, and only to
  // what they stroke — geometry is identical, so the bbox union below and the
  // masks (which resolve from the unfiltered scene) see exactly what they would
  // have. Doing it here, once, rather than at each `stroke="…"` site is what
  // keeps the tiled, subpath and endpoint markup from each needing its own
  // notion of the override.
  const strokeInk = input.strokeColorOverride;
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
    svgObjects = svgObjects.map((s) => withSVGObjectStrokeColor(
      s, strokeInk, flooded?.has(s.id) ? { floodFills: true } : undefined,
    ));
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
    frameBorders.set(g.id, borderRectForBox(border, boundary, SVG_UNITS_PER_L0_CELL));
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

  for (const f of figures) {
    accept(f, f.cellX, f.cellY, f.cellX + f.cellWidth, f.cellY + f.cellHeight);
  }
  // Cutouts and ink-framed exports frame on the INKED extent: a stroke is
  // centered on its path, so a tight geometric frame slices the outermost
  // strokes down their length (a horizontal line along the top of the bbox
  // loses half its width). Grow each object's rect by its own stroke
  // half-width — 0 for a subset with no paths in it, so the text-only
  // recipes are unaffected. A plain page export keeps the geometric bounds:
  // its frame is already the page, and padding it would move every existing
  // freeform export's viewBox — an export that instead frames on its content
  // opts in via frameInkExtents.
  const inkFramed = !!input.subset || !!input.frameInkExtents;
  for (const svg of svgObjects) {
    const pad = inkFramed
      ? svgStrokeWidthCells(svg, svgStrokeScale, SVG_UNITS_PER_L0_CELL) / 2
      : 0;
    const raw = svg.tileMode === 'repeat'
      ? { minX: svg.cellX, minY: svg.cellY,
          maxX: svg.cellX + svg.cellWidth, maxY: svg.cellY + svg.cellHeight }
      : arcBoundingBox(svg.segments);
    if (!raw) continue;
    // Free rotation is a rotate() about the NODE-BOX center in the emitted
    // markup (discrete rotation is baked into the segments), so the frame
    // measures the padded geometry through that same rotation.
    const r = rotatedRectAabb(
      raw.minX - pad, raw.minY - pad, raw.maxX + pad, raw.maxY + pad,
      svg.angleDeg, svg.cellX + svg.cellWidth / 2, svg.cellY + svg.cellHeight / 2,
    );
    accept(svg, r.minX, r.minY, r.maxX, r.maxY);
  }
  for (const img of images) {
    // The markup rotates an image about its box center — free rotation
    // outermost, then the discrete step; same center, so the angles sum for
    // the corners' world positions. Mirrors flip within the box and don't
    // move its bounds.
    const r = rotatedRectAabb(
      img.cellX, img.cellY, img.cellX + img.cellWidth, img.cellY + img.cellHeight,
      (img.angleDeg ?? 0) + (img.rotation ?? 0),
      img.cellX + img.cellWidth / 2, img.cellY + img.cellHeight / 2,
    );
    accept(img, r.minX, r.minY, r.maxX, r.maxY);
  }
  for (const txt of texts) {
    // A cutout frames on the glyphs, not on the box they were laid out in —
    // see paintedTextBounds (which applies the node rotation itself). A page
    // export keeps using the node bbox: its viewBox is the page, and
    // tightening it would move every existing freeform export's frame.
    if (input.subset) {
      const b = paintedTextBounds(txt);
      if (b) accept(txt, b.minX, b.minY, b.maxX, b.maxY);
      continue;
    }
    // Same rotation story as images: both transforms spin about the box
    // center in the markup (buildTextSVGContent), so the frame follows the
    // rotated corners.
    const r = rotatedRectAabb(
      txt.cellX, txt.cellY, txt.cellX + txt.cellWidth, txt.cellY + txt.cellHeight,
      (txt.angleDeg ?? 0) + (txt.rotation ?? 0),
      txt.cellX + txt.cellWidth / 2, txt.cellY + txt.cellHeight / 2,
    );
    accept(txt, r.minX, r.minY, r.maxX, r.maxY);
  }

  for (const p of paints) {
    // Same rotation story as images: contentRect maps onto the bbox and
    // both transforms spin about the box center in the markup, so the frame
    // follows the rotated corners. The bbox is the ink bounds at last
    // stroke, so a page whose only content is brushwork frames on it.
    const r = rotatedRectAabb(
      p.cellX, p.cellY, p.cellX + p.cellWidth, p.cellY + p.cellHeight,
      (p.angleDeg ?? 0) + (p.rotation ?? 0),
      p.cellX + p.cellWidth / 2, p.cellY + p.cellHeight / 2,
    );
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
    if (mask.cellX < fMinCX) fMinCX = mask.cellX;
    if (mask.cellY < fMinCY) fMinCY = mask.cellY;
    if (mask.cellX + mask.cellWidth > fMaxCX) fMaxCX = mask.cellX + mask.cellWidth;
    if (mask.cellY + mask.cellHeight > fMaxCY) fMaxCY = mask.cellY + mask.cellHeight;
  }
  if (fMinCX !== Infinity) {
    minCX = fMinCX; minCY = fMinCY; maxCX = fMaxCX; maxCY = fMaxCY;
  }

  if (maxCX === minCX) { minCX -= 0.5; maxCX += 0.5; }
  if (maxCY === minCY) { minCY -= 0.5; maxCY += 0.5; }

  // Breathing margin (see viewBoxPadFraction). Applied last — after frame
  // pinning and the degenerate guards — so it pads whatever frame the rules
  // above settled on, and sized off the longer edge so the margin is the same
  // width on all four sides.
  const padFraction = input.viewBoxPadFraction ?? 0;
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

  for (const img of images) {
    if (cancelled?.()) return null;
    // Real exports prefer the higher-res original; thumbnails/previews keep
    // the small display blob. Fall back to the display blob whenever the
    // original is absent (old saves, or a source that already fit the cap).
    const bytes = (input.preferOriginalImages && img.originalImageId
      ? imageBlobs[img.originalImageId]
      : undefined) ?? imageBlobs[img.imageId];
    if (!bytes) continue;
    const dataUri = `data:${img.mimeType};base64,${toBase64(bytes)}`;
    const ix = img.cellX * U;
    const iy = img.cellY * U;
    const iw = img.cellWidth * U;
    const ih = img.cellHeight * U;
    const cx = iw / 2;
    const cy = ih / 2;
    const parts: string[] = [`translate(${ix}, ${iy})`];
    // Free rotation is layered OUTERMOST (about the bbox center), matching
    // the editor's render order, then the discrete rotation + mirror.
    if (img.angleDeg) parts.push(`rotate(${img.angleDeg} ${cx} ${cy})`);
    const rot = img.rotation ?? 0;
    if (rot !== 0) parts.push(`rotate(${rot} ${cx} ${cy})`);
    if (img.mirrorH) parts.push(`translate(${iw}, 0) scale(-1, 1)`);
    if (img.mirrorV) parts.push(`translate(0, ${ih}) scale(1, -1)`);
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
      { cellX: 0, cellY: 0, cellWidth: img.cellWidth, cellHeight: img.cellHeight, cornerRadius: img.cornerRadius },
      U,
    );
    const imgMarkup = tintDefs + `<g transform="${parts.join(' ')}">${effected}</g>`;
    elementsById.set(img.id, wrapWithMaskClip(imgMarkup, maskMap, groups, img));
  }

  for (const p of paints) {
    if (cancelled?.()) return null;
    if (p.tiles.length === 0 || !(p.contentW > 0) || !(p.contentH > 0)) continue;
    const w = p.cellWidth * U;
    const h = p.cellHeight * U;
    // Inner content frame: dims swapped for 90/270, centered in the bbox —
    // the orientedInnerStyle recipe the DOM node layer uses, so the export
    // and the editor rotate the same pixels the same way.
    const rot = p.rotation ?? 0;
    const swapped = rot === 90 || rot === 270;
    const iw = swapped ? h : w;
    const ih = swapped ? w : h;
    const cx = w / 2;
    const cy = h / 2;
    const parts: string[] = [`translate(${p.cellX * U}, ${p.cellY * U})`];
    // Free rotation outermost (about the bbox center), then the discrete
    // rotation + mirror — the image transform recipe.
    if (p.angleDeg) parts.push(`rotate(${p.angleDeg} ${cx} ${cy})`);
    if (rot !== 0) parts.push(`rotate(${rot} ${cx} ${cy})`);
    if (p.mirrorH) parts.push(`translate(${w}, 0) scale(-1, 1)`);
    if (p.mirrorV) parts.push(`translate(0, ${h}) scale(1, -1)`);
    // One <image> per sparse tile, positioned by its contentRect-normalized
    // rect in the inner frame. Export-time PNG encode is fine here — this
    // path never runs per-frame, which is also why an ink override can be
    // done in the TEXELS (exact, and no filter for the rasterizer to get
    // wrong) rather than as an SVG color matrix over them.
    const paintInk = input.paintColorOverride;
    let tileImages = '';
    for (const tile of p.tiles) {
      const tx = ((tile.x - p.contentX) / p.contentW) * iw;
      const ty = ((tile.y - p.contentY) / p.contentH) * ih;
      const tw = (tile.widthCells / p.contentW) * iw;
      const th = (islandHeightCells(tile) / p.contentH) * ih;
      tileImages += `<image x="${tx}" y="${ty}" width="${tw}" height="${th}"` +
        ` href="${overlayPngDataUri(tile.overlay, paintInk)}" preserveAspectRatio="none"/>`;
    }
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
    const maskedTiles = opacityAttr || softenAttr
      ? softenDefs + `<g${opacityAttr}${softenAttr}>${tileImages}</g>`
      : tileImages;
    // Center the inner frame in the bbox (no-op unless dims swapped).
    const localContent = swapped
      ? `<g transform="translate(${(w - iw) / 2}, ${(h - ih) / 2})">${maskedTiles}</g>`
      : maskedTiles;
    const paintMarkup = `<g transform="${parts.join(' ')}">${localContent}</g>`;
    elementsById.set(p.id, wrapWithMaskClip(paintMarkup, maskMap, groups, p));
  }

  for (const fig of figures) {
    if (cancelled?.()) return null;

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
          ? buildBlockSVGContent(fig, cached, effectiveStrokeScale, true)
          : buildFigureSVGContent(fig, cached, effectiveStrokeScale);
      }
    }

    if (!content && input.loadBakedFigurePng) {
      const dataUri = await input.loadBakedFigurePng(fig);
      if (dataUri) {
        const fx = fig.cellX * U;
        const fy = fig.cellY * U;
        const fw = fig.cellWidth * U;
        const fh = fig.cellHeight * U;
        const imageSvg = `<image x="${fx}" y="${fy}" width="${fw}" height="${fh}" ` +
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
      bgRect = `<rect x="${fig.cellX * U}" y="${fig.cellY * U}" ` +
        `width="${fig.cellWidth * U}" height="${fig.cellHeight * U}" ` +
        `fill="rgb(${r},${g},${b})"${oa} stroke="none" />`;
    }

    if (content || bgRect) {
      elementsById.set(fig.id, wrapWithMaskClip(bgRect + (content ?? ''), maskMap, groups, fig));
    }
  }

  for (const svg of svgObjects) {
    if (cancelled?.()) return null;
    if (svg.segments.length === 0) continue;
    if (svg.tileMode === 'repeat') {
      // Pattern mode: the shared region builder (also the live DOM layer's
      // path via buildSVGObjectContent) emits the repeating markup — the
      // sparse-override <g>-per-copy expansion or the <pattern> + rect.
      elementsById.set(svg.id, wrapWithMaskClip(applyNodeEffects(
        buildTiledSVGObjectRegionMarkup(svg, svgStrokeScale),
        svg.effects, svg.id, svg, U,
      ), maskMap, groups, svg));
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
        svg.paintOverlay, svg.id, closedD,
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
      const effects = frameBorderBoundaryIds.has(svg.id)
        ? { ...svg.effects, border: undefined }
        : svg.effects;
      elementsById.set(svg.id, wrapWithMaskClip(
        applyNodeEffects(paths, effects, svg.id, svg, U),
        maskMap, groups, svg,
      ));
    }

    // Free rotation (v30+): wrap whatever this svg emitted in a group that
    // rotates it about its bbox center, matching the editor render. SVG's
    // discrete rotation is baked into the segments, so this is the only
    // rotation transform an svg node carries.
    const svgEl = elementsById.get(svg.id);
    if (svgEl && svg.angleDeg) {
      const scx = (svg.cellX + svg.cellWidth / 2) * U;
      const scy = (svg.cellY + svg.cellHeight / 2) * U;
      elementsById.set(svg.id, `<g transform="rotate(${svg.angleDeg} ${scx} ${scy})">${svgEl}</g>`);
    }
  }

  for (const txt of texts) {
    if (cancelled?.()) return null;
    const content = buildTextSVGContent(txt, U, input.textColorOverride);
    if (!content) continue;
    // The authored shadow goes with the page it was cast against — see
    // dropTextShadow. Only that one: a sticker's fixed card shadow is added
    // downstream, with the card.
    const effects = input.dropTextShadow && txt.effects?.shadow
      ? { ...txt.effects, shadow: undefined }
      : txt.effects;
    elementsById.set(txt.id, wrapWithMaskClip(
      applyNodeEffects(content, effects, txt.id, txt, U),
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

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg id="${compName}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${bboxW / 10}" height="${bboxH / 10}" ` +
    `viewBox="${vbX} ${vbY} ${bboxW} ${bboxH}" ` +
    `fill="none" stroke="white">`,
    ...(fontStyleBlock ? [fontStyleBlock] : []),
    ...(backgroundRect ? [backgroundRect] : []),
    ...(maskDefs ? [maskDefs] : []),
    ...allElements,
    `</svg>`,
  ].join('\n');
}
