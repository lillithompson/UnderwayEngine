/**
 * SVG export of the v29 visual features: text nodes (incl. stickers),
 * gradient fill paints, node effects (shadow/glow/border), image tints,
 * and the canvas background paint.
 *
 * Tests drive the pure `generateCompositionSVGCore` directly rather than
 * the storage-backed `exportCompositionSVG` wrapper (which the legacy
 * compositionExport.test.ts covers): the core is the single code path
 * both wrappers use, it needs no storage/canvas mocks, and testing it
 * in-memory keeps these assertions independent of the persistence
 * loader's field passthrough.
 */
import { generateCompositionSVGCore, type CompositionSVGInputs } from '../compositionSVGCore';
import { DEFAULT_LINE_HEIGHT, layoutText } from '../textLayout';
import { STICKER_BORDER_CELLS } from '../stickerStyle';
import { SVGObject, ImageObject, TextObject, PathSegment } from '../types';

/** SVG_UNITS_PER_L0_CELL — world cells scale into SVG units by this. */
const U = 256;

const closedSquare: PathSegment[] = [
  { kind: 'line', start: [0, 0], end: [32, 0] },
  { kind: 'line', start: [32, 0], end: [32, 32] },
  { kind: 'line', start: [32, 32], end: [0, 32] },
  { kind: 'line', start: [0, 32], end: [0, 0] },
];

function makeInputs(partial: Partial<CompositionSVGInputs>): CompositionSVGInputs {
  return {
    name: 'V29',
    figures: [],
    svgObjects: [],
    images: [],
    imageBlobs: {},
    strokeScale: 0.04,
    loadFigure: async () => null,
    ...partial,
  };
}

function makeText(overrides: Partial<TextObject> & { content: string }): TextObject {
  return {
    id: 'txt_a',
    style: { fontId: 'CozySans', size: 2, color: { r: 10, g: 20, b: 30 } },
    cellX: 2, cellY: 3, cellWidth: 10, cellHeight: 4,
    ...overrides,
  };
}

function makeSquareSvg(overrides: Partial<SVGObject>): SVGObject {
  return {
    id: 'svg_a',
    segments: closedSquare,
    color: { r: 200, g: 100, b: 50 },
    cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32,
    ...overrides,
  } as SVGObject;
}

function makeImage(overrides: Partial<ImageObject>): ImageObject {
  return {
    id: 'img_a',
    imageId: 'blob1',
    mimeType: 'image/png',
    pixelWidth: 4, pixelHeight: 4,
    cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8,
    ...overrides,
  };
}

