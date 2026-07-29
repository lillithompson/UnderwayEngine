// Phase 0 wiring proof: the @/editor-ui/* alias resolves (jest
// moduleNameMapper), ts-jest type-checks the new package, and the pure
// adapter/theme modules import cleanly in a node environment.
import { HEADER_HEIGHT, ROW_HEIGHT, defaultIconForKind } from '@/editor-ui/theme';
import type { SceneOutlineModel, OutlineObject, RGBLike } from '@/editor-ui/adapter';

describe('editor-ui scaffold', () => {
  it('exposes Facet-matched chrome metrics', () => {
    expect(HEADER_HEIGHT).toBe(50);
    expect(ROW_HEIGHT).toBe(44);
  });

  it('maps object kinds to default glyphs', () => {
    expect(defaultIconForKind('image')).toBe('image-outline');
    expect(defaultIconForKind('text')).toBe('format-text');
    expect(defaultIconForKind('nonsense')).toBe('shape-outline');
  });

  it('adapter types are structurally usable', () => {
    const obj: OutlineObject = { id: 'a', kind: 'text', name: 'Hi', locked: false, hidden: false };
    const color: RGBLike = { r: 1, g: 2, b: 3 };
    const model: Pick<SceneOutlineModel, 'objects' | 'sceneOrder' | 'selectedIds'> = {
      objects: new Map([[obj.id, obj]]),
      sceneOrder: [obj.id],
      selectedIds: new Set<string>(),
    };
    expect(model.objects.get('a')?.name).toBe('Hi');
    expect(color.r).toBe(1);
  });
});
