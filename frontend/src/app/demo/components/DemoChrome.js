'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { installDemoApi, demoApiInstalled } from '../../utils/apiClient';
import { answerFor } from '../fixtures/demoOrganizer.mjs';
import { C, T } from '../../components/landing/landingTokens';

/* ═══════════════════════════════════════════════════════════════════════════
   THE DEMO'S CHROME — and the one place its sample data is switched on.

   ── WHY THE API ROUTER IS INSTALLED HERE ─────────────────────────────────

   Two of the four organizer screens fetch their own data and cannot be fed
   by props: OrganizerOverview asks for /dashboard, and the analytics page
   asks for /events and then /events/:id/analytics. So the demo answers them
   through the slot in utils/apiClient.js rather than by patching
   window.fetch, which is global, shared with every other tab on this origin,
   and impossible to scope.

   Mounting and unmounting with this layout is the FIRST of three guards. The
   second lives in apiClient itself, which re-checks the pathname on every
   call — so a client-side navigation out of /demo stops the router even if
   this effect's cleanup never ran. The third is that `answerFor` declines
   every /public/ path, which is why the shop card and the door-app
   announcement inside the demo show the real catalogue and the real plan
   names instead of a fixture's guess at them.

   ── AND WHY THE BAR CHANGES COLOUR ───────────────────────────────────────

   Stage 1 is a lit room with one bright object in it: an invitation on a
   dark ground. Stages 2 and 3 are the organizer's paper. A single bar colour
   would be wrong on one of them, and the version that was wrong was the
   invitation — a cream strip along the top of a darkened theatre reads as
   the website leaking into the thing it is presenting.
   ═══════════════════════════════════════════════════════════════════════════ */

const STAGES = [
  { n: '1', key: 'invitation', href: '/demo/invitation', label: 'Experience', hint: 'What your guests get' },
  { n: '2', key: 'dashboard', href: '/demo/dashboard', label: 'Control', hint: 'What you see' },
  { n: '3', key: 'customize', href: '/demo/customize', label: 'Customize', hint: 'Make it yours' },
];

/** Stage 1 is the only dark surface. */
const isDarkStage = (pathname) => pathname === '/demo' || pathname.startsWith('/demo/invitation');

/* ONE ARGUMENT, and it is not a nicety. `apiFetch` calls the router as
   `router(path, options)`, while `answerFor(url, now)` takes a clock as its
   second parameter — handing it the request options would floor an object to
   NaN and date every row in the demo to "Invalid Date". */
const demoRoute = (path) => answerFor(path);

