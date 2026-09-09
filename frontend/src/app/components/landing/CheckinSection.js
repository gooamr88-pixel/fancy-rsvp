import React from "react";
import FeatureBand from "./FeatureBand";
import { C, SHADOW, BEZEL } from "./landingTokens";
import { CHECKIN_SCREENS } from "../../utils/checkinApp";

/* ═══════════════════════════════════════════════════════════════════════════
   THE DOOR.

   One screen: the moment a pass is scanned.

   The picture is the app's own scan-result screen, rendered from the Android
   layout by scripts/renderCheckinScreens.js and imported from
   utils/checkinApp.js, which is the single place the door app's public facts
   live (the APK URL, the minimum Android version, these screens). Nothing here
   restates one of them — including the version, which this band used to print
   beside the caption and which belongs to that module alone.

   Three "proofs" with a paragraph each were cut for the reason given in
   SeatingSection: four bands running the same heading-plus-prose pattern is
   the wall this pass exists to take down. The offline claim survives because
   it is the one a venue actually asks about, and it is now inside the single
   sentence rather than a paragraph of its own.

   A Server Component: no state, no client JavaScript.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function CheckinSection() {
  const screen = CHECKIN_SCREENS[0];

  return (
    <FeatureBand
      id="checkin"
      tone="light"
      kicker="At the door"
      title="Check-in, made elegant."
      sub="Scan a guest in and their table, their party and their meal are on screen in a second — on a tablet that keeps working with no internet at all."
      cta={{ href: "/checkin-app", label: "See check-in in action" }}
    >
      <figure className="door-tablet">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={screen.src} alt={screen.alt} width={760} height={560} loading="lazy" />
        <figcaption>{screen.caption}</figcaption>
      </figure>

      {/* A plain style element — styled-jsx cannot be imported from a Server
          Component. Classes are prefixed "door-" instead.

          No backticks inside these CSS comments: one would end the template
          literal and produce a parse error. */}
      <style>{`
        /* A tablet body, because it IS one: a flat rectangle loses the fact
           that this is a physical thing standing at an entrance. */
        .door-tablet {
          margin: 0 auto;
          max-width: 760px;
          border-radius: 18px;
          padding: 12px;
          background: ${BEZEL};
          box-shadow: ${SHADOW.device};
        }
        .door-tablet img {
          display: block;
          width: 100%;
          height: auto;
          border-radius: 8px;
        }
        /* On the bezel, under the screen — the caption belongs to the object
           rather than to the band, so it does not add a line to the page. */
        .door-tablet figcaption {
          margin: 10px 4px 2px;
          text-align: center;
          font-size: 9.5px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: rgba(246, 242, 233, 0.55);
        }

        @media (min-width: 768px) {
          .door-tablet { border-radius: 24px; padding: 16px; }
          .door-tablet img { border-radius: 10px; }
          .door-tablet figcaption { margin-top: 14px; font-size: 10px; }
        }
      `}</style>
    </FeatureBand>
  );
}
