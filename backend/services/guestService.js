/**
 * GuestService — single owner of all party/guest reads and writes.
 *
 * Replaces the scattered direct `supabase.from('rsvps')...` calls that used
 * to live inline in rsvpController.js. Multi-row writes that need atomicity
 * (submitting an RSVP, responding via an email token, adding a guest) are
 * delegated to the Postgres RPCs from the Phase 1 migration
 * (submit_rsvp_v2 / update_party_response / add_guest_to_party) rather than
 * reimplemented as sequential JS round-trips — that atomicity guarantee is
 * the whole reason those RPCs exist.
 */
const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const { normalizeEmail, escapeLikePattern, normalizeNameForSearch } = require('../utils/normalize');
const { normalizeToE164 } = require('../utils/phone');
const { sideLabelForEvent } = require('../utils/sideLabel');
const { CONSENT_METHOD_HOST, CONSENT_METHOD_REVOKED, logSmsConsentDecision } = require('../utils/smsConsent');

const MAX_ADDITIONAL_GUESTS = 100;
const MAX_CUSTOM_ANSWERS = 200;
const SEATING_REVEAL_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/** True once we're within 24h of the event start (seating may be shown to guests). */
function isSeatingRevealed(eventDate) {
  if (!eventDate) return false;
  const start = new Date(eventDate).getTime();
  if (Number.isNaN(start)) return false;
  return Date.now() >= start - SEATING_REVEAL_WINDOW_MS;
}

/** ISO timestamp of the moment seating unlocks (event start − 24h), or null. */
function seatingRevealAtISO(eventDate) {
  const start = new Date(eventDate).getTime();
  if (Number.isNaN(start)) return null;
  return new Date(start - SEATING_REVEAL_WINDOW_MS).toISOString();
}

/**
 * Coerces a client-supplied companion meal tally into a safe, bounded object.
 *
 * submit_rsvp_v2 validates the tally against the event's own meal options — but
 * ONLY when the event actually has a meal field, since the check lives inside
 * that branch. An event with no meal field would otherwise take whatever jsonb a
 * caller posted straight into the column, unbounded and unchecked, from a public
 * endpoint. Every other array on that endpoint is capped (100 companions, 200
 * custom answers); this is the same idea for the one object.
 *
 * Returns null rather than {} for an empty result: the RPC and updateParty both
 * treat null as "no tally", and an empty object would read as a deliberate
 * "zero of everything".
 *
 * `capacity` additionally caps the TOTAL at the number of companions, trimming
 * the smallest choices first — the same rule as the client's trimMealCounts, so
 * the two never disagree. Passed on the organizer's edit path, where nothing
 * else checks it. Deliberately NOT passed on the public submit path:
 * submit_rsvp_v2 rejects an over-count loudly there, which is what a guest
 * still looking at the form needs, rather than a silent trim.
 */
function sanitizeCompanionMealCounts(raw, capacity = null) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const clean = {};
  // A real menu is a handful of dishes. The cap exists so a caller cannot post
  // thousands of keys, not to constrain any genuine organizer.
  for (const [meal, n] of Object.entries(raw).slice(0, 50)) {
    const label = String(meal).trim().slice(0, 120);
    const qty = Number(n);
    if (!label || !Number.isInteger(qty) || qty <= 0 || qty > 20) continue;
    clean[label] = qty;
  }

  let entries = Object.entries(clean);
  if (capacity !== null && entries.reduce((sum, [, n]) => sum + n, 0) > Math.max(0, Number(capacity) || 0)) {
    let remaining = Math.max(0, Number(capacity) || 0);
    entries = entries
      .sort((a, b) => b[1] - a[1]) // largest first — the group's main choice survives
      .map(([meal, n]) => {
        const keep = Math.min(n, remaining);
        remaining -= keep;
        return [meal, keep];
      })
      .filter(([, n]) => n > 0);
  }

  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

/**
 * Renders a party's companion meal tally as "2 x Fish, 1 x Beef".
 *
 * Companions are names only, so their meals are a COUNT for the group rather
 * than a dish attributed to a person (see migration 20260817000000). Anything
 * displaying meals has to add this to the named per-guest selections, or it
 * reports a party of four as one meal and three "No Selection".
 */
function formatCompanionMealCounts(counts) {
  if (!counts || typeof counts !== 'object') return '';
  return Object.entries(counts)
    .filter(([, n]) => Number(n) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]) || naturalCompare(a[0], b[0]))
    .map(([meal, n]) => `${Number(n)} x ${meal}`)
    .join(', ');
}

/**
 * The exact inverse of the export's `meal_selections` column.
 *
 * exportParties writes `"Jane: Chicken; Bob: Fish; Guests: 2 x Beef, 1 x Fish"`:
 * named people first, then the companion tally under the literal key "Guests".
 * Nothing read that string back, so downloading a list and re-uploading it
 * dropped every meal — and, worse, dropped the companions' NAMES too, because
 * this column is the only place the export records them.
 *
 * Returns `{ named: [{ name, meal }], counts: { meal: n } }`.
 *
 * Deliberately forgiving about whitespace and case in the "Guests" key, since an
 * organizer editing the file in Excel will retype it. Deliberately NOT forgiving
 * about the shape: an unparseable fragment is skipped rather than guessed at, so
 * a mangled cell costs one meal rather than inventing a guest named after a dish.
 */
function parseMealSelections(raw) {
  const out = { named: [], counts: {} };
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return out;

  for (const chunk of text.split(';')) {
    const part = chunk.trim();
    if (!part) continue;
    const at = part.indexOf(':');
    if (at < 0) continue;
    const who = part.slice(0, at).trim();
    const what = part.slice(at + 1).trim();
    if (!who || !what) continue;

    if (who.toLowerCase() === 'guests') {
      // "2 x Beef, 1 x Fish" — the tally half.
      for (const tally of what.split(',')) {
        const m = tally.trim().match(/^(\d+)\s*[x×]\s*(.+)$/i);
        if (!m) continue;
        const n = parseInt(m[1], 10);
        const meal = m[2].trim();
        if (!meal || !Number.isInteger(n) || n <= 0) continue;
        out.counts[meal] = (out.counts[meal] || 0) + n;
      }
      continue;
    }
    out.named.push({ name: who, meal: what });
  }
  return out;
}

/** Locale-aware natural comparator: "Table 2" < "Table 10", and orders Arabic names. */
function naturalCompare(a, b) {
  return String(a == null ? '' : a)
    .localeCompare(String(b == null ? '' : b), undefined, { numeric: true, sensitivity: 'base' });
}

/* ─────────────────────────────────────────────────────────────────────────
 * Atomic writes — delegate to the Phase 1 RPCs
 * ───────────────────────────────────────────────────────────────────────── */

/** Public RSVP form submission (insert or update). Mirrors submit_rsvp_v2's contract 1:1. */
async function submitPublicRsvp({
  slug, partyId, guestName, email, phone, response, partySize, notes,
  primaryMeal, additionalGuests, customAnswers, declineReason, maybeConfirmBy, side, smsConsent,
  dietaryNotes, companionMealCounts,
}) {
  const { data, error } = await supabase.rpc('submit_rsvp_v2', {
    p_slug: slug,
    p_party_id: partyId || null,
    p_guest_name: guestName,
    p_email: email || null,
    p_phone: phone || null,
    p_response: response,
    p_party_size: partySize || 1,
    p_notes: notes || null,
    p_primary_meal: primaryMeal || null,
    p_additional_guests: Array.isArray(additionalGuests) ? additionalGuests : [],
    p_custom_answers: Array.isArray(customAnswers) ? customAnswers : [],
    p_decline_reason: declineReason || null,
    p_maybe_confirm_by: maybeConfirmBy || null,
    p_side: side || null,
    p_sms_consent: !!smsConsent,
    p_primary_dietary_notes: dietaryNotes || null,
    // { "Beef": 2, "Fish": 1 } for the party's companions. Companions are names
    // only, so their meals are a tally for the group rather than a choice
    // attributed to a person.
    p_companion_meal_counts: sanitizeCompanionMealCounts(companionMealCounts),
  });
  if (error) throw error;
  return data;
}

/** One-click email-button response (the token flow). */
async function respondToInvite({ eventId, partyId, response, partySize, additionalGuests, actor = 'guest', source = 'email' }) {
  const { data, error } = await supabase.rpc('update_party_response', {
    p_event_id: eventId,
    p_party_id: partyId,
    p_response: response,
    p_party_size: partySize ?? null,
    p_actor: actor,
    p_source: source,
    p_additional_guests: Array.isArray(additionalGuests) ? additionalGuests : [],
  });
  if (error) throw error;
  return data;
}

/**
 * Best-effort (non-atomic — see caller) check of the paid tier's guest cap
 * before adding `additionalCount` more committed (yes/maybe) guests. Mirrors
 * the tier_max_guests logic enforced atomically inside submit_rsvp_v2 and
 * add_guest_to_party, but this JS-side guard is needed for the extra-
 * companions bulk insert below, which happens as a second round-trip after
 * add_guest_to_party's own single-row RPC check and isn't covered by it.
 */
async function checkGuestCapacity(eventId, response, additionalCount) {
  if (!['yes', 'maybe'].includes(response) || additionalCount <= 0) return { ok: true };
  const { data: event } = await supabase.from('events').select('tier_max_guests, slug').eq('id', eventId).single();
  if (!event || event.slug === 'demo' || !event.tier_max_guests) return { ok: true };

  const { data: parties } = await supabase
    .from('rsvp_parties')
    .select('id, guests(id)')
    .eq('event_id', eventId)
    .in('response', ['yes', 'maybe']);
  const committed = (parties || []).reduce((sum, p) => sum + ((p.guests || []).length || 1), 0);
  if (committed + additionalCount > event.tier_max_guests) return { ok: false };
  return { ok: true };
}

/**
 * Organizer manually adds a guest — a new party (primary contact) or a companion
 * to an existing one. When partySize > 1 on a fresh party, the extra companions
 * are inserted directly (same reconciliation pattern as updateParty) since
 * add_guest_to_party only ever creates one person per call. Companion count is
 * driven purely by partySize regardless of `response` — matching updateParty,
 * so the same "party size" concept behaves identically from Add vs Edit.
 */
