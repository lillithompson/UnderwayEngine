#!/usr/bin/env node
'use strict';

/**
 * The per-clone setup every project needs and every fresh clone forgets
 * (CLAUDE.shared.md "Submodule", tooling/gates.md "Enforced by"): three git
 * settings that are not committed and so do not travel with the clone, and
 * a line-ending check. Prints each setting's state and, for every one that
 * is wrong, the command that fixes it. Exits 1 when anything is wrong, so
 * `npm run check:clone` can gate a script.
 *
 *   push.recurseSubmodules on-demand   pushing the parent pushes the
 *                                      submodule commits its pointer needs,
 *                                      and aborts if it cannot
 *   submodule.recurse true             pull/checkout update the submodule
 *   core.hooksPath .githooks           the review gate's pre-push hook
 *   LF checkout                        the .gitattributes say eol=lf, but a
 *                                      clone checked out CRLF before they
 *                                      landed is not rewritten by pulling
 *                                      them; the source-text pins then fail
 */

const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** [{label, ok, fix}] for the clone at `dir`. */
function checkClone(dir, submodule = 'vendor/UnderwayEngine') {
  const want = [
    ['push.recurseSubmodules', 'on-demand'],
    ['submodule.recurse', 'true'],
    ['core.hooksPath', '.githooks'],
  ];
  const rows = want.map(([key, value]) => ({
    label: `${key} = ${value}`,
    ok: git(['config', '--get', key], dir) === value,
    fix: `git config ${key} ${value}`,
  }));
  // A CRLF checkout: any tracked text file whose working-tree bytes carry
  // CRLF while the index has LF (`i/lf w/crlf` in --eol's columns).
  const crlf = (where) => {
    const out = git(['ls-files', '--eol'], where) || '';
    return out.split('\n').some((l) => /^i\/lf\s+w\/crlf/.test(l));
  };
  rows.push({
    label: 'LF checkout (parent)',
    ok: !crlf(dir),
    fix: 'git rm -r -q --cached . && git reset -q --hard',
  });
  const sub = path.join(dir, submodule);
  if (git(['rev-parse', '--show-toplevel'], sub)) {
    rows.push({
      label: `LF checkout (${submodule})`,
      ok: !crlf(sub),
      fix: `git -C ${submodule} rm -r -q --cached . && git -C ${submodule} reset -q --hard`,
    });
    rows.push({
      label: `${submodule} on main`,
      ok: git(['rev-parse', '--abbrev-ref', 'HEAD'], sub) === 'main',
      fix: `git -C ${submodule} checkout main`,
    });
  }
  return rows;
}

function main() {
  const dir = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const rows = checkClone(dir);
  for (const r of rows) console.log(`  ${r.ok ? 'ok  ' : 'FIX '} ${r.label}${r.ok ? '' : `\n         ${r.fix}`}`);
  const bad = rows.filter((r) => !r.ok);
  if (bad.length) {
    console.error(`\ncheck-clone: ${bad.length} setting(s) to fix; run the commands above in this clone.`);
    return 1;
  }
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { checkClone };
