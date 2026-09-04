'use client';

/* `React` is imported and it is NOT unused. Next compiles JSX with the automatic
   runtime, but vitest compiles it with the CLASSIC one, so every element in this
   file becomes React.createElement at test time. */
import React, { useState, useEffect, useRef } from 'react';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE COUNTDOWN, USED EVERYWHERE.
 *
 * There are three clocks in this product now — how long until an event starts,
 * how long until a guest's table is revealed, and how long before a finished
 * event's data is deleted — and the third is the one that made a shared
 * implementation worth writing: it counts down to an irreversible deletion, so
 * being a few minutes wrong is not a cosmetic problem.
 *
 * Three decisions here are load-bearing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * ── 1. IT RE-DERIVES FROM THE CLOCK, IT DOES NOT DECREMENT ──
 *
 * The obvious implementation keeps a number and subtracts 1000 each tick. It
 * drifts immediately and badly:
 *
 *   • setInterval is throttled to once a minute (or stopped entirely) in a
 *     background tab, so a decrementing counter loses a second per skipped tick
 *     and reads minutes fast after an hour in another tab.
 *   • A laptop that sleeps for six hours resumes with a counter six hours stale.
 *   • setInterval's own timing is approximate, so even a foreground tab drifts.
 *
 * Recomputing `target - Date.now()` on every tick makes all three impossible:
 * the interval decides only how often we REPAINT, never what the answer is. A
 * missed tick costs one frame of freshness, not one second of accuracy.
 *
 * ── 2. IT RETURNS null ON THE FIRST RENDER ──
 *
 * Next renders this on the server, where `Date.now()` is the server's clock and
 * some milliseconds before the browser's. Computing during the first render
 * therefore produces server HTML that disagrees with the first client render,
 * and React reports a hydration mismatch — on a value that is guaranteed to
 * differ every single time, because it is a clock.
 *
 * So the first paint is deliberately empty and the value appears in an effect,
 * which only ever runs on the client. Callers render a placeholder for null.
 *
 * ── 3. IT STOPS AT ZERO ──
 *
 * `expired` is reported and the interval is cleared. Without that the component
 * repaints forever and, worse, a naive caller renders "-00:00:03" — a negative
 * countdown on a deletion notice reads as a bug in the product at the exact
 * moment the user most needs to trust it.
 *
 * @param {string|number|Date|null} target  when the countdown reaches zero
 * @param {object} [opts]
 * @param {number} [opts.intervalMs=1000]   repaint cadence
 * @returns {null | {days:number, hours:number, minutes:number, seconds:number,
 *                   totalMs:number, totalSeconds:number, expired:boolean}}
 */
export function useCountdown(target, { intervalMs = 1000 } = {}) {
  const [value, setValue] = useState(null);

  // Kept in a ref so the effect below does not have to list it as a dependency
  // and tear the interval down on every parent re-render.
  const targetMs = target == null ? null : new Date(target).getTime();
  const validTarget = Number.isFinite(targetMs) ? targetMs : null;

  useEffect(() => {
    if (validTarget === null) {
      setValue(null);
      return undefined;
    }

    let timer = null;
    const tick = () => {
      const next = breakdown(validTarget - Date.now());
      setValue(next);
      // Nothing left to count. Clearing here rather than checking inside the
      // interval means an expired countdown costs zero work for the rest of the
      // page's life.
      if (next.expired && timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    tick();
    timer = setInterval(tick, Math.max(200, intervalMs));
    return () => { if (timer) clearInterval(timer); };
  }, [validTarget, intervalMs]);

  return value;
}

/**
 * Split a duration into whole units.
 *
 * Clamped at zero rather than allowed to go negative — see decision 3 above.
 *
 * NOT exported. It was, "for the formatter and for tests", and neither was
 * true: `formatHMS` below takes the countdown object rather than raw
 * milliseconds, and nothing imports this. An export nothing consumes is an API
 * surface that has to keep working for no one.
 */
function breakdown(ms) {
  const totalMs = Math.max(0, Number(ms) || 0);
  const totalSeconds = Math.floor(totalMs / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    totalMs,
    totalSeconds,
    expired: totalMs <= 0,
  };
}

/**
 * HH:MM:SS, zero-padded, hours NOT wrapped at 24.
 *
 * A 36-hour window renders "36:00:00", never "12:00:00". A clock that silently
 * wraps is the worst failure this display can have, because "12:00:00" is a
 * completely plausible reading of a deadline that is a day and a half away.
 *
 * Mirrors `formatHMS` in backend/utils/emailTemplates.js deliberately: the
 * figure in the warning email and the figure in the dashboard banner are the
 * same quantity, and they must not disagree about how it is written.
 */
export function formatHMS(countdown) {
  if (!countdown) return null;
  const hours = countdown.days * 24 + countdown.hours;
  return [hours, countdown.minutes, countdown.seconds]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

const TABULAR = {
  // Without this the digits are proportionally spaced and the whole clock
  // shifts left and right every second as a 1 replaces an 8. On a countdown
  // that is the difference between "urgent" and "broken".
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: '"tnum" 1',
};

/**
 * The clock itself.
 *
 * Presentational and deliberately unopinionated about colour, because it is used
 * on a red deletion banner and on a neutral "starts in" chip.
 *
 * `aria-live="off"` and a text label are not an oversight: a live region that
 * announces a new value every second makes a screen reader unusable. The
 * accessible name states the remaining time once, and `suppressHydrationWarning`
 * covers the null-to-value transition described above.
 */
export default function CountdownClock({
  target,
  size = 28,
  color = 'inherit',
  label = null,
  showDays = false,
  style = {},
  onExpire = null,
}) {
  const countdown = useCountdown(target);
  const fired = useRef(false);

  useEffect(() => {
    if (countdown?.expired && !fired.current && onExpire) {
      // Guarded so a component that keeps rendering after zero does not call
      // back on every repaint.
      fired.current = true;
      onExpire();
    }
  }, [countdown?.expired, onExpire]);

  const text = countdown
    ? (showDays && countdown.days > 0
      ? `${countdown.days}d ${String(countdown.hours).padStart(2, '0')}:${String(countdown.minutes).padStart(2, '0')}:${String(countdown.seconds).padStart(2, '0')}`
      : formatHMS(countdown))
    // The first-paint placeholder. Same shape and width as a real value, so the
    // layout does not jump when the real one arrives a frame later.
    : '--:--:--';

  return (
    <span
      suppressHydrationWarning
      aria-live="off"
      aria-label={label ? `${label}: ${text}` : text}
      style={{
        fontFamily: "'Courier New', Courier, monospace",
        fontSize: `${size}px`,
        fontWeight: 700,
        letterSpacing: '0.06em',
        color,
        ...TABULAR,
        ...style,
      }}
    >
      {text}
    </span>
  );
}
