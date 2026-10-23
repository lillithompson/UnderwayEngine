import { PAGE_ID_PREFIX, collagePageId, isPageId, newPageId, ulid } from '../store/pageIds';

// Ids and page names. Three contracts here are load-bearing and none of them
// had a suite of its own before stage 6.2 — they were covered incidentally
// through entryStore's and homeState's tests in each app, which is how the
// monotonicity rule below could have been broken by a tidy without anything
// going red.

describe('ulid', () => {
  it('sorts lexicographically by when it was made', () => {
    // The whole reason for a ULID rather than a uuid: an entry index is a
    // sorted key scan, so creation order has to be string order.
    const a = ulid(Date.UTC(2026, 0, 1));
    const b = ulid(Date.UTC(2026, 5, 1));
    const c = ulid(Date.UTC(2027, 0, 1));
    expect([c, a, b].sort()).toEqual([a, b, c]);
  });

  it('is 26 Crockford base32 characters', () => {
    expect(ulid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('increments the tail within one millisecond instead of re-rolling it', () => {
    // Two pages made in the same millisecond must still sort in the order
    // they were made. Re-rolling the random tail would order them at random,
    // and an index scan would hand them back swapped.
    const t = Date.UTC(2026, 3, 7, 12, 0, 0);
    const ids = [ulid(t), ulid(t), ulid(t), ulid(t)];
    expect(new Set(ids).size).toBe(4);
    expect([...ids].sort()).toEqual(ids);
    // Same millisecond, so the time half is shared and only the tail moves.
    expect(new Set(ids.map((id) => id.slice(0, 10))).size).toBe(1);
  });

  it('keeps sorting when the clock steps backward', () => {
    // A device whose clock is corrected mid-session must not start minting
    // ids that sort before pages the user made earlier in the same session.
    const t = Date.UTC(2026, 3, 7, 12, 0, 0);
    const first = ulid(t);
    const afterStepBack = ulid(t - 60_000);
    expect(afterStepBack > first).toBe(true);
  });
});

describe('newPageId', () => {
  it('is the prefix and a ULID, so a page name sorts like its entry id', () => {
    const id = newPageId();
    expect(id.startsWith(PAGE_ID_PREFIX)).toBe(true);
    expect(isPageId(id)).toBe(true);
  });

  it('mints a fresh one every time', () => {
    expect(newPageId()).not.toBe(newPageId());
  });
});

describe('isPageId', () => {
  it('takes a prefix and 26 base32 characters, and nothing else', () => {
    expect(isPageId(`${PAGE_ID_PREFIX}0123456789ABCDEFGHJKMNPQRS`)).toBe(true);
    expect(isPageId('0123456789ABCDEFGHJKMNPQRS')).toBe(false);      // no prefix
    expect(isPageId(`${PAGE_ID_PREFIX}short`)).toBe(false);
    expect(isPageId(`${PAGE_ID_PREFIX}0123456789abcdefghjkmnpqrs`)).toBe(false); // lowercase
    // I, L, O and U are not in Crockford base32 — they read as 1, 1, 0, V.
    expect(isPageId(`${PAGE_ID_PREFIX}0123456789ABCDEFGHIKMNPQRS`)).toBe(false);
  });

  it('answers for an absent value rather than throwing', () => {
    // What an editor asks of a `?pageId=` that arrived on a URL.
    expect(isPageId(undefined)).toBe(false);
    expect(isPageId('')).toBe(false);
  });
});

describe('collagePageId', () => {
  it('is DERIVED, so every device that composes the same week agrees', () => {
    // The contract that makes a collage filed twice one page and never two.
    const a = collagePageId('2026-03-02', 'grp_1');
    const b = collagePageId('2026-03-02', 'grp_1');
    expect(a).toBe(b);
    expect(isPageId(a)).toBe(true);
  });

  it('is a different page per week, and per group', () => {
    const own = collagePageId('2026-03-02');
    expect(collagePageId('2026-03-09')).not.toBe(own);
    expect(collagePageId('2026-03-02', 'grp_1')).not.toBe(own);
    expect(collagePageId('2026-03-02', 'grp_1')).not.toBe(collagePageId('2026-03-02', 'grp_2'));
  });

  it('carries the week in the time half, so collages sort by week', () => {
    const weeks = ['2026-01-05', '2026-02-02', '2026-03-02'].map((w) => collagePageId(w));
    expect([...weeks].sort()).toEqual(weeks);
  });

  it('is stable across a clock change — the week is the only time it reads', () => {
    // Minted from the week's first day, not from now, which is what makes
    // two devices in two timezones agree.
    const before = collagePageId('2026-03-02', 'grp_1');
    const after = collagePageId('2026-03-02', 'grp_1');
    expect(before).toBe(after);
    expect(before.slice(PAGE_ID_PREFIX.length, PAGE_ID_PREFIX.length + 10))
      .toBe(after.slice(PAGE_ID_PREFIX.length, PAGE_ID_PREFIX.length + 10));
  });
});
