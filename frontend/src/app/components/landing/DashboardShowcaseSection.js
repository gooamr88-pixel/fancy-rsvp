import React from "react";
import Link from "next/link";
import { C, T, SHADOW } from "./landingTokens";
import DashboardTabs from "./DashboardTabs";

/* ═══════════════════════════════════════════════════════════════════════════
   YOUR SIDE OF IT.

   Every image here is a photograph of the real component, produced by
   test/shots/landingTabs.dump.jsx from the demo's own fixtures — the same
   screens /demo/dashboard mounts. So a redesign of the dashboard cannot leave
   a stale picture here, and the four frames are all of ONE application rather
   than four screenshots taken from different places.

   ── The 2026-09-09 pass ──────────────────────────────────────────────────

   This band used to carry three objects: the dashboard in a browser window,
   the seating plan on a plate overlapping it, and the door app in a tablet.
   Two of those have their own bands now, which is what this whole pass is
   about — the seating chart and the door were being shown as accessories to
   the dashboard rather than as the two things that sell this product.

   What is left is one window and a way through it. The strip is the mockup's
   idea and it is the right one: four screens in the vertical space of one, and
   a visitor who clicks even a single tab has learnt more about the depth of
   this thing than a paragraph could tell them.

   A Server Component. The only client JavaScript on the band is the strip
   itself — see DashboardTabs.js.
   ═══════════════════════════════════════════════════════════════════════════ */

/** 1120x860, all four, so switching tabs cannot resize the window. */
const SHOTS = [
  {
    key: "overview",
    label: "Overview",
    src: "/images/landing/dash-overview.webp",
    w: 1120,
    h: 860,
    alt:
      "The Fancy RSVP dashboard: total events and guests, an RSVP rate with accepted, declined and pending counts, and below them the organizer's upcoming events and a live feed of replies as they arrive.",
    note: "Who is coming, who has not replied, and how the replies are trending — updated the moment a guest submits.",
  },
  {
    key: "guests",
    label: "Guest list",
    src: "/images/landing/dash-guests.webp",
    w: 1120,
    h: 860,
    alt:
      "The guest list: a card for each invited party showing their reply, the size of their party, the meal they chose, who they are bringing and the table they are sitting at.",
    note: "One card per invitation — the reply, the party, the meals, the table. Search it, filter it, export it.",
  },
  {
    key: "seating",
    label: "Seating",
    src: "/images/landing/dash-seating-plan.webp",
    w: 1120,
    h: 860,
    alt:
      "The seating screen: how many of the accepted guests are seated so far, and beneath it every guest with their party size, their meal and a table selector.",
    note: "Assign a table and the counts follow. A table with no seats left is not offered.",
  },
  {
    key: "analytics",
    label: "Analytics",
    src: "/images/landing/dash-analytics.webp",
    w: 1120,
    h: 860,
    alt:
      "The analytics screen: how many guests opened the invitation, how many replied, and how those replies arrived over time.",
    note: "Who opened the invitation, where they stopped, and what they did next.",
  },
];