describe('generateCompositionSVGCore — text nodes', () => {
  it('emits <text> per line with XML-escaped content, font attrs, and the bbox transform', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      texts: [makeText({ content: 'A&B <ok>' })],
    }));
    expect(svg).not.toBeNull();
    expect(svg).toContain('<text');
    // Content is XML-escaped — raw ampersand / angle bracket never appear.
    expect(svg).toContain('A&amp;B &lt;ok&gt;');
    expect(svg).not.toContain('A&B');
    expect(svg).not.toContain('<ok>');
    // font-size in SVG units: 2 world units × 256.
    expect(svg).toContain(`font-size="${2 * U}"`);
    // The fontId names the family (matching the @font-face the resolver
    // embeds), followed by the DOM node layer's own fallback tail so an
    // un-embedded family lands on the same face the editor shows.
    expect(svg).toContain(
      `font-family="&apos;CozySans&apos;, system-ui, -apple-system, &apos;Segoe UI&apos;, sans-serif"`);
    expect(svg).toContain(`fill="rgb(10,20,30)"`);
    // Glyphs must not inherit the root <svg>'s stroke="white" (a hairline
    // outline that would thin them against the editor's DOM text).
    expect(svg).toContain('stroke="none"');
    // Node transform mirrors the image path: translate to the bbox origin.
    expect(svg).toContain(`transform="translate(${2 * U}, ${3 * U})"`);
  });

  it('a text-only composition exports (non-null) and frames the text bbox', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      texts: [makeText({ content: 'hi', cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 2 })],
    }));
    expect(svg).not.toBeNull();
    expect(svg).toMatch(/viewBox="0 0 2048 512"/);
  });

  it('honors bold, italic, letter-spacing, and the stroke outline', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      texts: [makeText({
        content: 'styled',
        style: {
          fontId: 'CozySans', size: 2, color: { r: 0, g: 0, b: 0 },
          bold: true, italic: true, letterSpacing: 0.1, align: 'center',
          stroke: { width: 0.05, color: { r: 255, g: 0, b: 0 } },
        },
      })],
    }));
    // Weight is emitted numerically (the renderer resolves named/legacy
    // weights to a face via effectiveFontWeight); legacy `bold` → 700.
    expect(svg).toContain('font-weight="700"');
    expect(svg).toContain('font-style="italic"');
    // letterSpacing (em) × font-size (512) = 51.2 SVG units.
    expect(svg).toContain(`letter-spacing="${0.1 * 2 * U}"`);
    // Alignment rides the shared layout's per-line x (see the parity test),
    // never text-anchor: anchoring would re-align each line by the
    // rasterizer's real glyph widths while the editor placed it by the
    // shared measurer's, so the two would disagree.
    expect(svg).not.toContain('text-anchor');
    // Outline behind the fill: stroke attrs + paint-order.
    expect(svg).toContain('stroke="rgb(255,0,0)"');
    expect(svg).toContain(`stroke-width="${0.05 * U}"`);
    expect(svg).toContain('paint-order="stroke"');
  });

  it('exports a named weight as its numeric face (semibold → 600)', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      texts: [makeText({
        content: 'semi',
        style: { fontId: 'CozySans', size: 2, color: { r: 0, g: 0, b: 0 }, weight: 'semibold' },
      })],
    }));
    expect(svg).toContain('font-weight="600"');
  });

  it('omits font-weight for a regular-weight text', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      texts: [makeText({
        content: 'plain',
        style: { fontId: 'CozySans', size: 2, color: { r: 0, g: 0, b: 0 }, weight: 'regular' },
      })],
    }));
    expect(svg).not.toContain('font-weight');
  });

  it('applies rotation and mirror like image nodes', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      texts: [makeText({ content: 'spin', rotation: 90, mirrorH: true })],
    }));
    // rotate about the bbox center (10×4 cells → 1280, 512), then mirror.
    expect(svg).toContain(`rotate(90 ${(10 * U) / 2} ${(4 * U) / 2})`);
    expect(svg).toContain(`translate(${10 * U}, 0) scale(-1, 1)`);
  });

  it('sticker emits the card background behind the text, filling the bbox', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      texts: [makeText({ content: 'word', sticker: true })],
    }));
    expect(svg).not.toBeNull();
    const rectIdx = svg!.indexOf('<rect');
    const textIdx = svg!.indexOf('<text');
    expect(rectIdx).toBeGreaterThanOrEqual(0);
    // Background rect precedes the text (drawn behind it).
    expect(rectIdx).toBeLessThan(textIdx);
    // The bbox IS the card: white face, black border, square corners, drop
    // shadow — the same card stickerStyle gives the DOM node layer. The rect
    // is inset by half the border because CSS draws its border inside the
    // box while an SVG stroke straddles the edge.
    const bw = STICKER_BORDER_CELLS * U;
    expect(svg).toContain(
      `<rect x="${bw / 2}" y="${bw / 2}" width="${10 * U - bw}" height="${4 * U - bw}"` +
      ` fill="#FFFFFF" stroke="#000000" stroke-width="${bw}"`);
    expect(svg).not.toContain('rx=');
    expect(svg).toContain('<feDropShadow');
  });

  it('an inverted sticker swaps the card and text colors', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      texts: [makeText({ content: 'word', sticker: true, invert: true })],
    }));
    expect(svg).toContain('fill="#000000" stroke="#FFFFFF"');
    // Text takes the card's foreground, not TextStyle.color (10,20,30).
    expect(svg).toContain('fill="#FFFFFF"');
    expect(svg).not.toContain('fill="rgb(10,20,30)"');
  });

  it('places every line where the DOM node layer does', async () => {
    // The journal's entry image must be indistinguishable from the editor
    // page it was rasterized from, so these two renderers have to agree on
    // the geometry: same layoutText call (same measurer → same wrapping),
    // lines placed at the layout's own x, and a baseline at the line box's
    // center — where CSS's half-leading puts it, and where
    // dominant-baseline="central" puts a <text>.
    for (const align of ['left', 'center', 'right'] as const) {
      const style = {
        fontId: 'CozySans', size: 2, color: { r: 0, g: 0, b: 0 },
        align, lineHeight: 1.4,
      };
      const node = makeText({
        content: 'two words wrap here', style, cellWidth: 10, cellHeight: 6,
      });
      const svg = await generateCompositionSVGCore(makeInputs({ texts: [node] }));

      // What the DOM node layer computes for the same node.
      const layout = layoutText(node.content, style, {
        maxWidth: node.cellWidth, maxHeight: node.cellHeight,
      });
      const lineHeight = style.size * style.lineHeight;
      const emitted = [...svg!.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"/g)]
        .map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));

      expect(layout.lines.length).toBeGreaterThan(1); // the wrap actually happened
      expect(emitted).toEqual(layout.lines.map((line) => ({
        x: line.x * U,
        y: (line.y + lineHeight / 2) * U,
      })));
      expect(svg).toContain('dominant-baseline="central"');
    }
  });

  it('lays a sticker out against the full bbox, like the DOM node layer', async () => {
    // A sticker's bbox already includes its interior margin (the scaffold
    // grew it), so neither renderer insets again — an extra inset here would
    // wrap the text earlier than the editor did.
    const style = { fontId: 'CozySans', size: 1.5, color: { r: 0, g: 0, b: 0 },
      align: 'center' as const, vAlign: 'middle' as const };
    const node = makeText({ content: 'poetry', style, sticker: true, cellWidth: 8, cellHeight: 3 });
    const svg = await generateCompositionSVGCore(makeInputs({ texts: [node] }));

    const layout = layoutText(node.content, style, {
      maxWidth: node.cellWidth, maxHeight: node.cellHeight,
    });
    const m = svg!.match(/<text x="([-\d.]+)" y="([-\d.]+)"/);
    expect(Number(m![1])).toBeCloseTo(layout.lines[0].x * U, 6);
    expect(Number(m![2])).toBeCloseTo(
      (layout.lines[0].y + style.size * DEFAULT_LINE_HEIGHT / 2) * U, 6);
  });

  it('emits an @font-face style block only when the fontResolver yields bytes', async () => {
    const texts = [makeText({ content: 'embedded' })];
    const withResolver = await generateCompositionSVGCore(makeInputs({
      texts,
      fontResolver: (fontId) => (fontId === 'CozySans' ? { woff2Base64: 'AAAA' } : null),
    }));
    expect(withResolver).toContain('<style>');
    expect(withResolver).toContain('@font-face{font-family:"CozySans";');
    expect(withResolver).toContain('data:font/woff2;base64,AAAA');

    const withoutResolver = await generateCompositionSVGCore(makeInputs({ texts }));
    expect(withoutResolver).not.toContain('<style>');
    expect(withoutResolver).not.toContain('@font-face');
  });
});

