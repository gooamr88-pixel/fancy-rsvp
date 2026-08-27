'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../utils/apiClient';
import { instantToWallClock } from '../../utils/timezone';
import { useIsClient } from '../../utils/useIsClient';
import { usePublicPricing } from '../../utils/usePublicPricing';
import PlanLock from '../components/PlanLock';
import {
  VIZ, Card, Hero, Stat, Meter, BarList, StackedBar, LinePanel, Empty, StatusNote,
  compact, duration,
} from './viz';

/**
 * The registry label for `analytics_advanced`, verbatim.
 *
 * The public pricing endpoint renders a tier's contents by LABEL, not by key —
 * keys never reach the browser — so this is how a plan is recognised as
 * carrying the deep charts.
 */
const ADVANCED_ANALYTICS_LABEL = 'Real-time analytics & reports';

/* ═══════════════════════════════════════════════════════════════════════════
   ORGANIZER ANALYTICS

   GET /events/:id/analytics has existed for a long time and, until now, had
   no consumer anywhere in the app — every number it computes was being
   thrown away. This is that surface.

   Reading order is deliberate and goes outside-in, because that is the order
   an organizer actually asks the questions in:

     1. how many people are coming            (hero — the one number)
     2. how many showed up to look            (KPI row)
     3. did they get past the envelope        (reveal funnel)
     4. where did they fall out of the form   (RSVP funnel)
     5. what did they answer                  (response mix)
     6. when did it all happen                (timeline)
     7. what else did they do                 (engagement, reasons, sources)

   Charts do not own filters — one control row at the top scopes everything
   below it, so every card is always showing the same slice.
   ═══════════════════════════════════════════════════════════════════════════ */

const C = {
  gold: '#B8944F', charcoal: '#191B1E', ivory: '#F8F4EC', stone: '#77736A',
  border: '#E8E2D6', white: '#FFFFFF', softBg: '#FAFAF8',
};
const SANS = 'var(--font-sans)';

const RANGES = [
  { key: 'all', label: 'All time', days: null },
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
];

const ENGAGEMENT_LABELS = {
  calendar_added: 'Added to calendar',
  share_clicked: 'Shared the invitation',
  directions_clicked: 'Asked for directions',
  guest_pass_downloaded: 'Downloaded their pass',
  gallery_viewed: 'Opened the gallery',
  music_played: 'Played the music',
  seating_searched: 'Looked up their seat',
};

