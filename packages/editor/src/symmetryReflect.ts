import type { CompositionState, PathSegment } from '@/engine/types';
import { applyCompOps, buildRemoveObjectOps, SCENE_ADAPTERS } from '@/engine/compositionOps';
import { GEOMETRY_ADAPTERS } from '@/engine/sceneNodeGeometry';
import { mintNodeId, type SessionEntry } from './editorSession';
import {
  applySymmetryAffine,
  symmetryAffineMaps,
  type CanvasSymmetrySpec,
  type SymmetryAffine,
} from './canvasSymmetry';

// ── Canvas symmetry for EDITS ───────────────────────────────────────
// Drawing mirrors at creation (withSymmetryCopies, tile stamps, paint
// dabs); this module keeps the mirror honest through EDITS. Wrapping an
// action's entry in `withSymmetryReflection` re-establishes the orbit of
// every object the entry touches: whatever sat at the object's OLD orbit
// images is removed (that was its stale partner) and fresh partner copies
// are placed at the NEW images — so a move drags the mirror along, a
// rotate turns it the mirrored way, a duplicate arrives with its own
// partners, all in the action's single undo step.
//
// The partner relationship is GEOMETRIC, not stored: a partner is
// recognized as "same kind, footprint exactly on an orbit image". That
// makes the invariant self-healing (an object that predates symmetry
// grows partners the first time it is edited) and keeps the scene format
// untouched. Two escape hatches keep it from fighting the user: an orbit
// slot occupied by another object of the SAME entry is left alone (the
// user has their own hands on both halves — their action wins), and a
// locked partner is never removed or doubled.

type ReflectKind = 'svg' | 'image' | 'text' | 'paint' | 'pattern';

/** The leaf collections the reflection maintains. Figures (rigs) transform
 *  through their own viewport machinery and stay out; group RECORDS carry
 *  no geometry of their own (members reflect individually, copies land
 *  ungrouped). */
const REFLECT_KINDS: {
  kind: ReflectKind;
  items: (s: CompositionState) => readonly ReflectLeaf[];
}[] = [
  { kind: 'svg', items: (s) => s.svgObjects ?? [] },
  { kind: 'image', items: (s) => s.images ?? [] },
  { kind: 'text', items: (s) => s.texts ?? [] },
  { kind: 'paint', items: (s) => s.paintObjects ?? [] },
  { kind: 'pattern', items: (s) => s.patternObjects ?? [] },
];

interface ReflectLeaf {
  id: string;
  cellX: number;
  cellY: number;
  cellWidth: number;
  cellHeight: number;
  locked?: boolean;
  hidden?: boolean;
}

/** Partners are re-derived with the same float math that placed them, so
 *  a real match is exact to rounding — well under any grid step in use. */
const FOOTPRINT_TOL = 1e-3;

const centerOf = (i: ReflectLeaf): [number, number] =>
  [i.cellX + i.cellWidth / 2, i.cellY + i.cellHeight / 2];

function matchesFootprint(
  item: ReflectLeaf, cx: number, cy: number, w: number, h: number,
): boolean {
  return Math.abs(item.cellX + item.cellWidth / 2 - cx) <= FOOTPRINT_TOL
    && Math.abs(item.cellY + item.cellHeight / 2 - cy) <= FOOTPRINT_TOL
    && Math.abs(item.cellWidth - w) <= FOOTPRINT_TOL
    && Math.abs(item.cellHeight - h) <= FOOTPRINT_TOL;
}

/**
 * Split an orbit map's linear part — always a signed permutation matrix
 * (see symmetryAffineMaps) — into the editor's own transform vocabulary:
 * an optional screen-horizontal flip followed by clockwise quarter turns.
 * Applying `mirror('h')` then `rotate90CW` × quarterTurns to an object in
 * place reproduces the map's linear part exactly; only the translation
 * remains for the caller.
 */
export function decomposeSymmetryLinear(
  m: SymmetryAffine,
): { flip: boolean; quarterTurns: 0 | 1 | 2 | 3 } {
  const flip = m.a * m.d - m.b * m.c < 0;
  // Post-multiplying by the horizontal flip diag(-1, 1) absorbs the
  // reflection, leaving a pure rotation R^k to identify (R = CW quarter
  // turn [[0,-1],[1,0]] in y-down screen coordinates).
  const a = flip ? -m.a : m.a;
  const c = flip ? -m.c : m.c;
  if (a === 1) return { flip, quarterTurns: 0 };
  if (a === -1) return { flip, quarterTurns: 2 };
  if (c === 1) return { flip, quarterTurns: 1 };
  return { flip, quarterTurns: 3 };
}

