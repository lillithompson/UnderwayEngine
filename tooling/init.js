#!/usr/bin/env node
'use strict';

/**
 * Wire a project to the shared shipping process (tooling/README.md).
 * Idempotent: every file it writes it writes the same way again, and a file
 * the project already has in another shape is reported, not overwritten,
 * except the stubs that are by definition this tooling's (the hook, the ship
 * skill, the workflow), which are kept in step.
 *
 *   node vendor/UnderwayEngine/tooling/init.js [--name <word>]
 *
 * Writes, from the project root:
 *   underway.config.json           from underway.config.example.json, with
 *                                  the name given (or the repository's
 *                                  directory name) — only if absent
 *   .githooks/pre-push             the one-line hook (tooling/pre-push)
 *   .claude/skills/ship/SKILL.md   a stub that follows tooling/skills/ship.md
 *   .github/workflows/submodule-pointer-check.yml
 *   package.json                   the scripts review, review:pending,
 *                                  review:check, ship, check:doc-paths,
 *                                  check:clone, and the hooks-path line in
 *                                  postinstall
 * and then runs check-clone.js, so a fresh clone is told what it still lacks.
 */

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { CONFIG_FILE } = require('./config.js');

const TOOLING = 'vendor/UnderwayEngine/tooling';

const SCRIPTS = {
  'check:doc-paths': `node ${TOOLING}/check-doc-paths.js`,
  'check:clone': `node ${TOOLING}/check-clone.js`,
  review: `node ${TOOLING}/review.js commit`,
  'review:pending': `node ${TOOLING}/review.js pending`,
  'review:check': `node ${TOOLING}/review.js check`,
  ship: `node ${TOOLING}/ship.js`,
};

const HOOKS_PATH = 'git config core.hooksPath .githooks || true';

const SKILL_STUB = `---
name: ship
description: The review pass — run the checks and one independent review over every unpushed commit on main, fix what the review finds in new commits on top, and push. Only when the user asks to run it.
disable-model-invocation: true
---

# Review and push everything unpushed

Follow \`${TOOLING}/skills/ship.md\` — the shared skill text, which this
stub exists to point at (a skill has to live in the project's own
\`.claude/skills/\`). The project's values the pass reads are in
\`${CONFIG_FILE}\`.
`;

function root() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

/** Write `rel` with `text` unless it already holds it; say which. */
function put(dir, rel, text, { keep = false } = {}) {
  const file = path.join(dir, rel);
  const had = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (had === text) return console.log(`  same     ${rel}`);
  if (had !== null && keep) return console.log(`  kept     ${rel} (differs; not overwritten)`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  console.log(`  ${had === null ? 'wrote   ' : 'updated '} ${rel}`);
}

/** The project's package.json with the shared scripts and the hooks-path
 *  postinstall; the text to write, or null when nothing changes. */
function packageJsonWith(text) {
  const pkg = JSON.parse(text);
  pkg.scripts = pkg.scripts || {};
  let changed = false;
  for (const [k, v] of Object.entries(SCRIPTS)) {
    if (pkg.scripts[k] !== v) { pkg.scripts[k] = v; changed = true; }
  }
  const post = pkg.scripts.postinstall || '';
  if (!post.includes('core.hooksPath')) {
    pkg.scripts.postinstall = post ? `${post} && (${HOOKS_PATH})` : `(${HOOKS_PATH})`;
    changed = true;
  }
  return changed ? `${JSON.stringify(pkg, null, 2)}\n` : null;
}

function init(argv, dir = root()) {
  const nameAt = argv.indexOf('--name');
  const name = nameAt >= 0 ? argv[nameAt + 1] : path.basename(dir).toLowerCase();
  console.log(`init: ${dir}`);
  const example = JSON.parse(fs.readFileSync(path.join(__dirname, 'underway.config.example.json'), 'utf8'));
  // The name given, and the values spelled from it (the record directory).
  put(dir, CONFIG_FILE, `${JSON.stringify({ ...example, name, reviewRecords: `${name}-reviews` }, null, 2)}
`, { keep: true });
  put(dir, '.githooks/pre-push', fs.readFileSync(path.join(__dirname, 'pre-push'), 'utf8'));
  put(dir, '.claude/skills/ship/SKILL.md', SKILL_STUB);
  put(dir, '.github/workflows/submodule-pointer-check.yml',
    fs.readFileSync(path.join(__dirname, 'workflows', 'submodule-pointer-check.yml'), 'utf8'));
  const pkgFile = path.join(dir, 'package.json');
  if (fs.existsSync(pkgFile)) {
    const next = packageJsonWith(fs.readFileSync(pkgFile, 'utf8'));
    if (next) { fs.writeFileSync(pkgFile, next); console.log('  updated  package.json (scripts, postinstall)'); } else console.log('  same     package.json');
  } else {
    console.log('  missing  package.json (no scripts written)');
  }
  const r = spawnSync(process.execPath, [path.join(__dirname, 'check-clone.js')], { cwd: dir, stdio: 'inherit' });
  return r.status ?? 1;
}

if (require.main === module) process.exitCode = init(process.argv.slice(2));

module.exports = { init, packageJsonWith, SCRIPTS, SKILL_STUB, TOOLING };
