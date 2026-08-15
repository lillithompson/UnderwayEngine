import type { SubmenuKey } from './submenuHeight';

// The poseable rig's type-specific options: the PARTS of the figure a
// slider can shape, rather than the Stroke / Fill / Opacity a vector
// object offers. A rig's silhouette is baked from its pose, so those three
// have nothing to act on — the figure as a whole, its hands, its feet and
// its spine are what it can actually change.
//
// Each part opens a bar of sliders (RigPoseBar). The first of them, RIG,
// is the whole mannequin: the three axes it can be stood on, and the IK
// switch — which belongs with the posing controls rather than floating
// beside them, since what it changes is what a joint drag does.

export type RigPart = 'rig' | 'hands' | 'feet' | 'spine';

export interface RigPartOption {
  part: RigPart;
  label: string;
  sub: SubmenuKey;
}

export const RIG_PART_OPTIONS: readonly RigPartOption[] = [
  { part: 'rig', label: 'Rig', sub: 'rigRoot' },
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
  | 'spinX' | 'spinY' | 'spinZ'
  | 'handL' | 'handR' | 'wristTwistL' | 'wristTwistR'
  | 'footL' | 'footR' | 'ankleTwistL' | 'ankleTwistR'
  | 'bend' | 'twist' | 'lean';

const PART_SLIDERS: Record<RigPart, readonly RigSliderSpec[]> = {
  // The root joint's own rotation — every other bone hangs off it, so
  // these three turn the whole figure without disturbing its pose.
  rig: [
    { key: 'spinX', label: 'X', ends: ['back', 'forward'], centered: true },
    { key: 'spinY', label: 'Y', ends: ['left', 'right'], centered: true },
    { key: 'spinZ', label: 'Z', ends: ['left', 'right'], centered: true },
  ],
  // Each hand and foot gets a second, CENTERED slider: the roll of the
  // joint it hangs off, which the curl and the flex leave alone. They are
  // paired under the part they belong to rather than given a bar of their
  // own — a hand is one thing to pose, however many ways it moves.
  hands: [
    { key: 'handL', label: 'Left', ends: ['flat', 'fist'] },
    { key: 'handR', label: 'Right', ends: ['flat', 'fist'] },
    { key: 'wristTwistL', label: 'Left Twist', ends: ['in', 'out'], centered: true },
    { key: 'wristTwistR', label: 'Right Twist', ends: ['in', 'out'], centered: true },
  ],
  feet: [
    { key: 'footL', label: 'Left', ends: ['pointed', 'flat'] },
    { key: 'footR', label: 'Right', ends: ['pointed', 'flat'] },
    { key: 'ankleTwistL', label: 'Left Twist', ends: ['in', 'out'], centered: true },
    { key: 'ankleTwistR', label: 'Right Twist', ends: ['in', 'out'], centered: true },
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
  spinX: 0.5, // upright, facing front
  spinY: 0.5,
  spinZ: 0.5,
  handL: 0, // flat
  handR: 0,
  wristTwistL: 0.5, // unrolled
  wristTwistR: 0.5,
  footL: 1, // flat
  footR: 1,
  ankleTwistL: 0.5,
  ankleTwistR: 0.5,
  bend: 0.5, // straight
  twist: 0.5,
  lean: 0.5,
};

/** The part a slider belongs to. */
export function rigSliderPart(key: RigSliderKey): RigPart {
  if (key === 'spinX' || key === 'spinY' || key === 'spinZ') return 'rig';
  if (key === 'handL' || key === 'handR') return 'hands';
  if (key === 'wristTwistL' || key === 'wristTwistR') return 'hands';
  if (key === 'footL' || key === 'footR') return 'feet';
  if (key === 'ankleTwistL' || key === 'ankleTwistR') return 'feet';
  return 'spine';
}

/** The bar's title, and the line under its sliders. */
export function rigPartTitle(part: RigPart): string {
  return part.toUpperCase();
}

/** Whether this part's bar carries the IK switch — the RIG bar does, since
 *  what the switch changes (what a joint drag moves) is a property of the
 *  whole figure rather than of any one part. */
export function rigPartHasIk(part: RigPart): boolean {
  return part === 'rig';
}

export function rigPartHint(part: RigPart): string {
  switch (part) {
    case 'rig': return 'Turns the whole figure; the pose rides along.';
    case 'hands': return 'Close the hand into a fist; Twist rolls the wrist.';
    case 'feet': return 'Point or flatten the foot; Twist swivels the ankle.';
    case 'spine':
    default: return 'Center is straight; each slider bends both ways.';
  }
}

/** A fresh set of slider positions (every part at rest). */
export function restRigSliders(): Record<RigSliderKey, number> {
  return { ...RIG_SLIDER_REST };
}
