import { useCallback } from 'react';
import { togglePatternTileSet } from '@/editor-ui/logic/patternEdit';
import {
  buildForEachNode, buildSetPatternSettings, patternGridOf,
  type EditorSession, type SessionEntry,
} from './editorSession';
import { editTargetIds } from './panelModel';
import { PATTERN_TILE_FAMILIES } from './patternTileFamilies';

// WHAT A PATTERN IS MADE OF: one tile set toggled on or off over every grid
// named, as one undo step — and the Shapes page's way in, over the selection.
//
// Two statements, and they are a module rather than a pair of handlers for
// the reason the second one exists: ONE act with TWO ways in — a pattern
// OBJECT's Shapes tab and the Shapes section of a shape's Pattern page —
// because a fill's grid and a pattern object's are one grid
// (engine/shapePatternFill.ts). They differ only in which ids they aim at, so
// the edit is written once and the aiming twice, and the pair has to travel
// together or the shared half is a shell handler with one caller.
//
// Nothing of any app is in it: every name it reads is this package's
// (`editorSession`, `panelModel`, `patternTileFamilies`) or the chrome's
// pattern logic, and the two it is handed — the session ref and the commit
// pipeline — are the inputs 6.5b.2 settled on.

export function usePatternTileSets<S extends EditorSession>({
  sessionRef, applyEntry,
}: {
  sessionRef: { current: S | null };
  applyEntry: (se: SessionEntry | null) => void;
}) {
  /**
   * THE SHAPES PAGE'S EDIT: one tile set toggled on or off over every grid
   * named, as one undo step.
   *
   * One act, two ways in — a pattern OBJECT's Shapes tab and the Shapes
   * section of a shape's Pattern page — because a fill's grid and a
   * pattern object's are one grid (engine/shapePatternFill.ts). They
   * differ only in which ids they aim at, so they share this and not a
   * copy of it apiece.
   *
   * The list written down is EXPLICIT, in the registry's own family order:
   * once someone has said what a pattern is made of, the pattern says so
   * too, even when what they said happens to match the default.
   *
   * A press that would turn the LAST set off is refused
   * (togglePatternTileSet returns null) — a pattern with no families has
   * nothing to paint with, and Random would have nothing to pick. It is
   * refused PER GRID, so a mixed selection still moves the ones the press
   * is legal on.
   *
   * Only the SETTING changes. The cells already down are left exactly as
   * they are: turning a family off does not erase the tiles of it already
   * in the grid, it stops the next roll reaching for more.
   */
  const toggleTileSetOver = useCallback((ids: readonly string[], family: string) => {
    const s = sessionRef.current;
    if (!s || ids.length === 0) return;
    applyEntry(buildForEachNode(s.state, [...ids], (st, id) => {
      const grid = patternGridOf(st, id);
      if (!grid) return null;
      const tileSets = togglePatternTileSet(PATTERN_TILE_FAMILIES, grid.tileSets, family);
      return tileSets ? buildSetPatternSettings(st, id, { tileSets }) : null;
    }));
  }, [applyEntry]);

  /** The pattern object's SHAPES page: that toggle, over the selection —
   *  a multi-selection of patterns moves together, as the other pattern
   *  pages do. See {@link toggleTileSetOver}. */
  const onPatternToggleTileSet = useCallback((family: string) => {
    const s = sessionRef.current;
    if (s) toggleTileSetOver(editTargetIds(s), family);
  }, [toggleTileSetOver]);

  return {
    onPatternToggleTileSet, toggleTileSetOver,
  };
}
