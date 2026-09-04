/**
 * Canonical SMS consent-language version stamp.
 *
 * The guest-facing consent sentence lives in ONE frontend component —
 * frontend/src/app/components/guest/SmsConsentText.js — and is rendered by
 * every opt-in surface (RSVP wizard, full-page templates, /sms-opt-in). This
 * version identifier is persisted with each consent record
 * (rsvp_parties.sms_consent_text_version) so the exact wording a guest agreed
 * to can always be reconstructed (Privacy Policy §3 record-keeping).
 *
 * Bump BOTH this constant and SMS_CONSENT_TEXT_VERSION in SmsConsentText.js
 * whenever the consent sentence changes, and archive the old wording in the
 * commit message.
 *
 * 2026-09-04: the checkbox became REQUIRED to submit an RSVP, and the
 * disclosure below it was rewritten because its opening sentence ("SMS consent
 * is voluntary and is not required to … RSVP …") stopped being true. The label
 * — what the guest actually agrees to — is unchanged. The full rationale, the
 * archived previous wording, and the required Twilio re-filing are documented
 * in SmsConsentText.js; do not restate them here, but do not change this
 * constant without reading them.
 */
const SMS_CONSENT_TEXT_VERSION = '2026-09-04';

/**
 * The ORGANIZER's own opt-in is a different document and is versioned apart.
 *
 * The guest sentence describes invitation links, RSVP confirmations and
 * reminders. An organizer receives none of those — they get exactly one type, a
 * headcount summary before their own event (`organizer_report` in
 * utils/smsTemplates.js). Stamping an organizer's consent with the guest
 * version recorded agreement to wording that does not describe what they were
 * signed up for, and re-dated every organizer's consent whenever the guest
 * sentence changed.
 *
 * Mirrors ORGANIZER_SMS_CONSENT_TEXT_VERSION in
 * frontend/src/app/components/guest/SmsConsentText.js — bump both together.
 */
const ORGANIZER_SMS_CONSENT_TEXT_VERSION = '2026-09-01';

// Whitelist of GUEST-facing opt-in surfaces the frontend may report (anything
// else is coerced to the generic 'guest_form' rather than trusting client
// input). Host-attested sources are deliberately NOT in this list: a guest
// request must never be able to label itself as an organizer attestation.
const SMS_CONSENT_SOURCES = ['guest_form_wizard', 'guest_form_template', 'sms_opt_in_page'];

// How consent was obtained. The distinction matters at audit time: a
// host_attested row is consent we were TOLD about, a guest_optin row is consent
// we WITNESSED. Never collapse the two.
const CONSENT_METHOD_GUEST = 'guest_optin';
const CONSENT_METHOD_HOST = 'host_attested';
// Neither a grant nor a claim: consent the PLATFORM withdrew because the fact it
// rested on stopped being true — today only "the party's phone number changed", so
// the recorded consent no longer belongs to the number we would now be texting.
// Distinct from the two above so an audit can tell a withdrawal apart from a
// refusal: the guest never changed their mind, we changed the destination.
const CONSENT_METHOD_REVOKED = 'system_revoked';

function normalizeConsentSource(source) {
  return SMS_CONSENT_SOURCES.includes(source) ? source : 'guest_form';
}

/**
 * Append one row to sms_consent_log — the immutable, server-side record of a
 * single SMS consent decision (Twilio TFV 30475, migration
 * 20260811010000_sms_consent_log.sql). Captures all five required fields at the
 * moment of the decision: phone, consent status, timestamp, event id, guest id.
 *
 * Called for REFUSALS as well as opt-ins: a dated decline is the evidence that
 * consent was requested independently and freely refused.
 *
 * Deliberately fire-and-forget and never throwing. The authoritative consent
 * value is already persisted transactionally by submit_rsvp_v2 before this runs,
 * so a logging failure must degrade to a warning rather than break a guest's
 * RSVP. `guestId` is resolved best-effort — the log is still valid without it,
 * since party_id identifies the guest party SMS is addressed to.
 */
function logSmsConsentDecision({
  eventId, partyId, guestId = null, phone, consent, source, textVersion,
  method = CONSENT_METHOD_GUEST, attestedBy = null,
}) {
  // Required by the audit trail; without a number there is nothing to log.
  if (!phone) return;

  // Lazily required so this module stays importable by tests and tooling that
  // never touch the database.
  const { supabase } = require('../config/supabase');
  const logger = require('./logger');

  const row = {
    event_id: eventId || null,
    party_id: partyId || null,
    guest_id: guestId,
    phone,
    consent: !!consent,
    // A host attestation is a claim about consent obtained elsewhere, and a
    // system revocation shows nobody anything — in neither case was wording of
    // ours displayed, so recording a version would misrepresent the record.
    consent_text_version: (method === CONSENT_METHOD_HOST || method === CONSENT_METHOD_REVOKED)
      ? null
      : (textVersion || SMS_CONSENT_TEXT_VERSION),
    source: source || 'guest_form',
    method,
    attested_by: attestedBy,
  };

  try {
    supabase.from('sms_consent_log').insert(row).then(
      ({ error }) => {
        if (error) logger.warn({ err: error, partyId }, 'sms consent log write failed (apply 20260811010000_sms_consent_log.sql)');
      },
      (err) => logger.warn({ err, partyId }, 'sms consent log write rejected'),
    );
  } catch (err) {
    logger.warn({ err, partyId }, 'sms consent log write threw');
  }
}

module.exports = {
  SMS_CONSENT_TEXT_VERSION,
  ORGANIZER_SMS_CONSENT_TEXT_VERSION,
  SMS_CONSENT_SOURCES,
  CONSENT_METHOD_GUEST,
  CONSENT_METHOD_HOST,
  CONSENT_METHOD_REVOKED,
  normalizeConsentSource,
  logSmsConsentDecision,
};
