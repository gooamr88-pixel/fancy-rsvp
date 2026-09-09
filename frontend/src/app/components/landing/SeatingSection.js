import React from "react";
import Link from "next/link";
import { C, T, SHADOW } from "./landingTokens";

/* ═══════════════════════════════════════════════════════════════════════════
   THE SEATING PLAN.

   This was one row of an editorial list — "Seating Charts · Drag guests onto
   tables. It never lets you overbook." — under a heading, with no picture. It
   is one of the two or three reasons anyone chooses this product over a form,
   and a visitor could read the entire homepage without seeing one.

   The plate is a photograph of SeatingMiniMap rendering a real room (a head
   table, ten rounds, a stage, a dance floor, a bar and an entrance), produced
   by test/shots/landingShots.dump.jsx. Change the component and re-run it and
   this follows; change it and forget, and the homepage is out of date rather
   than fictional — which is the failure mode you want, because it is the one
   somebody notices.

   The three proofs under it are the three things this actually does that a
   spreadsheet cannot, and every one of them is a shipped behaviour rather
   than a benefit: it refuses to overbook, guests look themselves up without
   an account, and the whole room prints.

   A Server Component: no state, no client JavaScript.
   ═══════════════════════════════════════════════════════════════════════════ */

const PLAN = {
  src: "/images/landing/dash-seating.webp",
  w: 980,
  h: 700,
  alt:
    "A seating plan: numbered round and oval tables with their chairs drawn in, a head table, and the venue's stage, dance floor, bar and entrance marked around them.",
};

/* ONE SENTENCE EACH. See the note on the same list in CheckinSection: four
   feature bands in a row, each with three paragraphs, is a page nobody
   finishes. The detail is on /features and in the demo. */
const PROOFS = [
  {
    title: "It refuses to overbook",
    body: "Seats left are counted from the replies, not typed in — and a full table is not offered.",
  },
  {
    title: "Guests find themselves",
    body: "A name and the last four digits of a phone. No account, and nothing shows until you unlock it.",
  },
  {
    title: "It prints, properly",
    body: "A pack for the venue: the plan, a page per table, and an A–Z index of every guest.",
  },
];

