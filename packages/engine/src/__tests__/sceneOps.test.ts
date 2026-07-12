import {
  moveNode, rotateNode90CW, mirrorNode, scaleNode, setNodeTransform,
  groupNodes, ungroupNodes,
  applySceneUndoEntry, revertSceneUndoEntry,
  SceneUndoEntry,
} from '../sceneOps';
import {
  AnySceneNode, FigureNode, GroupNode2,
} from '../types';
import {
  Transform2D, Bbox, IDENTITY,
  applyToBbox, compose,
} from '../transform2d';
import { WorldTransformCache, NodeTransformInfo } from '../worldTransformCache';

// ── Helpers ────────────────────────────────────────────────────────────

function closeTo(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}

function bboxClose(a: Bbox, b: Bbox, eps = 1e-6): boolean {
  return closeTo(a.x, b.x, eps) && closeTo(a.y, b.y, eps)
    && closeTo(a.width, b.width, eps) && closeTo(a.height, b.height, eps);
}

function getWorldBbox(
  nodes: Map<string, AnySceneNode>,
  nodeId: string,
  localBbox: Bbox,
): Bbox {
  const cache = new WorldTransformCache();
  const getNode = (id: string) => nodes.get(id) as NodeTransformInfo | undefined;
  return cache.getWorldBbox(nodeId, localBbox, getNode);
}

function makeFigureNode(overrides: Partial<FigureNode> & { id: string }): FigureNode {
  return {
    kind: 'figure',
    figureKey: 'test',
    resolutionX: 2, resolutionY: 2,
    localBbox: { x: 0, y: 0, width: 2, height: 2 },
    transform: IDENTITY,
    ...overrides,
  };
}

function makeGroupNode(overrides: Partial<GroupNode2> & { id: string }): GroupNode2 {
  return {
    kind: 'group',
    transform: IDENTITY,
    ...overrides,
  };
}

function buildMap(...nodes: AnySceneNode[]): Map<string, AnySceneNode> {
  return new Map(nodes.map(n => [n.id, n]));
}

// ── moveNode ───────────────────────────────────────────────────────────

describe('moveNode', () => {
  test('shifts tx/ty by delta', () => {
    const fig = makeFigureNode({ id: 'f1', transform: { ...IDENTITY, tx: 10, ty: 20 } });
    const nodes = buildMap(fig);
    const { nodes: result } = moveNode(nodes, 'f1', 5, -3);
    const moved = result.get('f1') as FigureNode;
    expect(moved.transform.tx).toBe(15);
    expect(moved.transform.ty).toBe(17);
  });

  test('world bbox shifts by delta', () => {
    const fig = makeFigureNode({ id: 'f1', transform: { ...IDENTITY, tx: 10, ty: 20, sx: 2, sy: 2 } });
    const nodes = buildMap(fig);
    const before = getWorldBbox(nodes, 'f1', fig.localBbox);
    const { nodes: result } = moveNode(nodes, 'f1', 5, -3);
    const after = getWorldBbox(result, 'f1', fig.localBbox);
    expect(closeTo(after.x, before.x + 5)).toBe(true);
    expect(closeTo(after.y, before.y - 3)).toBe(true);
    expect(closeTo(after.width, before.width)).toBe(true);
    expect(closeTo(after.height, before.height)).toBe(true);
  });

  test('moving a group moves all children via cache', () => {
    const group = makeGroupNode({ id: 'g1', transform: { ...IDENTITY, tx: 10, ty: 10 } });
    const child = makeFigureNode({ id: 'f1', parentId: 'g1', transform: { ...IDENTITY, tx: 5, ty: 5, sx: 2, sy: 2 } });
    const nodes = buildMap(group, child);

    const beforeBbox = getWorldBbox(nodes, 'f1', child.localBbox);
    const { nodes: result } = moveNode(nodes, 'g1', 20, 30);
    const afterBbox = getWorldBbox(result, 'f1', child.localBbox);

    expect(closeTo(afterBbox.x, beforeBbox.x + 20)).toBe(true);
    expect(closeTo(afterBbox.y, beforeBbox.y + 30)).toBe(true);
  });

  test('produces correct undo entry', () => {
    const fig = makeFigureNode({ id: 'f1', transform: { ...IDENTITY, tx: 10, ty: 20 } });
    const nodes = buildMap(fig);
    const { nodes: moved, undoEntry } = moveNode(nodes, 'f1', 5, -3);
    expect(undoEntry).toHaveLength(1);
    expect(undoEntry[0].op).toBe('setTransform');

    // Revert should restore original
    const reverted = revertSceneUndoEntry(moved, undoEntry);
    const restored = reverted.get('f1') as FigureNode;
    expect(restored.transform.tx).toBe(10);
    expect(restored.transform.ty).toBe(20);
  });

  test('no-op for unknown node', () => {
    const nodes = buildMap();
    const { nodes: result, undoEntry } = moveNode(nodes, 'nonexistent', 5, 5);
    expect(result).toBe(nodes);
    expect(undoEntry).toHaveLength(0);
  });
});

