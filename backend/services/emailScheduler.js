/**
 * ─────────────────────────────────────────────────────────────────────────────
 * LIFECYCLE EMAIL SCHEDULER
 *
 * A dependency-free interval scheduler that sweeps the database for "due" lifecycle
 * emails (reminders, reports, post-event) and dispatches them idempotently. Each job:
 *   • filters on per-entity "*_sent_at" stamps so a row is processed once, and
 *   • routes every send through emailService.dispatch (email_log (kind,ref) dedupe).
 *
 * Safety:
 *   • OFF unless EMAIL_AUTOMATION_ENABLED=true (controlled rollout — never blasts
 *     real users on deploy).
 *   • Single-leader: in a pm2 cluster only instance 0 schedules (idempotency still
 *     protects against accidental multi-run).
 *   • Best-effort throughout — a failing job never crashes the server.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const crypto = require('crypto');
const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const { dispatch } = require('./emailService');
const { getEventStats } = require('../utils/emailContext');
const tokenService = require('./tokenService');
const T = require('../utils/emailTemplates');
const { getPublicBaseUrl } = require('../utils/publicUrl');
const { sendTransactionalSms } = require('./smsDispatch');
const { getSmsType } = require('../config/smsMessageTypes');
// The seating sweep mails the re-issued pass as well as texting it. Requiring
// the service (rather than rebuilding the template here) keeps ONE writer of
// the invitations ledger — which is also what skipIfUnchanged reads to decide
// whether this guest has already been told about this table.
const invitationService = require('./invitationService');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const LIMIT = 250; // rows per page when walking an event's guest list
/**
 * A ceiling on how much of one event we will hold in memory at once. Not a
 * business rule — no tier sells this many — just the guard that keeps a
 * runaway or corrupted event from taking the scheduler down with it.
 */
const MAX_PARTIES_PER_EVENT = 20000;
const MAX_RETRIES = 3; // max retry attempts for failed email sends
const RETRY_BASE_MS = 1000; // base delay for exponential backoff (1s, 2s, 4s)
const nowISO = () => new Date().toISOString();
const stamp = (table, id, col) => supabase.from(table).update({ [col]: nowISO() }).eq('id', id);

/**
 * Wraps dispatch() with retry logic and exponential backoff.
 * Retries up to MAX_RETRIES times on failure before giving up.
 * Returns { sent: true } on success, { sent: false, error } after exhausting retries.
 */
async function dispatchWithRetry(payload) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await dispatch(payload);
      if (res.sent) return res;
      // dispatch returned but didn't send (e.g. dedup) — don't retry
      if (res.deduplicated) return res;
    } catch (err) {
      if (attempt >= MAX_RETRIES) {
        logger.error({ err, kind: payload.kind, ref: payload.ref, attempt }, '[email-scheduler] permanently failed after max retries');
        return { sent: false, error: err.message || 'MAX_RETRIES_EXCEEDED' };
      }
      const delay = RETRY_BASE_MS * Math.pow(2, attempt);
      logger.warn({ err, kind: payload.kind, ref: payload.ref, attempt, nextRetryMs: delay }, '[email-scheduler] dispatch failed, retrying');
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }
    // dispatch returned { sent: false } without throwing — retry
    if (attempt >= MAX_RETRIES) {
      logger.error({ kind: payload.kind, ref: payload.ref, attempt }, '[email-scheduler] permanently failed after max retries (send returned false)');
      return { sent: false, error: 'MAX_RETRIES_EXCEEDED' };
    }
    const delay = RETRY_BASE_MS * Math.pow(2, attempt);
    logger.warn({ kind: payload.kind, ref: payload.ref, attempt, nextRetryMs: delay }, '[email-scheduler] send returned false, retrying');
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  return { sent: false, error: 'MAX_RETRIES_EXCEEDED' };
}

const frontendBase = () => getPublicBaseUrl();

// Per-party "already sent?" stamps (reminder_sent_at etc.) were absorbed into the
// invitations ledger's per-channel tracking; lifecycle reminders aren't an
// invitation-delivery channel, so they rely solely on dispatch()'s email_log(kind,ref)
// UNIQUE-index dedup for idempotency rather than a pre-filter column.
const rsvpLinks = (partyId, eventId) => {
  const link = (response) => `${frontendBase()}/rsvp?token=${encodeURIComponent(tokenService.signRsvpInvite({ partyId, eventId, response }))}`;
  return { accept: link('accepted'), decline: link('declined'), maybe: link('maybe'), manage: link(undefined) };
};
const orgEmailOk = (ev) => !(ev.notification_preferences && ev.notification_preferences.email === false);
/** Subject lines follow the body's language — emailTemplates.pick is not exported. */
const pickSubject = (lang, { en, ar }) => (lang === 'ar' ? ar : en);
const primaryEmailOf = (party) => (party.guests || []).find((g) => g.is_primary_contact)?.email || null;

/**
 * The guest's entry-pass link, or null if they should not have one.
 *
 * signQrTicketForResponse returns null for anyone who is not a confirmed 'yes',
 * which is exactly the gate wanted: a guest who declined has no pass, and the
 * seating_reminder template has a shape for that. Never throws — a missing link
 * degrades the message, it does not fail the send.
 */
const ticketLinksFor = (party, ev, tableName = null) => {
  try {
    const token = tokenService.signQrTicketForResponse({
      response: party.response || 'yes',
      partyId: party.id,
      eventId: ev.id,
      tableName,
      partySize: (party.guests || []).length || 1,
      eventDate: ev.event_date,
    });
    return token ? T.buildTicketLinks(token) : null;
  } catch {
    return null;
  }
};
/* `ticketUrlFor` lived here too — the bare link the seating TEXT carried, since
   an SMS cannot hold the pass itself. The day-before text builds its link from
   ticketLinksFor directly, so retiring the seating text left it with no callers. */

