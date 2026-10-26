import { findItem } from '@/engine/compositionOps';
import { worldSnapshot, type LeafWorldSnapshot } from '@/engine/worldSnapshot';
import type { CompositionState, PathSegment, SVGObject } from '@/engine/types';
import { rotatedAabb } from '@/editor/resizeMath';
import { worldTurnDeg } from '../transformGestures';
import { graphOf } from '@/engine/sceneHitFrame';
import { matApplyPoint } from '@/engine/sceneTransform';
import { drawnLeaf } from '../drawnPose';
import {
  buildGroupSelectedMulti, buildPlaceShape, buildResizeNodes, buildRotateNodeFree, commitEntry,
  createEditorSession,
} from '../editorSession';
import { commitCanvasPaint, createCanvasPaintWorking, stampCanvasPaint } from '@/engine/canvasPaint';
import { createPaintObjectFromTiles, mintPaintObjectId } from '@/engine/paintObject';
import type { PaintObject, RGBColor } from '@/engine/types';
import { makeBlankComposition } from '@/editor/blankComposition';
import { makeViewport, type ImageObject, type TextObject } from '@/engine/types';
import type {
  CommonFormatIssue, PromptStep, ScaffoldEditorConfig, ScaffoldNode,
} from '../formats/editorConfig';
import { SLOT_TEXT_DEFAULT_STYLE } from '../formats/scaffold';

// Shared fixtures for the editor package's tests (the apps' own copies add
// the fixtures that need a format: a stored Reimagine page, say).

/** The unfilled photo placeholder as an app spells it (its sentinel imageId
 *  is the app's own word, persisted in its pages): a made-up one for the
 *  package's tests. */
export const TEST_PHOTO_PLACEHOLDER = {
  imageId: 'test:photo-placeholder', mime: 'image/png' as const, pixelW: 8, pixelH: 8,
};

/**
 * The cheapest committable PAINT ISLAND: one dab of ink at (x, y), so the
 * object's 1:1 bbox == contentRect hugs that dab. Shared by every suite that
 * needs a real island in `state.paintObjects` — remember to register the id
 * in `state.sceneOrder` too, the way a commit does.
 *
 * Stamp at a texel center (k/8 + 1/16, e.g. 20.0625) when a test samples the
 * exact texel back: off-center, the Gaussian falloff deposits at srcA < 1.
 */
export function makePaintIsland(
  x: number,
  y: number,
  opts: { radius?: number; color?: RGBColor; alpha?: number } = {},
): PaintObject {
  const w = createCanvasPaintWorking();
  stampCanvasPaint(w, x, y, opts.radius ?? 1, opts.color ?? { r: 255, g: 0, b: 0 }, opts.alpha ?? 1);
  return createPaintObjectFromTiles(mintPaintObjectId(), commitCanvasPaint(w))!;
}

// ── Rendered pose ──────────────────────────────────────────────────────
// What a node LOOKS like, independent of how the legacy view spells it.
// One pose has many spellings in the legacy fields — a turn of -30 and one
// of 330, a flip about one axis and a flip about the other plus a half
// turn — and the scene graph keeps the pose, not the wording. Tests that
// care where something is read it through these.

/** The world-space snapshot of one leaf: content box, centre, one
 *  canonical turn, one flip bit, drawn path. */
export function poseOf(state: CompositionState, id: string): LeafWorldSnapshot {
  const snap = worldSnapshot(state).find((s) => s.id === id);
  if (!snap) throw new Error(`no leaf ${id}`);
  return snap;
}

/** The turn a node is drawn at, in (-180, 180] — what the rotate slider
 *  seats on. 0 for a node that carries none. */
export function turnOf(state: CompositionState, id: string): number {
  return worldTurnDeg(state, id);
}

/** The axis-aligned box a node's DRAWN content occupies: an svg's path
 *  box turned by its angle, a bbox kind's box as stored (its own turn is
 *  already folded into the stored box's swap and its free angle into the
 *  AABB). */
