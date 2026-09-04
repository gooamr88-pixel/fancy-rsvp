/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE POST-EVENT DATA PURGE.
 *
 * This service permanently deletes real customer data — guest lists, RSVPs,
 * seating, door records, consent history — and nothing it destroys can be
 * recovered. So the tests here are not about the happy path. Every one of them
 * pins a rule whose violation means somebody loses their guest list:
 *
 *   nothing is deleted that was not warned about first
 *   the grace clock starts when the WARNING GOES OUT, never when the event ended
 *   a failed email leaves the event unwarned and unscheduled, to be retried
 *   drafts and opt-outs are never touched
 *   the audit row is written BEFORE the delete, or the delete does not happen
 * ─────────────────────────────────────────────────────────────────────────────
 */
require('./helpers/env');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { createMockSupabase, eqVal } = require('./helpers/mockSupabase');
const { injectModule } = require('./helpers/inject');

/* Paths are relative to test/helpers/inject.js, not to this file — injectModule
   calls require.resolve from there. Hence the extra `../`. */
const mock = createMockSupabase();
injectModule('../../config/supabase', { supabase: mock.supabase });

// Email is stubbed so the tests never touch Brevo and can script delivery
// outcomes — "the mail failed" is one of the states that matters most here.
const emails = [];
let emailResult = { sent: true };
injectModule('../../services/emailService', {
  dispatch: async (payload) => { emails.push(payload); return emailResult; },
  alreadyLogged: async () => false,
});

const eventPurge = require('../services/eventPurge');

const HOUR = 3600 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const ahead = (ms) => new Date(Date.now() + ms).toISOString();

const ORG = { name: 'Yousef', email: 'host@example.com' };
const finishedEvent = (over = {}) => ({
  id: 'evt-1', title: 'Sara & Khalid', slug: 'sara-khalid', org_id: 'org-1',
  event_date: ago(12 * HOUR), event_end_date: null, timezone: 'America/Los_Angeles',
  status: 'active', is_paid: true, organizations: ORG, ...over,
});

beforeEach(() => {
  mock.reset();
  emails.length = 0;
  emailResult = { sent: true };
});

/** Script the warn sweep: one page of events, then swallow every other read. */
const warnWith = (events) => mock.setResolver((s) => {
  if (s.table === 'events' && s.op === 'select') return { data: events };
  if (s.op === 'select') return { data: [], count: 0 };
  return {};
});

/** Script the purge sweep: `due` are the events past their deadline. */
const purgeWith = (due) => mock.setResolver((s) => {
  if (s.table === 'events' && s.op === 'select') return { data: due };
  if (s.op === 'select') return { data: [], count: 0 };
  return {};
});

const updates = (table) => mock.calls.filter((c) => c.table === table && c.op === 'update');
const deletes = (table) => mock.calls.filter((c) => c.table === table && c.op === 'delete');
const inserts = (table) => mock.calls.filter((c) => c.table === table && c.op === 'insert');

/* ── The countdown figure ────────────────────────────────────────────────── */

test('the HH:MM:SS figure never wraps hours at 24', () => {
  /* THE ONE WAY THIS DISPLAY CAN BE CATASTROPHICALLY WRONG.
   *
   * A 36-hour window rendered as "12:00:00" is not a formatting nit — it is a
   * completely plausible reading of a deadline that is a day and a half away,
   * on the email telling somebody their data is about to be destroyed. It
   * cannot be caught by grepping the rendered HTML for /\d\d:\d\d:\d\d/, which
   * is what the warning-email test does, so it is asserted here directly. */
  const { formatHMS } = require('../utils/emailTemplates');
  const H = 3600 * 1000;

  assert.equal(formatHMS(24 * H), '24:00:00', 'hours must not roll over into a day');
  assert.equal(formatHMS(36 * H + 61000), '36:01:01');
  assert.equal(formatHMS(0), '00:00:00');
  assert.equal(formatHMS(-5000), '00:00:00', 'a passed deadline must clamp, never go negative');
  assert.equal(formatHMS(9 * H + 5 * 60000 + 3000), '09:05:03', 'every field is zero-padded');
});

/* ── When an event is actually over ──────────────────────────────────────── */

test('an explicit end time wins over the assumed duration', () => {
  const end = ahead(3 * HOUR);
  assert.equal(eventPurge.effectiveEndAt({ event_date: ago(HOUR), event_end_date: end }),
    new Date(end).getTime());
});

test('with no end time, the event is assumed to run for the configured duration', () => {
  const start = Date.now() - HOUR;
  assert.equal(eventPurge.effectiveEndAt({ event_date: new Date(start).toISOString() }),
    start + eventPurge.assumedDurationMs());
});

test('an unparseable date is never treated as finished', () => {
  /* Returning NaN here would make every comparison false in one direction and
     true in the other depending on how it was written. Null is the only answer
     that cannot be accidentally compared into a deletion. */
  assert.equal(eventPurge.effectiveEndAt({ event_date: 'not-a-date' }), null);
  assert.equal(eventPurge.effectiveEndAt({}), null);
  assert.equal(eventPurge.effectiveEndAt(null), null);
});

