/* ═══════════════════════════════════════════════════════════════════════════
   The landing page's shared vocabulary.

   WHY THIS FILE EXISTS

   Before this, every marketing section re-declared the SAME six hex values at
   the top of its own file — `const GOLD = "#B8944F"` appeared in six separate
   components, `IVORY`/`CHARCOAL`/`STONE` in five. Nudging the brand meant a
   find-and-replace across ~5,700 lines and a real chance of missing one, which
   is exactly how a section ends up half a shade off.

   ── The 2026-08-20 pass: what changed and why ─────────────────────────────

   TYPE.  The page used `--font-serif` for every heading. That variable is
   ABORETO — a capitals-only display face that ships a single weight. So every
   headline on the page was a full sentence in caps ("EVERY GUEST, FROM THE
   INVITATION TO THE DOOR."), at weights the font does not have, which the
   browser faked. That one fact accounted for most of why the page read cheap.

   Aboreto is not the problem; using it for sentences was. It is kept here as
   `T.label` for the tracked micro-labels it is genuinely good at, and
   CORMORANT GARAMOND — already loaded by layout.js as `--font-cormorant`,
   300–700, with a real lowercase and a real italic — becomes `T.display`.
   Nothing new is downloaded; the face was already in the bundle and unused on
   this page.

   COLOUR.  The palette was charcoal-and-ivory with two full-dark bands. It is
   now a warm paper scale with ONE ink block (the closing call to action), so
   the invitation photography carries all the colour on the page rather than
   competing with a black background.

   Two things live here and nothing else — the palette and the page's band
   rhythm. NOT here: spacing, radii, containers and type scale. Those are
   already `--fx-*` in globals.css and duplicating them would create the second
   source of truth this file exists to remove.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The brand palette — a warm paper scale, ink, and one gold.
 *
 *  The gold appears TWICE on purpose. `gold` is for fills, hairlines and
 *  ornament; `goldInk` is the darkened one that clears 4.5:1 against paper and
 *  is the only one allowed under text a person has to read. Getting this wrong
 *  is invisible to the author and illegible to the reader. */
export const C = {
  /** The page. A warm off-white, not #FFF — a pure white ground makes the
   *  invitation photography look blue by comparison. */
  paper: '#FCFBF8',
  /** The alternating band. */
  paper2: '#F5F0E6',
  /** Strips, the footer, and anything that needs to sit a step deeper. */
  paper3: '#EFE8DA',
  /** Hairlines. Every rule on the page is 1px of this and nothing else. */
  border: '#E3DBCB',

  /** Headings and primary text. Near-black, warmed — pure #000 on warm paper
   *  reads as a hole. */
  ink: '#191815',
  /** Body copy and captions on paper. */
  inkSoft: '#5C574E',

  /** Ornament, hairlines, and display-size type only — the italic accent word
   *  in the hero is 47–78px, where 3:1 is the standard and this clears it at
   *  3.15. At body size it does NOT pass; use `goldInk`. */
  gold: '#A98A4E',
  /** The readable gold. Labels, numerals, links, anything at text size.
   *
   *  #8A6D34 until 2026-08-20, chosen when the light bands were white. Against
   *  the warm papers this page now uses it measured 4.28:1 on `paper2` and
   *  3.99:1 on `paper3` — both below AA, and invisible to anyone checking by
   *  eye, because a gold that looks fine on white looks equally fine on ivory.
   *
   *  Solved against the DEEPEST paper so one value is safe on all three:
   *  5.45 / 4.97 / 4.63 on paper / paper2 / paper3.
   *  Verified by scripts/landingContrast.js. */
  goldInk: '#7B6438',

  /** Type sitting ON the ink block. */
  ivory: '#F6F2E9',

  /* ── The photographic hero, added 2026-09-09 ──────────────────────────────
     The page had no dark surface except the closing call to action, and the
     hero was paper with two screenshots on it. The mockup leads with a
     photograph instead — which this studio can do honestly, because the
     artwork behind /images/landing/hero-bg.webp is our own licensed Door of
     Joy plate (public/templates/bab/hero-poster.jpg), blurred to a depth of
     field so the invitation in front of it is the only sharp thing in view.

     A photograph is not a colour, so the two tokens below are what makes text
     on it legible: `scrim` is the wash the picture sits under, `scrimEdge` the
     darker foot that stops the buttons floating. Both are warm rather than
     neutral black — a grey scrim over golden light turns the whole frame
     green. */
  scrim: 'rgba(24, 19, 12, 0.62)',
  scrimEdge: 'rgba(16, 13, 9, 0.86)',

  /* ── Retained for the invitation/device chrome, which is genuinely dark ──
     These are the bezel gradient stops, not page colours. */
  bezelHi: '#45464C',
  bezelMid: '#1D1D20',
  bezelLo: '#0B0B0C',
};

