import React from "react";
import Link from "next/link";
import { COLLECTION, OWN_PHOTO_NOTE } from "../../collection/collectionCatalogue";
import { buildWhatsappUrl } from "../../utils/shopLinks";
import { C, T, SHADOW, BEZEL } from "./landingTokens";
import CollectionRail from "./CollectionRail";

/* ═══════════════════════════════════════════════════════════════════════════
   THE INVITATIONS.

   The most differentiated thing this product has. Every picture is a real
   screenshot of the shipping template, produced by test/shots — never an
   artist's impression.

   ── 2026-09-09, second pass: what came off this band ─────────────────────

   The first pass at the mockup added to this band rather than to the page: an
   in-page index of six anchor chips above the heading, a section numeral in
   the corner, a gold rule beside the kicker, an italic arrival line under
   every card, a footnote about Sealed Letter's photograph, and a framed
   commission block with its own heading and paragraph. Each was defensible.
   Together they put six separate pieces of furniture on the screen that the
   mockup gives to four photographs and one button, and the owner's word for
   the result was the right one.

   What is here now: centred heading, one sentence, the rail with its dots, one
   ink pill, and — when there is a real one — a quote. The commission offer
   survives as a single line, because it is a real business (the studio does
   design bespoke invitations) and losing it would cost more than the line.

   The catalogue is READ, not rebuilt. This file used to assemble its own view
   of the four templates — TEMPLATES filtered by CINEMATIC_KEYS, the badge from
   occasionPolicyFor, a local map of plate art. collectionCatalogue.js already
   does all of that for the gallery, the detail pages and the sitemap, and its
   whole docstring is about why that list must exist once.
   ═══════════════════════════════════════════════════════════════════════════ */

const API_URL = process.env.INTERNAL_API_URL
  || process.env.NEXT_PUBLIC_API_URL
  || 'http://localhost:5000/api/v1';

/* THE STUDIO'S NUMBER, FROM THE ONE PLACE THAT OWNS IT.

   Same endpoint and same revalidate as PrintedInvitationsSection, so Next
   dedupes the two into ONE request per render rather than fetching the
   catalogue twice for one page. The number lives in
   super_admin_config.shop_settings and is served through the public allowlist
   — there is no second place to put a WhatsApp number, and adding one is how a
   business ends up answering two. */
