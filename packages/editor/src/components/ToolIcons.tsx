import React from 'react';
import {
  POLYGON_ICON_CIRCLE_R,
  POLYGON_ICON_SQUARE_HALF,
  POLYGON_ICON_SQUARE_RADIUS,
  facetGlyphTransform,
  heartIconPoints,
  polygonIsCircle,
  polygonIsHeart,
  polygonIsQuarterCircle,
  polygonIsQuarterTorus,
  polygonIsRightTriangle,
  polygonIsSemiTorus,
  polygonIsSemicircle,
  polygonIsSpiral,
  polygonIsStar,
  quarterCircleIconPoints,
  quarterTorusIconPoints,
  regularPolygonIconPoints,
  rightTriangleIconPoints,
  semiTorusIconPoints,
  semicircleIconPoints,
  spiralIconPoints,
  starIconPoints,
} from './toolbarMeta';
import { ARC_GLYPH } from './facetGlyphs';

// Toolbar glyphs that MaterialCommunityIcons has no match for, ported from
// Facet's components/icons/ToolIcons.tsx. Same 256×256 viewBox and the same
// coordinates / stroke widths — but Facet draws them full-bleed, and beside
// this bar's keyline-padded MCI buttons (the freehand pencil, image, select,
// text) full-bleed reads oversized, so each is wrapped in a group that
// shrinks it onto the Material 18-unit keyline (facetGlyphTransform; the
// same fit the polygon family got).
//
// Facet draws these with react-native-svg; the shared editor is a DOM tree
// (each app's EditorShell renders <div>s and mounts the react-native-web
// chrome inside it), and react-native-svg is not a dependency of any app —
// so these are plain inline <svg> elements. They are only ever mounted on
// the web target: the native apps host this same editor in a WebView, so
// no React Native renderer ever sees them.

export interface ToolIconProps {
  color: string;
  size: number;
}

const GLYPH_FIT = facetGlyphTransform();

export function LineIcon({ color, size }: ToolIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <g transform={GLYPH_FIT}>
        <rect x={10} y={202} width={44} height={44} stroke={color} strokeWidth={20} />
        <rect x={202} y={10} width={44} height={44} stroke={color} strokeWidth={20} />
        <line x1={208} y1={48} x2={48} y2={208} stroke={color} strokeWidth={27} />
      </g>
    </svg>
  );
}

export function RectangleIcon({ color, size }: ToolIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <g transform={GLYPH_FIT}>
        <rect x={13.5} y={13.5} width={229} height={229} stroke={color} strokeWidth={27} />
      </g>
    </svg>
  );
}

export function ArcIcon({ color, size }: ToolIconProps) {
  // Drawn from the geometry leaf beside this file (./facetGlyphs.ts): an
  // app may re-render this same glyph somewhere of its own (CozyJournal's
  // Home card draws it out of bordered Views for the Facets arc day), and
  // the two must be identical.
  // The quarter circle is a true arc path now; Facet's original cubic was
  // an approximation of exactly this circle.
  const { square, squareStroke, squareA, squareB, arcCenter, arcRadius, arcStroke } = ARC_GLYPH;
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <g transform={GLYPH_FIT}>
        <rect x={squareA.x} y={squareA.y} width={square} height={square} stroke={color} strokeWidth={squareStroke} />
        <rect x={squareB.x} y={squareB.y} width={square} height={square} stroke={color} strokeWidth={squareStroke} />
        <path
          d={`M${arcCenter.x} ${arcCenter.y - arcRadius}`
            + `A${arcRadius} ${arcRadius} 0 0 1 ${arcCenter.x + arcRadius} ${arcCenter.y}`}
          stroke={color}
          strokeWidth={arcStroke}
        />
      </g>
    </svg>
  );
}

export function CircleIcon({ color, size }: ToolIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <g transform={GLYPH_FIT}>
        <circle cx={128} cy={128} r={114.5} stroke={color} strokeWidth={27} />
      </g>
    </svg>
  );
}

// ── Polygon tool ────────────────────────────────────────────────────
// The polygon button's glyph tracks the sides slider: a circle on the two
// circle stops (2 and 13), a triangle at 3, an axis-aligned square at 4, a
// pentagon at 5, and so on. Unlike the Facet-ported glyphs above (which
// fill their whole 256 box), this family sits on the Material 24-grid
// keylines of the MCI buttons beside it — the circle pixel-matches the
// pattern-studio plus-circle disc, the square pixel-matches image-outline's
// frame, and each N-gon is bbox-centered — so the button never jumps in
// apparent size or position as the slider moves. The geometry and keyline
// constants live in toolbarMeta.ts (node-testable); this file only wraps
// them in the <svg>.

