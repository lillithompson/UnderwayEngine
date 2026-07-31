/**
 * Pure composition→SVG generator. No IndexedDB, no DOM, no WebGL — just
 * composition data in, SVG document string out. The browser path
 * (`compositionExport.ts::exportCompositionSVG`) threads IndexedDB through
 * the loaders; the module is kept pure so Node-side tooling can call it
 * with pre-deserialized embedded files.
 */

import { CompositionFigure, FileConfig, SVGObject, ImageObject, TextObject, Layer, ClipBox, GroupNode, Paint, NodeEffects } from './types';
import { toBase64 } from './pngcodec';
import { exportLayersToSVGInner, SVG_UNITS_PER_L0_CELL, SVG_STROKE_WIDTH } from './svgExport';
import { buildFigureSVGContent, buildBlockSVGContent, wrapWithColorOverride, type CachedFigureSVG } from './svgFigureBuilders';
import { buildPathD, buildTilePathD, buildExpandedTileSVGObjectContent } from './svgPathBuilder';
import { chainSegments } from './compositionArcMath';
import { arcBoundingBox } from './compositionArcHitTest';
import { buildActiveMaskMap, clipRectToNodeMasks } from './compositionMask';
import { buildMaskClipDefs, wrapWithMaskClip } from './compositionMaskSVG';
import { effectiveStrokeMultiplier, normalizeStrokeScale } from './strokeScale';
import { simplifySVG } from './simplifySVG';
import { patternFillBackground } from './patternFill';
import { paintToSvg, effectsToSvgFilter, tintToFeColorMatrix, borderToSvgRect } from './paintSvg';
import { layoutText } from './textLayout';

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
 * name only — the viewer must have the font installed/registered.
 */
export type SVGFontResolver = (fontId: string) => { woff2Base64?: string } | null;

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
    out.shadow = { ...effects.shadow, dx: effects.shadow.dx * u, dy: effects.shadow.dy * u, blur: effects.shadow.blur * u };
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

/**
 * Wrap node markup with its NodeEffects: shadow/glow become a `<filter>`
 * def referenced by a wrapping `<g>`; a border becomes a stroked rect
 * drawn OVER the content, axis-aligned at the node's stored bbox —
 * matching the compositor's border pass (which strokes the world bbox,
 * not the rotated content). Def ids are prefixed with the node id so
 * multiple effected nodes coexist in one document.
 */
function applyNodeEffects(
  markup: string,
  effects: NodeEffects | undefined,
  nodeId: string,
  node: { cellX: number; cellY: number; cellWidth: number; cellHeight: number },
  u: number,
): string {
  if (!effects) return markup;
  const scaled = scaleEffectsToSvgUnits(effects, u);
  let out = markup;
  const { defs, filterRef } = effectsToSvgFilter(scaled, `fx_${nodeId}`);
  if (defs && filterRef) {
    out = `<defs>${defs}</defs><g filter="${filterRef}">${out}</g>`;
  }
  if (scaled.border) {
    out += borderToSvgRect(scaled.border, {
      cellX: node.cellX * u,
      cellY: node.cellY * u,
      cellWidth: node.cellWidth * u,
      cellHeight: node.cellHeight * u,
    });
  }
  return out;
}

/** Sticker padding between the rounded-rect background and the text, in
 *  em units of the text's font size. Also used as the corner radius. */
const STICKER_PAD_EM = 0.35;

/** Approximate ascent (baseline offset from the line top) in em units.
 *  Matches the deterministic default measurer's spirit: exact metrics
 *  come from the app's fonts; export uses a stable approximation so
 *  output doesn't depend on platform font APIs. */
const TEXT_ASCENT_EM = 0.8;

/**
 * Build SVG markup for a text node: one `<text>` element per layout line
 * (via `layoutText` with the default deterministic measurer), wrapped in
 * the same translate/rotate/mirror group images use. Layout runs in
 * world units against the node's bbox width, then scales into SVG units.
 * Sticker nodes get a padded rounded-rect background behind the lines.
 */
