/* ═══════════════════════════════════════════════════════════════════════════
   THE DEMO EVENT — one fixture, served to the RUNNING app.

   `record.js --live` starts the real Next production server and intercepts
   every call to /api/v1/**, answering from here. So the app on screen is the
   real app: real routing, real React, real modals that really open — with a
   backend that always answers the same way.

   ── Shapes are the BACKEND'S, not a guess ──

   Every payload below is written to the shape its controller actually returns
   (backend/controllers/*.js), wrapper included. The frontend unwraps
   defensively — `res?.events || res?.data || []`, `res?.analytics || null`,
   `res.dashboard` — so a bare array or a bare object silently produces an
   empty state that reads as a product with no data rather than a mock with
   the wrong shape.

   ── ITS SIBLING, AND WHY THEY ARE NOT ONE FILE ──

   frontend/src/app/demo/fixtures/ describes the SAME wedding for the public
   /demo route. The two were nearly merged and must not be: this one is
   PINNED to 2027 because the film's caption cards say so on screen, and that
   one is RELATIVE to today because a demo whose countdown has reached zero
   cannot be opened. Keep the couple, the venue, the followed guest and the
   dishes in step by hand; everything else may differ.

   ── One event, everywhere ──

   Nadia & Omar, 14 May 2027, Beit Al Qamar in Alexandria. 40 invitations,
   69 people, 26 parties attending, 22 of them seated, 34 opted in to texts.
   The guest the film follows is Nour Haddad, Table 4. Every screen in every
   chapter has to agree with these numbers, so they live here once.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const EVENT_ID = 'evt-nadia-omar';

/* The venue is in Alexandria, so the zone is Cairo. `event_date` is a real
   instant rendered in the organizer's zone: 16:30Z is 7:30 PM there. Left at
   the harness's Los_Angeles default the same instant printed "11:30 AM" on a
   wedding pass — true to the data, and obviously wrong on screen. */
const EVENT = {
  id: EVENT_ID,
  slug: 'nadia-and-omar',
  title: 'Nadia & Omar',
  event_type: 'wedding',
  template_type: 'swans',
  status: 'published',
  event_date: '2027-05-14T16:30:00.000Z',
  timezone: 'Africa/Cairo',
  venue_name: 'Beit Al Qamar',
  location_name: 'Beit Al Qamar',
  venue_address: '12 Corniche Road, Alexandria',
  guest_limit: 400,
  max_party_size: 8,
  rsvp_deadline: '2027-04-20',
  privacy_mode: 'public',
  is_paid: true,
  plan_key: 'signature',
  tier_name: 'Premium',
  collect_dietary_restrictions: true,
  no_kids_allowed: true,
  allow_guest_edits: true,
  custom_colors: { primary: '#7a2f3a', accent: '#c9a45c', background: '#f6f1e4' },
  template_data: {
    groom_name: 'Omar', bride_name: 'Nadia',
    meal_options: ['Beef Short Rib', 'Sea Bass', 'Wild Mushroom Risotto'],
  },
};

const EVENTS = [
  { ...EVENT, guest_count: 40, rsvp_count: 32 },
  { id: 'evt-2', slug: 'aria-and-julian', title: 'Aria & Julian', event_type: 'wedding',
    template_type: 'ring', status: 'published', event_date: '2026-09-12T16:00:00.000Z',
    venue_name: 'Rosewood Hall', location_name: 'Rosewood Hall', timezone: 'Africa/Cairo',
    is_paid: true, guest_count: 186, rsvp_count: 154, template_data: {} },
  { id: 'evt-3', slug: 'haddad-anniversary', title: 'Forty Years — Haddad',
    event_type: 'anniversary', template_type: 'bab', status: 'published',
    event_date: '2026-11-02T15:30:00.000Z', venue_name: 'The Orangery',
    location_name: 'The Orangery', timezone: 'Africa/Cairo', is_paid: true,
    guest_count: 64, rsvp_count: 61, template_data: {} },
  { id: 'evt-4', slug: 'salma-graduation', title: "Salma's Graduation",
    event_type: 'graduation', template_type: 'letter', status: 'draft',
    event_date: '2027-06-20T14:00:00.000Z', venue_name: '', location_name: '',
    timezone: 'Africa/Cairo', is_paid: false, guest_count: 22, rsvp_count: 0,
    template_data: {} },
];

