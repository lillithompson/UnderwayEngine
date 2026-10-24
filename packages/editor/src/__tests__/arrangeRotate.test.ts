import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  ROTATE_SLIDER_SPAN_DEG, angleFromSlider, seatAfterCommit, sliderFromAngle,
} from '../arrangeRotate';

// The Rotate slider's ARITHMETIC — the part that was byte-identical in all
// three apps (stage 6.5a of docs/shared-editor.md). What the slider has in
// hand (`rotateSliderTargets`) differs in all three and stays each app's.

describe('the slider’s span and its two readings', () => {
  it('one full turn, straight up in the middle', () => {
    expect(ROTATE_SLIDER_SPAN_DEG).toBe(360);
    expect(sliderFromAngle(0)).toBe(0.5);
    expect(angleFromSlider(0.5)).toBe(0);
  });

  it('the ends are −180° and +180°', () => {
    expect(sliderFromAngle(-180)).toBe(0);
    expect(sliderFromAngle(180)).toBe(1);
    expect(angleFromSlider(0)).toBe(-180);
    expect(angleFromSlider(1)).toBe(180);
  });

  it('the two readings are inverses across the span', () => {
    for (const deg of [-180, -135, -90, -45, -1, 0, 1, 45, 90, 135, 180]) {
      expect(angleFromSlider(sliderFromAngle(deg))).toBeCloseTo(deg, 10);
    }
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(sliderFromAngle(angleFromSlider(t))).toBeCloseTo(t, 10);
    }
  });

  it('both ends clamp rather than wrapping — a handle cannot be dragged past a half turn', () => {
    expect(sliderFromAngle(540)).toBe(1);
    expect(sliderFromAngle(-540)).toBe(0);
    expect(angleFromSlider(2)).toBe(180);
    expect(angleFromSlider(-2)).toBe(-180);
  });
});

describe('seatAfterCommit — where the row stands once a drag has landed', () => {
  it('a group’s row goes back to its seat: the turn is spent', () => {
    // The bug this exists for: the row's `seatDeg` for a group is the
    // constant 0, so an effect watching it never fires after a commit, and
    // the NEXT drag re-applied the standing offset as a fresh delta.
    expect(seatAfterCommit('delta', 0, 170)).toBe(0);
    expect(seatAfterCommit('delta', 0, -170)).toBe(0);
  });

  it('one object’s row stays on the angle it committed', () => {
    expect(seatAfterCommit('absolute', 0, 30)).toBe(30);
    expect(seatAfterCommit('absolute', 30, -90)).toBe(-90);
  });

  it('the mode decides, not the numbers', () => {
    expect(seatAfterCommit('delta', 12, 90)).toBe(12);
    expect(seatAfterCommit('absolute', 12, 90)).toBe(90);
  });
});

describe('the row itself', () => {
  // Read as text, not imported: a .tsx is typechecked in the three apps,
  // where real react-native is — the engine's shim carries only what the
  // engine touches.
  const ROW = readFileSync(resolve(__dirname, '..', 'components', 'ArrangeRotateSlider.tsx'), 'utf8');

  it('does the arithmetic through this module rather than its own', () => {
    expect(ROW).toContain(`import { angleFromSlider, seatAfterCommit, sliderFromAngle } from '../arrangeRotate';`);
    expect(ROW).not.toMatch(/\/ 360|\* 360|- 0\.5|\+ 0\.5/);
  });

  it('stands in the floating slider row’s own slot', () => {
    expect(ROW).toContain('FLOATING_SLIDER_BOTTOM');
    expect(ROW).toContain('FloatingSliderRow');
  });
});
