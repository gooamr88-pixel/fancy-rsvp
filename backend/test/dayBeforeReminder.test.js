require('./helpers/env');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { renderSmsBody } = require('../utils/smsTemplates');
const { computeSmsSegments } = require('../utils/smsSegments');
const { getSmsType } = require('../config/smsMessageTypes');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const SCHEDULER = read('services/emailScheduler.js');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DAY-BEFORE MESSAGE, AND EVERY PIECE IT HAS TO CARRY.
 *
 * A guest standing outside a venue an hour before an event needs four things,
 * and each one has gone missing independently at least once:
 *
 *   who/what/when   the event and the date
 *   their table     which has been null before, when the sweep window and the
 *                   seating-reveal window disagreed
 *   a way IN        the QR entry pass
 *   a way THERE     directions to the venue
 *
 * These are contract tests over the wiring rather than a live send: the send
 * itself is gated on a carrier, credits, consent and an env flag, none of which
 * exist here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/* ── 1. The window, and the table that depends on it ─────────────────────── */

test('no run-up message can fire before the seating chart is revealed', () => {
  /* THE INVARIANT, NOT THE LITERAL.
   *
   * This used to assert the source text `const EVENT_REMINDER_WINDOW_MS = DAY;`
   * against a single window. There are three now — T-24h email, T-6h email,
   * T-2h text — and a string match would have to be rewritten every time one
   * moves, which is how a test stops meaning anything.
   *
   * What actually has to hold is the RELATIONSHIP the original was protecting.
   * These messages name the guest's table; `guestService.SEATING_REVEAL_WINDOW_MS`
   * decides when the ticket page will show it. A window WIDER than the reveal
   * sends a message promising a table against a page that still says "not yet",
   * which is the disagreement that once meant the only reminder any guest
   * received was the one that could not name their table.
   *
   * Asserted as a comparison, so retiming any mark is free and widening one
   * past the reveal fails here. */
  const {
    EVENT_REMINDER_WINDOW_MS, FINAL_CALL_WINDOW_MS, SMS_REMINDER_WINDOW_MS,
  } = require('../services/emailScheduler');
  const { SEATING_REVEAL_WINDOW_MS } = require('../services/guestService');

  assert.ok(Number.isFinite(SEATING_REVEAL_WINDOW_MS) && SEATING_REVEAL_WINDOW_MS > 0,
    'guestService no longer exports a seating reveal window to compare against');

  for (const [name, ms] of [
    ['EVENT_REMINDER_WINDOW_MS', EVENT_REMINDER_WINDOW_MS],
    ['FINAL_CALL_WINDOW_MS', FINAL_CALL_WINDOW_MS],
    ['SMS_REMINDER_WINDOW_MS', SMS_REMINDER_WINDOW_MS],
  ]) {
    assert.ok(ms <= SEATING_REVEAL_WINDOW_MS,
      `${name} (${ms}ms) fires before the seating chart is revealed (${SEATING_REVEAL_WINDOW_MS}ms) — guests would be told a table the ticket page still hides`);
  }
});

test('the three run-up marks are strictly ordered, widest first', () => {
  /* Each sweep selects `event_date <= now + window`, so the windows NEST: the
     2h one sits inside the 6h one, which sits inside the 24h one. That nesting
     is what makes each mark get crossed exactly once, in order.
     Mis-order them and the text arrives before the email that was meant to
     precede it — no error, just the wrong sequence for every guest. */
  const {
    EVENT_REMINDER_WINDOW_MS, FINAL_CALL_WINDOW_MS, SMS_REMINDER_WINDOW_MS,
  } = require('../services/emailScheduler');

  assert.ok(EVENT_REMINDER_WINDOW_MS > FINAL_CALL_WINDOW_MS,
    'the day-before email no longer precedes the final-call email');
  assert.ok(FINAL_CALL_WINDOW_MS > SMS_REMINDER_WINDOW_MS,
    'the final-call email no longer precedes the reminder text');
});

test('each run-up mark is served by its own job, on its own channel', () => {
  /* The split is the point: one job sending both channels at one mark is what
     this replaced. A single job regaining both would silently restore it. */
  const { ALARMS } = require('../services/emailScheduler');
  assert.deepEqual(ALARMS.map((a) => a.name), ['event_reminders', 'final_call', 'sms_reminders']);

  const smsJob = SCHEDULER.slice(SCHEDULER.indexOf('async function jobSmsEventReminders'));
  const smsBody = smsJob.slice(0, smsJob.indexOf('\n}\n'));
  assert.doesNotMatch(smsBody, /dispatchWithRetry/,
    'the T-2h job sends email again — the two channels were split on purpose');

  const emailJob = SCHEDULER.slice(SCHEDULER.indexOf('async function jobEventReminders'));
  const emailBody = emailJob.slice(0, emailJob.indexOf('\n}\n'));
  assert.doesNotMatch(emailBody, /trySms|sendTransactionalSms/,
    'the T-24h job texts again — the text moved to T-2h');
});