// ── rotateNode90CW ─────────────────────────────────────────────────────

describe('rotateNode90CW', () => {
  test('cycles rotation: 0→90→180→270→0', () => {
    const fig = makeFigureNode({ id: 'f1' });
    let nodes = buildMap(fig);

    nodes = rotateNode90CW(nodes, 'f1').nodes;
    expect((nodes.get('f1') as FigureNode).transform.rotation).toBe(90);

    nodes = rotateNode90CW(nodes, 'f1').nodes;
    expect((nodes.get('f1') as FigureNode).transform.rotation).toBe(180);

    nodes = rotateNode90CW(nodes, 'f1').nodes;
    expect((nodes.get('f1') as FigureNode).transform.rotation).toBe(270);

    nodes = rotateNode90CW(nodes, 'f1').nodes;
    expect((nodes.get('f1') as FigureNode).transform.rotation).toBe(0);
  });

  test('4x rotation returns to original world position (no drift)', () => {
    const fig = makeFigureNode({
      id: 'f1',
      transform: { ...IDENTITY, tx: 10, ty: 20, sx: 3, sy: 2 },
      localBbox: { x: 0, y: 0, width: 4, height: 3 },
    });
    let nodes = buildMap(fig);
    const originalBbox = getWorldBbox(nodes, 'f1', fig.localBbox);

    for (let i = 0; i < 4; i++) {
      nodes = rotateNode90CW(nodes, 'f1').nodes;
    }

    const afterBbox = getWorldBbox(nodes, 'f1', fig.localBbox);
    expect(bboxClose(afterBbox, originalBbox)).toBe(true);
  });

  test('rotation with pivot keeps pivot point fixed', () => {
    const fig = makeFigureNode({
      id: 'f1',
      transform: { ...IDENTITY, tx: 10, ty: 10, sx: 1, sy: 1 },
      localBbox: { x: 0, y: 0, width: 4, height: 4 },
    });
    const nodes = buildMap(fig);
    // Pivot at center of the world bbox
    const pivot = { x: 12, y: 12 }; // (10 + 4/2, 10 + 4/2) at identity

    const { nodes: result } = rotateNode90CW(nodes, 'f1', pivot);
    const wbAfter = getWorldBbox(result, 'f1', fig.localBbox);

    // The center of the world bbox should still be at the pivot
    const cx = wbAfter.x + wbAfter.width / 2;
    const cy = wbAfter.y + wbAfter.height / 2;
    expect(closeTo(cx, 12)).toBe(true);
    expect(closeTo(cy, 12)).toBe(true);
  });

  test('does not modify geometry', () => {
    const fig = makeFigureNode({
      id: 'f1',
      localBbox: { x: 0, y: 0, width: 4, height: 3 },
    });
    const nodes = buildMap(fig);
    const { nodes: result } = rotateNode90CW(nodes, 'f1');
    const rotated = result.get('f1') as FigureNode;
    expect(rotated.localBbox).toEqual({ x: 0, y: 0, width: 4, height: 3 });
  });
});

