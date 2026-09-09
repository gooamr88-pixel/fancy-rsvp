'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

/**
 * THE INVITATIONS, SIDE BY SIDE AND SWIPED.
 *
 * ── What this replaced, and why ───────────────────────────────────────────
 *
 * Four capped plates in an .fx-grid. On a desktop row it read well. On a
 * phone the grid collapses to one column and the band became four full-height
 * handsets stacked — about 2,400px of scrolling to see four pictures, which
 * is the same mistake, in the same band, that the 2026-08-21 cap was written
 * to fix. The cap made each plate smaller; it could not make four of them one
 * screen.
 *
 * A rail is one screen at every width, and it says by moving that there is
 * more than what is in view.
 *
 * ── Why this is a client component and its parent is not ──────────────────
 *
 * TemplatesShowcaseSection stays an async Server Component so the studio's
 * WhatsApp number and the pull quote are still fetched on the server. Only
 * the arrows need a browser, so only the arrows are shipped to one. A Server
 * Component may import a client COMPONENT (this default export); what it must
 * never import is a client module's VALUE — that lands as a client reference
 * and kills the production build. See faqContent.js.
 *
 * ── And why there is no CSS in here ───────────────────────────────────────
 *
 * Every `tss-` rule lives in the parent's one plain <style> element. A
 * <style jsx> block in a nested component does not reliably compile in this
 * build, and a scoped rule would never attach to the next/link cards below.
 * Same arrangement as ShopRail.js, for the same three reasons.
 */

/** Touch and trackpad already scroll this. The arrows are for a mouse. */
const NUDGE = 0.85;

export default function CollectionRail({ items }) {
  const railRef = useRef(null);
  /** Which arrows can still do something. Both start false so a rail that does
   *  not overflow shows no controls at all until measurement says it does —
   *  the honest default is "nothing to scroll". */
  const [ends, setEnds] = useState({ prev: false, next: false });

  useEffect(() => {
    const el = railRef.current;
    if (!el) return undefined;

    /* Measured, not derived from items.length: whether this rail overflows
       depends on the viewport and on how wide the cards resolve to, neither of
       which exists until after layout. The 4px slack absorbs sub-pixel scroll
       positions, which otherwise leave "next" enabled forever at the far
       end. */
    const update = () => setEnds({
      prev: el.scrollLeft > 4,
      next: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });

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

  return (
    <div className="tss-railwrap">
      {/* ABOVE the rail, not floating over it — the pattern ShopRail settled
          on. Controls laid across the strip cover the cards they sit on, which
          is tolerable at a desktop card width and not at a phone's.

          aria-hidden: the rail is a normal scrollable list and every card is a
          link in the tab order, so a screen reader already has a better way
          through this than two buttons. */}
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

              <span className="tss-namerow">
                <span className="tss-name">{item.label}</span>
                <span className="tss-badge">{item.badge}</span>
              </span>
              <span className="tss-arrival">{item.arrival}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
