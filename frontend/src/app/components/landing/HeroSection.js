"use client";

import React from "react";
import Link from "next/link";
import { useAuth } from "../../hooks/useAuth";
import { useLandingStats, formatStatValue } from "../../utils/useLandingStats";
import { C, T, SHADOW, BEZEL } from "./landingTokens";

/* ═══════════════════════════════════════════════════════════════════════════
   THE HERO.

   ── The 2026-08-20 pass ───────────────────────────────────────────────────

   The previous hero put a pale admin dashboard screenshot on a flat ground
   with a phone overlapping it. Three things were wrong with that picture, and
   all three are why it read as a template:

   1. THE ART HAD NO EDGES. A raw crop bled into the background, so it looked
      like a screengrab someone had pasted in rather than a thing you could
      pick up. Both invitations now sit in a dark bezel with a long shadow and
      a contact shadow on the ground beneath them — they are OBJECTS.

   2. IT LED WITH THE DASHBOARD. The least aspirational asset we own was the
      first thing a visitor saw, on the one screen where the product has to
      look desirable. The dashboard now appears in its own band further down,
      where "what do I get" is the question actually being asked. The hero
      shows what the GUEST gets.

   3. THE HEADLINE WAS SET IN A CAPITALS-ONLY FACE. `--font-serif` is Aboreto.
      A nine-word sentence in it is a nine-word sentence in capitals, at a
      weight the font does not ship. See landingTokens.js — the display face
      is now Cormorant Garamond, which has a lowercase and an italic.

   The two invitations are the SAME invitation, sealed and open, which says
   what the product does in one glance and needs no caption to explain — though
   it gets one anyway, because naming the template is worth a line.

   MOBILE FIRST. The base rules here are the phone; the only media query steps
   UP at 768. The previous version was written at desktop with a phone override
   bolted on, and every button label wrapped onto two lines at 390px.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Both are real screenshots of the shipping Swan Lake template, produced by
 *  test/shots/landingShots.dump.jsx — so a redesign of the template cannot
 *  leave a stale picture on the front page. */
const ART = {
  sealed: "/images/landing/cover-swans.webp",
  opened: "/images/landing/hero-swans.webp",
};

