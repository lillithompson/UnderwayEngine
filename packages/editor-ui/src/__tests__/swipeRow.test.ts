import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { cancelCrossTouchMoves, CLAIM_SLOP, claims, FLICK_VELOCITY, HORIZONTAL_BIAS, landing, OPEN_FRACTION, rowBleed, swipeAxis } from '../logic/swipeRow';

// A list line dragged left to uncover its actions (lifted from
// CozyJournal's group lines; DrawBots' pen motions delete with it). The
// gesture's decisions here as arithmetic; the row's responder and its
// browser scroll cancel pinned as source text (no renderer).

const SRC = resolve(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');

const W = 84;

describe('claims', () => {
  it('takes a drag left once it is past the slop and sideways enough; leaves a scroll and a tap to the list', () => {
    expect(claims(-(CLAIM_SLOP + 1), 0, 0, W)).toBe(true);
    expect(claims(-CLAIM_SLOP, 0, 0, W)).toBe(false);
    expect(claims(-20, 20 / HORIZONTAL_BIAS + 1, 0, W)).toBe(false);
    expect(claims(-20, 20 / HORIZONTAL_BIAS - 1, 0, W)).toBe(true);
    expect(claims(0, -40, 0, W)).toBe(false);
  });

  it('a drag right matters only to an open row; a row with no actions takes nothing', () => {
    expect(claims(20, 0, 0, W)).toBe(false);
    expect(claims(20, 0, -W, W)).toBe(true);
    expect(claims(-40, 0, 0, 0)).toBe(false);
  });
});

describe('landing', () => {
  it('a flick decides by its way, however short', () => {
    expect(landing(-2, -(FLICK_VELOCITY + 0.1), 0, W)).toBe(-W);
    expect(landing(-60, FLICK_VELOCITY + 0.1, 0, W)).toBe(0);
  });

  it('a tap shuts an open row; otherwise it settles by how far it got', () => {
    expect(landing(2, 0, -W, W)).toBe(0);
    expect(landing(-(W * OPEN_FRACTION + 1), 0, 0, W)).toBe(-W);
    expect(landing(-(W * OPEN_FRACTION - 1), 0, 0, W)).toBe(0);
    expect(landing(-60, 0, 0, 0)).toBe(0);
  });
});

describe('rowBleed', () => {
  it('is the page\'s margin where the buttons are wider than it, and nothing where they are not', () => {
    expect(rowBleed(128, 20)).toBe(20);
    // The line would be left nowhere to travel.
    expect(rowBleed(20, 20)).toBe(0);
    expect(rowBleed(12, 20)).toBe(0);
    // A row with no buttons, and a page that asks for none.
    expect(rowBleed(0, 20)).toBe(0);
    expect(rowBleed(128, 0)).toBe(0);
    expect(rowBleed(128, -8)).toBe(0);
  });

  it('leaves the line a travel that lands its end where the buttons begin', () => {
    // The buttons' block starts a bleed further out than the line's own
    // end (off the page's edge) and slides its whole width; the line
    // slides the rest, so open, the two meet. DrawBots' pen motion
    // cards: two 64 buttons in a page 20 in from the screen's edge.
    const width = 128;
    const side = rowBleed(width, 20);
    const travel = width - side;
    expect(travel).toBe(108);
    // A card [20, 400] of a 420 page, open: its end and the block's
    // start are the same place, and the block ends on the page's edge.
    expect(400 - travel).toBe(420 - width);
    expect(landing(-travel, 0, 0, travel)).toBe(-travel);
    expect(claims(-(CLAIM_SLOP + 1), 0, 0, travel)).toBe(true);
  });
});

describe('swipeAxis', () => {
  it('is the first move\'s way: across a swipe, up or down (or a tie) a scroll, nothing not yet moved', () => {
    expect(swipeAxis(0, 0)).toBeNull();
    expect(swipeAxis(-3, 1)).toBe('x');
    expect(swipeAxis(1, 3)).toBe('y');
    expect(swipeAxis(2, -2)).toBe('y');
  });
});

describe('cancelCrossTouchMoves', () => {
  /** A stand-in element: its listeners by event, and whether each was
   *  passive. */
  const element = () => {
    const on: Record<string, { fn: (e: unknown) => void; passive: boolean }> = {};
    const el = {
      addEventListener: (type: string, fn: (e: unknown) => void, o: { passive: boolean }) => { on[type] = { fn, passive: o.passive }; },
      removeEventListener: (type: string) => { delete on[type]; },
    };
    return { el: el as unknown as HTMLElement, on };
  };
  const touch = (x: number, y: number) => {
    const e = { touches: [{ clientX: x, clientY: y }], cancelable: true, prevented: false, preventDefault() { e.prevented = true; } };
    return e;
  };

  it('cancels every move of a touch whose first move goes across, none of one going up or down, and listens to move un-passive', () => {
    const { el, on } = element();
    const off = cancelCrossTouchMoves(el);
    expect(on.touchmove.passive).toBe(false);
    expect(on.touchstart.passive).toBe(true);
    on.touchstart.fn(touch(100, 100));
    const first = touch(94, 102), later = touch(90, 130);
    on.touchmove.fn(first);
    on.touchmove.fn(later);
    expect([first.prevented, later.prevented]).toEqual([true, true]);
    on.touchstart.fn(touch(100, 100));
    const up = touch(101, 90), across = touch(60, 90);
    on.touchmove.fn(up);
    on.touchmove.fn(across);
    expect([up.prevented, across.prevented]).toEqual([false, false]);
    off();
    expect(on).toEqual({});
  });
});

describe('SwipeRow.tsx', () => {
  const ROW = read('components', 'SwipeRow.tsx');

  it('takes the drag back on the capture pass, refuses to hand it over, and settles a termination on the drag', () => {
    expect(ROW).toContain('onMoveShouldSetPanResponderCapture: (_e, g) => claims(g.dx, g.dy, at.current, travelRef.current),');
    expect(ROW).toContain('onPanResponderTerminationRequest: () => false,');
    expect(ROW).toContain('onPanResponderTerminate: (_e, g) => settle(landing(g.dx, g.vx, at.current, travelRef.current)),');
    expect(ROW).toContain('x.setValue(Math.max(-travelRef.current, Math.min(0, at.current + g.dx)));');
    // One row open at a time.
    expect(ROW).toContain('if (openRow !== null && at.current === 0) openRow();');
  });

  it('in a browser, cancels the moves of a touch whose first move goes across, with a listener that can cancel', () => {
    expect(ROW).toContain('const uncancel = cancelCrossTouchMoves(el);');
    // …and the click a swipe lets go of never reaches the line (a press
    // on react-native-web is a click): set as the row takes the gesture,
    // cleared as the next pointer goes down, both on the capture pass.
    expect(ROW).toContain("el.addEventListener('pointerdown', down, true);");
    expect(ROW).toContain("el.addEventListener('click', click, true);");
    expect(ROW).toMatch(/onPanResponderGrant: \(\) => \{\s*swiped\.current = true;/);
    expect(ROW).toContain('if (!swiped.current) return;');
    expect(ROW).toContain("if (Platform.OS !== 'web' || !el || typeof el.addEventListener !== 'function' || width === 0) return undefined;");
  });

  it('tells its owner the once that the buttons are showing, and rounds the outer edge of the last one as the line is rounded', () => {
    // The claim that starts the swipe says the buttons are out, and the
    // settle says whether they still are: one call either way, never per
    // move (the list is not rebuilt by the gesture).
    expect(ROW).toContain('if (claims(g.dx, g.dy, at.current, travelRef.current)) { grab(true); show(true); }');
    expect(ROW).toContain('show(to !== 0);');
    expect(ROW).toMatch(/const show = useCallback\(\(now: boolean\) => \{\s*if \(out\.current === now\) return;/);
    expect(ROW).toContain('onOpenRef.current?.(now);');
    // The group's outer corners are the caller's radii, on the last
    // button alone — the one at the row's edge.
    expect(ROW).toContain('endCorner && action === actions[actions.length - 1]');
    expect(ROW).toContain('? { borderTopRightRadius: endCorner.top, borderBottomRightRadius: endCorner.bottom }');
  });

  it('reaches over the page\'s margin where it is given one: the clip, the line put back by the padding, and the buttons from the page\'s edge', () => {
    expect(ROW).toContain('const side = rowBleed(width, bleed);');
    expect(ROW).toContain('const travel = width - side;');
    // The row's box over the margin, and the line back inside it.
    expect(ROW).toContain('style={[styles.wrap, SWIPE_ROW_SURFACE, side ? { marginHorizontal: -side } : null]}');
    expect(ROW).toContain('style={[side ? { paddingHorizontal: side } : null, { transform: [{ translateX: x }] }]}');
    // The buttons' block slides its own whole width over the line's
    // travel, so it comes from the page's edge and lands flush; with no
    // bleed it is the line's own value, untouched.
    expect(ROW).toContain('const slide = side === 0 ? x : x.interpolate({ inputRange: [-travel, 0], outputRange: [-width, 0] });');
    expect(ROW).toContain('{ width, right: -width, transform: [{ translateX: slide }] }');
  });

  it('offers icon-only buttons, the label still read out, at a width of the app\'s choosing', () => {
    expect(ROW).toContain('accessibilityLabel={action.label}');
    expect(ROW).toContain('{iconOnly ? null : (');
    expect(ROW).toContain('const width = actions.length * actionWidth;');
    // No app's theme in the engine: the font is the caller's.
    expect(ROW).not.toMatch(/from '\.\/theme'|FONT_BODY/);
  });
});
