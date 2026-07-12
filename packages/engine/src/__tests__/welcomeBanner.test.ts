import { isNewFromPlusButton } from '../welcomeBanner';
import { CompositionEntry, CompositionState } from '../types';

function makeEntry(overrides: Partial<CompositionEntry> = {}): CompositionEntry {
  return { id: '1', name: 'Untitled', ...overrides };
}

describe('isNewFromPlusButton', () => {
  it('returns true for a new file with no saved state and no flags', () => {
    expect(isNewFromPlusButton(makeEntry(), null)).toBe(true);
  });

  it('returns false when savedState is non-null', () => {
    const state = { id: '1', name: 'Untitled' } as Partial<CompositionState>;
    expect(isNewFromPlusButton(makeEntry(), state)).toBe(false);
  });

  it('returns false when entry is undefined', () => {
    expect(isNewFromPlusButton(undefined, null)).toBe(false);
  });

  it('returns false for isSample entries', () => {
    expect(isNewFromPlusButton(makeEntry({ isSample: true }), null)).toBe(false);
  });

  it('returns false for tentative entries', () => {
    expect(isNewFromPlusButton(makeEntry({ tentative: true }), null)).toBe(false);
  });

  it('returns false when sourceDynamicSampleId is set', () => {
    expect(isNewFromPlusButton(makeEntry({ sourceDynamicSampleId: 'abc' }), null)).toBe(false);
  });

  it('returns false when bannerText is set', () => {
    expect(isNewFromPlusButton(makeEntry({ bannerText: 'Do something' }), null)).toBe(false);
  });
});
