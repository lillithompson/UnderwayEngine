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
wrapper beside it. The apps import it all through `@/editor/*` and their
copies are gone; each app's `web/editor/hostTools.ts` is its registry and
its `web/editor/extension.ts` installs its session host.

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
| Property pages for the app's kinds | DrawBot's `useSimEditor().selection`, CozyJournal's rig model, spread into the panel model in the shell | `hostPages(selection, session): HostPagesModel \| undefined` — already the engine's shape (`packages/editor-ui`); the shell calls it in one place. |
| Scene outline rows | `sceneOutlineModel.ts` per app (tag labels, rig glyphs, bots as overlays) | `outline: { tagLabels, iconFor(node), overlays(session) }` — the labels for functional `prefix:id` tags, a kind's glyph, and the host's overlay rows. |
| Layers drawn over the canvas | Sol's `RevealOverlay` / plant layer in `NodeLayer`, DrawBot's `DrawBotsLayer`, CozyJournal's `RigNodeLayer` | `layers: { nodeLayer?(node), overlay?(session, camera) }` — the host draws its own kinds of node and its own live layer, through the handles `CanvasSurface` already exposes. |
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
   (stage 5), `fontStacks.ts`, `homeStateDelivery.ts` and
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
   `TOps` has nothing to infer from). **Not shipped**: the apps' ranges
   cannot be reviewed by the process as it stands — see §5. Left for the
   owner from the migrations: Sol's `shellWiring` and
   `paintTrimOnDeselect` tests pin lines of the ENGINE's editorSession
   (the stacks' spelling, `trimDeselectedPaint<S`), which an engine
   refactor will break until they move here or read a looser shape; and
   whether Sol should pin `cameraMatrixInto`, which its reveal depends on
   and only the engine's suite now holds (Sol's jest roots exclude it).
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
  before that. Stage 3 found the first two already settled: `groupHit.ts`
  and `multiTapGesture.ts` were identical in all three apps when measured
  (the landing window had already reached Sol and DrawBot), and DrawBot's
  pixels-only hit is not the selection's walk at all but a second,
  separate pick in its `CanvasSurface.tsx` (`pixelHitTestAt`, for its
  placing tools building in a group's empty box) beside the shared
  `hitTestAt` every app has — a stage-5 matter, and the sentence in the
  old item 3 preferring DrawBot's rule is superseded by this one. The
  `push` brush is back in the moved files (`PaintToolKind`,
  `brushDimsToSelection`, `toolYieldsToSelection`, the paint slider's
  Brushes option); DrawBot keeps it off its bar with its app-side mode
  list until stage 5 gives its canvas the brush.
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
  own builder, which is the only branch it keeps until stage 5. DrawBot's
  Inklings register no `tap`: its sim layer's gesture hooks claim the
  press before the tap is read. The `'against'` facts the shell knows
  (`openTarget`, `joins`) ride a trailing options object under those
  names. A selection that is a MODE (CozyJournal's rig) stays a boolean
  parameter, `selectionIsMode`.
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
`review.js` would make such a range reviewable and the review truer, and
both are the owner's to make (an agent never edits the gate's own files
to get a range through, `CLAUDE.shared.md`): fold a MOVE — a file the
appended engine diff adds whose content matches a file the project's
diff deletes (by blob, or by path under `web/editor/` ↔
`packages/editor/src/`) is shown once, as the delta between the two with
one line of context, the way `copySources` already shows a changed copy,
and listed when byte-identical; and leave the engine's lockfile out of
the appended diff as the project's is. Stages 5 and 6 (CanvasSurface,
EditorShell: 7,000 and 10,000 lines) have the same shape and will need it
too. Until then the three apps' stage-3 commits sit unpushed on their
local `main`s, their gates green, and the engine's commits are on
`origin/main` ahead of them, which is the safe order.

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
