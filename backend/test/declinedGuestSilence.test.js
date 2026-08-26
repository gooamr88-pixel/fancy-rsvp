require('./helpers/env');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { injectModule } = require('./helpers/inject');
const { createMockSupabase } = require('./helpers/mockSupabase');

/**
 * Injected at the top of the file, before anything else is required.
 *
 * config/supabase is a singleton captured at require-time by every module that
 * touches the database, so replacing it after one of them has loaded leaves that
 * module holding the real client — which then tries to reach a Supabase that is
 * not there and fails seven seconds later with a message ("RSVP_NOT_FOUND") that
 * looks like a legitimate assertion failure rather than a mis-wired test.
 */
const mock = createMockSupabase();
injectModule('../../config/supabase', { supabase: mock.supabase });
const notificationService = require('../utils/notificationService');

/** Script the one party row every behavioural test below reads. */
const partyAt = (response) => () => mock.setResolver((s) => (s.table === 'rsvp_parties' ? {
  data: {
    id: 'p1', label: 'Sara', response,
    guests: [{ is_primary_contact: true, email: 'sara@example.com' }],
    events: { title: 'The Wedding', event_date: '2026-09-01T18:00:00Z' },
  },
} : {}));

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A GUEST WHO SAID NO HEARS NOTHING ELSE.
 *
 * One rule, spread across nine send sites in five files, which is exactly the
 * arrangement where it holds everywhere until somebody adds a tenth. A declined
 * guest may receive precisely ONE message — the thank-you acknowledging the
 * decline itself, sent once at submit time — and after that:
 *
 *   ✗ no RSVP confirmation          ✗ no entry pass / QR ticket
 *   ✗ no day-before reminder        ✗ no table / seating notice
 *   ✗ no post-event thank-you       ✗ no SMS of any kind
 *
 * Two of these are money and one is a door. The entry-pass mail carries a QR the
 * scanner honours, so mailing it to somebody who declined does not merely annoy
 * them — it admits them. The SMS legs are billed to the organizer's balance, so a
 * message to a guest who is not coming is spend on nothing.
 *
 * ── Why the assertions are mostly static ──
 *
 * Each gate is one line in a Supabase filter chain (`.eq('response', 'yes')`) or
 * one early return. Standing a full query mock in front of six schedulers to
 * observe six absences would test the mock; reading the filter proves the row
 * never leaves the database. The one behavioural test below covers the gate that
 * is NOT a query filter — the organizer's manual resend — because that one is
 * reachable by an HTTP request and has to refuse rather than silently no-op.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const REPO = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

/** The body of a named function, from its declaration to the next top-level `}`. */
const fnBody = (src, decl) => {
  const start = src.indexOf(decl);
  assert.notEqual(start, -1, `${decl} not found — this test is pinned to a function that was renamed`);
  const rest = src.slice(start);
  const end = rest.indexOf('\n}');
  return rest.slice(0, end === -1 ? rest.length : end);
};

/* ── The automatic sweeps ─────────────────────────────────────────────────── */

const scheduler = read('services/emailScheduler.js');

/**
 * Both guest-facing sweeps now read their audience through one paged helper
 * rather than each running its own `.eq('response', 'yes')`, so the rule is
 * pinned where it actually lives. Asserted once here, and each caller is
 * asserted to go through it — a job that hand-rolled its own query again would
 * fail the caller test, not slip past this one.
 */
test('the shared guest fetch selects only parties at yes', () => {
  const body = fnBody(scheduler, 'async function fetchConfirmedParties');
  assert.match(body, /\.eq\('response', 'yes'\)/,
    'fetchConfirmedParties is the single audience filter for the guest sweeps');
});

