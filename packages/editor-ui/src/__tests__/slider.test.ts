import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  BRUSH_HANDLE_GRAB_SLOP,
  beginValueDrag, brushDotSize, brushSliderGrabsHandle, brushSliderValueFromX,
  endValueDrag, isSingleTouchGesture, isValueDragging,
  padOffsetFromTouch, sliderValueFromX,
} from '../logic/slider';

describe('sliderValueFromX', () => {
  test('maps a touch to its fraction across the track', () => {
    expect(sliderValueFromX(0, 200, 0.5)).toBe(0);
    expect(sliderValueFromX(100, 200, 0.5)).toBe(0.5);
    expect(sliderValueFromX(200, 200, 0.5)).toBe(1);
  });

  test('clamps a touch past either edge into 0–1', () => {
    expect(sliderValueFromX(-40, 200, 0.5)).toBe(0);
    expect(sliderValueFromX(9000, 200, 0.5)).toBe(1);
  });

  // The reported bug: the first opacity-slider grab rendered "NaN%".
  test('holds the current value for a non-finite touch, never yielding NaN', () => {
    // react-native-web's first onPanResponderGrant delivers locationX === NaN.
    expect(sliderValueFromX(NaN, 200, 0.42)).toBe(0.42);
    expect(sliderValueFromX(NaN, 200, 0.42)).not.toBeNaN();
    // Undefined coming through as a number is guarded the same way.
    expect(sliderValueFromX(undefined as unknown as number, 200, 0.7)).toBe(0.7);
  });

  test('holds the current value before the track has been measured', () => {
    expect(sliderValueFromX(100, 0, 0.3)).toBe(0.3);
  });

  test('clamps the held current value too, so it can never leak out of range', () => {
    expect(sliderValueFromX(NaN, 200, 5)).toBe(1);
    expect(sliderValueFromX(NaN, 200, -2)).toBe(0);
  });
});

describe('brushSliderValueFromX', () => {
  // 260px track, 44px handle: the handle's center runs 22 → 238.
  test('maps a touch to the handle-center run, not the raw track', () => {
    expect(brushSliderValueFromX(22, 260, 44, 0.5)).toBe(0);
    expect(brushSliderValueFromX(130, 260, 44, 0.5)).toBe(0.5);
    expect(brushSliderValueFromX(238, 260, 44, 0.5)).toBe(1);
  });

  test('clamps touches on the end caps (where the handle cannot center)', () => {
    expect(brushSliderValueFromX(0, 260, 44, 0.5)).toBe(0);
    expect(brushSliderValueFromX(260, 260, 44, 0.5)).toBe(1);
  });

  test('holds the current value for a non-finite touch or unmeasured track', () => {
    expect(brushSliderValueFromX(NaN, 260, 44, 0.42)).toBe(0.42);
    expect(brushSliderValueFromX(130, 0, 44, 0.3)).toBe(0.3);
    // A track no wider than its handle has no run at all.
    expect(brushSliderValueFromX(130, 44, 44, 0.6)).toBe(0.6);
  });
});

describe('brushSliderGrabsHandle', () => {
  // Same 260/44 geometry: the handle's LEFT edge runs 0 → 216.
  const grabs = (x: number, value: number) => brushSliderGrabsHandle(x, 260, 44, value);

  test('a touch on the handle is a grab, wherever the handle is sitting', () => {
    expect(grabs(22, 0)).toBe(true);       // centred on it at the left end
    expect(grabs(130, 0.5)).toBe(true);    // …and in the middle
    expect(grabs(238, 1)).toBe(true);      // …and at the right end
  });

  test('a touch on the bare track is not — tapping cannot set the value', () => {
    // The whole point: the handle sits at the left end and a tap lands far
    // down the track. Before this it jumped the value there.
    expect(grabs(200, 0)).toBe(false);
    expect(grabs(20, 1)).toBe(false);
    // Just past the handle's rim (plus its slop) on either side.
    expect(grabs(108 - BRUSH_HANDLE_GRAB_SLOP - 1, 0.5)).toBe(false);
    expect(grabs(152 + BRUSH_HANDLE_GRAB_SLOP + 1, 0.5)).toBe(false);
  });

  test('a near-miss at the rim still counts — a fingertip is wider than a point', () => {
    expect(grabs(108 - BRUSH_HANDLE_GRAB_SLOP, 0.5)).toBe(true);
    expect(grabs(152 + BRUSH_HANDLE_GRAB_SLOP, 0.5)).toBe(true);
  });

  test('an un-locatable touch is undecided, not a miss', () => {
    // react-native-web's first grant reports NaN; answering "miss" there
    // would make the first drag after a panel appears do nothing.
    expect(grabs(NaN, 0.5)).toBeNull();
    expect(brushSliderGrabsHandle(130, 44, 44, 0.5)).toBeNull();
  });

  test('an out-of-range value is clamped, like the layout that draws it', () => {
    expect(grabs(22, -1)).toBe(true);
    expect(grabs(238, 4)).toBe(true);
  });
});

