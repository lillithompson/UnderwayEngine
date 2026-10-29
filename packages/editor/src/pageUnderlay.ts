/**
 * A page's UNDERLAY (`EditorConfig.underlay`): a drawing laid under every
 * object on the page, in world cells, that no tool can touch — a guide
 * to draw over, a figure the page's own strokes are composed on top of.
 * It is no object: it is never selected, hit, saved or baked, and the
 * page's composition does not know it is there.
 *
 * The surface draws it as one `<svg>` in the WORLD layer, after the
 * background and before the scene, so the camera carries it with the page
 * and nothing is written per frame (unlike the screen-space chrome,
 * `regionChromeScreen.ts`). Its shapes are SVG path data in world cells —
 * the page is `WORLD_CELLS` across — with a fill, a stroke of a width in
 * cells, and a dash in cells, so it scales with the page as the objects
 * do.
 *
 * DrawBot's bot look page is the one page that carries one (its
 * docs/drawBot.md §5.1: the Inkling's generated figure under the user's
 * drawing); WHICH page carries it is pinned in that app's tree.
 */

export interface UnderlayShape {
  /** SVG path data, in world cells. */
  readonly d: string;
  /** CSS colour; none: unfilled. */
  readonly fill?: string;
  /** CSS colour; none: unstroked. */
  readonly stroke?: string;
  /** The stroke's width, in cells. */
  readonly strokeWidth?: number;
  /** The stroke's dash and gap, in cells; none: solid. */
  readonly dash?: readonly number[];
  readonly cap?: 'butt' | 'round' | 'square';
  readonly join?: 'miter' | 'round' | 'bevel';
}

/** The attributes of the `<path>` that draws `shape`: what is given, and
 *  `none` for a fill or a stroke left out, so an SVG default (black fill)
 *  never shows through. */
export function underlayPathAttrs(shape: UnderlayShape): {
  d: string; fill: string; stroke: string; strokeWidth?: number; strokeDasharray?: string;
  strokeLinecap?: 'butt' | 'round' | 'square'; strokeLinejoin?: 'miter' | 'round' | 'bevel';
} {
  return {
    d: shape.d,
    fill: shape.fill ?? 'none',
    stroke: shape.stroke ?? 'none',
    ...(shape.strokeWidth !== undefined ? { strokeWidth: shape.strokeWidth } : {}),
    ...(shape.dash && shape.dash.length > 0 ? { strokeDasharray: shape.dash.join(' ') } : {}),
    ...(shape.cap ? { strokeLinecap: shape.cap } : {}),
    ...(shape.join ? { strokeLinejoin: shape.join } : {}),
  };
}
