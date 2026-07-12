// SVG simplification: merge same-color paths at shared endpoints, remove
// collinear interior points, merge adjacent rects, simplify degenerate curves.

// ─── Types ──────────────────────────────────────────────────────────

export interface Point { x: number; y: number; }

/** 2D affine matrix [a,b,c,d,e,f]: x'=ax+cy+e, y'=bx+dy+f */
export type AffineMatrix = [number, number, number, number, number, number];

export type PathSegment =
  | { cmd: 'M'; x: number; y: number }
  | { cmd: 'L'; x: number; y: number }
  | { cmd: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { cmd: 'Q'; x1: number; y1: number; x: number; y: number }
  | { cmd: 'Z' };

export interface Subpath {
  segments: PathSegment[];
  closed: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────

const IDENTITY: AffineMatrix = [1, 0, 0, 1, 0, 0];
// Tile SVGs overshoot cell boundaries by ~0.25 units for stroke overlap.
// After grid-level scaling (up to 16×), shared endpoints can differ by up
// to ~8 SVG units. Snap to nearest 16 for endpoint matching and use 10 for
// collinear tolerance to handle all grid levels safely. The minimum distance
// between truly separate connection points is 128×scale, so 16 is safe.
const COLLINEAR_EPS = 10;   // max perpendicular distance to consider collinear
const COORD_PRECISION = 2;
const MATCH_EPS = 0.01;     // coordinate comparison tolerance
const SNAP_QUANTUM = 16;    // endpoint matching snap grid

// ─── Coordinate utilities ───────────────────────────────────────────

function roundCoord(n: number): number {
  const f = 10 ** COORD_PRECISION;
  return Math.round(n * f) / f;
}

function ptKey(x: number, y: number): string {
  const sx = Math.round(x / SNAP_QUANTUM) * SNAP_QUANTUM;
  const sy = Math.round(y / SNAP_QUANTUM) * SNAP_QUANTUM;
  return `${sx},${sy}`;
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < MATCH_EPS;
}

// ─── Transform parsing ─────────────────────────────────────────────

export function multiplyMatrices(a: AffineMatrix, b: AffineMatrix): AffineMatrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function txPoint(m: AffineMatrix, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export function parseTransform(str: string): AffineMatrix {
  if (!str) return IDENTITY;
  let r: AffineMatrix = [1, 0, 0, 1, 0, 0];
  const re = /(\w+)\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    const args = m[2].split(/[\s,]+/).map(Number);
    let t: AffineMatrix;
    switch (m[1]) {
      case 'translate':
        t = [1, 0, 0, 1, args[0] || 0, args.length > 1 ? args[1] : 0];
        break;
      case 'scale': {
        const sx = args[0] ?? 1, sy = args.length > 1 ? args[1] : sx;
        t = [sx, 0, 0, sy, 0, 0];
        break;
      }
      case 'rotate': {
        const rad = (args[0] || 0) * Math.PI / 180;
        const c = Math.cos(rad), s = Math.sin(rad);
        if (args.length >= 3) {
          const cx = args[1], cy = args[2];
          t = multiplyMatrices([1, 0, 0, 1, cx, cy],
            multiplyMatrices([c, s, -s, c, 0, 0], [1, 0, 0, 1, -cx, -cy]));
        } else {
          t = [c, s, -s, c, 0, 0];
        }
        break;
      }
      case 'matrix':
        t = [args[0], args[1], args[2], args[3], args[4], args[5]];
        break;
      default: continue;
    }
    r = multiplyMatrices(r, t);
  }
  return r;
}

// ─── Path d tokenizer & parser ──────────────────────────────────────

function tokenize(d: string): (string | number)[] {
  const out: (string | number)[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    out.push(m[1] ? m[1] : Number(m[2]));
  }
  return out;
}

export function parsePathD(d: string): Subpath[] {
  const subs: Subpath[] = [];
  let cur: Subpath | null = null;
  let cx = 0, cy = 0, sx = 0, sy = 0;
  const tok = tokenize(d);
  let i = 0;
  const num = () => tok[i++] as number;
  const hasNum = () => i < tok.length && typeof tok[i] === 'number';

  while (i < tok.length) {
    if (typeof tok[i] === 'number') { i++; continue; }
    const c = tok[i++] as string;
    const rel = c === c.toLowerCase() && c !== 'Z' && c !== 'z';
    switch (c.toUpperCase()) {
      case 'M': {
        let first = true;
        while (hasNum()) {
          let x = num(), y = num();
          if (rel) { x += cx; y += cy; }
          if (first) {
            cur = { segments: [{ cmd: 'M', x, y }], closed: false };
            subs.push(cur);
            sx = x; sy = y; first = false;
          } else {
            cur!.segments.push({ cmd: 'L', x, y });
          }
          cx = x; cy = y;
        }
        break;
      }
      case 'L':
        while (hasNum()) {
          let x = num(), y = num();
          if (rel) { x += cx; y += cy; }
          cur?.segments.push({ cmd: 'L', x, y });
          cx = x; cy = y;
        }
        break;
      case 'H':
        while (hasNum()) {
          let x = num();
          if (rel) x += cx;
          cur?.segments.push({ cmd: 'L', x, y: cy });
          cx = x;
        }
        break;
      case 'V':
        while (hasNum()) {
          let y = num();
          if (rel) y += cy;
          cur?.segments.push({ cmd: 'L', x: cx, y });
          cy = y;
        }
        break;
      case 'C':
        while (hasNum()) {
          let x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num();
          if (rel) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy; }
          cur?.segments.push({ cmd: 'C', x1, y1, x2, y2, x, y });
          cx = x; cy = y;
        }
        break;
      case 'S':
        while (hasNum()) {
          let x2 = num(), y2 = num(), x = num(), y = num();
          if (rel) { x2 += cx; y2 += cy; x += cx; y += cy; }
          const ps = cur?.segments[cur.segments.length - 1];
          let x1 = cx, y1 = cy;
          if (ps?.cmd === 'C') { x1 = 2 * cx - ps.x2; y1 = 2 * cy - ps.y2; }
          cur?.segments.push({ cmd: 'C', x1, y1, x2, y2, x, y });
          cx = x; cy = y;
        }
        break;
      case 'Q':
        while (hasNum()) {
          let qx = num(), qy = num(), x = num(), y = num();
          if (rel) { qx += cx; qy += cy; x += cx; y += cy; }
          cur?.segments.push({ cmd: 'Q', x1: qx, y1: qy, x, y });
          cx = x; cy = y;
        }
        break;
      case 'T':
        while (hasNum()) {
          let x = num(), y = num();
          if (rel) { x += cx; y += cy; }
          const pt = cur?.segments[cur.segments.length - 1];
          let qx1 = cx, qy1 = cy;
          if (pt?.cmd === 'Q') { qx1 = 2 * cx - pt.x1; qy1 = 2 * cy - pt.y1; }
          cur?.segments.push({ cmd: 'Q', x1: qx1, y1: qy1, x, y });
          cx = x; cy = y;
        }
        break;
      case 'A':
        // Arcs: consume parameters but don't optimize — pass as L to endpoint
        while (hasNum()) {
          num(); num(); num(); num(); num(); // rx ry rotation largeArc sweep
          let x = num(), y = num();
          if (rel) { x += cx; y += cy; }
          cur?.segments.push({ cmd: 'L', x, y });
          cx = x; cy = y;
        }
        break;
      case 'Z':
        if (cur) { cur.segments.push({ cmd: 'Z' }); cur.closed = true; }
        cx = sx; cy = sy;
        break;
    }
  }
  return subs;
}

// ─── Transform application ──────────────────────────────────────────

function txSubpath(m: AffineMatrix, sp: Subpath): Subpath {
  const segs: PathSegment[] = sp.segments.map(s => {
    switch (s.cmd) {
      case 'M': { const p = txPoint(m, s.x, s.y); return { cmd: 'M', x: p.x, y: p.y }; }
      case 'L': { const p = txPoint(m, s.x, s.y); return { cmd: 'L', x: p.x, y: p.y }; }
      case 'C': {
        const p1 = txPoint(m, s.x1, s.y1), p2 = txPoint(m, s.x2, s.y2), p = txPoint(m, s.x, s.y);
        return { cmd: 'C', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p.x, y: p.y };
      }
      case 'Q': {
        const p1 = txPoint(m, s.x1, s.y1), p = txPoint(m, s.x, s.y);
        return { cmd: 'Q', x1: p1.x, y1: p1.y, x: p.x, y: p.y };
      }
      case 'Z': return { cmd: 'Z' };
    }
  });
  return { segments: segs, closed: sp.closed };
}

// ─── Segment-level simplification ───────────────────────────────────

/** Perpendicular-distance collinearity check. */
export function areCollinear(
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
  eps: number = COLLINEAR_EPS,
): boolean {
  const cross = (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
  const lenSq = (x3 - x1) ** 2 + (y3 - y1) ** 2;
  if (lenSq < 1e-10) return true; // degenerate
  return cross * cross / lenSq < eps * eps;
}

function segEnd(s: PathSegment): Point | null {
  if (s.cmd === 'Z') return null;
  return { x: (s as any).x, y: (s as any).y };
}

/** Remove degenerate curves→lines, zero-length segments, redundant M. */
function simplifySegs(sp: Subpath): Subpath {
  const out: PathSegment[] = [];
  let cx = 0, cy = 0;
  for (const s of sp.segments) {
    switch (s.cmd) {
      case 'M':
        if (out.length > 0 && out[out.length - 1].cmd === 'M') {
          out[out.length - 1] = s;
        } else {
          out.push(s);
        }
        cx = s.x; cy = s.y;
        break;
      case 'L':
        if (near(s.x, cx) && near(s.y, cy)) break;
        out.push(s);
        cx = s.x; cy = s.y;
        break;
      case 'C':
        if (near(s.x, cx) && near(s.y, cy) &&
            near(s.x1, cx) && near(s.y1, cy) &&
            near(s.x2, cx) && near(s.y2, cy)) break;
        if (areCollinear(cx, cy, s.x1, s.y1, s.x, s.y) &&
            areCollinear(cx, cy, s.x2, s.y2, s.x, s.y)) {
          if (near(s.x, cx) && near(s.y, cy)) break;
          out.push({ cmd: 'L', x: s.x, y: s.y });
        } else {
          out.push(s);
        }
        cx = s.x; cy = s.y;
        break;
      case 'Q':
        if (near(s.x, cx) && near(s.y, cy) &&
            near(s.x1, cx) && near(s.y1, cy)) break;
        if (areCollinear(cx, cy, s.x1, s.y1, s.x, s.y)) {
          if (near(s.x, cx) && near(s.y, cy)) break;
          out.push({ cmd: 'L', x: s.x, y: s.y });
        } else {
          out.push(s);
        }
        cx = s.x; cy = s.y;
        break;
      case 'Z':
        out.push(s);
        break;
    }
  }
  return { segments: out, closed: sp.closed };
}

// ─── Collinear point removal ────────────────────────────────────────

export function removeCollinearPoints(sp: Subpath): Subpath {
  const segs = sp.segments;
  if (segs.length < 3) return sp;
  const out: PathSegment[] = [segs[0]];

  for (let i = 1; i < segs.length; i++) {
    const seg = segs[i];
    if (seg.cmd === 'L' && out.length >= 2) {
      const prev = out[out.length - 1];
      const prevPrev = out[out.length - 2];
      if (prev.cmd === 'L') {
        const pp = segEnd(prevPrev);
        if (pp && areCollinear(pp.x, pp.y, (prev as any).x, (prev as any).y, seg.x, seg.y)) {
          out[out.length - 1] = seg;
          continue;
        }
      }
    }
    out.push(seg);
  }
  return { segments: out, closed: sp.closed };
}

// ─── Subpath utilities ──────────────────────────────────────────────

function spStart(sp: Subpath): Point {
  const m = sp.segments[0] as { cmd: 'M'; x: number; y: number };
  return { x: m.x, y: m.y };
}

function spEnd(sp: Subpath): Point {
  for (let i = sp.segments.length - 1; i >= 0; i--) {
    const p = segEnd(sp.segments[i]);
    if (p) return p;
  }
  return spStart(sp);
}

export function reverseSubpath(sp: Subpath): Subpath {
  const segs = sp.segments;
  if (segs.length < 2) return sp;

  // Collect (from, segment, to) triples
  const triples: { from: Point; seg: PathSegment; to: Point }[] = [];
  let cur = spStart(sp);
  for (let i = 1; i < segs.length; i++) {
    const s = segs[i];
    if (s.cmd === 'Z') continue;
    const to = segEnd(s)!;
    triples.push({ from: cur, seg: s, to });
    cur = to;
  }
  if (triples.length === 0) return sp;

  const newStart = triples[triples.length - 1].to;
  const rev: PathSegment[] = [{ cmd: 'M', x: newStart.x, y: newStart.y }];

  for (let i = triples.length - 1; i >= 0; i--) {
    const { from, seg } = triples[i];
    switch (seg.cmd) {
      case 'L':
        rev.push({ cmd: 'L', x: from.x, y: from.y });
        break;
      case 'C':
        rev.push({ cmd: 'C', x1: seg.x2, y1: seg.y2, x2: seg.x1, y2: seg.y1, x: from.x, y: from.y });
        break;
      case 'Q':
        rev.push({ cmd: 'Q', x1: seg.x1, y1: seg.y1, x: from.x, y: from.y });
        break;
    }
  }
  return { segments: rev, closed: false };
}

// ─── Chain merging (graph-based) ────────────────────────────────────

interface SpEntry {
  sp: Subpath;
  sk: string; // start key
  ek: string; // end key
}

function mergeChains(entries: SpEntry[]): Subpath[] {
  const n = entries.length;
  if (n === 0) return [];
  const visited = new Uint8Array(n);
  const result: Subpath[] = [];

  // Adjacency: point key → [{index, end}]
  const adj = new Map<string, { i: number; e: 'S' | 'E' }[]>();
  function addAdj(key: string, idx: number, end: 'S' | 'E') {
    let list = adj.get(key);
    if (!list) { list = []; adj.set(key, list); }
    list.push({ i: idx, e: end });
  }
  for (let i = 0; i < n; i++) {
    if (entries[i].sp.closed) continue;
    addAdj(entries[i].sk, i, 'S');
    addAdj(entries[i].ek, i, 'E');
  }

  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    visited[i] = 1;
    if (entries[i].sp.closed) { result.push(entries[i].sp); continue; }

    let chain = entries[i].sp.segments.slice();
    let chainEK = entries[i].ek;
    let chainSK = entries[i].sk;

    // Extend from end
    let go = true;
    while (go) {
      go = false;
      const cands = adj.get(chainEK);
      if (!cands) break;
      for (const c of cands) {
        if (visited[c.i]) continue;
        visited[c.i] = 1;
        const other = entries[c.i];
        let segs: PathSegment[];
        if (c.e === 'S') {
          segs = other.sp.segments;
          chainEK = other.ek;
        } else {
          segs = reverseSubpath(other.sp).segments;
          chainEK = other.sk;
        }
        for (let j = 1; j < segs.length; j++) chain.push(segs[j]);
        go = true;
        break;
      }
    }

    // Extend from start
    go = true;
    while (go) {
      go = false;
      const cands = adj.get(chainSK);
      if (!cands) break;
      for (const c of cands) {
        if (visited[c.i]) continue;
        visited[c.i] = 1;
        const other = entries[c.i];
        let segs: PathSegment[];
        if (c.e === 'E') {
          segs = other.sp.segments;
          chainSK = other.sk;
        } else {
          segs = reverseSubpath(other.sp).segments;
          chainSK = other.ek;
        }
        const prepend = segs.slice();
        for (let j = 1; j < chain.length; j++) prepend.push(chain[j]);
        chain = prepend;
        go = true;
        break;
      }
    }

    result.push({ segments: chain, closed: false });
  }
  return result;
}

// ─── Rect merging ───────────────────────────────────────────────────

interface Rect {
  x: number; y: number; w: number; h: number;
  fill: string; opacity: string;
  extra: Record<string, string>; // stroke, stroke-width, etc.
}

function parseRectEl(el: string): Rect | null {
  const attrs = parseAttrs(el);
  if (!attrs) return null;
  const extra: Record<string, string> = {};
  const skip = new Set(['__tag', 'x', 'y', 'width', 'height', 'fill', 'opacity']);
  for (const [k, v] of Object.entries(attrs)) {
    if (!skip.has(k)) extra[k] = v;
  }
  return {
    x: Number(attrs.x) || 0,
    y: Number(attrs.y) || 0,
    w: Number(attrs.width) || 0,
    h: Number(attrs.height) || 0,
    fill: attrs.fill || 'none',
    opacity: attrs.opacity || '',
    extra,
  };
}

function rectMergeKey(r: Rect): string {
  const extraStr = Object.entries(r.extra).sort().map(([k, v]) => `${k}=${v}`).join('&');
  return `${r.fill}|${r.opacity}|${extraStr}`;
}

function mergeRects(rects: Rect[]): Rect[] {
  if (rects.length <= 1) return rects;
  const groups = new Map<string, Rect[]>();
  for (const r of rects) {
    const k = rectMergeKey(r);
    let g = groups.get(k);
    if (!g) { g = []; groups.set(k, g); }
    g.push({ ...r });
  }
  const out: Rect[] = [];
  for (const group of groups.values()) {
    // Horizontal pass
    group.sort((a, b) => a.y - b.y || a.x - b.x);
    const hm: Rect[] = [];
    for (const r of group) {
      const last = hm[hm.length - 1];
      if (last && near(last.y, r.y) && near(last.h, r.h) && near(last.x + last.w, r.x)) {
        last.w += r.w;
      } else {
        hm.push({ ...r });
      }
    }
    // Vertical pass
    hm.sort((a, b) => a.x - b.x || a.y - b.y);
    const vm: Rect[] = [];
    for (const r of hm) {
      const last = vm[vm.length - 1];
      if (last && near(last.x, r.x) && near(last.w, r.w) && near(last.y + last.h, r.y)) {
        last.h += r.h;
      } else {
        vm.push({ ...r });
      }
    }
    out.push(...vm);
  }
  return out;
}

function serializeRect(r: Rect): string {
  let s = `<rect x="${roundCoord(r.x)}" y="${roundCoord(r.y)}" width="${roundCoord(r.w)}" height="${roundCoord(r.h)}" fill="${r.fill}"`;
  if (r.opacity) s += ` opacity="${r.opacity}"`;
  for (const [k, v] of Object.entries(r.extra)) {
    s += ` ${k}="${v}"`;
  }
  return s + '/>';
}

// ─── Serialization ──────────────────────────────────────────────────

function sc(n: number): string {
  const r = roundCoord(n);
  return r === 0 ? '0' : String(r);
}

function serializePathD(subs: Subpath[]): string {
  const parts: string[] = [];
  for (const sp of subs) {
    for (const s of sp.segments) {
      switch (s.cmd) {
        case 'M': parts.push(`M${sc(s.x)} ${sc(s.y)}`); break;
        case 'L': parts.push(`L${sc(s.x)} ${sc(s.y)}`); break;
        case 'C': parts.push(`C${sc(s.x1)} ${sc(s.y1)} ${sc(s.x2)} ${sc(s.y2)} ${sc(s.x)} ${sc(s.y)}`); break;
        case 'Q': parts.push(`Q${sc(s.x1)} ${sc(s.y1)} ${sc(s.x)} ${sc(s.y)}`); break;
        case 'Z': parts.push('Z'); break;
      }
    }
  }
  return parts.join('');
}

// ─── Element parsing ────────────────────────────────────────────────

function parseAttrs(el: string): Record<string, string> | null {
  const tagMatch = el.match(/^<(\w+)[\s>]/);
  if (!tagMatch) return null;
  const attrs: Record<string, string> = { __tag: tagMatch[1] };
  const re = /([\w-]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(el)) !== null) attrs[m[1]] = m[2];
  return attrs;
}

