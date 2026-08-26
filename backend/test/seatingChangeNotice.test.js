require('./helpers/env');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { injectModule } = require('./helpers/inject');
const { createMockSupabase } = require('./helpers/mockSupabase');

const mock = createMockSupabase();
injectModule('../../config/supabase', { supabase: mock.supabase });

const invitationService = require('../services/invitationService');
const { getQRTicketTemplate } = require('../utils/emailTemplates');
const { renderSmsBody } = require('../utils/smsTemplates');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * MOVING A GUEST ON THE SEATING MAP TELLS THEM — BY TEXT *AND* BY EMAIL.
 *
 * What was here before: seating a guest for the first time mailed them their
 * entry pass immediately and queued a text. Moving them afterwards queued the
 * text and sent NO EMAIL AT ALL — reassignSeat and saveSeatingBatch both said
 * so in a comment, on the reasoning that the pass a moved guest already holds
 * is still valid at the door.
 *
 * It is valid. checkinController re-reads the live assignment at scan time and
 * never trusts the table baked into the token, so the guest gets through the
 * gate either way. That was never the problem. The problem is that the guest is
 * holding an email that says table 7 while they are seated at table 3, and they
 * read it on the way to the venue — and for any guest with no phone number, or
 * who never consented to SMS, that email was the only thing that had ever named
 * a table to them.
 *
 * Three properties, and the third is the one that keeps this affordable:
 *
 *   1. a MOVE is mailed, in wording that says the table changed;
 *   2. a FIRST seating is mailed once, in the original wording;
 *   3. an UNCHANGED seat is not mailed again — the sweep runs every fifteen
 *      minutes forever, and a job that re-sends on every pass is worse than one
 *      that never sends.
 *
 * Nothing here needed a schema change. The `invitations` ledger already records
 * the table each pass named, so "what did we last tell this guest" is a
 * question the database can already answer.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const REPO = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

const EVENT = {
  id: 'evt-1', title: 'The Wedding', event_date: '2026-09-01T18:00:00Z',
  location_name: 'The Grand Ballroom', location_address: '1 Nile St',
  location_lat: null, location_lng: null,
};

/**
 * Scripts one party seated at `tableName`, whose last EMAILED pass named
 * `lastEmailed` (pass `undefined` for "never emailed a pass").
 *
 * Returns the list of rows written to the invitations ledger, which is what
 * the assertions read: it records both that a send happened and which table it
 * claimed.
 */
function scriptParty({ tableName, lastEmailed, lang = 'en', response = 'yes' }) {
  const written = [];
  mock.setResolver((s) => {
    if (s.table === 'rsvp_parties') {
      return {
        data: {
          id: 'p1', label: 'Sara', response, preferred_lang: lang,
          guests: [{ is_primary_contact: true, email: 'sara@example.com' }],
          seating_assignments: tableName ? [{ tables: { table_name: tableName } }] : [],
          events: EVENT,
        },
      };
    }
    if (s.table === 'invitations') {
      if (s.op === 'insert') {
        written.push(s.payload);
        return { data: { id: 'inv-1' } };
      }
      // The ledger read. `undefined` means this party has never been mailed a
      // pass at all, which is a different answer from "mailed while unseated".
      return { data: lastEmailed === undefined ? [] : [{ metadata: { tableName: lastEmailed }, sent_at: '2026-08-01T00:00:00Z' }] };
    }
    return {};
  });
  return written;
}

/** Runs a send with the documented no-API-key mock transport. */
async function send(opts) {
  const key = process.env.BREVO_API_KEY;
  delete process.env.BREVO_API_KEY;
  try {
    return await invitationService.sendQrTicketEmail('evt-1', 'p1', opts);
  } finally {
    if (key !== undefined) process.env.BREVO_API_KEY = key;
  }
}

/* ── 1. A move is mailed, and says so ─────────────────────────────────────── */

test('a guest moved to another table is emailed again, flagged as a change', async () => {
  const written = scriptParty({ tableName: 'Table 3', lastEmailed: 'Table 7' });
  const res = await send({ skipIfUnchanged: true });

  assert.equal(res.sent, true, 'a moved guest must be mailed');
  assert.equal(res.changed, true, 'and the mail must know it is correcting an earlier one');
  assert.equal(written.length, 1, 'the send belongs in the invitations ledger');
  assert.equal(written[0].metadata.tableName, 'Table 3',
    'the ledger must record the NEW table, or the next move cannot be detected');
  assert.equal(written[0].metadata.changed, true);
});

/* ── 2. A first seating is mailed, in the original wording ───────────────── */

test('a guest seated for the first time gets the ordinary entry pass', async () => {
  // The counterweight. A rule that mails nothing unless it can prove a change
  // would silently drop the pass for every newly seated guest.
  scriptParty({ tableName: 'Table 3', lastEmailed: undefined });
  const res = await send({ skipIfUnchanged: true });

  assert.equal(res.sent, true);
  assert.equal(res.changed, false,
    'nothing changed for a guest who is hearing about their table for the first time');
});

