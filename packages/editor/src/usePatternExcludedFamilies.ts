import { useCallback, useRef } from 'react';
import type { CompositionState } from '@/engine/types';
import { patternExcludedTileFamilies } from '@/editor-ui/logic/patternEdit';
import { patternGridOf } from './editorSession';
import { PATTERN_TILE_FAMILIES } from './patternTileFamilies';

// A pattern's TILE-SET FILTER, as the engine's connectivity wants it: the
// COMPLEMENT of the families the pattern is made of, memoized on the list
// itself.
//
// The memo is the point. This is asked once per painted cell — a pattern drag
// resolves the filter for every cell the finger crosses — and the answer only
// ever takes one of a handful of shapes, so without the cache every cell of
// every stroke minted a fresh Set.

export function usePatternExcludedFamilies() {
  // The tile-set filter — which sprite families a pattern is made of, and
  // so which tiles its Tiles menu offers and Random may pick for it.
  //
  // THE PATTERN'S OWN PROPERTY (PatternObject.tileSets, its Shapes page).
  // It was one switch for the whole install until 2026-09-23 (Settings →
  // developer mode → Tile Sets, ridden in on the URL), which meant two
  // patterns on one page could not be made of different things. So there
  // is no session-wide set to close over any more: every builder below is
  // handed the filter of the grid it is about to touch.
  //
  // Connectivity filters by EXCLUSION, so what the engine wants is the
  // complement — undefined when the pattern is made of everything there
  // is (patternExcludedTileFamilies).
  //
  // Memoized on the list itself, because this is asked PER PAINTED CELL:
  // a pattern drag resolves the filter once for every cell the finger
  // crosses, and the answer only ever takes one of a handful of shapes
  // (one per subset of the families, and a page uses two or three of
  // them). Without it every cell of every stroke minted a fresh Set.
  const excludedCacheRef = useRef(new Map<string, Set<string> | undefined>());

  const patternExcludedFamiliesOf = useCallback(
    (sets: readonly string[] | undefined) => {
      const key = sets && sets.length > 0 ? sets.join(',') : '';
      const cache = excludedCacheRef.current;
      if (cache.has(key)) return cache.get(key);
      const off = patternExcludedTileFamilies(PATTERN_TILE_FAMILIES, sets);
      cache.set(key, off);
      return off;
    },
    [],
  );

  /** …the same, for a grid named by id in a state: a pattern object's own
   *  list, or a shape's fill's (patternGridOf reads both). An id that
   *  names nothing — a pattern about to be CREATED — reads as the default
   *  families, which is what a new grid is made of. */
  const patternExcludedFamiliesFor = useCallback(
    (state: CompositionState, patternId: string | null | undefined) =>
      patternExcludedFamiliesOf(
        patternId ? patternGridOf(state, patternId)?.tileSets : undefined,
      ),
    [patternExcludedFamiliesOf],
  );

  return { patternExcludedFamiliesFor, patternExcludedFamiliesOf };
}
