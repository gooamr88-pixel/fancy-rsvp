'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/* ═══════════════════════════════════════════════════════════════
   The rungs that stand between a guest and a cover they cannot get past.

   A cinematic opening is a video gate in front of the entire invitation.
   Every failure mode of that video — a slow network, a browser that refuses
   autoplay, a decode that stalls halfway, a device in low-power mode, a
   404'd asset — ends with a guest tapping a still image that never responds.
   There is no error message that helps them and no way around it.

   So the video is treated as untrusted. Five independent rungs each end the
   opening on their own; the guest reaches the invitation whichever one fires:

     1. READINESS GATE   taps do nothing until the video says it can play,
                         and are armed anyway after 7s regardless.
     2. PREPARING HINT   at 900ms with nothing on screen yet, the cover says
                         so, instead of looking broken.
     3. FROZEN WATCHDOG  measured against the wall clock, not the video's:
                         under 0.15s of progress across 1.7s of real time is
                         a stalled decode, which reports no error and fires
                         no event. This is the failure the other rungs miss.
     4. NEVER STARTED    6s with no first frame ⇒ abandon the video and take
                         the caller's still-image fallback.
     5. ABSOLUTE CEILING 14s from the tap, the invitation opens. Whatever
                         else is true.

   All of it is plain DOM so it can be unit-tested against a stub element
   with no browser and no video decoder.

   ── Not every opening is a video ─────────────────────────────────────────
   Sealed Letter's cover is a CSS-stepped sprite sheet, which removes rungs
   3 and 4 outright — an image that has loaded cannot stall mid-animation and
   cannot be refused by an autoplay policy. It uses useImageReadiness (rung 1)
   and its own end-signal/backstop pair in place of watchOpeningVideo. The
   invariant is unchanged and is the only one that matters: whatever the cover
   is made of, the guest reaches the invitation.
   ═══════════════════════════════════════════════════════════════ */

export const OPENING_TIMINGS = {
  /** Arm taps even if the video never reports itself ready. */
  readyHardArmMs: 7000,
  /** Swap the hint to "preparing…" once a tap has visibly done nothing. */
  preparingHintMs: 900,
  /** No first frame by now ⇒ take the still-image path instead. */
  neverStartedMs: 6000,
  /** From the tap. Nothing gets to hold a guest longer than this. */
  absoluteCeilingMs: 14000,
  /** Real time that must elapse before a stall can be called. */
  frozenWindowMs: 1700,
  /** How much play-position history to keep. */
  frozenSampleMs: 2100,
  /** Progress below this across frozenWindowMs is a stall. */
  frozenProgressS: 0.15,
  /** Ignore the first moments, where currentTime legitimately sits near 0. */
  frozenIgnoreBeforeS: 0.2,
  /** Watchdog tick. */
  pollMs: 120,
};

/**
 * Watches a playing <video> and calls exactly one of onReveal / onFallback.
 *
 * The caller is responsible for invoking video.play() ITSELF, synchronously
 * inside the user's gesture — passing the element here and letting this
 * function start it would leave the touch context and be refused on iOS.
 *
 * @returns {{cancel: () => void}} detaches every listener and timer.
 */
