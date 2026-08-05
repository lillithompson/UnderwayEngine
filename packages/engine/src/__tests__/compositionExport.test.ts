import { exportCompositionSVG } from '../compositionExport';

const storage: Record<string, string | Uint8Array> = {};

jest.mock('@/engine/storage', () => ({
  default: {
    getItem: jest.fn((key: string) => {
      const v = storage[key];
      return Promise.resolve(typeof v === 'string' ? v : null);
    }),
    setItem: jest.fn((key: string, value: string) => {
      storage[key] = value;
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      delete storage[key];
      return Promise.resolve();
    }),
    multiGet: jest.fn((keys: string[]) =>
      Promise.resolve(
        keys.map(k => [k, typeof storage[k] === 'string' ? storage[k] : null] as [string, string | null]),
      ),
    ),
    getBinary: jest.fn((key: string) => {
      const v = storage[key];
      return Promise.resolve(v instanceof Uint8Array ? v : null);
    }),
    setBinary: jest.fn((key: string, value: Uint8Array) => {
      storage[key] = value;
      return Promise.resolve();
    }),
  },
  __esModule: true,
}));

jest.mock('@/native-shell/bridge/webBridge', () => ({
  logToNative: jest.fn(),
}));

jest.mock('../bake', () => ({
  loadBakedFigurePng: jest.fn(() => Promise.resolve(null)),
}));

beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key];
  // Persistence keeps a global write-through cache; clear it so each test
  // sees the storage we just seeded rather than a stale prior composition.
  (globalThis as any).__facetCompMetaCache = undefined;
});