export default function SeatingSection() {
  return (
    <section id="seating" className="seat" aria-labelledby="seat-title">
      <div className="fx-container fx-container--5xl fx-gutter">
        <header className="seat-head">
          <span className="seat-kicker">
            Seating
            <span aria-hidden="true" className="seat-kicker__rule" />
          </span>
          <span className="seat-numeral" aria-hidden="true">IV</span>
          <h2 id="seat-title" className="seat-h2">
            Seat everyone. Without the spreadsheet.
          </h2>
          <p className="seat-sub">
            Draw the room as it really is — the head table, the rounds, the dance
            floor, the bar — then drag names onto it. Move one person and every
            count follows.
          </p>
        </header>

        <div className="seat-body">
          <figure className="seat-art">
            <div className="seat-plate">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={PLAN.src} alt={PLAN.alt} width={PLAN.w} height={PLAN.h} loading="lazy" />
            </div>
            <figcaption className="seat-cap">The plan a guest sees — the same room you arranged</figcaption>
          </figure>

          <div className="seat-side">
            <ul className="seat-proofs">
              {PROOFS.map((p) => (
                <li key={p.title}>
                  <h3>{p.title}</h3>
                  <p>{p.body}</p>
                </li>
              ))}
            </ul>

            {/* THE STRONGEST LINK ON THIS PAGE, and it is worth saying why:
                the demo's seating screen is not a picture. Moving a guest to a
                table there re-counts the room for real, because the counts are
                derived from the same array the drag writes to. */}
            <Link href="/demo/dashboard" className="seat-cta">
              See seating in action
              <svg width="16" height="9" viewBox="0 0 16 9" fill="none" aria-hidden="true">
                <path d="M0 4.5h14M11 1l3.5 3.5L11 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <p className="seat-cta__note">Move somebody in the demo and watch the room re-count.</p>
          </div>
        </div>
      </div>

      {/* A plain style element — styled-jsx cannot be imported from a Server
          Component, and a scoped rule would never attach to the next/link
          above. Classes are prefixed "seat-" instead.

          No backticks inside these CSS comments: one would end the template
          literal and produce a parse error. */}
      <style>{`
        .seat {
          width: 100%;
          background: ${C.paper};
          padding: 72px 0;
        }
        .seat-head {
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          column-gap: 20px;
        }
        .seat-kicker {
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
        .seat-kicker__rule {
          display: block;
          flex: none;
          width: 28px;
          height: 1px;
          background: ${C.gold};
          opacity: 0.55;
        }
        .seat-numeral {
          font-family: ${T.display};
          font-style: italic;
          font-size: 13px;
          color: ${C.goldInk};
          opacity: 0.75;
        }
        .seat-h2 {
          grid-column: 1 / -1;
          font-family: ${T.display};
          font-weight: 300;
          font-size: 37px;
          line-height: 1.07;
          letter-spacing: -0.015em;
          color: ${C.ink};
          margin: 18px 0 0;
        }
        .seat-sub {
          grid-column: 1 / -1;
          font-size: 15.5px;
          font-weight: 300;
          line-height: 1.85;
          color: ${C.inkSoft};
          margin: 14px 0 0;
          max-width: 52ch;
        }

        .seat-body {
          display: flex;
          flex-direction: column;
          gap: 38px;
          margin-top: 36px;
        }
        .seat-art { margin: 0; }
        /* A plate, not a raw crop: the plan is a drawing on paper, so it gets
           paper under it and a hairline around it rather than a bezel, which
           would say "this is a screen" about something that is also printed. */
        .seat-plate {
          padding: 8px;
          background: ${C.paper};
          border: 1px solid ${C.border};
          box-shadow: ${SHADOW.lift};
        }
        .seat-plate img { display: block; width: 100%; height: auto; }
        .seat-cap {
          margin: 14px 0 0;
          font-size: 10px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: ${C.inkSoft};
          opacity: 0.72;
        }

        .seat-side { min-width: 0; }
        .seat-proofs {
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .seat-proofs li {
          padding: 20px 0;
          border-top: 1px solid ${C.border};
          min-width: 0;
        }
        .seat-proofs h3 {
          font-family: ${T.display};
          font-size: 21px;
          font-weight: 400;
          line-height: 1.22;
          color: ${C.ink};
          margin: 0;
        }
        .seat-proofs p {
          font-size: 13px;
          font-weight: 300;
          line-height: 1.72;
          color: ${C.inkSoft};
          margin: 7px 0 0;
        }

        .seat-cta {
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
        .seat-cta:hover { color: ${C.goldInk}; border-color: ${C.goldInk}; }
        .seat-cta__note {
          margin: 12px 0 0;
          font-size: 12px;
          font-weight: 300;
          line-height: 1.6;
          color: ${C.inkSoft};
          opacity: 0.85;
        }

        @media (min-width: 768px) {
          .seat { padding: 122px 0; }
          .seat-kicker { font-size: 11px; letter-spacing: 0.38em; gap: 16px; }
          .seat-kicker__rule { width: 44px; }
          .seat-numeral { font-size: 15px; }
          .seat-h2 { font-size: 54px; margin-top: 22px; }
          .seat-sub { font-size: 17px; margin-top: 18px; }
          .seat-body {
            display: grid;
            grid-template-columns: minmax(0, 1.16fr) minmax(0, 0.84fr);
            gap: 64px;
            align-items: center;
            margin-top: 54px;
          }
          .seat-plate { padding: 12px; }
          .seat-cap { margin-top: 18px; }
          .seat-proofs li { padding: 22px 0; }
          .seat-proofs h3 { font-size: 23px; }
          .seat-proofs p { font-size: 13.5px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .seat-cta { transition: none; }
        }
      `}</style>
    </section>
  );
}
