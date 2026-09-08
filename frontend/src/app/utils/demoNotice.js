import { toast } from './toast';

/* ═══════════════════════════════════════════════════════════════════════════
   ONE SENTENCE FOR EVERY DOOR THE DEMO KEEPS SHUT.

   The marketing demo (/demo) mounts the organizer's real screens against a
   sample event that exists nowhere, so the controls that send, delete or
   download have nothing to act on. Three ways to handle that, and only one
   of them is honest:

     • let them run     — they would fail against the real API with no
                          session, and a red error banner on a demo reads as
                          "this product is broken", which is the single most
                          expensive thing a marketing page can say;
     • do nothing       — a button that visibly does nothing is worse than a
                          disabled one, because the visitor concludes the
                          feature is broken rather than withheld;
     • SAY SO           — which is this.

   Deliberately NOT `toast.error`. Nothing has gone wrong; a red alert would
   report a fault where there is only a boundary.

   It names the action rather than printing a generic refusal, because
   "Sending invitations is switched off in the demo" tells the visitor the
   feature exists and that they are inside a demo, in one line. A bare "Not
   available" tells them neither.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @param {string} action  the thing they tried, capitalised, as a noun phrase
 *                         ("Sending invitations", "Removing a guest")
 */
export function demoBlocked(action) {
  toast(`${action} is switched off in the demo — nothing here is sent, changed or deleted.`, { icon: '👀' });
}
