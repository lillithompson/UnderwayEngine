// SVG path data — a <path>'s `d` — read in ONE place. Three readers turn a
// drawing's paths into their own geometry: the SVG simplifier
// (simplifySVG.parsePathD keeps cubics and quadratics as they are and writes
// an arc as cubics), the figure bake (figureToPaths turns every curve into
// circular arcs, and an ellipse's arc, an A or a cubic, into lines) and the
// picture geometry
// (the editor's formats/svgImageGeometry samples curves to chords). Each
// had its own tokenizer and its own command reader, the same grammar written
// three times, and a path one of them read differently from the others drew
// a different shape by where it was imported. Here the grammar is read once:
// the commands, absolute and relative, their implicit repeats, the S / T
// reflections, an arc's flags, the current point after a Z, and where path
// data breaks the grammar, the point the reading stops. What a curve
// or an arc BECOMES stays each reader's own choice, made in the sink it
// passes (an arc's centre and angles are the engine's one conversion,
// svgArc.ts). The export's count of control vertices (svgExport.countSVGCVs)
// reads here too, so it counts every segment the readers draw, however
// written, where its own match of command letters missed implicit repeats.
//
// Imports nothing, so a script can compile it from its TypeScript alone
// (scripts that read the simplifier that way serve it this module too).

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
   *  positive nor scaled up to reach, which the engine's one arc conversion
   *  does (svgArc.svgArcCentre). */
  arcTo(
    x0: number, y0: number, rx: number, ry: number, rotationDeg: number,
    largeArc: boolean, sweep: boolean, x: number, y: number,
  ): void;
  /** `Z`: the subpath closes, from (x0, y0) back to its start; the current
   *  point is then that start. */
  close(x0: number, y0: number, startX: number, startY: number): void;
}

/** What the token looked ahead is. Typed `number`, not as literals, so that
 *  TypeScript does not narrow the reader's `kind` across the calls that
 *  change it. */
const END: number = 0, LETTER: number = 1, NUMBER: number = 2, ERROR: number = 3;

/**
 * Read path data into a sink, command by command. Relative commands are
 * made absolute and implicit repeats (`L 1 2 3 4`) are each a call; `S`
 * reflects the previous control point only after a `C` or an `S`, `T` only
 * after a `Q` or a `T`, and otherwise starts from the current point.
 *
 * An arc's two flags are read as the grammar has them, one character each
 * (a flag is `0` or `1`), so a flag may run into what follows it with no
 * separator, as minifiers write it: `a5 5 0 0110 10` is the flags 0 and 1
 * and then 10, 10.
 *
 * Path data that breaks the grammar is drawn up to its first error and no
 * further, as SVG has a renderer draw it: "up to (but not including) the
 * path command containing the first error" (SVG 1.1, F.2), where each
 * implicit repeat is a command of its own. The grammar is SVG 1.1's: path
 * data starts with an `M` (with anything else it draws nothing); between
 * the numbers is whitespace with at most one comma in it, and between a
 * command letter and its first number whitespace only; a command takes all
 * its numbers (none is an error, and so is a repeat cut short), a `Z` none
 * (a number after one is an error); a flag is the character `0` or `1`; and
 * nothing else is allowed (`#`, `x`, a lone `.`, an `e` with no digits).
 * Two things its grammar refuses are read as every browser reads them: an
 * arc's negative radius (its absolute value, F.6.6) and a comma between a
 * command's last number and the next command letter. A number may end in a
 * dot (`1.`), as SVG 1.1's grammar has it, where browsers stop at one. A
 * number too large to be finite (`1e999`) is an error, as browsers have it,
 * so a sink is only ever given finite numbers.
 */