/* `table_name`, not `name` — the two are not interchangeable and the wrong one
   renders a chart of unlabelled circles. Positions are the TOP-LEFT corner as
   a percentage of a 2600x1700 world, not the centre. */
const TABLES = [
  { id: 't-head', table_name: 'Head Table', shape: 'rectangle', max_capacity: 10,
    occupied: 10, position_x: 40, position_y: 8, width: 340, height: 120 },
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `t-${i + 1}`,
    table_name: `Table ${i + 1}`,
    shape: 'round',
    max_capacity: 10,
    occupied: [10, 9, 10, 8, 10, 7, 10, 9, 6, 8][i],
    position_x: 12 + (i % 5) * 18,
    position_y: 30 + Math.floor(i / 5) * 30,
    width: 180, height: 180,
  })),
];

const FIRST = ['Nour', 'Karim', 'Yasmin', 'Tarek', 'Layla', 'Adam', 'Mira', 'Hadi',
  'Rana', 'Sami', 'Dina', 'Fares', 'Salma', 'Ziad', 'Maya', 'Omar',
  'Lina', 'Rami', 'Hana', 'Basel', 'Jana', 'Nabil', 'Reem', 'Tamer',
  'Aya', 'Wissam', 'Farah', 'Marwan', 'Leila', 'Hisham', 'Noor', 'Kamal',
  'Zeina', 'Amir', 'Nadine', 'Yousef', 'Rima', 'Habib', 'Sara', 'Elias'];
const LAST = ['Haddad', 'Khoury', 'Nassar', 'Aziz', 'Barakat', 'Chalhoub', 'Daher',
  'Fakhoury', 'Ghanem', 'Hakim', 'Ibrahim', 'Jaber', 'Karam', 'Labaki',
  'Mansour', 'Najjar', 'Osman', 'Rahal', 'Saad', 'Tannous'];
const MEALS = ['Beef Short Rib', 'Sea Bass', 'Wild Mushroom Risotto'];

/* Three field names that silently lie if you get them wrong, each found by
   staging the screen and reading it:
     tableId     camelCase; the snake_case one makes every seated guest
                 render "No Table"
     guests      the party table, one row per person INCLUDING the primary
                 contact, each { full_name, is_primary_contact }; a row
                 without full_name prints "Unnamed guest"
     sms_consent without it every guest is badged "hasn't agreed to texts" */
const RSVPS = Array.from({ length: 40 }, (_, i) => {
  const response = i < 26 ? 'yes' : i < 32 ? 'no' : 'pending';
  const attending = response === 'yes';
  const party = attending ? [1, 2, 2, 1, 3, 2, 1, 4, 2, 1, 2, 5][i % 12] : 1;
  const table = attending && i < 22 ? TABLES[(i % 10) + 1] : null;
  const name = `${FIRST[i]} ${LAST[i % LAST.length]}`;
  return {
    id: `g-${i + 1}`,
    guest_name: name,
    email: `${FIRST[i].toLowerCase()}.${LAST[i % LAST.length].toLowerCase()}@example.com`,
    phone: `+2010${String(20000000 + i).slice(-8)}`,
    response: response === 'pending' ? null : response,
    party_size: party,
    meal: attending ? MEALS[i % 3] : null,
    side: i % 2 ? 'Nadia' : 'Omar',
    notes: i === 4 ? 'Wheelchair access, please seat near the door' : '',
    table,
    tableId: table ? table.id : null,
    table_id: table ? table.id : null,
    guests: attending
      ? [
          { full_name: name, is_primary_contact: true },
          ...Array.from({ length: party - 1 }, (_, k) => ({
            full_name: `${FIRST[(i + k + 7) % 40]} ${LAST[(i + k + 3) % LAST.length]}`,
            is_primary_contact: false,
          })),
        ]
      : [],
    sms_consent: i < 34,
    sms_consent_at: i < 34 ? '2027-03-08T10:12:00.000Z' : null,
    sms_consent_method: i < 34 ? 'guest_opt_in' : null,
    custom: {},
    invitation_sent: i < 34,
    qr_token: `tok-${i + 1}`,
    created_at: new Date(Date.UTC(2027, 2, 1 + (i % 26), 9, 0)).toISOString(),
  };
});

