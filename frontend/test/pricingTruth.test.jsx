import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildLadder,
  buildFaqs,
  capacityOf,
  eventsOf,
  priceOf,
  formatCount,
} from '../src/app/pricing/pricingData';
import { REFUND_SUMMARY, REFUND_HOW } from '../src/app/utils/refundPolicy';

/* ═══════════════════════════════════════════════════════════════════════════
   WHAT THE PRICING PAGE CLAIMS.

   Every case here corresponds to something the page stated that was not true,
   or to a limit it enforced and did not mention. None of them is a style
   preference. A pricing page is the one surface where a wrong sentence is a
   commercial problem rather than a cosmetic one, so these are pinned
   separately from the layout cases in pricingResponsive.test.jsx.
   ═══════════════════════════════════════════════════════════════════════════ */

const ROOT = process.cwd();
const readRepo = (rel) => fs.readFileSync(path.join(ROOT, '..', rel), 'utf8');

/**
 * The source of one top-level `const <name> = ` declaration, bounded by the NEXT
 * top-level declaration.
 *
 * The two assertions below used to slice a flat 4000/5000 characters after the
 * function's opening line, which made them assertions about how much prose sits
 * above the line being checked. Adding a comment inside `getPublicPricing` — not
 * touching a single behaviour — pushed `note: FEATURE_NOTES[f.key]` past the
 * window and failed a test whose subject was still true. A test that a comment
 * can break teaches people to stop reading its failures.
 */
const topLevelBlock = (src, declaration) => {
  const start = src.indexOf(declaration);
  if (start === -1) return '';
  const next = src.indexOf('\nconst ', start + declaration.length);
  return src.slice(start, next === -1 ? undefined : next);
};

/* COMMENTS ARE NOT CODE, AND HERE THAT IS LOAD-BEARING.

   Several of these cases assert that a claim does NOT appear in a file — and
   the files explain, in their own comments, exactly which claim was removed
   and why. Reading the comments as code makes the documentation of a fix look
   like the bug: "the old line here was Try Fancy RSVP free for 14 days" would
   fail the very test that keeps the line gone. scripts/deadLandingCode.js
   strips comments for the mirror-image reason. */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ 	]*\/\/.*$/gm, ' ');

const read = (rel) => stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

const CLIENT = read('src/app/pricing/PricingClient.js');
const PAGE = read('src/app/pricing/page.js');
const DATA = read('src/app/pricing/pricingData.js');
const RECOMMENDER = read('src/app/pricing/PlanRecommender.js');
const FETCH = read('src/app/pricing/pricingFetch.js');

const F_FREE = ['Basic RSVP forms', 'Email notifications'];
const F_MID = [...F_FREE, 'Seating chart designer', 'Text messaging'];
const F_TOP = [...F_MID, 'White-label solution'];

const TIERS = [
  { key: 'free', name: 'Free', price_cents: 0, max_guests: 100, max_events: 1, is_custom: false, features: F_FREE, feature_keys: ['rsvp_basic', 'email_notifications'] },
  { key: 'mid', name: 'Premium', price_cents: 14900, max_guests: 300, max_events: 0, is_custom: false, recommended: true, features: F_MID, feature_keys: ['rsvp_basic', 'email_notifications', 'seating_map', 'sms_campaigns'] },
  { key: 'top', name: 'Bespoke', price_cents: 0, max_guests: 0, max_events: 0, is_custom: true, features: F_TOP, feature_keys: ['rsvp_basic', 'email_notifications', 'seating_map', 'sms_campaigns', 'white_label'] },
];

/* ═══════════════════════════════════════════════════════════════════════════
   1. CAPACITY IS A SCALAR
   ═══════════════════════════════════════════════════════════════════════════ */