function buildTextSVGContent(text: TextObject, u: number): string {
  const style = text.style;
  const tx = text.cellX * u;
  const ty = text.cellY * u;
  const tw = text.cellWidth * u;
  const th = text.cellHeight * u;

  // Node transform — same pattern as image nodes: position, then rotate
  // about the bbox center, then mirror within the bbox.
  const parts: string[] = [`translate(${tx}, ${ty})`];
  const rot = text.rotation ?? 0;
  if (rot !== 0) parts.push(`rotate(${rot} ${tw / 2} ${th / 2})`);
  if (text.mirrorH) parts.push(`translate(${tw}, 0) scale(-1, 1)`);
  if (text.mirrorV) parts.push(`translate(0, ${th}) scale(1, -1)`);

  // Sticker padding insets the text from the bbox edge; the wrap width
  // shrinks to match so wrapped lines stay inside the rect.
  const pad = text.sticker ? style.size * STICKER_PAD_EM : 0;
  const wrapWidth = Math.max(text.cellWidth - 2 * pad, style.size * 0.1);
  const layout = layoutText(text.content, style, { maxWidth: wrapWidth });

  const fontSize = style.size * u;
  const align = style.align ?? 'left';
  // Anchor x in world units, relative to the wrap box. 'start' is the SVG
  // default, so text-anchor is only emitted for center/right.
  const anchorWorldX = pad + (align === 'left' ? 0 : align === 'center' ? wrapWidth / 2 : wrapWidth);
  const anchorAttr = align === 'left' ? '' : ` text-anchor="${align === 'center' ? 'middle' : 'end'}"`;

  let attrs = `font-family="${escapeXml(style.fontId)}" font-size="${fontSize}"`;
  if (style.bold) attrs += ' font-weight="bold"';
  if (style.italic) attrs += ' font-style="italic"';
  attrs += ` fill="rgb(${style.color.r},${style.color.g},${style.color.b})"`;
  if (style.letterSpacing !== undefined && style.letterSpacing !== 0) {
    // letterSpacing is authored in em units; SVG letter-spacing is a length.
    attrs += ` letter-spacing="${style.letterSpacing * fontSize}"`;
  }
  if (style.stroke) {
    // paint-order="stroke" draws the outline behind the fill, matching
    // the runtime glyph renderer's outline-under-fill compositing.
    const sc = style.stroke.color;
    attrs += ` stroke="rgb(${sc.r},${sc.g},${sc.b})" stroke-width="${style.stroke.width * u}" stroke-linejoin="round" paint-order="stroke"`;
  }

  let inner = '';
  if (text.sticker) {
    // Padded rounded-rect background behind the lines. Fills the node
    // bbox (the padding lives between the rect edge and the text).
    const r = pad * u;
    inner += `<rect x="0" y="0" width="${tw}" height="${th}" rx="${r}" fill="#ffffff"/>`;
  }
  for (const line of layout.lines) {
    if (line.text.length === 0) continue;
    const lx = anchorWorldX * u;
    // Baseline = line top + approximate ascent.
    const ly = (pad + line.y + style.size * TEXT_ASCENT_EM) * u;
    inner += `<text x="${lx}" y="${ly}" ${attrs}${anchorAttr}>${escapeXml(line.text)}</text>`;
  }
  if (!inner) return '';
  return `<g transform="${parts.join(' ')}">${inner}</g>`;
}

