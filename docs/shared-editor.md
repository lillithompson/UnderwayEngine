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
CozyJournal's copy (the canvas and node-layer rows re-measured 2026-10-21,
before stage 5a: stage 4 had touched both since this table was first taken,
and `NodeLayer.tsx` was no longer identical in DrawBot):

| File | Sol | DrawBot | Cozy | Sol vs Cozy | DrawBot vs Cozy |
|---|---|---|---|---|---|
| `EditorShell.tsx` | 8,232 | 9,357 | 10,682 | 3,978 | 2,723 |
| `components/CanvasSurface.tsx` | 5,939 | 6,774 | 7,104 | 1,737 | 1,042 |
| `editorSession.ts` | 6,989 | 7,709 | 7,206 | 399 | 889 |
| `EditorHost.tsx` | 359 | 560 | 1,429 | 1,276 | 1,333 |
| `entryRaster.ts` | 373 | 227 | 905 | 794 | 858 |
| `importEntryTile.ts` | 262 | 379 | 432 | 310 | 417 |
| `components/toolbarMeta.ts` | 932 | 1,001 | 1,006 | 126 | 39 |
| `components/NodeLayer.tsx` | 1,326 | 1,168 | 1,167 | 161 | 3 |

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
§4.1), through which an app's own tools reach the bar. From stage 3 it
holds the session and the camera: `editorSession.ts` (the pure reducer and
every entry builder), `cameraMath.ts`, `canvasTap.ts`, `groupHit.ts`,
`transformGestures.ts`, `selectionOutline.ts`, `sceneOcclusion.ts`,
`drawnPose.ts`, `paintBrush.ts`, `vectorEraser.ts`, `textCaret.ts`,
`multiTapGesture.ts`, `sliderModeMenu.ts`, `activeColor.ts`,
`colorUtils.ts`, DrawBot's `commitPipeline.ts`, the pattern patches with
the planar-faces geometry they cut (`patternPatches.ts`, `planarFaces.ts`),
the leaves that closed with them (`textNodeLayout`, `shapePaintDom`,
`imageDrawLevels`, `cameraAvoid`, `rowEntryMemo`, `patternToolSwitch`,
`editorPrefs`, `shapeStrokePreview`, `effectsBoxShadow`, and the
components `ShapePatternEditOutline`, `EyedropperLayer`,
`BlendPickerModal`, `NoPaintablesHint`, `PatternFillValueSlider`,
`ColorPickerModal`, `SliderModeTarget`, `BlendBadgeIcons`), and the second
seam of the `EditorExtension`: the session host (`sessionHost.ts`, §4.1) —
an app's parallel document moved by the same undo step, its own selectable
items, and its rules about nodes of its own kind — with the commit pipeline
wrapper beside it. From stage 4 it holds the SCENE OUTLINE and the
PROPERTIES GLUE: `sceneOutlineModel.ts` (the outline's view model — the row
for every node, a tagged node's label, which rows a selection lights) with
`frameDrop.ts`, the leaf that waited on it; `panelModel.ts`, the object
properties panel's model — `buildPanelFacts` reads the selection (what is
in hand, which pages its kind may open, the values those pages seed from)
and `buildPanelModel` lays the pages out, with the host's own pages as its
one seam; and `panelEffectModels.ts`, the panel's models ↔ the engine's
effect records with the defaults an Add button materializes. The third seam
of the `EditorExtension` comes with them: the outline host
(`outlineHost.ts`, §4.1) — how the outline reads a node of the app's own
kind, and the overlay rows its document holds. From stage 5a it holds the NODE LAYER and the
canvas's closed leaves: `components/NodeLayer.tsx` (every kind of scene
node's DOM — shape, image, text, paint, pattern — in CozyJournal's
version, with Sol's optional `children` on `SvgNodeLayer` adopted), the
fonts seam it needed (`fontsEpoch.ts`, identical in all three apps, and
`fontFamily.ts`, the stack rule with each app's pack installed through
`registerFontFamily` as the brush's glyph-ink probe already is),
`textPaintPreview.tsx` — held back at stage 3 waiting on `NodeLayer` — and
the nine leaves the canvas pulls in that import no app: `tileTool.ts`,
`canvasSymmetry.ts`, `regionChromeScreen.ts`, `symmetryReflect.ts`,
`symmetryAxesScreen.ts`, `symmetryObjects.ts`, `tapExclusion.ts`,
`afterReady.ts` and `editableRegion.ts`. The apps import it all
through `@/editor/*` and their copies are gone; each app's
`web/editor/hostTools.ts` is its registry and its `web/editor/extension.ts`
installs its session host and its outline host.

## 3. Still copied, and why

Everything else under `web/editor/` is still per app because it imports the
app: `@/web/formats/types` (the `EditorConfig` and `ToolId` unions, which
differ per app), `@/web/store/*` (each app's entry store), `@/components/
bridgeSchema` (each app's native bridge events), `@/components/theme`, the
fonts, and the app's own trees (`web/sol`, `web/sim*`, Figgie). The shell
(`EditorShell.tsx`), the canvas (`CanvasSurface.tsx`) and the host
(`EditorHost.tsx`) are where the apps' own features are still woven in by
hand rather than plugged in; the session's were unwoven at stage 3.

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
| Property pages for the app's kinds | DrawBot's `useSimEditor().selection`, CozyJournal's rig model, spread into the panel model in the shell | **Done (stage 4).** `hostPages` / `hiddenCommonActions` (`HostPagesModel`, `packages/editor-ui`) — per-SELECTION data, not an installed rule, so they are two fields of `PanelModelInput` (`panelModel.ts`) rather than a member of the extension, and the shell hands them in at the one place it builds the model. DrawBot's `useSimEditor().selection` IS that pair; CozyJournal's rig pages stay the chrome's until stage 7 and its shell spreads them over the built model. |
| Scene outline rows | `sceneOutlineModel.ts` per app (tag labels, rig glyphs, bots as overlays) | **Done (stage 4).** `outline?: OutlineHost` (`outlineHost.ts`, the third field of `EditorExtension`): `nodes(state)` — the host's reading of this page's own kinds, resolved ONCE per build (a glyph instead of the kind's, `chrome` for its rendering internals: CozyJournal's rig figure wears the Rig tool's glyph and its hidden pose record is no row) — and `overlays(state, doc)` — rows for what the host's DOCUMENT holds that draws over the scene (DrawBot's bots and instruction tiles, ranked by `overlayRank`, swallowed by a lit group they ride). Installed at module scope with the session host. The tag LABELS are not here: per-format or per-document data, handed to the builders as `tagLabels` (§4.3). |
| Layers drawn over the canvas, and the gestures a host claims | Sol's plant layers rendered by its canvas, DrawBot's `DrawBotsLayer` in a slot, CozyJournal's `RigNodeLayer` and its whole `rigPose` gesture mode | **Done (stage 5b.1).** `layers: { nodeLayer?(node) }` plus the CANVAS HOOKS — `GestureHooks` and `CanvasSurfaceHandle` — in `packages/editor/src/components/canvasHooks.ts`, with the host's per-node RECORDS and the TWO-FINGER TWIST beside them and `canvasTwist.ts`'s `resolveTwistUnit` reading what a pair would turn. Two of the four are installed rules on `EditorExtension.canvas` (`records`, `twist`); the hooks and `layers` are PROPS of `CanvasSurface`, which is the plan's own line (§4.3) — an installed rule goes on the extension, per-render data rides as a prop, as the panel's host pages do — and both close over state only the shell holds (DrawBot's `useSimEditor()`, Sol's per-render plant plan and its rasters' oversample). **The seam already existed and was adopted, not designed** (stage 5b, settled 2026-10-22): DrawBot had shipped it in its own `web/editor/components/canvasHooks.ts`, 56 lines that CozyJournal and Sol had no copy of, and CozyJournal's rig maps onto it member for member — `beginRigPose` IS `onPointerDown` returning a CLAIM, the move case IS `onPointerMove`, `finishRigPose` IS `onPointerUp`, and the hold that abandons a pose grab (so a rig is not the one object whose radial menu will not open) IS `holdOpensMenu`. DrawBot's `claimedPointerRef` lifecycle is the lifecycle CozyJournal's gesture union member gets by hand. §4.3 records the decision, the two widenings it needed and the four members beside it. `overlay?(session, camera)` was designed here and is **dropped**: the only thing it was for, Sol's `RevealOverlay`, is mounted by the SHELL and is stage 6, and the canvas's real overlay mechanism is the `layerSlot` + handle DrawBot ships — imperative by design, because Sol's §9.2 and DrawBot's §10.3 both forbid React state per frame. What stage 5a did first: the node layer moved with Sol's two components extracted to `web/sol/scene/`, beside the `plantLayer` policy whose DOM they are. |
| Commit pipeline wrapper | DrawBot's `commitPipeline.ts` + `commitWrapper.ts`; Sol's `solEntry` and the index-aligned Sol undo stacks; DrawBot's bots and tiles in the selection; CozyJournal's rig in the colour dispatch, the duplicate and the brush | **Done (stage 3).** `wrapCommit?: CommitWrapper` (`commitPipeline.ts`, DrawBot's file as it was, installed with `setCommitWrapper`) and `session?: SessionHost` (`sessionHost.ts`), three optional members an app fills as it needs: `ops` — a PARALLEL DOCUMENT moved by the same undo step (`EditorSession.hostDoc`, `hostUndoStack` / `hostRedoStack` index-aligned with the engine's, `SessionEntry.hostOps`, an entry of host ops alone pushing an empty engine entry; Sol's `SolOp[]`, DrawBot's `{before, after}` of its sim document); `items` — things the host's document holds that stand in the selection beside scene nodes (`HostItems`: id spelling, box, group, lock, through-a-matrix, remove, duplicate; DrawBot's bots and instruction tiles, which the marquee, the group and every multi builder carry through the adapter); `nodes` — rules about scene nodes of the host's own kind (`HostNodeRules`: a duplicate's companion ops, a node held to its aspect, a colour target off the object, the Color brush's pass over such nodes, the outline label of a tagged node; CozyJournal's rig and seeded squiggle). Installed once per app at module scope (`installSessionHost`), the way the commit wrapper and the brush's glyph-ink probe are, because the session's builders take a state, not a session, and are called from dozens of sites; a builder that moves host items takes the document as a trailing `hostDoc?`, where DrawBot's took `sim?`. `EditorSession<TTool, TDoc, TOps>` carries the app's types through, and every function that returns a session is generic over it. |
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
   with an app-side filtered mode list until stage 3 and 5b bring the brush
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
3. **Done — session and camera** (engine, 2026-10-20). The measurement:
   of the twelve named files, five were already identical in all three
   apps (`groupHit.ts`, `multiTapGesture.ts`, `textCaret.ts`,
   `sceneOcclusion.ts`, `vectorEraser.ts`), three drifted by a comment
   (`transformGestures.ts`, `selectionOutline.ts`, `activeColor.ts`), and
   four carried the apps' features: `editorSession.ts` (CozyJournal's rig
   in the colour dispatch, the duplicate, the aspect rule and the brush's
   commit, its Reimagine squiggle held to its aspect; Sol's parallel
   document on `SessionEntry.solOps` and the two index-aligned stacks;
   DrawBot's sim document, its bots and tiles in the selection and every
   multi builder, its `recordEntry` for a frozen run), `paintBrush.ts`
   (CozyJournal's rig pass), `drawnPose.ts` (CozyJournal's rig canvas;
   Sol's `boxFrame`), `canvasTap.ts` (each app's own tools' taps; DrawBot's
   front item and its locked-run tap), `cameraMath.ts` (Sol's
   `cameraMatrixInto`, DrawBot's `visibleWorldRect` inset) and
   `sliderModeMenu.ts` (CozyJournal's rig modes). Every file moved in
   CozyJournal's version; what the others carried became the second seam
   (§4.1, "Commit pipeline wrapper": `sessionHost.ts` with `ops`, `items`
   and `nodes`, and `commitPipeline.ts`), a `tap` rule on the host-tool
   registry (§4.3), or an app-side module (CozyJournal's rig: its
   `rigDrawnPose`, `rigSliderModes`, `rigPaint` and `rigRules`;
   DrawBot's locked-run tap). Four generic additions from the other two
   apps were adopted into the canonical text rather than dropped, each a
   pure function or an optional parameter CozyJournal's callers never
   see: Sol's `cameraMatrixInto` and `boxFrame`, DrawBot's
   `visibleWorldRect` inset and `frontId` on `selectionOwnsPress`; and
   two of DrawBot's dedupes (the text double tap through the chrome's
   `secondTapWithin`, inclusive at the boundary as the pattern tile's
   already was; `outermostPlainGroupOf` and `expandEach` under the
   selection helpers). One behaviour of Sol's replaced CozyJournal's:
   `buildGroupSelectedMulti` carries a locked member INSIDE a fully
   selected group with its group instead of dropping it, which broke the
   group apart around it (§4.3). Of the 23 identical leaves of §1,
   seventeen closed and moved (`textNodeLayout`, `shapePaintDom`,
   `imageDrawLevels`, `cameraAvoid`, `rowEntryMemo`, `patternToolSwitch`,
   `editorPrefs`, `shapeStrokePreview`, `effectsBoxShadow` with
   `colorUtils`, and the eight components §2 lists); `frameDrop.ts` waits
   on `sceneOutlineModel` (stage 4), `textPaintPreview.tsx` on `NodeLayer`
   (stage 5a, done), `fontStacks.ts`, `homeStateDelivery.ts` and
   `components/EditorNotice.tsx` on the theme, the bridge and the notice
   (stage 6). `patternPatches.ts` and the `planarFaces.ts` it cuts with
   (CozyJournal's `web/content/planarFaces.ts`, a second copy under
   DrawBot's `web/editor/`) moved so `buildPatternMakeColorable` could stay
   where it was. `editorSession` keeps `patternSymmetryEqual` (Sol's
   placement; the two apps' `canvasSymmetry.ts` import it) and
   `copyRunName` with `defaultOutlineName` (the standard half of the apps'
   `outlineNameFor`). The photo placeholder's sentinel id is an app's own
   word, persisted in its pages, so `buildPlacePhotoPlaceholder` takes the
   app's `PhotoPlaceholder`. The brush's glyph-ink probe type
   (`GlyphInkFn`) is the brush's own; each app's `web/fonts/glyphInk.ts`
   implements it. Twenty-five suites travelled (the pure halves of the
   apps' tests for every moved file, their shell and surface pins left
   behind; DrawBot's `commitPipeline` and `planarFaces` suites), and three
   are new: `sessionHost.test` (a made-up app's document, markers and
   badge rules through every seam), the host-tap cases in
   `canvasTap.test` over a made-up registry, and
   `editorSession.shared.test`. This repo gains `react` as a dev
   dependency (the moved `editorPrefs` hook) and a `shims/idb-keyval.ts`
   with a jest mapping (the apps' `__mocks__/idb-keyval.ts`, a fourth
   copy to retire into this one). Editor package 43 suites / 929 tests;
   engine 342 of 343 suites (cameraRoll's host dependency, as before).
   The three apps took it the same day (CozyJournal 9293e119 + b8b6c121,
   Sol 75eed4c + 925e33b, DrawBot — see each app's log), every gate green
   in each, and the migrations found two engine-side loose ends, fixed in
   cc0f118 and taken as pointer bumps: a host's Color pass needs the
   brush's private `sameColor`, `isUnaryMode` and `blendStrength` (now
   exported), and `createEditorSession` inferred the tool literal handed
   in (now `NoInfer<TTool>`; an app still names its three type arguments
   once in a constructor of its own, Sol's `createSolSession`, because
   `TOps` has nothing to infer from). Shipped in the three apps on
   2026-10-20 once the review could fold the move (§5): CozyJournal in two
   rounds (round 1 blocked on comments naming the deleted tap kinds and
   `drawnPose.rigDrawnFrame`, the Figure's `tap` with no test, and the
   grouping rule below with no test in any app's tree — the engine's
   editorSession.test pins it since 11d03fd), Sol in one, DrawBot in two
   (round 1 blocked on a dead duplicate `copyRunName`, the unpinned
   `import './extension'` in EditorHost — a jest setup file installs the
   host for every suite, so losing the import left every suite green —
   and a `withSim` in docs/drawBot.md). What the three reviews left for
   later: Sol's `setCycleCursor` now goes through the engine's
   `withHostDoc`, which reconciles the selection where Sol's `withDoc` did
   not, so a step back or forward with a seed GROUP selected clears it
   (narrow; Sol installs no items adapter and a group id resolves through
   neither findItem nor the frame check — an `items.selectionLive` for
   seed groups, or withHostDoc leaving the selection alone, would settle
   it); Sol's shell commits through the engine's `commitEntry`, so
   `{ entry: [], hostOps: [] }` pushes a vacuous step where `commitSol`
   read an empty array as none (every caller guards today); Sol pins no
   `import './extension'` at its install site the way DrawBot now does;
   both Sol and DrawBot keep single-line `editorSession` imports in some
   forty test files; CozyJournal's canvasTap.test keeps four imports only
   string pins use, and two trimmed suites' headers describe the moved
   cases; DrawBot's docEdit.ts header still says `withSim`; and Sol's
   scripts/__tests__/underwayConfig.test.ts asserts a review for a path
   that no longer exists. Three of those were cleared by stage 4, which
   touched the files they sat in: Sol pins its `import './extension'`
   install site now (`web/sol/doc/__tests__/shellWiring.test.ts`, beside a
   pin that Sol fills none of the OUTLINE seam), Sol's
   `scripts/__tests__/underwayConfig.test.ts` names a path the tree has,
   and DrawBot's `docEdit.ts` header says `withHostDoc`. A fourth was
   cleared by stage 5a, which is the stage that touched those files: the
   two trimmed suites whose headers still described the moved cases —
   5a rewrote every split suite's header in all three apps, over three
   review rounds that were almost entirely about getting them to say
   which half they are (item 5). The rest stand: Sol's `setCycleCursor`
   through `withHostDoc`, the vacuous empty-ops step, the single-line
   `editorSession` imports in some forty test files each in Sol and
   DrawBot, and CozyJournal's `canvasTap.test` imports that only string
   pins use. Left for the owner from the migrations: Sol's `shellWiring` and
   `paintTrimOnDeselect` tests pin lines of the ENGINE's editorSession
   (the stacks' spelling, `trimDeselectedPaint<S`), which an engine
   refactor will break until they move here or read a looser shape; and
   whether Sol should pin `cameraMatrixInto`, which its reveal depends on
   and only the engine's suite now holds (Sol's jest roots exclude it).
4. **Done — outline and properties glue** (engine, 2026-10-20). The
   measurement, of the files this stage names:

   | What | Lines (Cozy) | Sol | DrawBot |
   |---|---|---|---|
   | `web/editor/frameDrop.ts` | 152 | 0 | 6 (an import re-wrap) |
   | `web/editor/__tests__/frameDrop.test.ts` | 273 | 4 | 2 |
   | `web/editor/sceneOutlineModel.ts` | 233 | 117 | 94 |
   | the shell's panel FACTS (its "Render" block) | 336 | 6 | 14 |
   | the shell's panel MODEL (the `ObjectPropertiesPanel` literal) | 359 | 24 | 35 |
   | the shell's model ↔ effect converters (its tail) | 160 | 0 | 0 |
   | the shell's bar HANDLERS (hue row, opacity, stroke, fill, pattern fill, endpoints, transform, text, eyedropper arm, pattern pages) | 1,670 | 62 | 20 |

   The Sol and DrawBot columns are lines that DIFFER against CozyJournal's
   copy, counted as §1's are — every line the diff shows, on either side.

   `frameDrop.ts` and the converters moved verbatim. `sceneOutlineModel.ts`
   moved in CozyJournal's version with two generalizations and the outline
   seam (§4.1): its `slotOutlineNames`, keyed by slot id and read through
   this app's `scaffold.ts`, became `tagLabels`, keyed by the WHOLE
   `prefix:id` tag over the engine's `isTagName` — Sol's spelling, the
   generic one, since the engine cannot know a slot from a seed (§4.3) —
   and a GROUP row goes through `outlineNameFor` like a leaf's (Sol's, so a
   tagged seed group shows its label and never its tag), which is what
   `DEFAULT_KIND_NAME` gains a `group` entry for. CozyJournal's rig glyph
   and its hidden pose record, and DrawBot's bots and instruction tiles,
   are the host's: `OutlineHost.nodes` and `OutlineHost.overlays`.
   `buildGroupNames` stops naming a tagged group (its row's own label is
   what the panel shows, and prefers). `HostNodeRules.outlineName` — added
   at stage 3 in anticipation, installed by no app, and unreachable behind
   `copyRunName`'s own tag check — is gone with it.

   The panel-model builders landed as `panelModel.ts`: `buildPanelFacts`
   (the selection read — what is in hand, which pages its kind may open,
   the values those pages seed their rows from) and `buildPanelModel` (the
   pages laid out in `ObjectPropertiesModel`'s grammar), with
   `editTargetIds`, `effectTargetIds`, `foldTargets`, `svgEnclosesRef` and
   `isRepeatTarget` beside them. The host's pages are its one seam
   (`hostPages` / `hiddenCommonActions`, two fields of `PanelModelInput`,
   handed in where the shell builds the model). Two of the other apps'
   additions were adopted: DrawBot's `onObjectOpacity` guard for a
   multi-selection with nothing to take it, and its host-item lock on the
   Lock button (generic through the session host's `items`, so no app
   branch). Sol's missing `onPatternMakeColorable` was an oversight and is
   dropped. CozyJournal's rig pages stay the chrome's until stage 7: its
   shell spreads them over the built model.

   The bar HANDLERS stay in each app's shell and move with it at stage 6
   (§4.3) — 1,670 lines that are 95 % identical, and every one of them a
   `useCallback` over the shell's own commit pipeline. Two new suites
   (`panelModel.test`, 25 cases over a made-up host; `panelEffectModels
   .test`, 13) and one unioned from the three apps' own
   (`sceneOutlineModel.test`, 29, with the outline seam driven over a
   made-up app's badges and markers); `frameDrop.test` moved whole. Editor
   package 47 suites / 1,015 tests; engine 346 of 347 (cameraRoll's host
   dependency, as before).

   Shipped in the three apps on 2026-10-20 — CozyJournal first, so an
   engine-side finding would be fixed once (none was). CozyJournal passed
   in one round, Sol in one, DrawBot in two; every app then took a round of
   its reviewer's suggestions, and CozyJournal's second round caught a bug
   in one of those FIXES, which is the one thing worth carrying forward:
   its outline host's `null` fast path asked `rigFigureIds`, and
   `findRigs` behind it wants the record AND its figure AND a parseable
   record, so an ORPHANED `poser:pose:<id>` node — figure deleted, or a
   record that will not parse — would have lost its `chrome` and become a
   visible row named from the first 24 characters of its pose JSON. A host
   answering `null` for "none of my kinds here" has to ask about its DATA,
   not about what resolves. What the reviews left for later: the ~20 pins
   per app that now restate this package's `panelModel` internals rather
   than what each shell hands in — the engine's `panelModel.test` covers
   the behaviour and runs in two of the three trees — which is the same
   call the owner already holds for Sol's engine-source pins in item 3; and
   DrawBot's reviewer noticed a second behaviour rider nobody had named,
   that a trail node's `trail:<botId>:<seq0>` tag is a tag by `isTagName`
   too, so an unconsolidated trail's row reads "Drawing" rather than the
   raw tag (pinned there now). Sol's reviewer found one thing for the gate
   itself: `tooling/config.js`'s always-review list still names
   `^web/editor/editorSession\.ts$`, a path no app that has taken stage 3
   still has — harmless, since the pointer entry brings engine changes
   under review anyway, but a dead pattern for whoever next edits the
   gate (an agent does not edit `tooling/` on its own account, §5).
5. **Canvas.** Split in two when the measurement came in (owner,
   2026-10-21). The stage was planned as `CanvasSurface.tsx` and
   `NodeLayer.tsx` moving together with the `layers` extension, CozyJournal's
   rig layer, Sol's plant layer and DrawBot's sim layer becoming host
   layers. What the measurement found is that CozyJournal's canvas — the
   canonical one, so the one that has to move — is the only one of the
   three that cannot: it imports SEVEN modules of its app (six rig modules
   and `@figgie`) and carries 196 rig references in 65 separate clusters
   through its gesture machinery, where Sol's canvas imports ONE
   (`plantLayer`) and DrawBot's TWO (`lockedTap`, `simSession`), both of
   which the `layers` seam and stage 3's tap seam already cover. The rig
   inside the canvas is not a drawing layer and `layers` does not reach
   it: `beginRigPose` is a whole gesture mode with its own hit radius and
   drawn-frame mapping, `previewRigInks` sits in the paint-preview
   dispatch, `restoreRigPoses` in the gesture-restore, and a `rigHandle`
   registry is repainted imperatively per frame. §4.3 assigns the rig to
   stage 7; this forces part of it. The `push` brush rides the same file —
   DrawBot's canvas holds ZERO push references and `pushBrush.ts` is
   imported only by CozyJournal's canvas and its `rigPaint`,
   `rigPushStore` and `RigControlsPanel`, which is why DrawBot cut the
   brush WITH the rig — so item 1 below moves to 5b with it. All three
   canvases also import `@/components/theme`,
   `@/native-shell/bridge/webBridge`, `@/web/hooks/useSuppressIOSLoupe`
   and `@/components/openTrace`, which item 3 and item 6 put at stage 6.

   **5a — Done: the node layer and the canvas's closed leaves** (engine,
   2026-10-21). The measurement, of the files this half names:

   | What | Lines (Cozy) | Sol | DrawBot |
   |---|---|---|---|
   | `components/NodeLayer.tsx` | 1,167 | 161 | 3 |
   | `tileTool.ts` | 1,138 | absent | 0 |
   | `canvasSymmetry.ts` | 649 | absent | 0 |
   | `regionChromeScreen.ts` | 495 | absent | 60 |
   | `symmetryReflect.ts` | 369 | absent | 0 |
   | `symmetryAxesScreen.ts` | 243 | absent | 0 |
   | `symmetryObjects.ts` | 101 | absent | 0 |
   | `textPaintPreview.tsx` | 86 | 0 | 0 |
   | `tapExclusion.ts` | 76 | absent | 0 |
   | `afterReady.ts` | 66 | 2 | 0 |
   | `editableRegion.ts` | 41 | absent | 0 |
   | `web/fonts/fontsEpoch.ts` | 35 | 0 | 0 |

   The Sol and DrawBot columns are lines that DIFFER against CozyJournal's
   copy, counted as §1's are. Six of the eleven leaves are byte-identical
   between CozyJournal and DrawBot and absent from Sol, which gains them
   unused — the arrangement editor-ui already has with CozyJournal's rig
   pages (§4.3, "The rig's place").

   `regionChromeScreen.ts`'s 60 lines of DrawBot drift turned out to be a
   whole feature CozyJournal's copy has none of — the FORWARD ARROW
   (`EditorConfig.forwardArrow`, `ForwardArrow`, `forwardArrowPath`,
   `writeForwardArrow`), the faint screen-space guide saying the top of a
   page leads, which DrawBot's bot look page carries and no other page
   does. It is adopted into the package rather than dropped, by this
   section's own rule in §4.3: it is pure, it is additive (no CozyJournal
   caller can see it), and it reads the module's private `sx`/`sy`, so
   leaving it behind would have meant DrawBot keeping a copy of this
   chrome's camera maths beside the package's. Its two pure describes
   moved with it; WHICH page carries an arrow, and DrawBot's surface
   group for it, stay in that app. Found by DrawBot's typecheck, which is
   the gate that sees a dropped export at all.

   `maskWordScale.ts` and `selectionShapeOutline.ts` are the two that
   looked like leaves and were not: `maskWordScale` imports
   `@/web/formats/scaffold` and `templateNodes`, and
   `selectionShapeOutline` imports `@/web/formats/poserRig`, so both stay
   until stage 6; `openTrace.ts` imports the bridge and stays with it.

   `NodeLayer.tsx` moved in CozyJournal's version with one generic
   addition of Sol's adopted — the optional `children` on `SvgNodeLayer`,
   drawn over the shape inside its matrix wrapper, which no shared caller
   passes — and one new seam, the FONTS. Sol's review found the hole that
   leaves and it is worth stating as a rule: **a generic addition adopted
   from a non-canonical copy is pinned HERE, not in the app that passes
   it.** Sol pinned that its `SeedMarkLayer` passes children; nothing
   pinned that the package still renders them, so deleting the `{children}`
   JSX — the obvious tidy for whoever next reads a prop no shared caller
   passes — left every suite in all four repos green while every seed
   marker silently lost its strain initial. An app-side pin cannot fail the
   run of the repo doing the deleting, and the prop's TYPE surviving is not
   the render surviving. `__tests__/nodeLayer.test.ts` holds it now
   (verified by deleting the line), and it is where 5b's `layers` pins go.
   The node layer was the last mover to import `@/web/fonts/*`:
   `fontsEpoch.ts` is identical in all three apps and moved whole, and
   `fontFamilyFor` became a PROBE the app installs, the way the brush's
   glyph-ink probe already is and from the same file
   (`web/fonts/loadPackFonts.ts`). `fontFamily.ts` holds the
   fallback (`SYSTEM_STACK`) and the registry; the resolver itself — the
   pack lookup, the quoting, and the rule that `'system'` and the empty id
   are the bare stack — stays whole in each app's
   `web/fonts/registerFonts.ts`, which builds it from that app's fonts
   pack. The line was drawn there rather than at "rule here, data there"
   because a pack is not a table the package can read: `registerFonts`
   parses it, keys it by `fontId`, and answers for ids it has never heard
   of, and splitting that would have put half of one function in each
   repo. With nothing installed the answer is the system stack, which is
   what an app shows before its faces load. `registerFonts` imports
   `SYSTEM_STACK` from the package, so the two cannot disagree about what
   a text node looks like before the pack arrives.

   What moved with them: eight suites split the way stages 3 and 4 split
   theirs, the behaviour half to the package and the CANVAS and SHELL pins
   left behind in the app — `tileTool` (twelve describes / 71 cases to the
   package, ten / 31 kept), `canvasSymmetry` (nine / 40 to the package,
   three / 26 kept), `symmetryReflect` (24), `symmetryAxesScreen` (15,
   which pinned nothing app-side and moved whole), `symmetryObjects` (7),
   `tapExclusion` (10),
   `afterReady` (7) and `editableRegion` (5), plus `textPaintPreview`'s
   (6, its two canvas cases kept). The union the owner called for added
   nothing: of the cases DrawBot's copies hold that CozyJournal's do not,
   every one is either that app's own wording of a canvas pin or a rule
   stage 3 already pinned in the package — `patternSymmetryEqual` by value
   in `editorSession.shared.test`, the editing text's dismissal tap in
   `canvasTap.test`. One case of CozyJournal's went back to the app
   because the package cannot hold it: `canvasSymmetry`'s "a known tool id
   the unrestricted bar no longer carries" reads `KNOWN_TOOLS` and
   `TOOL_META`, which are each app's.
   A NodeLayer or regionChromeScreen pin inside a suite about the APP's own
   wiring was re-pointed at the vendor path rather than moved — eleven
   suites in CozyJournal, nine in DrawBot, eight in Sol — which is what
   stage 4's `panelModel` pins already do (§4.3's open call covers both).
   Where the describe was MIXED at the case level — a pure reading of the
   package's own function beside a pin of the shell that reaches it — the
   split is per case, which is what the first two review rounds were spent
   finding: a describe named for a shell behaviour can still hold the only
   coverage a package function has, and a header that says otherwise is an
   invitation to delete it. Twenty-eight of those cases moved across the
   three review rounds: `canvasSymmetry`'s frame and axis maths (eleven),
   `tileTool`'s grid readings (fourteen) and its region-drag maths (three).
   What is still only covered app-side, measured after round 2 and left for
   5b, is a short list of DOM writers and the constants they read:
   `regionChromeScreen`'s `writeRegionChrome`, `markerKey`,
   `flagRefusedMarkers` and `boardOutlineRect` (in CozyJournal's
   `regionMarkerPop.test`), `symmetryAxesScreen`'s `axisGroupOf`,
   `symmetryObjects`' `mirroredSegments` and `mirroredSVGCopy`,
   `textPaintPreview`'s three preview functions, and `tileTool`'s
   `tapLandsOnPatternGrid`, `isShapePatternFillGrid` and
   `tileCellWithinGrowReach`. Each is reachable only through a canvas that
   has not moved yet, so their cases move when it does. Two duplications
   come with them and are worth doing in the same pass, both named by
   CozyJournal's reviewer: the fake-SVG `FakeEl` fixture, which the
   package's new `forwardArrow.test` and CozyJournal's `regionMarkerPop`
   each carry for writers in the SAME module, and which belongs in
   `packages/editor/src/__tests__/test-utils.ts` once the second one is
   here; and `fontFamily.ts`'s `SYSTEM_STACK`, which is the engine's
   `FALLBACK_FAMILY_STACK` (`compositionSVGCore.ts`, whose comment already
   says it mirrors the node layer's stack) differing only in `'` against
   `&apos;`. Their agreement is load-bearing — a text node has to look the
   same in the DOM preview and the SVG export — and 5a is the first time
   both live in one repo, so deriving one from the other (the editor may
   import the engine) would make the drift impossible — so both were taken
   in 5a after all, once a review pointed out that the shared homes already
   existed: `SYSTEM_STACK` is now the engine's `SYSTEM_FAMILY_STACK`
   (`fontWeight.ts`, beside the weight map, which exists for exactly this
   reason — one spelling for every text renderer), from which the SVG
   export derives its XML-quoted form; and `FakeEl` is one fixture in
   `packages/editor/src/__tests__/test-utils.ts`, used by this package's
   `forwardArrow.test` and by each app's `regionMarkerPop`.

   `fontsEpoch.test.ts` was identical in all three apps and moved whole,
   and `fontFamily.test.ts` is new, over the seam with no pack installed,
   with one, and after one is taken away. Editor package 60 suites / 1,201
   tests; engine 359 of 360 (cameraRoll's host dependency, as before).
   (The sixtieth is `nodeLayer.test.ts`, added after 5a shipped in two of
   the three apps, when Sol's review found the `children` seam unpinned.)
   `NodeLayer.tsx` itself is typechecked only in the apps, as every
   component in this package already is — no engine suite imports one, the
   engine having no renderer — so what the package pins of it is its source
   text. This repo gains `react-dom` and
   `@types/react-dom` as dev dependencies (the moved `textPaintPreview`
   renders through `createRoot` and `flushSync`), the way stage 3 gained
   `react`. Two dead imports fell out on the way, both caught by this
   repo's stricter `noUnusedLocals` and neither visible in the apps, whose
   tsconfig extends Expo's: an unused `React` in `textPaintPreview.tsx`
   and an unused `drawnLocalBox` in `NodeLayer.tsx`.

   **5b — In progress: the canvas.** `CanvasSurface.tsx` with `layers.nodeLayer`
   and the CANVAS HOOKS. The seam for the rig's canvas BEHAVIOUR — a
   press-claim (`beginRigPose`), a paint-preview pass (`previewRigInks`), a
   gesture-restore (`restoreRigPoses`), the push stroke's rig targets, the
   live-handle registry and the drawn-frame mapping — was named here as the
   thing to design before writing code. **It did not need designing:
   DrawBot already ships it** (`canvasHooks.ts`, `GestureHooks` and
   `CanvasSurfaceHandle`), and the owner settled on adopting it whole on
   2026-10-22. §4.3's "the canvas seam is DrawBot's, adopted whole" has the
   mapping, the two widenings and the four members beside it; §4.1's row is
   rewritten; `overlay?(session, camera)` is dropped rather than added.
   Not alongside stage 7: the canvas imports none of the rig's pages, so
   that stage would reduce this seam by nothing. Before stage 6. The three
   §4.3 items this stage was to settle — DrawBot regaining `push`, `pixelHitTestAt`, and
   the shell's last host-place branch — are decided there now and
   implemented here, since all three live inside the file.

   Measured for it, 2026-10-22: **166 suites read `CanvasSurface` source
   text** (63 Cozy, 45 Sol, 58 DrawBot) and **46 basenames exist in all
   three apps**, so that much is one move plus two deletions and folds.
   The canvas is 7,104 lines in CozyJournal against Sol's 5,942 and
   DrawBot's 6,774. The weave is lopsided and in the helpful direction:
   Sol's canvas holds 16 host references (its two plant layers, their
   `seedMarks` data, two `snapPoint` calls), DrawBot's about 33 of seam
   machinery it already owns, and CozyJournal's 208 in 43 clusters.
   `pushBrush.ts` is 347 lines of which ~68 are rig, splitting along a line
   its own types already draw (`PushSvgTarget` generic,
   `PushRigTarget` the host's) — and the generic half is what gives
   DrawBot the brush back.

   Cut in four, so that "does the seam cover the rig?" and "did the move
   break something?" are answered separately rather than together across
   7,104 lines: **5b.1** the seam alone, in the engine; **5b.2**
   CozyJournal's rig refactored out of its canvas IN PLACE against that
   seam, with no move in flight; **5b.3** the seamed `CanvasSurface.tsx`
   moved, `pushBrush.ts` split, and the app-side-only cases above brought
   over; **5b.4** each app takes it, CozyJournal first (it also owes the
   pointer bump it missed, having shipped 5a before three later engine
   commits landed).

   **5b.1 — Done: the seam** (engine, 2026-10-22).
   `packages/editor/src/components/canvasHooks.ts` is DrawBot's 56 lines
   adopted at the same path, with the two widenings §4.3 names, and three
   seams beside them: `CanvasLayers` (`nodeLayer`, whose three answers are
   the contract — `undefined` for a node that is none of the host's, an
   element to draw instead, `null` for the host's own node that draws
   nothing here), `CanvasRecords` (`has`, the one predicate the paint
   veil and `resolveCanvasTap`'s `selectionIsMode` read) and `CanvasTwist`
   (`loneUnit`, `grip`, and `node(state, id)` resolving a `HostNodeTwist`
   — its start angle, its live drive, its reset and its entry — ONCE at
   the press, so the four things the canvas does differently for a host's
   node are one object rather than four optional calls, and "is this one of
   mine?" is asked once of the host's own data). One member of the shipped
   seam §4.3 did not name came with it: DrawBot's `beforePick(x, y)`, the
   pick that runs BEFORE the scene is hit-tested so a tap on a bot does not
   reach the shape under it, which it passes as a prop beside
   `GestureHooks` and declares on its own `BotGestures extends
   GestureHooks`. It is a question the surface asks the host while deciding
   a press, which is what that interface is, so it is a member of it here
   and one prop fewer on the canvas. A third WIDENING came out of 5b.2
   and is recorded in §4.3: `claimAt`, because the two apps' claims sit
   at different points in the press router. `HostPaintTargets` (stage 3's)
   grows `preview` / `restore`, the live channel a node whose colour is not
   ON the object needs: the canvas's own preview is an overlay laid over the
   object, and a rig's silhouette is a bake its live sketch draws over, so
   it is told what colour it is now the way a joint drag tells it what pose
   it is in. `canvasTwist.ts`'s
   `resolveTwistUnit` is the one reading of what a finger pair would turn:
   the multi unit, the host's lone unit, its grown grip, and the box the
   turn still pivots about — both apps had written that gate out by hand
   and two of the three had grown a host rider on it. `EditorExtension`
   gains `canvas?: CanvasHost` for the two installed RULES; the hooks and
   `layers` are props (§4.1's row). Editor package 61 suites / 1,226
   tests after 5b.2's additions to the seam; engine 360 of 361
   (`cameraRoll`'s host dependency, as before).
   The new suite is a made-up app with a DIAL (a scene node with a hidden
   record holding its needle's angle) and a PEG (a document's own thing
   that twists as a unit of one), the way `sessionHost.test` and
   `panelModel.test` are; every member of the adopted interfaces is USED
   in it, so deleting one fails the suite's compile rather than passing
   silently, and the two widenings are pinned as source text — the only
   tool for a declaration this repo does not run — each naming the
   simplification that would undo it.

   **5b.2 — Done: the rig out of CozyJournal's canvas, in place**
   (CozyJournal, 2026-10-22), in four commits and with no move in flight,
   so that "does the seam cover the rig?" was answered before "did the move
   break something?" ever came up. It covers it: the canvas holds **no rig
   reference at all** now except the push stroke's state, which goes with
   `pushBrush.ts`'s split at 5b.3.

   The four clusters and where each went. The TWO-FINGER TWIST goes to
   `web/editor/rigCanvasHost.ts`, the installed `CanvasHost`: the canvas
   resolves `twist.node(state, id)` once at the press and the four things
   it then does differently — the start angle, the live drive, the reset,
   the entry — ride on that one object. The JOINT POSING goes to
   `rigGestures.ts`, as a claim: what was a gesture-union member woven
   through forty-odd branches is `createRigGestures(deps)` with the grab in
   flight as its own state, and what the canvas gained instead is DrawBot's
   claim lifecycle. The NODE LAYER goes to `rigLayers.tsx`, through the
   `layers` prop. The BRUSHES' live halves go to the host passes they
   belong to: the Color brush's through `HostPaintTargets.preview` /
   `restore` in `rigPaint.ts`, the push brush's in `rigPush.ts`.
   Two duplications fell out on the way: the Turn slider in
   `RigControlsPanel` was a second copy of "find the stage element, write
   `rigCanvasTransform`", and both go through `previewRigRoll` now, beside
   `previewRigColor`; and `resetRigCanvas` is gone with it.

   Two FURTHER widenings the stage needed, both recorded in §4.3 and
   neither foreseen by the mapping: `claimAt`, because the two apps' claims
   sit at different points in the press router and neither can move to the
   other's; and `onPointerUp` losing its React event, because the surface
   has none to give for a stale-pointer heal (where DrawBot's canvas leaves
   a claim live, a bug the merged canvas fixes) and neither app's hook ever
   read it. With `beforePick` that is FOUR changes to a seam adopted
   "whole", which is worth saying plainly: the interface was right, its
   signatures were not quite.

   What the suites gained is the point of the exercise.
   `rigGestures.test` DRIVES the hooks — press, move, each of the three
   endings — over a poser page with a real viewport, where every rule the
   gesture union held could only ever be pinned as source text, because it
   was reachable solely through a 7,000-line component.
   `rigCanvasHost.test` does the same for the records predicate and the
   twist. Nineteen source pins across nine of this app's suites were
   re-pointed at the module that now holds what they name. CozyJournal:
   639 suites / 10,538 tests.

   **Measured for 5b.3 while 5b.2 was in hand**: the canvas's remaining
   app-side imports are nine, and three of them are the ones this item's 5a
   note parked at stage 6 — which, since the canvas imports them, would
   park the MOVE at stage 6 too. Each turns out smaller than that.
   `selectionShapeOutline.ts` differs from Sol's and DrawBot's copies by
   exactly TWO lines, and both are the rig check
   `isRigFigure(state, id) -> return null`, which IS `CanvasRecords.has` —
   the seam 5b.2 just built — so it moves whole.
   `creatureGeometry`'s `magnetToLines`, `lineGridPoints` and
   `midlineGridPoints` are pure geometry over `(gridLevel, ys)` with
   nothing of the format in them, so those three leaves move and the rest
   of the file stays. `maskWordScale` is the one that genuinely imports the
   app (`templateNodes`, `scaffold`), and what the canvas wants of it is a
   scale factor for a node under a drag — a `HostNodeRules` shape (stage
   3's seam) rather than a new one. The other six are 5b.3's own:
   `rigTurnLive` and `rigPushStore` (generic stores carrying rig names),
   `pushBrush` (the split), `rigPush`, `hostTools` (the registry reaches
   the canvas as a prop or through the extension, as `canvasTap` already
   takes it as a parameter) and the open trace's two probes.
   `useSuppressIOSLoupe` is byte-identical in all three apps and imports
   only the package and the shell — a closed leaf that moves with the
   canvas — and `@/components/theme`'s two constants (`BG_EDITOR_CANVAS`,
   `HAIRLINE`) are identical in all three, which
   `packages/editor-ui/src/theme.ts` is the precedent for.
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
  the canvas and session are unified on CozyJournal's code (stage 3 and 5b)
  — it reaches ten files of the drifted core and is not ported by hand
  before that. Stage 3 found the first two already settled: `groupHit.ts`
  and `multiTapGesture.ts` were identical in all three apps when measured
  (the landing window had already reached Sol and DrawBot), and DrawBot's
  pixels-only hit is not the selection's walk at all but a second,
  separate pick in its `CanvasSurface.tsx` (`pixelHitTestAt`, for its
  placing tools building in a group's empty box) beside the shared
  `hitTestAt` every app has — a stage-5b matter, and the sentence in the
  old item 3 preferring DrawBot's rule is superseded by this one. The
  `push` brush is back in the moved files (`PaintToolKind`,
  `brushDimsToSelection`, `toolYieldsToSelection`, the paint slider's
  Brushes option); DrawBot keeps it off its bar with its app-side mode
  list until stage 5b gives its canvas the brush (and the reason it is 5b
  and not 5a is below).
- **Generic additions from a non-canonical copy are adopted, not dropped,
  when they are pure and CozyJournal's callers cannot see them** (stage 3,
  2026-10-20): a new pure function (Sol's `cameraMatrixInto`, `boxFrame`),
  an optional trailing parameter with its old behaviour as the default
  (DrawBot's `visibleWorldRect` inset, `selectionOwnsPress`'s `frontId`),
  a dedupe onto something the engine already had (DrawBot's
  `secondTapWithin`). Dropping them would have made Sol and DrawBot keep
  copies of engine-adjacent maths beside the engine's, which is the drift
  the plan exists to end. The one adopted change of behaviour is Sol's
  rule in `buildGroupSelectedMulti`: a locked member inside a fully
  selected group goes with its group (CozyJournal's rule lifted the
  unlocked members out around it, a bug no CozyJournal page had hit
  because none locks a member inside a group); a group whose own chain is
  locked still sits out. The owner can reverse any of these in one place.
- **The session host is installed once at module scope, not threaded**
  (stage 3, 2026-10-20): `installSessionHost(extension.session)` from the
  app's `web/editor/extension.ts`, the way DrawBot's commit wrapper and
  the brush's glyph-ink probe already install themselves. The session's
  builders are pure over a `CompositionState` and are called from dozens
  of sites in each shell (`buildApplyColor` alone from thirty-six in
  CozyJournal); a `host` parameter at every one would have been the churn
  without the seam, and at stage 6 the package's shell installs the
  extension the same way. The one thing threaded is the host DOCUMENT —
  per-session data, not a rule — as the trailing `hostDoc?` of the builders
  that move host items, where DrawBot's already took `sim?`. A test
  installs a host and clears it after.
- **`canvasTap.ts`: the registry's `HostTool` grows a `tap` rule rather
  than the shell keeping the branch** (stage 3, 2026-10-20). The three
  apps' five placing tools had three shapes of tap between them, not five
  — `'anywhere'` (CozyJournal's Word, Sol's Plant: every tap places, and a
  press on the selection places too), `'onEmpty'` (CozyJournal's Figure: a
  hit selects, empty canvas places) and `'against'` (the Pattern tile in
  two apps: places against what is there, into the one target open for it,
  and clears when nothing joins) — and `toolYieldsToSelection` keyed on the
  same tools. Both read the registry now; `resolveCanvasTap` answers
  `{ kind: 'hostPlace', tool }` and the shell dispatches on the id to its
  own builder, which is the only branch it keeps until stage 5b. DrawBot's
  Inklings register no `tap`: its sim layer's gesture hooks claim the
  press before the tap is read. The `'against'` facts the shell knows
  (`openTarget`, `joins`) ride a trailing options object under those
  names. A selection that is a MODE (CozyJournal's rig) stays a boolean
  parameter, `selectionIsMode`.
- **A tag is any `prefix:id` name, and its LABELS ride as data** (stage 4,
  2026-10-20). Two decisions in one. What counts as a functional tag is the
  engine's own rule, `isTagName` — already what `duplicateName` and
  `copyRunName` go by in all three apps — rather than each app's own
  prefixes, so the outline agrees with the duplicate about what a name is.
  The one visible consequence: in CozyJournal a node the USER renames to
  something tag-shaped ("todo: fix") now shows its kind's word in the
  outline instead of that name, where before only `slot:` and `decor:` were
  read as tags. Narrow, and the alternative was for the package to know
  CozyJournal's scaffold. And the LABELS a tag maps to stayed a parameter
  (`tagLabels`, keyed by the whole tag) rather than becoming a member of
  the installed `outline` host, because they are per-format or
  per-document DATA, not a rule: CozyJournal's and DrawBot's come from the
  `EditorConfig` the page was opened with (which the package does not know
  until stage 6) and Sol's from its own document and the scene graph. The
  host DOCUMENT rides the same way (`hostDoc`, stage 3), for the same
  reason.

- **The panel-model builders are the MODEL, not the handlers** (stage 4,
  2026-10-20). `panelModel.ts` holds what the panel's model is a pure
  function of — the selection read (`buildPanelFacts`) and the pages laid
  out over it (`buildPanelModel`) — and the bar HANDLERS stay in each
  app's shell until stage 6 moves the shell itself. They are 1,670
  near-identical lines and it is tempting to take them now, but every one
  is a `useCallback` closing over the shell's commit pipeline, its tool and
  prefs state, its pickers and its page flags: moving them would mean
  inventing a context object of some fifty members and threading it
  through, and stage 6 would delete that context when the shell arrives.
  That is the churn without the seam — the argument this section already
  makes for installing the session host rather than threading it. What the
  move does buy now is the end of the drift in the two places it actually
  bit: the facts (where a kind's pages are decided) and the model (where
  they are laid out), which is also where all of this stage's
  app-by-app differences were.

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

- **The three canvas questions, settled 2026-10-21 (stage 5a), to be
  implemented at 5b.** All three live inside `CanvasSurface.tsx`, which 5a
  did not move (§4.2 item 5), so each is a decision on record rather than
  code.

  **`pixelHitTestAt` generalizes; it does not become host-side.** DrawBot's
  second pick is seven lines, and it differs from the shared `hitTestAt`
  only in asking `findSceneObjectAtCell(…, { pixelsOnly: true })` where the
  selection's walk asks `findSelectableAtCell`; both then refuse a frame
  boundary. It is reachable from outside in exactly one place, the surface
  handle's `pixelHitAt`, which DrawBot's sim layer calls to place a tool
  inside a group's empty box. So the package's canvas keeps both picks and
  always exposes `pixelHitAt` — a pure addition no CozyJournal caller can
  see, which is this section's own rule for a generic addition from a
  non-canonical copy, and nothing for a host to install. Host-side was the
  alternative and is worse: the walk it shares with `hitTestAt` is the
  engine's scene reading, and a host implementing it would be a second copy
  of the hit test beside the package's, which is the drift the plan exists
  to end.

  **The last host-place branch RELOCATES; it does not disappear.** The three
  shells' `hostPlace` arms differ in only two riders — Sol snaps the cell
  through `snapPoint`, and CozyJournal's tile and DrawBot's tile refuse a
  tap within reach of the floating chrome (`overlayNearTap`) — so both
  become declared flags on the tool's registry row beside its `tap` rule,
  the package's canvas computes the cell and applies them, and it calls one
  `onHostPlace(tool, cellX, cellY)`. Each app's shell then keeps a switch
  from its own tool ids to its own builders (`onAddRig`, `onAddWord`,
  `onAddTile`, `onPlantSeed`). The branch leaves the CANVAS, which is what
  is moving; it cannot leave the app, because the builders are the app's
  and so is the shell until stage 6, which makes it an extension member.
  The earlier sentence calling this "the only branch it keeps until stage
  5" was too strong: stage 5 moves it one layer out, stage 6 removes it.

  **DrawBot regains `push` at 5b, with the rig's canvas seam.** The brush
  is in the moved files already, and the plan read the app-side
  `DRAWBOT_PAINT_MODES` filter as the only thing holding it off the bar —
  one line in `hostTools.ts`, one use in the shell, three assertions. It is
  not: DrawBot's canvas holds no push gesture at all (zero references), and
  `pushBrush.ts` is imported only by CozyJournal's canvas and its
  `rigPaint`, `rigPushStore` and `RigControlsPanel`. The brush pushes a
  rig's joints, which is why DrawBot cut it with the rig and why it comes
  back with the rig's seam, not before.

- **The canvas seam is DrawBot's, adopted whole (stage 5b, settled by the
  owner 2026-10-22).** Stage 5a left "a seam for the rig's canvas
  BEHAVIOUR" as the thing to design before writing code, and guessed at six
  or seven members over per-render refs and imperative handles. It did not
  need designing. **DrawBot already ships it**, in
  `web/editor/components/canvasHooks.ts` — 56 lines that CozyJournal and
  Sol have no copy of:

  - `GestureHooks` — `onPointerDown(x, y, e) => boolean`, a CLAIM: a press
    a hook claims is the hook's for its whole life, and the surface runs
    none of its own machinery for that pointer. With `onPointerMove`,
    `onPointerUp(…, cancelled, …)`, `holdOpensMenu()` and
    `previewSelectionEntry(se)`.
  - `CanvasSurfaceHandle` — `getLiveCamera`, `getViewport`, `pixelHitAt?`
    and `layerSlot`, the screen-space element a layer mounts into.

  CozyJournal's rig maps onto it member for member: `beginRigPose` IS
  `onPointerDown` returning true; the `case 'rigPose'` of the move switch
  IS `onPointerMove`; `finishRigPose(g, cancelled)` IS `onPointerUp`; and
  `armLongPress(pt, () => finishRigPose(posing, true))` — the hold that
  abandons a pose grab so a rig is not the one object whose radial menu
  cannot be opened — IS `holdOpensMenu`, whose comment in DrawBot describes
  that behaviour in its own words. DrawBot's `claimedPointerRef` lifecycle
  (down, move, up, two-finger takeover) is the lifecycle CozyJournal's
  gesture union gets by hand across 43 clusters. It also settles the first
  canvas question above almost for free: "always exposes `pixelHitAt`" is
  dropping one `?`.

  **This reverses the usual direction, and the rule needs saying: the
  canonical-copy rule governs a file's CONTENTS, not a seam's DESIGN.**
  Everywhere else in this plan CozyJournal is canonical and the others
  adopt. Here CozyJournal is the app that pays and DrawBot the one that
  already built the interface — because the seam is a thing DrawBot was
  forced to invent when its sim layer needed presses, and CozyJournal
  never was. §4.3's existing rule (a generic addition from a non-canonical
  copy is adopted when it is pure and CozyJournal's callers cannot see it)
  covers it; this is the largest instance of that rule in the plan, and
  the first stage where the two rules point different ways.

  Two widenings, both of which SHRINK the canvas rather than grow it:
  `onPointerUp`'s `cancelled: boolean` becomes a three-state end reason
  (`release` / `takeover` / `cancel`), because DrawBot discards a claimed
  press when a second finger arrives and the rig commits a pose that moved
  — only the host knows how to settle a takeover; and `prevSelection`
  moves onto the claim, since a claimed press can select (DrawBot's bot
  drag and the rig's joint grab both do) and the canvas today carries that
  bookkeeping in three separate branches.

  A THIRD widening the mapping above passed over, found while writing the
  rig's hooks (5b.2): **the two claims do not sit in the same place in the
  press router, and neither can move to the other's.** DrawBot asks its
  hooks FIRST, before the surface reads anything else about the press —
  ahead of the input lock, the done-page gate, the caret and every tool —
  because its bots are armed by their own tool and the claim has to beat
  the running simulation's lock. CozyJournal's `beginRigPose` sits inside
  the SELECT tool, after the shift-click, the corner-handle grabs and the
  multi-selection box, and before the scene is hit-tested: a rig's joint
  grab is a grab on an object like any other, and offered the press first
  it would swallow a brush stroke, a shift-click, and the corner handles
  of the very figure it belongs to. So `GestureHooks` carries
  `claimAt?: 'press' | 'grab'`, defaulting to `'press'` — DrawBot's, the
  shipped behaviour — and the surface offers the claim at both points.

  A FOURTH, which only subtracts: `onPointerUp` drops the React event.
  The surface has none to give where it most needs to end a claim — a
  stale-pointer heal, a page backgrounded mid-touch (DrawBot's own
  `cancelStaleGesture` leaves a claim live, which is a bug the merged
  canvas fixes), a hold that handed the touch to the radial menu — and
  neither app's hook reads one: DrawBot's implementation already drops the
  parameter its own interface declares.

  Four members beside the hooks, and only ONE of them is the rig's alone:
  the host's per-node records, reached as predicates rather than a map
  (the twist's start angle, the paint veil's "a rig is a mode, not a
  selection", `resolveCanvasTap`'s `selectionIsMode`); the TWO-FINGER
  TWIST, which `GestureHooks` deliberately withholds and which **two apps
  need independently** — a rig rolls the figure inside its viewport
  instead of turning the box, and DrawBot's `turnableBot` /
  `botTwistBox` decide whether a selection twists at all and how big its
  grip is; the paint-preview passes, which are not a new seam at all
  because `rigPaint.ts` already implements stage 3's `HostPaintTargets`;
  and `layers.nodeLayer`.

  Where each of the four is WIRED follows the line this section already
  draws and needed no new call (5b.1): an installed RULE goes on the
  `EditorExtension`, per-render DATA rides as a prop, which is why the
  panel's host pages are two fields of `PanelModelInput`. So `records` and
  `twist` are `EditorExtension.canvas`, installed once at module scope
  beside the session and outline hosts; `GestureHooks` and `layers` are
  props of `CanvasSurface`, because both close over state only the shell
  holds — DrawBot's `useSimEditor()` builds its hooks, and Sol's plant
  layer needs that render's plan, its composites and their raster
  oversample. DrawBot's `extraGestures` prop is that prop already.

  One shape the implementation settled (5b.1), where §4.3 had left the
  members loose: a host node's twist resolves ONCE, at the press
  (`CanvasTwist.node(state, id)` answering a `HostNodeTwist` — start
  angle, live drive, reset, entry), rather than standing as four optional
  calls the canvas makes separately. It is the same shape as the outline
  host's reader, for the same reason, and it makes "is this one of mine?"
  a question asked once of the host's own DATA — which is the finding 5a
  paid three rounds for.

  What this does NOT need: stage 7 first. The canvas imports none of the
  rig's pages (`rigEdit`, `RigJointsBar`, `RigPoseBar`, `RigColorBar`,
  `showRigOptions`), so moving them first reduces this seam by nothing.
  The two stages are orthogonal and 5b goes first.

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

**Stage 3 made it necessary** (2026-10-20). `npm run ship` in CozyJournal
ended at exit 4: the reviewer refused a 3,293 KB prompt ("Prompt is too
long") — about 850 k tokens, where the model has 200 k. The range was two
commits: the app's own diff (1.48 MB: twenty-six thousand lines deleted,
the moved files and their tests) and the engine's appended diff for the
pointer move (1.84 MB: the same files added under `packages/editor/src/`,
plus 478 KB of the engine's `package-lock.json`, which the appended diff
does not leave out although the project's own lockfile is). Neither half
fits alone, so splitting the range does not help, and Sol's and DrawBot's
ranges have the same shape. The prompt is almost entirely text the
reviewer has already passed once: a file the engine adds is, byte for byte
or nearly, a file the same range deletes from the app. Two changes to
`review.js` make such a range reviewable and the review truer, and the
owner called for them the same day (an agent never edits the gate's own
files on its own account, `CLAUDE.shared.md`): a MOVE — a file the
appended engine diff adds that pairs with a file the project's diff
deletes, by content, else by name and the longest shared path tail — is
shown once, as the delta from the deleted file to the engine's with one
line of context and removals collapsed, the way `copySources` already
shows a changed copy, and listed when byte-identical (`classifyMoves`,
`engineMoves`; `gates.md` "Moves"); and the engine's lockfile is left out
of the appended diff as the project's is. What is hashed is still the full
diff, so no record's key moved. With it the three ranges shipped the same
day: CozyJournal's prompt 3,293 → 516 KB, Sol's 859 KB and DrawBot's
890 KB (each about forty-five files folded, a dozen of them kept and
trimmed), the two larger ones within reach of the limit but inside it.
Stages 5 and 6 (CanvasSurface, EditorShell: 7,000 and 10,000 lines) have
the same shape and ride the same rule; if one of their ranges is still
too long, the next step is the one above — a pointer bump whose engine
range is already reviewed treated as cleared.

**Stage 4 shipped well inside it** (2026-10-20): CozyJournal's prompt
278 KB, Sol's 294, DrawBot's 300 — about a third of stage 3's, with the
same shape of range (a file deleted here, the same file added under
`packages/editor/src` there) and the same number of commits. The move
folding is what makes the difference; stage 4 moved less raw text than
stage 3 did, which is the rest of it. Each app's follow-up commits — a
round of its reviewer's suggestions — reviewed at 22 to 45 KB, and
CozyJournal's last one (9 changed lines) fell under `review.js`'s own
30-line floor and needed no review at all.

**Stage 5a was never near it** (2026-10-21): CozyJournal's prompt 128 KB,
DrawBot's 122, Sol's 362. The prompt size was the risk named before the
stage started — 209 suites across the three apps read `CanvasSurface` or
`NodeLayer` source text, app-side churn the move folding cannot collapse —
and measuring it first is what showed the risk was not real. Two reasons.
The pin churn is small: a mechanical re-point of CozyJournal's 73 suites
measured 62 files, 92 lines, 67 KB, against the 890 KB a stage-3 range
passed at. And the right answer turned out to shrink it rather than pay
it: a suite dedicated to a moved file MOVES, which folds, and 48 of the
209 exist in all three apps under the same name, so what looked like three
apps' churn is one app's move and two deletions. Of the 209, 5a touched 84
— the ones reading a file it moved. The 190 that read `CanvasSurface` are
5b's. Sol's range is the largest of the three because its node-layer drift
folds as a changed move and `plantNodeLayers.tsx` pairs with nothing (it is
a new file in Sol's own tree, not a move into the engine), and because its
two codebase documents carry very long table lines.

**Stage 5b.1 and 5b.2 are nowhere near it either** (2026-10-22):
CozyJournal's range after the whole rig refactor — the pointer bump, the
twist, the joint posing and the layer — measured 233 KB, against the 890 KB
a stage-3 range passed at. The risk named for 5b was never the refactor
but the MOVE: 166 suites read `CanvasSurface` source text, and the move's
own 7,104 lines fold only if `review.js` pairs the file the engine adds
with the file the app deletes.

So the next process step — a pointer bump whose engine range is already
reviewed treated as cleared — is still not forced, and stage 5a did not
touch `tooling/`. Stage 5b (`CanvasSurface`, 7,104 lines, and the 190 pins)
and stage 6 (`EditorShell`, 10,682) are where it may be.

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
