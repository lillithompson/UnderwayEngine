import {
  detectImageMimeType, looksLikeSvg, placementBbox, SVG_MIME_TYPE, svgIntrinsicSize,
} from '../compositionImageImport';

describe('placementBbox', () => {
  it('sizes to 8 L0 cells at grid level 0', () => {
    const result = placementBbox(1024, 512, 16, 16, 0);
    expect(result.cellWidth).toBe(8);
    expect(result.cellHeight).toBe(4);
    expect(result.cellX).toBe(12);
    expect(result.cellY).toBe(14);
  });

  it('sizes to 8 L1 cells (16 L0 cells) at grid level 1', () => {
    const result = placementBbox(1024, 512, 16, 16, 1);
    expect(result.cellWidth).toBe(16);
    expect(result.cellHeight).toBe(8);
  });

  it('sizes to 8 L2 cells (32 L0 cells) at grid level 2', () => {
    const result = placementBbox(1024, 512, 16, 16, 2);
    expect(result.cellWidth).toBe(32);
    expect(result.cellHeight).toBe(16);
  });

  it('sizes to 8 L3 cells (64 L0 cells) at grid level 3', () => {
    const result = placementBbox(1024, 512, 16, 16, 3);
    expect(result.cellWidth).toBe(64);
    expect(result.cellHeight).toBe(32);
  });

  it('handles square images', () => {
    const result = placementBbox(500, 500, 10, 10, 0);
    expect(result.cellWidth).toBe(8);
    expect(result.cellHeight).toBe(8);
  });

  it('handles portrait images', () => {
    const result = placementBbox(512, 1024, 16, 16, 0);
    expect(result.cellWidth).toBe(4);
    expect(result.cellHeight).toBe(8);
  });

  it('centers the bbox on the given cell', () => {
    const result = placementBbox(1024, 512, 20, 10, 1);
    // 16 wide, 8 tall at L1
    expect(result.cellX).toBe(20 - 16 / 2);
    expect(result.cellY).toBe(10 - 8 / 2);
  });

  it('defaults to L0 when gridLevel is omitted', () => {
    const result = placementBbox(1024, 768, 16, 16);
    expect(result.cellWidth).toBe(8);
    expect(result.cellHeight).toBe(6);
  });
});

// An SVG is a first-class import source: the pipeline rasterizes it at its
// own edge caps and re-encodes as PNG, so everything downstream (binary
// persistence, export, native decode) keeps speaking png/jpeg only. These
// are the pure decisions that routing rests on.
describe('SVG import sources', () => {
  const bytes = (s: string) => new TextEncoder().encode(s);
  const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  describe('looksLikeSvg', () => {
    it('trusts a supplied SVG mime type without reading the bytes', () => {
      expect(looksLikeSvg(new Uint8Array(), SVG_MIME_TYPE)).toBe(true);
    });

    it('never second-guesses a real raster mime — even over SVG-shaped bytes', () => {
      expect(looksLikeSvg(PNG_MAGIC, 'image/png')).toBe(false);
      expect(looksLikeSvg(bytes('<svg viewBox="0 0 4 4"/>'), 'image/jpeg')).toBe(false);
    });

    it('sniffs untyped bytes: every way an SVG document can open', () => {
      for (const mime of ['', 'application/octet-stream']) {
        expect(looksLikeSvg(bytes('<svg xmlns="…"></svg>'), mime)).toBe(true);
        expect(looksLikeSvg(bytes('<?xml version="1.0"?>\n<svg/>'), mime)).toBe(true);
        expect(looksLikeSvg(bytes('<!DOCTYPE svg PUBLIC "…">\n<svg/>'), mime)).toBe(true);
        expect(looksLikeSvg(bytes('<!-- exported --><svg/>'), mime)).toBe(true);
        // A leading BOM and whitespace are stripped before the sniff.
        expect(looksLikeSvg(bytes('﻿  \n<svg/>'), mime)).toBe(true);
      }
    });

    it('rejects untyped bytes that are not SVG', () => {
      expect(looksLikeSvg(PNG_MAGIC, '')).toBe(false);
      expect(looksLikeSvg(bytes('{"figure": true}'), '')).toBe(false);
      expect(looksLikeSvg(bytes('<?xml version="1.0"?><figure/>'), '')).toBe(false);
    });
  });

  describe('svgIntrinsicSize (aspect only — the raster renders at the cap)', () => {
    it('reads plain width/height attributes, px suffix included', () => {
      expect(svgIntrinsicSize('<svg width="24" height="12"/>')).toEqual({ width: 24, height: 12 });
      expect(svgIntrinsicSize("<svg width='300px' height='150px'/>")).toEqual({ width: 300, height: 150 });
    });

    it('falls back to the viewBox extent — how icon SVGs usually size', () => {
      expect(svgIntrinsicSize('<svg viewBox="0 0 300 150"/>')).toEqual({ width: 300, height: 150 });
      // Comma-separated, with offsets: only the extent matters.
      expect(svgIntrinsicSize('<svg viewBox="10, 20, 4, 3"/>')).toEqual({ width: 4, height: 3 });
    });

    it('lets a relative width/height (100%) fall through to the viewBox', () => {
      expect(svgIntrinsicSize('<svg width="100%" height="100%" viewBox="0 0 4 3"/>'))
        .toEqual({ width: 4, height: 3 });
    });

    it('prefers explicit width/height over the viewBox', () => {
      expect(svgIntrinsicSize('<svg width="8" height="2" viewBox="0 0 4 4"/>'))
        .toEqual({ width: 8, height: 2 });
    });

    it('squares up a document that declares nothing usable', () => {
      expect(svgIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg"/>')).toEqual({ width: 1, height: 1 });
      expect(svgIntrinsicSize('<svg viewBox="0 0 0 4"/>')).toEqual({ width: 1, height: 1 });
      expect(svgIntrinsicSize('not svg at all')).toEqual({ width: 1, height: 1 });
    });
  });

  it('routes .svg filenames through the image pipeline, like .png/.jpg', () => {
    expect(detectImageMimeType('icon.svg')).toBe(SVG_MIME_TYPE);
    expect(detectImageMimeType('ICON.SVG')).toBe(SVG_MIME_TYPE);
    expect(detectImageMimeType('figure.json')).toBeNull();
  });
});
