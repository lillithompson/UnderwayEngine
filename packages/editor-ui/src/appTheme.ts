import { perceivedLuma } from '@/engine/perceivedLuma';

// The APP CHROME's palette — the ground under a screen, the inks, the fonts,
// the spacing, the radii, the gradients, the CTA and the floating nav — as
// against the EDITOR chrome's, which is `theme.ts` beside this file.
//
// It is here because it was ONE palette written out three times. Of the 69
// declarations all three Underway apps' `components/theme.ts` held, 60 were
// byte-identical and the other nine differ only in a doc comment naming that
// app's own screens: not one value disagreed (docs/shared-editor.md §4.2
// item 6, stage 6.4a). Each app keeps its `components/theme.ts` and
// re-exports this, with the things that genuinely are its own beside it —
// its per-format card tints, its brand gradient's stops, Sol's pen palette
// and strain colours, each app's social mark.
//
// It lives in editor-ui rather than in `packages/editor` for the reason
// `theme.ts` does: both sides of an app read it. The WebView's editor reads
// the inks (a text placeholder's hint grey), and the native navigation shell
// reads the lot — so it has to be importable from a bundle that holds no
// WebView code, which is what editor-ui already is.
//
// The comments here are CozyJournal's (§4.3) with the app-specific screen
// names generalised. Where one app's reading of a value is the interesting
// one it is attributed rather than removed.
//
// Two helpers that were PRIVATE in each app are exported here — `clamp01`
// and `hexToRgb` — because each app's own tint code builds on them. The
// split is what made them part of the shared surface; they were already
// shared, just not sayable.

// Non-scrolling background: a very short, quiet vertical travel. It sits
// behind the whole scroll view. Warm at the top easing COOL at the bottom —
// about 3% of lightness across the whole scroll, three stops close enough
// together that the screen isn't flat without ever reading as a journey. (The
// travel carries no direction the row fills would have to agree with, and it
// is nearly white so the muted dailies have something to be colours against.)
export const BG_GRADIENT_COLORS = ['#F8F7F3', '#ffffff', '#ffffff'] as const;

export const BG_GRADIENT_LOCATIONS = [0, 0.52, 1] as const;

// …and the ground under a CARD FEED — the Notebook's weeks and a shared
// page's days. The same warm opening stop, easing cool and a little darker
// instead of opening out to white.
//
// Two grounds rather than one because the two kinds of page are built the
// other way up. Today is mostly PAGE with a few coloured cards standing on
// it, so the page going white lets those colours be the whole of the
// screen's colour. A feed is mostly CARD — white tiles edge to edge, the
// whole way down — and on a white page those tiles have nothing to be
// tiles against: the off-white rule round them (tint.cardBorder) is the
// only thing left saying where one stops, which is not a job for a
// hairline. Three points of lightness under them is enough, and it is the
// ramp both feeds were wearing before Today's went white.
//
// Locations are shared (BG_GRADIENT_LOCATIONS): what differs is the
// colour, not where the travel happens.
export const FEED_GRADIENT_COLORS = ['#F8F7F3', '#F3F4F4', '#EDF0F5'] as const;

// Flat ground for non-home tabs (Journal/Library/Settings) — the page
// gradient's own neutral, held still.
export const BG_APP = '#f3f3f4';

// Opaque panel surface (Now panel, cards on flat screens). Plain white: at
// 26–40% saturation the dailies lean on the surface behind them to read as
// colours at all, more than the old chalky fills did.
export const BG_CARD = '#FFFFFF';

/** The Notebook's artwork backing, and the ground the viewer stands a page
 *  on. It has been three colours — the editor's capsule grey (#D9D9D9),
 *  which read as a dark slab behind every card; a very light grey
 *  (#F0F0EE); and now ArtImage's shared white (ART_BG), which the rest of
 *  the app's artwork already stood on. Here rather than in EntryViewer
 *  because the Notebook and the viewer both read it. It is no longer what
 *  Reimagine's seed reveal is washed with: that wash is white in its own
 *  right (web/formats/seedReveal.SEED_REVEAL_BACKDROP_COLOR), because it is
 *  BAKED into a stored picture and a ground that moves afterwards would
 *  leave every old reveal carrying the ground of the month it was drawn. */