/** Type roles. Import these rather than reaching for `--font-serif`, which is
 *  Aboreto and will set your sentence in capitals at a weight it does not own.
 *
 *  `display` and `label` both resolve to faces layout.js already loads, so
 *  neither adds a request. */
export const T = {
  /** Headings, numerals, pull quotes. Cormorant Garamond — has a true
   *  lowercase and italic, which is where all of its elegance lives.
   *  Weights available: 300 400 500 600 700. */
  display: 'var(--font-cormorant), Georgia, "Noto Naskh Arabic", serif',
  /** Tracked micro-labels ONLY — two or three words, uppercase, wide letter
   *  spacing. This is Aboreto, which has NO lowercase: never put a sentence
   *  in it. */
  label: 'var(--font-heading), "Aboreto", Georgia, serif',
  /** Body, buttons, captions. */
  body: 'var(--font-sans)',
};

/** Text colours for copy sitting on the INK block, pre-mixed so the one dark
 *  surface on the page does not grow three different greys. */
export const ON_INK = {
  title: C.ivory,
  body: 'rgba(246, 242, 233, 0.66)',
  muted: 'rgba(246, 242, 233, 0.44)',
  hairline: 'rgba(246, 242, 233, 0.20)',
};

/** The same roles again, for copy sitting on the scrimmed PHOTOGRAPH.
 *
 *  DELIBERATELY NOT ON_INK, and the reason is that a contrast ratio can be
 *  computed against the ink block and cannot be computed against this. The ink
 *  block is one flat, known colour: 66% ivory on it is 5.9:1 and stays 5.9:1
 *  forever. A photograph's luminance moves under the text as the crop changes
 *  with the viewport, and hero-bg.webp is a picture of sunlight — the brightest
 *  part of it is nearly white.
 *
 *  So the rule here is not a measurement, it is a margin: every value is a step
 *  more opaque than its ON_INK counterpart, the title is effectively opaque,
 *  and `muted` is used ONLY where the scrim is at its heaviest (the top and
 *  bottom stops, at 0.86). Nothing at text size is set in `muted` over the lit
 *  middle of the frame — see the scrim in HeroSection, which is three stops
 *  precisely so the weight sits where the type does. */
export const ON_PHOTO = {
  title: '#FFFDF7',
  body: 'rgba(252, 249, 240, 0.88)',
  muted: 'rgba(252, 249, 240, 0.62)',
  hairline: 'rgba(252, 249, 240, 0.26)',
  /** The gold on a photograph has to be lighter than `C.gold`, which was
   *  solved against paper and disappears into golden light. */
  gold: '#E7C77E',
};

/* THERE IS NO `BAND` EXPORT, AND THAT IS DELIBERATE.

   One existed until 2026-08-20: `{ light: C.paper, warm: C.paper2, deep:
   C.paper3 }`. Nothing ever imported it — every section reaches for C.paper /
   C.paper2 / C.paper3 directly — so it was a second set of names for three
   values that already had names, in the one file whose whole purpose is to
   stop exactly that. It is the thing this docstring warns about, sitting
   inside the file that warns about it.

   The mapping it encoded (which BAND_ORDER tone means which token) now lives
   in the ONE place that consumes it: the "each band actually paints the tone
   it declares" test in landingHomepage.test.jsx.

   The single dark surface on the page — the closing call to action — is
   `C.ink`, used as a BLOCK inside a light band rather than as a full-bleed
   band, which is what keeps it reading as punctuation and not a theme switch.
*/

