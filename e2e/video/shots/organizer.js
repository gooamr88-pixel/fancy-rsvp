/* ═══════════════════════════════════════════════════════════════════════════
   THE ORGANIZER'S JOURNEY.

   Part one   Finding Fancy      landing page, sign-up, sign-in
   Part two   Creating an event  the template wizard, the plan and payment
   Part three The dashboard      the overview, the events list
   Part four  Guests             the list, invitations and texting, link and QR
   Part five  Seating            the room
   Part six   Analytics          what came back, and the account

   Every screen is the component that actually ships, rendering ONE consistent
   event: "Nadia & Omar" — 40 invitations, 69 guests, 26 parties attending,
   22 of them seated, 34 opted in to texts, an 80% reply rate. The same figures
   hold on every screen because they come from one fixture, and every caption
   quotes the number that is on the screen beside it.

   Screens, and where each is staged:
     landing/stage/page.html            landingPageProbe.dump.jsx
     landing/stage/dash-overview.html   landingShots.dump.jsx
     landing/stage/dash-seating.html    landingShots.dump.jsx
     video/stage/organizer/*.html       videoOrganizer.dump.jsx
       register · login · templates · payment · events · guests · rsvps ·
       share · analytics · profile

   STILL TO STAGE, and deliberately not faked in the meantime: the guest's own
   journey (its own chapter), and the door app's QR scan.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const S = (n) => `video/stage/organizer/${n}.html`;
const LANDING = 'landing/stage/page.html';
const DASH    = 'landing/stage/dash-overview.html';
const SEATING = 'landing/stage/dash-seating.html';
const W = 'browser';

/** A chapter marker: title card up, next screen loaded behind it, title away. */
const part = (kicker, heading, sub, screen, opts, tag, frac) => [
  { t: 'titleShow', kicker, heading, sub },
  { t: 'show', screen, device: W, settle: 800, ...opts },
  { t: 'tag', text: tag },
  { t: 'progress', frac },
  { t: 'wait', ms: 700 },
  { t: 'titleHide' },
];