/** A fresh id in the kind's own prefix family. The engine adapters own the
 *  paint / pattern prefixes; svg / image / text fall back to the session
 *  minting they share with every other builder. */
function mintLeafId(kind: ReflectKind): string {
  const adapter = SCENE_ADAPTERS.find((x) => x.kind === kind);
  if (adapter?.mintId) return adapter.mintId();
  return mintNodeId(kind === 'svg' ? 'svg' : kind === 'image' ? 'image' : 'text');
}

const offsetSeg = (seg: PathSegment, dx: number, dy: number): PathSegment =>
  seg.kind === 'arc'
    ? {
      ...seg,
      start: [seg.start[0] + dx, seg.start[1] + dy],
      end: [seg.end[0] + dx, seg.end[1] + dy],
      center: [seg.center[0] + dx, seg.center[1] + dy],
    }
    : { ...seg, start: [seg.start[0] + dx, seg.start[1] + dy], end: [seg.end[0] + dx, seg.end[1] + dy] };

/**
 * Translate a partner copy WITHOUT the geometry adapters' `translate`,
 * which deliberately clears rotation / mirror / identity as "the user
 * broke the transform cycle" — here the orientation IS the payload, the
 * flip the copy just received. SVG geometry (segments, subpaths, the
 * identity stash, the creation box) shifts point-wise; bbox kinds shift
 * their rects. Group-local coords were already dropped from the copy.
 */
function shiftKeepingOrientation<T extends ReflectLeaf>(
  kind: ReflectKind, node: T, dx: number, dy: number,
): T {
  if (dx === 0 && dy === 0) return node;
  const shifted = { ...node, cellX: node.cellX + dx, cellY: node.cellY + dy } as T & {
    identityCellX?: number; identityCellY?: number;
    segments?: PathSegment[]; identitySegments?: PathSegment[];
    subpaths?: { segments: PathSegment[] }[];
    creationBox?: { minX: number; minY: number; width: number; height: number };
  };
  if (shifted.identityCellX !== undefined) shifted.identityCellX += dx;
  if (shifted.identityCellY !== undefined) shifted.identityCellY += dy;
  if (kind !== 'svg') return shifted;
  const off = (seg: PathSegment) => offsetSeg(seg, dx, dy);
  if (Array.isArray(shifted.segments)) shifted.segments = shifted.segments.map(off);
  if (Array.isArray(shifted.identitySegments)) {
    shifted.identitySegments = shifted.identitySegments.map(off);
  }
  if (Array.isArray(shifted.subpaths)) {
    shifted.subpaths = shifted.subpaths.map((sub) => ({
      ...sub, segments: Array.isArray(sub.segments) ? sub.segments.map(off) : [],
    }));
  }
  if (shifted.creationBox) {
    shifted.creationBox = {
      ...shifted.creationBox,
      minX: shifted.creationBox.minX + dx,
      minY: shifted.creationBox.minY + dy,
    };
  }
  return shifted;
}

/**
 * `item` carried through one orbit map, as a fresh ungrouped object: the
 * map's flip and quarter-turns land through the kind's OWN mirror /
 * rotate transforms — the exact code the Mirror and Rotate buttons run,
 * so every kind-specific wrinkle (svg identity rebuilds, pattern repeat
 * boxes, angleDeg negating under a flip and riding through turns) behaves
 * identically here — then the copy is translated onto the image of the
 * source's center.
 */
export function symmetryPartnerCopy<T extends ReflectLeaf>(
  kind: ReflectKind, item: T, m: SymmetryAffine,
): T {
  const adapter = GEOMETRY_ADAPTERS[kind];
  let copy = {
    ...item,
    id: mintLeafId(kind),
    groupId: undefined,
    locked: undefined,
    localCellX: undefined,
    localCellY: undefined,
    localCellWidth: undefined,
    localCellHeight: undefined,
    ...(kind === 'svg' ? { localSegments: undefined } : null),
  } as T;
  const { flip, quarterTurns } = decomposeSymmetryLinear(m);
  if (flip) copy = adapter.mirror(copy, 'h') as T;
  for (let i = 0; i < quarterTurns; i++) copy = adapter.rotate90CW(copy) as T;
  const [tx, ty] = applySymmetryAffine(m, ...centerOf(item));
  const [ccx, ccy] = centerOf(copy);
  return shiftKeepingOrientation(kind, copy, tx - ccx, ty - ccy);
}