describe('generateCompositionSVGCore — gradient fill paints', () => {
  const stops = [
    { offset: 0, color: { r: 255, g: 0, b: 0 } },
    { offset: 1, color: { r: 0, g: 0, b: 255 } },
  ];

  it('emits a <linearGradient> def with a node-prefixed id and a matching url() fill', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      svgObjects: [makeSquareSvg({
        fillPaint: { kind: 'linear', stops, x1: 0, y1: 0, x2: 1, y2: 1 },
      })],
    }));
    expect(svg).toContain('<linearGradient id="grad_svg_a"');
    expect(svg).toContain('fill="url(#grad_svg_a)"');
  });

  it('emits a <radialGradient> for radial paints', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      svgObjects: [makeSquareSvg({
        fillPaint: { kind: 'radial', stops, cx: 0.5, cy: 0.5, r: 0.5 },
      })],
    }));
    expect(svg).toContain('<radialGradient id="grad_svg_a"');
    expect(svg).toContain('fill="url(#grad_svg_a)"');
  });

  it('two gradient nodes get distinct def ids', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      svgObjects: [
        makeSquareSvg({ id: 'svg_a', fillPaint: { kind: 'linear', stops, x1: 0, y1: 0, x2: 1, y2: 0 } }),
        makeSquareSvg({ id: 'svg_b', fillPaint: { kind: 'linear', stops, x1: 0, y1: 0, x2: 0, y2: 1 } }),
      ],
    }));
    expect(svg).toContain('<linearGradient id="grad_svg_a"');
    expect(svg).toContain('<linearGradient id="grad_svg_b"');
    expect(svg).toContain('fill="url(#grad_svg_a)"');
    expect(svg).toContain('fill="url(#grad_svg_b)"');
  });

  it('fillPaint takes precedence over the legacy fillColor', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      svgObjects: [makeSquareSvg({
        fillColor: { r: 1, g: 2, b: 3 },
        fillPaint: { kind: 'linear', stops, x1: 0, y1: 0, x2: 1, y2: 0 },
      })],
    }));
    expect(svg).toContain('fill="url(#grad_svg_a)"');
    expect(svg).not.toContain('fill="rgb(1,2,3)"');
  });

  it('legacy fillColor path is unchanged when no fillPaint is set', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      svgObjects: [makeSquareSvg({ fillColor: { r: 1, g: 2, b: 3 } })],
    }));
    expect(svg).toContain('fill="rgb(1,2,3)"');
    expect(svg).not.toContain('Gradient');
  });
});