export function drawnAabb(state: CompositionState, id: string) {
  const ref = findItem(state, id);
  if (!ref) throw new Error(`no item ${id}`);
  const { cellX, cellY, cellWidth, cellHeight } = ref.item;
  const angle = (ref.item as { angleDeg?: number }).angleDeg ?? 0;
  return rotatedAabb({ cellX, cellY, cellWidth, cellHeight }, angle);
}

/** The world path an svg is drawn as, its own free angle applied. */
export function drawnSegments(state: CompositionState, id: string): PathSegment[] {
  const ref = findItem(state, id);
  if (!ref || ref.kind !== 'svg') throw new Error(`no svg ${id}`);
  const svg = ref.item as SVGObject;
  const angle = svg.angleDeg ?? 0;
  if (!angle) return svg.segments.map((seg) => ({ ...seg }));
  const cx = svg.cellX + svg.cellWidth / 2, cy = svg.cellY + svg.cellHeight / 2;
  const rad = (angle * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const turn = (p: readonly [number, number]): [number, number] => {
    const dx = p[0] - cx, dy = p[1] - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  };
  return svg.segments.map((seg) => seg.kind === 'arc'
    ? { kind: 'arc', start: turn(seg.start), end: turn(seg.end), center: turn(seg.center) }
    : { kind: 'line', start: turn(seg.start), end: turn(seg.end) });
}

/** Every vertex of `a` within 1e-6 of its counterpart in `b`, after
 *  `map` is applied to `b`'s points. */
export function expectSegmentsClose(
  a: readonly PathSegment[], b: readonly PathSegment[],
  map: (p: readonly [number, number]) => readonly [number, number] = (p) => p,
): void {
  expect(a.length).toBe(b.length);
  a.forEach((seg, i) => {
    const other = b[i];
    expect(seg.kind).toBe(other.kind);
    const pts: [readonly [number, number], readonly [number, number]][] = [
      [seg.start, map(other.start)], [seg.end, map(other.end)],
    ];
    if (seg.kind === 'arc' && other.kind === 'arc') pts.push([seg.center, map(other.center)]);
    for (const [p, q] of pts) {
      expect(p[0]).toBeCloseTo(q[0], 6);
      expect(p[1]).toBeCloseTo(q[1], 6);
    }
  });
}

/**
 * A paint island the legacy fields CANNOT describe: turned off the
 * quarters, bound into a group, and the group then stretched along one
 * axis. What it is drawn as is a parallelogram, and a box plus an angle
 * can only name the nearest rectangle around it (plan §2.9) — so every
 * reader still spelling the pose out of those fields answers about ground
 * the ink does not cover, and misses ground it does.
 *
 * Two dabs far apart, so the island's box is much larger than either: a
 * blob at the centre would read the same both ways, since the nearest
 * rectangle shares the true shape's centre.
 *
 * Returns the state, the island as it was BEFORE the transform (its tile
 * coordinates are world coordinates there), and `at` — where the first dab
 * is drawn now, taken from the graph.
 */
export function shearedIslandFixture(): {
  state: CompositionState;
  island: PaintObject;
  at: [number, number];
} {
  const w = createCanvasPaintWorking();
  stampCanvasPaint(w, 18.0625, 18.0625, 0.5, { r: 255, g: 0, b: 0 }, 1);
  stampCanvasPaint(w, 26.0625, 26.0625, 0.5, { r: 0, g: 0, b: 255 }, 1);
  const island = createPaintObjectFromTiles('pnt_sheared', commitCanvasPaint(w)!)!;
  let session = createEditorSession({
    ...makeBlankComposition('occ_shear'),
    paintObjects: [island],
    sceneOrder: [island.id],
  });
  // A second member, so the group has room to stretch around the island.
  const rect = buildPlaceShape(
    'rect', { cellX: 30, cellY: 18, cellWidth: 4, cellHeight: 4 }, { r: 40, g: 40, b: 40 },
  );
  session = commitEntry(session, rect);
  const ids = [island.id, rect.id!];
  session = commitEntry(session, buildRotateNodeFree(session.state, island.id, 40)!);
  session = commitEntry(session, buildGroupSelectedMulti(session.state, ids)!);
  session = commitEntry(session, buildResizeNodes(
    session.state, ids,
    { cellX: 16, cellY: 16, cellWidth: 20, cellHeight: 8 },
    { cellX: 16, cellY: 16, cellWidth: 44, cellHeight: 8 },
  )!);
  const d = drawnLeaf(graphOf(session.state), island.id)!;
  return {
    state: session.state,
    island,
    at: matApplyPoint(d.world, 18.0625 - island.cellX, 18.0625 - island.cellY),
  };
}

/**
 * A stand-in for an SVG element, for the screen-space chrome writers that
 * build DOM by hand — `regionChromeScreen`'s veil, midline, markers, board
 * outline and forward arrow, and `symmetryAxesScreen`'s axes. There is no
 * renderer in these suites (react-native resolves to a stub), so the
 * writers are driven against this and their output read back off it.
 *
 * Shared because three suites wanted the same fake for writers in the SAME
 * module: this package's forwardArrow.test and each app's regionMarkerPop.
 * Kept here rather than in any one of them (docs/shared-editor.md §4.2
 * item 5).
 */
export class FakeEl {
  attrs = new Map<string, string>();
  style: Record<string, string> = {};
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  constructor(readonly tag: string) {}
  setAttribute(k: string, v: string): void { this.attrs.set(k, String(v)); }
  getAttribute(k: string): string | null { return this.attrs.has(k) ? this.attrs.get(k)! : null; }
  removeAttribute(k: string): void { this.attrs.delete(k); }
  appendChild(c: FakeEl): FakeEl { c.parent = this; this.children.push(c); return c; }
  /** The writer puts the board's frame straight AFTER the veil (so the
   *  outline is drawn on the grey), which is the one bit of ordering it
   *  asks the DOM for. */
  after(c: FakeEl): void {
    c.parent = this.parent;
    const sibs = this.parent?.children;
    if (sibs) sibs.splice(sibs.indexOf(this) + 1, 0, c);
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this);
    this.parent = null;
  }
  replaceChildren(): void { this.children = []; }
  get childNodes(): FakeEl[] { return this.children; }
  /** The one child a single-path writer mints and then reuses
   *  (`writeForwardArrow`), rather than querying for it per frame. */
  get firstChild(): FakeEl | null { return this.children[0] ?? null; }
  querySelector(sel: string): FakeEl | null { return this.querySelectorAll(sel)[0] ?? null; }
  querySelectorAll(sel: string): FakeEl[] {
    const m = /^(\w+)\[([\w-]+)\]$/.exec(sel);
    if (!m) throw new Error(`unhandled selector ${sel}`);
    return this.children.filter((c) => c.tag === m[1] && c.attrs.has(m[2]));
  }
}

