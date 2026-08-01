// The generic scene-graph adapter for @underway/editor-ui.
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
}

/** Everything the Scene Outline needs, and nothing app-specific. */
export interface SceneOutlineModel {
  objects: ReadonlyMap<string, OutlineObject>;
  /** Back→front paint order (engine `sceneOrder` semantics). */
  sceneOrder: readonly string[];
  selectedIds: ReadonlySet<string>;

  onSelect(id: string): void;
  /** Commit a drag-reorder. Receives the full rewritten back→front order. */
  onReorder(newSceneOrder: string[]): void;
  onRename(id: string, newName: string): void;
  onToggleLock(id: string): void;
  onToggleHidden(id: string): void;
  /** Double-tap / double-click a row. The app frames the object (camera
   *  math stays app-side). */
  onFrame(id: string): void;
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

export interface TopBarTool {
  id: string;
  /** MaterialCommunityIcons glyph name (ignored when swatchColor is set). */
  icon: string;
  active: boolean;
  /** When present the tool renders as a live color swatch (color tool). */
  swatchColor?: RGBLike;
}

export interface TopBarModel {
  label: string;
  /** Opens the scene outline (tap the title). Optional — Facet may unset. */
  onLabelPress?: () => void;
  tools: TopBarTool[];
  onBack(): void;
  onSelectTool(id: string): void;
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

export interface ObjectPropertiesModel {
  visible: boolean;
  mode?: 'single' | 'multi' | 'group';
  /** Show the Edit action (editable text selected). */
  showEdit: boolean;
  /** Show the Edit action for an image: pressing it slides the image-edit
   *  sub-panel (replace / tint / round / crop) in over the bar instead of
   *  invoking onEdit. Text vs image are mutually exclusive per selection. */
  showImageEdit?: boolean;
  locked: boolean;
  onEdit(): void;
  /** Image-edit sub-panel actions (surfaced only when showImageEdit). Each
   *  is optional so apps can land the UI ahead of the edits themselves. */
  onReplaceImage?(): void;
  onTintImage?(): void;
  onCropImage?(): void;
  onGlowImage?(): void;
  /** Whether the Shadow controls are shown. App-owned so a tap-off dismisses
   *  them before the panel (same as the Border bar). */
  shadowOpen?: boolean;
  onShadowOpenChange?(open: boolean): void;
  /** The selected image's current shadow (defaults supplied by the app when
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
  /** Selected image's current corner rounding, a fraction (0–0.5) of the
   *  shorter side — seeds the Border panel's Radius slider. */
  cornerRadius?: number;
  /** Radius-slider callback: `radius` is a 0–0.5 fraction of the shorter side
   *  (0 = sharp, 0.5 = circle for a square). Fires continuously while dragging
   *  with `committed=false` (live preview) and once on release with
   *  `committed=true` (single undo step). Drives the object's own corner
   *  rounding — the Radius row of the Border panel. */
  onCornerRadius?(radius: number, committed: boolean): void;
  onRotate(): void;
  onMirrorH(): void;
  onMirrorV(): void;
  onDuplicate(): void;
  onToggleLock(): void;
  onDelete(): void;
  /** Group-only actions (Facet superset; CozyJournal leaves them unset). */
  onGroup?(): void;
  onUngroup?(): void;
  onJoin?(): void;
  onUnion?(): void;
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
  onOpenViewSettings(): void;
}

// ── Color picker ─────────────────────────────────────────────────────

export interface ColorPickerModel {
  visible: boolean;
  color: RGBLike;
  onChange(color: RGBLike): void;
  onClose(): void;
}
