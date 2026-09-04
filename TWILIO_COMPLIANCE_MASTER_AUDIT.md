# TWILIO COMPLIANCE MASTER AUDIT

**Product:** FancyRSVP (https://fancyrsvp.com)
**Legal entity (per TFV submission):** 16941460 CANADA CORP. o/a Via Marketing (https://viamarketing.ca)
**Channel:** Twilio SMS — Toll-Free Verification (TFV)
**Target markets:** United States, Canada
**Audit date:** 2026-07-16
**Audit basis:** Full static review of the repository at `fancy/fancy` (frontend, backend, Supabase migrations, deployment configs) + the Twilio rejection email from Isa Bell dated 2026-07-13. Every finding cites `file:line` evidence from the actual codebase. No files were modified.

---

## ⚠ MATERIAL CHANGE — 2026-09-04: SMS CONSENT IS NOW REQUIRED TO SUBMIT AN RSVP

**Read this before re-filing anything.** Everything below this section describes the
platform as it stood when consent was optional and unbundled. One of its central
premises no longer holds.

**What changed.** On the product owner's explicit instruction, the SMS consent
checkbox on the guest RSVP form is now **required to submit**, and the mobile
number field is **required** with it, for any guest who **accepts or answers
"maybe"**.

**A guest who DECLINES is exempt** — neither field is shown to them and neither
is required. That exemption is load-bearing for the argument below, not a
convenience: a decliner receives no table, no entry pass and no message of any
kind, so demanding consent from them would be a requirement with no
transactional purpose behind it, displayed underneath a disclosure describing
messages they will never receive. "Maybe" is not exempt — they still receive
change-of-date and change-of-venue notices and can convert to a yes.

**Why the copy changed with it.** `SmsConsentIndependence` previously opened with
the sentence filed verbatim against rejection 30475:

> "SMS consent is voluntary and is not required to register, RSVP, attend an
> event, or use FancyRSVP."

That sentence became **false** the moment submission was blocked on the checkbox.
A page that refuses to submit while displaying a notice saying it will not is
worse than either choice made cleanly — it is a false statement inside the exact
screenshot a reviewer takes. It has been removed, and the same claim has been
removed or rewritten everywhere else it appeared:

| Surface | File | Change |
|---|---|---|
| Consent notice under the checkbox | `frontend/src/app/components/guest/SmsConsentText.js` | "voluntary / not required to RSVP" deleted; replaced with why the number is needed + how to stop. `SMS_CONSENT_TEXT_VERSION` → `2026-09-04` |
| Version mirror | `backend/utils/smsConsent.js` | bumped to match |
| Public opt-in disclosure | `frontend/src/app/sms-opt-in/page.js` | "How a Guest Opts In" and the independence card rewritten to describe the required checkbox truthfully |
| Terms of Service §5 | `frontend/src/app/terms/page.js` | "never a condition of … submitting an RSVP" removed; a new **Where SMS Consent Is Required** clause added |
| Privacy Policy §3 | `frontend/src/app/privacy/page.js` | "the phone number itself is optional on every form we operate" removed; same replacement clause added |

**What did NOT change, and must not.**

* The checkbox is still **unchecked by default**, still **dedicated to SMS
  alone**, and still **outside** any Terms/Privacy acceptance. Consent
  independence *from other agreements* — which is what rejection 30475 is
  actually about — is intact.
* **STOP / HELP** are untouched. `sms_opt_outs` still suppresses a number
  globally, across every event, permanently, and is still re-checked per message
  at the final choke point in `backend/services/smsDispatch.js`.
* The send-time gate is unchanged. A required checkbox is a *collection* rule and
  has not been allowed to become a substitute for verifying consent at send time.

### REQUIRED ACTION — the TFV must be re-filed

The submitted document and the live page no longer match, and **the live page is
what gets reviewed**. Re-file with the current wording before, or immediately
after, this deploys.

**This carries real risk and it should be stated plainly:** conditioning the
primary service (responding to an invitation) on SMS consent is the pattern CTIA
guidance and Twilio's TFV review are most likely to challenge, and it is adjacent
to the ground the number was rejected on before. The strongest honest argument
for the current design — and the one to make in the submission — is that all five
message types are **transactional and informational about an event the recipient
personally chose to attend**: their table, their entry pass, and changes of date
or venue. There is no marketing content in the program, and consent is asked
only of guests who will actually receive those messages — a declining guest is
never asked, which is the point that makes the transactional characterisation
literally true rather than merely arguable. The mitigation offered on every
surface is that a guest who wants to attend but not receive texts can be added
to the guest list by the host directly, without a number.

**If the number is deregistered, SMS stops for every customer on the platform at
once.** Section 20's operational checklist still applies.

---

> **REMEDIATION STATUS (updated 2026-07-16, same day):** Sections 1–19 describe the codebase **as audited** and are preserved unchanged as the point-in-time record. Since then, **every Critical, High, and Medium item implementable inside this repository has been implemented** (two batches, uncommitted/undeployed at the time of writing): public `/sms-opt-in` page; `?noreveal=1` reveal bypass; one canonical consent string (`SmsConsentText.js`) across both RSVP paths; full corporate identity (16941460 Canada Corp. o/a Via Marketing, Mississauga ON) on footer/terms/privacy/contact/JSON-LD; Ontario governing law; `/press` deleted and about/careers truthified; migration `20260809000000_sms_compliance.sql` (suppression table + attestation + consent provenance); inbound STOP/HELP webhook; suppression enforced in every send path; compliance footer on every outbound SMS; per-launch and per-import consent attestation; Privacy Policy truth fixes; robots/sitemap; Swagger gate; repo hygiene. **Section 20's checkboxes below track live status** — `[x]` = implemented in the repo; unchecked = ops/external/deploy-time work (toll-free number, Twilio Console webhooks, viamarketing.ca, DNS check, corporate documents, build+deploy, dry run).
>
> **CORRECTION (2026-07-16, from the full rejection email):** the opt-in URL actually submitted to Twilio was **`https://viamarketing.ca/`** — the "browser verification/interstitial" the reviewer hit was on the **corporate site's hosting**, not on fancyrsvp.com. The envelope-reveal analysis in §1/§11 remains a genuine secondary risk (and its `?noreveal=1` bypass is implemented), but the primary fixes are: (a) submit **`https://fancyrsvp.com/sms-opt-in`** as the opt-in URL next time, and (b) check viamarketing.ca's hosting/proxy for a bot-check interstitial before it's referenced anywhere in the submission. The reviewer also confirmed the only form found on fancyrsvp.com was the footer newsletter (email-only) — `/sms-opt-in` is now a **live** form (name + phone + consent checkbox + Submit, persisting a timestamped consent record via `POST /api/v1/public/sms-opt-in`), matching Twilio's reference web-form example. Twilio's agent (isa.bell@twilio.com) offered to pre-review the updated URL or screenshots before resubmission — use that.

---

## 1. Executive Summary

The TFV submission was rejected for three reasons. **All three are confirmed, reproducible, and still present in the codebase today.** If the same submission were re-filed now, it would be rejected again on the same grounds.

**Rejection Reason 1 — "Opt-in URL loaded an interstitial."** The interstitial is FancyRSVP's own product feature: a full-screen, non-dismissing "wax-sealed envelope" reveal animation (`frontend/src/app/components/guest/InvitationReveal.js`) that covers the entire viewport (`position:fixed; inset:0; z-index:1000`) on **every fresh browser load** of both the event page (`/{slug}`) and the RSVP page (`/{slug}/rsvp`). A Twilio reviewer with a clean browser sees: a blank spinner → a skeleton loader ("Preparing your invitation…") → a sealed envelope demanding a tap. They never see a consent form. From a reviewer's chair, this is indistinguishable from a bot-check interstitial. (`RsvpExperience.js:228-233,271-280,292,312`; `EventPageClient.js:516,539,896,955`.)

**Rejection Reason 2 — "No visible SMS consent form."** Correct. There is **no standalone public opt-in page** anywhere in the app (no `/sms-opt-in`, `/opt-in`, `/compliance`, or similar route exists). The only consent UI lives on step 2 of a multi-step wizard inside a live event's RSVP form — behind the envelope animation, behind an attendance choice, and event-scoped behind a slug URL. Worse, there are **two divergent consent implementations**: the wizard path has strong compliant language with Privacy/Terms links (`StepPartyDetails.js:191-194`), while the full-page template path omits the business name, the policy links, and the frequency disclosure (`heritageArch/sections/RsvpSection.js:827-829`).

**Rejection Reason 3 — "Business could not be verified."** Correct, and worse than the reviewer knew. The strings `16941460` and `CANADA CORP` appear **nowhere in the repository**. The public site presents **three mutually contradictory identities**: footer copyright "Via Marketing Group" (`FooterSection.js:349`), Terms legal entity "Fancy RSVP Inc." under **New York** law (`terms/page.js:19,129-133`), and a mailing address in **"California, USA"** (`terms/page.js:143`, `privacy/page.js:145`, `contact/page.js:38-39`). None of them is the Canadian corporation on the TFV submission. Additionally, the public `/press` page ships **fabricated content** — a fake $12M TechCrunch funding round, a fake Forbes "$50M business" profile, a fictitious co-founder "Sarah Laurent," and fake awards (`press/page.js:17-57`) — which the codebase itself admits is invented (`PressBar.js:5-14`). A reviewer performing a 30-second Google check on any of these claims will conclude the business is misrepresenting itself.

**Beyond the rejection email**, this audit found post-approval liabilities that would get the toll-free number suspended even if verification passed: the stored `sms_consent` flag is **never checked before sending** (`smsDispatch.js:63-83`); CSV-imported guests who never consented are immediately SMS-targetable, and the import modal actively encourages texting them (`ImportGuestsModal.js:246`); outbound message bodies carry **no STOP / HELP / rates language** (`smsDispatch.js:14,115`); there is **no inbound STOP webhook and no suppression list**; and the Twilio number currently configured is a **US local (815) number, not a toll-free number** (`backend/.env:21`).

The legal pages are the bright spot: both the Privacy Policy (Section 3) and Terms (Section 5) contain genuinely strong, TFV-grade SMS disclosures including the mobile-data no-sharing clause Twilio requires. The remediation work is concentrated in (a) business identity, (b) a public opt-in surface, (c) the interstitial, and (d) real opt-in/opt-out enforcement.

---

## 2. Current Compliance Score

Weighted against the requirements in the rejection email plus standard Twilio TFV / CTIA criteria.

| # | Category | Weight | Score | Weighted | Verdict |
|---|----------|-------:|------:|---------:|---------|
| 1 | Opt-in URL directly reachable (no login / no interstitial / no challenge) | 15% | 10/100 | 1.5 | **FAIL** — envelope overlay blocks every fresh load |
| 2 | Visible consent form (phone field + checkbox + agreement + brand + purpose) | 15% | 40/100 | 6.0 | **FAIL** — exists but buried, event-scoped, inconsistent |
| 3 | Business identity verifiable & consistent with submission | 15% | 5/100 | 0.75 | **FAIL** — 0 mentions of the legal entity; 3 conflicting identities; fabricated press |
| 4 | Privacy Policy SMS disclosures | 10% | 85/100 | 8.5 | **PASS with defects** — strong §3; contradicted by §4 boilerplate |
| 5 | Terms of Service SMS terms | 10% | 80/100 | 8.0 | **PASS with defects** — strong §5; wrong entity & governing law |
| 6 | Consent capture mechanics (unchecked box, required, timestamped) | 10% | 65/100 | 6.5 | **PARTIAL** — good in wizard path; weak in template path; no text/IP snapshot |
| 7 | Consent enforcement at send time | 10% | 0/100 | 0 | **FAIL** — `sms_consent` never consulted by the dispatcher |
| 8 | Opt-out handling (STOP/HELP webhook, suppression) | 5% | 5/100 | 0.25 | **FAIL** — carrier-level only; app is blind to opt-outs |
| 9 | Message content compliance (brand + STOP + rates in body) | 5% | 25/100 | 1.25 | **FAIL** — only " - Fancy RSVP" appended; free-text bodies |
| 10 | Infrastructure (HTTPS, TLS, public legal pages, no auth walls) | 5% | 90/100 | 4.5 | **PASS** |

### **Overall Compliance Score: 37 / 100**

---

## 3. Current Risk Assessment

| Risk | Severity | Likelihood | Detail |
|------|----------|-----------|--------|
| Re-rejection on Reason 1 (interstitial) | Critical | **Certain** | The envelope reveal fires on every fresh session (`RsvpExperience.js:228-229` comment: "plays every time this page loads"). A reviewer's clean browser always hits it. |
| Re-rejection on Reason 3 (identity) | Critical | **Certain** | Zero on-site linkage to 16941460 CANADA CORP.; California/New York identities directly contradict a Canadian submission. |
| Re-rejection on Reason 2 (no visible consent) | Critical | **Near-certain** | No standalone opt-in URL to submit; the wizard consent is 3+ interactions deep inside a per-event URL that may expire, be password-protected, or be deleted. |
| Rejection for fabricated business claims | Critical | High | `/press` fake funding/awards and `/about` "200,000 events annually across 40 countries" are trivially falsifiable; Twilio reviewers do search the brand. |
| **TCPA statutory liability** | Critical | High | Sending to CSV-imported, never-consented US numbers is exposed at $500–$1,500 per message. The product currently permits and encourages this (`ImportGuestsModal.js:246`; no consent filter in `smsDispatch.js:63-83`). |
| Post-approval suspension (carrier complaints) | High | High | No STOP language in messages, no in-app suppression, free-text bodies → elevated complaint rates → Twilio AUP action against the number/account. |
| Turnstile accidentally enabled | High | Medium | A literal "verify you are human" CAPTCHA is one env var away on the exact consent form (`TurnstileWidget.js:5,16,83`; `backend/middleware/captcha.js`; enforced at `publicRoutes.js:186`). |
| Number-type mismatch | High | Medium | Configured sender is `+18154543202` (`backend/.env:21`) — a local Illinois number. TFV applies to toll-free numbers only. Submitting TFV for a number the account doesn't send from (or sending from an unverified local number) creates a second compliance track (10DLC) that is currently unaddressed. |
| Legal-page contradictions discovered in review | Medium | Medium | Privacy §4 names SendGrid/AWS/Mixpanel — none used (actual: Brevo/Hostinger VPS/Supabase). Policy promises consent-language retention the schema cannot deliver. |
| Demo-event fragility | Medium | Medium | Any opt-in URL pointing at a real event can turn password-protected, private, under-review, or unpaid (`eventController.js:527-551`; `EventPageClient.js:526-539`), hard-blocking the reviewer mid-review. |

**Overall risk level: CRITICAL — do not resubmit in the current state.**

---

## 4. Estimated Approval Readiness

| Milestone | Readiness |
|-----------|-----------|
| **Today** | **~5%.** All three original rejection reasons still reproduce. Resubmission now burns another review cycle and accumulates rejection history on the account. |
| After Critical roadmap items (§19) | ~75%. Rejection reasons 1–3 remediated; residual risk from reviewer discretion on business documents and viamarketing.ca cross-verification. |
| After Critical + High items | ~90%. Adds real opt-out plumbing, send-time consent gating, and message-content compliance — covers the follow-up checks reviewers increasingly perform and protects the number post-approval. |
| Blocking dependencies outside this repo | viamarketing.ca must visibly own FancyRSVP; corporate registration documents (Corporations Canada) must match "16941460 CANADA CORP."; the actual toll-free number must exist on the Twilio account and be the configured sender. |

---

## 5. Twilio Requirements — Requirement-by-Requirement Matrix

Every requirement sentence from the rejection email, plus the standing TFV requirements they imply.

### R1 — Opt-in URL must show the actual consent page

| Aspect | Finding |
|---|---|
| **Requirement** | Public URL · No Login · No Browser Verification · Direct access to consent page. |
| **Current Status** | ❌ **FAIL** |
| **Evidence Found** | Guest routes are genuinely public — `frontend/src/middleware.ts:37` guards only `/dashboard`, `/admin`, `/checkin`. But `/{slug}/rsvp/page.js:1,37-44` is `'use client'` (spinner until JS resolves), then `RsvpExperience.js:271-280,292,312` mounts the full-screen `InvitationReveal` overlay (`InvitationReveal.js:554-559`: `position:fixed; inset:0; zIndex:1000`) which waits indefinitely for a tap on the wax seal (`openSeal`, lines 190-200). Bypass only via `sessionStorage` key `fancy_envelope_seen_<slug>` (lines 147-160) — never set in a fresh browser — or `prefers-reduced-motion`, which still requires a "View invitation" click (lines 213-259). |
| **Missing Items** | A URL that renders the consent form on first paint with zero interactions. An interstitial-free path for direct/reviewer loads. Assurance that Cloudflare Turnstile stays off guest routes (`RsvpWizard.js:475-506`, `RsvpSection.js:244`) and that DNS is not proxied through a challenge layer (nginx terminates TLS directly via Certbot — `deployment/nginx.conf:38-46` — so any additional interstitial would come from out-of-repo DNS/proxy config; verify). |
| **Risk Level** | **Critical** |

### R2 — Visible SMS consent form

| Aspect | Finding |
|---|---|
| **Requirement** | Public page showing: Phone Number field · SMS Consent checkbox · Explicit User Agreement · Business Name · Messaging Purpose. |
| **Current Status** | ❌ **FAIL** (components exist, but no public page presents them) |
| **Evidence Found** | Wizard path: phone field `StepPartyDetails.js:150-153` (required when attending, `RsvpWizard.js:391-392`); unchecked-by-default checkbox (`RsvpWizard.js:53`), required whenever a phone is present (`RsvpWizard.js:397-401`); label names "Fancy RSVP" and links `/privacy` + `/terms` (`StepPartyDetails.js:191-194`). Server mirrors the requirement (`backend/controllers/rsvpController.js:71-76`). |
| **Missing Items** | (a) A standalone, always-available public opt-in page — none exists (no `/sms-opt-in`, `/opt-in`, `/compliance` route in `frontend/src/app`). (b) Consent language enumerating the four message types (current: "text messages about this event" — does not name Event Invitations / RSVP / Reminders / Event Updates). (c) Parity in the template path — `RsvpSection.js:827-829` says only "I agree to receive SMS updates about this event. Message & data rates may apply. Reply STOP to opt out." with **no business name and no Privacy/Terms links**. |
| **Risk Level** | **Critical** |

### R3 — Business must be verifiable

| Aspect | Finding |
|---|---|
| **Requirement** | Official registration · Business documents · Website matching submitted information · Business identity clearly visible. |
| **Current Status** | ❌ **FAIL** |
| **Evidence Found** | Repo-wide search: **zero** occurrences of "16941460" or "CANADA CORP"; no Canadian address anywhere. What the site does show: "© Via Marketing Group" (`FooterSection.js:349`); "Fancy RSVP Inc." + New York governing law/arbitration/venue (`terms/page.js:19,129-133`); "Via Marketing Group, Attn: Legal/Privacy, California, USA" (`terms/page.js:143`, `privacy/page.js:145`); contact page "Visit Us → California / USA" (`contact/page.js:38-39`). Social links do point at Via Marketing accounts (`FooterSection.js:355,362`; JSON-LD `page.js:48-50`) — the only real linkage, and it contradicts the "Group"/California framing. |
| **Missing Items** | On-site statement that FancyRSVP is operated by 16941460 CANADA CORP. o/a Via Marketing; a Canadian address consistent with corporate registration; removal of the "Fancy RSVP Inc." / New York / California identities (or a counsel-approved restructure); a FancyRSVP mention on viamarketing.ca (out of repo — external task). |
| **Risk Level** | **Critical** |

### R4 — Consent language must match the declared message types (rejection email "Helpful Notes")

| Aspect | Finding |
|---|---|
| **Requirement** | Consent language must exactly match: Event Invitations · RSVP · Reminders · Event Updates. |
| **Current Status** | ❌ FAIL |
| **Evidence Found** | Neither consent label enumerates message types. Wizard: "text messages about this event" (`StepPartyDetails.js:191`). Template: "SMS updates about this event" (`RsvpSection.js:827-829`). The Privacy Policy *does* enumerate types (`privacy/page.js:45`) — but the email is explicit that policy text alone is not sufficient; the reviewer must see it in the opt-in flow. Note: the business flow described internally ("Messages are ONLY: Invitation / RSVP Update / Reminder / Event Update") is **not enforced in code** — campaign bodies are organizer free-text (`campaigns/page.js:25`, `SendInvitationModal.js:236`), which makes the declaration to Twilio unverifiable. |
| **Missing Items** | One canonical consent string, used verbatim in both RSVP paths, on the public opt-in page, and in the TFV form's "opt-in description" — naming the brand and the four message types. |
| **Risk Level** | **High** |

### R5 — Privacy Policy alone is not enough; reviewer must SEE the opt-in flow

| Aspect | Finding |
|---|---|
| **Current Status** | ❌ FAIL — this is precisely the current architecture: an excellent policy (`privacy/page.js:41-53`) with the actual flow hidden behind an animation, an attendance step, and an event slug. |
| **Missing Items** | A directly loadable consent page (see R1/R2); screenshots of the real flow for the TFV form. |
| **Risk Level** | **Critical** |

### R6 — Privacy + Terms linked directly from the consent page

| Aspect | Finding |
|---|---|
| **Current Status** | ⚠️ PARTIAL |
| **Evidence Found** | Wizard path links both, inline at the checkbox (`StepPartyDetails.js:192-194`), and both destinations are public. Template path links **neither** (`RsvpSection.js:825-834`). |
| **Missing Items** | Links in the heritageArch/template path; links on the (to-be-built) public opt-in page. |
| **Risk Level** | **High** |

### R7 — Standing CTIA/Twilio toll-free expectations (not in the email, but reviewers and carriers enforce them)

| Requirement | Status | Evidence / Missing | Risk |
|---|---|---|---|
| STOP/HELP keywords honored and visible in messages | ❌ FAIL | Outbound bodies get only `" - Fancy RSVP"` appended (`smsDispatch.js:14,115`); no STOP/HELP/rates text; no inbound webhook — the only Twilio callback is delivery status (`campaignController.js:318`; `publicRoutes.js:31`). | High |
| Consent honored at send time | ❌ FAIL | `fetchRecipients()` filters on `event_id` + `is_primary_contact` + `phone IS NOT NULL` only; `sms_consent` never referenced (`smsDispatch.js:63-83`). | Critical (legal) |
| No texting of list-uploaded numbers without consent | ❌ FAIL | Import stores guests with `sms_consent=false` default (`guestService.js:558-572`; migration `20260718000000_rsvp_sms_consent.sql:18`) yet they are immediately campaign-targetable; the import modal prompts "Send personalized SMS invitations now" (`ImportGuestsModal.js:246`) with no consent attestation. Only a buried Terms warranty covers this (`terms/page.js:67`). | Critical (legal) |
| Consent records auditable (text shown, timestamp, source) | ⚠️ PARTIAL | `sms_consent` + `sms_consent_at` persisted via `submit_rsvp_v2` (migration lines 18-19, 25, 284-362). No consent-text/version snapshot, no IP — despite the Privacy Policy claiming retention of "the consent language presented at the time" (`privacy/page.js:52`). | Medium |
| Mobile-data no-sharing clause in Privacy Policy | ✅ PASS | Explicit and strong (`privacy/page.js:47`), reinforced at `:60` and `:64`. | — |
| Toll-free number as sender | ⚠️ UNVERIFIED | Configured sender `+18154543202` is a local 815 number (`backend/.env:21`), with fallback to Twilio's magic test number (`twilioClient.js:33-36`). | High |

---

## 6. Website Audit

**Public reachability (good):** `middleware.ts:37` matcher is `['/dashboard/:path*', '/admin/:path*', '/checkin/:path*']` — everything else, including `/privacy`, `/terms`, `/contact`, `/{slug}`, `/{slug}/rsvp`, `/rsvp?token=…`, `/ticket/[token]`, is public with no login and no cookie wall. Legal-page text is present in initial HTML.

**Findings:**

1. **No `robots.txt` and no sitemap** anywhere (`src/app` and `public/` checked). Nothing blocks the reviewer, but nothing helps automated verification either, and it is a professionalism signal.
2. **Client-only rendering of guest pages.** `/{slug}/rsvp` renders a spinner until JS executes (`[slug]/rsvp/page.js:37-44`); `/{slug}` body is behind a Suspense spinner (`[slug]/page.js:104-110`). A reviewer on a slow connection, or any tooling that snapshots initial HTML, sees a spinner — corroborating the "could not verify the registration flow" complaint.
3. **Fabricated content on public marketing pages** (detailed in §7): `/press`, `/about`, `/careers`. The footer links to Press, so it is one click from the homepage.
4. **Landing metadata** advertises "SMS campaigns" (`page.js:19`) — fine, but it raises the bar: the reviewer is told SMS is core, then cannot find the opt-in.
5. **Internal stat contradictions:** About claims "200K+ Events Hosted / 40+ Countries / 98% Satisfaction" (`about/page.js:275-277`) while the landing social-proof fallback claims "10,000+ / 50,000+ / 99.9%" (`utils/useLandingStats.js:9-13`).
6. **Per-event gates can kill a review mid-flight:** password (`x-event-password`, `eventController.js:527-551`), private, under-review, and not-live states (`EventPageClient.js:526-539`). Any opt-in URL tied to a real customer event is fragile.

---

## 7. Business Identity Audit

**The single most damaging category.** Submitted identity: *16941460 CANADA CORP. o/a Via Marketing, Canada.* Identities actually published:

| Identity presented | Where | Conflict |
|---|---|---|
| "Via Marketing Group" | `FooterSection.js:349` (© line), `terms/page.js:143`, `privacy/page.js:145` | "Group" is not the registered name; no corporation number; paired with a **US** address |
| "Fancy RSVP Inc." | `terms/page.js:19` ("binding agreement between you … and Fancy RSVP Inc."), `:67`, `:80`, `:107` | A different (likely nonexistent) legal entity |
| New York governing law, NYC arbitration, New York County venue | `terms/page.js:129-133` | Contradicts Canadian corp |
| "California, USA" mailing address | `terms/page.js:143`, `privacy/page.js:145`, `contact/page.js:38-39` | Contradicts Canadian corp |
| viamarketing.ca social handles | `FooterSection.js:355,362`; `page.js:48-50` (JSON-LD `sameAs`); `contact/page.js:27,29,63,73` | The only true Via Marketing linkage — but points at social accounts, not a corporate statement |
| `info@viamarketing.ca` | `backend/controllers/marketingController.js:15` (internal contact-form notify default) | Invisible to reviewers; inconsistent internally |

**Absent entirely:** "16941460 CANADA CORP." (0 occurrences), any Canadian address (0 occurrences), any "FancyRSVP is operated by / a product of Via Marketing" statement, any business-registration number, any link to viamarketing.ca as a *corporate parent* (only social links).

**Fabricated verifiability-destroyers:**
- `/press` (`press/page.js:17-57`): fake TechCrunch "$12M raise," fake Forbes "$50M business" citing "Co-founder Sarah Laurent," fake Vogue Business/The Knot/Product Hunt coverage, fake awards ("Webby Awards 2024," "Forbes Top 50 Startups 2025"). Article links go to bare domains; press-kit downloads are `mailto:`. The codebase itself flags this content as fabricated (`PressBar.js:5-14`).
- `/about` (`about/page.js:256,271,275-277`): "Founded in 2019," "over 200,000 events annually across 40 countries."
- `/careers` (`careers/page.js:490,79-115,36,57,68`): "a team of 85 people across 12 countries," stock options, retreats, five open roles including "Growth Marketing Manager — New York, NY."

A reviewer who searches "Fancy RSVP TechCrunch $12M" or "Sarah Laurent Fancy RSVP" gets zero results and now has grounds to reject for misrepresentation — a far worse outcome than "identity unclear."

---

## 8. Privacy Policy Audit

File: `frontend/src/app/privacy/page.js` — public at `/privacy`, "Last Updated: July 3, 2026" (`:278`).

**Strengths (Section 3, "SMS/Text Messaging Communications & Consent," lines 41-53) — this section is TFV-grade:**
- Scope + statutory framing: TCPA and CTIA named (`:44`).
- Message types enumerated: RSVP confirmations, date/time/venue changes, reminders/countdowns, day-of check-in, inquiry responses; explicit "we do not use phone numbers … to send marketing" (`:45`).
- Opt-in described (guest self-submission or host-warranted upload); no purchased/scraped lists (`:46`).
- **Mobile-data no-sharing clause** — "will NEVER share, sell, rent, license, trade, or otherwise disclose mobile phone numbers, SMS opt-in status, or any consent records … for their own marketing or promotional purposes" — naming Twilio as data processor (`:47`); reinforced at `:60` and in business-transfer terms (`:64`).
- Frequency ("approximately 1–5 messages per event") and "Message and data rates may apply" (`:48`).
- STOP/UNSUBSCRIBE/CANCEL/END/QUIT opt-out with final confirmation message (`:49`); HELP keyword + support email (`:50`); carrier disclaimer (`:51`); 4-year consent-record retention (`:52`).

**Defects:**
1. **Contact block contradicts the corporate identity** (`:141-147`): "Via Marketing Group, Attn: Privacy, California, USA" — no legal entity, no Canadian address, no corporation number.
2. **Section 4 boilerplate contradicts reality** (`:60`): names cloud hosting "AWS," email "SendGrid," analytics "Mixpanel." Actual stack: Hostinger VPS (`deployment/README.md`), Brevo email (`notificationService.js:10`), Supabase. A reviewer cross-checking disclosures against observable infrastructure (DNS/MX/headers) can catch this.
3. **Promises the schema can't keep** (`:52`): claims retention of "the consent language presented at the time" and opt-out status — the database stores only a boolean + timestamp (migration `20260718000000_rsvp_sms_consent.sql:18-19`); no consent-text snapshot, no version, no IP, and no opt-out store exists at all (§10).
4. Policy describes STOP confirmation-message behavior (`:49`) that the application does not implement (no inbound webhook) — true only if Twilio's carrier-level toll-free opt-out handles it; the app never learns of the opt-out.

---

## 9. Terms of Service Audit

File: `frontend/src/app/terms/page.js` — public at `/terms`, "Last Updated: July 3, 2026" (`:277`).

**Strengths (Section 5, "SMS Messaging Terms & Conditions," lines 62-73):**
- Program description limited to transactional/informational messages; "not a marketing or promotional messaging service" (`:66`).
- **Host Consent Obligations** (`:67`): uploads require prior express consent, opt-out honoring, sole TCPA/CTIA responsibility, and indemnification.
- No-sale/no-share of mobile data (`:68`); frequency + rates (`:69`); STOP/HELP keywords (`:70`); platform enforcement (`:71`); no delivery guarantee (`:72`).

**Defects:**
1. **Wrong legal entity:** "Fancy RSVP Inc." (`:19,67,80,107`) — not the operating corporation.
2. **Wrong jurisdiction for a Canadian corp:** New York law (`:129`), NYC arbitration (`:131`), New York County venue (`:133`). Requires counsel review, not just find-and-replace.
3. **Contact block** (`:141-145`): "Via Marketing Group, Attn: Legal, California, USA" + Instagram handle as an official legal-contact channel.
4. The Host Consent Obligations clause (`:67`) is legally sound but **operationally unenforced** — the product neither surfaces it at import time nor blocks non-consented sends (§10), which undercuts it as a defense.

---

## 10. SMS Consent Audit

**Capture — two divergent implementations (feature drift between render paths):**

| Property | Path A: Wizard (`StepPartyDetails.js` + `RsvpWizard.js`) | Path B: Full-page template (`heritageArch/sections/RsvpSection.js`) |
|---|---|---|
| Phone field | `:150-153`; required when attending (`RsvpWizard.js:391-392`) | `:804-811`; required when attending (`:505-506`) |
| Checkbox default | Unchecked (`RsvpWizard.js:53`); re-checked only for returning consented guest (`:149`) | Unchecked (`:234`) |
| Required when phone present | Yes (`RsvpWizard.js:397-401`) | Yes (`:516`) |
| Label text | "I agree to receive text messages about this event from Fancy RSVP. Message frequency varies. Message & data rates may apply. Reply STOP to opt out at any time. See our Privacy Policy and Terms of Service." (`:191-194`) | "I agree to receive SMS updates about this event. Message & data rates may apply. Reply STOP to opt out." (`:827-829`) |
| Brand named | ✅ "Fancy RSVP" | ❌ None |
| Privacy/Terms linked at checkbox | ✅ (`:192-194`, `target="_blank"`) | ❌ None |
| Frequency disclosure | ✅ | ❌ |
| Message types enumerated | ❌ | ❌ |
| Conditional visibility | Only when attending or phone entered (`showSmsConsent`, `:49`) | Same pattern (`:494`) |

Note: the checkbox text stated in the internal business-flow description matches **Path B** — the weaker variant. The TFV submission must quote whichever string actually ships, and both paths must ship the same string.

**Path C — one-click email RSVP (`QuickConfirm`, `rsvp/page.js` → `components/guest/rsvp/QuickConfirm.js`):** collects no phone, shows no consent — acceptable, provided no SMS is ever sent to parties created this way without later consent (currently not guaranteed, see Enforcement).

**Storage:** `supabase/migrations/20260718000000_rsvp_sms_consent.sql` — `rsvp_parties.sms_consent BOOLEAN NOT NULL DEFAULT false` (`:18`), `sms_consent_at TIMESTAMPTZ` (`:19`); `submit_rsvp_v2(p_sms_consent)` writes both on every insert/update path (`:284,319,347,362`), stamping `sms_consent_at = now()` even on decline (documented as a "declined at" record, `:10-15`). Backend gate mirrors the client: rejects phone-without-consent (`rsvpController.js:71-76`). **Not stored:** consent text/version, IP, user-agent — contradicting `privacy/page.js:52`.

**Enforcement — the critical failure:**
- **Send path ignores consent.** `smsDispatch.fetchRecipients()` (`smsDispatch.js:63-83`) selects by event + primary contact + phone-present. A party with `sms_consent = false` and a phone is fully targetable. No campaign-level consent gate exists either (`campaignRoutes.js:10` applies only `requireFeature('sms_campaigns')`).
- **Imports create non-consented targets.** `importGuests()` → `addGuest()` passes no consent (`guestService.js:558-572,134-143`); imported numbers sit at the `false` default and are exactly the "pending" audience campaigns target. The UI then prompts: "Ready to invite them? Send personalized SMS invitations now…" (`ImportGuestsModal.js:246`). No attestation checkbox exists in the import flow.
- **Opt-out is invisible to the app.** No inbound webhook, no STOP/UNSTOP/HELP processing, no suppression table, no `opt_out` column anywhere in the backend. The only webhook is delivery-status for credit refunds (`campaignController.js:318`; `publicRoutes.js:31`). Twilio's toll-free carrier-level opt-out will block re-sends at the carrier edge, but the app will keep attempting, keep burning credits, and can never honor the Privacy Policy's opt-out promises for other channels.

**Message content:** every outbound body = organizer free-text + `" - Fancy RSVP"` (`smsDispatch.js:14,115`). No STOP, no HELP, no rates language is ever appended. Default templates (`campaigns/page.js:25`; `SendInvitationModal.js:236`) contain none of it either. TFV requires sample messages; samples that include STOP language would misrepresent actual sends.

**Sender number:** `TWILIO_PHONE_NUMBER=+18154543202` (`backend/.env:21`) is a local number; code falls back to Twilio's magic test number `+15005550006` (`twilioClient.js:33-36`). SMS is also globally kill-switched behind `SMS_ENABLED` (`config/features.js:31`) with a silent mock mode (`smsDispatch.js:186`) that `docs/Stripe-Live-Migration.md:47-49` itself flags as a live-ops risk (credits charged, nothing sent).

---

## 11. Invitation Flow Audit

Reviewer-eye walkthrough of `https://fancyrsvp.com/{slug}` (the invitation URL guests receive):

1. **Initial paint:** Suspense spinner (`[slug]/page.js:104-110`). SSR provides metadata/JSON-LD only.
2. **Full-screen envelope:** `EventPageClient.js:539,896,955` mounts `InvitationReveal` in `mode="invitation"` — comment at `:516`: "plays every single time this page loads." Covers the viewport at `z-index:1000`; waits for a tap on the seal; small Skip control (`InvitationReveal.js:414-416`).
3. **Gate states** that hard-block: password-protected (`eventController.js:527-551`), private, under-review, not-live (`EventPageClient.js:526-539`).
4. Only after dismissal does event content (and any RSVP call-to-action) render.

**Link formats** (`[slug]/rsvp/page.js:17-25`): public `/{slug}/rsvp`; per-guest SMS link `/{slug}/rsvp?g=<guestId>`; token link `/{slug}/rsvp?party_id=<token>`; `?lang=ar`. Email one-click: `/rsvp?token=<signed>`. No server-side redirect chains — good; the blocking is all client-side presentation.

**Verdict:** the invitation experience is designed as theatre for invited guests, and it is precisely what a compliance reviewer cannot pass through. The reveal must be suppressed (auto-skip, param bypass, or first-frame skip affordance) on direct loads used for verification — and per user feedback, any redesign must preserve the premium reveal for real guests (do not simply delete it).

---

## 12. RSVP Flow Audit

Walkthrough of `/{slug}/rsvp` to the consent moment:

1. `'use client'` page → spinner (`[slug]/rsvp/page.js:37-44`).
2. `RsvpSkeleton` — "Preparing your invitation…" (`RsvpExperience.js:49-71`).
3. **Envelope overlay again** (`RsvpExperience.js:228-233,271-280`; "plays every time this page loads").
4. `StepAttendance` — must choose Yes / No / Maybe (`RsvpWizard.js:629-633`).
5. `StepPartyDetails` — phone + consent appear (`RsvpWizard.js:635-655`), and the consent checkbox renders **only when attending or a phone is typed** (`StepPartyDetails.js:49,160`).
6. Turnstile CAPTCHA slot sits in this same flow (`RsvpWizard.js:475-506`), currently inert (env unset) but enforced server-side when configured (`middleware/captcha.js`; `publicRoutes.js:186`).

**Distance from URL to consent: 1 animation dismissal + 1 attendance choice + conditional render.** The rejection email's "Reviewer could not verify the registration flow" is fully explained by steps 1–5.

Positive mechanics once reached: unchecked by default, required-when-phone, server-enforced (`rsvpController.js:71-76`), timestamped storage, policy links (Path A). Divergences in Path B per §10.

---

## 13. Authentication Audit

- **Guest surfaces need no auth** — correct for TFV. Sole route guard: `middleware.ts:4-37` (`fancy_session` cookie check on `/dashboard`, `/admin`, `/checkin` only).
- **Organizer signup email verification: implemented.** `POST /register` creates an unverified account + sends OTP; `POST /verify-registration` validates a 6-digit OTP and activates (`backend/routes/authRoutes.js`; migrations `20260610000000_auth_otp.sql`, `20260611300000_registration_otp.sql`). Rate-limited: signup 3/hr, login 5/min, OTP verify 20/15m, password reset 3/hr.
- Google OAuth present (`NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `frontend/.env:4`).
- No email-verification or device-check wall ever appears in front of guest RSVP or legal pages — good.
- Seating lookup uses name + last-4-of-phone (`publicRoutes.js:155-159`) — a lookup control, not a gate on opt-in.

**Verdict: PASS.** Authentication is not a rejection contributor.

---

## 14. Security Audit

**Solid (supports the "system already has HTTPS/SSL/rate limiting" claims):**
- Helmet + explicit HSTS (`backend/app.js:34-39`); CORS allowlist (`:45-58`); `trust proxy` (`:31`).
- Layered rate limits returning JSON 429s, never challenge pages: `/api` 1000/15m (`:117-125`), auth 15/15m (`:128-141`), public RSVP 30/15m (`:144-156`), marketing forms 5/hr (`publicRoutes.js:21-27`).
- nginx: TLSv1.2/1.3, HTTP→HTTPS 301, HSTS preload, `server_tokens off` (`deployment/nginx.conf:14-30,41-49,68`).
- Production error handler suppresses stack traces (`app.js:325-339`). Swagger gated behind super-admin in production (`app.js:232-270`).
- Real secrets are **not** git-tracked (verified via `git ls-files`: only `.env.example` variants tracked).

**Flags a strict audit must record:**
1. **Live credentials in plaintext working-tree `.env` files**, including `SUPABASE_SERVICE_ROLE_KEY` (RLS bypass), `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`, `STRIPE_WEBHOOK_SECRET`, `BREVO_API_KEY`, JWT secrets (`backend/.env:5-29`). Standard practice; but rotate any credential ever shared outside the machine (screenshots, support tickets, this audit's existence).
2. **`NODE_ENV=production` with a Stripe *test* key** and `PAYMENTS_STRIPE_ENABLED=true` (`backend/.env:3,13-14`) — config drift that suggests prod config isn't tightly controlled.
3. **Sender identity is a personal Gmail**: `BREVO_FROM_EMAIL=gooamr88@gmail.com` (`backend/.env:24`) vs the intended `noreply@fancyrsvp.com` (`.env.production.example:56`). Transactional mail from a personal Gmail damages business-verification credibility if a reviewer interacts with the product.
4. **Debug scratch scripts in the deployed backend root**: `scratch_debug_rbac.js`, `scratch_dump_promo_codes.js` (not HTTP-reachable, but they ship with service-role access patterns).
5. **A personal free-text note inside `frontend/.env:6-11`** (bilingual rant) — harmless functionally, embarrassing if the file ever leaks.
6. Swagger public when `NODE_ENV !== 'production'` (`app.js:232-270`) — verify the VPS truly runs production mode.
7. Cannot verify from the repo whether fancyrsvp.com DNS is Cloudflare-proxied (nginx terminates TLS directly). If the domain is orange-clouded with Bot Fight Mode / managed challenges, that alone reproduces Rejection Reason 1 — **must be verified at the DNS/proxy level before resubmission.**

---

## 15. UX Audit (compliance-relevant)

1. **The envelope reveal is the UX and the compliance problem in one object.** It plays on every fresh session for both invitation and RSVP pages, above everything, waiting for input. For guests, deliberate theatre; for reviewers, an interstitial. Bypass exists (`sessionStorage`, Skip button) but a reviewer has no reason to find it.
2. **Consent appears conditionally** (`showSmsConsent`) — a reviewer who selects "Decline" and doesn't type a phone never sees the checkbox at all.
3. **Two RSVP paths have drifted** (known pattern in this codebase): the template path lost the brand name, policy links, and frequency line. Any screenshot taken from a heritageArch event contradicts the wizard screenshots.
4. **Wizard error copy is clear** ("Please agree to receive SMS updates about this event to continue," `RsvpWizard.js:397-401`) — good affirmative-consent hygiene; nothing pre-checks the box for new guests.
5. **Default phone country flips to Egypt for RTL** (`StepPartyDetails.js:152`; `RsvpSection.js:809`: `defaultCountry={isRTL ? 'eg' : 'us'}`). Harmless product behavior, but with a declared US/Canada target market a reviewer probing the Arabic variant sees an Egypt-first phone field; no country restriction exists anywhere (`backend/utils/phone.js` accepts any E.164).
6. **JS-off/slow-network experience is a spinner** — see §6.2.
7. Loading copy ("Preparing your invitation…") reinforces the impression of an interstitial rather than a form page.

---

## 16. Branding Audit

1. **Brand-name inconsistency:** "Fancy RSVP" (metadata `layout.js:68-70`, manifest, consent label, SMS suffix `" - Fancy RSVP"`) vs "FancyRSVP" (submission/marketing usage). Pick one canonical rendering; use it in the TFV form exactly as it appears on-site.
2. **Corporate brand absent:** no "Via Marketing" or corporate lockup anywhere except the footer © line ("Via Marketing Group" — a third variant) and social handles. There is no "FancyRSVP is a Via Marketing product" statement, logo, or link to viamarketing.ca as a corporate site.
3. **SMS sender branding is weak:** brand only as a trailing suffix appended in code (`smsDispatch.js:14,115`); default templates don't identify the sender up front. CTIA best practice: brand at message start.
4. **JSON-LD Organization** (`page.js:43-51`) names "Fancy RSVP" with Via Marketing social `sameAs` — machine-readable identity mixing without a human-readable explanation anywhere on the site.
5. **Email branding split:** user-facing `info@fancyrsvp.com`, internal default `info@viamarketing.ca` (`marketingController.js:15`), actual configured sender a personal Gmail (§14.3).
6. Press/About/Careers project a fictional VC-backed 85-person company — the opposite of the real, verifiable identity (a small Canadian corporation) that Twilio needs to see.

---

## 17. Every Inconsistency Between Via Marketing and FancyRSVP

| # | Inconsistency | Evidence |
|---|---------------|----------|
| 1 | Registered name "16941460 CANADA CORP." appears nowhere on FancyRSVP | repo-wide grep: 0 hits |
| 2 | Trade name submitted is "Via Marketing"; site says "Via Marketing **Group**" | `FooterSection.js:349`; `terms/page.js:143`; `privacy/page.js:145` |
| 3 | Canadian corporation vs "California, USA" mailing address | `terms/page.js:143`; `privacy/page.js:145`; `contact/page.js:38-39` |
| 4 | Canadian corporation vs New York governing law / arbitration / venue | `terms/page.js:129-133` |
| 5 | Terms name a different entity entirely: "Fancy RSVP Inc." | `terms/page.js:19,67,80,107` |
| 6 | viamarketing.ca (per the stated known issue) does not present FancyRSVP as its product; fancyrsvp.com likewise never links viamarketing.ca as its operator (social handles only) | `FooterSection.js:355,362`; `page.js:48-50` — external site out of repo scope; must be fixed on both ends |
| 7 | Email identities split across three domains: `info@fancyrsvp.com` (public), `info@viamarketing.ca` (internal notify), `gooamr88@gmail.com` (actual sender) | `contact/page.js:15-17`; `marketingController.js:15`; `backend/.env:24` |
| 8 | Fabricated corporate history (founded 2019, $12M raise, co-founder "Sarah Laurent", 85 staff) vs a numbered Canadian company | `press/page.js:17-57`; `about/page.js:256`; `careers/page.js:490` |
| 9 | About-page scale claims contradict the landing page's own fallback stats | `about/page.js:275-277` vs `utils/useLandingStats.js:9-13` |
| 10 | Privacy Policy names vendors not in use (AWS/SendGrid/Mixpanel) while §3 correctly names Twilio | `privacy/page.js:60` |
| 11 | Brand string varies: "FancyRSVP" vs "Fancy RSVP" vs "Fancy RSVP Inc." vs "Via Marketing Group" | `layout.js:68`; `terms/page.js:19`; `FooterSection.js:349` |
| 12 | Twitter handle `twitter.com/viamarketingca` published in JSON-LD; existence/ownership unverified from repo | `page.js:48-50` |

---

## 18. Every Possible Future Rejection Reason

Ordered by likelihood of actually causing the next rejection:

1. **Envelope reveal still fires on the submitted opt-in URL** → Reason 1 verbatim, again.
2. **Opt-in URL points at a per-event page** that goes password-protected / private / under-review / unpaid / deleted before the reviewer opens it (`eventController.js:527-551`).
3. **No standalone opt-in page**; reviewer unwilling to click through a wizard → Reason 2 verbatim.
4. **Consent language on the TFV form doesn't exactly match the page** (two live variants exist; neither enumerates the four message types).
5. **Business-name mismatch**: TFV says "16941460 CANADA CORP. / Via Marketing"; site says "Via Marketing Group" / "Fancy RSVP Inc." / California / New York.
6. **viamarketing.ca fails cross-verification** — corporate site never mentions FancyRSVP.
7. **Reviewer googles the press claims** — fake funding/awards/founder → rejection for misrepresentation, possibly account-level review.
8. **Sample messages** submitted with STOP/rates language that actual sends don't contain (`smsDispatch.js` appends only the brand suffix) — caught in post-approval audits or complaint investigations.
9. **The verified number isn't the sending number** — config sends from `+18154543202` (local; falls back to a magic test number), so either the TFV covers an unused number or traffic originates from an unverified one (and a local number needs 10DLC instead).
10. **Turnstile gets enabled** (one env var: `NEXT_PUBLIC_TURNSTILE_SITEKEY` / `TURNSTILE_SECRET`) → literal "verify you are human" on the consent form → Reason 1 again.
11. **Cloudflare DNS proxy / Bot Fight Mode** (out-of-repo) serving a managed challenge to Twilio's reviewer IPs.
12. **Opt-in URL redirects or is JS-only**: automated verification tooling snapshots a spinner (`[slug]/rsvp/page.js:37-44`).
13. **Privacy Policy internal contradictions** (SendGrid/AWS/Mixpanel; consent-record claims unsupported by schema) flagged by a thorough reviewer.
14. **Post-approval carrier complaints**: imported, never-consented recipients + no in-app suppression + no STOP text in bodies → spam reports → number suspension and account flagging.
15. **STOP test by reviewer**: they text STOP and later verify behavior; app has no inbound handling — if Twilio's built-in toll-free opt-out isn't active on the number, the test fails.
16. **Unprofessional artifacts** discovered while probing (personal Gmail transactional sender; careers page inviting applications to `info@fancyrsvp.com` for fictional roles).
17. **Volume/use-case declarations inconsistent** with a platform where any user can send free-text bulk SMS (Twilio may reclassify as ISV/reseller traffic requiring per-customer disclosure).

---

## 19. Prioritized Implementation Roadmap

> No code is written here; this is the ordered work plan. "Files to Modify" lists the anchor files identified by this audit.

### CRITICAL — blocks resubmission; do all before filing TFV again

**C1. Create a standalone, public SMS opt-in page**
- **Goal:** A URL (e.g. `fancyrsvp.com/sms-opt-in`) that renders — on first paint, no login, no animation, no JS-dependency for core content — a live demonstration of the real consent form: phone field, unchecked consent checkbox, business identity ("FancyRSVP, a service of 16941460 CANADA CORP. o/a Via Marketing"), the four message types (Event Invitations, RSVP Updates, Reminders, Event Updates), frequency, rates, STOP/HELP, and direct links to `/privacy` and `/terms`.
- **Reason:** Rejection Reason 2 and the email's "Reviewer must actually SEE the Opt-in Flow." Removes all dependence on per-event URLs and their gate states. This becomes the opt-in URL submitted on the TFV form.
- **Files to Modify:** new `frontend/src/app/sms-opt-in/page.js` (server component preferred); `FooterSection.js` (link it); optionally reuse `PhoneNumberInput` and the Path A consent block.
- **Dependencies:** C3 (canonical consent text), C4 (identity block wording).
- **Acceptance Criteria:** Fresh incognito browser on a US IP loads the URL; consent form fully visible with **zero** clicks; contains business name, purpose, checkbox, phone field, policy links; reachable from the footer; no Turnstile, no reveal, no login.

**C2. Eliminate the interstitial on direct RSVP/invitation URL loads**
- **Goal:** A reviewer (or any first-time visitor) landing on `/{slug}/rsvp` reaches the form without being blocked by `InvitationReveal`; guests can keep the premium reveal experience.
- **Reason:** Rejection Reason 1's root cause. Note prior product feedback: the reveal is a valued premium feature — suppress or bypass on direct verification loads (e.g., auto-skip on `/{slug}/rsvp`, a `?noreveal=1`-style bypass, or prominent instant skip rendered in the first frame); do not degrade the guest experience.
- **Files to Modify:** `frontend/src/app/components/guest/rsvp/RsvpExperience.js`; `frontend/src/app/[slug]/EventPageClient.js`; `frontend/src/app/components/guest/InvitationReveal.js`.
- **Dependencies:** none (design decision on bypass mechanism required first).
- **Acceptance Criteria:** Fresh browser hitting the chosen opt-in/RSVP URL sees the form (or attendance step at worst) without interacting with the envelope; guest-facing invitation flow unchanged unless explicitly bypassed.

**C3. One canonical consent string, everywhere, enumerating the four message types**
- **Goal:** A single approved sentence — naming FancyRSVP/operating entity, the four message types, frequency, rates, STOP, HELP, and policy links — used identically in Path A, Path B, and the C1 page, and quoted verbatim in the TFV submission.
- **Reason:** Email "Helpful Notes": consent language must exactly match Event Invitations / RSVP / Reminders / Event Updates. Two divergent live strings guarantee a screenshot/URL mismatch.
- **Files to Modify:** `frontend/src/app/[slug]/rsvp/steps/StepPartyDetails.js:182-196`; `frontend/src/app/components/templates/heritageArch/sections/RsvpSection.js:825-834` (add brand + Privacy/Terms links + frequency); any other template render paths discovered; keep `rsvpController.js:71-76` error copy consistent; Arabic translations in both.
- **Dependencies:** C4 (entity wording).
- **Acceptance Criteria:** Grep for the consent sentence returns identical text (per language) in every render path; Path B shows brand + both policy links; TFV form text matches character-for-character.

**C4. Publish the real corporate identity site-wide and remove the false ones**
- **Goal:** Every legal/contact surface states: FancyRSVP is operated by **16941460 CANADA CORP., operating as Via Marketing**, with the registered **Canadian** address; remove "Fancy RSVP Inc.", "Via Marketing Group", and "California, USA".
- **Reason:** Rejection Reason 3. Current site actively contradicts the submission with three different identities.
- **Files to Modify:** `FooterSection.js:349` (© line), `terms/page.js:19,67,80,107,129-133,141-145`, `privacy/page.js:141-147`, `contact/page.js:27-73`, `about/page.js`, JSON-LD in `page.js:43-51`.
- **Dependencies:** Legal counsel for governing-law change (New York → Ontario/Canada or counsel's choice); confirmation of the registered-office address.
- **Acceptance Criteria:** Site-wide grep: "16941460 CANADA CORP" present on footer/terms/privacy/contact; zero remaining hits for "Fancy RSVP Inc.", "Via Marketing Group", "California, USA", "State of New York" (in the governing-law sense); identity matches Corporations Canada records exactly.

**C5. Remove or truthify all fabricated public content**
- **Goal:** No falsifiable claims anywhere public: delete/park `/press` (or replace with real items only), fix `/about` (real founding year, no invented scale stats), fix `/careers` (real openings or a simple "no open roles" page).
- **Reason:** Fake $12M raise / fake founder / fake awards are grounds for misrepresentation rejection and poison every other verification signal.
- **Files to Modify:** `press/page.js`, `about/page.js:256,271,275-277,400`, `careers/page.js:36-115,490`, footer links in `FooterSection.js`.
- **Dependencies:** none.
- **Acceptance Criteria:** Every remaining public claim is verifiable; no invented people, press, awards, funding, headcount, or usage stats; footer no longer links removed pages.

**C6. Make viamarketing.ca corroborate the submission (external)**
- **Goal:** viamarketing.ca visibly presents FancyRSVP as its product (products page/section + link to fancyrsvp.com) and shows the same legal name "16941460 CANADA CORP. o/a Via Marketing" and Canadian address; fancyrsvp.com footer links back to viamarketing.ca.
- **Reason:** Rejection Reason 3 — "Website matching submitted information." The reviewer cross-checks both domains.
- **Files to Modify:** external site (out of repo); `FooterSection.js` for the reciprocal link.
- **Dependencies:** C4 (same wording both sites).
- **Acceptance Criteria:** A stranger can travel viamarketing.ca → FancyRSVP → viamarketing.ca and see one consistent legal identity in both directions.

**C7. Resolve the sender-number question before filing**
- **Goal:** Confirm a **toll-free** number exists on the Twilio account, is the number named in the TFV, and is the configured production sender.
- **Reason:** Current config sends from `+18154543202` (local, 815) with a magic-test-number fallback (`backend/.env:21`; `twilioClient.js:33-36`). TFV for a number you don't send from is void; sending from an unverified local number triggers 10DLC blocking instead.
- **Files to Modify:** ops/env only (`TWILIO_PHONE_NUMBER` on the VPS); Twilio Console.
- **Dependencies:** Twilio number purchase/selection.
- **Acceptance Criteria:** Production `TWILIO_PHONE_NUMBER` is the toll-free number on the TFV; the 815 number's role is explicitly decided (released, or separately registered under 10DLC); `SMS_ENABLED` state confirmed for production.

### HIGH — required for a durable approval (post-approval survival)

**H1. Enforce `sms_consent` at send time**
- **Goal:** The dispatcher never targets a party without `sms_consent = true`.
- **Reason:** Consent that is collected but ignored is a TCPA liability and a Twilio AUP violation waiting for the first complaint.
- **Files to Modify:** `backend/services/smsDispatch.js:63-83` (`fetchRecipients` filter); recipient-count previews in `campaignController.js`; audience copy in `frontend/src/app/dashboard/campaigns/page.js`.
- **Dependencies:** H2 recommended alongside (organizers need a lawful path for imported guests: link-first, SMS-after-consent).
- **Acceptance Criteria:** A party with a phone and `sms_consent=false` is excluded from every campaign audience and from `SendInvitationModal` sends; campaign preview counts reflect the exclusion; documented behavior for organizers.

**H2. Inbound STOP/HELP webhook + suppression ledger**
- **Goal:** Process inbound STOP/UNSTOP/HELP (and the synonym set the Privacy Policy promises), persist opt-outs, and exclude opted-out numbers everywhere.
- **Reason:** The Privacy Policy (`privacy/page.js:49-50`) promises behavior the app cannot perform; the app currently never learns of opt-outs and keeps spending credits on carrier-blocked sends.
- **Files to Modify:** new backend route/controller (mount beside `publicRoutes.js:31`), new migration (suppression table or `rsvp_parties.sms_opt_out_at`), `smsDispatch.js` recipient filter; Twilio Console inbound webhook config.
- **Dependencies:** H1.
- **Acceptance Criteria:** Texting STOP records the opt-out and the number is excluded from all future audiences; HELP returns the support response; behavior matches the Privacy Policy's keyword list.

**H3. Compliance text in outbound message bodies**
- **Goal:** Sends include sender identification up front and STOP/rates language (at minimum on the first message to a recipient).
- **Reason:** CTIA requirement; also keeps TFV "sample messages" honest.
- **Files to Modify:** `backend/services/smsDispatch.js` (`personalize`, `BRANDING` at lines 14, 108-115); default templates `campaigns/page.js:25`, `SendInvitationModal.js:236`; segment-count UI (`computeSmsSegments` usage) so organizers see the true cost.
- **Dependencies:** none.
- **Acceptance Criteria:** First message to any recipient contains brand + "Msg&data rates may apply" + "Reply STOP to opt out, HELP for help"; TFV sample messages copied from actual dispatcher output.

**H4. Consent attestation on guest import**
- **Goal:** Organizers importing phone numbers must affirmatively attest they hold prior express consent; attestation persisted (who/when).
- **Reason:** Terms §5 (`terms/page.js:67`) already requires it contractually; the product must operationalize it to be defensible — imports are currently one click from bulk SMS to strangers (`ImportGuestsModal.js:246`).
- **Files to Modify:** `frontend/src/app/dashboard/components/ImportGuestsModal.js`; `backend/services/guestService.js:558-572`; new migration for the attestation record.
- **Dependencies:** H1 (decide whether attested-import counts as consent for sending, or link-first remains mandatory — recommend link-first).
- **Acceptance Criteria:** Import with phone numbers is impossible without the attestation; attestation (user id, timestamp, text version) queryable; post-import prompt no longer suggests SMS to non-consented guests.

**H5. Reconcile the Privacy Policy with reality**
- **Goal:** Every factual claim in the policy is true: vendor list (Brevo, Supabase, Hostinger — not SendGrid/AWS/Mixpanel), consent-record description matching the schema, opt-out behavior matching H2.
- **Reason:** A policy contradicted by observable infrastructure invites deeper scrutiny; a policy promising unkept records is a legal exposure on its own.
- **Files to Modify:** `frontend/src/app/privacy/page.js:52,60,64`; optionally a migration adding consent-text-version/IP columns + `submit_rsvp_v2` update + `rsvpController.js`/`guestService.js:67` pass-through so `:52` becomes true instead of softened.
- **Dependencies:** H2 (opt-out claims); decision on storing consent text/IP.
- **Acceptance Criteria:** Line-by-line read of §§3-4 finds no claim the system can't demonstrate; "Last Updated" bumped.

**H6. Verify the edge: no challenge layer on production (ops)**
- **Goal:** Confirm fancyrsvp.com DNS is not behind a challenge-serving proxy (Cloudflare orange-cloud/Bot Fight Mode), and Turnstile env vars remain unset on guest routes in production.
- **Reason:** Either would recreate Rejection Reason 1 regardless of code fixes; neither is visible in the repo.
- **Files to Modify:** none (DNS/host/panel checks; document the finding in `deployment/README.md` if desired).
- **Dependencies:** none.
- **Acceptance Criteria:** curl + fresh-browser tests from a US IP return the page directly (no 403/challenge HTML); documented statement of DNS/proxy configuration; Turnstile confirmed off (or explicitly scoped away from `/sms-opt-in` and RSVP consent steps).

### MEDIUM — professionalism and consistency; fix before or shortly after resubmission

**M1. Corporate sender email** — set `BREVO_FROM_EMAIL=noreply@fancyrsvp.com` in production (currently a personal Gmail, `backend/.env:24`); align internal notify default (`marketingController.js:15`) with a monitored corporate inbox. *Acceptance:* no personal addresses in any sending or contact path.

**M2. robots.txt + sitemap** — add `frontend/src/app/robots.js` and `sitemap.js` exposing `/`, `/privacy`, `/terms`, `/sms-opt-in`, `/contact`, `/about`. *Reason:* aids automated verification; standard hygiene. *Acceptance:* both resolve publicly.

**M3. Brand-string normalization** — one rendering ("FancyRSVP" or "Fancy RSVP") across `layout.js`, manifest, consent labels, SMS suffix, TFV form. *Acceptance:* grep shows a single canonical form (per language).

**M4. Terms jurisdiction rewrite with counsel** — beyond C4's entity fix: arbitration/venue/consumer-law review for a Canadian corp serving US+Canada consumers. *Files:* `terms/page.js:126-135`. *Acceptance:* counsel-approved text; entity + venue + law aligned.

**M5. Consent-record enrichment** — store consent text version, IP (respecting `IP_HASH_SALT` practices), and source path (wizard/template/opt-in page) with each consent. *Files:* new migration; `submit_rsvp_v2`; `rsvpController.js:178`; `guestService.js:67`. *Acceptance:* each consent row reconstructs what the guest saw and where.

**M6. Repo hygiene** — remove `backend/scratch_debug_rbac.js`, `backend/scratch_dump_promo_codes.js`; strip the personal note from `frontend/.env:6-11`; resolve the Stripe test-key/`NODE_ENV=production` mismatch (`backend/.env:3,13-14`). *Acceptance:* no scratch files ship; env files contain only configuration.

**M7. Decide market scope in code** — if the SMS program is US/Canada-only, restrict sendable destinations to +1 (`backend/utils/phone.js`, `smsDispatch.js:32`) and revisit the RTL default country (`StepPartyDetails.js:152`); otherwise declare international traffic accurately to Twilio. *Acceptance:* code behavior matches whatever the TFV form declares.

### LOW — polish

**L1. Add HELP to the consent label** (Path A mentions STOP only) — one sentence in `StepPartyDetails.js:191` + Arabic.
**L2. Verify social handles in JSON-LD** (`page.js:48-50`) — confirm `twitter.com/viamarketingca` exists and is owned; remove dead handles.
**L3. Brand-first SMS templates** — move the brand to the front of default templates instead of relying on the appended suffix (`campaigns/page.js:25`, `SendInvitationModal.js:236`).
**L4. Swagger exposure belt-and-braces** — require the super-admin gate irrespective of `NODE_ENV` (`app.js:232-270`).
**L5. Reviewer-proof demo event** — maintain a permanent, unlisted, never-expiring, non-password demo event as a secondary "see it in context" URL for reviewers (backup to `/sms-opt-in`).

---

## 20. FINAL MASTER CHECKLIST

Complete every box, in order, before preparing the next TFV submission.

### A. Business identity (site + external)
- [x] Footer © reads "© {year} 16941460 Canada Corp. o/a Via Marketing" + operator line with the Mississauga address (`FooterSection.js`)
- [x] "Fancy RSVP Inc." removed from Terms everywhere
- [x] "Via Marketing Group" replaced with the registered name in Terms/Privacy/footer
- [x] "California, USA" replaced with 2488 Selord Court, Mississauga, Ontario L5J 1P7, Canada in Terms, Privacy, Contact
- [x] Governing law/arbitration/venue updated from New York to Ontario/Canada (ADR Institute of Canada, Toronto) — **counsel review still advised before deploy**
- [x] About page: fabricated founding year and 200K/40-country/98% stats removed; real operator identity block added
- [x] Press page removed entirely (route deleted; footer link removed)
- [x] Careers page truthful (fictional 85-person team, stock options, and all five fake roles removed; honest "no open roles" state)
- [x] JSON-LD Organization updated: legalName "16941460 Canada Corp.", alternateName "Via Marketing", Mississauga PostalAddress, viamarketing.ca in sameAs, unverified Twitter handle dropped
- [x] fancyrsvp.com footer links to viamarketing.ca
- [ ] viamarketing.ca shows FancyRSVP as its product, with the same legal name + Canadian address, linking to fancyrsvp.com *(external site)*
- [ ] Corporate registration documents (Corporations Canada) in hand, matching the exact name/address shown on both sites

### B. Public opt-in surface (the URL you will submit)
- [x] `/sms-opt-in` page built: **live, working form** (name + phone + unchecked consent checkbox + Submit persisting a timestamped consent record) + business name + four message types + frequency + rates + STOP/HELP + direct `/privacy` and `/terms` links — matches Twilio's reference web-form example
- [x] Page renders the consent content on first paint — no login, no reveal animation, no CAPTCHA (server component, content in initial HTML)
- [x] Page linked from the site footer ("SMS Opt-In & Consent")
- [x] Canonical consent string finalized in `SmsConsentText.js` (EN + AR) and rendered identically by the opt-in page, wizard, and template path — **quote this exact string on the TFV form**
- [x] Consent string explicitly names: event invitations, RSVP updates, reminders, and event updates

### C. Guest RSVP flow
- [x] InvitationReveal bypass implemented: `?noreveal=1` skips the envelope on `/{slug}` and `/{slug}/rsvp`; normal guest links unchanged (premium reveal preserved)
- [x] heritageArch consent block upgraded via shared `SmsConsentText.js`: brand name + Privacy/Terms links + frequency + HELP
- [x] Checkbox unchecked by default in every path
- [x] Server-side consent requirement intact (`rsvpController.js`)
- [ ] Turnstile confirmed disabled on consent-bearing routes in **production env** *(ops check on the VPS)*

### D. Messaging behavior (post-approval survival)
- [x] Opt-outs enforced in every send path: opted-out numbers filtered from campaign audiences up front AND re-checked pre-billing in `sendRecipient` (`smsDispatch.js`). *Design note: instead of hard-filtering `sms_consent = true` (which would break the core import→SMS-invitation flow), sends to host-supplied numbers are permitted only under a recorded per-launch organizer attestation — the CTIA host-consent model, matching Terms §5.*
- [x] Import flow requires consent attestation for phone-bearing files (checkbox in `ImportGuestsModal.js`, enforced server-side in `rsvpController.importGuestsCSV`); post-import copy no longer urges texting non-consented guests
- [x] Every SMS launch (campaign composer + SendInvitationModal) requires the attestation checkbox; enforced server-side (`CONSENT_ATTESTATION_REQUIRED`) and persisted (`sms_campaigns.consent_attested_at/by`, or activity_logs for inline sends)
- [x] Inbound webhook (`POST /api/v1/public/sms/inbound`) handles STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT + START/UNSTOP/YES + HELP; opt-outs persisted in `sms_opt_outs` and enforced
- [x] EVERY message body now carries brand + rates + STOP/HELP (`COMPLIANCE_FOOTER` in `smsDispatch.js`; frontend segment estimator mirrors it)
- [ ] Production sender is the toll-free number on the TFV; `TWILIO_PHONE_NUMBER` set accordingly; 815 number disposition decided *(ops)*
- [ ] `SMS_ENABLED` verified for production; mock-mode risk (`docs/Stripe-Live-Migration.md:47-49`) closed out *(ops)*
- [ ] Migration `20260809000000_sms_compliance.sql` applied in production Supabase *(deploy step — code has logged fallbacks until then, but opt-outs are NOT enforced without the table)*
- [ ] Twilio Console: "A message comes in" → `/api/v1/public/sms/inbound`; status callback → `/api/v1/public/sms/status`; default toll-free opt-out handling ON; HELP text names Fancy RSVP + info@fancyrsvp.com (deployment/README.md Step 8) *(ops)*

### E. Legal pages
- [x] Privacy §4 vendor list corrected (Supabase/server hosting, Brevo, Twilio, Stripe; SendGrid/AWS/Mixpanel removed); §5 security claims made truthful; §6 cookies rewritten (first-party only, no GA/Mixpanel/DNT claims)
- [x] Privacy consent-record claims now match the schema (consent text version + source + timestamp + opt-out status persisted)
- [x] Privacy opt-out description matches the implemented STOP handling (suppression list, carrier-mandated confirmation, START re-subscribe)
- [x] Both pages show the correct legal entity + Canadian address; "Last Updated" bumped to July 16, 2026
- [x] Privacy and Terms remain publicly reachable with content in initial HTML (no gating added)

### F. Infrastructure & hygiene
- [ ] DNS/proxy verified: no Cloudflare challenge layer in front of fancyrsvp.com; documented *(ops)*
- [ ] `BREVO_FROM_EMAIL` = corporate address, not personal Gmail *(ops env)*
- [x] robots.js + sitemap.js added (sitemap features `/sms-opt-in`, `/privacy`, `/terms`; dashboard/admin/checkin/api disallowed)
- [x] Scratch debug files removed; `frontend/.env` personal note removed; Swagger docs auth-gated regardless of NODE_ENV
- [ ] Stripe key/env mismatch resolved (test key with NODE_ENV=production) *(ops env)*
- [ ] Frontend rebuilt and PM2 restarted after all frontend changes (deploy requires a build — `git pull` + restart alone does not update the frontend) *(deploy step)*

### G. Pre-submission dry run (the reviewer simulation)
- [ ] Opt-in URL on the TFV form = **`https://fancyrsvp.com/sms-opt-in`** (NOT viamarketing.ca — that URL's interstitial caused Rejection Reason 1)
- [ ] viamarketing.ca hosting checked for bot-check/interstitial (it will still be cross-referenced for business verification)
- [ ] Migration `20260810000000_sms_optin_submissions.sql` applied (the live opt-in form's storage)
- [ ] Send the deployed opt-in URL + screenshots to isa.bell@twilio.com for pre-review before resubmitting (offered in the rejection email)
- [ ] Business registration documents (Corporations Canada) attached in the **Additional Information** field of the TFV form, one link per line
- [ ] From a fresh incognito browser on a **US IP/VPN**: load the opt-in URL → consent form fully visible with zero clicks, zero challenges
- [ ] Repeat with JavaScript disabled → page still communicates the opt-in (or at minimum no challenge/spinner dead-end on the submitted URL)
- [ ] Load `/privacy` and `/terms` the same way → correct entity, SMS sections present
- [ ] Google "FancyRSVP" + press-claim spot checks → nothing falsifiable remains
- [ ] Text STOP to the toll-free number → opt-out confirmed end-to-end; text HELP → support response received
- [ ] Screenshot set captured for the TFV form: opt-in page, consent checkbox close-up (showing exact language), privacy §3, terms §5, footer identity block
- [ ] TFV form fields drafted and cross-checked: legal name **16941460 CANADA CORP.**, DBA **Via Marketing**, website **https://fancyrsvp.com**, opt-in type Web Form, opt-in URL = the standalone page, sample messages copied from actual dispatcher output (with brand + STOP text), realistic monthly volume, use case = transactional event notifications (Event Invitations, RSVP Updates, Reminders, Event Updates)
- [ ] Business documents attached match every string above exactly

**When every box is checked, the three original rejection reasons are remediated, the reviewer simulation passes, and the submission's claims are all independently verifiable — the state in which a TFV resubmission carries substantially lower compliance risk.**

---

*End of audit. Generated by static analysis of the repository on 2026-07-16. No project files were modified; this report is the only artifact created.*
