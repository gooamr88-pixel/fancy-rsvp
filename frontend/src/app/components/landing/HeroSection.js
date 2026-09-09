"use client";

import React from "react";
import Link from "next/link";
import { useAuth } from "../../hooks/useAuth";
import { useLandingStats, formatStatValue } from "../../utils/useLandingStats";
import { C, T, SHADOW, BEZEL, ON_PHOTO } from "./landingTokens";

/* ═══════════════════════════════════════════════════════════════════════════
   THE HERO.

   ── The 2026-09-09 pass: the hero is a photograph now ─────────────────────

   It was warm paper with two screenshots standing on it, and it was correct.
   What it was not was ATMOSPHERIC — the first screen of a business that sells
   an evening looked like the first screen of a business that sells software,
   and the invitation had to carry the whole mood from inside a bezel 36% of
   the width of the page.

   Three things changed, and the first is the only one that matters:

   1. THE BAND IS A PHOTOGRAPH. /images/landing/hero-bg.webp is our own Door of
      Joy plate (public/templates/bab/hero-poster.jpg — licensed, already
      shipped, already used by that template) cropped and blurred to a depth of
      field. Blurred on purpose and not for weight: the invitation is the only
      thing in this frame allowed to be sharp, and a photograph that competes
      with the object standing in front of it is a busy hero rather than a
      composed one. It is 30KB, which is less than the two screenshots it
      replaced.

   2. ONE INVITATION, NOT TWO. The sealed-and-opened pair said what the product
      does in one glance, and it is still said — one band further down, where
      the whole section is about what opening one feels like. Here there is a
      single object under a single light, which is what a photograph of
      something for sale looks like.

   3. THE NUMBERS MOVED TO THE END. Three statistics under the fold's buttons
      is a lot of arithmetic for somebody who has been on the site for four
      seconds. One line here; the full set closes the page, next to the same
      two buttons, where a reader who has read everything is actually weighing
      it up.

   MOBILE FIRST. The base rules are the phone; the only media query steps UP at
   768. The order on a phone is claim, object, action — the buttons sit under
   the invitation because that is the order the eye travels. At desktop the
   copy and the action share the left column and the invitation takes the
   right, which is why they are three separate blocks in the markup.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Ours, both of them.
 *
 *  `photo` is the licensed Door of Joy artwork, blurred (see the header).
 *  `sealed` is a real screenshot of the shipping Swan Lake template, produced
 *  by test/shots/templateShots.dump.jsx — so a redesign of the template cannot
 *  leave a stale picture on the front page. */
const ART = {
  photo: "/images/landing/hero-bg.webp",
  sealed: "/images/landing/cover-swans.webp",
};

function TrustLine() {
  const { stats } = useLandingStats();
  const first = stats[0];
  if (!first) return null;

  /* ONE STATISTIC, in a sentence, rather than three in a grid.
     The grid moved to the closing band. Which one is shown is not hardcoded:
     it is whichever the backend returns first, formatted by the same helper
     the rest of the site uses, so an admin reordering them in
     super_admin_config.landing_stats changes this line too. */
  return (
    <p className="hero-trust">
      <span className="hero-trust__n">{formatStatValue(first)}</span>
      <span className="hero-trust__label">{first.label.toLowerCase()} worldwide</span>
    </p>
  );
}

/**
 * The invitation, sealed, standing in the photograph.
 *
 * `width`/`height` are declared so the box reserves its height before the file
 * arrives. Without it the headline jumps on load, and the hero is the one
 * place on the site where that is guaranteed to be noticed.
 */
function HeroArt() {
  return (
    <figure className="hero-art">
      <div className="hero-art__row">
        {/* The ground the object stands on. Without a contact shadow a
            floating rectangle reads as a sticker. */}
        <span aria-hidden="true" className="hero-art__ground" />

        <span className="hero-art__obj">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={ART.sealed}
            alt="A Fancy RSVP invitation before it is opened: an olive envelope closed with an ivory wax seal, the couple's names beneath it."
            width={468}
            height={1013}
            fetchPriority="high"
          />
        </span>
      </div>

      <figcaption>Swan Lake — sealed, on a guest&rsquo;s phone</figcaption>
    </figure>
  );
}

