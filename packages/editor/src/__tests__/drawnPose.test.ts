/**
 * The node layer draws off the scene graph (P5 of CozyJournal's docs/transform-refactor.md).
 *
 * Every leaf is an outer element on its world AABB and an inner element
 * holding its LOCAL content, placed by one CSS `matrix()` — the node's
 * world matrix. These tests pin the math the layers call (drawnPose.ts):
 * that the matrix lands the local box exactly on the world corners the
 * graph says, for every spelling of a pose the legacy fields can carry;
 * that a bare legacy object (a ghost, a live-resize preview) is drawn as
 * the graph would draw it; that a stroke keeps its world width through a
 * scale; and that a leaf nothing moved keeps its identity, which is what
 * the memoised layers depend on.
 */

import { fromLegacy, worldSegments } from '@/engine/sceneGraph';
import { matApplyPoint, matIsSimilarity, matUniformScale } from '@/engine/sceneTransform';
import type {
  CompItemKind, CompositionState, ImageObject, PaintObject, PatternObject, SVGObject, TextObject,
} from '@/engine/types';
import { findItem } from '@/engine/compositionOps';
import { makeBlankComposition } from '@/editor/blankComposition';
import {
  buildGroupSelectedMulti, buildPlacePattern, buildPlacePhotoPlaceholder, buildPlaceSVGObject,
  buildPlaceShape, buildPlaceText, commitEntry, createEditorSession,
} from '../editorSession';
import { resizeBox, twistAbout } from '../transformGestures';
import {
  DrawnLeaf, boxFrame, drawnAabb, drawnCorners, drawnFrame, drawnLeaf, drawnLeafFor, drawnLeafOf, drawnLeaves,
  drawnLocalBox,
  patternDrawnObject, patternLayerMarkup, svgDrawnGeometry, svgLayerMarkup,
  svgLayerSplitMarkup,
} from '../drawnPose';
import { worldOffsetInNodeFrame } from '../effectsBoxShadow';
import { bboxLocalFrame, textPaintGeometry } from '../paintBrush';
import { makePaintIsland, TEST_PHOTO_PLACEHOLDER } from './test-utils';

const PX = 16;
const INK = { r: 40, g: 40, b: 40 };

/** Parse `matrix(a, b, c, d, e, f)` back into numbers (e, f in px). */
function parseMatrix(s: string): [number, number, number, number, number, number] {
  const m = /^matrix\(([^)]*)\)$/.exec(s);
  if (!m) throw new Error(`not a matrix: ${s}`);
  const n = m[1].split(',').map((t) => parseFloat(t));
  return [n[0], n[1], n[2], n[3], n[4], n[5]];
}

/** Where the inner element's local px point lands on the world layer, in
 *  px: through the inner matrix (origin at its top-left), then the outer
 *  element's offset. */
function innerToWorldPx(frame: ReturnType<typeof drawnFrame>, x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = parseMatrix(frame.inner.transform);
  return [a * x + c * y + e + frame.outer.left, b * x + d * y + f + frame.outer.top];
}

function state(overrides: Partial<CompositionState>): CompositionState {
  return { ...makeBlankComposition('dp'), ...overrides };
}

const image = (extra: Partial<ImageObject> = {}): ImageObject => ({
  id: 'img', imageId: 'blob', pixelWidth: 40, pixelHeight: 20,
  cellX: 3, cellY: 5, cellWidth: 4, cellHeight: 2,
  ...extra,
} as ImageObject);

function expectFrameMatchesGraph(d: DrawnLeaf): void {
  const frame = drawnFrame(d, PX);
  const box = drawnLocalBox(d.node);
  const corners = drawnCorners(d);
  const local: [number, number][] = [[0, 0], [box.width, 0], [box.width, box.height], [0, box.height]];
  local.forEach(([x, y], i) => {
    const [wx, wy] = innerToWorldPx(frame, x * PX, y * PX);
    // The style string rounds to six decimals; sub-thousandth-pixel is exact.
    expect(wx).toBeCloseTo(corners[i][0] * PX, 3);
    expect(wy).toBeCloseTo(corners[i][1] * PX, 3);
  });
  // The outer element is the world AABB…
  const aabb = drawnAabb(d);
  expect(frame.outer.left).toBeCloseTo(aabb.x * PX, 9);
  expect(frame.outer.top).toBeCloseTo(aabb.y * PX, 9);
  expect(frame.outer.width).toBeCloseTo(Math.max(aabb.width, 0.05) * PX, 9);
  expect(frame.outer.height).toBeCloseTo(Math.max(aabb.height, 0.05) * PX, 9);
  // …and its centre is the content centre's image: the pivot a preview
  // matrix written onto the outer element turns about.
  const [cx, cy] = matApplyPoint(d.world, box.x + box.width / 2, box.y + box.height / 2);
  expect(frame.outer.left + frame.outer.width / 2).toBeCloseTo(cx * PX, 9);
  expect(frame.outer.top + frame.outer.height / 2).toBeCloseTo(cy * PX, 9);
}

