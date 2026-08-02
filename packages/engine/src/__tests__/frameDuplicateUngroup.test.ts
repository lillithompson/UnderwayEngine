/**
 * Figma-style frames (GroupNode.isFrame) must stay frames across the two group
 * flows that recreate a GroupNode from scratch:
 *   - duplicate: buildDuplicateOps re-emits a groupFigures op — it must carry
 *     isFrame so a duplicated frame still clips + owns a fixed export region.
 *   - ungroup → undo: the ungroupFigures revert re-groups the members — it must
 *     restore isFrame (via the op's savedIsFrame) or an undo silently demotes
 *     the frame to a plain group.
 */

import {
  applyCompOps,
  revertCompOps,
  buildDuplicateOps as engineBuildDuplicateOps,
} from '../compositionOps';
import {
  CompositionState,
  CompositionFigure,
  CompUndoEntry,
  makeViewport,
} from '../types';

function makeState(parts: Partial<CompositionState> = {}): CompositionState {
  const figures = parts.figures ?? [];
  const groups = parts.groups ?? [];
  return {
    id: 'test', name: 'test',
    figures, svgObjects: [], images: [],
    imageBlobs: {},
    lineDraft: null, arcDraft: null,
    editingLineId: null, selectedVertexIndex: null,
    lastChosenColor: { r: 255, g: 255, b: 255 },
    customColors: [],
    groups,
    sceneOrder: figures.map((f) => f.id),
    gridLevel: 0, strokeScale: 8, gridIntensity: 0.5,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    viewport: makeViewport(800, 600),
    selectedFigureIds: new Set(),
    activeFigureKey: null,
    compTool: 'select',
    createRegion: null,
    renderGeneration: 0,
    ...parts,
  } as CompositionState;
}

function framedState(): CompositionState {
  const fig: CompositionFigure = {
    id: 'fig1', figureKey: 'k', cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2,
    resolutionX: 2, resolutionY: 2, rotation: 0, groupId: 'frame',
    localCellX: 0, localCellY: 0, localCellWidth: 2, localCellHeight: 2,
    localRotation: 0, localMirrorH: false, localMirrorV: false,
  } as CompositionFigure;
  return makeState({
    figures: [fig],
    groups: [{
      id: 'frame', name: 'Frame', translateX: 0, translateY: 0,
      scaleX: 1, scaleY: 1, rotation: 0, mirrorH: false, mirrorV: false, isFrame: true,
    }],
  });
}

describe('frame preservation across group recreation', () => {
  it('buildDuplicateOps keeps the duplicated group a frame', () => {
    const state = framedState();
    const { ops } = engineBuildDuplicateOps(state, ['fig1'], {
      mintGroupId: (g) => g + '_dup',
      mintItemId: (_k, id) => id + '_dup',
    });
    const after = applyCompOps(state, ops);
    const frames = after.groups.filter((g) => g.isFrame);
    expect(frames).toHaveLength(2);
    expect(after.groups.find((g) => g.id === 'frame_dup')!.isFrame).toBe(true);
  });

  it('ungroup → undo restores the isFrame flag via savedIsFrame', () => {
    const state = framedState();
    const entry: CompUndoEntry = [{
      op: 'ungroupFigures',
      figureIds: ['fig1'],
      groupId: 'frame',
      groupName: 'Frame',
      childGroupIds: [],
      savedTranslateX: 0, savedTranslateY: 0,
      savedScaleX: 1, savedScaleY: 1,
      savedRotation: 0, savedMirrorH: false, savedMirrorV: false,
      savedIsFrame: true,
    }];
    const ungrouped = applyCompOps(state, entry);
    expect(ungrouped.groups.find((g) => g.id === 'frame')).toBeUndefined();
    const undone = revertCompOps(ungrouped, entry);
    expect(undone.groups.find((g) => g.id === 'frame')!.isFrame).toBe(true);
  });

  it('ungroup → undo WITHOUT savedIsFrame leaves a plain group (guards the flag path)', () => {
    const state = framedState();
    const entry: CompUndoEntry = [{
      op: 'ungroupFigures',
      figureIds: ['fig1'],
      groupId: 'frame',
      groupName: 'Frame',
      childGroupIds: [],
    }];
    const undone = revertCompOps(applyCompOps(state, entry), entry);
    // Without the saved flag the regroup path defaults to a plain group — this
    // is exactly why buildUngroupFrame populates savedIsFrame.
    expect(undone.groups.find((g) => g.id === 'frame')?.isFrame).toBeFalsy();
  });
});
