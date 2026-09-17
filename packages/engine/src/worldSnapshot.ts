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

import { decomposeMatrix, localMatrix, normalizeDeg } from './sceneTransform';
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
  /**
   * The DRAWN box: the content's own (un-turned) size in L0 cells,
   * `[width, height]`.
   *
   * Not the stored bbox. The legacy model swaps a stored bbox's width and
   * height on a quarter turn, so the same drawing has two stored boxes
   * depending on how its turn is spelled between the discrete channel and
   * the free one — and both render identically, because the renderer
   * centres this content box in that bbox and turns it. Recording the
   * content box and the centre says where the drawing is without saying
   * which spelling put it there, and still catches every resize (the size
   * changes) and every move (the centre does).
   */
  box: [number, number];
  /** Where the content box's centre sits in the world. */
  at: [number, number];
  /**
   * The DRAWN turn, in degrees clockwise about the bbox centre: the
   * discrete quarter turn and the free angle added together, canonicalised
   * so that one pose has one spelling. Omitted when there is no turn.
   */
  turn?: number;
  /** Whether the node is flipped (handedness reversed). Which axis is not
   *  recorded: a flip about one axis is a flip about the other plus a
   *  turn, and the turn is already here. */
  flip?: boolean;
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
  // The un-turned content box: a quarter turn swaps the stored bbox, so
  // swap it back to recover the box the content is actually drawn in.
  const swap = n.rotation === 90 || n.rotation === 270;
  const snap: LeafWorldSnapshot = {
    id: n.id,
    kind,
    box: [q(swap ? n.cellHeight : n.cellWidth), q(swap ? n.cellWidth : n.cellHeight)],
    at: [q(n.cellX + n.cellWidth / 2), q(n.cellY + n.cellHeight / 2)],
  };
  if (n.groupId) snap.groupId = n.groupId;
  Object.assign(snap, turnOf(n));
  return snap;
}

/**
 * The node's orientation as one canonical turn, not as the engine
 * happens to spell it.
 *
 * The legacy model carries FOUR fields for this — a quarter turn, two
 * mirror flags and a free angle — and they name the same pose many ways
 * over. A lone `mirrorV` is `rotation: 180` plus `mirrorH`. A quarter
 * turn of 0 with an angle of 25 is a turn of 180 with an angle of 205.
 * The engine re-spells one as another whenever it composes orientations
 * through a group chain, and a snapshot of "what the user sees" that read
 * those fields literally would report moves nobody can see — which it did,
 * repeatedly, while this refactor was being built.
 *
 * So: add the two rotation channels, fold the flips in as negative scale,
 * and decompose. That yields one turn and one flip bit per pose, by
 * construction.
 */
function turnOf(n: {
  rotation?: 0 | 90 | 180 | 270;
  mirrorH?: boolean; mirrorV?: boolean; angleDeg?: number;
}): { turn?: number; flip?: boolean } {
  const total = (n.rotation ?? 0) + (n.angleDeg ?? 0);
  const t = decomposeMatrix(localMatrix({
    tx: 0, ty: 0, sx: 1, sy: 1, rotationDeg: normalizeDeg(total),
    ...(n.mirrorH ? { mirrorH: true } : {}),
    ...(n.mirrorV ? { mirrorV: true } : {}),
  }));
  const out: { turn?: number; flip?: boolean } = {};
  const turn = q(normalizeDeg(t.rotationDeg));
  if (turn !== 0) out.turn = turn;
  if (t.sy < 0) out.flip = true;
  return out;
}

function figureSnap(f: CompositionFigure): LeafWorldSnapshot {
  const snap = basePose('figure', f);
  const tile = tileText(f);
  if (tile) snap.tile = tile;
  return snap;
}