/**
 * Try to deliver a lifecycle message by SMS, and report whether the email should
 * be skipped.
 *
 * Returns TRUE only when a text was actually sent AND that type is defined as
 * replacing its email. Every other outcome — the add-on was never bought, the
 * organizer switched the type off, the guest never consented, they replied STOP,
 * the allowance ran dry, Twilio failed — returns false, and the caller sends the
 * email exactly as it always did.
 *
 * That asymmetry is the whole design: SMS is an upgrade to the delivery of a
 * message, never a precondition for it. A guest is always told; the channel is a
 * billing and preference question.
 *
 * Types with replacesEmail = false (RSVP confirmation, entry pass, organizer
 * report) always return false, because their email carries something the text
 * cannot — a scannable pass, a formatted report — so both must go.
 */
async function trySms(ev, { type, partyId = null, ref, context, lang = 'en' }) {
  if (!ev?.sms_addon_purchased_at) return false;   // cheap pre-check; the gate re-verifies
  const typeDef = getSmsType(type);
  if (!typeDef) return false;

  try {
    const result = await sendTransactionalSms({
      type, eventId: ev.id, partyId, ref, event: ev, lang, context,
    });
    return !!result.sent && typeDef.replacesEmail === true;
  } catch (err) {
    logger.warn({ err, type, eventId: ev.id }, '[email-scheduler] SMS attempt failed; falling back to email');
    return false;
  }
}

/**
 * Every confirmed party for an event, walked a page at a time.
 *
 * ── WHY THIS IS NOT `.limit(250)` ──
 *
 * It used to be. A bare `.limit(LIMIT)` reads like a safety valve, and on a
 * job that re-runs every few minutes it looks self-correcting — the next sweep
 * picks up where this one left off. It does not. There is no cursor: every run
 * asks for the same first 250 rows, and dedupe then drops all 250 as already
 * sent. Guest 251 onward is never selected by any run, so on an event with 300
 * confirmed guests, fifty people simply never receive their table and entry
 * pass. Nothing errors and the job reports success.
 *
 * `.order('id')` is what makes paging safe rather than decorative: without a
 * deterministic sort, PostgREST may return rows in any order per request, so
 * `.range()` windows can overlap and skip. Ordering by the primary key gives a
 * stable sequence for the length of the walk.
 */
async function fetchConfirmedParties(eventId, select) {
  const out = [];
  for (let from = 0; from < MAX_PARTIES_PER_EVENT; from += LIMIT) {
    const { data, error } = await supabase
      .from('rsvp_parties').select(select)
      .eq('event_id', eventId).eq('response', 'yes')
      .order('id', { ascending: true })
      .range(from, from + LIMIT - 1);

    // A failed page is not a reason to abandon the guests already collected —
    // sending to the ones we have beats sending to nobody — but it must be
    // loud, because the silent version of this is the bug described above.
    if (error) {
      logger.warn({ err: error, eventId, from }, '[email-scheduler] guest page failed; continuing with a partial list');
      break;
    }
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < LIMIT) break;
  }
  if (out.length >= MAX_PARTIES_PER_EVENT) {
    logger.warn({ eventId, cap: MAX_PARTIES_PER_EVENT }, '[email-scheduler] guest list hit the memory cap — remaining guests not processed this run');
  }
  return out;
}

/* ─── 1. RSVP reminders — invited, still-pending guests as the deadline nears ─── */
async function jobRsvpReminders() {
  const soon = new Date(Date.now() + 3 * DAY).toISOString();
  const { data: events } = await supabase
    .from('events')
    // sms_* are selected once per EVENT and passed down to every party, so adding
    // the SMS channel costs one column set per event rather than a query per guest.
    .select('id, title, slug, event_date, timezone, rsvp_deadline, sms_addon_purchased_at, sms_settings')
    .eq('status', 'active').eq('is_paid', true)
    .not('rsvp_deadline', 'is', null).gte('rsvp_deadline', nowISO()).lte('rsvp_deadline', soon)
    .limit(100);
  let sent = 0;
  for (const ev of (events || [])) {
    const { data: parties } = await supabase
      .from('rsvp_parties').select('id, label, response, preferred_lang, guests(is_primary_contact, email)')
      .eq('event_id', ev.id).eq('response', 'pending').limit(LIMIT);
    for (const party of (parties || [])) {
      // EMAIL ONLY. The `rsvp_reminder` SMS type is retired.
      //
      // Chasing a non-responder is the least valuable thing a charged message can
      // do — the guest has already ignored an invitation, and the second nudge
      // converts poorly enough that it was never worth what it cost. The organizer
      // can text the invitation again by hand from the RSVPs tab if they want to,
      // which is a decision rather than a standing charge.
      const email = primaryEmailOf(party);
      if (!email) continue;
      const r = { id: party.id, guest_name: party.label, email, response: party.response };
      const html = T.getRsvpReminderTemplate(r, ev, rsvpLinks(party.id, ev.id));
      const res = await dispatchWithRetry({ kind: 'rsvp_reminder', ref: `rsvp:${party.id}`, to: email, subject: `Reminder: please RSVP for ${ev.title}`, html, eventId: ev.id });
      if (res.sent) sent++;
    }
  }
  return sent;
}

/* ─── 2. The day-before reminder — table + entry pass, to confirmed guests ─── */

/**
 * How close the event has to be before this fires. Also the seating embargo:
 * the guest ticket page keeps the chart locked until the same 24h mark.
 */
const EVENT_REMINDER_WINDOW_MS = DAY;

