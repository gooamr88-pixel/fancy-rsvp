/**
 * WHAT AN EXPIRED TRIAL IS ENTITLED TO — asked of every gate that grants.
 *
 * This is the test that makes the free trial safe to ship, and the property it
 * proves is narrow and specific:
 *
 *     ONE SECOND AFTER THE DEADLINE, WITH THE BACKGROUND SWEEP NEVER HAVING
 *     RUN, THE PAID FEATURES ARE ALREADY GONE.
 *
 * That distinction is the whole design. A trial event carries the trial plan's
 * feature snapshot on its row until `services/trialExpiry.js` rewrites it — and
 * that sweep is in-process, off by default, behind a leader election, on a box
 * that gets redeployed. If entitlement were read from the stored snapshot, then
 * every one of those — a missed env var, a lost election, a crash loop, a
 * Friday deploy — would silently hand somebody a free platform. So the DEADLINE
 * decides, on every request, and the sweep only tidies the row afterwards.
 *
 * ── Why it is asserted through three gates and not one ────────────────────
 *
 * `featureGate`, `smsAddonGate` and `checkinAppGate` are three separate
 * middlewares that each answer "does this plan include X". They all funnel
 * through `entitledFeatures`, which is exactly why the expiry lives there — but
 * "they all funnel through it" is a fact about today's code, and a fourth gate
 * written next year could easily not. Testing the function alone would prove
 * the rule; testing the gates proves the rule is actually reaching the places
 * that enforce it.
 *
 * The SMS gate is the one that matters most commercially: it is the only
 * genuinely metered thing on the platform, and `manual_override` bypasses it
 * entirely — which is precisely why the trial never sets that flag.
 */
require('./helpers/env');

const { test } = require('node:test');
const t = require('node:test');
const assert = require('node:assert/strict');
const { createMockSupabase } = require('./helpers/mockSupabase');
const { mockReq } = require('./helpers/http');
const { injectModule } = require('./helpers/inject');

const mock = createMockSupabase();
injectModule('../../config/supabase', { supabase: mock.supabase });

/** Trial grants everything; Free grants nothing beyond the baseline. */
const TIERS = [
  {
    key: 'trial', name: 'Free trial', is_trial: true, trial_days: 7,
    price_cents: 0, max_guests: 25,
    features: ['seating_map', 'table_management', 'sms_campaigns', 'checkin_app', 'qr_checkin', 'guest_export_csv'],
  },
  { key: 'free', name: 'Free', price_cents: 0, max_guests: 100, features: [] },
  { key: 'prem', name: 'Premium', price_cents: 14900, max_guests: 300, features: ['seating_map', 'sms_campaigns', 'checkin_app'] },
];

injectModule('../../utils/configCache', {
  getPlatformConfig: async () => ({ pricing_tiers: TIERS }),
});
injectModule('../../utils/logger', {
  error: () => {}, warn: () => {}, info: () => {}, debug: () => {},
  child: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
});

const { entitledFeatures } = require('../utils/tierResolver');
const { requireFeature } = require('../middleware/featureGate');
const { requireSmsAddon } = require('../middleware/smsAddonGate');
const { requireCheckinApp } = require('../middleware/checkinAppGate');

const EVENT = '22222222-2222-4222-8222-222222222222';
const PAST = new Date(Date.now() - 1000).toISOString();
const FUTURE = new Date(Date.now() + 3 * 86400000).toISOString();

/** An event mid-trial, exactly as `startTrial` writes it. */
const onTrial = (over) => ({
  id: EVENT,
  is_paid: true,
  // NEVER true on a trial. Asserted in its own test below.
  manual_override: false,
  status: 'active',
  tier_key: 'trial',
  tier_name: 'Free trial',
  tier_features: TIERS[0].features,
  tier_max_guests: 25,
  tier_price_cents: 0,
  // The sweep has NOT run: the row still says "trial plan" and
  // trial_expired_at is still null. Only the deadline has passed.
  trial_ends_at: over ? PAST : FUTURE,
  trial_expired_at: null,
  sms_addon_purchased_at: null,
});

t.beforeEach(() => mock.reset());

async function runGate(gate, eventRow) {
  mock.setResolver((s) => {
    if (s.table === 'events') return { data: eventRow };
    if (s.table === 'event_devices') return { data: [] };
    return {};
  });
  const req = mockReq({ params: { eventId: EVENT }, user: { id: 'owner-1' } });
  let nextCalled = false;
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  await gate(req, res, () => { nextCalled = true; });
  return { nextCalled, res };
}

/* ── The function every gate reads ─────────────────────────────────────── */

