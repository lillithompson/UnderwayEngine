import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { makeBlankComposition } from '../blankComposition';
import { buildPlaceShape, commitEntry, createEditorSession } from '../editorSession';
import { framingTarget, useImageEdits } from '../useImageEdits';
import { useColorScope } from '../useColorScope';
import { useEyedropper } from '../useEyedropper';
import { usePatternExcludedFamilies } from '../usePatternExcludedFamilies';
import { usePhotoSource } from '../usePhotoSource';
import { useShapeToolModes } from '../useShapeToolModes';

// The eight hooks 6.5b.2 took out of the three EditorShell bodies
// (docs/shared-editor.md §4.2 item 6) — 56 statements of state and handlers
// that were byte-identical in all three apps.
//
// WHAT THIS SUITE CAN AND CANNOT DO, stated plainly because the gap is real.
// There is no renderer in this repo's jest (`testEnvironment: 'node'`, no
// jsdom) and none in any of the three apps either, which is why 6.6b wrote
// `hostRoute.ts` as pure functions under thin hooks and drove the functions.
// These eight are state plumbing — `useState`, `useRef`, `useCallback` — with
// no such core to drive, so their BEHAVIOUR is not pinned here. The safety
// argument for the move is therefore not this suite: it is that the text is
// byte-identical to what all three shipped apps were already running, and that
// all three typecheck against it. A renderer would turn that argument into a
// test, and is the right thing for whatever sub-stage next moves a hook.
//
// What IS pinned is what can be: that the modules load — which is what puts
// them under a typecheck in this repo at all, the root tsconfig excluding
// `packages/editor` — that none of them reaches into an app, that none of them
// drags the chrome's index in, and the one DECISION among the eight that was
// worth lifting out of a handler.

const ALL = [
  'useColorBlendMode', 'useColorScope', 'useEyedropper', 'useImageEdits',
  'usePatternExcludedFamilies', 'usePhotoSource', 'useRadialMenus',
  'useShapeToolModes',
];

// Six of the eight. `useColorBlendMode` and `useRadialMenus` are left out
// DELIBERATELY: a `.tsx` cannot be loaded in this harness — the react-native
// shim carries no Animated or StyleSheet, and the jsx setting makes a
// component's own `import React` read as unused — and those two reach a
// component file (`BlendBadgeIcons.tsx` for the badge glyph,
// `CanvasRadialMenu.tsx` for the menu's ref type). Importing either explodes
// the suite, which is the trap 6.5b.1 paid for with `PUSHDOWN_HEIGHT`. The
// three apps typecheck both; here they are read as source text, as any other
// `.tsx`-touching module in this package is.
const LOADABLE = {
  useColorScope, useEyedropper, useImageEdits,
  usePatternExcludedFamilies, usePhotoSource, useShapeToolModes,
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

describe('the six loadable modules are hooks named for themselves', () => {
  it.each(Object.entries(LOADABLE))('%s', (name, fn) => {
    expect(typeof fn).toBe('function');
    expect(fn.name).toBe(name);
  });

  it('is six of the eight, and the two left out are the ones that reach a .tsx', () => {
    // Derived, not asserted by hand: if either of the two ever stops importing
    // a component file it belongs in LOADABLE, and this fails until it is.
    const reaching = ALL.filter(reachesTsx);
    expect(reaching.sort()).toEqual(['useColorBlendMode', 'useRadialMenus']);
    expect(Object.keys(LOADABLE).sort())
      .toEqual(ALL.filter((n) => !reaching.includes(n)));
  });
});

describe('not one of the eight reaches into an app', () => {
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
    // these eight first failed to load here. The deep module is always
    // available: `SwatchRainbow` and `FramingModel` are `adapter.ts`,
    // `patternExcludedTileFamilies` is `logic/patternEdit.ts`.
    expect(codeOf(name)).not.toMatch(/from '@\/editor-ui'/);
  });
});

describe('framingTarget — the one decision among the eight', () => {
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
