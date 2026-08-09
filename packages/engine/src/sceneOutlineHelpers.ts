import type { CompositionFigure } from './types';
import type { PaletteItem } from './figures';

/**
 * The figures shown in the Scene Outliner's Figures tab: palette items
 * confined to this composition — figures placed in it (or otherwise imported,
 * captured by `visibleFileIds`) plus imported SVG designs. The pattern-fill
 * picker reuses this so its contents are identical to the Figures tab.
 */
export function computeLibraryFigures(
  paletteItems: PaletteItem[],
  visibleFileIds: ReadonlySet<string>,
  importedSVGDesignIds?: ReadonlySet<string>,
): PaletteItem[] {
  return paletteItems.filter((f) =>
    (f.fileId != null && visibleFileIds.has(f.fileId)) ||
    (f.svgDesignId != null && (importedSVGDesignIds?.has(f.svgDesignId) ?? false)),
  );
}

/**
 * Return the set of fileIds present in libFigures but not referenced
 * by any placed composition figure.
 */
export function computeUnplacedFileIds(
  libFigures: Pick<PaletteItem, 'fileId'>[],
  placedFigures: Pick<CompositionFigure, 'fileId'>[],
): Set<string> {
  const placedFileIds = new Set<string>();
  for (const f of placedFigures) {
    if (f.fileId) placedFileIds.add(f.fileId);
  }
  const unplaced = new Set<string>();
  for (const f of libFigures) {
    if (f.fileId && !placedFileIds.has(f.fileId)) {
      unplaced.add(f.fileId);
    }
  }
  return unplaced;
}

const FIGURE_NAME_RE = /^Figure (\d+)$/;
const PATTERN_NAME_RE = /^Pattern (\d+)$/;
const GROUP_NAME_RE = /^Group (\d+)$/;

/**
 * Return the next available name given existing figures.
 * @param prefix - 'Figure' for create-tool items, 'Pattern' for block/pattern-tool items.
 */
export function nextFigureName(figures: CompositionFigure[], prefix: 'Figure' | 'Pattern' = 'Figure'): string {
  const re = prefix === 'Pattern' ? PATTERN_NAME_RE : FIGURE_NAME_RE;
  let max = 0;
  for (const f of figures) {
    if (f.name) {
      const m = re.exec(f.name);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
  }
  return `${prefix} ${max + 1}`;
}

/**
 * Return the next available group name given existing figures.
 *
 * A group's display name lives on its first member, which is why the figures
 * carry it — but a scene whose objects are svgs, images or texts has no figure
 * holding it, and every group would come back "Group 1". Pass `groups` (the
 * GroupNodes, which each carry `name` too) so those scenes number as well.
 */
export function nextGroupName(
  figures: CompositionFigure[],
  groups?: readonly { name?: string }[],
): string {
  let max = 0;
  const consider = (name: string | undefined) => {
    if (!name) return;
    const m = GROUP_NAME_RE.exec(name);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  };
  for (const f of figures) consider(f.name);
  for (const g of groups ?? []) consider(g.name);
  return `Group ${max + 1}`;
}

/**
 * Derive a human-readable display name for a composition figure.
 * Uses the palette label if available, otherwise humanizes the figureKey.
 */
export function computeFigureDisplayName(
  figure: CompositionFigure,
  paletteItems: PaletteItem[],
): string {
  if (figure.name) return figure.name;

  const item = paletteItems.find((p) => p.key === figure.figureKey)
    ?? (figure.fileId ? paletteItems.find((p) => p.fileId === figure.fileId) : undefined);
  if (item) return item.label;

  const key = figure.figureKey;

  // file_<fileId>_L<level> → "Figure <short id>"
  if (key.startsWith('file_')) {
    const parts = key.split('_');
    const fileId = parts[1] ?? '';
    return `Figure ${fileId.slice(0, 6)}`;
  }

  // paint_<id> → "Painted mesh"
  if (key.startsWith('paint_')) return 'Painted mesh';

  // Fallback: replace underscores/hyphens with spaces, title-case
  return key
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
