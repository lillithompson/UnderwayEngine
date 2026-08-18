// The generic scene-graph adapter for @underway/editor-ui.
//
// Type-only React import (erased at build): the module stays runtime-pure so
// node tests can import it without a renderer.
import type React from 'react';
import type { RigPart, RigSliderKey } from './logic/rigEdit';
//
// The whole point of "project agnostic": components never import engine
// types or touch a CompositionState. They receive a normalized view model
// + callbacks; each app builds the adapter from its own state. New object
// kinds need no change here — `kind` is a free-form string the components
// only use to pick a drag-handle icon (via iconForKind, overridable).

/** A structural RGB color so the package doesn't depend on the engine's
 *  RGBColor. Channels are 0–255. */
export interface RGBLike {
  r: number;
  g: number;
  b: number;
  /** Alpha 0–1, set by the color picker's Opacity slider. OPTIONAL and
   *  omitted when fully opaque, so an opaque color is still `{r,g,b}` —
   *  existing colors, stored state and equality checks are unaffected. Read
   *  it through `colorAlpha` / write it through `withAlpha` (logic/hsv)
   *  rather than touching the field, and render via `rgbCss`, which emits
   *  `rgba(...)` once alpha drops below 1. */
  a?: number;
}

// ── Scene outline ────────────────────────────────────────────────────

/** One row's worth of scene object, normalized. */
export interface OutlineObject {
  id: string;
  /** 'figure' | 'svg' | 'image' | 'text' | 'group' | … — free-form. */
  kind: string;
  /** Already resolved to a display string (never empty). */
  name: string;
  /** Drives group-block collapsing + contiguity in the outline. */
  parentGroupId?: string;
  locked: boolean;
  hidden: boolean;
  /** Optional per-object MCI glyph, overriding iconForKind — lets the app
   *  distinguish cases the kind alone can't (e.g. Facet's open vs closed
   *  svg path → vector-polyline / vector-polygon). */
  icon?: string;
  /** Container chrome (e.g. a frame's internal clip-rect boundary): kept in
   *  the model so it stays in `sceneOrder` on reorder/reparent commits, but
   *  NOT shown as its own outline row. */
  chrome?: boolean;
}

/** Everything the Scene Outline needs, and nothing app-specific. */
export interface SceneOutlineModel {
  objects: ReadonlyMap<string, OutlineObject>;
  /** Back→front paint order (engine `sceneOrder` semantics). */
  sceneOrder: readonly string[];
  selectedIds: ReadonlySet<string>;
  /** Optional display name per group id (e.g. a Figma-style frame's name).
   *  When a collapsed group block's id has an entry here, the row shows that
   *  name instead of the generic "Group (N)". Absent → generic label. */
  groupNames?: ReadonlyMap<string, string>;

  onSelect(id: string): void;
  /** Commit a drag-reorder. Receives the full rewritten back→front order. */
  onReorder(newSceneOrder: string[]): void;
  /** Commit a drag-REPARENT: `nodeId` (leaf or group) moves under
   *  `newParentGroupId` (null = top level); `newSceneOrder` is the recomputed
   *  back→front leaf order. Optional — when unset the outline reorders only
   *  (no reparenting). */
  onReparent?(nodeId: string, newParentGroupId: string | null, newSceneOrder: string[]): void;
  onRename(id: string, newName: string): void;
  onToggleLock(id: string): void;
  onToggleHidden(id: string): void;
  /** Double-tap / double-click a row. The app frames the object (camera
   *  math stays app-side). */
  onFrame(id: string): void;
  /** Press the "Outline" tab header: frame the WHOLE page, the panel-wide
   *  counterpart to double-tapping one row. Optional — without it the header
   *  is inert text, as it was when the tab bar held only a label. */
  onFrameAll?(): void;
  onClose(): void;

  /** Reorder actions surfaced in the RenameModal (Facet parity). Optional —
   *  when unset the modal hides the Bring-to-front / Send-to-back row. */
  onBringToFront?(id: string): void;
  onSendToBack?(id: string): void;

  /** Optional presentation hooks. */
  iconForKind?(kind: string): string; // MCI glyph name
  safeAreaBottom?: number;
  isOpen?: boolean;
}

// ── Top bar ──────────────────────────────────────────────────────────

/** A tool glyph the app supplies itself, for tools MaterialCommunityIcons
 *  has no match for (Facet's line / rectangle / arc / circle). It is rendered
 *  in place of `icon` and receives the same size + active/inactive color the
 *  MCI glyph would have got. */
export type ToolIconComponent = React.ComponentType<{ color: string; size: number }>;