function PolygonCircleGlyph({ color, size }: ToolIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <circle cx={128} cy={128} r={POLYGON_ICON_CIRCLE_R} stroke={color} strokeWidth={27} />
    </svg>
  );
}

function PolygonSquareGlyph({ color, size }: ToolIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <rect
        x={128 - POLYGON_ICON_SQUARE_HALF}
        y={128 - POLYGON_ICON_SQUARE_HALF}
        width={POLYGON_ICON_SQUARE_HALF * 2}
        height={POLYGON_ICON_SQUARE_HALF * 2}
        rx={POLYGON_ICON_SQUARE_RADIUS}
        stroke={color}
        strokeWidth={27}
      />
    </svg>
  );
}

/** The polygon tool's button glyph for a given slider division: the
 *  keyline circle on the circle stops, the keyline square at 4 (axis-aligned
 *  — it reads better on the bar than a diamond, and it is the shape users
 *  know from the image button), a point-up regular N-gon otherwise.
 *  Referentially stable per division, so TopBar only remounts the icon when
 *  the slider lands on a new whole number. */
const polygonIconCache = new Map<number, React.ComponentType<ToolIconProps>>();

function HeartGlyph({ color, size }: ToolIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <polygon points={heartIconPoints()} stroke={color} strokeWidth={27} strokeLinejoin="round" />
    </svg>
  );
}

/** The five-pointed star, from the same generator the tool commits with —
 *  closed, so it is a polygon like the heart. */
function StarGlyph({ color, size }: ToolIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <polygon points={starIconPoints()} stroke={color} strokeWidth={27} strokeLinejoin="round" />
    </svg>
  );
}

/** The right triangle — closed, from the generator the tool commits with,
 *  so it is a polygon like the heart. */
function RightTriangleGlyph({ color, size }: ToolIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <polygon points={rightTriangleIconPoints()} stroke={color} strokeWidth={27} strokeLinejoin="round" />
    </svg>
  );
}

/** The half circle and the half ring — closed, from the generators the
 *  tool commits with, so each is a polygon like the heart. */
function SemicircleGlyph({ color, size }: ToolIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <polygon points={semicircleIconPoints()} stroke={color} strokeWidth={27} strokeLinejoin="round" />
    </svg>
  );
}

function SemiTorusGlyph({ color, size }: ToolIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <polygon points={semiTorusIconPoints()} stroke={color} strokeWidth={27} strokeLinejoin="round" />
    </svg>
  );
}

/** The quarter disc and the quarter ring — closed, from the generators
 *  the tool commits with, so each is a polygon like the half shapes. */
function QuarterCircleGlyph({ color, size }: ToolIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <polygon points={quarterCircleIconPoints()} stroke={color} strokeWidth={27} strokeLinejoin="round" />
    </svg>
  );
}

function QuarterTorusGlyph({ color, size }: ToolIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <polygon points={quarterTorusIconPoints()} stroke={color} strokeWidth={27} strokeLinejoin="round" />
    </svg>
  );
}

function SpiralGlyph({ color, size }: ToolIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      {/* Open — a polyline, never closed into a polygon. */}
      <polyline points={spiralIconPoints()} stroke={color} strokeWidth={20} strokeLinecap="round" />
    </svg>
  );
}

export function polygonToolIcon(sides: number): React.ComponentType<ToolIconProps> {
  if (polygonIsHeart(sides)) return HeartGlyph;
  if (polygonIsStar(sides)) return StarGlyph;
  if (polygonIsSpiral(sides)) return SpiralGlyph;
  if (polygonIsRightTriangle(sides)) return RightTriangleGlyph;
  if (polygonIsSemicircle(sides)) return SemicircleGlyph;
  if (polygonIsSemiTorus(sides)) return SemiTorusGlyph;
  if (polygonIsQuarterCircle(sides)) return QuarterCircleGlyph;
  if (polygonIsQuarterTorus(sides)) return QuarterTorusGlyph;
  if (polygonIsCircle(sides)) return PolygonCircleGlyph;
  if (sides === 4) return PolygonSquareGlyph;
  let Icon = polygonIconCache.get(sides);
  if (!Icon) {
    const points = regularPolygonIconPoints(sides);
    Icon = function PolygonIcon({ color, size }: ToolIconProps) {
      return (
        <svg width={size} height={size} viewBox="0 0 256 256" fill="none">
          <polygon points={points} stroke={color} strokeWidth={27} />
        </svg>
      );
    };
    polygonIconCache.set(sides, Icon);
  }
  return Icon;
}
