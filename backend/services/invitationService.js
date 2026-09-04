/**
 * InvitationService — unified delivery + tracking for email and QR-ticket
 * invitations. Writes every attempt to the `invitations` ledger (Phase 1),
 * which replaces the old scattered tracking: invitation_sent/invitation_sent_at/
 * qr_email_sent booleans on rsvps, plus the separate guest_reminders table.
 *
 * SMS campaigns deliberately stay on their own path (campaignController.js +
 * services/smsDispatch.js): that subsystem already has a single, well-tested
 * source of truth for segment-accurate atomic credit billing, sync/async
 * dispatch, and idempotent delivery — re-deriving that here would risk the
 * one part of the old system the audit found to be genuinely solid. The
 * unified `POST /events/:eventId/invitations/send` route normalizes the
 * *response shape* across channels; for `channel: 'sms'` it forwards to the
 * existing campaign dispatcher rather than reimplementing billing.
 */
const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const tokenService = require('./tokenService');
const notificationService = require('../utils/notificationService');
/**
 * `formatEventDate` is imported HERE, at module scope, and that matters.
 *
 * It used to be destructured inside sendInvitationSmsBulk — but buildDetailContext
 * is a module-level function that also calls it, so from there the identifier was
 * simply not in scope: a ReferenceError the first time anyone sent a detail text.
 * `node --check` cannot see it (the syntax is fine) and no test had exercised that
 * path yet, so it sat there looking correct.
 */
const {
  getInvitationTemplate, getQRTicketTemplate,
  buildGuestEventUrl, buildTicketLinks, formatEventDate,
} = require('../utils/emailTemplates');

/** Records one delivery attempt in the unified ledger. */
async function logInvitation({ partyId, eventId, channel, token = null, status, metadata = {} }) {
  const { data, error } = await supabase.from('invitations').insert({
    party_id: partyId,
    event_id: eventId,
    channel,
    token,
    status,
    sent_at: status === 'sent' ? new Date() : null,
    metadata,
  }).select('id').single();
  if (error) {
    logger.error({ err: error }, 'Failed to write invitation ledger row');
    return null;
  }
  return data.id;
}

/** Fetches the event context every channel needs, and confirms it's live. */
async function resolveLiveEvent(eventId) {
  const { data: event, error } = await supabase
    .from('events')
    .select('id, title, event_date, timezone, slug, location_name, location_address, is_paid, status, notification_preferences')
    .eq('id', eventId)
    .single();
  if (error || !event) return { event: null, code: 'EVENT_NOT_FOUND' };
  if (!event.is_paid || event.status !== 'active') {
    return {
      event: null,
      code: 'EVENT_NOT_LIVE',
      message: !event.is_paid
        ? "This event hasn't been paid for yet. Invitations can only be sent once your event is paid and live."
        : `Your event isn't live yet — it's currently "${event.status}". Invitations can only be sent once it becomes active.`,
    };
  }
  return { event };
}

/** Sends one email invitation (single "View Invitation" link to the guest's card) to a party's primary contact. */
async function sendEmailInvite(event, party) {
  if (!party.primaryEmail) return { sent: false, reason: 'NO_EMAIL' };

  // One link straight to the guest's own invitation card (/{slug}?party_id=...) —
  // no vote-by-email buttons. The guest sees the full invitation first and RSVPs
  // from there, same as every other entry point into the event page.
  const viewUrl = buildGuestEventUrl(event.slug, party.id);
  // Still mint a token for the ledger (kept for tracking/resend parity with the
  // other channels) even though it's no longer embedded in the email itself.
  const ledgerToken = tokenService.signRsvpInvite({ partyId: party.id, eventId: event.id, response: undefined });

  const shimParty = { id: party.id, guest_name: party.label, email: party.primaryEmail, party_size: party.partySize };
  const shimEvent = {
    title: event.title, event_date: event.event_date, slug: event.slug,
    location_name: event.location_name, location_address: event.location_address,
  };
  const html = getInvitationTemplate(shimParty, shimEvent, { view: viewUrl });

  const success = await notificationService.sendEmailViaBrevo(party.primaryEmail, `You're Invited: ${event.title}`, html);
  if (!success) {
    await logInvitation({ partyId: party.id, eventId: event.id, channel: 'email', status: 'failed' });
    return { sent: false, reason: 'DELIVERY_FAILED' };
  }
  await logInvitation({ partyId: party.id, eventId: event.id, channel: 'email', token: ledgerToken, status: 'sent' });
  return { sent: true };
}

