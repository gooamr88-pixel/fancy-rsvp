'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { COLLECTION, FILTERS, collectionFor, countFor } from './collectionCatalogue';
import { C, T, SHADOW, BEZEL } from '../components/landing/landingTokens';

/* ═══════════════════════════════════════════════════════════════════════════
   THE GALLERY — four invitations, and a chip that changes what you see.

   ── WHY THIS IS A CLIENT COMPONENT AND THE PAGE IS NOT ───────────────────

   The filter is state, so this file is 'use client'. Everything ABOVE it —
   the page shell, the heading, the metadata, the JSON-LD, the closing strip —
   stays a Server Component in page.js, and the whole COLLECTION array is
   rendered here on the server for the first paint. A crawler and a visitor
   with a slow connection both get all four plates in the HTML; the chip only
   ever re-orders and hides what is already there.

   That is the opposite of the usual arrangement, and it is the point: an
   occasion filter that fetches, or that server-renders one occasion at a
   time, would put a network round trip between "wedding" and four cards that
   were already on the page.

   ── THE PICTURE IS THE ARGUMENT ──────────────────────────────────────────

   No specs on a plate, no feature list, no price. A name, what it is made of,
   what the guest does to open it, and a way in. Everything else is on the
   template's own page, which is one tap away and is where somebody who has
   already chosen a favourite is going anyway.

   ONE PLAIN <style>, not <style jsx>: every "button" and "link" below that
   carries a class is a next/link, and styled-jsx stamps its hash class only
   onto lowercase intrinsic elements — a scoped rule aimed at one of these
   would compile to `.col-plate.jsx-hash` and match nothing at all. Classes
   are prefixed "col-" instead. No backtick may appear inside the CSS comments
   in that literal; one would terminate the string and produce a parse error.
   ═══════════════════════════════════════════════════════════════════════════ */

