import React from 'react';
import type { RigJointSection, RigSliderKey } from '../logic/rigEdit';
import { RIG_JOINT_SECTIONS, rigJointSliders, rigPartSliders } from '../logic/rigEdit';
import { GroupedBody, RowGroup, SegmentedRow, SliderRow } from './effectBar';

// The rig's JOINTS page: the bend between the two ends of a limb — an
// elbow swung round the shoulder–wrist line, a knee round the hip–ankle
// one.
//
// It is the one control a two-bone chain has that its DRAGS cannot give.
// Where an arm reaches is two degrees of freedom and a drag sets them;
// which way the elbow points while reaching there is the third, and no
// gesture that moves an end can see it — a hand held at one spot can have
// its elbow up, out or tucked, and only this chooses between them. Both
// ends hold still while it swings (Figgie's poleChain: the far end lies ON
// the axis, the near end IS the pivot), so it never costs the pose the
// reach somebody already put in by dragging.
//
// ONE shaded box with tabs, the Copies page's own shape and for the same
// reason: Left and Right are one setting asked twice, and elbows and knees
// are the same question about a different pair of chains, so they want one
// place on the page rather than four rows down it. Both faces are the same
// height, so the sheet never resizes under a tab press, and the box IS the
// page — no well around it (submenuHeight's pageIsWelled).
//
// The sliders sit at their rest positions until touched, like every other
// rig slider: a chain posed by dragging has no pole angle to read back
// that the drags meant to set, so the page shows "as you left it" and only
// changes the figure once a bar moves. Their two ends are the SAME place —
// a pole angle goes all the way round — which is what lets one bar reach
// every position the joint can take.

export function RigJointsBar({ section, onSection, values, onChange, onCommit }: {
  /** Which pair of chains is showing. The PANEL holds it, so the page's
   *  height is the same either way and known before the render. */
  section: RigJointSection;
  onSection: (section: RigJointSection) => void;
  values: Record<RigSliderKey, number>;
  onChange: (key: RigSliderKey, value: number) => void;
  onCommit: (key: RigSliderKey, value: number) => void;
}) {
  const specs = rigPartSliders('joints');
  const keys = rigJointSliders(section);
  return (
    <GroupedBody>
      <RowGroup>
        <SegmentedRow options={RIG_JOINT_SECTIONS} value={section} onChange={onSection} />
        {keys.map((key) => (
          <SliderRow
            key={key}
            label={specs.find((s) => s.key === key)?.label ?? key}
            value={values[key]}
            apply={(t, committed) => (committed ? onCommit : onChange)(key, t)}
          />
        ))}
      </RowGroup>
    </GroupedBody>
  );
}
