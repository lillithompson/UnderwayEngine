import { declarationBody, mountOf, sliceBetween } from './sourceSlice';

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
});
