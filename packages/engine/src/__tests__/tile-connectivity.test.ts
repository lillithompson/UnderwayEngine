import {
  getCandidatesWithConnectionCount,
  getCandidatesWithExactConnections,
  getCandidatesWithTwoConnectionsOneBeing,
} from '../tile-connectivity';

describe('getCandidatesWithConnectionCount', () => {
  test('returns candidates with exactly 0 connections', () => {
    const candidates = getCandidatesWithConnectionCount(0);
    expect(candidates.length).toBeGreaterThan(0);
  });

  test('returns candidates with exactly 1 connection', () => {
    const candidates = getCandidatesWithConnectionCount(1);
    expect(candidates.length).toBeGreaterThan(0);
  });

  test('returns candidates with exactly 2 connections', () => {
    const candidates = getCandidatesWithConnectionCount(2);
    expect(candidates.length).toBeGreaterThan(0);
  });

  test('returns empty for 9 connections (impossible)', () => {
    const candidates = getCandidatesWithConnectionCount(9);
    expect(candidates.length).toBe(0);
  });
});

describe('getCandidatesWithTwoConnectionsOneBeing', () => {
  test('returns candidates with 2 connections including N', () => {
    const candidates = getCandidatesWithTwoConnectionsOneBeing(0); // N
    expect(candidates.length).toBeGreaterThan(0);
  });

  test('returns candidates with 2 connections including E', () => {
    const candidates = getCandidatesWithTwoConnectionsOneBeing(2); // E
    expect(candidates.length).toBeGreaterThan(0);
  });
});

describe('getCandidatesWithExactConnections', () => {
  test('empty required dirs returns 0-connection candidates', () => {
    const candidates = getCandidatesWithExactConnections([]);
    expect(candidates.length).toBeGreaterThan(0);
  });
});