/**
 * ── WHY THIS WINDOW IS 24 HOURS AND NOT THREE DAYS ──
 *
 * It swept `event_date <= now + 3 days` while the table was attached only when
 * `event_date <= now + 24 hours`. Both facts were correct in isolation and
 * catastrophic together, because the dedupe key is `rsvp:<party>` for the whole
 * event:
 *
 *   T-3d   first sweep matches → email sent with tableName = null
 *   T-24h  sweep matches again → dispatch() sees the same (kind, ref) in
 *          email_log and drops it as a duplicate
 *
 * So the ONLY reminder any guest ever received was the one that could not name
 * their table — and it closed by promising that "your table assignment and QR
 * check-in pass will arrive in a separate email closer to the day", an email no
 * job in this file has ever sent. The seating leg failed identically: the
 * `seating_reminder` text went out at T-3d under `evday:<party>` with a null
 * table, and the day-before send was swallowed the same way.
 *
 * Narrowing the window to the reveal mark makes the first match the only match,
 * and that match always has the table. One message per guest, at the moment it
 * is useful, carrying everything: when, where, which table, and the scannable
 * pass that opens the door.
 *
 * A guest seated for the first time inside this window is unaffected — that is
 * jobSeatingNotices' `seat:<party>:<table>` ref, a different key on a different
 * schedule.
 */
async function jobEventReminders() {
  const soon = new Date(Date.now() + EVENT_REMINDER_WINDOW_MS).toISOString();
  const { data: events } = await supabase
    .from('events')
    // location_lat/location_lng are NOT optional now that this template renders
    // the shared venue block: emailTemplates.buildMapsUrl prefers coordinates
    // and silently falls back to a text search on the address when they are
    // absent. That fallback works, but it drops a guest at whatever Google
    // matches for a free-typed address rather than at the pin the organizer
    // actually placed — on the one message they open outside the venue.
    .select('id, title, slug, event_date, timezone, location_name, location_address, location_lat, location_lng, sms_addon_purchased_at, sms_settings')
    .eq('status', 'active').eq('is_paid', true)
    .gte('event_date', nowISO()).lte('event_date', soon)
    .limit(100);
  let sent = 0;
  for (const ev of (events || [])) {
    /**
     * THE DEDUPE KEY CARRIES THE DATE IT IS ABOUT.
     *
     * It used to be `rsvp:<party>` — which reads as "this guest has been
     * reminded", full stop, forever. `email_log` has a UNIQUE (kind, ref)
     * index and dispatch() checks it before every send, so once that row
     * existed nothing could ever remind that guest again.
     *
     * Which broke the case an organizer is most likely to need: move an event
     * that has already crossed its 24-hour mark, and the new mark produces the
     * same key, dispatch drops it as a duplicate, and NOBODY is told about the
     * new date. The "your event has changed" notice is a different message on
     * a different path and does not fill the gap — it is a one-off
     * announcement, not the reminder that carries the table and the pass.
     *
     * Adding the target instant makes the key mean "reminded ABOUT THIS DATE".
     * Rescheduling mints a new one and the reminder goes again; the sweep
     * re-running against an unchanged date keeps hitting the same key and is
     * still swallowed, which is the whole point of having one.
     *
     * EPOCH MILLISECONDS, not the ISO string. Postgres hands back
     * "…T03:00:00+00:00" while other paths produce "…T03:00:00.000Z" — the same
     * instant, different text, and a text key would treat them as two dates and
     * send twice. getTime() has exactly one representation.
     */
    const dateKey = new Date(ev.event_date).getTime();

    const parties = await fetchConfirmedParties(
      ev.id,
      'id, label, response, preferred_lang, guests(is_primary_contact, email), seating_assignments(tables(table_name))',
    );
    for (const party of parties) {
      // Inside the window by construction, so the chart is revealed and this is
      // the real, final table — no `revealed` check left to get out of step
      // with the send window.
      const tableName = party.seating_assignments?.[0]?.tables?.table_name || null;
      const links = ticketLinksFor(party, ev, tableName);
      const lang = party.preferred_lang === 'ar' ? 'ar' : 'en';

      /**
       * THE DAY-BEFORE TEXT.
       *
       * ref is `evday:` and NOT `seat:` on purpose. The seating sweep used
       * `seat:<party>:<table>` while it existed, and a guest seated at table 7
       * and then reminded about table 7 would have collided on the (kind, ref)
       * unique index with one of them swallowed as a DUPLICATE. The prefixes
       * stay distinct even now that the seating text is retired, because
       * `sms_log` still holds those historical rows.
       *
       * Carries `dateKey` for the same reason the email does — see the note
       * above. Both channels have to move together: an organizer who reschedules
       * and gets the mail resent but not the text would have half their guests
       * told, split by which channel each one happens to use.
       *
       * Additive to the email below, never a replacement — `replacesEmail` is
       * false for every current type, so `viaSms` is not consulted and the mail
       * goes regardless of what the carrier did.
       */
      await trySms(ev, {
        type: 'seating_reminder',
        partyId: party.id,
        ref: `evday:${party.id}:${dateKey}`,
        // The language this guest actually used when they RSVP'd. Without it a
        // guest who replied in Arabic gets an English reminder days later.
        lang,
        context: {
          guestName: party.label,
          eventTitle: ev.title,
          dateLabel: T.formatEventDate ? T.formatEventDate(ev.event_date, ev.timezone) : null,
          tableName,
          ticketUrl: links?.ticketUrl || null,
        },
      });

      const email = primaryEmailOf(party);
      if (!email) continue;
      const r = { id: party.id, guest_name: party.label, email, party_size: (party.guests || []).length || 1 };
      const html = T.getEventReminderTemplate(r, ev, { tableName, links }, lang);
      // No "Tomorrow:" here either — see the eyebrow note in
      // getEventReminderTemplate. The send window is 0-24h, not exactly 24h,
      // and event_date is UTC while "tomorrow" is a claim about the reader's
      // local date.
      const subject = pickSubject(lang, {
        en: `Your table and entry pass for ${ev.title}`,
        ar: `طاولتك وتذكرة دخولك لـ ${ev.title}`,
      });
      const res = await dispatchWithRetry({ kind: 'event_reminder', ref: `rsvp:${party.id}:${dateKey}`, to: email, subject, html, eventId: ev.id });
      if (res.sent) sent++;
    }
  }
  return sent;
}

