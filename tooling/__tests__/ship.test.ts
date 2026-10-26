// `npm run ship` (tooling/ship.js, tooling/gates.md): what a range of changed
// paths asks of a ship, the checks it runs, and how a review's exit code
// reads. The git and npm calls themselves are not run here.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { shipPlan, checkCommands, reviewExit, reviewNote, ROUND_CAP } = require('../ship.js');

describe('shipPlan', () => {
  it('asks for the backend suite only when backend/ changed', () => {
    expect(shipPlan(['web/sol/kernel/cycle.ts']).backendTests).toBe(false);
    expect(shipPlan(['backend/src/handler.ts']).backendTests).toBe(true);
  });

  it('flags the wire schema shared with the deployed backend, the configured one', () => {
    expect(shipPlan(['backend/src/validation.ts']).schemaChange).toBe(true);
    expect(shipPlan(['backend/src/handler.ts']).schemaChange).toBe(false);
    expect(shipPlan(['server/schema.ts'], { schema: 'server/schema.ts', submodule: 'vendor/UnderwayEngine' }).schemaChange).toBe(true);
  });

  it('flags a submodule pointer bump', () => {
    expect(shipPlan(['vendor/UnderwayEngine']).submoduleBump).toBe(true);
    expect(shipPlan(['vendor/UnderwayEngine/README.md']).submoduleBump).toBe(false);
    expect(shipPlan(['lib/engine'], { schema: 'x', submodule: 'lib/engine' }).submoduleBump).toBe(true);
  });
});

describe('checkCommands', () => {
  it('runs G1 in order — tests, typecheck, doc paths — and the backend suite when asked', () => {
    const labels = (backendTests: boolean) =>
      checkCommands({ backendTests, schemaChange: false, submoduleBump: false }).map(([l]: [string]) => l);
    expect(labels(false)).toEqual(['tests', 'typecheck', 'doc paths']);
    expect(labels(true)).toEqual(['tests', 'typecheck', 'doc paths', 'backend tests']);
  });
});

describe('reviewNote', () => {
  const record = (verdict: string, findings = '') => [
    'Commit: abc', 'Reviewer: claude/opus', '', '## Findings', findings, '', 'REVIEWED_COMMIT: abc',
    `VERDICT: ${verdict}`,
  ].join('\n');

  it('notes a pass: the reviewer, each suggestion not taken in one sentence, and where the record is', () => {
    const note = reviewNote(record('pass', [
      '- [suggestion] `a.ts:1` A long point. With a second sentence.',
      '- [suggestion] Another one',
    ].join('\n')), '.git/sol-reviews/x.md');
    expect(note).toBe([
      'Review: pass (claude/opus)',
      'Suggestions not taken:',
      '- `a.ts:1` A long point.',
      '- Another one',
      'Record: .git/sol-reviews/x.md',
    ].join('\n'));
  });

  it('leaves out the suggestions line when there were none, and notes nothing but a pass', () => {
    expect(reviewNote(record('pass'), 'r.md')).toBe('Review: pass (claude/opus)\nRecord: r.md');
    expect(reviewNote(record('changes-requested'), 'r.md')).toBeNull();
    // The LAST verdict is the one that counts, as the gate reads it: a body
    // that quotes a pass does not make one.
    expect(reviewNote(record('changes-requested', 'VERDICT: pass'), 'r.md')).toBeNull();
  });

  it('cuts a suggestion with no sentence end at a readable length', () => {
    const note = reviewNote(record('pass', `- [suggestion] ${'x'.repeat(300)}`), 'r.md');
    expect(note.split('\n')[2].length).toBeLessThanOrEqual(162);
  });
});

describe('reviewExit', () => {
  it('reads review.js: pass is 0, changes requested is 3, anything else could not run (4)', () => {
    expect(reviewExit(0)).toBe(0);
    expect(reviewExit(1)).toBe(3);
    for (const code of [2, 3, 4, null]) expect(reviewExit(code)).toBe(4);
  });
});

