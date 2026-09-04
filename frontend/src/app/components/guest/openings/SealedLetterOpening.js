'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { createFxPool } from '../fx/fxPool';
import { getCinematicCopy } from '../../templates/cinematic/cinematicThemes';
import useOpeningSfx from './useOpeningSfx';
import {
  OPENING_TIMINGS,
  useImageReadiness,
  useOpeningMemory,
  useScrollLock,
} from './openingSafety';

/* ═══════════════════════════════════════════════════════════════
   SEALED LETTER — the opening.

   A blush envelope closed with a burgundy wax seal. Touch it: the seal
   catches the light and gilds, then both flaps fall open.

   ── The one opening here that is not a film ──────────────────────────────
   Velvet Ring, Door of Joy and Swan Lake each stream an .mp4, and
   openingSafety.js exists almost entirely to survive the ways that can fail —
   a refused autoplay, a decode that stalls without reporting anything, a
   handset in low-power mode. This cover is 17 frames on ONE 220KB JPEG,
   stepped by CSS `steps()`. Once the sheet has arrived the animation cannot
   fail: there is no decoder to stall, no autoplay policy to be refused by and
   no playback position to watch.

   So the ladder is shorter, and honestly so — three rungs, not five:

     1. READINESS GATE   taps do nothing until the sprite has decoded, and are
                         armed anyway after 7s (useImageReadiness). An error
                         arms too: a blank cover whose tap is also dead is the
                         only thing worse than a blank cover.
     2. PREPARING HINT   at 900ms with nothing on screen, the cover says so.
     3. END + BACKSTOP   `animationend` is the real signal; a timer at the
                         sprite's own duration covers the case it cannot —
                         a BACKGROUNDED TAB, where CSS animations are throttled
                         or paused and the event may never arrive at all.

   Both of those last two call finish(), which is why finish() is latched. The
   swans pass established the rule the hard way: arriving at the invitation
   twice is not a recoverable state.

   Everything the guest can perceive is identical to the other three by
   design — the same tap target over the whole cover, the same kicker/names/
   hint that fade as it opens, the same session memory, the same music-starts-
   inside-the-gesture contract.
   ═══════════════════════════════════════════════════════════════ */

/* Long enough for the cover's own cross-fade to finish. The fade STARTS at
   revealAtMs and runs 0.7s (see .cine-letter.is-revealed), while finish()
   arrives on `animationend` a couple of hundred milliseconds later — so this
   is measured from finish(), not from the tap, and has margin over what is
   left of the fade. Unmounting sooner would cut the cover away mid-dissolve. */
const FADE_OUT_MS = 1200;
const REDUCED_MOTION_HOLD_MS = 650;
/** Slack on the backstop, so it never beats a healthy `animationend`. */
const BACKSTOP_SLACK_MS = 450;
/** Into the sprite, not at the tap: frame 0 is a sealed, unlit seal. */
const SEAL_SFX_AT_MS = 260;

