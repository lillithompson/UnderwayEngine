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

  it('still claims the gesture on touch-down and on the first move', () => {
    expect(responder).toContain('onStartShouldSetPanResponder: () => true');
    expect(responder).toContain('onMoveShouldSetPanResponder: () => true');
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
    expect(handle).toContain('{...getResponder(index).panHandlers}');
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