/**
 * Record an organizer's attestation that they hold this guest's prior express
 * consent to receive event-related texts, and make the number messageable.
 *
 * PRECEDENCE — the reason this is a guarded UPDATE and not a plain one: a
 * guest's own decision always outranks a host's claim about it. The
 * `.is('sms_consent_at', null)` filter means this can only ever write to a
 * party that has NEVER recorded a consent decision. A guest who was shown our
 * checkbox and left it unticked has a stamped `sms_consent_at`, so a host
 * cannot attest over the top of their refusal — the update simply matches no
 * rows. (A STOP reply is enforced separately and globally, in sms_opt_outs, so
 * it also survives any attestation.)
 *
 * Best-effort by design: the guest has already been created and the phone
 * already stored. Failing to stamp the attestation must leave the number
 * un-messageable — the safe direction — never fail the add/import itself.
 */
async function recordHostConsentAttestation({ eventId, partyId, guestId = null, phone, actorUserId, source }) {
  if (!partyId || !phone) return;
  const nowISO = new Date().toISOString();
  try {
    const { data, error } = await supabase
      .from('rsvp_parties')
      .update({
        sms_consent: true,
        sms_consent_at: nowISO,
        sms_consent_source: source,
        sms_consent_method: CONSENT_METHOD_HOST,
        sms_consent_attested_by: actorUserId || null,
        sms_consent_attested_at: nowISO,
      })
      .eq('id', partyId)
      .is('sms_consent_at', null)   // never overwrite a decision the guest made
      .select('id');
    if (error) {
      logger.warn({ err: error, partyId }, '[addGuest] host SMS consent attestation write failed (apply 20260812010000_host_sms_consent_attestation.sql)');
      return;
    }
    // No rows matched → the guest had already decided for themselves. Correct
    // and expected; the number stays on whatever the guest chose.
    if (!data || data.length === 0) return;

    logSmsConsentDecision({
      eventId, partyId, guestId, phone, consent: true, source,
      method: CONSENT_METHOD_HOST, attestedBy: actorUserId || null,
    });
  } catch (err) {
    logger.warn({ err, partyId }, '[addGuest] host SMS consent attestation threw');
  }
}

