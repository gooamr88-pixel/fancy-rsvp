/**
 * Feature Gate middleware integration tests.
 *
 * Validates that requireFeature and requireAnyFeature enforce per-tier feature
 * access correctly across all scenarios: paid/unpaid, tier match/mismatch,
 * super admin bypass, deleted tiers, free-tier defaults, and edge cases.
 *
 * Uses the existing test harness (mockSupabase + inject + http helpers).
 */
require('./helpers/env');

const { describe, it, beforeEach } = require('node:test');
const t = require('node:test');
const assert = require('node:assert/strict');
const { injectModule } = require('./helpers/inject');
const { createMockSupabase } = require('./helpers/mockSupabase');
const { mockReq, mockRes, invoke } = require('./helpers/http');

// ── Set up mocks BEFORE requiring the module under test ──
// Path prefix '../../' because injectModule resolves relative to test/helpers/

const mock = createMockSupabase();
injectModule('../../config/supabase', { supabase: mock.supabase });

let configResult = {
  pricing_tiers: [
    { name: 'Starter', price_cents: 0, features: ['rsvp_basic', 'analytics_basic', 'email_notifications', 'support_community'] },
    { name: 'Premium', price_cents: 2900, features: ['rsvp_basic', 'rsvp_custom_fields', 'add_guest_manual', 'import_guests_csv', 'guest_export_csv', 'guest_export_excel', 'seating_map', 'table_management', 'qr_checkin', 'manual_checkin', 'sms_campaigns', 'custom_branding', 'remove_watermark', 'analytics_basic', 'analytics_advanced', 'email_notifications', 'support_priority'] },
    { name: 'Enterprise', price_cents: 0, is_custom: true, features: ['rsvp_basic', 'rsvp_custom_fields', 'add_guest_manual', 'import_guests_csv', 'guest_export_csv', 'guest_export_excel', 'seating_map', 'table_management', 'qr_checkin', 'manual_checkin', 'sms_campaigns', 'custom_branding', 'remove_watermark', 'white_label', 'analytics_basic', 'analytics_advanced', 'email_notifications', 'support_dedicated', 'all_integrations', 'custom_api', 'sso_team_mgmt', 'advanced_security'] },
  ],
};

injectModule('../../utils/configCache', {
  getPlatformConfig: async () => configResult,
  invalidate: () => {},
  CONFIG_ID: '00000000-0000-0000-0000-000000000000',
  TTL_MS: 30000,
});

// Logger mock (featureGate imports it)
injectModule('../../utils/logger', {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  child: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
});

// Now require the module under test
const { requireFeature, requireAnyFeature } = require('../middleware/featureGate');

// ── Helpers ──

const PAID_EVENT = { id: 'evt-1', is_paid: true, manual_override: false, status: 'active', tier_name: 'Premium' };
const STARTER_EVENT = { id: 'evt-2', is_paid: true, manual_override: false, status: 'active', tier_name: 'Starter' };
const UNPAID_EVENT = { id: 'evt-3', is_paid: false, manual_override: false, status: 'draft', tier_name: null };
const OVERRIDE_EVENT = { id: 'evt-4', is_paid: false, manual_override: true, status: 'active', tier_name: 'Premium' };
const DELETED_TIER_EVENT = { id: 'evt-5', is_paid: true, manual_override: false, status: 'active', tier_name: 'DeletedPlan' };

const events = new Map([
  ['evt-1', PAID_EVENT],
  ['evt-2', STARTER_EVENT],
  ['evt-3', UNPAID_EVENT],
  ['evt-4', OVERRIDE_EVENT],
  ['evt-5', DELETED_TIER_EVENT],
]);

t.beforeEach(() => {
  mock.reset();
  mock.setResolver(async (state) => {
    if (state.table === 'events' && state.terminal === 'single') {
      const id = (state.filters.eq || []).find(([c]) => c === 'id');
      if (id) {
        const event = events.get(id[1]);
        return event ? { data: event } : { data: null, error: { code: 'PGRST116' } };
      }
    }
    return {};
  });
});

