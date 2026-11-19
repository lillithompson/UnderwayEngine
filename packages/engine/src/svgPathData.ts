// SVG path data — a <path>'s `d` — read in ONE place. Three readers turn a
// drawing's paths into their own geometry: the SVG simplifier
// (simplifySVG.parsePathD keeps cubics and quadratics as they are), the
// figure bake (figureToPaths turns every curve into a circular arc) and the
// picture geometry (the editor's formats/svgImageGeometry samples curves to
// chords). Each had its own tokenizer and its own command reader, the same
// grammar written three times, and a path one of them read differently from
// the others drew a different shape by where it was imported. Here the
// grammar is read once: the commands, absolute and relative, their implicit
// repeats, the S / T reflections and the current point after a Z. What a
// curve or an arc BECOMES stays each reader's own choice, made in the sink
// it passes.
//
// Imports nothing, so a script can compile it from its TypeScript alone
// (scripts that read the simplifier that way serve it this module too).

/** A token of path data: a command letter, or a number. */
export type PathDataToken = string | number;

/**
 * Path data as its command letters and numbers, in order. Anything else
 * (whitespace, commas, any other character) only separates them and is
 * dropped. A number ends where the next character cannot continue it, so
 * `1-2` and `.5.5` are two numbers each — and so are an arc's flags written
 * without a separator (`0110` is the one number 110, not two flags and a
 * coordinate).
 */
export function tokenizePathData(d: string): PathDataToken[] {
  const tokens: PathDataToken[] = [];
  const re = /([MLHVCSQTAZmlhvcsqtaz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) tokens.push(m[1] ? m[1] : Number(m[2]));
  return tokens;
}

/**
 * What a reader of path data is told, every point in absolute coordinates.
 * Each drawing call is given the point it starts from (x0, y0), so a sink
 * needs no current point of its own.
 */
export interface PathDataSink {
  /** `M`: a subpath starts at (x, y). An `M`'s further pairs are lines. */
  moveTo(x: number, y: number): void;
  /** `L`, `H`, `V`, and an `M`'s further pairs. */
  lineTo(x0: number, y0: number, x: number, y: number): void;
  /** `C`, and `S` with its first control point already reflected. */
  cubicTo(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
  /** `Q`, and `T` with its control point already reflected. */
  quadTo(x0: number, y0: number, x1: number, y1: number, x: number, y: number): void;
  /** `A`, its radii and rotation (degrees) as written: neither made
   *  positive nor scaled up to reach, which is the sink's to do. */
  arcTo(
    x0: number, y0: number, rx: number, ry: number, rotationDeg: number,
    largeArc: boolean, sweep: boolean, x: number, y: number,
  ): void;
  /** `Z`: the subpath closes, from (x0, y0) back to its start; the current
   *  point is then that start. */
  close(x0: number, y0: number, startX: number, startY: number): void;
}

/**
 * Read path data into a sink, command by command. Relative commands are
 * made absolute and implicit repeats (`L 1 2 3 4`) are each a call; `S`
 * reflects the previous control point only after a `C` or an `S`, `T` only
 * after a `Q` or a `T`, and otherwise starts from the current point. A
 * number no command takes (before the first command, or after a `Z`) is
 * skipped. Drawing before any `M` starts from (0, 0).
 *
 * Path data that breaks the grammar is read as far as it goes and not
 * repaired: a command short of numbers takes what follows it anyway, a
 * later command letter included, and reads it (or the end of the data) as
 * NaN — so a sink is only ever given numbers.
 */
export function readPathData(d: string, sink: PathDataSink): void {
  const tokens = tokenizePathData(d);
  let i = 0;
  let cx = 0, cy = 0;     // current point
  let sx = 0, sy = 0;     // current subpath's start
  let lcx = 0, lcy = 0;   // the last curve's last control point, for S / T
  let last = '';          // the previous command, upper case
  let rel = false;        // the command being read is relative

  const hasNum = () => i < tokens.length && typeof tokens[i] === 'number';
  /** The next token as a number: NaN when a command is short of numbers
   *  and takes a command letter, or runs past the end. */
  const next = () => {
    const t = tokens[i++];
    return typeof t === 'number' ? t : NaN;
  };
  /** The next number as an x (or y): as written, or from the current point. */
  const nextX = () => { const v = next(); return rel ? cx + v : v; };
  const nextY = () => { const v = next(); return rel ? cy + v : v; };

  while (i < tokens.length) {
    const tok = tokens[i++];
    if (typeof tok === 'number') continue;
    const cmd = tok.toUpperCase();
    rel = tok !== cmd;
    switch (cmd) {
      case 'M': {
        if (!hasNum()) break;
        const x = nextX(), y = nextY();
        sink.moveTo(x, y);
        cx = sx = x;
        cy = sy = y;
        while (hasNum()) {
          const lx = nextX(), ly = nextY();
          sink.lineTo(cx, cy, lx, ly);
          cx = lx; cy = ly;
        }
        break;
      }
      case 'L':
        while (hasNum()) {
          const x = nextX(), y = nextY();
          sink.lineTo(cx, cy, x, y);
          cx = x; cy = y;
        }
        break;
      case 'H':
        while (hasNum()) {
          const x = nextX();
          sink.lineTo(cx, cy, x, cy);
          cx = x;
        }
        break;
      case 'V':
        while (hasNum()) {
          const y = nextY();
          sink.lineTo(cx, cy, cx, y);
          cy = y;
        }
        break;
      case 'C':
        while (hasNum()) {
          const x1 = nextX(), y1 = nextY(), x2 = nextX(), y2 = nextY(), x = nextX(), y = nextY();
          sink.cubicTo(cx, cy, x1, y1, x2, y2, x, y);
          lcx = x2; lcy = y2; cx = x; cy = y;
        }
        break;
      case 'S':
        while (hasNum()) {
          const smooth = last === 'C' || last === 'S';
          const x1 = smooth ? 2 * cx - lcx : cx, y1 = smooth ? 2 * cy - lcy : cy;
          const x2 = nextX(), y2 = nextY(), x = nextX(), y = nextY();
          sink.cubicTo(cx, cy, x1, y1, x2, y2, x, y);
          lcx = x2; lcy = y2; cx = x; cy = y;
          last = 'S';
        }
        break;
      case 'Q':
        while (hasNum()) {
          const x1 = nextX(), y1 = nextY(), x = nextX(), y = nextY();
          sink.quadTo(cx, cy, x1, y1, x, y);
          lcx = x1; lcy = y1; cx = x; cy = y;
        }
        break;
      case 'T':
        while (hasNum()) {
          const smooth = last === 'Q' || last === 'T';
          const x1 = smooth ? 2 * cx - lcx : cx, y1 = smooth ? 2 * cy - lcy : cy;
          const x = nextX(), y = nextY();
          sink.quadTo(cx, cy, x1, y1, x, y);
          lcx = x1; lcy = y1; cx = x; cy = y;
          last = 'T';
        }
        break;
      case 'A':
        while (hasNum()) {
          const rx = next(), ry = next(), rotationDeg = next();
          const largeArc = next() !== 0, sweep = next() !== 0;
          const x = nextX(), y = nextY();
          sink.arcTo(cx, cy, rx, ry, rotationDeg, largeArc, sweep, x, y);
          cx = x; cy = y;
        }
        break;
      case 'Z':
        sink.close(cx, cy, sx, sy);
        cx = sx; cy = sy;
        break;
    }
    if (cmd !== 'S' && cmd !== 'T') last = cmd;
  }
}
