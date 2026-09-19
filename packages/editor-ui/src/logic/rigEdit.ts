import type { RGBLike } from '../adapter';
import type { SubmenuKey } from './submenuHeight';

// The poseable rig's type-specific options: the PARTS of the figure a
// slider can shape, rather than the Stroke / Fill / Opacity a vector
// object offers. A rig's silhouette is baked from its pose, so those three
// have nothing to act on — the figure as a whole, its hands, its feet and
// its spine are what it can actually change.
//
// Each part opens a bar of sliders (RigPoseBar). The first of them, RIG,
// is the whole mannequin: the three axes it can be stood on.

export type RigPart = 'rig' | 'hands' | 'feet' | 'spine' | 'head' | 'joints';

export interface RigPartOption {
  part: RigPart;
  label: string;
  sub: SubmenuKey;
}

export const RIG_PART_OPTIONS: readonly RigPartOption[] = [
  // The whole figure's page is named for what its sliders do — turn the
  // figure on its three axes — rather than for the object.
  { part: 'rig', label: 'Transform', sub: 'rigRoot' },
  { part: 'hands', label: 'Hands', sub: 'rigHands' },
  { part: 'feet', label: 'Feet', sub: 'rigFeet' },
  { part: 'spine', label: 'Spine', sub: 'rigSpine' },
  { part: 'head', label: 'Head', sub: 'rigHead' },
  // The bends BETWEEN the ends: an elbow or a knee swung round the line
  // its own two ends make. See RIG_JOINT_SECTIONS.
  { part: 'joints', label: 'Joints', sub: 'rigJoints' },
];

/** The pages the panel actually OFFERS a rig selection: the whole figure
 *  only. The part pages (Hands / Feet / Spine / Head) were removed from
 *  the options row — their sliders live on as the floating slider modes
 *  the host drives through {@link rigPartSliders} / {@link rigSliderPart},
 *  which is why the full table above stays: it is the part↔bar/slider
 *  pairing, not the page list. */
export const RIG_PART_PAGES: readonly RigPartOption[] =
  RIG_PART_OPTIONS.filter((o) => o.part === 'rig' || o.part === 'joints');

/** One tab of a rig's option row. Most of them open a page of POSTURE
 *  sliders and name a part of the figure ({@link RIG_PART_PAGES}); Color
 *  names no part at all, which is why the row is its own list rather than
 *  the part table filtered again. */
export interface RigPageOption {
  /** Identity for the tab (a part name, or 'color'). */
  key: string;
  label: string;
  sub: SubmenuKey;
}

/** The tabs a rig selection OFFERS, in the order the row lists them: the
 *  whole figure's Transform page, the JOINTS page, then Color — the two
 *  colours the sketch is drawn in, which is the one thing about a rig that
 *  is not a pose. Both the tab row and the panel's page list read this, so
 *  a tab can never be offered with no page behind it. */
export const RIG_PAGES: readonly RigPageOption[] = [
  ...RIG_PART_PAGES.map((o) => ({ key: o.part, label: o.label, sub: o.sub })),
  { key: 'color', label: 'Color', sub: 'rigColor' as SubmenuKey },
];

/** What the Color page shows for a figure whose host wired no colours: the
 *  two the sketch shader draws in by default — bare page under the masses,
 *  a soft charcoal nib over them.
 *
 *  These MUST equal the host's own defaults (the app's poserRig PAPER_PAGE
 *  and INK_DARK, which are Figgie's DEFAULT_COLORS in 0..255), or an
 *  untouched page would show a colour the figure is not drawn in; the app's
 *  rigColor test pins the two pairs together, the same way rigParts pins
 *  the hand slider's rest position to Figgie's HAND_STRAIGHT_AT. */
