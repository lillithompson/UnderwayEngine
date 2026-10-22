import fs from 'fs';
import path from 'path';
import { makeBlankComposition } from '@/editor/blankComposition';
import type { CompositionState, RGBColor } from '@/engine/types';
import { makeViewport } from '@/engine/types';
import type { Mat2D } from '@/engine/sceneTransform';
import { matApplyPoint } from '@/engine/sceneTransform';
import type { CellBbox } from '../resizeMath';
import type {
  CanvasHost, CanvasLayers, CanvasRecords, CanvasSurfaceHandle, CanvasTwist,
  GestureHooks, HostNodeTwist, PointerClaim, PointerEnd, PriorSelection,
} from '../components/canvasHooks';
import { canvasHost, clearCanvasHost, installCanvasHost } from '../components/canvasHooks';
import { resolveTwistUnit } from '../canvasTwist';
import type { HostItem, HostItems } from '../sessionHost';
import { clearSessionHost, installSessionHost } from '../sessionHost';
import {
  buildPlaceShape, commitEntry, createEditorSession, type SessionEntry,
} from '../editorSession';

// The CANVAS seam (components/canvasHooks.ts, canvasTwist.ts;
// docs/shared-editor.md §4.1, §4.3): a made-up app whose own kinds of thing
// are a DIAL — a scene node with a hidden record beside it holding the
// angle its needle stands at, so a twist rolls the needle and never the box
// — and a PEG, a thing its own document holds that stands in the selection
// and twists as a unit of one. What the three apps plug in is theirs to
// pin; this suite pins what the canvas's seam does with any of it.

// ── The made-up app ────────────────────────────────────────────────────

interface Doc { pegs: Peg[] }
interface Peg extends HostItem { x: number; y: number; heading: number | null }

const PEG_BOX = 1;
const peg = (id: string, x: number, y: number, heading: number | null = 0): Peg =>
  ({ id, x, y, heading });
const docWith = (...pegs: Peg[]): Doc => ({ pegs });

const pegBox = (p: Peg): CellBbox =>
  ({ cellX: p.x - PEG_BOX / 2, cellY: p.y - PEG_BOX / 2, cellWidth: PEG_BOX, cellHeight: PEG_BOX });

const ITEMS: HostItems<Doc, never> = {
  isHostId: (id) => id.startsWith('peg_'),
  itemById: (doc, id) => doc.pegs.find((p) => p.id === id) ?? null,
  items: (doc) => doc.pegs,
  box: (doc, id) => {
    const p = doc.pegs.find((k) => k.id === id);
    return p ? pegBox(p) : null;
  },
  through: (doc, ids, m: Mat2D) => ({
    pegs: doc.pegs.map((p) => {
      if (!ids.has(p.id)) return p;
      const [x, y] = matApplyPoint(m, p.x, p.y);
      return { ...p, x, y };
    }),
  }),
  remove: (doc, ids) => ({ pegs: doc.pegs.filter((p) => !ids.has(p.id)) }),
  setGroup: (doc) => doc,
  setLocked: (doc) => doc,
  duplicate: (doc, ids) => ({ doc, ids: [...ids] }),
  change: () => undefined as never,
};

/** The dials on the page, by the app's own marker: a node NAMED `dial:…`
 *  keeps a record, and its record holds the needle's angle. */
const DIAL_ANGLE = new Map<string, number>();

/** Every live drive the twist made, in order — what a layer handle would
 *  have been told, so the test can see the gesture's channel without a
 *  DOM. */
let drives: string[] = [];