describe('capacity is a number, never a tick', () => {
  /* THE DEFECT THIS REPLACES, IN FULL.

     The page used to build each tier's comparison list as
     [tierGuestLine(tier), ...features], injecting "Up to 100 guests" as if it
     were a FEATURE. The table matched features by exact string, so the result
     was six rows — 100, 150, 300, 1000, 3000, Unlimited — each carrying a
     single tick and a dash under every other plan. The first row of that table
     told a customer that the $299 Enterprise plan did NOT include "Up to 100
     guests".

     The table itself was removed on 2026-08-21 for being unreadable on a
     phone, so those rows are gone with it. These cases stay because the CAUSE
     has not gone anywhere: capacity is still a scalar living next to a feature
     list, and the one-line change that reintroduces the bug is putting the
     sentence back into that list. */
  it('never builds a list from the guest sentence helper', () => {
    // tierGuestLine() renders the prose that caused this. It has a legitimate
    // caller (/solutions/corporate) but must never be reached from here.
    [['pricingData.js', DATA], ['PricingClient.js', CLIENT]].forEach(([name, src]) => {
      expect(src.includes('tierGuestLine('), `${name} calls tierGuestLine`).toBe(false);
    });
  });

  it('keeps the cap out of the feature list a plan row prints', () => {
    buildLadder(TIERS).forEach((plan) => {
      plan.adds.forEach((f) => {
        expect(f, `a capacity sentence is back in ${plan.name} features`).not.toMatch(/guests?$/i);
      });
    });
  });

  it('hands each plan its cap as a value and a unit', () => {
    expect(buildLadder(TIERS).map((p) => p.capacity.value)).toEqual(['100', '300', 'Unlimited']);
    expect(capacityOf({ max_guests: 300 })).toMatchObject({ value: '300', unit: 'guests', unlimited: false });
    expect(capacityOf({ max_guests: 0 }).unlimited).toBe(true);
  });

  it('formats a thousands separator, the same one everywhere', () => {
    // The cards printed "Up to 3000 guests" while the plan finder two sections
    // down printed "3,000+", from the same number.
    expect(formatCount(3000)).toBe('3,000');
    expect(capacityOf({ max_guests: 3000 }).value).toBe('3,000');
    expect(priceOf({ price_cents: 100000 }).amount).toBe('$1,000');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. THE LIMIT NOBODY WAS TOLD ABOUT
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the event allowance is disclosed', () => {
  /* max_events is enforced in four places on the payment path and refuses to
     publish an event with "You've reached the maximum number of events (N)".
     It was stored, enforced, and stripped by the public endpoint — so the one
     page promising no surprises was the only surface that could not say it. */
  it('is served by the public pricing endpoint', () => {
    const controller = readRepo('backend/controllers/paymentController.js');
    const publicBlock = topLevelBlock(controller, 'const getPublicPricing');
    expect(publicBlock).toMatch(/max_events: Number\(t\.max_events\)/);
  });

  it('reaches the plan row, which is where it is stated now', () => {
    /* It used to be a row of the comparison table. That table is gone, so the
       plan row is the ONLY place this cap is disclosed — losing it here loses
       it from the product, and it is a limit that refuses a purchase. */
    const ladder = buildLadder(TIERS);
    expect(ladder.map((p) => p.events.value)).toEqual(['1', 'Unlimited', 'Unlimited']);
    expect(ladder[0].events.unlimited).toBe(false);
    expect(CLIENT).toMatch(/plan\.events\.unlimited/);
    expect(CLIENT).toMatch(/Covers \{plan\.events\.value\}/);
  });

  it('reads 0 as unlimited, which is what the payment path does', () => {
    expect(eventsOf({ max_events: 0 }).unlimited).toBe(true);
    expect(eventsOf({}).unlimited).toBe(true);
    expect(eventsOf({ max_events: 1 })).toMatchObject({ value: '1', unit: 'event' });
    expect(eventsOf({ max_events: 3 })).toMatchObject({ value: '3', unit: 'events' });
  });

  it('is only raised in the questions when a plan actually caps it', () => {
    const capped = buildFaqs(TIERS).map((f) => f.q).join(' ');
    expect(capped).toMatch(/how many events/i);
    const uncapped = buildFaqs(TIERS.map((t) => ({ ...t, max_events: 0 }))).map((f) => f.q).join(' ');
    expect(uncapped, 'invents a restriction that does not exist').not.toMatch(/how many events/i);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. CLAIMS THE PRODUCT DOES NOT SUPPORT
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the page does not promise things that do not exist', () => {
  it('offers no free trial', () => {
    /* The closing call to action read "Try Fancy RSVP free for 14 days. No
       credit card required." — in the largest type on the page, under a
       heading promising no surprises. There is no trial in this product: the
       model is a free plan plus a one-off fee per event, which is exactly what
       the homepage hero says. */
    [['PricingClient.js', CLIENT], ['pricingData.js', DATA], ['page.js', PAGE]].forEach(([name, src]) => {
      expect(src, `${name} promises a trial`).not.toMatch(/free for \d+ days|free trial|\d+-day trial/i);
    });
  });

  it('does not word the refund policy for itself', () => {
    /* Three documents answered this three ways: this page said "case-by-case",
       the homepage FAQ promised a full refund within 14 days, and /terms
       described annual and monthly SUBSCRIPTIONS this product does not sell.

       The cause was /terms: a refund clause written around renewal dates
       cannot be applied to a one-off fee per event, so every other surface
       improvised. /terms now describes the real product and the wording lives
       in utils/refundPolicy.js. This page prints it VERBATIM — it may not
       paraphrase, which is how the three answers diverged in the first place.
       The policy itself is pinned by test/refundPolicy.test.js. */
    const refund = buildFaqs(TIERS).find((f) => /refund/i.test(f.q));
    expect(refund, 'the refund question is gone entirely').toBeTruthy();
    expect(refund.link).toMatchObject({ href: '/terms' });
    expect(refund.a).toContain(REFUND_SUMMARY);
    // …and the route, added 2026-08-22. A policy with no door is a rule.
    expect(refund.a).toContain(REFUND_HOW);
    expect(DATA).toMatch(/refundPolicy/);
  });

  it('answers "how do I pay" from the endpoint, not from a hardcoded Stripe', () => {
    /* Cards are live only when PAYMENTS_STRIPE_ENABLED is true AND a secret
       key is set (backend/config/features.js), and .env.example ships it off.
       The endpoint has always returned features.stripeEnabled; the page threw
       the whole object away and hardcoded "via Stripe". */
    const pay = (opts) => buildFaqs(TIERS, opts).find((f) => /how do i pay/i.test(f.q)).a;
    expect(pay({ stripeEnabled: true })).toMatch(/stripe/i);
    expect(pay({ stripeEnabled: false })).not.toMatch(/stripe/i);
    expect(pay({ stripeEnabled: false })).toMatch(/bank transfer/i);
  });

  it('still ships the registry note the endpoint used to withhold', () => {
    /* featureRegistry's own comment on FEATURE_NOTES names "the public pricing
       page" as the first surface that must print the caveat in the same words,
       and it was the one surface the endpoint did not send it to — so texting
       read exactly like a feature the plan price covers.

       The surface that printed it was the comparison table, now removed. The
       endpoint keeps sending it: withdrawing it again would leave a future
       comparison to reinvent its own wording, which is the failure the
       registry comment exists to prevent. */
    const controller = readRepo('backend/controllers/paymentController.js');
    const publicBlock = topLevelBlock(controller, 'const getPublicPricing');
    expect(publicBlock).toMatch(/note: FEATURE_NOTES\[f\.key\]/);
    expect(publicBlock).toMatch(/category: f\.category/);
  });

  it('does not name a plan when describing the door app', () => {
    // checkin_app can be moved between tiers in Admin -> Config at any time,
    // so a tier name in this answer goes stale silently.
    const app = buildFaqs(TIERS).find((f) => /door/i.test(f.q));
    TIERS.forEach((t) => expect(app.a, `names the ${t.name} plan`).not.toContain(t.name));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. THE LADDER'S ONE FALSE-CLAIM RISK
   ═══════════════════════════════════════════════════════════════════════════ */

describe('a plan row only claims to inherit when it really does', () => {
  it('names the previous plan and lists only the difference', () => {
    const [, mid] = buildLadder(TIERS);
    expect(mid.inheritsFrom).toBe('Free');
    expect(mid.adds).toEqual(['Seating chart designer', 'Text messaging']);
    F_FREE.forEach((f) => expect(mid.adds).not.toContain(f));
  });

  it('the first plan never claims to inherit from anything', () => {
    expect(buildLadder(TIERS)[0].inheritsFrom).toBeNull();
  });

  it('falls back to the full list when containment does not hold', () => {
    /* Nothing in the product enforces that a higher tier contains a lower one
       — an admin ticks each tier independently. "Everything in Free, and…" on
       a tier that is missing something Free has is a false claim. */
    const broken = [
      { key: 'a', name: 'A', price_cents: 100, max_guests: 50, features: ['Basic RSVP forms', 'Email notifications'] },
      { key: 'b', name: 'B', price_cents: 200, max_guests: 90, features: ['Basic RSVP forms', 'Seating chart designer'] },
    ];
    const [, b] = buildLadder(broken);
    expect(b.inheritsFrom).toBeNull();
    expect(b.adds).toEqual(['Basic RSVP forms', 'Seating chart designer']);
  });

  it('says "and N more" rather than quietly dropping the rest', () => {
    /* The delta is a SUMMARY, and a summary that stops at three without
       saying so under-sells the tier. There is no comparison table below to
       defer to any more, so the count is the only signal that the row is not
       the whole list. */
    const wide = [
      { key: 'a', name: 'A', price_cents: 100, max_guests: 50, features: ['One'] },
      { key: 'b', name: 'B', price_cents: 200, max_guests: 90, features: ['One', 'Two', 'Three', 'Four', 'Five', 'Six'] },
    ];
    const [, b] = buildLadder(wide);
    expect(b.named).toEqual(['Two', 'Three', 'Four']);
    expect(b.moreCount).toBe(2);
  });

  it('claims no leftover more when the delta fits', () => {
    const [, mid] = buildLadder(TIERS);
    expect(mid.named).toEqual(mid.adds);
    expect(mid.moreCount).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. THE PAGE CAN DESCRIBE ITSELF
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the route is indexable', () => {
  /* /pricing was a 'use client' page with no layout.js and no metadata of any
     kind — no title, description, canonical or Open Graph — while listed in
     sitemap.js the whole time. And because the tiers were fetched in an
     effect, its HTML said "Loading plans…" where the prices belong. */
  it('exports generateMetadata with a canonical', () => {
    expect(PAGE).toMatch(/export async function generateMetadata/);
    expect(PAGE).toMatch(/alternates:\s*\{\s*canonical/);
    expect(PAGE).toMatch(/openGraph/);
  });

  it('is a Server Component that fetches before it renders', () => {
    expect(PAGE.startsWith("'use client'"), '/pricing went back to the client').toBe(false);
    expect(PAGE).toMatch(/await fetchPricing\(\)/);
    expect(FETCH).toMatch(/export const fetchPricing = cache\(/);
  });

  it('keeps the server fetch out of the browser bundle', () => {
    /* pricingData.js holds pure helpers and PricingClient — a 'use client'
       component — imports them, so that module is bundled for the browser.
       cache(...) at module scope is a side effect no tree-shake removes, so
       the fetch and the API-URL resolution would ride along with it. */
    expect(DATA).not.toMatch(/fetchPricing|INTERNAL_API_URL/);
    expect(CLIENT).not.toMatch(/pricingFetch/);
  });

  it('keeps the data module off the client boundary', () => {
    /* A Server Component importing from a 'use client' module receives client
       REFERENCES, not values — the production build then dies at page-data
       collection with "FAQS.map is not a function". components/landing/
       faqContent.js carries this warning after it happened once. */
    expect(DATA.includes("'use client'"), 'pricingData.js took a client boundary').toBe(false);
  });

  it('builds its structured data from the same answers a visitor reads', () => {
    expect(PAGE).toMatch(/buildFaqs\(/);
    expect(PAGE).toMatch(/'@type': 'FAQPage'/);
    expect(PAGE).toMatch(/'@type': 'AggregateOffer'/);
    expect(PAGE).toMatch(/safeJsonLdHtml/);
  });

  it('leaves the quoted plan out of the advertised price range', () => {
    // A custom tier has no price_cents; publishing 0 for it would advertise a
    // low price of zero for a plan a human quotes.
    const block = PAGE.slice(PAGE.indexOf('function structuredData'));
    expect(block).toMatch(/tiers\.filter\(\(t\) => !t\.is_custom\)/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   7. DEAD WEIGHT STAYS GONE
   ═══════════════════════════════════════════════════════════════════════════ */

describe('nothing left behind by the rebuild', () => {
  it('has no plan-column helper, because there are no plan columns', () => {
    expect(fs.existsSync(path.join(ROOT, 'src/app/pricing/planColumns.js'))).toBe(false);
  });

  it('left no comparison code behind when the table was removed', () => {
    /* Removed 2026-08-21. Deleted, not hidden below 768: a branch nothing
       renders is the kind of code that rots quietly, and this one carried the
       page's only two disclosure rows with it. */
    expect(DATA).not.toMatch(/buildComparison\s*\(/);
    expect(CLIENT).not.toMatch(/buildComparison|featureCatalog|ValueCell/);
    expect(PAGE).not.toMatch(/featureCatalog=/);
  });

  it('does not keep a second hand-rolled accordion', () => {
    // FaqCtaSection already uses <details>, which is keyboard accessible,
    // announces its own state and works before hydration. This page used a
    // useState openIndex and rebuilt aria-expanded by hand.
    expect(CLIENT).toMatch(/<details/);
    expect(CLIENT).not.toMatch(/openFaq/);
  });

  it('does not import a token it never uses', () => {
    ['C', 'T'].forEach((name) => {
      expect(CLIENT.includes(`${name}.`), `${name} is imported unused`).toBe(true);
    });
    expect(RECOMMENDER.includes('C.'), 'PlanRecommender imports C unused').toBe(true);
  });
});
