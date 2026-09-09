import React from "react";
import Link from "next/link";
import { C, T, SHADOW, BEZEL } from "./landingTokens";

/* ═══════════════════════════════════════════════════════════════════════════
   WHAT IT IS LIKE TO BE INVITED.

   The band above shows the invitations as objects in a catalogue. This one is
   about the thirty seconds a guest spends inside one, which is the part of
   this product nobody can be told about — they have to open one.

   So the whole band is a door to the live demo. The device is a link, the
   tile under it is the same link, and both go to /demo/invitation, which is
   the REAL guest page running on sample data (see demo/invitation/page.js).

   ── THE PLAY MARK IS NOT A VIDEO PLAYER ──────────────────────────────────

   The mockup drew a play button over the phone. A play button that opens a
   route rather than starting a video is a promise broken half a second after
   it is made, so the mark here is drawn as an "open" affordance and the label
   next to it says where it goes. The invitations really do open on film — the
   footage is in public/templates — but it plays on the invitation, not here.

   A Server Component: no state, no client JavaScript.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The opened Swan Lake page, photographed from the shipping template by
 *  test/shots/templateShots.dump.jsx. The hero shows the same invitation
 *  sealed; this is the other half of that sentence. */
const SHOT = {
  src: "/images/landing/hero-swans.webp",
  w: 468,
  h: 1013,
  alt:
    "The Swan Lake invitation open on a phone: the couple's names over a painted lake, the date, and the buttons a guest uses to reply.",
};

/** What the guest can actually DO once it is open — four verbs, in the order
 *  they happen. Not a feature list: every one of these is a thing that
 *  happens on the guest's own screen, which is what this band is about. */
const GUEST_CAN = [
  "Reply for their whole party",
  "Choose each person's meal",
  "Look up their own table",
  "Carry a scannable entry pass",
];

