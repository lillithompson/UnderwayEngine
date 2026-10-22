import React, { CSSProperties } from 'react';
import { BorderEffect, GlowEffect, ImageObject, NodeEffects, PaintObject, PatternObject, RGBColor, ShadowEffect, SVGObject, TextObject } from '@/engine/types';
import { paintContentTexels } from '@/engine/canvasPaint';
import { buildSVGObjectContent } from '@/engine/svgPathBuilder';
import { strokeScaleForUnits, svgStrokeWidthCells } from '@/engine/svgStroke';
import { borderDashIsDotted, borderDashPattern, borderRectGeometry, castSoftness, outlineCastSourceCells } from '@/engine/paintSvg';
import { coverImageRect, effectiveFraming, straightenCoverScale, tileGeometry } from '@/engine/imageFraming';
import { SVG_UNITS_PER_L0_CELL } from '@/engine/svgExport';
import { textArcPaths, textBend } from '@/engine/textArc';
import { charColorRuns, layoutText } from '@/engine/textLayout';
import { effectiveFontWeight } from '@/engine/fontWeight';
import { STICKER_BORDER_CELLS, STICKER_SHADOW_CELLS, stickerColors } from '@/engine/stickerStyle';
import { fontFamilyFor } from '../fontFamily';
import { getFontsEpoch, subscribeFontsEpoch } from '../fontsEpoch';
import { fadedImageObject, fadedNodeBorder, fadedTextStyle } from '@/engine/fade';
import { tintFillToPaint } from '@/engine/imageTintFill';
import { drawOverlayToCanvas, overlayImageData } from '@/engine/overlayCanvas';
import { BASE_CELL_PX } from '../cameraMath';
import { TextCaretBox, TextSelectionBox } from '../textCaret';
import { drawnTextLayout } from '../textNodeLayout';
import { paintToCssBackground, rgbCss } from '../colorUtils';
import {
  effectsBoxShadow, shadowGlowDropShadow, textShadowCss, textShadowFilter,
  worldOffsetInNodeFrame,
} from '../effectsBoxShadow';
import { MISSING_IMAGE_DATA_URI } from './missingImageArt';
import {
  DrawnFrame, DrawnLeaf, EPS_CELLS, drawnFrame, imageDrawnGeometry, patternDrawnGeometry,
  patternLayerMarkup, svgDrawnGeometry, svgLayerMarkup, svgLayerSplitMarkup,
} from '../drawnPose';
import { paintCanvasStyle } from '../paintOverlayPreview';
import { SHAPE_FILL_SVG_ATTR, SHAPE_STROKES_SVG_ATTR } from '../shapePaintDom';

// Per-node DOM layers for the world container. Each node renders an OUTER
// positioned div on its world AABB (data-node-id — the drag handler
// transforms this element directly during gestures, no React re-render) and
// an INNER element holding the node's LOCAL content, placed by one CSS
// `matrix()` — the node's world matrix off the scene graph (drawnPose.ts).
// A turn, a flip, a scale, a group's shear: all one matrix, no per-channel
// wrappers.
//
// Every layer is React.memo'd on its props. A `drawn` leaf is replaced only
// when its node or its world matrix changes (drawnLeaves), so a re-render of
// the canvas — every frame of a corner resize, which re-renders the dragged
// node from its previewed geometry — costs one shallow prop compare per
// untouched node instead of a full re-render + markup rebuild of the whole
// scene.
//
// Effects constraint (§11): runtime shadow/glow/border are approximated
// with CSS box-shadow on the node's bbox — never live SVG/CSS filters.
// A VECTOR is the other exception (see below): its shadow and glow come
// from CSS drop-shadow over the path's own alpha, because the box it would
// otherwise cast is not its outline — a circle threw a rectangle. Its
// INNER glow is the one place a live SVG filter is mounted at all: no CSS
// function draws one, and the bbox `inset` a box wears would glow a
// rectangle inside that same circle.
// The export path (compositionSVGCore) emits real <filter> defs
// engine-side, so exports are exact even though the editor preview is a
// bbox approximation for non-rectangular shapes. Text is the exception the
// rule allows for: its shadow comes from CSS text-shadow (also paint-time,
// not a filter), because the export shadows the glyphs and a box would
// preview a rectangle the page never draws.

/** The outer element: the node's world AABB, untransformed — the element
 *  the gestures move. `effects`, when given, is the box-shadow
 *  approximation the kind asks for on that box (a sticker's card, a
 *  vector's border ring); text casts its shadow from the glyphs instead,
 *  an image from its inner element, so they pass nothing. */
function outerStyle(frame: DrawnFrame, effects?: NodeEffects): CSSProperties {
  return {
    position: 'absolute',
    ...frame.outer,
    boxShadow: effectsBoxShadow(effects),
  };
}

/** A node's border ring as {@link outerStyle} wants it — faded with the
 *  rest of the colours the node paints with, or absent when it has none. */
function fadedBorderEffects(
  node: { fade?: number; fadeColor?: RGBColor; effects?: NodeEffects },
): NodeEffects | undefined {
  const border = fadedNodeBorder(node);
  return border ? { border } : undefined;
}

/** The inner element: the node's local box at its own size, placed in the
 *  outer box by the world matrix about its top-left corner. Everything a
 *  kind draws goes inside this, in local cells × BASE_CELL_PX.
 *
 *  Exported because a HOST's layer for its own kind of node has to place
 *  its content in the same box the shared layers do — Sol's
 *  `PlantGroupLayer` (its web/sol/scene/) is the one such layer today. */
export function innerStyle(frame: DrawnFrame): CSSProperties {
  return {
    position: 'absolute',
    left: 0,
    top: 0,
    width: frame.inner.width,
    height: frame.inner.height,
    transform: frame.inner.transform,
    transformOrigin: '0 0',
  };
}

/**
 * Pattern node layer: the object's cell grid baked to SVG markup through
 * its derived SVGObject view (patternSVGView — memoized per object
 * identity), rendered exactly like an SvgNodeLayer. An EMPTY pattern
 * renders the positioned wrapper and a bare <svg> and nothing else — no
 * fill, no border (hit testing is engine-side and bbox-definitive, so it
 * stays tappable) — and the <svg> is ALWAYS mounted so the pattern-paint
 * gesture can live-preview a stroke by swapping its innerHTML without a
 * React commit (the 90 fps rule).
 */
