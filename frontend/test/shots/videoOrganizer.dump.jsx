/* ═══════════════════════════════════════════════════════════════════════════
   THE ORGANIZER'S JOURNEY — screens staged for the walkthrough video.

   Every frame is the component that actually ships, rendering real-shaped
   data. The couple, the guests and the numbers are sample data the way any
   demo's are; every pixel around them is drawn by the product.

   ── Running it ───────────────────────────────────────────────────────────
     cd frontend
     npx next build                                    # once; supplies the CSS
     npx vitest run --config vitest.shots.config.mjs test/shots/videoOrganizer.dump.jsx
     node ../e2e/video/record.js organizer --verify    # contact sheet first
     node ../e2e/video/record.js organizer             # then the video

   Output: .visual/video/stage/organizer/*.html   (git-ignored)

   NOTE ON THE FILE NAME: it lives in test/shots/ rather than a video/
   subfolder on purpose. vitest.shots.config.mjs includes exactly
   'test/shots/*.dump.jsx' — one level, no glob star — so a subfolder would be
   collected by nothing and stage silently.
   ═══════════════════════════════════════════════════════════════════════════ */
/**
 * The share panel derives its public link and its QR from
 * `window.location.origin`, so under the harness's default jsdom URL the film
 * would show an organizer being told to hand their guests `localhost:3000`.
 * Setting the document's URL makes the component compute the right link
 * itself, rather than the staged HTML being patched afterwards.
 *
 * @vitest-environment-options { "url": "https://fancyrsvp.com/dashboard" }
 */
import React from 'react';
import { describe, it, vi, beforeAll, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { stageScreen, settle } from './videoStage';

/* Reduced motion would skip the entrances these screens are partly about. */
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useReducedMotion: () => false };
});

/* App Router hooks do not exist outside a Next render. Every auth and
   dashboard screen reaches for the router on mount. */
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: () => {}, replace: () => {}, back: () => {},
    forward: () => {}, refresh: () => {}, prefetch: () => {},
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(''),
  redirect: () => {},
}));

/* The one network boundary these screens have, mocked at the module edge so
   the components under the camera are untouched.

   PATH-AWARE, and that is the difference between a full screen and an empty
   one: the analytics page fetches `/events` and then
   `/events/:id/analytics`, and a mock that answers `{}` to everything renders
   a page of zeroes and empty states — which a viewer reads as "this product
   has no analytics", not as "the harness returned nothing". */
vi.mock('../../src/app/utils/apiClient', () => ({
  apiFetch: vi.fn(async (path) => {
    /* Both responses are WRAPPED, and unwrapped defensively by the page:
       `res?.events || res?.data || []` and `res?.analytics || null`. Returning
       the bare array or the bare payload leaves the page on "No events yet"
       and "Create an event to start collecting analytics" — an empty state
       that looks like the product, not like the mock. */
    if (/\/analytics/.test(path)) return { analytics: globalThis.__ANALYTICS__ };
    if (/^\/events\/?$/.test(path)) return { events: globalThis.__EVENTS__ };
    return {};
  }),
  logout: vi.fn(async () => {}),
  API_URL: 'http://localhost:5000/api/v1',
  API_BASE_URL: 'http://localhost:5000',
}));

import RegisterPage from '../../src/app/(auth)/register/page';
import LoginPage from '../../src/app/(auth)/login/page';
import EventsTab from '../../src/app/dashboard/components/EventsTab';
import GuestsTab from '../../src/app/dashboard/components/GuestsTab';
import RSVPsTab from '../../src/app/dashboard/components/RSVPsTab';
import EventSharePanel from '../../src/app/dashboard/components/EventSharePanel';
import OrganizerProfile from '../../src/app/dashboard/components/OrganizerProfile';
import Stage1_TemplatesSimulator from '../../src/app/dashboard/create-event/components/Stage1_TemplatesSimulator';
import StagePayment from '../../src/app/dashboard/create-event/components/StagePayment';
import AnalyticsPage from '../../src/app/dashboard/analytics/page';
/* The real curated list, not a hand-typed copy of it. Retire a template and
   re-run this, and the film follows. */
import { TEMPLATES } from '../../src/app/utils/curatedTemplates';

/* ── The event ───────────────────────────────────────────────────────────
   Shaped like a row of `events` as the dashboard reads it: snake_case, with
   template_data nested. Deliberately COMPLETE — a half-filled event renders
   half-empty panels, and an empty screen teaches nobody anything. */
