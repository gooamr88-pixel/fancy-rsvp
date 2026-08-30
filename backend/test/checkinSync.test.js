require('./helpers/env');
const { test } = require('node:test');
const t = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createMockSupabase, eqVal } = require('./helpers/mockSupabase');
const { mockReq, invoke } = require('./helpers/http');
const { injectModule } = require('./helpers/inject');

const broadcasts = [];
injectModule('../../utils/realtime', {
  broadcast: async (eventId, event, payload) => { broadcasts.push({ eventId, event, payload }); },
});

const mock = createMockSupabase();
injectModule('../../config/supabase', { supabase: mock.supabase });

const svc = require('../services/checkinSyncService');
const ctrl = require('../controllers/checkinSyncController');
const { signQrTicket } = require('../services/tokenService');

const EVENT = '11111111-1111-4111-8111-111111111111';
const GUEST = '22222222-2222-4222-8222-222222222222';
const PARTY = '33333333-3333-4333-8333-333333333333';
const CID   = '44444444-4444-4444-8444-444444444444';

t.beforeEach(() => { mock.reset(); broadcasts.length = 0; });

// ══════════════════════════════════════════════════════════════════
// Undo — which id the server is asked to resolve
//
// A device holds identifiers that are NOT uuids for every arrival it did not
// create itself: `seed:<eventId>:<guestId>` for those already recorded when it
// was prepared, `remote:<serverId>` for another gate's. It sends its local key
// in the URL. Both RPC parameters are declared `uuid`, and Postgres casts the
// argument BEFORE the function body runs — so passing one of those through
// raises 22P02, reaches the device as a 500, and is retried forever.
// ══════════════════════════════════════════════════════════════════

const SERVER_ID = '55555555-5555-4555-8555-555555555555';
const rpcCalls = [];
const captureRpc = (result = { ok: true, server_id: SERVER_ID }) => (s) => {
  if (s.op === 'rpc') { rpcCalls.push({ fn: s.fn, params: s.params }); return { data: result }; }
  return {};
};

test('a non-uuid client id NEVER reaches Postgres — it would raise 22P02 before the function runs', async () => {
  rpcCalls.length = 0;
  mock.setResolver(captureRpc());

  const result = await svc.undoCheckIn(EVENT, `seed:${EVENT}:${GUEST}`, {
    actorId: null, reason: 'wrong guest', serverId: SERVER_ID,
  });

  assert.equal(result.ok, true);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].fn, 'checkin_undo_by_ref');
  // The invented key is dropped, and the server id carries the request.
  assert.equal(rpcCalls[0].params.p_client_checkin_id, null);
  assert.equal(rpcCalls[0].params.p_server_id, SERVER_ID);
});

test('with no server id and an unresolvable client id, it answers NOT_FOUND without touching the database', async () => {
  rpcCalls.length = 0;
  mock.setResolver(captureRpc());

  const result = await svc.undoCheckIn(EVENT, `remote:${SERVER_ID}`, {
    actorId: null, reason: 'wrong guest',
  });

  // 404 rather than 500: the device takes its local mark back and drops the
  // entry, instead of retrying a request that can never succeed.
  assert.deepEqual(result, { ok: false, error: 'NOT_FOUND' });
  assert.equal(rpcCalls.length, 0, 'must not call the database at all');
});

/**
 * The device sends the server id whenever it has one — including for its OWN
 * check-ins once they have synced. So between an app update and this migration
 * being applied, EVERY undo would land on a function that does not exist. This
 * repository has shipped unapplied migrations more than once, so the fallback is
 * not hypothetical.
 */
test('an unapplied migration falls back to the original function instead of 500ing', async () => {
  rpcCalls.length = 0;
  mock.setResolver((s) => {
    if (s.op !== 'rpc') return {};
    rpcCalls.push({ fn: s.fn, params: s.params });
    if (s.fn === 'checkin_undo_by_ref') {
      return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    }
    return { data: { ok: true, server_id: SERVER_ID } };
  });

  const result = await svc.undoCheckIn(EVENT, CID, {
    actorId: null, reason: 'wrong guest', serverId: SERVER_ID,
  });

  assert.equal(result.ok, true, 'an undo that worked before must keep working');
  assert.deepEqual(rpcCalls.map((c) => c.fn), ['checkin_undo_by_ref', 'checkin_undo']);
});