export function watchOpeningVideo(video, { revealAt, onStart, onReveal, onFallback, timings = OPENING_TIMINGS }) {
  let started = false;
  let done = false;
  let fellBack = false;
  let poll = null;
  const timers = [];
  const listeners = [];

  const on = (type, fn, opts) => {
    if (!video?.addEventListener) return;
    video.addEventListener(type, fn, opts);
    listeners.push([type, fn]);
  };

  const clearAll = () => {
    if (poll) { clearInterval(poll); poll = null; }
    timers.forEach(clearTimeout);
    timers.length = 0;
    listeners.forEach(([type, fn]) => video?.removeEventListener?.(type, fn));
    listeners.length = 0;
  };

  const reveal = () => {
    if (done || fellBack) return;
    done = true;
    clearAll();
    onReveal?.();
  };

  const fallBack = () => {
    // Only before the video has produced a frame. Once something is on
    // screen, cutting to the still-image path would be a visible glitch —
    // from that point the frozen watchdog and the ceiling take over.
    if (done || started || fellBack) return;
    fellBack = true;
    clearAll();
    try { video?.pause?.(); } catch { /* already gone */ }
    onFallback?.();
  };

  const begin = () => {
    if (started || done || fellBack) return;
    started = true;
    onStart?.();

    const history = [];
    poll = setInterval(() => {
      const t = Number(video?.currentTime) || 0;
      if (revealAt && t >= revealAt) { reveal(); return; }

      const now = Date.now();
      history.push({ at: now, t });
      while (history.length && now - history[0].at > timings.frozenSampleMs) history.shift();

      const oldest = history[0];
      if (
        t > timings.frozenIgnoreBeforeS
        && oldest
        && now - oldest.at >= timings.frozenWindowMs
        && (t - oldest.t) < timings.frozenProgressS
      ) {
        reveal();
      }
    }, timings.pollMs);
  };

  on('playing', begin);
  on('timeupdate', () => { if ((Number(video?.currentTime) || 0) > 0.05) begin(); });
  on('ended', reveal);
  on('error', fallBack);

  timers.push(setTimeout(fallBack, timings.neverStartedMs));
  timers.push(setTimeout(() => { if (!fellBack) reveal(); }, timings.absoluteCeilingMs));

  return { cancel: clearAll };
}

/**
 * Rung 1. `ready` goes true when the element reports it can play, and goes
 * true anyway after readyHardArmMs.
 *
 * A cover whose tap is ignored is indistinguishable from a broken page, so
 * the gate exists to let the UI say "loading" rather than to withhold the
 * tap indefinitely — hence the unconditional arm.
 */
export function useMediaReadiness(mediaRef, { enabled = true, timings = OPENING_TIMINGS } = {}) {
  const [armed, setArmed] = useState(false);

  /* DISABLED MEANS READY, and it did not used to — this hook returned false
     forever when `enabled` was false, while useImageReadiness below (which
     documents itself as keeping this contract exactly) returned true.
     Every caller passes `enabled: !reduceMotion`, so on Velvet Ring and Swan
     Lake a guest with reduced motion turned on sat in front of a cover whose
     hint read "Loading…" permanently — under a cover that was, in fact,
     tappable the whole time, because `open()` skips the readiness check on
     that path. Derived here rather than pushed in by the effect so it is true
     on the FIRST render, with no frame of "Loading…" before it. */
  const ready = armed || !enabled;

  useEffect(() => {
    if (!enabled) return undefined;

    let settled = false;
    const arm = () => { if (!settled) { settled = true; setArmed(true); } };

    const el = mediaRef.current;
    // No element to listen to — the same unconditional arm as everything
    // below, for the same reason: a tap that does nothing is worse.
    if (!el) { arm(); return undefined; }

    // Kick the fetch immediately rather than waiting for the first tap —
    // this buys the whole time the guest spends reading the cover.
    try { el.load?.(); } catch { /* nothing to load */ }

    if ((el.readyState ?? 0) >= 3) {
      arm();
    } else {
      el.addEventListener('canplaythrough', arm);
      el.addEventListener('canplay', arm);
    }
    const hardArm = setTimeout(arm, timings.readyHardArmMs);

    return () => {
      clearTimeout(hardArm);
      el.removeEventListener?.('canplaythrough', arm);
      el.removeEventListener?.('canplay', arm);
    };
  }, [mediaRef, enabled, timings.readyHardArmMs]);

  return ready;
}

