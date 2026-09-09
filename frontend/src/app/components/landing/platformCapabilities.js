/* ═══════════════════════════════════════════════════════════════════════════
   WHAT THIS PLATFORM DOES — one list, read by both pages that claim to say so.

   WHY THIS FILE EXISTS

   These thirteen entries used to live inside `features/page.js` as a local
   `const features = [...]`. That meant the /features page was the only place
   on the site that knew what the product does — and the HOMEPAGE, the page a
   visitor actually lands on, named not one of them. It talked about "elegant
   RSVPs" and then showed a hand-drawn picture of a dashboard. Someone could
   read the entire front page and never learn that this thing does seating
   charts, runs the door on a tablet with no internet, sends SMS, or lays an
   invitation out right-to-left in Arabic.

   Lifting the list here fixes that in the only way that stays fixed: the
   homepage grid and the /features page now render the SAME array. Add a
   capability and it appears on both. Remove one and it can't linger on the
   front page advertising something that no longer ships.

   FIELDS

     key         stable id — used by the homepage to pick its eight, so
                 reordering or retitling an entry cannot silently change
                 which ones are featured.
     title       the name, shown on both pages.
     short       ONE line, ~10 words, for the homepage grid. Written to be
                 read in a glance next to twelve other cards.
     description the full paragraph, shown on /features only.
     link        optional — a capability with a page of its own.
     icon        48x48 line-art SVG, gold on transparent.

   `short` is deliberately not derived from `description`. A truncated
   paragraph reads like a truncated paragraph; these are written as captions.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Required, even though Next would inject it. The icons below are JSX
   evaluated at MODULE SCOPE, in this file's own scope — and the test runner
   compiles .js with esbuild's classic JSX transform, which emits
   React.createElement. Without this the whole module throws
   "React is not defined" the moment anything imports it, which took down
   every test that touches the homepage. */
import React from 'react';

