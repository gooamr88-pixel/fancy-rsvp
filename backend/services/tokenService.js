/**
 * Single source of truth for every signed JWT the guest experience hands
 * out: email-invitation links, the generic "manage my RSVP" link, and QR
 * check-in tickets. Previously these lived in two separate files
 * (rsvpToken.js, qrHelper.js) that both signed with the SAME secret but only
 * one of them actually checked a `purpose` claim on verify — the QR-ticket
 * verifier accepted ANY token signed with that secret, regardless of what it
 * was originally issued for. Every purpose is now signed AND verified
 * against an explicit discriminator, closing that gap structurally instead
 * of relying on field-name mismatches to fail closed by accident.
 */
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.QR_JWT_SECRET;
if (!JWT_SECRET) throw new Error('FATAL: QR_JWT_SECRET environment variable is required');

const PURPOSES = {
  RSVP_INVITE: 'rsvp_invite',
  QR_TICKET: 'qr_ticket',
  RSVP_CLAIM: 'rsvp_claim',
  /**
   * The two links in the post-event data-deletion warning. Both are addressed to
   * the ORGANIZER, both arrive by email, and both are deliberately separate
   * purposes rather than one "event admin" token.
   *
   * They authorize very different things — one reads the entire guest list,
   * the other cancels a scheduled deletion — and this file's whole design is
   * one discriminator per capability, so a token minted to download an archive
   * can never be replayed to keep the event alive, or the reverse.
   */
  EVENT_ARCHIVE: 'event_archive',
  EVENT_KEEP: 'event_keep',
};

// Canonical human-facing verbs an invitation button may carry. mapIntentToResponse()
// converts them to the DB `response` enum value.
const VALID_INTENTS = ['accepted', 'declined', 'maybe'];

/** Maps an invitation intent (or any already-stored response) to the DB response value. */
function mapIntentToResponse(intent) {
  switch (String(intent || '').toLowerCase().trim()) {
    case 'accepted':
    case 'yes':
    case 'attending':
      return 'yes';
    case 'declined':
    case 'no':
    case 'not attending':
      return 'no';
    case 'maybe':
      return 'maybe';
    default:
      return null;
  }
}

function sign(purpose, payload, { expiresIn = '90d' } = {}) {
  if (!Object.values(PURPOSES).includes(purpose)) throw new Error(`Unknown token purpose: ${purpose}`);
  return jwt.sign({ ...payload, purpose }, JWT_SECRET, { expiresIn, algorithm: 'HS256' });
}

function verify(token, expectedPurpose) {
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    throw new Error('INVALID_TOKEN');
  }
  if (!decoded || decoded.purpose !== expectedPurpose) {
    throw new Error('INVALID_TOKEN');
  }
  return decoded;
}

/**
 * Per-party, per-response invitation link. `response` omitted signs a generic
 * "manage my RSVP" link that lets the guest choose on the landing page.
 * No expiry tied to a single click — valid until the event's RSVP window
 * closes (enforced server-side against the party/event, not the token), so a
 * guest can revisit the same email link to change their mind.
 */
function signRsvpInvite({ partyId, eventId, response }) {
  if (!partyId || !eventId) throw new Error('partyId and eventId are required');
  const payload = { partyId, eventId };
  if (response) payload.response = response;
  // Token expires in 30 days — enforced by jwt.verify() in verifyRsvpInvite.
  // Guests can revisit the same email link to change their mind within this window.
  return sign(PURPOSES.RSVP_INVITE, payload, { expiresIn: '30d' });
}

function verifyRsvpInvite(token) {
  const decoded = verify(token, PURPOSES.RSVP_INVITE);
  if (!decoded.partyId || !decoded.eventId) throw new Error('INVALID_TOKEN');
  return decoded;
}

/**
 * Proves the person holding this token can read the mail sent to a party's
 * primary contact address — the only evidence we have that they are that guest.
 *
 * Issued by POST /public/events/:slug/rsvp/claim and emailed to the address on
 * file, never returned in an API response. It replaces the earlier "That's me —
 * update my response" button, which merged into an already-answered party on a
 * click alone: explicit, but not authenticated.
 *
 * SHORT-LIVED, NOT SINGLE-USE. 30 minutes, and replayable within that window by
 * whoever holds the mail. Making it genuinely one-shot needs a `used_at` record
 * and would break the ordinary "opened the link, got interrupted, came back"
 * case; the exposure is a half-hour window on an inbox the guest already
 * controls, which does not warrant either cost.
 *
 * Its own purpose rather than a short-expiry signRsvpInvite: this file's whole
 * design is one explicit discriminator per capability, so that a token minted
 * for one thing can never be replayed as another.
 */
function signRsvpClaim({ partyId, eventId }) {
  if (!partyId || !eventId) throw new Error('partyId and eventId are required');
  return sign(PURPOSES.RSVP_CLAIM, { partyId, eventId }, { expiresIn: '30m' });
}

