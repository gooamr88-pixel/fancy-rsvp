/**
 * Shared SMS dispatch primitives — consent and opt-out resolution,
 * segment-accurate atomic credit billing, and the actual carrier send.
 *
 * `sendTransactionalSms` is the ONLY way a message leaves this platform. It used
 * to have a sibling: free-text campaigns resolved their own audience, rendered
 * their own body and called `sendRecipient` directly, bypassing the entitlement,
 * per-type and idempotency gates entirely and relying on route middleware to
 * substitute for them. That path is gone with the four-type rebuild, and its
 * removal is the point rather than a side effect — two ways to send meant two
 * places for a consent rule to be enforced, and one of them was always going to
 * fall behind the other.
 *
 * `sendRecipient` survives as the one-recipient primitive underneath, but it is
 * no longer exported: nothing outside this file should be able to reach the
 * carrier without passing the gate chain first.
 */
const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const { computeSmsSegments } = require('../utils/smsSegments');
const { normalizeToE164 } = require('../utils/phone');
const { smsMockBillingEnabled } = require('../config/features');
const { resolveProvider } = require('./smsProviders');

// GSM-7-safe separator (an em-dash forces UCS-2 → 70-char segments → triple cost).
const BRANDING = ' - Fancy RSVP';
// CTIA/Twilio toll-free: every outbound message must identify the sender and
// carry opt-out/help language and the rates disclosure. Appended to EVERY body
// (frontend/src/app/dashboard/campaigns/page.js mirrors this string exactly for
// its segment-cost estimate — keep the two in sync). All-ASCII → stays GSM-7.
const COMPLIANCE_FOOTER = `${BRANDING}. Msg&data rates may apply. Reply STOP to opt out, HELP for help.`;

// CTIA requires HELP to be answered with support information. Twilio answers it on
// the number itself; where the carrier does NOT (see smsProviders/vonage.js
// `handlesHelpKeyword`) we send this instead. Kept all-ASCII and under 160 chars so
// it is a single GSM-7 segment, which is what carriers require of a HELP response.
const HELP_REPLY = 'Fancy RSVP: help with event texts? Email info@fancyrsvp.com. Msg&data rates may apply. Reply STOP to opt out.';

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};
const normalizePhone = (p) => String(p || '').replace(/[\s\-().]/g, '');
const isValidPhone = (p) => /^\+?[1-9]\d{6,14}$/.test(p);
const isUndefinedFunction = (error) =>
  !!error && (error.code === '42883' || error.code === 'PGRST202' ||
    /Could not find the function|does not exist/i.test(error.message || ''));

/* ═══ THE EXPRESS-CONSENT GATE (TCPA / Twilio TFV rejection 30475) ═══════════
 *
 * This is the rule the whole subsystem exists to obey, so it is written down
 * once, here, rather than restated at each place that enforces it.
 *
 * A party is a valid SMS recipient only when `rsvp_parties.sms_consent = true`.
 * That single flag has several possible provenances, distinguished by
 * `sms_consent_method`:
 *
 *   true  + guest_optin     → the guest personally ticked the optional, unbundled
 *                             checkbox on an RSVP form. Send.
 *   true  + host_attested   → the organizer formally attested, per guest, that
 *                             they hold this person's prior express consent
 *                             (Terms §5, migration 20260812010000). Send.
 *   true  + <null>/other    → legacy or /sms-opt-in propagation. Send.
 *   false + sms_consent_at SET   → asked and DECLINED, or consent revoked because
 *                             the number changed. NEVER send.
 *   false + sms_consent_at NULL  → never asked. NEVER send: absence of a record is
 *                             not consent, and historical rows are deliberately
 *                             not migrated into consent.
 *
 * The precedence rule that makes host attestation safe lives in
 * guestService.recordHostConsentAttestation: the attesting UPDATE is guarded by
 * `.is('sms_consent_at', null)`, so it can only ever write to a party that has
 * NEVER recorded a decision. A guest who declined cannot be attested over.
 *
 * One thing sits OUTSIDE this flag and overrides it regardless of provenance:
 * `sms_opt_outs` — a STOP reply suppresses the number globally, across every
 * event, permanently, until they text START.
 *
 * Do NOT loosen any consent query to an `.or()` that treats a NULL timestamp as
 * sendable. That exact loosening is what got the toll-free number rejected, and
 * a deregistration stops SMS for every customer on the platform at once.
 * ═════════════════════════════════════════════════════════════════════════ */

/* ─── Opt-out suppression (sms_opt_outs, written by the inbound STOP webhook) ─── */

const isUndefinedTable = (error) =>
  !!error && (error.code === '42P01' ||
    /relation .* does not exist|Could not find the table/i.test(error.message || ''));

/**
 * The suppression table stores Twilio's `From` — always +E.164 — so lookups
 * must compare in that exact form. normalizeToE164 also repairs legacy rows
 * stored without the leading + (a bare 10-digit US number becomes +1XXX…),
 * which plain formatting-stripping would fail to match.
 */
const canonicalPhone = (p) => normalizeToE164(p) || normalizePhone(p) || null;

/**
 * Return the subset of `phones` (any format; canonicalized internally) that are
 * currently opted out, keyed by canonical +E.164. Fails OPEN with a loud warning
 * if the suppression table has not been migrated yet — same missing-schema
 * tolerance as the credit RPCs.
 */
async function getOptedOutSet(phones) {
  const out = new Set();
  const unique = [...new Set((phones || []).map(canonicalPhone).filter(Boolean))];
  for (const part of chunk(unique, 500)) {
    const { data, error } = await supabase
      .from('sms_opt_outs').select('phone').is('opted_back_in_at', null).in('phone', part);
    if (error) {
      if (isUndefinedTable(error)) {
        logger.warn('sms_opt_outs missing — apply 20260809000000_sms_compliance.sql (opt-outs are NOT being enforced).');
        return out;
      }
      throw error;
    }
    for (const row of (data || [])) out.add(row.phone);
  }
  return out;
}

