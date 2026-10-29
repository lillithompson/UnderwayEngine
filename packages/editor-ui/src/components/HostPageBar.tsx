import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { HostPage, HostPagesModel, HostRowModel } from '../adapter';
import {
  PANEL_INK, PANEL_INK_LABEL, PANEL_SHEET_BG, PANEL_SHEET_BORDER, PANEL_TRACK, STATE_ACTIVE,
} from '../theme';
import { AppModal } from './AppModal';
import { BorderBar } from './BorderBar';
import { ActionRow, BarBody, ColorSliderRow, SegmentedRow, SliderRow, SwitchRow } from './effectBar';
import { SwatchStateRow } from './SwatchStateRow';

// A HOST page of the Edit sheet (adapter's HostPage): a page the host
// describes rather than draws — rows in the same grammar as the effect
// pages (effectBar.tsx), each previewing live and committing on release,
// one undo step each, through the host — or the host's own element in
// the well. The panel knows nothing of what a row means: a thing of the
// host's own kind (a simulation's bot, its arena, a document's rules)
// gets the sheet every engine object gets, and the host supplies the
// words and the values.
//
// A `stroke` row is the Border page pointed at a line of the host's own
// (BorderBar with its Position row dropped: a pen has no inside to align
// to), its hue row under Dash when the row carries a colour. It is a bar
// of its own, so the rows around it are grouped into bodies of their own
// either side of it.

type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

/** One host page: the host's element, or its rows. A `bare` element is
 *  its own box and stands alone, as the panel's own un-welled pages do
 *  (the Copies page's groups); any other element sits in a body of rows. */
export function HostPageBar({ page, model }: { page: HostPage; model: HostPagesModel }) {
  if (page.element) return page.element.bare ? <>{page.element.node}</> : <BarBody>{page.element.node}</BarBody>;
  const rows = page.rows ?? [];
  // Consecutive plain rows share one body; a stroke row stands as its own
  // bar between them.
  const parts: React.ReactNode[] = [];
  let group: React.ReactNode[] = [];
  const flush = () => {
    if (group.length === 0) return;
    parts.push(<BarBody key={`body${parts.length}`}>{group}</BarBody>);
    group = [];
  };
  for (const row of rows) {
    if (row.kind === 'stroke') {
      flush();
      parts.push(
        <BorderBar
          key={row.key}
          border={{ width: row.width, dash: row.dash, position: 'center', color: row.color ?? { r: 0, g: 0, b: 0 } }}
          showPosition={false}
          color={row.color}
          onColor={row.color ? (c, committed) => model.onColor?.(page.key, row.key, c, committed) : undefined}
          onOpenColorPicker={row.color ? () => model.onPickColor?.(page.key, row.key) : undefined}
          onChange={(b) => model.onStroke?.(page.key, row.key, { width: b.width, dash: b.dash }, false)}
          onCommit={(b) => model.onStroke?.(page.key, row.key, { width: b.width, dash: b.dash }, true)}
        />,
      );
      continue;
    }
    group.push(<HostRow key={row.key} row={row} page={page.key} model={model} />);
  }
  flush();
  if (parts.length === 0) return <BarBody>{null}</BarBody>;
  return <>{parts}</>;
}

/** One row of a host page, by its kind. `page` is the key the row's edits
 *  are reported under. */
export function HostRow({ row, page, model }: { row: HostRowModel; page: string; model: Partial<HostPagesModel> }) {
  switch (row.kind) {
    case 'slider':
      return (
        <SliderRow
          label={row.label}
          value={row.value}
          apply={(t, committed) => model.onRowSlider?.(page, row.key, t, committed)}
          readout={{
            text: row.readout,
            // A typed number goes the way a drag's release does: one
            // committed write, at the position the host reads it as.
            commit: (n) => {
              const t = model.typedRowPosition?.(page, row.key, n);
              if (t != null) model.onRowSlider?.(page, row.key, t, true);
            },
          }}
        />
      );
    case 'segmented':
      return (
        <SegmentedRow
          label={row.label}
          options={row.options.map((o) => ({ value: o.value, label: o.label, icon: o.icon as MCIName | undefined }))}
          value={row.value}
          onChange={(v) => model.onRowSegment?.(page, row.key, v)}
        />
      );
    case 'switch':
      return <SwitchRow label={row.label} value={row.value} onValueChange={(v) => model.onRowSwitch?.(page, row.key, v)} />;
    case 'color':
      return (
        <ColorSliderRow
          label={row.label}
          color={row.color}
          onColor={(c, committed) => model.onColor?.(page, row.key, c, committed)}
          onOpenPicker={() => model.onPickColor?.(page, row.key)}
        />
      );
    case 'stroke':
      // A stroke row is a bar of its own (HostPageBar lays it between the
      // bodies); asked for as a row, it is its Width and Dash alone.
      return (
        <BorderBar
          border={{ width: row.width, dash: row.dash, position: 'center', color: row.color ?? { r: 0, g: 0, b: 0 } }}
          showPosition={false}
          color={row.color}
          onColor={row.color ? (c, committed) => model.onColor?.(page, row.key, c, committed) : undefined}
          onOpenColorPicker={row.color ? () => model.onPickColor?.(page, row.key) : undefined}
          onChange={(b) => model.onStroke?.(page, row.key, { width: b.width, dash: b.dash }, false)}
          onCommit={(b) => model.onStroke?.(page, row.key, { width: b.width, dash: b.dash }, true)}
        />
      );
    case 'actions':
      return (
        <ActionRow
          label={row.label}
          options={row.options.map((o) => ({ value: o.value, label: o.label, icon: o.icon as MCIName | undefined }))}
          onPress={(v) => model.onAction?.(page, row.key, v)}
        />
      );
    case 'cards':
      return <CardSlotsRow row={row} onPick={(slot, card) => model.onCardSlot?.(page, row.key, slot, card)} />;
    case 'swatchStates':
      return (
        <SwatchStateRow
          label={row.label}
          items={row.swatches}
          states={row.states}
          caption={row.caption}
          presets={row.presets}
          disabled={row.disabled}
          onTap={(id) => model.onSwatchState?.(page, row.key, id)}
        />
      );
    default: {
      const unhandled: never = row;
      return unhandled;
    }
  }
}