// ── The format layer's fixtures (stage 6.3d) ────────────────────────────
//
// A made-up app, the way `editorConfig.test.ts`'s `AppEditorConfig` and
// 6.1's `loadPackFonts.test.ts` make one up: the config fixture below is a
// scaffolded format with a closed format id of its own, because a format id
// is each app's union and the package's suites must not borrow one. Both
// apps' `web/formats/__tests__/test-utils.ts` held these verbatim (the
// CompositionState fixture, the slot/text/image makers, the mint) under a
// Haiku name; each now re-exports them and keeps the fixtures that need a
// format of its own.

/** The made-up app's format ids — a closed union, as every app's is. */
export type TestFormatId = 'scaffolded' | 'blank';

export interface TestEditorConfig extends ScaffoldEditorConfig {
  formatId: TestFormatId;
}

/**
 * A CompositionState the engine's reducers accept, built from the pieces a
 * test hands in. Mirrors the engine's own minimal inline fixture
 * (packages/engine/src/__tests__/imageSceneObject.test.ts) so `applyCompOps`
 * sees exactly the shape it expects.
 */
export function makeScaffoldState(parts: Partial<CompositionState> = {}): CompositionState {
  const figures = parts.figures ?? [];
  const svgObjects = parts.svgObjects ?? [];
  const images = parts.images ?? [];
  const texts = parts.texts ?? [];
  return {
    id: 'test',
    name: 'test',
    figures,
    svgObjects,
    images,
    texts,
    imageBlobs: {},
    lineDraft: null,
    arcDraft: null,
    editingLineId: null,
    selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups: [],
    sceneOrder: [
      ...images.map((i) => i.id),
      ...figures.map((f) => f.id),
      ...svgObjects.map((s) => s.id),
      ...texts.map((t) => t.id),
    ],
    gridLevel: 0,
    strokeScale: 8,
    gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null,
    compTool: 'select',
    createRegion: null,
    renderGeneration: 0,
    ...parts,
  };
}

