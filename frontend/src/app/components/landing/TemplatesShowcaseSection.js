import React from "react";
import Link from "next/link";
import { COLLECTION, OWN_PHOTO_NOTE } from "../../collection/collectionCatalogue";
import { buildWhatsappUrl } from "../../utils/shopLinks";
import { C, T, SHADOW, BEZEL, PAGE_INDEX } from "./landingTokens";
import CollectionRail from "./CollectionRail";

/* ═══════════════════════════════════════════════════════════════════════════
   THE INVITATIONS.

   The most differentiated thing this product has. Every picture is a real
   screenshot of the shipping template, produced by test/shots — never an
   artist's impression.

   ── 2026-09-09: two changes ──────────────────────────────────────────────

   1. THE PLATES BECAME A RAIL. Four capped plates in a grid are one desktop
      row and four stacked handsets on a phone — about 2,400px of scroll for
      four pictures. See CollectionRail.js.

   2. THE CATALOGUE IS READ, NOT REBUILT. This file used to assemble its own
      view of the four templates: TEMPLATES filtered by CINEMATIC_KEYS, the
      badge from occasionPolicyFor, the art from a local SHOTS map, the
      opening line from ARRIVAL. collection/collectionCatalogue.js already
      does all of that, for the gallery, the detail pages and the sitemap —
      and its whole docstring is about why that list must exist once. This
      band was the fifth surface reassembling it. It now imports COLLECTION,
      which is the same four items the gallery shows, in the same order, with
      the same badges.

      One thing was lost in that swap and it was worth losing: the "your own
      photograph goes here" margin note on the Sealed Letter plate, with its
      stand-in illustration. A card in a rail is a name and a picture; a
      footnote about what is behind one of them belongs on that template's own
      page, which now exists at /collection/letter and says it there.

   The quote at the foot is a REAL published review or it is absent — see
   fetchQuote below.
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
    // point, and the commission strip simply does not appear.
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
    // The shortest one. A pull quote is one line of 40px display type; the
    // longest review in the table would set to six and stop being a pull
    // quote. ProofSection still shows all of them in full.
    const usable = list.filter((t) => t?.quote && t?.name);
    if (!usable.length) return null;
    return usable.reduce((a, b) => (a.quote.length <= b.quote.length ? a : b));
  } catch {
    return null;
  }
}

/** Pre-typed so whoever answers is not starting from "hi". */
const COMMISSION_MESSAGE = 'Hello! I would like to talk about a custom invitation design for my event.';

/* The band's headline COUNTS the templates rather than naming a number, so
   shipping a fifth cannot leave the page saying "four". */
const COUNT_WORD = ["no", "one", "two", "three", "four", "five", "six", "seven"];
const countWord = (n) => COUNT_WORD[n] || String(n);