describe('drawnFrame — the local box lands on the world corners', () => {
  test('an un-turned image: the inner element sits at the outer origin with the identity', () => {
    const d = drawnLeafOf('image', image());
    const frame = drawnFrame(d, PX);
    expect(frame.outer).toEqual({ left: 48, top: 80, width: 64, height: 32 });
    expect(frame.inner).toEqual({ width: 64, height: 32, transform: 'matrix(1, 0, 0, 1, 0, 0)' });
  });

  test.each([
    ['a quarter turn', { rotation: 90 }],
    ['a half turn', { rotation: 180 }],
    ['three quarters and a flip', { rotation: 270, mirrorH: true }],
    ['a free angle', { angleDeg: 33 }],
    ['every channel at once', { rotation: 90, angleDeg: -20, mirrorV: true }],
  ] as const)('%s', (_name, pose) => {
    const d = drawnLeafOf('image', image(pose as Partial<ImageObject>));
    // A quarter turn swaps the WORLD box; the local box is the un-turned one.
    const rot = (pose as { rotation?: number }).rotation;
    const swapped = rot === 90 || rot === 270;
    expect(drawnLocalBox(d.node)).toEqual({ x: 0, y: 0, width: swapped ? 2 : 4, height: swapped ? 4 : 2 });
    expectFrameMatchesGraph(d);
  });

  test('a horizontal line keeps a drawable height', () => {
    const line: SVGObject = {
      id: 'ln', color: INK, cellX: 1, cellY: 1, cellWidth: 4, cellHeight: 0,
      segments: [{ kind: 'line', start: [1, 1], end: [5, 1] }],
    } as unknown as SVGObject;
    const frame = drawnFrame(drawnLeafOf('svg', line), PX);
    expect(frame.outer.height).toBeCloseTo(0.05 * PX);
    expect(frame.inner.height).toBeCloseTo(0.05 * PX);
  });

  test('a matrix string carries no float noise and no units', () => {
    const d = drawnLeafOf('image', image({ angleDeg: 90 }));
    // cos(90°) is 6e-17 in floating point; the style must say 0.
    expect(drawnFrame(d, PX).inner.transform).not.toMatch(/e-/);
    // CSS matrix() takes six bare numbers: a `px` on the translation makes
    // the declaration invalid and the browser silently drops the transform
    // — a rotated line drawn flat along the top of its (correct) box.
    const turned = drawnFrame(drawnLeafOf('image', image({ angleDeg: 45 })), PX).inner.transform;
    expect(turned).toMatch(/^matrix\((-?[\d.]+, ){5}-?[\d.]+\)$/);
    expect(turned).not.toContain('px');
  });
});

describe('drawnLeafOf — a bare legacy object is drawn as the graph would draw it', () => {
  test.each([
    ['image', () => state({ images: [image({ rotation: 90, mirrorH: true, angleDeg: 15 })], sceneOrder: ['img'] }), 'img'],
    ['text', () => {
      const t = { id: 'txt', content: 'hi', style: { fontId: 'f', size: 1, color: INK }, cellX: 1, cellY: 1, cellWidth: 3, cellHeight: 1, rotation: 270 } as unknown as TextObject;
      return state({ texts: [t], sceneOrder: ['txt'] });
    }, 'txt'],
    ['svg', () => {
      const s = { id: 'path', color: INK, cellX: 2, cellY: 2, cellWidth: 4, cellHeight: 3, angleDeg: 33, segments: [{ kind: 'line', start: [2, 2], end: [6, 5] }] } as unknown as SVGObject;
      return state({ svgObjects: [s], sceneOrder: ['path'] });
    }, 'path'],
    ['paint', () => {
      const p = makePaintIsland(20.0625, 20.0625);
      return state({ paintObjects: [p], sceneOrder: [p.id] });
    }, null],
    ['pattern', () => {
      const p = { id: 'pat', cols: 2, rows: 2, cells: [], cellX: 4, cellY: 4, cellWidth: 4, cellHeight: 2, rotation: 90 } as unknown as PatternObject;
      return state({ patternObjects: [p], sceneOrder: ['pat'] });
    }, 'pat'],
  ] as const)('%s', (kind, make, wantId) => {
    const s = make();
    const id = wantId ?? s.paintObjects![0].id;
    const fromGraph = drawnLeaves(fromLegacy(s)).get(id)!;
    const bare = drawnLeafOf(kind as CompItemKind, findItem(s, id)!.item as ImageObject);
    expect(bare.node).toEqual(fromGraph.node);
    expect(bare.world).toEqual(fromGraph.world);
    expectFrameMatchesGraph(bare);
  });

  test('the same object is drawn as the same leaf — a memoised layer holds still', () => {
    const leaf = image();
    expect(drawnLeafOf('image', leaf)).toBe(drawnLeafOf('image', leaf));
    expect(drawnLeafOf('image', { ...leaf })).not.toBe(drawnLeafOf('image', leaf));
  });
});

