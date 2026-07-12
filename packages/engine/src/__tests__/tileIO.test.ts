import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
} from '../compositionBinaryFormat';
import { compressTile, decompressTile } from '../tileIO';
import { CompositionFigure } from '../types';

function makeFigure(overrides: Partial<CompositionFigure> & { id: string; figureKey: string }): CompositionFigure {
  return {
    cellX: 0,
    cellY: 0,
    resolutionX: 2,
    resolutionY: 2,
    cellWidth: 4,
    cellHeight: 4,
    ...overrides,
  };
}

describe('tileIO compression round-trip', () => {
  test('compress then decompress recovers original payload', async () => {
    const bundle: CompositionBundle = {
      name: 'Compressed Test',
      gridLevel: 1,
      strokeScale: 8, gridIntensity: 0.5,
      camera: { offsetX: 10, offsetY: -20, zoom: 1.5 },
      figures: [
        makeFigure({ id: 'a', figureKey: 'file_1_L0', fileId: '1', cellX: 4, cellY: 8 }),
        makeFigure({ id: 'b', figureKey: 'file_1_L1', fileId: '1', cellX: 12, cellY: 16, rotation: 90 }),
      ],
    };
    const fcetData = new Uint8Array([0x46, 0x43, 0x45, 0x54, 1, 0, 0, 0, 8, 0, 8, 0]);
    const payload = serializeComposition(
      bundle,
      [{ id: '1', name: 'Tile', widthL0: 8, heightL0: 8, data: fcetData }],
    );

    const compressed = await compressTile(payload);
    expect(compressed.length).toBeLessThan(payload.length);

    const decompressed = await decompressTile(compressed);
    expect(decompressed).toEqual(payload);

    const result = deserializeComposition(decompressed);
    expect(result.meta.name).toBe('Compressed Test');
    expect(result.meta.figures).toHaveLength(2);
    expect(result.embeddedFiles).toHaveLength(1);
    expect(result.embeddedFiles[0].data).toEqual(fcetData);
  });

  test('empty composition compresses', async () => {
    const bundle: CompositionBundle = {
      name: 'Empty',
      gridLevel: 0,
      strokeScale: 8, gridIntensity: 0.5,
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      figures: [],
    };
    const payload = serializeComposition(bundle, []);

    const compressed = await compressTile(payload);
    const decompressed = await decompressTile(compressed);
    const result = deserializeComposition(decompressed);
    expect(result.meta.name).toBe('Empty');
    expect(result.meta.figures).toHaveLength(0);
  });
});
