'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { createFxPool } from '../fx/fxPool';
import { getCinematicCopy } from '../../templates/cinematic/cinematicThemes';
import useOpeningSfx from './useOpeningSfx';
import {
  OPENING_TIMINGS,
  useMediaReadiness,
  useOpeningMemory,
  useScrollLock,
  watchOpeningVideo,
} from './openingSafety';

/* ═══════════════════════════════════════════════════════════════
   SWAN LAKE — the opening.

   An olive envelope engraved with foliage, closed with an ivory wax seal of
   two swans. Touch it: the seal breaks, the four flaps fall open, and the
   embossed card rises out of it.

   Three paths reach the same end, chosen by what the device can actually do —
   the same ladder VelvetBoxOpening runs, and for the same reason: a cinematic
   opening is a video gate in front of the ENTIRE invitation, so every way the
   video can fail has to end with the guest inside anyway.

     VIDEO      the envelope opens on film, revealing at the frame where the
                card is fully risen (template.revealAtSeconds).
     STILLS     an ivory bloom covers a cut between the sealed envelope and
                the embossed card. Taken whenever the video never produces a
                frame — it reads as paper catching the light, not as a
                failure.
     IMMEDIATE  prefers-reduced-motion: the revealed state, then out.

   Which one ran is invisible to the guest, and that is the point.
   ═══════════════════════════════════════════════════════════════ */

/** Beats of the stills path, from the tap. */
const STILLS = { crackAt: 520, bloomAt: 900, revealAt: 1250, settleAt: 2900, finishAt: 3900 };
/** Long enough for the cover's own opacity transition to finish. */
const FADE_OUT_MS = 1200;
const REDUCED_MOTION_HOLD_MS = 700;