export const PatternNodeLayer = React.memo(function PatternNodeLayer(
  { drawn, strokeScale }: { drawn: DrawnLeaf; strokeScale: number },
) {
  const node = drawn.node.content as PatternObject;
  if (node.hidden) return null;
  // The cells baked in the node's own space (no turn, flip or angle of
  // their own — the matrix carries the pose), the same recipe the
  // imperative stroke previews swap in — and, like an svg's path, grown by
  // everything the element's matrix then omits, so a pattern's strokes keep
  // their WORLD width through a pinch and through a group pulled off its
  // axes (plan §5.10). See patternDrawnGeometry.
  const geometry = patternDrawnGeometry(drawn);
  const frame = drawnFrame(drawn, BASE_CELL_PX, geometry ?? undefined);
  const { viewBox, html } = patternLayerMarkup(drawn, strokeScale);
  return (
    <div data-node-id={node.id} style={outerStyle(frame)}>
      <div style={innerStyle(frame)}>
        <svg
          width="100%"
          height="100%"
          viewBox={viewBox}
          preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, overflow: 'visible', display: 'block' }}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
});

export const SvgNodeLayer = React.memo(function SvgNodeLayer(
  { drawn, strokeScale, children }: {
    drawn: DrawnLeaf;
    strokeScale: number;
    /** Drawn over the shape, inside its matrix wrapper, so it rides the
     *  node's pose and the gestures with it: a host's own marking on a
     *  shape of its kind (Sol's seed marker initial). Nothing the shared
     *  editor draws passes any. */
    children?: React.ReactNode;
  },
) {
  const node = drawn.node.content as SVGObject;
  // Color-tool paint layer: an HTML <canvas> in the node's own paint host,
  // BETWEEN the shape's fill svg and its strokes svg (shapePaintDom.ts) —
  // never a <foreignObject> inside the svg, whose canvas is a composited
  // layer WebKit sizes and places on its own terms (huge and adrift on iOS;
  // see the engine's shapePaintClipMarkup). Drawn once per overlay change
  // (the node object is immutable, so the effect key is the overlay
  // reference) and never PNG-encoded into a data URL, which WebKit would
  // retain for the document's lifetime (overlayCanvas.ts). Hooks must run
  // before the `hidden` early return.
  const paintOverlay = node.paintOverlay;
  const paintCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  React.useLayoutEffect(() => {
    const canvas = paintCanvasRef.current;
    if (canvas && paintOverlay) drawOverlayToCanvas(canvas, paintOverlay);
  }, [paintOverlay]);
  if (node.hidden) return null;
  const u = SVG_UNITS_PER_L0_CELL;
  // The path in the node's own space, grown by everything the element's
  // matrix then omits — the scale, and off-square the lean with it — so
  // the stroke below keeps its WORLD width through a pinch AND through a
  // group pulled off its axes. See svgDrawnGeometry.
  const geometry = svgDrawnGeometry(drawn);
  const frame = drawnFrame(drawn, BASE_CELL_PX, geometry);
  const box = geometry.box;
  const w = Math.max(box.width, EPS_CELLS);
  const h = Math.max(box.height, EPS_CELLS);
  // The engine's canonical markup — the path, its fill, the paint layer,
  // the PATTERN fill's tiles clipped to the same outline and, around all
  // of it, the INNER glow's filter — through the ONE reader the imperative
  // stroke previews mount too (svgLayerMarkup), so a tile stroke into a
  // shape's pattern, or the Color brush over its fill, previews where it
  // commits with the glow still on it.
  //
  // `outlineCells` is read there too: the stroke the shape draws, when
  // that outline is the whole of what it has to cast from. `undefined` on
  // a filled shape, which casts from its own solid alpha like every other
  // node — and so, throughout, the flag for which of the two pictures this
  // node is.
  //
  // A PAINTED shape reads the same recipe in two halves (svgLayerSplitMarkup)
  // and mounts its paint canvas between them; every other shape is one svg.
  const split = paintOverlay ? svgLayerSplitMarkup(drawn, strokeScale, geometry) : null;
  const whole = split ? null : svgLayerMarkup(drawn, strokeScale, geometry);
  const { viewBox, outlineCells } = (split ?? whole)!;
  // An UNFILLED shape's OUTWARD casts — its shadow and its outer glow — are
  // drawn, not filtered.
  //
  // `drop-shadow()` casts from the element's alpha, which for a shape with
  // no fill is its outline — a hairline beside the blur these effects carry,
  // so the filter spread their ink over four times its width and left about
  // a twentieth of the opacity behind. That is why adding a shadow, or a
  // glow, to an unfilled shape looked like adding nothing. The export fixes
  // it by dilating the alpha first (`outlineCastWidth`), and CSS has no
  // dilate: so here the ring is drawn outright — the same path, stroked at
  // the width the rule asks for, in the effect's colour, offset (the shadow)
  // or standing where the shape does (the glow), and blurred. The same
  // picture from the other side.
  //
  // Same shape as the text layer's shadow pass: a node that casts one
  // renders its silhouette twice, once as the cast and once as itself.
  const fx = node.effects;
  const outlineCasts: OutlineCast[] = outlineCells === undefined ? [] : [
    ...(fx?.shadow ? [{ key: 'shadow', effect: fx.shadow, dx: fx.shadow.dx, dy: fx.shadow.dy }] : []),
    // A glow is a shadow with nowhere to fall, so it is that same ring
    // standing where the shape stands.
    ...(fx?.glow ? [{ key: 'glow', effect: fx.glow, dx: 0, dy: 0 }] : []),
  ];
  // …and the INNER glow is filtered, not drawn: it is the one cast effect
  // with no CSS counterpart at all, so the export's own <filter> rides
  // along inside this node's <svg>, wrapping the markup it lights — put
  // there by svgLayerMarkup above, so the imperative previews that swap
  // this <svg>'s markup mid-stroke keep it.
  const contentSvgStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    overflow: 'visible',
    display: 'block',
  };
  const host = (
    // The paint host: the shape's svg (or its two halves and the paint canvas
    // between them). `isolation` confines the paint layer's blend to this
    // shape — the canvas is a real CSS layer, whose blend would otherwise
    // reach whatever the page shows beneath the node. The whole-object
    // opacity a split shape's halves no longer carry is worn here, so fill,
    // paint and outline fade as one layer, as the markup's wrapper faded them.
    <div
      data-paint-host=""
      style={{
        position: 'absolute',
        inset: 0,
        isolation: paintOverlay ? 'isolate' : undefined,
        opacity: split && split.opacity < 1 ? split.opacity : undefined,
        // Shadow + glow, cast from THIS markup's own alpha — the shape's
        // outline, dashes and all — instead of from the bbox behind it.
        // Applied here rather than on the outer box so the matrix wrapper
        // turns the finished result, which is the order the export takes
        // (effects in world space, the node's angle around the whole of it).
        //
        // …and NOTHING of the kind where the rings below are drawing them,
        // or the shape would cast every outward effect twice.
        filter: outlineCells === undefined ? shadowGlowDropShadow(node.effects) : undefined,
      }}
    >
      {split && paintOverlay ? (
        <>
          <svg
            {...{ [SHAPE_FILL_SVG_ATTR]: '' }}
            width="100%"
            height="100%"
            viewBox={viewBox}
            preserveAspectRatio="none"
            style={contentSvgStyle}
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: split.fill }}
          />
          {/* The committed paint layer: the low-res bitmap at its texel size
              (width/height attrs), CSS-stretched over the frame, cut to the
              outline by the fill half's own clip and composited with its one
              blend mode. data-paint-committed: a paint stroke hides it and
              mounts its working canvas in its place (CanvasSurface), so the
              shape never wears the old ink and the new. */}
          <canvas
            data-paint-committed=""
            ref={paintCanvasRef}
            width={paintOverlay.cols}
            height={paintOverlay.rows}
            style={paintCanvasStyle(paintOverlay, split.paintClipId) as CSSProperties}
          />
          <svg
            {...{ [SHAPE_STROKES_SVG_ATTR]: '' }}
            width="100%"
            height="100%"
            viewBox={viewBox}
            preserveAspectRatio="none"
            style={contentSvgStyle}
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: split.strokes }}
          />
        </>
      ) : (
        <svg
          {...{ [SHAPE_FILL_SVG_ATTR]: '' }}
          width="100%"
          height="100%"
          viewBox={viewBox}
          preserveAspectRatio="none"
          style={contentSvgStyle}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: whole!.html }}
        />
      )}
    </div>
  );
  return (
    // The outer box keeps the BORDER ring and nothing else: a border really is
    // drawn on the bbox (the export strokes a rect there — borderRectForBox),
    // where the shadow and glow above are the shape's own.
    <div
      data-node-id={node.id}
      // The Fade row moves the ring's colour with the shape's own: the
      // markup inside is faded by `svgLocalGeometry`, but a border is drawn
      // on the bbox and never reaches it (engine/fade.ts).
      style={outerStyle(frame, fadedBorderEffects(node))}
    >
      <div style={innerStyle(frame)}>
        {outlineCasts.map((cast) => (
          <svg
            key={cast.key}
            aria-hidden
            width="100%"
            height="100%"
            viewBox={`${box.x * u} ${box.y * u} ${w * u} ${h * u}`}
            preserveAspectRatio="none"
            style={{
              position: 'absolute',
              inset: 0,
              overflow: 'visible',
              display: 'block',
              // The offset is a WORLD length, and this element is in the
              // node's own frame — the same conversion the text layer's
              // shadow makes (`worldOffsetInNodeFrame`).
              transform: outlineCastTransform(cast, drawn),
              // Half the CSS radius is the σ both renderers blur by
              // (paintSvg's BLUR_SIGMA_PER_RADIUS), and the alpha is spent
              // once on the whole ring rather than on every stroke in it.
              filter: `blur(${(castSoftness(cast.effect) / 2) * BASE_CELL_PX}px)`,
              opacity: cast.effect.alpha,
            }}
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{
              __html: buildSVGObjectContent(
                outlineCastObject(geometry.object, cast.effect, strokeScale, u),
                strokeScaleForUnits(strokeScale, u), u,
                { nonScaling: false },
              ),
            }}
          />
        ))}
        {host}
        {children}
      </div>
    </div>
  );
});

