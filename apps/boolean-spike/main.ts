/**
 * Boolean Garden — playable spike for the boolean-geometry-puzzles project.
 *
 * v0 kernel: every shape is a polygon-clipping MultiPolygon (circles sampled
 * at 96 points). All four ops run through polygon-clipping. Exact-arc union
 * via the engine's unionOutline is the planned v1 upgrade; this build exists
 * to answer feel questions (see projects/boolean-geometry-puzzles/overview.md
 * in UnderwayNotes).
 */
import * as polygonClipping from 'polygon-clipping';
import { tween, cubicOut, backOut, mix, TweenOpts } from '../../packages/engine/src/motion';
import { feel, primeAudio } from './feel';

type Pair = [number, number];
type Ring = Pair[];
type Poly = Ring[];
type MultiPoly = Poly[];

const pc = polygonClipping as unknown as {
  union: (a: MultiPoly, b: MultiPoly) => MultiPoly;
  intersection: (a: MultiPoly, b: MultiPoly) => MultiPoly;
  difference: (a: MultiPoly, b: MultiPoly) => MultiPoly;
  xor: (a: MultiPoly, b: MultiPoly) => MultiPoly;
};

// ── Geometry helpers ─────────────────────────────────────────────────

function circle(cx: number, cy: number, r: number, n = 96): MultiPoly {
  const ring: Ring = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return [[ring]];
}

function square(cx: number, cy: number, half: number, rotDeg = 0): MultiPoly {
  const a = (rotDeg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const pts: Pair[] = [[-half, -half], [half, -half], [half, half], [-half, half]];
  return [[pts.map(([x, y]): Pair => [cx + x * c - y * s, cy + x * s + y * c])]];
}

function translate(mp: MultiPoly, dx: number, dy: number): MultiPoly {
  return mp.map(poly => poly.map(ring => ring.map(([x, y]): Pair => [x + dx, y + dy])));
}

function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** Upper-bound area: holes count positive too — fine for a ~zero test. */
function mpArea(mp: MultiPoly): number {
  let sum = 0;
  for (const poly of mp) for (const ring of poly) sum += ringArea(ring);
  return sum;
}

function centroid(mp: MultiPoly): Pair {
  let sx = 0, sy = 0, n = 0;
  for (const poly of mp) for (const [x, y] of poly[0]) { sx += x; sy += y; n++; }
  return n ? [sx / n, sy / n] : [0, 0];
}

function pathD(mp: MultiPoly): string {
  let d = '';
  for (const poly of mp) {
    for (const ring of poly) {
      d += `M ${ring[0][0].toFixed(2)} ${ring[0][1].toFixed(2)} `;
      for (let i = 1; i < ring.length; i++) d += `L ${ring[i][0].toFixed(2)} ${ring[i][1].toFixed(2)} `;
      d += 'Z ';
    }
  }
  return d;
}

function pointInMp(mp: MultiPoly, px: number, py: number): boolean {
  // Even-odd across every ring, so holes exclude correctly.
  let inside = false;
  for (const poly of mp) {
    for (const ring of poly) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
    }
  }
  return inside;
}

// ── Puzzles ──────────────────────────────────────────────────────────

interface Shape { id: number; mp: MultiPoly; }
interface Puzzle {
  name: string;
  hint: string;
  par: number;
  shelf: () => MultiPoly[];
  target: () => MultiPoly;
}

const CX = 410, CY = 240; // board center (leaving room below for the shelf row)

