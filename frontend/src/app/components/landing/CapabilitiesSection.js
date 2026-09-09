import React from "react";
import Link from "next/link";
import { C, T } from "./landingTokens";
import {
  HOMEPAGE_CAPABILITIES,
  REST_CAPABILITIES,
  REMAINING_CAPABILITY_COUNT,
  FLOW_LABEL,
} from "./platformCapabilities";

/* ═══════════════════════════════════════════════════════════════════════════
   ONE EVENT. ONE SYSTEM.

   The band that closes the argument. Everything above it showed one thing at
   a time; this says the things know about each other, which is the actual
   reason to use this rather than a form, a spreadsheet and a WhatsApp group.

   ── 2026-09-09: the list became a sequence ───────────────────────────────

   It was an editorial list of eight — a hairline, a numeral, a title and a
   line of copy each. It read well and it made the wrong claim: a list is a
   catalogue of parts, and the thing worth saying here is that a name typed
   once reaches all of them. Eight nodes with arrows between them says that in
   the shape of the drawing, before a word is read.

   The nodes are the SAME array /features renders — see platformCapabilities.js
   — so a capability cannot be in the diagram and missing from that page, or
   the other way round. The five that are not steps in the sequence are printed
   by name underneath rather than hidden behind the link, because two of them
   (SMS campaigns, bilingual invitations) are things a visitor is specifically
   looking for and would otherwise leave without finding.

   A Server Component: no state, no client JavaScript.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The arrow between two nodes. Decorative: the list is already ordered, and a
 *  screen reader announcing "arrow" seven times is noise. */
