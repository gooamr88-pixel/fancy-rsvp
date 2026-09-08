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

/* ── WHAT NADIA AND OMAR ARE CELEBRATING ────────────────────────────────────

   THE REASON THIS EXISTS: Velvet Ring declares `occasions: ['engagement']`
   and nothing can override that — `resolveOccasion` and `getCinematicOccasion`
   both CLAMP a stored occasion to what the template allows, on read. So an
   event rendered on Velvet Ring is an engagement whatever the row says.

   Until this map, the fixture was a wedding and only a wedding. Opening
   Velvet Ring from the collection therefore printed an ENGAGEMENT kicker over
   a page that said, in the organizer's own words, "We are getting married on
   the Corniche" — the cover and the prose disagreeing about the same evening,
   which is exactly the class of mistake the occasion catalogue was built to
   remove and would have been introduced by the one page most likely to be
   looked at closely.

   It is the SAME couple, the same house and the same sea in both. Only what
   is being celebrated changes, because that is the only thing the template
   actually constrains — and one couple across every template is most of why
   the demo reads as a product rather than as four unrelated screenshots.

   NOT DERIVED HERE. Which occasion a template implies is `defaultOccasionFor`
   in utils/eventOccasion.js, and resolving it there would mean importing that
   module — which imports cinematicThemes.js, which imports react-dom. This
   file is a dependency-free fixture, read by tests and by the demo alike, and
   it stays that way: the CALLER resolves the occasion and passes it in. The
   collection catalogue already carries the answer on every item. */
export const DEMO_OCCASION_COPY = {
  wedding: {
    eventType: 'wedding',
    dayLabel: 'The wedding',
    ceremonyLabel: 'Ceremony by the water',
    description:
      'We are getting married on the Corniche, at the house Nadia’s '
      + 'grandmother grew up in, and we would like you there.',
    descriptionAr:
      'يسعدنا أن تشاركونا فرحتنا في ليلة نبدأ فيها فصلاً جديداً من حياتنا، على شاطئ الإسكندرية.',
    story:
      'We met on the last train out of Ramleh station, both of us running for '
      + 'the same closing door. Omar got there first and held it. Nadia has been '
      + 'telling him he was showing off ever since, and he has never once denied '
      + 'it. Nine years later we are asking you to the sea, on the evening we '
      + 'stop running for anything.',
  },
  engagement: {
    eventType: 'engagement',
    dayLabel: 'The engagement',
    ceremonyLabel: 'The rings, by the water',
    description:
      'We are getting engaged on the Corniche, at the house Nadia’s '
      + 'grandmother grew up in, and we would like you there.',
    descriptionAr:
      'يسعدنا أن تشاركونا فرحتنا في ليلة نعلن فيها خطوبتنا، على شاطئ الإسكندرية.',
    story:
      'We met on the last train out of Ramleh station, both of us running for '
      + 'the same closing door. Omar got there first and held it. Nadia has been '
      + 'telling him he was showing off ever since, and he has never once denied '
      + 'it. Nine years later he asked her properly, and she said yes before he '
      + 'had finished.',
  },
};

/** The wedding, unless a caller says otherwise. Every existing caller — the
 *  three demo stages, the organizer fixture, the tests — passes nothing and
 *  gets exactly the event it has always got. */
const DEFAULT_OCCASION = 'wedding';

/* ── The page the guest actually scrolls ────────────────────────────────────
   Every key below is one HeritageArchPage reads. Sections whose data is
   absent hide themselves for a real guest, so anything left out here is a
   section the demo simply does not show — which is a content decision, not a
   bug. The demo runs with `isPreview` FALSE: what a visitor sees is what an
   organizer who typed exactly this would get, with no invented hotels. */
