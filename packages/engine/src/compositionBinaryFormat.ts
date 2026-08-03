import { BlendMode, CompositionFigure, GridLevel, Camera, GroupNode, SVGObject, SVGSubpath, PathSegment, ImageObject, RGBColor, TextObject, TextStyle, TextAlign, FontWeight, Paint, GradientStop, NodeEffects, ImageTintMode, ImageFraming } from './types';
import { arcBoundingBox } from './compositionArcHitTest';
import { Transform2D } from './transform2d';
import { normalizeStrokeScale, migrateLegacyStrokeScale, DEFAULT_STROKE_SCALE } from './strokeScale';
import { computeAliveGroupIds } from './compositionOps';
import { compSnapStep } from './compositionCellMath';

// â”€â”€ FCOMP Binary Format v29 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// HEADER (8 bytes)
//   Magic:       u8[4] = "FCMP"
//   Version:     u16 LE
//   FigureCount: u16 LE
//
// COMPOSITION METADATA (fields total 43 bytes; METADATA_SIZE=45 keeps
// 2 bytes of historical slack in the allocation â€” writes are sequential,
// so the slack is just trailing zeros)
//   nameIdx:     u16 LE        (string table index)
//   gridLevel:   i8  (v23+; u8 in v22-, but legacy values were 0..6 so
//                     the two encodings overlap for legacy data)
//   cameraX:     f64 LE
//   cameraY:     f64 LE
//   cameraZoom:  f64 LE
//   strokeScale: f64 LE        (v4+; in v22- a 0â€“1 percentage of
//                               MAX_LINE_WIDTH with v>1 auto-normalized;
//                               in v23+ values may exceed 1 because
//                               normalization scales the stroke inversely
//                               with content. Migration: v22- values
//                               keep the legacy divide-by-200 rule.)
//   gridIntensity: f64 LE      (v9+; default 0.5 for older files)
//
// NORMALIZATION (v23+)
//   Every save scales the content's AABB by a power-of-2 factor s = 2^k,
//   k â‰¥ 0 (scale-up only â€” content larger than 32 L0 stays large; the
//   precision constraint may push the scaled bbox past 32). Content is
//   centered in [0,32]Ã—[0,32] when it fits, else anchored at the origin.
//   `gridLevel` is bumped by k and `strokeScale` is multiplied by s, so
//   visual content is preserved across the normalization. v22-and-earlier
//   files get normalized on first load.
//
// STRING TABLE
//   StringCount: u16 LE
//   Per string:  u16 LE (byte length) + u8[] (UTF-8)
//
// FIGURE ARRAY
//   Per figure:  see serialize/deserialize. v6 adds optional localCell* via
//                flags2 bit 0x40 (4 i16 fixed-point quarter-cell values).
//                v7 drops the deprecated groupIdentityCell* block (was flags2
//                bit 0x20 in v5/v6); v6 reads still skip those bytes.
//                v16 adds optional colorOverride via figure flags2 bit 0x80
//                (3 uint8 r,g,b written after the quads block; presence-only
//                â€” explicit white is preserved, no sentinel collapse).
//
// CUSTOM COLORS SECTION (v17+)
//   customColorCount: u16 LE
//   Per color:        u8 r, u8 g, u8 b
//   Persisted user palette colors for this composition; populated as the
//   user picks non-default colors in the composer's color tool. Empty for
//   older bundles (loader hydrates customColors: []).
//
// GROUPS SECTION (v6+)
//   groupCount:  u16 LE
//   Per group:
//     idIdx:        u16 LE     (string table index, group id)
//     nameIdx:      u16 LE     (string table index, group name)
//     flags:        u8         (0x01 mirrorH, 0x02 mirrorV, 0x0C rotation 2 bits,
//                               0x10 hasParent, 0x20 hasPreGroupName, 0x40 isFrame v30+,
//                               0x80 locked v32+)
//     translateX:   f32 LE
//     translateY:   f32 LE
//     scaleX:       f32 LE
//     scaleY:       f32 LE
//
// SVG OBJECTS SECTION (v12+, replaces LINES+ARCS from v8-v11)
//   svgCount:     u16 LE
//   Per svg:
//     idIdx:        u16 LE     (string table)
//     flags:        u8
//                     0x01 mirrorH, 0x02 mirrorV, 0x04 locked,
//                     0x08 hasName, 0x10 hasGroupId, 0x20 hasPreGroupName,
//                     0x40 hasLocalSegments, 0x80 hasIdentitySegments
//     flags2:       u8         (v15+)
//                     0x01 hasCreationBox, 0x02 hasLineDirection,
//                     0x0C lineDirection bits (0=horizontal,1=vertical,2=diagonal),
//                     0x10 hasSubpaths (v20+), 0x20 hasLocalSubpaths (v20+),
//                     0x40 isRectangle (v21+, presence flag for shapeKind='rectangle')
//     flags3:       u8         (v24+)
//                     0x01 hasFillColor (v24+), 0x02 isMask (v25+),
//                     0x04 hidden (v26+), 0x08 isPatternFill (v27+),
//                     0x10 hasSegmentOverrides (v28+),
//                     0x20 hasFillPaint (v29+), 0x40 hasEffects (v29+)
//     rotBits:      u8         (low 2 bits â†’ 0/90/180/270, bit 0x04 tileRepeat)
//     color:        u8 r, u8 g, u8 b
//     conditional u16 string refs (in flag order): nameIdx, groupIdIdx, preGroupNameIdx
//     segmentCount: u16 LE
//     segments:     segmentCount Ã— segment-record
//     if hasLocalSegments:    u16 count + segments
//     if hasIdentitySegments: u16 count + segments
//     if tileRepeat (16 bytes): tileWidthL0 i16 + tileHeightL0 i16
//                               + tileOffsetXL0 i16 + tileOffsetYL0 i16 (v18+)
//                               + region bbox cellX i16 + cellY i16
//                                 + cellWidth u16 + cellHeight u16 (v19+)
//                               (all encodeFixed quarter-cell)
//     if hasCreationBox (v15+): minX i16 + minY i16 + width u16 + height u16
//                               (all encodeFixed quarter-cell)
//     if hasSubpaths (v20+):     subpathCount u16 + per-subpath {r u8, g u8, b u8,
//                                segmentCount u16, segments}. Persists per-color
//                                splits from drag-paint / join ops so per-segment
//                                color survives save/load.
//     if hasLocalSubpaths (v20+): same shape, pre-group-transform geometry. Only
//                                 written when the SVG is grouped (mirrors the
//                                 localSegments invariant).
//     if hasFillColor (v24+):  r u8 + g u8 + b u8 + opacity u8 (0-255)
//     if hasSegmentOverrides (v28+): count u16 + count Ã— (key u32 + r u8 + g u8 + b u8)
//     if hasFillPaint (v29+):  PAINT payload (see below)
//     if hasEffects (v29+):    EFFECTS payload (see below)
//   Segment:      kind: u8 (0=line, 1=arc)
//                 start: i16 i16, end: i16 i16
//                 if kind==1: center: i16 i16
//
// PAINT PAYLOAD (v29+, shared by SVG fillPaint and the background section)
//   kindByte:    u8 (0 solid, 1 linear, 2 radial)
//   solid:       r u8 + g u8 + b u8 + alpha u8 (0-255; 255 reads back as
//                alpha undefined = opaque, mirroring fillOpacity)
//   linear:      stopCount u8 + stops + x1 f32 + y1 f32 + x2 f32 + y2 f32
//   radial:      stopCount u8 + stops + cx f32 + cy f32 + r f32
//   Per stop:    offset u8 (0-255 quantized /255) + r u8 + g u8 + b u8
//                + alpha u8 (255 reads back as undefined = opaque)
//   Gradient geometry is unit-bbox space, stored as f32 LE.
//
// EFFECTS PAYLOAD (v29+, shared by SVG, image, and text records)
//   presenceMask: u8 (0x01 shadow, 0x02 glow, 0x04 border)
//   shadow:       dx f32 + dy f32 + blur f32 + r u8 + g u8 + b u8
//                 + alpha u8 (0-255 quantized /255)
//   glow:         radius f32 + r u8 + g u8 + b u8 + alpha u8 (quantized)
//   border:       width f32 + r u8 + g u8 + b u8 + hasRadius u8
//                 + radius f32 (only when hasRadius == 1)
//
// EMBEDDED FILES
//   fileCount:   u16 LE
//   Per file:    idIdx(u16) nameIdx(u16) widthL0(u16) heightL0(u16) dataLen(u32) data(u8[])
//
// IMAGES SECTION (v10+) â€” written after embedded files; see writeImage.
//   The image rotation byte carries: 0x03 rotation, 0x04 hidden (v14+),
//   0x08 hasTint (v29+), 0x10 hasEffects (v29+), 0x20 hasAngle (v31+),
//   0x40 hasFraming (v33+), 0x80 hasCornerRadius (v33+). The main image
//   flags byte is fully consumed, so the presence bits live in the spare
//   high bits of the rotation byte (older readers mask & 0x03 / & 0x04).
//   Tint payload (after the identity-bbox block, before effects):
//     r u8 + g u8 + b u8 + amount u8 (0-255 quantized /255)
//     + mode u8 (0 tint, 1 duotone, 2 wash)
//   Effects payload (after tint): shared EFFECTS payload above.
//   Framing payload (v33+, after the angleDeg i16): modeByte u8
//     (0 fill, 1 fit, 2 crop, 3 tile) + subflags u8 marking which optional
//     fields follow, then those fields in bit order — ratio as an enum u8
//     (0 free, 1 square, 2 fourFive, 3 sixteenNine), every numeric as f64
//     (exact round-trip, no drift across repeated saves).
//   CornerRadius payload (v33+, after framing): a single f64.
//
// TEXT OBJECTS SECTION (v29+) â€” written after the images + image-bytes
//   sections and before scene order, so the blob-heavy payloads stay
//   last-but-one and older readers (which stop at their known sections)
//   never see it. Absent entirely in v28- files.
//   textCount:   u16 LE
//   Per text:
//     idIdx:      u16 LE      (string table)
//     flags:      u8          0x01 mirrorH, 0x02 mirrorV, 0x04 locked,
//                             0x08 hasName, 0x10 hasGroupId,
//                             0x20 hasPreGroupName, 0x40 hidden, 0x80 sticker
//     flags2:     u8          0x01 hasLocalBbox, 0x02 hasIdentityBbox,
//                             0x04 hasEffects
//     rotBits:    u8          (low 2 bits -> 0/90/180/270)
//     conditional u16 string refs (flag order): nameIdx, groupIdIdx,
//                             preGroupNameIdx
//     contentIdx: u16 LE      (string table; text content)
//     bbox:       cellX i16 + cellY i16 (encodeFixed quarter-cell)
//                 + cellWidth u16 + cellHeight u16 (encodeFixed)
//     if hasLocalBbox:    localCellX i16 + localCellY i16
//                         + localCellWidth u16 + localCellHeight u16 (fixed)
//     if hasIdentityBbox: identityCellX i16 + identityCellY i16
//                         + identityCellWidth u16 + identityCellHeight u16
//     style:      fontIdIdx u16 (string table) + size f32
//                 + styleFlags u8 (0x01 bold, 0x02 italic, 0x04 hasStroke,
//                   0x08 hasLetterSpacing, 0x10 hasLineHeight,
//                   0x60 align 2 bits: 0 absent, 1 left, 2 center, 3 right,
//                   0x80 hasWeight)
//                 + color r u8 + g u8 + b u8
//     if hasLetterSpacing: letterSpacing f32
//     if hasLineHeight:    lineHeight f32
//     if hasStroke:        width f32 + r u8 + g u8 + b u8
//     if hasWeight:        weight u8 (0 light, 1 regular, 2 semibold, 3 bold)
//     if hasEffects (flags2): shared EFFECTS payload above
//
// BACKGROUND SECTION (v29+) â€” written after the custom colors section
//   (the final section of the file).
//   hasBackground: u8 (0 or 1)
//   if hasBackground: PAINT payload above

const MAGIC = [0x46, 0x43, 0x4D, 0x50]; // "FCMP"
// v20: SVG records persist `subpaths` and `localSubpaths` so per-segment
// colors from drag-paint / join ops round-trip through save/load. Older
// v19 readers silently drop these fields (and the file becomes a
// single-color SVG on reload).
// v21: SVG records persist `shapeKind === 'rectangle'` via flags2 bit 0x40
// so rectangles keep their orange selection border and non-uniform scaling
// after a .tile export/import round-trip.
// v22: colorOverride now writes 4 bytes (r, g, b, blendModeByte) instead of 3.
// blendModeByte 0xFF = legacy luminance recolor; 0x00â€“0x0A = BlendMode index.
// v23: composition content is normalized to a canonical 32Ã—32 L0 bbox on
// every save (largest power-of-2 fit, aspect-preserving, centered). The
// composition `gridLevel` field becomes a signed byte (range âˆ’128..127);
// `strokeScale` may exceed 1 since normalization scales it inversely.
// v24: SVG fillColor + fillOpacity â€” solid fill for closed shapes. SVG records
// gain a flags3 byte (after flags2). flags3 bit 0x01 = hasFillColor;
// 4 bytes (r, g, b, opacity) written after subpaths.
// v25: SVG isMask ("Use as mask") via flags3 bit 0x02. Presence-only â€” no
// payload bytes. Older files load with isMask undefined.
// v27: SVG isPatternFill (shape masks a tiled figure) via flags3 bit 0x08.
// Presence-only. Older files load with isPatternFill undefined.
// v28: SVG segmentOverrides (sparse per-copy paint on tiled objects) via
// flags3 bit 0x10. Payload: count u16 + count Ã— (key u32 + r u8 + g u8 + b u8).
// Older files load with segmentOverrides undefined.
// v29: text scene nodes, gradient/solid Paint, node effects, image tint,
// and canvas background. New TEXT OBJECTS section between the image-bytes
// section and scene order; new BACKGROUND section after custom colors.
// SVG records gain fillPaint (flags3 0x20) and effects (flags3 0x40),
// payloads after segmentOverrides in flag-bit order. Image records gain
// tint (rotation-byte bit 0x08) and effects (bit 0x10), payloads after
// the identity-bbox block. Older files load with all of these undefined
// and no texts/background.
// v30: GroupNode isFrame (Figma-style frame group) via group-flags bit 0x40.
// Presence-only â€” no payload bytes. Older files load with isFrame undefined.
// v31: free (continuous) rotation `angleDeg` on svg / image / text scene
// nodes, authored by the two-finger twist gesture. Presence flag: svg
// flags3 bit 0x80, image rotation-byte bit 0x20, text flags2 bit 0x08.
// Payload is a single i16 of hundredths-of-a-degree (angleDeg * 100),
// appended after each record's existing optional blocks. Older files load
// with angleDeg undefined (no free rotation).
// v32: GroupNode `locked` (an inherited group/frame lock) via group-flags bit
// 0x80. Presence-only — no payload bytes. Older files load with locked
// undefined (unlocked).
// v33: ImageObject `framing` (the "Crop" bar: mode + zoom / margin / ratio /
// angle / tileScale / tileGap / pan offsetX/offsetY) and `cornerRadius`.
// Presence flags: image rotation-byte bits 0x40 (framing) / 0x80 (cornerRadius),
// written after the v31 angleDeg block. Framing payload is modeByte(u8) +
// subflags(u8) + the present optional fields (ratio as u8; every numeric as
// f32); cornerRadius is a single f32. Older files load with both undefined, so
// the image falls back to legacy stretch-fill with square corners. Fixes the
// binary round-trip silently dropping a photo's crop/pan/zoom (it reverted to
// the default cover crop on reopen — "clipped in a different place").
// v34: ImageObject `originalImageId` — a second, higher-resolution copy kept
// for export, addressed in the same imageBlobs map as `imageId`. The image
// rotation byte is fully consumed (v33 took its last two bits), so v34 adds a
// new per-image `flags2` byte, written after the v33 framing/cornerRadius
// blocks; bit 0x01 marks an originalImageId, whose u16 string-table index
// follows. The bytes ride the existing image-blob section (the id is added to
// the dedup'd blob list). Gated on version>=34 so v33 files — which have no
// flags2 byte — are never misread; originalImageId loads undefined there
// (export falls back to imageId).
const FORMAT_VERSION = 34;
const HEADER_SIZE = 8;
const METADATA_SIZE = 45;
// Base group record: idIdx(u16) + nameIdx(u16) + flags(u8) + 4Ã—float32 = 21
// Optionally followed by parentGroupIdIdx(u16) and preGroupNameIdx(u16)
const GROUP_RECORD_BASE_SIZE = 2 + 2 + 1 + 4 + 4 + 4 + 4; // 21 bytes

