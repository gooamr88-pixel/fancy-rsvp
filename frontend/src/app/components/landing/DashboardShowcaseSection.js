import React from "react";
import FeatureBand from "./FeatureBand";
import { C, T, SHADOW } from "./landingTokens";
import DashboardTabs from "./DashboardTabs";

/* ═══════════════════════════════════════════════════════════════════════════
   YOUR SIDE OF IT.

   One screen, four frames: the tab strip is the mockup's idea and it is the
   right one — four screens in the vertical space of one, and a visitor who
   clicks a single tab has learnt more about the depth of this thing than a
   paragraph could tell them.

   Every image is a photograph of the real component, produced by
   test/shots/landingTabs.dump.jsx from the demo's own fixtures — the same
   screens /demo/dashboard mounts. So a redesign of the dashboard cannot leave
   a stale picture here, and the four frames are all of ONE application rather
   than four screenshots taken from different places.

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
  },
  {
    key: "guests",
    label: "Guest list",
    src: "/images/landing/dash-guests.webp",
    w: 1120,
    h: 860,
    alt:
      "The guest list: a card for each invited party showing their reply, the size of their party, the meal they chose, who they are bringing and the table they are sitting at.",
  },
  {
    key: "seating",
    label: "Seating",
    src: "/images/landing/dash-seating-plan.webp",
    w: 1120,
    h: 860,
    alt:
      "The seating screen: how many of the accepted guests are seated so far, and beneath it every guest with their party size, their meal and a table selector.",
  },
  {
    key: "analytics",
    label: "Analytics",
    src: "/images/landing/dash-analytics.webp",
    w: 1120,
    h: 860,
    alt:
      "The analytics screen: how many guests opened the invitation, how many replied, and how those replies arrived over time.",
  },
];

export default function DashboardShowcaseSection() {
  return (
    <FeatureBand
      id="dashboard"
      tone="warm"
      kicker="For organizers"
      title="Everything happens here."
      sub="Guests, meals, seating, messages and the door — one place, and these are screenshots of it rather than illustrations of it."
      cta={{ href: "/demo/dashboard", label: "See the dashboard" }}
    >
      <div className="dash-stage">
        <span aria-hidden="true" className="dash-stage__glow" />
        <DashboardTabs shots={SHOTS} />
      </div>

      {/* A plain style element — styled-jsx cannot be imported from a Server
          Component, and a scoped rule would never reach the buttons
          DashboardTabs renders. Classes are prefixed "dash-" instead.

          No backticks inside these CSS comments: one would terminate the
          template literal and produce a parse error. */}
      <style>{`
        /* CLIPS THE GLOW. .dash-stage__glow is inset -10% horizontally so the
           light spills past the container the way an ambient one would — and
           at a desktop width that is over a hundred pixels of box hanging off
           each side of the viewport. Measured at 1280: scrollWidth 1344
           against a clientWidth of 1274. The page never scrolled sideways,
           because html { overflow-x: clip } was hiding it — a guard, not a
           fix, and hidden overflow is unreachable rather than scrollable. */
        .dash-stage { position: relative; overflow: hidden; padding: 0 2px; }
        .dash-stage__glow { display: none; }

        /* ── the strip ──────────────────────────────────────────────────────
           Centred, because every other band on this page is. It scrolls rather
           than wraps: four labels at this tracking do not fit 320px, and a tab
           strip that has become two rows has stopped looking like one control.

           .fx-scroll-x is the primitive for content that genuinely cannot
           reflow; the inner row needs min-width: 0 or the flex track sizes to
           max-content and the port never scrolls — it just gets wider than the
           page, which is the most common way this goes wrong here. */
        .dash-tabs__strip { margin-bottom: 18px; min-width: 0; }
        .dash-tabs__strip [role="tablist"] {
          display: flex;
          justify-content: flex-start;
          gap: 8px;
          width: max-content;
          min-width: 100%;
          padding-bottom: 2px;
        }
        .dash-tab {
          flex: none;
          appearance: none;
          padding: 11px 20px;
          background: transparent;
          border: 1px solid ${C.border};
          border-radius: 999px;
          font-family: ${T.body};
          font-size: 10.5px;
          font-weight: 600;
          letter-spacing: 0.14em;
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

        /* THE PER-TAB CAPTION IS GONE. Each frame carried its own explanatory
           sentence under the window, which meant the copy under the picture
           changed as you clicked — a line of text moving on its own is the
           single most distracting thing a still page can do, and it made the
           band the only one with two paragraphs in it. The alt text still
           describes every frame for anyone who cannot see it. */
        .dash-tabs__note { display: none; }

        @media (min-width: 768px) {
          .dash-stage__glow {
            display: block;
            position: absolute;
            inset: -8% -6% -6% -6%;
            background: radial-gradient(ellipse at 55% 45%, rgba(169, 138, 78, 0.16), transparent 66%);
            pointer-events: none;
          }
          /* Centred once the four fit — a left-aligned strip under a centred
             heading is the seam that made this band look like a different
             page from the ones around it. */
          .dash-tabs__strip [role="tablist"] { justify-content: center; }
          .dash-tab { padding: 12px 26px; font-size: 11px; }
          .dash-win { border-radius: 15px; }
          .dash-win__bar { padding: 13px 18px; gap: 8px; }
          .dash-win__dot { width: 9px; height: 9px; }
          .dash-win__url { height: 26px; padding: 0 14px; font-size: 10px; margin-left: 12px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .dash-tab { transition: none; }
        }
      `}</style>
    </FeatureBand>
  );
}
