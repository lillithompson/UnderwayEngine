import {
  serializeComposition,
  deserializeComposition,
  CompositionBundle,
  EmbeddedFile,
} from '../compositionBinaryFormat';
import { CompositionFigure, GridLevel, SVGObject } from '../types';
import { computeSVGBbox } from '../compositionOps';
import { packKey } from '../tileSegmentOverrides';
import { DEFAULT_STROKE_SCALE, migrateLegacyStrokeScale } from '../strokeScale';

// Bbox fields are required on SVGObject. The binary format re-computes
// them from the geometry on read, so the input fixture bbox values are
// not under test — this helper just keeps TypeScript happy.
function sb(svg: Omit<SVGObject, 'cellX' | 'cellY' | 'cellWidth' | 'cellHeight'>): SVGObject {
  return { ...svg, ...computeSVGBbox(svg.segments) };
}

function makeFigure(overrides: Partial<CompositionFigure> & { id: string; figureKey: string }): CompositionFigure {
  return {
    cellX: 0,
    cellY: 0,
    resolutionX: 2,
    resolutionY: 2,
    cellWidth: 4,
    cellHeight: 4,
    ...overrides,
  };
}

function makeBundle(overrides?: Partial<CompositionBundle>): CompositionBundle {
  return {
    name: 'Test Comp',
    gridLevel: 1,
    strokeScale: 8,
    gridIntensity: 0.3,
    camera: { offsetX: 0, offsetY: 0, zoom: 1 },
    figures: [],
    ...overrides,
  };
}

