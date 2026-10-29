# UnderwayEngine

The shared engine behind Underway's creative apps — extracted from [Facet/Tileodile](../Facet) (at commit `cfad1cd`), cleaned, and hardened as a standalone, tested library. Design rationale lives in UnderwayNotes (`notes/tech/`): stack architecture, engine options survey, extraction plan.

## Layout

| Package | Contents |
|---|---|
| `packages/engine` | The 2D creative core: grid/cell layers, composition scene ops, vector segments (lines/arcs, join/union/mask), color math, hit-testing, undo, versioned binary persistence, SVG/PNG export, WebGL compositor (`src/gl/`), tutorial engine, remote-content pipeline (`dynamicSamples/`) |
| `packages/shell` | The Expo/WKWebView survival kit: postMessage bridge + protocol, content-process termination recovery, resume-liveness watchdog, local static server hook, share-sheet export |
| `packages/editor-ui` | Project-agnostic React Native editor chrome — top bar, scene outline, object properties (the Edit sheet's pages), undo/redo, grid, colour picker — rendered against a generic scene-graph adapter (`src/adapter.ts`). It never imports engine types: each app builds the adapter from its own state. A thing of an app's own kind (a simulation's bots) gets its pages the same way every engine object does, as **host pages** (`HostPagesModel`: declarative rows, or the host's own element at a declared height), its common-row buttons trimmed by `hiddenCommonActions`, and its outline rows drawn over the scene by `overlayRank`. Consumed by Sol, DrawBot and CozyJournal through the `@/editor-ui/*` path alias; excluded from this repo's typecheck (it compiles inside a consuming Expo project) and tested here by jest. |
| `packages/editor` | The shared web editor's engine-bound pieces, consumed file by file through the `@/editor/*` path alias (no entry point): the long-press radial menu, the tool sheet and popover, grid snap, the resize and rotate maths, the keyboard shortcuts; since stage 2 of `docs/shared-editor.md` the toolbar: its metadata and mode tables (`src/components/toolbarMeta.ts`), the shape glyphs, the under-toolbar mode capsule and the floating actions pill with their sizing; and since stage 3 the session and the camera: the pure session reducer and its entry builders (`src/editorSession.ts`), the camera maths, the canvas tap rules, the group hit, the transform gestures, the selection outline, the scene occlusion, the drawn pose, the paint and vector-erase brushes, the text caret, the slider-mode menu and the commit pipeline. The STANDARD tools are its (`src/toolIds.ts`); a tool that is an app's own is registered as a `HostTool` (`src/hostTools.ts`, the first seam of the `EditorExtension` in `src/extension.ts`) and reaches the bar through the registry, and what an app's parallel document, its own selectable items and its own kinds of node need of the session is the second seam (`src/sessionHost.ts`, installed once by the app). Unlike editor-ui it imports the engine freely; what it never imports is an app. Excluded from this repo's typecheck (it compiles inside a consuming Expo project) and tested here by jest; the pins that need the icon font skip here and run in each app's suite. |
| `tooling/` | The shipping process every project shares — the independent review gate (`review.js`), the ship pass (`ship.js`), the doc-path check, the pre-push hook, the CI backstop, the `/ship` skill text and the shared `CLAUDE.md` rules — consumed through the submodule and parametrized by each project's `underway.config.json`. `tooling/README.md` says how a project is wired. |
| `shims/` | Type/test stand-ins for platform modules (`expo-*`, `react-native`, one app hook) so the engine typechecks and tests without an Expo host. Real seams are the long-term fix. |

## Commands

```sh
npm test            # jest — the suite extracted with the engine
npm run typecheck   # tsc --noEmit
```

## Loopback ports

In release every app on `packages/shell` serves its web bundle from a
local server on `http://localhost:<port>`, and that origin keys everything
the page stores (IndexedDB, localStorage). The port is device-wide, so two
apps on one port can never both be up, and a shipped app cannot change its
port without stranding its installs' data — unless it also names the port
it is leaving, in which case the first start on the new port copies the
saved work across (`UnderwayStaticServerLegacyPort`; the copy is
`modules/static-server/web/originMigration.js`, run by
`StaticServerModule.swift`'s `adoptLegacyOrigin`). Every app names its own
port in `app.json` (`UnderwayStaticServerPort`), and a new app takes the
next free one here:

| Port | App | Note |
|---|---|---|
| 18730 | Tileodile (Facet) | The engine's default, kept for the app that shipped on it. Facet's own copy of the module also falls back to 18731–18732. |
| 18740 | Inklings (DrawBot) | |
| 18750 | Mmoment (CozyJournal) | Moved from 18730 (October 2026); legacy port 18730. |
| 18760 | Sol | Moved from 18730 (October 2026); legacy port 18730. |

## Boundaries & conventions

- **The engine ships no content.** Apps register bundled samples/tutorials via `registerBuiltInContent()` (`src/content.ts`) and serve the files themselves.
- **Platform access is injected.** Anything touching Expo/RN goes through an interface the app implements; `src/loadTile.ts` is the one remaining direct Expo import (jest maps it to its mock).
- `packages/shell/src/{app,components,server}` are Expo-host pieces excluded from this repo's typecheck — they compile inside a consuming Expo project.
- Grid levels: layers/textures exist for L0–L4 only (`MAX_LAYER_LEVEL`); levels 5–6 are composition-editor snap levels.
- Consumers import via workspace/`file:` deps for now; no npm publishing until a second project actually consumes it.

## Provenance

Extracted verbatim from Facet, then audited in staged commits (dead exports → content cut → test dedup → naming/comment fixes → hardening). Facet remains untouched and still carries its own copy; repointing Facet's `@/engine/*` alias at this package is a deliberate future step.