export interface TopBarTool {
  id: string;
  /** MaterialCommunityIcons glyph name (ignored when swatchColor or
   *  IconComponent is set). */
  icon: string;
  active: boolean;
  /** When present the tool renders as a live color swatch (color tool). */
  swatchColor?: RGBLike;
  /** When present it renders instead of the MCI glyph (see above). */
  IconComponent?: ToolIconComponent;
  /** Long press on the button. Facet uses it for sub-mode toggles (line ⇄
   *  rectangle, arc ⇄ circle); it bypasses the press toggle semantics
   *  entirely — the app decides what the hold means. */
  onLongPress?: () => void;
}

export interface TopBarModel {
  label: string;
  /** Opens the scene outline (tap the title). Optional — Facet may unset. */
  onLabelPress?: () => void;
  tools: TopBarTool[];
  onBack(): void;
  /** The tool the press resolves to, or `null` when the press untoggled the
   *  active tool and the app is left with none (see nextToolOnPress). */
  onSelectTool(id: string | null): void;
}

// ── Object properties ────────────────────────────────────────────────

/** Editable drop-shadow, in the app's world-cell units (the panel maps these
 *  to slider positions; the app maps them to the engine's ShadowEffect). */
export interface ShadowModel {
  /** Offset (position) in cells. */
  dx: number;
  dy: number;
  /** Gaussian blur radius in cells. */
  blur: number;
  /** Dilation of the shape before blur, in cells. */
  spread: number;
  color: RGBLike;
  /** 0–1. */
  opacity: number;
}

/** Stroke alignment relative to the node bbox edge. */
export type BorderPosition = 'inside' | 'center' | 'outside';

/** Editable border/stroke, in the app's world-cell units (the panel maps
 *  these to slider positions; the app maps them to the engine's
 *  BorderEffect). Corner rounding is NOT here — it rides the shared
 *  `cornerRadius` / `onCornerRadius` fields (the Border panel's Radius slider
 *  rounds the object itself, folding in the former Round control). */
export interface BorderModel {
  /** Stroke width in cells (0 = no border). */
  width: number;
  /** Stroke alignment vs. the bbox edge. */
  position: BorderPosition;
  /** Dash density 0–10 (0 = solid). */
  dash: number;
  color: RGBLike;
}

/** Which vector subtype the selection is, so the panel can offer the option
 *  set that subtype's menu defines (see `logic/svgEdit`). Mirrors the engine's
 *  `SVGSubtype` without importing it — the package stays engine-agnostic. */
export type SVGSubtypeKind = 'line' | 'arc' | 'rectangle' | 'circle' | 'polygon' | 'shape' | 'stroke';

/** Which edge (or centre line) of a multi-selection's combined box the Layout
 *  bar's align actions push its members to — the horizontal three, then the
 *  vertical three (see `logic/layout`). */
export type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** What sits at one loose end of an open path, and how that end is capped.
 *  Mirror the engine's `SVGEndMarker` / `SVGEndCap` without importing them. */
export type EndMarkerKind = 'none' | 'circle' | 'arrow';
export type EndCapKind = 'round' | 'square';

/** Editable endpoints for an open path (the Endpoints bar). Unlike the engine's
 *  `SVGEndpoints` every field is concrete: the app resolves absent to the
 *  default before handing the model over, so the segmented rows always have a
 *  selection to show. */
export interface EndpointsModel {
  startMarker: EndMarkerKind;
  endMarker: EndMarkerKind;
  startCap: EndCapKind;
  endCap: EndCapKind;
}

/** How an image's bitmap fills its frame (the Crop bar). Mirrors the engine's
 *  ImageFraming without importing it (package stays engine-agnostic). */
export type ImageFramingMode = 'fill' | 'fit' | 'crop' | 'tile';
export type ImageCropRatio = 'free' | 'square' | 'fourFive' | 'sixteenNine';

/** Editable image framing, in the app's world-cell units where lengths apply.
 *  The bar maps its pt/percent slider ranges onto these fields; the app maps
 *  them to the engine's ImageFraming. Per-mode values are remembered together
 *  so switching Mode back restores them. */
export interface FramingModel {
  mode: ImageFramingMode;
  /** Fill zoom: cover-relative scale, 1 (100%) … 3 (300%). */
  zoom: number;
  /** Fit letterbox inset between artwork and frame, in world cells. */
  margin: number;
  /** Crop aspect ratio. */
  ratio: ImageCropRatio;
  /** Crop straighten angle in degrees, −45 … 45. */
  angle: number;
  /** Tile relative size, 0 … 1. */
  tileScale: number;
  /** Tile gap between tiles, in world cells. */
  tileGap: number;
}

/** Named font weight (mirrors the engine's FontWeight without importing it —
 *  the package stays engine-agnostic). */
export type TextWeight = 'light' | 'regular' | 'semibold' | 'bold';
/** Horizontal text alignment (mirrors the engine's TextAlign). */
export type TextHAlign = 'left' | 'center' | 'right';
/** Vertical alignment of the text block within its box (mirrors the engine's
 *  TextVAlign). */