// Blend mode â†” byte mapping for colorOverride persistence (v22+).
const BLEND_MODE_TO_BYTE: Record<BlendMode, number> = {
  normal: 0, multiply: 1, dodge: 2, lighten: 3, darken: 4,
  burn: 5, invert: 6, rotate: 7, randomize: 8, hue: 9, color: 10,
};
const BYTE_TO_BLEND_MODE: BlendMode[] = [
  'normal', 'multiply', 'dodge', 'lighten', 'darken',
  'burn', 'invert', 'rotate', 'randomize', 'hue', 'color',
];

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface EmbeddedFile {
  id: string;
  name: string;
  widthL0: number;
  heightL0: number;
  data: Uint8Array;
}

export interface CompositionBundle {
  name: string;
  /** Composition snap grid level â€” unbounded integer; see CompositionState.gridLevel. */
  gridLevel: number;
  strokeScale: number;
  gridIntensity: number;
  camera: Camera;
  figures: CompositionFigure[];
  /** Scene-graph groups (v6+). Empty for older bundles. */
  groups?: GroupNode[];
  /** SVG path scene nodes (v12+, replaces lines+arcs from v8-v11). */
  svgObjects?: SVGObject[];
  /** Reference-image scene nodes (v10+). Bytes live in `imageBlobs`. */
  images?: ImageObject[];
  /** Pixel bytes per `imageId`, deduplicated across nodes (v10+). Keys
   *  are the same `imageId` strings the `images` array references. */
  imageBlobs?: Record<string, Uint8Array>;
  /** Unified backâ†’front paint order across every scene-object kind (v11+).
   *  When absent (older bundles), the loader derives it from the kind
   *  arrays in the legacy fixed paint order. */
  sceneOrder?: string[];
  /** Per-node Transform2D data (v14+). Maps node ID â†’ Transform2D.
   *  When present, consumers can build a nodeMap directly instead of
   *  deriving transforms from the legacy fields. When absent (â‰¤v13),
   *  use syncNodeMap() to derive from legacy arrays. */
  nodeTransforms?: Map<string, { transform: Transform2D; parentId?: string }>;
  /** Persisted user palette colors for this composition (v17+). Populated
   *  as the user picks non-default colors via the composer's color tool.
   *  Empty for older bundles. */
  customColors?: RGBColor[];
  /** Text scene nodes (v29+). Empty for older bundles. */
  texts?: TextObject[];
  /** Canvas background paint (v29+). Undefined = renderer default. */
  background?: Paint;
}

export interface DeserializedComposition {
  meta: CompositionBundle;
  embeddedFiles: EmbeddedFile[];
}

// â”€â”€ Fixed-point encoding â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function encodeFixed(value: number): number {
  return Math.round(value * 4);
}

function decodeFixed(stored: number): number {
  return stored / 4;
}

// â”€â”€ Rotation encoding â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const ROTATION_TO_BITS: Record<number, number> = { 0: 0, 90: 1, 180: 2, 270: 3 };
const BITS_TO_ROTATION: (0 | 90 | 180 | 270)[] = [0, 90, 180, 270];

// â”€â”€ String table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildStringTable(
  bundle: CompositionBundle,
  embeddedFiles: EmbeddedFile[],
): { strings: string[]; indexOf: Map<string, number> } {
  const indexOf = new Map<string, number>();
  const strings: string[] = [];

  function add(s: string | undefined | null): void {
    if (s == null) return;
    if (!indexOf.has(s)) {
      indexOf.set(s, strings.length);
      strings.push(s);
    }
  }

  // Composition name
  add(bundle.name);

  // Figure strings
  for (const fig of bundle.figures) {
    add(fig.id);
    add(fig.figureKey);
    add(fig.name);
    add(fig.fileId);
    add(fig.groupId);
    add(fig.preGroupName);
  }

  // Group strings (v6+, extended in v13 for nesting)
  if (bundle.groups) {
    for (const g of bundle.groups) {
      add(g.id);
      add(g.name);
      add(g.parentGroupId);
      add(g.preGroupName);
    }
  }

  // SVG object strings (v12+)
  if (bundle.svgObjects) {
    for (const s of bundle.svgObjects) {
      add(s.id);
      add(s.name);
      add(s.groupId);
      add(s.preGroupName);
    }
  }

  // Image strings (v10+)
  if (bundle.images) {
    for (const i of bundle.images) {
      add(i.id);
      add(i.imageId);
      add(i.originalImageId);
      add(i.name);
      add(i.groupId);
      add(i.preGroupName);
    }
  }

  // Text strings (v29+) â€” content and fontId ride the string table so
  // duplicated stickers / shared fonts are stored once.
  if (bundle.texts) {
    for (const t of bundle.texts) {
      add(t.id);
      add(t.name);
      add(t.groupId);
      add(t.preGroupName);
      add(t.content);
      add(t.style.fontId);
    }
  }

  // Scene order ids (v11+) â€” defensive; all ids should already be in the
  // table via the kind-array passes above, but `add` is idempotent.
  if (bundle.sceneOrder) {
    for (const id of bundle.sceneOrder) add(id);
  }

  // Node transform ids (v14+) â€” defensive; most ids are already in the
  // table via kind-array passes, but group-only nodes may not be.
  if (bundle.nodeTransforms) {
    for (const [id, entry] of bundle.nodeTransforms) {
      add(id);
      add(entry.parentId);
    }
  }

  // Embedded file strings
  for (const f of embeddedFiles) {
    add(f.id);
    add(f.name);
  }

  return { strings, indexOf };
}

// â”€â”€ Figure size estimation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function figureBinarySize(fig: CompositionFigure): number {
  // idIdx(2) + figureKeyIdx(2) + flags0(1) + flags1(1) + flags2(1)
  // + 6 required i16 fields (12)
  let size = 19;
  if (fig.name != null) size += 2;
  if (fig.fileId != null) size += 2;
  if (fig.groupId != null) size += 2;
  if (fig.preGroupName != null) size += 2;
  if (fig.identityCellX != null) size += 4;
  if (fig.tileWidthL0 != null) size += 8; // tileWidthL0(2) + tileHeightL0(2) + tileOffsetXL0(2) + tileOffsetYL0(2)
  if (fig.quads && fig.quads.length > 0) size += 1 + fig.quads.length * 8;
  if (fig.localCellX != null) size += 8;
  if (fig.colorOverride != null) size += 4; // r, g, b, blendModeByte
  return size;
}

// â”€â”€ SVG / Image flag bits (shared layout) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const FLAG_MIRROR_H = 0x01;
const FLAG_MIRROR_V = 0x02;
const FLAG_LOCKED = 0x04;
const FLAG_HAS_NAME = 0x08;
const FLAG_HAS_GROUP_ID = 0x10;
const FLAG_HAS_PRE_GROUP_NAME = 0x20;
const FLAG_HAS_LOCAL = 0x40;
const FLAG_HAS_IDENTITY = 0x80;

// v15+ flags2 bits â€” second flag byte, distinct from `flags` so the
// existing 8 bits stay untouched.
const FLAG2_HAS_CREATION_BOX = 0x01;
const FLAG2_HAS_LINE_DIRECTION = 0x02;
// Bits 0x0C carry the lineDirection enum when FLAG2_HAS_LINE_DIRECTION is set.
const LINE_DIR_HORIZONTAL = 0;
const LINE_DIR_VERTICAL = 1;
const LINE_DIR_DIAGONAL = 2;
// v20+ subpath flags.
const FLAG2_HAS_SUBPATHS = 0x10;
const FLAG2_HAS_LOCAL_SUBPATHS = 0x20;
// v21+ rectangle presence flag. Presence-only â€” `'rectangle'` is the only
// legal `shapeKind` value so no extra bytes are written.
const FLAG2_IS_RECTANGLE = 0x40;
// v24+ SVG flags3 byte. Sits right after flags2 in the SVG record header.
const FLAG3_SVG_HAS_FILL_COLOR = 0x01;
// v25+ "Use as mask" flag. Presence-only.
const FLAG3_SVG_USE_AS_MASK = 0x02;
// v26+ "hidden" flag (eye-icon visibility toggle). Presence-only.
const FLAG3_SVG_HIDDEN = 0x04;
// v27+ "pattern fill" flag (shape masks a tiled figure). Presence-only.
const FLAG3_SVG_PATTERN_FILL = 0x08;
// v28+: sparse per-copy segment overrides present (payload after fillColor).
const FLAG3_SVG_HAS_SEGMENT_OVERRIDES = 0x10;
// v29+: gradient/solid fillPaint present (paint payload after segmentOverrides).
const FLAG3_SVG_HAS_FILL_PAINT = 0x20;
// v29+: node effects present (effects payload after fillPaint).
const FLAG3_SVG_HAS_EFFECTS = 0x40;
// v31+: free rotation `angleDeg` present (i16 payload after effects).
const FLAG3_SVG_HAS_ANGLE = 0x80;

// v29+ image rotation-byte bits. The image `flags` byte is fully
// consumed (0x01..0x80), so tint/effects presence rides the spare high
// bits of the rotation byte: 0x03 rotation, 0x04 hidden (v14+), then:
const IMG_ROT_HAS_TINT = 0x08;
const IMG_ROT_HAS_EFFECTS = 0x10;
// v31+: free rotation `angleDeg` present (i16 payload after effects).
const IMG_ROT_HAS_ANGLE = 0x20;
// v33+: framing ("Crop" bar) and cornerRadius present. Payloads follow the
// v31 angleDeg block, in this bit order.
const IMG_ROT_HAS_FRAMING = 0x40;
const IMG_ROT_HAS_CORNER = 0x80;

// v33 framing sub-flags (second byte of the framing payload): which optional
// fields follow the mode byte, in bit order. Every numeric is an f32; `ratio`
// is a single enum byte.
const FRAMING_HAS_ZOOM = 0x01;
const FRAMING_HAS_MARGIN = 0x02;
const FRAMING_HAS_RATIO = 0x04;
const FRAMING_HAS_ANGLE = 0x08;
const FRAMING_HAS_TILE_SCALE = 0x10;
const FRAMING_HAS_TILE_GAP = 0x20;
const FRAMING_HAS_OFFSET_X = 0x40;
const FRAMING_HAS_OFFSET_Y = 0x80;

const FRAMING_MODE_TO_BYTE: Record<ImageFraming['mode'], number> = { fill: 0, fit: 1, crop: 2, tile: 3 };
const BYTE_TO_FRAMING_MODE: ImageFraming['mode'][] = ['fill', 'fit', 'crop', 'tile'];
const FRAMING_RATIO_TO_BYTE: Record<NonNullable<ImageFraming['ratio']>, number> = {
  free: 0, square: 1, fourFive: 2, sixteenNine: 3,
};
const BYTE_TO_FRAMING_RATIO: NonNullable<ImageFraming['ratio']>[] = ['free', 'square', 'fourFive', 'sixteenNine'];

/** Byte length of an image's v33 framing block (mode + subflags + present
 *  fields). Mirrors `writeFraming` exactly so `imageBinarySize` stays correct. */
function framingBinarySize(f: ImageFraming): number {
  let size = 2; // modeByte + subflags
  if (f.zoom != null) size += 8;
  if (f.margin != null) size += 8;
  if (f.ratio != null) size += 1;
  if (f.angle != null) size += 8;
  if (f.tileScale != null) size += 8;
  if (f.tileGap != null) size += 8;
  if (f.offsetX != null) size += 8;
  if (f.offsetY != null) size += 8;
  return size;
}

/** Write an image's framing: mode byte, a sub-flags byte marking which optional
 *  fields are present, then those fields (ratio as an enum byte, every numeric
 *  as f32). Only set fields are written so an untouched framing stays compact
 *  and round-trips to the same `resolveFraming` result. */
function writeFraming(view: DataView, out: Uint8Array, pos: number, f: ImageFraming): number {
  out[pos++] = FRAMING_MODE_TO_BYTE[f.mode] ?? 0;
  let sub = 0;
  if (f.zoom != null) sub |= FRAMING_HAS_ZOOM;
  if (f.margin != null) sub |= FRAMING_HAS_MARGIN;
  if (f.ratio != null) sub |= FRAMING_HAS_RATIO;
  if (f.angle != null) sub |= FRAMING_HAS_ANGLE;
  if (f.tileScale != null) sub |= FRAMING_HAS_TILE_SCALE;
  if (f.tileGap != null) sub |= FRAMING_HAS_TILE_GAP;
  if (f.offsetX != null) sub |= FRAMING_HAS_OFFSET_X;
  if (f.offsetY != null) sub |= FRAMING_HAS_OFFSET_Y;
  out[pos++] = sub;
  if (f.zoom != null) { view.setFloat64(pos, f.zoom, true); pos += 8; }
  if (f.margin != null) { view.setFloat64(pos, f.margin, true); pos += 8; }
  if (f.ratio != null) { out[pos++] = FRAMING_RATIO_TO_BYTE[f.ratio] ?? 0; }
  if (f.angle != null) { view.setFloat64(pos, f.angle, true); pos += 8; }
  if (f.tileScale != null) { view.setFloat64(pos, f.tileScale, true); pos += 8; }
  if (f.tileGap != null) { view.setFloat64(pos, f.tileGap, true); pos += 8; }
  if (f.offsetX != null) { view.setFloat64(pos, f.offsetX, true); pos += 8; }
  if (f.offsetY != null) { view.setFloat64(pos, f.offsetY, true); pos += 8; }
  return pos;
}

/** Read a v33 framing block written by `writeFraming`. */
function readFraming(view: DataView, data: Uint8Array, pos: number): { framing: ImageFraming; pos: number } {
  const mode = BYTE_TO_FRAMING_MODE[data[pos++]] ?? 'fill';
  const sub = data[pos++];
  const framing: ImageFraming = { mode };
  if (sub & FRAMING_HAS_ZOOM) { framing.zoom = view.getFloat64(pos, true); pos += 8; }
  if (sub & FRAMING_HAS_MARGIN) { framing.margin = view.getFloat64(pos, true); pos += 8; }
  if (sub & FRAMING_HAS_RATIO) { framing.ratio = BYTE_TO_FRAMING_RATIO[data[pos++]] ?? 'free'; }
  if (sub & FRAMING_HAS_ANGLE) { framing.angle = view.getFloat64(pos, true); pos += 8; }
  if (sub & FRAMING_HAS_TILE_SCALE) { framing.tileScale = view.getFloat64(pos, true); pos += 8; }
  if (sub & FRAMING_HAS_TILE_GAP) { framing.tileGap = view.getFloat64(pos, true); pos += 8; }
  if (sub & FRAMING_HAS_OFFSET_X) { framing.offsetX = view.getFloat64(pos, true); pos += 8; }
  if (sub & FRAMING_HAS_OFFSET_Y) { framing.offsetY = view.getFloat64(pos, true); pos += 8; }
  return { framing, pos };
}

// v34+ per-image `flags2` byte (the rotation byte is full after v33). Bit 0x01
// marks an `originalImageId`, whose u16 string-table index follows the byte.
const IMG_FLAGS2_HAS_ORIGINAL = 0x01;

// v31+ free-rotation encoding: i16 hundredths of a degree (angleDeg * 100).
// Range ±180° fits comfortably in i16 (±18000), precision 0.01°.
const ANGLE_DEG_SCALE = 100;
function encodeAngleDeg(deg: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(deg * ANGLE_DEG_SCALE)));
}
function decodeAngleDeg(raw: number): number {
  return raw / ANGLE_DEG_SCALE;
}

