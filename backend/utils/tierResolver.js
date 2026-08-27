/**
 * WHICH PLAN IS THIS? — the single answer.
 *
 * ── The bug this file exists to end ────────────────────────────────────────
 *
 * A pricing tier used to have no identity at all. Tiers live as a JSON array in
 * `super_admin_config.pricing_tiers`, an event's only link to the one it bought
 * was `events.tier_name TEXT`, and eleven separate call sites re-derived the
 * plan with their own copy of
 *
 *     tiers.find(t => t.name.toLowerCase() === event.tier_name.toLowerCase())
 *
 * So the DISPLAY NAME was the primary key, and renaming a plan in the admin UI
 * was indistinguishable from deleting it and creating another one. Rename
 * "Enterprise" and every event that had bought it lost every paid feature
 * instantly (featureGate found no tier and granted nothing), upgrades started
 * charging the new plan's FULL price instead of the difference, the upgrade
 * button vanished, and promo codes for it silently began granting UNLIMITED
 * guests. Nothing warned, nothing logged, nothing migrated.
 *
 * ── The two things that fix it ─────────────────────────────────────────────
 *
 *   1. `key` — a stable identity generated ONCE and never re-derived from the
 *      name, so a rename is a rename. Callers resolve by key; the name is for
 *      display only.
 *
 *   2. A FEATURE SNAPSHOT on the event. Even a perfect key cannot survive a
 *      tier being deleted outright, and what a customer paid for must not
 *      depend on the admin never touching the config again. `events.tier_features`
 *      is written at purchase exactly as `tier_max_guests` already was, and is
 *      what entitlement falls back to when the tier is gone.
 *
 * ── Resolution order, and why ──────────────────────────────────────────────
 *
 *   key → name → nothing.
 *
 * The name fallback is not belt-and-braces, it is REQUIRED: every event sold
 * before this change has a name and no key, and every Stripe checkout session
 * created before it carries a name in its metadata and will be fulfilled after
 * the deploy. It is a legacy path, not the normal one, and `resolveTier`
 * reports which branch matched so callers can heal the row.
 */

const { FREE_TIER_FEATURES, ALWAYS_ON_FEATURES } = require('../config/featureRegistry');

/**
 * The floor under every plan: what a tier grants no matter what its `features`
 * array says.
 *
 * `freeDefault` keys are what an UNPAID event gets, so a paid tier that omits
 * one would hand a paying customer strictly less than someone who paid nothing.
 * `alwaysOn` keys are the ones the admin UI renders checked-and-locked. Both
 * promises are kept in this one place, so no gate has to remember either.
 */
const BASELINE_FEATURES = [...new Set([...FREE_TIER_FEATURES, ...ALWAYS_ON_FEATURES])];

/** A tier's stored features plus the baseline, order-stable and de-duplicated. */
function withBaseline(features) {
  const list = Array.isArray(features) ? features : [];
  return [...new Set([...list, ...BASELINE_FEATURES])];
}

/**
 * Does this plan drop the "Powered by Fancy RSVP" mark?
 *
 * TWO admin switches say so — the `remove_watermark` checkbox on the tier, and
 * the `remove_watermark` entry in the plan's feature checklist — and until now
 * only the first was ever read, so ticking the one that sits amongst everything
 * else the plan includes shipped the watermark anyway. Either grants it.
 *
 * Every write of `events.tier_remove_watermark` goes through here: the purchase
 * snapshot, the Stripe checkout metadata, and the self-heal in withResolvedTier.
 * The guest page reads only that column, so this function is the whole gate.
 */
function tierRemovesWatermark(tier) {
  if (!tier) return false;
  if (tier.remove_watermark === true) return true;
  if (!Array.isArray(tier.features)) return false;
  // White label is a SUPERSET of removing the mark. Reading only
  // `remove_watermark` here would let a white-label plan ship a guest page with
  // "Powered by Fancy RSVP" still on it because an admin ticked the bigger
  // feature and not the smaller one — the single most visible way this product
  // could contradict what a customer paid for.
  return tier.features.includes('remove_watermark') || tier.features.includes('white_label');
}

/**
 * Is this plan white-labelled — no Fancy mark anywhere a GUEST can see?
 *
 * Strictly more than `tierRemovesWatermark`: that one governs a single line on
 * the invitation page and the pass, this one also strips the logo, the wordmark
 * and the tagline from every event email and puts the host's name there instead.
 *
 * Only the feature key grants it. There is deliberately no second switch — the
 * watermark's two-switch history is in this file for a reason, and adding a
 * `white_label` boolean beside the tier's `remove_watermark` one would recreate
 * exactly that bug at a higher price point.
 */
