import type { CompositionState, PatternObject } from '@/engine/types';
import { findItem } from '@/engine/compositionOps';
import type { CommonEditorConfig } from './formats/editorConfig';
import { nodeIdNamed } from './editorSession';
import { tileGridLevelOf } from './tileTool';

// Grid-resolution stepping for the editor's left-column finer/coarser
// capsules. The engine's composition snap grid is an unbounded integer
// (step = 2^gridLevel — see CompositionState.gridLevel), but CozyJournal
// keeps the resolution capsules within a bounded window so tapping
// "coarser" or "finer" can't step the grid past a usable resolution in
// either direction. Lower level = finer.
//
// The floor is per-format: most formats stop at level 0 (one engine cell,
// a 32×32 grid on the page), but a format can open the window further down
// via CommonEditorConfig.canvas.minGridLevel — Reimagine allows 5 extra
// subdivisions (level −5, step 1/32 cell) so a squiggle can be extended in
// fine detail. Negative levels are safe end-to-end: the engine's snap math
// and camera are built for arbitrary subdivision, and the v45 composition
// format picks its coordinate precision from the saved gridLevel so
// fine-grid geometry survives the page's normalize-free save path exactly.

export const MIN_GRID_LEVEL = 0;
export const MAX_GRID_LEVEL = 6;

/** The floor MIN_GRID_LEVEL may be lowered to by a format's
 *  canvas.minGridLevel. Matches the finest level whose grid steps (and the
 *  half-steps the solo-H/V line snap uses) the engine's v45 save format
 *  encodes exactly — see coordScaleLog2For in compositionBinaryFormat. */
export const MIN_FORMAT_GRID_LEVEL = -5;

/** Bound a raw grid level to the usable resolution window and snap it to an
 *  integer level. `minLevel` is the format's floor (canvas.minGridLevel),
 *  itself bounded to [MIN_FORMAT_GRID_LEVEL, MIN_GRID_LEVEL] so a config
 *  can't open the window past what persistence encodes exactly. */
export function clampGridLevel(level: number, minLevel: number = MIN_GRID_LEVEL): number {
  const min = Math.max(MIN_FORMAT_GRID_LEVEL, Math.min(MIN_GRID_LEVEL, Math.round(minLevel)));
  return Math.max(min, Math.min(MAX_GRID_LEVEL, Math.round(level)));
}

/** The level a page minted THIS open starts at. The node the format opens
 *  on (CommonEditorConfig.firstSelectionName), when it is a pattern grid the Tile
 *  tool can work, sets it: Greeting's Center pane is laid at an 8-cell step
 *  while its template file was saved at a finer level, and the tool edits
 *  a pane in place only at the pane's own step — so the first tap on the
 *  pane must find the grid already there, not stack a speck over it.
 *  Otherwise the format's declared level (canvas.gridLevel — Reimagine
 *  aligns the grid to its stroke endpoints), else the level the state
 *  already carries. Clamped to the format's window either way. Fresh pages
 *  only: a reopened page keeps whatever level the user last stepped to. */
export function openingGridLevel(
  config: Pick<CommonEditorConfig, 'firstSelectionName'> & {
    canvas: Pick<CommonEditorConfig['canvas'], 'gridLevel' | 'minGridLevel'>;
  },
  state: CompositionState,
): number {
  const id = config.firstSelectionName ? nodeIdNamed(state, config.firstSelectionName) : null;
  const ref = id ? findItem(state, id) : null;
  const own = ref?.kind === 'pattern' ? tileGridLevelOf(ref.item as PatternObject) : null;
  const level = own ?? config.canvas.gridLevel;
  return level == null ? state.gridLevel : clampGridLevel(level, config.canvas.minGridLevel);
}
