import { PathSegment, RGBColor, SVGObject } from './types';
import { SVG_UNITS_PER_L0_CELL, SVG_STROKE_WIDTH } from './svgExport';
import { computeSweepFlag, arcRadius, chainSegmentsLoops } from './compositionArcMath';
import { packKey, unpackKey, forEachVisibleTile } from './tileSegmentOverrides';

/**
 * Convert an array of PathSegments into an SVG `d` attribute string
 * translated so coordinates are relative to (minX, minY) in L0-cell space.
 * Used for tile-local paths in repeat/pattern rendering.
 */
export function buildTilePathD(
  segments: ReadonlyArray<PathSegment>,
  minX: number,
  minY: number,
): string {
  const u = SVG_UNITS_PER_L0_CELL;
  let d = '';
  let curX = NaN, curY = NaN;
  for (const seg of segments) {
    if (seg.start[0] !== curX || seg.start[1] !== curY) {
      d += `M ${(seg.start[0] - minX) * u},${(seg.start[1] - minY) * u} `;
    }
    if (seg.kind === 'arc') {
      const r = arcRadius(seg) * u;
      const sf = computeSweepFlag(seg.start, seg.end, seg.center);
      d += `A ${r},${r} 0 0,${sf} ${(seg.end[0] - minX) * u},${(seg.end[1] - minY) * u} `;
    } else {
      d += `L ${(seg.end[0] - minX) * u},${(seg.end[1] - minY) * u} `;
    }
    curX = seg.end[0]; curY = seg.end[1];
  }
  return d.trim();
}

/**
 * Convert an array of PathSegments into an SVG `d` attribute string.
 * Coordinates are in L0-cell space scaled by SVG_UNITS_PER_L0_CELL.
 */
export function buildPathD(segments: ReadonlyArray<PathSegment>): string {
  const u = SVG_UNITS_PER_L0_CELL;
  let d = '';
  let curX = NaN, curY = NaN;
  for (const seg of segments) {
    if (seg.start[0] !== curX || seg.start[1] !== curY) {
      d += `M ${seg.start[0] * u},${seg.start[1] * u} `;
    }
    if (seg.kind === 'arc') {
      const r = arcRadius(seg) * u;
      const sf = computeSweepFlag(seg.start, seg.end, seg.center);
      d += `A ${r},${r} 0 0,${sf} ${seg.end[0] * u},${seg.end[1] * u} `;
    } else {
      d += `L ${seg.end[0] * u},${seg.end[1] * u} `;
    }
    curX = seg.end[0];
    curY = seg.end[1];
  }
  return d.trim();
}

/**
 * Build tile-local SVG path element(s) for an SVGObject in repeat mode.
 * Vertices are translated so the content starts at (0,0) relative to
 * obj.cellX/cellY — the canonical origin used by the tile texture
 * rasterizers.
 *
 * Note: no `vector-effect="non-scaling-stroke"`. The rasterizer renders
 * this content inside a `<svg viewBox="0 0 tileW tileH" width="texPx"
 * height="texPx">`, so the natural viewBox→viewport transform scales the
 * stroke to the right canvas-pixel width — matching the figure-tile
 * rasterizer's approach. Adding non-scaling-stroke here would peg the
 * stroke at its raw value in canvas pixels, ignoring viewBox scale, and
 * the on-screen stroke would no longer track the non-tile-mode stroke
 * (which is rendered in the DOM at the same SVG-unit width).
 */