// v29+ text record flag bits (first flags byte).
const TFLAG_MIRROR_H = 0x01;
const TFLAG_MIRROR_V = 0x02;
const TFLAG_LOCKED = 0x04;
const TFLAG_HAS_NAME = 0x08;
const TFLAG_HAS_GROUP_ID = 0x10;
const TFLAG_HAS_PRE_GROUP_NAME = 0x20;
const TFLAG_HIDDEN = 0x40;
const TFLAG_STICKER = 0x80;
// v29+ text record flags2 bits (optional blocks, mirroring how figure /
// image records gate optional bbox blocks behind their flags2 byte).
const TFLAG2_HAS_LOCAL = 0x01;
const TFLAG2_HAS_IDENTITY = 0x02;
const TFLAG2_HAS_EFFECTS = 0x04;
// v31+: free rotation `angleDeg` present (i16 payload after effects).
const TFLAG2_HAS_ANGLE = 0x08;
// v29+ text style flag bits.
const TSTYLE_BOLD = 0x01;
const TSTYLE_ITALIC = 0x02;
const TSTYLE_HAS_STROKE = 0x04;
const TSTYLE_HAS_LETTER_SPACING = 0x08;
const TSTYLE_HAS_LINE_HEIGHT = 0x10;
// Bits 0x60 carry the align enum: 0 = absent (undefined), 1/2/3 =
// left/center/right, so an explicit 'left' round-trips distinct from
// "not set" (same presence-is-the-signal rule as colorOverride).
const ALIGN_TO_BITS: Record<TextAlign, number> = { left: 1, center: 2, right: 3 };
const BITS_TO_ALIGN: (TextAlign | undefined)[] = [undefined, 'left', 'center', 'right'];
// Bit 0x80 flags a trailing weight byte (appended after the stroke block).
// Purely presence-gated — files written before the weight control never set
// it, so older saves read back unchanged.
const TSTYLE_HAS_WEIGHT = 0x80;
const WEIGHT_TO_BITS: Record<FontWeight, number> = { light: 0, regular: 1, semibold: 2, bold: 3 };
const BITS_TO_WEIGHT: FontWeight[] = ['light', 'regular', 'semibold', 'bold'];

// v29+ image tint mode byte.
const TINT_MODE_TO_BYTE: Record<ImageTintMode, number> = { tint: 0, duotone: 1, wash: 2 };
const BYTE_TO_TINT_MODE: ImageTintMode[] = ['tint', 'duotone', 'wash'];

// v29+ effects presence mask bits.
const EFFECT_HAS_SHADOW = 0x01;
const EFFECT_HAS_GLOW = 0x02;
const EFFECT_HAS_BORDER = 0x04;

// v29+ paint kind byte.
const PAINT_KIND_SOLID = 0;
const PAINT_KIND_LINEAR = 1;
const PAINT_KIND_RADIAL = 2;

// â”€â”€ Paint / effects payload helpers (v29+) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Quantize a [0,1] float to a u8. */
function quantize255(v: number): number {
  return Math.round(Math.max(0, Math.min(1, v)) * 255) & 0xff;
}

function paintBinarySize(paint: Paint): number {
  // kindByte(1)
  if (paint.kind === 'solid') return 1 + 4; // r,g,b,alpha
  // stopCount(1) + stops(5 each: offset,r,g,b,alpha) + coords (f32 each)
  const base = 1 + 1 + paint.stops.length * 5;
  return paint.kind === 'linear' ? base + 16 : base + 12;
}

function writeGradientStops(out: Uint8Array, pos: number, stops: GradientStop[]): number {
  if (stops.length > 0xff) {
    throw new Error(`Composition serialization: gradient stop count ${stops.length} exceeds u8 max (255).`);
  }
  out[pos++] = stops.length;
  for (const s of stops) {
    out[pos++] = quantize255(s.offset);
    out[pos++] = s.color.r & 0xff;
    out[pos++] = s.color.g & 0xff;
    out[pos++] = s.color.b & 0xff;
    out[pos++] = s.alpha != null ? quantize255(s.alpha) : 255;
  }
  return pos;
}

function readGradientStops(data: Uint8Array, pos: number): { stops: GradientStop[]; pos: number } {
  const count = data[pos++];
  const stops: GradientStop[] = [];
  for (let i = 0; i < count; i++) {
    const offset = data[pos++] / 255;
    const r = data[pos++], g = data[pos++], b = data[pos++];
    const alphaByte = data[pos++];
    const stop: GradientStop = { offset, color: { r, g, b } };
    if (alphaByte < 255) stop.alpha = alphaByte / 255;
    stops.push(stop);
  }
  return { stops, pos };
}

function writePaint(view: DataView, out: Uint8Array, pos: number, paint: Paint): number {
  if (paint.kind === 'solid') {
    out[pos++] = PAINT_KIND_SOLID;
    out[pos++] = paint.color.r & 0xff;
    out[pos++] = paint.color.g & 0xff;
    out[pos++] = paint.color.b & 0xff;
    out[pos++] = paint.alpha != null ? quantize255(paint.alpha) : 255;
    return pos;
  }
  if (paint.kind === 'linear') {
    out[pos++] = PAINT_KIND_LINEAR;
    pos = writeGradientStops(out, pos, paint.stops);
    view.setFloat32(pos, paint.x1, true); pos += 4;
    view.setFloat32(pos, paint.y1, true); pos += 4;
    view.setFloat32(pos, paint.x2, true); pos += 4;
    view.setFloat32(pos, paint.y2, true); pos += 4;
    return pos;
  }
  out[pos++] = PAINT_KIND_RADIAL;
  pos = writeGradientStops(out, pos, paint.stops);
  view.setFloat32(pos, paint.cx, true); pos += 4;
  view.setFloat32(pos, paint.cy, true); pos += 4;
  view.setFloat32(pos, paint.r, true); pos += 4;
  return pos;
}

function readPaint(view: DataView, data: Uint8Array, pos: number): { paint: Paint; pos: number } {
  const kindByte = data[pos++];
  if (kindByte === PAINT_KIND_SOLID) {
    const r = data[pos++], g = data[pos++], b = data[pos++];
    const alphaByte = data[pos++];
    const paint: Paint = { kind: 'solid', color: { r, g, b } };
    if (alphaByte < 255) paint.alpha = alphaByte / 255;
    return { paint, pos };
  }
  const s = readGradientStops(data, pos);
  pos = s.pos;
  if (kindByte === PAINT_KIND_LINEAR) {
    const x1 = view.getFloat32(pos, true); pos += 4;
    const y1 = view.getFloat32(pos, true); pos += 4;
    const x2 = view.getFloat32(pos, true); pos += 4;
    const y2 = view.getFloat32(pos, true); pos += 4;
    return { paint: { kind: 'linear', stops: s.stops, x1, y1, x2, y2 }, pos };
  }
  if (kindByte !== PAINT_KIND_RADIAL) {
    throw new Error(`Corrupt .tile: unknown paint kind byte ${kindByte}.`);
  }
  const cx = view.getFloat32(pos, true); pos += 4;
  const cy = view.getFloat32(pos, true); pos += 4;
  const r = view.getFloat32(pos, true); pos += 4;
  return { paint: { kind: 'radial', stops: s.stops, cx, cy, r }, pos };
}

function effectsBinarySize(fx: NodeEffects): number {
  let size = 1; // presenceMask
  if (fx.shadow) size += 12 + 4;            // dx,dy,blur f32 + r,g,b,alpha u8
  if (fx.glow) size += 4 + 4;               // radius f32 + r,g,b,alpha u8
  if (fx.border) size += 4 + 3 + 1 + (fx.border.radius != null ? 4 : 0);
  return size;
}

function writeEffects(view: DataView, out: Uint8Array, pos: number, fx: NodeEffects): number {
  let mask = 0;
  if (fx.shadow) mask |= EFFECT_HAS_SHADOW;
  if (fx.glow) mask |= EFFECT_HAS_GLOW;
  if (fx.border) mask |= EFFECT_HAS_BORDER;
  out[pos++] = mask;
  if (fx.shadow) {
    view.setFloat32(pos, fx.shadow.dx, true); pos += 4;
    view.setFloat32(pos, fx.shadow.dy, true); pos += 4;
    view.setFloat32(pos, fx.shadow.blur, true); pos += 4;
    out[pos++] = fx.shadow.color.r & 0xff;
    out[pos++] = fx.shadow.color.g & 0xff;
    out[pos++] = fx.shadow.color.b & 0xff;
    out[pos++] = quantize255(fx.shadow.alpha);
  }
  if (fx.glow) {
    view.setFloat32(pos, fx.glow.radius, true); pos += 4;
    out[pos++] = fx.glow.color.r & 0xff;
    out[pos++] = fx.glow.color.g & 0xff;
    out[pos++] = fx.glow.color.b & 0xff;
    out[pos++] = quantize255(fx.glow.alpha);
  }
  if (fx.border) {
    view.setFloat32(pos, fx.border.width, true); pos += 4;
    out[pos++] = fx.border.color.r & 0xff;
    out[pos++] = fx.border.color.g & 0xff;
    out[pos++] = fx.border.color.b & 0xff;
    if (fx.border.radius != null) {
      out[pos++] = 1;
      view.setFloat32(pos, fx.border.radius, true); pos += 4;
    } else {
      out[pos++] = 0;
    }
  }
  return pos;
}

function readEffects(view: DataView, data: Uint8Array, pos: number): { effects: NodeEffects; pos: number } {
  const mask = data[pos++];
  const effects: NodeEffects = {};
  if (mask & EFFECT_HAS_SHADOW) {
    const dx = view.getFloat32(pos, true); pos += 4;
    const dy = view.getFloat32(pos, true); pos += 4;
    const blur = view.getFloat32(pos, true); pos += 4;
    const r = data[pos++], g = data[pos++], b = data[pos++];
    const alpha = data[pos++] / 255;
    effects.shadow = { dx, dy, blur, color: { r, g, b }, alpha };
  }
  if (mask & EFFECT_HAS_GLOW) {
    const radius = view.getFloat32(pos, true); pos += 4;
    const r = data[pos++], g = data[pos++], b = data[pos++];
    const alpha = data[pos++] / 255;
    effects.glow = { radius, color: { r, g, b }, alpha };
  }
  if (mask & EFFECT_HAS_BORDER) {
    const width = view.getFloat32(pos, true); pos += 4;
    const r = data[pos++], g = data[pos++], b = data[pos++];
    const hasRadius = data[pos++];
    effects.border = { width, color: { r, g, b } };
    if (hasRadius === 1) {
      effects.border.radius = view.getFloat32(pos, true); pos += 4;
    }
  }
  return { effects, pos };
}

function subpathArraySize(subs: ReadonlyArray<SVGSubpath>): number {
  // u16 count + per-subpath { rgb(3) + segCount(2) + segments }
  let size = 2;
  for (const sub of subs) {
    size += 3 + 2 + segmentArraySize(sub.segments);
  }
  return size;
}

function svgBinarySize(svg: SVGObject): number {
  // idIdx(2) + flags(1) + flags2(1, v15+) + flags3(1, v24+) + rotBits(1) + color(3) + segmentCount(2)
  let size = 11;
  if (svg.name != null) size += 2;
  if (svg.groupId != null) size += 2;
  if (svg.preGroupName != null) size += 2;
  size += segmentArraySize(svg.segments);
  if (svg.localSegments != null) size += 2 + segmentArraySize(svg.localSegments);
  if (svg.identitySegments != null) size += 2 + segmentArraySize(svg.identitySegments);
  // Tile-mode payload: tile dims/offsets (8) + dragged-region bbox (8, v19+).
  // The region is NOT recoverable from segment AABB (segments only describe
  // one tile) so we persist it explicitly.
  if (svg.tileMode === 'repeat') size += 16;
  if (svg.creationBox) size += 8;            // minX(2) + minY(2) + width(2) + height(2)
  if (Array.isArray(svg.subpaths) && svg.subpaths.length > 0) {
    size += subpathArraySize(svg.subpaths);
  }
  if (Array.isArray(svg.localSubpaths) && svg.localSubpaths.length > 0) {
    size += subpathArraySize(svg.localSubpaths);
  }
  if (svg.fillColor) size += 4;
  if (svg.segmentOverrides && svg.segmentOverrides.size > 0) size += 2 + svg.segmentOverrides.size * 7;
  if (svg.fillPaint) size += paintBinarySize(svg.fillPaint);
  if (svg.effects) size += effectsBinarySize(svg.effects);
  if (svg.angleDeg) size += 2; // v31+ free rotation (i16)
  return size;
}

function segmentBinarySize(seg: PathSegment): number {
  // kind(1) + start(4) + end(4) [+ center(4) for arc]
  return seg.kind === 'arc' ? 13 : 9;
}

function segmentArraySize(segs: PathSegment[]): number {
  let n = 0;
  for (const s of segs) n += segmentBinarySize(s);
  return n;
}

/** Image record size â€” bbox-only payload, plus optional local + identity
 *  bboxes (8 bytes each) when present. Mirrors the SVG shape so the
 *  reader can use the same flag bits. */
function imageBinarySize(img: ImageObject): number {
  // idIdx(2) + flags(1) + rotBits(1) + mimeBit(1) + opacity(1)
  // + imageIdIdx(2) + pixelWidth(2) + pixelHeight(2)
  // + cellX/Y/W/H (i16 Ã— 4 = 8) = 20
  let size = 20;
  if (img.name != null) size += 2;
  if (img.groupId != null) size += 2;
  if (img.preGroupName != null) size += 2;
  if (img.localCellX != null) size += 8;
  if (img.identityCellX != null) size += 8;
  if (img.tint) size += 5; // r,g,b + amount + mode
  if (img.effects) size += effectsBinarySize(img.effects);
  if (img.angleDeg) size += 2; // v31+ free rotation (i16)
  if (img.framing) size += framingBinarySize(img.framing); // v33+
  if (img.cornerRadius) size += 8; // v33+ (f64)
  size += 1; // v34+ image flags2 byte (always written by the current writer)
  if (img.originalImageId != null) size += 2; // v34+ originalImageId index
  return size;
}

// â”€â”€ SVG write + read helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Write a u16 count field, throwing a clear error if the count would
 * silently truncate. Without this guard, a count > 65535 wraps to
 * `count & 0xffff`, the reader gets the wrong segment count, and every
 * subsequent SVG record in the file misaligns â€” producing a "silent
 * corruption" .tile that crashes on import with a cryptic "Offset is
 * outside the bounds of the DataView" error. Real-world cause: paint
 * strokes that double geometry on every pass (bug we've fixed
 * elsewhere) can blow past 65535 within ~14 passes.
 */
function writeCount16(view: DataView, pos: number, count: number, label: string): number {
  if (count > 0xffff) {
    throw new Error(`Composition serialization: ${label} count ${count} exceeds u16 max (65535). Refusing to write a corrupt .tile.`);
  }
  view.setUint16(pos, count, true);
  return pos + 2;
}

function writeSegments(view: DataView, out: Uint8Array, pos: number, segs: PathSegment[]): number {
  for (const seg of segs) {
    out[pos++] = seg.kind === 'arc' ? 1 : 0;
    view.setInt16(pos, encodeFixed(seg.start[0]), true); pos += 2;
    view.setInt16(pos, encodeFixed(seg.start[1]), true); pos += 2;
    view.setInt16(pos, encodeFixed(seg.end[0]), true); pos += 2;
    view.setInt16(pos, encodeFixed(seg.end[1]), true); pos += 2;
    if (seg.kind === 'arc') {
      view.setInt16(pos, encodeFixed(seg.center[0]), true); pos += 2;
      view.setInt16(pos, encodeFixed(seg.center[1]), true); pos += 2;
    }
  }
  return pos;
}

function readSegments(view: DataView, data: Uint8Array, pos: number, count: number): { segs: PathSegment[]; pos: number } {
  const segs: PathSegment[] = [];
  for (let i = 0; i < count; i++) {
    const kind = data[pos++];
    const sx = decodeFixed(view.getInt16(pos, true)); pos += 2;
    const sy = decodeFixed(view.getInt16(pos, true)); pos += 2;
    const ex = decodeFixed(view.getInt16(pos, true)); pos += 2;
    const ey = decodeFixed(view.getInt16(pos, true)); pos += 2;
    if (kind === 1) {
      const cx = decodeFixed(view.getInt16(pos, true)); pos += 2;
      const cy = decodeFixed(view.getInt16(pos, true)); pos += 2;
      segs.push({ kind: 'arc', start: [sx, sy], end: [ex, ey], center: [cx, cy] });
    } else {
      segs.push({ kind: 'line', start: [sx, sy], end: [ex, ey] });
    }
  }
  return { segs, pos };
}

// v20+: per-color subpath splits from drag-paint / join ops. Each
// subpath = 3 bytes RGB + u16 segment count + segments.
function writeSubpaths(view: DataView, out: Uint8Array, pos: number, subs: ReadonlyArray<SVGSubpath>): number {
  pos = writeCount16(view, pos, subs.length, 'subpaths');
  for (const sub of subs) {
    out[pos++] = sub.color.r & 0xff;
    out[pos++] = sub.color.g & 0xff;
    out[pos++] = sub.color.b & 0xff;
    pos = writeCount16(view, pos, sub.segments.length, 'subpath.segments');
    pos = writeSegments(view, out, pos, sub.segments);
  }
  return pos;
}