const TWIST: CanvasTwist<Doc> = {
  loneUnit: (doc, selectedId) => {
    if (!doc || !selectedId) return null;
    const p = doc.pegs.find((k) => k.id === selectedId);
    // A peg with no heading cannot be turned: the fingers stay the
    // camera's, which is DrawBot's `turnableBot` rule.
    return p && p.heading !== null ? p.id : null;
  },
  // A peg is a cell across — no room for two fingertips — so the box the
  // pair must land in is its own grown to a fingertip pair on screen.
  grip: (bbox, pxPerCell) => {
    const pad = 20 / pxPerCell;
    return {
      cellX: bbox.cellX - pad, cellY: bbox.cellY - pad,
      cellWidth: bbox.cellWidth + 2 * pad, cellHeight: bbox.cellHeight + 2 * pad,
    };
  },
  node: (_state, nodeId) => {
    const at = DIAL_ANGLE.get(nodeId);
    if (at === undefined) return null;
    const twist: HostNodeTwist = {
      startDeg: at,
      preview: (angleDeg) => { drives.push(`preview ${nodeId} ${angleDeg}`); },
      reset: () => { drives.push(`reset ${nodeId}`); },
      commit: (_s, angleDeg) => {
        drives.push(`commit ${nodeId} ${angleDeg}`);
        return angleDeg === at ? null : ({ entry: { ops: [] } } as unknown as SessionEntry);
      },
    };
    return twist;
  },
};

const RECORDS: CanvasHost<Doc>['records'] = (state) => {
  const ids = new Set(state.svgObjects.filter((o) => (o.name ?? '').startsWith('dial:')).map((o) => o.id));
  if (ids.size === 0) return null;
  const records: CanvasRecords = { has: (nodeId) => ids.has(nodeId) };
  return records;
};

const HOST: CanvasHost<Doc> = { records: RECORDS, twist: TWIST };

// ── Fixtures ───────────────────────────────────────────────────────────

const BLACK: RGBColor = { r: 0, g: 0, b: 0 };

type S = ReturnType<typeof newSession>;
function newSession(doc: Doc = docWith(), state: CompositionState = makeBlankComposition('canvas')) {
  return createEditorSession<string, Doc, never>(state, 'arrange', doc);
}

/** A rectangle at (x, y), w × h, placed and committed; its id. */
function placeRect(session: S, x: number, y: number, w = 4, h = 4): [S, string] {
  const se = buildPlaceShape('rect', { cellX: x, cellY: y, cellWidth: w, cellHeight: h }, BLACK);
  return [commitEntry(session, se), se.id!];
}

const sel = (selectedId: string | null, ...rest: string[]) => ({
  selectedId,
  selectedIds: selectedId === null ? [] : [selectedId, ...rest],
});

// Cleared before AND after: an app that installs its own hosts in a jest
// setupFile runs this suite from its vendor root with them pre-installed.
beforeEach(() => {
  clearCanvasHost();
  clearSessionHost();
  DIAL_ANGLE.clear();
  drives = [];
});
afterEach(() => {
  clearCanvasHost();
  clearSessionHost();
});

describe('installing the canvas host', () => {
  test('nothing installed means nothing of a host: every member absent', () => {
    expect(canvasHost()).toEqual({});
  });

  test('install, read back, clear', () => {
    installCanvasHost(HOST);
    expect(canvasHost<Doc>().twist).toBe(TWIST);
    installCanvasHost(null);
    expect(canvasHost()).toEqual({});
  });
});

describe('the host’s per-node records, as a predicate', () => {
  test('a page with none of the host’s kinds answers null, and is asked once', () => {
    const reads = jest.fn(RECORDS!);
    installCanvasHost({ records: reads });
    let s = newSession();
    [s] = placeRect(s, 0, 0);
    expect(canvasHost().records!(s.state)).toBeNull();
    expect(reads).toHaveBeenCalledTimes(1);
  });

  test('a record is reached by asking, never by handing over the map', () => {
    installCanvasHost(HOST);
    let s = newSession();
    let dial: string;
    let plain: string;
    [s, dial] = placeRect(s, 0, 0);
    [s, plain] = placeRect(s, 20, 20);
    DIAL_ANGLE.set(dial, 30);
    // The app's own marker on the page: the suite's reader goes by the
    // node's name, as CozyJournal's goes by its pose record.
    s = {
      ...s,
      state: {
        ...s.state,
        svgObjects: s.state.svgObjects.map((o) => (o.id === dial ? { ...o, name: 'dial:1' } : o)),
      },
    };
    const records = canvasHost().records!(s.state)!;
    expect(records.has(dial)).toBe(true);
    expect(records.has(plain)).toBe(false);
    // The canvas gets a question, not the record: nothing on the reader
    // hands back what the host keeps.
    expect(Object.keys(records)).toEqual(['has']);
  });
});

