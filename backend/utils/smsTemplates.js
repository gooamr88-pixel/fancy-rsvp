/**
 * SMS bodies for every message type, in English and Arabic.
 *
 * ── Why these are terse to the point of looking unfinished ──
 *
 * Carriers bill per SEGMENT, and the organizer's allowance is denominated in
 * segments. A GSM-7 segment holds 160 characters, but the mandatory compliance
 * footer that smsDispatch appends to every body — " - Fancy RSVP. Msg&data rates
 * may apply. Reply STOP to opt out, HELP for help." — is 77 of them before the
 * message says anything at all. Roughly 80 characters remain inside one segment;
 * a single word past that DOUBLES the cost of every message to every guest.
 *
 * Arabic is far tighter still: it forces UCS-2, where a segment holds 70
 * characters total and the (English, unavoidable) footer alone overflows it. Two
 * segments is the practical floor for an Arabic message, which is exactly what
 * smsEstimator prices in.
 *
 * ── "Make them beautiful" and "keep them one segment" are the same instruction ──
 *
 * The obvious way to make a text feel premium is to put more in it: the venue,
 * the dress code, the timings, a warm sentence. Every one of those is three to
 * four segments in English and six to eight in Arabic — which triples an
 * organizer's bill to produce a wall of grey text in a notification shade, which
 * is the opposite of premium.
 *
 * So the craft goes somewhere better. The SMS carries the guest's name, the one
 * fact that moment is about, and a link — and the LINK opens the full invitation
 * reveal, which is already the most polished thing this product makes. A phone
 * that opens a wax seal and an animated card is a far stronger impression than
 * any amount of text could be, and it costs one segment to deliver.
 *
 * ── Truncation ──
 *
 * Guest names and event titles are organizer/guest-supplied and unbounded. Left
 * raw, one long title turns a one-segment message into four, for the entire guest
 * list. Every interpolated value goes through `clip`.
 *
 * ── Plain words, not short words ──
 *
 * These are read by people of every age, on a lock screen, often in a second
 * language, frequently while standing outside a venue. So the vocabulary is
 * deliberately ordinary: "Your table is 12" rather than "Your table: 12",
 * "Show this at the door" rather than "Entry pass", "you are coming to" rather
 * than "you're confirmed for", "128 said yes" rather than "128 attending".
 * Product nouns ("entry pass", "seating map") are things this company named; a
 * table and a door are things everybody already knows.
 *
 * ── Friendly, and where the warmth is paid for ──
 *
 * A bare name and a comma — "Sara, you're invited" — is how a bank opens a
 * message. The English bodies open "Hi Sara!" instead: four characters, and the
 * single cheapest thing here that makes a text read as coming from a person.
 * English can afford it (2 segments hold 306 GSM-7 units and the longest body
 * uses ~245).
 *
 * ARABIC CANNOT. Measured at worst case, several Arabic bodies sit 2-4 units
 * under a segment boundary, so a single added word costs a whole segment for
 * every guest. Its warmth therefore comes from word CHOICE at equal or shorter
 * length: "مدعو معانا" (invited with us) for "أنت مدعو إلى" (you are invited
 * to), "طاولتك" for "مكانك طاولة", "معاك" for "معك", "تمام!" paid for by the
 * two words those swaps removed. The Arabic bodies got friendlier and SHORTER.
 *
 * One exception, deliberate: the cancellation does NOT open with a greeting and
 * carries no exclamation mark. "Hi Sara!" in front of "your wedding is
 * cancelled" reads as a mistake, and "cancelled" has to stay inside the first
 * six words where a skim-reader on a lock screen will see it.
 *
 * ── THE RULE WHEN EDITING COPY HERE: re-measure ──
 *
 * Plainer and friendlier are usually also longer, and length is billed. This is
 * no longer an honour system: `test/smsCopyBudget.test.js` renders every body at
 * worst case — every interpolated value at its clip cap, plus the real
 * compliance footer and a real shortened link — and fails on any wording that
 * crosses a segment boundary or leaves GSM-7. The friendlier rewrite above was
 * verified segment-for-segment identical to the copy it replaced, in both
 * languages, across all twenty branches.
 *
 * Raising a ceiling in that test is allowed. It is a pricing decision, and
 * editing the number there is how it gets made on purpose rather than by
 * accident.
 */

/* Module scope, and it has to be. `renderSmsBody` reaches for both partway
   through its body, and a require() inside the function would sit in the
   temporal dead zone of nothing — but would re-resolve the module on every
   single send, which on a 2,000-guest campaign is 2,000 cache lookups to fetch
   two functions that never change. No cycle: smsMergeTags reads the type
   registry, and the type registry reads nothing from here. */