/* ── The API's own guest shape ───────────────────────────────────────────
   RSVPS above is the shape the UI COMPONENTS take as props, which is what the
   staged probes feed them. The API returns something different, and
   dashboard/page.js maps one to the other (page.js:669):

       guest_name  <- r.label
       email/phone <- the party row with is_primary_contact
       table       <- r.seating_assignments[0].table_id
       meal        <- each party row's meal_selection
       invited     <- r.invitations[] with a sent-ish status

   Feeding the UI shape to the live app produced a guest list with the right
   COUNTS and forty nameless cards reading "?" and "NO NUMBER" — every
   aggregate correct, every individual blank. Built from the same source, so
   the two can never drift. */
const RSVPS_API = RSVPS.map((r) => ({
  id: r.id,
  label: r.guest_name,
  response: r.response,
  sms_consent: r.sms_consent,
  sms_consent_at: r.sms_consent_at,
  sms_consent_method: r.sms_consent_method,
  notes: r.notes,
  side: r.side,
  created_at: r.created_at,
  qr_token: r.qr_token,
  companion_meal_counts: r.party_size > 1 && r.meal
    ? { [r.meal]: r.party_size - 1 }
    : null,
  seating_assignments: r.tableId ? [{ table_id: r.tableId }] : [],
  invitations: r.invitation_sent
    ? [{ channel: 'email', status: 'delivered' },
       ...(r.sms_consent ? [{ channel: 'sms', status: 'delivered' }] : [])]
    : [],
  guests: (r.guests || []).map((g, k) => ({
    full_name: g.full_name,
    is_primary_contact: g.is_primary_contact,
    // Contact details live on the PRIMARY row only — companions are names
    // only, which is the product's own rule.
    email: g.is_primary_contact ? r.email : null,
    phone: g.is_primary_contact ? r.phone : null,
    meal_selection: g.is_primary_contact ? r.meal : null,
    sms_consent: g.is_primary_contact ? r.sms_consent : false,
  })),
}));

const ACCEPTED = RSVPS.filter((r) => r.response === 'yes');
const DECLINED = RSVPS.filter((r) => r.response === 'no');
const PENDING  = RSVPS.filter((r) => !r.response);
const HEADCOUNT = ACCEPTED.reduce((n, r) => n + r.party_size, 0);

/* backend/controllers/dashboardController.js:309 — shape and wrapper. */
const DASHBOARD = {
  success: true,
  dashboard: {
    totalEvents: EVENTS.length,
    activeEvents: EVENTS.filter((e) => e.status === 'published').length,
    totalGuests: 312,
    rsvpOverview: {
      acceptedCount: 214, acceptedPercent: 69,
      declinedCount: 38,  declinedPercent: 12,
      pendingCount: 60,   pendingPercent: 19,
    },
    checkedIn: 0,
    notArrived: 214,
    totalGuestsAccepted: 214,
    rsvpTrend: Array.from({ length: 14 }, (_, i) => ({
      date: new Date(Date.UTC(2027, 2, 1 + i)).toISOString().slice(0, 10),
      count: [9, 6, 4, 3, 2, 1, 2, 3, 1, 1, 0, 2, 1, 1][i],
    })),
    upcomingEvents: EVENTS.filter((e) => e.status === 'published').map((e) => ({
      id: e.id, title: e.title, event_date: e.event_date,
      location_name: e.location_name, status: e.status,
      guestCount: e.rsvp_count || 0,
    })),
    recentActivity: [
      { id: 'a1', action: 'rsvp_accepted', metadata: {}, guest_name: 'Nour Haddad',
        created_at: '2027-03-12T09:14:00.000Z' },
      { id: 'a2', action: 'rsvp_accepted', metadata: {}, guest_name: 'Karim Khoury',
        created_at: '2027-03-12T08:02:00.000Z' },
      { id: 'a3', action: 'rsvp_declined', metadata: {}, guest_name: 'Farah Osman',
        created_at: '2027-03-11T19:40:00.000Z' },
      { id: 'a4', action: 'invitation_sent', metadata: { channel: 'sms' }, guest_name: null,
        created_at: '2027-03-11T10:00:00.000Z' },
      { id: 'a5', action: 'rsvp_accepted', metadata: {}, guest_name: 'Yasmin Nassar',
        created_at: '2027-03-10T21:18:00.000Z' },
    ],
  },
};

