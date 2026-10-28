// The review gate's decisions (tooling/review.js, tooling/gates.md): which
// commits a reviewer must see, which reviewer answers count, and which
// commits a push carries. The agent run itself is not tested here; these are
// the parts that decide whether a push is refused.

/* eslint-disable @typescript-eslint/no-var-requires */
const {
  needsReview, parseNumstat, parseReview, lastField, prePushRanges, pushRevLists, agentPush, LINE_THRESHOLD,
  collapseRemovals, classifyCopies, parseLsTree, spliceAddendum, PROJECT_RULES,
} = require('../review.js');
const { loadConfig } = require('../config.js');
/* eslint-enable @typescript-eslint/no-var-requires */

const file = (path: string, added = 1, deleted = 0) => ({ path, added, deleted });

// The shared list plus one project's own, as a project's config resolves it.
const SHARED: RegExp[] = loadConfig(require('node:os').tmpdir()).alwaysReview;
const SOL: RegExp[] = [...SHARED, /^web\/sol\/kernel\//, /^docs\/sol_architecture\.md$/];

describe('needsReview', () => {
  it('always reviews the shared list — persistence, the wire schema, the shell and session, the pointer — however small', () => {
    for (const p of [
      'web/store/entryStore.ts',
      'backend/src/validation.ts',
      'web/editor/EditorShell.tsx',
      'web/editor/editorSession.ts',
      'vendor/UnderwayEngine',
    ]) {
      expect(needsReview([file(p)], SHARED).needed).toBe(true);
    }
  });

  it('always reviews the rules and the gate itself', () => {
    for (const p of ['CLAUDE.md', '.claude/skills/ship/SKILL.md', 'docs/review/project-rules.md', 'underway.config.json', '.githooks/pre-push', '.github/workflows/checks.yml']) {
      expect(needsReview([file(p)], SHARED).needed).toBe(true);
    }
  });

  it('always reviews what the project adds, and not what it does not', () => {
    expect(needsReview([file('web/sol/kernel/cycle.ts')], SHARED).needed).toBe(false);
    expect(needsReview([file('web/sol/kernel/cycle.ts')], SOL).needed).toBe(true);
    expect(needsReview([file('docs/sol_architecture.md')], SOL)).toEqual({ needed: true, reason: 'touches docs/sol_architecture.md' });
  });

  it('does not let a test alone trigger the always-review paths', () => {
    expect(needsReview([file('web/sol/kernel/__tests__/cycle.test.ts', 200)], SOL).needed).toBe(false);
    expect(needsReview([file('web/store/__tests__/entryStore.test.ts', 200)], SHARED).needed).toBe(false);
  });

  it('reviews other code at the line threshold, counting added and deleted', () => {
    expect(needsReview([file('components/a.ts', LINE_THRESHOLD - 1)], SHARED).needed).toBe(false);
    expect(needsReview([file('components/a.ts', LINE_THRESHOLD - 5, 5)], SHARED).needed).toBe(true);
  });

  it('does not count docs, tests or lockfiles toward the threshold', () => {
    expect(
      needsReview([
        file('docs/brief.md', 500),
        file('components/__tests__/a.test.ts', 500),
        file('backend/package-lock.json', 500),
        file('components/a.ts', 5),
      ], SHARED).needed,
    ).toBe(false);
  });
});

describe('parseNumstat', () => {
  it('reads binaries as zero lines', () => {
    expect(parseNumstat('3\t1\ta.ts\n-\t-\timg.png\n')).toEqual([file('a.ts', 3, 1), file('img.png', 0, 0)]);
  });
});

describe('spliceAddendum (the project’s checks in the shared brief)', () => {
  const brief = `# Brief for <project>\n\n1. Correctness.\n\n${PROJECT_RULES}\n\n## What is blocking\n`;

  it('places the project’s rules under the heading and names the project', () => {
    expect(spliceAddendum(brief, '2a. The kernel is pure.\n', 'sol')).toBe(
      `# Brief for sol\n\n1. Correctness.\n\n${PROJECT_RULES}\n\n2a. The kernel is pure.\n\n## What is blocking\n`,
    );
  });

  it('says when a project adds no checks of its own', () => {
    expect(spliceAddendum(brief, null, 'sol')).toContain(`${PROJECT_RULES}\n\nThis project adds no checks of its own.\n\n## What is blocking`);
  });

  it('appends the heading when a brief has lost it', () => {
    expect(spliceAddendum('# Brief\n', 'rule', 'x')).toBe(`# Brief\n\n${PROJECT_RULES}\n\nrule\n`);
  });
});

describe('collapseRemovals (a copy diffed against its source)', () => {
  const lines = (...l: string[]) => l.join('\n');

  it('reduces a run of more than three removed lines to a count, and keeps shorter runs and every addition', () => {
    const diff = lines('@@ -1,6 +1,2 @@', ' keep', '-a', '-b', '-c', '-d', '+new', '@@ -9,2 +5,2 @@', '-x', '-y', '+z');
    expect(collapseRemovals(diff)).toBe(lines('@@ -1,6 +1,2 @@', ' keep', '-… (4 lines removed)', '+new', '@@ -9,2 +5,2 @@', '-x', '-y', '+z'));
  });

  it('keeps the file header, and counts a removed line that reads like one', () => {
    const diff = lines('diff --git a/f b/f', '--- a/f', '+++ b/f', '@@ -1,4 +0,0 @@', '--- not a header', '-1', '-2', '-3');
    expect(collapseRemovals(diff)).toBe(lines('diff --git a/f b/f', '--- a/f', '+++ b/f', '@@ -1,4 +0,0 @@', '-… (4 lines removed)'));
  });
});

describe('classifyCopies', () => {
  const src = (name: string, blobs: Record<string, string>) => ({ name, blobs: new Map(Object.entries(blobs)) });

  it('lists a byte-identical copy as unchanged, diffs a changed one against the first source with the path, and leaves a new file alone', () => {
    const a = src('A', { 'same.ts': '1', 'edited.ts': '2' });
    const b = src('B', { 'edited.ts': '3', 'later.ts': '4' });
    const tip = new Map([['same.ts', '1'], ['edited.ts', '9'], ['later.ts', '4'], ['new.ts', '5']]);
    const { unchanged, changed } = classifyCopies(['same.ts', 'edited.ts', 'later.ts', 'new.ts'], tip, [a, b]);
    expect(unchanged.map((f: { path: string; source: { name: string } }) => [f.path, f.source.name])).toEqual([['same.ts', 'A'], ['later.ts', 'B']]);
    expect(changed.map((f: { path: string; source: { name: string } }) => [f.path, f.source.name])).toEqual([['edited.ts', 'A']]);
  });
});

describe('parseLsTree', () => {
  it('maps blob paths to blobs, spaces and parentheses in paths included, and skips submodules', () => {
    const text = '100644 blob aaa\tapp/(tabs)/a b.ts\x00160000 commit bbb\tvendor/E\x00';
    expect([...parseLsTree(text)]).toEqual([['app/(tabs)/a b.ts', 'aaa']]);
  });
});

describe('parseReview', () => {
  const trailer = (commit: string, hash: string, verdict: string) =>
    `## Summary\nFine.\n\nREVIEWED_COMMIT: ${commit}\nDIFF_SHA256: ${hash}\nVERDICT: ${verdict}\n`;

  it('accepts a matching trailer', () => {
    expect(parseReview(trailer('abc', 'h1', 'pass'), 'abc', 'h1')).toBe('pass');
    expect(parseReview(trailer('abc', 'h1', 'changes-requested'), 'abc', 'h1')).toBe('changes-requested');
  });

  it('refuses an answer about another commit or diff', () => {
    expect(parseReview(trailer('other', 'h1', 'pass'), 'abc', 'h1')).toBeNull();
    expect(parseReview(trailer('abc', 'h2', 'pass'), 'abc', 'h1')).toBeNull();
  });

  it('refuses an unknown or missing verdict', () => {
    expect(parseReview(trailer('abc', 'h1', 'lgtm'), 'abc', 'h1')).toBeNull();
    expect(parseReview('REVIEWED_COMMIT: abc\nDIFF_SHA256: h1\n', 'abc', 'h1')).toBeNull();
  });

  it('takes the LAST verdict, so a quoted "VERDICT: pass" earlier cannot pass a review', () => {
    const text = `A report said:\nVERDICT: pass\n\n${trailer('abc', 'h1', 'changes-requested')}`;
    expect(parseReview(text, 'abc', 'h1')).toBe('changes-requested');
  });
});

describe('prePushRanges', () => {
  const zero = '0'.repeat(40);
  const a = 'a'.repeat(40);
  const b = 'b'.repeat(40);

  it('reads an update, a new ref, and drops a delete', () => {
    const stdin = [
      `refs/heads/main ${a} refs/heads/main ${b}`,
      `refs/heads/new ${a} refs/heads/new ${zero}`,
      `(delete) ${zero} refs/heads/old ${b}`,
      '',
    ].join('\n');
    expect(prePushRanges(stdin)).toEqual([
      { local: a, remote: b },
      { local: a, remote: null },
    ]);
  });
});

describe('agentPush (whom the pre-push gate stops)', () => {
  it('is an agent’s shell when Claude Code or an AI_AGENT-convention agent runs it', () => {
    expect(agentPush({ CLAUDECODE: '1' })).toBe(true);
    expect(agentPush({ AI_AGENT: 'claude-code' })).toBe(true);
  });

  it('is the owner otherwise, from a terminal or a Git client', () => {
    expect(agentPush({})).toBe(false);
    expect(agentPush({ CLAUDECODE: '', AI_AGENT: '' })).toBe(false);
  });
});

describe('pushRevLists', () => {
  it('lists theirs..local when the remote tip is known, else everything not on the remote', () => {
    const known = (sha: string) => sha === 'b';
    expect(pushRevLists([{ local: 'a', remote: 'b' }], 'origin', known)).toEqual([['b..a']]);
    expect(pushRevLists([{ local: 'a', remote: 'c' }], 'origin', known)).toEqual([['a', '--not', '--remotes=origin']]);
    expect(pushRevLists([{ local: 'a', remote: null }], 'origin', known)).toEqual([['a', '--not', '--remotes=origin']]);
  });
});

describe('lastField (how a saved review clears a commit)', () => {
  it('reads the last verdict line only', () => {
    expect(lastField('VERDICT: pass\nVERDICT: changes-requested\n', 'VERDICT')).toBe('changes-requested');
    expect(lastField('VERDICT: changes-requested\nVERDICT: pass\n', 'VERDICT')).toBe('pass');
    expect(lastField('**VERDICT:** pass\n', 'VERDICT')).toBeNull();
  });
});

// The gate's range decisions, run for real against a throwaway repository
// with a local bare `origin` and its own underway.config.json (a project
// called sol whose kernel is always reviewed): `check` (what the pre-push
// hook asks) clears a range reviewed as a whole, or one whose commits were
// each cleared, and nothing else. No reviewer is started here.
describe('review.js check in a scratch repository', () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { execFileSync, spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  /* eslint-enable @typescript-eslint/no-var-requires */
  const REVIEW = path.join(__dirname, '..', 'review.js');
  const ENV = {
    ...process.env,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  };
  let base: string;
  let dir: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, env: ENV, encoding: 'utf8' }).trim();
  const check = () => spawnSync('node', [REVIEW, 'check'], { cwd: dir, env: ENV, encoding: 'utf8' }).status;
  const recordFor = (spec: string) => execFileSync('node', ['-e',
    `process.stdout.write(require(${JSON.stringify(REVIEW)}).recordPath(${JSON.stringify(spec)}))`,
  ], { cwd: dir, env: ENV, encoding: 'utf8' });
  const pass = (spec: string) => {
    const file = recordFor(spec);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'VERDICT: pass\n');
  };
  const config = (extra: Record<string, unknown> = {}) => {
    fs.writeFileSync(path.join(dir, 'underway.config.json'), JSON.stringify({ name: 'sol', alwaysReview: ['^web/sol/kernel/'], ...extra }));
  };
  // web/sol/kernel/ is always reviewed, however small (the scratch config).
  const commit = (name: string) => {
    fs.mkdirSync(path.join(dir, 'web', 'sol', 'kernel'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'web', 'sol', 'kernel', name), name);
    git('add', '.');
    git('commit', '-q', '-m', `write ${name}`);
    return git('rev-parse', 'HEAD');
  };

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'review-'));
    const origin = path.join(base, 'origin.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { env: ENV });
    dir = path.join(base, 'work');
    execFileSync('git', ['clone', '-q', origin, dir], { env: ENV });
    git('checkout', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'README'), 'r');
    config();
    git('add', '.');
    git('commit', '-q', '-m', 'root');
    git('push', '-q', 'origin', 'main');
  });

  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

  it('keeps its records in the directory the config names', () => {
    commit('a.ts');
    expect(recordFor('origin/main..HEAD').split(path.sep).join('/')).toContain('/.git/sol-reviews/');
  });

  // The hook's own question: an agent's push is refused without a review,
  // the owner's push by hand never is.
  it('refuses an unreviewed pre-push from an agent and lets the owner push', () => {
    const sha = commit('a.ts');
    const prePush = (env: NodeJS.ProcessEnv) => spawnSync('node', [REVIEW, 'check', '--pre-push', 'origin'], {
      cwd: dir, env, encoding: 'utf8', input: `refs/heads/main ${sha} refs/heads/main ${git('rev-parse', 'origin/main')}\n`,
    }).status;
    const owner: NodeJS.ProcessEnv = { ...ENV };
    delete owner.CLAUDECODE;
    delete owner.AI_AGENT;
    expect(prePush({ ...owner, CLAUDECODE: '1' })).toBe(1);
    expect(prePush(owner)).toBe(0);
    pass('origin/main..HEAD');
    expect(prePush({ ...owner, CLAUDECODE: '1' })).toBe(0);
  });

  // The AGENT override (review.js `override`): a recorded disagreement with
  // a review that REFUSED, which is not the owner's `accept` and must never
  // become a way past a review that never ran.
  describe('override', () => {
    const refuseText = (findings: string) =>
      ['## Findings', '', findings, '', 'VERDICT: changes-requested', ''].join('\n');
    const refuse = (spec: string, findings = '- [blocking] the gate pin asserts nothing.') => {
      const file = recordFor(spec);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, refuseText(findings));
      return file;
    };
    const override = (spec: string, ...reason: string[]) =>
      spawnSync('node', [REVIEW, 'override', spec, ...reason], { cwd: dir, env: ENV, encoding: 'utf8' });

    it('clears a refused range, and the push gate then lets it through', () => {
      commit('a.ts');
      expect(check()).toBe(1);
      refuse('origin/main..HEAD');
      expect(check()).toBe(1);
      const r = override('origin/main..HEAD', 'the', 'finding', 'names', 'the', 'wrong', 'file');
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('OVERRIDDEN by agent');
      expect(check()).toBe(0);
    });

    it('records the reason and every blocking finding it overrode', () => {
      commit('a.ts');
      refuse('origin/main..HEAD', ['- [blocking] first thing.', '- [blocking] second thing.'].join('\n'));
      override('origin/main..HEAD', 'both', 'findings', 'are', 'wrong');
      const file = recordFor('origin/main..HEAD').replace(/\.md$/, '.overridden');
      const text = fs.readFileSync(file, 'utf8');
      expect(text).toContain('By: agent');
      expect(text).toContain('Reason: both findings are wrong');
      expect(text).toContain('- first thing.');
      expect(text).toContain('- second thing.');
    });

    it('REFUSES a range no reviewer ever looked at — an override is not an accept', () => {
      commit('a.ts');
      const r = override('origin/main..HEAD', 'I', 'judge', 'it', 'fine');
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('not a way past one that did not');
      expect(check()).toBe(1);
    });

    it('refuses a range whose review PASSED, and one with no blocking finding', () => {
      commit('a.ts');
      pass('origin/main..HEAD');
      expect(override('origin/main..HEAD', 'no', 'need').stderr).toContain('nothing to override');
      const file = recordFor('origin/main..HEAD');
      fs.writeFileSync(file, refuseText('- [suggestion] a nicety.'));
      expect(override('origin/main..HEAD', 'the', 'suggestion', 'is', 'wrong').stderr)
        .toContain('no blocking finding');
    });

    it('covers the range it was written for and no other: a commit on top needs its own', () => {
      commit('a.ts');
      refuse('origin/main..HEAD');
      override('origin/main..HEAD', 'wrong', 'finding');
      expect(check()).toBe(0);
      commit('b.ts');
      expect(check()).toBe(1);
    });

    it('is reported under its own name, never as an owner accept', () => {
      commit('a.ts');
      refuse('origin/main..HEAD');
      override('origin/main..HEAD', 'wrong', 'finding');
      const r = spawnSync('node', [REVIEW, 'check', 'origin/main..HEAD'], { cwd: dir, env: ENV, encoding: 'utf8' });
      expect(r.status).toBe(0);
      const state = execFileSync('node', ['-e',
        `const r=require(${JSON.stringify(REVIEW)});const o=r.overrideRecord('origin/main..HEAD');process.stdout.write(o?o.findings.length+' '+/By: agent/.test(o.text):'none')`,
      ], { cwd: dir, env: ENV, encoding: 'utf8' });
      expect(state).toBe('1 true');
    });
  });

  it('clears an unpushed range by one review of its combined diff', () => {
    commit('a.ts');
    commit('b.ts');
    expect(check()).toBe(1);
    pass('origin/main..HEAD');
    expect(check()).toBe(0);
    commit('c.ts');                               // a fix on top: the range is new
    expect(check()).toBe(1);
  });

  it('keys a one-commit range as the commit itself, so per-commit records still count', () => {
    const a = commit('a.ts');
    expect(recordFor('origin/main..HEAD')).toBe(recordFor(a));
  });

  it('clears a range whose commits were each reviewed, and not one with a commit missing', () => {
    const a = commit('a.ts');
    const b = commit('b.ts');
    pass(a);
    expect(check()).toBe(1);
    pass(b);
    expect(check()).toBe(0);
  });

  it('does not ask for a review of a range that needs none', () => {
    fs.writeFileSync(path.join(dir, 'notes.md'), 'n');
    git('add', 'notes.md');
    git('commit', '-q', '-m', 'notes');
    expect(check()).toBe(0);
  });

  it('reviews the config itself, and what it adds, however small', () => {
    config({ alwaysReview: [] });
    git('add', '.');
    git('commit', '-q', '-m', 'loosen');
    expect(check()).toBe(1);                      // underway.config.json is on the shared list
  });

  // Under the line threshold, outside the always-review paths.
  const small = (name: string, lines: number) => {
    fs.writeFileSync(path.join(dir, name), Array.from({ length: lines }, (_, i) => `${i}`).join('\n'));
    git('add', name);
    git('commit', '-q', '-m', `write ${name}`);
    return git('rev-parse', 'HEAD');
  };

  it('judges the commits not cleared on their own together: small commits that add up need a review', () => {
    for (const n of ['a', 'b', 'c']) small(`${n}.js`, 20);
    expect(check()).toBe(1);                      // 60 lines, though each is 20
    pass('origin/main..HEAD');
    expect(check()).toBe(0);
  });

  it('lets one commit cleared on its own carry small ones beside it, while they stay under the threshold', () => {
    const big = commit('a.ts');
    pass(big);
    small('b.js', 10);
    expect(check()).toBe(0);
    small('c.js', 25);                            // 35 lines not cleared by a record
    expect(check()).toBe(1);
  });

  const pending = (...args: string[]) =>
    spawnSync('node', [REVIEW, 'pending', ...args], { cwd: dir, env: ENV, encoding: 'utf8' });
  const refuse = (spec: string) => {
    const file = recordFor(spec);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '## Findings\n- [blocking] the earlier finding\nVERDICT: changes-requested\n');
    return file;
  };
  const writeRound = (round: number, tip: string, record: string) => {
    const file = path.join(dir, '.git', 'sol-reviews', 'rounds', `${git('rev-parse', 'origin/main')}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ round, tip, record }));
  };

  it('re-prints a review already refused for this exact diff instead of starting another', () => {
    commit('a.ts');
    refuse('origin/main..HEAD');
    const r = pending();
    expect([r.status, r.stdout]).toEqual([1, expect.stringContaining('the earlier finding')]);
    expect(r.stdout).toContain('already, for this exact diff');
  });

  it('briefs the next round with the earlier review when fixes went on top of the refused tip', () => {
    const a = commit('a.ts');
    writeRound(1, a, refuse('origin/main..HEAD'));
    small('fix.js', 1);
    const r = pending('--dry-run');
    expect([r.status, r.stdout]).toEqual([0, expect.stringContaining('round 2')]);
    expect(r.stdout).toContain('briefed with the earlier review');
    expect(r.stdout).toContain('write fix.js');
  });

  it('does not brief from a tip that was rewritten away, and starts again at round 1 after a pass', () => {
    const a = commit('a.ts');
    writeRound(1, a, refuse('origin/main..HEAD'));
    fs.writeFileSync(path.join(dir, 'web', 'sol', 'kernel', 'a.ts'), 'rewritten');
    git('commit', '-q', '-a', '--amend', '-m', 'rewritten');
    let r = pending('--dry-run');
    expect(r.stdout).toContain('round 2');        // still counted: the last review refused
    expect(r.stdout).not.toContain('briefed');
    const file = recordFor('origin/main..HEAD');
    fs.writeFileSync(file, 'VERDICT: pass\n');
    writeRound(2, git('rev-parse', 'HEAD'), file);
    commit('b.ts');
    r = pending('--dry-run');
    expect(r.stdout).toContain('round 1');
    expect(r.stdout).not.toContain('briefed');
  });

  it('briefs the reviewer with the shared brief, the project named, and the project’s rules from origin/main', () => {
    config({ reviewerAddendum: 'docs/review/project-rules.md' });
    fs.mkdirSync(path.join(dir, 'docs', 'review'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'review', 'project-rules.md'), '2a. The kernel is pure.\n');
    git('add', '.');
    git('commit', '-q', '-m', 'rules');
    git('push', '-q', 'origin', 'main');
    // A later, unpushed edit to the rules does not reach the reviewer.
    fs.writeFileSync(path.join(dir, 'docs', 'review', 'project-rules.md'), '2a. Anything goes.\n');
    commit('a.ts');
    const out: string = pending('--prompt').stdout;
    expect(out).toContain('one change to sol:');
    const rules = out.slice(out.indexOf('## Project rules'), out.indexOf('## What is blocking'));
    expect(rules).toBe('## Project rules\n\n2a. The kernel is pure.\n\n');
    expect(rules).not.toContain('Anything goes');   // the unpushed edit is in the diff, not the brief
    expect(out).toContain('## Output format');
  });

  it('shows a copy from a source checkout as listed or diffed against the source, and the rest as before', () => {
    const src = path.join(base, 'source');
    execFileSync('git', ['init', '-q', '-b', 'main', src], { env: ENV });
    fs.mkdirSync(path.join(src, 'web'));
    fs.writeFileSync(path.join(src, 'web', 'same.ts'), 'export const same = 1;\n');
    fs.writeFileSync(path.join(src, 'web', 'cut.ts'), ['keep', 'gone1', 'gone2', 'gone3', 'gone4', 'gone5', 'tail', ''].join('\n'));
    execFileSync('git', ['add', '.'], { cwd: src, env: ENV });
    execFileSync('git', ['commit', '-q', '-m', 'source'], { cwd: src, env: ENV });
    const srcCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: src, env: ENV, encoding: 'utf8' }).trim();

    config({ copySources: 'scripts/copySources.json' });
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.writeFileSync(path.join(dir, 'scripts', 'copySources.json'), JSON.stringify([{ name: 'Src', repo: '../source', commit: srcCommit }]));
    git('add', '.');
    git('commit', '-q', '-m', 'setup');
    git('push', '-q', 'origin', 'main');

    fs.mkdirSync(path.join(dir, 'web'), { recursive: true });
    fs.copyFileSync(path.join(src, 'web', 'same.ts'), path.join(dir, 'web', 'same.ts'));
    fs.writeFileSync(path.join(dir, 'web', 'cut.ts'), ['keep', 'added here', 'tail', ''].join('\n'));
    commit('fresh.ts');
    const prompt = pending('--prompt');
    expect(prompt.status).toBe(0);
    const out: string = prompt.stdout;
    const section = (title: string) => out.split(`### ${title}`)[1].split('\n### ')[0];
    expect(section('Copied unchanged (path, source)')).toContain(`web/same.ts\tSrc@${srcCommit.slice(0, 8)}`);
    const changed = section('Copied and changed: diff against the source');
    expect(changed).toContain(`--- Src@${srcCommit.slice(0, 8)}:web/cut.ts`);
    expect(changed).toContain('-… (5 lines removed)');
    expect(changed).toContain('+added here');
    const rest = section('Diff of everything else');
    expect(rest).toContain('web/sol/kernel/fresh.ts');
    expect(rest).not.toContain('web/same.ts');
    expect(rest).not.toContain('web/cut.ts');

    fs.rmSync(src, { recursive: true, force: true });  // not checked out here: diffed in full, and said so
    const full: string = pending('--prompt').stdout;
    expect(full).toContain('Src (../source at');
    expect(full).not.toContain('### Copied');
    expect(full).toContain('+export const same = 1;');
  });
});

