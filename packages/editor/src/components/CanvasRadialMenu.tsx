import React, { useRef, useEffect, useMemo, useCallback, useState, useImperativeHandle, forwardRef } from 'react';
import { View, StyleSheet, Animated, Image, Platform } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { TEXT_PRIMARY, BG_DARK, ACCENT_CYAN } from '@/engine/colors';
import {
  BTN_SIZE,
  HOVER_SCALE,
  RADIAL_BASE_ANGLE,
  RADIAL_DIMMED_OPACITY,
  RADIAL_SCRIM_COLOR,
  RADIAL_SUBMENU_SPREAD,
  RADIAL_SIBLING_DWELL_MS,
  RadialAction,
  RadialBounds,
  getRadialCenters,
  getRadialOffsets,
  hasDepartedRootArc,
  hitTestRadial,
  hitTestRadialWithSubmenu,
  radialSiblingsAdjacent,
  siblingStealsInstantly,
  radialDistanceFor,
  radialSpreadFor,
  radialFanLayout,
  RADIAL_MENU_Z,
} from '../radialMenu';

// The long-press radial quick-action menu, ported from Facet's
// CanvasRadialMenu. A fan of circular buttons blooms around the press
// point; the still-held finger drags over one (the canvas routes its
// moves through `updateDrag`) and the release (`releaseDrag`) activates
// the hovered action. The overlay itself is pointer-inert — the canvas
// owns the touch for the menu's whole life. A press near an edge would
// fan its buttons off-screen, so the whole fan rotates about the press
// point — and, on a viewport too narrow for the half-circle spread at
// full reach, draws itself in toward the thumb — until every button fits
// inside `bounds` (radialFanLayout). The fan reaches far
// enough to overlap the edge-hugging capsule columns, so the overlay
// paints above them (RADIAL_MENU_Z) — it stays pointer-inert, so those
// buttons keep taking their own taps once the menu closes.

export interface CanvasRadialMenuRef {
  updateDrag: (screenX: number, screenY: number) => void;
  releaseDrag: () => void;
}

interface CanvasRadialMenuProps {
  visible: boolean;
  screenX: number;
  screenY: number;
  isLocked: boolean;
  actions: RadialAction[];
  actionCallbacks: (() => void)[];
  /** Index into `actions` whose icon toggles between `icon` and
   *  `activeIcon` based on `isLocked`. Omit if no lock toggle needed. */
  lockActionIndex?: number;
  /** Area the fan must stay inside — the canvas viewport. Omit to keep
   *  the fan pointing straight up regardless of the edges. */
  bounds?: RadialBounds | null;
  /** Angular width of the fan. Omit for the long-press half circle. A
   *  PINNED fan (the lower-right SliderModeTarget passes
   *  RADIAL_QUARTER_SPREAD) skips the auto-rotating layout entirely — its
   *  origin is a fixed widget in a known corner, so the arc must hold its
   *  quadrant rather than swing wherever the fitter finds room. */
  spread?: number;
  /** Stacking layer override. The default RADIAL_MENU_Z (150) sits under
   *  the floating slider rows (205); a fan opened FROM one passes a higher
   *  layer so its buttons paint over the row they stand beside. */
  menuZ?: number;
  /** Dim everything behind the fan while it is open: a full-screen
   *  {@link RADIAL_SCRIM_COLOR} wash under the buttons, riding the menu's
   *  own opacity — it fades in as the fan blooms and out as it closes, so
   *  the options are the one bright thing on a crowded screen. The
   *  slider-mode target passes it (its fan opens over the slider rows and
   *  capsule columns of the lower-right corner); the canvas long-press
   *  menus, whose press point is on the drawing being edited, leave it
   *  off. The scrim stays pointer-inert like the rest of the overlay. */
  scrim?: boolean;
  /** Second-level fans, parallel to `actions`: entry i is action i's
   *  children (undefined = a plain leaf, exactly as before). The moment a
   *  multi-level action is hovered its children bloom from that button's
   *  own center, laid out by the QUICK-ACTION rules regardless of the
   *  root's pin — long-press spacing, up-left default, fitted to `bounds`;
   *  release over a child fires its callback, release anywhere else while
   *  the parent stays inverted fires the parent's. */
  childActions?: (RadialAction[] | undefined)[];
  /** Parallel to childActions: childCallbacks[i]?.[j] fires on release
   *  over child j of action i. */
  childCallbacks?: ((() => void)[] | undefined)[];
  onClose: () => void;
}