/**
 * The next instant at which some event will CROSS the T-24h mark, or null.
 *
 * ── WHY A POLLING SWEEP CANNOT BE ON TIME, AND WHAT THIS REPLACES IT WITH ──
 *
 * `jobEventReminders` asks "is anything inside the 24h window?" — a question
 * whose answer only changes at one precise moment per event, and which the
 * scheduler was asking on a 15-minute cadence phased to whenever the process
 * last restarted. So the reminder landed somewhere in a fifteen-minute smear
 * after the mark, at an offset that had nothing to do with the event and moved
 * every deploy. Organizers reasonably read "24 hours before" as a promise.
 *
 * Rather than sweeping faster — which costs a full six-job run every minute to
 * buy a minute of accuracy — this asks the database for the ONE moment that
 * matters next and sleeps until exactly then.
 *
 * `.gt()` and not `.gte()`: an event already inside the window is this run's
 * work, not the next alarm. Including it would arm a timer for a moment
 * already past and spin.
 */
async function nextEventReminderDueAt() {
  const { data, error } = await supabase
    .from('events')
    .select('event_date')
    .eq('status', 'active').eq('is_paid', true)
    .gt('event_date', new Date(Date.now() + EVENT_REMINDER_WINDOW_MS).toISOString())
    .order('event_date', { ascending: true })
    .limit(1);

  if (error || !data || data.length === 0) return null;
  const at = new Date(data[0].event_date).getTime();
  return Number.isNaN(at) ? null : at - EVENT_REMINDER_WINDOW_MS;
}

/* ─── 3. Final headcount report — to the organizer ~24-30h before the event ─── */
async function jobFinalReports() {
  const soon = new Date(Date.now() + 30 * HOUR).toISOString();
  const { data: events } = await supabase
    .from('events')
    .select('id, title, slug, event_date, timezone, notification_preferences, sms_addon_purchased_at, sms_settings, organizations(name, email)')
    .eq('status', 'active').eq('is_paid', true)
    .gte('event_date', nowISO()).lte('event_date', soon)
    .is('final_report_sent_at', null).limit(100);
  let sent = 0;
  for (const ev of (events || [])) {
    const org = ev.organizations;

    // The organizer gets BOTH: the email carries the actual headcount table, the
    // text is the heads-up that it has landed. This is the one type addressed to
    // the customer rather than a guest, so it reads organizations.sms_consent —
    // their own opt-in — not any guest consent record (see resolveRecipient).
    const stats = (org && org.email && orgEmailOk(ev)) ? await getEventStats(ev.id) : null;
    await trySms(ev, {
      type: 'organizer_report',
      ref: `event:${ev.id}`,
      context: {
        eventTitle: ev.title,
        attending: stats?.attending ?? 0,
        pending: stats?.pending ?? 0,
        dashboardUrl: `${frontendBase()}/dashboard`,
      },
    });

    if (org && org.email && orgEmailOk(ev)) {
      const html = T.getFinalHeadcountReportTemplate({ orgName: org.name, event: ev, stats });
      const res = await dispatchWithRetry({ kind: 'final_report', ref: `event:${ev.id}`, to: org.email, subject: `Final headcount: ${ev.title}`, html, eventId: ev.id });
      if (res.sent) sent++;
    }
    await stamp('events', ev.id, 'final_report_sent_at');
  }
  return sent;
}

/* ─── 4. Post-event — organizer recap (once) + guest thank-you (attendees) ─── */
async function jobPostEvent() {
  const since = new Date(Date.now() - 3 * DAY).toISOString();
  const { data: events } = await supabase
    .from('events')
    .select('id, title, slug, event_date, timezone, recap_sent_at, notification_preferences, organizations(name, email)')
    .in('status', ['active', 'completed']).eq('is_paid', true)
    .lt('event_date', nowISO()).gte('event_date', since)
    .limit(100);
  let sent = 0;
  for (const ev of (events || [])) {
    if (!ev.recap_sent_at) {
      const org = ev.organizations;
      if (org && org.email && orgEmailOk(ev)) {
        const stats = await getEventStats(ev.id);
        const html = T.getPostEventRecapTemplate({ orgName: org.name, event: ev, stats });
        const res = await dispatchWithRetry({ kind: 'recap', ref: `event:${ev.id}`, to: org.email, subject: `Recap: ${ev.title}`, html, eventId: ev.id });
        if (res.sent) sent++;
      }
      await stamp('events', ev.id, 'recap_sent_at');
    }
    const parties = await fetchConfirmedParties(ev.id, 'id, label, guests(is_primary_contact, email)');
    for (const party of parties) {
      const email = primaryEmailOf(party);
      if (!email) continue;
      const r = { id: party.id, guest_name: party.label, email };
      const html = T.getPostEventThankYouTemplate(r, ev);
      const res = await dispatchWithRetry({ kind: 'thank_you', ref: `rsvp:${party.id}`, to: email, subject: `Thank you for celebrating ${ev.title}`, html, eventId: ev.id });
      if (res.sent) sent++;
    }
  }
  return sent;
}

