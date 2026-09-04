require('./helpers/env');
const { test } = require('node:test');
const t = require('node:test');
const assert = require('node:assert/strict');
const { createMockSupabase } = require('./helpers/mockSupabase');
const { mockReq, invoke } = require('./helpers/http');
const { injectModule } = require('./helpers/inject');

const broadcasts = [];
injectModule('../../utils/realtime', {
  broadcast: async (eventId, event, payload) => { broadcasts.push({ eventId, event, payload }); },
});

const mock = createMockSupabase();
injectModule('../../config/supabase', { supabase: mock.supabase });

const guestService = require('../services/guestService');
const { undoCheckIn } = require('../controllers/checkinController');

const EVENT = 'evt-1';
const PARTY = 'party-1';

t.beforeEach(() => { mock.reset(); broadcasts.length = 0; });

// ══════════════════════════════════════════════════════════════════
// Legacy web-kiosk undo — finding R-1
// ══════════════════════════════════════════════════════════════════

test('undo without a reason is refused before any DB work', async () => {
  mock.setResolver(() => ({}));
  const { res } = await invoke(undoCheckIn,
    mockReq({ params: { eventId: EVENT }, body: { partyId: PARTY }, user: { id: 'u1' } }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'REASON_REQUIRED');
  assert.equal(mock.calls.length, 0);
});

test('undo with a whitespace-only reason is refused', async () => {
  mock.setResolver(() => ({}));
  const { res } = await invoke(undoCheckIn,
    mockReq({ params: { eventId: EVENT }, body: { partyId: PARTY, reason: '  ' }, user: { id: 'u1' } }));
  assert.equal(res.statusCode, 400);
  assert.equal(mock.calls.length, 0);
});

/**
 * Resolver for the console undo: report the party's live rows, then answer the
 * per-row RPC. `rpcCalls` records what the reversal actually asked the database
 * to do.
 */
const undoResolver = (liveIds, rpcCalls = [], rpcResult = null) => (s) => {
  if (s.op === 'rpc') {
    rpcCalls.push({ fn: s.fn, params: s.params });
    return rpcResult || { data: { ok: true, server_id: s.params.p_server_id, server_seq: 7 } };
  }
  if (s.table === 'check_ins' && s.op === 'select') {
    return { data: liveIds.map((id) => ({ id })) };
  }
  return {};
};

test('undo SOFT-deletes — it must never issue a DELETE against check_ins', async () => {
  const ops = [];
  mock.setResolver((s) => {
    if (s.table === 'check_ins') ops.push(s.op);
    return undoResolver(['ci-1'])(s);
  });

  const { res } = await invoke(undoCheckIn, mockReq({
    params: { eventId: EVENT },
    body: { partyId: PARTY, reason: 'scanned the wrong guest' },
    user: { id: 'supervisor-1' },
  }));

  assert.equal(res.statusCode, 200);
  // The whole point of R-1: arrival evidence is marked, never destroyed.
  assert.equal(ops.includes('delete'), false, 'a hard DELETE would erase arrival evidence');
});

/**
 * ── THE BUG THIS TEST EXISTS FOR ──
 *
 * The console undo was a direct UPDATE of deleted_at/deleted_by/undo_reason. It
 * was right about the database and invisible to every tablet: devices read
 * changes from getDelta, which selects on `server_seq.gt.N,undo_seq.gt.N`, and
 * that UPDATE never allocated an `undo_seq`. The row stayed NULL, never matched,
 * and no device ever heard. The dashboard's count dropped while both tablets
 * went on showing the guest as arrived and would refuse to re-admit them.
 *
 * Going through the RPC is what allocates that sequence number, so this asserts
 * the CALL, not the column patch.
 */
test('undo goes through the RPC, so it takes a sequence number devices can see', async () => {
  const rpcCalls = [];
  mock.setResolver(undoResolver(['ci-1'], rpcCalls));

  await invoke(undoCheckIn, mockReq({
    params: { eventId: EVENT },
    body: { partyId: PARTY, reason: 'checked in by mistake' },
    user: { id: 'supervisor-9' },
  }));

  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].fn, 'checkin_undo_by_ref');
  assert.equal(rpcCalls[0].params.p_server_id, 'ci-1');
  assert.equal(rpcCalls[0].params.p_event_id, EVENT);
  assert.equal(rpcCalls[0].params.p_actor, 'supervisor-9');
  assert.equal(rpcCalls[0].params.p_reason, 'checked in by mistake');
});

