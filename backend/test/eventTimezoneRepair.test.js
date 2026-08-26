/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CORRECTING AN EVENT'S TIMEZONE.
 *
 * `events.timezone` is a snapshot frozen at creation, and that is right: a
 * corrected ACCOUNT zone must never silently move events whose invitations have
 * already gone out. What the freeze missed is that a zone can be frozen WRONG —
 * an event created while the organization had no zone got the platform default
 * — and with no way to edit the column and no screen showing it, the error was
 * permanent and invisible. The only symptom was the day-before reminder
 * arriving hours off the mark, and the one repair an organizer would reach for
 * (fixing their account timezone) cannot help, because this column never reads
 * it.
 *
 * The repair is RE-ANCHORING: the hour the organizer typed is the half that was
 * right, so it is kept and the stored instant is recomputed. These tests pin
 * that direction — the opposite choice, keeping the instant and letting the
 * displayed hour move, preserves the bug and merely relabels it.
 * ─────────────────────────────────────────────────────────────────────────────
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

const { updateEvent } = require('../controllers/eventController');
const { wallClockToInstant } = require('../utils/timezone');

t.beforeEach(() => mock.reset());

const owner = { id: 'owner-1' };

const WALL = '2026-09-01T18:30';
const WRONG_ZONE = 'America/Los_Angeles'; // the platform default, frozen by mistake
const RIGHT_ZONE = 'Africa/Cairo';        // where the organizer actually is

const storedUnderWrongZone = wallClockToInstant(WALL, WRONG_ZONE);

/**
 * Scripts the two reads updateEvent performs before writing, and captures the
 * update payload. `cols` is how the current-event read is told apart from the
 * slug-collision read, which also hits `events`.
 */
function scriptEvent(current, updated = {}) {
  const seen = { payload: null };
  mock.setResolver(({ table, op, cols, payload }) => {
    if (table === 'events' && op === 'update') {
      seen.payload = payload;
      return { data: { id: 'evt-1', title: 'T', status: 'draft', ...updated } };
    }
    if (table === 'events' && op === 'select' && cols && cols.includes('timezone')) {
      return { data: current };
    }
    if (table === 'events' && op === 'select') return { data: current };
    return {};
  });
  return seen;
}

test('correcting the zone keeps the typed hour and moves the real instant', async () => {
  const seen = scriptEvent({
    event_date: storedUnderWrongZone, event_end_date: null, rsvp_deadline: null, timezone: WRONG_ZONE,
  });

  const { res } = await invoke(updateEvent, mockReq({
    params: { eventId: 'evt-1' }, body: { timezone: RIGHT_ZONE }, user: owner,
  }));

  assert.equal(res.statusCode, 200);
  assert.equal(seen.payload.timezone, RIGHT_ZONE);
  // 18:30 in Cairo — the hour the organizer typed, on the clock they meant.
  assert.equal(seen.payload.event_date, wallClockToInstant(WALL, RIGHT_ZONE));
  // And emphatically NOT the value it was stored as, which is the "keep the
  // instant, relabel the hour" behaviour this repair exists to avoid.
  assert.notEqual(seen.payload.event_date, storedUnderWrongZone);
});

test('the end date and RSVP deadline are re-anchored too, not left behind', async () => {
  const endWall = '2026-09-01T23:00';
  const deadlineWall = '2026-08-25T12:00';
  const seen = scriptEvent({
    event_date: storedUnderWrongZone,
    event_end_date: wallClockToInstant(endWall, WRONG_ZONE),
    rsvp_deadline: wallClockToInstant(deadlineWall, WRONG_ZONE),
    timezone: WRONG_ZONE,
  });

  await invoke(updateEvent, mockReq({
    params: { eventId: 'evt-1' }, body: { timezone: RIGHT_ZONE }, user: owner,
  }));

  // Moving only the start would leave an event that ends before it begins, or
  // a deadline that lands after the event — both already rejected elsewhere in
  // this controller, so a partial re-anchor would surface as a confusing 400.
  assert.equal(seen.payload.event_end_date, wallClockToInstant(endWall, RIGHT_ZONE));
  assert.equal(seen.payload.rsvp_deadline, wallClockToInstant(deadlineWall, RIGHT_ZONE));
});

test('a null date is left null rather than invented', async () => {
  const seen = scriptEvent({
    event_date: storedUnderWrongZone, event_end_date: null, rsvp_deadline: null, timezone: WRONG_ZONE,
  });

  await invoke(updateEvent, mockReq({
    params: { eventId: 'evt-1' }, body: { timezone: RIGHT_ZONE }, user: owner,
  }));

  assert.ok(!('event_end_date' in seen.payload), 'an absent optional date must not be written');
  assert.ok(!('rsvp_deadline' in seen.payload), 'an absent optional date must not be written');
});

test('a date retyped in the same request belongs to the NEW zone', async () => {
  const seen = scriptEvent({
    event_date: storedUnderWrongZone, event_end_date: null, rsvp_deadline: null, timezone: WRONG_ZONE,
  });

  const retyped = '2026-09-02T20:00';
  await invoke(updateEvent, mockReq({
    params: { eventId: 'evt-1' },
    body: { timezone: RIGHT_ZONE, event_date: retyped },
    user: owner,
  }));

  // Re-anchoring the stored value here would silently discard what the
  // organizer just typed.
  assert.equal(seen.payload.event_date, wallClockToInstant(retyped, RIGHT_ZONE));
});

