/* ═══════════════════════════════════════════════════════════════════════════
   THE ORGANIZER'S SIDE OF THE SAME WEDDING.

   Nadia & Omar's guest list, tables, statistics and analytics — the data the
   demo's four dashboard screens render.

   ── AND WHY e2e/video/fixtures.js STILL EXISTS BESIDE IT ─────────────────

   The walkthrough film describes the same wedding from its own fixture, and
   folding the two together was the plan until the requirements turned out to
   be incompatible. The film's numbers and dates are spoken by caption cards
   burnt into the video — "14 May 2027" is on screen — so its fixture must be
   PINNED. This one must be RELATIVE, or the demo's countdown reaches zero,
   its RSVP deadline passes, and the form the whole demo exists to show
   refuses to open.

   One module cannot be both. Two fixtures for two consumers with opposite
   requirements is the honest arrangement; what would not be honest is
   pretending they are the same wedding and letting one quietly rot. They
   agree on the couple, the venue, the guest who is followed and the dishes —
   and where they differ, they differ on purpose.

   ── TWO SHAPES, ONE SOURCE ───────────────────────────────────────────────

   `GUESTS` is the shape the UI COMPONENTS take as props. The API returns
   something different, and dashboard/page.js:669 maps one to the other:

       guest_name  <- r.label
       email/phone <- the party row flagged is_primary_contact
       tableId     <- r.seating_assignments[0].table_id
       meal        <- each party row's meal_selection, joined
       invited     <- r.invitations[] with a sent-ish status

   `GUESTS_API` is derived from `GUESTS` rather than typed out beside it, so
   the two can never drift. Feeding the component shape to a surface that
   expects the API shape produced a guest list with the right COUNTS and forty
   nameless cards reading "?" and "NO NUMBER" — every aggregate correct, every
   individual blank. That is the failure this file is arranged to prevent.

   ── THE FIELD NAMES THAT LIE SILENTLY ────────────────────────────────────

     table_name    not `name`. The wrong one renders a chart of unlabelled
                   circles.
     occupied      SeatingManager computes `max_capacity - occupied`; without
                   it every table option reads "NaN left" and is disabled.
     tableId       camelCase. The snake_case one makes every seated guest
                   render "No Table".
     guests[]      the party table, one row per person INCLUDING the primary
                   contact, each { full_name, is_primary_contact }. A row
                   without full_name prints the literal "Unnamed guest".
     sms_consent   without it every guest is badged "hasn't agreed to texts".
     timeline[]    analytics rows key on `date`, NOT `label` — the page
                   computes its own label from it, so supplying `label`
                   leaves every day on the x-axis blank.

   Dates are computed from the wedding's own instant (see demoEvent.mjs), so
   nothing here goes stale.
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  DEMO_EVENT_ID, DEMO_SLUG, DEMO_TITLE, DEMO_TIMEZONE, DEMO_MEALS,
  DEMO_VENUE, DEMO_VENUE_ADDRESS, DEMO_GUEST_NAME, DEMO_FORM_FIELDS,
  buildDemoEvent, eventInstant, rsvpDeadlineInstant,
} from './demoEvent.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const startOfUtcDay = (now = Date.now()) => Math.floor(now / DAY_MS) * DAY_MS;
/** `n` days before today, as an ISO instant at 09:00Z. */
const daysAgo = (n, now = Date.now()) =>
  new Date(startOfUtcDay(now) - n * DAY_MS + 9 * 60 * 60 * 1000).toISOString();
/** `n` days before today, as a YYYY-MM-DD calendar day. */
const dayKey = (n, now = Date.now()) =>
  new Date(startOfUtcDay(now) - n * DAY_MS).toISOString().slice(0, 10);

/* ── The account's events ──────────────────────────────────────────────────
   More than one, because the Overview is an ACCOUNT screen and an account
   with a single event does not exercise it. `totalEvents === 0` is also the
   one input that replaces the whole Overview with the first-run panel. */