export const CAPABILITIES = [
  {
    key: 'rsvp-forms',
    title: 'Custom RSVP Forms',
    short: 'Ask exactly what you need — no coding, no limits.',
    description:
      "Design stunning invitation forms with our intuitive drag & drop builder. Choose from elegant field types, custom validations, and conditional logic to create the perfect guest experience — no coding required.",
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <rect x="6" y="6" width="36" height="36" rx="4" stroke="#B8944F" strokeWidth="1.5" />
        <rect x="12" y="14" width="24" height="4" rx="2" stroke="#D7BE80" strokeWidth="1.2" />
        <rect x="12" y="22" width="24" height="4" rx="2" stroke="#D7BE80" strokeWidth="1.2" />
        <rect x="12" y="30" width="16" height="4" rx="2" stroke="#D7BE80" strokeWidth="1.2" />
        <circle cx="36" cy="36" r="8" fill="#B8944F" opacity="0.12" />
        <path d="M33 36L35.5 38.5L39 33" stroke="#B8944F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    key: 'guests',
    title: 'Guest Management',
    short: 'One list for every reply, plus-one and dietary note.',
    description:
      "Effortlessly track RSVPs, manage plus-ones, record dietary requirements, and organize guest lists with powerful filtering. Export guest data in one click and keep every detail at your fingertips.",
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <circle cx="20" cy="16" r="6" stroke="#B8944F" strokeWidth="1.5" />
        <path d="M8 38c0-6.627 5.373-12 12-12s12 5.373 12 12" stroke="#B8944F" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="34" cy="14" r="4" stroke="#D7BE80" strokeWidth="1.2" />
        <path d="M38 32c0-4.418-2.686-8-6-8" stroke="#D7BE80" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M14 42h12" stroke="#B8944F" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'seating',
    title: 'Seating Charts',
    short: 'Drag guests onto tables. It never lets you overbook.',
    description:
      "Create interactive, drag-and-drop seating arrangements that update in real time. Visualize table layouts, manage group dynamics, and ensure every guest feels perfectly placed at your event.",
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <circle cx="24" cy="24" r="10" stroke="#B8944F" strokeWidth="1.5" />
        <circle cx="24" cy="14" r="2.5" fill="#D7BE80" />
        <circle cx="24" cy="34" r="2.5" fill="#D7BE80" />
        <circle cx="14" cy="24" r="2.5" fill="#D7BE80" />
        <circle cx="34" cy="24" r="2.5" fill="#D7BE80" />
        <circle cx="17" cy="17" r="2" fill="#B8944F" opacity="0.4" />
        <circle cx="31" cy="31" r="2" fill="#B8944F" opacity="0.4" />
        <circle cx="31" cy="17" r="2" fill="#B8944F" opacity="0.4" />
        <circle cx="17" cy="31" r="2" fill="#B8944F" opacity="0.4" />
        <rect x="20" y="20" width="8" height="8" rx="2" stroke="#B8944F" strokeWidth="1" />
      </svg>
    ),
  },
  {
    key: 'analytics',
    title: 'Real-Time Analytics',
    short: 'Watch replies land, live, with no spreadsheet in sight.',
    description:
      "Monitor your event with a live dashboard featuring acceptance rates, response timelines, geographic breakdowns, and engagement metrics. Make data-driven decisions with beautiful, intuitive charts.",
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <rect x="8" y="28" width="6" height="12" rx="1" fill="#D7BE80" opacity="0.5" />
        <rect x="17" y="22" width="6" height="18" rx="1" fill="#D7BE80" opacity="0.7" />
        <rect x="26" y="16" width="6" height="24" rx="1" fill="#B8944F" opacity="0.6" />
        <rect x="35" y="10" width="6" height="30" rx="1" fill="#B8944F" opacity="0.85" />
        <path d="M8 8v32h34" stroke="#B8944F" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M12 30l8-8 6 4 10-14" stroke="#B8944F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="38" cy="12" r="3" stroke="#B8944F" strokeWidth="1" fill="none" />
      </svg>
    ),
  },
  {
    key: 'meals',
    title: 'Meal Tracking',
    short: 'Kitchen-ready counts by table, course or allergy.',
    description:
      "Collect dietary preferences, allergies, and meal selections with smart forms that adapt to your menu. Generate kitchen-ready reports sorted by table, course, or dietary category — stress-free catering starts here.",
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <ellipse cx="24" cy="32" rx="14" ry="4" stroke="#B8944F" strokeWidth="1.5" />
        <path d="M10 32V28c0-2.21 6.268-4 14-4s14 1.79 14 4v4" stroke="#B8944F" strokeWidth="1.5" />
        <path d="M24 12v8" stroke="#D7BE80" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M20 10c0 3 4 5 4 8" stroke="#D7BE80" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M28 10c0 3-4 5-4 8" stroke="#D7BE80" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="24" cy="8" r="2" fill="#B8944F" opacity="0.3" />
      </svg>
    ),
  },
  {
    key: 'themes',
    title: 'Custom Themes',
    short: 'Your colours, your type, your names — on every screen.',
    description:
      "Brand every touchpoint with your event's unique identity. Choose from curated designer templates or create your own with custom colors, typography, backgrounds, and animations that wow your guests.",
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <rect x="8" y="8" width="32" height="32" rx="4" stroke="#B8944F" strokeWidth="1.5" />
        <rect x="12" y="12" width="10" height="10" rx="2" fill="#B8944F" opacity="0.2" />
        <rect x="26" y="12" width="10" height="10" rx="2" fill="#D7BE80" opacity="0.3" />
        <rect x="12" y="26" width="10" height="10" rx="2" fill="#D7BE80" opacity="0.3" />
        <rect x="26" y="26" width="10" height="10" rx="2" fill="#B8944F" opacity="0.15" />
        <circle cx="17" cy="17" r="3" stroke="#B8944F" strokeWidth="1" />
        <path d="M28 14l6 6" stroke="#B8944F" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M34 14l-6 6" stroke="#B8944F" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'sms',
    title: 'SMS Campaigns',
    short: 'Text every guest at once. Failed sends are refunded.',
    description:
      "Reach every guest instantly with segmented bulk messaging and live delivery tracking. Credits are billed transparently per message and automatically refunded for anything that fails to deliver.",
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <path d="M40 24c0 8.837-7.163 16-16 16-2.761 0-5.361-.698-7.625-1.925L8 40l2.4-7.2C8.88 30.2 8 27.2 8 24 8 15.163 15.163 8 24 8s16 7.163 16 16z" stroke="#B8944F" strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="17" cy="24" r="1.8" fill="#B8944F" />
        <circle cx="24" cy="24" r="1.8" fill="#B8944F" />
        <circle cx="31" cy="24" r="1.8" fill="#B8944F" />
        <path d="M32 12l3 3" stroke="#D7BE80" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M36 9l2 2" stroke="#D7BE80" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
      </svg>
    ),
  },
  {
    key: 'checkin',
    title: 'QR Check-In',
    short: 'Scan guests in at the door — even with no signal.',
    // `link` is optional and only this entry carries one so far — the door app
    // is the one feature with enough behind it to need a page of its own.
    link: { href: '/checkin-app', label: 'See the door app' },
    description:
      "Every guest carries a personal, scannable ticket. Check them in with a camera scan or name search at the door, or let them arrive themselves — either way it syncs to your dashboard in real time. On the night, the dedicated Fancy Check-in tablet app runs the door with no internet at all.",
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <rect x="8" y="8" width="14" height="14" rx="2" stroke="#B8944F" strokeWidth="1.5" />
        <rect x="26" y="8" width="14" height="14" rx="2" stroke="#B8944F" strokeWidth="1.5" />
        <rect x="8" y="26" width="14" height="14" rx="2" stroke="#B8944F" strokeWidth="1.5" />
        <rect x="12" y="12" width="6" height="6" rx="1" fill="#B8944F" opacity="0.25" />
        <rect x="30" y="12" width="6" height="6" rx="1" fill="#B8944F" opacity="0.25" />
        <rect x="12" y="30" width="6" height="6" rx="1" fill="#B8944F" opacity="0.25" />
        <path d="M27 31l5 5 7-9" stroke="#D7BE80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    key: 'bilingual',
    title: 'Bilingual Invitations',
    short: 'English and Arabic, with a true right-to-left layout.',
    description:
      "Write your invitation title, description, and dress code in English and Arabic side by side. Guests get a genuine right-to-left layout, localized dates, and a one-tap language toggle.",
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <circle cx="24" cy="24" r="16" stroke="#B8944F" strokeWidth="1.5" />
        <ellipse cx="24" cy="24" rx="7" ry="16" stroke="#D7BE80" strokeWidth="1.2" />
        <path d="M8 24h32" stroke="#D7BE80" strokeWidth="1.2" />
        <path d="M10.5 16h27M10.5 32h27" stroke="#D7BE80" strokeWidth="1" opacity="0.6" />
      </svg>
    ),
  },
  {
    key: 'reveal',
    title: 'Cinematic Invitation Reveal',
    short: 'A tap-to-open sequence generated in your own colours.',
    description:
      "A tap-to-open wax seal sets the tone before guests even see your invite. It's a fully generated, personalized animation in your event's own colors and names — never a stock template.",
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <path d="M24 8l3.5 7.5L36 17l-6 6.5L31 32l-7-4-7 4 1-8.5L12 17l8.5-1.5L24 8z" stroke="#B8944F" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M18 32l-4 8 6-2 4 6 4-6 6 2-4-8" stroke="#D7BE80" strokeWidth="1.2" strokeLinejoin="round" />
        <circle cx="24" cy="20" r="3" stroke="#B8944F" strokeWidth="1" />
      </svg>
    ),
  },
  {
    key: 'reminders',
    title: 'Automated Reminders',
    short: 'Nudges, table numbers and your final headcount — sent for you.',
    description:
      "The platform emails itself — RSVP nudges as your deadline nears, event reminders that include each guest's table once seating is revealed, and an automatic final headcount plus post-event recap sent straight to you.",
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <rect x="6" y="12" width="26" height="20" rx="3" stroke="#B8944F" strokeWidth="1.5" />
        <path d="M6 14l13 10 13-10" stroke="#B8944F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="34" cy="30" r="9" fill="#FDFCF9" stroke="#D7BE80" strokeWidth="1.5" />
        <path d="M34 25v5l3.5 2" stroke="#B8944F" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    key: 'referrals',
    title: 'Referral Rewards',
    short: 'Bring another host, earn real credit on your account.',
    description:
      "Invite other hosts to Fancy RSVP and earn real account credit once they become a paying customer — tracked transparently in a ledger-based dashboard with your own referral code and live status on every referral.",
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <circle cx="14" cy="24" r="6" stroke="#B8944F" strokeWidth="1.5" />
        <circle cx="34" cy="24" r="6" stroke="#B8944F" strokeWidth="1.5" />
        <path d="M20 20h10a4 4 0 0 1 4 4" stroke="#D7BE80" strokeWidth="1.4" strokeLinecap="round" fill="none" />
        <path d="M31 17l3 3-3 3" stroke="#D7BE80" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M28 28H18a4 4 0 0 1-4-4" stroke="#D7BE80" strokeWidth="1.4" strokeLinecap="round" fill="none" />
        <path d="M17 31l-3-3 3-3" stroke="#D7BE80" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    ),
  },
  {
    key: 'seat-lookup',
    title: 'Private Seating Lookup',
    short: 'Guests find their own table without an account.',
    description:
      "Guests confirm their own seat with just their name and the last four digits of their phone number — no accounts, no guessing. Seating stays locked until your reveal time, and a search never confirms whether a name exists.",
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <circle cx="20" cy="20" r="12" stroke="#B8944F" strokeWidth="1.5" />
        <path d="M29 29l9 9" stroke="#B8944F" strokeWidth="1.8" strokeLinecap="round" />
        <rect x="15" y="17" width="10" height="8" rx="1.5" stroke="#D7BE80" strokeWidth="1.2" />
        <path d="M17 17v-2a3 3 0 0 1 6 0v2" stroke="#D7BE80" strokeWidth="1.2" fill="none" />
      </svg>
    ),
  },
];