describe('a host node’s twist, resolved once at the press', () => {
  test('an ordinary scene node is none of the host’s: the canvas turns it its own way', () => {
    installCanvasHost(HOST);
    let s = newSession();
    let r: string;
    [s, r] = placeRect(s, 0, 0);
    expect(canvasHost<Doc>().twist!.node!(s.state, r)).toBeNull();
  });

  test('the host’s own node answers with its reading, its drive, its undo and its entry', () => {
    installCanvasHost(HOST);
    let s = newSession();
    let r: string;
    [s, r] = placeRect(s, 0, 0);
    DIAL_ANGLE.set(r, 30);
    const twist = canvasHost<Doc>().twist!.node!(s.state, r)!;
    // The gesture starts from the host's reading, not the box's turn: the
    // commit lands an ABSOLUTE angle, so the two have to agree.
    expect(twist.startDeg).toBe(30);
    twist.preview(45);
    twist.preview(50);
    expect(twist.commit(s.state, 50)).not.toBeNull();
    // …and a twist that ends where it began commits nothing.
    expect(twist.commit(s.state, 30)).toBeNull();
    twist.reset();
    expect(drives).toEqual([
      `preview ${r} 45`, `preview ${r} 50`, `commit ${r} 50`, `commit ${r} 30`, `reset ${r}`,
    ]);
  });

  test('the four members close over the node: resolving it is what names the node', () => {
    installCanvasHost(HOST);
    let s = newSession();
    let a: string;
    let b: string;
    [s, a] = placeRect(s, 0, 0);
    [s, b] = placeRect(s, 20, 20);
    DIAL_ANGLE.set(a, 10);
    DIAL_ANGLE.set(b, 70);
    canvasHost<Doc>().twist!.node!(s.state, a)!.preview(1);
    canvasHost<Doc>().twist!.node!(s.state, b)!.preview(2);
    expect(drives).toEqual([`preview ${a} 1`, `preview ${b} 2`]);
  });
});