function Plate({ item, index }) {
  return (
    <li className="col-plate">
      {/* THE WHOLE PLATE IS THE LINK, and there is exactly one of them.
          A card with a linked picture, a linked title and a "View live"
          link is three targets to the same URL — three tab stops, and three
          identical announcements for anyone using a screen reader. One
          anchor wraps the lot; the arrow below is a visual affordance inside
          it rather than a second link. */}
      <Link href={`/collection/${item.key}`} className="col-plate__link">
        <span className="col-device">
          {/* DECORATIVE, and that is the accessible choice here rather than a
              shortcut. The whole plate is ONE link, and the text inside it
              already reads "Swan Lake · Any occasion · Cinematic, Olive &
              Ivory · They break the seal, the card rises out · View live".
              An alt of "The Swan Lake invitation, Cinematic · Olive & Ivory"
              adds nothing to that and makes the link's accessible name say
              the same two facts twice before getting to the useful ones.
              Everything the picture conveys beyond the name is how it LOOKS,
              which is what the detail page one tap away is for. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.art}
            alt=""
            width={468}
            height={1013}
            /* The first two are what a visitor sees before they scroll. The
               rest are below the fold on every viewport this page has. */
            loading={index < 2 ? 'eager' : 'lazy'}
          />
        </span>

        {/* A REAL HEADING, not a styled span. These four names are the
            landmarks of the page — jumping between headings is how a screen
            reader user skims a gallery — and a span gives them nothing to
            jump to. h2 because the page's h1 is the gallery's own title; the
            homepage band uses h3 under its own h2 for the same reason.
            Inside the link is fine: an anchor's content model is transparent,
            and the heading is what the link is FOR. */}
        <span className="col-namerow">
          <h2 className="col-name">{item.label}</h2>
          <span className={`col-badge${item.locked ? ' col-badge--locked' : ''}`}>{item.badge}</span>
        </span>

        <span className="col-tagline">{item.tagline}</span>
        <span className="col-arrival">{item.arrival}</span>

        <span className="col-open">
          View live
          <svg width="15" height="10" viewBox="0 0 16 10" fill="none" aria-hidden="true" focusable="false">
            <path d="M0 5h13M10 1l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </Link>
    </li>
  );
}

export default function CollectionGallery() {
  const [occasion, setOccasion] = useState(null);
  const shown = collectionFor(occasion);

  return (
    <div className="col-gallery">
      {/* A TOOLBAR OF BUTTONS, not a list of links.
          These do not navigate — pressing one re-orders a list that is
          already on the page — so a link would lie about what happens and
          would break the back button into a filter history nobody wants.
          `aria-pressed` is what announces the current state. */}
      <div className="col-chips" role="group" aria-label="Filter invitations by occasion">
        {FILTERS.map((f) => {
          const on = occasion === f.key;
          return (
            <button
              key={f.label}
              type="button"
              onClick={() => setOccasion(f.key)}
              aria-pressed={on}
              className={`col-chip${on ? ' col-chip--on' : ''}`}
            >
              {f.label}
              {/* The count is what keeps a lightly-filtering chip honest.
                  Hidden from assistive tech: "Wedding 4" read aloud as part
                  of the button name is a worse label than "Wedding", and the
                  list below announces its own length. */}
              <span aria-hidden="true" className="col-chip__n">{countFor(f.key)}</span>
            </button>
          );
        })}
      </div>

      {/* Announced when the chip changes, because the visual result of
          pressing a filter is off-screen for anyone not looking at the grid. */}
      <p className="col-live" role="status">
        {shown.length === COLLECTION.length
          ? `All ${COLLECTION.length} invitations`
          : `${shown.length} of ${COLLECTION.length} invitations`}
      </p>

      {/* A CENTRED FLEX ROW, NOT .fx-grid — and this is the one place on the
          page that departs from the house primitive, so it is worth saying
          why rather than leaving it to look like carelessness.

          .fx-grid is auto-fit, so its column count is
          floor((container + gap) / (--fx-col + gap)) — a function of the
          viewport. With FOUR items that is a trap, because the count lands on
          three at some widths and the fourth invitation is then stranded
          alone on a second row, hard against the left edge, reading as a
          mistake rather than as a collection. That is not hypothetical: it is
          what the first version of this page did at 1280, which is the most
          common desktop width there is. Tuning --fx-col does not solve it,
          it only moves it — 4-up at 1280 needs a column of 267px or less,
          2-up at 1024 needs 294px or more, and no single value is both.

          Wrapping and CENTRING removes the failure instead of relocating it.
          A short last row sits in the middle of the page at every width, which
          reads as composition; the plates keep one honest size instead of
          stretching to fill whatever the track happens to be; and a 9:19.5
          phone screen never gets so wide that its own height runs away (at a
          467px track it would be over 1,000px tall).

          It is still intrinsically responsive — the thing .fx-grid exists to
          guarantee. A wrapping flex row's min-content width is the width of
          its widest child, not the sum, so the 320px proof in AGENTS.md holds.
          What it is NOT is a fixed-column grid, which is what that rule
          actually forbids. */}
      <ul className="col-plates">
        {shown.map((item, i) => <Plate key={item.key} item={item} index={i} />)}
      </ul>

      <style>{`
        .col-gallery { margin-top: 34px; }

        /* ── the chips ─────────────────────────────────────────────────────
           A wrapping row, never a scroller. Four short labels fit 280px in
           two rows; .fx-scroll-x would hide the fourth behind an edge with
           nothing to say it was there. */
        .col-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding-bottom: 22px;
          border-bottom: 1px solid ${C.border};
        }
        .col-chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          /* 44px, the touch minimum. Every other size on this page is
             typographic; this one is ergonomic and must not be tuned down. */
          min-height: 44px;
          padding: 0 17px;
          background: transparent;
          color: ${C.inkSoft};
          border: 1px solid ${C.border};
          border-radius: 0;
          font-family: ${T.body};
          font-size: 10.5px;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          white-space: nowrap;
          cursor: pointer;
          transition: background 0.3s ease, color 0.3s ease, border-color 0.3s ease;
        }
        .col-chip:hover { border-color: ${C.gold}; color: ${C.ink}; }
        .col-chip--on {
          background: ${C.ink};
          border-color: ${C.ink};
          color: ${C.paper};
        }
        .col-chip__n {
          font-size: 9.5px;
          font-weight: 500;
          letter-spacing: 0.08em;
          opacity: 0.6;
        }

        .col-live {
          margin: 16px 0 0;
          font-family: ${T.body};
          font-size: 10px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: ${C.inkSoft};
          opacity: 0.75;
        }

        /* ── the plates ─────────────────────────────────────────────────
           See the note in the JSX for why this wraps and centres rather than
           using .fx-grid. The measured budget at the widths that matter:

             1280 viewport -> 1184 content, ~36px gap
                              4 x 260 + 3 x 36 = 1148  (fits, 36px spare)
             1024          ->  943 content, ~29px gap
                              3 x 260 + 2 x 29 =  838  (fourth wraps, centred)
             1480+         -> 1384 content, 44px gap
                              4 x 260 + 3 x 44 = 1172  (fits, centred)

           The basis never GROWS (flex-grow 0), so a plate is the same size on
           a 1280 laptop and a 4K monitor and the row simply centres in more
           space. A grown plate is a taller plate here, and these pictures are
           already 2.16 times as tall as they are wide. */
        .col-plates {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: clamp(28px, 2.8vw, 44px);
          margin: 30px 0 0;
          padding: 0;
          list-style: none;
        }
        .col-plate {
          flex: 0 1 260px;
          max-width: 100%;
          min-width: 0;
        }
        /* On a phone the plate is the screen. A 260px basis there would leave
           a 45px moat down both sides of the one thing the page is for. */
        @media (max-width: 639.98px) {
          .col-plate { flex-basis: 100%; }
        }
        .col-plate__link {
          display: flex;
          flex-direction: column;
          text-decoration: none;
          /* The plate is one anchor wrapping block-level content, so every
             child is a span and the layout is done here rather than by the
             default inline flow. */
          color: inherit;
        }
        /* The focus ring goes on the LINK, not on the picture inside it —
           a ring drawn around the image alone leaves the name and the arrow
           outside the box a keyboard user is being shown. */
        .col-plate__link:focus-visible {
          outline: 2px solid ${C.goldInk};
          outline-offset: 6px;
        }

        .col-device {
          display: block;
          border-radius: 22px;
          padding: 5px;
          background: ${BEZEL};
          box-shadow: ${SHADOW.device};
          /* The lift is on the DEVICE and not on the whole plate: moving the
             text with it makes the caption swim, and the shadow under a
             raised card is the entire illusion. */
          transition: transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.5s ease;
        }
        .col-plate__link:hover .col-device,
        .col-plate__link:focus-visible .col-device {
          transform: translateY(-8px);
          box-shadow: ${SHADOW.device}, 0 60px 90px -40px rgba(25, 24, 21, 0.42);
        }
        .col-device img {
          display: block;
          width: 100%;
          height: auto;
          border-radius: 17px;
        }

        .col-namerow {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 14px;
          margin-top: 24px;
          padding-bottom: 12px;
          border-bottom: 1px solid ${C.border};
        }
        .col-name {
          font-family: ${T.display};
          font-size: 25px;
          font-weight: 400;
          line-height: 1.12;
          letter-spacing: -0.01em;
          color: ${C.ink};
          min-width: 0;
        }
        .col-badge {
          flex: none;
          font-family: ${T.body};
          font-size: 8.5px;
          font-weight: 600;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: ${C.inkSoft};
          opacity: 0.75;
          white-space: nowrap;
        }
        /* A template made for exactly one occasion says so in the readable
           gold rather than in grey — it is a fact about the artwork, not a
           footnote. goldInk, never gold: this is text at 8.5px. */
        .col-badge--locked { color: ${C.goldInk}; opacity: 1; }

        .col-tagline {
          display: block;
          margin-top: 12px;
          font-family: ${T.body};
          font-size: 10px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: ${C.inkSoft};
          opacity: 0.8;
        }
        .col-arrival {
          display: block;
          margin-top: 12px;
          font-family: ${T.display};
          font-size: 17px;
          font-style: italic;
          line-height: 1.4;
          color: ${C.goldInk};
        }

        .col-open {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          align-self: flex-start;
          margin-top: 18px;
          padding-bottom: 6px;
          border-bottom: 1px solid ${C.gold};
          font-family: ${T.body};
          font-size: 10.5px;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: ${C.ink};
          transition: color 0.3s ease, border-color 0.3s ease;
        }
        .col-plate__link:hover .col-open { color: ${C.goldInk}; border-color: ${C.goldInk}; }

        @media (min-width: 768px) {
          .col-gallery { margin-top: 44px; }
          .col-chip { font-size: 11px; padding: 0 21px; }
          .col-plates { margin-top: 40px; }
          .col-device { border-radius: 26px; padding: 6px; }
          .col-device img { border-radius: 21px; }
          .col-name { font-size: 28px; }
          .col-arrival { font-size: 18px; }
        }

        /* A card that lifts under the pointer is decoration; a card that
           lifts for somebody who has asked the OS to stop moving things is a
           headache. The hover state keeps its shadow and drops the travel. */
        @media (prefers-reduced-motion: reduce) {
          .col-device, .col-open, .col-chip { transition: none; }
          .col-plate__link:hover .col-device,
          .col-plate__link:focus-visible .col-device { transform: none; }
        }
      `}</style>
    </div>
  );
}
