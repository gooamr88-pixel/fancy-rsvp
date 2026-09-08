/**
 * A DAILY CEILING ON ORGANIZER-TRIGGERED EMAIL.
 *
 * ── The hole this fills ──────────────────────────────────────────────────
 *
 * Text messages on this platform are metered to the segment: a wallet, a
 * ledger, an atomic debit before the carrier call, a 402 when the plan has
 * not bought any. Email has none of that. There is no counter anywhere, no
 * per-event cap and no per-account cap — and `POST /invitations/send` with
 * `resend: true` re-mails every party with an address, up to two thousand at a
 * time, behind nothing but the global 1000-request rate limit.
 *
 * That was survivable while publishing an event required paying for it. A free
 * trial removes the payment and keeps the send button, so a stranger with a
 * throwaway address can now reach our Brevo account. This is the bound.
 *
 * ── Counted, not stored ──────────────────────────────────────────────────
 *
 * `email_log` already records every dispatch with an `event_id` and a
 * `created_at` — it is what makes sends idempotent. Counting rows in it is one
 * indexed query per bulk send and needs no new table, no new column and no
 * migration. A dedicated counter would be faster and would also be a second
 * source of truth about how much mail an event has sent; this one cannot drift
 * from reality because it IS reality.
 *
 * ── Two ceilings, and only one of them is a product decision ─────────────
 *
 * The trial ceiling is deliberately generous relative to a 25-guest cap — it
 * is there to stop a script, not to ration a customer. The paid ceiling is a
 * safety net set far above any real event's needs; it exists so that a bug in
 * our own scheduler, or a compromised account, cannot empty the mail budget
 * overnight. Neither should ever be reached by somebody using the product as
 * intended, and both say so when they are.
 */

const { supabase } = require('../config/supabase');
const logger = require('./logger');

const DAY_MS = 24 * 60 * 60 * 1000;

/** A trial event's daily allowance. 25 guests × several sends of headroom. */
const TRIAL_DAILY = Math.max(10, parseInt(process.env.TRIAL_EMAIL_DAILY_CAP, 10) || 150);

/** The safety net over a paying event. Not a product limit — a circuit breaker. */
const PAID_DAILY = Math.max(100, parseInt(process.env.EVENT_EMAIL_DAILY_CAP, 10) || 5000);

/**
 * Is this event on a trial?
 *
 * ITS OWN QUERY, and that is not laziness. The obvious move is to add
 * `trial_ends_at` to the column list `resolveLiveEvent` already selects — and
 * that select is on the invitation-send path, so on a database that has not
 * been given the trial migration yet, PostgREST would reject the whole thing
 * (42703) and NOBODY could send an invitation. Not trial accounts: nobody.
 * That failure mode has happened here before, with `tier_key`.
 *
 * One tiny indexed read, isolated, that answers "no" to any error — including
 * the column not existing. An un-migrated deployment then applies the paid
 * ceiling to everything, which is the safe direction: a cap that is too high
 * costs money, a send path that is broken costs customers.
 */
async function isTrialEvent(eventId) {
  try {
    const { data, error } = await supabase
      .from('events').select('trial_ends_at').eq('id', eventId).single();
    if (error) return false;
    return !!data?.trial_ends_at;
  } catch {
    return false;
  }
}

/**
 * How much mail may this event still send today?
 *
 * @param {string} eventId
 * @returns {Promise<{ allowed: number, cap: number, used: number, isTrial: boolean }>}
 *
 * FAILS OPEN. If the count cannot be read, sending proceeds. That is the right
 * direction for this particular guard and it is worth being explicit about
 * why: this is a cost ceiling, not an entitlement gate. Refusing to send a
 * wedding invitation because a COUNT query timed out would break the product
 * for a paying customer in order to protect a budget — the wrong trade by a
 * distance. The entitlement gates in featureGate fail closed; this one does
 * not, and the difference is deliberate.
 */
async function remainingEmailBudget(eventId) {
  const isTrial = await isTrialEvent(eventId);
  const cap = isTrial ? TRIAL_DAILY : PAID_DAILY;
  const since = new Date(Date.now() - DAY_MS).toISOString();

  try {
    const { count, error } = await supabase
      .from('email_log')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .gte('created_at', since);

    if (error) throw error;
    const used = Number(count) || 0;
    return { allowed: Math.max(0, cap - used), cap, used, isTrial };
  } catch (err) {
    logger.warn({ err, eventId }, '[email-budget] could not read usage — allowing the send');
    return { allowed: cap, cap, used: 0, isTrial };
  }
}

/** The sentence an organizer sees when they hit it. Names the number. */
function budgetMessage({ cap, isTrial }) {
  return isTrial
    ? `Your free trial can send ${cap} emails a day, and today's are used up. It resets in 24 hours — or choose a plan to lift the limit.`
    : `This event has reached its daily limit of ${cap} emails. It resets in 24 hours. If you genuinely need more, contact us and we will raise it.`;
}

module.exports = { remainingEmailBudget, budgetMessage, isTrialEvent, TRIAL_DAILY, PAID_DAILY };