test('the grace window can never be zero', () => {
  // A zero window would dispatch the warning and the deletion in the same
  // sweep, seconds apart, with a dead download link attached.
  const prev = process.env.PURGE_GRACE_HOURS;
  process.env.PURGE_GRACE_HOURS = '0';
  assert.ok(eventPurge.graceMs() >= HOUR);
  process.env.PURGE_GRACE_HOURS = prev === undefined ? '' : prev;
  if (prev === undefined) delete process.env.PURGE_GRACE_HOURS;
});

/* ── Phase 1: the warning ────────────────────────────────────────────────── */

test('a finished event warns the organizer and schedules the deletion for later', async () => {
  warnWith([finishedEvent()]);
  const warned = await eventPurge.warnFinishedEvents();

  assert.equal(warned, 1);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].to, ORG.email);
  assert.equal(emails[0].kind, 'event_data_deletion_warning');
  assert.equal(emails[0].ref, 'event:evt-1');

  const [stamp] = updates('events');
  assert.ok(stamp, 'the event must be stamped once the warning is away');
  assert.ok(stamp.payload.purge_warning_sent_at);

  const deleteAt = new Date(stamp.payload.purge_scheduled_at).getTime();
  assert.ok(deleteAt > Date.now() + eventPurge.graceMs() - 60_000,
    'the deadline must be a full grace window in the FUTURE');
});

test('THE CLOCK STARTS AT THE WARNING, NOT AT THE EVENT', async () => {
  /* The single most important rule in this service.
   *
   * Derive the deadline from the event's end date and a scheduler outage
   * becomes data loss: two days down, and every event that finished meanwhile
   * comes back already past a deadline nobody was ever told about — deleted on
   * the first sweep, with no warning ever sent.
   *
   * Persisting it from the moment the mail goes out means an outage delays the
   * warning and the deletion equally. */
  warnWith([finishedEvent({ event_date: ago(40 * 24 * HOUR) })]); // ended over a month ago

  await eventPurge.warnFinishedEvents();

  const [stamp] = updates('events');
  const deleteAt = new Date(stamp.payload.purge_scheduled_at).getTime();
  assert.ok(deleteAt > Date.now(),
    'an event that finished a month ago must still get a full grace window from NOW');
});

test('an event still running is left alone', async () => {
  // Started an hour ago, assumed to run six.
  warnWith([finishedEvent({ event_date: ago(HOUR) })]);
  assert.equal(await eventPurge.warnFinishedEvents(), 0);
  assert.equal(emails.length, 0);
  assert.equal(updates('events').length, 0);
});

test('a failed email leaves the event unwarned AND unscheduled', async () => {
  /* The direction to be wrong in. An event that is scheduled but never warned
     is data destroyed without notice; an event that is warned late is an
     inconvenience. The stamp is therefore written only after delivery. */
  emailResult = { sent: false, skipped: 'delivery_failed' };
  warnWith([finishedEvent()]);

  assert.equal(await eventPurge.warnFinishedEvents(), 0);
  assert.equal(updates('events').length, 0, 'nothing may be scheduled when the notice did not arrive');
});

test('an already-delivered warning (dedupe) still schedules the deletion', async () => {
  /* emailService dedupes on email_log's UNIQUE (kind, ref). If a previous sweep
     sent the warning and crashed before stamping, this one gets
     `skipped: 'duplicate'` — which means the customer HAS been warned. Treating
     it as a failure would loop forever: never stamping, never scheduling, never
     deleting, silently. */
  emailResult = { sent: false, skipped: 'duplicate' };
  warnWith([finishedEvent()]);

  assert.equal(await eventPurge.warnFinishedEvents(), 1);
  assert.equal(updates('events').length, 1);
});

test('an organizer with no email address is never scheduled for deletion', async () => {
  /* The grace window is the promise that makes the deletion fair. An event
     whose owner cannot be told has not been given one, so it is left
     indefinitely rather than deleted silently. */
  warnWith([finishedEvent({ organizations: { name: 'X', email: null } })]);

  assert.equal(await eventPurge.warnFinishedEvents(), 0);
  assert.equal(emails.length, 0);
  assert.equal(updates('events').length, 0);
});

test('the warning query excludes drafts, unpaid, opted-out and already-warned events', async () => {
  warnWith([]);
  await eventPurge.warnFinishedEvents();

  const [q] = mock.calls.filter((c) => c.table === 'events' && c.op === 'select');
  assert.ok(q, 'the warn sweep must query events');
  assert.equal(eqVal(q.filters, 'is_paid'), true);
  assert.equal(eqVal(q.filters, 'purge_opt_out'), false);
  assert.ok((q.filters.is || []).some(([col, val]) => col === 'purge_warning_sent_at' && val === null),
    'already-warned events must be excluded, or the organizer is mailed on every sweep');
  assert.ok((q.filters.in || []).some(([col, vals]) => col === 'status' && !vals.includes('draft')),
    'drafts belong to draftCleanup, on a different rule');
});

