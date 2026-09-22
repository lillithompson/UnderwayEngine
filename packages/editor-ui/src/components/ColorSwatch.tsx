import React, { useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { RGBLike } from '../adapter';
import { hueRampColors, isTranslucent, rgbCss } from '../logic/hsv';

// The shared fill for anything that previews a picked color — the color
// picker's preview dot, every bar's header swatch, the tint stop handles, the
// toolbar's color tool. Once the picker can set an opacity (RGBLike.a), a flat
// `backgroundColor: rgbCss(color)` is a lie: 20%-alpha white over the dark
// editor chrome reads as a mid grey, indistinguishable from an opaque mid
// grey. So a translucent color is painted over a checkerboard, the universal
// "this is see-through" signal.
//
// Both fills are absolutely positioned, so a caller keeps its own size /
// border-radius / border and only has to (a) add `overflow: 'hidden'` so the
// fill is clipped to the shape and (b) drop its own `backgroundColor`.
//
// The checkerboard is one tiled <Image>, not a grid of cell Views: a 16px PNG
// repeated by the compositor costs a single node at any size, where cell Views
// would be ~18 per small swatch and >100 across the tint bar's full-width stop
// ramp — real per-frame layout work during a slider drag, for decoration.

/** A 16×16 PNG of 8px light/light-grey squares (the Photoshop-style alpha
 *  checker), inlined so the package ships no binary asset and needs no bundler
 *  config. Tiled via `resizeMode="repeat"`, so 8pt cells at any swatch size. */
const CHECKER_TILE_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAHUlEQVR42mP4jwOcxwEYRjXQRAMuCVwGjWqgiQYAaTu1H96wfLcAAAAASUVORK5CYII=';

// Hoisted so the Image source is referentially stable across renders (a fresh
// `{ uri }` each render makes RN re-resolve the source mid-drag).
const CHECKER_SOURCE = { uri: CHECKER_TILE_URI };

/** The bare transparency checkerboard, filling its parent. Use directly when
 *  the color layer above it isn't a flat fill — the Tint bar's gradient ramp,
 *  whose stops may each carry their own alpha. */
export function CheckerboardFill() {
  return <Image source={CHECKER_SOURCE} resizeMode="repeat" style={StyleSheet.absoluteFill} />;
}

/** The fill for a swatch that stands for NO ONE COLOUR: the hue wheel laid
 *  left to right, the same ramp a hue slider's track wears (hueRampColors).
 *  Used where the thing the swatch names is "whatever colour comes next" —
 *  a brush blending in Random, which deposits a colour that walks as the
 *  stroke goes. A flat swatch there is a promise the stroke does not keep.
 *  Fills its parent; the parent supplies the shape. */
export function RainbowSwatchFill() {
  const ramp = useMemo(() => hueRampColors(), []);
  return (
    <LinearGradient
      colors={ramp as unknown as readonly [string, string, ...string[]]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
  );
}

/** A color swatch's fill: the color, over a checkerboard when it is
 *  translucent. Fills its parent; the parent supplies the shape. */
export function ColorSwatchFill({ color }: { color: RGBLike }) {
  return (
    <>
      {isTranslucent(color) ? <CheckerboardFill /> : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: rgbCss(color) }]} />
    </>
  );
}
