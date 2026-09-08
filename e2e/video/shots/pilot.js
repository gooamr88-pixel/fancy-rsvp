/* ═══════════════════════════════════════════════════════════════════════════
   THE PILOT — ~90 seconds, cut from the opening of Chapter 11.

   Its job is not to teach anybody anything. It is to settle the visual
   language of the whole series before eleven chapters are built on top of it:
   the title card, the caption card, the cursor, the highlight ring, the
   device shell, and the pacing between them.

   The screens are real:
     .visual/landing/stage/cover-swans.html   staged by templateShots.dump.jsx
     .visual/landing/stage/hero-swans.html    staged by templateShots.dump.jsx
     .visual/video/stage/ch11/rsvp-choice.html staged by videoCh11Guest.dump.jsx

   The seal actually breaks: public/templates/swans/envelope.mp4 is the
   shipped opening, played in the browser rather than approximated.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const COVER = 'landing/stage/cover-swans.html';
const HERO  = 'landing/stage/hero-swans.html';
const RSVP  = 'video/stage/ch11/rsvp-choice.html';

module.exports = [
  /* A deliberate black hold on frame one.

     record.js trims the browser's startup off the head using a measured
     number that is close but not exact. This hold is the slack that absorbs
     the difference in both directions: over-trim eats hold instead of eating
     the title, under-trim leaves a beat of black instead of a flash of
     about:blank. Every chapter opens with it. */
  { t: 'wait', ms: 1600 },

  /* ── Opening title ─────────────────────────────────────────────────── */
  {
    t: 'title',
    kicker: 'A complete walkthrough',
    heading: 'Fancy',
    sub: 'Digital invitations, RSVPs, seating and check-in — explained screen by screen.',
    hold: 2400,
  },
  /* PRELOAD BEHIND THE TITLE.

     A `show` step spends real seconds fetching a staged page, its stylesheet,
     its artwork and — here — a 680KB MP4. Run in the open that reads as a
     hole in the film: on the first take there were six seconds of empty
     backdrop between the chapter title and the envelope.

     The title card is a full-frame overlay at z-index 60, so loading a screen
     underneath it is invisible. Every chapter should open this way: title
     first, show second, THEN let the title lift onto a screen that is already
     there. */
  { t: 'titleShow', kicker: 'Chapter eleven', heading: 'The guest journey',
    sub: 'What the person you invited actually sees, from the link in their messages to their seat at the table.' },
  { t: 'show', screen: COVER, device: 'phone', scroll: false, settle: 1200 },
  { t: 'tag', text: 'Chapter 11 &nbsp;<b>&middot;</b>&nbsp; The guest journey' },
  { t: 'wait', ms: 1600 },
  { t: 'titleHide' },
  {
    t: 'caption',
    eyebrow: 'Step one',
    title: 'The invitation arrives',
    body: 'A guest receives one short link — nothing to install, no account to make. '
        + 'Opening it does not drop them into a form. It hands them a sealed envelope, '
        + 'addressed to them, in the design the host chose.',
  },
  { t: 'wait', ms: 1400 },

  /* The hint is the component's own — "tap to open" — not a caption we drew. */
  { t: 'ring', sel: '.cine-swan__hint', pad: 10 },
  {
    t: 'caption',
    eyebrow: 'Step one',
    title: 'The invitation arrives',
    body: 'The envelope waits. Nothing plays, nothing autostarts, and nothing is asked '
        + 'of the guest until they choose to open it.',
  },
  { t: 'wait', ms: 1200 },
  { t: 'unring' },

  /* ── 2. Opening it ─────────────────────────────────────────────────── */
  { t: 'move', sel: '[data-testid="cine-opening-tap"]', ms: 1100 },
  { t: 'hideCaption' },
  { t: 'click' },

  /* The component's own phases, in the component's own order.

     WaxEnvelopeOpening drives `idle → arming → playing → revealed → done`
     and renders exactly one of is-playing / is-revealed / is-done at a time,
     with is-arming held from arming onward (dropping it mid-crossfade
     animates the scene back down to scale(1) while the hero fades in, which
     is the drift the crossfade exists to hide). Reproduced literally here,
     because a half-applied state machine is how the "touch to break the seal"
     hint stayed on screen through the whole opening on the first take. */
  { t: 'setClass', sel: '.cine-open', cls: 'is-arming' },
  { t: 'setClass', sel: '.cine-open', cls: 'is-playing' },
  { t: 'hideCursor' },
  { t: 'playVideo', sel: '.cine-swan__video', maxMs: 12000 },
  { t: 'setClass', sel: '.cine-open', cls: 'is-playing', on: false },
  { t: 'setClass', sel: '.cine-open', cls: 'is-revealed' },
  { t: 'wait', ms: 1100 },

  /* ── 3. The invitation itself ──────────────────────────────────────── */
  { t: 'show', screen: HERO, device: 'phone', scroll: false, settle: 1000 },
  {
    t: 'caption',
    eyebrow: 'Step two',
    title: 'The invitation itself',
    body: 'The seal breaks and the card is underneath: the couple, the date, the place. '
        + 'This is <b>Swan Lake</b>, one of four cinematic templates. The host picked it '
        + 'and typed their own names into it — the artwork is not a picture of a template, '
        + 'it is the template.',
  },
  { t: 'wait', ms: 2000 },

  { t: 'ring', sel: '.cine-shero__names', pad: 12 },
  { t: 'wait', ms: 1600 },
  { t: 'unring' },

  { t: 'ring', sel: '[data-testid="cine-hero-download"]', pad: 10 },
  {
    t: 'caption',
    eyebrow: 'Step two',
    title: 'The invitation itself',
    body: 'A guest can save the card as an image and keep it — or forward it. '
        + 'That button is on every template.',
  },
  { t: 'wait', ms: 1800 },
  { t: 'unring' },

  /* ── 4. The reply ──────────────────────────────────────────────────── */
  /* Caption down BEFORE the cut. Left standing, the previous screen's
     explanation hangs over the new screen for the length of the crossfade,
     which reads as the caption being WRONG rather than merely late. */
  { t: 'hideCaption' },
  { t: 'show', screen: RSVP, device: 'phone', settle: 1000 },
  {
    t: 'caption',
    eyebrow: 'Step three',
    title: 'The reply',
    body: 'Scrolling to the end of the invitation reaches the RSVP. It opens with '
        + 'one question and two answers — and deliberately nothing else.',
    steps: [
      { text: 'Answer yes or no' },
      { text: 'Then, and only then, the details appear' },
      { text: 'Submit once — the reply is locked to this guest' },
    ],
  },
  { t: 'scroll', sel: '[role="radiogroup"]', ms: 2200, frac: 0.34 },
  { t: 'wait', ms: 800 },

  { t: 'ring', sel: '[role="radiogroup"]', pad: 12 },
  { t: 'wait', ms: 1500 },
  { t: 'unring' },

  { t: 'move', sel: '[role="radiogroup"] button', ms: 1100 },
  { t: 'click' },
  {
    t: 'caption',
    eyebrow: 'Step three',
    title: 'The reply',
    body: 'Choosing an answer is what reveals the rest of the form. A guest who '
        + 'cannot come is never made to walk through meal choices and companion '
        + 'names to say so.',
  },
  { t: 'wait', ms: 2200 },

  { t: 'hideCursor' },
  { t: 'hideCaption' },
  /* titleShow, NOT title.

     `title` dismisses its own card, and record.js holds the recording open for
     another 900ms afterwards so the film never ends on a hard cut — so a
     closing `title` handed the last second of the film back to whatever screen
     was underneath. Leaving the end card standing is what makes the film end
     on the end card. */
  { t: 'titleShow',
    kicker: 'End of pilot',
    heading: 'The rest of Chapter 11 continues',
    sub: 'Party details &middot; meals &middot; allergies &middot; companions &middot; the QR pass &middot; the seating map' },
  { t: 'wait', ms: 2400 },
];
