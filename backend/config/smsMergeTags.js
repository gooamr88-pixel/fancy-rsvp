/**
 * SMS MERGE TAGS — what an organizer may put inside a custom message body, and
 * what each one is worth in characters.
 *
 * ── Why this file exists ──
 *
 * There WAS a tag list. `utils/smsSegments.js` exported:
 *
 *     const SUPPORTED_TAGS = ['name', 'url', 'rsvp_link', 'table_number',
 *                             'table', 'event', 'event_name'];
 *
 * It had zero callers — a leftover of the free-text campaign blaster removed in
 * the four-type rebuild — and it had drifted into fiction: `table_number` and
 * `event_name` name nothing any current template produces, `url` and `rsvp_link`
 * are two names for one value, and nothing in it could reach a guest's table,
 * their companions, their meals or their entry pass. Reviving that array as the
 * contract for a composer would have advertised seven tags of which three were
 * dead and four were duplicates.
 *
 * So the list is rebuilt here, against `config/smsMessageTypes.js` and the real
 * context objects `services/emailScheduler.js` and `services/invitationService.js`
 * actually pass to `renderSmsBody`. One row per tag, and the row carries
 * everything three separate consumers need:
 *
 *   • the composer UI, which renders the chips and their sample values
 *   • the renderer, which maps a tag onto the context field behind it
 *   • the segment estimator, which needs a WORST CASE, not a typical one
 *
 * ── `max` is the whole point of the table ──
 *
 * A body is priced per segment, and the organizer writes it against one sample
 * guest. "Hi {name}, your table is {table}" measures as one comfortable segment
 * with a sample of "Sara" and "12" — and bills three for a guest called
 * Abdulrahman Al-Mohammed Al-Otaibi seated at "Garden Terrace — Table 14".
 *
 * `max` is the cap `utils/smsTemplates.clip` already enforces on that field, so
 * the estimator can render the body at its true ceiling and quote the number the
 * organizer will actually be charged. These values are NOT independent — they
 * mirror the NAME_MAX / TITLE_MAX / TABLE_MAX / VENUE_MAX constants in
 * smsTemplates.js. Change one and the other must move with it, or the composer
 * quotes a price the sender does not pay.
 *
 * ── `types` ──
 *
 * Which message types can offer this tag. A tag is only offered where the
 * context genuinely carries it: `{table}` in an invitation would render empty,
 * because at invitation time nobody is seated yet. Advertising a tag that always
 * resolves to nothing is worse than omitting it — the organizer writes a
 * sentence around it and ships a message with a hole in the middle.
 */

/**
 * Derived from the registry rather than listed here. `{name}` and `{event}` are
 * the two tags every message of their audience carries by construction, so a
 * sixth type added to smsMessageTypes.js should inherit them without a second
 * edit in this file — the drift that produced the fictional list above started
 * exactly that way.
 */
const { GUEST_SMS_TYPE_KEYS, SMS_TYPE_KEYS } = require('./smsMessageTypes');

/**
 * @typedef  {object} MergeTag
 * @property {string}   tag      what the organizer types, without braces
 * @property {string}   field    the context key it reads
 * @property {string}   label    human name for the composer chip
 * @property {string}   sample   a REALISTIC value for the preview — not a short one
 * @property {number}   max      clip ceiling, mirroring utils/smsTemplates
 * @property {string[]} types    message types that offer this tag
 * @property {boolean} [isLink]  a URL, so the estimator substitutes a shortened one
 */

