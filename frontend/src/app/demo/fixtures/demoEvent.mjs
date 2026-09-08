/* ═══════════════════════════════════════════════════════════════════════════
   THE DEMO WEDDING — one description, three stages, two consumers.

   Nadia & Omar, at Beit Al Qamar in Alexandria. The visitor opens their
   invitation in stage 1, administers their guest list in stage 2, and
   redecorates their invitation in stage 3. It is ONE wedding throughout,
   which is most of why the demo reads as a product rather than as three
   unrelated screenshots.

   The same description also feeds the walkthrough film (e2e/video/record.js
   answers every intercepted API call from demoOrganizer.mjs, which imports
   this file). A copy would let the film and the product's own demo disagree
   about the same wedding — which is exactly the drift the fixture header in
   the video pipeline warns about.

   ── WHY THE DATES ARE COMPUTED AND NOT TYPED ─────────────────────────────

   A hardcoded date goes stale, and a stale demo is worse than no demo: the
   countdown reads "0 days", the RSVP deadline has passed, and the form the
   whole demo exists to show refuses to open. Everything here is derived from
   ONE instant, `eventInstant()`, so the wedding is permanently ~11 weeks out.

   It is floored to UTC midnight before the offset is added. Without that,
   `Date.now()` on the server and `Date.now()` in the browser differ by a few
   hundred milliseconds, the countdown renders two different second values,
   and React reports a hydration mismatch on the one page that must look
   effortless.

   ── AND WHY IT IS MORE THAN 24 HOURS OUT ─────────────────────────────────

   `isSeatingRevealed()` (utils/seating.js) unlocks the seating lookup at
   event start − 24h, and the RSVP confirmation screen fetches a guest's
   table the moment it does. The demo has no server to answer that call, so
   the event must never fall inside the window. 78 days is not a taste
   decision at the boundary; it is the reason there is a boundary.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The public slug. `useGuestAnalytics` hard-skips this one, so a visitor
 *  wandering the demo never lands in anybody's funnel. */
export const DEMO_SLUG = 'demo-wedding';
export const DEMO_EVENT_ID = 'demo-nadia-omar';

/** The venue is in Alexandria, so the clock is Cairo's. Every guest-facing
 *  time formats against this; left on the platform default a 7:30 PM
 *  ceremony prints as 11:30 AM, which is true to the data and obviously
 *  wrong on screen. */
export const DEMO_TIMEZONE = 'Africa/Cairo';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC of the day this is called on — the same value on the server
 *  and in the browser for the whole of that day. */
function startOfUtcDay(now = Date.now()) {
  return Math.floor(now / DAY_MS) * DAY_MS;
}

/** The ceremony: 78 days out, 16:30Z — 7:30 PM in Cairo. */
export function eventInstant(now = Date.now()) {
  return new Date(startOfUtcDay(now) + 78 * DAY_MS + 16.5 * 60 * 60 * 1000);
}

/** Replies close a month before the day, which is what the FAQ says too. */
export function rsvpDeadlineInstant(now = Date.now()) {
  return new Date(eventInstant(now).getTime() - 30 * DAY_MS);
}

/* ── The couple ─────────────────────────────────────────────────────────── */

export const DEMO_PARTNER_1 = 'Omar';
export const DEMO_PARTNER_2 = 'Nadia';
export const DEMO_TITLE = 'Nadia & Omar';
export const DEMO_VENUE = 'Beit Al Qamar';
export const DEMO_VENUE_ADDRESS = '12 Corniche Road, Alexandria';
export const DEMO_VENUE_LAT = 31.2156;
export const DEMO_VENUE_LNG = 29.9553;

/** The addressee. Real invitations are addressed — the envelope prints the
 *  name on its face — so an anonymous demo hides half of what is on offer.
 *  Nour Haddad is also guest #1 of the organizer's list, and sits at Table 1,
 *  so the person the visitor plays in stage 1 is findable in stage 2. */
export const DEMO_GUEST_NAME = 'Nour Haddad';