/* analytics/page.js reads these EXACT keys — `totalPageViews` not `views`,
   `conversionRate` not `responseRate`, and a funnel of {step,count,dropOff}.
   Wrong names render a page of zeroes and "nothing in this range yet". */
const ANALYTICS = {
  advanced: true,
  rangeApplied: false,
  overview: {
    totalHeadcount: HEADCOUNT,
    attendingCount: ACCEPTED.length,
    maybeCount: 0,
    declinedCount: DECLINED.length,
    pendingCount: PENDING.length,
    totalPageViews: 512,
    uniqueVisitors: 318,
    totalRsvps: ACCEPTED.length + DECLINED.length,
    conversionRate: 80,
  },
  reveal: { shown: 318, opened: 296, skipped: 18, failed: 4, openRate: 93, medianMsToOpen: 4200 },
  funnel: [
    { step: 'Opened the invitation', count: 318, dropOff: null },
    { step: 'Reached the RSVP',      count: 214, dropOff: 33 },
    { step: 'Started a reply',       count: 41,  dropOff: 81 },
    { step: 'Submitted',             count: 32,  dropOff: 22 },
  ],
  /* The backend's own ACTION_TYPES. analytics/page.js maps these to sentences
     and falls through to the RAW KEY for anything it does not recognise, so an
     invented name films a bar labelled "saved_the_date" rather than erroring. */
  engagementActions: {
    calendar_added: 112, directions_clicked: 96, guest_pass_downloaded: 74,
    gallery_viewed: 61, share_clicked: 38, music_played: 27,
  },
  declineReasons: { travel: 3, conflict: 2, other: 1 },
  sources: { direct: 141, whatsapp: 96, email: 58, sms: 19, qr: 4 },
  timeline: Array.from({ length: 14 }, (_, i) => ({
    /* `date`, NOT `label` — the page derives its own label with
       formatDay(t.date), and formatDay(undefined) is the empty string. */
    date: new Date(Date.UTC(2027, 2, 1 + i)).toISOString().slice(0, 10),
    views: [88, 64, 41, 33, 27, 22, 19, 24, 17, 14, 12, 15, 11, 9][i],
    rsvps: [9, 6, 4, 3, 2, 1, 2, 3, 1, 1, 0, 2, 1, 1][i],
    engagements: [31, 22, 16, 12, 10, 8, 7, 9, 6, 5, 4, 6, 4, 3][i],
  })),
};

/* SIX tiers, which is what the live site runs. `pricing_tiers` is a JSONB
   column an admin edits: the schema seeds three, an old probe used four, and
   fancyrsvp.com serves six. The count is not cosmetic — the plan grid picks an
   .fx-grid--N preset from plans.length and each preset carries a different
   --fx-col, so a four-tier capture is of a page the organizer does not have. */
