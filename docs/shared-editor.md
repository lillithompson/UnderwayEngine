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

And the same trees NOW (re-measured 2026-10-26, after 6.5b.5), so
the table above stays the baseline it says it is rather than being
overwritten. `Files` is the UNION of file names across the three apps,
which is what makes a file that only one app has still count once:

| Tree | Files | In all three | Identical in all three | Lines (Sol / DrawBot / Cozy) |
|---|---|---|---|---|
| `web/editor/` (incl. `components/`) | 101 | 26 | 1 | 10,035 / 15,772 / 23,701 |
| `web/editorUi/` | — | — | — | retired at stage 1 |
| `web/formats/` | 49 | 4 | 1 | 282 / 737 / 13,787 |
| `web/store/` | 12 | 6 | 0 | 510 / 1,009 / 2,922 |
| `web/fonts/` | 5 | 5 | 1 | 213 / 233 / 234 |

The file COUNTS have not moved since 6.5a and the lines have, which
is the honest reading of 6.6 and all five slices of 6.5b: every one
took DECLARATIONS, STATEMENTS or JSX out of files that stay — each app
still has an
`editorQuery.ts`, an `EditorHost.tsx` and an `EditorShell.tsx` — where
every sub-stage up to 6.5a took whole files. Measured against each app's
HEAD before 6.6a (Sol 102c61c, DrawBots 308e277, CozyJournal 3dd7cb10),
`web/editor/` went 11,464 → 10,035, 17,198 → 15,772 and 25,143 → 23,701:
**1,429 / 1,426 / 1,442 lines lighter, and not one file lighter** — 30 /
58 / 78 files before and after. A stage that empties files shows up in the
first column; a stage that hollows them out shows up only in the last, and
the rest of stage 6 is the second kind.

Two sub-stages are most of that movement: 6.5b.2 took 415 / 415 / 425,
6.5b.3 took **609 / 609 / 620**, 6.5b.4 took 178 / 179 / 179 and 6.5b.5
took 105 / 105 / 105 — so the first two are 72 % of the six together. That is what slicing a
10,000-line component looks like from here. The file still exists in three
copies.

**And 6.5b.4 is the sub-stage that shows ONLY here, in the last column.**
Its subject — the render tree — is one anonymous `return` statement, so it
moved 286 lines of each app without a single named statement leaving the
body: the statement counts (519 / 448 / 466), the count byte-identical in
all three (224) and the closed set (136 statements in 96 components) are
all exactly what they were before it (6.5b.5 moved them again: 519 → 503
statements in Cozy, and 224 → 209 byte-identical). Three columns of this
table and
every statement-level measure in §4.2 are blind to it. A measure is only
as good as the unit it counts, and the shell has at least three units —
files, statements, lines — of which only the last sees all five sub-stages.

**And at 6.5b.3 the fourth column moved too, for the first time since
6.5a — downwards, which reads backwards until you see why.** Of the
shell's body statements, the count byte-identical in all three apps went
284 → 224: 61 of them left, and the five hook calls that replaced them are
identical in all three but are five statements where sixty-one stood. A
sub-stage that takes shared text out of three files necessarily lowers the
amount of shared text left in them. "Identical in all three" is a measure
of what is still DUPLICATED, so it falling is the point of the exercise,
not a regression in it. 6.5b.4 left it at 224 for the reason above — its
subject was inside one statement — so the figure stands where 6.5b.3 put
it, and the same reading of it applies when 6.5b.5 moves it again.

Four rows' worth of reading, and the second is this stage's. `web/editor/`
has lost 92 of its 193 files and two thirds of its lines — stages 1 to 6 —
and what is LEFT is the drifted part: only ONE of the 101 files is still
identical in all three apps, against 57 of 193 before. 6.5a took the last
of the identical LEAVES; the one file still identical everywhere is
`homeStateDelivery.ts`, which cannot follow them because it imports two of
each app’s own modules (`components/bridgeSchema.ts` and
`components/homeStateDelta.ts`). The consolidation has taken the easy
files; the shell is most of the rest.

`web/formats/` is the tree stage 6 has actually emptied, and the lines are
where to see it: Sol's 1.2 k is 285 and DrawBots' 3.9 k is 740, where at
the start of the stage both were trees of their own. What is left in those
two apps is `types.ts`, `configs/`, and three thin wrappers. CozyJournal's
13.8 k against 16.8 k looks like less progress and is not: nearly all of
its remainder is the modules that are its own games — the social turn, the
rig, the templates, the word scatter, the Today thumbnail, the glyph and
redline targets — none of which any other app has, and
of the four files that still exist in all three apps, one is byte-identical
(`validateConfig.ts`, now the same one-line wrapper in each) and the rest
hold each app's own data.

`web/store/` is 6.2a's four files out and 6.2b's `entryStore.ts` out as
well — the store's shared half is the package's, and the lines here are the
three apps' own records and wrappers over it (the row's 976 / 1.5 k / 3.4 k
was taken before 6.2b landed).
`web/fonts/` is the shape every tree ends up in: five files, ONE identical,
because after 6.1 each app keeps its own DATA plus thin wrappers — and that
one, `faceAsset.ts`, is there because 6.2a's round-1 fix added it to all
three at once. The row said "5 / 4 / 0" and the sentence under it said
"none identical" until this re-measurement: a fix that adds a file breaks a
count, which is the thing item 6's round-2 finding is about, three numbers
at a time.

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

**That number has a direction and a script, and 6.5b.4 was nearly planned
wrong for want of saying so** (2026-10-26). It is `verbatim.js`: difflib's
recursive longest-matching-block over EXACT lines, with the OTHER app's
length as the denominator — "how much of Sol's shell is found in
CozyJournal's". Reverse the direction and the same comparison reads 61 % /
73 %, because CozyJournal's shell is the longest of the three; trim the
lines and count blanks and it reads 55 % / 67 %. None of those is wrong,
and none is comparable with either of the others. **A percentage here is
meaningless without its script and its direction**, and §4.2 item 6's
6.5b.4 entry is what that cost: a figure taken one way was set against a
figure taken the other, and the render tree read as half as shared as the
file it sits in when it is in fact slightly more.

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

From stage 6 it holds the FOUNDATIONS the shell and the host stand on, and
then the first slices of those two screens. The order was measured, not
guessed: the shell's app-side import specifiers cluster into exactly these
trees (§4.2 item 6, 6.0), so each had to become a seam BEFORE the shell
could move rather than after.

· **The fonts** (6.1): `domTextMeasurer.ts`, `loadPackFonts.ts`,
  `glyphInk.ts`, `settleFaces.ts` and `exportFonts.ts`. Each app keeps its
  DATA and the one thing that needs its bundler — `faces.ts`'s require
  table and `registerFonts.ts`'s pack list — and hands the rest in as a
  `FontPack` parameter or installs a face reader (`registerFaceFetch`).
  `PACK_FONTS_STYLE_ID` is one constant now, `underway-pack-fonts`.
· **The store** (6.2a, 6.2b): `store/pageIO.ts`, `store/pageIds.ts`,
  `store/resetData.ts`, `store/assetJanitor.ts`, `store/storeKeys.ts` and
  `store/entryStore.ts` — the key layout, the per-format index, the sidecar
  images and the settings merge, as `EntryStore<TEntry extends
  JournalEntryBase>` over a record it only stores and hands back. Each app
  keeps `types.ts` and `homeState.ts`, which are its own stored record and
  its own home payload, and `createEntry`, the one declaration that reads a
  field only it has.
· **The format layer** (6.3a–6.3d): `formats/editorConfig.ts`'s
  `CommonEditorConfig` — the fields every app's `EditorConfig` extends, with
  an app's extras riding on top — plus the frozen prompt, the issue reader
  (`CommonFormatIssue`), the scaffold vocabulary and `formats/edited.ts`,
  `formats/photoPlaceholder.ts`'s shape. The sentinel's WORD stays each
  app's, built from its own store namespace.
· **The app chrome's palette** (6.4a) and **the host bridge** (6.4b) — the
  latter needing no seam at all, which is the only seam this stage looked
  for and did not find.
· **The shell's siblings** (6.5a): eleven modules and two sheets that sat
  beside `EditorShell.tsx` and imported nothing of any app, `overlayZ.ts`
  among them, with each app binding its own z-order under the old name.
· **The editor query and the host's open path** (6.6a, 6.6b):
  `editorQuery.ts`'s seven byte-identical readers over a key list each app
  supplies, and `hostRoute.ts` — `useEditorQuery` and `useResolvedRoute`,
  the ~200-line state machine behind every app's `EditorHost.tsx`. Each
  app's host is its ROUTE TABLE over it; the state machine is the package's.
· **The shell's own leaves and its first closed clusters** (6.5b.1,
  6.5b.2): `components/ToolbarPushdown.tsx` with its height,
  `colorPickerSpec.ts`'s row type generic over the picker id, and eight
  hooks — `useRadialMenus`, `useEyedropper`, `useImageEdits`,
  `useShapeToolModes`, `usePhotoSource`, `useColorBlendMode`,
  `useColorScope`, `usePatternExcludedFamilies` — 56 statements of state
  and handlers that were byte-identical in all three shells. `framingTarget`
  comes with them, exported and tested, being the one decision among the
  eight rather than plumbing.

