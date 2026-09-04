'use client';
import { toast } from '../utils/toast';

import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import { apiFetch } from '../utils/apiClient';
import { ALL_TAB_KEYS } from './components/dashboardNavItems';
import NoEventSelected from './components/NoEventSelected';
import { useIsClient } from '../utils/useIsClient';
import Icon from '../components/icons/Icon';
import { useRealtimeRSVPs } from './hooks/useRealtimeRSVPs';
import StatMetricsCard from './components/StatMetricsCard';
import LiveActivityFeed from './components/LiveActivityFeed';
import ResponsiveChartBoard from './components/ResponsiveChartBoard';
import SeatingManager from './components/SeatingManager';
import TableForm from './components/TableForm';
import SeatingProgress from './components/SeatingProgress';
import FormBuilder from './components/FormBuilder';
/* AddGuestModal is gone. Adding one guest is now "Send an invitation", and it
   is owned by RSVPsTab rather than mounted here — see the note in
   SendInvitationModal. Only the bulk import still belongs to this page, because
   it is opened from a different tab than the one that renders it. */
import ImportGuestsModal from './components/ImportGuestsModal';
import EventSettings from './components/EventSettings';
import ErrorBoundary from '../components/ErrorBoundary';
import EventsTab from './components/EventsTab';
import DraftsTab from './components/DraftsTab';
import ShareTab from './components/ShareTab';
import RSVPsTab from './components/RSVPsTab';
import GuestsTab from './components/GuestsTab';
import FeatureGate from './components/FeatureGate';
import OrganizerOverview from './components/OrganizerOverview';
import DataDeletionBanner from './components/DataDeletionBanner';
import OrganizerProfile from './components/OrganizerProfile';
import ReferralsTab from './components/ReferralsTab';
import { formatInZone } from '../utils/timezone';

/* ═══════════════════════════════════════════════
   Brand Design Tokens
   ═══════════════════════════════════════════════ */
const COLORS = {
  gold: '#B8944F',
  goldHover: '#a6833f',
  charcoal: '#191B1E',
  ivory: '#F8F4EC',
  champagne: '#D7BE80',
  stone: '#77736A',
  border: '#E8E2D6',
  white: '#FFFFFF',
  softBg: '#FAFAF8',
};

/**
 * The two keys that open the seating editor, in the order the upgrade prompt
 * should name them.
 *
 * `requireAnyFeature('seating_map', 'table_management')` guards every table
 * write on the server, so the padlock has to accept either as well. Module
 * scope rather than an inline array literal: a fresh array on every render is a
 * new prop identity, and the day this gate is memoised that becomes a silent
 * re-render rather than an obvious bug.
 */
const SEATING_KEYS = ['seating_map', 'table_management'];

/* ═══════════════════════════════════════════════
   Guest list — fetch EVERY page
   ═══════════════════════════════════════════════ */
/**
 * GET /rsvps is server-paginated (default 50 per page, hard cap 100), but the
 * dashboard filters, sorts and paginates the guest list entirely client-side —
 * so it needs every party, not the first page.
 *
 * Requesting it without page/limit returned only the first 50 parties: the
 * RSVPs/Guests tabs showed a headcount lower than the stats cards (which count
 * server-side over the whole event), every party past #50 was unreachable, and
 * the client-side pager capped out early. Walk the pages until we've collected
 * `total`, then hand back the same envelope shape the single call returned.
 */
const RSVP_PAGE_LIMIT = 100; // the endpoint's hard cap — fewest round-trips
const RSVP_MAX_PAGES = 200;  // 20k parties; a stop so a bad `total` can't loop forever

async function fetchAllRsvps(eventId) {
  const first = await apiFetch(`/events/${eventId}/rsvps?page=1&limit=${RSVP_PAGE_LIMIT}`);
  if (!first?.success) return first;

  const all = [...(first.data?.rsvps || [])];
  const total = Number(first.meta?.pagination?.total);
  const wanted = Number.isFinite(total) ? total : all.length;

  for (let page = 2; all.length < wanted && page <= RSVP_MAX_PAGES; page++) {
    let batch = [];
    try {
      const next = await apiFetch(`/events/${eventId}/rsvps?page=${page}&limit=${RSVP_PAGE_LIMIT}`);
      batch = next?.success ? (next.data?.rsvps || []) : [];
    } catch {
      // apiFetch throws on a non-2xx. A later page failing must not discard the
      // pages already in hand — show a partial list rather than an empty one.
      break;
    }
    // An empty page means we've run out (a `total` that disagrees with reality) —
    // stop rather than spin to RSVP_MAX_PAGES.
    if (batch.length === 0) break;
    all.push(...batch);
  }

  return { ...first, data: { ...first.data, rsvps: all } };
}

/**
 * The sections that are about ONE event, and what to call them when there isn't
 * one. The value is the sentence subject in NoEventSelected, so it reads as
 * "Your guest list belongs to an event" rather than a generic refusal.
 *
 * Account-scoped tabs (overview, events, drafts, profile, referrals) are absent
 * on purpose — they work perfectly well with no event and must not be blocked.
 */
const EVENT_SCOPED_TABS = {
  guests: 'Your guest list',
  rsvps: 'Invitations and replies',
  seating: 'Seating',
  share: 'Your invitation link',
  settings: 'Event details',
  'form-builder': 'Your RSVP form',
};

