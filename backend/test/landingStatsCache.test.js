/**
 * GET /public/landing-stats runs `count: 'exact'` — a bare `SELECT count(*)` —
 * over `events` and over `guests`.
 *
 * PostgreSQL has no O(1) row count, so both are full scans, and `guests` is the
 * table that gains a row for every person on every guest list ever imported.
 * This endpoint backs the marketing home page, so uncached, every visit, every
 * crawl and every uptime probe paid for two sequential scans whose cost grows
 * with the size of the business — to produce a rounded vanity counter that
 * changes by a rounding error from one minute to the next.
 *
 * The `Cache-Control: max-age=30` on the response is not a substitute: it is
 * advice to one browser, and it does nothing for a first-time visitor, a bot,
 * or a Next.js server render. That header is why this looked cached and was not.
 */
require('./helpers/env');
const { test } = require('node:test');
const t = require('node:test');
const assert = require('node:assert/strict');
const { createMockSupabase } = require('./helpers/mockSupabase');
const { mockReq, invoke } = require('./helpers/http');
const { injectModule } = require('./helpers/inject');

const mock = createMockSupabase();
injectModule('../../config/supabase', { supabase: mock.supabase });

const LANDING_STATS = [
  { label: 'Events hosted', target: 1, source: 'events_count' },
  { label: 'Guests welcomed', target: 1, source: 'guests_count' },
  { label: 'Uptime', target: 99.9 },
];
let configThrows = false;
injectModule('../../utils/configCache', {
  getPlatformConfig: async () => {
    if (configThrows) throw new Error('database unreachable');
    return { landing_stats: LANDING_STATS };
  },
  invalidate: () => {},
  CONFIG_ID: '00000000-0000-0000-0000-000000000000',
  TTL_MS: 30000,
});

const landingCounts = require('../utils/landingCounts');
const publicRoutes = require('../routes/publicRoutes');

/** The last handler Express would run for GET /public/landing-stats. */
const handler = (() => {
  const layer = publicRoutes.stack.find((l) => l.route && l.route.path === '/landing-stats');
  assert.ok(layer, 'GET /landing-stats is no longer mounted on publicRoutes');
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
})();

const countReads = (table) => mock.calls.filter((c) => c.table === table && c.op === 'select').length;

t.beforeEach(() => {
  mock.reset();
  configThrows = false;
  landingCounts.invalidate();
  mock.setResolver((s) => {
    if (s.table === 'events') return { count: 412 };
    if (s.table === 'guests') return { count: 58231 };
    return {};
  });
});

/* ── The cache itself ─────────────────────────────────────────────────────── */

test('the two count(*) scans run once and are then served from memory', async () => {
  const want = { needsEvents: true, needsGuests: true };

  const first = await landingCounts.getLandingCounts(want);
  assert.deepEqual({ events: first.events, guests: first.guests }, { events: 412, guests: 58231 });
  assert.equal(countReads('events'), 1);
  assert.equal(countReads('guests'), 1);

  for (let i = 0; i < 50; i += 1) await landingCounts.getLandingCounts(want);

  assert.equal(countReads('events'), 1, '51 calls must scan `events` once');
  assert.equal(countReads('guests'), 1, '51 calls must scan `guests` once');
});

test('a counter no stat asks for is never scanned at all', async () => {
  await landingCounts.getLandingCounts({ needsEvents: true, needsGuests: false });
  assert.equal(countReads('events'), 1);
  assert.equal(countReads('guests'), 0);
});

test('a failed count keeps the last good figure rather than blanking it', async () => {
  const want = { needsEvents: true, needsGuests: true };
  await landingCounts.getLandingCounts(want);

  // Expire the cache the way five minutes would, then fail the way a database
  // under load actually fails.
  landingCounts.invalidate();
  mock.setResolver((s) => {
    if (s.table === 'events') return { count: 500 };
    if (s.table === 'guests') return { error: { message: 'canceling statement due to statement timeout' } };
    return {};
  });

  const after = await landingCounts.getLandingCounts(want);
  assert.equal(after.events, 500, 'the counter that succeeded moves');
  assert.equal(after.guests, 58231, 'the counter that failed keeps its last good value');
});

test('a failed count still re-arms the TTL, so a struggling database is not re-scanned per request', async () => {
  const want = { needsEvents: true, needsGuests: true };
  landingCounts.invalidate();
  mock.setResolver(() => ({ error: { message: 'too many connections' } }));

  await landingCounts.getLandingCounts(want);
  const afterFirst = mock.calls.length;
  for (let i = 0; i < 20; i += 1) await landingCounts.getLandingCounts(want);

  assert.equal(
    mock.calls.length,
    afterFirst,
    'a failure must not turn every subsequent request into another pair of full scans',
  );
});

/* ── The route that uses it ───────────────────────────────────────────────── */

test('the route serves the live counts over the admin-typed targets', async () => {
  const { res } = await invoke(handler, mockReq());
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.stats[0].target, 412);
  assert.equal(res.body.stats[1].target, 58231);
  // An entry with no `source` is genuinely unmeasurable and stays admin-set.
  assert.equal(res.body.stats[2].target, 99.9);
});

test('repeat requests to the route do not re-scan', async () => {
  await invoke(handler, mockReq());
  const afterFirst = mock.calls.length;
  assert.equal(afterFirst, 2, 'the first request pays for both counts');

  for (let i = 0; i < 25; i += 1) await invoke(handler, mockReq());
  assert.equal(mock.calls.length, afterFirst, '26 requests must issue two counts, not 52');
});

test('a config read that throws answers 200 with no stats rather than a 500', async () => {
  // The marketing home page must render without these; a hard failure here
  // would take the landing page down over a counter.
  configThrows = true;
  const { res } = await invoke(handler, mockReq());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: false, stats: [] });
});
