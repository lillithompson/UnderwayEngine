/**
 * TopBar's optional background override (TopBarModel.background).
 *
 * The app hands the page's own colour here when the bar must merge with an
 * adjacent same-coloured band (CozyJournal's done-marked title band) —
 * without it the bar's default grey draws a hard seam line. TopBar renders
 * RN views no test renderer here mounts, so the wiring is pinned at source.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const ADAPTER = readFileSync(resolve(__dirname, '..', 'adapter.ts'), 'utf8');
const BAR = readFileSync(resolve(__dirname, '..', 'components', 'TopBar.tsx'), 'utf8');

describe('TopBar background override', () => {
  it('is an optional model field, defaulting to the themed grey', () => {
    expect(ADAPTER).toContain('background?: string;');
    // Unset, the bar keeps its own HEADER_BG — the override composes over
    // the base style rather than replacing it.
    expect(BAR).toContain(
      'style={[styles.bar, model.background ? { backgroundColor: model.background } : null]}',
    );
    expect(BAR).toContain('backgroundColor: HEADER_BG,');
  });
});