export const NOTEBOOK_ART_BG = '#ffffff';

/** The grey the full-screen viewer opens onto for a page drawn in white
 *  and nothing else (JournalEntry.whiteStrokes). The card thumb draws
 *  those strokes grey (web/editor/thumbWhiteStrokes) but the view keeps
 *  them white, and a transparent view opened onto NOTEBOOK_ART_BG is white
 *  on white — so the whole viewer takes this ground while that page is in
 *  view. Light: a white line reads on it, and it is still a pale page. */
export const VIEWER_WHITE_STROKE_BACKING = '#DEDEDE';

/** The ground an UNFINISHED page sits on in the Notebook — a response
 *  drawn but not yet sent (docs/response_spec.md §4.7). It was a step
 *  darker than NOTEBOOK_ART_BG (#E0E1E0 on #F0F0EE) so the card read as
 *  held back from the finished pages around it; the Sep 2026 palette took
 *  both to white, so the step is currently NOT DRAWN and the caption
 *  ("In Progress Response") carries the state alone. The token stays
 *  because it is the one place that step can be put back. */
export const NOTEBOOK_UNSENT_BG = '#ffffff';

/** The ground a page you STARTED and have not marked done sits on in the
 *  Notebook — a step of grey under both the artwork and its caption strip,
 *  so the wall says at a glance which pages are still owed. (The unsent
 *  response above wears the same idea and is currently drawn white; this
 *  one is the step put back, for the state that has no caption of its own
 *  on every card — a WIP's strip names the game and the group, and a Free
 *  Play tile has no strip at all.) */
export const NOTEBOOK_WIP_BG = '#E7E7E4';
/**
 * The editor canvas's own ground — the light grey behind the scene (a
 * barely-warm white, #FCFBF9, until the Sep 2026 palette).
 *
 * There is no implicit white page: a composition paints a background only if
 * it declares one, so where it does not, THIS is the colour under everything
 * and the colour the eye reads as "the canvas". The paint brush blends
 * against it for exactly that reason (see paintBrush's `beneath`), which is
 * why it is a shared constant rather than a literal in the canvas component.
 *
 * What does NOT follow it is the rig's paper (web/formats/poserRig
 * PAPER_PAGE): that colour is baked into stored subpaths and into figures
 * already drawn, so it stayed at #FCFBF9 when this moved. A figure's solid
 * volumes therefore read a shade lighter than bare canvas.
 */
// The shared editor's own ground (editor-ui's theme): DERIVED, not
// restated, so the canvas and this app's chrome cannot drift apart —
// the same reason the system font stack has one home (stage 5a of
// vendor/UnderwayEngine/docs/shared-editor.md).

// Ink ramp — five faintly blue-leaning neutrals, so the words sit in the same
// cool family as the ramp and the accent rather than against them.
export const INK = '#24252A'; // wordmark, titles, dates

export const INK_MUTED = '#434750'; // body copy

export const INK_TERTIARY = '#777A84'; // date divider, muted labels

export const INK_META = '#9A9CA4'; // status/meta labels

export const INK_HINT = '#B9BBC1'; // light grey: the title band's italic friends note, the quiet side of a toggle

/** The FLAT accent — toggles, links, the active tab, small icons. The brand
 *  ramp's opening SKY BLUE, held still (bug report 3cc5a26f; it was the
 *  ramp's indigo middle until then): a control that is merely ON should be
 *  the gradient's colour without being the gradient, which is reserved for
 *  the special CTAs (CTA_GRADIENT_COLORS). It is a LIGHT colour — it clears
 *  only 2.18:1 against white, so ACCENT_ON words on it and accent words on
 *  a white card are both well under AA's 4.5, where the indigo gave 4.49.
 *  That is the price of the stop asked for, not an oversight: theme.test.ts
 *  pins the measured figure, and the dark ink would read 7.02:1 on it if
 *  ACCENT_ON is ever re-tuned to match. */
