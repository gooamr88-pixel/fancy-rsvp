'use client';

import React from 'react';
import Link from 'next/link';
import { useAuth } from '../../hooks/useAuth';
import { useLandingStats, formatStatValue } from '../../utils/useLandingStats';
import { C, T, ON_INK } from './landingTokens';
import { FAQS } from './faqContent';

/* ═══════════════════════════════════════════════════════════════════════════
   THE LAST OBJECTION, THEN THE BUTTON.

   This replaced `FAQSection.js` (~800px) followed by `CTASection.js` (~500px)
   as two separate bands. A visitor who has read eight bands does not need a
   band break between "here is the answer to your worry" and "here is the
   button" — they are one move.

   The accordion is `<details>`/`<summary>`, not React state. The previous
   version held an openIndex in useState and rebuilt aria-expanded by hand;
   the native element is keyboard-accessible, announces its own state, and
   works before hydration.

   FAQS is imported from faqContent.js rather than declared here. page.js is a
   Server Component, and importing a value from a 'use client' module gives it
   a client reference instead of the array — the production build then dies at
   page-data collection with "FAQS.map is not a function".

   ── 2026-08-20 ────────────────────────────────────────────────────────────

   1. THE RIGHT THIRD WAS EMPTY. The questions column was capped at a reading
      measure and nothing sat beside it, so the band read as a page that had
      run out of things to say. There is now a real panel there — the one place
      on the page that offers a human instead of a signup — which also gives
      the section a second, softer conversion path for someone not ready to
      register.

   2. THE CALL TO ACTION IS THE ONLY DARK SURFACE ON THE PAGE. It used to be a
      full dark band, one of two. As a single ink BLOCK inside a paper band it
      reads as punctuation rather than as a theme switch, which is what lets
      the rest of the page stay light.
   ═══════════════════════════════════════════════════════════════════════════ */

export { FAQS } from './faqContent';

/**
 * The three numbers, at the end rather than in the hero.
 *
 * They used to sit under the fold's buttons, which is a lot of arithmetic for
 * somebody who has been on the site for four seconds. Here they are the last
 * thing before the footer, next to the button, where a reader who has read
 * everything is actually weighing it up — which is the moment a number is
 * worth anything.
 *
 * Every value is real: "events created" and "guests managed" are a server-side
 * COUNT(*), and only "platform uptime" is admin-set. See useLandingStats.
 */
function StatRow() {
  const { stats } = useLandingStats();
  return (
    <ul className="fc-stats">
      {stats.map((s) => (
        <li key={s.label}>
          <strong>{formatStatValue(s)}</strong>
          <span>{s.label}</span>
        </li>
      ))}
    </ul>
  );
}

function Faq({ item, index }) {
  return (
    <details className="faq-item" open={index === 0}>
      <summary>
        <span className="faq-q">{item.q}</span>
        <span className="faq-mark" aria-hidden="true" />
      </summary>
      <div className="faq-a">
        <p>{item.a}</p>
        {item.link && (
          <Link href={item.link.href} className="faq-a-link">{item.link.label}</Link>
        )}
      </div>
    </details>
  );
}