const F = {
  rsvpBasic: 'RSVP tracking', analytics: 'Basic analytics', email: 'Email invitations',
  community: 'Community support', manualGuest: 'Add guests manually',
  customFields: 'Custom RSVP questions', csvIn: 'Guest import (CSV)',
  csvOut: 'Guest export (CSV)', seating: 'Seating plan', tables: 'Table management',
  branding: 'Custom themes & branding', sms: 'Text messaging', qr: 'QR code check-in',
  manualCheckin: 'Manual check-in', checkinApp: 'Fancy Check-in app (offline door scanner)',
  excel: 'Guest export (Excel)', watermark: 'Remove Fancy watermark',
  analyticsPro: 'Real-time analytics & reports', priority: 'Priority email & chat support',
  whiteLabel: 'White-label solution', dedicated: 'Dedicated account manager',
  integrations: 'All integrations', api: 'Custom integrations & API',
  sso: 'SSO & team management', security: 'Advanced security & compliance',
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

const PROFILE = {
  success: true,
  user: {
    id: 'demo-organizer',
    first_name: 'Yara', last_name: 'Mansour',
    email: 'host@fancyrsvp.com',
    organization: 'Beit Al Qamar Events',
    phone: '+201020000000',
    timezone: 'Africa/Cairo',
    created_at: '2026-11-02T10:00:00.000Z',
  },
};

/* ── The router ──────────────────────────────────────────────────────────
   Longest, most specific pattern first. Anything unmatched gets a benign
   `{ success: true }` rather than a 404, because a dashboard panel that
   fetches something unforeseen should render empty, not throw a red error
   banner across a frame of the film. */
const ROUTES = [
  [/\/events\/[^/]+\/analytics/,  () => ({ success: true, analytics: ANALYTICS })],
  /* The guest list is the ONE endpoint with a different envelope:
       dashboard/page.js reads `first.data.rsvps` and `first.meta.pagination.total`,
     not a top-level `rsvps`. Answering the flat shape leaves the app on
     "NO GUESTS YET" with every counter at 0 — while the caption beside it
     says 69 guests, which is the one contradiction a viewer cannot miss.
     Both shapes are returned so a caller reading either is served. */
  [/\/events\/[^/]+\/rsvps/,      () => ({
    success: true,
    data: { rsvps: RSVPS_API },
    meta: { pagination: { total: RSVPS.length, page: 1, limit: RSVPS.length, totalPages: 1 } },
    rsvps: RSVPS_API,
  })],
  [/\/events\/[^/]+\/tables/,     () => ({ success: true, tables: TABLES })],
  [/\/events\/[^/]+\/stats/,      () => ({ success: true, stats: {
      totalInvited: RSVPS.length, accepted: ACCEPTED.length,
      declined: DECLINED.length, pending: PENDING.length, headcount: HEADCOUNT } })],
  [/\/events\/[^/]+\/fields/,     () => ({ success: true, fields: [] })],
  [/\/events\/[^/]+$/,            () => ({ success: true, event: EVENT })],
  [/\/events(\?|$)/,              () => ({ success: true, events: EVENTS })],
  [/\/dashboard/,                 () => DASHBOARD],
  [/\/auth\/profile/,             () => PROFILE],
  [/\/auth\/sessions/,            () => ({ success: true, sessions: [] })],
  [/\/payments\/pricing-config/,  () => ({ success: true, tiers: TIERS, manualMethods: [], stripeEnabled: true })],
  [/\/referrals\/me/,             () => ({ success: true, referral: { code: 'YARA-2027', credits_cents: 0, referred: [] } })],
  [/\/public\/shop/,              () => ({ success: true, products: [], categories: [] })],
  [/\/checkin\/events\/[^/]+\/devices/, () => ({ success: true, devices: [] })],
  [/\/checkin\/events\/[^/]+\/staff/,   () => ({ success: true, staff: [] })],
];

function answerFor(url) {
  for (const [pattern, build] of ROUTES) if (pattern.test(url)) return build();
  return { success: true };
}

module.exports = {
  EVENT_ID, EVENT, EVENTS, TABLES, RSVPS, RSVPS_API, DASHBOARD, ANALYTICS, TIERS, PROFILE,
  HEADCOUNT, answerFor,
};
