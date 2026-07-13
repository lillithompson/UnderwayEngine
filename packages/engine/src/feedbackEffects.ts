// Centralized haptic + audio feedback for UI interactions.
//
// Components call `playEffect(name)` with a semantic effect name; the EFFECTS
// table below maps names to a haptic style + sound id. To globally retune the
// app's feel (e.g. mute audio, weaken delete haptic, swap the click), edit the
// one row here — no per-button changes needed.

import { triggerHaptic, playSoundEffect } from '@/native-shell/bridge/webBridge';
import storage from '@/engine/storage';

// Default playback volume for UI feedback sounds, in [0, 1]. Used until the
// persisted user preference loads (and as fallback if storage is empty).
// 0.01 underlying = 5% on the settings slider (which maps 0..100% → 0..0.2).
const DEFAULT_SOUND_VOLUME = 0.01;
const VOLUME_STORAGE_KEY = 'fxVolume';

export type EffectName =
  | 'toolPress' | 'toolLongPress' | 'levelChange' | 'destructive' | 'selection'
  | 'opApply' | 'solve' | 'gardenComplete';

type HapticStyle = 'light' | 'medium' | 'heavy' | 'selection';
type SoundId = 'click' | 'longPress' | 'swipe';

type EffectConfig = {
  haptic: HapticStyle | null;
  sound: SoundId | null;
};

const EFFECTS: Record<EffectName, EffectConfig> = {
  toolPress:     { haptic: 'light',     sound: 'click'     },
  toolLongPress: { haptic: 'medium',    sound: 'longPress' },
  levelChange:   { haptic: 'selection', sound: 'swipe'     },
  destructive:   { haptic: 'heavy',     sound: 'click'     },
  selection:     { haptic: 'selection', sound: null        },
  // Game moments (Boolean Garden). In-canvas chimes live in the web client's
  // audio layer; these rows carry the bridged haptic + a fallback sound.
  opApply:        { haptic: 'light',  sound: 'click'     },
  solve:          { haptic: 'medium', sound: 'swipe'     },
  gardenComplete: { haptic: 'heavy',  sound: 'longPress' },
};

// Module-mutable volume. `playEffect` reads this on each call, so changing it
// takes effect immediately without recreating any players.
let currentVolume = DEFAULT_SOUND_VOLUME;
const listeners = new Set<(v: number) => void>();

// Lazy load persisted volume on first import. Runs async; until it resolves
// playEffect uses the default. Idempotent — subsequent imports share the
// same in-flight or settled load.
let volumeLoadPromise: Promise<void> | null = null;
function ensureVolumeLoaded(): Promise<void> {
  if (volumeLoadPromise) return volumeLoadPromise;
  volumeLoadPromise = (async () => {
    try {
      const stored = await storage.getItem(VOLUME_STORAGE_KEY);
      if (stored == null) return;
      const parsed = parseFloat(stored);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
        currentVolume = parsed;
        listeners.forEach((l) => l(currentVolume));
      }
    } catch {
      // storage unavailable — keep default
    }
  })();
  return volumeLoadPromise;
}
void ensureVolumeLoaded();

export function getSoundVolume(): number {
  return currentVolume;
}

export function setSoundVolume(v: number): void {
  const clamped = Math.max(0, Math.min(1, v));
  if (clamped === currentVolume) return;
  currentVolume = clamped;
  listeners.forEach((l) => l(currentVolume));
  void storage.setItem(VOLUME_STORAGE_KEY, String(currentVolume)).catch(() => {});
}

/** Subscribe to volume changes. Returns an unsubscribe function. */
export function onSoundVolumeChange(listener: (v: number) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function playEffect(name: EffectName): void {
  const config = EFFECTS[name];
  if (config.haptic) triggerHaptic(config.haptic);
  if (config.sound) playSoundEffect(config.sound, currentVolume);
}
