import { Paint, RGBColor } from '@/engine/types';
import { rgbToHex } from '@/engine/colorConvert';

// Color/paint helpers for the editor chrome and the DOM canvas overlay.

export function rgbCss(c: RGBColor, alpha?: number): string {
  return alpha === undefined || alpha >= 1
    ? `rgb(${c.r}, ${c.g}, ${c.b})`
    : `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

export function rgbToHexColor(c: RGBColor): string {
  return rgbToHex(c.r, c.g, c.b);
}

/** Longest hex a field accepts: '#' plus six digits. */
export const HEX_FIELD_MAX_LENGTH = 7;

/**
 * What a hex field keeps of a keystroke: a leading '#', then up to six hex
 * digits, uppercased. Everything else is dropped as it is typed rather than
 * rejected on commit — a field that silently refuses "g" is easier to use
 * than one that accepts it and then complains.
 */
export function normalizeHexDraft(text: string): string {
  const digits = text.replace(/[^0-9a-fA-F]/g, '').slice(0, 6).toUpperCase();
  return `#${digits}`;
}

/**
 * A typed hex string as a color, or null when it is not one yet — the strict
 * read an editable field commits on. Accepts '#RGB' and '#RRGGBB' (the '#' is
 * optional); a half-typed value is null, not black, so a field mid-edit never
 * flashes the wrong color onto the canvas.
 */
export function parseHexColor(text: string): RGBColor | null {
  const h = text.trim().replace(/^#/, '');
  if (!/^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(h)) return null;
  // '#abc' is '#aabbcc' — each digit doubled, the CSS shorthand.
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** CSS background for a Paint. Gradient geometry is in the unit bbox of
 *  the painted region, which maps directly onto CSS gradient coords. */
export function paintToCssBackground(paint: Paint): string {
  switch (paint.kind) {
    case 'solid':
      return rgbCss(paint.color, paint.alpha);
    case 'linear': {
      const angle = Math.atan2(paint.y2 - paint.y1, paint.x2 - paint.x1);
      // CSS 0deg points up; convert from unit-box vector (y down).
      const deg = 90 + (angle * 180) / Math.PI;
      const stops = paint.stops
        .map((s) => `${rgbCss(s.color, s.alpha)} ${Math.round(s.offset * 100)}%`)
        .join(', ');
      return `linear-gradient(${Math.round(deg)}deg, ${stops})`;
    }
    case 'radial': {
      const stops = paint.stops
        .map((s) => `${rgbCss(s.color, s.alpha)} ${Math.round(s.offset * 100)}%`)
        .join(', ');
      return `radial-gradient(circle at ${paint.cx * 100}% ${paint.cy * 100}%, ${stops})`;
    }
  }
}

/** Background gradient presets built from the current color (Color tool,
 *  nothing selected). */
export function backgroundGradientPresets(color: RGBColor): Paint[] {
  const soft: RGBColor = {
    r: Math.min(255, Math.round(color.r + (255 - color.r) * 0.75)),
    g: Math.min(255, Math.round(color.g + (255 - color.g) * 0.75)),
    b: Math.min(255, Math.round(color.b + (255 - color.b) * 0.75)),
  };
  return [
    { kind: 'linear', stops: [{ offset: 0, color: soft }, { offset: 1, color }], x1: 0, y1: 0, x2: 0, y2: 1 },
    { kind: 'radial', stops: [{ offset: 0, color: soft }, { offset: 1, color }], cx: 0.5, cy: 0.35, r: 0.9 },
  ];
}
