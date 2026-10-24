// What the package may ask about an app's OWN format ids.
//
// A format id is each app's closed union and its meaning is each app's too
// (`'freePlay'` is CozyJournal's and DrawBots', `'sol'` is Sol's), so a
// package module can never answer a question about one by reading it. What it
// can do is ask: the app installs the SET and the question is asked here, so
// the three apps hold one implementation of "is this a multi-file format?"
// over three different answers to "which ones are".
//
// That is the `registerStoreNamespace` shape of 6.2a — data installed at
// module scope, from the app's own `web/formats/types.ts` — and the predicate
// below was byte-identical in all three apps while each set was its own
// (docs/shared-editor.md §4.2 item 6, stage 6.3d). Stage 6.2b's
// `isAlwaysDoneFormat` is the same shape over the same tree and joins this
// file when `entryStore.ts` moves.
//
// Unlike the store's namespace this one does NOT throw when nothing is
// installed: an app that installs no set has no multi-file formats, which is
// a real answer and the one a package suite wants by default. The asymmetry
// 6.2a weighed does not arise — a wrong namespace writes a page where nothing
// will look for it again, while a wrong answer here files a page the user can
// still see and open.

let multiFile: ReadonlySet<string> = new Set();

/** Install the app's multi-file format ids (its `web/formats/types.ts` does,
 *  at module scope). */
export function registerMultiFileFormats(ids: ReadonlySet<string>): void {
  multiFile = ids;
}

/**
 * True for a format that makes FILES rather than dated issues — one whose
 * every open mints a new page, so several of its entries can share an
 * issueDate and a date no longer names one page.
 *
 * Read by {@link entryCloseAction}: a page of such a format that was never
 * marked was minted by the open that is now ending, so it is discarded rather
 * than filed.
 */
export function isMultiFileFormat(formatId: string): boolean {
  return multiFile.has(formatId);
}
