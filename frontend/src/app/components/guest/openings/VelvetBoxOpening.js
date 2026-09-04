'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { createFxPool } from '../fx/fxPool';
import { getCinematicCopy } from '../../templates/cinematic/cinematicThemes';
import {
  OPENING_TIMINGS,
  useMediaReadiness,
  useOpeningMemory,
  useScrollLock,
  watchOpeningVideo,
} from './openingSafety';

/* ═══════════════════════════════════════════════════════════════
   VELVET RING — the opening.

   A closed velvet box on a dark stage. Touch anywhere and it opens onto the
   ring, then dissolves into the invitation.

   Three paths reach the same end, chosen by what the device can actually do:

     VIDEO      the box opens on film, revealing at the frame where the lid
                is back and the stone is lit.
     STILLS     a gold blowout covers a cut between two photographs. Taken
                whenever the video never produces a frame — the cut reads as
                a camera flash rather than as a failure.
     IMMEDIATE  prefers-reduced-motion: the revealed state, then out.

   Which one ran is invisible to the guest, and that is the point.
   ═══════════════════════════════════════════════════════════════ */

/** Beats of the stills path, from the tap. */
const STILLS = { flashAt: 650, revealAt: 1000, secondSparkAt: 2800, finishAt: 3800 };
/** Long enough for the cover's own opacity transition to finish. */
const FADE_OUT_MS = 1200;
const REDUCED_MOTION_HOLD_MS = 700;

