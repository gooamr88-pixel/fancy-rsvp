'use client';

import { useCallback, useRef, useState } from 'react';
import { toast } from '../../../utils/toast';

/**
 * useIdempotentRsvpSubmit — the SINGLE submit path for every RSVP surface.
 *
 * Guarantees:
 *  • Double-submit proof: an in-flight ref rejects re-entry even before React
 *    re-renders the disabled button (covers rapid double-clicks / Enter spam).
 *  • Server-side duplicate protection: the backend's response-state lock
 *    (DUPLICATE_RSVP once a party has answered) plus its email/phone
 *    uniqueness constraints are what actually prevent a response from being
 *    recorded twice — there is no client-generated request key the backend
 *    checks, so none is sent.
 *  • Reconciliation: if the network drops the RESPONSE (write may have landed), we
 *    re-read the guest record before declaring failure, and treat a recorded
 *    response as success — no false errors, no duplicate retries.
 *  • Unified error mapping: DUPLICATE_RSVP / ALREADY_RESPONDED → lock;
 *    EMAIL_ALREADY_REGISTERED / PHONE_ALREADY_REGISTERED → a recoverable
 *    CONTACT_REGISTERED state the caller renders beside the field; EVENT_CLOSED
 *    and GUEST_LIMIT_REACHED → professional toast; everything else → toast + retry.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

/** Did a (possibly lost) submit actually record a response for this party? Never throws. */
async function didResponseLand(partyId) {
  if (!partyId) return null;
  try {
    const res = await fetch(`${API_URL}/public/rsvp/guest/${partyId}`);
    if (!res.ok) return null;
    const d = await res.json().catch(() => ({}));
    const g = d?.data?.guest;
    return g && ['yes', 'no', 'maybe'].includes(g.response) ? g : null;
  } catch { return null; }
}

/* ── SIMULATE ────────────────────────────────────────────────────────────
   The marketing demo needs a guest to complete a real RSVP and land on the
   real confirmation screen — celebration, entry pass and all — against an
   event that exists nowhere.

   It is a THIRD mode, deliberately separate from the organizer preview's
   `readOnly`, and the two must never be merged. `readOnly` runs validation
   and then STOPS: the wizard's event has no row on the server yet, so a
   submit there would 404, and a preview that appeared to record a response
   would be lying about the one thing it exists to demonstrate. `simulate`
   goes the other way — it must reach success — and it is safe to do so only
   because nothing it produces is ever sent.

   Implemented here rather than in either form because there are TWO RSVP
   render paths (RsvpSection for the full-page templates, RsvpWizard for the
   legacy scroll layout) and they have drifted apart before. One submit path,
   one flag, no third behaviour to keep in step.

   The delay is not decoration. A submit that resolves in the same frame skips
   the pending state on the button entirely, so the demo would never show the
   thing a real guest sees while they wait. */
const SIMULATED_ROUND_TRIP_MS = 700;

const simulatedSuccess = (body) => ({
  partyId: `demo-party-${Math.random().toString(36).slice(2, 10)}`,
  response: body?.response || 'yes',
  /* A plain opaque string. The entry pass draws its QR client-side with the
     `qrcode` package from whatever it is handed — there is no signature to
     forge and no image to fetch, which is the only reason a fabricated pass
     is honest rather than a picture of one. */
  qrToken: `demo-${Math.random().toString(36).slice(2, 12)}`,
  simulated: true,
});

export function useIdempotentRsvpSubmit({ onSuccess, onLocked, messages = {}, simulate = false } = {}) {
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  const submit = useCallback(async ({ url, body, reconcileId }) => {
    // Hard re-entry guard — independent of the disabled-button render cycle.
    if (inFlight.current) return { ok: false, reason: 'IN_FLIGHT' };
    inFlight.current = true;
    setSubmitting(true);

    if (simulate) {
      try {
        await new Promise((resolve) => { setTimeout(resolve, SIMULATED_ROUND_TRIP_MS); });
        const payload = simulatedSuccess(body);
        onSuccess?.(payload);
        return { ok: true, simulated: true, data: payload };
      } finally {
        inFlight.current = false;
        setSubmitting(false);
      }
    }

    try {
      const res = await fetch(`${API_URL}${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data.error === 'DUPLICATE_RSVP' || data.error === 'ALREADY_RESPONDED') {
          onLocked?.(data);
          return { ok: false, reason: 'LOCKED', data };
        }
        // The address (or number) already belongs to a party that has answered.
        // Deliberately NOT routed through onLocked: that is a terminal state
        // ("you have already responded", form gone), and this one is
        // recoverable — the guest either fixes a typo, or asks for a link to be
        // emailed to that address and comes back through it. No toast either:
        // it belongs beside the field it is about, with the action attached.
        if (data.error === 'EMAIL_ALREADY_REGISTERED' || data.error === 'PHONE_ALREADY_REGISTERED') {
          return {
            ok: false,
            reason: 'CONTACT_REGISTERED',
            field: data.error === 'EMAIL_ALREADY_REGISTERED' ? 'email' : 'phone',
            // Whether the host allows a guest to change an answered RSVP at all,
            // which decides between offering "That's me" and pointing them at
            // the host. Resolved server-side; never guessed here.
            canUpdate: !!data.meta?.canUpdate,
            data,
          };
        }
        if (data.error === 'EVENT_CLOSED') {
          toast.error(messages.closed || 'This event is no longer accepting RSVPs.');
          return { ok: false, reason: 'EVENT_CLOSED', data };
        }
        if (data.error === 'GUEST_LIMIT_REACHED') {
          toast.error(messages.full || 'This event has reached its guest limit. Please contact the host.');
          return { ok: false, reason: 'GUEST_LIMIT_REACHED', data };
        }
        // A 4xx here means the server rejected the payload outright (e.g. a
        // required custom question, a too-large party) — nothing was written,
        // so there's no point reconciling. Show the server's actual reason
        // instead of falling through to the generic network-failure toast.
        if (res.status >= 400 && res.status < 500) {
          toast.error(data.message || messages.failed || 'We couldn’t save your RSVP. Please check the form and try again.');
          return { ok: false, reason: data.error || 'VALIDATION_ERROR', data };
        }
        throw new Error(data.message || 'Failed to submit RSVP.');
      }

      const payload = data.data || {};
      onSuccess?.(payload);
      return { ok: true, data: payload };
    } catch (err) {
      // Possible lost-response: reconcile before declaring failure.
      const landed = await didResponseLand(reconcileId);
      if (landed) {
        onSuccess?.({ reconciled: true, partyId: reconcileId, guest: landed, response: landed.response });
        return { ok: true, reconciled: true, data: { partyId: reconcileId, response: landed.response, qrToken: landed.qrToken || null } };
      }
      toast.error(messages.failed || 'We couldn’t save your RSVP. Please check your connection and try again.');
      return { ok: false, reason: 'NETWORK', error: err };
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }, [onSuccess, onLocked, messages.closed, messages.full, messages.failed, simulate]);

  return { submit, submitting };
}
