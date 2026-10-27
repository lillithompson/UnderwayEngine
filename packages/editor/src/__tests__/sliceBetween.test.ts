import { readFileSync } from 'fs';
import { join } from 'path';
import {
  deadNamedImports, declarationBody, mountOf, mountsOf, sliceBetween,
} from './sourceSlice';

// `sliceBetween` is the one piece of LOGIC the shell's source-pinning brought
// with it (6.5b.3, docs/shared-editor.md §4.2 item 6), and its whole purpose
// is to REFUSE something — so the refusal is what has to be pinned. It was
// not, in the first cut: the helper landed in three apps with its throw path
// tested nowhere, which is the same shape of gap as a negative assertion that
// stops matching.
//
// Everything here drives the helper over a fixture rather than over a real
// shell, so it cannot go stale when the shells move — which is the failure it
// exists to catch in the first place.

const SRC = [
  '  const alpha = useCallback(() => {',
  '    beta();',
  '  }, []);',
  '',
  '  const gamma = useCallback(() => {',
  '    delta();',
  '  }, []);',
  '',
  '  return {',
  '    alpha, gamma,',
  '  };',
  '}',
].join('\n');

describe('sliceBetween bounds a region and refuses when it cannot', () => {
  it('returns the text from the start marker up to the end marker', () => {
    const s = sliceBetween(SRC, 'const alpha', 'const gamma');
    expect(s).toContain('beta();');
    expect(s).not.toContain('delta();');
  });

  it('seeks the end AFTER the start ends, so a repeated marker cannot fold it', () => {
    // `useCallback(` is in the start marker AND later in the file. Sought
    // from index 0 the end would land inside the start and the slice would
    // be empty; sought from after the start it lands on the second one.
    const s = sliceBetween(SRC, 'const alpha = useCallback(', 'useCallback(');
    expect(s.length).toBeGreaterThan(0);
    expect(s).toContain('beta();');
  });

  it('takes the NEAREST of several end markers', () => {
    const near = sliceBetween(SRC, 'const alpha', ['const gamma', 'return {']);
    const far = sliceBetween(SRC, 'const alpha', ['return {']);
    expect(near).not.toContain('delta();');
    expect(far).toContain('delta();');
    expect(near.length).toBeLessThan(far.length);
  });

  it('ignores an end marker that is absent when another is present', () => {
    const s = sliceBetween(SRC, 'const alpha', ['no such marker', 'const gamma']);
    expect(s).toContain('beta();');
    expect(s).not.toContain('delta();');
  });

  it('THROWS when the start marker is gone', () => {
    // The case that matters: a declaration the pin names has been renamed or
    // has moved to another file. Silence here is how a slice comes back empty
    // and its assertions pass for the wrong reason.
    expect(() => sliceBetween(SRC, 'const epsilon', 'const gamma'))
      .toThrow(/slice start not found/);
  });

  it('THROWS when no end marker follows the start', () => {
    expect(() => sliceBetween(SRC, 'const gamma', 'const alpha'))
      .toThrow(/slice end not found after the start/);
    expect(() => sliceBetween(SRC, 'const alpha', ['nope', 'also nope']))
      .toThrow(/slice end not found after the start/);
  });
});

describe('declarationBody', () => {
  it('ends on the next declaration when there is one', () => {
    const b = declarationBody(SRC, 'alpha');
    expect(b).toContain('beta();');
    expect(b).not.toContain('delta();');
  });

  it("ends on the hook's return for the LAST declaration", () => {
    // What a package module needs and a shell never did: in the shell every
    // moved handler had another `const` after it, so an unguarded "next
    // declaration" end worked by luck. `onAddStroke` is the last thing in
    // `useStrokeBar`, and only the `return {` ends it.
    const b = declarationBody(SRC, 'gamma');
    expect(b).toContain('delta();');
    expect(b).not.toContain('alpha, gamma,');
  });

  it('throws for a name the source does not declare', () => {
    expect(() => declarationBody(SRC, 'epsilon')).toThrow(/slice start not found/);
  });
});