/**
 * Rung 1, for an opening whose cover is an IMAGE rather than a video.
 *
 * Sealed Letter animates a sprite sheet with CSS steps(), so most of the
 * ladder above does not apply to it: there is no decoder to stall, no autoplay
 * policy to be refused by, and no playback position to watch. What is left is
 * the one thing that CAN still fail — the sheet not having arrived — and the
 * one thing that must not happen either way: a tap that is silently ignored
 * forever.
 *
 * So this keeps `useMediaReadiness`'s contract exactly: `ready` goes true when
 * the image is decoded, and goes true ANYWAY after readyHardArmMs. A cover
 * whose tap does nothing is indistinguishable from a broken page; the gate
 * exists to let the UI say "loading", not to withhold the tap indefinitely.
 *
 * Uses a detached Image() rather than a ref, because the sprite is painted as
 * a CSS `background-image` — there is no element to listen to. The browser
 * serves both from one cache entry, so this costs no second request.
 *
 * @param {string} src
 * @param {{enabled?: boolean, timings?: object}} [options]
 */
export function useImageReadiness(src, { enabled = true, timings = OPENING_TIMINGS } = {}) {
  const [armed, setArmed] = useState(false);

  /* "Nothing to wait for" is answered from the arguments during the render
     that asks, not by an effect that flips a flag afterwards — same as
     useMediaReadiness above. It used to cost one frame of "Loading…" on a
     cover that was ready from the start. */
  const ready = armed || !enabled || !src;

  useEffect(() => {
    if (!enabled || !src) return undefined;

    let settled = false;
    const arm = () => { if (!settled) { settled = true; setArmed(true); } };

    const img = new Image();
    /* An error arms too, deliberately. A 404'd sprite means the guest is
       looking at a blank cover, and the ONLY thing worse than that is a blank
       cover whose tap is also dead — the opening's own timers still run and
       still deliver them to the invitation. */
    img.onload = arm;
    img.onerror = arm;
    img.src = src;
    // Already in cache: some browsers fire no event for a complete image.
    if (img.complete) arm();

    const hardArm = setTimeout(arm, timings.readyHardArmMs);

    return () => {
      clearTimeout(hardArm);
      img.onload = null;
      img.onerror = null;
    };
  }, [src, enabled, timings.readyHardArmMs]);

  return ready;
}

/**
 * Locks page scrolling for as long as an opening holds the screen.
 *
 * The overlay's own `touch-action: none` already swallows touch scrolling;
 * this covers the rest — a desktop wheel, a spacebar, a screen reader moving
 * the caret — none of which touch-action affects.
 */
export function useScrollLock(active) {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined;
    const { body } = document;
    const previous = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => { body.style.overflow = previous; };
  }, [active]);
}

/* Nothing writes this store from outside the opening that owns it, so there is
   no change to publish. Module-level so the identity is stable — a new
   function here on every render would make useSyncExternalStore resubscribe. */
const NO_SUBSCRIBERS = () => () => {};

const readOpeningSeen = (storageKey) => {
  if (!storageKey) return false;
  try {
    return window.sessionStorage.getItem(storageKey) === '1';
  } catch {
    return false; // private mode — replay
  }
};

/**
 * Remembers that this guest has already seen the opening, so a return visit
 * is not made to sit through it again.
 *
 * Mirrors InvitationReveal's contract exactly: a null key means "replay every
 * visit" (the default), and a key opts into per-session memory. sessionStorage
 * throws in Safari's private mode, so both sides are wrapped — failing to
 * remember must degrade to replaying, never to a crash.
 */
export function useOpeningMemory(sessionKey) {
  const storageKey = sessionKey ? `cine-opening:${sessionKey}` : null;

  /* The server snapshot is `false` — that is the whole hydration contract, and
     stating it here is why this is `useSyncExternalStore` and not a `useState`
     that an effect corrects after mount. A first client render that disagreed
     with the server would be a mismatch on the very first thing a guest sees.

     Nothing subscribes: `remember()` is called from inside the opening the
     guest is currently watching, and a notification there would be an
     invitation to re-render mid-animation for a value nothing needs again. */
  const seen = useSyncExternalStore(
    NO_SUBSCRIBERS,
    () => readOpeningSeen(storageKey),
    () => false,
  );

  const remember = useCallback(() => {
    if (!storageKey) return;
    try { window.sessionStorage.setItem(storageKey, '1'); } catch { /* private mode */ }
  }, [storageKey]);

  return [seen, remember];
}