async function addGuest({
  eventId, actorUserId, fullName, phone, partyId = null, email = null, response = 'pending',
  partySize = 1, notes = null, side = null, primaryMeal = null,
  smsConsentAttested = false, consentSource = 'host_manual_add',
  /**
   * Optional `[{ fullName, meal }]` for the companions, in seating order.
   *
   * Without it every companion is a placeholder — "Guest 2", "Guest 3" — which
   * is right for a manual add (the organizer knows the headcount, not the
   * names) but wrong for an import, where the file already carries the names.
   * Shorter than partySize is fine: the remainder falls back to placeholders.
   */
  companions = null,
  /** `{ meal: n }` tally for companions who are counted rather than named. */
  companionMealCounts = null,
}) {
  const isNewParty = !partyId;
  const extraCount = isNewParty ? Math.min(Math.max(partySize, 1), MAX_ADDITIONAL_GUESTS) - 1 : 0;

  /**
   * The cap check counts the WHOLE new party, not just its companions.
   *
   * Two guards cover this call and they overlap by exactly one person:
   * add_guest_to_party checks `committed + 1` atomically for the row it creates,
   * and this one covers the companions that go in afterwards on a second round
   * trip the RPC knows nothing about.
   *
   * Passing `extraCount` let a party of three land on a cap of 100 with 98
   * already committed: this check saw 98 + 2 = 100 and passed, the RPC then saw
   * a still-unchanged 98 + 1 = 99 and passed, and the companions took the event
   * to 101. Both guards were individually right and jointly off by one, because
   * this one runs BEFORE the primary exists and was not counting them.
   *
   * `extraCount + 1` is the real headcount this call adds. Still skipped
   * entirely for a party of one, where the RPC's own check is exact and a second
   * query would buy nothing — which matters on an import of several hundred rows.
   */
  if (extraCount > 0) {
    const capacity = await checkGuestCapacity(eventId, response, extraCount + 1);
    if (!capacity.ok) {
      return { success: false, error: 'GUEST_LIMIT_REACHED', message: "This event has reached its plan's guest limit." };
    }
  }

  const { data, error } = await supabase.rpc('add_guest_to_party', {
    p_event_id: eventId,
    p_actor: actorUserId,
    p_full_name: fullName,
    p_party_id: partyId,
    p_phone: phone || null,
    p_email: email || null,
    p_response: response,
    p_side: side || null,
  });
  if (error) throw error;
  if (!data || data.success === false) return data;

  // Host consent attestation — only when the organizer actually ticked it AND a
  // number exists to attest about. Without it the phone is still stored for the
  // organizer's own guest list; it is simply never texted.
  //
  // Restricted to NEW parties on purpose. Adding to an existing party creates a
  // companion, and SMS is addressed to the party's PRIMARY contact — so
  // attesting here would attach the companion's consent to somebody else's
  // number. The primary contact's own consent is theirs to give.
  if (smsConsentAttested && phone && isNewParty && data.party_id) {
    await recordHostConsentAttestation({
      eventId, partyId: data.party_id, guestId: data.guest_id || null,
      phone, actorUserId, source: consentSource,
    });
  }

  // add_guest_to_party has no meal parameter (meal_selection didn't exist when it
  // was written) — set it with a follow-up update on the guest row it just created
  // rather than threading a new RPC arg through for one field.
  if (primaryMeal && data.guest_id) {
    const { error: mealErr } = await supabase.from('guests').update({ meal_selection: primaryMeal }).eq('id', data.guest_id);
    if (mealErr) logger.error({ err: mealErr, guestId: data.guest_id }, '[addGuest] failed to set primary meal_selection');
  }

  const tally = sanitizeCompanionMealCounts(companionMealCounts, extraCount);
  if (isNewParty && (notes || tally || extraCount > 0)) {
    const updates = {};
    if (notes) updates.notes = notes;
    // Capped at extraCount by sanitize above, so an import cannot record more
    // meals than the party has people.
    if (tally) updates.companion_meal_counts = tally;
    if (Object.keys(updates).length > 0) {
      const { error: notesErr } = await supabase.from('rsvp_parties').update(updates).eq('id', data.party_id);
      if (notesErr) logger.error({ err: notesErr, partyId: data.party_id }, '[addGuest] failed to save party notes');
    }
    if (extraCount > 0) {
      // A supplied name wins; anything past the end of the list stays a
      // placeholder, so a file naming two of a party of four still improves on
      // "Guest 2, Guest 3, Guest 4" rather than being discarded for being partial.
      const named = Array.isArray(companions) ? companions : [];
      const rows = Array.from({ length: extraCount }, (_, i) => {
        const supplied = named[i] || {};
        const name = String(supplied.fullName || '').trim();
        return {
          party_id: data.party_id, event_id: eventId, is_primary_contact: false,
          full_name: name || `Guest ${i + 2}`,
          meal_selection: supplied.meal ? String(supplied.meal).trim().slice(0, 120) : null,
        };
      });
      const { error: companionsErr } = await supabase.from('guests').insert(rows);
      if (companionsErr) logger.error({ err: companionsErr, partyId: data.party_id }, '[addGuest] failed to insert companions');
    }
  }
  return data;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Public, PII-free reads (power the guest-facing resolvers)
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Resolves a party for the public invitation/discovery surfaces. NEVER
 * selects or returns email/phone/notes — a party id is an enumerable
 * capability that travels in shared invitation/SMS links.
 */
async function getPartyForPublicResolve(partyId) {
  const { data: party, error } = await supabase
    .from('rsvp_parties')
    .select(`
      id, label, response, created_by_organizer,
      events!inner(id, slug, is_paid, status, event_date),
      seating_assignments(tables(table_name)),
      guests(id)
    `)
    .eq('id', partyId)
    .single();

  if (error || !party) return null;

  const partySize = (party.guests || []).length || 1;
  // Organizer-added guests (CSV import / Add Guest) skip the 24h wait —
  // their identity/contact info is already confirmed by the organizer, so
  // there's no reason to hide their table from them. Genuinely self-serve
  // parties still wait for the normal window.
  const seatingRevealed = party.created_by_organizer === true || isSeatingRevealed(party.events.event_date);
  const tableName = seatingRevealed ? (party.seating_assignments?.[0]?.tables?.table_name || null) : null;

  return {
    id: party.id,
    eventId: party.events.id,
    label: party.label,
    response: party.response,
    partySize,
    event: party.events,
    seatingRevealed,
    revealAt: seatingRevealed ? null : seatingRevealAtISO(party.events.event_date),
    tableName,
  };
}

/** Name search for the public "find my invitation" surface. Min 2 chars enforced by the caller. */
async function searchPartiesPublic(eventId, term, limit = 10) {
  // SEC C7: Only fetch PII-free columns for the public surface — with the sole
  // exception of the primary contact's `email`, which we need server-side (and
  // NEVER return to the client) to decide whether this party's id is safe to
  // expose. add_guest_to_party always creates a primary-contact row even for a
  // host-imported, email-less guest, so "a primary exists" is NOT a proxy for
  // "self-registered with an email" — using it as one leaked every host-imported
  // party's id (a capability that resolves to their QR ticket / seating view).
  const { data, error } = await supabase
    .from('rsvp_parties')
    .select('id, label, response, guests(id, full_name, is_primary_contact, email)')
    .eq('event_id', eventId)
    .ilike('label', `%${escapeLikePattern(term)}%`)
    .limit(limit);

  if (error) throw error;

  return (data || []).map((item) => {
    const allGuests = item.guests || [];
    const primary = allGuests.find((g) => g.is_primary_contact);
    // Only a party whose primary contact actually has an email on file is
    // self-claimable (updating it still requires a matching email), so only then
    // is exposing the id safe. Email-less host-imported parties withhold it.
    const hasEmail = !!(primary && primary.email);
    return {
      // Only expose the partyId when the primary contact has an email — updating
      // such a record still requires a matching email, so the id is safe to
      // surface. Email-less (host-imported) parties withhold the id: their only
      // authorized entry point is the host's private invitation link.
      id: hasEmail ? item.id : null,
      guestName: item.label,
      response: item.response,
      partySize: allGuests.length || 1,
      // SEC C7: Only expose companion id and name — no PII (phone, email,
      // meal, dietary notes).
      additionalGuests: hasEmail
        ? allGuests.filter((g) => !g.is_primary_contact).map((g) => ({
            id: g.id,
            fullName: g.full_name || '',
          }))
        : [],
    };
  });
}

/**
 * "Find my table" verification — replaces the old name-only search, which
 * enumerated every attending party that matched a name (so typing a common
 * first name leaked strangers' tables + companion names). A guest must now
 * prove identity with BOTH their exact name AND the last 4 digits of the
 * primary contact's phone. We only ever return a seating map when EXACTLY ONE
 * attending party matches both factors; 0 matches and >1 ambiguous matches are
 * indistinguishable to the caller (returns null), so no information leaks about
 * who exists or which factor was wrong.
 */
/**
 * Public seating response shape — host first, then companions, with meal/
 * dietary notes so the result panel can distinguish the inviter from their
 * guests. Phone is deliberately omitted — the panel never needs it and we
 * don't want to echo PII back over a guest-facing endpoint.
 */
function shapeSeatingParty(partyRow) {
  const assignment = Array.isArray(partyRow.seating_assignments)
    ? partyRow.seating_assignments[0]
    : partyRow.seating_assignments;

  const members = (partyRow.guests || [])
    .slice()
    .sort((a, b) => (b.is_primary_contact ? 1 : 0) - (a.is_primary_contact ? 1 : 0))
    .map((g) => ({
      name: g.full_name,
      meal: g.meal_selection || null,
      isHost: !!g.is_primary_contact,
      dietaryNotes: g.dietary_notes || null,
    }))
    .filter((g) => g.name);

  return {
    party: { id: partyRow.id, label: partyRow.label, response: partyRow.response, partySize: members.length || 1 },
    myTableId: assignment?.table_id || null,
    myTableName: assignment?.tables?.table_name || null,
    companions: members,
    // Organizer-added guests (CSV import / Add Guest) bypass the 24h reveal
    // window — the caller (rsvpController) decides the final reveal/lock
    // using this alongside the event's own date-based rule.
    createdByOrganizer: partyRow.created_by_organizer === true,
  };
}

async function verifyGuestSeating(eventId, name, phoneLast4) {
  const cleanName = String(name || '').trim();
  const last4 = String(phoneLast4 || '').replace(/\D/g, '');
  if (!cleanName || last4.length !== 4) return null;

  // ilike with no wildcards = case-insensitive exact match on the party label.
  const { data, error } = await supabase
    .from('rsvp_parties')
    .select(`
      id, label, response, created_by_organizer,
      seating_assignments(table_id, tables(table_name)),
      guests(full_name, is_primary_contact, meal_selection, phone, dietary_notes)
    `)
    .eq('event_id', eventId)
    .eq('response', 'yes')
    .ilike('label', escapeLikePattern(cleanName))
    .limit(20);

  if (error) throw error;

  const matches = (data || []).filter((party) => {
    const primary = (party.guests || []).find((g) => g.is_primary_contact) || (party.guests || [])[0];
    const digits = String(primary?.phone || '').replace(/\D/g, '');
    return digits.length >= 4 && digits.slice(-4) === last4;
  });

  // Exactly one match or nothing — never disambiguate for the caller.
  if (matches.length !== 1) return null;
  return shapeSeatingParty(matches[0]);
}

/** Personal seating view: venue layout + this party's own table + own companions. Never other parties. */
async function getPartySeatingMap(eventId, partyId) {
  const { data: party, error } = await supabase
    .from('rsvp_parties')
    .select(`
      id, label, response, created_by_organizer,
      seating_assignments(table_id, tables(table_name)),
      guests(full_name, is_primary_contact, meal_selection, dietary_notes)
    `)
    .eq('id', partyId)
    .eq('event_id', eventId)
    .single();

  if (error || !party) return null;
  return shapeSeatingParty(party);
}

/* ─────────────────────────────────────────────────────────────────────────
 * Organizer dashboard reads/writes
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Lists parties for an event with server-side filtering + pagination.
 *
 * All filtering (response, name search, seated/unseated, meal, custom-answer),
 * ordering, paging, AND the exact total happen inside the get_event_parties RPC
 * in ONE round trip. The previous implementation resolved the cross-table filters
 * by pulling id-sets into Node, intersecting them here, then re-querying with a
 * (potentially enormous) `.in('id', [...])`; an earlier version even capped the
 * post-filtered set at 5,000 rows, so large filtered events reported short pages
 * and wrong totals. The RPC returns the SAME nested shape the old PostgREST embed
 * did (see migration 20260713000000), so the frontend mapping is unchanged.
 */
async function listParties(eventId, {
  response, search, seated, sort, meal, customFieldId, customFieldValue, page = 1, limit = 50,
} = {}) {
  const safeLimit = Math.min(limit, 100);
  const offset = (page - 1) * safeLimit;

  // Validate the discriminated inputs here so only known-safe values reach the RPC.
  const validResponse = response && ['yes', 'no', 'maybe', 'pending', 'waitlist'].includes(response) ? response : null;
  const validSeated = seated === 'true' || seated === 'false' ? seated : null;
  const validSort = ['name_asc', 'name_desc', 'date_asc'].includes(sort) ? sort : null;
  // Pre-escape the search term so a guest-typed %/_ can't act as an ILIKE wildcard
  // (the RPC only adds the match-anywhere %…%). Mirrors the old .ilike() escaping.
  const searchTerm = search && search.trim() ? escapeLikePattern(search.trim()) : null;

  const { data, error } = await supabase.rpc('get_event_parties', {
    p_event_id: eventId,
    p_response: validResponse,
    p_search: searchTerm,
    p_seated: validSeated,
    p_meal: meal && meal.trim() ? meal.trim() : null,
    p_custom_field_id: customFieldId || null,
    p_custom_field_value: customFieldValue != null && String(customFieldValue).trim() ? String(customFieldValue).trim() : null,
    p_sort: validSort,
    p_limit: safeLimit,
    p_offset: offset,
  });
  if (error) throw error;

  const parties = (data && data.parties) || [];
  const total = data && Number.isFinite(Number(data.total)) ? Number(data.total) : 0;

  return {
    parties,
    pagination: { page, limit: safeLimit, count: parties.length, total },
  };
}

/**
 * Guest categories the organizer UI offers (decision D-4, amendment A-16 item 6).
 *
 * A fixed enum, not free text: `vip` is the reserved value the check-in app keys
 * its premium welcome treatment off (§8.4, §9.4), and a typo'd "VIP " would
 * silently produce an ordinary welcome for someone the client considers important.
 * The database column is deliberately wider so a future release can extend this
 * without a migration.
 */
const GUEST_CATEGORIES = ['standard', 'vip', 'family'];

/** Organizer edit of a party + its guests (full reconciliation of the headcount). */
/**
 * Finds an existing guest on this event, in a DIFFERENT party, already holding
 * the email or phone an edit is trying to set.
 *
 * Contact details are unique per event at the DB level and the two indexes are
 * scoped differently:
 *   • idx_guests_event_email_unique — (event_id, lower(email)), UNCONDITIONAL:
 *     any guest, primary or companion, holding that address collides.
 *   • idx_guests_event_phone_unique — (event_id, phone) WHERE is_primary_contact,
 *     because companions legitimately share a household number with their host
 *     (see migration 20260711000000).
 *
 * Checked here rather than left to the write, because a raw 23505 propagates to
 * the organizer as a bare "An unexpected error occurred on the server" — the
 * constraint name never survives the error handler, so there was no way to tell
 * that the address simply belongs to somebody else on the guest list.
 *
 * `escapeLikePattern` on the email is not optional: `ilike` is the only
 * case-insensitive exact match available here, and an underscore is an ilike
 * wildcard AND a perfectly ordinary email character — unescaped,
 * "rouida_mousa@yahoo.com" would also match "rouida-mousa@yahoo.com" and
 * reject a legitimate edit.
 */
async function findContactConflict(eventId, partyId, { email, phone }) {
  if (email) {
    const { data, error } = await supabase
      .from('guests')
      .select('full_name')
      .eq('event_id', eventId)
      .neq('party_id', partyId)
      .ilike('email', escapeLikePattern(email))
      .limit(1);
    if (error) throw error;
    if (data && data.length > 0) {
      return { error: 'DUPLICATE_EMAIL', field: 'email', value: email, conflictWith: data[0].full_name || null };
    }
  }
  if (phone) {
    const { data, error } = await supabase
      .from('guests')
      .select('full_name')
      .eq('event_id', eventId)
      .neq('party_id', partyId)
      .eq('is_primary_contact', true)
      .eq('phone', phone)
      .limit(1);
    if (error) throw error;
    if (data && data.length > 0) {
      return { error: 'DUPLICATE_PHONE', field: 'phone', value: phone, conflictWith: data[0].full_name || null };
    }
  }
  return null;
}

async function updateParty(eventId, partyId, {
  guestName, email, phone, response, partySize, notes, primaryMeal, additionalGuests, side, category,
  companionMealCounts, smsConsentAttested = false, actorUserId = null,
}) {
  const updates = {};
  if (guestName !== undefined) updates.label = guestName.trim();
  if (response !== undefined) updates.response = response;
  if (notes !== undefined) updates.notes = notes;
  if (side !== undefined) updates.side = side || null;
  // Deliberately NOT written here. The tally has to be capped at the party's
  // real companion count, and that is only known once the reconciliation below
  // resolves `effectivePartySize` — so it is written there instead. Setting it
  // here would let a direct API call (bypassing the modal, which caps it in the
  // UI) record more meals than the party has people, inflating the caterer's
  // breakdown in getEventStats.

  // Applied to every guest in the party, because the edit surface is party-shaped
  // and A-16 item 6 asks for ONE dropdown. In practice a category is a party
  // attribute anyway — a VIP arrives with their family, and they are all VIPs at
  // the door. Validated against the enum rather than passed through, so a client
  // cannot write a value the app will not recognise.
  const normalizedCategory = category === undefined
    ? undefined
    : (GUEST_CATEGORIES.includes(String(category).toLowerCase()) ? String(category).toLowerCase() : null);
  if (category !== undefined && normalizedCategory === null) {
    return { error: 'INVALID_CATEGORY' };
  }

  // Run BEFORE any write, so a rejected edit leaves the party exactly as it
  // was. Checking it inside the reconciliation below would have already
  // committed the label/response/notes update to rsvp_parties by the time the
  // guest rows failed, leaving the two half-applied.
  const conflict = await findContactConflict(eventId, partyId, {
    email: email !== undefined ? normalizeEmail(email) : null,
    phone: phone !== undefined && phone ? normalizeToE164(phone) : null,
  });
  if (conflict) return conflict;

  const { data: party, error } = await supabase
    .from('rsvp_parties')
    .update(updates)
    .eq('id', partyId)
    .eq('event_id', eventId)
    .select('*, guests(*), seating_assignments(id, table_id, tables(table_name))')
    .single();

  if (error) throw error;
  if (!party) return null;

  // Reconcile guests whenever party_size, name/contact, or guest detail
  // changed — regardless of `response`, matching addGuest (which creates
  // companions purely from partySize with no response gate). Previously this
  // was gated on effectiveResponse === 'yes', so editing a Maybe/Pending/No
  // guest's party size silently did nothing.
  const guestDetailProvided = additionalGuests !== undefined || primaryMeal !== undefined
    || guestName !== undefined || email !== undefined || phone !== undefined
    || normalizedCategory !== undefined || companionMealCounts !== undefined;
  const partySizeProvided = partySize !== undefined;

  // Set when this edit moves the party's primary contact to a DIFFERENT number.
  // SMS consent is recorded on the party but addressed to whatever number the
  // primary contact currently holds, so a number swap would otherwise let the new
  // number inherit a consent its owner never gave. Acted on after reconciliation.
  let revokedFromPhone = null;

  if (guestDetailProvided || partySizeProvided) {
    const existing = party.guests || [];
    const existingPrimary = existing.find((g) => g.is_primary_contact);
    const existingAdditional = existing.filter((g) => !g.is_primary_contact);
    const effectivePartySize = partySize !== undefined
      ? Math.min(Math.max(parseInt(partySize) || 1, 1), 20)
      : Math.max(existing.length, 1);
    const provided = Array.isArray(additionalGuests) ? additionalGuests : null;

    // The tally, now that the party's real companion count is known. Capped
    // against it so a direct API call can't record more meals than there are
    // people — the modal caps it in the UI, but nothing else did.
    if (companionMealCounts !== undefined) {
      const capped = sanitizeCompanionMealCounts(companionMealCounts, Math.max(0, effectivePartySize - 1));
      const { error: mealErr } = await supabase
        .from('rsvp_parties')
        .update({ companion_meal_counts: capped })
        .eq('id', partyId)
        .eq('event_id', eventId);
      if (mealErr) throw mealErr;
    }

    // SEC C12: Atomic guest reconciliation — upsert existing, insert new, delete removed.
    // Build the desired guest list first.
    const primaryRow = {
      party_id: partyId,
      event_id: eventId,
      full_name: guestName !== undefined ? guestName.trim() : (existingPrimary?.full_name || party.label),
      email: email !== undefined ? normalizeEmail(email) : (existingPrimary?.email || null),
      phone: phone !== undefined ? (phone ? normalizeToE164(phone) : null) : (existingPrimary?.phone || null),
      is_primary_contact: true,
      meal_selection: primaryMeal !== undefined ? (primaryMeal || null) : (existingPrimary?.meal_selection || null),
      // Carried through unchanged. Present only so this row has the SAME key
      // set as the companion rows below — PostgREST rejects a bulk write whose
      // objects don't all share one shape (PGRST102 "All object keys must
      // match"), which made editing ANY party of 2+ fail with a bare 500.
      dietary_notes: existingPrimary?.dietary_notes ?? null,
      category: normalizedCategory !== undefined
        ? normalizedCategory
        : (existingPrimary?.category || 'standard'),
    };
    // If the primary already exists, update in place; otherwise insert.
    if (existingPrimary?.id) {
      primaryRow.id = existingPrimary.id;
    }

    // Compared in canonical E.164 so a pure reformat ("(555) 111-2222" →
    // "+15551112222") is correctly seen as the SAME number and does not revoke a
    // valid consent. Only a genuine change of destination does.
    const oldPrimaryPhone = normalizeToE164(existingPrimary?.phone || '') || null;
    const newPrimaryPhone = primaryRow.phone || null;
    if (oldPrimaryPhone !== newPrimaryPhone && party.sms_consent_at) {
      revokedFromPhone = oldPrimaryPhone;
    }

    const companionRows = [];
    const keepGuestIds = new Set();
    if (existingPrimary?.id) keepGuestIds.add(existingPrimary.id);

    for (let i = 0; i < Math.max(0, effectivePartySize - 1); i++) {
      const fromBody = provided ? provided[i] : null;
      const prev = existingAdditional[i];
      const row = {
        party_id: partyId,
        event_id: eventId,
        full_name: (fromBody?.fullName && fromBody.fullName.trim()) || prev?.full_name || `Guest ${i + 2}`,
        is_primary_contact: false,
        email: fromBody && fromBody.email !== undefined ? (normalizeEmail(fromBody.email) || null) : (prev?.email || null),
        phone: fromBody && fromBody.phone !== undefined ? (fromBody.phone ? normalizeToE164(fromBody.phone) : null) : (prev?.phone || null),
        // No meal and no dietary notes on a companion any more: both are carried
        // for the party as a whole. Existing values are preserved rather than
        // nulled — a row written before this change keeps what it had, it just
        // stops being editable here.
        meal_selection: prev?.meal_selection || null,
        dietary_notes: prev?.dietary_notes || null,
        category: normalizedCategory !== undefined
          ? normalizedCategory
          : (prev?.category || 'standard'),
      };
      if (prev?.id) {
        row.id = prev.id;
        keepGuestIds.add(prev.id);
      }
      companionRows.push(row);
    }

    const allRows = [primaryRow, ...companionRows];

    // Determine which existing guests should be removed (not in the new list).
    const existingIds = existing.map((g) => g.id).filter(Boolean);
    const toDelete = existingIds.filter((id) => !keepGuestIds.has(id));

    // Split by whether the row already exists. Sending both shapes in ONE
    // call cannot work: a row carrying `id` and a brand-new row without it are
    // different object shapes, and PostgREST requires every object in a bulk
    // write to share one key set (PGRST102) — so adding a guest to an existing
    // party failed with a bare 500.
    const existingRows = allRows.filter((r) => r.id);
    const newRows = allRows.map(({ id, ...rest }) => (id ? null : rest)).filter(Boolean);

    try {
      if (existingRows.length > 0) {
        const { error: upsertErr } = await supabase.from('guests').upsert(existingRows, { onConflict: 'id' });
        if (upsertErr) throw upsertErr;
      }
      if (newRows.length > 0) {
        const { error: insertErr } = await supabase.from('guests').insert(newRows);
        if (insertErr) throw insertErr;
      }

      // Delete only the guests that were removed from the party.
      if (toDelete.length > 0) {
        const { error: delErr } = await supabase.from('guests').delete().in('id', toDelete).eq('party_id', partyId);
        if (delErr) throw delErr;
      }
    } catch (reconcileErr) {
      // A 23505 that gets this far is a race the pre-check above couldn't see
      // (two organizers editing at once). Surface it as the same named
      // conflict rather than a 500 — the constraint tells us which field.
      if (reconcileErr?.code === '23505') {
        const constraint = `${reconcileErr.message || ''} ${reconcileErr.details || ''}`;
        if (constraint.includes('idx_guests_event_email_unique')) return { error: 'DUPLICATE_EMAIL', field: 'email' };
        if (constraint.includes('idx_guests_event_phone_unique')) return { error: 'DUPLICATE_PHONE', field: 'phone' };
      }
      // C12: Log the error with original guest data so recovery is possible.
      logger.error({
        err: reconcileErr, partyId, eventId,
        originalGuestIds: existingIds, desiredGuestCount: allRows.length,
      }, '[updateParty] guest reconciliation failed — original guests preserved where possible');
      throw reconcileErr;
    }
  }

  // Seating cleanup on response leaving 'yes' is handled by trg_party_response_change.

  /* ── SMS consent follows the NUMBER, not the party ──────────────────────────
   * Consent lives on rsvp_parties.sms_consent, but every send resolves the actual
   * destination from guests.phone at send time. Editing the primary contact's
   * number therefore used to hand a stranger's handset a consent record its owner
   * had never seen: the party still said "consented", and the send gate — which
   * only ever compares the CURRENT phone against that flag — agreed.
   *
   * Clearing it here is the conservative direction. The organizer can immediately
   * re-attest for the new number (the block below runs after this one, and the
   * guarded attestation update requires sms_consent_at IS NULL — which this write
   * has just restored), so the legitimate "I corrected a typo and I do hold their
   * consent" flow is one checkbox, not a dead end.
   *
   * The old number's consent history is untouched: sms_consent_log is append-only
   * and stores the phone as captured, so this adds a dated revocation rather than
   * rewriting what came before.
   */
  if (revokedFromPhone) {
    const { error: revokeErr } = await supabase
      .from('rsvp_parties')
      .update({
        sms_consent: false,
        sms_consent_at: null,
        sms_consent_method: null,
        sms_consent_attested_by: null,
        sms_consent_attested_at: null,
      })
      .eq('id', partyId)
      .eq('event_id', eventId);

    if (revokeErr) {
      // Never fail the edit over this — but do not let it pass unnoticed either,
      // because the un-revoked state is the one that can text a stranger.
      logger.error({ err: revokeErr, partyId, eventId },
        '[updateParty] SMS consent revocation on phone change FAILED — the new number may inherit stale consent.');
    } else {
      logSmsConsentDecision({
        eventId, partyId, phone: revokedFromPhone, consent: false,
        source: 'phone_changed', method: CONSENT_METHOD_REVOKED, attestedBy: actorUserId || null,
      });
    }
  }

  // Host SMS consent attestation from the edit surface — the way an organizer
  // fixes a guest they imported or added before confirming consent. Runs last so
  // it only applies to an edit that otherwise succeeded, and uses the same
  // guarded write as the add path: it cannot overwrite a guest's own decision.
  // The number attested for is the party's CURRENT primary-contact phone, after
  // any edit above.
  if (smsConsentAttested) {
    const attestPhone = phone !== undefined && phone
      ? normalizeToE164(phone)
      : (await getPrimaryPhone(partyId));
    if (attestPhone) {
      await recordHostConsentAttestation({
        eventId, partyId, phone: attestPhone, actorUserId, source: 'host_manual_add',
      });
    }
  }

  return party;
}

/** Current primary-contact phone for a party, or null. */
async function getPrimaryPhone(partyId) {
  const { data, error } = await supabase
    .from('guests').select('phone')
    .eq('party_id', partyId).eq('is_primary_contact', true)
    .limit(1);
  if (error) {
    logger.warn({ err: error, partyId }, '[updateParty] primary phone lookup failed; consent attestation skipped');
    return null;
  }
  return (data && data[0] && data[0].phone) || null;
}

/** Deletes a party and its related data (guests/custom_answers cascade via FK). */
async function deleteParty(eventId, partyId) {
  await supabase.from('seating_assignments').delete().eq('event_id', eventId).eq('party_id', partyId);
  const { error } = await supabase.from('rsvp_parties').delete().eq('id', partyId).eq('event_id', eventId);
  if (error) throw error;
}

/**
 * What clearing the guest list would destroy, counted before anything is.
 *
 * The confirm dialog is only worth interrupting someone for if it can state the
 * damage, and the damage here is not one number: an organizer thinking "I'll
 * just re-upload my file" is usually not thinking about the seating chart they
 * spent an evening on, or about the arrivals already scanned at the door.
 */
async function summarizeGuestList(eventId) {
  const count = async (table, extra = (q) => q) => {
    const { count: n } = await extra(
      supabase.from(table).select('id', { count: 'exact', head: true }).eq('event_id', eventId),
    );
    return n || 0;
  };
  const [parties, guests, seated, checkedIn, textable] = await Promise.all([
    count('rsvp_parties'),
    count('guests'),
    count('seating_assignments'),
    count('check_ins', (q) => q.is('deleted_at', null)),
    count('rsvp_parties', (q) => q.eq('sms_consent', true)),
  ]);
  return { parties, guests, seated, checkedIn, textable };
}

/**
 * Delete every party on an event — the "start the guest list again" action.
 *
 * Exists for one workflow: export, edit in Excel, clear, re-import. Without it
 * the alternative is deleting guests one row at a time, or deleting the whole
 * EVENT, and organizers were reaching for the second one.
 *
 * Deliberately does NOT touch:
 *   • `tables` — the seating chart's furniture and layout survive, which is what
 *     makes a re-import able to put everyone back on the same tables;
 *   • `sms_consent_log` / `sms_log` — neither has a foreign key to
 *     rsvp_parties, by design (see migration 20260811010000). They are the
 *     append-only record of what was consented to and what was sent, and a
 *     product action must not be able to erase a compliance history.
 *
 * Everything keyed to a party DOES go, by cascade: guests, seating assignments,
 * check-ins, the invitation ledger, custom answers and response history. The
 * caller is responsible for having said so.
 */
async function deleteAllParties(eventId) {
  const before = await summarizeGuestList(eventId);

  // Explicit, before the cascade. seating_assignments cascades from rsvp_parties
  // anyway, but deleteParty clears it first too and the seating chart reads this
  // table directly — leaving the ordering to the database is a difference worth
  // not having between the one-party and all-parties paths.
  await supabase.from('seating_assignments').delete().eq('event_id', eventId);

  const { error } = await supabase.from('rsvp_parties').delete().eq('event_id', eventId);
  if (error) throw error;

  // Orphaned queue rows would otherwise be reconsidered every fifteen minutes
  // forever, each one loading a party that no longer exists.
  await supabase.from('seating_notify_queue').delete().eq('event_id', eventId)
    .then(() => {}, () => {});

  return before;
}

/** Aggregated stats for the dashboard cards. */
async function getStats(eventId) {
  const { data: parties, error } = await supabase
    .from('rsvp_parties').select('response, guests(id)').eq('event_id', eventId);
  if (error) throw error;

  const { count: invitationsSent } = await supabase
    .from('invitations').select('party_id', { count: 'exact', head: true })
    .eq('event_id', eventId).in('status', ['sent', 'delivered', 'opened', 'responded']);

  const stats = {
    totalParties: parties.length, totalGuests: 0, invitationsSent: invitationsSent || 0,
    acceptedParties: 0, acceptedGuests: 0, declinedParties: 0, maybeParties: 0, pendingParties: 0, waitlistParties: 0,
  };
  parties.forEach((p) => {
    const size = (p.guests || []).length || 1;
    stats.totalGuests += size;
    if (p.response === 'yes') { stats.acceptedParties++; stats.acceptedGuests += size; }
    else if (p.response === 'no') stats.declinedParties++;
    else if (p.response === 'maybe') stats.maybeParties++;
    else if (p.response === 'waitlist') stats.waitlistParties++;
    else stats.pendingParties++;
  });
  return stats;
}

/**
 * Bulk-creates parties from parsed CSV/XLSX rows via add_guest_to_party (one
 * RPC call per row). Each row's party+primary-guest insert is atomic and
 * dedup-safe — slower than the old single bulk `.insert()` into one flat
 * table, but correct: a partial chunk failure can no longer leave an
 * orphaned party with no guest row.
 *
 * ── Two levels of SMS consent, and the precedence between them ──
 *
 * `smsConsentAttested` is the organizer's whole-file declaration that they hold
 * prior express consent for every number in it. A row may ALSO carry its own
 * answer in an `sms_consent` column, exposed as `row.sms_consent_attested`
 * (true / false / null for "the column was not present").
 *
 * The per-row value wins when it exists, and it wins in BOTH directions — but the
 * asymmetry is the point: a row that says NO is never attested, not even when the
 * file-level box is ticked. Someone who took the trouble to mark one guest as
 * off-limits has said something more specific than the blanket claim, and the
 * safe direction to resolve a conflict about consent is always the narrower one.
 *
 * Either way it applies only to rows carrying a number, and only to genuinely new
 * parties — a duplicate row is skipped entirely, so it can never retro-attest
 * over a guest who already answered our own consent checkbox.
 */
async function importGuests(eventId, actorUserId, rows, { smsConsentAttested = false } = {}) {
  const CONCURRENCY = 20;
  const imported = [];
  const errors = [];
  let skippedExisting = 0;

  // party_id per seated row, collected for the seating pass below. Kept out of
  // the import loop because seating needs the event's table list, which is one
  // query for the whole file rather than one per guest.
  const toSeat = [];

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map((row) => {
      /**
       * The export folds every meal into one cell, and it is also the only place
       * it records a companion's NAME. Splitting it back out is what turns a
       * re-import from "party of seven, six of them called Guest N with no
       * meals" into the party that was exported.
       *
       * The named entry matching the party label is the primary contact; the
       * rest are companions, in file order. Matching by name rather than by
       * position because the export's guests array has no guaranteed order.
       */
      const meals = parseMealSelections(row.meal_selections);
      const size = row.party_size || 1;
      const label = String(row.guest_name || '').trim().toLowerCase();
      let primaryIdx = meals.named.findIndex((m) => m.name.trim().toLowerCase() === label);

      /**
       * When no named meal matches the party label, fall back to "the first
       * named entry is the primary" — but ONLY if there are more names than
       * there are companion slots.
       *
       * The party label and the primary guest's full_name are separate columns
       * and can drift apart (an organizer renaming one on the edit screen).
       * Without this, primaryIdx stays -1, the primary is treated as a
       * companion, and on a party of two the REAL companion is pushed past the
       * end of the list and silently dropped — the primary ends up duplicated
       * and nobody has the right meal.
       *
       * Conditioned on the count because the opposite case is just as real: a
       * party of three with only one meal recorded should keep that person as a
       * companion, not promote them to primary on a guess.
       */
      if (primaryIdx < 0 && meals.named.length > Math.max(0, size - 1)) primaryIdx = 0;

      const primaryMeal = primaryIdx >= 0 ? meals.named[primaryIdx].meal : null;
      const companions = meals.named
        .filter((_, idx) => idx !== primaryIdx)
        .map((m) => ({ fullName: m.name, meal: m.meal }));

      return addGuest({
        eventId,
        actorUserId,
        fullName: row.guest_name || 'Unnamed Guest',
        phone: row.phone || null,
        email: row.email || null,
        // Was the literal 'pending', which discarded the answer column outright —
        // so re-importing this platform's own export reset every RSVP the
        // organizer had already collected. The caller normalizes the cell (see
        // rsvpController.normalizeResponseCsvValue) and 'pending' remains the
        // fallback for a file that carries no answers, which is most of them.
        response: row.response || 'pending',
        partySize: size,
        notes: row.notes || null,
        side: row.side || null,
        primaryMeal,
        companions,
        companionMealCounts: meals.counts,
        // ?? not ||, so an explicit per-row `false` is honoured rather than falling
        // through to the file-level flag — which is the entire reason the column
        // exists.
        smsConsentAttested: row.sms_consent_attested ?? smsConsentAttested,
        consentSource: 'host_csv_import',
      });
    }));

    results.forEach((r, idx) => {
      const row = batch[idx];
      if (r.status === 'fulfilled' && r.value?.success) {
        imported.push({ id: r.value.guest_id, guest_name: row.guest_name });
        const table = String(row.table_name || '').trim();
        if (table && r.value.party_id) toSeat.push({ partyId: r.value.party_id, table, guestName: row.guest_name });
      } else if (r.status === 'fulfilled' && r.value?.error === 'DUPLICATE_GUEST') {
        skippedExisting++;
      } else if (r.status === 'rejected' && r.reason?.code === 'P0001' && /GUEST_LIMIT_REACHED/.test(r.reason.message || '')) {
        errors.push({ guest_name: row.guest_name, error: 'GUEST_LIMIT_REACHED — this event\'s plan guest limit has been reached.' });
      } else {
        errors.push({ guest_name: row.guest_name, error: r.status === 'fulfilled' ? r.value?.message : String(r.reason) });
      }
    });
  }

  const seating = await seatImportedParties(eventId, actorUserId, toSeat);

  return { imported, skippedExisting, errors, seating };
}