`EditorShell.tsx` itself is still each app's, and is most of what is left of
the consolidation: §4.2 item 6 says what remains of it and §4.3 how it is
being sliced.

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

   **Where the stage stands, plainly** (2026-10-26, after 6.5b.5).
   **Stage 6's movable part has moved, and what is left is a judgment rather
   than a slice.** 6.6 is done and all five slices of 6.5b are: two of the
   shell's own leaves, eight closed clusters (465 lines of each app), the
   colour-and-effects complex as five hooks (640), the render tree's
   floating chrome as eight components (286 / 284 / 293), and the two groups
   that would not place, cut at the statement that blocked them (106).

   What is left in the three shells is three things, and none is a slice
   waiting to be taken: the APP-ONLY bucket (82 / 58 / 36 statements, which
   is stage 7's subject and has not moved since 6.5b.2), the render tree's
   FRAME (6.5b.4 measured why it stays), and DUST — 76 singletons and 18
   multi-statement groups whose largest is 43 lines. The singletons are held
   on the owner's standing call; the 18 are the same judgment one size up,
   and 6.5b.5's entry recommends holding them too. **Whether the dust is a
   sub-stage is the last call stage 6 needs.**

   **The queue this sub-stage started from was the clearest in the
   programme, and it is the condition §5 has been asking for since 6.1.**
   The engine was fully pushed (`origin/main` == HEAD == ceec4fc, fetched
   first), Sol was clear, CozyJournal had 3 unpushed review-fix commits and
   DrawBots 1, and — for the first time — no app carried a submodule
   pointer at a commit on no remote branch. So 6.5b.4's own cost is
   measurable on its own: `git diff HEAD~1 HEAD | wc -c` is **28 KB
   (engine) / 69 (CozyJournal) / 64 (Sol) / 70 (DrawBots)**, against
   6.5b.2's 46/73/76/75 and 6.5b.3's 57/107/108/110. The engine's half is
   half of 6.5b.3's because eight small components are less text than five
   hooks of 640 lines; the apps' halves are nearly the same size because
   most of each app's diff is the SUITES, not the shell.

   Nothing was pushed when 6.5b.4 was committed either. The rule is commit
   and stop, and the pointer order (submodule first) is the ship pass's.
   Worth keeping from 6.5b.3's entry, because it cost a wrong report: a
   local `origin/main` that has not been fetched is stale, and reporting
   off it once stated as live a dangling pointer the owner had already
   fixed. **Fetch before reporting on a remote.**

   | Sub-stage | | What it did |
   |---|---|---|
   | 6.0 | done | measured; re-ordered the rest |
   | 6.1 | done | the fonts |
   | 6.2a | done | the page I/O options, the id minter, the reset, the janitor |
   | 6.3a–6.3c | done | the common `EditorConfig`, the frozen prompt, the issue reader |
   | 6.3d | done | the rest of the format layer — the scaffold vocabulary |
   | 6.2b | done | the entry store, over `JournalEntryBase` and a generic |
   | 6.4a | done | the app chrome's palette |
   | 6.4b | done | the host bridge — which needed no seam |
   | 6.5a | done | the shell's siblings: eleven modules and two sheets |
   | 6.6a | done | the editor query's shared half — the host's prerequisite |
   | 6.6b | done | the host's open path; each app keeps its route table |
   | 6.5b.1 | done | two of the shell's own leaves: the pushdown, the picker row |
   | 6.5b.2 | done | eight of the shell's closed clusters, as hooks |
   | 6.5b.3 | done | the colour-and-effects complex — the bar handlers — as five hooks |
   | 6.5b.4 | done | the render tree's floating chrome as eight components |
   | 6.5b.5 | done | the two groups that would not place, cut and moved |

   **Is stage 6 complete? Its movable part is; what is left is one
   JUDGMENT** (2026-10-26, after 6.5b.5). 6.0 through 6.6 are done and so
   are all five slices of 6.5b — the last of them the two groups that would
   not place, cut at the statement that blocked each.

   What is left in the three shells is three things, and the first two are
   settled:

   - **The APP-ONLY bucket** — 82 / 58 / 36 statements. That is stage 7's
     subject, not 6.5b's, and it has not moved since 6.5b.2: every
     statement all five slices took came out of the SHARED bucket, which
     is now five times demonstrated rather than argued.
   - **The render tree's FRAME.** 6.5b.4 measured why it stays: 93–95 %
     shared text, interrupted by forty-odd one-line holes rather than a few
     seam-shaped ones, and the two large liftable-looking regions need 48
     and 42 props.
   - **DUST, and this is the open call.** 121 closed statements / 766 lines
     in 94 components: 76 singletons, held on the owner's standing call
     since 6.5b.1, and 18 multi-statement groups whose largest is now 43
     lines. 6.5b.5 recommends holding the 18 for the same reason as the
     singletons — a 2-statement, 14-line hook costs an import, a call site,
     a return type and a suite entry to save fourteen lines in three files
     — and one of them (`useChromeInsets`) must stay regardless, on the
     native-dependency rule. **Whether the dust is a sub-stage is the last
     call stage 6 needs.**

   What stage 7 inherits is unchanged by all of this (see above), and
   whether it goes next is the owner's call.

   **6.6 came before 6.5b, and the measurement is why.** The plan's order
   was 6.5b then 6.6. 6.6's design was already settled (§4.3, 2026-10-23),
   its subject is closed, and it depends on nothing in the shell — the
   package's hook hands back a route and mounts nothing, so each app's
   host still imports its own shell. 6.5b's is neither settled nor closed,
   as the entry below sets out. Doing the settled one first cost nothing
   and left 6.5b measured on a clear queue.

   **What is left, re-measured 2026-10-25 (before 6.5b.2).**
   `EditorShell.tsx` at 10,013 / 7,431 / 8,520 lines (Cozy / Sol /
   DrawBots). Its body is 624 / 553 / 571 statements, of which 435 are
   declared in all three apps and 340 of those are byte-identical — and
   they do NOT come out as a block: over CozyJournal's order they fall
   into 250 runs, the shared ones in 85 of them. The 6.5b.2+ entry below
   is that measurement in full, and the conclusion it forces is that the
   shell is SLICED, not moved.

   **And after 6.5b.2**, which took 56 of those statements: the file is
   **9,588 / 7,016 / 8,105** and `web/editor/` is 425 / 415 / 415 lines
   lighter (Cozy / Sol / DrawBots) with not one file fewer — the second
   column of §1's table has not moved since 6.5a and the last one has,
   three sub-stages running. The body is now **576 / 505 / 523**
   statements, which is 56 out and EIGHT back in: a hook call is a
   statement too, and `const { … } = useX(…)` reads as one of the
   anonymous ones (59 → 67), so the named count is what fell — 565 → 509.
   Of the named, **284** are still byte-identical in all three: the
   shared statements that did not close, or closed and would not place.

   **And after 6.5b.3**, which took 61 more (the 59 of the colour complex,
   plus `fadeTargetRef` and its sync): the file is **8,968 / 6,407 /
   7,496** — re-measured from each app's HEAD, not carried forward — and
   `web/editor/` is another 620 / 609 / 609 lines lighter with, again, not
   one file fewer. The body is **519 / 448 / 466** statements: 61 out and
   FIVE back in, so 56 net each. Of those, **224** are still
   byte-identical in all three, and the closed set under the four inputs
   is down to **136 statements / 890 lines in 96 components, 76 of them
   singletons** — from 196 / 1,531 / 98 / 77. The largest closed thing
   left in the shell is the 10-statement caret group, and it still does
   not place.

   **What stage 7 inherits, as things stand** (restated 2026-10-26, after
   6.5b.3). **6.5b.3 did not touch what stage 7 is about, and the
   measurement says so rather than assuming it**: the APP-ONLY bucket —
   statements a shell declares that neither other app does — is still
   **82 statements / 1,099 lines** in CozyJournal, 58 / 286 in Sol and
   36 / 267 in DrawBots, the same as before the slice. Two slices of the
   shell have now been taken and every statement in both came out of the
   SHARED bucket, which is the arrangement §4.3 described and is now
   twice-demonstrated rather than argued. The paragraph below stands as
   written.

   (The earlier reading of this paragraph — restated 2026-10-25, after
   6.5b.2.) Stage 7 is the apps' own property pages (CozyJournal's rig:
   `rigEdit.ts`, `RigJointsBar`, `RigPoseBar`, `RigColorBar`), and it
   inherits a question that has nothing to do with them: whether the shell
   moved. It has not, and will not move in one stage — but it is no longer
   standing still either, and 6.5b.2 removed the only reason stage 7 had to
   wait. The two do not contend for the same code: the rig is in the
   app-only bucket, and 6.5b.2 took statements out of the shared one. So the choice stage 7
   faced is now a real one rather than a wait: it is DOABLE today — the rig
   pages are editor-ui's, not the shell's, and 6.5a took the last of their
   shared leaves — and "wait on 6.5b" no longer names a date. Two things
   are true of it now that were not on 2026-10-24. The host is out of the
   way, so `EditorHost.tsx` is no longer a file stage 7 and 6.5b would both
   be editing. And the rig is the second-largest thing standing between the
   shell and the package: of the 82 statements only CozyJournal's shell
   declares, **29 are the rig's** (`rigSliders`, `rigEditable`,
   `openRigPart`, `onRigSlider`, `onRigColor`, `rigSides`, `rigCapsuleUp`
   and twenty-two more) against 36 for its social, response, redline and
   glyph games and 17 for everything else, and 6.5b has to answer for
   every one of them. Taking stage 7 first
   would SHRINK 6.5b rather than reorder it out of turn. That is the
   owner's call and it is on the Still-open list.

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
   session, clear the action screens, mount the shell. An owner's call was
   open on it and is now ANSWERED (§4.3, settled 2026-10-23): the state
   machine moves and each app keeps a route table over it, so the stage as
   written — "the host becomes the package's screen" — is narrowed to the
   part the measurement says is genuinely shared, not abandoned.

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

   **6.3b — Done: the common half of `EditorConfig`** (2026-10-23).
   `CommonEditorConfig` is the package's
   (`packages/editor/src/formats/editorConfig.ts`), with the three leaves
   that exist only for it: `DEFAULT_FRAME_BACKGROUND`, `ShapePropertyPage`
   and `ShapeLock`.

   | | Cozy | Sol | DrawBot |
   |---|---|---|---|
   | `EditorConfig` members | 59 | 23 | 57 |
   | in all three | — | **22** | — |
   | of those, byte-identical in comment AND declaration | — | **21** | — |
   | in Cozy + DrawBots only | 32 | — | 32 |
   | the app's own alone | 5 | **0** | 3 |
   | `web/formats/types.ts` lines, before → after | 1,043 → 463 | 458 → 156 | 1,009 → 418 |

   **This is a move, not a merge, and the 21 is why.** Twenty-one of the
   twenty-two members every app declares were byte-identical in their
   DOC COMMENT as well as their declaration — the same prose about the same
   field, three times. The twenty-second, `canvas`, nested exactly: Sol's
   inside CozyJournal's (which adds `initialFitName` and `symmetryDefault`)
   inside DrawBots' (which adds `hideGridControls`). So DrawBots' is adopted
   as the superset, the way stage 2 took its capsules and 5b.4 took the
   other two apps' canvas additions, and all three of the adopted members
   are OPTIONAL — which is what makes adopting them free for the apps that
   had none. 1,473 lines leave the three apps for 204 in the package.

   **Sol has no field of its own at all**, which is the shape of this tree:
   Sol's config is a 23-member SUBSET, and the 32 members CozyJournal and
   DrawBots share between them are the template, scaffold and completion
   layer. Those stayed in each app at this sub-stage and moved at 6.3d with
   `edited.ts` and `scaffold.ts`, because that is where their types
   (`DoneRefusal`, `MarkScene`, `TemplateBaseline`) come from — the one
   import `web/formats/types.ts` still made of a sibling. 6.3d found all 36
   of the two apps' shared members byte-identical, which is why they came in
   one piece.

   **The four ids are `string` in the package, and §4.3 had already decided
   that.** `formatId`, `tools`, `firstTool` and `contentTools` name unions
   that are each app's own. §4.3's stage-2 ruling on `ToolId` took neither
   option it was posed as, and its reason applies unchanged here: `string`
   for the package's side, because every app's union is assignable going IN,
   rather than a generic `EditorConfig<TTool>` threading a parameter through
   a package that never needs to know WHICH host tool is armed. A config is
   data the app hands in, so it is exactly that case. Each app declares
   `interface EditorConfig extends CommonEditorConfig` and re-narrows the
   four, keeping its own `Record<ToolId, …>` and exhaustive switches; each
   `types.ts` re-exports the three leaves, the `SYSTEM_FAMILY_STACK`
   arrangement of 5a, so none of its importers moved.

   **A gate fact found here that every later sub-stage depends on, and it is
   not what it looks like: `npm run typecheck` in this repo DOES NOT
   typecheck `packages/editor`.** The root `tsconfig.json` excludes
   `packages/editor` and `packages/editor-ui` outright. What typechecks a
   file in either is ts-jest's diagnostics while a SUITE loads it — so a
   package module no suite reaches is typechecked by nothing here at all.
   Verified both ways, which is 5a's standard for a pin: a deliberate
   `const n: number = 'x'` in `store/storeKeys.ts` leaves `npm run
   typecheck` green and fails `npm test` with TS2322. The new
   `editorConfig.test.ts` exists partly to close that gap for this file, and
   says so in its header. Two of its cases earned their place immediately by
   failing on values invented rather than read (`symmetryDefault:
   'mirrorX'`, where `PatternSymmetry` is a ten-boolean record, and
   `ShapeLock.line: 'straight'`, where `LineToolMode` is
   `'line' | 'rectangle'`).

   The suite drives the seam over a made-up app the way `sessionHost.test`
   and 6.1's `loadPackFonts.test` drive theirs: an `AppEditorConfig` with
   three closed unions and a field of its own, whose assignment to
   `CommonEditorConfig` IS the assertion. A derived case holds the package's
   CODE to naming none of `FormatId`, `ToolId` or `ContentMode` while its
   header names all three — the reason lives there, so both halves are
   checked rather than described.

   **One mistake worth recording, because the fix is 6.2a's lesson 2.** The
   script that rewrote the three apps computed "the members all three
   declare" from the working tree, and rewrote Sol first — so the second run
   intersected against the five members Sol had left and kept almost
   everything in the other two apps. It typechecked green, because an
   interface may redeclare an inherited member with an identical type, so
   nothing failed; the text was simply still three copies. Caught by reading
   the result rather than the exit code. The fix was not to hardcode the
   list — that is a scope ASSERTED — but to derive it from each app's git
   HEAD and assert the count it derives.

   **6.3c — Done: the frozen issue** (2026-10-23). `CommonFormatIssue` and
   `readIssuePayload` join `editorConfig.ts`. Both were byte-identical in
   all three apps but for the format id, and this sub-stage exists as a
   PREREQUISITE: `entryStore.ts` names `FormatIssue` in `createEntry` and on
   the stored record, so 6.2b could not move before it.

   The arrangement is the one 6.3b settled, and it is worth naming because
   it cost nothing: each app declares `interface FormatIssue extends
   CommonFormatIssue { formatId: FormatId }`, and the **73 (Cozy) / 15 (Sol)
   / 24 (DrawBots) files that read an issue did not change at all** — they
   import `FormatIssue` from `@/web/formats/types` as they always did and
   get their own closed union. An extension, not a re-export, is what buys
   that; a re-export would have handed all 112 files a `formatId: string`.

   Six cases, and the three that matter are the defensive ones: a payload
   that is a string, a number or `null` reads as an empty partial rather
   than throwing, because every caller destructures the result and the
   payload crossed a JSON freeze/thaw out of the store.

   **6.3d — Done: the rest of the format layer** (2026-10-24). The scaffold a
   format seeds onto a page, the edited rule, the template-node readers, the
   prompt flow, the completion rule, the config validator and the photo
   sentinel are the package's, with the 32 config members and the vocabulary
   they are declared over.

   **It is a MOVE, and here is the measurement that says so.** Between
   CozyJournal's copies and DrawBots':

   | File | Declarations | In both | Byte-identical | What differs |
   |---|---|---|---|---|
   | `scaffold.ts` | 37 / 37 | 36 | **35** | `buildScaffoldEntry`'s tail |
   | `edited.ts` | 27 / 27 | 27 | **24** | `scaffoldNodeCount`, `isEntryEdited`, one comment word |
   | `templateNodes.ts` | 16 / 16 | 16 | **16** | — |
   | `promptFlow.ts` | 7 / 7 | 7 | **7** | — |
   | `completion.ts` | 1 / 1 | 1 | **1** | — |
   | `validateConfig.ts` | 1 / 1 | 1 | **1** | — |
   | the scaffold vocabulary | 176 lines | — | **176 lines** | — |
   | `EditorConfig` members | 41 / 39 | 36 | **36** | — |

   Eighty-one declarations, seventy-eight of them the same bytes. And the
   config row is the one that decided the sub-stage's SIZE: 6.3b had counted
   32 members as "CozyJournal and DrawBots only" and left them for later, and
   **all 36 of the two apps' shared members turn out to be byte-identical in
   doc comment as well as declaration** — so the 32 come here now as
   `ScaffoldEditorConfig extends CommonEditorConfig` with nothing to merge,
   rather than being paid for twice. (6.3b's table says CozyJournal has 4
   members of its own where it has 5 — `openingColorIsPersonal`,
   `bornWithRig`, `rigTool`, `wordTool`, `wordStickers`; 22 + 32 + 4 is 58
   and that row's own total is 59. Corrected above and in that table.)

   **Why it is one sub-stage and not two.** `scaffold.ts`, `edited.ts` and
   `templateNodes.ts` are strongly connected — `scaffold` takes
   `TemplateBaseline` from `edited`, `edited` takes the mask readers from
   `templateNodes`, `templateNodes` takes `decorIdOfNode` from `scaffold` —
   so they cannot be split, and the scaffold vocabulary has to precede all
   three. That is 1,900 of CozyJournal's lines in one piece; `completion`,
   `promptFlow` and `validateConfig` are 268 more over the same seams, and
   making them a 6.3e would buy a second review round for them and nothing
   else.

   **Three seams, and the first is the only drift the two big files had.**

   · `ScaffoldFurniture` (`formats/scaffold.ts`) — what an app's own formats
     arrive HOLDING beyond their slots, their frame and their decor texts.
     CozyJournal has two kinds and nobody else has any: Adrift's word tiles,
     scattered clear of the frame, and Poise's T-posed Figgie rig with its
     hidden pose record. ONE rule with three members — `build`, `count`,
     `touched` — because the three questions are one question asked three
     ways: what the furniture puts on a fresh page, how many nodes that is
     (the edited rule's threshold), and whether the user has touched any of
     it. Floating a sticker into the mask and posing the rig both add no node
     and edit no slot, so each needs its own test, and an app that answered
     one without the others would have a page counting its own furniture as
     the user's work. Every member is used, so dropping one fails this
     package's compile. Installed at module scope rather than handed in:
     `buildScaffoldEntry` has 56 call sites across the two apps and their
     suites and takes no context object — the `registerFaceFetch` case of
     6.1, not the `FontPack` one. Nothing installed means no furniture,
     which is the honest fallback: a format with no stickers and no rig
     seeds none either way. The register carries ONE cast, in the package,
     with the invariant stated — the config every scaffold call is made with
     is the config of the app that installed the rule, there being one app
     per page, which is what `registerStoreNamespace` already rests on. That
     is what keeps each app's own rule free of casts, and it is the same
     asymmetry §4.3 settled for `ToolId` at stage 2 and 6.3b for the config's
     ids.
   · the PHOTO SENTINEL — `cozy:` / `sol:` / `drawbots:photo-placeholder` in
     three otherwise byte-identical files. It comes through `storeKey()`
     rather than becoming a second install, and the reason is a fact the
     file's own comment had been carrying all along: **the blob store keys
     blobs BY `imageId`** (each app's `persistence.ts`), so this id is a key
     under the app's namespace exactly like the entry's and the thumb's. It
     is the sixth prefix 6.2a promised would come through the builder, and
     routing it there removes a seam rather than adding one — each app's
     `storeNamespace.test.ts` lost a file from its derived list, which is
     that pin working rather than weakening. A FUNCTION, not a constant, for
     the reason `assetJanitor` reads its stamp's key at each use: the app's
     install and this module's load are both module-scope effects and their
     order is the bundler's. Each app's own `photoPlaceholder.ts` captures it
     into the constant its screens have always imported, after importing its
     `web/store/storeNamespace` for the side effect — so the order is that
     one file's to guarantee, once, where it can be read.
   · `registerMultiFileFormats` (`formats/formatIds.ts`) — `isMultiFileFormat`
     was byte-identical in all three apps while each `MULTI_FILE_FORMATS` set
     was its own, so the SET is installed and the question is asked in the
     package. `entryCloseAction` is why this exists at all: it reads that
     predicate, and without it that declaration could not have moved.
     6.2b's `isAlwaysDoneFormat` is the same shape over the same tree and
     joins this file. Unlike the store's namespace it does NOT throw when
     nothing is installed — an app with no multi-file formats is a real
     answer, and 6.2a's asymmetry does not arise: a wrong answer here files
     a page the user can still see and open.

   **Two things could not come, and an app had been carrying each one dead.**

   · `isPreMaskAdriftPage` compares against `'magneticPoetry'`, so it is
     CozyJournal's (`web/formats/adriftRelic.ts`). DrawBots carried the
     function dead in a file byte-identical to CozyJournal's, and **six cases
     of its own suite drove it over `'magneticPoetry'` and `'haiku'`** —
     format ids that app has never had — passing because the function takes a
     string. The relic and its cases are CozyJournal's now, which is what
     makes that impossible again.
   · Sol's `isEntryEdited`. Seven of Sol's eight `edited.ts` declarations
     were CozyJournal's text with "page" read as "canvas" and are the
     package's; the eighth stays, because the QUESTION differs. A Sol canvas
     opens blank, so there is nothing to subtract and the answer is simply
     whether anything is on it, where the package's takes a scaffold — and a
     `ScaffoldEditorConfig`, which Sol's config is not, so it cannot be
     called there at all rather than being called with nothing to say.
     Sol's `MarkScene` was `unknown[]` where CozyJournal's is typed, and
     adopting the package's is §4.3's canonical rule doing what it says.

   **`validateEditorConfig` takes the scaffold half as a `Partial`, and that
   is what lets ONE function serve three apps.** Sol's copy was these checks
   with every scaffold one deleted — 37 lines against 129, byte-identical in
   the other two — and optional members make those checks VACUOUS on a
   config that declares none of the layer rather than absent. Nothing is
   weakened where the layer IS declared: there the members are required by
   the app's own interface, so a misspelt `scaffold` fails where the config
   is written. The host-tool registry is a parameter, the way
   `deadContentModes` already took it, and each app keeps a one-line wrapper
   passing its own — which is the only rule whose answer depends on which
   tools ride the content row, and the only thing left in each app's suite.

   **An uncounted prerequisite, the shape 6.0 found for the shell.**
   `edited.ts` needs `fnv1a32`, and `seededRandom.ts` was two copies of one
   48-line file — CozyJournal's `web/content/`, DrawBots' `web/formats/` —
   differing by a two-line header. It is **the engine's** now
   (`packages/engine/src/seededRandom.ts`) rather than the editor package's:
   it is pure 32-bit arithmetic with no editor concept in it, DrawBots'
   simulation imports it, and the engine is the one package `npm run
   typecheck` actually covers. Each app keeps a re-export, because the
   module's leaf-ness is load-bearing in CozyJournal (the dailyContent ↔
   squiggle require cycle its header describes) and a re-export is a leaf
   too. That also let `store/pageIds.ts` stop carrying a private THIRD
   spelling of FNV-1a: the two formulations were verified equal before the
   fold (shift-adds against `Math.imul`, both × 16777619 in 32-bit space),
   and `pageIds.test.ts` now pins two collage page ids as LITERALS — every
   collage page an installed app has filed is NAMED by that function, and
   its four determinism cases would have passed straight through a changed
   hash.

   **Each app's suites now run with its store namespace installed**
   (`jest.setup.ts`, new in CozyJournal and Sol, extended in DrawBots). It
   says the true thing once instead of in every suite that reaches a key: in
   an app a namespace is always installed before any key is built. 6.2a's one
   built key was reached only through each app's own `assetJanitor.ts`, which
   imports the install for its side effect; the photo sentinel is read by the
   PACKAGE's scaffold, so a suite can now reach a key without loading a
   module of the app's store at all. It cost one thing and the precedent was
   already there: `storeKeys.test.ts`'s "with no app installed" describe
   clears its own install, the way Sol's `extension.ts` setup file already
   made three engine suites clear their own hosts.

   **The install's reachability is the thing an installed seam gets wrong,
   and it is now derived rather than described.** The furniture seam has a
   fallback — "no furniture" — which is the right answer for two apps of
   three and a SILENT wrong one for CozyJournal: a page would arrive without
   its word bank or its rig and nothing would fail. Three things followed
   from measuring instead of assuming where the install is reached from:
   · The app's `web/formats/types.ts` is NOT a reliable hub. It looked like
     one — every formats module imports it — but `configs/patchwork.ts`
     imports only TYPES from it, which are erased, and `resetPageAsk.ts`
     imports nothing from it at all. Verified against the code rather than
     reasoned from the shape, which is item 5's lesson.
   · So the install lives in the CONFIG MODULES that declare the member:
     `configs/poser.ts` and `configs/magneticPoetry.ts` import
     `web/formats/scaffoldFurniture` for the side effect. The invariant is
     exact and local — a config that says `bornWithRig: true` is the thing
     that needs the rig seeded, so the module that says it is the module
     that makes the seeder exist. That one change took eighteen failing
     suites to one.

     This list said `configs/comic.ts` too until CozyJournal's review round
     after 6.5a, and that was wrong: a comic frame is born BLANK — the
     `bornWithRig` it used to carry was furniture in the way — so the
     install there was inert, and the derived case below never reached it to
     say so. An install on a module that declares nothing is not a
     harmless extra: it reads as the invariant holding where it does not.
   · And `scaffoldFurniture.test.ts`'s last case DERIVES the rest: it walks
     `web/`, `components/` and `app/`, collects every module that declares
     `bornWithRig` or `wordStickers` on a config, and fails if one of them
     cannot reach the install. It found `pageTemplate.test.ts` on its first
     run, which reached the install only transitively. Verified both ways,
     and with a floor on the count it checks so a pattern that stopped
     matching could not pass over nothing.

   **Suites split as every stage since 3 has split them, and the trims are
   6.2a's lesson applied before a reviewer had to ask.** The behaviour halves
   are the package's, driven over a made-up app with a closed format id of
   its own (`test-utils`' `makeScaffoldConfig`), the way `editorConfig.test`
   and 6.1's `loadPackFonts.test` drive theirs. What each app keeps is the
   half that cannot be made up:

   · `completion.test.ts` and `promptFlow.test.ts` were byte-identical in the
     two apps and named nothing of either beyond the `EditorConfig` type, so
     they are DELETED rather than left as copies — which is precisely what
     6.2a found twice with the janitor's suite, "copied, not moved, in two
     apps of three", and what both apps' jest roots make invisible: the
     package's copy runs in them anyway.
   · `scaffold.test.ts` keeps three cases in each app, and only three: the
     ones that read that app's own `EditorShell.tsx`. That is 6.3a's split
     rule — "only the Crop-bar pair reads the app's `EditorShell.tsx`, and
     that is what each app keeps".
   · `edited.test.ts` keeps the half driven by the REAL configs, which is the
     point of it: that a freshly opened page of each shipped format reads as
     uninitialized is a fact about those configs, and a fixture scaffold
     could agree while the shipped one seeds an extra node.
   · `templateNodes.test.ts` is DrawBots' deleted and CozyJournal's reduced
     to `adriftRelic.test.ts`.
   · `photoPlaceholder.test.ts` was byte-identical in ALL THREE apps and so
     pinned the sentinel's spelling in NONE of them — the one value in the
     file that can never change, since it is in every page every installed
     copy of each app has ever saved. Each app's is now that pin and nothing
     else.

   Two coverage gaps closed on the way, both of the `pageIds.ts` kind (6.2a:
   a file whose rules were covered only incidentally). `seededRandom.ts` had
   no suite in either app that carried it — a shuffle that stopped being
   deterministic changes what every device generates for a given day without
   failing anything that reads the result — and now has thirteen cases with
   its persisted values pinned as literals. And `imageFraming`'s sibling
   problem: `formats/edited.ts`'s `printedFillSignatures`,
   `templateBaselineOf` and `doneRefusal` were exercised only through
   CozyJournal's real configs, so Sol and DrawBots tested them not at all.

   One mistake worth recording, and it is the measurement one again. Three
   of the new package suite's cases were written from what the code looked
   like rather than from what it does: a `patternFill` seed arrives PRINTED
   (`seedPatternFill` floods it), `sceneNodeIds` walks the kinds in a fixed
   order rather than sorting, and `isEntryEdited` over an empty scaffold
   reads a seeded shape as the user's. All three failed on the first run and
   all three were the test being wrong, not the code — which is the benign
   direction, and the reason to write the case before trusting the reading.

   Editor package 81 suites / 1,581 tests; engine 384 of 385 (cameraRoll's
   host dependency, as before) / 7,061. CozyJournal 658 / 10,745; Sol 280 /
   3,368; DrawBot 541 / 9,328. Sol is three cases down and that is the trim:
   its validator's generic per-rule cases are the package's now.

   **6.2b — Done: the entry store** (2026-10-24). `entryStore.ts`'s shared
   half is the package's, over the base record and the generic §4.3 settled,
   with the four readers of a stored entry that all three apps had.

   | | Cozy | Sol | DrawBot |
   |---|---|---|---|
   | `entryStore.ts` declarations | 67 | 42 | 44 |
   | in all three | — | **41** | — |
   | of those, byte-identical | — | **20** | — |
   | in both Cozy and DrawBots | 44 | — | 44 |
   | of those, byte-identical | **33** | — | — |
   | `JournalEntry` fields | 27 | 18 | 26 |
   | in all three | — | **18** | — |
   | `entryStore.ts` lines, before → after | 874 → 510 | 483 → 127 | 564 → 204 |
   | `store/types.ts` lines, before → after | 664 → 546 | 215 → 101 | 256 → 135 |

   **The records nest exactly, which is what makes one base serve them:**
   Sol's 18 ⊂ DrawBots' 26 ⊂ CozyJournal's 27, the shape 6.3b found for
   `canvas` and 6.3b's own nesting of the config. 13 of the 18 were
   byte-identical in all three and **the other five differ in a doc comment
   only** — each naming that app's own home-list model — so the text is
   CozyJournal's with the app-specific names generalised, which this time
   meant actually doing it rather than claiming it (the header said
   "generalised" before the pass that generalised them, and the claim was
   caught by re-reading rather than by a gate).

   **A FACTORY, not a module of free functions, and the reason is the call
   sites.** `EntryStore<TEntry extends JournalEntryBase>` is a type, so the
   store is `createEntryStore<JournalEntry, AppSettings>()` and each app's
   `web/store/entryStore.ts` binds its two types ONCE and re-exports the
   members under the names its callers have always imported — 37 / 20 / 38
   importing files, none of which moved. Free generic functions would have
   made each of those 95 files name the type at every call.

   **Four declarations stay each app's, three of them for one reason.** A
   declaration that reads a field outside the base cannot be generic over it:
   `createEntry` is the one §4.3 names (`pageId`, `unlisted`), and
   `setEntrySeededFills` and `setEntryTitle` are the other two.
   **§4.3's answer said "`createEntry` alone" and that was one short of
   right** — not because the count was wrong but because of what it was taken
   over: the 41 declarations ALL THREE apps had, and those two are in only
   CozyJournal's and DrawBots'. The fourth, `createEntryIfMissing`, stays for
   a different reason: it reads no field of its own, it CALLS `createEntry`.
   All four are a handful of lines over `patchEntryMeta`, `mutateEntry`,
   `readEntryMeta`, `writeImageMeta`, `upsertEntry` and `asRead`, which the
   store exposes for exactly that.

   **6.2a's promise is kept: the five prefixes come through `storeKey()`**,
   and so do CozyJournal's own four (`cozy:today:`, `cozy:reveal:`,
   `cozy:series:doodle`, `cozy:collage:`). **No file in any of the three apps
   declares a namespaced constant for a stored KEY any more** — each app's
   `storeNamespace.test.ts` lost its `entryStore.ts` entry, which is the
   derived pin working rather than weakening, and what the scan still finds
   is the bridge's event names, which the native side listens for and nothing
   in the package builds. The three module headers and the three codebase
   maps now say that instead of "the store's come through at 6.2b".

   **Three seams, and the first of them is a correction to how this plan has
   been building seams.**

   · **`alwaysDoneFormats` is a REQUIRED OPTION, not an installed set**, and
     6.2b found out the hard way why that matters. `isAlwaysDoneFormat` was
     byte-identical in all three apps over three different sets, so it went
     into `formats/formatIds.ts` beside 6.3d's `isMultiFileFormat` as an
     install — and every one of Sol's always-done cases failed, because its
     `entryStore.test.ts` imports only TYPES from `@/web/formats/types` and
     a type-only import is ERASED: the module never loaded, so the install
     never ran. The fallback was silent and in the user's data — a page
     filed `new` that every reader should see as `done`. So the store takes
     the set, the compiler requires it, and no convention is relied on.
     `formatIds.ts` keeps both predicates for the apps' own callers.
   · `combineSettings` — what a settings WRITE stores, `{ ...stored,
     ...patch }` when absent, which is Sol's whole behaviour. CozyJournal's
     and DrawBots' is not: their games list is reconciled against the
     formats the build offers before the patch lands, and `knownFormats` is
     only ever stamped together with the list it describes. That is a fact
     about those apps' format sets, so it is handed in. `mergeSettings` is
     required for the same reason the namespace is: the defaults are the
     app's and the store cannot guess them.
   · `sidecars` and `listableFormat` — the extra binary sidecars an app keys
     by entry id (CozyJournal's Today cutout and seed reveal), so
     `clearEntryImages` drops them with the rest and `sidecarPresence` can
     be asked about them; and whether a format's index belongs in the union
     a formatless list reads, which is DrawBots' scratch rule — a look page
     is no file and is listed only when asked for by name.

   **What STAYED, as the 6.2b measurement said it would:** `types.ts` (each
   app's own record and its format vocabulary) and `homeState.ts` (each app's
   own home payload). And one thing the measurement had not weighed: the 8
   fields CozyJournal and DrawBots share beyond the 18 (`unlisted`, `flat`,
   `pageId`, `syncedAt`, `baseEditedAt`, `templateBaseline`, `seededFills`,
   `title`), 23 of DrawBots' 26 being byte-identical to CozyJournal's. They
   stayed, deliberately: they are not one concept to name — half are about
   SHARING a page, two are the format layer's — and putting them in the base
   would hand Sol eight fields it never writes, which is the opposite of what
   a base record is for. `templateBaseline` and `seededFills` are stage 7's,
   with the property pages.

   **Suites: the behaviour half is the package's, driven over a made-up app
   with a record field of its own, and the trim is 6.2a's lesson again.**
   Eight describes left each app — the CRUD, the index and its staleness, the
   listing and its order, the status transitions, the image writes and the
   stamp they move, the freshness pair, the imported-page guard, the ULID
   rules — because they were the same behaviour verified three times through
   three bindings, which both apps' jest roots then ran a fourth time as the
   package's. What each app keeps is what only it can say: its real format
   ids through the always-done rule, its own settings defaults and the write
   it reconciles, its own `createEntry` and the three declarations round it,
   and (CozyJournal) its branch and fork entries, its page naming, its series
   week and its collage.

   Two coverage gaps closed, both the `pageIds.ts` kind (6.2a: a rule covered
   only incidentally).

   · The four readers of a stored entry had no suite of their own in any
     app — `dayStartMs`, `isIssuedEntry`, `inImageWindow`,
     `entryImagesBehindPage`, tested through whichever home payload happened
     to call them. `entryRecord.test.ts` is theirs, and writing it turned up
     an asymmetry worth a case of its own: a page SAVED with no images drawn
     at all reads as behind, because an absent `imagesAt` is read as zero —
     work owed rather than nothing to do.
   · And the always-done rule's own edge: `markNotDone` on such a page
     returns `in_progress` and leaves `in_progress` ON DISK, and only the
     next read turns it back to `done`. Three apps' suites asserted the read
     and none the write, so "what is on disk agrees with what every read
     gives back" was true of `upsertEntry` and not of this path. Both halves
     are pinned now, with the reason beside them.

   Editor package 83 suites / 1,642 tests; engine 386 of 387 (cameraRoll's
   host dependency, as before) / 7,121. CozyJournal 660 / 10,766; Sol 280 /
   3,331; DrawBot 543 / 9,350.

   The arithmetic of those three is worth a line, since a move's usually is.
   Each app's OWN cases fall by 39 / 37 / 38 — the trim above — and
   CozyJournal's and DrawBots' totals nonetheless RISE, because their jest
   roots include this package and they now run the 60 cases of the two new
   suites as well. Sol's do not (its roots are `scripts/`, `web/` and
   `components/` only, as 6.3a recorded), so Sol's total is the trim alone.

   **6.4a — Done: the app chrome's palette** (2026-10-24).
   `components/theme.ts` was ONE palette written out three times, and the
   measurement is the flattest in this plan:

   | | Cozy | Sol | DrawBot |
   |---|---|---|---|
   | `components/theme.ts` declarations | 83 | 80 | 77 |
   | in all three | — | **69** | — |
   | byte-identical in all three | — | **60** | — |
   | identical in CODE, differing in a doc comment | — | **9** | — |
   | genuinely drifted | — | **0** | — |
   | lines, before → after | 973 → 478 | 604 → 136 | 715 → 217 |

   **Not one value disagreed.** The nine were each app's doc comment naming
   its own screens — "the Journal" against "the Notebook",
   `components/todayModel` against `components/notebookModel` — over the same
   hex, the same spacing, the same font name. So
   `packages/editor-ui/src/appTheme.ts` is the APP chrome's palette: the
   ground under a screen, the inks, the fonts, the spacing, the radii, the
   gradients, the CTA, the floating nav, and the fill/ink helpers over them.

   **It is editor-ui's rather than `packages/editor`'s, and that is the
   interesting call.** There was already a `theme.ts` there — the EDITOR
   chrome's palette, shared since stage 1 — and two of the three apps already
   derived `BG_EDITOR_CANVAS` and `CANVAS_HAIRLINE` from it rather than
   restating them. The app chrome's palette belongs beside it for the same
   reason: both sides of an app read it. The WebView's editor reads the inks
   (a text placeholder's hint grey) and the native navigation shell reads the
   lot, so it has to be importable from a bundle that holds no WebView code,
   which is what editor-ui already is.

   The suite's last case holds the SPLIT itself — no editor token in the
   app's half, no app token in the editor's — because a token in the wrong
   half is a token two palettes will drift on, and nothing but text can see
   where a declaration lives.

   **`perceivedLuma` went to the ENGINE, and a source pin is what decided
   it.** It is the one import `appTheme.ts` has, byte-identical in all three
   apps at 24 lines, and it went into editor-ui beside the palette first —
   where **DrawBots' `web/simRender/__tests__/sourcePin.test.ts` failed at
   once**: that app holds its sim render layer to engine imports only
   (`DrawBots.md`, "Simulation layer"), and `editor-ui` is on the pin's
   forbidden list. So it is `@/engine/perceivedLuma`, which is 6.3d's
   `seededRandom` call made for the same reason — arithmetic with no editor
   concept in it, in the one package `npm run typecheck` actually covers.
   Worth recording as the good case: a LAYERING rule enforced by a check
   caught a placement a reviewer would have had to catch by reading.

   **Two helpers that were private in every app are exported here**,
   `clamp01` and `hexToRgb`, because each app's own tint code builds on them.
   The split is what made them part of the shared surface; they were already
   shared, just not sayable. (A re-export serves a module's importers and not
   its own code, which is the thing to remember when a file is split in two:
   each app's `components/theme.ts` imports what its own declarations read
   and re-exports the rest.)

   **One drift closed on §4.3's rule.** Sol DECLARED `BG_EDITOR_CANVAS` and
   `HAIRLINE` where CozyJournal and DrawBots derive them from editor-ui's own
   theme — so Sol's chrome could drift from the canvas it sits on. Sol takes
   the derivation.

   **`formats/textPlaceholder.ts` comes with it**, which 6.3d deferred for
   exactly this: its hint colour reads `INK_HINT`, which had no home outside
   the apps until now. Byte-identical in CozyJournal's and DrawBots' copies;
   Sol had the two constants and not the colour, and ships it unused.

   What each app keeps is its own: CozyJournal's per-format card tints and
   format identities, DrawBots' tint table and social mark, Sol's pen
   palette, strain colours and socket inks — and each app's brand gradient
   stops, which are the three values that genuinely differ.

   Every pin that read the palette as SOURCE TEXT reads both halves now,
   through one helper per app
   (`components/__tests__/themeSource.test-utils.ts`). Reading one half would
   pass or fail by where a token happens to live rather than by whether it is
   declared at all, which is not what any of those pins is about.

   One re-point missed on the first pass and worth the line, because it is
   6.2a's round-1 lesson again: `textPlaceholder`'s importers were swept for
   `@/web/formats/textPlaceholder` and two of CozyJournal's modules spell it
   `./textPlaceholder`. **A sweep is only as wide as the spelling it greps
   for** — the typecheck caught it, which is what a derived sweep is for.

   Editor package 83 suites; editor-ui 46 / 740; engine 387 of 388
   (cameraRoll's host dependency, as before) / 7,138. CozyJournal 661 /
   10,783; Sol 280 / 3,331; DrawBot 544 / 9,364.

   **6.4b — Done: the host bridge, and it needs no seam** (2026-10-24). This
   sub-stage was budgeted as a design — "the HostBridge seam" — and the
   measurement says there is nothing to design. That is the finding, and it
   is worth as much as a seam would have been.

   **What the three shells actually do with the bridge**, counted at every
   call site:

   | Call | Cozy | Sol | DrawBot |
   |---|---|---|---|
   | `isInWebView()` | 12 | 4 | 4 |
   | `triggerHaptic()` | 5 | 8 | 4 |
   | `postAppEvent(APP_EVENT_NAVIGATE, …)` | 7 | 1 | — |
   | `postAppEvent(APP_EVENT_TELEMETRY, …)` | 1 | — | 1 |
   | `postAppEvent` / `onAppEvent` on a SEND or SOCIAL channel | 10 | — | — |

   **The two calls all three shells make are already the package's**
   (`@/native-shell/bridge/webBridge`, since stage 1): `isInWebView` and
   `triggerHaptic` take no app vocabulary and need nothing. Everything else
   is one app's — ten of CozyJournal's bridge calls are its Response,
   Redline, Glyph and social channels, and Sol and DrawBot have one event
   each between them.

   So the bridge traffic does not become a seam of its own; it rides the
   app's `EditorExtension` the way `onHostPlace` does (§4.3), or stays an
   app-side prop, and 6.5b decides which per callback by §4.3's own test:
   does the thing close over state only the shell holds? An event NAME and a
   payload shape close over nothing of the shell's. **Inventing a
   `HostBridge` with a `homeStateEvent` and a `navigateEvent` on it would
   have been the mistake 6.0 warned about in the other direction — a seam
   built before its consumer moved, which the consumer then deletes.**

   What the sub-stage DID move is the three `components/` leaves the shells
   read beside the bridge, which are prerequisites either way:

   | File | Lines | In all three | Home |
   |---|---|---|---|
   | `imageDataUri.ts` | 28 | byte-identical but one doc path | `@/engine/imageDataUri` |
   | `omitKeys.ts` | 14 | **byte-identical** | `@/engine/omitKeys` |
   | `openTrace.ts` | 109 | byte-identical but one doc path | `@/native-shell/openTrace` |

   The homes follow 6.4a's rule, which a source pin set: arithmetic with no
   editor concept goes to the ENGINE, and `openTrace` goes to the SHELL
   package because it already imported `@/native-shell/profiling` and
   because its whole point is that both sides of an app record into one
   module. `OpenMark` and `OpenTracePayload` came with it out of each app's
   `bridgeSchema.ts` — the declarations were identical in all three, only
   `OpenMark`'s comment differing — and each schema re-exports them, so
   nothing that reads a mark moved.

   `openTrace`'s suite SPLIT, and the split is the file's own shape: the
   recorder, the table and what crosses the bridge are the package's (the
   three describes were byte-identical in the two apps that had them), and
   each app keeps "the wiring", which reads its own components and router
   screens for the marks they record. `imageDataUri`'s and `omitKeys`'
   suites were byte-identical in every app that had them and moved whole.

   **One dead import, in all three shells.** Every `EditorShell.tsx`
   imported `APP_EVENT_HOME_STATE` and used it nowhere — invisible in the
   apps, whose tsconfig does not set `noUnusedLocals`, and the third such
   find of the stage after 6.1's `TextStyle` and 5a's two. Dropped.

   **And the sweep lesson for the third time, now with the remedy.**
   `textPlaceholder`'s re-point at 6.4a missed `./textPlaceholder`; this
   sub-stage's first sweep for the three leaves missed
   `'../imageDataUri'`; and the sweep written WIDE enough to catch that
   then over-matched, rewriting `'./openTrace'` inside `web/editor/` — which
   is each app's own PAGE-side trace module, not the recorder, and the
   typecheck caught it in six files. A re-point sweep has to match the
   module's identity, not its name: a pattern narrower than the spellings in
   use misses, and one wider than the module's own path hits a namesake.
   What makes it safe either way is that both failures are compile errors.

   CozyJournal 659 suites / 10,768 tests; Sol 278 / 3,324; DrawBot 543 /
   9,349; engine 390 of 391 (cameraRoll's host dependency, as before) /
   7,153.

   **6.5a — Done: the shell's siblings** (2026-10-24). The modules and rows
   `EditorShell.tsx` reaches for from beside it, moved ahead of the shell
   itself so 6.5b has one import surface to re-point rather than two jobs at
   once.

   **Measured over the three apps' HEAD**, declaration by declaration:

   | File | Cozy | Sol | DrawBot | decls in all 3 | identical | the drift |
   |---|---|---|---|---|---|---|
   | `fontStacks.ts` | 23 | 23 | 23 | 3 of 3 | **3** | — |
   | `multiSelectionCapsule.ts` | 60 | 60 | 60 | 3 of 3 | **3** | — |
   | `editorNotice.ts` | 54 | 57 | 54 | 6 of 6 | 5 | `useEditorNotice`: Sol's `quiet` |
   | `gridLevel.ts` | 62 | 62 | 83 | 5 of 7 | **5** | — (DrawBots adds 2) |
   | `overlayZ.ts` | 62 | 46 | 78 | 6 of 11 | **6** | — (Cozy + DrawBots share 2 more; DrawBots adds 3) |
   | `propertiesPanelVisibility.ts` | 100 | 27 | 30 | 1 of 2 | **1** | — (Cozy adds `rigTurnSliderVisible`) |
   | `arrangeRotate.ts` | 81 | 75 | 131 | 5 of 9 | 4 | `rotateSliderTargets`, **32 / 27 / 27** |
   | `components/ShapePickerModal.tsx` | 101 | 101 | 101 | — | whole file but one doc path | |
   | `components/SymmetryModal.tsx` | 103 | 103 | 103 | — | whole file but one doc word | |
   | `components/symmetryModalMeta.ts` | 27 | 27 | 27 | 1 of 1 | **1** | — |
   | `components/BrushColorRow.tsx` | 79 | 79 | 80 | — | whole file but DrawBots' named track width | |
   | `components/EditorNotice.tsx` | 88 | 88 | 88 | — | **byte-identical** | |
   | `components/ArrangeRotateSlider.tsx` | 110 | 110 | 110 | — | **byte-identical** | |

   Nine of the thirteen moved WHOLE. Four split into a shared base and each
   app's own over a re-export, the `CommonEditorConfig` arrangement of 6.3b
   applied to leaves: `overlayZ` (eight layers shared, DrawBots keeping its
   size ask, its look-page Done and its ready-looks row),
   `propertiesPanelVisibility` (CozyJournal keeping `rigTurnSliderVisible`,
   a question only an app with a rig can ask), `gridLevel` (DrawBots keeping
   the ONE level it works at and the rule that HOLDS a page there) and
   `arrangeRotate` — which is the sub-stage's finding.

   **`rotateSliderTargets` is not a three-app declaration, and I built a
   seam before I knew that.** The first measurement said four of the five
   were byte-identical and the fifth drifted in ONE condition — CozyJournal
   excluding its rig, whose turn is a yaw about the axis the viewer sees as
   vertical and not a free angle on a bbox. That is true of CozyJournal
   against Sol and false of DrawBots, whose version takes a `SimSession`
   with a `hostDoc`, lets a bot ride a multi-selection, and seats the row on
   one bot's heading read from up. I had already moved the function behind a
   module-scope `RotateExclusion` registry when two gates said so: the
   typecheck refused the install itself (CozyJournal's `rigById` returns
   `RigOnPage | null`, and the seam declared a predicate), and DrawBots'
   `botRotate.test.ts` returned `null` for all three of its bot cases. The
   seam is **gone**. A registry installed by one app, to share one 27-line
   function with one other app, while the third keeps its own copy anyway,
   is machinery that does not pay for itself — 6.2a's rule about wrappers,
   read the other way round. So the package holds the four that were the
   same, and all three apps declare their own `rotateSliderTargets` over
   them, as DrawBots' module already did for its other four declarations.

   The lesson is not "measure more", which the stage already says. It is
   that a seam is a claim about the OTHER apps, and the measurement that
   licenses it has to cover every app, not the pair that prompted it.

   **The gate fact bit the other way this time.** `packages/editor` is
   excluded from the engine's root `tsconfig.json`, so a file there is
   typechecked only while a suite loads it — and not one of the eleven
   package modules this sub-stage created had a suite. Eight added
   (`fontStacks`, `multiSelectionCapsule`, `editorNotice`, `gridLevel`,
   `overlayZ`, `propertiesPanelVisibility`, `arrangeRotate`, and
   `editorModals` for the sheets' icon table), 89 cases. The practice there
   is measured, not assumed: of the five existing suites that reach into
   `components/`, every one names a `.ts` module and none imports a
   component — a `.tsx` cannot be imported in the engine's jest, whose
   react-native shim carries only the members the engine itself touches (no
   `Animated`, no `StyleSheet`) and whose JSX setting makes a component's
   own `import React` read as unused. So the six `.tsx` rows are read as
   SOURCE in the package's suites and typechecked where real react-native
   is: the three apps. That is the standing arrangement for every other
   component in `packages/editor/src/components/`, not something 6.5a
   invented.

   **Three more findings, each a rule already written here, caught again:**

   · *A doc comment belongs to the declaration below it* (§4.3's extractor
     bug) — and my banner slicing broke it twice more. `overlayZ.ts` carried
     a COPY of `FINISHED_PAGE_Z`'s doc comment above the stage note, an
     orphan documenting nothing; `propertiesPanelVisibility.ts`'s stage note
     landed at the END of the file, where it read as the declaration
     above's. Both fixed. The mirror of the bug that invented drift at 6.4a
     is the one that writes it.

   · *A sweep that restores "the app's own names" has to measure which names
     those are.* `openingGridLevel` is byte-identical in all three apps, but
     DrawBots' shell imports it beside two names that genuinely are that
     app's, so the restoring sweep kept a DUPLICATE of a shared declaration
     — the drift this stage exists to remove. Trimmed: DrawBots' module
     keeps `DRAWBOTS_GRID_LEVEL` and `pinnedGridLevel` and re-exports the
     rest.

   · *Moving a file can recreate the copy another module exists to prevent.*
     `BrushColorRow.tsx` came over with `const TRACK_W = 260` written back
     out, where DrawBots had replaced that literal with
     `FLOATING_ROW_TRACK_W` precisely because "the two rows had a copy each,
     which is how a third would have appeared". So that module came too
     (`@/editor/components/floatingRowTrack`), and DrawBots' Speed row reads
     it where it read its own.

   **And the spelling rule the pins taught.** A reference to a module still
   in `web/editor/` carries the spelling the apps have always used for a
   sibling there (`./gridLevel`), because the shell's own source pins read
   that text — my uniform re-point to `@/web/editor/arrangeRotate` broke
   four of them. Where a module moved WHOLE there is no sibling left and the
   pin follows the package instead (`@/editor/gridLevel`). 35 source pins
   across the three apps moved with their subjects, in two kinds only: a
   read whose file is the package's now, and an expected import spelling
   that follows the file.

   CozyJournal 667 suites / 10,837 tests; Sol 278 / 3,324; DrawBot 551 /
   9,396; engine 398 of 399 / 7,222. The two apps whose jest roots take in
   the vendored package run its suites too, so their counts rose by the
   eight this sub-stage added; Sol’s do not. The engine’s one failure is
   cameraRoll’s host dependency, as before — `expo-media-library` is not
   installed in this repo, and that suite fails with 6.5a stashed too.

   **6.6a — Done: the editor query's shared half** (engine 25e58ed,
   CozyJournal 7a1b2342, Sol 6ebb764, DrawBots 840de26; 2026-10-25). The
   host's prerequisite, and a sub-stage of its own because the host
   state machine reads every one of these.

   | `editorQuery.ts` | Cozy | Sol | DrawBots |
   |---|---|---|---|
   | lines | 242 | 143 | 283 |
   | declarations | 14 | 11 | 22 |
   | in all three | — | **10** | — |
   | byte-identical in all three | — | **7** | — |
   | `QUERY_KEYS` | 28 keys | 13 | 21 |

   The seven that were the same are the readers: `parseSearch`,
   `parseQuery`, `resolveQuery`, `firstParam`, `pinEntryToLocation`,
   `replaceLocationSearch` and the `Query` type. What differs is the KEYS,
   and they differ because they ARE each app's routes — eleven are common
   (`entryId`, `format`, `date`, `action`, `exportFormat`, `entryIds`, the
   three view settings, `dev`, `warm`), CozyJournal declares seventeen
   more for its friends, groups and games, DrawBots ten for its bots and
   sounds, Sol two.

   So the readers TAKE the key list rather than closing over one
   (`parseSearchFor(keys, search)`), and each app keeps five thin wrappers
   that bind them — the 6.1 arrangement, and what made this cheap: the
   names and signatures did not change, so none of the 11 / 5 / 13 modules
   that import `editorQuery` moved a line. `firstParam` and
   `replaceLocationSearch` take no keys and are re-exported outright.

   Two members needed a seam rather than a move. `namesAPage` asks whether
   a query names a page at all, and CozyJournal's ors in two keys of its
   own (`respond`, `social`) — the package holds `namesACommonPage` over
   the three keys every app has and CozyJournal ors over it.
   `pinnedEntrySearch` drops the keys that asked for a page to be MADE,
   and DrawBots drops `design` beside the three. Both are the shape of a
   base plus the app's own, which is now this plan's commonest answer.
   `asFormatId` STAYS: three byte-identical bodies over three different
   `OPENABLE_FORMATS`.

   **DrawBots has no `namesAPage`**, which the move surfaced rather than
   caused: a route of DrawBots' that names a page it cannot open falls to
   the dev freeform canvas, where the other two say so. The function is in
   the package now and DrawBots does not call it. Under §4.3's canonical
   rule that is an oversight to fix; it is also a behaviour change in a
   shipped app, so it is named here and not taken.

   27 cases in `packages/editor/src/__tests__/editorQuery.test.ts`, driven
   over a MADE-UP key list the way `sessionHost` and `loadPackFonts` drive
   their seams, with a fake `window` for the three functions that touch
   one. `COMMON_QUERY_KEYS` is pinned as an exact set, not a negative
   match.

   **6.6b — Done: the host's open path** (engine 3203f03 + c8a81f1 +
   3f33f74, CozyJournal d7277592, Sol 8c0221f, DrawBots f01e8e8;
   2026-10-25). The owner's call of 2026-10-23 carried out: the state
   machine is the package's and each app keeps a ROUTE TABLE over it.

   What moved is `packages/editor/src/hostRoute.ts` — two hooks, each a
   dozen lines over plain functions, which is where the suite's 15 cases
   are (there is no renderer in this repo's jest, so a hook is tested the
   way `useSuppressIOSLoupe` is: its decisions are functions):

   · `useEditorQuery(keys, routerParams, alsoRouteFrom?)` — the query, and
     the two-way handshake that can replace it. The router's params over
     the URL per key; a route arriving over the bridge replaces it WHOLE
     and is written onto the page's own URL; the page both asks and
     listens, because either order happens.
   · `useResolvedRoute(q, table)` — one run of the open path: hold while
     warm, clear what the last route left standing, let the table resolve,
     and commit nothing if a newer query superseded it. `runRouteResolve`
     is that sequence with no React in it.

   | `EditorHost.tsx` | Cozy | Sol | DrawBots |
   |---|---|---|---|
   | lines before 6.6b | 1,429 | 362 | 563 |
   | lines after | **1,397** | **325** | **526** |
   | verbatim in Cozy's, runs of 3+, before | — | 59 % | 46 % |
   | …after | — | **51 %** | **43 %** |

   (The two verbatim rows are re-measured here and read one point above
   6.0's 58 % / 45 %, which is the measure's own rounding, not drift.)

   The percentage FALLING is the sub-stage working: what the three hosts
   held in common is what left, so what is still here is more each app's
   own than it was. The hosts are 32 / 37 / 37 lines shorter, for 200
   lines of `hostRoute.ts` that all three now read — the usual arithmetic
   of a seam, and the reason to take one is never the line count: it is
   that the "web never saves" race, the warm hold and the superseded-run
   guard are now written once.

   **Two widenings, and the second is the lesson again.** The seam was
   written from CozyJournal and Sol and both were wrong about DrawBots or
   about CozyJournal:

   · *A second route source.* DrawBots registers the SAME navigate handler
     with its own in-page router (`editorQuery.routeInPage` — Redraw to a
     bot's look page and back), so a page routed to in place resolves
     exactly as one the host sent. One optional registrar; the other two
     apps pass nothing. Caught by reading DrawBots' effect before writing
     its host, which is one step earlier than 6.5a managed.
   · *A resolved route is not write-once.* CozyJournal REVISES the route
     it resolved, in place and without re-scaffolding the page, when a new
     prompt is drawn for the day and when an answered page's picture
     arrives a fetch after boot. Both guard on the entry id. The hook
     answers `[route, setRoute]`. This one was caught by the TYPECHECK on
     the third app, not by the measurement — the measurement counted the
     resolve effect and never asked who else wrote the state it sets.

   DrawBots also lays the web host's settings UNDER whatever the route
   says (`withQueryFallback`), which stays its own: one `useMemo` over the
   package's query, rather than a third parameter nobody else would pass.

   The route table itself is a mechanical reading of the old effect — a
   branch that puts an action screen up answers `null`, one that opens a
   page answers the route, and `!cancelled` is the `alive()` the package
   hands in. The five action-screen states, the `actionRun` chain, the
   placeholder and the shell mount all stay the app's, as the settled call
   says.

   **Twenty-seven source pins moved with their subjects** (8 + 8 + 11
   assertions rewritten, across 7 suites in the three apps), in the two
   kinds 6.5a named: a read whose file is the package's now, and an
   expected spelling that follows the file. Two of them had gone SOFT rather than failing,
   which is the §5 lesson in its quieter form — CozyJournal's
   "clears the action screen" pin sliced the host from `if (q.warm === '1')
   return;` to `let cancelled = false;`, and after the move both markers
   still matched, in two DIFFERENT effects, so the slice was most of the
   file and the assertion could not fail. Its "a page loaded to warm
   resolves NOTHING" neighbour matched the salvage effect's warm guard for
   the same reason. Both now read the package for what the package
   decides and a tight slice for what the host does.

   CozyJournal 669 suites / 10,878 tests; Sol 278 / 3,323; DrawBots 553 /
   9,437; engine 400 of 401 / 7,264. The engine's one failure is
   cameraRoll's host dependency, as before. Sol's suite count does not
   move with the package's, its jest roots not taking the vendored tree
   in; the other two apps' do.

   **6.5b.1 — Done: two of the shell's own leaves** (engine 2b29869,
   CozyJournal 35a73e64, Sol fe257e6, DrawBots 3513431; 2026-10-25). The
   first slice of the shell, and the part of it that is 6.5a-shaped: of
   `EditorShell.tsx`'s fifteen top-level declarations that exist in all
   three apps, nine are byte-identical, and two of those move WHOLE.

   | Top-level declaration | Lines (Cozy) | identical in all 3 | moved |
   |---|---|---|---|
   | `ToolbarPushdown` + `PUSHDOWN_HEIGHT` | 38 | yes (but one doc word) | **yes** |
   | `ColorPickerSpec` + `ColorPickerId` | 40 | the row, not the ids | **yes, split** |
   | `CANVAS_OPEN_TRACE` | 11 | yes | no — reads each app's `reportOpenTrace` |
   | `IMAGE_DEPTH` | 13 | yes | no — typed on each app's `entryRaster` |
   | `SAVE_DEBOUNCE_MS`, `IMAGE_REFRESH_DEBOUNCE_MS` | 6 | yes | not yet — six lines, and DrawBots' CLAUDE.md names one |
   | `FontChoice` | 8 | yes | not yet — no module it belongs beside |
   | `TILE_LIT_INK`, `TILE_CAPSULE_STROKE_WIDTH` | 13 | yes | not yet — same |
   | `initialCameraFor`, `TextEditOverlay`, `EditorShellProps` | 204 | no | no |

   Four of the nine identical ones cannot move on their own merits, which
   is worth stating because it is the reason this slice is small rather
   than an oversight: two are typed or closed over each app's own modules,
   and the other four are five constants and a type with no package module
   they belong beside. A new module per constant is the machinery 6.2a's
   rule is about; they wait for a slice that gives them a neighbour.

   `ColorPickerSpec` is the split, and it is 6.3b's `CommonEditorConfig`
   arrangement on a leaf: `CommonColorPickerId` is the thirteen swatches
   all three apps open, each app adds its own (CozyJournal's `rigVolumes`
   and `rigOutlines`, DrawBots' `botPen`), and the row type is generic over
   the id so each app's table stays typed in ITS union — a row for an id
   the app does not have is a compile error rather than a picker nothing
   opens.

   **The doc-comment bug, for the sixth time, and a seventh beside it.**
   The pushdown's JSDoc describes the COMPONENT and sat above
   `const PUSHDOWN_HEIGHT = 44;`, so the height carried the panel's whole
   rationale and the component carried none; and DrawBots' `ColorPickerId`
   still held "// The rig's Color page: the two colours its sketch is drawn
   in." with no `rigVolumes` or `rigOutlines` under it — an orphan left
   when the members were cut. Both fixed in the move. §4.3 says there is no
   mechanical guard and the practice is to read the comment above every
   declaration kept and every one cut; these two were found that way.

   Sol's copy of the pushdown's doc comment lacked ", symmetry included".
   CozyJournal's is canonical and is what moved — the one adoption in the
   sub-stage.

   CozyJournal 671 suites / 10,888 tests; Sol 278 / 3,323; DrawBots 555 /
   9,447; engine 402 of 403 / 7,274.

   **6.5b.2 — Done: eight of the shell's closed clusters, as hooks** (engine
   bd11abd, CozyJournal 741da3d0, Sol 87c5b74, DrawBots a87e602;
   2026-10-25). The first slice of the shell's BODY, on the owner's call of
   the same day: take the slicing, mid-size clusters only, and leave stage 7
   where it is. **56 statements, 465 lines of each app** — byte-identical in
   all three and closed under the four inputs 6.5b.2+ named.

   | Hook | stmts | lines | inputs it takes | what it is |
   |---|---|---|---|---|
   | `useRadialMenus` | 14 | 72 | `sessionRef`, `setSession`, `applyEntry` | the two long-press menus and the gesture lifecycle they share |
   | `useEyedropper` | 10 | 95 | `sessionRef`, `updateSettings` | the loupe, and the swatch row it files into |
   | `useImageEdits` | 8 | 111 | `sessionRef`, `setSession`, `applyEntry` | the four edits that coalesce one undo step |
   | `useShapeToolModes` | 7 | 23 | `config` | the modes in force, and the format's power to pin them |
   | `usePhotoSource` | 5 | 55 | `sessionRef`, `applyEntry`, the placeholder | the picker, the drag-place and the replace |
   | `useColorBlendMode` | 5 | 33 | the armed tool | the blend, and the marks that advertise it |
   | `useColorScope` | 4 | 34 | — | the recolour brush's aim |
   | `usePatternExcludedFamilies` | 3 | 42 | — | the tile-set filter, memoized per painted cell |

   **The unit is the connected component of the body's read graph**, which is
   what "a closed cluster" means once it is measured rather than eyeballed.
   6.5b.2+ proposed two clusters by name (the pattern-tile chooser, the save
   pipeline); decomposing the closed set properly gives 35 components over
   183 statements plus 77 singletons, and these eight are the ones that both
   close and PLACE.

   **Placeability is a second gate, and the read graph cannot see it.** A
   component's statements are scattered — the eyedropper's ten run from body
   position 7 to 442 — so extracting one collapses them to a single call,
   which must sit after everything it reads and before everything that reads
   it. Two components that were closed are NOT placeable and were dropped for
   it: the caret/text-selection group (10 statements, 72 lines) and the
   default-font group (5, 52). Both are the same shape — a `useState` read by
   an early effect, grouped with a handler that needs `applyEntry` 200
   statements later — and both fail identically in all three apps, which is
   the sign the measurement is right rather than an accident of one app.
   **React hook order is a total order the read graph does not capture**, and
   a cluster has to be measured against it before it is called closed.

   **A ninth cluster measured and was refused on the package's own terms.**
   `useChromeInsets` (3 statements, 27 lines: `useSafeAreaInsets`, the
   headerless flag, the chrome's box) closes, places in all three apps, and
   is byte-identical — and it is the only thing in `packages/editor` that
   would import `react-native-safe-area-context`. The package's two other
   users of that module are `packages/shell/src/app` and `.../components`,
   both EXCLUDED from the engine's root tsconfig, which is how that
   dependency has been kept out of the typechecked surface. 6.1 made the same
   call about `faceUri` and expo-asset: the thing that needs the app's native
   environment stays with the app. It was found by the suite failing to load,
   not by reading — which is the argument for writing the suite first.

   **What became a parameter rather than an import** — §4.3's commonest
   answer, now applied to a group of statements rather than a declaration:
   the store's `updateSettings` (the swatch row and the remembered font are
   per app), this app's sentinel photo-placeholder `imageId` (6.3d left the
   WORD with each app because the blob store keys blobs by it), and the armed
   tool, because `useColorBlendMode` asks the session for nothing else.
   `useEyedropper` is generic over the picker id so each app's table stays
   typed in its own union — 6.5b.1's `ColorPickerSpecFor`, used as designed.
   Every returned name is destructured back under the name it had, so not one
   of the hundreds of sites downstream moved a character.

   **`framingTarget` is exported and tested on its own**, and it is the one
   thing in the eight that was re-shaped rather than lifted. It is the one
   DECISION among them rather than plumbing, and it has a shipped bug in its
   history: an edit routed through the raw `selectedId` died silently after
   the live preview had been rolled back, which read as the Zoom slider
   jumping back on release. Pulling it out of `onFraming` is what let it be
   pinned at all.

   **There is no renderer in this repo, nor in any of the three apps**
   (`testEnvironment: 'node'` everywhere, no jsdom, no testing-library),
   which is why 6.6b wrote `hostRoute.ts` as pure functions under thin hooks.
   These eight are state plumbing with no such core, so **their behaviour is
   not pinned anywhere**. That is a real gap and `shellHooks.test.ts` says so
   at the top rather than implying otherwise. What it does pin: that the
   modules load (which is what puts them under a typecheck at all, the root
   tsconfig excluding `packages/editor`), that none reaches into an app, that
   none names the `@/editor-ui` INDEX, and `framingTarget`'s resolution. Both
   refusing pins were mutation-tested on the two modules read as TEXT, where
   they are the only guard — on a loadable module ts-jest catches the
   mutation first and the assertion never runs.

   **The `@/editor-ui` index is a trap of the same family as 6.5b.1's
   `PUSHDOWN_HEIGHT`**, and two of the eight hit it. Importing the index —
   even for a TYPE — drags every `.tsx` of the chrome into the graph of
   anything that loads the file, and the suite explodes. Each name has its
   own `.ts` module (`SwatchRainbow` and `FramingModel` are `adapter.ts`,
   `patternExcludedTileFamilies` is `logic/patternEdit.ts`), so all three
   imports were respelled and a pin now refuses the index outright.
   `useColorBlendMode` and `useRadialMenus` still reach a `.tsx` for a glyph
   and a ref type, so those two are read as source text, as the gate requires.

   **Fourteen source-text pins read the shell for wiring that is now the
   package's, and not one was deleted.** Each is re-pointed through
   `editorSource`, so every fact still has a test and still says where it
   lives. Four needed more than a re-point, and each is one of §4.3's named
   traps paying out:

   · `imageFraming.test.ts` SLICED between `const onFraming = useCallback(`
     and `const onResetFraming = useCallback(` — and after the move those two
     markers sat in two DIFFERENT files, so `indexOf` returned -1 and the
     slice was garbage. It went red here only because the contents were gone
     too; the shape of the failure is exactly the soft-slice §4.3 warns of.
     Re-cut inside the hook, and **the cut is now asserted before its
     contents are** — bounded, one `useCallback`, under 60 lines.
   · `colorPickerClose`, `pageColorRows` and `toolbarColorField` COUNTED
     occurrences that are now split between the shell and a hook. The counts
     are split the same way rather than summed, so each half still says where
     its own fact is. One of them stopped being a count: `setColorScope`
     occurs four times in `useColorScope.ts` but only two are SITES — the
     other two are a doc comment and the return — so the sites are named
     instead.

   **Two orphan doc-comment bands, the seventh and eighth of this stage**,
   both found the way §4.3 prescribes and neither by a tool. One described
   the gradient Tint bar — whose own declarations are long gone from all
   three shells — and sat above `framingBaseRef`, so it would have travelled
   into `useImageEdits` describing nothing there. The other described the
   ACTIVE colour and sat above the swatch ROW, bound for `useEyedropper`. The
   facts they carried that nothing else did are now above
   `svgFillSelectedStopRef` and `noteActiveColor`, two declarations that had
   no comment at all.

   **The shells' unused-import set is exactly what it was before**, checked
   against HEAD rather than assumed: 27 names and one whole declaration went
   dead, identically in all three, and were pruned; the pre-existing dead
   imports (9 / 28 / 20) were left alone, because this sub-stage does not get
   to quietly tidy what it did not touch. The first version of that check was
   itself wrong and is worth recording: it keyed the unused set by MESSAGE
   TEXT, and every `TS6192` ("all imports in this declaration are unused")
   reads the same, so a new one standing next to a pre-existing one was
   absorbed by the set comparison and hid a dead import in two of the three
   apps. Keyed by the declaration's SPECIFIER it showed up at once. §4.3's
   "prefer an exact set or a derived count" applies to the verification as
   much as to the pin.

   **Two bugs in the measurement tooling, and the second one matters for the
   record.** The statement extractors this stage measures with (scratchpad
   scripts, not in any repo) found a declaration's head line by skipping
   `//` comments — but not `/** */`, so
   every declaration documented with a JSDoc block was MISSING from the
   name→statement map, and any statement reading such a name looked CLOSED
   when it was not. Separately, the identifier scan dropped a name after `.`
   to skip member accesses, which also dropped `...NAME` — a spread. With
   both fixed, **the closure measurement in the entry below is overstated by
   16 statements**: 179 of the 340 close with no allowance (not 195) and 252
   under the four inputs (not 268). The chokepoint ranks are unchanged, and
   so is every count that came from `body.js` itself — the 624 / 553 / 571
   statements, the 340, the 250 runs, the render tree's numbers — because
   those never used the broken map. The entry below is corrected in place and
   the original figures are named here so the correction is not silent.
   §4.3's rule earned its keep twice over: a sweep whose result surprises you
   is to be thrown away, not tuned.

   CozyJournal 672 suites / 10,928 tests; Sol 278 / 3,326; DrawBots 556 /
   9,487; engine 403 of 404 / 7,311 (`cameraRoll`, pre-existing). Cozy's and
   DrawBots' suite counts rose by one and their tests by 37 because their
   jest roots include the vendored package and `shellHooks.test.ts` is now in
   it; Sol's roots do not, so Sol's moved only by the three pins this
   sub-stage added.

   **6.5b.3 — Done: the colour-and-effects complex, as five hooks** (engine
   bef20b0, CozyJournal 74efc974, Sol 932bec9, DrawBots 6961abf;
   2026-10-26). 61 statements and 640 lines of each app's shell body, the
   component §4.2 item 6 held back twice.

   | hook | stmts | lines | takes in | hands out | what it is |
   |---|---|---|---|---|---|
   | `useBarColorState` | 19 | 84 | 1 | 30 | the active ink, the next shape's style, the picker flags |
   | `useEffectBars` | 20 | 214 | 9 | 17 | shadow, the two glows, border, fade |
   | `useStrokeBar` | 7 | 150 | 7 | 5 | the Stroke bar |
   | `useFillBar` | 6 | 101 | 7 | 5 | the Fill bar |
   | `useColorAcrossBars` | 7 | 91 | 13 | 7 | one callback apiece: the Transform ghosts, the Text ink, the tile thumb, the hue row, the eraser light |

   **The question the owner was given, and the one the measurement
   answered instead.** The programme listed the bar handlers as 6.5b.3 and
   the held 59-statement colour component as 6.5b.5, and the handover's
   reading was that these are largely the same subject — in which case the
   choice was: take it as one hook with a 61-name return, find a cut
   inside it, or skip to 6.5b.4. Measured, both halves of that framing
   were wrong.

   The subject overlap is real but PARTIAL IN BOTH DIRECTIONS. Cut at its
   own banners the shell is 32 / 30 / 29 sections. The component's
   statements land in eleven of them plus the preamble: it nearly consumes
   the Stroke bar (131 of 156 lines), the Opacity bar (97 of 131) and the
   Fill bar (42 of 55) — but **464 of its 640 lines are in the bar
   sections, and those sections are 1,582 lines, so it is 29 % of them**.
   The other 176 lines are preamble `useState`s (82), the super-long-press
   handlers (61) and dust in the pattern and radial sections. Two boundary
   facts the name-level reading had missed: 6.0's *eyedropper
   arm-and-commit* section is ALREADY GONE (6.5b.2 took it into
   `useEyedropper`), so 6.0's ten are nine in the file; and the Fill bar
   section measures 55 lines now, not 6.0's 51.

   And the option the question offered did not exist. **As one hook the
   component is NOT PLACEABLE, in any of the three apps** — `lo` 200 / 155
   / 179 against `hi` 125 / 83 / 99. It reads `applyEntry` (the commit
   pipeline) and is read back seventy-five statements earlier by
   `fadeTargetRef.current = fadeTarget` and the colour effects. React hook
   order is a total order the read graph does not capture; the width of the
   return was never the obstacle. The owner was given that measurement with
   the cut already priced, and took all five hooks.

   **The cut, and why it costs nothing.** Split at `applyEntry` the front
   half is 19 statements placeable in (0,157) / (0,109) / (0,130) and the
   back half 40 placeable in (200,332) / (155,332) / (179,334); split again
   by bar, all four place with windows hundreds of statements wide. The
   front hook takes ONE input (`session`) and hands back 30 names. And
   every input of all four bar hooks is either one of the four allowed
   inputs or a name `useBarColorState` returns — 19 of
   `useColorAcrossBars`' 23 original free names are the front hook's, the
   other four being `applyEntry`, `session`, `sessionRef`, `setSession`. So
   **the context object §4.3 declined to invent is the front hook's own
   return**, which is why it did not have to be invented. `shellHooks.test.ts`
   pins that both ways: that `useBarColorState` takes none of
   `applyEntry` / `setSession` / `sessionRef` — taking one would put it
   behind the pipeline and then neither half places — and that no bar hook
   takes a name from anywhere else.

   **Both of those pins are mutation-tested, and the mutation had to be
   made TYPE-VALID.** §4.3's rule says to mutation-test a pin whose job is
   to refuse something, and to do it on a module the harness cannot load,
   because ts-jest catches the mutation first otherwise. These modules DO
   load, and the first attempt proved the rule exactly: adding `applyEntry`
   to `useBarColorState`'s destructuring failed as TS2339 before any
   assertion ran. Adding it to the type as well made the suite load, and
   then the pin fired. The same for an invented `barContext` on
   `useStrokeBar`. A pin verified by a mutation that does not compile is
   not verified.

   **Three sections are mis-filed, and the record should say so rather
   than quietly regroup.** Nine effect-colour handlers — `onShadowColor`,
   `onGlowColor`, `onPickFadeColor`, `onBorderColorConfirm` and their
   siblings — sit under the TRANSFORM bar's banner in all three shells, and
   four Stroke/Fill handlers under the PATTERN FILL's. The hooks group them
   by what they do, so `useEffectBars` draws 9 of its 20 statements from
   the Transform section. 6.0's section cut and the subject disagree at
   those two boundaries; that is a fact about the shells, not about the
   cut.

   **The shell's line count has ONE home per app now** (DrawBots' rounds 2
   and 3). It had six in DrawBots and four different values — `CLAUDE.md`
   said ~8,100, `docs/drawBot.md` said ~7,000 in one place and ~9,000 in
   another, `DrawBots.md` said ~7,500 twice and 9,000 once — against an
   actual 7,497, and two rounds of updating the numbers had drifted again
   within one range. Sol's `CLAUDE.md` had the same class. In every one of
   those places the digits were rhetorical — "a component big enough that a
   full re-render matters", "too big to mount in a test" — so they are gone,
   and the measured figure is stated only in each app's codebase map, which
   this programme re-measures every slice. **A number that changes every
   sub-stage should be written down once.**

   And "once" had to be taken literally, which took a third round: the first
   attempt left the figure in the map TWICE — the §4.2 statement plus the
   gotcha list's restatement — and wrote a parenthetical conceding the second
   home, which made two other sentences the same commit wrote ("the one place
   it is stated") false. It also cited a §12 that this map does not have; its
   sections run 1 to 11. **A rule with a carve-out in it is not the rule**:
   the gotcha list points at §4.2 now and states no number, and the three
   sentences claiming one home are all true.

   **What came along that the extractor could not see.** `fadeTargetRef`
   and its sync line: a hook that owns a ref owns its sync, and the sync is
   anonymous, so `body.js` keys it by nothing. 6.5b.2 shipped
   `colorScopeRef`'s in BOTH the hook and all three shells for exactly this
   reason. It is DERIVED here (`members.js` pairs an anonymous
   `xRef.current = x` with the member on either side of it) rather than
   listed as a literal, so the generator and the shell editor cannot
   disagree about it — and the generator reported 61 statements where the
   spec named 60, which is how one would notice if it had gone wrong.

   `TILE_LIT_INK` and `TILE_CAPSULE_STROKE_WIDTH` moved to `tileTool.ts`,
   which already holds the tile constants. They were module-level in all
   three shells and byte-identical; `tileInkThumb` took both away with it
   and the Tiles takeover still reads the first, so the shells import it
   where they used to declare it. That is 6.5b.1's category — a file-level
   leaf — taken because this sub-stage needed it, not as a sweep.

   **A SLICE MARKER IS NOT AN ASSERTION, and this sub-stage is where that
   finally got fixed properly.** §4.3 named the trap at 6.5b.2, fixed one
   instance and shipped three more. 6.5b.3's sweep over MARKER POSITIONS
   (not literals, and not call shapes) found 37 stale markers across 15
   suites per app — **two of them stale since 6.5b.2**, slicing on
   `onFraming` and `onReplaceImageSource`, bounding nothing, and green. The
   guard now lives in ONE shared helper — `sliceBetween` in
   `packages/editor/src/__tests__/sourceSlice.ts`, re-exported from each
   app's `web/editor/__tests__/test-utils.ts` — which throws when either end
   is missing and seeks the end AFTER the start. (It read "in each app's
   test-utils" until 6.5b.4's review: that was true of the first cut and the
   paragraphs below record the move, so the sentence a reader hits first was
   contradicting them.) Every re-pointed slice goes
   through it, and every suite's own `between` is a thin adapter over it —
   which the review had to ask for twice over, because the first pass left
   `pageColorRows`' guarded copy standing BESIDE the new helper in a file
   that then called both. (It was also the weaker one: it sought the end
   marker from the start's own index rather than from after it, so a marker
   appearing on both sides of the region could fold the slice to nothing —
   the exact case the shared helper exists to prevent. A duplicate of a
   guard is worse than no guard, because it reads as covered.)

   **A deferred sweep, scoped out here.** Four suites under
   `components/__tests__` in CozyJournal have their own `between` over
   `components/` source rather than the shell's, and
   `packages/editor-ui/src/__tests__/dragCommit.test.ts` has one more
   (`handler`, guarded start, unguarded end with a fallback) over
   `onPanResponderX:` keys rather than declarations, which Sol's review
   found. **The sites, not a count** — the count read "four, two guarded,
   two not" and was wrong twice over (6.5b.4's review said five; there are
   six, and they are not alike):
   `assetUpload.test.ts:17` and `sharedFreshness.test.ts:25` guard NEITHER
   end; `friendsPersist.test.ts:15` and `notebookChurn.test.ts:24` assert
   the start and not the end; `reactionQueue.test.ts:11` asserts the start
   and falls back to EOF on a missing end, which is the failure mode
   `sliceBetween` exists to stop; and `viewSettingsScreen.test.ts:48`
   builds its slice from an `at()` that asserts BOTH needles, so it is
   already guarded and wants only the dedupe. Where a count would catch
   the wrong thing, name the sites. They are the same duplication for the same reason and they are
   NOT in this sub-stage: other trees, other markers, and no part of the
   shell's move touches them. Recorded the way `editorSource`'s own
   fifty-suite backlog is, so that it is a decision rather than an
   oversight — and `sliceBetween` now takes a list of end markers, so
   whoever takes the sweep has the helper the fifth one needs.

   **And the helper itself was in the wrong place, which DrawBots' round 2
   caught.** `sliceBetween` has nothing of any app in it, and the first cut
   put a copy in all three — three copies of one guard, which is the thing
   the guard exists to stop. It lives in the engine now, for `FakeEl`'s
   reason (item 5), and each app re-exports it so no suite's import had to
   move. Its throw path was pinned nowhere; `sliceBetween.test.ts` drives
   both refusals over a fixture rather than over a real shell, so the pin on
   the guard cannot itself go stale when the shells move.

   It is in `packages/editor/src/__tests__/sourceSlice.ts` rather than in the
   engine's `test-utils.ts`, which round 3 asked for and was right about: one
   re-export line in each app's own test-utils had been pulling the engine's
   whole fixture module — `worldSnapshot`, `canvasPaint`, `paintObject`,
   `formats/scaffold` and the rest — into every suite importing `./test-utils`,
   which is 104 / 66 / 80 of them, where about sixteen want a slicer and the
   others want `editorSource` alone. Two pure string functions with no imports
   of their own now, so nothing travels with them. The cost is one
   `testPathIgnorePatterns` entry per jest config that WALKS the package tree
   (the engine's, CozyJournal's and DrawBots'; Sol's roots do not reach it, so
   Sol's config is unchanged) — without it, jest collects a helper under
   `__tests__` as an empty suite.

   The same round found the pair this helper exists for: `effectAddBars`'
   `handler` had been hardened here and `onePageAtATime`'s copy — the same
   function, pre-hardening, unguarded end and all — was left. **A duplicate
   of a guard is worse than no guard**, and the first round's version of
   that lesson had been taken too literally: the duplicate was removed in
   the file the review named and not in its twin. `sliceBetween` takes a
   LIST of end markers now (nearest wins), which is what let `handler`
   become a one-line adapter over a shared `declarationBody` in both.

   **The one line that is deliberately not byte-identical.** `noteActiveColor`'s
   dep array gains `updateSettings`. In the shells that name was a
   module-level import — stable by construction, and correctly omitted;
   here it is a parameter, and omitting it would capture the first one
   forever. Harmless for all three apps, a latent stale closure for anyone
   else. It is the only departure from verbatim in the 640 lines, and it is
   named here because "byte-identical to three shipped apps" is the whole
   safety argument and an unrecorded exception would quietly weaken it.

   Three assertions could NOT be re-pointed mechanically, and each is one
   of §4.3's own warnings:

   - A COUNT (`SHELL.match(/TILE_CAPSULE_STROKE_WIDTH/g)` of 3) that would
     now count zero. Re-stated at the site that does the baking — and the
     first attempt read 3 instead of 2 because `useColorAcrossBars`' own
     HEADER names the constant. "A count would catch a doc comment" is in
     §4.3 and I walked into it anyway; it counts over the code with
     comments blanked now.
   - A NEGATIVE assertion (`not.toContain("'#FFFFFF')")`) about a file the
     code had left, which passes for the wrong reason. Asserted of both
     files.
   - An ADJACENCY pin (`'  }, [currentColor]);\n  // The tile radial'`) —
     the thumbnailer sitting directly above the options that consume it.
     That cannot be stated across a move at all; what it was for is the
     memo's dep list plus the assertion already below it.

   **Four tool bugs, all of the same family: a regex that spans more than
   it should.** Worth recording because three of them wrote something
   wrong before being caught, and the fourth was caught only by a count:

   - The re-point tool's assertion matcher used `([\s\S]*?)` for a
     quoted literal's body. A `'`- or `"`-quoted JS string cannot contain a
     raw newline, and without saying so the match ran from one argument's
     opening quote, past the comma a wrapped `expect(...)` leaves at the
     end of its line, to a LATER assertion's closing quote — so the
     "literal" was two assertions and a comma, found in no file, and a
     dozen passing suites were reported as broken.
   - Its anchor for a new constant was a `^const … EditorShell.tsx … );`
     spanning newlines, which reached from the first column-0 `const` in
     the file to a later indented declaration. `transformBar` got its
     constant at column 0 inside an indented describe. Found by lines now.
   - The same tool declared a constant wherever it re-pointed an
     assertion, which in a multi-`describe` suite is sometimes a LATER
     describe than a use: `patternTool` read `STROKE_BAR` at line 1057 and
     declared it at 1115. These are whole-file reads with no reason to be
     scoped at all, so they are hoisted to module scope.
   - `prune.js` matched an import name inside its own specifier
     (`import { omitKeys } from '@/engine/omitKeys'`), and masking every
     quoted run to fix it blanked swathes of CozyJournal's preamble, whose
     doc comments are full of apostrophes. Only `from '…'` is masked now.

   The lesson is the one §4.3 already has in another form: **do not trust
   your own sweeps.** Every one of these over-matched rather than
   under-matched, so each produced confident output that was wrong.

   **6.5b.4 added the other half of it: a sweep that REPORTS is only half
   the work, and the line that gets missed is the one next to the line that
   gets fixed.** Its inert-pin sweep listed `tileTool.test.ts`'s dead gate
   pin and I fixed the other flagged line in the same file, four lines
   away; the review found it. Under-matching is not the only way a sweep
   fails — acting on its output selectively is the commoner one, and it
   leaves a report that reads as covered. So for a re-pointed pin the sweep
   is the candidate list and the CHECK is a mutation: break the thing the
   pin names and watch it go red. A pin that cannot be made to fail is not
   a pin, whatever the sweep said about it.

   **The dead-import sweep, keyed by specifier and diffed against HEAD.**
   36 / 37 / 35 names and 3 / 4 / 3 whole declarations went dead in the
   shells. One thing to record: Sol's `@/editor/colorUtils` declaration
   became wholly dead because `rgbToHexColor` left, and removing it took
   `parseHexColor` — which was ALREADY dead at HEAD — with it. Sol's
   pre-existing unused-import count therefore falls by one. There was no
   option that left the baseline untouched: keeping the declaration for a
   name nobody uses just turns a TS6133 into a TS6192. Four more locals
   went dead in the suites my own re-pointing touched and are removed; a
   fifth, `patternTool`'s `model`, is PRE-EXISTING (line 942 at HEAD) and
   is left exactly as it was.

   CozyJournal 672 suites / 10,956 tests; Sol 278 / 3,327; DrawBots 556 /
   9,515; engine 403 of 404 / 7,338 (`cameraRoll`, pre-existing — no
   `expo-media-library` in this repo). After round 2's fixes the engine is
   404 of 405 / 7,347, the nine added being `sliceBetween.test.ts`. Cozy's and DrawBots' tests rose by
   27 and their suite counts did not: their jest roots include the vendored
   package and `shellHooks.test.ts` was already in it. Sol's roots do not,
   so Sol's figures are unchanged by the package's new pins.

   **The gap this sub-stage widens.** There is still no renderer in any of
   the four repos, so what pins these five hooks' BEHAVIOUR is nothing but
   byte-identity with three shipped apps and three typechecks. That was the
   argument at 6.5b.2 for 465 lines; it is the argument here for 640, and
   6.5b.4 is the render tree. The suite says so at the top of itself. It
   does not get better by being repeated — see "Still open".

   **6.5b.4 — Done: the render tree's floating chrome, as eight
   components** (engine 07b033b, CozyJournal f59093c5, Sol 00cc48a,
   DrawBot 3b97ffb, 2026-10-26). Eight regions of the shell's `return (…)`
   are now `packages/editor/src/components/*.tsx`, lifted verbatim out of
   all three apps:

   (Those three app commits' own MESSAGES cite the engine at `074a203`,
   which the engine commit then replaced with `07b033b` — an amend to
   correct a line count in the message itself, made before any pointer was
   pushed. The pointers reach `07b033b`, the SHA above and in each app's
   tree; the messages were left alone rather than rebased, because by then
   they carried a review's `REVIEWED_COMMIT` hash. **A SHA in a commit
   message is a copy, and an amend upstream of it makes the copy wrong** —
   cite the engine commit in the record, which can be corrected, rather
   than relying on a message that cannot.)

   | component | lines (Cozy) | props |
   |---|---|---|
   | `BrushControlsGroup` | 87 | 13, one of them the seam prop |
   | `ColorPickerStack` | 39 | 6 |
   | `PatternRadialTarget` | 36 | 13 |
   | `PatternGridActions` | 34 | 12 |
   | `CanvasRadialMenus` | 30 | 10 |
   | `PatternFillSlider` | 22 | 9 |
   | `PhotoSourceInput` | 21 | 4 |
   | `TileTransformCard` | 17 | 5 |

   **286 / 284 / 293 lines of render tree out of CozyJournal / Sol /
   DrawBots, code-identical in all three, with 116 / 116 / 123 lines of
   call site back in** — five of the eight byte-identical to the line,
   bands included; the other three differ only in prose (below). The
   figures differ by app because two of the regions carry a band one app
   words differently and one carries a band DrawBots alone has.

   **The premise this sub-stage was planned on was a MEASUREMENT ARTIFACT,
   and the plan changed because of it.** The handover's figure said the
   render tree is 59 % (Sol) / 73 % (DrawBots) verbatim in CozyJournal's
   against the whole shell's 87 % / 89 % at 6.0 — "markedly LESS shared
   than the file it sits in", and therefore the wrong shape to move. Those
   two numbers come from two different scripts measuring two different
   things in OPPOSITE directions. 6.0's measure (`verbatim.js`: difflib's
   recursive longest-matching-block over exact lines, denominator = the
   OTHER app's length) run on the render tree gives:

   | 6.0's measure, before 6.5b.4 | Sol | DrawBots |
   |---|---|---|
   | whole shell | 86 % | 87 % |
   | **render tree** | **88 %** | **80 %** |
   | longest render-tree runs | 112, 109, 100 | 255, 175, 144 |

   `verbatim.js` reproduces 6.0's own figure exactly on the 6.0-era shells
   (88 % / 89 %), so this is the two measures disagreeing rather than drift
   between then and now. The 59 % / 73 % is `rtree.js`'s measure —
   CozyJournal as the denominator, lines trimmed, blanks counted — and the
   WHOLE SHELL measured that same way reads 59 % / 72 %, which is the tell:
   the figure attributed to the render tree is a whole-shell-shaped number.
   **The render tree is as shared as the file it sits in**, and its longest
   runs are twice what was quoted. **Two numbers are comparable only if one
   script produced both.**

   **What is actually app-only is small, and badly shaped — which is why
   the overlay seam was still the wrong plan.** Marking every render-tree
   line that reads a name this app declares and the other two do not, or
   mounts a component the other two do not:

   | | Cozy | Sol | DrawBots |
   |---|---|---|---|
   | render tree, before | 1,624 | 1,169 | 1,452 |
   | app-only lines | 110 (7 %) | 60 (5 %) | 87 (6 %) |
   | …in blocks (gap ≤ 2) | **41** | **11** | **42** |
   | shared frame left | 1,514 | 1,109 | 1,365 |

   93–95 % is shared frame. But those are 41 / 11 / 42 holes, **most of
   them ONE LINE** — `tileRegionDrags={!!tileToolButton}`,
   `markers={regionMarkers}`, a `symmetryMenuOpen` ternary inside a style.
   DrawBots' `{x.overlay}` seam carries the handful of big blocks (Cozy
   13/10/10/7/7, Sol 20/10/8/8, DrawBots 13/7/6 — and its own four
   `{x.overlay}` lines, which already ARE that seam) and nothing at all of
   the thirty-odd pinpricks, which are props on components all three mount.
   An overlay seam was never going to carry them.

   **And one third of CozyJournal's holes is a PRODUCT call, not a seam.**
   Of its 47 app-only render-tree reads, 19 are a group of 18 names
   CozyJournal and DrawBots share and **Sol does not have at all** — with
   identical counts in the two (`tileToolButton` 7/7, `symmetryMenuOpen`
   5/5, `bandInstruction` 4/4, `titleAsk` 2/2, `resetAsk` 2/2,
   `regionMarkers` 2/2) and zero anywhere in Sol's `web/`. §4.3's
   canonical-app rule would make Sol like CozyJournal; here that means
   ADDING SIX FEATURES to a shipped app, which is the same class of
   decision as the push brush and `namesAPage` on the Still-open list. It
   is on that list now.

   **So the frame does not move, and the eight pieces that do are the ones
   whose props are a normal component signature.** The two large regions
   that looked liftable are not: @425–677 (253 lines, 97 % identical,
   three code holes totalling 7 lines) needs **48 props**, and @800–1108
   (309 lines, 93 % identical) needs **42** — the context object this plan
   has refused to invent three times, and here there is no hook whose
   documented return it already is (every one of the 48 is a plain
   `useState` / `useMemo` / `useCallback` in the shell's own body, checked
   name by name). The capsule band as one component is the same: 33 props
   plus a ReactNode hole per app.

   **A JSX lift has no PLACEMENT gate, which is the one way this sub-stage
   was cheaper than the two before it.** 6.5b.2's second gate — a group's
   statements collapse to one call that must sit after everything it reads
   and before everything that reads it — does not arise: the call site goes
   exactly where the JSX was, so hook order cannot fail. What applies
   instead is IMPORT REACHABILITY, and it was clean: every leaf these eight
   mount is already a package module, and the three names the shells took
   from the `@/editor-ui` INDEX (`BrushControlsPanel`,
   `FLOATING_SLIDER_BOTTOM`, `PATTERN_TILE_TRANSFORM_IDENTITY`) are named
   at their deep modules instead (`components/BrushControlsPanel`,
   `logic/patternEdit`), which `ToolModeCapsule.tsx` already does.

   **The boundaries were wrong three times before they were right, and
   every one of the three was a regex over-matching.** Worth the space
   because it is the fourth entry in a row to say so:

   - A region bounded by "a line carrying a comment marker" began MID-BAND
     in all eight cases: a `{/* … */}` band's middle lines carry no marker
     at all. A band belongs to the declaration below it, so eight regions
     would each have split a band between the shell and the package.
   - Extending UP to the band's opening by scanning for `/*` stopped four
     lines early on `PhotoSourceInput`, whose band says "where `image/*`
     narrows the sheet". The opener has to be anchored to the START of the
     line.
   - And the same `image/*`, in the `accept="image/*,.svg"` ATTRIBUTE,
     opened a fake block comment that swallowed the rest of the region when
     the prop-list extractor blanked comments before string literals.
     Blanking literals FIRST fixes both that and `'blend'` reading as an
     identifier. **Blank strings before comments, not after.**
   - `ColorPickerStack` was cut one line short of its `.map`'s `))}`, which
     no closer pattern matched. A region has to be a SYNTACTIC unit, and
     "the last line indented deeper" is not that test.

   Two adjacent bands also cannot be told apart mechanically, and reading
   settled both: DrawBots' `BrushControlsGroup` carries a second band of
   its own (why the tick-rate slider is NOT there), which belongs to the
   declaration and stays at DrawBots' call site — while the band above its
   `PatternGridActions` describes a RIG family capsule DrawBots does not
   mount. That one is a PRE-EXISTING orphan, untouched here, and it now
   abuts the new call site: see "Still open".

   **Two deliberate deviations from byte-identity, both named in the code
   as well as here.**

   - `BrushControlsGroup` takes one `brushChromeUp` prop where the shells
     spelled the condition twice (the panel's `visible:` and the mode
     target's guard). **The three apps do not actually disagree**:
     DrawBots declares `const brushSliderUp = brushToolActive &&
     !editingTextId`, the same expression under a name it needs elsewhere.
     So this is one binding of one condition, not a seam over a difference
     — and the pin is better than the one it replaced, because what the
     component guarantees is that BOTH halves ride it: a mode target
     standing beside an absent slider names nothing.
   - `PatternGridActions`' and `PatternRadialTarget`' doc bands named the
     rig's Turn slider, which only CozyJournal mounts (Sol's wording
     omitted it; DrawBots had inherited CozyJournal's and names a rig it
     does not mount either). The package wording names `floatingSlotAnchor`
     — the one formula every occupant of that slot stands on — which is
     true of all three.

   `insets` is taken structurally (`{ bottom: number }`) rather than as an
   `EdgeInsets`: `react-native-safe-area-context` is a native dependency
   this package stays clear of (§4.3), and the inset stays the shell's to
   read. That is 6.5b.2's `useChromeInsets` call applied where it costs
   nothing.

   **What it moved, measured from each app's HEAD after the commits.**

   | | Cozy | Sol | DrawBots |
   |---|---|---|---|
   | `EditorShell.tsx` | 8,968 → **8,789** | 6,407 → **6,229** | 7,496 → **7,317** |
   | render tree | 1,624 → **1,454** | 1,169 → **1,001** | 1,452 → **1,282** |
   | `web/editor/` | 23,985 → **23,806** | 10,318 → **10,140** | 16,056 → **15,877** |

   179 / 178 / 179 lines lighter, and — a fourth sub-stage running — **not
   one file fewer** (30 / 58 / 78 before and after).

   **And this is the first sub-stage whose subject was entirely inside ONE
   statement, which makes every statement-level measure blind to it.** The
   body is **519 / 448 / 466 statements, unchanged**; the count
   byte-identical in all three is **224, unchanged**; the closed set under
   the four allowed inputs is **136 statements / 890 lines in 96
   components, 76 singletons — unchanged**. The render tree is one
   anonymous `return`, so 286 / 284 / 293 lines left the three files without
   a single named
   statement moving, and 6.5b.5 inherits exactly what it inherited before.
   §1 says a stage that empties files shows in the first column and one
   that hollows them out shows only in the last; this one does not show in
   the statement table at all.

   The app-only bucket is likewise untouched — **82 statements / 1,099
   lines in CozyJournal, 58 / 286 in Sol, 36 / 267 in DrawBots** — so three
   slices of the shell have now been taken and every statement in all three
   came out of the SHARED bucket. What stage 7 is about is where it was.

   **Re-measured after the move**, so the fourth column of §1's reading
   holds: the render tree is 86 % (Sol) / 77 % (DrawBots) verbatim in
   CozyJournal's on 6.0's measure, against 88 % / 80 % before, and the
   whole shell is 85 % / 87 % against 86 % / 87 %. Taking shared text out
   of three files lowers the shared fraction of what is left, which is the
   point of the exercise rather than a regression in it.

   **The suites' pins follow the text, and the NEGATIVE ones were the
   dangerous half.** 17 / 14 / 17 suite files were re-pointed, and **26 /
   22 / 25** of their pins now read one of the eight package components
   through `editorSource('components', '<X>.tsx')` — and where the fact
   SPLIT, the shell computing a condition and the component applying it,
   both halves are pinned. A `.not.toContain` on text that
   MOVED passes for the wrong reason and nothing fails to say so, so the
   sweep ran over every quoted literal in every suite tested against the
   eight regions' text rather than over the failing suites alone: that is
   what found `blendModeBadge`'s `badge={` count (1 in the shell before, 0
   after, 1 in the component) and `colorPickerClose`'s two
   `setColorPreview(null)`. Three suites spelled the vendored package path
   by hand, **three different ways across the three apps**; they use
   `editorSource` now, which is the one spelling of it.

   **And the sweep still missed one, which round 1's review caught — a
   LISTING is not a fix.** `tileTool.test.ts`'s gate pin read the shell for
   `'{gridActionsTargetOpen'`, and the shell still contains that literal:
   the prop pass-through `gridActionsTargetOpen={gridActionsTargetOpen}` has
   it as a substring. So the assertion went on passing while asserting
   nothing about the gate it names. It was IN the sweep's output and the
   fix went to the other flagged line in the same file (`{patternRadialUp ? (`,
   four lines down), which is the whole lesson: a sweep that reports is only
   half the work, and the line that gets missed is the one next to the line
   that gets fixed. Its TWIN was in DrawBots, as the rule says to expect.

   The remedy is a check that cannot be read past: **a re-pointed pin is
   mutation-tested, not eyeballed.** Breaking the gate in
   `PatternGridActions.tsx` now fails `tileTool` in both apps that have it;
   before the fix it failed nothing. Two more pins were caught by running
   that check over every survivor rather than the named one:
   `patternActionsCapsule`'s duplicate `TARGET` (identical to the
   module-level one it shadowed) and — PRE-EXISTING, not this sub-stage's —
   `rigParts.test.ts`'s `panelPx={panelOccludedPx}`, which five components
   satisfied before 6.5b.4 and three do now, so deleting the rig panel's own
   line left it green. It is sliced to the rig's own mount now, and the two
   halves of that test are pinned apart because they live on different
   components: the rig panel READS the occupied height, the properties panel
   REPORTS it.

   **And "over every survivor" was still too narrow a claim, which round 2
   caught.** That sweep covered the pins that read text which MOVED. It did
   not cover the pins this sub-stage WROTE — the `…and the shell hands it
   over` half of every split fact — because those read text that is new
   rather than relocated, so they were in no survivor set. Audited properly,
   FIVE of them could not fail, because another call site in the shell
   satisfies the same literal: `insets={insets}` (five of the eight
   components take it), `patternFillSliderUp`, `patternEditIsShapeFill` and
   `openRadialCapsule` (each a prop of two of them), and
   `colorBrushOpacity`, which the CANVAS also takes — that last one was
   also, character for character, an assertion already three lines below it.
   Each is sliced to its own mount now and mutation-tested by dropping that
   prop from that mount; the duplicate is deleted.

   **And the first attempt at that slicing was itself wrong in a way the
   guard could not catch** — found by the next review round, and the sharpest
   version of this stage's own lesson. `sliceBetween(SHELL, '<CanvasSurface',
   '/>')` does not bound the canvas's mount: `'<CanvasSurface'` matches
   `useRef<CanvasSurfaceHandle | null>` three thousand lines earlier, so the
   slice ran from a hook declaration to the first `/>` of the whole render
   tree. **Both markers were FOUND, so `sliceBetween`'s two-ended guard
   never fired** — the pin passed over a region it was never meant to see,
   and the commit message saying it was "sliced to the mount" was false.
   A two-ended guard proves a slice is BOUNDED, not that it bounds the right
   thing; a tag opens a mount only at the end of a line.
   The fix is the engine's `mountOf(src, name)` beside `sliceBetween`
   (`packages/editor/src/__tests__/sourceSlice.ts`), which spells the
   `'<Name\n'` start once for every app and every call site, and is
   pinned over a fixture that contains exactly the `useRef<NameHandle>` trap.
   Where a helper's correct use has a subtlety in it, the subtlety belongs
   inside the helper.

   **And putting it inside the helper paid for itself within the hour.**
   `mountOf` also REFUSES a component mounted twice rather than bounding the
   first silently, and the first sweep onto it hit that throw at once:
   `SymmetryModal` is mounted twice in CozyJournal's and DrawBots' shells, so
   `modalHeaderAlign`'s inset pin had only ever checked the FIRST of them — a
   hand-rolled `slice(at, at + 200)` cannot tell you that, and the throw did,
   immediately, in a suite nobody suspected. That pin asserts over every
   mount of each tag now. **A helper that refuses what it cannot do
   correctly finds the places that were already doing it wrong.**

   **The pin-idiom paragraph is a different section in each of the three
   maps, and the commit messages named it wrong twice.** It is
   CozyJournal.md §4.1, Sol.md §8 and DrawBots.md §4.2. The first slip
   carried CozyJournal's §4.1 across to Sol; the second, in the very fix
   whose stated lesson was that a section pointer has to be looked up per
   app, called DrawBots' §4.2 "§8" — because that is where Sol's had just
   turned out to be. **Carrying the correction across is the same mistake
   as carrying the original.** Neither was load-bearing, since no document
   cites either pointer and `check:doc-paths` validates paths rather than
   section numbers; the reviewer caught both.

   Seventeen more are unique but name a REQUIRED prop, so `tsc` refuses the
   removal and the pin only restates it. Those stay: they can fail, they
   document the hand-over where a reader meets it, and three of the set —
   `patternEditBounce`, `tileRadialRingArt`, `paintMenuLitKeys` — name
   OPTIONAL props, where the pin is the only thing that would notice.
   **The rule that generalises: a pin on a prop hand-over is worth its line
   only if the literal is unique to that mount.** Otherwise slice it to the
   mount, or drop it and let the typechecker carry the fact.

   The test and suite COUNTS did not move — CozyJournal 673 / 10,965; Sol
   278 / 3,327; DrawBots 557 / 9,524; engine 404 of 405 / 7,347
   (`cameraRoll`, pre-existing — no `expo-media-library` here). No package
   suite was added, because a `.tsx` cannot be imported in this repo's jest
   (the react-native shim carries no `Animated`/`StyleSheet`, and the JSX
   setting makes a component's own `import React` read as unused). These
   eight are pinned the way the package's other 25 components are: as
   SOURCE TEXT from the apps' suites, which is `CanvasSurface.tsx`'s
   precedent since stage 5b.

   Dead imports: fifteen bindings in all three apps, plus `compSnapStep` in
   Sol alone (CozyJournal and DrawBots still read it elsewhere) and the
   whole `{ FloatingTargetStrip, SliderModeTarget }` declaration, whose two
   bindings were read only inside the two regions that moved. Keyed by
   import SPECIFIER and diffed against HEAD under `--noUnusedLocals`, so
   the ones already unused were left alone: the count is back to exactly
   what it was (8 / 26 / 19). **The TS6192 "all imports in this declaration
   are unused" message is identical in all three apps, so de-duplicating
   the diff by message TEXT hid it** — and that is how the last of those
   bindings was nearly left behind.

   **The gap this sub-stage widens, for the fourth time.** The owner's call
   was to proceed without a renderer (2026-10-26, §4.3), and what pins
   these eight components' behaviour is byte-identity with three shipped
   apps, three typechecks, and source-text reads. For a render tree that is
   the weakest the argument has been: what a render tree does wrong, it
   does visually, and nothing here would catch a tree that mounts in the
   wrong order or drops a prop whose name both sides spell consistently.
   The eight were chosen partly for that — each is a self-contained piece
   of floating chrome, not the frame — but it is the reason the frame
   should not follow them on this evidence. See "Still open".

   **6.5b.5 — Done: the two groups that would not place, cut and moved**
   (2026-10-26). The last slice of 6.5b, and it is the two components §4.2
   item 6 held back TWICE — at 6.5b.2, and again on re-measurement at
   6.5b.3 — both refused for the same reason: not placeable as one hook in
   any of the three apps.

   | hook | statements | what it is |
   |---|---|---|
   | `useTextCaretState` | 7 | the caret, the anchor, the seek, the blur backstop |
   | `useTextCaretSeek` | 4 | moving the caret, and the guard that keeps a seek from committing |
   | `useDefaultFontState` | 3 | the font the next text is born in, and the drag's base state |
   | `useDefaultFontCommit` | 2 | `onTextStyle`, and remembering the font it used |

   **16 statements / 106 lines out of each app**, and the shells are
   8,684 / 6,124 / 7,212 (Cozy / Sol / DrawBots). (The figures first written
   here were 102 and four lines higher: they were measured before the double
   blank lines the generated call sites left were taken out, which DrawBots'
   review caught. A measurement is only as current as the last edit.)

   **6.5b.3's lesson is the whole of this sub-stage, and it is now proven on
   the cases it was written for.** That lesson: a group that fails the
   placement gate is not thereby immovable — where `lo` is a single
   statement most of the group depends on and most of the rest is read
   BEFORE it, that statement is the seam. 6.5b.3 found it on the colour
   complex, and the record said the two refused groups "were never re-tried
   against this, and 6.5b.5 should". Re-tried, and both cut:

   - The CARET group reads `sessionRef` at Cozy's body statement 114 and is
     read back at 9 (`lo=114 hi=9`). The seam is that read: the state half
     depends on nothing and places in (-1, 9); the handler half places in
     (213, 220).
   - The FONT group reads `applyEntry` at 180 and is read back at 138
     (`lo=180 hi=138`) — the same shape, and the same seam 6.5b.3 cut the
     colour complex at. State places in (-1, 138), commit in (309, 518).

   All four halves place in all three apps. The handler half's window is
   seven statements wide in CozyJournal and DrawBots, which is tight and is
   the honest reading of why these two were the last to move: the room was
   always there, but only after the cut.

   And the context object did not need inventing a third time. Every input
   of both back halves is one of the four allowed inputs or a name the
   matching FRONT half hands back — `useTextCaretState`'s and
   `useDefaultFontState`'s own documented returns, exactly as
   `useBarColorState` was for the bars.

   **TWO deviations from byte-identity, both declared** (§4.2 item 6's rule).
   The second was found by Sol's review and is a real latent defect:
   `rememberFont` kept `useCallback(…, [])` while `updateSettings` and
   `setDefaultFontId` became PARAMETERS. In the shell both were module-scope
   or a stable setter, so the empty list was right; as parameters they are
   captured forever — a stale closure for any consumer whose
   `updateSettings` is not stable. **`useBarColorState` made exactly this
   deviation at 6.5b.3 for exactly this reason**, and recorded it; the rule
   was one sub-stage old and this is the one place it was not applied. A
   rule set by the previous slice is not yet a habit.

   The first:
   `caretSeek`'s declaration was
   `useState<\n { start: number; end: number; seq: number } | null\n>(null)`
   and is now `useState<CaretSeek | null>(null)`, with `CaretSeek` exported
   from `useTextCaretState`. Two reasons, the first of which is a TOOLING
   fact worth recording: **the statement splitter every measurement in this
   stage runs through truncates a multi-line GENERIC ARGUMENT.** It cut the
   declaration in half and left `>(null);` orphaned in the shell — the lift
   typechecked nowhere and the error pointed at the generated file rather
   than at the splitter. Rather than teach `body.js` about angle brackets at
   the end of a stage that has trusted it for four sub-stages, the
   declaration was normalised first, identically in three apps. The second
   reason is that the shape wanted a name anyway: the seek hook has to type
   the setter it is handed, so spelling the shape inline in one and by name
   in the other would be the same type twice.

   **What this leaves, and whether stage 6 is complete.** The closed set
   under the four allowed inputs is now **121 statements / 766 lines in 94
   components, 76 of them singletons** — from 136 / 890 / 96 / 76. The
   count byte-identical in all three went 224 → 209, for 6.5b.3's reason:
   16 statements left and four hook calls replaced them.

   What remains is **76 singletons and 18 multi-statement groups**, and the
   largest of those is now 43 lines. The singletons are HELD on the owner's
   standing call (§4.3, 6.5b.1's reason: a cluster averaging six lines has
   no module to belong beside). **The 18 are the same judgment one size up,
   and that is a recommendation rather than a decision taken here**: a
   2-statement, 14-line hook in the package costs an import, a call site, a
   return type and a suite entry to save fourteen lines in three files. One
   of them must stay regardless — `insets` / `headerless` / `chromeInsets`
   is `useChromeInsets`, refused at 6.5b.2 because it would be the only
   `packages/editor` file importing `react-native-safe-area-context`, and
   that rule outranks a clean measurement.

   So: **stage 6's movable part has moved.** What is left in the three
   shells is the app-only bucket (82 / 58 / 36 statements, unchanged by
   every slice since 6.5b.2 — see below), the render tree's FRAME (6.5b.4's
   entry says why it stays), and dust. Whether the dust is a sub-stage is
   the owner's call and the last one stage 6 needs.

   **6.5b.2+ — the measurement 6.5b.2 was planned from, and why it is
   plural.** The shell's BODY, measured 2026-10-25 over the three apps'
   HEAD before 6.5b.2 took the first slice out of it. This is the
   measurement 6.0 did not have: 6.0 counted LINES (89 % of
   DrawBots' shell appears verbatim in CozyJournal's, in runs up to 730)
   and concluded "the shell moves". Counting DECLARATIONS instead says
   something the line count cannot.

   `EditorShell` is ONE component of 9,069 / 6,867 / 7,757 lines — 6.5b.1
   shortened the FILE and not the component. Its body holds 624 / 553 /
   571 statements:

   | | statements | lines (Cozy) |
   |---|---|---|
   | named, in all three, byte-identical | **340** | 2,944 |
   | named, in all three, differing | 95 | 2,018 |
   | named, in CozyJournal + DrawBots only | 42 | 537 |
   | named, in CozyJournal + Sol only | 6 | 69 |
   | named, one app alone (Cozy 82 / Sol 58 / DrawBots 36) | 176 | 1,652 |
   | anonymous (the effects, and the render tree) | 59 | 2,374 |

   **Two thirds of the body is in all three apps, and it still does not
   move as a file.** Three findings, each measured:

   · *The shared statements do not come out as a block.* Over
     CozyJournal's order the 624 statements fall into **250 runs** of like
     kind — the 340 identical ones in 85 of them, the 176 app-only ones in
     45. The longest run of consecutive all-three-identical statements is
     15. There is no cut that takes the shared half and leaves the rest.

   · *What a partial extraction costs is the context object §4.3 warned
     of, and it is measurable.* Of the 340 identical statements, only
     **179** read nothing else in the body; allow four names as inputs —
     `session`, `sessionRef`, `setSession` and the app's own `applyEntry`
     — and **252** of them close, 1,987 lines. The chokepoints are
     exactly those four: 58 of the excluded statements want `sessionRef`,
     36 want `applyEntry`, 22 `session`, 15 `setSession`. So a slice is
     affordable, and only when it is chosen for closure. (These two
     figures read 195 and 268 until 6.5b.2 found two bugs in the
     extractor — a declaration under a JSDoc block was invisible to the
     name map, and a spread read as a member access. The entry above
     records both. Every other number in this entry came from `body.js`
     itself and is unaffected.)

   · *The render tree cannot be the package's AS A WHOLE.* It was
     1,624 / 1,169 / 1,452 lines, mounts 36 / 38 / 34 components, and
     reads 47 / 30 / 36 body names that are not in both other apps;
     7 / 9 / 5 of the components it mounts are not mounted by both others
     (CozyJournal's `RigControlsPanel`, `RigSidesCapsule`,
     `ResponseSendModal`, `InstructionsOverlay`; Sol's `LabSheet`,
     `StrainChips`, `PlantGrid`, `CrossbreedSheet`, `RevealOverlay`;
     DrawBots' `DrawBotsLayer`, `SimSpeedRow`). §4.1's `capsules(session)`
     seam covers some of the floating chrome and is still unbuilt; nothing
     covers the rest.

     **6.5b.4 took the eight PIECES of it whose props are a normal
     component signature and left the FRAME, and the entry above is why**:
     the frame is 93–95 % shared text and still unmovable, because what
     interrupts it is forty-odd one-line holes rather than a few
     overlay-shaped ones, and the two large regions that look liftable
     need 48 and 42 props. The sentence above stands as written for the
     frame. It was never true of the whole render tree in the sense it
     reads, though: on 6.0's OWN measure the tree is 88 % / 80 % verbatim
     in CozyJournal's, as shared as the file around it — the 59 % / 73 %
     this entry's planning rested on was a different script measuring the
     other direction.

   **The seam DrawBots already ships — measured, and it is not the render
   tree's answer.** DrawBots mounts four of its own screens as
   `{lookPage.overlay}`, `{makeBot.overlay}`, `{editBot.overlay}`,
   `{collectionPage.overlay}` — each a hook (`useLookPage`, `useMakeBot`,
   `useEditBot`, `useBotCollectionPage`) returning a node and the handlers
   that go with it, and that is a real shape one app has already built.
   What 6.5b.4 measured is that it does not COVER the problem: the
   app-only content of the render tree is 110 / 60 / 87 lines in
   **41 / 11 / 42 blocks, most of them one line** — props on components all
   three mount, and style ternaries inside shared expressions. An overlay
   carries the handful of big blocks (DrawBots' own four `{x.overlay}`
   lines are already four of them) and none of the pinpricks. So the claim
   was worth checking across all three apps before anything was installed
   on it, which is 6.5a's lesson — and checking it is what stopped the
   seam being built.

   **So 6.5b is a programme, and the order is the stage's own rule — most
   closed first.** Settled by the owner 2026-10-25 (§4.3) and now all
   five sub-stages done:

   | | | measured |
   |---|---|---|
   | 6.5b.1 | done | the file-level leaves |
   | 6.5b.2 | done | eight closed clusters as hooks: 56 statements, 465 lines of each app |
   | 6.5b.3 | done | the colour-and-effects complex as five hooks: 61 statements, 640 lines of each app, cut at the commit pipeline |
   | 6.5b.4 | done | the render tree's floating chrome as eight components: 286 / 284 / 293 lines, and NOT the frame |
   | 6.5b.5 | done | the two groups that would not place — the caret and the default font — CUT at the statement that blocked each, 16 statements / 106 lines of each app |

   **What 6.5b.3 found, and why the objection was aimed at the wrong
   thing.** The case against moving the bar handlers alone, twice on the
   record, was that they would need a context object of some fifty members
   threaded through. 6.5b.3 measured it and the objection does not survive
   — but neither does the shape of the question.

   The obstacle is not the width of the return. It is HOOK ORDER. The
   59-statement colour component is not placeable as one hook in ANY of
   the three apps: it reads `applyEntry`, the shell's own commit pipeline,
   at body statement 200 / 155 / 179, and its colour state is read back at
   125 / 83 / 99 by the fade sync and the colour effects. `lo > hi`, so no
   call site exists — which is 6.5b.2's placeability gate, and the same
   failure as the caret and default-font groups. A wide return was never
   what stood in the way; it would not have mattered how narrow it was.

   Cut at the pipeline, and then by bar, and the thing the plan declined
   to invent turns out not to need inventing. Every input of all four bar
   hooks is either one of the four allowed inputs or a name the front half
   already hands back: `useBarColorState`'s own documented return IS the
   context object, so nobody had to write one. The entry for 6.5b.3 below
   has the five hooks and their windows.

   The one thing the earlier measurement settled outright still holds:
   "the shell itself, bar handlers inside it" was never a sub-stage.

   **6.2b's measurement, kept.** The measurement below is 6.2b’s, from
   2026-10-23, kept because it is what re-ordered the sub-stages: the
   stage’s own rule is to measure before planning, and that measurement
   made 6.2b a different and much smaller job than "the shared half of
   `web/store/*`" sounds.

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

   **The one design question 6.2b had to settle was the owner's, and it is
   now ANSWERED** (§4.3, settled 2026-10-23): a base record plus a generic.
   `JournalEntryBase` holds the 18 fields all three `JournalEntry` types
   have, the package's store is `EntryStore<TEntry extends
   JournalEntryBase>`, and each app keeps the declarations that read a field
   of its own — which the corrected measurement says is **`createEntry`
   alone**. Of the 41 declarations in all three apps, 9 touch no entry field,
   31 touch only fields all three records share, and one touches a field
   that is not in all three. §4.3 records the answer, the first count's
   error, and why the extractor produced it.

   Stage 3 had answered the same question for the session
   (`EditorSession<TTool, TDoc, TOps>`) and §4.3 again for `ToolId`, where
   neither posed option was taken; this is a third shape again, and narrower
   than either, because most of `entryStore` never reads a field: it is key
   layout, the per-format index, the sidecar images and the settings merge,
   over a record it only stores and hands back.
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
  95 % stated as a count. The shell was 10,077 lines when 6.0 measured it,
  not 10,682, for the same reason (10,013 at 6.5b.1). Where 6.0 DIFFERS from this note is the order: it reads
  "they will fold too" as an argument for taking them WITH the shell rather
  than ahead of it, which is what §4.2 item 4 itself concluded — see item 6.

  **And what the REST of stage 6 inherits, 2026-10-25, now that the host
  is done and the shell is measured.** This note's third paragraph is
  where it has to be read again. It says the handlers "will fold too" and
  that the shell "is the first mover whose range may genuinely not fit",
  and both halves have now been tested as far as they can be without
  moving the shell. The range does not look like the problem: 6.6a, 6.6b
  and 6.5b.1 together measure 82 KB in Sol and 85 in DrawBots on a clear
  queue (§5), against the 890 KB a stage-3 range passed at. What IS the
  problem is the one this note did not look at, because at 5b.4 there was
  no reason to — the shell is not a file that can be moved and then
  configured. §4.2 item 6's 6.5b.2+ entry has the measurement: 435 of the
  body's 659 named statements are in all three apps, and they lie in 85
  separate runs among 250. The props paragraph above is still right about
  WHAT collapses when the shell is the package's; what it assumes, and
  what the measurement denies, is that there is a single move at which
  that happens.

- **How `entryStore.ts` carries each app's own entry record** (asked at
  6.2b's measurement, answered by the owner 2026-10-23). **A base record
  plus a generic**: `JournalEntryBase` holds the 18 fields all three
  `JournalEntry` types have, the package's store is
  `EntryStore<TEntry extends JournalEntryBase>`, and each app keeps the
  declarations that read a field of its OWN.

  The measurement is what shaped the question, and a corrected measurement
  is what made the answer this one. Of the 41 declarations `entryStore.ts`
  has in all three apps, **9 touch no entry field at all** (the prefixes,
  the filter, the settings pair), **31 touch only fields all three records
  share**, and **exactly ONE — `createEntry` — touches a field that is not
  in all three** (`pageId` and `unlisted`, which CozyJournal and DrawBots
  have and Sol does not). The drift sits in the same place: `createEntry`
  drifts 20/25 against CozyJournal and the five namespaced prefix constants
  drift 2 each, which is the one word 6.2a already made a seam.

  **The first count given to the owner was wrong and the method is the
  warning.** It read "35 of 41 move, 6 read a CozyJournal-only field",
  because the extractor gave each declaration the text up to the NEXT
  declaration — and so credited each with the FOLLOWING one's doc comment.
  `getView` was charged with `seedRevealRecipe` (named in `setSeedReveal`'s
  comment below it), `setThumb` with `setEntrySeededFills`', and
  `listEntries` with a field called `flat`, which is `Array.prototype.flat`.
  A doc comment belongs to the member below it; an extractor that assumes
  otherwise reports drift that is not there. The same bug reported 9 of
  `EditorConfig`'s 22 shared fields as differing when 21 of 22 are
  byte-identical.

  Note what makes this seam unlike every other in the plan: it is the
  user's STORED DATA. A wrong font family shows the system face for a
  moment; a wrong answer here is not a visual regression.

- **Whether `EditorHost.tsx` becomes the package's screen** (asked at 6.0,
  answered by the owner 2026-10-23). **The ~200-line state machine moves
  and each app keeps a route table over it** — resolve the query, let a
  `NAVIGATE_TO` override it, hold at the placeholder while warm, mint a
  multi-file page once per session, clear the action screens, mount the
  shell. Each app's ACTIONS stay the app's: they open that app's own kinds
  of page (CozyJournal's `openGlyph`, `openRedline`, `openSocialTurn`,
  `takePageForks`, `takePageNames`; DrawBots' `pushFormats` and its salvage
  channel; Sol's `canvasIssue` and its strain routes). So item 6's "the
  host becomes the package's screen" is narrowed, not abandoned: about 200
  lines three times over, which the measurement says is all that is
  genuinely shared — three declarations in all three apps, longest shared
  run 33 lines against the shell's 730.

- **How the editor query's keys are carried** (decided at 6.6a,
  2026-10-25, by the measurement rather than by the owner — it needed no
  call, and it is here because the next seam of this shape should not
  re-derive it). **The readers take the key list; the keys stay the
  app's.** `QUERY_KEYS` is 28 / 13 / 21 keys and they ARE each app's
  routes, so there is nothing to unify; the seven byte-identical READERS
  over them are the whole of the shared half, and they become
  `parseSearchFor(keys, …)` and the rest, with five thin wrappers per app
  binding them. Eleven keys are common and the package names them
  (`COMMON_QUERY_KEYS`) only because the shared host state machine reads
  exactly those.

  The general form, which is now this plan's commonest answer and worth
  stating once: where a function is shared and its DATA is not, the data
  becomes a parameter and each app keeps a one-line binding under the old
  name. That is 6.1's `FontPack`, 6.3b's `CommonEditorConfig`, 6.5a's
  `overlayZ`, 6.5b.1's `ColorPickerSpec` and this. It is cheap precisely
  because the binding keeps the old name: none of the 11 / 5 / 13 modules
  that import `editorQuery` moved a line.

- **`EditorHost.tsx` — the call of 2026-10-23 is CARRIED OUT** (6.6b,
  2026-10-25), and two things about it were not knowable when it was
  taken. The state machine is 200 lines of `hostRoute.ts` and each app's
  host is its route table, as settled. The two widenings are recorded in
  §4.2 item 6 and both say the same thing in different registers: a route
  can arrive from a SECOND place the app owns (DrawBots' in-page router),
  and a resolved route is not write-once (CozyJournal revises it twice).
  Neither was in the 6.0 measurement, which counted the resolve effect
  and never asked who else wrote the state it sets. **A seam's
  measurement has to cover the WRITERS of the state it takes over, not
  only the code it is replacing** — the 6.5a lesson one turn further on.

- **How 6.5b is sliced — SETTLED** (by the owner, 2026-10-25, on the
  measurement below). **Take the slicing; 6.5b.2 is the closed clusters
  whose return is a normal hook signature, and stage 7 stays where it is.**
  The 59-statement colour-and-effects component is HELD: a hook returning
  fifty-odd names is the context object this plan has twice refused to
  invent, and it waits for 6.5b.5. The singletons are held too, for 6.5b.1's
  reason — a cluster averaging six lines has no module to belong beside.

  **The hold on the colour component was lifted at 6.5b.3 — SETTLED** (by
  the owner, 2026-10-26, on 6.5b.3's own measurement): **take all five
  hooks.** The reason for the hold did not survive measuring, and not
  because the return turned out to be narrow. As ONE hook the component is
  not placeable in any of the three apps (hook order, not signature
  width), and split at the commit pipeline every half places — at which
  point every input of all four bar hooks is one of the four allowed
  inputs or a name the front hook already returns. The context object this
  plan twice refused to invent is `useBarColorState`'s own documented
  return; refusing to invent it was right, and so is not having to. The
  SINGLETONS stay held, for the reason above, and are 76 of what 6.5b.5
  inherits.

  The question the measurement put to the owner was whether stage 7 should
  go first, and the answer the measurement itself gave is that the two were
  never competing: the rig's 29 Cozy-only statements are in the APP-ONLY
  bucket and block none of the 35 closed components. Stage 7 shrinks 6.5b.4
  (two of CozyJournal's seven unique mounts and twelve of its 47 unique
  render-tree reads are the rig's) and 6.5b.5 — not 6.5b.2. So it is still
  doable today, still the owner's call, and no longer blocking anything.

- **A closed cluster is not yet a movable one: hook ORDER is a second
  gate** (learned at 6.5b.2, and the one thing that measurement did not
  predict). The read graph says what a group of statements needs; it says
  nothing about WHERE the one call that replaces them can stand. A group's
  statements are scattered through the body, so extracting one collapses
  them to a point that must sit after everything it reads and before
  everything that reads it — and two of the ten components that closed had
  no such point, in any of the three apps. Both were the same shape: a
  `useState` read by an early effect, grouped with a handler that needs
  `applyEntry` two hundred statements later. **Measure placement before
  calling a cluster movable**, and measure it in all three apps: that it
  failed identically in all three is what made it a fact about the shape
  rather than an accident of one app.

  **And it is a gate that can be OPENED, which 6.5b.2 did not see** (6.5b.3).
  The 59-statement colour component failed it for exactly the same reason
  as those two — pre-pipeline state grouped with post-pipeline handlers —
  and the failure NAMES the cut: `lo` is the pipeline, so splitting there
  gives a front half that ends before `hi` and a back half that starts
  after `lo`. Both halves then placed with hundreds of statements of room,
  and the back half split again by subject with no further cost. So a
  group that does not place is not thereby immovable; where `lo` is a
  single statement that most of the group depends on and most of the rest
  is read before it, that statement is the seam. The two groups 6.5b.2
  refused are still refused on re-measurement at 6.5b.3 — but they were
  never re-tried against this, and 6.5b.5 should.

- **The package stays free of native dependencies, and that outranks a
  clean measurement** (6.5b.2). `useChromeInsets` closed, placed in all
  three apps and was byte-identical — and it would have been the only file
  in `packages/editor` importing `react-native-safe-area-context`. The two
  other users of that module in this repo sit in `packages/shell/src/app`
  and `.../components`, both excluded from the root tsconfig, which is how
  the dependency has been kept off the typechecked surface. It stays with
  the apps, which is 6.1's call about `faceUri` and expo-asset a second
  time. The general form: **a cluster that measures as shared can still be
  refused on the package's own terms**, and the suite is what finds it —
  this one was caught by the suite failing to load, not by reading.

  **6.5b.4 applied it at no cost, which is the cheaper half of the same
  rule.** FIVE of the eight components need the safe-area inset —
  `BrushControlsGroup`, `ColorPickerStack`, `PatternFillSlider`,
  `PatternGridActions`, `PatternRadialTarget` — and they take it
  structurally, `insets: { bottom: number }`, rather than as an `EdgeInsets`
  from `react-native-safe-area-context`. (`CanvasRadialMenus`,
  `PhotoSourceInput` and `TileTransformCard` take no inset at all.) An
  `EdgeInsets` satisfies that shape, so nothing at the call sites changed
  and no package file imports the native module. Where a native type is
  only being READ through one field, the field is the dependency.

  This sentence said "six" until 6.5b.4's second review round — a wrong
  count about this change's own code, in the same commit range as a
  paragraph insisting on sites over counts. **The rule applies to the
  sentence being written, not only to the ones being corrected**, so the
  five are named.

- **How 6.5b.4 is shaped — SETTLED** (by the owner, 2026-10-26, on the
  measurement in §4.2 item 6). **Take the long verbatim runs as package
  components; do not install the overlay seam and do not move the frame.**
  Put to the owner with the corrected measurement, against two
  alternatives (install the seam and move the shared frame; or do stage 7
  first and re-measure). What decided it is that the frame's interruptions
  are forty-odd ONE-LINE holes rather than a few overlay-shaped ones, so
  the seam would not have carried them, and the two large liftable-looking
  regions need 48 and 42 props — the context object this plan has now
  refused four times. The eight pieces that moved are the ones whose props
  are a normal component signature, 4 to 13 of them.

  It also means the Sol feature gap below was not forced, which was the
  point of asking: moving the frame would have required it.

- **The renderer: proceed without one — SETTLED** (by the owner,
  2026-10-26). 6.5b.3's recommendation was that the jsdom decision come
  BEFORE 6.5b.4, because a render tree is where byte-identity reassures
  least. Put to the owner with that reasoning and two alternatives (add
  jsdom first; or plan and then decide). **The call is to proceed without
  it**, pinning the moved JSX as source text through
  `editorSource(…)` — `CanvasSurface.tsx`'s precedent, and how the
  package's other 25 components are already covered. The gap stays on the
  Still-open list, and 6.5b.4's entry says what it now costs: nothing here
  would catch a tree that mounts in the wrong order or drops a prop whose
  name both sides spell consistently. It is a tooling change in a
  directory this work does not edit, and it stays the owner's to want.

Still open:

- **Six features Sol does not have, which the canonical-app rule would
  give it** (raised 2026-10-26 by 6.5b.4). Of the 47 app-only names
  CozyJournal's render tree reads, 19 are a group of 18 that CozyJournal
  and DrawBots SHARE and Sol has nowhere in `web/` at all: the symmetry
  capsule and its modal (`symmetryMenuOpen`, `symmetryModalOpen`,
  `symmetryCapsuleUp`), the title band and its ask (`titleAsk`,
  `titleAskBody`, `titleDraft`, `setTitleDraft`, `onTapTitleBand`), the
  reset ask (`resetAsk`), the instruction band (`bandInstruction`,
  `instruction`, `onBandDone`, `setBandGrowPx`), the region markers
  (`regionMarkers`) and the tile-tool region drags (`tileToolButton`). The
  counts are identical in the two apps that have them — 5/5, 2/2, 4/4,
  2/2, 2/2, 7/7 — so this is one shared feature set, not parallel drift.

  §4.3's canonical rule says Sol and DrawBot are made like CozyJournal
  where they disagree. Here that means ADDING SIX FEATURES to a shipped
  app, which is a product decision of the same class as the push brush
  below, not a consolidation — so the rule does not reach it and nobody
  should read it as pre-decided. **It is the single largest thing standing
  between the render tree's FRAME and the package**: those 18 names are
  most of the one-line holes that made the overlay seam the wrong shape.
  Nothing forces it, and 6.5b.4 was deliberately shaped so that it is not
  forced.

- **An orphaned comment band in DrawBots' shell, now beside new code**
  (found 2026-10-26 by 6.5b.4, deliberately NOT fixed). Immediately above
  DrawBots' `PatternGridActions` call site stands a nine-line band
  describing "the rig radial's second level: the active family's moves as a
  capsule under the toolbar" — a capsule DrawBots does not mount, and did
  not mount before this sub-stage either. It is a pre-existing orphan; what
  6.5b.4 changed is only that it now abuts a call site it does not
  describe, which reads worse than it did beside a band that at least
  shared the subject. Deleting prose from a shipped app's shell is not this
  work's to do on its own judgment, and the diff did not make it false. One
  line of the owner's time either way.

- **Two deferred sweeps over the suites' source pins**, both named by
  6.5b.4's review rounds and both deliberately not taken in them.

  *Hand-spelled vendored paths.* `colorPickerOpacitySlider`,
  `colorPickerClose` and `modalHeaderAlign` read package source by hand —
  and in THREE different spellings across the three apps, which is the whole
  reason `editorSource` exists. `modalHeaderAlign`'s was converted because
  the round named it; the rest were left because converting them is a
  multi-line edit in three differently-worded files and 6.5b.4 was at its
  third round, with no margin for a slip in a suite nobody had asked about.
  Eight sites, listed by the round-2 and round-3 records.

  *Hand-rolled region slices outside the mount class.* The wider backlog the
  `sliceBetween` entry already records, plus the `indexOf('<Tag')` ordering
  assertions, which are a different shape — they compare POSITIONS rather
  than bounding a region, so the two-ended guard does not apply to them.
  Worth separating when the sweep happens: the dangerous ones are the
  slices, not the comparisons.

- **Whether `review.js override` should require the grant it names**
  (raised 2026-10-26 by Sol's review of the grant itself). The round cap and
  the `--autonomous` scope were made SCRIPT refusals on the stated
  principle that prose is a gate only while a person is reading it — but
  `override`'s own precondition, that the owner granted an autonomous pass
  for this work at all, stayed prose. It needs no terminal, no
  `--autonomous`, and no recorded grant: only a review that refused. So the
  one path by which an agent can clear a reviewer's objection and push is
  the one path still held open by a sentence. Tying it to the same grant
  `ship --autonomous <sha>` already names would close that, and the
  reviewer is right that the asymmetry is hard to defend on the principle
  this work argued for. Not taken here: it is a change to the gate's own
  authority, which is the owner's to want rather than the agent's to grant
  itself in the same stretch where it first used the gate.

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

- **Whether stage 7 goes next** — the question is no longer about ORDER:
  6.5b is finished, so there is no rest of it for stage 7 to go before and
  no sub-stage it overlaps. What is left is simply whether stage 7 is the
  next thing done. It never contended with any slice of 6.5b, and the
  measurement said so at each one rather than being assumed: the rig's
  twelve render-tree reads and two unique mounts are all in the FRAME,
  which 6.5b.4 left where it was, and the app-only bucket is exactly what
  it was before the first slice (82 / 1,099 in CozyJournal, 58 / 286 in
  Sol, 36 / 267 in DrawBots) — five slices, every statement out of the
  SHARED bucket. The stage-5 and 6.5b precedents are both the owner's, on
  the same kind of evidence.

- **No renderer, anywhere — SEVENTEEN hooks AND eight components in the
  package because of it** (raised 2026-10-25 by 6.5b.2; sharper after
  6.5b.3; the owner's call at 6.5b.4 was to proceed without one). There is no
  React renderer in this repo's jest (`testEnvironment: 'node'`, no jsdom,
  no testing-library) and none in any of the three apps, which is why 6.6b
  wrote `hostRoute.ts` as pure functions under thin hooks and why every
  screen fact in all four repos is pinned as SOURCE TEXT. 6.5b.2 moved 465
  lines of state and handlers into `packages/editor` whose behaviour is
  pinned nowhere; 6.5b.3 moved **640 more**, and they are not plumbing —
  `applyStrokeEdit`, `applyEffectEdit`, `commitEffectColor` and the
  confirms are the live-preview-and-commit dance for every colour the
  editor writes. The apps typecheck them, and the only safety argument is
  byte-identity with three shipped apps.

  **And 6.5b.5 added 106 lines more**, which is the point rather than an
  aside: the argument does not strengthen with repetition, and the total
  now unpinned by anything but byte-identity and a typecheck is 465 + 640
  + 286 / 284 / 293 + 106 lines of state, handlers and JSX across seventeen
  hooks and eight components — the render tree's figure being the one that
  differs per app, and `283` being none of the three. (It read 283 for one
  commit, in the half of a change whose other half existed to make exactly
  these figures current. **A number corrected in one place is not
  corrected.**) 6.5b.5 is the mildest of the four — sixteen statements
  of caret state and font plumbing — but it is also where a real latent
  defect got in (`rememberFont`'s empty dep list) and was caught by a
  REVIEWER rather than a test, which is exactly what this item says the
  arrangement costs. 6.5b.3's recommendation was that jsdom come BEFORE 6.5b.4,
  because a render tree is the one part of the shell where "it typechecks
  and the text is identical" reassures least — what a render tree does
  wrong, it does visually. **The owner's call was to proceed without it**
  (§4.3), and 6.5b.4 shipped on source-text pins. So the gap is no longer a
  recommendation waiting on an answer; it is a known, accepted cost, and
  what it now buys is worth naming exactly: nothing in any of the four
  repos would catch one of those eight components mounting its children in
  the wrong order, or dropping a prop whose name the call site and the
  signature spell the same way. The eight were chosen partly around that —
  each is a self-contained piece of floating chrome rather than the frame
  — and it is the standing reason the FRAME should not follow them on this
  evidence. Adding a jsdom environment to the engine's jest would turn
  byte-identity into a test. It is a tooling change in a directory this
  work does not edit, and it stays the owner's to want.

## 5. Process

**The consolidation has an AUTONOMOUS SHIP GRANT** (given by the owner,
2026-10-26). For this work, in these four repositories, the agent runs the
ship pass itself and takes the review's feedback round by round without
stopping — `npm run ship -- --autonomous <sha>`, where `<sha>` is the last
commit that is not the granted work. The general rule is unchanged
everywhere else: agents commit and stop (`tooling/CLAUDE.shared.md`
"Independent review and shipping", which is where the exception is defined).

This is the first standing grant in the programme, and what makes it safe
is that it moves WHO PRESSES the button and nothing about what the button
checks. Three properties hold it in place, and two of them had to be built
because prose would not have carried them:

- **The reviewer still decides every round.** `review.js accept` — the hand
  clear — stays the owner's and refuses to run without a terminal, which an
  agent's shell does not have. That was already true and is why the grant
  did not need it loosened.
- **The scope is the boundary, checked by the script.** An agent's commits
  carry the owner's name (`git log` cannot tell them from the owner's), and
  a push takes the whole `origin/main..HEAD` range, so "only my own work"
  is not a property that can be read off the history. What CAN be checked
  is where the granted work starts: `--autonomous <sha>` refuses the pass
  if the range holds any commit older than `<sha>`, and names it. A queue
  with someone else's commit in it goes back to the owner.
- **The round cap is a refusal, not a sentence in a skill.** Three rounds
  was always the rule and was always prose — a gate only while a person is
  reading it. `ship` now refuses round four on the same base (exit 7)
  before a reviewer starts. **A loop does not get tired of re-arguing a
  finding, which is exactly why the limit had to stop being advice.**

  The first cut of that cap was WRONG, and the grant's own first review
  round caught it: it asked the round number before asking whether the range
  was already cleared. An override and an owner `accept` both leave the
  review record at `changes-requested`, so the round count goes on rising
  on a settled range — and ship therefore refused round four on an
  OVERRIDDEN range, which is the one pass an override exists to make, and on
  an owner accept after three refused rounds, a path that predates the cap
  entirely. **A new gate is as dangerous as the thing it guards against: it
  broke the loop the same commit documented.** The cap asks
  `rangeCleared` first now, and two tests fail if that order is swapped.

**Disagreeing with a review, under the grant.** The rule was: say so to the
user and never work around it. With nobody to say it to between rounds,
that became `review.js override <base>..<tip> <reason>` — the agent's
recorded disagreement, which refuses unless a review actually ran and
requested changes, so it can never be a way past a review that did not
happen. It copies every blocking finding it disputes into its record, and
`ship` puts the same on the pushed commit's message
(`Review: OVERRIDDEN by agent`). `review.js` reports the three ways a range
clears under three different names — `passed`, `accepted by owner`,
`overridden by agent` — so no audit has to guess which happened.

The honest caution to carry: across this stage's review rounds, **nearly
every blocking finding has been correct**, including two that looked wrong
at first reading and one the agent's own sweep had already flagged and then
skipped. An override is for a finding that is wrong, not one that is
awkward; the record exists so that getting that judgment wrong is visible
rather than silent.

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

**Stage 6.3a's ranges are the smallest this plan has produced**
(2026-10-23): CozyJournal **23 KB**, Sol **29**, DrawBots **32**, against
the 890 KB a stage-3 range passed at. The sub-stage moves 418 lines of
source and 522 of suite, and the move folding shows each file once.
Measured with `review.js pending --prompt | wc -c`, as 6.1's note says to.

**With 6.3a to 6.3c on them** the three ranges are **97 / 83 / 106 KB**
(CozyJournal / Sol / DrawBots) — still about a tenth of what a stage-3 range
passed at, for three sub-stages that took some 1,900 lines out of the three
apps. 6.5's is still the one that has never been tried.

**With 6.3d, 6.2b, 6.4a, 6.4b and 6.5a on them the ranges are no longer
small** (2026-10-24): CozyJournal **709 KB**, Sol **659**, DrawBots **624**,
and the engine's own range **605**. Against the 890 KB a stage-3 range
passed at and the 3,293 KB the reviewer refused, that is inside the gate and
not comfortably — eight sub-stages of unpushed work in each app, some 5,000
lines moved, where the last recorded point was 97 / 83 / 106 KB after 6.3c.

These are CUMULATIVE over every unpushed commit, which is what `review.js
pending` means, so the number says as much about not having shipped since
6.1 as about any one sub-stage. The per-sub-stage figures 6.1's note asked
for cannot be recovered after the fact from a cumulative prompt; what can be
said is that five sub-stages added about 600 KB between them, roughly 120 KB
each, which is the same order as 6.1's 75 and 6.2a's 71 and nothing like
stage 3's explosion. The move folding is still doing its work.

**The practical reading for 6.5b.** A ship pass now, before the shell moves,
would take each app's range back to about nothing and leave 6.5b measured on
its own — which is the only way the question §5 has been asking since 6.1
("is the shell's range reviewable?") gets a clean answer rather than one
confounded by eight sub-stages of backlog. If instead 6.5b lands on top of
this, its range starts at 624–709 KB before the shell's own diff, and the
10,000-line file is exactly the one the folding has never been tried on. The
owner's call, and it is the first time in this stage that the ORDER of
shipping and moving matters to the measurement.

**And with the queue clear, three sub-stages measure 82 to 157 KB of
CODE** (2026-10-25, after 6.6a, 6.6b and 6.5b.1, measured before this
record was written): Sol **82 KB**, DrawBots **85**, CozyJournal **157**,
and the engine's own range **53**. Measured with `review.js pending
--prompt | wc -c`, as 6.1's note says to.

With the record ON TOP — the entries above, §1's re-measured table, this
paragraph's first draft and the three apps' codebase maps — the same
four ranges are **117 / 120 / 190 / 87 KB**. So **the writing-up costs
about 35 KB per range, every time**, which is a third of these
sub-stages' code and more than 6.3a's whole range (23 / 29 / 32 KB). It
is worth knowing and it is not worth avoiding: a stage whose record the
reviewer cannot see is the thing the gate blocks on. (Editing this
paragraph moves the number again by a little; it is not re-measured for
that, and chasing it would never terminate.)

This is the clean answer the paragraph above asked for, and it comes from
Sol's and DrawBots' numbers rather than CozyJournal's. Both of those
queues were EMPTY when this session began — the ship the owner ran before
it cleared them — so 82 and 85 KB are three sub-stages' own range and
nothing else: a move of 200 lines into `hostRoute.ts`, 168 into
`editorQuery.ts`, 99 into two leaf modules, the three hosts rewritten
over them and 27 source pins re-pointed. CozyJournal's 157 KB is the same
three sub-stages plus three review-fix commits from 6.5a that were never
shipped; the difference between 85 and 157 is roughly what those three
commits cost, which is a second reading of the same point §5 has been
making since 6.1 — **a cumulative prompt measures the queue, not the
change**.

**6.5b.2, the first slice of the shell, and the first per-sub-stage
figure this stage has** (2026-10-25, measured before this record was
written). Its OWN diff — one commit per repo, not a cumulative prompt —
is **46 KB** (engine) / **73** (CozyJournal) / **76** (Sol) / **75**
(DrawBots), over 9 and 16 / 15 / 16 files. That is the number §5 has been
asking for since 6.1 and could not recover from a cumulative prompt: a
sub-stage that moves 465 lines out of each app and 465 into the package
costs about 75 KB of diff per app.

The cumulative ranges are of course larger, and the practice §5 asked for
— one ship per slice — was NOT kept here: no ship ran between 6.5b.1 and
6.5b.2, so `review.js pending --prompt | wc -c` now reads **137 KB**
(engine) / **385** (CozyJournal) / **242** (Sol) / **244** (DrawBots).
Sol's and DrawBots' 242 and 244 are four sub-stages (6.6a, 6.6b, 6.5b.1,
6.5b.2) plus two record commits; CozyJournal's 385 is the same plus the
three 6.5a review-fix commits that have still never been shipped, which
is the third time the same gap has shown up in the same place. **The
shell's range has now been tried, and it fits**: 242 KB against the 890
a stage-3 range passed at. What has not been tried is a range holding the
bar handlers or the render tree.

**6.5b.3, and the figure §5 has asked for since 6.1 — twice over**
(2026-10-26, measured with the sub-stage's four commits in and before this
record's were made — the same convention 6.5b.2's figures were taken
under, and worth stating because the record commits move the cumulative
numbers below and not the per-commit ones). Its OWN diff is **57 KB**
(engine) / **107** (CozyJournal) / **108** (Sol) / **110** (DrawBots): a
sub-stage that moves 640 lines out of each app and 640 into the package
costs about 108 KB of diff per app, against 6.5b.2's 75 for 465 lines. Per
line moved the two agree closely, which is the first time this stage has
had two points to draw a line through.

And the queue WAS shipped between the slices this time, so the cumulative
figure was the per-sub-stage figure for two of the three apps:
`review.js pending --prompt | wc -c` read **176 KB** (CozyJournal) /
**177** (Sol) over ONE commit each. That is the clean per-sub-stage RANGE
measurement §5 wanted and had never had — the thing 6.5b.2 could only
approximate with a per-commit diff. The lower cumulative number against
6.5b.2's 385 and 242 is not the change shrinking; it is the queue being
empty, which is the whole argument for shipping between slices.

The other two were not clean and say why: the ENGINE read **217 KB** over
11 unpushed commits, and DrawBots **544 KB** over 9 — eight of which have
never been reviewed at all. DrawBots is now the largest unreviewed range
in this stage's history, and it is larger than the 465- and 640-line moves
put together because of what is queued BEHIND them, not what is in them.
**A 544 KB range is the thing §5 keeps warning about**, arrived at without
any single change being large.

**What that does and does not say about the shell.** It does not say the
shell's range will fit: these three sub-stages moved about 470 lines into
the package between them, where the shell is 10,013. It does say the
question is no longer confounded, and that a per-sub-stage figure is
cheap to get as long as the queue is shipped between sub-stages — which
is the practice to keep for 6.5b.3 onward, one ship per slice, and which
6.5b.2 shows can be had another way when it is not: the per-commit diff,
measured directly, answers the same question without a clear queue.
(6.5b.3 kept that practice in two apps of three and the figures above are
the payoff; DrawBots is what not keeping it looks like at nine commits.) The
reviewer has never been given a range holding a 10,000-line move, and on
§4.2 item 6's measurement it never will be: the slicing that stage 6's
remainder needs for ARCHITECTURAL reasons also keeps every range the size
of these.

**6.5b.4, on the clearest queue the programme has had** (2026-10-26,
measured with the sub-stage's four commits in and BEFORE this record's were
made — the same convention as 6.5b.2's and 6.5b.3's figures, and worth
restating because the record commits move the cumulative numbers and not
the per-commit ones). Its OWN diff is **28 KB** (engine) / **69**
(CozyJournal) / **64** (Sol) / **70** (DrawBots), against 6.5b.3's
57/107/108/110 for 640 lines and 6.5b.2's 46/73/76/75 for 465.

**Per line moved this one is dearer than both, and the reason is worth
having on the record.** 6.5b.4 moved 286 lines of each app and cost about
68 KB per app, where 6.5b.3 moved 640 for 108 — roughly 240 bytes a line
against 170. Two things account for it, and neither is waste. A JSX call
site costs **one line per prop** where a hook call costs one line for the
whole destructure, so 286 lines out brought 116 back in; and most of each
app's diff is the SUITES rather than the shell — 17 / 14 / 17 suite files
re-pointed, against three or four in the earlier slices, because a render
tree is what the source-text pins were mostly reading. The engine's half
is the cheapest of the three sub-stages (28 KB) for the mirror reason:
eight small components are less text than five hooks of 640 lines.

The cumulative ranges: `review.js pending --prompt | wc -c` reads **226 KB**
(CozyJournal, 4 unpushed commits) / **103** (Sol, 1) / **118** (DrawBots,
2) / **38** (engine, 1 — and the engine's own `review.js` is `tooling/`,
not the vendored copy the apps use). Sol's **103 KB over one commit** is
the clean per-sub-stage range figure, and it is the second time §5 has had
one; CozyJournal's 226 is this sub-stage plus the three 6.5b.3 review-fix
commits that were never shipped, which is what a queue of four looks like
at this size. **Every one of the four is inside the 890 KB a stage-3 range
passed at**, and DrawBots — 544 KB at 6.5b.3 over nine unreviewed commits
— is back to 118 because that queue was shipped. That is the clearest
demonstration this stage has produced that the warning is about the QUEUE
and not about the changes: the same app, two sub-stages apart, 544 → 118
with a larger shell slice in between.

**A pin can go silently inert, and one had** (2026-10-24, DrawBots' review
round after 6.5a). The review called a failing test: DrawBots'
`web/sim/__tests__/sourcePin.test.ts` asserts that the simulation kernel's
ONE allowed app import imports nothing itself, and 6.3d had made that file a
re-export of `@/engine/seededRandom`. The reasoning was right and the verdict
was wrong — the suite was green, and the reason is worth more than the
finding: the assertion's regex carried a literal BACKSPACE (0x08) where a
`\b` was meant, so it matched nothing and had never once fired. It arrived
that way on 2026-10-08, sixteen days and nine commits before the range.

Three things follow, and the third is the general one:

· The check the kernel's purity rule depends on was not in force, which is
  the review's real finding and is now fixed — the pin reads an EXACT set
  (`['@/engine/seededRandom']`) rather than matching a negative, and was
  mutation-tested: adding an app import to the wrapper fails it.

· A quoted heredoc mangling a backslash is the hazard this plan's own
  process note warns about ("write scripts with the Write tool"). It bit a
  committed test, not a script, and nothing noticed because the failure mode
  of a mangled negative assertion is silence.

· So: **a negative assertion that stops matching passes.** Prefer an exact
  set or a derived count to `not.toMatch` wherever the subject is small
  enough to name, and when a pin's whole job is to refuse something, check
  once that it still refuses it.

· **And the quieter form of it, found at 6.6b: a pin that SLICES can go
  soft without going red.** Two of CozyJournal's read the host between two
  markers — `if (q.warm === '1') return;` and `let cancelled = false;` —
  and after the open path moved, both markers still matched, in two
  DIFFERENT effects. The slice became most of the file, so every string
  the pin looked for was in it and the assertion could no longer fail. It
  stayed green through the move that gutted it. A positive `toContain`
  cannot rot this way; a positive `toContain` over a slice can, and the
  guard is to assert the slice is the one you meant (its length, or a
  marker that exists once) before asserting anything about its contents. A sweep of all four repos for control bytes
  in source found five others, every one deliberate (NUL as a key separator
  in two files, control characters as test DATA for an emoji sanitiser) — so
  one inert pin, and it is worth re-running that sweep after any round of
  scripted edits.

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