export default function HeroSection() {
  const { isLoggedIn, loading } = useAuth();
  const signedIn = !loading && isLoggedIn;

  return (
    <section id="hero" className="hero">
      {/* THE PHOTOGRAPH, as an <img> rather than a CSS background.
          A background-image cannot carry fetchPriority, cannot be preloaded by
          the browser's scanner, and has no alt to suppress — so the one image
          on the page that decides the LCP would be the one the browser finds
          last. It is decorative, so the alt is empty and the figure is hidden
          from assistive tech. */}
      <div className="hero__photo" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ART.photo} alt="" width={1400} height={900} fetchPriority="high" />
        <span className="hero__scrim" />
      </div>

      <div className="hero-grid fx-container fx-container--5xl fx-gutter">
        <div className="hero-copy">
          <span className="hero-eyebrow">
            More than an invitation
            <span aria-hidden="true" className="hero-eyebrow__rule" />
          </span>

          {/* No <br>. A max-width in ch lets the line break where it actually
              fits at every width, instead of forcing a break that the browser
              then breaks again into four ragged lines. */}
          <h1 className="hero-headline">
            Your guests don&rsquo;t get a link. They get an <em>arrival</em>.
          </h1>

          {/* NAMES THE WHOLE PRODUCT, not just the picture beside it. The
              headline sells the arrival, which is the right thing to sell
              first — but a reader who stops here should already know this is
              not only an invitation. Replies, meals, seating and the door, in
              that order, because that is the order the work happens in. */}
          {/* NAMES THE WHOLE PRODUCT IN ONE LINE, and it is one line on
              purpose. This ran to four lines at 390px, which — under a
              three-line headline and above a photograph of a phone — put the
              primary button 880px down a 844px screen. Every word that went is
              said again, with a picture, in the bands below. */}
          <p className="hero-sub">
            It opens on film. Behind it sits the whole event — the replies, the
            meals, the seating chart and the door.
          </p>
        </div>

        <HeroArt />

        <div className="hero-act">
          {/* ── TWO DOORS, AND THE ORDER IS THE WHOLE FUNNEL ────────────────
              The demo proves the product in a minute. It does not create a
              reason to stay: a visitor who finishes it has admired something.
              A visitor who spends an evening putting their own guest list,
              their own invitation and their own seating chart into Fancy has
              moved in, and a week later the cost of leaving is their own work
              rather than our argument.

              So the trial leads and the demo follows — for the visitor who is
              not ready to hand over an email address yet, which is a real and
              common state and not one to punish.

              The primary label names the PRICE, not the product. "Create your
              event" is an instruction; "free for 7 days" is the answer to the
              question actually stopping them, and putting it inside the button
              means they never have to go looking for it.

              A signed-in organizer is the exception: they have already bought
              the argument and want their own event. */}
          <div className="hero-buttons">
            {signedIn ? (
              <>
                <Link href="/dashboard" className="hero-btn hero-btn--gold" id="hero-cta-get-started">
                  Go to dashboard
                </Link>
                <Link href="/demo/invitation" className="hero-btn hero-btn--ghost" id="hero-cta-demo">
                  <span aria-hidden="true" className="hero-btn__play" />
                  Explore a live invitation
                </Link>
              </>
            ) : (
              <>
                <Link href="/register" className="hero-btn hero-btn--gold" id="hero-cta-get-started">
                  {/* Split so the phone can break the line between the action
                      and the price instead of shrinking the whole label —
                      "CREATE YOUR EVENT — FREE FOR 7 DAYS" at 0.2em tracking
                      does not fit 280px on one line, and nowrap on .hero-btn
                      means it would not wrap, it would overflow. */}
                  <span className="hero-btn__do">Create your event</span>
                  <span className="hero-btn__price">Free for 7 days</span>
                </Link>
                <Link href="/demo/invitation" className="hero-btn hero-btn--ghost" id="hero-cta-demo">
                  <span aria-hidden="true" className="hero-btn__play" />
                  Explore a live invitation
                </Link>
              </>
            )}
          </div>

          <p className="hero-reassure">
            No card needed · Your invitation stays live when the trial ends
          </p>

          <TrustLine />
        </div>
      </div>

      {/* ONE PLAIN STYLE ELEMENT, for the whole component.

          Two separate reasons, both of which this repo has already paid for:

          1. A <style jsx> block inside a NESTED, non-default-export component
             does not reliably compile in this build. AGENTS.md names the two
             cases that proved it (FooterLink, PrintPreviewModal) and both had
             to be moved out. TrustLine and HeroArt in this file are exactly
             that pattern.

          2. styled-jsx stamps its hash class only onto lowercase intrinsic
             elements, so a scoped rule aimed at a class on a next/link
             compiles to .foo.jsx-hash and matches NOTHING. That is the bug
             that made every alert on this platform invisible.

          A plain <style> has neither failure mode. The scoping it gives up is
          replaced by a prefix on every class name. */}
      <style>{`
        .hero {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          /* The band's declared tone. Nothing sees it once the photograph has
             decoded — it is what the first paint and a failed image show, and
             a hero that flashes white before a dark picture is worse than one
             that never flashes at all. */
          background: ${C.paper};
          padding: 34px 0 48px;
        }

        /* ── the photograph ─────────────────────────────────────────────── */
        .hero__photo {
          position: absolute;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          background: #241C12;
        }
        .hero__photo img {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
          /* On a phone the frame is portrait and the crop takes the middle of
             a landscape file: 62% keeps the lit archway behind the invitation
             rather than the paving at the bottom of it. */
          object-position: 50% 62%;
        }
        .hero__scrim {
          position: absolute;
          inset: 0;
          /* Three stops, not one flat wash. A single 62% wash over the whole
             frame kills the light that is the reason for using this picture;
             this leaves the middle bright and puts the weight where the type
             actually sits, top and bottom. */
          /* Four stops, and the middle two are the light. A flat wash over the
             whole frame kills the sunlight that is the reason for using this
             picture at all — the weight belongs at the top and the bottom,
             where the type sits, and nowhere else. */
          background:
            linear-gradient(180deg,
              ${C.scrimEdge} 0%,
              rgba(24, 19, 12, 0.52) 24%,
              rgba(24, 19, 12, 0.34) 48%,
              rgba(20, 16, 10, 0.72) 82%,
              ${C.scrimEdge} 100%);
        }

        .hero-grid {
          position: relative;
          z-index: 2;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        /* ── the claim ──────────────────────────────────────────────────── */
        .hero-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          font-family: ${T.label};
          font-size: 10px;
          letter-spacing: 0.30em;
          text-transform: uppercase;
          color: ${ON_PHOTO.gold};
          /* A three-word label must never wrap onto a second line. */
          white-space: nowrap;
        }
        .hero-eyebrow__rule {
          display: block;
          flex: none;
          width: 28px;
          height: 1px;
          background: ${ON_PHOTO.gold};
          opacity: 0.6;
        }
        .hero-headline {
          font-family: ${T.display};
          font-weight: 300;
          font-size: 47px;
          line-height: 1.02;
          letter-spacing: -0.02em;
          color: ${ON_PHOTO.title};
          margin: 18px 0 0;
          /* Type on a photograph needs a shadow the eye never notices and the
             contrast meter does. Two stops: a tight one for the edge and a
             wide one for the ground under the counters. */
          text-shadow: 0 1px 2px rgba(12, 9, 5, 0.45), 0 14px 40px rgba(12, 9, 5, 0.35);
        }
        .hero-headline em {
          font-style: italic;
          color: ${ON_PHOTO.gold};
        }
        .hero-sub {
          font-size: 15.5px;
          font-weight: 300;
          line-height: 1.8;
          color: ${ON_PHOTO.body};
          margin: 14px 0 0;
          max-width: 46ch;
          text-shadow: 0 1px 3px rgba(12, 9, 5, 0.5);
        }

        /* ── the object ─────────────────────────────────────────────────── */
        .hero-art { margin: 0; }
        .hero-art__row {
          position: relative;
          display: flex;
          justify-content: center;
          align-items: flex-end;
        }
        .hero-art__ground {
          position: absolute;
          left: 18%;
          right: 18%;
          bottom: -12px;
          height: 30px;
          background: radial-gradient(ellipse at 50% 50%, rgba(10, 8, 5, 0.5), transparent 70%);
          filter: blur(8px);
          pointer-events: none;
        }
        /* 214px, not 260. The invitation is 468x1013, so every 10px of width
           here is 22px of hero height — and this is the band whose height
           decides whether the primary button is on the first screen of a
           390x844 phone. At 214 the wax seal and the couple's names are both
           still legible, which is the whole job of the object. */
        .hero-art__obj {
          position: relative;
          display: block;
          width: 55%;
          max-width: 214px;
          border-radius: 24px;
          padding: 5px;
          background: ${BEZEL};
          box-shadow: ${SHADOW.device};
        }
        .hero-art__obj img {
          display: block;
          width: 100%;
          height: auto;
          border-radius: 19px;
        }
        /* BODY, not muted. This caption sits over the LIT middle of the
           photograph on a phone, where the scrim is at its lightest stop —
           the one place on this band where the weakest text colour would be
           reading against sunlight. See ON_PHOTO on why that is a margin
           rather than a measured ratio. */
        .hero-art figcaption {
          margin-top: 20px;
          text-align: center;
          font-size: 9.5px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: ${ON_PHOTO.body};
          text-shadow: 0 1px 3px rgba(12, 9, 5, 0.55);
        }

        /* ── buttons ────────────────────────────────────────────────────────
           Full width and stacked on a phone, and nowrap so a label can never
           break across two lines. Two side-by-side buttons with 0.2em tracking
           do not fit in 342px, and an earlier version silently wrapped both.

           NOTE the quotes above: this whole block is a template literal, so a
           backtick anywhere inside it — including inside a CSS comment —
           terminates the string and produces a parse error. */
        .hero-buttons {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        /* PILLS, like every other button on this page since 2026-09-09. The
           page had four button shapes — square ink, square ghost, underlined
           link, and a round arrow — which is three more than a page needs, and
           the mixture was a real part of why it read as assembled rather than
           designed. There are two now: a filled one for the page's own asks
           and an outlined one for "go and look". */
        .hero-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          min-height: 56px;
          font-family: ${T.body};
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          white-space: nowrap;
          text-decoration: none;
          border-radius: 999px;
          transition: background 0.35s ease, color 0.35s ease, border-color 0.35s ease;
        }
        /* The primary label carries a price on a second line. A COLUMN rather
           than one string: .hero-btn is nowrap (a two-line button label reads
           as a mistake), so a single long label would overflow 320px rather
           than wrap. Two stacked spans keep the nowrap promise per line. */
        .hero-btn__do { display: block; }
        .hero-btn__price {
          display: block;
          margin-top: 3px;
          font-size: 9.5px;
          font-weight: 500;
          letter-spacing: 0.16em;
          opacity: 0.72;
        }
        /* INK ON GOLD, not ivory on ink. The band behind it is already dark,
           and a near-black button on a dark photograph is a hole rather than a
           call to action. */
        .hero-btn--gold {
          flex-direction: column;
          text-align: center;
          padding: 10px 26px;
          background: ${ON_PHOTO.gold};
          color: #221A0C;
          border: 1px solid ${ON_PHOTO.gold};
        }
        .hero-btn--gold:hover { background: ${C.ivory}; border-color: ${C.ivory}; }
        .hero-btn--ghost {
          padding: 0 22px;
          background: rgba(252, 249, 240, 0.06);
          color: ${ON_PHOTO.title};
          border: 1px solid ${ON_PHOTO.hairline};
          /* The glass panel behind the ghost button is what stops it vanishing
             over the lit part of the photograph. */
          backdrop-filter: blur(3px);
        }
        .hero-btn--ghost:hover {
          background: rgba(252, 249, 240, 0.16);
          border-color: ${ON_PHOTO.body};
        }
        /* 320px. The pill is nowrap, so a label it cannot fit overflows rather
           than wraps — see the measured note on .fb-cta in FeatureBand. */
        @media (max-width: 639.98px) {
          .hero-btn { letter-spacing: 0.1em; }
          .hero-btn--ghost { padding: 0 16px; }
        }
        /* A play mark drawn in CSS rather than shipped as an icon: it is three
           borders, and an SVG for a triangle is a request for a triangle. */
        .hero-btn__play {
          display: block;
          flex: none;
          width: 0;
          height: 0;
          border-style: solid;
          border-width: 4.5px 0 4.5px 7px;
          border-color: transparent transparent transparent currentColor;
        }

        .hero-reassure {
          font-size: 11.5px;
          line-height: 1.7;
          color: ${ON_PHOTO.body};
          margin: 16px 0 0;
          text-shadow: 0 1px 3px rgba(12, 9, 5, 0.5);
        }

        /* ── the one number ─────────────────────────────────────────────── */
        .hero-trust {
          display: flex;
          align-items: baseline;
          flex-wrap: wrap;
          gap: 0 10px;
          margin: 20px 0 0;
          padding-top: 18px;
          border-top: 1px solid ${ON_PHOTO.hairline};
        }
        .hero-trust__n {
          font-family: ${T.display};
          font-size: 26px;
          font-weight: 400;
          line-height: 1;
          letter-spacing: -0.01em;
          color: ${ON_PHOTO.title};
          /* A number may shrink; it may never break. */
          white-space: nowrap;
        }
        .hero-trust__label {
          font-size: 10px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: ${ON_PHOTO.body};
          text-shadow: 0 1px 3px rgba(12, 9, 5, 0.5);
        }

        /* ── 768 and up ─────────────────────────────────────────────────── */
        @media (min-width: 768px) {
          .hero { padding: 96px 0 104px; }
          .hero__photo img { object-position: 50% 55%; }
          .hero__scrim {
            background:
              linear-gradient(100deg,
                ${C.scrimEdge} 0%,
                ${C.scrim} 46%,
                rgba(24, 19, 12, 0.34) 100%),
              linear-gradient(180deg, rgba(16, 13, 9, 0.5), transparent 30%);
          }

          /* Copy and action share the left column; the invitation takes the
             right and spans both rows. Three blocks in the markup rather than
             two is what buys this without a second copy of anything. */
          .hero-grid {
            display: grid;
            grid-template-columns: minmax(0, 1.04fr) minmax(0, 0.96fr);
            grid-template-rows: auto auto;
            column-gap: 72px;
            row-gap: 34px;
            align-items: start;
          }
          .hero-copy { grid-column: 1; grid-row: 1; }
          .hero-act { grid-column: 1; grid-row: 2; }
          .hero-art {
            grid-column: 2;
            grid-row: 1 / span 2;
            align-self: center;
          }

          .hero-eyebrow { font-size: 11px; letter-spacing: 0.38em; gap: 16px; }
          .hero-eyebrow__rule { width: 44px; }
          .hero-headline { font-size: 74px; margin-top: 24px; max-width: 12.5ch; }
          .hero-sub { font-size: 18px; margin-top: 20px; }
          .hero-buttons { flex-direction: row; gap: 14px; }
          .hero-btn--ghost { padding: 0 34px; }
          .hero-art__obj { width: 74%; max-width: 320px; }
          .hero-art__ground { bottom: -16px; height: 40px; }
          .hero-art figcaption { margin-top: 26px; font-size: 10px; }
          .hero-trust { margin-top: 26px; }
          .hero-trust__n { font-size: 30px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .hero-btn { transition: none; }
        }
      `}</style>
    </section>
  );
}