/**
 * Put freshly imported parties back on the tables their file named.
 *
 * Runs AFTER the import rather than inside it, for two reasons: the table list
 * is one query for the whole file instead of one per guest, and a seating
 * failure must never cost the organizer the guest. A party that cannot be seated
 * is still imported — it simply shows up unassigned on the chart, which is
 * exactly where it would be if the column had been blank.
 *
 * Tables are matched, never CREATED. An import that invented tables would put
 * furniture on the seating map at position (0,0) with a guessed capacity, and
 * the organizer would have to find and delete it. The normal flow this exists
 * for — clear the guest list, re-upload the file — leaves the tables untouched,
 * so matching is sufficient.
 *
 * ── Every refusal is counted ──
 *
 * assign_seat has SIX failure modes, not one. An earlier version of this
 * function counted `success` and `CAPACITY_EXCEEDED` and dropped the other four
 * on the floor, which reproduced the exact class of bug this whole import fix
 * exists to remove: the organizer is told "imported!", the chart is empty, and
 * nothing anywhere says why.
 *
 * The one that actually bites is RSVP_NOT_FOUND. assign_seat requires
 * `response = 'yes'`, so re-importing a guest who was seated but answered
 * "maybe" silently leaves them unassigned. FEATURE_REQUIRES_PAYMENT is the other
 * realistic one — on an unpaid event, seating silently does nothing at all.
 *
 * @returns {{ seated:number, unknownTables:string[], refused:Record<string,number> }}
 */
