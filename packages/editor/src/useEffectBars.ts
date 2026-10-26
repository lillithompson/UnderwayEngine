import { defaultBorderEffect } from './activeColor';
import {
  DEFAULT_IMAGE_TINT_FILL, asSolidFill, buildForEachNode,
  buildMaterializeFrameEffect, buildSetEffects, buildSetImageTintFill,
  isFrameGroupId, withState, type EditorSession, type SessionEntry,
} from './editorSession';
import {
  DEFAULT_GLOW_EFFECT, DEFAULT_SHADOW_EFFECT, borderModelToEffect,
  glowEffectKey, glowModelToEffect, shadowModelToEffect, type EffectKey,
} from './panelEffectModels';
import { effectTargetIds } from './panelModel';
import {
  BorderModel, GlowKind, GlowModel, ShadowModel,
} from '@/editor-ui/adapter';
import { applyCompOps, findItem } from '@/engine/compositionOps';
import { omitKeys } from '@/engine/omitKeys';
import {
  BorderEffect, CompositionState, GlowEffect, NodeEffects, RGBColor,
  ShadowEffect,
} from '@/engine/types';
import { useCallback, useRef } from 'react';

// The effect bars: the drop shadow, the two glows, the border and the fade.
// Every one of them is the same shape of edit — materialize a default so a
// freshly opened bar has something to show, preview live off a snapshot,
// commit one undo step on release — and every one of their rows opens the
// same full-screen picker.
//
// Behind the commit pipeline, so `applyEntry` is an input; the colour it
// reads and the picker flags it closes come from `useBarColorState`.
//
// NINE of these twenty statements sit under the TRANSFORM bar's banner in all
// three shells — `onShadowColor`, `onGlowColor`, `onBorderColorConfirm`
// and their siblings — which is one of the two places where 6.0's section cut
// and the subject disagree. They are grouped here by what they do.

