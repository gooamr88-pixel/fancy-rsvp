'use client';

/* React itself, not just the hook. This file's JSX is compiled by the test
   runner with esbuild's CLASSIC transform, which emits React.createElement and
   needs React in scope; Next's automatic runtime injects it, so the omission
   is invisible in production and throws the moment a test renders the footer. */
import React, { useState } from 'react';
import Link from 'next/link';
import { C, T } from './landingTokens';
import { COMPANY_NAME, COMPANY_EMAIL, SOCIAL_INSTAGRAM, SOCIAL_FACEBOOK, addressOneLine } from '../../utils/company';
import { SHOP_PATH, SHOP_LABEL } from '../../utils/shopLinks';

/* ═══════════════════════════════════════════════════════════════════════════
   THE FOOTER.

   WHAT WAS WRONG WITH THE OLD ONE

   One six-track grid held everything: the brand blurb, four link lists, and
   the newsletter form. Six tracks inside a 1200px container leaves each about
   170px, so the newsletter's input and its "Subscribe" button shared a column
   narrower than the button's own text — it survived only because that one
   track was given 1.5fr, which then squeezed the four link lists. Below
   1024px the whole thing collapsed to two columns, turning six lists into a
   six-row tower with the newsletter stranded at the bottom.

   It also omitted the things people come to a footer FOR: no email address
   (info@fancyrsvp.com appears on /contact and /careers but not here), no
   physical link to the door app, and no route to the printed cards except
   through the Product list.

   WHAT IT IS NOW

   Three deliberate rows instead of one overloaded grid:

     1. A full-width band: who we are on the left, the newsletter on the
        right. The form finally gets a whole half of the page, so the input
        and button sit side by side at every width down to 320px.
     2. FOUR link columns — Product, Solutions, Company, Support — which fit
        a 1200px container at ~280px each and step 4 → 2 → 1 through .fx-grid
        with no breakpoints to keep in sync.
     3. A bottom bar: copyright, the corporate identity sentence, and social.

   CARRIED OVER DELIBERATELY, DO NOT "SIMPLIFY" BACK:

   • Link colour is an INLINE style, not a scoped `<style jsx>` rule. When
     these were styled by a scoped className on a next/link, the colour rule
     failed to attach in the production Turbopack build and every footer link
     rendered near-black on a near-black background — invisible, and only in
     production. Hover is React state for the same reason.
   • The column layout is driven by a real class, never `nth-child`. The old
     rules targeted `footer > div:nth-child(2) > div:first-child`, so
     inserting anything into the footer silently stopped the mobile collapse
     from applying and left six fixed columns on a 320px phone.
   ═══════════════════════════════════════════════════════════════════════════ */

/* The shared constant, not a fourth copy of the address. This literal sat two
   lines above a legal block that carried the company identity written out by
   hand, which is how the identity ended up needing a repo-wide grep to change. */
const CONTACT_EMAIL = COMPANY_EMAIL;

const footerLinks = {
  Product: [
    /* Both of these were unreachable from the footer, and the second was
       unreachable from anywhere in the chrome. The collection is where the
       invitations live; /demo/invitation is the only place on the site a
       stranger can open one and reply to it. Neither is a support page — they
       are the two strongest pages this product has. */
    { text: 'The Collection', href: '/collection' },
    { text: 'Try the demo', href: '/demo/invitation' },
    { text: 'Features', href: '/features' },
    { text: 'Pricing', href: '/pricing' },
    { text: 'Check-in app', href: '/checkin-app' },
    { text: SHOP_LABEL, href: SHOP_PATH },
    { text: 'Integrations', href: '/integrations' },
  ],
  Solutions: [
    { text: 'For planners', href: '/solutions/planners' },
    { text: 'For venues', href: '/solutions/venues' },
    { text: 'For corporate', href: '/solutions/corporate' },
  ],
  Company: [
    { text: 'About', href: '/about' },
    { text: 'Blog', href: '/blog' },
    { text: 'Careers', href: '/careers' },
    { text: 'Contact', href: '/contact' },
  ],
  Support: [
    { text: 'Help centre', href: '/help' },
    { text: 'Privacy', href: '/privacy' },
    { text: 'Terms', href: '/terms' },
    { text: 'SMS opt-in & consent', href: '/sms-opt-in' },
  ],
};

