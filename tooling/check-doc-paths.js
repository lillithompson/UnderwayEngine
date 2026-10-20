#!/usr/bin/env node
'use strict';

/**
 * Guard against a documentation file naming a path that does not exist.
 *
 * A project's `CLAUDE.md` names the files its rules are about, its
 * `README.md` names commands and setup files, and its codebase map and
 * design documents name the module that owns each behaviour. A reader uses
 * these to find that module, so a path that has been renamed or deleted is
 * worse than no path at all. The docs are prose, not generated, and nothing
 * else in the build reads them — so without this check they rot silently.
 *
 * Shared by every project that vendors the engine; which docs it reads and
 * the project's own vocabulary come from underway.config.json
 * (`docPaths`, see tooling/config.js):
 *
 *   npm run check:doc-paths                 # the config's `docPaths.docs`
 *   npm run check:doc-paths -- README.md    # specific files
 *
 * Exits 1 and lists every (file, line, path) that does not resolve.
 *
 * What counts as a path: a backtick-quoted run of text that looks like a repo
 * path — it contains a `/` or ends in a known source extension, and carries no
 * spaces. A trailing `/` means "a directory". Four shapes are resolved rather
 * than rejected:
 *
 *   - a glob segment (`components/progress*`) is satisfied by any match;
 *   - a brace list (`web/store/{entryStore,types}.ts`) is expanded and every
 *     branch must exist;
 *   - a module specifier with no extension (`./plugins/withWebBundle`) is
 *     tried against each known source extension;
 *   - a BARE basename (`tick.ts`, `logic/`) is satisfied by a file or
 *     directory of that name anywhere in the tree, submodules included. A
 *     codebase map names a module under the heading that gives its
 *     directory, and spelling the directory again on every row of a
 *     twenty-row table reads worse than it checks. Anything carrying a `/`
 *     is resolved from the repo root and gets no such latitude.
 *
 * Deliberately NOT checked: anything that is plainly a package name
 * (`expo-router`), a URL, a key or an identifier (the config's `prose`
 * patterns add a project's own — its IndexedDB key prefix, its node-name
 * tags); a path containing a `<placeholder>`; a path inside `.git/`, which
 * exists in the clone that made it and no other (CI's checkout has no review
 * records); and the generated artefacts (`generated`), which are correct to
 * name and absent from a clean checkout.
 *
 * "Exists" means exists in a clean checkout: a file git tracks, or one not
 * yet added that .gitignore does not exclude (so a doc can name a file in
 * the same commit that creates it), in this repo and in its submodules. A
 * gitignored file on disk does not count. It is present in a clone that has
 * built and absent from CI's, so counting it passed here and failed there.
 * The cost of a false positive here is somebody adding a path to an ignore
 * list instead of fixing the doc, so the test is "does this look like a file
 * in this repo", and the answer has to be yes before a miss is reported.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('./config.js');

/** The project root: the repository the command runs in. */
function findRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return process.cwd();
  }
}

/** Prefixes that are never repo paths however they are spelled, in any
 *  project; the config's `prose` adds the project's own. */
const NEVER_A_PATH = [
  /^https?:\/\//,
  /^@\//,            // a tsconfig alias, not a file
  /^@[a-z0-9-]+\//i, // an npm scope
  /^comp_/,          // an engine IndexedDB key
  /^\$/,
  /^\//,            // an absolute route, not a repo path
  /[<>]/,            // a `<placeholder>`, not a name
  /[?&]/,            // a route with a query string
  /^[a-z0-9-]+\.(com|org|net|io|dev)\//i, // a URL with the scheme left off
  /^origin\//,       // a git ref
  /^\.git\//,        // git's own state (ship's review records): local, never in a clone
  /\bfoo\b|\bFoo\b|\bbar\b/, // metasyntactic: CLAUDE.md's grep examples
];

/**
 * A checker bound to one project root and its config. `make` is what the
 * command and the tests call; the module-level functions below are the
 * default instance's, for a project's `require`.
 */