function templateData({ noKids, meals, copy, occasion, letterHeroPhoto, letterTextPos }) {
  return {
    groom_name: DEMO_PARTNER_1,
    bride_name: DEMO_PARTNER_2,
    title_ar: 'نادية وعمر',
    description_ar: copy.descriptionAr,

    /* The organizer's own answer to "what is this". Every renderer clamps it
       to what the template allows before using it (resolveOccasion,
       getCinematicOccasion), so a value the template refuses is corrected
       rather than obeyed — this is the fixture stating its intent, not
       overriding policy. */
    custom_category: occasion,

    /* SEALED LETTER'S FOLD, and nothing else reads these five keys.
       `letter_hero_photo` null is a supported, finished state — see the note
       on the parameter — so these are written unconditionally rather than
       spread in behind a check: an absent key and a null key mean the same
       thing to LetterPortraitHero, and a conditional spread here would be
       one more branch for no difference. */
    letter_hero_photo: letterHeroPhoto || null,
    letter_hero_focus: 'center',
    letter_hero_text_pos: letterTextPos,
    letter_hero_caption: null,
    letter_hero_caption_sub: null,

    ha_meal_options: meals,
    ha_invited_to_city: 'Alexandria',
    ha_invited_to_lat: DEMO_VENUE_LAT,
    ha_invited_to_lng: DEMO_VENUE_LNG,

    ha_our_story: copy.story,

    ha_days: [
      {
        label: copy.dayLabel,
        schedule: [
          { time: '19:30', label: 'Guests arrive', icon: 'watch' },
          { time: '20:15', label: copy.ceremonyLabel, icon: 'rings' },
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
 * @param {string}   [o.occasion]      a DEMO_OCCASION_COPY key; decides the words.
 *                                     The CALLER resolves this from the template
 *                                     (defaultOccasionFor, or the collection
 *                                     catalogue's own `occasion`) — see the note
 *                                     on DEMO_OCCASION_COPY for why not here.
 * @param {object}   [o.customColors]  { primary, secondary, accent, background }
 * @param {string}   [o.letterHeroPhoto] Sealed Letter's fold. THIS FIELD AND NOT
 *                                     `cover_image_url`: HeritageArchPage passes
 *                                     the cover to its own framed section as
 *                                     well, so using it here would print the
 *                                     same picture twice on one page. Sealed
 *                                     Letter is the only template that reads it,
 *                                     and the only one that ships no artwork of
 *                                     its own — with none it renders a
 *                                     typographic hero, which is finished but is
 *                                     not what the template is for.
 * @param {string}   [o.letterTextPos] 'top' | 'center' | 'bottom' — which edge
 *                                     the words sit against, and therefore which
 *                                     edge the scrim is drawn from.
 * @param {string[]} [o.meals]         empty array ⇒ no meal question at all
 * @param {boolean}  [o.noKids]        renders AdultsOnlyNotice under the stepper
 * @param {boolean}  [o.trackGuestSide] renders the "whose side" picker
 * @param {boolean}  [o.collectDietary] the allergies block; on unless false
 * @param {number}   [o.now]           injectable clock, for tests
 */
export function buildDemoEvent({
  templateType = 'swans',
  occasion = DEFAULT_OCCASION,
  customColors = { primary: '#33492f', secondary: '#6d6f4e', accent: '#5c2331', background: '#f8f4e9' },
  letterHeroPhoto = null,
  letterTextPos = 'bottom',
  meals = DEMO_MEALS,
  noKids = true,
  trackGuestSide = false,
  collectDietary = true,
  now = Date.now(),
} = {}) {
  /* An occasion this fixture has no words for falls back to the wedding
     rather than rendering `undefined` into the couple's own story. The
     catalogue has 25 occasions and this fixture is written for two; that is
     a content limit, not a bug, and it must fail soft. */
  const copy = DEMO_OCCASION_COPY[occasion] || DEMO_OCCASION_COPY[DEFAULT_OCCASION];
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
    event_type: copy.eventType,
    template_type: templateType,
    status: 'published',

    description: copy.description,
    description_ar: copy.descriptionAr,

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
    template_data: templateData({
      noKids, meals: mealList, copy, occasion, letterHeroPhoto, letterTextPos,
    }),
    custom_form_fields: fields,

    no_kids_allowed: !!noKids,
    track_guest_side: !!trackGuestSide,
    collect_dietary_restrictions: collectDietary !== false,
    allow_guest_edits: true,

    /* No cover image and no gallery on purpose: the cinematic templates draw
       their own hero, and a stock photograph underneath one is the single
       fastest way to make a bespoke invitation look like a template.

       Sealed Letter's photograph does NOT go here. It is
       `template_data.letter_hero_photo` — see the parameter note above and
       the one on HeritageArchPage's heroPhoto prop: the cover gets its own
       framed section further down the page, so putting the fold's picture
       here would print it twice. */
    cover_image_url: null,
    gallery_urls: [],

    /* Never. A page that starts playing music the moment a stranger opens it
       is a bug report, not a feature — the same rule the wizard preview
       follows. */
    background_music_url: null,

    reveal_enabled: true,
    is_paid: true,
    /* NO `plan_key`. It was here, and there is no such column: the schema
       identifies a plan by `tier_key`, and nothing in the product reads
       `plan_key` at all. A fixture that claims to be "the exact shape a saved
       event arrives in" must not invent a field — that is how the next person
       writes code against one. */
    tier_name: 'Premium',
    guest_limit: 300,
  };
}
