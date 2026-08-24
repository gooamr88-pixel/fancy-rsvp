'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { getCinematicCopy, LETTER_FOCUS, LETTER_FOCUS_DEFAULT } from './cinematicThemes';
import HeroCardDownload from './HeroCardDownload';

/* ═══════════════════════════════════════════════════════════════
   SEALED LETTER — the hero.

   A carved ivory frame with a flat panel in the middle, and what goes in the
   panel is the ORGANIZER'S: their photograph, their words on it.

   ── Why this hero is not like the other three ────────────────────────────
   Velvet Ring, Door of Joy and Swan Lake each open onto photography we
   shipped — a lit box, a garden gate, a painted lake. Beautiful, and the same
   picture on every event that uses them. This one ships a frame and leaves the
   picture to the couple, which is the whole reason it exists.

   ── The panel is measured, not guessed ───────────────────────────────────
   LETTER_PANEL in cinematicThemes.js holds the fractions, taken off the
   artwork with a luminance-variance scan. They matter more than they look:
   the frame has a couple ILLUSTRATED into the bottom third of its panel, so a
   photograph inset even slightly too far leaves a printed bride's veil
   showing beside a real one.

   Which is also why the photo is opaque from ~34% down and only feathered at
   the TOP. The feather is not decoration — it is what lets the names sit on a
   soft blend of photograph and damask instead of being dropped flat onto a
   face, and it is the reason this reads as a framed portrait rather than as
   text over a picture.

   ── No photograph is a complete state, not an empty one ──────────────────
   With nothing uploaded we paint nothing, and the frame's own illustrated
   couple stands. An organizer who has not reached that field yet still sees a
   finished invitation — the template is never broken-looking, and there is no
   placeholder box telling them they have failed to do something.

   ── Why the entrance waits ───────────────────────────────────────────────
   This hero mounts with the rest of the page, UNDERNEATH the opening, a second
   or two before the guest can see it. Running the entrance on mount would
   spend the whole thing behind a sealed envelope. So it waits on
   `openingActive` going false — the same `showReveal` that dismisses the
   cover — and the two run together. Same contract as SwanLakeHero, and an
   event with the opening turned off arrives already settled rather than
   performing a transition out of a state the guest never saw.
   ═══════════════════════════════════════════════════════════════ */

/** Released on the next frame, with a timer backstop for a backgrounded tab. */
const ARRIVE_BACKSTOP_MS = 140;

