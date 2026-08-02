// Editor-chrome palette + metrics for @underway/editor-ui. Lifted from
// CozyJournal's web/editor/components/chrome.ts (itself lifted from Facet:
// engine/colors.ts + CompositionEditor header styles + the floating
// UndoRedoPanel / GridQuickActionPanel / AppModal). Kept project-agnostic
// so both apps share one source of truth for the chrome look. Values are
// intentionally Facet-matched — keep in sync with Facet rather than
// re-deriving them per app.

// ── Header (Facet CompositionEditor headerRow) ──
export const HEADER_HEIGHT = 50;
export const TOOLBAR_BUTTON_SIZE = 40;
export const ICON_SIZE = 28;
export const HEADER_BG = '#e5e5e5'; // Facet TEXT_SECONDARY
export const HEADER_INK = '#2a2a2a'; // Facet BG_HEADER — header text/icons
export const STATE_ACTIVE = '#38BDF8'; // Facet ACCENT_PRIMARY
export const STATE_INACTIVE = 'rgba(42, 42, 42, 0.8)';

// ── Floating capsules (Facet UndoRedoPanel / GridQuickActionPanel) ──
export const CAPSULE_SIZE = 44; // Facet COMPACT_BUTTON_SIZE
export const CAPSULE_GAP = 16; // Facet COMPACT_GAP (undo/redo stack)
export const CAPSULE_EDGE_MARGIN = 8;
export const CAPSULE_BG = '#111111'; // Facet BG_DARK
export const WHITE_10 = 'rgba(255, 255, 255, 0.1)';
export const WHITE_25 = 'rgba(255, 255, 255, 0.25)';
export const WHITE_40 = 'rgba(255, 255, 255, 0.4)';
export const WHITE_60 = 'rgba(255, 255, 255, 0.6)';

// ── Object properties panel (Facet ObjectPropertiesPanel) ──
export const PANEL_HEIGHT = 61; // Facet PANEL_HEIGHT (48 button + 4/8 padding + 1 border)
export const PANEL_ANIM_MS = 150; // Facet ANIM_DURATION
export const PANEL_HAIRLINE = '#6b7280'; // Facet TEXT_DIM — top border + dividers
// Every object-property menu — the two-row default panel (actions + type-
// specific options) and each slide-in effect bar (Shadow/Border/Crop/Text) —
// shares this one fixed height so the bottom sheet never jumps as you switch
// between them. Sized to the tallest menu, the Text bar (Font + Weight + Size +
// Character/Line + Align, the last two now sharing a row):
//   1 border + 10 top + 22 header + 10 gap + 180 rows + 14 bottom = 237,
// plus a 3px cushion so font metrics can't clip its last row.
export const OBJECT_MENU_HEIGHT = 240;

// ── Modal surfaces (Facet AppModal / ViewModal) ──
export const MODAL_BG = '#3f3f3f'; // Facet BG_RAISED_ALT
export const MODAL_BORDER = '#1f1f1f'; // Facet BG_ELEVATED
export const MODAL_HEADER_BG = '#2a2a2a'; // Facet BG_HEADER
export const MODAL_RAISED = '#3a3a3a'; // Facet BG_RAISED
export const MODAL_TEXT = '#ffffff'; // Facet TEXT_PRIMARY
export const MODAL_OVERLAY = 'rgba(0, 0, 0, 0.6)'; // Facet OVERLAY_LIGHT

// ── Extra Facet palette entries (engine/colors.ts) used by the rename
//    modal + scene outline, named to match Facet. ──
export const BG_BLACK = '#000000'; // Facet BG_BLACK (rename input well)
export const TEXT_SECONDARY = '#e5e5e5'; // Facet TEXT_SECONDARY
export const TEXT_DIM = '#6b7280'; // Facet TEXT_DIM

// ── Scene outline (Facet SceneOutlinePanel) — values lifted verbatim ──
export const ROW_HEIGHT = 44; // Facet ROW_HEIGHT
export const PANEL_WIDTH = 260; // Facet PANEL_WIDTH (outline slide-in width)
export const OUTLINE_INDENT = 16; // px of left indent per nesting depth
export const OUTLINE_CHEVRON_EXPANDED = 'chevron-down'; // group with visible children
export const OUTLINE_CHEVRON_COLLAPSED = 'chevron-right'; // group with hidden children
export const DRAG_THRESHOLD = 5; // px before a row press becomes a drag
export const DOUBLE_TAP_MS = 300; // second tap within this frames the object
export const OUTLINE_BG = '#3f3f3f'; // Facet BG_RAISED_ALT (panel surface)
export const OUTLINE_BORDER = '#6b7280'; // Facet TEXT_DIM (panel right border)
export const OUTLINE_HAIRLINE = '#555555'; // Facet STATE_DISABLED_TEXT (tab/row dividers)
export const OUTLINE_TAB_ACTIVE = '#38BDF8'; // Facet ACCENT_PRIMARY (active tab underline)
export const OUTLINE_TAB_TEXT = '#6b7280'; // Facet TEXT_DIM (inactive tab)
export const OUTLINE_TAB_TEXT_ACTIVE = '#e5e5e5'; // Facet TEXT_SECONDARY (active tab)
export const OUTLINE_ROW_SELECTED = 'rgba(56, 189, 248, 0.15)'; // Facet ACCENT_PRIMARY_15
export const OUTLINE_ROW_DRAGGING = 'rgba(56, 189, 248, 0.25)'; // Facet ACCENT_PRIMARY_25
export const OUTLINE_TEXT = '#d1d5db'; // Facet TEXT_BORDER_LIGHT (row text)
export const OUTLINE_TEXT_SELECTED = '#38BDF8'; // Facet ACCENT_PRIMARY (selected row text)
export const OUTLINE_ICON = '#6b7280'; // Facet TEXT_DIM (drag handle + inactive toggles)
export const OUTLINE_ICON_ACTIVE = '#e5e5e5'; // Facet TEXT_SECONDARY (active lock/hide)
export const OUTLINE_TEXT_DIM = '#6b7280'; // Facet TEXT_DIM (empty-state text)
export const OUTLINE_CLOSE = '#ffffff'; // Facet TEXT_PRIMARY (close glyph)

/** Default MaterialCommunityIcons glyph for a scene object kind, matching
 *  Facet's SceneOutlinePanel row icons. Apps may override per-object via
 *  OutlineObject.icon (e.g. open vs closed svg paths) or globally via
 *  SceneOutlineModel.iconForKind. */
export function defaultIconForKind(kind: string): string {
  switch (kind) {
    case 'group': return 'group';
    case 'svg': return 'vector-polyline';
    case 'image': return 'image-outline';
    case 'text': return 'format-text';
    case 'figure': return 'drag-horizontal-variant';
    default: return 'drag-horizontal-variant';
  }
}
