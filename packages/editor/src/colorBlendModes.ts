import type { BlendMode } from '@/engine/types';

// Facet's brush blend modes as its color picker presents them: the 2×5 grid
// order and the button labels. ONE table for both pickers that render the
// grid — the tile editor's (pattern studio) and the journal editor's color
// tool — so the two can't drift. `invert` is in the engine's BlendMode union
// but (as in Facet) not on the grid: Rotate / Random cover the "just perturb
// it" itch without a mode that dead-ends at gray.

export const BLEND_MODES: BlendMode[] = [
  'normal', 'multiply', 'dodge', 'lighten', 'darken',
  'burn', 'rotate', 'randomize', 'hue', 'color',
];

export const MODE_LABEL: Record<BlendMode, string> = {
  normal: 'Normal',
  multiply: 'Multiply',
  dodge: 'Dodge',
  lighten: 'Lighten',
  darken: 'Darken',
  burn: 'Burn',
  invert: 'Invert',
  rotate: 'Rotate',
  randomize: 'Random',
  hue: 'Hue',
  color: 'Color',
};