export default function GuestExperienceSection() {
  return (
    <section id="experience" className="ge" aria-labelledby="ge-title">
      {/* THREE BLOCKS, NOT TWO, and that is what buys the order on a phone.
          A reader has to be told what they are looking at BEFORE they are shown
          it, and given something to do with it AFTER — heading, picture, then
          the list and the way in. With the copy as one block the picture could
          only sit above all of it or below all of it, and it sat below the
          call to action, which is the one place it is no use. Desktop puts the
          picture in its own column beside both. Same arrangement as the hero,
          for the same reason. */}
      <div className="fx-container fx-container--5xl fx-gutter ge-grid">
        <header className="ge-head">
          <span className="ge-kicker">
            See the experience
            <span aria-hidden="true" className="ge-kicker__rule" />
          </span>
          <span className="ge-numeral" aria-hidden="true">II</span>
          <h2 id="ge-title" className="ge-h2">
            More than an invitation. <em>A moment.</em>
          </h2>
          <p className="ge-sub">
            A guest taps a wax seal and it breaks. What is behind it was filmed,
            not animated — and it carries their name, your date and everything
            they need to answer, in English or Arabic.
          </p>
        </header>

        {/* IN THE MARKUP BETWEEN THE TWO COPY BLOCKS, not reordered into place
            with CSS `order`. On a phone the visual order and the DOM order are
            then the same one — heading, picture, actions — so a keyboard
            reaches the device link before the tile rather than after it, which
            is what a sighted reader sees. */}
        <figure className="ge-art">
          <Link href="/demo/invitation" className="ge-device" aria-label="Open the live invitation">
            <span aria-hidden="true" className="ge-device__ground" />
            <span className="ge-device__body">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={SHOT.src} alt={SHOT.alt} width={SHOT.w} height={SHOT.h} loading="lazy" />
            </span>
            {/* ON THE BEZEL, NOT ON THE SCREEN.
                It sat 18px up from the bottom of the picture, which put it
                squarely over the invitation's own "Save the invitation"
                button — so the shot showed two buttons, one of them ours,
                pretending to belong to the product being photographed. It now
                straddles the bottom edge of the device the way a caption plate
                sits on a frame: unmistakably OUR affordance, covering none of
                the thing it is pointing at. */}
            <span className="ge-device__cue" aria-hidden="true">
              <span className="ge-device__play" />
              Open it
            </span>
          </Link>

          {/* The mockup's handwritten note, set in the display italic rather
              than a script face: there is no script in this page's type
              system, and adding one for six words would be a whole extra
              font request. */}
          <figcaption className="ge-note">
            <svg className="ge-note__arrow" width="52" height="38" viewBox="0 0 52 38" fill="none" aria-hidden="true">
              <path d="M50 2C40 4 22 8 12 20c-3 4-5 9-5 13" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
              <path d="M2 27l5 7 7-4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>This one is live. Tap it and try.</span>
          </figcaption>
        </figure>

        <div className="ge-body">
          <ul className="ge-can">
            {GUEST_CAN.map((line) => (
              <li key={line}>
                <svg width="13" height="10" viewBox="0 0 13 10" fill="none" aria-hidden="true">
                  <path d="M1 5l3.6 3.5L12 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {line}
              </li>
            ))}
          </ul>

          <Link href="/demo/invitation" className="ge-tile">
            {/* AN OPEN ENVELOPE. The first version of this was a PADLOCK — the
                one glyph on the web that means "you cannot have this", sitting
                beside an invitation to come in. It read as a locked feature in
                the screenshot before anybody noticed what it was. */}
            <span className="ge-tile__mark" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9.5v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9" />
                <path d="M3 9.5L12 15l9-5.5" />
                <path d="M3 9.5L12 3l9 6.5" />
              </svg>
            </span>
            <span className="ge-tile__text">
              <span className="ge-tile__title">Try the guest experience</span>
              <span className="ge-tile__note">No sign-up. It opens exactly as theirs will.</span>
            </span>
            <span className="ge-tile__arrow" aria-hidden="true">
              <svg width="16" height="9" viewBox="0 0 16 9" fill="none">
                <path d="M0 4.5h14M11 1l3.5 3.5L11 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </Link>
        </div>
      </div>

      {/* A plain style element — styled-jsx cannot be imported from a Server
          Component, and a scoped rule would never attach to the next/link
          above. Classes are prefixed "ge-" instead.

          No backticks inside these CSS comments: one would end the template
          literal and produce a parse error. */}
      <style>{`
        .ge {
          width: 100%;
          background: ${C.paper};
          padding: 72px 0;
        }
        .ge-grid {
          display: flex;
          flex-direction: column;
          gap: 34px;
        }
        .ge-body { min-width: 0; }

        .ge-head {
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          column-gap: 20px;
        }
        .ge-kicker {
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
        .ge-kicker__rule {
          display: block;
          flex: none;
          width: 28px;
          height: 1px;
          background: ${C.gold};
          opacity: 0.55;
        }
        .ge-numeral {
          font-family: ${T.display};
          font-style: italic;
          font-size: 13px;
          color: ${C.goldInk};
          opacity: 0.75;
        }
        .ge-h2 {
          grid-column: 1 / -1;
          font-family: ${T.display};
          font-weight: 300;
          font-size: 37px;
          line-height: 1.07;
          letter-spacing: -0.015em;
          color: ${C.ink};
          margin: 18px 0 0;
        }
        .ge-h2 em { font-style: italic; color: ${C.gold}; }
        .ge-sub {
          grid-column: 1 / -1;
          font-size: 15.5px;
          font-weight: 300;
          line-height: 1.85;
          color: ${C.inkSoft};
          margin: 14px 0 0;
          max-width: 48ch;
        }

        /* No top margin: the list is the first thing in its own block now, and
           the grid gap above it is the spacing. */
        .ge-can {
          margin: 0;
          padding: 0;
          list-style: none;
          display: grid;
          gap: 11px;
        }
        .ge-can li {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          align-items: start;
          gap: 11px;
          font-size: 13.5px;
          font-weight: 300;
          line-height: 1.5;
          color: ${C.ink};
        }
        .ge-can svg { color: ${C.goldInk}; margin-top: 5px; }

        /* ── the tile ───────────────────────────────────────────────────── */
        .ge-tile {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          align-items: center;
          gap: 14px;
          margin-top: 28px;
          padding: 16px 18px;
          background: ${C.paper2};
          border: 1px solid ${C.border};
          text-decoration: none;
          transition: background 0.3s ease, border-color 0.3s ease;
        }
        .ge-tile:hover { background: ${C.paper3}; border-color: ${C.gold}; }
        .ge-tile__mark {
          display: grid;
          place-items: center;
          flex: none;
          width: 42px;
          height: 42px;
          border-radius: 50%;
          background: ${C.paper};
          border: 1px solid ${C.border};
          color: ${C.goldInk};
        }
        .ge-tile__text { min-width: 0; }
        .ge-tile__title {
          display: block;
          font-family: ${T.display};
          font-size: 19px;
          font-weight: 400;
          line-height: 1.2;
          color: ${C.ink};
        }
        .ge-tile__note {
          display: block;
          margin-top: 3px;
          font-size: 12px;
          font-weight: 300;
          line-height: 1.5;
          color: ${C.inkSoft};
        }
        .ge-tile__arrow { flex: none; color: ${C.goldInk}; }

        /* ── the device ─────────────────────────────────────────────────── */
        .ge-art { margin: 0; }
        .ge-device {
          position: relative;
          display: block;
          width: 62%;
          max-width: 280px;
          margin: 0 auto;
          text-decoration: none;
        }
        .ge-device__ground {
          position: absolute;
          left: 8%;
          right: 8%;
          bottom: -14px;
          height: 30px;
          background: radial-gradient(ellipse at 50% 50%, rgba(25, 24, 21, 0.26), transparent 70%);
          filter: blur(7px);
          pointer-events: none;
        }
        .ge-device__body {
          position: relative;
          display: block;
          border-radius: 26px;
          padding: 5px;
          background: ${BEZEL};
          box-shadow: ${SHADOW.device};
        }
        .ge-device__body img {
          display: block;
          width: 100%;
          height: auto;
          border-radius: 21px;
        }
        /* Sits ON the device, low, where a caption would be on a poster. It is
           aria-hidden because the link already has a label — a screen reader
           reading "open it" after "Open the live invitation" is the same
           sentence twice. */
        .ge-device__cue {
          position: absolute;
          left: 50%;
          bottom: -17px;
          transform: translateX(-50%);
          z-index: 2;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 9px 16px;
          border-radius: 999px;
          background: rgba(252, 251, 248, 0.92);
          color: ${C.ink};
          font-family: ${T.body};
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          white-space: nowrap;
          box-shadow: 0 6px 18px -8px rgba(12, 10, 6, 0.5);
        }
        .ge-device__play {
          display: block;
          flex: none;
          width: 0;
          height: 0;
          border-style: solid;
          border-width: 4.5px 0 4.5px 7px;
          border-color: transparent transparent transparent currentColor;
        }
        .ge-device:hover .ge-device__cue { background: ${C.ivory}; }

        .ge-note {
          display: flex;
          align-items: flex-start;
          justify-content: center;
          gap: 8px;
          margin: 26px 0 0;
          color: ${C.goldInk};
        }
        .ge-note__arrow { flex: none; opacity: 0.7; transform: scaleX(-1); }
        .ge-note span {
          font-family: ${T.display};
          font-style: italic;
          font-size: 17px;
          line-height: 1.35;
          padding-top: 6px;
        }

        /* ── 768 and up ─────────────────────────────────────────────────── */
        @media (min-width: 768px) {
          .ge { padding: 122px 0; }
          /* The picture takes its own column and spans both copy blocks, and
             it is the FIRST column: the eye enters from the left, and this
             band's argument is the object rather than the sentence. */
          .ge-grid {
            display: grid;
            grid-template-columns: minmax(0, 0.98fr) minmax(0, 1.02fr);
            grid-template-rows: auto auto;
            column-gap: 78px;
            row-gap: 30px;
            align-items: start;
          }
          .ge-art { grid-column: 1; grid-row: 1 / span 2; align-self: center; }
          .ge-head { grid-column: 2; grid-row: 1; }
          .ge-body { grid-column: 2; grid-row: 2; }
          .ge-kicker { font-size: 11px; letter-spacing: 0.38em; gap: 16px; }
          .ge-kicker__rule { width: 44px; }
          .ge-numeral { font-size: 15px; }
          .ge-h2 { font-size: 54px; margin-top: 22px; }
          .ge-sub { font-size: 17px; margin-top: 18px; }
          .ge-can li { font-size: 14.5px; }
          .ge-tile { margin-top: 34px; padding: 18px 22px; }
          .ge-tile__title { font-size: 21px; }
          .ge-device { width: 78%; max-width: 340px; }
          .ge-note { justify-content: flex-start; margin-top: 30px; }
          .ge-note span { font-size: 19px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .ge-tile { transition: none; }
        }
      `}</style>
    </section>
  );
}