function pathVisKey(a: Record<string, string>): string {
  return `${a.stroke || 'none'}|${a['stroke-width'] || '0'}|${a.fill || 'none'}|${a.opacity || ''}`;
}

function rectVisKey(a: Record<string, string>): string {
  const skip = new Set(['__tag', 'x', 'y', 'width', 'height', 'fill', 'opacity']);
  const extras = Object.entries(a).filter(([k]) => !skip.has(k)).sort().map(([k, v]) => `${k}=${v}`).join('&');
  return `${a.fill || 'none'}|${a.opacity || ''}|${extras}`;
}

// ─── Path processing pipeline ───────────────────────────────────────

/** Linear scale factor of an affine matrix: sqrt(|determinant|). */
function matrixScale(m: AffineMatrix): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

function processPaths(els: string[]): string[] {
  // Parse, transform, simplify segments
  const allSubs: { sp: Subpath; vk: string; attrs: Record<string, string>; scale: number }[] = [];

  for (const el of els) {
    const a = parseAttrs(el);
    if (!a || !a.d) continue;
    const matrix = parseTransform(a.transform || '');
    const scale = matrixScale(matrix);
    const subs = parsePathD(a.d);
    const vk = pathVisKey(a);

    for (const sub of subs) {
      const tx = txSubpath(matrix, sub);
      const simplified = simplifySegs(tx);
      if (simplified.segments.length > 1 || (simplified.segments.length === 1 && simplified.closed)) {
        allSubs.push({ sp: simplified, vk, attrs: a, scale });
      }
    }
  }

  if (allSubs.length === 0) return [];

  // Group by visual key
  const groups = new Map<string, { subs: Subpath[]; attrs: Record<string, string>; scale: number }>();
  for (const s of allSubs) {
    let g = groups.get(s.vk);
    if (!g) { g = { subs: [], attrs: s.attrs, scale: s.scale }; groups.set(s.vk, g); }
    g.subs.push(s.sp);
  }

  const result: string[] = [];
  for (const [, group] of groups) {
    // Build entries for chain merging
    const entries: SpEntry[] = group.subs.map(sp => {
      const s = spStart(sp), e = spEnd(sp);
      return { sp, sk: ptKey(s.x, s.y), ek: ptKey(e.x, e.y) };
    });

    const merged = mergeChains(entries);
    const simplified = merged.map(removeCollinearPoints);
    const nonEmpty = simplified.filter(sp => sp.segments.length > 1);
    if (nonEmpty.length === 0) continue;

    const d = serializePathD(nonEmpty);
    // Resolving the transform into coordinates removes the scale that
    // SVG applies to strokes. Compensate by multiplying stroke-width
    // by the transform's scale factor.
    const attrParts: string[] = [];
    const skip = new Set(['__tag', 'id', 'transform', 'd', 'stroke-width']);
    for (const [k, v] of Object.entries(group.attrs)) {
      if (!skip.has(k)) attrParts.push(`${k}="${v}"`);
    }
    const rawSW = Number(group.attrs['stroke-width']) || 0;
    if (rawSW > 0) {
      const adjustedSW = roundCoord(rawSW * group.scale);
      attrParts.push(`stroke-width="${adjustedSW}"`);
    }
    result.push(`<path d="${d}" ${attrParts.join(' ')}/>`);
  }
  return result;
}