function FooterLink({ text, href }) {
  // Inline colour, not a scoped rule — see the header. A scoped className on
  // a next/link is exactly the thing that once made this list invisible in
  // production only.
  const [active, setActive] = useState(false);
  return (
    <li>
      <Link
        href={href}
        onMouseEnter={() => setActive(true)}
        onMouseLeave={() => setActive(false)}
        onFocus={() => setActive(true)}
        onBlur={() => setActive(false)}
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: '14px',
          textDecoration: 'none',
          lineHeight: 1.6,
          display: 'inline-block',
          paddingBlock: '5px',
          color: active ? C.goldInk : '#5C574E',
          transition: 'color 0.22s ease',
        }}
      >
        {text}
      </Link>
    </li>
  );
}

function SocialIcon({ children, label, href }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="foot-social"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {children}
      </svg>

    </a>
  );
}

function Newsletter() {
  const [emailValue, setEmailValue] = useState('');
  const [emailFocused, setEmailFocused] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [subscribeError, setSubscribeError] = useState('');

  const handleSubscribe = async () => {
    if (subscribing || subscribed || !emailValue || !emailValue.includes('@')) return;
    setSubscribing(true);
    setSubscribeError('');
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
      const res = await fetch(`${apiUrl}/public/newsletter-subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailValue }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || 'Subscription failed. Please try again.');
      }
      setSubscribed(true);
      setEmailValue('');
    } catch (err) {
      setSubscribeError(err.message || 'Subscription failed. Please try again.');
    } finally {
      setSubscribing(false);
    }
  };

  return (
    <div className="foot-news">
      <h2 className="foot-news__title">Event planning notes, occasionally.</h2>
      <p className="foot-news__body">
        What we have learned running other people&apos;s events, plus what is new
        here. No more than once a month.
      </p>

      <div className="foot-news__row">
        <input
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          aria-label="Email address for the newsletter"
          value={emailValue}
          onChange={(e) => setEmailValue(e.target.value)}
          onFocus={() => setEmailFocused(true)}
          onBlur={() => setEmailFocused(false)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubscribe(); }}
          style={{
            // Inline because the focus ring is React state; keeping the rest
            // of the box here too avoids one property living in each place.
            flex: '1 1 190px',
            minWidth: 0,
            padding: '12px 14px',
            borderRadius: '8px',
            border: `1px solid ${emailFocused ? C.gold : C.border}`,
            background: '#FCFBF8',
            color: '#191815',
            fontFamily: 'var(--font-sans)',
            // 16px, not 13px. Anything under 16px makes iOS Safari ZOOM the
            // whole page on focus and leave it zoomed — the single worst
            // mobile bug this codebase has shipped, fixed across 264 inputs.
            fontSize: '16px',
            outline: 'none',
            transition: 'border-color 0.22s ease',
          }}
        />
        <button
          type="button"
          onClick={handleSubscribe}
          disabled={subscribed || subscribing}
          className={`foot-news__btn${subscribed ? ' foot-news__btn--done' : ''}`}
        >
          {subscribed ? 'Subscribed' : subscribing ? 'Subscribing…' : 'Subscribe'}
        </button>
      </div>

      {subscribeError && <p className="foot-news__err">{subscribeError}</p>}

    </div>
  );
}

export default function FooterSection() {
  return (
    <footer className="foot">
      <div className="gold-shimmer-line" />

      <div className="fx-container fx-container--4xl fx-gutter foot-inner">
        {/* ── 1. Who we are, and the newsletter ── */}
        <div className="foot-top">
          <div className="foot-brand">
            <Link href="/" className="foot-logo" aria-label="Fancy RSVP, home">
              <svg width="26" height="22" viewBox="0 0 38 32" fill="none" aria-hidden="true">
                <rect x="2" y="8" width="34" height="22" rx="2" stroke={C.gold} strokeWidth="2" />
                <path d="M2 10L19 22L36 10" stroke={C.gold} strokeWidth="2" strokeLinejoin="round" />
                <path d="M4 8L19 0L34 8" stroke={C.gold} strokeWidth="2" strokeLinejoin="round" />
              </svg>
              <span className="foot-logo__word">
                <span className="foot-logo__fancy">Fancy</span>
                <span className="foot-logo__rsvp">RSVP</span>
              </span>
            </Link>

            <p className="foot-blurb">
              Digital invitations, guest lists, seating and door check-in for
              weddings and events people remember.
            </p>

            <a href={`mailto:${CONTACT_EMAIL}`} className="foot-mail">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M22 7l-8.97 5.7a2 2 0 0 1-2.06 0L2 7" />
              </svg>
              {CONTACT_EMAIL}
            </a>
          </div>

          <Newsletter />
        </div>

        {/* ── 2. The links: four columns, stepping 4 → 2 → 1 on their own ── */}
        <nav
          className="foot-links fx-grid"
          aria-label="Footer"
          /* 150px, not 210. The four groups hold 16 links between them, and
             at 210px .fx-grid could only fit ONE track on a 390px phone —
             a 900px tower of link text at the bottom of an already long
             page. At 150px the arithmetic is (350 + 28) / 178 = 2.1, so a
             phone gets two columns and a 320px screen still gets one.
             Desktop is unaffected: auto-fit COLLAPSES the tracks it cannot
             fill, so four groups render as four equal columns however many
             tracks would technically fit. */
          style={{ '--fx-col': '150px', '--fx-gap': '28px' }}
        >
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category} className="foot-col">
              <h3 className="foot-col__head">{category}</h3>
              <ul className="foot-col__list">
                {links.map((link) => (
                  <FooterLink key={link.text} text={link.text} href={link.href} />
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* ── 3. Legal and social ── */}
        <div className="foot-bottom">
          <div className="foot-legal">
            <p className="foot-legal__line">
              © {new Date().getFullYear()} {COMPANY_NAME}. All rights reserved.
            </p>
            <p className="foot-legal__fine">
              {COMPANY_NAME} · {addressOneLine()} ·{' '}
              <a href={`mailto:${COMPANY_EMAIL}`}>{COMPANY_EMAIL}</a>
            </p>
          </div>

          <div className="foot-social-row">
            <SocialIcon label={`${COMPANY_NAME} on Instagram`} href={SOCIAL_INSTAGRAM}>
              <rect x="2" y="2" width="20" height="20" rx="5" />
              <circle cx="12" cy="12" r="5" />
              <circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none" />
            </SocialIcon>
            <SocialIcon label={`${COMPANY_NAME} on Facebook`} href={SOCIAL_FACEBOOK}>
              <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3Z" />
            </SocialIcon>
          </div>
        </div>
      </div>


      {/* ONE PLAIN STYLE ELEMENT, for the whole component.

          Two separate reasons, both of which this repo has already paid for:

          1. A <style jsx> block inside a NESTED, non-default-export component
             does not reliably compile in this build. AGENTS.md names the two
             cases that proved it, and one of them is FooterLink IN THIS FILE.
             SocialIcon and Newsletter are the same pattern, and their CSS
             used to live inside them.

          2. styled-jsx stamps its hash class only onto lowercase intrinsic
             elements, so a scoped rule aimed at a class on a next/link
             compiles to .foo.jsx-hash and matches NOTHING. That is the bug
             that made every alert on this platform invisible, and the one
             that made this footer's links unreadable in production.

          A plain <style> has neither failure mode. The scoping it gives up is
          replaced by a prefix on every class name, which is what
          PrintedInvitationsSection already does. */}
      <style>{`
        .foot-social {
          width: 38px;
          height: 38px;
          border-radius: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid ${C.border};
          background: transparent;
          color: rgba(92, 87, 78, 0.8);
          transition: color 0.22s ease, border-color 0.22s ease, background 0.22s ease;
        }
        .foot-social:hover,
        .foot-social:focus-visible {
          color: ${C.goldInk};
          border-color: ${C.gold};
          background: rgba(169, 138, 78, 0.10);
        }

        .foot-news { min-width: 0; }
        .foot-news__title {
          font-family: ${T.display};
          font-size: clamp(19px, 1.083rem + 0.42vw, 23px);
          font-weight: 500;
          line-height: 1.3;
          color: ${C.ink};
          margin: 0;
        }
        .foot-news__body {
          font-family: var(--font-sans);
          font-size: 14px;
          font-weight: 300;
          line-height: 1.65;
          color: ${C.inkSoft};
          margin: 10px 0 0;
          max-width: 44ch;
        }
        /* Wraps rather than nowrap: a non-wrapping flex row's min-content is
           the SUM of its children, so at 320px the input and button together
           could not fit and would push the page sideways. */
        .foot-news__row {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 18px;
          max-width: 440px;
        }
        .foot-news__btn {
          flex: 0 0 auto;
          min-height: var(--fx-touch);
          padding: 12px 22px;
          border-radius: 8px;
          border: none;
          color: ${C.paper};
          font-family: var(--font-sans);
          font-size: 14px;
          font-weight: 700;
          white-space: nowrap;
          cursor: pointer;
          background: ${C.ink};
          transition: box-shadow 0.22s ease, background 0.22s ease;
        }
        .foot-news__btn:disabled { cursor: default; opacity: 0.85; }
        .foot-news__btn:not(:disabled):hover,
        .foot-news__btn:not(:disabled):focus-visible {
          box-shadow: 0 6px 18px rgba(184, 148, 79, 0.38);
        }
        .foot-news__btn--done {
          background: #2E6B33;
          color: #ffffff;
        }
        .foot-news__err {
          font-family: var(--font-sans);
          font-size: 12.5px;
          color: #A33A3A;
          margin: 10px 0 0;
        }
        /* SCOPED to the newsletter row, not a bare "input::placeholder".
           Under styled-jsx the bare selector was safe because the hash
           confined it; in a plain style element it would repaint the
           placeholder of every input on the page white-on-white — the login
           form, the RSVP form, the search box. This is the one selector in
           this block that does not start with a class, and it is why the
           rest of them do. */
        .foot-news__row input::placeholder { color: rgba(92, 87, 78, 0.6); }

        .foot {
          background: ${C.paper3};
          padding: 0;
        }
        .foot-inner { padding-top: clamp(48px, 5vw, 72px); }

        /* ── Row 1 ── */
        .foot-top {
          display: grid;
          gap: clamp(32px, 4vw, 56px);
          padding-bottom: clamp(36px, 4vw, 52px);
          border-bottom: 1px solid ${C.border};
        }
        /* Two columns from md up. The arithmetic at the tight end, 768px:
           the --4xl container is unconstrained there, so the row is
           768 − 2×34px gutter = 700px, less a 32px gap, giving 334px per
           track. The newsletter needs its input (flex-basis 190px) beside its
           Subscribe button (~112px) plus a 10px gap = 312px, which fits with
           22px to spare — and the row wraps rather than overflows if a font
           change eats that margin. Below md they stack.
           768px because AGENTS.md permits exactly four breakpoint values.
           This wanted ~860; 768 is the nearest allowed one that still fits,
           which is why the arithmetic above is written down. */
        @media (min-width: 768px) {
          .foot-top { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
        }
        .foot-brand { min-width: 0; }
        .foot-blurb {
          font-family: var(--font-sans);
          font-size: 14px;
          font-weight: 300;
          line-height: 1.7;
          color: ${C.inkSoft};
          margin: 16px 0 0;
          max-width: 40ch;
        }

        /* ── Row 2 ── */
        .foot-links { padding-block: clamp(36px, 4vw, 52px); }
        .foot-col { min-width: 0; }
        .foot-col__head {
          font-family: var(--font-sans);
          font-size: 11.5px;
          font-weight: 700;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: ${C.ink};
          margin: 0 0 12px;
        }
        .foot-col__list { list-style: none; margin: 0; padding: 0; }

        /* ── Row 3 ── */
        .foot-bottom {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          padding-block: 26px 32px;
          border-top: 1px solid ${C.border};
        }
        .foot-legal { min-width: 0; flex: 1 1 320px; }
        .foot-legal__line {
          font-family: var(--font-sans);
          font-size: 13px;
          color: ${C.inkSoft};
          margin: 0 0 6px;
        }
        .foot-legal__fine {
          font-family: var(--font-sans);
          font-size: 12px;
          line-height: 1.6;
          color: rgba(92, 87, 78, 0.75);
          margin: 0;
          max-width: 62ch;
        }
        .foot-legal__fine a {
          color: ${C.inkSoft};
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .foot-legal__fine a:hover { color: ${C.goldInk}; }
        .foot-social-row { display: flex; gap: 10px; flex-shrink: 0; }

        .foot-logo {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          text-decoration: none;
          line-height: 1;
        }
        .foot-logo__word {
          display: inline-flex;
          align-items: baseline;
          gap: 5px;
          font-family: ${T.display};
          font-size: 23px;
          font-weight: 600;
        }
        .foot-logo__fancy { color: ${C.gold}; font-family: var(--font-script); font-weight: 400; }
        .foot-logo__rsvp { color: #191815; }
        .foot-mail {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-top: 18px;
          min-height: var(--fx-touch);
          font-family: var(--font-sans);
          font-size: 14px;
          font-weight: 500;
          color: ${C.ink};
          text-decoration: none;
          transition: color 0.22s ease;
        }
        .foot-mail:hover, .foot-mail:focus-visible { color: ${C.goldInk}; }
      `}</style>
    </footer>
  );
}