export type TextVAlign = 'top' | 'middle' | 'bottom';

/** One selectable font family for the Text bar's font sheet. */
export interface TextFontOption {
  /** App-owned font id stored on the text node. */
  fontId: string;
  /** Human-facing family name shown in the sheet + pill. */
  label: string;
  /** CSS font-family stack, so the sheet renders each row in its own face. */
  fontFamily?: string;
}

/** Editable text typography, seeding the Text bar. Lengths are the app's
 *  world-cell units; the bar maps its pt/percent slider ranges onto these,
 *  and the app maps them to the engine's TextStyle. */
export interface TextStyleModel {
  fontId: string;
  weight: TextWeight;
  /** Font size in world cells. */
  size: number;
  /** Letter spacing (tracking) in em units. */
  letterSpacing: number;
  /** Line height as a multiple of the font size. */
  lineHeight: number;
  align: TextHAlign;
  /** Vertical alignment of the block within its box height. */
  vAlign: TextVAlign;
  color: RGBLike;
}

/** The gradient tint's fill type (the Tint bar's Type segmented control).
 *  Solid = one flat color; Linear / Radial = a gradient of `stops`. */
export type TintType = 'solid' | 'linear' | 'radial';

/** Compositing mode for the tint layer over the image. The strings are the CSS
 *  `mix-blend-mode` values (and map onto Core Image's blend filters), so the
 *  preview needs no lookup table. This is the design's own 8-mode set — NOT the
 *  engine's generative `BlendMode` (which lacks soft-light / saturation) — so it
 *  stays a package-local union the app maps to its own storage. */
export type TintBlend =
  | 'normal' | 'multiply' | 'darken' | 'lighten'
  | 'soft-light' | 'color' | 'hue' | 'saturation';

/** One gradient stop: a color at a position along the ramp. */
export interface TintStop {
  /** Position along the ramp, 0…1 (the design's 0–100 % ÷ 100). */
  position: number;
  color: RGBLike;
}

/** Editable image tint: a solid / linear / radial overlay composited onto the
 *  image with a blend mode and layer opacity. Distinct from the engine's legacy
 *  shader `tint` (tint/duotone/wash) — this is the design 6a gradient tint. The
 *  non-active fields are kept so switching Type back restores them (a Solid tint
 *  remembers its gradient; a Radial one remembers its angle). */
export interface TintModel {
  type: TintType;
  /** Solid-mode color. */
  solid: RGBLike;
  /** Gradient stops (min 2), used by linear / radial. */
  stops: TintStop[];
  /** Index into `stops` the color picker targets in gradient modes. */
  selectedStop: number;
  /** Linear gradient angle in degrees, 0…360 (90 = top→bottom). */
  angle: number;
  /** Whole-layer opacity 0…1, applied after the blend. */
  opacity: number;
  blend: TintBlend;
}

/** Editable whole-object opacity (the Opacity bar): the object's own render
 *  opacity plus how far its edges soften into transparency. Shared by images
 *  and the closed vector shapes (rectangle / circle — see `svgHasOpacity`). */
export interface OpacityModel {
  /** Whole-object opacity 0…1 (1 = fully opaque). */
  opacity: number;
  /** Edge soften 0…1: 0 = hard edges, 1 = the object fades to transparent
   *  toward its edges. */
  edgeSoften: number;
}

