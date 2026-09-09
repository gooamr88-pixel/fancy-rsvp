import { Suspense } from "react";
import Navbar from "./components/landing/Navbar";
import HeroSection from "./components/landing/HeroSection";
import TemplatesShowcaseSection from "./components/landing/TemplatesShowcaseSection";
import GuestExperienceSection from "./components/landing/GuestExperienceSection";
import DashboardShowcaseSection from "./components/landing/DashboardShowcaseSection";
import SeatingSection from "./components/landing/SeatingSection";
import RemindersSection from "./components/landing/RemindersSection";
import CheckinSection from "./components/landing/CheckinSection";
import CapabilitiesSection from "./components/landing/CapabilitiesSection";
import PrintedInvitationsSection from "./components/landing/PrintedInvitationsSection";
import ProofSection from "./components/landing/ProofSection";
import FaqCtaSection from "./components/landing/FaqCtaSection";
/* FAQS comes from faqContent.js, NOT from the section component. This file is
   a Server Component; importing a value from a 'use client' module gives you a
   client reference rather than the array, and the production build dies with
   "FAQS.map is not a function" at page-data collection. See faqContent.js. */
import { FAQS } from "./components/landing/faqContent";
import FooterSection from "./components/landing/FooterSection";
import LinkNoticeBanner from "./components/landing/LinkNoticeBanner";
import { safeJsonLdHtml } from "./utils/jsonLdSafe.mjs";
import {
  COMPANY_NAME, COMPANY_SITE, COMPANY_EMAIL, SOCIAL_PROFILES, postalAddressLd,
} from "./utils/company";

/* ═══════════════════════════════════════════════════════════════════════════
   THE HOMEPAGE.

   ── What this page used to be ────────────────────────────────────────────
   Thirteen bands, roughly 9,400px of desktop scroll and ~14,000px on a phone,
   of which about 1,900 lines were hand-drawn imitations of our own product:
   `DashboardPreviewSection` (1,029 lines, a fake dashboard) and
   `RSVPFlowSection` (889 lines, four fake phone screens). Both imitated
   components that actually ship and work.

   Worse than the length: the page never said what the product DOES. Thirteen
   real capabilities exist and it named none of them.

   ── What it is now ───────────────────────────────────────────────────────
   Twelve bands, in a declared rhythm (see BAND_ORDER in landingTokens.js),
   each answering one question in the order a stranger asks them:

     1  hero          what is this, and what does it look like
     2  invitations   what does my guest get
     3  experience    what is it like to receive one
     4  dashboard     what do I see
     5  seating       how do I seat them
     6  reminders     who tells them, and when
     7  checkin       what happens at the door
     8  capabilities  how does it all fit together
     9  printed       what else do you make
    10  proof         has anyone else done this
    11  faq + cta     my remaining objection, then the button
    12  footer        everything else

   Every screenshot is a photograph of the real component, produced by
   test/shots. Bands 9 and 10 render NOTHING until there is real data behind
   them, which is why the sequence has to read correctly with them absent —
   it does: 8 (warm) → 11 (light) → footer (deep) still alternates.

   ── The 2026-09-09 pass: one screen per thing this product does ───────────
   Bands 3, 5, 6 and 7 are new, and they are the whole point of that pass. The
   invitation reveal, the seating chart, the messages that send themselves and
   the door were FOUR ROWS OF A LIST inside the capabilities band — one line of
   prose each, no picture — and they are the four reasons anyone chooses this
   over a form. A visitor could read the entire page and never see a seating
   plan.

   Two bands went to pay for them, and neither was cut for length:
   • `HowItWorksSection` described in three sentences what bands 5 to 7 now
     show. A list of steps above the screens of those steps is the same page
     twice.
   • `StatementSection` was one line alone. Its job — a place to stop between
     the guest's half of the page and the organizer's — is now done by the pull
     quote at the foot of the invitations band, which is a real published
     review rather than our own voice saying something unfalsifiable.

   The hero is also a PHOTOGRAPH now rather than paper, which is the one place
   this page breaks its own light/warm/deep scale on purpose. See HeroSection.

   ── The 2026-08-20 pass ──────────────────────────────────────────────────
   The page was correct and read as a template. Three things were behind that,
   and all three were structural rather than a matter of taste:

   • EVERY HEADING WAS SET IN A CAPITALS-ONLY FACE. `--font-serif` is Aboreto,
     which ships one weight and has no lowercase, so each headline was a whole
     sentence SHOUTED at a weight the browser had to fake. The display face is
     now Cormorant Garamond — already in the bundle, previously unused here.
   • TWO FULL DARK BANDS fought the invitation photography for attention. The
     page is now a warm paper scale with ONE ink block, the closing call to
     action, so the pictures carry all the colour.
   • THE SCREENSHOTS WERE PLACED, NOT PRESENTED — raw crops with a 1px border.
     They now sit in a browser window, a plate and a tablet body respectively.

   The invitations band also moved from third to second: the hero has just
   shown one invitation, so "what else is there" is the question actually
   being asked at that point in the scroll.

   ── Three things removed on purpose ──────────────────────────────────────
   • The "Perfect for Any Occasion" cards, which restated the occasion badges
     the invitations band already reads from `occasionPolicyFor`.
   • `SocialProofBar`, a whole 310px band for three numbers. The same three,
     from the same hook, are one line in the hero.
   • `ScrollReveal`. It server-rendered every section below the fold at
     `opacity: 0` and depended on an IntersectionObserver to bring them back,
     so a slow or failed hydration left the page blank below the hero — and it
     had no `prefers-reduced-motion` branch, so it animated regardless. Six
     observers for decoration was not a trade worth making.

   ── Code splitting was also removed, and that is not an oversight ────────
   The two dynamic() imports here existed because the sections they loaded
   were 39KB and 24KB of JavaScript that drew pictures. Their replacements are
   static markup around three <img> tags. Splitting them now would add a
   request and a loading placeholder to save nothing.
   ═══════════════════════════════════════════════════════════════════════════ */