test('every live check-in in the party is reversed, one call each', async () => {
  const rpcCalls = [];
  mock.setResolver(undoResolver(['ci-1', 'ci-2', 'ci-3'], rpcCalls));

  const { res } = await invoke(undoCheckIn, mockReq({
    params: { eventId: EVENT },
    body: { partyId: PARTY, reason: 'duplicate scan' },
    user: { id: 'supervisor-1' },
  }));

  assert.equal(res.body.data.reversedCount, 3);
  assert.deepEqual(rpcCalls.map((c) => c.params.p_server_id), ['ci-1', 'ci-2', 'ci-3']);
});

/**
 * An unapplied migration must not stop an organizer reversing a mistaken
 * admission. The reversal still lands; only the propagation to devices is lost,
 * which is exactly the behaviour this replaced.
 */
test('an unapplied migration still reverses, via the original UPDATE', async () => {
  const ops = [];
  mock.setResolver((s) => {
    if (s.op === 'rpc') {
      return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    }
    if (s.table === 'check_ins') {
      ops.push(s.op);
      if (s.op === 'select') return { data: [{ id: 'ci-1' }] };
    }
    return {};
  });

  const { res } = await invoke(undoCheckIn, mockReq({
    params: { eventId: EVENT },
    body: { partyId: PARTY, reason: 'fallback path' },
    user: { id: 'supervisor-1' },
  }));

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.reversedCount, 1);
  assert.ok(ops.includes('update'), 'must fall back to marking the row directly');
});

test('undo writes an audit row and tells the other devices', async () => {
  const audits = [];
  mock.setResolver((s) => {
    if (s.table === 'activity_logs' && s.op === 'insert') { audits.push(s.payload); return {}; }
    return undoResolver(['ci-1', 'ci-2'])(s);
  });

  const { res } = await invoke(undoCheckIn, mockReq({
    params: { eventId: EVENT },
    body: { partyId: PARTY, reason: 'duplicate scan' },
    user: { id: 'supervisor-1' },
  }));

  assert.equal(res.body.data.reversedCount, 2);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'checkin_undone');
  assert.equal(audits[0].actor_id, 'supervisor-1');
  assert.equal(audits[0].metadata.reason, 'duplicate scan');
  assert.equal(broadcasts[0].event, 'checkin_undone');
});

test('undoing a party with nothing live is 404', async () => {
  mock.setResolver((s) => {
    if (s.table === 'check_ins' && s.op === 'select') return { data: [] };
    return {};
  });
  const { res } = await invoke(undoCheckIn, mockReq({
    params: { eventId: EVENT }, body: { partyId: PARTY, reason: 'x' }, user: { id: 'u1' },
  }));
  assert.equal(res.statusCode, 404);
});

test('undoPartyCheckIn only touches rows that are still live', async () => {
  let selectFilters = null;
  const rpcCalls = [];
  mock.setResolver((s) => {
    if (s.op === 'rpc') { rpcCalls.push(s.params); return { data: { ok: true, server_id: s.params.p_server_id } }; }
    if (s.table === 'check_ins' && s.op === 'select') {
      selectFilters = s.filters;
      return { data: [{ id: 'ci-1' }] };
    }
    return {};
  });
  await guestService.undoPartyCheckIn(EVENT, PARTY, { actorId: 'u1', reason: 'r' });

  // The live-rows guard moved from the UPDATE onto the SELECT that chooses which
  // rows to reverse — without it a repeated undo would re-stamp an already
  // reversed row and overwrite the original actor and reason.
  assert.deepEqual(selectFilters.is, [['deleted_at', null]]);
  assert.deepEqual(selectFilters.eq, [['event_id', EVENT], ['party_id', PARTY]]);
  // And the RPC is itself idempotent — it answers `already_undone` rather than
  // re-stamping, so the guard is belt and braces rather than the only defence.
  assert.equal(rpcCalls.length, 1);
});

// ══════════════════════════════════════════════════════════════════
// Check-in desk search — findings R-3 / A-12
// ══════════════════════════════════════════════════════════════════

const party = (id, label, guests, checkIns = []) => ({
  id, label, response: 'yes',
  guests: guests.map((n, i) => ({ id: `${id}-g${i}`, full_name: n, meal_selection: null, dietary_notes: null })),
  seating_assignments: [{ tables: { id: 't1', table_name: 'Table 4' } }],
  check_ins: checkIns,
});

