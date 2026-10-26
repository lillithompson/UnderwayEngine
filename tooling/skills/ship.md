# Review and push everything unpushed

This is the shared text of every project's `/ship` skill; the project's
`.claude/skills/ship/SKILL.md` is a stub that points here. Run it only
when the user asks — or, for work the owner has granted an AUTONOMOUS pass
for, as often as the loop needs ("An autonomous pass", below).

Agents commit on `main` and never push (`CLAUDE.shared.md` "Independent
review and shipping"). This is the one place pushing happens: `npm run
ship` (`vendor/UnderwayEngine/tooling/ship.js`) runs the checks, ONE
review of the whole unpushed range as a combined diff, and the push
(`tooling/gates.md`). Your job is to drive it to a push, taking the
review's feedback here.

## Before the first run

1. `git status --short`. Uncommitted changes to tracked files make ship
   refuse. They are not yours to commit: STOP and ask the user to commit or
   stash them. Untracked files are fine; leave them.
2. Be on `main` (never create a branch). `git fetch origin`; if
   `origin/main` has commits `main` does not, `git pull --rebase`. A
   conflict: STOP and tell the user.
3. List what is about to ship: `git log --oneline origin/main..HEAD`, and
   the same with `-C vendor/UnderwayEngine`. Nothing there: say so and stop.

## The loop

Run `npm run ship` and act on its exit code:

- **0**: pushed. Go to "Report".
- **1** (a check failed: tests, typecheck, doc paths, backend tests): fix
  it following `CLAUDE.md`, commit the fix as a NEW commit on top (staging
  only the files you touched), and run ship again.
- **3** (the review requested changes): the review is printed and saved at
  the `.git/<records>/…md` path on the `VERDICT` line (the record directory
  `underway.config.json` names). Read it. For every `[blocking]` finding:
  fix it following `CLAUDE.md` (grep for duplication, add tests, update
  docs), run `npm test` and `npm run typecheck`, and commit as NEW commits
  on top — never amend or rebase the commits under review. Each fix
  commit's message starts `Review fixes:` and lists, one line per finding,
  what was fixed. Then run ship again; the next round is briefed with the
  earlier findings and judges what you added (`review.js` "Rounds").
  `[suggestion]`s are optional: take the cheap, clearly right ones; the
  rest are noted on the pushed commit automatically.
  If you think a blocking finding is wrong, do not work around it: STOP and
  tell the user why, quoting the finding.
  **At most three review rounds.** If the third does not pass, STOP: do not
  push, and report every open finding word for word, the record path, and
  what you committed in this pass.
- **2** (a refusal): read the message. Uncommitted changes that are not
  yours, a submodule not on `main`, or anything you cannot fix: STOP and
  tell the user. `origin/main` moved: `git pull --rebase` and run again.
- **4** (the review could not run): run ship once more; if it fails again,
  STOP and tell the user.
- **5** (the range changes the backend's wire schema): do not push. Tell
  the user which commit; a new value must be deployed on the backend
  first, then `npm run ship -- --backend-live` (`CLAUDE.shared.md` "The
  server goes first").
- **6** (the push failed): STOP and report git's error.
- **7** (the review round cap): a fourth round on the same base is refused
  before a reviewer starts. STOP: do not push, and report every open
  finding word for word, the record path, and what you committed. The cap
  is not gated on who is driving the pass, so an owner-driven pass reaches
  it too.

Never run `review.js accept`, never push with `--no-verify` or by hand,
and never edit `vendor/UnderwayEngine/tooling/`, `docs/review/`,
`.githooks/` or `underway.config.json` to get a range through. Clearing a
review is the owner's call.

## An autonomous pass

Everything above is the owner driving the pass. Where the owner has granted
an AUTONOMOUS pass for a named piece of work (`CLAUDE.shared.md`
"Independent review and shipping"; for the shared editor's consolidation,
`vendor/UnderwayEngine/docs/shared-editor.md` §5), you run the loop yourself
and do not stop between rounds. Four things change, and nothing else does.

1. **Pass the scope.** `npm run ship -- --autonomous <sha>`, where `<sha>`
   is the last commit that is NOT the granted work — the base the grant
   starts after. Ship refuses the pass if the range holds anything older,
   and names it. Take that refusal at its word: a queue with someone else's
   commit in it is not yours to push, so report it and stop.

2. **Do not stop on exit 1 or 3.** Fix and run again, as above. The round
   cap is now the SCRIPT's (exit **7**): a fourth round on the same base is
   refused before a reviewer starts. On 7, stop and report every open
   finding word for word — three rounds that did not pass means the range
   needs a person, and a fourth round would be the same argument again.

3. **A blocking finding you judge WRONG is overridden on the record**, not
   worked around and not quietly left:

   ```sh
   node vendor/UnderwayEngine/tooling/review.js override <base>..<tip> <reason>
   ```

   It refuses unless a review ran and requested changes, so it is never a
   way past a review that did not happen. Then run ship again: the range is
   cleared, and the push carries `Review: OVERRIDDEN by agent` with your
   reason and every finding you disputed. Before using it, re-read the
   finding against the code — in this programme's rounds so far nearly every
   blocking finding has been correct, including ones that looked wrong at
   first. Override a finding that is WRONG, never one that is awkward or
   expensive, and never one you have not checked. Prefer fixing.

4. **Still never** `review.js accept` (the owner's, and it needs a
   terminal), never `--no-verify`, never an edit to `tooling/`,
   `docs/review/`, `.githooks/` or `underway.config.json` to get a range
   through.

Stop and ask the user, even under a grant, for: exit 2 you cannot fix
(uncommitted work that is not yours, a submodule off `main`), exit 5 (a
backend deploy), exit 6 (the push failed), exit 7 (the round cap), a range
holding a commit from before the grant, or anything that would need one of
the four "still never" items.

The report is the same, plus: every round's verdict in order, and every
override with its reason and the findings it covered, called out rather than
folded into the list of what was pushed.

## Report

- what was pushed: `git log --oneline` of the range as pushed (and the
  submodule's), or that nothing was;
- each review round's verdict, the blocking findings and the commit that
  fixed each;
- the suggestions not taken (also on HEAD's commit message);
- anything left for the user: an open finding, a backend deploy, a perf
  risk the review raised.
