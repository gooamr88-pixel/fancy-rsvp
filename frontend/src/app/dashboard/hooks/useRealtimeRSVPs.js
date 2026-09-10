import { useEffect, useRef } from 'react';
import { apiFetch } from '../../utils/apiClient';

/**
 * Keeps the organizer dashboard's RSVP data fresh.
 *
 * ── HISTORY, BECAUSE IT EXPLAINS THE SHAPE ──
 *
 * This originally subscribed to Supabase `postgres_changes` on the `rsvps` table
 * with the public anon key. That only worked because RLS exposed every active
 * event's RSVPs to the `public` role — the exact misconfiguration that leaked
 * guest PII (migration 20260615400000_rls_pii_lockdown.sql). When anon lost
 * table access, the subscription was replaced with a 20-second poll.
 *
 * The poll was correct and extremely expensive. It called the consumer's
 * `loadDashboardData()`, which fetches /stats, /tables, /fields, /auth/profile
 * AND `fetchAllRsvps` — every page of `get_event_parties`, each party carrying
 * its guests, custom answers, seating assignments and invitations. Three times a
 * minute. Per open tab. Forever.
 *
 * For a 500-guest event that is five paged requests of heavy nested JSON every
 * twenty seconds, to answer a question whose answer is almost always "nothing
 * changed". A dashboard left open for a working day made ~1,440 of them.
 * pg_stat_statements made `get_event_parties` the heaviest application
 * statement on the database — 277,464 ms over 14,476 calls — and on 2026-09-10
 * this project's services were restricted by Supabase for exceeding its egress
 * allowance.
 *
 * ── WHAT IT DOES NOW ──
 *
 * It polls a FINGERPRINT: `GET /events/:id/rsvps/version` returns
 * `{ count, latest }` — how many parties there are and when one last changed.
 * About eighty bytes. The expensive refetch happens only when one of those two
 * values actually moves.
 *
 * The user-visible behaviour is unchanged: new responses still appear within
 * twenty seconds, and the consumer still receives the same `{ eventType:
 * 'REFRESH' }` payload it always did. What changed is that the dashboard stops
 * paying for the answer when the answer is "no".
 */
const POLL_INTERVAL_MS = 20000;

export function useRealtimeRSVPs(eventId, onRefresh) {
  const callbackRef = useRef(onRefresh);

  /**
   * The last fingerprint we saw. A ref, not state: changing it must never
   * re-render, and the effect below must not re-subscribe when it moves.
   */
  const seenRef = useRef(null);

  // Sync callback reference on every render
  useEffect(() => {
    callbackRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (!eventId) return;

    let cancelled = false;

    /**
     * A poll in flight when the next tick fires would otherwise stack up on a
     * slow connection — and each one that resolves late could trigger a refetch
     * for a change an earlier one already reported.
     */
    let inFlight = false;

    // Reset when the organizer switches events: the previous event's
    // fingerprint says nothing about this one, and comparing across them would
    // either fire a spurious refresh or suppress a real one.
    seenRef.current = null;

    const check = async () => {
      if (cancelled || document.hidden || inFlight) return;
      inFlight = true;
      try {
        const res = await apiFetch(`/events/${eventId}/rsvps/version`);
        if (cancelled || !res?.success) return;

        const { count, latest } = res.data || {};
        const fingerprint = `${count}|${latest}`;

        // First poll after mount establishes the baseline. The consumer has
        // just loaded the list itself, so refreshing here would be an immediate
        // duplicate of the fetch that is still settling.
        if (seenRef.current === null) {
          seenRef.current = fingerprint;
          return;
        }

        // Inequality, not ordering: a DELETION lowers both numbers, and a
        // comparison for "newer" would miss it entirely.
        if (fingerprint !== seenRef.current) {
          seenRef.current = fingerprint;
          callbackRef.current?.({ eventType: 'REFRESH', eventId });
        }
      } catch {
        // A failed version check must not surface anything: this runs silently
        // in the background every 20 seconds, and a toast per network blip
        // would be worse than a slightly stale list.
      } finally {
        inFlight = false;
      }
    };

    const interval = setInterval(check, POLL_INTERVAL_MS);

    /**
     * Returning to the tab forces a FULL refresh rather than a version check.
     *
     * Time has passed that we did not observe — the interval is paused while
     * hidden — and the organizer is looking at the screen right now. This is the
     * one moment where paying for a refetch unconditionally is the right trade.
     */
    const handleVisibility = () => {
      if (!document.hidden && !cancelled) {
        seenRef.current = null;
        callbackRef.current?.({ eventType: 'REFRESH', eventId });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [eventId]);
}
