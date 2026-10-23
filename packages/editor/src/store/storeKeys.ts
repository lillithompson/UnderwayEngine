/**
 * The app's key NAMESPACE — the first segment of every key its store writes.
 *
 * Every Underway app keys its stored pages the same way and under its own
 * word: `cozy:entry:<id>`, `sol:entry:<id>`, `drawbots:entry:<id>`, and the
 * same for the thumb, the view, the index, the settings, the home state and
 * the janitor's stamp. The SHAPE is the package's; the word is the app's,
 * and it is the one piece of this tree that can never be unified — it is the
 * namespace every page an installed app has ever saved lives under, so a
 * package that hardcoded one spelling would orphan every stored page on two
 * of the three apps (docs/shared-editor.md §4.2 item 6, "Still open").
 *
 * That is also why {@link storeNamespace} THROWS when nothing is installed
 * rather than falling back the way `fontFamily`'s probe does. A wrong family
 * shows the system face for a moment; a wrong namespace writes a page where
 * nothing will look for it again. An app installs at module scope, before
 * any key can be built, so the throw is a boot-time failure or nothing.
 */

let namespace: string | null = null;

/** Install the app's namespace (its `web/store/` does, at module scope). */
export function registerStoreNamespace(ns: string | null): void {
  if (ns !== null && !/^[a-z][a-z0-9]*$/.test(ns)) {
    // A namespace with a colon in it would silently re-shape every key it
    // builds — `a:b:entry:x` reads as namespace `a` to anything scanning.
    throw new Error(`registerStoreNamespace: '${ns}' is not a bare lowercase word`);
  }
  namespace = ns;
}

/** The installed namespace. Throws if an app has not installed one. */
export function storeNamespace(): string {
  if (namespace === null) {
    throw new Error(
      'storeNamespace: no app namespace installed. An app installs one at '
      + 'module scope from its web/store (registerStoreNamespace), and a test '
      + 'that reaches the store has to install one too.',
    );
  }
  return namespace;
}

/**
 * A key under the app's namespace: `storeKey('entry', id)` → `cozy:entry:x`.
 *
 * Called with no trailing id it builds the PREFIX a scan uses, with the
 * trailing colon kept — `storeKey('entry', '')` → `cozy:entry:` — because
 * that is what the index scans match on, and a prefix missing its colon
 * would match `cozy:entryDraft:` too.
 */
export function storeKey(...parts: string[]): string {
  return [storeNamespace(), ...parts].join(':');
}
