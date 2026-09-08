'use client';

import React from 'react';
import { NAV_BY_KEY } from '../../dashboard/components/dashboardNavItems';
import { C, T } from '../../components/landing/landingTokens';

/* ═══════════════════════════════════════════════════════════════════════════
   THE ONE THING IN THIS DEMO THAT IS DRAWN RATHER THAN MOUNTED.

   Everything inside this shell is the organizer's real screen. The shell
   itself is not, and it cannot be: the product's own chrome is
   dashboard/layout.js + DashboardNav, a router-driven sidebar whose every
   item is a link to /dashboard?tab=… — a middleware-gated route that would
   bounce a visitor with no session straight to a login screen. Mounting it
   would produce a navigation bar where every destination is a dead end.

   So the demo draws a sidebar. What it does NOT do is invent one: the label,
   the hint and the icon path of each item are imported from
   dashboardNavItems.js, which is the same module the real sidebar reads. Fix
   a label there and this follows; the two cannot describe the same product
   differently.

   ── THE ONE ENTRY THAT IS NOT IMPORTED ───────────────────────────────────

   Analytics has no nav entry in the product at all — `resolveActiveKey`
   folds /dashboard/analytics into "overview", because an organizer reaches
   it from a card on the Dashboard rather than from the sidebar. The demo
   gives it its own place because it is one of the four things worth showing,
   and inventing a label for it here is honest in a way that inventing one
   for "Guest list" would not have been.
   ═══════════════════════════════════════════════════════════════════════════ */

const ANALYTICS_ITEM = {
  key: 'analytics',
  label: 'Analytics',
  hint: 'Who opened it, and who replied',
  icon: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
};

/** The four, in the order the questions get asked. */
export const DEMO_SCREENS = ['overview', 'guests', 'seating', 'analytics'].map(
  (key) => (key === 'analytics' ? ANALYTICS_ITEM : NAV_BY_KEY.get(key)),
);

function NavIcon({ paths }) {
  return (
    <svg
      aria-hidden="true"
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      // The icons in dashboardNavItems are raw path strings rather than
      // elements, so the module stays a data file with no JSX in it. This is
      // the same way DashboardNav renders them.
      dangerouslySetInnerHTML={{ __html: paths }}
    />
  );
}

export default function DemoDashboardShell({ active, onSelect, children }) {
  return (
    <div className="ddash">
      <aside className="ddash__side">
        <p className="ddash__eyebrow">Beit Al Qamar Events</p>
        <p className="ddash__event">Nadia &amp; Omar</p>
        <nav aria-label="Demo dashboard sections">
          <ul className="ddash__list">
            {DEMO_SCREENS.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => onSelect(item.key)}
                  aria-current={active === item.key ? 'page' : undefined}
                  className={`ddash__item${active === item.key ? ' ddash__item--on' : ''}`}
                >
                  <NavIcon paths={item.icon} />
                  <span className="ddash__text">
                    <span className="ddash__label">{item.label}</span>
                    {item.hint && <span className="ddash__hint">{item.hint}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="ddash__content">{children}</div>

      <style>{`
        .ddash {
          display: flex;
          flex-direction: column;
          min-height: 0;
          background: #FAFAF8;
        }

        /* PHONE AND TABLET: the sidebar becomes a scrolling row of tabs.
           Not a shrunk sidebar, and not the product's fixed bottom bar —
           there is already a stage rail pinned above this, and a second
           pinned bar at the other edge would leave a phone showing more
           navigation than dashboard. */
        .ddash__side {
          position: sticky;
          top: 105px;
          z-index: 20;
          background: rgba(250, 250, 248, 0.94);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border-bottom: 1px solid ${C.border};
        }
        .ddash__eyebrow, .ddash__event { display: none; }
        .ddash__list {
          display: flex;
          gap: 0;
          margin: 0;
          padding: 0 8px;
          list-style: none;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        .ddash__list::-webkit-scrollbar { display: none; }
        .ddash__item {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 11px 13px;
          min-height: 46px;
          border: none;
          border-bottom: 2px solid transparent;
          background: transparent;
          color: ${C.inkSoft};
          font-family: ${T.body};
          cursor: pointer;
          white-space: nowrap;
          transition: color 0.2s ease, border-color 0.2s ease;
        }
        .ddash__item--on { color: ${C.ink}; border-bottom-color: ${C.gold}; }
        .ddash__text { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; }
        .ddash__label { font-size: 12.5px; font-weight: 700; }
        .ddash__hint { display: none; }

        .ddash__content {
          min-width: 0;
          padding: 18px 14px 56px;
        }

        @media (min-width: 1024px) {
          .ddash { flex-direction: row; align-items: flex-start; }
          .ddash__side {
            position: sticky;
            top: 118px;
            z-index: 1;
            flex: none;
            width: 246px;
            align-self: flex-start;
            padding: 22px 14px 26px;
            background: transparent;
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
            border-bottom: none;
            border-right: 1px solid ${C.border};
          }
          .ddash__eyebrow {
            display: block;
            margin: 0 0 3px 12px;
            font-family: ${T.label};
            font-size: 9px;
            letter-spacing: 0.22em;
            text-transform: uppercase;
            color: ${C.goldInk};
          }
          .ddash__event {
            display: block;
            margin: 0 0 20px 12px;
            font-family: ${T.display};
            font-size: 21px;
            font-weight: 400;
            color: ${C.ink};
          }
          .ddash__list { flex-direction: column; padding: 0; overflow: visible; }
          .ddash__item {
            align-items: flex-start;
            padding: 11px 12px;
            border-bottom: none;
            border-radius: 10px;
            border-left: 2px solid transparent;
          }
          .ddash__item--on { background: #FFFFFF; border-left-color: ${C.gold}; box-shadow: 0 1px 2px rgba(25, 24, 21, 0.05); }
          .ddash__label { font-size: 13px; }
          .ddash__hint {
            display: block;
            margin-top: 2px;
            font-size: 11px;
            font-weight: 400;
            line-height: 1.4;
            color: ${C.inkSoft};
            white-space: normal;
          }
          .ddash__content { flex: 1 1 auto; padding: 26px 28px 80px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .ddash__item { transition: none; }
        }
      `}</style>
    </div>
  );
}