const EVENT = {
  id: 'evt-nadia-omar',
  slug: 'nadia-and-omar',
  title: 'Nadia & Omar',
  event_type: 'wedding',
  template_type: 'swans',
  status: 'published',
  /* A REAL INSTANT, read back in the organizer's zone. The venue is in
     Alexandria, so the zone is Cairo: 16:30Z renders as 6:30 PM on the
     pass and the invitation. With the harness's Los_Angeles default the
     same instant printed "11:30 AM" on a wedding pass for a venue eleven
     hours away — true to the data and obviously wrong to a viewer. */
  event_date: '2027-05-14T16:30:00.000Z',
  timezone: 'Africa/Cairo',
  venue_name: 'Beit Al Qamar',
  venue_address: '12 Corniche Road, Alexandria',
  guest_limit: 400,
  max_party_size: 8,
  rsvp_deadline: '2027-04-20',
  privacy_mode: 'public',
  is_paid: true,
  plan_key: 'signature',
  collect_dietary_restrictions: true,
  no_kids_allowed: true,
  allow_guest_edits: true,
  custom_colors: { primary: '#7a2f3a', accent: '#c9a45c', background: '#f6f1e4' },
  template_data: {
    groom_name: 'Omar', bride_name: 'Nadia',
    meal_options: ['Beef Short Rib', 'Sea Bass', 'Wild Mushroom Risotto'],
  },
};

/* ── The room ────────────────────────────────────────────────────────────
   `table_name`, not `name` — the two are NOT interchangeable and the wrong
   one renders a chart of unlabelled circles. */
const TABLES = [
  { id: 't-head', table_name: 'Head Table',  max_capacity: 10, occupied: 10 },
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `t-${i + 1}`,
    table_name: `Table ${i + 1}`,
    max_capacity: 10,
    occupied: [10, 9, 10, 8, 10, 7, 10, 9, 6, 8][i],
  })),
];

/* ── The guest list ──────────────────────────────────────────────────────
   Forty parties, mixed the way a real list is mixed: most answered, some
   still pending, a few declined, party sizes from one to five, meals chosen,
   most seated and a handful not. Generated rather than typed so the ratios
   are deliberate and the names do not repeat. */
const FIRST = ['Nour', 'Karim', 'Yasmin', 'Tarek', 'Layla', 'Adam', 'Mira', 'Hadi',
  'Rana', 'Sami', 'Dina', 'Fares', 'Salma', 'Ziad', 'Maya', 'Omar',
  'Lina', 'Rami', 'Hana', 'Basel', 'Jana', 'Nabil', 'Reem', 'Tamer',
  'Aya', 'Wissam', 'Farah', 'Marwan', 'Leila', 'Hisham', 'Noor', 'Kamal',
  'Zeina', 'Amir', 'Nadine', 'Yousef', 'Rima', 'Habib', 'Sara', 'Elias'];
const LAST = ['Haddad', 'Khoury', 'Nassar', 'Aziz', 'Barakat', 'Chalhoub', 'Daher',
  'Fakhoury', 'Ghanem', 'Hakim', 'Ibrahim', 'Jaber', 'Karam', 'Labaki',
  'Mansour', 'Najjar', 'Osman', 'Rahal', 'Saad', 'Tannous'];
const MEALS = ['Beef Short Rib', 'Sea Bass', 'Wild Mushroom Risotto'];