/* ─── 5. Pending-payment nudge — unpaid drafts older than 24h ─── */
async function jobPendingPayments() {
  const cutoff = new Date(Date.now() - DAY).toISOString();
  const { data: events } = await supabase
    .from('events')
    .select('id, title, slug, created_at, organizations(name, email)')
    .eq('is_paid', false).eq('status', 'draft')
    .lte('created_at', cutoff).is('payment_reminder_sent_at', null).limit(100);
  let sent = 0;
  for (const ev of (events || [])) {
    const org = ev.organizations;
    if (org && org.email) {
      const html = T.getPendingPaymentReminderTemplate({ orgName: org.name, event: ev });
      const res = await dispatchWithRetry({ kind: 'pending_payment', ref: `event:${ev.id}`, to: org.email, subject: `Activate your event: ${ev.title}`, html, eventId: ev.id });
      if (res.sent) sent++;
    }
    await stamp('events', ev.id, 'payment_reminder_sent_at');
  }
  return sent;
}

/**
 * Trigger (not scheduled): notify confirmed/maybe guests when an organizer changes
 * a live event's date or venue. Gated by EMAIL_AUTOMATION_ENABLED (it's a broadcast),
 * and deduped per (event, new-details) so re-saving identical details never re-sends.
 * Called best-effort from eventController.updateEvent.
 */
/**
 * WHO HEARS THAT AN EVENT MOVED OR WAS CALLED OFF.
 *
 * Everyone who has not said no. This used to be `['yes', 'maybe']`, which is the
 * right audience only if the guest list is entirely self-serve — and it stopped
 * being that the moment an organizer could add someone by hand and invite them.
 *
 * The gap it left: a guest the organizer invited, who has not opened the
 * invitation yet, sits at `pending`. They had an invitation, they may well be
 * planning to come, and if the wedding was cancelled they were told nothing at
 * all. The organizer got a confirmation saying N guests had been contacted, and
 * N excluded every person who had not yet replied.
 *
 * `no` stays out on purpose: they have declined, they are not turning up, and a
 * cancellation notice to someone who already said no is a message nobody needs
 * and — on the SMS leg — one the organizer pays for.
 *
 * Exported so `eventController.countNotifiableGuests` counts the same rows this
 * function sends to. The confirm dialog's promise and the send have to be one
 * definition; two lists that agreed on the day they were written is exactly how
 * a dialog ends up quoting a number nobody receives.
 */
const NOTIFIABLE_RESPONSES = ['yes', 'maybe', 'pending', 'waitlist'];

async function notifyGuestsOfEventChange(eventId, { includeSms = false, force = false } = {}) {
  /**
   * THE ENV GATE IS BYPASSABLE, AND HAS TO BE.
   *
   * This returned 0 unless EMAIL_AUTOMATION_ENABLED was 'true', which is right for
   * the automatic date/venue path — that fires off a PATCH and is a broadcast
   * nobody explicitly asked for, so it belongs behind the same rollout switch as
   * every other scheduled job.
   *
   * It is catastrophically wrong for a CANCELLATION. On a deployment with the flag
   * unset, calling off an event would tell precisely nobody, silently, while
   * reporting success. `force` is passed only from the explicit cancel/notify
   * endpoints, where an organizer has already pressed a confirm dialog naming the
   * exact number of guests who will be contacted.
   */
  if (!force && process.env.EMAIL_AUTOMATION_ENABLED !== 'true') return { sent: 0, texted: 0 };

  try {
    const { data: ev } = await supabase
      .from('events')
      // sms_addon_purchased_at and sms_settings are NOT optional here.
      //
      // trySms pre-checks sms_addon_purchased_at on the row it is handed, so
      // omitting them from this select made the SMS leg return false for every
      // event on the platform — not erroring, not logging, simply never texting
      // anyone about a cancellation. A quiet always-false is the worst kind of
      // bug to own, so the columns are listed with a note rather than inherited.
      .select('id, title, slug, event_date, timezone, location_name, location_address, status, is_paid, cancellation_reason, sms_addon_purchased_at, sms_settings')
      .eq('id', eventId).single();

    // 'cancelled' is as valid a reason to notify as a date change — more so.
    if (!ev || !ev.is_paid) return { sent: 0, texted: 0 };
    if (ev.status !== 'active' && ev.status !== 'cancelled') return { sent: 0, texted: 0 };

    const cancelled = ev.status === 'cancelled';
    const where = ev.location_name || ev.location_address || '';
    const changes = [];
    if (ev.event_date) changes.push({ label: 'When', value: T.formatEventDate(ev.event_date, ev.timezone) || '' });
    if (where) changes.push({ label: 'Where', value: where });
    const url = `${T.getPublicBaseUrl()}/${ev.slug || ''}`;

    // A cancellation is a single, final event in a party's life, so it gets a
    // fixed key rather than a content hash — an organizer who edits the date and
    // THEN cancels must not have the cancellation deduped against the change.
    const changeKey = cancelled
      ? 'cancelled'
      : crypto.createHash('sha1').update(`${ev.event_date}|${where}`).digest('hex').slice(0, 12);

    let sent = 0;
    let texted = 0;
    let from = 0;

    /**
     * PAGINATED, not `.limit(250)`.
     *
     * LIMIT is a per-run safety cap for jobs that sweep the same rows every
     * fifteen minutes — if one run misses a guest, the next picks them up. This
     * function runs ONCE per change. A 400-party event silently told 250 of them
     * their wedding had moved, and the other 150 never heard anything, ever.
     */
    for (;;) {
      const { data: parties } = await supabase
        .from('rsvp_parties')
        .select('id, label, preferred_lang, guests(is_primary_contact, email)')
        .eq('event_id', eventId)
        .in('response', NOTIFIABLE_RESPONSES)
        .order('id', { ascending: true })
        .range(from, from + LIMIT - 1);

      if (!parties || parties.length === 0) break;

      for (const party of parties) {
        // Text first, then mail — but the two are independent, and neither
        // suppresses the other. `event_update` has replacesEmail: false, so
        // trySms always returns false here and the mail below always goes. Both
        // channels, deliberately: this is the one message where a guest missing
        // it is a genuine harm, and a text and an email fail in different ways.
        if (includeSms && ev.sms_addon_purchased_at) {
          // sendTransactionalSms directly, NOT trySms.
          //
          // trySms answers "should I skip the email?", which for this type is
          // always false — so it cannot tell us whether a text actually went. The
          // count is what the confirm dialog promised the organizer, so it has to
          // come from the send itself.
          const smsResult = await sendTransactionalSms({
            type: 'event_update',
            eventId,
            partyId: party.id,
            ref: `evchg:${eventId}:${changeKey}:${party.id}`,
            event: ev,
            lang: party.preferred_lang || 'en',
            context: { guestName: party.label, eventTitle: ev.title, url, cancelled },
          }).catch(() => ({ sent: false }));
          if (smsResult.sent) texted += 1;
        }

        const email = primaryEmailOf(party);
        if (!email) continue;
        const r = { id: party.id, guest_name: party.label, email };
        const lang = party.preferred_lang === 'ar' ? 'ar' : 'en';
        const html = cancelled
          ? T.getEventCancelledTemplate(r, ev, url, lang, ev.cancellation_reason || null)
          : T.getEventUpdatedTemplate(r, ev, changes, url, lang);
        const res = await dispatch({
          kind: 'event_update',
          // sms_log and email_log are separate tables with separate (kind, ref)
          // uniques, so the identical ref is safe — and means one guest is
          // deduped identically on both channels.
          ref: `evchg:${eventId}:${changeKey}:${party.id}`,
          to: email,
          subject: cancelled ? `Cancelled: ${ev.title}` : `Update to ${ev.title}`,
          html,
          eventId,
        });
        if (res.sent) sent++;
      }

      if (parties.length < LIMIT) break;
      from += LIMIT;
    }

    return { sent, texted };
  } catch (err) {
    logger.warn({ err, eventId }, '[email-scheduler] event-change notify failed');
    return { sent: 0, texted: 0 };
  }
}

