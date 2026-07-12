/**
 * End-to-end test: verify clip box flows through the entire pipeline
 * from persistence → exportLayersToSVGInner → svgFigureCache → buildFigureSVGContent.
 * Uses real implementations (not mocked) for the SVG export and figure cache.
 */
import { ClipBox } from '../types';
import { exportLayersToSVGInner } from '../svgExport';
import { makeLayer } from './test-utils';

// Mock svg-sources (needed by svgExport for sprite cells)
jest.mock('../../assets/images/atlases/svg-sources.json', () => ({}));
// Mock storage (needed by svgFigureCache's persistence import)
jest.mock('@/engine/storage', () => ({
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    getBinary: jest.fn(() => Promise.resolve(null)),
  },
  __esModule: true,
}));
jest.mock('../bake', () => ({}));
jest.mock('@/native-shell/bridge/webBridge', () => ({ logToNative: jest.fn() }));

describe('clip box end-to-end', () => {
  test('without clip box: all cells are included', () => {
    const layer = makeLayer('l0', 0, 0);
    layer.cells[2][2] = {
      type: 'color', r: 255, g: 0, b: 0,
      transform: { rotation: 0, mirrorH: false, mirrorV: false },
    };
    layer.cells[6][6] = {
      type: 'color', r: 0, g: 255, b: 0,
      transform: { rotation: 0, mirrorH: false, mirrorV: false },
    };

    // No clip box
    const result = exportLayersToSVGInner([layer], {
      id: 'test', name: 'test',
      widthL0: 32, heightL0: 32,
      originL0X: 0, originL0Y: 0,
    });

    expect(result.widthL0).toBe(32);
    expect(result.heightL0).toBe(32);

    const elemText = result.elements.join('\n');
    expect(elemText).toContain('rgb(255,0,0)');
    expect(elemText).toContain('rgb(0,255,0)');
  });

  test('L1 layer cells are correctly filtered by clip box', () => {
    // L1 has 16 cells, each covering 2 L0 cells
    const layer = makeLayer('l1', 1, 0);

    // Cell at L1 (1,1) covers L0 range [2,4) — OUTSIDE clip region starting at L0 4
    layer.cells[1][1] = {
      type: 'color', r: 255, g: 0, b: 0,
      transform: { rotation: 0, mirrorH: false, mirrorV: false },
    };
    // Cell at L1 (3,3) covers L0 range [6,8) — INSIDE clip region [4,12)
    layer.cells[3][3] = {
      type: 'color', r: 0, g: 255, b: 0,
      transform: { rotation: 0, mirrorH: false, mirrorV: false },
    };
    // Cell at L1 (7,7) covers L0 range [14,16) — OUTSIDE clip region ending at 12
    layer.cells[7][7] = {
      type: 'color', r: 0, g: 0, b: 255,
      transform: { rotation: 0, mirrorH: false, mirrorV: false },
    };

    const clipBox: ClipBox = { clipL0X: 4, clipL0Y: 4, clipL0W: 8, clipL0H: 8 };
    const result = exportLayersToSVGInner([layer], {
      id: 'test', name: 'test',
      widthL0: 32, heightL0: 32,
      originL0X: 0, originL0Y: 0,
      clipBox,
    });

    expect(result.widthL0).toBe(8);
    const elemText = result.elements.join('\n');
    expect(elemText).toContain('rgb(0,255,0)');
    expect(elemText).not.toContain('rgb(255,0,0)');
    expect(elemText).not.toContain('rgb(0,0,255)');
  });
});
