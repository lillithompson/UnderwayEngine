import { exportCompositionPNG, exportCompositionSVG } from './compositionExport';
import { CompositionIOOptions, exportCompositionBundle, loadCompositionState } from './persistence';
import { buildZip, ZipEntry } from './zipWriter';

export type ZipExportFormat = 'png' | 'svg' | 'tile';

export interface ZipExportItem {
  id: string;
  name: string;
}

export interface ZipExportOpts {
  /** Max pixel dimension for PNG raster, applied per composition. */
  pngMaxDimension: number;
  /**
   * Load-side CompositionIOOptions, threaded into EVERY read this packer
   * makes — the bundle it packs, the state it reads a strokeScale from, and
   * the PNG/SVG render.
   *
   * A page-anchored consumer passes `{ normalize: false }`, as it does for
   * every other read of a page. Without it the zip was the one export that
   * normalized: each member came out of the canonical-box normalization
   * power-of-2 upscaled and re-anchored, with its strokeScale multiplied to
   * match — so a small page exported in a zip and imported again came back
   * four times its size, off its spot and at the wrong stroke weight, while
   * the very same page exported on its own came back exact.
   */
  io?: CompositionIOOptions;
  /**
   * Supplies a member's BYTES, in place of this module's own export for the
   * format. The archive is still built here — the member names, the `safe`
   * sanitizing, the `_<id>` de-dupe and the serial one-page-at-a-time loop
   * are the same for every member however its bytes were made.
   *
   * For a consumer whose file is the engine's export plus something of its
   * own: DrawBots' `.tile` carries its simulation document as a trailer on
   * the engine's bundle (`web/editor/exportAll.ts`), and packed its own zip
   * for that reason — a second copy of the naming rules, which a backup
   * written either way has to agree on, since the importer reads both.
   *
   * Return null for an item with nothing to write; it is left out of the
   * archive, exactly as an empty composition is.
   */
  payload?: (item: ZipExportItem, format: ZipExportFormat) => Promise<Uint8Array | null>;
}

// Default stroke scale when an entry has none stored — keep in sync with the
// consuming app's single-export default.
const DEFAULT_STROKE_SCALE = 1.0;

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
    const compState = await loadCompositionState(id, opts.io);
    const strokeScale = compState?.strokeScale ?? DEFAULT_STROKE_SCALE;
    const dataUri = await exportCompositionPNG(id, opts.pngMaxDimension, strokeScale, {
      preferOriginalImages: true,
      ...opts.io,
    });
    if (!dataUri) return null;
    const b64 = dataUri.replace(/^data:image\/png;base64,/, '');
    return base64ToBytes(b64);
  }
  if (format === 'svg') {
    const compState = await loadCompositionState(id, opts.io);
    const strokeScale = compState?.strokeScale ?? DEFAULT_STROKE_SCALE;
    const svg = await exportCompositionSVG(id, undefined, strokeScale, {
      preferOriginalImages: true,
      // A file other tools open: patterns as real paths (Figma reads no
      // `<pattern>`). The PNG member above keeps the paint server.
      expandTiles: true,
      ...opts.io,
    });
    if (!svg) return null;
    return utf8.encode(svg);
  }
  // tile
  const bundle = await exportCompositionBundle(id, opts.io);
  return bundle ?? null;
}

/**
 * Export multiple compositions as a single .zip in the requested format.
 *
 * Returns the zip bytes, or null if every composition was empty (so the caller
 * can show an "Export failed" message). Per-composition export errors are
 * surfaced by throwing — the caller wraps this in try/catch already.
 *
 * {@link ZipExportOpts.payload} replaces how a member's bytes are made while
 * keeping everything about the archive — names, sanitizing, de-duping, the
 * serial loop — here.
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
    const payload = opts.payload
      ? await opts.payload(item, format)
      : await payloadFor(item.id, format, opts);
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
