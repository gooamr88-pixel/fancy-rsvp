/* ═══════════════════════════════════════════════════════════════════════════
   THE ORGANIZER'S JOURNEY — filmed on the RUNNING APPLICATION.

     cd frontend && npx next start -p 3111
     node e2e/video/record.js journey --live --verify
     node e2e/video/record.js journey --live

   Every screen here is a route on the real app, served by `next start` from
   the production build, with /api/v1 answered from e2e/video/fixtures.js. React
   is actually running: the `tap` steps below move the cursor to a real sidebar
   link and then really click it, and the app really navigates. Nothing is a
   photograph of a screen.

   The difference is visible in the first frame — the sidebar. Staged
   components render one panel at a time with no application around them; this
   is the whole product, with its navigation, its event selector and its
   check-in banner.

   `shots/organizer.js` is the same journey built from staged HTML. It needs no
   server and is the fallback if this ever cannot run; it is not as good.

   ── The event ───────────────────────────────────────────────────────────
   Nadia & Omar, 14 May 2027, Beit Al Qamar in Alexandria. 40 invitations,
   69 people, 26 parties attending, 22 of them seated, 34 opted in to texts.
   Every figure in every caption is read off the screen beside it.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

/* The sidebar's real links, matched by the one part of the href that is
   stable.

   They read `/dashboard?tab=guests` only until an event is selected; from then
   on the app carries the selection in every link —
   `/dashboard?event=evt-nadia-omar&tab=guests`. An exact-href selector
   therefore works when the DOM is dumped cold and fails the moment the film
   actually gets there, which is exactly how it failed the first time.

   They are Next <Link>s, so a tap is a client-side navigation: no reload, no
   white flash. */
const NAV = (tab) => `a[href*="tab=${tab}"]`;

