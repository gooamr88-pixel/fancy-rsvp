/**
 * STARTING A TRIAL — what it writes, and what it refuses.
 *
 * Every assertion here corresponds to a specific way this feature could give
 * away something it did not mean to. None of them are hypothetical: each one
 * is a property of the surrounding system that a plausible implementation gets
 * wrong.
 *
 *   manual_override       hands out metered SMS and the door app
 *   tier_price_cents      becomes an upgrade credit for money nobody paid
 *   tier_max_guests null  reads as UNLIMITED to the guest-cap trigger
 *   one trial per org     otherwise the account is a renewable free platform
 *   no free plan          must NOT block the offer — an expired trial lands on
 *                         the gate's baseline, which is what "free" already
 *                         means everywhere else
 */
require('./helpers/env');

const { test } = require('node:test');
const t = require('node:test');
const assert = require('node:assert/strict');
const { createMockSupabase } = require('./helpers/mockSupabase');
const { injectModule } = require('./helpers/inject');

const mock = createMockSupabase();
injectModule('../../config/supabase', { supabase: mock.supabase });
injectModule('../../utils/logger', {
  error: () => {}, warn: () => {}, info: () => {}, debug: () => {},
  child: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
});

const TRIAL = {
  key: 'trial', name: 'Free trial', is_trial: true, trial_days: 7,
  price_cents: 0, max_guests: 25, features: ['seating_map', 'sms_campaigns'],
};
const FREE = { key: 'free', name: 'Free', price_cents: 0, max_guests: 100, features: [] };
const PREMIUM = { key: 'prem', name: 'Premium', price_cents: 14900, max_guests: 300, features: ['seating_map'] };

let TIERS = [TRIAL, FREE, PREMIUM];
injectModule('../../utils/configCache', { getPlatformConfig: async () => ({ pricing_tiers: TIERS }) });

const { startTrial, planColumns, resolveTrialPlans, landingColumns } = require('../services/trialService');

const EVENT = '33333333-3333-4333-8333-333333333333';
const ORG = '44444444-4444-4444-8444-444444444444';

const DRAFT = { id: EVENT, org_id: ORG, title: 'Nadia & Omar', slug: 'nadia-and-omar', status: 'draft', is_paid: false };
const ORG_ROW = { id: ORG, email: 'host@example.com', name: 'Yara', status: 'active', email_verified: true, trial_event_id: null };

t.beforeEach(() => { TIERS = [TRIAL, FREE, PREMIUM]; mock.reset(); });

/** Runs startTrial and captures whatever it tried to write to `events`.
 *
 *  `guests` is the size of the list already sitting on the draft — undefined
 *  means the count query answered nothing, which is what every test that does
 *  not care about the cap gets. */
async function grant({ org = ORG_ROW, event = DRAFT, guests, guestsError } = {}) {
  const writes = [];
  mock.setResolver((s) => {
    if (s.table === 'organizations') return { data: org };
    if (s.table === 'events') return { data: { ...event, ...(s.payload || {}) } };
    if (s.table === 'activity_logs') return { data: {} };
    if (s.table === 'guests') return guestsError ? { error: guestsError } : { count: guests };
    return {};
  });
  if (mock.onWrite) mock.onWrite((s) => writes.push(s));
  const result = await startTrial({ eventId: EVENT, orgId: ORG, actorId: 'owner-1' });
  return { result, writes };
}

/* ── The columns a grant writes ────────────────────────────────────────── */

test('the plan snapshot never credits money nobody paid', () => {
  /* createCheckoutSession charges `newPrice - previousPaidCents`, and falls
     back to events.tier_price_cents when the old plan is gone. A trial that
     reported its plan's list price would let somebody upgrade for the
     difference from a payment that never happened. */
  const cols = planColumns({ ...TRIAL, price_cents: 9900 });
  assert.equal(cols.tier_price_cents, 0);
});

test('the guest cap is always a real number', () => {
  /* enforce_tier_guest_cap() reads NULL — and 0 — as UNLIMITED. A trial plan
     saved without a cap would be an uncapped free event, which is the one
     thing the guest limit exists to prevent. */
  assert.equal(planColumns(TRIAL).tier_max_guests, 25);
  assert.equal(planColumns({ ...TRIAL, max_guests: 0 }).tier_max_guests, 25, 'falls back rather than meaning unlimited');
  assert.equal(planColumns({ ...TRIAL, max_guests: null }).tier_max_guests, 25);
  assert.equal(planColumns({ ...TRIAL, max_guests: 50 }).tier_max_guests, 50, 'a configured cap is honoured');
});

test('a grant publishes the event and stamps a deadline', async () => {
  const { result } = await grant();
  assert.equal(result.ok, true);
  assert.equal(result.days, 7);
  assert.ok(Date.parse(result.endsAt) > Date.now(), 'the deadline is in the future');
});

/* ── What it refuses ───────────────────────────────────────────────────── */

test('one trial per account', async () => {
  const { result } = await grant({ org: { ...ORG_ROW, trial_event_id: 'some-other-event' } });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'TRIAL_ALREADY_USED');
});

