import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  ACCENT, BG_APP, BG_CARD, CTA_GRADIENT_COLORS, FONT_BODY, FONT_DISPLAY,
  type CardFill, INK, INK_FLIP_LUMA, INK_HINT, SMALL_CAPS, bannerFill,
  cardGradientCss, clamp01, fillBackgroundCss, fillTurnsWithShape,
  gradientAngle, hexToRgb, inkForFill, lightenHex, rgba,
} from '../appTheme';
import { perceivedLuma } from '@/engine/perceivedLuma';
import { BG_EDITOR_CANVAS, CANVAS_HAIRLINE } from '../theme';

// The APP CHROME's palette (appTheme.ts), which was one palette written out
// three times until stage 6.4a of docs/shared-editor.md: of the 69
// declarations all three Underway apps' `components/theme.ts` held, 60 were
// byte-identical and the other nine differed only in a doc comment. Not one
// value disagreed.
//
// THIS SUITE IS ALSO WHAT TYPECHECKS THE FILE, as every suite in this repo's
// two editor packages is: the root tsconfig excludes both, so ts-jest's
// diagnostics while a suite loads a module are the only check it gets (see
// `packages/editor/src/__tests__/editorConfig.test.ts`).
//
// What it holds is the two things a palette can get wrong beyond a value: a
// derived token that stops agreeing with the one it is derived FROM, and a
// helper whose arithmetic drifts. The per-app contrast figures stay in each
// app's own `components/theme.test.ts` — they are measured against that
// app's own inks and its own cards.