/* ── 3. The same seat is never mailed twice ──────────────────────────────── */

test('a guest whose table did not change is not mailed a second time', async () => {
  /**
   * This is the case that makes the whole design safe to run on a schedule.
   *
   * assignSeat mails the pass the instant an organizer seats someone. Ten
   * minutes later the seating sweep reaches the same queue row and calls this
   * again. Without the skip, every guest on a 300-person chart would receive
   * two identical entry passes, and the organizer would be the one who heard
   * about it.
   */
  const written = scriptParty({ tableName: 'Table 3', lastEmailed: 'Table 3' });
  const res = await send({ skipIfUnchanged: true });

  assert.equal(res.sent, false);
  assert.equal(res.reason, 'UNCHANGED');
  assert.equal(written.length, 0, 'a skipped send must not be written to the ledger either');
});

test('an unseated guest who was mailed while unseated is not re-mailed', () => {
  // `null` (mailed with no table) and `undefined` (never mailed) have to stay
  // distinct — collapsing them with `|| null` makes every never-mailed guest
  // look like they were already told, and the pass stops going out at all.
  const src = read('services/invitationService.js');
  assert.match(src, /return t === undefined \? null : t;/,
    'lastEmailedTable must not collapse "never sent" into "sent with no table"');
});

/* ── 4. The mail actually reads differently ──────────────────────────────── */

test('the changed pass leads with the change, not with "here is your pass"', () => {
  const rsvp = { id: 'p1', guest_name: 'Sara', party_size: 2 };
  const plain = getQRTicketTemplate(rsvp, EVENT, { tableName: 'Table 3', links: {} });
  const moved = getQRTicketTemplate(rsvp, EVENT, { tableName: 'Table 3', links: {}, changed: true });

  assert.match(moved, /Your table has changed/);
  assert.match(moved, /out of date/,
    'the guest has to be told the earlier email is superseded, or they trust it');
  assert.doesNotMatch(plain, /has changed/,
    'a first pass must not claim something changed');

  // The QR, the party size and the venue are all still correct on a move — only
  // the framing changes. A variant that dropped the pass would be worse than
  // the silence it replaced.
  assert.match(moved, /Admits/);
  assert.match(moved, /Grand Ballroom/);
});

test('the Arabic guest gets an Arabic change notice', async () => {
  scriptParty({ tableName: 'Table 3', lastEmailed: 'Table 7', lang: 'ar' });
  const res = await send({ skipIfUnchanged: true });
  assert.equal(res.sent, true);

  const html = getQRTicketTemplate(
    { id: 'p1', guest_name: 'سارة', party_size: 2 },
    EVENT,
    { tableName: 'Table 3', links: {}, lang: 'ar', changed: true },
  );
  assert.match(html, /تغيّرت طاولتك/);
  assert.match(html, /dir="rtl"/);
});

test('an unseated guest is never told their table "changed" to nothing', async () => {
  /**
   * The reachable case: a guest is seated at 7, emailed, then UNSEATED. The
   * ledger says "Table 7", the live assignment says null, and "different"
   * is satisfied — so the derived wording announced a change and the notice
   * rendered the sentence "Your table is now ." with a hole in it.
   *
   * It is reachable from the organizer's "Resend QR ticket" button, which
   * passes no options at all and lets the wording be derived.
   */
  scriptParty({ tableName: null, lastEmailed: 'Table 7' });
  const res = await send({});
  assert.equal(res.sent, true, 'they should still get their pass');
  assert.equal(res.changed, false, 'but with no table there is nothing to announce a change to');

  // And the template refuses it independently, so a caller passing the flag by
  // hand cannot reintroduce the empty sentence.
  const html = getQRTicketTemplate(
    { id: 'p1', guest_name: 'Sara', party_size: 2 }, EVENT,
    { tableName: null, links: {}, changed: true },
  );
  assert.ok(!/Your table is now\s*\./.test(html), 'rendered a sentence with nothing in it');
  assert.ok(!html.includes('Your table has changed'),
    'the eyebrow and preheader must agree with the body');
  assert.match(html, /Assigned when you arrive/, 'the ordinary unseated wording is correct here');
});

test('the entry pass does not depend on a column the migration chain may not have', () => {
  /**
   * `rsvp_parties.preferred_lang` arrives in 20260821000000, part of the SMS
   * chain this deployment has a history of not having applied. PostgREST fails
   * the WHOLE select when one requested column is missing, so putting it on the
   * party query would turn an unapplied migration into PARTY_NOT_FOUND — and
   * this function is what assignSeat's automatic pass and the organizer's
   * resend button both call. Neither needed the column before.
   */
  const src = read('services/invitationService.js');
  const start = src.indexOf('async function sendQrTicketEmail');
  const body = src.slice(start, src.indexOf('\n}', start));
  assert.ok(!body.includes('preferred_lang'),
    'preferred_lang must not be on sendQrTicketEmail\'s main select');
  assert.match(body, /await partyLang\(partyId\)/);
  // and the isolated read degrades to English rather than throwing
  const helper = src.slice(src.indexOf('async function partyLang'));
  assert.match(helper.slice(0, 400), /return 'en'/);
});