export function demoEvents(now = Date.now()) {
  const wedding = buildDemoEvent({ now });
  return [
    { ...wedding, guest_count: 40, rsvp_count: 32 },
    {
      id: 'demo-evt-aria', slug: 'aria-and-julian', title: 'Aria & Julian',
      event_type: 'wedding', template_type: 'ring', status: 'published',
      event_date: new Date(startOfUtcDay(now) + 213 * DAY_MS + 15 * 60 * 60 * 1000).toISOString(),
      timezone: DEMO_TIMEZONE, location_name: 'Rosewood Hall', venue_name: 'Rosewood Hall',
      is_paid: true, guest_count: 186, rsvp_count: 154, template_data: {},
    },
    {
      id: 'demo-evt-haddad', slug: 'haddad-anniversary', title: 'Forty Years — Haddad',
      event_type: 'anniversary', template_type: 'bab', status: 'published',
      event_date: new Date(startOfUtcDay(now) + 41 * DAY_MS + 16 * 60 * 60 * 1000).toISOString(),
      timezone: DEMO_TIMEZONE, location_name: 'The Orangery', venue_name: 'The Orangery',
      is_paid: true, guest_count: 64, rsvp_count: 61, template_data: {},
    },
    {
      id: 'demo-evt-salma', slug: 'salma-graduation', title: "Salma's Graduation",
      event_type: 'graduation', template_type: 'letter', status: 'draft',
      event_date: new Date(startOfUtcDay(now) + 286 * DAY_MS + 14 * 60 * 60 * 1000).toISOString(),
      timezone: DEMO_TIMEZONE, location_name: '', venue_name: '',
      is_paid: false, guest_count: 22, rsvp_count: 0, template_data: {},
    },
  ];
}

/* ── The room ─────────────────────────────────────────────────────────────
   Positions are the TOP-LEFT corner as a percentage of the seating world,
   not the centre — getting that wrong scrambles the whole layout. */

export const DEMO_TABLES = [
  {
    id: 'tbl-head', table_name: 'Head Table', shape: 'rectangle',
    max_capacity: 10, occupied: 10,
    position_x: 40, position_y: 8, width: 340, height: 120,
  },
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `tbl-${i + 1}`,
    table_name: `Table ${i + 1}`,
    shape: 'round',
    max_capacity: 10,
    occupied: [10, 9, 10, 8, 10, 7, 10, 9, 6, 8][i],
    position_x: 12 + (i % 5) * 18,
    position_y: 30 + Math.floor(i / 5) * 30,
    width: 180,
    height: 180,
  })),
];

/* ── The guest list ───────────────────────────────────────────────────────
   Forty parties: 26 coming, 6 declined, 8 still to answer. The first name in
   the list is the guest the visitor just played in stage 1, seated at
   Table 1 — so the person they were is findable as a row here. */

const FIRST = [
  'Nour', 'Karim', 'Yasmin', 'Tarek', 'Layla', 'Adam', 'Mira', 'Hadi',
  'Rana', 'Sami', 'Dina', 'Fares', 'Salma', 'Ziad', 'Maya', 'Omar',
  'Lina', 'Rami', 'Hana', 'Basel', 'Jana', 'Nabil', 'Reem', 'Tamer',
  'Aya', 'Wissam', 'Farah', 'Marwan', 'Leila', 'Hisham', 'Noor', 'Kamal',
  'Zeina', 'Amir', 'Nadine', 'Yousef', 'Rima', 'Habib', 'Sara', 'Elias',
];
const LAST = [
  'Haddad', 'Khoury', 'Nassar', 'Aziz', 'Barakat', 'Chalhoub', 'Daher',
  'Fakhoury', 'Ghanem', 'Hakim', 'Ibrahim', 'Jaber', 'Karam', 'Labaki',
  'Mansour', 'Najjar', 'Osman', 'Rahal', 'Saad', 'Tannous',
];

const SONGS = ['Enta Omri', 'Ya Msafer Wahdak', 'Tamally Maak', 'Alf Leila'];

