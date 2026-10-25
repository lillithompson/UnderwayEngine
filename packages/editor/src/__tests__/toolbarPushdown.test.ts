import { readFileSync } from 'fs';
import { resolve } from 'path';

// The toolbar's pushdown panel (docs/shared-editor.md §4.2 item 6, 6.5b.1),
// byte-identical in all three apps' shells before it moved. A .tsx cannot
// be imported in this repo's jest — the react-native shim carries no
// Animated or StyleSheet, and the JSX setting reads a component's own
// `import React` as unused — so the component is read as SOURCE here and
// typechecked where real react-native is: the three apps. That is the
// standing arrangement for every component in packages/editor/src.

const SRC = readFileSync(
  resolve(__dirname, '..', 'components', 'ToolbarPushdown.tsx'), 'utf8',
);

describe('ToolbarPushdown — the strip that pushes down from under the toolbar', () => {
  it('is a fixed row; what changes is whether it is down', () => {
    expect(SRC).toContain('export const PUSHDOWN_HEIGHT = 44;');
    expect(SRC).toContain('height: PUSHDOWN_HEIGHT,');
  });

  it('retracts by its own full height, so nothing of it shows below the bar', () => {
    expect(SRC).toContain("transform: visible ? 'translateY(0)' : 'translateY(-100%)',");
  });

  it('sits under the toolbar\'s zIndex, which is what hides the retracted state', () => {
    // No clipping container: it is BEHIND the opaque bar, not cut off by
    // it, which is why the top is the header's height and z is below 6.
    expect(SRC).toContain('top: HEADER_HEIGHT, zIndex: 5,');
    expect(SRC).toContain('background: HEADER_BG,');
  });

  it('drops the shadow entirely while retracted', () => {
    // A retracted sibling's bottom shadow leaked 1px below the opaque bar
    // and painted a phantom seam over whichever panel WAS open.
    expect(SRC).toContain("          : 'none',");
    expect(SRC).toContain("'inset 0 1px 0 rgba(0,0,0,0.08), 0 1px 0 rgba(0,0,0,0.08)'");
  });

  it('takes no pointer and no screen reader while retracted', () => {
    expect(SRC).toContain("pointerEvents: visible ? 'auto' : 'none',");
    expect(SRC).toContain('aria-hidden={!visible}');
  });
});
