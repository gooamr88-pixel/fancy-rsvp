/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DAY-BEFORE ALARM FIRES ON THE MARK.
 *
 * The reminder used to ride the 15-minute lifecycle sweep, so it landed
 * somewhere in a fifteen-minute smear after T-24h at an offset set by the last
 * process restart. "Twenty-four hours before" is a promise with a number in it,
 * and these tests pin the arithmetic that keeps it.
 *
 * Everything here is pure: the sleep decision was extracted precisely so the
 * timing can be asserted directly rather than inferred by watching a timer and
 * hoping the test machine is not busy.
 * ─────────────────────────────────────────────────────────────────────────────
 */
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  alarmSleepMs, ALARM_MAX_SLEEP_MS, ALARM_GUARD_MS, EVENT_REMINDER_WINDOW_MS,
} = require('../services/emailScheduler');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

test('the reminder window is 24 hours', () => {
  // Everything else here is arithmetic relative to this one constant, and the
  // seating reveal in guestService is pinned to the same mark.
  assert.equal(EVENT_REMINDER_WINDOW_MS, 24 * HOUR);
});

test('a mark inside the next hop is slept to exactly, not rounded up', () => {
  const now = Date.now();
  // 20 seconds away: the old sweep would have served this up to 15 minutes
  // late. The alarm must wake for it at 20s, not at the next tick.
  assert.equal(alarmSleepMs(now + 20 * 1000, now), 20 * 1000 + ALARM_GUARD_MS);
});

test('the sleep lands just past the mark, never just before it', () => {
  const now = Date.now();
  const dueAt = now + 30 * 1000;
  const wake = now + alarmSleepMs(dueAt, now);
  // jobEventReminders matches `event_date <= now + 24h`. Waking a millisecond
  // early matches nothing and costs the guest a whole hop, so the guard is a
  // correctness requirement rather than padding.
  assert.ok(wake > dueAt, 'the alarm must wake after the mark has passed');
  assert.ok(wake - dueAt <= 2000, 'but not so far past that it is noticeable');
});

test('a distant mark is capped so a newly created event is still seen', () => {
  const now = Date.now();
  // Six hours out. The alarm must NOT sleep six hours: an event created or
  // re-dated in the meantime can introduce an earlier mark, and nothing
  // notifies the scheduler when that happens.
  assert.equal(alarmSleepMs(now + 6 * HOUR, now), ALARM_MAX_SLEEP_MS);
  assert.ok(ALARM_MAX_SLEEP_MS <= MIN, 'the re-read must happen at least once a minute');
});

test('an empty database sleeps a full hop instead of spinning', () => {
  assert.equal(alarmSleepMs(null), ALARM_MAX_SLEEP_MS);
  assert.equal(alarmSleepMs(undefined), ALARM_MAX_SLEEP_MS);
});

test('a mark already in the past never produces a negative sleep', () => {
  const now = Date.now();
  // A clock jump, a slow query, or an event that was already due when the
  // process booted. setTimeout treats a negative delay as zero, so this would
  // not hang — but it would busy-loop the re-arm, which is worth pinning.
  const sleep = alarmSleepMs(now - 3 * HOUR, now);
  assert.ok(sleep >= 0, 'sleep must never be negative');
  assert.equal(sleep, ALARM_GUARD_MS);
});

/* ── The query behind the alarm ──────────────────────────────────────────── */

const schedulerSrc = fs.readFileSync(
  path.join(__dirname, '..', 'services', 'emailScheduler.js'), 'utf8',
);

const fnBody = (decl) => {
  const start = schedulerSrc.indexOf(decl);
  assert.notEqual(start, -1, `${decl} not found — this test is pinned to a function that was renamed`);
  const rest = schedulerSrc.slice(start);
  const end = rest.indexOf('\n}');
  return rest.slice(0, end === -1 ? rest.length : end);
};

