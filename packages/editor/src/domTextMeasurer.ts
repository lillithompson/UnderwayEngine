// DOM-based TextMeasurer for the engine's text layout: real per-font advances
// instead of textLayout's font-blind approximation, so a text node's bbox
// tracks the family/weight it actually renders in (the default measurer gives
// every font identical widths, which is why boxes used to drift from the
// glyphs when the font changed). Registered via registerTextMeasurer in
// loadPackFonts, which switches bbox measurement, node-layer layout, and SVG
// export together — they must share one measurer or exported line breaks
// drift from the editor's.
//
// It measures by LAYING THE LINE OUT, in a hidden shrink-to-fit element
// carrying the same CSS the node layer gives its line divs. Two things about
// that are the whole point, and both were wrong when this measured through
// `canvas.measureText` at a fixed 100 px:
//
//  · SAME ENGINE. A canvas 2D context resolves a font-family stack on its
//    own, and for `system-ui` (the default font's whole stack) Chrome's
//    answer is not the one CSS layout gives: at 24, 32 and 48 px it measures
//    "Hello Journal" 8-13% WIDER than the same string lays out in a div. The
//    box came out narrower than the glyphs at exactly the sizes the editor
//    uses — text size 2 renders at 2 x DOM_PX_PER_CELL = 32 px.
//  · SAME SIZE. Metrics are not linear in font size: the macOS system face
//    tracks differently at 32 px than at 100 px, so measuring at one size and
//    dividing back to ems is off by ~3% there whatever engine does it. We
//    measure at the size the line is DRAWN at — `style.size * DOM_PX_PER_CELL`,
//    the node layer's fixed layout size (zoom is a CSS transform above it, so
//    this is the px size at every zoom) — and divide by that.
//
// `document.fonts.check` gates every measurement: while a face is still
// loading (or in a DOM-less environment) we fall back to the deterministic
// default WITHOUT caching, so nothing wrong sticks once the face arrives.
//
// The DOM is reached through the duck-typed {@link TextProbe} so the logic
// stays unit-testable in the node suite, like settleFaces.ts next door.
//
// The FAMILY a fontId resolves to comes through fontFamily.ts's installed
// probe, which an app fills from its own pack (web/fonts/registerFonts, by
// way of loadPackFonts). With no pack installed every fontId measures in
// the system stack — which is what an app shows before its faces load, and
// what a test that installs nothing sees.

import { effectiveFontWeight } from '@/engine/fontWeight';
import { DOM_PX_PER_CELL } from '@/engine/svgStroke';
import { defaultMeasurer, TextMeasurer } from '@/engine/textLayout';
import { TextStyle } from '@/engine/types';
import { fontFamilyFor } from './fontFamily';

// Line widths churn with every keystroke; cap the cache so a long editing
// session can't grow it without bound. Chars are a small closed set and
// live in the same map.
const CACHE_MAX = 4000;

/** What the measurer needs from the page: one element it can put a font and
 *  a string into and read a laid-out width back from. */
export interface TextProbe {
  /** Width in px of `text` laid out with the CSS font shorthand `font`. */
  width(font: string, text: string): number;
}

/** CSS font shorthand — the same family stack, weight, italic flag and PX
 *  SIZE the DOM node layer renders this style's lines with. */
export function cssFont(style: TextStyle, px: number): string {
  const italic = style.italic ? 'italic ' : '';
  return `${italic}${effectiveFontWeight(style)} ${px}px ${fontFamilyFor(style.fontId)}`;
}

/** The px size the node layer lays a style's text out at. Zoom is a CSS
 *  transform on the world container, so this is the size the glyphs are
 *  SHAPED at whatever the camera is doing. */
export function layoutPxFor(style: TextStyle): number {
  return style.size * DOM_PX_PER_CELL;
}

/**
 * A measurer over one probe. `checkFace` is `document.fonts.check` (or null
 * where there is no CSS Font Loading API): false means the face is still
 * loading, and that measurement is neither used nor cached.
 */
