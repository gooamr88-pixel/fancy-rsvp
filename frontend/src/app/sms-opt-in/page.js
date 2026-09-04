import Link from "next/link";
import Navbar from "../components/landing/Navbar";
import FooterSection from "../components/landing/FooterSection";
import OptInForm from "./OptInForm";
import { COMPANY_NAME, COMPANY_CITY, COMPANY_LOCATION, COMPANY_SITE, ADDRESS_CONFIGURED, addressOneLine } from "../utils/company";

/* ═══════════════════════════════════════════════════════════
   SMS Opt-In & Consent — public opt-in page
   ═══════════════════════════════════════════════════════════
   This is the opt-in URL submitted with the Twilio Toll-Free
   Verification. It must stay:
   • public (no login, no CAPTCHA, no reveal animation),
   • server-rendered (full content in the initial HTML),
   • a LIVE opt-in flow (OptInForm posts to /public/sms-opt-in
     and persists a timestamped consent record — reviewers must
     see a working form, not a demonstration), and
   • an exact mirror of the consent language guests see inside
     every event RSVP form (SmsConsentText + SmsConsentIndependence
     are the same components the live forms render — never fork
     the wording), and
   • truthful about the flow it describes: SMS consent is
     OPTIONAL everywhere. An RSVP submits with the box unticked
     (RsvpWizard, heritageArch RsvpSection, rsvpController), and
     only parties with sms_consent = true are sendable — enforced
     both in the audience query and per message
     (smsDispatch.fetchRecipients + sendRecipient). sms_consent
     becomes true two ways, and BOTH are described below: the
     guest's own opt-in, or a host attestation recorded per guest
     (guestService.recordHostConsentAttestation, which can never
     overwrite a guest's own decision). If any of that changes,
     the "How a Guest Opts In" and "Consent Obtained by the Event
     Host" sections below become false.
   ═══════════════════════════════════════════════════════════ */

export const metadata = {
  title: "SMS Opt-In & Consent — Fancy RSVP",
  description:
    `How Fancy RSVP collects SMS consent from event guests: opt-in flow, message types, frequency, rates, and STOP/HELP opt-out instructions. Operated by ${COMPANY_NAME}.`,
  alternates: { canonical: "https://fancyrsvp.com/sms-opt-in" },
};

const SERIF = "var(--font-serif)";
const SANS = "var(--font-sans)";
const GOLD = "#B8944F";
const INK = "#191B1E";
const BODY = "#5E5A52";
const LINE = "#E8E2D6";

function SectionTitle({ children }) {
  return (
    <h2
      style={{
        fontFamily: SERIF,
        fontSize: "22px",
        fontWeight: 700,
        color: INK,
        margin: "0 0 16px",
        paddingLeft: "14px",
        borderLeft: `3px solid ${GOLD}`,
      }}
    >
      {children}
    </h2>
  );
}

function P({ children, style }) {
  return (
    <p style={{ fontFamily: SANS, fontSize: "15px", color: BODY, lineHeight: 1.8, margin: "0 0 14px", ...style }}>
      {children}
    </p>
  );
}