/** The three dishes. ONE array: the invitation asks with it, the guest list
 *  tallies against it, and the analytics screen counts it. */
export const DEMO_MEALS = ['Beef Short Rib', 'Sea Bass', 'Wild Mushroom Risotto'];

/* ── The RSVP form the organizer built ──────────────────────────────────────
   `is_meal_field` is the source of truth findMealField() reads (and what
   submit_rsvp_v2 reads server-side), so the meal question is flagged rather
   than detected by its key. `condition: 'always'` asks even of a guest who
   declines; 'attending' is the default and asks only of those coming. */
export const DEMO_FORM_FIELDS = [
  {
    id: 'fld-meal',
    field_key: 'meal_selection',
    field_label: 'Choose your main course',
    field_type: 'select',
    options: DEMO_MEALS,
    is_required: true,
    is_meal_field: true,
    condition: 'attending',
    sort_order: 0,
  },
  {
    id: 'fld-song',
    field_key: 'song_request',
    field_label: 'One song that will get you on the dance floor',
    field_type: 'text',
    options: [],
    is_required: false,
    is_meal_field: false,
    condition: 'attending',
    sort_order: 1,
  },
  {
    id: 'fld-transport',
    field_key: 'shuttle',
    field_label: 'Would you like a seat on the shuttle from the city?',
    field_type: 'radio',
    options: ['Yes, please', 'No, I will drive'],
    is_required: false,
    is_meal_field: false,
    condition: 'attending',
    sort_order: 2,
  },
];

/* ── The page the guest actually scrolls ────────────────────────────────────
   Every key below is one HeritageArchPage reads. Sections whose data is
   absent hide themselves for a real guest, so anything left out here is a
   section the demo simply does not show — which is a content decision, not a
   bug. The demo runs with `isPreview` FALSE: what a visitor sees is what an
   organizer who typed exactly this would get, with no invented hotels. */
function templateData({ noKids, meals }) {
  return {
    groom_name: DEMO_PARTNER_1,
    bride_name: DEMO_PARTNER_2,
    title_ar: 'نادية وعمر',
    description_ar:
      'يسعدنا أن تشاركونا فرحتنا في ليلة نبدأ فيها فصلاً جديداً من حياتنا، على شاطئ الإسكندرية.',

    ha_meal_options: meals,
    ha_invited_to_city: 'Alexandria',
    ha_invited_to_lat: DEMO_VENUE_LAT,
    ha_invited_to_lng: DEMO_VENUE_LNG,

    ha_our_story:
      'We met on the last train out of Ramleh station, both of us running for '
      + 'the same closing door. Omar got there first and held it. Nadia has been '
      + 'telling him he was showing off ever since, and he has never once denied '
      + 'it. Nine years later we are asking you to the sea, on the evening we '
      + 'stop running for anything.',

    ha_days: [
      {
        label: 'The wedding',
        schedule: [
          { time: '19:30', label: 'Guests arrive', icon: 'watch' },
          { time: '20:15', label: 'Ceremony by the water', icon: 'rings' },
          { time: '21:30', label: 'Dinner is served', icon: 'plate' },
          { time: '23:00', label: 'Dancing', icon: 'ornament' },
        ],
        venue: {
          name: DEMO_VENUE,
          address: DEMO_VENUE_ADDRESS,
          lat: DEMO_VENUE_LAT,
          lng: DEMO_VENUE_LNG,
          image: null,
        },
      },
    ],

    ha_faq: [
      {
        question: 'When should I reply by?',
        answer: 'A month before the day. The dinner count goes to the kitchen that week, so a late yes is genuinely hard to add.',
      },
      {
        question: 'Where do I park?',
        answer: 'There is parking under the venue, and a shuttle from Mahatet Masr at 18:45. Tell us on the form and we will hold you a seat.',
      },
      {
        question: 'What should I wear?',
        answer: 'Formal, and shoes you can stand on stone in. The ceremony is outside on the terrace.',
      },
    ],

    /* Left deliberately unset, so the demo also shows what a section that
       hides itself looks like: ha_accommodation, ha_menu_courses,
       ha_things_to_do, registryUrl. */
    enabledSections: {},

    /* The one thing the guest page cannot infer. Kept in template_data as
       well as on the event so the customize panel only has to write in one
       place for the notice to appear. */
    no_kids: !!noKids,
  };
}

