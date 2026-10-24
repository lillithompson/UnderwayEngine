// Deterministic PRNG primitives — the seeding behind anything that has to
// come out the same twice: a day's generated content, a scattered word
// layout, a printed pattern fill's signature, a simulation's tile roll.
//
// Here in the engine rather than in an app because it was two copies of one
// file: CozyJournal's `web/content/seededRandom.ts` and DrawBots'
// `web/formats/seededRandom.ts` were byte-identical but for a two-line header
// (docs/shared-editor.md §4.2 item 6, stage 6.3d, where the editor package's
// own `formats/edited.ts` came to need `fnv1a32`). Sol has no copy and gains
// one unused, the arrangement stage 5a made for the canvas leaves it ships
// without a tool for.
//
// A dependency-free LEAF, and that is load-bearing in CozyJournal: its
// `dailyContent.ts` imports `squiggle.ts` to assemble the 'squiggle' issue
// and `squiggle.ts` needs these same primitives, so importing them back from
// `dailyContent` formed a require cycle (dailyContent → squiggle →
// dailyContent). Under Metro's lazy web bundle that cycle is order-dependent:
// on a cold editor-chunk load the squiggle exports could still be
// uninitialized when `getIssue` called them, so issue resolution threw and
// the editor silently fell back to its no-save "Freeform canvas" route — the
// "web never saves" bug. Housing the shared primitives where both sides
// import them removes the back-edge entirely.

/** FNV-1a's 32-bit offset basis — where a hash starts when nothing says
 *  otherwise. */
export const FNV1A32_OFFSET_BASIS = 0x811c9dc5;

/**
 * 32-bit FNV-1a hash of a string (stable across platforms), from `seed`.
 *
 * `seed` exists for a caller that wants several independent hashes of the
 * SAME string — `store/pageIds.ts`'s `collagePageId` takes three, for the
 * eighty bits of tail a derived page id needs. Left out, it is the standard
 * offset basis, which is what every other caller means by "the" FNV-1a hash
 * of a string.
 */
export function fnv1a32(str: string, seed: number = FNV1A32_OFFSET_BASIS): number {
  let hash = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // hash *= 16777619, in 32-bit space without BigInt.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32: tiny deterministic PRNG. Returns a () => [0, 1) stream. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle driven by mulberry32(seed). Pure — returns a copy. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice();
  const rng = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