export const RIG_VOLUMES_DEFAULT: RGBLike = { r: 243, g: 237, b: 228 };
export const RIG_OUTLINES_DEFAULT: RGBLike = { r: 41, g: 38, b: 36 };

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
  | 'handL' | 'handR' | 'wristTwistL' | 'wristTwistR' | 'spreadL' | 'spreadR'
  | 'wristBendL' | 'wristBendR'
  | 'footL' | 'footR' | 'ankleTwistL' | 'ankleTwistR' | 'ballBendL' | 'ballBendR'
  | 'bend' | 'twist' | 'lean'
  | 'nod' | 'shake' | 'tilt'
  | 'poleElbowL' | 'poleElbowR' | 'poleKneeL' | 'poleKneeR';

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
    { key: 'handL', label: 'Left', ends: ['open', 'fist'] },
    { key: 'handR', label: 'Right', ends: ['open', 'fist'] },
    { key: 'wristTwistL', label: 'Left Twist', ends: ['in', 'out'], centered: true },
    { key: 'wristTwistR', label: 'Right Twist', ends: ['in', 'out'], centered: true },
    // The fan itself: fingers squeezed together or splayed wide, centred
    // on the rig's own modelled spread.
    { key: 'spreadL', label: 'Left Spread', ends: ['together', 'wide'], centered: true },
    { key: 'spreadR', label: 'Right Spread', ends: ['together', 'wide'], centered: true },
    // The wrist's own hinge: the whole hand laid back or folded forward on
    // the end of an arm that stays where it was put.
    { key: 'wristBendL', label: 'Left Bend', ends: ['back', 'forward'], centered: true },
    { key: 'wristBendR', label: 'Right Bend', ends: ['back', 'forward'], centered: true },
  ],
  feet: [
    { key: 'footL', label: 'Left', ends: ['flat', 'pointed'] },
    { key: 'footR', label: 'Right', ends: ['flat', 'pointed'] },
    { key: 'ankleTwistL', label: 'Left Twist', ends: ['in', 'out'], centered: true },
    { key: 'ankleTwistR', label: 'Right Twist', ends: ['in', 'out'], centered: true },
    // The BALL's bend: the toe segment creased at the ball — the same
    // crease a drag on the toe tip makes (Figgie's bendBall, the toe slot)
    // — which the point slider (heel and ball) leaves alone. Centered:
    // below the middle the toes peel BACK up off the ground (a quarter
    // turn at the far end), above it they fold under toward tiptoe.
    { key: 'ballBendL', label: 'Left Bend', ends: ['back', 'tiptoe'], centered: true },
    { key: 'ballBendR', label: 'Right Bend', ends: ['back', 'tiptoe'], centered: true },
  ],
  spine: [
    { key: 'bend', label: 'Bend', ends: ['back', 'forward'], centered: true },
    { key: 'twist', label: 'Twist', ends: ['left', 'right'], centered: true },
    { key: 'lean', label: 'Lean', ends: ['left', 'right'], centered: true },
  ],
  // The head on its own, which the Spine bar cannot give: a bend there
  // curves the WHOLE column and takes the head along at the end of it, so
  // there is no way to tip a face without stooping the body to do it.
  // The one thing a two-bone chain has that no DRAG can give it. Where an
  // arm reaches is two degrees of freedom and a drag sets them; which way
  // the elbow points while reaching there is the third, and it is
  // invisible to every gesture that moves an end — a hand held at one spot
  // can have its elbow up, out or tucked, and only this chooses. Both ends
  // hold still while it swings (Figgie's poleChain), so it never costs the
  // pose the reach somebody already put in.
  joints: [
    { key: 'poleElbowL', label: 'Left', ends: ['round', 'round'], centered: true },
    { key: 'poleElbowR', label: 'Right', ends: ['round', 'round'], centered: true },
    { key: 'poleKneeL', label: 'Left', ends: ['round', 'round'], centered: true },
    { key: 'poleKneeR', label: 'Right', ends: ['round', 'round'], centered: true },
  ],
  head: [
    { key: 'nod', label: 'Nod', ends: ['up', 'down'], centered: true },
    { key: 'shake', label: 'Shake', ends: ['left', 'right'], centered: true },
    // The third, orthogonal axis: the roll about the gaze — ear to shoulder.
    { key: 'tilt', label: 'Tilt', ends: ['left', 'right'], centered: true },
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
  // Straight fingers — a tenth up the track, not at its floor: the open
  // end of the curl bends the fingers back PAST straight (Figgie's
  // HAND_STRAIGHT_AT, which this must equal or an untouched bar would
  // misreport the figure; the app's rigParts test pins the two together).
  handL: 0.1,
  handR: 0.1,
  wristTwistL: 0.5, // unrolled
  wristTwistR: 0.5,
  spreadL: 0.5, // the modelled fan
  spreadR: 0.5,
  wristBendL: 0.5, // straight, in line with the forearm
  wristBendR: 0.5,
  footL: 0, // flat — the slider travels TOWARD the point
  footR: 0,
  ankleTwistL: 0.5,
  ankleTwistR: 0.5,
  ballBendL: 0.5, // flat — centered between toes-back and tiptoe
  ballBendR: 0.5,
  bend: 0.5, // straight
  twist: 0.5,
  lean: 0.5,
  nod: 0.5, // facing level
  shake: 0.5,
  tilt: 0.5,
  // The chain as the drags left it — the middle of a slider whose two ends
  // are the same place, since a pole angle goes all the way round.
  poleElbowL: 0.5,
  poleElbowR: 0.5,
  poleKneeL: 0.5,
  poleKneeR: 0.5,
};

// ── The Joints page's two faces ─────────────────────────────────────

/** Which pair of chains the Joints page is showing. Its inner tabs, in the
 *  Copies page's own style: one shaded box whose tabs switch the two
 *  sliders under them, because Left and Right are one setting asked twice
 *  and elbows and knees are the same question about different chains. */
export type RigJointSection = 'elbows' | 'knees';

export const RIG_JOINT_SECTIONS: readonly { value: RigJointSection; label: string }[] = [
  { value: 'elbows', label: 'Elbows' },
  { value: 'knees', label: 'Knees' },
];

/** The two sliders one face shows, left then right. */
export function rigJointSliders(section: RigJointSection): readonly RigSliderKey[] {
  return section === 'elbows' ? ['poleElbowL', 'poleElbowR'] : ['poleKneeL', 'poleKneeR'];
}

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

/** A fresh set of slider positions (every part at rest). */
export function restRigSliders(): Record<RigSliderKey, number> {
  return { ...RIG_SLIDER_REST };
}
