import type { CompositionFigure, SVGObject, ImageObject, GroupNode } from './types';
import { deriveSceneOrderFromKindArrays, clonePathSegment, safeMapSegments, backfillMissingLocals } from './compositionOps';

export interface MergeTileResult {
  figures: CompositionFigure[];
  svgObjects: SVGObject[];
  images: ImageObject[];
  imageBlobs: Record<string, Uint8Array>;
  groups: GroupNode[];
  /** New IDs in the source's relative paint order. */
  sceneOrder: string[];
  /** Imported figure file IDs (new IDs after remap) for library registration. */
  importedFileIds: string[];
}

let _counter = 0;
function freshId(): string {
  return Date.now().toString() + '_m' + (++_counter).toString(36);
}

function remapFigures(
  figures: CompositionFigure[],
  fileIdRemap: Map<string, string>,
  groupIdRemap: Map<string, string>,
): { remapped: CompositionFigure[]; idRemap: Map<string, string> } {
  const idRemap = new Map<string, string>();
  const remapped = figures.map(fig => {
    const newId = freshId();
    idRemap.set(fig.id, newId);

    const updated: CompositionFigure = { ...fig, id: newId, locked: undefined };

    if (updated.fileId && fileIdRemap.has(updated.fileId)) {
      const oldFileId = updated.fileId;
      const newFileId = fileIdRemap.get(oldFileId)!;
      updated.fileId = newFileId;
      updated.figureKey = updated.figureKey.replace(oldFileId, newFileId);
    }

    if (updated.groupId && groupIdRemap.has(updated.groupId)) {
      updated.groupId = groupIdRemap.get(updated.groupId)!;
    }

    return updated;
  });
  return { remapped, idRemap };
}

function remapSVGs(
  svgObjects: SVGObject[],
  groupIdRemap: Map<string, string>,
): { remapped: SVGObject[]; idRemap: Map<string, string> } {
  const idRemap = new Map<string, string>();
  const remapped = svgObjects.map(svg => {
    const newId = 'svg_' + freshId();
    idRemap.set(svg.id, newId);

    const updated: SVGObject = { ...svg, id: newId, locked: undefined };

    if (updated.groupId && groupIdRemap.has(updated.groupId)) {
      updated.groupId = groupIdRemap.get(updated.groupId)!;
    }

    return updated;
  });
  return { remapped, idRemap };
}

function remapImages(
  images: ImageObject[],
  sourceBlobs: Record<string, Uint8Array>,
  groupIdRemap: Map<string, string>,
): { remapped: ImageObject[]; idRemap: Map<string, string>; imageIdRemap: Map<string, string>; blobs: Record<string, Uint8Array> } {
  const idRemap = new Map<string, string>();
  const imageIdRemap = new Map<string, string>();
  const blobs: Record<string, Uint8Array> = {};

  const remapped = images.map(img => {
    const newId = 'img_' + freshId();
    idRemap.set(img.id, newId);

    // Deduplicate: multiple ImageObjects can share one imageId (and,
    // independently, one originalImageId). Remap and copy both blobs.
    // Storage keys get the imgblob_ prefix via imgBlobKey, so an img_
    // id here stays out of the blob-key namespace.
    for (const srcId of [img.imageId, img.originalImageId]) {
      if (srcId == null || imageIdRemap.has(srcId)) continue;
      const newBlobId = 'img_' + freshId();
      imageIdRemap.set(srcId, newBlobId);
      if (sourceBlobs[srcId]) {
        blobs[newBlobId] = sourceBlobs[srcId];
      }
    }

    const updated: ImageObject = {
      ...img,
      id: newId,
      imageId: imageIdRemap.get(img.imageId)!,
      locked: undefined,
    };
    if (img.originalImageId != null) {
      updated.originalImageId = imageIdRemap.get(img.originalImageId)!;
    }

    if (updated.groupId && groupIdRemap.has(updated.groupId)) {
      updated.groupId = groupIdRemap.get(updated.groupId)!;
    }

    return updated;
  });
  return { remapped, idRemap, imageIdRemap, blobs };
}

function remapGroups(groups: GroupNode[]): { remapped: GroupNode[]; idRemap: Map<string, string> } {
  const idRemap = new Map<string, string>();
  // First pass: mint new IDs
  for (const g of groups) {
    idRemap.set(g.id, freshId() + '_g');
  }
  // Second pass: remap parentGroupId references
  const remapped = groups.map(g => {
    // Drop the group's inherited lock on merge, mirroring how leaf `locked` is
    // cleared above — pasted/imported content lands unlocked.
    const updated: GroupNode = { ...g, id: idRemap.get(g.id)!, locked: undefined };
    if (updated.parentGroupId && idRemap.has(updated.parentGroupId)) {
      updated.parentGroupId = idRemap.get(updated.parentGroupId)!;
    }
    return updated;
  });
  return { remapped, idRemap };
}

function buildSceneOrder(
  sourceSceneOrder: string[] | undefined,
  figures: CompositionFigure[],
  svgObjects: SVGObject[],
  images: ImageObject[],
  allIdRemap: Map<string, string>,
): string[] {
  if (sourceSceneOrder && sourceSceneOrder.length > 0) {
    return sourceSceneOrder
      .map(id => allIdRemap.get(id))
      .filter((id): id is string => id != null);
  }
  // Older bundles without sceneOrder: derive from kind arrays
  return deriveSceneOrderFromKindArrays({ figures, svgObjects, images });
}