test('with no usable client id, an unapplied migration answers NOT_FOUND rather than retrying forever', async () => {
  rpcCalls.length = 0;
  mock.setResolver((s) => {
    if (s.op !== 'rpc') return {};
    rpcCalls.push({ fn: s.fn });
    return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
  });

  const result = await svc.undoCheckIn(EVENT, `seed:${EVENT}:${GUEST}`, {
    actorId: null, reason: 'wrong guest', serverId: SERVER_ID,
  });

  assert.deepEqual(result, { ok: false, error: 'NOT_FOUND' });
  assert.deepEqual(rpcCalls.map((c) => c.fn), ['checkin_undo_by_ref']);
});

test('a real client id with no server id still uses the original function', async () => {
  rpcCalls.length = 0;
  mock.setResolver(captureRpc());

  await svc.undoCheckIn(EVENT, CID, { actorId: null, reason: 'wrong guest' });

  // Unchanged for every existing caller, so an unapplied migration cannot break
  // undos that already worked.
  assert.equal(rpcCalls[0].fn, 'checkin_undo');
  assert.equal(rpcCalls[0].params.p_client_checkin_id, CID);
});

// ══════════════════════════════════════════════════════════════════
// Scanned-token handling — the ONLY place a forged scan can be caught
// (decision D-20 removed on-device verification; amendment A-11)
// ══════════════════════════════════════════════════════════════════

test('extractTicketToken pulls the JWT out of a /ticket/<token> URL', () => {
  const token = signQrTicket({ partyId: PARTY, eventId: EVENT });
  assert.equal(svc.extractTicketToken(`https://fancyrsvp.com/ticket/${encodeURIComponent(token)}`), token);
});

test('extractTicketToken accepts a bare token — older emailed tickets are bare', () => {
  const token = signQrTicket({ partyId: PARTY, eventId: EVENT });
  assert.equal(svc.extractTicketToken(token), token);
});

test('extractTicketToken ignores query and fragment after the token', () => {
  const token = signQrTicket({ partyId: PARTY, eventId: EVENT });
  assert.equal(svc.extractTicketToken(`https://x.com/ticket/${token}?utm=1#frag`), token);
});

test('a genuine ticket for this event and party verifies', () => {
  const token = signQrTicket({ partyId: PARTY, eventId: EVENT });
  const { fingerprint, verified } = svc.verifyScanToken(token, { eventId: EVENT, partyId: PARTY });
  assert.equal(verified, true);
  assert.equal(fingerprint.length, 64);
});

test('a genuine ticket for a DIFFERENT event does not verify', () => {
  const token = signQrTicket({ partyId: PARTY, eventId: 'other-event' });
  const { verified } = svc.verifyScanToken(token, { eventId: EVENT, partyId: PARTY });
  assert.equal(verified, false);
});

test('a genuine ticket for a different PARTY does not verify — one ticket must not admit everyone', () => {
  const token = signQrTicket({ partyId: 'some-other-party', eventId: EVENT });
  const { verified } = svc.verifyScanToken(token, { eventId: EVENT, partyId: PARTY });
  assert.equal(verified, false);
});

test('a tampered token does not verify but is still fingerprinted for the anomaly report', () => {
  const { fingerprint, verified } = svc.verifyScanToken('not.a.jwt', { eventId: EVENT, partyId: PARTY });
  assert.equal(verified, false);
  assert.equal(fingerprint, crypto.createHash('sha256').update('not.a.jwt').digest('hex'));
});

test('no token presented yields a null verdict, not a failure — manual/group/override', () => {
  const { fingerprint, verified } = svc.verifyScanToken(null, { eventId: EVENT, partyId: PARTY });
  assert.equal(verified, null);
  assert.equal(fingerprint, null);
});

