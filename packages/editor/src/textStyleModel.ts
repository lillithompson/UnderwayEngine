// Mapping between the engine's TextStyle and the editor-ui TextStyleModel the
// Text bar reads/writes — the text counterpart of EditorShell's
// shadow/border/framing model converters. Kept pure (no react) so the
// round-trip + reset semantics are unit-tested.

import { DEFAULT_LINE_HEIGHT } from '@/engine/textLayout';
import { FontWeight, TextAlign, TextStyle, TextVAlign } from '@/engine/types';
import type { TextStyleModel } from '@/editor-ui';

/** Default type size in world cells — matches the text tool's placement
 *  (onAddText). The Text bar's trash resets to this. */
export const DEFAULT_TEXT_SIZE = 2;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clampByte = (v: number) => clamp(Math.round(v), 0, 255);

/** Engine TextStyle → the Text bar's model. `weight` falls back to the legacy
 *  `bold` boolean for compositions saved before the weight control existed. */
export function textStyleToModel(style: TextStyle): TextStyleModel {
  return {
    fontId: style.fontId,
    weight: style.weight ?? (style.bold ? 'bold' : 'regular'),
    size: style.size,
    letterSpacing: style.letterSpacing ?? 0,
    lineHeight: style.lineHeight ?? DEFAULT_LINE_HEIGHT,
    bend: style.bend ?? 0,
    align: style.align ?? 'left',
    vAlign: style.vAlign ?? 'top',
    color: { r: style.color.r, g: style.color.g, b: style.color.b },
  };
}

/** The Text bar's model → engine TextStyle, folded onto the node's existing
 *  style so italic / stroke and other fields survive. `weight` is now
 *  authoritative, so the legacy `bold` flag is dropped to avoid two sources of
 *  truth (rendering + export read weight via effectiveFontWeight). */
export function textStyleModelToStyle(m: TextStyleModel, prev: TextStyle): TextStyle {
  const next: TextStyle = {
    ...prev,
    fontId: m.fontId,
    size: clamp(m.size, 0.1, 100),
    weight: m.weight as FontWeight,
    letterSpacing: m.letterSpacing,
    lineHeight: m.lineHeight,
    align: m.align as TextAlign,
    vAlign: m.vAlign as TextVAlign,
    color: { r: clampByte(m.color.r), g: clampByte(m.color.g), b: clampByte(m.color.b) },
  };
  // Flat (the Bend slider's middle) stores as absent — the meaning every
  // pre-bend file already has — so only actually bent text pays the field.
  if (m.bend !== 0) next.bend = clamp(m.bend, -1, 1);
  else delete next.bend;
  delete next.bold;
  return next;
}

/** The Text bar's trash: reset size / character / line / weight — and the
 *  arc bend, a metric distortion like the spacings — to defaults, keeping
 *  the font family, color and alignment (design 5a). */
export function resetTextStyle(prev: TextStyle): TextStyle {
  const next: TextStyle = {
    ...prev,
    size: DEFAULT_TEXT_SIZE,
    letterSpacing: 0,
    lineHeight: DEFAULT_LINE_HEIGHT,
    weight: 'regular',
  };
  delete next.bold;
  delete next.bend;
  return next;
}
