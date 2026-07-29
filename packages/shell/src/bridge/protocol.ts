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
 * Generic app-defined event (web → native). The shell stays app-agnostic:
 * `kind`/`data` semantics belong to the consuming app, which registers a
 * handler via `setAppEventHandler` (nativeBridge). Used for navigation
 * intents, state pushes to the native chrome, etc.
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

export type NativeToWebMessage =
  | FileImportedMessage
  | BinaryFileImportedMessage
  | BinaryFileImportFailedMessage
  | SafeAreaInsetsMessage
  | AppStateMessage
  | CameraRollResultMessage
  | ShareResultMessage
  | ResumeHealthPingMessage;