const PUZZLES: Puzzle[] = [
  {
    name: 'No. 1 — Moon',
    hint: 'Select the big circle, then the small one. Take one away from the other.',
    par: 1,
    shelf: () => [circle(CX, CY, 110), circle(CX + 55, CY - 25, 95)],
    target: () => pc.difference(circle(CX, CY, 110), circle(CX + 55, CY - 25, 95)),
  },
  {
    name: 'No. 2 — Lens',
    hint: 'The same two circles. This time, keep only what they share.',
    par: 1,
    shelf: () => [circle(CX - 55, CY, 100), circle(CX + 55, CY, 100)],
    target: () => pc.intersection(circle(CX - 55, CY, 100), circle(CX + 55, CY, 100)),
  },
  {
    name: 'No. 3 — Ring',
    hint: 'A hole is a shape too.',
    par: 1,
    shelf: () => [circle(CX, CY, 115), circle(CX, CY, 65)],
    target: () => pc.difference(circle(CX, CY, 115), circle(CX, CY, 65)),
  },
  {
    name: 'No. 4 — Heart',
    hint: 'Two circles and a tilted square. Build it in two joins.',
    par: 2,
    shelf: () => [
      circle(CX - 46, CY - 46, 65),
      circle(CX + 46, CY - 46, 65),
      square(CX, CY, 65, 45),
    ],
    target: () => pc.union(
      pc.union(circle(CX - 46, CY - 46, 65), circle(CX + 46, CY - 46, 65)),
      square(CX, CY, 65, 45),
    ),
  },
  {
    name: 'No. 5 — Flower',
    hint: 'Four petals, each the lens of a pair. Then gather them.',
    par: 7,
    shelf: () => {
      const shapes: MultiPoly[] = [];
      const R = 78, D = 44;
      // Four petal pairs: N, E, S, W. Each pair overlaps along its axis.
      const axes: Pair[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      for (const [ax, ay] of axes) {
        const px = CX + ax * 72, py = CY + ay * 72;
        // Pair offset perpendicular to petal axis so the lens points outward.
        shapes.push(circle(px - ay * D, py - ax * D, R));
        shapes.push(circle(px + ay * D, py + ax * D, R));
      }
      return shapes;
    },
    target: () => {
      const R = 78, D = 44;
      const axes: Pair[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      let acc: MultiPoly | null = null;
      for (const [ax, ay] of axes) {
        const px = CX + ax * 72, py = CY + ay * 72;
        const petal = pc.intersection(
          circle(px - ay * D, py - ax * D, R),
          circle(px + ay * D, py + ax * D, R),
        );
        acc = acc ? pc.union(acc, petal) : petal;
      }
      return acc!;
    },
  },
];

// ── State ────────────────────────────────────────────────────────────

const svg = document.getElementById('board') as unknown as SVGSVGElement;
const statusEl = document.getElementById('status')!;
const nameEl = document.getElementById('puzzleName')!;
const parEl = document.getElementById('par')!;
const galleryEl = document.getElementById('gallery')!;
const btnUnion = document.getElementById('opUnion') as HTMLButtonElement;
const btnSubtract = document.getElementById('opSubtract') as HTMLButtonElement;
const btnIntersect = document.getElementById('opIntersect') as HTMLButtonElement;
const btnExclude = document.getElementById('opExclude') as HTMLButtonElement;
const btnUndo = document.getElementById('undo') as HTMLButtonElement;
const btnRestart = document.getElementById('restart') as HTMLButtonElement;
const btnNext = document.getElementById('next') as HTMLButtonElement;

const FILLS = ['rgba(79,167,154,0.50)', 'rgba(224,112,90,0.50)', 'rgba(217,180,91,0.45)',
               'rgba(130,150,220,0.45)', 'rgba(170,120,190,0.45)'];

let puzzleIdx = 0;
let shapes: Shape[] = [];
let target: MultiPoly = [];
let targetArea = 1;
let selected: number[] = []; // shape ids, in click order
let opsUsed = 0;
let solved = false;
let nextId = 1;
let undoStack: { shapes: Shape[]; opsUsed: number }[] = [];
const galleryNodes: (SVGElement | null)[] = []; // per-puzzle, so replays replace

function loadPuzzle(i: number): void {
  const p = PUZZLES[i];
  shapes = p.shelf().map(mp => ({ id: nextId++, mp }));
  target = p.target();
  targetArea = mpArea(target);
  selected = [];
  opsUsed = 0;
  solved = false;
  undoStack = [];
  nameEl.textContent = p.name;
  parEl.textContent = `par ${p.par}`;
  statusEl.textContent = p.hint;
  statusEl.classList.remove('solved');
  btnNext.style.display = 'none';
  btnNext.textContent = 'Next puzzle →';
  render();
  enterShapes();
}

// ── Rendering ────────────────────────────────────────────────────────

const NS = 'http://www.w3.org/2000/svg';

const REDUCED = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Tween that collapses to its end state under prefers-reduced-motion. */
function animate(opts: TweenOpts): void {
  if (REDUCED) { opts.onUpdate(1); opts.onComplete?.(); return; }
  tween(opts);
}

/** Transient effect layer on top of the board; render() wipes it with the rest. */
function fxLayer(): SVGGElement {
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('pointer-events', 'none');
  svg.appendChild(g);
  return g;
}

function render(): void {
  svg.innerHTML = '';

  // Target ghost
  const ghost = document.createElementNS(NS, 'path');
  ghost.setAttribute('d', pathD(target));
  ghost.setAttribute('fill', 'none');
  ghost.setAttribute('stroke', 'rgba(232,226,212,0.30)');
  ghost.setAttribute('stroke-dasharray', '5 5');
  ghost.setAttribute('stroke-width', '1.5');
  ghost.setAttribute('fill-rule', 'evenodd');
  svg.appendChild(ghost);

  for (const s of shapes) {
    const sel = selected.indexOf(s.id);
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', pathD(s.mp));
    path.setAttribute('fill', solved && shapes.length === 1
      ? 'rgba(217,180,91,0.65)'
      : FILLS[s.id % FILLS.length]);
    path.setAttribute('fill-rule', 'evenodd');
    path.setAttribute('stroke', sel >= 0 ? '#d9b45b' : 'rgba(232,226,212,0.35)');
    path.setAttribute('stroke-width', sel >= 0 ? '2.5' : '1');
    path.setAttribute('data-id', String(s.id));
    path.style.cursor = 'pointer';
    svg.appendChild(path);

    if (sel >= 0) {
      const [cx, cy] = centroid(s.mp);
      const badge = document.createElementNS(NS, 'circle');
      badge.setAttribute('cx', String(cx)); badge.setAttribute('cy', String(cy));
      badge.setAttribute('r', '11');
      badge.setAttribute('fill', '#d9b45b');
      svg.appendChild(badge);
      const num = document.createElementNS(NS, 'text');
      num.setAttribute('x', String(cx)); num.setAttribute('y', String(cy + 4.5));
      num.setAttribute('text-anchor', 'middle');
      num.setAttribute('font-size', '13');
      num.setAttribute('fill', '#1c2422');
      num.textContent = String(sel + 1);
      svg.appendChild(num);
    }
  }
  updateButtons();
}

function updateButtons(): void {
  const two = selected.length === 2 && !solved;
  // aria-disabled instead of disabled so a click can explain itself
  for (const b of [btnUnion, btnSubtract, btnIntersect, btnExclude]) {
    b.classList.toggle('inactive', !two);
  }
  btnUndo.disabled = undoStack.length === 0 || solved;
  btnRestart.disabled = undoStack.length === 0 && !solved;
}

// ── Effects (all skipped under prefers-reduced-motion) ───────────────

/** Stagger the shelf in when a puzzle loads. */
function enterShapes(): void {
  if (REDUCED) return;
  const paths = Array.from(svg.querySelectorAll<SVGPathElement>('path[data-id]'));
  paths.forEach((p, i) => {
    p.setAttribute('opacity', '0');
    animate({
      duration: 240, delay: i * 60, ease: cubicOut,
      onUpdate: t => p.setAttribute('opacity', String(t)),
    });
  });
}

/** The op moment: operands linger as fading ghosts, the result settles in with a glint. */
function opMoment(ghosts: { d: string; fill: string }[], created: Shape): void {
  if (REDUCED) return;
  const ghostLayer = fxLayer();
  for (const ghost of ghosts) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', ghost.d);
    p.setAttribute('fill', ghost.fill);
    p.setAttribute('fill-rule', 'evenodd');
    ghostLayer.appendChild(p);
  }
  animate({
    duration: 220, ease: cubicOut,
    onUpdate: t => ghostLayer.setAttribute('opacity', String(0.5 * (1 - t))),
  });

  const glintLayer = fxLayer();
  const glint = document.createElementNS(NS, 'path');
  glint.setAttribute('d', pathD(created.mp));
  glint.setAttribute('fill', 'none');
  glint.setAttribute('stroke', '#d9b45b');
  glintLayer.appendChild(glint);
  animate({
    duration: 450, ease: cubicOut,
    onUpdate: t => {
      glint.setAttribute('opacity', String(0.9 * (1 - t)));
      glint.setAttribute('stroke-width', String(mix(3, 1, t)));
    },
    onComplete: () => { ghostLayer.remove(); glintLayer.remove(); },
  });

  const live = svg.querySelector<SVGPathElement>(`path[data-id="${created.id}"]`);
  if (live) {
    const [cx, cy] = centroid(created.mp);
    animate({
      duration: 320, ease: backOut,
      onUpdate: t => {
        const s = mix(0.96, 1, t);
        live.setAttribute('transform',
          `translate(${cx} ${cy}) scale(${s}) translate(${-cx} ${-cy})`);
      },
      onComplete: () => live.removeAttribute('transform'),
    });
  }
}

/** Solve celebration: gold-and-teal sparks fly off the finished outline. */
function celebrate(mp: MultiPoly, grand: boolean): void {
  if (REDUCED) return;
  const g = fxLayer();
  const [cx, cy] = centroid(mp);
  const pts: Pair[] = [];
  for (const poly of mp) {
    for (const ring of poly) {
      const step = Math.max(1, Math.floor(ring.length / (grand ? 18 : 10)));
      for (let i = 0; i < ring.length; i += step) pts.push(ring[i]);
    }
  }
  const colors = ['#d9b45b', '#4fa79a', '#e8e2d4'];
  const parts = pts.map(([x, y]) => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('r', String(1.5 + Math.random() * 2));
    c.setAttribute('fill', colors[Math.floor(Math.random() * colors.length)]);
    g.appendChild(c);
    const ang = Math.atan2(y - cy, x - cx) + (Math.random() - 0.5) * 0.6;
    const speed = 60 + Math.random() * (grand ? 160 : 110);
    return { x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed - 40 };
  });
  const life = grand ? 1100 : 850;
  animate({
    duration: life,
    onUpdate: t => {
      const s = (t * life) / 1000; // seconds of simulated flight
      g.setAttribute('opacity', String(1 - t));
      parts.forEach((p, i) => {
        const el = g.childNodes[i] as SVGCircleElement;
        el.setAttribute('cx', String(p.x + p.vx * s));
        el.setAttribute('cy', String(p.y + p.vy * s + 90 * s * s));
      });
    },
    onComplete: () => g.remove(),
  });
}