/** True when this single number is on the suppression list. */
async function isOptedOut(phone) {
  const canonical = canonicalPhone(phone);
  if (!canonical) return false;
  const set = await getOptedOutSet([phone]);
  return set.has(canonical);
}

/* ─── Express-consent verification (Twilio TFV 30475 / TCPA) ─── */

/**
 * Every phone number on this event whose owner personally opted in
 * (rsvp_parties.sms_consent = true). Returned canonicalized to +E.164 so it can
 * be compared against numbers stored in any format.
 *
 * The whole event's consented set is fetched rather than filtering by the
 * candidate numbers: stored numbers are not guaranteed canonical, so an `.in()`
 * on raw values would miss legitimate matches. The set is bounded by event size.
 *
 * Unlike the opt-out lookup — which fails OPEN so a missing suppression table
 * cannot silently block all sending — this fails CLOSED. Absence of proof of
 * consent is not consent, so any error here must stop the send, not permit it.
 *
 * That fail-closed direction is exactly why the row cap is explicit and loud: a
 * silently truncated set does not over-send, it under-sends, dropping consenting
 * guests with a per-message "NO_SMS_CONSENT" that looks indistinguishable from a
 * genuine refusal. Matches the ceiling fetchRecipients uses, so any audience it
 * can produce fits.
 */
const CONSENT_SET_MAX = 100000;

async function getConsentedPhoneSet(eventId) {
  const out = new Set();
  const { data, error } = await supabase
    .from('rsvp_parties')
    .select('guests!inner(phone, is_primary_contact)')
    .eq('event_id', eventId)
    .eq('sms_consent', true)
    .eq('guests.is_primary_contact', true)
    .not('guests.phone', 'is', null)
    .limit(CONSENT_SET_MAX);
  if (error) throw error;
  const rows = data || [];
  if (rows.length >= CONSENT_SET_MAX) {
    // Never degrade quietly: throwing routes into sendRecipient's fail-closed
    // branch, which stops the send instead of mislabelling consenting guests as
    // non-consenting.
    logger.error({ eventId, cap: CONSENT_SET_MAX }, 'SMS consent set hit its row cap — refusing to send on a possibly truncated set.');
    throw new Error('CONSENT_SET_TRUNCATED');
  }
  for (const row of rows) {
    const primary = Array.isArray(row.guests) ? row.guests[0] : row.guests;
    const canonical = canonicalPhone(primary?.phone);
    if (canonical) out.add(canonical);
  }
  return out;
}

/** True only when this number has an affirmative consent record on this event. */
async function hasSmsConsent(eventId, phone) {
  const canonical = canonicalPhone(phone);
  if (!canonical) return false;
  const set = await getConsentedPhoneSet(eventId);
  return set.has(canonical);
}

/* ─── Atomic credit billing (segment-accurate, with single-credit fallback) ─── */

/**
 * When the segment-accurate RPC was last found missing, or 0 if it never was.
 *
 * ── WHY THIS IS A TIMESTAMP AND NOT A BOOLEAN ──
 *
 * It was a plain `let multiCreditUnavailable = false` latched to true on the
 * first PGRST202. Nothing ever reset it, so once tripped the process billed
 * every message — including a three-segment one — as a single credit until
 * somebody restarted the API. Applying the migration did not help; the running
 * process had already decided.
 *
 * That is a revenue leak that hides behind a log line nobody re-reads. Re-probing
 * on a timer costs one failed RPC every few minutes in the un-migrated case, and
 * the moment the migration lands billing corrects itself with no intervention.
 */
let multiCreditMissingAt = 0;
const MULTI_CREDIT_REPROBE_MS = 5 * 60 * 1000;

async function deductCredits(eventId, count, phone, idemKey) {
  const multiCreditUnavailable = multiCreditMissingAt !== 0
    && (Date.now() - multiCreditMissingAt) < MULTI_CREDIT_REPROBE_MS;

  if (!multiCreditUnavailable) {
    const { data, error } = await supabase.rpc('deduct_sms_credits_atomic', {
      p_event_id: eventId, p_count: count, p_phone: phone, p_idempotency_key: idemKey,
    });
    if (error) {
      if (isUndefinedFunction(error)) {
        multiCreditMissingAt = Date.now();
        logger.warn('deduct_sms_credits_atomic missing — falling back to single-credit billing for the next 5 minutes. Apply 20260626000000_sms_multi_credit.sql for per-segment charging.');
      } else {
        return { ok: false, error: error.message || 'DEDUCT_FAILED' };
      }
    } else if (data && data.success) {
      return { ok: true, walletId: data.wallet_id, ledgerId: data.ledger_id, idempotent: !!data.idempotent, credits: count };
    } else {
      return { ok: false, error: (data && data.error) || 'DEDUCT_FAILED' };
    }
  }
  const { data, error } = await supabase.rpc('deduct_sms_credit_atomic', {
    p_event_id: eventId, p_phone: phone, p_idempotency_key: idemKey,
  });
  if (error) return { ok: false, error: error.message || 'DEDUCT_FAILED' };
  if (data && data.success) {
    return { ok: true, walletId: data.wallet_id, ledgerId: data.ledger_id, idempotent: !!data.idempotent, credits: 1 };
  }
  return { ok: false, error: (data && data.error) || 'DEDUCT_FAILED' };
}