function DashboardSkeleton() {
  return (
    <div style={{ display: 'flex', minHeight: '100dvh', background: COLORS.ivory }}>
      {/* Sidebar skeleton. Hidden below lg to match the real chrome, where
          the sidebar is an off-canvas drawer rather than a 240px column —
          otherwise the skeleton reserved 240px of a 320px phone. */}
      <div className="fx-hide-below-lg" style={{ width: '240px', flexShrink: 0, background: COLORS.white, borderRight: `1px solid ${COLORS.border}`, padding: '24px' }}>
        <div style={{ width: '120px', height: '24px', background: COLORS.border, borderRadius: '8px', marginBottom: '48px' }} />
        {[...Array(7)].map((_, i) => (
          <div key={i} style={{ width: '100%', height: '36px', background: COLORS.ivory, borderRadius: '8px', marginBottom: '8px' }} />
        ))}
      </div>
      {/* Content skeleton */}
      {/* minWidth:0 so this flex child can shrink; the title bar was a hard
          300px inside 32px padding (364px) and the stat row a fixed
          repeat(5, 1fr) — neither had any breakpoint, and the @media block
          at the bottom of this file targets the real dashboard chrome, not
          the skeleton. .fx-grid gives the tiles an intrinsic ladder. */}
      {/* Same gutter class as the real content below, so the skeleton does not
          resize the page the moment it is replaced. It could not use the
          <style jsx> rule that governed the real one — this is a different
          function, and a scoped rule never crosses that line. */}
      <div className="fx-gutter fx-gutter--lg" style={{ flex: 1, minWidth: 0, paddingTop: '32px', paddingBottom: '32px' }}>
        <div style={{ width: '100%', maxWidth: '300px', height: '32px', background: COLORS.border, borderRadius: '8px', marginBottom: '32px' }} />
        <div className="fx-grid" style={{ '--fx-col': '150px', '--fx-gap': '16px', marginBottom: '32px' }}>
          {[...Array(5)].map((_, i) => (
            <div key={i} style={{ height: '96px', background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: '12px' }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   HTML escaping for safe interpolation in document.write()
   ═══════════════════════════════════════════════ */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeCoverUrl(url) {
  if (!url) return 'https://images.unsplash.com/photo-1469371670807-013ccf25f16a?q=80&w=2070';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return 'https://images.unsplash.com/photo-1469371670807-013ccf25f16a?q=80&w=2070';
    }
    return encodeURI(url);
  } catch {
    return 'https://images.unsplash.com/photo-1469371670807-013ccf25f16a?q=80&w=2070';
  }
}

/* ═══════════════════════════════════════════════
   Local QR code renderer (replaces external qrserver.com API)
   ═══════════════════════════════════════════════ */
function QRCodeDisplay({ url, size = 200 }) {
  const [src, setSrc] = React.useState('');
  React.useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { width: size }).then(dataUrl => {
      if (!cancelled) setSrc(dataUrl);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [url, size]);
  if (!src) return <div style={{ width: size, height: size, background: COLORS.softBg, border: `1px solid ${COLORS.border}`, borderRadius: 12, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontSize: 11, color: COLORS.stone }}>Loading QR…</span></div>;
  return (
    <div style={{ background: COLORS.softBg, border: `1px solid ${COLORS.border}`, padding: 16, borderRadius: 12, display: 'inline-flex', justifyContent: 'center', alignItems: 'center' }}>
      <img src={src} alt="Event QR Code" style={{ width: size, height: size, display: 'block' }} />
    </div>
  );
}

/**
 * The section and the selected event both come from the URL now, which means
 * this component calls `useSearchParams`. Next requires that behind a Suspense
 * boundary — without one, reading the query string opts the whole route out of
 * static rendering and the build says so.
 *
 * The fallback is the skeleton this page already had, so the boundary costs
 * nothing visually: it is what the first paint looked like anyway.
 */
export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardPageInner />
    </Suspense>
  );
}

function DashboardPageInner() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // isClient gates the localStorage read until we're past hydration (SSR has
  // no localStorage). authChecked is derived from it — it's never set
  // independently anywhere else, so no separate state is needed (mirrors
  // seating-map/page.js's and checkin/page.js's fix for this same pattern).
  const isClient = useIsClient();
  const orgId = isClient ? localStorage.getItem('org_id') : null;
  const authChecked = isClient && !!orgId;

  /* Declared FIRST, above everything that closes over them.
     A dependency array is evaluated during render, so a useCallback listing
     `[router, pathname, searchParams]` while those consts sit further down is a
     temporal-dead-zone ReferenceError — which does not warn, it fails the
     production build at prerender. See the same note on the smsAddon effect
     below; this is the reason these three moved to the top of the component. */
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [stats, setStats] = useState({
    invitedParties: 0, attendingParties: 0, attendingGuests: 0,
    declinedParties: 0, declinedGuests: 0, pendingParties: 0,
    pendingGuests: 0, totalExpectedGuests: 0, checkedInGuests: 0,
    seatingAssignedGuests: 0, mealSummary: {}
  });

  const [tables, setTables] = useState([]);
  const [rsvps, setRsvps] = useState([]);
  // Read inside the silent 20s realtime poll to diff against incoming data
  // without making loadDashboardData depend on (and re-create per) rsvps.
  const rsvpsRef = useRef([]);
  useEffect(() => { rsvpsRef.current = rsvps; }, [rsvps]);
  const [customFields, setCustomFields] = useState([]);
  const [newTableName, setNewTableName] = useState('');
  const [newTableCapacity, setNewTableCapacity] = useState(10);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterResponse, setFilterResponse] = useState('all');
  /**
   * WHICH SECTION IS OPEN — held in the URL, not in React state.
   *
   * This was `useState('overview')`, and that single fact caused most of the
   * dashboard's disorientation:
   *
   *   • The sidebar had to be rendered by THIS component to read it, so it
   *     existed on this page only and vanished on the six sub-pages — four of
   *     which its own items link to.
   *   • The four route-based items could never highlight, because they navigate
   *     without ever setting this variable.
   *   • The browser's back button skipped every section change, jumping straight
   *     out of the dashboard.
   *   • No section was linkable. Support could not say "open this URL".
   *
   * Deliberately kept as the same `activeTab` / `setActiveTab` pair the twenty-odd
   * call sites below already use, so moving the source of truth did not become a
   * rewrite of every one of them.
   */
  const activeTab = (() => {
    const t = searchParams.get('tab');
    return ALL_TAB_KEYS.includes(t) ? t : 'overview';
  })();

  /**
   * Navigate to a section, optionally switching event at the same time.
   *
   * ONE navigation for both, and that is a correctness requirement rather than an
   * optimisation. Both `setActiveTab` and `setEventId` build their query string
   * from the `searchParams` of the render they were created in, so calling them
   * in the same tick makes the second overwrite the first — "select this event
   * and open its guest list" would arrive with the event silently dropped.
   */
  const goTo = useCallback((key, id) => {
    if (typeof window === 'undefined') return;
    // window.location.search, not the captured searchParams — see setEventId.
    const q = new URLSearchParams(window.location.search);
    if (!key || key === 'overview') q.delete('tab'); else q.set('tab', key);
    if (id) q.set('event', id);
    const qs = q.toString();
    // scroll: false — switching section should not also throw away the reading
    // position of a long list the organizer is halfway down.
    router.push(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [router, pathname]);

  const setActiveTab = useCallback((key) => goTo(key), [goTo]);
  const [showImportModal, setShowImportModal] = useState(false);
  /**
   * Everything the tabs need to say about text messaging, held once here.
   *
   * Loaded BEFORE the organizer presses anything, so the action bar can say "you
   * can text 74 of these 118" up front rather than letting them discover it from
   * a 402 or a 429 after the fact. `coverage` is the server's own judgement of
   * whether the balance covers the real guest list — computed from the same
   * ladder that priced the purchase, so the banner and the checkout can never
   * quote two different models.
   */
  const [smsAddon, setSmsAddon] = useState({
    active: false, maxPerSend: 0, remaining: 0, purchased: 0, coverage: null,
    /**
     * PLAN-LEVEL access, distinct from `active` (which is "has this event bought
     * messages?").
     *
     *   'granted'       the plan includes texting
     *   'grandfathered' it does not, but this event already paid — still works
     *   'locked'        neither → every SMS surface shows PlanLock instead
     *
     * Server-computed (campaigns/settings) rather than derived here from
     * tier_features: the send endpoints resolve it from the live admin config,
     * and a second implementation in the browser disagrees the first time a tier
     * is renamed — leaving surfaces that look open and 403, or look locked on an
     * event that was allowed all along.
     *
     * Defaults to 'granted' so a failed lookup NEVER hides a paying customer's
     * texting behind an upsell. The real gate still fails closed server-side, so
     * the worst case here is a 402/403 the organizer can act on — strictly better
     * than falsely telling them to upgrade.
     */
    access: 'granted', plansWithSms: [], tierName: null,
  });
  const [showQRModal, setShowQRModal] = useState(false);
  const [qrModalTab, setQrModalTab] = useState('qr');
  const [copyTooltip, setCopyTooltip] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [forcePasswordReset, setForcePasswordReset] = useState(false);


  const [events, setEvents] = useState([]);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

  /**
   * WHICH EVENT — derived from the URL, not mirrored into state.
   *
   * The sidebar lives in the layout and writes `?event=` when the organizer uses
   * its switcher. Keeping a second copy in state here would need an effect to
   * follow it, and a synchronous setState inside an effect is both a cascading
   * render and an error under this repo's react-hooks/set-state-in-effect rule.
   * Deriving has no such problem and cannot drift: there is only one value.
   *
   * `pickedEventId` is the fallback for the moment before the URL says anything —
   * the very first load, where fetchEvents chooses a sensible default (the event
   * a Stripe return named, then the last one used, then the first) and then puts
   * it in the URL. The URL wins as soon as it names an event we actually have;
   * a stale or hand-typed id for an event this organizer does not own never does.
   */
  const [pickedEventId, setPickedEventId] = useState('');
  const urlEventId = searchParams.get('event') || '';
  const eventId = (urlEventId && events.some((e) => e.id === urlEventId))
    ? urlEventId
    : pickedEventId;

  /**
   * Selecting an event records it in the URL as well.
   *
   * Reads `window.location.search` rather than closing over `searchParams` so the
   * callback is stable across renders. fetchEvents calls this from inside a
   * `useCallback([])`, and a version that captured `searchParams` would write a
   * query string from whenever it was created — dropping whatever else the URL
   * had gained since.
   */
  const setEventId = useCallback((id) => {
    setPickedEventId(id);
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search);
    if (id) q.set('event', id); else q.delete('event');
    const qs = q.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [router, pathname]);

  /**
   * THE SCHEDULED-DELETION BANNER'S DATA.
   *
   * Two-stage on purpose. The purge columns ride along on the events list
   * (getEvents selects `*`), so WHETHER to show the banner costs nothing — but
   * the signed archive and keep links have to be minted server-side, and doing
   * that for every event in the list would be several JWTs per dashboard load
   * to serve a bar that almost never appears.
   *
   * So the list answers "is anything scheduled?" and only then does this fetch
   * the one event that is, for its links.
   *
   * The dependency is the DEADLINE STRING, not the events array. Depending on
   * `events` would re-run this on every refresh of the list — including the ones
   * this page does after a send — and re-mint tokens for no reason.
   */
  const activeEventForPurge = events.find((e) => e.id === eventId);
  const purgeDeadline = activeEventForPurge?.purge_scheduled_at || null;
  const purgeOptedOut = !!activeEventForPurge?.purge_opt_out;
  const [retention, setRetention] = useState(null);

  useEffect(() => {
    if (!eventId || (!purgeDeadline && !purgeOptedOut)) {
      setRetention(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/events/${eventId}`, { credentials: 'include' });
        const j = await res.json();
        if (!cancelled && j?.success) setRetention(j.retention || null);
      } catch {
        /* The warning email already carried this notice and its links. A failed
           fetch costs the organizer a reminder, not the information. */
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, purgeDeadline, purgeOptedOut, apiUrl]);

  /* Whether this event can send texts at all, and its current per-send cap and
     balance — needed BEFORE the send modal opens so the RSVPs action bar can say
     so up front instead of the organizer meeting a 402 or 429 at the end.

     Placed HERE, below `eventId` and `apiUrl`, and not with the other useState
     calls above. A dependency array is evaluated during render, so `[apiUrl,
     eventId]` sitting above those two `const` declarations is a temporal-dead-zone
     ReferenceError — which does not merely warn, it fails the production build at
     prerender ("Cannot access 'X' before initialization"). Hooks may move freely
     among themselves; they may not move above the values they close over. */
  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      try {
        // Ungated endpoint by design: an event WITHOUT the add-on is exactly the
        // one that needs to be told so. A failure leaves the defaults, which
        // simply routes the organizer to the purchase page rather than blocking.
        const res = await fetch(`${apiUrl}/events/${eventId}/campaigns/settings`, { credentials: 'include' });
        const data = await res.json();
        if (!cancelled && data?.success) {
          setSmsAddon({
            active: !!data.addonActive,
            maxPerSend: Number(data.sendLimit?.maxPerSend) || 0,
            remaining: Number(data.balance?.remaining) || 0,
            purchased: Number(data.balance?.purchased) || 0,
            // Server-computed against the real guest count and the same guest
            // ladder that priced the purchase. Deliberately NOT re-derived on the
            // client: a second implementation of "is this enough?" is a second
            // answer waiting to disagree with the one on the checkout screen.
            coverage: data.coverage || null,
            // Older deployments answer without these; treating a missing
            // `access` as 'granted' keeps them behaving exactly as before rather
            // than locking every event the moment the API is a version behind.
            access: data.access || 'granted',
            plansWithSms: Array.isArray(data.plansWithSms) ? data.plansWithSms : [],
            tierName: data.tierName || null,
          });
        }
      } catch { /* defaults stand */ }
    })();
    return () => { cancelled = true; };
  }, [apiUrl, eventId]);

  // The redirect is a genuine imperative side effect (navigation); it no
  // longer also carries the authChecked state update, which is now a plain
  // derived value above. Super-admin status is validated server-side during
  // data load (see below).
  useEffect(() => {
    if (isClient && !orgId) router.push('/login');
  }, [isClient, orgId, router]);

  /* ═══ Deep-link to a tab (e.g. ?tab=drafts after "Save as Draft") + toast ═══ */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Wrapped in an IIFE (same technique used elsewhere in this pass) so none
    // of these setState calls are bare top-level statements in the effect body.
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const saved = params.get('saved');
      const forceReset = params.get('forceReset');
      if (saved === 'draft') toast.success('Draft saved — finish it any time from Drafts.');
      // forcePasswordReset only ever renders inside OrganizerProfile, which only
      // mounts when activeTab === 'profile' (default tab is 'overview') — without
      // this, a user linked in via ?forceReset=1 never actually saw the prompt
      // unless they happened to click into Profile themselves.
      if (forceReset === '1') { setForcePasswordReset(true); setActiveTab('profile'); }
      /**
       * `tab` is deliberately NOT read or stripped here any more.
       *
       * It is now the source of truth for which section is open, read straight
       * from searchParams on every render. This effect used to copy it into state
       * and then DELETE it from the URL — which, once the sidebar started reading
       * `?tab=` to highlight the active section, would have wiped the highlight a
       * moment after every navigation and broken every deep link and bookmark.
       *
       * `saved` and `forceReset` are still cleaned up: both are one-shot signals
       * that have been consumed by the time we get here, and leaving them would
       * re-fire the toast on every refresh.
       */
      if (saved || forceReset) {
        params.delete('saved'); params.delete('forceReset');
        const qs = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
      }
    })();
  }, [setActiveTab]);

  // Pulled out to a stable callback (not just an inline effect function) so the
  // "Retry Connection" screen's button can call it directly — previously that
  // button always called loadDashboardData(), which immediately no-ops when
  // eventId is empty, so a fetchEvents-stage outage left Retry as a permanent
  // no-op with zero feedback.
  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const [eventsResult, profileResult] = await Promise.allSettled([
        apiFetch('/events'),
        apiFetch('/auth/profile')
      ]);

      const data = eventsResult.status === 'fulfilled' ? eventsResult.value : null;
      const profileData = profileResult.status === 'fulfilled' ? profileResult.value : null;

      if (profileData?.success && profileData.profile) {
        setIsSuperAdmin(!!profileData.profile.isSuperAdmin);
      }

      if (data && data.success) {
        if (data.events.length > 0) {
          setEvents(data.events);
          // Prefer the event passed back from a Stripe return (?event=…) or the last
          // active event, so the user lands on the section they were working in —
          // not always the first event.
          const params = new URLSearchParams(window.location.search);
          const returnedId = params.get('event');
          const storedId = localStorage.getItem('active_event_id');
          const preferred = [returnedId, storedId].find(id => id && data.events.some(e => e.id === id));
          setEventId(preferred || data.events[0].id);
          setError(null);
        } else {
          // Genuinely zero events (new account) — a normal empty state, not a
          // failure, so this must NOT show the "Backend Connection Error" screen.
          setEvents([]);
          setEventId('');
          setError(null);
          setLoading(false);
        }
        return true;
      }
      // Same failure class as loadDashboardData below — previously this branch
      // silently showed an empty-events UI with no indication anything failed.
      setError(data?.message || 'Could not connect to backend server. Make sure the backend server is running on port 5000.');
      setLoading(false);
      return false;
    } catch (err) {
      setError('Could not connect to backend server. Make sure the backend server is running on port 5000.');
      setLoading(false);
      return false;
    }
  }, [setEventId]);

  useEffect(() => {
    if (!authChecked) return;
    (async () => { await fetchEvents(); })();
  }, [authChecked, fetchEvents]);

  useEffect(() => {
    if (eventId && typeof window !== 'undefined') localStorage.setItem('active_event_id', eventId);
  }, [eventId]);

  /* ═══ Return from Stripe Checkout when paying for an EXISTING event from the
     Events section. Land on the Events tab (never the creation wizard), keep the
     paid event selected, synchronously confirm the session, and clean the URL. ═══ */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    if (payment !== 'success' && payment !== 'cancelled') return;

    // Wrapped in one IIFE (same technique used elsewhere in this pass) so none
    // of these setState calls are bare top-level statements in the effect body.
    (async () => {
      setActiveTab('events');
      const returnedId = params.get('event');
      if (returnedId) localStorage.setItem('active_event_id', returnedId); // fetchEvents selects it

      const sessionId = params.get('session_id');
      // Strip the payment params so a refresh doesn't replay this handler.
      window.history.replaceState({}, '', window.location.pathname);

      if (payment === 'success' && sessionId) {
        // Confirm the payment synchronously, THEN re-fetch events so the UI
        // reflects the updated is_paid / tier state (the webhook remains the backstop).
        // Reuses the shared fetchEvents() (rather than duplicating the fetch here)
        // so this path gets the same session-expiry handling and unified error
        // state as every other event load — `returnedId` was already persisted to
        // localStorage above, so fetchEvents' own preference logic still picks it.
        try {
          await apiFetch(`/payments/verify?session_id=${encodeURIComponent(sessionId)}`);
        } catch { /* non-fatal — the webhook will reconcile the event status */ }
        const ok = await fetchEvents();
        if (ok) toast.success('Payment confirmed successfully!');
      }
    })();
  }, [fetchEvents, setActiveTab]);

  // Log out moved into DashboardNav with the rest of the sidebar footer, so it
  // exists on every dashboard page rather than only on this one.

  // "Latest request wins" guard: switching events quickly, or a 20s realtime
  // poll (useRealtimeRSVPs) overlapping a manual switch, could previously let
  // an OLDER, slower response land after a newer one and silently overwrite
  // the correct data with stale data — there was no cancellation of any kind.
  // Bumped and checked inside this same callback (not via a separate
  // ref-syncing effect) so a stale call's results are simply discarded.
  const loadRequestIdRef = useRef(0);

  const loadDashboardData = useCallback(async ({ silent = false } = {}) => {
    if (!eventId) return;
    const requestId = ++loadRequestIdRef.current;
    // Background refreshes (the 20s realtime poll, tab-refocus) must never
    // blow away the rendered dashboard with the full skeleton — only the
    // very first load, and explicit user-triggered refetches, show it.
    if (!silent) setLoading(true);
    try {

      const [statsResult, tablesResult, rsvpsResult, fieldsResult, profileResult] = await Promise.allSettled([
        apiFetch(`/events/${eventId}/stats`),
        apiFetch(`/events/${eventId}/tables`),
        fetchAllRsvps(eventId),
        apiFetch(`/events/${eventId}/fields`),
        apiFetch('/auth/profile'),
      ]);

      // A newer load already started while these were in flight — applying
      // this response now would overwrite the newer (correct) data on screen.
      if (loadRequestIdRef.current !== requestId) return;

      const statsData = statsResult.status === 'fulfilled' ? statsResult.value : null;
      const tablesData = tablesResult.status === 'fulfilled' ? tablesResult.value : null;
      const rsvpsData = rsvpsResult.status === 'fulfilled' ? rsvpsResult.value : null;
      const fieldsData = fieldsResult.status === 'fulfilled' ? fieldsResult.value : null;
      const profileData = profileResult.status === 'fulfilled' ? profileResult.value : null;

      // Server-validated super-admin check (FIX H12: replaces localStorage check)
      if (profileData?.success && profileData.profile) {
        setIsSuperAdmin(!!profileData.profile.isSuperAdmin);
      } else {
        setIsSuperAdmin(false);
      }

      if (statsData?.success) setStats(statsData.stats);
      if (tablesData?.success) setTables(tablesData.tables);
      if (fieldsData?.success) setCustomFields(fieldsData.fields || []);
      if (rsvpsData?.success) {
        const formattedGuests = (rsvpsData.data?.rsvps || []).map(r => {
          const assignedTableId = r.seating_assignments && r.seating_assignments.length > 0 ? r.seating_assignments[0].table_id : '';
          const party = r.guests || [];
          const primary = party.find(g => g.is_primary_contact) || party[0] || {};
          // Name-attributed so a party of 2+ with different meals is legible
          // ("John: Chicken, Guest 2: Fish") instead of an ambiguous
          // comma-joined blob with no way to tell whose meal is whose.
          const namedMeals = party.filter(g => g.meal_selection)
            .map(g => `${g.full_name}: ${g.meal_selection}`);
          // Companions are names only, so their meals live as a per-party tally
          // rather than one dish per person. Counting guest rows alone would
          // show a party of four as one meal and three blanks.
          const companionMeals = Object.entries(r.companion_meal_counts || {})
            .filter(([, n]) => Number(n) > 0)
            .map(([meal, n]) => `${Number(n)} x ${meal}`)
            .join(', ');
          const guestMeals = [...namedMeals, companionMeals ? `Guests: ${companionMeals}` : '']
            .filter(Boolean).join(', ') || '-';
          // Channel-specific — previously a single flag conflated all channels,
          // so a guest only ever emailed would silently disappear from the
          // SMS tab's default "Not Invited" filter (and vice versa), meaning
          // an organizer relying on that filter could permanently miss
          // sending them the other channel.
          const invitedSentStatuses = ['sent', 'delivered', 'opened', 'responded'];
          const invitations = r.invitations || [];
          const wasInvitedEmail = invitations.some(i => i.channel === 'email' && invitedSentStatuses.includes(i.status));
          const wasInvitedSms = invitations.some(i => i.channel === 'sms' && invitedSentStatuses.includes(i.status));
          return {
            id: r.id, guest_name: r.label, party_size: party.length || 1, response: r.response,
            email: primary.email || '-', phone: primary.phone || '-', tableId: assignedTableId, meal: guestMeals,
            primary_meal: primary.meal_selection || null,
            companion_meal_counts: r.companion_meal_counts || null,
            invitation_sent: wasInvitedEmail || wasInvitedSms,
            invitation_sent_email: wasInvitedEmail,
            invitation_sent_sms: wasInvitedSms,
            // SMS eligibility, straight off the party row. `sms_consent` alone is
            // ambiguous for the organizer — false means "declined" or "never
            // asked" depending on whether a decision was ever recorded — so the
            // timestamp and the method come along to tell those apart.
            sms_consent: r.sms_consent === true,
            sms_consent_at: r.sms_consent_at || null,
            sms_consent_method: r.sms_consent_method || null,
            // Whether this number replied STOP. Served by the rsvps endpoint from
            // the global sms_opt_outs table; without it the list would show
            // "can text" for a suppressed number.
            sms_opted_out: r.sms_opted_out === true,
            // Full per-companion details so the organizer sees everyone in the party.
            guests: party,
            // Custom-question answers (e.g. song requests, dietary preferences) the
            // party head answered during RSVP — labels resolved against customFields.
            customAnswers: r.custom_answers || [],
            notes: r.notes || '',
            side: r.side || null,
            timestamp: r.created_at || null
          };
        });
        // The 20s realtime poll previously swapped the whole list in silently —
        // rows could reorder under a scrolling thumb with zero warning. Surface
        // a toast naming how many responses are actually new instead.
        if (silent) {
          const prevIds = new Set(rsvpsRef.current.map((g) => g.id));
          const newCount = formattedGuests.filter((g) => !prevIds.has(g.id)).length;
          if (newCount > 0) {
            toast.success(`${newCount} new response${newCount > 1 ? 's' : ''}`);
          }
        }
        setRsvps(formattedGuests);
      }
      setError(null);
    } catch (err) {
      if (loadRequestIdRef.current !== requestId) return;
      setError('Could not connect to backend server. Make sure the backend server is running on port 5000.');
    } finally {
      if (loadRequestIdRef.current === requestId && !silent) setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { if (!eventId) return; (async () => { await loadDashboardData(); })(); }, [loadDashboardData, eventId]);

  const handleCreateTable = useCallback(async (e) => {
    e.preventDefault();
    if (!newTableName.trim() || !eventId) return;
    try {
      const data = await apiFetch(`/events/${eventId}/tables`, {
        method: 'POST',
        body: JSON.stringify({ tableName: newTableName, maxCapacity: parseInt(newTableCapacity) })
      });
      if (data.success) { setNewTableName(''); setNewTableCapacity(10); loadDashboardData(); }
    } catch (err) { toast.error(err.message); }
  }, [eventId, newTableName, newTableCapacity, loadDashboardData]);

  const handleUpdateTable = useCallback(async (tableId, updates) => {
    if (!eventId) return;
    try {
      const data = await apiFetch(`/events/${eventId}/tables/${tableId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates)
      });
      if (data.success) {
        loadDashboardData();
      }
    } catch (err) {
      toast.error(err.message);
    }
  }, [eventId, loadDashboardData]);

  const handleAssignTable = useCallback(async (rsvpId, targetTableId) => {
    const guest = rsvps.find(g => g.id === rsvpId);
    if (!guest || !eventId) return;
    const oldTableId = guest.tableId;
    try {
      if (!oldTableId) {
        await apiFetch(`/events/${eventId}/seating/assign`, { method: 'POST', body: JSON.stringify({ rsvpId, tableId: targetTableId }) });
      } else if (!targetTableId) {
        await apiFetch(`/events/${eventId}/seating/unassign`, { method: 'POST', body: JSON.stringify({ rsvpId }) });
      } else {
        await apiFetch(`/events/${eventId}/seating/reassign`, { method: 'POST', body: JSON.stringify({ rsvpId, newTableId: targetTableId }) });
      }
      loadDashboardData();
    } catch (err) { toast.error(err.message); }
  }, [eventId, rsvps, loadDashboardData]);

  const handleRealtimeRefresh = useCallback(() => {
    loadDashboardData({ silent: true });
  }, [loadDashboardData]);

  useRealtimeRSVPs(eventId, handleRealtimeRefresh);

  const totalSeatedCountText = useMemo(() => `${stats.seatingAssignedGuests} / ${stats.attendingGuests}`, [stats.seatingAssignedGuests, stats.attendingGuests]);

  if (!authChecked) return <DashboardSkeleton />;
  if (loading) return <DashboardSkeleton />;

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: COLORS.ivory, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: 'var(--font-sans)' }}>
        <div style={{ maxWidth: '440px', width: '100%', textAlign: 'center', background: COLORS.white, border: `1px solid ${COLORS.border}`, padding: '48px 32px', borderRadius: '16px', boxShadow: '0 8px 30px rgba(0,0,0,0.06)' }}>
          <Icon name="plug" size={44} color="#C45E5E" strokeWidth={1.3} />
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '22px', fontWeight: 600, color: '#C45E5E', marginTop: '12px' }}>Backend Connection Error</h2>
          <p style={{ color: COLORS.stone, marginTop: '12px', fontSize: '13px', lineHeight: 1.7, fontWeight: 300 }}>{error}</p>
          {/* Retry re-runs whichever load actually failed — previously this always
              called loadDashboardData(), which no-ops when eventId is still empty
              (a fetchEvents-stage outage), making Retry a permanent dead click. */}
          <button onClick={() => { eventId ? loadDashboardData() : fetchEvents(); }} id="retry-connection-btn"
            style={{ marginTop: '24px', padding: '12px 28px', background: COLORS.gold, color: COLORS.white, border: 'none', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  const activeEvent = events.find(e => e.id === eventId);
  // Drafts live exclusively in the Drafts tab; everything else counts as a real event.
  const draftCount = events.filter(e => e && e.status === 'draft' && !e.is_paid).length;
  const liveCount = events.length - draftCount;

  return (
    <div style={{ minHeight: '100vh', background: COLORS.white, fontFamily: 'var(--font-sans)' }}>

      {/* ═══ MAIN CONTENT ═══ */}
      <main style={{ minHeight: '100vh', background: '#FAFAF8' }}>

        {/* Top Bar — sticky glassmorphism container */}
        <div
          className="top-bar"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 40,
            padding: '16px 32px',
            background: 'rgba(255, 255, 255, 0.85)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderBottom: '1px solid rgba(184, 148, 79, 0.15)',
            boxShadow: '0 4px 20px rgba(25, 27, 30, 0.02)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
            transition: 'all 0.3s ease',
          }}
        >
          {(activeTab === 'overview' || activeTab === 'events' || activeTab === 'drafts' || activeTab === 'profile' || activeTab === 'referrals') ? (
            /* ── Overview / Events / Drafts / Profile: clean header, no event-specific controls ── */
            <>
              <div>
                <h1 style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: '24px',
                  fontWeight: 500,
                  color: COLORS.charcoal,
                  margin: 0,
                  letterSpacing: '-0.01em'
                }}>
                  {activeTab === 'overview' ? 'Dashboard Overview' : activeTab === 'drafts' ? 'Drafts' : activeTab === 'profile' ? 'Organizer Profile' : activeTab === 'referrals' ? 'Referrals' : 'Your Events'}
                </h1>
                <p style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: '13px',
                  color: COLORS.stone,
                  margin: '4px 0 0 0',
                  fontWeight: 400
                }}>
                  {activeTab === 'overview'
                    ? 'Aggregated insights across all your events'
                    : activeTab === 'drafts'
                      ? `${draftCount} draft${draftCount !== 1 ? 's' : ''} waiting to be finished`
                      : activeTab === 'profile'
                        ? 'Your account and organization details'
                        : activeTab === 'referrals'
                          ? 'Earn credit by referring other organizers'
                          : `You have ${liveCount} event${liveCount !== 1 ? 's' : ''}`}
                </p>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
                {isSuperAdmin && (
                  <Link href="/admin" id="btn-open-super-admin" style={{
                    padding: '10px 18px',
                    background: COLORS.charcoal,
                    color: COLORS.champagne,
                    border: '1px solid rgba(184, 148, 79, 0.35)',
                    borderRadius: '30px',
                    fontSize: '11px',
                    fontWeight: 700,
                    textDecoration: 'none',
                    fontFamily: 'var(--font-sans)',
                    letterSpacing: '1px',
                    textTransform: 'uppercase',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 15px rgba(0,0,0,0.1)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.05)'; }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                    Super Admin
                  </Link>
                )}
                <Link href="/dashboard/create-event" style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '10px 20px',
                  background: 'linear-gradient(135deg, #D7BE80 0%, #B8944F 100%)',
                  color: COLORS.white,
                  border: 'none',
                  borderRadius: '30px',
                  fontSize: '12px',
                  fontWeight: 700,
                  fontFamily: 'var(--font-sans)',
                  textDecoration: 'none',
                  boxShadow: '0 4px 15px rgba(184, 148, 79, 0.25)',
                  transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(184, 148, 79, 0.4)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 15px rgba(184, 148, 79, 0.25)'; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Create Event
                </Link>
              </div>
            </>
          ) : (
            /* ── Event-specific tabs: show event name, selector, and action buttons ── */
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <h1 style={{
                    fontFamily: 'var(--font-serif)',
                    fontSize: '26px',
                    fontWeight: 500,
                    color: COLORS.charcoal,
                    margin: 0,
                    letterSpacing: '-0.02em',
                    lineHeight: 1.1,
                  }}>
                    {activeEvent?.title || 'Select an Event'}
                  </h1>
                  
                  {activeEvent && (
                    <div style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '4px 10px',
                      background: activeEvent.status === 'active' ? 'rgba(34, 197, 94, 0.08)' : activeEvent.status === 'paused' ? 'rgba(245, 158, 11, 0.08)' : 'rgba(119, 115, 106, 0.08)',
                      border: `1px solid ${activeEvent.status === 'active' ? 'rgba(34, 197, 94, 0.2)' : activeEvent.status === 'paused' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(119, 115, 106, 0.2)'}`,
                      borderRadius: '20px',
                      fontSize: 'var(--fx-micro)',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      color: activeEvent.status === 'active' ? '#22C55E' : activeEvent.status === 'paused' ? '#F59E0B' : '#77736A',
                      fontFamily: 'var(--font-sans)',
                      letterSpacing: '0.5px',
                    }}>
                      <span className="status-dot" style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: activeEvent.status === 'active' ? '#22C55E' : activeEvent.status === 'paused' ? '#F59E0B' : '#77736A',
                        boxShadow: activeEvent.status === 'active' ? '0 0 8px #22C55E' : activeEvent.status === 'paused' ? '0 0 8px #F59E0B' : 'none',
                        animation: activeEvent.status === 'active' ? 'pulse 2s infinite' : 'none',
                      }} />
                      {activeEvent.status}
                    </div>
                  )}
                </div>

                {events.length > 1 && (
                  <div style={{ position: 'relative', display: 'inline-block', width: 'fit-content' }}>
                    <select
                      value={eventId}
                      onChange={e => setEventId(e.target.value)}
                      style={{
                        background: 'rgba(184, 148, 79, 0.04)',
                        border: '1px solid rgba(184, 148, 79, 0.18)',
                        borderRadius: '30px',
                        padding: '5px 28px 5px 12px', minHeight: 'var(--fx-touch)',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: COLORS.gold,
                        fontFamily: 'var(--font-sans)',
                        cursor: 'pointer',
                        outline: 'none',
                        appearance: 'none',
                        WebkitAppearance: 'none',
                        transition: 'all 0.2s ease',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(184, 148, 79, 0.08)'; e.currentTarget.style.borderColor = COLORS.gold; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(184, 148, 79, 0.04)'; e.currentTarget.style.borderColor = 'rgba(184, 148, 79, 0.18)'; }}
                    >
                      {events.map(ev => (<option key={ev.id} value={ev.id} style={{ color: COLORS.charcoal }}>{ev.title}</option>))}
                    </select>
                    <svg width="8" height="6" viewBox="0 0 10 6" fill="none" style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                      <path d="M1 1L5 5L9 1" stroke={COLORS.gold} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                )}
              </div>

              {/* Action Buttons Group */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {isSuperAdmin && (
                  <Link href="/admin" id="btn-open-super-admin" style={{
                    padding: '8px 16px',
                    background: COLORS.charcoal,
                    color: COLORS.champagne,
                    border: '1px solid rgba(184, 148, 79, 0.35)',
                    borderRadius: '30px',
                    fontSize: '11px',
                    fontWeight: 700,
                    textDecoration: 'none',
                    fontFamily: 'var(--font-sans)',
                    letterSpacing: '1px',
                    textTransform: 'uppercase',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                    Super Admin
                  </Link>
                )}

                <Link
                  href="/dashboard/analytics"
                  id="btn-open-analytics"
                  style={{
                    padding: '9px 18px',
                    background: COLORS.white,
                    color: COLORS.charcoal,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: '30px',
                    fontSize: '12px',
                    fontWeight: 700,
                    textDecoration: 'none',
                    fontFamily: 'var(--font-sans)',
                    transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(25, 27, 30, 0.12)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3v18h18"/><path d="M7 15l4-5 3.5 3.5L21 7"/></svg>
                  Analytics
                </Link>

                <Link
                  href="/checkin"
                  id="btn-open-checkin"
                  style={{
                    padding: '9px 18px',
                    background: 'linear-gradient(135deg, #D7BE80 0%, #B8944F 100%)',
                    color: COLORS.white,
                    border: 'none',
                    borderRadius: '30px',
                    fontSize: '12px',
                    fontWeight: 700,
                    textDecoration: 'none',
                    fontFamily: 'var(--font-sans)',
                    transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 4px 15px rgba(184, 148, 79, 0.25)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(184, 148, 79, 0.4)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 15px rgba(184, 148, 79, 0.25)'; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                  Check-In
                </Link>

                {/* Either key — the table routes accept either (requireAnyFeature). */}
            <FeatureGate tierFeatures={activeEvent?.tier_features} isPaid={!!activeEvent?.is_paid} feature={SEATING_KEYS} onUpgrade={() => { setActiveTab('events'); }}>
                <Link
                  href="/dashboard/seating-map"
                  id="btn-open-seating-map"
                  style={{
                    padding: '9px 18px',
                    background: COLORS.charcoal,
                    color: COLORS.white,
                    border: 'none',
                    borderRadius: '30px',
                    fontSize: '12px',
                    fontWeight: 700,
                    textDecoration: 'none',
                    fontFamily: 'var(--font-sans)',
                    transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 4px 15px rgba(25, 27, 30, 0.12)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(25, 27, 30, 0.25)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 15px rgba(25, 27, 30, 0.12)'; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></svg>
                  Open Seating Map
                </Link>
                </FeatureGate>

                <div className="action-btn-divider" style={{ width: '1px', height: '20px', background: COLORS.border, margin: '0 4px' }} />

                {activeTab === 'guests' && (
                  <FeatureGate tierFeatures={activeEvent?.tier_features} isPaid={!!activeEvent?.is_paid} feature="import_guests_csv" onUpgrade={() => { setActiveTab('events'); }}>
                  <button
                    onClick={() => setShowImportModal(true)}
                    id="btn-import-csv"
                    style={{
                      padding: '8px 16px', minHeight: 'var(--fx-touch)',
                      background: COLORS.white,
                      border: `1px solid ${COLORS.border}`,
                      color: COLORS.stone,
                      borderRadius: '30px',
                      fontSize: '12px',
                      fontWeight: 600,
                      fontFamily: 'var(--font-sans)',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = COLORS.gold; e.currentTarget.style.color = COLORS.gold; e.currentTarget.style.background = 'rgba(184, 148, 79, 0.02)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = COLORS.border; e.currentTarget.style.color = COLORS.stone; e.currentTarget.style.background = COLORS.white; }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    Import CSV
                  </button>
                  </FeatureGate>
                )}

                <div style={{ position: 'relative' }}>
                  <button
                    onClick={() => {
                      const url = `${window.location.origin}/${activeEvent?.slug || ''}`;
                      navigator.clipboard.writeText(url).then(() => {
                        setCopyTooltip(true);
                        setTimeout(() => setCopyTooltip(false), 1800);
                      }).catch(() => {});
                    }}
                    id="btn-copy-link"
                    style={{
                      padding: '8px 16px',
                      background: COLORS.white,
                      border: `1px solid ${COLORS.border}`,
                      color: COLORS.stone,
                      borderRadius: '30px',
                      fontSize: '12px',
                      fontWeight: 600,
                      fontFamily: 'var(--font-sans)',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = COLORS.gold; e.currentTarget.style.color = COLORS.gold; e.currentTarget.style.background = 'rgba(184, 148, 79, 0.02)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = COLORS.border; e.currentTarget.style.color = COLORS.stone; e.currentTarget.style.background = COLORS.white; }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                    Copy Link
                  </button>
                  {copyTooltip && (
                    <span style={{
                      position: 'absolute',
                      top: '-36px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: COLORS.charcoal,
                      color: COLORS.white,
                      padding: '5px 12px',
                      borderRadius: '6px',
                      fontSize: 'var(--fx-micro)',
                      fontWeight: 700,
                      fontFamily: 'var(--font-sans)',
                      whiteSpace: 'nowrap',
                      pointerEvents: 'none',
                      boxShadow: '0 4px 10px rgba(0,0,0,0.15)',
                    }}>COPIED!</span>
                  )}
                </div>

                <button
                  onClick={() => { setQrModalTab('qr'); setShowQRModal(true); }}
                  id="btn-show-qr"
                  style={{
                    padding: '8px 16px', minHeight: 'var(--fx-touch)',
                    background: COLORS.white,
                    border: `1px solid ${COLORS.border}`,
                    color: COLORS.stone,
                    borderRadius: '30px',
                    fontSize: '12px',
                    fontWeight: 600,
                    fontFamily: 'var(--font-sans)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = COLORS.gold; e.currentTarget.style.color = COLORS.gold; e.currentTarget.style.background = 'rgba(184, 148, 79, 0.02)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = COLORS.border; e.currentTarget.style.color = COLORS.stone; e.currentTarget.style.background = COLORS.white; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 7h2v2H7zm0 8h2v2H7zm8-8h2v2h-2z" /><path d="M12 7h1v1h-1zm0 2h1v1h-1zm2-2h1v1h-1zm0 2h1v1h-1zm-2 4h1v1h-1zm2 0h1v1h-1zm-2 2h1v1h-1zm2 0h1v1h-1zm-4 2h1v1h-1zm2 0h1v1h-1z" /></svg>
                  QR Code
                </button>

                {/* "Export Sheet" was here, on the RSVPs tab only.
                    It hit `/rsvps/export` with no parameters — every guest,
                    unordered — while a button a few pixels below it inside the
                    tab hit the SAME endpoint with `attending=true&sort=…` and
                    produced a different file under a near-identical label. Its
                    id was even `btn-export-excel` while it downloaded CSV.
                    Downloading is now one control in the Guest list section,
                    where the detail being exported actually lives, with both
                    scope choices as visible inputs. */}
              </div>
            </>
          )}
        </div>

        <div className="content-container fx-container fx-container--4xl fx-gutter fx-gutter--lg" style={{ paddingTop: '32px', paddingBottom: '32px' }}>

          {/**
            * "Everything for this event is deleted in …"
            *
            * Above the tab dispatch rather than inside one section, because it
            * is true of the whole event: an organizer looking at Seating has as
            * much need to know as one looking at Guests, and a notice that only
            * appears on the tab you happen to open is a notice that gets missed.
            *
            * `retention` is fetched lazily and only for an event that actually
            * has a deadline — see the effect that loads it.
            */}
          {retention && (
            <DataDeletionBanner
              deleteAt={retention.deleteAt}
              eventTitle={activeEvent?.title || 'this event'}
              archiveUrl={retention.archiveUrl}
              keepUrl={retention.keepUrl}
              optedOut={retention.optedOut}
            />
          )}

          {/**
            * One guard for every event-scoped section, checked before the section
            * renders rather than inside each one.
            *
            * Only Seating ever did this. The other seven rendered with an empty
            * event id: a heading, an empty table, and no clue that the fix was to
            * pick an event. Whatever the section, the answer is the same sentence,
            * so it belongs in one place ahead of the dispatch below.
            */}
          {EVENT_SCOPED_TABS[activeTab] && !eventId ? (
            <NoEventSelected section={EVENT_SCOPED_TABS[activeTab]} empty={events.length === 0} />
          ) : activeTab === 'profile' ? (
            <OrganizerProfile events={events} forcePasswordReset={forcePasswordReset} onPasswordReset={() => setForcePasswordReset(false)} />
          ) : activeTab === 'referrals' ? (
            <ReferralsTab />
          ) : activeTab === 'settings' ? (
            <EventSettings eventId={eventId} event={activeEvent} onEventUpdated={(updated) => {
              setEvents(prev => prev.map(ev => ev.id === eventId ? { ...ev, ...updated } : ev));
            }} onEventDeleted={(deletedId) => {
              setEvents(prev => {
                const remaining = prev.filter(ev => ev.id !== deletedId);
                setEventId(remaining[0]?.id || '');
                return remaining;
              });
              setActiveTab('overview');
            }} />
          ) : activeTab === 'form-builder' ? (
            <FeatureGate
              tierFeatures={activeEvent?.tier_features}
              feature="rsvp_custom_fields"
              isPaid={!!activeEvent?.is_paid || !!activeEvent?.manual_override}
              onUpgrade={() => setActiveTab('events')}
              wrapperStyle={{ display: 'flex', width: '100%' }}
            >
              <FormBuilder eventId={eventId} />
            </FeatureGate>
          ) : activeTab === 'events' ? (
            <EventsTab
              events={events}
              activeEventId={eventId}
              // One navigation carrying both, via goTo — see its note. Two
              // separate calls would drop the event.
              onSelectEvent={(id, tab) => { setPickedEventId(id); goTo(tab || 'overview', id); }}
              // Restores the only route to unfinished events now that Drafts left
              // the sidebar and its badge moved onto Your events.
              onOpenDrafts={() => setActiveTab('drafts')}
              onRefresh={loadDashboardData}
            />
          ) : activeTab === 'drafts' ? (
            <DraftsTab
              events={events}
              apiUrl={apiUrl}
              onRefresh={(deletedId) => { if (deletedId) setEvents(prev => prev.filter(e => e.id !== deletedId)); }}
            />
          ) : activeTab === 'share' ? (
            <ShareTab event={activeEvent} />
          ) : activeTab === 'rsvps' ? (
            <RSVPsTab
              rsvps={rsvps}
              eventId={eventId}
              event={activeEvent}
              customFields={customFields}
              onRefresh={loadDashboardData}
              smsAddonActive={smsAddon.active}
              smsAccess={smsAddon.access}
              plansWithSms={smsAddon.plansWithSms}
              onUpgradePlan={() => goTo('events')}
              smsMaxPerSend={smsAddon.maxPerSend}
              smsRemaining={smsAddon.remaining}
              smsPurchased={smsAddon.purchased}
              smsCoverage={smsAddon.coverage}
              onBuySms={() => router.push('/dashboard/sms-plans?event=' + eventId)}
              // Adding one guest by hand moved into this section, and it is a paid
              // feature — so the tier context has to come with it.
              isPaid={!!activeEvent?.is_paid || !!activeEvent?.manual_override}
              tierFeatures={activeEvent?.tier_features}
              onUpgrade={() => setActiveTab('events')}
            />
          ) : activeTab === 'guests' ? (
            <GuestsTab
              rsvps={rsvps}
              tables={tables}
              customFields={customFields}
              eventId={eventId}
              event={activeEvent}
              onAssignTable={handleAssignTable}
              onRefresh={loadDashboardData}
              onOpenImport={() => setShowImportModal(true)}
              smsAddonActive={smsAddon.active}
              smsAccess={smsAddon.access}
              plansWithSms={smsAddon.plansWithSms}
              onUpgradePlan={() => goTo('events')}
              smsRemaining={smsAddon.remaining}
              smsPurchased={smsAddon.purchased}
              smsCoverage={smsAddon.coverage}
              isPaid={!!activeEvent?.is_paid || !!activeEvent?.manual_override}
              tierFeatures={activeEvent?.tier_features}
              onUpgrade={() => setActiveTab('events')}
            />
          ) : activeTab === 'seating' ? (
            /* ═══ SEATING TAB ═══ */
            <FeatureGate
              tierFeatures={activeEvent?.tier_features}
              feature={SEATING_KEYS}
              isPaid={!!activeEvent?.is_paid || !!activeEvent?.manual_override}
              onUpgrade={() => setActiveTab('events')}
              wrapperStyle={{ display: 'flex', width: '100%' }}
            >
              {/* The `{eventId && …}` / `{!eventId && …}` pair that used to wrap
                  this is gone — NoEventSelected above the dispatch now answers
                  that for all seven event-scoped sections instead of only this
                  one, so reaching here already means an event is selected. */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%' }}>
                <>
                  {/**
                    * HOW FAR ALONG THE SEATING IS — the question this section
                    * exists to answer, and it was not answered anywhere.
                    *
                    * The screen was a table form and a paginated list of
                    * dropdowns. "Have I seated everyone?" meant scrolling that
                    * list and counting the ones reading "Unassigned" by eye, and
                    * the filter beside it offered the four RSVP states but not
                    * seated/unseated — so the question could not even be asked.
                    *
                    * It also states that the map is the SAME chart. Two surfaces
                    * both create tables and both assign guests, and nothing said
                    * whether they were two views or two tools; an organizer who
                    * assigned here had no way to know the map already agreed.
                    */}
                  <SeatingProgress
                    rsvps={rsvps}
                    tables={tables}
                    onShowUnseated={() => { setFilterResponse('unseated'); setSearchQuery(''); }}
                    eventId={eventId}
                  />

                  <div className="seating-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '24px' }}>
                    <TableForm tables={tables} newTableName={newTableName} setNewTableName={setNewTableName} newTableCapacity={newTableCapacity} setNewTableCapacity={setNewTableCapacity} onCreateTable={handleCreateTable} onUpdateTable={handleUpdateTable} />
                    <ErrorBoundary><SeatingManager rsvps={rsvps} tables={tables} searchQuery={searchQuery} setSearchQuery={setSearchQuery} filterResponse={filterResponse} setFilterResponse={setFilterResponse} onAssignTable={handleAssignTable} /></ErrorBoundary>
                  </div>
                </>
              </div>
            </FeatureGate>
          ) : (
            /* ═══ OVERVIEW TAB (default) ═══ */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
              <ErrorBoundary>
                <OrganizerOverview onNavigateToReferrals={() => setActiveTab('referrals')} />
              </ErrorBoundary>
            </div>
          )}
        </div>
      </main>

      {/* ═══ MODALS ═══ */}
      <ImportGuestsModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        eventId={eventId}
        event={activeEvent}
        // Only so its downloadable template fills its examples with this event's
        // real tables and meal options — identical to the one Guest list offers.
        tables={tables}
        customFields={customFields}
        onImportComplete={loadDashboardData}
      />
      {/* ═══ QR CODE MODAL ═══ */}
      {showQRModal && activeEvent && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(25,27,30,0.6)', backdropFilter: 'blur(6px)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ position: 'relative', background: COLORS.white, border: `1px solid ${COLORS.border}`, width: '100%', maxWidth: 420, borderRadius: 16, padding: 24, boxShadow: '0 8px 40px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', textAlign: 'center' }}>

            <button
              onClick={() => setShowQRModal(false)}
              aria-label="Close"
              style={{
                position: 'absolute', top: 12, right: 12,
                width: '32px', height: '32px', borderRadius: '8px', border: 'none', background: COLORS.softBg,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: COLORS.stone, transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#EDE8DD'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = COLORS.softBg; }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            {/* Modal Tabs */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', background: COLORS.softBg, padding: '4px', borderRadius: '8px', width: '100%', boxSizing: 'border-box' }}>
              <button
                type="button"
                onClick={() => setQrModalTab('qr')}
                style={{
                  flex: 1,
                  padding: '8px 12px', minHeight: 'var(--fx-touch)',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: 'none',
                  background: qrModalTab === 'qr' ? COLORS.white : 'transparent',
                  color: qrModalTab === 'qr' ? COLORS.charcoal : COLORS.stone,
                  fontFamily: 'var(--font-sans)',
                  transition: 'all 0.2s',
                  boxShadow: qrModalTab === 'qr' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none'
                }}
              >
                QR Code Only
              </button>
              <button
                type="button"
                onClick={() => setQrModalTab('card')}
                style={{
                  flex: 1,
                  padding: '8px 12px', minHeight: 'var(--fx-touch)',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  border: 'none',
                  background: qrModalTab === 'card' ? COLORS.white : 'transparent',
                  color: qrModalTab === 'card' ? COLORS.charcoal : COLORS.stone,
                  fontFamily: 'var(--font-sans)',
                  transition: 'all 0.2s',
                  boxShadow: qrModalTab === 'card' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none'
                }}
              >
                Invitation Card
              </button>
            </div>

            {qrModalTab === 'qr' ? (
              <>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: COLORS.charcoal, fontFamily: 'var(--font-serif)', margin: 0 }}>Event QR Code</h3>
                <p style={{ fontSize: 12, color: COLORS.stone, margin: '0 0 8px 0', fontFamily: 'var(--font-sans)', lineHeight: 1.5 }}>
                  Scan this code to go directly to the RSVP page of your event
                </p>
                
                <QRCodeDisplay url={`${window.location.origin}/${activeEvent.slug}`} size={200} />
                
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, width: '100%', marginTop: 8 }}>
                  <button
                    onClick={async () => {
                      try {
                        const dataUrl = await QRCode.toDataURL(`${window.location.origin}/${activeEvent.slug}`, { width: 500 });
                        const res = await fetch(dataUrl);
                        const blob = await res.blob();
                        const url = window.URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = `${activeEvent.slug}-qrcode.png`;
                        link.click();
                        window.URL.revokeObjectURL(url);
                      } catch (err) {
                        toast.error('Failed to download QR code. Please try again.');
                      }
                    }}
                    style={{ flex: 1, padding: '10px', background: COLORS.gold, color: COLORS.white, fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 8, cursor: 'pointer', transition: 'all 0.2s', fontFamily: 'var(--font-sans)' }}
                    onMouseEnter={e => { e.currentTarget.style.background = COLORS.goldHover; }}
                    onMouseLeave={e => { e.currentTarget.style.background = COLORS.gold; }}
                  >
                    Download PNG
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const svgString = await QRCode.toString(`${window.location.origin}/${activeEvent.slug}`, { type: 'svg', width: 500 });
                        const blob = new Blob([svgString], { type: 'image/svg+xml' });
                        const url = window.URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = `${activeEvent.slug}-qrcode.svg`;
                        link.click();
                        window.URL.revokeObjectURL(url);
                      } catch (err) {
                        toast.error('Failed to download QR code. Please try again.');
                      }
                    }}
                    style={{ flex: 1, padding: '10px', background: 'transparent', border: `1px solid ${COLORS.border}`, color: COLORS.gold, fontSize: 12, fontWeight: 700, borderRadius: 8, cursor: 'pointer', transition: 'all 0.2s', fontFamily: 'var(--font-sans)' }}
                    onMouseEnter={e => { e.currentTarget.style.background = COLORS.softBg; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    Download SVG
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: COLORS.charcoal, fontFamily: 'var(--font-serif)', margin: 0 }}>Printable Invitation</h3>
                <p style={{ fontSize: 12, color: COLORS.stone, margin: '0 0 8px 0', fontFamily: 'var(--font-sans)', lineHeight: 1.5 }}>
                  Preview of your event&apos;s printable/downloadable invitation card
                </p>
                
                {/* Printable Card Preview */}
                <div style={{
                  width: '100%',
                  background: COLORS.white,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: '12px',
                  overflow: 'hidden',
                  textAlign: 'center',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
                  display: 'flex',
                  flexDirection: 'column',
                  maxHeight: '320px',
                  overflowY: 'auto'
                }}>
                  <div style={{
                    height: '110px',
                    backgroundImage: `url(${sanitizeCoverUrl(activeEvent.cover_image_url)})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    width: '100%'
                  }} />
                  <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                    <h4 style={{ fontSize: '16px', fontWeight: 600, color: COLORS.charcoal, fontFamily: 'var(--font-serif)', margin: 0 }}>
                      {activeEvent.title}
                    </h4>
                    <p style={{ fontSize: '11px', color: COLORS.stone, margin: 0, fontFamily: 'var(--font-sans)', lineHeight: 1.4 }}>
                      <strong>Date:</strong> {formatInZone(activeEvent.event_date, activeEvent.timezone, { year: 'numeric', month: 'long', day: 'numeric' }) || 'N/A'}<br/>
                      <strong>Venue:</strong> {activeEvent.location_name || 'TBA'}
                    </p>
                    <div style={{ background: COLORS.softBg, border: `1px solid ${COLORS.border}`, padding: 8, borderRadius: 8, marginTop: 8 }}>
                      <QRCodeDisplay url={`${window.location.origin}/${activeEvent.slug}`} size={100} />
                    </div>
                    <span style={{ fontSize: 'var(--fx-micro)', textTransform: 'uppercase', letterSpacing: '2px', color: COLORS.gold, fontWeight: 700, marginTop: 4 }}>
                      Scan to RSVP
                    </span>
                  </div>
                </div>

                <div style={{ width: '100%', marginTop: 8 }}>
                  <button
                    onClick={async () => {
                      const printWindow = window.open('', '_blank');
                      const qrDataUrl = await QRCode.toDataURL(`${window.location.origin}/${activeEvent.slug}`, { width: 300 });
                      const coverUrl = sanitizeCoverUrl(activeEvent.cover_image_url);
                      const dateFormatted = formatInZone(activeEvent.event_date, activeEvent.timezone, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) || 'N/A';
                      const timeFormatted = formatInZone(activeEvent.event_date, activeEvent.timezone, { hour: '2-digit', minute: '2-digit' }) || '';

                      const safeTitle = escapeHtml(activeEvent.title);
                      const safeLocationName = escapeHtml(activeEvent.location_name) || 'TBA';
                      const safeLocationAddress = escapeHtml(activeEvent.location_address);
                      const safeDateFormatted = escapeHtml(dateFormatted);
                      const safeTimeFormatted = escapeHtml(timeFormatted);

                      printWindow.document.write(`
                        <html>
                          <head>
                            <title>Print Invitation Card - ${safeTitle}</title>
                            <style>
                              body {
                                font-family: sans-serif;
                                display: flex;
                                justify-content: center;
                                align-items: center;
                                min-height: 100vh;
                                margin: 0;
                                background-color: #fafafa;
                              }
                              .card {
                                width: 420px;
                                background: #ffffff;
                                border: 1px solid #e8e2d6;
                                border-radius: 16px;
                                overflow: hidden;
                                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
                                text-align: center;
                                padding-bottom: 24px;
                              }
                              .cover {
                                width: 100%;
                                height: 200px;
                                background-image: url('${coverUrl}');
                                background-size: cover;
                                background-position: center;
                              }
                              .content {
                                padding: 24px;
                              }
                              .title {
                                font-family: serif;
                                font-size: 24px;
                                margin: 0 0 12px 0;
                                color: #191b1e;
                              }
                              .details {
                                font-size: 13px;
                                color: #77736a;
                                margin: 6px 0;
                                line-height: 1.5;
                              }
                              .qr-container {
                                margin: 20px 0;
                                display: inline-block;
                                padding: 12px;
                                background: #fafaf8;
                                border: 1px solid #e8e2d6;
                                border-radius: 12px;
                              }
                              .qr-image {
                                width: 150px;
                                height: 150px;
                                display: block;
                              }
                              .scan-text {
                                font-size: 11px;
                                text-transform: uppercase;
                                letter-spacing: 2px;
                                color: #b8944f;
                                font-weight: bold;
                                margin-top: 8px;
                              }
                              @media print {
                                body {
                                  background: none;
                                }
                                .card {
                                  box-shadow: none;
                                  border: none;
                                }
                              }
                            </style>
                          </head>
                          <body>
                            <div class="card">
                              <div class="cover"></div>
                              <div class="content">
                                <h1 class="title">${safeTitle}</h1>
                                <p class="details"><strong>Date:</strong> ${safeDateFormatted} at ${safeTimeFormatted}</p>
                                <p class="details"><strong>Venue:</strong> ${safeLocationName}</p>
                                <p class="details">${safeLocationAddress}</p>
                                <div class="qr-container">
                                  <img class="qr-image" src="${qrDataUrl}" alt="RSVP QR Code" />
                                </div>
                                <div class="scan-text">Scan to RSVP</div>
                              </div>
                            </div>
                            <script>
                              window.onload = function() {
                                window.print();
                              }
                            </script>
                          </body>
                        </html>
                      `);
                      printWindow.document.close();
                    }}
                    style={{ width: '100%', padding: '10px', background: COLORS.gold, color: COLORS.white, fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 8, cursor: 'pointer', transition: 'all 0.2s', fontFamily: 'var(--font-sans)' }}
                    onMouseEnter={e => { e.currentTarget.style.background = COLORS.goldHover; }}
                    onMouseLeave={e => { e.currentTarget.style.background = COLORS.gold; }}
                  >
                    Print / Save as PDF
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* The sidebar, drawer and bottom-bar rules that used to live here are gone
          with the markup they styled — it now renders from the layout, where a
          styled-jsx rule written in THIS function could never have reached it
          (AGENTS.md, failure mode 3). They live in globals.css as `.dnav-*`,
          including the 240px content offset that was the "main" margin-left. */}
      <style jsx>{`
        @media (max-width: 1023.98px) {
          /* Was padding-left:72px to dodge the old floating hamburger; that button
             is gone, so the header title gets the full width back. */
          .top-bar { padding-left: 16px !important; padding-right: 16px !important; }
          /* The horizontal half of this moved to .fx-gutter--lg in globals.css.
             It was "--fx-pad-x: 16px" right here, which did nothing at all: the
             same property was set INLINE on the element at 32px, and a class
             never beats an inline declaration — custom properties included. So
             the phone kept the desktop gutter. Only the vertical padding is left
             here, and it still needs !important because that half really is
             inline. */
          .content-container {
            padding-top: 16px !important;
            padding-bottom: 16px !important;
          }
          .action-btn-divider { display: none !important; }
        }
        @media (max-width: 1023.98px) {
          .seating-form-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