/* ─── 6. Seating notices — re-mail a moved guest their pass, once the dust settles ─── */

/**
 * ── THE SEATING TEXT IS RETIRED. THIS JOB IS EMAIL-ONLY. ──
 *
 * It used to send both: a charged `seating_reminder` SMS keyed
 * `seat:<party>:<table>`, and the pass by email. The text is gone — removed on
 * request — and with it `textedADifferentTable`, which existed solely to decide
 * whether that text should read "your table has changed".
 *
 * What is deliberately NOT gone:
 *
 *   • The queue and this sweep. The email needs the quiet period just as much
 *     as the text did (see below), and it is the only thing that tells a MOVED
 *     guest anything at all.
 *   • The `seating_reminder` SMS TYPE in config/smsMessageTypes.js. It still
 *     fires — from jobEventReminders, in the 24 hours before the event, under
 *     the `evday:` ref. Deleting the type would silence that too.
 *
 * A guest is therefore told their table by email when they are seated or moved,
 * and by text only once, the day before.
 */

/**
 * How long a party's seat must sit UNCHANGED before we mail them about it.
 *
 * The whole reason this job exists. Seating endpoints do not send; they upsert
 * into seating_notify_queue, and every subsequent move overwrites the row. This
 * job sweeps rows that have been still for the quiet period and sends once, with
 * the final table.
 *
 * Without it, a drag-and-drop session on a 200-guest chart would issue one
 * message per drop — a guest moved four times receiving four passes, three of
 * them naming a table they are not sitting at. That was the argument when the
 * message was a charged text and it survives the text's removal intact: the
 * cost is now the guest's attention rather than the organizer's balance, which
 * is the cheaper of the two to spend but not free.
 */
const SEATING_QUIET_MS = 10 * 60 * 1000;