test('an unrecognised zone is refused, not quietly swapped for the default', async () => {
  scriptEvent({ event_date: storedUnderWrongZone, timezone: WRONG_ZONE });

  const { res } = await invoke(updateEvent, mockReq({
    params: { eventId: 'evt-1' }, body: { timezone: 'Mars/Olympus_Mons' }, user: owner,
  }));

  // safeZone() would have absorbed this into America/Los_Angeles — a typo that
  // silently refiles the event under the platform default is the exact failure
  // this endpoint exists to repair.
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'INVALID_TIMEZONE');
});

test('leaving the zone alone still converts dates through the frozen one', async () => {
  const seen = scriptEvent({
    event_date: storedUnderWrongZone, event_end_date: null, rsvp_deadline: null, timezone: WRONG_ZONE,
  });

  const typed = '2026-09-03T19:15';
  await invoke(updateEvent, mockReq({
    params: { eventId: 'evt-1' }, body: { event_date: typed }, user: owner,
  }));

  // The pre-existing contract: an ordinary date edit reads the event's own
  // frozen zone and never the organization's current one.
  assert.equal(seen.payload.event_date, wallClockToInstant(typed, WRONG_ZONE));
  assert.ok(!('timezone' in seen.payload), 'an untouched zone must not be rewritten');
});

test('a pure re-anchor does not offer to tell guests the event moved', async () => {
  const seen = scriptEvent(
    { event_date: storedUnderWrongZone, event_end_date: null, rsvp_deadline: null, timezone: WRONG_ZONE },
    { status: 'active', event_date: wallClockToInstant(WALL, RIGHT_ZONE) },
  );

  const { res } = await invoke(updateEvent, mockReq({
    params: { eventId: 'evt-1' }, body: { timezone: RIGHT_ZONE }, user: owner,
  }));

  assert.equal(res.statusCode, 200);
  assert.ok(seen.payload, 'the write still happened');
  // The stored instant moved by hours, so the raw before/after comparison
  // fires — but every guest-facing surface renders event_date in the event's
  // own zone, and both halves moved together. The invitation said 18:30 before
  // and says 18:30 after. Offering to spend the organizer's message allowance
  // announcing that would deliver pure confusion.
  assert.equal(res.body.changeNotice, null);
});

test('the settings screen resubmitting an untouched date is still a pure re-anchor', async () => {
  /**
   * THE CASE THE FIRST IMPLEMENTATION GOT WRONG.
   *
   * EventSettings sends `{ ...form }`, so `event_date` is on every save whether
   * the organizer touched it or not. A guard that asked "did the payload
   * contain a date?" was therefore never satisfied from the real UI, and a
   * pure timezone correction would still have offered to tell every guest the
   * event had moved.
   *
   * The form prefills that field from the stored instant read in the event's
   * OWN zone, so what comes back is exactly the wall clock below.
   */
  const seen = scriptEvent(
    { event_date: storedUnderWrongZone, event_end_date: null, rsvp_deadline: null, timezone: WRONG_ZONE },
    { status: 'active', event_date: wallClockToInstant(WALL, RIGHT_ZONE) },
  );

  const { res } = await invoke(updateEvent, mockReq({
    params: { eventId: 'evt-1' },
    body: { timezone: RIGHT_ZONE, event_date: WALL },
    user: owner,
  }));

  assert.equal(res.statusCode, 200);
  assert.equal(seen.payload.event_date, wallClockToInstant(WALL, RIGHT_ZONE));
  assert.equal(res.body.changeNotice, null, 'resubmitting the same hour is not a reschedule');
});

test('the pure-re-anchor test compares instants, not strings', async () => {
  // Postgres hands back "…+00:00" while wallClockToInstant emits "…000Z" — the
  // same moment, never === . A string compare would classify every save as a
  // real date change and the guard would silently stop working.
  const pgStyle = storedUnderWrongZone.replace(/\.\d{3}Z$/, '+00:00');
  scriptEvent(
    { event_date: pgStyle, event_end_date: null, rsvp_deadline: null, timezone: WRONG_ZONE },
    { status: 'active', event_date: wallClockToInstant(WALL, RIGHT_ZONE) },
  );

  const { res } = await invoke(updateEvent, mockReq({
    params: { eventId: 'evt-1' },
    body: { timezone: RIGHT_ZONE, event_date: WALL },
    user: owner,
  }));

  assert.equal(res.body.changeNotice, null);
});

test('a real date change still offers the notice', async () => {
  const moved = wallClockToInstant('2026-09-09T18:30', WRONG_ZONE);
  scriptEvent(
    { event_date: storedUnderWrongZone, event_end_date: null, rsvp_deadline: null, timezone: WRONG_ZONE },
    { status: 'active', event_date: moved },
  );

  const { res } = await invoke(updateEvent, mockReq({
    params: { eventId: 'evt-1' }, body: { event_date: '2026-09-09T18:30' }, user: owner,
  }));

  // The guard above must be narrow: it suppresses the notice only when the
  // organizer changed nothing but the zone. An actual reschedule is still the
  // thing guests need to hear about.
  assert.ok(res.body.changeNotice, 'moving the event a week must still propose a notice');
  assert.ok(res.body.changeNotice.changed.includes('date'));
});