/**
 * A program of cards: a chip per slot showing its card's glyph, the slot
 * the host marks current ringed. A tap opens the picker: a sheet of the
 * row's cards under their headings plus Remove, the slot's own value lit.
 *
 * A program is any length, so the chips FLOW: fixed 56 pt chips that wrap
 * into as many rows as the width takes (DrawBots report e1e58a56; it was
 * a strip that scrolled sideways, which hid the cards past the edge),
 * ending in a + chip whose picker appends one (and offers no Remove). The
 * sheet it sits in scrolls down past them. `row.addLabel` is the + chip's
 * word.
 *
 * Disabled (dimmed, inert) while the host says so.
 */
export function CardSlotsRow({ row, onPick }: {
  row: Extract<HostRowModel, { kind: 'cards' }>;
  onPick: (slot: number, card: string | null) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const adding = open === row.slots.length;
  const current = open !== null && !adding ? row.slots[open] : null;
  return (
    <View style={styles.cardsRow}>
      <Text style={styles.cardsLabel}>{row.label}</Text>
      <View style={row.disabled && styles.chipsDisabled} pointerEvents={row.disabled ? 'none' : 'auto'}>
        <View style={styles.chips}>
          {row.slots.map((slot, k) => (
            <Pressable
              key={k}
              accessibilityRole="button"
              accessibilityLabel={`Slot ${k + 1}: ${slot.label}`}
              onPress={() => setOpen(k)}
              style={[styles.chip, styles.chipFixed, slot.current && styles.chipCurrent]}
            >
              <MaterialCommunityIcons name={slot.icon as MCIName} size={24} color={PANEL_INK} />
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={row.addLabel}
            onPress={() => setOpen(row.slots.length)}
            style={[styles.chip, styles.chipFixed, styles.chipAdd]}
          >
            <MaterialCommunityIcons name={'plus' as MCIName} size={24} color={PANEL_INK} />
          </Pressable>
        </View>
      </View>
      <AppModal
        visible={open !== null}
        title={adding ? row.addLabel : open !== null ? `Slot ${open + 1}` : ''}
        onClose={() => setOpen(null)}
      >
        <ScrollView contentContainerStyle={styles.pickerBody}>
          {row.picker.filter((opt) => !adding || opt.card !== null).map((opt, k, list) => {
            const lit = current ? current.label === opt.label : false;
            // A heading wherever the group changes.
            const heading = opt.group && opt.group !== list[k - 1]?.group ? opt.group : null;
            return (
              <React.Fragment key={opt.card ?? 'empty'}>
                {heading && <Text style={styles.pickerHeading}>{heading}</Text>}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={opt.label}
                  onPress={() => {
                    if (open !== null) onPick(open, opt.card);
                    setOpen(null);
                  }}
                  style={[styles.pickerRow, lit && styles.pickerRowLit]}
                >
                  <MaterialCommunityIcons name={opt.icon as MCIName} size={22} color={PANEL_INK} />
                  <View style={styles.pickerWords}>
                    <Text style={styles.pickerText}>{opt.label}</Text>
                  </View>
                </Pressable>
              </React.Fragment>
            );
          })}
        </ScrollView>
      </AppModal>
    </View>
  );
}

const styles = StyleSheet.create({
  cardsRow: { paddingVertical: 2 },
  cardsLabel: { color: PANEL_INK_LABEL, fontSize: 12, marginBottom: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipsDisabled: { opacity: 0.4 },
  chip: {
    height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: PANEL_TRACK, borderWidth: 1, borderColor: PANEL_SHEET_BORDER,
  },
  // Every chip keeps its size and the row wraps instead. Not `flex: 0`:
  // react-native-web writes that as CSS `flex: 0` — a 0% basis that
  // ignores the width — and every chip shrinks to nothing, the glyphs
  // piled on one another.
  chipFixed: { width: 56, flexShrink: 0 },
  chipAdd: { borderStyle: 'dashed', backgroundColor: 'transparent' },
  chipCurrent: { borderColor: STATE_ACTIVE, borderWidth: 2 },
  pickerBody: { padding: 12, gap: 6 },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 14,
    borderRadius: 12, backgroundColor: PANEL_SHEET_BG,
  },
  pickerRowLit: { backgroundColor: PANEL_TRACK },
  pickerWords: { flex: 1, minWidth: 0 },
  pickerText: { color: PANEL_INK, fontSize: 16 },
  pickerHeading: { color: PANEL_INK_LABEL, fontSize: 12, marginTop: 6, marginLeft: 4 },
});
