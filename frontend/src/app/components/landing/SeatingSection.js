import React from "react";
import FeatureBand from "./FeatureBand";
import { C, SHADOW } from "./landingTokens";

/* ═══════════════════════════════════════════════════════════════════════════
   THE SEATING PLAN.

   One screen: the room, drawn by the component that actually draws it.

   ── What this band used to carry, and why it does not ────────────────────

   A two-column layout with the plan on the left and three "proofs" on the
   right — a heading and a two-line paragraph each: it refuses to overbook,
   guests look themselves up, it prints properly. All three are true and all
   three are on /features. Together they turned a screen about a picture into
   a screen about a picture plus 60 words of prose, and the same pattern was
   repeating on the three bands either side of it. Four of those in a row is
   the wall the owner rejected.

   What survives is the sentence a stranger needs — you draw the room and drag
   names onto it — and the picture, which proves it faster than the prose did.

   The plate is a photograph of SeatingMiniMap rendering a real room (a head
   table, ten rounds, a stage, a dance floor, a bar and an entrance), produced
   by test/shots/landingShots.dump.jsx. Change the component and re-run it and
   this follows; change it and forget, and the homepage is out of date rather
   than fictional — which is the failure mode you want, because it is the one
   somebody notices.

   A Server Component: no state, no client JavaScript.
   ═══════════════════════════════════════════════════════════════════════════ */

const PLAN = {
  src: "/images/landing/dash-seating.webp",
  w: 980,
  h: 700,
  alt:
    "A seating plan: numbered round and oval tables with their chairs drawn in, a head table, and the venue's stage, dance floor, bar and entrance marked around them.",
};

export default function SeatingSection() {
  return (
    <FeatureBand
      id="seating"
      tone="light"
      kicker="Seating"
      title="Seat everyone. Without the spreadsheet."
      sub="Draw the room as it really is, drag names onto it, and every count follows — it will not let you overbook a table."
      cta={{ href: "/demo/dashboard", label: "See seating in action" }}
    >
      <figure className="seat-plate">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={PLAN.src} alt={PLAN.alt} width={PLAN.w} height={PLAN.h} loading="lazy" />
      </figure>

      {/* A plain style element — styled-jsx cannot be imported from a Server
          Component. Classes are prefixed "seat-" instead.

          No backticks inside these CSS comments: one would end the template
          literal and produce a parse error. */}
      <style>{`
        /* A plate, not a bezel: the plan is a drawing on paper — it is also
           what the venue prints — so it gets paper under it and a hairline
           round it rather than the dark device chrome the invitations use. */
        .seat-plate {
          margin: 0 auto;
          max-width: 860px;
          padding: 10px;
          background: ${C.paper};
          border: 1px solid ${C.border};
          border-radius: 14px;
          box-shadow: ${SHADOW.lift};
        }
        /* CROPPED ON A PHONE, WHOLE FROM 768 UP.
           The plan is 980x700. Inside a 342px gutter it renders 342 wide and
           244 tall, at which the table numerals — the entire point of the
           drawing — are about four pixels high and the zone labels are gone.
           A picture nobody can read is not a smaller picture, it is a grey
           rectangle.

           So on a phone it is a 4:3 window onto the MIDDLE of the room, which
           holds the head table and six of the rounds at nearly twice the size.
           The 42% vertical position is where those sit in this frame. The whole
           room is one breakpoint away, and one tap away in the demo.

           No backtick in this comment: the block is a template literal and one
           would terminate it. */
        .seat-plate img {
          display: block;
          width: 100%;
          height: auto;
          aspect-ratio: 4 / 3;
          object-fit: cover;
          object-position: 50% 42%;
          border-radius: 6px;
        }

        @media (min-width: 768px) {
          .seat-plate { padding: 16px; border-radius: 18px; }
          .seat-plate img { aspect-ratio: auto; object-fit: fill; }
        }
      `}</style>
    </FeatureBand>
  );
}
