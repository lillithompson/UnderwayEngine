import { applyCompOps } from '@/engine/compositionOps';
import type { RGBColor } from '@/engine/types';
import { SVG_UNITS_PER_L0_CELL } from '@/engine/svgExport';
import { makeBlankComposition } from '@/editor/blankComposition';
import {
  type PhotoPlaceholder,
  buildMirrorSelected, buildPlaceLineShape, buildPlacePhotoPlaceholder, buildPlacePolygonShape,
  buildPlacePolyline, buildPlaceShape, commitEntry, createEditorSession, resolveSelectionBox,
} from '../editorSession';
import { selectionShapePath, shapeOutlineViewBox } from '../selectionShapeOutline';
import { arrangeModeNoScale, arrangeModeTracesShape } from '../components/toolbarMeta';
import { clearCanvasHost, installCanvasHost } from '../components/canvasHooks';

// Move and Rotate ring the object's OWN border rather than a rectangle
// round it (selectionShapeOutline.ts). Select keeps the box — that is the
// mode whose corners can be grabbed. How an app's canvas draws it is
// pinned where that happens.

const INK: RGBColor = { r: 40, g: 40, b: 40 };
/** A photo slot with no bytes. Each app has its own sentinel id and
 *  nothing here depends on which. */
const PHOTO_PLACEHOLDER: PhotoPlaceholder = {
  imageId: 'test:photo-placeholder', mime: 'image/png', pixelW: 400, pixelH: 300,
};

beforeEach(() => clearCanvasHost());
afterEach(() => clearCanvasHost());

function placed(build: ReturnType<typeof buildPlaceShape>) {
  const session = commitEntry(createEditorSession(makeBlankComposition('so1')), build);
  const box = resolveSelectionBox(session.state, build.id!)!;
  return {
    state: session.state,
    id: build.id!,
    path: selectionShapePath(session.state, build.id!, box.local, box.freeAxis),
    box,
  };
}

describe('which selections get their own border', () => {
  test('a shape traces its path, in the box’s own space', () => {
    const { path, box } = placed(
      buildPlaceShape('star', { cellX: 2, cellY: 3, cellWidth: 6, cellHeight: 5 }, INK),
    );
    expect(path).not.toBeNull();
    expect(path!.d).toMatch(/^M /);
    // The viewBox is `local` — the box the selection element is the IMAGE
    // of — so stretching this svg over that element lands the path exactly
    // where the rectangle was, at any scale or rotation.
    const u = SVG_UNITS_PER_L0_CELL;
    const local = box.local!;
    expect(shapeOutlineViewBox(path!.units)).toBe(
      `${local.x * u} ${local.y * u} ${local.width * u} ${local.height * u}`,
    );
  });

  test('a shape with several loops traces them all, not just the first', () => {
    const { path } = placed(
      buildPlaceShape('star', { cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 }, INK),
    );
    // The path is one walk of the object's whole segment list (buildPathD), so a
    // merged object's loose chain is drawn beside its closed loop.
    expect(path!.d.length).toBeGreaterThan(10);
  });

  test('a mirrored shape draws its border the way round the object is', () => {
    // The box drops the signs of the scale (drawnBox takes the absolutes), so
    // a flip has to be put back inside the viewBox or an asymmetric shape's
    // border would trace its unflipped self.
    const { state, id, box } = placed(
      buildPlaceShape('star', { cellX: 0, cellY: 0, cellWidth: 6, cellHeight: 4 }, INK),
    );
    expect(selectionShapePath(state, id, box.local, box.freeAxis)!.transform).toBeUndefined();
    const flipped = applyCompOps(state, buildMirrorSelected(state, id, 'v')!.entry);
    const sel = resolveSelectionBox(flipped, id)!;
    expect(selectionShapePath(flipped, id, sel.local, sel.freeAxis)!.transform)
      .toMatch(/^matrix\(1 0 0 -1 0 /);
  });

  test('a photo keeps its rectangle: its border IS a box', () => {
    const { path } = placed(
      buildPlacePhotoPlaceholder({ cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 3 }, PHOTO_PLACEHOLDER),
    );
    expect(path).toBeNull();
  });

  test('a node the HOST keeps a record beside keeps its box', () => {
    // CozyJournal's rig figure is the case: an svg object whose subpaths
    // are a BAKE of a pose, so it would otherwise be traced limb by limb —
    // a ragged silhouette that reads as part of the drawing rather than as
    // a selection, and the one outline that moves under you, since posing a
    // joint reshapes it. Its box is what every grab on it acts on.
    const shape = placed(
      buildPlaceShape('star', { cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 }, INK),
    );
    expect(shape.path).not.toBeNull();
    // Same object, same page: the only thing that changed is that the host
    // answers for it now. The rule is the RECORD, not the shape of the path.
    installCanvasHost({ records: () => ({ has: (id) => id === shape.id }) });
    expect(selectionShapePath(shape.state, shape.id, shape.box.local, shape.box.freeAxis))
      .toBeNull();
    // …and a host with nothing of its own on this page changes nothing.
    installCanvasHost({ records: () => null });
    expect(selectionShapePath(shape.state, shape.id, shape.box.local, shape.box.freeAxis))
      .not.toBeNull();
  });

  test('nothing selected, nothing drawn', () => {
    const session = createEditorSession(makeBlankComposition('so2'));
    expect(selectionShapePath(session.state, null, { x: 0, y: 0, width: 1, height: 1 }, null)).toBeNull();
  });

  test('a legacy item with no local box keeps the rectangle', () => {
    const { state, id } = placed(
      buildPlaceShape('rect', { cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 }, INK),
    );
    expect(selectionShapePath(state, id, null, null)).toBeNull();
  });

  test('a simple line keeps its straddle box — the reach a grab actually has', () => {
    const { path, box } = placed(buildPlaceLineShape([2, 4], [10, 4], INK, 'line', 0)!);
    expect(box.freeAxis).toBe('x');
    expect(path).toBeNull();
    // A free-angle line is open too, so it keeps its box like any stroke.
    const diag = placed(buildPlaceLineShape([0, 0], [8, 6], INK, 'line', 0)!);
    expect(diag.box.freeAxis).toBeNull();
    expect(diag.path).toBeNull();
  });

  test('an open stroke keeps its box — only a closed shape traces its border', () => {
    const { path } = placed(buildPlacePolyline([[0, 0], [3, 4], [6, 1], [9, 5]], INK)!);
    expect(path).toBeNull();
  });

  test('closed shapes trace: rectangle, ellipse, polygon', () => {
    for (const kind of ['rect', 'ellipse'] as const) {
      const { path } = placed(
        buildPlaceShape(kind, { cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 }, INK),
      );
      expect(path).not.toBeNull();
    }
    const poly = placed(buildPlacePolygonShape([4, 4], [8, 8], 5, INK)!);
    expect(poly.path).not.toBeNull();
  });
});

describe('the modes that ask for it', () => {
  test('Move and Rotate, and not Select', () => {
    expect(arrangeModeNoScale('arrange', 'move')).toBe(true);
    expect(arrangeModeNoScale('arrange', 'rotate')).toBe(true);
    expect(arrangeModeNoScale('arrange', 'select')).toBe(false);
    // …and only under the selection tool: every other tool keeps its own
    // chrome.
    expect(arrangeModeNoScale('lines', 'move')).toBe(false);
  });

  test('the mode alone, for the tools that ask without being the selection tool', () => {
    expect(arrangeModeTracesShape('move')).toBe(true);
    expect(arrangeModeTracesShape('rotate')).toBe(true);
    expect(arrangeModeTracesShape('select')).toBe(false);
  });
});
