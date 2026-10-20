# Review and push everything unpushed

This is the shared text of every project's `/ship` skill; the project's
`.claude/skills/ship/SKILL.md` is a stub that points here. Run it only
when the user asks.

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

Never run `review.js accept`, never push with `--no-verify` or by hand,
and never edit `vendor/UnderwayEngine/tooling/`, `docs/review/`,
`.githooks/` or `underway.config.json` to get a range through. Clearing a
review is the owner's call.

## Report

- what was pushed: `git log --oneline` of the range as pushed (and the
  submodule's), or that nothing was;
- each review round's verdict, the blocking findings and the commit that
  fixed each;
- the suggestions not taken (also on HEAD's commit message);
- anything left for the user: an open finding, a backend deploy, a perf
  risk the review raised.