// ── Interaction ──────────────────────────────────────────────────────

let drag: { id: number; lastX: number; lastY: number; moved: boolean } | null = null;

function svgPoint(ev: PointerEvent): Pair {
  const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(svg.getScreenCTM()!.inverse());
  return [pt.x, pt.y];
}

function shapeAt(x: number, y: number): Shape | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    if (pointInMp(shapes[i].mp, x, y)) return shapes[i];
  }
  return null;
}

svg.addEventListener('pointerdown', (ev) => {
  if (solved) return;
  const [x, y] = svgPoint(ev);
  const hit = shapeAt(x, y);
  if (!hit) return;
  drag = { id: hit.id, lastX: x, lastY: y, moved: false };
  svg.setPointerCapture(ev.pointerId);
});

svg.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  const [x, y] = svgPoint(ev);
  const dx = x - drag.lastX, dy = y - drag.lastY;
  // Generous click-vs-drag threshold: trackpad taps often jitter a few px
  if (!drag.moved && Math.hypot(dx, dy) < 7) return;
  drag.moved = true;
  const s = shapes.find(sh => sh.id === drag!.id);
  if (s) { s.mp = translate(s.mp, dx, dy); drag.lastX = x; drag.lastY = y; render(); }
});

svg.addEventListener('pointerup', () => {
  if (!drag) return;
  if (!drag.moved) {
    // Click: toggle selection (max two, ordered)
    const id = drag.id;
    const at = selected.indexOf(id);
    if (at >= 0) selected.splice(at, 1);
    else { selected.push(id); if (selected.length > 2) selected.shift(); feel('select'); }
    if (!solved) {
      statusEl.textContent = selected.length === 1
        ? 'One selected — pick a second shape, then choose an operation.'
        : selected.length === 2 ? 'Now choose: union, subtract, intersect, or exclude.' : '';
    }
    render();
  } else {
    checkSolved(); // a drag can complete a puzzle (drop into place)
  }
  drag = null;
});

