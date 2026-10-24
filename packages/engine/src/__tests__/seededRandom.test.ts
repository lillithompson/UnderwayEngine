import { FNV1A32_OFFSET_BASIS, fnv1a32, mulberry32, seededShuffle } from '../seededRandom';

// The deterministic PRNG primitives (seededRandom.ts). They had no suite in
// either app that carried a copy of them — their behaviour was covered only
// incidentally, through the daily content that seeds off them — and they are
// exactly the kind of code where a tidy is invisible: a shuffle that stopped
// being deterministic, or a hash whose multiply drifted, changes what every
// device generates for a given day without failing anything that reads the
// result.
//
// Two things here are PERSISTED and so are pinned as literals: `fnv1a32`'s
// answer (store/pageIds.ts derives a collage page's NAME from three of them)
// and `mulberry32`'s first draws (a scattered word layout is laid out once
// and then rides the saved composition).

describe('fnv1a32', () => {
  it('is these exact values', () => {
    // FNV-1a's own published vectors for the empty string and "a", which is
    // what makes this the standard hash rather than a hash.
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  it('starts from the standard offset basis unless told otherwise', () => {
    expect(FNV1A32_OFFSET_BASIS).toBe(0x811c9dc5);
    expect(fnv1a32('collage|2026-03-02|')).toBe(fnv1a32('collage|2026-03-02|', FNV1A32_OFFSET_BASIS));
  });

  it('gives INDEPENDENT hashes of one string from different seeds', () => {
    // What `collagePageId` needs: eighty bits of tail out of one key.
    const key = 'collage|2026-03-02|grp_1';
    const three = [fnv1a32(key), fnv1a32(key, 0x01000193), fnv1a32(key, 0x9e3779b9)];
    expect(new Set(three).size).toBe(3);
  });

  it('stays inside 32 unsigned bits, however long the string', () => {
    const long = 'x'.repeat(10_000);
    const h = fnv1a32(long);
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });

  it('sees a one-character change, and the ORDER of the characters', () => {
    expect(fnv1a32('abc')).not.toBe(fnv1a32('abd'));
    expect(fnv1a32('abc')).not.toBe(fnv1a32('cba'));
  });
});

describe('mulberry32', () => {
  it('is these exact first draws from a given seed', () => {
    // Pinned because a layout drawn off this stream is laid out ONCE and
    // then rides the saved composition: a changed stream would not move an
    // existing page, it would move every page made after it, which is
    // invisible until two devices disagree about the same day.
    const rng = mulberry32(42);
    expect([rng(), rng(), rng()]).toEqual([
      0.6011037519201636, 0.44829055899754167, 0.8524657934904099,
    ]);
  });

  it('is deterministic: the same seed gives the same stream', () => {
    const a = Array.from({ length: 8 }, mulberry32(7));
    const b = Array.from({ length: 8 }, mulberry32(7));
    expect(a).toEqual(b);
    expect(Array.from({ length: 8 }, mulberry32(8))).not.toEqual(a);
  });

  it('draws in [0, 1)', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 2000; i++) {
      const n = rng();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });

  it('does not repeat itself over a short run', () => {
    const rng = mulberry32(99);
    const draws = Array.from({ length: 500 }, () => rng());
    expect(new Set(draws).size).toBe(500);
  });
});

describe('seededShuffle', () => {
  const ITEMS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

  it('is a permutation, and leaves the input alone', () => {
    const input = [...ITEMS];
    const out = seededShuffle(input, 3);
    expect([...out].sort()).toEqual([...ITEMS].sort());
    expect(input).toEqual([...ITEMS]);
    expect(out).not.toBe(input);
  });

  it('is deterministic per seed, and different between seeds', () => {
    expect(seededShuffle(ITEMS, 3)).toEqual(['h', 'e', 'b', 'd', 'g', 'c', 'a', 'f']);
    expect(seededShuffle(ITEMS, 3)).toEqual(seededShuffle(ITEMS, 3));
    expect(seededShuffle(ITEMS, 3)).not.toEqual(seededShuffle(ITEMS, 4));
  });

  it('actually moves things — a shuffle that returned its input would pass the rest', () => {
    // The vacuous-pass guard: `seededShuffle` could satisfy every case above
    // by doing nothing at all.
    const moved = [0, 1, 2, 3, 4].some((seed) => seededShuffle(ITEMS, seed).join('') !== ITEMS.join(''));
    expect(moved).toBe(true);
  });

  it('handles the empty and single-item cases', () => {
    expect(seededShuffle([], 1)).toEqual([]);
    expect(seededShuffle(['only'], 1)).toEqual(['only']);
  });
});
