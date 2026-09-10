require('./helpers/env');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

/* ═══════════════════════════════════════════════════════════════════════════
   REALTIME BROADCASTS ARE GATED, AND THE GATE DEFAULTS TO OFF.

   The project's Realtime service was disabled on 2026-09-10 on four independent
   pieces of evidence: an empty `supabase_realtime` publication, no replication
   slots, "Realtime Concurrent Peak Connections" reading 0 across a full billing
   month, and no `.channel()` or `postgres_changes` anywhere in the front end.

   Nothing subscribes, so every broadcast was a doomed HTTP round trip that
   logged `realtime broadcast non-OK` on the check-in and RSVP paths. An error
   you expect on the happy path is an error you stop reading — the same failure
   that made the 2026-09-03 outage logs hard to search.

   What is pinned here is the SIDE-EFFECT, not the return value: broadcast()
   resolves to undefined either way and always has, so asserting on its result
   would pass whether or not the gate works. The only observable difference is
   whether a request leaves the process.
   ═══════════════════════════════════════════════════════════════════════════ */

const realFetch = global.fetch;
let calls = [];

beforeEach(() => {
  calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200 };
  };
  // The module reads process.env on every call, so a fresh require is not needed
  // between cases — but the env must be restored, see afterEach.
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

afterEach(() => {
  global.fetch = realFetch;
  delete process.env.REALTIME_BROADCAST_ENABLED;
});

const { broadcast } = require('../utils/realtime');

test('makes NO request when the flag is unset — this is the default', async () => {
  delete process.env.REALTIME_BROADCAST_ENABLED;
  await broadcast('evt-1', 'rsvp_submitted', { partyId: 'p1' });
  assert.equal(calls.length, 0, 'a broadcast was sent while Realtime is disabled');
});

test('makes NO request for any value other than the literal "true"', async () => {
  for (const v of ['false', '1', 'yes', 'TRUE', '']) {
    process.env.REALTIME_BROADCAST_ENABLED = v;
    await broadcast('evt-1', 'x', {});
    assert.equal(calls.length, 0, `"${v}" must not enable broadcasts`);
  }
});

test('sends when explicitly enabled — the gate is not a permanent off switch', async () => {
  process.env.REALTIME_BROADCAST_ENABLED = 'true';
  await broadcast('evt-9', 'checkin_update', { partyId: 'p2' });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/realtime\/v1\/api\/broadcast$/);

  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.messages[0].topic, 'event-evt-9');
  assert.equal(body.messages[0].event, 'checkin_update');
});

test('still never throws, so a call site can keep firing and forgetting', async () => {
  process.env.REALTIME_BROADCAST_ENABLED = 'true';
  global.fetch = async () => { throw new Error('network down'); };
  // Every one of the twelve call sites invokes this WITHOUT await. If it could
  // reject, that would be an unhandled rejection on the guest RSVP path.
  await assert.doesNotReject(() => broadcast('evt-1', 'x', {}));
});