test('the same event asking twice is told so plainly', async () => {
  const { result } = await grant({ org: { ...ORG_ROW, trial_event_id: EVENT } });
  assert.equal(result.error, 'TRIAL_ALREADY_USED');
  assert.match(result.message, /already on your free trial/i);
});

test('an unverified account cannot publish a live event', async () => {
  const { result } = await grant({ org: { ...ORG_ROW, email_verified: false } });
  assert.equal(result.error, 'EMAIL_NOT_VERIFIED');
});

test('a suspended account cannot start one', async () => {
  const { result } = await grant({ org: { ...ORG_ROW, status: 'suspended' } });
  assert.equal(result.error, 'ORG_NOT_ACTIVE');
});

test('an already-paid event cannot be downgraded onto a trial', async () => {
  const { result } = await grant({ event: { ...DRAFT, is_paid: true, status: 'active' } });
  assert.equal(result.error, 'ALREADY_PAID');
});

test('a non-draft event cannot start one', async () => {
  const { result } = await grant({ event: { ...DRAFT, status: 'paused' } });
  assert.equal(result.error, 'EVENT_NOT_DRAFT');
});

/* ── The guest cap, which the trigger alone cannot hold ────────────────── */

test('a list bigger than the trial covers is refused at the door', async () => {
  /* The 25 is enforced by a BEFORE INSERT trigger, so it only ever stops the
     NEXT guest. A draft has no plan and therefore no cap, so the wizard's CSV
     import will load four hundred names into one — and granting a trial writes
     the 25 without removing anybody, leaving a real four-hundred-guest wedding
     running free for a week. This is the check that closes it. */
  const { result, writes } = await grant({ guests: 400 });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'GUEST_LIMIT_EXCEEDED');
  assert.match(result.message, /25 guests/);
  assert.match(result.message, /already has 400/);
  assert.equal(writes.filter((w) => w.table === 'organizations' && w.op === 'update').length, 0,
    'and it refuses BEFORE claiming the account trial — a refusal must not burn it');
});

test('a list within the cap is granted normally', async () => {
  const { result } = await grant({ guests: 25 });
  assert.equal(result.ok, true, 'exactly at the cap is inside it, as the trigger reads it');
});

test('a count that cannot be read does not refuse', async () => {
  /* A bound on generosity, not an entitlement gate — and the trigger still
     holds the line on every insert from here. Refusing a legitimate trial
     because a COUNT timed out costs a customer to protect a limit that is
     already protected. */
  const { result } = await grant({ guestsError: { message: 'timeout' } });
  assert.equal(result.ok, true);
});

/* ── Configuration refusals — the ones that protect day 8 ──────────────── */

test('no trial plan configured means no trial offered', async () => {
  TIERS = [FREE, PREMIUM];
  const { result } = await grant();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'TRIAL_NOT_CONFIGURED');
});

test('a trial still works when no FREE plan is configured', async () => {
  /* This USED to refuse, and refusing was wrong in the most expensive way: it
     made the whole feature depend on the operator happening to sell a £0 plan,
     and it failed by rendering NOTHING — no card, no error — so the trial
     looked broken rather than unconfigured.

     It is also unnecessary. "The free plan" already has a precise meaning here
     that needs no configuration: BASELINE_FEATURES, exactly what featureGate
     grants an unpaid event, which `entitledFeatures` has always landed on. */
  TIERS = [TRIAL, PREMIUM];
  const { result } = await grant();
  assert.equal(result.ok, true);
  assert.equal(result.days, 7);
});

test('with no free plan, an expired trial lands on the baseline and stays live', () => {
  const cols = landingColumns(null);
  assert.deepEqual(cols.tier_features, [], 'no plan features — the gate adds the baseline');
  assert.equal(cols.tier_key, null);
  assert.equal(cols.tier_price_cents, 0);
  assert.equal(cols.tier_max_guests, 25, 'never null: the cap trigger reads null as UNLIMITED');
  assert.equal(cols.tier_remove_watermark, false, 'and never a stale paid-branding flag');
  assert.equal(cols.tier_white_label, false);
});

test('a contact-sales plan is never mistaken for the landing plan', () => {
  const plans = resolveTrialPlans([TRIAL, { ...FREE, is_custom: true }, PREMIUM]);
  assert.equal(plans.ok, true, 'the trial is still offered');
  assert.equal(plans.landing, null, 'but a contact-sales plan is not somewhere to land');
});

test('a configured free plan is preferred when there is one', () => {
  const plans = resolveTrialPlans([TRIAL, PREMIUM, FREE]);
  assert.equal(plans.ok, true);
  assert.equal(plans.landing.key, 'free');
  assert.equal(plans.tier.key, 'trial');
});

test('the trial length is clamped, never trusted', () => {
  assert.equal(resolveTrialPlans([{ ...TRIAL, trial_days: 700 }, FREE]).days, 90);
  assert.equal(resolveTrialPlans([{ ...TRIAL, trial_days: 0 }, FREE]).days, 1);
  assert.equal(resolveTrialPlans([{ ...TRIAL, trial_days: undefined }, FREE]).days, 7);
});
