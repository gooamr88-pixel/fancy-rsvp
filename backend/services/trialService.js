/**
 * STARTING AND ENDING A FREE TRIAL.
 *
 * Two operations, one file, because they are two halves of one promise and
 * they have to agree about what a trial is. The grant writes a deadline; the
 * landing rewrites the plan when that deadline has passed. Nothing else in the
 * codebase needs to know a trial exists — every gate goes through
 * `entitledFeatures`, which reads the deadline itself.
 *
 * ── THE ONE LINE THAT KEEPS THIS FREE ─────────────────────────────────────
 *
 *     manual_override: false
 *
 * It is not decoration and it must never be flipped. `smsAddonGate` and
 * `checkinAppGate` both short-circuit on that flag BEFORE consulting the plan
 * (smsAddonGate.js:93, checkinAppGate.js:88) — it is the support-comp switch,
 * and it means "this event has full access, stop asking". Setting it on a
 * trial would hand every trial account the one genuinely metered thing on the
 * platform: text messages, at roughly 2.2¢ each of real carrier cost, sendable
 * to anyone.
 *
 * `featureGate` needs only `is_paid` to consult the tier at all
 * (featureGate.js:75), so `is_paid: true` alone buys everything the trial is
 * meant to include, and `sms_campaigns` in the trial tier's features makes the
 * messaging screens VISIBLE while `smsAddonGate` still answers 402
 * SMS_ADDON_REQUIRED, because `sms_addon_purchased_at` is unset. The organizer
 * sees the feature, understands it, and buys credits to use it. That is the
 * intended shape, and it costs us nothing.
 *
 * ── WHY THE EVENT GOES STRAIGHT TO `active` ───────────────────────────────
 *
 * A card payment parks an event at `pending_review` for a super admin to
 * promote. A trial cannot: nobody is going to review a signup within seconds
 * of it happening, and a trial that begins with an unexplained wait is not a
 * trial. Promo-code redemption already sets `status: 'active'` directly
 * (promoCodeService.js:141) for exactly this reason; this follows it.
 */

const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const { getPlatformConfig } = require('../utils/configCache');
const { tierSnapshot } = require('../utils/tierResolver');
const { trialTier, trialDays, fallbackTier } = require('../utils/trialTier');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Is the platform configured to offer trials at all?
 *
 * BOTH plans are required, and the landing plan is the reason. The promise is
 * that an expired trial keeps its invitation live on the free plan; without a
 * free plan there is nowhere safe to land, and the only alternatives are
 * taking a live event offline or leaving a trial running forever. Refusing to
 * START is the honest failure — it happens before anyone has been promised
 * anything, rather than seven days later with real guests on the other side.
 *
 * @returns {{ ok: true, tier, landing, days } | { ok: false, error }}
 */
function resolveTrialPlans(pricingTiers) {
  const tier = trialTier(pricingTiers);
  if (!tier) return { ok: false, error: 'TRIAL_NOT_CONFIGURED' };

  const landing = fallbackTier(pricingTiers);
  if (!landing) return { ok: false, error: 'NO_FREE_PLAN' };

  return { ok: true, tier, landing, days: trialDays(tier) };
}

/**
 * The columns a trial grant or landing writes, given a plan.
 *
 * Built on `tierSnapshot` — the single writer of all seven `tier_*` columns —
 * with two deliberate overrides:
 *
 *   tier_price_cents: 0
 *     The upgrade path credits what an event previously paid
 *     (paymentController.js:439 charges `newPrice - previousPaidCents`, and
 *     falls back to this very column when the old plan is gone). A trial that
 *     reported the trial plan's list price would let somebody "upgrade" for
 *     the difference from money they never spent. Nobody paid; the credit is
 *     zero.
 *
 *   tier_max_guests: never null
 *     The guest cap is a database trigger, and it reads NULL — and 0 — as
 *     UNLIMITED (005_update_guest_cap_logic.sql:36). A trial plan saved with
 *     no cap would therefore be an uncapped free event, which is the one thing
 *     the guest limit exists to prevent. Falls back to a hard 25 rather than
 *     trusting the config to have been filled in.
 */