async function seatImportedParties(eventId, actorUserId, wanted) {
  const result = { seated: 0, unknownTables: [], refused: {} };
  if (!Array.isArray(wanted) || wanted.length === 0) return result;

  const refuse = (code) => { result.refused[code] = (result.refused[code] || 0) + 1; };

  const { data: tables } = await supabase
    .from('tables').select('id, table_name').eq('event_id', eventId);

  // Case- and whitespace-insensitive: "table 5" in a hand-edited file is the
  // same furniture as "Table 5" on the chart, and refusing to see that would
  // make the feature look broken for the most ordinary edit there is.
  const byName = new Map();
  for (const t of (tables || [])) {
    const key = String(t.table_name || '').trim().toLowerCase();
    if (key && !byName.has(key)) byName.set(key, t.id);
  }

  const missing = new Set();
  for (const row of wanted) {
    const tableId = byName.get(row.table.toLowerCase());
    if (!tableId) { missing.add(row.table); continue; }
    try {
      // The same RPC the seating chart uses. Capacity is enforced inside it,
      // atomically — a JS pre-check here would be a TOCTOU race against the
      // organizer dragging guests around in another tab.
      const { data } = await supabase.rpc('assign_seat', {
        p_event_id: eventId,
        p_party_id: row.partyId,
        p_table_id: tableId,
        p_assigned_by: actorUserId,
        // Never force. A file that overfills a table is a mistake worth
        // reporting, not one worth silently baking into the chart.
        p_force: false,
      });
      if (data?.success) result.seated += 1;
      // Every non-success is counted under its own code, including one we did
      // not anticipate — an unknown refusal must still show up as a number
      // rather than as nothing.
      else refuse(data?.error || 'UNKNOWN');
    } catch (err) {
      logger.warn({ err, partyId: row.partyId, table: row.table }, '[importGuests] could not seat an imported party');
      refuse('ERROR');
    }
  }
  result.unknownTables = [...missing];
  return result;
}

