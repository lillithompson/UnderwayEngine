import React from 'react';
import type { RigPart, RigSliderKey } from '../logic/rigEdit';
import { rigPartSliders } from '../logic/rigEdit';
import { ActionRow, BarBody, SliderRow } from './effectBar';

// The rig's pose page: one part per tab (RIG · HANDS · FEET · SPINE · HEAD)
// and a slider per control. The whole figure turns on three axes, the hands
// close into fists and roll at the wrist, the feet point or flatten and
// swivel at the ankle, the spine bends / twists / leans from a centered
// rest, and the head nods and shakes on its own.
//
// No hint line under the controls, unlike the other pages. These pages carry
// the most rows in the editor, they stand over the figure being posed, and
// a slider named 'Bend' running between two labelled ends has already said
// what a sentence underneath would repeat. Dropping it takes a row off
// every one of them.
//
// No IK switch either. Reaching with a whole chain — the elbow bending so
// the hand lands where the finger is — is not offered any more: a drag
// swings the one bone under the finger, which is what makes posing this
// feel like posing a mannequin. The flag itself is still there in the host
// (rigIkStore, off), so the behaviour can be handed back without rebuilding
// it; nothing in the UI turns it on.
//
// RESET lives at the foot of the RIG page, and only there: it puts the WHOLE
// figure back — rest pose, facing front, every slider at rest — so it belongs
// on the page about the figure as a whole rather than beside the hands or the
// spine. Its row says so out loud ("Whole figure"), because a button sitting
// under three sliders otherwise reads as resetting those three. It renders
// only when the host wires it, so a locked rig offers none.
//
// The sliders do NOT read the figure's current pose — a hand posed finger
// by finger has no single "fistness" — so they sit at their rest positions
// until touched, and the host only shapes the pose once one moves.
//
// And NO Remove line under the page, unlike the effect pages. On those it
// removes something that was ADDED — a shadow, a border, a tint — and the
// object is itself again without it. A rig has no such layer: every slider
// here is a posture the figure is always in, so a Remove could only mean
// "back to rest", which is a pose like any other and one the sliders
// already reach. It also reset the WHOLE page, the sliders nobody had
// touched included, so one tap flattened a pair of hands that had been posed
// finger by finger. Standing the figure up is offered ONCE, over the whole
// rig, as the labelled Reset row above — not as a per-page Remove whose
// scope you have to guess.

export function RigPoseBar({ part, values, onChange, onCommit, onReset }: {
  part: RigPart;
  values: Record<RigSliderKey, number>;
  onChange: (key: RigSliderKey, value: number) => void;
  onCommit: (key: RigSliderKey, value: number) => void;
  /** Stand the whole figure back up — see above. Offered on the RIG page
   *  alone, and only when the host passes it. */
  onReset?: () => void;
}) {
  return (
    <BarBody>
      {rigPartSliders(part).map((spec) => (
        <SliderRow
          key={spec.key}
          label={spec.label}
          value={values[spec.key]}
          apply={(t, committed) => (committed ? onCommit : onChange)(spec.key, t)}
        />
      ))}
      {part === 'rig' && onReset ? (
        <ActionRow label="Whole figure" options={RESET_OPTION} onPress={onReset} />
      ) : null}
    </BarBody>
  );
}

const RESET_OPTION = [{ value: 'reset' as const, label: 'Reset' }];
