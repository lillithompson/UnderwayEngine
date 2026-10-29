import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The cards row of a host page (`HostPageBar.CardSlotsRow`): a program's
// chips flow into as many rows as the width takes (DrawBots report
// e1e58a56); they were a strip that scrolled sideways, which hid the
// cards past the edge. Node mounts nothing, so the structure is pinned
// at the source.

const SRC = readFileSync(resolve(__dirname, '..', 'components', 'HostPageBar.tsx'), 'utf8');
const ROW = SRC.slice(SRC.indexOf('export function CardSlotsRow('), SRC.indexOf('const styles = StyleSheet.create('));

describe('CardSlotsRow', () => {
  it('wraps its chips into rows, each chip its fixed size, the + chip last', () => {
    expect(ROW).toContain('<View style={styles.chips}>');
    expect(SRC).toContain("chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },");
    expect(SRC).toContain('chipFixed: { width: 56, flexShrink: 0 },');
    expect(ROW.indexOf("name={'plus' as MCIName}")).toBeGreaterThan(ROW.indexOf('{row.slots.map((slot, k) => ('));
  });

  it('rings the slot the host marks current and lights the one it marks flash (DrawBots report 84f7ee66)', () => {
    expect(ROW).toContain('slot.current && styles.chipCurrent, slot.flash && styles.chipFlash');
    expect(SRC).toContain('chipFlash: { backgroundColor: STATE_ACTIVE },');
    const ADAPTER = readFileSync(resolve(__dirname, '..', 'adapter.ts'), 'utf8');
    expect(ADAPTER).toContain('slots: readonly { icon: string; label: string; current: boolean; flash?: boolean }[];');
  });

  it('scrolls nothing sideways of its own: the sheet it sits in scrolls down past it', () => {
    const chips = ROW.slice(0, ROW.indexOf('<AppModal'));
    expect(chips).not.toContain('horizontal');
    expect(chips).not.toContain('<ScrollView');
    expect(ROW).not.toContain('scrollToEnd');
    expect(ROW).not.toContain('onContentSizeChange');
  });
});
