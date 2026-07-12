import { builtInTutorials } from '../content';
import type { TutorialScript } from './tutorialTypes';

/**
 * Load and parse a tutorial script for the given sample name.
 * Returns null if no tutorial exists or if loading fails.
 * Never cached: the cache-busting query param always fetches the latest
 * script so edits show up without an app reload.
 */
export async function loadTutorial(sampleName: string): Promise<TutorialScript | null> {
  const entry = builtInTutorials().find(t => t.name === sampleName);
  if (!entry) return null;

  try {
    const url = '/samples/' + encodeURIComponent(entry.filename) + '?t=' + Date.now();
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const script: TutorialScript = await resp.json();
    return script;
  } catch (err) {
    console.error('[tutorial] load error:', err);
    return null;
  }
}
