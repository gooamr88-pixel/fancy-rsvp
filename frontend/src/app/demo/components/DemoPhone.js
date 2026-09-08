'use client';

import React from 'react';
import PreviewFrame from '../../components/templates/PreviewFrame';
import { C, T, SHADOW, BEZEL } from '../../components/landing/landingTokens';

/* ═══════════════════════════════════════════════════════════════════════════
   THE INVITATION, HELD.

   ── WHY THIS IS ALWAYS AN IFRAME, ON A PHONE TOO ─────────────────────────

   The guest page is responsive against the VIEWPORT — `clamp(38px, 7.2vw,
   66px)` for the couple's names, `min(84vw, 322px)` for the card, `100dvh`
   per section. Rendering it into a 390px-wide div on a 1440px desktop does
   not make any of it believe it is on a phone: 7.2vw is 104px, so the names
   clamp to their desktop maximum, and not one mobile media query matches.
   PreviewFrame gives the page its own viewport, so 390px wide IS 390px.

   It stays an iframe below 768 as well, where the real viewport is already a
   phone and the frame is therefore redundant. That is deliberate. Two mount
   paths — framed on desktop, bare on mobile — is two renderings of the same
   page that can diverge, and the one that diverges is always the one nobody
   is looking at. One path, checked once.

   ── AND WHY THE VISITOR HAS TO TAP THE SEAL THEMSELVES ───────────────────

   Nothing here autoplays, which is a technical fact before it is a taste.
   The opening's sound (useOpeningSfx) needs a user gesture, and a gesture in
   the PARENT document does not reliably grant one to a child browsing
   context — so a cover opened by the page rather than by the visitor would
   play silently. Tapping the seal is both the whole point and the only way
   the wax actually cracks out loud.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function DemoPhone({ children, title = 'Fancy invitation demo', caption }) {
  return (
    <figure className="demo-phone">
      <div className="demo-phone__body">
        {/* The ground the object stands on. Two floating rectangles with no
            contact shadow read as stickers rather than as something you could
            pick up — the same reason the hero has one. */}
        <span aria-hidden="true" className="demo-phone__ground" />
        <div className="demo-phone__bezel">
          {/* NO INLINE width/height. PreviewFrame spreads `style` onto the
              wrapper that holds its iframe, and a `height: 100%` there is a
              percentage against a box whose height comes from `min-height` —
              which CSS does not treat as definite, so it resolves to `auto`
              and the whole phone collapses to the height of one line of text.
              That is not hypothetical: it is what the first screenshot of
              this component showed. The chain is flex the whole way down
              instead, so each box is STRETCHED to its parent rather than
              asking it how tall it is. */}
          <PreviewFrame title={title} className="demo-phone__screen">
            {children}
          </PreviewFrame>
        </div>
      </div>
      {caption && <figcaption className="demo-phone__caption">{caption}</figcaption>}

      <style>{`
        /* NOT ONE PERCENTAGE HEIGHT IN THIS COMPONENT, and every one of them
           was removed because a screenshot caught it.

           A percentage height only resolves against a parent whose own height
           is DEFINITE. A height that comes from "min-height", or from growing
           inside a flex column, is not definite — CSS falls back to "auto",
           silently. The first version of this file set "height: 100%" at
           three levels: the phone collapsed to the height of one line of
           text, and the second version painted at its 560px floor inside an
           880px room.

           So the chain is flex from the figure down to the frame, and each
           box is STRETCHED by its parent instead of asking the parent how
           tall it is. Every caller lays this out as a flex container for the
           same reason. */
        .demo-phone {
          margin: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
          min-height: 0;
        }

        /* PHONE: edge to edge. The device in the visitor's hand is the
           device, so a picture of a device around it would be a frame around
           a frame. */
        /* FLEX ALL THE WAY DOWN to the frame. Each box stretches to its
           parent's cross size instead of asking for a percentage of a height
           that is not definite. */
        .demo-phone__body {
          position: relative;
          display: flex;
          width: 100%;
          flex: 1 1 auto;
          /* A floor on the phone too, not only on the desktop object. Stage 1
             hands this a full-height room and never reaches it; stage 3 on a
             phone stacks the controls under a figure with no room to inherit,
             and without a floor the invitation would have no height at all. */
          min-height: 480px;
        }
        .demo-phone__ground { display: none; }
        .demo-phone__bezel {
          position: relative;
          z-index: 2;
          display: flex;
          flex: 1 1 auto;
          min-width: 0;
          background: #FFFFFF;
        }
        .demo-phone__screen {
          display: flex;
          flex: 1 1 auto;
          min-width: 0;
        }
        .demo-phone__caption { display: none; }

        /* DESKTOP: an object, lit, standing on something. */
        @media (min-width: 768px) {
          .demo-phone { padding: 26px 0 30px; }
          .demo-phone__body {
            width: 390px;
            max-width: 100%;
            /* Tall as the room leaves it, never taller than a handset.

               MEASURED BY THE FLEX PARENT, not by a viewport arithmetic of
               its own. A "calc(100dvh - 232px)" here has to know the height
               of everything above it — the sticky bar, whatever heading the
               stage carries — and would be quietly wrong on the stage that
               has a different one. The lower bound matters more than the
               upper: under about 560px the invitation's own full-height
               sections stop composing and the page starts scrolling against
               itself inside the frame. */
            flex: 1 1 auto;
            min-height: 560px;
            max-height: 812px;
          }
          .demo-phone__ground {
            display: block;
            position: absolute;
            left: -18%;
            right: -18%;
            bottom: -20px;
            height: 44px;
            background: radial-gradient(ellipse at 50% 50%, rgba(0, 0, 0, 0.5), transparent 70%);
            filter: blur(9px);
            pointer-events: none;
            z-index: 1;
          }
          .demo-phone__bezel {
            border-radius: 40px;
            padding: 8px;
            background: ${BEZEL};
            box-shadow: ${SHADOW.device};
          }
          .demo-phone__screen {
            border-radius: 32px;
            overflow: hidden;
            background: #FFFFFF;
          }
          .demo-phone__caption {
            display: block;
            margin-top: 30px;
            text-align: center;
            font-family: ${T.body};
            font-size: 10.5px;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            color: ${C.inkSoft};
          }
          .demo-root--dark .demo-phone__caption { color: rgba(246, 242, 233, 0.5); }
        }
      `}</style>
    </figure>
  );
}
