/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TRIAL SWEEP — and what it is NOT responsible for.
 *
 * This does not enforce anything. By the time it runs, an expired trial has
 * already lost its features: `entitledFeatures` (utils/tierResolver.js) reads
 * `events.trial_ends_at` on every gated request and answers with the free
 * plan's entitlement the instant the deadline passes, whether or not this file
 * has ever executed.
 *
 * That separation is deliberate and it is the reason the design is safe. A
 * downgrade that depends on a background job having fired is not a downgrade,
 * it is a hope — and this codebase runs its sweeps in-process, behind a
 * single-leader guard, behind an environment flag, on a box that gets
 * redeployed. If any of that goes wrong the correct outcome is a stale row,
 * not a free platform.
 *
 * So this job has two jobs, and both are about honesty rather than access:
 *
 *   1. WARN, two days out — the one genuinely commercial message in the
 *      feature, and the only chance to convert somebody before the tools
 *      quietly stop working under them.
 *   2. LAND — rewrite the stored tier snapshot to the free plan so the
 *      dashboard, the admin screens and the next invoice all describe the same
 *      reality the gates are already enforcing.
 *
 * ── WHAT IT MUST NEVER DO ────────────────────────────────────────────────
 *
 * Touch `is_paid` or `status`, or delete anything. The event stays live. Its
 * guests were invited by a person, not by us, and they did not agree to
 * anything; a link that dies because a host's trial lapsed is a failure they
 * will report to the host, who will report it to us, correctly, as ours. The
 * seating chart and the guest list stay exactly where they are and come back
 * untouched the moment somebody pays.
 *
 * Safety / behaviour, mirroring the three sweeps already in server.js:
 *   • OFF by default. Set TRIAL_ENABLED=true to run it — the same opt-in
 *     posture eventPurge uses, because this one WRITES to live events.
 *   • No startup prime, for the same reason eventPurge refuses one: a job that
 *     modifies customer rows should not fire during the thirty seconds after a
 *     deploy, when a rollback is most likely.
 *   • Single-leader: in a pm2 cluster only instance 0 schedules.
 *   • Re-entrancy guarded; a slow run cannot overlap itself.
 *   • Best-effort: a failed run logs and never crashes the server.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const { getPlatformConfig } = require('../utils/configCache');
const { dispatch } = require('./emailService');
const { getTrialEndingTemplate, getTrialEndedTemplate } = require('../utils/emailTemplates');
const { getPublicBaseUrl } = require('../utils/publicUrl');
const { resolveTrialPlans, landExpiredTrial } = require('./trialService');
const { hasPaidForItsPlan } = require('../utils/tierResolver');
const { formatInZone } = require('../utils/timezone');

const DAY_MS = 24 * 60 * 60 * 1000;
/** How many events one pass will touch. Small: this runs often and writes. */
const BATCH = 100;

let running = false;

/** The organizer-facing columns both phases need.
 *
 *  `tier_price_cents` is in here for one reason: an organizer who upgrades
 *  mid-trial keeps their `trial_ends_at`, and landing them on the free plan
 *  would be taking away a plan they paid for. It is the same test the GATE
 *  uses (`hasPaidForItsPlan` in tierResolver), on purpose — the row this sweep
 *  writes and the entitlement the gates enforce have to be answers to the same
 *  question, or the dashboard and the API disagree about what somebody has. */
const SELECT = 'id, title, slug, timezone, tier_key, tier_price_cents, trial_ends_at, trial_expired_at, trial_warned_at, organizations(name, email)';

function warnDays() {
  return Math.max(1, parseInt(process.env.TRIAL_WARN_DAYS, 10) || 2);
}

/**
 * "Two days left."
 *
 * Stamped AFTER the send, not before — a failed send is retried on the next
 * pass rather than silently swallowed. The opposite order would lose the one
 * commercial message this feature has, permanently, to a transient Brevo
 * error. (eventPurge stamps after its warning for the same reason.)
 */
