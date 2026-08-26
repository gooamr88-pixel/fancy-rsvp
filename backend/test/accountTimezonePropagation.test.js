/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PUSHING THE ACCOUNT TIMEZONE ONTO EXISTING EVENTS.
 *
 * `events.timezone` is frozen at creation so that correcting a misdetected
 * account cannot silently move events whose invitations already went out. That
 * freeze is right, and on its own it left an organizer filed under the wrong
 * zone with no way to repair the events they already had.
 *
 * The resolution is neither "follow live" nor "never follow": PATCH /profile
 * REPORTS which events are on a different clock, and a separate deliberate call
 * applies it. These tests pin both halves — and, more importantly, pin that the
 * save itself writes nothing to any event.
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

const { updateProfile, applyTimezoneToEvents } = require('../controllers/authController');
const { wallClockToInstant, instantToWallClock } = require('../utils/timezone');

t.beforeEach(() => mock.reset());

const owner = { id: 'owner-1' };
const ORG = 'org-1';
const WALL = '2026-09-01T18:30';
const OLD = 'America/Los_Angeles';
const NEW = 'Africa/Cairo';

/**
 * Scripts the org read, the org write and the events read, and records every
 * write aimed at `events` so a test can assert that none happened.
 */
function script({ events = [], orgTimezone = null }) {
  const seen = { eventWrites: [], orgWrite: null };
  mock.setResolver(({ table, op, payload, cols }) => {
    if (table === 'organizations' && op === 'update') {
      seen.orgWrite = payload;
      return { data: { id: ORG, name: 'Org', email: 'o@x.com', ...payload } };
    }
    if (table === 'organizations' && op === 'select') {
      return { data: { id: ORG, timezone: orgTimezone } };
    }
    if (table === 'events' && op === 'update') {
      seen.eventWrites.push(payload);
      return { data: { id: 'evt' } };
    }
    if (table === 'events' && op === 'select') return { data: events };
    return {};
  });
  return seen;
}

/* ── The save proposes, and writes nothing ──────────────────────────────── */

test('saving a new account timezone does NOT touch any event', async () => {
  const seen = script({
    events: [{ id: 'e1', title: 'Wedding', event_date: wallClockToInstant(WALL, OLD), timezone: OLD }],
  });

  const { res } = await invoke(updateProfile, mockReq({ body: { timezone: NEW }, user: owner }));

  assert.equal(res.statusCode, 200);
  assert.equal(seen.orgWrite.timezone, NEW);
  // The whole safety property. A profile save that quietly rewrote every
  // event's stored instant is exactly what freezing the column prevents.
  assert.deepEqual(seen.eventWrites, [], 'the profile save must not write to events');
});

test('the save reports which events are on another clock, and by how much', async () => {
  script({
    events: [{ id: 'e1', title: 'Wedding', event_date: wallClockToInstant(WALL, OLD), timezone: OLD }],
  });

  const { res } = await invoke(updateProfile, mockReq({ body: { timezone: NEW }, user: owner }));

  const p = res.body.timezonePropagation;
  assert.ok(p, 'a proposal must be returned');
  assert.equal(p.timezone, NEW);
  assert.equal(p.count, 1);
  // The hour is what STAYS; the shift is what the organizer is actually
  // deciding about. Reporting a before/after pair of times would show the same
  // string twice and imply nothing changes.
  assert.match(p.events[0].readsAs, /18:30/);
  assert.equal(typeof p.events[0].shiftHours, 'number');
  assert.notEqual(p.events[0].shiftHours, 0);
});

test('an event with NO zone counts as needing the change, not as already right', async () => {
  // safeZone(null) resolves to the platform default, so a null-zone event is
  // not "already correct" — it is running on a guess.
  script({ events: [{ id: 'e1', title: 'X', event_date: wallClockToInstant(WALL, OLD), timezone: null }] });

  const { res } = await invoke(updateProfile, mockReq({ body: { timezone: NEW }, user: owner }));
  assert.equal(res.body.timezonePropagation.count, 1);
  assert.equal(res.body.timezonePropagation.events[0].currentTimezone, null);
});

test('a null zone is proposed even when it already RESOLVES to the target', async () => {
  /**
   * THE HOLE THAT SWALLOWED THE REAL CASE.
   *
   * `America/Los_Angeles` is PLATFORM_TIMEZONE, so `safeZone(null)` returns it.
   * A filter of `safeZone(e.timezone) !== target` therefore drops every
   * null-zone event the moment an organizer sets their account to the platform
   * default — which is the single most likely thing for them to do, and was
   * exactly the state of the production account this feature was built for.
   * The proposal came back empty and the feature was a no-op.
   *
   * Null is not "already correct". It is pinned to an environment variable.
   */
  script({ events: [{ id: 'e1', title: 'X', event_date: wallClockToInstant(WALL, OLD), timezone: null }] });

  const { res } = await invoke(updateProfile, mockReq({ body: { timezone: OLD }, user: owner }));

  assert.ok(res.body.timezonePropagation, 'a null-zone event must still be proposed');
  assert.equal(res.body.timezonePropagation.count, 1);
});

test('applying stamps a null zone that already resolves to the target', async () => {
  // Same hole, other half: the skip guard must not treat null as done. The
  // dates do not move here — the column is the whole point of the write.
  const stored = wallClockToInstant(WALL, OLD);
  const seen = script({
    orgTimezone: OLD,
    events: [{ id: 'e1', event_date: stored, event_end_date: null, rsvp_deadline: null, timezone: null }],
  });

  const { res } = await invoke(applyTimezoneToEvents, mockReq({ user: owner }));

  assert.equal(seen.eventWrites.length, 1, 'the column must be written');
  assert.equal(seen.eventWrites[0].timezone, OLD);
  assert.equal(seen.eventWrites[0].event_date, stored, 'and the instant must NOT move');
  assert.equal(res.body.updated, 1);
});

