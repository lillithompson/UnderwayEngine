import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { resolveRename } from '../logic/rename';
import {
  MODAL_BG,
  MODAL_BORDER,
  MODAL_HEADER_BG,
  MODAL_OVERLAY,
  MODAL_RAISED,
  MODAL_TEXT,
  STATE_ACTIVE,
} from '../theme';

// Rename sheet for the scene outline (long-press a row). Pure rename
// resolution lives in logic/rename.ts (trim / empty-reverts / no-op);
// onCommit fires only when the name actually changes.

interface RenameModalProps {
  visible: boolean;
  initialName: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}

export function RenameModal({ visible, initialName, onCommit, onCancel }: RenameModalProps) {
  const [draft, setDraft] = useState(initialName);

  // Reseed the field each time the modal opens on a (possibly different) row.
  useEffect(() => {
    if (visible) setDraft(initialName);
  }, [visible, initialName]);

  const done = () => {
    const result = resolveRename(draft, initialName);
    if (result.committed) onCommit(result.name);
    else onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.overlay} onPress={onCancel}>
        {/* Stop the backdrop press from closing when tapping the card. */}
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>Rename</Text>
          </View>
          <View style={styles.body}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              autoFocus
              selectTextOnFocus
              placeholder="Name"
              placeholderTextColor="#9ca3af"
              onSubmitEditing={done}
              returnKeyType="done"
            />
            <View style={styles.actions}>
              <Pressable style={styles.button} onPress={onCancel}>
                <Text style={styles.buttonText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.button, styles.buttonPrimary]} onPress={done}>
                <Text style={[styles.buttonText, styles.buttonTextPrimary]}>Save</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: MODAL_OVERLAY,
  },
  card: {
    width: 300,
    maxWidth: '85%',
    backgroundColor: MODAL_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: MODAL_BORDER,
    overflow: 'hidden',
  },
  header: { backgroundColor: MODAL_HEADER_BG, paddingHorizontal: 12, paddingVertical: 8 },
  title: { color: MODAL_TEXT, fontSize: 18, fontWeight: '700' },
  body: { padding: 16, gap: 14 },
  input: {
    height: 42,
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: MODAL_RAISED,
    color: MODAL_TEXT,
    fontSize: 15,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  button: { height: 38, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: MODAL_RAISED },
  buttonPrimary: { backgroundColor: STATE_ACTIVE },
  buttonText: { color: MODAL_TEXT, fontSize: 13, fontWeight: '700' },
  buttonTextPrimary: { color: '#08243a' },
});