// ── mirrorNode ─────────────────────────────────────────────────────────

describe('mirrorNode', () => {
  test('toggles mirrorH', () => {
    const fig = makeFigureNode({ id: 'f1' });
    const nodes = buildMap(fig);
    const { nodes: result } = mirrorNode(nodes, 'f1', 'h');
    expect((result.get('f1') as FigureNode).transform.mirrorH).toBe(true);
  });

  test('toggles mirrorV', () => {
    const fig = makeFigureNode({ id: 'f1' });
    const nodes = buildMap(fig);
    const { nodes: result } = mirrorNode(nodes, 'f1', 'v');
    expect((result.get('f1') as FigureNode).transform.mirrorV).toBe(true);
  });

  test('double mirror is identity', () => {
    const fig = makeFigureNode({
      id: 'f1',
      transform: { ...IDENTITY, tx: 10, ty: 20, sx: 2, sy: 3 },
    });
    let nodes = buildMap(fig);
    const original = getWorldBbox(nodes, 'f1', fig.localBbox);

    nodes = mirrorNode(nodes, 'f1', 'h').nodes;
    nodes = mirrorNode(nodes, 'f1', 'h').nodes;

    const after = getWorldBbox(nodes, 'f1', fig.localBbox);
    expect(bboxClose(after, original)).toBe(true);
  });

  test('mirror with pivot preserves center', () => {
    const fig = makeFigureNode({
      id: 'f1',
      transform: { ...IDENTITY, tx: 10, ty: 10, sx: 1, sy: 1 },
      localBbox: { x: 0, y: 0, width: 4, height: 4 },
    });
    const nodes = buildMap(fig);
    const pivot = { x: 12, y: 12 };

    const { nodes: result } = mirrorNode(nodes, 'f1', 'h', pivot);
    const wbAfter = getWorldBbox(result, 'f1', fig.localBbox);

    const cx = wbAfter.x + wbAfter.width / 2;
    expect(closeTo(cx, 12)).toBe(true);
  });
});

// ── scaleNode ──────────────────────────────────────────────────────────

describe('scaleNode', () => {
  test('modifies sx/sy', () => {
    const fig = makeFigureNode({ id: 'f1', transform: { ...IDENTITY, tx: 10, ty: 10, sx: 1, sy: 1 } });
    const nodes = buildMap(fig);
    const { nodes: result } = scaleNode(nodes, 'f1', 2, 3);
    const scaled = result.get('f1') as FigureNode;
    expect(scaled.transform.sx).toBe(2);
    expect(scaled.transform.sy).toBe(3);
  });

  test('world bbox scales correctly', () => {
    const fig = makeFigureNode({
      id: 'f1',
      transform: { ...IDENTITY, tx: 10, ty: 10, sx: 1, sy: 1 },
      localBbox: { x: 0, y: 0, width: 4, height: 3 },
    });
    const nodes = buildMap(fig);
    const { nodes: result } = scaleNode(nodes, 'f1', 2, 3);
    const wb = getWorldBbox(result, 'f1', fig.localBbox);
    expect(closeTo(wb.width, 8)).toBe(true);  // 4 * 2
    expect(closeTo(wb.height, 9)).toBe(true);  // 3 * 3
  });
});

// ── setNodeTransform ───────────────────────────────────────────────────

describe('setNodeTransform', () => {
  test('sets full transform', () => {
    const fig = makeFigureNode({ id: 'f1' });
    const nodes = buildMap(fig);
    const newT: Transform2D = { tx: 5, ty: 10, sx: 2, sy: 3, rotation: 90, mirrorH: true, mirrorV: false };
    const { nodes: result } = setNodeTransform(nodes, 'f1', newT);
    expect((result.get('f1') as FigureNode).transform).toEqual(newT);
  });
});

