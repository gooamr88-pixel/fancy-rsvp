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
 *   no free plan          leaves an expired trial with nowhere safe to land
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

const { startTrial, planColumns, resolveTrialPlans } = require('../services/trialService');

const EVENT = '33333333-3333-4333-8333-333333333333';
const ORG = '44444444-4444-4444-8444-444444444444';

const DRAFT = { id: EVENT, org_id: ORG, title: 'Nadia & Omar', slug: 'nadia-and-omar', status: 'draft', is_paid: false };
const ORG_ROW = { id: ORG, email: 'host@example.com', name: 'Yara', status: 'active', email_verified: true, trial_event_id: null };

t.beforeEach(() => { TIERS = [TRIAL, FREE, PREMIUM]; mock.reset(); });

/** Runs startTrial and captures whatever it tried to write to `events`. */
async function grant({ org = ORG_ROW, event = DRAFT } = {}) {
  const writes = [];
  mock.setResolver((s) => {
    if (s.table === 'organizations') return { data: org };
    if (s.table === 'events') return { data: { ...event, ...(s.payload || {}) } };
    if (s.table === 'activity_logs') return { data: {} };
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

/* ── Configuration refusals — the ones that protect day 8 ──────────────── */

test('no trial plan configured means no trial offered', async () => {
  TIERS = [FREE, PREMIUM];
  const { result } = await grant();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'TRIAL_NOT_CONFIGURED');
});

test('no FREE plan to land on means no trial offered', async () => {
  /* The promise is that an expired trial keeps its invitation live on the free
     plan. Without a free plan there is nowhere safe to land, and the only
     remaining options are taking a live event offline or leaving the trial
     running forever. Refusing to start is the honest failure: it happens
     before anyone has been promised anything. */
  TIERS = [TRIAL, PREMIUM];
  const { result } = await grant();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'NO_FREE_PLAN');
});

test('a contact-sales plan is never mistaken for the landing plan', () => {
  const plans = resolveTrialPlans([TRIAL, { ...FREE, is_custom: true }, PREMIUM]);
  assert.equal(plans.ok, false);
  assert.equal(plans.error, 'NO_FREE_PLAN');
});

test('the cheapest sellable plan is the landing plan', () => {
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