async function warnEndingTrials(now = Date.now()) {
  const horizon = new Date(now + warnDays() * DAY_MS).toISOString();

  const { data: rows, error } = await supabase
    .from('events')
    .select(SELECT)
    .not('trial_ends_at', 'is', null)
    .is('trial_warned_at', null)
    .is('trial_expired_at', null)
    .lte('trial_ends_at', horizon)
    .gt('trial_ends_at', new Date(now).toISOString())
    .limit(BATCH);

  if (error) throw error;
  if (!rows?.length) return 0;

  let sent = 0;
  for (const event of rows) {
    const email = event.organizations?.email;
    if (!email) {
      // No address to reach them on. Stamp anyway so the query does not
      // return this row on every pass forever.
      // eslint-disable-next-line no-await-in-loop
      await supabase.from('events').update({ trial_warned_at: new Date().toISOString() }).eq('id', event.id);
      continue;
    }

    const msLeft = new Date(event.trial_ends_at).getTime() - now;
    const daysLeft = Math.max(1, Math.ceil(msLeft / DAY_MS));

    try {
      // eslint-disable-next-line no-await-in-loop
      await dispatch({
        kind: 'trial_ending',
        // One per event, ever. `email_log`'s (kind, ref) uniqueness is what
        // stops a re-run of this sweep mailing somebody twice.
        ref: event.id,
        to: email,
        subject: `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left on your Fancy trial`,
        html: getTrialEndingTemplate({
          orgName: event.organizations?.name || 'there',
          eventTitle: event.title || 'Your event',
          daysLeft,
          endsOn: formatInZone(event.trial_ends_at, event.timezone, { dateStyle: 'long' }) || null,
          upgradeUrl: `${getPublicBaseUrl()}/dashboard?event=${event.id}&tab=settings`,
        }),
        eventId: event.id,
      });
      sent += 1;
    } catch (err) {
      logger.warn({ err, eventId: event.id }, '[trial-sweep] warning email failed — will retry next pass');
      // eslint-disable-next-line no-continue
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await supabase.from('events').update({ trial_warned_at: new Date().toISOString() }).eq('id', event.id);
  }
  return sent;
}

/** Land every trial whose deadline has passed onto the free plan. */
/* `tiers` is deliberately NOT a parameter any more. It was here so the sweep
   could ask which plan an event was on; that question is now answered by the
   row itself (`hasPaidForItsPlan`), and a config argument nothing reads is an
   invitation to start reading it again. */
async function landDueTrials(landing, now = Date.now()) {
  const { data: rows, error } = await supabase
    .from('events')
    .select(SELECT)
    .not('trial_ends_at', 'is', null)
    .is('trial_expired_at', null)
    .lte('trial_ends_at', new Date(now).toISOString())
    .limit(BATCH);

  if (error) throw error;
  if (!rows?.length) return 0;

  let landed = 0;
  for (const event of rows) {
    /* THEY MAY HAVE PAID. An organizer who upgrades on day 3 keeps the
       deadline stamped on day 0 — the payment path rewrites the plan, not the
       trial columns — so a sweep that trusted the deadline alone would move a
       paying customer onto the free plan on day 8. Money on the row is what
       says they left; asking which PLAN they are on instead was wrong in both
       directions once an admin edited the price list (see the long note in
       entitledFeatures). Stamp them so the query stops returning them, and
       move on. */
    if (hasPaidForItsPlan(event)) {
      // eslint-disable-next-line no-await-in-loop
      await supabase.from('events')
        .update({ trial_expired_at: new Date().toISOString() })
        .eq('id', event.id)
        .is('trial_expired_at', null);
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const result = await landExpiredTrial(event, landing);
    if (!result.ok) continue;
    landed += 1;

    const email = event.organizations?.email;
    if (!email) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await dispatch({
        kind: 'trial_ended',
        ref: event.id,
        to: email,
        subject: 'Your Fancy trial has ended — your invitation is still live',
        html: getTrialEndedTemplate({
          orgName: event.organizations?.name || 'there',
          eventTitle: event.title || 'Your event',
          eventUrl: `${getPublicBaseUrl()}/${event.slug || ''}`,
          upgradeUrl: `${getPublicBaseUrl()}/dashboard?event=${event.id}&tab=settings`,
          planName: landing?.name || null,
        }),
        eventId: event.id,
      });
    } catch (err) {
      // The row is already landed and the gates already agree. A missing
      // email is a communication failure, not an entitlement one.
      logger.warn({ err, eventId: event.id }, '[trial-sweep] ended email failed (non-fatal)');
    }
  }
  return landed;
}

/** One pass. Resolves regardless of success (best-effort). */
async function runOnce(trigger = 'interval') {
  if (running) {
    logger.info('[trial-sweep] previous run still in progress — skipping');
    return { ok: false, skipped: true };
  }
  running = true;
  const t0 = Date.now();
  try {
    const config = await getPlatformConfig();
    const plans = resolveTrialPlans(config.pricing_tiers);
    if (!plans.ok) {
      /* No trial plan at all. Refusing to guess is the whole point:
         `startTrial` makes the same check and would not have granted
         anything, so an outstanding trial in this state means an admin
         deleted the plan mid-flight. The gates have ALREADY dropped those
         events to the baseline — nothing is over-granted while this waits.

         A missing LANDING plan is not this case and never reaches here:
         `plans.ok` stays true with `landing: null`, and `landExpiredTrial`
         writes the zeroed snapshot that leaves the event on the baseline. */
      logger.warn({ reason: plans.error }, '[trial-sweep] no trial/landing plan configured — nothing swept');
      return { ok: false, error: plans.error };
    }

    const warned = await warnEndingTrials();
    const landed = await landDueTrials(plans.landing);

    if (warned || landed) {
      logger.info({ warned, landed, ms: Date.now() - t0, trigger }, '[trial-sweep] pass complete');
    }
    return { ok: true, warned, landed };
  } catch (err) {
    logger.warn({ err, trigger }, '[trial-sweep] run failed (non-fatal)');
    return { ok: false, error: err };
  } finally {
    running = false;
  }
}

let timer = null;

function start() {
  if (process.env.TRIAL_ENABLED !== 'true') {
    logger.info('[trial-sweep] disabled (set TRIAL_ENABLED=true to run)');
    return;
  }
  const instance = process.env.NODE_APP_INSTANCE;
  if (instance !== undefined && instance !== '0') {
    logger.info(`[trial-sweep] standby on instance ${instance} (leader is instance 0)`);
    return;
  }
  const intervalMin = Math.max(5, parseInt(process.env.TRIAL_SWEEP_INTERVAL_MIN, 10) || 60);
  logger.info(`[trial-sweep] enabled — checking trials every ${intervalMin} min`);
  timer = setInterval(() => runOnce('interval').catch(() => {}), intervalMin * 60 * 1000);
  if (timer.unref) timer.unref();
  /* NO STARTUP PRIME, deliberately. This writes to live customer events, and
     the thirty seconds after a deploy is exactly when a rollback is most
     likely — a sweep that has already rewritten a hundred plans is not
     something a rollback undoes. It can wait one interval. Same reasoning as
     eventPurge. */
}

function stop() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { start, stop, runOnce, warnEndingTrials, landDueTrials };