const { renderTemplate } = require('./smsSegments');
const { buildTagValues } = require('../config/smsMergeTags');

const EN = 'en';
const AR = 'ar';

/**
 * Hard cap on any interpolated value, so one long title cannot inflate a whole send.
 *
 * ── THE MARKER IS THREE ASCII DOTS, AND THAT IS NOT A STYLE CHOICE ──
 *
 * This used to append '…' (U+2026). That single character is not in the GSM-7
 * alphabet, so appending it flipped the ENTIRE message to UCS-2 — where a
 * segment holds 67 units instead of 153. Measured on the real invitation body
 * with the real compliance footer:
 *
 *   guest name 24 chars (no truncation)   GSM-7   2 segments
 *   guest name 25 chars (truncation)      UCS-2   4 segments
 *
 * One character past the cap DOUBLED the cost of that guest's message. The
 * function whose entire purpose is protecting the segment budget was the thing
 * blowing it, and silently: nothing errors, the text looks right, and the bill
 * arrives later. It fires on exactly the guests with the longest names and the
 * events with the longest titles.
 *
 * '...' costs two more characters than '…' and keeps the message in GSM-7,
 * which is worth roughly 80 characters of headroom. Any future marker must be
 * checked against GSM_BASIC in utils/smsSegments — see the encoding test in
 * test/smsCopyBudget.test.js.
 */
function clip(value, max) {
  const s = String(value == null ? '' : value).trim();
  if (s.length <= max) return s;
  // Below four characters there is no room for both the text and the marker, so
  // the marker goes. Without this the "cap" RETURNS MORE than the cap it was
  // given ("..." is three characters against a max of two) — a length guard that
  // can exceed its own limit is worse than none, because every caller trusts it.
  // Not reachable from today's callers (the smallest cap here is 18); pinned
  // anyway, since the whole point of this function is that the arithmetic holds.
  if (max < 4) return s.slice(0, Math.max(0, max));
  return `${s.slice(0, max - 3).trimEnd()}...`;
}

const NAME_MAX = 24;
const TITLE_MAX = 40;
const TABLE_MAX = 20;
/* Only the confirmation template uses these — it is the one message that carries
   a venue and lists of people and dishes. */
const VENUE_MAX = 48;
const COMPANION_MAX = 18;
const MEAL_MAX = 22;

/**
 * Join a list for a text message, capped in BOTH directions.
 *
 * Each entry is clipped, and the list itself stops at `max` with a "+N more"
 * tail. Uncapped, a party of twelve with long names takes the confirmation from
 * 3 segments to 9 — tripling the bill for the whole guest list, and doing it
 * worst for exactly the large families who most want to read the names.
 *
 * Returns '' for nothing usable, so the caller can omit the clause entirely
 * rather than emitting "With you: ." — an empty label still costs characters.
 */
function clipList(values, each, max) {
  const list = (Array.isArray(values) ? values : [])
    .map((v) => clip(v, each))
    .filter(Boolean);
  if (list.length === 0) return '';
  if (list.length <= max) return list.join(', ');
  return `${list.slice(0, max).join(', ')} +${list.length - max} more`;
}

/**
 * body builders, keyed by message type then language.
 *
 * Each receives a context object and returns the message WITHOUT the compliance
 * footer — smsDispatch appends that centrally so it can never be forgotten or
 * duplicated.
 */