export const ACCENT = '#39BBF8';

export const ACCENT_ON = '#FFFFFF'; // text on accent
/** 1pt rules and borders. The canvas's own hairline is the same value
 *  from the same place (editor-ui's CANVAS_HAIRLINE). */

export const DANGER = '#B0382E'; // brick red: destructive actions, error lines

// ── The special-CTA gradient ────────────────────────────────────────
// A few calls to action are not any GAME's: the Now panel's Begin button on
// Today, the Shared tab's invite card and the friends feed's offer to start
// a social game are the app asking for the next move rather than one format
// offering itself. They wear this one
// fixed three-stop ramp — sky → indigo → lavender — which belongs to no
// format in FORMAT_BASE_COLOR and so can never be mistaken for one. It is
// the LOUDEST thing on any screen BY DESIGN — that, and not a reserved range
// of hues, is what keeps it uncontested: its stops run 83–93% HSL
// saturation where every game fill sits at 25–69%. (The Sep 2026 ramp, blue
// → teal → green, ran 54–58% and leaned on TONE instead — mid-tones at
// 47–52% lightness against the games' 77–86% pastels. This ramp, back on
// the earlier cyan → indigo → violet hues with the stops re-tuned, is a
// light one at 60–76%, so its lavender end sits only two points under the
// palest game and chroma carries the separation again — theme.test.ts
// holds the figures, and holds the ramp darker than every game as well.)
// Said once here, as ACCENT is, so a shape that wants it cannot write its
// own copy of the stops.
//
// That offer inside a GROUP has a ramp of its own (SOCIAL_CTA_GRADIENT_COLORS
// below) — the one exception, and for a reason that cannot recur: one of
// this ramp's stops is ACCENT (its opening sky blue; the indigo middle
// until Oct 2026), so it is not free to move.
export const CTA_GRADIENT_COLORS = ['#39BBF8', '#6266F0', '#A188F9'] as const;

/**
 * Corner to corner — deliberately NOT the cards' fixed 160°
 * (CARD_GRADIENT_START/END).
 *
 * A fill's start/end are fractions of the box it fills (GradientView), so
 * one pair of opposite corners is a shallow, nearly-horizontal ramp across a
 * wide short button and a steep diagonal down a tall card: the ramp follows
 * each shape's long axis, and neither shape has to write an angle of its own.
 * A near-vertical 160° would squeeze all three stops into a 48pt button and
 * the middle one would never be seen.
 */
export const CTA_GRADIENT_START = { x: 0, y: 0 } as const;

export const CTA_GRADIENT_END = { x: 1, y: 1 } as const;

/** The words on that ramp: PURE white. A token of its own even though
 *  ACCENT_ON is white too — they are white for different reasons and move
 *  apart again the moment either accent is re-tuned. The ramp's ends are
 *  thin — its sky stop clears only 2.2:1 against white and its lavender
 *  2.8:1 — so there is no off-white here to spend the little contrast there
 *  is on. See theme.test.ts, which pins the measured figures rather than an
 *  acceptance threshold this ramp does not meet. */
export const CTA_INK = '#FFFFFF';

// ── The social offer's ramp ─────────────────────────────────────────
// The one card that asks a GROUP for the next move — the turns deck's
// offer to start a social game in a group channel (components/TurnBanner's
// TrySocialCard) — wears its own three stops, magenta → purple → indigo,
// rather than the special-CTA ramp above, which the same offer still
// wears on the friends feed.
//
// Two ramps and not one because the ramp above is not free to move: its
// opening stop IS `ACCENT`, the flat accent the whole app's toggles and
// links are set in, so re-tuning it to suit one card would drag every
// control in the app along. This one belongs to that card alone.
//
// It is told from a game the way the ramp above was until Oct 2026, by
// TONE: its stops are mid-tones (48–52% HSL lightness, against every game
// fill's 77–86% pastel) at 54–58% chroma, and none of them is a
// FORMAT_BASE_COLOR. (The CTA ramp has since gone light and loud — 60–76%
// lightness at 83–93% chroma — so the two ramps no longer share a band;
// each is kept off the games by its own figure.) Where this one does
// better is ink — all three stops clear 5:1 against white (5.01 / 5.49 /
// 7.01), where the CTA ramp's sky end clears 2.18:1 — so `CTA_INK` sits on
// it with contrast to spare. theme.test.ts holds the figures.
export const SOCIAL_CTA_GRADIENT_COLORS = ['#C13397', '#A238BC', '#5A3ECC'] as const;