describe('mountOf', () => {
  // The bug this exists to stop, found by round 1 of 6.5b.4's review: a tag
  // name without the newline matches a TYPE ARGUMENT thousands of lines
  // earlier (`useRef<CanvasSurfaceHandle | null>`), and because both markers
  // are then found, sliceBetween's two-ended guard never fires — the slice
  // silently bounds the wrong region and every assertion on it passes.
  const SHELL = [
    '  const surfaceHandleRef = useRef<CanvasSurfaceHandle | null>(null);',
    '  const other = 1;',
    '  return (',
    '    <div>',
    '      <CanvasSurface',
    '        colorBrushOpacity={colorBrushOpacity}',
    '      />',
    '      <BrushControlsGroup',
    '        colorBrushOpacity={colorBrushOpacity}',
    '        brushChromeUp={brushChromeUp}',
    '      />',
    '    </div>',
    '  );',
  ].join('\n');

  it('bounds the mount, not a type argument with the same name', () => {
    const mount = mountOf(SHELL, 'CanvasSurface');
    expect(mount).toContain('colorBrushOpacity={colorBrushOpacity}');
    expect(mount).not.toContain('useRef<CanvasSurfaceHandle');
    expect(mount).not.toContain('brushChromeUp');
  });

  it('is what tells two mounts of the same prop apart', () => {
    expect(mountOf(SHELL, 'BrushControlsGroup')).toContain('brushChromeUp={brushChromeUp}');
    expect(mountOf(SHELL, 'CanvasSurface')).not.toContain('brushChromeUp={brushChromeUp}');
    // …which the unsliced source cannot do: both mounts take the prop.
    expect(SHELL.match(/colorBrushOpacity=\{colorBrushOpacity\}/g)).toHaveLength(2);
  });

  it('throws for a component the source does not mount', () => {
    expect(() => mountOf(SHELL, 'NotThere')).toThrow(/slice start not found/);
  });

  it('throws rather than bounding the FIRST of two mounts', () => {
    // The same failure in a different coat: a pin meant for the second
    // mount would read the first and pass for the wrong reason.
    const twice = [SHELL, '      <CanvasSurface', '        other={1}', '      />'].join('\n');
    expect(() => mountOf(twice, 'CanvasSurface')).toThrow(/mounted more than once/);
    expect(mountOf(twice, 'BrushControlsGroup')).toContain('brushChromeUp');
  });
});

describe('mountsOf', () => {
  const TWICE = [
    '      <SymmetryModal',
    '        bottomInset={insets.bottom}',
    '      />',
    '      <Other a={1} />',
    '      <SymmetryModal',
    '        bottomInset={insets.bottom}',
    '        fromBar',
    '      />',
  ].join('\n');

  it('returns every mount, each bounded by its own close', () => {
    const mounts = mountsOf(TWICE, 'SymmetryModal');
    expect(mounts).toHaveLength(2);
    for (const m of mounts) expect(m).toContain('bottomInset={insets.bottom}');
    // Each is bounded: the second mount's own prop is not in the first.
    expect(mounts[0]).not.toContain('fromBar');
    expect(mounts[1]).toContain('fromBar');
    // …and neither runs past its close into the sibling between them.
    expect(mounts[0]).not.toContain('<Other');
  });

  it('throws when the component is not mounted, rather than returning nothing', () => {
    // An empty list would make every assertion over it vacuously true,
    // which is the failure this module exists to stop.
    expect(() => mountsOf(TWICE, 'NotThere')).toThrow(/slice start not found/);
  });

  it('is what mountOf points a caller at for a double mount', () => {
    expect(() => mountOf(TWICE, 'SymmetryModal')).toThrow(/use mountsOf/);
  });
});