function readSubpaths(view: DataView, data: Uint8Array, pos: number): { subs: SVGSubpath[]; pos: number } {
  const count = view.getUint16(pos, true); pos += 2;
  const subs: SVGSubpath[] = [];
  for (let i = 0; i < count; i++) {
    if (pos + 5 > data.byteLength) {
      throw new Error(`Corrupt .tile: subpath ${i}/${count} header runs past file end (likely a count overflow during save).`);
    }
    const r = data[pos++];
    const g = data[pos++];
    const b = data[pos++];
    const segCount = view.getUint16(pos, true); pos += 2;
    // Minimum bytes a segment can occupy is 9 (line). If the declared
    // segment count claims more bytes than remain in the buffer, the
    // file is corrupt and we error out with a clear message rather than
    // letting DataView throw "Offset is outside the bounds of the
    // DataView" five frames deeper.
    if (segCount * 9 > data.byteLength - pos) {
      throw new Error(`Corrupt .tile: subpath ${i}/${count} claims ${segCount} segments but only ${data.byteLength - pos} bytes remain.`);
    }
    const s = readSegments(view, data, pos, segCount);
    pos = s.pos;
    subs.push({ color: { r, g, b }, segments: s.segs });
  }
  return { subs, pos };
}

function writeSVG(
  view: DataView,
  out: Uint8Array,
  pos: number,
  svg: SVGObject,
  indexOf: Map<string, number>,
): number {
  view.setUint16(pos, indexOf.get(svg.id) ?? 0, true); pos += 2;

  let flags = 0;
  if (svg.mirrorH) flags |= FLAG_MIRROR_H;
  if (svg.mirrorV) flags |= FLAG_MIRROR_V;
  if (svg.locked) flags |= FLAG_LOCKED;
  if (svg.name != null) flags |= FLAG_HAS_NAME;
  if (svg.groupId != null) flags |= FLAG_HAS_GROUP_ID;
  if (svg.preGroupName != null) flags |= FLAG_HAS_PRE_GROUP_NAME;
  if (svg.localSegments != null) flags |= FLAG_HAS_LOCAL;
  if (svg.identitySegments != null) flags |= FLAG_HAS_IDENTITY;
  out[pos++] = flags;

  // flags2 (v15+): hasCreationBox, hasLineDirection + 2-bit dir enum.
  // v20+: hasSubpaths, hasLocalSubpaths.
  let flags2 = 0;
  if (svg.creationBox) flags2 |= FLAG2_HAS_CREATION_BOX;
  if (svg.lineDirection != null) {
    flags2 |= FLAG2_HAS_LINE_DIRECTION;
    const dirBits = svg.lineDirection === 'horizontal' ? LINE_DIR_HORIZONTAL
      : svg.lineDirection === 'vertical' ? LINE_DIR_VERTICAL
      : LINE_DIR_DIAGONAL;
    flags2 |= (dirBits & 0x03) << 2;
  }
  if (Array.isArray(svg.subpaths) && svg.subpaths.length > 0) flags2 |= FLAG2_HAS_SUBPATHS;
  if (Array.isArray(svg.localSubpaths) && svg.localSubpaths.length > 0) flags2 |= FLAG2_HAS_LOCAL_SUBPATHS;
  if (svg.shapeKind === 'rectangle') flags2 |= FLAG2_IS_RECTANGLE;
  out[pos++] = flags2;

  // flags3 (v24+)
  let flags3 = 0;
  if (svg.fillColor) flags3 |= FLAG3_SVG_HAS_FILL_COLOR;
  if (svg.isMask) flags3 |= FLAG3_SVG_USE_AS_MASK;
  if (svg.hidden) flags3 |= FLAG3_SVG_HIDDEN;
  if (svg.isPatternFill) flags3 |= FLAG3_SVG_PATTERN_FILL;
  if (svg.segmentOverrides && svg.segmentOverrides.size > 0) flags3 |= FLAG3_SVG_HAS_SEGMENT_OVERRIDES;
  if (svg.fillPaint) flags3 |= FLAG3_SVG_HAS_FILL_PAINT;
  if (svg.effects) flags3 |= FLAG3_SVG_HAS_EFFECTS;
  if (svg.angleDeg) flags3 |= FLAG3_SVG_HAS_ANGLE;
  out[pos++] = flags3;

  let rotBits = ROTATION_TO_BITS[svg.rotation ?? 0] & 0x03;
  if (svg.tileMode === 'repeat') rotBits |= 0x04;
  out[pos++] = rotBits;

  out[pos++] = svg.color.r & 0xff;
  out[pos++] = svg.color.g & 0xff;
  out[pos++] = svg.color.b & 0xff;

  if (svg.name != null) { view.setUint16(pos, indexOf.get(svg.name) ?? 0, true); pos += 2; }
  if (svg.groupId != null) { view.setUint16(pos, indexOf.get(svg.groupId) ?? 0, true); pos += 2; }
  if (svg.preGroupName != null) { view.setUint16(pos, indexOf.get(svg.preGroupName) ?? 0, true); pos += 2; }

  pos = writeCount16(view, pos, svg.segments.length, `svg(${svg.id}).segments`);
  pos = writeSegments(view, out, pos, svg.segments);

  if (svg.localSegments != null) {
    pos = writeCount16(view, pos, svg.localSegments.length, `svg(${svg.id}).localSegments`);
    pos = writeSegments(view, out, pos, svg.localSegments);
  }
  if (svg.identitySegments != null) {
    pos = writeCount16(view, pos, svg.identitySegments.length, `svg(${svg.id}).identitySegments`);
    pos = writeSegments(view, out, pos, svg.identitySegments);
  }
  if (svg.tileMode === 'repeat') {
    view.setInt16(pos, encodeFixed(svg.tileWidthL0!), true); pos += 2;
    view.setInt16(pos, encodeFixed(svg.tileHeightL0!), true); pos += 2;
    view.setInt16(pos, encodeFixed(svg.tileOffsetXL0 ?? 0), true); pos += 2;
    view.setInt16(pos, encodeFixed(svg.tileOffsetYL0 ?? 0), true); pos += 2;
    // Dragged region bbox (v19+). Width/height are non-negative; written
    // as uint16 to match the creationBox convention below.
    view.setInt16(pos, encodeFixed(svg.cellX), true); pos += 2;
    view.setInt16(pos, encodeFixed(svg.cellY), true); pos += 2;
    view.setUint16(pos, encodeFixed(svg.cellWidth), true); pos += 2;
    view.setUint16(pos, encodeFixed(svg.cellHeight), true); pos += 2;
  }
  if (svg.creationBox) {
    view.setInt16(pos, encodeFixed(svg.creationBox.minX), true); pos += 2;
    view.setInt16(pos, encodeFixed(svg.creationBox.minY), true); pos += 2;
    // width/height are non-negative; encodeFixed produces values â‰¤ 32767
    // for any realistic L0 cell extent, so int16 is wide enough to encode
    // them as unsigned. Read side uses getUint16 to round-trip.
    view.setUint16(pos, encodeFixed(svg.creationBox.width), true); pos += 2;
    view.setUint16(pos, encodeFixed(svg.creationBox.height), true); pos += 2;
  }
  // v20+: per-color subpaths (and their local-space mirror for grouped
  // members). Empty arrays are flagged off above so no marker bytes are
  // written in the common case.
  if (Array.isArray(svg.subpaths) && svg.subpaths.length > 0) {
    pos = writeSubpaths(view, out, pos, svg.subpaths);
  }
  if (Array.isArray(svg.localSubpaths) && svg.localSubpaths.length > 0) {
    pos = writeSubpaths(view, out, pos, svg.localSubpaths);
  }
  // v24+ fillColor + fillOpacity
  if (svg.fillColor) {
    out[pos++] = svg.fillColor.r & 0xff;
    out[pos++] = svg.fillColor.g & 0xff;
    out[pos++] = svg.fillColor.b & 0xff;
    out[pos++] = Math.round((svg.fillOpacity ?? 1) * 255) & 0xff;
  }
  // v28+ sparse per-copy segment overrides (after fillColor in the stream).
  if (svg.segmentOverrides && svg.segmentOverrides.size > 0) {
    pos = writeCount16(view, pos, svg.segmentOverrides.size, `svg(${svg.id}).segmentOverrides`);
    for (const [key, c] of svg.segmentOverrides) {
      view.setUint32(pos, key >>> 0, true); pos += 4;
      out[pos++] = c.r & 0xff;
      out[pos++] = c.g & 0xff;
      out[pos++] = c.b & 0xff;
    }
  }
  // v29+ fillPaint then effects (flag-bit order, after segmentOverrides).
  if (svg.fillPaint) {
    pos = writePaint(view, out, pos, svg.fillPaint);
  }
  if (svg.effects) {
    pos = writeEffects(view, out, pos, svg.effects);
  }
  // v31+ free rotation (i16), after effects.
  if (svg.angleDeg) {
    view.setInt16(pos, encodeAngleDeg(svg.angleDeg), true); pos += 2;
  }
  return pos;
}

function readSVG(
  view: DataView,
  data: Uint8Array,
  pos: number,
  strings: string[],
  version: number,
  gridLevel: number,
): { svg: SVGObject; pos: number } {
  const idIdx = view.getUint16(pos, true); pos += 2;
  const flags = data[pos++];
  // v15+ adds a flags2 byte right after flags. v14 files don't have it,
  // so we synthesize zero (no creationBox, no lineDirection).
  const flags2 = version >= 15 ? data[pos++] : 0;
  // v24+ adds a flags3 byte right after flags2 (fillColor presence).
  const flags3 = version >= 24 ? data[pos++] : 0;
  const rotBits = data[pos++];
  const r = data[pos++];
  const g = data[pos++];
  const b = data[pos++];

  let name: string | undefined;
  let groupId: string | undefined;
  let preGroupName: string | undefined;
  if (flags & FLAG_HAS_NAME) { name = strings[view.getUint16(pos, true)]; pos += 2; }
  if (flags & FLAG_HAS_GROUP_ID) { groupId = strings[view.getUint16(pos, true)]; pos += 2; }
  if (flags & FLAG_HAS_PRE_GROUP_NAME) { preGroupName = strings[view.getUint16(pos, true)]; pos += 2; }

  const segCount = view.getUint16(pos, true); pos += 2;
  const s = readSegments(view, data, pos, segCount);
  pos = s.pos;

  const bb = arcBoundingBox(s.segs);
  const svg: SVGObject = {
    id: strings[idIdx],
    segments: s.segs,
    color: { r, g, b },
    cellX: bb?.minX ?? 0,
    cellY: bb?.minY ?? 0,
    cellWidth: bb ? bb.maxX - bb.minX : 0,
    cellHeight: bb ? bb.maxY - bb.minY : 0,
  };
  if (name != null) svg.name = name;
  if (groupId != null) svg.groupId = groupId;
  if (preGroupName != null) svg.preGroupName = preGroupName;
  if (flags & FLAG_MIRROR_H) svg.mirrorH = true;
  if (flags & FLAG_MIRROR_V) svg.mirrorV = true;
  if (flags & FLAG_LOCKED) svg.locked = true;
  const rot = BITS_TO_ROTATION[rotBits & 0x03];
  if (rot !== 0) svg.rotation = rot;

  if (flags & FLAG_HAS_LOCAL) {
    const c = view.getUint16(pos, true); pos += 2;
    const ls = readSegments(view, data, pos, c);
    svg.localSegments = ls.segs;
    const lbb = arcBoundingBox(ls.segs);
    if (lbb) {
      svg.localCellX = lbb.minX;
      svg.localCellY = lbb.minY;
      svg.localCellWidth = lbb.maxX - lbb.minX;
      svg.localCellHeight = lbb.maxY - lbb.minY;
    }
    pos = ls.pos;
  }
  if (flags & FLAG_HAS_IDENTITY) {
    const c = view.getUint16(pos, true); pos += 2;
    const is_ = readSegments(view, data, pos, c);
    svg.identitySegments = is_.segs;
    pos = is_.pos;
  }

  // tile mode
  if (rotBits & 0x04) {
    svg.tileMode = 'repeat';
    svg.tileWidthL0 = decodeFixed(view.getInt16(pos, true)); pos += 2;
    svg.tileHeightL0 = decodeFixed(view.getInt16(pos, true)); pos += 2;
    if (version >= 18) {
      const ox = decodeFixed(view.getInt16(pos, true)); pos += 2;
      const oy = decodeFixed(view.getInt16(pos, true)); pos += 2;
      if (ox !== 0) svg.tileOffsetXL0 = ox;
      if (oy !== 0) svg.tileOffsetYL0 = oy;
    }
    if (version >= 19) {
      // Persisted dragged-region bbox. Overrides the segment-AABB bbox
      // assigned above â€” for tile-mode SVGs the segments are just one
      // tile and the region can extend well past them.
      svg.cellX = decodeFixed(view.getInt16(pos, true)); pos += 2;
      svg.cellY = decodeFixed(view.getInt16(pos, true)); pos += 2;
      svg.cellWidth = decodeFixed(view.getUint16(pos, true)); pos += 2;
      svg.cellHeight = decodeFixed(view.getUint16(pos, true)); pos += 2;
    }
  }

  if (flags2 & FLAG2_HAS_CREATION_BOX) {
    const minX = decodeFixed(view.getInt16(pos, true)); pos += 2;
    const minY = decodeFixed(view.getInt16(pos, true)); pos += 2;
    const width = decodeFixed(view.getUint16(pos, true)); pos += 2;
    const height = decodeFixed(view.getUint16(pos, true)); pos += 2;
    svg.creationBox = { minX, minY, width, height };
  }
  // v20+: per-color subpaths and their local-space mirror. Read AFTER
  // creationBox so the position lines up with the writer. Older files
  // never have these flag bits set, so they're a no-op pre-v20.
  if (version >= 20 && (flags2 & FLAG2_HAS_SUBPATHS)) {
    const r2 = readSubpaths(view, data, pos);
    svg.subpaths = r2.subs;
    pos = r2.pos;
  }
  if (version >= 20 && (flags2 & FLAG2_HAS_LOCAL_SUBPATHS)) {
    const r3 = readSubpaths(view, data, pos);
    svg.localSubpaths = r3.subs;
    pos = r3.pos;
  }
  if (version >= 21 && (flags2 & FLAG2_IS_RECTANGLE)) svg.shapeKind = 'rectangle';
  if (flags2 & FLAG2_HAS_LINE_DIRECTION) {
    const dirBits = (flags2 >> 2) & 0x03;
    svg.lineDirection = dirBits === LINE_DIR_HORIZONTAL ? 'horizontal'
      : dirBits === LINE_DIR_VERTICAL ? 'vertical'
      : 'diagonal';
  } else if (version < 15) {
    // v14-and-earlier: lineDirection wasn't persisted. Backfill it for
    // axis-aligned single-segment lines so ungroupCreationBox's H/V
    // branch and downstream snap/scale gates recognize them.
    if (s.segs.length === 1 && s.segs[0].kind === 'line') {
      const [a, b2] = [s.segs[0].start, s.segs[0].end];
      if (a[0] !== b2[0] || a[1] !== b2[1]) {
        if (a[1] === b2[1]) svg.lineDirection = 'horizontal';
        else if (a[0] === b2[0]) svg.lineDirection = 'vertical';
        else svg.lineDirection = 'diagonal';
      }
    }
  }

  // v24+ fillColor + fillOpacity
  if (version >= 24 && (flags3 & FLAG3_SVG_HAS_FILL_COLOR)) {
    svg.fillColor = { r: data[pos++], g: data[pos++], b: data[pos++] };
    const opByte = data[pos++];
    if (opByte < 255) svg.fillOpacity = opByte / 255;
  }

  // v28+ sparse per-copy segment overrides (after fillColor in the stream).
  if (version >= 28 && (flags3 & FLAG3_SVG_HAS_SEGMENT_OVERRIDES)) {
    const n = view.getUint16(pos, true); pos += 2;
    const ov = new Map<number, { r: number; g: number; b: number }>();
    for (let i = 0; i < n; i++) {
      const key = view.getUint32(pos, true); pos += 4;
      const r = data[pos++], g = data[pos++], b = data[pos++];
      ov.set(key >>> 0, { r, g, b });
    }
    if (ov.size > 0) svg.segmentOverrides = ov;
  }

  // v29+ fillPaint then effects (flag-bit order, after segmentOverrides).
  if (version >= 29 && (flags3 & FLAG3_SVG_HAS_FILL_PAINT)) {
    const p = readPaint(view, data, pos);
    svg.fillPaint = p.paint;
    pos = p.pos;
  }
  if (version >= 29 && (flags3 & FLAG3_SVG_HAS_EFFECTS)) {
    const e = readEffects(view, data, pos);
    svg.effects = e.effects;
    pos = e.pos;
  }
  // v31+ free rotation (i16), after effects.
  if (version >= 30 && (flags3 & FLAG3_SVG_HAS_ANGLE)) {
    svg.angleDeg = decodeAngleDeg(view.getInt16(pos, true)); pos += 2;
  }

  // v25+ "Use as mask" flag (presence-only, no payload)
  if (version >= 25 && (flags3 & FLAG3_SVG_USE_AS_MASK)) {
    svg.isMask = true;
  }

  // v26+ "hidden" visibility flag (presence-only, no payload)
  if (version >= 26 && (flags3 & FLAG3_SVG_HIDDEN)) {
    svg.hidden = true;
  }

  // v27+ "pattern fill" flag (presence-only, no payload)
  if (version >= 27 && (flags3 & FLAG3_SVG_PATTERN_FILL)) {
    svg.isPatternFill = true;
  }

  // Repair existing saved data: if the world bbox is degenerate (exactly
  // one axis is zero â€” the segment AABB of an axis-aligned line) and the
  // line lacks a creationBox, infer direction from the aspect ratio and
  // synthesize a creationBox by inflating the thin axis to one grid step.
  // Applies to grouped lines too: the synthesized creationBox is in the
  // current world space, so it stays valid until a future group transform,
  // and ungroupCreationBox's H/V branch overwrites it on ungroup anyway.
  // Skips fully empty geometry (both axes zero).
  if (svg.creationBox === undefined
      && (svg.cellWidth === 0 || svg.cellHeight === 0)
      && (svg.cellWidth > 0 || svg.cellHeight > 0)) {
    const isVertical = svg.cellHeight > svg.cellWidth;
    if (svg.lineDirection == null || svg.lineDirection === 'diagonal') {
      svg.lineDirection = isVertical ? 'vertical' : 'horizontal';
    }
    const step = compSnapStep(gridLevel);
    if (isVertical) {
      const cx = svg.cellX + svg.cellWidth / 2;
      svg.creationBox = {
        minX: cx - step / 2,
        minY: svg.cellY,
        width: step,
        height: svg.cellHeight,
      };
    } else {
      const cy = svg.cellY + svg.cellHeight / 2;
      svg.creationBox = {
        minX: svg.cellX,
        minY: cy - step / 2,
        width: svg.cellWidth,
        height: step,
      };
    }
  }

  return { svg, pos };
}

