import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { makeBlankComposition } from '../blankComposition';
import { buildPlaceShape, commitEntry, createEditorSession } from '../editorSession';
import { framingTarget, useImageEdits } from '../useImageEdits';
import { useBarColorState } from '../useBarColorState';
import { useColorAcrossBars } from '../useColorAcrossBars';
import { useColorScope } from '../useColorScope';
import { useEffectBars } from '../useEffectBars';
import { useEyedropper } from '../useEyedropper';
import { useFillBar } from '../useFillBar';
import { usePatternExcludedFamilies } from '../usePatternExcludedFamilies';
import { usePhotoSource } from '../usePhotoSource';
import { useShapeToolModes } from '../useShapeToolModes';
import { useStrokeBar } from '../useStrokeBar';

// The thirteen hooks 6.5b.2 and 6.5b.3 took out of the three EditorShell
// bodies (docs/shared-editor.md §4.2 item 6) — 117 statements of state and
// handlers that were byte-identical in all three apps.
//
// WHAT THIS SUITE CAN AND CANNOT DO, stated plainly because the gap is real.
// There is no renderer in this repo's jest (`testEnvironment: 'node'`, no
// jsdom) and none in any of the three apps either, which is why 6.6b wrote
// `hostRoute.ts` as pure functions under thin hooks and drove the functions.
// These are state plumbing — `useState`, `useRef`, `useCallback` — with
// no such core to drive, so their BEHAVIOUR is not pinned here. The safety
// argument for the move is therefore not this suite: it is that the text is
// byte-identical to what all three shipped apps were already running, and that
// all three typecheck against it. A renderer would turn that argument into a
// test, and is the right thing for whatever sub-stage next moves a hook. 6.5b.3
// is 640 lines against 6.5b.2's 465, so the gap is wider now, not narrower.
//
// What IS pinned is what can be: that the modules load — which is what puts
// them under a typecheck in this repo at all, the root tsconfig excluding
// `packages/editor` — that none of them reaches into an app, that none of them
// drags the chrome's index in, the one DECISION among 6.5b.2's eight that was
// worth lifting out of a handler, and 6.5b.3's central claim: that the four
// bar hooks take nothing the shell had to invent.

const ALL = [
  // 6.5b.2
  'useColorBlendMode', 'useColorScope', 'useEyedropper', 'useImageEdits',
  'usePatternExcludedFamilies', 'usePhotoSource', 'useRadialMenus',
  'useShapeToolModes',
  // 6.5b.3 — the colour state, then the bars behind the commit pipeline
  'useBarColorState', 'useEffectBars', 'useStrokeBar', 'useFillBar',
  'useColorAcrossBars',
];

// Eleven of the thirteen. `useColorBlendMode` and `useRadialMenus` are left
// out DELIBERATELY: a `.tsx` cannot be loaded in this harness — the
// react-native shim carries no Animated or StyleSheet, and the jsx setting
// makes a component's own `import React` read as unused — and those two reach
// a component file (`BlendBadgeIcons.tsx` for the badge glyph,
// `CanvasRadialMenu.tsx` for the menu's ref type). Importing either explodes
// the suite, which is the trap 6.5b.1 paid for with `PUSHDOWN_HEIGHT`. The
// three apps typecheck both; here they are read as source text, as any other
// `.tsx`-touching module in this package is.
//
// All five of 6.5b.3's load. Three of them want the chrome's effect and tint
// MODELS, which is exactly the import 6.5b.2 had to re-point: named as
// `@/editor-ui/adapter` they are plain types and nothing is dragged in.
const LOADABLE = {
  useColorScope, useEyedropper, useImageEdits,
  usePatternExcludedFamilies, usePhotoSource, useShapeToolModes,
  useBarColorState, useEffectBars, useStrokeBar, useFillBar,
  useColorAcrossBars,
};

const srcOf = (name: string) => readFileSync(join(__dirname, '..', `${name}.ts`), 'utf8');

// The same source with comments blanked, for the assertions that are about
// what the CODE names. `usePhotoSource`'s own header explains why the app's
// sentinel is a parameter, and names the three namespaces to do it.
const codeOf = (name: string) => srcOf(name)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/.*/g, ' ');

// Which siblings a module imports that are COMPONENT files on disk. Spelling
// is not the test — `./components/toolbarMeta` is a `.ts` — so the extension
// is looked up rather than guessed.
const reachesTsx = (name: string) => [...codeOf(name).matchAll(/from '(\.\/[^']+)'/g)]
  .some((m) => existsSync(join(__dirname, '..', `${m[1].slice(2)}.tsx`)));