export interface ObjectPropertiesModel {
  visible: boolean;
  /** 'multi' marks a multi-selection: the host applies every edit to ALL
   *  selected objects, the image options drop the single-target actions
   *  (Replace / Crop), and the selection gets a carousel page of its own
   *  (see {@link onAlign}). Default 'single'. */
  mode?: 'single' | 'multi' | 'group';
  /** Show the Edit action (editable text selected): a second-row button that
   *  invokes onEdit to edit the text content. */
  showEdit: boolean;
  /** Selection is an editable image: the panel's second row shows the image-
   *  edit options (replace / tint / crop / shadow / border), Crop/Shadow/Border
   *  opening their effect bar. Text vs image are mutually exclusive. */
  showImageEdit?: boolean;
  /** Show the Type action (editable text selected): a second-row button that
   *  slides the Text bar in over the panel — a two-page carousel of Font
   *  (color / family / weight / size) and Align (character / line spacing /
   *  horizontal + vertical alignment). Sits beside the Edit button (which edits
   *  the content). It also brings the Shadow option, which opens the SAME Drop
   *  Shadow bar an image gets (see `shadow` / `onShadow`). */
  showTextStyle?: boolean;
  /** Selection is a word sticker (magnetic poetry): the panel's second row
   *  shows a single Invert toggle instead of the text typography options. The
   *  sticker's content and typography are fixed, so Edit / Type / Align are
   *  suppressed and this is the only type-specific option. Mutually exclusive
   *  with showTextStyle / showEdit (a sticker sets neither). */
  showInvert?: boolean;
  /** The sticker's current invert state, so the Invert button can reflect it. */
  inverted?: boolean;
  /** Toggle the selected sticker's inverted color scheme (one undo step). */
  onInvert?(): void;
  /** Selection is a paint island — the raster brush's editable-image scene
   *  object. Its ONE type option is Opacity, opening the shared Opacity bar
   *  (opacity + edge soften) through the same `opacityOpen` /
   *  `objectOpacity` / `onObjectOpacity` plumbing images use. No Stroke or
   *  Fill: an island is baked brushwork, not a shape. Mutually exclusive
   *  with the image / svg / text / frame type-option families. */
  showPaintOptions?: boolean;
  /** Selection is an inline tile PATTERN object. Its type options are the
   *  pattern's three pages — Tiles (the connection-grouped tile menu),
   *  Tools (brush arming + grid actions + the border-connections rule) and
   *  Symmetry (the painting-mirror grid) — plus the same Repeat toggle the
   *  legacy tiled vectors wear (via `repeat` / `onToggleRepeat`). Mutually
   *  exclusive with the other type-option families. */
  showPatternOptions?: boolean;
  /** Which pattern bar is open, if any (app-owned, like the effect bars). */
  patternBarOpen?: import('./logic/patternEdit').PatternEditAction | null;
  onPatternBarOpenChange?(bar: import('./logic/patternEdit').PatternEditAction | null): void;
  /** The active symmetry mode's grid key, or 'off' (see patternSymmetryKey). */
  patternSymmetry?: string;
  /** A symmetry mode was picked ('off' clears). One undo step. */
  onPatternSymmetry?(key: string): void;
  /** The tile menu, host-baked (sprite ids + data-URI thumbnails). */
  patternTiles?: import('./logic/patternEdit').PatternTileRow[];
  /** The armed pattern sub-tool, and — when it is 'tile' — which tile. */
  patternTool?: import('./logic/patternEdit').PatternPanelTool;
  patternActiveTileId?: string | null;
  /** Arm a specific tile as the painting sub-tool. */
  onPatternPickTile?(id: string): void;
  /** Arm the random brush / eraser as the painting sub-tool. */
  onPatternArmTool?(tool: 'random' | 'erase'): void;
  /** Run a grid action (flood fills every empty cell with the armed tile —
   *  or random picks when no tile is armed; reconcile heals mismatched
   *  connections; clear empties the grid). One undo step each. */
  onPatternGridAction?(action: import('./logic/patternEdit').PatternGridAction): void;
  /** The pattern's border-connections rule (true = grid edges may
   *  connect), and its toggle (one undo step). */
  patternAllowBorder?: boolean;
  onPatternToggleBorder?(): void;
  /** The tile-set filter (the Tools bar's Sets page): one chip per sprite
   *  family. Off sets are hidden from the Tiles menu and excluded from
   *  Random's picks. App-owned session state, not part of the document. */
  patternTileSets?: import('./logic/patternEdit').PatternTileSetRow[];
  /** Toggle one tile set on/off. The host keeps the LAST enabled set on —
   *  an empty filter would leave Random with nothing to pick. */
  onPatternToggleTileSet?(family: string): void;
  /** Selection is a POSEABLE RIG (a Figgie mannequin). Its type options are
   *  the parts a slider can shape — Rig · Hands · Feet · Spine · Head, plus
   *  Reset — rather than the Stroke / Fill / Opacity a plain vector offers:
   *  a rig's silhouette is baked from its pose, so those three have nothing
   *  to act on. Mutually exclusive with the other type-option families, and
   *  checked BEFORE showSvgOptions (a rig's figure is an svg object).
   *  See `logic/rigEdit.ts`. */
  showRigOptions?: boolean;
  /** Every rig slider's position, 0..1 (see `restRigSliders`). The host owns
   *  these: they are NOT read back from the pose — a hand posed finger by
   *  finger has no single "fistness" — so they rest until touched, and the
   *  host shapes the pose only when one moves. */
  rigSliders?: Record<RigSliderKey, number>;
  /** A rig slider moved: live while dragging (`committed=false`), once on
   *  release (`committed=true`, one undo step). */
  onRigSlider?(key: RigSliderKey, value: number, committed: boolean): void;
  /** Which rig part bar is open, if any (app-owned, like the effect bars). */
  rigPartOpen?: RigPart | null;
  onRigPartOpenChange?(part: RigPart | null): void;
  /** Stand the figure back up: the rest pose, facing front, and every slider
   *  back to its rest position. It sits at the FOOT OF THE RIG BAR — the page
   *  that is already about the figure as a whole — rather than in the options
   *  row: the row is a row of pages to open, and an action wedged among them
   *  opened nothing and lit nothing when pressed.
   *
   *  It is offered here, over the whole figure, and nowhere else. The part
   *  bars deliberately carry no trash of their own: on an effect bar a trash
   *  removes something that was ADDED and leaves the object itself, but every
   *  rig slider is a posture the figure is always in, so a per-bar reset
   *  could only mean "this part back to rest" — and it reset the sliders
   *  nobody had touched along with it, flattening a pair of hands posed
   *  finger by finger. Whole-figure is the one reading with no such trap: it
   *  means what it says, and it is one undo step away. Only rendered when the
   *  host sets it; ignored unless `showRigOptions`. */
  onResetRig?(): void;
  /** Selection is a vector (SVG) object: the panel's second row shows that
   *  subtype's option menu — see `svgSubtype` for which one, and
   *  `SVG_EDIT_OPTIONS` for the options each subtype offers. Mutually
   *  exclusive with the image / text / frame type-options. */
  showSvgOptions?: boolean;
  /** Which vector subtype the selection is, choosing its option menu. Ignored
   *  unless `showSvgOptions`; defaults to 'stroke' when unset. */
  svgSubtype?: SVGSubtypeKind;
  /** Extra "Edit" action prepended to the vector option menu — for vector
   *  objects with an external source editor (e.g. a pattern object baked
   *  from a tile file, whose Edit reopens the tile editor and rebakes).
   *  Only rendered when set; ignored unless `showSvgOptions`. */
  onSvgEdit?(): void;
  /** Extra "Repeat" action in the vector option menu (after Edit) — Facet's
   *  pattern-mode toggle for tile pattern objects: on, the object's bounding
   *  box REPEATS the tile rather than scaling it. Only rendered when
   *  `onToggleRepeat` is set; ignored unless `showSvgOptions`. */
  onToggleRepeat?(): void;
  /** Whether the selection is currently in pattern (repeat) mode, tinting the
   *  Repeat button. Facet's `repeat` prop. */
  repeat?: boolean;
  /** Whether the Stroke bar is shown. App-owned so a tap-off dismisses it
   *  before the panel (same as the Shadow / Border bars). */
  strokeOpen?: boolean;
  onStrokeOpenChange?(open: boolean): void;
  /** The selected vector object's current stroke, seeding the Stroke bar. It
   *  reuses {@link BorderModel} because the Stroke bar IS the Border bar — the
   *  same width / position / dash controls, pointed at the path's own stroke
   *  rather than a rect around its bbox. `color` is the object's own color. */
  stroke?: BorderModel;
  /** The stroke's corner rounding, a 0–0.5 fraction of the shorter bbox side
   *  — the Stroke bar's Radius row, mirroring `cornerRadius` for images. */
  strokeRadius?: number;
  /** Stroke-controls callback: fires live while dragging (`committed=false`)
   *  and once on release (`committed=true`, one undo step). `stroke=null`
   *  resets the object to the composition-wide default stroke. */
  onStroke?(stroke: BorderModel | null, committed: boolean): void;
  /** Radius-row callback, same live/commit contract as `onCornerRadius`. */
  onStrokeRadius?(radius: number, committed: boolean): void;
  /** Open the full-screen color picker for the stroke color (the same picker
   *  the toolbar color tool uses — a vector object's stroke color IS its
   *  color, so this commits through the ordinary color path). */
  onPickStrokeColor?(): void;
  /** Whether the Fill bar is shown. App-owned so a tap-off dismisses it before
   *  the panel (same as the Stroke / Shadow / Border bars). Only reachable from
   *  a subtype whose option menu offers Fill — see `svgHasFill`. */
  svgFillOpen?: boolean;
  onSvgFillOpenChange?(open: boolean): void;
  /** The selected shape's current fill, seeding the Fill bar (defaults supplied
   *  by the app when the shape has none yet). It reuses {@link TintModel}
   *  because the Fill bar IS the Tint bar — the same Type / Stops / Angle /
   *  Opacity / Blend controls, pointed at a closed path's interior rather than
   *  at an overlay over a bitmap. */
  svgFill?: TintModel;
  /** Fill-controls callback, same contract as `onTint`: live while dragging a
   *  stop / slider (`committed=false`), once on release or a structural edit —
   *  Type, stop add/delete, blend pick (`committed=true`, one undo step).
   *  `fill=null` removes the fill, leaving the shape an outline. */
  onSvgFill?(fill: TintModel | null, committed: boolean): void;
  /** Open the full-screen color picker for the fill. Targets the solid color in
   *  Solid mode or `svgFill.stops[svgFill.selectedStop]` in gradient modes; the
   *  app reads the current fill to know which. */
  onPickSvgFillColor?(): void;
  /** Whether the Endpoints bar is shown. App-owned so a tap-off dismisses it
   *  before the panel (same as the Stroke / Fill bars). Only reachable from a
   *  subtype whose option menu offers it — see `svgHasEndpoints`. */
  endpointsOpen?: boolean;
  onEndpointsOpenChange?(open: boolean): void;
  /** The selected path's current endpoints, seeding the bar. The app fills in
   *  the defaults (bare ends, round caps) for a path that has never been given
   *  any, so every field is concrete here. */
  endpoints?: EndpointsModel;
  /** Endpoints callback. Unlike the slider bars there is no live/commit split:
   *  every control is a segmented pick, so each call is one finished edit and
   *  one undo step. `endpoints=null` resets both ends to the defaults. */
  onEndpoints?(endpoints: EndpointsModel | null): void;
  /** Selection is a Figma-style frame: the panel's second row shows the frame
   *  options (background / shadow / border / ungroup), with Shadow / Border
   *  reusing the image effect bars (frame submenu carousel = shadow, border).
   *  Mutually exclusive with the image / text type-options. */
  showFrameOptions?: boolean;
  /** The frame's current background color (its boundary rect fill), shown as a
   *  circular swatch on the Background button. */
  frameBackgroundColor?: RGBLike;
  /** Open the full-screen color picker for the frame background (the same
   *  picker the toolbar color tool uses). */
  onPickFrameBackground?(): void;
  /** Lit state of the common row's Lock button. On a `mode: 'multi'` selection
   *  this must read TRUE ONLY WHEN EVERY MEMBER IS LOCKED: {@link onToggleLock}
   *  locks each member individually, and a partly-locked selection should read
   *  unlocked so one press finishes the job instead of inverting it into a
   *  differently-mixed one. */
  locked: boolean;
  onEdit(): void;
  /** Whether the Tint controls are shown. App-owned so a tap-off dismisses
   *  them before the panel (same as the Shadow / Border bars). */
  tintOpen?: boolean;
  onTintOpenChange?(open: boolean): void;
  /** The selected image's current tint (defaults supplied by the app when none
   *  is set yet), seeding the Tint controls. */
  tint?: TintModel;
  /** Tint-controls callback: fires live while dragging a stop / slider or on a
   *  stop selection (`committed=false`) and once on release / a structural edit
   *  — Type, stop add/delete, blend pick (`committed=true`, one undo step).
   *  `tint=null` removes the tint layer. */
  onTint?(tint: TintModel | null, committed: boolean): void;
  /** Open the full-screen color picker for the tint. It targets the solid color
   *  in Solid mode or `tint.stops[tint.selectedStop]` in gradient modes; the app
   *  reads the current tint to know which. */
  onPickTintColor?(): void;
  /** Whether the Shadow controls are shown. App-owned so a tap-off dismisses
   *  them before the panel (same as the Border bar). Offered by images, frames
   *  AND text — the one effect bar all three share. */
  shadowOpen?: boolean;
  onShadowOpenChange?(open: boolean): void;
  /** The selected object's current shadow (defaults supplied by the app when
   *  none is set yet), seeding the Shadow controls. */
  shadow?: ShadowModel;
  /** Shadow-controls callback: fires live while dragging (`committed=false`)
   *  and once on release (`committed=true`, one undo step). `shadow=null`
   *  removes the shadow. */
  onShadow?(shadow: ShadowModel | null, committed: boolean): void;
  /** Open the full-screen color picker for the shadow color (the same picker
   *  the top-toolbar color tool uses). */
  onPickShadowColor?(): void;
  /** Whether the Border controls are shown. App-owned so a tap-off dismisses
   *  them before the panel (same as the Shadow bar). */
  borderOpen?: boolean;
  onBorderOpenChange?(open: boolean): void;
  /** The selected image's current border (defaults supplied by the app when
   *  none is set yet), seeding the Border controls. */
  border?: BorderModel;
  /** Border-controls callback: fires live while dragging (`committed=false`)
   *  and once on release (`committed=true`, one undo step). `border=null`
   *  removes the border. */
  onBorder?(border: BorderModel | null, committed: boolean): void;
  /** Open the full-screen color picker for the border color. */
  onPickBorderColor?(): void;
  /** Whether the Crop / framing controls are shown. App-owned so a tap-off
   *  dismisses them before the panel (same as the Shadow / Border bars). */
  cropOpen?: boolean;
  onCropOpenChange?(open: boolean): void;
  /** The selected image's current framing (defaults supplied by the app when
   *  none is set yet), seeding the Crop controls. */
  framing?: FramingModel;
  /** Framing callback: fires live while dragging (`committed=false`) and once
   *  on release (`committed=true`, one undo step). */
  onFraming?(framing: FramingModel, committed: boolean): void;
  /** Reset framing to its defaults + original mode. One undo step; the bar
   *  stays open. No longer surfaced by the Crop bar (its trash was removed);
   *  kept for hosts that drive a framing reset from elsewhere. */
  onResetFraming?(): void;
  /** The selected image's source resolution in pixels, shown as an
   *  informational line at the bottom of the Crop bar. Omitted (or
   *  non-positive) when the host doesn't know it — the line is then hidden. */
  imagePixelSize?: { width: number; height: number };
  /**
   * Swap the selected image's pixels for a newly picked file, keeping the
   * node, its box and its place in the scene. Surfaced as the Crop bar's
   * Replace action; absent → the row is not offered.
   *
   * The host opens a file picker here, so it MUST be called straight out of
   * the press: WebKit only shows the dialog while the gesture's activation
   * is still live, and anything awaited first loses it.
   */
  onReplaceImage?(): void;
  /** Selected image's current corner rounding, a fraction (0–0.5) of the
   *  shorter side — seeds the Border panel's Radius slider. */
  cornerRadius?: number;
  /** Radius-slider callback: `radius` is a 0–0.5 fraction of the shorter side
   *  (0 = sharp, 0.5 = circle for a square). Fires continuously while dragging
   *  with `committed=false` (live preview) and once on release with
   *  `committed=true` (single undo step). Drives the object's own corner
   *  rounding — the Radius row of the Border panel. */
  onCornerRadius?(radius: number, committed: boolean): void;
  /** Whether the Opacity bar is shown. App-owned so a tap-off dismisses it
   *  before the panel (same as the other effect bars). Offered by images and
   *  the closed vector shapes (see `svgHasOpacity`). */
  opacityOpen?: boolean;
  onOpacityOpenChange?(open: boolean): void;
  /** The selection's current opacity + edge soften, seeding the Opacity bar.
   *  The app resolves absent to the defaults (fully opaque, hard edges) so
   *  both sliders always have a position to show. */
  objectOpacity?: OpacityModel;
  /** Opacity-bar callback: fires live while dragging (`committed=false`) and
   *  once on release (`committed=true`, one undo step). */
  onObjectOpacity?(opacity: OpacityModel, committed: boolean): void;
  /** Whether the Text styling bar is shown. App-owned so a tap-off dismisses
   *  it before the panel (same as the image effect bars). */
  textStyleOpen?: boolean;
  onTextStyleOpenChange?(open: boolean): void;
  /** The selected text's current typography, seeding the Text bar. */
  textStyle?: TextStyleModel;
  /** Font families offered by the Text bar's font sheet (app-owned). */
  fonts?: readonly TextFontOption[];
  /** Text-style callback: fires live while dragging (`committed=false`) and
   *  once on release / segment change (`committed=true`, one undo step). */
  onTextStyle?(style: TextStyleModel, committed: boolean): void;
  /** Open the full-screen color picker for the text color (same picker the
   *  toolbar color tool uses). */
  onPickTextColor?(): void;
  /** Reset type settings (size / character / line / weight) to defaults,
   *  keeping the font family and color. One undo step; the bar stays open.
   *  No longer surfaced by the Text bar (its trash was removed); kept for
   *  hosts that drive a type reset from elsewhere. */
  onResetTextStyle?(): void;
  /** Whether the Layout bar is shown. App-owned so a tap-off dismisses it
   *  before the panel (same as the Shadow / Border bars). Only reachable from
   *  a multi-selection — see `onAlign`. */
  layoutOpen?: boolean;
  onLayoutOpenChange?(open: boolean): void;
  /** Align every selected object to one edge (or the centre line) of the
   *  selection's combined box. Supplying this puts a Layout option on the
   *  selection's own page of a `mode: 'multi'` panel (the third carousel page,
   *  Layout · Group · Merge) and a Layout page in its submenu carousel; leave
   *  it unset and neither appears.
   *
   *  That page is what a MIXED multi-selection gets instead of a type page:
   *  aligning asks nothing of the members but their boxes, so unlike Tint /
   *  Stroke / Type it doesn't need them to share a kind. Like the Endpoints
   *  bar's picks there is no live/commit split — each call is one finished
   *  move and one undo step. */
  onAlign?(edge: AlignEdge): void;
  /** Lay every selected object out as a grid, anchored at the top-left of the
   *  selection's combined box, and set each one to identity rotation — a grid
   *  reads as a grid only if its members are upright. Supplying this adds an
   *  Arrange row to the Layout bar; leave it unset and the bar keeps its two
   *  align rows only. Like {@link onAlign}, one call is one finished edit and
   *  one undo step — the un-rotation rides along in it. */
  onGrid?(): void;
  onRotate(): void;
  onMirrorH(): void;
  onMirrorV(): void;
  onDuplicate(): void;
  onToggleLock(): void;
  onDelete(): void;
  /** Structural actions (Facet superset; CozyJournal leaves Ungroup / Join
   *  unset outside frames).
   *
   *  Group and {@link onMerge} belong to the SELECTION rather than to what it
   *  is made of, like {@link onAlign}: supplying either on a `mode: 'multi'`
   *  selection puts a word option on the selection's own carousel page —
   *  Layout · Group · Merge — instead of an icon in the common row. Neither
   *  opens a bar; one press is one finished edit and one undo step. On a
   *  single selection Group stays a common-row icon.
   *
   *  `onUnion` is the BOOLEAN union — the region operation whose family is
   *  union / difference / intersect / exclude. It is not Merge and never
   *  shares its page; it stays a common-row icon wherever a host supplies it. */
  onGroup?(): void;
  /** Dissolve the selected group. Where it renders depends on the selection:
   *  a frame puts it in its own type options, and a `mode: 'multi'` selection
   *  that IS a group gets it as a TYPE option too — closing whatever its
   *  members share, or standing as the whole type row when they share nothing.
   *  A host that supplies this for a multi-selection should stop supplying
   *  {@link onGroup} for it: binding a selection that is already bound is a
   *  press that does nothing. */
  onUngroup?(): void;
  onJoin?(): void;
  onUnion?(): void;
  /** Flatten the selected objects into ONE object (`mode: 'multi'` only): one
   *  row in the scene outline where there were several, selecting and
   *  transforming as a single thing. Structural, not geometric — it asks
   *  nothing of the members' shapes, which is what separates it from
   *  {@link onUnion}. Supplying it puts Merge on the selection's page. */
  onMerge?(): void;
}

