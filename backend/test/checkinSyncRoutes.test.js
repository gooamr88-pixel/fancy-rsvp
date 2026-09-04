/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FIRST TEST IN THIS REPOSITORY THAT ACTUALLY GOES THROUGH EXPRESS.
 *
 * Every other test here calls a controller, a service or one middleware
 * directly. That is fast and it is where most logic lives — but it cannot see
 * anything that happens BETWEEN the layers, and one such thing disabled
 * two-device undo for every event on the platform:
 *
 *   `router.param('clientCheckinId', uuidParam(...))` answered 400 to every
 *   reference a tablet actually sends, so `checkinSyncService.undoCheckIn` —
 *   rewritten specifically to accept those references and resolve them by
 *   server id — was unreachable. The service's own tests passed. The
 *   controller's own tests passed. `npm test` was green the whole time.
 *
 * A `router.param` guard is only reachable through a real router (`uuidParam`
 * is module-private), and its ordering relative to route middleware is Express
 * behaviour, not ours. So this file mounts the REAL router on a real Express
 * app and drives it over real HTTP.
 *
 * No new dependency: `express` is already a runtime dependency, `http` is
 * built in, and Node 22 ships `fetch`. The server binds port 0 (kernel-assigned)
 * so parallel test files cannot collide.
 *
 * WHAT BELONGS HERE: anything whose correctness depends on the routing layer —
 * param guards, middleware order, mount paths, status codes as the client sees
 * them. Business logic stays in the direct-invocation tests, which are faster.
 * ─────────────────────────────────────────────────────────────────────────────
 */
require('./helpers/env');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createMockSupabase } = require('./helpers/mockSupabase');
const { injectModule } = require('./helpers/inject');

const EVENT = '3f2a1b4c-5d6e-4f70-8912-abcdefabcdef';
const SERVER_ID = '9c8b7a65-4d3e-4f21-9876-fedcbafedcba';
const CLIENT_ID = '11112222-3333-4444-5555-666677778888';
const GUEST = 'aaaabbbb-cccc-4ddd-8eee-ffff00001111';
const STAFF = '22223333-4444-4555-8666-777788889999';

// ── Doubles, installed BEFORE the router (and its controllers) are required ──

injectModule('../../utils/logger', {
  info() {}, warn() {}, error() {}, debug() {}, fatal() {}, trace() {},
});

const broadcasts = [];
injectModule('../../utils/realtime', {
  broadcast: async (eventId, event, payload) => { broadcasts.push({ eventId, event, payload }); },
});

const mock = createMockSupabase();
injectModule('../../config/supabase', { supabase: mock.supabase });

/*
 * A paired tablet. `requireDevice` pins req.params.eventId to the device's own
 * event, so this event_id must match the one in the URL or the request is
 * refused with DEVICE_EVENT_MISMATCH before it reaches the handler.
 *
 * `authorizeStaff` stands in for the roster check — the undo handler requires a
 * supervisor, and resolving that against a real roster is checkinDevice's job
 * and is covered by its own tests.
 */
injectModule('../../services/checkinDeviceService', {
  resolveDeviceToken: async () => ({
    ok: true,
    device: { id: 'device-1', event_id: EVENT, device_label: 'Gate A' },
  }),
  recordDeviceHeartbeat: async () => {},
  authorizeStaff: async () => ({ ok: true, staff: { staffId: STAFF, displayName: 'Nadia' } }),
});

const express = require('express');
const checkinSyncRoutes = require('../routes/checkinSyncRoutes');

// ── The server ──

let server;
let base;