describe('brushDotSize', () => {
  test('runs linearly from min to max', () => {
    expect(brushDotSize(0, 6, 34)).toBe(6);
    expect(brushDotSize(0.5, 6, 34)).toBe(20);
    expect(brushDotSize(1, 6, 34)).toBe(34);
  });

  test('never collapses below min or overflows max on out-of-range values', () => {
    expect(brushDotSize(-1, 6, 34)).toBe(6);
    expect(brushDotSize(2, 6, 34)).toBe(34);
  });
});

describe('padOffsetFromTouch', () => {
  const HELD: [number, number] = [0.4, -0.9];

  test('maps a touch to ±max about the pad’s center', () => {
    expect(padOffsetFromTouch(0, 0, 100, 1.5, HELD)).toEqual([-1.5, -1.5]);
    expect(padOffsetFromTouch(50, 50, 100, 1.5, HELD)).toEqual([0, 0]);
    expect(padOffsetFromTouch(100, 100, 100, 1.5, HELD)).toEqual([1.5, 1.5]);
  });

  test('clamps a touch dragged off the pad to its edge', () => {
    expect(padOffsetFromTouch(-80, 900, 100, 1.5, HELD)).toEqual([-1.5, 1.5]);
  });

  test('holds the current offset for a non-finite touch, never yielding NaN', () => {
    // The unguarded version turned an un-locatable release into NaN offsets —
    // the same react-native-web quirk sliderValueFromX guards against.
    expect(padOffsetFromTouch(NaN, 50, 100, 1.5, HELD)).toEqual(HELD);
    expect(padOffsetFromTouch(50, undefined as unknown as number, 100, 1.5, HELD)).toEqual(HELD);
    expect(padOffsetFromTouch(NaN, NaN, 100, 1.5, HELD).some(Number.isNaN)).toBe(false);
  });

  test('holds it before the pad has been measured', () => {
    expect(padOffsetFromTouch(50, 50, 0, 1.5, HELD)).toEqual(HELD);
  });
});

describe('isSingleTouchGesture', () => {
  test('a value control answers to one finger and no more', () => {
    expect(isSingleTouchGesture(1)).toBe(true);
    expect(isSingleTouchGesture(2)).toBe(false);
    expect(isSingleTouchGesture(3)).toBe(false);
  });

  test('treats an empty gesture as one — a release must never read as multi', () => {
    // The last finger up can report zero touches; that has to fall on the
    // "ours" side or a normal drag would abandon itself at the end.
    expect(isSingleTouchGesture(0)).toBe(true);
  });
});

// The bug this guards: the properties panel's submenu bars ride a
// horizontal carousel, and dragging a Width slider IS a horizontal drag.
// The carousel would take the gesture, terminate the slider mid-drag and
// fling the bar away; returning to it re-seeded the bar's draft from the
// model, so the thumb sprang back to where the drag began. Loudest on a
// PATTERN, whose Stroke bar has three carousel siblings to be flung into.
describe('the value-drag guard', () => {
  afterEach(() => {
    // Never leave a claim standing — a leaked one deadens every swipe.
    while (isValueDragging()) endValueDrag();
  });

  it('is clear until a control takes a touch, and clear again after', () => {
    expect(isValueDragging()).toBe(false);
    beginValueDrag();
    expect(isValueDragging()).toBe(true);
    endValueDrag();
    expect(isValueDragging()).toBe(false);
  });

  it('counts, so two controls at once release independently', () => {
    // A multi-touch can grab two sliders; the first to let go must not
    // clear the other's claim and hand the carousel a live gesture.
    beginValueDrag();
    beginValueDrag();
    endValueDrag();
    expect(isValueDragging()).toBe(true);
    endValueDrag();
    expect(isValueDragging()).toBe(false);
  });

  it('never goes negative, so a stray release cannot arm it', () => {
    // Release and terminate can both fire for one gesture. An unbalanced
    // end must floor at zero — otherwise the NEXT drag's begin would only
    // bring the count back to nought and the guard would read "not
    // dragging" for the whole gesture.
    endValueDrag();
    endValueDrag();
    expect(isValueDragging()).toBe(false);
    beginValueDrag();
    expect(isValueDragging()).toBe(true);
  });
});

// The controls and the swipe handlers are react-native and never render in
// node, so the wiring is pinned by source.
describe('the drag guard is actually wired up', () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

  it('every path out of a slider gesture releases the claim', () => {
    const SRC = read('components/Slider.tsx');
    expect(SRC).toContain('onPanResponderGrant');
    expect(SRC.match(/beginValueDrag\(\)/g)).toHaveLength(1);
    // Release AND terminate — a gesture the system steals must not leave
    // the guard armed, or swipes stay dead for the rest of the session.
    expect(SRC.match(/endValueDrag\(\)/g)).toHaveLength(2);
  });

  it('the XY offset pad claims it too', () => {
    const SRC = read('components/ShadowBar.tsx');
    expect(SRC.match(/beginValueDrag\(\)/g)).toHaveLength(1);
    expect(SRC.match(/endValueDrag\(\)/g)).toHaveLength(2);
  });

  it('both of the panel swipe handlers stand down for it', () => {
    const SRC = read('components/ObjectPropertiesPanel.tsx');
    // The option-row swap and the submenu carousel/dismiss layer.
    expect(SRC.match(/!isValueDragging\(\)/g)).toHaveLength(2);
  });
});