function svgSnap(s: SVGObject): LeafWorldSnapshot {
  const snap = basePose('svg', s);
  // The DRAWN path, with any free angle already applied.
  //
  // An svg's free rotation is layered on at render time, about the bbox
  // centre, leaving the stored vertices un-turned — one of two equivalent
  // ways to say where the path is, the other being to turn the vertices
  // and carry no angle. Both draw the same line, so a snapshot that
  // reports "what the user sees" has to treat them as the same. Applying
  // the angle here is what makes that true, and what lets the scene graph
  // hold one rotation where the legacy model held two channels.
  const angle = q(s.angleDeg);
  const drawn = angle === 0 ? s.segments : rotateSegments(
    s.segments, angle,
    s.cellX + s.cellWidth / 2, s.cellY + s.cellHeight / 2,
  );
  // The vertices already say which way the path faces — quarter turns are
  // baked into them and the free angle is applied just above — so the
  // orientation flags would say it a second time.
  snap.turn = undefined;
  snap.flip = undefined;
  snap.segments = segsText(drawn);
  if (s.subpaths && s.subpaths.length > 0) {
    snap.subpaths = s.subpaths.map((sp) => segsText(
      angle === 0 ? sp.segments : rotateSegments(
        sp.segments, angle,
        s.cellX + s.cellWidth / 2, s.cellY + s.cellHeight / 2,
      ),
    ));
  }
  const tile = tileText(s);
  if (tile) snap.tile = tile;
  return snap;
}

/** Turn every vertex of a path `deg` clockwise about `(cx, cy)`. */
function rotateSegments(
  segments: ReadonlyArray<PathSegment> | undefined,
  deg: number, cx: number, cy: number,
): PathSegment[] {
  const rad = deg * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const turn = (p: readonly [number, number]): [number, number] => {
    const dx = p[0] - cx, dy = p[1] - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  };
  return (segments ?? []).map((seg) => seg.kind === 'arc'
    ? { kind: 'arc' as const, start: turn(seg.start), end: turn(seg.end), center: turn(seg.center) }
    : { kind: 'line' as const, start: turn(seg.start), end: turn(seg.end) });
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
      `box=${s.box.join('x')} at=[${s.at.join(', ')}]`,
    ];
    if (s.groupId) parts.push(`group=${s.groupId}`);
    if (s.turn) parts.push(`turn=${s.turn}`);
    if (s.flip) parts.push('flip');
    if (s.tile) parts.push(s.tile);
    if (s.pattern) parts.push(s.pattern);
    if (s.segments) parts.push(`segments={${s.segments}}`);
    if (s.subpaths) parts.push(`subpaths=[${s.subpaths.map((p) => `{${p}}`).join(' ')}]`);
    return parts.join(' ');
  }).join('\n');
}

export interface DiffOptions {
  /**
   * Skip an svg's `box` and `at`.
   *
   * An svg's stored bbox is a selection rect, not its drawn extent, and
   * for an H/V line it is deliberately inflated so a zero-height path
   * stays grabbable (`creationBox`; `reconcileGroupLocalsForGroups` avoids
   * reconciling unrelated items for exactly this reason).
   * `materializeSVGMember` recomputes it as the segment AABB and so
   * collapses that inflation. A caller asking "did this node move?" wants
   * the path compared, which `segments` already does.
   */
  ignoreSvgBbox?: boolean;
  /**
   * Skip `groupId`.
   *
   * For asking "did anything move?" across a change that is *about*
   * membership — grouping, ungrouping, dragging into a frame. All three
   * are supposed to change who a node's parent is and supposed to leave
   * it exactly where it was on screen, and only the second half is what
   * such a caller is checking.
   */
  ignoreGroupId?: boolean;
}

/** The fields a diff should compare, per `opts`. */
function comparable(snap: LeafWorldSnapshot, opts?: DiffOptions): unknown {
  if (!opts) return snap;
  let out: Partial<LeafWorldSnapshot> = snap;
  if (opts.ignoreSvgBbox && snap.kind === 'svg') {
    const { box: _box, at: _at, ...rest } = out;
    out = rest;
  }
  if (opts.ignoreGroupId) {
    const { groupId: _groupId, ...rest } = out;
    out = rest;
  }
  return out;
}

/**
 * Describe the first difference between two snapshots, or `null` when
 * they match. Used by the refactor's round-trip tests, which want the
 * offending node named rather than a 2,000-line array diff.
 */
export function diffWorldSnapshots(
  before: readonly LeafWorldSnapshot[],
  after: readonly LeafWorldSnapshot[],
  opts?: DiffOptions,
): string | null {
  if (before.length !== after.length) {
    return `leaf count ${before.length} → ${after.length}`;
  }
  for (let i = 0; i < before.length; i++) {
    const a = JSON.stringify(comparable(before[i], opts));
    const b = JSON.stringify(comparable(after[i], opts));
    if (a !== b) return `leaf #${i} (${before[i].id}):\n  before ${a}\n  after  ${b}`;
  }
  return null;
}