describe('the tokens that are derived from one another', () => {
  it('the flat accent is the CTA ramp’s opening stop', () => {
    // Two tokens, one value, on purpose — so a re-tune of the ramp cannot
    // leave the flat accent behind. Each app's own suite pins the hues.
    expect(ACCENT).toBe(CTA_GRADIENT_COLORS[0]);
  });

  it('the ink-flip threshold is a perceived luma, in the same units', () => {
    // `inkForFill` compares a fill's mean against this, and the mean comes
    // from `perceivedLuma` — 0 to 255. A threshold on a 0-to-1 scale would
    // read every fill as light.
    expect(INK_FLIP_LUMA).toBeGreaterThan(1);
    expect(INK_FLIP_LUMA).toBeLessThanOrEqual(255);
    expect(perceivedLuma(255, 255, 255)).toBeGreaterThan(INK_FLIP_LUMA);
    expect(perceivedLuma(0, 0, 0)).toBeLessThan(INK_FLIP_LUMA);
  });

  it('every colour token is a parseable hex or rgba, since the helpers parse them', () => {
    // `hexToRgb` and the CSS builders take `#rrggbb`; a three-digit or named
    // colour would read as black without failing anything.
    for (const hex of [BG_APP, BG_CARD, INK, INK_HINT, ACCENT, ...CTA_GRADIENT_COLORS]) {
      expect(hex).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe('inkForFill — dark words or light ones', () => {
  it('light fills take dark ink and dark fills take light', () => {
    expect(inkForFill({ colors: ['#ffffff', '#ffffff'] })).toBe('dark');
    expect(inkForFill({ colors: ['#000000', '#000000'] })).toBe('light');
  });

  it('reads the MEAN of a ramp, not its first stop', () => {
    // A ramp opening light and ending dark carries whichever ink its whole
    // face wants; judging it by the first stop is how a button ends up with
    // dark words over a dark middle.
    expect(inkForFill({ colors: ['#ffffff', '#000000', '#000000'] })).toBe('light');
    expect(inkForFill({ colors: ['#000000', '#ffffff', '#ffffff'] })).toBe('dark');
  });

  it('a stop it cannot parse is skipped rather than read as black', () => {
    // A ghost fill's stops are `rgba(...)`, and treating one as #000000
    // would flip a light card's ink.
    expect(inkForFill({ colors: ['#ffffff', 'rgba(0,0,0,0.5)'] })).toBe('dark');
  });
});

describe('the colour helpers', () => {
  it('hexToRgb reads the three channels', () => {
    expect(hexToRgb('#ffffff')).toEqual([255, 255, 255]);
    expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
    expect(hexToRgb('#39BBF8')).toEqual([0x39, 0xbb, 0xf8]);
  });

  it('rgba keeps the hex’s channels and adds the alpha', () => {
    expect(rgba('#39BBF8', 0.5)).toBe('rgba(57,187,248,0.5)');
  });

  it('lightenHex moves toward white and stops there', () => {
    expect(lightenHex('#000000', 0)).toBe('#000000');
    expect(lightenHex('#000000', 1)).toBe('#ffffff');
    expect(lightenHex('#ffffff', 0.5)).toBe('#ffffff');
    // Halfway from black is the midpoint, not a gamma-corrected one: this
    // palette lightens in sRGB bytes, as every tint built on it does.
    expect(lightenHex('#000000', 0.5)).toBe('#808080');
  });

  it('clamp01 bounds a fraction', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(2)).toBe(1);
  });
});

describe('a fill as CSS, for the WebView side', () => {
  const fill: CardFill = {
    colors: ['#ffffff', '#000000'],
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
  };

  it('cardGradientCss names every stop, in order', () => {
    const css = cardGradientCss(fill);
    expect(css.indexOf('#ffffff')).toBeGreaterThan(-1);
    expect(css.indexOf('#000000')).toBeGreaterThan(css.indexOf('#ffffff'));
  });

  it('gradientAngle turns a fill’s start/end pair into CSS degrees', () => {
    // 0° is up and the turn is clockwise, which is CSS's convention and not
    // the atan2 one the arithmetic starts from.
    expect(gradientAngle({ start: { x: 0, y: 0 }, end: { x: 0, y: 1 } })).toBe(180);
    expect(gradientAngle({ start: { x: 0, y: 0 }, end: { x: 1, y: 0 } })).toBe(90);
    expect(gradientAngle({ start: { x: 0, y: 1 }, end: { x: 0, y: 0 } })).toBe(0);
  });

  it('fillBackgroundCss and bannerFill answer for a flat colour too', () => {
    expect(fillBackgroundCss({ colors: ['#39BBF8', '#39BBF8'] })).toContain('#39BBF8');
    expect(bannerFill({ colors: ['#39BBF8'], angle: 160 }).colors[0]).toBe('#39BBF8');
  });

  it('fillTurnsWithShape says whether a fill follows the box’s long axis', () => {
    expect(typeof fillTurnsWithShape(fill)).toBe('boolean');
  });
});

describe('the fonts and the small-caps rule', () => {
  it('name real families rather than a system stack', () => {
    expect(FONT_DISPLAY.length).toBeGreaterThan(0);
    expect(FONT_BODY.length).toBeGreaterThan(0);
    expect(FONT_DISPLAY).not.toBe(FONT_BODY);
  });

  it('SMALL_CAPS is the style object a label spreads, not a font', () => {
    expect(SMALL_CAPS).toHaveProperty('textTransform', 'uppercase');
  });
});

describe('the two halves of the palette stay two halves', () => {
  it('this file holds no EDITOR chrome token, and theme.ts holds no app one', () => {
    // The split is the point: the editor's chrome (`theme.ts`) and the app's
    // (this file) are read by different screens, and a token in the wrong
    // one is a token two palettes will drift on. Checked as text, since
    // nothing else can see where a declaration lives.
    const here = readFileSync(resolve(__dirname, '..', 'appTheme.ts'), 'utf8');
    const editor = readFileSync(resolve(__dirname, '..', 'theme.ts'), 'utf8');
    for (const name of ['PANEL_BG', 'HEADER_BG', 'CAPSULE_BG', 'TOOLBAR_BUTTON_SIZE']) {
      expect(here).not.toContain(`export const ${name}`);
    }
    for (const name of ['BG_APP', 'BG_CARD', 'FONT_DISPLAY', 'RADIUS_CARD']) {
      expect(editor).not.toContain(`export const ${name}`);
    }
    // …and the two the apps DERIVE from the editor's half rather than
    // restating, so the canvas and an app's chrome cannot disagree.
    expect(BG_EDITOR_CANVAS).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(CANVAS_HAIRLINE.length).toBeGreaterThan(0);
  });
});