/** Fast ILIKE pass returns `fast`; the fallback scan returns `all`. */
const searchResolver = (fast, all) => {
  let call = 0;
  return (s) => {
    if (s.table === 'rsvp_parties' && s.op === 'select') {
      call += 1;
      return { data: call === 1 ? fast : all };
    }
    return {};
  };
};

test('a companion is findable by their OWN name — the fast pass alone never could', async () => {
  mock.setResolver(searchResolver([], [party(PARTY, 'The Haddads', ['Rami Haddad', 'Layla Haddad'])]));
  const out = await guestService.searchGuestsForCheckin(EVENT, 'Layla');
  assert.equal(out.length, 1);
  assert.equal(out[0].guestName, 'The Haddads');
});

test('Arabic hamza and alef variants match — spec §8.5', async () => {
  mock.setResolver(searchResolver([], [party(PARTY, 'أحمد عبد الله', ['أحمد عبد الله'])]));
  const out = await guestService.searchGuestsForCheckin(EVENT, 'احمد');
  assert.equal(out.length, 1, 'searching احمد must find أحمد');
});

test('Arabic diacritics are ignored', async () => {
  mock.setResolver(searchResolver([], [party(PARTY, 'مُحَمَّد', ['مُحَمَّد'])]));
  const out = await guestService.searchGuestsForCheckin(EVENT, 'محمد');
  assert.equal(out.length, 1);
});

test('Latin accents and hyphens are ignored', async () => {
  mock.setResolver(searchResolver([], [party(PARTY, 'José Al-Masri', ['José Al-Masri'])]));
  assert.equal((await guestService.searchGuestsForCheckin(EVENT, 'jose')).length, 1);
  mock.reset();
  mock.setResolver(searchResolver([], [party(PARTY, 'José Al-Masri', ['José Al-Masri'])]));
  assert.equal((await guestService.searchGuestsForCheckin(EVENT, 'al masri')).length, 1);
});

test('the fallback scan is skipped when the fast pass already fills the limit', async () => {
  let calls = 0;
  mock.setResolver((s) => {
    if (s.table === 'rsvp_parties' && s.op === 'select') {
      calls += 1;
      return { data: Array.from({ length: 10 }, (_, i) => party(`p${i}`, `Alice ${i}`, [`Alice ${i}`])) };
    }
    return {};
  });
  await guestService.searchGuestsForCheckin(EVENT, 'Alice', 10);
  assert.equal(calls, 1, 'a satisfied fast pass must not trigger the scan');
});

test('the fast pass result is not duplicated by the fallback scan', async () => {
  const p = party(PARTY, 'Alice Smith', ['Alice Smith']);
  mock.setResolver(searchResolver([p], [p]));
  const out = await guestService.searchGuestsForCheckin(EVENT, 'Alice');
  assert.equal(out.length, 1, 'the same party must not appear twice');
});

test('an empty search term short-circuits without querying', async () => {
  mock.setResolver(() => ({}));
  assert.deepEqual(await guestService.searchGuestsForCheckin(EVENT, '   '), []);
  assert.equal(mock.calls.length, 0);
});

test('an undone check-in does not read as arrived', async () => {
  const p = party(PARTY, 'Alice Smith', ['Alice Smith'], [
    { id: 'ci-1', guest_id: `${PARTY}-g0`, checked_in_at: '2026-08-01T19:00:00Z', deleted_at: '2026-08-01T19:05:00Z' },
  ]);
  mock.setResolver(searchResolver([p], [p]));

  const out = await guestService.searchGuestsForCheckin(EVENT, 'Alice');
  assert.equal(out[0].isCheckedIn, false, 'a reversed admission must not show as arrived');
  assert.equal(out[0].checkedInCount, 0);
  assert.equal(out[0].checkedInAt, null);
});

test('a live check-in still reads as arrived', async () => {
  const p = party(PARTY, 'Alice Smith', ['Alice Smith'], [
    { id: 'ci-1', guest_id: `${PARTY}-g0`, checked_in_at: '2026-08-01T19:00:00Z', deleted_at: null },
  ]);
  mock.setResolver(searchResolver([p], [p]));

  const out = await guestService.searchGuestsForCheckin(EVENT, 'Alice');
  assert.equal(out[0].isCheckedIn, true);
  assert.equal(out[0].checkedInCount, 1);
  assert.equal(out[0].checkedInAt, '2026-08-01T19:00:00Z');
});