/** The page's declared rhythm, top to bottom. page.js asserts against this so
 *  a section cannot be reordered into two consecutive bands of one tone
 *  without the arrangement being visible in one place.
 *
 *  ── The 2026-09-09 pass: one screen per thing this product does ──────────
 *
 *  The page argued in the abstract. Four capabilities carry this business —
 *  the invitation that opens on film, the seating chart, the messages that
 *  send themselves, and the door — and all four were four ROWS of an
 *  editorial list, one line of prose each, no picture. A visitor could read
 *  the whole page and never see the seating plan.
 *
 *  Each of the four now has a band, a real screenshot and one link, in the
 *  order the work happens: they open it, you watch the replies, you seat
 *  them, they get reminded, they arrive. That order is also the order of the
 *  approved mockup.
 *
 *  TWO BANDS WENT, and neither was cut for length:
 *  · `how-it-works` described in three sentences what bands 5–7 now show. A
 *    list of steps above the screens of those steps is the same page twice.
 *  · `statement` was one line alone, and its job — a place to stop between the
 *    guest's half and the organizer's — is now done by the pull quote at the
 *    foot of the invitations band, which is a real review rather than our own
 *    voice saying something unfalsifiable.
 *
 *  The order still answers a stranger's questions in the order they ask them:
 *  what is this → what does my guest get → what is it like to receive one →
 *  what do I see → how do I seat them → who tells them → what happens at the
 *  door → how does it fit together → what else do you make → has anyone else
 *  done this → my last objection, then the button. */
export const BAND_ORDER = [
  'hero:light',
  'invitations:warm',
  'experience:light',
  'dashboard:warm',
  'seating:light',
  'reminders:warm',
  'checkin:light',
  'capabilities:warm',
  // Printed goods sit after the software rather than third, where they were
  // between 2026-08-21 and this pass. The four feature bands are one argument
  // told in order, and a catalogue of paper cards halfway through it broke the
  // sentence. It keeps its light tone, so the alternation is unaffected — and
  // it renders nothing at all until an admin publishes a piece.
  'printed:light',
  'proof:deep',
  'faq-cta:light',
  'footer:deep',
];

/**
 * THE IN-PAGE INDEX — six anchors, rendered once, at the top of band 2.
 *
 * ── Why a long page needs one ────────────────────────────────────────────
 *
 * The 2026-09-09 pass gave four capabilities a screen each, which is what the
 * page needed and is also 14,000px on a phone — about seventeen screens. Every
 * band is short and every heading is a sentence, so the page READS fast; what
 * it lost is any way to see its SHAPE, or to go straight to the one thing you
 * came for. A visitor who wants the seating chart should not have to scroll
 * past the door to find out there is one.
 *
 * Six entries, not twelve. This is a map of what the page SHOWS, so the
 * conditional bands (printed, proof) are absent — an index that offers a link
 * to a band which renders nothing on a fresh install is worse than a shorter
 * index — and so are the hero, the closing ask and the footer, which are
 * where you already are and where you inevitably end up.
 *
 * The `id` of every entry must be a band in BAND_ORDER and the id on that
 * band's own <section>. landingHomepage.test.jsx checks both, because an
 * anchor that scrolls nowhere is a dead link that no route checker can see.
 */
export const PAGE_INDEX = [
  { id: 'invitations', label: 'The invitations' },
  { id: 'experience', label: 'What a guest gets' },
  { id: 'dashboard', label: 'Your dashboard' },
  { id: 'seating', label: 'Seating' },
  { id: 'reminders', label: 'Reminders' },
  { id: 'checkin', label: 'At the door' },
];

/** Shared shadow ramp. Three steps, not eleven improvised ones.
 *
 *  `device` and `window` are the two that matter: a product screenshot with a
 *  1px border reads as a screengrab somebody pasted in, and the same pixels
 *  under a long, low shadow read as software. */
export const SHADOW = {
  card: '0 1px 2px rgba(25, 24, 21, 0.04), 0 8px 24px -12px rgba(25, 24, 21, 0.10)',
  lift: '0 2px 6px rgba(25, 24, 21, 0.05), 0 20px 44px -20px rgba(25, 24, 21, 0.18)',
  /** An invitation held as an object — long, soft, and with a faint edge so it
   *  does not look like a pasted rectangle. */
  device:
    '0 46px 92px -26px rgba(25, 24, 21, 0.50), 0 10px 24px -10px rgba(25, 24, 21, 0.22), 0 0 0 1px rgba(25, 24, 21, 0.06)',
  /** A browser window holding a screenshot. */
  window:
    '0 54px 110px -34px rgba(25, 24, 21, 0.45), 0 14px 34px -14px rgba(25, 24, 21, 0.18)',
};

/** The dark bezel a phone/tablet screenshot sits in. One definition, because
 *  three sections draw one and they were drifting apart. */
export const BEZEL = `linear-gradient(155deg, ${C.bezelHi}, ${C.bezelMid} 55%, ${C.bezelLo})`;