test('the raw token never reaches the database — only its fingerprint', async () => {
  const token = signQrTicket({ partyId: PARTY, eventId: EVENT });
  let rpcParams = null;
  mock.setResolver((s) => {
    if (s.table === 'guests' && s.op === 'select') return { data: [{ id: GUEST, party_id: PARTY }] };
    if (s.op === 'rpc') { rpcParams = s.params; return { data: { ok: true, results: [], summary: {}, max_seq: 1 } }; }
    return {};
  });

  await svc.submitCheckInBatch(EVENT, [{ client_checkin_id: CID, guest_id: GUEST, scan_token: token }]);

  const sent = JSON.stringify(rpcParams);
  assert.ok(!sent.includes(token), 'raw scan token must not be sent to the database');
  assert.equal(rpcParams.p_records[0].token_verified, true);
  assert.equal(rpcParams.p_records[0].scan_token_fingerprint.length, 64);
});

// ══════════════════════════════════════════════════════════════════
// Bundle integrity (§21.1) — a 60%-downloaded bundle must be detectable
// ══════════════════════════════════════════════════════════════════

test('the content hash is independent of row order', () => {
  const a = [{ id: 'b', partyId: 'p', fullName: 'B' }, { id: 'a', partyId: 'p', fullName: 'A' }];
  const b = [{ id: 'a', partyId: 'p', fullName: 'A' }, { id: 'b', partyId: 'p', fullName: 'B' }];
  assert.equal(svc.canonicalizeGuests(a), svc.canonicalizeGuests(b));
});

test('the content hash changes when a guest is missing — the whole point of it', () => {
  const full = [{ id: 'a', partyId: 'p', fullName: 'A' }, { id: 'b', partyId: 'p', fullName: 'B' }];
  const truncated = [{ id: 'a', partyId: 'p', fullName: 'A' }];
  assert.notEqual(svc.canonicalizeGuests(full), svc.canonicalizeGuests(truncated));
});

test('the content hash changes when a table assignment changes', () => {
  const before = [{ id: 'a', partyId: 'p', fullName: 'A', tableName: 'Table 1' }];
  const after = [{ id: 'a', partyId: 'p', fullName: 'A', tableName: 'Table 9' }];
  assert.notEqual(svc.canonicalizeGuests(before), svc.canonicalizeGuests(after));
});

// ══════════════════════════════════════════════════════════════════
// Batch endpoint contract
// ══════════════════════════════════════════════════════════════════

