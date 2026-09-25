/**
 * TopBar's back chevron is drawn only when the model gives it a press.
 *
 * CozyJournal moves the way back up onto its title band's name line while
 * the band is showing, and leaves `onBack` unset on the bar so the two never
 * offer the same door twice; once the band is dismissed the press comes
 * back and so does the chevron. TopBar renders RN views no test renderer
 * here mounts, so the wiring is pinned at source.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const ADAPTER = readFileSync(resolve(__dirname, '..', 'adapter.ts'), 'utf8');
const BAR = readFileSync(resolve(__dirname, '..', 'components', 'TopBar.tsx'), 'utf8');

describe('TopBar back chevron', () => {
  it('is an optional model press', () => {
    expect(ADAPTER).toContain('onBack?(): void;');
    expect(ADAPTER).not.toContain('onBack(): void;');
  });

  it('draws the chevron only with a press to give it', () => {
    expect(BAR).toContain('{model.onBack ? (');
    expect(BAR).toContain(
      '<Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.back} onPress={model.onBack}>',
    );
    // One chevron, inside the guard — never an unguarded second copy.
    expect(BAR.split('name="chevron-left"')).toHaveLength(2);
  });
});