export default function DemoChrome({ children }) {
  const pathname = usePathname() || '/demo';
  const dark = isDarkStage(pathname);

  /* ── INSTALLED DURING RENDER, AND THAT IS NOT AN OVERSIGHT ──────────────
     It was an effect first, and the first screenshot of this stage came back
     reading "Unable to load dashboard — fetch failed". React runs a CHILD's
     effects before its PARENT's, and this is a layout: OrganizerOverview
     fires its own fetch on mount, which is strictly before the effect below
     could have installed anything. Every cold load of /demo/dashboard would
     have shown a visitor an error card on the screen that is supposed to
     prove the product works.

     A parent's render, by contrast, always precedes its children's — so by
     the time any child can ask for data, the router is there. The call is
     idempotent and guarded so it does not re-run on every render.

     The effect stays for its RETURN VALUE: the uninstaller, which is what
     runs when the visitor leaves the demo. */
  if (typeof window !== 'undefined' && !demoApiInstalled()) installDemoApi(demoRoute);
  useEffect(() => installDemoApi(demoRoute), []);

  const activeIndex = STAGES.findIndex((s) => pathname.startsWith(s.href));

  return (
    <div className={`demo-root${dark ? ' demo-root--dark' : ''}`}>
      <header className="demo-bar">
        <div className="demo-bar__inner">
          <Link href="/" className="demo-brand">
            <span className="demo-brand__name">Fancy</span>
            <span aria-hidden="true" className="demo-brand__dot" />
            <span className="demo-brand__tag">Demo</span>
          </Link>

          <Link href="/register" className="demo-cta">
            <span className="demo-cta__long">Create your event</span>
            <span className="demo-cta__short">Create</span>
          </Link>
        </div>

        {/* The rail. A LIST, not a row of buttons: these are three places, and
            a visitor may go straight to the third. Ordered numerals because
            the order is the argument — you cannot judge the dashboard until
            you have been the guest. */}
        <nav aria-label="Demo stages" className="demo-rail fx-scroll-x">
          <ol className="demo-rail__list">
            {STAGES.map((s, i) => {
              const active = i === activeIndex;
              const done = activeIndex > -1 && i < activeIndex;
              return (
                <li key={s.key}>
                  <Link
                    href={s.href}
                    aria-current={active ? 'page' : undefined}
                    className={`demo-step${active ? ' demo-step--on' : ''}${done ? ' demo-step--done' : ''}`}
                  >
                    <span aria-hidden="true" className="demo-step__n">{s.n}</span>
                    <span className="demo-step__text">
                      <span className="demo-step__label">{s.label}</span>
                      <span className="demo-step__hint">{s.hint}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>
      </header>

      <main className="demo-main">{children}</main>

      {/* ONE PLAIN <style>, for the same two reasons the hero uses one: a
          <style jsx> block in a nested non-default-export component does not
          reliably compile in this build, and styled-jsx stamps its hash class
          only onto lowercase intrinsic elements — so a scoped rule aimed at a
          class on a next/link matches nothing, and every link in this bar is
          a next/link.

          MOBILE FIRST. The base rules are the phone; the only media query
          steps up at 768. */}
      <style>{`
        .demo-root {
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          background: ${C.paper};
          color: ${C.ink};
        }
        .demo-root--dark {
          background: #0E0D0C;
          color: ${C.ivory};
        }

        .demo-bar {
          position: sticky;
          top: 0;
          z-index: 40;
          background: rgba(252, 251, 248, 0.86);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          border-bottom: 1px solid ${C.border};
        }
        .demo-root--dark .demo-bar {
          background: rgba(14, 13, 12, 0.82);
          border-bottom-color: rgba(246, 242, 233, 0.14);
        }

        .demo-bar__inner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 11px 16px 9px;
        }

        .demo-brand {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          text-decoration: none;
          min-width: 0;
        }
        .demo-brand__name {
          font-family: ${T.display};
          font-size: 21px;
          font-weight: 400;
          letter-spacing: 0.01em;
          color: ${C.ink};
        }
        .demo-root--dark .demo-brand__name { color: ${C.ivory}; }
        .demo-brand__dot {
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: ${C.gold};
          flex: none;
        }
        .demo-brand__tag {
          font-family: ${T.label};
          font-size: 9px;
          letter-spacing: 0.26em;
          text-transform: uppercase;
          color: ${C.goldInk};
          white-space: nowrap;
        }
        .demo-root--dark .demo-brand__tag { color: #C7A96A; }

        .demo-cta {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 40px;
          padding: 0 18px;
          flex: none;
          background: ${C.ink};
          color: ${C.paper};
          border: 1px solid ${C.ink};
          font-family: ${T.body};
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          white-space: nowrap;
          text-decoration: none;
          transition: background 0.3s ease, color 0.3s ease;
        }
        .demo-cta:hover { background: transparent; color: ${C.ink}; }
        .demo-root--dark .demo-cta {
          background: ${C.ivory};
          color: #0E0D0C;
          border-color: ${C.ivory};
        }
        .demo-root--dark .demo-cta:hover { background: transparent; color: ${C.ivory}; }
        .demo-cta__long { display: none; }

        /* The rail scrolls rather than wraps: three steps with hints do not
           fit 320px, and a wrapped step reads as a fourth. */
        .demo-rail { border-top: 1px solid ${C.border}; }
        .demo-root--dark .demo-rail { border-top-color: rgba(246, 242, 233, 0.10); }
        .demo-rail__list {
          display: flex;
          align-items: stretch;
          gap: 0;
          margin: 0;
          padding: 0 10px;
          list-style: none;
        }
        .demo-step {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 10px 12px;
          min-height: 44px;
          text-decoration: none;
          white-space: nowrap;
          border-bottom: 2px solid transparent;
          transition: border-color 0.25s ease, opacity 0.25s ease;
          opacity: 0.55;
        }
        .demo-step--on { opacity: 1; border-bottom-color: ${C.gold}; }
        .demo-step--done { opacity: 0.8; }
        .demo-step__n {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 21px;
          height: 21px;
          flex: none;
          border-radius: 50%;
          border: 1px solid ${C.border};
          font-family: ${T.body};
          font-size: 10px;
          font-weight: 700;
          color: ${C.inkSoft};
        }
        .demo-root--dark .demo-step__n {
          border-color: rgba(246, 242, 233, 0.24);
          color: rgba(246, 242, 233, 0.7);
        }
        .demo-step--on .demo-step__n {
          background: ${C.gold};
          border-color: ${C.gold};
          color: #FFFFFF;
        }
        .demo-step__text { display: flex; flex-direction: column; min-width: 0; }
        .demo-step__label {
          font-family: ${T.body};
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.13em;
          text-transform: uppercase;
          color: ${C.ink};
        }
        .demo-root--dark .demo-step__label { color: ${C.ivory}; }
        .demo-step__hint { display: none; }

        .demo-main { flex: 1 1 auto; min-height: 0; }

        @media (min-width: 768px) {
          .demo-bar__inner { padding: 14px 28px 12px; }
          .demo-brand__name { font-size: 24px; }
          .demo-brand__tag { font-size: 9.5px; }
          .demo-cta { min-height: 44px; padding: 0 26px; font-size: 10.5px; }
          .demo-cta__long { display: inline; }
          .demo-cta__short { display: none; }
          .demo-rail__list { padding: 0 22px; }
          .demo-step { gap: 12px; padding: 11px 20px; }
          .demo-step__n { width: 24px; height: 24px; font-size: 11px; }
          .demo-step__label { font-size: 11.5px; }
          .demo-step__hint {
            display: block;
            margin-top: 2px;
            font-family: ${T.body};
            font-size: 11px;
            font-weight: 400;
            letter-spacing: 0;
            text-transform: none;
            color: ${C.inkSoft};
          }
          .demo-root--dark .demo-step__hint { color: rgba(246, 242, 233, 0.5); }
        }

        @media (prefers-reduced-motion: reduce) {
          .demo-cta, .demo-step { transition: none; }
        }
      `}</style>
    </div>
  );
}
