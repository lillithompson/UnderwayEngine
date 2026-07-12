import { SVGObject, PathSegment } from './types';

const EPS = 1e-6;

function eq(a: readonly [number, number], b: readonly [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;
}

/** Extract segments from an SVGObject (deep-clone). */
export function itemToSegments(item: SVGObject): PathSegment[] {
  return item.segments.map(seg => seg.kind === 'arc'
    ? { kind: 'arc', start: [seg.start[0], seg.start[1]], end: [seg.end[0], seg.end[1]], center: [seg.center[0], seg.center[1]] }
    : { kind: 'line', start: [seg.start[0], seg.start[1]], end: [seg.end[0], seg.end[1]] });
}

/** Reverse a chain end-to-end. Each segment's start/end swap; arc-curve
 *  segments keep their center (sweep direction follows from start vs end). */
export function reverseSegments(segs: ReadonlyArray<PathSegment>): PathSegment[] {
  const out: PathSegment[] = [];
  for (let i = segs.length - 1; i >= 0; i--) {
    const seg = segs[i];
    if (seg.kind === 'arc') {
      out.push({ kind: 'arc', start: [seg.end[0], seg.end[1]], end: [seg.start[0], seg.start[1]], center: [seg.center[0], seg.center[1]] });
    } else {
      out.push({ kind: 'line', start: [seg.end[0], seg.end[1]], end: [seg.start[0], seg.start[1]] });
    }
  }
  return out;
}

function chainHead(chain: ReadonlyArray<PathSegment>): readonly [number, number] {
  return chain[0].start;
}

function chainTail(chain: ReadonlyArray<PathSegment>): readonly [number, number] {
  return chain[chain.length - 1].end;
}

/** Greedy chain assembly over segment arrays — each item's segments are
 *  appended/prepended (and possibly reversed) so the chain's endpoints
 *  match. Junction points fall out for free because consecutive segments
 *  already share an endpoint. */
function buildSegmentChain(
  itemSegs: ReadonlyArray<ReadonlyArray<PathSegment>>,
): { chain: PathSegment[]; usedCount: number } {
  if (itemSegs.length === 0) return { chain: [], usedCount: 0 };
  const chain: PathSegment[] = itemSegs[0].map(s => ({ ...s }) as PathSegment);
  const used = new Set<number>([0]);
  while (used.size < itemSegs.length) {
    let progressed = false;
    for (let i = 0; i < itemSegs.length; i++) {
      if (used.has(i)) continue;
      const segs = itemSegs[i];
      if (segs.length === 0) { used.add(i); progressed = true; break; }
      const first = segs[0].start;
      const last = segs[segs.length - 1].end;
      const head = chainHead(chain);
      const tail = chainTail(chain);
      if (eq(tail, first)) {
        for (const s of segs) chain.push({ ...s } as PathSegment);
        used.add(i); progressed = true; break;
      }
      if (eq(tail, last)) {
        for (const s of reverseSegments(segs)) chain.push(s);
        used.add(i); progressed = true; break;
      }
      if (eq(head, last)) {
        for (let j = segs.length - 1; j >= 0; j--) chain.unshift({ ...segs[j] } as PathSegment);
        used.add(i); progressed = true; break;
      }
      if (eq(head, first)) {
        const reversed = reverseSegments(segs);
        for (let j = reversed.length - 1; j >= 0; j--) chain.unshift(reversed[j]);
        used.add(i); progressed = true; break;
      }
    }
    if (!progressed) break;
  }
  return { chain, usedCount: used.size };
}

/** True iff the items can be merged into a single connected stroke by
 *  end-to-end chaining. Requires ≥ 2 items, every item non-empty, and the
 *  greedy assembly to consume all of them. */
export function canJoin(items: ReadonlyArray<SVGObject>): boolean {
  if (items.length < 2) return false;
  const itemSegs: PathSegment[][] = [];
  for (const it of items) {
    const segs = itemToSegments(it);
    if (segs.length === 0) return false;
    itemSegs.push(segs);
  }
  const { usedCount } = buildSegmentChain(itemSegs);
  return usedCount === items.length;
}

/** Returns the joined segment chain. Caller must have gated on `canJoin`;
 *  throws otherwise. */
export function joinItems(items: ReadonlyArray<SVGObject>): PathSegment[] {
  const itemSegs = items.map(itemToSegments);
  const { chain, usedCount } = buildSegmentChain(itemSegs);
  if (usedCount !== items.length) {
    throw new Error('joinItems: selected items are not chain-joinable');
  }
  return chain;
}
