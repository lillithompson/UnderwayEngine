/**
 * In-memory record of tentative-copy compIds whose first content edit has
 * fired this session. The editor marks the comp synchronously when its
 * first-content-edit effect runs; the storage write that clears the
 * persistent `tentative` flag happens async. The Compositions-list
 * cleanup consults this set so a user who edits and immediately backs out
 * doesn't lose their copy to the storage-write race.
 *
 * Cleared on cold start (module re-evaluation). No persistence.
 */

const confirmed = new Set<string>();

export function markTentativeEditConfirmed(compId: string): void {
  confirmed.add(compId);
}

export function isTentativeEditConfirmed(compId: string): boolean {
  return confirmed.has(compId);
}

export function __resetForTests(): void {
  confirmed.clear();
}