test('a non-array records field is rejected (400) before any DB work', async () => {
  mock.setResolver(() => ({}));
  const { res } = await invoke(ctrl.postCheckInBatch,
    mockReq({ params: { eventId: EVENT }, body: { records: 'nope' }, user: { id: 'u1' } }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'VALIDATION_ERROR');
  assert.equal(mock.calls.length, 0);
});

test('an empty batch succeeds without touching the database', async () => {
  mock.setResolver(() => ({}));
  const { res } = await invoke(ctrl.postCheckInBatch,
    mockReq({ params: { eventId: EVENT }, body: { records: [] }, user: { id: 'u1' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.summary.accepted, 0);
  assert.equal(mock.calls.length, 0);
});

test('an oversized batch is capped (413) and told the limit, so the device can split', async () => {
  mock.setResolver(() => ({}));
  const records = Array.from({ length: svc.MAX_BATCH + 1 }, () => ({ client_checkin_id: CID, guest_id: GUEST }));
  const { res } = await invoke(ctrl.postCheckInBatch,
    mockReq({ params: { eventId: EVENT }, body: { records }, user: { id: 'u1' } }));
  assert.equal(res.statusCode, 413);
  assert.equal(res.body.error, 'BATCH_TOO_LARGE');
  assert.equal(res.body.meta.max_batch, svc.MAX_BATCH);
});

test('per-element outcomes are passed through verbatim — a partial conflict must not lose the successes', async () => {
  mock.setResolver((s) => {
    if (s.table === 'guests' && s.op === 'select') return { data: [{ id: GUEST, party_id: PARTY }] };
    if (s.op === 'rpc') {
      return { data: {
        ok: true,
        results: [
          { client_checkin_id: CID, guest_id: GUEST, status: 'accepted', server_id: 'srv-1', server_seq: 4 },
          { client_checkin_id: 'c2', guest_id: 'g2', status: 'conflict', server_id: 'srv-0' },
          { client_checkin_id: 'c3', guest_id: 'g3', status: 'duplicate', server_id: 'srv-x' },
          { client_checkin_id: 'c4', status: 'rejected', reason: 'GUEST_NOT_IN_EVENT' },
        ],
        summary: { accepted: 1, duplicate: 1, conflict: 1, rejected: 1 },
        max_seq: 4,
      } };
    }
    return {};
  });

  const { res } = await invoke(ctrl.postCheckInBatch, mockReq({
    params: { eventId: EVENT },
    body: { records: [{ client_checkin_id: CID, guest_id: GUEST }] },
    user: { id: 'u1' },
  }));

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.results.length, 4);
  assert.deepEqual(res.body.data.summary, { accepted: 1, duplicate: 1, conflict: 1, rejected: 1 });
  // A rejected element is REPORTED, never silently dropped (§21.3).
  assert.equal(res.body.data.results[3].status, 'rejected');
});

test('only accepted check-ins are broadcast, and the payload carries no guest names', async () => {
  mock.setResolver((s) => {
    if (s.table === 'guests' && s.op === 'select') return { data: [{ id: GUEST, party_id: PARTY }] };
    if (s.op === 'rpc') {
      return { data: {
        ok: true,
        results: [
          { client_checkin_id: CID, guest_id: GUEST, status: 'accepted', server_id: 'srv-1', server_seq: 1 },
          { client_checkin_id: 'c2', guest_id: 'g2', status: 'duplicate', server_id: 'srv-2' },
        ],
        summary: { accepted: 1, duplicate: 1, conflict: 0, rejected: 0 },
        max_seq: 1,
      } };
    }
    return {};
  });

  await invoke(ctrl.postCheckInBatch, mockReq({
    params: { eventId: EVENT },
    body: { records: [{ client_checkin_id: CID, guest_id: GUEST }] },
    user: { id: 'u1' },
  }));

  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].event, 'checkin_batch_synced');
  assert.deepEqual(broadcasts[0].payload.guestIds, [GUEST]);
  const wire = JSON.stringify(broadcasts[0].payload);
  assert.ok(!/name/i.test(wire), 'realtime payload must not carry guest names (finding R-2)');
});

test('a fully-duplicate batch broadcasts nothing — the other devices already know', async () => {
  mock.setResolver((s) => {
    if (s.table === 'guests' && s.op === 'select') return { data: [{ id: GUEST, party_id: PARTY }] };
    if (s.op === 'rpc') {
      return { data: {
        ok: true,
        results: [{ client_checkin_id: CID, guest_id: GUEST, status: 'duplicate', server_id: 'srv-1' }],
        summary: { accepted: 0, duplicate: 1, conflict: 0, rejected: 0 },
        max_seq: 1,
      } };
    }
    return {};
  });

  await invoke(ctrl.postCheckInBatch, mockReq({
    params: { eventId: EVENT },
    body: { records: [{ client_checkin_id: CID, guest_id: GUEST }] },
    user: { id: 'u1' },
  }));

  assert.equal(broadcasts.length, 0);
});

test('every response carries the version metadata a field device needs (§21.4)', async () => {
  mock.setResolver(() => ({}));
  const { res } = await invoke(ctrl.postCheckInBatch,
    mockReq({ params: { eventId: EVENT }, body: { records: [] }, user: { id: 'u1' } }));
  assert.equal(res.body.meta.min_supported_app_version, ctrl.MIN_SUPPORTED_APP_VERSION);
  assert.equal(res.body.meta.api_contract_version, ctrl.API_CONTRACT_VERSION);
});

// ══════════════════════════════════════════════════════════════════
// Undo — soft delete, mandatory reason, audited (fixes finding R-1)
// ══════════════════════════════════════════════════════════════════

test('an undo without a reason is refused (400) before any DB work', async () => {
  mock.setResolver(() => ({}));
  const { res } = await invoke(ctrl.deleteCheckIn, mockReq({
    params: { eventId: EVENT, clientCheckinId: CID }, body: {}, user: { id: 'u1' },
  }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'REASON_REQUIRED');
  assert.equal(mock.calls.length, 0);
});

test('an undo with a whitespace-only reason is refused', async () => {
  mock.setResolver(() => ({}));
  const { res } = await invoke(ctrl.deleteCheckIn, mockReq({
    params: { eventId: EVENT, clientCheckinId: CID }, body: { reason: '   ' }, user: { id: 'u1' },
  }));
  assert.equal(res.statusCode, 400);
  assert.equal(mock.calls.length, 0);
});

test('an undo of an unknown check-in is 404', async () => {
  mock.setResolver((s) => {
    if (s.op === 'rpc') return { data: { ok: false, error: 'NOT_FOUND' } };
    return {};
  });
  const { res } = await invoke(ctrl.deleteCheckIn, mockReq({
    params: { eventId: EVENT, clientCheckinId: CID }, body: { reason: 'scanned twice' }, user: { id: 'u1' },
  }));
  assert.equal(res.statusCode, 404);
});

test('a successful undo writes an audit row and broadcasts', async () => {
  const audits = [];
  mock.setResolver((s) => {
    if (s.op === 'rpc') return { data: { ok: true, server_id: 'srv-1', guest_id: GUEST, server_seq: 9 } };
    if (s.table === 'activity_logs' && s.op === 'insert') { audits.push(s.payload); return {}; }
    return {};
  });

  const { res } = await invoke(ctrl.deleteCheckIn, mockReq({
    params: { eventId: EVENT, clientCheckinId: CID },
    body: { reason: 'checked in by mistake' },
    user: { id: 'supervisor-1' },
  }));

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.serverId, 'srv-1');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'checkin_undone');
  assert.equal(audits[0].metadata.reason, 'checked in by mistake');
  assert.equal(audits[0].actor_id, 'supervisor-1');
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].event, 'checkin_undone');
});

