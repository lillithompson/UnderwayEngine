import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { resolveRename } from '../logic/rename';
import {
  BG_BLACK,
  MODAL_BG,
  MODAL_BORDER,
  MODAL_HEADER_BG,
  MODAL_OVERLAY,
  MODAL_RAISED,
  MODAL_TEXT,
  TEXT_DIM,
  TEXT_SECONDARY,
} from '../theme';

// Facet's RenameModal, lifted: dimmer backdrop, dark card with a #2a2a2a
// header (title + close X), a centered name field on a black well, and —
// when reorder handlers are supplied — a Bring-to-front / Send-to-back row
// (pressing either also commits any name edit, matching Facet). Pure rename
// resolution lives in logic/rename.ts.

interface RenameModalProps {
  visible: boolean;
  initialName: string;
  title?: string;
  placeholder?: string;
  /** Called with the resolved name only when the edit commits. */
  onSubmit: (name: string) => void;
  /** Close the modal (cancel / after any action). */
  onClose: () => void;
  onBringToFront?: () => void;
  onSendToBack?: () => void;
}

export function RenameModal({
  visible,
  initialName,
  title = 'Rename',
  placeholder = 'Name',
  onSubmit,
  onClose,
  onBringToFront,
  onSendToBack,
}: RenameModalProps) {
  const inputRef = useRef<TextInput>(null);
  const [editing, setEditing] = useState(initialName);

  // Reseed the field each time the modal opens on a (possibly different) row.
  useEffect(() => {
    if (visible) setEditing(initialName);
  }, [visible, initialName]);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, [visible]);

  const finish = (source: 'submit' | 'cancel' | 'bringFront' | 'sendBack') => {
    if (source !== 'cancel') {
      const result = resolveRename(editing, initialName);
      if (result.committed) onSubmit(result.name);
    }
    if (source === 'bringFront') onBringToFront?.();
    else if (source === 'sendBack') onSendToBack?.();
    onClose();
  };

  const showReorderRow = onBringToFront != null && onSendToBack != null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => finish('cancel')}>
      <Pressable style={styles.dimmer} onPress={() => finish('cancel')} />
      <View style={styles.contentLayer} pointerEvents="box-none">
        <View style={styles.card} onStartShouldSetResponder={() => true}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable style={styles.closeIcon} onPress={() => finish('cancel')} accessibilityLabel="Close">
              <MaterialCommunityIcons name="close" size={22} color={MODAL_TEXT} />
            </Pressable>
          </View>
          <View style={styles.body}>
            <View style={styles.inputWrap}>
              <TextInput
                ref={inputRef}
                style={styles.input}
                value={editing}
                onChangeText={setEditing}
                onSubmitEditing={() => finish('submit')}
                returnKeyType="done"
                autoFocus
                selectTextOnFocus
                placeholder={placeholder}
                placeholderTextColor={TEXT_DIM}
              />
            </View>
            {showReorderRow ? (
              <View style={styles.reorderRow}>
                <Pressable style={styles.reorderButton} onPress={() => finish('bringFront')}>
                  <Text style={styles.reorderButtonText}>Bring to front</Text>
                </Pressable>
                <Pressable style={styles.reorderButton} onPress={() => finish('sendBack')}>
                  <Text style={styles.reorderButtonText}>Send to back</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dimmer: { ...StyleSheet.absoluteFillObject, backgroundColor: MODAL_OVERLAY },
  contentLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: 360,
    maxWidth: '100%',
    backgroundColor: MODAL_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: MODAL_BORDER,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: MODAL_HEADER_BG,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  title: { color: MODAL_TEXT, fontSize: 18, fontWeight: '700', flex: 1 },
  closeIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 20, alignItems: 'center' },
  inputWrap: { alignSelf: 'stretch', backgroundColor: BG_BLACK, borderRadius: 8 },
  input: {
    color: MODAL_TEXT,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  reorderRow: { alignSelf: 'stretch', flexDirection: 'row', gap: 12, marginTop: 16 },
  reorderButton: {
    flex: 1,
    backgroundColor: MODAL_RAISED,
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reorderButtonText: { color: TEXT_SECONDARY, fontSize: 15, fontWeight: '600' },
});
