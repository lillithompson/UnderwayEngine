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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SceneOutlineModel } from '../adapter';
import { computeOutlineBlocks, OutlineBlock } from '../logic/outlineBlocks';
import { dragTargetIndex, resolveDragReorder } from '../logic/dragReorder';
import {
  DOUBLE_TAP_MS,
  OUTLINE_BG,
  OUTLINE_BORDER,
  OUTLINE_CLOSE,
  OUTLINE_HAIRLINE,
  OUTLINE_ICON,
  OUTLINE_ICON_ACTIVE,
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

// Facet's SceneOutlinePanel, outline-only: a left slide-in list of scene
// objects in front→back (top→bottom) order. Rows drag to reorder (the
// dragged row follows the finger while the rows it passes shift by one row;
// the order commits only on release — 90 fps drag contract), long-press to
// rename, double-tap to frame, with lock/hide toggles. Row chrome (icons,
// colors, drag-shift math) matches Facet exactly; the library/palette half
// of Facet's panel is intentionally dropped and everything is wired through
// the SceneOutlineModel adapter (no engine dependency).

type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
const icon = (glyph: string) => glyph as MCIName;

interface SceneOutlinePanelProps {
  model: SceneOutlineModel;
}

export function SceneOutlinePanel({ model }: SceneOutlinePanelProps) {
  const insets = useSafeAreaInsets();
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

  // Local back→front order for immediate drag feedback; synced from the
  // committed sceneOrder whenever it changes externally.
  const [localOrder, setLocalOrder] = useState<string[]>([...model.sceneOrder]);
  const localOrderRef = useRef(localOrder);
  useEffect(() => {
    setLocalOrder((prev) => {
      if (prev.length === model.sceneOrder.length && prev.every((id, i) => id === model.sceneOrder[i])) {
        return prev;
      }
      return [...model.sceneOrder];
    });
  }, [model.sceneOrder]);
  useEffect(() => { localOrderRef.current = localOrder; }, [localOrder]);

  const blocks = useMemo(
    () => computeOutlineBlocks(model.objects, localOrder),
    [model.objects, localOrder],
  );

  // ── Drag-to-reorder ────────────────────────────────────────────────
  const [dragRowIndex, setDragRowIndex] = useState<number | null>(null);
  const [dragDy, setDragDy] = useState(0);
  const dragBlocksRef = useRef<OutlineBlock[]>([]);
  const dragDyRef = useRef(0);
  const respondersRef = useRef<Map<number, ReturnType<typeof PanResponder.create>>>(new Map());

  const dragTargetRow = dragRowIndex === null
    ? null
    : dragTargetIndex(dragRowIndex, dragDy, ROW_HEIGHT, blocks.length);

  const createDragResponder = useCallback(
    (index: number) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragBlocksRef.current = computeOutlineBlocks(modelRef.current.objects, localOrderRef.current);
          dragDyRef.current = 0;
          setDragRowIndex(index);
          setDragDy(0);
        },
        onPanResponderMove: (_e, g) => {
          dragDyRef.current = g.dy;
          setDragDy(g.dy);
        },
        onPanResponderRelease: () => {
          const next = resolveDragReorder(dragBlocksRef.current, index, dragDyRef.current, ROW_HEIGHT);
          const prev = localOrderRef.current;
          const changed = next.length !== prev.length || next.some((id, i) => id !== prev[i]);
          if (changed) {
            setLocalOrder(next);
            modelRef.current.onReorder(next);
          }
          setDragRowIndex(null);
          setDragDy(0);
          respondersRef.current.clear();
        },
        onPanResponderTerminate: () => {
          setDragRowIndex(null);
          setDragDy(0);
          respondersRef.current.clear();
        },
      }),
    [],
  );

  const getResponder = useCallback((index: number) => {
    const cache = respondersRef.current;
    if (!cache.has(index)) cache.set(index, createDragResponder(index));
    return cache.get(index)!;
  }, [createDragResponder]);

  useEffect(() => { respondersRef.current.clear(); }, [blocks.length]);

  const lastTapRef = useRef<{ id: string; time: number } | null>(null);

  return (
    <>
      <Animated.View
        style={[styles.panel, { transform: [{ translateX: slide }] }]}
        pointerEvents={open ? 'auto' : 'none'}
      >
        {/* Tab bar (Facet chrome): a single active Layers tab + close. Padded
            down by the status-bar inset so the drawer clears the notch. */}
        <View style={[styles.tabBar, { paddingTop: insets.top }]}>
          <View style={[styles.tab, styles.tabActive]}>
            <Text style={[styles.tabText, styles.tabTextActive]}>Outline</Text>
          </View>
          <Pressable style={styles.closeButton} onPress={model.onClose} accessibilityLabel="Close outline">
            <MaterialCommunityIcons name="close" size={18} color={OUTLINE_CLOSE} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.list}
          contentContainerStyle={[styles.listContent, { paddingBottom: 20 + insets.bottom }]}
          scrollEnabled={dragRowIndex === null}
        >
          {blocks.length === 0 ? (
            <Text style={styles.emptyText}>No objects placed</Text>
          ) : (
            blocks.map((block, index) => {
              const anchorId = block.ids[0];
              const anchor = model.objects.get(anchorId);
              const isGroup = !!block.groupId;
              const isDragging = dragRowIndex === index;

              // Facet drag-shift: the dragged row follows the finger; rows it
              // passes shift up/down by one row height.
              let rowTranslateY = 0;
              if (isDragging) {
                rowTranslateY = dragDy;
              } else if (dragRowIndex !== null && dragTargetRow !== null && dragTargetRow !== dragRowIndex) {
                if (dragRowIndex < dragTargetRow && index > dragRowIndex && index <= dragTargetRow) {
                  rowTranslateY = -ROW_HEIGHT;
                } else if (dragRowIndex > dragTargetRow && index >= dragTargetRow && index < dragRowIndex) {
                  rowTranslateY = ROW_HEIGHT;
                }
              }

              const selected = block.ids.some((id) => model.selectedIds.has(id));
              const locked = block.ids.some((id) => model.objects.get(id)?.locked);
              const hidden = block.ids.every((id) => model.objects.get(id)?.hidden);
              const glyph = isGroup
                ? iconFor('group')
                : anchor?.icon ?? iconFor(anchor?.kind ?? 'svg');
              const displayName = isGroup ? `Group (${block.ids.length})` : anchor?.name ?? 'Object';

              const handlePress = () => {
                model.onSelect(anchorId);
                const now = Date.now();
                const last = lastTapRef.current;
                if (last && last.id === anchorId && now - last.time < DOUBLE_TAP_MS) {
                  lastTapRef.current = null;
                  model.onFrame(anchorId);
                } else {
                  lastTapRef.current = { id: anchorId, time: now };
                }
              };

              const webShift = Platform.OS === 'web' && !isDragging && dragRowIndex !== null
                ? ({ transition: 'transform 150ms ease' } as unknown as object)
                : undefined;

              return (
                <Animated.View
                  key={block.groupId ?? anchorId}
                  style={[
                    styles.row,
                    selected && styles.rowSelected,
                    isDragging && styles.rowDragging,
                    { transform: [{ translateY: rowTranslateY }], zIndex: isDragging ? 10 : 0 },
                    webShift,
                  ]}
                >
                  <View style={styles.dragHandle} {...getResponder(index).panHandlers}>
                    <MaterialCommunityIcons name={icon(glyph)} size={18} color={OUTLINE_ICON} />
                  </View>
                  <Pressable
                    style={styles.rowContent}
                    onPress={handlePress}
                    onLongPress={locked ? undefined : () => setRenaming({ id: anchorId, name: displayName })}
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
                      onPress={() => model.onToggleHidden(anchorId)}
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
                      onPress={() => model.onToggleLock(anchorId)}
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
            })
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
  listContent: { paddingBottom: 20 },
  emptyText: { color: OUTLINE_TEXT_DIM, fontSize: 13, textAlign: 'center', marginTop: 20 },
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
