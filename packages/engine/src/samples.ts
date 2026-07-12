import storage from './storage';
import { builtInSamples } from './content';
import { importCompositionBundle, loadCompositionList } from './persistence';
import { CompositionEntry } from './types';

const SAMPLES_IMPORTED_KEY = 'samples_imported';

/** Module-level guard to prevent concurrent imports. */
let _importPromise: Promise<CompositionEntry[]> | null = null;

/**
 * Import all bundled sample compositions into storage.
 * Samples are fetched from the static server, imported sequentially
 * to limit memory pressure from bakeFile, and marked with isSample: true.
 * Returns the updated composition list.
 *
 * An optional onProgress callback is invoked after each sample is imported
 * so the UI can update incrementally.
 */
export async function importAllSamples(
  onProgress?: (list: CompositionEntry[]) => void,
): Promise<CompositionEntry[]> {
  if (_importPromise) return _importPromise;
  _importPromise = _doImport(onProgress);
  try {
    return await _importPromise;
  } finally {
    _importPromise = null;
  }
}

async function _doImport(
  onProgress?: (list: CompositionEntry[]) => void,
): Promise<CompositionEntry[]> {
  for (const sample of builtInSamples()) {
    // Yield to event loop between imports
    await new Promise<void>(r => setTimeout(r, 0));

    // Skip if a sample with this name already exists (prevents duplicates
    // when the samples_imported flag was cleared but the entries remain).
    const existing = await loadCompositionList();
    if (existing.some(e => e.isSample && e.name === sample.name)) {
      continue;
    }

    const resp = await fetch('/samples/' + encodeURIComponent(sample.filename));
    if (!resp.ok) continue;
    const buf = await resp.arrayBuffer();
    const data = new Uint8Array(buf);

    await importCompositionBundle(data, sample.name, { isSample: true });

    onProgress?.(await loadCompositionList());
  }

  await storage.setItem(SAMPLES_IMPORTED_KEY, 'true');
  return loadCompositionList();
}

/** Check whether samples have ever been imported. */
export async function areSamplesImported(): Promise<boolean> {
  const val = await storage.getItem(SAMPLES_IMPORTED_KEY);
  return val === 'true';
}

