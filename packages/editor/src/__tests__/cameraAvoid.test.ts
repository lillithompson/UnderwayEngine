/**
 * Camera-avoid target math (cameraAvoid.ts): the camera that slides the
 * selection just above bottom-anchored UI — when it fires, where it lands,
 * the top-chrome clamp for selections taller than the gap, and the pan's
 * zoom conversion.
 */

import { CAMERA_AVOID_MARGIN_PX, cameraAvoidingBottomInset, shellAvoidBottomPx } from '../cameraAvoid';
import { worldToScreen } from '../cameraMath';
import { Camera, makeViewport } from '@/engine/types';

const VP = makeViewport(400, 800);
const CAM: Camera = { offsetX: 0, offsetY: 0, zoom: 1 };

describe('cameraAvoidingBottomInset', () => {
  it('does nothing with no occlusion', () => {
    const bbox = { cellX: 8, cellY: 24, cellWidth: 8, cellHeight: 4 };
    expect(cameraAvoidingBottomInset(CAM, VP, bbox, 0)).toBeNull();
  });

  it('does nothing when the selection already clears the UI', () => {
    // Bottom edge at screen y 550; occluding 229 px leaves visible space
    // down to 800 − 229 − 12 = 559.
    const bbox = { cellX: 8, cellY: 24, cellWidth: 8, cellHeight: 4 };
    expect(cameraAvoidingBottomInset(CAM, VP, bbox, 229)).toBeNull();
  });

  it('pans up exactly enough to sit the bottom edge margin px above the UI', () => {
    const bbox = { cellX: 8, cellY: 24, cellWidth: 8, cellHeight: 4 }; // bottom at y 550
    const target = cameraAvoidingBottomInset(CAM, VP, bbox, 300);
    expect(target).not.toBeNull();
    // Only a vertical pan.
    expect(target!.zoom).toBe(CAM.zoom);
    expect(target!.offsetX).toBe(CAM.offsetX);
    const bottomY = worldToScreen(bbox.cellX, bbox.cellY + bbox.cellHeight, target!, VP).y;
    expect(bottomY).toBeCloseTo(VP.height - 300 - CAMERA_AVOID_MARGIN_PX);
  });

  it('clamps so a selection taller than the gap keeps its top at the chrome', () => {
    // Full-page-height selection: top at y 200, bottom at y 600.
    const bbox = { cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32 };
    const target = cameraAvoidingBottomInset(CAM, VP, bbox, 300, 90);
    expect(target).not.toBeNull();
    const topY = worldToScreen(bbox.cellX, bbox.cellY, target!, VP).y;
    // Top lands at chrome + margin; the bottom stays partially occluded.
    expect(topY).toBeCloseTo(90 + CAMERA_AVOID_MARGIN_PX);
    const bottomY = worldToScreen(bbox.cellX, bbox.cellY + bbox.cellHeight, target!, VP).y;
    expect(bottomY).toBeGreaterThan(VP.height - 300 - CAMERA_AVOID_MARGIN_PX);
  });

  it('does nothing when the top edge is already against the chrome', () => {
    // Top at y 100 — above the 90 + 12 chrome line — with the bottom occluded:
    // there is nowhere to scroll without hiding the top.
    const bbox = { cellX: 0, cellY: -8, cellWidth: 32, cellHeight: 40 };
    expect(cameraAvoidingBottomInset(CAM, VP, bbox, 300, 90)).toBeNull();
  });

  it('picks the shell occluder: keyboard while editing text, panel otherwise, none on web', () => {
    expect(shellAvoidBottomPx({
      native: false, editingText: true, keyboardInsetPx: 300, panelOccludedPx: 129,
    })).toBe(0);
    expect(shellAvoidBottomPx({
      native: true, editingText: false, keyboardInsetPx: 0, panelOccludedPx: 129,
    })).toBe(129);
    expect(shellAvoidBottomPx({
      native: true, editingText: true, keyboardInsetPx: 300, panelOccludedPx: 129,
    })).toBe(300);
    // Editing before the keyboard reports: nothing to avoid yet — the glide
    // starts when the keyboard actually arrives.
    expect(shellAvoidBottomPx({
      native: true, editingText: true, keyboardInsetPx: 0, panelOccludedPx: 129,
    })).toBe(0);
  });

  it('converts the screen-px pan through the zoom', () => {
    const cam: Camera = { offsetX: 0, offsetY: 0, zoom: 2 };
    const bbox = { cellX: 8, cellY: 20, cellWidth: 8, cellHeight: 4 }; // bottom at y 600
    const target = cameraAvoidingBottomInset(cam, VP, bbox, 300);
    expect(target).not.toBeNull();
    // 112 px of screen shift is 56 offset units at zoom 2.
    expect(target!.offsetY).toBeCloseTo(-56);
    const bottomY = worldToScreen(bbox.cellX, bbox.cellY + bbox.cellHeight, target!, VP).y;
    expect(bottomY).toBeCloseTo(VP.height - 300 - CAMERA_AVOID_MARGIN_PX);
  });
});