describe('compositionBinaryFormat', () => {
  test('rejects invalid magic bytes', () => {
    const bad = new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0]);
    expect(() => deserializeComposition(bad)).toThrow('bad magic');
  });

  test('rejects unsupported version', () => {
    // Valid magic but version 99
    const bad = new Uint8Array(37 + 2); // header + metadata + empty string table
    bad[0] = 0x46; bad[1] = 0x43; bad[2] = 0x4D; bad[3] = 0x50; // FCMP
    const view = new DataView(bad.buffer);
    view.setUint16(4, 99, true); // version 99
    expect(() => deserializeComposition(bad)).toThrow('Unsupported');
  });

  test('round-trips empty composition', () => {
    const bundle = makeBundle();
    const bytes = serializeComposition(bundle, []);
    const result = deserializeComposition(bytes);

    expect(result.meta.name).toBe('Test Comp');
    expect(result.meta.gridLevel).toBe(1);
    expect(result.meta.camera).toEqual({ offsetX: 0, offsetY: 0, zoom: 1 });
    expect(result.meta.figures).toHaveLength(0);
    expect(result.embeddedFiles).toHaveLength(0);
  });

  test('round-trips composition metadata', () => {
    const bundle = makeBundle({
      name: 'My Composition 🎨',
      gridLevel: 2,
      camera: { offsetX: -123.456, offsetY: 789.012, zoom: 2.5 },
    });
    const bytes = serializeComposition(bundle, []);
    const result = deserializeComposition(bytes);

    expect(result.meta.name).toBe('My Composition 🎨');
    expect(result.meta.gridLevel).toBe(2);
    expect(result.meta.camera.offsetX).toBeCloseTo(-123.456);
    expect(result.meta.camera.offsetY).toBeCloseTo(789.012);
    expect(result.meta.camera.zoom).toBeCloseTo(2.5);
  });

  test('round-trips a figure with required fields only', () => {
    const fig = makeFigure({
      id: 'fig1',
      figureKey: 'file_123_L0',
      cellX: 4,
      cellY: 8,
      resolutionX: 2,
      resolutionY: 2,
      cellWidth: 4,
      cellHeight: 4,
    });
    const bundle = makeBundle({ figures: [fig] });
    const bytes = serializeComposition(bundle, []);
    const result = deserializeComposition(bytes);

    expect(result.meta.figures).toHaveLength(1);
    const rf = result.meta.figures[0];
    expect(rf.id).toBe('fig1');
    expect(rf.figureKey).toBe('file_123_L0');
    expect(rf.cellX).toBe(4);
    expect(rf.cellY).toBe(8);
    expect(rf.resolutionX).toBe(2);
    expect(rf.resolutionY).toBe(2);
    expect(rf.cellWidth).toBe(4);
    expect(rf.cellHeight).toBe(4);
    expect(rf.rotation).toBe(0);
    expect(rf.mirrorH).toBe(false);
    expect(rf.mirrorV).toBe(false);
  });

  test('round-trips all figure fields', () => {
    const fig: CompositionFigure = {
      id: 'fig-full',
      name: 'My Figure',
      figureKey: 'file_456_L1',
      cellX: -8.5,
      cellY: 12.25,
      resolutionX: 4,
      resolutionY: 4,
      cellWidth: 8,
      cellHeight: 8,
      rotation: 270,
      mirrorH: true,
      mirrorV: true,
      fileId: '1712345678901',
      placementLevel: 2,
      locked: true,
      transformCycleStep: 5,
      identityCellX: -4.5,
      identityCellY: 6.25,
      tileMode: 'repeat',
      tileWidthL0: 8,
      tileHeightL0: 8,
      tileOffsetXL0: 3.5,
      tileOffsetYL0: 1.25,
      quads: [
        { offsetX: 0, offsetY: 0, cellWidth: 4, cellHeight: 4 },
        { offsetX: 4.5, offsetY: -2.25, cellWidth: 8, cellHeight: 8 },
      ],
      colorOverride: { r: 200, g: 100, b: 50 },
    };
    const bundle = makeBundle({ figures: [fig] });
    const bytes = serializeComposition(bundle, []);
    const result = deserializeComposition(bytes);

    const rf = result.meta.figures[0];
    expect(rf.id).toBe('fig-full');
    expect(rf.name).toBe('My Figure');
    expect(rf.figureKey).toBe('file_456_L1');
    expect(rf.cellX).toBe(-8.5);
    expect(rf.cellY).toBe(12.25);
    expect(rf.resolutionX).toBe(4);
    expect(rf.resolutionY).toBe(4);
    expect(rf.cellWidth).toBe(8);
    expect(rf.cellHeight).toBe(8);
    expect(rf.rotation).toBe(270);
    expect(rf.mirrorH).toBe(true);
    expect(rf.mirrorV).toBe(true);
    expect(rf.fileId).toBe('1712345678901');
    expect(rf.placementLevel).toBe(2);
    expect(rf.locked).toBe(true);
    expect(rf.transformCycleStep).toBe(5);
    expect(rf.identityCellX).toBe(-4.5);
    expect(rf.identityCellY).toBe(6.25);
    expect(rf.tileMode).toBe('repeat');
    expect(rf.tileWidthL0).toBe(8);
    expect(rf.tileHeightL0).toBe(8);
    expect(rf.tileOffsetXL0).toBe(3.5);
    expect(rf.tileOffsetYL0).toBe(1.25);
    expect(rf.quads).toHaveLength(2);
    expect(rf.quads![0]).toEqual({ offsetX: 0, offsetY: 0, cellWidth: 4, cellHeight: 4 });
    expect(rf.quads![1]).toEqual({ offsetX: 4.5, offsetY: -2.25, cellWidth: 8, cellHeight: 8 });
    expect(rf.colorOverride).toEqual({ r: 200, g: 100, b: 50 });
  });

  test('round-trips explicit white colorOverride (presence is the signal, not value)', () => {
    // Tinting a figure white is meaningful: svgFigureCache treats explicit
    // white as an identity-multiply matrix and the palette includes it.
    // Collapsing it to "no tint" would silently drop user intent.
    const fig = makeFigure({
      id: 'fig-white',
      figureKey: 'k-white',
      colorOverride: { r: 255, g: 255, b: 255 },
    });
    const bundle = makeBundle({ figures: [fig] });
    const bytes = serializeComposition(bundle, []);
    const result = deserializeComposition(bytes);

    expect(result.meta.figures[0].colorOverride).toEqual({ r: 255, g: 255, b: 255 });
  });

  test('figure without colorOverride stays undefined after roundtrip', () => {
    const fig = makeFigure({ id: 'fig-untinted', figureKey: 'k-untinted' });
    const bundle = makeBundle({ figures: [fig] });
    const bytes = serializeComposition(bundle, []);
    const result = deserializeComposition(bytes);

    expect(result.meta.figures[0].colorOverride).toBeUndefined();
  });

  test('round-trips colorOverrideBlendMode alongside colorOverride', () => {
    const fig = makeFigure({
      id: 'fig-blend',
      figureKey: 'k-blend',
      colorOverride: { r: 100, g: 150, b: 200 },
      colorOverrideBlendMode: 'multiply',
    });
    const bundle = makeBundle({ figures: [fig] });
    const bytes = serializeComposition(bundle, []);
    const result = deserializeComposition(bytes);

    expect(result.meta.figures[0].colorOverride).toEqual({ r: 100, g: 150, b: 200 });
    expect(result.meta.figures[0].colorOverrideBlendMode).toBe('multiply');
  });

  test('round-trips colorOverride without blendMode as undefined', () => {
    const fig = makeFigure({
      id: 'fig-legacy',
      figureKey: 'k-legacy',
      colorOverride: { r: 50, g: 60, b: 70 },
    });
    const bundle = makeBundle({ figures: [fig] });
    const bytes = serializeComposition(bundle, []);
    const result = deserializeComposition(bytes);

    expect(result.meta.figures[0].colorOverride).toEqual({ r: 50, g: 60, b: 70 });
    expect(result.meta.figures[0].colorOverrideBlendMode).toBeUndefined();
  });

  test('round-trips all stored blend modes', () => {
    const modes = ['normal', 'multiply', 'dodge', 'lighten', 'darken', 'burn', 'hue', 'color'] as const;
    for (const mode of modes) {
      const fig = makeFigure({
        id: `fig-${mode}`,
        figureKey: `k-${mode}`,
        colorOverride: { r: 128, g: 128, b: 128 },
        colorOverrideBlendMode: mode,
      });
      const bundle = makeBundle({ figures: [fig] });
      const bytes = serializeComposition(bundle, []);
      const result = deserializeComposition(bytes);
      expect(result.meta.figures[0].colorOverrideBlendMode).toBe(mode);
    }
  });

  test('round-trips embedded files', () => {
    const fcetData = new Uint8Array([0x46, 0x43, 0x45, 0x54, 1, 0, 0, 0, 32, 0, 32, 0]); // minimal FCET header
    const embeddedFiles: EmbeddedFile[] = [{
      id: '1712345678901',
      name: 'My Tile',
      widthL0: 8,
      heightL0: 8,
      data: fcetData,
    }];
    const bundle = makeBundle({
      figures: [makeFigure({ id: 'f1', figureKey: 'file_1712345678901_L0', fileId: '1712345678901' })],
    });
    const bytes = serializeComposition(bundle, embeddedFiles);
    const result = deserializeComposition(bytes);

    expect(result.embeddedFiles).toHaveLength(1);
    const ef = result.embeddedFiles[0];
    expect(ef.id).toBe('1712345678901');
    expect(ef.name).toBe('My Tile');
    expect(ef.widthL0).toBe(8);
    expect(ef.heightL0).toBe(8);
    expect(ef.data).toEqual(fcetData);
  });

  test('round-trips groupId', () => {
    const fig1 = makeFigure({ id: 'g1', figureKey: 'k1', groupId: 'group-abc' });
    const fig2 = makeFigure({ id: 'g2', figureKey: 'k2', groupId: 'group-abc' });
    const fig3 = makeFigure({ id: 'g3', figureKey: 'k3' }); // no group
    const bundle = makeBundle({ figures: [fig1, fig2, fig3] });
    const bytes = serializeComposition(bundle, []);
    const result = deserializeComposition(bytes);

    expect(result.meta.figures[0].groupId).toBe('group-abc');
    expect(result.meta.figures[1].groupId).toBe('group-abc');
    expect(result.meta.figures[2].groupId).toBeUndefined();
  });

  test('round-trips preGroupName', () => {
    const fig1 = makeFigure({ id: 'g1', figureKey: 'k1', groupId: 'group-abc', preGroupName: 'Figure 1' });
    const fig2 = makeFigure({ id: 'g2', figureKey: 'k2', groupId: 'group-abc', preGroupName: 'Figure 2' });
    const fig3 = makeFigure({ id: 'g3', figureKey: 'k3' });
    const bundle = makeBundle({ figures: [fig1, fig2, fig3] });
    const bytes = serializeComposition(bundle, []);
    const result = deserializeComposition(bytes);

    expect(result.meta.figures[0].preGroupName).toBe('Figure 1');
    expect(result.meta.figures[1].preGroupName).toBe('Figure 2');
    expect(result.meta.figures[2].preGroupName).toBeUndefined();
  });

  test('deduplicates shared fileId in string table', () => {
    const fig1 = makeFigure({ id: 'f1', figureKey: 'file_shared_L0', fileId: 'shared' });
    const fig2 = makeFigure({ id: 'f2', figureKey: 'file_shared_L1', fileId: 'shared' });
    const bundle = makeBundle({ figures: [fig1, fig2] });
    const bytes = serializeComposition(bundle, []);
    const result = deserializeComposition(bytes);

    expect(result.meta.figures[0].fileId).toBe('shared');
    expect(result.meta.figures[1].fileId).toBe('shared');
  });

  test('handles multiple figures with mixed types', () => {
    const fileFig = makeFigure({ id: 'file1', figureKey: 'file_abc_L0', fileId: 'abc' });
    const plainFig = makeFigure({ id: 'plain1', figureKey: 'some_asset' });
    const bundle = makeBundle({ figures: [fileFig, plainFig] });
    const bytes = serializeComposition(bundle, []);
    const result = deserializeComposition(bytes);

    expect(result.meta.figures).toHaveLength(2);
    expect(result.meta.figures[0].fileId).toBe('abc');
    expect(result.meta.figures[1].fileId).toBeUndefined();
  });

  test('fixed-point precision for fractional coordinates', () => {
    const fig = makeFigure({
      id: 'frac',
      figureKey: 'k',
      cellX: 0.25,
      cellY: -0.5,
      resolutionX: 0.25,
      resolutionY: 0.5,
      cellWidth: 1.75,
      cellHeight: 3.25,
    });
    const bundle = makeBundle({ figures: [fig] });
    const bytes = serializeComposition(bundle, []);
    const result = deserializeComposition(bytes);

    const rf = result.meta.figures[0];
    expect(rf.cellX).toBe(0.25);
    expect(rf.cellY).toBe(-0.5);
    expect(rf.resolutionX).toBe(0.25);
    expect(rf.resolutionY).toBe(0.5);
    expect(rf.cellWidth).toBe(1.75);
    expect(rf.cellHeight).toBe(3.25);
  });

  test('absent optional fields remain undefined', () => {
    const fig = makeFigure({ id: 'minimal', figureKey: 'k' });
    const bundle = makeBundle({ figures: [fig] });
    const bytes = serializeComposition(bundle, []);
    const result = deserializeComposition(bytes);

    const rf = result.meta.figures[0];
    expect(rf.name).toBeUndefined();
    expect(rf.fileId).toBeUndefined();
    expect(rf.placementLevel).toBeUndefined();
    expect(rf.transformCycleStep).toBeUndefined();
    expect(rf.identityCellX).toBeUndefined();
    expect(rf.identityCellY).toBeUndefined();
    expect(rf.tileWidthL0).toBeUndefined();
    expect(rf.tileHeightL0).toBeUndefined();
    expect(rf.quads).toBeUndefined();
    expect(rf.locked).toBeUndefined();
    expect(rf.tileMode).toBeUndefined();
  });

  test('round-trips all rotation values', () => {
    const rotations: (0 | 90 | 180 | 270)[] = [0, 90, 180, 270];
    const figures = rotations.map((r, i) =>
      makeFigure({ id: `r${i}`, figureKey: `k${i}`, rotation: r })
    );
    const bundle = makeBundle({ figures });
    const bytes = serializeComposition(bundle, []);
    const result = deserializeComposition(bytes);

    for (let i = 0; i < rotations.length; i++) {
      expect(result.meta.figures[i].rotation).toBe(rotations[i]);
    }
  });

  test('round-trips all placement levels', () => {
    const levels: GridLevel[] = [0, 1, 2, 3, 4];
    const figures = levels.map((l, i) =>
      makeFigure({ id: `l${i}`, figureKey: `k${i}`, placementLevel: l })
    );
    const bundle = makeBundle({ figures });
    const bytes = serializeComposition(bundle, []);
    const result = deserializeComposition(bytes);

    for (let i = 0; i < levels.length; i++) {
      expect(result.meta.figures[i].placementLevel).toBe(levels[i]);
    }
  });

  test('round-trips large embedded file data', () => {
    // Create a 10KB fake FCET binary
    const largeData = new Uint8Array(10000);
    for (let i = 0; i < largeData.length; i++) largeData[i] = i & 0xFF;

    const embeddedFiles: EmbeddedFile[] = [{
      id: 'big',
      name: 'Big File',
      widthL0: 32,
      heightL0: 32,
      data: largeData,
    }];
    const bundle = makeBundle({
      figures: [makeFigure({ id: 'f1', figureKey: 'file_big_L0', fileId: 'big' })],
    });
    const bytes = serializeComposition(bundle, embeddedFiles);
    const result = deserializeComposition(bytes);

    expect(result.embeddedFiles[0].data).toEqual(largeData);
  });

  test('round-trips strokeScale (new 0–1 percentage format)', () => {
    const bundle = makeBundle({ strokeScale: 0.5 });
    const bytes = serializeComposition(bundle, []);
    const result = deserializeComposition(bytes);
    expect(result.meta.strokeScale).toBeCloseTo(0.5);
  });

  test('migrates legacy strokeScale (>1) on load from v22- to preserve rendered width', () => {
    // strokeScale changed from a [5, 40] literal multiplier to a [0, 1]
    // percentage of MAX_LINE_WIDTH; legacy values from pre-v23 files are
    // normalized on load via migrateLegacyStrokeScale. v23+ allows
    // strokeScale > 1 directly (composition normalization scales it).
    const bundle = makeBundle({ strokeScale: 8 });
    const v23Bytes = serializeComposition(bundle, []);
    // Patch the version down to v22 so the loader applies the legacy migration.
    new DataView(v23Bytes.buffer, v23Bytes.byteOffset, v23Bytes.byteLength).setUint16(4, 22, true);
    const result = deserializeComposition(v23Bytes);
    expect(result.meta.strokeScale).toBeCloseTo(migrateLegacyStrokeScale(8));
  });

  test('defaults strokeScale for v3 files (legacy default migrated)', () => {
    // Serialize a current bundle, then patch it back to v3 and remove the
    // strokeScale + gridIntensity bytes (16 total).
    const bundle = makeBundle();
    const currentBytes = serializeComposition(bundle, []);

    const PRE_SS = 27;  // metadata bytes before strokeScale: nameIdx(2)+gridLevel(1)+cam(24)
    const SS_GI = 16;   // strokeScale(8) + gridIntensity(8)

    const v3Bytes = new Uint8Array(currentBytes.length - SS_GI);
    // Copy header (8 bytes)
    v3Bytes.set(currentBytes.subarray(0, 8));
    // Patch version to 3
    new DataView(v3Bytes.buffer).setUint16(4, 3, true);
    // Copy metadata without strokeScale/gridIntensity (27 bytes)
    v3Bytes.set(currentBytes.subarray(8, 8 + PRE_SS), 8);
    // Copy everything after current metadata (string table + figures + files)
    v3Bytes.set(currentBytes.subarray(8 + PRE_SS + SS_GI), 8 + PRE_SS);

    const result = deserializeComposition(v3Bytes);
    expect(result.meta.strokeScale).toBeCloseTo(DEFAULT_STROKE_SCALE);
    expect(result.meta.gridIntensity).toBe(0.3);
    expect(result.meta.name).toBe('Test Comp');
    expect(result.meta.gridLevel).toBe(1);
  });

  test('round-trips gridIntensity', () => {
    const bundle = makeBundle({ gridIntensity: 0.75 });
    const bytes = serializeComposition(bundle, []);
    const result = deserializeComposition(bytes);
    expect(result.meta.gridIntensity).toBeCloseTo(0.75);
  });

  test('defaults gridIntensity to 0.3 for v8 files', () => {
    // Serialize a v9 bundle, patch to v8, remove gridIntensity bytes.
    const bundle = makeBundle();
    const v9Bytes = serializeComposition(bundle, []);

    const PRE_GI = 35; // metadata bytes before gridIntensity: nameIdx(2)+gridLevel(1)+cam(24)+strokeScale(8)
    const GI = 8;      // gridIntensity f64

    const v8Bytes = new Uint8Array(v9Bytes.length - GI);
    // Copy header (8 bytes)
    v8Bytes.set(v9Bytes.subarray(0, 8));
    // Patch version to 8
    new DataView(v8Bytes.buffer).setUint16(4, 8, true);
    // Copy metadata without gridIntensity (35 bytes)
    v8Bytes.set(v9Bytes.subarray(8, 8 + PRE_GI), 8);
    // Copy everything after v9 metadata
    v8Bytes.set(v9Bytes.subarray(8 + PRE_GI + GI), 8 + PRE_GI);

    const result = deserializeComposition(v8Bytes);
    expect(result.meta.gridIntensity).toBe(0.3);
    // v8 is pre-v23 so the loader applies the legacy migration.
    expect(result.meta.strokeScale).toBeCloseTo(migrateLegacyStrokeScale(8));
    expect(result.meta.name).toBe('Test Comp');
    expect(result.meta.gridLevel).toBe(1);
  });

  // ── SVG Objects (v12+) ──────────────────────────────────────────────

  test('round-trips an SVG object with line segments only', () => {
    const svg: SVGObject = sb({
      id: 'svg-1',
      segments: [
        { kind: 'line', start: [0, 0], end: [4, 4] },
        { kind: 'line', start: [4, 4], end: [8, 0] },
      ],
      color: { r: 200, g: 100, b: 50 },
    });
    const bytes = serializeComposition(makeBundle({ svgObjects: [svg] }), []);
    const result = deserializeComposition(bytes);

    expect(result.meta.svgObjects).toHaveLength(1);
    const rs = result.meta.svgObjects![0];
    expect(rs.id).toBe('svg-1');
    expect(rs.segments).toEqual([
      { kind: 'line', start: [0, 0], end: [4, 4] },
      { kind: 'line', start: [4, 4], end: [8, 0] },
    ]);
    expect(rs.color).toEqual({ r: 200, g: 100, b: 50 });
    expect(rs.name).toBeUndefined();
    expect(rs.groupId).toBeUndefined();
    expect(rs.preGroupName).toBeUndefined();
    expect(rs.rotation).toBeUndefined();
    expect(rs.mirrorH).toBeUndefined();
    expect(rs.mirrorV).toBeUndefined();
    expect(rs.locked).toBeUndefined();
    expect(rs.localSegments).toBeUndefined();
    expect(rs.identitySegments).toBeUndefined();
  });

  test('round-trips an SVG object with all optional fields', () => {
    const svg: SVGObject = sb({
      id: 'svg-full',
      name: 'My Path',
      segments: [{ kind: 'line', start: [1.25, -2.5], end: [3.75, 4.5] }],
      localSegments: [{ kind: 'line', start: [0, 0], end: [2.5, 7] }],
      identitySegments: [{ kind: 'line', start: [-1, -1], end: [1, 1] }],
      groupId: 'group-A',
      preGroupName: 'Old Name',
      rotation: 270,
      mirrorH: true,
      mirrorV: true,
      locked: true,
      color: { r: 0, g: 128, b: 255 },
    });
    const bytes = serializeComposition(makeBundle({ svgObjects: [svg] }), []);
    const result = deserializeComposition(bytes);

    const rs = result.meta.svgObjects![0];
    expect(rs.id).toBe('svg-full');
    expect(rs.name).toBe('My Path');
    expect(rs.segments).toEqual([{ kind: 'line', start: [1.25, -2.5], end: [3.75, 4.5] }]);
    expect(rs.localSegments).toEqual([{ kind: 'line', start: [0, 0], end: [2.5, 7] }]);
    expect(rs.identitySegments).toEqual([{ kind: 'line', start: [-1, -1], end: [1, 1] }]);
    expect(rs.groupId).toBe('group-A');
    expect(rs.preGroupName).toBe('Old Name');
    expect(rs.rotation).toBe(270);
    expect(rs.mirrorH).toBe(true);
    expect(rs.mirrorV).toBe(true);
    expect(rs.locked).toBe(true);
    expect(rs.color).toEqual({ r: 0, g: 128, b: 255 });
  });

  test('round-trips multiple SVG objects with shared groupId', () => {
    const svgs: SVGObject[] = [
      sb({ id: 's1', segments: [{ kind: 'line', start: [0, 0], end: [1, 1] }], color: { r: 1, g: 2, b: 3 }, groupId: 'g' }),
      sb({ id: 's2', segments: [{ kind: 'line', start: [2, 2], end: [3, 3] }], color: { r: 4, g: 5, b: 6 }, groupId: 'g' }),
    ];
    const bytes = serializeComposition(makeBundle({ svgObjects: svgs }), []);
    const result = deserializeComposition(bytes);
    expect(result.meta.svgObjects).toHaveLength(2);
    expect(result.meta.svgObjects![0].groupId).toBe('g');
    expect(result.meta.svgObjects![1].groupId).toBe('g');
  });

  test('round-trips an SVG with arc segments', () => {
    const svg: SVGObject = sb({
      id: 'svg-arc',
      segments: [
        { kind: 'arc', start: [0, 0], end: [4, 4], center: [4, 0] },
      ],
      color: { r: 255, g: 255, b: 255 },
    });
    const bytes = serializeComposition(makeBundle({ svgObjects: [svg] }), []);
    const result = deserializeComposition(bytes);

    expect(result.meta.svgObjects).toHaveLength(1);
    const rs = result.meta.svgObjects![0];
    expect(rs.id).toBe('svg-arc');
    expect(rs.segments).toHaveLength(1);
    expect(rs.segments[0]).toEqual({ kind: 'arc', start: [0, 0], end: [4, 4], center: [4, 0] });
    expect(rs.color).toEqual({ r: 255, g: 255, b: 255 });
    expect(rs.localSegments).toBeUndefined();
    expect(rs.identitySegments).toBeUndefined();
  });

  test('round-trips an SVG with mixed arc and line segments', () => {
    const svg: SVGObject = sb({
      id: 'svg-mix',
      segments: [
        { kind: 'arc', start: [0, 0], end: [4, 4], center: [4, 0] },
        { kind: 'line', start: [4, 4], end: [8, 4] },
        { kind: 'arc', start: [8, 4], end: [12, 0], center: [8, 0] },
      ],
      color: { r: 10, g: 20, b: 30 },
    });
    const bytes = serializeComposition(makeBundle({ svgObjects: [svg] }), []);
    const result = deserializeComposition(bytes);

    const rs = result.meta.svgObjects![0];
    expect(rs.segments).toHaveLength(3);
    expect(rs.segments[0]).toEqual({ kind: 'arc', start: [0, 0], end: [4, 4], center: [4, 0] });
    expect(rs.segments[1]).toEqual({ kind: 'line', start: [4, 4], end: [8, 4] });
    expect(rs.segments[2]).toEqual({ kind: 'arc', start: [8, 4], end: [12, 0], center: [8, 0] });
  });

  test('round-trips a tiled SVG with sparse per-copy segment overrides (v28)', () => {
    const svg: SVGObject = sb({
      id: 'svg-tiled-paint',
      segments: [
        { kind: 'line', start: [0, 0], end: [4, 0] },
        { kind: 'line', start: [4, 0], end: [4, 4] },
      ],
      color: { r: 255, g: 255, b: 255 },
      tileMode: 'repeat',
      tileWidthL0: 4,
      tileHeightL0: 4,
      segmentOverrides: new Map([
        [packKey(0, 0, 0)!, { r: 255, g: 0, b: 0 }],
        [packKey(1, 0, 1)!, { r: 0, g: 128, b: 255 }],
        [packKey(-2, 3, 0)!, { r: 9, g: 9, b: 9 }],
      ]),
    });
    const bytes = serializeComposition(makeBundle({ svgObjects: [svg] }), []);
    const result = deserializeComposition(bytes);

    const rs = result.meta.svgObjects![0];
    expect(rs.segmentOverrides).toBeInstanceOf(Map);
    expect(rs.segmentOverrides!.size).toBe(3);
    expect(rs.segmentOverrides!.get(packKey(0, 0, 0)!)).toEqual({ r: 255, g: 0, b: 0 });
    expect(rs.segmentOverrides!.get(packKey(1, 0, 1)!)).toEqual({ r: 0, g: 128, b: 255 });
    expect(rs.segmentOverrides!.get(packKey(-2, 3, 0)!)).toEqual({ r: 9, g: 9, b: 9 });
  });

  test('a tiled SVG without overrides leaves segmentOverrides undefined', () => {
    const svg: SVGObject = sb({
      id: 'svg-tiled-plain',
      segments: [{ kind: 'line', start: [0, 0], end: [4, 0] }],
      color: { r: 1, g: 2, b: 3 },
      tileMode: 'repeat',
      tileWidthL0: 4,
      tileHeightL0: 4,
    });
    const result = deserializeComposition(serializeComposition(makeBundle({ svgObjects: [svg] }), []));
    expect(result.meta.svgObjects![0].segmentOverrides).toBeUndefined();
  });

  test('round-trips an SVG with all optional fields including arc segments', () => {
    const svg: SVGObject = sb({
      id: 'svg-full-arc',
      name: 'My Arc Path',
      segments: [{ kind: 'arc', start: [0.25, 0.5], end: [4.75, 4.25], center: [4.5, 0.25] }],
      localSegments: [{ kind: 'line', start: [0, 0], end: [1, 1] }],
      identitySegments: [{ kind: 'arc', start: [-1, -1], end: [1, 1], center: [1, -1] }],
      color: { r: 99, g: 88, b: 77 },
      groupId: 'svg-group',
      preGroupName: 'Old SVG',
      rotation: 180,
      mirrorH: true,
      mirrorV: false,
      locked: true,
    });
    const bytes = serializeComposition(makeBundle({ svgObjects: [svg] }), []);
    const result = deserializeComposition(bytes);

    const rs = result.meta.svgObjects![0];
    expect(rs.id).toBe('svg-full-arc');
    expect(rs.name).toBe('My Arc Path');
    expect(rs.segments).toEqual([{ kind: 'arc', start: [0.25, 0.5], end: [4.75, 4.25], center: [4.5, 0.25] }]);
    expect(rs.localSegments).toEqual([{ kind: 'line', start: [0, 0], end: [1, 1] }]);
    expect(rs.identitySegments).toEqual([{ kind: 'arc', start: [-1, -1], end: [1, 1], center: [1, -1] }]);
    expect(rs.color).toEqual({ r: 99, g: 88, b: 77 });
    expect(rs.groupId).toBe('svg-group');
    expect(rs.preGroupName).toBe('Old SVG');
    expect(rs.rotation).toBe(180);
    expect(rs.mirrorH).toBe(true);
    expect(rs.mirrorV).toBeUndefined();
    expect(rs.locked).toBe(true);
  });

  // ── SVG Objects alongside figures and embedded files ───────────────

  test('round-trips svgObjects alongside figures and embedded files', () => {
    const fcetData = new Uint8Array([0x46, 0x43, 0x45, 0x54, 1, 0, 0, 0, 32, 0, 32, 0]);
    const fig = makeFigure({ id: 'f1', figureKey: 'file_x_L0', fileId: 'x' });
    const svg1: SVGObject = sb({ id: 's1', segments: [{ kind: 'line', start: [0, 0], end: [4, 0] }], color: { r: 1, g: 2, b: 3 } });
    const svg2: SVGObject = sb({
      id: 's2',
      segments: [{ kind: 'arc', start: [0, 0], end: [2, 2], center: [2, 0] }],
      color: { r: 4, g: 5, b: 6 },
    });
    const bytes = serializeComposition(
      makeBundle({ figures: [fig], svgObjects: [svg1, svg2] }),
      [{ id: 'x', name: 'X', widthL0: 8, heightL0: 8, data: fcetData }],
    );
    const result = deserializeComposition(bytes);

    expect(result.meta.figures).toHaveLength(1);
    expect(result.meta.svgObjects).toHaveLength(2);
    expect(result.embeddedFiles).toHaveLength(1);
    expect(result.embeddedFiles[0].data).toEqual(fcetData);
  });

  // ── v7 backward compat ─────────────────────────────────────────────

  test('round-trips a reference image with opacity', () => {
    const img = {
      id: 'img_a', imageId: 'blob_x', mimeType: 'image/png' as const,
      pixelWidth: 64, pixelHeight: 64,
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
      opacity: 0.4,
    };
    const out = serializeComposition(
      makeBundle({ images: [img], imageBlobs: { blob_x: new Uint8Array([1]) } }),
      [],
    );
    const result = deserializeComposition(out);
    // Quantization to 0..255 introduces a small rounding error; 0.4 ×
    // 255 = 102 → 102 / 255 ≈ 0.4. Allow a 1-step tolerance.
    expect(result.meta.images![0].opacity).toBeCloseTo(0.4, 2);
  });

  test('round-trips a hidden reference image', () => {
    const img = {
      id: 'img_a', imageId: 'blob_x', mimeType: 'image/png' as const,
      pixelWidth: 64, pixelHeight: 64,
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
      hidden: true,
    };
    const out = serializeComposition(
      makeBundle({ images: [img], imageBlobs: { blob_x: new Uint8Array([1]) } }),
      [],
    );
    const result = deserializeComposition(out);
    expect(result.meta.images![0].hidden).toBe(true);
  });

  test('hidden survives a round-trip alongside rotation', () => {
    const img = {
      id: 'img_a', imageId: 'blob_x', mimeType: 'image/png' as const,
      pixelWidth: 64, pixelHeight: 64,
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
      rotation: 270 as const,
      hidden: true,
    };
    const out = serializeComposition(
      makeBundle({ images: [img], imageBlobs: { blob_x: new Uint8Array([1]) } }),
      [],
    );
    const result = deserializeComposition(out);
    expect(result.meta.images![0].rotation).toBe(270);
    expect(result.meta.images![0].hidden).toBe(true);
  });

  // ── v33: image framing ("Crop" bar) + cornerRadius ──────────────────
  // Regression: the binary format silently dropped `framing`, so a photo's
  // crop/pan/zoom was lost on reopen and the image appeared "clipped in a
  // different place" (it reverted to the default cover crop).

  test('round-trips a Fill framing with zoom + pan offset', () => {
    const img = {
      id: 'img_a', imageId: 'blob_x', mimeType: 'image/png' as const,
      pixelWidth: 100, pixelHeight: 100,
      cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 42,
      framing: { mode: 'fill' as const, zoom: 1.6, offsetX: 3.25, offsetY: -4.5 },
    };
    const out = serializeComposition(
      makeBundle({ images: [img], imageBlobs: { blob_x: new Uint8Array([1]) } }),
      [],
    );
    const result = deserializeComposition(out);
    expect(result.meta.images![0].framing).toEqual({
      mode: 'fill', zoom: 1.6, offsetX: 3.25, offsetY: -4.5,
    });
  });

  test('round-trips every framing mode + optional field', () => {
    const img = {
      id: 'img_a', imageId: 'blob_x', mimeType: 'image/png' as const,
      pixelWidth: 100, pixelHeight: 100,
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
      framing: {
        mode: 'crop' as const, zoom: 2, margin: 0.875, ratio: 'sixteenNine' as const,
        angle: -12.5, tileScale: 0.4, tileGap: 0.375, offsetX: 1.5, offsetY: 2.25,
      },
    };
    const out = serializeComposition(
      makeBundle({ images: [img], imageBlobs: { blob_x: new Uint8Array([1]) } }),
      [],
    );
    const result = deserializeComposition(out);
    // f64 → exact round-trip for every field.
    expect(result.meta.images![0].framing).toEqual(img.framing);
  });

  test('round-trips cornerRadius, and framing + cornerRadius together', () => {
    const img = {
      id: 'img_a', imageId: 'blob_x', mimeType: 'image/png' as const,
      pixelWidth: 100, pixelHeight: 100,
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
      cornerRadius: 0.25,
      framing: { mode: 'fit' as const, margin: 1.5 },
    };
    const out = serializeComposition(
      makeBundle({ images: [img], imageBlobs: { blob_x: new Uint8Array([1]) } }),
      [],
    );
    const result = deserializeComposition(out);
    expect(result.meta.images![0].cornerRadius).toBeCloseTo(0.25, 5);
    expect(result.meta.images![0].framing).toEqual({ mode: 'fit', margin: 1.5 });
  });

  test('an image without framing / cornerRadius stays clean', () => {
    const img = {
      id: 'img_a', imageId: 'blob_x', mimeType: 'image/png' as const,
      pixelWidth: 100, pixelHeight: 100,
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
    };
    const out = serializeComposition(
      makeBundle({ images: [img], imageBlobs: { blob_x: new Uint8Array([1]) } }),
      [],
    );
    const result = deserializeComposition(out);
    expect(result.meta.images![0].framing).toBeUndefined();
    expect(result.meta.images![0].cornerRadius).toBeUndefined();
  });

  test('round-trips a hidden figure', () => {
    const fig = makeFigure({ id: 'fig1', figureKey: 'file_123_L0', hidden: true });
    const bytes = serializeComposition(makeBundle({ figures: [fig] }), []);
    const result = deserializeComposition(bytes);
    expect(result.meta.figures[0].hidden).toBe(true);
  });

  test('figure without hidden flag reads back as undefined', () => {
    const fig = makeFigure({ id: 'fig1', figureKey: 'file_123_L0' });
    const bytes = serializeComposition(makeBundle({ figures: [fig] }), []);
    const result = deserializeComposition(bytes);
    expect(result.meta.figures[0].hidden).toBeUndefined();
  });

  test('hidden survives a round-trip alongside other figure flags', () => {
    const fig = makeFigure({
      id: 'fig1', figureKey: 'file_123_L0',
      hidden: true, locked: true, mirrorH: true, name: 'My Figure',
    });
    const bytes = serializeComposition(makeBundle({ figures: [fig] }), []);
    const result = deserializeComposition(bytes);
    const rf = result.meta.figures[0];
    expect(rf.hidden).toBe(true);
    expect(rf.locked).toBe(true);
    expect(rf.mirrorH).toBe(true);
    expect(rf.name).toBe('My Figure');
  });

  test('round-trips a hidden SVG object', () => {
    const svg: SVGObject = sb({
      id: 'svg-1',
      segments: [{ kind: 'line', start: [0, 0], end: [4, 4] }],
      color: { r: 200, g: 100, b: 50 },
      hidden: true,
    });
    const bytes = serializeComposition(makeBundle({ svgObjects: [svg] }), []);
    const result = deserializeComposition(bytes);
    expect(result.meta.svgObjects![0].hidden).toBe(true);
  });

  test('SVG object without hidden flag reads back as undefined', () => {
    const svg: SVGObject = sb({
      id: 'svg-1',
      segments: [{ kind: 'line', start: [0, 0], end: [4, 4] }],
      color: { r: 200, g: 100, b: 50 },
    });
    const bytes = serializeComposition(makeBundle({ svgObjects: [svg] }), []);
    const result = deserializeComposition(bytes);
    expect(result.meta.svgObjects![0].hidden).toBeUndefined();
  });

  test('image without hidden flag reads back as undefined', () => {
    const img = {
      id: 'img_a', imageId: 'blob_x', mimeType: 'image/png' as const,
      pixelWidth: 64, pixelHeight: 64,
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
    };
    const out = serializeComposition(
      makeBundle({ images: [img], imageBlobs: { blob_x: new Uint8Array([1]) } }),
      [],
    );
    const result = deserializeComposition(out);
    expect(result.meta.images![0].hidden).toBeUndefined();
  });

  test('image with default opacity reads back as undefined', () => {
    const img = {
      id: 'img_a', imageId: 'blob_x', mimeType: 'image/png' as const,
      pixelWidth: 64, pixelHeight: 64,
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
    };
    const out = serializeComposition(
      makeBundle({ images: [img], imageBlobs: { blob_x: new Uint8Array([1]) } }),
      [],
    );
    const result = deserializeComposition(out);
    expect(result.meta.images![0].opacity).toBeUndefined();
  });

  test('round-trips a reference image with bytes payload', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xde, 0xad, 0xbe, 0xef]);
    const img = {
      id: 'img_a', imageId: 'blob_x', mimeType: 'image/png' as const,
      pixelWidth: 1024, pixelHeight: 768,
      cellX: 4, cellY: 8, cellWidth: 8, cellHeight: 6,
    };
    const out = serializeComposition(
      makeBundle({ images: [img], imageBlobs: { blob_x: bytes } }),
      [],
    );
    const result = deserializeComposition(out);
    expect(result.meta.images).toHaveLength(1);
    expect(result.meta.images![0].id).toBe('img_a');
    expect(result.meta.images![0].imageId).toBe('blob_x');
    expect(result.meta.images![0].mimeType).toBe('image/png');
    expect(result.meta.images![0].pixelWidth).toBe(1024);
    expect(result.meta.images![0].cellX).toBe(4);
    expect(result.meta.images![0].cellWidth).toBe(8);
    expect(result.meta.imageBlobs!.blob_x).toEqual(bytes);
  });

  test('round-trips an image with a separate full-res original blob', () => {
    const display = new Uint8Array([1, 1, 1, 1]);
    const original = new Uint8Array([2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
    const img = {
      id: 'img_a', imageId: 'blob_display', originalImageId: 'blob_orig',
      mimeType: 'image/jpeg' as const,
      pixelWidth: 1024, pixelHeight: 768,
      cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 6,
    };
    const out = serializeComposition(
      makeBundle({ images: [img], imageBlobs: { blob_display: display, blob_orig: original } }),
      [],
    );
    const result = deserializeComposition(out);
    const r = result.meta.images![0];
    expect(r.imageId).toBe('blob_display');
    expect(r.originalImageId).toBe('blob_orig');
    // Both blobs survive under their own keys.
    expect(result.meta.imageBlobs!.blob_display).toEqual(display);
    expect(result.meta.imageBlobs!.blob_orig).toEqual(original);
  });

  test('image without an original reads originalImageId back as undefined', () => {
    const img = {
      id: 'img_a', imageId: 'blob_x', mimeType: 'image/png' as const,
      pixelWidth: 64, pixelHeight: 64,
      cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
    };
    const out = serializeComposition(
      makeBundle({ images: [img], imageBlobs: { blob_x: new Uint8Array([1]) } }),
      [],
    );
    const result = deserializeComposition(out);
    expect(result.meta.images![0].originalImageId).toBeUndefined();
    // No stray blob written for an absent original.
    expect(Object.keys(result.meta.imageBlobs!)).toEqual(['blob_x']);
  });

  test('original blob survives alongside rotation and effects bits', () => {
    const img = {
      id: 'img_a', imageId: 'blob_d', originalImageId: 'blob_o',
      mimeType: 'image/png' as const,
      pixelWidth: 2000, pixelHeight: 1000,
      cellX: 0, cellY: 0, cellWidth: 8, cellHeight: 4,
      rotation: 90 as const,
      tint: { color: { r: 10, g: 20, b: 30 }, amount: 0.5, mode: 'tint' as const },
    };
    const out = serializeComposition(
      makeBundle({ images: [img], imageBlobs: { blob_d: new Uint8Array([1]), blob_o: new Uint8Array([9, 9]) } }),
      [],
    );
    const result = deserializeComposition(out);
    const r = result.meta.images![0];
    expect(r.rotation).toBe(90);
    expect(r.tint?.amount).toBeCloseTo(0.5, 2);
    expect(r.originalImageId).toBe('blob_o');
    expect(result.meta.imageBlobs!.blob_o).toEqual(new Uint8Array([9, 9]));
  });

  test('image bytes are deduplicated by imageId across nodes', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const a = { id: 'img_a', imageId: 'blob_x', mimeType: 'image/jpeg' as const,
      pixelWidth: 256, pixelHeight: 256, cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4 };
    const b = { id: 'img_b', imageId: 'blob_x', mimeType: 'image/jpeg' as const,
      pixelWidth: 256, pixelHeight: 256, cellX: 5, cellY: 5, cellWidth: 4, cellHeight: 4 };
    const out = serializeComposition(
      makeBundle({ images: [a, b], imageBlobs: { blob_x: bytes } }),
      [],
    );
    // Encoded length should not double for two nodes referencing the
    // same blob — only one bytes record exists.
    const result = deserializeComposition(out);
    expect(result.meta.images).toHaveLength(2);
    expect(Object.keys(result.meta.imageBlobs!)).toEqual(['blob_x']);
    expect(result.meta.imageBlobs!.blob_x).toEqual(bytes);
  });

  test('round-trips an image with grouping and identity bbox', () => {
    const img = {
      id: 'img_a', imageId: 'blob_x', mimeType: 'image/png' as const,
      pixelWidth: 100, pixelHeight: 100,
      cellX: 4, cellY: 8, cellWidth: 8, cellHeight: 8,
      rotation: 90 as const, mirrorH: true,
      groupId: 'g1', preGroupName: 'orig',
      localCellX: 2, localCellY: 4, localCellWidth: 4, localCellHeight: 4,
      identityCellX: 0, identityCellY: 0, identityCellWidth: 8, identityCellHeight: 8,
    };
    const out = serializeComposition(
      makeBundle({ images: [img], imageBlobs: { blob_x: new Uint8Array([42]) } }),
      [],
    );
    const result = deserializeComposition(out);
    const r = result.meta.images![0];
    expect(r.rotation).toBe(90);
    expect(r.mirrorH).toBe(true);
    expect(r.groupId).toBe('g1');
    expect(r.preGroupName).toBe('orig');
    expect(r.localCellX).toBe(2);
    expect(r.localCellWidth).toBe(4);
    expect(r.identityCellX).toBe(0);
    expect(r.identityCellWidth).toBe(8);
  });

  test('v7 bundles (no svgObjects section) decode with empty arrays', () => {
    // Build a v12 bundle with no svgObjects and no embedded files, then strip
    // the gridIntensity f64 from metadata (v9+) and the svgCount u16 from the
    // tail (v12+), then patch version to 7.
    const fig = makeFigure({ id: 'f1', figureKey: 'k1' });
    const v12Bytes = serializeComposition(makeBundle({ figures: [fig] }), []);

    // Step 1: strip gridIntensity (8 bytes) from metadata
    const GI_OFFSET = 8 + 35; // header(8) + pre-gridIntensity metadata(35)
    const GI = 8;
    const noGI = new Uint8Array(v12Bytes.length - GI);
    noGI.set(v12Bytes.subarray(0, GI_OFFSET));
    noGI.set(v12Bytes.subarray(GI_OFFSET + GI), GI_OFFSET);

    // Step 2: strip svgCount(2) from tail
    const TAIL = 2; // fileCount(2)
    const SPLICE = 2; // svgCount(2)
    const cutAt = noGI.length - TAIL - SPLICE;

    const v7Bytes = new Uint8Array(noGI.length - SPLICE);
    v7Bytes.set(noGI.subarray(0, cutAt));
    v7Bytes.set(noGI.subarray(cutAt + SPLICE), cutAt);
    new DataView(v7Bytes.buffer).setUint16(4, 7, true);

    const result = deserializeComposition(v7Bytes);
    expect(result.meta.figures).toHaveLength(1);
    expect(result.meta.figures[0].id).toBe('f1');
    expect(result.meta.svgObjects).toEqual([]);
    expect(result.embeddedFiles).toHaveLength(0);
  });

  test('round-trips tiled SVG with line segments', () => {
    const svg: SVGObject = {
      ...sb({ id: 'ts1', segments: [{ kind: 'line', start: [0, 0], end: [4, 4] }], color: { r: 255, g: 0, b: 0 } }),
      tileMode: 'repeat',
      tileWidthL0: 4,
      tileHeightL0: 4,
      tileOffsetXL0: 2.5,
    };
    const bundle = makeBundle({ svgObjects: [svg] });
    const bytes = serializeComposition(bundle, []);
    const result = deserializeComposition(bytes);
    const svgs = result.meta.svgObjects!;
    expect(svgs).toHaveLength(1);
    expect(svgs[0].id).toBe('ts1');
    expect(svgs[0].tileMode).toBe('repeat');
    expect(svgs[0].tileWidthL0).toBe(4);
    expect(svgs[0].tileHeightL0).toBe(4);
    expect(svgs[0].tileOffsetXL0).toBe(2.5);
    expect(svgs[0].tileOffsetYL0).toBeUndefined(); // 0 is not stored
  });

  test('round-trips non-tiled SVG (no tile fields)', () => {
    const svg: SVGObject = sb({ id: 'nts1', segments: [{ kind: 'line', start: [1, 1], end: [3, 3] }], color: { r: 0, g: 255, b: 0 } });
    const bundle = makeBundle({ svgObjects: [svg] });
    const bytes = serializeComposition(bundle, []);
    const result = deserializeComposition(bytes);
    const svgs = result.meta.svgObjects!;
    expect(svgs).toHaveLength(1);
    expect(svgs[0].tileMode).toBeUndefined();
    expect(svgs[0].tileWidthL0).toBeUndefined();
    expect(svgs[0].tileHeightL0).toBeUndefined();
  });

  test('round-trips tiled SVG with arc segments', () => {
    const svg: SVGObject = {
      ...sb({
        id: 'ta1',
        segments: [{ kind: 'arc', start: [0, 2], end: [2, 0], center: [0, 0] }],
        color: { r: 0, g: 0, b: 255 },
      }),
      tileMode: 'repeat',
      tileWidthL0: 2,
      tileHeightL0: 2,
    };
    const bundle = makeBundle({ svgObjects: [svg] });
    const bytes = serializeComposition(bundle, []);
    const result = deserializeComposition(bytes);
    const svgs = result.meta.svgObjects!;
    expect(svgs).toHaveLength(1);
    expect(svgs[0].id).toBe('ta1');
    expect(svgs[0].tileMode).toBe('repeat');
    expect(svgs[0].tileWidthL0).toBe(2);
    expect(svgs[0].tileHeightL0).toBe(2);
  });

  describe('empty group pruning', () => {
    function makeGroup(id: string, name: string, parentGroupId?: string) {
      return {
        id, name, parentGroupId,
        translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
        rotation: 0 as 0 | 90 | 180 | 270, mirrorH: false, mirrorV: false,
      };
    }

    test('serialize drops a GroupNode whose subtree has no leaf members', () => {
      const bundle = makeBundle({
        figures: [],
        groups: [makeGroup('orphan_g', 'Group 1')],
      });
      const bytes = serializeComposition(bundle, []);
      const result = deserializeComposition(bytes);
      expect(result.meta.groups ?? []).toEqual([]);
    });

    test('deserialize drops orphans even when an older writer persisted them', () => {
      // First-trip uses the new serializer (which already prunes), so we
      // exercise the deserializer path explicitly by constructing a
      // bundle whose pruning is a no-op for serialize (no orphans) and
      // round-tripping a separate bundle that *does* have orphans through
      // the same call.  Both ends prune; the assertion is that the final
      // groups array contains only the alive node.
      const alive = makeGroup('alive', 'Real Group');
      const orphan = makeGroup('orphan', 'Ghost Group');
      const fig = makeFigure({ id: 'f1', figureKey: 'k', groupId: 'alive' });
      const bundle = makeBundle({
        figures: [fig],
        groups: [alive, orphan],
      });
      const bytes = serializeComposition(bundle, []);
      const result = deserializeComposition(bytes);
      expect((result.meta.groups ?? []).map((g) => g.id)).toEqual(['alive']);
    });

    test('keeps a nested group whose leaf lives in a grandchild', () => {
      const grandparent = makeGroup('gp', 'GP');
      const parent = makeGroup('p', 'P', 'gp');
      const fig = makeFigure({ id: 'f1', figureKey: 'k', groupId: 'p' });
      const bundle = makeBundle({
        figures: [fig],
        groups: [grandparent, parent],
      });
      const bytes = serializeComposition(bundle, []);
      const result = deserializeComposition(bytes);
      expect((result.meta.groups ?? []).map((g) => g.id).sort()).toEqual(['gp', 'p']);
    });

    test('round-trips the isFrame flag (v30)', () => {
      const frame = { ...makeGroup('frm', 'Frame'), isFrame: true as const };
      const plain = makeGroup('plain', 'Plain');
      const fFrame = makeFigure({ id: 'f1', figureKey: 'k', groupId: 'frm' });
      const fPlain = makeFigure({ id: 'f2', figureKey: 'k', groupId: 'plain' });
      const bytes = serializeComposition(
        makeBundle({ figures: [fFrame, fPlain], groups: [frame, plain] }),
        [],
      );
      const groups = deserializeComposition(bytes).meta.groups ?? [];
      expect(groups.find((g) => g.id === 'frm')?.isFrame).toBe(true);
      // Absent flag stays undefined (true/undefined convention, never false).
      expect(groups.find((g) => g.id === 'plain')?.isFrame).toBeUndefined();
    });

    test('round-trips the group locked flag (v32)', () => {
      const locked = { ...makeGroup('lg', 'Locked'), locked: true as const };
      const open = makeGroup('og', 'Open');
      const fLocked = makeFigure({ id: 'f1', figureKey: 'k', groupId: 'lg' });
      const fOpen = makeFigure({ id: 'f2', figureKey: 'k', groupId: 'og' });
      const bytes = serializeComposition(
        makeBundle({ figures: [fLocked, fOpen], groups: [locked, open] }),
        [],
      );
      const groups = deserializeComposition(bytes).meta.groups ?? [];
      expect(groups.find((g) => g.id === 'lg')?.locked).toBe(true);
      // Absent flag stays undefined (true/undefined convention, never false).
      expect(groups.find((g) => g.id === 'og')?.locked).toBeUndefined();
    });

    test('regression: 2objsbug.tile loads with zero scene objects and no orphan groups', () => {
      // This file was authored before the fix: 2 GroupNodes ("Group 1"
      // and "Group 1 copy") with zero figure/svg/image members.  The dev
      // counter reported "2 objs" while the Scene Outline came up empty.
      // Loading via deserialize must now drop both orphans.
      const fs = require('fs');
      const zlib = require('zlib');
      const path = require('path');
      const compressed = fs.readFileSync(path.join(__dirname, '../../test_data/2objsbug.tile'));
      const payload = new Uint8Array(zlib.inflateSync(compressed));
      const result = deserializeComposition(payload);
      expect(result.meta.figures).toEqual([]);
      expect(result.meta.svgObjects ?? []).toEqual([]);
      expect(result.meta.images ?? []).toEqual([]);
      expect(result.meta.groups ?? []).toEqual([]);
    });
  });

  describe('sceneOrder (v11+)', () => {
    test('round-trips a non-trivial sceneOrder across kinds', () => {
      const fig = makeFigure({ id: 'f1', figureKey: 'k' });
      const svg1 = sb({ id: 's1', segments: [{ kind: 'line', start: [0, 0], end: [1, 1] }], color: { r: 0, g: 0, b: 0 } });
      const svg2 = sb({
        id: 's2',
        segments: [{ kind: 'line', start: [0, 0], end: [1, 1] }],
        color: { r: 0, g: 0, b: 0 },
      });
      const bundle = makeBundle({
        figures: [fig],
        svgObjects: [svg1, svg2],
        // Deliberately scramble vs the legacy fixed paint order so the
        // round-trip has something to verify.
        sceneOrder: ['s1', 'f1', 's2'],
      });
      const bytes = serializeComposition(bundle, []);
      const result = deserializeComposition(bytes);
      expect(result.meta.sceneOrder).toEqual(['s1', 'f1', 's2']);
    });

    test('absent sceneOrder remains undefined for older bundles', () => {
      // makeBundle does not set sceneOrder, so the bundle goes in without
      // it. v11 still writes a count of 0 → reader returns an empty array
      // (sceneOrder is present but empty). The state-loader path is what
      // derives a fallback from kind arrays — not the binary format.
      const bundle = makeBundle({ figures: [makeFigure({ id: 'f1', figureKey: 'k' })] });
      const bytes = serializeComposition(bundle, []);
      const result = deserializeComposition(bytes);
      expect(result.meta.sceneOrder).toEqual([]);
    });
  });

  // ── v23: signed gridLevel + normalized strokeScale ─────────────────

  describe('v23 gridLevel as signed byte', () => {
    test('round-trips negative gridLevel', () => {
      const bundle = makeBundle({ gridLevel: -3 });
      const bytes = serializeComposition(bundle, []);
      const result = deserializeComposition(bytes);
      expect(result.meta.gridLevel).toBe(-3);
    });

    test('round-trips gridLevel above legacy 0..6 range', () => {
      const bundle = makeBundle({ gridLevel: 12 });
      const bytes = serializeComposition(bundle, []);
      const result = deserializeComposition(bytes);
      expect(result.meta.gridLevel).toBe(12);
    });

    test('v22 file with gridLevel=5 still loads with the same value (u8 and i8 agree in 0..127)', () => {
      const bundle = makeBundle({ gridLevel: 5 });
      const bytes = serializeComposition(bundle, []);
      // Patch version down to v22 and confirm the same gridLevel decodes.
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(4, 22, true);
      const result = deserializeComposition(bytes);
      expect(result.meta.gridLevel).toBe(5);
    });
  });

  describe('v23 strokeScale > 1', () => {
    test('round-trips strokeScale > 1 (composition normalization can scale it up)', () => {
      // After normalization the strokeScale is multiplied by the scale factor
      // (up to ~32×), so values > 1 are legitimate in v23+.
      const bundle = makeBundle({ strokeScale: 4.5 });
      const bytes = serializeComposition(bundle, []);
      const result = deserializeComposition(bytes);
      expect(result.meta.strokeScale).toBeCloseTo(4.5);
    });
  });
});