async function jobSeatingNotices() {
  const dueBefore = new Date(Date.now() - SEATING_QUIET_MS).toISOString();

  const { data: due, error } = await supabase
    .from('seating_notify_queue')
    .select('event_id, party_id, table_id')
    .is('notified_at', null)
    .lt('queued_at', dueBefore)
    .order('queued_at', { ascending: true })
    .limit(500);

  // An unmigrated deployment has no queue table. Degrade to doing nothing rather
  // than failing the whole scheduler run — every other job is unrelated.
  if (error || !due || due.length === 0) return 0;

  // Group by event so each event's row and settings are fetched once, not once
  // per guest. A 300-guest chart is 300 queue rows and one event.
  const byEvent = new Map();
  for (const row of due) {
    if (!byEvent.has(row.event_id)) byEvent.set(row.event_id, []);
    byEvent.get(row.event_id).push(row);
  }

  let sent = 0;
  for (const [eventId, rows] of byEvent) {
    const { data: ev } = await supabase
      .from('events')
      .select('id, title, slug, event_date, timezone, sms_addon_purchased_at, sms_settings, status')
      .eq('id', eventId).maybeSingle();

    // A cancelled event must not text anyone about where they were going to sit.
    // Clear the rows so they are not reconsidered every fifteen minutes forever.
    if (!ev || ev.status === 'cancelled') {
      await supabase.from('seating_notify_queue')
        .update({ notified_at: nowISO() })
        .eq('event_id', eventId)
        .in('party_id', rows.map((r) => r.party_id));
      continue;
    }

    for (const row of rows) {
      try {
        /* Narrowed when the text was retired. The label, language, contacts and
           live table were all read to BUILD the SMS body; sendQrTicketEmail
           looks up everything it needs itself, so all that remains to decide
           here is whether this party is still coming. */
        const { data: party } = await supabase
          .from('rsvp_parties')
          .select('id, response')
          .eq('id', row.party_id).maybeSingle();

        // Only confirmed attendees get a table. Someone who declined after
        // being seated should not be told where they are sitting.
        if (party && party.response === 'yes') {
          /**
           * THE EMAIL — and, since the seating text was retired, the only thing
           * this job sends. See the note on the job itself for why.
           *
           * A move used to be texted and never mailed. assignSeat emails the
           * pass the moment a guest is first seated, but reassignSeat and the
           * batch save deliberately sent nothing, on the reasoning that the
           * pass a moved guest already holds is still valid at the door. It is
           * — the scanner re-reads the live table — but the guest is holding
           * an email that says table 7 while they are seated at table 3, and
           * that email is now the ONLY thing that ever names their table.
           *
           * Sent unconditionally here, because sendQrTicketEmail's
           * skipIfUnchanged does the deciding: it reads the last pass this
           * party was actually emailed out of the invitations ledger and
           * returns without sending when it already named this table. That is
           * what stops a first assignment being mailed twice — once
           * immediately, once by this sweep ten minutes later — and it is
           * keyed on what was DELIVERED rather than on what the queue row
           * happens to say.
           */
          try {
            const mail = await invitationService.sendQrTicketEmail(eventId, party.id, {
              skipIfUnchanged: true,
            });
            if (mail?.sent) sent += 1;
          } catch (mailErr) {
            // NOT_ATTENDING / PARTY_NOT_FOUND throw. Neither should stop the
            // rest of the sweep.
            logger.warn({ err: mailErr, partyId: party.id }, '[email-scheduler] seating change email failed');
          }

        }
      } catch (err) {
        logger.warn({ err, partyId: row.party_id }, '[email-scheduler] seating notice failed');
      }

      /**
       * Stamped WHATEVER happened — sent, skipped, or thrown.
       *
       * The outcome belongs in the invitations ledger, which records what was
       * actually delivered. This column only answers "have we dealt with this
       * queue row yet". Leaving it null on a skip would retry a guest with no
       * email address every fifteen minutes until the event, forever.
       */
      await supabase.from('seating_notify_queue')
        .update({ notified_at: nowISO() })
        .eq('event_id', eventId)
        .eq('party_id', row.party_id);
    }
  }

  return sent;
}

const JOBS = [
  ['rsvp_reminders', jobRsvpReminders],
  ['event_reminders', jobEventReminders],
  ['final_reports', jobFinalReports],
  ['post_event', jobPostEvent],
  ['pending_payments', jobPendingPayments],
  ['seating_notices', jobSeatingNotices],
];

