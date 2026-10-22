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
      // …unless the gesture is re-drawing it, which needs its own element.
      if (node.id.startsWith('absorbed') && !node.liveIds.has(node.id)) return null;
      return undefined;
    },
  };

  const input = (id: string, live: readonly string[] = []) => ({
    id, kind: 'svg' as const, node: {} as never, drawn: {} as never,
    strokeScale: 1, zoom: 1, dpr: 2, isBusy: () => false,
    liveIds: new Set(live), hiddenGroups: new Set<string>(),
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

  test('a node the gesture is RE-DRAWING is lifted back out of the one element', () => {
    // `liveIds` is what this render previews through React rather than
    // with an element transform — an off-square stretch, a live resize —
    // and a node drawn as part of someone else's element has no element
    // of its own for that re-draw to land on, so the host must give it one
    // back for the length of the gesture.
    expect(LAYERS.nodeLayer!(input('absorbed_1'))).toBeNull();
    expect(LAYERS.nodeLayer!(input('absorbed_1', ['absorbed_1']))).toBeUndefined();
  });

  // The gesture side of that `null` (`previewStandIn`, the sixth widening,
  // stage 5b.4). A node whose layer draws nothing has no element of its
  // own, so a live preview written on it writes on nothing: the host says
  // which of ITS elements stands in, and many nodes share one.
  describe('what previews a node the host draws nothing for', () => {
    const PRESSED: { nodeId: string; world: Mat2D }[] = [];
    const layers: CanvasLayers = {
      previewStandIn: (nodeId) => (nodeId.startsWith('absorbed') ? {
        // Every leaf of one plant answers that plant's key.
        key: `plant_${nodeId.slice('absorbed_'.length, -1)}`,
        el: () => ({ style: {} }) as unknown as HTMLElement,
        css: (id, world) => {
          PRESSED.push({ nodeId: id, world });
          // A null answer leaves the element where it stands.
          return world.a === 0 ? null : world;
        },
      } : undefined),
    };

    test('a node with an element of its own has no stand-in', () => {
      expect(layers.previewStandIn!('plain_1')).toBeUndefined();
    });

    test('nodes sharing a key share one element, and the host maps the pose', () => {
      const a = layers.previewStandIn!('absorbed_7a')!;
      const b = layers.previewStandIn!('absorbed_7b')!;
      expect(a.key).toBe(b.key);
      const world: Mat2D = { a: 2, b: 0, c: 0, d: 2, e: 1, f: 1 };
      expect(a.css('absorbed_7a', world)).toBe(world);
      expect(PRESSED.map((w) => w.nodeId)).toEqual(['absorbed_7a']);
      // …and null is "leave it", which is how a stand-in with nothing to
      // show keeps the committed render.
      expect(a.css('absorbed_7a', { a: 0, b: 0, c: 0, d: 1, e: 0, f: 0 })).toBeNull();
    });
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
    expect(SRC).toContain('onPointerUp?: (x: number, y: number, end: PointerEnd) => void;');
    expect(SRC).not.toContain('cancelled: boolean');
  });

  test('a press is claimed with a claim, and the claim carries the selection it replaced', () => {
    expect(SRC).toContain(
      'onPointerDown?: (x: number, y: number, e: React.PointerEvent) => PointerClaim | null;',
    );
    expect(SRC).toContain('prevSelection?: PriorSelection;');
  });

  test('a claim is offered at one of two points in the press router, DrawBot’s by default', () => {
    // The third widening: CozyJournal's rig joints are a grab inside the
    // select tool, after the selection's own grabs — offered the press
    // first they would swallow a brush stroke and the figure's own corner
    // handles — while DrawBot's bots must beat the running simulation's
    // lock, so nothing may precede them.
    expect(SRC).toContain("claimAt?: 'press' | 'grab';");
  });

  test('a selection preview comes with its ids and as a thunk, not as a built entry', () => {
    // The FIFTH widening (stage 5b.4). DrawBot's took a built
    // `SessionEntry | null` and gated in front of the call — "do any of
    // these ids name a bot, or does a bot ride a group among them?" — a
    // question only the host can answer and which the surface would have
    // to build an entry to ask. Collapsing this back to one argument
    // means every multi gesture over shapes alone pays a reducer pass per
    // pointer move for a layer with nothing to draw.
    expect(SRC).toContain('ids: readonly string[], entry: (() => SessionEntry | null) | null,');
    expect(SRC).not.toContain('previewSelectionEntry?: (se: SessionEntry | null) => void;');
  });

  test('a node the host draws nothing for still has something to preview', () => {
    // The SIXTH widening (stage 5b.4c), and a hole in the adopted seam
    // rather than an addition to it: `nodeLayer` could already answer
    // `null` — "mine, and it draws nothing here" — and nothing said what a
    // live gesture then writes its preview transform on. It wrote it on
    // nothing, and Sol's plant sat still under the finger while every
    // shape beside it moved. Deleting this takes that bug back.
    expect(SRC).toContain('previewStandIn?(nodeId: string): HostPreviewStandIn | undefined;');
    expect(SRC).toContain('export interface HostPreviewStandIn {');
    // One element for many nodes is the point of it, so the key is what
    // the surface dedupes on and `css` is the host's own mapping.
    expect(SRC).toContain('readonly key: string;');
    expect(SRC).toContain('css(nodeId: string, world: Mat2D): Mat2D | null;');
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
      claimAt: 'grab',
      onPointerDown: () => claim,
      onPointerMove: (x, y) => { seen.push(`move ${x},${y}`); },
      onPointerUp: (_x, _y, end) => { seen.push(`up ${end}`); },
      holdOpensMenu: () => true,
      previewSelectionEntry: (ids, entry) => {
        // The gate is the HOST's: it reads the ids and only then builds.
        if (entry === null) { seen.push('preview none'); return; }
        if (!ids.some((id) => id.startsWith('peg_'))) { seen.push('preview skipped'); return; }
        seen.push(`preview ${entry() === null ? 'nothing' : 'entry'}`);
      },
      beforePick: (x, y) => (x === y ? 'peg_1' : null),
    };
    const handle: CanvasSurfaceHandle = {
      getLiveCamera: () => makeBlankComposition('x').camera,
      getViewport: () => makeViewport(100, 100),
      pixelHitAt: () => null,
      layerSlot: null,
    };
    expect(hooks.claimAt).toBe('grab');
    expect(hooks.onPointerDown!(1, 2, {} as never)).toBe(claim);
    hooks.onPointerMove!(3, 4, {} as never);
    // No event on the end: the surface has none for a stale-pointer heal
    // or a page backgrounded mid-touch, and must still be able to end a
    // claim.
    for (const end of ends) hooks.onPointerUp!(0, 0, end);
    expect(hooks.holdOpensMenu!()).toBe(true);
    // The ids and a THUNK, not a built entry: a gesture over nothing of the
    // host's never costs it a reducer pass (the fifth widening, §4.3).
    let built = 0;
    hooks.previewSelectionEntry!(['sq_1'], () => { built += 1; return { entry: [] }; });
    expect(built).toBe(0);
    hooks.previewSelectionEntry!(['peg_1'], () => { built += 1; return { entry: [] }; });
    expect(built).toBe(1);
    hooks.previewSelectionEntry!(['peg_1'], null);
    expect(seen).toEqual([
      'move 3,4', 'up release', 'up takeover', 'up cancel',
      'preview skipped', 'preview entry', 'preview none',
    ]);
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

// What the SURFACE does with the seam. DrawBot is the only app that fills
// `beforePick` or `previewSelectionEntry`, so nothing in CozyJournal's or
// Sol's tree fails when a call site goes — which is §4.3's rule for a
// generic addition adopted from a non-canonical copy, and the declaration
// surviving is not the call surviving (5a's `children` lesson).
describe('the surface’s wiring of the seam', () => {
  const SRC = fs.readFileSync(
    path.join(__dirname, '..', 'components', 'CanvasSurface.tsx'), 'utf8',
  );

  test('asks beforePick once per press, before the tool branches', () => {
    expect(SRC).toContain(
      "pressFrontPickRef.current = propsRef.current.gestures?.beforePick?.(pt.x, pt.y) ?? null;",
    );
    // …and forgets the last press's answer first, so a press that returns
    // early from one of the gates above cannot leave a stale pick that a
    // later tool branch reads as its own.
    expect(SRC).toContain('pressFrontPickRef.current = null;');
  });

  test('four things read that pick, and each is a press a host item takes', () => {
    // The selection's one-finger grab and the selected node's own grab
    // both yield to a thing drawn in front of them (frontItemTakesPress /
    // selectionOwnsPress's frontId); the select tool picks it instead of
    // the scene behind it; shift-click toggles it into the selection.
    expect(SRC).toContain('if (frontItemTakesPress(pressFrontPickRef.current, ids)) return false;');
    expect(SRC).toContain('frontId: pressFrontPickRef.current,');
    expect(SRC).toContain('const frontPick = pressFrontPickRef.current;');
    expect(SRC).toContain('const front = pressFrontPickRef.current;');
  });

  test('a settled tap asks the host fresh rather than reading the press’s pick', () => {
    // A tap settles from branches the press router's set never ran through
    // — a marquee below the slop, a tile stamp that never stamped.
    const at = SRC.indexOf('const settleTap = ');
    expect(at).toBeGreaterThan(0);
    const head = SRC.slice(at, at + 1200);
    expect(head).toContain('propsRef.current.gestures?.beforePick?.(pt.x, pt.y) ?? null');
    expect(head).toContain('propsRef.current.onSelect(picked);');
  });

  test('every multi gesture offers its proposed entry, and the teardown ends it', () => {
    // Three gestures in flight — the drag, the twist, the corner resize —
    // plus the teardown that clears the preview. Fewer than four and a
    // host layer draws its things in the wrong place for one of them, or
    // leaves them there after the finger lifts. Counted over the code
    // alone: a comment naming the hook would otherwise count as a call.
    const code = SRC
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ 	]*\/\/.*$/gm, '');
    expect(code.match(/previewSelectionEntry\(/g)).toHaveLength(4);
    expect(SRC).toContain('previewSelectionEntry(ids, null);');
    expect(SRC).toContain('previewSelectionEntry(g.ids, () => twisted);');
    expect(SRC).toContain('previewSelectionEntry(g.ids, () => resized);');
    expect(SRC).toContain('previewSelectionEntry(g.ids, () => buildMoveNodes(');
    // The hand-over is the hook itself, unguarded: whether there is
    // anything to draw is the host's question, asked behind the call.
    expect(SRC).toContain('propsRef.current.gestures?.previewSelectionEntry?.(ids, entry);');
  });
});

// The surface's HALF of the claim lifecycle: declaring the props, offering
// the press at the right moment, routing a claimed pointer, ending it for
// each of the three reasons, and mounting the slot a layer draws in. These
// came over from DrawBot at stage 5b.4, where they pinned that app's own
// copy of the canvas; the hooks they are about are filled by DrawBot alone,
// so nothing in another app's tree can fail when one stops working.
describe('the surface’s half of the claim', () => {
  const SRC = fs.readFileSync(
    path.join(__dirname, '..', 'components', 'CanvasSurface.tsx'), 'utf8',
  );

  test('declares the props the seam rides on', () => {
    for (const prop of [
      'inputLocked?: boolean;',
      'gestures?: GestureHooks;',
      'layers?: CanvasLayers;',
      'surfaceHandle?: React.MutableRefObject<CanvasSurfaceHandle | null>;',
    ]) expect(SRC).toContain(prop);
    // …and the two the GESTURE handlers read go through the props ref,
    // which is the only way a handler created once sees a live prop. A
    // seam prop declared but left out of it reads as absent at every call
    // site, silently: `layers` was, and a host's composite went back to
    // standing still under the finger.
    const refs = SRC.match(/propsRef\.current = \{ ([^}]*)\}/);
    expect(refs).not.toBeNull();
    for (const name of ['inputLocked', 'onCanvasPointerDown', 'gestures', 'layers']) {
      expect(refs![1].split(', ')).toContain(name);
    }
  });

  test('a claim is offered only to a ONE-finger press, after the two-finger check', () => {
    // Two fingers are the camera's, whatever they landed on: a claim
    // offered before `beginTwoPointerGesture` would take the pinch.
    const two = SRC.indexOf('if (beginTwoPointerGesture()) return;');
    const single = SRC.indexOf('if (pointersRef.current.size !== 1) return;', two);
    const claim = SRC.indexOf("if (offerClaim('press', pt, e)) return;", single);
    expect(two).toBeGreaterThan(0);
    expect(single).toBeGreaterThan(two);
    expect(claim).toBeGreaterThan(single);
  });

  test('the middle-button pan has one definition and one call, ahead of everything', () => {
    // It is the desktop's camera and nothing else: a middle drag with a
    // host's tool armed, under an input lock, on a done page, in a live
    // text or with no tool at all still moves the view (DrawBot's bug
    // f1079398, where it fell to the simulation's lock).
    const down = SRC.indexOf('const onPointerDown = (e: React.PointerEvent) => {');
    const middle = SRC.indexOf('if (e.button === 1) {\n      beginMiddlePan(e, pt);\n      return;\n    }', down);
    expect(middle).toBeGreaterThan(down);
    for (const later of [
      "if (offerClaim('press', pt, e)) return;",
      'if (propsRef.current.inputLocked) {',
      'if (propsRef.current.onEditWhileDone) {',
      'if (seekCaretAt(e, pt)) {',
      'if (!propsRef.current.session.activeTool) {',
    ]) expect(SRC.indexOf(later, down)).toBeGreaterThan(middle);
    const begin = SRC.indexOf('const beginMiddlePan = (e: React.PointerEvent, pt: { x: number; y: number }) => {');
    expect(begin).toBeGreaterThan(0);
    expect(SRC.slice(begin, SRC.indexOf('\n  };\n', begin)))
      .toContain("mode: 'pan', startCamera: liveCameraRef.current,");
    expect(SRC.split('beginMiddlePan(e, pt);')).toHaveLength(2);
  });

  test('a hold on a claim, and on a front pick, opens the radial menu', () => {
    // Without it a host's own thing would be the one object on the page
    // whose quick actions a hold could never reach — and the hold CANCELS
    // the claim, so nothing the press was doing survives into the menu.
    expect(SRC).toContain('if (hooks.holdOpensMenu?.()) {');
    expect(SRC).toContain("hooks.onPointerUp?.(pt.x, pt.y, 'cancel');");
    expect(SRC).toContain('if (isHostId(frontPick)) armLongPress(pt);');
  });

  test('a claimed pointer’s moves and all three endings go to the hooks', () => {
    expect(SRC).toContain('propsRef.current.gestures?.onPointerMove?.(pt.x, pt.y, e);');
    // A release or a cancel, from the pointer's own end…
    expect(SRC).toContain(
      "propsRef.current.gestures?.onPointerUp?.(pt.x, pt.y, cancelled ? 'cancel' : 'release');",
    );
    // …and a TAKEOVER when a second finger arrives, which only the host
    // knows how to settle.
    expect(SRC).toContain("propsRef.current.gestures?.onPointerUp?.(at.x, at.y, 'takeover');");
  });

  test('mounts a pointer-inert layer slot and fills the handle from it', () => {
    expect(SRC).toContain('ref={layerSlotRef}');
    expect(SRC).toContain("style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}");
    expect(SRC).toContain('getLiveCamera: () => liveCameraRef.current,');
    expect(SRC).toContain('pixelHitAt: (x, y) => pixelHitTestAt({ x, y })?.id ?? null,');
    expect(SRC).toContain('layerSlot: layerSlotRef.current,');
  });
});

// The surface's HALF of the layer seam and the two per-render inputs Sol's
// adoption brought (stage 5b.4c). Sol is the only app that fills any of
// these, so nothing in CozyJournal's or DrawBot's tree can fail when one
// stops working — §4.3's rule again, and the reason the DECLARATION and
// the WRITE are separate cases.
describe('the surface’s half of the layers seam', () => {
  const SRC = fs.readFileSync(
    path.join(__dirname, '..', 'components', 'CanvasSurface.tsx'), 'utf8',
  );

  test('asks the host whether one of its elements stands in for a node', () => {
    expect(SRC).toContain(
      'const standInFor = (id: string) => propsRef.current.layers?.previewStandIn?.(id);',
    );
    // Resolved once per gesture, on the ids array's own identity: a plant
    // at its cap would otherwise cost two thousand lookups per frame,
    // which is the whole thing a composite exists to avoid.
    expect(SRC).toContain('if (hit && hit.ids === ids) return hit;');
    expect(SRC).toContain('if (seen.has(standIn.key)) continue;');
  });

  test('writes the stand-in once per move, and the node’s own element never', () => {
    // The driving member is the FIRST of the key's nodes in the gesture's
    // own list, and the host maps its previewed world matrix.
    const at = SRC.indexOf('const applyGesturePreview = ');
    expect(at).toBeGreaterThan(0);
    const body = SRC.slice(at, SRC.indexOf('\n  };\n', at));
    expect(body).toContain('for (const id of targets.own) {');
    expect(body).toContain('for (const { standIn, driverId } of targets.standIns) {');
    expect(body).toContain('const css = pose ? standIn.css(driverId, pose.world) : null;');
    // …and such a node does not go through React either: the stand-in
    // takes whatever the map says, off-square included.
    expect(body).toContain(
      'if (!matIsSimilarity(pose.css) && !standInFor(id)) (posed ??= new Map()).set(id, pose.world);',
    );
  });

  test('both teardowns put the stand-in back, as they do an own element', () => {
    // A preview written by hand has to be undone by hand, whichever
    // element took it: React's reconciler skips DOM writes for props
    // unchanged since the last render.
    expect(SRC).toContain('const el = standInFor(id)?.el() ?? nodeEl(id);');
    const at = SRC.indexOf('const resetMultiDragEls = ');
    const body = SRC.slice(at, SRC.indexOf('\n  };\n', at));
    expect(body).toContain('for (const { standIn } of targets.standIns) {');
  });

  test('ONE glide, asked with a box, and the box becomes a camera here', () => {
    // Two copies of "tween the camera and commit on arrival" is what this
    // replaces, and one prop where there were two: a host asks with a
    // BOX, never a camera, because the fit and the chrome insets are the
    // canvas's knowledge — a host computing its own camera frames without
    // them, which is a framed thing landing under the toolbar.
    expect(SRC).toContain('const glideCameraTo = (target: Camera, durationMs: number) => {');
    expect(SRC).toContain('revealRect?: { bbox: CellBbox; key: string; durationMs?: number } | null;');
    expect(SRC).not.toContain('cameraGlide?:');
    expect(SRC).toContain('glideCameraTo(computeFrameCellBboxCamera(');
    expect(SRC).toContain('{ top: avoidTopPx ?? 0, bottom: avoidBottomPx ?? 0 },');
    // The ask's own duration, the shared default when it names none.
    expect(SRC).toContain('), revealRect.durationMs ?? REVEAL_GLIDE_MS);');
    expect(SRC).toContain('const REVEAL_GLIDE_MS = 520;');
    // The ASK is the key: the same one must not fly again on an unrelated
    // render…
    expect(SRC).toContain("const revealKey = revealRect?.key ?? '';");
    expect(SRC).toContain('}, [revealKey, applyLiveCamera]);');
    // …and a finger already down wins outright, where a finger landing
    // during a glide cancels it and commits the camera where it stands.
    expect(SRC).toContain(
      "if (gestureRef.current.mode !== 'idle' || pointersRef.current.size > 0) return;",
    );
  });

  test('a finger on the canvas reaches the host before anything is read about it', () => {
    const at = SRC.indexOf('const onPointerDown = (e: React.PointerEvent) => {');
    const told = SRC.indexOf('propsRef.current.onCanvasPointerDown?.();', at);
    expect(told).toBeGreaterThan(at);
    // Before the layout read, the tween cancel, the capture and the
    // pointer bookkeeping: whatever the host ends needs the frame it asks
    // for to see the finger.
    for (const later of [
      'const r = el.getBoundingClientRect();',
      'cancelCameraTween(true);',
      'el.setPointerCapture(e.pointerId);',
      'if (beginTwoPointerGesture()) return;',
    ]) expect(SRC.indexOf(later, at)).toBeGreaterThan(told);
  });
});
