'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import {
  getCinematicCopy,
  LETTER_FOCUS, LETTER_FOCUS_DEFAULT,
  LETTER_TEXT_POS, LETTER_TEXT_POS_DEFAULT,
} from './cinematicThemes';
import HeroCardDownload from './HeroCardDownload';

/* ═══════════════════════════════════════════════════════════════
   SEALED LETTER — the hero.

   The couple's own photograph, full bleed, with their own words on it.

   ── This template ships no hero artwork, and that is the point ───────────
   Velvet Ring, Door of Joy and Swan Lake each open onto photography we
   supplied, so every event using them arrives at the same picture. This one
   arrives at THEIRS.

   It did not start that way. The first version put a carved ivory frame at
   the fold with a stock illustrated couple printed into it, and fitted the
   organizer's photograph into the frame's inner panel — about a fifth of the
   screen, under someone else's drawing of a bride. The invitation's largest
   image was still not the couple's. The frame is gone; the photograph is the
   fold.

   ── No photograph is still a finished page ───────────────────────────────
   With nothing uploaded this is a typographic hero on the template's own
   paper: names, date, occasion. Not a placeholder, not a grey box, and above
   all not a stand-in couple — an organizer who has not reached that field yet
   sees a complete invitation, and one who never uploads anything still has a
   good one.

   ── The scrim follows the type ───────────────────────────────────────────
   A full-bleed photograph has no fixed safe area: one couple's picture is sky
   at the top, another's is faces. So the organizer chooses where the words
   go, and the scrim is drawn from THAT edge — the words always have ground
   under them and the rest of the picture is left alone. A scrim over the
   whole frame would be the lazy version and would flatten every photograph
   uploaded to it.

   ── Why the entrance waits ───────────────────────────────────────────────
   This hero mounts with the rest of the page, UNDERNEATH the opening, a
   second or two before the guest can see it. Running the entrance on mount
   would spend it behind a sealed envelope. It waits on `openingActive` going
   false — the same `showReveal` that dismisses the cover. Same contract as
   SwanLakeHero.
   ═══════════════════════════════════════════════════════════════ */

/** Released on the next frame, with a timer backstop for a backgrounded tab. */
const ARRIVE_BACKSTOP_MS = 140;

export default function LetterPortraitHero({
  template, names, tagline, dateLine, coupleNames,
  /* The organizer's five fields. An empty `heroPhoto` is a normal, finished
     state — see the header. */
  heroPhoto, heroFocus, heroTextPos, heroCaption, heroCaptionSub,
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
    // a slow zoom across a full-screen photograph is exactly the kind of thing
    // the preference is asking us not to do.
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
  const textPos = LETTER_TEXT_POS[heroTextPos] ? heroTextPos : LETTER_TEXT_POS_DEFAULT;

  const caption = (heroCaption || '').trim();
  const captionSub = (heroCaptionSub || '').trim();

  return (
    <div
      className={[
        'cine-hero cine-lhero',
        heroPhoto ? 'has-photo' : 'is-bare',
        `pos-${textPos}`,
        arriving ? 'is-arriving' : '',
      ].filter(Boolean).join(' ')}
      style={template.cssVars}
      data-cine-stage
      data-testid="cine-hero-letter"
    >
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

      {/* Drawn from the edge the type is anchored to — see the header. Absent
          entirely with no photograph, where the ground is already paper and a
          scrim would only dirty it. */}
      {heroPhoto && <div className="cine-lhero__scrim" aria-hidden="true" />}

      <div className="cine-hero__inner cine-lhero__inner">
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

          {dateLine && <p className="cine-lhero__date">{dateLine}</p>}

          {/* The organizer's own line, and the reason the tagline below is
              conditional: with a photograph these are their words on their
              picture, and the occasion's generic tagline underneath them
              would be a second, weaker sentence saying less. */}
          {caption && <p className="cine-lhero__caption">{caption}</p>}
          {captionSub && <p className="cine-lhero__captionsub">{captionSub}</p>}

          {/* Only when they have written nothing of their own. */}
          {tagline && !caption && !captionSub && <p className="cine-lhero__sub">{tagline}</p>}
        </div>

        {/* Travels WITH the words. It is part of the invitation — the thing
            the guest saves — so it belongs under the names wherever those
            are, not stranded at an edge away from them. */}
        <HeroCardDownload
          pattern={invitationPattern}
          theme={invitationTheme}
          guestName={invitationGuestName}
          data={invitationData}
          title={title}
          isRTL={isRTL}
        />
      </div>

      {/* Pinned to the foot, and NOT part of the block above. A scroll cue
          points at the edge you scroll from; carried along with the words it
          ended up halfway up a photograph pointing at nothing in particular,
          which the screenshot pass showed for both the top and middle
          settings. `.cine-lhero__inner` reserves its height at every position
          so the two never sit on top of each other. */}
      <span className="cine-hero__cue cine-lhero__cue" aria-hidden="true">
        <span className="cine-hero__cue-label">{copy.scroll}</span>
        <span className="cine-hero__cue-arrow">&#8595;</span>
      </span>
    </div>
  );
}