const TEMPLATES = {
  /**
   * THE INVITATION. Sent when the organizer presses send, never automatically.
   *
   * Deliberately says almost nothing beyond who it is from and where to look.
   * The date, the venue, the dress code, the RSVP form and the reveal animation
   * are all on the other side of the link, laid out properly, in the event's own
   * design. Repeating any of them here costs a segment per guest to say something
   * worse than the page already says.
   */
  invitation: {
    [EN]: ({ guestName, eventTitle, rsvpUrl }) => {
      const who = clip(guestName, NAME_MAX);
      const what = clip(eventTitle, TITLE_MAX);
      // "Hi <name>!" rather than "<name>," — a bare name and a comma is how a
      // bank opens a message. The greeting is 4 characters and it is the single
      // cheapest thing here that makes a text read as coming from a person.
      return `Hi ${who}! You're invited to ${what}. Open your invitation and reply here: ${rsvpUrl}`;
    },
    [AR]: ({ guestName, eventTitle, rsvpUrl }) => {
      const who = clip(guestName, NAME_MAX);
      const what = clip(eventTitle, TITLE_MAX);
      // "مدعو معانا" — invited WITH US, not "you are invited to", which is the
      // register of an official summons. Warmer, and one unit shorter, which is
      // the only reason it is affordable: see the Arabic budget note above.
      return `${who}، مدعو معانا في ${what}. دعوتك هنا: ${rsvpUrl}`;
    },
  },

  /**
   * TABLE & ENTRY PASS. Fires once, two hours before the doors open.
   *
   * Three shapes, because three genuinely different things can be true:
   *   • seated, and the event is imminent  → date + table + pass
   *   • seated, weeks out                  → table + pass
   *   • no seating chart at all            → pass only
   *
   * The third is why this type replaced the old entry-pass type rather than
   * sitting beside it. A standing reception has no tables, and a guest there
   * still needs the thing that gets them through the door.
   */
  seating_reminder: {
    /**
     * ── THERE IS NO "your table has changed" WORDING ANY MORE ──
     *
     * There was, and it earned its 11 characters: a guest who is MOVED cannot
     * be told in the same words as last time, or the message reads as a
     * duplicate and they keep believing the table it was sent to correct.
     *
     * It went when the seating text did. This type now fires from exactly one
     * scheduled place — jobSmsEventReminders, two hours before the event — and
     * that is a guest's FIRST and only text about their table, so there is
     * nothing for it to contradict. A move between now and then is carried by
     * email, which has its own change wording. Re-adding a `changed` flag here
     * without a caller that can set it would be dead copy the budget still pays
     * for.
     *
     * It is also manually sendable (invitationService.MANUAL_SMS_TYPES), and
     * that does not reintroduce the problem: an organizer pressing send is
     * choosing to say this again, which is the case the retired wording existed
     * to handle automatically and badly.
     */
    [EN]: ({ guestName, eventTitle, tableName, ticketUrl, dateLabel }) => {
      const who = clip(guestName, NAME_MAX);
      const what = clip(eventTitle, TITLE_MAX);
      const table = tableName ? clip(tableName, TABLE_MAX) : null;
      // "is on Saturday" — the "on" costs three characters and is what stops
      // the sentence reading like a timetable entry.
      const when = dateLabel ? ` is on ${dateLabel}` : '';
      // "Your table is 12" rather than "You are at table 12": fewer words, and
      // it answers the question the guest is actually asking.
      if (table && when) return `Hi ${who}! ${what}${when}. Your table is ${table}. Show this at the door: ${ticketUrl}`;
      if (table) return `Hi ${who}! Your table at ${what} is ${table}. Show this at the door: ${ticketUrl}`;
      if (when) return `Hi ${who}! ${what}${when}. Show this at the door: ${ticketUrl}`;
      return `Hi ${who}! Show this at the door for ${what}: ${ticketUrl}`;
    },
    [AR]: ({ guestName, eventTitle, tableName, ticketUrl, dateLabel }) => {
      const who = clip(guestName, NAME_MAX);
      const what = clip(eventTitle, TITLE_MAX);
      const table = tableName ? clip(tableName, TABLE_MAX) : null;
      const when = dateLabel ? ` ${dateLabel}` : '';
      /**
       * The Arabic leg says "تذكرتك" where the English says "Show this at the
       * door", and that asymmetry is a budget decision, not an oversight.
       *
       * Arabic forces UCS-2: 67 units per segment against GSM-7's 153. The
       * English body has ~100 units of slack inside its two segments and can
       * afford the longer, plainer instruction. The Arabic one sits ~15 units
       * under its third segment boundary, so the same phrase (+5 units over the
       * old wording) would tip a realistic message to four segments — a third
       * more, for every guest, on every event. "تذكرتك" is both the plainer
       * word AND six units shorter than the "تذكرة الدخول" it replaces, so this
       * reads more simply and costs less than what was here before.
       */
      // "طاولتك" (your table) rather than "مكانك طاولة" (your place is table N):
      // one word instead of two, plainer, and it buys back the units the warmer
      // wording elsewhere spends.
      //
      // The "تغيّرت طاولتك" (your table has changed) variants went with the
      // seating text — see the note on the English leg. Their removal also buys
      // back the ~7 UCS-2 units they cost, which mattered here: this leg sat
      // about 15 units under its third segment boundary.
      if (table && when) return `${who}، ${what}${when}. طاولتك ${table}. تذكرتك: ${ticketUrl}`;
      if (table) return `${who}، طاولتك في ${what} هي ${table}. تذكرتك: ${ticketUrl}`;
      if (when) return `${who}، ${what}${when}. تذكرتك: ${ticketUrl}`;
      return `${who}، تذكرتك لـ ${what}: ${ticketUrl}`;
    },
  },

  /**
   * THE CONFIRMATION, WITH THE DETAIL IN IT.
   *
   * ── This one breaks the one-segment rule on purpose ──
   *
   * Every other template here is terse because a segment costs money and the link
   * can carry the detail. This one was asked for the other way round: the
   * organizer wants the guest to be able to READ their table, their companions and
   * their meals in the notification shade without tapping anything, because the
   * alternative is answering the same questions by hand on WhatsApp, one guest at
   * a time.
   *
   * The cost of that decision was measured, not guessed, with utils/smsSegments
   * and the real 78-character footer:
   *
   *   full detail  EN  3 segments   9c/guest    200 guests = $18.00
   *   full detail  AR  6 segments  18c/guest    200 guests = $36.00
   *   short + link EN  2 segments   6c/guest    200 guests = $12.00
   *   short + link AR  3 segments   9c/guest    200 guests = $18.00
   *
   * So roughly 1.5x in English and 2x in Arabic — a real cost, and a modest one
   * against the support burden it removes. The registry weight (1.6) is set from
   * these numbers so the allowance estimator quotes for it honestly.
   *
   * ── What it still refuses to do ──
   *
   * Every interpolated value is clipped and every LIST is capped. A party of
   * twelve with long names would otherwise walk this from 3 segments to 9 — and
   * the guest who most needs to read their companions is in exactly that party.
   * Past the cap it says "+4 more", and the link carries the rest.
   */
  rsvp_confirmation: {
    [EN]: ({ guestName, eventTitle, dateLabel, venue, tableName, companions, meals, ticketUrl }) => {
      const parts = [`Hi ${clip(guestName, NAME_MAX)}! You are coming to ${clip(eventTitle, TITLE_MAX)}`];
      if (dateLabel) parts.push(` on ${clip(dateLabel, 34)}`);
      if (venue) parts.push(` at ${clip(venue, VENUE_MAX)}`);
      parts.push('.');
      if (tableName) parts.push(` Your table is ${clip(tableName, TABLE_MAX)}.`);
      const withYou = clipList(companions, COMPANION_MAX, 3);
      // "Coming with you" rather than "With you" — the bare label reads like a
      // form field, and this is the line guests forward to their family.
      if (withYou) parts.push(` Coming with you: ${withYou}.`);
      const food = clipList(meals, MEAL_MAX, 4);
      if (food) parts.push(` Food: ${food}.`);
      if (ticketUrl) parts.push(` Your pass and map: ${ticketUrl}`);
      return parts.join('');
    },
    [AR]: ({ guestName, eventTitle, dateLabel, venue, tableName, companions, meals, ticketUrl }) => {
      // "تمام!" — one short word of acknowledgement, the Arabic equivalent of
      // the English greeting, paid for by the shorter "طاولتك" below.
      const parts = [`${clip(guestName, NAME_MAX)}، تمام! حضورك مؤكد في ${clip(eventTitle, TITLE_MAX)}`];
      if (dateLabel) parts.push(` ${clip(dateLabel, 34)}`);
      if (venue) parts.push(`، ${clip(venue, VENUE_MAX)}`);
      parts.push('.');
      if (tableName) parts.push(` طاولتك ${clip(tableName, TABLE_MAX)}.`);
      const withYou = clipList(companions, COMPANION_MAX, 3);
      if (withYou) parts.push(` معاك: ${withYou}.`);
      const food = clipList(meals, MEAL_MAX, 4);
      if (food) parts.push(` الأكل: ${food}.`);
      if (ticketUrl) parts.push(` تذكرتك والخريطة: ${ticketUrl}`);
      return parts.join('');
    },
  },

  /**
   * CHANGE OR CANCELLATION. The only type where being slightly over budget would
   * be the right call — and it still is not, because the link carries the detail
   * and the reason.
   *
   * `cancelled` is a separate sentence rather than a variation on "changed". A
   * guest skim-reading "there's been an update to the wedding" and arriving at an
   * empty venue is the precise failure this type exists to prevent, so the word
   * has to be in the first six.
   */
  event_update: {
    [EN]: ({ guestName, eventTitle, url, cancelled }) => {
      const who = clip(guestName, NAME_MAX);
      const what = clip(eventTitle, TITLE_MAX);
      // NO "Hi <name>!" on the cancellation, and that is deliberate. A cheerful
      // greeting in front of bad news reads as a mistake, and the exclamation
      // mark is the wrong note entirely. The apology comes AFTER the fact, so
      // "cancelled" stays inside the first six words where a skim-reader sees
      // it — the whole reason this branch is a separate sentence.
      return cancelled
        ? `${who}, ${what} has been cancelled. We are very sorry. Here is why: ${url}`
        : `Hi ${who}, the date or place of ${what} has changed. Please check the new details: ${url}`;
    },
    [AR]: ({ guestName, eventTitle, url, cancelled }) => {
      const who = clip(guestName, NAME_MAX);
      const what = clip(eventTitle, TITLE_MAX);
      return cancelled
        ? `${who}، للأسف تم إلغاء ${what}. التفاصيل: ${url}`
        : `${who}، اتغيّر ميعاد أو مكان ${what}. شوف التفاصيل الجديدة: ${url}`;
    },
  },

  /**
   * THE ORGANIZER'S OWN ALERT. The only type addressed to the customer rather
   * than to a guest, and the only one where the numbers themselves are the
   * message — so it carries them, and links to the dashboard for the rest.
   */
  organizer_report: {
    // "said yes" / "have not replied yet" rather than "attending" / "awaiting
    // reply". This lands on a phone the night before an event, often while the
    // organizer is doing five other things; counted people who SAID YES needs no
    // decoding, and "awaiting reply" is a status field, not a sentence.
    [EN]: ({ eventTitle, attending, pending, dashboardUrl }) =>
      `${clip(eventTitle, TITLE_MAX)}: ${attending} said yes, ${pending} have not replied yet. ${dashboardUrl}`,
    [AR]: ({ eventTitle, attending, pending, dashboardUrl }) =>
      `${clip(eventTitle, TITLE_MAX)}: ${attending} أكّدوا الحضور، ${pending} لسه مردوش. ${dashboardUrl}`,
  },
};