// ══════════════════════════════════════════════════════════════════
// checkInParty — the desk's arrival must be VISIBLE TO TABLETS
// ══════════════════════════════════════════════════════════════════

/**
 * ── THE BUG THIS TEST EXISTS FOR ──
 *
 * A desk check-in was a direct INSERT. `server_seq` has no default and no
 * trigger — it is allocated only inside `checkin_batch_upsert`, which just the
 * device drain calls — so every arrival taken at the front desk landed with
 * `server_seq = NULL`. `getDelta` selects on `server_seq.gt.N,undo_seq.gt.N`,
 * so no tablet was ever told about it.
 *
 * The count stayed right by accident: the guest re-scans at a door, the tablet
 * has never heard of them, admits them, and the batch endpoint answers
 * `conflict` and keeps the desk's row. One manufactured conflict per guest.
 *
 * So this asserts the CALL, not the column writes — the sequence number is
 * allocated inside the function, in the same transaction as the insert.
 */
test('a desk check-in goes through the RPC, so it takes a sequence number tablets can see', async () => {
  const rpcCalls = [];
  mock.setResolver((s) => {
    if (s.op === 'rpc') {
      rpcCalls.push({ fn: s.fn, params: s.params });
      return { data: { ok: true, checked_in_count: 2, total_guests: 3, already_checked_in: 1, checked_in_at: 'now' } };
    }
    return {};
  });

  const out = await guestService.checkInParty(EVENT, PARTY, { method: 'manual_search', checkedInBy: 'organizer-7' });

  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].fn, 'checkin_web_upsert');
  assert.equal(rpcCalls[0].params.p_event_id, EVENT);
  assert.equal(rpcCalls[0].params.p_party_id, PARTY);
  assert.equal(rpcCalls[0].params.p_method, 'manual_search');
  // The ORGANIZER audit uuid. checkin_batch_upsert hard-codes this to NULL,
  // which is exactly why the web path could not simply reuse that function.
  assert.equal(rpcCalls[0].params.p_checked_in_by, 'organizer-7');

  // The return contract is read by checkinController for the desk's response
  // and must not drift.
  assert.deepEqual(out, {
    success: true, checkedInCount: 2, totalGuests: 3, alreadyCheckedIn: 1, checkedInAt: 'now',
  });
});

test('a fully-arrived party still reports ALREADY_CHECKED_IN with the original time', async () => {
  mock.setResolver((s) => {
    if (s.op === 'rpc') {
      return { data: { ok: false, error: 'ALREADY_CHECKED_IN', total_guests: 2, checked_in_at: '2026-08-01T19:00:00Z' } };
    }
    return {};
  });

  const out = await guestService.checkInParty(EVENT, PARTY, { method: 'manual_search' });
  assert.equal(out.success, false);
  assert.equal(out.error, 'ALREADY_CHECKED_IN');
  assert.equal(out.checkedInAt, '2026-08-01T19:00:00Z');
  assert.equal(out.totalGuests, 2);
});

/**
 * The migration may not be applied yet, and a desk that cannot admit anyone is
 * far worse than one whose arrivals reach tablets a poll later. The legacy
 * INSERT path is kept for exactly that window — and it must still get the
 * soft-delete rule right, or a guest whose check-in was undone could never be
 * re-admitted.
 */
test('an unapplied migration falls back to the direct insert, still ignoring undone rows', async () => {
  let selectFilters = null;
  mock.setResolver((s) => {
    if (s.op === 'rpc') return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    if (s.table === 'guests' && s.op === 'select') return { data: [{ id: 'g1', full_name: 'Alice' }] };
    if (s.table === 'check_ins' && s.op === 'select') { selectFilters = s.filters; return { data: [] }; }
    if (s.table === 'check_ins' && s.op === 'insert') return { data: [{ id: 'ci-2', checked_in_at: 'now' }] };
    return {};
  });

  const out = await guestService.checkInParty(EVENT, PARTY, { method: 'manual_search' });
  assert.equal(out.success, true);
  assert.deepEqual(selectFilters.is, [['deleted_at', null]],
    'without this a guest whose check-in was undone could never be re-admitted');
});
