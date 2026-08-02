import { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder } from 'react-native';
import { swipeDismissDirection } from '../logic/imageEdit';
import { PANEL_ANIM_MS } from '../theme';

// Shared slide-in / swipe-out chrome for the bottom-anchored image-effect
// bars (Drop Shadow, Border). Each opens by sliding in from the right edge
// and can be flung sideways (either way) past the threshold to dismiss;
// short drags spring back. The pad / sliders inside a bar claim their own
// touches, so the swipe only fires on the bar's inert areas (header, labels,
// padding). Returns `mounted` (kept true through the slide-out so the bar
// animates off before unmounting), the animated translateX, the pan handlers
// to spread onto the bar wrapper, and `closeTo(dir)` to close toward a chosen
// edge (the back chevron uses −1 to reverse the usual retract).
export function useSlideSwipeBar(open: boolean, width: number, onRequestClose: () => void) {
  const [mounted, setMounted] = useState(false);
  const x = useRef(new Animated.Value(0)).current;
  // Which edge the bar leaves by on close (a swipe overrides the default).
  const exitDir = useRef<1 | -1>(1);

  useEffect(() => {
    if (open) {
      setMounted(true);
      exitDir.current = 1;
      x.setValue(width); // enter from the right edge
      const anim = Animated.timing(x, { toValue: 0, duration: PANEL_ANIM_MS, useNativeDriver: true });
      anim.start();
      return () => anim.stop();
    }
    const anim = Animated.timing(x, {
      toValue: exitDir.current * width,
      duration: PANEL_ANIM_MS,
      useNativeDriver: true,
    });
    anim.start(({ finished }) => { if (finished) setMounted(false); });
    return () => anim.stop();
  }, [open, x, width]);

  // Latest close runner, so the once-created PanResponder always resolves by
  // the current window width and callback.
  const releaseRef = useRef<(dx: number) => void>(() => {});
  releaseRef.current = (dx) => {
    const dir = swipeDismissDirection(dx);
    if (dir !== 0) { exitDir.current = dir; onRequestClose(); }
    else Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
  };

  // Close programmatically toward a chosen edge (−1 = left, +1 = right),
  // overriding the default exit direction. The back chevron uses this to slide
  // the bar off the opposite edge from the usual retract.
  const closeToRef = useRef<(dir: 1 | -1) => void>(() => {});
  closeToRef.current = (dir) => { exitDir.current = dir; onRequestClose(); };
  const closeTo = useRef((dir: 1 | -1) => closeToRef.current(dir)).current;

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_e, g) => x.setValue(g.dx),
      onPanResponderRelease: (_e, g) => releaseRef.current(g.dx),
      onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start(),
    }),
  ).current;

  return { mounted, translateX: x, panHandlers: pan.panHandlers, closeTo };
}