function TrustLine() {
  const { stats } = useLandingStats();

  /* A GRID of three equal tracks, not a wrapping flex row. The old flex row
     wrapped 2 + 1 at 390px and left "99.9% uptime" orphaned on its own line,
     which reads as a mistake rather than as a third statistic. Three equal
     tracks cannot do that at any width. */
  return (
    <ul className="hero-trust">
      {stats.map((s) => (
        <li key={s.label}>
          <strong>{formatStatValue(s)}</strong>
          <span>{s.label}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The invitation, sealed and open.
 *
 * `width`/`height` are declared on both images so the box reserves its height
 * before either file arrives. Without it the headline jumps on load, and the
 * hero is the one place on the site where that is guaranteed to be noticed.
 */
function HeroArt() {
  return (
    <figure className="hero-art">
      <div className="hero-art__row">
        {/* The ground the objects stand on. Without a contact shadow two
            floating rectangles read as stickers. */}
        <span aria-hidden="true" className="hero-art__ground" />

        <span className="hero-art__obj hero-art__obj--sealed">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={ART.sealed}
            alt="A Fancy RSVP invitation before it is opened: an olive envelope closed with an ivory wax seal."
            width={468}
            height={1013}
            fetchPriority="high"
          />
        </span>

        <span className="hero-art__obj hero-art__obj--opened">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={ART.opened}
            alt="The same invitation open on a phone, showing the couple's names, the date and a button to save the invitation."
            width={468}
            height={1013}
            fetchPriority="high"
          />
        </span>
      </div>

      <figcaption>Swan Lake — sealed, and opened</figcaption>
    </figure>
  );
}

export default function HeroSection() {
  const { isLoggedIn, loading } = useAuth();
  const signedIn = !loading && isLoggedIn;

  return (
    <section id="hero" className="hero">
      {/* The warm light behind the objects. Decorative, so it is hidden from
          assistive tech and sits under everything. */}
      <span aria-hidden="true" className="hero__glow" />

      <div className="hero-grid fx-container fx-container--5xl fx-gutter">
        <div className="hero-copy">
          <span className="hero-eyebrow">
            Invitations · RSVPs · Seating
            <span aria-hidden="true" className="hero-eyebrow__rule" />
          </span>

          {/* No <br>. A max-width in ch lets the line break where it actually
              fits at every width, instead of forcing a break that the browser
              then breaks again into four ragged lines. */}
          <h1 className="hero-headline">
            Your guests don&rsquo;t get a link. They get an <em>arrival</em>.
          </h1>

          {/* NAMES THE WHOLE PRODUCT, not just the picture above it. The
              headline sells the arrival, which is the right thing to sell
              first — but a reader who stops here should already know this is
              not only an invitation. Replies, meals, seating and the door,
              in that order, because that is the order the work happens in. */}
          <p className="hero-sub">
            Every invitation opens on film. Behind it sits the whole event —
            the replies, the meal counts, the seating chart, and the scanner at
            the door.
          </p>

          {/* ── The demo is the PRIMARY action, and that is the argument ──
              This page spends its whole length insisting the product is an
              experience rather than software. The button that follows that
              claim should therefore be the experience, not a signup form —
              and "Open the invitation" is a promise the very next screen
              keeps in about two seconds, which "Try Fancy" is not: it is a
              software verb, and it asks for effort without saying how much.

              A signed-in organizer is the exception. They have already
              bought the argument; what they want is their own event. */}
          <div className="hero-buttons">
            {signedIn ? (
              <>
                <Link href="/dashboard" className="hero-btn hero-btn--ink" id="hero-cta-get-started">
                  Go to dashboard
                </Link>
                <Link href="/demo/invitation" className="hero-btn hero-btn--ghost" id="hero-cta-demo">
                  Open the invitation
                </Link>
              </>
            ) : (
              <>
                <Link href="/demo/invitation" className="hero-btn hero-btn--ink" id="hero-cta-demo">
                  Open the invitation
                </Link>
                <Link href="/register" className="hero-btn hero-btn--ghost" id="hero-cta-get-started">
                  Create your event
                </Link>
              </>
            )}
          </div>

          <p className="hero-reassure">
            The demo is real and takes a minute · No signup · Free plan to start
          </p>

          <TrustLine />
        </div>

        <HeroArt />
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
          overflow: hidden;
          background: ${C.paper};
          padding: 62px 0 76px;
        }
        .hero__glow {
          position: absolute;
          top: 38%;
          left: 50%;
          transform: translateX(-50%);
          width: 160%;
          height: 56%;
          background: radial-gradient(ellipse at 50% 50%,
            rgba(169, 138, 78, 0.17), rgba(169, 138, 78, 0.05) 46%, transparent 72%);
          pointer-events: none;
        }
        .hero-grid {
          position: relative;
          z-index: 2;
          display: flex;
          flex-direction: column;
          gap: 52px;
        }

        /* ── the claim ─────────────────────────────────────────────────── */
        .hero-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          font-family: ${T.label};
          font-size: 10px;
          letter-spacing: 0.30em;
          text-transform: uppercase;
          color: ${C.goldInk};
          /* A two-word label must never wrap onto a second line. */
          white-space: nowrap;
        }
        .hero-eyebrow__rule {
          display: block;
          flex: none;
          width: 28px;
          height: 1px;
          background: ${C.gold};
          opacity: 0.55;
        }
        .hero-headline {
          font-family: ${T.display};
          font-weight: 300;
          font-size: 47px;
          line-height: 1.02;
          letter-spacing: -0.02em;
          color: ${C.ink};
          margin: 18px 0 0;
        }
        .hero-headline em {
          font-style: italic;
          color: ${C.gold};
        }
        .hero-sub {
          font-size: 15.5px;
          font-weight: 300;
          line-height: 1.85;
          color: ${C.inkSoft};
          margin: 14px 0 0;
          max-width: 46ch;
        }

        /* ── buttons ───────────────────────────────────────────────────────
           Full width and stacked on a phone, and "nowrap" so a label can never
           break across two lines. Two side-by-side buttons with 0.2em tracking
           do not fit in 342px, and the previous version silently wrapped both
           of them.

           NOTE the quotes above: this whole block is a template literal, so a
           backtick anywhere inside it — including inside a CSS comment —
           terminates the string and produces a parse error, not a style bug. */
        .hero-buttons {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 30px;
        }
        .hero-btn {
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
        .hero-btn--ink {
          background: ${C.ink};
          color: ${C.paper};
          border: 1px solid ${C.ink};
        }
        .hero-btn--ink:hover { background: transparent; color: ${C.ink}; }
        .hero-btn--ghost {
          background: transparent;
          color: ${C.ink};
          border: 1px solid ${C.border};
        }
        .hero-btn--ghost:hover { background: ${C.ink}; border-color: ${C.ink}; color: ${C.paper}; }

        .hero-reassure {
          font-size: 11.5px;
          line-height: 1.7;
          color: ${C.inkSoft};
          opacity: 0.75;
          margin: 18px 0 0;
        }

        /* ── the numbers ───────────────────────────────────────────────── */
        .hero-trust {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          margin: 32px 0 0;
          padding: 0;
          list-style: none;
          border-top: 1px solid ${C.border};
        }
        .hero-trust li {
          padding: 18px 10px 0 0;
          min-width: 0;
        }
        .hero-trust li + li {
          border-left: 1px solid ${C.border};
          padding-left: 14px;
        }
        .hero-trust strong {
          display: block;
          font-family: ${T.display};
          /* FLUID, and nowrap. Three equal tracks inside a 320px viewport are
             about 93px each, and "50,000+" set at a flat 28px is wider than
             that — so it wrapped to "50,00 / 0+", which reads as a different
             number rather than as a tight fit. A number may shrink; it may
             never break. */
          font-size: clamp(20px, 7.2vw, 28px);
          white-space: nowrap;
          font-weight: 400;
          line-height: 1;
          letter-spacing: -0.01em;
          color: ${C.ink};
        }
        .hero-trust span {
          display: block;
          margin-top: 8px;
          font-size: 9px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          line-height: 1.5;
          color: ${C.inkSoft};
          opacity: 0.8;
        }

        /* ── the objects ───────────────────────────────────────────────── */
        .hero-art { margin: 0; }
        .hero-art__row {
          position: relative;
          display: flex;
          justify-content: center;
          align-items: flex-end;
          gap: 16px;
        }
        .hero-art__ground {
          position: absolute;
          left: 6%;
          right: 6%;
          bottom: -10px;
          height: 26px;
          background: radial-gradient(ellipse at 50% 50%, rgba(25, 24, 21, 0.22), transparent 70%);
          filter: blur(6px);
          pointer-events: none;
        }
        .hero-art__obj {
          display: block;
          border-radius: 22px;
          padding: 5px;
          background: ${BEZEL};
          box-shadow: ${SHADOW.device};
        }
        .hero-art__obj img {
          display: block;
          width: 100%;
          height: auto;
          border-radius: 17px;
        }
        .hero-art__obj--sealed {
          position: relative;
          z-index: 1;
          width: 36%;
          transform: rotate(-3.5deg) translateY(-16px);
        }
        .hero-art__obj--opened {
          position: relative;
          z-index: 2;
          width: 55%;
        }
        .hero-art figcaption {
          margin-top: 22px;
          text-align: center;
          font-size: 10px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: ${C.inkSoft};
          opacity: 0.72;
        }

        /* ── 768 and up ────────────────────────────────────────────────── */
        @media (min-width: 768px) {
          .hero { padding: 128px 0; }
          .hero__glow {
            top: -20%;
            left: auto;
            right: -6%;
            transform: none;
            width: 66%;
            height: 124%;
          }
          .hero-grid {
            display: grid;
            grid-template-columns: minmax(0, 1.02fr) minmax(0, 0.98fr);
            gap: 80px;
            align-items: center;
          }
          .hero-eyebrow { font-size: 11px; letter-spacing: 0.38em; gap: 16px; }
          .hero-eyebrow__rule { width: 44px; }
          .hero-headline { font-size: 78px; margin-top: 24px; max-width: 12.5ch; }
          .hero-sub { font-size: 18px; margin-top: 18px; }
          .hero-buttons { flex-direction: row; gap: 14px; margin-top: 36px; }
          .hero-btn { min-height: 60px; padding: 0 40px; }
          .hero-trust { margin-top: 40px; max-width: 530px; }
          .hero-trust li { padding: 20px 18px 0 0; }
          .hero-trust li + li { padding-left: 22px; }
          .hero-trust strong { font-size: clamp(28px, 2.6vw, 34px); }
          .hero-trust span { font-size: 9.5px; }
          .hero-art__row { gap: 26px; }
          .hero-art__ground { bottom: -16px; height: 40px; }
          .hero-art__obj { border-radius: 30px; padding: 7px; }
          .hero-art__obj img { border-radius: 24px; }
          .hero-art__obj--sealed { width: 38%; transform: rotate(-3.5deg) translateY(-34px); }
          .hero-art__obj--opened { width: 58%; }
          .hero-art figcaption { margin-top: 30px; font-size: 10.5px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .hero-btn { transition: none; }
        }
      `}</style>
    </section>
  );
}
