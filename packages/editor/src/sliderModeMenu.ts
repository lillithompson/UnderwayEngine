import type { BlendMode, RGBColor } from '@/engine/types';
import { BLEND_MODES, MODE_LABEL } from '@/editor/colorBlendModes';
import { PAINT_MODE_ICON } from '@/editor/components/toolbarMeta';

// The lower-right slider-mode target's menu model (see SliderModeTarget):
// when a floating slider stands at the bottom of the screen, an empty
// circle beside it — on the undo/redo column's line — opens a radial menu
// of what that slider can MEAN. Kept pure so the option tables are
// testable in node, the way radialMenu.ts is for the long-press menu the
// target borrows its UI from. (CozyJournal's rig modes — the Turn, Hands,
// Feet and Head fans and the sides capsule — are its own, over this
// module's option shape.)
//
// An option may carry CHILDREN — a second level shown as a floating
// CAPSULE menu (sliderModeCapsuleOptions below; the hosts render it with
// ToolModeCapsule's chrome). Releasing on the parent picks its
// `defaultChildKey` — so a flick that never reads the capsule still lands
// on the option's most natural pick — and raises the capsule for the finer
// picks.

export interface SliderModeOption {
  key: string;
  /** MaterialCommunityIcons glyph the radial button wears (the quick-action
   *  menu is icon-only, and this menu copies it exactly). */
  icon: string;
  /** The name the floating slider row shows while this mode is on. */
  label: string;
  /** A second level: releasing on this option raises these as a capsule
   *  menu (sliderModeCapsuleOptions). */
  children?: SliderModeOption[];
  /** What releasing on THIS option selects when it has children (a parent
   *  is a doorway, not a mode of its own). */
  defaultChildKey?: string;
  /** A doorway ONLY: releasing here raises the capsule and selects nothing.
   *  For fans whose children CONFIRM a setting rather than arm a slider
   *  mode — auto-picking a default would silently clobber the color or
   *  blend the user already has, and the capsule would then light a
   *  selection they never made. */
  openOnly?: boolean;
  /** A SWATCH child (the paint Color option's recent colors): the radial
   *  button is a disc filled with this color rather than a glyph, and
   *  selecting it picks the color — it is not a slider mode. */
  color?: RGBColor;
  /** An IMAGE child (the tile Choose fan): a data-URI drawn in the glyph's
   *  place, with a re-inked `hoverUri` for the hover invert and a `rotate`
   *  (degrees CW) for a posed tile. Selecting it arms that tile — it is
   *  not a slider mode. */
  uri?: string;
  hoverUri?: string;
  rotate?: number;
  /** In the CAPSULE, wear the glyph rather than the word. For a child
   *  standing among picture segments — the tile Choose fan's Random arm,
   *  first in a row that is otherwise tiles — where a word is the one
   *  thing in the row that has to be read rather than seen. The radial is
   *  glyphs already, so this says nothing about the fan. */
  capsuleIcon?: boolean;
}

export type PaintSliderMode = 'size' | 'opacity';

/** What the paint brush's bottom slider can drive: the dab's size or its
 *  opacity (the same value the color picker's Opacity edits). The menu the
 *  shell actually opens adds the Color and Blend options on top — see
 *  {@link paintSliderModes}. */
export const PAINT_SLIDER_MODES: SliderModeOption[] = [
  { key: 'opacity', icon: 'opacity', label: 'Opacity' },
  { key: 'size', icon: 'diameter-outline', label: 'Size' },
];

// ── The paint menu's Color option ───────────────────────────────────
// The raster brush's radial menu carries a third button beside Opacity and
// Size: Color. Its second level is not a menu at all but the property
// pages' own HUE ROW, floated in the capsule's slot (the shell's
// BrushColorRow) — so the option has no children to list here.
//
// It carried six named swatches and a More doorway before. Six inks a
// hand can learn are a good keyboard, but they were also the only six:
// every other colour meant More, and a modal over the page — the reach
// the second level exists to save. The row has no list to run out of.

// ── The paint menu's Blend option ───────────────────────────────────
// The fourth root: what a dab DOES to the color already under it. Its fan
// is always four wide: Normal first, More last, and between them the two
// modes most recently used that are not Normal — so whatever you have been
// switching between stays one flick away, and the grid's longer tail
// (lighten, burn, rotate, random…) joins the fan the moment it is reached
// for, without the fan growing past a hand's reach.