export default function VelvetBoxOpening({
  template,
  names,
  lang = 'en',
  // Velvet Ring is always an engagement, so this changes nothing here — it is
  // accepted and forwarded so every opening reads its copy the same way and a
  // template that later varies a line by occasion cannot silently miss it.
  occasion = null,
  sessionKey = null,
  onComplete,
  onGesture,
}) {
  const isRTL = lang === 'ar';
  const copy = getCinematicCopy(template, { isRTL, occasion });
  const { poster, video: videoSrc, revealed } = template.assets;

  const rootRef = useRef(null);
  const videoRef = useRef(null);
  const fxRef = useRef(null);
  const poolRef = useRef(null);
  const timersRef = useRef([]);
  const watchRef = useRef(null);
  const openedRef = useRef(false);
  const finishedRef = useRef(false);

  const reduceMotion = useReducedMotion();
  const ready = useMediaReadiness(videoRef, { enabled: !reduceMotion });
  const [alreadySeen, remember] = useOpeningMemory(sessionKey);

  const [phase, setPhase] = useState('idle'); // idle | arming | playing | flash | revealed | done

  /* loading → tap → preparing, and never backwards: once the guest has
     committed, "loading…" reappearing would read as the tap having failed.
     Only the last step is a decision this component makes; the first two are
     just `ready`, so they are read from it rather than mirrored into a second
     piece of state that an effect has to keep in step. */
  const [preparing, setPreparing] = useState(false);
  const hint = preparing ? 'preparing' : ready ? 'tap' : 'loading';

  useScrollLock(phase !== 'done');

  /* Same contract as InvitationReveal: a sessionKey means "once per session".
     A returning guest who has already watched the box open is let straight
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
      watchRef.current?.cancel();
      poolRef.current?.destroy();
    };
  }, []);

  const after = useCallback((ms, fn) => {
    timersRef.current.push(setTimeout(fn, ms));
  }, []);

  /* The box sits at the optical centre of the frame, a little below the
     geometric one — bursts have to originate there, not at 50/50, or the
     light appears to come from above the lid. */
  const boxCentre = useCallback(() => {
    /* Measured against the FX layer's own window, not the top-level one. The
       organizer's preview portals this page into an iframe (PreviewFrame.js),
       where `window` is still the dashboard's — so the burst originated
       hundreds of pixels outside a 390px frame and the reveal appeared to
       have no light source at all. The two are the same window for a guest. */
    const view = fxRef.current?.ownerDocument?.defaultView || window;
    return { x: view.innerWidth * 0.5, y: view.innerHeight * 0.55 };
  }, []);

  /* Latched. watchOpeningVideo already promises exactly one of onReveal /
     onFallback, so today only one path reaches here — but the reduced-motion
     short path and the stills timeline both call it too, and a future rung
     that ends the opening should not have to know it is the only one.
     Arriving at the invitation twice is not a recoverable state. */
  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setPhase('done');
    remember();
    // Held mounted through its own fade-out — unmounting on the same tick
    // would cut the cover away instead of dissolving it into the hero.
    after(FADE_OUT_MS, () => onComplete?.());
  }, [after, onComplete, remember]);

  const revealAndFinish = useCallback(() => {
    const { x, y } = boxCentre();
    setPhase('revealed');
    poolRef.current?.burstSparks(x, y - 40, 16, 150);
    poolRef.current?.burstPetals(x, y - 30, 10);
    finish();
  }, [boxCentre, finish]);

  const runStillsPath = useCallback(() => {
    const { x, y } = boxCentre();
    after(STILLS.flashAt, () => setPhase('flash'));
    after(STILLS.revealAt, () => {
      setPhase('revealed');
      poolRef.current?.burstSparks(x, y - 40, 16, 150);
      poolRef.current?.burstPetals(x, y - 30, 10);
    });
    after(STILLS.secondSparkAt, () => poolRef.current?.burstSparks(x, y - 70, 8, 95));
    after(STILLS.finishAt, finish);
  }, [after, boxCentre, finish]);

  const open = useCallback(() => {
    if (openedRef.current) return;
    // Before the video can play, a tap would start a sequence with nothing
    // to show. The hint already says "loading"; leave it saying so.
    if (!reduceMotion && !ready) return;
    openedRef.current = true;

    // Inside the gesture, synchronously — this is the one moment a browser
    // will let the page make noise, and any await forfeits it.
    onGesture?.();

    if (reduceMotion) {
      setPhase('revealed');
      after(REDUCED_MOTION_HOLD_MS, finish);
      return;
    }

    setPhase('arming');
    after(OPENING_TIMINGS.preparingHintMs, () => { setPreparing(true); });

    const el = videoRef.current;
    if (!el) { runStillsPath(); return; }

    // Also inside the gesture: a play() deferred to a callback is refused on
    // iOS and in low-power mode, which is exactly when this matters most.
    const played = el.play?.();
    if (played?.catch) played.catch(() => { /* the watchdog takes it from here */ });

    watchRef.current = watchOpeningVideo(el, {
      revealAt: template.revealAtSeconds,
      onStart: () => setPhase('playing'),
      onReveal: revealAndFinish,
      onFallback: runStillsPath,
    });
  }, [reduceMotion, ready, onGesture, after, finish, runStillsPath, revealAndFinish, template.revealAtSeconds]);

  const hintLabel = hint === 'loading' ? copy.loading : hint === 'preparing' ? copy.preparing : copy.hint;

  const stateClass = [
    /* `done` belongs in this list. is-arming holds the scene at scale(1.07),
       and dropping it at the moment the cover starts fading animates the
       photograph back down to 1 over 0.8s — while the hero behind, showing the
       same photograph at 1, is fading in. The two drift against each other in
       exactly the frames the crossfade is meant to hide. Every phase from
       arming onward keeps it. */
    phase !== 'idle' ? 'is-arming' : '',
    phase === 'playing' ? 'is-playing' : '',
    phase === 'flash' ? 'is-flash' : '',
    phase === 'revealed' ? 'is-revealed' : '',
    phase === 'done' ? 'is-done is-revealed' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={rootRef}
      className={`cine-open cine-ring ${stateClass}`}
      style={template.cssVars}
      dir={isRTL ? 'rtl' : 'ltr'}
      data-testid="cine-opening"
      data-opening="velvetBox"
    >
      <div className="cine-ring__scene" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="cine-ring__plate cine-ring__closed" src={poster} alt="" />
        <video
          ref={videoRef}
          className="cine-ring__plate cine-ring__video"
          src={videoSrc}
          muted
          playsInline
          webkit-playsinline="true"
          preload="auto"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="cine-ring__plate cine-ring__open" src={revealed} alt="" />
        <span className="cine-ring__glints">
          <span className="cine-ring__glint" />
          <span className="cine-ring__glint" />
          <span className="cine-ring__glint" />
        </span>
      </div>

      <div className="cine-ring__beam" aria-hidden="true">
        <span /><span /><span /><span /><span />
        <span /><span /><span /><span /><span />
      </div>

      <div className="cine-ring__tapglow" aria-hidden="true" />
      <div className="cine-ring__flash" aria-hidden="true" />

      <button
        type="button"
        className="cine-open__tap"
        onClick={open}
        aria-label={copy.hint}
        data-testid="cine-opening-tap"
      />

      <div className="cine-ring__ui">
        <p className="cine-ring__latin" aria-hidden="true">{copy.latin}</p>
        <p className="cine-ring__kicker">{copy.kicker}</p>
        <p className="cine-ring__names">{names}</p>
        <p className="cine-ring__hint">
          <span className="cine-ring__hintring" aria-hidden="true" />
          <span data-testid="cine-opening-hint">{hintLabel}</span>
        </p>
      </div>

      <div className="cine-fx" ref={fxRef} aria-hidden="true" />
    </div>
  );
}
