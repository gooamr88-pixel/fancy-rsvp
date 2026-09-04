require('./helpers/env');
const { test } = require('node:test');
const t = require('node:test');
const assert = require('node:assert/strict');
const { createMockSupabase } = require('./helpers/mockSupabase');
const { mockReq, invoke } = require('./helpers/http');
const { injectModule } = require('./helpers/inject');

// submitPublicRSVP now delegates the whole write to the submit_rsvp() RPC. These
// unit tests verify the CONTROLLER contract: DB-free shape validation, correct
// mapping of every RPC result code to an HTTP status, and the best-effort
// side-effects (broadcast + emails). The RPC's own logic (atomicity, concurrency,
// meal rules) is proven in test/integration/rsvpSubmitConcurrency.test.js.
let confirmCalls = [];
let emailCalls = [];
injectModule('../../utils/notificationService', {
  sendEmailViaBrevo: async (...a) => { emailCalls.push(a); return true; },
  sendConfirmationEmail: async (...a) => { confirmCalls.push(a); return true; },
  sendInvitationEmail: async () => ({ sent: true }),
  sendQRTicketEmail: async () => true,
});
injectModule('../../utils/realtime', { broadcast: async () => {} });

const mock = createMockSupabase();
injectModule('../../config/supabase', { supabase: mock.supabase });

const { submitPublicRSVP, claimRsvpByEmail } = require('../controllers/rsvpController');

t.beforeEach(() => { mock.reset(); confirmCalls = []; emailCalls = []; });

// submitPublicRSVP requires an email for ATTENDING guests. The PHONE is optional
// for everyone (Twilio TFV 30475) and is only format-checked when supplied, and
// SMS consent is never required — it is recorded as given (true or false) and
// enforced only at send time. See rsvpController.submitPublicRSVP. Most payloads
// here RSVP "yes", so inject the attending requirements as defaults to clear
// that gate; tests exercising a specific branch override the relevant field (or
// build a bare request via mockReq directly).
const REQUIRED_DEFAULTS = { phone: '+15551234567', smsConsent: true, email: 'guest@example.com' };
const req = (body) => mockReq({ params: { slug: 'wedding' }, body: { ...REQUIRED_DEFAULTS, ...body } });
const rpcResult = (data) => mock.setResolver((s) => (s.op === 'rpc' && s.fn === 'submit_rsvp_v2' ? { data } : {}));

// ── Controller-side shape validation (no RPC should be issued) ──