export function demoGuests(now = Date.now()) {
  return Array.from({ length: 40 }, (_, i) => {
    const response = i < 26 ? 'yes' : i < 32 ? 'no' : null;
    const attending = response === 'yes';
    const party = attending ? [1, 2, 2, 1, 3, 2, 1, 4, 2, 1, 2, 5][i % 12] : 1;
    /* 22 of the 26 accepted parties are seated, which leaves the "still to
       seat" filter with something in it — the seating screen's whole first
       question. */
    const table = attending && i < 22 ? DEMO_TABLES[(i % 10) + 1] : null;
    const name = i === 0 ? DEMO_GUEST_NAME : `${FIRST[i]} ${LAST[i % LAST.length]}`;
    const meal = attending ? DEMO_MEALS[i % 3] : null;

    return {
      id: `demo-g-${i + 1}`,
      guest_name: name,
      email: `${FIRST[i].toLowerCase()}.${LAST[i % LAST.length].toLowerCase()}@example.com`,
      phone: `+2010${String(20000000 + i).slice(-8)}`,
      response,
      party_size: party,
      meal,
      primary_meal: meal,
      companion_meal_counts: party > 1 && meal ? { [meal]: party - 1 } : null,
      side: i % 2 ? 'Nadia' : 'Omar',
      notes: i === 4 ? 'Wheelchair access, please seat near the terrace door' : '',
      tableId: table ? table.id : '',
      guests: attending
        ? [
          { full_name: name, is_primary_contact: true },
          ...Array.from({ length: party - 1 }, (_, k) => ({
            full_name: `${FIRST[(i + k + 7) % 40]} ${LAST[(i + k + 3) % LAST.length]}`,
            is_primary_contact: false,
          })),
        ]
        : [{ full_name: name, is_primary_contact: true }],
      /* Answers to the organizer's own questions, keyed by the field ids in
         DEMO_FORM_FIELDS — so the Guests screen resolves them to the labels
         the RSVP form asked in stage 1 rather than printing raw ids. */
      customAnswers: attending
        ? [
          { field_id: 'fld-song', answer_value: SONGS[i % SONGS.length] },
          { field_id: 'fld-transport', answer_value: i % 3 === 0 ? 'Yes, please' : 'No, I will drive' },
        ]
        : [],
      sms_consent: i < 34,
      sms_consent_at: i < 34 ? daysAgo(20 - (i % 14), now) : null,
      sms_consent_method: i < 34 ? 'guest_opt_in' : null,
      sms_opted_out: false,
      invitation_sent: i < 34,
      invitation_sent_email: i < 34,
      invitation_sent_sms: i < 34 && i < 30,
      qr_token: `demo-tok-${i + 1}`,
      timestamp: daysAgo(26 - (i % 26), now),
      created_at: daysAgo(26 - (i % 26), now),
    };
  });
}

/** The API's own envelope, derived from the component shape above. */
export function demoGuestsApi(now = Date.now()) {
  return demoGuests(now).map((g) => ({
    id: g.id,
    label: g.guest_name,
    response: g.response,
    sms_consent: g.sms_consent,
    sms_consent_at: g.sms_consent_at,
    sms_consent_method: g.sms_consent_method,
    sms_opted_out: g.sms_opted_out,
    notes: g.notes,
    side: g.side,
    created_at: g.created_at,
    qr_token: g.qr_token,
    companion_meal_counts: g.companion_meal_counts,
    custom_answers: g.customAnswers,
    seating_assignments: g.tableId ? [{ table_id: g.tableId }] : [],
    invitations: g.invitation_sent
      ? [
        { channel: 'email', status: 'delivered' },
        ...(g.invitation_sent_sms ? [{ channel: 'sms', status: 'delivered' }] : []),
      ]
      : [],
    guests: (g.guests || []).map((row) => ({
      full_name: row.full_name,
      is_primary_contact: row.is_primary_contact,
      // Contact details live on the PRIMARY row only — companions are names
      // only, which is the product's own rule.
      email: row.is_primary_contact ? g.email : null,
      phone: row.is_primary_contact ? g.phone : null,
      meal_selection: row.is_primary_contact ? g.meal : null,
      sms_consent: row.is_primary_contact ? g.sms_consent : false,
    })),
  }));
}

/* ── Aggregates, computed rather than typed ──────────────────────────────── */

export function demoCounts(now = Date.now()) {
  const guests = demoGuests(now);
  const accepted = guests.filter((g) => g.response === 'yes');
  const declined = guests.filter((g) => g.response === 'no');
  const pending = guests.filter((g) => !g.response);
  const headcount = accepted.reduce((n, g) => n + g.party_size, 0);
  return { guests, accepted, declined, pending, headcount };
}

/* ── The account overview ─────────────────────────────────────────────────
   `rsvpOverview` here is the API's own key set (…Count); OrganizerOverview
   remaps it to { accepted, declined, pending } before handing it to the
   cards and the donut. Supplying the mapped names at this level would leave
   both at zero. */

