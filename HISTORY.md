# Provenance

This repo's original commit history (July 11–12, 2026) was lost when the
local `.git` was re-initialized during GitHub repo setup, before the first
push. The content of the final state is fully intact; the staged history
below is reconstructed from the session record for the archaeology.

1. **Import engine and native-shell from Facet @ cfad1cd, verbatim** — packages/engine + packages/shell extracted from the Tileodile app; standalone jest (162 suites / 3415 tests) + tsconfig; platform shims.
2. **Cut Tileodile content out of the engine; add registerBuiltInContent seam** — removed 65MB of generated registries + public/ app content (they live in Facet); engine ships no content.
3. **Audit pass 1: dead code** — 37 dead exports across 20 modules + orphan cascades (~825 lines), a dead render-path file (gl/svgObjectTextureCache), a legacy re-export shim. Verified via ts-prune across both repos.
4. **Audit pass 2: tests** — ~90 redundant/trivial/replica tests removed from ~50k lines (incl. whole files that tested local re-implementations); fixture regressions kept. 155 suites / 3304 tests green.
5. **Audit pass 3: names, comments, docs** — ~70 fixes where words and code disagreed (stale binary-format header v23→v28, phantom "janitor pass", wrong arithmetic in comments, orphaned jsdoc blocks). Two real code fixes: grid-level 5–6 crash guard in loadTile.getScaledTile; figureToPaths.quadTo quadratic-arc center corrected (control point is the tangent corner, center = start+end−corner).
6. **Hardening** — noFallthroughCasesInSwitch, noImplicitReturns, then noUnusedLocals/noUnusedParameters (~140 unused bindings removed); vendored modules/static-server into packages/shell; README, per-package manifests.
7. **Rename sessionNewManifestSet → newManifestSet** — dropped stale `*ThisSession*` export names (module is persistent across reloads).
8. **Boolean Garden spike** — apps/boolean-spike: five playable puzzles (Moon, Lens, Ring, Heart, Flower) over a polygon-clipping kernel; played end to end in-browser.

Facet's `engine-package` branch (pushed to lillithompson/Facet) consumes this
repo via tsconfig paths + Metro watchFolders and matches this final state.