describe('a member of a turned group, re-mounted mid-stroke', () => {
  // The colour brush re-mounts a recoloured shape's markup into the
  // element React already placed (CanvasSurface mountShapeContent), so the
  // geometry it writes must be the frame the LAYER drew that element in —
  // the graph's. Turning a group renders its members back out of the graph
  // as fresh legacy records (world-baked vertices), not as the nodes' own
  // content, so drawnLeafFor's identity check misses them and reads the
  // record in world axes: drawn into an element the turn already rotates,
  // every Patchwork patch a stroke reached came out turned twice and
  // stretched to its box (bug report b86a0076). Read by id instead.
  function turnedGroup() {
    let session = createEditorSession(makeBlankComposition('dp'));
    const a = buildPlaceShape('rect', { cellX: 0, cellY: 0, cellWidth: 3, cellHeight: 1 }, INK);
    session = commitEntry(session, a);
    const b = buildPlaceShape('rect', { cellX: 0, cellY: 3, cellWidth: 3, cellHeight: 1 }, INK);
    session = commitEntry(session, b);
    session = commitEntry(session, buildGroupSelectedMulti(session.state, [a.id!, b.id!])!);
    session = commitEntry(session, { entry: twistAbout(session.state, [a.id!, b.id!], [1.5, 2], 90)! });
    return { state: session.state, id: a.id! };
  }

  test('its legacy record is no longer the node’s content', () => {
    const { state, id } = turnedGroup();
    const leaf = state.svgObjects.find((o) => o.id === id)!;
    expect(leaf).not.toBe(state.graph!.nodes.get(id)!.content);
  });

  test('by id it is drawn in the layer’s own frame; through the record it is not', () => {
    const { state, id } = turnedGroup();
    const graph = state.graph!;
    const layer = drawnLeaves(graph).get(id)!;
    const byId = drawnLeaf(graph, id)!;
    expect(byId.node).toBe(layer.node);
    expect(byId.world).toEqual(layer.world);
    expect(svgDrawnGeometry(byId).box).toEqual(svgDrawnGeometry(layer).box);
    // The trap: the record's own reading is the world-axis box — 1 × 3
    // where the layer's element holds the un-turned 3 × 1.
    const viaRecord = drawnLeafFor('svg', state.svgObjects.find((o) => o.id === id)!, graph);
    const recBox = svgDrawnGeometry(viaRecord).box;
    const box = svgDrawnGeometry(layer).box;
    expect(recBox.width / recBox.height).not.toBeCloseTo(box.width / box.height, 3);
  });
});