// ── groupNodes ─────────────────────────────────────────────────────────

describe('groupNodes', () => {
  test('creates group node with identity transform', () => {
    const f1 = makeFigureNode({ id: 'f1', transform: { ...IDENTITY, tx: 10, ty: 10, sx: 2, sy: 2 } });
    const f2 = makeFigureNode({ id: 'f2', transform: { ...IDENTITY, tx: 20, ty: 20, sx: 2, sy: 2 } });
    const nodes = buildMap(f1, f2);

    const { nodes: result } = groupNodes(nodes, ['f1', 'f2'], 'g1', 'My Group');

    const group = result.get('g1') as GroupNode2;
    expect(group.kind).toBe('group');
    expect(group.name).toBe('My Group');
    expect(group.transform).toEqual(IDENTITY);
    expect(group.parentId).toBeUndefined();
  });

  test('reparents children to new group', () => {
    const f1 = makeFigureNode({ id: 'f1', transform: { ...IDENTITY, tx: 10, ty: 10 } });
    const f2 = makeFigureNode({ id: 'f2', transform: { ...IDENTITY, tx: 20, ty: 20 } });
    const nodes = buildMap(f1, f2);

    const { nodes: result } = groupNodes(nodes, ['f1', 'f2'], 'g1', 'G');

    expect((result.get('f1') as FigureNode).parentId).toBe('g1');
    expect((result.get('f2') as FigureNode).parentId).toBe('g1');
  });

  test('does NOT modify children transforms', () => {
    const t1: Transform2D = { ...IDENTITY, tx: 10, ty: 10, sx: 2, sy: 3 };
    const t2: Transform2D = { ...IDENTITY, tx: 20, ty: 20, rotation: 90 };
    const f1 = makeFigureNode({ id: 'f1', transform: t1 });
    const f2 = makeFigureNode({ id: 'f2', transform: t2 });
    const nodes = buildMap(f1, f2);

    const { nodes: result } = groupNodes(nodes, ['f1', 'f2'], 'g1', 'G');

    expect((result.get('f1') as FigureNode).transform).toEqual(t1);
    expect((result.get('f2') as FigureNode).transform).toEqual(t2);
  });

  test('world bboxes unchanged after grouping', () => {
    const f1 = makeFigureNode({ id: 'f1', transform: { ...IDENTITY, tx: 10, ty: 10, sx: 2, sy: 2 } });
    const f2 = makeFigureNode({ id: 'f2', transform: { ...IDENTITY, tx: 30, ty: 30, sx: 3, sy: 3 } });
    const nodes = buildMap(f1, f2);

    const beforeF1 = getWorldBbox(nodes, 'f1', f1.localBbox);
    const beforeF2 = getWorldBbox(nodes, 'f2', f2.localBbox);

    const { nodes: result } = groupNodes(nodes, ['f1', 'f2'], 'g1', 'G');

    const afterF1 = getWorldBbox(result, 'f1', f1.localBbox);
    const afterF2 = getWorldBbox(result, 'f2', f2.localBbox);

    expect(bboxClose(afterF1, beforeF1)).toBe(true);
    expect(bboxClose(afterF2, beforeF2)).toBe(true);
  });
});

// ── ungroupNodes ───────────────────────────────────────────────────────