// Echo brand device — the small mark beside the wordmark (30pt dot + two
// rings) and the large decorative background echo (dot + three rings).
// The ramp's indigo middle — where ACCENT stood too until Oct 2026, when
// the flat accent alone moved to the ramp's sky end (bug report 3cc5a26f).
// The mark did not move with it: that report asked for the accent, and the
// mark is drawn large on a pale ground, where the sky blue would be faint.
export const ECHO_ACCENT = '#6266F0';

// ── Type faces ──────────────────────────────────────────────────────
// Newsreader (display/titles), Karla (UI/body), IBM Plex Mono (small
// labels). Loaded in app/(tabs)/_layout.tsx.
export const FONT_DISPLAY = 'Newsreader_400Regular';

export const FONT_BODY = 'Karla_400Regular';

/** The body italic. A named family, not `fontStyle: 'italic'` over FONT_BODY:
 *  only the faces registered in _layout are available, and asking the roman
 *  face to lean falls back to the SYSTEM italic — a different typeface in the
 *  middle of the line. */
export const FONT_BODY_ITALIC = 'Karla_400Regular_Italic';

export const FONT_BODY_MEDIUM = 'Karla_500Medium';

export const FONT_BODY_SEMI = 'Karla_600SemiBold';

/** FONT_BODY_SEMI's italic face, for the Today card's prompt — the word
 *  leans inside the semibold date line without going thinner. */
export const FONT_BODY_SEMI_ITALIC = 'Karla_600SemiBold_Italic';

export const FONT_BODY_BOLD = 'Karla_700Bold';

/** Heavier still, for type that has to carry at a few pixels: the corner
 *  ribbon's stamp (components/CornerRibbon), whose words are small,
 *  tracked out and turned 45° over a coloured ground. A WEIGHT and not a
 *  fontWeight — a named custom family ignores fontWeight on iOS, so the
 *  heavier cut has to be its own face (app/(tabs)/_layout registers it). */
export const FONT_BODY_XBOLD = 'Karla_800ExtraBold';

/** Faux small caps, drawn by hand. Karla ships no `smcp` table, so asking
 *  for the OpenType feature (`fontVariant: ['small-caps']`) changes
 *  nothing on screen: caps, with the tracking caps want, set a size or two
 *  below the line they sit in, IS the small caps. Each wearer picks its
 *  own size and face; the casing and the tracking live here so the Home
 *  streak line, the past cards' prompt and the shared card's game label
 *  are one voice rather than three copies of these numbers. */
export const SMALL_CAPS = {
  textTransform: 'uppercase',
  letterSpacing: 0.66,
} as const;

export const FONT_MONO = 'IBMPlexMono_500Medium';

/** The heading over a PAGE: what the page is, set in the display face at
 *  the size this app headlines at (22, over the sheets' shared 18).
 *
 * One definition, because the same page is headed in two places — the
 * Shared feed's list of its answers (ResponseListModal) and the
 * full-screen viewer the Notebook opens it in (EntryViewer's ViewerTitle)
 * — and a page must not be titled in two voices depending on which way
 * you came at it. What each header adds is its own: the feed's carries the
 * maker's line under it, the Notebook's has nobody to name.
 */
export const HEADING_TITLE = {
  fontFamily: FONT_DISPLAY,
  fontSize: 22,
  color: INK,
} as const;