module.exports = [
  /* A short hold, not a pause. record.js trims the browser's startup off the
     head with a measured number that is close but not exact; this is the slack
     that absorbs the difference in both directions. */
  { t: 'wait', ms: 450 },

  ...part(
    'A complete walkthrough', 'Fancy',
    'Everything an organizer does, from the home page to the door — screen by screen.',
    LANDING, { url: 'fancyrsvp.com' },
    'Part one &nbsp;<b>&middot;</b>&nbsp; Finding Fancy', 0.04,
  ),

  /* ── 1. The home page ──────────────────────────────────────────────── */
  {
    t: 'caption', eyebrow: 'Step one', title: 'The home page',
    body: 'Where an organizer arrives. The page explains the product in nine '
        + 'bands — what the guest receives, the cinematic openings, the seating '
        + 'plan, the door app, pricing and the printed shop.',
  },
  { t: 'wait', ms: 1000 },
  { t: 'hideCaption' },
  { t: 'scrollTour', ms: 14000 },
  { t: 'wait', ms: 400 },
  { t: 'scroll', y: 0, ms: 2200 },

  {
    t: 'caption', eyebrow: 'Step two', title: 'Starting an account',
    body: 'Every path on the page ends at the same button. No card is asked for '
        + 'to make an account — payment happens later, once the event is built '
        + 'and a plan is chosen.',
  },
  { t: 'move', sel: 'a[href="/register"]', ms: 800 },
  { t: 'ring', sel: 'a[href="/register"]', pad: 8 },
  { t: 'wait', ms: 1000 },
  { t: 'click' },
  { t: 'unring' },
  { t: 'hideCursor' },
  { t: 'hideCaption' },

  /* ── 2. Sign up ────────────────────────────────────────────────────── */
  { t: 'show', screen: S('register'), device: W, url: 'fancyrsvp.com/register', settle: 700 },
  { t: 'progress', frac: 0.10 },
  {
    t: 'caption', eyebrow: 'Step three', title: 'Create your account',
    body: 'Name, an optional organization, an email and a password. Google '
        + 'sign-in sits beside it. The address is then confirmed with a '
        + 'six-digit code before anything else can happen.',
    steps: [
      { text: 'First and last name' },
      { text: 'Email — this is where replies are reported' },
      { text: 'A password of at least eight characters' },
    ],
  },
  { t: 'wait', ms: 2600 },
  { t: 'hideCaption' },

  /* ── 3. Sign in ────────────────────────────────────────────────────── */
  { t: 'show', screen: S('login'), device: W, url: 'fancyrsvp.com/login', settle: 700 },
  { t: 'progress', frac: 0.14 },
  {
    t: 'caption', eyebrow: 'Step four', title: 'Signing in',
    body: 'The same two fields on every visit afterwards, with a reset link if '
        + 'the password is gone.',
  },
  { t: 'wait', ms: 1800 },
  { t: 'hideCaption' },

  /* ── 3b. Building the event ────────────────────────────────────────── */
  ...part(
    'Part two', 'Building the event', 'Pick how the invitation opens, then pay once for the event.',
    S('templates'), { url: 'fancyrsvp.com/dashboard/create-event' },
    'Part two &nbsp;<b>&middot;</b>&nbsp; Creating an event', 0.18,
  ),
  {
    t: 'caption', eyebrow: 'Step five', title: 'Choosing the invitation',
    body: 'The wizard opens on the templates. Each one is a different way the '
        + 'invitation arrives — a wax seal that breaks, a door that is knocked, '
        + 'a velvet box that opens. A colour palette is picked beside it, and a '
        + 'live phone preview shows the result while it is chosen.',
  },
  { t: 'wait', ms: 2600 },
  { t: 'hideCaption' },
  { t: 'scrollTour', ms: 8000 },
  { t: 'wait', ms: 400 },

  { t: 'show', screen: S('payment'), device: W, url: 'fancyrsvp.com/dashboard/create-event', settle: 700 },
  { t: 'progress', frac: 0.22 },
  {
    t: 'caption', eyebrow: 'Step six', title: 'Paying for the event',
    body: 'Six plans, priced <b>per event and not per month</b>. The plan sets '
        + 'the guest cap and which features unlock. The event stays a private '
        + 'draft until it is paid for — and it can be skipped and paid later.',
    steps: [
      { text: 'Free up to 100 guests, Premium at $149 for 300' },
      { text: 'Card, or a bank transfer verified by reference' },
      { text: 'Text-message credits added on the same screen' },
    ],
  },
  { t: 'wait', ms: 3000 },
  { t: 'hideCaption' },
  { t: 'scrollTour', ms: 7000 },
  { t: 'wait', ms: 400 },

  /* ── 4. The dashboard ──────────────────────────────────────────────── */
  ...part(
    'Part three', 'The dashboard', 'Where every event the organizer runs is kept.',
    DASH, { url: 'fancyrsvp.com/dashboard' },
    'Part three &nbsp;<b>&middot;</b>&nbsp; The dashboard', 0.24,
  ),
  {
    t: 'caption', eyebrow: 'Step seven', title: 'Everything at a glance',
    /* Every figure quoted here is READ OFF THE SCREEN behind it. A caption that
       rounds or paraphrases the number beside it is the one error a viewer can
       catch without knowing the product at all. */
    body: 'Four events, two of them running right now, and 312 guests invited '
        + 'across them — <b>214 accepted, 38 declined, 60 still to answer</b>. '
        + 'Every number is drawn by the same components the organizer sees '
        + 'after signing in.',
    steps: [
      { text: 'Stat cards — events, guests, reply rate, arrivals' },
      { text: 'Upcoming events, each with its date and venue' },
      { text: 'Recent activity — every reply as it lands' },
    ],
  },
  { t: 'wait', ms: 2600 },
  { t: 'hideCaption' },
  { t: 'scrollTour', ms: 8000 },
  { t: 'wait', ms: 500 },

  /* ── 5. Your events ────────────────────────────────────────────────── */
  { t: 'show', screen: S('events'), device: W, url: 'fancyrsvp.com/dashboard?tab=events', settle: 700 },
  { t: 'progress', frac: 0.32 },
  {
    t: 'caption', eyebrow: 'Step eight', title: 'Your events',
    body: 'Published events and unfinished drafts in one list. A draft is the '
        + 'one place an event can hide from its own owner, so it lives here '
        + 'rather than behind a separate tab.',
  },
  { t: 'wait', ms: 2000 },
  { t: 'hideCaption' },
  { t: 'scrollTour', ms: 7000 },

  /* ── 6. The guest list ─────────────────────────────────────────────── */
  ...part(
    'Part four', 'The guest list', 'Forty invitations. Sixty-nine people.',
    S('guests'), { url: 'fancyrsvp.com/dashboard?tab=guests' },
    'Part four &nbsp;<b>&middot;</b>&nbsp; Guests &amp; invitations', 0.44,
  ),
  {
    t: 'caption', eyebrow: 'Step nine', title: 'Who is invited',
    body: '<b>69 guests on 40 invitations</b> — 55 accepted, 6 declined, 8 still '
        + 'to answer. Each card carries the reply, the party, the meal chosen '
        + 'and the table. A guest is imported in bulk from a spreadsheet, never '
        + 'typed one at a time.',
    steps: [
      { text: 'Import CSV — the whole list in one upload' },
      { text: 'Assign a table without leaving the row' },
      { text: 'Download the list back out, re-importable' },
    ],
  },
  { t: 'wait', ms: 2800 },
  { t: 'hideCaption' },
  { t: 'scrollTour', ms: 11000 },
  { t: 'wait', ms: 400 },
  { t: 'scroll', y: 0, ms: 1800 },

  /* ── 7. Invitations, replies and texting ───────────────────────────── */
  { t: 'show', screen: S('rsvps'), device: W, url: 'fancyrsvp.com/dashboard?tab=rsvps', settle: 700 },
  { t: 'progress', frac: 0.60 },
  {
    t: 'caption', eyebrow: 'Step ten', title: 'Invitations &amp; replies',
    body: 'Where invitations go out — by email, by text, or both — and where '
        + 'the answers come back. Texting is metered: the balance and what it '
        + 'covers are shown before a single message is sent.',
    steps: [
      { text: 'Send to one guest, a filtered group, or everyone' },
      { text: 'Only guests who agreed to texts are ever included' },
      { text: 'Every send is written to a ledger, once' },
    ],
  },
  { t: 'wait', ms: 2800 },
  { t: 'hideCaption' },
  { t: 'scrollTour', ms: 8000 },

  /* ── 8. The public link and the QR ─────────────────────────────────── */
  { t: 'show', screen: S('share'), device: W, height: 520,
    url: 'fancyrsvp.com/dashboard?tab=share', settle: 700 },
  { t: 'progress', frac: 0.72 },
  {
    t: 'caption', eyebrow: 'Step eleven', title: 'The link and the code',
    body: 'One public link, and the same link as a QR code at print resolution. '
        + 'Put the code on a printed invitation or on signage at the door — '
        + 'every scan lands on the event\'s own RSVP page.',
  },
  { t: 'move', sel: 'img[alt*="QR" i], canvas, img[src^="data:image"]', ms: 800 },
  { t: 'ring', sel: 'img[src^="data:image"]', pad: 10 },
  { t: 'wait', ms: 2000 },
  { t: 'unring' },
  { t: 'hideCursor' },
  { t: 'hideCaption' },

  /* ── 9. The room ───────────────────────────────────────────────────── */
  ...part(
    'Part five', 'The room', 'A head table, ten rounds, and every guest given a chair.',
    SEATING, { width: 760, height: 560, url: 'fancyrsvp.com/dashboard/seating-map' },
    'Part five &nbsp;<b>&middot;</b>&nbsp; Seating', 0.84,
  ),
  {
    t: 'caption', eyebrow: 'Step twelve', title: 'The seating plan',
    body: 'Tables are placed on a real floor plan — the dance floor, the stage, '
        + 'the bar — and guests are dragged onto them. The same plan prints as a '
        + 'paginated pack with an A–Z guest index, and the door app draws it on '
        + 'the tablet.',
  },
  { t: 'wait', ms: 2800 },
  { t: 'hideCaption' },

  /* ── 9b. What came back ────────────────────────────────────────────── */
  ...part(
    'Part six', 'What came back', 'The event, measured.',
    S('analytics'), { url: 'fancyrsvp.com/dashboard/analytics' },
    'Part six &nbsp;<b>&middot;</b>&nbsp; Analytics', 0.90,
  ),
  {
    t: 'caption', eyebrow: 'Step thirteen', title: 'Analytics',
    /* Every figure is the same event as the guest list: 55 people on 26
       accepted invitations, 8 unanswered. A film whose analytics disagree with
       its own guest list is a film nobody believes. */
    body: '<b>55 confirmed guests across 26 parties</b>, from 512 invitation '
        + 'views by 318 people — an 80% reply rate. The envelope has its own '
        + 'funnel: 93% broke the seal, taking 4.2 seconds to decide.',
    steps: [
      { text: 'Where guests fell out of the RSVP form' },
      { text: 'What they did — directions, calendar, seating, sharing' },
      { text: 'Where the traffic came from, and on which days' },
    ],
  },
  { t: 'wait', ms: 3000 },
  { t: 'hideCaption' },
  { t: 'scrollTour', ms: 10000 },
  { t: 'wait', ms: 400 },

  /* ── 10. The profile ───────────────────────────────────────────────── */
  { t: 'show', screen: S('profile'), device: W, url: 'fancyrsvp.com/dashboard?tab=profile', settle: 700 },
  { t: 'progress', frac: 0.96 },
  {
    t: 'caption', eyebrow: 'Step fourteen', title: 'The account',
    body: 'Contact details, the plan in force, the events it covers, and the '
        + 'controls for leaving. Nothing about an event lives here — this is '
        + 'about the organizer.',
  },
  { t: 'wait', ms: 2200 },
  { t: 'hideCaption' },
  { t: 'scrollTour', ms: 7000 },

  /* Held card, not a dismissed one: `title` dismisses its own card, and
     record.js keeps the recording open for another 900ms so a chapter never
     ends on a hard cut — which would hand the last second back to whatever
     screen was underneath. */
  { t: 'progress', frac: 1 },
  { t: 'titleShow',
    kicker: 'Still to come',
    heading: 'The guest journey follows',
    sub: 'The sealed invitation &middot; the reply &middot; the QR pass &middot; the door app' },
  { t: 'wait', ms: 2000 },
];