describe('ungroupNodes', () => {
  test('removes group node', () => {
    const group = makeGroupNode({ id: 'g1' });
    const f1 = makeFigureNode({ id: 'f1', parentId: 'g1' });
    const nodes = buildMap(group, f1);

    const { nodes: result } = ungroupNodes(nodes, 'g1');
    expect(result.has('g1')).toBe(false);
  });

  test('reparents children to group parent', () => {
    const group = makeGroupNode({ id: 'g1' });
    const f1 = makeFigureNode({ id: 'f1', parentId: 'g1' });
    const nodes = buildMap(group, f1);

    const { nodes: result } = ungroupNodes(nodes, 'g1');
    expect((result.get('f1') as FigureNode).parentId).toBeUndefined();
  });

  test('children absorb group transform', () => {
    const groupT: Transform2D = { ...IDENTITY, tx: 100, ty: 100, sx: 2, sy: 2 };
    const childT: Transform2D = { ...IDENTITY, tx: 5, ty: 5, sx: 1, sy: 1 };
    const group = makeGroupNode({ id: 'g1', transform: groupT });
    const f1 = makeFigureNode({ id: 'f1', parentId: 'g1', transform: childT });
    const nodes = buildMap(group, f1);

    const { nodes: result } = ungroupNodes(nodes, 'g1');
    const freed = result.get('f1') as FigureNode;

    // The new transform should be compose(groupT, childT)
    const expected = compose(groupT, childT);
    const wb1 = applyToBbox(freed.transform, f1.localBbox);
    const wb2 = applyToBbox(expected, f1.localBbox);
    expect(bboxClose(wb1, wb2)).toBe(true);
  });

  test('world bboxes preserved after ungrouping identity group', () => {
    const group = makeGroupNode({ id: 'g1' }); // identity
    const f1 = makeFigureNode({ id: 'f1', parentId: 'g1', transform: { ...IDENTITY, tx: 10, ty: 10, sx: 2, sy: 2 } });
    const f2 = makeFigureNode({ id: 'f2', parentId: 'g1', transform: { ...IDENTITY, tx: 30, ty: 30, sx: 3, sy: 3 } });
    const nodes = buildMap(group, f1, f2);

    const beforeF1 = getWorldBbox(nodes, 'f1', f1.localBbox);
    const beforeF2 = getWorldBbox(nodes, 'f2', f2.localBbox);

    const { nodes: result } = ungroupNodes(nodes, 'g1');

    const afterF1 = getWorldBbox(result, 'f1', f1.localBbox);
    const afterF2 = getWorldBbox(result, 'f2', f2.localBbox);

    expect(bboxClose(afterF1, beforeF1)).toBe(true);
    expect(bboxClose(afterF2, beforeF2)).toBe(true);
  });

  test('world bboxes preserved after ungrouping transformed group', () => {
    const groupT: Transform2D = { tx: 50, ty: 50, sx: 2, sy: 3, rotation: 90, mirrorH: true, mirrorV: false };
    const group = makeGroupNode({ id: 'g1', transform: groupT });
    const f1 = makeFigureNode({ id: 'f1', parentId: 'g1', transform: { ...IDENTITY, tx: 5, ty: 5, sx: 1, sy: 1 } });
    const nodes = buildMap(group, f1);

    const before = getWorldBbox(nodes, 'f1', f1.localBbox);
    const { nodes: result } = ungroupNodes(nodes, 'g1');
    const after = getWorldBbox(result, 'f1', f1.localBbox);

    expect(bboxClose(after, before)).toBe(true);
  });

  test('nested group: ungrouping outer preserves inner group world positions', () => {
    const outer = makeGroupNode({ id: 'outer', transform: { ...IDENTITY, tx: 100, ty: 100 } });
    const inner = makeGroupNode({ id: 'inner', parentId: 'outer', transform: { ...IDENTITY, tx: 10, ty: 10, sx: 2, sy: 2 } });
    const leaf = makeFigureNode({ id: 'f1', parentId: 'inner', transform: { ...IDENTITY, tx: 1, ty: 1 } });
    const nodes = buildMap(outer, inner, leaf);

    const before = getWorldBbox(nodes, 'f1', leaf.localBbox);
    const { nodes: result } = ungroupNodes(nodes, 'outer');
    const after = getWorldBbox(result, 'f1', leaf.localBbox);

    expect(bboxClose(after, before)).toBe(true);
  });
});

// ── group → transform → ungroup round-trip ─────────────────────────────