// Journal's deeper accent — the book mark line art and the mode-toggle
// underline (journal-tab.md "Header"). It is the brand ramp's opening sky
// blue — and so, since Oct 2026, the very colour ACCENT is: "deep" by
// history rather than by tone, and a token of its own by history too. At
// 60% lightness it is the ramp's palest-looking stop after the lavender,
// and clears only 2.18:1 against white, which is enough for line art and a
// rule but not for words.
export const ACCENT_DEEP = '#39BBF8';

// iOS safe-area insets as CSS values, for the plain-DOM editor chrome
// (OptionsRow, PromptBanner, the text-edit overlay). env() resolves to the
// real device inset once app/+html.tsx sets viewport-fit=cover, and to 0 on
// hardware without a notch/home indicator. The react-native-web chrome
// (TopBar, panels) instead reads numeric useSafeAreaInsets() — React
// Native's DimensionValue type rejects raw env()/calc() strings.
export const SAFE_TOP = 'env(safe-area-inset-top)';

export const SAFE_BOTTOM = 'env(safe-area-inset-bottom)';

/** …and the side, for a control pinned to a corner (the strip zoom's X):
 *  0 upright, the notch's width when the device is on its side. */
export const SAFE_RIGHT = 'env(safe-area-inset-right)';

// Shared layout metrics so screens stay on one spacing/rounding scale. Card
// metrics are the handoff's final 375pt logical-point values (RN dp).
export const SPACE_SCREEN = 20; // horizontal screen gutter (cards)

export const SPACE_TEXT = 26; // horizontal screen gutter (header text)

export const RADIUS_CARD = 26; // format cards, Now panel

export const RADIUS_SMALL = 16; // rail thumbnails, chips, cells

export const RADIUS_CTA = 14; // Now panel CTA

/** The floating capsule chrome's width: 90% of the span inside a 48pt
 *  gutter each side. The tab bar (app/(tabs)/_layout.tsx) and the Shared
 *  page's game wheel both size to this, so the two capsules read as one
 *  family of chrome. */
export function floatingCapsuleWidth(screenW: number): number {
  return (screenW - 48 * 2) * 0.9;
}

// The floating nav capsule's height and its clearance above the safe-area
// bottom (app/(tabs)/_layout.tsx draws it; anything that sits beside it in
// the gutter — the Today page's developer bug icon — lines up to these).
export const FLOATING_NAV_HEIGHT = 64;

export const FLOATING_NAV_BOTTOM_GAP = 20;

// The floating nav capsule (app/(tabs)/_layout.tsx) is not part of layout
// flow — it hovers over content. Scrollable tab screens reserve this much
// extra bottom padding (on top of the safe-area inset) so their last row
// isn't hidden under the capsule. = capsule height (64) + 24pt breathing gap.
export const FLOATING_NAV_CLEARANCE = FLOATING_NAV_HEIGHT + 24;

// ── Per-format rail card tint — "Daylight & Lamplight" ───────────────
// Each format owns one base colour (FORMAT_BASE_COLOR) and every tone on its
// card — both gradient stops, the thumbnail well, the tally line, the title and
// body inks — is DERIVED from that one hex by shifting lightness in HSL. Day
// cards use the SAME fill as the hero card; only the ghost (archive /
// unopened) card drops, to 0.55. Colour is the activity's stable, learnable
// identity, so it keys off the FORMAT, not the rail's position — two people
// with different enabled sets still see the same colour for the same game.
//
// The TURN-BASED games additionally declare a second hex (FORMAT_SWEEP_COLOR)
// and their cards sweep between the two. See {@link CardFill}.
/**
 * A card's whole fill, ready to spread onto a `<GradientView>`
 * (components/GradientView):
 *
 *     <GradientView {...tint.heroFill} style={styles.card} />
 *
 * An OBJECT rather than the loose `colors` array it replaced, because the two
 * classes of card no longer share a geometry: a flat card is two stops on the
 * shared 160° diagonal, and a turn-based one is four stops on a 145° one. Every
 * caller drawing a card would otherwise have to ask which kind it had and pick
 * the points itself — thirteen chances to get it wrong, and the exact shape of
 * duplication this file has been bitten by before.
 *
 * Built ONCE per format at module load (FORMAT_TINTS) and spread by reference,
 * so a rail of cards allocates no arrays per render. The old call sites copied
 * (`colors={[...tint.heroColors]}`) on every pass.
 */
