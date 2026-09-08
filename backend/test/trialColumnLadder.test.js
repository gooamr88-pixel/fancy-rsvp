/**
 * SHIPPING THE TRIAL BEFORE ITS MIGRATION MUST BE A NO-OP, NOT AN OUTAGE.
 *
 * ── The failure this exists to prevent, which has already happened here ──
 *
 * Migrations in this repo are applied by hand-pasting SQL into the Supabase
 * editor. There is no `schema_migrations` record, no runner, and no CI step —
 * so "the code is deployed and the migration is not" is a normal Tuesday.
 *
 * `20260818000002_tier_identity.sql` lost a version collision and was never
 * run. The code that read `events.tier_key` shipped anyway, and because
 * PostgREST rejects the ENTIRE select when one column is unknown (42703), and
 * because the feature gates translate any error on that read into
 * `404 EVENT_NOT_FOUND`, the symptom was every paid event on the platform
 * reporting that it did not exist. The pay button said "Event not found".
 *
 * `entitledFeatures` now reads `trial_ends_at` on every gated request, which
 * puts this feature in exactly that position. `selectEventWithTier` answers it
 * with a LADDER: full columns, then without the trial column, then without
 * white-label, then the legacy set. Each rung drops one migration's worth.
 *
 * What is asserted here is the whole safety property:
 *
 *   with `trial_ends_at` absent, every gate behaves EXACTLY as it did before
 *   this feature existed — not degraded, not locked down, unchanged.
 */
require('./helpers/env');

const { test } = require('node:test');
const t = require('node:test');
const assert = require('node:assert/strict');
const { injectModule } = require('./helpers/inject');
const { mockReq } = require('./helpers/http');

/** PostgREST's "you selected a column that does not exist". */
const UNDEFINED_COLUMN = { code: '42703', message: 'column events.trial_ends_at does not exist' };

/** Which column lists were attempted, in order. */
let attempts = [];
/** Columns this fake database actually has. */
let present = new Set();

const EVENT_ROW = {
  id: 'evt-1', is_paid: true, manual_override: false, status: 'active',
  tier_key: 'prem', tier_name: 'Premium', tier_features: ['seating_map'],
  tier_max_guests: 300, tier_remove_watermark: true, tier_white_label: false,
  tier_price_cents: 14900, sms_addon_purchased_at: null, sms_settings: {},
};

/**
 * A supabase double whose `.select()` rejects any column list naming something
 * `present` does not contain — which is exactly what PostgREST does.
 */
function makeSupabase() {
  return {
    from() {
      const q = {
        _cols: '',
        select(cols) { q._cols = cols; attempts.push(cols); return q; },
        eq() { return q; },
        is() { return q; },
        single() {
          const asked = q._cols.split(',').map((c) => c.trim());
          const missing = asked.find((c) => c && !present.has(c));
          if (missing) return Promise.resolve({ data: null, error: UNDEFINED_COLUMN });
          const row = {};
          asked.forEach((c) => { row[c] = EVENT_ROW[c]; });
          return Promise.resolve({ data: row, error: null });
        },
        then(res) { return q.single().then(res); },
      };
      return q;
    },
  };
}

injectModule('../../config/supabase', { supabase: makeSupabase() });
injectModule('../../utils/logger', {
  error: () => {}, warn: () => {}, info: () => {}, debug: () => {},
  child: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
});
injectModule('../../utils/configCache', {
  getPlatformConfig: async () => ({
    pricing_tiers: [
      { key: 'trial', name: 'Trial', is_trial: true, features: ['seating_map'] },
      { key: 'free', name: 'Free', price_cents: 0, features: [] },
      { key: 'prem', name: 'Premium', price_cents: 14900, features: ['seating_map'] },
    ],
  }),
});

const { selectEventWithTier, TIER_COLUMNS, NO_TRIAL_TIER_COLUMNS } = require('../utils/tierResolver');
const { requireFeature } = require('../middleware/featureGate');
const { supabase } = require('../config/supabase');

/** Everything the trial migration has NOT added yet. */
const WITHOUT_TRIAL = [
  'id', 'is_paid', 'manual_override', 'status',
  'tier_key', 'tier_name', 'tier_max_guests', 'tier_remove_watermark',
  'tier_white_label', 'tier_features', 'tier_price_cents',
];

t.beforeEach(() => { attempts = []; });

test('the full column list asks for trial_ends_at', () => {
  assert.ok(TIER_COLUMNS.includes('trial_ends_at'));
  assert.ok(!NO_TRIAL_TIER_COLUMNS.includes('trial_ends_at'),
    'the rung below it is the same list minus exactly that column');
});

test('on a migrated database the first rung answers', async () => {
  present = new Set([...WITHOUT_TRIAL, 'trial_ends_at']);
  const res = await selectEventWithTier(supabase, 'evt-1', 'id, is_paid, manual_override, status');
  assert.equal(res.error, null);
  assert.equal(attempts.length, 1, 'no fallback was needed');
  assert.ok(attempts[0].includes('trial_ends_at'));
});

test('WITHOUT the migration it steps down one rung and still returns the event', async () => {
  present = new Set(WITHOUT_TRIAL);
  const res = await selectEventWithTier(supabase, 'evt-1', 'id, is_paid, manual_override, status');

  assert.equal(res.error, null, 'the read succeeds — this is the difference between a no-op and an outage');
  assert.equal(res.data.id, 'evt-1');
  assert.equal(attempts.length, 2, 'it tried the trial rung, then the one below');
  assert.ok(attempts[0].includes('trial_ends_at'));
  assert.ok(!attempts[1].includes('trial_ends_at'));
  assert.equal(res.tierColumnsPartial, true, 'and it reports that it fell back');
});

test('and the gates keep working exactly as before', async () => {
  /* The property that matters. Not "the trial degrades gracefully" — every
     PAID customer on the platform keeps their features while the migration is
     outstanding. */
  present = new Set(WITHOUT_TRIAL);

  const req = mockReq({ params: { eventId: 'evt-1' }, user: { id: 'u1' } });
  let nextCalled = false;
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  await requireFeature('seating_map')(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true, 'a paid event must not 404 because a trial column is missing');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, null);
});

test('an event read without the column is simply not on a trial', async () => {
  present = new Set(WITHOUT_TRIAL);
  const res = await selectEventWithTier(supabase, 'evt-1', 'id, is_paid, manual_override, status');
  const { isTrialExpired } = require('../utils/trialTier');
  assert.equal(res.data.trial_ends_at, undefined);
  assert.equal(isTrialExpired(res.data), false,
    'undefined is not a passed deadline — an absent column must never revoke anything');
});
