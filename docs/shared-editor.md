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

**`packages/editor`** holds, from stage 1, the 34 files that were identical
in all three apps and import nothing of any app: the long-press radial menu
(`radialMenu.ts`, `components/CanvasRadialMenu.tsx`), the tool sheet and
popover (`ToolGridSheet`, `ToolPopover`, `toolSheetGrid`, `tapTargetGrid`),
grid snap and the grid-weight / dimensions hooks, the resize and rotate
maths, the paint guards and paint overlay preview, the eyedropper sample,
the keyboard shortcuts, the confetti, the layout modal, the blend-mode table,
the text style model, the page-save and host round-trip helpers; eleven of
their tests moved with them. From stage 2 it holds the toolbar: its
metadata and mode tables (`components/toolbarMeta.ts`), the standard tool
ids and the mode types a format names (`toolIds.ts`), the shape glyphs
(`components/ToolIcons.tsx`, `components/facetGlyphs.ts`), the mode
capsule and the floating actions pill (`components/ToolModeCapsule.tsx`,
`components/PatternActionsCapsule.tsx`) with their sizing and look
(`floatingCapsuleSize.ts`, `components/floatingCapsuleStyle.ts`), the
capsule swipe thresholds (`capsuleSwipe.ts`), and the first seam of the
`EditorExtension` (`extension.ts`): the host-tool registry (`hostTools.ts`,
§4.1), through which an app's own tools reach the bar. The apps import it
all through `@/editor/*` and their copies are gone; each app's
`web/editor/hostTools.ts` is its registry.

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
| Extra tools on the bar | `ToolId` union members (`plant`, `bots`, `instructions`, `rig`, `word`, `tile`, `symmetry`) and their `TOOL_META` rows in each `toolbarMeta.ts` | **Done (stage 2).** `tools: HostTool[]` (`packages/editor/src/hostTools.ts`, the first field of `EditorExtension` in `extension.ts`) — id, label, icon (an MCI name; a shape the font lacks is drawn by the shell, as the line, arc and polygon glyphs already are), `kind` (`'tool'`, armed and lit while in hand, or `'setting'`, which toggles and never lights — symmetry), `contentMode: { gate }` (the tool rides the content group's row behind a format flag — rig, word, tile) and `modeCapsule` (a hold on the lit button recalls its capsule — plant). The standard tools stay in the package; the toolbar's functions that have to know a host tool take the registry, and each app's `web/editor/hostTools.ts` is its registry plus `TOOL_META = toolMetaFor(HOST_TOOLS)`, the whole bar's table over its own `ToolId`. |
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
2. **Done — toolbar** (engine c828449, 2026-10-20). `toolbarMeta.ts`,
   `ToolIcons.tsx`, `facetGlyphs.ts` (CozyJournal's versions),
   `ToolModeCapsule.tsx`, `PatternActionsCapsule.tsx`,
   `floatingCapsuleSize.ts` and `floatingCapsuleStyle.ts` (DrawBot's — the
   generic superset: muted / locked / drawn segments, glyph-faced and
   muted momentary segments, tighten-then-wrap) are in `packages/editor`,
   with the capsule swipe thresholds (`capsuleSwipe.ts`, the identical
   part of each app's `topCapsuleSlot.ts`) beside them. The seam is the
   host-tool registry of §4.1: `toolIds.ts` holds the `StandardToolId`
   union and the mode types a format names, `hostTools.ts` the
   `HostTool` record, `extension.ts` the `EditorExtension` with `tools` as
   its first field. The content group reads the registry (a host tool
   rides the row behind its gate flag), a host setting never lights, a
   host tool with a capsule recalls it on a hold, and
   `tileToolButtonId` generalized to `buttonArmingTool(config, tool,
   hostTools)`. Sol registers plant (with its capsule); DrawBot bots,
   instructions, tile and symmetry; CozyJournal rig, word, tile and
   symmetry. Tile and symmetry are registered by two apps with identical
   rows — a candidate for the standard set, the owner's call. DrawBot's
   `ToolId` carries `push` (the standard union) and keeps it off its bar
   with an app-side filtered mode list until stage 3 and 5 bring the brush
   back. Seven test suites moved with the files (the generic halves of
   the apps' toolbarMeta, toolModeCapsules, patternActionsCapsule,
   capsuleWrap, topCapsuleSlot and facetGlyphs tests, and a registry
   suite over a made-up app); what each app's shell does with the bar
   stays pinned in the app, reading the components from the vendor path.
   One visible change rides the superset into Sol and CozyJournal: a mode
   row too wide for the window with the cycle arrows up now tightens its
   segments' padding before it wraps (CozyJournal's five-mode content row
   on a 393 pt phone goes from 14 to 11 pt a side), where it used to run
   off the edge. Shipped in the three apps on 2026-10-20 (CozyJournal two
   review rounds, Sol one, DrawBot three); what the reviews left for
   later: DrawBot registers bots and instructions without `modeCapsule`
   (its old bar never recalled their capsules on a hold — one flag each
   turns it on, the owner's call); `contentModeSpecs(hostTools)` builds its
   row per call and the shells pass a fresh `options` array per render,
   so the capsule's layout memo does not bite until the shell's option
   lists are memoized — both small, both for stage 6 when the shell is
   the package's; and `web/editor/__tests__/toolbarMeta.test.ts` in each
   app still holds the arrange-mode and freeform-bar pins the engine's
   suite does not, which move with `freeformConfig` at stage 6.
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

### 4.3 Decisions, and the ones still open

Settled by the owner, 2026-10-20:

- **CozyJournal is canonical.** Where the apps disagree, Sol and DrawBot
  are made like CozyJournal; the differences the others carry are
  oversights, not choices. In practice: a drifted file moves to the
  package in CozyJournal's version, and the other two apps take it. Known
  disagreements and their fate: DrawBot's pixels-only selection hit
  (`groupHit.ts`) goes back to CozyJournal's walk; CozyJournal's
  two-finger-tap landing window (`multiTapGesture.ts`) comes to Sol and
  DrawBot; DrawBot regains the `push` brush, which it cut with the rig, when
  the canvas and session are unified on CozyJournal's code (stage 3 and 5)
  — it reaches ten files of the drifted core and is not ported by hand
  before that.
- **The apps' working trees are committed** by agents in all three apps,
  CozyJournal's included (owner, 2026-10-20).
- **The `ToolId` type stays a closed union per app** (stage 2, 2026-10-20):
  `StandardToolId` (the package's, `toolIds.ts`) plus the app's own ids,
  declared in the app's `web/formats/types.ts`. Neither of the two options
  the question was posed as was taken. `string` for host tools would have
  dissolved the app's own `Record<ToolId, …>` and exhaustive switches as
  well as the package's; a generic `EditorConfig<TTool>` would have
  threaded a parameter through a package that never needs to know which
  host tool is armed — only that one is, and what its record says. So the
  package's `TOOL_META` is `Record<StandardToolId, …>` (exhaustive over
  what it owns), the app's is `Record<ToolId, …> = toolMetaFor(HOST_TOOLS)`
  (exhaustive over what it owns, since `toolMetaFor` is typed by the
  registry's ids and a tool in the union with no record fails there),
  and the package's functions take a tool id as `string` where one comes
  in — every app's union is assignable — and are typed where one goes
  out: the standard ids they can produce (`lineModeToolId`,
  `paintModeToolId`, `swatchPressTool`), or a generic parameter carrying
  the caller's type through (`nextToolOnPress`, `toolbarButtonIds`,
  `patternToolAnchor`, `contentModes` over the config's `contentTools`,
  `contentModeTarget` over the mode). The one place a shell narrows is
  where `contentModeOfToolId` seeds its `ContentMode` state. The same
  arrangement serves `ContentMode` (`StandardContentMode` plus the app's
  host modes).

Still open:

- **The rig's place.** This repo's editor-ui carries CozyJournal's Figgie
  rig pages (`logic/rigEdit.ts`, `RigJointsBar`, `RigPoseBar`,
  `RigColorBar`, `showRigOptions`), so Sol and DrawBot ship that code
  without using it. Stage 7 makes them CozyJournal host pages, the way
  DrawBot's bot pages already are; nothing forces that earlier.

## 5. Process

The shipping process the apps share — the review gate, the ship pass, the
doc-path check, the hook, the CI backstop, the shared CLAUDE.md rules — is
`tooling/` in this repo, consumed through the submodule and parametrized by
each app's `underway.config.json`; `tooling/README.md` says how an app is
wired and what moves out of its own tree.

Each app's review sees a tooling change through its pointer bump, so one
change to the process is reviewed three times (and, on 2026-10-20, each of
the three reviews found a different loose end in the same change). The gate
is doing its job, but the cost is real: a change to `tooling/` should be
reviewed once, here, and an app's review should treat a pure pointer bump
whose engine range is already reviewed as cleared. That is the next change
to make to the process itself — `review.js` reading the engine's own
records through the submodule — and it is not made yet.

Two things the first wiring taught: `git reset --hard` in a clone with
`submodule.recurse=true` detaches the submodule's HEAD (`check-clone`
reports it; check `main` out again before committing there), and a project
that never had the doc-path check will have stale paths in its codebase map
to fix before its first ship (CozyJournal had 23).

## 6. Line endings

Three of the four clones on the owner's Windows machine checked out CRLF
under Git's default `core.autocrlf=true`, which failed every source-pin
test (ten engine suites, fifty-eight of Sol's). This repo and every app
now carry `.gitattributes` (`* text=auto eol=lf`), as DrawBot already did;
a clone that had already checked out CRLF needs the one-time rewrite that
`npm run check:clone` prints.