/**
 * The eight the homepage draws as a flow, by `key`, IN THE ORDER THEY HAPPEN.
 *
 * ── Why the order changed on 2026-09-09 ──────────────────────────────────
 *
 * These eight used to be a list, and a list can be in any order — this one was
 * in rough order of importance (forms, guests, seating, door, SMS, analytics,
 * language, reminders). The homepage now draws them as a SEQUENCE with arrows
 * between them, under the heading "One event. One system.", and an arrow is a
 * claim: it says the thing on the left hands over to the thing on the right.
 *
 * So the order is now the order of an actual event — you send an invitation,
 * they reply, the reply becomes a guest with a meal, you seat them, they are
 * reminded, they arrive, and you read what happened. Two entries changed with
 * it: `sms` and `bilingual` left the eight, because neither is a step in that
 * sequence (one is a channel the reminders use, the other is a property of
 * every screen), and `reveal` and `meals` took their places, because both are.
 *
 * Nothing was demoted by that. Both are named further up the page in the bands
 * that are actually about them, and both appear by name in the strip under the
 * diagram — see REST_CAPABILITIES.
 *
 * By key, not by index, so reordering CAPABILITIES cannot silently swap which
 * eight the front page promotes.
 */
export const HOMEPAGE_CAPABILITY_KEYS = [
  'reveal',
  'rsvp-forms',
  'guests',
  'meals',
  'seating',
  'reminders',
  'checkin',
  'analytics',
];

