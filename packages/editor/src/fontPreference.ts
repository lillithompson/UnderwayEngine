// The "last chosen font" preference: picking a font in the Text bar remembers
// it (persisted in AppSettings.lastFontId), and every new text element starts
// in that font instead of always defaulting to System. Kept pure and free of
// react/storage so the seed + change-detection rules are unit-tested; the
// EditorShell wires these to entryStore's getSettings/updateSettings.

/** The font a text element gets when no preference has been chosen yet — the
 *  historical default for the text tool and format scaffolds. */
export const DEFAULT_FONT_ID = 'system';

/**
 * The font id a new text element should start in, given the persisted
 * last-chosen font. Falls back to {@link DEFAULT_FONT_ID} when nothing has
 * been chosen yet (absent, or an empty stored value).
 *
 * `openingFontId` is a format's own declared starting face (EditorConfig's
 * `openingFontId`), and it OUTRANKS the remembered one, exactly as
 * `openingColor` outranks the remembered ink (activeColor.ts): a format
 * whose turn IS a word names the face that word is read in, and the
 * carry-across-files memory would otherwise quietly override it on the
 * second visit. It is still only a STARTING point — the first font picked
 * this session replaces it and is remembered as usual.
 */
export function resolveDefaultFontId(
  lastFontId: string | null | undefined,
  openingFontId?: string | null,
): string {
  if (openingFontId && openingFontId.length > 0) return openingFontId;
  return lastFontId && lastFontId.length > 0 ? lastFontId : DEFAULT_FONT_ID;
}

/**
 * Whether a committed text-style change actually switched the font family, and
 * so should be remembered as the new preference. Only a real change from the
 * node's previous font counts — committing a size/color/weight tweak that
 * leaves the font untouched must not re-save (and never overwrite the
 * preference with an unchanged value).
 */
export function shouldRememberFont(prevFontId: string | undefined, nextFontId: string): boolean {
  return nextFontId.length > 0 && nextFontId !== prevFontId;
}