async function fetchShopSettings() {
  try {
    const res = await fetch(`${API_URL}/public/shop`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.settings || null;
  } catch {
    // The band must render with or without it — the four invitations are the
    // point, and the commission line simply does not appear.
    return null;
  }
}

/**
 * One published review, for the pull quote.
 *
 * ── Why this is fetched on the SERVER when a hook already exists ──────────
 *
 * `useTestimonials` is what ProofSection uses, and it is right for that band:
 * a grid of cards that appears or does not. This is a single line of display
 * type in the middle of the page, and a client hook would render the band, do
 * a round trip, and then push everything below it down by the height of a
 * quote. Fetched here it is either in the first paint or absent from it.
 *
 * NOTHING IS INVENTED. The endpoint degrades to an empty array on a backend
 * error (marketingController.getPublicTestimonials answers HTTP 200 with
 * `success: false`), and an empty array renders no quote at all — which is the
 * state of a fresh install. A homepage carrying a testimonial nobody gave is
 * the one thing this band must never do.
 */
async function fetchQuote() {
  try {
    const res = await fetch(`${API_URL}/public/testimonials`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const data = await res.json();
    const list = Array.isArray(data?.testimonials) ? data.testimonials : [];
    // The shortest one. A pull quote is one line of display type; the longest
    // review in the table would set to six and stop being a pull quote.
    // ProofSection still shows all of them in full.
    const usable = list.filter((t) => t?.quote && t?.name);
    if (!usable.length) return null;
    return usable.reduce((a, b) => (a.quote.length <= b.quote.length ? a : b));
  } catch {
    return null;
  }
}

/** Pre-typed so whoever answers is not starting from "hi". */
const COMMISSION_MESSAGE = 'Hello! I would like to talk about a custom invitation design for my event.';

export default async function TemplatesShowcaseSection() {
  /* Gated on a real NUMBER, not on whether the shop is switched on: the shop
     switch is about selling printed goods, and commissioning an invitation is
     a different conversation on the same phone. No number, no line — a CTA
     that opens "wa.me/" and nothing else is worse than no CTA. */
  const [settings, quote] = await Promise.all([fetchShopSettings(), fetchQuote()]);
  const commissionHref = buildWhatsappUrl({ settings, message: COMMISSION_MESSAGE });

  return (
    <section id="invitations" className="tss" aria-labelledby="tss-title">
      <div className="fx-container fx-container--4xl fx-gutter">
        <header className="tss-head">
          <span className="tss-kicker">The collection</span>
          <h2 id="tss-title" className="tss-title">
            Invitations for every kind of celebration.
          </h2>
          <p className="tss-sub">
            From timeless elegance to modern stories — each one photographed,
            not drawn, and yours to fill in.
          </p>
        </header>

        <CollectionRail items={COLLECTION} />

        <div className="tss-act">
          {/* /collection, not /templates — the latter is still a 308 to the
              homepage in next.config.mjs and would bounce. */}
          <Link href="/collection" className="tss-btn">
            Explore the collection
            <svg width="15" height="9" viewBox="0 0 16 9" fill="none" aria-hidden="true">
              <path d="M0 4.5h13M10.5 1L14 4.5 10.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>

        {/* ── THE QUOTE ── Real or absent. See fetchQuote. */}
        {quote && (
          <figure className="tss-quote">
            <blockquote>&ldquo;{quote.quote}&rdquo;</blockquote>
            <figcaption>
              {quote.name}
              {quote.role && <span className="tss-quote__role">{quote.role}</span>}
            </figcaption>
          </figure>
        )}

        {/* ── THE COMMISSION, AS ONE LINE ──
            Four invitations read as a menu, and a visitor whose event is not on
            that menu concludes the product cannot do it. It can: the studio
            designs one. That was a framed block with a heading, a paragraph and
            a button — the single heaviest thing on a band whose subject is
            photographs. One sentence makes the same offer.

            "your own photograph" also lives here now: it is Sealed Letter's
            strongest claim and the one thing no shot of that template can show,
            since its fold is the couple's OWN picture. It was a margin note
            with a stand-in illustration beside it, which is a disclaimer with
            decoration on top. */}
        {/* TWO SHORT LINES, not one long one. Run together they set to three
            ragged lines at 390px with the WhatsApp mark stranded at the start
            of the last one — two unrelated facts reading as one sentence. */}
        <p className="tss-foot">
          {/* From the catalogue, not typed here — the same rule ARRIVAL
              follows, and for the same reason. */}
          {COLLECTION.filter((c) => OWN_PHOTO_NOTE[c.key])
            .map((c) => OWN_PHOTO_NOTE[c.key])
            .join(' ')}
        </p>

        {commissionHref && (
          <p className="tss-foot tss-foot--ask">
            {'Not on this list? '}
            <a
              className="tss-comm__btn"
              href={commissionHref}
              target="_blank"
              rel="noopener noreferrer"
            >
                {/* BOTH paths. The outer bubble alone is a generic speech
                    bubble, not the WhatsApp mark — the handset inside it is
                    what makes it recognisable at this size. Same two paths as
                    the shop's WhatsappGlyph, copied rather than imported: that
                    lives in shop/piStyles.js, a 'use client' module whose other
                    exports are a whole stylesheet the landing page has no
                    business pulling in. */}
                <svg className="tss-comm__wa" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                  <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.75-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35z" />
                  <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.86 9.86 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm0 18.02h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.37c0-4.54 3.7-8.23 8.24-8.23a8.24 8.24 0 0 1 0 16.46z" />
                </svg>
              Talk to the studio
            </a>
          </p>
        )}
      </div>

      {/* A plain style element — styled-jsx cannot be imported from a Server
          Component, and a scoped rule would never attach to the next/link
          cards CollectionRail renders. Classes are prefixed "tss-" instead.

          No backticks inside these CSS comments: one would end the template
          literal and produce a parse error. */}
      <style>{`
        .tss {
          width: 100%;
          background: ${C.paper2};
          padding: 76px 0;
        }

        /* Centred, and identical to FeatureBand's header by design — this band
           predates that component and cannot use it (it owns a rail, a quote
           and a footnote rather than one picture), so the ONE thing it must
           not do is set its heading differently from the six bands below. */
        .tss-head { text-align: center; max-width: 640px; margin: 0 auto; }
        .tss-kicker {
          display: block;
          font-family: ${T.label};
          font-size: 10px;
          letter-spacing: 0.3em;
          text-transform: uppercase;
          color: ${C.goldInk};
        }
        .tss-title {
          font-family: ${T.display};
          font-weight: 300;
          font-size: 37px;
          line-height: 1.08;
          letter-spacing: -0.015em;
          color: ${C.ink};
          margin: 16px 0 0;
          text-wrap: balance;
        }
        .tss-sub {
          font-size: 15px;
          font-weight: 300;
          line-height: 1.75;
          color: ${C.inkSoft};
          margin: 14px auto 0;
          max-width: 44ch;
          text-wrap: pretty;
        }

        /* ── the rail ───────────────────────────────────────────────────────
           The cards are a FIXED width and the port scrolls. That is the one
           arrangement in which a phone shows one card and a slice of the next
           — which is what tells a reader, without an instruction, that the row
           moves. */
        .tss-railwrap { position: relative; margin-top: 44px; }
        .tss-rail {
          display: flex;
          gap: 16px;
          margin: 0;
          padding: 0 0 6px;
          list-style: none;
          overflow-x: auto;
          overscroll-behavior-x: contain;
          scroll-snap-type: x mandatory;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        .tss-rail::-webkit-scrollbar { display: none; }
        .tss-slide {
          flex: none;
          width: 206px;
          scroll-snap-align: center;
        }
        .tss-card { display: block; text-decoration: none; text-align: center; }

        /* The invitation as an object: a dark bezel, a long shadow, and a faint
           edge so it does not read as a pasted rectangle. */
        .tss-device {
          display: block;
          border-radius: 20px;
          padding: 5px;
          background: ${BEZEL};
          box-shadow: ${SHADOW.device};
          transition: transform 0.4s ease;
        }
        .tss-device img {
          display: block;
          width: 100%;
          height: auto;
          border-radius: 15px;
        }
        .tss-card:hover .tss-device { transform: translateY(-6px); }

        /* Name over occasion, centred under the picture — the mockup's caption,
           and two lines rather than the four this card used to carry. */
        .tss-name {
          display: block;
          margin-top: 18px;
          font-family: ${T.display};
          font-size: 21px;
          font-weight: 400;
          line-height: 1.15;
          color: ${C.ink};
        }
        .tss-badge {
          display: block;
          margin-top: 5px;
          font-size: 9px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: ${C.inkSoft};
          opacity: 0.8;
        }

        /* ── the dots ───────────────────────────────────────────────────── */
        /* ── the dots ───────────────────────────────────────────────────────
           The BUTTON is the hit area and the SPAN is the dot. globals.css puts
           a 44x44 floor under every button on a touch pointer — correct, and
           it turned a 7px dot into a 44px gold ring, so the carousel looked
           like it had four more buttons under it. Sizing the span leaves the
           target where it should be and the mark the size it should be.
           The negative margin claws back the padding those targets add. */
        .tss-dots {
          display: flex;
          justify-content: center;
          margin: 16px -6px 0;
        }
        .tss-dot {
          appearance: none;
          display: grid;
          place-items: center;
          padding: 0;
          width: 22px;
          height: 22px;
          border: 0;
          background: transparent;
          cursor: pointer;
        }
        .tss-dot > span {
          display: block;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          border: 1px solid ${C.gold};
          opacity: 0.55;
          transition: opacity 0.25s ease, background 0.25s ease, border-color 0.25s ease;
        }
        .tss-dot--on > span {
          background: ${C.goldInk};
          border-color: ${C.goldInk};
          opacity: 1;
        }

        /* ── the arrows: a mouse affordance, put away where there is a swipe ── */
        .tss-arrows { display: none; }

        /* ── the ask ────────────────────────────────────────────────────────
           The FILLED ink pill. The page has exactly two button shapes: this
           one for its own asks, and FeatureBand's outlined gold one for "go
           and look at the thing I just described". */
        .tss-act { margin-top: 30px; text-align: center; }
        .tss-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 11px;
          min-height: 54px;
          padding: 0 32px;
          border-radius: 999px;
          background: ${C.ink};
          border: 1px solid ${C.ink};
          color: ${C.paper};
          font-family: ${T.body};
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          white-space: nowrap;
          text-decoration: none;
          transition: background 0.3s ease, color 0.3s ease;
        }
        .tss-btn:hover { background: ${C.goldInk}; border-color: ${C.goldInk}; }
        /* 320px. The pill is nowrap, so a label it cannot fit overflows rather
           than wraps — see the measured note on .fb-cta in FeatureBand. */
        @media (max-width: 639.98px) {
          .tss-btn { padding: 0 20px; letter-spacing: 0.1em; gap: 9px; }
        }

        /* ── the quote ──────────────────────────────────────────────────── */
        .tss-quote {
          margin: 52px auto 0;
          max-width: 26ch;
          text-align: center;
        }
        .tss-quote blockquote {
          margin: 0;
          font-family: ${T.display};
          font-weight: 300;
          font-style: italic;
          font-size: 25px;
          line-height: 1.35;
          color: ${C.ink};
          text-wrap: pretty;
        }
        .tss-quote figcaption {
          margin-top: 14px;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: ${C.goldInk};
        }
        .tss-quote__role {
          display: block;
          margin-top: 4px;
          font-weight: 300;
          letter-spacing: 0.04em;
          text-transform: none;
          font-size: 12px;
          color: ${C.inkSoft};
        }

        /* ── the footnote ───────────────────────────────────────────────── */
        .tss-foot {
          margin: 40px auto 0;
          max-width: 62ch;
          text-align: center;
          font-size: 12.5px;
          font-weight: 300;
          line-height: 1.9;
          color: ${C.inkSoft};
        }
        .tss-foot--ask { margin-top: 6px; }
        /* align-items: CENTER, not baseline. On baseline the 13px mark sits on
           the text's baseline and hangs below the underline; the two are one
           object, so they are centred on each other. */
        .tss-comm__btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: ${C.ink};
          text-decoration: none;
          border-bottom: 1px solid ${C.gold};
          padding-bottom: 1px;
        }
        .tss-comm__btn:hover { color: ${C.goldInk}; border-color: ${C.goldInk}; }
        .tss-comm__wa { width: 13px; height: 13px; flex: none; }

        @media (min-width: 768px) {
          .tss { padding: 124px 0; }
          .tss-kicker { font-size: 11px; letter-spacing: 0.36em; }
          .tss-title { font-size: 52px; margin-top: 20px; }
          .tss-sub { font-size: 17px; margin-top: 18px; }
          .tss-railwrap { margin-top: 62px; }
          .tss-rail { gap: 24px; }
          .tss-slide { width: 236px; }
          .tss-device { border-radius: 24px; padding: 6px; }
          .tss-device img { border-radius: 19px; }
          .tss-name { font-size: 23px; }
          .tss-act { margin-top: 40px; }
          .tss-quote { margin-top: 72px; }
          .tss-quote blockquote { font-size: 34px; }
          .tss-foot { margin-top: 52px; font-size: 13px; }

          /* Above the rail's top-right corner: they cover nothing, so they
             never have to be taken away — and below 768 the dots and the swipe
             already do the job, so they are not shown at all. */
          /* The dots hand over to the arrows here. Below 768 the rail is a
             swipe and the dots say where you are; from 768 there is a mouse,
             the arrows appear when there is somewhere to go, and at a desktop
             width all four cards are visible at once — where a row of dots is
             an indicator for a thing that is not moving. */
          .tss-dots { display: none; }
          .tss-arrows {
            display: flex;
            position: absolute;
            top: -58px;
            right: 0;
            gap: 8px;
          }
          .tss-arrow {
            display: grid;
            place-items: center;
            width: 38px;
            height: 38px;
            padding: 0;
            border-radius: 50%;
            background: ${C.paper};
            border: 1px solid ${C.border};
            color: ${C.ink};
            cursor: pointer;
            transition: border-color 0.25s ease, opacity 0.25s ease;
          }
          .tss-arrow svg { width: 16px; height: 16px; }
          .tss-arrow:hover { border-color: ${C.gold}; }
          .tss-arrow:disabled { opacity: 0.34; cursor: default; }
        }

        @media (prefers-reduced-motion: reduce) {
          .tss-btn, .tss-device, .tss-arrow, .tss-dot { transition: none; }
          .tss-rail { scroll-behavior: auto; }
        }
      `}</style>
    </section>
  );
}
