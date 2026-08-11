import { readFileSync } from 'fs';
import { resolve } from 'path';

// What a drag control commits when the finger lifts.
//
// The bug: releasing the Size slider (or the drop shadow's offset handle)
// sometimes wrote back the value from BEFORE the drag. Both controls rebuilt
// the value from the release event, whose `locationX` is sometimes
// un-locatable on react-native-web — and the fallback for that was the `value`
// prop, which trails the drag by a React batch because the live onChange and
// the lift land in the same one.
//
// The fix is the same in both: the gesture remembers the value it reached, and
// the release commits that. There is no test renderer for these components, so
// it is pinned as source, the way the other panel suites do it.

const read = (file: string) =>
  readFileSync(resolve(__dirname, '..', 'components', file), 'utf8');

const CONTROLS = [
  { file: 'Slider.tsx', name: 'the slider' },
  { file: 'ShadowBar.tsx', name: 'the shadow offset pad' },
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

  test('commits the value the gesture reached, not one read off the release', () => {
    for (const end of ['Release', 'Terminate']) {
      expect(handler(end)).toContain('dragRef.current');
      // The release event's coordinates are exactly what could not be trusted.
      expect(handler(end)).not.toContain('e.nativeEvent');
    }
  });

  test('tracks that value on every grant and move', () => {
    expect(handler('Grant')).toContain('track(');
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