// ── Brush controls ───────────────────────────────────────────────────

export interface BrushControlsModel {
  /** Up while a raster brush (paint / erase / blur) is armed. The panel
   *  animates itself in (small bounce) and out on this flag, so hosts just
   *  flip it — it occupies the bottom-center strip the object-properties
   *  panel uses, and the host hides that panel while this is up. */
  visible: boolean;
  /** Size handle position, 0 (smallest) – 1 (largest). The host owns the
   *  mapping onto an actual brush radius; the control is just a picker. */
  size: number;
  /** Strength handle position, 0 (nothing lands) – 1 (full deposit) — how
   *  much paint a dab lays down, how much the eraser lifts, how far a blur
   *  step carries. Read straight as the stroke's opacity. */
  strength: number;
  /** Draw the Strength row at all. Default (omitted) is yes; pass false for
   *  a brush whose strength is already on screen somewhere else, so the
   *  panel is one slider tall instead of two. Size keeps its place either
   *  way — the stack stands on the bottom edge, so the row that goes is the
   *  one above. */
  showStrength?: boolean;
  /** Both fire live while dragging (and once on a tap). No commit variants —
   *  brush settings are tool state, not undoable document edits. */
  onSize(value: number): void;
  onStrength(value: number): void;
}

// ── Undo / redo ──────────────────────────────────────────────────────