function applyOp(op: 'union' | 'intersection' | 'difference' | 'xor'): void {
  if (solved) {
    statusEl.textContent = 'This one is finished — Next puzzle, or Restart to replay it.';
    return;
  }
  if (selected.length !== 2) {
    statusEl.textContent = selected.length === 0
      ? 'First click two shapes to choose them.'
      : 'Pick one more shape — operations combine exactly two.';
    return;
  }
  const a = shapes.find(s => s.id === selected[0])!;
  const b = shapes.find(s => s.id === selected[1])!;
  const result = pc[op](a.mp, b.mp);
  if (mpArea(result) < 1) {
    statusEl.textContent = 'That leaves nothing — try the other order, or a different pair.';
    return;
  }
  undoStack.push({ shapes: shapes.map(s => ({ ...s })), opsUsed });
  const ghosts = [a, b].map(s => ({ d: pathD(s.mp), fill: FILLS[s.id % FILLS.length] }));
  const created: Shape = { id: nextId++, mp: result };
  shapes = shapes.filter(s => s.id !== a.id && s.id !== b.id);
  shapes.push(created);
  selected = [];
  opsUsed++;
  statusEl.textContent = '';
  render();
  opMoment(ghosts, created);
  feel(op);
  checkSolved();
}

function checkSolved(): void {
  if (solved) return;
  for (const s of shapes) {
    const mismatch = mpArea(pc.xor(s.mp, target));
    if (mismatch / targetArea < 0.02) {
      solved = true;
      const grand = puzzleIdx === PUZZLES.length - 1;
      statusEl.textContent = `Solved in ${opsUsed} — ${opsUsed <= PUZZLES[puzzleIdx].par ? 'par. ' : ''}It's yours now.`;
      statusEl.classList.add('solved');
      btnNext.style.display = '';
      if (grand) {
        statusEl.textContent += ' The garden is full.';
        btnNext.textContent = 'Play again ↺';
      }
      addToGallery(s.mp);
      render();
      celebrate(s.mp, grand);
      feel(grand ? 'gardenComplete' : 'solve');
      return;
    }
  }
}