/** One outward cast an unfilled shape draws as a ring: the effect itself,
 *  and where it stands relative to the shape — a shadow's offset, or the
 *  nothing an outer glow moves by. */
interface OutlineCast {
  key: string;
  effect: ShadowEffect | GlowEffect;
  dx: number;
  dy: number;
}

/**
 * The shape as its own cast: every line it draws in the effect's colour,
 * at the width {@link outlineCastSourceCells} asks for — no fill (there
 * is none to cast), no effects (the ring is the effect), no paint overlay.
 *
 * Its own function because a silhouette is not a recolour: a shape can draw
 * in several colours at once (subpaths, per-copy segment overrides) and a
 * cast is one colour by definition, so every one of them has to be put out,
 * not just the object's own.
 */
function outlineCastObject(
  object: SVGObject, effect: ShadowEffect | GlowEffect, strokeScale: number, u: number,
): SVGObject {
  const width = svgStrokeWidthCells(object, strokeScaleForUnits(strokeScale, u), u);
  const out: SVGObject = {
    ...object,
    color: effect.color,
    stroke: { ...(object.stroke ?? {}), width: outlineCastSourceCells(width, effect) },
  };
  if (object.subpaths) out.subpaths = object.subpaths.map((sp) => ({ ...sp, color: effect.color }));
  delete out.segmentOverrides;
  delete out.effects;
  delete out.paintOverlay;
  delete out.fill;
  delete out.fillPaint;
  delete out.fillColor;
  return out;
}

/** A cast ring's offset, as a CSS transform in the node's own frame. */
function outlineCastTransform(cast: OutlineCast, drawn: DrawnLeaf): string {
  const [dx, dy] = worldOffsetInNodeFrame(cast.dx, cast.dy, drawn.node.content as {
    rotation?: 0 | 90 | 180 | 270; angleDeg?: number; mirrorH?: boolean; mirrorV?: boolean;
  });
  return `translate(${dx * BASE_CELL_PX}px, ${dy * BASE_CELL_PX}px)`;
}

/** A border stroke as an SVG rect over a `wPx × hPx` box — accurate for width /
 *  position (inside / center / outside) / dash / rounded corners, unlike the
 *  box-shadow ring approximation. Geometry + dash pattern come from the engine
 *  (shared with the SVG export) so preview and export can't drift. Rendered with
 *  `overflow: visible` so center/outside strokes that extend past the box are
 *  not clipped — the caller must place it OUTSIDE any clip. Shared by images
 *  (inside their rotated wrapper) and frames (over the frame rect). */
