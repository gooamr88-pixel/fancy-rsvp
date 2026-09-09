import React from "react";
import Link from "next/link";
import { C, T } from "./landingTokens";

/* ═══════════════════════════════════════════════════════════════════════════
   ONE SCREEN, ONE IDEA — the shape every feature band on this page takes.

   ── WHY THIS EXISTS ──────────────────────────────────────────────────────

   The first pass at the approved mockup built five bands separately, and they
   drifted apart the moment they were written. Each grew its own two-column
   grid, its own list of "proofs" with a paragraph under each, its own note
   under its own call to action. Every band was defensible on its own and the
   page they made was a wall: left-aligned headings, three columns of prose per
   screen, four different button shapes, and a reader who could not tell where
   one idea ended and the next began.

   The mockup does one thing per screen and does it in the middle of the page:

       kicker  ·  one headline  ·  ONE sentence  ·  one picture  ·  one button

   Nothing else. No numeral, no rule beside the kicker, no bullet list, no
   footnote under the button. That restraint IS the design — it is what makes
   eight screens legible in the time somebody actually gives a homepage.

   So the shape lives in one component rather than in five copies of a
   convention. A band that wants a second column or a third paragraph now has
   to change this file, in front of everybody, instead of quietly growing one.

   ── THE RULES IT ENFORCES ────────────────────────────────────────────────

   · `sub` is ONE sentence. Not enforced by code — enforced by the fact that
     the box it renders into is 44ch wide and centred, so a second sentence
     looks wrong immediately.
   · Exactly one call to action, and it is a pill. The page had four button
     shapes; it now has two — a filled ink pill for the page's own asks
     (create an event, open the collection) and this outlined gold one for
     "go and look at the thing I have just described".
   · The visual is a child, so each band owns its own artwork and nothing
     else. Everything around it is identical by construction.

   A Server Component: no state, no client JavaScript.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @param {object}  props
 * @param {string}  props.id       anchor + section id, e.g. "seating"
 * @param {'light'|'warm'} props.tone   which paper the band stands on
 * @param {string}  props.kicker   two or three words, uppercase
 * @param {string}  props.title    the headline. A sentence, with a full stop.
 * @param {string}  props.sub      ONE sentence.
 * @param {{href: string, label: string}} [props.cta]
 * @param {React.ReactNode} props.children  the picture, and only the picture
 */
export default function FeatureBand({ id, tone = "light", kicker, title, sub, cta, children }) {
  return (
    <section id={id} className={`fb fb--${tone}`} aria-labelledby={`${id}-title`}>
      <div className="fx-container fx-container--4xl fx-gutter">
        <header className="fb-head">
          <span className="fb-kicker">{kicker}</span>
          <h2 id={`${id}-title`} className="fb-title">{title}</h2>
          <p className="fb-sub">{sub}</p>
        </header>

        <div className="fb-art">{children}</div>

        {cta && (
          <div className="fb-act">
            <Link href={cta.href} className="fb-cta">
              {cta.label}
              <svg width="15" height="9" viewBox="0 0 16 9" fill="none" aria-hidden="true">
                <path d="M0 4.5h13M10.5 1L14 4.5 10.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </div>
        )}
      </div>

      {/* A plain style element — styled-jsx cannot be imported from a Server
          Component, and a scoped rule would never attach to the next/link
          above. Classes are prefixed "fb-" instead.

          No backticks inside these CSS comments: one would end the template
          literal and produce a parse error. */}
      <style>{`
        .fb { width: 100%; padding: 76px 0; }
        .fb--light { background: ${C.paper}; }
        .fb--warm { background: ${C.paper2}; }

        /* ── the header, and the whole argument for centring it ─────────────
           A left-aligned heading over a centred picture makes the reader's eye
           start in two different places on every screen. Centred, the band has
           one axis and the picture sits on it — which is what lets somebody
           scroll past four of these and still take each one in. */
        .fb-head {
          text-align: center;
          max-width: 640px;
          margin: 0 auto;
        }
        .fb-kicker {
          display: block;
          font-family: ${T.label};
          font-size: 10px;
          letter-spacing: 0.3em;
          text-transform: uppercase;
          color: ${C.goldInk};
        }
        .fb-title {
          font-family: ${T.display};
          font-weight: 300;
          font-size: 37px;
          line-height: 1.08;
          letter-spacing: -0.015em;
          color: ${C.ink};
          margin: 16px 0 0;
          text-wrap: balance;
        }
        /* 44ch and centred. A measure this narrow is what makes a second
           sentence look wrong before it is read — which is the point. */
        .fb-sub {
          font-size: 15px;
          font-weight: 300;
          line-height: 1.75;
          color: ${C.inkSoft};
          margin: 14px auto 0;
          max-width: 44ch;
          text-wrap: pretty;
        }

        .fb-art { margin-top: 40px; }

        .fb-act { margin-top: 34px; text-align: center; }
        /* THE PILL. Outlined gold, for "go and look at the thing I have just
           described". The page's own asks — create an event, open the
           collection — are the filled ink pill, so the two never compete. */
        .fb-cta {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 11px;
          min-height: 54px;
          padding: 0 30px;
          border-radius: 999px;
          border: 1px solid ${C.gold};
          background: transparent;
          font-family: ${T.body};
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          white-space: nowrap;
          text-decoration: none;
          color: ${C.goldInk};
          transition: background 0.3s ease, color 0.3s ease, border-color 0.3s ease;
        }
        .fb-cta:hover {
          background: ${C.goldInk};
          border-color: ${C.goldInk};
          color: ${C.paper};
        }

        /* ── 320px, AND THIS IS A MEASURED FIX ──────────────────────────────
           The pill is nowrap, so a label it cannot fit does not wrap — it
           overflows. Measured on the staged page: at a 320px viewport the
           reminders band's button ran 20..332 against a client width of 314,
           which the html { overflow-x: clip } guard then hid.

           Inside .fx-gutter there are 280px at 320. A 27-character uppercase
           label at 11px and 0.16em tracking is ~232px on its own, and 60px of
           padding plus the arrow put it past 310. Below 640 the tracking and
           the padding come down, which buys back about 60px — and the labels
           themselves were shortened to the ones the mockup uses. Both were
           needed; either alone still overflowed. */
        @media (max-width: 639.98px) {
          .fb-cta {
            padding: 0 20px;
            letter-spacing: 0.1em;
            gap: 9px;
          }
        }

        @media (min-width: 768px) {
          .fb { padding: 124px 0; }
          .fb-kicker { font-size: 11px; letter-spacing: 0.36em; }
          .fb-title { font-size: 52px; margin-top: 20px; }
          .fb-sub { font-size: 17px; margin-top: 18px; }
          .fb-art { margin-top: 58px; }
          .fb-act { margin-top: 48px; }
          .fb-cta { padding: 0 38px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .fb-cta { transition: none; }
        }
      `}</style>
    </section>
  );
}