// ─── Rect processing pipeline ───────────────────────────────────────

function processRects(els: string[]): string[] {
  const rects: Rect[] = [];
  for (const el of els) {
    const r = parseRectEl(el);
    if (r) rects.push(r);
  }
  if (rects.length === 0) return [];
  return mergeRects(rects).map(serializeRect);
}

// ─── Main entry point ───────────────────────────────────────────────

export function simplifySVG(elements: string[]): string[] {
  if (elements.length === 0) return [];

  // Classify and track visual keys
  interface Classified {
    type: 'path' | 'rect' | 'other';
    el: string;
    vk: string;
  }
  const items: Classified[] = elements.map(el => {
    if (el.startsWith('<path ')) {
      const a = parseAttrs(el);
      return { type: 'path', el, vk: a ? pathVisKey(a) : '' };
    }
    if (el.startsWith('<rect ')) {
      const a = parseAttrs(el);
      return { type: 'rect', el, vk: a ? rectVisKey(a) : '' };
    }
    return { type: 'other', el, vk: '' };
  });

  // Group by type+key
  const pathsByVK = new Map<string, string[]>();
  const rectsByVK = new Map<string, string[]>();
  for (const it of items) {
    if (it.type === 'path') {
      let g = pathsByVK.get(it.vk);
      if (!g) { g = []; pathsByVK.set(it.vk, g); }
      g.push(it.el);
    } else if (it.type === 'rect') {
      let g = rectsByVK.get(it.vk);
      if (!g) { g = []; rectsByVK.set(it.vk, g); }
      g.push(it.el);
    }
  }

  // Process each group
  const mergedPaths = new Map<string, string[]>();
  for (const [k, els] of pathsByVK) mergedPaths.set(k, processPaths(els));

  const mergedRects = new Map<string, string[]>();
  for (const [k, els] of rectsByVK) mergedRects.set(k, processRects(els));

  // Rebuild: emit processed group at position of first occurrence
  const emittedP = new Set<string>();
  const emittedR = new Set<string>();
  const result: string[] = [];

  for (const it of items) {
    if (it.type === 'path') {
      if (!emittedP.has(it.vk)) {
        emittedP.add(it.vk);
        const processed = mergedPaths.get(it.vk);
        if (processed) result.push(...processed);
      }
    } else if (it.type === 'rect') {
      if (!emittedR.has(it.vk)) {
        emittedR.add(it.vk);
        const processed = mergedRects.get(it.vk);
        if (processed) result.push(...processed);
      }
    } else {
      result.push(it.el);
    }
  }

  return result;
}