/** The Blend fan's two memory slots, in fan order, and which of them was
 *  armed last. A new mode takes the OLDER slot in place rather than
 *  pushing onto the front, so a mode already on the fan never changes
 *  position under the thumb: flicking between the two shown reorders
 *  nothing, and only the one you have stopped using gives way. */
export interface PaintRecentBlends {
  readonly slots: readonly [BlendMode, BlendMode];
  readonly newest: 0 | 1;
}

/** Before anything has been armed: the two modes the fan used to carry as
 *  fixed staples, so a fresh brush reads as it always has. */
export const PAINT_RECENT_BLENDS_DEFAULT: PaintRecentBlends = {
  slots: ['dodge', 'multiply'],
  newest: 0,
};

/** A stored recent-blends record read back, or null when it is not one
 *  (an older build's shape, junk): two different modes, neither Normal —
 *  which never takes a slot — and which of the two is newer. */
export function parseRecentBlends(raw: unknown): PaintRecentBlends | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { slots, newest } = raw as { slots?: unknown; newest?: unknown };
  if (!Array.isArray(slots) || slots.length !== 2) return null;
  const [a, b] = slots as unknown[];
  const isMode = (m: unknown): m is BlendMode =>
    typeof m === 'string' && m !== 'normal' && (BLEND_MODES as string[]).includes(m);
  if (!isMode(a) || !isMode(b) || a === b) return null;
  if (newest !== 0 && newest !== 1) return null;
  return { slots: [a, b], newest };
}

/** The memory after arming `mode`. Normal is always on the fan and never
 *  takes a slot; a mode already in one just becomes the newest; anything
 *  else replaces the older slot where it stands. Returns `recent` itself
 *  when nothing changes, so a state setter bails out of the render. */
export function rememberBlend(recent: PaintRecentBlends, mode: BlendMode): PaintRecentBlends {
  if (mode === 'normal') return recent;
  const at = recent.slots.indexOf(mode);
  if (at === recent.newest) return recent;
  if (at !== -1) return { slots: recent.slots, newest: at as 0 | 1 };
  const older = recent.newest === 0 ? 1 : 0;
  const slots: [BlendMode, BlendMode] = [...recent.slots];
  slots[older] = mode;
  return { slots, newest: older };
}

/** The glyph each blend mode wears on a radial disc (the fan is icon-only,
 *  like every radial menu). One entry per engine BlendMode so the memory
 *  slot can show whatever the picker grid armed. */
export const PAINT_RADIAL_BLEND_ICONS: Record<BlendMode, string> = {
  normal: 'water',                  // a dab laid down as-is
  dodge: 'white-balance-sunny',     // brightens what it touches
  multiply: 'close',                // the × of multiply
  color: 'format-color-fill',       // pours the brush's color over
  lighten: 'brightness-5',
  darken: 'brightness-4',
  burn: 'fire',
  invert: 'invert-colors-off',
  rotate: 'rotate-right',
  randomize: 'dice-multiple',
  hue: 'invert-colors',
};

/** The name each blend mode goes by wherever the option shows words (the
 *  capsule's segments, the More sheet's cells) — the PICKER GRID's own
 *  table, aliased rather than re-typed. It was a second copy of the same
 *  eleven words, and two label lists for one enum drift the moment either
 *  is edited; the icon table beside it stays its own because the capsule
 *  and the grid draw in different alphabets (see BlendBadgeIcons). */
export const PAINT_RADIAL_BLEND_LABELS: Record<BlendMode, string> = MODE_LABEL;

/** The Blend fan's last child: not a mode but a doorway — the shell
 *  slides up the full grid of blend modes (BlendPickerModal), the way the
 *  Color fan's More opens the colour picker and the shape capsule's opens
 *  the shape grid. Its key rides the same `blend-` prefix the modes do and
 *  is decoded the same way: `paintRadialBlendMode` answers null for it,
 *  because 'more' is no BlendMode. */
export const PAINT_RADIAL_BLEND_MORE = 'blend-more';

/** Blend keys ride the option plumbing as `blend-<mode>`. */
export function paintRadialBlendKey(mode: BlendMode): string {
  return `blend-${mode}`;
}

