/**
 * RENAMING A PLAN MUST NOT DETACH THE CUSTOMERS ON IT.
 *
 * A pricing tier used to have no identity: tiers are elements of a JSON array
 * in super_admin_config, an event's only link to the one it bought was
 * `events.tier_name TEXT`, and every call site re-derived the plan by matching
 * that display name. So an admin renaming "Enterprise" in the config screen
 * was indistinguishable from deleting it — and it:
 *
 *   • revoked every paid feature from every event on that plan;
 *   • charged the next upgrade the new plan's FULL price instead of the
 *     difference, because the previous plan no longer resolved;
 *   • hid the upgrade button entirely;
 *   • turned that plan's promo codes into UNLIMITED-guest grants, since an
 *     unresolved tier yields max_guests null and null means "no cap".
 *
 * Each case below is one of those, expressed as behaviour rather than as an
 * implementation detail: rename the tier in the config, then assert the
 * customer is unaffected.
 */
require('./helpers/env');

const { describe, it } = require('node:test');
const t = require('node:test');
const assert = require('node:assert/strict');
const { injectModule } = require('./helpers/inject');
const { createMockSupabase } = require('./helpers/mockSupabase');
const { mockReq, invoke } = require('./helpers/http');

const mock = createMockSupabase();
injectModule('../../config/supabase', { supabase: mock.supabase });

const ENTERPRISE_FEATURES = ['rsvp_basic', 'seating_map', 'qr_checkin', 'sms_campaigns', 'white_label'];

/** The live pricing config, mutated by the rename tests. */
let configResult = {
  pricing_tiers: [
    { key: 'starter', name: 'Starter', price_cents: 0, max_guests: 50, features: ['rsvp_basic'] },
    { key: 'enterprise', name: 'Enterprise', price_cents: 59900, max_guests: 1000, features: ENTERPRISE_FEATURES },
  ],
};

injectModule('../../utils/configCache', {
  getPlatformConfig: async () => configResult,
  invalidate: () => {},
  CONFIG_ID: '00000000-0000-0000-0000-000000000000',
  TTL_MS: 30000,
});
injectModule('../../utils/logger', {
  error: () => {}, warn: () => {}, info: () => {}, debug: () => {},
  child: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
});

const { requireFeature } = require('../middleware/featureGate');
const { resolveTier, entitledFeatures, ensureTierKeys, tierSnapshot, BASELINE_FEATURES } = require('../utils/tierResolver');

/** An event sold on Enterprise, carrying the identity and snapshot a purchase writes. */
const buyer = (over = {}) => ({
  id: 'evt-ent',
  is_paid: true,
  manual_override: false,
  status: 'active',
  tier_key: 'enterprise',
  tier_name: 'Enterprise',
  tier_max_guests: 1000,
  tier_remove_watermark: true,
  tier_features: ENTERPRISE_FEATURES,
  tier_price_cents: 59900,
  ...over,
});

let currentEvent = buyer();

function renameEnterpriseTo(newName) {
  configResult = {
    pricing_tiers: configResult.pricing_tiers.map((t2) =>
      t2.key === 'enterprise' ? { ...t2, name: newName } : t2),
  };
}

function deleteEnterprise() {
  configResult = { pricing_tiers: configResult.pricing_tiers.filter((t2) => t2.key !== 'enterprise') };
}

t.beforeEach(() => {
  mock.reset();
  configResult = {
    pricing_tiers: [
      { key: 'starter', name: 'Starter', price_cents: 0, max_guests: 50, features: ['rsvp_basic'] },
      { key: 'enterprise', name: 'Enterprise', price_cents: 59900, max_guests: 1000, features: ENTERPRISE_FEATURES },
    ],
  };
  currentEvent = buyer();
  mock.setResolver(async (state) => {
    if (state.table === 'events' && state.terminal === 'single') return { data: currentEvent };
    return {};
  });
});

