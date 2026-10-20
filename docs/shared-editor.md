# The shared editor: what is shared, what is still copied, and the plan

Sol, DrawBot and CozyJournal are one editor three times over. Each app
vendors this repo as a submodule and consumes the engine (`packages/engine`),
the shell (`packages/shell`) and the chrome (`packages/editor-ui`), and each
carries under its own `web/editor/` a copy of the editor built on them — the
canvas screen, its session, its toolbar, its gestures — descended from
CozyJournal's and allowed to drift. The owner's goal (2026-10-20): every app
shares the basic image editor — the scene outline, the long-press menu, the
toolbar and the object property pages for every kind of object — and
differs only in the data that is its own (Sol's strains and plants,
DrawBot's inklings, CozyJournal's games and its Figgie rig). A `.tile`
imported from one app into another must be editable with the standard
affordances.

This document records where that stands and how the rest is to be done. It
is the engine's; the apps' codebase maps (`Sol.md`, `DrawBots.md`,
`CozyJournal.md`) describe each app's side.

## 1. Measured, 2026-10-20

Per-file comparison of the three `web/` trees (CRLF-insensitive), before
the work below:

| Tree | Files | In all three | Identical in all three | Lines (Sol / DrawBot / Cozy) |
|---|---|---|---|---|
| `web/editor/` (incl. `components/`) | 193 | 112 | 57 | 43 k / 55 k / 61 k |
| `web/editorUi/` (DrawBot's fork of editor-ui) | 59 | — | — | — / 14.8 k / — |
| `web/formats/` | 53 | 7 | 1 | 1.2 k / 4.0 k / 16.8 k |
| `web/store/` | 14 | 8 | 1 | 1.1 k / 1.7 k / 3.6 k |
| `web/fonts/` | 8 | 8 | 5 | 0.7 k each |

The drift is concentrated in a few large files. Lines that differ against
CozyJournal's copy:

| File | Sol | DrawBot | Cozy | Sol vs Cozy | DrawBot vs Cozy |
|---|---|---|---|---|---|
| `EditorShell.tsx` | 8,232 | 9,357 | 10,682 | 3,978 | 2,723 |
| `components/CanvasSurface.tsx` | 5,933 | 6,789 | 7,089 | 1,718 | 944 |
| `editorSession.ts` | 6,989 | 7,709 | 7,206 | 399 | 889 |
| `EditorHost.tsx` | 359 | 560 | 1,429 | 1,276 | 1,333 |
| `entryRaster.ts` | 373 | 227 | 905 | 794 | 858 |
| `importEntryTile.ts` | 262 | 379 | 432 | 310 | 417 |
| `components/toolbarMeta.ts` | 932 | 1,001 | 1,006 | 126 | 39 |
| `components/NodeLayer.tsx` | 1,326 | 1,167 | 1,167 | 161 | 0 |

Of the 57 files identical in all three, only 34 import nothing but the
engine, editor-ui, the shell and each other; the other 23 are identical
leaves that import a drifted file (`cameraMath`, `drawnPose`, `paintBrush`,
`editorSession`, `sliderModeMenu`, `toolbarMeta`, `activeColor`,
`NodeLayer`) and move only when it does.

## 2. Shared now

**`packages/editor-ui`** (the chrome: top bar, scene outline panel, the Edit
sheet and its pages, undo/redo, grid, colour picker) is consumed by all three
apps from this repo. DrawBot's fork of it is retired: its generic
improvements are in the package, and its bot, instruction-tile, arena and
fields pages are **host pages** — `ObjectPropertiesModel.hostPages`
(`HostPagesModel`), pages the host describes as rows in the panel's own
grammar (slider, segmented, switch, hue row, a stroke's width and dash, a
line of actions, a program of cards, a row of swatches with states) or as
the host's own element at a declared height; `hiddenCommonActions` trims the
common row; `OutlineObject.overlayRank` draws a host's own kind of thing in
the scene outline over the scene. This is the mechanism by which "the object
property pages for different types" are shared: the panel renders any kind's
pages, and an app supplies the rows for the kinds that are its own.

**`packages/editor`** (new) holds the 34 files that were identical in all
three apps and import nothing of any app: the long-press radial menu
(`radialMenu.ts`, `components/CanvasRadialMenu.tsx`), the tool sheet and
popover (`ToolGridSheet`, `ToolPopover`, `toolSheetGrid`, `tapTargetGrid`),
grid snap and the grid-weight / dimensions hooks, the resize and rotate
maths, the paint guards and paint overlay preview, the eyedropper sample,
the keyboard shortcuts, the confetti, the layout modal, the blend-mode table,
the text style model, the page-save and host round-trip helpers. The apps
import them through `@/editor/*` and their copies are gone. Eleven of their
tests moved with them.

## 3. Still copied, and why

Everything else under `web/editor/` is still per app because it imports the
app: `@/web/formats/types` (the `EditorConfig` and `ToolId` unions, which
differ per app), `@/web/store/*` (each app's entry store), `@/components/
bridgeSchema` (each app's native bridge events), `@/components/theme`, the
fonts, and the app's own trees (`web/sol`, `web/sim*`, Figgie). The shell
(`EditorShell.tsx`), the canvas (`CanvasSurface.tsx`), the session
(`editorSession.ts`) and the host (`EditorHost.tsx`) are where the apps'
own features are woven in by hand rather than plugged in.

## 4. The design for the rest: one editor, extended by a host

The principle the apps already state — "there is one editor and it is
configured, never forked" (`DrawBots.md` §4.1) — has to hold ACROSS the
apps, not only within one. The shared editor lives in `packages/editor`; an
app supplies an **extension** and a **config**, and nothing of the app is
imported by the package.

### 4.1 The `EditorExtension` interface (to be added to `packages/editor`)

What the three shells wire in by hand today, named as seams:

| Seam | Today, by hand | As an extension point |
|---|---|---|
| Extra tools on the bar | `ToolId` union members (`plant`, `bots`, `instructions`, `rig`, `word`, `tile`, `symmetry`) and their `TOOL_META` rows in each `toolbarMeta.ts` | `tools: HostTool[]` — id, label, glyph (MCI name or component), capsule (mode options), what arming it does. The standard tools stay in the package; `toolbarMeta` reads the host's list after its own. |
| Property pages for the app's kinds | DrawBot's `useSimEditor().selection`, CozyJournal's rig model, spread into the panel model in the shell | `hostPages(selection, session): HostPagesModel \| undefined` — already the engine's shape (`packages/editor-ui`); the shell calls it in one place. |
| Scene outline rows | `sceneOutlineModel.ts` per app (tag labels, rig glyphs, bots as overlays) | `outline: { tagLabels, iconFor(node), overlays(session) }` — the labels for functional `prefix:id` tags, a kind's glyph, and the host's overlay rows. |
| Layers drawn over the canvas | Sol's `RevealOverlay` / plant layer in `NodeLayer`, DrawBot's `DrawBotsLayer`, CozyJournal's `RigNodeLayer` | `layers: { nodeLayer?(node), overlay?(session, camera) }` — the host draws its own kinds of node and its own live layer, through the handles `CanvasSurface` already exposes. |
| Commit pipeline wrapper | DrawBot's `commitPipeline.ts` + `commitWrapper.ts`; Sol's `solEntry` and the index-aligned Sol undo stacks | `wrapCommit?(pipeline)` as DrawBot has it; Sol's parallel document rides `SessionEntry.hostOps` with its own undo stack kept in step — the one piece that needs a change to `editorSession`. |
| Host data in the file | Sol's `sol` chunk, DrawBot's `DBOT` trailer, both through the engine's v70 host-data chunks | `fileChunks: { tag, read(bytes, state), write(state) }` — the engine already carries foreign chunks through load, save and zip export untouched, which is what makes a foreign `.tile` editable: its scene is the engine's, and its host data waits for the app that wrote it. |
| Capsules and floating chrome | Sol's strain chips, DrawBot's transport and bot capsules, CozyJournal's rig sides | `capsules(session): CapsuleSpec[]` over the shared `ToolModeCapsule` / `PatternActionsCapsule` (DrawBot's `muted`/`locked`/`art` segments and wrap-to-rows are the generic superset to adopt). |
| Format configuration | `EditorConfig` per app, `makeFreeformConfig` | The common `EditorConfig` moves to the package; an app's extra fields ride `config.host: T`. |
| Host actions and events | `hostActions.ts`, `bridgeSchema.ts` per app | The shell keeps a typed `HostBridge` the app implements (what the shell package already does for native). |

### 4.2 Staged plan

Each stage ends with every app's `npm test`, `npm run typecheck` and
`npm run check:doc-paths` green, and a commit in each repo (the engine
first, then the pointer bump in each app).

1. **Done — chrome and leaves.** editor-ui unified with host pages;
   `packages/editor` with the 34 closed files.
2. **Toolbar.** `toolbarMeta.ts`, `ToolIcons.tsx`, `ToolModeCapsule.tsx`,
   `PatternActionsCapsule.tsx`, `floatingCapsuleSize.ts` move, with a
   `HostTool` registry for the app-specific tools and DrawBot's capsule
   superset adopted (muted / locked / drawn segments, tighten-then-wrap).
   `ToolId` becomes the standard union plus `string` for host tools.
3. **Session and camera.** `editorSession.ts` (with `hostOps` for Sol's
   parallel document and DrawBot's commit wrapper), `cameraMath.ts`,
   `canvasTap.ts`, `groupHit.ts` (DrawBot's pixels-only hit is the better
   rule and should be adopted by all), `transformGestures.ts`,
   `selectionOutline.ts`, `sceneOcclusion.ts`, `drawnPose.ts`,
   `paintBrush.ts`, `vectorEraser.ts`, `textCaret.ts` and the other
   identical leaves that import them (the 23 of §1).
4. **Outline and properties glue.** `sceneOutlineModel.ts` with the
   `outline` extension; the shell's panel-model builders (the ~1,500 lines
   of `ObjectPropertiesModel` wiring in each `EditorShell.tsx`) as a
   package module with `hostPages` as its one seam.
5. **Canvas.** `CanvasSurface.tsx` and `NodeLayer.tsx` with the `layers`
   extension; CozyJournal's rig layer, Sol's plant layer and DrawBot's sim
   layer become host layers.
6. **Shell and host.** `EditorShell.tsx` and `EditorHost.tsx` as the
   package's screen, taking `config`, `extension` and the app's store
   adapter; `web/formats/types.ts`'s common `EditorConfig`, `web/fonts/*`
   and the shared half of `web/store/*` move with them. Each app's
   `web/editor/` is then its extension alone.
7. **Property pages for the apps' kinds, all the way.** CozyJournal's rig
   pages (`rigEdit.ts`, `RigJointsBar`, `RigPoseBar`, `RigColorBar`), which
   this repo's editor-ui still carries, become CozyJournal host pages; the
   package then knows no app's kind of object at all.

### 4.3 Decisions that are the owner's

- **Where the apps disagree, which behaviour is canonical.** Known
  disagreements: DrawBot's pixels-only selection hit (`groupHit.ts`) vs the
  bbox fallback the others keep; CozyJournal's two-finger-tap landing window
  (`multiTapGesture.ts`, bug b3a2a998) which Sol and DrawBot lack; Sol's
  removal of the raster paint group and the pattern studio (config, not
  code, and fine); DrawBot's `push` brush being absent while Sol and
  CozyJournal have it.
- **Whether the rig stays in editor-ui** until stage 7 or moves to
  CozyJournal earlier. Sol and DrawBot carry its code today without using it.
- **The `ToolId` type.** A string registry (stage 2) loses the exhaustive
  switch the apps' `toolbarMeta` relies on; the alternative is a generic
  parameter `EditorConfig<TTool>` threaded through the package.
- **Whether CozyJournal commits agents' work** (its CLAUDE.md says never
  without being asked); the other two apps commit every finished change.

## 5. Line endings

Three of the four clones on the owner's Windows machine checked out CRLF
under Git's default `core.autocrlf=true`, which failed every source-pin
test (ten engine suites, fifty-eight of Sol's). This repo and Sol now carry
`.gitattributes` (`* text=auto eol=lf`), as DrawBot already did and as
CozyJournal achieves with `core.eol=lf`; a clone that had already checked
out CRLF needs the one-time rewrite in DrawBot's README.
