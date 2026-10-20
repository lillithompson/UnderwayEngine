// The STANDARD tools of the shared editor, and the modes a format can
// speak about. A leaf (no imports): an app's `web/formats/types.ts` builds
// its own `ToolId` as this union plus the ids of the tools it registers
// (`hostTools.ts`), and the config layer has to be able to name a tool or a
// mode without importing the toolbar (`components/toolbarMeta.ts`, where
// the behaviour behind every one of these lives).
//
// Why a closed union here and in each app, rather than `string`: the
// toolbar's tables are `Record<StandardToolId, …>`, so a standard tool
// without a label and a glyph fails the typecheck, and an app's own
// `Record<ToolId, …>` fails the same way for a tool it forgot to
// register. The toolbar's functions take `string` where a tool id comes
// IN (every app's union is assignable) and are typed where one goes OUT.
// vendor docs/shared-editor.md §4.3 records the decision.

/** The tools every Underway app's bar can carry. An app's own tools (Sol's
 *  plant, DrawBot's bots, CozyJournal's rig) are not here: they are
 *  registered as `HostTool`s and reach the bar through the registry. */
export type StandardToolId =
  | 'arrange'
  | 'photos'
  | 'draw'
  | 'text'
  | 'stickers'
  /** Recolour brush: the one brush that adds nothing. A drag only ever
   *  rewrites the colour of what is already under it — and of ONE kind of
   *  surface per pass, the kind its scope capsule names: Fills (a shape's
   *  fill, a photo's tint, a text's characters), Strokes (the line a thing
   *  is drawn in) or Patterns (a pattern grid's cells, a patterned shape's
   *  cloth included). Its own button on the bar, never inside the raster
   *  group — see 'paints'. */
  | 'color'
  /** Raster paint brush: stamps the page's canvas paint layer — one bitmap
   *  under every scene object — wherever a dab lands on no object, with
   *  visible vector objects occluding their silhouettes out of the stroke.
   *  Armed by the color group's Paint mode. */
  | 'paint'
  /** Paint eraser: the color brush run in reverse, lifting deposited paint
   *  (canvas layer, image / solid-shape paint layers, per-character text
   *  tints) back off. */
  | 'erase'
  /** Blur brush: everything under the cursor softens toward its local
   *  average — each object's own colors only, never its neighbors'. */
  | 'blur'
  /** Push brush: the one raster brush that MOVES what it touches instead of
   *  colouring it. A drag smears paint texels along under the disc, drags
   *  vector path points with it, and re-poses a host's own kind of object
   *  that answers to it (CozyJournal's Figgie rig) — whatever is under the
   *  brush, deformed by the same falloff. */
  | 'push'
  /** Straight-path tool; long-press toggles it to the rectangle tool. */
  | 'line'
  /** Quarter-arc tool; long-press toggles it to the circle tool. */
  | 'arc'
  /** Regular-polygon tool; selecting it drops down the sides slider. */
  | 'polygon'
  /** Pattern tool: drag on empty canvas to select a region of grid cells
   *  (max 16×16), which places an empty PatternObject of that resolution;
   *  tap/drag INSIDE an existing pattern to edit its component tiles with
   *  the active pattern sub-tool (random / erase / a specific tile) under
   *  the pattern's connectivity + symmetry rules. */
  | 'pattern'
  /** Unified line tool (the freehand / line / arc modes as ONE button);
   *  selecting it drops down the mode picker, and the picked mode decides
   *  which of the underlying tools ('draw' | 'line' | 'arc') actually
   *  activates. Configs use EITHER this or the separate ones. */
  | 'lines'
  /** Unified content tool (the image / text modes as ONE button, and after
   *  them every host tool that rides the row — `HostTool.contentMode`),
   *  built the same way as 'lines': selecting it drops down the mode
   *  picker, and the picked mode decides which underlying tool activates —
   *  'photos', 'text', or the host tool's own id. Configs use EITHER this
   *  or the separate 'photos' / 'text' ids. */
  | 'content'
  /** Unified RASTER brush tool (the paint / erase / blur / push modes as ONE
   *  button), built the same way as 'lines': selecting it drops down the mode
   *  picker, and the picked mode decides which underlying tool activates —
   *  every mode IS its tool id. All four work the page's texels: paint lays
   *  them, erase lifts them, blur averages them, push smears them.
   *
   *  The recolour brush is NOT one of them. It used to lead this group, and
   *  that made one button mean two unrelated things — the brush that adds
   *  nothing and the brush that can mark a blank page — with the gentler one
   *  buried a pushdown deep. 'color' is its own button now, and a bar carries
   *  either, both or neither. Configs use EITHER this or the standalone ids. */
  | 'paints'
  /** The colour SWATCH: a picker-only button, wearing the active colour as
   *  a filled disc, whose press opens the HSV picker and arms nothing. Not
   *  a tool at all — a setting's button, and it never lights as the active
   *  tool or disarms what is.
   *
   *  Every bar that can lay or move colour carries it, and it is the ONE
   *  place the colour is chosen. It used to hide inside the brushes: a disc
   *  hung off the raster group's capsule, and a lone 'color' button that
   *  opened a modal as well as arming. Both meant reaching for a colour
   *  dragged a brush along with it, and left the tool the button armed
   *  unnamed. Out here it arms nothing, and the brush buttons are plain
   *  arms. */
  | 'swatch';

// ── Tool sub-modes a format can speak about ─────────────────────────
// The grouped and long-press toggling tools each carry a mode of their own,
// and the behaviour behind them lives with the toolbar
// (components/toolbarMeta.ts, which re-exports these names). The TYPES live
// here, with StandardToolId, because a format can pin a mode the same way
// it lists its tools (EditorConfig.shapeLock, firstArrangeMode) and must be
// able to name it without importing the toolbar.

/** The line tool's long-press pair: a straight path, or an axis-aligned
 *  rectangle. */
export type LineToolMode = 'line' | 'rectangle';

/** The arc tool's long-press pair: a quarter arc, or a full circle. */
export type ArcToolMode = 'arc' | 'circle';

/** The selection tool's four modes (its capsule, left to right). Select is
 *  the tool as it always was — corner handles, two-finger scale and turn.
 *  Scale is Select with every resize held uniform. Move takes the handles
 *  away and leaves the object where the finger puts it. Rotate turns and
 *  nothing else. */
export type ArrangeMode = 'select' | 'scale' | 'move' | 'rotate';

/** What the unified content button can be set to place, of the modes
 *  every app has. A host tool that rides the row (`HostTool.contentMode`)
 *  adds its own id; an app's `ContentMode` is this union plus those. */
export type StandardContentMode = 'image' | 'text';
