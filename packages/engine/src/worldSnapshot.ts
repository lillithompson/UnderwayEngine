/**
 * World-space snapshot harness (transform refactor guardrail).
 *
 * Emits a stable, human-diffable description of *what the user sees*: the
 * world bbox, orientation and world geometry of every leaf in a
 * `CompositionState`. Nothing about how that pose is stored — no `local*`
 * caches, no `identity*` stashes, no group transforms — appears here.
 *
 * That is the whole point. The transform refactor replaces the storage
 * (world fields on every leaf) with a scene graph (local transform per
 * node, world derived). A snapshot taken before the change and compared
 * after it is the proof that the rendered result did not move.
 *
 * Usage in tests:
 *
 * ```ts
 * expect(worldSnapshotText(state)).toMatchSnapshot();
 * // or, across a refactor boundary:
 * expect(worldSnapshot(after)).toEqual(worldSnapshot(before));
 * ```
 */

import type { CompItemKind } from './types';
import type {
  CompositionState, CompositionFigure, SVGObject, ImageObject,
  TextObject, PaintObject, PatternObject, PathSegment,
} from './types';

// ── Types ──────────────────────────────────────────────────────────────

/** One leaf's rendered pose, storage-independent. */
export interface LeafWorldSnapshot {
  id: string;
  kind: CompItemKind;
  /** Owning group id, or undefined at top level. Structure, not pose —
   *  included because a leaf changing groups is not a no-op refactor. */
  groupId?: string;
  /** World bbox as [x, y, width, height] in L0 cells. */
  bbox: [number, number, number, number];
  /** Discrete quarter turn, omitted when 0. */
  rotation?: 90 | 180 | 270;
  mirrorH?: boolean;
  mirrorV?: boolean;
  /** Continuous rotation about the bbox centre, omitted when absent/0. */
  angleDeg?: number;
  /** World path geometry, svg kind only. */
  segments?: string;
  /** Sub-path geometry when an svg carries more than one colour. */
  subpaths?: string[];
  /** Pattern grid shape and tile pitch/offset, pattern kind only. */
  pattern?: string;
  /** Tile pitch/offset for repeat-mode figures and svgs. */
  tile?: string;
}

// ── Quantisation ───────────────────────────────────────────────────────

/**
 * Round to 1e-6 so float noise from a different-but-equivalent order of
 * operations does not fail a comparison, while a real half-cell drift
 * (the §2.3 rounding bug) still does. `|| 0` folds -0 into 0.
 */
function q(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return 0;
  return Math.round(n * 1e6) / 1e6 || 0;
}

function qPair(p: readonly [number, number]): string {
  return `${q(p[0])},${q(p[1])}`;
}

/** Compact one path segment. Arcs carry their centre, lines do not. */
function segText(seg: PathSegment): string {
  return seg.kind === 'arc'
    ? `A ${qPair(seg.start)} ${qPair(seg.center)} ${qPair(seg.end)}`
    : `L ${qPair(seg.start)} ${qPair(seg.end)}`;
}

function segsText(segments: ReadonlyArray<PathSegment> | undefined): string {
  return (segments ?? []).map(segText).join(' ');
}

function tileText(n: {
  tileMode?: 'repeat';
  tileWidthL0?: number; tileHeightL0?: number;
  tileOffsetXL0?: number; tileOffsetYL0?: number;
}): string | undefined {
  if (n.tileMode !== 'repeat') return undefined;
  return `repeat ${q(n.tileWidthL0)}x${q(n.tileHeightL0)} @${q(n.tileOffsetXL0)},${q(n.tileOffsetYL0)}`;
}

// ── Per-leaf capture ───────────────────────────────────────────────────

/** Fields every leaf kind carries in world space. */
interface WorldPosed {
  id: string;
  groupId?: string;
  cellX: number; cellY: number; cellWidth: number; cellHeight: number;
  rotation?: 0 | 90 | 180 | 270;
  mirrorH?: boolean; mirrorV?: boolean;
  angleDeg?: number;
}

function basePose(kind: CompItemKind, n: WorldPosed): LeafWorldSnapshot {
  const snap: LeafWorldSnapshot = {
    id: n.id,
    kind,
    bbox: [q(n.cellX), q(n.cellY), q(n.cellWidth), q(n.cellHeight)],
  };
  if (n.groupId) snap.groupId = n.groupId;
  if (n.rotation) snap.rotation = n.rotation;
  if (n.mirrorH) snap.mirrorH = true;
  if (n.mirrorV) snap.mirrorV = true;
  // A 360-multiple angle renders identically to none; normalise so the
  // "angle became undefined" regression (§2.1 scenario B) still shows.
  const angle = q(n.angleDeg);
  if (angle !== 0) snap.angleDeg = angle;
  return snap;
}

