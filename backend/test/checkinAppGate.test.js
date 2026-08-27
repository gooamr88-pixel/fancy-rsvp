/**
 * DOOR APP GATE — the entitlement moved from the download to the pairing code.
 *
 * `checkin_app` is a paid registry feature whose only enforcement used to be
 * `GET /checkin-app/download` — while the public marketing page links the same
 * APK from the web root and tells readers, correctly, that installing it needs
 * no account. The paid feature was therefore included with every plan that had
 * check-in at all, and no test could notice, because every gate that existed
 * was passing.
 *
 * Two properties are under test, and the second is the one that makes shipping
 * the first safe:
 *
 *   1. An event whose plan does not carry the app cannot pair a tablet.
 *   2. An event that has ALREADY paired one still can. `checkin_app` is seeded
 *      on no tier by any migration — it is assigned by hand in the admin UI —
 *      so a gate without this clause would have refused every organizer on the
 *      platform the moment it deployed, including one standing at a door with a
 *      dead tablet and a spare in their hand.
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

injectModule('../../utils/configCache', {
  getPlatformConfig: async () => ({
    pricing_tiers: [
      { key: 'premium', name: 'Premium', features: ['qr_checkin', 'checkin_app'] },
      { key: 'basic', name: 'Basic', features: ['qr_checkin'] },
    ],
  }),
});

injectModule('../../utils/logger', {
  error: () => {}, warn: () => {}, info: () => {}, debug: () => {},
  child: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
});

const { requireCheckinApp } = require('../middleware/checkinAppGate');

const EVENT = '11111111-1111-4111-8111-111111111111';

t.beforeEach(() => mock.reset());

/**
 * @param eventRow  the event as the gate will read it
 * @param devices   rows in event_devices for this event
 */
async function runGate(eventRow, devices = [], user = { id: 'owner-1' }) {
  mock.setResolver((s) => {
    if (s.table === 'events') return { data: eventRow };
    if (s.table === 'event_devices') return { data: devices };
    return {};
  });

  const req = mockReq({ params: { eventId: EVENT }, user });
  let nextCalled = false;
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  await requireCheckinApp(req, res, () => { nextCalled = true; });
  return { nextCalled, res, req };
}

const PAID = { id: EVENT, is_paid: true, manual_override: false, status: 'active' };

test('a plan carrying the app may pair a tablet', async () => {
  const { nextCalled, res } = await runGate({ ...PAID, tier_key: 'premium', tier_name: 'Premium' });

  assert.equal(nextCalled, true);
  assert.equal(res.body, null, 'a permitted request writes no response of its own');
});

test('a plan without the app is refused with 403 and told to upgrade', async () => {
  const { nextCalled, res } = await runGate({ ...PAID, tier_key: 'basic', tier_name: 'Basic' });

  assert.equal(nextCalled, false, 'no pairing code may be minted');
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'FEATURE_NOT_AVAILABLE');
  assert.equal(res.body.feature, 'checkin_app');
  assert.equal(res.body.upgrade_action, 'upgrade_plan');
  assert.equal(res.body.currentTier, 'Basic', 'the message names the plan they are actually on');
});

test('an event already running the app keeps pairing spares', async () => {
  // The grandfather clause, and the reason this gate can ship at all: the key
  // is assigned to no tier by default, and a door that worked this morning must
  // not stop working because of a config field nobody has filled in.
  const { nextCalled, res } = await runGate(
    { ...PAID, tier_key: 'basic', tier_name: 'Basic' },
    [{ id: 'device-1' }],
  );

  assert.equal(nextCalled, true, 'an event with a paired tablet is grandfathered');
  assert.equal(res.body, null);
});

test('the grandfather is per event, not per plan', async () => {
  // Same unentitled plan, a different event that has never paired anything.
  const { nextCalled, res } = await runGate({ ...PAID, tier_key: 'basic', tier_name: 'Basic' }, []);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403, 'one grandfathered event must not entitle the whole account');
});

test('a comped event passes', async () => {
  const { nextCalled } = await runGate({ ...PAID, manual_override: true, tier_key: 'basic', tier_name: 'Basic' });

  assert.equal(nextCalled, true, 'manual_override has always meant full access');
});

test('a super admin bypasses the gate', async () => {
  const { nextCalled } = await runGate(
    { ...PAID, tier_key: 'basic', tier_name: 'Basic' }, [], { id: 'admin', isSuperAdmin: true },
  );

  assert.equal(nextCalled, true);
});

test('a missing event is a 404, not a 403', async () => {
  mock.setResolver((s) => {
    if (s.table === 'events') return { data: null, error: { code: 'PGRST116' } };
    return {};
  });

  const req = mockReq({ params: { eventId: EVENT }, user: { id: 'owner-1' } });
  let nextCalled = false;
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  await requireCheckinApp(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'EVENT_NOT_FOUND');
});

test('a device lookup that fails grandfathers rather than stranding a door', async () => {
  // This branch exists to keep a working door working. An unanswerable question
  // about it must not be the thing that closes it.
  mock.setResolver((s) => {
    if (s.table === 'events') return { data: { ...PAID, tier_key: 'basic', tier_name: 'Basic' } };
    if (s.table === 'event_devices') return { error: { message: 'relation does not exist' } };
    return {};
  });

  const req = mockReq({ params: { eventId: EVENT }, user: { id: 'owner-1' } });
  let nextCalled = false;
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  await requireCheckinApp(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});