/** The blend mode a picked key names, or null for anything else. */
export function paintRadialBlendMode(key: string): BlendMode | null {
  const m = /^blend-(.+)$/.exec(key);
  return m && m[1] in PAINT_RADIAL_BLEND_ICONS ? (m[1] as BlendMode) : null;
}

/** The Blend fan's children: Normal, the two memory slots
 *  (rememberBlend), and last, always, the More doorway.
 *
 *  More rides at the END, the shape capsule's own place for it: the modes
 *  are what you are choosing between and the doorway is what you do when
 *  none of them is it, so it cannot sit among them. Through it the grid's
 *  whole tail is reachable from the capsule, and whatever is picked there
 *  lands in a memory slot on the way back. */
export function paintRadialBlendChildren(
  recent: PaintRecentBlends = PAINT_RECENT_BLENDS_DEFAULT,
): SliderModeOption[] {
  const modes: BlendMode[] = ['normal', ...recent.slots];
  return [
    ...modes.map((mode) => ({
      key: paintRadialBlendKey(mode),
      icon: PAINT_RADIAL_BLEND_ICONS[mode],
      label: PAINT_RADIAL_BLEND_LABELS[mode],
    })),
    { key: PAINT_RADIAL_BLEND_MORE, icon: 'dots-horizontal', label: 'More' },
  ];
}

/** Which segment the Blend capsule LIGHTS for the mode in force: that
 *  mode's own key when the capsule carries it, else More — the doorway the
 *  mode is behind. Every arming goes through rememberBlend, so the armed
 *  mode is normally on the fan; this keeps the capsule from ever opening
 *  with nothing lit (reading as "no mode armed") if it is not. */
export function paintRadialBlendCurrentKey(
  mode: BlendMode, shown: readonly { key: string }[],
): string {
  const key = paintRadialBlendKey(mode);
  return shown.some((o) => o.key === key) ? key : PAINT_RADIAL_BLEND_MORE;
}

// ── The raster brushes' Brushes option ─────────────────────────────
// Paint, Erase, Blur and Push each carry a paintbrush button on their menu
// that brings the Paint | Erase | Blur | Push capsule back to the top of
// the capsule slot — out from under the selection modes, a swiped-in menu
// or the line group's capsule (where Free Play's line group arms Paint).
// It arms no slider mode: the shell reads the key and claims the slot.

/** The Brushes option's key (EditorShell's onPaintRadialPick). */
export const PAINT_RADIAL_BRUSHES = 'brushes';

/** The Brushes option itself: the Paint tool's own glyph, since it is the
 *  raster group's capsule it calls up. */
export const PAINT_BRUSHES_OPTION: SliderModeOption = {
  key: PAINT_RADIAL_BRUSHES,
  icon: PAINT_MODE_ICON,
  label: 'Brushes',
};

// ── The recolour brush's Eraser option ────────────────────────────
// The Color brush's LAST button (bug report 6b36fe8b): arms the brush to
// cut what it crosses out of the paths under it instead of restaining them
// (vectorEraser.ts). A switch, not a slider mode — the brush keeps its Size
// (the eraser's disc is the brush's own), and a second release on it puts
// the brush back to colouring. The toolbar swatch wears the eraser while it
// is armed, since the brush is laying no colour.

/** The Eraser option's key (EditorShell's onPaintRadialPick). */
export const COLOR_RADIAL_ERASER = 'vector-erase';

export const COLOR_ERASER_OPTION: SliderModeOption = {
  key: COLOR_RADIAL_ERASER,
  icon: 'eraser',
  label: 'Eraser',
};

/** The Color and Blend menu, in fan order: Opacity, Size, Color (the hue
 *  row behind a doorway), Blend (Normal, the two memory slots
 *  `recentBlends` holds, More). Both brushes that blend build theirs from
 *  it minus Color — see {@link brushHasColorRow}, which is where that rule
 *  lives — and the raster brush adds its Brushes door: see
 *  {@link brushSliderModes}. Releasing on Color or Blend only
 *  RAISES its capsule (openOnly): their children confirm a setting, so
 *  the rig menu's pick-the-default-child rule would repaint the brush —
 *  or drop its blend to Normal — the moment the menu opened, and the
 *  capsule would light a choice the user never made. Each capsule opens
 *  lighting what is actually armed instead. */