function tierIsWhiteLabel(tier) {
  if (!tier) return false;
  return Array.isArray(tier.features) && tier.features.includes('white_label');
}

/**
 * A stable, URL-safe key derived from a name — used ONLY when minting a key for
 * a tier that has never had one. Never call this to look a tier up: that would
 * reintroduce exactly the name-is-identity coupling this module removes.
 */
function slugifyTierName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'tier';
}

/**
 * Give every tier in a list a key, preserving the ones that already have one
 * and keeping them unique.
 *
 * Uniqueness matters more than prettiness: two tiers sharing a key would make
 * entitlement ambiguous for every event on either of them, so a collision gets
 * a numeric suffix rather than being merged or rejected.
 */
function ensureTierKeys(tiers) {
  const seen = new Set();
  return (Array.isArray(tiers) ? tiers : []).map((tier) => {
    if (!tier) return tier;
    let key = String(tier.key || '').trim() || slugifyTierName(tier.name);
    if (seen.has(key)) {
      let n = 2;
      while (seen.has(`${key}_${n}`)) n += 1;
      key = `${key}_${n}`;
    }
    seen.add(key);
    return { ...tier, key };
  });
}

/**
 * Find a tier by identity.
 *
 * @param {Array}  tiers      config.pricing_tiers
 * @param {object} ref        { key?, name? } — whatever the caller has
 * @returns {{ tier: object|null, matchedBy: 'key'|'name'|null }}
 *
 * Returns HOW it matched, not just what: a `name` match means the row is a
 * legacy one that should be healed to carry the key, and a caller that cannot
 * tell the difference cannot heal it.
 */
function resolveTier(tiers, ref = {}) {
  const list = Array.isArray(tiers) ? tiers : [];
  const key = ref.key ? String(ref.key).trim() : '';
  const name = ref.name ? String(ref.name).trim() : '';

  if (key) {
    const byKey = list.find((t) => t && String(t.key || '').trim() === key);
    if (byKey) return { tier: byKey, matchedBy: 'key' };
  }
  if (name) {
    const byName = list.find((t) => t && String(t.name || '').trim().toLowerCase() === name.toLowerCase());
    if (byName) return { tier: byName, matchedBy: 'name' };
  }
  return { tier: null, matchedBy: null };
}

/** The identity to persist alongside a purchase. Name included for display/receipts. */
function tierSnapshot(tier) {
  if (!tier) return null;
  return {
    tier_key: String(tier.key || '').trim() || slugifyTierName(tier.name),
    tier_name: String(tier.name || '').trim(),
    tier_max_guests: Number.isFinite(tier.max_guests) ? tier.max_guests : null,
    // Either switch grants it — see tierRemovesWatermark.
    tier_remove_watermark: tierRemovesWatermark(tier),
    // Snapshotted for the same reason as the watermark: the guest page and the
    // event emails read the EVENT, months after the purchase, and what somebody
    // paid for must not depend on the plan still existing.
    tier_white_label: tierIsWhiteLabel(tier),
    // What the licence cost, frozen at purchase. This is the upgrade credit
    // when the plan itself can no longer be resolved — deriving it instead
    // from payment history would over-credit, because a checkout can bundle
    // an SMS allowance into the same amount_cents.
    tier_price_cents: Number.isFinite(Number(tier.price_cents)) ? Number(tier.price_cents) : null,
    // The entitlement snapshot. Written at purchase so that what was bought
    // survives the plan being renamed, re-priced, emptied or deleted.
    tier_features: Array.isArray(tier.features) ? [...tier.features] : [],
  };
}

/**
 * What features does this event actually have?
 *
 * LIVE tier when the plan still resolves — so an admin ADDING a feature to a
 * plan reaches the customers already on it, which is the whole point of
 * editable plans. SNAPSHOT only when the plan is gone, so that a rename or a
 * deletion can never revoke what someone paid for.
 *
 * BASELINE_FEATURES are unioned onto every answer, including the empty one: a
 * plan cannot grant less than an unpaid event, and the keys the admin UI shows
 * as always-included have to actually be included. `source` still reports how
 * the TIER resolved — the baseline is not a resolution outcome, so a caller
 * logging 'snapshot' is still telling the truth about the plan.
 *
 * @returns {{ features: string[], source: 'tier'|'snapshot'|'none', tier: object|null, matchedBy: string|null }}
 */