export interface UndoRedoModel {
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
}

// ── Grid / view settings ─────────────────────────────────────────────

export interface GridViewModel {
  /** Current grid level; apps that hide grid controls can omit. */
  gridLevel?: number;
  onSetGridLevel?(level: number): void;
  /** Whether snap-to-grid is currently on, inverting the snap capsule. Ignored
   *  unless `onToggleGridSnap` is set. */
  gridSnap?: boolean;
  /** Flip snap-to-grid. The same app preference the settings screen's "Grid
   *  Snap" row drives — this is the on-canvas shortcut to it. Optional: an app
   *  that only exposes snap in its settings omits it and gets no capsule. */
  onToggleGridSnap?(): void;
}

// ── Color picker ─────────────────────────────────────────────────────

export interface ColorPickerModel {
  visible: boolean;
  color: RGBLike;
  /** A committed color change: a swatch tap, or the release of an Opacity
   *  drag. One call = one undo step. The color carries the picker's current
   *  alpha (see {@link RGBLike.a}), so a host that stores `{r,g,b}` verbatim
   *  keeps the opacity with the color and needs no separate channel. */
  onChange(color: RGBLike): void;
  onClose(): void;
  /** Uncommitted color, fired continuously while the Opacity slider is
   *  dragged, so the canvas can track the drag. Hosts that fold every change
   *  into the undo stack should leave this unset: the picker previews the drag
   *  itself and only reports it via `onChange` on release. */
  onPreview?(color: RGBLike): void;
  /** Show the Opacity slider (default true). Set false where the target can't
   *  carry a per-color alpha, so the picker doesn't offer a control the host
   *  would have to discard. */
  showOpacity?: boolean;
  /** Tap on the picker's eyedropper swatch (Facet parity). The host closes the
   *  picker and enters eyedropper mode — arming its canvas for sampling and
   *  rendering {@link EyedropperOverlay} over it, whose dismissal commits the
   *  sampled color. Unset → no eyedropper swatch.
   *
   *  Sampling reads opaque canvas pixels, so commit the sample through
   *  `withAlpha(sampled, colorAlpha(previous))` — the eyedropper is picking a
   *  hue off the canvas, not resetting the opacity the slider set. */
  onEyedropper?(): void;
}