function Chevron() {
  return (
    <span className="cap-arrow" aria-hidden="true">
      <svg width="15" height="8" viewBox="0 0 15 8" fill="none">
        <path d="M0 4h12M9.5 1L13 4l-3.5 3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export default function CapabilitiesSection() {
  return (
    <section id="capabilities" className="cap" aria-labelledby="cap-title">
      <div className="fx-container fx-container--5xl fx-gutter">
        <header className="cap-head">
          <span className="cap-kicker">
            One event. One system.
            <span aria-hidden="true" className="cap-kicker__rule" />
          </span>
          <span className="cap-numeral" aria-hidden="true">VII</span>

          <h2 id="cap-title" className="cap-h2">
            From invitation to memories.
          </h2>

          <p className="cap-sub">
            A form builder, a guest list, a seating plan, a messaging system and
            a door scanner — built to know about each other, so a name you type
            once reaches all of them.
          </p>
        </header>

        {/* An ORDERED list, because the order is the argument. The arrows are
            separate spans rather than a border or a pseudo-element on the node
            so the last one can simply not be rendered — a trailing arrow into
            nothing is the classic version of this drawing done badly. */}
        <ol className="cap-flow">
          {HOMEPAGE_CAPABILITIES.map((c, i) => (
            <li key={c.key} className="cap-node">
              <span className="cap-node__icon" aria-hidden="true">{c.icon}</span>
              <span className="cap-node__label">{FLOW_LABEL[c.key] || c.title}</span>
              <span className="cap-node__full">{c.short}</span>
              {i < HOMEPAGE_CAPABILITIES.length - 1 && <Chevron />}
            </li>
          ))}
        </ol>

        <div className="cap-rest">
          <span className="cap-rest__label">Also included</span>
          <ul className="cap-rest__list">
            {REST_CAPABILITIES.map((c) => (
              <li key={c.key}>{c.title}</li>
            ))}
          </ul>

          {REMAINING_CAPABILITY_COUNT > 0 && (
            <Link href="/features" className="cap-more-link">
              What each one does
              <svg width="16" height="8" viewBox="0 0 16 8" fill="none" aria-hidden="true">
                <path d="M0 4h14M11 1l3 3-3 3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          )}
        </div>
      </div>

      {/* A plain style element — styled-jsx cannot be imported from a Server
          Component, and a scoped rule would never reach the next/link above.
          Classes are prefixed "cap-" instead.

          No backticks in these CSS comments: one would end the template
          literal and produce a parse error. */}
      <style>{`
        .cap {
          width: 100%;
          background: ${C.paper2};
          padding: 72px 0;
        }

        .cap-head {
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          column-gap: 20px;
        }
        .cap-kicker {
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
        .cap-kicker__rule {
          display: block;
          flex: none;
          width: 28px;
          height: 1px;
          background: ${C.gold};
          opacity: 0.55;
        }
        .cap-numeral {
          font-family: ${T.display};
          font-style: italic;
          font-size: 13px;
          color: ${C.goldInk};
          opacity: 0.75;
        }
        .cap-h2 {
          grid-column: 1 / -1;
          font-family: ${T.display};
          font-weight: 300;
          font-size: 37px;
          line-height: 1.07;
          letter-spacing: -0.015em;
          color: ${C.ink};
          margin: 18px 0 0;
        }
        .cap-sub {
          grid-column: 1 / -1;
          font-size: 15.5px;
          font-weight: 300;
          line-height: 1.85;
          color: ${C.inkSoft};
          margin: 14px 0 0;
          max-width: 52ch;
        }

        /* ── the flow ───────────────────────────────────────────────────────
           TWO COLUMNS on a phone, four at 640, eight in one row at 1024. Not
           .fx-grid: this needs a KNOWN column count, because the arrow after
           the last node in a row has to point down-and-back rather than off
           the edge, and auto-fit does not tell you where the rows break.

           At 320px the two tracks are (280 - 14) / 2 = 133px each, and the
           node's own min-content is the longest word in a caption — well
           inside it. */
        .cap-flow {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 26px 14px;
          margin: 34px 0 0;
          padding: 0;
          list-style: none;
        }
        .cap-node {
          position: relative;
          min-width: 0;
          padding-right: 14px;
        }
        .cap-node__icon {
          display: grid;
          place-items: center;
          width: 46px;
          height: 46px;
          border-radius: 50%;
          background: ${C.paper};
          border: 1px solid ${C.border};
        }
        /* The icons are 48x48 line art drawn for a card. Scaled down here
           rather than redrawn: they are the same eight glyphs /features uses,
           and two sets of the same icon at two sizes is the kind of drift this
           module exists to prevent. */
        .cap-node__icon svg { width: 26px; height: 26px; display: block; }
        .cap-node__label {
          display: block;
          margin-top: 13px;
          font-family: ${T.display};
          font-size: 19px;
          font-weight: 400;
          line-height: 1.15;
          color: ${C.ink};
        }
        .cap-node__full {
          display: block;
          margin-top: 5px;
          font-size: 11.5px;
          font-weight: 300;
          line-height: 1.55;
          color: ${C.inkSoft};
        }
        /* The arrow sits on the node's own right edge, vertically level with
           the icon, and the one at the end of a row is hidden rather than
           bent: an arrow that leaves the page is worse than a row break the
           reader can already see. */
        .cap-arrow {
          position: absolute;
          top: 19px;
          right: -8px;
          color: ${C.gold};
          opacity: 0.7;
        }
        .cap-node:nth-child(2n) .cap-arrow { display: none; }

        /* ── everything else ────────────────────────────────────────────── */
        .cap-rest {
          margin-top: 40px;
          padding-top: 26px;
          border-top: 1px solid ${C.border};
        }
        .cap-rest__label {
          display: block;
          font-family: ${T.label};
          font-size: 9.5px;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: ${C.goldInk};
        }
        .cap-rest__list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 0;
          margin: 14px 0 0;
          padding: 0;
          list-style: none;
        }
        .cap-rest__list li { padding-right: 18px; }
        .cap-rest__list li {
          font-size: 13.5px;
          font-weight: 300;
          line-height: 1.5;
          color: ${C.ink};
        }
        /* A hairline between the names instead of a bullet: at this size a
           middot reads as punctuation inside the last word. A wrapped line
           carries its rule at the start, which is why the gap is 0 across —
           the rule and its padding ARE the spacing. */
        .cap-rest__list li + li {
          padding-left: 18px;
          border-left: 1px solid ${C.border};
        }
        .cap-more-link {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          margin-top: 24px;
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
        .cap-more-link:hover { color: ${C.goldInk}; border-color: ${C.goldInk}; }

        @media (min-width: 640px) {
          .cap-flow { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 30px 16px; }
          .cap-node:nth-child(2n) .cap-arrow { display: block; }
          .cap-node:nth-child(4n) .cap-arrow { display: none; }
        }

        @media (min-width: 768px) {
          .cap { padding: 122px 0; }
          .cap-kicker { font-size: 11px; letter-spacing: 0.38em; gap: 16px; }
          .cap-kicker__rule { width: 44px; }
          .cap-numeral { font-size: 15px; }
          .cap-h2 { font-size: 54px; margin-top: 22px; }
          .cap-sub { font-size: 17px; margin-top: 18px; }
          .cap-flow { margin-top: 56px; }
          .cap-rest { margin-top: 56px; }
          .cap-rest__list li { font-size: 14px; }
        }

        @media (min-width: 1024px) {
          /* One row of eight. The node is now about 122px wide inside a
             1200px container, which is why the caption is the SHORT line
             rather than the description. */
          .cap-flow { grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 0 10px; }
          .cap-node { padding-right: 10px; }
          .cap-node:nth-child(2n) .cap-arrow,
          .cap-node:nth-child(4n) .cap-arrow { display: block; }
          .cap-node:last-child .cap-arrow { display: none; }
          .cap-arrow { right: -10px; }
          .cap-node__label { font-size: 17px; }
          .cap-node__full { font-size: 11px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .cap-more-link { transition: none; }
        }
      `}</style>
    </section>
  );
}