describe('generateCompositionSVGCore — node effects', () => {
  it('shadow/glow emit a node-prefixed <filter> def referenced by the node', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      svgObjects: [makeSquareSvg({
        effects: {
          shadow: { dx: 0.5, dy: 0.5, blur: 1, color: { r: 0, g: 0, b: 0 }, alpha: 0.5 },
          glow: { radius: 1, color: { r: 255, g: 255, b: 0 }, alpha: 1 },
        },
      })],
    }));
    expect(svg).toContain('<filter id="fx_svg_a"');
    expect(svg).toContain('filter="url(#fx_svg_a)"');
    expect(svg).toContain('feDropShadow');
    expect(svg).toContain('feGaussianBlur');
    // World-unit geometry scales into SVG units (0.5 cells × 256 = 128).
    expect(svg).toContain(`dx="${0.5 * U}"`);
  });

  it('border emits a stroked rect around the node bbox', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      svgObjects: [makeSquareSvg({
        effects: { border: { width: 0.5, color: { r: 0, g: 255, b: 0 }, radius: 1 } },
      })],
    }));
    // 32-cell bbox × 256, stroke width 0.5 × 256, radius 1 × 256.
    expect(svg).toContain(
      `<rect x="0" y="0" width="${32 * U}" height="${32 * U}" rx="${U}" ry="${U}" ` +
      `fill="none" stroke="#00FF00" stroke-width="${0.5 * U}"/>`,
    );
    // Border alone needs no filter.
    expect(svg).not.toContain('<filter');
  });

  it('text nodes support effects too', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      texts: [makeText({
        content: 'shadowed',
        effects: { shadow: { dx: 0.1, dy: 0.1, blur: 0.2, color: { r: 0, g: 0, b: 0 }, alpha: 0.4 } },
      })],
    }));
    expect(svg).toContain('<filter id="fx_txt_a"');
    expect(svg).toContain('filter="url(#fx_txt_a)"');
  });
});