// The refusals and the review note, run for real against a throwaway repository
// with a local bare `origin` and an underway.config.json naming the project
// sol (no network, no npm: every case here stops before the checks).
describe('ship.js in a scratch repository', () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { execFileSync, spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  /* eslint-enable @typescript-eslint/no-var-requires */
  const SHIP = path.join(__dirname, '..', 'ship.js');
  const ENV = {
    ...process.env,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  };
  let base: string;
  let dir: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, env: ENV, encoding: 'utf8' }).trim();
  const ship = (...args: string[]) => spawnSync('node', [SHIP, ...args], { cwd: dir, env: ENV, encoding: 'utf8' });
  const commit = (file: string, text: string) => {
    fs.writeFileSync(path.join(dir, file), text);
    git('add', file);
    git('commit', '-q', '-m', `write ${file}`);
    return git('rev-parse', 'HEAD');
  };
  /** An env whose `npm` fails every check deterministically, so a test past
   *  a refusal never depends on what npm would find above the scratch tree. */
  const stubbedNpm = () => {
    const stubBin = path.join(base, 'npm-stub');
    fs.mkdirSync(stubBin, { recursive: true });
    fs.writeFileSync(path.join(stubBin, 'npm'), ['#!/bin/sh', 'exit 7', ''].join('\n'), { mode: 0o755 });
    fs.writeFileSync(path.join(stubBin, 'npm.cmd'), '@exit /b 7\r\n');
    const first = `${stubBin}${path.delimiter}`;
    return { ...ENV, PATH: first + process.env.PATH, Path: first + (process.env.Path || process.env.PATH) };
  };

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-'));
    const origin = path.join(base, 'origin.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { env: ENV });
    dir = path.join(base, 'work');
    execFileSync('git', ['clone', '-q', origin, dir], { env: ENV });
    git('checkout', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'underway.config.json'), JSON.stringify({ name: 'sol' }));
    git('add', 'underway.config.json');
    commit('a.txt', 'a');
    git('push', '-q', 'origin', 'main');
  });

  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

  it('has nothing to ship when main is origin/main', () => {
    const r = ship();
    expect([r.status, r.stdout]).toEqual([0, expect.stringContaining('nothing to ship')]);
  });

  it('refuses tracked changes that are not committed, and anything off main', () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'changed');
    expect(ship().status).toBe(2);
    git('checkout', '-q', '--', 'a.txt');
    git('checkout', '-q', '-b', 'side');
    expect(ship().status).toBe(2);
  });

  it('refuses when origin/main has moved on, and an unknown argument', () => {
    const other = path.join(base, 'other');
    execFileSync('git', ['clone', '-q', path.join(base, 'origin.git'), other], { env: ENV });
    fs.writeFileSync(path.join(other, 'o.txt'), 'o');
    execFileSync('git', ['add', 'o.txt'], { cwd: other, env: ENV });
    execFileSync('git', ['commit', '-q', '-m', 'o'], { cwd: other, env: ENV });
    execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: other, env: ENV });
    commit('b.txt', 'b');
    expect([ship().status, ship().stderr]).toEqual([2, expect.stringContaining('pull')]);
    expect(ship('--backend-liv').status).toBe(2);
  });

  it('refuses a change to the backend wire schema until --backend-live', () => {
    fs.mkdirSync(path.join(dir, 'backend', 'src'), { recursive: true });
    commit('backend/src/validation.ts', 'export {};');
    const r = ship();
    expect([r.status, r.stderr]).toEqual([5, expect.stringContaining('deploy the backend')]);
  });

  it('reads the schema path from the config', () => {
    fs.writeFileSync(path.join(dir, 'underway.config.json'), JSON.stringify({ name: 'sol', backendSchema: 'server/schema.ts' }));
    git('add', 'underway.config.json');
    git('commit', '-q', '-m', 'config');
    git('push', '-q', 'origin', 'main');
    fs.mkdirSync(path.join(dir, 'server'), { recursive: true });
    commit('server/schema.ts', 'export {};');
    const r = ship();
    expect([r.status, r.stderr]).toEqual([5, expect.stringContaining('server/schema.ts')]);
  });

  // The gate's own record for the unpushed range (review.js recordPath: keyed by the diff).
  const node = (code: string) =>
    execFileSync('node', ['-e', code], { cwd: dir, env: ENV, encoding: 'utf8' });
  const REVIEW = path.join(__dirname, '..', 'review.js');
  const recordFile = () => node(`process.stdout.write(require(${JSON.stringify(REVIEW)}).recordPath())`);
  const noteHead = () => node(`require(${JSON.stringify(SHIP)}).noteHead()`);
  const writeRecord = (file: string, sha: string, verdict: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `Commit: ${sha}\nReviewer: claude/opus\n\n- [suggestion] Tidy it.\n\nREVIEWED_COMMIT: ${sha}\nVERDICT: ${verdict}\n`);
  };

  it('notes HEAD\'s passing review once, from the gate\'s record, leaving the diff as it was', () => {
    const b = commit('b.txt', 'b');
    const diffBefore = git('diff', 'HEAD~1', 'HEAD');
    const file = recordFile();
    writeRecord(file, b, 'changes-requested');
    expect(noteHead()).toContain('no passing review record');   // not a pass: no note
    expect(git('rev-parse', 'HEAD')).toBe(b);
    writeRecord(file, b, 'pass');
    noteHead();
    expect(git('log', '-1', '--format=%B')).toBe(
      `write b.txt\n\nReview: pass (claude/opus)\nSuggestions not taken:\n- Tidy it.\nRecord: .git/sol-reviews/${path.basename(file)}`,
    );
    expect(git('diff', 'HEAD~1', 'HEAD')).toBe(diffBefore);
    const noted = git('rev-parse', 'HEAD');
    noteHead();                                                 // already noted: nothing changes
    expect(git('rev-parse', 'HEAD')).toBe(noted);
  });

  it('keeps the note of a range rebased onto a moved origin/main with its diff intact, as the gate keeps its pass', () => {
    const b = commit('b.txt', 'b');
    writeRecord(recordFile(), b, 'pass');
    const other = path.join(base, 'other');
    execFileSync('git', ['clone', '-q', path.join(base, 'origin.git'), other], { env: ENV });
    fs.writeFileSync(path.join(other, 'o.txt'), 'o');
    execFileSync('git', ['add', 'o.txt'], { cwd: other, env: ENV });
    execFileSync('git', ['commit', '-q', '-m', 'o'], { cwd: other, env: ENV });
    execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: other, env: ENV });
    git('fetch', '-q', 'origin');
    git('rebase', '-q', 'origin/main');
    expect(git('rev-parse', 'HEAD')).not.toBe(b);
    noteHead();
    expect(git('log', '-1', '--format=%B')).toContain('Review: pass (claude/opus)');
  });

  it('amends the message only: something staged meanwhile stays staged and out of the commit', () => {
    const b = commit('b.txt', 'b');
    writeRecord(recordFile(), b, 'pass');
    fs.writeFileSync(path.join(dir, 'late.txt'), 'late');
    git('add', 'late.txt');
    noteHead();
    expect(git('show', '--name-only', '--format=', 'HEAD')).toBe('b.txt');
    expect(git('diff', '--cached', '--name-only')).toBe('late.txt');
  });

  it('notes a commit whose message merely quotes "Review:" in its body', () => {
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b');
    git('add', 'b.txt');
    git('commit', '-q', '-m', 'fix (report x)\n\nReview: the user wrote this in the report');
    writeRecord(recordFile(), git('rev-parse', 'HEAD'), 'pass');
    noteHead();
    expect(git('log', '-1', '--format=%B')).toMatch(/\n\nReview: pass \(claude\/opus\)\n/);
  });

  it('notes the whole unpushed range on HEAD, with how many commits the review covered', () => {
    commit('b.txt', 'b');
    const c = commit('c.txt', 'c');
    const file = recordFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `Commit: ${c}\nCommits: 2\nReviewer: claude/opus\n\nREVIEWED_COMMIT: ${c}\nVERDICT: pass\n`);
    noteHead();
    expect(git('log', '-1', '--format=%B')).toBe(
      `write c.txt\n\nReview: pass (claude/opus), 2 commits\nRecord: .git/sol-reviews/${path.basename(file)}`,
    );
    expect(git('log', '-1', '--format=%B', 'HEAD~1')).toBe('write b.txt');
  });

  // The submodule refusal (CLAUDE.shared.md "Submodule"): a range in which
  // any commit's pointer names a commit on neither the submodule's remote
  // nor its local `main` cannot be pushed by name — including an earlier
  // pointer hidden behind a later, good one while the checkout sits on
  // `main`. A local bare repository stands in for the engine's origin.
  const addSubmodule = () => {
    const subOrigin = path.join(base, 'engine.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', subOrigin], { env: ENV });
    const seed = path.join(base, 'engine-seed');
    execFileSync('git', ['clone', '-q', subOrigin, seed], { env: ENV });
    const seedGit = (...args: string[]) => execFileSync('git', args, { cwd: seed, env: ENV, encoding: 'utf8' }).trim();
    seedGit('checkout', '-q', '-b', 'main');
    fs.writeFileSync(path.join(seed, 'engine.txt'), 'e');
    seedGit('add', 'engine.txt');
    seedGit('commit', '-q', '-m', 'engine');
    seedGit('push', '-q', 'origin', 'main');
    git('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', '-b', 'main', subOrigin, 'vendor/UnderwayEngine');
    git('commit', '-q', '-m', 'add engine');
    git('push', '-q', 'origin', 'main');
    const subDir = path.join(dir, 'vendor', 'UnderwayEngine');
    const sgit = (...args: string[]) => execFileSync('git', args, { cwd: subDir, env: ENV, encoding: 'utf8' }).trim();
    const engineCommit = (name: string) => {
      fs.writeFileSync(path.join(subDir, name), name);
      sgit('add', name);
      sgit('commit', '-q', '-m', `engine ${name}`);
      return sgit('rev-parse', 'HEAD');
    };
    const bump = () => {
      git('add', 'vendor/UnderwayEngine');
      git('commit', '-q', '-m', 'bump engine');
    };
    return { sgit, engineCommit, bump };
  };

  it('refuses a pointer at a detached submodule commit: on neither the remote nor main', () => {
    const { sgit, engineCommit, bump } = addSubmodule();
    sgit('checkout', '-q', '--detach');
    const detached = engineCommit('stray.txt');
    bump();                                        // the range records the detached commit; the tree is clean
    expect(sgit('branch', '--contains', detached, 'main')).toBe('');
    const r = ship();
    expect([r.status, r.stderr]).toEqual([2, expect.stringContaining(`pointer ${detached.slice(0, 9)}`)]);
  });

  it('refuses an earlier detached pointer behind a later one on main, with the checkout on main', () => {
    const { sgit, engineCommit, bump } = addSubmodule();
    sgit('checkout', '-q', '--detach');
    const stray = engineCommit('stray.txt');
    bump();                                        // the earlier bump records the detached commit
    sgit('checkout', '-q', 'main');
    engineCommit('new.txt');
    bump();                                        // HEAD's pointer is on main and fine
    expect(sgit('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    const r = ship();
    expect([r.status, r.stderr]).toEqual([2, expect.stringContaining(`pointer ${stray.slice(0, 9)}`)]);
  });

  it('refuses a range that removes the submodule, in words rather than a crash', () => {
    addSubmodule();
    git('rm', '-q', 'vendor/UnderwayEngine');
    git('commit', '-q', '-m', 'remove engine');
    const r = ship();
    expect([r.status, r.stderr]).toEqual([2, expect.stringContaining('removes vendor/UnderwayEngine')]);
    expect(r.stderr).not.toContain('Error');
  });

  it('lets a pointer on the submodule\'s local main through to the checks', () => {
    const { sgit, engineCommit, bump } = addSubmodule();
    expect(sgit('rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    engineCommit('new.txt');                       // on main, not yet pushed
    bump();
    // Past the refusal, the next thing ship does is run the checks. A stub
    // `npm` first on PATH fails them deterministically, so the test never
    // depends on what npm would find above the scratch directory.
    const stubBin = path.join(base, 'bin');
    fs.mkdirSync(stubBin);
    fs.writeFileSync(path.join(stubBin, 'npm'), '#!/bin/sh\nexit 7\n', { mode: 0o755 });
    fs.writeFileSync(path.join(stubBin, 'npm.cmd'), '@exit /b 7\r\n');
    const r = spawnSync('node', [SHIP], {
      cwd: dir, env: { ...ENV, PATH: `${stubBin}${path.delimiter}${process.env.PATH}`, Path: `${stubBin}${path.delimiter}${process.env.Path || process.env.PATH}` }, encoding: 'utf8',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).not.toContain('pointer');
    expect(r.stderr).toContain('tests failed');
  });

  // --autonomous <sha>: the scope gate for an agent-driven pass. An agent's
  // commits carry the owner's name, so the boundary is the only checkable
  // reading of "the work I was granted" — and the push takes the whole range
  // either way, which is what makes the check necessary rather than polite.
  describe('--autonomous', () => {
    it('needs the base it was granted from', () => {
      commit('b.txt', 'b');
      expect([ship('--autonomous').status, ship('--autonomous').stderr])
        .toEqual([2, expect.stringContaining('needs the commit')]);
      expect(ship('--autonomous', '--backend-live').stderr).toContain('needs the commit');
    });

    it('refuses a range holding a commit from before the grant, and names it', () => {
      // The base is the last commit that is NOT the granted work — the pass
      // ships what comes AFTER it. So an unpushed commit older than the base
      // is someone else's and stops the pass, named so the report can quote it.
      const earlier = commit('earlier.txt', 'not mine');
      commit('mine.txt', 'mine');
      const r = ship('--autonomous', earlier);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('1 commit(s) in the push predate it');
      expect(r.stderr).toContain('write earlier.txt');
      expect(r.stderr).not.toContain('write mine.txt');
    });

    it('lets a range entirely after the grant through to the checks', () => {
      const granted = git('rev-parse', 'HEAD');
      commit('mine.txt', 'mine');
      commit('mine2.txt', 'mine too');
      // Past the scope gate the next thing ship does is run the checks; a
      // stub npm first on PATH fails them deterministically.
      const r = spawnSync('node', [SHIP, '--autonomous', granted], {
        cwd: dir, env: stubbedNpm(), encoding: 'utf8',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).not.toContain('predate');
      expect(r.stderr).toContain('tests failed');
    });

    it('changes nothing else: the same refusals still apply', () => {
      const granted = git('rev-parse', 'HEAD');
      commit('b.txt', 'b');
      git('checkout', '-q', '-b', 'side');
      expect(ship('--autonomous', granted).status).toBe(2);
    });
  });

  // The round cap, machine-enforced (ROUND_CAP). It was prose in the /ship
  // skill, which is a gate only while a person is reading it.
  describe('the round cap', () => {
    const recordFor = (spec: string) => execFileSync('node', ['-e',
      `process.stdout.write(require(${JSON.stringify(path.join(__dirname, '..', 'review.js'))}).recordPath(${JSON.stringify(spec)}))`,
    ], { cwd: dir, env: ENV, encoding: 'utf8' });
    /** A commit that genuinely needs review (web/store/ is always reviewed),
     *  so the round count and the cap are about something. */
    const reviewable = (name: string) => {
      fs.mkdirSync(path.join(dir, 'web', 'store'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'web', 'store', name), name);
      git('add', '.');
      git('commit', '-q', '-m', `write ${name}`);
      return git('rev-parse', 'HEAD');
    };
    const roundFile = (baseSha: string) => {
      const records = path.join(dir, '.git', 'sol-reviews');
      fs.mkdirSync(path.join(records, 'rounds'), { recursive: true });
      return path.join(records, 'rounds', `${baseSha}.json`);
    };
    const refusedRound = (round: number) => {
      const baseSha = git('rev-parse', 'origin/main');
      const tip = git('rev-parse', 'HEAD');
      const records = path.join(dir, '.git', 'sol-reviews');
      const record = path.join(records, 'refused.md');
      fs.mkdirSync(records, { recursive: true });
      fs.writeFileSync(record, ['## Findings', '', '- [blocking] x.', '', 'VERDICT: changes-requested', ''].join('\n'));
      fs.writeFileSync(roundFile(baseSha), JSON.stringify({ round, tip, record }));
    };

    it('refuses the round after the cap, before a reviewer is started', () => {
      reviewable('b.ts');
      refusedRound(ROUND_CAP);
      reviewable('c.ts');
      const r = spawnSync('node', [SHIP], { cwd: dir, env: stubbedNpm(), encoding: 'utf8' });
      expect(r.status).toBe(7);
      expect(r.stderr).toContain(`review round ${ROUND_CAP + 1}`);
      expect(r.stderr).toContain('needs a person');
      // Refused BEFORE the checks, so the pass costs nothing.
      expect(r.stdout).not.toContain('==> tests');
    });

    it('does NOT refuse a range an override has cleared, which is the pass it is for', () => {
      reviewable('b.ts');
      const baseSha = git('rev-parse', 'origin/main');
      const tip = git('rev-parse', 'HEAD');
      const records = path.join(dir, '.git', 'sol-reviews');
      fs.mkdirSync(path.join(records, 'rounds'), { recursive: true });
      // Three refused rounds, then the agent's recorded disagreement. The
      // override leaves the record's verdict at changes-requested, so the
      // round count still reads 4 — the cap has to ask whether anything
      // will be reviewed again before it refuses.
      const record = recordFor('origin/main..HEAD');
      fs.writeFileSync(record, ['## Findings', '', '- [blocking] x.', '', 'VERDICT: changes-requested', ''].join('\n'));
      fs.writeFileSync(path.join(records, 'rounds', `${baseSha}.json`), JSON.stringify({ round: ROUND_CAP, tip, record }));
      fs.writeFileSync(record.replace(/\.md$/, '.overridden'), 'By: agent\nReason: the finding is wrong\n');
      const r = spawnSync('node', [SHIP], { cwd: dir, env: stubbedNpm(), encoding: 'utf8' });
      expect(r.status).not.toBe(7);
      expect(r.stderr).not.toContain('round');
      expect(r.stderr).toContain('tests failed');
    });

    it('does NOT refuse a range the owner accepted, a path older than the cap', () => {
      reviewable('b.ts');
      const baseSha = git('rev-parse', 'origin/main');
      const tip = git('rev-parse', 'HEAD');
      const records = path.join(dir, '.git', 'sol-reviews');
      fs.mkdirSync(path.join(records, 'rounds'), { recursive: true });
      const record = recordFor('origin/main..HEAD');
      fs.writeFileSync(record, ['## Findings', '', '- [blocking] x.', '', 'VERDICT: changes-requested', ''].join('\n'));
      fs.writeFileSync(path.join(records, 'rounds', `${baseSha}.json`), JSON.stringify({ round: ROUND_CAP, tip, record }));
      fs.writeFileSync(record.replace(/\.md$/, '.accepted'), 'Reason: the owner said so\n');
      const r = spawnSync('node', [SHIP], { cwd: dir, env: stubbedNpm(), encoding: 'utf8' });
      expect(r.status).not.toBe(7);
      expect(r.stderr).toContain('tests failed');
    });

    it('allows the cap itself', () => {
      reviewable('b.ts');
      refusedRound(ROUND_CAP - 1);
      reviewable('c.ts');
      const r = spawnSync('node', [SHIP], { cwd: dir, env: stubbedNpm(), encoding: 'utf8' });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('tests failed');
    });
  });
});