test('the next-mark query looks past the window, not into it', () => {
  /* `nextDueAt`, not `nextEventReminderDueAt`. The query was parameterised by
     offset when the single T-24h mark became three; the named function is now a
     one-line wrapper around it, and pinning these assertions to the wrapper
     would check a call site instead of the query they are about. */
  const body = fnBody('async function nextDueAt');
  // `.gte` here would return an event already inside the window — a mark in the
  // past — and the alarm would re-arm to the guard delay forever, firing the
  // job every second for as long as that event existed.
  assert.match(body, /\.gt\('event_date'/, 'must use .gt so an in-window event is not returned as a future mark');
  assert.doesNotMatch(body, /\.gte\('event_date'/);
});

test('the next-mark query takes the soonest event, not an arbitrary one', () => {
  /* `nextDueAt`, not `nextEventReminderDueAt`. The query was parameterised by
     offset when the single T-24h mark became three; the named function is now a
     one-line wrapper around it, and pinning these assertions to the wrapper
     would check a call site instead of the query they are about. */
  const body = fnBody('async function nextDueAt');
  assert.match(body, /\.order\('event_date', \{ ascending: true \}\)/,
    'without an ascending sort, .limit(1) returns whichever row Postgres felt like');
  assert.match(body, /\.limit\(1\)/);
});

test('the alarm only considers events that can actually send', () => {
  /* `nextDueAt`, not `nextEventReminderDueAt`. The query was parameterised by
     offset when the single T-24h mark became three; the named function is now a
     one-line wrapper around it, and pinning these assertions to the wrapper
     would check a call site instead of the query they are about. */
  const body = fnBody('async function nextDueAt');
  // A draft or unpaid event is skipped by jobEventReminders. If the alarm armed
  // for one, it would wake on the mark, send nothing, and the real next event
  // would still be waiting — the alarm and the job must agree on the audience.
  assert.match(body, /\.eq\('status', 'active'\)/);
  assert.match(body, /\.eq\('is_paid', true\)/);
});

/* ── Paging ─────────────────────────────────────────────────────────────── */

test('the guest fetch pages instead of capping at one limit', () => {
  const body = fnBody('async function fetchConfirmedParties');
  // The bug this replaced: a bare .limit(250) with no cursor re-read the same
  // first 250 rows every run, so guest 251 onward was never selected by any
  // sweep and silently never received their table or entry pass.
  assert.match(body, /\.range\(/, 'must walk pages with .range');
  assert.match(body, /\.order\('id', \{ ascending: true \}\)/,
    'paging without a deterministic sort can overlap and skip rows');
});

test('the guest fetch is bounded so one event cannot exhaust memory', () => {
  const body = fnBody('async function fetchConfirmedParties');
  assert.match(body, /MAX_PARTIES_PER_EVENT/);
});

/* ── Rescheduling ────────────────────────────────────────────────────────── */

test('the dedupe key names the date it is about, on ALL THREE marks', () => {
  /* `rsvp:<party>` alone reads as "this guest has been reminded, ever". With a
     UNIQUE (kind, ref) index behind it, that made the FIRST reminder the only
     one a guest could ever receive — so moving an event that had already
     crossed its mark told nobody about the new date.

     The three refs used to sit in one function. They are now in three, and all
     three still have to carry the instant: an organizer who reschedules and
     gets one channel resent but not another has half their guest list told,
     split by which message each person happens to read. */
  assert.match(fnBody('async function jobEventReminders'), /ref: `rsvp:\$\{party\.id\}:\$\{dateKey\}`/,
    'the T-24h email ref must carry the target instant');
  assert.match(fnBody('async function jobFinalCallReminders'), /ref: `fc:\$\{party\.id\}:\$\{dateKey\}`/,
    'the T-6h email ref must carry the target instant');
  assert.match(fnBody('async function jobSmsEventReminders'), /ref: `evday:\$\{party\.id\}:\$\{dateKey\}`/,
    'the T-2h text ref must carry it too');

  // Three distinct prefixes. Sharing one would collide the marks on the unique
  // index and silently drop whichever arrived second.
  const prefixes = ['rsvp', 'fc', 'evday'];
  assert.equal(new Set(prefixes).size, 3);

  for (const job of ['jobEventReminders', 'jobFinalCallReminders', 'jobSmsEventReminders']) {
    const body = fnBody(`async function ${job}`);
    assert.doesNotMatch(body, /ref: `(rsvp|fc|evday):\$\{party\.id\}`/,
      `${job}: the bare per-party key must not come back`);
  }
});

test('the date key is an instant, not its text', () => {
  // Computed once in the shared sweep the three jobs run through.
  const body = fnBody('async function sweepRunUpWindow');
  // Postgres returns "…+00:00" and other paths produce "…000Z" for the same
  // moment. A string key would read those as two different dates and remind
  // every guest twice.
  assert.match(body, /const dateKey = new Date\(ev\.event_date\)\.getTime\(\)/,
    'getTime() has exactly one representation; the ISO text does not');
});

test('the reminders still dedupe against themselves on an unchanged date', () => {
  // The key varies with the DATE, never with the run. Anything per-attempt in
  // there — a timestamp, a counter, a random — would defeat the unique index
  // and re-send on every sweep, which is worse than the bug being fixed.
  for (const job of ['jobEventReminders', 'jobFinalCallReminders', 'jobSmsEventReminders']) {
    const body = fnBody(`async function ${job}`);
    assert.doesNotMatch(body, /ref: `[^`]*Date\.now\(\)/, `${job} re-sends on every sweep`);
    assert.doesNotMatch(body, /ref: `[^`]*Math\.random/, `${job} re-sends on every sweep`);
  }
});