/**
 * Bulk-sends email invitations. By default targets parties with a primary
 * contact email who haven't already received one (per the invitations
 * ledger); `resend: true` re-sends to everyone with an email; `partyIds`
 * targets specific parties.
 */
async function sendEmailBulk(eventId, { partyIds, resend = false } = {}) {
  const { event, code, message } = await resolveLiveEvent(eventId);
  if (!event) return { code, message };

  const { data: parties, error } = await supabase
    .from('rsvp_parties')
    .select('id, label, guests(is_primary_contact, email)')
    .eq('event_id', eventId)
    .limit(2000);
  if (error) throw error;

  let candidates = (parties || [])
    .map((p) => ({
      id: p.id,
      label: p.label,
      primaryEmail: (p.guests || []).find((g) => g.is_primary_contact)?.email || null,
      partySize: (p.guests || []).length || 1,
    }))
    .filter((p) => !!p.primaryEmail);

  if (Array.isArray(partyIds) && partyIds.length > 0) {
    const want = new Set(partyIds);
    candidates = candidates.filter((p) => want.has(p.id));
  } else if (!resend) {
    const { data: alreadySent } = await supabase
      .from('invitations').select('party_id').eq('event_id', eventId).eq('channel', 'email')
      .in('status', ['sent', 'delivered', 'opened', 'responded']);
    const sentIds = new Set((alreadySent || []).map((i) => i.party_id));
    candidates = candidates.filter((p) => !sentIds.has(p.id));
  }

  if (candidates.length === 0) {
    return { queued: 0, sent: 0, skipped: 0, failed: 0, message: 'No parties with an email address were eligible for an invitation.' };
  }

  let sent = 0, skipped = 0, failed = 0;
  const failures = [];
  const BATCH = 10;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map((p) => sendEmailInvite(event, p)));
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled' && r.value?.sent) sent++;
      else if (r.status === 'fulfilled' && r.value?.reason === 'NO_EMAIL') skipped++;
      else { failed++; failures.push({ partyId: batch[idx].id, reason: r.status === 'fulfilled' ? r.value.reason : String(r.reason) }); }
    });
  }

  await supabase.from('activity_logs').insert({
    event_id: eventId, action: 'invitation_campaign_sent', entity_type: 'campaign',
    metadata: { channel: 'email', total: candidates.length, sent, skipped, failed },
  }).then(() => {}).catch(() => {});

  return { queued: candidates.length, sent, skipped, failed, failures };
}

/**
 * The table this party was last EMAILED, or `undefined` if they have never
 * been sent a pass.
 *
 * Read from the `invitations` ledger, which every pass send writes with
 * `metadata.tableName`. It is what makes a re-send honest: without it the
 * seating sweep cannot tell "this guest has never been told where they sit"
 * from "this guest was told, and then moved", and those need different mail —
 * or, in the third case, no mail at all.
 *
 * `undefined` for "never sent" and `null` for "sent while unseated" are
 * DIFFERENT answers and both are load-bearing, so this must not collapse them
 * with `|| null`.
 */
async function lastEmailedTable(partyId) {
  try {
    const { data } = await supabase
      .from('invitations')
      .select('metadata, sent_at')
      .eq('party_id', partyId)
      .eq('channel', 'qr')
      .eq('status', 'sent')
      .order('sent_at', { ascending: false, nullsFirst: false })
      .limit(1);
    if (!data || data.length === 0) return undefined;
    const t = data[0]?.metadata?.tableName;
    return t === undefined ? null : t;
  } catch {
    // Ledger unreadable: treat it as "never sent". Sending a correct pass one
    // extra time is a far better failure than staying silent about a move.
    return undefined;
  }
}

