/**
 * TopBar's optional tools-disabled flag (TopBarModel.toolsDisabled).
 *
 * CozyJournal sets it while a finished page shows its picture in place of
 * the canvas: every tool button dims and goes inert, while the back button
 * and label are untouched. TopBar renders RN views no test renderer here
 * mounts, so the wiring is pinned at source.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const ADAPTER = readFileSync(resolve(__dirname, '..', 'adapter.ts'), 'utf8');
const BAR = readFileSync(resolve(__dirname, '..', 'components', 'TopBar.tsx'), 'utf8');

describe('TopBar toolsDisabled', () => {
  it('is an optional model field', () => {
    expect(ADAPTER).toContain('toolsDisabled?: boolean;');
  });

  it('dims the tool row and disables every tool button', () => {
    expect(BAR).toContain('model.toolsDisabled ? styles.toolsDisabled : null');
    expect(BAR).toContain('disabled={model.toolsDisabled}');
  });

  it('leaves the back button pressable', () => {
    const back = BAR.slice(BAR.indexOf('accessibilityLabel="Back"'));
    expect(back.slice(0, back.indexOf('</Pressable>'))).not.toContain('disabled');
  });
});
