# tooling/ — the shipping process every Underway project shares

One implementation of the review gate, the ship pass, the doc-path check,
the pre-push hook, the CI backstop, the ship skill and the shared CLAUDE.md
rules, consumed by every project through the engine submodule it already
vendors. A project keeps only stubs that point here and one small
`underway.config.json` with its own values. The copies Sol and DrawBot
carried under `scripts/` had drifted by hundreds of lines; CozyJournal had
none. That is what this replaces.

| File | What it is |
|---|---|
| `review.js` | The independent review gate (G2 in `gates.md`): `pending`, `commit`, `check --pre-push`, `accept` |
| `ship.js` | The review pass: checks, review, review note, push |
| `check-doc-paths.js` | Every path a doc names must exist (G3) |
| `config.js` | Reads the project's `underway.config.json`; the defaults |
| `reviewer.md` | The shared reviewer brief; the project's checks are spliced in under "Project rules" |
| `gates.md` | What the gates are and why |
| `skills/ship.md` | The `/ship` skill's text; the project's `.claude/skills/ship/SKILL.md` points here |
| `CLAUDE.shared.md` | The rules every project's `CLAUDE.md` imports |
| `pre-push` | The hook `init.js` writes to a project's `.githooks/pre-push`: the gate's path once, a sentence when the engine submodule is not checked out, else the gate |
| `workflows/submodule-pointer-check.yml` | The CI backstop for an unpushed submodule pointer |
| `init.js` | Writes a project's stubs, config and package scripts, idempotently |
| `check-clone.js` | The per-clone git settings and the LF checkout every fresh clone forgets |
| `underway.config.example.json` | A starting config |

## Wiring a project

```sh
node vendor/UnderwayEngine/tooling/init.js --name myapp
```

It writes (and keeps in step, run it again any time):

- `underway.config.json` — only if absent; edit it (below);
- `.githooks/pre-push` — the hook (executable);
- `.claude/skills/ship/SKILL.md` — a stub that follows `skills/ship.md`;
- `.github/workflows/submodule-pointer-check.yml`;
- `package.json` scripts: `review`, `review:pending`, `review:check`,
  `ship`, `check:doc-paths`, `check:clone`, and the
  `git config core.hooksPath .githooks` line in `postinstall`.

Then, by hand, once:

- `CLAUDE.md`: delete the sections `CLAUDE.shared.md` now holds (Github,
  Submodule, the server goes first, Testing, Independent review and
  shipping, Avoid duplicate code) and put `@vendor/UnderwayEngine/tooling/CLAUDE.shared.md`
  at the top. Keep the project's own rules — its kernel, its budgets, the
  paths they name.
- `docs/review/project-rules.md` (or wherever `reviewerAddendum` points):
  the review checks that are the project's own, numbered as items under the
  brief's check 2. Delete the project's old `docs/review/reviewer.md`,
  `docs/gates.md`, `scripts/review.js`, `scripts/ship.js`,
  `scripts/check-doc-paths.js` and their tests: `tooling/__tests__/` holds
  the suite now.
- `jest.config.js`: drop `scripts/` from the roots if nothing else is
  tested there.

A project that copies the submodule guards into its README should point at
`npm run check:clone` instead.

## `underway.config.json`

Every field is optional; the defaults are in `config.js`.

| Field | Default | Meaning |
|---|---|---|
| `name` | `project` | The project's word, used in prose and messages |
| `reviewRecords` | `<name>-reviews` | The review records' directory under `.git/` |
| `submodule` | `vendor/UnderwayEngine` | Where the engine is vendored |
| `alwaysReview` | `[]` | Regex strings ADDED to the shared always-review list (`sharedAlwaysReview` in `config.js`: `web/store/`, the backend schema, the editor shell and session, the submodule pointer, `CLAUDE.md`, `.claude/`, `.github/`, `.githooks/`, `docs/review/`, the config itself, `jest.config.js`, `package.json`, the copy-source list and the reviewer addendum when configured). A project adds its kernel and its design document. |
| `copySources` | none | A JSON file naming repositories this one copied from: `[{ "name", "repo" (a sibling checkout), "commit" }]` (`gates.md` "Copies") |
| `reviewerAddendum` | none | A markdown file of the project's own review checks, spliced into `reviewer.md` under "Project rules" |
| `backendSchema` | `backend/src/validation.ts` | The wire schema a deployed backend shares with the app |
| `docPaths.docs` | `["README.md", "CLAUDE.md"]` | The docs `check-doc-paths` reads: the codebase map and the design documents belong here |
| `docPaths.generated` | adds to `ios`, `dist`, `web-bundle`, `node_modules`, `.expo`, `expo-env.d.ts` | Names correct to write and absent from a clean checkout |
| `docPaths.prose` | `[]` | Regex strings for the project's words that look like paths and are not: its IndexedDB key prefix (`^myapp:`), its node-name tags (`^(seed\|plant):`) |
| `docPaths.extensions` | adds to the source extensions a bare name may carry | A project's own file types |

Sol's, for example:

```json
{
  "name": "sol",
  "alwaysReview": ["^web/sol/kernel/", "^web/sol/doc/", "^web/sol/scene/", "^web/sol/reveal/", "^docs/sol_architecture\\.md$"],
  "copySources": "scripts/copySources.json",
  "reviewerAddendum": "docs/review/project-rules.md",
  "docPaths": {
    "docs": ["README.md", "CLAUDE.md", "Sol.md", "docs/perf/release-TEMPLATE.md", "docs/sol_architecture.md"],
    "prose": ["^sol:", "^(seed|seedmark|plant|branch|stamp):"]
  }
}
```

## How a change to the process reaches the projects

A change here is an engine commit; each project takes it as a submodule
pointer bump, which its review always sees. The reviewer's brief is read
from the vendored copy at the pinned commit, so a change to the brief is
judged by the brief before it — the same pinning the per-project copy had
with `origin/main`. The tests (`tooling/__tests__/`) run with the engine's
`npm test`; they build scratch repositories with their own
`underway.config.json`, so nothing in them depends on any one project.