function findPartnerAt(
  state: CompositionState, kind: ReflectKind,
  cx: number, cy: number, w: number, h: number,
  exclude: ReadonlySet<string>,
): ReflectLeaf | undefined {
  const { items } = REFLECT_KINDS.find((k) => k.kind === kind)!;
  return items(state).find((p) =>
    !p.hidden && !exclude.has(p.id) && matchesFootprint(p, cx, cy, w, h));
}

/** One standing partner that should FOLLOW a live drag of its primary. */
export interface SymmetryDragPeer {
  id: string;
  /** The orbit map's linear part: while the primary previews a translate of
   *  (dx, dy) world cells, this partner previews (a·dx + b·dy, c·dx + d·dy).
   *  Exact, not approximate: a partner's committed replacement under a pure
   *  translation is itself a pure translation by the mapped delta
   *  (M ∘ T(d) ∘ M⁻¹ = T(M·d)), so the preview shows precisely what the
   *  release will commit. */
  a: number;
  b: number;
  c: number;
  d: number;
}

/**
 * The standing partners of `ids` — the same objects `withSymmetryReflection`
 * will replace when the drag commits — each with its orbit map's linear
 * part, for the canvas to move live alongside the drag. Shares the commit's
 * escape hatches: a dragged pair claims its own halves (no peer), a locked
 * partner stays still, hidden leaves don't participate.
 */
export function symmetryDragPeers(
  state: CompositionState,
  ids: readonly string[],
  spec: CanvasSymmetrySpec | undefined,
  step: number,
): SymmetryDragPeer[] {
  // A pattern-scoped mirror has no partners on the canvas to move along.
  if (!spec || spec.only || ids.length === 0) return [];
  const idSet = new Set(ids);
  const claimed = new Set<string>(ids);
  const peers: SymmetryDragPeer[] = [];
  for (const { kind, items } of REFLECT_KINDS) {
    for (const item of items(state)) {
      if (!idSet.has(item.id) || item.hidden) continue;
      const [cx, cy] = centerOf(item);
      for (const m of symmetryAffineMaps(spec, step, cx, cy)) {
        const swap = m.b !== 0 || m.c !== 0;
        const [ix, iy] = applySymmetryAffine(m, cx, cy);
        const cand = findPartnerAt(state, kind, ix, iy,
          swap ? item.cellHeight : item.cellWidth,
          swap ? item.cellWidth : item.cellHeight, claimed);
        if (!cand || cand.locked) continue;
        claimed.add(cand.id);
        peers.push({ id: cand.id, a: m.a, b: m.b, c: m.c, d: m.d });
      }
    }
  }
  return peers;
}

/**
 * Re-establish the symmetry orbit of every leaf object `se` adds, edits
 * or removes: stale partners (objects sitting exactly on the OLD orbit
 * images) leave with the entry, fresh partner copies of the new state
 * arrive with it — one undo step for the action and its reflection.
 * No-op when symmetry is off (`spec` undefined) or nothing relevant
 * changed. Wrap ACTION entries only (move / rotate / mirror / resize /
 * duplicate); drawing entries carry their orbit already.
 */