export default function LetterFrameHero({
  template, names, tagline, dateLine, coupleNames,
  /* The organizer's three answers. `heroPhoto` empty is a normal, finished
     state — see the header. */
  heroPhoto, heroFocus, heroCaption, heroCaptionSub,
  invitationPattern, invitationTheme, invitationGuestName, invitationData,
  title, isRTL, occasion = null, openingActive = false,
}) {
  const copy = getCinematicCopy(template, { isRTL, occasion });
  const reduceMotion = useReducedMotion();

  /* Whether an opening has ever covered this hero. A ref, not state: it only
     decides which branch the effect below takes, and re-rendering on it would
     be a render that changes nothing. */
  const sawOpening = useRef(openingActive);
  const [arriving, setArriving] = useState(openingActive && !reduceMotion);

  useEffect(() => {
    // Reduced motion gets the settled picture. The entrance is decorative and
    // a staggered composition across a full-height portrait is exactly the
    // kind of thing the preference is asking us not to do.
    if (reduceMotion) { setArriving(false); return undefined; }
    if (openingActive) { sawOpening.current = true; setArriving(true); return undefined; }
    if (!sawOpening.current) { setArriving(false); return undefined; }

    /* Released on the next frame so the browser has a painted starting state
       to interpolate FROM — clearing it in the same commit produces no
       transition at all, just the end state.

       The timer is not redundant: requestAnimationFrame does not fire in a
       backgrounded tab, and a guest who opened the invitation and switched
       apps would come back to a hero frozen at its entrance. */
    const raf = requestAnimationFrame(() => setArriving(false));
    const backstop = setTimeout(() => setArriving(false), ARRIVE_BACKSTOP_MS);
    return () => { cancelAnimationFrame(raf); clearTimeout(backstop); };
  }, [openingActive, reduceMotion]);

  const objectPosition = LETTER_FOCUS[heroFocus] || LETTER_FOCUS[LETTER_FOCUS_DEFAULT];
  const caption = (heroCaption || '').trim();
  const captionSub = (heroCaptionSub || '').trim();
  /* Absent, not empty. A plate with no words in it is a grey band across the
     couple's photograph — the exact "cramped or borderless" failure this
     design keeps having to be rescued from. */
  const hasPlate = !!(caption || captionSub);

  return (
    <div
      className={`cine-hero cine-lhero ${arriving ? 'is-arriving' : ''}`}
      /* The frame's URL is threaded in rather than written into the
         stylesheet, so `assets.frame` is the single place the path lives.
         Hardcoding it there put the same path in two files with nothing
         checking they agreed — and made the hero unstageable for the
         screenshot harness, which rewrites asset paths in the markup only and
         so photographed the panel with no frame around it. */
      style={{ ...template.cssVars, '--cine-letter-frame': `url("${template.assets.frame}")` }}
      data-cine-stage
      data-testid="cine-hero-letter"
    >
      {/* Sized to the artwork's own 780×1386 so the panel below can be placed
          in percentages of it. Not a background on the stage: `contain` fits
          the picture but tells CSS nothing about WHERE it landed, and the
          whole hero is built on knowing that. */}
      <div className="cine-lhero__frame">
        <div className="cine-lhero__panel">
          {heroPhoto && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              className="cine-lhero__photo"
              src={heroPhoto}
              alt=""
              style={{ objectPosition }}
              data-testid="cine-lhero-photo"
            />
          )}

          <div className="cine-lhero__type">
            <p className="cine-lhero__kicker">{copy.kicker}</p>

            <h1 className="cine-lhero__names">
              {coupleNames ? (
                <>
                  <span className="cine-hero__name cine-lhero__shimmer">{coupleNames[0]}</span>
                  <span className="cine-lhero__amp" aria-hidden="true">&amp;</span>
                  <span className="cine-hero__name cine-lhero__shimmer">{coupleNames[1]}</span>
                </>
              ) : (
                <span className="cine-hero__name cine-lhero__shimmer">{names}</span>
              )}
            </h1>

            {/* No flanking hairlines, unlike Swan Lake's date. They were here
                and the screenshot pass removed them: two rules plus their gaps
                took ~70px of a ~260px measure, which is precisely what pushed
                "2026" onto a second line at 768px — and this line can be
                longer still, because it is the date and the time joined. An
                ornament that costs the information a line is not an ornament.
                Centred plain text wraps gracefully at any length. */}
            {dateLine && <p className="cine-lhero__date">{dateLine}</p>}

            {/* Only when the panel is otherwise empty.
                The type sits on the plaster ABOVE the photograph — about 190px
                of it on a phone — and kicker + two names + date already fill
                that. Adding two more lines of tagline pushed the date down
                onto the picture, which is the exact problem moving the photo
                out from under the type was meant to solve.

                Nothing is lost: with a photograph, the organizer's own caption
                is the line this template gives them, and the occasion's
                tagline still appears in the sections below. Without one, there
                is room and the empty state reads better for having it. */}
            {tagline && !heroPhoto && <p className="cine-lhero__sub">{tagline}</p>}
          </div>

          {hasPlate && (
            <div className="cine-lhero__plate" data-testid="cine-lhero-plate">
              {caption && <p className="cine-lhero__caption">{caption}</p>}
              {captionSub && <p className="cine-lhero__captionsub">{captionSub}</p>}
            </div>
          )}
        </div>
      </div>

      {/* Below the frame, not on it. The save button and the scroll cue are
          chrome the guest acts on; putting them inside the portrait would make
          the couple's photograph a toolbar. */}
      <div className="cine-hero__inner cine-lhero__inner">
        <HeroCardDownload
          pattern={invitationPattern}
          theme={invitationTheme}
          guestName={invitationGuestName}
          data={invitationData}
          title={title}
          isRTL={isRTL}
        />

        <span className="cine-hero__cue" aria-hidden="true">
          <span className="cine-hero__cue-label">{copy.scroll}</span>
          <span className="cine-hero__cue-arrow">&#8595;</span>
        </span>
      </div>
    </div>
  );
}