export default function AnalyticsPage() {
  const isClient = useIsClient();

  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState(null);
  const [range, setRange] = useState('all');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  /* ─── Event list. The dashboard's own convention: the active event is
     remembered in localStorage, so landing here follows whatever the
     organizer was last working on rather than defaulting to the newest. ─── */
  useEffect(() => {
    if (!isClient) return;
    (async () => {
      try {
        const res = await apiFetch('/events');
        const list = res?.events || res?.data || [];
        setEvents(list);
        const stored = localStorage.getItem('active_event_id');
        const initial = list.find((e) => e.id === stored)?.id || list[0]?.id || null;
        setEventId(initial);
        if (!initial) setLoading(false);
      } catch (err) {
        setError(err.message || 'Could not load your events.');
        setLoading(false);
      }
    })();
  }, [isClient]);

  /* A monotonically increasing token, not a boolean: switching events twice
     in quick succession leaves two requests in flight, and without this the
     slower one can land last and paint the wrong event's numbers under the
     right event's name. Only the newest request is allowed to commit. */
  const requestRef = useRef(0);
  const loadedOnceRef = useRef(false);

  const load = useCallback(async (id, rangeKey) => {
    if (!id) return;
    const token = ++requestRef.current;
    // Refetches hold the previous render at reduced opacity rather than
    // dropping to a skeleton — a dashboard that blanks on every filter change
    // loses the reader's place and jumps the layout.
    if (loadedOnceRef.current) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const days = RANGES.find((r) => r.key === rangeKey)?.days;
      const qs = new URLSearchParams();
      if (days) {
        /* Both edges are calendar dates ON THE EVENT'S CLOCK, and the server
           reads them back the same way.

           `toISOString().slice(0, 10)` was here and gave the UTC date. For an
           event seven hours behind UTC that is already tomorrow's date from
           late afternoon onward, so the window opened at 5pm on the afternoon
           BEFORE the day it named — and disagreed with the day buckets the
           chart drew underneath it, which the server groups in the event's
           zone. Two different definitions of "a day" on one screen. */
        const zone = events.find((e) => e.id === id)?.timezone;

        /* `days - 1`, and the minus one is the whole point.
           Both edges are INCLUSIVE — the server opens at 00:00 on `from` and
           closes at 23:59 on `to` — so counting back a full 7 days from today
           and then including today as well produced EIGHT days of bars under a
           control labelled "Last 7 days". Today counts as one of the seven. */
        const startOfWindow = Date.now() - (days - 1) * 86400000;
        qs.set('from', instantToWallClock(startOfWindow, zone).slice(0, 10));
        qs.set('to', instantToWallClock(Date.now(), zone).slice(0, 10));
      }
      const q = qs.toString();
      const res = await apiFetch(`/events/${id}/analytics${q ? `?${q}` : ''}`);
      if (token !== requestRef.current) return;
      setData(res?.analytics || null);
      loadedOnceRef.current = true;
    } catch (err) {
      if (token !== requestRef.current) return;
      setError(err.message || 'Could not load analytics for this event.');
    } finally {
      if (token === requestRef.current) { setLoading(false); setRefreshing(false); }
    }
    /* `events` is a real dependency now that the window is built from the
       selected event's zone. With the empty array this had before, the lookup
       above would close over the INITIAL empty list forever, always find
       nothing, and silently fall back to the platform timezone — the failure
       mode being fixed here, reintroduced one line lower.

       It costs no extra request: `setEvents` and `setEventId` land in the same
       batch, and the effect below returns early until `eventId` exists, so the
       first render where this identity changes is also the first one that
       fetches at all. */
  }, [events]);

  // The whole body is inside an async IIFE so no state is set during the
  // effect's own synchronous run.
  useEffect(() => {
    if (!eventId) return;
    (async () => { await load(eventId, range); })();
  }, [eventId, range, load]);

  const onPickEvent = (id) => {
    setEventId(id);
    try { localStorage.setItem('active_event_id', id); } catch { /* private mode */ }
  };

  const activeEvent = events.find((e) => e.id === eventId);

  return (
    <div style={{ minHeight: '100dvh', background: C.softBg, fontFamily: SANS }}>
      {/* This pinned --fx-pad-x inline at 22px, with a comment claiming it would
          "still taper on a phone". It would not: a fixed px is a constant, and
          pinning it actually DISABLES the fluid clamp on :root that does the
          tapering. Using the preset gets the real thing — 24px, dropping to 16px
          below lg, matching every other organizer screen. */}
      <div
        className="fx-container fx-container--3xl fx-gutter fx-gutter--sm"
        style={{ paddingTop: 28, paddingBottom: 72 }}
      >

        <nav style={{ marginBottom: 18 }}>
          <Link href="/dashboard" style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, textDecoration: 'none',
            color: C.stone, fontSize: 12.5, fontWeight: 600,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
            Dashboard
          </Link>
        </nav>

        <header style={{ marginBottom: 22 }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: C.charcoal, letterSpacing: '-.01em' }}>Analytics</h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: C.stone }}>
            How guests are responding to {activeEvent ? <strong style={{ color: C.charcoal, fontWeight: 600 }}>{activeEvent.title}</strong> : 'your event'}.
          </p>
        </header>

        {/* ─── One filter row, scoping everything below it ─── */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
          padding: '12px 14px', background: C.white, border: `1px solid ${C.border}`,
          borderRadius: 12, marginBottom: 20,
        }}>
          <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: VIZ.inkMuted }}>Event</span>
            <select
              value={eventId || ''}
              onChange={(e) => onPickEvent(e.target.value)}
              style={{
                border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 10px', minHeight: 36,
                fontFamily: SANS, fontSize: 12.5, color: C.charcoal, background: C.white, maxWidth: 320,
              }}
            >
              {events.length === 0 && <option value="">No events yet</option>}
              {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
          </label>

          <div role="group" aria-label="Date range" style={{ display: 'flex', gap: 4, marginInlineStart: 'auto', flexWrap: 'wrap' }}>
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                aria-pressed={range === r.key}
                style={{
                  border: `1px solid ${range === r.key ? C.gold : C.border}`,
                  background: range === r.key ? 'rgba(184,148,79,.10)' : 'transparent',
                  color: range === r.key ? '#7D560F' : VIZ.inkSecondary,
                  borderRadius: 999, padding: '6px 13px', minHeight: 34,
                  fontFamily: SANS, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >{r.label}</button>
            ))}
          </div>
        </div>

        {error && (
          <div style={{
            padding: '14px 16px', background: 'rgba(196,94,94,.07)', border: '1px solid rgba(196,94,94,.3)',
            borderRadius: 12, color: '#8E3A3A', fontSize: 13, marginBottom: 20,
          }}>
            {error}
            <button type="button" onClick={() => load(eventId, range)} style={{
              marginInlineStart: 12, border: 'none', background: 'transparent', color: '#8E3A3A',
              fontWeight: 700, fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline',
            }}>Try again</button>
          </div>
        )}

        {loading && !data ? (
          <LoadingState />
        ) : !data ? (
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: '48px 24px', textAlign: 'center' }}>
            <Empty text={events.length ? 'No analytics for this event yet.' : 'Create an event to start collecting analytics.'} />
          </div>
        ) : (
          <div style={{ opacity: refreshing ? 0.55 : 1, transition: 'opacity .2s ease' }}>
            <Dashboard data={data} />
          </div>
        )}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {[140, 220, 220].map((h, i) => (
        <div key={i} style={{ height: h, background: C.white, border: `1px solid ${C.border}`, borderRadius: 14 }} />
      ))}
    </div>
  );
}