export async function generateCompositionSVGCore(
  input: CompositionSVGInputs,
  cancelled?: () => boolean,
): Promise<string | null> {
  const { imageBlobs } = input;
  const figures = input.figures.filter(f => !f.hidden);
  const svgObjects = input.svgObjects.filter(s => !s.hidden);
  const images = input.images.filter(i => !i.hidden);
  const texts = (input.texts ?? []).filter(t => !t.hidden);
  if (figures.length === 0 && svgObjects.length === 0 && images.length === 0 && texts.length === 0) return null;

  // Active masks resolve from the UNFILTERED svg objects: a hidden mask
  // still clips (invisible-mask behavior) even though it isn't drawn.
  const groups = input.groups ?? [];
  const maskMap = buildActiveMaskMap({
    groups,
    svgObjects: input.svgObjects,
    sceneOrder: input.sceneOrder ?? input.svgObjects.map(s => s.id),
  });
  const maskDefs = buildMaskClipDefs(maskMap, groups);

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
  for (const svg of svgObjects) {
    if (svg.tileMode === 'repeat') {
      accept(svg, svg.cellX, svg.cellY, svg.cellX + svg.cellWidth, svg.cellY + svg.cellHeight);
    } else {
      const bb = arcBoundingBox(svg.segments);
      if (bb) accept(svg, bb.minX, bb.minY, bb.maxX, bb.maxY);
    }
  }
  for (const img of images) {
    accept(img, img.cellX, img.cellY, img.cellX + img.cellWidth, img.cellY + img.cellHeight);
  }
  for (const txt of texts) {
    accept(txt, txt.cellX, txt.cellY, txt.cellX + txt.cellWidth, txt.cellY + txt.cellHeight);
  }

  // Degenerate-frame guard: if masking clipped away every drawn object, fall
  // back to the unclipped union so the thumbnail still frames something.
  if (minCX === Infinity) {
    minCX = uMinCX; minCY = uMinCY; maxCX = uMaxCX; maxCY = uMaxCY;
  }

  if (maxCX === minCX) { minCX -= 0.5; maxCX += 0.5; }
  if (maxCY === minCY) { minCY -= 0.5; maxCY += 0.5; }

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
  const effectiveStrokeScale = effectiveStrokeMultiplier(normalizeStrokeScale(input.strokeScale));

  for (const img of images) {
    if (cancelled?.()) return null;
    const bytes = imageBlobs[img.imageId];
    if (!bytes) continue;
    const dataUri = `data:${img.mimeType};base64,${toBase64(bytes)}`;
    const ix = img.cellX * U;
    const iy = img.cellY * U;
    const iw = img.cellWidth * U;
    const ih = img.cellHeight * U;
    const cx = iw / 2;
    const cy = ih / 2;
    const parts: string[] = [`translate(${ix}, ${iy})`];
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
    const imgMarkup = tintDefs + clipDefs +
      `<g transform="${parts.join(' ')}"${opacityAttr}>` +
      `<image x="0" y="0" width="${iw}" height="${ih}" ` +
      `href="${dataUri}" preserveAspectRatio="none"${tintAttr}${clipAttr}/></g>`;
    elementsById.set(img.id, wrapWithMaskClip(
      applyNodeEffects(imgMarkup, img.effects, img.id, img, U),
      maskMap, groups, img,
    ));
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
    const sw = SVG_STROKE_WIDTH * effectiveStrokeScale;
    const attrs = `fill="none" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;
    // Fill path — rendered before strokes. A pattern-fill mask renders outline
    // only: its `fillColor` is painted as the tiled figure's background below.
    let fillElement = '';
    if ((svg.fillPaint || svg.fillColor) && !svg.isPatternFill) {
      const chained = chainSegments(svg.segments);
      if (chained) {
        const fd = (svg.tileMode === 'repeat'
          ? buildTilePathD(chained, svg.cellX + (svg.tileOffsetXL0 ?? 0), svg.cellY + (svg.tileOffsetYL0 ?? 0))
          : buildPathD(chained)) + ' Z';
        if (svg.fillPaint) {
          // fillPaint (v29+) takes precedence over the legacy fillColor.
          // Gradient geometry is unit-bbox space → objectBoundingBox defs
          // resolve against this path's own bbox. Def id is node-prefixed
          // so multiple gradient fills coexist in one document.
          const p = paintToSvg(svg.fillPaint, `grad_${svg.id}`);
          const oa = p.fillOpacity !== undefined ? ` fill-opacity="${p.fillOpacity}"` : '';
          fillElement = (p.defs ? `<defs>${p.defs}</defs>` : '') +
            `<path d="${fd}" fill="${p.fill}"${oa} stroke="none" fill-rule="nonzero" />`;
        } else {
          const { r, g, b } = svg.fillColor!;
          const oa = svg.fillOpacity != null && svg.fillOpacity < 1 ? ` fill-opacity="${svg.fillOpacity}"` : '';
          fillElement = `<path d="${fd}" fill="rgb(${r},${g},${b})"${oa} stroke="none" fill-rule="nonzero" />`;
        }
      }
    }

    if (svg.tileMode === 'repeat' && svg.segmentOverrides && svg.segmentOverrides.size > 0) {
      // Sparse per-copy paint: a `<pattern>` can't express different colors per
      // repeated copy, so expand into one editable `<g>` per visible copy with
      // overrides baked in. Clipped to the region by the wrapping `<svg>`.
      const regionX = svg.cellX * U, regionY = svg.cellY * U;
      const regionW = svg.cellWidth * U, regionH = svg.cellHeight * U;
      const instances = buildExpandedTileSVGObjectContent(svg, effectiveStrokeScale);
      elementsById.set(svg.id, wrapWithMaskClip(applyNodeEffects(
        `<svg x="${regionX}" y="${regionY}" width="${regionW}" height="${regionH}" overflow="hidden" ` +
        `viewBox="${regionX} ${regionY} ${regionW} ${regionH}">${instances}</svg>`,
        svg.effects, svg.id, svg, U,
      ), maskMap, groups, svg));
    } else if (svg.tileMode === 'repeat') {
      // Use the tile-grid anchor (cellX + tileOffset) so the content stays
      // at a fixed position in the pattern tile regardless of region
      // expansion. See svgPathBuilder.ts:buildSVGObjectTileContent for the
      // full explanation of the double-shift bug this prevents.
      const sMinX = svg.cellX + (svg.tileOffsetXL0 ?? 0);
      const sMinY = svg.cellY + (svg.tileOffsetYL0 ?? 0);
      let tileContent = fillElement;
      if (Array.isArray(svg.subpaths) && svg.subpaths.length > 0) {
        for (const sub of svg.subpaths) {
          const d = buildTilePathD(sub.segments, sMinX, sMinY);
          if (d) {
            const { r, g, b } = sub.color;
            tileContent += `<path d="${d}" ${attrs} stroke="rgb(${r},${g},${b})" />`;
          }
        }
      } else {
        const d = buildTilePathD(svg.segments, sMinX, sMinY);
        const { r, g, b } = svg.color;
        tileContent += `<path d="${d}" ${attrs} stroke="rgb(${r},${g},${b})" />`;
      }
      const tileW = (svg.tileWidthL0 ?? svg.cellWidth) * U;
      const tileH = (svg.tileHeightL0 ?? svg.cellHeight) * U;
      const regionW = svg.cellWidth * U;
      const regionH = svg.cellHeight * U;
      const regionX = svg.cellX * U;
      const regionY = svg.cellY * U;
      const patOrgX = regionX + (svg.tileOffsetXL0 ?? 0) * U;
      const patOrgY = regionY + (svg.tileOffsetYL0 ?? 0) * U;
      const patId = `pat_svg_${svg.id}`;
      elementsById.set(svg.id, wrapWithMaskClip(applyNodeEffects(
        `<defs><pattern id="${patId}" patternUnits="userSpaceOnUse" ` +
        `x="${patOrgX}" y="${patOrgY}" width="${tileW}" height="${tileH}">` +
        tileContent +
        `</pattern></defs>` +
        `<rect x="${regionX}" y="${regionY}" width="${regionW}" height="${regionH}" fill="url(#${patId})" stroke="none" />`,
        svg.effects, svg.id, svg, U,
      ), maskMap, groups, svg));
    } else {
      let paths = fillElement;
      if (Array.isArray(svg.subpaths) && svg.subpaths.length > 0) {
        for (const sub of svg.subpaths) {
          const d = buildPathD(sub.segments);
          if (d) {
            const { r, g, b } = sub.color;
            paths += `<path d="${d}" ${attrs} stroke="rgb(${r},${g},${b})" />`;
          }
        }
      } else {
        const d = buildPathD(svg.segments);
        if (d) {
          const { r, g, b } = svg.color;
          paths += `<path d="${d}" ${attrs} stroke="rgb(${r},${g},${b})" />`;
        }
      }
      if (paths) {
        elementsById.set(svg.id, wrapWithMaskClip(
          applyNodeEffects(paths, svg.effects, svg.id, svg, U),
          maskMap, groups, svg,
        ));
      }
    }
  }

  for (const txt of texts) {
    if (cancelled?.()) return null;
    const content = buildTextSVGContent(txt, U);
    if (!content) continue;
    elementsById.set(txt.id, wrapWithMaskClip(
      applyNodeEffects(content, txt.effects, txt.id, txt, U),
      maskMap, groups, txt,
    ));
  }

  // Emit in scene order (back→front). Ids missing from `sceneOrder` (or the
  // whole map when `sceneOrder` is absent) fall back to insertion order, which
  // is the legacy images→figures→svgs paint order.
  const allElements: string[] = [];
  const order = input.sceneOrder;
  if (order && order.length > 0) {
    const emitted = new Set<string>();
    for (const id of order) {
      const el = elementsById.get(id);
      if (el !== undefined) { allElements.push(el); emitted.add(id); }
    }
    for (const [id, el] of elementsById) {
      if (!emitted.has(id)) allElements.push(el);
    }
  } else {
    for (const el of elementsById.values()) allElements.push(el);
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
      const resolved = input.fontResolver(fontId);
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
  // Gradient backgrounds emit their def alongside the rect.
  let backgroundRect = '';
  if (input.background) {
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
