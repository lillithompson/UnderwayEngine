// Pure rename resolution for the outline's RenameModal. Mirrors the
// engine's renameModalLogic.resolveRename exactly, re-implemented here so
// @underway/editor-ui carries no engine dependency (the whole package is
// project-agnostic). Trim; empty reverts to original; unchanged is a no-op.

export interface RenameResult {
  committed: boolean;
  name: string;
}

export function resolveRename(editing: string, original: string): RenameResult {
  const trimmed = editing.trim();
  if (trimmed.length === 0) return { committed: false, name: original };
  if (trimmed === original) return { committed: false, name: original };
  return { committed: true, name: trimmed };
}