test('guestName and response are required (400, no RPC)', async () => {
  mock.setResolver(() => ({}));
  const { res } = await invoke(submitPublicRSVP, req({ guestName: '', response: '' }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'VALIDATION_ERROR');
  assert.equal(mock.calls.some(c => c.op === 'rpc'), false);
});

test('party_size > 1 with too few additional guests is rejected before any RPC (400)', async () => {
  mock.setResolver(() => ({}));
  const { res } = await invoke(submitPublicRSVP, req({ guestName: 'A', response: 'yes', partySize: 3, additionalGuests: [{ fullName: 'B' }] }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'VALIDATION_ERROR');
  assert.equal(mock.calls.some(c => c.op === 'rpc'), false);
});

test('an additional guest without a name is rejected (400, no RPC)', async () => {
  mock.setResolver(() => ({}));
  const { res } = await invoke(submitPublicRSVP, req({ guestName: 'A', response: 'yes', partySize: 2, additionalGuests: [{ fullName: '   ' }] }));
  assert.equal(res.statusCode, 400);
  assert.equal(mock.calls.some(c => c.op === 'rpc'), false);
});

/* ── Phone and SMS consent: BOTH REQUIRED since 2026-09-04 ─────────────────
 *
 * These three tests previously asserted the opposite, and the inversion is
 * deliberate rather than a regression. Between 2026-08-01 and 2026-09-04 a
 * guest could RSVP with no number and an unticked consent box, so that
 * "agreeing to receive messages" was genuinely optional under Twilio TFV 30475.
 * On the product owner's explicit instruction both are now required to submit.
 *
 * The full context, the risk, and the required Twilio re-filing live in
 * frontend/src/app/components/guest/SmsConsentText.js. Read it before inverting
 * these back.
 *
 * What has NOT changed, and what the last test here pins: consent is still
 * verified at SEND time by smsDispatch's gate chain. A required checkbox is a
 * collection rule and must never become a substitute for that.
 */

test('an attending RSVP with NO phone is rejected (400, no RPC)', async () => {
  mock.setResolver(() => ({}));
  const { res } = await invoke(submitPublicRSVP, mockReq({ params: { slug: 'wedding' }, body: { guestName: 'Alice', response: 'yes', partySize: 1, email: 'a@x.com', smsConsent: true } }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'VALIDATION_ERROR');
  assert.equal(mock.calls.some(c => c.op === 'rpc'), false, 'nothing may be written without a number');
});

test('a malformed phone is still rejected when one IS supplied (400, no RPC)', async () => {
  mock.setResolver(() => ({}));
  const { res } = await invoke(submitPublicRSVP, mockReq({ params: { slug: 'wedding' }, body: { guestName: 'Alice', response: 'yes', partySize: 1, email: 'a@x.com', phone: 'not-a-number', smsConsent: true } }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'VALIDATION_ERROR');
  assert.equal(mock.calls.some(c => c.op === 'rpc'), false);
});

test('a phone with SMS consent REFUSED is rejected (400 SMS_CONSENT_REQUIRED, no RPC)', async () => {
  mock.setResolver(() => ({}));
  const { res } = await invoke(submitPublicRSVP, mockReq({ params: { slug: 'wedding' }, body: { guestName: 'Alice', response: 'yes', partySize: 1, email: 'a@x.com', phone: '+15551234567', smsConsent: false } }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'SMS_CONSENT_REQUIRED',
    'its own error code, so the client can put the message under the checkbox rather than at the top of the form');
  assert.equal(mock.calls.some(c => c.op === 'rpc'), false);
});

test('an ABSENT consent field is a refusal, not a pass', async () => {
  // The case the check exists for: a client that simply omits the key. An
  // `=== false` test would let this through and write a party the organizer
  // believes is textable and never can be.
  mock.setResolver(() => ({}));
  const { res } = await invoke(submitPublicRSVP, mockReq({ params: { slug: 'wedding' }, body: { guestName: 'Alice', response: 'yes', partySize: 1, email: 'a@x.com', phone: '+15551234567' } }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'SMS_CONSENT_REQUIRED');
  assert.equal(mock.calls.some(c => c.op === 'rpc'), false);
});

test('a supplied phone WITH SMS consent is accepted and records the opt-in', async () => {
  rpcResult({ success: true, party_id: 'r1', is_update: false, event_id: 'evt-1', event_title: 'W', response: 'no', party_size: 1, guest_email: null, notification_preferences: { email: false } });
  const { res } = await invoke(submitPublicRSVP, mockReq({ params: { slug: 'wedding' }, body: { guestName: 'Alice', response: 'no', phone: '+15551234567', smsConsent: true } }));
  assert.equal(res.statusCode, 201);
  const rpc = mock.calls.find(c => c.op === 'rpc' && c.fn === 'submit_rsvp_v2');
  assert.equal(rpc.params.p_sms_consent, true);
});

test('a DECLINE needs neither a number nor consent', async () => {
  /* THE EXEMPTION, AND WHY IT IS NOT A LOOPHOLE.
   *
   * A guest who says no receives no table, no entry pass and no transactional
   * message of any kind. Requiring consent from them would be a demand with no
   * purpose, sitting under a disclosure that describes messages they will never
   * get — and it would undercut the one argument that justifies requiring
   * consent at all: that every message is transactional about an event the
   * recipient chose to attend. */
  rpcResult({ success: true, party_id: 'r1', is_update: false, event_id: 'evt-1', event_title: 'W', response: 'no', party_size: 1, guest_email: null, notification_preferences: { email: false } });
  const { res } = await invoke(submitPublicRSVP, mockReq({ params: { slug: 'wedding' }, body: { guestName: 'Alice', response: 'no' } }));
  assert.equal(res.statusCode, 201);
  const rpc = mock.calls.find(c => c.op === 'rpc' && c.fn === 'submit_rsvp_v2');
  assert.ok(rpc, 'the decline must be recorded');
  assert.equal(rpc.params.p_phone, null, 'no number was given, so none is stored');
});

test('a decline that DOES volunteer a number still has it format-checked', async () => {
  // Exempt from being required is not exempt from being valid: a decliner may
  // leave a number for the host's records, and a malformed one helps nobody.
  mock.setResolver(() => ({}));
  const { res } = await invoke(submitPublicRSVP, mockReq({ params: { slug: 'wedding' }, body: { guestName: 'Alice', response: 'no', phone: 'not-a-number' } }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'VALIDATION_ERROR');
  assert.equal(mock.calls.some(c => c.op === 'rpc'), false);
});

test("'maybe' is NOT exempt — they still get date and venue changes", async () => {
  /* The exemption is for declines only. A maybe still receives change-of-date
     and change-of-venue notices, and can convert to a yes and be seated, so the
     transactional justification holds for them exactly as it does for a yes. */
  mock.setResolver(() => ({}));
  const { res } = await invoke(submitPublicRSVP, mockReq({ params: { slug: 'wedding' }, body: { guestName: 'Alice', response: 'maybe', email: 'a@x.com' } }));
  assert.equal(res.statusCode, 400);
  assert.equal(mock.calls.some(c => c.op === 'rpc'), false);
});

test('a required checkbox has NOT replaced the send-time consent gate', () => {
  /* The regression this guards is subtle and expensive: "consent is required to
     RSVP, so every party is consented, so the dispatcher can stop checking."
     It cannot. A guest who replies STOP, or whose consent was revoked because
     their number changed, is still in the table with sms_consent = true from
     the day they submitted. */
  const fs = require('fs');
  const path = require('path');
  const dispatch = fs.readFileSync(path.join(__dirname, '..', 'services', 'smsDispatch.js'), 'utf8');

  assert.match(dispatch, /if \(!consented\) return skip\('NO_CONSENT'/,
    'sendTransactionalSms must still verify consent per message');
  assert.match(dispatch, /if \(await isOptedOut\(phone\)\) return skip\('OPTED_OUT'/,
    'a STOP reply must still outrank the stored consent record');
});

// ── Defense-in-depth: allow_guest_edits (edits disabled at the API layer, not just hidden in the UI) ──

const partyLookup = (response, allowGuestEdits) => (s) =>
  s.table === 'rsvp_parties' && s.terminal === 'maybeSingle'
    ? { data: { response, events: { slug: 'wedding', allow_guest_edits: allowGuestEdits } } }
    : {};

test('editing an answered party after the RSVP deadline is rejected (403 RESPONSE_EDITS_CLOSED), even with edits allowed', async () => {
  mock.setResolver((s) => {
    if (s.table === 'rsvp_parties' && s.terminal === 'maybeSingle') {
      return { data: { response: 'yes', events: { slug: 'wedding', allow_guest_edits: true, rsvp_deadline: '2000-01-01T00:00:00Z' } } };
    }
    return {};
  });
  const { res } = await invoke(submitPublicRSVP, req({ partyId: 'party-1', guestName: 'A', email: 'a@x.com', response: 'no' }));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'RESPONSE_EDITS_CLOSED');
  assert.equal(mock.calls.some(c => c.op === 'rpc'), false);
});

test('editing an already-answered party is rejected (403, no RPC) when the organizer disabled edits', async () => {
  mock.setResolver(partyLookup('yes', false));
  const { res } = await invoke(submitPublicRSVP, req({ partyId: 'party-1', guestName: 'A', email: 'a@x.com', response: 'no' }));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'RESPONSE_EDITS_DISABLED');
  assert.equal(mock.calls.some(c => c.op === 'rpc'), false);
});

test('editing an already-answered party proceeds to the RPC when the organizer allows edits', async () => {
  mock.setResolver((s) => {
    if (s.table === 'rsvp_parties' && s.terminal === 'maybeSingle') {
      return { data: { response: 'yes', events: { slug: 'wedding', allow_guest_edits: true } } };
    }
    if (s.op === 'rpc' && s.fn === 'submit_rsvp_v2') return { data: { success: true, party_id: 'party-1', response: 'no' } };
    return {};
  });
  const { res } = await invoke(submitPublicRSVP, req({ partyId: 'party-1', guestName: 'A', email: 'a@x.com', response: 'no' }));
  assert.equal(res.statusCode, 201);
  assert.equal(mock.calls.some(c => c.op === 'rpc'), true);
});

test('a first-time response (party still pending) is never blocked, regardless of allow_guest_edits', async () => {
  mock.setResolver((s) => {
    if (s.table === 'rsvp_parties' && s.terminal === 'maybeSingle') {
      return { data: { response: 'pending', events: { slug: 'wedding', allow_guest_edits: false } } };
    }
    if (s.op === 'rpc' && s.fn === 'submit_rsvp_v2') return { data: { success: true, party_id: 'party-1', event_id: 'evt-1', response: 'yes' } };
    return {};
  });
  const { res } = await invoke(submitPublicRSVP, req({ partyId: 'party-1', guestName: 'A', email: 'a@x.com', response: 'yes', partySize: 1 }));
  assert.equal(res.statusCode, 201);
});

// ── RPC result code → HTTP status mapping ──

const codeCases = [
  ['EVENT_NOT_FOUND', 404],
  ['PAYMENT_REQUIRED', 402],
  ['EVENT_UNDER_REVIEW', 403],
  ['DEADLINE_PASSED', 400],
  ['DUPLICATE_RSVP', 409],
  ['MEAL_REQUIRED', 400],
  ['MEAL_INVALID', 400],
  ['RSVP_NOT_FOUND', 404],
  ['RSVP_OWNERSHIP_FAILED', 403],
  ['VALIDATION_ERROR', 400],
];

for (const [code, status] of codeCases) {
  test(`submit_rsvp result ${code} maps to HTTP ${status}`, async () => {
    rpcResult({ success: false, code, message: `message for ${code}` });
    const { res } = await invoke(submitPublicRSVP, req({ guestName: 'A', email: 'a@x.com', response: 'yes', partySize: 1 }));
    assert.equal(res.statusCode, status);
    assert.equal(res.body.error, code);
    assert.equal(res.body.message, `message for ${code}`);
  });
}

test('an unknown / missing result code defaults to 400', async () => {
  rpcResult({ success: false });
  const { res } = await invoke(submitPublicRSVP, req({ guestName: 'A', response: 'maybe' }));
  assert.equal(res.statusCode, 400);
});

// ── Happy paths + side-effects ──

test('a successful insert returns 201 with the new rsvpId and fires the confirmation email', async () => {
  rpcResult({
    success: true, rsvp_id: 'rsvp-NEW', party_id: 'rsvp-NEW', is_update: false, event_id: 'evt-1', event_title: 'Wedding',
    response: 'yes', party_size: 1, guest_email: 'a@x.com', notification_preferences: { email: false, whatsapp: false },
  });
  const { res } = await invoke(submitPublicRSVP, req({ guestName: 'Alice', email: 'a@x.com', response: 'yes', partySize: 1 }));
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.partyId, 'rsvp-NEW');
  assert.match(res.body.data.message, /submitted/);
  assert.equal(confirmCalls.length, 1); // attending guest gets a confirmation email
});

test('a successful update returns 201 with the "updated" message', async () => {
  rpcResult({
    success: true, rsvp_id: 'rsvp-1', party_id: 'rsvp-1', is_update: true, event_id: 'evt-1', event_title: 'W',
    response: 'yes', party_size: 1, guest_email: null, notification_preferences: { email: false },
  });
  const { res } = await invoke(submitPublicRSVP, req({ rsvpId: 'rsvp-1', guestName: 'Alice', email: 'a@x.com', response: 'yes', partySize: 1 }));
  assert.equal(res.statusCode, 201);
  assert.match(res.body.data.message, /updated/);
});

test('a declined RSVP with an email sends the decline acknowledgement to the guest', async () => {
  rpcResult({
    success: true, rsvp_id: 'r1', is_update: false, event_id: 'evt-1', event_title: 'W',
    event_date: '2026-09-01T00:00:00Z', event_slug: 'wedding', response: 'no', party_size: 1,
    guest_email: 'a@x.com', notification_preferences: { email: false },
  });
  const { res } = await invoke(submitPublicRSVP, req({ guestName: 'Alice', email: 'a@x.com', response: 'no' }));
  assert.equal(res.statusCode, 201);
  assert.ok(emailCalls.some(a => a[0] === 'a@x.com'), 'decline email sent to the guest');
});

test('the organizer is emailed when preferences allow and an org email is present', async () => {
  rpcResult({
    success: true, rsvp_id: 'r1', party_id: 'r1', is_update: false, event_id: 'evt-1', event_title: 'W',
    response: 'yes', party_size: 2, guest_email: null, notification_preferences: { email: true }, org_email: 'org@x.com',
  });
  const { res } = await invoke(submitPublicRSVP, req({ guestName: 'Alice', response: 'yes', partySize: 1 }));
  assert.equal(res.statusCode, 201);
  assert.ok(emailCalls.some(a => a[0] === 'org@x.com'), 'organizer notified by email');
});

test('a "maybe" RSVP labels the organizer email "Maybe" (amber), never "Declined"', async () => {
  rpcResult({
    success: true, rsvp_id: 'r1', is_update: false, event_id: 'evt-1', event_title: 'W',
    response: 'maybe', party_size: 1, guest_email: null, notification_preferences: { email: true }, org_email: 'org@x.com',
  });
  const { res } = await invoke(submitPublicRSVP, req({ guestName: 'Alice', response: 'maybe' }));
  assert.equal(res.statusCode, 201);
  const orgEmail = emailCalls.find(a => a[0] === 'org@x.com');
  assert.ok(orgEmail, 'organizer emailed');
  const html = orgEmail[2];
  assert.match(html, /Maybe/);
  assert.doesNotMatch(html, /Declined/);
  assert.match(html, /#9A7B3F/); // gold accent, not the red decline colour
});

test('a "maybe" RSVP with an email acknowledges the guest too (not only the organizer)', async () => {
  rpcResult({
    success: true, rsvp_id: 'r1', party_id: 'r1', is_update: false, event_id: 'evt-1', event_title: 'W',
    response: 'maybe', party_size: 1, guest_email: 'a@x.com', notification_preferences: { email: false },
  });
  const { res } = await invoke(submitPublicRSVP, req({ guestName: 'Alice', email: 'a@x.com', response: 'maybe' }));
  assert.equal(res.statusCode, 201);
  assert.equal(confirmCalls.length, 1, 'tentative guest gets an acknowledgement email');
  assert.deepEqual(confirmCalls[0], ['evt-1', 'r1', 'en']);
});

test('the confirmation email is sent in the language the guest used on the form', async () => {
  rpcResult({
    success: true, rsvp_id: 'r1', party_id: 'r1', is_update: false, event_id: 'evt-1', event_title: 'W',
    response: 'yes', party_size: 1, guest_email: 'a@x.com', notification_preferences: { email: false },
  });
  await invoke(submitPublicRSVP, req({ guestName: 'Alice', email: 'a@x.com', response: 'yes', partySize: 1, lang: 'ar' }));
  assert.deepEqual(confirmCalls[0], ['evt-1', 'r1', 'ar'], 'guest language must reach the template');
});

test('an unknown/missing lang falls back to English rather than reaching the template raw', async () => {
  rpcResult({
    success: true, rsvp_id: 'r1', party_id: 'r1', is_update: false, event_id: 'evt-1', event_title: 'W',
    response: 'yes', party_size: 1, guest_email: 'a@x.com', notification_preferences: { email: false },
  });
  await invoke(submitPublicRSVP, req({ guestName: 'Alice', email: 'a@x.com', response: 'yes', partySize: 1, lang: 'klingon' }));
  assert.equal(confirmCalls[0][2], 'en');
});

// ── Companions are names ────────────────────────────────────────────────────
// The form asks the person who opened the invitation for everything and records
// anyone they bring as a name. Requiring an email per companion is what pushed
// households sharing one inbox into idx_guests_event_email_unique, where
// submit_rsvp_v2 silently discarded the address.

const okRpc = (over = {}) => rpcResult({
  success: true, rsvp_id: 'r1', party_id: 'r1', is_update: false, event_id: 'evt-1', event_title: 'W',
  response: 'yes', party_size: 2, guest_email: 'a@x.com', notification_preferences: { email: false },
  ...over,
});

/** The additionalGuests array as it reached the RPC. */
const sentCompanions = () =>
  mock.calls.find(c => c.op === 'rpc' && c.fn === 'submit_rsvp_v2').params.p_additional_guests;

test('a companion needs only a name — no email, no phone', async () => {
  okRpc();
  const { res } = await invoke(submitPublicRSVP, req({
    guestName: 'Alice', response: 'yes', partySize: 2,
    additionalGuests: [{ fullName: 'Bob' }],
  }));
  assert.equal(res.statusCode, 201);
  assert.deepEqual(sentCompanions(), [{ fullName: 'Bob' }]);
});

test('contact details sent for a companion are dropped, not rejected', async () => {
  okRpc();
  const { res } = await invoke(submitPublicRSVP, req({
    guestName: 'Alice', response: 'yes', partySize: 2,
    // An older client, or a hand-rolled request, still posting the old shape.
    additionalGuests: [{ fullName: 'Bob', email: 'bob@x.com', phone: '+15551234567', mealSelection: 'Beef' }],
  }));
  assert.equal(res.statusCode, 201, 'a good RSVP is not failed over extra keys');
  assert.deepEqual(sentCompanions(), [{ fullName: 'Bob' }], 'only the name is forwarded');
});

test('a companion still must be named', async () => {
  mock.setResolver(() => ({}));
  const { res } = await invoke(submitPublicRSVP, req({
    guestName: 'Alice', response: 'yes', partySize: 2, additionalGuests: [{ fullName: '  ' }],
  }));
  assert.equal(res.statusCode, 400);
  assert.equal(mock.calls.some(c => c.op === 'rpc'), false);
});

test('no companion is ever emailed — they have no address of their own', async () => {
  okRpc();
  await invoke(submitPublicRSVP, req({
    guestName: 'Alice', email: 'a@x.com', response: 'yes', partySize: 2,
    additionalGuests: [{ fullName: 'Bob', email: 'bob@x.com' }],
  }));
  assert.equal(emailCalls.some(a => a[0] === 'bob@x.com'), false);
  assert.equal(confirmCalls.length, 1, 'one confirmation, to the person who filled the form in');
});

test('a "maybe" never registers companions (only an actual yes does)', async () => {
  rpcResult({
    success: true, rsvp_id: 'r1', party_id: 'r1', is_update: false, event_id: 'evt-1', event_title: 'W',
    response: 'maybe', party_size: 1, guest_email: 'a@x.com', notification_preferences: { email: false },
  });
  await invoke(submitPublicRSVP, req({
    guestName: 'Alice', email: 'a@x.com', response: 'maybe',
    additionalGuests: [{ fullName: 'Bob' }],
  }));
  assert.equal(emailCalls.some(a => a[0] === 'bob@x.com'), false, 'no companion email on a tentative response');
});

// ── An already-registered contact is announced, not overwritten ─────────────
// Both auto-merge lookups used to silently UPDATE a party that had already
// answered whenever the host allowed guest edits, so anyone who knew a guest's
// address could replace their response without either of them being told.

test('an email on an already-answered party is a 409 that offers the update', async () => {
  rpcResult({
    success: false, code: 'EMAIL_ALREADY_REGISTERED', canUpdate: true,
    message: 'This email is already registered for this event.',
  });
  const { res } = await invoke(submitPublicRSVP, req({ guestName: 'Alice', response: 'yes', partySize: 1 }));
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'EMAIL_ALREADY_REGISTERED');
  assert.equal(res.body.meta.canUpdate, true, 'the form needs this to decide whether to offer the claim action');
  assert.ok(!/alice|guest@example/i.test(res.body.message), 'names nobody — the reply must not leak who responded');
});

test('the same reply carries canUpdate:false when the host disallows edits', async () => {
  rpcResult({
    success: false, code: 'EMAIL_ALREADY_REGISTERED', canUpdate: false,
    message: 'This email is already registered for this event.',
  });
  const { res } = await invoke(submitPublicRSVP, req({ guestName: 'Alice', response: 'yes', partySize: 1 }));
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.meta.canUpdate, false);
});

test('a phone match gets its own code so the form can flag the right field', async () => {
  rpcResult({
    success: false, code: 'PHONE_ALREADY_REGISTERED', canUpdate: true,
    message: 'This phone number is already registered for this event.',
  });
  const { res } = await invoke(submitPublicRSVP, req({ guestName: 'Alice', response: 'yes', partySize: 1 }));
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'PHONE_ALREADY_REGISTERED');
});

// There is no "confirm" flag any more. An answered party can only be changed by
// arriving with a partyId — the guest's own link, or the one emailed by the
// claim endpoint below. An unverified click was never proof of anything.

test('the submit path has no way to claim an answered party', async () => {
  okRpc({ party_size: 1 });
  await invoke(submitPublicRSVP, req({
    guestName: 'Alice', response: 'yes', partySize: 1,
    // A stale client still posting the retired flag must not resurrect it.
    confirmUpdate: true,
  }));
  const params = mock.calls.find(c => c.op === 'rpc').params;
  assert.equal(params.p_confirm_update, undefined);
});

// ── Companion meals are a tally for the group ─────────────────────────

test('the companion meal tally is forwarded to the RPC', async () => {
  okRpc();
  await invoke(submitPublicRSVP, req({
    guestName: 'Alice', response: 'yes', partySize: 3,
    additionalGuests: [{ fullName: 'Bob' }, { fullName: 'Cara' }],
    companionMealCounts: { Fish: 2 },
  }));
  assert.deepEqual(mock.calls.find(c => c.op === 'rpc').params.p_companion_meal_counts, { Fish: 2 });
});

test('no tally sends null rather than an empty object — the RPC treats them differently', async () => {
  okRpc({ party_size: 1 });
  await invoke(submitPublicRSVP, req({ guestName: 'Alice', response: 'yes', partySize: 1 }));
  assert.equal(mock.calls.find(c => c.op === 'rpc').params.p_companion_meal_counts, null);
});

// ── Claim by email ────────────────────────────────────────
// The reply must be byte-identical whether or not the address matched. Anything
// that varied would turn this into an oracle for "is this person on the guest
// list", which is the leak the 409's name-nobody wording exists to prevent.

const claimReq = (body) => mockReq({ params: { slug: 'wedding' }, body });
const LIVE_EVENT = {
  id: 'evt-1', slug: 'wedding', title: 'W', is_paid: true, status: 'active',
  allow_guest_edits: true, rsvp_deadline: null,
};

/** Scripts the event lookup, then the primary-contact lookup. */
const claimScene = ({ event = LIVE_EVENT, match = null } = {}) => mock.setResolver((sc) => {
  if (sc.table === 'events') return { data: event };
  if (sc.table === 'guests') return { data: match };
  return {};
});

test('a matching address is emailed a link', async () => {
  claimScene({ match: { full_name: 'Alice', party_id: 'p1', rsvp_parties: { id: 'p1', label: 'Alice', response: 'yes', event_id: 'evt-1' } } });
  const { res } = await invoke(claimRsvpByEmail, claimReq({ email: 'alice@example.com' }));
  assert.equal(res.statusCode, 200);
  assert.equal(emailCalls.length, 1);
  assert.equal(emailCalls[0][0], 'alice@example.com');
  // The link must carry a token, not a bare party id.
  assert.match(emailCalls[0][2], /\/rsvp\?token=/);
});

test('a non-matching address gets the SAME reply and no email', async () => {
  claimScene({ match: { full_name: 'Alice', party_id: 'p1', rsvp_parties: { id: 'p1', label: 'Alice', response: 'yes', event_id: 'evt-1' } } });
  const { res: hit } = await invoke(claimRsvpByEmail, claimReq({ email: 'alice@example.com' }));

  mock.reset(); emailCalls = [];
  claimScene({ match: null });
  const { res: miss } = await invoke(claimRsvpByEmail, claimReq({ email: 'nobody@example.com' }));

  assert.equal(miss.statusCode, hit.statusCode);
  assert.deepEqual(miss.body, hit.body, 'a different reply would leak who is on the guest list');
  assert.equal(emailCalls.length, 0, 'and nothing is sent to an address that is not registered');
});

test('nothing is sent when the host has turned off guest edits', async () => {
  claimScene({
    event: { ...LIVE_EVENT, allow_guest_edits: false },
    match: { full_name: 'Alice', party_id: 'p1', rsvp_parties: { id: 'p1', label: 'Alice', response: 'yes', event_id: 'evt-1' } },
  });
  const { res } = await invoke(claimRsvpByEmail, claimReq({ email: 'alice@example.com' }));
  assert.equal(res.statusCode, 200, 'still the same reply');
  assert.equal(emailCalls.length, 0, 'but no link to a response that cannot be changed');
});

test('nothing is sent once the RSVP deadline has passed', async () => {
  claimScene({
    event: { ...LIVE_EVENT, rsvp_deadline: '2000-01-01T00:00:00Z' },
    match: { full_name: 'Alice', party_id: 'p1', rsvp_parties: { id: 'p1', label: 'Alice', response: 'yes', event_id: 'evt-1' } },
  });
  const { res } = await invoke(claimRsvpByEmail, claimReq({ email: 'alice@example.com' }));
  assert.equal(res.statusCode, 200);
  assert.equal(emailCalls.length, 0);
});

test('a malformed address is a plain 400, before any lookup', async () => {
  mock.setResolver(() => ({}));
  const { res } = await invoke(claimRsvpByEmail, claimReq({ email: 'not-an-email' }));
  assert.equal(res.statusCode, 400);
  assert.equal(mock.calls.length, 0);
});

test('a DB-level RPC error is forwarded to the Express error handler', async () => {
  mock.setResolver((s) => (s.op === 'rpc' ? { error: { message: 'connection reset' } } : {}));
  const { nextErr } = await invoke(submitPublicRSVP, req({ guestName: 'A', response: 'yes', partySize: 1 }));
  assert.ok(nextErr, 'next(err) was called');
});
