#!/usr/bin/env node
'use strict';

/**
 * The review pass (tooling/gates.md): ship everything committed on `main` and
 * not yet pushed — the checks (G1), ONE independent review of the whole
 * unpushed range as a combined diff (G2), then the push, stopping at the
 * first thing that fails. Agents commit on `main` and never push; the owner
 * runs this through the `/ship` skill (tooling/skills/ship.md) when enough
 * has accrued. Shared by every project that vendors the engine; the
 * project's own values come from its underway.config.json (tooling/config.js).
 *
 *   npm run ship                     # check, review, push origin/main..HEAD
 *   npm run ship -- --backend-live   # …a backend schema change already deployed
 *   npm run ship -- --autonomous <sha>
 *                                    # an AGENT-driven pass, for work the
 *                                    #   owner granted one: the range may
 *                                    #   hold only commits after <sha>
 *
 * It refuses, before running anything:
 *   - off `main`, or with tracked changes not committed (the checks would
 *     test the working tree, not what is pushed);
 *   - under `--autonomous <sha>`, a range holding any commit that is not
 *     after `<sha>`: an agent's commits carry the owner's name, so the only
 *     checkable reading of "the work I was granted" is the boundary it
 *     starts at, and what gets PUSHED is the whole range either way;
 *   - a review round past the cap (ROUND_CAP, three). The skill has always
 *     said three; here it is a refusal, because prose is a gate only while a
 *     person is reading it and a loop will otherwise go round again on a
 *     finding it cannot fix;
 *   - a commit in the range that changes the backend's wire schema (the
 *     config's `backendSchema`), unless `--backend-live` says that schema is
 *     deployed (CLAUDE.shared.md "The server goes first");
 *   - a commit in the range that removes the submodule (ship does not
 *     handle a removal; it is pushed by hand);
 *   - a submodule pointer, recorded by ANY commit in the range, whose commit
 *     is neither on the submodule's remote nor on its local `main` (a
 *     detached commit cannot be pushed by name; CLAUDE.shared.md "Submodule").
 *
 * The push is `git push --recurse-submodules=on-demand`, so the submodule
 * commits the pointer needs go up first, and the pre-push hook re-checks
 * the review gate.
 *
 * When the review requests changes, the fixes are new commits on top and
 * the next run reviews the range again, briefed with the earlier findings
 * (review.js "Rounds"). History already written is not rewritten.
 *
 * After the review passes and before the push, HEAD's commit message gets a
 * review note (`reviewNote`): the verdict, how many commits it covered, the
 * suggestions not taken, and the path of the full record in the review
 * directory the config names. Amending the message leaves the range's diff,
 * and so the pass, as it was. Its record is the gate's own, keyed by the
 * diff (`review.js` `passingRecord`), so a rebase that kept the diff — which
 * keeps its pass — keeps its note too. The amend is `--only`: the message
 * alone, never anything staged meanwhile. A commit already noted is left
 * alone; a range with no passing record (none needed, owner-accepted, or
 * cleared commit by commit) gets no note, and ship says so.
 *
 * A range cleared by an AGENT OVERRIDE (review.js `override`) gets a
 * different note and gets it FIRST (`overrideNote`): its record's verdict is
 * `changes-requested`, so the passing-record path would find nothing and the
 * push would carry no note at all — exactly the case that must not go
 * unannounced. The note names the reason and every blocking finding
 * disagreed with, so an override is legible from `git log` alone.
 *
 * Untracked files are not refused (they are often someone else's), but
 * they are listed: a module the commit imports and forgot to stage passes
 * here and fails in CI.
 *
 * Exit: 0 shipped (or nothing to ship); 1 a check failed; 2 usage or a
 * refusal above; 3 the review requested changes; 4 the review could not run;
 * 5 needs the backend deployed first; 6 the push failed; 7 the round cap.
 */

const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');
const { loadConfig } = require('./config.js');
const {
  lastField, passingRecord, overrideRecord, nextRound, rangeCleared,
} = require('./review.js');

const REVIEW = path.join(__dirname, 'review.js');
const DEFAULTS = { schema: 'backend/src/validation.ts', submodule: 'vendor/UnderwayEngine' };

// Review rounds on one base before the range needs a person. Three is the
// number the skill has always carried in prose; it is a refusal here so that
// a pass being driven by a loop cannot quietly go round a fourth time.
const ROUND_CAP = 3;

/** What the range's changed paths ask of a ship. Pure, for the tests. */
function shipPlan(changedPaths, { schema, submodule } = DEFAULTS) {
  return {
    backendTests: changedPaths.some((p) => p.startsWith('backend/')),
    schemaChange: changedPaths.includes(schema),
    submoduleBump: changedPaths.includes(submodule),
  };
}

