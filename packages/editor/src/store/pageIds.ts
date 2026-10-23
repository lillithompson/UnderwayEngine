// Ids and page NAMES, in one place both sides of an app read: the WebView's
// store mints them where a page is made, and the app's own side mints one
// for a page from before names the first time an act shares it, and derives
// a collage's (CozyJournal's docs/explicit_sharing.md §8 Phase 5). Pure —
// no storage, nothing of any app — so a native bundle can import it.
//
// The ULID minter below was byte-identical in all three apps; the page-NAME
// half was byte-identical in CozyJournal's and DrawBots' and absent from
// Sol's, which has no page names.

/** The prefix every page id wears (an entry's `pageId`) — one grammar with
 *  an app's server (backend validation.PageIdSchema). Here rather than in an
 *  app's store types because `newPageId` below is what spells it, and the
 *  two cannot be allowed to disagree; each app's `web/store/types.ts`
 *  re-exports it, as `theme.ts` re-exports the canvas colours (§5a). */
export const PAGE_ID_PREFIX = 'pg_';

/** Is this a page id as {@link PAGE_ID_PREFIX} and a ULID spell one? What
 *  an editor asks of a `?pageId=` that arrived on a URL before adopting
 *  it, and what a server asks of every upload. */
export function isPageId(raw: string | undefined): raw is string {
  return typeof raw === 'string' && /^pg_[0-9A-HJKMNP-TV-Z]{26}$/.test(raw);
}

// ── ULID-style ids ──────────────────────────────────────────────────
// Monotonic sortable id: 48-bit ms timestamp (10 chars Crockford base32)
// + 80 bits of randomness (16 chars). Within the same millisecond (or if
// the clock steps backward) the random tail is incremented instead of
// re-rolled, so lexicographic order always matches creation order.
// Tiny local implementation — ids are per-device, not security tokens,
// so Math.random entropy is fine and no dependency is warranted.

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RAND_LEN = 16;

let lastTime = -1;
let lastRand: number[] = [];

function encodeTime(ms: number): string {
  let out = '';
  for (let i = 9; i >= 0; i--) {
    out = B32[ms % 32] + out;
    ms = Math.floor(ms / 32);
  }
  return out;
}

export function ulid(now: number = Date.now()): string {
  if (now <= lastTime) {
    // Same ms (or clock regression): bump the random tail with carry so
    // the id still sorts after the previous one.
    for (let i = RAND_LEN - 1; i >= 0; i--) {
      if (lastRand[i] < 31) {
        lastRand[i]++;
        break;
      }
      lastRand[i] = 0;
    }
    now = lastTime;
  } else {
    lastTime = now;
    lastRand = Array.from({ length: RAND_LEN }, () => Math.floor(Math.random() * 32));
  }
  return encodeTime(now) + lastRand.map((d) => B32[d]).join('');
}

/**
 * A fresh page NAME (JournalEntry.pageId): the prefix and a ULID, so a
 * page's name sorts by when it was made like its entry id does. Minted
 * once, where a page is MADE — or, for a page from before names, by the
 * act that first shares it (friendsStore), when the server holds no copy
 * of it to name it by (docs/explicit_sharing.md §8 Phase 5).
 */
export function newPageId(): string {
  return PAGE_ID_PREFIX + ulid();
}

/** FNV-1a over a string, from `seed` — 32 bits, stable everywhere. */
function fnv1a(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * A week's collage's page NAME, DERIVED rather than minted — like its
 * entry id (types.collageEntryId) — so every device that composes the same
 * week (for the same group, or none) names the same page, and a collage
 * filed twice is one page, never two (docs/explicit_sharing.md §8 Phase 5).
 * ULID-shaped: the week's first day as the time, and 80 bits of hash of
 * which week and whose group as the tail.
 */
export function collagePageId(weekStart: string, groupId?: string): string {
  const key = `collage|${weekStart}|${groupId ?? ''}`;
  const bits = [fnv1a(key, 0x811c9dc5), fnv1a(key, 0x01000193), fnv1a(key, 0x9e3779b9)];
  let tail = '';
  for (let i = 0; i < RAND_LEN; i++) {
    // Five bits at a time from the 96 the three hashes hold.
    const at = i * 5;
    const word = bits[Math.floor(at / 32)];
    const next = bits[Math.floor(at / 32) + 1] ?? 0;
    const shift = at % 32;
    const five = shift <= 27 ? (word >>> (27 - shift)) & 31 : ((word << (shift - 27)) | (next >>> (59 - shift))) & 31;
    tail += B32[five];
  }
  return PAGE_ID_PREFIX + encodeTime(Date.parse(`${weekStart}T00:00:00Z`)) + tail;
}