test('the day-before text uses a ref that cannot collide with the seating one', () => {
  // `seat:<party>:<table>` vs `evday:<party>:<date>`. Sharing a key means one
  // of the two is silently dropped as a duplicate. The PREFIX is what keeps
  // them apart; the date suffix exists so that rescheduling an event mints a
  // new key and the reminder can go again.
  assert.match(SCHEDULER, /ref: `evday:\$\{party\.id\}:\$\{dateKey\}`/);
  assert.ok(!/ref: `seat:\$\{party\.id\}`(?=[\s\S]*jobEventReminders)/.test(SCHEDULER));
});

/* ── 2. What the text actually says ──────────────────────────────────────── */

test('the reminder text names the guest, the event, the date, the table and the pass', () => {
  const body = renderSmsBody('seating_reminder', 'en', {
    guestName: 'Sara', eventTitle: 'The Wedding', dateLabel: 'Saturday 12 September',
    tableName: 'Table 7', ticketUrl: 'https://fancyrsvp.com/i/Ab3xK9',
  });
  assert.match(body, /Sara/);
  assert.match(body, /The Wedding/);
  assert.match(body, /Saturday 12 September/);
  assert.match(body, /Table 7/);
  assert.match(body, /https:\/\/fancyrsvp\.com\/i\/Ab3xK9/);
});

test('it still works for an event with no seating chart at all', () => {
  // A standing reception has no tables and the guest still needs the door.
  const body = renderSmsBody('seating_reminder', 'en', {
    guestName: 'Sara', eventTitle: 'The Party', tableName: null, dateLabel: null,
    ticketUrl: 'https://fancyrsvp.com/i/Ab3xK9',
  });
  assert.match(body, /https:\/\/fancyrsvp\.com\/i\/Ab3xK9/);
  assert.doesNotMatch(body, /null|undefined/);
});

test('the scheduler passes the table and the ticket link into the text', () => {
  // The template can only render what the caller supplies.
  assert.match(SCHEDULER, /type: 'seating_reminder'/);
  assert.match(SCHEDULER, /tableName,/);
  assert.match(SCHEDULER, /ticketUrl: links\?\.ticketUrl \|\| null/);
});

test('a text never replaces the email that carries the scannable pass', () => {
  // An SMS cannot hold a QR image, only a link to it.
  assert.equal(getSmsType('seating_reminder').replacesEmail, false);
});

/* ── 3. Directions: on the page, not in the text ─────────────────────────── */

test('the ticket endpoint returns the venue COORDINATES, not just an address', () => {
  /* A directions link built from a free-typed address drops the guest at
     whatever Google matches, rather than at the pin the organizer placed —
     on the one screen they open while standing outside. */
  const controller = read('controllers/rsvpController.js');
  const block = controller.slice(controller.indexOf('const eventBrief = {'));
  assert.match(block.slice(0, 400), /location_lat: event\.location_lat/);
  assert.match(block.slice(0, 400), /location_lng: event\.location_lng/);
});

test('adding the map link to the TEXT would cost a segment, so it is on the page', () => {
  /* This is the measurement the decision rests on, kept executable so it is
     re-checked rather than remembered. A shortened link plus a label is ~43
     units; if either language ever has that much slack, putting the link in
     the text becomes affordable and this test should be revisited. */
  const worst = {
    guestName: 'Abdelrahman El-Sharkawy',
    eventTitle: 'Yara & Hisham Abdelaziz Wedding Party',
    dateLabel: 'Saturday 12 September 2026',
    tableName: 'Top Table 12',
    ticketUrl: 'https://fancyrsvp.com/i/Ab3xK9',
  };
  const { COMPLIANCE_FOOTER } = require('../services/smsDispatch');
  const slackOf = (lang) => {
    const s = computeSmsSegments(renderSmsBody('seating_reminder', lang, worst) + COMPLIANCE_FOOTER);
    return s.segments * (/GSM/.test(s.encoding) ? 153 : 67) - s.length;
  };
  // Arabic is the binding constraint: 4 segments would become 5 for every
  // guest on every event.
  assert.ok(slackOf('ar') < 43,
    `Arabic now has ${slackOf('ar')} units of slack — a directions link may be affordable in the text`);
});

/* ── 4. The switch that turns the whole thing on ─────────────────────────── */

test('a disabled scheduler is a WARNING that names what is not being sent', () => {
  /* The flag is unset by default, so the likeliest state of a deployment is
     "no guest has ever been reminded" — previously reported as one `info`
     among a hundred at boot, indistinguishable from a healthy startup. */
  const start = SCHEDULER.slice(SCHEDULER.indexOf('function start()'));
  assert.match(start, /logger\.warn\(/, 'a disabled scheduler no longer warns');
  assert.match(start, /DISABLED/);
  assert.match(start, /EMAIL_AUTOMATION_ENABLED=true/);
});

test('the deployment guide tells you to set it', () => {
  // It was absent from the .env template, so a by-the-book install had
  // lifecycle messaging off.
  const guide = read('../deployment/README.md');
  assert.match(guide, /EMAIL_AUTOMATION_ENABLED=true/,
    'the deployment .env template does not set EMAIL_AUTOMATION_ENABLED');

  const example = read('.env.production.example');
  assert.match(example, /^EMAIL_AUTOMATION_ENABLED=true$/m,
    'the example env still leaves lifecycle messaging commented out');
});
