import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { SceneOutlineModel } from '../adapter';
import { computeOutlineTree, flattenTree, reparentToSceneOrder, FlatOutlineRow } from '../logic/outlineTree';
import { computeDropTarget } from '../logic/dragReorder';
import {
  DOUBLE_TAP_MS,
  OUTLINE_BG,
  OUTLINE_BORDER,
  OUTLINE_CHEVRON_COLLAPSED,
  OUTLINE_CHEVRON_EXPANDED,
  OUTLINE_CLOSE,
  OUTLINE_HAIRLINE,
  OUTLINE_ICON,
  OUTLINE_ICON_ACTIVE,
  OUTLINE_INDENT,
  OUTLINE_ROW_DRAGGING,
  OUTLINE_ROW_SELECTED,
  OUTLINE_TAB_ACTIVE,
  OUTLINE_TAB_TEXT_ACTIVE,
  OUTLINE_TEXT,
  OUTLINE_TEXT_DIM,
  OUTLINE_TEXT_SELECTED,
  PANEL_ANIM_MS,
  PANEL_WIDTH,
  ROW_HEIGHT,
  defaultIconForKind,
} from '../theme';
import { RenameModal } from './RenameModal';

// The SceneOutlinePanel: a left slide-in Figma-style TREE of scene objects in
// front→back (top→bottom) order. Containers (groups/frames) are their own rows
// with their contents shown indented below; a chevron expands/collapses each
// container (expanded by default). Rows drag to reorder AND reparent (drag
// right to nest into the group above, left to outdent); the change commits only
// on release (90 fps drag contract). Long-press renames, double-tap frames,
// with per-row lock/hide toggles. Everything is wired through the
// SceneOutlineModel adapter (no engine dependency).

type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
const icon = (glyph: string) => glyph as MCIName;

/** Slop around the row's kind icon. Grabbing it starts a reorder AT ONCE
 *  (no hold — see the row's own grab below); the icon is icon-sized by
 *  design but a thumb is not, so its area reaches past the glyph without
 *  moving anything. */
const DRAG_HANDLE_HIT_SLOP = { top: 0, bottom: 0, left: 10, right: 10 } as const;

// ── Grabbing a row anywhere along its line ──────────────────────────
//
// The kind icon used to be the ONLY grab: a reorder meant finding a 18pt
// glyph. Now the whole line grabs — but it cannot grab the way the icon
// does, on touch-down, because the rows live in a ScrollView and a row that
// took every touch on sight would leave the list with nothing to scroll by.
//
// So the line arms on a HOLD: press, wait {@link DRAG_HOLD_MS}, then drag.
// A flick still scrolls the list, a tap still selects, and a still hold of
// `delayLongPress` still opens the rename dialog — the three gestures the
// row already answered, each told apart by what the finger does after it
// lands rather than by where it landed.
/** How long a finger must rest on a row before a move reorders rather than
 *  scrolls. Under the rename's own delay, so a drag arms before a rename
 *  would, and the rename's Pressable is terminated the moment it does. */
const DRAG_HOLD_MS = 180;
/** …and how far it must then travel, so the hold's own tremor is not a drag. */
const DRAG_SLOP_PX = 4;

interface SceneOutlinePanelProps {
  model: SceneOutlineModel;
  // Status-bar / notch inset (points). The panel background is full-bleed to
  // the top edge; this only pads the active chrome (tab bar) down so the
  // "Outline" label + close button clear the clock/wifi icons on native iOS.
  safeTop?: number;
}