const RSVPS = Array.from({ length: 40 }, (_, i) => {
  // 26 attending, 6 declined, 8 still to answer — a believable mid-campaign list.
  const response = i < 26 ? 'yes' : i < 32 ? 'no' : 'pending';
  const attending = response === 'yes';
  const party = attending ? [1, 2, 2, 1, 3, 2, 1, 4, 2, 1, 2, 5][i % 12] : 1;
  const table = attending && i < 22 ? TABLES[(i % 10) + 1] : null;
  const name = `${FIRST[i]} ${LAST[i % LAST.length]}`;
  return {
    id: `g-${i + 1}`,
    guest_name: name,
    email: `${FIRST[i].toLowerCase()}.${LAST[i % LAST.length].toLowerCase()}@example.com`,
    phone: `+1415555${String(1000 + i).slice(-4)}`,
    response: response === 'pending' ? null : response,
    party_size: party,
    meal: attending ? MEALS[i % 3] : null,
    side: i % 2 ? 'Nadia' : 'Omar',
    notes: i === 4 ? 'Wheelchair access, please seat near the door' : '',

    /* THREE FIELD NAMES THAT ARE NOT NEGOTIABLE, each found the hard way by
       staging the screen and reading it:

         tableId   — camelCase. GuestsTab's assignment <select> reads
                     `guest.tableId`; with the snake_case `table_id` every row
                     in a fully seated event rendered "No Table".
         guests    — the PARTY table, one row per person INCLUDING the primary
                     contact, each `{ full_name, is_primary_contact }`. A row
                     without `full_name` prints "Unnamed guest".
         sms_consent — what the texting badge reads. Without it every guest is
                     labelled "hasn't agreed to texts" and the messaging
                     chapter contradicts itself. */
    table,
    tableId: table ? table.id : null,
    guests: attending
      ? [
          { full_name: name, is_primary_contact: true },
          ...Array.from({ length: party - 1 }, (_, k) => ({
            full_name: `${FIRST[(i + k + 7) % 40]} ${LAST[(i + k + 3) % LAST.length]}`,
            is_primary_contact: false,
          })),
        ]
      : [],

    // 34 of 40 opted in — enough that texting works, not so many that the
    // "some guests cannot be texted" rule looks like it never applies.
    sms_consent: i < 34,
    sms_consent_at: i < 34 ? '2027-03-08T10:12:00.000Z' : null,
    sms_consent_method: i < 34 ? 'guest_opt_in' : null,

    custom: {},
    invitation_sent: i < 34,
    qr_token: `tok-${i + 1}`,
    created_at: new Date(Date.UTC(2027, 2, 1 + (i % 26), 9, 0)).toISOString(),
  };
});

/* Four events, so "Your events" is a list and not a single card. */
const EVENTS = [
  { ...EVENT, guest_count: 40, rsvp_count: 32 },
  { id: 'evt-2', slug: 'aria-and-julian', title: 'Aria & Julian', event_type: 'wedding',
    template_type: 'ring', status: 'published', event_date: '2026-09-12T19:00:00.000Z',
    venue_name: 'Rosewood Hall', timezone: 'America/Los_Angeles', is_paid: true,
    guest_count: 186, rsvp_count: 154, template_data: {} },
  { id: 'evt-3', slug: 'haddad-anniversary', title: 'Forty Years — Haddad', event_type: 'anniversary',
    template_type: 'bab', status: 'published', event_date: '2026-11-02T17:30:00.000Z',
    venue_name: 'The Orangery', timezone: 'America/Los_Angeles', is_paid: true,
    guest_count: 64, rsvp_count: 61, template_data: {} },
  { id: 'evt-4', slug: 'salma-graduation', title: "Salma's Graduation", event_type: 'graduation',
    template_type: 'letter', status: 'draft', event_date: '2027-06-20T16:00:00.000Z',
    venue_name: '', timezone: 'America/Los_Angeles', is_paid: false,
    guest_count: 22, rsvp_count: 0, template_data: {} },
];

/* Every paid feature on, so nothing renders as a locked stub. The film is
   about what the product does, not about what a free plan withholds.

   A PLAIN ARRAY OF KEY STRINGS, and it has to be. This was
   `new Proxy({}, { get: () => true })`, which answers true to any property
   and looks like it unlocks everything — but FeatureGate's first line is
   `Array.isArray(tierFeatures) ? tierFeatures : []`, and a Proxy over an
   object is not an array. It collapsed to empty, so every gated control in
   the staged Guests screen filmed with a padlock on it: the exact opposite
   of what the comment above promised. */
const TIER_FEATURES = [
  'rsvp_custom_fields', 'import_guests_csv', 'guest_export_csv', 'guest_export_excel',
  'seating_map', 'table_management', 'custom_branding', 'sms_campaigns',
  'add_guest_manual', 'qr_checkin', 'manual_checkin', 'analytics_advanced',
];

/* ── The plans ───────────────────────────────────────────────────────────
   SIX, which is what the live site runs. `pricing_tiers` is a JSONB column an
   admin edits: the schema seeds three, an earlier probe here was written with
   four, and fancyrsvp.com is serving six. The count is not cosmetic — the
   plan grid picks an .fx-grid--N preset from `plans.length`, and each preset
   carries a different --fx-col, so a four-plan capture is of a page the
   organizer does not have. Kept in step with test/shots/pricingProbe.dump.jsx. */