describe('the loadable modules are hooks named for themselves', () => {
  it.each(Object.entries(LOADABLE))('%s', (name, fn) => {
    expect(typeof fn).toBe('function');
    expect(fn.name).toBe(name);
  });

  it('leaves out exactly the ones that reach a .tsx', () => {
    // Derived, not asserted by hand: if either of the two ever stops importing
    // a component file it belongs in LOADABLE, and this fails until it is.
    // Both sides are sorted — ALL is grouped by sub-stage now, not
    // alphabetical, so the filter's own order is no longer the sorted one.
    const reaching = ALL.filter(reachesTsx);
    expect(reaching.sort()).toEqual(['useColorBlendMode', 'useRadialMenus']);
    expect(Object.keys(LOADABLE).sort())
      .toEqual(ALL.filter((n) => !reaching.includes(n)).sort());
  });
});

describe('not one of the thirteen reaches into an app', () => {
  // The invariant that makes `packages/editor` a package rather than a fourth
  // copy, and the one thing about these files that no typecheck guards: the
  // apps resolve `@/web/*`, `@/components/*` and `@figgie` and the package
  // does not, so an import of one would typecheck in all three apps and leave
  // the package broken for anyone else. Read as TEXT, the way 6.1's
  // `loadPackFonts` suite pins its own freedom from expo.
  it.each(ALL)('%s.ts imports only the engine, the shell, the chrome and siblings', (name) => {
    const specs = [...srcOf(name).matchAll(/from\s*'([^']+)'/g)].map((m) => m[1]);
    expect(specs.length).toBeGreaterThan(0);
    const foreign = specs.filter((s) => !(
      /^@\/(?:engine|native-shell|editor|editor-ui)(?:\/|$)/.test(s)
      || /^\.\.?\//.test(s)
      || /^[a-z]/.test(s)            // a node_modules package: react, …
      || /^@[a-z][\w-]*\//.test(s)   // a scoped node_modules package
    ));
    expect(foreign).toEqual([]);
  });

  it.each(ALL)('%s.ts names no app by its store namespace either', (name) => {
    // `usePhotoSource` takes the app's sentinel imageId as a PARAMETER
    // precisely so that none of these three words appears in the package.
    for (const word of ['cozy:', 'sol:', 'drawbots:']) {
      expect(codeOf(name)).not.toContain(word);
    }
  });

  it.each(ALL)('%s.ts names the chrome module it wants, never the index', (name) => {
    // `from '@/editor-ui'` is the whole chrome, every `.tsx` of it, dragged
    // into the graph of anything that loads the file — which is how two of
    // these first failed to load here. The deep module is always
    // available: `SwatchRainbow` and `FramingModel` are `adapter.ts`,
    // `patternExcludedTileFamilies` is `logic/patternEdit.ts`.
    expect(codeOf(name)).not.toMatch(/from '@\/editor-ui'/);
  });
});