// â”€â”€ Legacy v8-v11 line / arc readers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// v8-v11 stored two separate sections (lines + arcs) where v12+ has a
// single svgObjects section. We parse both into SVGObject so older
// .tile files keep importing after the v12 collapse. Lines store a
// polyline as vertices; we expand consecutive pairs into line segments
// so the unified geometry path can render them unchanged.

function readVerticesLegacy(view: DataView, pos: number, count: number): { verts: [number, number][]; pos: number } {
  const verts: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const x = decodeFixed(view.getInt16(pos, true)); pos += 2;
    const y = decodeFixed(view.getInt16(pos, true)); pos += 2;
    verts.push([x, y]);
  }
  return { verts, pos };
}

function polylineToSegments(verts: [number, number][]): PathSegment[] {
  const segs: PathSegment[] = [];
  for (let i = 0; i + 1 < verts.length; i++) {
    segs.push({ kind: 'line', start: verts[i], end: verts[i + 1] });
  }
  return segs;
}

function readLegacyShared(
  view: DataView,
  _data: Uint8Array,
  pos: number,
  strings: string[],
  version: number,
  segments: PathSegment[],
  localSegments: PathSegment[] | undefined,
  identitySegments: PathSegment[] | undefined,
  flags: number,
  rotBits: number,
  idIdx: number,
  nameIdx: number | undefined,
  groupIdIdx: number | undefined,
  preGroupNameIdx: number | undefined,
  rgb: { r: number; g: number; b: number },
): { svg: SVGObject; pos: number } {
  const bb = arcBoundingBox(segments);
  const svg: SVGObject = {
    id: strings[idIdx],
    segments,
    color: rgb,
    cellX: bb?.minX ?? 0,
    cellY: bb?.minY ?? 0,
    cellWidth: bb ? bb.maxX - bb.minX : 0,
    cellHeight: bb ? bb.maxY - bb.minY : 0,
  };
  if (nameIdx != null) svg.name = strings[nameIdx];
  if (groupIdIdx != null) svg.groupId = strings[groupIdIdx];
  if (preGroupNameIdx != null) svg.preGroupName = strings[preGroupNameIdx];
  if (flags & FLAG_MIRROR_H) svg.mirrorH = true;
  if (flags & FLAG_MIRROR_V) svg.mirrorV = true;
  if (flags & FLAG_LOCKED) svg.locked = true;
  const rot = BITS_TO_ROTATION[rotBits & 0x03];
  if (rot !== 0) svg.rotation = rot;
  if (localSegments) {
    svg.localSegments = localSegments;
    const lbb = arcBoundingBox(localSegments);
    if (lbb) {
      svg.localCellX = lbb.minX;
      svg.localCellY = lbb.minY;
      svg.localCellWidth = lbb.maxX - lbb.minX;
      svg.localCellHeight = lbb.maxY - lbb.minY;
    }
  }
  if (identitySegments) svg.identitySegments = identitySegments;
  if (version >= 10 && (rotBits & 0x04)) {
    svg.tileMode = 'repeat';
    svg.tileWidthL0 = decodeFixed(view.getInt16(pos, true)); pos += 2;
    svg.tileHeightL0 = decodeFixed(view.getInt16(pos, true)); pos += 2;
    if (version >= 18) {
      const ox = decodeFixed(view.getInt16(pos, true)); pos += 2;
      const oy = decodeFixed(view.getInt16(pos, true)); pos += 2;
      if (ox !== 0) svg.tileOffsetXL0 = ox;
      if (oy !== 0) svg.tileOffsetYL0 = oy;
    }
  }
  return { svg, pos };
}

function readLegacyLine(
  view: DataView,
  data: Uint8Array,
  pos: number,
  strings: string[],
  version: number,
): { svg: SVGObject; pos: number } {
  const idIdx = view.getUint16(pos, true); pos += 2;
  const flags = data[pos++];
  const rotBits = data[pos++];
  const r = data[pos++];
  const g = data[pos++];
  const b = data[pos++];

  let nameIdx: number | undefined;
  let groupIdIdx: number | undefined;
  let preGroupNameIdx: number | undefined;
  if (flags & FLAG_HAS_NAME) { nameIdx = view.getUint16(pos, true); pos += 2; }
  if (flags & FLAG_HAS_GROUP_ID) { groupIdIdx = view.getUint16(pos, true); pos += 2; }
  if (flags & FLAG_HAS_PRE_GROUP_NAME) { preGroupNameIdx = view.getUint16(pos, true); pos += 2; }

  const vertCount = view.getUint16(pos, true); pos += 2;
  const v = readVerticesLegacy(view, pos, vertCount);
  pos = v.pos;
  const segments = polylineToSegments(v.verts);

  let localSegments: PathSegment[] | undefined;
  if (flags & FLAG_HAS_LOCAL) {
    const c = view.getUint16(pos, true); pos += 2;
    const lv = readVerticesLegacy(view, pos, c);
    pos = lv.pos;
    localSegments = polylineToSegments(lv.verts);
  }
  let identitySegments: PathSegment[] | undefined;
  if (flags & FLAG_HAS_IDENTITY) {
    const c = view.getUint16(pos, true); pos += 2;
    const iv = readVerticesLegacy(view, pos, c);
    pos = iv.pos;
    identitySegments = polylineToSegments(iv.verts);
  }

  return readLegacyShared(
    view, data, pos, strings, version,
    segments, localSegments, identitySegments,
    flags, rotBits, idIdx, nameIdx, groupIdIdx, preGroupNameIdx,
    { r, g, b },
  );
}

function readLegacyArc(
  view: DataView,
  data: Uint8Array,
  pos: number,
  strings: string[],
  version: number,
): { svg: SVGObject; pos: number } {
  const idIdx = view.getUint16(pos, true); pos += 2;
  const flags = data[pos++];
  const rotBits = data[pos++];
  const r = data[pos++];
  const g = data[pos++];
  const b = data[pos++];

  let nameIdx: number | undefined;
  let groupIdIdx: number | undefined;
  let preGroupNameIdx: number | undefined;
  if (flags & FLAG_HAS_NAME) { nameIdx = view.getUint16(pos, true); pos += 2; }
  if (flags & FLAG_HAS_GROUP_ID) { groupIdIdx = view.getUint16(pos, true); pos += 2; }
  if (flags & FLAG_HAS_PRE_GROUP_NAME) { preGroupNameIdx = view.getUint16(pos, true); pos += 2; }

  const segCount = view.getUint16(pos, true); pos += 2;
  const s = readSegments(view, data, pos, segCount);
  pos = s.pos;

  let localSegments: PathSegment[] | undefined;
  if (flags & FLAG_HAS_LOCAL) {
    const c = view.getUint16(pos, true); pos += 2;
    const ls = readSegments(view, data, pos, c);
    pos = ls.pos;
    localSegments = ls.segs;
  }
  let identitySegments: PathSegment[] | undefined;
  if (flags & FLAG_HAS_IDENTITY) {
    const c = view.getUint16(pos, true); pos += 2;
    const is = readSegments(view, data, pos, c);
    pos = is.pos;
    identitySegments = is.segs;
  }

  return readLegacyShared(
    view, data, pos, strings, version,
    s.segs, localSegments, identitySegments,
    flags, rotBits, idIdx, nameIdx, groupIdIdx, preGroupNameIdx,
    { r, g, b },
  );
}

// â”€â”€ Image write / read helpers (v10+) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function writeImage(
  view: DataView,
  out: Uint8Array,
  pos: number,
  img: ImageObject,
  indexOf: Map<string, number>,
): number {
  view.setUint16(pos, indexOf.get(img.id) ?? 0, true); pos += 2;

  let flags = 0;
  if (img.mirrorH) flags |= FLAG_MIRROR_H;
  if (img.mirrorV) flags |= FLAG_MIRROR_V;
  if (img.locked) flags |= FLAG_LOCKED;
  if (img.name != null) flags |= FLAG_HAS_NAME;
  if (img.groupId != null) flags |= FLAG_HAS_GROUP_ID;
  if (img.preGroupName != null) flags |= FLAG_HAS_PRE_GROUP_NAME;
  if (img.localCellX != null) flags |= FLAG_HAS_LOCAL;
  if (img.identityCellX != null) flags |= FLAG_HAS_IDENTITY;
  out[pos++] = flags;

  // Rotation occupies bits 0x01â€“0x02; bit 0x04 carries the `hidden` flag
  // (the per-image flags byte is fully consumed at v13). v29 adds tint /
  // effects presence on bits 0x08 / 0x10. Older readers mask `& 0x03`
  // (and `& 0x04` for hidden), so the extra bits are invisible to them.
  out[pos++] = (ROTATION_TO_BITS[img.rotation ?? 0] & 0x03)
    | (img.hidden ? 0x04 : 0)
    | (img.tint ? IMG_ROT_HAS_TINT : 0)
    | (img.effects ? IMG_ROT_HAS_EFFECTS : 0)
    | (img.angleDeg ? IMG_ROT_HAS_ANGLE : 0)
    | (img.framing ? IMG_ROT_HAS_FRAMING : 0)
    | (img.cornerRadius ? IMG_ROT_HAS_CORNER : 0);
  out[pos++] = img.mimeType === 'image/jpeg' ? 1 : 0;
  // Opacity quantized to 0..255 (default 255 = fully opaque). 256 levels
  // is well beyond what the eye can resolve and keeps the record
  // 1 byte / image instead of an f32. Round-trip through the reducer
  // produces the same float value (`stored / 255`).
  {
    const op = img.opacity == null ? 1 : Math.max(0, Math.min(1, img.opacity));
    out[pos++] = Math.round(op * 255);
  }

  view.setUint16(pos, indexOf.get(img.imageId) ?? 0, true); pos += 2;
  view.setUint16(pos, Math.min(0xffff, Math.round(img.pixelWidth)), true); pos += 2;
  view.setUint16(pos, Math.min(0xffff, Math.round(img.pixelHeight)), true); pos += 2;

  view.setInt16(pos, encodeFixed(img.cellX), true); pos += 2;
  view.setInt16(pos, encodeFixed(img.cellY), true); pos += 2;
  view.setInt16(pos, encodeFixed(img.cellWidth), true); pos += 2;
  view.setInt16(pos, encodeFixed(img.cellHeight), true); pos += 2;

  if (img.name != null) {
    view.setUint16(pos, indexOf.get(img.name) ?? 0, true); pos += 2;
  }
  if (img.groupId != null) {
    view.setUint16(pos, indexOf.get(img.groupId) ?? 0, true); pos += 2;
  }
  if (img.preGroupName != null) {
    view.setUint16(pos, indexOf.get(img.preGroupName) ?? 0, true); pos += 2;
  }
  if (img.localCellX != null) {
    view.setInt16(pos, encodeFixed(img.localCellX), true); pos += 2;
    view.setInt16(pos, encodeFixed(img.localCellY!), true); pos += 2;
    view.setInt16(pos, encodeFixed(img.localCellWidth!), true); pos += 2;
    view.setInt16(pos, encodeFixed(img.localCellHeight!), true); pos += 2;
  }
  if (img.identityCellX != null) {
    view.setInt16(pos, encodeFixed(img.identityCellX), true); pos += 2;
    view.setInt16(pos, encodeFixed(img.identityCellY!), true); pos += 2;
    view.setInt16(pos, encodeFixed(img.identityCellWidth!), true); pos += 2;
    view.setInt16(pos, encodeFixed(img.identityCellHeight!), true); pos += 2;
  }

  // v29+ tint then effects (flag-bit order, after the identity block).
  if (img.tint) {
    out[pos++] = img.tint.color.r & 0xff;
    out[pos++] = img.tint.color.g & 0xff;
    out[pos++] = img.tint.color.b & 0xff;
    out[pos++] = quantize255(img.tint.amount);
    out[pos++] = TINT_MODE_TO_BYTE[img.tint.mode] & 0xff;
  }
  if (img.effects) {
    pos = writeEffects(view, out, pos, img.effects);
  }
  if (img.angleDeg) {
    view.setInt16(pos, encodeAngleDeg(img.angleDeg), true); pos += 2;
  }
  // v33+ framing then cornerRadius (rotation-byte bits 0x40 / 0x80), after the
  // v31 angleDeg block.
  if (img.framing) {
    pos = writeFraming(view, out, pos, img.framing);
  }
  if (img.cornerRadius) {
    view.setFloat64(pos, img.cornerRadius, true); pos += 8;
  }
  // v34+ image flags2 byte, then the originalImageId string index when present.
  // Written after the v33 blocks; bytes ride the existing image-blob section.
  {
    const flags2 = img.originalImageId != null ? IMG_FLAGS2_HAS_ORIGINAL : 0;
    out[pos++] = flags2;
    if (img.originalImageId != null) {
      view.setUint16(pos, indexOf.get(img.originalImageId) ?? 0, true); pos += 2;
    }
  }

  return pos;
}

