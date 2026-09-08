'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import GuestExperiencePreview from '../../components/templates/GuestExperiencePreview';
import DemoPhone from '../../demo/components/DemoPhone';
import { buildDemoEvent } from '../../demo/fixtures/demoEvent.mjs';
import { palettesFor } from '../../utils/curatedTemplates';
import { isCollectionKey } from '../collectionCatalogue';
import { C, T, SHADOW, BEZEL } from '../../components/landing/landingTokens';

/* ═══════════════════════════════════════════════════════════════════════════
   THE INVITATION, LIVE — on the marketing site.

   Nothing in the phone below is drawn here. It is the shipping guest page:
   the real opening, the real HeritageArchPage and its sections, the real
   countdown and the real RSVP form with the organizer's real questions on
   it. This file supplies an event to render and a room to stand it in.

   ── IT DOES NOT MOUNT UNTIL THE VISITOR ASKS ─────────────────────────────

   The page opens on a STILL, and the still is `assets.poster` — the
   opening's own first frame, cut from the same footage. So the picture the
   visitor is looking at and the frame the film begins on are the same pixels:
   pressing the button does not cut to a different image, it starts the one
   already on screen moving.

   Three things are bought by waiting. The guest page is the heaviest tree in
   this product — four openings, an iframe, a video — and none of it is
   fetched, parsed or mounted for somebody who came to look at a picture. The
   page's largest contentful paint is a static JPEG the server referenced, not
   a client component that has to hydrate first. And the film gets the user
   gesture it needs: the opening's sound (useOpeningSfx) requires one, and a
   gesture in the PARENT document does not reliably grant one to a child
   browsing context — a cover opened by the page rather than by the visitor
   plays silently. Tapping the seal is both the point and the only way the wax
   actually cracks out loud.

   ── AND IT DOES NOT ACCEPT A REPLY ───────────────────────────────────────

   No `simulate`. `GuestExperiencePreview` passes `readOnly={!simulate}`, so
   the RSVP form here validates and then says plainly that it is a preview.
   That is deliberate and it is not timidity: completing a reply produces a
   confirmation screen and a QR entry pass with a name on it, and a stranger
   who is handed one of those on a marketing page has been given something
   that looks exactly like a real ticket to a real wedding. The demo has a
   whole chrome around it — a stage rail, a "Demo" badge, a running argument —
   that exists to frame precisely that moment. So the reply happens THERE, and
   the button below goes there, carrying this template with it.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function LiveInvitation({
  templateKey, label, poster, arrival, occasion, livePhoto = null,
}) {
  const [live, setLive] = useState(false);

  /* GUARDED AGAIN, HERE. The route already restricts [key] to the catalogue
     with generateStaticParams plus notFound(), so this can only fail if
     somebody later renders this component from somewhere else — which is
     exactly when a template_type nobody validated would reach a renderer.
     A prop is not a promise. */
  const safeKey = isCollectionKey(templateKey) ? templateKey : null;

  /* Built once, lazily. Not a module constant (the event date is computed
     from "today" and would freeze at import time) and not a fresh call per
     render (the countdown ticks every second, so a new object identity every
     render would remount the whole invitation inside the frame once a
     second). Its own palette, because the presets lead with the colour story
     the photography was actually shot in — and its own OCCASION, so the
     couple's words agree with the kicker the cover prints. */
  const [event] = useState(() => (safeKey
    ? buildDemoEvent({
      templateType: safeKey,
      occasion,
      customColors: palettesFor(safeKey)[0],
      /* Sealed Letter's fold, when we have a photograph for it. Null on
         every other template and, today, on that one too — see LIVE_PHOTO
         in the catalogue for why it is empty rather than filled with a
         stock couple. */
      letterHeroPhoto: livePhoto,
    })
    : null));

  if (!event) return null;

  return (
    <div className="liv">
      <div className="liv__stage">
        {live ? (
          <DemoPhone
            title={`${label} — a working invitation`}
            caption={`${label} · open it, scroll it, read it`}
          >
            <GuestExperiencePreview
              event={event}
              /* Addressed. A real invitation prints the name on its face, and
                 an anonymous one hides half of what is being shown. The same
                 guest the demo opens on, so the two agree. */
              guestName="Nour Haddad"
              playOpening
              /* FALSE. The fixture has real content of its own; sample filler
                 would show a page nobody could have written. */
              showSampleContent={false}
            />
          </DemoPhone>
        ) : (
          /* The still. A BUTTON wrapping the poster rather than a button
             beside it: the whole object is the affordance, which is the same
             thing the invitation itself teaches a guest to believe. */
          <button type="button" onClick={() => setLive(true)} className="liv-cover">
            {/* The device and its contact shadow are ONE box, so the shadow is
                positioned against the bezel rather than against the button —
                which also carries a caption and desktop padding, and would
                have put the shadow across the caption. */}
            <span className="liv-cover__device">
              <span aria-hidden="true" className="liv-cover__ground" />
              <span className="liv-cover__bezel">
              {/* DECORATIVE. This sits inside a BUTTON, so its alt text would
                  become part of the button's accessible name — and the name
                  that matters is what pressing it does. With the image silent
                  the button announces "Open the invitation, They break the
                  seal. The card rises out", which is exactly right; with a
                  described image it announces the template's name and style
                  first, both of which are already in the h1 beside it. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={poster}
                alt=""
                width={390}
                height={844}
                fetchPriority="high"
              />
              <span aria-hidden="true" className="liv-cover__veil" />
              <span className="liv-cover__cue">
                <span className="liv-cover__seal">
                  {/* AN OPENING ENVELOPE, not a tick in a circle. The first
                      draft used a checkmark, which is the mark for "done" or
                      "verified" — the one thing this button does not mean.
                      Same three paths as the closing call to action's
                      ornament, so the two read as one house. */}
                  <svg width="23" height="19" viewBox="0 0 38 32" fill="none" aria-hidden="true" focusable="false">
                    <rect x="2" y="8" width="34" height="22" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M2 10L19 22L36 10" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                    <path d="M4 8L19 0L34 8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="liv-cover__label">Open the invitation</span>
                <span className="liv-cover__hint">{arrival}</span>
                </span>
              </span>
            </span>
            {/* THE STILL GETS A CAPTION TOO, because DemoPhone has one and
                the two states have to be the same object. Without it the
                device box loses ~43px the moment it goes live and the whole
                thing hops. Same wording shape as the live caption below it. */}
            <span className="liv-cover__cap">{label} · sealed</span>
          </button>
        )}
      </div>

      <div className="liv__after">
        <p className="liv__note">
          {live
            ? 'This is the real guest page — scroll it, switch it to Arabic, open the map. The reply form is a preview here.'
            : 'It opens exactly as it would for a guest. Nothing is sent anywhere.'}
        </p>
        {/* Carries the template with it, so the demo opens on the one they
            were just looking at rather than back at the default. */}
        <Link href={`/demo/invitation?t=${safeKey}`} className="liv__btn">
          Reply as a guest
          <svg width="15" height="10" viewBox="0 0 16 10" fill="none" aria-hidden="true" focusable="false">
            <path d="M0 5h13M10 1l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </div>

      {/* A plain <style>. Every rule below aims at a class on either a
          next/link or a nested non-default-export component, and styled-jsx
          fails silently on both — it stamps its hash only onto lowercase
          intrinsic elements, and a block inside a nested component does not
          reliably compile in this build. Classes are prefixed "liv-" / "liv__".

          No backticks inside these CSS comments. */}
      <style>{`
        /* FLEX ALL THE WAY DOWN to DemoPhone. It sizes itself with
           "flex: 1 1 auto" against a "min-height" floor and has not one
           percentage height in it, precisely because a percentage height
           resolves to auto against a parent whose height is not definite —
           which collapses the phone to one line of text. Every caller lays it
           out as a flex column for that reason; so does this one. */
        .liv {
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        /* A DEFINITE HEIGHT, and it is load-bearing rather than a round
           number. Two different objects occupy this box — the still before
           the visitor presses it, and DemoPhone after — and they must be the
           same size or the page jumps at the exact moment it is trying to
           impress somebody.

           They could not agree on their own. DemoPhone sizes itself with
           "flex: 1 1 auto" against a 560px floor and an 812px ceiling and has
           not one percentage height in it, precisely because a percentage
           against a parent sized by min-height resolves to auto and collapses
           the phone to one line of text. A still at its natural 390:844 in a
           366px column is about 790px tall. Left alone, one is 560 and the
           other 790.

           So the STAGE owns the height, both children fill it, and DemoPhone
           gets the definite parent it has always wanted. 812 is its own
           ceiling — asking for more would be honoured by the still and capped
           for the phone, which is the same mismatch again. */
        .liv__stage {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
          height: 620px;
        }
        .liv__stage .demo-phone { flex: 1 1 auto; min-height: 0; }

        /* ── the still ─────────────────────────────────────────────────── */
        /* HEIGHT-LED, not width-led. The stage above has a definite height and
           this fills it; the width then follows from the poster's own 390:844,
           which is what makes the still and the phone that replaces it the
           same object rather than two differently-proportioned pictures. */
        .liv-cover {
          position: relative;
          /* A FLEX COLUMN, mirroring DemoPhone's own figure: bezel on top,
             caption under it, the pair filling the stage. */
          display: flex;
          flex-direction: column;
          align-items: center;
          height: 100%;
          width: auto;
          max-width: 100%;
          padding: 0;
          background: none;
          border: 0;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        /* The device box takes what the caption does not, and is the
           containing block for the contact shadow below it. */
        .liv-cover__device {
          position: relative;
          display: flex;
          flex: 1 1 auto;
          min-height: 0;
          max-width: 100%;
        }
        .liv-cover__cap { display: none; }
        .liv-cover:focus-visible { outline: 2px solid ${C.goldInk}; outline-offset: 10px; }
        .liv-cover__ground {
          position: absolute;
          left: -14%;
          right: -14%;
          bottom: -16px;
          height: 38px;
          background: radial-gradient(ellipse at 50% 50%, rgba(25, 24, 21, 0.34), transparent 70%);
          filter: blur(9px);
          pointer-events: none;
        }
        /* FLEX, so the image is stretched to the bezel rather than asking it
           how tall it is. A percentage height here would resolve against a box
           whose own height came from a flex line — not definite — and collapse,
           which is the same trap DemoPhone's header documents at length. */
        .liv-cover__bezel {
          position: relative;
          display: flex;
          height: 100%;
          max-width: 100%;
          border-radius: 34px;
          padding: 7px;
          background: ${BEZEL};
          box-shadow: ${SHADOW.device};
          transition: transform 0.5s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .liv-cover:hover .liv-cover__bezel { transform: translateY(-6px); }
        .liv-cover__bezel img {
          display: block;
          height: 100%;
          /* AUTO, so the width follows the height through the ratio below.
             A 100% width here would square the picture off against whatever
             the button happened to be. */
          width: auto;
          /* ── AND THEN CLAMPED, WHICH IS NOT BELT-AND-BRACES ──
             Height-led sizing has no idea how much width it is allowed. At a
             320px viewport the stage is 620 tall, so the ratio below asks for
             620 x 390/844 = 286px of picture inside a column that only has
             266 — and with a rigid "flex: none" the picture simply hung 20px
             out of its own bezel, clipped by the global overflow guard rather
             than fixed by it. Shrinkable, with a min-width of 0 so flex is
             actually permitted to do it, and object-fit crops the sides
             instead of squashing the couple. */
          flex: 0 1 auto;
          min-width: 0;
          max-width: 100%;
          border-radius: 27px;
          /* The poster is a 9:19.5 phone frame in every template, but the four
             sources differ by a few pixels. A fixed ratio keeps the detail
             pages the same size as each other and the same shape as the phone
             that replaces this. */
          aspect-ratio: 390 / 844;
          object-fit: cover;
        }
        /* Darkened from the BOTTOM only. A veil over the whole frame would
           flatten the artwork this page exists to show; the cue needs ground
           under it and nothing else does. */
        .liv-cover__veil {
          position: absolute;
          inset: 7px;
          border-radius: 27px;
          background: linear-gradient(to top, rgba(10, 9, 8, 0.82) 0%, rgba(10, 9, 8, 0.34) 26%, transparent 52%);
          pointer-events: none;
        }
        .liv-cover__cue {
          position: absolute;
          left: 22px;
          right: 22px;
          bottom: 30px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 9px;
          pointer-events: none;
        }
        .liv-cover__seal {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 1px solid rgba(246, 242, 233, 0.5);
          background: rgba(246, 242, 233, 0.10);
          color: ${C.ivory};
        }
        .liv-cover__label {
          font-family: ${T.body};
          font-size: 10.5px;
          font-weight: 600;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: ${C.ivory};
        }
        .liv-cover__hint {
          font-family: ${T.display};
          font-size: 15px;
          font-style: italic;
          line-height: 1.35;
          text-align: center;
          color: rgba(246, 242, 233, 0.76);
          text-wrap: pretty;
        }

        /* ── under it ──────────────────────────────────────────────────── */
        .liv__after {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          margin-top: 34px;
          text-align: center;
        }
        .liv__note {
          margin: 0;
          max-width: 42ch;
          font-size: 13px;
          font-weight: 300;
          line-height: 1.75;
          color: ${C.inkSoft};
        }
        .liv__btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          min-height: 54px;
          padding: 0 30px;
          background: ${C.ink};
          color: ${C.paper};
          border: 1px solid ${C.ink};
          font-family: ${T.body};
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          white-space: nowrap;
          text-decoration: none;
          transition: background 0.3s ease, color 0.3s ease;
        }
        .liv__btn:hover { background: transparent; color: ${C.ink}; }

        @media (min-width: 768px) {
          /* 812 is DemoPhone's own max-height. Asking for more would be
             honoured by the still and capped for the phone, which puts the
             mismatch straight back. */
          .liv__stage { height: 812px; }

          /* ── MATCHING DEMOPHONE'S CHROME, and these numbers are a coupling
             rather than taste. Its figure adds "padding: 26px 0 30px" at this
             width and shows a figcaption with "margin-top: 30px", so inside
             an 812px stage its SCREEN is about 713px — not 812. A still that
             fills the whole 812 therefore shrinks by ~100px and grows a
             caption the instant it goes live, which is a hop at the exact
             moment the page is meant to look effortless.
             If DemoPhone's padding changes, this has to follow it. */
          .liv-cover { padding: 26px 0 30px; }
          .liv-cover__cap {
            display: block;
            margin-top: 30px;
            flex: none;
            text-align: center;
            font-family: ${T.body};
            font-size: 10.5px;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            color: ${C.inkSoft};
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .liv-cover__bezel, .liv__btn { transition: none; }
          .liv-cover:hover .liv-cover__bezel { transform: none; }
        }
      `}</style>
    </div>
  );
}
