'use client';

import React, { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import GuestExperiencePreview from '../../components/templates/GuestExperiencePreview';
import DemoPhone from '../components/DemoPhone';
import { TEMPLATES, palettesFor } from '../../utils/curatedTemplates';
import { CINEMATIC_KEYS } from '../../components/templates/cinematic/cinematicThemes';
import { occasionPolicyFor } from '../../utils/eventOccasion';
import { buildDemoEvent, DEMO_MEALS } from '../fixtures/demoEvent.mjs';
import { C, T } from '../../components/landing/landingTokens';

/* ═══════════════════════════════════════════════════════════════════════════
   STAGE 3 — MAKE IT YOURS.

   Four controls, one phone, and a rule that decided all four: EVERY CONTROL
   HERE IS A FIELD AN ORGANIZER CAN ACTUALLY SET. A demo knob with no setting
   behind it is not a shortcut, it is a lie told convincingly — and this
   screen exists precisely to prove the settings are real.

   That rule cost the control this stage was first sketched around. "Allow
   plus-ones" reads like an obvious toggle and is not one: RsvpSection renders
   its party stepper unconditionally, capped at twenty, and there is no
   `max_party_size` read anywhere in the frontend. Building it would have
   demonstrated a setting the product does not have.

   What is left is four things that are genuinely wired, chosen because each
   one's consequence is visible in the phone beside it in under a second:

     TEMPLATE   a different cover, a different hero, a different page
     PALETTE    the same page, recoloured through buildPalette
     MEAL       the question appears in, or leaves, the reply form
     NO KIDS    AdultsOnlyNotice appears under the guest count

   Event name and date are deliberately absent. Typing a different name into
   a preview proves nothing about the product; it proves that text fields
   work.

   ── THE COVER REPLAYS ONLY WHEN THE COVER IS WHAT CHANGED ────────────────

   The page opens PAST the opening, because a visitor arriving here has
   already broken one seal in stage 1 and making them do it again before they
   can touch a control would put a film in front of a settings panel.
   Choosing a different template re-arms it, because the cover is the largest
   part of what a template IS and skipping it would hide the difference. A
   palette or a toggle does not: those change the page, not the arrival.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The four cinematic templates, in the picker's own order and wording. */
const TEMPLATE_CHOICES = TEMPLATES.filter((t) => CINEMATIC_KEYS.includes(t.key));

function Control({ n, title, watch, children }) {
  return (
    <section className="dcz-block">
      <header className="dcz-block__head">
        <span aria-hidden="true" className="dcz-block__n">{n}</span>
        <div>
          <h2 className="dcz-block__title">{title}</h2>
          <p className="dcz-block__watch">{watch}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function Toggle({ checked, onChange, label, off, on }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`dcz-toggle${checked ? ' dcz-toggle--on' : ''}`}
    >
      <span aria-hidden="true" className="dcz-toggle__track"><span className="dcz-toggle__knob" /></span>
      <span className="dcz-toggle__text">
        <span className="dcz-toggle__label">{label}</span>
        <span className="dcz-toggle__state">{checked ? on : off}</span>
      </span>
    </button>
  );
}

export default function DemoCustomizePage() {
  const [templateType, setTemplateType] = useState('swans');
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [askMeal, setAskMeal] = useState(true);
  const [noKids, setNoKids] = useState(true);
  /* `play` starts false so the settings are reachable at once; both fields
     move together because GuestExperiencePreview re-arms on the pair. */
  const [reveal, setReveal] = useState({ play: false, key: 0 });

  const palettes = useMemo(() => palettesFor(templateType), [templateType]);
  const palette = palettes[Math.min(paletteIndex, palettes.length - 1)] || palettes[0];

  const replayOpening = useCallback(() => {
    setReveal((r) => ({ play: true, key: r.key + 1 }));
  }, []);

  const chooseTemplate = useCallback((key) => {
    setTemplateType(key);
    // Its own colour story, not the last template's — the presets lead with
    // the palette the artwork was made in.
    setPaletteIndex(0);
    setReveal((r) => ({ play: true, key: r.key + 1 }));
  }, []);

  /* Memoised so the event identity survives the countdown's once-a-second
     render. A fresh object every second would re-render the whole invitation
     inside the frame for no reason. */
  const event = useMemo(() => buildDemoEvent({
    templateType,
    /* THE WORDS FOLLOW THE ARTWORK, because on one template they have to.
       Velvet Ring declares occasions: ['engagement'] and every renderer
       clamps to it, so picking it in the control beside this phone printed an
       ENGAGEMENT kicker over a page whose own description read "We are
       getting married on the Corniche" — the cover and the prose disagreeing
       about the same evening, in the one stage built to prove the settings
       are real.
       occasionPolicyFor is the same resolution the renderer performs, so the
       fixture cannot pick words the page will then contradict. */
    occasion: occasionPolicyFor(templateType).occasion,
    customColors: palette,
    meals: askMeal ? DEMO_MEALS : [],
    noKids,
  }), [templateType, palette, askMeal, noKids]);

  return (
    <div className="dcz">
      <div className="dcz__grid">
        <div className="dcz__panel">
          <header className="dcz__head">
            <h1 className="dcz__title">Change something. Watch it land.</h1>
            <p className="dcz__sub">
              These are real settings, not demo switches — the same four an
              organizer sets before they send anything.
            </p>
          </header>

          <Control n="1" title="The template" watch="Changes the cover, the hero and the whole page.">
            <ul className="dcz-tpl">
              {TEMPLATE_CHOICES.map((t) => (
                <li key={t.key}>
                  <button
                    type="button"
                    onClick={() => chooseTemplate(t.key)}
                    aria-pressed={templateType === t.key}
                    className={`dcz-tpl__btn${templateType === t.key ? ' dcz-tpl__btn--on' : ''}`}
                  >
                    <span className="dcz-tpl__label">{t.label}</span>
                    <span className="dcz-tpl__tag">{t.tagline.replace('Cinematic · ', '')}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={replayOpening} className="dcz-replay">
              Replay the opening
            </button>
          </Control>

          <Control n="2" title="The colours" watch="Recolours every section, not just the cover.">
            <ul className="dcz-pal">
              {palettes.map((p, i) => (
                <li key={p.name}>
                  <button
                    type="button"
                    onClick={() => setPaletteIndex(i)}
                    aria-pressed={paletteIndex === i}
                    className={`dcz-pal__btn${paletteIndex === i ? ' dcz-pal__btn--on' : ''}`}
                  >
                    <span aria-hidden="true" className="dcz-pal__chips">
                      <span style={{ background: p.primary }} />
                      <span style={{ background: p.secondary }} />
                      <span style={{ background: p.background }} />
                    </span>
                    <span className="dcz-pal__name">{p.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Control>

          <Control n="3" title="What you ask" watch="Scroll the phone to the reply form.">
            <Toggle
              checked={askMeal}
              onChange={setAskMeal}
              label="Ask every guest to choose a main course"
              on={DEMO_MEALS.join(' · ')}
              off="No meal question — the form is shorter"
            />
          </Control>

          <Control n="4" title="Who is invited" watch="Just under the guest count, in the form.">
            <Toggle
              checked={noKids}
              onChange={setNoKids}
              label="Adults only"
              on="Guests are told, kindly, where it counts"
              off="Nothing is said either way"
            />
          </Control>

          <aside className="dcz__foot">
            <p className="dcz__footline">
              There are another twenty settings behind this one screen — texts,
              seating, check-in, who may change their answer and until when.
            </p>
            <div className="dcz__actions">
              <Link href="/register" className="dcz__cta">Create your event</Link>
              <Link href="/features" className="dcz__alt">See everything else</Link>
            </div>
          </aside>
        </div>

        <div className="dcz__stage">
          <DemoPhone title="Your invitation, as your guests would get it">
            <GuestExperiencePreview
              event={event}
              guestName="Nour Haddad"
              playOpening={reveal.play}
              replayKey={reveal.key}
              showSampleContent={false}
              /* NOT `simulate`. The visitor already completed one reply in
                 stage 1; a second would be noise, and the question this
                 screen asks is what the form LOOKS like once they have
                 changed it. readOnly validates and stops, which is exactly
                 the behaviour the organizer's own preview has. */
            />
          </DemoPhone>
        </div>
      </div>

      <style>{`
        .dcz { padding: 0 0 40px; }
        .dcz__grid { display: flex; flex-direction: column; }

        /* PHONE FIRST: the invitation leads, the controls follow. A visitor
           arriving on a handset should see the thing before the knobs. */
        /* A flex container, so the figure inside is stretched to it rather
           than asking for a percentage of a height it cannot resolve. */
        .dcz__stage { order: -1; display: flex; justify-content: center; padding: 6px 0 0; }
        .dcz__panel { padding: 20px 18px 0; }

        .dcz__head { margin-bottom: 22px; }
        .dcz__title {
          margin: 0;
          font-family: ${T.display};
          font-weight: 300;
          font-size: 29px;
          line-height: 1.1;
          letter-spacing: -0.015em;
          color: ${C.ink};
        }
        .dcz__sub {
          margin: 10px 0 0;
          max-width: 46ch;
          font-family: ${T.body};
          font-size: 13.5px;
          line-height: 1.7;
          color: ${C.inkSoft};
        }

        .dcz-block { padding: 20px 0; border-top: 1px solid ${C.border}; }
        .dcz-block__head { display: flex; gap: 12px; margin-bottom: 14px; }
        .dcz-block__n {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          flex: none;
          margin-top: 1px;
          border-radius: 50%;
          background: ${C.paper3};
          font-family: ${T.body};
          font-size: 10px;
          font-weight: 700;
          color: ${C.goldInk};
        }
        .dcz-block__title {
          margin: 0;
          font-family: ${T.body};
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.02em;
          color: ${C.ink};
        }
        .dcz-block__watch {
          margin: 3px 0 0;
          font-family: ${T.body};
          font-size: 12px;
          line-height: 1.5;
          color: ${C.inkSoft};
          opacity: 0.85;
        }

        /* Templates: a 2-track grid whose tracks can shrink. A fixed
           repeat(2, 1fr) of cards cannot fit 320px once the cards have
           padding, which is why the primitives in globals.css exist. */
        .dcz-tpl, .dcz-pal {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(140px, 100%), 1fr));
          gap: 8px;
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .dcz-tpl__btn {
          display: flex;
          flex-direction: column;
          gap: 3px;
          width: 100%;
          min-height: var(--fx-touch);
          padding: 12px 13px;
          text-align: start;
          background: #FFFFFF;
          border: 1px solid ${C.border};
          border-radius: 11px;
          cursor: pointer;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .dcz-tpl__btn--on {
          border-color: ${C.gold};
          box-shadow: 0 0 0 2px rgba(169, 138, 78, 0.16);
        }
        .dcz-tpl__label {
          font-family: ${T.body};
          font-size: 12.5px;
          font-weight: 700;
          color: ${C.ink};
        }
        .dcz-tpl__tag {
          font-family: ${T.body};
          font-size: 11px;
          color: ${C.inkSoft};
          overflow-wrap: anywhere;
        }

        .dcz-replay {
          margin-top: 10px;
          padding: 9px 15px;
          min-height: var(--fx-touch);
          background: transparent;
          border: 1px solid ${C.border};
          border-radius: 9px;
          font-family: ${T.body};
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: ${C.inkSoft};
          cursor: pointer;
        }
        .dcz-replay:hover { color: ${C.ink}; border-color: ${C.gold}; }

        .dcz-pal__btn {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          min-height: var(--fx-touch);
          padding: 10px 12px;
          text-align: start;
          background: #FFFFFF;
          border: 1px solid ${C.border};
          border-radius: 11px;
          cursor: pointer;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .dcz-pal__btn--on {
          border-color: ${C.gold};
          box-shadow: 0 0 0 2px rgba(169, 138, 78, 0.16);
        }
        .dcz-pal__chips { display: inline-flex; flex: none; }
        .dcz-pal__chips span {
          display: block;
          width: 15px;
          height: 15px;
          border-radius: 50%;
          border: 1px solid rgba(25, 24, 21, 0.12);
        }
        .dcz-pal__chips span + span { margin-inline-start: -5px; }
        .dcz-pal__name {
          font-family: ${T.body};
          font-size: 12px;
          font-weight: 600;
          color: ${C.ink};
          min-width: 0;
          overflow-wrap: anywhere;
        }

        .dcz-toggle {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          width: 100%;
          min-height: var(--fx-touch);
          padding: 13px 14px;
          text-align: start;
          background: #FFFFFF;
          border: 1px solid ${C.border};
          border-radius: 12px;
          cursor: pointer;
        }
        .dcz-toggle--on { border-color: ${C.gold}; }
        .dcz-toggle__track {
          position: relative;
          display: block;
          flex: none;
          width: 40px;
          height: 23px;
          margin-top: 1px;
          border-radius: 999px;
          background: ${C.paper3};
          transition: background 0.22s ease;
        }
        .dcz-toggle--on .dcz-toggle__track { background: ${C.gold}; }
        .dcz-toggle__knob {
          position: absolute;
          top: 3px;
          inset-inline-start: 3px;
          width: 17px;
          height: 17px;
          border-radius: 50%;
          background: #FFFFFF;
          box-shadow: 0 1px 3px rgba(25, 24, 21, 0.28);
          transition: transform 0.22s ease;
        }
        .dcz-toggle--on .dcz-toggle__knob { transform: translateX(17px); }
        /* RTL flips the direction of travel with the writing direction; a
           fixed +17px would slide the knob off the wrong end of the track. */
        [dir="rtl"] .dcz-toggle--on .dcz-toggle__knob { transform: translateX(-17px); }
        .dcz-toggle__text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
        .dcz-toggle__label {
          font-family: ${T.body};
          font-size: 12.5px;
          font-weight: 700;
          color: ${C.ink};
        }
        .dcz-toggle__state {
          font-family: ${T.body};
          font-size: 11.5px;
          line-height: 1.5;
          color: ${C.inkSoft};
          overflow-wrap: anywhere;
        }

        .dcz__foot { padding: 22px 0 0; border-top: 1px solid ${C.border}; }
        .dcz__footline {
          margin: 0 0 16px;
          max-width: 48ch;
          font-family: ${T.body};
          font-size: 12.5px;
          line-height: 1.7;
          color: ${C.inkSoft};
        }
        .dcz__actions { display: flex; flex-direction: column; gap: 10px; }
        .dcz__cta {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 54px;
          padding: 0 26px;
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
        .dcz__cta:hover { background: transparent; color: ${C.ink}; }
        .dcz__alt {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 54px;
          padding: 0 26px;
          background: transparent;
          color: ${C.ink};
          border: 1px solid ${C.border};
          font-family: ${T.body};
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          white-space: nowrap;
          text-decoration: none;
        }
        .dcz__alt:hover { border-color: ${C.ink}; }

        @media (min-width: 768px) {
          .dcz__panel { padding: 30px 32px 0; }
          .dcz__title { font-size: 36px; }
          .dcz__actions { flex-direction: row; }
        }

        /* The phone moves beside the controls only when there is genuinely
           room for a 390px device AND a readable column of text. Below this
           the stacked order above is the right one. */
        @media (min-width: 1024px) {
          .dcz__grid {
            flex-direction: row;
            align-items: flex-start;
            gap: 32px;
            max-width: 1180px;
            margin: 0 auto;
            padding: 0 24px;
          }
          .dcz__panel { flex: 1 1 auto; min-width: 0; padding: 34px 0 0; }
          .dcz__stage {
            order: 0;
            flex: none;
            position: sticky;
            top: 128px;
            padding: 0;
            /* The phone's own floor is 560px; this keeps the sticky column
               from being taller than the space it is stuck inside. */
            height: calc(100dvh - 168px);
            min-height: 600px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .dcz-tpl__btn, .dcz-pal__btn, .dcz-toggle__track,
          .dcz-toggle__knob, .dcz__cta { transition: none; }
        }
      `}</style>
    </div>
  );
}
