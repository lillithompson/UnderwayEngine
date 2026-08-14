import type { SubmenuKey } from './submenuHeight';

// The poseable rig's type-specific options: the PARTS of the figure a
// slider can shape, rather than the Stroke / Fill / Opacity a vector
// object offers. A rig's silhouette is baked from its pose, so those three
// have nothing to act on — Hands, Feet and Spine are what it can actually
// change.
//
// Each part opens a bar of sliders (RigPoseBar). The IK toggle rides
// alongside them as an independent on/off option, not a bar.

export type RigPart = 'hands' | 'feet' | 'spine';

export interface RigPartOption {
  part: RigPart;
  label: string;
  sub: SubmenuKey;
}

export const RIG_PART_OPTIONS: readonly RigPartOption[] = [
  { part: 'hands', label: 'Hands', sub: 'rigHands' },
  { part: 'feet', label: 'Feet', sub: 'rigFeet' },
  { part: 'spine', label: 'Spine', sub: 'rigSpine' },
];

/** The sliders one part offers, in order, with the reading each end has.
 *  `centered` sliders sit at 0.5 for "straight" and run both ways. */
export interface RigSliderSpec {
  key: RigSliderKey;
  label: string;
  /** What the far left and far right of the track mean. */
  ends: [string, string];
  centered?: true;
}

export type RigSliderKey =
  | 'handL' | 'handR'
  | 'footL' | 'footR'
  | 'bend' | 'twist' | 'lean';

const PART_SLIDERS: Record<RigPart, readonly RigSliderSpec[]> = {
  hands: [
    { key: 'handL', label: 'Left', ends: ['flat', 'fist'] },
    { key: 'handR', label: 'Right', ends: ['flat', 'fist'] },
  ],
  feet: [
    { key: 'footL', label: 'Left', ends: ['pointed', 'flat'] },
    { key: 'footR', label: 'Right', ends: ['pointed', 'flat'] },
  ],
  spine: [
    { key: 'bend', label: 'Bend', ends: ['back', 'forward'], centered: true },
    { key: 'twist', label: 'Twist', ends: ['left', 'right'], centered: true },
    { key: 'lean', label: 'Lean', ends: ['left', 'right'], centered: true },
  ],
};

export function rigPartSliders(part: RigPart): readonly RigSliderSpec[] {
  return PART_SLIDERS[part];
}

/** Where each slider rests before anyone touches it — the position that
 *  matches the rig's REST pose, so an untouched bar never misreports the
 *  figure. (Nothing is applied until the user moves one; a hand posed
 *  finger by finger has no single "fistness" to read back.) */
export const RIG_SLIDER_REST: Record<RigSliderKey, number> = {
  handL: 0, // flat
  handR: 0,
  footL: 1, // flat
  footR: 1,
  bend: 0.5, // straight
  twist: 0.5,
  lean: 0.5,
};

/** The part a slider belongs to. */
export function rigSliderPart(key: RigSliderKey): RigPart {
  if (key === 'handL' || key === 'handR') return 'hands';
  if (key === 'footL' || key === 'footR') return 'feet';
  return 'spine';
}

/** The bar's title, and the line under its sliders. */
export function rigPartTitle(part: RigPart): string {
  return part.toUpperCase();
}

export function rigPartHint(part: RigPart): string {
  switch (part) {
    case 'hands': return 'Slide right to close the hand into a fist.';
    case 'feet': return 'Slide left to point the toes, right for a flat foot.';
    case 'spine':
    default: return 'Center is straight; each slider bends both ways.';
  }
}

/** A fresh set of slider positions (every part at rest). */
export function restRigSliders(): Record<RigSliderKey, number> {
  return { ...RIG_SLIDER_REST };
}