export interface CardFill {
  /** Two stops for a flat card, four for a sweep. Readonly tuples throughout:
   *  these are exactly the shapes GradientView's props ask for, which is
   *  what lets a caller spread the fill straight onto the element. */
  colors: readonly [string, string, ...string[]];
  /** Stop positions 0–1, one per colour — only the sweep sets them; a flat
   *  card leaves them undefined and its two stops space themselves. */
  locations?: readonly [number, number, ...number[]];
  start: { readonly x: number; readonly y: number };
  end: { readonly x: number; readonly y: number };
}

// A FLAT card is a 160° two-stop gradient. A fill is written as start/end
// points; 160° (clockwise from top) maps to this mostly-vertical diagonal.
export const CARD_GRADIENT_START = { x: 0.33, y: 0.03 } as const;

export const CARD_GRADIENT_END = { x: 0.67, y: 0.97 } as const;

// …and a SWEEP is 145°, corner to corner on a portrait card — a flatter
// diagonal, so the two tones divide the card across rather than down it.
export const SWEEP_GRADIENT_START = { x: 0.21, y: 0.09 } as const;

export const SWEEP_GRADIENT_END = { x: 0.79, y: 0.91 } as const;

/**
 * The sweep's four stops: each tone HELD flat for a third, and the blend
 * confined to the middle.
 *
 * Load-bearing, not decoration. A plain two-stop fade between two tones of
 * similar lightness reads as one colour going dim, not as two colours — the
 * eye needs to see each of them unmixed somewhere before it will accept the
 * card as two-toned. Do not simplify this to `[highlight, sweep]`.
 */
export const SWEEP_GRADIENT_LOCATIONS = [0, 0.3, 0.7, 1] as const;

/**
 * The same fill as ONE CSS background, for the DOM half of the app: the
 * editor is plain DOM (no GradientView there), and a game drawn
 * inside it — the square on a social turn's hand-off ask — has to be the
 * square the app draws everywhere else. The angle and the stop positions are
 * read off the fill rather than written down again, so the two cannot drift.
 */
export function cardGradientCss(fill: CardFill): string {
  const deg = gradientAngle(fill);
  const { locations } = fill;
  const stops = locations === undefined
    ? fill.colors.join(', ')
    : fill.colors.map((c, i) => `${c} ${Math.round(locations[i] * 100)}%`).join(', ');
  return `linear-gradient(${deg}deg, ${stops})`;
}

/** What a gradient is made of, as the native screens write one: colours,
 *  where they sit 0–1 along the line, and the line's two ends as FRACTIONS
 *  OF THE BOX it fills. A {@link CardFill} is one; a page ground or a scrim
 *  leaves the ends out and runs straight down. */
export interface GradientFill {
  colors: readonly string[];
  locations?: readonly number[];
  start?: { readonly x: number; readonly y: number };
  end?: { readonly x: number; readonly y: number };
}

/** Top to bottom: where a gradient runs when nobody says. */
const GRADIENT_DEFAULT_START = { x: 0.5, y: 0 } as const;

const GRADIENT_DEFAULT_END = { x: 0.5, y: 1 } as const;

/**
 * Whether a fill's picture depends on the SHAPE of the box it is laid in.
 *
 * The ends are fractions of the box, so a diagonal one is a different angle
 * on a wide card than on a square one (which is the whole of the special
 * CTA's design — see CTA_GRADIENT_START). A fill that runs straight down or
 * straight across is the same picture in any box, and nobody has to know
 * the box to draw it.
 */
