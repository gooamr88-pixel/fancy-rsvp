/* `React` is imported and it is NOT unused. Next compiles JSX with the automatic
   runtime, but vitest compiles it with the CLASSIC one, so every element in this
   file becomes React.createElement at test time. Without it, any test or
   screenshot probe that renders these components throws "React is not defined" —
   which is how this file reached today never having been rendered by one. */
import React from 'react';

// Canonical SMS opt-in consent language (Twilio Toll-Free Verification / TCPA / CTIA).
//
// This exact wording is quoted verbatim in the Twilio TFV submission, so every
// surface that shows the consent checkbox MUST render these components instead
// of its own copy of the sentence: the RSVP wizard (StepPartyDetails), the
// full-page template forms (heritageArch RsvpSection), and the public
// /sms-opt-in disclosure page. The two RSVP paths drifted apart once before —
// do not inline a variant of this text anywhere.
//
// TWO components, and the split is itself a compliance requirement:
//
//   <SmsConsentText />          goes INSIDE the checkbox <label>. It is the
//                               only thing the guest agrees to by ticking the
//                               box. It contains NO links and mentions neither
//                               the Privacy Policy nor the Terms of Service.
//
//   <SmsConsentIndependence />  goes immediately BELOW the checkbox, OUTSIDE
//                               the label. It states that SMS consent is not
//                               conditioned on the Privacy Policy or Terms,
//                               and it carries the policy links.
//
// Twilio rejects consent language that bundles SMS opt-in with acceptance of
// other agreements ("independent consent"). Putting the policy links inside
// the label — as this component did until 2026-08-01 — reads as "ticking this
// box also accepts our Terms," which is exactly the construction that fails
// review. Never move the links back inside the label.
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ 2026-09-04: THE CHECKBOX IS NOW REQUIRED TO SUBMIT AN RSVP.              ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// This reverses the 2026-08-01 decision, on the product owner's explicit
// instruction, and it carries a real and stated risk. Written down here because
// this file is where anyone investigating a future TFV rejection will look.
//
// WHAT CHANGED, AND WHY THE COPY HAD TO CHANGE WITH IT
//
// SmsConsentIndependence used to open: "SMS consent is voluntary and is not
// required to register, RSVP, attend an event, or use FancyRSVP." That sentence
// was filed verbatim with Twilio against rejection 30475. The moment the
// checkbox blocks submission it becomes FALSE — and a page that refuses to
// submit while displaying a notice saying it will not is worse than either
// choice made cleanly: it is a false statement in the exact screenshot a
// reviewer takes. So the sentence is gone and the notice now describes what the
// form actually does.
//
// WHAT DID NOT CHANGE, AND MUST NOT
//
//   • The label wording below. It is what the guest is agreeing TO, it was
//     accurate before and is accurate now, and leaving it untouched keeps every
//     historical consent record comparable.
//   • Consent independence FROM the Privacy Policy and Terms. That is a
//     separate rule and it is still satisfied: ticking this box is not an
//     acceptance of any other agreement, and the links stay outside the label.
//   • STOP / HELP. The opt-out path is the part that is not negotiable, and it
//     is untouched — sms_opt_outs suppresses a number globally, across every
//     event, permanently, the moment a guest replies STOP
//     (backend/services/smsDispatch.js).
//
// REQUIRED FOLLOW-UP: the toll-free verification must be RE-FILED with the new
// wording below. The submitted document and the live page no longer match, and
// the live page is what gets reviewed. See TWILIO_COMPLIANCE_MASTER_AUDIT.md.
//
// Requirements baked into the label wording (do not remove any of them):
// brand name, the message types (event invitations, RSVP updates, reminders,
// event updates), frequency, rates, STOP, and HELP.

