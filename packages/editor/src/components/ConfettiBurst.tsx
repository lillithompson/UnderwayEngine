import React, { useEffect, useMemo, useRef } from 'react';
import {
  easeOutQuad,
  generateParticles,
  particleFrame,
  DEFAULT_COLORS,
  DEFAULT_PARTICLE_COUNT,
  DEFAULT_DURATION_MS,
  DEFAULT_GRAVITY,
  DEFAULT_SPEED_RANGE,
  DEFAULT_SIZE_RANGE,
  DEFAULT_ROTATION_SPEED,
  DEFAULT_FADE_START,
  DEFAULT_SPREAD,
} from '../confettiParticles';

// Facet's ConfettiBurst (components/confetti/ConfettiBurst.tsx) — the burst
// that plays when a tutorial finishes there — rendered for the DOM editor.
// Facet animates a reanimated progress value; this editor never runs under
// the RN renderer, so the same curve is baked into Web Animations API
// keyframes instead: each particle's trajectory is sampled with the eased
// progress (quad out, matching withTiming) applied, and the compositor
// interpolates between samples. No per-frame JS at all — transform/opacity
// keyframes run off the main thread, and unlike a requestAnimationFrame
// loop they don't stall when the window is occluded.
//
// Completion follows the ANIMATIONS (each one's `finished`), not a clock
// started at mount. A Web Animation begins at its first painted frame,
// and the paint can come well after the effect that called animate():
// the Done press starts the page's full raster in the microtasks right
// behind the same handler (the shell's setDone, afterPaint.ts here),
// and a main thread held for a second is a burst that begins a second
// late. Timed from the mount, as Facet's own setTimeout is, the cleanup
// then ran out mid-flight — or before a particle had been drawn at all,
// on a raster longer than the burst (bug 057ec9ce). Timed from the
// finish, the burst is on screen for the whole of its flight whenever it
// begins. A timer remains as the BACKSTOP alone, at the duration plus a
// slack, for a runtime whose animations never say they finished — a
// document hidden through the burst holds its animations paused — so the
// particles are never left mounted for good.

export type ConfettiBurstProps = {
  /** Burst origin, in px within the nearest positioned ancestor. */
  originX: number;
  originY: number;
  /** Changing this replays the burst with fresh particles. */
  trigger: number | string;
  colors?: string[];
  particleCount?: number;
  durationMs?: number;
  gravity?: number;
  spread?: { angleMin: number; angleMax: number };
  speedRange?: [number, number];
  sizeRange?: [number, number];
  rotationSpeed?: number;
  fadeStart?: number;
  onComplete?: () => void;
};

/** Keyframe samples per particle. The path is a parabola under one easing —
 *  25 spans keep the piecewise-linear approximation visually indistinguishable
 *  while the keyframe lists stay tiny. */
const KEYFRAME_STEPS = 25;

/** How long past its duration a burst may stay mounted waiting for its
 *  animations to say they finished, before the backstop clears it anyway.
 *  Generous: it is reached only when the animations never finish (a
 *  hidden document pauses them), and the mounted burst costs no frame. */
export const COMPLETE_SLACK_MS = 5000;

export function ConfettiBurst(props: ConfettiBurstProps) {
  const {
    originX,
    originY,
    trigger,
    colors = DEFAULT_COLORS,
    particleCount = DEFAULT_PARTICLE_COUNT,
    durationMs = DEFAULT_DURATION_MS,
    gravity = DEFAULT_GRAVITY,
    spread = DEFAULT_SPREAD,
    speedRange = DEFAULT_SPEED_RANGE,
    sizeRange = DEFAULT_SIZE_RANGE,
    rotationSpeed = DEFAULT_ROTATION_SPEED,
    fadeStart = DEFAULT_FADE_START,
    onComplete,
  } = props;

  const particles = useMemo(
    () => generateParticles({ count: particleCount, colors, speedRange, sizeRange, spread, rotationSpeed }),
    // Facet's dependency: a new trigger deals a new hand of particles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trigger, particleCount, colors, speedRange, sizeRange, spread, rotationSpeed],
  );

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const durationSec = durationMs / 1000;
    const animations: Animation[] = [];
    for (let i = 0; i < wrap.children.length && i < particles.length; i++) {
      const el = wrap.children[i] as HTMLElement;
      const frames = [];
      for (let s = 0; s <= KEYFRAME_STEPS; s++) {
        const f = particleFrame(particles[i], easeOutQuad(s / KEYFRAME_STEPS), durationSec, gravity, fadeStart);
        frames.push({
          transform: `translate(${f.x}px, ${f.y}px) rotate(${f.rot}deg)`,
          opacity: f.opacity,
        });
      }
      animations.push(el.animate(frames, { duration: durationMs, easing: 'linear', fill: 'forwards' }));
    }
    // Complete when the animations have — however late they began — and
    // once only: the backstop and the finish race, and the cleanup below
    // withdraws both.
    let live = true;
    const complete = () => {
      if (!live) return;
      live = false;
      clearTimeout(backstop);
      onCompleteRef.current?.();
    };
    const backstop = setTimeout(complete, durationMs + COMPLETE_SLACK_MS);
    // A cancelled animation's `finished` rejects: the cleanup cancels them
    // all, and by then `live` is false, so the rejection is nothing.
    Promise.all(animations.map((a) => a.finished)).then(complete, () => {});
    return () => {
      live = false;
      clearTimeout(backstop);
      for (const a of animations) a.cancel();
    };
  }, [trigger, particles, durationMs, gravity, fadeStart]);

  return (
    <div
      ref={wrapRef}
      aria-hidden
      style={{
        position: 'absolute', left: originX, top: originY,
        width: 0, height: 0, pointerEvents: 'none',
      }}
    >
      {particles.map((p, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: -p.size / 2,
            top: -p.size / 2,
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            borderRadius: 1,
            willChange: 'transform, opacity',
          }}
        />
      ))}
    </div>
  );
}