test('the warning email carries the archive link and the deadline', async () => {
  warnWith([finishedEvent()]);
  await eventPurge.warnFinishedEvents();

  const html = emails[0].html;
  assert.match(html, /\/api\/v1\/events\/archive\?token=/, 'no way to download before deletion');
  assert.match(html, /\d\d:\d\d:\d\d/, 'the countdown figure is missing');
  assert.match(html, /#B23B3B/, 'the solid alert badge is missing — a tinted pill reads as decoration');
  assert.match(emails[0].subject, /deleted in \d+ hours/i);
});

/* ── Phase 2: the deletion ───────────────────────────────────────────────── */

const dueEvent = (over = {}) => ({
  id: 'evt-1', title: 'Sara & Khalid', slug: 'sara-khalid', org_id: 'org-1',
  event_date: ago(48 * HOUR), event_end_date: null,
  purge_warning_sent_at: ago(25 * HOUR), purge_scheduled_at: ago(HOUR), ...over,
});

test('a due event is logged and then deleted', async () => {
  purgeWith([dueEvent()]);
  assert.equal(await eventPurge.purgeDueEvents(), 1);

  assert.equal(inserts('event_purge_log').length, 1);
  assert.equal(deletes('events').length, 1);
});

test('THE AUDIT ROW IS WRITTEN BEFORE THE DELETE', async () => {
  /* After the DELETE there is nothing left to count, and a process that dies
     between the two writes leaves no record anywhere that the event existed.
     Written first, the worst case is a log row for a deletion that gets
     completed on the next sweep — accurate a few minutes early. */
  purgeWith([dueEvent()]);
  await eventPurge.purgeDueEvents();

  const logIdx = mock.calls.findIndex((c) => c.table === 'event_purge_log' && c.op === 'insert');
  const delIdx = mock.calls.findIndex((c) => c.table === 'events' && c.op === 'delete');
  assert.ok(logIdx !== -1 && delIdx !== -1);
  assert.ok(logIdx < delIdx, 'the purge log must be written before the cascade removes the evidence');
});

test('a failed audit write REFUSES the delete', async () => {
  // We do not destroy something we cannot record destroying.
  mock.setResolver((s) => {
    if (s.table === 'events' && s.op === 'select') return { data: [dueEvent()] };
    if (s.table === 'event_purge_log') return { error: { message: 'nope' } };
    if (s.op === 'select') return { data: [], count: 0 };
    return {};
  });

  assert.equal(await eventPurge.purgeDueEvents(), 0);
  assert.equal(deletes('events').length, 0);
});

test('the delete query never selects an event that was not warned', async () => {
  /* purge_scheduled_at is only ever written alongside purge_warning_sent_at, so
     this predicate should be redundant. It is stated anyway because it is the
     difference between "a stray UPDATE sets a date" and "data is destroyed
     without anybody being told". */
  purgeWith([]);
  await eventPurge.purgeDueEvents();

  const [q] = mock.calls.filter((c) => c.table === 'events' && c.op === 'select');
  assert.equal(eqVal(q.filters, 'purge_opt_out'), false);
  assert.ok((q.filters.not || []).some(([col]) => col === 'purge_warning_sent_at'),
    'an unwarned event must never be selectable for deletion');
  assert.ok((q.filters.lte || []).some(([col]) => col === 'purge_scheduled_at'),
    'the deadline must actually bound the query');
});

test('one event failing does not abandon the rest of the batch', async () => {
  let seen = 0;
  mock.setResolver((s) => {
    if (s.table === 'events' && s.op === 'select') return { data: [dueEvent({ id: 'bad' }), dueEvent({ id: 'good' })] };
    if (s.table === 'events' && s.op === 'delete') {
      seen += 1;
      if (seen === 1) return { error: { message: 'transient' } };
      return {};
    }
    if (s.op === 'select') return { data: [], count: 0 };
    return {};
  });

  assert.equal(await eventPurge.purgeDueEvents(), 1, 'the second event must still be purged');
});

/* ── The service is opt-in, and says so ──────────────────────────────────── */

test('the purge does not start unless it is explicitly enabled', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'eventPurge.js'), 'utf8');
  const start = src.slice(src.indexOf('function start()'));

  assert.match(start, /process\.env\.EVENT_PURGE_ENABLED !== 'true'/,
    'a service that deletes customer data must be opt-IN, not opt-out like draftCleanup');
  assert.doesNotMatch(start, /runOnce\('startup'\)/,
    'no startup prime: a deploy is when a misconfiguration is likeliest, and this must not begin deleting within 30s of boot');
  assert.match(start, /logger\.warn\(/,
    'enabling it must be a WARNING at boot, naming what will be deleted and when');
});