test('mid-trial, the trial plan grants what it says', () => {
  const { features, source } = entitledFeatures(TIERS, onTrial(false));
  assert.equal(source, 'tier');
  assert.ok(features.includes('seating_map'));
  assert.ok(features.includes('sms_campaigns'));
});

test('one second past the deadline, entitlement is the FREE plan — sweep or no sweep', () => {
  const event = onTrial(true);
  assert.equal(event.trial_expired_at, null, 'this fixture is a row the sweep has never touched');
  assert.deepEqual(event.tier_features, TIERS[0].features, 'and its stored snapshot still says trial');

  const { features, source } = entitledFeatures(TIERS, event);
  assert.equal(source, 'trial_expired');
  assert.equal(features.includes('seating_map'), false);
  assert.equal(features.includes('sms_campaigns'), false);
  assert.equal(features.includes('checkin_app'), false);
});

test('an expired trial keeps the baseline — it never falls below an unpaid event', () => {
  const { features } = entitledFeatures(TIERS, onTrial(true));
  // BASELINE_FEATURES: what every event gets, paid or not.
  ['rsvp_basic', 'analytics_basic', 'email_notifications', 'support_community']
    .forEach((k) => assert.ok(features.includes(k), `${k} is always on`));
});

test('an organizer who UPGRADED mid-trial keeps what they paid for', () => {
  /* The bug this guards is the worst one available here: a payment rewrites
     the plan, not the trial columns, so a paying customer walks around with a
     stale trial_ends_at. Judging by the deadline alone would downgrade them on
     day 8 having taken their money — they would have bought five days.

     `tier_price_cents` is part of what an upgrade writes and is therefore part
     of the fixture. It was missing, which made this row describe a state no
     payment path can produce: on Premium, at a price of zero. `tierSnapshot`
     sets it from the plan on the Stripe path, and the manual path copies it
     off the pending payment — 14900 either way. */
  const paid = {
    ...onTrial(true),
    tier_key: 'prem', tier_name: 'Premium', tier_features: TIERS[2].features,
    tier_price_cents: 14900,
  };
  const { features, source } = entitledFeatures(TIERS, paid);
  assert.notEqual(source, 'trial_expired');
  assert.ok(features.includes('seating_map'));
  assert.ok(features.includes('sms_campaigns'));
});

test('retiring the trial plan by flagging a DIFFERENT one still ends the old trials', () => {
  /* The hole the exclusive is_trial switch on the pricing screen makes easy to
     reach: an operator builds a new trial plan and ticks it, which unticks the
     old one. The old plan still EXISTS, so a rule that asked "is this event's
     key the flagged plan's key" concluded the event had left the trial, and
     the deadline stopped applying to it. Every trial in flight at that moment
     would have run free forever, on an ordinary admin edit, with nothing
     logged.

     Asking about the PLAN could not see this: it only failed closed when the
     trial plan was deleted outright. What settles it is that nobody paid. */
  const swapped = [
    // The retired trial, kept as a real paid plan — which is what retiring one
    // actually looks like. Left at £0 it would BE the cheapest free plan, and
    // landing there is then the operator's pricing decision, plainly visible on
    // the pricing screen, not something this function should overrule.
    { ...TIERS[0], is_trial: false, price_cents: 4900 },
    { key: 'trial2', name: 'Free trial', is_trial: true, trial_days: 7, price_cents: 0, max_guests: 25, features: ['seating_map'] },
    TIERS[1], TIERS[2],
  ];
  const { features, source, tier } = entitledFeatures(swapped, onTrial(true));
  assert.equal(source, 'trial_expired', 'the deadline applies again');
  assert.equal(tier.key, 'free', 'and they land on the operator’s free plan');
  assert.equal(features.includes('seating_map'), false);
});

test('and an event somebody PAID for is never caught by that, on any plan', () => {
  /* The other side of the same rule, stated separately because it is the one
     that must never regress. The deadline may only end things nobody bought. */
  const swapped = [{ ...TIERS[0], is_trial: false }, TIERS[1], TIERS[2]];
  const paid = { ...onTrial(true), tier_key: 'prem', tier_name: 'Premium', tier_price_cents: 14900 };
  assert.notEqual(entitledFeatures(swapped, paid).source, 'trial_expired');
});

