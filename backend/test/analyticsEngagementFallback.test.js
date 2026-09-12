/**
 * A BEACON-TABLE FAILURE MUST NOT BLACK OUT THE FREE DASHBOARD — OR REPORT ZERO.
 *
 * This endpoint reads two tables, and a failure in each deserves a different
 * answer:
 *
 *   • `rsvp_parties` is the guest list. Without it the screen has no subject —
 *     no headcount, no response mix — so the request fails outright.
 *   • `guest_analytics` is the public beacon table: page views, the funnel, the
 *     envelope, the timeline. Failing the whole request on it would take the
 *     RSVP counts down as collateral, and those are `analytics_basic`, which
 *     EVERY plan carries. A beacon problem would black out the free dashboard.
 *
 * The third property is the one that matters most and is the easiest to get
 * wrong: the withheld figures come back NULL, never 0. "0 page views" is a real,
 * ordinary answer for a young event, so a failure that renders as zero is a
 * confident lie an organizer cannot detect. That exact confusion is how a
 * missing `mergeParams` on this route hid for as long as it did — every query
 * failed on every request and the page reported a plausible brand-new event.
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
    pricing_tiers: [{ key: 'pro', name: 'Pro', features: ['analytics_basic', 'analytics_advanced'] }],
  }),
  invalidate: () => {},
});

injectModule('../../utils/logger', {
  error: () => {}, warn: () => {}, info: () => {}, debug: () => {},
  child: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
});

const { getEventAnalytics } = require('../controllers/analyticsController');

const EVENT = '11111111-1111-4111-8111-111111111111';

/** Two parties on the guest list, so the surviving figures are non-trivial. */
const PARTIES = [
  { id: 'p1', response: 'yes', response_source: 'web_form', decline_reason: null, guests: [{ id: 'g1' }, { id: 'g2' }] },
  { id: 'p2', response: 'no', response_source: 'email', decline_reason: 'travel', guests: [{ id: 'g3' }] },
];

t.beforeEach(() => mock.reset());

/**
 * @param {object} [failing]
 * @param {boolean} [failing.beacons]  guest_analytics is unreadable
 * @param {boolean} [failing.parties]  rsvp_parties is unreadable
 */
async function run({ beacons = false, parties = false } = {}) {
  mock.setResolver((s) => {
    if (s.table === 'events') {
      return {
        data: {
          id: EVENT, is_paid: true, manual_override: false, status: 'active',
          tier_key: 'pro', tier_name: 'Pro', timezone: 'UTC',
        },
      };
    }
    if (s.table === 'guest_analytics') {
      return beacons ? { error: { message: 'relation "guest_analytics" does not exist' } } : { data: [] };
    }
    if (s.table === 'rsvp_parties') {
      return parties ? { error: { message: 'permission denied for table rsvp_parties' } } : { data: PARTIES };
    }
    return { data: [] };
  });

  const req = mockReq({ params: { eventId: EVENT }, query: {}, user: { id: 'owner-1' } });
  const res = mockRes();
  let nextErr = null;
  await getEventAnalytics(req, res, (err) => { nextErr = err || null; });
  return { res, nextErr };
}

describe('the beacon table is unreadable', () => {
  test('the request still succeeds — the free dashboard stays up', async () => {
    const { res, nextErr } = await run({ beacons: true });

    assert.equal(nextErr, null, 'a beacon failure must not be handed to the error handler');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.analytics.engagementAvailable, false, 'the client has to be TOLD, so it can say so');
  });

  test('the guest-list figures are still real', async () => {
    const { res } = await run({ beacons: true });
    const { overview } = res.body.analytics;

    assert.equal(overview.totalRsvps, 2);
    assert.equal(overview.attendingCount, 1);
    assert.equal(overview.declinedCount, 1);
    assert.equal(overview.totalHeadcount, 2, 'the attending party has two guests');
  });

  test('the withheld figures are NULL, never 0', async () => {
    const { res } = await run({ beacons: true });
    const { overview } = res.body.analytics;

    // The whole point. `|| 0` anywhere on this path turns "we could not find
    // out" back into a confident, wrong "nobody has looked at your invitation".
    assert.equal(overview.totalPageViews, null, '0 here is indistinguishable from a brand-new event');
    assert.equal(overview.uniqueVisitors, null);
    assert.equal(overview.conversionRate, null, 'a rate whose denominator is unknown is not 0%');
    assert.equal(overview.engagementRate, null);
  });

  test('beacon-derived blocks are absent, guest-list ones survive', async () => {
    const { res } = await run({ beacons: true });
    const a = res.body.analytics;

    assert.equal(a.advanced, true, 'the plan still carries the advanced half');
    for (const block of ['funnel', 'engagementActions', 'reveal', 'timeline']) {
      assert.ok(!(block in a), `${block} comes from guest_analytics and must be omitted, not zeroed`);
    }
    // These two are computed from rsvp_parties, so a beacon failure says nothing
    // about them and withholding them would lose data we actually have.
    assert.ok('declineReasons' in a, 'declineReasons comes from rsvp_parties and survives');
    assert.ok('sources' in a, 'sources comes from rsvp_parties and survives');
    assert.equal(a.declineReasons.travel, 1);
  });
});

describe('the guest list is unreadable', () => {
  test('the request fails — there is no screen without it', async () => {
    const { nextErr } = await run({ parties: true });

    assert.ok(nextErr instanceof Error, 'a guest-list failure IS fatal and must reach the error handler');
    assert.match(nextErr.message, /rsvpStats|declineReasons|sourceBreakdown/);
  });
});

describe('the happy path is unchanged', () => {
  test('everything is present and flagged available', async () => {
    const { res, nextErr } = await run();

    assert.equal(nextErr, null);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.analytics.engagementAvailable, true);
    for (const block of ['funnel', 'engagementActions', 'reveal', 'timeline', 'declineReasons', 'sources']) {
      assert.ok(block in res.body.analytics, `${block} must be present on a healthy request`);
    }
    // Zero is still reported as zero when it is genuinely zero.
    assert.equal(res.body.analytics.overview.totalPageViews, 0);
  });
});
