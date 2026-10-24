import type { CommonFormatIssue } from '../formats/editorConfig';

// The STORED ENTRY — the record an app files for a page, and the handful of
// questions every app asks of one.
//
// `JournalEntryBase` is the 18 fields all three apps' `JournalEntry`
// declared, and it is here because the owner settled how the shared store
// carries each app's own record (docs/shared-editor.md §4.3, asked at
// 6.2b's measurement): a BASE RECORD plus a generic. The package's store is
// `EntryStore<TEntry extends JournalEntryBase>`, so it reads and writes the
// fields below and hands back the app's own type.
//
// The three records NEST exactly, which is what makes one base serve them:
// Sol's 18 ⊂ DrawBots' 26 ⊂ CozyJournal's 27, the shape 6.3b found for
// `canvas`. Of the 18, 13 were byte-identical in all three and the other 5
// differed only in a doc comment naming that app's own home-list model —
// so the text here is CozyJournal's (§4.3), with the app-specific names
// generalised where one appeared.
//
// WHAT IS NOT HERE, deliberately. CozyJournal and DrawBots share 8 further
// fields (`unlisted`, `flat`, `pageId`, `syncedAt`, `baseEditedAt`,
// `templateBaseline`, `seededFills`, `title`), 23 of DrawBots' 26 being
// byte-identical to CozyJournal's. They stayed in those two apps because
// they are not one concept to name — half are about SHARING a page and half
// are the format layer's — and because putting them in the base would hand
// Sol eight fields it never writes, which is the opposite of what a base
// record is for. The two that belong to the format layer are stage 7's, with
// the property pages.

/** Where a page stands. One union in all three apps, byte-identical —
 *  except that DrawBots also spells it in `components/formatIds.ts`, which
 *  rides its native bundle and so may import nothing of this package
 *  ("Mirror modules", `DrawBots.md`); that copy is pinned to this one. */
export type EntryStatus = 'new' | 'in_progress' | 'done';

