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
the work below. Source files only — `__tests__` and `__mocks__` are left
out, which is what makes the file counts reproducible:

| Tree | Files | In all three | Identical in all three | Lines (Sol / DrawBot / Cozy) |
|---|---|---|---|---|
| `web/editor/` (incl. `components/`) | 193 | 112 | 57 | 43 k / 55 k / 61 k |
| `web/editorUi/` (DrawBot's fork of editor-ui) | 59 | — | — | — / 14.8 k / — |
| `web/formats/` | 53 | 7 | 1 | 1.2 k / 4.0 k / 16.8 k |
| `web/store/` | 14 | 8 | 1 | 1.1 k / 1.7 k / 3.6 k |
| `web/fonts/` | 8 | 8 | 5 | 0.7 k each |

And the same trees NOW (re-measured 2026-10-23, at the start of stage 6
and again after 6.1), so the table above stays the baseline it says it is
rather than being overwritten:

| Tree | Files | In all three | Identical in all three | Lines (Sol / DrawBot / Cozy) |
|---|---|---|---|---|
| `web/editor/` (incl. `components/`) | 111 | 38 | 4 | 12.2 k / 17.9 k / 25.9 k |
| `web/editorUi/` | — | — | — | retired at stage 1 |
| `web/formats/` | 53 | 7 | 1 | 1.2 k / 3.9 k / 16.8 k |
| `web/store/` | 14 | 8 | 1 | 1.1 k / 1.7 k / 3.6 k |
| `web/fonts/` | 5 | 4 | 0 | 181 / 230 / 203 |

Four rows' worth of reading, and the fourth is the one that matters for
this stage. `web/editor/` has lost 82 of its 193 files and two thirds of
its lines — stages 1 to 5 — and what is LEFT is the drifted part: only 4
of the 111 files are still identical in all three apps, against 57 of 193
before. The consolidation has taken the easy files; the shell is most of
the rest. `web/formats/` and `web/store/` have not moved at all, which is
why stage 6 begins with them (item 6). `web/fonts/` is the shape every
tree ends up in: five files, none identical, because after 6.1 each app
keeps only the two files that are its own DATA plus two thin wrappers over
the package — a tree whose files all differ because nothing generic is
left in it.

The drift is concentrated in a few large files. Lines that differ against
CozyJournal's copy (the canvas and node-layer rows re-measured 2026-10-21,
before stage 5a: stage 4 had touched both since this table was first taken,
and `NodeLayer.tsx` was no longer identical in DrawBot):

