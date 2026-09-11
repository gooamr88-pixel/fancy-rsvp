'use client';

import React, { useCallback, useContext, useRef, useEffect } from 'react';

/* ═══════════════════════════════════════════════════════════════
   FANCY RSVP — Guest Analytics Hook
   Tracks guest engagement events (page views, RSVP funnel, actions)
   ═══════════════════════════════════════════════════════════════ */

/**
 * Generates or retrieves a persistent session ID for this browser tab.
 */
function getSessionId() {
  if (typeof window === 'undefined') return null;
  let sessionId = sessionStorage.getItem('fancy_session_id');
  if (!sessionId) {
    sessionId = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    sessionStorage.setItem('fancy_session_id', sessionId);
  }
  return sessionId;
}

/**
 * Custom hook for tracking guest engagement analytics.
 *
 * @param {string} slug - The event slug
 * @returns {{ trackEvent: (eventType: string, metadata?: object) => void }}
 *
 * Usage:
 *   const { trackEvent } = useGuestAnalytics(slug);
 *   trackEvent('page_view');
 *   trackEvent('rsvp_started');
 *   trackEvent('calendar_added', { provider: 'google' });
 */
export function useGuestAnalytics(slug) {
  const sentEventsRef = useRef(new Set());
  const sessionId = typeof window !== 'undefined' ? getSessionId() : null;

  const trackEvent = useCallback((eventType, metadata = {}) => {
    if (!slug || slug === 'demo-wedding' || slug === 'demo') return;
    if (typeof window === 'undefined') return;

    // Deduplicate page_view (only send once per session)
    if (eventType === 'page_view') {
      const key = `${slug}:${eventType}`;
      if (sentEventsRef.current.has(key)) return;
      sentEventsRef.current.add(key);
    }

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
    const body = {
      eventType,
      sessionId,
      metadata,
      referrer: document.referrer || null,
    };

    // Fire-and-forget — never let analytics block the guest experience
    try {
      if (navigator.sendBeacon) {
        // Use sendBeacon for reliability (works even on page unload)
        const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
        navigator.sendBeacon(`${apiUrl}/public/events/${slug}/analytics`, blob);
      } else {
        fetch(`${apiUrl}/public/events/${slug}/analytics`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          keepalive: true,
        }).catch(() => {}); // Silently ignore errors
      }
    } catch {
      // Never throw from analytics
    }
  }, [slug, sessionId]);

  return { trackEvent, sessionId };
}

/* ═══════════════════════════════════════════════════════════════
   ENGAGEMENT ACTIONS — what a guest chose to DO on the invitation
   ═══════════════════════════════════════════════════════════════

   The dashboard's "What guests did" card and the "Other interactions" line on
   its timeline both read these seven types. All seven were whitelisted by the
   backend, labelled on the analytics page and populated in the marketing demo's
   fixture — and NOT ONE of them was ever sent by the real guest app. Every
   handler existed (the calendar menu, the share button, the gallery lightbox,
   the music toggle, the pass download, the seat lookup); none of them told
   anybody. So that card read "No extra interactions recorded yet" on every
   event forever, and the timeline's third panel was a flat zero line.

   The buttons that do these things are shared leaf components — GuestUI's
   CalendarButton and ShareButton are rendered from several templates and from
   both RSVP screens — and none of them are handed a slug or a tracker. Rather
   than thread a `trackEvent` prop through every template that renders one, the
   guest page publishes its tracker here and the leaves read it.

   The context is OPTIONAL by design. These components are also rendered by the
   organizer's preview and by the marketing demo, where there is no provider and
   nothing should be recorded; `useTrackGuestAction` hands those a no-op rather
   than making every call site check. */
const GuestAnalyticsContext = React.createContext(null);

/**
 * Publishes a guest page's `trackEvent` to the shared action buttons below it.
 * `value` should be the `trackEvent` from `useGuestAnalytics(slug)`.
 */
export function GuestAnalyticsProvider({ trackEvent, children }) {
  return React.createElement(GuestAnalyticsContext.Provider, { value: trackEvent || null }, children);
}

const NO_TRACKING = () => {};

/**
 * The tracker for a shared guest component. Always returns a callable, so a
 * component rendered outside a guest page (preview, demo, a test harness) needs
 * no special case.
 */
export function useTrackGuestAction() {
  return useContext(GuestAnalyticsContext) || NO_TRACKING;
}