describe('drawnLeaves — identity for a leaf nothing moved', () => {
  function scene() {
    let session = createEditorSession(makeBlankComposition('dp'));
    const a = buildPlaceShape('rect', { cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 }, INK);
    session = commitEntry(session, a);
    const b = buildPlaceShape('rect', { cellX: 4, cellY: 4, cellWidth: 2, cellHeight: 2 }, INK);
    session = commitEntry(session, b);
    const img = buildPlacePhotoPlaceholder({ cellX: 10, cellY: 0, cellWidth: 2, cellHeight: 1 }, TEST_PHOTO_PLACEHOLDER);
    session = commitEntry(session, img);
    return { session, aId: a.id!, bId: b.id!, imgId: img.id! };
  }

  test('a move of one leaf replaces its drawn leaf and no other', () => {
    const { session, aId, bId, imgId } = scene();
    const before = drawnLeaves(session.state.graph!);
    const moved = commitEntry(session, { entry: twistAbout(session.state, [aId], [1, 1], 30)! });
    const after = drawnLeaves(moved.state.graph!, before);
    expect(after.get(aId)).not.toBe(before.get(aId));
    expect(after.get(bId)).toBe(before.get(bId));
    expect(after.get(imgId)).toBe(before.get(imgId));
  });

  test('a member of a moved group is replaced — its node is the same, its world is not', () => {
    const { session, aId, bId, imgId } = scene();
    const s = commitEntry(session, buildGroupSelectedMulti(session.state, [aId, bId])!);
    const before = drawnLeaves(s.state.graph!);
    const turned = commitEntry(s, { entry: twistAbout(s.state, [aId, bId], [3, 3], 45)! });
    const after = drawnLeaves(turned.state.graph!, before);
    expect(after.get(aId)!.node).toBe(before.get(aId)!.node);
    expect(after.get(aId)).not.toBe(before.get(aId));
    expect(after.get(imgId)).toBe(before.get(imgId));
    for (const id of [aId, bId, imgId]) expectFrameMatchesGraph(after.get(id)!);
  });

  test('a member of a stretched bound group is drawn with its exact shear', () => {
    const { session, aId, imgId } = scene();
    const s = commitEntry(session, buildGroupSelectedMulti(session.state, [aId, imgId])!);
    const turned = commitEntry(s, { entry: twistAbout(s.state, [imgId], [11, 0.5], 30)! });
    const box = { cellX: 0, cellY: 0, cellWidth: 12, cellHeight: 2 };
    const stretched = commitEntry(turned, { entry: resizeBox(turned.state, [aId, imgId], box, { ...box, cellWidth: 36 })! });
    const d = drawnLeaves(stretched.state.graph!).get(imgId)!;
    const [a, b, c, dd] = parseMatrix(drawnFrame(d, PX).inner.transform);
    // Columns not orthogonal: the inner element is a parallelogram, not the
    // nearest rectangle the legacy view spells.
    expect(Math.abs(a * c + b * dd)).toBeGreaterThan(1e-3);
    expectFrameMatchesGraph(d);
  });
});

describe('svgDrawnGeometry — the stroke keeps its world width', () => {
  function pinched(factor: number) {
    let session = createEditorSession(makeBlankComposition('dp'));
    const a = buildPlaceShape('rect', { cellX: 2, cellY: 2, cellWidth: 4, cellHeight: 2 }, INK);
    session = commitEntry(session, a);
    const stroked = { ...findItem(session.state, a.id!)!.item as SVGObject };
    void stroked;
    const scaled = commitEntry(session, { entry: twistAbout(session.state, [a.id!], [4, 3], 25, factor)! });
    return { drawn: drawnLeaves(scaled.state.graph!).get(a.id!)!, graph: scaled.state.graph!, id: a.id! };
  }

  test('the matrix on the element has unit scale; the vertices carry it', () => {
    const { drawn, graph, id } = pinched(2);
    const g = svgDrawnGeometry(drawn);
    expect(g.scale).toBeCloseTo(2, 9);
    expect(matUniformScale(g.matrix)).toBeCloseTo(1, 9);
    // Vertices are the local path grown by the scale…
    const local = drawn.node.localSegments!;
    g.object.segments.forEach((seg, i) => {
      expect(seg.start[0]).toBeCloseTo(local[i].start[0] * 2, 9);
      expect(seg.start[1]).toBeCloseTo(local[i].start[1] * 2, 9);
    });
    // …and the element matrix over them is the world path, exactly.
    const world = worldSegments(graph, id);
    g.object.segments.forEach((seg, i) => {
      const [x, y] = matApplyPoint(g.matrix, seg.start[0], seg.start[1]);
      expect(x).toBeCloseTo(world[i].start[0], 9);
      expect(y).toBeCloseTo(world[i].start[1], 9);
    });
    // The box the <svg> is drawn in is the scaled local box.
    expect(g.box.width).toBeCloseTo(8, 9);
    expect(g.box.height).toBeCloseTo(4, 9);
    // Nothing about the stroke was touched: it is drawn in user space at the
    // authored width, in an element scaled by 1.
    expect(g.object.stroke).toBe((drawn.node.content as SVGObject).stroke);
    expect(g.object.angleDeg).toBeUndefined();
  });

  test('the frame built from it still lands on the world corners', () => {
    const { drawn } = pinched(1.5);
    const g = svgDrawnGeometry(drawn);
    const frame = drawnFrame(drawn, PX, g);
    const corners = drawnCorners(drawn);
    const b = g.box;
    const local: [number, number][] = [[0, 0], [b.width, 0], [b.width, b.height], [0, b.height]];
    local.forEach(([x, y], i) => {
      const [wx, wy] = innerToWorldPx(frame, x * PX, y * PX);
      expect(wx).toBeCloseTo(corners[i][0] * PX, 3);
      expect(wy).toBeCloseTo(corners[i][1] * PX, 3);
    });
  });

  test('a repeat-mode path scales its tile pitch with its vertices', () => {
    const leaf = {
      id: 'tile', color: INK, cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8,
      segments: [{ kind: 'line', start: [0, 0], end: [2, 2] }],
      tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2, tileOffsetXL0: 0.5,
    } as unknown as SVGObject;
    const d = drawnLeafOf('svg', leaf);
    const grown: DrawnLeaf = { node: d.node, world: { ...d.world, a: 3, d: 3 } };
    const g = svgDrawnGeometry(grown);
    expect(g.object.tileWidthL0).toBeCloseTo(6);
    expect(g.object.tileHeightL0).toBeCloseTo(6);
    expect(g.object.tileOffsetXL0).toBeCloseTo(1.5);
    expect(g.box).toEqual({ x: -12, y: -12, width: 24, height: 24 });
  });

  test('an off-square matrix stretches each tile axis by its own factor', () => {
    // The pitch is a length in the path's own space, so it follows the
    // grow the vertices got — which off-square is different on each axis.
    // One factor on both would have tiled square inside a stretched group.
    const leaf = {
      id: 'tile', color: INK, cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 8,
      segments: [{ kind: 'line', start: [0, 0], end: [2, 2] }],
      tileMode: 'repeat', tileWidthL0: 2, tileHeightL0: 2, tileOffsetXL0: 0.5,
    } as unknown as SVGObject;
    const d = drawnLeafOf('svg', leaf);
    const pulled: DrawnLeaf = { node: d.node, world: { ...d.world, a: 3, d: 1 } };
    const g = svgDrawnGeometry(pulled);
    expect(g.object.tileWidthL0).toBeCloseTo(6);
    expect(g.object.tileHeightL0).toBeCloseTo(2);
    expect(g.object.tileOffsetXL0).toBeCloseTo(1.5);
    // …and the frame it all draws in carries no stretch of its own.
    expect(matIsSimilarity(g.matrix)).toBe(true);
  });

  test('the geometry is cached per drawn leaf', () => {
    const { drawn } = pinched(2);
    expect(svgDrawnGeometry(drawn)).toBe(svgDrawnGeometry(drawn));
  });
});