test('re-undoing an already-undone check-in succeeds without a second broadcast', async () => {
  mock.setResolver((s) => {
    if (s.op === 'rpc') return { data: { ok: true, already_undone: true, server_id: 'srv-1' } };
    return {};
  });
  const { res } = await invoke(ctrl.deleteCheckIn, mockReq({
    params: { eventId: EVENT, clientCheckinId: CID }, body: { reason: 'retry' }, user: { id: 'u1' },
  }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.alreadyUndone, true);
  assert.equal(broadcasts.length, 0);
});

// ══════════════════════════════════════════════════════════════════
// Undo authorization (§18.2)
//
// A device token proves a tablet is paired — nothing more. Every usher at the
// event is holding one, so it cannot be what authorizes a reversal. These tests
// pin the server-side role check; the Android `canUndo` gate is a convenience
// for the person at the door and is not reachable from here at all.
// ══════════════════════════════════════════════════════════════════

const SUPERVISOR = '66666666-6666-4666-8666-666666666666';
const USHER      = '77777777-7777-4777-8777-777777777777';

/** Roster resolver: two active staff, one of each role. */
function withRoster(extra) {
  return (s) => {
    if (s.table === 'event_staff' && s.op === 'select') {
      return { data: [
        { id: SUPERVISOR, display_name: 'Dana (supervisor)', role: 'supervisor' },
        { id: USHER, display_name: 'Sam (usher)', role: 'usher' },
      ] };
    }
    return extra ? extra(s) : {};
  };
}

test('a device undo naming a supervisor on the roster is allowed', async () => {
  const rpcArgs = [];
  mock.setResolver(withRoster((s) => {
    if (s.op === 'rpc') { rpcArgs.push(s.params); return { data: { ok: true, server_id: 'srv-1', guest_id: GUEST, server_seq: 9 } }; }
    return {};
  }));

  const { res } = await invoke(ctrl.deleteCheckIn, mockReq({
    params: { eventId: EVENT, clientCheckinId: CID },
    body: { reason: 'scanned the wrong guest', staffId: SUPERVISOR },
    device: { id: 'dev-1', eventId: EVENT, label: 'Main entrance' },
  }));

  assert.equal(res.statusCode, 200);
  // The name written to the audit trail comes from the roster, so a device
  // cannot pin a reversal on someone who did not perform it.
  assert.equal(rpcArgs[0].p_staff_id, SUPERVISOR);
  assert.equal(rpcArgs[0].p_staff_name, 'Dana (supervisor)');
  // No platform user is involved — the two actor columns stay distinct.
  assert.equal(rpcArgs[0].p_actor, null);
});

test('a device undo naming an USHER is refused — the role is checked on the server', async () => {
  let rpcCalled = false;
  mock.setResolver(withRoster((s) => {
    if (s.op === 'rpc') { rpcCalled = true; return { data: { ok: true } }; }
    return {};
  }));

  const { res } = await invoke(ctrl.deleteCheckIn, mockReq({
    params: { eventId: EVENT, clientCheckinId: CID },
    body: { reason: 'undo it', staffId: USHER },
    device: { id: 'dev-1', eventId: EVENT, label: 'Main entrance' },
  }));

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'SUPERVISOR_REQUIRED');
  assert.equal(rpcCalled, false, 'nothing may be reversed before the role is established');
});