function readImage(
  view: DataView,
  data: Uint8Array,
  pos: number,
  strings: string[],
  version: number,
): { img: ImageObject; pos: number } {
  const idIdx = view.getUint16(pos, true); pos += 2;
  const flags = data[pos++];
  const rotBits = data[pos++];
  const mimeBit = data[pos++];
  const opacityByte = data[pos++];
  const imageIdIdx = view.getUint16(pos, true); pos += 2;
  const pixelWidth = view.getUint16(pos, true); pos += 2;
  const pixelHeight = view.getUint16(pos, true); pos += 2;
  const cellX = decodeFixed(view.getInt16(pos, true)); pos += 2;
  const cellY = decodeFixed(view.getInt16(pos, true)); pos += 2;
  const cellWidth = decodeFixed(view.getInt16(pos, true)); pos += 2;
  const cellHeight = decodeFixed(view.getInt16(pos, true)); pos += 2;

  let name: string | undefined;
  let groupId: string | undefined;
  let preGroupName: string | undefined;
  if (flags & FLAG_HAS_NAME) { name = strings[view.getUint16(pos, true)]; pos += 2; }
  if (flags & FLAG_HAS_GROUP_ID) { groupId = strings[view.getUint16(pos, true)]; pos += 2; }
  if (flags & FLAG_HAS_PRE_GROUP_NAME) { preGroupName = strings[view.getUint16(pos, true)]; pos += 2; }

  const img: ImageObject = {
    id: strings[idIdx],
    imageId: strings[imageIdIdx],
    mimeType: mimeBit === 1 ? 'image/jpeg' : 'image/png',
    pixelWidth,
    pixelHeight,
    cellX, cellY, cellWidth, cellHeight,
  };
  if (name != null) img.name = name;
  if (groupId != null) img.groupId = groupId;
  if (preGroupName != null) img.preGroupName = preGroupName;
  if (flags & FLAG_MIRROR_H) img.mirrorH = true;
  if (flags & FLAG_MIRROR_V) img.mirrorV = true;
  if (flags & FLAG_LOCKED) img.locked = true;
  const rot = BITS_TO_ROTATION[rotBits & 0x03];
  if (rot !== 0) img.rotation = rot;
  // Bit 0x04 of the rotation byte carries `hidden` (v14+). Older saves
  // wrote 0 for those bits, so the check is safe without a version gate.
  if (rotBits & 0x04) img.hidden = true;
  // Skip opacity == 1 (fully opaque) so older saves and freshly imported
  // images stay visually identical without writing a redundant field.
  if (opacityByte !== 255) img.opacity = opacityByte / 255;

  if (flags & FLAG_HAS_LOCAL) {
    img.localCellX = decodeFixed(view.getInt16(pos, true)); pos += 2;
    img.localCellY = decodeFixed(view.getInt16(pos, true)); pos += 2;
    img.localCellWidth = decodeFixed(view.getInt16(pos, true)); pos += 2;
    img.localCellHeight = decodeFixed(view.getInt16(pos, true)); pos += 2;
  }
  if (flags & FLAG_HAS_IDENTITY) {
    img.identityCellX = decodeFixed(view.getInt16(pos, true)); pos += 2;
    img.identityCellY = decodeFixed(view.getInt16(pos, true)); pos += 2;
    img.identityCellWidth = decodeFixed(view.getInt16(pos, true)); pos += 2;
    img.identityCellHeight = decodeFixed(view.getInt16(pos, true)); pos += 2;
  }

  // v29+ tint then effects (rotation-byte bits 0x08 / 0x10, written after
  // the identity block). Pre-v29 files never set these bits, but the read
  // is version-gated anyway to keep the rule uniform.
  if (version >= 29 && (rotBits & IMG_ROT_HAS_TINT)) {
    const r2 = data[pos++], g2 = data[pos++], b2 = data[pos++];
    const amount = data[pos++] / 255;
    const modeByte = data[pos++];
    img.tint = {
      color: { r: r2, g: g2, b: b2 },
      amount,
      mode: BYTE_TO_TINT_MODE[modeByte] ?? 'tint',
    };
  }
  if (version >= 29 && (rotBits & IMG_ROT_HAS_EFFECTS)) {
    const e = readEffects(view, data, pos);
    img.effects = e.effects;
    pos = e.pos;
  }
  if (version >= 30 && (rotBits & IMG_ROT_HAS_ANGLE)) {
    img.angleDeg = decodeAngleDeg(view.getInt16(pos, true)); pos += 2;
  }
  // v33+ framing then cornerRadius (rotation-byte bits 0x40 / 0x80). Pre-v33
  // files never set these bits, but gate the read on the version anyway.
  if (version >= 33 && (rotBits & IMG_ROT_HAS_FRAMING)) {
    const f = readFraming(view, data, pos);
    img.framing = f.framing;
    pos = f.pos;
  }
  if (version >= 33 && (rotBits & IMG_ROT_HAS_CORNER)) {
    img.cornerRadius = view.getFloat64(pos, true); pos += 8;
  }
  // v34+ image flags2 byte, then originalImageId when its bit is set. v33 files
  // have no flags2 byte, so the read is gated on version>=34 (never their data).
  if (version >= 34) {
    const flags2 = data[pos++];
    if (flags2 & IMG_FLAGS2_HAS_ORIGINAL) {
      img.originalImageId = strings[view.getUint16(pos, true)]; pos += 2;
    }
  }

  return { img, pos };
}

// â”€â”€ Text write / read helpers (v29+) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function textBinarySize(text: TextObject): number {
  // idIdx(2) + flags(1) + flags2(1) + rotBits(1) + contentIdx(2)
  // + bbox (i16/u16 Ã— 4 = 8)
  // + style: fontIdIdx(2) + size f32(4) + styleFlags(1) + color(3)
  let size = 2 + 1 + 1 + 1 + 2 + 8 + 2 + 4 + 1 + 3;
  if (text.name != null) size += 2;
  if (text.groupId != null) size += 2;
  if (text.preGroupName != null) size += 2;
  if (text.localCellX != null) size += 8;
  if (text.identityCellX != null) size += 8;
  if (text.style.letterSpacing != null) size += 4;
  if (text.style.lineHeight != null) size += 4;
  if (text.style.stroke != null) size += 7; // width f32 + r,g,b
  if (text.style.weight != null) size += 1; // weight u8
  if (text.effects) size += effectsBinarySize(text.effects);
  if (text.angleDeg) size += 2; // v31+ free rotation (i16)
  return size;
}

function writeText(
  view: DataView,
  out: Uint8Array,
  pos: number,
  text: TextObject,
  indexOf: Map<string, number>,
): number {
  view.setUint16(pos, indexOf.get(text.id) ?? 0, true); pos += 2;

  let flags = 0;
  if (text.mirrorH) flags |= TFLAG_MIRROR_H;
  if (text.mirrorV) flags |= TFLAG_MIRROR_V;
  if (text.locked) flags |= TFLAG_LOCKED;
  if (text.name != null) flags |= TFLAG_HAS_NAME;
  if (text.groupId != null) flags |= TFLAG_HAS_GROUP_ID;
  if (text.preGroupName != null) flags |= TFLAG_HAS_PRE_GROUP_NAME;
  if (text.hidden) flags |= TFLAG_HIDDEN;
  if (text.sticker) flags |= TFLAG_STICKER;
  out[pos++] = flags;

  let flags2 = 0;
  if (text.localCellX != null) flags2 |= TFLAG2_HAS_LOCAL;
  if (text.identityCellX != null) flags2 |= TFLAG2_HAS_IDENTITY;
  if (text.effects) flags2 |= TFLAG2_HAS_EFFECTS;
  if (text.angleDeg) flags2 |= TFLAG2_HAS_ANGLE;
  out[pos++] = flags2;

  out[pos++] = ROTATION_TO_BITS[text.rotation ?? 0] & 0x03;

  if (text.name != null) { view.setUint16(pos, indexOf.get(text.name) ?? 0, true); pos += 2; }
  if (text.groupId != null) { view.setUint16(pos, indexOf.get(text.groupId) ?? 0, true); pos += 2; }
  if (text.preGroupName != null) { view.setUint16(pos, indexOf.get(text.preGroupName) ?? 0, true); pos += 2; }

  view.setUint16(pos, indexOf.get(text.content) ?? 0, true); pos += 2;

  view.setInt16(pos, encodeFixed(text.cellX), true); pos += 2;
  view.setInt16(pos, encodeFixed(text.cellY), true); pos += 2;
  view.setUint16(pos, encodeFixed(text.cellWidth), true); pos += 2;
  view.setUint16(pos, encodeFixed(text.cellHeight), true); pos += 2;

  if (text.localCellX != null) {
    view.setInt16(pos, encodeFixed(text.localCellX), true); pos += 2;
    view.setInt16(pos, encodeFixed(text.localCellY!), true); pos += 2;
    view.setUint16(pos, encodeFixed(text.localCellWidth!), true); pos += 2;
    view.setUint16(pos, encodeFixed(text.localCellHeight!), true); pos += 2;
  }
  if (text.identityCellX != null) {
    view.setInt16(pos, encodeFixed(text.identityCellX), true); pos += 2;
    view.setInt16(pos, encodeFixed(text.identityCellY!), true); pos += 2;
    view.setUint16(pos, encodeFixed(text.identityCellWidth!), true); pos += 2;
    view.setUint16(pos, encodeFixed(text.identityCellHeight!), true); pos += 2;
  }

  // Style block.
  const style = text.style;
  view.setUint16(pos, indexOf.get(style.fontId) ?? 0, true); pos += 2;
  view.setFloat32(pos, style.size, true); pos += 4;
  let styleFlags = 0;
  if (style.bold) styleFlags |= TSTYLE_BOLD;
  if (style.italic) styleFlags |= TSTYLE_ITALIC;
  if (style.stroke != null) styleFlags |= TSTYLE_HAS_STROKE;
  if (style.letterSpacing != null) styleFlags |= TSTYLE_HAS_LETTER_SPACING;
  if (style.lineHeight != null) styleFlags |= TSTYLE_HAS_LINE_HEIGHT;
  if (style.align != null) styleFlags |= (ALIGN_TO_BITS[style.align] & 0x03) << 5;
  if (style.weight != null) styleFlags |= TSTYLE_HAS_WEIGHT;
  out[pos++] = styleFlags;
  out[pos++] = style.color.r & 0xff;
  out[pos++] = style.color.g & 0xff;
  out[pos++] = style.color.b & 0xff;

  if (style.letterSpacing != null) { view.setFloat32(pos, style.letterSpacing, true); pos += 4; }
  if (style.lineHeight != null) { view.setFloat32(pos, style.lineHeight, true); pos += 4; }
  if (style.stroke != null) {
    view.setFloat32(pos, style.stroke.width, true); pos += 4;
    out[pos++] = style.stroke.color.r & 0xff;
    out[pos++] = style.stroke.color.g & 0xff;
    out[pos++] = style.stroke.color.b & 0xff;
  }
  if (style.weight != null) { out[pos++] = WEIGHT_TO_BITS[style.weight] & 0xff; }

  if (text.effects) {
    pos = writeEffects(view, out, pos, text.effects);
  }
  // v31+ free rotation (i16), after effects.
  if (text.angleDeg) {
    view.setInt16(pos, encodeAngleDeg(text.angleDeg), true); pos += 2;
  }

  return pos;
}

function readText(
  view: DataView,
  data: Uint8Array,
  pos: number,
  strings: string[],
): { text: TextObject; pos: number } {
  const idIdx = view.getUint16(pos, true); pos += 2;
  const flags = data[pos++];
  const flags2 = data[pos++];
  const rotBits = data[pos++];

  let name: string | undefined;
  let groupId: string | undefined;
  let preGroupName: string | undefined;
  if (flags & TFLAG_HAS_NAME) { name = strings[view.getUint16(pos, true)]; pos += 2; }
  if (flags & TFLAG_HAS_GROUP_ID) { groupId = strings[view.getUint16(pos, true)]; pos += 2; }
  if (flags & TFLAG_HAS_PRE_GROUP_NAME) { preGroupName = strings[view.getUint16(pos, true)]; pos += 2; }

  const contentIdx = view.getUint16(pos, true); pos += 2;

  const cellX = decodeFixed(view.getInt16(pos, true)); pos += 2;
  const cellY = decodeFixed(view.getInt16(pos, true)); pos += 2;
  const cellWidth = decodeFixed(view.getUint16(pos, true)); pos += 2;
  const cellHeight = decodeFixed(view.getUint16(pos, true)); pos += 2;

  let localCellX: number | undefined, localCellY: number | undefined;
  let localCellWidth: number | undefined, localCellHeight: number | undefined;
  if (flags2 & TFLAG2_HAS_LOCAL) {
    localCellX = decodeFixed(view.getInt16(pos, true)); pos += 2;
    localCellY = decodeFixed(view.getInt16(pos, true)); pos += 2;
    localCellWidth = decodeFixed(view.getUint16(pos, true)); pos += 2;
    localCellHeight = decodeFixed(view.getUint16(pos, true)); pos += 2;
  }
  let identityCellX: number | undefined, identityCellY: number | undefined;
  let identityCellWidth: number | undefined, identityCellHeight: number | undefined;
  if (flags2 & TFLAG2_HAS_IDENTITY) {
    identityCellX = decodeFixed(view.getInt16(pos, true)); pos += 2;
    identityCellY = decodeFixed(view.getInt16(pos, true)); pos += 2;
    identityCellWidth = decodeFixed(view.getUint16(pos, true)); pos += 2;
    identityCellHeight = decodeFixed(view.getUint16(pos, true)); pos += 2;
  }

  // Style block.
  const fontIdIdx = view.getUint16(pos, true); pos += 2;
  const size = view.getFloat32(pos, true); pos += 4;
  const styleFlags = data[pos++];
  const r = data[pos++], g = data[pos++], b = data[pos++];

  const style: TextStyle = {
    fontId: strings[fontIdIdx],
    size,
    color: { r, g, b },
  };
  if (styleFlags & TSTYLE_BOLD) style.bold = true;
  if (styleFlags & TSTYLE_ITALIC) style.italic = true;
  const align = BITS_TO_ALIGN[(styleFlags >> 5) & 0x03];
  if (align != null) style.align = align;
  if (styleFlags & TSTYLE_HAS_LETTER_SPACING) {
    style.letterSpacing = view.getFloat32(pos, true); pos += 4;
  }
  if (styleFlags & TSTYLE_HAS_LINE_HEIGHT) {
    style.lineHeight = view.getFloat32(pos, true); pos += 4;
  }
  if (styleFlags & TSTYLE_HAS_STROKE) {
    const width = view.getFloat32(pos, true); pos += 4;
    const sr = data[pos++], sg = data[pos++], sb = data[pos++];
    style.stroke = { width, color: { r: sr, g: sg, b: sb } };
  }
  if (styleFlags & TSTYLE_HAS_WEIGHT) {
    style.weight = BITS_TO_WEIGHT[data[pos++] & 0x03];
  }

  const text: TextObject = {
    id: strings[idIdx],
    content: strings[contentIdx],
    style,
    cellX, cellY, cellWidth, cellHeight,
  };
  if (name != null) text.name = name;
  if (groupId != null) text.groupId = groupId;
  if (preGroupName != null) text.preGroupName = preGroupName;
  if (flags & TFLAG_MIRROR_H) text.mirrorH = true;
  if (flags & TFLAG_MIRROR_V) text.mirrorV = true;
  if (flags & TFLAG_LOCKED) text.locked = true;
  if (flags & TFLAG_HIDDEN) text.hidden = true;
  if (flags & TFLAG_STICKER) text.sticker = true;
  const rot = BITS_TO_ROTATION[rotBits & 0x03];
  if (rot !== 0) text.rotation = rot;
  if (localCellX != null) {
    text.localCellX = localCellX;
    text.localCellY = localCellY;
    text.localCellWidth = localCellWidth;
    text.localCellHeight = localCellHeight;
  }
  if (identityCellX != null) {
    text.identityCellX = identityCellX;
    text.identityCellY = identityCellY;
    text.identityCellWidth = identityCellWidth;
    text.identityCellHeight = identityCellHeight;
  }
  if (flags2 & TFLAG2_HAS_EFFECTS) {
    const e = readEffects(view, data, pos);
    text.effects = e.effects;
    pos = e.pos;
  }
  // v31+ free rotation (i16), after effects. The text section is v29+ only
  // and v29 never set this flag, so the presence bit alone is a safe gate.
  if (flags2 & TFLAG2_HAS_ANGLE) {
    text.angleDeg = decodeAngleDeg(view.getInt16(pos, true)); pos += 2;
  }

  return { text, pos };
}