describe('group → transform → ungroup', () => {
  test('full round-trip preserves world positions', () => {
    const f1 = makeFigureNode({ id: 'f1', transform: { ...IDENTITY, tx: 10, ty: 10, sx: 2, sy: 2 } });
    const f2 = makeFigureNode({ id: 'f2', transform: { ...IDENTITY, tx: 30, ty: 30, sx: 3, sy: 3 } });
    let nodes = buildMap(f1, f2);

    // Group
    ({ nodes } = groupNodes(nodes, ['f1', 'f2'], 'g1', 'G'));

    // Transform the group (move + scale + rotate)
    const groupT: Transform2D = { tx: 50, ty: 50, sx: 2, sy: 2, rotation: 90, mirrorH: false, mirrorV: false };
    ({ nodes } = setNodeTransform(nodes, 'g1', groupT));

    // Ungroup
    ({ nodes } = ungroupNodes(nodes, 'g1'));

    // World positions should NOT equal original (group was transformed)
    // But the visual positions should be consistent with what was on screen
    // after the group transform. Let's verify by checking compose.
    const f1After = nodes.get('f1') as FigureNode;
    const f2After = nodes.get('f2') as FigureNode;

    // Each child should have absorbed the group transform
    const expectedF1T = compose(groupT, f1.transform);
    const expectedF2T = compose(groupT, f2.transform);

    const f1Wb = applyToBbox(f1After.transform, f1.localBbox);
    const f1Expected = applyToBbox(expectedF1T, f1.localBbox);
    expect(bboxClose(f1Wb, f1Expected)).toBe(true);

    const f2Wb = applyToBbox(f2After.transform, f2.localBbox);
    const f2Expected = applyToBbox(expectedF2T, f2.localBbox);
    expect(bboxClose(f2Wb, f2Expected)).toBe(true);
  });

  test('group at identity → ungroup restores original transforms', () => {
    const t1: Transform2D = { ...IDENTITY, tx: 10, ty: 10, sx: 2, sy: 2, rotation: 90 };
    const t2: Transform2D = { ...IDENTITY, tx: 30, ty: 30, sx: 3, sy: 3, mirrorH: true };
    const f1 = makeFigureNode({ id: 'f1', transform: t1 });
    const f2 = makeFigureNode({ id: 'f2', transform: t2 });
    let nodes = buildMap(f1, f2);

    // Group (identity)
    ({ nodes } = groupNodes(nodes, ['f1', 'f2'], 'g1', 'G'));

    // Ungroup immediately (group was identity)
    ({ nodes } = ungroupNodes(nodes, 'g1'));

    // Transforms should be compose(IDENTITY, original) = original
    const f1After = nodes.get('f1') as FigureNode;
    const f2After = nodes.get('f2') as FigureNode;

    // Verify via world bbox equivalence
    const f1WbBefore = applyToBbox(t1, f1.localBbox);
    const f1WbAfter = applyToBbox(f1After.transform, f1.localBbox);
    expect(bboxClose(f1WbAfter, f1WbBefore)).toBe(true);

    const f2WbBefore = applyToBbox(t2, f2.localBbox);
    const f2WbAfter = applyToBbox(f2After.transform, f2.localBbox);
    expect(bboxClose(f2WbAfter, f2WbBefore)).toBe(true);
  });
});

// ── Undo / Redo ────────────────────────────────────────────────────────