export default function DashboardShowcaseSection() {
  return (
    <section id="dashboard" className="dash" aria-labelledby="dash-title">
      <div className="fx-container fx-container--5xl fx-gutter">
        <header className="dash-head">
          <span className="dash-kicker">
            For organizers
            <span aria-hidden="true" className="dash-kicker__rule" />
          </span>
          <span className="dash-numeral" aria-hidden="true">III</span>
          <h2 id="dash-title" className="dash-h2">
            Everything happens here.
          </h2>
          <p className="dash-sub">
            Guests, meals, seating, messages and the door — one place, and these
            are screenshots of it rather than illustrations of it.
          </p>
        </header>

        <div className="dash-stage">
          <span aria-hidden="true" className="dash-stage__glow" />
          <DashboardTabs shots={SHOTS} />
        </div>

        <div className="dash-foot">
          <p className="dash-hint">
            <svg width="34" height="26" viewBox="0 0 40 30" fill="none" aria-hidden="true">
              <path d="M38 28C30 26 14 22 7 12c-2-3-3-6-3-9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
              <path d="M1 5l3-4 5 2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Switch between the tabs — every one is a real screen.</span>
          </p>

          <Link href="/demo/dashboard" className="dash-cta">
            Open the live dashboard
            <svg width="16" height="9" viewBox="0 0 16 9" fill="none" aria-hidden="true">
              <path d="M0 4.5h14M11 1l3.5 3.5L11 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
      </div>

      {/* A plain style element — styled-jsx cannot be imported from a Server
          Component, and a scoped rule would never reach the buttons
          DashboardTabs renders. Classes are prefixed "dash-" instead.

          No backticks inside these CSS comments: one would terminate the
          template literal and produce a parse error. */}
      <style>{`
        .dash {
          width: 100%;
          /* CLIPS THE GLOW. .dash-stage__glow is inset -10% horizontally so the
             light spills past the container the way an ambient one would — and
             at a desktop width that is 118px of box hanging off each side of
             the viewport. Measured at 1280: documentElement.scrollWidth was
             1344 against a clientWidth of 1274.

             The page never scrolled sideways, because html { overflow-x: clip }
             in globals.css was hiding it — which is a GUARD, not a fix, and
             hidden overflow is unreachable rather than scrollable. This is the
             fix: the glow is clipped by the band it belongs to and the guard
             goes back to guarding nothing. */
          overflow: hidden;
          background: ${C.paper2};
          padding: 72px 0;
        }
        .dash-head {
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          column-gap: 20px;
        }
        .dash-kicker {
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
        .dash-kicker__rule {
          display: block;
          flex: none;
          width: 28px;
          height: 1px;
          background: ${C.gold};
          opacity: 0.55;
        }
        .dash-numeral {
          font-family: ${T.display};
          font-style: italic;
          font-size: 13px;
          color: ${C.goldInk};
          opacity: 0.75;
        }
        .dash-h2 {
          grid-column: 1 / -1;
          font-family: ${T.display};
          font-weight: 300;
          font-size: 37px;
          line-height: 1.07;
          letter-spacing: -0.015em;
          color: ${C.ink};
          margin: 18px 0 0;
        }
        .dash-sub {
          grid-column: 1 / -1;
          font-size: 15.5px;
          font-weight: 300;
          line-height: 1.85;
          color: ${C.inkSoft};
          margin: 14px 0 0;
          max-width: 52ch;
        }

        .dash-stage { position: relative; margin-top: 34px; }
        .dash-stage__glow { display: none; }

        /* ── the strip ──────────────────────────────────────────────────────
           .fx-scroll-x is the primitive for content that genuinely cannot
           reflow. The inner row needs min-width: 0 or the flex track sizes to
           max-content and the port never scrolls — it just gets wider than the
           page, which is the single most common way this goes wrong here. */
        .dash-tabs__strip { margin-bottom: 14px; min-width: 0; }
        .dash-tabs__strip [role="tablist"] {
          display: flex;
          gap: 8px;
          width: max-content;
          min-width: 100%;
          padding-bottom: 2px;
        }
        .dash-tab {
          flex: none;
          appearance: none;
          padding: 11px 18px;
          background: transparent;
          border: 1px solid ${C.border};
          border-radius: 999px;
          font-family: ${T.body};
          font-size: 10.5px;
          font-weight: 600;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          white-space: nowrap;
          color: ${C.inkSoft};
          cursor: pointer;
          transition: background 0.25s ease, color 0.25s ease, border-color 0.25s ease;
        }
        .dash-tab:hover { border-color: ${C.gold}; color: ${C.ink}; }
        .dash-tab--on {
          background: ${C.ink};
          border-color: ${C.ink};
          color: ${C.paper};
        }
        .dash-tab--on:hover { color: ${C.paper}; }

        /* ── the window ─────────────────────────────────────────────────── */
        .dash-win {
          border-radius: 12px;
          overflow: hidden;
          background: ${C.paper};
          border: 1px solid ${C.border};
          box-shadow: ${SHADOW.window};
        }
        .dash-win__bar {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 9px 12px;
          background: ${C.paper3};
          border-bottom: 1px solid ${C.border};
        }
        .dash-win__dot {
          display: block;
          flex: none;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #D6CEBE;
        }
        .dash-win__url {
          flex: 1 1 auto;
          min-width: 0;
          margin-left: 8px;
          display: flex;
          align-items: center;
          height: 20px;
          padding: 0 10px;
          border-radius: 999px;
          background: ${C.paper};
          border: 1px solid ${C.border};
          font-size: 9px;
          letter-spacing: 0.06em;
          color: ${C.inkSoft};
          opacity: 0.75;
          overflow: hidden;
          white-space: nowrap;
        }
        .dash-win img { display: block; width: 100%; height: auto; }

        .dash-tabs__note {
          margin: 16px 0 0;
          font-size: 13px;
          font-weight: 300;
          line-height: 1.7;
          color: ${C.inkSoft};
          max-width: 62ch;
        }

        /* ── under it ───────────────────────────────────────────────────── */
        .dash-foot {
          display: flex;
          flex-direction: column;
          gap: 20px;
          margin-top: 26px;
        }
        .dash-hint {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin: 0;
          color: ${C.goldInk};
        }
        .dash-hint svg { flex: none; opacity: 0.7; margin-top: 2px; transform: scaleX(-1); }
        .dash-hint span {
          font-family: ${T.display};
          font-style: italic;
          font-size: 17px;
          line-height: 1.35;
        }
        .dash-cta {
          align-self: flex-start;
          display: inline-flex;
          align-items: center;
          gap: 12px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: ${C.ink};
          text-decoration: none;
          border-bottom: 1px solid ${C.gold};
          padding-bottom: 8px;
          transition: color 0.3s ease, border-color 0.3s ease;
        }
        .dash-cta:hover { color: ${C.goldInk}; border-color: ${C.goldInk}; }

        @media (min-width: 768px) {
          .dash { padding: 122px 0; }
          .dash-kicker { font-size: 11px; letter-spacing: 0.38em; gap: 16px; }
          .dash-kicker__rule { width: 44px; }
          .dash-numeral { font-size: 15px; }
          .dash-h2 { font-size: 54px; margin-top: 22px; }
          .dash-sub { font-size: 17px; margin-top: 18px; }
          .dash-stage { margin-top: 52px; }
          .dash-stage__glow {
            display: block;
            position: absolute;
            inset: -8% -10% -6% -10%;
            background: radial-gradient(ellipse at 55% 45%, rgba(169, 138, 78, 0.16), transparent 66%);
            pointer-events: none;
          }
          .dash-tabs__strip { margin-bottom: 18px; }
          .dash-tab { padding: 12px 24px; font-size: 11px; }
          .dash-win { border-radius: 15px; }
          .dash-win__bar { padding: 13px 18px; gap: 8px; }
          .dash-win__dot { width: 9px; height: 9px; }
          .dash-win__url { height: 26px; padding: 0 14px; font-size: 10px; margin-left: 12px; }
          .dash-tabs__note { font-size: 14px; margin-top: 20px; }
          .dash-foot {
            flex-direction: row;
            align-items: center;
            justify-content: space-between;
            gap: 40px;
            margin-top: 34px;
          }
          .dash-hint span { font-size: 19px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .dash-tab, .dash-cta { transition: none; }
        }
      `}</style>
    </section>
  );
}
