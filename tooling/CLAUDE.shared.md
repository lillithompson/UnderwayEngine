# Shared rules for every Underway project

These are the rules Sol, DrawBot, CozyJournal and every project after them
hold in common. A project's own `CLAUDE.md` imports this file with one
line — `@vendor/UnderwayEngine/tooling/CLAUDE.shared.md` — and adds its own
rules after it: its kernel's purity, its per-frame budget, the paths its
rules are about. Nothing here names a project file; the project's
`underway.config.json` (`vendor/UnderwayEngine/tooling/README.md`) is where
the shipping process learns the project's own paths and words.

## Github

Do not add Co-Authored-By or any author attribution lines to commit
messages. Work on the current branch (normally `main`) in this checkout.
Never create a branch, a `git worktree`, or a copy or clone of the
repository unless the user asks for one.

**Every finished change is committed, never pushed**: commit it on the
current branch (one change per commit, staging only the files it touched —
never `git add -A`, never someone else's uncommitted work) and stop there.
Changes accrue locally; the owner runs the review pass, the `/ship` skill,
which reviews and pushes everything unpushed at once — see "Independent
review and shipping" below.

## Submodule: vendor/UnderwayEngine

`vendor/UnderwayEngine` is a **git submodule** — a separate repo
(`github.com/lillithompson/UnderwayEngine`) pinned to one commit SHA by this
parent repo. The recurring breakage where "other computers can't merge" is
**always** the same root cause: the parent gets bumped to a submodule commit
that was **never pushed** to the submodule's remote. Another machine then
runs `git submodule update`, tries to fetch that SHA, it isn't on origin,
and the checkout fails hard.

**The one rule: a commit inside the submodule must be pushed to its remote
BEFORE the parent pointer is pushed. Never let a pushed parent reference a
submodule commit that isn't on `origin`.** (Agents commit both and push
neither; the review pass pushes the submodule first — see below.)

**Stay on `main` in the submodule; never commit from a detached HEAD.** A
fresh clone or `git submodule update` leaves the submodule in *detached
HEAD*, and committing there puts the commit on no branch — impossible to
`git push` by name and trivial to lose. Before committing in the submodule,
run `git -C vendor/UnderwayEngine checkout main` and confirm `git -C
vendor/UnderwayEngine rev-parse --abbrev-ref HEAD` prints `main` (not
`HEAD`). Do the work on `main`; do **not** create local-only feature
branches in the submodule. If a branch is genuinely needed, `git push -u`
it immediately so it tracks a remote and can't be forgotten, and update
`.gitmodules`' `branch =` to match.

Correct order, every time you touch the submodule:

1. **Commit inside the submodule first.** `cd vendor/UnderwayEngine && git
   add <files> && git commit -m "..."`. The parent will show `modified:
   vendor/UnderwayEngine (untracked/modified content)` until this is done —
   that message means the submodule working tree is dirty; commit it
   there, do not `git add` it from the parent.
