/**
 * ─────────────────────────────────────────────────────────────────────────────
 * POST-EVENT DATA PURGE
 *
 * When an event finishes, everything belonging to it is deleted — guests,
 * RSVPs, seating, door check-ins, message history, the public page. The
 * organizer is warned by email first and given a grace window (24h by default)
 * and a link to download the whole thing as a spreadsheet.
 *
 * ── TWO PHASES, AND THE ORDER IS THE SAFETY PROPERTY ──
 *
 *   1. WARN   event ended, never warned  → send the email, then stamp
 *                                          purge_warning_sent_at = now and
 *                                          purge_scheduled_at = now + grace
 *   2. PURGE  purge_scheduled_at <= now  → log it, then DELETE the event row
 *
 * The deadline is PERSISTED at warning time, never derived from the event's end
 * date when the sweep runs. That distinction is the whole design:
 *
 *   Derived:   deadline = ended_at + 24h. The scheduler is down for two days.
 *              It comes back, and every event that finished in that window is
 *              already past a deadline nobody was ever told about. The first
 *              sweep deletes all of them, immediately, with no warning sent.
 *   Persisted: the clock cannot start until the email goes out. An outage
 *              delays the warning and the deletion equally, which is the only
 *              behaviour that keeps the promise the email makes.
 *
 * The stamp is also written AFTER the send rather than before, so a failed
 * email leaves the event unwarned and it is retried on the next sweep. The cost
 * of getting that backwards is silent, permanent data loss for one customer.
 *
 * ── WHAT IS NEVER TOUCHED ──
 *
 *   • drafts (services/draftCleanup.js owns those, on a different rule)
 *   • events with purge_opt_out = true
 *   • events whose effective end is still in the future
 *
 * ── Safety / behaviour (mirrors draftCleanup / emailScheduler / revenueRollup) ──
 *   • OFF unless EVENT_PURGE_ENABLED=true. Deliberately opt-IN, unlike
 *     draftCleanup: that one deletes abandoned placeholders nobody ever opened,
 *     this one deletes real customer data, and the two do not deserve the same
 *     default.
 *   • Single-leader: in a pm2 cluster only instance 0 schedules.
 *   • Best-effort: a failed run logs a warning and never crashes the server.
 *   • Re-entrancy guarded so a slow run can't overlap itself.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const { dispatch } = require('./emailService');
const tokenService = require('./tokenService');
const T = require('../utils/emailTemplates');
const { getPublicBaseUrl } = require('../utils/publicUrl');

const HOUR = 3600 * 1000;
const nowISO = () => new Date().toISOString();

/**
 * How long after an event ends the organizer has before the data goes.
 *
 * Floored at one hour. A grace window of zero would mean the warning email and
 * the deletion are dispatched by the same sweep, in that order, milliseconds
 * apart — the organizer would receive a notice about something that had already
 * happened, with a dead download link attached.
 */
const graceMs = () => Math.max(HOUR, (parseFloat(process.env.PURGE_GRACE_HOURS) || 24) * HOUR);

/**
 * Assumed duration for an event with no explicit end time.
 *
 * `events.event_end_date` is nullable and most organizers never set it, so
 * without a fallback this feature would simply not run for the majority of
 * events. Six hours is a long dinner reception — deliberately generous, because
 * being wrong in this direction delays a deletion and being wrong in the other
 * deletes a guest list while the party is still going.
 */
const assumedDurationMs = () => Math.max(HOUR, (parseFloat(process.env.PURGE_ASSUMED_DURATION_HOURS) || 6) * HOUR);

/** Is the "keep my data" escape hatch offered in the warning email? */
const optOutAllowed = () => process.env.PURGE_ALLOW_OPT_OUT !== 'false';

/** How many finished events one warning sweep will consider. See the note at the query. */
const WARN_PAGE_SIZE = 200;

/**
 * When an event is actually over.
 *
 * Returns null for a row with no usable start, which the callers treat as "not
 * eligible" — an event whose date cannot be parsed must never be deleted on the
 * strength of a NaN comparison.
 */
function effectiveEndAt(event) {
  if (event?.event_end_date) {
    const end = new Date(event.event_end_date).getTime();
    if (!Number.isNaN(end)) return end;
  }
  const start = new Date(event?.event_date).getTime();
  if (Number.isNaN(start)) return null;
  return start + assumedDurationMs();
}

