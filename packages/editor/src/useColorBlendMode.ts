import { useCallback, useState } from 'react';
import type { BlendMode } from '@/engine/types';
import type { SwatchRainbow } from '@/editor-ui/adapter';
import { blendBadgeIcon } from './components/BlendBadgeIcons';
import type { SliderModeBadge } from './components/SliderModeTarget';
import { recentBlendsPref } from './editorPrefs';
import { brushBlends, rememberBlend } from './sliderModeMenu';

// The colour tool's BLEND MODE and the marks that advertise it: what the
// lower-right slider target wears on its edge, and what the toolbar swatch
// wears in place of the armed colour when the mode lays no colour of its own.
//
// Not per-document — it rides the brush, and is remembered across pages in
// `recentBlendsPref`. Takes the ARMED TOOL rather than the session, because
// `brushBlends` is the only thing it asks of it: only the brushes that have a
// blend carry a badge.

export function useColorBlendMode(activeTool: string | null) {
  // The color tool's brush settings (Facet's colorBrushBlendMode / Opacity):
  // the blend mode from the picker's grid decides how a paint stroke shifts
  // the colors it crosses, and the picker's Opacity slider is the brush
  // strength. Both live-apply to the next stroke; neither is per-document.
  const [colorBlendMode, setColorBlendMode] = useState<BlendMode>('normal');

  const noteBlendMode = useCallback((mode: BlendMode) => {
    setColorBlendMode(mode);
    recentBlendsPref.set(rememberBlend(recentBlendsPref.get(), mode));
  }, []);

  // What the lower-right target wears on its edge: the blend mode's mark,
  // on a disc of the colour in hand. Only the brushes that HAVE a blend
  // carry it — erase, blur and push do not blend, and a badge there would
  // name a setting their strokes ignore — and Normal has no glyph at all
  // (blendBadgeIcon), which is how "no mode armed" reads.
  const blendBadge = brushBlends(activeTool)
    ? blendBadgeIcon(colorBlendMode)
    : undefined;

  /** What the toolbar swatch wears in place of the armed colour, when the
   *  brush in hand is a colours-group one (the recolour brush or the
   *  raster spray, both of which blend) set to a mode that does not lay
   *  that colour: RANDOM, which lays a colour that WALKS as the stroke
   *  goes, and ROTATE, which lays no colour of its own at all — it spins
   *  the hue already under the dab (engine colorBlend). Each shows a
   *  rainbow ring round its blend-picker glyph. Every other mode uses the
   *  armed colour, so every other mode shows it. See the bar's
   *  `swatchRainbow`. */
  const swatchRainbow: SwatchRainbow | undefined = !brushBlends(activeTool)
    ? undefined
    : colorBlendMode === 'randomize' ? 'random'
      : colorBlendMode === 'rotate' ? 'rotate' : undefined;

  const brushBlendBadge: SliderModeBadge | null = blendBadge
    ? { Icon: blendBadge }
    : null;

  return { brushBlendBadge, colorBlendMode, noteBlendMode, swatchRainbow };
}
