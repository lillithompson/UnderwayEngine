import {
  dayStartMs, entryImagesBehindPage, inImageWindow, isIssuedEntry,
} from '../store/entryRecord';

// The four questions every Underway app asks of a stored entry
// (store/entryRecord.ts, stage 6.2b). All four were byte-identical in
// CozyJournal's and DrawBots' copies, and each was tested only incidentally
// — through the app's own entry store or its home-state payload — which is
// the `pageIds.ts` shape 6.2a found: rules a tidy could break with
// everything green.
//
// All four are typed STRUCTURALLY, so each takes both an app's own record
// and the bridge's `HomeStateEntry`, whose stamps are optional. That is the
// property worth holding: a reader on either side of the bridge gets the
// same answer.

describe('isIssuedEntry — does this page own its day’s slot?', () => {
  it('is false for an imported page and for an unlisted one', () => {
    // An import is archive material and a one-off was minted by a tap;
    // either landing on a date that already has a real entry must not
    // shadow it, which is why every (formatId, issueDate) read guards here.
    expect(isIssuedEntry({})).toBe(true);
    expect(isIssuedEntry({ imported: true })).toBe(false);
    expect(isIssuedEntry({ unlisted: true })).toBe(false);
    expect(isIssuedEntry({ imported: false, unlisted: false })).toBe(true);
  });

  it('reads `unlisted` on a record that has no such field at all', () => {
    // Sol's record has neither field; CozyJournal's and DrawBots' have both.
    // The structural type is what lets one predicate serve all three.
    const solShaped: { imported?: boolean } = {};
    expect(isIssuedEntry(solShaped)).toBe(true);
  });
});

describe('dayStartMs — local midnight of an ISO day', () => {
  it('is midnight in the running timezone, not UTC', () => {
    const at = dayStartMs('2026-07-28');
    const d = new Date(at);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(28);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it('orders days, which is what every window below rests on', () => {
    expect(dayStartMs('2026-07-28')).toBeLessThan(dayStartMs('2026-07-29'));
    expect(dayStartMs('2025-12-31')).toBeLessThan(dayStartMs('2026-01-01'));
  });
});

describe('inImageWindow — is this page’s picture still worth shipping?', () => {
  const CUTOFF = '2026-07-01';

  it('is true for a page issued on or after the cutoff', () => {
    expect(inImageWindow({ issueDate: '2026-07-01' }, CUTOFF)).toBe(true);
    expect(inImageWindow({ issueDate: '2026-08-01' }, CUTOFF)).toBe(true);
    expect(inImageWindow({ issueDate: '2026-06-30' }, CUTOFF)).toBe(false);
  });

  it('…and for an OLD page edited since the cutoff', () => {
    // Cutting on the issue date alone left a freshly re-edited old page
    // with its thumb only. An edit is a deliberate act, so the window stays
    // bounded.
    expect(inImageWindow(
      { issueDate: '2025-01-01', updatedAt: dayStartMs('2026-07-15') }, CUTOFF,
    )).toBe(true);
    expect(inImageWindow(
      { issueDate: '2025-01-01', updatedAt: dayStartMs('2026-06-01') }, CUTOFF,
    )).toBe(false);
  });

  it('goes by the day alone when the stamp is absent', () => {
    // A page cached before the stamp rode the bridge has none.
    expect(inImageWindow({ issueDate: '2026-08-01' }, CUTOFF)).toBe(true);
    expect(inImageWindow({ issueDate: '2025-01-01' }, CUTOFF)).toBe(false);
  });
});

describe('entryImagesBehindPage — are the cached images an edit behind?', () => {
  it('is true when the page was saved after its images were drawn', () => {
    expect(entryImagesBehindPage({ pageSavedAt: 2000, imagesAt: 1000 })).toBe(true);
    expect(entryImagesBehindPage({ pageSavedAt: 1000, imagesAt: 2000 })).toBe(false);
    expect(entryImagesBehindPage({ pageSavedAt: 1000, imagesAt: 1000 })).toBe(false);
  });

  it('is false when the page has no SAVE stamp, however the images stand', () => {
    // A page imaged by a producer that writes its pictures directly — a
    // salvaged frame, a filed collage — carries no save stamp and is never
    // withheld.
    expect(entryImagesBehindPage({})).toBe(false);
    expect(entryImagesBehindPage({ imagesAt: 2000 })).toBe(false);
  });

  it('…but a page SAVED with no images drawn at all IS behind', () => {
    // The asymmetry is deliberate and is the one worth pinning: a page
    // saved by the editor's own queue and never imaged is work owed, so an
    // absent `imagesAt` reads as zero rather than as "nothing to do".
    expect(entryImagesBehindPage({ pageSavedAt: 2000 })).toBe(true);
  });
});
