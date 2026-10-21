import type {
  BorderEffect, GlowEffect, ImageFraming, ImageTintFill, ShadowEffect, SVGObject,
} from '@/engine/types';
import type {
  BorderModel, EndpointsModel, FramingModel, GlowKind, GlowModel, ShadowModel, TintModel,
} from '@/editor-ui';

// The property panel's models ↔ the engine's records, and the defaults an
// Add button materializes. The halves of each pair live together because
// they are one correspondence: the panel talks in design numbers and
// RGBLike, the document in world cells and RGBColor, and a field added to
// one has to be added to the other.
//
// The panel model these build is `panelModel.ts`'s; the handlers that write
// the records back are still each app's shell (docs/shared-editor.md §4.2,
// stage 6), which is why every converter here is exported.

// The default drop shadow (world-cell units = design pt ÷ 16) applied when
// the Shadow controls are first opened, so there's a visible effect to edit.
// Design default: x12 y14 blur18 spread2 opacity45% black.
export const DEFAULT_SHADOW_EFFECT: ShadowEffect = {
  dx: 0.75, dy: 0.875, blur: 1.125, spread: 0.125, color: { r: 0, g: 0, b: 0 }, alpha: 0.45,
};

/** Which NodeEffects slot each glow writes. The panel talks in "outer" and
 *  "inner" — which way the light goes — and the record keeps the outer one
 *  under the name it has had since v29. */
export function glowEffectKey(kind: GlowKind): 'glow' | 'innerGlow' {
  return kind === 'outer' ? 'glow' : 'innerGlow';
}

/** Every effect the Effects and Border pages can materialize, edit or
 *  recolour — the keys of NodeEffects they write. */
export type EffectKey = 'shadow' | 'border' | 'glow' | 'innerGlow';

// The default glow (world-cell units) the Add button creates: the shadow's
// own softness with nowhere to fall, in white rather than black — a glow is
// light where a shadow is its absence. One default for both, since which way
// it goes is the slot it lands in.
export const DEFAULT_GLOW_EFFECT: GlowEffect = {
  radius: 1.125, spread: 0.125, color: { r: 255, g: 255, b: 255 }, alpha: 0.6,
};

export function glowModelToEffect(m: GlowModel): GlowEffect {
  return {
    radius: Math.max(0, m.blur),
    spread: m.spread, // may be negative (erodes the source)
    color: { r: m.color.r, g: m.color.g, b: m.color.b },
    alpha: Math.max(0, Math.min(1, m.opacity)),
  };
}

export function glowEffectToModel(e: GlowEffect): GlowModel {
  return {
    blur: e.radius,
    spread: e.spread ?? 0,
    color: { r: e.color.r, g: e.color.g, b: e.color.b },
    opacity: e.alpha,
  };
}

export function shadowModelToEffect(m: ShadowModel): ShadowEffect {
  return {
    dx: m.dx,
    dy: m.dy,
    blur: Math.max(0, m.blur),
    spread: m.spread, // may be negative (erodes the shape)
    color: { r: m.color.r, g: m.color.g, b: m.color.b },
    alpha: Math.max(0, Math.min(1, m.opacity)),
  };
}

export function shadowEffectToModel(e: ShadowEffect): ShadowModel {
  return {
    dx: e.dx,
    dy: e.dy,
    blur: e.blur,
    spread: e.spread ?? 0,
    color: { r: e.color.r, g: e.color.g, b: e.color.b },
    opacity: e.alpha,
  };
}

// The default border (world-cell units) applied when the Border controls are
// first opened is `defaultBorderEffect(activeColor)` — a 6pt (0.375-cell)
// centered solid stroke in the active color (see activeColor.ts).

export function borderModelToEffect(m: BorderModel): BorderEffect {
  return {
    width: Math.max(0, m.width),
    position: m.position,
    dash: Math.max(0, Math.min(10, Math.round(m.dash))),
    color: { r: m.color.r, g: m.color.g, b: m.color.b },
  };
}

export function borderEffectToModel(e: BorderEffect): BorderModel {
  return {
    width: e.width,
    position: e.position ?? 'center',
    dash: e.dash ?? 0,
    color: { r: e.color.r, g: e.color.g, b: e.color.b },
  };
}

// The default image framing (design: Fill / Zoom 130% / Margin 14pt=0.875 cell /
// Ratio 1:1 / Straighten 0° / Size 46 / Spacing 6pt=0.375 cell) applied when the
// Crop bar is first opened, and restored by its trash.
export const DEFAULT_IMAGE_FRAMING: ImageFraming = {
  mode: 'fill', zoom: 1.3, margin: 0.875, ratio: 'square', angle: 0, tileScale: 0.46, tileGap: 0.375,
};

export function framingModelToEffect(m: FramingModel): ImageFraming {
  return {
    mode: m.mode,
    zoom: Math.max(1, Math.min(3, m.zoom)),
    margin: Math.max(0, m.margin),
    ratio: m.ratio,
    angle: Math.round(Math.max(-45, Math.min(45, m.angle))),
    tileScale: Math.max(0, Math.min(1, m.tileScale)),
    tileGap: Math.max(0, m.tileGap),
  };
}

export function framingEffectToModel(e: ImageFraming): FramingModel {
  return {
    mode: e.mode,
    zoom: e.zoom ?? 1.3,
    margin: e.margin ?? 0.875,
    ratio: e.ratio ?? 'square',
    angle: e.angle ?? 0,
    tileScale: e.tileScale ?? 0.46,
    tileGap: e.tileGap ?? 0.375,
  };
}

// TintModel (editor-ui, position/RGBLike) ↔ ImageTintFill (engine, offset/
// RGBColor). The blend + type unions are identical strings across both, so they
// pass through structurally.
export function tintModelToFill(m: TintModel): ImageTintFill {
  return {
    type: m.type,
    solid: { r: m.solid.r, g: m.solid.g, b: m.solid.b },
    stops: m.stops.map((s) => ({
      offset: Math.max(0, Math.min(1, s.position)),
      color: { r: s.color.r, g: s.color.g, b: s.color.b },
    })),
    angle: Math.round(((m.angle % 360) + 360) % 360),
    opacity: Math.max(0, Math.min(1, m.opacity)),
    blend: m.blend,
  };
}

/** The Endpoints bar's model for a path, resolving each absent field to its
 *  default so the segmented rows always have a selection to show. `SVGEndpoints`
 *  omits defaults (they cost nothing to store); the bar needs them concrete. */
export function endpointsModelOf(svg: SVGObject): EndpointsModel {
  const e = svg.endpoints;
  return {
    startMarker: e?.startMarker ?? 'none',
    endMarker: e?.endMarker ?? 'none',
    startCap: e?.startCap ?? 'round',
    endCap: e?.endCap ?? 'round',
  };
}

export function tintFillToModel(e: ImageTintFill, selectedStop = 0): TintModel {
  return {
    type: e.type,
    solid: { r: e.solid.r, g: e.solid.g, b: e.solid.b },
    stops: e.stops.map((s) => ({ position: s.offset, color: { r: s.color.r, g: s.color.g, b: s.color.b } })),
    selectedStop: Math.max(0, Math.min(Math.max(0, e.stops.length - 1), selectedStop)),
    angle: e.angle,
    opacity: e.opacity,
    blend: e.blend,
  };
}

