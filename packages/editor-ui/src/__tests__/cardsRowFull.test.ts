import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// A cards row with no room for another card draws no + chip: its pick would
// write nothing, a button that does nothing (DrawBots, report 767fe97a).

const SRC = readFileSync(resolve(__dirname, '..', 'components', 'HostPageBar.tsx'), 'utf8');
const ADAPTER = readFileSync(resolve(__dirname, '..', 'adapter.ts'), 'utf8');

describe('a full cards row', () => {
  it('is a field of the row, and takes the + chip away', () => {
    expect(ADAPTER).toContain('full?: boolean;');
    const at = SRC.indexOf('{row.full ? null : (');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(SRC.indexOf('accessibilityLabel={row.addLabel}'));
  });
});
