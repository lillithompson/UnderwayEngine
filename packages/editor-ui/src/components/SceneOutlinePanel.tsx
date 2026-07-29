import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { SceneOutlineModel } from '../adapter';
import { computeOutlineBlocks, OutlineBlock } from '../logic/outlineBlocks';
import { resolveDragReorder } from '../logic/dragReorder';
import {
  DOUBLE_TAP_MS,
  DRAG_THRESHOLD,
  OUTLINE_BG,
  OUTLINE_HEADER_BG,
  OUTLINE_ROW_HAIRLINE,
  OUTLINE_ROW_SELECTED,
  OUTLINE_TEXT,
  OUTLINE_TEXT_DIM,
  PANEL_ANIM_MS,
  PANEL_WIDTH,
  ROW_HEIGHT,
  defaultIconForKind,
} from '../theme';
import { RenameModal } from './RenameModal';

// Facet's SceneOutlinePanel, outline-only: a left slide-in list of scene
// objects in front→back (top→bottom) order. Rows drag to reorder (a group
// block moves as a unit; the array is only rewritten on release — during
// the drag only the dragged row translates, keeping the 90 fps contract),
// long-press to rename, double-tap to frame, with lock/hide toggles. The
// library/palette half of Facet's panel is intentionally dropped; the app
// wires everything through the SceneOutlineModel adapter (no engine dep).

type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
const icon = (glyph: string) => glyph as MCIName;

interface SceneOutlinePanelProps {
  model: SceneOutlineModel;
}

export function SceneOutlinePanel({ model }: SceneOutlinePanelProps) {
  const open = model.isOpen !== false;
  const slide = useRef(new Animated.Value(open ? 0 : -PANEL_WIDTH)).current;
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    Animated.timing(slide, {
      toValue: open ? 0 : -PANEL_WIDTH,
      duration: PANEL_ANIM_MS,
      useNativeDriver: true,
    }).start();
  }, [open, slide]);

  const blocks = useMemo(
    () => computeOutlineBlocks(model.objects, model.sceneOrder),
    [model.objects, model.sceneOrder],
  );

  const iconFor = model.iconForKind ?? defaultIconForKind;

  const commitDrag = (fromIndex: number, dy: number) => {
    const next = resolveDragReorder(blocks, fromIndex, dy, ROW_HEIGHT);
    const changed =
      next.length !== model.sceneOrder.length ||
      next.some((id, i) => id !== model.sceneOrder[i]);
    if (changed) model.onReorder(next);
  };

  return (
    <>
      <Animated.View
        style={[styles.panel, { transform: [{ translateX: slide }] }]}
        pointerEvents={open ? 'auto' : 'none'}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Layers</Text>
          <Pressable style={styles.headerButton} onPress={model.onClose} accessibilityLabel="Close layers">
            <MaterialCommunityIcons name="close" size={20} color={OUTLINE_TEXT} />
          </Pressable>
        </View>
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {blocks.length === 0 ? (
            <Text style={styles.empty}>Nothing here yet.</Text>
          ) : (
            blocks.map((block, index) => (
              <OutlineRow
                key={block.groupId ?? block.ids[0]}
                block={block}
                index={index}
                model={model}
                iconGlyph={icon(block.groupId ? iconFor('group') : iconFor(kindOf(model, block)))}
                onDragCommit={commitDrag}
                onRename={(id, name) => setRenaming({ id, name })}
              />
            ))
          )}
        </ScrollView>
      </Animated.View>

      <RenameModal
        visible={!!renaming}
        initialName={renaming?.name ?? ''}
        onCommit={(name) => {
          if (renaming) model.onRename(renaming.id, name);
          setRenaming(null);
        }}
        onCancel={() => setRenaming(null)}
      />
    </>
  );
}

function kindOf(model: SceneOutlineModel, block: OutlineBlock): string {
  return model.objects.get(block.ids[0])?.kind ?? 'svg';
}

interface OutlineRowProps {
  block: OutlineBlock;
  index: number;
  model: SceneOutlineModel;
  iconGlyph: MCIName;
  onDragCommit: (fromIndex: number, dy: number) => void;
  onRename: (id: string, name: string) => void;
}