describe('svgLayerMarkup — the inner glow is part of the recipe', () => {
  const GLOW = { radius: 0.5, color: { r: 255, g: 200, b: 0 }, alpha: 1 };
  const solid = (c: { r: number; g: number; b: number }): SVGObject['fill'] => ({
    type: 'solid', solid: c, angle: 0, stops: [{ offset: 0, color: c }, { offset: 1, color: c }],
    opacity: 1, blend: 'normal',
  });

  function placed(extra: Partial<SVGObject>): { drawn: DrawnLeaf; shape: SVGObject } {
    const a = buildPlaceShape('rect', { cellX: 2, cellY: 2, cellWidth: 4, cellHeight: 2 }, INK);
    const base = (a.entry[0] as { item: SVGObject }).item;
    const shape: SVGObject = { ...base, ...extra };
    const session = commitEntry(createEditorSession(makeBlankComposition('dp')), buildPlaceSVGObject(shape));
    return { drawn: drawnLeaves(session.state.graph!).get(shape.id)!, shape };
  }

  test('a filled shape mounts the export’s filter around its content', () => {
    const { drawn, shape } = placed({ fill: solid({ r: 200, g: 40, b: 40 }), effects: { innerGlow: GLOW } });
    const { html, outlineCells } = svgLayerMarkup(drawn, 1);
    expect(html).toContain(`<filter id="ig_${shape.id}"`);
    expect(html).toContain(`<g filter="url(#ig_${shape.id})">`);
    // A filled shape casts from its own solid alpha: no dilation width.
    expect(outlineCells).toBeUndefined();
  });

  test('a recolour PREVIEW keeps the glow — the content override changes the fill, not the recipe', () => {
    // The bug: the Color brush previews a fill by re-mounting this markup
    // with the brushed fill on it, and the glow went out for the length of
    // the drag because the wrapper was the React layer's to add, not the
    // reader's.
    const { drawn, shape } = placed({ fill: solid({ r: 200, g: 40, b: 40 }), effects: { innerGlow: GLOW } });
    const preview = { ...shape, fill: solid({ r: 20, g: 90, b: 220 }), fillColor: undefined, fillOpacity: undefined, fillPaint: undefined };
    const { html } = svgLayerMarkup(drawn, 1, svgDrawnGeometry(drawn, preview));
    expect(html.toLowerCase()).toContain('#145adc');
    expect(html.toLowerCase()).not.toContain('#c82828');
    expect(html).toContain(`<g filter="url(#ig_${shape.id})">`);
  });

  test('a node without a glow mounts the bare content', () => {
    const { drawn } = placed({ fill: solid({ r: 200, g: 40, b: 40 }) });
    const { html } = svgLayerMarkup(drawn, 1);
    expect(html).not.toContain('<filter');
    expect(html).not.toContain('<g filter=');
  });

  test('an unfilled closed shape paints its own band instead, and reports its outline', () => {
    const { drawn, shape } = placed({ effects: { innerGlow: GLOW } });
    const { html, outlineCells } = svgLayerMarkup(drawn, 1);
    expect(html).toContain(`uw-iglow-${shape.id}`);
    expect(html).not.toContain(`ig_${shape.id}`);
    expect(outlineCells).toBeGreaterThan(0);
  });

  describe('svgLayerSplitMarkup — the same recipe in two halves, for the paint canvas to sit between', () => {
    test('the halves are the one-svg markup’s pieces: fill (and the paint clip) apart from the strokes', () => {
      const { drawn, shape } = placed({ fill: solid({ r: 200, g: 40, b: 40 }) });
      const whole = svgLayerMarkup(drawn, 1);
      const split = svgLayerSplitMarkup(drawn, 1);
      expect(split.viewBox).toBe(whole.viewBox);
      expect(split.outlineCells).toBe(whole.outlineCells);
      expect(split.fill.toLowerCase()).toContain('#c82828');
      expect(split.strokes).not.toContain('#c82828');
      expect(split.strokes).toContain('stroke="rgb(40,40,40)"');
      expect(split.fill).not.toContain('stroke="rgb(40,40,40)"');
      expect(split.paintClipId).toBe(`paintclip_${shape.id}`);
      expect(split.fill).toContain(`<clipPath id="paintclip_${shape.id}" clipPathUnits="objectBoundingBox">`);
      // The canvas is the host's: no carrier of any kind inside either svg.
      expect(split.fill).not.toContain('<foreignObject');
      expect(split.strokes).not.toContain('<foreignObject');
      expect(split.fill).not.toContain('<image ');
      // …and the clip is not in the one-svg form, which carries its own
      // (user-space) clip round the in-svg overlay when it has paint.
      expect(whole.html).not.toContain('objectBoundingBox');
    });

    test('a painted shape’s split never inlines pixels, unlike the one-svg form’s export carrier', () => {
      const overlay = { cols: 4, rows: 3, rgba: new Uint8Array(4 * 3 * 4), blend: 'normal' as const };
      const { drawn } = placed({ fill: solid({ r: 200, g: 40, b: 40 }), paintOverlay: overlay });
      const split = svgLayerSplitMarkup(drawn, 1);
      expect(split.fill + split.strokes).not.toContain('data:image/png');
      expect(split.fill + split.strokes).not.toContain('<canvas');
    });

    test('the inner glow’s filter wraps the FILL half, and the strokes stay bare', () => {
      const { drawn, shape } = placed({ fill: solid({ r: 200, g: 40, b: 40 }), effects: { innerGlow: GLOW } });
      const split = svgLayerSplitMarkup(drawn, 1);
      expect(split.fill).toContain(`<filter id="ig_${shape.id}"`);
      expect(split.fill).toContain(`<g filter="url(#ig_${shape.id})">`);
      expect(split.strokes).not.toContain('<filter');
      expect(split.strokes).not.toContain('<g filter=');
    });

    test('the whole-object opacity is handed to the host, not wrapped into either half', () => {
      const { drawn } = placed({ fill: solid({ r: 200, g: 40, b: 40 }), opacity: 0.3 });
      expect(svgLayerMarkup(drawn, 1).html).toContain('opacity="0.3"');
      const split = svgLayerSplitMarkup(drawn, 1);
      expect(split.opacity).toBe(0.3);
      expect(split.fill).not.toContain('opacity="0.3"');
      expect(split.strokes).not.toContain('opacity="0.3"');
    });

    test('a recolour PREVIEW rides the split the same way — the content override changes the fill only', () => {
      const { drawn, shape } = placed({ fill: solid({ r: 200, g: 40, b: 40 }) });
      const preview = { ...shape, fill: solid({ r: 20, g: 90, b: 220 }), fillColor: undefined, fillOpacity: undefined, fillPaint: undefined };
      const split = svgLayerSplitMarkup(drawn, 1, svgDrawnGeometry(drawn, preview));
      expect(split.fill.toLowerCase()).toContain('#145adc');
      expect(split.fill.toLowerCase()).not.toContain('#c82828');
      expect(split.strokes).toBe(svgLayerSplitMarkup(drawn, 1).strokes);
    });
  });
});