function verifyRsvpClaim(token) {
  const decoded = verify(token, PURPOSES.RSVP_CLAIM);
  if (!decoded.partyId || !decoded.eventId) throw new Error('INVALID_TOKEN');
  return decoded;
}

/**
 * QR check-in ticket for one PARTY (the whole group checks in together via
 * one scan; the underlying check_ins rows stay per-individual-guest for
 * fine-grained arrival tracking — see checkinController.scanCheckIn).
 * Expiry tracks the event date (+1 day buffer) so the ticket stays valid
 * through the event but not indefinitely; falls back to 30 days if the
 * event date is missing or already past.
 */
function signQrTicket({ partyId, eventId, tableName, partySize, eventDate }) {
  if (!partyId || !eventId) throw new Error('partyId and eventId are required');
  let expiresIn = '30d';
  if (eventDate) {
    const expiryMs = (new Date(eventDate).getTime() + 24 * 60 * 60 * 1000) - Date.now();
    if (expiryMs > 0) expiresIn = Math.ceil(expiryMs / 1000);
  }
  return sign(PURPOSES.QR_TICKET, { partyId, eventId, tableName, partySize }, { expiresIn });
}

function verifyQrTicket(token) {
  const decoded = verify(token, PURPOSES.QR_TICKET);
  if (!decoded.partyId || !decoded.eventId) throw new Error('INVALID_TOKEN');
  return decoded;
}

/**
 * Mints a QR ticket for a party as soon as they're a confirmed "yes" —
 * deliberately NOT gated on a seating assignment existing. checkinController's
 * scanCheckIn re-queries the live table assignment at scan time rather than
 * trusting the token's tableName (see checkinController.js), so a ticket
 * signed before seating is finalized is fully valid at the door; the table
 * just reads "Unassigned" until the organizer seats them. Returns null for
 * "maybe"/"no" — there's nothing to check in for an unconfirmed guest.
 *
 * Deliberately swallows its own errors: every caller sits inside an RSVP
 * read/write that has ALREADY succeeded (the party's response is recorded
 * either way), so a ticket-signing hiccup must never turn an otherwise-
 * successful RSVP into a 500 for the guest. Worst case they see the existing
 * "sent separately" placeholder instead of an immediate pass — never a
 * failed request for something that actually worked.
 */
function signQrTicketForResponse({ response, partyId, eventId, tableName, partySize, eventDate }) {
  if (response !== 'yes') return null;
  try {
    return signQrTicket({ partyId, eventId, tableName: tableName || null, partySize, eventDate });
  } catch (err) {
    logger.error({ err, partyId, eventId }, 'Failed to mint QR ticket for RSVP response');
    return null;
  }
}

/* ─── Post-event data retention ─────────────────────────────────────────────
 *
 * Both of these are bearer links in an email, so the expiry is the whole
 * security model and it is set from the grace window rather than a constant:
 * a token that outlives the deletion it refers to authorizes a download of
 * data that no longer exists (harmless) or a "keep" of an event already gone
 * (confusing). Matching the window means both links stop working at exactly
 * the moment they stop meaning anything.
 *
 * A generous floor and ceiling are applied because `graceMs` comes from an env
 * variable an operator can set to anything.
 */
const clampGraceSeconds = (graceMs) => {
  const seconds = Math.ceil((Number(graceMs) || 0) / 1000);
  // 1 hour minimum: below that a warning email could arrive with a dead link
  // simply because the mail sat in a queue. 30 days maximum, so a misconfigured
  // grace window cannot mint a near-permanent credential.
  return Math.min(30 * 24 * 3600, Math.max(3600, seconds));
};

/** Download-everything link. Read-only: it can produce the archive and nothing else. */
function signEventArchive({ eventId, graceMs }) {
  if (!eventId) throw new Error('eventId is required');
  return sign(PURPOSES.EVENT_ARCHIVE, { eventId }, { expiresIn: clampGraceSeconds(graceMs) });
}

function verifyEventArchive(token) {
  const decoded = verify(token, PURPOSES.EVENT_ARCHIVE);
  if (!decoded.eventId) throw new Error('INVALID_TOKEN');
  return decoded;
}

/** "Keep this event's data" link. Cancels the scheduled deletion, nothing else. */
function signEventKeep({ eventId, graceMs }) {
  if (!eventId) throw new Error('eventId is required');
  return sign(PURPOSES.EVENT_KEEP, { eventId }, { expiresIn: clampGraceSeconds(graceMs) });
}

function verifyEventKeep(token) {
  const decoded = verify(token, PURPOSES.EVENT_KEEP);
  if (!decoded.eventId) throw new Error('INVALID_TOKEN');
  return decoded;
}

module.exports = {
  PURPOSES,
  VALID_INTENTS,
  signEventArchive,
  verifyEventArchive,
  signEventKeep,
  verifyEventKeep,
  mapIntentToResponse,
  signRsvpInvite,
  verifyRsvpInvite,
  signRsvpClaim,
  verifyRsvpClaim,
  signQrTicket,
  verifyQrTicket,
  signQrTicketForResponse,
};