describe('generateCompositionSVGCore — image effects rotate with the bitmap', () => {
  const imageBlobs = { blob1: new Uint8Array([137, 80, 78, 71]) };

  it("a rotated image's border rides inside the transform group (local frame)", async () => {
    const svg = (await generateCompositionSVGCore(makeInputs({
      images: [makeImage({
        cellX: 2, cellY: 2, cellWidth: 8, cellHeight: 8, angleDeg: 30,
        effects: { border: { width: 0.5, color: { r: 0, g: 255, b: 0 } } },
      })],
      imageBlobs,
    })))!;
    // Translate to origin, then rotate about the bbox center (4 cells × 256).
    expect(svg).toContain(`transform="translate(${2 * U}, ${2 * U}) rotate(30 ${4 * U} ${4 * U})"`);
    // The border rect is emitted in the LOCAL frame (x/y = 0) so the enclosing
    // transform group rotates it. Before the fix it sat at the world bbox
    // (x = 2 × 256 = 512), unrotated.
    expect(svg).toMatch(/<rect x="0" y="0"[^>]*stroke="#00FF00"/);
    expect(svg).not.toMatch(new RegExp(`<rect x="${2 * U}"[^>]*stroke="#00FF00"`));
  });

  it("a rotated image's shadow filter nests inside the rotation (offset turns too)", async () => {
    const svg = (await generateCompositionSVGCore(makeInputs({
      images: [makeImage({
        cellX: 2, cellY: 2, cellWidth: 8, cellHeight: 8, angleDeg: 30,
        effects: { shadow: { dx: 0.5, dy: 0, blur: 0.3, color: { r: 0, g: 0, b: 0 }, alpha: 0.5 } },
      })],
      imageBlobs,
    })))!;
    const rotIdx = svg.indexOf('rotate(30');
    const filterRefIdx = svg.indexOf('filter="url(#fx_img_a)"');
    expect(rotIdx).toBeGreaterThanOrEqual(0);
    // The filtered group is nested within the rotation transform, so the
    // shadow offset is cast in the rotated user space rather than world space.
    expect(filterRefIdx).toBeGreaterThan(rotIdx);
  });
});

describe('generateCompositionSVGCore — image tint', () => {
  const imageBlobs = { blob1: new Uint8Array([137, 80, 78, 71]) };

  it('emits a feColorMatrix filter on the image element', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      images: [makeImage({ tint: { color: { r: 255, g: 0, b: 0 }, amount: 1, mode: 'tint' } })],
      imageBlobs,
    }));
    expect(svg).toContain('<filter id="tint_img_a"');
    expect(svg).toContain('feColorMatrix');
    expect(svg).toMatch(/<image [^>]*filter="url\(#tint_img_a\)"/);
  });

  it('composes tint (inner, on the image) with node effects (outer group filter)', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      images: [makeImage({
        tint: { color: { r: 0, g: 0, b: 255 }, amount: 0.5, mode: 'wash' },
        effects: { shadow: { dx: 0.2, dy: 0.2, blur: 0.4, color: { r: 0, g: 0, b: 0 }, alpha: 0.6 } },
      })],
      imageBlobs,
    }));
    expect(svg).toContain('<filter id="tint_img_a"');
    expect(svg).toContain('<filter id="fx_img_a"');
    // Tint stays on the <image>; the effect filter wraps a <g> outside it.
    expect(svg).toMatch(/<image [^>]*filter="url\(#tint_img_a\)"/);
    expect(svg).toMatch(/<g filter="url\(#fx_img_a\)">/);
  });
});