describe('classifyMoves (a file the project deletes that the engine adds)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { classifyMoves } = require('../review.js');

  it('pairs by content first, then by name and the longest shared path tail, each file once', () => {
    const deleted = new Map([
      ['web/editor/same.ts', 'b1'],
      ['web/editor/components/X.tsx', 'b2'],
      ['web/other/X.tsx', 'b3'],
      ['web/editor/gone.ts', 'b4'],
    ]);
    const added = new Map([
      ['packages/editor/src/same.ts', 'b1'],
      ['packages/editor/src/components/X.tsx', 'b9'],
      ['packages/editor/src/fresh.ts', 'b8'],
    ]);
    const { unchanged, changed } = classifyMoves(deleted, added);
    expect(unchanged).toEqual([{ from: 'web/editor/same.ts', to: 'packages/editor/src/same.ts' }]);
    // X.tsx: the components/ tail wins over the stray X.tsx elsewhere.
    expect(changed).toEqual([{ from: 'web/editor/components/X.tsx', to: 'packages/editor/src/components/X.tsx' }]);
    // fresh.ts has no partner; gone.ts was deleted for good.
  });

  it('is content first even when the names differ', () => {
    const { unchanged, changed } = classifyMoves(
      new Map([['web/content/planarFaces.ts', 'b1']]),
      new Map([['packages/editor/src/planarFaces.ts', 'b1'], ['packages/editor/src/other.ts', 'b2']]),
    );
    expect(unchanged).toEqual([{ from: 'web/content/planarFaces.ts', to: 'packages/editor/src/planarFaces.ts' }]);
    expect(changed).toEqual([]);
  });
});

