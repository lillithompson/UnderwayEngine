import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ViewProps } from 'react-native';
import type { RGBLike } from '../adapter';
import {
  EYEDROPPER_CROSSHAIR_SIZE,
  EYEDROPPER_RING_BORDER,
  EYEDROPPER_RING_RADIUS,
  clampEyedropperPoint,
  eyedropperStartPoint,
  isInsideEyedropperRing,
} from '../logic/eyedropper';
import { rgbCss } from '../logic/hsv';

// Facet's EyedropperOverlay, made project-agnostic: a draggable loupe the host
// lays over its canvas while the eyedropper is armed. The overlay owns only the
// ring — the host samples (engine `eyedropperSnapshot` / `eyedropperSampler`)
// in onPositionChange and feeds the result back as `sampledColor`, so the ring
// outline is always the color that would be committed.
//
// Pointer events (not the RN responder system) because the editor only ever
// renders on the web target, and pointer capture is what keeps a drag alive
// once the finger leaves the overlay.

export interface EyedropperOverlayProps {
  /** The color the host sampled at the current ring position; paints the ring. */
  sampledColor: RGBLike;
  canvasWidth: number;
  canvasHeight: number;
  /** Fires on mount and on every drag move, in canvas-local px. */
  onPositionChange(localX: number, localY: number): void;
  /** A press outside the ring. The host exits eyedropper mode, committing the
   *  last sampled color. */
  onDismiss(): void;
}

export function EyedropperOverlay({
  sampledColor,
  canvasWidth,
  canvasHeight,
  onPositionChange,
  onDismiss,
}: EyedropperOverlayProps) {
  const [pos, setPos] = useState(() => eyedropperStartPoint(canvasWidth, canvasHeight));
  const posRef = useRef(pos);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const draggingRef = useRef(false);

  // Sample once at the start position so the ring opens showing a real color.
  useEffect(() => {
    onPositionChange(posRef.current.x, posRef.current.y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const localPoint = (e: PointerEventLike) => {
    const rect = (e.currentTarget as unknown as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = useCallback((e: PointerEventLike) => {
    const { x, y } = localPoint(e);
    if (!isInsideEyedropperRing(posRef.current, x, y)) {
      onDismiss();
      return;
    }
    draggingRef.current = true;
    dragOffsetRef.current = { x: x - posRef.current.x, y: y - posRef.current.y };
    // Capture so moves past the overlay's edge still reach us.
    (e.currentTarget as unknown as HTMLElement).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }, [onDismiss]);

  const handlePointerMove = useCallback((e: PointerEventLike) => {
    if (!draggingRef.current) return;
    const { x, y } = localPoint(e);
    const next = clampEyedropperPoint(
      x - dragOffsetRef.current.x,
      y - dragOffsetRef.current.y,
      canvasWidth,
      canvasHeight,
    );
    posRef.current = next;
    setPos(next);
    onPositionChange(next.x, next.y);
  }, [canvasWidth, canvasHeight, onPositionChange]);

  const handlePointerUp = useCallback((e: PointerEventLike) => {
    draggingRef.current = false;
    (e.currentTarget as unknown as HTMLElement).releasePointerCapture?.(e.pointerId);
  }, []);

  const diameter = EYEDROPPER_RING_RADIUS * 2;
  const innerSize = diameter - EYEDROPPER_RING_BORDER * 2 - 2;

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.surface]}
      // RN types these as native pointer events; on the web target
      // react-native-web hands through React's DOM PointerEvent, which is what
      // the handlers read. The cast is that target difference, nothing more.
      onPointerDown={handlePointerDown as unknown as ViewProps['onPointerDown']}
      onPointerMove={handlePointerMove as unknown as ViewProps['onPointerMove']}
      onPointerUp={handlePointerUp as unknown as ViewProps['onPointerUp']}
      onPointerCancel={handlePointerUp as unknown as ViewProps['onPointerCancel']}
    >
      <View
        style={[styles.ring, {
          left: pos.x - EYEDROPPER_RING_RADIUS,
          top: pos.y - EYEDROPPER_RING_RADIUS,
          width: diameter,
          height: diameter,
          borderRadius: EYEDROPPER_RING_RADIUS,
          borderWidth: EYEDROPPER_RING_BORDER,
          borderColor: rgbCss(sampledColor),
        }]}
      >
        {/* Hairline inner ring keeps the loupe legible on a dark sample. */}
        <View
          style={[styles.innerRing, {
            width: innerSize,
            height: innerSize,
            borderRadius: innerSize / 2,
          }]}
        />
        <View
          style={[styles.crosshair, {
            width: EYEDROPPER_CROSSHAIR_SIZE,
            height: EYEDROPPER_CROSSHAIR_SIZE,
            borderRadius: EYEDROPPER_CROSSHAIR_SIZE / 2,
          }]}
        />
      </View>
    </View>
  );
}

/** The web PointerEvent fields the overlay reads. Typed locally so the package
 *  needs no DOM lib types on the react-native side. */
interface PointerEventLike {
  clientX: number;
  clientY: number;
  pointerId: number;
  currentTarget: unknown;
  preventDefault(): void;
}

const styles = StyleSheet.create({
  // touchAction/cursor are web-only; RN's style types don't know them.
  surface: { touchAction: 'none', cursor: 'crosshair' } as any,
  ring: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    backgroundColor: 'transparent',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 6,
  } as any,
  innerRing: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  crosshair: { backgroundColor: 'rgba(255,255,255,0.8)' },
});
