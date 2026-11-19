import fs from 'fs';
import path from 'path';
import { redrawOnCanvasResize } from '../glCanvasResize';

// The grid is drawn into a GL canvas whose buffer a resize clears, after
// the surface has drawn it for the new viewport (DrawBots report c25db872:
// an iPad turned lost the canvas's grid until the next change drew it).

class FakeResizeObserver {
  static made: FakeResizeObserver[] = [];
  watched: unknown[] = [];
  disconnected = false;
  constructor(readonly callback: () => void) { FakeResizeObserver.made.push(this); }
  observe(el: unknown) { this.watched.push(el); }
  disconnect() { this.disconnected = true; }
  /** The browser reporting a new size for what it watches. */
  resize() { if (!this.disconnected) this.callback(); }
}

const canvasElement = () => ({ nodeType: 1, tagName: 'CANVAS' });
const g = globalThis as { ResizeObserver?: unknown };

describe('redrawOnCanvasResize', () => {
  beforeEach(() => {
    FakeResizeObserver.made = [];
    g.ResizeObserver = FakeResizeObserver;
  });
  afterAll(() => { delete g.ResizeObserver; });

  test('watches the GL canvas itself and draws again each time it is resized', () => {
    const canvas = canvasElement();
    const draw = jest.fn();
    redrawOnCanvasResize(canvas, draw);
    expect(FakeResizeObserver.made).toHaveLength(1);
    const ro = FakeResizeObserver.made[0];
    expect(ro.watched).toEqual([canvas]);
    expect(draw).not.toHaveBeenCalled();
    ro.resize(); // turned upright
    ro.resize(); // and back on its side
    expect(draw).toHaveBeenCalledTimes(2);
  });

  test('stops watching when told to, and draws nothing after', () => {
    const draw = jest.fn();
    const stop = redrawOnCanvasResize(canvasElement(), draw);
    const ro = FakeResizeObserver.made[0];
    stop();
    expect(ro.disconnected).toBe(true);
    ro.resize();
    expect(draw).not.toHaveBeenCalled();
  });

  test('watches nothing where there is no ResizeObserver or no element to watch', () => {
    const draw = jest.fn();
    // An OffscreenCanvas (no node), or no canvas at all.
    expect(() => redrawOnCanvasResize({ width: 10, height: 10 }, draw)()).not.toThrow();
    expect(() => redrawOnCanvasResize(null, draw)()).not.toThrow();
    expect(FakeResizeObserver.made).toHaveLength(0);
    delete g.ResizeObserver;
    expect(() => redrawOnCanvasResize(canvasElement(), draw)()).not.toThrow();
    expect(draw).not.toHaveBeenCalled();
  });
});

describe('the surface’s wiring', () => {
  const SRC = fs.readFileSync(
    path.join(__dirname, '..', 'components', 'CanvasSurface.tsx'), 'utf8',
  );

  test('the GL boot watches its own canvas, drawing the live state and camera', () => {
    const at = SRC.indexOf('const onContextCreate = useCallback(');
    expect(at).toBeGreaterThan(0);
    const boot = SRC.slice(at, at + 900);
    expect(boot).toContain('stopGlResizeRef.current?.();');
    expect(boot).toContain('stopGlResizeRef.current = redrawOnCanvasResize(gl.canvas, redrawGl);');
    expect(SRC).toContain(
      'const redrawGl = () => rendererRef.current?.render({ ...stateRef.current, camera: liveCameraRef.current });',
    );
  });

  test('stops watching when the surface goes', () => {
    expect(SRC).toContain('useEffect(() => () => { stopGlResizeRef.current?.(); stopGlResizeRef.current = null; }, []);');
  });
});
