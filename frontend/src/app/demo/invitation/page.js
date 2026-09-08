'use client';

import React, { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import GuestExperiencePreview from '../../components/templates/GuestExperiencePreview';
import DemoPhone from '../components/DemoPhone';
import DemoHandoff from '../components/DemoHandoff';
import { buildDemoEvent, DEMO_TITLE } from '../fixtures/demoEvent.mjs';
import { collectionItem } from '../../collection/collectionCatalogue';
import { palettesFor } from '../../utils/curatedTemplates';
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

   ── ?t= CHOOSES THE INVITATION ───────────────────────────────────────────

   /collection/[key] hands a visitor here from the template they were just
   looking at, and arriving back at the default one would read as the site
   losing their place. So the stage takes a template key.

   IT IS AN ALLOWLIST LOOKUP, NOT A PASS-THROUGH. The value is a query string
   a stranger writes, and it would otherwise land on `template_type`, which is
   free text with no CHECK constraint anywhere in the schema — nothing
   downstream would refuse it. `collectionItem(t)` either produces a catalogue
   entry or produces null, and null falls back to Swan Lake. An unknown key is
   therefore the default page rather than an error, which is the right failure
   for a shared link with a typo in it.

   The accessor rather than a bare `COLLECTION_BY_KEY[t]`: that index answers
   truthily for "constructor" and every other inherited name, which would put
   a function where a template belongs.

   The entry also carries the OCCASION, and that is not decoration. Velvet
   Ring declares `occasions: ['engagement']` and every renderer clamps to it,
   so opening Ring on the wedding fixture printed an engagement kicker over
   "we are getting married". The catalogue resolves the occasion the same way
   the renderer does, and the fixture words itself to match.

   ── THE EVENT IS BUILT ONCE ──────────────────────────────────────────────

   Lazy initial state, not a module constant and not a fresh call per render.
   Per render it would be a new object identity every time, remounting the
   whole page inside the frame — and the countdown, which ticks every second,
   guarantees a render every second. At module scope it would freeze the
   clock at import time, which for a date computed relative to "today" is the
   one thing it must not do.

   ── AND WHY THERE IS A SUSPENSE BOUNDARY ─────────────────────────────────

   `useSearchParams` opts its whole subtree out of static rendering unless it
   sits under one. Without the boundary this page — the single most-linked
   page in the marketing funnel — would be server-rendered on every request
   for the sake of one optional query parameter.
   ═══════════════════════════════════════════════════════════════════════════ */

function DemoInvitationStage() {
  const params = useSearchParams();
  /* The catalogue entry, or nothing. See the header: this IS the guard.
     Optional-chained because useSearchParams can hand back null while a
     subtree is still resolving. */
  const chosen = collectionItem(params?.get('t') || '');
  const templateType = chosen?.key || 'swans';

  /* MEMOISED ON THE TEMPLATE, not lazy initial state — and the difference is
     a bug, not a preference.

     `useState(() => …)` runs its initializer ONCE for the life of the
     component. This component stays mounted across a client-side navigation
     from one collection plate to another, so `?t=` would change, everything
     derived from it would update, and `event` would still be the template the
     visitor arrived on: the new name in the caption, the old invitation in
     the frame. Keying the phone below does not fix that either — a key
     remounts the CHILD, and the state lives here in the parent.

     useMemo is not the thing lazy state was avoiding. The countdown re-renders
     this once a second and a fresh object each time would remount the whole
     invitation inside the frame; a memo keyed on the template rebuilds only
     when the template actually changes. Same reason, and the same shape, as
     demo/customize/page.js. */
  const event = useMemo(() => buildDemoEvent({
    templateType,
    occasion: chosen?.occasion,
    /* Its own colour story. The presets lead with the palette the artwork was
       photographed in, so a template opened from the collection looks the way
       its plate did rather than wearing Swan Lake's olive. */
    customColors: palettesFor(templateType)[0],
  }), [templateType, chosen]);
  const [lang, setLang] = useState('en');

  const label = chosen?.label || 'Swan Lake';

  return (
    <div className="demo-inv">
      {/* The warm light in the room. Decorative, under everything. */}
      <span aria-hidden="true" className="demo-inv__glow" />

      <div className="demo-inv__lede">
        <h1 className="demo-inv__title">
          You have been invited to <em>{DEMO_TITLE}</em>.
        </h1>
        <p className="demo-inv__sub">
          Break the seal. Everything past it is the real thing — reply, choose a
          dish, bring someone. Nothing you type is sent anywhere.
        </p>
      </div>

      <div className="demo-inv__stage">
        <DemoPhone
          /* KEYED ON THE TEMPLATE, so the cover PLAYS AGAIN.
             The memo above is what makes the new event reach the frame; this
             is what makes the frame start over. GuestExperiencePreview re-arms
             its opening on `playOpening`/`replayKey`, not on the identity of
             `event`, so without a key a visitor moving between two collection
             plates would land past the seal of an invitation they had never
             opened. A different template is a different object. */
          key={templateType}
          title="Nadia and Omar's invitation — a working demo"
          caption={`${label} · a Fancy invitation`}
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

export default function DemoInvitationPage() {
  /* `null`, not a spinner. The boundary exists to keep this page static (see
     the header), and it resolves in the same tick on the client — a skeleton
     would be a flash of layout nobody is meant to see. */
  return (
    <Suspense fallback={null}>
      <DemoInvitationStage />
    </Suspense>
  );
}