export interface JournalEntryBase {
  id: string;
  /** The format's id, as `string` here and re-narrowed to the app's own
   *  union by its `JournalEntry` — §4.3's `ToolId` decision, which 6.3b
   *  applied to the config's ids and 6.3c to the issue's. */
  formatId: string;
  /** 'YYYY-MM-DD' local date it was issued for. */
  issueDate: string;
  status: EntryStatus;
  /** Engine composition id; created on first open. */
  compositionId: string | null;
  /** Frozen copy of the day's prompt/content. */
  issue: CommonFormatIssue;
  /** Small cached PNG for home/library cards (~300 px). */
  thumbPng?: Uint8Array;
  /** Width/height of `thumbPng` — recorded only for formats whose export
   *  frames the drawn content itself rather than a fixed page (CozyJournal's
   *  and DrawBots' Free Play, every Sol canvas), where the artifact's aspect
   *  is per-entry and the home list cannot derive it from the format. Absent
   *  for page-framed formats: their aspect is the format's intrinsic one
   *  (each app's own home-list model — `FORMAT_INTRINSIC_ASPECT`). */
  thumbAspect?: number;
  /** How BRIGHT the top of `thumbPng` is — the mean perceived luminance
   *  (Rec. 601, over white) of the band a card draws its top line in, 0 to
   *  255. Measured at raster time, where the pixels exist
   *  (web/editor/thumbTopLuma.ts), because nothing downstream can see
   *  inside an encoded thumbnail: it rides the bridge, the sharing upload
   *  and the result row so any card can ink a label ON the picture in the
   *  one of two inks that reads over it (each app's `CardLabelStrip`
   *  overArtInk). Absent on a page whose thumb predates the measurement,
   *  and on one whose measurement failed — never stale, which is why
   *  setThumb clears it rather than leaving the last answer standing. */
  thumbTopLuma?: number;
  /** True when the page strokes white or near-white somewhere — the strokes
   *  the card thumb draws grey (web/editor/thumbWhiteStrokes). The view keeps
   *  them white, so the full-screen viewer stands that picture on a grey
   *  backing (theme.VIEWER_WHITE_STROKE_BACKING) rather than on the
   *  home list's white, where they would vanish. Written with the thumb, and
   *  cleared on a run that finds none. */
  whiteStrokes?: boolean;
  /** Set on pages created by importing a `.tile` file (each app's
   *  developer-mode Import — `web/editor/importEntryTile.ts`). An imported
   *  page is archive material: it shows in the home list, but it must never
   *  occupy a calendar slot, or the archive copy would shadow the page the
   *  user actually made on that date. Every lookup keyed on
   *  (formatId, issueDate) therefore guards with `isIssuedEntry`. */
  imported?: boolean;
  /** True when an imported file carried no date of its own: `issueDate` is
   *  then merely the day it was filed, and the home list shows the page in a
   *  trailing "No date" section rather than a week. Only meaningful
   *  alongside `imported`. */
  undated?: boolean;
  /**
   * When the page's drawn CONTENT was last written to storage — the editor's
   * save queue stamps it (entryStore.markPageSaved), and only for a write
   * that changed the picture: the camera, the grid and the swatch shelf ride
   * the same record and move none of it (edited.samePageContent).
   *
   * Half of the gate that keeps an unchanged page from being rasterized
   * again every time it is opened and closed — see {@link imagesAt}.
   */
  pageSavedAt?: number;
  /**
   * When the entry's FULL image set was last drawn from that page
   * (entryRaster.rasterizeEntryImages; a thumb-only background tick never
   * claims it). Taken BEFORE the exports run, so a save that lands while
   * they are drawing stamps later and still reads as work owed.
   *
   * With {@link pageSavedAt} and {@link imagesRecipe} this answers "are the
   * cached images the picture this page holds now?" — `imagesAt >=
   * pageSavedAt` means nothing has been written since they were drawn, so a
   * redraw would produce the same bytes and is skipped.
   */
  imagesAt?: number;
  /** Which ENTRY_IMAGE_RECIPE drew them (entryRaster). A page imaged by an
   *  older build carries an older number — or none — and is redrawn the
   *  next time its editor closes. (CozyJournal's seed reveal has a second
   *  recipe stamp of its own that works the same way.) */
  imagesRecipe?: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

/** Local midnight of an ISO day ('YYYY-MM-DD'), epoch ms. */
export function dayStartMs(iso: string): number {
  return new Date(`${iso}T00:00:00`).getTime();
}

/**
 * True for entries the app issued for a calendar day — everything except
 * imported `.tile` pages and `unlisted` one-off pages (an app that mints a
 * page per tap — CozyJournal's Reimagine → Random).
 *
 * This is the guard for any read keyed on (formatId, issueDate): both kinds
 * can land on a date that already has a real entry, and without this the
 * home rails, the calendar archive, lazy entry creation, and streaks would
 * all pick one of them up instead. Typed structurally so it accepts both
 * JournalEntry and the bridge's HomeStateEntry.
 */
export function isIssuedEntry(entry: { imported?: boolean; unlisted?: boolean }): boolean {
  return entry.imported !== true && entry.unlisted !== true;
}

/**
 * A page is inside a window of days when it was ISSUED inside it — or EDITED
 * inside it. Reopening an old page rewrites its images (the home list shows
 * the edit), so the images the edit made have to ship with it: the view for
 * the full-screen viewer, and in CozyJournal a seed reveal beside it (the
 * slider it drives is only ever laid over the view). Cutting on the issue
 * date alone left a freshly re-edited old page with its thumb only — and no
 * slider. The Friends uploader reads the same rule, so a page from the
 * archive reworked and marked done goes up like today's — and the `.tile`
 * source rides the same rule, so the account's other devices can edit it.
 * Bounded still: an edit is a deliberate act, and a journal's worth of old
 * pages doesn't get edited in a month. Typed structurally so it accepts both
 * JournalEntry and the bridge's HomeStateEntry (whose stamp is optional —
 * a page cached before the stamp rode the bridge goes by its day alone).
 */
export function inImageWindow(e: { issueDate: string; updatedAt?: number }, cutoffIso: string): boolean {
  return e.issueDate >= cutoffIso || (e.updatedAt ?? 0) >= dayStartMs(cutoffIso);
}

/**
 * Whether the entry's stored images are BEHIND the page they were drawn
 * from: the page's content has been written since the last full image run
 * ({@link JournalEntry.imagesAt} vs {@link JournalEntry.pageSavedAt}).
 *
 * This is the state a KILLED editor session leaves. The editor's debounced
 * tick draws the card thumb alone, and a hard kill can cut a transition's
 * full run short after the thumb and before the view — so the thumb is at
 * most one pause behind while the view and an app's other sidecars are the
 * edit BEFORE this one, with nothing saying so. A CozyJournal page edited
 * and then killed had a correct card over a full-screen view showing the
 * page as it stood two edits ago.
 *
 * Two readers, which is why it lives here rather than in either of them:
 * the redraw gate (entryRaster.entryImagesCurrent) treats it as work owed,
 * and the home-state push (homeState.buildHomeStateDelta) withholds the
 * images a full run owns while it holds, so every viewer falls back to the
 * thumb — the one picture that IS the page — instead of showing a stale one.
 *
 * `pageSavedAt` absent means the page has never been written through the
 * editor's save queue, so there is nothing to be behind: a page imaged by a
 * producer that writes its pictures directly (a salvaged comic frame, a
 * filed collage) carries neither stamp and is never withheld.
 */
export function entryImagesBehindPage(e: { pageSavedAt?: number; imagesAt?: number }): boolean {
  return e.pageSavedAt !== undefined && (e.imagesAt ?? 0) < e.pageSavedAt;
}