export default function WaxEnvelopeOpening({
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
  const { poster, video: videoSrc, revealed } = template.assets;

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
  /* No recording ships for this template — `sealSfx` is absent from the theme
     on purpose. useOpeningSfx falls through to its synthesiser when the URL is
     missing or a decode fails, so the seal is never silent; dropping a real
     sample in at that path upgrades it with no code change. */
  /* Destructured, not held as an object: useOpeningSfx returns a fresh object
     literal every render, so keeping `sfx` would put a new identity in the
     dependency list of every callback below on every render. The individual
     functions are each useCallback'd and stable. Same as KnockDoorOpening. */
  const { playSeal, prime } = useOpeningSfx({ sealUrl: template.assets.sealSfx });

  const [phase, setPhase] = useState('idle'); // idle | arming | playing | bloom | revealed | done

  /* loading → tap → preparing, and never backwards: once the guest has
     committed, "loading…" reappearing would read as the tap having failed.
     Only the last step is a decision this component makes; the first two are
     just `ready`, so they are read from it rather than mirrored into a second
     piece of state that an effect has to keep in step. */
  const [preparing, setPreparing] = useState(false);
  const hint = preparing ? 'preparing' : ready ? 'tap' : 'loading';

  useScrollLock(phase !== 'done');

  /* Same contract as InvitationReveal: a sessionKey means "once per session".
     A returning guest who has already watched the envelope open is let
     straight through rather than made to sit through it to reach the RSVP. */
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

  /* The seal sits at the optical centre of the frame, a little above the
     geometric one — the envelope's flaps meet there, and light thrown from
     50/50 appears to come from the fold below it instead. */
  const sealCentre = useCallback(() => {
    /* Measured against the FX layer's own window, not the top-level one. The
       organizer's preview portals this page into an iframe (PreviewFrame.js),
       where `window` is still the dashboard's — so the burst originated
       hundreds of pixels outside a 390px frame and the reveal appeared to
       have no light source at all. The two are the same window for a guest. */
    const view = fxRef.current?.ownerDocument?.defaultView || window;
    return { x: view.innerWidth * 0.5, y: view.innerHeight * 0.45 };
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
    const { x, y } = sealCentre();
    setPhase('revealed');
    poolRef.current?.burstPetals(x, y + 40, 12);
    finish();
  }, [sealCentre, finish]);

  const runStillsPath = useCallback(() => {
    const { x, y } = sealCentre();
    after(STILLS.crackAt, playSeal);
    after(STILLS.bloomAt, () => setPhase('bloom'));
    after(STILLS.revealAt, () => {
      setPhase('revealed');
      poolRef.current?.burstPetals(x, y + 40, 12);
    });
    after(STILLS.settleAt, () => poolRef.current?.burstPetals(x, y - 20, 6));
    after(STILLS.finishAt, finish);
  }, [after, sealCentre, finish, playSeal]);

  const open = useCallback(() => {
    if (openedRef.current) return;
    // Before the video can play, a tap would start a sequence with nothing
    // to show. The hint already says "loading"; leave it saying so.
    if (!reduceMotion && !ready) return;
    openedRef.current = true;

    // Inside the gesture, synchronously — this is the one moment a browser
    // will let the page make noise, and any await forfeits it.
    onGesture?.();
    // Opens the audio output while we still hold the gesture, so the crack
    // ~700ms later plays into an already-running context instead of racing
    // resume(). Same reason KnockDoorOpening primes here.
    prime();

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
      onStart: () => {
        setPhase('playing');
        // The wax cracks a beat into the footage, not at play() — the seal is
        // still whole for the first frames, and a crack over an intact seal
        // is the same mistake as Door of Joy creaking at a shut door.
        after(700, playSeal);
      },
      onReveal: revealAndFinish,
      onFallback: runStillsPath,
    });
  }, [reduceMotion, ready, onGesture, prime, playSeal, after, finish, runStillsPath, revealAndFinish, template.revealAtSeconds]);

  const hintLabel = hint === 'loading' ? copy.loading : hint === 'preparing' ? copy.preparing : copy.hint;

  const stateClass = [
    /* `done` belongs in this list. is-arming holds the scene at scale(1.05),
       and dropping it at the moment the cover starts fading animates the
       photograph back down to 1 over 0.8s — while the hero behind is fading
       in. The two drift against each other in exactly the frames the
       crossfade is meant to hide. Every phase from arming onward keeps it. */
    phase !== 'idle' ? 'is-arming' : '',
    phase === 'playing' ? 'is-playing' : '',
    phase === 'bloom' ? 'is-bloom' : '',
    phase === 'revealed' ? 'is-revealed' : '',
    phase === 'done' ? 'is-done is-revealed' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={`cine-open cine-swan ${stateClass}`}
      style={template.cssVars}
      dir={isRTL ? 'rtl' : 'ltr'}
      data-testid="cine-opening"
      data-opening="waxEnvelope"
    >
      <div className="cine-swan__scene" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="cine-swan__plate cine-swan__sealed" src={poster} alt="" />
        <video
          ref={videoRef}
          className="cine-swan__plate cine-swan__video"
          src={videoSrc}
          muted
          playsInline
          webkit-playsinline="true"
          preload="auto"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="cine-swan__plate cine-swan__card" src={revealed} alt="" />
      </div>

      <div className="cine-swan__bloom" aria-hidden="true" />
      <div className="cine-swan__vignette" aria-hidden="true" />

      <button
        type="button"
        className="cine-open__tap"
        onClick={open}
        aria-label={copy.hint}
        data-testid="cine-opening-tap"
      />

      <div className="cine-swan__ui">
        <p className="cine-swan__kicker">{copy.kicker}</p>
        <p className="cine-swan__names">{names}</p>
        <p className="cine-swan__hint">
          <span className="cine-swan__hintrule" aria-hidden="true" />
          <span data-testid="cine-opening-hint">{hintLabel}</span>
          <span className="cine-swan__hintrule" aria-hidden="true" />
        </p>
      </div>

      <div className="cine-fx" ref={fxRef} aria-hidden="true" />
    </div>
  );
}
