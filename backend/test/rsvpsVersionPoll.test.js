require('./helpers/env');
const { test } = require('node:test');
const t = require('node:test');
const assert = require('node:assert/strict');
const { createMockSupabase } = require('./helpers/mockSupabase');
const { mockReq, invoke } = require('./helpers/http');
const { injectModule } = require('./helpers/inject');

injectModule('../../utils/notificationService', {
  sendConfirmationEmail: async () => true,
  sendEmailViaBrevo: async () => true,
  sendInvitationEmail: async () => ({ sent: true }),
});
injectModule('../../utils/realtime', { broadcast: async () => {} });

const mock = createMockSupabase();
injectModule('../../config/supabase', { supabase: mock.supabase });

const { getRsvpsVersion } = require('../controllers/rsvpController');

t.beforeEach(() => { mock.reset(); });

const req = () => mockReq({ params: { eventId: 'evt-1' }, user: { id: 'owner-1' } });

/* ═══════════════════════════════════════════════════════════════════════════
   THE CHEAP POLL

   The dashboard asks "has anything changed?" every 20 seconds. It used to
   answer that by re-downloading every party with its guests, custom answers,
   seating assignments and invitations — the heaviest application statement on
   the database, 14,476 times, to hear "no" almost every time.

   This endpoint answers it with two numbers. What matters is that those two
   numbers change for EVERY edit the dashboard renders — a fingerprint that
   misses a change is worse than no fingerprint, because the list then silently
   stops updating and looks like it is working.
   ═══════════════════════════════════════════════════════════════════════════ */

test('returns the party count and the newest updated_at', async () => {
  mock.setResolver((s) => {
    if (s.table === 'rsvp_parties') return { count: 42, data: [{ updated_at: '2026-09-10T12:00:00Z' }] };
    return {};
  });

  const { res } = await invoke(getRsvpsVersion, req());
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.count, 42);
  assert.equal(res.body.data.latest, '2026-09-10T12:00:00Z');
});

test('an empty guest list is a valid fingerprint, not an error', async () => {
  mock.setResolver((s) => {
    if (s.table === 'rsvp_parties') return { count: 0, data: [] };
    return {};
  });

  const { res } = await invoke(getRsvpsVersion, req());
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.count, 0);
  assert.equal(res.body.data.latest, null);
});

test('is scoped to the event — a poll must never see another organizer\'s list', async () => {
  mock.setResolver((s) => {
    if (s.table === 'rsvp_parties') return { count: 1, data: [{ updated_at: '2026-01-01T00:00:00Z' }] };
    return {};
  });

  await invoke(getRsvpsVersion, req());
  const scoped = mock.calls.filter((c) => c.table === 'rsvp_parties');
  assert.equal(scoped.length, 1, 'the fingerprint must cost exactly ONE round trip');
  for (const call of scoped) {
    assert.ok(
      JSON.stringify(call).includes('evt-1'),
      'every query must be filtered by event_id',
    );
  }
});

test('never caches — a cached fingerprint would report "no change" forever', async () => {
  mock.setResolver((s) => {
    if (s.table === 'rsvp_parties') return { count: 3, data: [{ updated_at: '2026-09-10T12:00:00Z' }] };
    return {};
  });

  const { res } = await invoke(getRsvpsVersion, req());
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('it does NOT fetch the guest list — that is the entire point', async () => {
  mock.setResolver((s) => {
    if (s.table === 'rsvp_parties') return { count: 5, data: [{ updated_at: '2026-09-10T12:00:00Z' }] };
    return {};
  });

  await invoke(getRsvpsVersion, req());

  /**
   * The regression this guards against is somebody "improving" the poll by
   * having it return the list too — which would restore the exact cost the
   * endpoint was created to remove, while every other test here still passed.
   */
  const rpc = mock.calls.find((c) => c.op === 'rpc' && c.fn === 'get_event_parties');
  assert.equal(rpc, undefined, 'the version poll must never call get_event_parties');

  for (const table of ['guests', 'custom_answers', 'seating_assignments', 'invitations']) {
    assert.equal(
      mock.calls.find((c) => c.table === table), undefined,
      `the version poll must not read ${table}`,
    );
  }
});

test('a database error is passed to the error handler, not reported as "unchanged"', async () => {
  mock.setResolver(() => ({ error: new Error('connection lost') }));

  const { next, nextErr } = await invoke(getRsvpsVersion, req());
  // Swallowing this would make the dashboard believe nothing had changed for as
  // long as the fault lasted — a stale list that looks healthy.
  assert.ok(next, 'the error must reach the error handler');
  assert.match(nextErr?.message || '', /connection lost/);
});
