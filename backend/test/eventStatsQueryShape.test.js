/**
 * GET /events/:id/stats is on the organizer dashboard's 20-SECOND REFRESH.
 *
 * `frontend/src/app/dashboard/hooks/useRealtimeRSVPs.js` polls every 20s for as
 * long as a dashboard tab is open, and `loadDashboardData` calls this endpoint
 * on every tick. So whatever this handler reads, it reads continuously, for
 * every organizer with the page open, for the life of their event.
 *
 * It has no `.limit()` anywhere and cannot have one: these are whole-event
 * totals, and a bound would silently under-report them. That makes the SHAPE of
 * the reads the only thing left to control, which is what this file locks:
 *
 *   • the seating query must fetch `party_id` and nothing else. It used to
 *     select `rsvp_parties(guests(id))` — a two-level PostgREST embed that made
 *     the database resolve every seated party and re-read all of its guest rows,
 *     which the FIRST query in the handler has already returned for the entire
 *     event. On a fully-seated event that doubled the guest rows read and sent.
 *
 *   • the number it produces must still be identical, so the regression this
 *     guards against is "someone re-adds the embed", not "someone changes the
 *     answer".
 */
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

const { getEventStats } = require('../controllers/eventController');

t.beforeEach(() => { mock.reset(); });

/**
 * Three parties, two of them seated:
 *   p1  yes   3 guests (2 with a meal + 1 companion meal counted)  SEATED
 *   p2  yes   1 guest,  no meal                                    SEATED
 *   p3  no    2 guests                                             not seated
 */
const PARTIES = [
  {
    id: 'p1',
    response: 'yes',
    companion_meal_counts: { Fish: 1 },
    guests: [{ id: 'g1', meal_selection: 'Beef' }, { id: 'g2', meal_selection: null }, { id: 'g3', meal_selection: null }],
  },
  { id: 'p2', response: 'yes', companion_meal_counts: null, guests: [{ id: 'g4', meal_selection: null }] },
  { id: 'p3', response: 'no', companion_meal_counts: null, guests: [{ id: 'g5', meal_selection: null }, { id: 'g6', meal_selection: null }] },
];

/** Records the `select(...)` column string of every read, keyed by table. */
function scripted() {
  const cols = [];
  mock.setResolver((s) => {
    if (s.op === 'select') cols.push({ table: s.table, cols: s.cols, count: s.count });
    if (s.table === 'rsvp_parties') return { data: PARTIES };
    if (s.table === 'invitations') return { data: [{ party_id: 'p1' }, { party_id: 'p1' }, { party_id: 'p2' }] };
    if (s.table === 'check_ins') return { count: 4 };
    if (s.table === 'seating_assignments') return { data: [{ party_id: 'p1' }, { party_id: 'p2' }] };
    return {};
  });
  return cols;
}

const statsReq = () => mockReq({ params: { eventId: 'evt-1' }, user: { id: 'owner-1' } });

test('the seating read asks for party_id only — no nested rsvp_parties/guests embed', async () => {
  const cols = scripted();
  const { res } = await invoke(getEventStats, statsReq());
  assert.equal(res.statusCode, 200);

  const seating = cols.find((c) => c.table === 'seating_assignments');
  assert.ok(seating, 'the handler no longer reads seating_assignments at all');
  assert.equal(seating.cols, 'party_id');
  // The specific regression: an embed re-reads guest rows the first query
  // already returned for the whole event, on a 20-second loop.
  assert.ok(
    !/rsvp_parties|guests/.test(seating.cols),
    `seating read must not embed other tables, got: ${seating.cols}`,
  );
});

test('seatingAssignedGuests still counts the guests of every seated party', async () => {
  scripted();
  const { res } = await invoke(getEventStats, statsReq());
  // p1 (3 guests) + p2 (1 guest) — p3 is unseated.
  assert.equal(res.body.stats.seatingAssignedGuests, 4);
});

test('the rest of the totals are unchanged by the seating rewrite', async () => {
  scripted();
  const { res } = await invoke(getEventStats, statsReq());
  const s = res.body.stats;

  assert.equal(s.invitedParties, 3);
  assert.equal(s.attendingParties, 2);
  assert.equal(s.attendingGuests, 4);       // 3 + 1
  assert.equal(s.declinedParties, 1);
  assert.equal(s.declinedGuests, 2);
  assert.equal(s.totalExpectedGuests, 4);
  assert.equal(s.invitationsSent, 2);       // DISTINCT party_id, not row count
  assert.equal(s.checkedInGuests, 4);

  // p1: one named Beef, one companion Fish, one person left unaccounted for.
  // p2: one attending guest, nothing chosen.
  assert.deepEqual(s.mealSummary, { Beef: 1, Fish: 1, 'No Selection': 2 });
});

test('a party seated but somehow absent from the parties read contributes 0, not a crash', async () => {
  // seating_assignments is UNIQUE(event_id, party_id) with an FK to
  // rsvp_parties, so this cannot happen — but the old code guarded the null
  // embed, and dropping that guard silently must not turn into a TypeError on
  // the dashboard's polling endpoint.
  mock.setResolver((s) => {
    if (s.table === 'rsvp_parties') return { data: PARTIES };
    if (s.table === 'invitations') return { data: [] };
    if (s.table === 'check_ins') return { count: 0 };
    if (s.table === 'seating_assignments') return { data: [{ party_id: 'p1' }, { party_id: 'ghost' }] };
    return {};
  });

  const { res, nextErr } = await invoke(getEventStats, statsReq());
  assert.equal(nextErr, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.stats.seatingAssignedGuests, 3);
});