describe('deadNamedImports', () => {
  // The fixture carries one of each shape, plus the two traps that cost a
  // false positive and a blind spot in the sweep this helper came out of.
  const SRC = [
    "import { alive, deadOne } from '@/engine/types';",
    "import { spreadOnly } from '@/engine/flags';",
    "import { FLOATING_CAPSULE_HEIGHT } from '@/editor/components/capsule';",
    "import { FLOATING_CAPSULE_HEIGHT as ROW_HEIGHT } from '@/editor/components/capsule';",
    "import { ownName } from '@/web/store/entryStore';",
    "import { type OnlyAType } from '@/engine/types';",
    '',
    'export function Shell() {',
    '  const a = alive();',
    '  const b = { ...spreadOnly };',
    '  const c = ROW_HEIGHT;',
    '  return [a, b, c];',
    '}',
  ].join('\n');

  const PREFIXES = ['@/editor', '@/editor-ui', '@/engine', '@/native-shell'];

  it('finds a binding nothing else mentions', () => {
    expect(deadNamedImports(SRC, PREFIXES)).toContain('deadOne (@/engine/types)');
  });

  it('counts a SPREAD as a use', () => {
    // `...NAME` has a dot before the name, so a lookbehind that rejects `.`
    // makes every spread use invisible. That is not hypothetical: it called
    // `PATTERN_SYMMETRY_OFF` dead in all three shells, where every use of
    // it is `{ ...PATTERN_SYMMETRY_OFF }`, and only the typecheck caught it.
    expect(deadNamedImports(SRC, PREFIXES).join(' ')).not.toContain('spreadOnly');
  });

  it('counts a type-only import that nothing names as dead', () => {
    expect(deadNamedImports(SRC, PREFIXES)).toContain('OnlyAType (@/engine/types)');
  });

  it('is scoped to the prefixes it is given', () => {
    // `ownName` is dead too, and deliberately out of scope: the app's own
    // modules are not this helper's business unless it is asked for them.
    expect(deadNamedImports(SRC, PREFIXES).join(' ')).not.toContain('ownName');
    expect(deadNamedImports(SRC, ['@/web'])).toEqual(['ownName (@/web/store/entryStore)']);
  });

  it('cannot see an aliased duplicate, and says so in its own doc', () => {
    // The blind spot: `FLOATING_CAPSULE_HEIGHT` is imported plainly AND as
    // an alias from the same module, so blanking one statement leaves the
    // name in the other and the plain one can never read as dead. Pinned so
    // that the day it is fixed, this fails and the doc gets corrected with
    // it.
    expect(deadNamedImports(SRC, PREFIXES).join(' ')).not.toContain('FLOATING_CAPSULE_HEIGHT');
    expect(readFileSync(join(__dirname, 'sourceSlice.ts'), 'utf8'))
      .toContain('is invisible: this blanks the statement it is reading');
  });

  it('examines the named bindings of a default-plus-named import', () => {
    // Reported as a third blind spot and fixed rather than documented: the
    // statement went unmatched, so NONE of its named bindings was examined
    // — a silent pass, which is worse than a wrong answer.
    const src = [
      "import Default, { alsoDead } from '@/engine/types';",
      "import { kept } from '@/engine/other';",
      'export const use = kept;',
    ].join('\n');
    expect(deadNamedImports(src, PREFIXES)).toEqual(['alsoDead (@/engine/types)']);
  });

  it('refuses fewer in-scope statements than the caller says there are', () => {
    // The floor the app suites pass: a pattern that quietly stops matching
    // returns an empty list, and an empty list from this reads as "nothing
    // dead". Same reasoning as the two-ended slice.
    expect(() => deadNamedImports(SRC, PREFIXES, { atLeast: 50 }))
      .toThrow('expected at least 50');
    expect(deadNamedImports(SRC, PREFIXES, { atLeast: 2 })).toContain('deadOne (@/engine/types)');
  });

  it('refuses a source that imports nothing from those prefixes', () => {
    // An empty result must mean "nothing dead", never "nothing looked at" —
    // the same reasoning as sliceBetween's two-ended guard.
    expect(() => deadNamedImports("import { x } from './local';", PREFIXES))
      .toThrow('0 imports from @/editor, @/editor-ui, @/engine, @/native-shell');
  });
});
