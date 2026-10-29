import { readFileSync } from 'fs';
import { join } from 'path';
import { SYSTEM_STACK } from '../fontFamily';

// Loading an app's font pack onto the page. Driven over a MADE-UP pack — two
// families and a face the build cannot place — the way sessionHost.test and
// panelModel.test drive their seams, so every member of FontPack is used
// here and dropping one fails this suite's compile rather than passing
// silently. Which fonts a real app offers, and that ITS pack is the one
// installed, is pinned in that app (web/fonts/__tests__/loadPackFonts).
//
// Two things this pins.
//
// The fonts epoch is what makes center/right-aligned text re-lay-out with
// real metrics, so WHEN it bumps is the whole behaviour: a @font-face rule is
// inert until a face is used, and `document.fonts.ready` resolves with every
// face still unloaded. Bumping there measures nothing new. These tests pin
// the bump to the FontFaceSet loads actually settling.
//
// And WHO writes the rules. expo-font's web loader waits on a fontfaceobserver
// with a 12 000 ms timeout unless the user agent says iPhone, iPad or Safari;
// an iPad WKWebView says "Macintosh", so every editor open on an iPad waited
// twelve seconds for twenty observers to time out before the canvas could
// appear (measured 12.8 s to GL on the iPad 10th gen). The rules are written
// here now, and nothing on this path may go back through that loader.

type Pack = import('../loadPackFonts').FontPack;

/** A made-up pack: two placeable families and one face with no bundled file. */
function fakePack(over: Partial<Pack> = {}): Pack {
  return {
    fonts: [
      { fontId: 'dial', cssFamily: 'Dial Sans' },
      { fontId: 'peg', cssFamily: 'Peg Serif' },
      { fontId: 'unbundled', cssFamily: 'Nowhere' },
    ],
    faceUri: (id) => (id === 'unbundled' ? null : `asset://${id}.woff2`),
    fontFamilyFor: (id) => (id === 'system' || id === '' ? SYSTEM_STACK : `'${id}-face', ${SYSTEM_STACK}`),
    ...over,
  };
}

/** Fresh module registry per test — loadPackFonts memoizes its promise. */
function freshModules() {
  let mod!: typeof import('../loadPackFonts');
  let epoch!: () => number;
  let family!: (fontId: string) => string;
  jest.isolateModules(() => {
    mod = require('../loadPackFonts');
    epoch = require('../fontsEpoch').getFontsEpoch;
    family = require('../fontFamily').fontFamilyFor;
  });
  return {
    load: mod.loadPackFonts,
    packFontFaceCss: mod.packFontFaceCss,
    bundledFaces: mod.bundledFaces,
    STYLE_ID: mod.PACK_FONTS_STYLE_ID,
    epoch,
    family,
  };
}

/** Drain the microtask queue, so every already-resolvable `.then` has run. */
const flush = () => new Promise((res) => setImmediate(res));

/** A style element as the injector uses one: an id, a text child, a parent. */
interface StubStyle { id: string; text: string; appendChild: (n: { text: string }) => void }

/** Install a document with a FontFaceSet whose loads we resolve by hand, and
 *  a head that records what is appended to it. */
function stubDocument() {
  const resolvers: Array<() => void> = [];
  const listeners: Record<string, Array<() => void>> = {};
  const appended: StubStyle[] = [];
  const fonts = {
    load: () => new Promise<void>((res) => resolvers.push(res)),
    addEventListener: (type: string, fn: () => void) => {
      (listeners[type] ??= []).push(fn);
    },
  };
  const document = {
    fonts,
    head: { appendChild: (el: StubStyle) => { appended.push(el); } },
    getElementById: (id: string) => appended.find((el) => el.id === id) ?? null,
    createElement: (): StubStyle => {
      const el: StubStyle = { id: '', text: '', appendChild: (n) => { el.text += n.text; } };
      return el;
    },
    createTextNode: (text: string) => ({ text }),
  };
  (globalThis as { document?: unknown }).document = document;
  return Object.assign(resolvers, {
    appended,
    emit: (type: string) => (listeners[type] ?? []).forEach((fn) => fn()),
  });
}

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
  require('../fontFamily').registerFontFamily(null);
});

describe('the @font-face rules', () => {
  it('are one rule per face, family quoted, url quoted, display auto', () => {
    const { packFontFaceCss } = freshModules();
    expect(packFontFaceCss([
      { cssFamily: 'Dial Sans', uri: 'asset://dial.woff2' },
      { cssFamily: 'Peg Serif', uri: 'asset://peg.woff2' },
    ])).toBe(
      '@font-face{font-family:"Dial Sans";src:url("asset://dial.woff2");font-display:auto}\n'
      + '@font-face{font-family:"Peg Serif";src:url("asset://peg.woff2");font-display:auto}',
    );
    // A face at its own weight names it: one family at several weights.
    expect(packFontFaceCss([{ cssFamily: 'Dial Sans', uri: 'asset://dial-700.woff2', weight: 700 }])).toBe(
      '@font-face{font-family:"Dial Sans";font-weight:700;src:url("asset://dial-700.woff2");font-display:auto}',
    );
  });

  it('go onto the page synchronously, once, under one style element', () => {
    const doc = stubDocument();
    const { load, STYLE_ID } = freshModules();
    load(fakePack());
    expect(doc.appended).toHaveLength(1);
    expect(doc.appended[0].id).toBe(STYLE_ID);
    // Every PLACEABLE family is registered, each against its own asset; the
    // one with no bundled file gets no rule and stays on the fallback.
    expect(doc.appended[0].text).toContain('font-family:"Dial Sans"');
    expect(doc.appended[0].text).toContain('font-family:"Peg Serif"');
    expect(doc.appended[0].text).not.toContain('Nowhere');
    expect(doc.appended[0].text.match(/@font-face/g)).toHaveLength(2);
    // A second call is memoized; a second module instance finds the element.
    load(fakePack());
    const again = freshModules();
    again.load(fakePack());
    expect(doc.appended).toHaveLength(1);
  });

  it('are never written by expo-font, whose web loader stalls an iPad WebView for 12 s', () => {
    const src = readFileSync(join(__dirname, '..', 'loadPackFonts.ts'), 'utf8');
    expect(src).not.toMatch(/from 'expo-font'|require\('expo-font'\)/);
  });

  // The whole reason faceUri answers a STRING rather than taking an asset
  // module: resolving one needs the app's bundler, and this package has no
  // expo dependency to resolve it with.
  it('reach no bundler — the app hands over a URI it resolved itself', () => {
    const src = readFileSync(join(__dirname, '..', 'loadPackFonts.ts'), 'utf8');
    expect(src).not.toMatch(/from 'expo-asset'|require\('expo-asset'\)/);
  });
});

