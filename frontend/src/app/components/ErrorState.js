'use client';

import { forwardRef, useId } from 'react';

/* ═══════════════════════════════════════════════════════════════════════════
   THE ONE ERROR SCREEN.

   There were three, in three files, drifting: the root boundary
   (app/error.js), the dashboard segment boundary (dashboard/error.js) and the
   inline section boundary (components/ErrorBoundary.js). Same words, same
   generic warning triangle, three separate copies of the layout and three
   separate dark-mode blocks — so a fix or a polish pass landed on whichever
   one the author happened to be looking at.

   They now all render this. The differences that are real — full page versus
   inline, which actions are offered — are props.

   ── WHY A BROKEN WAX SEAL AND NOT A WARNING TRIANGLE ──

   A warning triangle is the icon every form validation error, every browser
   permission prompt and every cookie banner uses. It reads as a system alert,
   and on a platform whose whole product is an invitation that opens with a wax
   seal, it reads as somebody else's system alert.

   A seal that has cracked says the same thing in this product's own language:
   something that was meant to arrive intact did not. It is drawn, not
   imported — the scalloped rim is fourteen circles placed around a disc, the
   crack is a clip path shared by both halves, and the two halves are tipped a
   degree and a half apart so the break reads as a break and not as a line
   someone drew down the middle.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The seal, cracked.
 *
 * Geometry is computed rather than hand-authored so the scallops stay exactly
 * on the rim: hand-placed ones drift by a pixel or two and the silhouette
 * stops reading as pressed wax and starts reading as a gear.
 *
 * `size` is the rendered box; everything inside works in a fixed 64-unit
 * viewBox, so one number scales the whole mark.
 */
function BrokenSeal({ size = 82 }) {
  /**
   * SVG ids are DOCUMENT-global, and `url(#id)` resolves to the first match in
   * the document — so two of these on one page would both paint with the first
   * one's gradient and clip paths. Nesting boundaries makes that reachable
   * (a section boundary inside a page that also fails), and duplicate ids are
   * an accessibility-tree defect even when nothing looks wrong.
   */
  const uid = useId().replace(/:/g, '');
  const WAX = `fx-errseal-wax-${uid}`;
  const CLIP_L = `fx-errseal-l-${uid}`;
  const CLIP_R = `fx-errseal-r-${uid}`;

  const R = 18.5;
  /**
   * The rim, as irregular blobs of wax rather than regular scallops.
   *
   * Two earlier passes failed for opposite reasons and both failures were
   * about REGULARITY, not size: fourteen deep teeth read as a sunflower, and
   * thirteen shallow ones read as a cog — the split down the middle only made
   * the machine association stronger. Evenly spaced identical bumps are what a
   * manufactured object has.
   *
   * Wax has neither. So each bump here varies in how far it sits from centre
   * AND in its own radius, driven by a fixed trigonometric wobble — arbitrary
   * enough to look poured, deterministic so the mark is byte-identical on every
   * render and in every screenshot.
   */
  const SCALLOPS = 11;
  const scallops = Array.from({ length: SCALLOPS }, (_, i) => {
    const a = (i / SCALLOPS) * Math.PI * 2 - Math.PI / 2;
    const wobble = Math.sin(i * 2.7) * 0.5 + Math.cos(i * 1.3) * 0.5;
    const rr = R + wobble * 1.1;
    return {
      cx: 32 + Math.cos(a) * rr,
      cy: 32 + Math.sin(a) * rr,
      r: 3.5 + wobble * 0.85,
    };
  });

  /* The fracture, as a single jagged line from top to bottom. Both clip paths
     trace it in opposite directions, so the two halves share one edge exactly
     and no hairline of background shows through the join. */
  const crack = '33.8 0 29.4 12.8 35.6 23.2 28.2 35.4 34.8 47 30.2 64';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      /* Decorative only — the heading beside it already says what happened, so
         announcing the mark as an image would just add noise. aria-hidden and
         role="img" contradict each other; this keeps the one that is true. */
      aria-hidden="true"
      className="fx-errseal"
    >
      <defs>
        {/* Warm wax, lit from the upper left. Two stops of the brand gold
            rather than a flat fill: a flat disc at this size looks like a
            sticker, and the whole point of the mark is that it looks pressed. */}
        <radialGradient id={WAX} cx="34%" cy="28%" r="78%">
          <stop offset="0%" stopColor="var(--fx-errseal-hi, #D7BE80)" />
          <stop offset="58%" stopColor="var(--fx-errseal-mid, #B8944F)" />
          <stop offset="100%" stopColor="var(--fx-errseal-lo, #8A6D34)" />
        </radialGradient>

        <clipPath id={CLIP_L}>
          <polygon points={`0 0 ${crack} 0 64`} />
        </clipPath>
        <clipPath id={CLIP_R}>
          <polygon points={`${crack} 64 64 64 0`} />
        </clipPath>
      </defs>

      {/* Each half is the SAME complete seal, clipped and then tipped away from
          the fracture. Drawing two separate half-shapes instead would mean
          maintaining the scallop maths twice for no gain. */}
      {/* The two halves are pulled APART and, more importantly, offset
          VERTICALLY by different amounts — the right sits ~2.4 units lower, as
          though it snapped and slipped. A symmetric split reads as a decorative
          line ruled down a medallion; an uneven one reads as a break, which is
          the entire job of this mark. */}
      {[
        { clip: CLIP_L, t: 'rotate(-4 32 32) translate(-2.2 -0.8)' },
        { clip: CLIP_R, t: 'rotate(4 32 32) translate(2.2 1.6)' },
      ].map(({ clip, t }) => (
        <g key={clip} clipPath={`url(#${clip})`} transform={t}>
          <g fill={`url(#${WAX})`}>
            <circle cx="32" cy="32" r={R} />
            {scallops.map((s, i) => <circle key={i} cx={s.cx} cy={s.cy} r={s.r} />)}
          </g>
          {/* The pressed ring and centre dot — the impression a signet leaves.
              Stroked in the deep tone at low opacity so it reads as debossed
              rather than as drawn on top. Clipped with everything else, so the
              ring breaks where the wax does. */}
          <circle
            cx="32" cy="32" r="10.8"
            fill="none"
            stroke="var(--fx-errseal-emboss, #6E5528)"
            strokeOpacity="0.5"
            strokeWidth="1.5"
          />
          <circle cx="32" cy="32" r="2.9" fill="var(--fx-errseal-emboss, #6E5528)" fillOpacity="0.38" />
        </g>
      ))}
    </svg>
  );
}