// ── Tests ──

describe('requireFeature', () => {
  it('allows access when paid event tier includes the feature', async () => {
    const middleware = requireFeature('seating_map');
    const req = mockReq({ params: { eventId: 'evt-1' }, user: { id: 'u1' } });
    const { res, next } = await invoke(middleware, req);

    assert.ok(next, 'next() should have been called');
    assert.equal(res.finished, false, 'should not have sent a response');
    assert.ok(req.event, 'req.event should be populated');
    assert.ok(req.tierFeatures.includes('seating_map'), 'tierFeatures should contain the feature');
  });

  it('rejects 403 FEATURE_NOT_AVAILABLE when tier lacks the feature', async () => {
    const middleware = requireFeature('seating_map');
    const req = mockReq({ params: { eventId: 'evt-2' }, user: { id: 'u1' } }); // Starter, no seating
    const { res } = await invoke(middleware, req);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'FEATURE_NOT_AVAILABLE');
    assert.equal(res.body.feature, 'seating_map');
    assert.ok(res.body.featureLabel);
    assert.equal(res.body.currentTier, 'Starter');
  });

  it('allows free-tier features on unpaid events', async () => {
    const middleware = requireFeature('rsvp_basic');
    const req = mockReq({ params: { eventId: 'evt-3' }, user: { id: 'u1' } });
    const { next } = await invoke(middleware, req);

    assert.ok(next, 'next() should be called for free-tier feature');
  });

  it('rejects paid features on unpaid events with 403 FEATURE_REQUIRES_PAYMENT', async () => {
    const middleware = requireFeature('seating_map');
    const req = mockReq({ params: { eventId: 'evt-3' }, user: { id: 'u1' } });
    const { res } = await invoke(middleware, req);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'FEATURE_REQUIRES_PAYMENT');
    assert.equal(res.body.upgrade_action, 'complete_payment');
  });

  it('allows access for manually overridden events when tier has the feature', async () => {
    const middleware = requireFeature('seating_map');
    const req = mockReq({ params: { eventId: 'evt-4' }, user: { id: 'u1' } }); // manual_override=true, tier=Premium
    const { next } = await invoke(middleware, req);

    assert.ok(next, 'next() should be called for manual override with feature in tier');
  });

  it('super admin bypasses all gates', async () => {
    const middleware = requireFeature('seating_map');
    const req = mockReq({ params: { eventId: 'evt-3' }, user: { id: 'admin', isSuperAdmin: true } });
    const { next } = await invoke(middleware, req);

    assert.ok(next, 'super admin should bypass');
  });

  it('returns 404 when event does not exist', async () => {
    const middleware = requireFeature('seating_map');
    const req = mockReq({ params: { eventId: 'nonexistent' }, user: { id: 'u1' } });
    const { res } = await invoke(middleware, req);

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, 'EVENT_NOT_FOUND');
  });

  it('rejects with 403 when tier definition is missing (deleted tier)', async () => {
    const middleware = requireFeature('seating_map');
    const req = mockReq({ params: { eventId: 'evt-5' }, user: { id: 'u1' } }); // tier_name='DeletedPlan'
    const { res } = await invoke(middleware, req);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'FEATURE_NOT_AVAILABLE');
  });
});

