# UnderwayEngine

The shared engine behind Underway's creative apps — extracted from [Facet/Tileodile](../Facet) (at commit `cfad1cd`), cleaned, and hardened as a standalone, tested library. Design rationale lives in UnderwayNotes (`notes/tech/`): stack architecture, engine options survey, extraction plan.

## Layout

| Package | Contents |
|---|---|
| `packages/engine` | The 2D creative core: grid/cell layers, composition scene ops, vector segments (lines/arcs, join/union/mask), color math, hit-testing, undo, versioned binary persistence, SVG/PNG export, WebGL compositor (`src/gl/`), tutorial engine, remote-content pipeline (`dynamicSamples/`) |
| `packages/shell` | The Expo/WKWebView survival kit: postMessage bridge + protocol, content-process termination recovery, resume-liveness watchdog, local static server hook, share-sheet export |
| `shims/` | Type/test stand-ins for platform modules (`expo-*`, `react-native`, one app hook) so the engine typechecks and tests without an Expo host. Real seams are the long-term fix. |

## Commands

```sh
npm test            # jest — the suite extracted with the engine
npm run typecheck   # tsc --noEmit
```

## Boundaries & conventions

- **The engine ships no content.** Apps register bundled samples/tutorials via `registerBuiltInContent()` (`src/content.ts`) and serve the files themselves.
- **Platform access is injected.** Anything touching Expo/RN goes through an interface the app implements; `src/loadTile.ts` is the one remaining direct Expo import (jest maps it to its mock).
- `packages/shell/src/{app,components,server}` are Expo-host pieces excluded from this repo's typecheck — they compile inside a consuming Expo project.
- Grid levels: layers/textures exist for L0–L4 only (`MAX_LAYER_LEVEL`); levels 5–6 are composition-editor snap levels.
- Consumers import via workspace/`file:` deps for now; no npm publishing until a second project actually consumes it.

## Provenance

Extracted verbatim from Facet, then audited in staged commits (dead exports → content cut → test dedup → naming/comment fixes → hardening). Facet remains untouched and still carries its own copy; repointing Facet's `@/engine/*` alias at this package is a deliberate future step.
