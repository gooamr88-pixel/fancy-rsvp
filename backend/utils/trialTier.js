/**
 * THE TRIAL, AS A PLAN.
 *
 * A free trial is not a parallel entitlement system here. It is a tier in
 * `super_admin_config.pricing_tiers` carrying `is_trial: true`, edited on the
 * same admin screen as every other plan, resolved by the same `resolveTier`,
 * snapshotted onto the event by the same `tierSnapshot`, and read by the same
 * `entitledFeatures`. What a trial includes is therefore a configuration
 * decision, not a hardcoded list somebody has to remember to keep in step with
 * the pricing page.
 *
 * This module answers three questions and nothing else:
 *
 *   which plan IS the trial          trialTier()
 *   where does a trial LAND          fallbackTier()
 *   is this event's trial OVER       isTrialExpired()
 *
 * ── WHY THE LANDING PLAN IS REQUIRED, NOT OPTIONAL ────────────────────────
 *
 * On the eighth day the event stays live and drops to the free plan. That is
 * the product decision, and it is the right one: the guests of a wedding never
 * agreed to anything, and a link that dies because a host's trial lapsed is a
 * failure they will blame on us rather than on them. Nothing is deleted;
 * features lock and the invitation keeps working.
 *
 * Which means a trial can only be GRANTED if there is somewhere free to land.
 * `fallbackTier` returns null when the cheapest sellable plan still costs
 * money, and the grant refuses outright rather than discovering the problem
 * seven days later with an event it cannot safely downgrade. Fail closed at
 * the moment of the promise, not at the moment of the reckoning.
 */

/**
 * FEATURES A TRIAL NEVER GRANTS, whatever an admin has ticked.
 *
 * `white_label` strips every trace of Fancy from the one surface every guest
 * sees — the invitation, and every email the event sends — and replaces it
 * with the host's own name. That is a thing to sell, not a thing to hand to
 * somebody who has not paid, for two reasons that point the same way:
 *
 *   IT IS THE MOST EXPENSIVE FEATURE ON THE PRICE LIST. A trial should
 *   demonstrate the product, not include the top tier's headline item; a
 *   visitor who gets it free for a week has been shown that the plan carrying
 *   it is optional.
 *
 *   AND A TRIAL EVENT IS A MARKETING SURFACE. Every guest who opens a trial
 *   invitation is somebody discovering the product through a friend's wedding,
 *   which is the cheapest acquisition this business has. White-labelling the
 *   trial spends that for nothing.
 *
 * Enforced in three places on purpose, because there are three ways in:
 *   1. `updatePricingConfig` strips it on save, so the stored trial plan
 *      cannot hold it and `syncBrandingSnapshots` can never push it out;
 *   2. `trialTier()` sanitises what it returns, so a grant cannot write it;
 *   3. `entitledFeatures` sanitises a resolved trial tier, so config that
 *      predates this rule — or was written straight to the database — still
 *      does not grant it at request time.
 *
 * `remove_watermark` is deliberately NOT here. It is the smaller, separate
 * switch (one line on the invitation rather than the whole identity), and
 * whether a trial keeps the Fancy mark on is a pricing decision an admin is
 * entitled to make either way.
 */
const TRIAL_EXCLUDED_FEATURES = ['white_label'];

/** A tier the admin has marked as the trial. Never sold, never counted. */
function isTrialTier(tier) {
  return !!(tier && tier.is_trial === true);
}

/**
 * The same tier with the excluded features removed.
 *
 * Returns the tier UNCHANGED when it is not a trial, and when nothing needed
 * removing — so callers can apply it unconditionally without churning object
 * identities that other code compares.
 */
function sanitizeTrialTier(tier) {
  if (!isTrialTier(tier) || !Array.isArray(tier.features)) return tier;
  const kept = tier.features.filter((k) => !TRIAL_EXCLUDED_FEATURES.includes(k));
  if (kept.length === tier.features.length) return tier;
  return { ...tier, features: kept };
}

/**
 * The trial plan, or null if none is configured.
 *
 * First match wins. Two trial tiers is a configuration mistake rather than a
 * meaningful state, and picking the first is stable across saves (the admin
 * form preserves order) where picking "the best" would not be.
 */
function trialTier(tiers) {
  const found = (Array.isArray(tiers) ? tiers : []).find(isTrialTier) || null;
  // Sanitised on the way out, so no caller has to remember to do it.
  return found ? sanitizeTrialTier(found) : null;
}

/** How many days the configured trial runs for. Clamped; 7 when unset. */
function trialDays(tier) {
  const n = Number(tier?.trial_days);
  if (!Number.isFinite(n)) return 7;
  return Math.min(90, Math.max(1, Math.round(n)));
}

/**
 * Where an expired trial lands: the cheapest plan that is free, sellable and
 * not the trial itself.
 *
 * `is_custom` tiers are excluded because both purchase paths already reject
 * them — they are "contact sales", not a plan an event can hold. The trial
 * itself is excluded for the obvious reason.
 *
 * Returns null when every remaining plan costs money. See the header: that is
 * a refusal to start a trial, not a licence to improvise one.
 */
function fallbackTier(tiers) {
  const candidates = (Array.isArray(tiers) ? tiers : [])
    .filter((t) => t && !isTrialTier(t) && t.is_custom !== true)
    .sort((a, b) => (Number(a.price_cents) || 0) - (Number(b.price_cents) || 0));

  const cheapest = candidates[0];
  if (!cheapest) return null;
  return (Number(cheapest.price_cents) || 0) <= 0 ? cheapest : null;
}

/**
 * Is this event's trial over?
 *
 * Read straight off the event's own persisted deadline, never recomputed from
 * a start date and a duration. The duration is admin-editable: shortening the
 * trial from 14 days to 7 must not retroactively end a trial somebody is in
 * the middle of, and lengthening it must not silently extend one. The deadline
 * is a promise made at grant time and stored.
 *
 * `undefined` — which is what a database missing the column returns through
 * `selectEventWithTier`'s ladder — is NOT expired. An unapplied migration then
 * degrades to exactly today's behaviour instead of revoking every paid feature
 * on the platform. See the ladder note in tierResolver.js.
 */
function isTrialExpired(event, now = Date.now()) {
  const ends = event?.trial_ends_at;
  if (!ends) return false;
  const at = new Date(ends).getTime();
  return Number.isFinite(at) && at <= now;
}

module.exports = {
  TRIAL_EXCLUDED_FEATURES,
  sanitizeTrialTier,
  isTrialTier,
  trialTier,
  trialDays,
  fallbackTier,
  isTrialExpired,
};