async function refundCredits(walletId, eventId, ledgerId, count) {
  try {
    // Re-derived rather than captured: a refund can run minutes after the
    // deduction that created the ledger row, and the probe window may have
    // reopened in between. The multi-credit call is tried first either way and
    // falls through on PGRST202, so being wrong here costs one RPC, never a
    // missed refund.
    const multiCreditUnavailable = multiCreditMissingAt !== 0
      && (Date.now() - multiCreditMissingAt) < MULTI_CREDIT_REPROBE_MS;

    if (!multiCreditUnavailable) {
      const { error } = await supabase.rpc('refund_sms_credits_atomic', {
        p_wallet_id: walletId, p_event_id: eventId, p_ledger_id: ledgerId, p_count: count,
      });
      if (!error || !isUndefinedFunction(error)) {
        if (error) logger.error({ err: error }, 'SMS multi-credit refund failed');
        return;
      }
    }
    await supabase.rpc('refund_sms_credit_atomic', {
      p_wallet_id: walletId, p_event_id: eventId, p_ledger_id: ledgerId,
    });
  } catch (e) {
    logger.error({ err: e }, 'SMS credit refund failed (manual reconciliation may be needed)');
  }
}

/**
 * Send to ONE recipient: atomic debit → send → stamp ledger (refund on failure).
 * Pure & reusable; callers aggregate the returned result.
 * @returns {{kind:'sent'|'failed'|'skipped', credits?:number, ledgerId?:string, sid?:string, error?:string}}
 */