test('a device undo with NO staff id is refused — a bare device token authorizes nothing', async () => {
  let rpcCalled = false;
  mock.setResolver(withRoster((s) => {
    if (s.op === 'rpc') { rpcCalled = true; return { data: { ok: true } }; }
    return {};
  }));

  const { res } = await invoke(ctrl.deleteCheckIn, mockReq({
    params: { eventId: EVENT, clientCheckinId: CID },
    body: { reason: 'undo it' },
    device: { id: 'dev-1', eventId: EVENT, label: 'Main entrance' },
  }));

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'UNKNOWN_STAFF');
  assert.equal(rpcCalled, false);
});

test('a device undo naming a staff id from ANOTHER event is refused', async () => {
  mock.setResolver(withRoster());

  const { res } = await invoke(ctrl.deleteCheckIn, mockReq({
    params: { eventId: EVENT, clientCheckinId: CID },
    body: { reason: 'undo it', staffId: '99999999-9999-4999-8999-999999999999' },
    device: { id: 'dev-1', eventId: EVENT, label: 'Main entrance' },
  }));

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'UNKNOWN_STAFF');
});

test('the roster query is scoped to ACTIVE staff and to this event', async () => {
  let rosterFilters = null;
  mock.setResolver((s) => {
    if (s.table === 'event_staff' && s.op === 'select') {
      rosterFilters = s.filters;
      return { data: [] };
    }
    return {};
  });

  await invoke(ctrl.deleteCheckIn, mockReq({
    params: { eventId: EVENT, clientCheckinId: CID },
    body: { reason: 'undo it', staffId: SUPERVISOR },
    device: { id: 'dev-1', eventId: EVENT, label: 'Main entrance' },
  }));

  // Without is_active, a supervisor removed from the roster mid-event keeps the
  // power to reverse admissions — deactivating them would change nothing.
  assert.equal(eqVal(rosterFilters, 'is_active'), true);
  // Without event_id, a supervisor on ANY event could authorize an undo here.
  assert.equal(eqVal(rosterFilters, 'event_id'), EVENT);
});

test('the organizer still undoes without a staff id — the event owner outranks the roster', async () => {
  mock.setResolver(withRoster((s) => {
    if (s.op === 'rpc') return { data: { ok: true, server_id: 'srv-1', guest_id: GUEST, server_seq: 9 } };
    return {};
  }));

  const { res } = await invoke(ctrl.deleteCheckIn, mockReq({
    params: { eventId: EVENT, clientCheckinId: CID },
    body: { reason: 'duplicate' },
    user: { id: 'organizer-1' },
  }));

  assert.equal(res.statusCode, 200);
});

// ══════════════════════════════════════════════════════════════════
// Attribution (§18.6) — server-resolved, never client-asserted
// ══════════════════════════════════════════════════════════════════

test('staff_display_name is taken from the roster, NOT from the payload', async () => {
  let sent = null;
  mock.setResolver(withRoster((s) => {
    if (s.table === 'guests' && s.op === 'select') return { data: [{ id: GUEST, party_id: PARTY }] };
    if (s.op === 'rpc') { sent = s.params; return { data: { results: [], max_seq: 1 } }; }
    return {};
  }));

  await svc.submitCheckInBatch(EVENT, [{
    client_checkin_id: CID,
    guest_id: GUEST,
    staff_id: USHER,
    // The forgery: a device claiming an admission was made by someone else.
    staff_display_name: 'Dana (supervisor)',
  }]);

  const record = (sent.p_records || [])[0];
  assert.equal(record.staff_display_name, 'Sam (usher)');
});

