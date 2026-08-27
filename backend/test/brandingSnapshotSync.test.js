/**
 * WHAT HAPPENS TO EVENTS THAT ALREADY EXIST WHEN A PLAN CHANGES.
 *
 * Almost every capability is resolved LIVE — `entitledFeatures()` reads the
 * current plan on every request — so ticking a feature on a tier reaches every
 * event already sold on it instantly, with nothing to migrate.
 *
 * The watermark and white label are the exception, and they are the two a GUEST
 * sees. They are COLUMNS on the event row, because the public invitation page
 * and the email jobs that run months later have no session, no config lookup,
 * and must keep working after a plan is deleted. A column does not update
 * itself: `withResolvedTier` heals it only when the ORGANIZER next opens their
 * dashboard, and for an event whose invitations already went out, that may be
 * never — so an admin could grant white label and watch nothing happen to the
 * pages it was bought for.
 *
 * These pin the push that closes that gap, and the one case that must NOT be
 * pushed to.
 */
require('./helpers/env');

const { describe, it, beforeEach } = require('node:test');
const t = require('node:test');
const assert = require('node:assert/strict');
const { createMockSupabase } = require('./helpers/mockSupabase');
const { mockReq, mockRes } = require('./helpers/http');
const { injectModule } = require('./helpers/inject');

const mock = createMockSupabase();
injectModule('../../config/supabase', { supabase: mock.supabase });
injectModule('../../utils/configCache', {
  getPlatformConfig: async () => ({ pricing_tiers: [] }),
  invalidate: () => {},
  CONFIG_ID: '00000000-0000-0000-0000-000000000000',
  TTL_MS: 30000,
});
injectModule('../../utils/logger', {
  error: () => {}, warn: () => {}, info: () => {}, debug: () => {},
  child: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
});

const { updatePricingConfig } = require('../controllers/paymentController');

/** The tiers as the admin form submits them. */
const TIERS = [
  // Plain paid plan: the mark stays.
  { key: 'lite', name: 'Lite', price_cents: 4900, max_guests: 100, features: ['seating_map'] },
  // Watermark removed via the tier CHECKBOX.
  { key: 'pro', name: 'Pro', price_cents: 9900, max_guests: 300, remove_watermark: true, features: ['seating_map'] },
  // Watermark removed via the FEATURE LIST — the switch that used to do nothing.
  { key: 'plus', name: 'Plus', price_cents: 14900, max_guests: 500, features: ['seating_map', 'remove_watermark'] },
  // White label: implies the mark is gone even though neither watermark switch is set.
  { key: 'bespoke', name: 'Bespoke', price_cents: 49900, max_guests: 0, features: ['seating_map', 'white_label'] },
];

t.beforeEach(() => mock.reset());

/** Runs a config save and returns every UPDATE aimed at the events table. */
async function saveTiers(tiers = TIERS) {
  mock.setResolver((s) => {
    if (s.table === 'super_admin_config') return { data: [{ id: 'cfg', pricing_tiers: tiers }] };
    return { data: [] };
  });

  const req = mockReq({ body: { pricingTiers: tiers }, user: { id: 'admin-1' } });
  const res = mockRes();
  await updatePricingConfig(req, res, (err) => { if (err) throw err; });

  assert.equal(res.statusCode, 200, 'the save itself must succeed');

  return mock.calls.filter((c) => c.table === 'events' && c.op === 'update');
}

/** Every branding push aimed at one tier key. */
const pushesFor = (updates, key) => updates
  .filter((u) => (u.filters.eq || []).some(([col, val]) => col === 'tier_key' && val === key));

/**
 * The value one push writes to one column.
 *
 * Each column is pushed by its OWN statement, filtered to the rows that differ —
 * so there is no single payload carrying both booleans to assert against.
 */
const pushedValue = (updates, key, column) => {
  const push = pushesFor(updates, key).find((u) => column in u.payload);
  return push ? push.payload[column] : undefined;
};

