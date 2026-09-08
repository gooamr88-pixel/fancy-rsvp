/* ═══════════════════════════════════════════════════════════════════════════
   THE GUEST'S JOURNEY.

   The other half of the organizer chapter, and the SAME event: Nadia & Omar,
   14 May 2027, Beit Al Qamar. The guest here is Nour Haddad — the first name
   on the organizer's list, seated at Table 4, one of the 34 who agreed to
   texts. Nothing in this chapter contradicts anything in that one.

     the link arrives → the sealed envelope → the seal breaks (a real MP4) →
     the invitation → the reply → the details the reply opens →
     the entry pass, with a real scannable code

   Screens, and where each is staged:
     video/stage/ch11/cover            videoCh11Guest.dump.jsx
     video/stage/ch11/hero                   "
     video/stage/ch11/rsvp-choice            "
     video/stage/ch11/rsvp-attending         "
     video/stage/ch11/pass                   "
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const G     = (n) => `video/stage/ch11/${n}.html`;
/* Staged by THIS chapter's probe, not borrowed from templateShots.dump.jsx.
   That probe gives every template a different sample couple so the marketing
   rows do not repeat a name — Swan Lake's is "Adam & Mira" — which put an
   envelope and an invitation reading Adam & Mira three shots before an entry
   pass reading Nadia & Omar. */
const COVER = G('cover');
const HERO  = G('hero');

