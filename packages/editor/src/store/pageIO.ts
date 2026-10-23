import type { CompositionIOOptions } from '@/engine/persistence';

/**
 * An app's PAGE is page-anchored: its cell coordinates are positions on the
 * fixed (0,0)–(32, 32/aspect) page, so the engine's canonical-box
 * normalization must not run on ANY side of a round trip — save, load, the
 * `.tile` export that sync and Share ride, and the import that files a page
 * back in. Normalization exists for the tile editor, where a composition is
 * free-floating artwork; applied to a page it power-of-2 upscales any content
 * smaller than the canonical box and re-anchors it to the content bbox.
 * CozyJournal's Reimagine showed it worst: the day's squiggle is the page's
 * only seeded content, so the first save blew it up 4× and pushed half of it
 * off the page. A small drawing synced to another device did the same on
 * arrival. It also multiplies the stored `strokeScale`, which would make a
 * recipe's absolute stroke width land at a different weight on every page.
 *
 * One constant, every caller: the engine normalizes each step independently,
 * so opting one out alone accomplishes nothing.
 */
export const PAGE_IO: CompositionIOOptions = { normalize: false };
