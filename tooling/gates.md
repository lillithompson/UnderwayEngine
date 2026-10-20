# Gates

Every commit that reaches a project's `origin/main` has passed these. They
exist because most of this code is written by agents working straight on
`main`, and an agent reviewing its own work agrees with itself. Agents
commit and never push; the gates run once, over everything unpushed, when
the owner runs the review pass (`/ship`, see "Shipping"). Adapted from the
4S project's gates (github.com/dreel/4s, `docs/gates.md`), cut down for
private, single-owner repositories: there are no PRs, no outside
contributors and no RFCs, so the gate sits at the commit and the push, not
at a merge.

The gate is one implementation, in the engine's `tooling/`, consumed by
every project through the submodule; a project's own values — its name,
its always-reviewed paths, its review checks — are its
`underway.config.json` (`tooling/README.md`). "The project" below is
whichever repository the command runs in.

## G1 Checks

`npm test`, `npm run typecheck` and `npm run check:doc-paths` pass (plus
`npm run test:backend` when `backend/` changed). Agents run the first two
as they work; `npm run ship` runs them all before it reviews and pushes
(see "Shipping" below); a project that has a `checks` CI workflow re-runs
them there on every push, so a machine that skipped them still goes red.

## G2 Independent review

A fresh agent reviews the unpushed change against the rules in the
project's `CLAUDE.md` (and the shared rules it imports), with **none of
the author's context**: no conversation, no plan, no memory. It sees the
repository and the diff, nothing else. That independence is the point.

**The unit is the range.** Everything in `origin/main..HEAD` is reviewed
as ONE combined diff in one reviewer session, with every commit's message
beside it — not commit by commit, which cost one Opus session per commit
and kept every agent waiting on its own review. A problem one commit added
and a later one fixed is not a finding; scope is still judged per commit.

`npm run review:pending` (`tooling/review.js pending`) runs it:

- It takes the range's combined diff (lockfiles left out; a submodule
  pointer move has the engine's own diff appended) and hashes it. A
  one-commit range hashes exactly as that commit did under per-commit
  review, so those records still count.
- **Copies.** What the reviewer is *shown* is shorter than what is hashed
  when the range adds files copied from another repository. The config's
  `copySources` names a JSON file listing each source: a sibling checkout
  of it and the commit copied from. A file the range adds at a path the
  source also has is a copy. If it is byte-identical to the source it is
  listed, not diffed. If it was changed it is diffed against the source
  with one line of context, and a run of more than three removed lines
  shows as a count (a cut is checked by the tests and the typecheck).
  Everything else is diffed as usual. `review.js` reads the source's
  objects in place and fetches nothing; a source not checked out on this
  machine is skipped with a note, and its copies are diffed in full. The
  source list is an always-reviewed path.
- It starts `claude -p` on **Opus** (`REVIEW_MODEL` overrides) in restricted
  mode: read, grep and glob only, no settings, no MCP, no skills, no
  session. Variables that tie a process to the calling Claude Code session
  are cleared, so the reviewer is a new session even when an agent runs it.
  It may take up to 60 turns (`REVIEW_MAX_TURNS`) and 30 minutes
  (`REVIEW_TIMEOUT_MIN`). The prompt's size is printed, and when the
  reviewer fails, the end of what it printed is shown with the error.
- The instructions are the shared brief `tooling/reviewer.md`, read from
  the vendored submodule at the commit the project pins — so a change
  cannot loosen its own review without moving the pointer, which is always
  reviewed — with the project's own checks (the config's
  `reviewerAddendum`) spliced in under the brief's "Project rules" heading,
  read from `origin/main` for the same reason; an edit to them takes effect
  once pushed.
- The review ends with `REVIEWED_COMMIT` (the range's tip), `DIFF_SHA256`
  and `VERDICT` lines. Only `VERDICT: pass` with the right tip and hash
  counts.
- The review is saved in `.git/<records>/<diff-sha256>.md` (the record
  directory the config names; local, shared by every worktree). A record
  names the tip as it was reviewed; `ship` then amends the message (see
  "Shipping"), so the SHA on `origin/main` is not in the record — the
  shipped commit's `Record:` line is the link back to it. A record named
  `.invalid.md` is a review whose trailer did not check out, and never
  counts. Keying by the diff means a rebase onto a moved `origin/main` that
  keeps the diff keeps its pass, and any new commit on top needs a new
  review.
- **Rounds.** When the review requests changes, the fixes are new commits
  on top. The next `pending` reviews the whole range again, but the
  reviewer is given the earlier review and the diff since its tip, and told
  to confirm each blocking finding is resolved and judge the new commits
  closely. The round number is kept per base in `.git/<records>/rounds/`
  and printed. Re-running on the exact diff already refused prints that
  review instead of paying for it again (`--force` re-reviews). A pass ends
  the count: the next change on top starts at round 1. `pending --dry-run`
  says what would be reviewed and which round, without starting a
  reviewer; `pending --prompt` prints the whole prompt the reviewer would
  get.

`npm run review` (`review.js commit [<rev>]`) reviews one commit alone, for
a look before the pass.

**What is reviewed.** A range that touches the store under `web/store/`,
the backend's wire schema (the config's `backendSchema`), the editor shell
and session (`web/editor/EditorShell.tsx`, `web/editor/editorSession.ts`),
the submodule pointer, `CLAUDE.md`, `.claude/`, `.github/`, `.githooks/`,
`docs/review/`, `package.json`, `jest.config.js`, `underway.config.json`
itself, the copy-source list or the reviewer addendum — plus whatever the
project's `alwaysReview` adds (its kernel, its design document) — or that
changes 30 or more lines of other code. Tests, other docs and lockfiles
never trigger a review by themselves. Merge commits are not reviewed on
their own. The shared list is `sharedAlwaysReview` in `tooling/config.js`
and the threshold `LINE_THRESHOLD` in `tooling/review.js`.

