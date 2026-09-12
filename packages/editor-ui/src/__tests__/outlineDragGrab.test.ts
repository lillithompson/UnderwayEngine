// Grabbing an outline row to reorder it, on a touch device.
//
// The rows sit inside a ScrollView, so the row's JS PanResponder and the
// list's NATIVE pan recognizer want the same vertical drag. Losing that race
// produced both halves of the same bug report: rows that were "difficult to
// grab" (the list scrolled instead of the row moving) and finished reorders
// that "snap back to the original position" (the steal arrives as
// onPanResponderTerminate, which resets the drag WITHOUT committing it).
//
// SceneOutlinePanel can't be imported here (it pulls in @expo/vector-icons,
// which has no node shim), so the gesture wiring is pinned at the source —
// same approach as outlineFrameAll.test.ts.
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(
  join(__dirname, '..', 'components', 'SceneOutlinePanel.tsx'),
  'utf8',
);

/** The row-drag PanResponder.create({...}) block. */
const responder = /PanResponder\.create\(\{[\s\S]*?\}\),/.exec(SRC)?.[0] ?? '';

describe('a row drag keeps the gesture it started', () => {
  it('never hands the drag back once the handle has it', () => {
    // Without this the ScrollView reclaims the gesture mid-drag and the
    // reorder is silently discarded.
    expect(responder).toContain('onPanResponderTerminationRequest: () => false');
  });

  it('blocks the native scroll recognizer outright', () => {
    expect(responder).toContain('onShouldBlockNativeResponder: () => true');
  });

  it('claims on touch-down for an icon grab, and on a held move for a line grab', () => {
    // One factory, two arms: the icon grabs at once ('touch'), the line
    // waits out a hold ('hold') so a flick still scrolls the list.
    expect(responder).toContain("return arm === 'touch';");
    expect(responder).toContain("onMoveShouldSetPanResponder: (_e, g) => (arm === 'touch' ? true : (");
    expect(responder).toContain('Date.now() - touchDownAtRef.current >= DRAG_HOLD_MS');
    expect(responder).toContain('Math.hypot(g.dx, g.dy) > DRAG_SLOP_PX');
    // The touch's moment is taken whether or not this responder claims —
    // it is what the hold is measured from.
    expect(responder).toContain('touchDownAtRef.current = Date.now();');
  });

  it('measures the drag from the GRANT, so a held grab does not jump', () => {
    // The icon grants at touch-down (zero), but a line grab is granted
    // partway through the gesture: gestureState.dy already holds whatever
    // the finger travelled during the hold.
    expect(responder).toContain('grantRef.current = { dx: g.dx, dy: g.dy };');
    expect(responder).toContain('const dy = g.dy - grantRef.current.dy;');
    expect(responder).toContain('const dx = g.dx - grantRef.current.dx;');
  });

  it('arms the line grab before a rename would fire, and after a flick', () => {
    const hold = /const DRAG_HOLD_MS = (\d+);/.exec(SRC)?.[1];
    expect(hold).toBeDefined();
    // Under the rename's delayLongPress: a drag arms first and terminates
    // the Pressable, so a hold-and-drag never also opens the rename.
    const rename = /delayLongPress=\{(\d+)\}/.exec(SRC)?.[1];
    expect(Number(hold)).toBeLessThan(Number(rename));
    // …and long enough that a quick flick is still the list's to scroll.
    expect(Number(hold)).toBeGreaterThan(0);
  });

  it('holds the list still for the length of the drag', () => {
    expect(SRC).toContain('scrollEnabled={dragRowIndex === null}');
  });

  it('commits on release and resets on a terminate it could not refuse', () => {
    // Release is the only path that calls onReorder / onReparent; terminate
    // must still clean the drag state up rather than leave a stuck row.
    expect(responder).toContain('onPanResponderRelease');
    expect(responder).toContain('onPanResponderTerminate:');
    const terminate = /onPanResponderTerminate: \(\) => \{[\s\S]*?\},/.exec(responder)?.[0] ?? '';
    expect(terminate).toContain('setDragRowIndex(null)');
    expect(terminate).not.toContain('onReorder');
  });
});

describe('the kind icon is the drag handle', () => {
  it('carries the responder, and a hit area wider than the glyph', () => {
    const handle = /<View\s+style=\{styles\.dragHandle\}[\s\S]*?\/>\s*<\/View>/.exec(SRC)?.[0] ?? '';
    expect(handle).toContain('hitSlop={DRAG_HANDLE_HIT_SLOP}');
    expect(handle).toContain("{...getResponder(index, 'touch').panHandlers}");
    // The glyph itself is what the finger aims at.
    expect(handle).toContain('MaterialCommunityIcons');
  });

  it('reaches past the glyph horizontally, without moving the row', () => {
    // Vertical slop would overlap the neighbouring rows' handles; the row is
    // already full-height, so only the sides need opening up.
    const slop = /const DRAG_HANDLE_HIT_SLOP = \{[^}]*\}/.exec(SRC)?.[0] ?? '';
    expect(slop).toMatch(/left: \d+/);
    expect(slop).toMatch(/right: \d+/);
    expect(slop).toContain('top: 0');
    expect(slop).toContain('bottom: 0');
  });
});

// The icon used to be the only grab: a reorder meant finding an 18pt glyph.
describe('the whole line grabs', () => {
  it('the row carries the held responder, over its own children', () => {
    const row = SRC.slice(SRC.indexOf('<Animated.View\n                    key={row.id}'), SRC.indexOf('styles.row,'));
    expect(row).toContain("{...getResponder(index, 'hold').panHandlers}");
  });

  it('a row and its icon are separate responders, cached apart', () => {
    expect(SRC).toContain('const key = `${index}:${arm}`;');
    expect(SRC).toContain('cache.set(key, createDragResponder(index, arm));');
    // Keyed by string now, not by index alone — two arms per row.
    expect(SRC).toContain('useRef<Map<string, ReturnType<typeof PanResponder.create>>>');
  });
});