const F = {
  rsvpBasic: 'RSVP tracking', analytics: 'Basic analytics', email: 'Email invitations',
  community: 'Community support', manualGuest: 'Add guests manually',
  customFields: 'Custom RSVP questions', csvIn: 'Guest import (CSV)',
  csvOut: 'Guest export (CSV)', seating: 'Seating plan', tables: 'Table management',
  branding: 'Custom themes & branding', sms: 'Text messaging',
  qr: 'QR code check-in', manualCheckin: 'Manual check-in',
  checkinApp: 'Fancy Check-in app (offline door scanner)', excel: 'Guest export (Excel)',
  watermark: 'Remove Fancy watermark', analyticsPro: 'Real-time analytics & reports',
  priority: 'Priority email & chat support', whiteLabel: 'White-label solution',
  dedicated: 'Dedicated account manager', integrations: 'All integrations',
  api: 'Custom integrations & API', sso: 'SSO & team management',
  security: 'Advanced security & compliance',
};
const ESSENTIAL = [F.rsvpBasic, F.analytics, F.email, F.community, F.manualGuest];
const SIGNATURE = [...ESSENTIAL, F.customFields, F.csvIn, F.csvOut, F.seating, F.tables, F.branding, F.sms];
const ENTERPRISE = [...SIGNATURE, F.qr, F.manualCheckin, F.checkinApp, F.excel, F.watermark, F.analyticsPro, F.priority];
const BESPOKE = [...ENTERPRISE, F.whiteLabel, F.dedicated, F.integrations, F.api, F.sso, F.security];

const TIERS = [
  { name: 'Free', price_cents: 0, currency: 'USD', max_guests: 100, is_custom: false, description: 'Try it on a small list', features: ESSENTIAL.slice(0, 3) },
  { name: 'Classic', price_cents: 7500, currency: 'USD', max_guests: 150, is_custom: false, description: 'For an intimate celebration', features: ESSENTIAL },
  { name: 'Premium', price_cents: 14900, currency: 'USD', max_guests: 300, is_custom: false, recommended: true, description: 'The one most couples choose', features: SIGNATURE },
  { name: 'Enterprise', price_cents: 29900, currency: 'USD', max_guests: 1000, is_custom: false, description: 'For a large or multi-day event', features: ENTERPRISE },
  { name: 'Enterprise+', price_cents: 59900, currency: 'USD', max_guests: 3000, is_custom: false, description: 'Several thousand guests', features: ENTERPRISE },
  { name: 'Bespoke', price_cents: null, currency: 'USD', max_guests: null, is_custom: true, description: 'Built around your event', features: BESPOKE },
];

/* ── Analytics ───────────────────────────────────────────────────────────
   The counts are the SAME event the guest list shows: 26 invitations
   accepted, 6 declined, 8 unanswered, on 40 sent. A film whose analytics
   page disagrees with its own guest list is a film nobody believes. */