describe('the pattern bakes in its own space', () => {
  test('a turned, flipped pattern hands the bake un-turned cells in the local box', () => {
    const content = {
      id: 'pat', cols: 4, rows: 2, cells: [], cellX: 4, cellY: 4, cellWidth: 2, cellHeight: 4,
      rotation: 90, mirrorH: true, angleDeg: 10,
    } as unknown as PatternObject;
    const d = drawnLeafOf('pattern', content);
    const local = patternDrawnObject(d);
    expect(local).toMatchObject({ id: 'pat', cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 2, cols: 4, rows: 2 });
    expect(local.rotation).toBeUndefined();
    expect(local.mirrorH).toBeUndefined();
    expect(local.angleDeg).toBeUndefined();
    expect(patternDrawnObject(d)).toBe(local);
    expect(patternLayerMarkup(d, 1).viewBox).toBe('0 0 1024 512');
  });

  test('a placed pattern renders the same markup the legacy layer would, moved to the origin', () => {
    let session = createEditorSession(makeBlankComposition('dp'));
    const entry = buildPlacePattern({ cellX: 6, cellY: 2, cellWidth: 4, cellHeight: 4 }, 2, 2);
    session = commitEntry(session, entry);
    const d = drawnLeaves(session.state.graph!).get(entry.id!)!;
    const { viewBox, html } = patternLayerMarkup(d, 1);
    expect(viewBox).toBe('0 0 1024 1024');
    expect(typeof html).toBe('string');
    expectFrameMatchesGraph(d);
  });
});