describe('resolveTwistUnit: what two fingers would turn', () => {
  beforeEach(() => {
    installCanvasHost(HOST);
    installSessionHost({ items: ITEMS });
  });

  test('a multi-selection is one unit, and its own box is the grip', () => {
    let s = newSession();
    let a: string;
    let b: string;
    [s, a] = placeRect(s, 0, 0);
    [s, b] = placeRect(s, 10, 10);
    const unit = resolveTwistUnit(s.state, sel(a, b), { moveOnly: false, pxPerCell: 20, hostDoc: s.hostDoc })!;
    expect(unit.ids).toEqual([a, b]);
    expect(unit.box).toEqual({ cellX: 0, cellY: 0, cellWidth: 14, cellHeight: 14 });
    // No grip growth for a multi: its box is already as wide as the things
    // in it, and growing it would open the twist on empty page beside the
    // selection.
    expect(unit.grip).toEqual(unit.box);
    expect(unit.angleDeg).toBe(0);
  });

  test('Move mode opens nothing — two fingers pinch the camera, whatever they landed on', () => {
    let s = newSession();
    let a: string;
    let b: string;
    [s, a] = placeRect(s, 0, 0);
    [s, b] = placeRect(s, 10, 10);
    expect(resolveTwistUnit(s.state, sel(a, b), { moveOnly: true, pxPerCell: 20, hostDoc: s.hostDoc })).toBeNull();
  });

  test('a lone SCENE node is not a unit: that case is the single-object twist’s', () => {
    let s = newSession();
    let a: string;
    [s, a] = placeRect(s, 0, 0);
    expect(resolveTwistUnit(s.state, sel(a), { moveOnly: false, pxPerCell: 20, hostDoc: s.hostDoc })).toBeNull();
  });

  test('a lone HOST item the host claims is a unit of one, with the grip grown and the box not', () => {
    const s = newSession(docWith(peg('peg_1', 10, 10)));
    const unit = resolveTwistUnit(s.state, sel('peg_1'), { moveOnly: false, pxPerCell: 20, hostDoc: s.hostDoc })!;
    expect(unit.ids).toEqual(['peg_1']);
    expect(unit.box).toEqual({ cellX: 9.5, cellY: 9.5, cellWidth: 1, cellHeight: 1 });
    // The pair needs room to land; the turn still pivots about the box.
    expect(unit.grip).toEqual({ cellX: 8.5, cellY: 8.5, cellWidth: 3, cellHeight: 3 });
  });

  test('the grip is read at the live zoom: the same peg needs more page when the page is small', () => {
    const s = newSession(docWith(peg('peg_1', 10, 10)));
    const far = resolveTwistUnit(s.state, sel('peg_1'), { moveOnly: false, pxPerCell: 5, hostDoc: s.hostDoc })!;
    expect(far.grip.cellWidth).toBe(9);
    expect(far.box.cellWidth).toBe(1);
  });

  test('a lone host item the host declines leaves the fingers to the camera', () => {
    const s = newSession(docWith(peg('peg_still', 10, 10, null)));
    expect(resolveTwistUnit(s.state, sel('peg_still'), { moveOnly: false, pxPerCell: 20, hostDoc: s.hostDoc })).toBeNull();
  });

  test('nothing selected is nothing to turn', () => {
    const s = newSession(docWith(peg('peg_1', 10, 10)));
    expect(resolveTwistUnit(s.state, sel(null), { moveOnly: false, pxPerCell: 20, hostDoc: s.hostDoc })).toBeNull();
  });

  test('a selection whose box will not resolve opens nothing', () => {
    const s = newSession(docWith(peg('peg_1', 10, 10)));
    expect(resolveTwistUnit(s.state, sel('peg_gone', 'peg_also_gone'), {
      moveOnly: false, pxPerCell: 20, hostDoc: s.hostDoc,
    })).toBeNull();
  });

  test('an app with no twist of its own gets the multi unit and no grip', () => {
    installCanvasHost(null);
    let s = newSession();
    let a: string;
    let b: string;
    [s, a] = placeRect(s, 0, 0);
    [s, b] = placeRect(s, 10, 10);
    const unit = resolveTwistUnit(s.state, sel(a, b), { moveOnly: false, pxPerCell: 20, hostDoc: s.hostDoc })!;
    expect(unit.grip).toEqual(unit.box);
    // …and its lone selection is the camera's, there being no host item.
    expect(resolveTwistUnit(s.state, sel(a), { moveOnly: false, pxPerCell: 20, hostDoc: s.hostDoc })).toBeNull();
  });
});

describe('the host’s own DOM per scene node', () => {
  // The three answers are what the hook's contract is, and `undefined`
  // against `null` is its crux: one means "draw your own layer", the other
  // "mine, and it draws nothing here".
  const LAYERS: CanvasLayers = {
    nodeLayer: (node) => {
      if (DIAL_ANGLE.has(node.id)) return 'dial' as unknown as never;
      if (node.id.startsWith('absorbed')) return null;
      return undefined;
    },
  };

  const input = (id: string) => ({
    id, kind: 'svg' as const, node: {} as never, drawn: {} as never,
    strokeScale: 1, zoom: 1, dpr: 2, isBusy: () => false,
  });

  test('undefined is “none of mine”, null is “mine, and it draws nothing”', () => {
    DIAL_ANGLE.set('dial_1', 0);
    expect(LAYERS.nodeLayer!(input('plain_1'))).toBeUndefined();
    expect(LAYERS.nodeLayer!(input('absorbed_1'))).toBeNull();
    expect(LAYERS.nodeLayer!(input('dial_1'))).toBe('dial');
  });

  test('“none of mine” is answered from the host’s own data, not from the node’s kind', () => {
    // Same id, same kind, two pages: the answer follows the host's record
    // and nothing else. A hook that read the kind would say "not mine" for
    // every svg on a page that holds a dial, and the dial would stop
    // drawing (§4.3).
    expect(LAYERS.nodeLayer!(input('dial_1'))).toBeUndefined();
    DIAL_ANGLE.set('dial_1', 0);
    expect(LAYERS.nodeLayer!(input('dial_1'))).toBe('dial');
  });
});

