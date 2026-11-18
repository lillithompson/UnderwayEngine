// The host's own third row toggle (SceneOutlineModel.rowToggle; DrawBot's
// Ignore, report 8cba3aeb). SceneOutlinePanel can't be imported here (it
// pulls in @expo/vector-icons, which has no node shim), so the wiring is
// pinned at the source, as outlineFrameAll.test.ts pins the header's.
import { readFileSync } from 'fs';
import { join } from 'path';
import type { OutlineObject, SceneOutlineModel } from '@/editor-ui/adapter';

const SRC = readFileSync(
  join(__dirname, '..', 'components', 'SceneOutlinePanel.tsx'),
  'utf8',
);

/** The row's icons after the scroll gap: the eye, the lock and what follows. */
const ICONS = (() => {
  const from = SRC.indexOf('<View style={styles.rowGap} />');
  const to = SRC.indexOf('</Animated.View>', from);
  return SRC.slice(from, to);
})();

describe("the host's own row toggle", () => {
  it('is drawn after the lock, and only on a model that carries one', () => {
    const lock = ICONS.indexOf('model.onToggleLock(row.id)');
    const own = ICONS.indexOf('rowToggle.onToggle(row.id)');
    expect(lock).toBeGreaterThan(-1);
    expect(own).toBeGreaterThan(lock);
    // Gated on the model: an app with no rowToggle renders nothing more
    // than the eye and the lock it always had.
    expect(ICONS).toContain('{rowToggle ? (');
    expect(SRC).toContain('const rowToggle = model.rowToggle;');
  });

  it('leaves a blank slot on a row without it, so the icons stay in line', () => {
    const gate = ICONS.slice(ICONS.indexOf('{rowToggle ? ('));
    expect(gate).toMatch(/obj\?\.toggled === undefined \? \(\s*<View style=\{styles\.iconButton\} \/>/);
  });

  it("wears the host's glyphs and labels, in the eye's and the lock's colours", () => {
    const gate = ICONS.slice(ICONS.indexOf('{rowToggle ? ('));
    expect(gate).toContain('name={icon(obj.toggled ? rowToggle.iconOn : rowToggle.icon)}');
    expect(gate).toContain('accessibilityLabel={obj.toggled ? rowToggle.labelOn : rowToggle.label}');
    expect(gate).toContain('color={obj.toggled ? OUTLINE_ICON_ACTIVE : OUTLINE_ICON}');
    expect(gate).toContain('size={14}');
  });
});

describe('SceneOutlineModel.rowToggle and OutlineObject.toggled', () => {
  it('are optional, so a host without the toggle still type-checks', () => {
    const model = { objects: new Map(), sceneOrder: [], selectedIds: new Set<string>() } as unknown as SceneOutlineModel;
    expect(model.rowToggle).toBeUndefined();
    const row: OutlineObject = { id: 'svg_a', kind: 'svg', name: 'Drawing', locked: false, hidden: false };
    expect(row.toggled).toBeUndefined();
  });
});