describe('the feature gate after a rename', () => {
  it('still grants the features of a renamed plan', async () => {
    renameEnterpriseTo('Enterprise Plus');

    const req = mockReq({ params: { eventId: 'evt-ent' }, user: { id: 'u1' } });
    const { res, next } = await invoke(requireFeature('seating_map'), req);

    assert.ok(next, 'a renamed plan revoked seating from a paying customer');
    assert.equal(res.finished, false);
    assert.ok(req.tierFeatures.includes('sms_campaigns'));
  });

  it('picks up features ADDED to the plan after purchase', async () => {
    // The snapshot must not freeze entitlement: an admin adding a feature to a
    // plan is meant to reach the customers already on it.
    configResult = {
      pricing_tiers: configResult.pricing_tiers.map((t2) =>
        t2.key === 'enterprise' ? { ...t2, features: [...ENTERPRISE_FEATURES, 'guest_export_excel'] } : t2),
    };

    const req = mockReq({ params: { eventId: 'evt-ent' }, user: { id: 'u1' } });
    const { next } = await invoke(requireFeature('guest_export_excel'), req);
    assert.ok(next, 'a feature added to the plan did not reach an existing customer');
  });

  it('honours the purchase-time snapshot when the plan is DELETED', async () => {
    deleteEnterprise();

    const req = mockReq({ params: { eventId: 'evt-ent' }, user: { id: 'u1' } });
    const { res, next } = await invoke(requireFeature('seating_map'), req);

    assert.ok(next, 'deleting a plan revoked what a customer had already paid for');
    assert.equal(res.finished, false);
  });

  it('is still not a wildcard — a deleted plan grants only what was bought', async () => {
    deleteEnterprise();

    const req = mockReq({ params: { eventId: 'evt-ent' }, user: { id: 'u1' } });
    const { res } = await invoke(requireFeature('custom_api'), req);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'FEATURE_NOT_AVAILABLE');
  });

  it('grants nothing when the plan is gone and nothing was ever snapshotted', async () => {
    // Pre-migration rows: no key, no snapshot. Denying is correct here — there
    // is no evidence of what was bought.
    currentEvent = buyer({ tier_key: null, tier_features: null, tier_name: 'LongDeletedPlan' });

    const req = mockReq({ params: { eventId: 'evt-ent' }, user: { id: 'u1' } });
    const { res } = await invoke(requireFeature('seating_map'), req);
    assert.equal(res.statusCode, 403);
  });

  it('resolves a legacy row that has a name and no key', async () => {
    currentEvent = buyer({ tier_key: null, tier_features: null });

    const req = mockReq({ params: { eventId: 'evt-ent' }, user: { id: 'u1' } });
    const { next } = await invoke(requireFeature('seating_map'), req);
    assert.ok(next, 'an event sold before keys existed lost access');
  });
});

describe('surviving an unapplied migration', () => {
  // Selecting a column that does not exist is a 400 from PostgREST, and the
  // gates turn any error on that read into 404 EVENT_NOT_FOUND. Shipping the
  // code before its migration would therefore not degrade the platform — it
  // would make EVERY paid feature report that the event does not exist. This
  // repo has already lost time to a production failure that was an unapplied
  // migration rather than the code being read at the time.
  const { selectEventWithTier, isUndefinedColumnError, LEGACY_TIER_COLUMNS } = require('../utils/tierResolver');

  function fakeDb({ hasNewColumns }) {
    const asked = [];
    return {
      asked,
      from: () => ({
        select(cols) {
          asked.push(cols);
          this._cols = cols;
          return this;
        },
        eq() { return this; },
        single() {
          if (!hasNewColumns && /tier_key/.test(this._cols)) {
            return Promise.resolve({ data: null, error: { code: '42703', message: 'column events.tier_key does not exist' } });
          }
          return Promise.resolve({ data: { id: 'evt-ent', tier_name: 'Enterprise' }, error: null });
        },
      }),
    };
  }

  it('recognises PostgREST\'s undefined-column error', () => {
    assert.equal(isUndefinedColumnError({ code: '42703' }), true);
    assert.equal(isUndefinedColumnError({ message: 'column events.tier_key does not exist' }), true);
    assert.equal(isUndefinedColumnError({ code: 'PGRST116' }), false, 'a real not-found must NOT look like a missing column');
    assert.equal(isUndefinedColumnError(null), false);
  });

  it('falls back to the legacy columns instead of failing the read', async () => {
    const db = fakeDb({ hasNewColumns: false });
    const res = await selectEventWithTier(db, 'evt-ent', 'id, is_paid');
    assert.equal(res.error, null, 'the gate would have returned 404 for every paid feature');
    assert.equal(res.data.tier_name, 'Enterprise');
    assert.equal(res.tierColumnsMissing, true);
    assert.ok(db.asked[1].includes(LEGACY_TIER_COLUMNS));
  });

  it('does not retry when the columns are there', async () => {
    const db = fakeDb({ hasNewColumns: true });
    const res = await selectEventWithTier(db, 'evt-ent', 'id, is_paid');
    assert.equal(db.asked.length, 1, 'one round trip, not two, on the normal path');
    assert.equal(res.tierColumnsMissing, undefined);
  });
});