/** The two links in the warning email. */
function buildLinks(eventId) {
  const base = getPublicBaseUrl();
  const grace = graceMs();
  const archiveUrl = `${base}/api/v1/events/archive?token=${encodeURIComponent(
    tokenService.signEventArchive({ eventId, graceMs: grace }),
  )}`;
  const keepUrl = optOutAllowed()
    ? `${base}/api/v1/events/keep?token=${encodeURIComponent(
      tokenService.signEventKeep({ eventId, graceMs: grace }),
    )}`
    : null;
  return { archiveUrl, keepUrl };
}

/**
 * Counts for the warning email and the purge log.
 *
 * Head-only counts, so this costs three cheap index lookups rather than pulling
 * any rows. Failures degrade to null: a missing number weakens the email
 * slightly, and must not stop the warning going out.
 */
async function countHoldings(eventId) {
  const safeCount = async (table, column = 'event_id') => {
    try {
      const { count } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq(column, eventId);
      return Number.isFinite(count) ? count : null;
    } catch {
      return null;
    }
  };
  const [parties, guests, checkins] = await Promise.all([
    safeCount('rsvp_parties'), safeCount('guests'), safeCount('check_ins'),
  ]);
  return { parties, guests, checkins };
}

/* ─── Phase 1: warn ───────────────────────────────────────────────────────── */

async function warnFinishedEvents() {
  /**
   * Selected by START date, not by the computed end.
   *
   * The end is `event_end_date ?? event_date + assumed duration`, which is not a
   * column and cannot be filtered on in PostgREST. So the query casts a wider
   * net — anything that started before now — and `effectiveEndAt` does the
   * precise test in JS. The alternative is a generated column and a migration
   * to backfill it, for a sweep that runs hourly over a bounded set.
   */
  const { data: events, error } = await supabase
    .from('events')
    .select('id, title, slug, org_id, event_date, event_end_date, timezone, status, is_paid, organizations(name, email)')
    /**
     * Every status a real event can hold EXCEPT 'draft'.
     *
     * 'paused' belongs here and was missing. Pausing stops RSVPs; it does not
     * un-happen the event, so a paused event whose date has passed is finished
     * in exactly the sense this sweep means — and leaving it out meant that
     * class of event accumulated indefinitely, never warned and never purged,
     * which is the one outcome the retention policy exists to prevent.
     *
     * 'draft' stays out: services/draftCleanup.js owns those on a different
     * rule, and a draft has no guests to warn anybody about.
     */
    .in('status', ['active', 'paused', 'completed', 'cancelled'])
    .eq('is_paid', true)
    .eq('purge_opt_out', false)
    .is('purge_warning_sent_at', null)
    .lt('event_date', nowISO())
    .order('event_date', { ascending: true })
    .limit(WARN_PAGE_SIZE);

  if (error) throw error;

  /**
   * A SATURATED PAGE IS REPORTED, because this filter does not drain by itself.
   *
   * A warned event is stamped and drops out. An event that CANNOT be warned —
   * no organizer address, or delivery failing every time — stays in the filter
   * forever and occupies a slot on every sweep. Enough of those and the tail of
   * the queue is never reached, which is the `.limit()` starvation this
   * codebase has already been bitten by once (the 250-row guest fetch that
   * silently skipped guest 251).
   *
   * Oldest-first ordering keeps it fair, and the failure direction is safe —
   * deletion delayed, never data destroyed early. But it is invisible without
   * this line, so it gets one.
   */
  if ((events || []).length >= WARN_PAGE_SIZE) {
    logger.warn({ pageSize: WARN_PAGE_SIZE },
      '[event-purge] the warning sweep filled its page — some finished events may be waiting behind un-warnable ones (check for "no organizer email" above)');
  }

  let warned = 0;
  for (const ev of (events || [])) {
    const endedAt = effectiveEndAt(ev);
    if (endedAt === null || endedAt > Date.now()) continue;  // still running

    const org = Array.isArray(ev.organizations) ? ev.organizations[0] : ev.organizations;
    const deleteAt = new Date(Date.now() + graceMs()).toISOString();

    /**
     * NO ADDRESS TO WARN — and therefore nothing to schedule.
     *
     * Leaving purge_scheduled_at null means this event is never picked up by
     * the delete sweep. That is the correct outcome and not an oversight: the
     * grace window is the promise that makes the deletion fair, and an event
     * whose owner cannot be told has not been given one. It stays, and the row
     * is re-examined on every sweep in case an address is added later.
     */
    if (!org?.email) {
      logger.warn({ eventId: ev.id }, '[event-purge] no organizer email — deletion NOT scheduled');
      continue;
    }

    const { archiveUrl, keepUrl } = buildLinks(ev.id);
    const stats = await countHoldings(ev.id);

    let result;
    try {
      result = await dispatch({
        kind: 'event_data_deletion_warning',
        ref: `event:${ev.id}`,
        to: org.email,
        subject: `Your data for ${ev.title} is deleted in ${Math.round(graceMs() / HOUR)} hours`,
        html: T.getEventDataDeletionWarningTemplate({
          orgName: org.name, event: ev, deleteAt, archiveUrl, keepUrl, stats, timeZone: ev.timezone,
        }),
        eventId: ev.id,
      });
    } catch (err) {
      logger.warn({ err, eventId: ev.id }, '[event-purge] warning email threw — will retry next sweep');
      continue;
    }

    /**
     * `duplicate` counts as delivered, and it has to.
     *
     * emailService dedupes on email_log's UNIQUE (kind, ref). If a previous
     * sweep sent the warning and then crashed before stamping the event, this
     * one gets `skipped: 'duplicate'` — meaning the customer HAS been warned.
     * Treating that as a failure would loop forever: never stamping, never
     * scheduling, and never deleting anything, silently.
     */
    const delivered = result?.sent === true || result?.skipped === 'duplicate';
    if (!delivered) {
      logger.warn({ eventId: ev.id, skipped: result?.skipped }, '[event-purge] warning not delivered — deletion NOT scheduled');
      continue;
    }

    // Stamped only AFTER the mail is away. See the module docblock.
    const { error: stampErr } = await supabase
      .from('events')
      .update({ purge_warning_sent_at: nowISO(), purge_scheduled_at: deleteAt })
      .eq('id', ev.id);

    if (stampErr) {
      /**
       * The mail went and the stamp did not. The next sweep re-selects this
       * event (purge_warning_sent_at is still null), dispatch dedupes the email
       * away as a duplicate, and the branch above then stamps it. So this
       * self-heals, and the failure mode is a delayed deletion rather than an
       * unwarned one — which is the direction to be wrong in.
       */
      logger.warn({ err: stampErr, eventId: ev.id }, '[event-purge] warned but could not stamp — retrying next sweep');
      continue;
    }

    warned += 1;
    logger.info({ eventId: ev.id, deleteAt }, '[event-purge] organizer warned; deletion scheduled');
  }

  return warned;
}