export function readPathData(d: string, sink: PathDataSink): void {
  // A token at a time, the next one looked ahead, so that a flag can take
  // one character of a number and leave the rest to be read on. A token is
  // whitespace with at most one comma in it (group 1, the comma) and then a
  // command letter (group 2), a number (group 3) or the end. A number ends
  // where the next character cannot continue it, so `1-2` and `.5.5` are two
  // numbers each. Where none of those is next, the data breaks the grammar.
  const re = /[\t\n\f\r ]*(,[\t\n\f\r ]*)?(?:([MLHVCSQTAZmlhvcsqtaz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|$)/y;
  let kind = END;           // the token looked ahead, not yet taken
  let text = '';            // its letter or number
  let at = 0;               // where its letter or number starts
  let next = 0;             // where the token after it starts
  let afterNumber = false;  // the token taken last was a number (or a flag)
  let bad = false;          // an error is met: nothing more is drawn

  /** Look ahead at the token at `from`. A comma that follows anything but
   *  a number (a command letter, or nothing at the start) is an error. */
  const scan = (from: number) => {
    re.lastIndex = from;
    const m = re.exec(d);
    if (m === null || (m[1] !== undefined && !afterNumber)) { kind = ERROR; return; }
    next = re.lastIndex;
    if (m[2] !== undefined) { kind = LETTER; text = m[2]; }
    else if (m[3] !== undefined) { kind = NUMBER; text = m[3]; }
    else { kind = END; return; }
    at = next - text.length;
  };
  const take = () => { afterNumber = kind === NUMBER; scan(next); };
  /** The next token as a number, taken. Where it is not a finite number,
   *  the reading has met its error: `bad`, and nothing is taken. */
  const num = (): number => {
    if (bad || kind !== NUMBER) { bad = true; return 0; }
    const v = Number(text);
    if (!Number.isFinite(v)) { bad = true; return 0; }
    take();
    return v;
  };
  /** An arc flag: the first character of the next number, which must be
   *  `0` or `1`; the rest of the number, if it runs on, is read from the
   *  character after it. */
  const flag = (): boolean => {
    if (bad || kind !== NUMBER || (text[0] !== '0' && text[0] !== '1')) { bad = true; return false; }
    const f = text[0] === '1';
    afterNumber = true;
    scan(at + 1);
    return f;
  };
  let cx = 0, cy = 0;     // current point
  let sx = 0, sy = 0;     // current subpath's start
  let lcx = 0, lcy = 0;   // the last curve's last control point, for S / T
  let last = '';          // the previous segment's command, upper case
  let rel = false;        // the command being read is relative
  /** The next number as an x (or y): as written, or from the current point. */
  const nextX = () => { const v = num(); return rel ? cx + v : v; };
  const nextY = () => { const v = num(); return rel ? cy + v : v; };

  scan(0);
  if (kind !== LETTER || (text !== 'M' && text !== 'm')) return;
  // A command letter, then its numbers once and again while a number
  // follows. Anything else where a letter must come (a number after a Z, an
  // error) ends the reading, as the end does.
  while (kind === LETTER) {
    const cmd = text.toUpperCase();
    rel = text !== cmd;
    take();
    if (cmd === 'Z') {
      sink.close(cx, cy, sx, sy);
      cx = sx; cy = sy;
      last = 'Z';
      continue;
    }
    let first = true;
    do {
      switch (cmd) {
        case 'M':
        case 'L': {
          const x = nextX(), y = nextY();
          if (bad) return;
          if (first && cmd === 'M') {
            sink.moveTo(x, y);
            sx = x; sy = y;
          } else {
            sink.lineTo(cx, cy, x, y);
          }
          cx = x; cy = y;
          break;
        }
        case 'H': {
          const x = nextX();
          if (bad) return;
          sink.lineTo(cx, cy, x, cy);
          cx = x;
          break;
        }
        case 'V': {
          const y = nextY();
          if (bad) return;
          sink.lineTo(cx, cy, cx, y);
          cy = y;
          break;
        }
        case 'C': {
          const x1 = nextX(), y1 = nextY(), x2 = nextX(), y2 = nextY(), x = nextX(), y = nextY();
          if (bad) return;
          sink.cubicTo(cx, cy, x1, y1, x2, y2, x, y);
          lcx = x2; lcy = y2; cx = x; cy = y;
          break;
        }
        case 'S': {
          const smooth = last === 'C' || last === 'S';
          const x1 = smooth ? 2 * cx - lcx : cx, y1 = smooth ? 2 * cy - lcy : cy;
          const x2 = nextX(), y2 = nextY(), x = nextX(), y = nextY();
          if (bad) return;
          sink.cubicTo(cx, cy, x1, y1, x2, y2, x, y);
          lcx = x2; lcy = y2; cx = x; cy = y;
          break;
        }
        case 'Q': {
          const x1 = nextX(), y1 = nextY(), x = nextX(), y = nextY();
          if (bad) return;
          sink.quadTo(cx, cy, x1, y1, x, y);
          lcx = x1; lcy = y1; cx = x; cy = y;
          break;
        }
        case 'T': {
          const smooth = last === 'Q' || last === 'T';
          const x1 = smooth ? 2 * cx - lcx : cx, y1 = smooth ? 2 * cy - lcy : cy;
          const x = nextX(), y = nextY();
          if (bad) return;
          sink.quadTo(cx, cy, x1, y1, x, y);
          lcx = x1; lcy = y1; cx = x; cy = y;
          break;
        }
        case 'A': {
          const rx = num(), ry = num(), rotationDeg = num();
          const largeArc = flag(), sweep = flag();
          const x = nextX(), y = nextY();
          if (bad) return;
          sink.arcTo(cx, cy, rx, ry, rotationDeg, largeArc, sweep, x, y);
          cx = x; cy = y;
          break;
        }
      }
      last = cmd;
      first = false;
    } while (kind === NUMBER);
  }
}

/**
 * The point at `t` (0 to 1) along the cubic from (x0, y0) through the
 * control points (x1, y1) and (x2, y2) to (x, y), for a reader whose sink
 * turns a cubic into chords (the figure bake's cubic that is no circle's arc).
 */
export function cubicPointAt(
  x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x: number, y: number, t: number,
): [number, number] {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
  return [a * x0 + b * x1 + c * x2 + e * x, a * y0 + b * y1 + c * y2 + e * y];
}
