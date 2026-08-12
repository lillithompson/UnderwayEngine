// Native camera-roll save, factored out of nativeBridge's SAVE_TO_CAMERA_ROLL
// handler so RN screens can save an image directly (no WebView round-trip)
// and the bridge handler stays the thin transport wrapper around it. There is
// exactly ONE implementation of "base64 → cache file → MediaLibrary"; callers
// differ only in how they report the result (bridge message vs. return value).
//
// Native only — it require()s expo-file-system / expo-media-library, which
// have no browser implementation. Web callers want webBridge's
// savePngToCameraRoll instead (Web Share API, falling back to a download).

export interface CameraRollResult {
  success: boolean;
  /** 'permission_denied' when the user declined the photo-library prompt;
   *  otherwise the underlying error message. Absent on success. */
  error?: string;
}

/**
 * Write raw base64 bytes to a file in the cache directory and return its
 * `file://` uri, overwriting any previous file of that name.
 *
 * Every native hand-off of an image the app holds in memory starts here — the
 * photo-library save below, and the share sheet (shareImage.ts) — because both
 * OS APIs take a file, not bytes. One implementation so the two can't come to
 * disagree about encoding or overwrite behaviour. Throws on a filesystem
 * failure; callers turn that into their own result shape.
 */
export function writeCacheFile(base64Data: string, filename: string): string {
  const { Paths, File: FSFile } = require('expo-file-system');
  const file = new FSFile(Paths.cache, filename);
  file.create({ overwrite: true });
  file.write(base64Data, { encoding: 'base64' });
  return file.uri;
}

/**
 * Write raw base64 image bytes to a cache file and add it to the photo
 * library, prompting for permission first. Never throws — every failure
 * comes back as `{ success: false, error }` so callers can decide whether to
 * toast, retry, or ignore.
 *
 * `filename` needs an extension that matches the bytes (`.jpg`, `.png`);
 * MediaLibrary infers the asset type from it.
 */
export async function saveBase64ToCameraRoll(
  base64Data: string,
  filename: string,
): Promise<CameraRollResult> {
  try {
    const MediaLibrary = require('expo-media-library');

    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      return { success: false, error: 'permission_denied' };
    }

    await MediaLibrary.saveToLibraryAsync(writeCacheFile(base64Data, filename));
    return { success: true };
  } catch (e) {
    console.warn('Save to camera roll failed:', e);
    const message = e instanceof Error ? (e.message || e.name) : String(e);
    return { success: false, error: message || 'failed' };
  }
}
