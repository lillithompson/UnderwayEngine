import { omitKeys } from '../omitKeys';

describe('omitKeys', () => {
  it('returns a copy without the keys, leaving the original untouched', () => {
    const queue = { a: 1, b: 2, c: 3 };
    const next = omitKeys(queue, ['a', 'c']);
    expect(next).toEqual({ b: 2 });
    expect(queue).toEqual({ a: 1, b: 2, c: 3 });
    expect(next).not.toBe(queue);
  });

  it('drops the key outright — absent, not undefined — and ignores a key that is not there', () => {
    const effects: { glow?: number; border?: number } = { glow: 1, border: 2 };
    const next = omitKeys(effects, ['glow']);
    expect('glow' in next).toBe(false);
    expect(omitKeys<Record<string, number>>({ x: 1 }, ['missing'])).toEqual({ x: 1 });
  });

  it('still copies when there is nothing to drop', () => {
    const map = { x: 1 };
    const next = omitKeys(map, []);
    expect(next).toEqual(map);
    expect(next).not.toBe(map);
  });
});
