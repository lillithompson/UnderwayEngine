/**
 * Text raster cache (textTextureCache.ts). Pins the 90 fps keying rule —
 * pure transforms and in-bucket zoom are cache hits; content/style/bucket
 * changes re-raster — plus LRU eviction and node invalidation via a
 * counting stub rasterizer.
 */

import {
  textSizeBucket,
  textRasterKey,
  createTextRasterCache,
  TextRasterEntry,
  TextRasterizer,
} from '../textTextureCache';
import { TextObject } from '../types';

function makeText(id: string, overrides: Partial<TextObject> = {}): TextObject {
  return {
    id,
    content: 'hello',
    style: { fontId: 'font_a', size: 2, color: { r: 255, g: 255, b: 255 } },
    cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2,
    ...overrides,
  };
}

function makeCountingRasterizer(width = 10, height = 10): TextRasterizer & { calls: number } {
  const r = {
    calls: 0,
    rasterize(_text: TextObject, _bucketPx: number): TextRasterEntry {
      r.calls++;
      return { width, height, data: { call: r.calls } };
    },
  };
  return r;
}

describe('textSizeBucket', () => {
  test('rounds up to the next power of two, minimum 1', () => {
    expect(textSizeBucket(0.3)).toBe(1);
    expect(textSizeBucket(1)).toBe(1);
    expect(textSizeBucket(1.5)).toBe(2);
    expect(textSizeBucket(8)).toBe(8);
    expect(textSizeBucket(8.1)).toBe(16);
    expect(textSizeBucket(16)).toBe(16);
    expect(textSizeBucket(100)).toBe(128);
  });
});

describe('textRasterKey', () => {
  test('unchanged when only position / rotation / mirror change', () => {
    const base = makeText('txt_a');
    const moved = makeText('txt_a', {
      cellX: 40, cellY: -3, rotation: 90, mirrorH: true, mirrorV: true,
    });
    expect(textRasterKey(moved, 8)).toBe(textRasterKey(base, 8));
  });

  test('unchanged while zoom stays within one power-of-two bucket', () => {
    const t = makeText('txt_a'); // size 2
    // 2*5=10 and 2*8=16 both bucket to 16.
    expect(textRasterKey(t, 5)).toBe(textRasterKey(t, 8));
  });

  test('changes when zoom crosses a bucket boundary', () => {
    const t = makeText('txt_a'); // size 2: 2*8=16 → 16, 2*9=18 → 32
    expect(textRasterKey(t, 9)).not.toBe(textRasterKey(t, 8));
  });

  test('changes on content change', () => {
    const a = makeText('txt_a');
    const b = makeText('txt_a', { content: 'goodbye' });
    expect(textRasterKey(a, 8)).not.toBe(textRasterKey(b, 8));
  });

  test('changes on style change (color, bold, stroke, sticker)', () => {
    const base = makeText('txt_a');
    const variants: TextObject[] = [
      makeText('txt_a', { style: { ...base.style, color: { r: 1, g: 2, b: 3 } } }),
      makeText('txt_a', { style: { ...base.style, bold: true } }),
      makeText('txt_a', { style: { ...base.style, italic: true } }),
      makeText('txt_a', { style: { ...base.style, letterSpacing: 0.1 } }),
      makeText('txt_a', { style: { ...base.style, align: 'center' } }),
      makeText('txt_a', { style: { ...base.style, stroke: { width: 1, color: { r: 0, g: 0, b: 0 } } } }),
      makeText('txt_a', { sticker: true }),
    ];
    const baseKey = textRasterKey(base, 8);
    for (const v of variants) {
      expect(textRasterKey(v, 8)).not.toBe(baseKey);
    }
  });
});