/** @type {MergeTag[]} */
const SMS_MERGE_TAGS = [
  {
    tag: 'name',
    field: 'guestName',
    label: 'Guest name',
    // Deliberately long. A sample of "Sara" makes every body look like one
    // segment; this is what the composer must show so the price is honest.
    sample: 'Abdulrahman Al-Otaibi',
    max: 24,
    types: GUEST_SMS_TYPE_KEYS,
  },
  {
    tag: 'event',
    field: 'eventTitle',
    label: 'Event title',
    sample: 'The Wedding of Sara & Khalid',
    max: 40,
    types: SMS_TYPE_KEYS,
  },
  {
    tag: 'date',
    field: 'dateLabel',
    label: 'Date & time',
    sample: 'Saturday, 12 September at 7:00 PM',
    // 34, not 40: the confirmation template clips dateLabel tighter than the
    // title because it is the one body carrying a venue and two lists as well.
    max: 34,
    types: ['seating_reminder', 'rsvp_confirmation', 'event_update'],
  },
  {
    tag: 'venue',
    field: 'venue',
    label: 'Venue',
    sample: 'The Grand Ballroom, Hilton Bayfront',
    max: 48,
    types: ['rsvp_confirmation'],
  },
  {
    tag: 'table',
    field: 'tableName',
    label: 'Table',
    // Organizers name tables, they do not number them. "12" is the sample that
    // makes a body look cheap; this is the one that prices it correctly.
    sample: 'Garden Terrace 14',
    max: 20,
    types: ['seating_reminder', 'rsvp_confirmation'],
  },
  {
    tag: 'companions',
    field: 'companions',
    label: 'Who is with them',
    sample: 'Noura Al-Otaibi, Faisal Al-Otaibi +2 more',
    /**
     * A LIST tag: `list` carries the per-entry cap and how many entries survive
     * before a "+N more" tail, and `max` is the RENDERED ceiling those produce.
     *
     * The two must agree, and getting it wrong is not a rounding error. `max`
     * was 62 against a clipList ceiling of ~66, so buildTagValues clipped the
     * already-capped string a second time and ate the tail: a party of twelve
     * rendered "Noura, Faisal, Maha..." — three names and no indication that
     * nine more people were coming. It spared `{meals}` (86 under a max of 96),
     * so the defect showed on one tag and not the other and read as data.
     *
     * 69 = 3 entries x 18 + 2 separators x 2 + the longest plausible tail
     * (" +9999 more" = 11).
     */
    list: { each: 18, keep: 3 },
    max: 69,
    types: ['rsvp_confirmation'],
  },
  {
    tag: 'meals',
    field: 'meals',
    label: 'Meals ordered',
    sample: 'Grilled sea bass, Beef tenderloin +2 more',
    // 4 x 22 + 3 x 2 + 11. See the note on companions.
    list: { each: 22, keep: 4 },
    max: 105,
    types: ['rsvp_confirmation'],
  },
  {
    tag: 'rsvp_link',
    field: 'rsvpUrl',
    label: 'RSVP link',
    // A REAL shortened link, at the real length shortLinks produces. The raw
    // URL is ~89 characters and quoting the body against that would tell the
    // organizer a two-segment message costs four.
    sample: 'https://fncy.rs/a1b2c3d',
    max: 32,
    isLink: true,
    types: ['invitation'],
  },
  {
    tag: 'pass_link',
    field: 'ticketUrl',
    label: 'Entry pass link',
    sample: 'https://fncy.rs/a1b2c3d',
    max: 32,
    isLink: true,
    types: ['seating_reminder', 'rsvp_confirmation'],
  },
  {
    tag: 'event_link',
    field: 'url',
    label: 'Event page link',
    sample: 'https://fncy.rs/a1b2c3d',
    max: 32,
    isLink: true,
    types: ['event_update'],
  },
  {
    tag: 'attending',
    field: 'attending',
    label: 'Confirmed count',
    sample: '184',
    max: 6,
    types: ['organizer_report'],
  },
  {
    tag: 'pending',
    field: 'pending',
    label: 'Not replied count',
    sample: '37',
    max: 6,
    types: ['organizer_report'],
  },
  {
    tag: 'dashboard_link',
    field: 'dashboardUrl',
    label: 'Dashboard link',
    sample: 'https://fncy.rs/a1b2c3d',
    max: 32,
    isLink: true,
    types: ['organizer_report'],
  },
];

const _byTag = new Map(SMS_MERGE_TAGS.map((t) => [t.tag, t]));

/** The tags a given message type may use, in registry order. */
function tagsForType(type) {
  return SMS_MERGE_TAGS.filter((t) => t.types.includes(type));
}

/** One tag by name, or null. Case-insensitive, matching renderTemplate. */
function getMergeTag(tag) {
  return _byTag.get(String(tag || '').toLowerCase()) || null;
}

/**
 * A values map for `utils/smsSegments.renderTemplate`, built from a live
 * context object.
 *
 * Two things happen here that a caller must not be trusted to remember:
 *
 *  • Arrays are joined. `companions` and `meals` arrive as arrays from the
 *    scheduler; dropped into a string template raw they would render
 *    "Sara,Noura" with no spaces, or "[object Object]" for anything unexpected.
 *  • Every value is clipped to the tag's `max` BEFORE substitution — the same
 *    ceiling the built-in templates enforce. Without this an organizer's custom
 *    body is the one path in the system where a long guest name can still
 *    double the bill for the whole list.
 *
 * Tags whose context field is absent resolve to '' rather than being left
 * intact. That is the opposite of renderTemplate's default for UNKNOWN tags,
 * and the difference is intentional: an unknown tag is a typo the organizer
 * should see, while a known tag with no value for this guest (no table yet, no
 * companions) is an ordinary empty.
 */