/**
 * The organizer's RSVP funnel, in order. The dashboard reads these five back as
 * "Name Entered / Attendance Selected / Details Filled / Custom questions /
 * RSVP Completed" and computes each step's drop-off from the one above it.
 */
const RSVP_FUNNEL_SEQUENCE = [
  'rsvp_step_1', 'rsvp_step_2', 'rsvp_step_3', 'rsvp_step_4', 'rsvp_completed',
];

/**
 * Has the guest actually answered any custom question?
 *
 * Shared by both RSVP screens so "reached the questions step" means the same
 * thing on each — the two paths drifting apart is a running theme in this
 * codebase and the funnel is not a good place for it to happen again.
 *
 * An unticked checkbox is `false` and an untouched select is `''`; neither is an
 * answer. An answered multi-select is an array, and an empty one is not an
 * answer either.
 */
export function hasAnyAnswer(answers) {
  return Object.values(answers || {}).some((v) => {
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'string') return v.trim() !== '';
    return v != null && v !== false;
  });
}

/**
 * Reports how far a guest got through the RSVP form.
 *
 * ── WHY THIS REPLACED A NUMERIC "step" ──
 * The previous hook took a step index and mapped it through a lookup table. Both
 * RSVP screens are single-page forms with no step index to give it, so RsvpWizard
 * synthesised one: `submitted ? 5 : (attending ? 3 : 2)`. That expression cannot
 * produce 1 or 4, so `rsvp_step_1` and `rsvp_step_4` were NEVER SENT by anything,
 * by anyone, ever — and the organizer's funnel showed a 100% cliff at "Name
 * Entered" on every event on the platform. The other screen (RsvpSection, the
 * in-page form every heritageArch event uses) called none of it at all, so
 * `rsvp_completed` never fired there either and the dashboard's "Responses" line
 * was flat zero for guests who replied on the invitation itself.
 *
 * So the signal is named milestones derived from real form state, not a position
 * in a wizard that does not exist.
 *
 * ── MONOTONICITY IS THE POINT ──
 * Reporting a milestone backfills every earlier one that has not fired yet. That
 * is not tidiness: the backend counts each step type independently and computes
 * drop-off as `(previous - current) / previous`. A guest who fills their details
 * without us having recorded a name would make step 3 exceed step 1, and the
 * dashboard would print a NEGATIVE drop-off for a funnel that had gained people.
 * Backfilling guarantees the sequence can only ever descend.
 *
 * It also settles `rsvp_step_4` on events with no custom questions: completing
 * the form backfills it, which is honest — the guest did reach the end of the
 * form; that step was simply empty for them.
 *
 * @param {(type: string, metadata?: object) => void} trackEvent
 * @param {object|null} progress
 *   Booleans for each milestone, highest one wins. Pass null to report nothing —
 *   used for a returning guest looking at a confirmation they submitted on some
 *   earlier visit, who must not be counted as walking the funnel again.
 */
export function useRsvpFunnelProgress(trackEvent, progress) {
  const firedRef = useRef(new Set());

  const {
    nameEntered = false,
    attendanceSelected = false,
    detailsEntered = false,
    questionsAnswered = false,
    completed = false,
  } = progress || {};

  const reached = completed ? 4
    : questionsAnswered ? 3
      : detailsEntered ? 2
        : attendanceSelected ? 1
          : nameEntered ? 0
            : -1;

  useEffect(() => {
    // No reporter (organizer preview passes a no-op, and it may be absent
    // entirely) — return BEFORE marking anything fired, or a later real
    // reporter would find the milestones already crossed off and stay silent.
    if (!trackEvent || reached < 0) return;

    for (let i = 0; i <= reached; i += 1) {
      const eventType = RSVP_FUNNEL_SEQUENCE[i];
      if (firedRef.current.has(eventType)) continue;
      firedRef.current.add(eventType);
      trackEvent(eventType);
    }
  }, [reached, trackEvent]);
}

/**
 * Track page abandonment (when guest leaves without completing RSVP).
 * Uses beforeunload to fire a beacon.
 */
export function useAbandonmentTracking(slug, currentStep, isCompleted) {
  const { trackEvent } = useGuestAnalytics(slug);

  useEffect(() => {
    if (isCompleted || !currentStep || currentStep < 2) return;

    const handleUnload = () => {
      trackEvent('rsvp_abandoned', { lastStep: currentStep });
    };

    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [slug, currentStep, isCompleted, trackEvent]);
}
