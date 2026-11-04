# Build a UX flow capture

This is the shared text of every project's `/build-ux-flow` skill; the
project's `.claude/skills/build-ux-flow/SKILL.md` is a stub that names the flow
to film and points here. Run it only when the user asks.

Three deliverables, every time:

1. **Screenshots**: numbered PNGs in `<flows>/<flow>/`, filmed by a committed
   `scripts/case_studies/flow-<flow>.js`.
2. **The writeup**: `<flows>/<flow>/writeup.json`, built by `build-writeup.js`
   and published as an artifact.
3. **UX suggestions**: what the frames turned up, added to
   `docs/ux_suggestions.md`. Then sweep the whole doc: remove empty sections
   and renumber.

`<flows>` is `flows/` under the project's `caseStudies` folder
(`underway.config.json`, `../Portfolio/case_studies` by default).
`<tooling>` below is `vendor/UnderwayEngine/tooling`. Run every command from
the project's root.

Never write to production: the harness refuses every host the project has not
routed. Commit each finished flow on `main`, staging only the files it touched,
and never push; the ship pass does (`CLAUDE.shared.md`, "Github"). Never create
a branch.

## The project's values

`scripts/case_studies/README.md` holds what differs between projects. If it or
`scripts/case_studies/harness.js` is missing, stop and say the project is not
wired yet (`<tooling>/README.md`, "Wiring a project"). The README says:

- **Web build**: the command that exports the web build to film.
- **Backend**: how to start a local API before each run and where its log is,
  or that the project has none to start.
- **People**: the regulars to film as, and how to sign in and seed them. A
  project with no accounts says so, and its flows film one browser.
- **Seeding**: how a flow sets up its preconditions.
- **Not filmable**: what only exists in the native app.
- **Flows**: what each filmed flow does, its frame count and its gotchas.

## 0. Before starting

- Run `git status --short` and note what is already changed. Those changes
  aren't yours.
- Run `git -C vendor/UnderwayEngine rev-parse --abbrev-ref HEAD`. If it prints
  `HEAD`, run `git -C vendor/UnderwayEngine checkout main` before building. A
  detached submodule breaks the web build.
- Read `scripts/case_studies/README.md`, the project's `harness.js` and the
  existing `flow-*.js` closest to this one, if there are any.
- If the description is too vague to film (for example, which game, or whether
  a step is filmed or seeded), ask once with AskUserQuestion. Otherwise decide
  and say what you decided in the final report.

## 1. Plan the flow

- **Slug**: kebab-case, from what happens (`group-invite-copy`). If
  `<flows>/<slug>/` already exists, this is a re-capture: overwrite the frames,
  keep its `writeup.json`'s `artifact` URL, and republish to that artifact.
- **People**: use the project's regulars. Add another person only if the flow
  needs one.
- **Filmed vs. seeded**: film every step the user described. Seed the
  preconditions the way the README says. Film a precondition only when it
  can't be seeded, and drop those frames or put them in a "Setup" phase.
- **Phases**: 3 to 6 named stretches. Aim for 10 to 35 frames: one per distinct
  screen state, not one per click. The page budget is 15 MB, about 120 frames.

## 2. Film it

Build the web app and start any backend as the README says, again before every
run if its data is in memory. Then:

```
npm i --no-save playwright-core          # once
node scripts/case_studies/flow-<slug>.js [stopAfterFrame]
```

- Write `scripts/case_studies/flow-<slug>.js` in the style of its siblings. It
  needs a header comment saying what it films, `clearFrames(OUT)` first (it
  keeps `writeup.json`), `filmstrip()` for frame numbers, and frames named
  `NN-<person>-<what>`, or `NN-<what>` with no people.