/**
 * @param {string}  title     Heading. Kept short — it is set in the serif face.
 * @param {string}  message   One sentence. Never an exception message: a caught
 *                            render error is a developer detail and can leak
 *                            internals.
 * @param {Node}    actions   Buttons/links. The caller owns these because the
 *                            useful next step differs per surface.
 * @param {Node}    details   Optional dev-only disclosure.
 * @param {boolean} inline    Sit inside a page instead of filling the viewport.
 *
 * The heading takes the forwarded ref so each boundary can move focus to it —
 * a client-side navigation into an error state announces nothing on its own.
 */
const ErrorState = forwardRef(function ErrorState(
  { title = 'Something went wrong', message, actions, details, inline = false },
  headingRef,
) {
  return (
    <div className={inline ? 'fx-errstate fx-errstate--inline' : 'fx-errstate'}>
      <div className="fx-errstate__card">
        <div className="fx-errstate__seal">
          <BrokenSeal size={inline ? 62 : 76} />
        </div>

        <h2 ref={headingRef} tabIndex={-1} className="fx-errstate__title">{title}</h2>
        {message && <p className="fx-errstate__body">{message}</p>}

        {details}
        {actions && <div className="fx-errstate__actions">{actions}</div>}
      </div>

      <style jsx>{`
        .fx-errstate {
          min-height: 100vh;
          min-height: 100dvh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          box-sizing: border-box;
          font-family: var(--font-sans, system-ui, sans-serif);
          background: #F8F4EC;
          /* A single soft warm light behind the card. It is what stops a flat
             beige field from reading as an unstyled fallback page. */
          background-image: radial-gradient(
            120% 78% at 50% 12%,
            rgba(215, 190, 128, 0.28) 0%,
            rgba(248, 244, 236, 0) 62%
          );
        }
        .fx-errstate--inline {
          min-height: 0;
          padding: 40px 20px;
          background: none;
          background-image: none;
        }

        .fx-errstate__card {
          position: relative;
          width: 100%;
          max-width: 460px;
          box-sizing: border-box;
          text-align: center;
          background: #FFFFFF;
          border: 1px solid #E8E2D6;
          border-radius: 20px;
          padding: 46px 38px 42px;
          box-shadow:
            0 1px 2px rgba(25, 27, 30, 0.04),
            0 18px 44px -18px rgba(25, 27, 30, 0.18);
        }
        /* A hairline of gold along the very top edge of the card. Two pixels of
           brand, and the only ornament on the screen. */
        .fx-errstate__card::before {
          content: '';
          position: absolute;
          top: -1px;
          left: 34px;
          right: 34px;
          height: 2px;
          border-radius: 2px;
          background: linear-gradient(
            90deg,
            rgba(184, 148, 79, 0) 0%,
            rgba(184, 148, 79, 0.85) 50%,
            rgba(184, 148, 79, 0) 100%
          );
        }
        .fx-errstate--inline .fx-errstate__card {
          max-width: 520px;
          padding: 34px 28px 30px;
          border-radius: 16px;
          box-shadow: none;
        }

        .fx-errstate__seal {
          display: flex;
          justify-content: center;
          margin-bottom: 22px;
        }
        .fx-errstate__seal :global(.fx-errseal) {
          display: block;
          /* Grounds the wax on the card instead of letting it float. */
          filter: drop-shadow(0 6px 12px rgba(138, 109, 52, 0.22));
        }

        .fx-errstate__title {
          font-family: var(--font-serif, "Playfair Display", Georgia, serif);
          font-size: 25px;
          line-height: 1.25;
          font-weight: 600;
          letter-spacing: -0.01em;
          color: #191B1E;
          margin: 0;
          outline: none;
        }
        .fx-errstate__body {
          font-size: 14.5px;
          line-height: 1.65;
          color: #77736A;
          margin: 12px auto 0;
          max-width: 34ch;
        }

        .fx-errstate__actions {
          margin-top: 30px;
          display: flex;
          gap: 10px;
          justify-content: center;
          align-items: center;
          flex-wrap: wrap;
        }

        /* ── The buttons, and why every one of these is :global() ──

           The actions are rendered by the BOUNDARY, not by this function, and a
           styled-jsx rule never reaches an element another function rendered
           (see frontend/AGENTS.md). A plain .fx-errstate-btn rule here would
           compile to .fx-errstate-btn.jsx-hash and match nothing at all, which
           looks exactly like unstyled buttons and nothing like a CSS bug.

           Link also renders as a component rather than an intrinsic element,
           which is the second half of the same trap. */
        :global(.fx-errstate-btn) {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-height: 44px;
          padding: 12px 26px;
          border-radius: 10px;
          font-family: var(--font-sans, system-ui, sans-serif);
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.01em;
          text-decoration: none;
          cursor: pointer;
          box-sizing: border-box;
          border: 1px solid transparent;
          transition: background-color 0.2s ease, border-color 0.2s ease, transform 0.12s ease;
        }
        :global(.fx-errstate-btn:active) { transform: translateY(1px); }
        :global(.fx-errstate-btn:focus-visible) {
          outline: 2px solid #B8944F;
          outline-offset: 2px;
        }
        :global(.fx-errstate-btn--primary) {
          background: var(--gold-cta, #8A6D34);
          color: #FFFFFF;
        }
        :global(.fx-errstate-btn--primary:hover) { background: #7A5F2C; }
        :global(.fx-errstate-btn--ghost) {
          background: transparent;
          color: #77736A;
          border-color: #E8E2D6;
        }
        :global(.fx-errstate-btn--ghost:hover) {
          background: #F8F4EC;
          color: #191B1E;
        }

        /* 320px is the binding width in this codebase. Below the sm step the
           card gives back its generous padding rather than letting the buttons
           wrap into a ragged two-line block. */
        @media (max-width: 639.98px) {
          .fx-errstate { padding: 18px 14px; }
          .fx-errstate__card { padding: 36px 22px 32px; border-radius: 16px; }
          .fx-errstate__card::before { left: 22px; right: 22px; }
          .fx-errstate__title { font-size: 22px; }
          .fx-errstate__actions { flex-direction: column; gap: 8px; width: 100%; }
          :global(.fx-errstate-btn) { width: 100%; }
        }

        @media (prefers-reduced-motion: no-preference) {
          .fx-errstate__card {
            animation: fx-errstate-in 340ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
          }
        }
        @keyframes fx-errstate-in {
          from { opacity: 0; transform: translateY(8px) scale(0.985); }
          to   { opacity: 1; transform: none; }
        }

        @media (prefers-color-scheme: dark) {
          .fx-errstate {
            background: #17181A;
            background-image: radial-gradient(
              120% 78% at 50% 12%,
              rgba(184, 148, 79, 0.16) 0%,
              rgba(23, 24, 26, 0) 62%
            );
          }
          .fx-errstate--inline { background: none; background-image: none; }
          .fx-errstate__card {
            background: #1E1E1B;
            border-color: #3D3A33;
            box-shadow:
              0 1px 2px rgba(0, 0, 0, 0.4),
              0 18px 44px -18px rgba(0, 0, 0, 0.6);
          }
          .fx-errstate__title { color: #F8F4EC; }
          .fx-errstate__body { color: #A8A397; }
          :global(.fx-errstate-btn--primary) { background: #D7BE80; color: #191B1E; }
          :global(.fx-errstate-btn--primary:hover) { background: #C9AC68; }
          :global(.fx-errstate-btn--ghost) { color: #A8A397; border-color: #3D3A33; }
          :global(.fx-errstate-btn--ghost:hover) { background: #26261F; color: #F8F4EC; }
        }
      `}</style>
    </div>
  );
});

/* BrokenSeal stays private on purpose. It was briefly exported "in case"
   something else wanted the mark; nothing did, and an exported symbol with no
   callers is a standing invitation to use this error glyph somewhere it does
   not belong. */
export default ErrorState;
