/**
 * What a decoded record should look like once a stored fade has been SPENT
 * (engine/fadeBake.ts): the colours moved, and no pair left behind.
 *
 * Every binary round-trip test that writes a fade reads one of these back
 * rather than the two fields it wrote — the file still CARRIES them (that
 * is what makes it readable at all), but `deserializeComposition` spends
 * them on the way out so nothing downstream of a load is handed a colour
 * with a fade standing over it.
 */

import type { RGBColor } from '../types';

/** The amount as the writer stored it: a u8, so 0.5 comes back 128/255.
 *  Assertions below allow a channel of slack for exactly this. */
export function expectFadedTo(
  got: RGBColor | undefined, from: RGBColor, amount: number, to: RGBColor,
): void {
  expect(got).toBeDefined();
  for (const k of ['r', 'g', 'b'] as const) {
    const want = from[k] + (to[k] - from[k]) * amount;
    expect(Math.abs(got![k] - want)).toBeLessThanOrEqual(1);
  }
}

/** …and nothing kept on the record to outrank what it now draws in. */
export function expectNoStoredFade(node: { fade?: number; fadeColor?: RGBColor }): void {
  expect(node.fade).toBeUndefined();
  expect(node.fadeColor).toBeUndefined();
}