export const metadata = {
  title: 'Fancy RSVP — Invitations, RSVPs, seating and door check-in',
  description:
    'Send an invitation your guests actually open, collect their replies, seat them, and scan them in at the door — all from one place. Weddings, engagements and events.',
  openGraph: {
    title: 'Fancy RSVP — Invitations, RSVPs, seating and door check-in',
    description:
      'Digital invitations that open on film, live RSVP tracking, drag-and-drop seating, SMS, and a door scanner that works offline.',
    url: 'https://fancyrsvp.com',
    siteName: 'Fancy RSVP',
    type: 'website',
    images: [{ url: 'https://fancyrsvp.com/og-image.png', width: 1200, height: 630, alt: 'Fancy RSVP Platform' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Fancy RSVP — Invitations, RSVPs, seating and door check-in',
    description: 'Digital invitations, live RSVP tracking, seating and offline door check-in.',
    images: ['https://fancyrsvp.com/og-image.png'],
  },
  alternates: { canonical: 'https://fancyrsvp.com' },
};

const organizationLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: COMPANY_NAME,
  url: COMPANY_SITE,
  logo: `${COMPANY_SITE}/logo.png`,
  email: COMPANY_EMAIL,
  description:
    'The all-in-one RSVP and guest management platform for weddings and special events.',
  /* Built by postalAddressLd(), which omits streetAddress and postalCode
     entirely until they are filled in rather than emitting them empty — an
     empty string in structured data is a published claim that the value IS
     empty, not that it is unknown. Fill the two fields in utils/company.js and
     this upgrades on its own. */
  address: postalAddressLd(),
  sameAs: SOCIAL_PROFILES,
};

/* Built from the SAME array the accordion renders, not typed out again. A
   hand-written copy of six answers beside a hand-written accordion is two
   sources of truth for the same sentences, and structured data that disagrees
   with the visible page is the kind Google penalises rather than ignores. */
const faqLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map(({ q, a }) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: a },
  })),
};

export default function Home() {
  return (
    <div style={{ minHeight: "100dvh", background: "#FCFBF8" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdHtml(organizationLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdHtml(faqLd) }}
      />

      {/* Above the navbar, because a guest who arrived here from a dead
          invitation link is not browsing — they are looking for an answer, and
          it has to be the first thing on the page. Suspense keeps the rest of
          this page statically generated despite the client-side query read. */}
      <Suspense fallback={null}>
        <LinkNoticeBanner />
      </Suspense>

      <Navbar />

      <main>
        {/* 1 · light — what is this. A photograph, and the only band on the
            page that is one. */}
        <HeroSection />

        {/* 2 · warm — what my guest gets. Placed second rather than later
            because it is the most differentiated thing here, and because the
            hero has just shown one invitation: the question a reader has at
            that exact moment is "what else is there". */}
        <TemplatesShowcaseSection />

        {/* 3 · light — and what is it like to receive one. The hero and the
            band above both show invitations as OBJECTS; this is the only band
            about the thirty seconds a guest spends inside one, and its whole
            job is to get them into the live demo. */}
        <GuestExperienceSection />

        {/* ── 4 to 7: one screen each for the four things that sell this ──
            They were four rows of a list until 2026-09-09. Ordered the way the
            work happens rather than by importance, so the four bands read as
            one evening rather than as a feature tour. */}

        {/* 4 · warm — what I see */}
        <DashboardShowcaseSection />

        {/* 5 · light — how I seat them */}
        <SeatingSection />

        {/* 6 · warm — who tells them, and when */}
        <RemindersSection />

        {/* 7 · light — what happens at the door */}
        <CheckinSection />

        {/* 8 · warm — how it fits together, as a sequence rather than a list */}
        <CapabilitiesSection />

        {/* 9 · light — the printed pieces the same studio makes by hand, sold
            over WhatsApp rather than checkout. Renders nothing until an admin
            publishes a piece and leaves the homepage placement switched on.

            It sat third between 2026-08-21 and 2026-09-09, which was right
            when the four bands above it did not exist. It is not any more:
            bands 4 to 7 are one argument told in order, and a catalogue of
            paper cards halfway through it broke the sentence. Same light tone,
            so the alternation is unchanged either way. */}
        <PrintedInvitationsSection />

        {/* 10 · deep — press mentions and real reviews, both admin-managed.
            Renders nothing while both are empty, which is the state of a
            fresh install — so the sequence has to read correctly with it
            absent, and it does: 8 (warm) → 11 (light) → footer (deep). */}
        <ProofSection />

        {/* 11 · light band holding the one ink block on the page */}
        <FaqCtaSection />
      </main>

      {/* 12 · deep */}
      <FooterSection />
    </div>
  );
}