// â”€â”€ Serialize â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function serializeComposition(
  bundle: CompositionBundle,
  embeddedFiles: EmbeddedFile[],
): Uint8Array {
  const { strings, indexOf } = buildStringTable(bundle, embeddedFiles);
  const encoder = new TextEncoder();

  // â”€â”€ Pass 1: calculate total size â”€â”€

  let totalSize = HEADER_SIZE + METADATA_SIZE;

  // String table
  const encodedStrings: Uint8Array[] = [];
  totalSize += 2; // stringCount
  for (const s of strings) {
    const encoded = encoder.encode(s);
    encodedStrings.push(encoded);
    totalSize += 2 + encoded.length;
  }

  // Figures
  for (const fig of bundle.figures) {
    totalSize += figureBinarySize(fig);
  }

  // SVG objects (v12+)
  totalSize += 2; // svgCount
  const svgObjects = bundle.svgObjects ?? [];
  for (const s of svgObjects) totalSize += svgBinarySize(s);

  // Groups (v6+, extended in v13 for nesting). Drop orphans (GroupNodes
  // with no surviving leaf member anywhere in their subtree) so we don't
  // persist ghost groups that bloat the dev-mode object count without
  // showing anything in the Scene Outline. Order moved below svgObjects
  // so the alive computation can see them.
  const rawGroups = bundle.groups ?? [];
  const images = bundle.images ?? [];
  const texts = bundle.texts ?? [];
  const aliveGroupIds = computeAliveGroupIds(rawGroups, bundle.figures, svgObjects, images, texts);
  const groups = aliveGroupIds.size === rawGroups.length
    ? rawGroups
    : rawGroups.filter((g) => aliveGroupIds.has(g.id));
  totalSize += 2; // groupCount
  for (const g of groups) {
    totalSize += GROUP_RECORD_BASE_SIZE;
    if (g.parentGroupId != null) totalSize += 2;
    if (g.preGroupName != null) totalSize += 2;
  }

  // Embedded files
  totalSize += 2; // fileCount
  for (const f of embeddedFiles) {
    totalSize += 2 + 2 + 2 + 2 + 4 + f.data.length; // idIdx + nameIdx + w + h + dataLen + data
  }

  // Images + image-bytes (v10+) â€” bytes are deduplicated by imageId so a
  // duplicate node doesn't store the blob twice.
  const blobMap = bundle.imageBlobs ?? {};
  totalSize += 2; // imageCount
  for (const i of images) totalSize += imageBinarySize(i);
  // Build the dedup'd blob list now so the size pass and the write pass
  // see the same bytes (and size matches what we end up writing).
  const usedBlobIds: string[] = [];
  const seenBlobIds = new Set<string>();
  for (const i of images) {
    // Display blob then, if present, the higher-res original — both live in
    // the same blobMap under distinct ids and are deduplicated together.
    for (const id of [i.imageId, i.originalImageId]) {
      if (id == null || seenBlobIds.has(id)) continue;
      seenBlobIds.add(id);
      if (blobMap[id]) usedBlobIds.push(id);
    }
  }
  totalSize += 2; // blobCount
  for (const id of usedBlobIds) {
    // imageIdIdx(2) + mimeBit(1) + dataLen(4) + data
    totalSize += 7 + (blobMap[id]?.length ?? 0);
  }

  // Text objects (v29+) â€” written between the image-bytes section and
  // scene order.
  totalSize += 2; // textCount
  for (const t of texts) totalSize += textBinarySize(t);

  // Scene order (v11+) â€” paint order across every scene-object kind, one
  // u16 string-table index per id.
  const sceneOrder = bundle.sceneOrder ?? [];
  totalSize += 2 + sceneOrder.length * 2;

  // Node transforms (v14+) â€” compact Transform2D per scene node.
  // Per entry: idIdx(u16) + flags(u8: rotation 2bits + mirrorH 1bit + mirrorV 1bit + hasParent 1bit)
  //            + tx(f32) + ty(f32) + sx(f32) + sy(f32)
  //            + optional parentIdIdx(u16)
  // Base: 2+1+4+4+4+4 = 19 bytes, +2 if parented = 21 bytes
  const nodeTransforms = bundle.nodeTransforms;
  const ntEntries: Array<{ id: string; transform: Transform2D; parentId?: string }> = [];
  if (nodeTransforms) {
    for (const [id, entry] of nodeTransforms) {
      ntEntries.push({ id, ...entry });
    }
  }
  totalSize += 2; // nodeTransformCount
  for (const nt of ntEntries) {
    totalSize += 19 + (nt.parentId != null ? 2 : 0);
  }

  // Custom colors (v17+) â€” persisted user-palette colors for this comp.
  const customColors = bundle.customColors ?? [];
  totalSize += 2 + customColors.length * 3;

  // Background paint (v29+) â€” hasBackground byte + optional paint payload.
  totalSize += 1 + (bundle.background ? paintBinarySize(bundle.background) : 0);

  // â”€â”€ Pass 2: write â”€â”€

  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);
  let pos = 0;

  // Header
  out[0] = MAGIC[0]; out[1] = MAGIC[1]; out[2] = MAGIC[2]; out[3] = MAGIC[3];
  view.setUint16(4, FORMAT_VERSION, true);
  view.setUint16(6, bundle.figures.length, true);
  pos = HEADER_SIZE;

  // Composition metadata
  view.setUint16(pos, indexOf.get(bundle.name) ?? 0, true); pos += 2;
  view.setInt8(pos, bundle.gridLevel); pos += 1;
  view.setFloat64(pos, bundle.camera.offsetX, true); pos += 8;
  view.setFloat64(pos, bundle.camera.offsetY, true); pos += 8;
  view.setFloat64(pos, bundle.camera.zoom, true); pos += 8;
  view.setFloat64(pos, bundle.strokeScale, true); pos += 8;
  view.setFloat64(pos, bundle.gridIntensity, true); pos += 8;

  // String table
  view.setUint16(pos, strings.length, true); pos += 2;
  for (const enc of encodedStrings) {
    view.setUint16(pos, enc.length, true); pos += 2;
    out.set(enc, pos); pos += enc.length;
  }

  // Figures
  for (const fig of bundle.figures) {
    // String refs
    view.setUint16(pos, indexOf.get(fig.id) ?? 0, true); pos += 2;
    view.setUint16(pos, indexOf.get(fig.figureKey) ?? 0, true); pos += 2;

    // flags0
    let flags0 = 0;
    if (fig.mirrorH) flags0 |= 0x01;
    if (fig.mirrorV) flags0 |= 0x02;
    if (fig.locked) flags0 |= 0x04;
    if (fig.tileMode === 'repeat') flags0 |= 0x08;
    if (fig.name != null) flags0 |= 0x10;
    if (fig.fileId != null) flags0 |= 0x20;
    // v26+: 0x40 carries the `hidden` flag. In v1 this bit meant
    // sourceFileId; it has been free since v2.
    if (fig.hidden) flags0 |= 0x40;
    out[pos++] = flags0;

    // flags1
    let flags1 = ROTATION_TO_BITS[fig.rotation ?? 0] & 0x03;
    const placementLevel = fig.placementLevel != null ? fig.placementLevel : 5;
    flags1 |= (placementLevel & 0x07) << 2;
    const cycleStep = fig.transformCycleStep != null ? fig.transformCycleStep : 7;
    flags1 |= (cycleStep & 0x07) << 5;
    out[pos++] = flags1;

    // flags2
    let flags2 = 0;
    if (fig.identityCellX != null) flags2 |= 0x01;
    if (fig.tileWidthL0 != null) flags2 |= 0x02;
    if (fig.quads && fig.quads.length > 0) flags2 |= 0x04;
    if (fig.groupId != null) flags2 |= 0x08;
    if (fig.preGroupName != null) flags2 |= 0x10;
    // 0x20 was groupIdentityCell* in v5/v6; dropped in v7. Reserved.
    if (fig.localCellX != null) flags2 |= 0x40;
    if (fig.colorOverride != null) flags2 |= 0x80;
    out[pos++] = flags2;

    // Required numerics (fixed-point i16)
    view.setInt16(pos, encodeFixed(fig.cellX), true); pos += 2;
    view.setInt16(pos, encodeFixed(fig.cellY), true); pos += 2;
    view.setInt16(pos, encodeFixed(fig.resolutionX), true); pos += 2;
    view.setInt16(pos, encodeFixed(fig.resolutionY), true); pos += 2;
    view.setInt16(pos, encodeFixed(fig.cellWidth), true); pos += 2;
    view.setInt16(pos, encodeFixed(fig.cellHeight), true); pos += 2;

    // Conditional string refs
    if (fig.name != null) {
      view.setUint16(pos, indexOf.get(fig.name) ?? 0, true); pos += 2;
    }
    if (fig.fileId != null) {
      view.setUint16(pos, indexOf.get(fig.fileId) ?? 0, true); pos += 2;
    }
    if (fig.groupId != null) {
      view.setUint16(pos, indexOf.get(fig.groupId) ?? 0, true); pos += 2;
    }
    if (fig.preGroupName != null) {
      view.setUint16(pos, indexOf.get(fig.preGroupName) ?? 0, true); pos += 2;
    }

    // Conditional numerics
    if (fig.identityCellX != null) {
      view.setInt16(pos, encodeFixed(fig.identityCellX), true); pos += 2;
      view.setInt16(pos, encodeFixed(fig.identityCellY!), true); pos += 2;
    }
    if (fig.tileWidthL0 != null) {
      view.setInt16(pos, encodeFixed(fig.tileWidthL0), true); pos += 2;
      view.setInt16(pos, encodeFixed(fig.tileHeightL0!), true); pos += 2;
      view.setInt16(pos, encodeFixed(fig.tileOffsetXL0 ?? 0), true); pos += 2;
      view.setInt16(pos, encodeFixed(fig.tileOffsetYL0 ?? 0), true); pos += 2;
    }
    if (fig.localCellX != null) {
      view.setInt16(pos, encodeFixed(fig.localCellX), true); pos += 2;
      view.setInt16(pos, encodeFixed(fig.localCellY!), true); pos += 2;
      view.setInt16(pos, encodeFixed(fig.localCellWidth!), true); pos += 2;
      view.setInt16(pos, encodeFixed(fig.localCellHeight!), true); pos += 2;
    }

    // Quads
    if (fig.quads && fig.quads.length > 0) {
      out[pos++] = fig.quads.length;
      for (const q of fig.quads) {
        view.setInt16(pos, encodeFixed(q.offsetX), true); pos += 2;
        view.setInt16(pos, encodeFixed(q.offsetY), true); pos += 2;
        view.setInt16(pos, encodeFixed(q.cellWidth), true); pos += 2;
        view.setInt16(pos, encodeFixed(q.cellHeight), true); pos += 2;
      }
    }

    // Color override (v16+, extended v22) â€” r,g,b + blendModeByte.
    // blendModeByte 0xFF = legacy luminance recolor; 0x00â€“0x0A = BlendMode.
    // Presence-only; explicit white must round-trip distinct from `undefined`.
    if (fig.colorOverride != null) {
      out[pos++] = fig.colorOverride.r;
      out[pos++] = fig.colorOverride.g;
      out[pos++] = fig.colorOverride.b;
      out[pos++] = fig.colorOverrideBlendMode != null
        ? BLEND_MODE_TO_BYTE[fig.colorOverrideBlendMode]
        : 0xFF;
    }
  }

  // Groups (v6+, extended in v13 for nesting) â€” written after figures, before embedded files.
  view.setUint16(pos, groups.length, true); pos += 2;
  for (const g of groups) {
    view.setUint16(pos, indexOf.get(g.id) ?? 0, true); pos += 2;
    view.setUint16(pos, indexOf.get(g.name) ?? 0, true); pos += 2;
    let gflags = 0;
    if (g.mirrorH) gflags |= 0x01;
    if (g.mirrorV) gflags |= 0x02;
    gflags |= (ROTATION_TO_BITS[g.rotation] & 0x03) << 2;
    if (g.parentGroupId != null) gflags |= 0x10;
    if (g.preGroupName != null) gflags |= 0x20;
    if (g.isFrame) gflags |= 0x40;
    if (g.locked) gflags |= 0x80;
    out[pos++] = gflags;
    view.setFloat32(pos, g.translateX, true); pos += 4;
    view.setFloat32(pos, g.translateY, true); pos += 4;
    view.setFloat32(pos, g.scaleX, true); pos += 4;
    view.setFloat32(pos, g.scaleY, true); pos += 4;
    if (g.parentGroupId != null) { view.setUint16(pos, indexOf.get(g.parentGroupId) ?? 0, true); pos += 2; }
    if (g.preGroupName != null) { view.setUint16(pos, indexOf.get(g.preGroupName) ?? 0, true); pos += 2; }
  }

  // SVG objects (v12+)
  view.setUint16(pos, svgObjects.length, true); pos += 2;
  for (const svg of svgObjects) {
    pos = writeSVG(view, out, pos, svg, indexOf);
  }

  // Embedded files
  view.setUint16(pos, embeddedFiles.length, true); pos += 2;
  for (const f of embeddedFiles) {
    view.setUint16(pos, indexOf.get(f.id) ?? 0, true); pos += 2;
    view.setUint16(pos, indexOf.get(f.name) ?? 0, true); pos += 2;
    view.setUint16(pos, f.widthL0, true); pos += 2;
    view.setUint16(pos, f.heightL0, true); pos += 2;
    view.setUint32(pos, f.data.length, true); pos += 4;
    out.set(f.data, pos); pos += f.data.length;
  }

  // Images (v10+) â€” metadata + dedup'd byte payload. Two sections so
  // older readers (theoretically up to v9) can stop after embedded files
  // and treat the rest as a forward-extension; current code branches on
  // version anyway. Bytes write last so a future "read just the
  // metadata" path can skip them.
  view.setUint16(pos, images.length, true); pos += 2;
  for (const img of images) {
    pos = writeImage(view, out, pos, img, indexOf);
  }
  view.setUint16(pos, usedBlobIds.length, true); pos += 2;
  for (const id of usedBlobIds) {
    const bytes = blobMap[id]!;
    view.setUint16(pos, indexOf.get(id) ?? 0, true); pos += 2;
    // Per-blob mime: pulled from any node carrying this id as either its
    // display or original blob. We checked that blobMap[id] exists above;
    // the corresponding node exists too because the blobMap key was
    // harvested from images. Display and original share one mime per node.
    const refNode = images.find(i => i.imageId === id || i.originalImageId === id)!;
    out[pos++] = refNode.mimeType === 'image/jpeg' ? 1 : 0;
    view.setUint32(pos, bytes.length, true); pos += 4;
    out.set(bytes, pos); pos += bytes.length;
  }

  // Text objects (v29+) â€” after image bytes, before scene order.
  pos = writeCount16(view, pos, texts.length, 'texts');
  for (const t of texts) {
    pos = writeText(view, out, pos, t, indexOf);
  }

  // Scene order (v11+). Every id is already in the string table because
  // the kind arrays added them above; we just write u16 indices.
  view.setUint16(pos, sceneOrder.length, true); pos += 2;
  for (const id of sceneOrder) {
    view.setUint16(pos, indexOf.get(id) ?? 0, true); pos += 2;
  }

  // Node transforms (v14+). Compact Transform2D per scene node.
  view.setUint16(pos, ntEntries.length, true); pos += 2;
  for (const nt of ntEntries) {
    view.setUint16(pos, indexOf.get(nt.id) ?? 0, true); pos += 2;
    let ntflags = ROTATION_TO_BITS[nt.transform.rotation] & 0x03;
    if (nt.transform.mirrorH) ntflags |= 0x04;
    if (nt.transform.mirrorV) ntflags |= 0x08;
    if (nt.parentId != null) ntflags |= 0x10;
    out[pos++] = ntflags;
    view.setFloat32(pos, nt.transform.tx, true); pos += 4;
    view.setFloat32(pos, nt.transform.ty, true); pos += 4;
    view.setFloat32(pos, nt.transform.sx, true); pos += 4;
    view.setFloat32(pos, nt.transform.sy, true); pos += 4;
    if (nt.parentId != null) {
      view.setUint16(pos, indexOf.get(nt.parentId) ?? 0, true); pos += 2;
    }
  }

  // Custom colors (v17+). u16 count then r/g/b triples.
  view.setUint16(pos, customColors.length, true); pos += 2;
  for (const c of customColors) {
    out[pos++] = c.r;
    out[pos++] = c.g;
    out[pos++] = c.b;
  }

  // Background paint (v29+). Final section of the file.
  if (bundle.background) {
    out[pos++] = 1;
    pos = writePaint(view, out, pos, bundle.background);
  } else {
    out[pos++] = 0;
  }

  return out;
}

