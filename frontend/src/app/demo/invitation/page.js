'use client';

import React, { useState } from 'react';
import GuestExperiencePreview from '../../components/templates/GuestExperiencePreview';
import DemoPhone from '../components/DemoPhone';
import DemoHandoff from '../components/DemoHandoff';
import { buildDemoEvent } from '../fixtures/demoEvent.mjs';
import { C, T } from '../../components/landing/landingTokens';

/* ═══════════════════════════════════════════════════════════════════════════
   STAGE 1 — THE ARRIVAL.

   The most important thing on this page is that NONE OF IT IS DRAWN HERE.
   Everything inside the phone is the shipping guest experience:
   WaxEnvelopeOpening, HeritageArchPage and its sections, and the real
   RsvpSection with the organizer's real questions on it. This file supplies
   an event object and a room to stand it in.

   ── WHAT THE VISITOR CAN ACTUALLY DO ─────────────────────────────────────

   Break the seal, read the invitation, scroll it, switch it to Arabic, open
   the map, and then answer: yes or no, how many of them, which dish, who
   else is coming, one custom question the host wrote. Submit it. Get the
   confirmation, the celebration and a QR entry pass with their own name on
   it — drawn client-side by the `qrcode` package, which is the only reason a
   fabricated pass is an honest one rather than a picture of one.

   Nothing reaches the network. See `simulate` in useIdempotentRsvpSubmit.

   ── THE EVENT IS BUILT ONCE ──────────────────────────────────────────────

   Lazy initial state, not a module constant and not a fresh call per render.
   Per render it would be a new object identity every time, remounting the
   whole page inside the frame — and the countdown, which ticks every second,
   guarantees a render every second. At module scope it would freeze the
   clock at import time, which for a date computed relative to "today" is the
   one thing it must not do.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function DemoInvitationPage() {
  const [event] = useState(() => buildDemoEvent());
  const [lang, setLang] = useState('en');

  return (
    <div className="demo-inv">
      {/* The warm light in the room. Decorative, under everything. */}
      <span aria-hidden="true" className="demo-inv__glow" />

      <div className="demo-inv__lede">
        <h1 className="demo-inv__title">
          You have been invited to <em>Nadia &amp; Omar</em>.
        </h1>
        <p className="demo-inv__sub">
          Break the seal. Everything past it is the real thing — reply, choose a
          dish, bring someone. Nothing you type is sent anywhere.
        </p>
      </div>

      <div className="demo-inv__stage">
        <DemoPhone
          title="Nadia and Omar's invitation — a working demo"
          caption="Swan Lake · a Fancy invitation"
        >
          <GuestExperiencePreview
            event={event}
            lang={lang}
            onLangChange={setLang}
            /* The name on the envelope. An unaddressed invitation hides half
               of what is being shown — and this is the same guest who turns
               up as row one of the guest list in stage 2. */
            guestName="Nour Haddad"
            /* The cover plays: arriving at a sealed envelope is the entire
               argument of the page that links here. */
            playOpening
            /* FALSE. The demo event has real content of its own, and sample
               filler would show a page nobody could have written. */
            showSampleContent={false}
            /* The RSVP completes for real, locally. */
            simulate
            afterRsvpCta={<DemoHandoff />}
          />
        </DemoPhone>
      </div>

      <style>{`
        .demo-inv {
          position: relative;
          display: flex;
          flex-direction: column;
          /* The chrome above is sticky, so the stage gets what is left of the
             viewport and never makes the page as a whole scroll — the thing
             that scrolls is the invitation, inside its own frame. */
          min-height: calc(100dvh - 106px);
          /* NOT overflow:hidden. On a short laptop the phone hits its 560px
             floor and the column grows past the viewport; clipping it would
             put the bottom of the invitation somewhere nobody can reach.
             Hidden overflow is unreachable, not scrollable — the same reason
             the overflow guard in globals.css is described there as a guard
             and not a fix. Let the page scroll. */
        }
        .demo-inv__glow {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse 70% 46% at 50% 34%, rgba(169, 138, 78, 0.20), transparent 72%),
            radial-gradient(ellipse 120% 60% at 50% 110%, rgba(169, 138, 78, 0.10), transparent 70%);
          pointer-events: none;
          z-index: 0;
        }

        /* On a phone the lede is a single line above the invitation; the
           invitation itself has to keep the screen. */
        .demo-inv__lede {
          position: relative;
          z-index: 1;
          padding: 18px 20px 14px;
          text-align: center;
        }
        .demo-inv__title {
          margin: 0;
          font-family: ${T.display};
          font-weight: 300;
          font-size: 25px;
          line-height: 1.18;
          letter-spacing: -0.01em;
          color: ${C.ivory};
        }
        .demo-inv__title em { font-style: italic; color: #C7A96A; }
        .demo-inv__sub {
          margin: 9px auto 0;
          max-width: 44ch;
          font-family: ${T.body};
          font-size: 12.5px;
          font-weight: 300;
          line-height: 1.65;
          color: rgba(246, 242, 233, 0.6);
        }

        .demo-inv__stage {
          position: relative;
          z-index: 1;
          flex: 1 1 auto;
          min-height: 0;
          display: flex;
          justify-content: center;
        }

        @media (min-width: 768px) {
          .demo-inv { min-height: calc(100dvh - 118px); }
          .demo-inv__lede { padding: 44px 24px 4px; }
          .demo-inv__title { font-size: 38px; }
          .demo-inv__sub { font-size: 14px; margin-top: 12px; }
        }
      `}</style>
    </div>
  );
}