describe('exportCompositionSVG — lines', () => {
  it('renders a path element for each SVG object in the composition', async () => {
    // Content is authored at the canonical 32×32 bbox so the loadCompositionState
    // normalization is a no-op (scale=1) and the assertions match the raw SVG.
    storage['comp_meta_lines1'] = JSON.stringify({
      name: 'WithLine',
      figures: [],
      svgObjects: [
        {
          id: 'svg_a',
          segments: [
            { kind: 'line', start: [0, 0], end: [32, 0] },
            { kind: 'line', start: [32, 0], end: [32, 32] },
          ],
          color: { r: 200, g: 100, b: 50 },
          cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32,
        },
      ],
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      // strokeScale is the v4+ percentage in [0,1] — 0.04 corresponds to
      // the legacy default of "8" (= 5 SVG units × 8 = 40 stroke-width).
      strokeScale: 0.04, gridIntensity: 0.5,
    });

    const svg = await exportCompositionSVG('lines1');
    expect(svg).not.toBeNull();
    // SVG_UNITS_PER_L0_CELL = 256, so segment endpoints map to 0,0 / 8192,0 / 8192,8192
    expect(svg).toContain('<path d="M 0,0 L 8192,0 L 8192,8192"');
    expect(svg).toContain('stroke="rgb(200,100,50)"');
    // strokeScale (0.04) × MAX_LINE_WIDTH (1000) / SVG_STROKE_WIDTH (5) = 8 multiplier;
    // applied as SVG_STROKE_WIDTH × multiplier = 40.
    expect(svg).toContain('stroke-width="40"');
    expect(svg).toContain('stroke-linecap="round"');
    // Export paths must not use non-scaling-stroke; the thumbnail
    // rasterizer's stroke compensation depends on user-space stroke widths.
    expect(svg).not.toContain('non-scaling-stroke');
  });

  it('returns a non-null SVG for an svgObjects-only composition (no figures)', async () => {
    // Diagonal line spans the full canonical 32×32 box so the load
    // normalization is a no-op (scale=1) and viewBox falls out cleanly.
    storage['comp_meta_linesonly'] = JSON.stringify({
      name: 'JustLines',
      figures: [],
      svgObjects: [
        {
          id: 'svg_a',
          segments: [
            { kind: 'line', start: [0, 0], end: [32, 32] },
          ],
          color: { r: 0, g: 0, b: 0 },
          cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32,
        },
      ],
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      strokeScale: 0.04, gridIntensity: 0.5,
    });

    const svg = await exportCompositionSVG('linesonly');
    expect(svg).not.toBeNull();
    expect(svg).toContain('<path');
    // viewBox spans the segment bbox in SVG units (0..32 cells × 256 = 0..8192)
    expect(svg).toMatch(/viewBox="0 0 8192 8192"/);
  });

  it('expands the viewBox so a horizontal line has nonzero height', async () => {
    storage['comp_meta_horiz'] = JSON.stringify({
      name: 'Horiz',
      figures: [],
      svgObjects: [
        {
          id: 'svg_h',
          segments: [
            { kind: 'line', start: [0, 5], end: [10, 5] },
          ],
          color: { r: 255, g: 255, b: 255 },
          cellX: 0, cellY: 5, cellWidth: 10, cellHeight: 1,
        },
      ],
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      strokeScale: 8, gridIntensity: 0.5,
    });

    const svg = await exportCompositionSVG('horiz');
    expect(svg).not.toBeNull();
    const m = svg!.match(/viewBox="(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
    expect(m).not.toBeNull();
    const [, , , w, h] = m!;
    expect(parseFloat(w)).toBeGreaterThan(0);
    expect(parseFloat(h)).toBeGreaterThan(0);
  });

  it('skips SVG objects with no segments', async () => {
    storage['comp_meta_short'] = JSON.stringify({
      name: 'ShortLine',
      figures: [],
      svgObjects: [
        { id: 'svg_1', segments: [], color: { r: 1, g: 2, b: 3 },
          cellX: 0, cellY: 0, cellWidth: 1, cellHeight: 1 },
        { id: 'svg_2', segments: [{ kind: 'line', start: [1, 1], end: [2, 2] }],
          color: { r: 4, g: 5, b: 6 },
          cellX: 1, cellY: 1, cellWidth: 1, cellHeight: 1 },
      ],
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      strokeScale: 8, gridIntensity: 0.5,
    });

    const svg = await exportCompositionSVG('short');
    expect(svg).not.toBeNull();
    const pathMatches = svg!.match(/<path/g) ?? [];
    expect(pathMatches).toHaveLength(1);
    expect(svg).toContain('rgb(4,5,6)');
    expect(svg).not.toContain('rgb(1,2,3)');
  });

  it('paints objects in sceneOrder (back→front), not in array/kind order', async () => {
    // `svg_fill` sits first in the svgObjects array but LAST in sceneOrder, so
    // it must paint on top. Before the fix, elements were emitted in array
    // order regardless of sceneOrder, so an opaque fill authored earlier in the
    // array would render behind objects that should sit beneath it.
    storage['comp_meta_zorder'] = JSON.stringify({
      name: 'ZOrder',
      figures: [],
      svgObjects: [
        {
          id: 'svg_fill',
          segments: [
            { kind: 'line', start: [0, 0], end: [32, 0] },
            { kind: 'line', start: [32, 0], end: [32, 32] },
            { kind: 'line', start: [32, 32], end: [0, 32] },
            { kind: 'line', start: [0, 32], end: [0, 0] },
          ],
          color: { r: 10, g: 20, b: 30 },
          fillColor: { r: 111, g: 122, b: 133 },
          cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32,
        },
        {
          id: 'svg_under',
          segments: [{ kind: 'line', start: [0, 0], end: [32, 32] }],
          color: { r: 200, g: 210, b: 220 },
          cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32,
        },
      ],
      // svg_under is painted first (back), svg_fill last (front) — the reverse
      // of the array order above.
      sceneOrder: ['svg_under', 'svg_fill'],
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      strokeScale: 0.04, gridIntensity: 0.5,
    });

    const svg = await exportCompositionSVG('zorder');
    expect(svg).not.toBeNull();
    const underIdx = svg!.indexOf('stroke="rgb(200,210,220)"');
    const fillIdx = svg!.indexOf('fill="rgb(111,122,133)"');
    expect(underIdx).toBeGreaterThanOrEqual(0);
    expect(fillIdx).toBeGreaterThanOrEqual(0);
    // The back object's markup must precede the front fill's markup.
    expect(underIdx).toBeLessThan(fillIdx);
  });

  it('renders per-subpath colors for a non-tiled SVG object with subpaths', async () => {
    storage['comp_meta_subp'] = JSON.stringify({
      name: 'Subpaths',
      figures: [],
      svgObjects: [
        {
          id: 'svg_sp',
          segments: [
            { kind: 'line', start: [0, 0], end: [4, 0] },
            { kind: 'line', start: [4, 0], end: [4, 4] },
          ],
          color: { r: 255, g: 255, b: 255 },
          subpaths: [
            { segments: [{ kind: 'line', start: [0, 0], end: [4, 0] }], color: { r: 255, g: 0, b: 0 } },
            { segments: [{ kind: 'line', start: [4, 0], end: [4, 4] }], color: { r: 0, g: 0, b: 255 } },
          ],
          cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
        },
      ],
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      strokeScale: 8, gridIntensity: 0.5,
    });

    const svg = await exportCompositionSVG('subp');
    expect(svg).not.toBeNull();
    expect(svg).toContain('stroke="rgb(255,0,0)"');
    expect(svg).toContain('stroke="rgb(0,0,255)"');
    // Primary color should NOT appear — subpaths take precedence
    expect(svg).not.toContain('stroke="rgb(255,255,255)"');
    const pathMatches = svg!.match(/<path/g) ?? [];
    expect(pathMatches).toHaveLength(2);
  });

  it('renders per-subpath colors for a tiled SVG object with subpaths', async () => {
    storage['comp_meta_tilesp'] = JSON.stringify({
      name: 'TiledSubpaths',
      figures: [],
      svgObjects: [
        {
          id: 'svg_tsp',
          segments: [
            { kind: 'line', start: [0, 0], end: [2, 0] },
            { kind: 'line', start: [2, 0], end: [2, 2] },
          ],
          color: { r: 255, g: 255, b: 255 },
          subpaths: [
            { segments: [{ kind: 'line', start: [0, 0], end: [2, 0] }], color: { r: 0, g: 128, b: 0 } },
            { segments: [{ kind: 'line', start: [2, 0], end: [2, 2] }], color: { r: 128, g: 0, b: 128 } },
          ],
          tileMode: 'repeat',
          cellX: 0, cellY: 0, cellWidth: 4, cellHeight: 4,
          tileWidthL0: 2, tileHeightL0: 2,
        },
      ],
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      strokeScale: 8, gridIntensity: 0.5,
    });

    const svg = await exportCompositionSVG('tilesp');
    expect(svg).not.toBeNull();
    expect(svg).toContain('<pattern');
    expect(svg).toContain('stroke="rgb(0,128,0)"');
    expect(svg).toContain('stroke="rgb(128,0,128)"');
    expect(svg).not.toContain('stroke="rgb(255,255,255)"');
  });

  it('emits a clipPath and wraps masked siblings, exempting the mask itself', async () => {
    const closedSquare = [
      { kind: 'line', start: [0, 0], end: [32, 0] },
      { kind: 'line', start: [32, 0], end: [32, 32] },
      { kind: 'line', start: [32, 32], end: [0, 32] },
      { kind: 'line', start: [0, 32], end: [0, 0] },
    ];
    storage['comp_meta_mask1'] = JSON.stringify({
      name: 'Masked',
      figures: [],
      groups: [{
        id: 'g1', name: 'g1',
        translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
        rotation: 0, mirrorH: false, mirrorV: false,
      }],
      sceneOrder: ['svg_mask', 'svg_member'],
      svgObjects: [
        {
          id: 'svg_mask', groupId: 'g1', isMask: true,
          segments: closedSquare,
          color: { r: 10, g: 20, b: 30 },
          cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32,
        },
        {
          id: 'svg_member', groupId: 'g1',
          segments: [{ kind: 'line', start: [8, 8], end: [24, 8] }],
          color: { r: 200, g: 100, b: 50 },
          cellX: 8, cellY: 8, cellWidth: 16, cellHeight: 1,
        },
      ],
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      strokeScale: 0.04, gridIntensity: 0.5,
    });

    const svg = await exportCompositionSVG('mask1');
    expect(svg).not.toBeNull();
    // A clipPath def for the masked group, in user space.
    expect(svg).toContain('<clipPath id="groupmask-g1" clipPathUnits="userSpaceOnUse">');
    // The member's stroke is wrapped in the clip group.
    expect(svg).toMatch(/<g clip-path="url\(#groupmask-g1\)"><path d="[^"]*" fill="none"[^>]*stroke="rgb\(200,100,50\)"/);
    // The mask object renders its own stroke but is NOT wrapped by its
    // own group's clip.
    expect(svg).toContain('stroke="rgb(10,20,30)"');
    expect(svg).not.toMatch(/<g clip-path="url\(#groupmask-g1\)"><path d="[^"]*" fill="none"[^>]*stroke="rgb\(10,20,30\)"/);
  });

  it('paints a pattern-fill background rect under the pattern, clipped to the mask, outline-only mask', async () => {
    const closedSquare = [
      { kind: 'line', start: [0, 0], end: [32, 0] },
      { kind: 'line', start: [32, 0], end: [32, 32] },
      { kind: 'line', start: [32, 32], end: [0, 32] },
      { kind: 'line', start: [0, 32], end: [0, 0] },
    ];
    storage['comp_meta_pfbg'] = JSON.stringify({
      name: 'PatternFillBg',
      figures: [{
        id: 'fig_pf', groupId: 'gpf', figureKey: 'k', tileMode: 'repeat',
        cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32,
        resolutionX: 16, resolutionY: 16, tileWidthL0: 8, tileHeightL0: 8,
      }],
      groups: [{
        id: 'gpf', name: 'gpf',
        translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
        rotation: 0, mirrorH: false, mirrorV: false,
      }],
      sceneOrder: ['fig_pf', 'svg_pfmask'],
      svgObjects: [{
        id: 'svg_pfmask', groupId: 'gpf', isMask: true, isPatternFill: true,
        segments: closedSquare,
        color: { r: 10, g: 20, b: 30 },
        fillColor: { r: 1, g: 2, b: 3 },
        cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32,
      }],
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      strokeScale: 0.04, gridIntensity: 0.5,
    });

    const svg = await exportCompositionSVG('pfbg');
    expect(svg).not.toBeNull();
    // The background color is a <rect> wrapped in the mask's clip group.
    expect(svg).toMatch(/<g clip-path="url\(#groupmask-gpf\)">[^]*<rect[^>]*fill="rgb\(1,2,3\)"/);
    // The mask renders its outline (stroke) only — no solid fill on a path.
    expect(svg).toContain('stroke="rgb(10,20,30)"');
    expect(svg).not.toMatch(/<path[^>]*fill="rgb\(1,2,3\)"/);
  });

  it('frames the viewBox to the mask region, not the masked member\'s full extent', async () => {
    const closedSquare = [
      { kind: 'line', start: [0, 0], end: [32, 0] },
      { kind: 'line', start: [32, 0], end: [32, 32] },
      { kind: 'line', start: [32, 32], end: [0, 32] },
      { kind: 'line', start: [0, 32], end: [0, 0] },
    ];
    storage['comp_meta_maskframe'] = JSON.stringify({
      name: 'MaskFrame',
      figures: [],
      groups: [{
        id: 'g1', name: 'g1',
        translateX: 0, translateY: 0, scaleX: 1, scaleY: 1,
        rotation: 0, mirrorH: false, mirrorV: false,
      }],
      sceneOrder: ['svg_mask', 'svg_member'],
      svgObjects: [
        {
          id: 'svg_mask', groupId: 'g1', isMask: true,
          segments: closedSquare,
          color: { r: 10, g: 20, b: 30 },
          cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32,
        },
        {
          // A member line that runs far beyond the mask (0..200) — only the
          // 0..32 portion is visible, so the frame must stop at the mask.
          id: 'svg_member', groupId: 'g1',
          segments: [{ kind: 'line', start: [8, 8], end: [200, 8] }],
          color: { r: 200, g: 100, b: 50 },
          cellX: 8, cellY: 8, cellWidth: 192, cellHeight: 1,
        },
      ],
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      strokeScale: 0.04, gridIntensity: 0.5,
    });

    const svg = await exportCompositionSVG('maskframe');
    expect(svg).not.toBeNull();
    // viewBox is bounded by the 32×32 mask (32 cells × 256 = 8192 units),
    // NOT the member's 200-cell span.
    expect(svg).toMatch(/viewBox="0 0 8192 8192"/);
  });


  it('returns null for an empty composition (no figures, no svgObjects)', async () => {
    storage['comp_meta_empty'] = JSON.stringify({
      name: 'Empty',
      figures: [],
      svgObjects: [],
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      strokeScale: 8, gridIntensity: 0.5,
    });

    const svg = await exportCompositionSVG('empty');
    expect(svg).toBeNull();
  });
});

describe('exportCompositionSVG — path endpoints', () => {
  const withEndpoints = async (key: string, endpoints: unknown) => {
    storage[`comp_meta_${key}`] = JSON.stringify({
      name: 'Ends',
      figures: [],
      svgObjects: [
        {
          id: 'svg_a',
          segments: [{ kind: 'line', start: [0, 0], end: [32, 32] }],
          color: { r: 0, g: 0, b: 0 },
          cellX: 0, cellY: 0, cellWidth: 32, cellHeight: 32,
          stroke: { width: 0.25 },
          ...(endpoints ? { endpoints } : {}),
        },
      ],
      camera: { offsetX: 0, offsetY: 0, zoom: 1 },
      strokeScale: 0.04, gridIntensity: 0.5,
    });
    return exportCompositionSVG(key);
  };

  it('emits nothing extra for an undecorated path', async () => {
    const svg = (await withEndpoints('ends_bare', null))!;
    expect(svg).not.toContain('<circle');
    expect(svg).toContain('stroke-linecap="round"');
  });

  it('exports the circle marker at the path\'s first point', async () => {
    const svg = (await withEndpoints('ends_circle', { startMarker: 'circle' }))!;
    // A 0.25-cell stroke → r = 0.25 × 1.75 × 256 = 112, centred on (0,0).
    expect(svg).toContain('<circle cx="0" cy="0" r="112"');
    expect(svg).toContain('fill="rgb(0,0,0)"');
  });

  it('exports the arrowhead growing outward from the last point', async () => {
    const svg = (await withEndpoints('ends_arrow', { endMarker: 'arrow' }))!;
    // The tip is one stroke-length past (32,32) along the 45° tangent.
    const tip = 32 * 256 + (0.25 * 4 * 256) / Math.SQRT2;
    expect(svg).toContain(`L ${Math.round(tip * 1e3) / 1e3},${Math.round(tip * 1e3) / 1e3} `);
  });

  it('exports a square cap without touching stroke-linecap', async () => {
    const svg = (await withEndpoints('ends_cap', { startCap: 'square', endCap: 'square' }))!;
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).not.toContain('stroke-linecap="square"');
    // Two quads, one per end, over and above the stroke path itself.
    expect(svg.match(/fill="rgb\(0,0,0\)" stroke="none"/g)).toHaveLength(2);
  });

  it('draws the decorations after the stroke they cap', async () => {
    const svg = (await withEndpoints('ends_order', { endMarker: 'circle' }))!;
    expect(svg.indexOf('stroke="rgb(0,0,0)"')).toBeLessThan(svg.indexOf('<circle'));
  });
});