describe('generateCompositionSVGCore — prefers the original blob on export', () => {
  const display = new Uint8Array([1, 2, 3, 4]);
  const original = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]);
  const displayB64 = Buffer.from(display).toString('base64');
  const originalB64 = Buffer.from(original).toString('base64');
  const image = makeImage({ imageId: 'blob_d', originalImageId: 'blob_o' });
  const imageBlobs = { blob_d: display, blob_o: original };

  it('emits the original bytes when preferOriginalImages is set', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      images: [image], imageBlobs, preferOriginalImages: true,
    }));
    expect(svg).toContain(originalB64);
    expect(svg).not.toContain(displayB64);
  });

  it('emits the display bytes by default (thumbnails/previews)', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      images: [image], imageBlobs,
    }));
    expect(svg).toContain(displayB64);
    expect(svg).not.toContain(originalB64);
  });

  it('falls back to the display blob when no original exists', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      images: [makeImage({ imageId: 'blob_d' })],
      imageBlobs: { blob_d: display },
      preferOriginalImages: true,
    }));
    expect(svg).toContain(displayB64);
  });
});

describe('generateCompositionSVGCore — canvas background', () => {
  it('paints a solid background rect covering the viewBox behind everything', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      svgObjects: [makeSquareSvg({})],
      background: { kind: 'solid', color: { r: 250, g: 240, b: 230 } },
    }));
    expect(svg).not.toBeNull();
    // Full-viewBox rect (square spans 0..32 cells → 0..8192 units).
    const bgIdx = svg!.indexOf(`<rect x="0" y="0" width="${32 * U}" height="${32 * U}" fill="#FAF0E6" stroke="none"/>`);
    const pathIdx = svg!.indexOf('<path');
    expect(bgIdx).toBeGreaterThanOrEqual(0);
    // Backdrop precedes all scene elements.
    expect(bgIdx).toBeLessThan(pathIdx);
  });

  it('gradient background emits a def and references it from the backdrop rect', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      svgObjects: [makeSquareSvg({})],
      background: {
        kind: 'linear',
        stops: [
          { offset: 0, color: { r: 255, g: 255, b: 255 } },
          { offset: 1, color: { r: 0, g: 0, b: 0 } },
        ],
        x1: 0, y1: 0, x2: 0, y2: 1,
      },
    }));
    expect(svg).toContain('<linearGradient id="bg_paint"');
    expect(svg).toContain('fill="url(#bg_paint)"');
  });
});

describe('generateCompositionSVGCore — no-feature churn guard', () => {
  it('a composition using none of the v29 features emits none of the new markup', async () => {
    const svg = await generateCompositionSVGCore(makeInputs({
      svgObjects: [
        makeSquareSvg({ fillColor: { r: 111, g: 122, b: 133 } }),
        {
          id: 'svg_line',
          segments: [{ kind: 'line', start: [0, 0], end: [32, 32] }],
          color: { r: 5, g: 6, b: 7 },
          cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32,
        } as SVGObject,
      ],
      images: [makeImage({})],
      imageBlobs: { blob1: new Uint8Array([1, 2, 3]) },
    }));
    expect(svg).not.toBeNull();
    // None of the v29 constructs appear: no filters, gradients, text,
    // font styles, or backdrop — pre-v29 markup shape is preserved.
    expect(svg).not.toContain('<filter');
    expect(svg).not.toContain('Gradient');
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('<style>');
    expect(svg).not.toContain('feColorMatrix');
    expect(svg).not.toContain('bg_paint');
    expect(svg).not.toContain('paint-order');
    // Legacy markup is intact.
    expect(svg).toContain('fill="rgb(111,122,133)"');
    expect(svg).toContain('stroke="rgb(5,6,7)"');
    expect(svg).toMatch(/<image [^>]*preserveAspectRatio="none"\/>/);
  });
});