test('an unknown staff id drops the attribution but KEEPS the arrival', async () => {
  let sent = null;
  mock.setResolver(withRoster((s) => {
    if (s.table === 'guests' && s.op === 'select') return { data: [{ id: GUEST, party_id: PARTY }] };
    if (s.op === 'rpc') { sent = s.params; return { data: { results: [], max_seq: 1 } }; }
    return {};
  }));

  await svc.submitCheckInBatch(EVENT, [{
    client_checkin_id: CID,
    guest_id: GUEST,
    staff_id: '99999999-9999-4999-8999-999999999999',
    staff_display_name: 'Someone',
  }]);

  const record = (sent.p_records || [])[0];
  assert.equal(record.staff_id, null);
  assert.equal(record.staff_display_name, null);
  // §21.3: a queued check-in exists only on that device. Dropping it is
  // permanent data loss, so an unrecognised staff id must never reject it.
  assert.equal(record.guest_id, GUEST);
});

test('an override claimed by an usher is downgraded, not honoured', async () => {
  let sent = null;
  mock.setResolver(withRoster((s) => {
    if (s.table === 'guests' && s.op === 'select') return { data: [{ id: GUEST, party_id: PARTY }] };
    if (s.op === 'rpc') { sent = s.params; return { data: { results: [], max_seq: 1 } }; }
    return {};
  }));

  await svc.submitCheckInBatch(EVENT, [{
    client_checkin_id: CID, guest_id: GUEST, staff_id: USHER, method: 'override',
  }]);

  const record = (sent.p_records || [])[0];
  assert.equal(record.method, 'manual_search');
});

test('an override claimed by a supervisor is preserved', async () => {
  let sent = null;
  mock.setResolver(withRoster((s) => {
    if (s.table === 'guests' && s.op === 'select') return { data: [{ id: GUEST, party_id: PARTY }] };
    if (s.op === 'rpc') { sent = s.params; return { data: { results: [], max_seq: 1 } }; }
    return {};
  }));

  await svc.submitCheckInBatch(EVENT, [{
    client_checkin_id: CID, guest_id: GUEST, staff_id: SUPERVISOR, method: 'override',
  }]);

  const record = (sent.p_records || [])[0];
  assert.equal(record.method, 'override');
});

// ══════════════════════════════════════════════════════════════════
// Delta — the polling fallback, which must work with realtime disabled
// ══════════════════════════════════════════════════════════════════

test('the inline delta excludes the uploading device WITHOUT excluding kiosk rows', async () => {
  let deltaFilters = null;
  mock.setResolver(withRoster((s) => {
    if (s.table === 'guests' && s.op === 'select') return { data: [{ id: GUEST, party_id: PARTY }] };
    if (s.op === 'rpc') return { data: { results: [], max_seq: 5 } };
    if (s.table === 'check_ins' && s.op === 'select') { deltaFilters = s.filters; return { data: [] }; }
    return {};
  }));

  await svc.submitCheckInBatch(
    EVENT,
    [{ client_checkin_id: CID, guest_id: GUEST }],
    { sinceSeq: 0, deviceId: 'dev-1' },
  );

  const ors = (deltaFilters.or || []).map((f) => (Array.isArray(f) ? f[0] : f)).join(' | ');
  // The device's own writes are skipped, but the clause MUST also admit rows
  // with a null device_id — a plain `device_id != dev-1` evaluates to NULL for
  // those and would silently starve devices of every web-kiosk check-in.
  assert.ok(ors.includes('device_id.is.null'), 'kiosk rows (null device_id) must survive the filter');
  assert.ok(ors.includes('device_id.neq.dev-1'));
});

test('a delta with no device id is unfiltered — an organizer has no local copy to skip', async () => {
  let deltaFilters = null;
  mock.setResolver((s) => {
    if (s.table === 'check_ins' && s.op === 'select') { deltaFilters = s.filters; return { data: [] }; }
    return {};
  });

  await svc.getDelta(EVENT, 0);

  const ors = (deltaFilters.or || []).map((f) => (Array.isArray(f) ? f[0] : f)).join(' | ');
  assert.ok(!ors.includes('device_id'), 'no device filter may be applied');
});

