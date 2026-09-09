import React from "react";
import Link from "next/link";
import FeatureBand from "./FeatureBand";
import { C, T } from "./landingTokens";
import {
  HOMEPAGE_CAPABILITIES,
  REST_CAPABILITIES,
  REMAINING_CAPABILITY_COUNT,
  FLOW_LABEL,
} from "./platformCapabilities";

/* ═══════════════════════════════════════════════════════════════════════════
   ONE EVENT. ONE SYSTEM.

   The band that closes the argument. Everything above showed one thing at a
   time; this says the things know about each other, which is the actual reason
   to use this rather than a form, a spreadsheet and a WhatsApp group.

   ── ICONS AND NAMES, AND NOTHING ELSE ────────────────────────────────────

   Each node carried its capability's one-line caption underneath. Eight
   captions is eighty words in a diagram — it stopped being a diagram and
   became a table of contents with pictures. The mockup draws eight marks and
   eight nouns, and it is right: the SHAPE is the argument here, and the shape
   is "these connect". What each one does is on /features, one tap away, and
   every caption is still in platformCapabilities.js where that page reads it.

   The nodes are the SAME array /features renders, so a capability cannot be in
   the diagram and missing from that page, or the other way round. The five
   that are not steps in the sequence are printed by name underneath rather
   than hidden behind the link, because two of them (SMS campaigns, bilingual
   invitations) are things a visitor is specifically looking for and would
   otherwise leave without finding.

   A Server Component: no state, no client JavaScript.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function CapabilitiesSection() {
  return (
    <FeatureBand
      id="capabilities"
      tone="warm"
      kicker="One event. One system."
      title="From invitation to memories."
      sub="A form builder, a guest list, a seating plan, a messaging system and a door scanner — built to know about each other."
    >
      <div className="cap-wrap">
        {/* An ORDERED list, because the order is the argument. The arrows are
            separate spans rather than a border or a pseudo-element on the node
            so the last one can simply not be rendered — a trailing arrow into
            nothing is the classic version of this drawing done badly. */}
        <ol className="cap-flow">
          {HOMEPAGE_CAPABILITIES.map((c, i) => (
            <li key={c.key} className="cap-node">
              <span className="cap-node__icon" aria-hidden="true">{c.icon}</span>
              <span className="cap-node__label">{FLOW_LABEL[c.key] || c.title}</span>
              {i < HOMEPAGE_CAPABILITIES.length - 1 && (
                <span className="cap-arrow" aria-hidden="true">
                  <svg width="13" height="8" viewBox="0 0 15 8" fill="none">
                    <path d="M0 4h11M8.5 1L12 4l-3.5 3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
            </li>
          ))}
        </ol>

        <p className="cap-rest">
          <span className="cap-rest__label">Also included</span>
          {REST_CAPABILITIES.map((c) => c.title).join(" · ")}
          {REMAINING_CAPABILITY_COUNT > 0 && (
            <Link href="/features" className="cap-rest__link">What each one does</Link>
          )}
        </p>
      </div>

      {/* A plain style element — styled-jsx cannot be imported from a Server
          Component, and a scoped rule would never reach the next/link above.
          Classes are prefixed "cap-" instead.

          No backticks in these CSS comments: one would end the template
          literal and produce a parse error. */}
      <style>{`
        .cap-wrap { max-width: 900px; margin: 0 auto; }

        /* ── the flow ───────────────────────────────────────────────────────
           TWO COLUMNS on a phone, four at 640, eight in one row at 1024. Not
           .fx-grid: this needs a KNOWN column count, because the arrow after
           the last node in a row has to be hidden rather than left pointing
           off the edge, and auto-fit does not tell you where the rows break.

           At 320px the two tracks are (280 - 16) / 2 = 132px each, and a
           node's min-content is its longest word — well inside it. */
        .cap-flow {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 30px 16px;
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .cap-node {
          position: relative;
          min-width: 0;
          text-align: center;
        }
        /* A rounded SQUARE, as the mockup draws it — a circle at this size
           reads as an avatar, which is what every other circle on the page
           already is. */
        .cap-node__icon {
          display: grid;
          place-items: center;
          width: 52px;
          height: 52px;
          margin: 0 auto;
          border-radius: 14px;
          background: ${C.paper};
          border: 1px solid ${C.border};
        }
        /* The icons are 48x48 line art drawn for a card. Scaled down here
           rather than redrawn: they are the same eight glyphs /features uses,
           and two sets of one icon at two sizes is the drift this module
           exists to prevent. */
        .cap-node__icon svg { width: 26px; height: 26px; display: block; }
        .cap-node__label {
          display: block;
          margin-top: 12px;
          font-family: ${T.display};
          font-size: 17px;
          font-weight: 400;
          line-height: 1.2;
          color: ${C.ink};
        }
        /* Level with the icon, on the node's right edge. Hidden at the end of
           a row: an arrow that leaves the page is worse than a row break the
           reader can already see. */
        .cap-arrow {
          position: absolute;
          top: 22px;
          right: -8px;
          color: ${C.gold};
          opacity: 0.65;
        }
        .cap-node:nth-child(2n) .cap-arrow { display: none; }

        /* ── everything else, as ONE line ─────────────────────────────────── */
        .cap-rest {
          margin: 40px 0 0;
          font-size: 12.5px;
          font-weight: 300;
          line-height: 2;
          text-align: center;
          color: ${C.inkSoft};
        }
        .cap-rest__label {
          display: block;
          margin-bottom: 6px;
          font-family: ${T.label};
          font-size: 9.5px;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: ${C.goldInk};
        }
        /* ON ITS OWN LINE. Inline at the end of the list it read as a sixth
           capability called "What each one does" — the five names are separated
           by middots and a link in the same run joins the run. */
        .cap-rest__link {
          display: table;
          margin: 10px auto 0;
          color: ${C.ink};
          text-decoration: none;
          border-bottom: 1px solid ${C.gold};
          padding-bottom: 1px;
        }
        .cap-rest__link:hover { color: ${C.goldInk}; border-color: ${C.goldInk}; }

        @media (min-width: 640px) {
          .cap-flow { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 34px 16px; }
          .cap-node:nth-child(2n) .cap-arrow { display: block; }
          .cap-node:nth-child(4n) .cap-arrow { display: none; }
        }

        @media (min-width: 768px) {
          .cap-rest { margin-top: 52px; font-size: 13px; }
        }

        @media (min-width: 1024px) {
          /* One row of eight. */
          .cap-flow { grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 0 10px; }
          .cap-node:nth-child(2n) .cap-arrow,
          .cap-node:nth-child(4n) .cap-arrow { display: block; }
          .cap-node:last-child .cap-arrow { display: none; }
          .cap-arrow { right: -9px; }
          .cap-node__label { font-size: 16px; }
        }
      `}</style>
    </FeatureBand>
  );
}