export function buildSVGObjectTileContent(obj: SVGObject, strokeScale: number): string {
  if (obj.segments.length === 0) return '';
  // Use the tile-grid anchor (cellX + tileOffset) as the translation
  // origin. tileOffset compensates for origin-side resizes so
  // cellX + tileOffset is invariant — the tile content stays at a fixed
  // position in the texture regardless of region expansion. Without this,
  // expanding the region up/left shifts content within the tile while the
  // shader's u_tileOffset also compensates, causing double-shift gaps.
  //
  // Note: we use cellX + offset rather than bare cellX because the
  // earlier clip-arc fix (using authoritative bbox origin instead of
  // segment-derived min) is preserved — tileOffset is 0 when the region
  // hasn't been resized, so the behavior is identical for non-resized
  // objects.
  const minX = obj.cellX + (obj.tileOffsetXL0 ?? 0);
  const minY = obj.cellY + (obj.tileOffsetYL0 ?? 0);
  const sw = SVG_STROKE_WIDTH * strokeScale;
  const attrs = `fill="none" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;

  let result = '';

  // Fill path — rendered before strokes so the outline sits on top.
  if (obj.fillColor) {
    const fd = buildTileFillPathD(obj.segments, minX, minY);
    if (fd) {
      const { r, g, b } = obj.fillColor;
      const oa = obj.fillOpacity != null && obj.fillOpacity < 1 ? ` fill-opacity="${obj.fillOpacity}"` : '';
      result += `<path d="${fd}" fill="rgb(${r},${g},${b})"${oa} stroke="none" fill-rule="nonzero" />`;
    }
  }

  if (Array.isArray(obj.subpaths) && obj.subpaths.length > 0) {
    for (const sub of obj.subpaths) {
      const d = buildTilePathD(sub.segments, minX, minY);
      if (d) {
        const { r, g, b } = sub.color;
        result += `<path d="${d}" ${attrs} stroke="rgb(${r},${g},${b})" />`;
      }
    }
    return result;
  }

  const d = buildTilePathD(obj.segments, minX, minY);
  if (!d) return result;
  const { r: cr, g: cg, b: cb } = obj.color;
  result += `<path d="${d}" ${attrs} stroke="rgb(${cr},${cg},${cb})" />`;
  return result;
}

/**
 * Build the markup for a tiled SVG object EXPANDED into one `<g>` per visible
 * repeated copy, applying sparse per-copy segment color overrides
 * (`obj.segmentOverrides`). Each copy draws the full tile (fill + every
 * segment), with painted segments at their override color and the rest at the
 * base color — so a copy is a self-contained vector redraw (editable in
 * export; opaque-replaces the repeating bitmap in the live overlay).
 *
 * Coordinates are absolute world SVG-units, so the caller wraps the result in
 * the region-clipping `<svg viewBox>` (same as the `<pattern>` path) to clip
 * partial edge copies. Shared by SVG export and the live DOM overlay so the
 * two can't drift. Returns '' when the object has no geometry.
 *
 * Options:
 *  - `onlyPainted`: emit a `<g>` only for copies that have ≥1 override. The
 *    live overlay uses this — the repeating bitmap already draws every copy at
 *    its base color, so only painted copies need a vector redraw on top
 *    (export omits it so the standalone vector contains every copy).
 *  - `opaqueBg`: a CSS color drawn as a full opaque tile-sized `<rect>` behind
 *    each emitted copy. The live overlay passes the pattern's background color
 *    so a painted copy fully occludes the bitmap beneath it (the seam fix);
 *    transparent-background patterns pass nothing and accept a faint edge halo.
 */
export function buildExpandedTileSVGObjectContent(
  obj: SVGObject,
  strokeScale: number,
  opts?: { onlyPainted?: boolean; opaqueBg?: string },
): string {
  if (obj.segments.length === 0) return '';
  const u = SVG_UNITS_PER_L0_CELL;
  const anchorX = obj.cellX + (obj.tileOffsetXL0 ?? 0);
  const anchorY = obj.cellY + (obj.tileOffsetYL0 ?? 0);
  const twL0 = obj.tileWidthL0 ?? obj.cellWidth;
  const thL0 = obj.tileHeightL0 ?? obj.cellHeight;
  const sw = SVG_STROKE_WIDTH * strokeScale;
  const attrs = `fill="none" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;
  const overrides = obj.segmentOverrides;

  // Set of (col,row) that carry ≥1 override (only needed for onlyPainted).
  // Built whenever onlyPainted is set — an empty set (no overrides) correctly
  // emits nothing.
  let paintedCells: Set<number> | null = null;
  if (opts?.onlyPainted) {
    paintedCells = new Set();
    for (const key of overrides?.keys() ?? []) {
      const { col, row } = unpackKey(key);
      paintedCells.add((col << 16) ^ (row & 0xffff));
    }
  }

  // Flat (segment, base color) list — subpaths-when-present, else segments —
  // matching flattenSVGSegmentsWithColor's ordering so override keys line up.
  const flat: Array<{ seg: PathSegment; base: RGBColor }> = [];
  if (Array.isArray(obj.subpaths) && obj.subpaths.length > 0) {
    for (const sub of obj.subpaths) for (const seg of sub.segments) flat.push({ seg, base: sub.color });
  } else {
    for (const seg of obj.segments) flat.push({ seg, base: obj.color });
  }

  // Fill is shared across copies (no per-copy fill override), built once
  // relative to the anchor tile.
  let fillMarkup = '';
  if (obj.fillColor) {
    const fd = buildTileFillPathD(obj.segments, anchorX, anchorY);
    if (fd) {
      const { r, g, b } = obj.fillColor;
      const oa = obj.fillOpacity != null && obj.fillOpacity < 1 ? ` fill-opacity="${obj.fillOpacity}"` : '';
      fillMarkup = `<path d="${fd}" fill="rgb(${r},${g},${b})"${oa} stroke="none" fill-rule="nonzero" />`;
    }
  }
  // Opaque backing rect (seam fix) — drawn first so it sits under fill+strokes.
  // Tile-local coords (0,0)–(tileW,tileH); the copy <g> translate places it.
  const bgRect = opts?.opaqueBg
    ? `<rect x="0" y="0" width="${twL0 * u}" height="${thL0 * u}" fill="${opts.opaqueBg}" stroke="none" />`
    : '';

  const colorKey = (c: RGBColor) => (c.r << 16) | (c.g << 8) | c.b;
  const out: string[] = [];
  forEachVisibleTile(obj, (col, row) => {
    if (paintedCells && !paintedCells.has((col << 16) ^ (row & 0xffff))) return;
    let copy = bgRect + fillMarkup;
    // Group contiguous same-color runs to minimize path count.
    let runColor: RGBColor | null = null;
    let runSegs: PathSegment[] = [];
    const flush = () => {
      if (runSegs.length === 0 || !runColor) return;
      const d = buildTilePathD(runSegs, anchorX, anchorY);
      if (d) copy += `<path d="${d}" ${attrs} stroke="rgb(${runColor.r},${runColor.g},${runColor.b})" />`;
      runSegs = [];
    };
    for (let i = 0; i < flat.length; i++) {
      const k = overrides ? packKey(col, row, i) : null;
      const ov = k != null && overrides ? overrides.get(k) : undefined;
      const color = ov ?? flat[i].base;
      if (runColor && colorKey(runColor) === colorKey(color)) {
        runSegs.push(flat[i].seg);
      } else {
        flush();
        runColor = color;
        runSegs = [flat[i].seg];
      }
    }
    flush();
    if (copy) {
      // Path/fill/bg above are tile-local (relative to the anchor tile). Place
      // this copy at its true world top-left: anchor + (col,row)·tile, in SVG
      // units. (Omitting the anchor term renders every copy shifted by
      // -anchor, i.e. outside the region viewBox for any non-origin pattern.)
      const tx = (anchorX + col * twL0) * u;
      const ty = (anchorY + row * thL0) * u;
      out.push(tx === 0 && ty === 0 ? `<g>${copy}</g>` : `<g transform="translate(${tx},${ty})">${copy}</g>`);
    }
  });
  return out.join('');
}