export function paintSliderModes(
  recentBlends: PaintRecentBlends = PAINT_RECENT_BLENDS_DEFAULT,
): SliderModeOption[] {
  return [
    ...PAINT_SLIDER_MODES,
    {
      key: 'color',
      // The palette: where colours are kept, which is what this doorway
      // opens onto (the hue row). Not the bar's Color TOOL glyph — that is
      // the can, an action on the picture; this is a place to pick from.
      icon: 'palette',
      // A doorway with NO children: its second level is the hue row, which
      // is one control rather than a list of picks, so there is nothing to
      // fan. `openOnly` is what still opens it — a release here must arm
      // no slider mode (the row confirms a colour; picking one is not
      // pointing the bottom slider at anything).
      label: 'Color',
      openOnly: true,
    },
    {
      key: 'blend',
      icon: 'circle-half-full',
      label: 'Blend',
      // A doorway only, like Color: its children CONFIRM a blend mode, so
      // releasing on the parent must not arm one — auto-picking Normal
      // silently dropped whatever blend the stroke had, and the capsule
      // then lit Normal as if the user had chosen it. The capsule opens
      // lighting the mode actually armed (the shell's colorBlendMode).
      openOnly: true,
      children: paintRadialBlendChildren(recentBlends),
    },
  ];
}

/**
 * The slider-mode menu for whichever colour-group brush is in hand — every
 * one of the five raises the lower-right target, each fanning only what it
 * can answer for:
 *  - `color`: Opacity, Size, Blend (paintSliderModes MINUS Color) and,
 *    last, the Eraser switch ({@link COLOR_ERASER_OPTION}). The
 *    recolour brush blends and lands at a strength (createPaintStrokeDraft
 *    hands it all three), and its radius decides how much of a line, a
 *    word or a fill one pass catches — but its ink is picked from the
 *    toolbar swatch it already carries, so the row here would be a second
 *    door to that one setting ({@link brushHasColorRow}).
 *  - `paint`: Opacity, Size, Blend and Brushes. No Color: the colour is
 *    the toolbar swatch's. Blend is the recolour brush's very option — the
 *    spray lands through the same shared mode — so a release on it raises
 *    the same Blend capsule to the top of the slot. The last door is the
 *    way back to the four raster brushes ({@link PAINT_BRUSHES_OPTION}).
 *  - `erase` / `blur`: Opacity, Size and Brushes. Their strength IS the
 *    shared opacity value, reached through the same Opacity mode instead
 *    of a second slider row of its own.
 *  - `push`: Size and Brushes — how hard it pushes is an app setting
 *    (rigPushStrength), not a per-stroke opacity.
 *  - anything else: Size alone.
 */
export function brushSliderModes(
  tool: string | null,
  recentBlends: PaintRecentBlends = PAINT_RECENT_BLENDS_DEFAULT,
): SliderModeOption[] {
  if (brushBlends(tool)) {
    const menu = paintSliderModes(recentBlends).filter((o) => o.key !== 'color');
    return tool === 'paint' ? [...menu, PAINT_BRUSHES_OPTION] : [...menu, COLOR_ERASER_OPTION];
  }
  const size = PAINT_SLIDER_MODES.filter((o) => o.key === 'size');
  if (tool === 'erase' || tool === 'blur') {
    return [...PAINT_SLIDER_MODES, PAINT_BRUSHES_OPTION];
  }
  if (tool === 'push') return [...size, PAINT_BRUSHES_OPTION];
  return size;
}

/** Whether a brush's menu carries the COLOR doorway — the hue row behind
 *  it. No brush's does today (see {@link brushSliderModes}); kept as the
 *  one question the shell asks, so the row's capsule can never outlive an
 *  option that opens it. Derived from the menu rather than a second list of tool ids, so the
 *  capsule that row lives in can never outlive the option that opened it
 *  (the same shape as {@link brushHasOpacity}).
 *
 *  The RECOLOUR brush's does not. Its colour is already on the toolbar, one
 *  press away, wearing the ink in hand — and that swatch does more than the
 *  row can: with something selected its confirm colours the thing outright.
 *  A second door to the one setting, a flick from the first, is how two
 *  homes for a setting start disagreeing. The raster brush keeps the row:
 *  its own bar slot is the paint MODE (spray, erase, blur, push), so the
 *  radial is where its colour is reached from. */
export function brushHasColorRow(tool: string | null): boolean {
  return brushSliderModes(tool).some((o) => o.key === 'color');
}

