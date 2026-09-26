import { PathSegment, RGBColor, SVGSubpath } from '../types';
import { buildPathD, buildSubpathsMarkup } from '../svgPathBuilder';

const RED: RGBColor = { r: 255, g: 0, b: 0 };
const BLUE: RGBColor = { r: 0, g: 0, b: 255 };

function line(start: [number, number], end: [number, number]): PathSegment {
  return { kind: 'line', start, end };
}
/** Closed square, clockwise (screen y-down) unless `ccw`. */
function square(x: number, y: number, s: number, ccw = false): PathSegment[] {
  const pts: [number, number][] = [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
  if (ccw) pts.reverse();
  return pts.map((p, i) => line(p, pts[(i + 1) % pts.length]));
}

const markup = (subs: SVGSubpath[]) => buildSubpathsMarkup(subs, 'fill="none"', (s) => buildPathD(s));
const pathTags = (m: string) => m.match(/<path [^>]*>/g) ?? [];

describe('buildSubpathsMarkup', () => {
  it('combines a run of same-colored strokes into one path', () => {
    const m = markup([
      { segments: [line([0, 0], [1, 0])], color: RED },
      { segments: [line([0, 2], [1, 2])], color: RED },
      { segments: [line([0, 4], [1, 4])], color: RED },
    ]);
    const tags = pathTags(m);
    expect(tags).toHaveLength(1);
    expect((tags[0]!.match(/M /g) ?? []).length).toBe(3);
  });

  it('keeps draw order: only CONSECUTIVE same-colored subpaths combine', () => {
    const m = markup([
      { segments: [line([0, 0], [1, 0])], color: RED },
      { segments: [line([0, 2], [1, 2])], color: BLUE },
      { segments: [line([0, 4], [1, 4])], color: RED },
    ]);
    expect(pathTags(m).map((t) => /stroke="(rgb[^"]+)"/.exec(t)![1]))
      .toEqual(['rgb(255,0,0)', 'rgb(0,0,255)', 'rgb(255,0,0)']);
  });

  it('draws fills under strokes, one path per kind', () => {
    const m = markup([
      { segments: square(0, 0, 4), color: RED, fill: true },
      { segments: square(0, 0, 4), color: RED },
      { segments: square(8, 0, 4), color: RED, fill: true },
      { segments: square(8, 0, 4), color: RED },
    ]);
    const tags = pathTags(m);
    expect(tags).toHaveLength(2);
    expect(tags[0]!).toContain('fill="rgb(255,0,0)"');
    expect(tags[1]!).toContain('stroke="rgb(255,0,0)"');
  });

  it('winds combined fills alike so overlapping sources add instead of cancelling', () => {
    // Two overlapping squares wound opposite ways: as one nonzero path they
    // would cancel to a hole where they overlap unless re-wound.
    const m = markup([
      { segments: square(0, 0, 4), color: RED, fill: true },
      { segments: square(2, 0, 4, true), color: RED, fill: true },
    ]);
    const d = /d="([^"]+)"/.exec(pathTags(m)[0]!)![1]!;
    const loops = d.split('Z').map((x) => x.trim()).filter(Boolean);
    expect(loops).toHaveLength(2);
    const area = (loop: string) => {
      const pts = [...loop.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((mm) => [Number(mm[1]), Number(mm[2])]);
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i]!;
        const [x2, y2] = pts[(i + 1) % pts.length]!;
        a += x1 * y2 - x2 * y1;
      }
      return a;
    };
    expect(Math.sign(area(loops[0]!))).toBe(Math.sign(area(loops[1]!)));
  });

  it('keeps a subpath\'s own hole counter-wound to its outline', () => {
    const m = markup([
      { segments: [...square(0, 0, 10), ...square(3, 3, 4, true)], color: RED, fill: true },
    ]);
    const d = /d="([^"]+)"/.exec(pathTags(m)[0]!)![1]!;
    expect(d.split('Z').filter((x) => x.trim()).length).toBe(2);
  });
});