export default forwardRef<CanvasRadialMenuRef, CanvasRadialMenuProps>(function CanvasRadialMenu(
  {
    visible,
    screenX,
    screenY,
    isLocked,
    actions,
    actionCallbacks,
    lockActionIndex,
    bounds,
    spread,
    menuZ,
    scrim,
    childActions,
    childCallbacks,
    onClose,
  },
  ref,
) {
  const radialScale = useRef(new Animated.Value(0)).current;
  const radialOpacity = useRef(new Animated.Value(0)).current;
  // One hover scale per button. Rebuilt (keeping the values it already has)
  // whenever the action set changes size — the menu is mounted for the
  // editor's whole life and its button count follows the selection, so a
  // once-at-mount array would leave the extra button without one.
  const hoverScalesRef = useRef<Animated.Value[]>([]);
  if (hoverScalesRef.current.length !== actions.length) {
    hoverScalesRef.current = actions.map(
      (_, i) => hoverScalesRef.current[i] ?? new Animated.Value(1),
    );
  }
  const hoverScales = hoverScalesRef.current;

  const [hoveredRadial, setHoveredRadial] = useState(-1);
  const hoveredIndexRef = useRef(-1);
  const actionsRef = useRef(actionCallbacks);
  actionsRef.current = actionCallbacks;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const childActionsRef = useRef(childActions);
  childActionsRef.current = childActions;
  const childCallbacksRef = useRef(childCallbacks);
  childCallbacksRef.current = childCallbacks;

  // ── The second-level fan ──────────────────────────────────────────
  // Which root button's children are blooming (null = none), the children's
  // absolute centers for the hit test, and the hovered child. The parent
  // keeps its root hover (and its invert) for the submenu's whole life —
  // it is the origin the children emit from, and the thing a release
  // without a child still selects.
  const [submenuParent, setSubmenuParent] = useState<number | null>(null);
  const submenuParentRef = useRef<number | null>(null);
  const subCentersRef = useRef<{ x: number; y: number }[]>([]);
  const [hoveredChild, setHoveredChild] = useState(-1);
  const childHoverRef = useRef(-1);
  const subScale = useRef(new Animated.Value(0)).current;
  const subOpacity = useRef(new Animated.Value(0)).current;
  const childHoverScalesRef = useRef<Animated.Value[]>([]);
  // One fade per ROOT button: while a second level is open, every root but
  // the parent dims to RADIAL_DIMMED_OPACITY so the bloomed children read
  // as the menu now. Same keep-what-exists rebuild as the hover scales.
  const rootFadesRef = useRef<Animated.Value[]>([]);
  if (rootFadesRef.current.length !== actions.length) {
    rootFadesRef.current = actions.map(
      (_, i) => rootFadesRef.current[i] ?? new Animated.Value(1),
    );
  }
  const rootFades = rootFadesRef.current;

  // ── Guards against accidental fan swaps (see radialMenu.ts) ───────
  // PINNED: the finger has engaged level two (hovered a child, or left the
  // root arc for child territory), so sibling roots no longer steal on
  // contact — coming home to the parent's disc unpins. The DWELL pair
  // tracks a guarded sibling being parked on: which one, and the timer
  // that fires the swap once RADIAL_SIBLING_DWELL_MS elapses under a
  // still finger (a pointer holding still sends no more move events, so
  // the swap can't wait for one).
  const subPinnedRef = useRef(false);
  const dwellIndexRef = useRef(-1);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // How the fan hangs: which way it points and how far out it reaches, so
  // a press near an edge still keeps every button on screen. Pure in its
  // inputs, so the render below and the hit-test centers agree without
  // extra state.
  // A pinned fan narrows for a PAIR (radialSpreadFor): two buttons over the
  // whole quarter sit at its ends with a hole between them. Each level
  // narrows by its OWN count, so a two-child submenu tightens under a
  // four-option root — `spread` stays the raw ask, `rootSpread` the resolved
  // one for this level.
  const rootSpread = radialSpreadFor(actions.length, spread);
  const { baseAngle, distance } = useMemo(
    () => (visible && spread === undefined
      ? radialFanLayout(screenX, screenY, actions.length, bounds)
      : { baseAngle: RADIAL_BASE_ANGLE, distance: radialDistanceFor(actions.length, rootSpread) }),
    [visible, screenX, screenY, actions.length, bounds, spread, rootSpread],
  );

  // Precompute radial button centers (absolute screen positions)
  const radialCentersRef = useRef<{ x: number; y: number }[]>([]);
  // The bounds, for the imperative handle's submenu fit (refs so the
  // memoized handle always reads the latest).
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  // The menu origin and the root arc's radius, for the departed-the-arc
  // pin (refs for the same reason as boundsRef).
  const originRef = useRef({ x: screenX, y: screenY });
  originRef.current = { x: screenX, y: screenY };
  const rootDistanceRef = useRef(distance);
  rootDistanceRef.current = distance;
  // The SECOND level's own fit, written by openSubmenu and read by the
  // render below, so the drawn buttons and the hit-test centers can never
  // disagree. A submenu is laid out by the quick-action rules — the
  // up-left default angle, rotated (and pulled in) by radialFanLayout
  // until every child clears the screen edges — but over the NARROWER
  // submenu sweep (RADIAL_SUBMENU_SPREAD, a pair narrowing to half of it):
  // at the long-press half circle, a four-child fan's end buttons sat
  // right over the root's neighbouring buttons, and the slide out to the
  // last child crossed a sibling and swapped fans instead of selecting.
  // The corner pin that anchors a root to its quadrant says nothing about
  // the children: they bloom from a button that can sit anywhere on
  // screen.
  const subLayoutRef = useRef({
    baseAngle: RADIAL_BASE_ANGLE,
    distance: radialDistanceFor(0),
    spread: RADIAL_SUBMENU_SPREAD as number | undefined,
  });

  /** Stop a pending sibling dwell: kill its timer and, while a submenu is
   *  still open, sink the charging sibling back to the dimmed opacity it
   *  brightened from. Idempotent — safe to call with nothing pending. */
  const cancelSiblingDwell = useCallback(() => {
    if (dwellTimerRef.current !== null) {
      clearTimeout(dwellTimerRef.current);
      dwellTimerRef.current = null;
    }
    const i = dwellIndexRef.current;
    dwellIndexRef.current = -1;
    if (i >= 0 && submenuParentRef.current !== null && rootFades[i]) {
      Animated.timing(rootFades[i], {
        toValue: RADIAL_DIMMED_OPACITY, duration: 150, useNativeDriver: Platform.OS !== 'web',
      }).start();
    }
  }, [rootFades]);

  const closeSubmenu = useCallback(() => {
    submenuParentRef.current = null;
    setSubmenuParent(null);
    subPinnedRef.current = false;
    cancelSiblingDwell();
    subCentersRef.current = [];
    childHoverRef.current = -1;
    setHoveredChild(-1);
    subScale.setValue(0);
    subOpacity.setValue(0);
    // The dimmed siblings fade back up (openSubmenu re-dims them at once
    // when the close was a slide onto a sibling — its animation supersedes
    // this one).
    rootFades.forEach((f) => {
      Animated.timing(f, {
        toValue: 1, duration: 150, useNativeDriver: Platform.OS !== 'web',
      }).start();
    });
  }, [subScale, subOpacity, rootFades, cancelSiblingDwell]);

  useEffect(() => {
    if (visible) {
      radialCentersRef.current = getRadialCenters(
        screenX, screenY, actions.length, baseAngle, distance, rootSpread,
      );
      hoveredIndexRef.current = -1;
      setHoveredRadial(-1);
      closeSubmenu();
      rootFades.forEach((f) => f.setValue(1)); // a fresh open starts undimmed
      radialScale.setValue(0);
      radialOpacity.setValue(0);
      hoverScales.forEach((s) => s.setValue(1));
      Animated.parallel([
        Animated.timing(radialScale, { toValue: 1, duration: 150, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(radialOpacity, { toValue: 1, duration: 150, useNativeDriver: Platform.OS !== 'web' }),
      ]).start();
    }
  }, [visible, screenX, screenY, baseAngle, distance, rootSpread, radialScale, radialOpacity, hoverScales, rootFades, actions.length, closeSubmenu]);

  const animateClose = useCallback(
    (callback?: () => void) => {
      Animated.parallel([
        Animated.timing(radialScale, { toValue: 0, duration: 100, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(radialOpacity, { toValue: 0, duration: 100, useNativeDriver: Platform.OS !== 'web' }),
      ]).start(() => {
        callback?.();
        onCloseRef.current();
      });
    },
    [radialScale, radialOpacity],
  );

  useImperativeHandle(ref, () => {
    /** Move the root hover (the existing grow/shrink animation pair). */
    const hoverRoot = (idx: number) => {
      if (idx === hoveredIndexRef.current) return;
      // Animate out previous
      if (hoveredIndexRef.current >= 0) {
        Animated.timing(hoverScales[hoveredIndexRef.current], {
          toValue: 1,
          duration: 80,
          useNativeDriver: Platform.OS !== 'web',
        }).start();
      }
      // Animate in new
      if (idx >= 0) {
        Animated.timing(hoverScales[idx], {
          toValue: HOVER_SCALE,
          duration: 80,
          useNativeDriver: Platform.OS !== 'web',
        }).start();
      }
      hoveredIndexRef.current = idx;
      setHoveredRadial(idx);
    };

    const hoverChild = (idx: number) => {
      if (idx === childHoverRef.current) return;
      const scales = childHoverScalesRef.current;
      if (childHoverRef.current >= 0 && scales[childHoverRef.current]) {
        Animated.timing(scales[childHoverRef.current], {
          toValue: 1, duration: 80, useNativeDriver: Platform.OS !== 'web',
        }).start();
      }
      if (idx >= 0 && scales[idx]) {
        Animated.timing(scales[idx], {
          toValue: HOVER_SCALE, duration: 80, useNativeDriver: Platform.OS !== 'web',
        }).start();
      }
      childHoverRef.current = idx;
      setHoveredChild(idx);
    };

    /** Bloom action `idx`'s children from that button's own center, laid
     *  out by the quick-action rules (see subLayoutRef): the up-left
     *  default angle fitted to `bounds`, over the narrower SUBMENU sweep
     *  so the slide to an end child can't cross the root's siblings. */
    const openSubmenu = (idx: number) => {
      const kids = childActionsRef.current?.[idx];
      const parent = radialCentersRef.current[idx];
      if (!kids || kids.length === 0 || !parent) return;
      submenuParentRef.current = idx;
      setSubmenuParent(idx);
      subPinnedRef.current = false; // a fresh fan starts unpinned
      const subSpread = radialSpreadFor(kids.length, RADIAL_SUBMENU_SPREAD);
      const fit = radialFanLayout(parent.x, parent.y, kids.length, boundsRef.current, subSpread);
      subLayoutRef.current = { ...fit, spread: subSpread };
      subCentersRef.current = getRadialCenters(
        parent.x, parent.y, kids.length, fit.baseAngle, fit.distance, subSpread,
      );
      childHoverScalesRef.current = kids.map(() => new Animated.Value(1));
      childHoverRef.current = -1;
      setHoveredChild(-1);
      // Every root but the parent fades down — the children are the menu
      // now; the dimmed siblings stay live targets to slide onto.
      rootFades.forEach((f, i) => {
        Animated.timing(f, {
          toValue: i === idx ? 1 : RADIAL_DIMMED_OPACITY,
          duration: 150,
          useNativeDriver: Platform.OS !== 'web',
        }).start();
      });
      subScale.setValue(0);
      subOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(subScale, { toValue: 1, duration: 150, useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(subOpacity, { toValue: 1, duration: 150, useNativeDriver: Platform.OS !== 'web' }),
      ]).start();
    };

    /** A sibling root takes the fan: abandon this submenu for that option
     *  (whose own children, if any, bloom in its place at once). Any
     *  OTHER sibling's charging dwell dies with the old fan — its timer
     *  must not fire a second steal into the new one. */
    const stealRoot = (idx: number) => {
      cancelSiblingDwell();
      closeSubmenu();
      hoverRoot(idx);
      openSubmenu(idx);
    };

    return {
      updateDrag(dragX: number, dragY: number) {
        const parent = submenuParentRef.current;
        if (parent !== null) {
          // Beyond the root arc is child territory: pin the fan (a sibling
          // must now be dwelt on to steal it — see radialMenu.ts).
          if (!subPinnedRef.current && hasDepartedRootArc(
            dragX, dragY, originRef.current.x, originRef.current.y, rootDistanceRef.current,
          )) {
            subPinnedRef.current = true;
          }
          const hit = hitTestRadialWithSubmenu(
            dragX, dragY, radialCentersRef.current, subCentersRef.current, parent,
          );
          if (hit.kind === 'child') {
            // Navigating the second level pins the fan for good measure —
            // the arcs between children graze the sibling discs.
            cancelSiblingDwell();
            subPinnedRef.current = true;
            hoverChild(hit.index);
            return;
          }
          if (hit.kind === 'parent') {
            // Home on the parent's own disc: the finger is back at level
            // one deliberately, so the fan unpins and siblings are again
            // one slide away.
            cancelSiblingDwell();
            subPinnedRef.current = false;
            hoverChild(-1);
            return;
          }
          if (hit.kind === 'root') {
            if (siblingStealsInstantly(parent, hit.index, subPinnedRef.current)) {
              stealRoot(hit.index);
            } else if (!radialSiblingsAdjacent(parent, hit.index)) {
              // A NON-adjacent sibling never takes the fan — no instant
              // steal, no dwell. The finger crossing it is treated exactly
              // like the gap: the submenu holds, nothing charges. Reaching
              // that option means hopping the neighbours or coming home to
              // the parent first (the special guard the dwell alone wasn't).
              cancelSiblingDwell();
              hoverChild(-1);
            } else if (dwellIndexRef.current !== hit.index) {
              // A guarded sibling: it charges up under the parked finger —
              // brightening out of the dim over the dwell — and takes the
              // fan when the timer lands. Moving off cancels and re-dims.
              cancelSiblingDwell();
              dwellIndexRef.current = hit.index;
              if (rootFades[hit.index]) {
                Animated.timing(rootFades[hit.index], {
                  toValue: 1, duration: RADIAL_SIBLING_DWELL_MS, useNativeDriver: Platform.OS !== 'web',
                }).start();
              }
              const steal = hit.index;
              dwellTimerRef.current = setTimeout(() => {
                dwellTimerRef.current = null;
                dwellIndexRef.current = -1;
                // The menu may have closed under the timer (release wins).
                if (submenuParentRef.current !== null) stealRoot(steal);
              }, RADIAL_SIBLING_DWELL_MS);
              hoverChild(-1);
            }
            return;
          }
          // The gap on the way to a child: the submenu stays, nothing is
          // child-hovered, and any charging sibling stands down.
          cancelSiblingDwell();
          hoverChild(-1);
          return;
        }
        const idx = hitTestRadial(dragX, dragY, radialCentersRef.current);
        if (idx !== hoveredIndexRef.current) {
          hoverRoot(idx);
          // A multi-level option blooms its children the moment it is
          // hovered (openSubmenu no-ops for a leaf).
          if (idx >= 0) openSubmenu(idx);
        }
      },
      releaseDrag() {
        const parent = submenuParentRef.current;
        const child = childHoverRef.current;
        // Release OVER a sibling mid-dwell fires that sibling at once — the
        // guards slow the fan swap, never the menu's release-over-a-button
        // contract. The timer itself dies with the release.
        const dwell = dwellIndexRef.current;
        cancelSiblingDwell();
        const idx = dwell >= 0 ? dwell : hoveredIndexRef.current;
        hoverScales.forEach((s) => s.setValue(1));
        childHoverScalesRef.current.forEach((s) => s.setValue(1));
        if (parent !== null && child >= 0) {
          // Release over a child: its callback. The whole tree closes with
          // the same animation a leaf pick gets.
          animateClose(childCallbacksRef.current?.[parent]?.[child]);
        } else if (idx >= 0) {
          animateClose(actionsRef.current[idx]);
        } else {
          animateClose();
        }
      },
    };
  }, [hoverScales, rootFades, animateClose, closeSubmenu, cancelSiblingDwell, subScale, subOpacity]);

  if (!visible) return null;

  const offsets = getRadialOffsets(actions.length, baseAngle, distance, rootSpread);

  return (
    <View style={[styles.overlay, { pointerEvents: 'none' }, menuZ !== undefined ? { zIndex: menuZ } : null]}>
      {/* The scrim: a full-screen wash UNDER the fan (the buttons render
          after it, so they stay bright). It shares radialOpacity, so the
          open's 150ms fade brings it in with the buttons and animateClose's
          100ms takes it out with them — no animation of its own to fall out
          of step. One flat layer, opacity-only: a single composited quad,
          nothing per-frame beyond the fade already running. */}
      {scrim ? (
        <Animated.View
          style={[styles.scrim, { opacity: radialOpacity, pointerEvents: 'none' }]}
        />
      ) : null}
      <Animated.View
        style={[
          styles.radialContainer,
          {
            left: screenX,
            top: screenY,
            opacity: radialOpacity,
            transform: [{ scale: radialScale }],
            pointerEvents: 'none',
          },
        ]}
      >
        {offsets.map((off, i) => {
          const action = actions[i];
          const isHovered = hoveredRadial === i;
          const iconName = action.activeIcon && isLocked && i === lockActionIndex
            ? action.activeIcon
            : action.icon;

          return (
            <Animated.View
              key={i}
              style={[
                styles.radialBtn,
                isHovered && styles.radialBtnHovered,
                {
                  position: 'absolute',
                  left: off.x - BTN_SIZE / 2,
                  top: off.y - BTN_SIZE / 2,
                  opacity: rootFades[i],
                  transform: [{ scale: hoverScales[i] }],
                },
              ]}
            >
              {action.uri ? (
                // An image button: the tile's own art in the glyph's place,
                // re-inked (hoverUri) under the hover invert and turned to
                // its pose (rotate).
                <Image
                  source={{ uri: isHovered && action.hoverUri ? action.hoverUri : action.uri }}
                  style={{
                    width: 24, height: 24,
                    ...(action.rotate ? { transform: [{ rotate: `${action.rotate}deg` }] } : null),
                  }}
                />
              ) : (
                <MaterialCommunityIcons
                  name={iconName as any}
                  size={20}
                  color={isHovered ? BG_DARK : action.getColor(isLocked)}
                />
              )}
            </Animated.View>
          );
        })}
        {/* The second-level fan: hovering this root button bloomed its
            children from its own center, laid out by the quick-action rules
            (openSubmenu's fit — half-circle spacing, up-left default angle,
            fitted inside bounds). Same chrome, same hover invert; the
            parent keeps its invert underneath as the origin. */}
        {submenuParent !== null && childActions?.[submenuParent] ? (
          <Animated.View
            style={[
              styles.radialContainer,
              {
                left: offsets[submenuParent].x,
                top: offsets[submenuParent].y,
                opacity: subOpacity,
                transform: [{ scale: subScale }],
                pointerEvents: 'none',
              },
            ]}
          >
            {getRadialOffsets(
              childActions[submenuParent]!.length,
              subLayoutRef.current.baseAngle, subLayoutRef.current.distance,
              subLayoutRef.current.spread,
            ).map((off, j) => {
              const child = childActions[submenuParent]![j];
              const isChildHovered = hoveredChild === j;
              return (
                <Animated.View
                  key={j}
                  style={[
                    styles.radialBtn,
                    isChildHovered && styles.radialBtnHovered,
                    {
                      position: 'absolute',
                      left: off.x - BTN_SIZE / 2,
                      top: off.y - BTN_SIZE / 2,
                      transform: [{ scale: childHoverScalesRef.current[j] ?? 1 }],
                    },
                  ]}
                >
                  {child.uri ? (
                    // Image children (the tile Choose fan) — same treatment
                    // as an image root button.
                    <Image
                      source={{ uri: isChildHovered && child.hoverUri ? child.hoverUri : child.uri }}
                      style={{
                        width: 24, height: 24,
                        ...(child.rotate ? { transform: [{ rotate: `${child.rotate}deg` }] } : null),
                      }}
                    />
                  ) : (
                    <MaterialCommunityIcons
                      name={child.icon as any}
                      size={20}
                      // A swatch's color IS the content — the hover invert
                      // lightens the button under it but never repaints it.
                      color={isChildHovered && !child.swatch ? BG_DARK : child.getColor(isLocked)}
                    />
                  )}
                </Animated.View>
              );
            })}
          </Animated.View>
        ) : null}
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: RADIAL_MENU_Z,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: RADIAL_SCRIM_COLOR,
  },
  radialContainer: {
    position: 'absolute',
    width: 0,
    height: 0,
    overflow: 'visible',
  },
  radialBtn: {
    width: BTN_SIZE,
    height: BTN_SIZE,
    borderRadius: BTN_SIZE / 2,
    backgroundColor: BG_DARK,
    borderWidth: 1,
    borderColor: ACCENT_CYAN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radialBtnHovered: {
    backgroundColor: TEXT_PRIMARY,
  },
});
