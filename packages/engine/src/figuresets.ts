import { importFileData, saveSVGDesign } from './persistence';
import { SVGDesignTemplate } from './types';
import { logToNative } from '@/native-shell/bridge/webBridge';

export interface ImportedFiguresetMeta {
  name: string;
  figureCount: number;
  thumbnails: string[];
  fileIds: string[];
  svgDesignIds: string[];
}

const FETCH_TIMEOUT_MS = 30_000;

/**
 * Fetch a .facet file from the static server and import all its figures.
 * Returns the IDs of the newly imported files.
 */
export async function importFigureset(filename: string): Promise<string[]> {
  logToNative('log', 'import', `importFigureset start: ${filename}`);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    logToNative('log', 'import', `fetch start: /figuresets/${filename}`);
    let resp: Response;
    try {
      resp = await fetch('/figuresets/' + encodeURIComponent(filename), { signal: controller.signal, cache: 'no-store' });
    } catch (e: any) {
      clearTimeout(timeoutId);
      if (e?.name === 'AbortError') {
        throw new Error(`fetch timeout after ${FETCH_TIMEOUT_MS}ms`);
      }
      throw e;
    }
    clearTimeout(timeoutId);

    const contentLength = resp.headers.get('Content-Length') ?? '?';
    logToNative('log', 'import', `fetch end: status=${resp.status} len=${contentLength}`);
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status} ${resp.statusText} (len=${contentLength}): ${body.slice(0, 200)}`);
    }

    logToNative('log', 'import', 'json parse start');
    const data = await resp.json();
    const figureCount = Array.isArray(data?.figures) ? data.figures.length : 0;
    logToNative('log', 'import', `json parse end: figures=${figureCount}`);
    if (!data.figures || !Array.isArray(data.figures)) {
      throw new Error(`Unexpected JSON shape: ${JSON.stringify(data).slice(0, 200)}`);
    }

    const ids: string[] = [];
    for (let i = 0; i < data.figures.length; i++) {
      const fig = data.figures[i];
      if (!fig.meta) continue;
      logToNative('log', 'import', `figure ${i + 1}/${data.figures.length} start: ${fig.name ?? 'Imported'}`);
      const id = await importFileData({
        name: fig.name ?? 'Imported',
        meta: fig.meta,
        thumbnail: fig.thumbnail,
      });
      logToNative('log', 'import', `figure ${i + 1}/${data.figures.length} done: id=${id}`);
      ids.push(id);
    }
    logToNative('log', 'import', `importFigureset done: imported=${ids.length}`);
    return ids;
  } catch (e) {
    logToNative('error', 'import', `importFigureset failed for ${filename}: ${String(e)}`);
    throw e;
  }
}

/**
 * Parse a .facet JSON string, import all figures, and return metadata
 * for displaying the figureset as a row in the library.
 */
export async function importFiguresetFile(content: string): Promise<ImportedFiguresetMeta | null> {
  logToNative('log', 'import', `importFiguresetFile start: len=${content.length}`);
  try {
    let data: any;
    try { data = JSON.parse(content); } catch (parseErr) {
      throw new Error(`JSON parse failed (len=${content.length}): ${String(parseErr).slice(0, 200)}`);
    }
    if (data.type !== 'figureset' || !Array.isArray(data.figures)) {
      throw new Error(`Unexpected JSON shape: ${JSON.stringify(data).slice(0, 200)}`);
    }

    const figures = data.figures;
    const thumbnails: string[] = [];
    const fileIds: string[] = [];

    for (let i = 0; i < figures.length; i++) {
      const fig = figures[i];
      if (!fig.meta) continue;
      logToNative('log', 'import', `figure ${i + 1}/${figures.length} start: ${fig.name ?? 'Imported'}`);
      const id = await importFileData({
        name: fig.name ?? 'Imported',
        meta: fig.meta,
        thumbnail: fig.thumbnail,
      });
      logToNative('log', 'import', `figure ${i + 1}/${figures.length} done: id=${id}`);
      fileIds.push(id);
      if (fig.thumbnail) thumbnails.push(fig.thumbnail);
    }

    // Import SVG designs if present
    const svgDesignIds: string[] = [];
    if (Array.isArray(data.svgDesigns)) {
      for (let i = 0; i < data.svgDesigns.length; i++) {
        const entry = data.svgDesigns[i];
        if (!entry.segments) continue;
        logToNative('log', 'import', `svgDesign ${i + 1}/${data.svgDesigns.length} start: ${entry.name ?? 'Design'}`);
        const designId = Date.now().toString() + '_svg_' + Math.random().toString(36).slice(2, 8);
        const design: SVGDesignTemplate = {
          id: designId,
          name: entry.name ?? 'Design',
          segments: entry.segments,
          color: entry.color ?? { r: 0, g: 0, b: 0 },
          subpaths: entry.subpaths,
          width: entry.width ?? 1,
          height: entry.height ?? 1,
        };
        // Generate thumbnail on import
        try {
          const { generateSVGDesignThumbnail } = await import('./svgDesignThumbnail');
          const thumb = await generateSVGDesignThumbnail(design);
          if (thumb) design.thumbnail = thumb;
        } catch {}
        await saveSVGDesign(design);
        svgDesignIds.push(designId);
        logToNative('log', 'import', `svgDesign ${i + 1}/${data.svgDesigns.length} done: id=${designId}`);
      }
    }

    if (fileIds.length === 0 && svgDesignIds.length === 0) return null;

    // Derive name from first figure's name or fallback
    const firstName = figures[0]?.name ?? data.svgDesigns?.[0]?.name ?? 'Imported';
    const totalCount = figures.length + (data.svgDesigns?.length ?? 0);
    const name = totalCount === 1 ? firstName : firstName + ' set';

    logToNative('log', 'import', `importFiguresetFile done: imported=${fileIds.length} figures, ${svgDesignIds.length} designs`);
    return { name, figureCount: fileIds.length, thumbnails, fileIds, svgDesignIds };
  } catch (e) {
    logToNative('error', 'import', `importFiguresetFile failed: ${String(e)}`);
    throw e;
  }
}