export function BorderOverlay({ border, wPx, hPx, radiusPx = 0 }: {
  border: BorderEffect; wPx: number; hPx: number; radiusPx?: number;
}) {
  if (!border || border.width <= 0) return null;
  const px = BASE_CELL_PX;
  const geo = borderRectGeometry(border.width * px, border.position, radiusPx, {
    cellX: 0, cellY: 0, cellWidth: wPx, cellHeight: hPx,
  });
  const pattern = borderDashPattern(border.dash);
  const dashArray = pattern ? `${pattern[0] * px} ${pattern[1] * px}` : undefined;
  const roundCap = pattern ? borderDashIsDotted(pattern[0]) : false;
  return (
    <svg
      width="100%"
      height="100%"
      style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
    >
      <rect
        x={geo.x}
        y={geo.y}
        width={geo.w}
        height={geo.h}
        rx={geo.rx || undefined}
        ry={geo.rx || undefined}
        fill="none"
        stroke={rgbCss(border.color)}
        strokeOpacity={border.alpha != null && border.alpha < 1 ? border.alpha : undefined}
        strokeWidth={border.width * px}
        strokeDasharray={dashArray}
        strokeLinecap={roundCap ? 'round' : undefined}
      />
    </svg>
  );
}

/** The border stroke for an image, over its LOCAL frame (`fw × fh` px).
 *  Rendered inside the matrix wrapper (see {@link ImageNodeLayer}) so it
 *  turns and flips with the image. */
function ImageBorderOverlay({ node, fw, fh }: { node: ImageObject; fw: number; fh: number }) {
  const b = node.effects?.border;
  if (!b) return null;
  return <BorderOverlay border={b} wPx={fw} hPx={fh} radiusPx={imageCornerRadiusPx(node, fw, fh)} />;
}

/** Rounded corners: a fraction of the shorter side of the local frame. */
function imageCornerRadiusPx(node: ImageObject, fw: number, fh: number): number {
  return node.cornerRadius ? Math.min(0.5, node.cornerRadius) * Math.min(fw, fh) : 0;
}

// Perf backstop: a tiny tile size on a large frame could ask for thousands of
// <img> nodes. Tiling is static (recomputed only on a framing change, never per
// frame), but we still cap the grid so a pathological Size value can't stall a
// render. Beyond the cap the frame is simply under-tiled at the far edges.
const MAX_TILES = 600;

/** The framed bitmap that fills the image's frame (the oriented inner box,
 *  `fw×fh` px). Fill (cover + zoom), Fit (contain + margin), Crop (cover +
 *  straighten), Tile (repeat). Geometry comes from the engine helper so the
 *  preview matches the SVG export (framedImageSVG). A node with no framing
 *  record draws the plain cover every image is born with (effectiveFraming /
 *  COVER_FRAMING) — the bitmap is never stretched onto the frame's own
 *  proportions, which is what the old `object-fit: fill` branch did. */
function FramedImage({ node, src, fw, fh }: {
  node: ImageObject; src: string; fw: number; fh: number;
}) {
  const common: CSSProperties = {
    opacity: node.opacity ?? 1,
    pointerEvents: 'none',
    userSelect: 'none',
  };
  const f = effectiveFraming(node.framing);
  const px = BASE_CELL_PX;

  if (f.mode === 'fit') {
    const m = Math.min(Math.max(0, f.margin) * px, Math.min(fw, fh) / 2);
    return (
      <img
        src={src}
        alt=""
        draggable={false}
        style={{
          position: 'absolute', left: m, top: m,
          width: Math.max(0, fw - 2 * m), height: Math.max(0, fh - 2 * m),
          objectFit: 'contain', display: 'block', ...common,
        }}
      />
    );
  }

  if (f.mode === 'tile') {
    const aspect = node.pixelHeight > 0 ? node.pixelWidth / node.pixelHeight : 1;
    const g = tileGeometry(fw, fh, aspect, f.tileScale, f.tileGap * px);
    const rows = Math.min(g.rows, MAX_TILES);
    const cols = Math.min(g.cols, Math.max(1, Math.floor(MAX_TILES / rows)));
    const tiles: React.ReactNode[] = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        tiles.push(
          <img
            key={`${i}-${j}`}
            src={src}
            alt=""
            draggable={false}
            style={{
              position: 'absolute', left: i * g.stepX, top: j * g.stepY,
              width: g.tileW, height: g.tileH, objectFit: 'cover', display: 'block', ...common,
            }}
          />,
        );
      }
    }
    return <>{tiles}</>;
  }

  // Fill + Crop: the full bitmap drawn at its cover size (scaled by zoom /
  // straighten) and panned by the offset, clipped to the frame. Crop rotates.
  const aspect = node.pixelHeight > 0 ? node.pixelWidth / node.pixelHeight : 1;
  const scale = f.mode === 'crop' ? straightenCoverScale(f.angle, fw, fh) : f.zoom;
  const r = coverImageRect(fw, fh, aspect, scale, f.offsetX * px, f.offsetY * px);
  const rotate = f.mode === 'crop' && f.angle !== 0 ? ` rotate(${f.angle}deg)` : '';
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      style={{
        position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h,
        objectFit: 'cover', display: 'block',
        transform: rotate ? `rotate(${f.angle}deg)` : undefined,
        transformOrigin: 'center',
        ...common,
      }}
    />
  );
}

/** Fills the frame when the image node has no bytes yet: the grey "no image"
 *  mountain scaled to fit (contain), so a mismatched frame aspect ratio letters
 *  it rather than stretching it — on a light grey card (#eeeeee, a shade off
 *  the page's own white), so the unset slot reads as a blank photo waiting to
 *  be filled on ANY page (transparent, the grey mountain vanished into grey
 *  and dark backgrounds; pure white disappeared into a white page). The card
 *  rides the img element itself, so opacity and the wrapper's corner clip
 *  cover both. */
function MissingImageFill({ node }: { node: ImageObject }) {
  return (
    <img
      src={MISSING_IMAGE_DATA_URI}
      alt=""
      draggable={false}
      style={{
        width: '100%', height: '100%', objectFit: 'contain', display: 'block',
        backgroundColor: '#eeeeee',
        opacity: node.opacity ?? 1, pointerEvents: 'none', userSelect: 'none',
      }}
    />
  );
}