/**
 * The demo event, in the exact shape a saved event arrives in.
 *
 * Every argument is a real, organizer-settable field — there is no knob here
 * that the product does not have. That constraint is the whole point of the
 * customize stage: a control that changes something no organizer can change
 * is a lie told convincingly.
 *
 * @param {object}   [o]
 * @param {string}   [o.templateType]  a CINEMATIC_KEYS value; decides the cover
 * @param {object}   [o.customColors]  { primary, secondary, accent, background }
 * @param {string[]} [o.meals]         empty array ⇒ no meal question at all
 * @param {boolean}  [o.noKids]        renders AdultsOnlyNotice under the stepper
 * @param {boolean}  [o.trackGuestSide] renders the "whose side" picker
 * @param {boolean}  [o.collectDietary] the allergies block; on unless false
 * @param {number}   [o.now]           injectable clock, for tests
 */
export function buildDemoEvent({
  templateType = 'swans',
  customColors = { primary: '#33492f', secondary: '#6d6f4e', accent: '#5c2331', background: '#f8f4e9' },
  meals = DEMO_MEALS,
  noKids = true,
  trackGuestSide = false,
  collectDietary = true,
  now = Date.now(),
} = {}) {
  const mealList = Array.isArray(meals) ? meals.filter(Boolean) : [];
  /* No dishes ⇒ no meal question. Removing the field is what an organizer
     deleting it in the Form Builder actually does; leaving a flagged field
     with an empty options array would render an unanswerable required
     select. */
  const fields = mealList.length > 0
    ? DEMO_FORM_FIELDS.map((f) => (f.is_meal_field ? { ...f, options: mealList } : f))
    : DEMO_FORM_FIELDS.filter((f) => !f.is_meal_field);

  return {
    id: DEMO_EVENT_ID,
    slug: DEMO_SLUG,
    title: DEMO_TITLE,
    title_ar: 'نادية وعمر',
    event_type: 'wedding',
    template_type: templateType,
    status: 'published',

    description:
      'We are getting married on the Corniche, at the house Nadia’s '
      + 'grandmother grew up in, and we would like you there.',
    description_ar:
      'يسعدنا أن تشاركونا فرحتنا في ليلة نبدأ فيها فصلاً جديداً من حياتنا، على شاطئ الإسكندرية.',

    event_date: eventInstant(now).toISOString(),
    event_end_date: null,
    timezone: DEMO_TIMEZONE,
    rsvp_deadline: rsvpDeadlineInstant(now).toISOString(),

    location_name: DEMO_VENUE,
    location_address: DEMO_VENUE_ADDRESS,
    location_lat: DEMO_VENUE_LAT,
    location_lng: DEMO_VENUE_LNG,

    dress_code: 'Formal · the terrace is stone, so mind the heels',
    dress_code_ar: 'ملابس رسمية · التراس من الحجر، خُذوا الأحذية في الحسبان',

    custom_colors: customColors,
    template_data: templateData({ noKids, meals: mealList }),
    custom_form_fields: fields,

    no_kids_allowed: !!noKids,
    track_guest_side: !!trackGuestSide,
    collect_dietary_restrictions: collectDietary !== false,
    allow_guest_edits: true,

    /* No cover image and no gallery on purpose: the cinematic templates draw
       their own hero, and a stock photograph underneath one is the single
       fastest way to make a bespoke invitation look like a template. */
    cover_image_url: null,
    gallery_urls: [],

    /* Never. A page that starts playing music the moment a stranger opens it
       is a bug report, not a feature — the same rule the wizard preview
       follows. */
    background_music_url: null,

    reveal_enabled: true,
    is_paid: true,
    plan_key: 'signature',
    tier_name: 'Premium',
    guest_limit: 300,
  };
}
