// ── The editor's full-screen layer order ────────────────────────────
//
// The overlays that cover the whole editor, and the notice that must be
// readable over them, stack in ONE order named here — not as a literal
// per component. They were literals once, and the notice's 12 lost to the
// send modal's 600: a response whose send was refused un-pressed its
// button and said nothing, because the line saying why was painted
// underneath an opaque overlay (docs/response_spec.md §5.4.2).
//
// Anything below these (the toolbar at 10, the band at 11, the floating
// capsules at 200–205) is editor chrome, not a layer: it lives under every
// overlay by construction and keeps its own value.

// Every one of these was BYTE-IDENTICAL in all three apps — the six below
// that all three declare, and the two after them that CozyJournal and
// DrawBots share, which Sol now ships unused (stage 5a's arrangement for
// the canvas leaves). What an app adds of its own stays in its own
// `web/editor/overlayZ.ts` beside a re-export of these: DrawBots' size ask,
// its look-page Done and its ready-looks row (stage 6.5a of
// docs/shared-editor.md).

/** The picture a DONE page shows in place of its canvas
 *  (finishedPage.ts). The one "overlay" here that is not full-screen: it
 *  begins where the toolbar ends and runs to the bottom of the screen, so
 *  the chrome above it is untouched. Over the canvas and every capsule
 *  floating on it (200–205) — those are the UI a finished page is meant
 *  to be missing — and under the outline (400), the info page, and the
 *  reopen ask a tap on it raises. */
export const FINISHED_PAGE_Z = 300;

/** The info page — instructions, the prompt, Send on a response. */
export const INSTRUCTIONS_Z = 500;

/** The Response game's send modal, which covers the info page (the info
 *  page's own Send opens it). */
export const SEND_MODAL_Z = 600;

/** A comic turn's strip, opened big from the info page's own drawing of
 *  it (§7.4). Over the info page, which is what opens it; it never shares
 *  the screen with the send modal — a comic frame is handed off by the
 *  Done press, not by a response's Send. */
export const STRIP_ZOOM_Z = 620;

/** The one-line notice. ABOVE every overlay: it is the editor's only way
 *  to say a press was refused, and a press can be refused from inside one.
 *  It takes no pointer events, so sitting on top costs the overlay under
 *  it nothing. */
export const NOTICE_Z = 700;

/** The ask a done page raises when a finger tries to draw on it. Over the
 *  info page, since the capsule it stands in for lives there; under the
 *  notice, like everything else. It never shares the screen with the send
 *  modal — a response has no day to mark done. */
export const REOPEN_MODAL_Z = 650;

/** The card that asks a finished page what it is called (pageTitleAsk.ts).
 *  The same layer the reopen ask takes — they are the same card in the
 *  same place, and the two can never be up together: this one goes up on
 *  the press that marks the page done, and that one only ever on a page
 *  already done. Under the notice, like everything else. */
export const PAGE_TITLE_MODAL_Z = 650;

/** The ask the info page's Reset raises (resetPageAsk.ts) — over the info
 *  page, which is the only place it can be raised from, and under the
 *  notice like everything else. The same layer the reopen ask and the
 *  title card take: all three are one card in the middle of the screen,
 *  and no two of them can be up together — this one goes up on a press
 *  made INSIDE the info page, and the scrim under it takes every press
 *  that is not its own. */
export const RESET_MODAL_Z = 650;