export const ImageNodeLayer = React.memo(function ImageNodeLayer(
  { drawn, src }: { drawn: DrawnLeaf; src: string | undefined },
) {
  // The image as it is DRAWN: its pixels are not a colour parameter, so
  // what the Fade row moves is what it paints OVER and AROUND them — the
  // tint and the border ring (engine/fade.ts). The same object back when
  // there is no fade, so every memo below keeps its identity.
  const node = fadedImageObject(drawn.node.content as ImageObject);
  // Color-tool paint layer: the low-res bitmap drawn into a canvas once per
  // overlay change (the node object is immutable, so the effect key is the
  // overlay reference) — never PNG-encoded into a data URL, which WebKit
  // would retain for the document's lifetime (see overlayCanvas.ts). Hooks
  // must run before the `hidden` early return.
  const paintOverlay = node.paintOverlay;
  const paintCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  React.useLayoutEffect(() => {
    const canvas = paintCanvasRef.current;
    if (canvas && paintOverlay) drawOverlayToCanvas(canvas, paintOverlay);
  }, [paintOverlay]);
  if (node.hidden) return null;
  // In a box of the proportions it is drawn at, so the bitmap never takes a
  // per-axis stretch off the matrix (imageDrawnGeometry).
  const frame = drawnFrame(drawn, BASE_CELL_PX, imageDrawnGeometry(drawn));
  const inner = innerStyle(frame);
  const tint = node.tint;
  // The local frame the bitmap fills, in px.
  const fw = frame.inner.width;
  const fh = frame.inner.height;
  // Rounded corners: a fraction of the shorter side, clipped on the matrix
  // wrapper so the image and the tint overlay are both rounded. Mirrors the
  // SVG-export clipPath (compositionSVGCore).
  const cornerRadiusPx = imageCornerRadiusPx(node, fw, fh);
  // Every framing (Fill/Crop/Tile) overflows the frame on purpose and must be
  // clipped even when corners are square — including the plain cover an
  // unframed node now falls back to, so this is unconditional.
  const clip: CSSProperties = {
    ...(cornerRadiusPx > 0 ? { borderRadius: cornerRadiusPx } : {}),
    overflow: 'hidden',
  };
  // Shadow / glow ride a box-shadow on the MATRIX wrapper (not the outer
  // bbox), so they rotate/mirror with the image; the border is an SVG overlay
  // inside the same wrapper. The border is excluded here to avoid a double
  // stroke.
  const shadowGlow = node.effects?.shadow || node.effects?.glow || node.effects?.innerGlow
    ? { shadow: node.effects?.shadow, glow: node.effects?.glow, innerGlow: node.effects?.innerGlow }
    : undefined;
  // Outer box is the axis-aligned bbox and the drag handle only — no effects
  // ride it, or they would stay unrotated when the image is turned.
  const outer: CSSProperties = outerStyle(frame);
  // The matrix wrapper: carries the local frame + the world matrix and hosts
  // the shadow/glow box-shadow so it turns with the image. Rounding it makes
  // the drop shadow hug the rounded corners, matching the SVG export.
  const oriented: CSSProperties = {
    ...inner,
    boxShadow: effectsBoxShadow(shadowGlow),
    ...(cornerRadiusPx > 0 ? { borderRadius: cornerRadiusPx } : {}),
  };
  return (
    <div data-node-id={node.id} style={outer}>
      <div style={oriented}>
        {/* Separate clip child so `overflow: hidden` bounds the bitmap without
            clipping the wrapper's box-shadow or the border overlay (which may
            extend outside the frame for center/outside border positions). */}
        {/* data-paint-host: the color tool's live stroke preview mounts its
            working-overlay <img> in here (CanvasSurface), so mid-stroke paint
            composites against the photo exactly like the committed layer —
            a blend mode can't reach the image from the screen-space overlay. */}
        <div data-paint-host="" style={{ position: 'absolute', inset: 0, ...clip, ...(node.tintFill || node.paintOverlay ? { isolation: 'isolate' as const } : {}) }}>
          {src ? <FramedImage node={node} src={src} fw={fw} fh={fh} /> : <MissingImageFill node={node} />}
          {src && tint ? (
            // Editor-only tint approximation: a translucent color overlay.
            // The real shader-time tint math (imageTint.ts) runs at export,
            // so the preview is close but not exact — deliberately cheap
            // (no blend modes / filters on the 90 fps path).
            <div
              style={{
                position: 'absolute', inset: 0,
                background: rgbCss(tint.color, Math.min(0.85, tint.amount * 0.7)),
                pointerEvents: 'none',
              }}
            />
          ) : null}
          {node.tintFill ? (
            // Gradient tint overlay (design 6a): the solid / linear / radial
            // fill composited over the image with the chosen blend mode +
            // layer opacity. The Paint conversion is shared with the export
            // path (tintFillToPaint); `isolation: isolate` on the clip parent
            // keeps the blend confined to the image, not the canvas behind it.
            // data-tint-committed: the Color brush's live stroke hides this
            // layer and mounts its own wash in its place (CanvasSurface), so
            // the photo never wears both the old tint and the new one.
            // NOT gated on `src`, for the reason the paint layer below isn't
            // (and the way the SVG export never was): a tint on a
            // still-unset image renders over the placeholder art. The live
            // preview already showed it during the stroke, so gating it here
            // made a committed Color stroke vanish on release — lost work,
            // the same bug the paint layer was ungated to fix. The legacy
            // `tint` above stays gated: it is a shader approximation applied
            // TO a bitmap, and with no bitmap there is nothing to approximate.
            <div
              data-tint-committed=""
              style={{
                position: 'absolute', inset: 0,
                background: paintToCssBackground(tintFillToPaint(node.tintFill)),
                opacity: node.tintFill.opacity,
                mixBlendMode: node.tintFill.blend as CSSProperties['mixBlendMode'],
                pointerEvents: 'none',
              }}
            />
          ) : null}
          {paintOverlay ? (
            // Color-tool paint layer: the hidden low-res bitmap stretched
            // (smoothly) over the frame and composited with its one blend
            // mode. Sits above the tint overlay, matching the SVG export's
            // layer order; `isolation: isolate` on the clip parent confines
            // the blend to the image. NOT gated on `src` like the tints
            // above: paint on a still-unset image renders over the
            // placeholder art — the live preview already did during the
            // stroke, and a committed stroke that vanished on release read
            // as lost work. The bitmap is at the overlay's texel size
            // (width/height attrs) and CSS-stretched into the frame.
            <canvas
              data-paint-committed=""
              ref={paintCanvasRef}
              width={paintOverlay.cols}
              height={paintOverlay.rows}
              style={paintCanvasStyle(paintOverlay) as CSSProperties}
            />
          ) : null}
        </div>
        <ImageBorderOverlay node={node} fw={fw} fh={fh} />
      </div>
    </div>
  );
});