function addToGallery(mp: MultiPoly): void {
  const mini = document.createElementNS(NS, 'svg');
  mini.setAttribute('viewBox', '0 0 820 520');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', pathD(mp));
  p.setAttribute('fill', 'rgba(217,180,91,0.8)');
  p.setAttribute('fill-rule', 'evenodd');
  mini.appendChild(p);
  const existing = galleryNodes[puzzleIdx];
  if (existing) galleryEl.replaceChild(mini, existing);
  else galleryEl.appendChild(mini);
  galleryNodes[puzzleIdx] = mini;
}

btnUnion.addEventListener('click', () => applyOp('union'));
btnSubtract.addEventListener('click', () => applyOp('difference'));
btnIntersect.addEventListener('click', () => applyOp('intersection'));
btnExclude.addEventListener('click', () => applyOp('xor'));
btnUndo.addEventListener('click', () => {
  const prev = undoStack.pop();
  if (!prev) return;
  shapes = prev.shapes;
  opsUsed = prev.opsUsed;
  selected = [];
  statusEl.textContent = '';
  feel('undo');
  render();
});
btnRestart.addEventListener('click', () => loadPuzzle(puzzleIdx));
btnNext.addEventListener('click', () => {
  if (puzzleIdx === PUZZLES.length - 1) puzzleIdx = 0; // play again from the top
  else puzzleIdx++;
  loadPuzzle(puzzleIdx);
});

// WebAudio needs a user gesture; prime on any pointerdown (idempotent).
document.addEventListener('pointerdown', primeAudio);

loadPuzzle(0);