/** Whether a brush's dabs BLEND with the paint under them — the recolour
 *  brush and the raster spray, which both land through the shared blend
 *  mode. It is also exactly the brushes whose menu carries the Blend fan
 *  ({@link brushSliderModes} builds the fan from this answer), so the
 *  hosts ask it to know whether the Blend capsule can be up for the tool
 *  in hand at all — a capsule can never outlive the menu that raised it —
 *  and the corner badge and the swatch's rainbow ring ride it too. */
export function brushBlends(tool: string | null): boolean {
  return tool === 'color' || tool === 'paint';
}

/** Whether a brush has a per-stroke opacity for the slider to drive —
 *  asked of the menu itself rather than a second list of tool ids, so the
 *  row the target swaps to and the option it swaps from can never
 *  disagree. False for push alone, whose strength is an app setting. */
export function brushHasOpacity(tool: string | null): boolean {
  return brushSliderModes(tool).some((o) => o.key === 'opacity');
}

/** The row's name for the active mode — searched through the second level
 *  too, since the selected mode is a LEAF (a parent is only a doorway). */
export function sliderModeLabel(options: readonly SliderModeOption[], key: string): string {
  for (const o of options) {
    if (o.key === key) return o.label;
    const child = o.children?.find((c) => c.key === key);
    if (child) return child.label;
  }
  return options[0].label;
}

/** Whether a LEVEL-1 button stands for the active mode: itself, or any of
 *  its actual children. Structural, not a key-prefix test — a child may
 *  shape a DIFFERENT part than the fan it hangs in (the Turn fan carries
 *  the spine's moves), so a leaf's key can't be trusted to wear its
 *  parent's. */
export function sliderModeIsActive(option: SliderModeOption, activeKey: string): boolean {
  return activeKey === option.key
    || !!option.children?.some((c) => c.key === activeKey);
}

// ── The second level as a CAPSULE menu ──────────────────────────────
// The child fans are retired: a release on a parent option opens its
// second level as a floating capsule instead (ToolModeCapsule's chrome) —
// at the top of the screen in the tool groups' own slot for the paint and
// tile menus, under the Left/Right pill for the rig's. These two helpers
// are the pure model the hosts render from.

/** The LEVEL-1 option whose second level the active key lives in — the
 *  family whose children the capsule shows. Null when the active key names
 *  a childless root (nothing to fan; no capsule). */
export function sliderModeFamily(
  options: readonly SliderModeOption[], activeKey: string,
): SliderModeOption | null {
  const o = options.find((opt) => sliderModeIsActive(opt, activeKey));
  return o?.children ? o : null;
}

/** One capsule segment: a word, a GLYPH, a color disc, or a tile's own
 *  art. */
export interface SliderModeCapsuleOption {
  key: string;
  label: string;
  /** A MaterialCommunityIcons glyph drawn in the word's place — set only
   *  for a child that asked (SliderModeOption.capsuleIcon). The label
   *  stays, and serves accessibility. */
  icon?: string;
  color?: RGBColor;
  uri?: string;
  /** The art the segment draws while LIT instead — a bake that reads on
   *  the lit segment's ground (the tile capsule's white over blue). */
  activeUri?: string;
  rotate?: number;
}

/** A parent's children as the capsule's segments — the same keys the
 *  radial plumbing decodes, so one pick handler serves fan and capsule. */
export function sliderModeCapsuleOptions(
  options: readonly SliderModeOption[], parentKey: string,
): SliderModeCapsuleOption[] {
  const parent = options.find((o) => o.key === parentKey);
  return (parent?.children ?? []).map(({ key, label, icon, capsuleIcon, color, uri, rotate }) => ({
    key,
    label,
    // The glyph rides only where the child asked for it: every other
    // capsule in the app is words, and a fan's icons are the fan's.
    ...(capsuleIcon ? { icon } : {}),
    ...(color ? { color } : {}),
    ...(uri ? { uri } : {}),
    ...(rotate ? { rotate } : {}),
  }));
}

/** The glyph the target circle wears: the active mode's LEVEL-1 icon —
 *  a child mode shows its parent's (the ring is small, and the family is
 *  the readable thing at that size). Unknown keys fall back to the first
 *  option, like sliderModeLabel. */
export function sliderModeIcon(
  options: readonly SliderModeOption[], activeKey: string,
): string {
  return options.find((o) => sliderModeIsActive(o, activeKey))?.icon ?? options[0].icon;
}