function Card({ children, style }) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        border: `1px solid ${LINE}`,
        borderRadius: "16px",
        padding: "28px",
        boxShadow: "0 2px 12px rgba(0,0,0,0.03)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export default function SmsOptInPage() {
  return (
    <>
      <Navbar />
      <main style={{ paddingTop: "78px", background: "#FFFFFF" }}>
        {/* ── Hero ── */}
        <section
          className="fx-section fx-section--sm fx-section--tight-bottom"
          style={{
            background: "linear-gradient(180deg, #FAF7F0 0%, #FFFFFF 100%)",
            "--fx-pad-x": "24px",
            textAlign: "center",
          }}
        >
          <span
            style={{
              fontFamily: SANS,
              fontSize: "13px",
              fontWeight: 700,
              letterSpacing: "3px",
              textTransform: "uppercase",
              color: GOLD,
              display: "block",
              marginBottom: "16px",
            }}
          >
            SMS Program
          </span>
          <h1
            style={{
              fontFamily: SERIF,
              fontSize: "clamp(1.8rem, 5.5vw, 2.75rem)",
              fontWeight: 700,
              color: INK,
              marginBottom: "16px",
              lineHeight: 1.2,
            }}
          >
            SMS Opt-In &amp; Consent
          </h1>
          <p
            style={{
              fontFamily: SANS,
              fontSize: "16px",
              color: BODY,
              lineHeight: 1.6,
            }}
            className="fx-container fx-container--md"
          >
            This page explains exactly how Fancy RSVP collects consent before sending any text message, what
            guests agree to, and how to opt out at any time.
          </p>
        </section>

        <section className="fx-container fx-container--lg fx-gutter" style={{ "--fx-pad-x": "24px", paddingTop: "var(--fx-pad-y-xs)", paddingBottom: "var(--fx-pad-y-sm)" }}>
          {/* ── Who operates this program ── */}
          <div style={{ marginBottom: "44px" }}>
            <SectionTitle>Who Operates This Program</SectionTitle>
            <Card>
              <P style={{ marginBottom: "10px" }}>
                <strong style={{ color: INK }}>Fancy RSVP</strong> (fancyrsvp.com) is an event invitation and
                RSVP platform owned and operated by{" "}
                <strong style={{ color: INK }}>{COMPANY_NAME}</strong>, based in {COMPANY_CITY}. The brand and
                the operator are the same party, and are the sender of every text message described on this
                page; there is no other party sending on our behalf.
              </P>
              <ul style={{ fontFamily: SANS, fontSize: "15px", color: BODY, lineHeight: 1.9, margin: 0, paddingLeft: "20px" }}>
                <li>
                  <strong style={{ color: INK }}>Brand:</strong> FancyRSVP — also written{" "}
                  <strong style={{ color: INK }}>Fancy RSVP</strong> in our logo, on this website, and in the
                  sender identification appended to every text message. The two spellings are the same brand
                  and the same sender; there is no other.
                </li>
                {/* ⚠ THIS BLOCK IS READ BY A TWILIO TFV REVIEWER.
                    It must match the business identity on the Toll-Free
                    Verification submission exactly. This account has already
                    been rejected once for "Business could not be verified",
                    and the recorded cause was that the site published a
                    California identity while the submission named a Canadian
                    corporation. Changing the identity here without
                    re-submitting there recreates that mismatch. */}
                <li><strong style={{ color: INK }}>Operated by:</strong> {COMPANY_NAME}</li>
                <li>{ADDRESS_CONFIGURED ? "Business address: " : "Based in: "}{ADDRESS_CONFIGURED ? addressOneLine() : COMPANY_LOCATION}</li>
                <li>
                  Website:{" "}
                  <a href={COMPANY_SITE} target="_blank" rel="noopener noreferrer" style={{ color: GOLD, fontWeight: 600 }}>
                    fancyrsvp.com
                  </a>
                </li>
                <li>
                  Contact:{" "}
                  <a href="mailto:info@fancyrsvp.com" style={{ color: GOLD, fontWeight: 600 }}>
                    info@fancyrsvp.com
                  </a>
                </li>
              </ul>
            </Card>
          </div>

          {/* ── What messages we send ── */}
          <div style={{ marginBottom: "44px" }}>
            <SectionTitle>What Messages We Send</SectionTitle>
            <P>
              Fancy RSVP sends <strong style={{ color: INK }}>transactional and informational</strong> text
              messages only, on behalf of the host of an event the recipient was personally invited to. The
              program covers exactly these five message types and nothing else:
            </P>
            <ul style={{ fontFamily: SANS, fontSize: "15px", color: BODY, lineHeight: 2, margin: "0 0 14px", paddingLeft: "20px" }}>
              <li><strong style={{ color: INK }}>Event invitations</strong> — a personal invitation with the guest’s RSVP link</li>
              <li><strong style={{ color: INK }}>RSVP confirmations</strong> — confirmation that we received the guest’s response</li>
              <li><strong style={{ color: INK }}>RSVP updates</strong> — changes to the guest’s own response, or a follow-up when no response has been received</li>
              <li><strong style={{ color: INK }}>Event reminders</strong> — RSVP deadline and event-date reminders</li>
              <li><strong style={{ color: INK }}>Event updates</strong> — date, time, or venue changes and day-of logistics</li>
            </ul>
            <P style={{ marginBottom: 0 }}>
              This is not a marketing service. We never send promotional or advertising messages through this
              program, and we send nothing outside the five types above. The consent language on the checkbox
              below covers this same set, referring to event invitations as “invitation links” and to RSVP
              confirmations and RSVP updates together as “RSVP confirmations.”
            </P>
          </div>

          {/* ── How opt-in works ── */}
          <div style={{ marginBottom: "44px" }}>
            <SectionTitle>How a Guest Opts In</SectionTitle>
            <ol style={{ fontFamily: SANS, fontSize: "15px", color: BODY, lineHeight: 2, margin: "0 0 14px", paddingLeft: "20px" }}>
              <li>A guest opens their event’s public RSVP form (no account or login required).</li>
              <li>
                A guest who <strong style={{ color: INK }}>declines</strong> is asked for neither a number nor
                consent — neither field is shown to them, and neither is required to submit. We send no
                messages at all to a guest who is not attending, so there is nothing for them to consent to.
              </li>
              <li>
                A guest who <strong style={{ color: INK }}>accepts</strong> is asked for a mobile number and
                shown an <strong style={{ color: INK }}>unchecked</strong> consent checkbox carrying the exact
                language below. Directly above it the form states why the number is needed: the host sends that
                guest their table assignment and entry pass by text, and uses the same channel to reach them if
                the date or venue changes.
              </li>
              <li>
                The checkbox is <strong style={{ color: INK }}>never pre-checked</strong> and is never ticked
                on the guest’s behalf. Consent is never inferred from a guest providing a number, and it is
                never collected by any other control, button, or agreement on the page.
              </li>
              <li>
                For an accepting guest, both the number and the checkbox are{" "}
                <strong style={{ color: INK }}>required to submit this form</strong>, and the form says so
                before it is submitted. A guest who wishes to attend but not to receive text messages can ask
                their host to add them to the guest list directly instead, without providing a number — and any
                guest who has opted in can end all messages immediately by replying STOP, which never affects
                their RSVP, their seat, or their attendance.
              </li>
              <li>
                The guest’s choice is stored as a timestamped record tied to their response, alongside an
                identifier for the exact version of the consent wording they were shown.
              </li>
              <li>
                A guest who leaves the box unticked is excluded from every send, and that exclusion is enforced
                at the point of sending, not merely in the interface. Their refusal is permanent until they
                choose otherwise — it cannot be overridden by anyone, including the event host (see
                &ldquo;Consent Obtained by the Event Host&rdquo; below, which is the only other way a number can
                become messageable).
              </li>
            </ol>
            <P style={{ marginBottom: 0 }}>
              Guests who decline to provide a phone number, or who leave the box unticked, never receive text
              messages from us.
            </P>
          </div>

          {/* ── Host-obtained consent ──
              Truthfulness requirement: the platform DOES send to numbers an
              organizer supplied, when that organizer formally attested they hold
              the guest's consent. A reviewer must be told that plainly rather
              than discovering it. Mirrors Terms §5 and Privacy §3 — keep all
              three in step, and keep this honest about who obtained consent. */}
          <div style={{ marginBottom: "44px" }}>
            <SectionTitle>Consent Obtained by the Event Host</SectionTitle>
            <P>
              Event hosts often already hold their guests&rsquo; permission to text them about an event — a
              wedding party, a company roster, a family list gathered long before the host chose our platform.
              That consent belongs to the guest, and it remains valid regardless of which tool the host uses to
              act on it. We therefore allow a second, narrower path onto our messaging list, with conditions:
            </P>
            <ul style={{ fontFamily: SANS, fontSize: "15px", color: BODY, lineHeight: 2, margin: "0 0 14px", paddingLeft: "20px" }}>
              <li>
                When a host adds or imports a guest&rsquo;s phone number, they are shown a separate, unchecked
                box and must affirmatively confirm: <em>&ldquo;I have obtained this recipient&rsquo;s consent to
                receive event-related SMS messages.&rdquo;</em>
              </li>
              <li>
                That confirmation is recorded against that specific guest, with the host&rsquo;s identity and a
                timestamp — not as a blanket setting. If the host does not confirm it, the number is stored on
                their guest list and is <strong style={{ color: INK }}>never</strong> sent a text message.
              </li>
              <li>
                The host warrants under our{" "}
                <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: GOLD, fontWeight: 600 }}>Terms of Service</a>{" "}
                that the consent is genuine, prior, and express, and they carry responsibility for it.
              </li>
              <li>
                <strong style={{ color: INK }}>A guest&rsquo;s own decision always overrides a host&rsquo;s.</strong>{" "}
                If a guest was shown our consent checkbox and left it unticked, no host attestation can enable
                messaging for that number. A STOP reply likewise suppresses the number permanently and platform-wide,
                whatever any host has confirmed.
              </li>
            </ul>
            <P style={{ marginBottom: 0 }}>
              Every message sent on this basis carries the same sender identification, rates disclosure, and
              STOP/HELP instructions as any other, so a recipient can end it immediately. We never purchase,
              rent, or scrape numbers, and a host&rsquo;s confirmation is never a substitute for the guest&rsquo;s
              right to opt out.
            </P>
          </div>

          {/* ── Independence of consent ──
              Written for Twilio rejection code 30475 ("Consent for Messaging
              Cannot Be Part of Other Agreements"). Mirrors the notice rendered
              under every consent checkbox by SmsConsentIndependence — if that
              component's wording changes, change this with it.

              REWRITTEN 2026-09-04, when the RSVP form's consent checkbox became
              required to submit. This page is the disclosure a reviewer reads
              ALONGSIDE that form, so every claim on it has to survive being
              checked against the live page. Three sentences were removed
              outright because they became false — "not required to … RSVP",
              "never a condition of … submitting an RSVP", and "never bundled
              into a submit action". What remains is the part that is still
              true, stated plainly, plus an explicit description of what the
              form now does. Do not restore the old wording without also
              reverting the required checkbox. */}
          <div style={{ marginBottom: "44px" }}>
            <SectionTitle>SMS Consent Is Separate From Every Other Agreement</SectionTitle>
            <Card style={{ background: "#FCFAF5" }}>
              <P>
                <strong style={{ color: INK }}>
                  SMS consent is collected by a single dedicated checkbox that asks about text messaging and
                  nothing else.
                </strong>{" "}
                Ticking it agrees to receive texts — it does not accept our Terms of Service, our Privacy
                Policy, or any other agreement, and no other agreement collects it on our behalf. It is never
                pre-checked, and it is never inferred from a guest simply providing a phone number.
              </P>
              <P>
                A guest&rsquo;s decision about text messages is completely independent from acceptance of our
                Privacy Policy or Terms of Service. Neither document asks for SMS consent, neither one grants
                it, and accepting either has no effect on whether a guest receives texts. Equally, a guest who
                opts in to texts is not required to accept either document.
              </P>
              <P>
                <strong style={{ color: INK }}>Where consent is required:</strong> when a guest{" "}
                <strong style={{ color: INK }}>accepts</strong> an invitation through a host&rsquo;s RSVP form,
                a mobile number and this checkbox are required to submit that form. The host uses text messages
                to deliver that guest&rsquo;s table assignment and entry pass and to reach them if the date or
                venue changes, and the form states this directly above the checkbox. A guest who{" "}
                <strong style={{ color: INK }}>declines</strong> is asked for neither, and is shown neither,
                because no message is ever sent to a guest who is not attending. A guest who wishes to attend
                but not to receive texts can ask their host to be added to the guest list directly, without
                providing a number.
              </P>
              <P style={{ marginBottom: 0 }}>
                Opting in on this page is entirely voluntary and is not connected to any RSVP. Wherever consent
                is given, it can be withdrawn at any moment by replying STOP — which stops every message from
                every event immediately and permanently, and never affects a guest&rsquo;s RSVP, their seat, or
                their attendance.
              </P>
            </Card>
          </div>

          {/* ── The live opt-in form ── */}
          <div style={{ marginBottom: "44px" }}>
            <SectionTitle>Opt In to Fancy RSVP Texts</SectionTitle>
            <P>
              This is a live opt-in form — not a demonstration. It uses the exact same consent language, and
              the same independence notice, that every guest sees inside their event&rsquo;s RSVP form. The
              checkbox is unchecked by default, and submitting the form records your consent together with a
              timestamp, the version of the consent wording shown, and the phone number you entered:
            </P>
            <Card style={{ background: "#FCFAF5" }}>
              <OptInForm />
            </Card>
          </div>

          {/* ── Frequency, rates ── */}
          <div style={{ marginBottom: "44px" }}>
            <SectionTitle>Message Frequency &amp; Rates</SectionTitle>
            <P style={{ marginBottom: 0 }}>
              <strong style={{ color: INK }}>Message frequency varies</strong> depending on the event and on
              your own activity; a typical guest receives approximately 1–5 messages per event (for example,
              one invitation, one or two reminders, and a day-of update). There is no recurring or scheduled
              series — we send only when the host has something to tell you about an event you were invited
              to.{" "}
              <strong style={{ color: INK }}>Message &amp; data rates may apply</strong> depending on your
              mobile carrier plan. Every message identifies Fancy RSVP as the sender and carries
              “Reply STOP to opt out, HELP for help.”
            </P>
          </div>

          {/* ── Sample messages ──
              These are literal renderings of what the dispatcher produces. The
              trailing sentence is COMPLIANCE_FOOTER in
              backend/services/smsDispatch.js, appended to EVERY outbound body —
              if that constant ever changes, change these samples with it. */}
          <div style={{ marginBottom: "44px" }}>
            <SectionTitle>What Our Messages Look Like</SectionTitle>
            <P>
              Every message we send ends with the same sender identification, rates disclosure, and opt-out
              instruction — it is appended automatically and cannot be removed by a host:
            </P>
            <Card style={{ background: "#FCFAF5", padding: "22px" }}>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "14px" }}>
                {[
                  "Hello Alexander, you are cordially invited to Sophia & Julian's Wedding Gala on Oct 24th. Kindly RSVP at: https://fancyrsvp.com/sophia-julian/rsvp?g=8f2c",
                  "Hi Alexander, we have your RSVP for Sophia & Julian's Wedding Gala - party of 2. See you on Oct 24th.",
                  "Reminder: Sophia & Julian's Wedding Gala is this Saturday at 6pm, Cascade Hall. Doors open at 5:30pm.",
                ].map((sample, i) => (
                  <li
                    key={i}
                    style={{
                      fontFamily: SANS, fontSize: "13.5px", color: BODY, lineHeight: 1.75,
                      background: "#FFFFFF", border: `1px solid ${LINE}`, borderRadius: "12px", padding: "14px 16px",
                    }}
                  >
                    {sample}
                    <span style={{ color: INK, fontWeight: 600 }}>
                      {" "}- Fancy RSVP. Msg&amp;data rates may apply. Reply STOP to opt out, HELP for help.
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {/* ── Opt out ── */}
          <div style={{ marginBottom: "44px" }}>
            <SectionTitle>How to Opt Out or Get Help</SectionTitle>
            <ul style={{ fontFamily: SANS, fontSize: "15px", color: BODY, lineHeight: 2, margin: "0 0 14px", paddingLeft: "20px" }}>
              <li>
                Reply <strong style={{ color: INK }}>STOP</strong> (or UNSUBSCRIBE, CANCEL, END, or QUIT) to any
                message to stop receiving texts. You’ll receive one final confirmation, then no further messages.
              </li>
              <li>
                Reply <strong style={{ color: INK }}>HELP</strong> to any message for assistance.
              </li>
              <li>
                Or email{" "}
                <a href="mailto:info@fancyrsvp.com" style={{ color: GOLD, fontWeight: 600 }}>
                  info@fancyrsvp.com
                </a>{" "}
                and we’ll process the request for you.
              </li>
            </ul>
            <P style={{ marginBottom: 0 }}>
              Opting out never affects a guest’s RSVP or their ability to attend an event — hosts can still reach
              them by email or other contact methods they’ve shared.
            </P>
          </div>

          {/* ── No sale / no sharing ──
              Twilio checks for this clause explicitly. It also appears in
              Privacy Policy §3; keep the two consistent. */}
          <div style={{ marginBottom: "44px" }}>
            <SectionTitle>We Never Sell or Share Your Number</SectionTitle>
            <Card style={{ background: "#FCFAF5" }}>
              <P style={{ marginBottom: 0, fontSize: "15.5px" }}>
                <strong style={{ color: INK }}>
                  Phone numbers and SMS consent records are never sold, rented, or shared with third parties
                  for marketing purposes.
                </strong>{" "}
                No mobile information — including phone numbers, opt-in status, and consent records — is
                shared with, sold to, rented to, or otherwise disclosed to any third party or affiliate for
                their own marketing or promotional purposes. The only third party that ever receives a guest’s
                number is our messaging carrier, Twilio, acting solely as our processor for the purpose of
                delivering the messages described on this page. Text-message originator opt-in data and consent
                are never shared with any third party.
              </P>
            </Card>
          </div>

          {/* ── Policies ── */}
          <div>
            <SectionTitle>Full Terms &amp; Privacy</SectionTitle>
            <P>
              Complete SMS terms are in{" "}
              <Link href="/terms" style={{ color: GOLD, fontWeight: 600 }}>
                Terms of Service — Section 5 (SMS Messaging Terms &amp; Conditions)
              </Link>
              , and full details on phone-number data handling, consent records, and your rights are in our{" "}
              <Link href="/privacy" style={{ color: GOLD, fontWeight: 600 }}>
                Privacy Policy — Section 3 (SMS/Text Messaging Communications &amp; Consent)
              </Link>
              .
            </P>
          </div>
        </section>
      </main>
      <FooterSection />
    </>
  );
}
