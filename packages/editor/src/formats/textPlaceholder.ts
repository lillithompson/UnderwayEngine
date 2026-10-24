import { INK_HINT } from '@/editor-ui/appTheme';

// What a freshly placed text SAYS until it is edited, the size it is placed
// at and the colour it wears while it still says it. The three were
// byte-identical in CozyJournal's and DrawBots' copies, and Sol had the
// first two (stage 6.4a of docs/shared-editor.md — it waited for 6.4a
// because the hint colour reads the app chrome's `INK_HINT`, which had no
// home outside the apps until that sub-stage gave it one).

/** What a freshly placed text says until it is edited — the editor's
 *  own seed (EditorShell onAddText), and what a rule reading "did they
 *  write anything" compares against (CozyJournal's Storytime). One home,
 *  importable without the shell. */
export const TEXT_PLACEHOLDER = 'Tap to edit';

/** …and the SIZE it is placed at — the editor's own for a freshly placed
 *  text (EditorShell onAddText). Here beside the placeholder because a
 *  turn's word may be placed for the player without the shell's help
 *  (CozyJournal's storytimeWords.seedTurnWord), and the two placements must
 *  agree: a word seeded at one size and hand-placed at another would set the
 *  same story in two. */
export const TEXT_PLACEHOLDER_SIZE = 2;

/** …and the COLOUR it wears while it still says it. A placeholder is a
 *  prompt, not ink: the app chrome's hint grey (`@/editor-ui/appTheme`
 *  INK_HINT), so a word nobody has written yet reads as an invitation
 *  rather than as part of the story. Kept as a hex string, the form every
 *  colour helper here parses (activeColor.ts, colorUtils.parseHexColor).
 *
 *  It is temporary by design — the text takes the page's active ink the
 *  moment the player writes over it (EditorShell onEditText, committed by
 *  commitTextEdit), so nothing grey is ever committed as content. Only a
 *  text PLACED in it is a hint: CozyJournal's Storytime seeds its turn
 *  word that way, and Sol ships this constant unused. */
export const TEXT_HINT_COLOR = INK_HINT;