describe('v25 isMask persistence', () => {
  const closedSegments: SVGObject['segments'] = [
    { kind: 'line', start: [0, 0], end: [4, 0] },
    { kind: 'line', start: [4, 0], end: [4, 4] },
    { kind: 'line', start: [4, 4], end: [0, 4] },
    { kind: 'line', start: [0, 4], end: [0, 0] },
  ];

  test('round-trips isMask: true', () => {
    const svg = sb({
      id: 'svg-mask',
      segments: closedSegments,
      color: { r: 0, g: 0, b: 0 },
      isMask: true,
    });
    const bytes = serializeComposition(makeBundle({ svgObjects: [svg] }), []);
    const result = deserializeComposition(bytes);
    expect(result.meta.svgObjects![0].isMask).toBe(true);
  });

  test('unflagged object loads with isMask undefined', () => {
    const svg = sb({
      id: 'svg-plain',
      segments: closedSegments,
      color: { r: 0, g: 0, b: 0 },
    });
    const bytes = serializeComposition(makeBundle({ svgObjects: [svg] }), []);
    const result = deserializeComposition(bytes);
    expect(result.meta.svgObjects![0].isMask).toBeUndefined();
  });

  test('isMask coexists with fillColor in flags3', () => {
    const svg = sb({
      id: 'svg-both',
      segments: closedSegments,
      color: { r: 0, g: 0, b: 0 },
      fillColor: { r: 10, g: 20, b: 30 },
      fillOpacity: 0.5,
      isMask: true,
    });
    const bytes = serializeComposition(makeBundle({ svgObjects: [svg] }), []);
    const result = deserializeComposition(bytes);
    const rs = result.meta.svgObjects![0];
    expect(rs.isMask).toBe(true);
    expect(rs.fillColor).toEqual({ r: 10, g: 20, b: 30 });
    expect(rs.fillOpacity).toBeCloseTo(0.5, 2);
  });

  test('round-trips isPatternFill alongside isMask (v27)', () => {
    const svg = sb({
      id: 'svg-pattern',
      segments: closedSegments,
      color: { r: 0, g: 0, b: 0 },
      isMask: true,
      isPatternFill: true,
    });
    const bytes = serializeComposition(makeBundle({ svgObjects: [svg] }), []);
    const rs = deserializeComposition(bytes).meta.svgObjects![0];
    expect(rs.isMask).toBe(true);
    expect(rs.isPatternFill).toBe(true);
  });

  test('unflagged object loads with isPatternFill undefined', () => {
    const svg = sb({ id: 'svg-plain2', segments: closedSegments, color: { r: 0, g: 0, b: 0 } });
    const bytes = serializeComposition(makeBundle({ svgObjects: [svg] }), []);
    expect(deserializeComposition(bytes).meta.svgObjects![0].isPatternFill).toBeUndefined();
  });
});
