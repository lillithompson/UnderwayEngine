/**
 * Built-in content registration.
 *
 * The engine ships no content of its own. The app registers its bundled
 * sample compositions and tutorial scripts at boot (Facet generates these
 * lists into its repo via build scripts and serves the files from its
 * static server under /samples/).
 */

export interface SampleCompositionEntry {
  name: string;
  filename: string;
  order: number;
  defaultThumbnail?: string;
}

export interface SampleTutorialEntry {
  name: string;
  filename: string;
  order: number;
  displayName: string;
  exampleImages?: string[];
}

let _samples: SampleCompositionEntry[] = [];
let _tutorials: SampleTutorialEntry[] = [];

export function registerBuiltInContent(content: {
  samples?: SampleCompositionEntry[];
  tutorials?: SampleTutorialEntry[];
}): void {
  if (content.samples) _samples = content.samples;
  if (content.tutorials) _tutorials = content.tutorials;
}

export function builtInSamples(): readonly SampleCompositionEntry[] {
  return _samples;
}

export function builtInTutorials(): readonly SampleTutorialEntry[] {
  return _tutorials;
}
