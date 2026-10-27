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

/**
 * One component's MOUNT in a shell: `<Name` on its own line, through the
 * `/>` that closes it. For pinning a prop on the component that actually
 * takes it, where the same prop name is passed to several
 * (docs/shared-editor.md §4.2 item 6: five of 6.5b.4's hand-over pins read
 * the whole shell and so could not fail).
 *
 * The NEWLINE on the start marker is the whole point and is not decoration.
 * `'<CanvasSurface'` matches `useRef<CanvasSurfaceHandle | null>` three
 * thousand lines earlier, and because both markers are then found,
 * `sliceBetween`'s two-ended guard does not fire — the slice silently
 * bounds the wrong region and every assertion on it passes for the wrong
 * reason. A tag opens a mount only at the end of a line.
 *
 * Mounts whose props hold nested JSX are not sliceable this way: the first
 * `/>` would close the nested element. Every mount this is used on is a
 * plain prop list, and a nested one would have to be bounded by hand.
 * (Nested ARROW FUNCTIONS are fine — only nested JSX carries a `/>`.)
 *
 * A component mounted TWICE throws rather than silently bounding the first
 * one, which is the same failure in a different coat: a pin meant for the
 * second mount would read the first and pass for the wrong reason.
 */
export function mountOf(src: string, name: string): string {
  const open = `<${name}\n`;
  const first = src.indexOf(open);
  if (first >= 0 && src.indexOf(open, first + open.length) >= 0) {
    throw new Error(`${name} is mounted more than once; use mountsOf for every mount`);
  }
  return sliceBetween(src, open, '/>');
}

/**
 * EVERY mount of one component, for the case `mountOf` refuses — a tag the
 * shell mounts more than once (`SymmetryModal`: the canvas button's and the
 * pattern bar's). Each region is bounded with both ends asserted, as
 * `mountOf`'s is.
 *
 * The plural is here because the alternative was a hand-rolled
 * `m.indexOf('/>')` per mount, whose END is not asserted: a mount that lost
 * its self-closing slash would leave the region running to the end of the
 * file and a positive assertion passing for the wrong reason. Telling a
 * caller to "bound a double mount by hand" was asking for exactly the thing
 * this module exists to stop.
 *
 * Throws when the component is not mounted at all — an empty list would
 * make every assertion over it vacuously true.
 */
export function mountsOf(src: string, name: string): string[] {
  const open = `<${name}\n`;
  const out: string[] = [];
  for (let at = src.indexOf(open); at >= 0; at = src.indexOf(open, at + open.length)) {
    out.push(sliceBetween(src.slice(at), open, '/>'));
  }
  // Not mounted at all: let `sliceBetween` raise its own "slice start not
  // found", rather than a second spelling of that sentence here which could
  // drift from the one the tests pin.
  if (!out.length) sliceBetween(src, open, '/>');
  return out;
}

/**
 * The module prefixes a shell shares with the engine and the package — what
 * the consolidation moves things BETWEEN, and so the scope the three shells
 * are held to by `deadNamedImports`.
 *
 * Here rather than three times over so that widening it is ONE edit. An
 * app's own trees (`@/web/*`, `@/components/*`) are deliberately out: dead
 * bindings of those exist in all three shells and are each app's debt
 * rather than this programme's (docs/shared-editor.md §4.3).
 */
export const SHARED_IMPORT_PREFIXES = [
  '@/editor', '@/editor-ui', '@/engine', '@/native-shell',
] as const;

/**
 * The NAMED bindings `src` imports from a module under one of `prefixes`
 * and never mentions again — dead imports, as `"NAME (module)"` strings.
 *
 * A sub-stage that takes a group of statements out of a shell leaves that
 * group's imports behind by default, and nothing in these projects sees
 * them: there is no eslint, the expo base config does not set
 * `noUnusedLocals`, and a typecheck is happy to resolve an import nobody
 * reads. 6.5b.6 left two (`PATTERN_TILE_FAMILIES` and
 * `togglePatternTileSet`) and the sweep that followed found 33 across the
 * three shells (docs/shared-editor.md §4.2 item 6, 6.5b.6).
 *
 * Here rather than in each app for `sliceBetween`'s reason: the derivation
 * has nothing of any app in it, and a copy per shell is three copies of one
 * guard. The SCOPE is here too — `SHARED_IMPORT_PREFIXES`, above — so that
 * widening it is one edit rather than one per app; a suite that wants a
 * different scope still passes its own list.
 *
 * TWO BLIND SPOTS, both worth knowing before trusting an empty result:
 *
 * - a binding imported TWICE from the same module, once plainly and once
 *   `as` an alias, is invisible: this blanks the statement it is reading
 *   and the other statement still mentions the name, so it can never read
 *   as dead. Sol's shell has one (`FLOATING_CAPSULE_HEIGHT`, also imported
 *   as `SOL_ROW_HEIGHT`), live today.
 * - it is TEXTUAL. A name mentioned only in a comment counts as used.
 *
 * A THIRD was reported as a blind spot and is fixed instead: a statement
 * that brings a default binding in beside the braces (`import Foo, { bar }
 * from …`) went unmatched, so none of its named bindings was examined — a
 * silent pass rather than a wrong answer, which is worse. The default
 * binding is optional in the pattern now and is not itself examined, since
 * this is about named bindings.
 *
 * `atLeast` is the floor on how many in-scope statements must be found, and
 * exists for the same reason the two-ended slice does: a pattern that
 * quietly stops matching returns an empty list, and an empty list from this
 * reads as "nothing dead". A caller that knows its shell has a hundred
 * should say so.
 *
 * And one trap that is NOT a blind spot, because it cost a false positive
 * that reached the tree: `...NAME` has a dot before the name, so a
 * lookbehind that rejects `.` to keep member accesses out makes every
 * SPREAD use invisible. `PATTERN_SYMMETRY_OFF` read as dead in all three
 * shells, where every use of it is `{ ...PATTERN_SYMMETRY_OFF }`, and the
 * typecheck is what caught it. `...` is blanked below, as `clusters.js` has
 * done since 6.5b.2.
 */
export function deadNamedImports(
  src: string, prefixes: readonly string[], opts: { atLeast?: number } = {},
): string[] {
  // A prefix is matched as a path segment boundary rather than as a regular
  // expression: `startsWith` plus the next character, so nothing in a
  // prefix needs escaping and there is no pattern to get wrong.
  const inScope = (mod: string) => prefixes.some(
    (p) => mod === p || mod.startsWith(`${p}/`),
  );
  const specs = [...src.matchAll(
    /import\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*'([^']*)'/g,
  )].filter(([, , mod]) => inScope(mod));
  const atLeast = Math.max(1, opts.atLeast ?? 1);
  if (specs.length < atLeast) {
    throw new Error(
      `${specs.length} imports from ${prefixes.join(', ')}, expected at least ${atLeast}`,
    );
  }

  const dead: string[] = [];
  for (const [stmt, names, mod] of specs) {
    // Hoisted out of the per-binding loop: a shell is ~300 KB and one of
    // these statements can carry a hundred bindings.
    const rest = src.split(stmt).join(' ').split('...').join(' ');
    for (const raw of names.split(',')) {
      // `type X`, `X as Y` — the binding is the last word either way.
      const name = raw.trim().split(/\s+/).pop();
      if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) continue;
      if (!new RegExp(`(?<![.\\w$])${name}(?![\\w$])`).test(rest)) dead.push(`${name} (${mod})`);
    }
  }
  return dead;
}
