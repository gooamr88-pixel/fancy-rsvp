'use client';

import React, { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import OrganizerOverview from '../../dashboard/components/OrganizerOverview';
import GuestsTab from '../../dashboard/components/GuestsTab';
import SeatingManager from '../../dashboard/components/SeatingManager';
import SeatingProgress from '../../dashboard/components/SeatingProgress';
import AnalyticsPage from '../../dashboard/analytics/page';
import ErrorBoundary from '../../components/ErrorBoundary';
import DemoDashboardShell, { DEMO_SCREENS } from '../components/DemoDashboardShell';
import { demoBlocked } from '../../utils/demoNotice';
import { isAccepted } from '../../utils/responseHelpers';
import { buildDemoEvent, DEMO_EVENT_ID, DEMO_FORM_FIELDS } from '../fixtures/demoEvent.mjs';
import { demoGuests, DEMO_TABLES, DEMO_TIER_FEATURES } from '../fixtures/demoOrganizer.mjs';
import { C, T } from '../../components/landing/landingTokens';

/* ═══════════════════════════════════════════════════════════════════════════
   STAGE 2 — WHAT THE HOST SEES.

   Four screens, and every one of them is the component the organizer's own
   dashboard renders. Nothing here is a picture of a dashboard:

     Dashboard   OrganizerOverview — the real default tab, fetching /dashboard
                 through the demo router installed by DemoChrome.
     Guest list  GuestsTab, on props.
     Seating     SeatingProgress + SeatingManager, on props.
     Analytics   the analytics route itself, mounted with `embedded` so it
                 drops the page chrome that belongs to a route and keeps every
                 chart that belongs to the product.

   ── THE SEATING ACTUALLY WORKS ───────────────────────────────────────────

   `onAssignTable` is a plain prop with no fetch behind it, so the demo can
   honour it for real: move a guest to a table and the counts, the progress
   bar and the "still to seat" filter all follow, because they are all
   derived from the same array. That is the one interaction in this stage
   that is not a lie, and it is worth more than the other three screens
   combined — a visitor who moves somebody and watches the room re-count has
   understood the product.

   Tables carry a `occupied` that is COMPUTED from the guest list rather than
   stored beside it. SeatingManager renders each option as
   `max_capacity - occupied` seats left and disables the ones at zero, so a
   stored count would drift out of agreement with the list on the first
   assignment and start refusing tables that are visibly empty.

   ── WHAT IS SWITCHED OFF, AND WHY IT SAYS SO ─────────────────────────────

   Export, delete, edit and the floor plan reach the API directly rather than
   through a prop. They are stopped with one calm line each (utils/
   demoNotice.js) rather than being hidden: a visitor who is told a feature
   is off in the demo has learnt the feature exists, and one who finds a
   button that does nothing has learnt something worse.
   ═══════════════════════════════════════════════════════════════════════════ */

const SCREEN_BLURB = {
  overview: 'Every event in the account, and what changed while you were away.',
  guests: 'Forty invitations. Who replied, what they eat, who they are bringing.',
  seating: 'Move somebody to a table and watch the room re-count. This one is live.',
  analytics: 'Who opened the invitation, where they stopped, and what they did next.',
};

export default function DemoDashboardPage() {
  const [screen, setScreen] = useState('overview');
  const [event] = useState(() => buildDemoEvent());
  const [guests, setGuests] = useState(() => demoGuests());

  // Seating list controls — owned here because SeatingManager is controlled.
  const [searchQuery, setSearchQuery] = useState('');
  const [filterResponse, setFilterResponse] = useState('unseated');

  /* Seat counts, derived. See the note above on why they are not stored. */
  const tables = useMemo(() => DEMO_TABLES.map((t) => ({
    ...t,
    occupied: guests
      .filter((g) => isAccepted(g.response) && g.tableId === t.id)
      .reduce((n, g) => n + (g.party_size || 1), 0),
  })), [guests]);

  const onAssignTable = useCallback((guestId, tableId) => {
    setGuests((prev) => prev.map((g) => (g.id === guestId ? { ...g, tableId: tableId || '' } : g)));
  }, []);

  const showUnseated = useCallback(() => {
    setScreen('seating');
    setSearchQuery('');
    setFilterResponse('unseated');
  }, []);

  const active = DEMO_SCREENS.find((s) => s.key === screen) || DEMO_SCREENS[0];

  return (
    <DemoDashboardShell active={screen} onSelect={setScreen}>
      <header className="dscreen__head">
        <h1 className="dscreen__title">{active.label}</h1>
        <p className="dscreen__blurb">{SCREEN_BLURB[screen]}</p>
      </header>

      {/* Each screen behind its own boundary. A dashboard panel that throws on
          a marketing page must not take the whole demo with it — and if one
          ever does, the visitor should see one broken card, not a blank
          screen where a product used to be. */}
      {screen === 'overview' && (
        <ErrorBoundary>
          <OrganizerOverview onNavigateToReferrals={() => demoBlocked('The referral programme')} />
        </ErrorBoundary>
      )}

      {screen === 'guests' && (
        <ErrorBoundary>
          <GuestsTab
            rsvps={guests}
            tables={tables}
            customFields={DEMO_FORM_FIELDS}
            eventId={DEMO_EVENT_ID}
            event={event}
            onAssignTable={onAssignTable}
            onRefresh={() => {}}
            onOpenImport={() => demoBlocked('Importing a guest list')}
            isPaid
            /* A PLAIN ARRAY of key strings. FeatureGate does
               `Array.isArray(tierFeatures) ? tierFeatures : []`, so an object
               — or a Proxy answering true to everything — collapses to empty
               and padlocks every control it was meant to open. */
            tierFeatures={DEMO_TIER_FEATURES}
            onUpgrade={() => demoBlocked('Changing the plan')}
            demoMode
          />
        </ErrorBoundary>
      )}

      {screen === 'seating' && (
        <ErrorBoundary>
          <div className="dscreen__stack">
            <SeatingProgress
              rsvps={guests}
              tables={tables}
              eventId={DEMO_EVENT_ID}
              onShowUnseated={showUnseated}
              onOpenFloorPlan={() => demoBlocked('The drag-and-drop floor plan')}
            />
            {/* Wide, and genuinely unable to reflow — a table's min-content
                width is the sum of its columns and has no upper bound, so it
                scrolls inside its own port rather than pushing the page. */}
            <div className="fx-scroll-x">
              <SeatingManager
                rsvps={guests}
                tables={tables}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                filterResponse={filterResponse}
                setFilterResponse={setFilterResponse}
                onAssignTable={onAssignTable}
              />
            </div>
          </div>
        </ErrorBoundary>
      )}

      {screen === 'analytics' && (
        <ErrorBoundary>
          <AnalyticsPage embedded />
        </ErrorBoundary>
      )}

      <aside className="dscreen__foot">
        <p className="dscreen__footline">
          Every screen above is the one a host actually uses, on a sample
          wedding. Nothing is sent, changed or deleted.
        </p>
        <Link href="/demo/customize" className="dscreen__next">
          Now make it yours
          <span aria-hidden="true">&rarr;</span>
        </Link>
      </aside>

      <style>{`
        .dscreen__head { margin: 0 0 20px; }
        .dscreen__title {
          margin: 0;
          font-family: ${T.display};
          font-weight: 400;
          font-size: 28px;
          line-height: 1.1;
          letter-spacing: -0.01em;
          color: ${C.ink};
        }
        .dscreen__blurb {
          margin: 7px 0 0;
          max-width: 56ch;
          font-family: ${T.body};
          font-size: 13px;
          line-height: 1.65;
          color: ${C.inkSoft};
        }
        .dscreen__stack { display: flex; flex-direction: column; gap: 16px; }

        .dscreen__foot {
          margin-top: 40px;
          padding-top: 22px;
          border-top: 1px solid ${C.border};
          display: flex;
          flex-direction: column;
          gap: 14px;
          align-items: flex-start;
        }
        .dscreen__footline {
          margin: 0;
          max-width: 52ch;
          font-family: ${T.body};
          font-size: 12px;
          line-height: 1.7;
          color: ${C.inkSoft};
          opacity: 0.85;
        }
        .dscreen__next {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          min-height: 52px;
          padding: 0 26px;
          background: ${C.ink};
          color: ${C.paper};
          border: 1px solid ${C.ink};
          font-family: ${T.body};
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          white-space: nowrap;
          text-decoration: none;
          transition: background 0.3s ease, color 0.3s ease;
        }
        .dscreen__next:hover { background: transparent; color: ${C.ink}; }

        @media (min-width: 768px) {
          .dscreen__title { font-size: 34px; }
          .dscreen__blurb { font-size: 14px; }
          .dscreen__foot { flex-direction: row; align-items: center; justify-content: space-between; gap: 24px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .dscreen__next { transition: none; }
        }
      `}</style>
    </DemoDashboardShell>
  );
}