test('the day-before reminder goes to confirmed guests only', () => {
  // Carries the table AND the entry pass, so a leak here is the door case.
  const body = fnBody(scheduler, 'async function jobEventReminders');
  assert.match(body, /fetchConfirmedParties\(/,
    'jobEventReminders must take its audience from the confirmed-only fetch');
  assert.doesNotMatch(body, /\.from\('rsvp_parties'\)/,
    'jobEventReminders must not query guests directly — that bypasses the audience filter');
});

test('the RSVP nudge chases only guests who have not answered', () => {
  // A guest who said no HAS answered. Chasing them for an answer they already
  // gave is the most obviously wrong message on this list.
  const body = fnBody(scheduler, 'async function jobRsvpReminders');
  assert.match(body, /\.eq\('response', 'pending'\)/,
    'jobRsvpReminders must select only parties at pending');
});

test('the post-event thank-you goes to attendees only', () => {
  const body = fnBody(scheduler, 'async function jobPostEvent');
  assert.match(body, /fetchConfirmedParties\(/,
    'jobPostEvent must thank only the guests who came');
  assert.doesNotMatch(body, /\.from\('rsvp_parties'\)/,
    'jobPostEvent must not query guests directly — that bypasses the audience filter');
});

test('the seating notice is not texted to somebody who declined after being seated', () => {
  // An organizer can seat a guest and the guest can decline afterwards; the
  // assignment row outlives the intention to attend, so the response is re-read
  // at send time rather than trusted from the queue.
  const body = fnBody(scheduler, 'async function jobSeatingNotices');
  assert.match(body, /party\.response === 'yes'/,
    'jobSeatingNotices must re-check the live response before texting a table');
});

test('a cancellation or date change is not sent to somebody who declined', () => {
  // Pinned in full by notifiableAudienceContract.test.js; asserted here too so
  // this file is a complete statement of the rule rather than a partial one.
  const { NOTIFIABLE_RESPONSES } = require('../services/emailScheduler');
  assert.ok(!NOTIFIABLE_RESPONSES.includes('no'));
});

/* ── The manual, organizer-triggered sends ───────────────────────────────── */

test('the entry pass refuses a declined party', () => {
  const body = fnBody(read('services/invitationService.js'), 'async function sendQrTicketEmail');
  assert.match(body, /party\.response === 'no'/);
  assert.match(body, /throw new Error\('NOT_ATTENDING'\)/,
    'the QR must be refused loudly — it opens the door if it is ever delivered');
});

test('the full-detail confirmation text skips anyone who is not attending', () => {
  const src = read('services/invitationService.js');
  assert.match(
    src,
    /type === 'rsvp_confirmation' && party\.response !== 'yes'/,
    'the detail SMS must be gated on an accepted response',
  );
});

/* ── The two live submit paths ───────────────────────────────────────────── */

test('submitting a decline sends the thank-you and nothing else', () => {
  const src = read('controllers/rsvpController.js');

  // The confirmation branch. `no` must not be able to reach it.
  assert.match(
    src,
    /if \(result\.response === 'yes' \|\| result\.response === 'maybe'\) \{/,
    'the confirmation email branch must name the two accepted responses explicitly',
  );
  // The billed confirmation text is narrower still — 'maybe' has no table, no
  // meals and no pass, so there is nothing for it to carry. Read from the SMS
  // call site backwards rather than by matching across a line break: the repo is
  // checked out with CRLF endings on Windows, where a `\n` in a pattern silently
  // never matches.
  const smsCall = src.slice(0, src.indexOf("type: 'rsvp_confirmation'"));
  const lastGate = smsCall.lastIndexOf("result.response === ");
  assert.notEqual(lastGate, -1, 'the rsvp_confirmation SMS must sit behind a response check');
  assert.match(
    smsCall.slice(lastGate, lastGate + 40),
    /result\.response === 'yes'/,
    'the rsvp_confirmation SMS must fire for an accepted response only',
  );
  // And the one message a decline DOES get.
  assert.match(src, /getDeclineConfirmationTemplate/,
    'a decline is still acknowledged once — silence reads as "my reply was lost"');
});

test('the one-click token path applies the same rule', () => {
  const src = read('controllers/rsvpController.js');
  assert.match(
    src,
    /if \(mapped === 'yes' \|\| mapped === 'maybe'\) \{/,
    'the token RSVP path must gate its confirmation the same way as the public form',
  );
});

/* ── The gate that is reachable over HTTP ────────────────────────────────── */

/**
 * The organizer's resend endpoint — POST .../notifications/send-confirmation.
 *
 * This is the one that was actually open. It read the party row to fill in the
 * response, then rendered the confirmation for whatever it found, so a party at
 * 'no' got a mail whose subject and eyebrow both said "RSVP confirmed" over a
 * body row reading "Declined". The template's own copy has no branch for a
 * decline — only for a 'maybe' — so there was no wording that could have made
 * that email correct.
 */
test('resending a confirmation to a declined party is refused, not rendered', async () => {
  partyAt('no')();

  // Asserted as well as the throw: a refusal that still handed the message to
  // Brevo on the way out would satisfy `rejects` and deliver the email anyway.
  const sends = [];
  const originalFetch = global.fetch;
  global.fetch = async (...args) => { sends.push(args); return { ok: true, text: async () => '' }; };

  try {
    await assert.rejects(
      () => notificationService.sendConfirmationEmail('evt-1', 'p1', 'en'),
      /NOT_ATTENDING/,
    );
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(sends.length, 0, 'nothing may reach the mail provider for a declined party');
});

test('a pending party is refused too — nobody is told a place they never claimed is confirmed', async () => {
  partyAt('pending')();
  await assert.rejects(
    () => notificationService.sendConfirmationEmail('evt-1', 'p1', 'en'),
    /NOT_ATTENDING/,
  );
});

test('an accepted party still gets its confirmation', async () => {
  // The counterweight. A gate that refuses everything passes every test above
  // and breaks the product.
  partyAt('yes')();
  const originalKey = process.env.BREVO_API_KEY;
  delete process.env.BREVO_API_KEY; // takes the documented mock-send path

  try {
    const ok = await notificationService.sendConfirmationEmail('evt-1', 'p1', 'en');
    assert.equal(ok, true);
  } finally {
    if (originalKey !== undefined) process.env.BREVO_API_KEY = originalKey;
  }
});

test('a maybe still gets its confirmation — the copy already adapts for it', async () => {
  partyAt('maybe')();
  const originalKey = process.env.BREVO_API_KEY;
  delete process.env.BREVO_API_KEY;
  try {
    assert.equal(await notificationService.sendConfirmationEmail('evt-1', 'p1', 'en'), true);
  } finally {
    if (originalKey !== undefined) process.env.BREVO_API_KEY = originalKey;
  }
});

/* ── The controller's answer to the organizer ────────────────────────────── */

test('the refusal reaches the organizer as a 400, not a generic failure', () => {
  const src = read('controllers/notificationController.js');
  const body = fnBody(src, 'const sendConfirmationEmail = async');
  assert.match(body, /NOT_ATTENDING/,
    'the controller must translate the refusal — otherwise it surfaces as "no email on file"');
});
