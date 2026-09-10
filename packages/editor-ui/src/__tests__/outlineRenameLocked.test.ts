import { readFileSync } from 'fs';
import { join } from 'path';

// Long-press on an outline row opens the rename dialog for EVERY row. A
// locked row used to get no long-press handler at all — and since a group
// is the thing a user locks so its layout holds, a group row was the row
// that never brought up the rename dialog. A name is a label, not the
// artwork; the lock holds the canvas, and what a locked rename commits is
// the host's call (CozyJournal's shell forces it through its lock guard).

const SRC = readFileSync(join(__dirname, '..', 'components', 'SceneOutlinePanel.tsx'), 'utf8');

describe('the outline renames locked rows too', () => {
  it('the long-press is not gated on the row\'s lock', () => {
    expect(SRC).toContain('onLongPress={() => setRenaming({ id: row.id, name: displayName })}');
    expect(SRC).not.toContain('onLongPress={locked ? undefined :');
    expect(SRC).toContain('delayLongPress={400}');
  });

  it('the lock still toggles from the row, and the dialog still submits through the model', () => {
    expect(SRC).toContain("accessibilityLabel={locked ? 'Unlock' : 'Lock'}");
    expect(SRC).toContain('onSubmit={(name) => { if (renaming) model.onRename(renaming.id, name); }}');
  });
});
