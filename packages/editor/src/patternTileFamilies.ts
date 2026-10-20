import { SPRITE_ENTRIES } from '@/engine/spriteRegistry';
import { patternExcludedTileFamilies } from '@/editor-ui/logic/patternEdit';

/** Every sprite family there is, deduped and alphabetical — the choices
 *  a pattern's Shapes page offers, and the universe its own `tileSets`
 *  list is a subset of. Static: the registry is baked at build time. */
export const PATTERN_TILE_FAMILIES: string[] =
  [...new Set(SPRITE_ENTRIES.map((e) => e.family))].sort();

/** The families a grid that has never said otherwise is NOT made of — the
 *  exclusion a fresh pattern is rolled under. Static, like the list. */
export const DEFAULT_PATTERN_EXCLUDED_FAMILIES: Set<string> | undefined =
  patternExcludedTileFamilies(PATTERN_TILE_FAMILIES, undefined);