/**
 * Build a closed SVG `d` attribute for a fill. Chains the segments into one
 * or more closed loops and emits each as its own `M…Z` subpath. Multiple
 * subpaths are required for shapes that aren't a single loop — a geometric
 * union can produce disjoint regions and/or holes (outer loop + inner loops).
 * With `fill-rule="nonzero"` (set on the fill <path>), a counter-wound inner
 * loop renders as a hole and disjoint loops each fill. Returns '' on failure.
 */
export function buildClosedFillPathD(segments: ReadonlyArray<PathSegment>): string {
  const loops = chainSegmentsLoops(segments);
  if (!loops) return '';
  return loops.map(loop => buildPathD(loop) + ' Z').join(' ');
}

/**
 * Tile-local variant of buildClosedFillPathD (coordinates relative to minX, minY).
 */
function buildTileFillPathD(segments: ReadonlyArray<PathSegment>, minX: number, minY: number): string {
  const loops = chainSegmentsLoops(segments);
  if (!loops) return '';
  return loops.map(loop => buildTilePathD(loop, minX, minY) + ' Z').join(' ');
}

/**
 * Build complete SVG path element(s) for an SVGObject, including
 * multi-color subpath support and optional solid fill.
 */
export function buildSVGObjectContent(obj: SVGObject, strokeScale: number): string {
  if (obj.segments.length === 0) return '';
  const sw = SVG_STROKE_WIDTH * strokeScale;
  const attrs = `fill="none" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"`;

  let result = '';

  // Fill path — rendered before strokes so the outline sits on top. A
  // pattern-fill mask renders outline only: its `fillColor` is painted as the
  // tiled figure's background (beneath the pattern), not as the shape's fill.
  if (obj.fillColor && !obj.isPatternFill) {
    const fd = buildClosedFillPathD(obj.segments);
    if (fd) {
      const { r, g, b } = obj.fillColor;
      const oa = obj.fillOpacity != null && obj.fillOpacity < 1 ? ` fill-opacity="${obj.fillOpacity}"` : '';
      result += `<path d="${fd}" fill="rgb(${r},${g},${b})"${oa} stroke="none" fill-rule="nonzero" />`;
    }
  }

  if (Array.isArray(obj.subpaths) && obj.subpaths.length > 0) {
    for (const sub of obj.subpaths) {
      const d = buildPathD(sub.segments);
      if (d) {
        const { r, g, b } = sub.color;
        result += `<path d="${d}" ${attrs} stroke="rgb(${r},${g},${b})" />`;
      }
    }
    return result;
  }

  const d = buildPathD(obj.segments);
  if (!d) return result;
  const { r: cr, g: cg, b: cb } = obj.color;
  result += `<path d="${d}" ${attrs} stroke="rgb(${cr},${cg},${cb})" />`;
  return result;
}