/**
 * The name a capability goes by INSIDE THE DIAGRAM, where the full title does
 * not fit.
 *
 * A node in a flow is about 90px wide. "Cinematic Invitation Reveal" sets to
 * four lines there and stops being a diagram; "Invitation" is the same thing
 * said at the size the drawing has. This is a second NAME, not a second
 * SOURCE: the full title still comes from CAPABILITIES, is what /features
 * renders, and is what the strip under the diagram prints — so nothing here
 * can quietly rename a capability.
 *
 * Only the eight in the flow need one. A key with no entry falls back to its
 * title, which is the correct behaviour for a short one.
 */
export const FLOW_LABEL = {
  reveal: 'Invitation',
  'rsvp-forms': 'RSVP',
  guests: 'Guest list',
  meals: 'Meals',
  seating: 'Seating',
  reminders: 'Reminders',
  checkin: 'Check-in',
  analytics: 'Analytics',
};

/** The eight, resolved and in the order above. Throws at import time if a key
 *  stops matching — a silent `undefined` in this array would render a blank
 *  node on the front page rather than failing where someone would notice. */
export const HOMEPAGE_CAPABILITIES = HOMEPAGE_CAPABILITY_KEYS.map((key) => {
  const found = CAPABILITIES.find((c) => c.key === key);
  if (!found) throw new Error(`HOMEPAGE_CAPABILITY_KEYS names "${key}", which is not in CAPABILITIES`);
  return found;
});

/**
 * Everything that is NOT a step in the sequence — derived, never typed.
 *
 * These are printed by name under the diagram rather than hidden behind the
 * link to /features. The five include SMS campaigns and bilingual
 * invitations, and a front page that does not say those words has failed at
 * the one job this module exists for: before it, a visitor could read the
 * whole homepage and never learn that this product sends texts or lays out
 * Arabic right to left.
 */
export const REST_CAPABILITIES = CAPABILITIES.filter(
  (c) => !HOMEPAGE_CAPABILITY_KEYS.includes(c.key),
);

/** How many are NOT in the diagram — so the "and N more" link cannot go stale
 *  the next time a capability is added. */
export const REMAINING_CAPABILITY_COUNT = REST_CAPABILITIES.length;
