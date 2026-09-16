// ── Web → Native messages ────────────────────────────────────────────

export interface ShareFileMessage {
  type: 'SHARE_FILE';
  payload: {
    data: string;       // base64-encoded file content
    filename: string;
    mimeType: string;
    uti?: string;
  };
}

export interface ImportFileMessage {
  type: 'IMPORT_FILE';
  payload: {
    accept: string;     // file type filter, e.g. '.facet,application/json'
  };
}

export interface ImportBinaryFileMessage {
  type: 'IMPORT_BINARY_FILE';
  payload: {
    accept: string;     // file type filter, e.g. '.tile'
  };
}

export interface HapticFeedbackMessage {
  type: 'HAPTIC_FEEDBACK';
  payload: {
    style: 'light' | 'medium' | 'heavy' | 'selection';
  };
}

export interface AudioFeedbackMessage {
  type: 'AUDIO_FEEDBACK';
  payload: {
    sound: 'click' | 'longPress' | 'swipe';
    /** Playback volume, 0..1. Defaults to 1 (full) if omitted. */
    volume?: number;
  };
}

export interface SaveToCameraRollMessage {
  type: 'SAVE_TO_CAMERA_ROLL';
  payload: {
    data: string;       // base64-encoded PNG
    filename: string;
  };
}

export interface ReadyMessage {
  type: 'READY';
}

export interface LogMessage {
  type: 'LOG';
  payload: {
    level: 'log' | 'warn' | 'error';
    tag: string;
    text: string;
  };
}

export interface ResumeHealthPongMessage {
  type: 'RESUME_HEALTH_PONG';
  payload: { nonce: string };
}

/**
 * "Which page am I for?" — asked by a page loaded WITHOUT its query, so
 * that the bundle (megabytes of it) can be fetched and parsed while the
 * host is still working out what to open.
 *
 * The host answers with NAVIGATE_TO, and answers only if it has a route
 * the page does not already have. The two are a handshake rather than a
 * push precisely because either order is possible: a NAVIGATE_TO sent
 * before the page registered its bridge handler is dropped on the floor
 * (injectedJavaScriptBeforeContentLoaded's __onNativeMessage no-ops until
 * then), and a page that asks before the host knows gets its answer from
 * the host's own route change. One of the two always lands.
 */
export interface RouteRequestMessage {
  type: 'ROUTE_REQUEST';
}

/**
 * Generic app-defined event, in BOTH directions. The shell stays
 * app-agnostic: `kind`/`data` semantics belong to the consuming app. Web →
 * native, the app registers a handler via `setAppEventHandler`
 * (nativeBridge); native → web, that handler's `reply` sends one back, and
 * the web listens with `onAppEvent` (webBridge). Used for navigation
 * intents, state pushes to the native chrome, and the small answers those
 * pushes need first (what the native cache already holds).
 */
export interface AppEventMessage {
  type: 'APP_EVENT';
  payload: {
    kind: string;
    data?: unknown;
  };
}

export type WebToNativeMessage =
  | ShareFileMessage
  | ImportFileMessage
  | ImportBinaryFileMessage
  | HapticFeedbackMessage
  | AudioFeedbackMessage
  | SaveToCameraRollMessage
  | ReadyMessage
  | LogMessage
  | ResumeHealthPongMessage
  | RouteRequestMessage
  | AppEventMessage;

// ── Native → Web messages ────────────────────────────────────────────

export interface FileImportedMessage {
  type: 'FILE_IMPORTED';
  payload: {
    name: string;
    content: string;    // raw text content of the file
  };
}

export interface BinaryFileImportedMessage {
  type: 'BINARY_FILE_IMPORTED';
  payload: {
    name: string;
    data: string;       // base64-encoded binary content
  };
}

export interface BinaryFileImportFailedMessage {
  type: 'BINARY_FILE_IMPORT_FAILED';
  payload: {
    error: string;
    // Stage breadcrumb so the toast tells us which step in the bridge
    // chain blew up — primary diagnostic for the silent-import bug.
    stage: 'launch-picker' | 'no-asset' | 'copy' | 'base64' | 'send' | 'unknown';
  };
}

export interface SafeAreaInsetsMessage {
  type: 'SAFE_AREA_INSETS';
  payload: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
}

export interface AppStateMessage {
  type: 'APP_STATE';
  payload: {
    state: 'active' | 'background';
  };
}

export interface CameraRollResultMessage {
  type: 'CAMERA_ROLL_RESULT';
  payload: {
    success: boolean;
    error?: string;
  };
}

export interface ShareResultMessage {
  type: 'SHARE_RESULT';
  payload: {
    success: boolean;
    error?: string;
  };
}

export interface ResumeHealthPingMessage {
  type: 'RESUME_HEALTH_PING';
  payload: { nonce: string };
}

/**
 * Show THIS query instead, without reloading the page — the answer to
 * ROUTE_REQUEST, and the way a host re-points a WebView it is keeping
 * rather than rebuilding. `search` is a URL query string, leading '?'
 * and all, exactly as `urlSuffix` gives it.
 *
 * The page is expected to re-resolve and to signal READY again when the
 * new route is on screen: the host drops its ready latch when it sends
 * this, so the splash covers the change the way it covers a load.
 */
export interface NavigateToMessage {
  type: 'NAVIGATE_TO';
  payload: { search: string };
}

export type NativeToWebMessage =
  | FileImportedMessage
  | BinaryFileImportedMessage
  | BinaryFileImportFailedMessage
  | SafeAreaInsetsMessage
  | AppStateMessage
  | CameraRollResultMessage
  | ShareResultMessage
  | ResumeHealthPingMessage
  | NavigateToMessage
  | AppEventMessage;