async function sendRecipient({ eventId, phone, body, segments, idemKey, twilio, fromNumber, optedOut = null, consented = null }) {
  const norm = normalizePhone(phone);
  if (!isValidPhone(norm)) return { kind: 'failed', error: 'INVALID_PHONE' };

  const canonicalTarget = canonicalPhone(norm);

  // TCPA / Twilio TFV 30475: no message is created without an affirmative,
  // guest-given consent record. Re-verified HERE, per message, rather than
  // trusting the audience query that produced this recipient — a campaign
  // queued days ago must not send to someone who has since had their consent
  // record removed, and any future caller of sendRecipient inherits the gate
  // automatically. Callers that dispatch in batches pass a preloaded
  // `consented` Set (one query per batch); the per-message lookup is the
  // fallback. Fails CLOSED: a lookup error skips the send rather than
  // permitting it, and the number is never billed.
  try {
    const permitted = consented instanceof Set
      ? (canonicalTarget != null && consented.has(canonicalTarget))
      : await hasSmsConsent(eventId, norm);
    if (!permitted) return { kind: 'skipped', error: 'NO_SMS_CONSENT' };
  } catch (e) {
    logger.error({ err: e, eventId }, 'SMS consent verification failed — send blocked (failing closed).');
    return { kind: 'skipped', error: 'CONSENT_CHECK_FAILED' };
  }

  // TCPA/CTIA: an opted-out number is never messaged, from any path (sync
  // controller, async worker, or any future caller), and never billed. Checked
  // here — the final choke point — so a STOP received after a campaign was
  // queued still suppresses the queued send. Callers that dispatch in batches
  // pass a preloaded `optedOut` Set (one query per batch instead of one per
  // message); the per-message lookup remains the fallback.
  const suppressed = optedOut instanceof Set
    ? (canonicalTarget != null && optedOut.has(canonicalTarget))
    : await isOptedOut(norm);
  if (suppressed) return { kind: 'skipped', error: 'OPTED_OUT' };

  // TRANSPORT GATE — must precede the debit. Without a working carrier there is no
  // message, so charging here bills the organizer for silence: the wallet was
  // debited, the ledger stamped with a fabricated `mock-sid-…`, and the dashboard
  // reported "sent" while no handset ever rang. That is exactly what happens in
  // production whenever SMS_ENABLED is false or a credential is missing, and the
  // failure is invisible precisely because it looks like success.
  //
  // Billing without a transport is now opt-in (SMS_MOCK_BILLING) and used only by
  // the unit suite, which needs to assert the ledger path offline. Everywhere else
  // a missing transport is a skip: nothing sent, nothing charged, reason recorded.
  //
  // `twilio` is the caller-supplied transport — historically a Twilio client, now
  // whatever the active provider hands back. The parameter name is kept so the
  // dozens of existing call sites and tests are untouched by the provider work.
  const provider = resolveProvider();
  if (!twilio && !smsMockBillingEnabled()) {
    logger.error({ eventId, phone: norm, provider: provider.name },
      `SMS transport unavailable — send skipped and NOT billed. Set SMS_ENABLED=true with valid ${provider.name.toUpperCase()} credentials.`);
    return { kind: 'skipped', error: 'SMS_TRANSPORT_DISABLED' };
  }

  const deduct = await deductCredits(eventId, segments, norm, idemKey);
  if (!deduct.ok) return { kind: 'failed', error: deduct.error };
  if (deduct.idempotent) return { kind: 'skipped', ledgerId: deduct.ledgerId };

  if (!twilio) {
    // Reachable only under SMS_MOCK_BILLING (see the transport gate above).
    const mockSid = `mock-sid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await stampSendOutcome({ ledgerId: deduct.ledgerId, sid: mockSid, eventId, segments });
    logger.info(`[MOCK SMS] → ${norm} (${segments} seg): ${body}`);
    return { kind: 'sent', credits: deduct.credits, ledgerId: deduct.ledgerId, sid: mockSid };
  }

  try {
    // The carrier-specific part — the request shape, the encoding flag, what
    // counts as failure — lives in services/smsProviders/<name>.js. Everything
    // here is identical on either: debit, send, stamp, refund on throw.
    //
    // `idemKey` doubles as the provider's client reference: Vonage echoes it on
    // every delivery receipt, which is how a receipt finds its ledger row when a
    // long message was split into several carrier-side ids.
    const sent = await provider.send({ to: norm, body, clientRef: idemKey, transport: twilio, fromNumber });
    await stampSendOutcome({
      ledgerId: deduct.ledgerId, sid: sent.id, eventId, segments,
      // Some carriers report what they actually charged; when they do, it beats
      // our config-based estimate and the admin P&L becomes measured.
      costCents: sent.costCents,
    });
    return { kind: 'sent', credits: deduct.credits, ledgerId: deduct.ledgerId, sid: sent.id };
  } catch (smsErr) {
    await refundCredits(deduct.walletId, eventId, deduct.ledgerId, deduct.credits);
    // Say WHY, in the log, in the carrier's own words.
    //
    // This used to swallow the reason entirely: the row was marked failed, the
    // credits came back, and the only trace of the cause was a column nobody
    // reads. Diagnosing a carrier rejection then meant logging into the carrier's
    // dashboard and correlating by timestamp. The refund is the safe part; the
    // silence was the expensive part.
    logger.error({
      eventId,
      phone: norm,
      provider: provider.name,
      err: smsErr.message,
      from: fromNumber || process.env.VONAGE_FROM || process.env.TWILIO_PHONE_NUMBER || null,
    }, `SMS send REJECTED by ${provider.name} — credits refunded. Carrier said: ${smsErr.message}`);
    return { kind: 'failed', error: smsErr.message || 'SMS_SEND_FAILED' };
  }
}

/**
 * Record everything a successful send leaves behind, beyond the debit itself.
 *
 * Bundled into the write that already had to happen (stamping the Twilio SID onto
 * the ledger row) rather than added to the atomic deduct RPC. The RPC is the one
 * place in this subsystem where a mistake double-charges or over-spends a wallet;
 * changing its signature to carry a reporting field would be risk without reward.
 *
 * Three things are captured:
 *
 *  • cost_cents — what the CARRIER charged us, at the rate in force right now.
 *    Without it, profit can only be estimated by multiplying today's rate by
 *    historic volume, which is wrong the moment an admin changes the rate. This
 *    is the difference between an SMS P&L that is measured and one that is
 *    guessed.
 *  • last_used_at — so "last message sent 2 hours ago" costs no ledger scan.
 *  • organizations.sms_delivered_total — the trust signal the per-send ramp-up
 *    reads, so a genuine organizer's limit lifts itself through ordinary use.
 *
 * Entirely best-effort and never throwing: the message is already sent and the
 * organizer already charged. Losing a reporting field must not turn a delivered
 * message into a failed one — that would refund a message the guest received.
 */
async function stampSendOutcome({ ledgerId, sid, eventId, segments, costCents: reportedCostCents = null }) {
  try {
    // The carrier's own figure wins when it gives one (Vonage returns
    // `message-price` on every send). Falling back to rate x segments is an
    // estimate that goes stale the moment an admin edits the rate, so a measured
    // number is always preferred.
    let costCents = Number.isFinite(reportedCostCents) ? reportedCostCents : null;

    if (costCents == null) {
      try {
        const { getPlatformConfig } = require('../utils/configCache');
        const config = await getPlatformConfig();
        const rate = Number(config?.sms_rate_cents_per_credit);
        if (Number.isFinite(rate)) costCents = rate * (Number(segments) || 0);
      } catch {
        // A config read failure leaves cost unrecorded rather than blocking the
        // send. The row is still identifiable for backfill by its timestamp.
      }
    }

    // The ONE write that must happen per message: the SID has to land on this
    // specific ledger row, so it cannot be batched with anything else.
    const patch = { sms_sid: sid };
    if (costCents != null) patch.cost_cents = costCents;
    await supabase.from('sms_credit_ledger').update(patch).eq('id', ledgerId);
  } catch (err) {
    logger.warn({ err, ledgerId }, 'ledger send-outcome stamp failed (message WAS sent)');
  }

  // Everything else is per-EVENT bookkeeping, not per-message, so it is
  // accumulated and flushed rather than written on every send. See recordUsage.
  recordUsage(eventId);
}

/* ─── Per-event usage bookkeeping, batched ──────────────────────────────────
 *
 * Three things follow every delivered message: the wallet's "last used" stamp,
 * the organization's lifetime delivered counter, and the low-balance check.
 *
 * Done inline, each costs a query — four extra round trips per message, which on
 * a 20,000-recipient campaign is 80,000 queries to maintain a timestamp, a
 * counter and a threshold check. None of those three needs per-message accuracy:
 * "last used" is rendered as "2 hours ago", the counter gates a cap that steps at
 * 200 and 1,000, and the balance warning fires once per depletion.
 *
 * So sends accumulate in memory and flush per event on a short interval. Worst
 * case on a crash is a slightly stale timestamp and a handful of uncounted
 * deliveries — which delays a limit lift, and never mis-gates a send.
 */
const USAGE_FLUSH_MS = 5000;
const pendingUsage = new Map(); // eventId → { delivered, lastAt }
let usageFlushTimer = null;

// event → org is immutable, so caching it removes a lookup per flush entirely.
// Bounded: this process is long-lived and sees every event that ever sends, so an
// unbounded map is a slow leak. Oldest-first eviction is fine — a re-lookup costs
// one query, and active events stay warm by being re-inserted.
const ORG_CACHE_MAX = 500;
const orgIdByEvent = new Map();

function rememberOrgId(eventId, orgId) {
  if (orgIdByEvent.size >= ORG_CACHE_MAX) {
    const oldest = orgIdByEvent.keys().next().value;
    orgIdByEvent.delete(oldest);
  }
  orgIdByEvent.set(eventId, orgId);
}

function recordUsage(eventId) {
  if (!eventId) return;
  const entry = pendingUsage.get(eventId) || { delivered: 0, lastAt: null };
  entry.delivered += 1;
  entry.lastAt = new Date().toISOString();
  pendingUsage.set(eventId, entry);

  if (!usageFlushTimer) {
    usageFlushTimer = setTimeout(() => { usageFlushTimer = null; flushUsage(); }, USAGE_FLUSH_MS);
    // Never hold the process open for bookkeeping.
    if (usageFlushTimer.unref) usageFlushTimer.unref();
  }
}

/** Write the accumulated usage for every event with pending sends. Never throws. */
async function flushUsage() {
  const batch = [...pendingUsage.entries()];
  pendingUsage.clear();

  for (const [eventId, { delivered, lastAt }] of batch) {
    try {
      await supabase.from('sms_credit_wallets').update({ last_used_at: lastAt }).eq('event_id', eventId);
    } catch (err) {
      logger.warn({ err, eventId }, 'wallet last_used_at flush failed');
    }

    try {
      let orgId = orgIdByEvent.get(eventId);
      if (orgId === undefined) {
        const { data: ev } = await supabase.from('events').select('org_id').eq('id', eventId).single();
        orgId = ev?.org_id || null;
        rememberOrgId(eventId, orgId);
      }
      if (orgId) {
        const { error } = await supabase.rpc('increment_sms_delivered', { p_org_id: orgId, p_count: delivered });
        // Pre-migration tolerance, matching the missing-RPC fallbacks elsewhere
        // in this subsystem. A missing counter only means limits lift more slowly.
        if (error && !isUndefinedFunction(error)) {
          logger.warn({ err: error, orgId }, 'sms delivered counter increment failed');
        }
      }
    } catch (err) {
      logger.warn({ err, eventId }, 'sms delivered counter flush threw');
    }

    // Once per flush per event, not once per message.
    checkBalanceHealth(eventId);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * TRANSACTIONAL (LIFECYCLE) SMS
 *
 * The six automated message types — RSVP confirmation, RSVP reminder, event
 * reminder, entry-pass link, decline acknowledgement, organizer report — all
 * dispatch through sendTransactionalSms. Campaigns keep their own path
 * (sendBulkSMSCampaign → sendRecipient) because they are batched, paced and
 * organizer-authored; everything else is one message about one thing.
 *
 * The contract that matters to callers: this function NEVER throws and never
 * silently drops a message. It returns either `{ sent: true }` or
 * `{ sent: false, reason }`, and every reason is a signal to the caller to send
 * the email equivalent instead. A guest must always hear about their own RSVP —
 * whether by text or by mail is a billing and preference question, not a
 * question of whether they get told at all.
 * ═══════════════════════════════════════════════════════════════════════════ */

const { isTypeEnabled, getSmsType } = require('../config/smsMessageTypes');
const { renderSmsBody, normalizeLang } = require('../utils/smsTemplates');
const shortLinks = require('../utils/shortLinks');

/**
 * The context fields that hold a URL, and what each link is FOR.
 *
 * The `kind` is not decoration — it is the idempotency key. Combined with the
 * party id it means re-sending an invitation reuses the code that guest already
 * has, rather than minting a second one at the same destination. A guest who kept
 * the first text and taps it a month later must still land somewhere.
 */
const LINK_FIELDS = [
  ['rsvpUrl', 'rsvp'],
  ['ticketUrl', 'ticket'],
  ['url', 'event'],
  ['dashboardUrl', null], // organizer-facing, one per event — not worth a row
];

/**
 * Replace every long URL in a template context with a short one.
 *
 * Runs the links in parallel: a message carries at most two, and doing them in
 * series would put a second network round trip in front of every send for no
 * reason. `shorten` never throws and never returns empty, so Promise.all is safe
 * here without a settled-wrapper.
 */
async function shortenContextLinks(context, { eventId, partyId }) {
  if (!context || typeof context !== 'object') return context;

  const present = LINK_FIELDS.filter(([field]) => typeof context[field] === 'string' && context[field]);
  if (present.length === 0) return context;

  const shortened = await Promise.all(
    present.map(([field, kind]) => shortLinks.shorten(context[field], {
      eventId,
      // A null kind means "do not deduplicate this one" — pass no party either,
      // so the partial unique index does not treat them as the same link.
      partyId: kind ? partyId : null,
      kind,
    })),
  );

  const out = { ...context };
  present.forEach(([field], i) => { out[field] = shortened[i]; });
  return out;
}


/** Append one attempt (sent, failed OR skipped) to sms_log. Never throws. */
async function logSmsAttempt(row) {
  try {
    const { error } = await supabase.from('sms_log').insert(row);
    // 23505 = another worker logged the same (kind, ref) first. Expected under a
    // race, and the credit idempotency key already prevented a double charge.
    if (error && error.code !== '23505') {
      logger.warn({ err: error, kind: row.kind, ref: row.ref },
        'sms_log write failed (apply 20260818000000_sms_addon.sql)');
    }
  } catch (err) {
    logger.warn({ err, kind: row.kind }, 'sms_log write threw');
  }
}

/**
 * Warn the organizer about a shrinking message balance — while they can still do
 * something about it.
 *
 * The previous behaviour only spoke up at zero, which is precisely too late: by
 * then guests had already stopped receiving texts, and the organizer's first clue
 * was somebody telling them so. This runs after every successful send and fires
 * at two points:
 *
 *   • RUNNING LOW (default 20% left, admin-editable) — the one that matters,
 *     because it arrives with time to act.
 *   • EMPTY — a factual notice that messages have stopped and email has taken
 *     over, so nothing has been lost.
 *
 * Each fires ONCE. Two independent guards make that true: a stamp on the wallet
 * (set before sending, so concurrent sends cannot both pass), and emailService's
 * own email_log (kind, ref) unique index. Belt and braces, because the failure
 * mode here is mailing a customer on every message they send.
 *
 * The low-balance stamps are cleared on top-up, so the next depletion warns
 * again rather than staying silent forever after one alert.
 *
 * Fire-and-forget and never throwing: a courtesy notification must not add a
 * second failure to a path that is already degrading.
 */
function checkBalanceHealth(eventId) {
  if (!eventId) return;
  (async () => {
    try {
      const { data: wallet } = await supabase
        .from('sms_credit_wallets')
        .select('id, credits_purchased, credits_used, credits_remaining, last_used_at, low_balance_notified_at, empty_notified_at')
        .eq('event_id', eventId)
        .maybeSingle();
      if (!wallet) return;

      let config = null;
      try {
        const { getPlatformConfig } = require('../utils/configCache');
        config = await getPlatformConfig();
      } catch { /* defaults are fine for a threshold */ }

      const { summarizeBalance } = require('../utils/smsUsage');
      const state = summarizeBalance(wallet, config?.sms_pricing_config);

      const stage = state.isEmpty ? 'empty' : (state.isLow ? 'low' : null);
      if (!stage) return;
      if (stage === 'empty' && wallet.empty_notified_at) return;
      if (stage === 'low' && wallet.low_balance_notified_at) return;

      // Claim the notification BEFORE sending. Two sends completing at the same
      // moment would otherwise both read a null stamp and both mail the customer.
      const stampCol = stage === 'empty' ? 'empty_notified_at' : 'low_balance_notified_at';
      const { data: claimed } = await supabase
        .from('sms_credit_wallets')
        .update({ [stampCol]: new Date().toISOString() })
        .eq('id', wallet.id)
        .is(stampCol, null)
        .select('id');
      if (!claimed || claimed.length === 0) return; // another send won the race

      // Give the claim back if the alert does not actually go out.
      //
      // Claiming BEFORE sending is what stops two concurrent sends from both
      // mailing the customer — but on its own it also means a single delivery
      // failure silences the warning forever, and the whole point of this alert
      // is that it arrives while the organizer can still act. Releasing on
      // failure lets the next flush try again.
      //
      // Safe to retry because emailService.dispatch is itself deduplicated on
      // (kind, ref) via a UNIQUE index on email_log: an alert that DID reach the
      // customer can never be sent twice, no matter how many times this retries.
      // Two independent guards, each covering the other's failure mode.
      const releaseClaim = async () => {
        try {
          await supabase.from('sms_credit_wallets')
            .update({ [stampCol]: null }).eq('id', wallet.id);
        } catch (e) {
          logger.warn({ err: e, eventId, stage }, 'could not release the SMS alert claim — this alert will not retry');
        }
      };

      const { data: ev } = await supabase
        .from('events').select('title, organizations(name, email)').eq('id', eventId).single();
      const org = Array.isArray(ev?.organizations) ? ev.organizations[0] : ev?.organizations;
      if (!org?.email) {
        // No address to write to. Not a failure to retry — but not a delivered
        // alert either, so the claim is released in case one is added later.
        await releaseClaim();
        return;
      }

      const title = ev?.title || 'your event';
      const name = org.name || 'there';
      const { dispatch } = require('./emailService');

      // Deliberately plain: the reader is planning an event, not administering a
      // messaging platform. No "allowance", no "credits", no percentages of a
      // quota — just how many are left and what happens next.
      const html = stage === 'empty'
        ? `<p>Hi ${name},</p>
           <p>You've used all the text messages for <strong>${title}</strong>.</p>
           <p>Your guests are still hearing from you — confirmations and reminders have
           automatically switched back to email, so nothing has been missed. To start
           texting again, add more messages from your event's Messages page.</p>
           <p>— Fancy RSVP</p>`
        : `<p>Hi ${name},</p>
           <p>You have <strong>${state.remaining} text messages left</strong> for
           <strong>${title}</strong> — about ${state.percentRemaining}% of what you bought.</p>
           <p>You may want to add more before they run out. If they do, your guests will keep
           getting everything by email instead, so nothing will be missed either way.</p>
           <p>— Fancy RSVP</p>`;

      let result;
      try {
        result = await dispatch({
          kind: stage === 'empty' ? 'sms_messages_empty' : 'sms_messages_low',
          ref: `event:${eventId}`,
          to: org.email,
          subject: stage === 'empty'
            ? `You've used all your text messages for ${title}`
            : `${state.remaining} text messages left for ${title}`,
          html,
          eventId,
        });
      } catch (sendErr) {
        await releaseClaim();
        logger.warn({ err: sendErr, eventId, stage }, 'SMS balance alert threw — will retry on the next flush');
        return;
      }

      // Exactly one non-send counts as success: `skipped: 'duplicate'` means
      // email_log already holds this alert, so it reached the customer on an
      // earlier attempt. Everything else — a false `sent`, or 'no_recipient' —
      // is a genuine non-delivery and releases the claim so the next flush
      // retries. Treating any skip as success would silence the alert on the one
      // path where it was never actually delivered.
      const delivered = result?.sent === true || result?.skipped === 'duplicate';
      if (!delivered) {
        await releaseClaim();
        logger.warn({ eventId, stage, skipped: result?.skipped },
          'SMS balance alert not delivered — will retry on the next flush');
      }
    } catch (err) {
      logger.warn({ err, eventId }, 'SMS balance alert failed (non-fatal)');
    }
  })();
}

