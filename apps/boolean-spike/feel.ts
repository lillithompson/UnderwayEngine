/**
 * Sound + haptics for the spike, self-contained (no bridge, no assets):
 * WebAudio oscillator chimes tuned to a G-major pentatonic — the seed of the
 * sound-as-ritual direction — plus navigator.vibrate where hardware has it.
 * The bridged app build routes the same moments through the engine's
 * feedbackEffects rows (opApply / solve / gardenComplete) instead.
 */

export type FeelEvent =
  | 'select' | 'union' | 'difference' | 'intersection' | 'xor'
  | 'undo' | 'solve' | 'gardenComplete';

let ctx: AudioContext | null = null;

/** Create/resume the AudioContext inside a user gesture; safe to call often. */
export function primeAudio(): void {
  if (!ctx) {
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

const G4 = 392;

function note(semitones: number, delayS = 0, durS = 0.4, peak = 0.05): void {
  if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime + delayS;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = G4 * Math.pow(2, semitones / 12);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0005, t0 + durS);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + durS + 0.05);
}

function buzz(pattern: number | number[]): void {
  navigator.vibrate?.(pattern);
}

// Each op owns one pentatonic degree, so a session of operations plays a tune.
const OP_NOTE: Record<string, number> = { union: 0, difference: 2, intersection: 4, xor: 9 };

export function feel(event: FeelEvent): void {
  switch (event) {
    case 'select':
      note(16, 0, 0.12, 0.02);
      break;
    case 'undo':
      note(-3, 0, 0.15, 0.025);
      break;
    case 'union':
    case 'difference':
    case 'intersection':
    case 'xor':
      note(OP_NOTE[event]);
      buzz(10);
      break;
    case 'solve':
      note(0, 0, 0.3);
      note(4, 0.09, 0.3);
      note(7, 0.18, 0.45);
      buzz([15, 60, 20]);
      break;
    case 'gardenComplete':
      [0, 4, 7, 12, 16].forEach((s, i) => note(s, i * 0.11, 0.5));
      buzz([15, 60, 20, 60, 30]);
      break;
  }
}