module.exports = [
  /* A short hold, not a pause: slack for the startup trim, which is measured
     but not exact. */
  { t: 'wait', ms: 450 },

  { t: 'titleShow',
    kicker: 'A complete walkthrough',
    heading: 'The guest journey',
    sub: 'What the person you invited actually sees — from the link in their messages to their seat at the table.' },
  /* Loaded BEHIND the title card: a `show` spends real seconds fetching the
     page, its artwork and a 680KB MP4, and run in the open that is a hole in
     the film. */
  { t: 'show', screen: COVER, device: 'phone', scroll: false, settle: 1100 },
  { t: 'tag', text: 'The guest &nbsp;<b>&middot;</b>&nbsp; Nour Haddad' },
  { t: 'progress', frac: 0.05 },
  { t: 'wait', ms: 900 },
  { t: 'titleHide' },

  /* ── 1. The invitation arrives ─────────────────────────────────────── */
  {
    t: 'caption', eyebrow: 'Step one', title: 'The invitation arrives',
    body: 'One short link, sent by email or text. Nothing to install and no '
        + 'account to make. Opening it does not drop the guest into a form — it '
        + 'hands them a sealed envelope in the design the host chose.',
  },
  { t: 'wait', ms: 1600 },

  /* The hint is the component's own — not a caption we drew over it. */
  { t: 'ring', sel: '.cine-swan__hint', pad: 10 },
  {
    t: 'caption', eyebrow: 'Step one', title: 'The invitation arrives',
    body: 'The envelope waits. Nothing plays, nothing autostarts, and nothing '
        + 'is asked of the guest until they choose to open it.',
  },
  { t: 'wait', ms: 1500 },
  { t: 'unring' },

  /* ── 2. Breaking the seal ──────────────────────────────────────────── */
  { t: 'move', sel: '[data-testid="cine-opening-tap"]', ms: 900 },
  { t: 'hideCaption' },
  { t: 'click' },

  /* The component's own phases, in the component's own order.
     WaxEnvelopeOpening drives idle → arming → playing → revealed → done and
     renders exactly one of is-playing / is-revealed at a time, with is-arming
     held from arming onward. Reproduced literally: a half-applied state
     machine is how "touch to break the seal" once stayed printed across the
     entire opening. */
  { t: 'setClass', sel: '.cine-open', cls: 'is-arming' },
  { t: 'setClass', sel: '.cine-open', cls: 'is-playing' },
  { t: 'hideCursor' },
  { t: 'playVideo', sel: '.cine-swan__video', maxMs: 12000 },
  { t: 'setClass', sel: '.cine-open', cls: 'is-playing', on: false },
  { t: 'setClass', sel: '.cine-open', cls: 'is-revealed' },
  { t: 'wait', ms: 1000 },
  { t: 'progress', frac: 0.25 },

  /* ── 3. The invitation itself ──────────────────────────────────────── */
  { t: 'show', screen: HERO, device: 'phone', scroll: false, settle: 900 },
  {
    t: 'caption', eyebrow: 'Step two', title: 'The invitation',
    body: 'The seal breaks and the card is underneath: the couple, the date, '
        + 'the place. This is <b>Swan Lake</b>, one of four cinematic templates '
        + '— the host picked it and typed their own names into it. The artwork '
        + 'is not a picture of a template, it is the template.',
  },
  { t: 'wait', ms: 2600 },

  { t: 'ring', sel: '.cine-shero__names', pad: 12 },
  { t: 'wait', ms: 1500 },
  { t: 'unring' },

  { t: 'ring', sel: '[data-testid="cine-hero-download"]', pad: 10 },
  {
    t: 'caption', eyebrow: 'Step two', title: 'The invitation',
    body: 'A guest can save the card as an image and keep it, or forward it. '
        + 'That button is on every template.',
  },
  { t: 'wait', ms: 1800 },
  { t: 'unring' },
  { t: 'progress', frac: 0.45 },

  /* ── 4. The reply ──────────────────────────────────────────────────── */
  /* Caption down BEFORE the cut, or the previous screen's explanation hangs
     over the new one for the length of the crossfade and reads as wrong
     rather than late. */
  { t: 'hideCaption' },
  { t: 'show', screen: G('rsvp-choice'), device: 'phone', settle: 800 },
  {
    t: 'caption', eyebrow: 'Step three', title: 'The reply',
    body: 'Scrolling to the end of the invitation reaches the RSVP. It opens '
        + 'with one question and two answers — and deliberately nothing else.',
    steps: [
      { text: 'Answer yes or no' },
      { text: 'Only then do the details appear' },
      { text: 'Submit once — the reply is locked to this guest' },
    ],
  },
  { t: 'scroll', sel: '[role="radiogroup"]', ms: 1800, frac: 0.32 },
  { t: 'wait', ms: 700 },
  { t: 'ring', sel: '[role="radiogroup"]', pad: 12 },
  { t: 'wait', ms: 1400 },
  { t: 'unring' },

  { t: 'move', sel: '[role="radiogroup"] button', ms: 900 },
  { t: 'click' },
  { t: 'hideCursor' },
  { t: 'hideCaption' },

  /* ── 5. What the answer opens ──────────────────────────────────────── */
  { t: 'show', screen: G('rsvp-attending'), device: 'phone', settle: 800 },
  { t: 'progress', frac: 0.70 },
  {
    t: 'caption', eyebrow: 'Step four', title: 'What "yes" opens',
    body: 'Choosing an answer is what reveals the rest of the form. A guest who '
        + 'cannot come is never made to walk through meal choices and companion '
        + 'names to say so.',
    steps: [
      { text: 'Name, email and phone — for the confirmation' },
      { text: 'How many are coming, and who they are' },
      { text: 'A meal each, and any allergies' },
      { text: 'Whatever else the host chose to ask' },
    ],
  },
  { t: 'wait', ms: 2800 },
  { t: 'hideCaption' },
  { t: 'scrollTour', ms: 12000 },
  { t: 'wait', ms: 500 },

  /* ── 6. The pass ───────────────────────────────────────────────────── */
  { t: 'show', screen: G('pass'), device: 'phone', settle: 800 },
  { t: 'progress', frac: 0.92 },
  {
    t: 'caption', eyebrow: 'Step five', title: 'The entry pass',
    body: 'The reply comes back as a pass: the guest\'s name, their table, and '
        + 'a code that opens the door. It rides the confirmation email as well, '
        + 'so it survives a lost message — and it can be saved to the phone\'s '
        + 'photos for a venue with no signal.',
  },
  { t: 'wait', ms: 2400 },
  { t: 'move', sel: 'img[src^="data:image"]', ms: 900 },
  { t: 'ring', sel: 'img[src^="data:image"]', pad: 10 },
  {
    t: 'caption', eyebrow: 'Step five', title: 'The entry pass',
    body: 'That code is real, and it is this guest\'s. At the door it is '
        + 'scanned by the Fancy check-in app on a tablet, which knows the whole '
        + 'guest list offline and marks <b>Nour Haddad, Table 4</b> as arrived.',
  },
  { t: 'wait', ms: 2600 },
  { t: 'unring' },
  { t: 'hideCursor' },
  { t: 'hideCaption' },

  { t: 'progress', frac: 1 },
  /* titleShow, not title: `title` dismisses its own card, and record.js holds
     the recording open for another 900ms afterwards — which would hand the
     last second of the film back to whatever screen was underneath. */
  { t: 'titleShow',
    kicker: 'The guest journey',
    heading: 'From a link to a seat at the table',
    sub: 'No app, no account, no password — and the host knows before they arrive.' },
  { t: 'wait', ms: 2200 },
];
