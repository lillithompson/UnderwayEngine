import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every path a doc names must exist (tooling/check-doc-paths.js, G3 in
// tooling/gates.md). The checker is bound to a project root and its
// underway.config.json; here it runs over a scratch repository of its own,
// so nothing depends on any one project.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { make, expandBraces } = require('../check-doc-paths.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { loadConfig } = require('../config.js');

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
};

let root: string;
type Checker = {
  checkFile(rel: string): { line: number; path: string }[];
  resolves(rel: string): boolean;
  isCandidate(s: string): boolean;
  checkoutFiles(dir: string, prefix: string): string[];
  DEFAULT_DOCS: string[];
  main(docs?: string[]): number;
};
let c: Checker;

const write = (rel: string, text = rel) => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, env: ENV, encoding: 'utf8' }).trim();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'docpaths-'));
  execFileSync('git', ['init', '-q', '-b', 'main', root], { env: ENV });
  write('.gitignore', '*.tsbuildinfo\n');
  write('scripts/ship.js');
  write('scripts/review.js');
  write('scripts/check-web-bundle-fresh.js');
  write('docs/review/project-rules.md');
  write('plugins/withWebBundle.js');
  write('Sol.md', 'See `scripts/ship.js`, `review.js` and `docs/review/`.\n');
  write('README.md', '`scripts/ship.js` ships; `nothingIsCalledThis.ts` is a miss; `sol:entry:` is a key.\n\n```\n`fenced/paths/are/skipped.ts`\n```\n');
  write('underway.config.json', JSON.stringify({
    name: 'sol',
    docPaths: { docs: ['README.md', 'Sol.md'], prose: ['^sol:', '^(seed|plant):'], extensions: ['.ogg'], generated: ['web-out'] },
  }));
  git('add', '.');
  git('commit', '-q', '-m', 'root');
  c = make(root, loadConfig(root));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('the documented paths', () => {
  it('reads the docs the config names', () => {
    expect(c.DEFAULT_DOCS).toEqual(['README.md', 'Sol.md']);
    expect(c.checkFile('Sol.md')).toEqual([]);
  });

  it('reports the line and the path of every miss, and exits 1 for one', () => {
    expect(c.checkFile('README.md')).toEqual([{ line: 1, path: 'nothingIsCalledThis.ts' }]);
    expect(c.main()).toBe(1);
    expect(c.main(['Sol.md'])).toBe(0);
    expect(c.main(['missing.md'])).toBe(1);
  });
});

describe('the checker itself', () => {
  it('resolves a rooted path, a bare basename and a missing file', () => {
    expect(c.resolves('scripts/ship.js')).toBe(true);
    expect(c.resolves('docs/review/')).toBe(true);
    // A basename alone is enough: a map names a module under the heading that
    // gives its directory.
    expect(c.resolves('review.js')).toBe(true);
    expect(c.resolves('nothingIsCalledThis.ts')).toBe(false);
    // …but a path WITH a directory gets no such latitude.
    expect(c.resolves('docs/review.js')).toBe(false);
  });

  it('counts what a clean checkout has, not what is on disk', () => {
    // CI's checkout has the tracked files; a gitignored file this clone
    // generated is not in it, so it does not resolve.
    write('scripts/probe.tsbuildinfo', '');   // gitignored
    write('scripts/probe.txt', '');           // a new file a doc names in its own commit
    const fresh: Checker = make(root, loadConfig(root));
    const files = new Set(fresh.checkoutFiles(root, ''));
    expect(files.has('scripts/ship.js')).toBe(true);
    expect(files.has('scripts/probe.txt')).toBe(true);
    expect(files.has('scripts/probe.tsbuildinfo')).toBe(false);
    expect(fresh.resolves('scripts/probe.txt')).toBe(true);
    expect(fresh.resolves('scripts/probe.tsbuildinfo')).toBe(false);
  });

  it('resolves a module specifier with the extension left off', () => {
    expect(c.resolves('./plugins/withWebBundle')).toBe(true);
    expect(c.resolves('scripts/ship')).toBe(true);
  });

  it('resolves a glob segment by any match', () => {
    expect(c.resolves('scripts/check-*')).toBe(true);
    expect(c.resolves('scripts/nosuchprefix*')).toBe(false);
  });

  it('expands a brace list and requires every branch', () => {
    expect(expandBraces('scripts/{ship,review}.js')).toEqual(['scripts/ship.js', 'scripts/review.js']);
    expect(expandBraces('scripts/ship.js')).toEqual(['scripts/ship.js']);
    expect(c.checkFile('Sol.md')).toEqual([]);
  });

  it('takes a package name, a URL, a key, a tag, a placeholder and the project’s own words for prose', () => {
    for (const notAPath of [
      'expo-router', 'strict', 'https://example.com/x', '@/engine/types',
      '@expo/vector-icons', 'sol:doc:<compositionId>', 'sol:entry:', 'comp_meta_<id>',
      'seed:<seedId>', 'plant:x', 'ios/<AppName>/web-bundle/', '/editor',
      '/editor?format=sol', 'origin/main', 'web/sol/kernel/foo.ts',
      'dist/', 'node_modules/', 'web-out/', '.git/sol-reviews/', 'expo-env.d.ts',
    ]) {
      expect([notAPath, c.isCandidate(notAPath)]).toEqual([notAPath, false]);
    }
  });

  it('takes a repo path for a path, the project’s own extensions included', () => {
    for (const aPath of [
      'scripts/ship.js', 'docs/review/', 'review.js', 'package.json',
      'web/sol/kernel/', 'docs/sol_architecture.md', 'click.ogg',
    ]) {
      expect([aPath, c.isCandidate(aPath)]).toEqual([aPath, true]);
    }
    // A project that names no .ogg files does not get the extension, and
    // one that declares no prose of its own reads a key WITH a slash as a path.
    const plain: Checker = make(root, loadConfig(tmpdir()));
    expect(plain.isCandidate('click.ogg')).toBe(false);
    expect(plain.isCandidate('sol:entry/x')).toBe(true);
    expect(c.isCandidate('sol:entry/x')).toBe(false);
  });
});