/** Export dataset for CSV/Excel. */
/**
 * Everything `utils/excelHelper.generateExcelExport` needs, assembled once.
 *
 * ── WHY THIS IS A FUNCTION AND NOT FOUR QUERIES AT THE CALL SITE ──
 *
 * It was four queries at one call site (rsvpController.exportGuestsExcel), and
 * the second caller — the post-event archive link in the data-deletion warning
 * email — would have had to reproduce all of it, including the part that is not
 * obvious:
 *
 *   • the `guestRows` mapping is a CONTRACT with generateExcelExport. It expects
 *     the pre-rebuild `rsvp` shape (`rsvp_guests`, `seating_assignments`), which
 *     no table produces any more; the mapping below is what manufactures it.
 *   • check-ins must filter `deleted_at IS NULL`. Undone arrivals are retained
 *     as evidence (migration 20260814000000), and an export that listed them
 *     would show guests as having attended who were signed back out at the door.
 *   • the timezone is the EVENT's, so arrival times are printed on the venue's
 *     clock rather than on the clock of whoever is downloading.
 *
 * Two of those three are invisible mistakes — the file generates, opens, and is
 * quietly wrong. Being wrong in the archive is worse than in the dashboard
 * export, because the archive is the copy the organizer keeps after the
 * original has been deleted.
 */
async function buildEventExcelExport(eventId, { attendingOnly = false, sort = null } = {}) {
  const { rows, meta } = await exportParties(eventId, { attendingOnly, sort });

  const [{ data: tables, error: tablesError }, { data: event }, { data: checkins, error: checkinsError }] =
    await Promise.all([
      supabase.from('tables').select('*').eq('event_id', eventId),
      supabase.from('events').select('timezone').eq('id', eventId).maybeSingle(),
      supabase.from('check_ins').select('*, rsvp_parties(label)').eq('event_id', eventId).is('deleted_at', null),
    ]);
  if (tablesError) throw tablesError;
  if (checkinsError) throw checkinsError;

  const guestRows = rows.map((r) => ({
    guest_name: r.guest_name, email: r.email, phone: r.phone, response: r.response,
    party_size: r.party_size, notes: r.notes, side: r.side,
    rsvp_guests: (r.guests || []).map((g) => ({ meal_selection: g.meal_selection, is_primary: g.is_primary_contact })),
    seating_assignments: r.table_name ? [{ tables: { table_name: r.table_name } }] : [],
  }));

  return { guestRows, tables: tables || [], checkins: checkins || [], timezone: event?.timezone || null, meta };
}

async function exportParties(eventId, { attendingOnly, sort } = {}) {
  const EXPORT_LIMIT = 10000;
  // Needed only to write the Side column as "<Name>'s Side" instead of the raw
  // 'partner1'/'partner2' enum, which told the organizer nothing about WHICH
  // partner the guest came for.
  const { data: event } = await supabase
    .from('events').select('event_type, template_data').eq('id', eventId).maybeSingle();
  const { data: parties, error } = await supabase
    .from('rsvp_parties')
    .select(`
      id, label, response, notes, side, companion_meal_counts, sms_consent,
      guests(full_name, email, phone, is_primary_contact, meal_selection),
      seating_assignments(table_id, tables(table_name)),
      check_ins(checked_in_at, method, deleted_at, undo_reason)
    `)
    .eq('event_id', eventId)
    .limit(EXPORT_LIMIT);
  if (error) throw error;

  let rows = parties || [];

  // M18: Warn when the export limit is hit — data may be truncated.
  const exportTruncated = rows.length >= EXPORT_LIMIT;
  if (exportTruncated) {
    logger.warn({ eventId, limit: EXPORT_LIMIT }, '[exportParties] export limit reached — export may be incomplete');
  }

  if (attendingOnly) rows = rows.filter((p) => p.response === 'yes');

  const tableNameOf = (p) => {
    const sa = p.seating_assignments;
    const first = Array.isArray(sa) ? sa[0] : sa;
    return first?.tables?.table_name || '';
  };

  if (sort === 'table') {
    rows = [...rows].sort((a, b) => {
      const ta = tableNameOf(a), tb = tableNameOf(b);
      if (!ta && tb) return 1;
      if (ta && !tb) return -1;
      const cmp = naturalCompare(ta, tb);
      return cmp !== 0 ? cmp : naturalCompare(a.label, b.label);
    });
  } else if (sort === 'name') {
    rows = [...rows].sort((a, b) => naturalCompare(a.label, b.label));
  }

  const mapped = rows.map((p) => {
    const primary = (p.guests || []).find((g) => g.is_primary_contact) || {};
    const partySize = (p.guests || []).length || 1;
    // Name-attributed so a party with different meals per person is legible in
    // the export ("John: Chicken; Guest 2: Fish") instead of an ambiguous
    // semicolon-joined blob with no way to tell whose meal is whose.
    // The named selections (in practice the primary contact's — companions have
    // none) plus the party's companion tally, which is where every meal for a
    // group of 2+ now lives.
    const namedMeals = (p.guests || []).filter((g) => g.meal_selection)
      .map((g) => `${g.full_name}: ${g.meal_selection}`);
    const companionMeals = formatCompanionMealCounts(p.companion_meal_counts);
    const meals = [...namedMeals, companionMeals ? `Guests: ${companionMeals}` : '']
      .filter(Boolean).join('; ');
    const tableName = tableNameOf(p);
    // An undone check-in is retained as evidence but is NOT an arrival. Without
    // this split the export would report a guest the supervisor un-admitted as
    // having attended (soft delete, migration 20260814000000).
    const allCheckIns = p.check_ins || [];
    const checkIns = allCheckIns.filter((c) => !c.deleted_at);
    const undone = allCheckIns.filter((c) => c.deleted_at);
    return {
      guest_name: p.label,
      email: primary.email || '',
      phone: primary.phone || '',
      response: p.response,
      party_size: partySize,
      side: sideLabelForEvent(p.side, event) || '',
      /**
       * Whether this guest may be texted.
       *
       * Exported so the clear-and-re-upload flow does not silently strip
       * permission from an entire guest list: consent lives on the party row, so
       * it dies with the party, and nothing in the file used to carry it.
       *
       * Re-importing it records `host_attested` — the organizer uploading the
       * file is asserting they hold the permission, dated and attributed to them.
       * It does NOT restore an original `guest_optin`, and deliberately cannot:
       * letting a hand-editable CSV claim that the GUEST personally opted in
       * would let a spreadsheet manufacture the strongest form of consent we
       * hold. An organizer's own attestation is the strongest thing a file is
       * allowed to assert.
       */
      sms_consent: p.sms_consent ? 'yes' : 'no',
      table_name: tableName,
      meal_selections: meals,
      checked_in: checkIns.length > 0 ? 'Yes' : 'No',
      checked_in_at: checkIns[0]?.checked_in_at || '',
      check_in_method: checkIns[0]?.method || '',
      // Surfaced so a reversed admission is visible in the export rather than
      // looking identical to a guest who simply never arrived.
      undone_check_in: undone.length > 0 ? (undone[0].undo_reason || 'Reversed') : '',
      notes: p.notes || '',
      guests: p.guests || [],
    };
  });

  // M18: Return metadata so the caller can inform the user about truncation.
  return {
    rows: mapped,
    meta: {
      total: mapped.length,
      truncated: exportTruncated,
      limit: EXPORT_LIMIT,
    },
  };
}