export function makeImage(id: string, overrides: Partial<ImageObject> = {}): ImageObject {
  return {
    id,
    imageId: 'blob_' + id,
    mimeType: 'image/png',
    pixelWidth: 1024,
    pixelHeight: 768,
    cellX: 0,
    cellY: 0,
    cellWidth: 8,
    cellHeight: 6,
    ...overrides,
  };
}

export function makeText(id: string, content: string, overrides: Partial<TextObject> = {}): TextObject {
  return {
    id,
    content,
    style: { ...SLOT_TEXT_DEFAULT_STYLE },
    cellX: 0,
    cellY: 0,
    cellWidth: 8,
    cellHeight: 2,
    ...overrides,
  };
}

/** One image slot and three text slots — the shape CozyJournal's Daily Haiku
 *  seeds, which is what these fixtures were written against. */
export const SCAFFOLD_FOUR_SLOTS: ScaffoldNode[] = [
  { kind: 'imageSlot', slotId: 'photo', hint: 'Tap to add your photo', cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 24 },
  { kind: 'textSlot', slotId: 'line1', hint: '5 syllables', placeholder: 'First line…', style: {}, cellX: 2, cellY: 24, cellWidth: 28, cellHeight: 2 },
  { kind: 'textSlot', slotId: 'line2', hint: '7 syllables', placeholder: 'Second line…', style: {}, cellX: 2, cellY: 26, cellWidth: 28, cellHeight: 2 },
  { kind: 'textSlot', slotId: 'line3', hint: '5 syllables', placeholder: 'Third line…', style: {}, cellX: 2, cellY: 28, cellWidth: 28, cellHeight: 2 },
];

export const SCAFFOLD_FOUR_PROMPT_FLOW: PromptStep[] = [
  { id: 'p-photo', kind: 'fillSlot', slotId: 'photo', title: 'Add a photo from your day' },
  { id: 'p-line1', kind: 'fillSlot', slotId: 'line1', title: 'Write the first line' },
  { id: 'p-line2', kind: 'fillSlot', slotId: 'line2', title: 'Write the second line' },
  { id: 'p-line3', kind: 'fillSlot', slotId: 'line3', title: 'Write the third line' },
  { id: 'p-free', kind: 'free' },
];

export function makeScaffoldConfig(overrides: Partial<TestEditorConfig> = {}): TestEditorConfig {
  return {
    formatId: 'scaffolded',
    canvas: { aspect: 1 },
    tools: ['arrange', 'photos', 'text', 'color'],
    scaffold: SCAFFOLD_FOUR_SLOTS,
    promptFlow: SCAFFOLD_FOUR_PROMPT_FLOW,
    completion: { kind: 'allSlotsFilled' },
    ...overrides,
  };
}

export function makeFormatIssue(payload?: Record<string, unknown>): CommonFormatIssue {
  return { formatId: 'scaffolded', isoDate: '2026-07-28', label: 'Scaffolded', payload };
}

/** Deterministic mintId honoring the engine id namespaces, recording calls. */
export function makeMintId(): { mintId: (kind: 'svg' | 'text' | 'image' | 'group') => string; calls: string[] } {
  const calls: string[] = [];
  let n = 0;
  const prefix = { svg: 'svg_', text: 'txt_', image: 'img_', group: 'grp_' } as const;
  return {
    calls,
    mintId: (kind) => {
      calls.push(kind);
      return prefix[kind] + 's' + n++;
    },
  };
}
