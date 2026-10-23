/**
 * Font embedding for SVG export. The editor draws text with page-registered
 * @font-face rules; the exporter rasterizes through a detached <img> that
 * cannot see them, so without these bytes an exported entry's text renders in
 * the platform default instead of the font the page was composed with.
 *
 * What is pinned here is the CACHE, the concurrent-export dedupe and the
 * engine wiring — driven over a MADE-UP face reader. Reading a real app's
 * faces through its bundler is that app's half (web/fonts/exportFonts, and
 * its own suite, which mocks expo-asset).
 */
import { generateCompositionSVGCore } from '@/engine/compositionExport';
import * as compositionExport from '@/engine/compositionExport';
import { TextObject } from '@/engine/types';

import {
  exportFontResolver,
  registerExportFonts,
  registerFaceFetch,
  resetExportFontsForTest,
} from '../exportFonts';

/** Bytes 0x00 0x01 0x02 → 'AAEC' in base64. */
const FACE_B64 = 'AAEC';

/** A face reader that records every ask, so the cache is observable. */
function fakeFetch(answer: (id: string) => string | null = () => FACE_B64) {
  const asked: string[] = [];
  const fn = jest.fn(async (id: string) => {
    asked.push(id);
    return answer(id);
  });
  return { fn, asked };
}

let face: ReturnType<typeof fakeFetch>;

beforeEach(() => {
  resetExportFontsForTest();
  face = fakeFetch();
  registerFaceFetch(face.fn);
});

afterEach(() => {
  resetExportFontsForTest();
  registerFaceFetch(null);
});

describe('exportFontResolver', () => {
  it('returns the installed reader’s face as base64 woff2', async () => {
    await expect(exportFontResolver('dial')).resolves.toEqual({ woff2Base64: FACE_B64 });
  });

  it('fetches each face once, even for concurrent exports', async () => {
    // An app rasterizes a card thumb and a view image back to back.
    const [a, b] = await Promise.all([
      exportFontResolver('dial'),
      exportFontResolver('dial'),
    ]);
    await exportFontResolver('dial');
    expect(a).toEqual(b);
    expect(face.asked).toEqual(['dial']);
  });

  it('caches per fontId, so a page using two fonts reads two faces', async () => {
    await Promise.all([exportFontResolver('dial'), exportFontResolver('peg')]);
    expect([...face.asked].sort()).toEqual(['dial', 'peg']);
  });

  it('answers null for a font the app has no bundled face for', async () => {
    // 'system' (and any CMS-added font a build does not ship) has no face to
    // embed; the SVG then falls through to the system stack, which is what
    // the editor renders too.
    registerFaceFetch(fakeFetch((id) => (id === 'system' ? null : FACE_B64)).fn);
    await expect(exportFontResolver('system')).resolves.toBeNull();
  });

  it('answers null — never throws — when the app’s reader fails', async () => {
    // Export is best-effort: a missing asset must not be why a page fails
    // to save.
    registerFaceFetch(async () => { throw new Error('offline'); });
    await expect(exportFontResolver('dial')).resolves.toBeNull();
  });

  it('answers null when no app has installed a reader at all', async () => {
    registerFaceFetch(null);
    await expect(exportFontResolver('dial')).resolves.toBeNull();
  });

  // A second install must not serve the first one's bytes. Two apps never
  // share a page, but the cache is module-scope and a suite that installs
  // twice is exactly how that would show up.
  it('forgets cached faces when a new reader is installed', async () => {
    await exportFontResolver('dial');
    const second = fakeFetch(() => 'WkVE');
    registerFaceFetch(second.fn);
    await expect(exportFontResolver('dial')).resolves.toEqual({ woff2Base64: 'WkVE' });
    expect(second.asked).toEqual(['dial']);
  });

  it('embeds an @font-face the rasterizer can use', async () => {
    const text: TextObject = {
      id: 'txt_a',
      content: 'hello',
      style: { fontId: 'dial', size: 2, color: { r: 0, g: 0, b: 0 } },
      cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 2,
    };
    const svg = await generateCompositionSVGCore({
      name: 'entry',
      figures: [], svgObjects: [], images: [], imageBlobs: {},
      texts: [text],
      fontResolver: exportFontResolver,
      loadFigure: async () => null,
    });
    expect(svg).toContain(`@font-face{font-family:"dial";src:url(data:font/woff2;base64,${FACE_B64})`);
    // The family the <text> asks for is the one the @font-face defines.
    expect(svg).toContain('font-family="&apos;dial&apos;,');
  });
});

describe('registerExportFonts', () => {
  it('installs the resolver as the engine default, once', () => {
    // Five of CozyJournal's entry points call this; none of them should be
    // the one that has to remember it was already done.
    const spy = jest.spyOn(compositionExport, 'setDefaultSVGFontResolver');
    registerExportFonts();
    registerExportFonts();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(exportFontResolver);
    spy.mockRestore();
  });
});