describe('review.js pending --prompt folds a move into the engine', () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { execFileSync, spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  /* eslint-enable @typescript-eslint/no-var-requires */
  const REVIEW = path.join(__dirname, '..', 'review.js');
  const ENV = {
    ...process.env,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  };
  let base: string;
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

  it('lists an identical moved file, diffs a changed one from the deleted file, and leaves the engine lockfile out', () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'review-move-'));
    const run = (cwd: string, ...args: string[]) =>
      execFileSync('git', ['-c', 'protocol.file.allow=always', ...args], { cwd, env: ENV, encoding: 'utf8' }).trim();
    // The engine: a repo with a lockfile and nothing of the editor yet.
    const engine = path.join(base, 'engine');
    fs.mkdirSync(engine);
    run(engine, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(engine, 'package-lock.json'), '{"v":1}\n');
    fs.writeFileSync(path.join(engine, 'README'), 'engine\n');
    run(engine, 'add', '.');
    run(engine, 'commit', '-q', '-m', 'engine root');
    const e0 = run(engine, 'rev-parse', 'HEAD');
    // The project: two editor files, the engine vendored at e0.
    const origin = path.join(base, 'origin.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { env: ENV });
    const dir = path.join(base, 'work');
    execFileSync('git', ['clone', '-q', origin, dir], { env: ENV });
    run(dir, 'checkout', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'underway.config.json'), JSON.stringify({ name: 'sol' }));
    fs.mkdirSync(path.join(dir, 'web', 'editor'), { recursive: true });
    const same = 'export const same = 1;\n';
    const cut = ['keep', 'gone1', 'gone2', 'gone3', 'gone4', 'gone5', 'tail', ''].join('\n');
    fs.writeFileSync(path.join(dir, 'web', 'editor', 'same.ts'), same);
    fs.writeFileSync(path.join(dir, 'web', 'editor', 'cut.ts'), cut);
    const trim = ['pure1', 'pure2', 'pure3', 'pure4', 'pure5', 'shell pin', ''].join('\n');
    fs.writeFileSync(path.join(dir, 'web', 'editor', 'trim.test.ts'), trim);
    run(dir, 'submodule', 'add', '-q', engine, 'vendor/UnderwayEngine');
    run(dir, 'add', '.');
    run(dir, 'commit', '-q', '-m', 'root');
    run(dir, 'push', '-q', 'origin', 'main');
    // The engine takes the two files (one cut down), adds one of its own, and bumps its lockfile.
    fs.mkdirSync(path.join(engine, 'packages', 'editor', 'src'), { recursive: true });
    fs.writeFileSync(path.join(engine, 'packages', 'editor', 'src', 'same.ts'), same);
    fs.writeFileSync(path.join(engine, 'packages', 'editor', 'src', 'cut.ts'), ['keep', 'added there', 'tail', ''].join('\n'));
    fs.writeFileSync(path.join(engine, 'packages', 'editor', 'src', 'fresh.ts'), 'export const fresh = 2;\n');
    fs.writeFileSync(path.join(engine, 'packages', 'editor', 'src', 'trim.test.ts'), trim);
    fs.writeFileSync(path.join(engine, 'package-lock.json'), '{"v":2,"lock":"LOCKFILE-NOISE"}\n');
    run(engine, 'add', '.');
    run(engine, 'commit', '-q', '-m', 'engine takes the editor');
    const e1 = run(engine, 'rev-parse', 'HEAD');
    // The project deletes its copies and takes the pointer.
    const sub = path.join(dir, 'vendor', 'UnderwayEngine');
    run(sub, 'fetch', '-q', 'origin');
    run(sub, 'checkout', '-q', e1);
    fs.rmSync(path.join(dir, 'web', 'editor', 'same.ts'));
    fs.rmSync(path.join(dir, 'web', 'editor', 'cut.ts'));
    fs.writeFileSync(path.join(dir, 'web', 'editor', 'trim.test.ts'), 'shell pin\n');   // kept: its own pins stay
    fs.writeFileSync(path.join(dir, 'web', 'editor', 'own.ts'), "import { same } from '@/editor/same';\n");
    run(dir, 'add', '-A', 'web', 'vendor/UnderwayEngine');
    run(dir, 'commit', '-q', '-m', 'the editor comes from the engine');

    const r = spawnSync('node', [REVIEW, 'pending', '--prompt'], { cwd: dir, env: ENV, encoding: 'utf8' });
    expect(r.status).toBe(0);
    const out: string = r.stdout;
    const section = (title: string) => out.split(`### ${title}`)[1].split('\n### ')[0];
    expect(out).toContain('3 files this range MOVES into the engine');
    expect(out).toContain('or keeps and trims, 1 of them');
    expect(section('Moved into the engine unchanged (here before this range, added there)'))
      .toContain(`web/editor/same.ts\tvendor/UnderwayEngine@${e1.slice(0, 8)}:packages/editor/src/same.ts`);
    expect(section('Moved into the engine unchanged (here before this range, added there)'))
      .toContain(`web/editor/trim.test.ts\tvendor/UnderwayEngine@${e1.slice(0, 8)}:packages/editor/src/trim.test.ts\t(kept here, trimmed: its own diff is below)`);
    const changed = section("Moved into the engine and changed: diff from the file here before this range to the engine's");
    expect(changed).toContain('--- web/editor/cut.ts');
    expect(changed).toContain(`+++ vendor/UnderwayEngine@${e1.slice(0, 8)}:packages/editor/src/cut.ts`);
    expect(changed).toContain('-… (5 lines removed)');
    expect(changed).toContain('+added there');
    const rest = section('Diff of everything else');
    expect(rest).toContain('web/editor/own.ts');
    expect(rest).toContain(`# ---- vendor/UnderwayEngine ${e0}..${e1} ----`);
    expect(rest).toContain('packages/editor/src/fresh.ts');   // the engine's genuinely new file is still shown
    expect(rest).not.toContain('export const same = 1;');     // neither half repeats the move
    expect(rest).not.toContain('gone1');
    expect(rest).not.toContain('LOCKFILE-NOISE');             // the engine's lockfile is left out too
    // The kept file's own trim stays, its removed run collapsed; the engine's copy of it is not repeated.
    expect(rest).toContain('web/editor/trim.test.ts');
    expect(rest).toContain('-… (5 lines removed)');
    expect(rest).not.toContain('-pure1');
    expect(rest).not.toContain('+pure1');
    // The record is keyed by the FULL diff, folding or not.
    const recordFor = execFileSync('node', ['-e',
      `process.stdout.write(require(${JSON.stringify(REVIEW)}).recordPath('origin/main..HEAD'))`,
    ], { cwd: dir, env: ENV, encoding: 'utf8' });
    expect(recordFor).toMatch(/[0-9a-f]{64}\.md$/);
  });
});