let running = false;
async function runOnce(trigger = 'interval') {
  if (running) { logger.info('[email-scheduler] previous run still in progress — skipping'); return {}; }
  running = true;
  const t0 = Date.now();
  const summary = {};
  for (const [name, fn] of JOBS) {
    try { summary[name] = await fn(); }
    catch (err) { logger.warn({ err, job: name }, '[email-scheduler] job failed'); summary[name] = 'error'; }
  }
  running = false;
  logger.info({ summary, ms: Date.now() - t0, trigger }, '[email-scheduler] run complete');
  return summary;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * THE DAY-BEFORE ALARM
 *
 * The full sweep stays exactly as it was — six jobs, every fifteen minutes. It
 * is the right shape for work whose due moment is soft: an RSVP chase, a recap,
 * a payment nudge. Nobody notices whether those land at 10:00 or 10:12.
 *
 * The day-before reminder is not that. It is a promise with a number in it, and
 * it was being served by the same coarse sweep, so it arrived up to fifteen
 * minutes late at an offset determined by the last process restart.
 *
 * This is a separate, much cheaper clock that runs ONLY `jobEventReminders`.
 * Each hop asks for the single next moment an event crosses T-24h and sleeps
 * until precisely then, so the reminder goes out within a second of the mark
 * instead of somewhere in a fifteen-minute smear.
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * The longest one hop will ever sleep.
 *
 * The alarm is armed from a snapshot of the database, and the database keeps
 * changing underneath it: an event created, a date edited, an event paid for.
 * Any of those can introduce a mark EARLIER than the one currently armed, and
 * nothing notifies this file when they happen. Waking at least once a minute
 * re-reads the answer, which bounds how stale the armed mark can be.
 *
 * The residue: an event whose mark falls inside the current hop's remaining
 * sleep is served up to a minute late. That can only happen to an event created
 * or moved to start within ~24 hours from now — already at or past its own
 * mark, where "as soon as possible" is the correct behaviour anyway.
 */
const ALARM_MAX_SLEEP_MS = 60 * 1000;

/**
 * Land just PAST the mark rather than exactly on it.
 *
 * `jobEventReminders` selects `event_date <= now + 24h`. Firing at the
 * theoretical instant races that comparison — clock resolution, the round trip
 * to Postgres, and `setTimeout`'s own habit of firing a hair early can all put
 * `now` a millisecond on the wrong side, in which case the query matches
 * nothing and the guest waits for the next hop. A second of deliberate lateness
 * is invisible to a human and removes the race.
 */
const ALARM_GUARD_MS = 1000;

/**
 * How long to sleep given the next mark — the whole timing decision, kept pure
 * so it can be asserted directly instead of inferred from a running timer.
 *
 * `dueAt` of null means no event is approaching the window at all, which is the
 * ordinary state of a quiet database rather than an error: sleep the full hop
 * and look again.
 */
function alarmSleepMs(dueAt, now = Date.now()) {
  if (dueAt === null || dueAt === undefined) return ALARM_MAX_SLEEP_MS;
  // A mark already in the past clamps to the guard rather than going negative:
  // this job is due NOW, and setTimeout would fire immediately anyway.
  return Math.min(ALARM_MAX_SLEEP_MS, Math.max(0, dueAt - now) + ALARM_GUARD_MS);
}

let alarmTimer = null;
let alarmStopped = true;

/** Run the day-before job alone, off the alarm rather than off the sweep. */
async function fireReminderAlarm() {
  // A full sweep in flight already includes this job, and letting both run
  // would have two workers competing over the same guests. Their dedupe keys
  // are UNIQUE indexes, so concurrent sends would not double-deliver — they
  // would collide and retry, which is wasted work and confusing logs for no
  // gain. Skipping is free, because the sweep is doing the job right now.
  if (running) return;

  /* THE COST OF SHARING `running` WITH THE SWEEP, ACCEPTED DELIBERATELY.
     Holding the same flag means that if the fifteen-minute sweep fires while
     this alarm is mid-send, the sweep skips ALL SIX jobs and waits another
     fifteen minutes — so an RSVP chase or a recap can be delayed by one cycle
     because a reminder happened to be going out.

     Kept anyway: a second, finer-grained lock would let both run
     jobEventReminders at once, and trading a rare fifteen-minute delay on soft
     work for a routine race on charged messages is the wrong way round. The
     collision window is the duration of one jobEventReminders call — seconds —
     against a fifteen-minute period. */
  running = true;
  try {
    const sent = await jobEventReminders();
    if (sent) logger.info({ sent, trigger: 'alarm' }, '[email-scheduler] day-before reminders sent on the mark');
  } catch (err) {
    logger.warn({ err }, '[email-scheduler] day-before alarm run failed');
  } finally {
    running = false;
  }
}

/**
 * Sleep until the next mark, then fire and re-arm.
 *
 * Self-correcting by construction: every hop re-derives its own next hop from
 * the database, so a failed query, a missed event or a system clock that jumps
 * costs one hop of accuracy rather than breaking the chain. There is no
 * long-lived timer to get out of date.
 */
async function armReminderAlarm() {
  if (alarmTimer) { clearTimeout(alarmTimer); alarmTimer = null; }
  if (alarmStopped) return;

  let sleep = ALARM_MAX_SLEEP_MS;
  try {
    sleep = alarmSleepMs(await nextEventReminderDueAt());
  } catch (err) {
    logger.warn({ err }, '[email-scheduler] could not read the next reminder mark — retrying next hop');
  }

  // Re-checked because the await above yields, and stop() may have run during it.
  if (alarmStopped) return;

  alarmTimer = setTimeout(async () => {
    await fireReminderAlarm();
    armReminderAlarm().catch(() => {});
  }, sleep);
  if (alarmTimer.unref) alarmTimer.unref();
}

let timer = null;
function start() {
  if (process.env.EMAIL_AUTOMATION_ENABLED !== 'true') {
    /* WARN, not INFO, and it names what is not happening.

       This line was one `info` among a hundred at boot, and the flag is unset
       by default and commented out in .env.production.example — so the most
       likely state of any deployment is "no guest has ever been reminded",
       reported in a tone indistinguishable from a healthy startup. The
       symptom is silence: nothing errors, nothing retries, no row is written,
       and the first sign is a guest arriving without their table.

       Every automatic guest message lives behind this flag — the day-before
       table + entry pass (email AND SMS), the RSVP chase, the post-event
       thank-you, and the organizer's final headcount. */
    logger.warn(
      '[email-scheduler] DISABLED — no automatic guest messages will be sent: '
      + 'no day-before table/entry-pass email or SMS, no RSVP reminders, no final report. '
      + 'Set EMAIL_AUTOMATION_ENABLED=true in backend/.env to turn lifecycle messaging on.',
    );
    return;
  }
  // Single-leader in a pm2 cluster: only instance 0 schedules.
  const instance = process.env.NODE_APP_INSTANCE;
  if (instance !== undefined && instance !== '0') {
    logger.info(`[email-scheduler] standby on instance ${instance} (leader is instance 0)`);
    return;
  }
  const intervalMin = Math.max(5, parseInt(process.env.EMAIL_SCHEDULER_INTERVAL_MIN, 10) || 15);
  logger.info(`[email-scheduler] enabled — full sweep every ${intervalMin} min; day-before reminders fire on the T-24h mark`);
  timer = setInterval(() => runOnce('interval').catch(() => {}), intervalMin * 60 * 1000);
  if (timer.unref) timer.unref();
  setTimeout(() => runOnce('startup').catch(() => {}), 30 * 1000).unref();

  alarmStopped = false;
  armReminderAlarm().catch(() => {});
}
function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  alarmStopped = true;
  if (alarmTimer) { clearTimeout(alarmTimer); alarmTimer = null; }
}

module.exports = {
  start, stop, runOnce, notifyGuestsOfEventChange, NOTIFIABLE_RESPONSES, JOBS,
  // Exported for the timing tests: the alarm's accuracy is the whole point of
  // this module now, and it is not observable through start()/stop() alone.
  nextEventReminderDueAt, fetchConfirmedParties, alarmSleepMs,
  ALARM_MAX_SLEEP_MS, ALARM_GUARD_MS, EVENT_REMINDER_WINDOW_MS,
};