export function makeTextMeasurer(
  probe: TextProbe | null,
  checkFace: ((font: string) => boolean) | null,
): TextMeasurer {
  const cache = new Map<string, number>();

  /** Advance of `text` in em units, or null when real metrics aren't
   *  available (no probe, a degenerate size, or a face still loading). */
  const measureEm = (text: string, style: TextStyle): number | null => {
    if (!probe) return null;
    const px = layoutPxFor(style);
    // A zero / negative / non-finite size has no ems to report, and would
    // divide the width by nothing.
    if (!(px > 0)) return null;
    const font = cssFont(style, px);
    const key = `${font}|${text}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    // check() is false only while a registered face is still loading — a
    // family with no @font-face resolves true and measures with the same
    // fallback the DOM renders with, which is exactly what we want.
    if (checkFace && !checkFace(font)) return null;
    const em = probe.width(font, text) / px;
    if (!Number.isFinite(em)) return null;
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, em);
    return em;
  };

  return {
    advance(ch: string, style: TextStyle): number {
      return measureEm(ch, style) ?? defaultMeasurer.advance(ch, style);
    },
    // Whole-line measurement, so kerning/shaping match the DOM's rendering of
    // the full line — per-char sums can't see pair adjustments.
    lineAdvance(text: string, style: TextStyle): number {
      const em = measureEm(text, style);
      if (em !== null) return em;
      let sum = 0;
      for (const ch of Array.from(text)) sum += defaultMeasurer.advance(ch, style);
      return sum;
    },
  };
}

// One hidden element, reused for every measurement. `position: absolute` +
// `white-space: pre` + `width: max-content` is a shrink-to-fit box around one
// unbreakable line, so its border box IS the line's advance width — including
// the shaping and kerning the real line gets, since this IS a real line.
// Letter spacing stays off: layoutText adds it per gap itself.
const PROBE_CSS = 'position:absolute;top:-9999px;left:-9999px;visibility:hidden;'
  + 'pointer-events:none;white-space:pre;width:max-content;margin:0;padding:0;border:0;'
  + 'letter-spacing:normal;word-spacing:normal;text-transform:none;';

let probeEl: HTMLElement | null = null;

/** The page's probe, made on first use and re-made if it is ever detached
 *  (a document swap). Null off-DOM, or before `<body>` exists — neither is
 *  cached, so the first measurement after the page is ready gets a real one. */
function domProbe(): TextProbe | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (!probeEl || !probeEl.isConnected) {
    probeEl = document.createElement('div');
    probeEl.setAttribute('aria-hidden', 'true');
    probeEl.style.cssText = PROBE_CSS;
    document.body.appendChild(probeEl);
  }
  const el = probeEl;
  return {
    width(font: string, text: string): number {
      el.style.font = font;
      el.textContent = text;
      return el.getBoundingClientRect().width;
    },
  };
}

/** Nothing to measure with: every call falls through to the engine's
 *  deterministic approximation, and nothing is cached. */
const FALLBACK: TextMeasurer = makeTextMeasurer(null, null);

// The measurer bound to the live probe — rebuilt only when the probe element
// is, so the width cache survives every ordinary call.
let bound: { el: HTMLElement; measurer: TextMeasurer } | null = null;

function live(): TextMeasurer {
  const probe = domProbe();
  if (!probe || !probeEl) return FALLBACK;
  if (!bound || bound.el !== probeEl) {
    bound = {
      el: probeEl,
      measurer: makeTextMeasurer(
        probe,
        typeof document.fonts?.check === 'function' ? (font) => document.fonts.check(font) : null,
      ),
    };
  }
  return bound.measurer;
}

/** The measurer the app registers. The probe is resolved per call, so a
 *  measurement attempted before `<body>` exists falls back for that call
 *  alone rather than for the session. */
export const domTextMeasurer: TextMeasurer = {
  advance(ch: string, style: TextStyle): number {
    return live().advance(ch, style);
  },
  lineAdvance(text: string, style: TextStyle): number {
    return live().lineAdvance!(text, style);
  },
};