describe('requireAnyFeature', () => {
  it('passes when tier includes at least one of the listed features', async () => {
    const middleware = requireAnyFeature('white_label', 'seating_map', 'custom_api');
    const req = mockReq({ params: { eventId: 'evt-1' }, user: { id: 'u1' } }); // Premium has seating_map
    const { next } = await invoke(middleware, req);

    assert.ok(next, 'next() should be called when at least one feature matches');
  });

  it('rejects when tier includes none of the listed features', async () => {
    const middleware = requireAnyFeature('white_label', 'custom_api', 'sso_team_mgmt');
    const req = mockReq({ params: { eventId: 'evt-1' }, user: { id: 'u1' } }); // Premium lacks all 3
    const { res } = await invoke(middleware, req);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'FEATURE_NOT_AVAILABLE');
  });

  it('allows free-tier match on unpaid events', async () => {
    const middleware = requireAnyFeature('seating_map', 'rsvp_basic');
    const req = mockReq({ params: { eventId: 'evt-3' }, user: { id: 'u1' } });
    const { next } = await invoke(middleware, req);

    assert.ok(next, 'should pass when at least one feature is free-tier');
  });
});

/**
 * A PAID plan may never grant less than an unpaid event.
 *
 * `entitledFeatures` used to return the tier's stored array verbatim, so a tier
 * whose `features` happened to omit `rsvp_basic` gave a paying customer strictly
 * fewer capabilities than someone who had paid nothing. It was invisible only
 * because none of the free-default keys was gated — the day one is mounted, the
 * bill arrives as a 403 on the most basic screen in the product, for the
 * customers who paid the most.
 */
describe('the always-on baseline', () => {
  const BASELINE_TIER = { id: 'evt-6', is_paid: true, manual_override: false, status: 'active', tier_name: 'Bare' };

  beforeEach(() => {
    events.set('evt-6', BASELINE_TIER);
    configResult = {
      ...configResult,
      // A plan an admin built by ticking one paid capability and nothing else.
      pricing_tiers: [...configResult.pricing_tiers.filter(t2 => t2.name !== 'Bare'),
        { name: 'Bare', price_cents: 4900, features: ['seating_map'] }],
    };
  });

  it('grants free-default features to a paid tier that never listed them', async () => {
    const req = mockReq({ params: { eventId: 'evt-6' }, user: { id: 'u1' } });
    const { next, res } = await invoke(requireFeature('rsvp_basic'), req);

    assert.ok(next, `rsvp_basic must be granted; got ${res.statusCode} ${res.body?.error}`);
    assert.ok(req.tierFeatures.includes('analytics_basic'), 'the whole baseline rides along, not just the requested key');
  });

  it('still refuses a paid feature the tier does not carry', async () => {
    const req = mockReq({ params: { eventId: 'evt-6' }, user: { id: 'u1' } });
    const { res } = await invoke(requireFeature('qr_checkin'), req);

    assert.equal(res.statusCode, 403, 'the baseline is a floor, not a wildcard');
    assert.equal(res.body.error, 'FEATURE_NOT_AVAILABLE');
  });

  it('keeps what the tier does carry', async () => {
    const req = mockReq({ params: { eventId: 'evt-6' }, user: { id: 'u1' } });
    const { next } = await invoke(requireFeature('seating_map'), req);

    assert.ok(next, 'unioning the baseline must not drop the tier\'s own features');
  });

  it('holds for a paid event carrying no plan at all', async () => {
    // A comp granted before tier snapshots existed, or a half-fulfilled
    // purchase. `entitledFeatures` is not even reached for these — the gate
    // skips it when there is no tier_key and no tier_name — so the floor has to
    // be seeded, not assumed.
    events.set('evt-7', { id: 'evt-7', is_paid: true, manual_override: false, status: 'active', tier_name: null, tier_key: null });

    const req = mockReq({ params: { eventId: 'evt-7' }, user: { id: 'u1' } });
    const { next } = await invoke(requireFeature('rsvp_basic'), req);
    assert.ok(next, 'an always-on capability cannot depend on a plan resolving');

    const req2 = mockReq({ params: { eventId: 'evt-7' }, user: { id: 'u1' } });
    const { res } = await invoke(requireFeature('seating_map'), req2);
    assert.equal(res.statusCode, 403, 'and it still grants nothing that was paid for');
  });
});