export function demoDashboard(now = Date.now()) {
  const events = demoEvents(now);
  const published = events.filter((e) => e.status === 'published');
  return {
    success: true,
    dashboard: {
      totalEvents: events.length,
      activeEvents: published.length,
      totalGuests: 312,
      rsvpOverview: {
        acceptedCount: 214, acceptedPercent: 69,
        declinedCount: 38, declinedPercent: 12,
        pendingCount: 60, pendingPercent: 19,
      },
      checkedIn: 0,
      notArrived: 214,
      totalGuestsAccepted: 214,
      rsvpTrend: Array.from({ length: 14 }, (_, i) => ({
        date: dayKey(13 - i, now),
        count: [1, 1, 2, 0, 1, 1, 3, 1, 2, 1, 4, 3, 6, 9][i],
      })),
      upcomingEvents: published.map((e) => ({
        id: e.id,
        title: e.title,
        event_date: e.event_date,
        timezone: e.timezone,
        location_name: e.location_name,
        status: e.status,
        guestCount: e.rsvp_count || 0,
      })),
      /* Only action keys RecentActivityFeed actually styles. Anything else
         falls through to a grey dot and the raw key with its underscores
         swapped for spaces, which reads as a log line rather than as news. */
      recentActivity: [
        { id: 'demo-a1', action: 'rsvp_submitted', metadata: {}, guest_name: DEMO_GUEST_NAME, created_at: daysAgo(0, now) },
        { id: 'demo-a2', action: 'table_assigned', metadata: {}, guest_name: 'Karim Khoury', created_at: daysAgo(0, now) },
        { id: 'demo-a3', action: 'rsvp_submitted', metadata: {}, guest_name: 'Yasmin Nassar', created_at: daysAgo(1, now) },
        { id: 'demo-a4', action: 'rsvp_submitted', metadata: {}, guest_name: 'Tarek Aziz', created_at: daysAgo(1, now) },
        { id: 'demo-a5', action: 'table_assigned', metadata: {}, guest_name: 'Layla Barakat', created_at: daysAgo(2, now) },
      ],
    },
  };
}

/* ── Analytics ────────────────────────────────────────────────────────────
   The page reads these exact keys — `totalPageViews` not `views`,
   `conversionRate` not `responseRate`, a funnel of {step,count,dropOff}, and
   a timeline keyed on `date`. Wrong names render a page of zeroes and
   "nothing in this range yet", which reads as a product with no analytics
   rather than as a fixture with the wrong shape.

   `engagementActions` keys must be the ones the backend actually emits, or
   the page prints the raw key instead of a sentence. */

export function demoAnalytics(now = Date.now()) {
  const { accepted, declined, pending, headcount } = demoCounts(now);
  return {
    advanced: true,
    rangeApplied: false,
    overview: {
      totalHeadcount: headcount,
      attendingCount: accepted.length,
      maybeCount: 0,
      declinedCount: declined.length,
      pendingCount: pending.length,
      totalPageViews: 512,
      uniqueVisitors: 318,
      totalRsvps: accepted.length + declined.length,
      conversionRate: 80,
    },
    reveal: { shown: 318, opened: 296, skipped: 18, failed: 4, openRate: 93, medianMsToOpen: 4200 },
    funnel: [
      { step: 'Opened the invitation', count: 318, dropOff: null },
      { step: 'Reached the RSVP', count: 214, dropOff: 33 },
      { step: 'Started a reply', count: 41, dropOff: 81 },
      { step: 'Submitted', count: 32, dropOff: 22 },
    ],
    engagementActions: {
      calendar_added: 112,
      directions_clicked: 96,
      guest_pass_downloaded: 74,
      share_clicked: 38,
      gallery_viewed: 61,
      music_played: 27,
      seating_searched: 19,
    },
    declineReasons: { travel: 3, conflict: 2, other: 1 },
    sources: { direct: 141, whatsapp: 96, email: 58, sms: 19, qr: 4 },
    timeline: Array.from({ length: 14 }, (_, i) => ({
      date: dayKey(13 - i, now),
      views: [9, 11, 14, 12, 15, 17, 22, 19, 24, 27, 33, 41, 64, 88][i],
      rsvps: [1, 1, 2, 0, 1, 1, 3, 1, 2, 1, 4, 3, 6, 9][i],
      engagements: [3, 4, 6, 4, 5, 6, 9, 7, 8, 10, 12, 16, 22, 31][i],
    })),
  };
}

/* ── The plan ─────────────────────────────────────────────────────────────
   A PLAIN ARRAY OF KEY STRINGS, and that is not a stylistic preference.
   FeatureGate does `Array.isArray(tierFeatures) ? tierFeatures : []`, so an
   object — or a Proxy that answers `true` to everything — collapses to the
   empty array and padlocks every gated control it was meant to unlock.

   These are the keys the fixture's own plan (`signature` / "Premium")
   carries. `guest_export_excel` is deliberately absent: it belongs to the
   tier above, so the padlock the demo shows on it is TRUE. A demo that
   unlocks everything is not a demo of this product's plans. */