test('delta reports an undone check-in under its undo_seq, not its original seq', async () => {
  mock.setResolver((s) => {
    if (s.table === 'check_ins' && s.op === 'select') {
      return { data: [
        { id: 'srv-1', guest_id: GUEST, party_id: PARTY, server_seq: 3, undo_seq: null, deleted_at: null },
        { id: 'srv-2', guest_id: 'g2', party_id: PARTY, server_seq: 4, undo_seq: 7, deleted_at: '2026-07-30T10:00:00Z' },
      ] };
    }
    if (s.table === 'event_checkin_cursors') return { data: { last_seq: 7, bundle_version: 1 } };
    return {};
  });

  const out = await svc.getDelta(EVENT, 2);
  assert.equal(out.changes[0].type, 'check_in');
  assert.equal(out.changes[0].serverSeq, 3);
  assert.equal(out.changes[1].type, 'check_in_undone');
  assert.equal(out.changes[1].serverSeq, 7, 'an undo occupies its own sequence position');
  assert.equal(out.maxSeq, 7);
});

test('delta flags truncation so the device fetches again instead of assuming it is caught up', async () => {
  mock.setResolver((s) => {
    if (s.table === 'check_ins' && s.op === 'select') {
      // limit+1 rows come back => truncated
      return { data: Array.from({ length: 4 }, (_, i) => ({
        id: `srv-${i}`, guest_id: `g${i}`, party_id: PARTY, server_seq: i + 1, undo_seq: null, deleted_at: null,
      })) };
    }
    if (s.table === 'event_checkin_cursors') return { data: { last_seq: 10 } };
    // bundle_version is derived from the change log (migration 20260815000000),
    // not stored on the cursor row.
    if (s.table === 'event_guest_changes') return { data: [{ seq: 2 }] };
    return {};
  });

  const out = await svc.getDelta(EVENT, 0, { limit: 3 });
  assert.equal(out.truncated, true);
  assert.equal(out.changes.length, 3);
  assert.equal(out.bundleVersion, 2);
});

test('a negative or garbage since_seq is clamped, never passed through', async () => {
  let filterSeen = null;
  mock.setResolver((s) => {
    if (s.table === 'check_ins' && s.op === 'select') { filterSeen = s.filters.or; return { data: [] }; }
    if (s.table === 'event_checkin_cursors') return { data: { last_seq: 0, bundle_version: 1 } };
    return {};
  });

  await svc.getDelta(EVENT, -50);
  assert.ok(String(filterSeen).includes('server_seq.gt.0'), 'since_seq must clamp to 0');

  await svc.getDelta(EVENT, 'abc');
  assert.ok(String(filterSeen).includes('server_seq.gt.0'));
});

// ══════════════════════════════════════════════════════════════════
// Bundle page shaping
// ══════════════════════════════════════════════════════════════════

test('bundle pages never present a non-table venue element as a guest table', async () => {
  mock.setResolver((s) => {
    if (s.table === 'guests' && s.op === 'select') {
      return {
        count: 2,
        data: [
          { id: 'g-a', party_id: PARTY, full_name: 'Alice', category: 'vip', is_primary_contact: true,
            rsvp_parties: { id: PARTY, label: 'Alice', response: 'yes',
              seating_assignments: [{ tables: { id: 't1', table_name: 'Table 3', element_type: 'table' } }] } },
          { id: 'g-b', party_id: PARTY, full_name: 'Bob', category: 'standard', is_primary_contact: false,
            rsvp_parties: { id: PARTY, label: 'Alice', response: 'yes',
              seating_assignments: [{ tables: { id: 'z1', table_name: 'Dance Floor', element_type: 'zone' } }] } },
        ],
      };
    }
    return {};
  });

  const out = await svc.getBundlePage(EVENT, { page: 1, limit: 500 });
  assert.equal(out.guests[0].tableName, 'Table 3');
  assert.equal(out.guests[0].category, 'vip');
  // A zone is venue furniture, not a seat. Reading "Dance Floor" out to a
  // guest as their table would be worse than saying nothing.
  assert.equal(out.guests[1].tableName, null);
  assert.equal(out.pagination.total, 2);
  assert.equal(out.pageHash.length, 64);
});

test('bundle page size is clamped to the server maximum', async () => {
  mock.setResolver((s) => {
    if (s.table === 'guests' && s.op === 'select') return { count: 0, data: [] };
    return {};
  });
  const out = await svc.getBundlePage(EVENT, { page: 0, limit: 99999 });
  assert.equal(out.pagination.limit, svc.BUNDLE_PAGE_SIZE);
  assert.equal(out.pagination.page, 1);
});
