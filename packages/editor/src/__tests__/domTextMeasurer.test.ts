/**
 * The text measurer: what it asks the page for, and when it declines to
 * answer. The probe is duck-typed (like settleFaces' FontFaceSet) so the
 * measurement rules are testable in the node suite, where there is no DOM.
 *
 * The FAMILY in the CSS font shorthand comes through fontFamily.ts's
 * installed probe, so a made-up pack is installed where one matters. That
 * a REAL app's pack resolves its own families is pinned in that app
 * (web/fonts/__tests__/domTextMeasurer), where the pack lives.
 */

import { DOM_PX_PER_CELL } from '@/engine/svgStroke';
import { defaultMeasurer } from '@/engine/textLayout';
import type { TextStyle } from '@/engine/types';
import { registerFontFamily, SYSTEM_STACK } from '../fontFamily';
import { cssFont, layoutPxFor, makeTextMeasurer, TextProbe } from '../domTextMeasurer';

const style = (over: Partial<TextStyle> = {}): TextStyle => ({
  fontId: 'dial', size: 2, color: { r: 0, g: 0, b: 0 }, ...over,
} as TextStyle);

/** A made-up pack, so the family in the shorthand is this suite's to predict
 *  rather than whichever app happens to be vendoring the package. */
beforeEach(() => registerFontFamily((id) => `'${id}-face', ${SYSTEM_STACK}`));
afterEach(() => registerFontFamily(null));

/** A probe that reports `perChar` px per character and records every ask. */
const fakeProbe = (perChar = 10) => {
  const asks: Array<{ font: string; text: string }> = [];
  const probe: TextProbe = {
    width(font, text) { asks.push({ font, text }); return text.length * perChar; },
  };
  return { probe, asks };
};

describe('the size a line is measured at', () => {
  it('is the px size the node layer lays that line out at, not a fixed one', () => {
    // The node layer draws text at `style.size * DOM_PX_PER_CELL` px and
    // leaves zoom to a CSS transform above it, so this is the size the
    // glyphs are shaped at whatever the camera is doing. Metrics are NOT
    // linear in size (the macOS system face tracks differently at 32 px
    // than at 100 px), so a fixed measuring size cannot be divided back
    // into ems.
    expect(layoutPxFor(style({ size: 2 }))).toBe(2 * DOM_PX_PER_CELL);
    expect(layoutPxFor(style({ size: 0.75 }))).toBe(0.75 * DOM_PX_PER_CELL);
    const { probe, asks } = fakeProbe();
    const m = makeTextMeasurer(probe, null);
    m.lineAdvance!('abc', style({ size: 2 }));
    expect(asks[0].font).toContain(`${2 * DOM_PX_PER_CELL}px`);
    expect(asks[0].font).not.toContain('100px');
  });

  it('divides the measured width by that same size, so the result is in ems', () => {
    const { probe } = fakeProbe(10);
    const m = makeTextMeasurer(probe, null);
    // 3 chars x 10 px = 30 px, laid out at size 2 -> 32 px.
    expect(m.lineAdvance!('abc', style({ size: 2 }))).toBeCloseTo(30 / 32, 10);
  });

  it('carries the family stack, the weight and the italic flag', () => {
    const { probe, asks } = fakeProbe();
    const m = makeTextMeasurer(probe, null);
    m.lineAdvance!('a', style({ fontId: 'dial', italic: true, weight: 'bold' }));
    expect(asks[0].font).toBe(cssFont(style({ fontId: 'dial', italic: true, weight: 'bold' }), 32));
    expect(asks[0].font).toMatch(/^italic 700 32px 'dial-face', /);
  });
});

describe('when it declines to measure', () => {
  it('falls back to the deterministic approximation with no probe', () => {
    const m = makeTextMeasurer(null, null);
    expect(m.advance('m', style())).toBe(defaultMeasurer.advance('m', style()));
    expect(m.lineAdvance!('mm', style())).toBeCloseTo(2 * defaultMeasurer.advance('m', style()), 10);
  });

  it('falls back — and caches nothing — while the face is still loading', () => {
    const { probe, asks } = fakeProbe();
    let loaded = false;
    const m = makeTextMeasurer(probe, () => loaded);
    expect(m.lineAdvance!('abc', style())).toBeCloseTo(3 * 0.6, 10); // the approximation
    expect(asks).toHaveLength(0);
    loaded = true;
    // Nothing wrong stuck: the first real answer arrives with the face.
    expect(m.lineAdvance!('abc', style())).toBeCloseTo(30 / 32, 10);
  });

  it('declines a size with no ems in it rather than dividing by nothing', () => {
    const { probe, asks } = fakeProbe();
    const m = makeTextMeasurer(probe, null);
    expect(m.lineAdvance!('abc', style({ size: 0 }))).toBeCloseTo(3 * 0.6, 10);
    expect(asks).toHaveLength(0);
  });
});

describe('the cache', () => {
  it('asks the page once per (font, string) pair', () => {
    const { probe, asks } = fakeProbe();
    const m = makeTextMeasurer(probe, null);
    m.lineAdvance!('abc', style());
    m.lineAdvance!('abc', style());
    expect(asks).toHaveLength(1);
    // A different size is a different measurement, not a scaled one.
    m.lineAdvance!('abc', style({ size: 4 }));
    expect(asks).toHaveLength(2);
  });
});

describe('the family it asks in', () => {
  it('is whatever the installed pack answers for that fontId', () => {
    expect(cssFont(style({ fontId: 'peg' }), 32)).toBe(`400 32px 'peg-face', ${SYSTEM_STACK}`);
  });

  // With no pack the shorthand is still a valid font string in the system
  // face — which is what an app shows before its faces load. A measurement
  // taken then is thrown away anyway (document.fonts.check gates it), but a
  // broken shorthand would make the probe answer nonsense rather than fall
  // back.
  it('is the system stack when no app has installed a pack', () => {
    registerFontFamily(null);
    expect(cssFont(style({ fontId: 'peg' }), 32)).toBe(`400 32px ${SYSTEM_STACK}`);
  });
});