function make(root = findRoot(), cfg = loadConfig(root)) {
  const SOURCE_EXT = new Set(cfg.docPaths.extensions);
  const NOT_A_PATH = [...NEVER_A_PATH, ...cfg.docPaths.prose];
  const GENERATED = new Set(cfg.docPaths.generated);
  const DEFAULT_DOCS = cfg.docPaths.docs;

  function isCandidate(s) {
    if (!s || /\s/.test(s)) return false;
    if (NOT_A_PATH.some((re) => re.test(s))) return false;
    const clean = s.replace(/\/$/, '');
    if (GENERATED.has(clean) || GENERATED.has(clean.split('/')[0])) return false;
    const hasSlash = s.includes('/');
    const hasExt = SOURCE_EXT.has(path.extname(clean));
    return hasSlash || hasExt;
  }

  /** The files a clean checkout has, as repo-relative paths: tracked or
   *  untracked-and-not-ignored, in `dir` and, recursively, its submodules. */
  function checkoutFiles(dir, prefix) {
    const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 })
      .split('\0').filter(Boolean);
    const submodules = git('ls-files', '--stage', '-z')
      .filter((line) => line.startsWith('160000 '))
      .map((line) => line.slice(line.indexOf('\t') + 1));
    const skip = new Set(submodules);
    const out = git('ls-files', '--cached', '--others', '--exclude-standard', '-z')
      .filter((f) => !skip.has(f) && fs.existsSync(path.join(dir, f))) // a tracked file deleted in the working tree is gone
      .map((f) => prefix + f);
    for (const sub of submodules) {
      // A submodule not checked out has no .git of its own; its path stays a bare directory.
      if (fs.existsSync(path.join(dir, sub, '.git'))) out.push(...checkoutFiles(path.join(dir, sub), `${prefix}${sub}/`));
      else out.push(`${prefix}${sub}/`);
    }
    return out;
  }

  /** The checkout as a tree, built once: each directory ('' is the root) to
   *  the names directly inside it, and every file and directory name in it. */
  let TREE = null;
  function tree() {
    if (TREE) return TREE;
    const children = new Map([['', new Set()]]);
    const names = new Set();
    for (const file of checkoutFiles(root, '')) {
      const parts = file.replace(/\/$/, '').split('/');
      let dir = '';
      for (const part of parts) {
        children.get(dir).add(part);
        names.add(part);
        dir = dir ? `${dir}/${part}` : part;
        if (!children.has(dir)) children.set(dir, new Set());
      }
    }
    TREE = { children, names };
    return TREE;
  }

  /** Is `rel` a file or directory in the checkout? */
  function inCheckout(rel) {
    const parts = rel.split('/');
    const dir = parts.slice(0, -1).join('/');
    return !!tree().children.get(dir)?.has(parts[parts.length - 1]);
  }

  /** Does `rel` resolve, allowing one `*` glob segment? */
  function resolves(rel) {
    const clean = rel.replace(/^\.\//, '').replace(/\/$/, '');
    if (!clean || clean.startsWith('..')) return false;

    // A bare basename: a file or directory of that name anywhere in the tree.
    if (!clean.includes('/') && !clean.includes('*')) {
      if (tree().names.has(clean)) return true;
      return SOURCE_EXT.has(path.extname(clean)) ? false : withExtension(clean);
    }

    if (!clean.includes('*')) {
      if (inCheckout(clean)) return true;
      // A module specifier with the extension left off.
      return path.extname(clean) === '' && withExtension(clean);
    }

    const parts = clean.split('/');
    const starAt = parts.findIndex((p) => p.includes('*'));
    const dir = parts.slice(0, starAt).join('/');
    const entries = [...(tree().children.get(dir) ?? [])];
    const re = new RegExp(`^${parts[starAt].replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    const rest = parts.slice(starAt + 1);
    return entries.some((e) => {
      if (!re.test(e)) return false;
      if (rest.length === 0) return true;
      return inCheckout([...parts.slice(0, starAt), e, ...rest].join('/'));
    });
  }

  /** `plugins/withWebBundle` → true if `plugins/withWebBundle.js` exists (or any
   *  other known source extension), as a bare name or a rooted path. */
  function withExtension(clean) {
    for (const ext of SOURCE_EXT) {
      const withExt = clean + ext;
      if (clean.includes('/')) {
        if (inCheckout(withExt)) return true;
      } else if (tree().names.has(withExt)) {
        return true;
      }
    }
    return false;
  }

  function checkFile(rel) {
    const full = path.join(root, rel);
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
    const misses = [];
    let inFence = false;
    lines.forEach((line, i) => {
      if (/^\s*```/.test(line)) { inFence = !inFence; return; }
      if (inFence) return; // fenced blocks hold shell commands and trees
      for (const m of line.matchAll(/`([^`]+)`/g)) {
        const raw = m[1];
        if (!isCandidate(raw)) continue;
        for (const cand of expandBraces(raw)) {
          if (!resolves(cand)) misses.push({ line: i + 1, path: cand });
        }
      }
    });
    return misses;
  }

  /** Check `docs` (the config's by default); the exit code. */
  function main(docs = DEFAULT_DOCS) {
    let failed = 0;
    let checked = 0;
    for (const doc of docs) {
      if (!fs.existsSync(path.join(root, doc))) {
        console.error(`${doc}: not found`);
        failed++;
        continue;
      }
      const misses = checkFile(doc);
      checked++;
      if (misses.length === 0) {
        console.log(`✓ ${doc} — every path named resolves`);
      } else {
        failed += misses.length;
        console.error(`✗ ${doc} — ${misses.length} path(s) do not resolve:`);
        for (const m of misses) console.error(`    ${doc}:${m.line}  ${m.path}`);
      }
    }
    if (failed) console.error(`\n${failed} unresolved path(s) across ${checked} document(s).`);
    return failed ? 1 : 0;
  }

  return { root, checkFile, resolves, isCandidate, expandBraces, checkoutFiles, DEFAULT_DOCS, main };
}

/** `a/{b,c}.ts` -> ['a/b.ts', 'a/c.ts']; anything else -> [input]. */
function expandBraces(s) {
  const m = /^(.*)\{([^{}]*)\}(.*)$/.exec(s);
  if (!m) return [s];
  return m[2]
    .split(',')
    .flatMap((part) => expandBraces(`${m[1]}${part.trim()}${m[3]}`));
}

if (require.main === module) {
  const docs = process.argv.slice(2);
  process.exitCode = make().main(docs.length ? docs : undefined);
}

module.exports = { make, expandBraces };
