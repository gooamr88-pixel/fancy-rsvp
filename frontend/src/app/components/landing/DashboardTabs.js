'use client';

import React, { useCallback, useRef, useState } from 'react';

/**
 * THE ORGANIZER'S SCREENS, AS A TAB STRIP.
 *
 * ── Why this is a client component and its parent is not ──────────────────
 *
 * DashboardShowcaseSection stays a Server Component: it owns the heading, the
 * browser chrome and every rule of CSS on this band. Only the strip needs a
 * browser, so only the strip is shipped to one. A Server Component may import
 * a client COMPONENT (this default export); what it must never import is a
 * client module's VALUE — that lands as a client reference and kills the
 * production build. See faqContent.js.
 *
 * ── And why there is no CSS in here ───────────────────────────────────────
 *
 * Every `dash-` rule lives in the parent's one plain <style> element. A
 * <style jsx> block in a nested component does not reliably compile in this
 * build, and a scoped rule would never attach to anything this file renders
 * through a next/link.
 *
 * ── What it does before hydration ─────────────────────────────────────────
 *
 * Renders tab one, complete: the panel is real markup, not a placeholder, so
 * a visitor whose JavaScript has not arrived yet sees the dashboard rather
 * than an empty frame. Every image is in the DOM with its dimensions declared
 * and `hidden` on the three that are not showing, so switching tabs never
 * moves the page and never starts a download mid-interaction.
 *
 * Roving focus, not four tab stops: `role="tablist"` promises the arrow keys
 * work, and a strip that takes four presses of Tab to get past is the reason
 * people stop using the keyboard.
 */
export default function DashboardTabs({ shots }) {
  const [active, setActive] = useState(0);
  const stripRef = useRef(null);

  const focusTab = useCallback((i) => {
    const strip = stripRef.current;
    if (!strip) return;
    const buttons = strip.querySelectorAll('[role="tab"]');
    buttons[i]?.focus();
  }, []);

  const onKeyDown = useCallback((e) => {
    const last = shots.length - 1;
    let next = null;
    if (e.key === 'ArrowRight') next = active === last ? 0 : active + 1;
    else if (e.key === 'ArrowLeft') next = active === 0 ? last : active - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    focusTab(next);
  }, [active, focusTab, shots.length]);

  return (
    <div className="dash-tabs">
      {/* The strip scrolls rather than wraps. Four labels at 0.16em tracking
          do not fit 280px, and a tab strip that has become two rows has
          stopped looking like one control. */}
      <div className="dash-tabs__strip fx-scroll-x" ref={stripRef}>
        <div role="tablist" aria-label="What the organizer sees" onKeyDown={onKeyDown}>
          {shots.map((s, i) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              id={`dash-tab-${s.key}`}
              aria-selected={i === active}
              aria-controls={`dash-panel-${s.key}`}
              tabIndex={i === active ? 0 : -1}
              className={i === active ? 'dash-tab dash-tab--on' : 'dash-tab'}
              onClick={() => setActive(i)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="dash-win">
        <div className="dash-win__bar" aria-hidden="true">
          <span className="dash-win__dot" />
          <span className="dash-win__dot" />
          <span className="dash-win__dot" />
          <span className="dash-win__url">fancyrsvp.com/dashboard</span>
        </div>

        {shots.map((s, i) => (
          <div
            key={s.key}
            role="tabpanel"
            id={`dash-panel-${s.key}`}
            aria-labelledby={`dash-tab-${s.key}`}
            hidden={i !== active}
          >
            {/* THE THREE HIDDEN ONES ARE NOT LAZY, and that is deliberate.
                A `lazy` image inside a `hidden` panel never intersects the
                viewport, so it does not begin downloading until the moment the
                tab is clicked — and the visitor then watches an empty window
                for as long as the fetch takes. They are ~27KB each and the
                whole band is below the fold, so they are fetched eagerly at
                LOW priority instead: the browser takes them when it has
                nothing better to do, and the strip is instant once it does.
                The layout cannot shift either way, because every panel
                declares the same width and height. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={s.src}
              alt={s.alt}
              width={s.w}
              height={s.h}
              loading="eager"
              fetchPriority={i === 0 ? 'auto' : 'low'}
              decoding="async"
            />
          </div>
        ))}
      </div>

      <p className="dash-tabs__note">{shots[active].note}</p>
    </div>
  );
}