/* ─────────────────────────────────────────────────────────────────────────
 * Check-in — per-guest rows, party-level scan/search semantics
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Checks in every guest belonging to a party in one shot (QR scan / manual
 * party lookup / self-service all check in the whole arriving group). Each
 * individual still gets their own `check_ins` row — replacing the old
 * `party_count_arrived` integer with real per-person arrival data — but a
 * guest already checked in is silently skipped rather than re-inserted.
 */
async function checkInParty(eventId, partyId, { method, checkedInBy = null } = {}) {
  /*
   * ── WHY THIS GOES THROUGH AN RPC AND NOT THE INSERT BELOW ──
   *
   * The direct INSERT that follows is correct about the database and invisible
   * to every tablet at the venue.
   *
   * Devices read arrivals from `getDelta`, which selects on
   * `server_seq.gt.<since>,undo_seq.gt.<since>`. `server_seq` has no default
   * and no trigger — it is allocated inside `checkin_batch_upsert`, which only
   * the device drain calls. So a check-in taken at the desk landed with
   * `server_seq = NULL`, matched no possible delta, and no tablet was ever told
   * about it.
   *
   * That did not corrupt the count, which is why it went unnoticed: the guest
   * scans at a door, the tablet has never heard of them, admits them, and the
   * batch endpoint answers `conflict` and keeps the desk's original row. Right
   * total, manufactured conflict — one per guest the desk admits.
   *
   * `checkin_web_upsert` (migration 20260831000000) allocates the sequence and
   * inserts in ONE transaction under the same advisory lock the drain takes.
   * Doing those as two steps from here is not equivalent: a device polling in
   * between reads the already-advanced cursor, applies nothing, and moves its
   * own cursor past a row that lands a moment later — invisible to it forever.
   *
   * The INSERT path below is KEPT as a fallback, deliberately. Migrations in
   * this repository have shipped unapplied more than once, and a desk that
   * cannot admit anyone is far worse than a desk whose arrivals reach tablets
   * a poll later. Same posture as undoPartyCheckIn.
   */
  const rpc = await supabase.rpc('checkin_web_upsert', {
    p_event_id: eventId,
    p_party_id: partyId,
    p_method: method,
    p_checked_in_by: checkedInBy,
  });

  if (!rpc.error) {
    const data = rpc.data || {};
    if (data.ok) {
      return {
        success: true,
        checkedInCount: data.checked_in_count || 0,
        totalGuests: data.total_guests || 0,
        alreadyCheckedIn: data.already_checked_in || 0,
        checkedInAt: data.checked_in_at,
      };
    }
    if (data.error === 'ALREADY_CHECKED_IN') {
      return {
        success: false,
        error: 'ALREADY_CHECKED_IN',
        checkedInAt: data.checked_in_at,
        totalGuests: data.total_guests || 0,
      };
    }
    return { success: false, error: data.error || 'GUEST_NOT_FOUND' };
  }

  if (!(rpc.error.code === 'PGRST202' || /could not find the function/i.test(rpc.error.message || ''))) {
    throw rpc.error;
  }

  logger.warn(
    { eventId, partyId },
    '[guests] checkin_web_upsert missing — migration 20260831000000 is not applied; '
    + 'recording without a sequence number, so tablets will NOT see this arrival until they re-prepare',
  );

  const { data: guests, error: guestsErr } = await supabase
    .from('guests').select('id, full_name').eq('party_id', partyId).eq('event_id', eventId);
  if (guestsErr) throw guestsErr;
  if (!guests || guests.length === 0) return { success: false, error: 'GUEST_NOT_FOUND' };

  const { data: existing, error: existingErr } = await supabase
    .from('check_ins').select('guest_id, checked_in_at').eq('event_id', eventId).is('deleted_at', null).in('guest_id', guests.map((g) => g.id));
  if (existingErr) throw existingErr;
  const alreadyIn = new Set((existing || []).map((e) => e.guest_id));

  if (alreadyIn.size === guests.length) {
    return { success: false, error: 'ALREADY_CHECKED_IN', checkedInAt: existing[0]?.checked_in_at, totalGuests: guests.length };
  }

  const toInsert = guests
    .filter((g) => !alreadyIn.has(g.id))
    .map((g) => ({ event_id: eventId, guest_id: g.id, party_id: partyId, method, checked_in_by: checkedInBy }));

  let inserted;
  try {
    const { data, error } = await supabase.from('check_ins').insert(toInsert).select('id, guest_id, checked_in_at');
    if (error) throw error;
    inserted = data;
  } catch (err) {
    // A concurrent check-in (double-tap on a flaky venue connection, or a
    // client-side retry after a lost response) can race the read-then-insert
    // above: both calls see "not yet checked in" before either commits, and
    // the loser's INSERT then hits check_ins' UNIQUE(event_id, guest_id) and
    // previously surfaced as a raw unhandled 500 instead of the same friendly
    // ALREADY_CHECKED_IN this function already returns for the non-racy case.
    if (err.code === '23505' || /duplicate key/i.test(err.message || '')) {
      const { data: recheck, error: recheckErr } = await supabase
        .from('check_ins').select('guest_id, checked_in_at').eq('event_id', eventId).is('deleted_at', null).in('guest_id', guests.map((g) => g.id));
      if (recheckErr) throw recheckErr;
      const nowIn = new Set((recheck || []).map((e) => e.guest_id));
      if (nowIn.size === guests.length) {
        return { success: false, error: 'ALREADY_CHECKED_IN', checkedInAt: recheck[0]?.checked_in_at, totalGuests: guests.length };
      }
      // A mix of newly-checked-in (by the winning concurrent call) and still-
      // outstanding guests — retry with only what's actually still missing.
      const retryInsert = guests
        .filter((g) => !nowIn.has(g.id))
        .map((g) => ({ event_id: eventId, guest_id: g.id, party_id: partyId, method, checked_in_by: checkedInBy }));
      const { data: retryData, error: retryErr } = await supabase.from('check_ins').insert(retryInsert).select('id, guest_id, checked_in_at');
      if (retryErr) throw retryErr;
      inserted = retryData;
    } else {
      throw err;
    }
  }

  return {
    success: true,
    checkedInCount: inserted.length,
    totalGuests: guests.length,
    alreadyCheckedIn: guests.length - inserted.length,
    checkedInAt: inserted[0]?.checked_in_at,
  };
}

/**
 * Reverses every check-in for a party (the staff "undo" action).
 *
 * SOFT delete since migration 20260814000000. This used to be a hard
 * `DELETE`, which erased arrival evidence with no audit row anywhere — an
 * organizer could silently un-admit a guest and nothing recorded it. Spec
 * §9.6 requires every override and undo to remain visible, so the rows are
 * now marked rather than destroyed.
 *
 * Already-undone rows are skipped, so a repeated undo is a no-op rather than
 * a re-stamp that would overwrite the original actor and reason.
 *
 * ── WHY THIS GOES THROUGH THE RPC AND NOT A DIRECT UPDATE ──
 *
 * It used to be one `UPDATE` setting `deleted_at`, `deleted_by` and
 * `undo_reason`. Correct as far as the database went, and invisible to every
 * tablet at the venue.
 *
 * Devices learn about changes from `getDelta`, which selects on
 * `server_seq.gt.<since>,undo_seq.gt.<since>`. That UPDATE never allocated an
 * `undo_seq`, so the reversed row stayed at `undo_seq = NULL`, never matched the
 * filter, and no device ever heard about it. The dashboard's arrival count
 * dropped while both tablets went on showing the guest as arrived — and would
 * refuse to re-admit them at the door on the Layer 1 duplicate guard (§5.3).
 *
 * `checkin_undo_by_ref` allocates that sequence number under the same advisory
 * lock the batch upsert takes, so the reversal takes its own position in the
 * stream and every device picks it up on the next poll. Reusing it also means
 * the two undo paths — dashboard and tablet — write identical rows, instead of
 * one of them quietly omitting fields the other sets.
 *
 * One call per live check-in because the RPC reverses ONE row; a party is
 * usually one to four people, so this is a handful of statements, and each is
 * idempotent.
 */
