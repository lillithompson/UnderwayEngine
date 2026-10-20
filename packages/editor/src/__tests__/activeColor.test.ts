import { COLOR_PALETTE } from '@/engine/types';
import { rgbToHexColor } from '../colorUtils';
import {
  DEFAULT_ACTIVE_COLOR,
  DEFAULT_BORDER_WIDTH_CELLS,
  DEFAULT_RECENT_COLORS,
  RECENT_COLORS_MAX,
  defaultBorderEffect,
  pushRecentColor,
  resolveActiveColor,
  resolveRecentColors,
  storedActiveColor,
  storedRecentColors,
  toRGB,
} from '../activeColor';

// The editor's single active color: what new strokes and borders start in,
// and what every tool's color picker writes back to.


describe('DEFAULT_ACTIVE_COLOR', () => {
  it('is white', () => {
    expect(DEFAULT_ACTIVE_COLOR).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('is a palette swatch, so the picker can round-trip back to it', () => {
    expect(COLOR_PALETTE).toContainEqual([
      DEFAULT_ACTIVE_COLOR.r,
      DEFAULT_ACTIVE_COLOR.g,
      DEFAULT_ACTIVE_COLOR.b,
    ]);
  });
});

describe('toRGB', () => {
  it('keeps the channels', () => {
    expect(toRGB({ r: 1, g: 2, b: 3 })).toEqual({ r: 1, g: 2, b: 3 });
  });

  it('drops anything else a picker hands back', () => {
    const picked = { r: 1, g: 2, b: 3, a: 0.5, hex: '#010203' } as unknown as typeof DEFAULT_ACTIVE_COLOR;
    expect(Object.keys(toRGB(picked)).sort()).toEqual(['b', 'g', 'r']);
  });

  it('copies rather than aliases, so a later mutation cannot leak in', () => {
    const source = { r: 1, g: 2, b: 3 };
    const copy = toRGB(source);
    source.r = 99;
    expect(copy.r).toBe(1);
  });
});

// ── The color outlives the page ─────────────────────────────────────
// Picking red in one file leaves the next file — of any format — starting in
// red, rather than snapping back to white every time something new is opened.

describe('resolveActiveColor', () => {
  it('opens in the color last chosen', () => {
    expect(resolveActiveColor('#FF0000')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('opens in the default when nothing has ever been chosen', () => {
    expect(resolveActiveColor(undefined)).toEqual(DEFAULT_ACTIVE_COLOR);
    expect(resolveActiveColor(null)).toEqual(DEFAULT_ACTIVE_COLOR);
    expect(resolveActiveColor('')).toEqual(DEFAULT_ACTIVE_COLOR);
  });

  it('opens in the default rather than a partial color when the value is junk', () => {
    expect(resolveActiveColor('#GGGGGG')).toEqual(DEFAULT_ACTIVE_COLOR);
    expect(resolveActiveColor('#FF00')).toEqual(DEFAULT_ACTIVE_COLOR);
    expect(resolveActiveColor('red')).toEqual(DEFAULT_ACTIVE_COLOR);
  });

  it('round-trips every stored color exactly', () => {
    for (const [r, g, b] of COLOR_PALETTE) {
      expect(resolveActiveColor(storedActiveColor({ r, g, b }))).toEqual({ r, g, b });
    }
  });

  it('stores six digits with a leading #', () => {
    expect(storedActiveColor({ r: 232, g: 132, b: 107 })).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  // …except where the FORMAT names its own opening ink. A game whose
  // identity is a color opens in it every time, rather than in whatever the
  // last file of another game was left in.
  describe('a format’s declared opening color', () => {
    it('outranks the color carried across files', () => {
      expect(resolveActiveColor('#FF0000', '#123456')).toEqual({ r: 18, g: 52, b: 86 });
    });

    it('applies when nothing has ever been chosen', () => {
      expect(resolveActiveColor(undefined, '#123456')).toEqual({ r: 18, g: 52, b: 86 });
    });

    it('leaves the remembered color alone when the format names none', () => {
      expect(resolveActiveColor('#FF0000', undefined)).toEqual({ r: 255, g: 0, b: 0 });
      expect(resolveActiveColor('#FF0000', null)).toEqual({ r: 255, g: 0, b: 0 });
      expect(resolveActiveColor('#FF0000', '')).toEqual({ r: 255, g: 0, b: 0 });
    });

    it('falls through to the remembered color when the config value is junk', () => {
      // A typo in a config costs that format its opening ink and nothing
      // else — it must not also throw away what the user was working in.
      expect(resolveActiveColor('#FF0000', 'not-a-color')).toEqual({ r: 255, g: 0, b: 0 });
      expect(resolveActiveColor(undefined, '#GGGGGG')).toEqual(DEFAULT_ACTIVE_COLOR);
    });
  });

  // …and a PERSONAL opening ink — the drawer's own colour on a reaction or
  // a redline — is where the page STARTS and nothing more. Re-opening a
  // page already begun keeps the colour it was being drawn in.
  describe('a page already started (keepLastColor)', () => {
    it('keeps the colour last worked in over the opening ink', () => {
      expect(resolveActiveColor('#FF0000', '#123456', { keepLastColor: true }))
        .toEqual({ r: 255, g: 0, b: 0 });
    });

    it('still opens in the ink when nothing is remembered', () => {
      // Yielding to a colour that isn't there would open a reaction in
      // white, on a photograph.
      expect(resolveActiveColor(undefined, '#123456', { keepLastColor: true }))
        .toEqual({ r: 18, g: 52, b: 86 });
      expect(resolveActiveColor('#GGGGGG', '#123456', { keepLastColor: true }))
        .toEqual({ r: 18, g: 52, b: 86 });
    });

    it('changes nothing for a page being started', () => {
      expect(resolveActiveColor('#FF0000', '#123456', { keepLastColor: false }))
        .toEqual({ r: 18, g: 52, b: 86 });
      expect(resolveActiveColor('#FF0000', '#123456')).toEqual({ r: 18, g: 52, b: 86 });
    });

    it('falls to the default with neither an ink nor a memory', () => {
      expect(resolveActiveColor(null, null, { keepLastColor: true }))
        .toEqual(DEFAULT_ACTIVE_COLOR);
    });
  });
});

describe('the colour picker’s swatch row (recently used)', () => {
  const RED = { r: 255, g: 0, b: 0 };
  const GREEN = { r: 0, g: 255, b: 0 };
  const BLUE = { r: 0, g: 0, b: 255 };
  const ORANGE = { r: 251, g: 146, b: 60 };

  test('newest first, and a re-pick refreshes recency instead of repeating', () => {
    let recent = pushRecentColor([], RED);
    recent = pushRecentColor(recent, GREEN);
    recent = pushRecentColor(recent, BLUE);
    expect(recent).toEqual([BLUE, GREEN, RED]);
    recent = pushRecentColor(recent, RED);
    expect(recent).toEqual([RED, BLUE, GREEN]);
  });

  test('the row is seven cells, and the RIGHTMOST is the one dropped', () => {
    // Beside the eyedropper, which never moves; the newest lands next to it
    // and everything shuffles right, so the oldest falls off the end.
    expect(RECENT_COLORS_MAX).toBe(7);
    let recent: { r: number; g: number; b: number }[] = [];
    for (let i = 0; i <= RECENT_COLORS_MAX; i++) {
      recent = pushRecentColor(recent, { r: i, g: 0, b: 0 });
    }
    expect(recent).toHaveLength(RECENT_COLORS_MAX);
    expect(recent[0]).toEqual({ r: RECENT_COLORS_MAX, g: 0, b: 0 });
    // r:0 was the first pushed and therefore the rightmost; it is gone.
    expect(recent.some((c) => c.r === 0)).toBe(false);
  });

  test('starts as the spectrum: white, black, red, yellow, green, blue, purple', () => {
    expect(DEFAULT_RECENT_COLORS.map((c) => rgbToHexColor(c))).toEqual([
      '#FFFFFF', '#000000', '#FF0000', '#FFFF00', '#00FF00', '#0000FF', '#9400FF',
    ]);
    expect(DEFAULT_RECENT_COLORS).toHaveLength(RECENT_COLORS_MAX);
    // A fresh install — nothing stored — opens on the whole spectrum
    // rather than on an empty row.
    expect(resolveRecentColors(undefined)).toEqual([...DEFAULT_RECENT_COLORS]);
    expect(resolveRecentColors(null)).toEqual([...DEFAULT_RECENT_COLORS]);
    expect(resolveRecentColors([])).toEqual([...DEFAULT_RECENT_COLORS]);
  });

  test('a short stored list is padded from the spectrum, without doubling', () => {
    // One real pick keeps its place at the head; the rest of the row fills
    // from the defaults, and the default RED is skipped because the pick
    // already put a red in — the row never shows one colour twice.
    const row = resolveRecentColors(['#FB923C', '#FF0000']);
    expect(row).toHaveLength(RECENT_COLORS_MAX);
    expect(row.slice(0, 2)).toEqual([ORANGE, RED]);
    expect(row.filter((c) => rgbToHexColor(c) === '#FF0000')).toHaveLength(1);
  });

  test('round-trips through the persisted hex list, dropping garbage', () => {
    const stored = storedRecentColors([RED, GREEN]);
    expect(stored).toEqual(['#FF0000', '#00FF00']);
    expect(resolveRecentColors(stored).slice(0, 2)).toEqual([RED, GREEN]);
    expect(resolveRecentColors(['#FF0000', 'not-a-color', '#0000FF']).slice(0, 2))
      .toEqual([RED, BLUE]);
  });

  test('strips extra fields from picker color objects, like toRGB', () => {
    const fancy = { r: 1, g: 2, b: 3, extra: 'x' } as unknown as { r: number; g: number; b: number };
    expect(pushRecentColor([], fancy)[0]).toEqual({ r: 1, g: 2, b: 3 });
  });
});

describe('defaultBorderEffect', () => {
  it('starts a border in cyan when nothing has been picked yet', () => {
    expect(defaultBorderEffect()).toEqual({
      width: DEFAULT_BORDER_WIDTH_CELLS,
      position: 'center',
      dash: 0,
      color: DEFAULT_ACTIVE_COLOR,
    });
  });

  it('starts a border in the active color once one has been picked', () => {
    const picked = { r: 250, g: 204, b: 21 };
    expect(defaultBorderEffect(picked).color).toEqual(picked);
  });

  it('keeps the 6pt centered solid geometry whatever the color', () => {
    const e = defaultBorderEffect({ r: 0, g: 0, b: 0 });
    // 6 design pt ÷ BASE_CELL_PX (16) = 0.375 world cells.
    expect(e.width).toBeCloseTo(6 / 16, 10);
    expect(e.position).toBe('center');
    expect(e.dash).toBe(0);
  });

  it('does not alias the color it was handed', () => {
    const picked = { r: 1, g: 2, b: 3 };
    const e = defaultBorderEffect(picked);
    picked.g = 99;
    expect(e.color.g).toBe(2);
  });
});