- **Reuse before writing.** A step another flow already does belongs in a shared
  helper in `scripts/case_studies/`, or in `<tooling>/case_studies/` if every
  project could use it. If it is copy-pasted inside one flow, lift it and use it
  from both. Never ship a second copy (`CLAUDE.shared.md`, "Avoid duplicate and
  redundant code").
- Drive the app the way a person does: `h.tap(label)` real clicks, and
  `h.draw(points)` real touch strokes. Wait for UI, not for fixed times, where
  you can.
- Iterate with the stop-after-frame argument, which prints the screen's text and
  buttons. Restart any backend between runs.
- **Look at every frame**
  (`node <tooling>/case_studies/sheet.js <dir> <out.png> from to`, then Read the
  sheet). Each frame must show what its caption will say. Re-film any blank,
  mid-animation or wrong frame.
- If the **harness** can't do something the app can, fix the harness and add a
  test. Say so in the writeup's setup.
- If the **app** blocks the flow (a crash or a refusal), stop and tell the user.
  Read the backend's log first, if it has one, and `h.errors` and `h.refused`.
  Don't fix app code as part of this skill. A bug that doesn't block the flow is
  a finding.
- Native-only steps can't be filmed here. List them under "Not covered" in the
  setup.

## 3. Findings

Go through the frames as a first-time user would. A finding must be **seen on
screen in a frame**, not inferred from code. Cite frame numbers.

- Tags: `bug` (plainly wrong), `friction` (works, but costs the user something),
  `polish` (wording or detail), `check` (seen in the harness, confirm on a
  device), and `works` (what goes well; one or two at most).
- Before writing one up, check `docs/ux_suggestions.md` for the same issue. If
  it's already there, cite its number in the writeup ("still open, UX 2.1")
  instead of filing it twice.
- Write plainly. Quote the on-screen text exactly. Say what the user sees, then
  why it matters.

## 4. The writeup

1. Write `<flows>/<slug>/writeup.json`. The field list is in the header of
   `<tooling>/case_studies/build-writeup.js`. `lede` ends "Captured from current
   main on <D Month YYYY>." `setup` says how many headless Chrome sessions at
   390×844, what the app talked to and that nothing was written to production,
   what was seeded, what isn't covered, and "To re-run it, see
   `scripts/case_studies/README.md`."
2. `node <tooling>/case_studies/build-writeup.js <slug> --check`. It refuses a
   spec whose steps, phases or people don't match the frames. Fix the spec and
   rerun. Read one of its `.check-*.png` screenshots once. It prints the built
   page's path.
3. Read the claude-artifacts `guide` tool's `pages` topic if this session hasn't.
   Publish the built page with `publish_files` (the page as `index.html`), with
   `title` and `icon: "phone"`. If `writeup.json` has an `artifact` URL, call
   `get_artifact` on it first and pass its slug, its version as `base_version`,
   and its read value as `shared_live` when that is `users`, `org` or `public`,
   so the link stays the same.
4. Put the artifact URL into `writeup.json` as `"artifact"`.

## 5. docs/ux_suggestions.md

The doc lists only what is **still open**. Leave out `works` and `fixed` items.
If the project has no such doc yet, start one: a title, a line saying it lists
what is still open, a sentence counting the flows above a flows table, and an
unnumbered "Not yet covered" section.

1. **Add the flow** to the flows table (slug, frame count, one line of what
   happens) and fix the flow count in the sentence above the table.
2. **Add the findings** as a new numbered section after the last "Seen in …"
   section: `## N. Seen in the \`<slug>\` capture (<D Month YYYY>)`, then one
   `### N.M <Finding> — <Bug|Friction|Polish|Check>` per finding, matching the
   existing entries. Each entry says what is on screen (frames `<slug>` N–M), why
   it matters, and `**Suggest:**` a direction. Name the code only when you
   checked it.
3. **Sweep the whole doc.**
   - Remove every numbered section that holds no open item. That includes a
     section that says only "Nothing open." or lists items that were taken out,
     and its `---` separator. Unnumbered sections ("Not yet covered") stay; trim
     a line there if this flow now covers it.
   - Renumber the numbered sections 1, 2, 3…, in order, and renumber each
     section's `###` items N.1, N.2… to match.
   - If any number changed, keep the intro's note that commits and code comments
     citing older numbers refer to earlier versions in git history. Keep a
     mapping of old to new numbers.
4. **Fix stale citations.** Code comments cite items as `UX §4.3` or `UX 1.4`.
   Many of these cite older numberings of the doc and must be left alone. For
   each renumbered item, run `git grep -nE "UX ?§?<old>\b" -- '*.ts' '*.tsx'
   '*.js'`. Treat a hit as citing the current numbering only if `git log -S`
   shows it arrived after the doc's last renumbering. To find that commit, run
   `git log --oneline -- docs/ux_suggestions.md` and look for "renumber" in the
   message. Reword those comments to name the finding instead of the number.
   Change only comments. When this sweep renumbers, say "renumber" in the commit
   message, so the next sweep can find the commit.

## 6. Finish

- Add the flow to the "Flows" list in `scripts/case_studies/README.md` (what it
  films, frame count, and any gotcha the next person needs).
- Run `npm test` and `npm run typecheck`. If you touched `vendor/UnderwayEngine`,
  also run jest inside it, and commit there first (`CLAUDE.shared.md`,
  "Submodule"). Fix any failures.
- Stop any local backend you started.
- Commit it (one commit per flow); do not push. The frames and writeup live
  outside this repository, so say where they are; do not commit them from here.
- Report to the user:
  - the artifact link
  - the frames directory and count
  - each finding with its new UX number
  - the old→new renumbering, if any, and the comments you reworded
  - harness changes
  - what you decided that the description left open
  - the files changed