describe('6.5b.3: the bar hooks invent nothing', () => {
  // The claim the cut rests on, and the one §4.3 twice declined to take on
  // trust. The 59-statement colour component does NOT place as one hook — it
  // reads `applyEntry` (the shell's commit pipeline, ~200 statements in) and
  // is read back ~75 statements earlier — so it is cut at the pipeline:
  // `useBarColorState` in front, the four bars behind. The cut is only worth
  // having if the bars' parameter lists are things the shell ALREADY had,
  // rather than the fifty-member context object the plan refused to invent.
  //
  // So: every parameter of every bar hook must be one of the four allowed
  // inputs or a name `useBarColorState` returns. Derived from the source text
  // both ways round — nothing here is a list typed out by hand, so a
  // parameter added later has to come from one of those two places or this
  // fails.
  const ALLOWED_INPUTS = ['applyEntry', 'session', 'sessionRef', 'setSession'];
  const BARS = ['useEffectBars', 'useStrokeBar', 'useFillBar', 'useColorAcrossBars'];

  // The destructured parameter object of `export function useX(...)`: the
  // braces between the signature's `(` and its `: {` type annotation.
  const paramsOf = (name: string) => {
    const m = /export function \w+(?:<[^>]*>)?\(\{([\s\S]*?)\}: \{/.exec(srcOf(name));
    if (!m) throw new Error(`${name}: no destructured parameter object`);
    return m[1].split(/[,\s]+/).filter((w) => /^[A-Za-z_$][\w$]*$/.test(w));
  };
  // The names a hook hands back, from its single trailing `return { … };`.
  const returnsOf = (name: string) => {
    const m = /\n {2}return \{([\s\S]*?)\n {2}\};\n\}/.exec(srcOf(name));
    if (!m) throw new Error(`${name}: no multi-line return`);
    return m[1].split(/[,\s]+/).filter((w) => /^[A-Za-z_$][\w$]*$/.test(w));
  };

  it('useBarColorState is in FRONT of the commit pipeline', () => {
    // It must not take `applyEntry`, `setSession` or `sessionRef`: taking any
    // of them would put it behind the pipeline, and then neither half places
    // and the whole cut is pointless. What it does take is the session (for
    // `vectorEraserArmed`), the app's store and the format's opening style.
    const params = paramsOf('useBarColorState');
    expect(params.sort()).toEqual(['config', 'session', 'updateSettings']);
    expect(returnsOf('useBarColorState').length).toBeGreaterThan(25);
  });

  it.each(BARS)('%s takes only allowed inputs and useBarColorState names', (bar) => {
    const available = new Set([...ALLOWED_INPUTS, ...returnsOf('useBarColorState')]);
    const invented = paramsOf(bar).filter((p) => !available.has(p));
    expect(invented).toEqual([]);
  });

  it('and every one of them is actually used by a bar', () => {
    // The mirror: a name `useBarColorState` returns that NO bar and no app
    // wants would be a return invented for its own sake. This cannot see the
    // apps, so it asserts the weaker, checkable half — that the bars between
    // them do reach for most of it — rather than pretending to the stronger.
    const returned = new Set(returnsOf('useBarColorState'));
    const wanted = new Set(BARS.flatMap(paramsOf).filter((p) => returned.has(p)));
    expect(wanted.size).toBeGreaterThan(returned.size / 2);
  });

  it('the four bars are behind the pipeline, and all four take it', () => {
    for (const bar of BARS) {
      const params = paramsOf(bar);
      expect(params).toContain('applyEntry');
    }
  });
});

describe("framingTarget — the one decision among 6.5b.2's eight", () => {
  // The resolution a framing edit writes through. Pulled out of `onFraming`
  // and pinned here because routing an edit through the raw `selectedId`
  // stranded the commit silently: the live preview had already been rolled
  // back, so releasing the Zoom slider read as the value jumping back.
  const INK = { r: 0, g: 0, b: 0 };
  const twoShapes = () => {
    let session = createEditorSession(makeBlankComposition('c1'));
    const a = buildPlaceShape('rect', { cellX: 0, cellY: 0, cellWidth: 2, cellHeight: 2 }, INK);
    session = commitEntry(session, a);
    const b = buildPlaceShape('rect', { cellX: 4, cellY: 0, cellWidth: 2, cellHeight: 2 }, INK);
    session = commitEntry(session, b);
    return { state: session.state, idA: a.id!, idB: b.id! };
  };

  it('is null when nothing is selected', () => {
    const { state } = twoShapes();
    expect(framingTarget({ state, selectedId: null, selectedIds: [] })).toBeNull();
  });

  it('resolves the SINGLE selection when there is one', () => {
    const { state, idA } = twoShapes();
    expect(framingTarget({ state, selectedId: idA, selectedIds: [] })?.item.id).toBe(idA);
  });

  it("resolves a multi-selection's FIRST member when there is no single one", () => {
    const { state, idA, idB } = twoShapes();
    expect(framingTarget({ state, selectedId: null, selectedIds: [idB, idA] })?.item.id).toBe(idB);
  });

  it('prefers the single selection OVER the multi list, never the other way', () => {
    // Both can be set while the bar is up; the bar DISPLAYS the single one,
    // so the edit must write to the single one.
    const { state, idA, idB } = twoShapes();
    expect(framingTarget({ state, selectedId: idA, selectedIds: [idB] })?.item.id).toBe(idA);
  });

  it('is null when the selection names something that is gone', () => {
    // Mid-dismiss, or the selection moved between preview and release. The
    // caller still has to consume the drag's snapshot, which is the branch
    // this null drives.
    const { state } = twoShapes();
    expect(framingTarget({ state, selectedId: 'no-such-node', selectedIds: [] })).toBeNull();
    expect(framingTarget({ state, selectedId: null, selectedIds: ['no-such-node'] })).toBeNull();
  });

  it('is what useImageEdits itself calls — there is no second resolution', () => {
    // The bug was two resolutions, one for what the bar SHOWS and one for what
    // it WRITES. A `findItem` left loose in this module would be a third.
    const src = srcOf('useImageEdits');
    expect(src).toContain('framingTarget(s)');
    expect(src.match(/findItem\(/g)).toHaveLength(2);   // both inside framingTarget
    expect(typeof useImageEdits).toBe('function');
  });
});