**What blocks** (the full checklist is `tooling/reviewer.md`): a
correctness bug; a project rule broken; a wire-format value the backend
would refuse; duplication of logic that already exists; a doc the change
made false or left incomplete; substantive behaviour with no test; an
unrelated change in a commit. Style and anything the reviewer is unsure of
are suggestions.

**Enforced by** the `pre-push` hook (the project's `.githooks/pre-push`,
one line that runs `tooling/review.js check --pre-push`). It starts no
review; it refuses the push unless the pushed range has a pass as a whole,
or every commit in it that needs a review has one of its own (so
per-commit records and accepts from before ranges still clear). Commit by
commit, the commits not cleared by their own record are judged together:
several small commits that add up to the line threshold need a review,
though none alone would. `npm install` turns it on for the clone
(`postinstall` sets `core.hooksPath=.githooks`); `npm run check:clone`
reports a clone that skipped it. Nothing on the server re-runs the review:
it is a local gate, and `git push --no-verify` gets past it. Agents never
use `--no-verify`.

**Disagreeing with a review.** Reviewers are wrong sometimes. The owner,
and only the owner, clears a commit by hand from a terminal:

```sh
node vendor/UnderwayEngine/tooling/review.js accept <base>..<tip> <reason>   # a range
node vendor/UnderwayEngine/tooling/review.js accept <sha> <reason>           # one commit
```

It asks for confirmation and refuses to run without an interactive terminal,
which an agent's shell does not have. The reason is kept beside the review.

**Cost.** One Opus session per review pass (plus one per fix round),
however many commits accrued — not one per commit. Under a Claude login that
counts against the plan's usage limits; with `ANTHROPIC_API_KEY` set it
runs `--bare` and is billed to the key. A very large range is one large
prompt: run the pass often enough that the combined diff stays readable.

## Shipping

Agents commit on `main` and **never push**. Changes accrue locally until
the owner runs the review pass: the `/ship` skill (the project's stub in
`.claude/skills/ship/SKILL.md`, which follows `tooling/skills/ship.md`),
which drives `npm run ship` (`tooling/ship.js`) to a push and takes the
review's feedback. `ship` runs G1, then G2 over everything unpushed, then
`git push --recurse-submodules=on-demand origin main`, stopping at the
first failure with an exit code that says which (listed in the script's
header and in the skill). Before any of it, it refuses: off `main`, with
tracked changes not committed, behind `origin/main`, with a submodule
commit not on its `main`, or with a change to the backend's wire schema
unless `--backend-live` says the backend is deployed — the server goes
first.

On a failed check or a `changes-requested` review, the skill fixes each
failure or blocking finding in new commits on top — never rewriting the
commits under review — with messages starting `Review fixes:`, one line per
finding, and runs `ship` again. At most three review rounds; after a third
that does not pass, nothing is pushed and the open findings go to the
owner.

After a pass, `ship` appends a review note to HEAD's message before the
push: `Review: pass (<reviewer>)` (with the number of commits when more than
one), the suggestions not taken (one sentence each) and
`Record: .git/<records>/<hash>.md`. The record is the gate's own, found by
the range's diff exactly as the pre-push check finds it (`passingRecord` in
`tooling/review.js`), so a range rebased with its diff intact keeps its
note as it keeps its pass; with no passing record (none needed,
owner-accepted, or cleared commit by commit) `ship` says so and adds none.
The amend is `git commit --amend --only`: the message alone, so the diff
and its pass stand and nothing staged meanwhile slips in.

## G3 Docs

Two halves. Mechanical: every path a doc names exists
(`npm run check:doc-paths`, in G1; which docs, and the project's own words
that look like paths and are not, come from the config's `docPaths`).
Judgment: a doc the change made false or left incomplete blocks the review
(G2, check 5), with the doc and section named.

## Why on `main`, not on branches

The review is per range and the gate is at the push, so unpushed commits
on local `main` play the part a PR branch plays elsewhere: nothing reaches
`origin/main` without a pass. Agents work in the checkout on its current
branch; no branches, worktrees or copies unless the owner asks
(`CLAUDE.shared.md` "Github"). Branches would add something only if the
review had to run on the server as a merge check (which needs PRs and an
API key in CI), or if several agents worked at once and needed to stay out
of each other's way.

## Changing the gates

The gate's own files live in the engine (`tooling/`): a change to them
reaches a project as a submodule pointer bump, which is always reviewed —
by the brief at the OLD pointer, so a change cannot loosen its own review.
A project's own pieces (`.githooks/`, `.claude/`, CI, `docs/review/`,
`underway.config.json`) are always reviewed too, against the addendum
already on `origin/main`. Only the instructions are pinned that way: which
commits need a review (`alwaysReview`, `LINE_THRESHOLD`) is read from the
working tree, so a commit that edits that list is judged by its own edit —
which is one more reason the reviewer always sees it. Change this document
with them.
