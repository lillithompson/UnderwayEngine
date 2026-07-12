import { isCompactWidth } from '../appLayout';

describe('isCompactWidth', () => {
  it('returns true for iPhone SE width (320)', () => {
    expect(isCompactWidth(320)).toBe(true);
  });

  it('returns true for iPhone Pro Max width (430)', () => {
    expect(isCompactWidth(430)).toBe(true);
  });

  it('returns true at 599 (just below threshold)', () => {
    expect(isCompactWidth(599)).toBe(true);
  });

  it('returns false at 600 (threshold)', () => {
    expect(isCompactWidth(600)).toBe(false);
  });

  it('returns false for iPad Mini portrait (744)', () => {
    expect(isCompactWidth(744)).toBe(false);
  });

  it('returns false for standard iPad portrait (810)', () => {
    expect(isCompactWidth(810)).toBe(false);
  });

  it('returns false for desktop width (1024)', () => {
    expect(isCompactWidth(1024)).toBe(false);
  });
});
