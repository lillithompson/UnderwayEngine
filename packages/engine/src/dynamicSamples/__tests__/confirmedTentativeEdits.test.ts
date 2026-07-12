import {
  __resetForTests,
  isTentativeEditConfirmed,
  markTentativeEditConfirmed,
} from '../confirmedTentativeEdits';

describe('confirmedTentativeEdits', () => {
  beforeEach(() => {
    __resetForTests();
  });

  it('returns false for an unknown id', () => {
    expect(isTentativeEditConfirmed('comp-a')).toBe(false);
  });

  it('returns true after marking', () => {
    markTentativeEditConfirmed('comp-a');
    expect(isTentativeEditConfirmed('comp-a')).toBe(true);
  });

  it('isolates entries per id', () => {
    markTentativeEditConfirmed('comp-a');
    expect(isTentativeEditConfirmed('comp-b')).toBe(false);
  });

  it('mark is idempotent', () => {
    markTentativeEditConfirmed('comp-a');
    markTentativeEditConfirmed('comp-a');
    expect(isTentativeEditConfirmed('comp-a')).toBe(true);
  });

  it('__resetForTests clears state', () => {
    markTentativeEditConfirmed('comp-a');
    __resetForTests();
    expect(isTentativeEditConfirmed('comp-a')).toBe(false);
  });
});
