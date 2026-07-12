import { CompositionEntry, CompositionState } from './types';

/**
 * Returns true if the entry + saved state indicates a brand-new file
 * created via the plus button (not a sample, activity copy, or duplicate).
 */
export function isNewFromPlusButton(
  entry: CompositionEntry | undefined,
  savedState: Partial<CompositionState> | null,
): boolean {
  if (!entry || savedState) return false;
  if (entry.isSample) return false;
  if (entry.tentative || entry.sourceDynamicSampleId || entry.bannerText) return false;
  return true;
}