/**
 * The language this party RSVP'd in, best-effort, defaulting to English.
 *
 * A SEPARATE query rather than a column on the main select, and that is the
 * whole point of it. `rsvp_parties.preferred_lang` arrives in migration
 * 20260821000000, which is part of the SMS chain this deployment has a history
 * of not having applied. PostgREST fails the WHOLE select when one requested
 * column does not exist, so adding it to the party query below would turn a
 * missing column into `PARTY_NOT_FOUND` — and this function is what
 * assignSeat's automatic pass and the organizer's "Resend QR ticket" button
 * both call. An unapplied migration would have stopped entry passes going out
 * at all, on a path that never needed the column before.
 *
 * Isolated here, the worst case is an English email.
 */
async function partyLang(partyId) {
  try {
    const { data, error } = await supabase
      .from('rsvp_parties').select('preferred_lang').eq('id', partyId).maybeSingle();
    if (error || !data) return 'en';
    return data.preferred_lang === 'ar' ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

/**
 * Sends the QR check-in pass for one party.
 *
 * Seating is OPTIONAL. This used to query `seating_assignments` as the ROOT
 * table with `.single()`, so a party the organizer hadn't seated yet threw
 * NO_SEATING_ASSIGNMENT and the organizer's "resend QR ticket" action failed
 * with a 400 — meaning an event with no seating chart at all (a reception, a
 * standing party) could never issue a check-in code to anyone. The door
 * scanner never trusted the token's tableName in the first place
 * (checkinController.scanCheckIn re-reads the live assignment and falls back to
 * "Unassigned"), so an unseated pass has always been valid at the gate; only
 * this send path disagreed. The party row is now the root and the assignment is
 * an optional embed.
 *
 * @param {string} eventId
 * @param {string} partyId
 * @param {{skipIfUnchanged?: boolean, changed?: boolean|null}} [opts]
 *   `skipIfUnchanged` — return without sending when the last pass we emailed
 *   already named this exact table. This is what lets the seating sweep call
 *   this unconditionally: a guest who was seated once and never moved has
 *   already had the immediate email from assignSeat, and must not get a second
 *   copy of it ten minutes later.
 *   `changed` — force the "your table has changed" wording. Left null it is
 *   derived from the ledger, which is what every current caller wants.
 */
async function sendQrTicketEmail(eventId, partyId, opts = {}) {
  const { skipIfUnchanged = false, changed = null } = opts;
  const { data: party, error } = await supabase
    .from('rsvp_parties')
    .select(`
      id, label, response,
      guests(is_primary_contact, email),
      seating_assignments(tables(table_name)),
      events(id, title, event_date, location_name, location_address, location_lat, location_lng)
    `)
    .eq('id', partyId)
    .eq('event_id', eventId)
    .single();

  if (error || !party) throw new Error('PARTY_NOT_FOUND');
  // An entry pass for someone who declined is a mistake, not a courtesy — and
  // the QR would still open the door if they showed up with it.
  if (party.response === 'no') throw new Error('NOT_ATTENDING');

  const primaryEmail = (party.guests || []).find((g) => g.is_primary_contact)?.email || null;
  const partySize = (party.guests || []).length || 1;
  const event = party.events;
  const tableName = (Array.isArray(party.seating_assignments) ? party.seating_assignments[0] : party.seating_assignments)
    ?.tables?.table_name || null;
  // The language the guest actually RSVP'd in. This mail used to be English
  // for everybody, including a guest whose confirmation, reminder and text
  // were all Arabic. See partyLang for why it is not on the select above.
  const lang = await partyLang(partyId);

  if (!primaryEmail) {
    logger.info(`[InvitationService] Party ${party.label} has no email configured. Skipping QR ticket email.`);
    return { sent: false, reason: 'NO_EMAIL' };
  }

  // What we last told them, if anything. Needed for both the skip and the
  // wording, so it is read once here rather than twice below.
  const previousTable = (skipIfUnchanged || changed === null)
    ? await lastEmailedTable(partyId)
    : undefined;

  if (skipIfUnchanged && previousTable !== undefined && previousTable === tableName) {
    return { sent: false, reason: 'UNCHANGED' };
  }

  /**
   * A move is "we have emailed this party before, and it named a different
   * table". A first pass is not a change, and neither is a re-send of the same
   * one (which skipIfUnchanged has already returned on when it applies).
   *
   * `tableName` MUST be non-null for this to be a change, and that guard is
   * load-bearing rather than defensive. A guest who was seated, emailed, and
   * then UNSEATED has `previousTable = 'Table 7'` and `tableName = null`, which
   * satisfies "different" — and the changed template then renders the sentence
   * "Your table is now ." with nothing in it. That is reachable today from the
   * organizer's "Resend QR ticket" button, which passes no options and lets the
   * wording be derived. With no table there is nothing to announce a change TO,
   * and the ordinary pass already has correct wording for it ("Assigned when
   * you arrive").
   */
  const isChange = changed === null
    ? (tableName !== null && previousTable !== undefined && previousTable !== tableName)
    : (!!changed && tableName !== null);

  const token = tokenService.signQrTicket({
    partyId,
    eventId,
    tableName,
    partySize,
    eventDate: event.event_date,
  });

  const links = buildTicketLinks(token);

  // NO SMS IS SENT FROM HERE ANY MORE.
  //
  // This used to fire the `qr_ticket` text alongside the email. That type is gone,
  // absorbed into `seating_reminder`, and — more importantly — the text is no
  // longer sent at the moment of seating at all. It is QUEUED.
  //
  // The reason is cost. Seating fires this function once per guest, and a
  // drag-and-drop session on a 200-guest chart issues one call per drop, so
  // texting inline meant an organizer tidying their layout for twenty minutes
  // spent hundreds of messages and a guest moved four times received four texts,
  // three of them naming the wrong table.
  //
  // seatingController now upserts into seating_notify_queue instead, and
  // emailScheduler.jobSeatingNotices sweeps it after a quiet period and sends once
  // with the final table. The EMAIL below stays immediate — it is free, and it is
  // what actually carries the scannable pass.

  const shimParty = { id: party.id, guest_name: party.label, email: primaryEmail, party_size: partySize };
  // The data model has no table→zone relationship (zones are standalone venue
  // elements in the same `tables` table, not a parent of seatable tables), so a
  // ticket carries no zone label.
  const html = getQRTicketTemplate(shimParty, event, {
    tableName, zoneName: null, links, lang, changed: isChange,
  });

  // The subject line is the only part of a re-send most guests will read in
  // their inbox list, so it has to carry the news rather than repeat the
  // original — two identical subjects read as a duplicate and get skipped.
  const subject = lang === 'ar'
    ? (isChange
      ? `تغيّرت طاولتك – ${event.title}`
      : (tableName ? `بطاقة دخولك وطاولتك – ${event.title}` : `بطاقة دخولك – ${event.title}`))
    : (isChange
      ? `Your table has changed: ${event.title}`
      : (tableName
        ? `Your Entry Pass & Table: ${event.title}`
        : `Your Entry Pass: ${event.title}`));
  const success = await notificationService.sendEmailViaBrevo(primaryEmail, subject, html);
  await logInvitation({
    partyId, eventId, channel: 'qr', token, status: success ? 'sent' : 'failed',
    metadata: { tableName, changed: isChange },
  });
  if (success) {
    await supabase.from('activity_logs').insert({
      event_id: eventId, action: isChange ? 'seating_change_email_sent' : 'qr_email_sent',
      entity_type: 'rsvp_party', entity_id: partyId,
      metadata: { label: party.label, email: primaryEmail, tableName },
    });
  }
  return { sent: success, changed: isChange };
}

/* ─── SMS invitations ──────────────────────────────────────────────────────
 *
 * Concurrency for a manual send. Ten at a time with a short pause between
 * batches keeps a 500-guest send inside a request timeout without presenting the
 * carrier with 500 simultaneous connections, which is how an account gets
 * rate-limited at exactly the wrong moment.
 */
const SMS_BATCH_SIZE = 10;
const SMS_BATCH_PAUSE_MS = 1000;
const MAX_SMS_RECIPIENTS = 5000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Text the invitation to a chosen set of guests.
 *
 * THE ONLY manual SMS path in the platform, and deliberately unlike the campaign
 * blaster it replaces. There is no message body in the request: the organizer
 * chooses WHO, and the platform decides WHAT — a templated invitation, the same
 * shape the email channel sends.
 *
 * That is what makes this safe as an ordinary button rather than something behind
 * an attestation dialog. Free-form text to a resolved audience segment is the
 * pattern that got our toll-free number rejected; a templated invitation to a
 * guest carrying a recorded consent record is precisely what it is registered to
 * carry.
 *
 * Every send still runs the full sendTransactionalSms gate chain — entitlement,
 * the organizer's per-type switch, (kind, ref) idempotency, per-party consent,
 * global STOP suppression, transport availability, atomic billing. Nothing here
 * re-implements any of it.
 *
 * @returns {Promise<{code?:string, message:string, sent?:number, skipped?:number,
 *                    failed?:number, breakdown?:Array}>}
 */
/**
 * The context for the full-detail confirmation text.
 *
 * Everything comes from the committed party row, so what the message says and what
 * the page behind its link shows are derived from the same data. The table is read
 * from the LIVE seating assignment rather than anything cached: between a stored
 * value and the chart, the chart is the one that cannot be stale.
 */
function buildDetailContext(party, event) {
  const members = party.guests || [];
  const companions = members
    .filter((g) => !g.is_primary_contact && g.full_name)
    .map((g) => g.full_name);

  // A tally, not a dish per person. "Beef Steak x2, Fish x1" answers "what did we
  // order" in a fraction of the characters, and characters are segments.
  const tally = {};
  for (const g of members) {
    if (g.meal_selection) tally[g.meal_selection] = (tally[g.meal_selection] || 0) + 1;
  }
  for (const [meal, n] of Object.entries(party.companion_meal_counts || {})) {
    if (meal && Number(n) > 0) tally[meal] = (tally[meal] || 0) + Number(n);
  }
  const meals = Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .map(([meal, n]) => (n > 1 ? `${meal} x${n}` : meal));

  const seat = Array.isArray(party.seating_assignments) ? party.seating_assignments[0] : party.seating_assignments;
  const tableName = seat?.tables?.table_name || null;

  let ticketUrl = null;
  try {
    const token = tokenService.signQrTicketForResponse({
      response: party.response,
      partyId: party.id,
      eventId: event.id,
      tableName,
      partySize: members.length || 1,
      eventDate: event.event_date,
    });
    if (token) ticketUrl = buildTicketLinks(token).ticketUrl;
  } catch {
    // A missing link degrades the message; it must not fail the send.
  }

  return {
    guestName: party.label || 'Guest',
    eventTitle: event.title,
    dateLabel: formatEventDate ? formatEventDate(event.event_date, event.timezone) : null,
    venue: event.location_name || event.location_address || null,
    tableName,
    companions,
    meals,
    ticketUrl,
  };
}

/**
 * EVERY GUEST MESSAGE THE ORGANIZER MAY SEND BY HAND, and what each one needs.
 *
 * This was two `type === 'rsvp_confirmation' ? … : …` ternaries — one deriving a
 * ref prefix, one a noun for the result sentence — plus a third condition
 * deciding who is eligible. Three expressions, in three places, all encoding the
 * same fact about a type. Adding a third type meant finding all three, and the
 * one that would have been missed is `requiresAttending`: forgetting it does not
 * break, it sends a table-and-pass text to somebody who declined.
 *
 * So the fact lives once, here.
 *
 *   refPrefix        — namespaces the idempotency ref. Must be distinct per type
 *                      AND distinct from the automatic path's prefix for the same
 *                      type, or a manual send collides with a scheduled one on
 *                      sms_log's (kind, ref) unique index and is swallowed as a
 *                      duplicate. The automatic prefixes in use are `rsvpconf:`
 *                      and `evday:`; none of these may repeat them.
 *   noun             — how the result sentence names what was sent.
 *   requiresAttending— the message names a table or carries an entry pass, and
 *                      signQrTicketForResponse mints nothing for a maybe or a no.
 *                      Sending anyway produces a message with an empty link in it.
 */
const MANUAL_SMS_TYPES = {
  invitation: { refPrefix: 'inv', noun: 'Invitation', requiresAttending: false },
  rsvp_confirmation: { refPrefix: 'detail', noun: 'Details', requiresAttending: true },
  seating_reminder: { refPrefix: 'seatman', noun: 'Table & entry pass', requiresAttending: true },
  event_update: { refPrefix: 'updman', noun: 'Update', requiresAttending: false },
};

/**
 * @param {object}  [opts]
 * @param {string}  [opts.type='invitation']  any key of MANUAL_SMS_TYPES
 */
async function sendInvitationSmsBulk(eventId, partyIds, { user = null, type = 'invitation' } = {}) {
  const ids = [...new Set(partyIds || [])];

  /**
   * Rejected here as well as at the route validator, and not as belt-and-braces.
   * `sendTransactionalSms` would accept `organizer_report` perfectly happily and
   * resolve its recipient from `organizations.sms_phone` — so a guest-send
   * request naming it would text the ORGANIZER once per selected guest, billing
   * each one. The route is the first door; this is the one that closes when a
   * future caller reaches the service directly.
   */
  const spec = MANUAL_SMS_TYPES[type];
  if (!spec) {
    return { code: 'UNSUPPORTED_TYPE', message: 'That kind of message cannot be sent by hand.' };
  }
  const { refPrefix, noun: what, requiresAttending } = spec;

  if (ids.length === 0) {
    return { code: 'NO_RECIPIENTS', message: 'Choose at least one guest to text.' };
  }
  if (ids.length > MAX_SMS_RECIPIENTS) {
    return {
      code: 'TOO_MANY_RECIPIENTS',
      message: `That is more than ${MAX_SMS_RECIPIENTS} guests in one go. Send it in smaller groups.`,
    };
  }

  const { data: event } = await supabase
    .from('events')
    /**
     * `event_date`, `location_name` and `location_address` are here for the
     * DETAIL type, and leaving them out is a silent content bug rather than a
     * crash — which is how it got shipped.
     *
     * buildDetailContext reads all three: the first for the "on Sat 12 Sep" clause
     * AND for the entry-pass token's expiry (signQrTicket falls back to a flat 30
     * days when eventDate is undefined, so the link still worked and nothing
     * complained), the other two for the venue. Without them the manual "All their
     * details" text sent with no date and no venue — the two facts the message
     * exists to carry — while the automatic path, which loads its own event row,
     * included them. The same button producing a different message depending on who
     * triggered it is exactly the kind of thing a template test does not catch.
     */
    .select('id, title, slug, event_date, timezone, location_name, location_address, sms_addon_purchased_at, sms_settings, sms_templates')
    .eq('id', eventId)
    .single();
  if (!event) return { code: 'EVENT_NOT_FOUND', message: 'That event could not be found.' };
  if (!event.sms_addon_purchased_at) {
    return { code: 'ADDON_INACTIVE', message: 'Text messaging is not active for this event yet.' };
  }

  // The ramp-up cap. Route middleware checks it too; this is the backstop for any
  // caller that reaches the service directly, and being told "50 at a time" AFTER
  // half a list has been charged is far worse than being told before.
  const { resolveSendLimit } = require('../controllers/campaignController');
  const { maxPerSend } = await resolveSendLimit(eventId, user);
  if (maxPerSend > 0 && ids.length > maxPerSend) {
    return {
      code: 'SEND_LIMIT',
      message: `You can text ${maxPerSend} guests at a time for now. This lifts as your event sends more messages — you can still reach everyone, just in a few goes.`,
    };
  }

  /**
   * One query for every recipient rather than one per guest inside the send loop.
   *
   * The column list covers BOTH message types this function can send. Two of them
   * matter for reasons that are easy to miss:
   *   • preferred_lang — a guest who filled the form in Arabic must not get an
   *     English message days later;
   *   • response + guests + seating — the detail text names who is coming and what
   *     they ordered, and reads it from the committed party so the text and the
   *     page it links to can never disagree.
   */
  const { data: parties } = await supabase
    .from('rsvp_parties')
    .select(`
      id, label, preferred_lang, response, companion_meal_counts,
      guests(full_name, is_primary_contact, meal_selection),
      seating_assignments(tables(table_name))
    `)
    .eq('event_id', eventId)
    .in('id', ids);
  const byId = new Map((parties || []).map((p) => [p.id, p]));

  const { sendTransactionalSms } = require('./smsDispatch');
  // The email-template helpers this function needs are all module-level imports
  // now — see the note on that import for why formatEventDate had to move.
  const tokenService = require('./tokenService');
  const { explainSkip } = require('../utils/smsUsage');

  const chunk = (arr, size) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  let sent = 0, skipped = 0, failed = 0, processed = 0;
  const reasons = {};

  for (const group of chunk(ids, SMS_BATCH_SIZE)) {
    const outcomes = await Promise.all(group.map(async (partyId) => {
      const party = byId.get(partyId);
      // An id that is not in this event is not worth failing the whole request
      // for — a stale browser tab holds one very easily.
      if (!party) return { sent: false, reason: 'NOT_FOUND' };

      /**
       * A message naming a table or carrying a pass is only meaningful for a
       * guest who accepted.
       *
       * signQrTicketForResponse mints nothing for a maybe or a no — so without
       * this the message would go out with an empty link slot. Refused here with
       * a reason the organizer can read, rather than sent broken. Which types
       * this covers is declared once in MANUAL_SMS_TYPES.
       */
      if (requiresAttending && party.response !== 'yes') {
        return { sent: false, reason: 'NOT_ATTENDING' };
      }

      /**
       * `seating_reminder` reuses the DETAIL context, and takes what it needs.
       *
       * Both messages answer "where am I sitting and how do I get in", from the
       * same live seating assignment and the same freshly-minted pass token —
       * the reminder simply says less of it. Building a second, narrower context
       * would mean two places computing a table name from
       * `seating_assignments[0].tables.table_name`, and the day one of them was
       * updated for a schema change would be the day the other started naming
       * the wrong table on a message sent to everyone at once.
       *
       * The extra fields (venue, companions, meals) are inert here: the
       * seating_reminder template never reads them, and neither does any merge
       * tag offered for that type.
       */
      const context = (type === 'rsvp_confirmation' || type === 'seating_reminder')
        ? buildDetailContext(party, event)
        : type === 'event_update'
        ? {
          guestName: party.label || 'Guest',
          eventTitle: event.title,
          /**
           * `cancelled` is deliberately absent, so the template renders its
           * "the date or place has changed" branch.
           *
           * A cancellation is NOT sendable from here, and that is a safety
           * property rather than a missing feature. The cancelled branch says
           * the event is off, and the thing that makes that true is
           * `events.status` — set by the cancel flow, which then notifies
           * everyone itself through notifyGuestsOfEventChange. A button that
           * could text "your wedding is cancelled" without cancelling anything
           * is one misclick away from the worst message this product can send.
           */
          url: buildGuestEventUrl(event.slug, partyId),
        }
        : {
          guestName: party.label || 'Guest',
          eventTitle: event.title,
          /**
           * The INVITATION page, not the bare RSVP form.
           *
           * This was `buildGuestRsvpUrl` → `/{slug}/rsvp?g=…`, which drops the
           * guest straight onto a form. The email channel has always used
           * `buildGuestEventUrl` → `/{slug}?party_id=…`, the real invitation with
           * the envelope reveal — so the same event invited people to two
           * different things depending on which button the organizer pressed.
           *
           * The text even says "Open your invitation", and smsTemplates' own
           * docblock explains the whole reason these messages are terse: "the LINK
           * opens the full invitation reveal, which is already the most polished
           * thing this product makes. A phone that opens a wax seal and an
           * animated card is a far stronger impression than any amount of text."
           * The implementation was sending them to the form instead.
           *
           * The RSVP form is still one tap away — it is what the invitation page
           * leads to — so nothing is lost by starting at the invitation.
           */
          rsvpUrl: buildGuestEventUrl(event.slug, partyId),
        };

      const outcome = await sendTransactionalSms({
        type,
        eventId,
        partyId,
        // Timestamped, so a deliberate re-send is never swallowed by the
        // (kind, ref) idempotency guard. That guard exists to stop a SCHEDULER
        // re-sending on every tick; an organizer pressing this button is stating
        // intent, and the confirm dialog tells them what it will cost.
        //
        // NOTE the automatic path uses `rsvpconf:<party>` with no timestamp, so
        // the once-per-guest guarantee holds there while a manual resend stays
        // possible here. Two refs, two different jobs, on purpose.
        ref: `${refPrefix}:${partyId}:${Date.now()}`,
        event,
        lang: party.preferred_lang || 'en',
        context,
      });

      /**
       * THE LEDGER ROW FOR A TEXTED INVITATION.
       *
       * Every other channel writes one; this one never did, and the omission was
       * invisible because nothing throws when a row is simply absent. The
       * dashboard derives `invitation_sent_sms` from
       * `invitations.channel === 'sms'` (page.js), so that flag was permanently
       * false for every guest on the platform, and the Guest list's "Invitations
       * Sent" tile counted only the ones who happened to be emailed.
       *
       * `'sms'` has been a legal `invitation_channel_type` since the guest-
       * experience rebuild, so this needs no migration.
       *
       * ONLY for `type: 'invitation'`. The detail text is a confirmation of an
       * answer already given — recording it here would mark guests as invited
       * who were never sent an invitation, which is worse than the gap it fixes.
       */
      if (type === 'invitation' && outcome.sent) {
        await logInvitation({
          partyId, eventId, channel: 'sms', status: 'sent',
          metadata: { sid: outcome.sid || null, credits: outcome.credits ?? null },
        });
      }

      return outcome;
    }));

    for (const outcome of outcomes) {
      processed += 1;
      if (outcome.sent) { sent += 1; continue; }
      const reason = outcome.reason || 'SKIPPED';
      reasons[reason] = (reasons[reason] || 0) + 1;
      if (reason === 'SEND_FAILED' || reason === 'ERROR') failed += 1;
      else skipped += 1;
    }

    if (processed < ids.length) await sleep(SMS_BATCH_PAUSE_MS);
  }

  // Grouped and already in the organizer's own language, so the result reads
  // "3 haven't agreed to receive texts" rather than NO_CONSENT × 3.
  const breakdown = Object.entries(reasons)
    .map(([reason, count]) => ({ reason, count, message: explainSkip(reason) || 'It could not be delivered' }))
    .sort((a, b) => b.count - a.count);

  return {
    sent,
    skipped,
    failed,
    breakdown,
    message: sent === ids.length
      ? `${what} texted to ${sent} ${sent === 1 ? 'guest' : 'guests'}.`
      : `Texted ${sent} of ${ids.length}. ${skipped + failed} could not be reached.`,
  };
}

module.exports = {
  logInvitation,
  resolveLiveEvent,
  sendEmailInvite,
  sendEmailBulk,
  sendQrTicketEmail,
  sendInvitationSmsBulk,
  /* The route validator and the controller both need to know which types are
     manually sendable. Exported so neither grows its own list — a validator that
     accepts a type this service rejects produces a 400 with the wrong sentence,
     and one that accepts a type it should not is a billing incident. */
  MANUAL_SMS_TYPES,
};
