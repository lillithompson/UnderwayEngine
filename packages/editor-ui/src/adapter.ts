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

export interface ObjectPropertiesModel {
  visible: boolean;
  mode?: 'single' | 'multi' | 'group';
  /** Show the Edit action (editable text selected). */
  showEdit: boolean;
  locked: boolean;
  onEdit(): void;
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