// ── Paint island layer ──────────────────────────────────────────────

// Tiles draw through the engine's shared ImageData views (overlayImageData):
// commits swap tile ARRAYS but share untouched tile objects structurally, so
// keying on the rgba reference means a stroke re-wraps only the tiles it
// actually changed, and a WORKING tile whose bytes mutate under a stable
// reference reads current on every putImageData — no per-frame allocation
// and no PNG encode anywhere on this path.

/** Draw a paint island's committed tiles into its backing canvas: clear,
 *  then one putImageData per tile at its contentRect-relative texel
 *  position. Ink bounds are texel-aligned, so the offsets are integral (the
 *  round absorbs float fuzz). Exported for CanvasSurface's stroke-preview
 *  teardown, which restores committed pixels after painting into the
 *  element imperatively mid-stroke. */
export function drawPaintTiles(canvas: HTMLCanvasElement, node: PaintObject): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!(node.contentW > 0) || !(node.contentH > 0)) return;
  const sx = canvas.width / node.contentW;
  const sy = canvas.height / node.contentH;
  for (const tile of node.tiles) {
    ctx.putImageData(
      overlayImageData(tile.overlay),
      Math.round((tile.x - node.contentX) * sx),
      Math.round((tile.y - node.contentY) * sy),
    );
  }
}

/** The canvas backing-store size for an island's content rect: its native
 *  texel dimensions, so the bitmap holds exactly the painted resolution and
 *  CSS stretches it into the bbox (the same smooth upscale contract the
 *  paintOverlay layers use). */
export function paintCanvasSize(node: PaintObject): { width: number; height: number } {
  const { cols, rows } = paintContentTexels(node);
  return { width: cols, height: rows };
}

export const PaintNodeLayer = React.memo(function PaintNodeLayer(
  { drawn }: { drawn: DrawnLeaf },
) {
  const node = drawn.node.content as PaintObject;
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const { width, height } = paintCanvasSize(node);
  // Redraw when the committed tiles (or the frame they map through) change.
  // React re-sets the width/height attributes first when they changed —
  // which resets the bitmap — so the draw always lands on a current-size,
  // clean canvas. A pure bbox change (drag/resize preview) re-renders with
  // the SAME tiles and dims and skips the redraw: CSS stretches the bitmap.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) drawPaintTiles(canvas, node);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.tiles, node.contentX, node.contentY, node.contentW, node.contentH, node.hidden]);
  if (node.hidden) return null;
  const frame = drawnFrame(drawn, BASE_CELL_PX);
  // A paint island has no fill, no stroke and no border — nothing for the
  // Fade row to move — so its Opacity page keeps the one row it always
  // had, and this layer draws the tiles and nothing else.
  return (
    <div data-node-id={node.id} style={outerStyle(frame)}>
      <div style={innerStyle(frame)}>
        <canvas
          data-paint-canvas=""
          ref={canvasRef}
          width={width}
          height={height}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            ...(node.opacity != null && node.opacity < 1 ? { opacity: node.opacity } : {}),
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
});

// Word-sticker (magnetic poetry) card. Default: black text on a white card
// with a 1px black border + black drop shadow; `invert` swaps the scheme —
// the sticker's one type option. The palette and metrics come from the
// engine's stickerStyle so the SVG exporter draws the identical card (the
// journal image must match this preview); lengths there are cells, scaled
// here by BASE_CELL_PX.
// The sticker's node bbox IS the card (the scaffold sizes it to text +
// STICKER_PAD_CELLS all round), so the card fills the bbox and the centered
// text supplies the interior margin — selection box and card coincide.
function stickerShadowCss(px: number): string {
  const s = STICKER_SHADOW_CELLS;
  return `${s.dx * px}px ${s.dy * px}px ${s.blur * px}px rgba(0, 0, 0, ${s.opacity})`;
}

/** Re-render when the pack fonts finish loading. Text layout positions bake in
 *  the measured line width, which is font-blind until the real face is ready;
 *  center/right-aligned text is otherwise stuck at its fallback-metric position
 *  (the glyphs repaint in the loaded font but their computed `left` doesn't).
 *  See fontsEpoch.ts. */
function useFontsEpoch(): number {
  const [epoch, setEpoch] = React.useState(getFontsEpoch);
  React.useEffect(() => subscribeFontsEpoch(() => setEpoch(getFontsEpoch())), []);
  return epoch;
}

/** The laid-out lines of a text node, absolutely positioned in its inner box.
 *
 *  Rendered twice when the node has a drop shadow — once transparent to cast
 *  it, once for real — so the two passes cannot break each other's line
 *  positions. `shadow` swaps the fill for the shadow and drops the ink
 *  (per-character brushwork, the outline stroke): a shadow is one silhouette,
 *  and the export's filter reads the glyphs' alpha, not their colors. */
function TextLines({ layout, style, lineHeightPx, color, charColors, shadow, filter }: {
  layout: ReturnType<typeof layoutText>;
  style: TextObject['style'];
  lineHeightPx: number;
  color: string;
  charColors?: (RGBColor | null)[];
  shadow?: string;
  /** A CSS filter for the BENT branch's `<svg>` — how a bent text casts its
   *  drop shadow, WebKit painting no `text-shadow` on SVG text
   *  (effectsBoxShadow's textShadowFilter). Cast from the ink, so it rides
   *  the ink pass and the flat branch never has one. */
  filter?: string;
}) {
  const px = BASE_CELL_PX;
  const hasCharColors = !shadow && !!charColors && charColors.some(Boolean);
  // Ids for the bend arcs, unique per PASS: the shadow and ink passes each
  // render their own TextLines, and duplicate DOM ids would send both
  // passes' textPaths to whichever arc landed first.
  const arcIdBase = React.useId();
  const bend = textBend(style);
  if (bend !== 0) {
    // Bent text: the same block of concentric arcs the SVG export rides its
    // <textPath>s along (textArcPaths — shared math, so the stored image and
    // this preview bow identically), drawn as an inline SVG over the inner
    // box. Each path sits where the flat line's glyph midline would (line.y
    // + half the line height) with a `central` baseline, so bend → 0
    // converges on the DOM lines below.
    const arcs = textArcPaths(
      layout.lines.map((line) => ({ x: line.x * px, y: line.y * px + lineHeightPx / 2, width: line.width * px })),
      bend,
    );
    return (
      <svg
        aria-hidden
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', filter }}
        width={1}
        height={1}
      >
        {layout.lines.map((line, i) => {
          if (line.text.length === 0 || line.width <= 0) return null;
          const id = `${arcIdBase}b${i}`;
          return (
            <React.Fragment key={i}>
              <path
                id={id}
                d={arcs[i]}
                fill="none"
              />
              <text
                xmlSpace="preserve"
                dominantBaseline="central"
                fill={color}
                stroke={!shadow && style.stroke ? rgbCss(style.stroke.color) : undefined}
                strokeWidth={!shadow && style.stroke ? style.stroke.width * px : undefined}
                strokeLinejoin="round"
                paintOrder="stroke"
                style={{
                  fontFamily: fontFamilyFor(style.fontId),
                  fontSize: style.size * px,
                  fontWeight: effectiveFontWeight(style),
                  fontStyle: style.italic ? 'italic' : 'normal',
                  letterSpacing: `${(style.letterSpacing ?? 0)}em`,
                  textShadow: shadow,
                }}
              >
                <textPath href={`#${id}`}>
                  {hasCharColors
                    ? charColorRuns(line.text, line.start, charColors!).map((run, ri) => (
                      <tspan key={ri} fill={run.color ? rgbCss(run.color) : undefined}>
                        {run.text}
                      </tspan>
                    ))
                    : line.text}
                </textPath>
              </text>
            </React.Fragment>
          );
        })}
      </svg>
    );
  }
  return (
    <>
      {layout.lines.map((line, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: line.x * px,
            top: line.y * px,
            whiteSpace: 'pre',
            fontFamily: fontFamilyFor(style.fontId),
            fontSize: style.size * px,
            lineHeight: `${lineHeightPx}px`,
            fontWeight: effectiveFontWeight(style),
            fontStyle: style.italic ? 'italic' : 'normal',
            letterSpacing: `${(style.letterSpacing ?? 0)}em`,
            color,
            textShadow: shadow,
            WebkitTextStroke: !shadow && style.stroke
              ? `${style.stroke.width * px}px ${rgbCss(style.stroke.color)}`
              : undefined,
          }}
        >
          {hasCharColors
            ? charColorRuns(line.text, line.start, charColors!).map((run, ri) => (
              <span key={ri} style={run.color ? { color: rgbCss(run.color) } : undefined}>
                {run.text}
              </span>
            ))
            : line.text}
        </div>
      ))}
    </>
  );
}

