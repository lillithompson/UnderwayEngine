import { makeBlankComposition } from '@/editor/blankComposition';
import {
  EditorSession,
  buildPlaceImage,
  buildPlacePattern,
  buildPlaceShape,
  buildPlaceText,
  buildRenameNode,
  buildReorderTo,
  buildToggleHidden,
  commitEntry,
  createEditorSession,
  undo,
  redo,
} from '../editorSession';
import { RGBColor } from '@/engine/types';

const INK: RGBColor = { r: 40, g: 40, b: 40 };

/** A session with three stacked rectangles (sceneOrder back→front). */
function threeShapes(): { session: EditorSession; ids: string[] } {
  let session = createEditorSession(makeBlankComposition('c1'));
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const se = buildPlaceShape('rect', { cellX: i, cellY: i, cellWidth: 4, cellHeight: 4 }, INK);
    session = commitEntry(session, se);
    ids.push(se.id!);
  }
  return { session, ids };
}

describe('buildReorderTo', () => {
  test('rejects a non-permutation (wrong length)', () => {
    const { session, ids } = threeShapes();
    expect(buildReorderTo(session.state, [ids[0], ids[1]])).toBeNull();
  });

  test('rejects a non-permutation (unknown id swapped in)', () => {
    const { session, ids } = threeShapes();
    expect(buildReorderTo(session.state, [ids[0], ids[1], 'ghost'])).toBeNull();
  });

  test('returns null for a no-op (unchanged order)', () => {
    const { session } = threeShapes();
    expect(buildReorderTo(session.state, [...session.state.sceneOrder])).toBeNull();
  });

  test('emits a reorderObjects op whose newOrder matches the drag result', () => {
    const { session } = threeShapes();
    const reversed = [...session.state.sceneOrder].reverse();
    const se = buildReorderTo(session.state, reversed);
    expect(se).not.toBeNull();
    expect(se!.entry).toHaveLength(1);
    const op = se!.entry[0];
    expect(op.op).toBe('reorderObjects');
    if (op.op === 'reorderObjects') {
      expect(op.oldOrder).toEqual(session.state.sceneOrder);
      expect(op.newOrder).toEqual(reversed);
    }
  });

  test('commit applies the new order; undo/redo round-trips exactly', () => {
    const { session } = threeShapes();
    const original = [...session.state.sceneOrder];
    const reversed = [...original].reverse();

    const committed = commitEntry(session, buildReorderTo(session.state, reversed)!);
    expect([...committed.state.sceneOrder]).toEqual(reversed);

    const undone = undo(committed);
    expect([...undone.state.sceneOrder]).toEqual(original);

    const redone = redo(undone);
    expect([...redone.state.sceneOrder]).toEqual(reversed);
  });
});

describe('buildToggleHidden', () => {
  test('toggles hidden and round-trips through undo', () => {
    const { session, ids } = threeShapes();
    const se = buildToggleHidden(session.state, ids[0]);
    expect(se).not.toBeNull();

    const hiddenNow = commitEntry(session, se!);
    expect(hiddenNow.state.svgObjects.find((s) => s.id === ids[0])?.hidden).toBe(true);

    const undone = undo(hiddenNow);
    expect(undone.state.svgObjects.find((s) => s.id === ids[0])?.hidden ?? false).toBe(false);
  });

  test('returns null for an unknown id', () => {
    const { session } = threeShapes();
    expect(buildToggleHidden(session.state, 'ghost')).toBeNull();
  });
});

describe('buildRenameNode', () => {
  test('renames an svg via renameSVG and undo restores', () => {
    const { session, ids } = threeShapes();
    const se = buildRenameNode(session.state, ids[0], '  My Rect  ');
    expect(se!.entry[0].op).toBe('renameSVG');
    const named = commitEntry(session, se!);
    expect(named.state.svgObjects.find((s) => s.id === ids[0])?.name).toBe('My Rect');
    expect(undo(named).state.svgObjects.find((s) => s.id === ids[0])?.name).toBeUndefined();
  });

  test('renames a text via a scene swap', () => {
    let session = createEditorSession(makeBlankComposition('c2'));
    const place = buildPlaceText('hello', { fontId: 'system', size: 2, color: INK }, 8, 8);
    session = commitEntry(session, place);
    const se = buildRenameNode(session.state, place.id!, 'Greeting');
    expect(se!.entry[0].op).toBe('replaceScene');
    const named = commitEntry(session, se!);
    expect(named.state.texts?.find((t) => t.id === place.id)?.name).toBe('Greeting');
  });

  test('renames an image via a scene swap', () => {
    let session = createEditorSession(makeBlankComposition('c3'));
    const place = buildPlaceImage('img1', 'image/png', 100, 100,
      { cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 }, new Uint8Array([1, 2, 3]));
    session = commitEntry(session, place);
    const named = commitEntry(session, buildRenameNode(session.state, place.id!, 'Photo A')!);
    expect(named.state.images?.find((i) => i.id === place.id)?.name).toBe('Photo A');
  });

  test('renames a pattern object via a scene swap, and undo restores — the outline used to refuse it', () => {
    // A pattern object had no rename case at all, so the long-press rename
    // in the Scene Outline returned null and the row stayed "Pattern".
    let session = createEditorSession(makeBlankComposition('c4'));
    const place = buildPlacePattern({ cellX: 2, cellY: 2, cellWidth: 8, cellHeight: 8 }, 4, 4);
    session = commitEntry(session, place);
    const se = buildRenameNode(session.state, place.id!, '  Lattice ');
    expect(se!.entry[0].op).toBe('replaceScene');
    const named = commitEntry(session, se!);
    expect(named.state.patternObjects?.find((p) => p.id === place.id)?.name).toBe('Lattice');
    expect(undo(named).state.patternObjects?.find((p) => p.id === place.id)?.name).toBeUndefined();
  });

  test('returns null for a no-op rename (empty trims to unchanged)', () => {
    const { session, ids } = threeShapes();
    expect(buildRenameNode(session.state, ids[0], '   ')).toBeNull();
  });
});
