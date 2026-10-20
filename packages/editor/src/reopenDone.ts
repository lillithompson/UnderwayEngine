/**
 * The ask a DONE page puts up when somebody tries to draw on it.
 *
 * Marking a day done is a statement about the page — it is what ships it
 * to friends (isShareable), what the Today card's check reads, and what
 * the band wears the game's colour for. A finished page that still took
 * strokes made that statement a lie quietly: the friend who already has
 * your page keeps the copy you marked, and the next mark ships a
 * different drawing under the same day.
 *
 * So a done page is READ-ONLY, and the way back is the ask below — which
 * does exactly what the info page's "Still Working… | I'm Done" capsule
 * does, because it IS that flip (EditorShell.onToggleDone). There is no
 * second notion of "open" to keep in step with the mark.
 *
 * The words live in a plain module, away from the .tsx, so the node test
 * harness can read them — the same split responseSend.ts makes.
 */

/** "Page", not "game": every page that can be reopened is one of the
 *  journal's — a day's, or a group's own — and a social turn, the one
 *  thing the app calls a game in here, has no reopen (UX §7.3). */
export const REOPEN_TITLE = 'Reopen this page?';

/** Why the stroke didn't land, and what saying yes actually does — two
 *  short sentences. It used to spell out that reopening IS the info
 *  page's "Still Working…" flip and that the mark can go back on
 *  whenever you like, which was three lines of small type over the
 *  drawing to say what the Reopen button already says. */
export const REOPEN_BODY =
  'You marked this page as done. Do you want to keep working on it?';

/** …and on a page friends already have, the one thing a reader will
 *  wonder about at this moment: reopening leaves their copy alone, and
 *  the changes reach them only when the page is done again (UX §7.3). */
export const REOPEN_SHARED_LINE =
  "Your friends will keep the version they have until you're done again.";

/** The ask's body for this page. `shared` is whether a copy of it is out
 *  with friends or a group — the same test the info page's "still
 *  shared" line makes. */
export function reopenAskBody(shared: boolean): string {
  return shared ? `${REOPEN_BODY} ${REOPEN_SHARED_LINE}` : REOPEN_BODY;
}

export const REOPEN_CONFIRM_LABEL = 'Reopen';
export const REOPEN_CANCEL_LABEL = 'Not now';