export default async function TemplatesShowcaseSection() {
  /* Gated on a real NUMBER, not on whether the shop is switched on: the shop
     switch is about selling printed goods, and commissioning an invitation is
     a different conversation on the same phone. No number, no strip — a CTA
     that opens "wa.me/" and nothing else is worse than no CTA. */
  const [settings, quote] = await Promise.all([fetchShopSettings(), fetchQuote()]);
  const commissionHref = buildWhatsappUrl({ settings, message: COMMISSION_MESSAGE });

  return (
    <section id="invitations" className="tss" aria-labelledby="tss-title">
      {/* --5xl, not --lg. .fx-container--lg is 720px, a READING measure, and
          this is a gallery of photographs. */}
      <div className="fx-container fx-container--5xl fx-gutter">
        {/* ── WHAT IS ON THIS PAGE ──
            The first thing under the hero, and it belongs to the PAGE rather
            than to this band — but it is rendered here rather than as a band
            of its own so that BAND_ORDER stays the one place the page's
            arrangement is stated. A twelfth entry declaring a strip of six
            links would say less than this comment does.

            A <nav> with a real label, because that is what it is: six anchors
            into a page that is seventeen screens long on a phone. See
            PAGE_INDEX in landingTokens.js for why these six. */}
        <nav className="tss-index" aria-label="On this page">
          <ul className="fx-scroll-x">
            {PAGE_INDEX.map((entry) => (
              <li key={entry.id}>
                <a href={`#${entry.id}`}>{entry.label}</a>
              </li>
            ))}
          </ul>
        </nav>

        <header className="tss-head">
          <span className="tss-kicker">
            The collection
            <span aria-hidden="true" className="tss-kicker__rule" />
          </span>
          <span className="tss-secnum" aria-hidden="true">I</span>
          <h2 id="tss-title" className="tss-title">
            Invitations for every kind of celebration.
          </h2>
          <p className="tss-sub">
            {/* "Filmed, not animated" was true of three and is not true of the
                fourth — Sealed Letter is a sprite sheet, which is why it opens
                instantly on a handset that cannot stream video. The claim that
                covers all {countWord(COLLECTION.length)} is that they are
                photographed rather than drawn. */}
            Each one is photographed, not drawn — and every one of them is yours
            to fill in, in any language, for any occasion.
          </p>
        </header>

        <CollectionRail items={COLLECTION} />

        {/* THE CLAIM A PICTURE CANNOT MAKE.
            One footnote under the rail rather than a note glued to one card:
            it is about what is BEHIND a card, the rail is 206px wide, and the
            note used to carry a 64px stand-in illustration of a couple that
            was standing in for a photograph we do not have. The sentence is
            the whole of the value; the illustration was decoration on top of
            a disclaimer. Read from the catalogue, one per template that has
            something a shot of it cannot show. */}
        {COLLECTION.some((c) => OWN_PHOTO_NOTE[c.key]) && (
          <ul className="tss-notes">
            {COLLECTION.filter((c) => OWN_PHOTO_NOTE[c.key]).map((c) => (
              <li key={c.key}>{OWN_PHOTO_NOTE[c.key]}</li>
            ))}
          </ul>
        )}

        <div className="tss-cta">
          {/* /collection, not /templates — the latter is still a 308 to the
              homepage in next.config.mjs and would bounce. */}
          <Link href="/collection" className="tss-btn tss-btn--ghost">
            Explore the collection
          </Link>
        </div>

        {/* ── THE QUOTE ──
            Real or absent. See fetchQuote. */}
        {quote && (
          <figure className="tss-quote">
            <blockquote>&ldquo;{quote.quote}&rdquo;</blockquote>
            <figcaption>
              <span className="tss-quote__who">{quote.name}</span>
              {quote.role && <span className="tss-quote__role">{quote.role}</span>}
            </figcaption>
          </figure>
        )}

        {/* ── THE COMMISSION ──
            Four invitations on a page read as a menu, and a visitor whose
            event is not on that menu concludes the product cannot do it. It
            can: the studio designs one. This says so where the assumption is
            formed, rather than in a FAQ four bands down. */}
        {commissionHref && (
          <aside className="tss-comm" aria-labelledby="tss-comm-title">
            <span className="tss-comm__frame" aria-hidden="true" />
            <div className="tss-comm__copy">
              <span className="tss-comm__kicker">
                Commissions
                <span aria-hidden="true" className="tss-comm__rule" />
              </span>
              <h3 id="tss-comm-title" className="tss-comm__title">
                These {countWord(COLLECTION.length)} are where we start, not where we stop.
              </h3>
              <p className="tss-comm__body">
                If what you are imagining is not here — your own artwork, another
                language, a ritual that belongs to your family — the studio designs
                it with you and builds it into the platform as your own.
              </p>
            </div>

            <div className="tss-comm__act">
              {/* rel="noopener": a target=_blank link hands the opened page a
                  window.opener reference to this one without it. */}
              <a
                className="tss-comm__btn"
                href={commissionHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                {/* BOTH paths. The outer bubble alone is a generic speech
                    bubble, not the WhatsApp mark — the handset inside it is
                    what makes it recognisable at 16px. Same two paths as the
                    shop's WhatsappGlyph, copied rather than imported: that
                    lives in shop/piStyles.js, a 'use client' module whose
                    other exports are a whole stylesheet the landing page has
                    no business pulling in. */}
                <svg className="tss-comm__wa" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                  <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.75-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35z" />
                  <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.86 9.86 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm0 18.02h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.37c0-4.54 3.7-8.23 8.24-8.23a8.24 8.24 0 0 1 0 16.46z" />
                </svg>
                Design my VIP invitation
              </a>
              <span className="tss-comm__note">Opens a WhatsApp chat with the studio</span>
            </div>
          </aside>
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
          padding: 66px 0;
        }
        /* ── the in-page index ──────────────────────────────────────────────
           One row that scrolls rather than wraps. Six labels at this tracking
           are about 780px laid end to end, so on a phone this is a swipe and
           on a desktop it is a line — and a wrapped index reads as a paragraph
           of links rather than as a map.

           .fx-scroll-x is the primitive for content that genuinely cannot
           reflow; the inner list needs width: max-content or the flex track
           sizes to the port and the row never scrolls. */
        .tss-index {
          margin: 0 0 34px;
          padding-bottom: 20px;
          border-bottom: 1px solid ${C.border};
        }
        .tss-index ul {
          display: flex;
          gap: 10px;
          width: max-content;
          min-width: 100%;
          margin: 0;
          padding: 0 0 2px;
          list-style: none;
        }
        .tss-index li { flex: none; }
        .tss-index a {
          display: block;
          padding: 9px 15px;
          border: 1px solid ${C.border};
          border-radius: 999px;
          background: ${C.paper};
          font-family: ${T.body};
          font-size: 10.5px;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          white-space: nowrap;
          color: ${C.inkSoft};
          text-decoration: none;
          transition: color 0.25s ease, border-color 0.25s ease;
        }
        .tss-index a:hover { color: ${C.ink}; border-color: ${C.gold}; }

        .tss-head {
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          column-gap: 20px;
        }
        .tss-kicker {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          font-family: ${T.label};
          font-size: 10px;
          letter-spacing: 0.30em;
          text-transform: uppercase;
          color: ${C.goldInk};
          white-space: nowrap;
        }
        .tss-kicker__rule {
          display: block;
          flex: none;
          width: 28px;
          height: 1px;
          background: ${C.gold};
          opacity: 0.55;
        }
        .tss-secnum {
          font-family: ${T.display};
          font-style: italic;
          font-size: 13px;
          color: ${C.goldInk};
          opacity: 0.75;
        }
        .tss-title {
          grid-column: 1 / -1;
          font-family: ${T.display};
          font-weight: 300;
          font-size: 37px;
          line-height: 1.07;
          letter-spacing: -0.015em;
          color: ${C.ink};
          margin: 18px 0 0;
        }
        .tss-sub {
          grid-column: 1 / -1;
          font-size: 15.5px;
          font-weight: 300;
          line-height: 1.85;
          color: ${C.inkSoft};
          margin: 14px 0 0;
          max-width: 52ch;
        }

        /* ── the rail ───────────────────────────────────────────────────────
           The cards are a FIXED width and the port scrolls. That is the one
           arrangement in which a phone shows one and a half cards — which is
           what tells a reader, without an instruction, that the row moves. */
        .tss-railwrap { position: relative; margin-top: 58px; }
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
          scroll-snap-align: start;
        }
        .tss-card { display: block; text-decoration: none; }

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

        .tss-namerow {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          margin-top: 18px;
          padding-bottom: 10px;
          border-bottom: 1px solid ${C.border};
        }
        .tss-name {
          font-family: ${T.display};
          font-size: 21px;
          font-weight: 400;
          line-height: 1.12;
          letter-spacing: -0.01em;
          color: ${C.ink};
          min-width: 0;
        }
        .tss-badge {
          flex: none;
          font-size: 8.5px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: ${C.inkSoft};
          opacity: 0.75;
          white-space: nowrap;
        }
        .tss-arrival {
          display: block;
          font-family: ${T.display};
          font-size: 15.5px;
          font-style: italic;
          line-height: 1.4;
          color: ${C.goldInk};
          margin-top: 11px;
        }

        /* Above the rail's top-right corner: they cover nothing, so they never
           have to be taken away on a narrow screen. The railwrap's own top
           margin is what they sit in, so the two numbers move together — at
           -46 against a 34px margin they would have overlapped the sub-copy. */
        .tss-arrows {
          position: absolute;
          top: -52px;
          right: 0;
          display: flex;
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
          transition: background 0.25s ease, border-color 0.25s ease, opacity 0.25s ease;
        }
        .tss-arrow svg { width: 16px; height: 16px; }
        .tss-arrow:hover { border-color: ${C.gold}; }
        .tss-arrow:disabled { opacity: 0.34; cursor: default; }

        /* ── the footnotes ─────────────────────────────────────────────────
           Set in the display italic and in the readable gold, so a sentence
           about what is BEHIND a card is visibly an aside rather than a fifth
           card's worth of copy. */
        .tss-notes {
          margin: 24px 0 0;
          padding: 0;
          list-style: none;
        }
        .tss-notes li {
          font-family: ${T.display};
          font-size: 16px;
          font-style: italic;
          line-height: 1.5;
          color: ${C.goldInk};
          max-width: 56ch;
        }
        .tss-notes li + li { margin-top: 8px; }

        .tss-cta {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 32px;
        }
        .tss-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 56px;
          font-family: ${T.body};
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          white-space: nowrap;
          text-decoration: none;
          border-radius: 0;
          transition: background 0.35s ease, color 0.35s ease, border-color 0.35s ease;
        }
        .tss-btn--ghost {
          background: ${C.paper};
          color: ${C.ink};
          border: 1px solid ${C.border};
        }
        .tss-btn--ghost:hover { background: ${C.ink}; border-color: ${C.ink}; color: ${C.paper}; }

        /* ── the quote ──────────────────────────────────────────────────── */
        .tss-quote {
          margin: 44px 0 0;
          padding-top: 30px;
          border-top: 1px solid ${C.border};
          text-align: center;
        }
        .tss-quote blockquote {
          margin: 0;
          font-family: ${T.display};
          font-weight: 300;
          font-style: italic;
          font-size: 25px;
          line-height: 1.35;
          letter-spacing: -0.01em;
          color: ${C.ink};
          text-wrap: pretty;
        }
        .tss-quote figcaption {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          margin-top: 18px;
        }
        .tss-quote__who {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: ${C.goldInk};
        }
        .tss-quote__role {
          font-size: 12px;
          font-weight: 300;
          color: ${C.inkSoft};
        }

        /* ── the commission strip ──
           The engraved-plate vocabulary the shop's category tiles use: paper,
           a double gold rule set in from the edge, display serif over a
           tracked micro-label. It reads as a card of the house rather than as
           a banner bolted onto the band. */
        .tss-comm {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 22px;
          margin-top: 44px;
          padding: 30px 24px;
          background: linear-gradient(158deg, ${C.paper} 0%, #F6EFE2 100%);
          border: 1px solid #DED4C1;
        }
        .tss-comm__frame {
          position: absolute;
          inset: 7px;
          border: 1px solid rgba(169, 138, 78, 0.30);
          pointer-events: none;
        }
        .tss-comm__frame::after {
          content: "";
          position: absolute;
          inset: 3px;
          border: 1px solid rgba(169, 138, 78, 0.10);
        }
        .tss-comm__copy { position: relative; min-width: 0; }
        .tss-comm__kicker {
          display: inline-flex;
          align-items: center;
          gap: 11px;
          font-family: ${T.label};
          font-size: 9.5px;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: ${C.goldInk};
          white-space: nowrap;
        }
        .tss-comm__rule {
          display: block;
          flex: none;
          width: 26px;
          height: 1px;
          background: ${C.gold};
          opacity: 0.55;
        }
        .tss-comm__title {
          font-family: ${T.display};
          font-weight: 300;
          font-size: 24px;
          line-height: 1.18;
          letter-spacing: -0.012em;
          color: ${C.ink};
          margin: 12px 0 0;
        }
        .tss-comm__body {
          font-size: 14px;
          font-weight: 300;
          line-height: 1.8;
          color: ${C.inkSoft};
          margin: 10px 0 0;
          max-width: 54ch;
        }
        .tss-comm__act {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 9px;
          flex: none;
        }
        .tss-comm__btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          min-height: 52px;
          padding: 0 26px;
          background: ${C.ink};
          color: ${C.paper};
          border: 1px solid ${C.ink};
          font-family: ${T.body};
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          white-space: nowrap;
          text-decoration: none;
          transition: background 0.3s ease, color 0.3s ease;
        }
        .tss-comm__btn:hover { background: ${C.goldInk}; border-color: ${C.goldInk}; color: ${C.paper}; }
        .tss-comm__wa { width: 16px; height: 16px; flex: none; }
        .tss-comm__note {
          font-size: 10.5px;
          letter-spacing: 0.04em;
          color: ${C.inkSoft};
          opacity: 0.75;
        }

        @media (min-width: 768px) {
          .tss { padding: 112px 0; }
          .tss-index { margin-bottom: 44px; padding-bottom: 26px; }
          .tss-index ul { gap: 12px; }
          .tss-index a { padding: 10px 20px; font-size: 11px; }
          .tss-kicker { font-size: 11px; letter-spacing: 0.38em; gap: 16px; }
          .tss-kicker__rule { width: 44px; }
          .tss-secnum { font-size: 15px; }
          .tss-title { font-size: 54px; margin-top: 20px; }
          .tss-sub { font-size: 17px; margin-top: 16px; }
          .tss-railwrap { margin-top: 68px; }
          .tss-rail { gap: 24px; }
          .tss-slide { width: 252px; }
          .tss-device { border-radius: 24px; padding: 6px; }
          .tss-device img { border-radius: 19px; }
          .tss-name { font-size: 24px; }
          .tss-arrival { font-size: 17px; }
          .tss-arrows { top: -54px; }
          .tss-notes { margin-top: 30px; }
          .tss-notes li { font-size: 18px; }
          .tss-cta { flex-direction: row; margin-top: 44px; }
          .tss-btn { min-height: 56px; padding: 0 40px; }
          .tss-quote { margin-top: 62px; padding-top: 44px; }
          .tss-quote blockquote { font-size: 36px; max-width: 22ch; margin: 0 auto; }

          /* Copy and action side by side, with the action holding its own
             width — a nowrap button in a shrinking track is the second-largest
             source of overflow in this codebase. */
          .tss-comm {
            flex-direction: row;
            align-items: center;
            justify-content: space-between;
            gap: 44px;
            padding: 34px 38px;
            margin-top: 62px;
          }
          .tss-comm__act { align-items: flex-end; }
          .tss-comm__title { font-size: 27px; }
          .tss-comm__body { font-size: 14.5px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .tss-btn, .tss-comm__btn, .tss-device, .tss-arrow { transition: none; }
          .tss-rail { scroll-behavior: auto; }
        }
      `}</style>
    </section>
  );
}
