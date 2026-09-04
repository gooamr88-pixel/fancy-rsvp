require('./helpers/env');
const { test } = require('node:test');
const t = require('node:test');
const assert = require('node:assert/strict');
const { createMockSupabase } = require('./helpers/mockSupabase');
const { mockReq, invoke } = require('./helpers/http');
const { injectModule } = require('./helpers/inject');

/*
 * Deliberately distinct literals, and deliberately NOT the real constants.
 *
 * utils/smsConsent is injected below, so requiring it here would hand back this
 * file's own double — the assertion would compare a value to itself and pass
 * whichever constant the controller reached for. Two obviously different
 * sentinels prove it picked the right one, and neither has to be touched when a
 * real version is bumped.
 */
const GUEST_VERSION = 'guest-wording-vX';
const ORGANIZER_VERSION = 'organizer-wording-vY';

/**
 * THE ORGANIZER'S OWN OPT-IN.
 *
 * organizer_report shipped as a message type that could never send. Its consent
 * flag and phone number lived on `organizations` and were only ever READ — no
 * endpoint, no UI, no backfill wrote either one. So the flag stayed false, every
 * report skipped with NO_CONSENT, the toggle was on by default, and the purchase
 * estimate billed three messages an event for it.
 *
 * These tests pin the endpoint that closes it, and the property that makes it
 * legitimate: being our paying customer is not consent. The organizer gets the
 * same treatment a guest gets — an explicit opt-in, a dated record, refusals
 * logged, and STOP still winning.
 */

const mock = createMockSupabase();
injectModule('../../config/supabase', { supabase: mock.supabase });

const consentLogCalls = [];
injectModule('../../utils/smsConsent', {
  SMS_CONSENT_TEXT_VERSION: GUEST_VERSION,
  ORGANIZER_SMS_CONSENT_TEXT_VERSION: ORGANIZER_VERSION,
  logSmsConsentDecision: (row) => consentLogCalls.push(row),
});

const { updateOrganizerSmsConsent } = require('../controllers/campaignController');

const EVENT = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';

function scriptOrg() {
  const writes = [];
  mock.setResolver((s) => {
    if (s.table === 'events') return { data: { org_id: ORG } };
    if (s.table === 'organizations' && s.op === 'update') {
      writes.push(s.payload);
      return { data: [{ id: ORG }] };
    }
    if (s.table === 'sms_opt_outs' && s.op === 'update') {
      writes.push({ __liftedSuppression: true, ...s.payload });
      return { data: [] };
    }
    return {};
  });
  return writes;
}

const call = (body) => invoke(updateOrganizerSmsConsent,
  mockReq({ params: { eventId: EVENT }, body, user: { id: 'owner-1' }, ip: '203.0.113.9' }));

t.beforeEach(() => { mock.reset(); consentLogCalls.length = 0; });

test('opting in stores the number, the flag and the wording version', async () => {
  const writes = scriptOrg();
  const { res } = await call({ phone: '+15551234567', consent: true });

  assert.equal(res.body.success, true);
  const org = writes.find((w) => 'sms_consent' in w);
  assert.equal(org.sms_consent, true);
  assert.equal(org.sms_phone, '+15551234567');
  assert.ok(org.sms_consent_at, 'the decision must be dated');
  /*
   * The ORGANIZER's version, which is deliberately not the guest one.
   *
   * This asserted '2026-08-04' — the guest sentence — because that is what the
   * controller stamped. The guest sentence describes invitation links, RSVP
   * confirmations and reminders; an organizer receives none of them, only a
   * headcount summary before their own event. So the record said they had
   * agreed to wording that does not describe what they were signed up for, and
   * every future edit to the guest sentence would have appeared to re-date
   * every organizer's consent.
   *
   * Imported rather than hard-coded a second time: the two constants
   * (utils/smsConsent.js and SmsConsentText.js) are already required to move
   * together, and a third literal here would be a third thing to remember.
   */
  assert.equal(org.sms_consent_text_version, ORGANIZER_VERSION,
    'we must be able to prove which wording they agreed to, exactly as for a guest');
  assert.notEqual(org.sms_consent_text_version, GUEST_VERSION,
    'the organizer did not agree to the guest sentence');
});

test('consent without a number is refused rather than stored', async () => {
  scriptOrg();
  const { res } = await call({ consent: true });

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /mobile number/i,
    'a consent with nowhere to send is not a consent — say so now, not after no alert ever arrives');
});

test('an unparseable number is refused', async () => {
  scriptOrg();
  const { res } = await call({ phone: 'call me maybe', consent: true });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'VALIDATION_ERROR');
});

test('the number is normalized to E.164 before storage', async () => {
  const writes = scriptOrg();
  await call({ phone: '(555) 123-4567', consent: true });

  const org = writes.find((w) => 'sms_phone' in w);
  assert.match(org.sms_phone, /^\+/, 'Twilio rejects anything that is not E.164');
});

test('opting in lifts an earlier STOP', async () => {
  const writes = scriptOrg();
  await call({ phone: '+15551234567', consent: true });

  assert.ok(writes.some((w) => w.__liftedSuppression),
    'deliberately opting in after a STOP is a change of mind, and nothing else can clear a suppression');
});

test('opting OUT does not touch the suppression list', async () => {
  const writes = scriptOrg();
  await call({ phone: '+15551234567', consent: false });

  assert.equal(writes.some((w) => w.__liftedSuppression), false,
    'withdrawing consent must never un-suppress a number');
  const org = writes.find((w) => 'sms_consent' in w);
  assert.equal(org.sms_consent, false);
  assert.equal(org.sms_consent_text_version, null, 'no wording was agreed to');
});

test('both the opt-in AND the refusal are written to the consent log', async () => {
  scriptOrg();
  await call({ phone: '+15551234567', consent: true });
  assert.equal(consentLogCalls.length, 1);
  assert.equal(consentLogCalls[0].consent, true);
  assert.equal(consentLogCalls[0].source, 'organizer_settings');

  consentLogCalls.length = 0;
  await call({ phone: '+15551234567', consent: false });
  assert.equal(consentLogCalls.length, 1);
  assert.equal(consentLogCalls[0].consent, false,
    'a dated refusal is evidence the question was asked separately and freely answered');
});

test('a missing event is a 404', async () => {
  mock.setResolver(() => ({ data: null }));
  const { res } = await call({ phone: '+15551234567', consent: true });
  assert.equal(res.statusCode, 404);
});

test('clearing the number is allowed without consent', async () => {
  const writes = scriptOrg();
  const { res } = await call({ phone: '', consent: false });

  assert.equal(res.body.success, true);
  const org = writes.find((w) => 'sms_phone' in w);
  assert.equal(org.sms_phone, null, 'removing the number must be possible');
});
