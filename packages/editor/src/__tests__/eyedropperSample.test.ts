/**
 * What the eyedropper reports for a point on the canvas.
 *
 * The sampler is layered on purpose and the layering is the contract: the
 * rasterized snapshot answers first (it is what the user can actually see —
 * photos, gradients, tints), the scene graph answers while that raster is still
 * being made or when it fails, and the page background answers for a point
 * where nothing is drawn. Null means "nothing to sample", which is the loupe's
 * cue to keep the color it already had.
 */

import {
  cellToSnapshotPx,
  parseSvgViewBox,
  sampleEditorColor,
  type CanvasSnapshot,
} from '../eyedropperSample';
import { makeBlankComposition } from '../blankComposition';
import { SVG_UNITS_PER_L0_CELL as U } from '@/engine/svgExport';
import type { CompositionState, PathSegment, RGBColor, SVGObject } from '@/engine/types';

const RED: RGBColor = { r: 200, g: 60, b: 60 };
const BLUE: RGBColor = { r: 30, g: 60, b: 200 };

/** A 2×2-pixel snapshot covering world cells (0,0)–(4,4), with one color per
 *  pixel and a fully transparent bottom-right. */
function snapshot(pixels: number[]): CanvasSnapshot {
  return {
    pixels: new Uint8Array(pixels),
    width: 2,
    height: 2,
    viewBox: { x: 0, y: 0, width: 4 * U, height: 4 * U },
  };
}

const OPAQUE_GRID = snapshot([
  200, 60, 60, 255, /* (0,0) red   */ 30, 60, 200, 255, /* (1,0) blue  */
  10, 200, 10, 255, /* (0,1) green */ 0, 0, 0, 0, /* (1,1) transparent */
]);

const line = (start: [number, number], end: [number, number]): PathSegment =>
  ({ kind: 'line', start, end });

function lineSvg(color: RGBColor): SVGObject {
  return {
    id: 'svg_line',
    segments: [line([0, 2], [4, 2])],
    color: { ...color },
    cellX: 0, cellY: 2, cellWidth: 4, cellHeight: 0,
  };
}

function stateWith(svgObjects: SVGObject[] = []): CompositionState {
  const base = makeBlankComposition('comp_eyedropper');
  return {
    ...base,
    svgObjects,
    sceneOrder: svgObjects.map((s) => s.id),
  };
}

describe('parseSvgViewBox', () => {
  it('reads the four numbers off an SVG root', () => {
    expect(parseSvgViewBox('<svg width="10" viewBox="-8 4 256 512" fill="none">'))
      .toEqual({ x: -8, y: 4, width: 256, height: 512 });
  });

  it('accepts fractional and exponent-form numbers', () => {
    expect(parseSvgViewBox('<svg viewBox="0.5 -1.25 1e2 40">'))
      .toEqual({ x: 0.5, y: -1.25, width: 100, height: 40 });
  });

  it('rejects a missing, malformed, or degenerate box', () => {
    expect(parseSvgViewBox('<svg width="10">')).toBeNull();
    expect(parseSvgViewBox('<svg viewBox="0 0 100">')).toBeNull();
    expect(parseSvgViewBox('<svg viewBox="0 0 0 100">')).toBeNull();
  });
});

describe('cellToSnapshotPx', () => {
  it('maps world cells onto the pixel grid through the viewBox', () => {
    expect(cellToSnapshotPx(OPAQUE_GRID, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(cellToSnapshotPx(OPAQUE_GRID, 2, 2)).toEqual({ x: 1, y: 1 });
    expect(cellToSnapshotPx(OPAQUE_GRID, 4, 4)).toEqual({ x: 2, y: 2 });
  });

  it('honors a viewBox that does not start at the origin', () => {
    const offset: CanvasSnapshot = {
      ...OPAQUE_GRID,
      viewBox: { x: 2 * U, y: 2 * U, width: 4 * U, height: 4 * U },
    };
    expect(cellToSnapshotPx(offset, 2, 2)).toEqual({ x: 0, y: 0 });
    expect(cellToSnapshotPx(offset, 4, 4)).toEqual({ x: 1, y: 1 });
  });
});

describe('sampleEditorColor', () => {
  it('reads the snapshot pixel under the point', () => {
    const state = stateWith();
    expect(sampleEditorColor(state, OPAQUE_GRID, 1, 1)).toEqual(RED);
    expect(sampleEditorColor(state, OPAQUE_GRID, 3, 1)).toEqual(BLUE);
  });

  it('is camera-independent — the same cell samples the same pixel', () => {
    const state = stateWith();
    const zoomedIn = { ...state, camera: { ...state.camera, zoom: 4 } };
    expect(sampleEditorColor(zoomedIn, OPAQUE_GRID, 3, 1)).toEqual(BLUE);
  });

  it('falls through a transparent pixel to the scene graph', () => {
    // The bottom-right snapshot pixel is transparent; a line runs through
    // that cell, so its color is the honest answer for the point.
    const state = stateWith([lineSvg(RED)]);
    expect(sampleEditorColor(state, OPAQUE_GRID, 3, 2)).toEqual(RED);
  });

  it('uses the scene graph when there is no snapshot yet', () => {
    const state = stateWith([lineSvg(BLUE)]);
    expect(sampleEditorColor(state, null, 2, 2)).toEqual(BLUE);
  });

  it('falls back to a solid page background where nothing is drawn', () => {
    const state = { ...stateWith(), background: { kind: 'solid' as const, color: BLUE } };
    expect(sampleEditorColor(state, null, 20, 20)).toEqual(BLUE);
  });

  it('reports nothing for empty space with no background', () => {
    expect(sampleEditorColor(stateWith(), null, 20, 20)).toBeNull();
    // A gradient background has no single color to report either.
    const gradient = {
      ...stateWith(),
      background: {
        kind: 'linear' as const,
        stops: [{ offset: 0, color: RED }, { offset: 1, color: BLUE }],
        x1: 0, y1: 0, x2: 0, y2: 1,
      },
    };
    expect(sampleEditorColor(gradient, null, 20, 20)).toBeNull();
  });
});
