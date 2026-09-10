const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const { sendEmailViaBrevo } = require('../utils/notificationService');

/**
 * Centralized, idempotent, audited email dispatch.
 *
 * Every automated/transactional email should flow through `dispatch()` so that:
 *   • a (kind, ref) idempotency key prevents duplicate sends (the scheduler can
 *     re-run safely), backed by the UNIQUE index on email_log(kind, ref);
 *   • every send (and failure) is recorded in email_log for a full audit trail.
 *
 * All bookkeeping is best-effort: if email_log doesn't exist yet (migration not
 * applied) the email still sends — the per-entity "*_sent_at" stamps the sweeps
 * use are the primary idempotency guard, this ledger is the safety net + audit.
 */

/**
 * How long a FAILED (kind, ref) stays retryable, measured from the first attempt.
 *
 * ── Why a window rather than "retry until it works" ──
 *
 * Making a failure retryable at all is the fix below. But five lifecycle kinds
 * — rsvp_reminder, event_reminder, final_call, thank_you, event_update — have
 * no `*_sent_at` column behind them, so this ledger is their ONLY guard. With
 * an unbounded retry, one permanently-undeliverable address (a typo, a closed
 * mailbox) would be re-attempted on every sweep, for ever. On a 15-minute
 * interval that is ~96 wasted sends a day per bad address, charged against the
 * event's daily email budget and crowding out mail that could actually arrive.
 *
 * A window fits what these messages ARE: every one of them is about a moment —
 * a deadline, a date, an event that has just happened. Retrying a day-before
 * reminder three days later does not deliver it late, it delivers it wrong. So
 * the retry lasts as long as the message is still worth sending, and then the
 * key is closed for good.
 *
 * Measured from `created_at`, which `record()` deliberately does not touch when
 * it updates a row in place — so the clock starts at the FIRST attempt, not the
 * most recent one.
 */
const FAILED_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Has this exact (kind, ref) already been DELIVERED — or given up on?
 *
 * ── The bug the `status` filter fixes ──
 *
 * This used to match any row for the key, whatever its status — and `record()`
 * writes a row with `status: 'failed'` when Brevo rejects the send. So the very
 * first delivery failure permanently poisoned the idempotency key: every later
 * attempt found that row, reported "duplicate", and the message was never sent
 * again by anything.
 *
 * The SMS twin of this function has always filtered on `status = 'sent'`
 * (smsDispatch.alreadySent). The two siblings answer the same question and
 * disagreed, and the email one was the one that lost mail — including the
 * day-before reminder that carries a guest's table and entry pass.
 *
 * Idempotency is unaffected: a message that genuinely WENT OUT still has its
 * 'sent' row and is still refused a second time. What changed is that a message
 * that did NOT go out is now allowed a second chance — bounded by
 * FAILED_RETRY_WINDOW_MS, so "retryable" cannot become "for ever".
 */
async function alreadyLogged(kind, ref) {
  if (!ref) return false;
  try {
    const { data } = await supabase
      .from('email_log').select('status, created_at').eq('kind', kind).eq('ref', ref).limit(1);
    const row = data && data[0];
    if (!row) return false;

    // Delivered. Never again, whatever else is true.
    if (row.status === 'sent') return true;

    // Attempted and failed. Retryable while the message is still timely.
    const firstAttempt = row.created_at ? new Date(row.created_at).getTime() : NaN;
    if (!Number.isFinite(firstAttempt)) return false;   // no clock → allow the retry
    const expired = Date.now() - firstAttempt > FAILED_RETRY_WINDOW_MS;
    if (expired) {
      logger.warn({ kind, ref, firstAttempt: row.created_at },
        'emailService: giving up on this message — it has been failing beyond the retry window');
    }
    return expired;
  } catch {
    return false; // table missing → fall through to the per-entity flag guard
  }
}

/**
 * Write the audit row for one attempt.
 *
 * ── Why the insert has an update fallback ──
 *
 * `email_log` carries `UNIQUE (kind, ref) WHERE ref IS NOT NULL` (migration
 * 20260625000000). Once `alreadyLogged` stopped treating a failed row as a
 * delivery, a retry after a failure necessarily collides with that row — a
 * plain insert would raise 23505, be swallowed here, and leave the row stuck at
 * 'failed' forever while the mail actually went out. The ledger would then
 * disagree with reality in the one direction that matters: it would keep
 * inviting retries of a message the guest already has.
 *
 * So a conflict is resolved by updating the existing row in place, which is
 * what "this key was attempted, here is how it ended" is supposed to mean.
 * `.upsert()` is deliberately not used: the index is PARTIAL, and PostgREST
 * cannot express a partial index's predicate in an ON CONFLICT target.
 */
async function record(kind, ref, recipient, eventId, subject, status, error) {
  const row = {
    kind, ref: ref || null, recipient: recipient || null,
    event_id: eventId || null, subject: subject || null, status, error: error || null,
  };
  try {
    const { error: insertErr } = await supabase.from('email_log').insert(row);
    if (!insertErr) return;

    const isConflict = insertErr.code === '23505'
      || /duplicate key/i.test(insertErr.message || '');
    if (!isConflict || !ref) {
      logger.warn({ err: insertErr, kind, ref }, 'emailService: could not record the send');
      return;
    }

    const { error: updateErr } = await supabase
      .from('email_log')
      .update({ recipient: row.recipient, subject: row.subject, status, error: row.error })
      .eq('kind', kind)
      .eq('ref', ref);
    if (updateErr) logger.warn({ err: updateErr, kind, ref }, 'emailService: could not update the send record');
  } catch (err) {
    logger.warn({ err, kind, ref }, 'emailService: recording the send threw');
  }
}

/**
 * @param {{kind:string, ref?:string, to:string, subject:string, html:string, eventId?:string}} o
 * @returns {Promise<{sent:boolean, skipped?:string|false, deduplicated?:boolean}>}
 *
 * `deduplicated` is returned alongside `skipped: 'duplicate'` and means exactly
 * one thing: this message has already been delivered, so not sending it is the
 * correct outcome rather than a failure. Callers with retry logic must not
 * retry on it — emailScheduler.dispatchWithRetry checked for this flag and it
 * was never set, so every deduplicated send burned three retries and seven
 * seconds of backoff before logging a "permanently failed" line that was untrue.
 */
async function dispatch({ kind, ref, to, subject, html, eventId }) {
  if (!to) return { sent: false, skipped: 'no_recipient' };
  if (ref && await alreadyLogged(kind, ref)) return { sent: false, skipped: 'duplicate', deduplicated: true };

  let ok = false;
  try {
    ok = await sendEmailViaBrevo(to, subject, html);
  } catch (err) {
    logger.warn({ err, kind, to }, 'emailService: send threw');
    ok = false;
  }
  await record(kind, ref, to, eventId, subject, ok ? 'sent' : 'failed', ok ? null : 'delivery_failed');
  return { sent: ok, skipped: false };
}

module.exports = { dispatch, alreadyLogged, FAILED_RETRY_WINDOW_MS };
