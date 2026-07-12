import { WebToNativeMessage, NativeToWebMessage } from './protocol';
import { showToast } from '@/engine/toast';

type SendToWeb = (msg: NativeToWebMessage) => void;

/**
 * Handle a message received from the web app inside the WebView.
 * Dispatches to the appropriate native API based on message type.
 */
export function handleNativeMessage(
  message: WebToNativeMessage,
  sendToWeb: SendToWeb,
): void {
  switch (message.type) {
    case 'SHARE_FILE':
      handleShareFile(message.payload, sendToWeb);
      break;

    case 'IMPORT_FILE':
      handleImportFile(message.payload, sendToWeb);
      break;

    case 'IMPORT_BINARY_FILE':
      handleImportBinaryFile(message.payload, sendToWeb);
      break;

    case 'HAPTIC_FEEDBACK':
      handleHaptic(message.payload.style);
      break;

    case 'AUDIO_FEEDBACK':
      handleAudio(message.payload.sound, message.payload.volume);
      break;

    case 'SAVE_TO_CAMERA_ROLL':
      handleSaveToCameraRoll(message.payload, sendToWeb);
      break;

    case 'READY':
      // Handled in WebViewShell — safe area insets sent there
      break;

    case 'LOG':
      handleLog(message.payload);
      break;
  }
}

function handleLog(payload: { level: 'log' | 'warn' | 'error'; tag: string; text: string }): void {
  const prefix = `[web:${payload.tag}]`;
  if (payload.level === 'error') console.error(prefix, payload.text);
  else if (payload.level === 'warn') console.warn(prefix, payload.text);
  else console.log(prefix, payload.text);
}

async function handleShareFile(
  payload: {
    data: string;
    filename: string;
    mimeType: string;
    uti?: string;
  },
  sendToWeb: SendToWeb,
): Promise<void> {
  try {
    const { Paths, File: FSFile } = require('expo-file-system');
    const Sharing = require('expo-sharing');

    // Detect if data is base64 or plain text
    const isBase64 = (payload.mimeType.startsWith('image/') && !payload.mimeType.includes('svg')) || payload.filename.endsWith('.png') || payload.filename.endsWith('.tile') || payload.filename.endsWith('.zip');

    const file = new FSFile(Paths.cache, payload.filename);
    file.create({ overwrite: true });

    if (isBase64) {
      file.write(payload.data, { encoding: 'base64' });
    } else {
      file.write(payload.data);
    }

    await Sharing.shareAsync(file.uri, {
      mimeType: payload.mimeType,
      UTI: payload.uti ?? 'public.data',
    });

    sendToWeb({ type: 'SHARE_RESULT', payload: { success: true } });
  } catch (e) {
    console.warn('Share failed:', e);
    const message = e instanceof Error ? (e.message || e.name) : String(e);
    sendToWeb({
      type: 'SHARE_RESULT',
      payload: { success: false, error: message || 'failed' },
    });
  }
}

async function handleSaveToCameraRoll(
  payload: { data: string; filename: string },
  sendToWeb: SendToWeb,
): Promise<void> {
  try {
    const { Paths, File: FSFile } = require('expo-file-system');
    const MediaLibrary = require('expo-media-library');

    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      sendToWeb({
        type: 'CAMERA_ROLL_RESULT',
        payload: { success: false, error: 'permission_denied' },
      });
      showToast('Photo library access denied');
      return;
    }

    const file = new FSFile(Paths.cache, payload.filename);
    file.create({ overwrite: true });
    file.write(payload.data, { encoding: 'base64' });

    await MediaLibrary.saveToLibraryAsync(file.uri);

    sendToWeb({
      type: 'CAMERA_ROLL_RESULT',
      payload: { success: true },
    });
    showToast('Saved to Photos');
    handleHaptic('heavy');
  } catch (e) {
    console.warn('Save to camera roll failed:', e);
    const message = e instanceof Error ? (e.message || e.name) : String(e);
    sendToWeb({
      type: 'CAMERA_ROLL_RESULT',
      payload: { success: false, error: message || 'failed' },
    });
    showToast('Could not save image');
  }
}

