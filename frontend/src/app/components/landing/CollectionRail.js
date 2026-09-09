'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

/**
 * THE INVITATIONS, SIDE BY SIDE AND SWIPED.
 *
 * ── What this replaced, and why ───────────────────────────────────────────
 *
 * Four capped plates in an .fx-grid. On a desktop row it read well. On a phone
 * the grid collapses to one column and the band became four full-height
 * handsets stacked — about 2,400px of scrolling to see four pictures, which is
 * the same mistake, in the same band, that the 2026-08-21 cap was written to
 * fix. The cap made each plate smaller; it could not make four of them one
 * screen.
 *
 * A rail is one screen at every width, and it says by moving that there is
 * more than what is in view.
 *
 * ── The dots are the mockup's, and they are not decoration ────────────────
 *
 * A rail with no indicator does not tell you how much more there is, or where
 * you are in it. The dots do both, and they are the reason the ARROWS could be
 * put away on a phone: two controls for one gesture is the kind of doubling
 * that made the first pass at this page feel busy. Arrows appear from 768 up,
 * where there is a mouse and no swipe.
 *
 * They are derived from scrollLeft rather than from a click handler, so they
 * stay correct when the rail is swiped, trackpad-scrolled or nudged — a dot
 * that only moves when you press a dot is a lie the first time somebody
 * swipes.
 *
 * ── Why this is a client component and its parent is not ──────────────────
 *
 * TemplatesShowcaseSection stays an async Server Component so the studio's
 * WhatsApp number and the pull quote are still fetched on the server. Only the
 * moving parts need a browser. A Server Component may import a client
 * COMPONENT (this default export); what it must never import is a client
 * module's VALUE — that lands as a client reference and kills the production
 * build. See faqContent.js.
 *
 * ── And why there is no CSS in here ───────────────────────────────────────
 *
 * Every `tss-` rule lives in the parent's one plain <style> element. A
 * <style jsx> block in a nested component does not reliably compile in this
 * build, and a scoped rule would never attach to the next/link cards below.
 */

/** Touch and trackpad already scroll this. The arrows are for a mouse. */
const NUDGE = 0.85;

export default function CollectionRail({ items }) {
  const railRef = useRef(null);
  /** Which arrows can still do something. Both start false so a rail that does
   *  not overflow shows no controls at all until measurement says it does. */
  const [ends, setEnds] = useState({ prev: false, next: false });
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return undefined;

    /* Measured, not derived from items.length: whether this rail overflows and
       which card is in view depend on the viewport and on how wide the cards
       resolve to, neither of which exists until after layout. The 4px slack
       absorbs sub-pixel scroll positions, which otherwise leave "next" enabled
       forever at the far end. */
    const update = () => {
      setEnds({
        prev: el.scrollLeft > 4,
        next: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
      });
      const slide = el.firstElementChild;
      if (!slide) return;
      /* The stride is one card plus one gap, taken from the DOM rather than
         from the stylesheet — the card width changes at 768 and a hardcoded
         number here would put the dots one card out at exactly one width. */
      const stride = slide.getBoundingClientRect().width
        + parseFloat(getComputedStyle(el).columnGap || '0');
      if (stride > 0) {
        setActive(Math.min(items.length - 1, Math.round(el.scrollLeft / stride)));
      }
    };

    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [items.length]);

  const nudge = (dir) => {
    const el = railRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * NUDGE, behavior: 'smooth' });
  };

  const goTo = useCallback((i) => {
    const el = railRef.current;
    const slide = el?.children?.[i];
    if (!el || !slide) return;
    el.scrollTo({ left: slide.offsetLeft - el.offsetLeft, behavior: 'smooth' });
  }, []);

  return (
    <div className="tss-railwrap">
      {(ends.prev || ends.next) && (
        <div className="tss-arrows" aria-hidden="true">
          <button
            type="button"
            className="tss-arrow"
            onClick={() => nudge(-1)}
            disabled={!ends.prev}
            tabIndex={-1}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <button
            type="button"
            className="tss-arrow"
            onClick={() => nudge(1)}
            disabled={!ends.next}
            tabIndex={-1}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}

      <ul className="tss-rail" ref={railRef}>
        {items.map((item) => (
          <li key={item.key} className="tss-slide">
            <Link href={`/collection/${item.key}`} className="tss-card">
              <span className="tss-device">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.art}
                  alt={`The ${item.label} invitation as a guest sees it: ${item.tagline}`}
                  width={468}
                  height={1013}
                  loading="lazy"
                />
              </span>
              <span className="tss-name">{item.label}</span>
              <span className="tss-badge">{item.badge}</span>
            </Link>
          </li>
        ))}
      </ul>

      {/* Real buttons, not decorative spans: they move the rail, so they are
          controls. Labelled by the template each one leads to rather than
          "slide 2 of 4", which tells a screen-reader user nothing they can
          act on. */}
      {/* THE DOT IS THE SPAN, NOT THE BUTTON, and that is not decoration.
          globals.css gives every `button` a 44x44 minimum on a touch pointer —
          the right rule, and it turned a 7px dot into a 44px gold ring. Four
          of those under a carousel read as four more buttons. The button keeps
          the hit area it should have; the span is what you see. */}
      <div className="tss-dots">
        {items.map((item, i) => (
          <button
            key={item.key}
            type="button"
            className={i === active ? 'tss-dot tss-dot--on' : 'tss-dot'}
            aria-label={`Show ${item.label}`}
            aria-current={i === active ? 'true' : undefined}
            onClick={() => goTo(i)}
          >
            <span aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}