describe('saving a plan pushes branding to the events already on it', () => {
  let updates;
  beforeEach(async () => { updates = await saveTiers(); });

  it('leaves the mark on a plan that does not remove it', () => {
    assert.ok(pushesFor(updates, 'lite').length > 0, 'every keyed tier is pushed, including the ones that grant nothing');
    assert.equal(pushedValue(updates, 'lite', 'tier_remove_watermark'), false);
    assert.equal(pushedValue(updates, 'lite', 'tier_white_label'), false);
  });

  it('removes the mark for the tier checkbox', () => {
    assert.equal(pushedValue(updates, 'pro', 'tier_remove_watermark'), true);
  });

  it('removes the mark for the FEATURE-LIST switch', () => {
    // The half of the pair that was decorative for the whole life of the
    // registry: an admin ticked it and the guest page kept the mark.
    assert.equal(pushedValue(updates, 'plus', 'tier_remove_watermark'), true);
  });

  it('treats white label as removing the mark too', () => {
    assert.equal(pushedValue(updates, 'bespoke', 'tier_white_label'), true);
    assert.equal(
      pushedValue(updates, 'bespoke', 'tier_remove_watermark'), true,
      'a white-label invitation with "Powered by Fancy RSVP" still on it is the most '
      + 'visible way this product could contradict what was paid for',
    );
  });

  it('writes only the rows whose value actually differs', () => {
    // Without this filter, editing one plan's description rewrites every event
    // row on that plan — new row versions, rewritten index entries and dead
    // tuples for two booleans that already held the right value.
    for (const u of updates) {
      const [column] = Object.keys(u.payload);
      const guarded = (u.filters.neq || []).some(([col]) => col === column);
      assert.ok(guarded, `the push for ${column} is not filtered to changed rows`);
    }
  });

  it('scopes each push by tier_key, never by name', () => {
    // Names are display text an admin edits freely. A push keyed on the name
    // would repaint the branding of whichever plan happens to share it.
    for (const u of updates) {
      const cols = (u.filters.eq || []).map(([col]) => col);
      assert.ok(cols.includes('tier_key'), 'a branding push was not scoped by tier_key');
      assert.ok(!cols.includes('tier_name'), 'branding must never be pushed by display name');
    }
  });

  it('touches only the branding columns', () => {
    // Not the guest cap, not the feature snapshot. Those resolve live or heal on
    // their own, and silently rewriting a cap from this path would change what a
    // running event is allowed to do as a side effect of an unrelated edit.
    const allowed = new Set(['tier_remove_watermark', 'tier_white_label']);
    for (const u of updates) {
      for (const column of Object.keys(u.payload)) {
        assert.ok(allowed.has(column), `branding sync wrote an unrelated column: ${column}`);
      }
    }
  });
});

describe('a config save that did not touch the plans', () => {
  it('pushes nothing', async () => {
    // `saved` is the whole config row, so it carries pricing_tiers even when the
    // admin was editing SMS rates or the landing stats. Syncing off that would
    // walk every tier on the platform — and write to the events table — on every
    // unrelated settings change.
    mock.setResolver((s) => {
      if (s.table === 'super_admin_config') return { data: [{ id: 'cfg', pricing_tiers: TIERS }] };
      return { data: [] };
    });

    const req = mockReq({ body: { smsMarkupPercentage: 150 }, user: { id: 'admin-1' } });
    const res = mockRes();
    await updatePricingConfig(req, res, (err) => { if (err) throw err; });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(
      mock.calls.filter((c) => c.table === 'events'),
      [],
      'an SMS-pricing edit must not touch a single event row',
    );
  });
});

describe('an event whose plan no longer exists', () => {
  it('is not touched, because no tier matches its key', async () => {
    // Deleting "Bespoke" from the config must not reach back and strip the white
    // label from the events that bought it — their entitlement lives in the
    // snapshot on the row, and that is the whole reason the snapshot exists.
    const updates = await saveTiers(TIERS.filter((x) => x.key !== 'bespoke'));

    assert.deepEqual(pushesFor(updates, 'bespoke'), []);
  });

  it('and a tier with no key is skipped rather than matched loosely', async () => {
    const updates = await saveTiers([{ name: 'Unkeyed', price_cents: 100, features: [] }]);
    const unscoped = updates.filter((u) => !(u.filters.eq || []).some(([col]) => col === 'tier_key'));

    assert.deepEqual(unscoped, [], 'an unscoped UPDATE would repaint every event on the platform');
  });
});