export function SceneOutlinePanel({ model, safeTop = 0 }: SceneOutlinePanelProps) {
  const open = model.isOpen !== false;
  const slide = useRef(new Animated.Value(open ? 0 : -PANEL_WIDTH)).current;
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  // Keep a live handle to the model so the PanResponders (created once per
  // row index) never go stale even though the shell rebuilds the model each
  // render.
  const modelRef = useRef(model);
  modelRef.current = model;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: open ? 0 : -PANEL_WIDTH,
      duration: PANEL_ANIM_MS,
      useNativeDriver: true,
    }).start();
  }, [open, slide]);

  const iconFor = model.iconForKind ?? defaultIconForKind;

  // Expand/collapse: the set of COLLAPSED group ids. Default empty ⇒ everything
  // expanded (the point is to reveal contents). Panel-local, id-keyed like
  // `renaming`, so it survives the shell rebuilding the model each render.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const tree = useMemo(
    () => computeOutlineTree(model.objects, model.sceneOrder),
    [model.objects, model.sceneOrder],
  );
  const rows = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);

  // ── Drag-to-reparent ───────────────────────────────────────────────
  const [dragRowIndex, setDragRowIndex] = useState<number | null>(null);
  const [dragDy, setDragDy] = useState(0);
  const [dragDx, setDragDx] = useState(0);
  const dragDyRef = useRef(0);
  const dragDxRef = useRef(0);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const respondersRef = useRef<Map<string, ReturnType<typeof PanResponder.create>>>(new Map());

  // While dragging, the dragged row (+ its visible subtree) follows the finger
  // and every OTHER row shifts to close the vacated slot and open the drop slot
  // — so there's no blank gap and release doesn't jump. `newIndexOf` maps each
  // row's original index to its live reordered index; the delta drives the
  // shift. `dropTarget`/`dropTop` drive the depth-aware drop indicator.
  const dragLayout = (() => {
    if (dragRowIndex === null) return null;
    const depth = rows[dragRowIndex]?.depth ?? 0;
    let end = dragRowIndex + 1;
    while (end < rows.length && rows[end].depth > depth) end++; // include subtree
    const blockLen = end - dragRowIndex;
    const dropTop = Math.max(0, Math.min(rows.length - blockLen, Math.round(dragRowIndex + dragDy / ROW_HEIGHT)));
    const order = rows.map((_, i) => i);
    const block = order.splice(dragRowIndex, blockLen);
    order.splice(Math.min(dropTop, order.length), 0, ...block);
    const newIndexOf = new Map<number, number>();
    order.forEach((oi, k) => newIndexOf.set(oi, k));
    const dropTarget = computeDropTarget(rows, model.objects, dragRowIndex, dragDy, dragDx, ROW_HEIGHT, OUTLINE_INDENT);
    return { blockStart: dragRowIndex, blockEnd: end, newIndexOf, dropTop, depth: dropTarget.depth };
  })();

  // When the finger came down on a row, for the hold that arms a line grab.
  const touchDownAtRef = useRef(0);
  // Where the gesture stood when the drag was granted. The icon grants at
  // touch-down, so it is zero there; a line grab is granted partway through
  // the gesture, and without this the row would jump by however far the
  // finger had already travelled during the hold.
  const grantRef = useRef({ dx: 0, dy: 0 });

  const createDragResponder = useCallback(
    (index: number, arm: 'touch' | 'hold') =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => {
          // Even when this responder is not the one claiming, the touch's
          // moment is worth keeping: it is what the hold is measured from.
          touchDownAtRef.current = Date.now();
          return arm === 'touch';
        },
        onMoveShouldSetPanResponder: (_e, g) => (arm === 'touch' ? true : (
          Date.now() - touchDownAtRef.current >= DRAG_HOLD_MS
          && Math.hypot(g.dx, g.dy) > DRAG_SLOP_PX
        )),
        // The rows live inside a ScrollView, whose NATIVE pan recognizer
        // competes with this one for the same vertical drag. Losing that
        // race is what made rows feel impossible to grab (the list scrolled
        // instead) and what dropped finished reorders on the floor: the
        // steal arrives as onPanResponderTerminate, which resets the drag
        // WITHOUT committing it, so the row springs back as though the edit
        // never happened. Refusing to hand the gesture back — and blocking
        // the native responder outright — is what keeps a drag that started
        // on the handle a drag until the finger lifts.
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: (_e, g) => {
          grantRef.current = { dx: g.dx, dy: g.dy };
          dragDyRef.current = 0;
          dragDxRef.current = 0;
          setDragRowIndex(index);
          setDragDy(0);
          setDragDx(0);
        },
        onPanResponderMove: (_e, g) => {
          // Measured from the GRANT, not from the touch: the hold that arms
          // a line grab is over by the time this runs.
          const dx = g.dx - grantRef.current.dx;
          const dy = g.dy - grantRef.current.dy;
          dragDyRef.current = dy;
          dragDxRef.current = dx;
          setDragDy(dy);
          setDragDx(dx);
        },
        onPanResponderRelease: () => {
          const m = modelRef.current;
          const liveRows = rowsRef.current;
          const dragged = liveRows[index];
          if (dragged) {
            const target = computeDropTarget(
              liveRows, m.objects, index, dragDyRef.current, dragDxRef.current, ROW_HEIGHT, OUTLINE_INDENT,
            );
            const next = reparentToSceneOrder(treeRef.current, dragged.id, target.parentId, target.beforeId);
            const curParent = m.objects.get(dragged.id)?.parentGroupId ?? null;
            const orderChanged = next.length !== m.sceneOrder.length
              || next.some((id, i) => id !== m.sceneOrder[i]);
            if (target.parentId !== curParent && m.onReparent) {
              m.onReparent(dragged.id, target.parentId, next);
            } else if (orderChanged) {
              m.onReorder(next);
            }
          }
          setDragRowIndex(null);
          setDragDy(0);
          setDragDx(0);
          respondersRef.current.clear();
        },
        onPanResponderTerminate: () => {
          setDragRowIndex(null);
          setDragDy(0);
          setDragDx(0);
          respondersRef.current.clear();
        },
      }),
    [],
  );

  const getResponder = useCallback((index: number, arm: 'touch' | 'hold') => {
    const cache = respondersRef.current;
    const key = `${index}:${arm}`;
    if (!cache.has(key)) cache.set(key, createDragResponder(index, arm));
    return cache.get(key)!;
  }, [createDragResponder]);

  useEffect(() => { respondersRef.current.clear(); }, [rows.length]);

  const lastTapRef = useRef<{ id: string; time: number } | null>(null);

  return (
    <>
      <Animated.View
        style={[styles.panel, { transform: [{ translateX: slide }] }]}
        pointerEvents={open ? 'auto' : 'none'}
      >
        {/* Tab bar (Facet chrome): a single active Layers tab + close.
            paddingTop = safeTop keeps the background continuous to the top
            edge while pushing the label/close below the status bar.
            The tab is pressable when the app supplies onFrameAll: pressing the
            header frames the whole page, the panel-wide counterpart to
            double-tapping a row to frame one object. */}
        <View style={[styles.tabBar, { paddingTop: safeTop }]}>
          <Pressable
            style={[styles.tab, styles.tabActive]}
            onPress={model.onFrameAll}
            disabled={!model.onFrameAll}
            accessibilityRole={model.onFrameAll ? 'button' : undefined}
            accessibilityLabel={model.onFrameAll ? 'Frame page' : undefined}
          >
            <Text style={[styles.tabText, styles.tabTextActive]}>Outline</Text>
          </Pressable>
          <Pressable style={styles.closeButton} onPress={model.onClose} accessibilityLabel="Close outline">
            <MaterialCommunityIcons name="close" size={18} color={OUTLINE_CLOSE} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          scrollEnabled={dragRowIndex === null}
        >
          {rows.length === 0 ? (
            <Text style={styles.emptyText}>No objects placed</Text>
          ) : (
            <>
              {rows.map((row, index) => {
                const obj = model.objects.get(row.id);
                const inBlock = !!dragLayout && index >= dragLayout.blockStart && index < dragLayout.blockEnd;
                // Dragged block follows the finger; other rows shift to fill/open.
                const shiftY = dragLayout
                  ? (inBlock ? dragDy : (dragLayout.newIndexOf.get(index)! - index) * ROW_HEIGHT)
                  : 0;
                const webShift = Platform.OS === 'web' && dragLayout && !inBlock
                  ? ({ transition: 'transform 150ms ease' } as unknown as object)
                  : undefined;
                const selected = model.selectedIds.has(row.id);
                const locked = !!obj?.locked;
                const hidden = !!obj?.hidden;
                const glyph = row.isGroup
                  ? iconFor('group')
                  : obj?.icon ?? iconFor(obj?.kind ?? 'svg');
                const displayName = row.isGroup
                  ? obj?.name ?? model.groupNames?.get(row.id) ?? 'Group'
                  : obj?.name ?? 'Object';

                const handlePress = () => {
                  model.onSelect(row.id);
                  const now = Date.now();
                  const last = lastTapRef.current;
                  if (last && last.id === row.id && now - last.time < DOUBLE_TAP_MS) {
                    lastTapRef.current = null;
                    model.onFrame(row.id);
                  } else {
                    lastTapRef.current = { id: row.id, time: now };
                  }
                };

                return (
                  <Animated.View
                    key={row.id}
                    // The WHOLE line grabs: press, hold, drag (DRAG_HOLD_MS).
                    // The children claim the touch first — a tap on the name
                    // selects, the eye and the lock toggle — and this takes
                    // it off them once the hold is served, which is what
                    // leaves a flick to the ScrollView and a still hold to
                    // the rename.
                    {...getResponder(index, 'hold').panHandlers}
                    style={[
                      styles.row,
                      selected && styles.rowSelected,
                      inBlock && styles.rowDragging,
                      shiftY !== 0 || inBlock ? { transform: [{ translateY: shiftY }] } : null,
                      inBlock ? { zIndex: 10, opacity: 0.95 } : null,
                      webShift,
                    ]}
                  >
                    {/* Indent + chevron: groups toggle collapse; leaves get a
                        chevron-width spacer so names align. */}
                    <View style={{ width: row.depth * OUTLINE_INDENT }} />
                    {row.isGroup && row.hasChildren ? (
                      <Pressable
                        style={styles.chevron}
                        onPress={() => toggleCollapse(row.id)}
                        accessibilityLabel={collapsed.has(row.id) ? 'Expand' : 'Collapse'}
                      >
                        <MaterialCommunityIcons
                          name={icon(collapsed.has(row.id) ? OUTLINE_CHEVRON_COLLAPSED : OUTLINE_CHEVRON_EXPANDED)}
                          size={16}
                          color={OUTLINE_ICON}
                        />
                      </Pressable>
                    ) : (
                      <View style={styles.chevron} />
                    )}
                    {/* The kind icon grabs the row AT ONCE — no hold — for
                        a reorder aimed straight at it. Its hit area is
                        widened past the glyph (hitSlop, no layout change) so
                        a thumb aimed at the icon lands on it rather than on
                        the scrolling list beside it. The rest of the line
                        grabs too, on a hold: see the row above. */}
                    <View
                      style={styles.dragHandle}
                      hitSlop={DRAG_HANDLE_HIT_SLOP}
                      {...getResponder(index, 'touch').panHandlers}
                    >
                      <MaterialCommunityIcons name={icon(glyph)} size={18} color={OUTLINE_ICON} />
                    </View>
                    {/* Long-press renames EVERY row, locked ones included: a
                        name is a label, not the artwork, and the lock holds
                        the canvas. A locked row used to get no long-press at
                        all, which is how a group — locked, as groups are, so
                        their layout holds — was the one row that never
                        opened the rename dialog. The host decides what a
                        locked rename commits (the shell forces it through
                        its lock guard). */}
                    <Pressable
                      style={styles.rowContent}
                      onPress={handlePress}
                      onLongPress={() => setRenaming({ id: row.id, name: displayName })}
                      delayLongPress={400}
                    >
                      <Text
                        style={[styles.rowText, selected && styles.rowTextSelected]}
                        numberOfLines={1}
                      >
                        {displayName}
                      </Text>
                      <Pressable
                        style={styles.iconButton}
                        onPress={() => model.onToggleHidden(row.id)}
                        accessibilityLabel={hidden ? 'Show' : 'Hide'}
                      >
                        <MaterialCommunityIcons
                          name={icon(hidden ? 'eye-off-outline' : 'eye-outline')}
                          size={14}
                          color={hidden ? OUTLINE_ICON_ACTIVE : OUTLINE_ICON}
                        />
                      </Pressable>
                      <Pressable
                        style={styles.iconButton}
                        onPress={() => model.onToggleLock(row.id)}
                        accessibilityLabel={locked ? 'Unlock' : 'Lock'}
                      >
                        <MaterialCommunityIcons
                          name={icon(locked ? 'lock' : 'lock-open-outline')}
                          size={14}
                          color={locked ? OUTLINE_ICON_ACTIVE : OUTLINE_ICON}
                        />
                      </Pressable>
                    </Pressable>
                  </Animated.View>
                );
              })}
              {/* Drop indicator: a line at the opened slot, indented to the
                  resolved drop depth (Figma-style parenting affordance). */}
              {dragLayout ? (
                <View
                  pointerEvents="none"
                  style={[
                    styles.dropIndicator,
                    { top: dragLayout.dropTop * ROW_HEIGHT, left: 8 + dragLayout.depth * OUTLINE_INDENT },
                  ]}
                />
              ) : null}
            </>
          )}
        </ScrollView>
      </Animated.View>

      <RenameModal
        visible={!!renaming}
        initialName={renaming?.name ?? ''}
        onSubmit={(name) => { if (renaming) model.onRename(renaming.id, name); }}
        onClose={() => setRenaming(null)}
        onBringToFront={renaming && model.onBringToFront ? () => model.onBringToFront!(renaming.id) : undefined}
        onSendToBack={renaming && model.onSendToBack ? () => model.onSendToBack!(renaming.id) : undefined}
      />
    </>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: PANEL_WIDTH,
    backgroundColor: OUTLINE_BG,
    borderRightWidth: 1,
    borderRightColor: OUTLINE_BORDER,
    zIndex: 400,
  },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: OUTLINE_HAIRLINE,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: OUTLINE_TAB_ACTIVE },
  tabText: { fontSize: 13, fontWeight: '600', color: OUTLINE_TEXT_DIM },
  tabTextActive: { color: OUTLINE_TAB_TEXT_ACTIVE },
  closeButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  list: { flex: 1 },
  listContent: { paddingBottom: 20, position: 'relative' },
  emptyText: { color: OUTLINE_TEXT_DIM, fontSize: 13, textAlign: 'center', marginTop: 20 },
  chevron: { width: 20, height: ROW_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  dropIndicator: {
    position: 'absolute',
    right: 12,
    height: 2,
    backgroundColor: OUTLINE_TAB_ACTIVE,
    borderRadius: 1,
    zIndex: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ROW_HEIGHT,
    paddingRight: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: OUTLINE_HAIRLINE,
    backgroundColor: OUTLINE_BG,
  },
  rowSelected: { backgroundColor: OUTLINE_ROW_SELECTED },
  rowDragging: { backgroundColor: OUTLINE_ROW_DRAGGING },
  dragHandle: {
    width: 32,
    height: ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? ({ touchAction: 'none' } as object) : {}),
  },
  rowContent: { flex: 1, flexDirection: 'row', alignItems: 'center', height: ROW_HEIGHT },
  rowText: { flex: 1, fontSize: 14, color: OUTLINE_TEXT },
  rowTextSelected: { color: OUTLINE_TEXT_SELECTED, fontWeight: '600' },
  iconButton: { width: 28, height: ROW_HEIGHT, alignItems: 'center', justifyContent: 'center' },
});
