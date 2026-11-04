import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// The app-neutral half of the UX flow capture (tooling/case_studies/): what a
// route serves, what survives a re-film, where the output goes, and what the
// writeup refuses. Nothing here opens a browser.

/* eslint-disable @typescript-eslint/no-var-requires */
const { clearFrames, createHarness, fileFor, filmstrip } = require('../case_studies/harness.js');
const { caseStudyPaths } = require('../case_studies/paths.js');
const { fillTemplate, scriptJson, validate } = require('../case_studies/build-writeup.js');
/* eslint-enable @typescript-eslint/no-var-requires */

describe('case study capture', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cases-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  describe('fileFor', () => {
    beforeEach(() => {
      mkdirSync(join(dir, '(tabs)'));
      for (const f of ['index.html', 'editor.html', 'logo.png', '(tabs)/studio.html']) writeFileSync(join(dir, f), '');
    });
    const rewrites = [[/^\/(studio)$/, '/(tabs)/$1.html']];

    it('serves the file, then the route as .html, then a rewrite, then the index', () => {
      expect(fileFor(dir, rewrites, '/logo.png')).toBe(join(dir, 'logo.png'));
      expect(fileFor(dir, rewrites, '/editor')).toBe(join(dir, 'editor.html'));
      expect(fileFor(dir, rewrites, '/studio')).toBe(join(dir, '(tabs)/studio.html'));
      expect(fileFor(dir, rewrites, '/nowhere')).toBe(join(dir, 'index.html'));
      expect(fileFor(dir, rewrites, '/')).toBe(join(dir, 'index.html'));
    });

    it('reads an encoded path', () => {
      expect(fileFor(dir, rewrites, '/%28tabs%29/studio.html')).toBe(join(dir, '(tabs)/studio.html'));
    });
  });

  it('clearFrames takes the PNGs and keeps the writeup, and minds no folder', () => {
    writeFileSync(join(dir, '01-a.png'), '');
    writeFileSync(join(dir, 'writeup.json'), '{}');
    clearFrames(dir);
    expect(existsSync(join(dir, '01-a.png'))).toBe(false);
    expect(existsSync(join(dir, 'writeup.json'))).toBe(true);
    expect(() => clearFrames(join(dir, 'absent'))).not.toThrow();
  });

  it('filmstrip numbers frames across browsers', async () => {
    const frames: Array<[string, number, string]> = [];
    const browser = (who: string) => {
      let at = 0;
      return { frameAt(k: number) { at = k; }, async snap(name: string) { frames.push([who, at, name]); } };
    };
    const film = filmstrip();
    const a = film(browser('a'));
    const b = film(browser('b'));
    await a('first');
    await b('second');
    await a('third');
    expect(frames).toEqual([['a', 1, 'first'], ['b', 2, 'second'], ['a', 3, 'third']]);
  });

  it('createHarness opens nothing until asked, so a project can load it without playwright', () => {
    const h = createHarness({ web: dir });
    expect(typeof h.open).toBe('function');
    expect(typeof h.filmstrip).toBe('function');
    expect(typeof h.clearFrames).toBe('function');
    expect(h.ORIGIN).toMatch(/^http:\/\/localhost:/);
  });

  describe('caseStudyPaths', () => {
    it('reads the folder from the config, under the project name', () => {
      writeFileSync(join(dir, 'underway.config.json'), JSON.stringify({ name: 'fern', caseStudies: '../Out/fern' }));
      const p = caseStudyPaths(dir, { TMPDIR: '/scratch' });
      expect(p.caseStudies).toBe(resolve(dir, '../Out/fern'));
      expect(p.flowDir('walk', 'crops')).toBe(join(resolve(dir, '../Out/fern'), 'flows', 'walk', 'crops'));
      expect(p.captureDir).toBe(join('/scratch', 'fern-capture'));
    });

    it('lets CASE_STUDIES_DIR override it for one run', () => {
      const p = caseStudyPaths(dir, { CASE_STUDIES_DIR: join(dir, 'here'), TMPDIR: '/scratch' });
      expect(p.flowDir('walk')).toBe(join(dir, 'here', 'flows', 'walk'));
    });
  });

  describe('the writeup', () => {
    const spec = () => ({
      flow: 'walk',
      title: 'Walk </script> Flow',
      lede: 'x',
      people: { sam: 'Sam' },
      phases: [['One', 1, 1], ['Two', 2, 2]],
      steps: [['sam', 'a', 'b'], ['', 'c', 'd']],
      findings: [{ tag: 'bug', title: 't' }],
      setup: ['s'],
    });

    it('accepts a spec that fits its frames', () => {
      expect(() => validate(spec(), 2)).not.toThrow();
    });

    it.each([
      ['a step short of the frames', (s: any) => { s.steps.pop(); }, /1 steps for 2 frames/],
      ['a gap between phases', (s: any) => { s.phases[1] = ['Two', 3, 3]; }, /expected it to start at 2/],
      ['phases that stop early', (s: any) => { s.phases.pop(); }, /phases end at 1/],
      ['a person not listed', (s: any) => { s.steps[1][0] = 'maya'; }, /who isn't in people/],
      ['an unknown tag', (s: any) => { s.findings[0].tag = 'nit'; }, /has tag "nit"/],
      ['a missing field', (s: any) => { delete s.lede; }, /no "lede"/],
    ])('refuses %s', (_name, spoil, message) => {
      const s = spec();
      spoil(s);
      expect(() => validate(s, 2)).toThrow(message);
    });

    it('keeps text from ending the script it is embedded in', () => {
      expect(scriptJson('</script>\u2028')).toBe('"<\\/script>\\u2028"');
    });

    it('fills the shipped template into a page the artifact server accepts, naming the given folder', () => {
      const template = readFileSync(join(__dirname, '../case_studies/writeup.template.html'), 'utf8');
      const html = fillTemplate(template, spec(), '../Out/flows/walk/', ['data:image/jpeg;base64,AA']);
      expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
      expect(html).toContain('<title>Walk &lt;/script> Flow</title>');
      expect(html).toContain('"framesDir":"../Out/flows/walk/"');
      expect(html).toContain('["data:image/jpeg;base64,AA"]');
      expect(html).not.toMatch(/__(TITLE|DATA|FRAMES)__/);
      expect(html).not.toContain('Portfolio');
    });
  });
});