// Version stamp persisted with every consent record
// (rsvp_parties.sms_consent_text_version, sms_optin_submissions.consent_text_version).
// MUST match backend/utils/smsConsent.js — bump both together whenever either
// component's wording changes.
//
// 2026-09-04: the checkbox became REQUIRED to submit an RSVP (see the banner
//   above). The label sentence itself is UNCHANGED — what the guest agrees to is
//   the same — but the independence notice was rewritten, because its opening
//   sentence ("SMS consent is voluntary and is not required to register, RSVP,
//   attend an event, or use FancyRSVP") became false the moment submission was
//   blocked on it. Version bumped because the notice is part of the disclosure
//   shown at consent time, and a record has to be attributable to the text that
//   was actually on screen. Previous notice, as filed with Twilio:
//     "SMS consent is voluntary and is not required to register, RSVP, attend
//      an event, or use FancyRSVP."
//     "Your decision to receive SMS messages is completely independent from
//      acceptance of our Privacy Policy or Terms of Service."
//     "See our Privacy Policy and Terms of Service for additional information."
// 2026-08-04: reworded to the exact sentence filed against Twilio rejection
//   30475 ("Consent for Messaging Cannot Be Part of Other Agreements"), and the
//   independence notice reduced to the three sentences filed with it. Previous
//   version: 2026-08-01 — "I agree to receive text messages from FancyRSVP
//   about this event, including event invitations, RSVP updates, reminders, and
//   event updates. Message frequency varies. Message & data rates may apply.
//   Reply STOP to opt out at any time, or HELP for help."
// 2026-08-01: links moved out of the label into SmsConsentIndependence; label
//   reworded to the TFV-submitted sentence. Previous version: 2026-07-16 —
//   "I agree to receive text messages from Fancy RSVP about this event,
//   including event invitations, RSVP updates, reminders, and event updates.
//   Message frequency varies. Message & data rates may apply. Reply STOP to opt
//   out at any time, or HELP for help. See our Privacy Policy and Terms of
//   Service."
export const SMS_CONSENT_TEXT_VERSION = '2026-09-04';

/**
 * The ORGANIZER's opt-in is a separate document with its own version stamp.
 *
 * It has to be. The guest sentence above describes invitation links, RSVP
 * confirmations and reminders — none of which an organizer receives. They get
 * exactly one type: a headcount summary before their own event
 * (`organizer_report` in backend/utils/smsTemplates.js). Reusing the guest
 * wording would describe messages that never arrive, which is the kind of
 * inaccuracy a TFV reviewer reads as boilerplate.
 *
 * Stamped independently so the two can never be confused at audit time: a
 * change to the guest sentence must not appear to re-date an organizer's
 * consent, and vice versa. Mirrored in backend/utils/smsConsent.js —
 * bump both together.
 *
 * 2026-09-01: first version. The opt-in endpoint
 *   (PATCH /events/:id/campaigns/organizer-sms) already existed and stamped the
 *   GUEST version, because no surface had ever called it — there was no control
 *   anywhere in the product that could record an organizer's consent, so the
 *   organizer_report message type could never fire for anyone.
 */
export const ORGANIZER_SMS_CONSENT_TEXT_VERSION = '2026-09-01';

/**
 * The organizer checkbox label. Renders INSIDE <label> — no links, no reference
 * to any other agreement, exactly like the guest one and for the same reason.
 *
 * Carries every element the guest sentence carries: brand name, the message
 * type, frequency, rates, STOP and HELP.
 */
export function OrganizerSmsConsentText({ isRTL = false }) {
  if (isRTL) {
    return (
      <>
        أوافق على تلقي رسائل نصية من FancyRSVP عن الفعاليات التي أنظّمها، وتحديدًا ملخّص أعداد الحضور قبل كل فعالية. يختلف عدد الرسائل، وعادةً رسالة واحدة لكل فعالية. وقد تُطبّق رسوم الرسائل والبيانات. أرسل STOP لإلغاء الاشتراك في أي وقت أو HELP للمساعدة.
      </>
    );
  }
  return (
    <>
      I agree to receive text messages from FancyRSVP about events I organise, specifically a guest headcount summary before each event. Message frequency varies, typically one message per event. Message &amp; data rates may apply. Reply STOP to opt out at any time or HELP for assistance.
    </>
  );
}

const linkBase = { fontWeight: 600, textDecoration: 'underline', color: 'inherit' };

function PolicyLink({ href, style, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ ...linkBase, ...style }}>
      {children}
    </a>
  );
}

/**
 * The checkbox label. Renders INSIDE <label> — no links, no reference to any
 * other agreement.
 */
