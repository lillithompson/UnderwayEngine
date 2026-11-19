import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// The app-neutral half of the UX flow capture (tooling/case_studies/): what a
// route serves, what survives a re-film, where the output goes, and what the
// writeup refuses. Nothing here opens a browser.

/* eslint-disable @typescript-eslint/no-var-requires */
const { chromePath, clearFrames, createHarness, DEVICES, fileFor, filmstrip, labelled, resized, rotated, SHOWN, TAPPABLE } = require('../case_studies/harness.js');
const { compareRows, comparePage, rowLayout, MIN_CELL, MAX_FRAME_HEIGHT } = require('../case_studies/compare-pdf.js');
const { caseStudyPaths } = require('../case_studies/paths.js');
const { embedWidth, fillTemplate, pngSize, scriptJson, validate } = require('../case_studies/build-writeup.js');
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

  describe('labelled: the one check tap and until share', () => {
    // It runs in the page; here a document of plain objects stands in.
    const el = (tag: string, label: string, rect: Partial<{ width: number; height: number; top: number; bottom: number }> = {}) => ({
      tag, getAttribute: (k: string) => (k === 'aria-label' ? label : null), innerText: '',
      getBoundingClientRect: () => ({ width: 10, height: 10, top: 10, bottom: 20, ...rect }),
    });
    const page = (els: ReturnType<typeof el>[]) => {
      const g = globalThis as unknown as { document: unknown; innerHeight: number };
      g.document = { querySelectorAll: (sel: string) => els.filter((e) => sel.split(',').some((s) => (s === 'input') === (e.tag === 'input'))) };
      g.innerHeight = 800;
    };
    afterEach(() => { delete (globalThis as { document?: unknown }).document; });

    it('finds the visible elements with exactly that label, and null for none', () => {
      const a = el('button', 'Next');
      page([a, el('button', 'Next', { width: 0 }), el('button', 'Next', { top: 900, bottom: 910 }), el('button', 'Next page')]);
      expect(labelled({ wanted: 'Next', selector: TAPPABLE })).toEqual([a]);
      expect(labelled({ wanted: 'Back', selector: TAPPABLE })).toBeNull();
    });

    it('until waits for a field too; tap presses no field', () => {
      expect(SHOWN).toBe(`${TAPPABLE},input`);
      const field = el('input', 'Name it');
      page([field]);
      expect(labelled({ wanted: 'Name it', selector: SHOWN })).toEqual([field]);
      expect(labelled({ wanted: 'Name it', selector: TAPPABLE })).toBeNull();
    });
  });

  describe('the screens a flow is filmed on', () => {
    it('a phone is touched at 3×; a laptop and an ultrawide monitor are moused, at 2× and 1×', () => {
      expect(DEVICES.phone).toMatchObject({ width: 390, height: 844, scale: 3, touch: true });
      expect(DEVICES.desktop).toMatchObject({ width: 1440, height: 900, scale: 2, touch: false });
      expect(DEVICES.wide).toMatchObject({ width: 3440, height: 1440, scale: 1, touch: false });
      expect(DEVICES.desktop.ua).not.toMatch(/iPhone|Mobile/);
    });

    it('an 11-inch iPad and a 13-inch iPad Pro are touched at 2×, held upright, and say they are an iPad', () => {
      expect(DEVICES.ipad).toMatchObject({ width: 820, height: 1180, scale: 2, touch: true });
      expect(DEVICES.ipadPro).toMatchObject({ width: 1032, height: 1376, scale: 2, touch: true });
      for (const d of [DEVICES.ipad, DEVICES.ipadPro]) {
        expect(d.height).toBeGreaterThan(d.width);
        expect(d.ua).toMatch(/iPad/);
        expect(d.ua).not.toMatch(/iPhone|Macintosh/);
      }
    });

    it('turns a screen a quarter: upright to its side and back', () => {
      const upright = { width: DEVICES.ipad.width, height: DEVICES.ipad.height };
      expect(rotated(upright)).toEqual({ width: 1180, height: 820 });
      expect(rotated(rotated(upright))).toEqual(upright);
    });

    it('resizes an iPad to its turned size or the larger iPad, at its own density; never to a moused screen', () => {
      const ipad = DEVICES.ipad;
      expect(resized(ipad, { ...rotated(ipad), scale: 2 })).toEqual({ width: 1180, height: 820, shot: 'device' });
      expect(resized(ipad, 'ipadPro')).toEqual({ width: 1032, height: 1376, shot: 'device' });
      expect(() => resized(ipad, 'desktop')).toThrow(/touched screen/);
      expect(() => resized(DEVICES.phone, 'ipad')).toThrow(/3× or 1× in this browser, not 2×/);
    });

    it('resizes a window to a screen, or to a size, snapping at 1× where the screen is not as dense', () => {
      const laptop = DEVICES.desktop;
      expect(resized(laptop, 'wide')).toEqual({ width: 3440, height: 1440, shot: 'css' });
      expect(resized(laptop, { width: 1147, height: 1440, scale: 1 })).toEqual({ width: 1147, height: 1440, shot: 'css' });
      expect(resized(laptop, { width: 1200, height: 800 })).toEqual({ width: 1200, height: 800, shot: 'device' });
      expect(resized(laptop, 'desktop')).toEqual({ width: 1440, height: 900, shot: 'device' });
    });

    it('refuses a screen the browser cannot become', () => {
      expect(() => resized(DEVICES.desktop, 'phone')).toThrow(/touched screen/);
      expect(() => resized(DEVICES.phone, 'desktop')).toThrow(/touched screen/);
      expect(() => resized(DEVICES.wide, { width: 1440, height: 900, scale: 2 })).toThrow(/1× in this browser, not 2×/);
      expect(() => resized(DEVICES.desktop, 'tv')).toThrow(/no device "tv"/);
    });
  });

  it('createHarness opens nothing until asked, so a project can load it without playwright', () => {
    const h = createHarness({ web: dir });
    expect(typeof h.open).toBe('function');
    expect(typeof h.filmstrip).toBe('function');
    expect(typeof h.clearFrames).toBe('function');
    expect(h.ORIGIN).toMatch(/^http:\/\/localhost:/);
  });

  describe('the Chrome a capture drives', () => {
    const MAC = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const WIN_ENV = { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\sam\\AppData\\Local' };
    const machine = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const users = 'C:\\Users\\sam\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';

    it('is CAPTURE_CHROME wherever that is set', () => {
      expect(chromePath('win32', { ...WIN_ENV, CAPTURE_CHROME: 'D:\\chrome.exe' }, () => true)).toBe('D:\\chrome.exe');
      expect(chromePath('darwin', { CAPTURE_CHROME: '/opt/chrome' })).toBe('/opt/chrome');
    });

    it('on Windows is the first install that is there, the machine\'s before the user\'s', () => {
      expect(chromePath('win32', WIN_ENV, () => true)).toBe(machine);
      expect(chromePath('win32', WIN_ENV, (p: string) => p === users)).toBe(users);
      expect(chromePath('win32', WIN_ENV, () => false)).toBe(machine);
    });

    it('is the Mac\'s one place on a Mac, and google-chrome on Linux', () => {
      expect(chromePath('darwin', {})).toBe(MAC);
      expect(chromePath('linux', {})).toBe('/usr/bin/google-chrome');
    });

    it('opens pages and frames by file URL, never by a file:// string a Windows path breaks', () => {
      for (const f of ['build-writeup.js', 'sheet.js', 'compare-pdf.js']) {
        const src = readFileSync(join(__dirname, '../case_studies', f), 'utf8');
        expect(src).not.toContain('file://');
      }
      const writeup = readFileSync(join(__dirname, '../case_studies/build-writeup.js'), 'utf8');
      expect(writeup).not.toContain("'sips'");
      expect(writeup).toContain('await toJpegs(');
    });
  });

  describe('the side-by-side PDF', () => {
    const KEYS = ['iphone', 'ipad', 'desktop'];

    it('makes a row of each state, a cell of each device, null where a device has none', () => {
      const rows = compareRows(['01-iphone-home.png', '02-ipad-home.png', '03-desktop-home.png', '04-iphone-canvas.png', '05-desktop-canvas.png'], KEYS);
      expect(rows.map((r: any) => r.state)).toEqual(['home', 'canvas']);
      expect(rows[0].cells).toEqual({ iphone: 0, ipad: 1, desktop: 2 });
      expect(rows[1].cells).toEqual({ iphone: 3, ipad: null, desktop: 4 });
      expect(rows[1].first).toBe(3);
    });

    it('keeps each device\'s own order: a state one device has comes before what follows it there', () => {
      // The iPad's preview is filmed after the iPhone has taken the template.
      const rows = compareRows(['01-iphone-taken.png', '02-ipad-previewed.png', '03-ipad-taken.png', '04-desktop-taken.png', '05-iphone-named.png'], KEYS);
      expect(rows.map((r: any) => r.state)).toEqual(['previewed', 'taken', 'named']);
    });

    it.each([
      ['a name with no device', ['01-home.png'], /is not NN-<device>-<state>/],
      ['a device not in people', ['01-android-home.png'], /is not NN-<device>-<state>/],
      ['a state filmed twice on one device', ['01-ipad-home.png', '02-ipad-home.png'], /"home" is filmed twice on ipad/],
      ['devices that disagree on the order', ['01-iphone-a.png', '02-iphone-b.png', '03-ipad-b.png', '04-ipad-a.png'], /orders that contradict/],
    ])('refuses %s', (_name, pngs, message) => {
      expect(() => compareRows(pngs, KEYS)).toThrow(message);
    });

    it('draws a row as tall as fits the page, no cell narrower than its caption needs', () => {
      const wide = rowLayout([390 / 844, 820 / 1180, 1440 / 900]);
      expect(wide.height).toBeLessThan(MAX_FRAME_HEIGHT);
      expect(wide.widths[0]).toBe(MIN_CELL);
      expect(wide.widths.reduce((s: number, w: number) => s + w, 0)).toBeLessThanOrEqual(1280 - 72 - 48);
      expect(rowLayout([390 / 844]).height).toBe(MAX_FRAME_HEIGHT);
    });

    it('lays out a page of each state under its phase, a badge per device, and says where one has no screen', () => {
      const spec = {
        title: 'Walk', lede: 'Captured.', people: { iphone: 'iPhone', ipad: 'iPad', desktop: 'Desktop web' },
        phases: [['Open', 1, 3], ['Draw', 4, 5]],
        steps: [['iphone', 'Home', 'a'], ['ipad', 'Home', 'b'], ['desktop', 'Home', 'c'], ['iphone', 'Canvas', 'd'], ['desktop', 'Canvas', 'e']],
        findings: [{ tag: 'friction', title: 'Small.', body: 'Too small.' }],
      };
      const frames = [[1170, 2532], [1640, 2360], [2880, 1800], [1170, 2532], [2880, 1800]].map(([w, h], i) => ({ src: `data:image/jpeg;base64,F${i}`, w, h }));
      const html = comparePage(spec, compareRows(['01-iphone-home.png', '02-ipad-home.png', '03-desktop-home.png', '04-iphone-canvas.png', '05-desktop-canvas.png'], KEYS), frames);
      expect(html.match(/<section class="sheet">/g)).toHaveLength(2);
      expect(html).toContain('<h2>Open</h2><span>1 of 2</span>');
      expect(html).toContain('<h2>Draw</h2><span>2 of 2</span>');
      for (let i = 0; i < 5; i += 1) expect(html).toContain(`data:image/jpeg;base64,F${i}`);
      expect(html.match(/No separate screen here/g)).toHaveLength(1);
      expect(html).toContain('<span class="who p2">Desktop web</span>');
      expect(html).toContain('<b>Small.</b> Too small.');
      expect(html).toContain('@page { size: 1280px 720px;');
    });
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

    it('reads a frame\'s size from its PNG header, and refuses what is not one', () => {
      const png = Buffer.alloc(33);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
      png.writeUInt32BE(13, 8);
      png.write('IHDR', 12, 'latin1');
      png.writeUInt32BE(2880, 16);
      png.writeUInt32BE(1800, 20);
      expect(pngSize(png)).toEqual({ width: 2880, height: 1800 });
      expect(() => pngSize(Buffer.from('not a png at all, not at all'))).toThrow(/not a PNG/);
    });

    it('embeds a phone\'s frame a grid cell wide and a desktop\'s the page\'s width, never upscaled', () => {
      expect(embedWidth({ width: 1170, height: 2532 })).toBe(693);
      expect(embedWidth({ width: 1147, height: 1440 })).toBe(693);
      expect(embedWidth({ width: 2880, height: 1800 })).toBe(1600);
      expect(embedWidth({ width: 3440, height: 1440 })).toBe(1600);
      expect(embedWidth({ width: 600, height: 400 })).toBe(600);
    });

    it('fills the shipped template into a page the artifact server accepts, naming the given folder', () => {
      const template = readFileSync(join(__dirname, '../case_studies/writeup.template.html'), 'utf8');
      const html = fillTemplate(template, spec(), '../Out/flows/walk/', [{ src: 'data:image/jpeg;base64,AA', w: 1170, h: 2532 }]);
      expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
      expect(html).toContain('<title>Walk &lt;/script> Flow</title>');
      expect(html).toContain('"framesDir":"../Out/flows/walk/"');
      expect(html).toContain('[{"src":"data:image/jpeg;base64,AA","w":1170,"h":2532}]');
      expect(html).not.toMatch(/__(TITLE|DATA|FRAMES)__/);
      expect(html).not.toContain('Portfolio');
    });

    it('draws each frame at its own shape, and a flow with a desktop\'s frame one to a row', () => {
      const template = readFileSync(join(__dirname, '../case_studies/writeup.template.html'), 'utf8');
      expect(template).toContain('aspect-ratio: ${FRAMES[i].w} / ${FRAMES[i].h}');
      expect(template).toContain('if (FRAMES.some(f => f.w > f.h)) document.body.classList.add("wide");');
      expect(template).toMatch(/\.wide \.grid \{ grid-template-columns: minmax\(0, 1fr\);/);
      expect(template).not.toContain('390 / 844');
    });
  });
});
