// ─── Backgrounds ───
export const BG_BLACK = '#000000';
export const BG_NEAR_BLACK = '#0B0B0B';
export const BG_DARK = '#111111';
export const BG_SURFACE = '#181818';
export const BG_SURFACE_ALT = '#1a1a1a';
export const BG_ELEVATED = '#1f1f1f';
export const BG_HEADER = '#2a2a2a';
export const BG_RAISED = '#3a3a3a';
export const BG_RAISED_ALT = '#3f3f3f';
export const BG_BUTTON_SECONDARY = '#4a4a4a';
export const BG_DARK_NAVY = '#000835';
export const BG_MODAL = '#444444';
export const BG_MODAL_ACTIVE = '#1a3a4a';
export const BG_ERROR = '#1a1a2e';
export const BG_COMPOSITION_SELECTED = '#1a2a3a';
export const BG_SEPARATOR = '#333333';

/**
 * The canvas's light base — the grey the grid is drawn on, in both the
 * composition editor and the figure editor. One definition rather than the
 * literal repeated at each site: the GL passes want it as a 0..1 triple, and
 * anything drawing a canvas-colored surface outside GL (an export's backdrop,
 * a DOM well) wants the hex.
 */
export const CANVAS_BASE_GREY = '#D9D9D9';
export const CANVAS_BASE_GREY_RGB = { r: 0xd9, g: 0xd9, b: 0xd9 } as const;
export const CANVAS_BASE_GREY_GL: readonly [number, number, number] =
  [0xd9 / 255, 0xd9 / 255, 0xd9 / 255];

// ─── Text ───
export const TEXT_PRIMARY = '#ffffff';
export const TEXT_SECONDARY = '#e5e5e5';
export const TEXT_TERTIARY = '#e0e0e0';
export const TEXT_LIGHT = '#dddddd';
export const TEXT_MUTED = '#9ca3af';
export const TEXT_DIM = '#6b7280';
export const TEXT_FAINT = '#aaaaaa';
export const TEXT_DISABLED = '#cccccc';
export const TEXT_SUBTLE = '#bbbbbb';
export const TEXT_BORDER_LIGHT = '#d1d5db';
export const TEXT_DARK = '#666666';
export const TEXT_FALLBACK = '#888888';

// ─── Accents ───
export const ACCENT_PRIMARY = '#38BDF8';
export const ACCENT_SECONDARY = '#38BDF8';
export const ACCENT_OUTLINE = '#38BDF8';
export const ACCENT_CYAN = '#38BDF8';
export const ACCENT_BLUE = '#38BDF8';
export const ACCENT_INDIGO = '#6366F1';
export const ACCENT_VIOLET = '#A78BFA';

// ─── Interactive States ───
export const STATE_ACTIVE = ACCENT_PRIMARY;
export const STATE_INACTIVE = 'rgba(42, 42, 42, 0.8)';
export const STATE_INACTIVE_TEXT = '#aaaaaa';
export const STATE_DISABLED = 'rgba(42, 42, 42, 0.35)';
export const STATE_DISABLED_TEXT = '#555555';

// ─── Success ───
export const SUCCESS_GREEN = '#22C55E';

// ─── Error / Destructive ───
export const ERROR_PRIMARY = '#ef4444';
// The light/dark/darker gradation was intentionally flattened; these are
// aliases of ERROR_PRIMARY kept for API stability.
export const ERROR_LIGHT = ERROR_PRIMARY;
export const ERROR_DARK = ERROR_PRIMARY;
export const ERROR_DARKER = ERROR_PRIMARY;

// ─── Overlays ───
export const OVERLAY_LIGHT = 'rgba(0, 0, 0, 0.6)';
export const OVERLAY_MEDIUM = 'rgba(0, 0, 0, 0.7)';
export const OVERLAY_HEAVY = 'rgba(0, 0, 0, 0.85)';
export const OVERLAY_75 = 'rgba(0, 0, 0, 0.75)';

// ─── White Transparency ───
export const WHITE_5 = 'rgba(255, 255, 255, 0.05)';
export const WHITE_10 = 'rgba(255, 255, 255, 0.1)';
export const WHITE_15 = 'rgba(255, 255, 255, 0.15)';
export const WHITE_20 = 'rgba(255, 255, 255, 0.2)';
export const WHITE_25 = 'rgba(255, 255, 255, 0.25)';
export const WHITE_30 = 'rgba(255, 255, 255, 0.3)';
export const WHITE_40 = 'rgba(255, 255, 255, 0.4)';
export const WHITE_50 = 'rgba(255, 255, 255, 0.5)';
export const WHITE_60 = 'rgba(255, 255, 255, 0.6)';
export const WHITE_70 = 'rgba(255, 255, 255, 0.7)';
export const WHITE_90 = 'rgba(255, 255, 255, 0.9)';

// ─── Accent Transparency ───
export const ACCENT_PRIMARY_12 = 'rgba(56, 189, 248, 0.12)';
export const ACCENT_PRIMARY_15 = 'rgba(56, 189, 248, 0.15)';
export const ACCENT_PRIMARY_25 = 'rgba(56, 189, 248, 0.25)';
export const ACCENT_PRIMARY_60 = 'rgba(56, 189, 248, 0.6)';
export const ACCENT_SECONDARY_15 = 'rgba(56, 189, 248, 0.15)';

// ─── Selection ───
export const SELECTION_CYAN = '#38BDF8';
export const SELECTION_ORANGE = '#FFA032';

// ─── Layer Level Colors ───
export const LEVEL_COLORS_SIDE: Record<number, string> = {
  0: '#38BDF8',
  1: '#38BDF8',
  2: '#2680BE',
  3: '#164583',
  4: '#000835',
  5: '#6D28D9',
  6: '#4C1D95',
};

export const LEVEL_COLORS_PANEL: Record<number, string> = {
  0: '#38BDF8',
  1: '#38BDF8',
  2: '#2680BE',
  3: '#164583',
  4: '#000835',
  5: '#6D28D9',
  6: '#4C1D95',
};

export const LEVEL_COLORS_CAPSULE: Record<number, string> = {
  0: '#38BDF8',
  1: '#38BDF8',
  2: '#2680BE',
  3: '#164583',
  4: '#000835',
  5: '#6D28D9',
  6: '#4C1D95',
};

// ─── Pattern ───
export const PATTERN_ACTIVE = '#FFA032';
export const PATTERN_INACTIVE = '#2a3a2a';
export const PATTERN_ARCHIVED = '#2a3a4a';
export const PATTERN_ERROR_BG = '#442222';

// ─── Borders ───
export const BORDER_BLUE_GRAY = '#4b5563';
export const BORDER_DARK_GRAY = '#374151';
export const BORDER_DARK = 'rgb(32, 34, 38)';
export const PALETTE_SEPARATOR = '#C4C8D0';

// ─── Miscellaneous ───
export const BANNER_GRAY = 'rgba(180, 180, 180, 0.5)';
export const BANNER_WARNING = 'rgba(255, 160, 50, 0.25)';
export const SURFACE_GRAY = 'rgb(62, 66, 72)';