export default function SealedLetterOpening({
  template,
  names,
  lang = 'en',
  occasion = null,
  sessionKey = null,
  onComplete,
  onGesture,
}) {
  const isRTL = lang === 'ar';
  const copy = getCinematicCopy(template, { isRTL, occasion });
  const { sprite, poster } = template.assets;
  const { spriteFrames, spriteDurationMs, revealAtMs } = template;

  const fxRef = useRef(null);
  const poolRef = useRef(null);
  const timersRef = useRef([]);
  const openedRef = useRef(false);
  const finishedRef = useRef(false);

  const reduceMotion = useReducedMotion();
  const ready = useImageReadiness(sprite, { enabled: !reduceMotion });
  const [alreadySeen, remember] = useOpeningMemory(sessionKey);
  /* No recording ships for this template — `sealSfx` is absent from the theme
     on purpose. useOpeningSfx falls through to its synthesiser when the URL is
     missing or a decode fails, so the seal is never silent; dropping a real
     sample in at that path upgrades it with no code change.

     Destructured, not held as an object: useOpeningSfx returns a fresh object
     literal every render, so keeping `sfx` would put a new identity in the
     dependency list of every callback below on every render. Same as
     KnockDoorOpening and WaxEnvelopeOpening. */
  const { playSeal, prime } = useOpeningSfx({ sealUrl: template.assets.sealSfx });

  const [phase, setPhase] = useState('idle'); // idle | opening | revealed | done

  /* loading → tap → preparing, and never backwards: once the guest has
     committed, "loading…" reappearing would read as the tap having failed.
     Only the last step is a decision this component makes; the first two are
     just `ready`, so they are read from it rather than mirrored into a second
     piece of state that an effect has to keep in step. */
  const [preparing, setPreparing] = useState(false);
  const hint = preparing ? 'preparing' : ready ? 'tap' : 'loading';

  useScrollLock(phase !== 'done');

  /* Same contract as InvitationReveal: a sessionKey means "once per session".
     A returning guest who has already watched the letter open is let straight
     through rather than made to sit through it to reach the RSVP. */
  useEffect(() => {
    if (alreadySeen && !openedRef.current) {
      openedRef.current = true;
      onComplete?.();
    }
  }, [alreadySeen, onComplete]);

  useEffect(() => {
    const layer = fxRef.current;
    if (layer) poolRef.current = createFxPool(layer);
    const timers = timersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.length = 0;
      poolRef.current?.destroy();
    };
  }, []);

  const after = useCallback((ms, fn) => {
    timersRef.current.push(setTimeout(fn, ms));
  }, []);

  /* The seal sits at the optical centre of the frame, a little above the
     geometric one — the flaps meet there, and petals thrown from 50/50 appear
     to fall from the fold below it rather than from the seal.

     Measured against the FX layer's own window, not the top-level one. The
     organizer's preview portals this page into an iframe (PreviewFrame.js)
     where `window` is still the dashboard's, so a burst positioned from it
     originated hundreds of pixels outside a 390px frame. The two are the same
     window for a guest. */
  const sealCentre = useCallback(() => {
    const view = fxRef.current?.ownerDocument?.defaultView || window;
    return { x: view.innerWidth * 0.5, y: view.innerHeight * 0.45 };
  }, []);

  /* Latched. `animationend` and the backgrounded-tab backstop both end the
     opening and both can land — see the header. */
  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setPhase('done');
    remember();
    // Held mounted through its own fade-out — unmounting on the same tick
    // would cut the cover away instead of dissolving it into the hero.
    after(FADE_OUT_MS, () => onComplete?.());
  }, [after, onComplete, remember]);

  /* The cross-fade, at revealAtMs. Deliberately BEFORE the sprite finishes:
     the flaps are mid-swing and the dark gap between them is opening, so
     starting the dissolve here covers that gap with the hero instead of
     holding on it. */
  const reveal = useCallback(() => {
    const { x, y } = sealCentre();
    setPhase('revealed');
    poolRef.current?.burstPetals(x, y + 40, 12);
  }, [sealCentre]);

  const open = useCallback(() => {
    if (openedRef.current) return;
    // Before the sprite has arrived, a tap would start a sequence with nothing
    // to show. The hint already says "loading"; leave it saying so.
    if (!reduceMotion && !ready) return;
    openedRef.current = true;

    // Inside the gesture, synchronously — this is the one moment a browser
    // will let the page make noise, and any await forfeits it.
    onGesture?.();
    // Opens the audio output while we still hold the gesture, so the seal
    // breaking ~260ms later plays into an already-running context instead of
    // racing resume(). Same reason KnockDoorOpening primes here.
    prime();

    if (reduceMotion) {
      setPhase('revealed');
      after(REDUCED_MOTION_HOLD_MS, finish);
      return;
    }

    setPhase('opening');
    after(OPENING_TIMINGS.preparingHintMs, () => { setPreparing(true); });
    after(SEAL_SFX_AT_MS, playSeal);
    after(revealAtMs, reveal);
    /* The backstop. `animationend` on the sprite layer is the real signal, but
       CSS animations are throttled or suspended in a backgrounded tab, so a
       guest who taps and switches apps could come back to a cover that never
       ended. This timer is not throttled the same way and closes that. */
    after(spriteDurationMs + BACKSTOP_SLACK_MS, finish);
  }, [reduceMotion, ready, onGesture, prime, after, playSeal, reveal, finish, revealAtMs, spriteDurationMs]);

  const hintLabel = hint === 'loading' ? copy.loading : hint === 'preparing' ? copy.preparing : copy.hint;

  const stateClass = [
    /* Every phase from the tap onward keeps `is-opening`: it is what holds the
       sprite's `forwards` fill and what keeps the cover UI faded out. Dropping
       it at reveal would snap the envelope back to frame 0 and the names back
       into view, in exactly the frames the cross-fade exists to hide. */
    phase !== 'idle' ? 'is-opening is-playing' : '',
    phase === 'revealed' ? 'is-revealed' : '',
    phase === 'done' ? 'is-done is-revealed' : '',
  ].filter(Boolean).join(' ');

  /* The sprite's geometry, derived from ONE number so a re-cut sheet cannot
     produce an animation that ends a frame early and freezes on a half-open
     envelope: N frames laid out horizontally are N×100% wide, and stepping
     from 0% to 100% across them takes N−1 steps. */
  const spriteVars = {
    /* No `--cine-letter-frames` here. It was set — the raw frame count — and
       the stylesheet never read it, because both things the CSS actually
       needs are derived values. A custom property nothing reads is dead
       weight that looks load-bearing. */
    '--cine-letter-sheet': `${spriteFrames * 100}%`,
    '--cine-letter-steps': String(spriteFrames - 1),
    '--cine-letter-dur': `${spriteDurationMs}ms`,
    backgroundImage: `url("${sprite}")`,
  };

  return (
    <div
      className={`cine-open cine-letter ${stateClass}`}
      style={template.cssVars}
      dir={isRTL ? 'rtl' : 'ltr'}
      data-testid="cine-opening"
      data-opening="sealedLetter"
    >
      <div className="cine-letter__scene" aria-hidden="true">
        {/* Under the sprite, and identical to its first frame. 22KB against
            220, so the guest is looking at a sealed envelope while the sheet
            arrives instead of at bare paper — and when the sheet does arrive
            it covers this with exactly the same picture, so there is nothing
            to see happen. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="cine-letter__poster" src={poster} alt="" />
        <div
          className="cine-letter__anim"
          style={spriteVars}
          /* The real end signal. Latched against the backstop above, and
             harmless if the backstop got there first. */
          onAnimationEnd={finish}
          data-testid="cine-letter-anim"
        />
      </div>

      <div className="cine-letter__vignette" aria-hidden="true" />

      <button
        type="button"
        className="cine-open__tap"
        onClick={open}
        aria-label={copy.hint}
        data-testid="cine-opening-tap"
      />

      <div className="cine-letter__ui">
        <p className="cine-letter__kicker">{copy.kicker}</p>
        <div className="cine-letter__caption">
          <p className="cine-letter__names">{names}</p>
          <p className="cine-letter__hint" data-testid="cine-opening-hint">{hintLabel}</p>
        </div>
      </div>

      <div className="cine-fx" ref={fxRef} aria-hidden="true" />
    </div>
  );
}