function buildTagValues(type, context = {}, { clip, clipList } = {}) {
  const values = {};
  for (const tag of tagsForType(type)) {
    const raw = context[tag.field];

    if (Array.isArray(raw) || tag.list) {
      /**
       * A LIST IS CAPPED ONCE, BY clipList, AND NEVER CLIPPED AGAIN.
       *
       * clipList already truncates each entry, drops the overflow and appends
       * "+N more". Passing its output through `clip` afterwards re-truncates the
       * whole string — and what sits at the end of that string is the tail,
       * which is the one part carrying the information the cap removed.
       *
       * The per-entry limits come from the tag's own `list` descriptor rather
       * than an inline ternary on the tag name, so adding a third list tag is a
       * table edit rather than a condition somebody has to notice.
       */
      const entries = Array.isArray(raw) ? raw : [];
      values[tag.tag] = clipList
        ? clipList(entries, tag.list.each, tag.list.keep)
        : entries.join(', ');
      continue;
    }

    const value = (raw === null || raw === undefined) ? '' : String(raw);
    values[tag.tag] = clip && value ? clip(value, tag.max) : value;
  }
  return values;
}

/**
 * The worst-case values map — every tag at its `max`, links at real shortened
 * length. What the estimator measures so the quoted segment count is a ceiling
 * rather than a typical case.
 */
function worstCaseTagValues(type) {
  const values = {};
  for (const tag of tagsForType(type)) {
    values[tag.tag] = tag.isLink
      ? tag.sample
      : tag.sample.length >= tag.max
        ? tag.sample.slice(0, tag.max)
        // Pad a short sample out to its ceiling so the measurement is a true
        // worst case. 'x' is GSM-7 and single-width in both alphabets.
        : tag.sample + 'x'.repeat(tag.max - tag.sample.length);
  }
  return values;
}

/**
 * A CONTEXT object (field-keyed) of sample values, for previewing the BUILT-IN
 * body of a type.
 *
 * Distinct from `worstCaseTagValues`, which is tag-keyed and feeds
 * `renderTemplate`. The built-in bodies are functions taking a context —
 * `({ guestName, eventTitle, tableName }) => …` — so previewing one needs the
 * other shape, and the two must be derived from the same table or the composer
 * shows a default that measures differently from the default that ships.
 *
 * `companions` and `meals` are handed back as ARRAYS, because that is what the
 * built-in templates receive and what `clipList` expects. Passing the joined
 * string would render "Noura, Faisal +2 more" through a list-joiner a second
 * time and quietly change the sample's length.
 */
function sampleContext(type) {
  const context = {};
  for (const tag of tagsForType(type)) {
    if (tag.tag === 'companions') {
      context[tag.field] = ['Noura Al-Otaibi', 'Faisal Al-Otaibi', 'Maha Al-Otaibi', 'Omar Al-Otaibi', 'Lina Al-Otaibi'];
    } else if (tag.tag === 'meals') {
      context[tag.field] = ['Grilled sea bass', 'Beef tenderloin', 'Wild mushroom risotto', 'Lamb kofta', 'Vegetarian mezze'];
    } else {
      context[tag.field] = tag.sample;
    }
  }
  return context;
}

/**
 * The WORST-CASE context — every field at the ceiling `clip` will allow.
 *
 * The field-keyed twin of `worstCaseTagValues`, and the two exist for the same
 * reason at opposite ends: that one prices a body the ORGANIZER wrote (which
 * still contains `{tags}`), this one prices a body WE wrote (which is a
 * function, and has to be rendered against a context to produce a string).
 *
 * ── WHY sampleContext CANNOT BE USED FOR MEASUREMENT ──
 *
 * It was, and it understated. `sampleContext` supplies realistic values —
 * "Abdulrahman Al-Otaibi" is 21 characters against a 24-character cap — so a
 * body measured through it is a typical case wearing the label of a ceiling.
 * Measured properly the Arabic `rsvp_confirmation` is EIGHT segments, not the
 * seven the sample reported: a whole segment per guest, on the single most
 * expensive message this platform sends, missing from the quoted price.
 *
 * Lists are handed 20 over-long entries so clipList produces its own longest
 * output (the kept entries at their cap, plus the "+N more" tail).
 */
function maxContext(type) {
  const context = {};
  for (const tag of tagsForType(type)) {
    if (tag.list) {
      context[tag.field] = Array.from({ length: 20 }, () => 'W'.repeat(tag.list.each + 10));
    } else if (tag.isLink) {
      // Already the real shortened length; padding would price a URL that
      // shortLinks cannot produce.
      context[tag.field] = tag.sample;
    } else if (tag.sample.length >= tag.max) {
      context[tag.field] = tag.sample.slice(0, tag.max);
    } else {
      context[tag.field] = tag.sample + 'x'.repeat(tag.max - tag.sample.length);
    }
  }
  return context;
}

module.exports = {
  SMS_MERGE_TAGS,
  sampleContext,
  maxContext,
  tagsForType,
  getMergeTag,
  buildTagValues,
  worstCaseTagValues,
};