export function useEffectBars<S extends EditorSession>({
  sessionRef, setSession, applyEntry,
  currentColorRef, noteActiveColor,
  setShadowColorPickerOpen, setBorderColorPickerOpen,
  setFadeColorPickerOpen, setFadeTarget,
}: {
  sessionRef: { current: S | null };
  setSession: (next: S) => void;
  applyEntry: (se: SessionEntry | null) => void;
  currentColorRef: { current: RGBColor };
  noteActiveColor: (color: RGBColor) => void;
  setShadowColorPickerOpen: (open: boolean) => void;
  setBorderColorPickerOpen: (open: boolean) => void;
  setFadeColorPickerOpen: (open: boolean) => void;
  setFadeTarget: (color: RGBColor) => void;
}) {
  // Materialize a default effect on the effect target(s) (images or frame
  // boundary rect) so a freshly opened bar has a visible effect to edit; a
  // no-op for targets that already have one.
  const materializeEffect = useCallback((key: EffectKey, def: ShadowEffect | BorderEffect | GlowEffect) => {
    const s = sessionRef.current;
    if (!s) return;
    // A frame materializes the effect on its boundary rect AND un-hides it
    // (a hidden boundary — and its effects — renders nothing).
    if (s.selectedId && isFrameGroupId(s.state, s.selectedId)) {
      applyEntry(buildMaterializeFrameEffect(s.state, s.selectedId, key, def));
      return;
    }
    applyEntry(buildForEachNode(s.state, effectTargetIds(s), (st, id) => {
      const ref = findItem(st, id);
      // Paint islands carry no effects block (their type option is opacity).
      return ref && ref.kind !== 'figure' && ref.kind !== 'paint' && ref.kind !== 'pattern' && !ref.item.effects?.[key]
        ? buildSetEffects(st, id, { ...ref.item.effects, [key]: def })
        : null;
    }));
  }, [applyEntry]);

  // The Add bars' buttons — the ONE place a default effect is created.
  const onAddShadow = useCallback(() => {
    materializeEffect('shadow', DEFAULT_SHADOW_EFFECT);
  }, [materializeEffect]);

  // …and a glow, either way about. One handler for both: which slot it lands
  // in is the only difference between them.
  const onAddGlow = useCallback((kind: GlowKind) => {
    materializeEffect(glowEffectKey(kind), DEFAULT_GLOW_EFFECT);
  }, [materializeEffect]);

  // A first border starts in the active color, like every other new stroke.
  const onAddBorder = useCallback(() => {
    materializeEffect('border', defaultBorderEffect(currentColorRef.current));
  }, [materializeEffect]);

  /** The Effects page's fourth button, over an image: its TINT — the wash
   *  of colour the recolour brush lays over a photo, a photo having no
   *  smaller part that owns a colour (paintBrush's objectColor).
   *
   *  It is not one of the effects the node's `effects` block holds; it is
   *  the image's own `tintFill`. But it is the same KIND of thing to the
   *  reader — something cast over the object's paint, which they now want
   *  gone — and until this button there was nothing anywhere that said a
   *  tint was there, let alone took it off: a brushed photo could only be
   *  put back by undoing far enough to lose the rest of the work with it.
   *
   *  Adding one lays the colour in hand, the rule every other Add on this
   *  panel goes by (a first border, a first fill). Removing clears the
   *  field outright. One undo step either way, over the whole selection. */
  const onToggleImageTint = useCallback((add: boolean) => {
    const s = sessionRef.current;
    if (!s) return;
    applyEntry(buildForEachNode(s.state, effectTargetIds(s), (st, id) => {
      const ref = findItem(st, id);
      if (ref?.kind !== 'image') return null;
      return buildSetImageTintFill(st, id, add
        ? asSolidFill(ref.item.tintFill ?? DEFAULT_IMAGE_TINT_FILL, currentColorRef.current)
        : null);
    }));
  }, [applyEntry]);

  // Generic effect edit: live preview via non-undoable withState, release
  // commits one step from the pre-drag snapshot (same coalescing as corner
  // radius / text). Shadow and Border are never open at once, so they share
  // one snapshot ref. `patch` folds the new effect into (or out of) the
  // node's existing NodeEffects.
  const effectBaseRef = useRef<CompositionState | null>(null);

  const applyEffectEdit = useCallback((
    patch: (existing: NodeEffects | undefined) => NodeEffects,
    committed: boolean,
  ) => {
    const s = sessionRef.current;
    if (!s) return;
    const ids = effectTargetIds(s);
    if (ids.length === 0) return;
    const effectsFrom = (state: CompositionState, id: string): NodeEffects | undefined => {
      const ref = findItem(state, id);
      if (!ref || ref.kind === 'figure' || ref.kind === 'paint' || ref.kind === 'pattern') return undefined;
      const next = patch(ref.item.effects);
      return Object.keys(next).length > 0 ? next : undefined;
    };
    const entryFor = (state: CompositionState) => buildForEachNode(state, ids,
      (st, id) => buildSetEffects(st, id, effectsFrom(st, id)));
    if (!committed) {
      if (!effectBaseRef.current) effectBaseRef.current = s.state;
      const se = entryFor(s.state);
      if (se) setSession(withState(s, applyCompOps(s.state, se.entry)));
      return;
    }
    const base = effectBaseRef.current ?? s.state;
    effectBaseRef.current = null;
    setSession(withState(s, base));
    // Skip a no-op commit (opened + released without changing anything).
    const changed = ids.some((id) => {
      const baseRef = findItem(base, id);
      if (!baseRef || baseRef.kind === 'figure' || baseRef.kind === 'paint' || baseRef.kind === 'pattern') return false;
      return JSON.stringify(baseRef.item.effects ?? null)
        !== JSON.stringify(effectsFrom(base, id) ?? null);
    });
    if (!changed) return;
    applyEntry(entryFor(base));
  }, [setSession, applyEntry]);

  const onShadow = useCallback((m: ShadowModel | null, committed: boolean) => {
    applyEffectEdit((existing) => {
      if (m) return { ...existing, shadow: shadowModelToEffect(m) };
      return omitKeys<NodeEffects>(existing ?? {}, ['shadow']);
    }, committed);
  }, [applyEffectEdit]);

  const onGlow = useCallback((kind: GlowKind, m: GlowModel | null, committed: boolean) => {
    const key = glowEffectKey(kind);
    applyEffectEdit((existing) => {
      if (m) return { ...existing, [key]: glowModelToEffect(m) };
      return omitKeys<NodeEffects>(existing ?? {}, [key]);
    }, committed);
  }, [applyEffectEdit]);

  const onBorder = useCallback((m: BorderModel | null, committed: boolean) => {
    applyEffectEdit((existing) => {
      if (m) return { ...existing, border: borderModelToEffect(m) };
      return omitKeys<NodeEffects>(existing ?? {}, ['border']);
    }, committed);
  }, [applyEffectEdit]);

  // An effect color swatch opens the same full-screen picker as the toolbar
  // color tool; confirming commits the new color as one undo step.
  // `alpha` lands on the shadow's own `alpha` field; a border has no alpha
  // channel, so its picker never offers the slider and nothing is passed here.
  const commitEffectColor = useCallback((
    key: EffectKey, color: RGBColor, alpha?: number, colorTouched = true,
  ) => {
    if (colorTouched) noteActiveColor(color);
    const s = sessionRef.current;
    if (!s) return;
    applyEntry(buildForEachNode(s.state, effectTargetIds(s), (st, id) => {
      const ref = findItem(st, id);
      if (!ref || ref.kind === 'figure' || ref.kind === 'paint' || ref.kind === 'pattern') return null;
      const cur = ref.item.effects?.[key]
        ?? (key === 'shadow' ? DEFAULT_SHADOW_EFFECT
          : key === 'border' ? defaultBorderEffect(currentColorRef.current)
          : DEFAULT_GLOW_EFFECT);
      // A confirm that only moved the opacity keeps every target's OWN ink:
      // over a multi-selection the picker opens on the first member's colour
      // alone, so writing it back would paint the rest in it.
      const rgb = colorTouched ? { r: color.r, g: color.g, b: color.b } : cur.color;
      const clamped = alpha !== undefined ? Math.max(0, Math.min(1, alpha)) : undefined;
      // Shadow's alpha is a required field; a border's is optional (v55) and
      // opaque is spelled "absent", so a slider parked at 100% clears it.
      const next = clamped === undefined
        ? { ...cur, color: rgb }
        : key === 'border'
          ? { ...cur, color: rgb, alpha: clamped < 1 ? clamped : undefined }
          : { ...cur, color: rgb, alpha: clamped };
      return buildSetEffects(st, id, { ...ref.item.effects, [key]: next });
    }));
  }, [applyEntry, noteActiveColor]);

  const onPickShadowColor = useCallback(() => setShadowColorPickerOpen(true), []);

  const onShadowColorConfirm = useCallback((
    color: RGBColor, alpha: number, colorTouched = true,
  ) => {
    setShadowColorPickerOpen(false);
    commitEffectColor('shadow', color, alpha, colorTouched);
  }, [commitEffectColor]);

  // The Shadow and Border pages' hue rows. They ride applyEffectEdit — the
  // same live-preview / commit coalescing every other row on those pages
  // uses — and touch the colour alone, leaving each effect's alpha where the
  // picker (or the Shadow page's own Opacity slider) left it.
  const onShadowColor = useCallback((color: RGBColor, committed: boolean) => {
    const rgb = { r: color.r, g: color.g, b: color.b };
    applyEffectEdit((existing) => ({
      ...existing,
      shadow: { ...(existing?.shadow ?? DEFAULT_SHADOW_EFFECT), color: rgb },
    }), committed);
    if (committed) noteActiveColor(color);
  }, [applyEffectEdit, noteActiveColor]);

  const onGlowColor = useCallback((kind: GlowKind, color: RGBColor, committed: boolean) => {
    const key = glowEffectKey(kind);
    const rgb = { r: color.r, g: color.g, b: color.b };
    applyEffectEdit((existing) => ({
      ...existing,
      [key]: { ...(existing?.[key] ?? DEFAULT_GLOW_EFFECT), color: rgb },
    }), committed);
    if (committed) noteActiveColor(color);
  }, [applyEffectEdit, noteActiveColor]);

  const onBorderColor = useCallback((color: RGBColor, committed: boolean) => {
    const rgb = { r: color.r, g: color.g, b: color.b };
    applyEffectEdit((existing) => ({
      ...existing,
      border: { ...(existing?.border ?? defaultBorderEffect(currentColorRef.current)), color: rgb },
    }), committed);
    if (committed) noteActiveColor(color);
  }, [applyEffectEdit, noteActiveColor]);

  // The Fade row's trailing circle. The amount rides the slider beside it;
  // this is only the target every colour walks toward.
  const onPickFadeColor = useCallback(() => setFadeColorPickerOpen(true), []);

  const onFadeColorConfirm = useCallback((color: RGBColor) => {
    setFadeColorPickerOpen(false);
    // Nothing is written to the object: the target is where the slider
    // WALKS, and the walk is only spent when the slider moves. Re-picking
    // it mid-page therefore re-aims the row rather than repainting what an
    // earlier drag already committed.
    setFadeTarget({ r: color.r, g: color.g, b: color.b });
    noteActiveColor(color);
  }, [noteActiveColor]);

  const onPickBorderColor = useCallback(() => setBorderColorPickerOpen(true), []);

  const onBorderColorConfirm = useCallback((
    color: RGBColor, alpha: number, colorTouched = true,
  ) => {
    setBorderColorPickerOpen(false);
    commitEffectColor('border', color, alpha, colorTouched);
  }, [commitEffectColor]);

  return {
    commitEffectColor, onAddBorder, onAddGlow, onAddShadow, onBorder, onBorderColor,
    onBorderColorConfirm, onFadeColorConfirm, onGlow, onGlowColor,
    onPickBorderColor, onPickFadeColor, onPickShadowColor, onShadow, onShadowColor,
    onShadowColorConfirm, onToggleImageTint,
  };
}
