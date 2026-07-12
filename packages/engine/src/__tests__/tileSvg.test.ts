import { getTileSvgContent, buildTileSvgHtml, buildTileSvgDataUri } from '../tileSvg';
import svgSources from '../../assets/images/atlases/svg-sources.json';

const SVG_SOURCES = svgSources as Record<string, string>;

describe('getTileSvgContent', () => {
  // Pick a real sprite ID from svg-sources.json for testing
  const realId = Object.keys(SVG_SOURCES)[0];

  it('returns cleaned SVG for a known sprite', () => {
    const content = getTileSvgContent(realId);
    expect(content).not.toBeNull();
    expect(content).not.toContain('<defs>');
    expect(content).not.toMatch(/<g\s+clip-path="/);
  });

  it('returns cached result on second call', () => {
    const first = getTileSvgContent(realId);
    const second = getTileSvgContent(realId);
    expect(first).toBe(second); // same reference = cached
  });

  it('returns null for unknown sprite ID', () => {
    expect(getTileSvgContent('__nonexistent_sprite__')).toBeNull();
  });
});

describe('buildTileSvgHtml', () => {
  it('wraps content in SVG with correct viewBox and dimensions', () => {
    const html = buildTileSvgHtml('<path d="M0 0"/>', 77);
    expect(html).toBe(
      '<svg viewBox="0 0 256 256" width="77" height="77" fill="none" stroke="white"><path d="M0 0"/></svg>',
    );
  });

  it('uses provided size', () => {
    const html = buildTileSvgHtml('', 120);
    expect(html).toContain('width="120"');
    expect(html).toContain('height="120"');
  });
});

describe('buildTileSvgDataUri', () => {
  const decode = (uri: string) => decodeURIComponent(uri.replace(/^data:[^,]*,/, ''));
  const content = '<path d="M0 0L10 10" stroke="white" stroke-width="10"/>';

  it('replaces stroke="white" in content with the provided color', () => {
    const uri = buildTileSvgDataUri(content, 77, 'rgb(255,0,0)');
    const svg = decode(uri);
    expect(svg).toContain('stroke="rgb(255,0,0)"');
    expect(svg).not.toContain('stroke="white"');
  });

  it('leaves stroke="white" intact when strokeColor defaults to white', () => {
    const uri = buildTileSvgDataUri(content, 77);
    const svg = decode(uri);
    expect(svg).toContain('stroke="white"');
  });

});