describe('createTextRasterCache get', () => {
  test('rasterizes on miss and returns the cached entry on hit', () => {
    const rasterizer = makeCountingRasterizer();
    const cache = createTextRasterCache(rasterizer);
    const t = makeText('txt_a');
    const first = cache.get(t, 8);
    expect(rasterizer.calls).toBe(1);
    const second = cache.get(t, 8);
    expect(rasterizer.calls).toBe(1); // hit — no re-raster
    expect(second).toBe(first);
    expect(cache.entryCount()).toBe(1);
    expect(cache.size()).toBe(10 * 10 * 4);
  });

  test('a moved / rotated node hits the same cached raster', () => {
    const rasterizer = makeCountingRasterizer();
    const cache = createTextRasterCache(rasterizer);
    const t = makeText('txt_a');
    const entry = cache.get(t, 8);
    const moved = makeText('txt_a', { cellX: 99, rotation: 180, mirrorV: true });
    expect(cache.get(moved, 8)).toBe(entry);
    expect(rasterizer.calls).toBe(1);
  });

  test('an in-bucket zoom change hits; a bucket crossing re-rasters', () => {
    const rasterizer = makeCountingRasterizer();
    const cache = createTextRasterCache(rasterizer);
    const t = makeText('txt_a'); // size 2
    cache.get(t, 5); // bucket 16
    cache.get(t, 8); // still bucket 16
    expect(rasterizer.calls).toBe(1);
    cache.get(t, 9); // bucket 32
    expect(rasterizer.calls).toBe(2);
  });

  test('content change re-rasters', () => {
    const rasterizer = makeCountingRasterizer();
    const cache = createTextRasterCache(rasterizer);
    cache.get(makeText('txt_a'), 8);
    cache.get(makeText('txt_a', { content: 'edited' }), 8);
    expect(rasterizer.calls).toBe(2);
  });

  test('rasterizer receives the bucketed pixel size', () => {
    const buckets: number[] = [];
    const rasterizer: TextRasterizer = {
      rasterize(_t, bucketPx) {
        buckets.push(bucketPx);
        return { width: 1, height: 1, data: null };
      },
    };
    const cache = createTextRasterCache(rasterizer);
    cache.get(makeText('txt_a'), 5); // 2 * 5 = 10 → 16
    expect(buckets).toEqual([16]);
  });

  test('peek returns by exact key without rasterizing', () => {
    const rasterizer = makeCountingRasterizer();
    const cache = createTextRasterCache(rasterizer);
    const t = makeText('txt_a');
    expect(cache.peek(textRasterKey(t, 8))).toBeUndefined();
    const entry = cache.get(t, 8);
    expect(cache.peek(textRasterKey(t, 8))).toBe(entry);
    expect(rasterizer.calls).toBe(1);
  });
});

describe('createTextRasterCache LRU eviction', () => {
  test('evicts the oldest entry when over the byte budget', () => {
    const rasterizer = makeCountingRasterizer(10, 10); // 400 bytes each
    const cache = createTextRasterCache(rasterizer, 1000);
    const a = makeText('txt_a', { content: 'aaa' });
    const b = makeText('txt_b', { content: 'bbb' });
    const c = makeText('txt_c', { content: 'ccc' });
    cache.get(a, 8);
    cache.get(b, 8);
    cache.get(c, 8); // 1200 > 1000 → evict a
    expect(cache.entryCount()).toBe(2);
    expect(cache.size()).toBe(800);
    expect(cache.peek(textRasterKey(a, 8))).toBeUndefined();
    expect(cache.peek(textRasterKey(b, 8))).toBeDefined();
    expect(cache.peek(textRasterKey(c, 8))).toBeDefined();
    // Getting a again is a miss and re-rasterizes.
    cache.get(a, 8);
    expect(rasterizer.calls).toBe(4);
  });

  test('a recent hit protects an entry from eviction', () => {
    const rasterizer = makeCountingRasterizer(10, 10);
    const cache = createTextRasterCache(rasterizer, 1000);
    const a = makeText('txt_a', { content: 'aaa' });
    const b = makeText('txt_b', { content: 'bbb' });
    const c = makeText('txt_c', { content: 'ccc' });
    cache.get(a, 8);
    cache.get(b, 8);
    cache.get(a, 8); // bump a — b becomes the LRU candidate
    cache.get(c, 8);
    expect(cache.peek(textRasterKey(a, 8))).toBeDefined();
    expect(cache.peek(textRasterKey(b, 8))).toBeUndefined();
    expect(cache.peek(textRasterKey(c, 8))).toBeDefined();
  });
});

describe('createTextRasterCache invalidateNode', () => {
  test('drops entries for that node only', () => {
    const rasterizer = makeCountingRasterizer();
    const cache = createTextRasterCache(rasterizer);
    const a = makeText('txt_a', { content: 'aaa' });
    const b = makeText('txt_b', { content: 'bbb' });
    cache.get(a, 8);
    cache.get(a, 40); // second bucket for the same node
    cache.get(b, 8);
    expect(cache.entryCount()).toBe(3);
    cache.invalidateNode('txt_a');
    expect(cache.entryCount()).toBe(1);
    expect(cache.peek(textRasterKey(a, 8))).toBeUndefined();
    expect(cache.peek(textRasterKey(a, 40))).toBeUndefined();
    expect(cache.peek(textRasterKey(b, 8))).toBeDefined();
    // Re-getting the invalidated node re-rasterizes.
    cache.get(a, 8);
    expect(rasterizer.calls).toBe(4);
  });

  test('clear empties everything', () => {
    const rasterizer = makeCountingRasterizer();
    const cache = createTextRasterCache(rasterizer);
    cache.get(makeText('txt_a'), 8);
    cache.clear();
    expect(cache.entryCount()).toBe(0);
    expect(cache.size()).toBe(0);
  });
});