module.exports = [
  /* A short hold: slack for the startup trim, which is measured but not
     exact. */
  { t: 'wait', ms: 450 },

  { t: 'titleShow',
    kicker: 'A complete walkthrough',
    heading: 'Fancy',
    sub: 'Everything an organizer does, from the home page to the door — in the running application.' },
  /* Loaded BEHIND the title card. A live route costs real seconds to fetch,
     render and hydrate; run in the open that is a hole in the film. */
  { t: 'show', app: '/', device: 'browser', url: 'fancyrsvp.com', settle: 2600 },
  { t: 'tag', text: 'Part one &nbsp;<b>&middot;</b>&nbsp; Finding Fancy' },
  { t: 'progress', frac: 0.04 },
  { t: 'wait', ms: 800 },
  { t: 'titleHide' },

  /* ── 1. The home page ──────────────────────────────────────────────── */
  {
    t: 'caption', eyebrow: 'Step one', title: 'The home page',
    body: 'Where an organizer arrives. The page explains the product in nine '
        + 'bands — what the guest receives, the cinematic openings, the seating '
        + 'plan, the door app, pricing and the printed shop.',
  },
  { t: 'wait', ms: 1000 },
  { t: 'hideCaption' },
  { t: 'scrollTour', ms: 13000 },
  { t: 'wait', ms: 400 },
  { t: 'scroll', y: 0, ms: 2000 },

  {
    t: 'caption', eyebrow: 'Step two', title: 'Starting an account',
    body: 'Every path on the page ends at the same button. No card is asked for '
        + 'to make an account — payment happens later, once the event is built '
        + 'and a plan is chosen.',
  },
  { t: 'ring', sel: 'a[href="/register"]', pad: 8 },
  { t: 'wait', ms: 1200 },
  { t: 'unring' },
  /* A REAL click on a REAL link: the app navigates itself to /register. */
  { t: 'tap', sel: 'a[href="/register"]', ms: 900, settle: 2600 },
  { t: 'hideCursor' },
  { t: 'hideCaption' },
  { t: 'progress', frac: 0.10 },

  {
    t: 'caption', eyebrow: 'Step three', title: 'Create your account',
    body: 'Name, an optional organization, an email and a password, with Google '
        + 'sign-in beside it. The address is then confirmed with a six-digit '
        + 'code before anything else can happen.',
  },
  { t: 'wait', ms: 2400 },
  { t: 'hideCaption' },

  /* ── 2. Signing in ─────────────────────────────────────────────────── */
  { t: 'show', app: '/login', device: 'browser', url: 'fancyrsvp.com/login', settle: 2200 },
  { t: 'progress', frac: 0.14 },
  {
    t: 'caption', eyebrow: 'Step four', title: 'Signing in',
    body: 'The same two fields on every visit afterwards, with a reset link if '
        + 'the password is gone.',
  },
  { t: 'wait', ms: 1800 },
  { t: 'hideCaption' },

  /* ── 3. The dashboard ──────────────────────────────────────────────── */
  { t: 'titleShow', kicker: 'Part two', heading: 'The dashboard',
    sub: 'Where every event the organizer runs is kept.' },
  { t: 'show', app: '/dashboard', device: 'browser', url: 'fancyrsvp.com/dashboard', settle: 4000 },
  { t: 'tag', text: 'Part two &nbsp;<b>&middot;</b>&nbsp; The dashboard' },
  { t: 'progress', frac: 0.24 },
  { t: 'wait', ms: 800 },
  { t: 'titleHide' },

  {
    t: 'caption', eyebrow: 'Step five', title: 'Everything at a glance',
    body: 'Four events, three running right now, and 312 guests invited across '
        + 'them — <b>214 accepted, 38 declined, 60 still to answer</b>. The '
        + 'sidebar is the whole product: the guest list, the RSVP form, '
        + 'invitations, texting, seating and the door.',
  },
  { t: 'wait', ms: 3000 },
  { t: 'hideCaption' },
  { t: 'scrollTour', ms: 7000 },
  { t: 'scroll', y: 0, ms: 1600 },

  /* ── 4. Your events — a real click on a real link ──────────────────── */
  { t: 'tap', sel: NAV('events'), ms: 900, settle: 2600 },
  { t: 'progress', frac: 0.34 },
  {
    t: 'caption', eyebrow: 'Step six', title: 'Your events',
    body: 'Published events and unfinished drafts in one list. A draft is the '
        + 'one place an event can hide from its own owner, so it lives here '
        + 'rather than behind a separate tab.',
  },
  { t: 'wait', ms: 2200 },
  { t: 'hideCaption' },
  { t: 'scrollTour', ms: 6000 },
  { t: 'scroll', y: 0, ms: 1400 },

  /* ── 5. The guest list ─────────────────────────────────────────────── */
  { t: 'tap', sel: NAV('guests'), ms: 900, settle: 3000 },
  { t: 'progress', frac: 0.46 },
  {
    t: 'caption', eyebrow: 'Step seven', title: 'Who is invited',
    body: '<b>69 guests on 40 invitations</b> — 55 accepted, 6 declined, 8 still '
        + 'to answer. Each card carries the reply, the party, the meal chosen '
        + 'and the table. Guests are imported in bulk from a spreadsheet, never '
        + 'typed one at a time.',
    steps: [
      { text: 'Import CSV — the whole list in one upload' },
      { text: 'Assign a table without leaving the row' },
      { text: 'Download the list back out, re-importable' },
    ],
  },
  { t: 'wait', ms: 3000 },
  { t: 'hideCaption' },
  { t: 'scrollTour', ms: 10000 },
  { t: 'scroll', y: 0, ms: 1600 },

  /* ── 6. The RSVP form ──────────────────────────────────────────────── */
  { t: 'tap', sel: NAV('form-builder'), ms: 900, settle: 2600 },
  { t: 'progress', frac: 0.55 },
  {
    t: 'caption', eyebrow: 'Step eight', title: 'What you ask your guests',
    body: 'The reply form is the organizer\'s to shape: which questions are '
        + 'asked, which are required, and which only appear to a guest who said '
        + 'yes.',
  },
  { t: 'wait', ms: 2400 },
  { t: 'hideCaption' },
  { t: 'scrollTour', ms: 6000 },
  { t: 'scroll', y: 0, ms: 1400 },

  /* ── 7. Invitations, replies and texting ───────────────────────────── */
  { t: 'tap', sel: NAV('rsvps'), ms: 900, settle: 3000 },
  { t: 'progress', frac: 0.65 },
  {
    t: 'caption', eyebrow: 'Step nine', title: 'Invitations &amp; replies',
    body: 'Where invitations go out — by email, by text, or both — and where '
        + 'the answers come back. Texting is metered: the balance and what it '
        + 'covers are shown before a single message is sent.',
    steps: [
      { text: 'Send to one guest, a filtered group, or everyone' },
      { text: 'Only guests who agreed to texts are ever included' },
      { text: 'Every send is written to a ledger, once' },
    ],
  },
  { t: 'wait', ms: 3000 },
  { t: 'hideCaption' },
  { t: 'scrollTour', ms: 7000 },
  { t: 'scroll', y: 0, ms: 1400 },

  /* ── 8. The public link and the QR ─────────────────────────────────── */
  { t: 'tap', sel: NAV('share'), ms: 900, settle: 2800 },
  { t: 'progress', frac: 0.74 },
  {
    t: 'caption', eyebrow: 'Step ten', title: 'The link and the code',
    body: 'One public link, and the same link as a QR code at print resolution. '
        + 'Put the code on a printed invitation or on signage at the door — '
        + 'every scan lands on the event\'s own RSVP page.',
  },
  { t: 'wait', ms: 2600 },
  { t: 'hideCaption' },

  /* ── 9. Seating ────────────────────────────────────────────────────── */
  { t: 'tap', sel: NAV('seating'), ms: 900, settle: 3000 },
  { t: 'progress', frac: 0.84 },
  {
    t: 'caption', eyebrow: 'Step eleven', title: 'The room',
    body: 'Tables are placed on a real floor plan and guests are dragged onto '
        + 'them. The same plan prints as a paginated pack with an A–Z guest '
        + 'index, and the door app draws it on the tablet.',
  },
  { t: 'wait', ms: 2800 },
  { t: 'hideCaption' },
  { t: 'scrollTour', ms: 6000 },
  { t: 'scroll', y: 0, ms: 1400 },

  /* ── 10. What came back ────────────────────────────────────────────── */
  { t: 'show', app: '/dashboard/analytics', device: 'browser',
    url: 'fancyrsvp.com/dashboard/analytics', settle: 3600 },
  { t: 'progress', frac: 0.92 },
  {
    t: 'caption', eyebrow: 'Step twelve', title: 'Analytics',
    body: '<b>55 confirmed guests across 26 parties</b>, from 512 invitation '
        + 'views by 318 people — an 80% reply rate. The envelope has its own '
        + 'funnel: 93% broke the seal, taking 4.2 seconds to decide.',
  },
  { t: 'wait', ms: 2800 },
  { t: 'hideCaption' },
  { t: 'scrollTour', ms: 9000 },
  { t: 'scroll', y: 0, ms: 1600 },

  /* ── 11. The account ───────────────────────────────────────────────── */
  { t: 'tap', sel: NAV('profile'), ms: 900, settle: 2800 },
  { t: 'progress', frac: 1 },
  {
    t: 'caption', eyebrow: 'Step thirteen', title: 'The account',
    body: 'Contact details, the plan in force and the events it covers. Nothing '
        + 'about a single event lives here — this is about the organizer.',
  },
  { t: 'wait', ms: 2400 },
  { t: 'hideCursor' },
  { t: 'hideCaption' },

  /* titleShow, not title: `title` dismisses its own card, and record.js holds
     the recording open for another 900ms afterwards — which would hand the
     last second of the film back to whatever screen was underneath. */
  { t: 'titleShow',
    kicker: 'Next',
    heading: 'The guest journey',
    sub: 'The sealed invitation &middot; the reply &middot; the entry pass &middot; the door' },
  { t: 'wait', ms: 2000 },
];