before(async () => {
  const app = express();
  // Mirrors app.js: the DELETE carries a mandatory JSON body (the undo reason).
  app.use(express.json());
  app.use('/api/v1/checkin', checkinSyncRoutes);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1/checkin`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  mock.reset();
  broadcasts.length = 0;
});

/** Records every RPC the request reaches, and answers it as a successful undo. */
function resolveUndoRpc(rpcCalls) {
  mock.setResolver((s) => {
    if (s.op === 'rpc') {
      rpcCalls.push({ fn: s.fn, params: s.params });
      return { data: { ok: true, server_id: SERVER_ID, guest_id: GUEST, server_seq: 42 } };
    }
    return {};
  });
}

/**
 * The reference is NOT url-encoded, deliberately: Retrofit's @Path leaves `:`
 * alone (it is not in OkHttp's PATH_SEGMENT_ENCODE_SET), so this is byte for
 * byte what a tablet puts on the wire.
 */
const undo = (reference, body = {}) => fetch(
  `${base}/events/${EVENT}/check-ins/${reference}`,
  {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: 'Device tok' },
    body: JSON.stringify({ reason: 'checked in by mistake', ...body }),
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// The references a tablet actually sends
// ═══════════════════════════════════════════════════════════════════════════

/*
 * A `remote:` key names an arrival ANOTHER gate recorded. It is the single most
 * common thing a supervisor reverses at a two-tablet event, and it is what the
 * uuid guard rejected.
 */
test('an arrival from another gate (remote:) reaches the handler and is reversed', async () => {
  const rpcCalls = [];
  resolveUndoRpc(rpcCalls);

  const res = await undo(`remote:${SERVER_ID}`, { staffId: STAFF, serverId: SERVER_ID });

  assert.equal(res.status, 200, 'the uuid guard used to answer 400 here');
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.data.serverId, SERVER_ID);

  // Resolved by SERVER id — the only reference both devices agree on.
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].fn, 'checkin_undo_by_ref');
  assert.equal(rpcCalls[0].params.p_server_id, SERVER_ID);
  assert.equal(rpcCalls[0].params.p_client_checkin_id, null, 'remote: is not a uuid and must not be cast as one');
});

/*
 * A `seed:` key names an arrival recorded BEFORE this tablet was prepared —
 * every web-desk check-in, and everything from a previous device.
 */
test('an arrival seeded at preparation (seed:) reaches the handler and is reversed', async () => {
  const rpcCalls = [];
  resolveUndoRpc(rpcCalls);

  const res = await undo(`seed:${EVENT}:${GUEST}`, { staffId: STAFF, serverId: SERVER_ID });

  assert.equal(res.status, 200);
  assert.equal(rpcCalls[0].params.p_server_id, SERVER_ID);
  assert.equal(rpcCalls[0].params.p_client_checkin_id, null);
});

/*
 * Guards against a future Retrofit/OkHttp change that starts percent-encoding
 * the colon. Express decodes the segment before the param callback sees it, so
 * both spellings must behave identically — and if that ever stops being true,
 * it fails here rather than at a door.
 */
test('a percent-encoded reference behaves identically to a raw one', async () => {
  const rpcCalls = [];
  resolveUndoRpc(rpcCalls);

  const res = await undo(encodeURIComponent(`remote:${SERVER_ID}`), { staffId: STAFF, serverId: SERVER_ID });

  assert.equal(res.status, 200);
  assert.equal(rpcCalls.length, 1);
});

test('a tablet reversing its OWN check-in still resolves by client id', async () => {
  const rpcCalls = [];
  resolveUndoRpc(rpcCalls);

  const res = await undo(CLIENT_ID, { staffId: STAFF });

  assert.equal(res.status, 200);
  assert.equal(rpcCalls[0].fn, 'checkin_undo', 'no server id was sent, so the original function applies');
  assert.equal(rpcCalls[0].params.p_client_checkin_id, CLIENT_ID);
});

// ═══════════════════════════════════════════════════════════════════════════
// The contract the device's failure handling is built on
// ═══════════════════════════════════════════════════════════════════════════

/*
 * With neither a usable client id nor a server id there is no row to name.
 *
 * 404 specifically, and not 400 or 500: `SyncRepository.drainUndos` treats 404
 * as "this reversal can never be applied", takes its optimistic local mark back
 * and drops the queue entry. A 400 leaves the tablet asserting a reversal the
 * server refused; a 500 makes it retry forever. This status IS the contract.
 */
test('an unresolvable reference is a 404, which is what the device is built to handle', async () => {
  mock.setResolver(() => ({}));

  const res = await undo('remote:not-a-uuid-at-all', { staffId: STAFF });

  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, 'NOT_FOUND');
  assert.equal(mock.calls.length, 0, 'nothing unresolvable should ever reach the database');
});

test('a reversal with no reason is refused before any database work', async () => {
  mock.setResolver(() => ({}));

  const res = await fetch(`${base}/events/${EVENT}/check-ins/remote:${SERVER_ID}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: 'Device tok' },
    body: JSON.stringify({ staffId: STAFF }),
  });

  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'REASON_REQUIRED');
  assert.equal(mock.calls.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// The guards that must stay
// ═══════════════════════════════════════════════════════════════════════════

/*
 * Relaxing the check-in reference must not relax the EVENT id. It is a uuid on
 * every path that carries it, it is cast to uuid in Postgres, and an
 * unvalidated value there is the `22P02` crash the guards exist to prevent.
 */
test('a malformed eventId is still refused, before the handler runs', async () => {
  mock.setResolver(() => ({}));

  const res = await fetch(`${base}/events/not-a-uuid/check-ins/${CLIENT_ID}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: 'Device tok' },
    body: JSON.stringify({ reason: 'x', staffId: STAFF }),
  });

  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'INVALID_PARAM');
  assert.equal(mock.calls.length, 0);
});

test('an absurdly long reference is refused rather than forwarded', async () => {
  mock.setResolver(() => ({}));

  const res = await undo(`remote:${'a'.repeat(500)}`, { staffId: STAFF });

  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'INVALID_PARAM');
  assert.equal(mock.calls.length, 0);
});

/*
 * The param guards run in path order and BEFORE route middleware, so a bad
 * eventId is rejected without ever consulting device auth. Asserting it here
 * pins Express's ordering, which the security model quietly assumes.
 */
test('param guards run before authentication, so a bad id never reaches auth', async () => {
  mock.setResolver(() => ({}));

  const res = await fetch(`${base}/events/nope/check-ins/${CLIENT_ID}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' }, // no Authorization at all
    body: JSON.stringify({ reason: 'x' }),
  });

  assert.equal(res.status, 400, 'a 401 here would mean the guard ran too late');
  assert.equal((await res.json()).error, 'INVALID_PARAM');
});