/** Has this exact (kind, ref) already been attempted? Mirrors emailService.alreadyLogged. */
async function alreadySent(kind, ref) {
  if (!ref) return false;
  try {
    const { data, error } = await supabase
      .from('sms_log').select('id').eq('kind', kind).eq('ref', ref).eq('status', 'sent').limit(1);
    if (error) return false; // table missing → let the send proceed; billing is still idempotent
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/**
 * Resolve who this message goes to, and whether they have consented.
 *
 * The two audiences are NOT interchangeable and are deliberately resolved by
 * different queries against different consent records:
 *
 *   guest     → the party's primary contact, gated on rsvp_parties.sms_consent.
 *               TCPA express consent. No payment or plan substitutes for it.
 *   organizer → organizations.sms_phone, gated on organizations.sms_consent.
 *               A different relationship — they are the customer and gave us the
 *               number — but still an opt-in they had to make.
 */
async function resolveRecipient({ audience, eventId, partyId }) {
  if (audience === 'organizer') {
    const { data, error } = await supabase
      .from('events')
      .select('organizations(sms_phone, sms_consent)')
      .eq('id', eventId)
      .single();
    if (error || !data) return { phone: null, consented: false };
    const org = Array.isArray(data.organizations) ? data.organizations[0] : data.organizations;
    return { phone: org?.sms_phone || null, consented: !!org?.sms_consent };
  }

  if (!partyId) return { phone: null, consented: false };
  const { data, error } = await supabase
    .from('rsvp_parties')
    .select('sms_consent, guests(phone, is_primary_contact)')
    .eq('id', partyId)
    .single();
  if (error || !data) return { phone: null, consented: false };

  const guests = Array.isArray(data.guests) ? data.guests : [data.guests].filter(Boolean);
  const primary = guests.find((g) => g && g.is_primary_contact) || null;
  return { phone: primary?.phone || null, consented: !!data.sms_consent };
}

/**
 * Send one lifecycle SMS.
 *
 * @param {object} o
 * @param {string} o.type      key from config/smsMessageTypes.js
 * @param {string} o.eventId
 * @param {string} [o.partyId] required for guest-audience types
 * @param {string} o.ref       idempotency ref, e.g. `rsvp:<partyId>` / `event:<id>`
 * @param {object} [o.event]   preloaded event row (avoids a query in loops); must
 *                             carry sms_addon_purchased_at + sms_settings
 * @param {string} [o.lang]
 * @param {object} [o.context] values for the template
 * @returns {Promise<{sent:boolean, reason?:string, sid?:string, credits?:number}>}
 */
async function sendTransactionalSms({ type, eventId, partyId = null, ref, event = null, lang = 'en', context = {} }) {
  const typeDef = getSmsType(type);
  if (!typeDef) {
    logger.error({ type }, 'sendTransactionalSms called with an unknown message type');
    return { sent: false, reason: 'UNKNOWN_TYPE' };
  }

  const base = { kind: type, ref: ref || null, event_id: eventId || null, party_id: partyId, credits: 0 };
  const skip = async (reason, extra = {}) => {
    await logSmsAttempt({ ...base, ...extra, status: 'skipped', skip_reason: reason });
    return { sent: false, reason };
  };

  try {
    // ① Entitlement. Loaded here unless the caller already has the row (schedulers
    //    iterate hundreds of parties per event and must not re-query per guest).
    let ev = event;
    if (!ev) {
      const { data, error } = await supabase
        .from('events').select('id, sms_addon_purchased_at, sms_settings, sms_templates').eq('id', eventId).single();
      if (error || !data) return skip('EVENT_NOT_FOUND');
      ev = data;
    }
    if (!ev.sms_addon_purchased_at) return skip('ADDON_INACTIVE');

    // ② The organizer's own switch for this message type.
    if (!isTypeEnabled(ev.sms_settings, type)) return skip('TYPE_DISABLED');

    // ③ Idempotency. The scheduler re-runs every few minutes over the same rows;
    //    without this a guest gets the same reminder on every tick — and pays for
    //    it out of the organizer's allowance each time.
    if (await alreadySent(type, ref)) return skip('DUPLICATE');

    // ④ Recipient + consent.
    const { phone, consented } = await resolveRecipient({ audience: typeDef.audience, eventId, partyId });
    if (!phone) return skip('NO_PHONE');
    if (!consented) return skip('NO_CONSENT', { recipient: phone });

    // ⑤ Global suppression. A STOP reply outranks every consent record and every
    //    organizer setting, on every event.
    if (await isOptedOut(phone)) return skip('OPTED_OUT', { recipient: phone });

    // ⑥ Shorten every link in the context, THEN render, THEN measure.
    //
    //    Order matters and the reason is money. A GSM-7 segment holds 160
    //    characters, the compliance footer claims 78, and the raw RSVP URL is
    //    another 89 — so an unshortened message is two segments before the
    //    guest's name and four in Arabic. Shortening first is the difference
    //    between billing three segments and billing four on every Arabic event.
    //
    //    Never fatal: shorten() returns the original URL on any failure, so a
    //    short-link outage makes messages more expensive, never undelivered.
    const linkedContext = await shortenContextLinks(context, { eventId, partyId });

    /**
     * The organizer's own wording for this type and language, when they have
     * written one. Read off the event row already loaded above, so a scheduler
     * walking 2,000 parties does not pay a query per guest for it.
     *
     * ── THE MIGRATION IS NOT OPTIONAL, AND THIS LINE DOES NOT SAVE YOU ──
     *
     * An earlier version of this comment claimed the optional chain made an
     * un-migrated deployment degrade gracefully. It does not, and the mistake is
     * worth naming because it points the wrong way in an emergency: step ① above
     * selects `sms_templates` BY NAME, and PostgREST fails the ENTIRE query when
     * one selected column does not exist. Execution never arrives here — the
     * select 400s, the row reads as missing, and every message on the platform
     * skips with EVENT_NOT_FOUND.
     *
     * `20260901000000_sms_templates_and_event_purge.sql` must be applied BEFORE
     * this code is deployed. See the postgrest-select-column-blast-radius note.
     *
     * What the optional chain DOES protect is the other case, which is real: a
     * caller that hands in a preloaded `event` row from a select of its own that
     * omits the column. There the value is genuinely undefined, and falling
     * through to our built-in copy is the right answer rather than an empty
     * message.
     */
    const override = ev.sms_templates?.[type]?.[normalizeLang(lang)] || null;

    const rendered = renderSmsBody(type, normalizeLang(lang), linkedContext, { override });
    if (!rendered) return skip('NO_BODY');
    const body = `${rendered}${COMPLIANCE_FOOTER}`;
    const { segments } = computeSmsSegments(body);

    // ⑦ Dispatch through the SAME primitive campaigns use, so the transport gate,
    //    atomic debit, idempotent ledger and automatic refund-on-failure all apply
    //    identically. The idempotency key is derived from (type, ref) so a retry at
    //    any layer — scheduler, webhook, manual re-run — cannot charge twice.
    //
    //    `consented` is passed EXPLICITLY rather than letting sendRecipient run its
    //    own lookup, because that lookup answers a guest-only question: "is this
    //    number in this event's consented-GUEST set?" For an organizer message the
    //    answer is always no — their number is not a guest's — so the report would
    //    be blocked as NO_SMS_CONSENT despite the organizer having opted in. Step ④
    //    above has already verified the right consent record for this audience, so
    //    the verified number is handed down as the permitted set. Guest messages
    //    reach the same conclusion through the same gate, one step earlier.
    const verified = new Set([canonicalPhone(phone)].filter(Boolean));

    const result = await sendRecipient({
      eventId,
      phone,
      body,
      segments,
      idemKey: `smstx:${type}:${ref || partyId || eventId}`,
      // Whatever the active carrier hands back. Null when unconfigured, which
      // sendRecipient's transport gate turns into a skip rather than a charge.
      twilio: resolveProvider().getTransport(),
      fromNumber: null,
      consented: verified,
    });

    if (result.kind === 'sent') {
      await logSmsAttempt({
        ...base, recipient: phone, segments, credits: result.credits || 0,
        ledger_id: result.ledgerId || null, sms_sid: result.sid || null, status: 'sent',
      });
      return { sent: true, sid: result.sid, credits: result.credits };
    }

    if (result.kind === 'skipped') {
      // sendRecipient's own vocabulary is already the reason we want to surface —
      // NO_SMS_CONSENT, OPTED_OUT, SMS_TRANSPORT_DISABLED. Normalize the one that
      // means "no allowance left" so callers can treat billing distinctly.
      return skip(result.error || 'SKIPPED', { recipient: phone, segments });
    }

    // A deduction failure IS the out-of-allowance case; everything else is a
    // genuine delivery failure. Both fall back to email.
    const outOfCredit = /INSUFFICIENT_CREDITS|NO_WALLET/i.test(String(result.error || ''));
    await logSmsAttempt({
      ...base, recipient: phone, segments, status: 'failed',
      skip_reason: outOfCredit ? 'NO_ALLOWANCE' : null,
      error: String(result.error || 'FAILED').slice(0, 300),
    });
    if (outOfCredit) checkBalanceHealth(eventId);
    return { sent: false, reason: outOfCredit ? 'NO_ALLOWANCE' : 'SEND_FAILED' };
  } catch (err) {
    // Never let a lifecycle SMS failure break the thing that triggered it — an
    // RSVP submission, or a scheduler tick covering hundreds of other guests.
    logger.error({ err, type, eventId, partyId }, 'sendTransactionalSms threw — falling back to email');
    return { sent: false, reason: 'ERROR' };
  }
}

/**
 * logSmsAttempt / alreadySent / resolveRecipient are deliberately NOT exported:
 * they are internals of sendTransactionalSms, and exporting them invites a caller
 * to log a send or resolve a recipient while bypassing the gate chain that makes
 * either safe.
 *
 * `sendRecipient` joined them in the four-type rebuild, and that is the single
 * most important line in this block. It was exported so free-text campaigns could
 * reach the carrier directly — which meant the entitlement check, the per-type
 * switch and the (kind, ref) idempotency guard were all optional, enforced for
 * one caller by route middleware and for the other by the function itself. With
 * campaigns gone there is exactly one door, and closing this export is what keeps
 * it that way: a future caller who wants to send has to go through
 * sendTransactionalSms, and therefore through every gate.
 */
module.exports = {
  sendTransactionalSms,
  // Exported for the batching test only — nothing in the application calls it.
  // The flush is timer-driven, and a test cannot wait 5 seconds per assertion.
  __flushUsageForTests: flushUsage,
  /**
   * The one-recipient send primitive, for tests ONLY.
   *
   * Named with the __ prefix rather than exported plainly, and the distinction is
   * the point. This used to be a public export so free-text campaigns could reach
   * the carrier directly, which meant the entitlement, per-type and idempotency
   * gates were optional — enforced for one caller by route middleware and for the
   * other by sendTransactionalSms itself.
   *
   * Application code must go through sendTransactionalSms and therefore through
   * every gate. Tests that exercise BILLING specifically (the transport gate, the
   * usage batching, the low-balance alert) need to reach the debit path without
   * standing up an event, a party and a consent record for each assertion — so
   * they get this, under a name no reviewer will mistake for an API.
   */
  __sendRecipientForTests: sendRecipient,
  BRANDING,
  COMPLIANCE_FOOTER,
  HELP_REPLY,
  canonicalPhone,
  getOptedOutSet,
  isOptedOut,
  getConsentedPhoneSet,
  hasSmsConsent,
  chunk,
  normalizePhone,
  isValidPhone,
  deductCredits,
  refundCredits,
};