/* ─── Phase 2: purge ──────────────────────────────────────────────────────── */

async function purgeDueEvents() {
  const { data: due, error } = await supabase
    .from('events')
    .select('id, title, slug, org_id, event_date, event_end_date, purge_warning_sent_at, purge_scheduled_at')
    .eq('purge_opt_out', false)
    // Belt AND braces. `purge_scheduled_at` is only ever written together with
    // `purge_warning_sent_at`, so this predicate should be redundant — but it is
    // the difference between "a stray UPDATE somewhere sets a date" and "data is
    // destroyed without anybody being told", so it is stated rather than assumed.
    .not('purge_warning_sent_at', 'is', null)
    .not('purge_scheduled_at', 'is', null)
    .lte('purge_scheduled_at', nowISO())
    .limit(100);

  if (error) throw error;

  let purged = 0;
  for (const ev of (due || [])) {
    try {
      const counts = await countHoldings(ev.id);

      /**
       * THE LOG ROW GOES IN BEFORE THE DELETE, NOT AFTER.
       *
       * After the DELETE there is nothing left to count and — if the process
       * dies between the two writes — no record anywhere that the event ever
       * existed. Writing first means the worst case is a log row for a deletion
       * that did not complete, which the next sweep resolves by deleting the
       * event; the row is then simply accurate a few minutes early.
       *
       * event_purge_log deliberately carries no FK to events, so this row
       * survives the cascade that is about to run.
       */
      const { error: logErr } = await supabase.from('event_purge_log').insert({
        event_id: ev.id,
        org_id: ev.org_id || null,
        event_title: ev.title || null,
        event_slug: ev.slug || null,
        ended_at: ev.event_end_date || ev.event_date || null,
        warned_at: ev.purge_warning_sent_at || null,
        party_count: counts.parties,
        guest_count: counts.guests,
        checkin_count: counts.checkins,
      });
      if (logErr) {
        // Refuse to delete something we cannot record deleting.
        logger.error({ err: logErr, eventId: ev.id }, '[event-purge] could not write the purge log — REFUSING to delete');
        continue;
      }

      // Cascades to every related table via the existing FK ON DELETE CASCADE,
      // exactly as the organizer-triggered deleteEvent endpoint does.
      const { error: delErr } = await supabase.from('events').delete().eq('id', ev.id);
      if (delErr) throw delErr;

      /**
       * Drop the cached public page.
       *
       * Without this the guest page for a deleted event keeps being served from
       * Next's cache for up to 60s — a purged event still publicly readable is
       * precisely the outcome the purge exists to prevent. Best-effort: the row
       * is already gone and a stale cache entry expires on its own.
       */
      try {
        const { revalidateEventSlugs } = require('../utils/revalidateFrontend');
        await revalidateEventSlugs(ev.slug || null);
      } catch (err) {
        logger.warn({ err, eventId: ev.id }, '[event-purge] cache purge failed (page may serve stale for up to 60s)');
      }

      purged += 1;
      logger.info({ eventId: ev.id, title: ev.title, ...counts }, '[event-purge] event data permanently deleted');
    } catch (err) {
      // One event failing must not abandon the rest of the batch.
      logger.warn({ err, eventId: ev.id }, '[event-purge] purge failed for this event (non-fatal)');
    }
  }

  return purged;
}