export const DEMO_TIER_FEATURES = [
  'rsvp_custom_fields',
  'import_guests_csv',
  'guest_export_csv',
  'seating_map',
  'table_management',
  'custom_branding',
  'sms_campaigns',
  'add_guest_manual',
];

export const DEMO_PROFILE = {
  success: true,
  user: {
    id: 'demo-organizer',
    first_name: 'Yara',
    last_name: 'Mansour',
    email: 'host@fancyrsvp.com',
    organization: 'Beit Al Qamar Events',
    phone: '+201020000000',
    timezone: DEMO_TIMEZONE,
    created_at: daysAgo(310),
  },
};

/* ── The router ───────────────────────────────────────────────────────────
   Longest, most specific pattern first.

   `/public/...` is deliberately ABSENT. Those endpoints need no session and
   answer a demo visitor exactly as they answer a signed-in organizer, so
   letting them through is not a gap — it is the reason the shop card and the
   door-app announcement show the real catalogue and the real plan names
   rather than a fixture's guess at them. `answerFor` returns undefined for
   anything it does not own, and the caller falls through to the network.

   Everything else authenticated that is not listed gets a benign
   `{ success: true }` rather than a 404, because a panel that fetches
   something unforeseen should render empty rather than throw a red banner
   across the demo. */

export function answerFor(url, now = Date.now()) {
  const path = String(url || '').replace(/^https?:\/\/[^/]+/, '').replace(/\/api\/v1/, '');
  if (/^\/public\//.test(path)) return undefined;

  const { guests, accepted, declined, pending, headcount } = demoCounts(now);

  if (/\/events\/[^/]+\/analytics/.test(path)) return { success: true, analytics: demoAnalytics(now) };

  /* The guest list is the ONE endpoint with a different envelope:
     dashboard/page.js reads `first.data.rsvps` and
     `first.meta.pagination.total`, not a top-level `rsvps`. Answering the
     flat shape leaves the screen on "NO GUESTS YET" with every counter at 0.
     Both shapes are returned so a caller reading either is served. */
  if (/\/events\/[^/]+\/rsvps/.test(path)) {
    const rows = demoGuestsApi(now);
    return {
      success: true,
      data: { rsvps: rows },
      meta: { pagination: { total: rows.length, page: 1, limit: rows.length, totalPages: 1 } },
      rsvps: rows,
    };
  }

  if (/\/events\/[^/]+\/tables/.test(path)) return { success: true, tables: DEMO_TABLES };
  if (/\/events\/[^/]+\/fields/.test(path)) return { success: true, fields: DEMO_FORM_FIELDS };
  if (/\/events\/[^/]+\/stats/.test(path)) {
    return {
      success: true,
      stats: {
        totalInvited: guests.length,
        attendingGuests: accepted.length,
        declinedGuests: declined.length,
        pendingGuests: pending.length,
        accepted: accepted.length,
        declined: declined.length,
        pending: pending.length,
        headcount,
        checkedInGuests: 0,
        mealSummary: DEMO_MEALS.reduce((acc, m) => {
          acc[m] = accepted.filter((g) => g.meal === m).reduce((n, g) => n + g.party_size, 0);
          return acc;
        }, {}),
      },
    };
  }
  if (/\/events\/[^/]+\/campaigns\/settings/.test(path)) return { success: true, access: 'open' };
  if (/\/events\/[^/]+$/.test(path)) return { success: true, event: buildDemoEvent({ now }) };
  if (/^\/events(\?|$)/.test(path)) return { success: true, events: demoEvents(now) };
  if (/^\/dashboard/.test(path)) return demoDashboard(now);
  if (/^\/auth\/profile/.test(path)) return DEMO_PROFILE;
  if (/^\/auth\/sessions/.test(path)) return { success: true, sessions: [] };
  if (/^\/referrals\//.test(path)) {
    return { success: true, referral: { code: 'YARA-2027', credits_cents: 0, referred: [] } };
  }
  if (/^\/checkin\//.test(path)) return { success: true, devices: [], staff: [] };

  return { success: true };
}

export {
  DEMO_EVENT_ID, DEMO_SLUG, DEMO_TITLE, DEMO_TIMEZONE, DEMO_MEALS,
  DEMO_VENUE, DEMO_VENUE_ADDRESS, DEMO_GUEST_NAME, DEMO_FORM_FIELDS,
  buildDemoEvent, eventInstant, rsvpDeadlineInstant,
};