const ANALYTICS = {
  advanced: true,
  rangeApplied: false,

  /* EXACT KEY NAMES, read off analytics/page.js rather than guessed. The first
     attempt used `views`, `responseRate` and a funnel of {label,value}; the
     page reads `totalPageViews`, `conversionRate` and {step,count,dropOff}, so
     the hero tiles rendered 0 and both funnels said "nothing in this range
     yet" — an empty state that reads as a product with no analytics. */
  overview: {
    totalHeadcount: 55,          // people confirmed, not parties
    attendingCount: 26,          // parties
    maybeCount: 0,
    declinedCount: 6,
    pendingCount: 8,
    totalPageViews: 512,
    uniqueVisitors: 318,
    totalRsvps: 32,
    conversionRate: 80,
  },

  /* The envelope: shown → opened, with the ones who skipped or failed. */
  reveal: {
    shown: 318, opened: 296, skipped: 18, failed: 4,
    openRate: 93, medianMsToOpen: 4200,
  },

  funnel: [
    { step: 'Opened the invitation', count: 318, dropOff: null },
    { step: 'Reached the RSVP',      count: 214, dropOff: 33 },
    { step: 'Started a reply',       count: 41,  dropOff: 81 },
    { step: 'Submitted',             count: 32,  dropOff: 22 },
  ],

  /* THE BACKEND'S OWN ACTION KEYS, from analyticsController's ACTION_TYPES.
     analytics/page.js maps them to sentences through ENGAGEMENT_LABELS and
     falls through to the RAW KEY when it does not recognise one — so an
     invented name does not error, it just films a chart labelled
     "saved_the_date". Which is what this fixture used to do, for all six. */
  engagementActions: {
    calendar_added: 112, directions_clicked: 96, guest_pass_downloaded: 74,
    gallery_viewed: 61, share_clicked: 38, music_played: 27,
  },
  declineReasons: { travel: 3, conflict: 2, other: 1 },
  sources: { direct: 141, whatsapp: 96, email: 58, sms: 19, qr: 4 },
  timeline: Array.from({ length: 14 }, (_, i) => ({
    /* `date`, NOT `label`. The page computes its own label from this field
       (`formatDay(t.date)`), and formatDay returns an empty string for
       undefined — so supplying `label` filmed an "Activity over time" chart
       with every day on its x-axis blank. */
    date: new Date(Date.UTC(2027, 2, 1 + i)).toISOString().slice(0, 10),
    views: [88, 64, 41, 33, 27, 22, 19, 24, 17, 14, 12, 15, 11, 9][i],
    rsvps: [9, 6, 4, 3, 2, 1, 2, 3, 1, 1, 0, 2, 1, 1][i],
    engagements: [31, 22, 16, 12, 10, 8, 7, 9, 6, 5, 4, 6, 4, 3][i],
  })),
};

beforeAll(() => {
  /* ── `React is not defined` ────────────────────────────────────────────
     vitest compiles JSX with the CLASSIC runtime, so every component is
     rewritten to `React.createElement(...)` and needs `React` in scope. Next
     uses the automatic runtime, so a component that never touches the React
     namespace has no reason to import it — SmsBalanceBanner.js and
     EventSharePanel.js are two of them, and both threw here while rendering
     perfectly well in the app.

     Supplied as a global rather than by switching the shared
     vitest.shots.config.mjs to the automatic runtime: that config is what
     every other probe in this folder already runs green under, and changing
     it to fix two files is how you break the other seventeen. */
  global.React = React;

  /* jsdom has no layout engine, so anything that measures itself reports zero
     and lays out as though it had no room. */
  global.ResizeObserver = class {
    constructor(cb) { this.cb = cb; }
    observe(el) { this.cb([{ target: el, contentRect: { width: 1120, height: 860 } }], this); }
    unobserve() {} disconnect() {}
  };
  global.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; }
    observe(el) { this.cb([{ target: el, isIntersecting: true, intersectionRatio: 1 }], this); }
    unobserve() {} disconnect() {} takeRecords() { return []; }
  };
});

beforeEach(() => {
  window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  window.HTMLMediaElement.prototype.pause = vi.fn();
  window.scrollTo = vi.fn();
  try { window.localStorage.clear(); } catch { /* jsdom can throw here */ }
});

/* The desktop width the composer films at. Staging at the SAME width the film
   composes at is the whole reason nothing is ever scaled later. */
const DESK = `
  html,body{width:1120px;margin:0;}
  body{overflow-x:hidden;}
`;