/** The ink pass: TextLines at the style's colours, faded as one by `alpha`
 *  (style.alpha, the text colour picker's slider) — one wrapper fading
 *  fill, per-char brush colours and the outline stroke together, matching
 *  the export's `opacity` on the <text> element. A sticker passes no alpha:
 *  its whole magnet fades on the oriented wrapper instead. */
function TextInkPass({ layout, style, lineHeightPx, color, charColors, filter, alpha }: {
  layout: ReturnType<typeof layoutText>;
  style: TextObject['style'];
  lineHeightPx: number;
  color: string;
  charColors?: (RGBColor | null)[];
  filter?: string;
  alpha?: number;
}) {
  const lines = (
    <TextLines
      layout={layout}
      style={style}
      lineHeightPx={lineHeightPx}
      color={color}
      charColors={charColors}
      filter={filter}
    />
  );
  return alpha != null && alpha < 1
    ? <div style={{ position: 'absolute', inset: 0, opacity: alpha }}>{lines}</div>
    : lines;
}

/**
 * The color tool's live preview of a stroke's brushwork on one text: the
 * touched characters at the colours the stroke has blended them to, drawn
 * INSIDE the node's paint host (textPaintPreview.tsx) by the very ink pass
 * the node draws its committed colours with — same layout, same line
 * boxes, same CSS — over a TRANSPARENT base colour, so a touched glyph is
 * recoloured exactly on itself and every other glyph draws nothing.
 *
 * It was an SVG `<text>` per character in the screen-space overlay: type
 * set at the node's CELL size inside a group scaled up to the camera, at
 * lineCharBoxes' summed advances, on the export's `central` baseline — a
 * second layout of the same glyphs, with its own advances and baseline,
 * that did not land on the DOM line's (measured ~7 px along the line by
 * the second glyph at text size 2), so every brushed character sat beside
 * its own ink for the length of the drag and snapped back on the drop.
 */
export function TextPaintPreviewInk({ drawn, charColors }: {
  drawn: DrawnLeaf;
  charColors: (RGBColor | null)[];
}) {
  // A face arriving mid-stroke re-lays the node out; the preview re-lays
  // out with it (the paint host sits inside the node's own box).
  useFontsEpoch();
  const { text, layout, lineHeight } = drawnTextLayout(drawn);
  // Faded like the node's own ink: the commit draws these colours through
  // the same Fade row, so the preview must too or the drop shifts hue.
  const style = fadedTextStyle({ ...text.style, charColors });
  return (
    <TextInkPass
      layout={layout}
      style={style}
      lineHeightPx={lineHeight * BASE_CELL_PX}
      color="transparent"
      charColors={style.charColors}
      alpha={style.alpha}
    />
  );
}