describe('the seam’s declarations', () => {
  const SRC = fs.readFileSync(
    path.join(__dirname, '..', 'components', 'canvasHooks.ts'), 'utf8',
  );

  // A types-only declaration cannot be run, and the package's components
  // are typechecked only in the apps (the engine has no renderer), so the
  // two WIDENINGS the owner called for are pinned as the source text they
  // are — each naming the simplification that would undo it.
  test('a claimed press ends for one of three reasons, not with a boolean', () => {
    expect(SRC).toContain("export type PointerEnd = 'release' | 'takeover' | 'cancel';");
    expect(SRC).toContain(
      'onPointerUp?: (x: number, y: number, end: PointerEnd, e: React.PointerEvent) => void;',
    );
    expect(SRC).not.toContain('cancelled: boolean');
  });

  test('a press is claimed with a claim, and the claim carries the selection it replaced', () => {
    expect(SRC).toContain(
      'onPointerDown?: (x: number, y: number, e: React.PointerEvent) => PointerClaim | null;',
    );
    expect(SRC).toContain('prevSelection?: PriorSelection;');
  });

  test('the surface always offers the pixel pick: the package keeps both hit tests', () => {
    expect(SRC).toContain('pixelHitAt(x: number, y: number): string | null;');
    expect(SRC).not.toContain('pixelHitAt?(');
  });

  // Every member of an interface adopted whole from a non-canonical copy
  // (§4.2 item 5's rule, which 5a learnt the hard way) is used here, so
  // deleting one fails this file's compile rather than passing silently.
  test('every member of the adopted interfaces is reachable', () => {
    const claim: PointerClaim = { prevSelection: { selectedId: 'a', selectedIds: ['a'] } };
    const ends: PointerEnd[] = ['release', 'takeover', 'cancel'];
    const prior: PriorSelection = { selectedId: null, selectedIds: [] };
    const seen: string[] = [];
    const hooks: GestureHooks = {
      onPointerDown: () => claim,
      onPointerMove: (x, y) => { seen.push(`move ${x},${y}`); },
      onPointerUp: (_x, _y, end) => { seen.push(`up ${end}`); },
      holdOpensMenu: () => true,
      previewSelectionEntry: (se) => { seen.push(`preview ${se === null ? 'none' : 'entry'}`); },
      beforePick: (x, y) => (x === y ? 'peg_1' : null),
    };
    const handle: CanvasSurfaceHandle = {
      getLiveCamera: () => makeBlankComposition('x').camera,
      getViewport: () => makeViewport(100, 100),
      pixelHitAt: () => null,
      layerSlot: null,
    };
    expect(hooks.onPointerDown!(1, 2, {} as never)).toBe(claim);
    hooks.onPointerMove!(3, 4, {} as never);
    for (const end of ends) hooks.onPointerUp!(0, 0, end, {} as never);
    expect(hooks.holdOpensMenu!()).toBe(true);
    hooks.previewSelectionEntry!(null);
    expect(seen).toEqual(['move 3,4', 'up release', 'up takeover', 'up cancel', 'preview none']);
    // Not a claim: an id to SELECT before the scene is asked, or null to
    // let the press fall through to it.
    expect(hooks.beforePick!(5, 5)).toBe('peg_1');
    expect(hooks.beforePick!(5, 6)).toBeNull();
    expect(handle.pixelHitAt(0, 0)).toBeNull();
    expect(handle.layerSlot).toBeNull();
    expect(handle.getLiveCamera().zoom).toBe(makeBlankComposition('x').camera.zoom);
    expect(handle.getViewport().width).toBe(100);
    expect(prior.selectedIds).toEqual([]);
  });
});