test('a £0 plan bought after a trial lands on the platform free plan, knowingly', () => {
  /* The cost of the rule above, pinned so it is a decision and not a surprise.
     A purchase of a genuinely free plan leaves NO trace in the row that a
     trial does not also leave — both write `tier_price_cents: 0` — so past the
     deadline such an event is answered with the fallback plan's features
     rather than its own. It takes an operator selling two DIFFERENT £0 plans
     for that to be visible at all, and it agrees with what the sweep writes to
     the row. The alternative was leaving unpaid events entitled forever, which
     is unbounded. */
  const twoFree = [
    TIERS[0],
    { key: 'free', name: 'Free', price_cents: 0, max_guests: 100, features: [] },
    { key: 'community', name: 'Community', price_cents: 0, max_guests: 100, features: ['seating_map'] },
  ];
  const onCommunity = { ...onTrial(true), tier_key: 'community', tier_name: 'Community', tier_price_cents: 0 };
  const { source, tier } = entitledFeatures(twoFree, onCommunity);
  assert.equal(source, 'trial_expired');
  assert.equal(tier.key, 'free');
});

test('with the trial plan deleted, an expired trial fails CLOSED', () => {
  /* An admin removing the trial tier must not convert every outstanding trial
     into a permanent free platform. Over-restricting somebody whose trial has
     already run out is one support reply; the other way is unbounded. */
  const withoutTrial = TIERS.filter((x) => !x.is_trial);
  const { features } = entitledFeatures(withoutTrial, onTrial(true));
  assert.equal(features.includes('seating_map'), false);
});

test('an event with no trial columns at all is untouched', () => {
  /* What a database that has not been given the migration returns. It must
     behave exactly as it did before this feature existed — see the ladder in
     selectEventWithTier. */
  const normal = { id: EVENT, is_paid: true, manual_override: false, tier_key: 'prem', tier_name: 'Premium' };
  const { features, source } = entitledFeatures(TIERS, normal);
  assert.equal(source, 'tier');
  assert.ok(features.includes('seating_map'));
});

/* ── The three gates that actually enforce it ──────────────────────────── */

test('featureGate: seating is open mid-trial and 403 after it', async () => {
  const open = await runGate(requireFeature('seating_map'), onTrial(false));
  assert.equal(open.nextCalled, true);

  const shut = await runGate(requireFeature('seating_map'), onTrial(true));
  assert.equal(shut.nextCalled, false, 'an expired trial must not reach the seating endpoint');
  assert.equal(shut.res.statusCode, 403);
  assert.equal(shut.res.body.error, 'FEATURE_NOT_AVAILABLE');
});

test('smsAddonGate: the plan opens the screen mid-trial, and closes it after', async () => {
  /* Mid-trial the answer is 402, not 200: the trial grants ACCESS to messaging,
     never free messages. `sms_addon_purchased_at` is null, so the organizer is
     sent to buy credits exactly as a paying customer on a plan with texting
     would be. That is what makes the trial cost nothing to run. */
  const during = await runGate(requireSmsAddon, onTrial(false));
  assert.equal(during.nextCalled, false);
  assert.equal(during.res.statusCode, 402);
  assert.equal(during.res.body.error, 'SMS_ADDON_REQUIRED');

  const after = await runGate(requireSmsAddon, onTrial(true));
  assert.equal(after.nextCalled, false);
  assert.equal(after.res.statusCode, 403, 'past the deadline the PLAN no longer carries texting');
  assert.equal(after.res.body.error, 'FEATURE_NOT_AVAILABLE');
});

test('checkinAppGate: the door app closes with the trial', async () => {
  const during = await runGate(requireCheckinApp, onTrial(false));
  assert.equal(during.nextCalled, true);

  const after = await runGate(requireCheckinApp, onTrial(true));
  assert.equal(after.nextCalled, false);
  assert.equal(after.res.statusCode, 403);
});

test('a trial event never carries manual_override', async () => {
  /* Belt for the single most expensive mistake available in this feature.
     `manual_override` short-circuits BOTH metered gates before they look at
     the plan (smsAddonGate.js:93, checkinAppGate.js:88) — it is the support
     comp flag. On a trial it would hand every signup free text messages. */
  const comped = { ...onTrial(true), manual_override: true };
  const sms = await runGate(requireSmsAddon, comped);
  assert.equal(sms.nextCalled, true,
    'this asserts the HAZARD is real: with manual_override the SMS gate opens even on an expired trial');

  const { startTrial } = require('../services/trialService');
  assert.equal(typeof startTrial, 'function');
  const src = require('node:fs').readFileSync(require.resolve('../services/trialService'), 'utf8');
  assert.match(src, /manual_override:\s*false/,
    'startTrial must write manual_override: false explicitly, never omit it');
  assert.doesNotMatch(src, /manual_override:\s*true/,
    'nothing in the trial path may ever set manual_override');
});
