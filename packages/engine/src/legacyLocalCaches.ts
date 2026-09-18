/**
 * The legacy `local*` caches, and the one place that strips them.
 *
 * A grouped leaf in the ≤v61 model stores its pose twice: the world
 * fields that were drawn, and `local*` caches meant to re-derive them
 * through the group chain. Nothing kept the two honest, so real saved
 * files ship with caches that disagree — `Castle.tile` on all 318 of its
 * grouped leaves, one path in `WaveBug.tile` by 65 cells — and any pass
 * that materialises a member from its locals then MOVES it. World is the
 * truth, so world is what survives; `sceneGraph.fromLegacy` derives a
 * node's local transform from world alone and never wanted them.
 *
 * `identity*` is deliberately NOT in this list. It is not a group-local
 * cache but the transform cycle's memory of the authored pose
 * (`transformCycleStep`), which a figure needs to come back round to
 * where it started.
 *
 * (`compositionOps.detachFromGroup` is a different job — it is what
 * UNGROUP does, and clears `groupId`, the world orientation and the
 * cycle's identity snapshot.)
 *
 * P6-B has since removed most of these fields from `types.ts` outright, so
 * this list is now mostly a DRIFT GUARD: `loaderDropsLocals` checks it
 * against every `local*` a leaf interface declares, and a new one added to
 * an interface and to nothing else fails there rather than riding through
 * the loader. `localSegments` / `localSubpaths` are the two that remain
 * real — they are ambiguous (the SceneNode ones belong to the GRAPH) and
 * were never P6-B's to take.
 */

/** Every `local*` field the leaf interfaces in `types.ts` declare. */
export const LOCAL_CACHE_FIELDS = [
  'localCellX', 'localCellY', 'localCellWidth', 'localCellHeight',
  'localRotation', 'localMirrorH', 'localMirrorV', 'localAngleDeg',
  'localQuads', 'localSegments', 'localSubpaths',
  'localTileWidthL0', 'localTileHeightL0',
  'localTileOffsetXL0', 'localTileOffsetYL0',
] as const;

/** Strip every `local*` cache from one leaf, in place. */
export function dropLocalCaches(leaf: object): void {
  const l = leaf as Record<string, unknown>;
  for (const f of LOCAL_CACHE_FIELDS) {
    if (l[f] !== undefined) l[f] = undefined;
  }
}