function figureSnap(f: CompositionFigure): LeafWorldSnapshot {
  const snap = basePose('figure', f);
  const tile = tileText(f);
  if (tile) snap.tile = tile;
  return snap;
}

function svgSnap(s: SVGObject): LeafWorldSnapshot {
  const snap = basePose('svg', s);
  snap.segments = segsText(s.segments);
  if (s.subpaths && s.subpaths.length > 0) {
    snap.subpaths = s.subpaths.map((sp) => segsText(sp.segments));
  }
  const tile = tileText(s);
  if (tile) snap.tile = tile;
  return snap;
}

function patternSnap(p: PatternObject): LeafWorldSnapshot {
  const snap = basePose('pattern', p);
  // Cell contents are content, not pose; a count is enough to catch a
  // grid being rebuilt, and keeps the snapshot readable for big patterns.
  snap.pattern = `${p.cols}x${p.rows} cells=${p.cells?.length ?? 0}`;
  const tile = tileText(p);
  if (tile) snap.tile = tile;
  return snap;
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Snapshot every leaf's world pose, ordered by `sceneOrder` (back→front)
 * with any leaf missing from `sceneOrder` appended in array order so a
 * broken scene order still produces a comparable snapshot rather than
 * silently dropping nodes.
 */
export function worldSnapshot(state: CompositionState): LeafWorldSnapshot[] {
  const byId = new Map<string, LeafWorldSnapshot>();
  const order: string[] = [];

  const add = (snap: LeafWorldSnapshot) => {
    byId.set(snap.id, snap);
    order.push(snap.id);
  };

  for (const f of state.figures ?? []) add(figureSnap(f));
  for (const s of state.svgObjects ?? []) add(svgSnap(s));
  for (const i of (state.images ?? []) as ImageObject[]) add(basePose('image', i));
  for (const t of (state.texts ?? []) as TextObject[]) add(basePose('text', t));
  for (const p of (state.paintObjects ?? []) as PaintObject[]) add(basePose('paint', p));
  for (const p of state.patternObjects ?? []) add(patternSnap(p));

  const out: LeafWorldSnapshot[] = [];
  const seen = new Set<string>();
  for (const id of state.sceneOrder ?? []) {
    const snap = byId.get(id);
    if (snap && !seen.has(id)) { out.push(snap); seen.add(id); }
  }
  for (const id of order) {
    if (!seen.has(id)) { out.push(byId.get(id)!); seen.add(id); }
  }
  return out;
}

/** One line per leaf, for `toMatchSnapshot()` and eyeball diffing. */
export function worldSnapshotText(state: CompositionState): string {
  return worldSnapshot(state).map((s) => {
    const parts = [
      `${s.kind} ${s.id}`,
      `bbox=[${s.bbox.join(', ')}]`,
    ];
    if (s.groupId) parts.push(`group=${s.groupId}`);
    if (s.rotation) parts.push(`rot=${s.rotation}`);
    if (s.mirrorH) parts.push('mirrorH');
    if (s.mirrorV) parts.push('mirrorV');
    if (s.angleDeg !== undefined) parts.push(`angle=${s.angleDeg}`);
    if (s.tile) parts.push(s.tile);
    if (s.pattern) parts.push(s.pattern);
    if (s.segments) parts.push(`segments={${s.segments}}`);
    if (s.subpaths) parts.push(`subpaths=[${s.subpaths.map((p) => `{${p}}`).join(' ')}]`);
    return parts.join(' ');
  }).join('\n');
}

/**
 * Describe the first difference between two snapshots, or `null` when
 * they match. Used by the refactor's round-trip tests, which want the
 * offending node named rather than a 2,000-line array diff.
 */
export function diffWorldSnapshots(
  before: readonly LeafWorldSnapshot[],
  after: readonly LeafWorldSnapshot[],
): string | null {
  if (before.length !== after.length) {
    return `leaf count ${before.length} → ${after.length}`;
  }
  for (let i = 0; i < before.length; i++) {
    const a = JSON.stringify(before[i]);
    const b = JSON.stringify(after[i]);
    if (a !== b) return `leaf #${i} (${before[i].id}):\n  before ${a}\n  after  ${b}`;
  }
  return null;
}