/* ═══ The composed view ═══ */
function Dashboard({ data }) {
  const {
    overview = {}, funnel = [], reveal = {}, engagementActions = {}, declineReasons = {},
    sources = {}, timeline = [], rangeApplied = false,
    /**
     * Does this plan carry the deep charts?
     *
     * Defaults TRUE on purpose. The flag arrives from the server, and a response
     * that predates it — a cached page, a backend mid-deploy — must not draw a
     * padlock over analytics a customer is paying for. Same rule DashboardNav
     * applies to the SMS badge: never badge a working feature as locked because
     * of version skew. The API is the enforcement; this is presentation.
     */
    advanced = true,
  } = data;

  /* Who is coming is a CURRENT fact, not a windowed one — the backend
     deliberately does not filter RSVP state by the date range (see the
     comment on queries 2-4 there). Saying so on the tiles is the difference
     between a number the organizer trusts and one they quietly distrust
     because it did not move when they changed the range. */
  const stateNote = rangeApplied ? 'all time' : null;

  const responseMix = [
    { label: VIZ.status.yes.label, value: overview.attendingCount || 0, color: VIZ.status.yes.color },
    { label: VIZ.status.maybe.label, value: overview.maybeCount || 0, color: VIZ.status.maybe.color },
    { label: VIZ.status.no.label, value: overview.declinedCount || 0, color: VIZ.status.no.color },
    { label: VIZ.status.pending.label, value: overview.pendingCount || 0, color: VIZ.status.pending.color },
  ];

  const engagementItems = Object.entries(engagementActions)
    .map(([k, v]) => ({ label: ENGAGEMENT_LABELS[k] || k, value: v }))
    .filter((i) => i.value > 0)
    .sort((a, b) => b.value - a.value);

  // The API returns these two as { key: count } maps, not arrays.
  const declineItems = Object.entries(declineReasons || {})
    .map(([reason, count]) => ({ label: prettyLabel(reason), value: count }))
    .filter((i) => i.value > 0)
    .sort((a, b) => b.value - a.value);

  const sourceItems = Object.entries(sources || {})
    .map(([source, count]) => ({ label: prettyLabel(source), value: count }))
    .filter((i) => i.value > 0)
    .sort((a, b) => b.value - a.value);

  const days = timeline.map((t) => ({ ...t, label: formatDay(t.date) }));

  return (
    <div style={{ display: 'grid', gap: 16 }}>

      {/* ─── 1 + 2: the headline ─── */}
      {/* Was `gridTemplateColumns: 'minmax(180px, 260px) 1fr'` with no media
          query anywhere in this file. minmax()'s min is a HARD floor, so at
          a 320px viewport this asked for 180 + 22 gap + the nested grid's
          own 140px floor = 342px inside 268px of available width, and the
          four headline stat tiles were pushed off-screen — then clipped,
          not scrolled, by the overflow guard. .fx-grid caps every track
          floor at 100% of the container, so it cannot overflow at any
          width; --fx-col 260px reproduces the intended desktop split. */}
      <section
        className="fx-grid"
        style={{
          background: VIZ.surface, border: `1px solid ${C.border}`, borderRadius: 14,
          padding: '22px 24px', '--fx-col': '260px', '--fx-gap': '22px',
          alignItems: 'center',
        }}
      >
        <Hero
          label="Confirmed guests"
          value={compact(overview.totalHeadcount || 0)}
          sub={`${compact(overview.attendingCount || 0)} parties attending${stateNote ? ` · ${stateNote}` : ''}`}
        />
        {/* minmax(140px, …) was the second half of the overflow above — the
            140px floor survives auto-fit. --fx-col 140px keeps the same
            desktop behaviour with the floor capped at the container. */}
        <div className="fx-grid" style={{ '--fx-col': '140px', '--fx-gap': '10px' }}>
          <Stat label="Invitation views" value={compact(overview.totalPageViews || 0)} />
          <Stat label="Unique visitors" value={compact(overview.uniqueVisitors || 0)} />
          <Stat label="Responses" value={compact(overview.totalRsvps || 0)} sub={`${overview.pendingCount || 0} still to reply${stateNote ? ` · ${stateNote}` : ''}`} />
          {/* Hidden while a range is applied — its two halves would come from
              different windows. The backend sends null rather than a figure. */}
          {overview.conversionRate != null && (
            <Stat label="Reply rate" value={`${overview.conversionRate}%`} sub="of everyone who looked" />
          )}
        </div>
      </section>

      {/* ─── 3 onwards: the paid half ───
          The headline above is `analytics_basic`, which every plan carries.
          Everything below is `analytics_advanced`, and the server omits those
          blocks entirely when the plan does not include them — so this cannot
          render them as empty charts and call it a degraded view. It shows what
          is missing and which plans carry it instead. */}
      {!advanced ? (
        <AdvancedLocked />
      ) : (
        <>
          {/* ─── 3: the envelope ─── */}
          <Card
            title="The envelope"
            hint="Every guest meets the sealed invitation before the page itself. This is how many got past it — and how long they hesitated before tapping the wax."
            table={{
              columns: ['Stage', 'Guests'],
              rows: [
                ['Envelope shown', compact(reveal.shown || 0)],
                ['Seal tapped', compact(reveal.opened || 0)],
                ['Skipped', compact(reveal.skipped || 0)],
                ['Artwork failed to load', compact(reveal.failed || 0)],
                ['Median time to tap', duration(reveal.medianMsToOpen)],
              ],
            }}
          >
            {reveal.shown ? (
              <>
                <div className="fx-grid" style={{ '--fx-col': '210px', '--fx-gap': '20px', alignItems: 'start' }}>
                  <Meter
                    label="Opened the seal"
                    value={reveal.openRate || 0}
                    caption={`${compact(reveal.opened || 0)} of ${compact(reveal.shown)} guests who saw it`}
                  />
                  <Stat label="Median time to tap" value={duration(reveal.medianMsToOpen)} sub="from the moment it appeared" />
                  <Stat label="Skipped it" value={compact(reveal.skipped || 0)} sub={reveal.shown ? `${Math.round(((reveal.skipped || 0) / reveal.shown) * 100)}% of viewers` : null} />
                </div>
                {reveal.failed > 0 && (
                  <StatusNote tone="critical">
                    <strong>{compact(reveal.failed)}</strong> {reveal.failed === 1 ? 'guest' : 'guests'} never saw the envelope — its artwork
                    failed to load and they were shown the plain invitation card instead. This is a fault, not a preference: any number here
                    above zero is worth investigating.
                  </StatusNote>
                )}
              </>
            ) : (
              <Empty text="No guest has reached the envelope in this range yet." />
            )}
          </Card>

          {/* ─── 4: where they fall out ─── */}
          <Card
            title="RSVP funnel"
            hint="Each step is the number of guests who reached it. The drop beside a step is how many were lost getting there from the one above."
            table={{
              columns: ['Step', 'Guests', 'Drop-off'],
              rows: funnel.map((s) => [s.step, compact(s.count), s.dropOff != null ? `${s.dropOff}%` : '—']),
            }}
          >
            {funnel.some((s) => s.count > 0) ? (
              <BarList
                ramp={VIZ.ordinal}
                items={funnel.map((s) => ({
                  label: s.step,
                  value: s.count,
                  note: s.dropOff ? `−${s.dropOff}%` : null,
                }))}
              />
            ) : <Empty text="No form activity in this range yet." />}
          </Card>

          {/* ─── 5: what they answered ─── */}
          <Card
            title="Response mix"
            hint={stateNote ? 'Where every guest stands right now — this one is not affected by the date range above.' : null}
            table={{
              columns: ['Response', 'Parties'],
              rows: responseMix.map((s) => [s.label, compact(s.value)]),
            }}
          >
            <StackedBar segments={responseMix} />
          </Card>

          {/* ─── 6: when ─── */}
          <Card
            title="Activity over time"
            hint="Three separate panels, each on its own scale — views outnumber responses by an order of magnitude, and stacking them on one axis would flatten the line that matters most."
            table={{
              columns: ['Day', 'Views', 'Responses', 'Interactions'],
              rows: days.map((d) => [d.label, compact(d.views), compact(d.rsvps), compact(d.engagements)]),
            }}
          >
            {days.length ? (
              <div style={{ display: 'grid', gap: 18 }}>
                <LinePanel title="Invitation views" points={days.map((d) => ({ label: d.label, value: d.views }))} />
                <LinePanel title="Responses" points={days.map((d) => ({ label: d.label, value: d.rsvps }))} />
                <LinePanel title="Other interactions" points={days.map((d) => ({ label: d.label, value: d.engagements }))} />
                <div style={{
                  display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', paddingTop: 2,
                  fontSize: 'var(--fx-micro)', color: VIZ.inkMuted, fontVariantNumeric: 'tabular-nums',
                }}>
                  <span>{days[0].label}</span>
                  {days.length > 2 && <span>{days[Math.floor(days.length / 2)].label}</span>}
                  <span>{days[days.length - 1].label}</span>
                </div>
              </div>
            ) : <Empty text="No activity in this range yet." />}
          </Card>

          {/* ─── 7: the rest ─── */}
          {/* minmax(320px, …) plus Card's own 44px of horizontal padding needed
              364px against the 316px available at 360px — the three cards
              clipped on the right. */}
          <div className="fx-grid" style={{ '--fx-col': '320px', '--fx-gap': '16px' }}>
            <Card
              title="What guests did"
              table={{ columns: ['Action', 'Times'], rows: engagementItems.map((i) => [i.label, compact(i.value)]) }}
            >
              <BarList items={engagementItems} emptyText="No extra interactions recorded yet." />
            </Card>

            <Card
              title="Why guests declined"
              table={{ columns: ['Reason', 'Parties'], rows: declineItems.map((i) => [i.label, compact(i.value)]) }}
            >
              <BarList items={declineItems} emptyText="No declines with a reason given." />
            </Card>

            <Card
              title="How they replied"
              table={{ columns: ['Channel', 'Responses'], rows: sourceItems.map((i) => [i.label, compact(i.value)]) }}
            >
              <BarList items={sourceItems} emptyText="No responses yet." />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * What an organizer sees where the deep charts would be.
 *
 * Not a greyed-out copy of the panels: the server does not send those numbers
 * at all, so there is nothing to grey out, and a dimmed chart of zeroes reads as
 * a product fault rather than a plan boundary. PlanLock names the capability and
 * which plans carry it — read from the live pricing config, never hardcoded,
 * because an admin can move the feature between tiers in one click and a
 * sentence written here would go on claiming the old arrangement.
 */
function AdvancedLocked() {
  const router = useRouter();
  const { tiers } = usePublicPricing();
  const includedIn = (tiers || [])
    .filter((t) => (t.features || []).includes(ADVANCED_ANALYTICS_LABEL))
    .map((t) => t.name);

  return (
    <PlanLock
      title="The deeper numbers are part of a higher plan"
      description="Where guests fell out of the RSVP form, how they found their invitation, how long they hesitated at the envelope, and the day-by-day timeline of it all."
      plans={includedIn}
      upgradeLabel="See plans"
      onUpgrade={() => router.push('/pricing')}
    />
  );
}

function prettyLabel(s) {
  if (!s) return 'Unknown';
  return String(s).replace(/_/g, ' ').replace(/^\w/, (m) => m.toUpperCase());
}

function formatDay(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
