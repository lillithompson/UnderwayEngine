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
 *
 * It refuses, before running anything:
 *   - off `main`, or with tracked changes not committed (the checks would
 *     test the working tree, not what is pushed);
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
 * Untracked files are not refused (they are often someone else's), but
 * they are listed: a module the commit imports and forgot to stage passes
 * here and fails in CI.
 *
 * Exit: 0 shipped (or nothing to ship); 1 a check failed; 2 usage or a
 * refusal above; 3 the review requested changes; 4 the review could not run;
 * 5 needs the backend deployed first; 6 the push failed.
 */

const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');
const { loadConfig } = require('./config.js');
const { lastField, passingRecord } = require('./review.js');

const REVIEW = path.join(__dirname, 'review.js');
const DEFAULTS = { schema: 'backend/src/validation.ts', submodule: 'vendor/UnderwayEngine' };

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
  // The gate's own record for the unpushed range, keyed by its diff (review.js).
  const record = passingRecord('origin/main..HEAD');
  // Forward slashes whoever ships: the note goes into a COMMIT MESSAGE,
  // which is read on every platform and in every clone, and path.relative
  // hands back backslashes on Windows — so the same record was quoted two
  // ways depending on the machine that pushed.
  const recordPath = record && path.relative(root(), record.path).split(path.sep).join('/');
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

function ship(argv) {
  for (const arg of argv) if (arg !== '--backend-live') refuse(`unknown argument ${arg}; usage: ship [--backend-live]`);
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

  const plan = shipPlan(git(['diff', '--name-only', range]).split('\n').filter(Boolean), { schema: SCHEMA, submodule: SUBMODULE });
  if (plan.schemaChange && !argv.includes('--backend-live')) {
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

module.exports = { shipPlan, checkCommands, reviewExit, reviewNote, noteHead };
