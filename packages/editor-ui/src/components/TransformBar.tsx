import React, { useEffect, useRef, useState } from 'react';
import type { OpacityModel, RGBLike, TransformCopiesSpec } from '../adapter';
import {
  EffectButton, FadeSliderRow, GroupedBody, RowGroup, SECTION_TABS_GROUP_RADIUS, SectionTabs,
  SliderRow,
} from './effectBar';
import {
  COPIES_MAX, COPIES_MIN, OFFSET_MAX, ROTATE_MAX, ROTATE_MIN, SCALE_MAX, SCALE_MIN,
  copiesSeededFrom,
} from '../logic/transform';
import { GROUP_PAD } from '../logic/submenuHeight';

// The Copies page, on every vector shape and line (the 'transform' page —
// its key predates the rename): Create copies — how far each sits from the
// one before (X and Y, in cells), how much each is scaled (X and Y, a
// factor that compounds copy over copy), how much further each is turned
// and how many — and the button that lays them down. The settings are the
// PAGE's own draft (a request, not a property of the object), so they
// survive between presses: set 6 copies 2 cells apart at 15°, press, undo,
// press again. Rotating the object itself is not here: that is the
// two-finger twist and the selection tool's Rotate slider.
//
// The settings come in pairs — the count beside the turn, the offsets, the
// scales — and ALL THREE share one GROUP: a shaded rounded box whose tabs
// switch which pair shows, each on a line of its own. They answer the same
// question, what each copy is and how it differs from the one before, so
// they want one place on the page rather than three boxes down it. Copies
// leads, being what a press lays down and the pair most presses set. They shared a line each before
// (one DualSliderRow per pair), which kept the page short but halved every
// track and set the two readouts fighting for the width; the box says the
// same "these two are one setting" without the squeeze. Create copies
// stands below the three, on the bare well — it is the thing they describe,
// not one more of them.
//
// Ranges are stated in the object's own units so the readouts mean
// something: a typed 90 is a quarter turn, a typed 4 is four cells, a
// typed 120 is a fifth larger each copy (logic/transform.ts).
//
// The draft is also REPORTED live (onCopiesPreview): once when the page
// mounts, again on every change, and null as it unmounts — the host ghosts
// the copies a press would lay down, updating as the sliders move, and
// clears them when the page is dismissed or another page takes its place.

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** A value in [lo, hi] as the slider's 0–1, and back. */
const toT = (v: number, lo: number, hi: number) => (v - lo) / (hi - lo);
const fromT = (t: number, lo: number, hi: number) => lo + t * (hi - lo);
const degText = (deg: number) => `${Math.round(deg)}°`;
const cellText = (cells: number) => String(Math.round(cells * 10) / 10);
const factorText = (f: number) => `${Math.round(f * 100)}%`;

/** The page's four faces: how many copies and how much each is turned,
 *  how far each sits from the one before, how much each is scaled, or how
 *  much of its ink each keeps. One section, one at a time. */
export type CopiesSection = 'copies' | 'offset' | 'scale' | 'color';

const SECTIONS = [
  { value: 'copies' as const, label: 'Copies' },
  { value: 'offset' as const, label: 'Offset' },
  { value: 'scale' as const, label: 'Scale' },
  // …and what each copy is made of, which is the other way a run of them
  // reads as a run: a shape stepping across the page and dissolving as it
  // goes says "was here, and here, and is here now" where six solid ones
  // say "there are six of these".
  { value: 'color' as const, label: 'Color' },
];

