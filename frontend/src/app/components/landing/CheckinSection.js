import React from "react";
import Link from "next/link";
import { C, T, SHADOW, BEZEL } from "./landingTokens";
import { CHECKIN_SCREENS, CHECKIN_MIN_ANDROID } from "../../utils/checkinApp";

/* ═══════════════════════════════════════════════════════════════════════════
   THE DOOR.

   The last band about the night itself, and the only one about a piece of
   hardware standing in a venue. It used to be half of the dashboard band — a
   tablet beside a browser window, under a heading about the dashboard — which
   put the one part of this product that is not a website inside the section
   about the website.

   The picture is the app's own scan-result screen, rendered from the Android
   layout by scripts/renderCheckinScreens.js and imported from
   utils/checkinApp.js, which is the single place the door app's public facts
   live (the APK URL, the minimum Android version, these screens). Nothing
   here restates one of them.

   A Server Component: no state, no client JavaScript.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ONE SENTENCE EACH, and short ones.
   These ran to three lines apiece on a phone. Four bands in a row each
   carrying a picture and three paragraphs is how a page that says everything
   ends up read by nobody — and the detail belongs on /checkin-app, which is
   one tap away at the foot of this band. */
const PROOFS = [
  {
    title: "It works with no internet at all",
    body: "The guest list is on the device before the doors open, and syncs back when it reconnects.",
  },
  {
    title: "A party arrives together",
    body: "One scan brings up all four, with their meals and any access note. Check in some or all.",
  },
  {
    title: "Two doors, one guest list",
    body: "A second tablet on the side entrance cannot let the same pass through twice.",
  },
];

export default function CheckinSection() {
  const screen = CHECKIN_SCREENS[0];

  return (
    <section id="checkin" className="door" aria-labelledby="door-title">
      <div className="fx-container fx-container--5xl fx-gutter">
        <header className="door-head">
          <span className="door-kicker">
            At the door
            <span aria-hidden="true" className="door-kicker__rule" />
          </span>
          <span className="door-numeral" aria-hidden="true">VI</span>
          <h2 id="door-title" className="door-h2">
            Check-in, made elegant.
          </h2>
          <p className="door-sub">
            Every guest carries a scannable pass. Point a tablet at it and the
            evening&rsquo;s first impression is a name read correctly, not a
            clipboard.
          </p>
        </header>

        <div className="door-body">
          <figure className="door-art">
            <div className="door-tablet">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={screen.src} alt={screen.alt} width={760} height={560} loading="lazy" />
            </div>
            <figcaption className="door-cap">
              {screen.caption} — Fancy Check-in, {CHECKIN_MIN_ANDROID}
            </figcaption>
          </figure>

          <div className="door-side">
            <ul className="door-proofs">
              {PROOFS.map((p) => (
                <li key={p.title}>
                  <h3>{p.title}</h3>
                  <p>{p.body}</p>
                </li>
              ))}
            </ul>

            <Link href="/checkin-app" className="door-cta">
              See check-in in action
              <svg width="16" height="9" viewBox="0 0 16 9" fill="none" aria-hidden="true">
                <path d="M0 4.5h14M11 1l3.5 3.5L11 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <p className="door-cta__note">
              No tablet on the night? A guest can scan their own pass instead.
            </p>
          </div>
        </div>
      </div>

      {/* A plain style element — styled-jsx cannot be imported from a Server
          Component, and a scoped rule would never attach to the next/link
          above. Classes are prefixed "door-" instead.

          No backticks inside these CSS comments: one would end the template
          literal and produce a parse error. */}
      <style>{`
        .door {
          width: 100%;
          background: ${C.paper};
          padding: 72px 0;
        }
        .door-head {
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          column-gap: 20px;
        }
        .door-kicker {
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
        .door-kicker__rule {
          display: block;
          flex: none;
          width: 28px;
          height: 1px;
          background: ${C.gold};
          opacity: 0.55;
        }
        .door-numeral {
          font-family: ${T.display};
          font-style: italic;
          font-size: 13px;
          color: ${C.goldInk};
          opacity: 0.75;
        }
        .door-h2 {
          grid-column: 1 / -1;
          font-family: ${T.display};
          font-weight: 300;
          font-size: 37px;
          line-height: 1.07;
          letter-spacing: -0.015em;
          color: ${C.ink};
          margin: 18px 0 0;
        }
        .door-sub {
          grid-column: 1 / -1;
          font-size: 15.5px;
          font-weight: 300;
          line-height: 1.85;
          color: ${C.inkSoft};
          margin: 14px 0 0;
          max-width: 52ch;
        }

        .door-body {
          display: flex;
          flex-direction: column;
          gap: 38px;
          margin-top: 36px;
        }
        .door-art { margin: 0; }
        /* A tablet body, because it IS one: a flat rectangle loses the fact
           that this is a physical thing standing at an entrance. */
        .door-tablet {
          border-radius: 16px;
          padding: 9px;
          background: ${BEZEL};
          box-shadow: ${SHADOW.device};
        }
        .door-tablet img { display: block; width: 100%; height: auto; border-radius: 7px; }
        .door-cap {
          margin: 14px 0 0;
          font-size: 10px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: ${C.inkSoft};
          opacity: 0.72;
        }

        .door-side { min-width: 0; }
        .door-proofs {
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .door-proofs li {
          padding: 20px 0;
          border-top: 1px solid ${C.border};
          min-width: 0;
        }
        .door-proofs h3 {
          font-family: ${T.display};
          font-size: 21px;
          font-weight: 400;
          line-height: 1.22;
          color: ${C.ink};
          margin: 0;
        }
        .door-proofs p {
          font-size: 13px;
          font-weight: 300;
          line-height: 1.72;
          color: ${C.inkSoft};
          margin: 7px 0 0;
        }

        .door-cta {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          margin-top: 26px;
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
        .door-cta:hover { color: ${C.goldInk}; border-color: ${C.goldInk}; }
        .door-cta__note {
          margin: 12px 0 0;
          font-size: 12px;
          font-weight: 300;
          line-height: 1.6;
          color: ${C.inkSoft};
          opacity: 0.85;
        }

        @media (min-width: 768px) {
          .door { padding: 122px 0; }
          .door-kicker { font-size: 11px; letter-spacing: 0.38em; gap: 16px; }
          .door-kicker__rule { width: 44px; }
          .door-numeral { font-size: 15px; }
          .door-h2 { font-size: 54px; margin-top: 22px; }
          .door-sub { font-size: 17px; margin-top: 18px; }
          /* THE PICTURE IS ON THE RIGHT HERE, and the seating band's is on the
             left. Four feature bands in a row, each with a heading, a
             photograph and three proofs, is one template repeated four times —
             and a reader scrolling fast stops seeing the fourth. Alternating
             the side is the cheapest way to make each one land as its own
             screen rather than as more of the same. */
          .door-body {
            display: grid;
            grid-template-columns: minmax(0, 0.88fr) minmax(0, 1.12fr);
            gap: 64px;
            align-items: center;
            margin-top: 54px;
          }
          .door-art { order: 2; }
          .door-side { order: 1; }
          .door-tablet { border-radius: 22px; padding: 14px; }
          .door-tablet img { border-radius: 9px; }
          .door-cap { margin-top: 20px; }
          .door-proofs li { padding: 22px 0; }
          .door-proofs h3 { font-size: 23px; }
          .door-proofs p { font-size: 13.5px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .door-cta { transition: none; }
        }
      `}</style>
    </section>
  );
}