describe('resolveTier', () => {
  it('prefers the key and reports how it matched', () => {
    renameEnterpriseTo('Something Else');
    const r = resolveTier(configResult.pricing_tiers, { key: 'enterprise', name: 'Enterprise' });
    assert.equal(r.tier.name, 'Something Else');
    assert.equal(r.matchedBy, 'key');
  });

  it('falls back to the name, and says so, so the caller can heal the row', () => {
    const r = resolveTier(configResult.pricing_tiers, { key: null, name: 'enterprise' });
    assert.equal(r.tier.key, 'enterprise');
    assert.equal(r.matchedBy, 'name');
  });

  it('does not match a stale key against a different plan', () => {
    const r = resolveTier(configResult.pricing_tiers, { key: 'gone', name: null });
    assert.equal(r.tier, null);
    assert.equal(r.matchedBy, null);
  });
});

describe('ensureTierKeys', () => {
  it('keeps existing keys untouched — that is what makes a rename a rename', () => {
    const out = ensureTierKeys([{ key: 'enterprise', name: 'Enterprise Plus' }]);
    assert.equal(out[0].key, 'enterprise');
  });

  it('mints a key for a new tier', () => {
    const out = ensureTierKeys([{ name: 'Small Weddings!' }]);
    assert.equal(out[0].key, 'small_weddings');
  });

  it('never issues the same key twice', () => {
    // Two tiers sharing a key would make entitlement ambiguous for every event
    // on either of them.
    const out = ensureTierKeys([{ name: 'Pro' }, { name: 'pro' }, { name: 'P.R.O.' }]);
    const keys = out.map((x) => x.key);
    assert.equal(new Set(keys).size, keys.length, `duplicate keys: ${keys.join(', ')}`);
  });
});

describe('tierSnapshot', () => {
  it('captures everything entitlement and billing need later', () => {
    const snap = tierSnapshot(configResult.pricing_tiers[1]);
    assert.equal(snap.tier_key, 'enterprise');
    assert.equal(snap.tier_name, 'Enterprise');
    assert.equal(snap.tier_max_guests, 1000);
    assert.equal(snap.tier_price_cents, 59900, 'without the price, an upgrade after a deletion cannot be credited');
    assert.deepEqual(snap.tier_features, ENTERPRISE_FEATURES);
  });

  it('copies the feature list rather than aliasing the config', () => {
    const tier = configResult.pricing_tiers[1];
    const snap = tierSnapshot(tier);
    snap.tier_features.push('white_label_extra');
    assert.equal(tier.features.includes('white_label_extra'), false,
      'the snapshot aliased the live config — mutating one would silently edit the plan');
  });
});

/**
 * These assert WHICH LIST WON — live plan, snapshot, or neither. They used to
 * deep-equal the whole result, which quietly made them assertions about the
 * always-on baseline too, and they failed the day that floor was added even
 * though resolution itself was untouched. So they check the resolved list is
 * carried through and that the baseline rides along, and leave the floor's own
 * behaviour to tierEntitlementApplies.test.js, which is about exactly that.
 */
describe('entitledFeatures', () => {
  /** Every key the resolved plan granted is present, plus the always-on floor. */
  const assertCarries = (features, resolved) => {
    for (const key of resolved) assert.ok(features.includes(key), `${key} must survive resolution`);
    for (const key of BASELINE_FEATURES) assert.ok(features.includes(key), `${key} is granted to every plan`);
  };

  it('prefers the live plan over the snapshot', () => {
    const event = { tier_key: 'enterprise', tier_features: ['rsvp_basic'] };
    const r = entitledFeatures(configResult.pricing_tiers, event);
    assert.equal(r.source, 'tier');
    assertCarries(r.features, ENTERPRISE_FEATURES);
    // The snapshot's single key must not be what came back.
    assert.ok(r.features.includes('white_label'), 'the LIVE plan is what was returned, not the snapshot');
  });

  it('falls back to the snapshot only when the plan is gone', () => {
    deleteEnterprise();
    const r = entitledFeatures(configResult.pricing_tiers, { tier_key: 'enterprise', tier_features: ENTERPRISE_FEATURES });
    assert.equal(r.source, 'snapshot');
    assertCarries(r.features, ENTERPRISE_FEATURES);
  });

  it('reports none when there is neither', () => {
    deleteEnterprise();
    const r = entitledFeatures(configResult.pricing_tiers, { tier_key: 'enterprise', tier_features: [] });
    assert.equal(r.source, 'none');
    // Nothing was resolved, so nothing paid-for is granted — but the floor holds.
    assert.deepEqual(r.features, BASELINE_FEATURES);
    assert.ok(!r.features.includes('white_label'), 'an unresolvable plan grants no paid capability');
  });
});