// â”€â”€ Deserialize â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function deserializeComposition(data: Uint8Array): DeserializedComposition {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 0;

  if (data.byteLength < HEADER_SIZE) {
    throw new Error(
      `Composition payload truncated: ${data.byteLength} bytes, expected at least ${HEADER_SIZE} bytes for header`,
    );
  }

  // Validate magic
  if (data[0] !== MAGIC[0] || data[1] !== MAGIC[1] || data[2] !== MAGIC[2] || data[3] !== MAGIC[3]) {
    throw new Error('Invalid composition format: bad magic');
  }

  const version = view.getUint16(4, true);
  if (version < 1 || version > FORMAT_VERSION) {
    throw new Error(`Unsupported composition format version: ${version}`);
  }

  const figureCount = view.getUint16(6, true);
  pos = HEADER_SIZE;

  // Composition metadata
  const nameIdx = view.getUint16(pos, true); pos += 2;
  const gridLevel: number = version >= 23 ? view.getInt8(pos) : data[pos];
  pos++;
  const cameraX = view.getFloat64(pos, true); pos += 8;
  const cameraY = view.getFloat64(pos, true); pos += 8;
  const cameraZoom = view.getFloat64(pos, true); pos += 8;
  const rawStrokeScale = version >= 4 ? view.getFloat64(pos, true) : DEFAULT_STROKE_SCALE;
  if (version >= 4) pos += 8;
  const strokeScale = version < 23
    ? migrateLegacyStrokeScale(rawStrokeScale)
    : normalizeStrokeScale(rawStrokeScale);
  const gridIntensity = version >= 9 ? view.getFloat64(pos, true) : 0.3;
  if (version >= 9) pos += 8;

  // String table
  const stringCount = view.getUint16(pos, true); pos += 2;
  const decoder = new TextDecoder();
  const strings: string[] = [];
  for (let i = 0; i < stringCount; i++) {
    const len = view.getUint16(pos, true); pos += 2;
    strings.push(decoder.decode(data.subarray(pos, pos + len)));
    pos += len;
  }

  // Figures
  const figures: CompositionFigure[] = [];
  for (let i = 0; i < figureCount; i++) {
    const idIdx = view.getUint16(pos, true); pos += 2;
    const figureKeyIdx = view.getUint16(pos, true); pos += 2;

    const flags0 = data[pos++];
    const flags1 = data[pos++];
    const flags2 = data[pos++];

    const mirrorH = (flags0 & 0x01) !== 0;
    const mirrorV = (flags0 & 0x02) !== 0;
    const locked = (flags0 & 0x04) !== 0;
    const isTileRepeat = (flags0 & 0x08) !== 0;
    const hasName = (flags0 & 0x10) !== 0;
    // v1: 0x20=detachedHash, 0x40=sourceFileId, 0x80=liveContentHash
    // v2: 0x20=fileId
    const hasFileId_v2 = version >= 2 && (flags0 & 0x20) !== 0;
    const hasDetachedHash_v1 = version < 2 && (flags0 & 0x20) !== 0;
    const hasSourceFileId_v1 = version < 2 && (flags0 & 0x40) !== 0;
    const hasLiveContentHash_v1 = version < 2 && (flags0 & 0x80) !== 0;
    // v26+: 0x40 carries the `hidden` flag (was sourceFileId in v1 only).
    const hidden = version >= 26 && (flags0 & 0x40) !== 0;

    const rotation = BITS_TO_ROTATION[flags1 & 0x03];
    const placementLevelRaw = (flags1 >> 2) & 0x07;
    const cycleStepRaw = (flags1 >> 5) & 0x07;

    const hasIdentityCell = (flags2 & 0x01) !== 0;
    const hasTileSize = (flags2 & 0x02) !== 0;
    const hasQuads = (flags2 & 0x04) !== 0;
    const hasGroupId = (flags2 & 0x08) !== 0;
    const hasPreGroupName = (flags2 & 0x10) !== 0;
    // v5/v6 had groupIdentityCell* on flags2 0x20; dropped in v7.
    const hasLegacyGroupIdentity = version >= 5 && version < 7 && (flags2 & 0x20) !== 0;
    const hasLocalCell = version >= 6 && (flags2 & 0x40) !== 0;
    const hasColorOverride = version >= 16 && (flags2 & 0x80) !== 0;

    // Required numerics
    const cellX = decodeFixed(view.getInt16(pos, true)); pos += 2;
    const cellY = decodeFixed(view.getInt16(pos, true)); pos += 2;
    const resolutionX = decodeFixed(view.getInt16(pos, true)); pos += 2;
    const resolutionY = decodeFixed(view.getInt16(pos, true)); pos += 2;
    const cellWidth = decodeFixed(view.getInt16(pos, true)); pos += 2;
    const cellHeight = decodeFixed(view.getInt16(pos, true)); pos += 2;

    const fig: CompositionFigure = {
      id: strings[idIdx],
      figureKey: strings[figureKeyIdx],
      cellX,
      cellY,
      resolutionX,
      resolutionY,
      cellWidth,
      cellHeight,
      rotation,
      mirrorH,
      mirrorV,
    };

    if (locked) fig.locked = true;
    if (hidden) fig.hidden = true;
    if (isTileRepeat) fig.tileMode = 'repeat';

    if (hasName) {
      fig.name = strings[view.getUint16(pos, true)]; pos += 2;
    }
    if (hasFileId_v2) {
      fig.fileId = strings[view.getUint16(pos, true)]; pos += 2;
    }
    // v1 backward compat: read old fields, map sourceFileId â†’ fileId
    if (hasDetachedHash_v1) {
      pos += 2; // skip detachedHash
    }
    if (hasSourceFileId_v1) {
      fig.fileId = strings[view.getUint16(pos, true)]; pos += 2;
    }
    if (hasLiveContentHash_v1) {
      pos += 2; // skip liveContentHash
    }
    if (hasGroupId) {
      fig.groupId = strings[view.getUint16(pos, true)]; pos += 2;
    }
    if (hasPreGroupName) {
      fig.preGroupName = strings[view.getUint16(pos, true)]; pos += 2;
    }

    if (placementLevelRaw < 5) fig.placementLevel = placementLevelRaw as GridLevel;
    if (cycleStepRaw < 7) fig.transformCycleStep = cycleStepRaw;

    if (hasIdentityCell) {
      fig.identityCellX = decodeFixed(view.getInt16(pos, true)); pos += 2;
      fig.identityCellY = decodeFixed(view.getInt16(pos, true)); pos += 2;
    }
    if (hasTileSize) {
      fig.tileWidthL0 = decodeFixed(view.getInt16(pos, true)); pos += 2;
      fig.tileHeightL0 = decodeFixed(view.getInt16(pos, true)); pos += 2;
      if (version >= 18) {
        const ox = decodeFixed(view.getInt16(pos, true)); pos += 2;
        const oy = decodeFixed(view.getInt16(pos, true)); pos += 2;
        if (ox !== 0) fig.tileOffsetXL0 = ox;
        if (oy !== 0) fig.tileOffsetYL0 = oy;
      }
    }
    if (hasLegacyGroupIdentity) {
      // v5/v6 wrote 4 i16 fixed-point values here; in v7 the field is gone.
      // Skip the 8 bytes â€” current locals (if present) are now the source of truth.
      pos += 8;
    }
    if (hasLocalCell) {
      fig.localCellX = decodeFixed(view.getInt16(pos, true)); pos += 2;
      fig.localCellY = decodeFixed(view.getInt16(pos, true)); pos += 2;
      fig.localCellWidth = decodeFixed(view.getInt16(pos, true)); pos += 2;
      fig.localCellHeight = decodeFixed(view.getInt16(pos, true)); pos += 2;
    }
    if (hasQuads) {
      const quadCount = data[pos++];
      fig.quads = [];
      for (let q = 0; q < quadCount; q++) {
        fig.quads.push({
          offsetX: decodeFixed(view.getInt16(pos, true)),
          offsetY: decodeFixed(view.getInt16(pos + 2, true)),
          cellWidth: decodeFixed(view.getInt16(pos + 4, true)),
          cellHeight: decodeFixed(view.getInt16(pos + 6, true)),
        });
        pos += 8;
      }
    }

    if (hasColorOverride) {
      fig.colorOverride = { r: data[pos++], g: data[pos++], b: data[pos++] };
      if (version >= 22) {
        const modeByte = data[pos++];
        if (modeByte < BYTE_TO_BLEND_MODE.length) {
          fig.colorOverrideBlendMode = BYTE_TO_BLEND_MODE[modeByte];
        }
        // 0xFF or out-of-range â†’ undefined â†’ legacy luminance recolor
      }
    }

    figures.push(fig);
  }

  // Groups (v6+, extended in v13 for nesting)
  const groups: GroupNode[] = [];
  if (version >= 6) {
    const groupCount = view.getUint16(pos, true); pos += 2;
    for (let i = 0; i < groupCount; i++) {
      const idIdx = view.getUint16(pos, true); pos += 2;
      const nameIdx = view.getUint16(pos, true); pos += 2;
      const gflags = data[pos++];
      const translateX = view.getFloat32(pos, true); pos += 4;
      const translateY = view.getFloat32(pos, true); pos += 4;
      const scaleX = view.getFloat32(pos, true); pos += 4;
      const scaleY = view.getFloat32(pos, true); pos += 4;
      const hasParent = version >= 13 && (gflags & 0x10) !== 0;
      const hasPreGroupName = version >= 13 && (gflags & 0x20) !== 0;
      const parentGroupId = hasParent ? strings[view.getUint16(pos, true)] : undefined;
      if (hasParent) pos += 2;
      const preGroupName = hasPreGroupName ? strings[view.getUint16(pos, true)] : undefined;
      if (hasPreGroupName) pos += 2;
      groups.push({
        id: strings[idIdx],
        name: strings[nameIdx],
        parentGroupId,
        preGroupName,
        translateX,
        translateY,
        scaleX,
        scaleY,
        rotation: BITS_TO_ROTATION[(gflags >> 2) & 0x03],
        mirrorH: (gflags & 0x01) !== 0,
        mirrorV: (gflags & 0x02) !== 0,
        ...(version >= 30 && (gflags & 0x40) !== 0 ? { isFrame: true as const } : null),
        ...(version >= 32 && (gflags & 0x80) !== 0 ? { locked: true as const } : null),
      });
    }
  }

  // SVG objects: v12+ uses a unified svgObjects section; v8-v11 stored
  // separate lines+arcs sections that we now parse into the same array.
  const svgObjects: SVGObject[] = [];
  if (version >= 12) {
    const svgCount = view.getUint16(pos, true); pos += 2;
    for (let i = 0; i < svgCount; i++) {
      const r = readSVG(view, data, pos, strings, version, gridLevel);
      svgObjects.push(r.svg);
      pos = r.pos;
    }
  } else if (version >= 8) {
    const lineCount = view.getUint16(pos, true); pos += 2;
    for (let i = 0; i < lineCount; i++) {
      const r = readLegacyLine(view, data, pos, strings, version);
      svgObjects.push(r.svg);
      pos = r.pos;
    }
    const arcCount = view.getUint16(pos, true); pos += 2;
    for (let i = 0; i < arcCount; i++) {
      const r = readLegacyArc(view, data, pos, strings, version);
      svgObjects.push(r.svg);
      pos = r.pos;
    }
  }

  // Embedded files
  const fileCount = view.getUint16(pos, true); pos += 2;
  const embeddedFiles: EmbeddedFile[] = [];
  for (let i = 0; i < fileCount; i++) {
    const fIdIdx = view.getUint16(pos, true); pos += 2;
    const fNameIdx = view.getUint16(pos, true); pos += 2;
    const widthL0 = view.getUint16(pos, true); pos += 2;
    const heightL0 = view.getUint16(pos, true); pos += 2;
    const dataLen = view.getUint32(pos, true); pos += 4;
    const fileData = data.slice(pos, pos + dataLen); pos += dataLen;
    embeddedFiles.push({
      id: strings[fIdIdx],
      name: strings[fNameIdx],
      widthL0,
      heightL0,
      data: fileData,
    });
  }

  // v1 backward compat: skip detached PNGs section if present
  if (version < 2 && pos < data.byteLength) {
    const detachedCount = view.getUint16(pos, true); pos += 2;
    for (let i = 0; i < detachedCount; i++) {
      pos += 2; // hashIdx
      const pngLen = view.getUint32(pos, true); pos += 4;
      pos += pngLen; // pngData
    }
  }

  // Images + image bytes (v10+) â€” empty for older bundles.
  const images: ImageObject[] = [];
  const imageBlobs: Record<string, Uint8Array> = {};
  if (version >= 10 && pos < data.byteLength) {
    const imageCount = view.getUint16(pos, true); pos += 2;
    for (let i = 0; i < imageCount; i++) {
      const r = readImage(view, data, pos, strings, version);
      images.push(r.img);
      pos = r.pos;
    }
    const blobCount = view.getUint16(pos, true); pos += 2;
    for (let i = 0; i < blobCount; i++) {
      const imageIdIdx = view.getUint16(pos, true); pos += 2;
      pos++; // mimeBit (already on the node; kept for forward-compat)
      const dataLen = view.getUint32(pos, true); pos += 4;
      const bytes = data.slice(pos, pos + dataLen); pos += dataLen;
      imageBlobs[strings[imageIdIdx]] = bytes;
    }
  }

  // Text objects (v29+) â€” between the image-bytes section and scene
  // order. Absent in older files (no bytes to skip; version gate only).
  const texts: TextObject[] = [];
  if (version >= 29 && pos < data.byteLength) {
    const textCount = view.getUint16(pos, true); pos += 2;
    for (let i = 0; i < textCount; i++) {
      const r = readText(view, data, pos, strings);
      texts.push(r.text);
      pos = r.pos;
    }
  }

  // Scene order (v11+) â€” paint order across all scene-object kinds.
  // Older bundles leave `sceneOrder` undefined; the loader (createInitial-
  // CompState) derives it from the kind arrays in legacy paint order.
  let sceneOrder: string[] | undefined;
  if (version >= 11 && pos < data.byteLength) {
    const orderCount = view.getUint16(pos, true); pos += 2;
    sceneOrder = new Array(orderCount);
    for (let i = 0; i < orderCount; i++) {
      const idIdx = view.getUint16(pos, true); pos += 2;
      sceneOrder[i] = strings[idIdx];
    }
  }

  // Node transforms (v14+) â€” compact Transform2D per scene node.
  let nodeTransforms: Map<string, { transform: Transform2D; parentId?: string }> | undefined;
  if (version >= 14 && pos < data.byteLength) {
    const ntCount = view.getUint16(pos, true); pos += 2;
    if (ntCount > 0) {
      nodeTransforms = new Map();
      for (let i = 0; i < ntCount; i++) {
        const idIdx = view.getUint16(pos, true); pos += 2;
        const ntflags = data[pos++];
        const rotation = BITS_TO_ROTATION[ntflags & 0x03];
        const mirrorH = (ntflags & 0x04) !== 0;
        const mirrorV = (ntflags & 0x08) !== 0;
        const hasParent = (ntflags & 0x10) !== 0;
        const tx = view.getFloat32(pos, true); pos += 4;
        const ty = view.getFloat32(pos, true); pos += 4;
        const sx = view.getFloat32(pos, true); pos += 4;
        const sy = view.getFloat32(pos, true); pos += 4;
        let parentId: string | undefined;
        if (hasParent) {
          const parentIdx = view.getUint16(pos, true); pos += 2;
          parentId = strings[parentIdx];
        }
        const transform: Transform2D = { tx, ty, sx, sy, rotation, mirrorH, mirrorV };
        nodeTransforms.set(strings[idIdx], { transform, parentId });
      }
    }
  }

  // Custom colors (v17+) â€” persisted user palette for this composition.
  // Empty for older bundles.
  const customColors: RGBColor[] = [];
  if (version >= 17 && pos < data.byteLength) {
    const ccCount = view.getUint16(pos, true); pos += 2;
    for (let i = 0; i < ccCount; i++) {
      const r = data[pos++];
      const g = data[pos++];
      const b = data[pos++];
      customColors.push({ r, g, b });
    }
  }

  // Background paint (v29+) â€” final section. Undefined for older files.
  let background: Paint | undefined;
  if (version >= 29 && pos < data.byteLength) {
    const hasBackground = data[pos++];
    if (hasBackground === 1) {
      const p = readPaint(view, data, pos);
      background = p.paint;
      pos = p.pos;
    }
  }

  // Drop GroupNodes whose subtree carries no surviving leaf members.
  // Older save paths could leave orphans behind when the last member of a
  // group was deleted â€” filter them here so the Scene Outline count and
  // the dev-mode object count agree from the moment the file loads.
  const aliveGroupIds = computeAliveGroupIds(groups, figures, svgObjects, images, texts);
  const prunedGroups = aliveGroupIds.size === groups.length
    ? groups
    : groups.filter((g) => aliveGroupIds.has(g.id));

  return {
    meta: {
      name: strings[nameIdx],
      gridLevel,
      strokeScale,
      gridIntensity,
      camera: { offsetX: cameraX, offsetY: cameraY, zoom: cameraZoom },
      figures,
      groups: prunedGroups,
      svgObjects,
      images,
      imageBlobs,
      sceneOrder,
      nodeTransforms,
      customColors,
      texts,
      background,
    },
    embeddedFiles,
  };
}