/* ─── Runner ──────────────────────────────────────────────────────────────── */

let running = false;

/** One warn+purge pass. Resolves regardless of success (best-effort). */
async function runOnce(trigger = 'interval') {
  if (running) {
    logger.info('[event-purge] previous run still in progress — skipping');
    return { ok: false, skipped: true };
  }
  running = true;
  const t0 = Date.now();
  try {
    // WARN BEFORE PURGE, within the run as well as across runs. An event that
    // becomes eligible for a warning in this pass must not also be considered
    // for deletion in it — and it cannot be, because warning stamps a deadline
    // a full grace window in the future.
    const warned = await warnFinishedEvents();
    const purged = await purgeDueEvents();
    if (warned || purged) {
      logger.info({ warned, purged, ms: Date.now() - t0, trigger }, '[event-purge] run complete');
    }
    return { ok: true, warned, purged };
  } catch (err) {
    logger.warn({ err, trigger }, '[event-purge] run failed (non-fatal)');
    return { ok: false, error: err };
  } finally {
    running = false;
  }
}

let timer = null;

function start() {
  /**
   * OPT-IN, and the asymmetry with draftCleanup is deliberate.
   *
   * draftCleanup defaults ON because it removes never-launched placeholder rows
   * nobody has ever seen. This deletes paid events with real guest lists, door
   * records and consent history in them. A feature that destroys customer data
   * should not switch itself on because somebody deployed.
   */
  if (process.env.EVENT_PURGE_ENABLED !== 'true') {
    logger.info('[event-purge] disabled — no event data will be deleted. Set EVENT_PURGE_ENABLED=true to turn the post-event purge on.');
    return;
  }
  // Single-leader in a pm2 cluster: only instance 0 schedules.
  const instance = process.env.NODE_APP_INSTANCE;
  if (instance !== undefined && instance !== '0') {
    logger.info(`[event-purge] standby on instance ${instance} (leader is instance 0)`);
    return;
  }

  const intervalMin = Math.max(5, parseInt(process.env.EVENT_PURGE_INTERVAL_MIN, 10) || 30);
  logger.warn(
    `[event-purge] ENABLED — organizers are warned when an event ends and ALL of its data is permanently deleted `
    + `${Math.round(graceMs() / HOUR)}h later. Sweeping every ${intervalMin} min.`,
  );
  timer = setInterval(() => runOnce('interval').catch(() => {}), intervalMin * 60 * 1000);
  if (timer.unref) timer.unref();

  /**
   * NO STARTUP PRIME, unlike every other scheduler here.
   *
   * The others run 30 seconds after boot to avoid waiting a full interval on a
   * fresh deploy. This one waits, on purpose: a deploy is exactly when a
   * misconfiguration is most likely to be live, and the first thing this service
   * would otherwise do — within half a minute, before anyone has looked at the
   * logs — is start deleting events. One interval of delay costs nothing and
   * leaves a window to see the warning above and switch it back off.
   */
}

function stop() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = {
  start,
  stop,
  runOnce,
  warnFinishedEvents,
  purgeDueEvents,
  // Exported for eventPurge.test.js — the end-time fallback and the grace window
  // are the two numbers that decide when data is destroyed, so they are asserted
  // directly rather than inferred from a sweep.
  effectiveEndAt,
  graceMs,
  assumedDurationMs,
  optOutAllowed,
};
