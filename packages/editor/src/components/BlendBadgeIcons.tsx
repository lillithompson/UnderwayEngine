import React from 'react';
import type { BlendMode } from '@/engine/types';
import type { ToolIconProps } from '@/editor/components/ToolIcons';

// The blend mode's mark, worn on the lower-right radial target's edge
// (SliderModeTarget's `badge`) whenever the mode is anything but Normal,
// on a disc of the colour in hand. The corner could say what the SLIDER
// drives and what colour the brush carries, but never what a dab would do
// to the paint already under it — and the mode is armed from inside that
// very menu (the Blend capsule) or the picker's grid, so nothing there
// moved when it changed.
//
// Drawn as inline <svg> for the same reason ToolIcons.tsx beside it is (the editor is
// a DOM tree; react-native-svg is not a dependency here, and the native app
// hosts this editor in a WebView), on the same 256×256 viewBox — but NOT
// through facetGlyphTransform: a badge is already shrunk onto a 24pt disc by
// the caller, and keyline padding on top of that would leave a speck.
//
// Every glyph is drawn in ONE ink, handed in by the badge (`swatchInk`:
// black on a light colour, white on a dark one), so no colour the brush
// picks up can swallow it. Shapes are therefore solid or thick-stroked — a hairline would break
// up at badge size — and each is built to read against its neighbours in
// the picker grid, not just on its own.
//
// Dodge and burn are Photoshop's own pair, the two the hand already knows:
// the dodging paddle (a disc on a stick, which is what you hold over the
// print to hold light BACK) and the cupped hand (the ring your fingers make
// to funnel light ONTO one spot). They are deliberately built alike — a
// round head on a tail — because they are inverses; the head says which:
// solid for dodge, open for burn. The rest have no canonical glyph, so
// these are candidates, picked to pair up the way the modes do: sun and
// moon for lighten / darken, a wheel for hue against a single arrow for
// rotate's one 30° nudge.
//
// The radial Blend fan wears MaterialCommunityIcons names for the same
// modes (PAINT_RADIAL_BLEND_ICONS, web/editor/sliderModeMenu.ts) because a
// radial button takes a glyph NAME, not a component. Those two tables now
// say the same thing in different alphabets — worth folding together (the
// radial can take a data-URI) if the fan is touched again.

/** Photoshop's dodge tool: the paddle — a solid disc on a handle, held over
 *  the paper to keep light off it, which is what dodge does (it BRIGHTENS
 *  by withholding exposure). The head is solid; burn's is open. */
export function DodgeBadgeIcon({ color, size }: ToolIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <circle cx={94} cy={94} r={56} fill={color} />
      <path
        d="M130 130 L212 212"
        stroke={color}
        strokeWidth={34}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Photoshop's burn tool: the cupped hand — the ring the fingers make to
 *  funnel light onto one spot, which is what burn does (it DARKENS by
 *  adding exposure). A SOLID hand with a hole through it, not a ring on a
 *  handle: drawn as a ring it came out a magnifying glass at badge size.
 *  Solid also pairs it with the paddle — same weight of mark, one pierced
 *  and one not, for two modes that are inverses. */
export function BurnBadgeIcon({ color, size }: ToolIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256">
      <path
        // Outline: the curled fingers round the top and right, the palm
        // down the left, the wrist as the stub off the bottom. Then the
        // hole the fingers close around, cut by the even-odd rule.
        d="M120 22 C176 22 224 66 224 122 C224 168 194 204 152 216
           L116 246 L60 214 L82 182
           C48 166 26 140 26 108 C26 66 62 34 100 30 Z
           M132 74 a46 46 0 1 0 0 92 a46 46 0 1 0 0 -92 Z"
        fill={color}
        fillRule="evenodd"
      />
    </svg>
  );
}

/** Multiply: the × of the arithmetic it does (base × brush), which is also
 *  the one mode whose name IS an operator. */
export function MultiplyBadgeIcon({ color, size }: ToolIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <path
        d="M58 58 L198 198 M198 58 L58 198"
        stroke={color}
        strokeWidth={34}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Lighten (keeps whichever channel is brighter): the sun, against
 *  darken's moon. */
export function LightenBadgeIcon({ color, size }: ToolIconProps) {
  const rays = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
    const t = (deg * Math.PI) / 180;
    const [cx, cy] = [Math.cos(t), Math.sin(t)];
    return `M${128 + 76 * cx} ${128 + 76 * cy} L${128 + 110 * cx} ${128 + 110 * cy}`;
  }).join(' ');
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <circle cx={128} cy={128} r={50} fill={color} />
      <path d={rays} stroke={color} strokeWidth={24} strokeLinecap="round" />
    </svg>
  );
}