test('the subject line carries the news, in the guest\'s language', () => {
  // Two identical subjects in an inbox read as a duplicate, and the second one
  // — the correct one — is the one that gets ignored.
  const src = read('services/invitationService.js');
  assert.match(src, /Your table has changed: \$\{event\.title\}/);
  assert.match(src, /تغيّرت طاولتك – \$\{event\.title\}/);
});

/* ── 5. The text says it too ─────────────────────────────────────────────── */

test('the table text states the table plainly', () => {
  const base = {
    guestName: 'Sara', eventTitle: 'The Wedding', tableName: 'Table 3',
    ticketUrl: 'https://fancyrsvp.com/i/Ab3xK9',
  };
  assert.match(renderSmsBody('seating_reminder', 'en', base), /Your table at The Wedding is Table 3/);
  assert.match(renderSmsBody('seating_reminder', 'ar', base), /طاولتك/);
});

test('no text can claim a table changed', () => {
  /**
   * The "has changed to" / "تغيّرت طاولتك" wording is GONE, along with the
   * seating text it was written for. This type now fires from one place only —
   * the day-before sweep — where it is the guest's first and only text about
   * their table and so has nothing to contradict.
   *
   * Pinned as an absence rather than deleted outright: a `changed` flag is the
   * obvious thing to reach for the next time someone wires a move to SMS, and
   * a template that silently accepts and ignores it would read as working.
   */
  const base = {
    guestName: 'Sara', eventTitle: 'The Wedding', tableName: 'Table 3',
    ticketUrl: 'https://fancyrsvp.com/i/Ab3xK9',
  };
  ['en', 'ar'].forEach((lang) => {
    const plain = renderSmsBody('seating_reminder', lang, base);
    const withFlag = renderSmsBody('seating_reminder', lang, { ...base, changed: true });
    assert.equal(withFlag, plain, `a stray changed flag must not alter the ${lang} body`);
  });
  assert.doesNotMatch(renderSmsBody('seating_reminder', 'en', base), /changed/);
  assert.doesNotMatch(renderSmsBody('seating_reminder', 'ar', base), /تغيّرت/);
});

/* ── 6. The sweep is wired to all of it ──────────────────────────────────── */

const seatingSweepBody = () => {
  const src = read('services/emailScheduler.js');
  const start = src.indexOf('async function jobSeatingNotices');
  assert.notEqual(start, -1, 'jobSeatingNotices was renamed — this file is pinned to it');
  return src.slice(start, src.indexOf('\n}', start));
};

test('the seating sweep mails the pass', () => {
  const body = seatingSweepBody();
  assert.match(body, /sendQrTicketEmail\(/, 'the sweep must send the email');
  assert.match(body, /skipIfUnchanged: true/,
    'without the skip, every scheduler pass re-sends the same pass forever');
});

test('the seating sweep sends NO text', () => {
  /**
   * The seating text was retired on request. This sweep is the only thing that
   * ever sent it, so its absence here IS the removal — pinned so that a future
   * change cannot quietly reinstate a charged message on every drag of a chart.
   *
   * The `seating_reminder` TYPE deliberately survives: jobEventReminders still
   * texts it in the 24 hours before the event, under the `evday:` ref. So this
   * has to be asserted about the sweep specifically and not about the file.
   */
  const body = seatingSweepBody();
  assert.doesNotMatch(body, /sendTransactionalSms/, 'seating a guest must not send a text');
  assert.doesNotMatch(body, /seat:\$\{/, 'the seat: SMS idempotency ref should be gone with it');
});

test('the day-before text still exists, and is the only one left', () => {
  // Guards the other half: "remove the seating text" must not become "remove
  // the table text", which would leave guests with no text about their table.
  const src = read('services/emailScheduler.js');
  const start = src.indexOf('async function jobEventReminders');
  const body = src.slice(start, src.indexOf('\n}', start));
  assert.match(body, /type: 'seating_reminder'/);
  assert.match(body, /ref: `evday:\$\{party\.id\}`/,
    'the day-before ref is evday:, and it is now the only ref this type uses');
});

test('the per-channel move ledger is gone with the text it served', () => {
  /**
   * `textedADifferentTable` read sms_log for `seat:<party>:%` to decide whether
   * a text should say "your table has changed". With no seating text, there is
   * no such decision, and the query was the scheduler's only reason to read
   * sms_log at all.
   *
   * The EMAIL keeps its own equivalent — sendQrTicketEmail asks the invitations
   * ledger what it last delivered — which is what makes skipIfUnchanged work.
   */
  const src = read('services/emailScheduler.js');
  // Matched WITH the paren: the identifier still appears in the prose above the
  // sweep explaining what was removed and why, which is worth keeping. What
  // must not come back is a declaration or a call.
  assert.doesNotMatch(src, /textedADifferentTable\(/,
    'a helper with no callers reads as a live feature to whoever finds it next');
  assert.doesNotMatch(src, /\.from\('sms_log'\)/);
});
