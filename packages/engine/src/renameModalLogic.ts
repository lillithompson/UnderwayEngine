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
