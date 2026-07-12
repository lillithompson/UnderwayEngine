export interface LibraryFigureGroup {
  id: string;
  name: string;
  fileIds: string[];
}

const GROUP_NAME_RE = /^Group (\d+)$/;

export function nextLibraryGroupName(groups: LibraryFigureGroup[]): string {
  let max = 0;
  for (const g of groups) {
    const m = GROUP_NAME_RE.exec(g.name);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return `Group ${max + 1}`;
}

export function insertAfterInLibraryGroup(
  groups: LibraryFigureGroup[],
  anchorFileId: string,
  newFileId: string,
): LibraryFigureGroup[] {
  let changed = false;
  const result = groups.map(g => {
    const idx = g.fileIds.indexOf(anchorFileId);
    if (idx < 0 || g.fileIds.includes(newFileId)) return g;
    changed = true;
    const fileIds = [...g.fileIds];
    fileIds.splice(idx + 1, 0, newFileId);
    return { ...g, fileIds };
  });
  return changed ? result : groups;
}

export function pruneLibraryGroups(
  groups: LibraryFigureGroup[],
  validFileIds: Set<string>,
): LibraryFigureGroup[] {
  let changed = false;
  const result: LibraryFigureGroup[] = [];
  for (const g of groups) {
    const filtered = g.fileIds.filter(fid => validFileIds.has(fid));
    if (filtered.length === 0) {
      changed = true;
      continue;
    }
    if (filtered.length !== g.fileIds.length) {
      changed = true;
      result.push({ ...g, fileIds: filtered });
    } else {
      result.push(g);
    }
  }
  return changed ? result : groups;
}