describe('which faces a build can place', () => {
  it('leaves out the ones the pack has no file for', () => {
    const { bundledFaces } = freshModules();
    expect(bundledFaces(fakePack())).toEqual([
      { cssFamily: 'Dial Sans', uri: 'asset://dial.woff2' },
      { cssFamily: 'Peg Serif', uri: 'asset://peg.woff2' },
    ]);
  });

  it('treats an empty URI as no file, not as a rule with no src', () => {
    const { bundledFaces } = freshModules();
    expect(bundledFaces(fakePack({ faceUri: () => '' }))).toEqual([]);
  });
});

it('bumps the fonts epoch only once every face has settled', async () => {
  const resolvers = stubDocument();
  const { load, epoch } = freshModules();

  const before = epoch();
  const settled = load(fakePack());
  // The rules are injected but the faces have not loaded.
  await flush();
  expect(resolvers.length).toBeGreaterThan(0);
  expect(epoch()).toBe(before);

  resolvers.forEach((res) => res());
  await settled;
  expect(epoch()).toBe(before + 1);
});

it('still settles when a face cannot be placed — text just stays on the fallback', async () => {
  const resolvers = stubDocument();
  const { load, epoch } = freshModules();

  const before = epoch();
  // A pack whose faceUri throws: the app's bundler has no assets at all.
  const settled = load(fakePack({ faceUri: () => { throw new Error('no assets'); } }));
  await flush();
  // Nothing to register, so nothing is written — and nothing is waited for.
  expect(resolvers.appended).toHaveLength(0);
  resolvers.forEach((res) => res());
  await expect(settled).resolves.toBeUndefined();
  expect(epoch()).toBe(before + 1);
});

// A CMS-pack font isn't in the probe list, so the browser loads it lazily when
// text first renders in it — same stale-metrics gap, caught by the event.
it('bumps again when the browser finishes a lazy face load', async () => {
  const resolvers = stubDocument();
  const { load, epoch } = freshModules();

  const settled = load(fakePack());
  await flush();
  resolvers.forEach((res) => res());
  await settled;

  const after = epoch();
  resolvers.emit('loadingdone');
  expect(epoch()).toBe(after + 1);
});

it('memoizes: repeated mounts load the faces once', async () => {
  const resolvers = stubDocument();
  const { load } = freshModules();

  const a = load(fakePack());
  expect(load(fakePack())).toBe(a);
  await flush();
  const probeCount = resolvers.length;
  expect(probeCount).toBeGreaterThan(0);
  load(fakePack());
  await flush();
  expect(resolvers).toHaveLength(probeCount);
  resolvers.forEach((res) => res());
  await a;
});

// The shared node layer asks this package which family a fontId resolves to,
// and the package knows only what an app installs (fontFamily.ts's
// registerFontFamily). The pack is installed HERE, beside the text measurer
// and the glyph-ink probe — if the call were dropped, every text node would
// silently render in the system face with every suite still green, which is
// the failure this pins.
it("installs the pack's own resolver as the editor's font-family resolver", () => {
  stubDocument();
  const { load, family } = freshModules();
  // Before the load, the package has no pack and answers the system stack.
  expect(family('dial')).toBe(SYSTEM_STACK);
  load(fakePack());
  // After it, the pack answers — for every id, including the two with a rule
  // of their own, which are the pack's to answer and not shortcut here.
  expect(family('dial')).toBe(`'dial-face', ${SYSTEM_STACK}`);
  expect(family('system')).toBe(SYSTEM_STACK);
  expect(family('')).toBe(SYSTEM_STACK);
});

// Ordering, and the reason it is safe: the measurer this installs resolves a
// family through the registry above, which is EMPTY until the line below it
// runs. Nothing lays text out between the two, so a measurement can never
// see the gap — but only while they stay in this order, which is what this
// pins, by position.
it('installs the family resolver in the same call as the measurer', () => {
  const src = readFileSync(join(__dirname, '..', 'loadPackFonts.ts'), 'utf8');
  const measurer = src.indexOf('registerTextMeasurer(domTextMeasurer)');
  const family = src.indexOf('registerFontFamily(pack.fontFamilyFor)');
  expect(measurer).toBeGreaterThan(-1);
  expect(family).toBeGreaterThan(measurer);
});