describe('a text lays out in its local box', () => {
  test('a quarter-turned word keeps its un-turned box for the layout', () => {
    let session = createEditorSession(makeBlankComposition('dp'));
    const entry = buildPlaceText('hello', { fontId: 'f', size: 1, color: INK } as TextObject['style'], 5, 5);
    session = commitEntry(session, entry);
    const before = drawnLeaves(session.state.graph!).get(entry.id!)!;
    const turned = commitEntry(session, { entry: twistAbout(session.state, [entry.id!], [5, 5], 90)! });
    const d = drawnLeaves(turned.state.graph!).get(entry.id!)!;
    expect(drawnLocalBox(d.node)).toEqual(drawnLocalBox(before.node));
    expectFrameMatchesGraph(d);
  });
});

describe('a shadow authored in the world, cast inside the matrix', () => {
  test('a quarter turn pushes the offset back through the matrix, as the legacy chain did', () => {
    const d = drawnLeafOf('image', image({ rotation: 90 }));
    const [x, y] = worldOffsetInNodeFrame(0, 1, d.world);
    const [lx, ly] = worldOffsetInNodeFrame(0, 1, { rotation: 90 });
    expect(x).toBeCloseTo(lx);
    expect(y).toBeCloseTo(ly);
  });

  test('a scale is divided out, so the shadow lands at its authored length', () => {
    const [x, y] = worldOffsetInNodeFrame(2, 4, { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
    expect([x, y]).toEqual([1, 2]);
  });

  test('a paint island is a bbox kind like any other', () => {
    const p = makePaintIsland(20.0625, 20.0625);
    const d = drawnLeafOf('paint', p as PaintObject);
    expect(drawnLocalBox(d.node)).toEqual({ x: 0, y: 0, width: p.cellWidth, height: p.cellHeight });
    expectFrameMatchesGraph(d);
  });
});

describe('bboxLocalFrame — the brush tests a dab in the drawn frame', () => {
  test('a turned, flipped image maps its world corners onto its local box', () => {
    const d = drawnLeafOf('image', image({ rotation: 90, mirrorH: true, angleDeg: 25 }));
    const frame = bboxLocalFrame(d);
    const box = drawnLocalBox(d.node);
    expect(frame.iw).toBe(box.width);
    expect(frame.ih).toBe(box.height);
    const corners = drawnCorners(d);
    const [x0, y0] = frame.toLocal(corners[0][0], corners[0][1]);
    expect(x0).toBeCloseTo(0, 9);
    expect(y0).toBeCloseTo(0, 9);
    const [x2, y2] = frame.toLocal(corners[2][0], corners[2][1]);
    expect(x2).toBeCloseTo(box.width, 9);
    expect(y2).toBeCloseTo(box.height, 9);
    expect(frame.radiusScale).toBeCloseTo(1, 9);
    // The cull disc covers the whole world AABB.
    const aabb = drawnAabb(d);
    expect(frame.cullRadius).toBeCloseTo(Math.hypot(aabb.width, aabb.height) / 2, 9);
  });

  test('a pinched node keeps its local frame and shrinks the brush', () => {
    let session = createEditorSession(makeBlankComposition('dp'));
    const img = buildPlacePhotoPlaceholder({ cellX: 10, cellY: 0, cellWidth: 2, cellHeight: 1 }, TEST_PHOTO_PLACEHOLDER);
    session = commitEntry(session, img);
    const grown = commitEntry(session, { entry: twistAbout(session.state, [img.id!], [11, 0.5], 0, 2)! });
    const d = drawnLeaves(grown.state.graph!).get(img.id!)!;
    const frame = bboxLocalFrame(d);
    expect(frame.iw).toBeCloseTo(2, 9);
    expect(frame.ih).toBeCloseTo(1, 9);
    expect(frame.radiusScale).toBeCloseTo(0.5, 9);
    // The world centre is the local centre.
    const [cx, cy] = frame.toLocal(11, 0.5);
    expect(cx).toBeCloseTo(1, 9);
    expect(cy).toBeCloseTo(0.5, 9);
  });

  test('a text lays its characters out in the local box, at the content size', () => {
    let session = createEditorSession(makeBlankComposition('dp'));
    const entry = buildPlaceText('hi', { fontId: 'f', size: 1, color: INK } as TextObject['style'], 5, 5);
    session = commitEntry(session, entry);
    const before = textPaintGeometry(drawnLeaves(session.state.graph!).get(entry.id!)!);
    const grown = commitEntry(session, { entry: twistAbout(session.state, [entry.id!], [5, 5], 30, 3)! });
    const after = textPaintGeometry(drawnLeaves(grown.state.graph!).get(entry.id!)!);
    // Same boxes: the content did not change, only the matrix did…
    expect([...after.chars.values()].map((c) => [c.x, c.y, c.w, c.h]))
      .toEqual([...before.chars.values()].map((c) => [c.x, c.y, c.w, c.h]));
    // …and a world radius is a third as big in there.
    expect(after.radiusScale).toBeCloseTo(1 / 3, 9);
  });
});

describe('boxFrame: the same two elements for a box that is not any one leaf’s', () => {
  test('drawnFrame is boxFrame over the leaf’s own AABB, local box and world matrix', () => {
    let session = createEditorSession(makeBlankComposition('bf'));
    const rect = buildPlaceShape('rect', { cellX: 3, cellY: 5, cellWidth: 6, cellHeight: 2 }, INK);
    session = commitEntry(session, rect);
    session = commitEntry(session, { entry: twistAbout(session.state, [rect.id!], [6, 6], 30, 1.25)! });
    const d = drawnLeaves(session.state.graph!).get(rect.id!)!;
    const viaLeaf = drawnFrame(d, PX);
    const viaBox = boxFrame(drawnAabb(d), drawnLocalBox(d.node), d.world, PX);
    expect(viaBox).toEqual(viaLeaf);
  });

  test('a composite over a subtree: the outer box is the box given, the inner the content through the matrix', () => {
    // Sol's plant layer draws one element per plant over the plant's
    // subtree: the outer box is the union of the leaves, the content a
    // box in the plant's own frame drawn through its world matrix.
    const aabb = { x: 10, y: 20, width: 8, height: 4 };
    const box = { x: -1, y: -0.5, width: 2, height: 1 };
    const m = { a: 4, b: 0, c: 0, d: 4, e: 14, f: 22 };
    const f = boxFrame(aabb, box, m, PX);
    expect(f.outer).toEqual({ left: 10 * PX, top: 20 * PX, width: 8 * PX, height: 4 * PX });
    expect(f.inner.width).toBe(2 * PX);
    expect(f.inner.height).toBe(1 * PX);
    const [a, , , dd, e, ff] = parseMatrix(f.inner.transform);
    expect(a).toBe(4);
    expect(dd).toBe(4);
    // The box's origin, through m, relative to the outer box's corner.
    expect(e).toBeCloseTo((14 - 4 - 10) * PX, 9);
    expect(ff).toBeCloseTo((22 - 2 - 20) * PX, 9);
  });
});
