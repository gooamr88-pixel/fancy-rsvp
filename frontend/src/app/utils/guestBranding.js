/**
 * WHITE LABEL, on the guest-facing surfaces this app renders itself.
 *
 * The backend strips our marks from the invitation page's watermark, the entry
 * pass and every event email. These are the four places the FRONTEND decides
 * branding on its own, and they are easy to miss because none of them is a
 * visible element on the page:
 *
 *   • the share preview (Open Graph title + siteName) — what WhatsApp and
 *     iMessage render when the host sends the link, which is the FIRST thing
 *     every guest sees, before the unbranded page they paid for even loads;
 *   • the browser tab, set server-side and then again on hydration;
 *   • the JSON-LD organizer, which search engines and preview builders read;
 *   • the .ics file a guest downloads to their calendar.
 *
 * One helper rather than `!!event?.tier_white_label` written out in four files:
 * this is a paid entitlement, and four copies of a condition is three chances
 * to strip the branding from a surface without stripping it from the others —
 * which reads to the customer as the feature not working at all.
 *
 * `tier_white_label` is a column on the event (migration 20260830000003),
 * snapshotted at purchase, so it survives the plan being renamed or deleted and
 * needs no config lookup. Missing or undefined reads as NOT white-labelled: the
 * mark stays on until the entitlement is certain.
 */

/** Has this event bought white-label branding? */
export function isWhiteLabel(event) {
  return !!event?.tier_white_label;
}

/**
 * A document/preview title for a guest surface.
 *
 * @param {object} event
 * @param {string} [prefix]  e.g. 'RSVP - ' on the wizard
 */
export function guestTitle(event, prefix = '') {
  const name = event?.title || 'Event';
  return isWhiteLabel(event) ? `${prefix}${name}` : `${prefix}${name} | Fancy RSVP`;
}