export const TextNodeLayer = React.memo(function TextNodeLayer({ drawn, caret, selection }: {
  drawn: DrawnLeaf;
  /** In-canvas caret (native text editing: the node IS the input box, so the
   *  caret draws here, between the glyphs the layout places). Layout-space
   *  LOCAL cells — see textCaret.ts. Null/absent = not editing this node. */
  caret?: TextCaretBox | null;
  /** …and the SELECTION behind them, one band per line it covers
   *  (textSelectionBoxes). The textarea is invisible on native, so without
   *  these a chosen range is a thing the next keystroke silently replaces.
   *  Drawn UNDER the glyphs, as a text field's selection is. */
  selection?: readonly TextSelectionBox[] | null;
}) {
  const node = drawn.node.content as TextObject;
  // Subscribed for the side effect: a bump re-runs layoutText below with real
  // font metrics, so aligned text snaps to its edge once the face loads.
  useFontsEpoch();
  if (node.hidden) return null;
  // The style as it is DRAWN: the Fade row's mix applied to the ink, to
  // every per-character brush colour and to the outline stroke, before
  // anything here reads a colour off it (engine/fade.ts). `alpha` is left
  // alone — that is the page's OTHER row.
  const style = fadedTextStyle(node.style);
  const isSticker = !!node.sticker;
  const { bg: stickerBg, fg: stickerFg } = stickerColors(isSticker && node.invert);
  // Stickers force a fixed black/white scheme (ignoring style.color) so the
  // invert toggle owns their color entirely; plain text uses its own color.
  const textColorCss = isSticker ? stickerFg : rgbCss(style.color);
  // The node's lines, laid out in its LOCAL box (drawnTextLayout — the one
  // layout the brush's char boxes and the stroke preview share). maxWidth
  // word-wraps the content to the box width, so shrinking the box with a
  // corner handle re-flows the text to fit instead of overflowing (font size
  // stays fixed there — a two-finger pinch is the gesture that scales the
  // type with the box, see buildScaleNode). Freshly placed text shrink-wraps
  // to its content width, so it stays a single line until the box is
  // narrowed. The matrix wrapper below is sized to that same box, and the
  // sticker card fills it. (The exporter lays out in the legacy view's
  // content box, which is this box at the view's scale.)
  const { layout, lineHeight } = drawnTextLayout(drawn);
  const frame = drawnFrame(drawn, BASE_CELL_PX);
  const inner = innerStyle(frame);
  const px = BASE_CELL_PX;
  const lineHeightPx = lineHeight * px;
  // Per-character brush colors (the color tool on text): lines split into
  // same-color spans by the SAME rule the SVG export splits its tspans
  // (charColorRuns), so the two renderers lose kerning at identical
  // boundaries. Sticker ink is the card scheme's, so brushwork never shows.
  const charColors = isSticker ? undefined : style.charColors;
  // An authored drop shadow on plain text is cast by the GLYPHS (text-shadow),
  // matching the export's filter over the <text> elements — so the bbox
  // box-shadow every other node kind wears is suppressed for it. A sticker
  // keeps the box version: its bbox IS its card, which is what the export
  // shadows there. Alpha rides the wrapper (see textShadowCss), applying once
  // however many copies a `spread` ring needs.
  const glyphShadow = isSticker ? undefined : node.effects?.shadow;
  // …and cast two different ways, because a BENT line is not DOM text: it is
  // drawn as SVG <textPath>s, and WebKit paints no `text-shadow` on SVG
  // text — so a text with a drop shadow lost it the moment it was bent.
  // Bent text casts from its glyphs' own alpha instead (a drop-shadow
  // filter, the same silhouette the export's <feDropShadow> draws over the
  // same markup), which reads the INK: there is no transparent pass to cast
  // from, and the shadow's alpha rides its colour rather than a wrapper.
  const bent = textBend(style) !== 0;
  const glyphShadowCss = bent ? undefined : textShadowCss(glyphShadow, drawn.world);
  const glyphShadowFilter = bent ? textShadowFilter(glyphShadow, drawn.world) : undefined;
  // Only the shadow moves to the glyphs; anything else in the block still
  // draws on the box.
  const boxEffects = glyphShadow ? { ...node.effects, shadow: undefined } : node.effects;
  // A sticker's alpha is the whole magnet's: card, border, shadow and ink
  // fade together on the oriented wrapper — matching the export's `opacity`
  // on the node group. (Plain text fades its ink alone, below.)
  const stickerOpacity = isSticker && style.alpha != null && style.alpha < 1 ? style.alpha : undefined;
  return (
    <div data-node-id={node.id} style={outerStyle(frame, boxEffects)}>
      <div style={stickerOpacity !== undefined ? { ...inner, opacity: stickerOpacity } : inner}>
        {isSticker ? (
          // The card fills the bbox exactly (bbox === card), so the selection
          // outline and hit area hug the visible card.
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: stickerBg,
              border: `${STICKER_BORDER_CELLS * px}px solid ${stickerFg}`,
              boxSizing: 'border-box',
              boxShadow: stickerShadowCss(px),
            }}
          />
        ) : null}
        {glyphShadowCss ? (
          // The shadow pass, behind the ink: transparent glyphs casting a
          // text-shadow, faded as a group so the shadow's own alpha lands once
          // rather than compounding across a spread ring's copies.
          <div
            aria-hidden
            style={{ position: 'absolute', inset: 0, opacity: glyphShadow!.alpha, pointerEvents: 'none' }}
          >
            <TextLines
              layout={layout}
              style={style}
              lineHeightPx={lineHeightPx}
              color="transparent"
              shadow={glyphShadowCss}
            />
          </div>
        ) : null}
        {/* The ink, faded as one by style.alpha (TextInkPass). A sticker's
            alpha fades the whole magnet on the wrapper above instead, and
            the shadow pass keeps its own. */}
        <TextInkPass
          layout={layout}
          style={style}
          lineHeightPx={lineHeightPx}
          color={textColorCss}
          charColors={charColors}
          filter={glyphShadowFilter}
          alpha={isSticker ? undefined : style.alpha}
        />
        {/* data-paint-host: the color tool's live stroke preview renders the
            brushed characters in here (TextPaintPreviewInk, mounted by
            textPaintPreview.tsx) — the same ink pass over the same layout as
            above, so a mid-stroke glyph sits exactly on the glyph it colours
            and rides the node's transform with it. Never has React children
            of its own. */}
        <div data-paint-host="" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
        {selection && selection.length > 0 ? (
          // The selection, painted behind the glyphs it covers: iOS's own
          // system blue at the tint a text field uses, so a range reads as
          // chosen rather than as a highlight somebody drew. Same layout
          // units as the caret, so it rides the node's transform and the
          // camera zoom with the text it sits under.
          <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
            {selection.map((band, i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: band.x * px,
                  top: (band.y + band.height * 0.06) * px,
                  width: band.width * px,
                  height: band.height * 0.88 * px,
                  borderRadius: 2,
                  background: 'rgba(10,132,255,0.28)',
                }}
              />
            ))}
          </div>
        ) : null}
        {caret ? (
          // Native in-canvas caret: iOS system blue, blinking via the global
          // cj-caret-blink keyframes (app/+html.tsx). Sized to the line with a
          // small vertical inset so it reads as a caret, not a divider; drawn
          // in layout units so it rides the node's transform and the camera
          // zoom exactly like the glyphs beside it.
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: caret.x * px - 1,
              top: (caret.y + caret.height * 0.08) * px,
              width: 2,
              height: caret.height * 0.84 * px,
              borderRadius: 1,
              background: '#0A84FF',
              pointerEvents: 'none',
              animation: 'cj-caret-blink 1s step-end infinite',
            }}
          />
        ) : null}
      </div>
    </div>
  );
});