async function undoPartyCheckIn(eventId, partyId, { actorId = null, reason = null } = {}) {
  const { data: live, error: liveErr } = await supabase
    .from('check_ins')
    .select('id')
    .eq('event_id', eventId)
    .eq('party_id', partyId)
    .is('deleted_at', null);
  if (liveErr) throw liveErr;
  if (!live || live.length === 0) return 0;

  const undoReason = reason || 'Reversed from the check-in console';
  let reversed = 0;

  for (const row of live) {
    const { data, error } = await supabase.rpc('checkin_undo_by_ref', {
      p_event_id: eventId,
      p_client_checkin_id: null,
      p_server_id: row.id,
      p_actor: actorId,
      p_reason: undoReason,
      p_staff_id: null,
      p_staff_name: null,
    });

    /*
     * The migration may not be applied on every deployment yet. Falling back to
     * the original UPDATE keeps the reversal working — the dashboard stays
     * correct — and only the propagation to devices is missing, which is exactly
     * the behaviour this replaced. Better than refusing to reverse at all.
     */
    if (error && (error.code === 'PGRST202' || /could not find the function/i.test(error.message || ''))) {
      logger.warn(
        { eventId, partyId },
        '[guests] checkin_undo_by_ref missing — migration 20260830000004 is not applied; '
        + 'reversing without a sequence number, so tablets will NOT see this undo',
      );
      const { error: fallbackErr } = await supabase
        .from('check_ins')
        .update({ deleted_at: new Date().toISOString(), deleted_by: actorId, undo_reason: undoReason })
        .eq('id', row.id)
        .is('deleted_at', null);
      if (fallbackErr) throw fallbackErr;
      reversed += 1;
      continue;
    }

    if (error) throw error;
    // `already_undone` means someone reversed it between the read and now; it is
    // not a failure, but it is not a reversal this call performed either.
    if (data?.ok && !data.already_undone) reversed += 1;
  }

  return reversed;
}

/** Columns the check-in desk search needs — the full row the caller returns. */
const CHECKIN_SEARCH_SELECT = `
      id, label, response,
      guests(id, full_name, meal_selection, dietary_notes),
      seating_assignments(tables(id, table_name)),
      check_ins(id, checked_in_at, guest_id, deleted_at)
    `;

/**
 * The narrow projection the fallback scan reads.
 *
 * Just enough to decide whether a party matches — no seating, no check-ins, no
 * meal or dietary text. The scan reads up to CHECKIN_SEARCH_SCAN_CAP rows on a
 * keystroke, and the difference between this and CHECKIN_SEARCH_SELECT at that
 * volume is three joins and most of the payload. The handful of rows that
 * actually match are re-read in full afterwards.
 */
const CHECKIN_SEARCH_SCAN_SELECT = 'id, label, guests(full_name)';

/**
 * Upper bound on the normalized fallback scan. Well past the realistic ceiling
 * for this market (§21.10 explicitly rejects designing for 100k), and it keeps
 * a pathological event from turning one keystroke into an unbounded read.
 */
const CHECKIN_SEARCH_SCAN_CAP = 3000;

/**
 * Autocomplete search for the check-in desk: name, party size, table, arrival
 * status, meals.
 *
 * Two passes, because the fast one is not correct on its own:
 *
 *   1. Indexed ILIKE on the party label. Covers most queries at index speed.
 *   2. If that under-fills, a normalized scan over the event's parties AND
 *      their individual guests.
 *
 * Pass 2 exists because pass 1 fails on real guest lists in two ways
 * (discovery finding R-3 / amendment A-12):
 *
 *   • It only ever matched `rsvp_parties.label`, so searching a companion's
 *     own name found NOTHING — and a companion arriving without the primary
 *     guest is completely routine.
 *   • It is byte-exact, so أحمد does not match احمد. Spec §8.5 requires
 *     diacritic-, hamza- and alef-insensitive matching; without it the search
 *     is unusable on an Arabic list, which is most of this product's market.
 *
 * The device does this locally against its bundle and is the primary search
 * path; this endpoint serves the web kiosk. Both must agree, or staff at one
 * door get different answers from staff at another — hence the shared
 * normalizeNameForSearch, which the app mirrors.
 */
async function searchGuestsForCheckin(eventId, term, limit = 10) {
  const raw = String(term || '').trim();
  if (!raw) return [];

  const { data: fast, error } = await supabase
    .from('rsvp_parties')
    .select(CHECKIN_SEARCH_SELECT)
    .eq('event_id', eventId)
    .ilike('label', `%${escapeLikePattern(raw)}%`)
    .limit(limit);
  if (error) throw error;

  let data = fast || [];

  // Pass 2: the same cheap ILIKE against companion names. The label pass misses
  // a companion arriving without the primary guest, which is completely routine,
  // and catching it here keeps most Latin-script searches off the scan below.
  if (data.length < limit) {
    const { data: guestRows, error: guestErr } = await supabase
      .from('guests')
      .select('party_id')
      .eq('event_id', eventId)
      .ilike('full_name', `%${escapeLikePattern(raw)}%`)
      .limit(limit * 4);
    if (guestErr) throw guestErr;

    const seen = new Set(data.map((p) => p.id));
    const ids = [...new Set((guestRows || []).map((g) => g.party_id))]
      .filter((id) => id && !seen.has(id))
      .slice(0, limit - data.length);

    if (ids.length > 0) {
      const { data: hydrated, error: hydrateErr } = await supabase
        .from('rsvp_parties')
        .select(CHECKIN_SEARCH_SELECT)
        .eq('event_id', eventId)
        .in('id', ids);
      if (hydrateErr) throw hydrateErr;
      data = data.concat(hydrated || []);
    }
  }

  // Pass 3: the normalized scan. Only this pass satisfies §8.5 — أحمد matching
  // احمد is not expressible as an ILIKE — but it is also the expensive one, and
  // for an Arabic list the two passes above almost always come back empty, so
  // this is the common path rather than a rare fallback.
  //
  // Read narrow, then hydrate: the scan pulls identity columns for up to
  // CHECKIN_SEARCH_SCAN_CAP parties, and only the few that match are re-read
  // with the full embeds.
  if (data.length < limit) {
    const needle = normalizeNameForSearch(raw);
    if (needle) {
      const { data: all, error: scanErr } = await supabase
        .from('rsvp_parties')
        .select(CHECKIN_SEARCH_SCAN_SELECT)
        .eq('event_id', eventId)
        .limit(CHECKIN_SEARCH_SCAN_CAP);
      if (scanErr) throw scanErr;

      const seen = new Set(data.map((p) => p.id));
      const matchedIds = [];
      for (const p of all || []) {
        if (data.length + matchedIds.length >= limit) break;
        if (seen.has(p.id)) continue;

        const partyHit = normalizeNameForSearch(p.label).includes(needle);
        const guestHit = (p.guests || []).some((g) => normalizeNameForSearch(g.full_name).includes(needle));
        if (partyHit || guestHit) matchedIds.push(p.id);
      }

      if (matchedIds.length > 0) {
        const { data: hydrated, error: hydrateErr } = await supabase
          .from('rsvp_parties')
          .select(CHECKIN_SEARCH_SELECT)
          .eq('event_id', eventId)
          .in('id', matchedIds);
        if (hydrateErr) throw hydrateErr;
        data = data.concat(hydrated || []);
      }
    }
  }

  return data.map((p) => {
    const totalGuests = (p.guests || []).length || 1;
    // Undone check-ins are retained as evidence but must not read as arrived
    // (soft delete, migration 20260814000000). Filtered here rather than in the
    // embed because an embedded filter would drop parties with no check-ins.
    const liveCheckIns = (p.check_ins || []).filter((c) => !c.deleted_at);
    const checkedInGuestIds = new Set(liveCheckIns.map((c) => c.guest_id));
    const checkedInCount = (p.guests || []).filter((g) => checkedInGuestIds.has(g.id)).length;
    const seating = Array.isArray(p.seating_assignments) ? p.seating_assignments[0] : p.seating_assignments;
    return {
      id: p.id,
      guestName: p.label,
      partySize: totalGuests,
      response: p.response,
      tableName: seating?.tables?.table_name || 'Unassigned',
      // Real table id (not just its display name) — lets the check-in kiosk
      // highlight the exact table on a wayfinding map, matching by id rather
      // than the fragile/ambiguous table_name string.
      tableId: seating?.tables?.id || null,
      isCheckedIn: checkedInCount > 0,
      checkedInCount,
      totalGuests,
      checkedInAt: liveCheckIns[0]?.checked_in_at || null,
      meals: (p.guests || []).map((g) => ({ fullName: g.full_name, mealSelection: g.meal_selection, dietaryNotes: g.dietary_notes })),
    };
  });
}

/** Resolves a party by id + name match (the mandatory second factor for self-check-in). */
async function getPartyForSelfCheckIn(eventId, partyId, guestName) {
  const { data: party, error } = await supabase
    .from('rsvp_parties')
    .select('id, label, guests(id), seating_assignments(tables(table_name))')
    .eq('id', partyId).eq('event_id', eventId).single();
  if (error || !party) return null;
  if (party.label.trim().toLowerCase() !== String(guestName).trim().toLowerCase()) return { nameMismatch: true };
  const seating = Array.isArray(party.seating_assignments) ? party.seating_assignments[0] : party.seating_assignments;
  return {
    id: party.id, label: party.label, partySize: (party.guests || []).length || 1,
    tableName: seating?.tables?.table_name || 'Unassigned',
  };
}

module.exports = {
  formatCompanionMealCounts,
  sanitizeCompanionMealCounts,
  MAX_ADDITIONAL_GUESTS,
  MAX_CUSTOM_ANSWERS,
  GUEST_CATEGORIES,
  isSeatingRevealed,
  seatingRevealAtISO,
  submitPublicRsvp,
  respondToInvite,
  addGuest,
  getPartyForPublicResolve,
  searchPartiesPublic,
  verifyGuestSeating,
  getPartySeatingMap,
  listParties,
  updateParty,
  deleteParty,
  getStats,
  importGuests,
  parseMealSelections,
  summarizeGuestList,
  deleteAllParties,
  exportParties,
  buildEventExcelExport,
  /* The moment the ticket page will show a guest their table. Exported so the
     scheduler's run-up windows can be ASSERTED against it rather than compared
     by eye — a reminder that names a table must never fire before the page that
     shows it (test/dayBeforeReminder.test.js). */
  SEATING_REVEAL_WINDOW_MS,
  checkInParty,
  undoPartyCheckIn,
  searchGuestsForCheckin,
  getPartyForSelfCheckIn,
};
