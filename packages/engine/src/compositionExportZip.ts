import { exportCompositionPNG, exportCompositionSVG } from './compositionExport';
import { exportCompositionBundle, loadCompositionState } from './persistence';
import { buildZip, ZipEntry } from './zipWriter';

export type ZipExportFormat = 'png' | 'svg' | 'tile';

export interface ZipExportItem {
  id: string;
  name: string;
}

export interface ZipExportOpts {
  /** Max pixel dimension for PNG raster, applied per composition. */
  pngMaxDimension: number;
}

// Default stroke scale when an entry has none stored — keep in sync with the
// consuming app's single-export default.
const DEFAULT_STROKE_SCALE = 0.2;

const utf8 = new TextEncoder();
const SAFE_NAME_RE = /[^a-zA-Z0-9_-]/g;

function safe(name: string): string {
  return name.replace(SAFE_NAME_RE, '_') || 'composition';
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function payloadFor(
  id: string,
  format: ZipExportFormat,
  opts: ZipExportOpts,
): Promise<Uint8Array | null> {
  if (format === 'png') {
    const compState = await loadCompositionState(id);
    const strokeScale = compState?.strokeScale ?? DEFAULT_STROKE_SCALE;
    const dataUri = await exportCompositionPNG(id, opts.pngMaxDimension, strokeScale);
    if (!dataUri) return null;
    const b64 = dataUri.replace(/^data:image\/png;base64,/, '');
    return base64ToBytes(b64);
  }
  if (format === 'svg') {
    const compState = await loadCompositionState(id);
    const strokeScale = compState?.strokeScale ?? DEFAULT_STROKE_SCALE;
    const svg = await exportCompositionSVG(id, undefined, strokeScale);
    if (!svg) return null;
    return utf8.encode(svg);
  }
  // tile
  const bundle = await exportCompositionBundle(id);
  return bundle ?? null;
}

/**
 * Export multiple compositions as a single .zip in the requested format.
 *
 * Returns the zip bytes, or null if every composition was empty (so the caller
 * can show an "Export failed" message). Per-composition export errors are
 * surfaced by throwing — the caller wraps this in try/catch already.
 *
 * Runs serially: each per-format export allocates significant transient memory
 * (PNG rasterization in particular), so we avoid spiking by running them one at
 * a time.
 */
export async function exportCompositionsAsZip(
  items: ZipExportItem[],
  format: ZipExportFormat,
  opts: ZipExportOpts,
): Promise<Uint8Array | null> {
  const ext = format;
  const used = new Set<string>();
  const entries: ZipEntry[] = [];

  for (const item of items) {
    const payload = await payloadFor(item.id, format, opts);
    if (!payload) continue;

    let stem = safe(item.name);
    let candidate = `${stem}.${ext}`;
    if (used.has(candidate)) {
      candidate = `${stem}_${item.id}.${ext}`;
    }
    used.add(candidate);
    entries.push({ name: candidate, data: payload });
  }

  if (entries.length === 0) return null;
  return buildZip(entries);
}
