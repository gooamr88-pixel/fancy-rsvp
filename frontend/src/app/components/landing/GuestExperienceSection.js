import React from "react";
import Link from "next/link";
import FeatureBand from "./FeatureBand";
import { C, T, SHADOW, BEZEL } from "./landingTokens";

/* ═══════════════════════════════════════════════════════════════════════════
   WHAT IT IS LIKE TO BE INVITED.

   One screen: the invitation, open, and a way into the live one.

   The band above shows the invitations as objects in a catalogue. This one is
   about the thirty seconds a guest spends inside one, which is the part of
   this product nobody can be told about — they have to open one. So the whole
   band is a door: the device is a link, the pill under it is the same link,
   and both go to /demo/invitation, which is the REAL guest page running on
   sample data (see demo/invitation/page.js).

   ── THE PLAY MARK IS NOT A VIDEO PLAYER ──────────────────────────────────

   The mockup drew a play button over the phone. A play button that opens a
   route rather than starting a video is a promise broken half a second after
   it is made, so the mark is drawn as an "open" affordance and the label next
   to it says where it goes. The invitations really do open on film — the
   footage is in public/templates — but it plays on the invitation, not here.

   A four-item checklist ("reply for their whole party", "choose each person's
   meal", …) used to sit between the heading and the picture. It was true and
   it was four more lines of text on a screen whose whole argument is a
   photograph you can tap. Gone, with the proofs on the three bands below.

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

export default function GuestExperienceSection() {
  return (
    <FeatureBand
      id="experience"
      tone="light"
      kicker="See the experience"
      title="More than an invitation. A moment."
      sub="A guest taps the wax seal and it breaks. What is behind it was filmed, not animated — in English, Arabic, or both."
      cta={{ href: "/demo/invitation", label: "Try the guest experience" }}
    >
      <figure className="ge-art">
        {/* THE DEVICE IS THE LINK. Wrapping the whole figure rather than
            putting a button on top of it means the biggest, most obviously
            tappable thing in the band is the thing that opens the demo. */}
        <Link href="/demo/invitation" className="ge-device" aria-label="Open the live invitation">
          <span aria-hidden="true" className="ge-device__ground" />
          <span className="ge-device__body">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={SHOT.src} alt={SHOT.alt} width={SHOT.w} height={SHOT.h} loading="lazy" />
          </span>
          {/* ON THE BEZEL, NOT ON THE SCREEN. It sat 18px up from the bottom
              of the picture, which put it over the invitation's own "Save the
              invitation" button — so the shot showed two buttons, one of them
              ours, pretending to belong to the product being photographed. */}
          <span className="ge-device__cue" aria-hidden="true">
            <span className="ge-device__play" />
            Open it
          </span>
        </Link>

        {/* The mockup's handwritten note, set in the display italic rather than
            a script face: there is no script in this page's type system, and
            adding one for six words would be a whole extra font request. */}
        <figcaption className="ge-note">
          <svg className="ge-note__arrow" width="46" height="34" viewBox="0 0 52 38" fill="none" aria-hidden="true">
            <path d="M50 2C40 4 22 8 12 20c-3 4-5 9-5 13" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
            <path d="M2 27l5 7 7-4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>This one is live. Tap it and try.</span>
        </figcaption>
      </figure>

      {/* A plain style element — styled-jsx cannot be imported from a Server
          Component, and a scoped rule would never attach to the next/link
          above. Classes are prefixed "ge-" instead.

          No backticks inside these CSS comments: one would end the template
          literal and produce a parse error. */}
      <style>{`
        .ge-art { margin: 0; }
        .ge-device {
          position: relative;
          display: block;
          width: 62%;
          max-width: 264px;
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
        .ge-device__cue {
          position: absolute;
          left: 50%;
          bottom: -17px;
          z-index: 2;
          transform: translateX(-50%);
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 9px 16px;
          border-radius: 999px;
          background: rgba(252, 251, 248, 0.94);
          color: ${C.ink};
          font-family: ${T.body};
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          white-space: nowrap;
          box-shadow: 0 6px 18px -8px rgba(12, 10, 6, 0.5);
        }
        /* A play mark drawn in CSS rather than shipped as an icon: it is three
           borders, and an SVG for a triangle is a request for a triangle. */
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
          margin: 34px 0 0;
          color: ${C.goldInk};
        }
        .ge-note__arrow { flex: none; opacity: 0.7; transform: scaleX(-1); }
        .ge-note span {
          font-family: ${T.display};
          font-style: italic;
          font-size: 17px;
          line-height: 1.35;
          padding-top: 4px;
        }

        @media (min-width: 768px) {
          .ge-device { width: 74%; max-width: 300px; }
          .ge-note span { font-size: 19px; }
        }
      `}</style>
    </FeatureBand>
  );
}