function planColumns(tier, { capFallback = 25 } = {}) {
  const snapshot = tierSnapshot(tier);
  const configured = Number(snapshot.tier_max_guests);
  return {
    ...snapshot,
    tier_price_cents: 0,
    tier_max_guests: Number.isFinite(configured) && configured > 0 ? configured : capFallback,
    /* NEVER white-labelled. `trialTier()` already sanitises the plan, so
       `tierSnapshot` derives false here anyway — this is the belt, because the
       column is what the GUEST PAGE reads and a trial invitation with no Fancy
       mark on it is seven days of our best acquisition channel switched off.
       Written explicitly so the guarantee is visible in the row that carries
       it, not only in the function that produced it. */
    tier_white_label: false,
  };
}

/**
 * Start the account's one free trial on this event.
 *
 * Never throws for a refusal — returns { ok: false, error, message } so the
 * caller can show it inline, the same contract redeemPromoCodeForEvent uses.
 */
async function startTrial({ eventId, orgId, actorId }) {
  let config;
  try {
    config = await getPlatformConfig();
  } catch (err) {
    logger.error({ err, eventId }, '[trial] could not load pricing config');
    return { ok: false, error: 'CONFIG_ERROR', message: 'Could not start your trial right now. Please try again.' };
  }

  const plans = resolveTrialPlans(config.pricing_tiers);
  if (!plans.ok) {
    logger.error({ eventId, reason: plans.error }, '[trial] refused — platform not configured for trials');
    return {
      ok: false,
      error: plans.error,
      message: 'Free trials are not available at the moment. Please choose a plan, or contact us.',
    };
  }

  /* ── The account ──────────────────────────────────────────────────────
     One trial per organization, recorded on the organization. Checked
     before the event so somebody who has already had a trial is told that
     rather than being told something about this particular event. */
  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('id, email, name, status, email_verified, trial_event_id')
    .eq('id', orgId)
    .single();

  if (orgError || !org) {
    return { ok: false, error: 'ORG_NOT_FOUND', message: 'We could not find your account.' };
  }
  if (org.status && org.status !== 'active') {
    return { ok: false, error: 'ORG_NOT_ACTIVE', message: 'This account cannot start a trial. Please contact support.' };
  }
  /* Verified email only. The trial publishes a real, publicly reachable event
     and sends real mail from our domain; the OTP is the only evidence we have
     that a person is behind the account. Google sign-ups arrive verified. */
  if (org.email_verified === false) {
    return { ok: false, error: 'EMAIL_NOT_VERIFIED', message: 'Please confirm your email address first.' };
  }
  if (org.trial_event_id) {
    return {
      ok: false,
      error: 'TRIAL_ALREADY_USED',
      message: org.trial_event_id === eventId
        ? 'This event is already on your free trial.'
        : 'Your free trial has already been used on another event. Choose a plan to publish this one.',
    };
  }

  /* ── The event ────────────────────────────────────────────────────────
     Ownership is verified by the route's `verifyEventOwner`; this checks the
     event is in a state a trial can be applied to. */
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, org_id, title, slug, status, is_paid')
    .eq('id', eventId)
    .single();

  if (eventError || !event) {
    return { ok: false, error: 'EVENT_NOT_FOUND', message: 'Event not found.' };
  }
  if (event.is_paid) {
    return { ok: false, error: 'ALREADY_PAID', message: 'This event is already published.' };
  }
  if (event.status !== 'draft') {
    return { ok: false, error: 'EVENT_NOT_DRAFT', message: 'Only a draft event can start a trial.' };
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + plans.days * DAY_MS);

  const updates = {
    is_paid: true,
    status: 'active',
    // NEVER true. See the header — this is the SMS firewall.
    manual_override: false,
    ...planColumns(plans.tier),
    trial_started_at: now.toISOString(),
    trial_ends_at: endsAt.toISOString(),
    trial_expired_at: null,
    trial_warned_at: null,
    comp_reason: `Free trial (${plans.days} days)`,
    updated_at: now.toISOString(),
  };

  /* ── CLAIM THE ACCOUNT'S TRIAL FIRST, THEN SPEND IT ────────────────────
     The org stamp used to come second, reasoning that a failed event update
     should not burn somebody's one trial. That ordering had a race: the
     `trial_event_id IS NULL` check earlier is a READ, so two tabs on two
     different drafts both pass it, both activate their own event, and only
     one stamp lands. One account, two live trial events, and nothing logged
     as an error on the winning path.

     Claiming first closes it, because the claim is a CONDITIONAL WRITE —
     `.is('trial_event_id', null)` is evaluated by the database, so exactly one
     of the two racers gets a row back. The original worry is then handled by
     an explicit rollback rather than by ordering. */
  const { data: claimed, error: claimError } = await supabase
    .from('organizations')
    .update({
      trial_event_id: eventId,
      trial_started_at: updates.trial_started_at,
      trial_ends_at: updates.trial_ends_at,
      updated_at: now.toISOString(),
    })
    .eq('id', orgId)
    .is('trial_event_id', null)
    .select('id')
    .maybeSingle();

  if (claimError) {
    logger.error({ err: claimError, orgId, eventId }, '[trial] could not claim the account trial');
    return { ok: false, error: 'ACTIVATION_FAILED', message: 'Could not start your trial. Please try again.' };
  }
  if (!claimed) {
    // Somebody else took it between the read above and this write.
    return {
      ok: false,
      error: 'TRIAL_ALREADY_USED',
      message: 'Your free trial has already been used. Choose a plan to publish this event.',
    };
  }

  /* Optimistic lock on `is_paid` as well: an event that became paid between
     the check above and here must not be quietly rewritten onto a trial. */
  const { data: updated, error: updateError } = await supabase
    .from('events')
    .update(updates)
    .eq('id', eventId)
    .eq('is_paid', false)
    .select('id, title, slug, status, is_paid, tier_name, tier_key, tier_max_guests, trial_ends_at')
    .single();

  if (updateError || !updated) {
    /* GIVE THE TRIAL BACK. The claim landed and the event did not, so without
       this the account has spent its one trial on an event that never started
       one — the exact outcome the old ordering was trying to avoid, now
       handled explicitly instead of by hoping the second write succeeds.
       Conditional on still pointing at THIS event, so a concurrent successful
       claim for another event is never released. */
    logger.error({ err: updateError, eventId, orgId }, '[trial] activation failed — releasing the account claim');
    await supabase
      .from('organizations')
      .update({ trial_event_id: null, trial_started_at: null, trial_ends_at: null })
      .eq('id', orgId)
      .eq('trial_event_id', eventId);

    return { ok: false, error: 'ACTIVATION_FAILED', message: 'Could not start your trial. Please try again.' };
  }

  const { error: logError } = await supabase.from('activity_logs').insert({
    event_id: eventId,
    actor_id: actorId || null,
    action: 'event_trial_started',
    entity_type: 'event',
    entity_id: eventId,
    metadata: { tier_name: updates.tier_name, tier_key: updates.tier_key, days: plans.days, ends_at: updates.trial_ends_at },
  });
  if (logError) logger.warn({ err: logError, eventId }, '[trial] activity_logs insert failed (non-fatal)');

  return { ok: true, event: updated, endsAt: updates.trial_ends_at, days: plans.days };
}

/**
 * Land one expired trial on the free plan.
 *
 * `is_paid` and `status` are deliberately absent from the update. The event
 * stays live; only the plan changes. A guest who was invited to a wedding did
 * not agree to anything and must not find a dead link because the host's trial
 * lapsed — and the host would be told about it by their guests, which is the
 * worst possible way to learn.
 *
 * Nothing is deleted. The seating chart, the guest list and the answers all
 * remain; the features that edit them lock, and paying unlocks them again
 * exactly as they were.
 */
async function landExpiredTrial(event, landing) {
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('events')
    .update({
      ...planColumns(landing),
      trial_expired_at: now,
      updated_at: now,
    })
    .eq('id', event.id)
    .is('trial_expired_at', null);

  if (error) {
    logger.error({ err: error, eventId: event.id }, '[trial] could not land an expired trial');
    return { ok: false };
  }
  return { ok: true };
}

module.exports = {
  startTrial,
  landExpiredTrial,
  resolveTrialPlans,
  planColumns,
};