2. **Then commit the parent pointer.** `cd` back, `git add
   vendor/UnderwayEngine`, commit. Do not push either repository: the
   review pass (`/ship`) pushes both, the submodule first (`git push
   --recurse-submodules=on-demand` pushes the submodule commits the pointer
   needs, and aborts the parent push if it can't). `ship` refuses a
   pointer whose submodule commit is not on the submodule's `main`, so a
   detached-HEAD commit is caught before anything moves.
3. **Verify after the review pass pushes**: inside the submodule, `git
   branch -r --contains HEAD` must list `origin/main`. If it lists nothing,
   the parent references an unpushed commit — stop and push the submodule.

Three per-clone git settings make this hard to get wrong, and they are not
committed, so every clone (and every `git worktree`, which is a fresh clone
for this purpose) has to set them: `push.recurseSubmodules on-demand`,
`submodule.recurse true`, `core.hooksPath .githooks`. `npm install` sets
the hooks path; `npm run check:clone` reports which are missing and prints
the commands. Never bump the parent pointer with `--no-recurse-submodules`
or by hand-editing the gitlink — that bypasses the safety check that
prevents this exact bug.

Because that config is per-clone and easy to skip, a committed CI backstop
(`.github/workflows/submodule-pointer-check.yml`) runs for everyone: it
fails the build if a pushed parent commit records a submodule SHA that
isn't reachable on the submodule's remote. A red run there means someone
pushed a parent bump without pushing the submodule — fix it by pushing the
submodule commit (see the job log for the exact command), not by editing
the workflow.

Line endings are LF in every clone (`.gitattributes`, `* text=auto
eol=lf`, in the project and in the engine): the test suites pin source
text with `"\n"`, and Git for Windows' default `core.autocrlf=true` checks
a repository out CRLF. A clone that was checked out CRLF before the
attributes landed is not rewritten by pulling them; `npm run check:clone`
says so and prints the one-time rewrite.

## Shared enums with the backend: the server goes first

A project that has a backend shares a wire format with something deployed
separately. Its request schemas (the file `underway.config.json` names as
`backendSchema`, `backend/src/validation.ts` by default) are `.strict()` zod
objects over zod enums, so a field or a value the deployed backend has
never heard of does not degrade — it refuses the **whole request** it
appears in, with `400 invalid_request`, and on screen that reads as a
generic "could not do that right now".

**The one rule: a new enum value must be LIVE on the backend before any
client build that can send it.** Add the value to the backend schema,
deploy the backend, verify it is live, and only then build or release the
app. A retirement goes the other way round and is safe in that order: take
the value out of the app, ship, then deploy the backend — a server that
still accepts a word nobody says any more breaks nothing. `npm run ship`
refuses a range that changes the schema until `--backend-live` says it is
deployed.

When a request fails with a generic notice, read the Lambda's refusal log
first — it names the field and the zod code, which is the whole diagnosis.

## Testing

Add tests for any substantive functionality.

When you make a change, run the test suite (`npm test`) and fix any
failures before finishing.

Where a test can go: `jest.config.js` roots the run at the project's web
and components trees (and `scripts/`, where the project tests its own
scripts) — `app/` and `backend/` are not in it (the backend has its own
suite, `npm run test:backend`). There is **no renderer**: `react-native`
resolves to a type-and-stub shim, so nothing can
mount a `View`. Logic that needs testing therefore belongs in a plain `.ts`
module (a screen's logic in a model module beside it), and facts about a
screen's structure are pinned by tests that read the source text.

## Independent review and shipping

Every unpushed commit is reviewed by a fresh agent with none of the
author's context before it can be pushed
(`vendor/UnderwayEngine/tooling/gates.md`). It blocks on duplication,
stale or missing doc updates and missing tests as well as bugs and the
project's own rules, so the sections around this one are what it checks.

**Agents never push.** Not `git push`, not `npm run ship`, not the
submodule. Commit on the current branch, run `npm test` (and `npm run
typecheck`), and stop: unpushed commits on local `main` are the queue.

**The review pass is the `/ship` skill** (the project's
`.claude/skills/ship/SKILL.md`, which follows
`vendor/UnderwayEngine/tooling/skills/ship.md`), run when the owner asks.
It runs `npm run ship` (`vendor/UnderwayEngine/tooling/ship.js`): `npm
test`, `npm run typecheck`, `npm run check:doc-paths` (and `npm run
test:backend` when `backend/` changed), then ONE review of the whole
`origin/main..HEAD` range as a combined diff, then `git push
--recurse-submodules=on-demand`. The review's feedback is taken there:
blocking findings are fixed in new commits on top (message starting
`Review fixes:`, one line per finding), and the next round is briefed with
the earlier findings, at most three rounds. Before the push it appends a
review note to HEAD's message — the verdict, the suggestions not taken,
and the path of the full review in the record directory the config names.
Its exit codes and what to do about each are in the skill and in the
script.

Always:

- Never run `review.js accept`, never push with `--no-verify`, and never
  edit `vendor/UnderwayEngine/tooling/`, `docs/review/`,
  `underway.config.json` or `.githooks/` to get a commit through. Clearing
  a review is the owner's call.
- If you think a finding is wrong, say so to the user with the reason; do
  not work around it.

## Avoid duplicate and redundant code

These codebases have had a persistent problem with multiple copies of
similar functions drifting out of sync — within a project, and between the
projects, which share one engine and one editor. Before writing new logic,
and again before declaring a task complete, audit for duplication.

### Before writing new logic

1. **Grep first, write second.** Before adding a function, search the
   codebase for the behaviour you're about to implement — the project's
   trees and the engine's (`vendor/UnderwayEngine/packages/*/src/`, which
   already holds segment maths, hit tests, palette data, colour conversion
   and the shared editor chrome). Use the function name you'd write, key
   parameter names, and a few distinct keywords from the algorithm.
2. **Check sibling files.** If you're adding to `foo.ts`, list its
   directory and look for `foo*.ts`, `*Foo*.ts`, and anything semantically
   adjacent in the neighbouring trees. The naming conventions repeat across
   a project's layers.
3. **If you find a near-match, reuse or extend it.** Prefer adding a
   parameter, lifting shared logic into a helper, or extending the existing
   function over writing a parallel one. A new copy is almost never the
   right answer. Something every Underway app would want belongs in the
   engine, not in one app.

Before declaring done, sweep for duplication you may have introduced:

1. **Grep for any new function name** you added. If it appears in only one
   file, good. If it appears suggestively in multiple, verify they're not
   parallel implementations.
2. **Grep for the new logic's distinctive tokens** (a magic constant, a
   specific algorithm step). Multiple hits in different files often
   indicate an opportunity to consolidate.
3. **If you copy-pasted to start, finish by extracting the shared piece.**
   A copy-paste during exploration is fine; shipping the copy is not.

When you find existing duplication while working on something else, flag
it to the user — don't silently consolidate unrelated code as part of an
unrelated change, but do call it out so it can be cleaned up deliberately.
