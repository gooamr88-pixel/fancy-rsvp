/**
 * ADVANCED ANALYTICS — a gate that shapes a response instead of refusing one.
 *
 * `analytics_basic` is on every plan and `analytics_advanced` is not, and both
 * live in ONE payload. So this cannot be a route mount: 403'ing /analytics to
 * withhold the funnel would take the basic dashboard away with it.
 *
 * Three properties, and the third is the one that keeps the screen honest:
 *
 *   1. A plan that carries it gets the deep blocks.
 *   2. A plan that does not carries on getting the overview.
 *   3. The withheld blocks are ABSENT and flagged, never present-but-empty. The
 *      page destructures with `= {}` / `= []` defaults, so empty objects would
 *      render a wall of zeroes and blank charts — a product that looks broken
 *      instead of one that looks upgradeable.
 */
require('./helpers/env');

const { test, describe } = require('node:test');
const t = require('node:test');
const assert = require('node:assert/strict');
const { createMockSupabase } = require('./helpers/mockSupabase');
const { mockReq, mockRes } = require('./helpers/http');
const { injectModule } = require('./helpers/inject');

const mock = createMockSupabase();
injectModule('../../config/supabase', { supabase: mock.supabase });

injectModule('../../utils/configCache', {
  getPlatformConfig: async () => ({
    pricing_tiers: [
      { key: 'pro', name: 'Pro', features: ['analytics_basic', 'analytics_advanced'] },
      { key: 'lite', name: 'Lite', features: ['analytics_basic'] },
    ],
  }),
  invalidate: () => {},
});

injectModule('../../utils/logger', {
  error: () => {}, warn: () => {}, info: () => {}, debug: () => {},
  child: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
});

const { getEventAnalytics } = require('../controllers/analyticsController');

const EVENT = '11111111-1111-4111-8111-111111111111';

const ADVANCED_BLOCKS = ['funnel', 'declineReasons', 'sources', 'engagementActions', 'reveal', 'timeline'];

t.beforeEach(() => mock.reset());

/** Runs the controller against an event on the given tier. */
async function run(tierKey, tierName, user = { id: 'owner-1' }) {
  mock.setResolver((s) => {
    if (s.table === 'events') {
      return {
        data: {
          id: EVENT, is_paid: true, manual_override: false, status: 'active',
          tier_key: tierKey, tier_name: tierName, timezone: 'UTC',
          event_date: '2026-09-01T18:00:00.000Z',
        },
      };
    }
    // Every analytics source table: no rows. The numbers are not what is under
    // test here — which blocks are present is.
    return { data: [] };
  });

  const req = mockReq({ params: { eventId: EVENT }, query: {}, user });
  const res = mockRes();
  await getEventAnalytics(req, res, (err) => { if (err) throw err; });
  return res;
}

describe('analytics_advanced', () => {
  test('a plan carrying it gets the deep blocks', async () => {
    const res = await run('pro', 'Pro');

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.analytics.advanced, true);
    for (const block of ADVANCED_BLOCKS) {
      assert.ok(block in res.body.analytics, `${block} must be present on an entitled plan`);
    }
  });

  test('a plan without it still gets the overview', async () => {
    const res = await run('lite', 'Lite');

    assert.equal(res.statusCode, 200, 'the basic dashboard is on every plan and must not 403');
    assert.ok(res.body.analytics.overview, 'the overview is analytics_basic — always included');
    assert.equal(typeof res.body.analytics.overview.totalRsvps, 'number');
  });

  test('the withheld blocks are absent and flagged, not empty', async () => {
    const res = await run('lite', 'Lite');

    assert.equal(res.body.analytics.advanced, false, 'the client needs to be TOLD, so it can lock the panels');
    for (const block of ADVANCED_BLOCKS) {
      assert.ok(
        !(block in res.body.analytics),
        `${block} must be omitted entirely — an empty one renders as a blank chart, which reads `
        + 'as a broken product rather than a plan boundary',
      );
    }
  });

  test('a super admin sees everything', async () => {
    const res = await run('lite', 'Lite', { id: 'admin', isSuperAdmin: true });

    assert.equal(res.body.analytics.advanced, true, 'super admins bypass gates, as everywhere else');
  });
});
