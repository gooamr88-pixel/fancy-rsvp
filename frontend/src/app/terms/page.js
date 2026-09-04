"use client";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import Navbar from "../components/landing/Navbar";
import FooterSection from "../components/landing/FooterSection";
import InvitationShowcase from "../components/templates/InvitationShowcase";
import { REFUND_TERMS, PAYMENT_MODEL } from "../utils/refundPolicy";
import { COMPANY_NAME, ADDRESS_CONFIGURED, addressOneLine, COMPANY_LOCATION } from "../utils/company";

/* ═══════════════════════════════════════════════════════════
   Terms of Service — Fancy RSVP
   Clean layout, TOC sidebar, 10 legal sections
   ═══════════════════════════════════════════════════════════ */

const sections = [
  {
    id: "acceptance",
    title: "1. Acceptance of Terms",
    content: [
      "By accessing or using the Fancy RSVP platform (\"Service\"), you agree to be bound by these Terms of Service (\"Terms\"). If you do not agree to all of these Terms, you may not access or use the Service.",
      `These Terms constitute a legally binding agreement between you ("User," "you," or "your") and ${COMPANY_NAME} ("Company," "we," "us," or "our"), the owner and operator of the Fancy RSVP platform, ${ADDRESS_CONFIGURED ? `with its registered office at ${addressOneLine()}` : `based in ${COMPANY_LOCATION}`}. They govern your access to and use of our website, applications, APIs, and all related services.`,
      "We may update these Terms from time to time. We will notify you of material changes at least 14 days before they take effect by sending an email to the address associated with your account or by posting a prominent notice on our platform. Your continued use of the Service after any changes constitutes your acceptance of the revised Terms.",
      "If you are using the Service on behalf of an organization, you represent and warrant that you have the authority to bind that organization to these Terms, and references to \"you\" shall include that organization.",
    ],
  },
  {
    id: "service-description",
    title: "2. Description of Service",
    content: [
      "Fancy RSVP provides a cloud-based event management and RSVP platform that enables users to create digital invitations, manage guest lists, track responses, design seating charts, and communicate with event attendees.",
      "**Core Features:** Digital RSVP creation and management, customizable invitation templates, real-time response tracking dashboard, guest list import and organization, seating chart designer, email and SMS notification campaigns, analytics and reporting, and third-party integrations.",
      "**Service Tiers:** The Service is offered in multiple tiers — Free, Professional, and Enterprise — each with varying feature sets, guest limits, and support levels as described on our pricing page.",
      "**Availability:** We strive to maintain 99.9% uptime for our platform. However, we reserve the right to perform scheduled maintenance (with advance notice) and cannot guarantee uninterrupted access during force majeure events or circumstances beyond our reasonable control.",
      "**Modifications:** We continuously improve our Service and may add, modify, or discontinue features at our discretion. For material changes that negatively affect your use, we will provide at least 30 days' advance notice and work with you on transition options.",
    ],
  },
  {
    id: "account-registration",
    title: "3. Account Registration",
    content: [
      "To access certain features of the Service, you must create an account. When registering, you agree to the following:",
      "**Accurate Information:** You must provide truthful, accurate, and complete registration information and keep it updated. Providing false information may result in account suspension or termination.",
      "**Account Security:** You are responsible for maintaining the confidentiality of your account credentials, including your password. We strongly recommend enabling two-factor authentication. You must notify us immediately at info@fancyrsvp.com if you suspect unauthorized access to your account.",
      "**Account Responsibility:** You are responsible for all activities that occur under your account, whether or not you authorized them. This includes actions taken by team members you've granted access to your account.",
      "**Age Requirement:** You must be at least 16 years old to create an account. If you are under 18, you may use the Service only with the involvement and consent of a parent or legal guardian.",
      "**One Account Per Person:** Each individual may maintain only one account. Creating multiple accounts to circumvent restrictions, abuse promotions, or evade enforcement actions is prohibited.",
    ],
  },
  {
    id: "user-responsibilities",
    title: "4. User Responsibilities",
    content: [
      "As a user of Fancy RSVP, you agree to use the Service responsibly and in compliance with all applicable laws. Specifically, you agree not to:",
      "**Misuse the Platform:** Use the Service for any unlawful purpose, to send unsolicited communications (spam), distribute malware, or engage in any activity that could harm other users or our infrastructure.",
      "**Violate Privacy:** Collect, store, or share personal information of your guests without their appropriate consent. You are the data controller for guest information you upload and must comply with applicable privacy laws (GDPR, CCPA, etc.).",
      "**Infringe Rights:** Upload, post, or transmit content that infringes on intellectual property rights, trademarks, or other proprietary rights of any third party.",
      "**Compromise Security:** Attempt to probe, scan, or test the vulnerability of our systems; circumvent authentication or security measures; reverse-engineer any aspect of the Service; or interfere with any user's access to the Service.",
      "**Abuse Resources:** Use automated tools (bots, scrapers) to access the Service in a manner that exceeds reasonable use, generates excessive load on our servers, or extracts data in bulk without our written consent.",
      "**Share Inappropriately:** Upload or distribute content that is defamatory, obscene, hateful, discriminatory, or otherwise objectionable through our platform.",
      "Violation of these responsibilities may result in warnings, temporary suspension, or permanent termination of your account at our sole discretion.",
    ],
  },
  {
    id: "sms-terms",
    title: "5. SMS Messaging Terms & Conditions",
    content: [
      "If you (as an event host) or your guests send or receive text messages through the Service, the following additional terms apply and are incorporated into these Terms of Service and our Privacy Policy.",
      "**Consent to Receive Text Messages Is Never Given Through These Terms:** Nothing in these Terms of Service, and no acceptance of these Terms or of our Privacy Policy, constitutes consent to receive text messages. SMS consent is collected only through a dedicated, separate, unchecked opt-in checkbox that refers to nothing but text messaging, and it is never bundled with these Terms, with the Privacy Policy, with account registration, or with any other agreement, purchase, or transaction. It is never pre-checked, and it is never inferred from a recipient providing a phone number.",
      "**Where SMS Consent Is Required:** When a guest ACCEPTS a host's invitation using an RSVP form on the Service, a mobile number and the SMS consent checkbox are required in order to submit that form, because the host delivers that guest's table assignment and entry pass by text message and uses the same channel to notify them of a change of date or venue. The form states this above the checkbox before it is submitted. A guest who DECLINES an invitation is never asked for either: neither field is shown to them and neither is required, because no message is ever sent to a guest who is not attending. SMS consent is never a condition of registering for an account, of purchasing anything, or of otherwise using the Service, and it is never a condition of attending an event: a guest who does not wish to receive text messages may ask their host to add them to the guest list directly, without providing a number.",
      "**Withdrawal Never Costs a Guest Anything:** A recipient may withdraw consent at any time by replying STOP. Withdrawal takes effect immediately and platform-wide, and it never affects their RSVP, their seat or table assignment, their entry pass, their account, or their attendance at any event.",
      "**Program Description:** Fancy RSVP's SMS feature allows event hosts to send transactional and informational text messages to their own guests. The program covers exactly five message types and nothing else: event invitations, RSVP confirmations, RSVP updates, event reminders, and event updates (including day-of check-in and logistics instructions). This is not a marketing or promotional messaging service. Hosts may not use it to send unsolicited advertising, political messaging, debt collection, or any content unrelated to the specific event the recipient was invited to.",
      `**Host Consent Obligations:** If you upload, import, or otherwise add a guest's phone number to the Service rather than having the guest submit it themselves, you represent and warrant that: (a) you have obtained that guest's prior express consent to receive text messages about your event before adding their number; (b) you will honor any opt-out request immediately and will not re-add that guest's number to any future messaging list without obtaining fresh consent; and (c) you are solely responsible for your own compliance with the TCPA, CTIA guidelines, and any applicable state-level telemarketing and texting laws with respect to numbers you supply. You agree to indemnify and hold harmless ${COMPANY_NAME} from any claim, fine, or penalty arising from your failure to obtain proper consent for a phone number you provided.`,
      "**How Your Attestation Works:** When you add or import a guest's phone number, you are shown a separate, unchecked confirmation stating that you have obtained that recipient's consent to receive event-related SMS messages. Ticking it is optional. If you do not tick it, the number is saved to your guest list but the Service will never send it a text message. If you do tick it, we record that confirmation against that specific guest together with your account identity and the date, and the guest becomes eligible to receive your event messages. That record is your representation, not the guest's — you remain solely responsible for its accuracy, and we may require you to produce evidence of the underlying consent. Two limits apply and cannot be waived: a guest who was shown our own SMS consent checkbox and declined can never be re-enabled by your confirmation, and any recipient who replies STOP is suppressed permanently and platform-wide regardless of what you have confirmed.",
      "**No Sale or Sharing of Mobile Data:** Consistent with our Privacy Policy, Fancy RSVP will never sell, rent, license, trade, or share any mobile phone number, opt-in record, or consent data collected through the SMS feature with any third party or affiliate for marketing or promotional purposes. This commitment cannot be waived or modified by any other provision of these Terms.",
      "**Message Frequency & Charges:** Message frequency varies by event and is generally limited to confirmations, reminders, and day-of logistics — typically 1–5 messages per event per guest. Message and data rates may apply. Neither Fancy RSVP nor the event host is responsible for charges imposed by a guest's wireless carrier.",
      "**Opt-Out and Help:** Any recipient may opt out at any time by replying **STOP**, **UNSUBSCRIBE**, **CANCEL**, **END**, or **QUIT**, and may request assistance by replying **HELP**. Fancy RSVP processes all opt-out requests promptly and will not permit an event host to re-message an opted-out number. These rights cannot be waived by any agreement between a host and a guest.",
      "**Platform Enforcement:** We reserve the right to suspend or terminate any account, event, or campaign that we determine, in our sole discretion, violates this SMS policy, generates an unacceptable spam-complaint rate, or otherwise risks our standing with wireless carriers or messaging infrastructure providers. We may require re-verification of consent records before resuming SMS delivery for an affected account.",
      "**No Guarantee of Delivery:** SMS delivery depends on third-party wireless carriers and is not guaranteed. Fancy RSVP is not liable for delayed, undelivered, or misdirected messages caused by carrier filtering, network conditions, or incorrect contact information supplied by the host.",
    ],
  },
  {
    id: "intellectual-property",
    title: "6. Intellectual Property",
    content: [
      "The intellectual property rights related to the Service are allocated as follows:",
      "**Our Property:** The Service, including its design, code, features, templates, graphics, documentation, and branding (collectively, \"Platform IP\"), is owned by the Company and protected by copyright, trademark, and other intellectual property laws. You may not copy, modify, distribute, or create derivative works of our Platform IP without express written permission.",
      "**Your Content:** You retain ownership of all content you create or upload to the Service, including event details, custom designs, guest lists, and communications (\"User Content\"). By using the Service, you grant us a limited, non-exclusive, royalty-free license to host, display, and process your User Content solely for the purpose of providing the Service to you.",
      "**Templates & Designs:** While you may use our templates and design elements to create your events, the underlying template designs remain our property. Events you create using our templates are your property, but the templates themselves may not be extracted, resold, or redistributed.",
      "**Feedback:** If you provide suggestions, ideas, or feedback about the Service, you grant us an irrevocable, perpetual, royalty-free license to use and incorporate that feedback into our products without any obligation to you.",
      "**DMCA & Takedowns:** We respect intellectual property rights. If you believe content on our platform infringes your copyright, please submit a DMCA takedown notice to info@fancyrsvp.com with the required information.",
    ],
  },
  {
    id: "payment-terms",
    title: "7. Payment Terms",
    /* REWRITTEN 2026-08-21. This section described a SUBSCRIPTION — monthly
       and annual billing cycles, renewals, failed recurring payments,
       downgrades on non-payment — and Fancy RSVP has never sold one. What it
       sells is a free tier plus a one-time fee per event, which is what the
       pricing page shows and what paymentController actually charges.

       That mismatch was not cosmetic: it is why this site answered "can I get
       a refund?" three different ways. A clause written around renewal dates
       cannot be applied to a product with none, so every other surface
       improvised its own answer, and each improvised differently. The refund
       and billing wording now comes from utils/refundPolicy.js, which every
       surface imports and none paraphrases. */
    content: [
      PAYMENT_MODEL,
      "**Pricing:** Prices are listed on our pricing page and may change. A change never affects an event you have already paid for — the price and the plan are fixed at the moment of purchase.",
      "**Payment Method:** Paid plans are charged once, at the point you publish an event. Where card payment is enabled for your account it is handled by our payment processor, and we never see or store your card details; where it is not, our team arranges bank transfer or another accepted method with you directly.",
      "**Upgrading An Event:** You may move an event to a higher plan at any time from that event's payment settings. You are charged only the difference between the plan you already paid for and the new one. Moving an event to a lower plan is not self-service; contact us and we will arrange it.",
      "**Guest And Event Limits:** Each plan states the number of guests it covers and, where applicable, how many events it may publish. There is no automatic per-guest overage charge: when an event reaches its limit, new responses pause until you choose to upgrade. You are never billed more than the plan you selected without explicitly choosing to.",
      "**Add-Ons:** Some capabilities are bought separately from the plan and are metered — text messaging is charged per message, and printed goods are quoted per order. These are stated as such at the point of purchase and are billed independently of the event licence.",
      REFUND_TERMS,
      "**Taxes:** Stated prices do not include applicable taxes (VAT, GST, sales tax). Taxes will be calculated and added based on your billing address and applicable tax regulations.",
      "**Free Tier:** The Free plan is provided at no cost with limited features and guest capacity. We reserve the right to modify the Free plan's feature set with reasonable notice.",
    ],
  },
  {
    id: "limitation-liability",
    title: "8. Limitation of Liability",
    content: [
      "To the maximum extent permitted by applicable law:",
      "**Disclaimer of Warranties:** The Service is provided \"as is\" and \"as available\" without warranties of any kind, whether express, implied, statutory, or otherwise. We disclaim all warranties, including implied warranties of merchantability, fitness for a particular purpose, title, and non-infringement.",
      "**Limitation of Damages:** In no event shall the Company, its directors, employees, partners, agents, or affiliates be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of profits, data, business opportunities, or goodwill, arising out of or in connection with your use of the Service.",
      "**Maximum Liability:** Our total aggregate liability for any claims arising under these Terms or related to the Service shall not exceed the greater of (a) the amount you paid us in the 12 months preceding the claim, or (b) one hundred US dollars ($100).",
      "**Exceptions:** Nothing in these Terms shall limit our liability for (a) death or personal injury caused by our negligence, (b) fraud or fraudulent misrepresentation, or (c) any liability that cannot be excluded or limited by applicable law.",
      "**Basis of Bargain:** You acknowledge that these limitations are an essential element of the agreement between you and Fancy RSVP, and that the pricing of our Service reflects this allocation of risk.",
    ],
  },
  {
    id: "termination",
    title: "9. Termination",
    content: [
      "Either party may terminate this agreement under the following conditions:",
      "**By You:** You may close your account at any time through your account settings or by contacting info@fancyrsvp.com. There is no billing period to run down — events you have already paid for stay active until they have taken place. After closure, your data is retained for 30 days (grace period) before permanent deletion.",
      "**By Us — For Cause:** We may suspend or terminate your account immediately if you violate these Terms, engage in fraudulent activity, fail to pay fees after notice, or if your use poses a security risk to our platform or other users. We will provide notice and an explanation unless prohibited by law or doing so would compromise security.",
      "**By Us — Without Cause:** We may terminate any Free account that has been inactive for 12 consecutive months. We may discontinue the Service with at least 90 days' prior notice, and will refund in full any event that has been paid for but has not yet taken place.",
      "**Effect of Termination:** Upon termination, your right to use the Service ceases immediately (subject to any grace period). You may export your data before your account is closed. We are not obligated to retain your data after the 30-day grace period, except where required by law.",
      "**Survival:** Sections relating to intellectual property, limitation of liability, indemnification, and governing law shall survive termination of these Terms.",
    ],
  },
  {
    id: "governing-law",
    title: "10. Governing Law",
    content: [
      "These Terms shall be governed by and construed in accordance with the laws of the Province of Ontario and the federal laws of Canada applicable therein, without regard to conflict of law principles.",
      "**Dispute Resolution:** Before initiating formal proceedings, both parties agree to attempt to resolve disputes through good-faith negotiation for a period of at least 30 days. You may contact us at info@fancyrsvp.com to initiate this process.",
      "**Arbitration:** Any dispute that cannot be resolved through negotiation shall be submitted to binding arbitration administered by the ADR Institute of Canada under its Arbitration Rules. The arbitration shall take place in Toronto, Ontario, Canada, and shall be conducted in English.",
      "**Class Action Waiver:** To the extent permitted by applicable law, you agree that any dispute resolution proceedings will be conducted only on an individual basis and not in a class, consolidated, or representative action. If this provision is found unenforceable, the entire arbitration provision shall be void.",
      "**Jurisdiction:** For any matters not subject to arbitration, you consent to the exclusive jurisdiction and venue of the courts of the Province of Ontario, sitting in Toronto, Ontario.",
      "**International Users:** If you access the Service from outside Canada, you are responsible for compliance with local laws. Our Service is controlled and operated from Canada, and we make no representations that the Service is appropriate or available in other locations.",
    ],
  },
  {
    id: "contact-information",
    title: "11. Contact Information",
    content: [
      "If you have questions about these Terms of Service, please contact us through any of the following channels:",
      `**Operated by:** ${COMPANY_NAME}`,
      "**Email:** info@fancyrsvp.com",
      /* See the note in privacy/page.js — same gate, same reason. */
      ADDRESS_CONFIGURED
        ? `**Mail:** ${COMPANY_NAME}, Attn: Legal, ${addressOneLine()}`
        : `**Location:** ${COMPANY_LOCATION}`,
      "For urgent legal matters, including DMCA takedown requests, subpoenas, or law enforcement inquiries, please contact info@fancyrsvp.com with \"URGENT\" in the subject line.",
      "We encourage you to review these Terms regularly to stay informed about your rights and obligations when using Fancy RSVP.",
    ],
  },
];