/**
 * Render one message body for a type + language.
 *
 * Falls back to English for any unknown language rather than returning nothing —
 * a guest receiving the message in the wrong language is a far smaller failure
 * than a scheduled send silently producing an empty body.
 *
 * Returns null when the TYPE is unknown, which now includes every RETIRED type.
 * That is the correct behaviour and the caller must surface it: a resend of a
 * retired kind has to fail visibly rather than send an empty message. See
 * smsUsage.isResendable, which stops it reaching here at all.
 *
 * ── THE ORGANIZER'S OWN WORDING (`override`) ──
 *
 * `events.sms_templates[type][lang]`, when they have written one. It takes
 * precedence over everything above, and the three things it does NOT get to
 * change are the point of routing it through here rather than letting the
 * dispatcher concatenate a string:
 *
 *  • The compliance footer. Appended by smsDispatch AFTER this returns, to
 *    every body without exception, so no wording an organizer can type removes
 *    the STOP/HELP language.
 *  • The clip ceilings. Interpolated values go through the same `clip` and
 *    `clipList` caps the built-in bodies use (config/smsMergeTags.buildTagValues
 *    is handed both). Without that, a custom body would be the one path left
 *    where a 60-character guest name still doubles the bill for the whole list.
 *  • The type. An override is per (type, language) — it re-words a message, it
 *    cannot invent a new one or send it to a different audience.
 *
 * An override that is absent, null, or renders to whitespace falls through to
 * the built-in body. That is deliberate: "I cleared the box" must mean "go back
 * to yours", not "send my guests an empty text".
 */
function renderSmsBody(type, lang, context = {}, { override = null } = {}) {
  const byLang = TEMPLATES[type];
  if (!byLang) return null;

  if (typeof override === 'string' && override.trim()) {
    const values = buildTagValues(type, context, { clip, clipList });
    const custom = renderTemplate(override, values);
    // Whitespace-only after substitution means every tag they used resolved
    // empty for this guest — a body of ", ." is worse than the built-in one.
    if (typeof custom === 'string' && custom.trim()) return custom.trim();
  }

  const build = byLang[lang === AR ? AR : EN] || byLang[EN];
  const body = build(context);
  return typeof body === 'string' && body.trim() ? body.trim() : null;
}

/** 'ar' for any Arabic language tag, else 'en'. */
function normalizeLang(lang) {
  return String(lang || '').toLowerCase().startsWith('ar') ? AR : EN;
}

module.exports = { renderSmsBody, normalizeLang, clip, clipList, TEMPLATES };