describe('undo / redo', () => {
  test('undo move restores original position', () => {
    const fig = makeFigureNode({ id: 'f1', transform: { ...IDENTITY, tx: 10, ty: 20 } });
    const nodes = buildMap(fig);

    const { nodes: moved, undoEntry } = moveNode(nodes, 'f1', 5, -3);
    const reverted = revertSceneUndoEntry(moved, undoEntry);

    expect((reverted.get('f1') as FigureNode).transform.tx).toBe(10);
    expect((reverted.get('f1') as FigureNode).transform.ty).toBe(20);
  });

  test('redo move re-applies', () => {
    const fig = makeFigureNode({ id: 'f1', transform: { ...IDENTITY, tx: 10, ty: 20 } });
    const nodes = buildMap(fig);

    const { nodes: moved, undoEntry } = moveNode(nodes, 'f1', 5, -3);
    const reverted = revertSceneUndoEntry(moved, undoEntry);
    const redone = applySceneUndoEntry(reverted, undoEntry);

    expect((redone.get('f1') as FigureNode).transform.tx).toBe(15);
    expect((redone.get('f1') as FigureNode).transform.ty).toBe(17);
  });

  test('undo group restores original state', () => {
    const f1 = makeFigureNode({ id: 'f1', transform: { ...IDENTITY, tx: 10, ty: 10 } });
    const f2 = makeFigureNode({ id: 'f2', transform: { ...IDENTITY, tx: 20, ty: 20 } });
    const nodes = buildMap(f1, f2);

    const { nodes: grouped, undoEntry } = groupNodes(nodes, ['f1', 'f2'], 'g1', 'G');

    expect(grouped.has('g1')).toBe(true);
    expect((grouped.get('f1') as FigureNode).parentId).toBe('g1');

    const reverted = revertSceneUndoEntry(grouped, undoEntry);

    expect(reverted.has('g1')).toBe(false);
    expect((reverted.get('f1') as FigureNode).parentId).toBeUndefined();
    expect((reverted.get('f2') as FigureNode).parentId).toBeUndefined();
  });

  test('undo ungroup restores group and children', () => {
    const groupT: Transform2D = { ...IDENTITY, tx: 100, ty: 100, sx: 2, sy: 2 };
    const group = makeGroupNode({ id: 'g1', transform: groupT });
    const f1 = makeFigureNode({ id: 'f1', parentId: 'g1', transform: { ...IDENTITY, tx: 5, ty: 5 } });
    const nodes = buildMap(group, f1);

    const { nodes: ungrouped, undoEntry } = ungroupNodes(nodes, 'g1');
    expect(ungrouped.has('g1')).toBe(false);

    const reverted = revertSceneUndoEntry(ungrouped, undoEntry);

    expect(reverted.has('g1')).toBe(true);
    expect((reverted.get('g1') as GroupNode2).transform).toEqual(groupT);
    expect((reverted.get('f1') as FigureNode).parentId).toBe('g1');
    expect((reverted.get('f1') as FigureNode).transform.tx).toBe(5);
    expect((reverted.get('f1') as FigureNode).transform.ty).toBe(5);
  });

  test('undo sequence: group → transform → ungroup → undo all', () => {
    const f1 = makeFigureNode({ id: 'f1', transform: { ...IDENTITY, tx: 10, ty: 10, sx: 2, sy: 2 } });
    let nodes = buildMap(f1);
    const originalBbox = getWorldBbox(nodes, 'f1', f1.localBbox);
    const undoStack: SceneUndoEntry[] = [];

    // Group
    let result = groupNodes(nodes, ['f1'], 'g1', 'G');
    nodes = result.nodes;
    undoStack.push(result.undoEntry);

    // Transform group
    const groupT: Transform2D = { tx: 50, ty: 50, sx: 3, sy: 3, rotation: 180, mirrorH: false, mirrorV: false };
    const transformResult = setNodeTransform(nodes, 'g1', groupT);
    nodes = transformResult.nodes;
    undoStack.push(transformResult.undoEntry);

    // Ungroup
    const ungroupResult = ungroupNodes(nodes, 'g1');
    nodes = ungroupResult.nodes;
    undoStack.push(ungroupResult.undoEntry);

    // Undo everything in reverse
    for (let i = undoStack.length - 1; i >= 0; i--) {
      nodes = revertSceneUndoEntry(nodes, undoStack[i]);
    }

    // Should be back to original
    const restoredBbox = getWorldBbox(nodes, 'f1', f1.localBbox);
    expect(bboxClose(restoredBbox, originalBbox)).toBe(true);
    expect(nodes.has('g1')).toBe(false);
    expect((nodes.get('f1') as FigureNode).parentId).toBeUndefined();
  });
});
