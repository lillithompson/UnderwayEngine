import type { SubmenuKey } from './submenuHeight';

// The poseable rig's type-specific options: the PARTS of the figure a
// slider can shape, rather than the Stroke / Fill / Opacity a vector
// object offers. A rig's silhouette is baked from its pose, so those three
// have nothing to act on — the figure as a whole, its hands, its feet and
// its spine are what it can actually change.
//
// Each part opens a bar of sliders (RigPoseBar). The first of them, RIG,
// is the whole mannequin: the three axes it can be stood on.

export type RigPart = 'rig' | 'hands' | 'feet' | 'spine' | 'head';

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
  { part: 'head', label: 'Head', sub: 'rigHead' },
];

/** The bar a part opens, and the part a bar belongs to — the SAME pairing,
 *  read both ways off the one table above. The panel needs both directions
 *  (a press opens a bar; the open bar says which part to render), and it
 *  used to spell each out as its own chain of ifs, which meant three lists
 *  of parts to keep in step and three places to forget when one was added. */
export function rigPartSubmenu(part: RigPart): SubmenuKey {
  return RIG_PART_OPTIONS.find((o) => o.part === part)!.sub;
}

export function rigPartOfSubmenu(sub: SubmenuKey): RigPart | null {
  return RIG_PART_OPTIONS.find((o) => o.sub === sub)?.part ?? null;
}

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
  | 'bend' | 'twist' | 'lean'
  | 'nod' | 'shake';

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
  // The head on its own, which the Spine bar cannot give: a bend there
  // curves the WHOLE column and takes the head along at the end of it, so
  // there is no way to tip a face without stooping the body to do it.
  head: [
    { key: 'nod', label: 'Nod', ends: ['up', 'down'], centered: true },
    { key: 'shake', label: 'Shake', ends: ['left', 'right'], centered: true },
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
  nod: 0.5, // facing level
  shake: 0.5,
};

/** The part a slider belongs to — read off the same table the bars render
 *  from, so a slider can never be listed under one part and answer for
 *  another. */
export function rigSliderPart(key: RigSliderKey): RigPart {
  for (const { part } of RIG_PART_OPTIONS) {
    if (PART_SLIDERS[part].some((spec) => spec.key === key)) return part;
  }
  // Unreachable: PART_SLIDERS covers every RigSliderKey (the exhaustiveness
  // test pins it). A key added to the union and to no bar lands here.
  return 'rig';
}

/** The bar's title. */
export function rigPartTitle(part: RigPart): string {
  return part.toUpperCase();
}

/** A fresh set of slider positions (every part at rest). */
export function restRigSliders(): Record<RigSliderKey, number> {
  return { ...RIG_SLIDER_REST };
}