export function fillTurnsWithShape(fill: Pick<GradientFill, 'start' | 'end'>): boolean {
  const s = fill.start ?? GRADIENT_DEFAULT_START;
  const e = fill.end ?? GRADIENT_DEFAULT_END;
  return s.x !== e.x && s.y !== e.y;
}

/** A number for a CSS string: three places, no trailing zeros, no -0. */
function cssNumber(v: number): string {
  return String(Math.round(v * 1000) / 1000 || 0);
}

/**
 * A fill as the CSS background that draws THE SAME PICTURE in a box of the
 * given `aspect` (width / height) — what the native screens lay their
 * gradients with (components/GradientView), through React Native's own
 * background image, which is a GPU gradient layer and not a bitmap.
 *
 * Not {@link cardGradientCss}, and the difference is the point. That one
 * says a fill's nominal angle and leaves the stops where they were, which
 * is the fill only roughly: CSS runs its gradient line corner to corner at
 * the angle given, while the fill's two ends are points INSIDE the box — a
 * shorter line, and on any box that is not square a different angle too.
 * This one measures: the angle is the one the two ends actually make in a
 * box this shape, and every stop is moved to where it falls along CSS's
 * longer line, so the first colour starts and the last one ends exactly
 * where the ends are. Past either end the colour holds, in both.
 *
 * `aspect` matters only for a fill that {@link fillTurnsWithShape}; for the
 * rest any value gives the same string.
 */
export function fillBackgroundCss(fill: GradientFill, aspect = 1): string {
  const s = fill.start ?? GRADIENT_DEFAULT_START;
  const e = fill.end ?? GRADIENT_DEFAULT_END;
  // The box, in units of its own height.
  const w = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const vx = (e.x - s.x) * w;
  const vy = e.y - s.y;
  const len = Math.hypot(vx, vy);
  const { colors, locations } = fill;
  // Two ends on one spot is no line at all: the box is the first colour.
  if (!(len > 0) || colors.length < 2) {
    const c = colors[0] ?? 'transparent';
    return `linear-gradient(180deg, ${c}, ${c})`;
  }
  const dx = vx / len;
  const dy = vy / len;
  // CSS: 0deg points up and turns clockwise; y runs down here.
  const deg = ((90 + (Math.atan2(dy, dx) * 180) / Math.PI) % 360 + 360) % 360;
  // CSS's gradient line: through the centre, long enough that the corners
  // sit on its 0% and 100%.
  const cssLen = Math.abs(w * dx) + Math.abs(dy);
  const along = (px: number, py: number): number =>
    0.5 + ((px * w - w / 2) * dx + (py - 0.5) * dy) / cssLen;
  const from = along(s.x, s.y);
  const span = along(e.x, e.y) - from;
  const last = colors.length - 1;
  const stops = colors.map((c, i) => {
    const t = locations?.[i] ?? i / last;
    return `${c} ${cssNumber((from + t * span) * 100)}%`;
  });
  return `linear-gradient(${cssNumber(deg)}deg, ${stops.join(', ')})`;
}

/**
 * The CSS-style angle a fill's points describe: 0° = up, clockwise, as a
 * whole number of degrees. CSS 0deg points UP and turns clockwise; the
 * points are a unit box with y running down — the same conversion the
 * editor's paints take (the engine's @/editor/colorUtils paintToCssBackground).
 * Read off the points rather than written beside them, so the DOM half
 * and the banner presets (components/bannerAdminModel) say the angle
 * the native gradient actually draws.
 */
export function gradientAngle(fill: Pick<CardFill, 'start' | 'end'>): number {
  const rad = Math.atan2(fill.end.y - fill.start.y, fill.end.x - fill.start.x);
  return Math.round(90 + (rad * 180) / Math.PI);
}

