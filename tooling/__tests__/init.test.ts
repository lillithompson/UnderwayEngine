import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Wiring a project to the shared process (tooling/init.js) and the per-clone
// settings every fresh clone forgets (tooling/check-clone.js), run against a
// scratch repository.

/* eslint-disable @typescript-eslint/no-var-requires */
const { init, packageJsonWith, SCRIPTS, TOOLING } = require('../init.js');
const { checkClone } = require('../check-clone.js');
/* eslint-enable @typescript-eslint/no-var-requires */

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'init-'));
  execFileSync('git', ['init', '-q', '-b', 'main', dir], { env: ENV });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('packageJsonWith', () => {
  it('adds the shared scripts and the hooks-path postinstall, keeping what the project has', () => {
    const next = JSON.parse(packageJsonWith(JSON.stringify({ name: 'x', scripts: { test: 'jest', postinstall: 'patch-package' } })));
    expect(next.scripts.test).toBe('jest');
    for (const [k, v] of Object.entries(SCRIPTS)) expect(next.scripts[k]).toBe(v);
    expect(next.scripts.postinstall).toBe('patch-package && (git config core.hooksPath .githooks || true)');
    expect(next.scripts.ship).toBe(`node ${TOOLING}/ship.js`);
  });

  it('changes nothing in a package already wired', () => {
    const wired = packageJsonWith(JSON.stringify({ name: 'x', scripts: { test: 'jest' } }));
    expect(packageJsonWith(wired)).toBeNull();
  });
});

describe('init', () => {
  it('writes the stubs and the config once, and the same again the second time', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: {} }));
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      init(['--name', 'myapp'], dir);
      const cfg = JSON.parse(readFileSync(join(dir, 'underway.config.json'), 'utf8'));
      expect(cfg.name).toBe('myapp');
      expect(readFileSync(join(dir, '.githooks', 'pre-push'), 'utf8')).toContain(`${TOOLING}/review.js" check --pre-push`);
      expect(readFileSync(join(dir, '.claude', 'skills', 'ship', 'SKILL.md'), 'utf8')).toContain(`${TOOLING}/skills/ship.md`);
      expect(existsSync(join(dir, '.github', 'workflows', 'submodule-pointer-check.yml'))).toBe(true);
      expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts.ship).toBe(SCRIPTS.ship);
      // The project's config is its own: a second run with another name keeps it.
      writeFileSync(join(dir, 'underway.config.json'), JSON.stringify({ name: 'kept' }));
      log.mockClear();
      init(['--name', 'other'], dir);
      expect(JSON.parse(readFileSync(join(dir, 'underway.config.json'), 'utf8')).name).toBe('kept');
      const said = log.mock.calls.map((c) => String(c[0]));
      expect(said.filter((s) => s.includes('same'))).toHaveLength(4);   // hook, skill, workflow, package.json
      expect(said.some((s) => s.includes('kept'))).toBe(true);
    } finally {
      log.mockRestore();
    }
  });
});

describe('checkClone', () => {
  it('names each missing per-clone setting with its fix, and passes once they are set', () => {
    const before = checkClone(dir);
    expect(before.filter((r: { ok: boolean }) => !r.ok).map((r: { fix: string }) => r.fix)).toEqual([
      'git config push.recurseSubmodules on-demand',
      'git config submodule.recurse true',
      'git config core.hooksPath .githooks',
    ]);
    for (const r of before) if (!r.ok) execFileSync('sh', ['-c', r.fix], { cwd: dir, env: ENV });
    expect(checkClone(dir).every((r: { ok: boolean }) => r.ok)).toBe(true);
  });
});
