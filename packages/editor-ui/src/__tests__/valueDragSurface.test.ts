import { readFileSync } from 'fs';
import { resolve } from 'path';

// Why a Width drag on iOS sprang back to where it started: WebKit took the
// touch as a scroll after the first move and cancelled it, so the control
// committed the value it had barely reached. `touch-action: none` on every
// value control's hit surface keeps the touch ours. No renderer here, so the
// spread is pinned at the source and the constant checked in both worlds.

const read = (file: string) =>
  readFileSync(resolve(__dirname, '..', 'components', file), 'utf8');

describe('VALUE_DRAG_SURFACE', () => {
  it('declares touch-action none where there is a document, and nothing elsewhere', () => {
    jest.isolateModules(() => {
      (globalThis as { document?: unknown }).document = {};
      (globalThis as { navigator?: unknown }).navigator = {};
      const { VALUE_DRAG_SURFACE } = require('../logic/slider') as { VALUE_DRAG_SURFACE: object };
      expect(VALUE_DRAG_SURFACE).toEqual({ touchAction: 'none' });
      delete (globalThis as { document?: unknown }).document;
      delete (globalThis as { navigator?: unknown }).navigator;
    });
    jest.isolateModules(() => {
      const { VALUE_DRAG_SURFACE } = require('../logic/slider') as { VALUE_DRAG_SURFACE: object };
      expect(VALUE_DRAG_SURFACE).toEqual({});
    });
  });
});

describe.each([
  { file: 'Slider.tsx', style: 'hit', name: 'the slider' },
  { file: 'ShadowBar.tsx', style: 'pad', name: 'the shadow offset pad' },
  { file: 'TintBar.tsx', style: 'stopBarHit', name: 'the tint stop bar' },
  { file: 'BrushControlsPanel.tsx', style: 'row', name: 'the brush size strip' },
])('$name', ({ file, style }) => {
  const SRC = read(file);
  it('spreads the drag surface into the view that carries its pan handlers', () => {
    expect(SRC).toContain(`style={styles.${style}}`);
    expect(SRC).toMatch(new RegExp(`\\n  ${style}: \\{[^}]*\\.\\.\\.VALUE_DRAG_SURFACE`));
    expect(SRC).toMatch(/VALUE_DRAG_SURFACE,?\s*\} from '\.\.\/logic\/slider'/);
  });
});

describe('the slider readout', () => {
  it('commits nothing on blur when the armed number was never changed', () => {
    const bar = read('effectBar.tsx');
    expect(bar).toContain('onPress={() => { setDraft(text); setSeeded(text); setEditing(true); }}');
    expect(bar).toContain('if (draft === seeded) return;\n    const n = parseFloat(draft.replace(\',\', \'.\'));');
  });
});