async function handleImportFile(
  payload: { accept: string },
  sendToWeb: SendToWeb,
): Promise<void> {
  try {
    const DocumentPicker = require('expo-document-picker');
    const { File: FSFile } = require('expo-file-system');

    const result = await DocumentPicker.getDocumentAsync({
      type: payload.accept.includes('json') ? 'application/json' : '*/*',
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    const pickedFile = new FSFile(asset.uri);
    const content = await pickedFile.text();

    sendToWeb({
      type: 'FILE_IMPORTED',
      payload: { name: asset.name, content },
    });
  } catch (e) {
    console.warn('Import failed:', e);
  }
}

async function handleImportBinaryFile(
  payload: { accept: string },
  sendToWeb: SendToWeb,
): Promise<void> {
  // TEMP diagnostic — silent-import bug investigation.
  console.log('[bridge] importBinaryFile entered, accept=', payload.accept);
  try {
    const a = payload.accept.toLowerCase();
    const allowsImages =
      a.includes('image/') ||
      a.includes('.png') ||
      a.includes('.jpg') ||
      a.includes('.jpeg');

    if (allowsImages) {
      const choice = await pickImportSource();
      // TEMP diagnostic
      console.log('[bridge] action sheet →', choice);
      if (choice === 'cancel') return;
      if (choice === 'photos') {
        await importFromPhotos(sendToWeb);
        return;
      }
    }
    await importFromFiles(sendToWeb);
  } catch (e) {
    const error = e instanceof Error ? (e.message || e.name) : String(e);
    console.warn('[bridge] Binary import failed (outer):', error);
    sendToWeb({
      type: 'BINARY_FILE_IMPORT_FAILED',
      payload: { error, stage: 'unknown' },
    });
  }
}

function pickImportSource(): Promise<'photos' | 'files' | 'cancel'> {
  const { ActionSheetIOS } = require('react-native');
  return new Promise((resolve) => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ['Cancel', 'Photo Library', 'Browse Files'],
        cancelButtonIndex: 0,
        title: 'Import',
      },
      (i: number) => resolve(i === 1 ? 'photos' : i === 2 ? 'files' : 'cancel'),
    );
  });
}

async function importFromPhotos(sendToWeb: SendToWeb): Promise<void> {
  const ImagePicker = require('expo-image-picker');
  const { Paths, File: FSFile } = require('expo-file-system');

  let result: any;
  try {
    result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });
  } catch (e) {
    const error = e instanceof Error ? (e.message || e.name) : String(e);
    console.warn('[bridge] launchImageLibraryAsync threw:', error);
    sendToWeb({
      type: 'BINARY_FILE_IMPORT_FAILED',
      payload: { error, stage: 'launch-picker' },
    });
    return;
  }
  if (result.canceled) {
    // TEMP diagnostic
    console.log('[bridge] picker cancelled');
    return;
  }

  if (!result.assets || result.assets.length === 0) {
    console.warn('[bridge] picker returned no assets');
    sendToWeb({
      type: 'BINARY_FILE_IMPORT_FAILED',
      payload: { error: 'picker returned no assets', stage: 'no-asset' },
    });
    return;
  }

  const asset = result.assets[0];
  // TEMP diagnostic — record everything the picker handed us.
  console.log(
    '[bridge] picker returned, uri=', asset.uri,
    'fileName=', asset.fileName,
    'width=', asset.width,
    'height=', asset.height,
    'fileSize=', asset.fileSize,
    'mimeType=', asset.mimeType,
  );

  // Dispatch sniffs by filename suffix; ensure name ends in .png/.jpg/.jpeg.
  const ext = /\.png(?:\?|$)/i.test(asset.uri) ? 'png' : 'jpg';
  const provided: string | undefined = asset.fileName;
  const name =
    provided && /\.(png|jpe?g)$/i.test(provided) ? provided : `photo.${ext}`;

  const tempFile = new FSFile(Paths.cache, `import_${Date.now()}.bin`);
  try {
    new FSFile(asset.uri).copy(tempFile);
    // TEMP diagnostic
    console.log('[bridge] copy ok → tempFile=', tempFile.uri);
  } catch (e) {
    const error = e instanceof Error ? (e.message || e.name) : String(e);
    console.warn('[bridge] copy threw:', error);
    sendToWeb({
      type: 'BINARY_FILE_IMPORT_FAILED',
      payload: { error, stage: 'copy' },
    });
    return;
  }

  let data: string;
  try {
    data = await tempFile.base64();
    // TEMP diagnostic
    console.log('[bridge] base64 ok, length=', data.length);
  } catch (e) {
    const error = e instanceof Error ? (e.message || e.name) : String(e);
    console.warn('[bridge] base64 threw:', error);
    sendToWeb({
      type: 'BINARY_FILE_IMPORT_FAILED',
      payload: { error, stage: 'base64' },
    });
    try { tempFile.delete(); } catch {}
    return;
  }
  try { tempFile.delete(); } catch {}

  try {
    // TEMP diagnostic
    console.log('[bridge] sendToWeb BINARY_FILE_IMPORTED, base64Length=', data.length, 'name=', name);
    sendToWeb({ type: 'BINARY_FILE_IMPORTED', payload: { name, data } });
  } catch (e) {
    const error = e instanceof Error ? (e.message || e.name) : String(e);
    console.warn('[bridge] sendToWeb threw:', error);
    sendToWeb({
      type: 'BINARY_FILE_IMPORT_FAILED',
      payload: { error, stage: 'send' },
    });
  }
}