export default function SmsConsentText({ isRTL = false }) {
  if (isRTL) {
    return (
      <>
        أوافق على تلقي رسائل نصية متعلقة بالفعاليات من FancyRSVP، بما في ذلك روابط الدعوات وتأكيدات الردود (RSVP) والتذكيرات وتحديثات الفعالية. يختلف عدد الرسائل. وقد تُطبّق رسوم الرسائل والبيانات. أرسل STOP لإلغاء الاشتراك في أي وقت أو HELP للمساعدة.
      </>
    );
  }
  return (
    <>
      I agree to receive event-related text messages from FancyRSVP, including invitation links, RSVP confirmations, reminders, and event updates. Message frequency varies. Message &amp; data rates may apply. Reply STOP to opt out at any time or HELP for assistance.
    </>
  );
}

/**
 * The disclosure notice. Renders immediately BELOW the checkbox, OUTSIDE the
 * label, on every surface that shows SmsConsentText. Carries the Privacy /
 * Terms links so they are visually and structurally separate from the thing
 * the guest is ticking.
 *
 * ── THREE SENTENCES, AND EACH ONE IS LOAD-BEARING ──
 *
 * 1. WHY THE NUMBER IS NEEDED. Replaces the deleted "consent is voluntary"
 *    line. A required field with no stated purpose is the thing people abandon
 *    a form over; a required field with a reason ("this is how your table and
 *    entry pass reach you") is one they complete. It is also simply true, which
 *    the sentence it replaces no longer would be.
 *
 * 2. HOW TO STOP. Promoted OUT of the label and into the notice, in its own
 *    sentence, because it is now the guest's only exit. When the box was
 *    optional, declining was the exit and STOP was a footnote; with the box
 *    required, STOP is the entire mechanism by which a person who does not want
 *    texts stops receiving them. It must be impossible to miss.
 *
 * 3. INDEPENDENCE FROM THE OTHER AGREEMENTS. Unchanged and still true: ticking
 *    this box is not an acceptance of the Privacy Policy or the Terms, and the
 *    links to those sit outside the label precisely so the two cannot be read
 *    as one act. This is the sentence Twilio's "independent consent" rule is
 *    actually about, and it survives the change intact.
 *
 * @param {object}  style      merged into the wrapper (colour / font-size per surface)
 * @param {object}  linkStyle  merged into the two policy links
 */
export function SmsConsentIndependence({ isRTL = false, style = {}, linkStyle = {} }) {
  const wrap = {
    fontFamily: 'var(--font-sans)',
    fontSize: '11.5px',
    lineHeight: 1.65,
    color: '#7A756C',
    margin: '8px 0 0',
    ...style,
  };
  const line = { margin: '0 0 5px' };

  if (isRTL) {
    return (
      <div style={wrap} dir="rtl">
        <p style={line}>يحتاج المنظِّم رقم هاتفك للتواصل معك بخصوص هذه المناسبة — نرسل لك رقم طاولتك وتذكرة دخولك وأي تغيير في الموعد أو المكان عبر رسالة نصية.</p>
        <p style={line}>يمكنك إيقاف الرسائل في أي وقت بالرد بكلمة STOP، أو إرسال HELP للمساعدة.</p>
        <p style={line}>قرارك بتلقي الرسائل النصية مستقل تمامًا عن قبول سياسة الخصوصية أو شروط الخدمة الخاصة بنا.</p>
        <p style={{ ...line, marginBottom: 0 }}>
          راجع{' '}
          <PolicyLink href="/privacy" style={linkStyle}>سياسة الخصوصية</PolicyLink>
          {' '}و{' '}
          <PolicyLink href="/terms" style={linkStyle}>شروط الخدمة</PolicyLink>
          {' '}لمزيد من المعلومات.
        </p>
      </div>
    );
  }
  return (
    <div style={wrap}>
      <p style={line}>Your host needs a mobile number to reach you about this event — your table number, your entry pass, and any change of date or venue are sent by text.</p>
      <p style={line}>You can stop the messages at any time by replying STOP, or reply HELP for assistance.</p>
      <p style={line}>Your decision to receive SMS messages is completely independent from acceptance of our Privacy Policy or Terms of Service.</p>
      <p style={{ ...line, marginBottom: 0 }}>
        See our{' '}
        <PolicyLink href="/privacy" style={linkStyle}>Privacy Policy</PolicyLink>
        {' '}and{' '}
        <PolicyLink href="/terms" style={linkStyle}>Terms of Service</PolicyLink>
        {' '}for additional information.
      </p>
    </div>
  );
}