| File | Sol | DrawBot | Cozy | Sol vs Cozy | DrawBot vs Cozy |
|---|---|---|---|---|---|
| `EditorShell.tsx` (re-measured 2026-10-23, stage 6.0) | 7,494 | 8,589 | 10,077 | 4,235 | 3,240 |
| `components/CanvasSurface.tsx` (MOVED, stage 5b — the package's, in CozyJournal's version with both other apps' generic additions adopted) | 5,939 | 6,774 | 7,104 | 1,737 | 1,042 |
| `editorSession.ts` | 6,989 | 7,709 | 7,206 | 399 | 889 |
| `EditorHost.tsx` (re-measured 2026-10-23, stage 6.0) | 362 | 563 | 1,429 | 1,279 | 1,336 |
| `entryRaster.ts` | 373 | 227 | 905 | 794 | 858 |
| `importEntryTile.ts` | 262 | 379 | 432 | 310 | 417 |
| `components/toolbarMeta.ts` | 932 | 1,001 | 1,006 | 126 | 39 |
| `components/NodeLayer.tsx` (MOVED, stage 5a) | 1,326 | 1,168 | 1,167 | 161 | 3 |

Of the 57 files identical in all three, only 34 import nothing but the
engine, editor-ui, the shell and each other; the other 23 are identical
leaves that import a drifted file (`cameraMath`, `drawnPose`, `paintBrush`,
`editorSession`, `sliderModeMenu`, `toolbarMeta`, `activeColor`,
`NodeLayer`) and move only when it does.

**The two re-measured rows went UP while the files shrank, and that is a
warning about the measure rather than news about the drift** (stage 6.0,
2026-10-23). `EditorShell.tsx` lost 605 to 768 lines to stage 5 and its
drift against CozyJournal rose from 3,978 / 2,723 to 4,235 / 3,240: what
stage 5 removed was the canvas's share, which was *identical*, so the
remainder is a more drifted file than the whole was. A whole-file diff
count measures how much of a file is shared only if the file is one thing.
The shell is not, and §4.2 item 6 records what it is instead — 89 % of each
app's shell appears VERBATIM in CozyJournal's, in runs up to 730 lines,
which is the number that decides whether it can move.

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
installs its session host and its outline host. From stage 5b it holds the
CANVAS: `components/CanvasSurface.tsx` — CozyJournal's version, nothing of
any app in it, and since stage 5b.4 carrying what the other two apps'
copies had that it did not (the host document through every multi builder,
the host-item twist, the bot pick, the input lock, the forward arrow, the
camera glide and the touch report) — with the seam it is configured through
(`components/canvasHooks.ts` — the presses a host claims, the DOM it draws
per scene node and the element a gesture previews it on, its per-node
records and the two-finger twist — and `canvasTwist.ts`), the leaves it
needed (`selectionShapeOutline.ts`, `useSuppressIOSLoupe.ts`,
`turnLive.ts`, `pushStrength.ts`, `editableRegion.ts`'s magnet) and two
splits: the push brush's vector half (`pushBrush.ts`, the rig half behind
`HostPushTargets`) and the move-and-scale of a node that changes size by
being dragged (`dragScale.ts`, the factor behind `HostNodeRules.dragScale`).
No app has a canvas, a node layer or a canvas leaf of its own any more.

## 3. Still copied, and why

Everything else under `web/editor/` is still per app because it imports the
app: `@/web/formats/types` (the `EditorConfig` and `ToolId` unions, which
differ per app), `@/web/store/*` (each app's entry store), `@/components/
bridgeSchema` (each app's native bridge events), `@/components/theme`, the
fonts, and the app's own trees (`web/sol`, `web/sim*`, Figgie). The shell
(`EditorShell.tsx`) and the host (`EditorHost.tsx`) are where the apps' own
features are still woven in by hand rather than plugged in; the session's
were unwoven at stage 3 and the canvas's at stage 5b.

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
| Layers drawn over the canvas, and the gestures a host claims | Sol's plant layers rendered by its canvas, DrawBot's `DrawBotsLayer` in a slot, CozyJournal's `RigNodeLayer` and its whole `rigPose` gesture mode | **Done (stage 5b.1, completed 5b.4).** `layers: { nodeLayer?(node), previewStandIn?(nodeId) }` plus the CANVAS HOOKS — `GestureHooks` and `CanvasSurfaceHandle` — in `packages/editor/src/components/canvasHooks.ts`, with the host's per-node RECORDS and the TWO-FINGER TWIST beside them and `canvasTwist.ts`'s `resolveTwistUnit` reading what a pair would turn. Two of the four are installed rules on `EditorExtension.canvas` (`records`, `twist`); the hooks and `layers` are PROPS of `CanvasSurface`, which is the plan's own line (§4.3) — an installed rule goes on the extension, per-render data rides as a prop, as the panel's host pages do — and both close over state only the shell holds (DrawBot's `useSimEditor()`, Sol's per-render plant plan and its rasters' oversample). **The seam already existed and was adopted, not designed** (stage 5b, settled 2026-10-22): DrawBot had shipped it in its own `web/editor/components/canvasHooks.ts`, 56 lines that CozyJournal and Sol had no copy of, and CozyJournal's rig maps onto it member for member — `beginRigPose` IS `onPointerDown` returning a CLAIM, the move case IS `onPointerMove`, `finishRigPose` IS `onPointerUp`, and the hold that abandons a pose grab (so a rig is not the one object whose radial menu will not open) IS `holdOpensMenu`. DrawBot's `claimedPointerRef` lifecycle is the lifecycle CozyJournal's gesture union member gets by hand. §4.3 records the decision, the SEVEN widenings it needed over the four halves of stage 5b, and the four members beside it. Two of the seven came at 5b.4 and are holes rather than widenings: `layers.previewStandIn`, which is `nodeLayer`'s `null` seen from the gesture side (a node the host draws nothing for has no element for a live preview to write on — Sol's plant sat still under the finger), and `HostNodeLayerInput`'s `liveIds` / `hiddenGroups`, two canvas facts a host drawing many nodes as one cannot do without and a SHELL cannot read, because both are the canvas's own state. `overlay?(session, camera)` was designed here and is **dropped**: the only thing it was for, Sol's `RevealOverlay`, is mounted by the SHELL and is stage 6, and the canvas's real overlay mechanism is the `layerSlot` + handle DrawBot ships — imperative by design, because Sol's §9.2 and DrawBot's §10.3 both forbid React state per frame. What stage 5a did first: the node layer moved with Sol's two components extracted to `web/sol/scene/`, beside the `plantLayer` policy whose DOM they are. |
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
5. **Done — canvas** (2026-10-22). Split in two when the measurement came
   in (owner, 2026-10-21), and the second half in four again.
   All three apps draw on one
   `packages/editor/src/components/CanvasSurface.tsx`, and no app has a
   canvas, a node layer or a canvas leaf of its own.

   The stage was planned as `CanvasSurface.tsx` and
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

   **5b — Done: the canvas.** `CanvasSurface.tsx` with `layers.nodeLayer`
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

   **5b.3 — Done: the canvas moves** (engine, 2026-10-22).
   `components/CanvasSurface.tsx` is the package's, in CozyJournal's
   version, and **nothing of any app reaches it**: what was woven in by
   hand is the seam 5b.2 refactored that app against, and the two things
   an app still owns ride as props — `hostTools`, its own tools with the
   rule each placing one's tap is read by, and `openTrace`, the two probes
   of a host that times its own open (the event name the marks are posted
   under is per-app `bridgeSchema`, which is stage 6's).

   Six leaves moved ahead of it, each one of the canvas's remaining
   app-side imports: `useSuppressIOSLoupe.ts` and its suite whole
   (byte-identical in all three apps); `selectionShapeOutline.ts` in
   CozyJournal's version, its two-line difference from the others being
   the rig check, which IS `CanvasRecords.has`; `editableRegion.ts`'s new
   MAGNET (`lineGridPoints`, `magnetToLines`), from CozyJournal's
   `creatureGeometry`, which keeps its own `midlineGridPoints` as the
   midline case of the first; `turnLive.ts` (rigTurnLive generalized);
   `pushStrength.ts` (rigPushStore's generic half); and the chrome's two
   canvas colours, which each app's `theme.ts` now RE-EXPORTS rather than
   restates — the `SYSTEM_FAMILY_STACK` move of 5a, for the same reason.

   Two SPLITS rather than moves. `pushBrush.ts` keeps its falloff, its
   vector warp, its raster smear and its one-entry commit here, and the
   rig half goes behind `HostPushTargets` — a node whose geometry is a BAKE
   of something else is pushed by pushing what it was baked from, and its
   path is excluded from the warp precisely so the two cannot end up
   describing different shapes. `maskWordScale` becomes
   `HostNodeRules.dragScale` plus `dragScale.ts`: the whole wrapper (move,
   then scale about the node's own centre, against the moved state, one
   undo entry, single and multi) was generic and only the FACTOR was the
   app's.

   Three things the move taught, worth the lines:

   · `@/editor-ui`'s index re-exports COMPONENTS, so a file that wants two
     palette values pulls a react-native tree in behind them. A plain
     re-export in CozyJournal's `components/theme.ts` took out every one
     of that app's components suites at once. `@/editor-ui/theme` is the
     import; the index is for the chrome.
   · A source pin on a MODULE SPECIFIER is a pin on where the file lives.
     The canvas spells its neighbours relatively here where it spelled
     them `@/editor/…` in the app, and a suite that pinned the import line
     failed on the move. One did.
   · A pin written as `indexOf(a) < indexOf(b)` needs `a` and `b` to be
     unique in the file. The open trace's ordering pin read `report()`,
     which now also appears in the prop's TYPE, forty thousand characters
     earlier — so the pin failed while the order it names was right.

   The PINS, measured and re-pointed: 60 of CozyJournal's suites read the
   canvas's source, in five different spellings of the path. All of them go
   through one helper — `editorSource('components', 'CanvasSurface.tsx')`
   in that app's `web/editor/__tests__/test-utils.ts` — which is the shared
   helper Sol's 5a reviewer asked for, built here because this stage is
   what made it worth building: how the engine lays its own tree out is not
   an app's to repeat sixty times over. CozyJournal 643 suites / 10,554
   tests; editor package 67 suites / 1,293 tests; engine 366 of 367.
   CozyJournal's range, canvas move and all, reviews at 239 KB — the move
   folding does its job.

   **5b.4 — Done: Sol and DrawBot take it** (2026-10-22). The stage ran
   engine-then-app twice over, DrawBot first because it owns the seam the
   canvas was built around: an engine commit of one app's additions proves
   nothing on its own (`packages/editor` is outside this repo's tsc and no
   suite here mounts a component), so the app commit that follows is the
   proof, and keeping the two apps' halves apart kept "did DrawBot's
   additions land?" separate from "did Sol's?" across 7,000 lines.

   Step one came before either: the four host-place callbacks (`onAddRig`,
   `onAddWord`, `onAddTile`, `onPlantSeed`) are ONE
   `onHostPlace(tool, cellX, cellY)` with two riders on the tool's registry
   row (`HostTool.place`), done once rather than three times.

   **DrawBot's additions** (engine 9c4af52 + 3fd857e, app f2ed8a6). Ten
   things, every one a generic addition its canvas carried and the
   package's did not. The largest and most mechanical: `session.hostDoc`
   now reaches every multi builder the canvas calls —
   `resolveMultiSelectionBox` (5 sites), `resolveMultiSelectionFrame` (5),
   `buildManipulateNodes` (2), `buildResizeNodes` (2), `buildMoveNodes`,
   `buildMoveNodesWithDragScale`, `marqueeHitIds` and `resolveTwistUnit` —
   all but one of which already took stage 3's trailing `hostDoc?`;
   `buildMoveNodesWithDragScale` gains one. `groupDragGesture` reads
   `selectionUnitIds`, which IS `groupSelectionIds` with no items adapter
   installed and the whole unit with one. The twist's gate asks
   `isHostId(id) || canTwoPointerManipulate(s, id)`, because a host item is
   not a scene node and the scene's question resolves through `findItem`:
   `isHostId` is exported for those sites rather than four copies of
   `sessionHost().items?.isHostId(id) ?? false`. `beforePick` is wired into
   a `pressFrontPickRef` four things read. `previewSelectionEntry` is
   called at each of the three multi gestures and at the teardown.
   `inputLocked` and the `lockedTap` gesture arrive with the rule they
   read: `lockedTapClearsSelection` comes INTO `canvasTap.ts`, which was
   its home until stage 3 and whose own header in DrawBot said so — the
   prop and the gesture mode are the package's, so a package-side gesture
   reaching into an app for its one predicate is the inversion this stage
   exists to end, and WHICH app locks its canvas stays that app's (as
   `forwardArrow` did at 5a). `forwardArrow` itself is the prop, a `<g>` of
   its own and both write paths. DrawBot's side is
   `web/simEditor/simCanvasHost.ts` — the fourth host its extension
   installs, holding the twist alone — plus `botGestures.ts` moved onto the
   seam's signatures, and the shell's `onHostPlace` switch,
   `place: { clearOfOverlay: true }` on its tile row, and `hostTools` and
   the open trace as props. Five files went with the canvas:
   `canvasHooks.ts` (DrawBot's own, the engine's since 5b.1 — seven modules
   re-pointed), `selectionShapeOutline.ts`, `useSuppressIOSLoupe.ts`,
   `lockedTap.ts` and `maskWordScale.ts`. The last of those is a finding:
   it was a copy of CozyJournal's word-sticker rule in an app with no Word
   tool at all, reached by nothing but its own canvas and its own suite,
   and `DrawBots.md` §12 already listed it under "dead-but-compiling editor
   chrome".

   **The press router's ordering is settled**, which §4.3 had left open.
   The middle button goes first of everything a one-pointer press can mean,
   then a host's claim at `'press'`, then the input lock, and only then the
   done-page gate, the caret, the crop and the tools. The claim had sat
   after the done gate and the caret, where nothing exercised the
   difference because CozyJournal's rig claims at `'grab'`; DrawBot's is
   the shipped order and it is the one `claimAt: 'press'` already documents
   in so many words. The canvas was what disagreed with the seam, not the
   other way round.

   **Sol's additions** (engine 6c31c7e + a30cb15 + 70412bb + e0c0d08, app
   2c038dd; the glide revised at 5b.4e below). `cameraGlide` — a camera the
   shell had worked out — and `onCanvasPointerDown`, a finger reaching the
   host before anything is read about the press. `revealRect`'s tween and
   this one became ONE `glideCameraTo` rather than two copies, and Sol's
   reveal glide gained the shared one's log-space zoom where its own mixed
   zoom linearly. `liveCameraOut` is NOT adopted, which was the open call:
   it is a ref the surface pushes the drawing camera into, and
   `CanvasSurfaceHandle.getLiveCamera()` already pulls the same value —
   Sol's `RevealOverlay` read `liveCamera.current ?? camera` once a frame,
   which is that getter exactly. A pushed mirror is only as fresh as the
   last place someone remembered to write it; the getter cannot go stale.
   `RevealOverlay` takes the handle and Sol's shell holds it, as
   CozyJournal's already did — one prop fewer, not one more. `seedMarks` is
   not adopted and needs nothing: it is plant-layer data, and the hook that
   draws the plants is Sol's own closure.

   **5b.4e — Done: one glide, asked with a box** (owner's call, 2026-10-22;
   engine 1eae4c5, Sol ba0fe05, CozyJournal 01a9fe10, DrawBot 23823f1).
   5b.4c adopted `cameraGlide` as Sol's prop stood and flagged it beside
   `revealRect` as one gesture asked two ways — fit this box, or go to this
   camera. The owner's call was to conform, and `cameraGlide` is gone:
   `revealRect` carries an optional `durationMs` and Sol asks with a BOX.

   The box is the right question, and the reason is not tidiness. The
   canvas owns how a box becomes a camera, and that is where the FIT and
   the CHROME INSETS live — `computeFrameCellBboxCamera(viewport, bbox,
   FRAME_OBJECT_FIT, { top: avoidTopPx, bottom: avoidBottomPx })`. A host
   handing over a finished camera skips all of it, and
   `computeFrameSelectionCamera` frames into the bare viewport, so a Draw
   could land its plants under the top bar or behind the properties panel,
   and the deeper that panel the worse it got. `revealRect` also drops an
   ask that arrives while a finger is already down, which it did not and
   Sol's glide did: that is the other end of a rule the canvas held at one
   end only (a finger landing DURING a glide cancels it and commits the
   camera where it stands), and the two belong together. The duration is
   per-ask data like the key, so it rides the prop and defaults to
   `REVEAL_GLIDE_MS` — the two callers want different flights, a refusal
   being answered where a reveal is admired.

   **A SECOND bug was claimed here and does not exist — retracted
   2026-10-22, in Sol's review round 1.** What this paragraph said: that
   Sol's `frameSeedsCamera` measured its leaves through
   `computeFrameSelectionCamera`, which reads each leaf's
   `arcBoundingBox(segments)` in LOCAL space and never applies the node's
   world matrix, so a plant whose group had been moved, scaled or turned
   was framed on the wrong rectangle — and that nothing pinned it because
   both halves of the duplication agreed with each other.

   The reviewer asked for the test that would fail without the fix, and
   there is none, because there is nothing to fix: a seed group's transform
   is baked THROUGH to its leaves' segments on every edit, so for Sol's
   plants the local union and the world union are the same numbers. All
   three cases were then checked against each other — a group move, a 30°
   turn, a 2× scale — and the two readings agree to the last decimal every
   time. The switch to `resolveMultiSelectionBox` is a consolidation onto
   the canvas's own box reading (so a Draw flies to exactly the box a
   selection of those plants would wear) and nothing more.

   It is left standing rather than deleted because of HOW it was made,
   which is the part worth carrying: the claim was reasoned from two
   function signatures — one reads segments, the other reads the graph, so
   the first must be wrong about a transformed node — and never checked
   against the data. Sol's leaves do not hold the shape the argument
   assumed. A duplication is a good enough reason to collapse something on
   its own; dressing one up as a latent bug put a false fact in a commit
   message, in this plan, and very nearly into a test written to confirm
   it. The lesson for the stages left: verify a claim about the DATA
   against the data, the way §4.2 item 5 already says to verify a pin
   against the regression it names.

   Sol's side is `web/sol/scene/plantCanvasLayers.tsx`, and it is the
   reason `layers` is a prop rather than an installed rule: what it draws
   from is a whole render's worth of Sol's own work — the plant plan, each
   plant's composite and element frame, the mode each renders in, one
   raster oversample for the page. It is resolved once per render and
   cached on every input by identity, so the second node asked in a render
   walks no graph.

   **TWO HOLES in the adopted seam, found here and worth the lines**,
   because both are the same shape as the four §4.3 records — the interface
   was right, it just under-delivered.

   `CanvasLayers.previewStandIn` is the sixth widening. `nodeLayer` has
   been able to answer `null` since 5b.1 — "mine, and it draws nothing
   here", which is how Sol's plant absorbs its leaves into one composite —
   and nothing said what a live gesture then writes its preview transform
   ON. It wrote it on nothing: `nodeEl(id)` finds no element for an
   absorbed node, so a drag of a plant moved every loose shape beside it
   and left the plant standing still. The answer is the host's own element,
   as a `HostPreviewStandIn`: a `key` (one element draws many nodes, so the
   surface dedupes on it and only the first of a key's nodes in the
   gesture's own list drives it), an `el()` that may not be mounted, and a
   `css(nodeId, world)` the HOST maps, because only the host knows its
   element's space. Three paths route through it — the gesture preview and
   both teardowns — and an absorbed node also stops going through React for
   an off-square stretch.

   `HostNodeLayerInput` gains `liveIds` and `hiddenGroups`, the seventh.
   Its own doc already said what belongs on it — "everything the three
   apps' own layers draw from that is the CANVAS's to know" — and these are
   exactly that: a node the render is re-drawing through React needs an
   element of its OWN for that re-draw to land on, which a node drawn as
   part of someone else's does not have, so Sol lifts a stamp being
   stretched out of its composite; and a host drawing many nodes as one
   must leave out the ones the page is hiding. Sol's canvas read both off
   `livePose` and `liveResize` directly, which the shell cannot — both are
   canvas state. Both are computed once per render and identity-stable, so
   a hook can memoize its plan on them.

   **`patternGridEdit.ts` is deleted from Sol**, with its 321-line suite,
   and its six exports come from `@/editor/tileTool`: all six are
   BYTE-IDENTICAL to the package's, which has held them since 5a. The 5a
   measurement table above records `tileTool.ts` as "absent from Sol"
   because it went looking for the FILENAME — Sol had the same code under
   another one, and that row is wrong. Sol's shell, its `gridLevel.ts` and
   three of its suites import the package now.

   Two riders that were not there: `HostTool.place` is declared by both
   apps' rows now — DrawBot's tile `clearOfOverlay`, Sol's plant `snap` —
   and Sol's was MISSING, which §4.3's settled design had recorded as
   already done. Without it a seed would have stopped landing on a grid
   intersection the moment the canvas moved.

   **The PINS.** 52 of DrawBot's suites and 43 of Sol's read the canvas's
   source text, in five and eight spellings of the path respectively. All
   go through one `editorSource('components', 'CanvasSurface.tsx')` per app
   — CozyJournal's 5b.3 helper, appended to DrawBot's `test-utils.ts` and
   NEW in Sol's (it had none, where the plan said both apps did). Nine of
   DrawBot's cases moved to the engine with the canvas rather than being
   re-pointed, by §4.3's rule that an addition adopted from a non-canonical
   copy is pinned where it lives: the claim lifecycle, the middle pan's
   precedence, the layer slot, and the takeover, which nothing had pinned
   anywhere. Three of the re-points were not mechanical:
   `botRotate.test`'s three surface pins became BEHAVIOUR (the twist
   reaches a bot through the installed host, so `resolveTwistUnit` is
   driven over a real sim session, where the engine's own suite drives a
   made-up peg); `plantLayerWiring`'s "the surface" describe became "the
   layers hook"; and `revealWiring` keeps only what Sol DEPENDS on of the
   surface, so a change to it fails in the repo that needs it too.

   Two behaviours arrive in Sol with the canonical copy, neither asked for
   by a pin of its own: a draw's first point is clamped into the editable
   region (Sol declares none, so the clamp is identity), and a pattern
   stroke works under the canvas Symmetry setting and writes those rules
   onto the pattern in the same undo step. Sol registers that tool and its
   patterns had no such behaviour before.

   **Three traps paid out again**, all three already on §4.3's list, which
   is the argument for keeping that list: a source pin on a MODULE
   SPECIFIER is a pin on where the file lives (`groupBoxHit.test` in both
   apps pinned `from '@/editor/groupHit'`, which the package spells
   relatively); a pin that counts occurrences counts the prose too (the
   `previewSelectionEntry` tally, fixed by counting over comment-stripped
   source); and an ORDERING pin has to be anchored on what the case is
   about (CozyJournal's and Sol's `textCaret` sliced `onPointerDown` to the
   middle-button pan, which this stage moved ahead of the caret, so the
   slice went empty while the rule it names held exactly as written — both
   are anchored on the tool read now).

   One bug this stage made and caught, worth recording because the catch
   was an app's typecheck and not any pin: `layers` was declared,
   destructured and read by `standInFor` but left OUT of `propsRef`, and a
   seam prop missing from that ref reads as absent at every call site
   inside a handler, silently, because the handlers are created once. The
   engine pins the four seam props against the ref's own literal now.

   CozyJournal took the engine's range in two pointer bumps of its own
   (15e296df, 44ef40f2) with eight pins re-pointed and no behaviour
   changed: it installs no items adapter, fills no `previewStandIn` and
   asks for no glide, so every builder is handed `undefined` and answers as
   before. DrawBot took the second half the same way (8bba760).

   Editor package 67 suites / 1,333 tests; engine 366 of 367 (cameraRoll's
   host dependency, as before). CozyJournal 643 / 10,599; Sol 281 / 3,430;
   DrawBot 528 / 9,218.

   **Stage 5 is complete.** All three apps draw on one
   `packages/editor/src/components/CanvasSurface.tsx`, and no app has a
   canvas, a node layer or a canvas leaf of its own. What stage 6 inherits
   from it is in §4.3's closing note.

6. **Shell and host — IN PROGRESS** (2026-10-23). `EditorShell.tsx` and
   `EditorHost.tsx` as the package's screen, taking `config`, `extension`
   and the app's store adapter; `web/formats/types.ts`'s common
   `EditorConfig`, `web/fonts/*` and the shared half of `web/store/*` move
   with them. Each app's `web/editor/` is then its extension alone.

   **6.0 — Done: measured** (2026-10-23). Three findings, and two of them
   changed the order of the rest.

   | | Cozy | Sol | DrawBot |
   |---|---|---|---|
   | `EditorShell.tsx` | 10,077 | 7,494 | 8,589 |
   | whole-file drift vs Cozy | — | 4,235 | 3,240 |
   | **verbatim in Cozy, in runs of 3+ lines** | — | **87 %** | **89 %** |
   | longest shared runs | — | 372, 346, 337 | 730, 503, 388 |
   | `EditorHost.tsx` | 1,429 | 362 | 563 |
   | **verbatim in Cozy, in runs of 3+ lines** | — | **58 %** | **45 %** |
   | longest shared runs | — | 33, 13, 13 | 22, 18, 15 |

   **The shell moves; the whole-file drift was reading it wrong.** 89 % of
   DrawBot's shell and 87 % of Sol's is byte-identical text in CozyJournal's,
   in long runs. Cut at its own section comments the file is 36 sections,
   and the drift sorts cleanly: the ten BAR-HANDLER sections are 1,635 lines
   drifting by **56 (Sol) / 40 (DrawBot)**, with THREE of the ten —
   the Stroke bar (156 lines), the Fill bar (51) and the eyedropper
   arm-and-commit (45) — byte-identical in all three apps, and seven of
   the ten the same LENGTH in all three to the line. What
   genuinely differs is the preamble (691 / 524, almost all imports), the
   JSX render tree (737 / 748), the commit pipeline (176 / 172 of 174
   lines — the app's own, as designed), the boot, and the sections only one
   app has (CozyJournal's rig sliders and social turn, Sol's cycle and
   reveal, DrawBot's transport).

   **The bar handlers do NOT move first, and §4.3 already said why.** The
   handover for this stage suggested taking them first, as the biggest
   identical block. §4.3's stage-4 decision argues the opposite — they are
   `useCallback`s over the shell's own commit pipeline, so moving them
   alone means inventing a context object of some fifty members and
   threading it through, which stage 6 would then delete — and the
   measurement only sharpens that: there is no seam-shaped boundary around
   them, and at 1,635 lines they would be paid for twice in review. They
   ride inside the shell, for free, when it moves.

   **The foundations are a PREREQUISITE, not a tail.** The suggested order
   put `web/formats/types.ts`, `web/fonts/*` and `web/store/*` last. The
   shell's distinct app-side import specifiers are **29 (Cozy) / 46 (Sol) /
   33 (DrawBot)** — against the canvas's NINE at 5b.3 — and they cluster
   into exactly those trees: `@/web/store/*` (8 / 6 / 7), `@/web/formats/*`
   (13 / 3 / 5), `@/web/fonts/*` (3 each), `@/components/*` (8 / 5 / 5, the
   bridge schema, the theme, the open trace) and `@/native-shell/bridge/
   webBridge` (1 each), plus each app's own trees (1 / 29 / 14 — Sol's shell
   imports twenty-nine of its own modules). A package file cannot import
   `@/web/store/entryStore`, so those clusters have to become seams BEFORE
   the shell can move, not after. Left last, the shell move is blocked on
   them.

   So the order is foundations first, most closed first: **6.1** the fonts,
   **6.2** the store adapter, **6.3** the common `EditorConfig`, **6.4** the
   host bridge, **6.5** the shell with the bar handlers inside it, **6.6**
   the host.

   **`EditorHost.tsx` is not one file three times over** — and this is the
   one the handover had wrong, not stale. It read the 1,429 / 362 / 563 as
   "the drift is nearly all in one app". It is not drift: only **FIVE
   top-level declarations exist in all three**, four of them trivial
   (`ActionScreen` 8 / 4 / 11, `ResolvedRoute` 7 / 8 / 10,
   `OpeningPlaceholder` 10 / 9 / 9, and the imports), and the fifth is
   `EditorHost` itself at 812 / 267 / 381 lines with 685 / 745 diff-lines.
   The longest run of shared text in the whole file is 33 lines, against the
   shell's 730. The three hosts are three ROUTE TABLES that share a
   skeleton: CozyJournal's extra thousand lines are `openGlyph`,
   `openRedline`, `openSocialTurn`, `takePageForks` and `takePageNames`;
   DrawBot's are `pushFormats` and its salvage channel; Sol's is
   `canvasIssue` and its strain routes. What is actually common is a
   ~200-line state machine — resolve the query, let a `NAVIGATE_TO` override
   it, hold at the placeholder while warm, mint a multi-file page once per
   session, clear the action screens, mount the shell. **An owner's call is
   open on it** (see "Still open"): the stage as written says the host
   becomes the package's screen, and the measurement says only its state
   machine can.

   **6.1 — Done: the fonts** (engine 5c457ae, CozyJournal b874b708, Sol
   ecc0172, DrawBot 76bae3f; 2026-10-23). Five of the seven files under
   each app's `web/fonts/` are the package's, and the drift between the
   three copies was ONE line.

   | What | Lines (Cozy) | Sol | DrawBot |
   |---|---|---|---|
   | `domTextMeasurer.ts` | 182 | 0 | 0 |
   | `loadPackFonts.ts` | 155 | 1 | 1 |
   | `glyphInk.ts` | 140 | 1 | 2 |
   | `settleFaces.ts` | 75 | 0 | 0 |
   | `exportFonts.ts` | 71 | 0 | 0 |
   | `registerFonts.ts` (STAYS) | 82 | 1 | 8 |
   | `faces.ts` (STAYS) | 36 | 15 | 0 |

   The Sol and DrawBot columns are lines that DIFFER against CozyJournal's
   copy, counted as §1's are. The one line in `loadPackFonts.ts` is
   `PACK_FONTS_STYLE_ID`, the id of the `<style>` element the `@font-face`
   rules live under — `cozy-` / `sol-` / `drawbots-pack-fonts`. It is one
   constant now, `underway-pack-fonts`: its only job is to stop a second
   module instance adding a second copy of the rules, there is one app per
   page, and nothing outside that module names it (checked — three uses,
   all inside the file, plus its own suite). `glyphInk.ts`'s difference was
   a `export type { GlyphInkFn }` re-export line.

   What stays each app's is its DATA and the one thing that needs its
   bundler: `faces.ts` (the `FACE` require table — Sol ships three families
   where the other two ship twenty) and `registerFonts.ts` (the pack list
   and the `fontFamilyFor` resolver, which 5a had already settled as the
   app's because a pack is not a table the package can read). DrawBot's
   list lives at `web/fonts/fonts.json` rather than `assets/packs/`, having
   no content packs — the one structural difference between the three.

   Two seams, both the shape of 5a's `registerFontFamily`:

   · `FontPack` (`loadPackFonts.ts`) — `fonts`, `faceUri(fontId)` and
     `fontFamilyFor`, handed in as a PARAMETER rather than installed at
     module scope, because the load is one boot-time call with one caller.
     `faceUri` answers a STRING, not an asset module: resolving one needs
     `Asset.fromModule` (expo-asset), and keeping that in the app is what
     lets `packages/editor` stay free of expo. A suite pins that the file
     imports neither expo-font nor expo-asset.
   · `registerFaceFetch` (`exportFonts.ts`) — the app's face READER,
     installed at module scope, because `registerExportFonts()` is called
     with no arguments from nine sites in five of CozyJournal's modules and
     `entryRaster` runs with no editor mounted at all. The cache, the
     concurrent-export dedupe and the engine wiring are shared, so the
     three apps hold one answer to "has this face already been read?".

   `domTextMeasurer` now reads the family through `fontFamily.ts`'s
   installed probe instead of the app's `registerFonts` directly, which is
   the one behaviour-relevant change in the sub-stage. Verified against the
   code rather than reasoned from the signatures (§4.2 item 5's lesson): in
   all three apps `registerTextMeasurer(domTextMeasurer)` has exactly ONE
   call site, eight lines above `registerFontFamily(fontFamilyFor)` in the
   same synchronous function, with nothing between them that lays text out —
   so no measurement can see the gap. A suite pins that ordering by
   position.

   Each app keeps two thin wrappers (`loadPackFonts.ts` → its `FontPack`,
   `exportFonts.ts` → its reader) with their export NAMES and signatures
   unchanged, which is what made this sub-stage cheap: the three shells'
   `loadPackFonts()`, the eleven modules that call `registerExportFonts()`
   and the twelve suites that `jest.mock` either path (5 / 4 / 3) are
   untouched.
   The one re-point is `colorBrushPixelAccurate.test.ts`'s glyph-ink import
   in each app.

   Suites split as stages 3 to 5 split theirs. `settleFaces.test` (62 lines,
   identical in all three) moved whole; `domTextMeasurer.test`,
   `loadPackFonts.test` and `exportFonts.test` have their behaviour halves
   here, driven over a made-up pack and a made-up face reader the way
   `sessionHost.test` and `panelModel.test` drive their seams — every member
   of `FontPack` is USED, so dropping one fails the suite's compile. What
   each app keeps is sharper than what left it: that every font its pack
   offers resolves to a URI (the roster test holds `fonts.json` and
   `faces.ts` to each other; this holds the RESOLVED uri, which is what
   actually becomes a rule), that its own families measure under their own
   CSS names, that the pack reaches the package's registry at all, and that
   its shell awaits the install before it builds the session.

   **One trap paid out, and it is on §4.3's list.** That last pin reads the
   shell for `createEditorSession(` in CozyJournal — and Sol's shell calls
   `createSolSession(` and DrawBot's `createSimSession(`, each app naming
   its own constructor because `TOps` has nothing to infer from (item 3).
   Copied verbatim the pin would have FAILED rather than held, which is the
   benign direction; the same pin written as `indexOf(...) > -1` would have
   passed vacuously in two apps.

   One dead import fell out, caught by this repo's stricter
   `noUnusedLocals` and invisible in the apps, as two did at 5a: an unused
   `TextStyle` in `glyphInk.ts`.

   **Left for later, and deliberate:** `faceUri` and `fetchFaceBase64` are
   ~18 lines of `Asset.fromModule` glue duplicated in all three apps. That
   is the price of keeping expo out of `packages/editor`, and it is the same
   call 5a made for `registerFonts`. The engine does already import
   expo-asset once (`packages/engine/src/loadTile.ts`), so the boundary is
   the editor package's rather than the repo's — if the owner would rather
   pay the dependency, the two helpers collapse into `FontPack` and the
   seam becomes an asset-module lookup again.

   Editor package 116 suites / 2,094 tests; engine 370 of 371 (cameraRoll's
   host dependency, as before). CozyJournal 646 / 10,625; Sol 280 / 3,417;
   DrawBot 531 / 9,236. The three ranges review at 75 / 74 / 70 KB (§5).

   **6.2a — Done: the store's closed leaves** (engine 2c0b167 + 737aeeb,
   CozyJournal 1db22403, Sol e523a77, DrawBot 027d95c; 2026-10-23). The four
   files under each app's `web/store/` that carry no app data, plus the seam
   the rest of the tree needs.

   | What | Lines (Cozy) | Sol | DrawBot |
   |---|---|---|---|
   | `assetJanitor.ts` | 105 | 2 | 12 |
   | `pageIds.ts` | 94 | 55 | 0 |
   | `resetData.ts` | 27 | 6 | 4 |
   | `pageIO.ts` | 20 | 0 | 0 |

   The Sol and DrawBot columns are lines that DIFFER against CozyJournal's
   copy, counted as §1's are. `pageIO.ts` was byte-identical in all three.
   `resetData.ts`'s CODE was byte-identical in all three and only its
   COMMENT differed, listing each app's key prefixes. `pageIds.ts` was
   byte-identical in CozyJournal's and DrawBots'; Sol's 55 lines of
   difference are not drift but ABSENCE — its copy is exactly the ULID half
   of the other two under a different header, so Sol gains the page-NAME
   half unused. `assetJanitor.ts` differed from CozyJournal's by a single
   CHANGED line in Sol (the stamp's key — 2 by this table's both-sides
   count) and by that line plus a sim-document sweep in DrawBots.

   **The seam is one word, and it is the first in this plan that REFUSES
   rather than defaults.** Every key all three apps write is
   `<app>:<kind>[:<id>]` — entry, thumb, view, index, settings, homeState,
   assetSweep, and each app's own besides — so `store/storeKeys.ts` holds
   the shape and the app installs the word (`registerStoreNamespace`, from
   its own `web/store/storeNamespace.ts`).

   **What 6.2a did NOT do, which three of this stage's docs claimed it had**
   (CozyJournal's review, round 1): it did not route those keys through
   `storeKey()`. The builder spells exactly ONE key per app — the janitor's
   `<ns>:assetSweep:last`, which moved with the janitor — and every other
   prefix is still a whole literal where it is used: nine in CozyJournal's
   `entryStore.ts` plus two native, five in Sol's plus four elsewhere,
   thirty-two across eleven files in DrawBots. They come through at 6.2b,
   with `entryStore.ts`. Each app's codebase map and each
   `storeNamespace.ts` header said "installed once, the word spelled once",
   which is 6.2b's end state written as though 6.2a had reached it — the
   mistake item 5 of this section names, made again by the hand that wrote
   that warning. Each now says which single key the builder spells.

   The hazard the reviewer named is real and is now CLOSED rather than
   merely described: a rename of `STORE_NAMESPACE` would have re-spelled the
   stamp and left the rest behind. Each app's `storeNamespace.test.ts` holds
   every namespaced DECLARATION to that constant — read from source, since
   they are unexported consts — by a derived directory SCAN in all three,
   which rounds 1 and 2 arrived at in two steps (CozyJournal and Sol named
   their constants by hand first, and a hand-written list is what went
   stale). All three were verified by changing the word in one place and
   watching most of the suite fail, which is 5a's standard for a pin.

   Every other seam in this plan falls back when nothing is installed: no font pack
   means the system stack, no session host means no host ops, no outline
   host means no host rows. This one throws. The reason is the asymmetry of
   the failure — a wrong font family shows the system face for a moment,
   a wrong namespace writes a page where nothing will ever look for it
   again. The install is at module scope, before any key can be built, so a
   missing one fails immediately rather than writing somewhere wrong — but
   not loudly: `assetJanitor`'s only production path is
   `installAssetJanitor`'s `void sweepIfDue()`, and `sweepIfDue` is async, so
   the throw arrives as an unhandled rejection, which is a console warning on
   web and nothing a user sees. `storeKeys.ts` says so in those words, and
   each app's `storeNamespace.test.ts` is the real backstop. (This paragraph
   said "a boot-time failure or nothing at all" until CozyJournal's round-2
   review pointed out that the code comment it describes had been corrected
   inside the same range and the design document had not — which cannot be
   both ways in one tree.) `registerStoreNamespace` also refuses anything
   but a bare lowercase word, because a namespace with a colon in it would
   re-shape every key built from it (`a:b:entry:x` reads as namespace `a` to
   anything scanning a prefix).

   It is worth putting beside 6.1's opposite call. `PACK_FONTS_STYLE_ID` was
   three spellings of a private DOM id and collapsed to ONE constant;
   `ENTRY_PREFIX` is three spellings of a persisted namespace and collapses
   to a SEAM. The test is not how alike the three values are — both were one
   line — but whether anything outside the process has a copy of it. A
   `<style>` element lives as long as the page; a key lives as long as the
   user's data.

   A second seam on the janitor, `registerExtraSweep`: an app's own
   leftovers of the same kind ride the same once-a-day schedule rather than
   keeping a second stamp beside it. DrawBots' `sweepOrphanSimDocuments` is
   the only caller, it runs FIRST, and a failure in it does not cost the
   blob sweep its day. The stamp's key is read through the namespace at each
   use rather than captured into a module constant, because the install and
   this module's load are both module-scope effects and their order is the
   bundler's.

   `PAGE_ID_PREFIX` and `isPageId` came with `pageIds.ts` out of each app's
   `web/store/types.ts`: `newPageId` is what spells the prefix and the two
   cannot be allowed to disagree. Each app's `types.ts` re-exports them —
   the `SYSTEM_FAMILY_STACK` move of 5a, for the same reason.

   **No wrappers for `pageIO` and `resetData`, and the rule is worth
   stating**, because 6.1 kept two. A wrapper earns its place by holding app
   DATA — 6.1's hold the font pack and the face reader — not by sparing an
   import re-point. `PAGE_IO` is a constant and `resetJournalData` a
   four-line function, so their 50 importers across the three apps
   (`PAGE_IO` 15 / 10 / 14, `resetJournalData` 5 / 3 / 3) moved instead, and
   no tree keeps a stub. `assetJanitor.ts` stays as a
   wrapper in all three because it has data: the namespace, and DrawBots'
   sweep.

   Two findings, both from an app rather than from the engine:

   · `ExtraSweep` was declared `() => Promise<void>` and DrawBots'
     `sweepOrphanSimDocuments` answers a `SimSweepResult`, so that app's
     TYPECHECK refused it — the gate that sees a seam's signature at all, as
     5a's dropped `forwardArrow` export was. It takes `Promise<unknown>`
     now, which is the honest shape (the module awaits and discards), and a
     case installing a reporting sweep pins it so narrowing it back fails
     this package's compile.
   · `collagePageId` has ZERO uses in DrawBots outside its own file — it
     derives a week's collage page name and that app has no collages — and
     its copy was byte-identical to CozyJournal's, which uses it at 14
     sites. The move turns a dead copy into one shared implementation
     rather than two; DrawBots now ships it unused, the arrangement 5a made
     for the six canvas leaves Sol ships without a tool for. Left as it is,
     and recorded, which is what 5b.4 did with `maskWordScale`.

   Suites: `storeKeys.test` (12 cases) and `pageIds.test` (12) are new, and
   **`pageIds.ts` had no suite of its own in any of the three apps** — its
   ULID rules were covered only incidentally through `entryStore`'s and
   `homeState`'s tests, so the one that matters most (within a millisecond
   the random tail is INCREMENTED, not re-rolled, or an index scan hands two
   pages back swapped) could have been tidied away with everything green.
   `assetJanitor.test`'s behaviour half moved here, driven over a made-up
   namespace, with six new cases over the two seams; each app keeps the
   wiring half, which is a fact about its own screens.

   One trap paid out in all three apps, and it is on §4.3's list:
   `afterReady.test.ts` pinned `'void sweepIfDue();'` inside
   `web/store/assetJanitor.ts` — the line that MOVED — so each app reads the
   package's copy through `editorSource('store', 'assetJanitor.ts')` now.
   Sol's `check:doc-paths` caught four stale paths its codebase map named,
   which is the half of the doc sweep a machine can do.

   `packages/editor/src/store/` is a new subdirectory rather than five more
   files at a package root that has eighty; suites stay flat in
   `src/__tests__/`, as `components/`' already do.

   **Round 1 of CozyJournal's review** (2026-10-23) blocked on two things,
   both prose and both fixed in all three apps rather than only the one
   reviewed — which is what the review being per-app rather than per-engine
   makes possible to get wrong three times:

   · the namespace overclaim above;
   · **six code comments naming the two files the range deleted** —
     `web/store/pageIO.ts` and `web/store/resetData.ts` — in CozyJournal,
     three in Sol and four in DrawBots. `check:doc-paths` reads `.md` only,
     so it stayed green while the `.md` docs were in fact clean: the
     mechanical half of the doc sweep does not cover comments, and §4.3's
     list already says a comment naming a deleted file is the thing to look
     for.

   Four suggestions were taken. One was a real contract bug rather than
   prose: `assetJanitor` built the stamp's key INSIDE the try/catch that
   guards a localStorage which will not answer, so `storeKeys`' promise that
   a missing install is "a boot-time failure or nothing" was false on the
   only path that builds a key — the refusal was swallowed and the blob
   sweep would have run on every foreground instead of once a day, silently,
   for the life of the app. The key is built above the try now, in the read
   and the write, with two cases pinning it. Three were stale comments in
   THIS repo that 6.1 made false (`paintBrush.ts` ×2, `editorSession.ts`,
   `fontFamily.ts`, all naming a `web/fonts/` file that is now a package
   sibling), one was the twelfth copy of `PAGE_IO` in two apps'
   `test-utils.ts`, and one was `metro.config.js` and `registerFonts.ts` in
   all three apps saying `loadPackFonts.ts` require()s the faces — which
   `faces.ts` does, and which is the exact error §4.2 was rewritten to fix
   at 6.1.

   One scope finding: CozyJournal's 6.1 pointer bump also carried engine
   66834ea, a `dragScale` behaviour fix, which that commit message did not
   name (Sol's did). It is inert in that app, which installs `nodes` and no
   `items`.

   **Round 1 of Sol's and DrawBots' reviews** found three more things, and
   two of them are the SAME overclaim a third and fourth time — which is the
   part of this sub-stage worth carrying forward, more than anything that
   moved:

   · **The janitor's behaviour suite was COPIED into the package, not
     moved, in two of the three apps.** CozyJournal's was trimmed at round 1;
     Sol's and DrawBots' were left whole, byte-for-byte identical to the new
     engine suite and exercising the package's module through a four-line
     re-export — so they passed whatever those apps did. The record above
     said "`assetJanitor.test`'s behaviour half moved here … each app keeps
     the wiring half" while that was true of one app in three. It is true of
     all three now. DrawBots keeps two cases besides the wiring, and they
     earn it: they drive the REAL `sweepOrphanSimDocuments` through that
     app's wrapper, where this package's suite drives a stand-in.
   · **The namespace pin went through three versions before it held what it
     claimed.** Round 1 named eleven constants by hand; the word is in 54
     declarations across 14 files in CozyJournal, 19 across 9 in Sol, 32
     across 12 in DrawBots. The second version scanned, but anchored
     `^const `, so every `export const` escaped it silently — Sol's reviewer
     found `homeStateDelta.ts`'s persisted image prefix sitting outside a pin
     whose own comment said it covered everything. **The lesson is not "count
     more carefully": it is that a pin must DERIVE its scope rather than
     assert it.** All three now walk the trees, collect every file declaring
     a namespaced constant in any form, and fail if that set differs from the
     list they hold — so a new file keying under the namespace is a loud
     failure instead of a gap. Each was verified both ways: rename the word
     and most cases fail; add a file using it and the completeness case names
     it.
   · A fourth stale comment of the same kind as round 1's six
     (`entryStore.ts`'s "Ids … live in `./pageIds`"), in all three apps.
     Round 1's own sweep grepped `web/store/pageIds` and missed the RELATIVE
     form, which is worth saying plainly: a sweep is only as wide as the
     spelling it greps for.

   **Round 2 of both reviews found the same thing again, and this is the one
   to remember: a fix that ADDS a file re-breaks a count.** Each app's
   codebase map said "four files are this app's" under `web/fonts/`; round
   1's fix for the namespace duplication added `faceAsset.ts` in the same
   commit and the count was INCREMENTED to five while the tree went to five
   (six in DrawBots, which has a `fonts.json`). DrawBots' reviewer put it
   exactly: "round 1's finding re-created by its own fix". The same shape hit
   the pin's own DESCRIPTION — three places still described the version of
   the scan the round-1 commit had replaced underneath them.

   The structural answer, and it is why the recurrence was worth the rounds:
   **the count is no longer prose.** Each app's `fontRoster.test.ts` — which
   already existed to make a silent disagreement between `fonts.json`,
   `faces.ts` and `package.json` loud — now also holds the codebase MAP to
   the directory: a module there that the map does not name fails it. Verified
   in each app by removing every mention and watching the case name the file.
   A number in a sentence cannot be held to anything; a membership test can.

   The scan also gained two trees, and not hypothetically: CozyJournal's
   `app/analytics.tsx` keeps two persisted keys under the namespace that a
   `web/`-and-`components/`-only walk never saw — a THIRD gap in the same pin,
   after the hand-named constants and the `^const ` anchor. And §4.1 of
   `Sol.md` still said "the native side's three" where there are four files
   and five declarations: round 1 fixed the test half of that finding and left
   standing the very sentence the test backs, so the doc and its pin
   disagreed on the page.

   And one finding of the plan's own kind, where a file's comment turned out
   to be load-bearing. Both reviews asked for the duplicated
   `Asset.fromModule` lookup to become one helper. Putting it on `faces.ts`
   broke `fontRoster.test.ts` in every app — jest cannot parse expo-asset's
   ESM unmocked, and that suite wants the FACE table ALONE — which is exactly
   what the comment at the top of `faces.ts` says the module is
   dependency-free FOR. The helper is `web/fonts/faceAsset.ts`, its own
   module, and its header records why it is not a method on the table. A
   file that explains its own shape is worth reading before changing it.

   Editor package 119 suites / 2,129 tests; engine 373 of 374 (cameraRoll's
   host dependency, as before). CozyJournal 650 / 10,660; Sol 281 / 3,417;
   DrawBot 535 / 9,272. The three ranges, 6.1 and 6.2a together, reviewed at
   202 / 178 / 174 KB with the first round of fixes on them, and 233 / 228 KB
   for Sol and DrawBots at round 2 (§5). CozyJournal shipped after round 1
   and its remaining range is 34 KB.

   **Three review rounds for two sub-stages that moved 1,000 lines, and
   every blocking finding in all three was PROSE.** Not one was a bug: the
   code did what it said from the first commit. What kept failing was the
   describing — a count, a claim about scope, a comment naming a moved file,
   a sentence left standing when the test under it was rewritten. §4.3's
   list already says to expect that; what these rounds add is the remedy
   worth generalising: **where a doc states a fact a machine could check,
   make the machine check it.** The doc-path checker already does this for
   paths; `fontRoster.test.ts` now does it for a directory's membership in
   the map, and `storeNamespace.test.ts` derives its own scope instead of
   asserting it.

   **A fourth round found the limit of that, and it is worth stating:
   membership is checkable, a COUNT is not.** CozyJournal's map said "this
   app's own two files and two thin wrappers" over a list that had grown to
   five, and the new guard could not see it — it holds which modules are
   named, not how many the sentence claims. The round-3 fix had removed the
   count from the other two apps and missed this one, because this app spells
   it in words where they spelled it as a numeral, and a sweep for "four
   files" does not find "two files and two thin wrappers". So the counts came
   out of the maps and the namespace paragraphs rather than being corrected a
   fourth time — though not in one pass: Sol's round-3 review found §4.1 of
   `Sol.md` carrying three numerals in the same paragraph as the sentence
   "No count here on purpose", two of them ADDED by the commit that wrote
   that sentence, which is this failure's purest form. A claim about counts
   is itself a count.

   The shape to keep: a sentence that says "what stays here is this app's
   own, under `web/fonts/`" cannot go stale, and the guard holds the list
   under it. The guard also asserts the QUALIFIED path now
   (`web/fonts/<name>`), since a bare filename would be satisfied by any
   mention of that name anywhere in the map.

   **6.3a — Done: the closed leaf of `web/formats/`** (2026-10-23).
   `svgImageGeometry.ts` — the GEOMETRY of an SVG picture placed on a page,
   its `<path>`s flattened to polylines in world cells — is the package's
   (`packages/editor/src/formats/svgImageGeometry.ts`).

   It is the plainest move this plan has left: **418 lines, byte-identical
   in all three apps, importing nothing but the engine** (`@/engine/types`,
   `@/engine/imageFraming`). That is stage 1's own criterion word for word
   — "the 34 files that were identical in all three apps and import nothing
   of any app" — and it was missed for five stages because stage 1 read
   `web/editor/` and this file sits in `web/formats/`, a tree §1's table
   says has "not moved at all". No seam, no adoption decision, no owner's
   call: the three copies were the same bytes.

   **It was dead in two apps of the three.** Its only reader anywhere is
   CozyJournal's `web/formats/pageTemplate.ts` (the Adrift template traces
   its mask and its bottle through it); Sol and DrawBots each carried 418
   lines whose only importer was its own suite. So the move turns three
   copies, two of them dead, into one shared implementation — the
   arrangement 5a made for the six canvas leaves Sol ships without a tool
   for, and 6.2a for `collagePageId`.

   Two suites moved, and **both were byte-identical in all three apps**:
   `svgImageGeometry.test.ts` (188 lines) is dedicated to the moved file and
   went whole, and `imageFraming.test.ts` (334 lines) SPLIT. Its split is
   worth recording, because the file was not what its name says: of its
   three parts, the engine's framing helpers and the mode-by-mode SVG
   export test `packages/engine`, and **`imageFraming.ts` had no suite of
   its own in this repo** — `resolveFraming`, `coverDrawSize`,
   `clampPanOffset`, `straightenCoverScale`, `tileGeometry`,
   `cropRatioValue` and `FRAMING_DEFAULTS` were named by no suite here at
   all, and the three apps' identical copy was the only thing testing
   them. The "nothing draws an image by stretching it" pair reads the
   PACKAGE's `NodeLayer.tsx` and this file, and only the Crop-bar pair
   reads the app's `EditorShell.tsx`. The first two moved; the third is
   what each app keeps. The package's half asserts that no `vendor/UnderwayEngine`
   path and no mention of `EditorShell` survived the cut, so a future
   careless copy of the app's half into it fails rather than passes
   vacuously — which is the 6.2a lesson (the janitor suite COPIED, not
   moved, in two apps of three) written as a check instead of a resolution.

   **DrawBots' test count falls by three, and it is the pins working rather
   than coverage lost** — worth writing down, because the arithmetic of a
   move otherwise looks wrong. CozyJournal's total is unchanged (the 17
   cases of the dedicated suite and the 30 behaviour cases move, and that
   app runs the package's suites) and Sol's falls by exactly those 47 (its
   `jest.config.js` roots at `scripts/`, `web/` and `components/` only, so
   it does not run them — and Sol never had a reader for the file). DrawBots
   runs the package's suites and should therefore be unchanged too, but
   `web/sim/__tests__/sourcePin.test.ts` generates a case PER FILE in two
   scans — `walk(web/)`, which counts `__tests__` as well, and a
   web+components+app walk that does not — so a tree with one source file
   and one test file fewer has three cases fewer. Every file that exists is
   still checked; there is no gap to fill in the package, because the
   symbols those pins forbid (`BEHAVIOURS[`, the bot-kind vocabulary) are
   DrawBots' own and a shared file cannot name them.

   One duplication found and deliberately NOT folded, flagged as
   `CLAUDE.shared.md` asks: `parseSvgViewBox`'s root-tag regex and its
   four-line `attr()` reader are a third spelling of what
   `packages/engine/src/compositionImageImport.ts`'s `svgIntrinsicSize`
   does inline. The two have genuinely different contracts — one answers
   the viewBox's x/y/w/h for mapping coordinates, the other the display
   size, preferring `width`/`height` — so only the attribute reader is
   actually shared, and collapsing it is a change to the engine's own
   import path rather than part of this move.

   **6.2b to 6.6 — not started. Measured, 2026-10-23**, since the stage's own
   rule is to measure before planning, and the measurement makes 6.2b a
   different and much smaller job than "the shared half of `web/store/*`"
   sounds.

   | File | Decls in all 3 | Cozy | Sol | DrawBot | the big one |
   |---|---|---|---|---|---|
   | `entryStore.ts` | **42 of 68** | 549 | 479 | 535 | many byte-identical |
   | `types.ts` | **6 of 31** | 253 | 140 | 241 | `JournalEntry` 177 / 86 / 163, drift 139 / 54 |
   | `homeState.ts` | **6 of 19** | 472 | 148 | 155 | `buildHomeStateDelta` 356 / 79 / 79, drift 329 / 327 |

   **Only `entryStore.ts` is a file that moves.** The other two are the shape
   `EditorHost.tsx` turned out to be at 6.0 — not drifted files but per-app
   records that share a few helpers:

   · `types.ts` holds each app's own stored RECORD. `JournalEntry` is 27
     fields in CozyJournal, 18 in Sol and 26 in DrawBots, and `AppSettings`,
     `ALL_FORMATS` and `DEFAULT_SETTINGS` are not DECLARED in DrawBots'
     copy — that app keeps them in `components/appSettings.ts` and
     `components/formatIds.ts`, which its `types.ts` imports and RE-EXPORTS
     under the same names, because they ride the native bundle too
     (`DrawBots.md`, "Mirror modules"). So all three apps do have them,
     and `entryStore`'s settings half is shared by three, not two. What is genuinely shared is about sixty lines of helpers —
     `dayStartMs`, `inImageWindow`, `isIssuedEntry`, `entryImagesBehindPage`,
     `EntryStatus` — of which `dayStartMs` and `inImageWindow` are
     byte-identical between CozyJournal and DrawBots.
   · `homeState.ts` is each app's own home payload. `buildHomeStateDelta` is
     356 lines in CozyJournal against 79 in each of the others and drifts by
     329 / 327; only `slotPlan` (17 lines) is byte-identical in all three.
     CozyJournal's extra 300 lines are its prompts, its rail, its collages
     and its tile budget.

   So 6.2b is `entryStore.ts` plus about eighty lines of leaves, and
   `types.ts` and `homeState.ts` STAY — which also means the common
   `EditorConfig` of 6.3 is the last of `web/formats/` rather than one piece
   of a larger store move.

   **The one design question 6.2b has to settle, and it is the owner's**
   (see "Still open"): `entryStore`'s 42 shared declarations are generic over
   a record that is each app's own. Stage 3 answered the same question for
   the session — `EditorSession<TTool, TDoc, TOps>` carries the app's types
   through and every function that returns a session is generic over it — and
   §4.3 answered it again for `ToolId`, where neither of the two options the
   question was posed as was taken. The store's version is narrower than
   either, because most of `entryStore` never reads a field: it is key
   layout, the per-format index, the sidecar images and the settings merge,
   over a record it only stores and hands back. Whether that becomes
   `EntryStore<TEntry>`, or an installed entry adapter, or only the key and
   index mechanics with each app keeping its own accessors, is the call that
   decides how much of 549 lines moves.
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

  **The last host-place branch RELOCATES; it does not disappear** (done,
  stage 5b.4's first step). The three
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

  As built: `HostTool.place` is `{ snap?, clearOfOverlay? }`, and
  `clearOfOverlay` is asked BEFORE the cell is read, because there is then
  no cell to speak of. Done as the FIRST step of 5b.4, before either
  remaining app adopted the canvas, so the collapse happened once rather
  than three times — the four callbacks were still four props when the
  canvas moved at 5b.3.

  **DrawBot regains `push` at 5b, with the rig's canvas seam — and the
  last step is a product decision, not a move (open, 2026-10-22).** The
  brush was in the moved files already, and the plan read the app-side
  `DRAWBOT_PAINT_MODES` filter as the only thing holding it off the bar —
  one line in `hostTools.ts`, one use in the shell, three assertions. At
  the time that was wrong: DrawBot's canvas held no push gesture at all
  (zero references), and `pushBrush.ts` was imported only by CozyJournal's
  canvas and its `rigPaint`, `rigPushStore` and `RigControlsPanel`.

  5b.3 and 5b.4b closed that half. The gesture is in the canvas all three
  apps now draw on, and `pushBrush.ts`'s rig work went behind
  `HostPushTargets`, which is optional and resolves to null for an app
  that installs no `nodes` — so on DrawBot the brush would warp vector
  paths and smear raster, which is the whole of it bar the joints. Nothing
  technical holds it off that bar any more; the `PaintMode` filter is
  again the only thing, exactly as the first reading said.

  What is left is therefore a PRODUCT call and the owner's: a fourth
  brush, by hand, in DrawBots' raster group, in an app that has shipped
  without one. The filter, its use in the shell and the three assertions
  stay until that call is made, and `hostTools.ts` says so where the line
  is rather than promising a stage that is done.

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

  A FIFTH, SIXTH and SEVENTH came out of the last two apps adopting the
  canvas (5b.4), and the pattern across all seven is the point: the
  interface was right every time and its signatures were not quite. Three
  of the seven subtract or redirect; none adds a member the design missed.

  `previewSelectionEntry` takes the gesture's IDS and the entry as a
  THUNK, where DrawBot's took a built `SessionEntry | null`. Whether a
  multi gesture moves anything of the host's is the host's own question —
  which of these ids are its, and whether one of its items rides a group
  among them — and only the host can answer it without building the entry
  first. DrawBot had that gate written out in FRONT of the call; it
  belongs behind it, and a gesture over shapes alone then costs the hook
  one predicate and no reducer pass per pointer move.

  `CanvasLayers.previewStandIn` is a HOLE rather than a widening, and the
  one real design gap the whole adoption had. `nodeLayer` could already
  answer `null` — "mine, and it draws nothing here" — and nothing said
  what a live gesture then writes its preview transform ON. It wrote it on
  nothing: `nodeEl(id)` finds no element for a node drawn as part of
  someone else's, so a drag of Sol's plant moved every loose shape beside
  it and left the plant standing still. The answer is the host's own
  element, deduped by a `key` because one element draws many nodes, with
  the pose mapped into it by the host — only the host knows its element's
  space. It is `nodeLayer`'s `null` seen from the gesture side, and the two
  are halves of one idea: a node the host draws nothing for is a node the
  surface must ask about again when a finger moves it.

  `HostNodeLayerInput` gains `liveIds` and `hiddenGroups`. Its own doc
  already said what belongs on it — everything an app's layer draws from
  that is the CANVAS's to know — and these are exactly that. A node this
  render is re-drawing through React (an off-square stretch, a live
  resize) needs an element of its OWN for that re-draw to land on, which a
  node drawn as part of someone else's does not have, so Sol lifts a stamp
  being stretched out of its composite for the length of the gesture; and
  a host drawing many nodes as one must leave out the ones the page is
  hiding. Sol's canvas read both straight off `livePose` and `liveResize`,
  which a SHELL cannot: both are the canvas's own state, and that is the
  whole reason they had to come through the seam.

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

- **Settled at 5b.4, and recorded here because the next stage inherits
  them.** The press router's ORDERING: the middle-button pan first of
  everything a one-pointer press can mean, then a host's claim at
  `'press'`, then the input lock, then the done-page gate, the caret, the
  crop and the tools. `claimAt: 'press'` documents that order in so many
  words and the canvas was what disagreed with it; DrawBot's is the
  shipped behaviour and nothing of CozyJournal's moves, because its rig
  claims at `'grab'`. `lockedTapClearsSelection` MOVED to the package
  (`canvasTap.ts`, its home until stage 3): the prop is the package's and
  so is the gesture mode that reads the rule, and which app locks its
  canvas stays that app's. `liveCameraOut` is DROPPED in favour of
  `CanvasSurfaceHandle.getLiveCamera()` — one reading of the live camera,
  pulled, where a ref the surface pushes into is a second copy that is
  only as fresh as the last place someone remembered to write it.
  `isHostId` is EXPORTED from `editorSession.ts` rather than the canvas
  asking `sessionHost().items?.isHostId(id) ?? false` at four sites: one
  spelling of "whose id is this" beats four, each with its own `?? false`
  to get wrong.

- **What stage 6 inherits from the canvas.** Three things.

  THE EXTENSION'S SHAPE is now five seams wide and they divide cleanly:
  `tools`, `session`, `outline` and `canvas` are installed RULES at module
  scope, and the per-render data rides as PROPS — the panel's host pages
  on `PanelModelInput`, the canvas's `gestures`, `layers`, `hostTools`,
  `openTrace` and `surfaceHandle` on `CanvasSurface`. Stage 6 does not
  have to decide that line again; it has to decide which side each of the
  shell's remaining props falls on, and the test is the same one: does the
  thing close over state only the shell holds?

  THE PROPS THAT ARE STILL PROPS BECAUSE THE SHELL HOLDS THEIR STATE are
  what stage 6 collapses. `CanvasSurface` takes about sixty, and the ones
  that are there only because the shell is the app's are: the bar
  handlers' outputs (`lineToolMode`, `arcToolMode`, `arrangeMode`,
  `polygonSides`, `colorBlendMode`, `colorBrushOpacity`, `colorScope`,
  `vectorEraser`, `patternSubTool`, `newShapeStyle`, `tileEditPatternId`),
  the format's flags (`patternRegionDrags`, `tileRegionDrags`,
  `frameDropHighlight`, `editableRegion`, `regionChrome`, `forwardArrow`,
  `veiledIds`), the host's callbacks (`onHostPlace`, `onRequestPhoto`,
  `onEditWhileDone`, the long-press family) and `hostTools` and
  `openTrace`, which became props at 5b.3 *because* the shell is the
  app's. When the shell is the package's, every one of those is either its
  own state or a member of the `EditorConfig`/`EditorExtension` — and
  `onHostPlace` is the one §4.3 already names as becoming an extension
  member there.

  THE ONE THING THE CANVAS COULD NOT TAKE is `EditorShell.tsx`'s bar
  HANDLERS (§4.2 item 4): 95 % identical across the apps, every one a
  `useCallback` over the shell's own commit pipeline. The canvas's move is
  the argument that they will fold too — the fear each time was the pin
  churn and the review size, and stage 5b's three ranges came in at
  492–498 KB against the 890 KB a stage-3 range passed at — but the shell
  is the biggest file left and the first mover whose range may genuinely
  not fit. §5's named next step (a pointer bump whose engine range is
  already reviewed treated as cleared) is for that stage and no earlier
  one.

  Stage 6.0 measured both numbers in this paragraph and they hold: the
  handlers are 1,635 lines today (1,670 when item 4 counted them, before
  stage 5 took the canvas's share) and they drift by 56 / 40, which is the
  95 % stated as a count. The shell is 10,077 lines, not 10,682, for the
  same reason. Where 6.0 DIFFERS from this note is the order: it reads
  "they will fold too" as an argument for taking them WITH the shell rather
  than ahead of it, which is what §4.2 item 4 itself concluded — see item 6.

Still open:

- **How `entryStore.ts` carries each app's own entry record** (raised at
  6.2b's measurement, 2026-10-23). 42 of its 68 declarations exist in all
  three apps and a large share are byte-identical, so it is the one file
  left in `web/store/` that moves — but it is generic over a `JournalEntry`
  that is 27 fields in CozyJournal, 18 in Sol and 26 in DrawBots. Most of
  the file never reads a field (key layout, the per-format index, the
  sidecar images, the settings merge), which is what makes several answers
  viable: `EntryStore<TEntry>` on stage 3's
  `EditorSession<TTool, TDoc, TOps>` precedent; an installed entry adapter
  on the session host's; or only the key and index mechanics, with each app
  keeping its own accessors over its own record. The precedent cuts both
  ways and the owner took a third option the last time this question was
  posed (§4.3, `ToolId`), so it is not an agent's to guess. Note also that
  this is the user's stored data: unlike every seam so far, a wrong answer
  here is not a visual regression.

- **Whether `EditorHost.tsx` becomes the package's screen at all** (raised
  at 6.0, 2026-10-23). Item 6 says it does. The measurement says the three
  hosts are not one drifted file but three ROUTE TABLES sharing a skeleton:
  five top-level declarations in all three, four of them trivial, the fifth
  `EditorHost` itself at 812 / 267 / 381 lines with 685 / 745 diff-lines
  and a longest shared run of 33 lines (the shell's is 730). The ~200-line
  state machine inside it IS shared and can move — resolve the query, let a
  `NAVIGATE_TO` override it, hold at the placeholder while warm, mint a
  multi-file page once per session, clear the action screens, mount the
  shell. Each app's ACTIONS cannot: they open that app's own kinds of page.
  So the choices are to move the state machine and leave each app a route
  table over it (which is a real consolidation of about 200 lines three
  times over), or to leave the host alone and let the stage end at the
  shell. An agent should not decide which, because the second shrinks the
  stage as written.

- **The push brush on DrawBots' bar.** Stage 5b put the gesture in the
  canvas DrawBot draws on and left the app-side `DRAWBOT_PAINT_MODES`
  filter standing, so nothing but that one line holds it off (§4.3).
  Turning it on adds a brush to a shipped app's toolbar, which is a
  product decision rather than a consolidation: the line, its use in
  `EditorShell.tsx` and the three assertions in `hostTools.test.ts` stay
  until the owner makes it.

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

**Stage 5b.3 and 5b.4 never came near it either, which settles the
question for stage 5** (2026-10-22). The three ranges at the end of 5b.4:
CozyJournal 498 KB, Sol 492, DrawBot 493, and 5b.4e's own round after
them at 519 / 513 / 514 — the whole of stage 5b in each,
and each inside the 890 KB a stage-3 range passed at. The move folding is
what does it, and the shape is worth naming because it is the opposite of
what was feared: the app ranges holding the DELETION of a 6,000-line canvas
are no larger than Sol's 5a range (452 KB) was holding nothing of the kind,
because `review.js` pairs the file the engine adds with the file the app
deletes and shows it once. The pin churn that was the other half of the
fear came to about a hundred lines per app, and the suites DEDICATED to a
moved file folded with it.

So the next process step — a pointer bump whose engine range is already
reviewed treated as cleared — is STILL not forced, by any part of stage 5,
and neither 5a nor 5b touched `tooling/`. Stage 6 (`EditorShell`, 10,077
lines, and `EditorHost`) is where it may be; it is the one file left that
is bigger than the canvas was.

**Stage 6.1 is nowhere near it** (2026-10-23): CozyJournal's range measures
**75 KB**, Sol's **74** and DrawBot's **70**, against the 890 KB a stage-3
range passed at — the smallest ranges any stage of this plan has produced,
because the sub-stage moves 623 lines and the move folding shows each file
once. Measured with `review.js pending --prompt | wc -c`, which builds the
reviewer's prompt and prints it without starting a reviewer; that is the
way to get this number before the ship pass rather than after it, and it
is worth doing per sub-stage from here on, because 6.5 is the range that
may not fit and the earlier numbers say nothing about it.

**With 6.2a on top** the three ranges are **146 / 150 / 144 KB** — still a
sixth of what a stage-3 range passed at, for two sub-stages and about
1,000 lines moved. Worth noting WHY these stay so small when stage 3's
exploded: a range that moves a file the engine adds and the app deletes
folds to the delta between them, and both sub-stages so far are almost
entirely that. 6.5's range will hold the same kind of move for a
10,000-line file, which is the one that has never been tried.

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