export function withSymmetryReflection(
  state: CompositionState,
  se: SessionEntry | null,
  spec: CanvasSymmetrySpec | undefined,
  step: number,
): SessionEntry | null {
  // A pattern-scoped mirror reflects no edit: it is that pattern's alone.
  if (!se || !spec || spec.only || se.entry.length === 0) return se;
  const after = applyCompOps(state, se.entry);

  // Diff by reference: applyCompOps replaces exactly the items it edits.
  interface Affected { kind: ReflectKind; oldItem?: ReflectLeaf; newItem?: ReflectLeaf }
  const affected: Affected[] = [];
  for (const { kind, items } of REFLECT_KINDS) {
    const beforeById = new Map(items(state).map((i) => [i.id, i]));
    for (const item of items(after)) {
      const prev = beforeById.get(item.id);
      if (prev !== undefined) beforeById.delete(item.id);
      // Hidden leaves have no visual state to mirror — and a rig's pose
      // record is a hidden text node that must never grow copies.
      if (item.hidden || prev?.hidden) continue;
      if (!prev) affected.push({ kind, newItem: item });
      else if (prev !== item) affected.push({ kind, oldItem: prev, newItem: item });
    }
    for (const prev of beforeById.values()) {
      if (!prev.hidden) affected.push({ kind, oldItem: prev });
    }
  }
  if (affected.length === 0) return se;

  const primaryIds = new Set(affected.map((a) => (a.newItem ?? a.oldItem)!.id));
  const claimed = new Set<string>(primaryIds);
  const removeIds: string[] = [];
  const placeOps: SessionEntry['entry'] = [];

  for (const a of affected) {
    // Orbit slots whose standing occupant is LOCKED stay exactly as they
    // are — no removal, and no fresh copy piling on top.
    const lockedSlots = new Set<string>();
    // …and the slots that were actually OCCUPIED before the edit. An edit
    // refreshes the orbit an object already had; it never grows one (see
    // the newItem loop). Only an object arriving on the page does that.
    const filledSlots = new Set<string>();
    if (a.oldItem) {
      const [ocx, ocy] = centerOf(a.oldItem);
      for (const m of symmetryAffineMaps(spec, step, ocx, ocy)) {
        const swap = m.b !== 0 || m.c !== 0;
        const [ix, iy] = applySymmetryAffine(m, ocx, ocy);
        const cand = findPartnerAt(after, a.kind, ix, iy,
          swap ? a.oldItem.cellHeight : a.oldItem.cellWidth,
          swap ? a.oldItem.cellWidth : a.oldItem.cellHeight, claimed);
        if (!cand) continue;
        if (cand.locked) { lockedSlots.add(m.kind); continue; }
        claimed.add(cand.id);
        removeIds.push(cand.id);
        filledSlots.add(m.kind);
      }
    }
    if (!a.newItem) continue;
    const [ncx, ncy] = centerOf(a.newItem);
    const [ocx, ocy] = a.oldItem ? centerOf(a.oldItem) : [ncx, ncy];
    for (const m of symmetryAffineMaps(spec, step, ncx, ncy)) {
      if (lockedSlots.has(m.kind)) continue;
      // MOVING SOMETHING NEVER MULTIPLIES IT. An edit — a move, a resize, a
      // turn — carries the partners the object already had onto its new
      // orbit and stops there: an object with no partner in this slot (it
      // was drawn before the mirror went on, or it sits astride the axis and
      // its image is itself) keeps none, and dragging it across the axis
      // leaves one object where there was one. Only an object ARRIVING on
      // the page (a placement, a paste, a duplicate — no `oldItem`) is given
      // a fresh orbit, which is what the mirror is for.
      //
      // It is also what the drag already SHOWED: symmetryDragPeers previews
      // the standing partners and nothing else, so a commit that minted more
      // was handing back something the gesture never drew.
      if (a.oldItem && !filledSlots.has(m.kind)) continue;
      const swap = m.b !== 0 || m.c !== 0;
      const [ix, iy] = applySymmetryAffine(m, ncx, ncy);
      const ew = swap ? a.newItem.cellHeight : a.newItem.cellWidth;
      const eh = swap ? a.newItem.cellWidth : a.newItem.cellHeight;
      // The image is the object itself (it sits ON the axis): no
      // coincident copy.
      if (matchesFootprint(a.newItem, ix, iy, ew, eh)) continue;
      // The slot belongs to another object THIS entry touches — before or
      // after the action. The user is manipulating both halves themselves
      // (a multi-drag of a pair, a flip that swaps them); their explicit
      // action wins over the reflection.
      const [oix, oiy] = applySymmetryAffine(m, ocx, ocy);
      const owned = affected.some((o) => {
        if (o === a || o.kind !== a.kind) return false;
        if (o.newItem && matchesFootprint(o.newItem, ix, iy, ew, eh)) return true;
        if (!o.oldItem || !a.oldItem) return false;
        return matchesFootprint(o.oldItem, oix, oiy,
          swap ? a.oldItem.cellHeight : a.oldItem.cellWidth,
          swap ? a.oldItem.cellWidth : a.oldItem.cellHeight);
      });
      if (owned) continue;
      placeOps.push({
        op: 'placeObject', kind: a.kind,
        item: symmetryPartnerCopy(a.kind, a.newItem, m),
      } as SessionEntry['entry'][number]);
    }
  }

  if (removeIds.length === 0 && placeOps.length === 0) return se;
  // Removal ops are built against the post-entry state — they apply after
  // the action's own ops — and prune any group a departing partner strands.
  const removalOps = removeIds.length > 0 ? buildRemoveObjectOps(after, removeIds) : [];
  return { ...se, entry: [...se.entry, ...removalOps, ...placeOps] };
}