export function TransformBar({
  onCopies, onCopiesPreview, section, onSection, ink, fadeColor, fadeInk, onOpenFadePicker,
}: {
  onCopies: (spec: TransformCopiesSpec) => void;
  /** The live draft: every change while the page is up, null on the way out. */
  onCopiesPreview?: (spec: TransformCopiesSpec | null) => void;
  /** Which face the second group shows. The PANEL holds it so the page's
   *  height is the same either way and known before the render. */
  section: CopiesSection;
  onSection: (section: CopiesSection) => void;
  /** The object's OWN ink — where the run starts. The Color tab's two
   *  sliders open on it, so a press with nothing touched lays copies that
   *  look like the object. */
  ink?: Pick<OpacityModel, 'opacity' | 'fade'>;
  /** The fade TARGET — what the Fade row's trailing circle wears and its
   *  picker edits. The object's own (the copies inherit it), so this tab
   *  says how far the run goes toward it and never where it is going. */
  fadeColor?: RGBLike;
  /** The object's lead ink AS AUTHORED, before any fade is spent on it — the
   *  Fade track's near end, so the ramp runs from the colour the object draws
   *  in to the target the circle wears. Absent for a kind with no ink of its
   *  own (a photograph), where the ramp starts from the panel's track. */
  fadeInk?: RGBLike;
  /** The Fade row's trailing circle: the host's full colour picker, where
   *  the target is chosen. Without it the row has no target to name and the
   *  tab shows the Opacity slider alone. */
  onOpenFadePicker?: () => void;
}) {
  // Seeded ONCE, at the open: the ink sliders start under the object's own
  // values. Re-seeding as the object changed would drag the thumb out from
  // under the finger — the draft is the page's, and the page is opened per
  // selection.
  const [copies, setCopies] = useState<TransformCopiesSpec>(() => copiesSeededFrom(ink));
  const set = (patch: Partial<TransformCopiesSpec>) => setCopies((c) => ({ ...c, ...patch }));
  // Read through a ref so a host passing a fresh closure each render doesn't
  // re-announce an unchanged draft — the effects key on the draft alone.
  const previewRef = useRef(onCopiesPreview);
  previewRef.current = onCopiesPreview;
  useEffect(() => { previewRef.current?.(copies); }, [copies]);
  useEffect(() => () => { previewRef.current?.(null); }, []);
  return (
    <GroupedBody>
      {/* ONE shaded section for all three pairs, its tabs switching the two
          sliders under them: the count beside the turn, the offsets, the
          scales. Every pair answers the same question — what each copy is,
          and how it differs from the one before — so they take one box and
          one place on the page. Copies leads: it is what a press lays
          down, and the pair most presses set. */}
      <RowGroup>
        <SectionTabs
          options={SECTIONS}
          value={section}
          onChange={onSection}
          pad={GROUP_PAD}
          radius={SECTION_TABS_GROUP_RADIUS}
        />
        {section === 'copies' ? (
          <>
            <SliderRow
              label="Copies"
              value={toT(copies.count, COPIES_MIN, COPIES_MAX)}
              apply={(t) => set({ count: Math.round(fromT(t, COPIES_MIN, COPIES_MAX)) })}
              readout={{
                text: String(copies.count),
                commit: (n) => set({ count: Math.round(clamp(n, COPIES_MIN, COPIES_MAX)) }),
              }}
            />
            <SliderRow
              label="Rotation offset"
              value={toT(copies.dAngleDeg, ROTATE_MIN, ROTATE_MAX)}
              apply={(t) => set({ dAngleDeg: Math.round(fromT(t, ROTATE_MIN, ROTATE_MAX)) })}
              readout={{
                text: degText(copies.dAngleDeg),
                commit: (n) => set({ dAngleDeg: Math.round(clamp(n, ROTATE_MIN, ROTATE_MAX)) }),
              }}
            />
          </>
        ) : section === 'offset' ? (
          <>
            <SliderRow
              label="Offset X"
              value={toT(copies.dx, -OFFSET_MAX, OFFSET_MAX)}
              apply={(t) => set({ dx: Math.round(fromT(t, -OFFSET_MAX, OFFSET_MAX) * 10) / 10 })}
              readout={{ text: cellText(copies.dx), commit: (n) => set({ dx: clamp(n, -OFFSET_MAX, OFFSET_MAX) }) }}
            />
            <SliderRow
              label="Offset Y"
              value={toT(copies.dy, -OFFSET_MAX, OFFSET_MAX)}
              apply={(t) => set({ dy: Math.round(fromT(t, -OFFSET_MAX, OFFSET_MAX) * 10) / 10 })}
              readout={{ text: cellText(copies.dy), commit: (n) => set({ dy: clamp(n, -OFFSET_MAX, OFFSET_MAX) }) }}
            />
          </>
        ) : section === 'scale' ? (
          <>
            <SliderRow
              label="Scale X"
              value={toT(copies.sx, SCALE_MIN, SCALE_MAX)}
              apply={(t) => set({ sx: Math.round(fromT(t, SCALE_MIN, SCALE_MAX) * 100) / 100 })}
              readout={{ text: factorText(copies.sx), commit: (n) => set({ sx: clamp(n / 100, SCALE_MIN, SCALE_MAX) }) }}
            />
            <SliderRow
              label="Scale Y"
              value={toT(copies.sy, SCALE_MIN, SCALE_MAX)}
              apply={(t) => set({ sy: Math.round(fromT(t, SCALE_MIN, SCALE_MAX) * 100) / 100 })}
              readout={{ text: factorText(copies.sy), commit: (n) => set({ sy: clamp(n / 100, SCALE_MIN, SCALE_MAX) }) }}
            />
          </>
        ) : (
          <>
            {/* The two rows of the Opacity page, in the Opacity page's own
                dress — and asked of the LAST COPY, not of each step. Both
                sliders say where the run ENDS: the object's ink walks there
                in even steps, so the same setting over twelve copies is a
                slower dissolve than over three. A step is not a thing anyone
                can picture; the far end of the run is.

                Fade wears the Opacity page's Fade row whole (FadeSliderRow):
                a ramp from the colour the object draws in to the target, and
                a circle of the target that opens the picker — because what
                the far end of this slider MEANS is that colour. The target
                is the OBJECT's (engine/fade.ts); the copies inherit it, so
                this tab says how far the run goes, never where. */}
            {onOpenFadePicker && fadeColor ? (
              <FadeSliderRow
                label="Fade"
                value={copies.finalFade}
                color={fadeColor}
                from={fadeInk}
                apply={(t) => set({ finalFade: Math.round(t * 100) / 100 })}
                onOpenPicker={onOpenFadePicker}
              />
            ) : null}
            {/* An opacity: the alpha checker under the ramp, so its empty
                end reads as see-through — the same row the Opacity page
                shows, which is the row this one is about. */}
            <SliderRow
              label="Opacity"
              value={copies.finalOpacity}
              checker
              apply={(t) => set({ finalOpacity: Math.round(t * 100) / 100 })}
            />
          </>
        )}
      </RowGroup>
      {/* The Add pages' button (EffectButton), not a segmented row: this is
          the page's one ACT, the same kind of thing "Add Fill" is, so it
          takes the same shape — full width, a row tall, the word in ink
          behind a plus. It wore a one-cell ActionRow, which is the shape
          the pages use for CHOOSING between states and read as a setting
          with a single option (the Image page's Replace made the same trip).
          No label column either: a "Copies" beside it named the page over
          again — and clashed with the Copies slider directly above, which is
          the count this button acts on. The word is "Create" for the same
          reason: the page is Copies and the slider says how many. */}
      <EffectButton label="Create" onPress={() => onCopies(copies)} />
    </GroupedBody>
  );
}