test('no proposal when every event already keeps that clock', async () => {
  script({ events: [{ id: 'e1', title: 'X', event_date: wallClockToInstant(WALL, NEW), timezone: NEW }] });

  const { res } = await invoke(updateProfile, mockReq({ body: { timezone: NEW }, user: owner }));
  assert.equal(res.body.timezonePropagation, null);
});

/* ── The apply re-anchors ───────────────────────────────────────────────── */

test('applying keeps the typed hour and moves the instant', async () => {
  const stored = wallClockToInstant(WALL, OLD);
  const seen = script({
    orgTimezone: NEW,
    events: [{ id: 'e1', event_date: stored, event_end_date: null, rsvp_deadline: null, timezone: OLD }],
  });

  const { res } = await invoke(applyTimezoneToEvents, mockReq({ user: owner }));

  assert.equal(res.statusCode, 200);
  assert.equal(seen.eventWrites.length, 1);
  const patch = seen.eventWrites[0];
  assert.equal(patch.timezone, NEW);
  assert.equal(patch.event_date, wallClockToInstant(WALL, NEW));
  // The hour a guest sees is identical before and after — that is what makes
  // this safe to offer on events whose invitations already went out.
  assert.equal(instantToWallClock(patch.event_date, NEW), instantToWallClock(stored, OLD));
});

test('the end date and RSVP deadline move with it', async () => {
  const endWall = '2026-09-01T23:00';
  const deadlineWall = '2026-08-25T12:00';
  const seen = script({
    orgTimezone: NEW,
    events: [{
      id: 'e1',
      event_date: wallClockToInstant(WALL, OLD),
      event_end_date: wallClockToInstant(endWall, OLD),
      rsvp_deadline: wallClockToInstant(deadlineWall, OLD),
      timezone: OLD,
    }],
  });

  await invoke(applyTimezoneToEvents, mockReq({ user: owner }));

  const patch = seen.eventWrites[0];
  // Moving only the start would leave an event ending before it begins, which
  // updateEvent rejects — so a partial re-anchor surfaces later as a confusing
  // 400 on an unrelated save.
  assert.equal(patch.event_end_date, wallClockToInstant(endWall, NEW));
  assert.equal(patch.rsvp_deadline, wallClockToInstant(deadlineWall, NEW));
});

test('an event already on the target zone is skipped, so a second run cannot double-shift', async () => {
  /**
   * The idempotency guard, and it is load-bearing: a double shift is silent
   * (18:30 → 01:30 → 08:30) and looks exactly like the original error, with
   * nothing in the row recording that it happened twice.
   */
  const seen = script({
    orgTimezone: NEW,
    events: [{ id: 'e1', event_date: wallClockToInstant(WALL, NEW), event_end_date: null, rsvp_deadline: null, timezone: NEW }],
  });

  const { res } = await invoke(applyTimezoneToEvents, mockReq({ user: owner }));

  assert.deepEqual(seen.eventWrites, []);
  assert.equal(res.body.updated, 0);
});

test('both halves query the SAME population, upcoming only', async () => {
  /**
   * A past event is deliberately out of scope, and the reason is not tidiness.
   *
   * Re-anchoring a finished event changes nothing anyone can see — the hour is
   * rendered in the event's own zone, so both halves move together. But
   * shifting a just-finished event forward can push it back inside the 24-hour
   * window, and the reminder's dedupe ref now carries the event date: the new
   * instant is a NEW key, so the day-before reminder fires again, to every
   * confirmed guest, about a party that is over.
   *
   * The proposal must filter identically or its count describes a different
   * set of events than the button acts on.
   */
  const filters = [];
  mock.setResolver(({ table, op, filters: f }) => {
    if (table === 'events' && op === 'select') { filters.push(f); return { data: [] }; }
    if (table === 'organizations' && op === 'update') return { data: { id: ORG, timezone: NEW } };
    if (table === 'organizations' && op === 'select') return { data: { id: ORG, timezone: NEW } };
    return {};
  });

  await invoke(updateProfile, mockReq({ body: { timezone: NEW }, user: owner }));
  await invoke(applyTimezoneToEvents, mockReq({ user: owner }));

  assert.equal(filters.length, 2, 'both halves must read events');
  for (const f of filters) {
    assert.ok(f.gte && f.gte.some(([col]) => col === 'event_date'),
      'each half must bound to upcoming events');
    assert.ok(f.neq && f.neq.some(([col, val]) => col === 'status' && val === 'cancelled'));
  }
});

test('applying without an account timezone is refused rather than guessed', async () => {
  script({ orgTimezone: null, events: [] });
  const { res } = await invoke(applyTimezoneToEvents, mockReq({ user: owner }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'NO_ACCOUNT_TIMEZONE');
});

test('a null date is left alone rather than invented', async () => {
  const seen = script({
    orgTimezone: NEW,
    events: [{ id: 'e1', event_date: wallClockToInstant(WALL, OLD), event_end_date: null, rsvp_deadline: null, timezone: OLD }],
  });

  await invoke(applyTimezoneToEvents, mockReq({ user: owner }));

  const patch = seen.eventWrites[0];
  assert.ok(!('event_end_date' in patch));
  assert.ok(!('rsvp_deadline' in patch));
});