async function importFromFiles(sendToWeb: SendToWeb): Promise<void> {
  const DocumentPicker = require('expo-document-picker');
  const { Paths, File: FSFile } = require('expo-file-system');

  let result: any;
  try {
    result = await DocumentPicker.getDocumentAsync({ type: '*/*' });
  } catch (e) {
    const error = e instanceof Error ? (e.message || e.name) : String(e);
    console.warn('[bridge] getDocumentAsync threw:', error);
    sendToWeb({
      type: 'BINARY_FILE_IMPORT_FAILED',
      payload: { error, stage: 'launch-picker' },
    });
    return;
  }
  if (result.canceled) {
    console.log('[bridge] document picker cancelled');
    return;
  }

  if (!result.assets || result.assets.length === 0) {
    console.warn('[bridge] document picker returned no assets');
    sendToWeb({
      type: 'BINARY_FILE_IMPORT_FAILED',
      payload: { error: 'document picker returned no assets', stage: 'no-asset' },
    });
    return;
  }

  const asset = result.assets[0];
  console.log('[bridge] document picker returned, uri=', asset.uri, 'name=', asset.name);

  const tempFile = new FSFile(Paths.cache, `import_${Date.now()}.bin`);
  try {
    new FSFile(asset.uri).copy(tempFile);
    console.log('[bridge] copy ok → tempFile=', tempFile.uri);
  } catch (e) {
    const error = e instanceof Error ? (e.message || e.name) : String(e);
    console.warn('[bridge] copy threw:', error);
    sendToWeb({
      type: 'BINARY_FILE_IMPORT_FAILED',
      payload: { error, stage: 'copy' },
    });
    return;
  }

  let data: string;
  try {
    data = await tempFile.base64();
    console.log('[bridge] base64 ok, length=', data.length);
  } catch (e) {
    const error = e instanceof Error ? (e.message || e.name) : String(e);
    console.warn('[bridge] base64 threw:', error);
    sendToWeb({
      type: 'BINARY_FILE_IMPORT_FAILED',
      payload: { error, stage: 'base64' },
    });
    try { tempFile.delete(); } catch {}
    return;
  }
  try { tempFile.delete(); } catch {}

  try {
    console.log('[bridge] sendToWeb BINARY_FILE_IMPORTED, base64Length=', data.length, 'name=', asset.name);
    sendToWeb({
      type: 'BINARY_FILE_IMPORTED',
      payload: { name: asset.name, data },
    });
  } catch (e) {
    const error = e instanceof Error ? (e.message || e.name) : String(e);
    console.warn('[bridge] sendToWeb threw:', error);
    sendToWeb({
      type: 'BINARY_FILE_IMPORT_FAILED',
      payload: { error, stage: 'send' },
    });
  }
}

function handleHaptic(style: string): void {
  try {
    const Haptics = require('expo-haptics');
    switch (style) {
      case 'light':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'medium':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
      case 'heavy':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        break;
      case 'selection':
        Haptics.selectionAsync();
        break;
    }
  } catch (e) {
    console.warn('[haptic] failed:', e);
  }
}

// Cached AudioPlayer instances keyed by sound id. Created lazily on first play
// so we avoid loading audio module at startup, and replayed in place so each
// button press doesn't pay the player-creation cost.
const audioPlayers = new Map<string, any>();
// iOS defaults expo-audio to the ambient category, which is muted by the silent
// switch. UI feedback should still fire when the user has silent on, so we
// flip playsInSilentMode once on first use.
let audioModeConfigured = false;

function getSoundAsset(sound: string): any {
  switch (sound) {
    case 'click':
      return require('../assets/sounds/click.wav');
    case 'longPress':
      return require('../assets/sounds/longPress.wav');
    case 'swipe':
      return require('../assets/sounds/swipe.wav');
    default:
      return null;
  }
}

function handleAudio(sound: string, volume?: number): void {
  let ExpoAudio: any;
  try {
    ExpoAudio = require('expo-audio');
  } catch (e) {
    console.warn('[audio] expo-audio not installed:', e);
    return;
  }
  try {
    if (!audioModeConfigured) {
      audioModeConfigured = true;
      ExpoAudio.setAudioModeAsync({ playsInSilentMode: true }).catch((e: unknown) => {
        console.warn('[audio] setAudioModeAsync failed:', e);
      });
    }
    let player = audioPlayers.get(sound);
    if (!player) {
      const asset = getSoundAsset(sound);
      if (!asset) {
        console.warn('[audio] unknown sound id:', sound);
        return;
      }
      player = ExpoAudio.createAudioPlayer(asset);
      audioPlayers.set(sound, player);
    }
    if (typeof volume === 'number') {
      player.volume = Math.max(0, Math.min(1, volume));
    }
    player.seekTo(0);
    player.play();
  } catch (e) {
    console.warn('[audio] play failed:', e);
  }
}