/**
 * The inverse: unit-box points for a CSS-style angle (0° = up, clockwise).
 * The unit-length direction vector centred on the box — which is exactly
 * what the cards' fixed points are (160° reproduces CARD_GRADIENT_START/END
 * to two places, 145° the sweep's) — so a banner authored as colours and
 * an angle (docs/banners.md D7) draws on the geometry every other card
 * uses, and round-trips through {@link gradientAngle} / cardGradientCss.
 *
 * Rounded to four places: the cardinal angles otherwise land on 1e-16s
 * (and a NEGATIVE zero, which atan2 reads as the far side of the circle).
 */
export function gradientPointsForAngle(deg: number): Pick<CardFill, 'start' | 'end'> {
  const rad = ((deg - 90) * Math.PI) / 180;
  const dx = Math.cos(rad) / 2;
  const dy = Math.sin(rad) / 2;
  const r = (v: number): number => Math.round(v * 1e4) / 1e4 || 0;
  return { start: { x: r(0.5 - dx), y: r(0.5 - dy) }, end: { x: r(0.5 + dx), y: r(0.5 + dy) } };
}

/**
 * A banner's fill, ready to spread onto a `<GradientView>`: its colours,
 * evenly spaced (no `locations`, as a flat card's are), on the points its
 * angle gives. Built ONCE per banner — the banner store memoises by id +
 * updatedAt, and the admin page's preview by the draft — never per render:
 * a deck of these spreads the object by reference, as a rail spreads a
 * tint's. A gradient with fewer than two stops (which the server refuses,
 * but a fill must still be a fill) repeats its first.
 */
export function bannerFill(gradient: { colors: readonly string[]; angle: number }): CardFill {
  const [first = BG_CARD, second = first, ...rest] = gradient.colors;
  return { colors: [first, second, ...rest], ...gradientPointsForAngle(gradient.angle) };
}

/**
 * Where dark words stop reading on a fill: the perceived brightness of its
 * MEAN stop, 0–255. The games' pastels (77–86% lightness) sit well above
 * it and the CTA ramp's mean (143, since the Oct 2026 stops) a little
 * below, so the ramp still takes white; a banner in between is the admin's
 * to call, with the form's Dark / Light override.
 */
export const INK_FLIP_LUMA = 150;

/** Dark or light words for a fill, when the admin has not said: the
 *  perceived luma (components/perceivedLuma — the app's one answer to "is
 *  this darker than that") of the mean of its hex stops, against
 *  {@link INK_FLIP_LUMA}. Stops that are not `#rrggbb` (a ghost fill's
 *  rgba) are skipped; a fill with none reads as pale. */
export function inkForFill(fill: Pick<CardFill, 'colors'>): 'dark' | 'light' {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const c of fill.colors) {
    if (!/^#[0-9a-fA-F]{6}$/.test(c)) continue;
    const [cr, cg, cb] = hexToRgb(c);
    r += cr;
    g += cg;
    b += cb;
    n += 1;
  }
  if (n === 0) return 'dark';
  return perceivedLuma(r / n, g / n, b / n) >= INK_FLIP_LUMA ? 'dark' : 'light';
}

/** A hex colour at an alpha — `rgba(...)` CSS. Gradients that fade OUT end
 *  on one of these rather than on `transparent`, which the native gradient
 *  reads as clear BLACK and smears grey through the fade. */
export function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// ── Base-colour → tint derivation ────────────────────────────────────
// Every stop and ink is computed from one base hex by shifting lightness in
// HSL, so a format's whole card (highlight, depth, thumb well, title/body ink)
// stays in one hue family and only the single base colour needs tuning.
export const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * A hex colour mixed toward WHITE by `amount` (0 = unchanged, 1 = white),
 * at full opacity — a paler version of the same colour, not the same
 * colour gone see-through.
 *
 * The difference matters wherever the thing sits on artwork rather than on
 * a page: a translucent tint takes the colour of whatever it happens to
 * cover, so it reads as one tone over a light drawing and another over a
 * dark one. Mixed toward white it is the same band everywhere.
 */
export function lightenHex(hex: string, amount: number): string {
  const t = clamp01(amount);
  const mixed = hexToRgb(hex).map((c) => Math.round(c + (255 - c) * t));
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
