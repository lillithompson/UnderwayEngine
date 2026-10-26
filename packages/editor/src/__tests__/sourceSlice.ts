// Facts about a screen's structure are pinned by reading its source text —
// there is no renderer in this repo's jest, nor in any of the three apps —
// and a pin that reads a REGION of a file needs two markers to bound it.
//
// These live here rather than in any one of them, for FakeEl's reason
// (docs/shared-editor.md §4.2 item 5): all three apps and this package slice
// the same shells and the same package modules, and 6.5b.3 first put a copy
// in each app's own `web/editor/__tests__/test-utils.ts` — which is three
// copies of a helper with nothing of any app in it. They re-export from here.

/**
 * The text of `src` between two markers, with BOTH ends asserted.
 *
 * A slice marker is not an assertion: `indexOf` returns -1 when it stops
 * matching, the slice then runs to the end of the file or comes back empty,
 * and every `toContain` on it passes or fails for the wrong reason. That is
 * how 6.5b.2 shipped suites whose slices bounded nothing once `onFraming`
 * moved into the package, and how 6.5b.3 found a dozen more
 * (docs/shared-editor.md §4.2 item 6). Both ends throw instead.
 *
 * `to` is sought AFTER the start ends, so a marker that appears on both
 * sides of the region cannot fold the slice to nothing. Several ends may be
 * given, in which case the NEAREST one wins — which is what a "to the next
 * declaration" slice needs when the region can also be ended by the
 * enclosing function's `return`.
 */
export function sliceBetween(
  src: string, from: string, to: string | readonly string[],
): string {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(`slice start not found: ${JSON.stringify(from)}`);
  const after = a + from.length;
  const ends = (typeof to === 'string' ? [to] : to)
    .map((t) => src.indexOf(t, after))
    .filter((i) => i >= 0);
  if (!ends.length) {
    throw new Error(`slice end not found after the start: ${JSON.stringify(to)}`);
  }
  return src.slice(a, Math.min(...ends));
}

/**
 * The body of `const <name> = useCallback(…)` in `src`, up to whichever
 * comes first: the next declaration at the same indent, or the enclosing
 * hook's `return` — which is what ends the LAST declaration in a package
 * module, where the shell always had another `const` after it.
 */
export function declarationBody(src: string, name: string): string {
  return sliceBetween(src, `const ${name} = useCallback(`, ['\n  const ', '\n  return {']);
}
