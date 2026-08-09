import { applyCompOps, revertCompOps } from '../compositionOps';
import {
  CompositionState,
  CompUndoEntry,
  ImageObject,
  SVGObject,
  TextObject,
  makeViewport,
} from '../types';

// `groupFigures` groups all four member kinds — figures, svgs, images and
// texts — but its UNDO once walked only the first two, so a grouped image or
// text kept a `groupId` naming the GroupNode the undo had just deleted. Every
// later group walk (materialize, bbox, lock) then resolved that member through
// a group that no longer existed. These lock the round trip for all of them.

function makeSVG(id: string): SVGObject {
  return {
    id,
    name: `svg ${id}`,
    cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2,
    segments: [],
    color: { r: 0, g: 0, b: 0 },
  } as SVGObject;
}

function makeImage(id: string): ImageObject {
  return {
    id,
    name: `image ${id}`,
    cellX: 4, cellY: 0, cellWidth: 2, cellHeight: 2,
  } as ImageObject;
}

function makeText(id: string): TextObject {
  return {
    id,
    name: `text ${id}`,
    content: 'hi',
    style: { fontId: 'system', size: 2, color: { r: 0, g: 0, b: 0 } },
    cellX: 8, cellY: 0, cellWidth: 2, cellHeight: 2,
  } as TextObject;
}

function makeState(): CompositionState {
  return {
    id: 'test',
    name: 'test',
    figures: [],
    svgObjects: [makeSVG('s1')],
    images: [makeImage('i1')],
    texts: [makeText('t1')],
    lineDraft: null,
    arcDraft: null,
    editingLineId: null,
    selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups: [],
    sceneOrder: ['s1', 'i1', 't1'],
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
  };
}

const GROUP_ENTRY: CompUndoEntry = [{
  op: 'groupFigures',
  figureIds: ['s1', 'i1', 't1'],
  groupId: 'g1',
  groupName: 'Group 1',
  oldNames: ['svg s1', 'image i1', 'text t1'],
}];

describe('groupFigures undo across every member kind', () => {
  test('groups svg, image and text alike', () => {
    const grouped = applyCompOps(makeState(), GROUP_ENTRY);
    expect(grouped.groups.map((g) => g.id)).toEqual(['g1']);
    expect(grouped.svgObjects[0].groupId).toBe('g1');
    expect(grouped.images![0].groupId).toBe('g1');
    expect(grouped.texts![0].groupId).toBe('g1');
  });

  test('undo detaches all three and restores their names', () => {
    const grouped = applyCompOps(makeState(), GROUP_ENTRY);
    const back = revertCompOps(grouped, GROUP_ENTRY);

    expect(back.groups).toEqual([]);
    expect(back.svgObjects[0].groupId).toBeUndefined();
    expect(back.images![0].groupId).toBeUndefined();
    expect(back.texts![0].groupId).toBeUndefined();

    expect(back.svgObjects[0].name).toBe('svg s1');
    expect(back.images![0].name).toBe('image i1');
    expect(back.texts![0].name).toBe('text t1');

    // The group-local coords the apply seeded are gone too.
    expect(back.images![0].localCellX).toBeUndefined();
    expect(back.texts![0].localCellX).toBeUndefined();
    expect(back.images![0].preGroupName).toBeUndefined();
    expect(back.texts![0].preGroupName).toBeUndefined();
  });

  test('an entry with no oldNames still restores names from preGroupName', () => {
    const entry: CompUndoEntry = [{ ...GROUP_ENTRY[0], oldNames: [] } as typeof GROUP_ENTRY[0]];
    const grouped = applyCompOps(makeState(), entry);
    const back = revertCompOps(grouped, entry);

    expect(back.images![0].name).toBe('image i1');
    expect(back.texts![0].name).toBe('text t1');
  });
});