describe('video — the organizer journey', () => {
  it('stages the sign-up screen', async () => {
    const { container, unmount } = render(<RegisterPage />);
    await settle(act);
    stageScreen('organizer', 'register', container, {
      background: '#FFFFFF', extraCss: DESK,
    });
    unmount();
  }, 120000);

  it('stages the sign-in screen', async () => {
    const { container, unmount } = render(<LoginPage />);
    await settle(act);
    stageScreen('organizer', 'login', container, {
      background: '#FFFFFF', extraCss: DESK,
    });
    unmount();
  }, 120000);

  it('stages the events list', async () => {
    const { container, unmount } = render(
      <EventsTab events={EVENTS} activeEventId={EVENT.id}
        onSelectEvent={() => {}} onRefresh={() => {}} onOpenDrafts={() => {}} />,
    );
    await settle(act);
    stageScreen('organizer', 'events', container, {
      background: '#FAFAF8', extraCss: DESK,
    });
    unmount();
  }, 120000);

  it('stages the guest list', async () => {
    const { container, unmount } = render(
      <GuestsTab
        rsvps={RSVPS} tables={TABLES} customFields={[]} eventId={EVENT.id} event={EVENT}
        onAssignTable={() => {}} onRefresh={() => {}} onOpenImport={() => {}}
        isPaid tierFeatures={TIER_FEATURES} onUpgrade={() => {}}
        smsAddonActive smsRemaining={412} smsPurchased={500}
        smsCoverage={{ sends: 412, guests: 40 }}
      />,
    );
    await settle(act);
    stageScreen('organizer', 'guests', container, {
      background: '#FAFAF8', extraCss: DESK,
    });
    unmount();
  }, 120000);

  it('stages invitations and replies', async () => {
    const { container, unmount } = render(
      <RSVPsTab
        rsvps={RSVPS} eventId={EVENT.id} event={EVENT} customFields={[]}
        onRefresh={() => {}} smsAddonActive smsMaxPerSend={200} onBuySms={() => {}}
        smsAccess="granted" plansWithSms={['signature']} onUpgradePlan={() => {}}
        smsRemaining={412} smsPurchased={500} smsCoverage={{ sends: 412, guests: 40 }}
        isPaid tierFeatures={TIER_FEATURES} onUpgrade={() => {}}
      />,
    );
    await settle(act);
    stageScreen('organizer', 'rsvps', container, {
      background: '#FAFAF8', extraCss: DESK,
    });
    unmount();
  }, 120000);

  it('stages the share panel and QR code', async () => {
    const { container, unmount } = render(<EventSharePanel event={EVENT} />);
    await settle(act);
    stageScreen('organizer', 'share', container, {
      background: '#FAFAF8', extraCss: DESK,
    });
    unmount();
  }, 120000);

  it('stages choosing a template', async () => {
    const { container, unmount } = render(
      <Stage1_TemplatesSimulator
        templates={TEMPLATES}
        templateType={TEMPLATES[0].key}
        onTemplateSelect={() => {}}
        selectedPresets={Object.fromEntries(TEMPLATES.map((t) => [t.key, 0]))}
        onPresetSelect={() => {}}
        activePresetColors={EVENT.custom_colors}
        customConfig={{}}
        onCustomConfigChange={() => {}}
        onNext={() => {}}
        onPreview={() => {}}
      />,
    );
    await settle(act);
    stageScreen('organizer', 'templates', container, {
      background: '#FAFAF8', extraCss: DESK,
    });
    unmount();
  }, 120000);

  it('stages the payment stage', async () => {
    const { container, unmount } = render(
      <StagePayment
        tiers={TIERS}
        manualMethods={[]}
        selectedTierName="Premium"
        onSelectTier={() => {}}
        onPayStripe={() => {}}
        onPayManual={() => {}}
        /* A payment REFERENCE string, not a React ref — StagePayment renders
           `{manualRef}` directly, and a `{current: null}` object here throws
           "Objects are not valid as a React child". null is the normal state:
           no bank transfer submitted, so the card path is the one on screen. */
        manualRef={null}
        processing={false}
        error=""
        onContinue={() => {}}
        onBack={() => {}}
        onSkip={() => {}}
        stripeEnabled
        smsAddonEnabled
        onToggleSmsAddon={() => {}}
        smsAddonSegments={500}
        onChangeSmsAddonSegments={() => {}}
        smsListPriceCents={2}
        smsEstimate={{ segments: 500, cents: 900 }}
        smsVolumeDiscounts={[]}
        featureLabels={{}}
        hiddenTierFeatures={[]}
        featureNotes={{}}
      />,
    );
    await settle(act);
    stageScreen('organizer', 'payment', container, {
      background: '#FAFAF8', extraCss: DESK,
    });
    unmount();
  }, 120000);

  it('stages the analytics page', async () => {
    globalThis.__EVENTS__ = EVENTS;
    globalThis.__ANALYTICS__ = ANALYTICS;
    const { container, unmount } = render(<AnalyticsPage />);
    await settle(act, 20);
    stageScreen('organizer', 'analytics', container, {
      background: '#FAFAF8', extraCss: DESK,
    });
    unmount();
  }, 180000);

  it('stages the organizer profile', async () => {
    const { container, unmount } = render(<OrganizerProfile events={EVENTS} />);
    await settle(act);
    stageScreen('organizer', 'profile', container, {
      background: '#FAFAF8', extraCss: DESK,
    });
    unmount();
  }, 120000);
});
