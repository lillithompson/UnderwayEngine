/**
 * Rasterize an SVG string to RGBA pixels using a canvas element.
 * Returns null if rasterization fails.
 *
 * The canvas and Image element are pooled module-wide: on iOS a fresh
 * <canvas> allocates a ~4 MB IOSurface backing store per call, and
 * WebKit's RemoteLayerTree frequently fails to reclaim old surfaces,
 * so allocating one per thumbnail caused multi-GB GPU-memory churn.
 *
 * Multiple independent callers (figureTextureCache, thumbnail,
 * compositionExport, eyedropperSnapshot) may invoke this
 * function concurrently from separate Promise chains. Because the pooled
 * Image and Canvas are shared singletons, concurrent calls would overwrite
 * each other's img.onload / img.src, causing the earlier call's promise to
 * never resolve (15-second timeout). The internal _queue serializes access
 * so at most one call uses the pooled resources at a time.
 */

let _pooledCanvas: HTMLCanvasElement | null = null;
let _pooledImg: HTMLImageElement | null = null;

/** Serialization queue — ensures at most one call uses the pooled
 *  canvas / image at a time. See module doc for the full rationale. */
let _queue: Promise<unknown> = Promise.resolve();

function getPooledCanvas(): HTMLCanvasElement {
  if (!_pooledCanvas) _pooledCanvas = document.createElement('canvas');
  return _pooledCanvas;
}

function getPooledImage(): HTMLImageElement {
  if (!_pooledImg) _pooledImg = new Image();
  return _pooledImg;
}

export function rasterizeSvgToObjectURL(
  svg: string,
  width: number,
  height: number,
): Promise<string | null> {
  const job = _queue.then(() => _rasterizeSvgToObjectURLInner(svg, width, height));
  _queue = job.catch(() => {});
  return job;
}

async function _rasterizeSvgToObjectURLInner(
  svg: string,
  width: number,
  height: number,
): Promise<string | null> {
  const canvas = getPooledCanvas();
  const img = getPooledImage();

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SVG image load timed out')), 15000);
      img.onload = () => { clearTimeout(timer); resolve(); };
      img.onerror = () => { clearTimeout(timer); reject(new Error('Failed to load SVG as image')); };
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0, width, height);
    const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return null;
    return URL.createObjectURL(blob);
  } catch {
    return null;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    img.onload = null;
    img.onerror = null;
    img.src = '';
  }
}

export function rasterizeSvgToPixels(
  svg: string,
  width: number,
  height: number,
): Promise<Uint8Array | null> {
  const job = _queue.then(() => _rasterizeSvgToPixelsInner(svg, width, height));
  // Advance the queue with .catch so a failure in one call doesn't
  // prevent subsequent calls from running.
  _queue = job.catch(() => {});
  return job;
}

async function _rasterizeSvgToPixelsInner(
  svg: string,
  width: number,
  height: number,
): Promise<Uint8Array | null> {
  const canvas = getPooledCanvas();
  const img = getPooledImage();

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SVG image load timed out')), 15000);
      img.onload = () => { clearTimeout(timer); resolve(); };
      img.onerror = () => { clearTimeout(timer); reject(new Error('Failed to load SVG as image')); };
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    return new Uint8Array(imageData.data.buffer);
  } catch {
    return null;
  } finally {
    // Release the canvas backing store (IOSurface on iOS) immediately
    // so the pooled element holds no GPU memory between calls.
    canvas.width = 0;
    canvas.height = 0;
    img.onload = null;
    img.onerror = null;
    img.src = '';
  }
}