/** The checks to run, in order, as [label, command, args]. */
function checkCommands(plan) {
  const checks = [
    ['tests', 'npm', ['test', '--silent']],
    ['typecheck', 'npm', ['run', 'typecheck', '--silent']],
    ['doc paths', 'npm', ['run', 'check:doc-paths', '--silent']],
  ];
  if (plan.backendTests) checks.push(['backend tests', 'npm', ['run', 'test:backend', '--silent']]);
  return checks;
}

/** The first sentence of a finding, for a one-line bullet. */
function firstSentence(text, max = 160) {
  const end = text.search(/\.(\s|$)/);
  const one = end >= 0 ? text.slice(0, end + 1) : text;
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/**
 * The note a passing review leaves on its commit message, or null when the
 * record is not a pass. `recordPath` is where the full review is kept.
 */
function reviewNote(record, recordPath) {
  if (lastField(record, 'VERDICT') !== 'pass') return null;
  const reviewer = (record.match(/^Reviewer: (.+)$/m) || [])[1] || 'independent reviewer';
  const notTaken = [...record.matchAll(/^- \[suggestion\] (.+)$/gm)].map((m) => `- ${firstSentence(m[1])}`);
  const commits = Number((record.match(/^Commits: (\d+)$/m) || [])[1]) || 1;
  const lines = [`Review: pass (${reviewer})${commits > 1 ? `, ${commits} commits` : ''}`];
  if (notTaken.length) lines.push('Suggestions not taken:', ...notTaken);
  lines.push(`Record: ${recordPath}`);
  return lines.join('\n');
}

/**
 * The note an AGENT OVERRIDE leaves instead (review.js `override`): the
 * verdict it overrode, the reason, and every blocking finding disagreed
 * with, one per line.
 *
 * A pushed override has to be legible from `git log` alone. An override is
 * the one thing in this process that puts an agent's judgment above the
 * independent reviewer's, so the commit says so in as many words, rather
 * than carrying the ordinary "Review:" note or none at all — which would
 * leave it looking like a change nobody reviewed.
 */
function overrideNote(over, recordPath, overridePath) {
  const reason = (over.text.match(/^Reason: (.+)$/m) || [])[1] || '(no reason recorded)';
  const commits = Number((over.text.match(/^Commits: (\d+)$/m) || [])[1]) || 1;
  const lines = [
    `Review: OVERRIDDEN by agent — ${over.findings.length} blocking finding(s) disputed`
    + `${commits > 1 ? `, ${commits} commits` : ''}`,
    `Reason: ${reason}`,
  ];
  if (over.findings.length) lines.push('Disputed:', ...over.findings.map((f) => `- ${firstSentence(f)}`));
  lines.push(`Record: ${recordPath}`, `Override: ${overridePath}`);
  return lines.join('\n');
}

/** review.js's exit code as ship's. */
function reviewExit(code) {
  if (code === 0) return 0;
  return code === 1 ? 3 : 4;
}

function gitRaw(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function git(args) {
  return gitRaw(args).trim();
}

function refuse(message, code = 2) {
  console.error(`ship: ${message}`);
  process.exit(code);
}

function run(label, cmd, args) {
  console.log(`\n==> ${label}: ${cmd} ${args.join(' ')}`);
  // `shell` on Windows, where `npm` is `npm.cmd`: since the
  // CVE-2024-27980 hardening Node REFUSES to spawn a .cmd without one
  // (EINVAL, a null status), which `run` read as a non-zero exit — so
  // every npm check (tests, typecheck, doc paths, the backend suite)
  // reported failure there without running at all, and no ship from a
  // Windows machine could reach the review. The args are this file's own
  // literals, so the escaping DEP0190 warns about has nothing to bite on;
  // POSIX is left spawning directly, as it was.
  const shell = process.platform === 'win32';
  return spawnSync(cmd, args, { stdio: 'inherit', shell }).status ?? 1;
}

function root() {
  return git(['rev-parse', '--show-toplevel']);
}

function onMain() {
  if (git(['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') refuse('not on main');
}

/** True when the message already ends in a review note (its last
 *  paragraph is one `reviewNote` wrote), so a report quoting "Review:" in
 *  the body does not stop the note. */
function hasReviewNote(message) {
  const last = message.trimEnd().split(/\n\s*\n/).pop();
  return /^Review: \S/.test(last) && /^Record: \S+$/m.test(last);
}

/** Append the range's review note to HEAD's message (see the header). */
function noteHead() {
  const sha = git(['rev-parse', 'HEAD']);
  const message = gitRaw(['log', '-1', '--format=%B', sha]).replace(/\s+$/, '');
  if (hasReviewNote(message)) return;
  // Forward slashes whoever ships: the note goes into a COMMIT MESSAGE,
  // which is read on every platform and in every clone, and path.relative
  // hands back backslashes on Windows — so the same record was quoted two
  // ways depending on the machine that pushed.
  const rel = (p) => path.relative(root(), p).split(path.sep).join('/');
  // An agent override is checked FIRST: its range has a record whose verdict
  // is `changes-requested`, so the passing-record path would find nothing
  // and the push would carry no note at all — which is precisely the case
  // that must not go unannounced.
  const over = overrideRecord('origin/main..HEAD');
  if (over) {
    const note = overrideNote(over, rel(over.recordPath), rel(over.path));
    execFileSync('git', ['commit', '--amend', '--only', '-q', '-F', '-'], { input: `${message}\n\n${note}\n` });
    console.log(`ship: OVERRIDE note added to ${sha.slice(0, 9)} (now ${git(['rev-parse', '--short=9', 'HEAD'])})`);
    return;
  }
  // The gate's own record for the unpushed range, keyed by its diff (review.js).
  const record = passingRecord('origin/main..HEAD');
  const recordPath = record && rel(record.path);
  const note = record && reviewNote(record.text, recordPath);
  if (!note) {
    console.log(`ship: no passing review record for ${sha.slice(0, 9)}; no review note added`);
    return;
  }
  // --only: the message alone. Anything staged meanwhile stays staged and
  // out of a commit that was reviewed without it.
  execFileSync('git', ['commit', '--amend', '--only', '-q', '-F', '-'], { input: `${message}\n\n${note}\n` });
  console.log(`ship: review note added to ${sha.slice(0, 9)} (now ${git(['rev-parse', '--short=9', 'HEAD'])})`);
}

/**
 * What the arguments ask for. `--autonomous <sha>` is the scope gate for an
 * agent-driven pass (CLAUDE.shared.md "Independent review and shipping"):
 * the range may hold ONLY commits after `<sha>`, the work the owner granted
 * the pass for. Nothing else about the pass changes — the same checks, the
 * same review, the same refusals.
 */
function parseArgs(argv) {
  const opts = { backendLive: false, autonomousBase: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--backend-live') { opts.backendLive = true; continue; }
    if (arg === '--autonomous') {
      opts.autonomousBase = argv[++i];
      if (!opts.autonomousBase || opts.autonomousBase.startsWith('--')) {
        refuse('--autonomous needs the commit the granted work starts after: ship --autonomous <sha>');
      }
      continue;
    }
    refuse(`unknown argument ${arg}; usage: ship [--backend-live] [--autonomous <sha>]`);
  }
  return opts;
}

function ship(argv) {
  const opts = parseArgs(argv);
  process.chdir(root());
  const cfg = loadConfig(process.cwd());
  const SCHEMA = cfg.backendSchema;
  const SUBMODULE = cfg.submodule;
  onMain();
  if (git(['status', '--porcelain', '--untracked-files=no'])) {
    refuse('tracked files have uncommitted changes; commit or stash them first (the checks must test what is pushed)');
  }
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
  if (untracked) console.warn(`ship: untracked files (not in the commit, but seen by the checks):\n${untracked}`);
  git(['fetch', '--quiet', 'origin', 'main']);
  const range = 'origin/main..HEAD';
  if (!git(['rev-list', range])) {
    console.log('ship: nothing to ship');
    return 0;
  }
  if (git(['rev-list', 'HEAD..origin/main'])) refuse('origin/main has commits main does not; pull (rebase) first');

  // The autonomous scope gate. The range is what gets PUSHED, not what the
  // agent happens to have written, and an agent's commits carry the owner's
  // name — so "only my own work" cannot be read off the authorship. What can
  // be checked is the boundary: every commit about to be pushed must be one
  // of the commits after the granted base.
  if (opts.autonomousBase) {
    const base = git(['rev-parse', opts.autonomousBase]);
    const granted = new Set(git(['rev-list', `${base}..HEAD`]).split('\n').filter(Boolean));
    const outside = git(['rev-list', range]).split('\n').filter(Boolean).filter((sha) => !granted.has(sha));
    if (outside.length) {
      const shown = outside.slice(0, 5).map((sha) => `  ${git(['log', '-1', '--format=%h %s', sha])}`);
      refuse(
        `--autonomous was granted from ${base.slice(0, 9)}, but ${outside.length} commit(s) in the push `
        + `predate it:\n${shown.join('\n')}${outside.length > 5 ? `\n  …and ${outside.length - 5} more` : ''}\n`
        + 'An autonomous pass ships only the work it was granted for. Hand this range to the owner.',
      );
    }
  }

  // The round cap, machine-enforced. It was prose in the `/ship` skill, which
  // is a gate only while a person is reading it; a loop driving the pass will
  // go round forever on a finding it cannot fix. Refusing BEFORE the reviewer
  // starts also saves the round's cost.
  //
  // It asks `rangeCleared` FIRST, and that order is the whole correctness of
  // it: an override and an owner accept both leave the review record's
  // verdict at `changes-requested`, so the round count goes on rising on a
  // range that is already settled. Capped without this check, ship refused
  // round four on an OVERRIDDEN range — the one pass an override exists to
  // make — and on an owner `accept` after three refused rounds, which was a
  // regression in a path that predates the cap. A cap belongs on rounds that
  // would start a reviewer, not on a range nobody will review again.
  if (!rangeCleared(range)) {
    const round = nextRound(range);
    if (round > ROUND_CAP) {
      refuse(
        `this would be review round ${round} of the same base, and the cap is ${ROUND_CAP}. `
        + 'Three rounds that did not pass means the range needs a person: report the open findings and stop.',
        7,
      );
    }
  }

  const plan = shipPlan(git(['diff', '--name-only', range]).split('\n').filter(Boolean), { schema: SCHEMA, submodule: SUBMODULE });
  if (plan.schemaChange && !opts.backendLive) {
    refuse(
      `the range changes ${SCHEMA}. A new value: deploy the backend, verify it is live, then ship --backend-live. `
      + 'A retirement goes the other way (the app ships first, the backend after) and a comment-only edit changes '
      + 'nothing: ship --backend-live once you are sure the deployed backend accepts everything the app sends',
      5,
    );
  }
  if (plan.submoduleBump) {
    // The commits the RANGE records, not whatever is checked out in the
    // submodule: a checkout on `main` says nothing about a pointer that
    // names a detached commit. Every commit in the range that moved the
    // pointer is checked, so an earlier bump is not hidden behind a later
    // one. A removal is refused first, before anything asks the submodule
    // checkout (which a removal leaves without one).
    const bumps = git(['log', '--format=%H', range, '--', SUBMODULE]).split('\n').filter(Boolean)
      .map((sha) => ({ sha, pointer: git(['ls-tree', sha, SUBMODULE]).split(/\s+/)[2] }));
    const removal = bumps.find((b) => !b.pointer);
    if (removal) refuse(`${removal.sha.slice(0, 9)} removes ${SUBMODULE}; ship does not handle that, push it by hand`);
    if (path.resolve(git(['-C', SUBMODULE, 'rev-parse', '--show-toplevel'])) !== path.resolve(SUBMODULE)) {
      refuse(`${SUBMODULE} is not initialised; git submodule update --init first`);
    }
    // A pointer passes when its commit is already on the remote, or on the
    // submodule's local `main` (which the push then carries up).
    const sub = (args) => spawnSync('git', ['-C', SUBMODULE, ...args], { encoding: 'utf8' });
    for (const { sha, pointer } of bumps) {
      const onRemote = sub(['branch', '-r', '--contains', pointer]);
      const onMain = sub(['merge-base', '--is-ancestor', pointer, 'main']).status === 0;
      if (!(onRemote.status === 0 && onRemote.stdout.trim()) && !onMain) {
        refuse(`${SUBMODULE} pointer ${pointer.slice(0, 9)} (commit ${sha.slice(0, 9)}) is not on the submodule's main; a detached commit cannot be pushed by name`);
      }
    }
  }

  for (const [label, cmd, args] of checkCommands(plan)) {
    if (run(label, cmd, args) !== 0) refuse(`${label} failed; fix it in a new commit and ship again`, 1);
  }
  const review = reviewExit(run('review', 'node', [REVIEW, 'pending']));
  if (review === 3) refuse('the review requested changes; fix the blocking findings in new commits on top and ship again', 3);
  if (review === 4) refuse('the review could not run', 4);
  noteHead();
  if (run('push', 'git', ['push', '--recurse-submodules=on-demand', 'origin', 'main']) !== 0) refuse('the push failed', 6);
  console.log('\nship: pushed');
  return 0;
}

if (require.main === module) {
  const [first, ...rest] = process.argv.slice(2);
  try {
    process.exitCode = ship(first ? [first, ...rest] : []);
  } catch (e) {
    console.error(e.stack || String(e));
    process.exit(2);
  }
}

module.exports = {
  shipPlan, checkCommands, reviewExit, reviewNote, overrideNote, noteHead, parseArgs, ROUND_CAP,
};