/** Darken (keeps whichever channel is dimmer): the moon, against lighten's
 *  sun. A crescent is one path of two circles under the even-odd rule — the
 *  bite circle runs off the disc's edge, so what is left is a crescent
 *  rather than a ring. */
export function DarkenBadgeIcon({ color, size }: ToolIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256">
      <path
        d="M32 128 a96 96 0 1 0 192 0 a96 96 0 1 0 -192 0
           M100 86 a86 86 0 1 0 172 0 a86 86 0 1 0 -172 0"
        fill={color}
        fillRule="evenodd"
      />
    </svg>
  );
}

/** Invert: the half-filled disc every contrast control uses — the same
 *  circle, one half each way. */
export function InvertBadgeIcon({ color, size }: ToolIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <circle cx={128} cy={128} r={92} stroke={color} strokeWidth={24} />
      <path d="M128 36 A92 92 0 0 0 128 220 Z" fill={color} />
    </svg>
  );
}

/** Rotate: one arrow around the circle, for the one 30° step this mode
 *  nudges the hue by each dab — a single arrow, not the hue wheel, because
 *  it MOVES a hue rather than replacing it. */
export function RotateBadgeIcon({ color, size }: ToolIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <path
        d="M211 102 A88 88 0 1 1 143 45"
        stroke={color}
        strokeWidth={28}
        strokeLinecap="round"
      />
      <path d="M176 51 L139 71 L148 19 Z" fill={color} />
    </svg>
  );
}

/** Random: a die, because the stroke walks to a colour nobody picked. */
export function RandomizeBadgeIcon({ color, size }: ToolIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <rect x={40} y={40} width={176} height={176} rx={36} stroke={color} strokeWidth={24} />
      <circle cx={86} cy={86} r={17} fill={color} />
      <circle cx={128} cy={128} r={17} fill={color} />
      <circle cx={170} cy={170} r={17} fill={color} />
    </svg>
  );
}

/** Hue (takes the brush's hue, keeps what is underneath otherwise): the
 *  colour wheel, cut into segments — the hue circle itself. */
export function HueBadgeIcon({ color, size }: ToolIconProps) {
  const spokes = [90, 210, 330].map((deg) => {
    const t = (deg * Math.PI) / 180;
    return `M128 128 L${128 + 84 * Math.cos(t)} ${128 + 84 * Math.sin(t)}`;
  }).join(' ');
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <circle cx={128} cy={128} r={84} stroke={color} strokeWidth={24} />
      <path d={spokes} stroke={color} strokeWidth={22} />
    </svg>
  );
}

/** Color (hue AND saturation from the brush, lightness from what is
 *  underneath): a drop of pure colour poured over what is there. */
export function ColorBadgeIcon({ color, size }: ToolIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256">
      <path
        d="M128 26 C128 26 208 120 208 164 A80 80 0 1 1 48 164 C48 120 128 26 128 26 Z"
        fill={color}
      />
    </svg>
  );
}

/** The badge each mode wears. Normal is absent on purpose: it is the
 *  resting state, and a disc that is always wearing something has no way
 *  left to say "nothing is on". */
const BLEND_BADGE_ICONS: Partial<Record<BlendMode, React.ComponentType<ToolIconProps>>> = {
  multiply: MultiplyBadgeIcon,
  dodge: DodgeBadgeIcon,
  lighten: LightenBadgeIcon,
  darken: DarkenBadgeIcon,
  burn: BurnBadgeIcon,
  invert: InvertBadgeIcon,
  rotate: RotateBadgeIcon,
  randomize: RandomizeBadgeIcon,
  hue: HueBadgeIcon,
  color: ColorBadgeIcon,
};

/** The glyph the badge wears for `mode`, or undefined for Normal — which
 *  is what an unbadged ring means. */
export function blendBadgeIcon(
  mode: BlendMode,
): React.ComponentType<ToolIconProps> | undefined {
  return BLEND_BADGE_ICONS[mode];
}