function TOCLink({ section, isActive, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block",
        background: "none",
        border: "none",
        textAlign: "left",
        padding: "8px 16px",
        fontFamily: "var(--font-sans)",
        fontSize: "13.5px",
        color: isActive ? "#B8944F" : "#5E5A52",
        fontWeight: isActive ? 600 : 400,
        cursor: "pointer",
        borderLeft: `2px solid ${isActive ? "#B8944F" : "transparent"}`,
        transition: "all 0.25s ease",
        lineHeight: 1.5,
        width: "100%",
      }}
    >
      {section.title}
    </button>
  );
}

export default function TermsOfService() {
  const [activeSection, setActiveSection] = useState(sections[0].id);

  useEffect(() => {
    const handleScroll = () => {
      for (const section of sections) {
        const el = document.getElementById(section.id);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 160 && rect.bottom > 160) {
            setActiveSection(section.id);
            break;
          }
        }
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (el) {
      const top = el.offsetTop - 120;
      window.scrollTo({ top, behavior: "smooth" });
    }
  };

  const renderText = (text) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={i} style={{ color: "#191B1E", fontWeight: 600 }}>
            {part.slice(2, -2)}
          </strong>
        );
      }
      return part;
    });
  };

  return (
    <>
      <Navbar />
      <main style={{ paddingTop: "78px" }}>
        {/* ── Hero ── */}
        <section
          style={{
            background: "linear-gradient(180deg, #FAF7F0 0%, #FFFFFF 100%)",
            padding: "72px 24px 56px",
            textAlign: "center",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "13px",
              fontWeight: 700,
              letterSpacing: "3px",
              textTransform: "uppercase",
              color: "#B8944F",
              display: "block",
              marginBottom: "16px",
            }}
          >
            Legal
          </span>
          <h1
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "clamp(1.8rem, 5.5vw, 2.75rem)",
              fontWeight: 700,
              color: "#191B1E",
              marginBottom: "16px",
              lineHeight: 1.2,
            }}
          >
            Terms of Service
          </h1>
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "16px",
              color: "#5E5A52",
              lineHeight: 1.6,
              maxWidth: "540px",
              margin: "0 auto 20px",
            }}
          >
            Please read these terms carefully before using the Fancy RSVP platform. They outline your rights, responsibilities, and our mutual obligations.
          </p>
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "14px",
              color: "#B8944F",
              fontWeight: 600,
            }}
          >
            Last Updated: August 1, 2026
          </p>
        </section>

        {/* ── Gold Divider ── */}
        <div
          className="fx-container fx-container--5xl fx-gutter"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
          }}
        >
          <div style={{ flex: 1, height: "1px", background: "linear-gradient(90deg, transparent, #E8E2D6)" }} />
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 2L12 8L18 10L12 12L10 18L8 12L2 10L8 8L10 2Z" fill="#D7BE80" />
          </svg>
          <div style={{ flex: 1, height: "1px", background: "linear-gradient(90deg, #E8E2D6, transparent)" }} />
        </div>

        {/* ── Content Area with Sidebar ── */}
        {/* Vertical padding stays inline (the 56/80 asymmetry is deliberate)
            but is now fluid; the horizontal 48px moves to .fx-gutter, which
            tapers to 20px at 320px and clears the landscape notch. */}
        <section
          className="fx-container fx-container--5xl fx-gutter"
          style={{
            paddingTop: "clamp(32px, 1.5rem + 2.5vw, 56px)",
            paddingBottom: "var(--fx-pad-y-sm)",
          }}
        >
          <div className="terms-layout">
            {/* Sidebar TOC */}
            <aside className="terms-sidebar">
              <div
                style={{
                  position: "sticky",
                  top: "120px",
                  background: "#FFFFFF",
                  borderRadius: "16px",
                  border: "1px solid #E8E2D6",
                  padding: "28px 8px",
                  boxShadow: "0 2px 12px rgba(0,0,0,0.03)",
                }}
              >
                <p
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "2px",
                    textTransform: "uppercase",
                    color: "#B8944F",
                    padding: "0 16px",
                    marginBottom: "16px",
                  }}
                >
                  Table of Contents
                </p>
                {sections.map((section) => (
                  <TOCLink
                    key={section.id}
                    section={section}
                    isActive={activeSection === section.id}
                    onClick={() => scrollToSection(section.id)}
                  />
                ))}
              </div>

              {/* Premium embedded visual — decorative aside beneath the TOC */}
              <div style={{ marginTop: "20px" }}>
                <InvitationShowcase
                  pattern="serif"
                  theme={{ primary: "#B8944F", secondary: "#D7BE80" }}
                  caption="Every invitation, designed to feel unforgettable."
                />
              </div>
            </aside>

            {/* Main Content */}
            <div className="terms-content">
              {sections.map((section, idx) => (
                <div
                  key={section.id}
                  id={section.id}
                  style={{
                    marginBottom: idx < sections.length - 1 ? "48px" : "0",
                    paddingBottom: idx < sections.length - 1 ? "48px" : "0",
                    borderBottom: idx < sections.length - 1 ? "1px solid #E8E2D6" : "none",
                  }}
                >
                  <h2
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontSize: "24px",
                      fontWeight: 700,
                      color: "#191B1E",
                      marginBottom: "20px",
                      paddingLeft: "16px",
                      borderLeft: "3px solid #B8944F",
                    }}
                  >
                    {section.title}
                  </h2>
                  {section.content.map((para, i) => (
                    <p
                      key={i}
                      style={{
                        fontFamily: "var(--font-sans)",
                        fontSize: "15px",
                        color: "#5E5A52",
                        lineHeight: 1.8,
                        marginBottom: i < section.content.length - 1 ? "14px" : "0",
                      }}
                    >
                      {renderText(para)}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Related Links ── */}
        <section
          style={{
            background: "#FAF7F0",
            padding: "64px 24px",
            textAlign: "center",
          }}
        >
          <div style={{ maxWidth: "600px", margin: "0 auto" }}>
            <h3
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "24px",
                fontWeight: 700,
                color: "#191B1E",
                marginBottom: "16px",
              }}
            >
              Related Documents
            </h3>
            <p
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "15px",
                color: "#5E5A52",
                lineHeight: 1.6,
                marginBottom: "28px",
              }}
            >
              Please also review our Privacy Policy which explains how we collect, use, and protect your personal data.
            </p>
            <div style={{ display: "flex", gap: "16px", justifyContent: "center", flexWrap: "wrap" }}>
              <Link
                href="/privacy"
                className="btn-outline"
                style={{
                  padding: "12px 32px",
                  fontSize: "14px",
                  fontWeight: 600,
                  borderRadius: "8px",
                  textDecoration: "none",
                }}
              >
                Privacy Policy
              </Link>
              <Link
                href="/contact"
                className="btn-gold"
                style={{
                  padding: "12px 32px",
                  fontSize: "14px",
                  fontWeight: 600,
                  borderRadius: "8px",
                  textDecoration: "none",
                }}
              >
                Contact Legal Team
              </Link>
            </div>
          </div>
        </section>
      </main>
      <FooterSection />

      <style jsx>{`
        .terms-layout {
          display: grid;
          grid-template-columns: 260px 1fr;
          gap: 48px;
          align-items: start;
        }
        .terms-sidebar {
          display: block;
        }
        .terms-content {
          min-width: 0;
        }
        @media (max-width: 1023.98px) {
          .terms-layout {
            grid-template-columns: 220px 1fr !important;
            gap: 32px !important;
          }
        }
        @media (max-width: 767.98px) {
          .terms-layout {
            grid-template-columns: 1fr !important;
          }
          .terms-sidebar {
            display: none !important;
          }
        }
        /* The old @media (max-width: 640px) block re-declared exactly the
           1fr the 768px rule above already applies, and could never match
           without it also matching. Removed. */
      `}</style>
    </>
  );
}
