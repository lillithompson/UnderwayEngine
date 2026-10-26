import { useCallback, useRef } from 'react';
import { triggerHaptic } from '@/native-shell/bridge/webBridge';

// THE GATE BOTH PATTERN ROWS PASS EACH DRAG FRAME THROUGH: draw only where
// the whole step moved, and bump the finger when it does.
//
// Two statements, and the REF is the reason they are a module: it is the
// gate's memory of which step was last drawn, and it was never read anywhere
// else in any of the three shells — so it comes out of the shell entirely
// rather than being handed back. What the shell keeps is the question
// (`patternRowStep(next, committed)`), which is the whole of what its two
// callers ever asked.
//
// Nothing of any app is in it. `triggerHaptic` is the shell BRIDGE, which
// this package already reaches for the same purpose in `CanvasSurface`,
// `PatternActionsCapsule` and `PatternFillValueSlider` — a bump belongs to
// the control that earns it, and the bridge is the one import every Underway
// app resolves the same way.

export function usePatternRowStep() {
  /**
   * The gate both pattern rows pass each drag frame through: draw only
   * where the WHOLE STEP moved, and bump the finger when it does.
   *
   * The rows are integer-stepped (Resolution 1–8, Size 1–10), so a bump
   * per step is a bump per integer boundary — and a frame that lands on
   * the step already drawn is a frame with nothing to draw. Shared by the
   * Pattern page's sliders and the fill radial's floating row, which are
   * two ways into the same edit and must feel like one.
   *
   * Returns whether to apply. A COMMIT always applies (it is the one that
   * lands in undo) and forgets the step, so the next drag starts fresh.
   */
  const patternRowStepRef = useRef<number | null>(null);
  const patternRowStep = useCallback((next: number, committed: boolean): boolean => {
    if (committed) {
      patternRowStepRef.current = null;
      return true;
    }
    if (patternRowStepRef.current === next) return false;
    patternRowStepRef.current = next;
    triggerHaptic('light');
    return true;
  }, []);

  return {
    patternRowStep,
  };
}