function entitledFeatures(tiers, event) {
  const { tier, matchedBy } = resolveTier(tiers, { key: event?.tier_key, name: event?.tier_name });
  if (tier && Array.isArray(tier.features)) {
    return { features: withBaseline(tier.features), source: 'tier', tier, matchedBy };
  }
  const snapshot = Array.isArray(event?.tier_features) ? event.tier_features : null;
  if (snapshot && snapshot.length > 0) {
    return { features: withBaseline(snapshot), source: 'snapshot', tier: null, matchedBy };
  }
  return { features: withBaseline([]), source: 'none', tier: null, matchedBy };
}

/** The columns every entitlement read needs. One list, so no caller under-selects. */
const TIER_COLUMNS = 'tier_key, tier_name, tier_max_guests, tier_remove_watermark, tier_white_label, tier_features, tier_price_cents';

/** Everything except `tier_white_label` — i.e. before 20260830000003_white_label.sql. */
const IDENTITY_TIER_COLUMNS = 'tier_key, tier_name, tier_max_guests, tier_remove_watermark, tier_features, tier_price_cents';

/** What existed before 20260818000002_tier_identity.sql. */
const LEGACY_TIER_COLUMNS = 'tier_name, tier_max_guests, tier_remove_watermark';

/** PostgREST's "you selected a column that does not exist". */
function isUndefinedColumnError(error) {
  if (!error) return false;
  return error.code === '42703' || /column .* does not exist/i.test(error.message || '');
}

/**
 * Read one event together with its tier columns, tolerating the identity
 * migration not having been applied yet.
 *
 * Why this exists: selecting a column that does not exist is a 400 from
 * PostgREST, and the gates turn any error on this read into
 * `404 EVENT_NOT_FOUND`. So shipping this code before its migration would not
 * degrade anything — it would make EVERY paid feature on the platform report
 * that the event does not exist, for every customer at once, until someone
 * connected the dots. This codebase has already lost an evening to a
 * production 500 that turned out to be an unapplied migration rather than the
 * code that was being frantically re-read.
 *
 * The fallback resolves plans by display name exactly as the old code did, so
 * a mis-ordered deploy is merely the previous behaviour, not an outage. The
 * migration is still REQUIRED — see the header of the migration file.
 *
 * @param {object} supabase   client (passed in so this module stays pure)
 * @param {string} eventId
 * @param {string} baseColumns  the caller's own columns, without any tier_*
 */
async function selectEventWithTier(supabase, eventId, baseColumns) {
  // A LADDER, not a single fallback, and the middle rung is the point.
  //
  // Every column added to TIER_COLUMNS makes the full select fail on a database
  // that has not caught up — and a straight full→legacy fallback means the
  // newest migration missing costs the OLDEST behaviour: name-only plan
  // resolution and no entitlement snapshot, so a renamed tier silently revokes
  // paid features. That is a big regression to pay for one boolean.
  //
  // So each rung drops exactly one migration's worth of columns. A deployment
  // missing only `tier_white_label` keeps identity and snapshots; only a
  // deployment missing the identity migration itself falls all the way back.
  for (const columns of [TIER_COLUMNS, IDENTITY_TIER_COLUMNS]) {
    const attempt = await supabase
      .from('events').select(`${baseColumns}, ${columns}`).eq('id', eventId).single();
    if (!isUndefinedColumnError(attempt.error)) {
      return columns === TIER_COLUMNS ? attempt : { ...attempt, tierColumnsPartial: true };
    }
  }

  const legacy = await supabase
    .from('events').select(`${baseColumns}, ${LEGACY_TIER_COLUMNS}`).eq('id', eventId).single();
  return { ...legacy, tierColumnsMissing: true };
}

module.exports = {
  slugifyTierName,
  ensureTierKeys,
  resolveTier,
  tierSnapshot,
  tierRemovesWatermark,
  tierIsWhiteLabel,
  entitledFeatures,
  withBaseline,
  BASELINE_FEATURES,
  selectEventWithTier,
  isUndefinedColumnError,
  TIER_COLUMNS,
  IDENTITY_TIER_COLUMNS,
  LEGACY_TIER_COLUMNS,
};
