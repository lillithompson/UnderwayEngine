// Framing the whole page hangs off the outline panel's "Outline" tab header.
// SceneOutlinePanel can't be imported here (it pulls in @expo/vector-icons,
// which has no node shim), so the wiring is pinned at the source — same
// approach as panelTheme.test.ts.
import { readFileSync } from 'fs';
import { join } from 'path';
import type { SceneOutlineModel } from '@/editor-ui/adapter';

const SRC = readFileSync(
  join(__dirname, '..', 'components', 'SceneOutlinePanel.tsx'),
  'utf8',
);

describe('the "Outline" header frames the page', () => {
  it('is a Pressable wired to onFrameAll', () => {
    const header = /<Pressable[\s\S]*?Outline<\/Text>/.exec(SRC)?.[0];
    expect(header).toBeDefined();
    expect(header).toContain('onPress={model.onFrameAll}');
  });

  it('goes inert — not a dead button — when the app supplies no handler', () => {
    // Every other app on this package (Facet) leaves onFrameAll unset; the
    // header must then behave exactly as the plain label it used to be.
    expect(SRC).toContain('disabled={!model.onFrameAll}');
    expect(SRC).toContain("accessibilityRole={model.onFrameAll ? 'button' : undefined}");
  });

  it('does not disturb the close button beside it', () => {
    expect(SRC).toContain('onPress={model.onClose}');
    expect(SRC).toContain('accessibilityLabel="Close outline"');
  });
});

describe('SceneOutlineModel.onFrameAll', () => {
  const base: Pick<SceneOutlineModel, 'objects' | 'sceneOrder' | 'selectedIds'> = {
    objects: new Map(),
    sceneOrder: [],
    selectedIds: new Set<string>(),
  };

  it('is optional, so hosts that never frame the page still type-check', () => {
    const model = { ...base } as SceneOutlineModel;
    expect(model.onFrameAll).toBeUndefined();
  });

  it('takes no arguments — it acts on the page, not on a row', () => {
    let framed = 0;
    const model = { ...base, onFrameAll: () => { framed++; } } as SceneOutlineModel;
    model.onFrameAll?.();
    expect(framed).toBe(1);
  });
});
