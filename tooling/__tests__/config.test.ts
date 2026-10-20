import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The per-project configuration of the shared shipping process
// (tooling/config.js): what a project with no file gets, what its own file
// adds, and what it may not do.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CONFIG_FILE, DEFAULT_DOC_PATHS, loadConfig, sharedAlwaysReview } = require('../config.js');

const matches = (list: RegExp[], p: string) => list.some((re) => re.test(p));

describe('loadConfig', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cfg-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('gives a repository with no file the defaults', () => {
    const cfg = loadConfig(dir);
    expect(cfg.name).toBe('project');
    expect(cfg.reviewRecords).toBe('project-reviews');
    expect(cfg.submodule).toBe('vendor/UnderwayEngine');
    expect(cfg.copySources).toBeNull();
    expect(cfg.reviewerAddendum).toBeNull();
    expect(cfg.backendSchema).toBe('backend/src/validation.ts');
    expect(cfg.docPaths).toEqual({ ...DEFAULT_DOC_PATHS, prose: [] });
  });

  it('names the record directory after the project unless told otherwise', () => {
    writeFileSync(join(dir, CONFIG_FILE), JSON.stringify({ name: 'sol' }));
    expect(loadConfig(dir).reviewRecords).toBe('sol-reviews');
    writeFileSync(join(dir, CONFIG_FILE), JSON.stringify({ name: 'sol', reviewRecords: 'reviews' }));
    expect(loadConfig(dir).reviewRecords).toBe('reviews');
  });

  it('always reviews the shared list in every project, the backend schema and submodule as configured', () => {
    const shared = loadConfig(dir).alwaysReview;
    for (const p of [
      'web/store/entryStore.ts', 'backend/src/validation.ts', 'web/editor/EditorShell.tsx', 'web/editor/editorSession.ts',
      'vendor/UnderwayEngine', 'CLAUDE.md', '.claude/skills/ship/SKILL.md', '.github/workflows/x.yml', '.githooks/pre-push',
      'docs/review/project-rules.md', CONFIG_FILE, 'jest.config.js', 'package.json',
    ]) {
      expect([p, matches(shared, p)]).toEqual([p, true]);
    }
    // A path INSIDE the submodule is the engine's own review's business.
    expect(matches(shared, 'vendor/UnderwayEngine/README.md')).toBe(false);
    expect(matches(shared, 'web/sol/kernel/cycle.ts')).toBe(false);
    const own = sharedAlwaysReview({ backendSchema: 'server/schema.ts', submodule: 'lib/engine', copySources: null, reviewerAddendum: null });
    expect(matches(own, 'server/schema.ts')).toBe(true);
    expect(matches(own, 'backend/src/validation.ts')).toBe(false);
    expect(matches(own, 'lib/engine')).toBe(true);
  });

  it('adds the project’s own always-review paths, copy-source list and reviewer addendum after the shared ones', () => {
    writeFileSync(join(dir, CONFIG_FILE), JSON.stringify({
      name: 'sol', alwaysReview: ['^web/sol/kernel/', '^docs/sol_architecture\\.md$'],
      copySources: 'scripts/copySources.json', reviewerAddendum: 'docs/review/project-rules.md',
    }));
    const { alwaysReview } = loadConfig(dir);
    for (const p of ['web/sol/kernel/cycle.ts', 'docs/sol_architecture.md', 'scripts/copySources.json', 'docs/review/project-rules.md', 'web/store/types.ts']) {
      expect([p, matches(alwaysReview, p)]).toEqual([p, true]);
    }
    expect(matches(alwaysReview, 'web/sol/lab/GeneLab.tsx')).toBe(false);
  });

  it('merges the doc-path lists: the project’s docs replace the default set, its other lists add to them', () => {
    writeFileSync(join(dir, CONFIG_FILE), JSON.stringify({
      docPaths: { docs: ['Sol.md'], generated: ['web-out'], prose: ['^sol:'], extensions: ['.m4a'] },
    }));
    const { docPaths } = loadConfig(dir);
    expect(docPaths.docs).toEqual(['Sol.md']);
    expect(docPaths.generated).toEqual([...DEFAULT_DOC_PATHS.generated, 'web-out']);
    expect(docPaths.prose.map(String)).toEqual(['/^sol:/']);
    expect(docPaths.extensions).toEqual(expect.arrayContaining(['.ts', '.m4a']));
  });

  it('refuses a file that does not parse rather than falling back to the defaults', () => {
    writeFileSync(join(dir, CONFIG_FILE), '{ not json');
    expect(() => loadConfig(dir)).toThrow();
  });
});