export default function FaqCtaSection() {
  const { isLoggedIn, loading } = useAuth();
  const signedIn = !loading && isLoggedIn;

  return (
    <section className="fc" aria-labelledby="fc-faq-title">
      <div className="fx-container fx-container--5xl fx-gutter">
        <div className="fc-inner">
          {/* ── Answers ── */}
          <div className="fc-faq">
            <span className="fc-kicker">
              Before you ask
              <span aria-hidden="true" className="fc-kicker__rule" />
            </span>
            <span className="fc-numeral" aria-hidden="true">VIII</span>
            <h2 id="fc-faq-title" className="fc-h2">Questions we get.</h2>

            <div className="fc-list">
              {FAQS.map((item, i) => <Faq key={item.q} item={item} index={i} />)}
            </div>

            <p className="fc-more">
              Something not covered?{' '}
              <Link href="/help" className="fc-inline-link">Help centre</Link>
              {' · '}
              <Link href="/contact" className="fc-inline-link">Talk to us</Link>
            </p>
          </div>

          {/* ── A person, for anyone the answers did not settle ── */}
          <aside className="fc-aside">
            <span className="fc-aside__label">Still deciding</span>
            <h3 className="fc-aside__title">
              Talk to someone who has run the night before.
            </h3>
            <p className="fc-aside__body">
              We will look at your guest count, your venue and your dates, and
              tell you plainly which plan fits — or that you do not need one yet.
            </p>
            <div className="fc-aside__actions">
              <Link href="/contact" className="fc-btn fc-btn--ink">Talk to us</Link>
              <a href="mailto:info@fancyrsvp.com" className="fc-btn fc-btn--ghost">Email instead</a>
            </div>
            <p className="fc-aside__note">Typically answered the same working day.</p>
          </aside>
        </div>

        {/* ── The ask ── */}
        <div className="fc-cta">
          <span aria-hidden="true" className="fc-cta__glow" />
          <div className="fc-cta__inner">
            <span className="fc-orn" aria-hidden="true">
              <svg width="34" height="29" viewBox="0 0 38 32" fill="none">
                <rect x="2" y="8" width="34" height="22" stroke={C.gold} strokeWidth="1.3" />
                <path d="M2 10L19 22L36 10" stroke={C.gold} strokeWidth="1.3" strokeLinejoin="round" />
                <path d="M4 8L19 0L34 8" stroke={C.gold} strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
            </span>

            <h2 className="fc-cta__title">Start with your first event.</h2>
            <p className="fc-cta__body">
              Build it, see exactly how it will look to a guest, and only pay
              when you are ready to send it.
            </p>

            {/* THE SAME TWO DOORS AS THE HERO, in the same order and with the
                same labels. A reader who has come this far has read eight
                bands; offering them a different pair of choices here than the
                one they were offered at the top makes them re-decide rather
                than decide. "See pricing" moved into the line under them,
                which is where somebody looks for it once they have already
                been told the price is nothing for a week. */}
            <div className="fc-cta__actions">
              <Link href={signedIn ? '/dashboard' : '/register'} className="fc-btn fc-btn--ivory fc-btn--stack">
                {signedIn ? (
                  'Go to dashboard'
                ) : (
                  <>
                    <span className="fc-btn__do">Create your event</span>
                    <span className="fc-btn__price">Free for 7 days</span>
                  </>
                )}
              </Link>
              <Link href="/demo/invitation" className="fc-btn fc-btn--onInk">
                <span aria-hidden="true" className="fc-btn__play" />
                Explore a live invitation
              </Link>
            </div>

            {/* Accurate, and each one is checkable: the trial runs 7 days from
                the moment the event is published, it takes no card, and on day
                8 the event stays live on the free plan rather than going dark.
                See services/trialExpiry.js and utils/tierResolver.js. */}
            <ul className="fc-assure">
              <li>No credit card</li>
              <li>Your event stays live afterwards</li>
              <li><Link href="/pricing" className="fc-assure__link">See pricing</Link></li>
            </ul>

            <StatRow />
          </div>
        </div>
      </div>

      {/* A PLAIN style element, not <style jsx>.

          styled-jsx stamps its hash class only onto lowercase intrinsic
          elements, so every rule aimed at a class on a next/link here would
          compile to .fc-btn.jsx-hash and match nothing — which is the bug that
          made this platform's alerts invisible in production. Classes are
          prefixed "fc-" and "faq-" instead.

          No backticks inside these CSS comments: one would end the template
          literal and produce a parse error. */}
      <style>{`
        .fc {
          position: relative;
          width: 100%;
          background: ${C.paper};
          padding: 76px 0;
        }
        .fc-inner {
          display: flex;
          flex-direction: column;
          gap: 44px;
        }

        .fc-kicker {
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
        .fc-kicker__rule {
          display: block;
          flex: none;
          width: 28px;
          height: 1px;
          background: ${C.gold};
          opacity: 0.55;
        }
        .fc-numeral {
          font-family: ${T.display};
          font-style: italic;
          font-size: 13px;
          color: ${C.goldInk};
          opacity: 0.75;
          float: right;
        }
        .fc-h2 {
          font-family: ${T.display};
          font-weight: 300;
          font-size: 37px;
          line-height: 1.07;
          letter-spacing: -0.015em;
          color: ${C.ink};
          margin: 18px 0 0;
        }

        /* ── the accordion ─────────────────────────────────────────────── */
        .fc-list { margin-top: 30px; }
        .faq-item { border-top: 1px solid ${C.border}; }
        .faq-item:last-child { border-bottom: 1px solid ${C.border}; }
        .faq-item summary {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          padding: 20px 0;
          cursor: pointer;
          list-style: none;
        }
        .faq-item summary::-webkit-details-marker { display: none; }
        .faq-q {
          font-family: ${T.display};
          font-size: 21px;
          font-weight: 400;
          line-height: 1.3;
          color: ${C.ink};
          min-width: 0;
        }
        /* The plus/minus is drawn with two spans rather than an icon font so it
           can animate to a minus without swapping any markup. */
        .faq-mark {
          position: relative;
          flex: none;
          width: 14px;
          height: 14px;
          margin-top: 7px;
        }
        .faq-mark::before, .faq-mark::after {
          content: "";
          position: absolute;
          background: ${C.gold};
        }
        .faq-mark::before { left: 0; top: 6.5px; width: 14px; height: 1px; }
        .faq-mark::after {
          left: 6.5px; top: 0; width: 1px; height: 14px;
          transition: opacity 0.25s ease, transform 0.25s ease;
        }
        .faq-item[open] .faq-mark::after { opacity: 0; transform: rotate(90deg); }

        .faq-a { padding: 0 0 20px; }
        .faq-a p {
          font-size: 13.5px;
          font-weight: 300;
          line-height: 1.8;
          color: ${C.inkSoft};
          margin: 0;
          max-width: 66ch;
        }
        .faq-a-link {
          display: inline-block;
          margin-top: 12px;
          font-size: 10.5px;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: ${C.ink};
          text-decoration: none;
          border-bottom: 1px solid ${C.gold};
          padding-bottom: 5px;
        }
        .fc-more {
          margin: 24px 0 0;
          font-size: 13px;
          font-weight: 300;
          color: ${C.inkSoft};
        }
        .fc-inline-link {
          color: ${C.ink};
          text-decoration: none;
          border-bottom: 1px solid ${C.gold};
          padding-bottom: 2px;
        }

        /* ── the panel ─────────────────────────────────────────────────── */
        .fc-aside {
          border: 1px solid ${C.border};
          background: ${C.paper2};
          padding: 32px 24px 34px;
        }
        .fc-aside__label {
          font-family: ${T.label};
          font-size: 10px;
          letter-spacing: 0.3em;
          text-transform: uppercase;
          color: ${C.goldInk};
        }
        .fc-aside__title {
          font-family: ${T.display};
          font-size: 25px;
          font-weight: 400;
          line-height: 1.22;
          color: ${C.ink};
          margin: 16px 0 0;
        }
        .fc-aside__body {
          font-size: 13.5px;
          font-weight: 300;
          line-height: 1.8;
          color: ${C.inkSoft};
          margin: 12px 0 0;
        }
        .fc-aside__actions {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 26px;
        }
        .fc-aside__note {
          margin: 18px 0 0;
          font-size: 11px;
          color: ${C.inkSoft};
          opacity: 0.75;
        }

        /* ── buttons ───────────────────────────────────────────────────── */
        .fc-btn {
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
        /* The primary label carries a price on a second line — the same
           arrangement the hero uses, and for the same reason: .fc-btn is
           nowrap, so one long label would overflow 320px rather than wrap. */
        .fc-btn--stack { flex-direction: column; padding: 10px 26px; }
        .fc-btn__do { display: block; }
        .fc-btn__price {
          display: block;
          margin-top: 3px;
          font-size: 9.5px;
          font-weight: 500;
          letter-spacing: 0.16em;
          opacity: 0.7;
        }
        .fc-btn__play {
          display: block;
          flex: none;
          margin-right: 10px;
          width: 0;
          height: 0;
          border-style: solid;
          border-width: 4.5px 0 4.5px 7px;
          border-color: transparent transparent transparent currentColor;
        }
        .fc-btn--ink { background: ${C.ink}; color: ${C.paper}; border: 1px solid ${C.ink}; }
        .fc-btn--ink:hover { background: transparent; color: ${C.ink}; }
        .fc-btn--ghost { background: ${C.paper}; color: ${C.ink}; border: 1px solid ${C.border}; }
        .fc-btn--ghost:hover { border-color: ${C.ink}; }
        .fc-btn--ivory { background: ${C.ivory}; color: ${C.ink}; border: 1px solid ${C.ivory}; }
        .fc-btn--ivory:hover { background: transparent; color: ${C.ivory}; }
        .fc-btn--onInk { background: transparent; color: ${C.ivory}; border: 1px solid ${ON_INK.hairline}; }
        .fc-btn--onInk:hover { background: ${C.ivory}; color: ${C.ink}; border-color: ${C.ivory}; }

        /* ── the one dark block on the page ────────────────────────────── */
        .fc-cta {
          position: relative;
          overflow: hidden;
          background: ${C.ink};
          color: ${ON_INK.title};
          margin-top: 62px;
          padding: 56px 24px 58px;
          text-align: center;
        }
        .fc-cta__glow {
          position: absolute;
          top: -40%;
          left: 50%;
          transform: translateX(-50%);
          width: 150%;
          height: 150%;
          background: radial-gradient(ellipse at 50% 50%, rgba(169, 138, 78, 0.22), transparent 62%);
          pointer-events: none;
        }
        .fc-cta__inner { position: relative; z-index: 2; }
        .fc-orn { display: block; }
        .fc-orn svg { margin: 0 auto; }
        .fc-cta__title {
          font-family: ${T.display};
          font-weight: 300;
          font-size: 35px;
          line-height: 1.08;
          letter-spacing: -0.015em;
          color: ${ON_INK.title};
          margin: 22px 0 0;
        }
        .fc-cta__body {
          font-size: 14.5px;
          font-weight: 300;
          line-height: 1.82;
          color: ${ON_INK.body};
          margin: 14px auto 0;
          max-width: 48ch;
        }
        .fc-cta__actions {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 30px;
        }
        .fc-assure {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 8px 22px;
          margin: 24px 0 0;
          padding: 0;
          list-style: none;
          font-size: 10.5px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: ${ON_INK.muted};
        }
        .fc-assure__link {
          color: ${ON_INK.body};
          text-decoration: none;
          border-bottom: 1px solid ${ON_INK.hairline};
          padding-bottom: 2px;
        }
        .fc-assure__link:hover { color: ${C.ivory}; border-color: ${C.ivory}; }

        /* ── the three numbers ──────────────────────────────────────────────
           A GRID of three equal tracks, not a wrapping flex row. A flex row
           wraps 2 + 1 at 390px and leaves "99.9% uptime" orphaned on its own
           line, which reads as a mistake rather than as a third statistic.
           Three equal tracks cannot do that at any width. */
        .fc-stats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          margin: 40px 0 0;
          padding: 30px 0 0;
          list-style: none;
          border-top: 1px solid ${ON_INK.hairline};
        }
        .fc-stats li { min-width: 0; padding: 0 6px; }
        .fc-stats li + li { border-left: 1px solid ${ON_INK.hairline}; }
        .fc-stats strong {
          display: block;
          font-family: ${T.display};
          /* FLUID, and nowrap. Three equal tracks inside a 320px viewport are
             about 85px each, and "50,000+" set at a flat 28px is wider than
             that — so it wrapped to "50,00 / 0+", which reads as a different
             number rather than as a tight fit. A number may shrink; it may
             never break. */
          font-size: clamp(19px, 6.6vw, 30px);
          white-space: nowrap;
          font-weight: 400;
          line-height: 1;
          letter-spacing: -0.01em;
          color: ${ON_INK.title};
        }
        .fc-stats span {
          display: block;
          margin-top: 8px;
          font-size: 9px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          line-height: 1.5;
          color: ${ON_INK.muted};
        }

        /* ── 768 and up ────────────────────────────────────────────────── */
        @media (min-width: 768px) {
          .fc { padding: 128px 0; }
          .fc-inner {
            display: grid;
            grid-template-columns: minmax(0, 1.42fr) minmax(0, 0.58fr);
            gap: 80px;
            align-items: start;
          }
          .fc-kicker { font-size: 11px; letter-spacing: 0.38em; gap: 16px; }
          .fc-kicker__rule { width: 44px; }
          .fc-numeral { font-size: 15px; }
          .fc-h2 { font-size: 58px; margin-top: 22px; }
          .fc-list { margin-top: 40px; }
          .faq-item summary { padding: 24px 0; }
          .faq-q { font-size: 24px; }
          .faq-a { padding-bottom: 24px; }
          .faq-a p { font-size: 14.5px; }
          .fc-aside { padding: 40px 36px 42px; }
          .fc-aside__title { font-size: 28px; }
          .fc-aside__body { font-size: 14.5px; }
          .fc-cta { margin-top: 96px; padding: 96px 72px; }
          .fc-cta__title { font-size: 52px; margin-top: 28px; }
          .fc-cta__body { font-size: 17px; margin-top: 18px; }
          .fc-cta__actions { flex-direction: row; justify-content: center; gap: 14px; margin-top: 38px; }
          .fc-btn--stack { padding: 10px 34px; }
          .fc-stats { max-width: 620px; margin: 48px auto 0; padding-top: 34px; }
          .fc-stats strong { font-size: clamp(26px, 2.4vw, 32px); }
          .fc-stats span { font-size: 9.5px; }
          .fc-btn { min-height: 60px; padding: 0 40px; }
          .fc-aside__actions .fc-btn { padding: 0 24px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .fc-btn, .faq-mark::after { transition: none; }
        }
      `}</style>
    </section>
  );
}