function OutlineRow({ block, index, model, iconGlyph, onDragCommit, onRename }: OutlineRowProps) {
  const anchorId = block.ids[0];
  const anchor = model.objects.get(anchorId);
  const translateY = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);
  const lastTapRef = useRef(0);

  const selected = block.ids.some((id) => model.selectedIds.has(id));
  const locked = block.ids.every((id) => model.objects.get(id)?.locked);
  const hidden = block.ids.every((id) => model.objects.get(id)?.hidden);
  const isGroup = !!block.groupId;
  const displayName = isGroup ? `Group (${block.ids.length})` : anchor?.name ?? 'Object';

  // Drag handle owns its own PanResponder so scrolling + row taps stay
  // independent. Only the Animated.Value updates per move (no setState),
  // preserving the 90 fps drag contract.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > DRAG_THRESHOLD,
        onPanResponderGrant: () => setDragging(true),
        onPanResponderMove: (_e, g) => {
          translateY.setValue(g.dy);
        },
        onPanResponderRelease: (_e, g) => {
          setDragging(false);
          translateY.setValue(0);
          onDragCommit(index, g.dy);
        },
        onPanResponderTerminate: () => {
          setDragging(false);
          translateY.setValue(0);
        },
      }),
    // Rebuild when the row's position/identity changes so `index` is fresh.
    [index, translateY, onDragCommit],
  );

  const onRowPress = () => {
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      lastTapRef.current = 0;
      model.onFrame(anchorId);
    } else {
      lastTapRef.current = now;
      model.onSelect(anchorId);
    }
  };

  return (
    <Animated.View
      style={[
        styles.row,
        selected && styles.rowSelected,
        dragging && styles.rowDragging,
        { transform: [{ translateY }], zIndex: dragging ? 10 : 0 },
      ]}
    >
      <View style={styles.dragHandle} {...pan.panHandlers}>
        <MaterialCommunityIcons name="drag-horizontal-variant" size={20} color={OUTLINE_TEXT_DIM} />
      </View>
      <Pressable
        style={styles.rowBody}
        onPress={onRowPress}
        onLongPress={isGroup || locked ? undefined : () => onRename(anchorId, displayName)}
        delayLongPress={350}
      >
        <MaterialCommunityIcons name={iconGlyph} size={18} color={hidden ? OUTLINE_TEXT_DIM : OUTLINE_TEXT} />
        <Text
          style={[styles.rowName, hidden && styles.rowNameHidden]}
          numberOfLines={1}
        >
          {displayName}
        </Text>
      </Pressable>
      <Pressable
        style={styles.iconButton}
        onPress={() => model.onToggleHidden(anchorId)}
        accessibilityLabel={hidden ? 'Show' : 'Hide'}
      >
        <MaterialCommunityIcons
          name={icon(hidden ? 'eye-off-outline' : 'eye-outline')}
          size={18}
          color={hidden ? OUTLINE_TEXT : OUTLINE_TEXT_DIM}
        />
      </Pressable>
      <Pressable
        style={styles.iconButton}
        onPress={() => model.onToggleLock(anchorId)}
        accessibilityLabel={locked ? 'Unlock' : 'Lock'}
      >
        <MaterialCommunityIcons
          name={icon(locked ? 'lock' : 'lock-open-outline')}
          size={18}
          color={locked ? OUTLINE_TEXT : OUTLINE_TEXT_DIM}
        />
      </Pressable>
    </Animated.View>
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
    zIndex: 400,
  },
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 14,
    paddingRight: 6,
    backgroundColor: OUTLINE_HEADER_BG,
  },
  headerTitle: { color: OUTLINE_TEXT, fontSize: 16, fontWeight: '700' },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  list: { flex: 1 },
  listContent: { paddingBottom: 24 },
  empty: { color: OUTLINE_TEXT_DIM, fontSize: 13, padding: 16 },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: OUTLINE_ROW_HAIRLINE,
    backgroundColor: OUTLINE_BG,
  },
  rowSelected: { backgroundColor: OUTLINE_ROW_SELECTED },
  rowDragging: { opacity: 0.9 },
  dragHandle: { width: 34, height: ROW_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowName: { flex: 1, color: OUTLINE_TEXT, fontSize: 14 },
  rowNameHidden: { color: OUTLINE_TEXT_DIM },
  iconButton: { width: 36, height: ROW_HEIGHT, alignItems: 'center', justifyContent: 'center' },
});
