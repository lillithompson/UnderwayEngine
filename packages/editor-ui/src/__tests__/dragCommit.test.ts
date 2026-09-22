import { readFileSync } from 'fs';
import { resolve } from 'path';

// What a drag control commits when the finger lifts.
//
// Two bugs, one on each side of the same line.
//
// The first: releasing the Size slider (or the drop shadow's offset handle)
// sometimes wrote back the value from BEFORE the drag. Both controls fell
// back to the `value` prop when the release event's `locationX` was
// un-locatable on react-native-web, and the prop trails the drag by a React
// batch. So the gesture remembers the value it reached, and that is what an
// un-locatable event holds and what a TERMINATE commits.
//
// The second: committing ONLY that remembered value lost the end of every
// quick drag on a phone. Each live onChange re-renders the editor, WebKit
// coalesces the touchmoves behind the render, and the touchend — the one
// event that carries where the finger actually lifted — was ignored. A flick
// committed the grant point, and the thumb snapped back to where it began.
// So the RELEASE reads its own position, through the same guard that holds
// the gesture's value when the position is NaN.
//
// There is no test renderer for these components, so it is pinned as
// source, the way the other panel suites do it.

const read = (file: string) =>
  readFileSync(resolve(__dirname, '..', 'components', file), 'utf8');

const CONTROLS = [
  { file: 'Slider.tsx', name: 'the slider' },
  { file: 'EffectsBar.tsx', name: 'the shadow offset pad' },
  { file: 'BrushControlsPanel.tsx', name: 'the brush slider' },
];

describe.each(CONTROLS)('$name', ({ file }) => {
  const SRC = read(file);
  /** One handler's body: from its key to the next handler (or the end of the
   *  PanResponder block), so a multi-line handler is read whole. */
  const handler = (name: string) => {
    const i = SRC.indexOf(`onPanResponder${name}:`);
    expect([name, i >= 0]).toEqual([name, true]);
    const next = SRC.indexOf('onPanResponder', i + 1);
    return SRC.slice(i, next >= 0 ? next : SRC.indexOf('}),', i));
  };

  test('the release commits where the finger lifted, read off the release event', () => {
    // Through `track`, whose non-finite guard holds the gesture's value when
    // the event cannot be located — never the `value` prop.
    // The pad's track takes the event whole; the sliders take its locationX.
    expect(handler('Release')).toMatch(/track\((e|e\.nativeEvent\.locationX)\)/);
    expect(handler('Release')).not.toMatch(/onCommit\(dragRef\.current\)|cbRef\.current\(dragRef\.current\)/);
  });

  test('a terminate commits the value the gesture reached, not one read off the event', () => {
    // A cancelled touch has no lift point worth reading.
    expect(handler('Terminate')).toContain('dragRef.current');
    expect(handler('Terminate')).not.toContain('e.nativeEvent');
  });

  test('tracks that value on every grant and move', () => {
    // The brush slider's grant only picks the handle up (takeHold) — the
    // value stays put until the finger travels — but it is located the same
    // way.
    expect(handler('Grant')).toMatch(/track\(|takeHold\(/);
    expect(handler('Move')).toContain('track(');
  });

  test('follows the prop only while no gesture is running', () => {
    // Otherwise the drag's own value would be overwritten mid-gesture by the
    // stale prop it is racing.
    expect(SRC).toContain('if (!draggingRef.current) dragRef.current =');
    expect(SRC).toContain('draggingRef.current = true;');
    expect(SRC).toContain('draggingRef.current = false;');
  });
});
