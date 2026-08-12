import { Platform, Share } from 'react-native';
import { writeCacheFile, type CameraRollResult } from './cameraRoll';

// Native "share this image" — the OS share sheet, so the picture can go to
// Messages, WhatsApp, Mail, or anything else the user has installed. The
// sibling of cameraRoll.ts's save: same bytes, same cache file (writeCacheFile
// is shared), different destination.
//
// Native only — it require()s expo-sharing and hands the OS a file:// uri,
// neither of which a browser has. Web callers share through the Web Share API
// instead (see the app's shareEntryImage.web.ts).

/**
 * Present the OS share sheet for an image, with `message` as the text that
 * travels alongside it. Never throws — a failure comes back as
 * `{ success: false, error }`, and a dismissed sheet as `error: 'cancelled'`.
 *
 * `filename` needs an extension matching the bytes (`.jpg`, `.png`): it names
 * the attachment, and on iOS it is what tells the share sheet what the file is.
 *
 * Platform difference worth knowing: iOS's activity sheet takes an image AND
 * text together, so a message shared to iMessage carries both the picture and
 * the link. Android's ACTION_SEND can carry both too, but expo-sharing exposes
 * no text field — there the message is offered as the dialog title and the
 * recipient gets the image alone.
 */
export async function shareImageFile(
  base64Data: string,
  filename: string,
  mimeType: string,
  message: string,
): Promise<CameraRollResult> {
  try {
    const uri = writeCacheFile(base64Data, filename);

    if (Platform.OS === 'ios') {
      const result = await Share.share({ message, url: uri });
      return result.action === Share.dismissedAction
        ? { success: false, error: 'cancelled' }
        : { success: true };
    }

    const Sharing = require('expo-sharing');
    if (!(await Sharing.isAvailableAsync())) {
      return { success: false, error: 'unavailable' };
    }
    await Sharing.shareAsync(uri, { mimeType, dialogTitle: message });
    return { success: true };
  } catch (e) {
    console.warn('Share image failed:', e);
    const messageText = e instanceof Error ? (e.message || e.name) : String(e);
    return { success: false, error: messageText || 'failed' };
  }
}