function wrapInGroup(
  figures: CompositionFigure[],
  svgObjects: SVGObject[],
  images: ImageObject[],
  groups: GroupNode[],
  wrapperName: string,
): { figures: CompositionFigure[]; svgObjects: SVGObject[]; images: ImageObject[]; groups: GroupNode[] } {
  if (figures.length === 0 && svgObjects.length === 0 && images.length === 0 && groups.length === 0) {
    return { figures, svgObjects, images, groups };
  }

  const wrapperGroupId = freshId() + '_g';
  const wrapperGroup: GroupNode = {
    id: wrapperGroupId,
    name: wrapperName,
    translateX: 0, translateY: 0,
    scaleX: 1, scaleY: 1,
    rotation: 0, mirrorH: false, mirrorV: false,
  };

  // Nest root imported groups under the wrapper
  const groupIdSet = new Set(groups.map(g => g.id));
  const wrappedGroups = groups.map(g => {
    const isRoot = !g.parentGroupId || !groupIdSet.has(g.parentGroupId);
    return isRoot ? { ...g, parentGroupId: wrapperGroupId } : g;
  });

  // Assign ungrouped figures to the wrapper with local = world coords
  const wrappedFigures = figures.map(fig => {
    if (fig.groupId) return fig;
    return {
      ...fig,
      groupId: wrapperGroupId,
      localCellX: fig.cellX,
      localCellY: fig.cellY,
      localCellWidth: fig.cellWidth,
      localCellHeight: fig.cellHeight,
      localRotation: fig.rotation ?? 0,
      localMirrorH: fig.mirrorH ?? false,
      localMirrorV: fig.mirrorV ?? false,
      localTileWidthL0: fig.tileMode === 'repeat' ? fig.tileWidthL0 : undefined,
      localTileHeightL0: fig.tileMode === 'repeat' ? fig.tileHeightL0 : undefined,
      localTileOffsetXL0: fig.tileMode === 'repeat' ? fig.tileOffsetXL0 : undefined,
      localTileOffsetYL0: fig.tileMode === 'repeat' ? fig.tileOffsetYL0 : undefined,
      localQuads: fig.quads?.map(q => ({ ...q })),
    };
  });

  // Assign ungrouped SVGs to the wrapper with deep-cloned localSegments
  const wrappedSVGs = svgObjects.map(svg => {
    if (svg.groupId) return svg;
    return {
      ...svg,
      groupId: wrapperGroupId,
      localSegments: safeMapSegments(svg.segments, clonePathSegment) ?? [],
      localCellX: svg.cellX,
      localCellY: svg.cellY,
      localCellWidth: svg.cellWidth,
      localCellHeight: svg.cellHeight,
    };
  });

  // Assign ungrouped images to the wrapper
  const wrappedImages = images.map(img => {
    if (img.groupId) return img;
    return {
      ...img,
      groupId: wrapperGroupId,
      localCellX: img.cellX,
      localCellY: img.cellY,
      localCellWidth: img.cellWidth,
      localCellHeight: img.cellHeight,
    };
  });

  return {
    figures: wrappedFigures,
    svgObjects: wrappedSVGs,
    images: wrappedImages,
    groups: [wrapperGroup, ...wrappedGroups],
  };
}

/**
 * Decompress and deserialize a .tile file, import its embedded figure
 * files into storage, and return remapped items ready to merge into the
 * current composition.
 */
export async function prepareTileMerge(data: Uint8Array, fileName?: string): Promise<MergeTileResult> {
  const { decompressTile } = await import('./tileIO');
  const { deserializeComposition } = await import('./compositionBinaryFormat');
  const { importEmbeddedFigureFiles } = await import('./persistence');

  const payload = await decompressTile(data);
  const { meta, embeddedFiles } = deserializeComposition(payload);

  // Import embedded figure files (sequential to avoid OOM)
  const fileIdRemap = await importEmbeddedFigureFiles(embeddedFiles);

  // Remap groups first (other items reference groupId)
  const groups = remapGroups(meta.groups ?? []);

  // Remap scene objects
  const figures = remapFigures(meta.figures, fileIdRemap, groups.idRemap);
  const svgs = remapSVGs(meta.svgObjects ?? [], groups.idRemap);
  const imgs = remapImages(meta.images ?? [], meta.imageBlobs ?? {}, groups.idRemap);

  // Build combined ID remap for scene order
  const allIdRemap = new Map<string, string>();
  for (const [old, nw] of figures.idRemap) allIdRemap.set(old, nw);
  for (const [old, nw] of svgs.idRemap) allIdRemap.set(old, nw);
  for (const [old, nw] of imgs.idRemap) allIdRemap.set(old, nw);

  const sceneOrder = buildSceneOrder(
    meta.sceneOrder,
    figures.remapped,
    svgs.remapped,
    imgs.remapped,
    allIdRemap,
  );

  // Wrap all imported content under a single named group
  const wrapperName = fileName
    ? fileName.replace(/\.tile$/i, '').replace(/[_-]/g, ' ').trim() || 'Imported'
    : meta.name || 'Imported';

  const wrapped = wrapInGroup(
    figures.remapped,
    svgs.remapped,
    imgs.remapped,
    groups.remapped,
    wrapperName,
  );

  // Backfill missing local orientation/tile/segment fields so that
  // subsequent materializeGroupMembers calls produce correct world coords.
  // Without this, localRotation etc. stay undefined for already-grouped
  // items deserialized from the binary format, causing rotation/mirror
  // corruption when the wrapper group is later transformed.
  const backfilled = backfillMissingLocals(wrapped.figures, wrapped.svgObjects);

  return {
    figures: backfilled.figures,
    svgObjects: backfilled.svgObjects,
    images: wrapped.images,
    imageBlobs: imgs.blobs,
    groups: wrapped.groups,
    sceneOrder,
    importedFileIds: [...fileIdRemap.values()],
  };
}
