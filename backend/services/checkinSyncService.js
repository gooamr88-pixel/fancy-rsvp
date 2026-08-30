/**
 * Offline-first check-in sync service — the server half of the Android door app.
 *
 * Spec: FANCY_RSVP_CHECKIN_SPEC.md v1.0 as amended by
 *       docs/Checkin-Spec-Amendments.md (the amendment record wins).
 *
 * This is deliberately SEPARATE from checkinController/guestService, which
 * serve the existing online web kiosk. That kiosk's model is "one request per
 * check-in, whole party at a time, fail loudly if the network is down" — the
 * exact opposite of what a tablet at a venue with no internet needs. Merging
 * the two would force one of them to compromise. They share the same
 * `check_ins` table (amendment A-7), which is where consistency actually
 * matters.
 *
 * Three rules that shape everything here:
 *
 *   1. Nothing is ever silently dropped. Every element of a batch comes back
 *      with an outcome, including inputs the server cannot place at all — a
 *      queued check-in exists ONLY on that device, so discarding one is
 *      permanent data loss (§21.3).
 *   2. The device's clock is not trusted, but it is not overridden either.
 *      Both times are recorded and the report shows divergence (§10).
 *   3. Token verification lives here, in Node, because QR_JWT_SECRET lives
 *      here. The database records the verdict, never the credential.
 */
const crypto = require('crypto');
const { supabase } = require('../config/supabase');
const tokenService = require('./tokenService');
const deviceService = require('./checkinDeviceService');
const logger = require('../utils/logger');
const { formatCompanionMealCounts } = require('./guestService');

/** Max records accepted in one batch. A device draining 500 sends 5 requests. */
const MAX_BATCH = 100;

/** Bundle page size. Tuned so a 2000-guest event is 4 requests, not 40. */
const BUNDLE_PAGE_SIZE = 500;

/**
 * Returns an absolute HTTPS URL, or null for anything else.
 *
 * The consumer is an Android tablet that fetches this once, at an office, and
 * then renders it offline at a venue. A relative path, a `data:` URI or a blank
 * string are all things it cannot download, so they are normalised to null here
 * rather than shipped for the device to fail on later — where the failure would
 * surface as a missing photograph at a wedding with nobody able to explain it.
 *
 * HTTPS ONLY, and that is not belt-and-braces. The app ships
 * `network_security_config.xml` with `cleartextTrafficPermitted="false"` in every
 * release build (§20.6), so an `http://` URL is not merely unwise — the platform
 * refuses the request outright. Returning it would be handing the device an
 * address it is guaranteed to fail on, which is exactly what this function exists
 * to prevent.
 */
function httpUrlOrNull(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * A finite number, or null — for the seating geometry on the bundle manifest.
 *
 * Postgres `DECIMAL` arrives from PostgREST as a JSON **string**: a table at
 * `position_x` 12.5 comes back as `"12.5"`. Passed through untouched, the
 * device's JSON parser rejects it against a `Double` field and the whole
 * manifest fails to parse — one silently unarmable event, with nothing in the
 * response to explain it.
 *
 * Null is preserved rather than folded to 0, because for a zone's width null
 * means "no explicit size, use the shape catalogue's" while 0 means "a zone of
 * no width". Defaulting here would draw every unsized zone as a point.
 */
function numOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extracts the bare JWT from a scanned value.
 *
 * The QR image encodes `<origin>/ticket/<urlencoded-token>` so an ordinary
 * phone camera opens the guest's own ticket page. Older emailed tickets are
 * bare tokens. Both must resolve — this mirrors extractTicketToken() in
 * frontend/src/app/checkin/page.js, deliberately, because a divergence
 * between the two would mean the web kiosk and the app disagree at the door.
 */
function extractTicketToken(raw) {
  const text = String(raw || '').trim();
  const match = text.match(/\/ticket\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : text;
}

/** SHA-256 hex of a scanned token — stored instead of the token itself. */
function fingerprintToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Verifies a scanned token and reduces it to (fingerprint, verdict).
 *
 * Returns `{ fingerprint, verified }` where `verified` is:
 *   true  — signature, purpose, expiry all good AND it names this event+party
 *   false — presented but did not verify; the arrival is recorded anyway and
 *           flagged as an anomaly on the post-event report (§5.3: the door is
 *           never blocked by uncertainty)
 *   null  — no token presented (manual search, group, override)
 *
 * Because decision D-20 removed on-device verification, this is the ONLY
 * place a forged or tampered scan can ever be detected (amendment A-11).
 */
function verifyScanToken(rawToken, { eventId, partyId }) {
  if (!rawToken) return { fingerprint: null, verified: null };

  const token = extractTicketToken(rawToken);
  const fingerprint = fingerprintToken(token);

  try {
    const decoded = tokenService.verifyQrTicket(token);
    // A validly-signed ticket for a DIFFERENT event or party is still a
    // failure — otherwise one genuine ticket would verify for every guest.
    if (decoded.eventId !== eventId) return { fingerprint, verified: false };
    if (partyId && decoded.partyId !== partyId) return { fingerprint, verified: false };
    return { fingerprint, verified: true };
  } catch {
    return { fingerprint, verified: false };
  }
}

/**
 * Submits a batch of device-generated check-ins.
 *
 * Per-element outcomes: accepted | duplicate | conflict | rejected.
 * Safe to replay from the beginning at any time — `client_checkin_id` is the
 * idempotency key and is enforced by a unique index, not just by this code.
 *
 * @param {string} eventId
 * @param {Array<object>} records
 * @returns {Promise<{results: Array, summary: object, maxSeq: number}>}
 */
async function submitCheckInBatch(eventId, records, { sinceSeq = null, deviceId = null } = {}) {
  if (!Array.isArray(records) || records.length === 0) {
    return { results: [], summary: { accepted: 0, duplicate: 0, conflict: 0, rejected: 0 }, maxSeq: null, delta: null };
  }

  // Resolve each record's party so a scan token can be checked against the
  // guest it claims to admit. One query, not one per record.
  const guestIds = [...new Set(records.map((r) => r.guest_id).filter(Boolean))];
  const partyByGuest = new Map();
  if (guestIds.length > 0) {
    const { data: guests, error } = await supabase
      .from('guests').select('id, party_id').eq('event_id', eventId).in('id', guestIds);
    if (error) throw error;
    for (const g of guests || []) partyByGuest.set(g.id, g.party_id);
  }

  // The event's roster, loaded once. Attribution is resolved against it rather
  // than taken from the payload — see below.
  const roster = await deviceService.getActiveRoster(eventId);

  // Reduce every scan_token to a fingerprint + verdict BEFORE it reaches the
  // database. The raw token never leaves this function.
  const prepared = records.map((r) => {
    const { fingerprint, verified } = verifyScanToken(r.scan_token, {
      eventId,
      partyId: partyByGuest.get(r.guest_id) || null,
    });

    // ── Attribution is server-resolved, never client-asserted (§18.2, §18.6) ──
    //
    // `check_ins.staff_display_name` is the immutable record of who admitted a
    // guest. Writing whatever the payload claimed would make the audit trail a
    // client assertion, and anyone holding a device token could pin an admission
    // on any named person. The name therefore always comes from the roster.
    //
    // An unrecognised staff id does NOT reject the record — a queued check-in
    // exists only on that device (§21.3), and a roster edit between scan and sync
    // is a normal occurrence. The arrival is kept and the attribution is dropped,
    // which is honest: we know someone let them in, we cannot say who.
    const staff = r.staff_id ? roster.get(r.staff_id) : null;

    // `override` is a supervisor action (§9.5). A claim of it from anyone else is
    // downgraded rather than honoured, so the method recorded in the report is
    // one the roster actually supports. The arrival itself still lands — the
    // server-side unique index is what actually prevents a double admission, not
    // this label.
    let method = r.method || 'qr_scan';
    if (method === 'override' && staff?.role !== 'supervisor') {
      method = 'manual_search';
      logger.warn(
        { eventId, staffId: r.staff_id || null },
        '[checkinSync] override claimed without a supervisor on the roster — recorded as manual_search',
      );
    }

    return {
      client_checkin_id: r.client_checkin_id,
      guest_id: r.guest_id,
      checked_in_at: r.checked_in_at || null,
      method,
      staff_id: staff?.staffId || null,
      staff_display_name: staff?.displayName || null,
      device_id: r.device_id || null,
      device_label: r.device_label || null,
      scan_token_fingerprint: fingerprint,
      token_verified: verified,
    };
  });

  const { data, error } = await supabase.rpc('checkin_batch_upsert', {
    p_event_id: eventId,
    p_records: prepared,
  });
  if (error) throw error;
  if (!data || data.ok === false) {
    const err = new Error(data?.error || 'BATCH_FAILED');
    err.code = data?.error || 'BATCH_FAILED';
    throw err;
  }

  const summary = data.summary || {};
  // Anomalies and conflicts are the two things a human needs to know about.
  // Logged with identifiers only — never guest names (§20.7).
  const unverified = prepared.filter((p) => p.token_verified === false).length;
  if (unverified > 0 || (summary.conflict || 0) > 0 || (summary.rejected || 0) > 0) {
    logger.warn({
      eventId,
      unverifiedTokens: unverified,
      conflicts: summary.conflict || 0,
      rejected: summary.rejected || 0,
    }, '[checkinSync] batch completed with anomalies');
  }

  // ── Inline delta (amendment A-15) ──
  //
  // During an arrival rush devices upload constantly, which makes the batch
  // response by far the highest-frequency channel available. Piggy-backing the
  // delta on it converges the fleet in a second or two instead of at the next
  // poll tick, for one extra query and no extra round trip.
  //
  // Computed AFTER the batch has been applied, deliberately: computing it first
  // would hand back a sequence the device immediately overtakes with its own
  // just-accepted writes, and its next delta would re-fetch them.
  let delta = null;
  if (sinceSeq !== null && sinceSeq !== undefined) {
    try {
      const fetched = await getDelta(eventId, sinceSeq, { excludeDeviceId: deviceId });
      delta = {
        changes: fetched.changes,
        maxSeq: fetched.maxSeq,
        truncated: fetched.truncated,
      };
    } catch (err) {
      // A delta failure must never fail a drain that already committed. The
      // device falls back to its poll timer, which is why §17.1 keeps polling as
      // the correctness baseline rather than replacing it.
      logger.warn({ err: err.message, eventId }, '[checkinSync] inline delta failed; batch still applied');
    }
  }

  return { results: data.results || [], summary, maxSeq: data.max_seq ?? null, delta };
}

/**
 * Soft-deletes a check-in with a mandatory reason (§7, §9.6).
 *
 * Replaces the hard DELETE in guestService.undoPartyCheckIn, which erased
 * arrival evidence with no audit row (discovery finding R-1). Idempotent: a
 * retried undo reports success rather than 404-ing.
 */
async function undoCheckIn(eventId, clientCheckinId, {
  actorId, actorStaffId, actorStaffName, reason,
}) {
  const { data, error } = await supabase.rpc('checkin_undo', {
    p_event_id: eventId,
    p_client_checkin_id: clientCheckinId,
    p_actor: actorId || null,
    p_reason: reason || null,
    // Server-resolved by the controller from this event's roster — never taken
    // from the request body, or the audit trail would be a client assertion.
    p_staff_id: actorStaffId || null,
    p_staff_name: actorStaffName || null,
  });
  if (error) throw error;
  return data || { ok: false, error: 'UNKNOWN' };
}

/**
 * Changes since a sequence number (§17.5 polling fallback).
 *
 * Reads both sequence columns: a row appears when it was created
 * (`server_seq`) and again when it was undone (`undo_seq`). Every allocated
 * number belongs to exactly one row in exactly one of those roles, so the
 * sequence space is contiguous and a genuine gap really means a lost message.
 *
 * `truncated` tells the device to immediately fetch again from the returned
 * `max_seq` rather than assuming it is caught up.
 */
async function getDelta(eventId, sinceSeq, { limit = 500, excludeDeviceId = null } = {}) {
  const since = Number.isFinite(Number(sinceSeq)) ? Math.max(Number(sinceSeq), 0) : 0;

  let query = supabase
    .from('check_ins')
    .select('id, guest_id, party_id, checked_in_at, method, server_seq, undo_seq, deleted_at, staff_display_name, device_label, token_verified')
    .eq('event_id', eventId)
    .or(`server_seq.gt.${since},undo_seq.gt.${since}`);

  // Used only by the inline delta: a device does not need its own writes read
  // back to it on the response that carried them up. During a rush that is most
  // of the payload, on the connection least able to spare it.
  //
  // Expressed as an OR rather than .neq: SQL inequality against NULL is NULL,
  // not true, so a plain .neq would also drop every web-kiosk check-in — those
  // rows have no device_id — and silently starve devices of arrivals recorded at
  // the desk. maxSeq is unaffected either way; it comes from the event cursor,
  // so the watermark still advances past the rows skipped here.
  if (excludeDeviceId) {
    query = query.or(`device_id.is.null,device_id.neq.${excludeDeviceId}`);
  }

  const { data, error } = await query
    .order('server_seq', { ascending: true })
    .limit(limit + 1);
  if (error) throw error;

  const rows = data || [];
  const truncated = rows.length > limit;
  const page = truncated ? rows.slice(0, limit) : rows;

  const { data: cursor } = await supabase
    .from('event_checkin_cursors').select('last_seq').eq('event_id', eventId).maybeSingle();
  const bundleVersion = await getBundleVersion(eventId);

  return {
    changes: page.map((r) => ({
      type: r.deleted_at ? 'check_in_undone' : 'check_in',
      serverId: r.id,
      guestId: r.guest_id,
      partyId: r.party_id,
      checkedInAt: r.checked_in_at,
      method: r.method,
      // The position this row occupies in the stream for THIS delta.
      serverSeq: r.deleted_at ? (r.undo_seq ?? r.server_seq) : r.server_seq,
      staffName: r.staff_display_name,
      deviceLabel: r.device_label,
      tokenVerified: r.token_verified,
    })),
    maxSeq: cursor?.last_seq ?? 0,
    bundleVersion,
    truncated,
  };
}

/**
 * The event's current guest-data version (§19.2).
 *
 * Derived from the highest change-log sequence belonging to the event rather
 * than a stored counter — see migration 20260815000000 for why a counter would
 * have put row contention on the RSVP submission path. Gaps between an event's
 * versions are expected: the sequence is global and §19.2 requires monotonic,
 * not contiguous.
 */
async function getBundleVersion(eventId) {
  const { data, error } = await supabase
    .from('event_guest_changes')
    .select('seq')
    .eq('event_id', eventId)
    .order('seq', { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return Number(row?.seq ?? 0);
}

/**
 * Guest-data changes since a bundle version (§19.4).
 *
 * Returns current state for changed guests, not a mutation replay — so it is
 * idempotent and safe to re-run. When the server cannot serve a delta it says
 * so via `requiresFullResync` and the device must perform a full download
 * rather than attempt to reconcile.
 */
async function getGuestDelta(eventId, sinceVersion, { limit = 500 } = {}) {
  const since = Number.isFinite(Number(sinceVersion)) ? Math.max(Number(sinceVersion), 0) : 0;

  const { data, error } = await supabase.rpc('checkin_guest_delta', {
    p_event_id: eventId,
    p_since: since,
    p_limit: limit,
  });
  if (error) throw error;

  if (!data || data.ok === false) {
    const err = new Error(data?.error || 'DELTA_FAILED');
    err.code = data?.error || 'DELTA_FAILED';
    throw err;
  }

  return {
    fromVersion: Number(data.from_version ?? since),
    toVersion: Number(data.to_version ?? 0),
    requiresFullResync: !!data.requires_full_resync,
    reason: data.reason || null,
    changedCount: data.changed_count ?? 0,
    upserts: data.upserts || [],
    removedGuestIds: data.removed_guest_ids || [],
  };
}

/**
 * Emergency controls (§21.5).
 *
 * Returned on every sync response so a device caches the latest instruction and
 * retains it when it goes offline. These can ONLY stop network activity —
 * scanning, local duplicate detection, and queueing continue unconditionally.
 * Nothing here can stop a door.
 */
async function getSyncControls(eventId) {
  const { data, error } = await supabase
    .from('event_checkin_cursors')
    .select('sync_disabled, realtime_disabled, polling_only')
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) throw error;

  return {
    syncDisabled: !!data?.sync_disabled,
    realtimeDisabled: !!data?.realtime_disabled,
    pollingOnly: !!data?.polling_only,
  };
}

async function setSyncControls(eventId, { syncDisabled, realtimeDisabled, pollingOnly, note, actorId }) {
  const patch = { event_id: eventId, controls_set_by: actorId || null, controls_set_at: new Date().toISOString() };
  if (syncDisabled !== undefined) patch.sync_disabled = !!syncDisabled;
  if (realtimeDisabled !== undefined) patch.realtime_disabled = !!realtimeDisabled;
  if (pollingOnly !== undefined) patch.polling_only = !!pollingOnly;
  if (note !== undefined) patch.controls_note = note ? String(note).slice(0, 500) : null;

  // Upsert: an event that has never had a check-in has no cursor row yet, and
  // an admin must still be able to arm the kill switch ahead of an event.
  const { error } = await supabase
    .from('event_checkin_cursors')
    .upsert(patch, { onConflict: 'event_id' });
  if (error) throw error;

  return getSyncControls(eventId);
}

/**
 * Conflicts awaiting a human (spec §5.3 Layer 4, amendment A-16 item 5).
 *
 * A conflict means two devices, both offline, both admitted the same guest. The
 * server kept the first and recorded the second here. Resolving it is a judgement
 * call — was the guest admitted twice, or did a supervisor rescan someone
 * legitimately? — so this surface gives a human both sides and records what they
 * decided, rather than picking for them.
 *
 * Guest names are joined in here rather than stored on the conflict row: the row
 * holds ids so it stays correct if a guest is later renamed.
 */
async function listConflicts(eventId, { includeResolved = false } = {}) {
  let query = supabase
    .from('event_check_in_conflicts')
    .select(`
      id, guest_id, winning_check_in_id,
      winning_staff_display_name, winning_device_label, winning_checked_in_at,
      rejected_client_checkin_id, rejected_checked_in_at,
      rejected_staff_display_name, rejected_device_label, rejected_method,
      rejected_at, resolved_at, resolved_by, resolution_note,
      guests(full_name, party_id, rsvp_parties(label))
    `)
    .eq('event_id', eventId)
    .order('rejected_at', { ascending: false });

  if (!includeResolved) query = query.is('resolved_at', null);

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((c) => ({
    id: c.id,
    guestId: c.guest_id,
    guestName: c.guests?.full_name || null,
    partyLabel: c.guests?.rsvp_parties?.label || null,
    kept: {
      staffName: c.winning_staff_display_name,
      gate: c.winning_device_label,
      checkedInAt: c.winning_checked_in_at,
    },
    rejected: {
      staffName: c.rejected_staff_display_name,
      gate: c.rejected_device_label,
      checkedInAt: c.rejected_checked_in_at || c.rejected_at,
      method: c.rejected_method,
      clientCheckinId: c.rejected_client_checkin_id,
    },
    resolvedAt: c.resolved_at,
    resolvedBy: c.resolved_by,
    resolutionNote: c.resolution_note,
  }));
}

/**
 * Marks a conflict as resolved, recording who and when (§5.3 Layer 4).
 *
 * Deliberately does NOT change any check-in. The arrival record is what it is;
 * resolving a conflict is an acknowledgement that a human has looked at it, not a
 * retroactive edit. If an admission genuinely needs reversing, that is the undo
 * flow, which is separately audited.
 */
async function resolveConflict(eventId, conflictId, { actorId, note }) {
  const { data, error } = await supabase
    .from('event_check_in_conflicts')
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: actorId || null,
      resolution_note: note ? String(note).slice(0, 500) : null,
    })
    .eq('id', conflictId)
    .eq('event_id', eventId)
    .is('resolved_at', null)
    .select('id');
  if (error) throw error;

  // Zero rows means it was already resolved, or belongs to another event.
  // Treated as success for the first case would hide the second, so the caller
  // distinguishes them with a 404.
  if (!data || data.length === 0) return { ok: false, error: 'NOT_FOUND' };
  return { ok: true };
}

/**
 * Anomalies for the supervisor view (§19.5, amendment A-16 item 5).
 *
 * Two kinds, both of which look fine on an attendance total and are wrong
 * underneath it:
 *
 *  • A scanned ticket that failed server-side verification. Since decision D-20
 *    removed on-device verification, this is the only place a forged scan ever
 *    becomes visible.
 *  • A guest who was checked in and then removed from the guest list. §19.5 keeps
 *    the check-in because the person is physically inside the venue — deleting it
 *    would produce a report that contradicts the room.
 */
async function listAnomalies(eventId) {
  const { data, error } = await supabase
    .from('check_ins')
    .select('id, guest_id, checked_in_at, staff_display_name, device_label, token_verified, deleted_at, undo_reason, undone_by_staff_name, guests(full_name)')
    .eq('event_id', eventId)
    .or('token_verified.is.false,deleted_at.not.is.null');
  if (error) throw error;

  return (data || []).map((row) => ({
    id: row.id,
    guestId: row.guest_id,
    guestName: row.guests?.full_name || null,
    checkedInAt: row.checked_in_at,
    staffName: row.staff_display_name,
    gate: row.device_label,
    kind: row.token_verified === false ? 'unverified_scan' : 'reversed',
    // A guest row that no longer resolves was removed after checking in (§19.5).
    guestRemoved: !row.guests,
    reason: row.undo_reason,
    // Who reversed it. Null for an organizer undo from the dashboard, where the
    // actor is a platform user rather than a roster supervisor.
    reversedBy: row.undone_by_staff_name || null,
  }));
}

/**
 * Canonical serialisation for the bundle content hash (§21.1).
 *
 * A bundle download interrupted at 60% presents as a WORKING app holding an
 * incomplete guest list, and nobody discovers it until guests are told "not
 * found" at a venue with no internet to fix it. That makes this the most
 * dangerous silent failure in the system, so the hash has to be over a
 * serialisation both sides can reproduce byte-for-byte: fixed key order,
 * sorted by id, no incidental whitespace.
 */
function canonicalizeGuests(guests) {
  return JSON.stringify(
    [...guests]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((g) => [g.id, g.partyId, g.fullName, g.tableName || '', g.category || 'standard']),
  );
}

/**
 * One page of the offline preparation bundle (§7, §21.1).
 *
 * Paginated and resumable: the device asks for a page, verifies the whole set
 * against `record_count` + `content_hash` once it has them all, and only then
 * promotes the staging data to live. A partially valid bundle is never
 * accepted.
 *
 * Guest photos are deliberately absent — no such column exists (amendment
 * A-3) — and branding comes from the org profile, not per-event (D-19).
 */
async function getBundlePage(eventId, { page = 1, limit = BUNDLE_PAGE_SIZE } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || BUNDLE_PAGE_SIZE, 1), BUNDLE_PAGE_SIZE);
  const safePage = Math.max(Number(page) || 1, 1);
  const from = (safePage - 1) * safeLimit;
  const to = from + safeLimit - 1;

  const { data: rows, error, count } = await supabase
    .from('guests')
    .select(`
      id, party_id, full_name, category, meal_selection, dietary_notes, is_primary_contact,
      rsvp_parties!inner(id, label, response, notes, side, companion_meal_counts,
                         seating_assignments(tables(id, table_name, element_type)))
    `, { count: 'exact' })
    .eq('event_id', eventId)
    .order('id', { ascending: true })
    .range(from, to);
  if (error) throw error;

  const guests = (rows || []).map((g) => {
    const party = g.rsvp_parties || {};
    const sa = Array.isArray(party.seating_assignments) ? party.seating_assignments[0] : party.seating_assignments;
    const tbl = sa?.tables;
    // `tables` doubles as the venue-layout table (stage, dance_floor, bar…).
    // Only element_type='table' is a seatable destination; anything else must
    // not be read out to a guest as their table.
    const seatable = tbl && tbl.element_type === 'table' ? tbl : null;
    return {
      id: g.id,
      partyId: g.party_id,
      partyLabel: party.label || null,
      fullName: g.full_name,
      isPrimaryContact: !!g.is_primary_contact,
      category: g.category || 'standard',
      response: party.response || 'pending',
      tableId: seatable?.id || null,
      tableName: seatable?.table_name || null,
      mealSelection: g.meal_selection || null,
      dietaryNotes: g.dietary_notes || null,
      partyNotes: party.notes || null,
      side: party.side || null,
      // Party-level, not this guest's own choice: companions are names only, so
      // their meals are a tally for the group. `mealSelection` above stays the
      // named pick (in practice the primary contact's) and is null for a
      // companion — which is accurate, not missing data. Sent as a ready string
      // because it is displayed verbatim, and because a new String? field costs
      // the Android side nothing while a Map would need a new serializable type.
      //
      // Safe to add: the bundle hash canonicalizes only [id, partyId, fullName,
      // tableName, category] (canonicalizeGuests), and the app's Json is
      // configured ignoreUnknownKeys precisely so the backend can add a field
      // without breaking a tablet that has been offline for a week (AppModule.kt).
      partyMealSummary: formatCompanionMealCounts(party.companion_meal_counts) || null,
    };
  });

  const total = Number.isFinite(Number(count)) ? Number(count) : guests.length;
  const totalPages = Math.max(Math.ceil(total / safeLimit), 1);

  return {
    guests,
    pagination: { page: safePage, limit: safeLimit, total, totalPages, hasMore: safePage < totalPages },
    pageHash: crypto.createHash('sha256').update(canonicalizeGuests(guests)).digest('hex'),
  };
}

/**
 * The bundle manifest: everything a device needs that is NOT the guest list,
 * plus the integrity figures it must check the guest list against (§21.1).
 *
 * Fetched first. `record_count` and `content_hash` cover the FULL guest set,
 * so the device can prove completeness after paging through it.
 */
async function getBundleManifest(eventId) {
  const { data: event, error: eventErr } = await supabase
    .from('events')
    .select('id, title, event_date, timezone, location_name, location_address, custom_colors, cover_image_url, status, is_paid, tier_name, no_kids_allowed')
    .eq('id', eventId)
    .single();
  if (eventErr || !event) {
    const err = new Error('EVENT_NOT_FOUND');
    err.code = 'EVENT_NOT_FOUND';
    throw err;
  }

  // The hash must cover every guest, so this reads the whole set once. At the
  // realistic ceiling (a few thousand) that is a single cheap query; §21.10
  // explicitly rejects designing for 100k.
  const { data: allGuests, error: guestErr } = await supabase
    .from('guests')
    .select('id, party_id, full_name, category, rsvp_parties!inner(seating_assignments(tables(table_name, element_type)))')
    .eq('event_id', eventId);
  if (guestErr) throw guestErr;

  const flat = (allGuests || []).map((g) => {
    const sa = Array.isArray(g.rsvp_parties?.seating_assignments)
      ? g.rsvp_parties.seating_assignments[0]
      : g.rsvp_parties?.seating_assignments;
    const tbl = sa?.tables;
    return {
      id: g.id,
      partyId: g.party_id,
      fullName: g.full_name,
      category: g.category || 'standard',
      tableName: tbl && tbl.element_type === 'table' ? tbl.table_name : '',
    };
  });

  const [{ data: cursor }, { data: staff }, { data: tables }, { data: existingCheckIns }, bundleVersion] = await Promise.all([
    supabase.from('event_checkin_cursors').select('last_seq').eq('event_id', eventId).maybeSingle(),
    supabase.from('event_staff').select('id, display_name, role, pin_hash').eq('event_id', eventId).eq('is_active', true),
    /*
     * THE VENUE LAYOUT, NOT JUST THE TABLE LIST.
     *
     * This used to be `id, table_name, max_capacity` filtered to
     * `element_type = 'table'` — the names of the seatable tables and nothing
     * else. The device stored them in `venue_tables` and read them back
     * nowhere: a table's NAME already rides on every guest row, so the list was
     * dead weight from the day it was written.
     *
     * The tablet draws the room now (the plan under the table numeral on the
     * scan result), and a room is not a list of tables. Two things change:
     *
     *  • THE FILTER GOES. The stage, the dance floor, the entrance and the bar
     *    are what make a plan legible as a venue rather than as scattered
     *    circles — and the entrance in particular is the one an usher points
     *    at. They are `element_type = 'zone'` rows in this same table.
     *  • THE GEOMETRY COMES WITH IT. `position_x/y` are percentages of the
     *    2600x1700 world and address the element's TOP-LEFT corner; zones carry
     *    their own width/height while tables take theirs from the shape
     *    catalogue. Read the coordinate convention off
     *    frontend/src/app/utils/seatingGeometry.js before touching any of it —
     *    reading position as a CENTRE does not shift the layout, it scrambles it.
     *
     * `shape` is free to be a value this backend has never heard of: the
     * catalogue is edited in one place and the device falls back to a round
     * table for anything it cannot name, exactly as the web maps do.
     *
     * Ordered so a bundle is byte-stable across re-prepares — the device has no
     * opinion about order, but a diffable manifest is worth the index scan.
     *
     * NOT part of the integrity contract: `contentHash` covers the guest set
     * only (see canonicalizeGuests). Widening this cannot invalidate a bundle.
     */
    supabase
      .from('tables')
      .select('id, table_name, max_capacity, element_type, shape, position_x, position_y, width, height, rotation, color')
      .eq('event_id', eventId)
      .order('id', { ascending: true }),
    // Arrivals ALREADY recorded (spec §7: the bundle returns "any check-ins
    // already recorded"). Without these a freshly-armed device does not know
    // who came in through the web kiosk before it existed, and would admit an
    // already-arrived guest with no duplicate warning at all.
    supabase
      .from('check_ins')
      .select('guest_id, party_id, checked_in_at, method, server_seq, staff_display_name, device_label')
      .eq('event_id', eventId)
      .is('deleted_at', null),
    getBundleVersion(eventId),
  ]);

  return {
    event: {
      id: event.id,
      name: event.title,
      startsAt: event.event_date,
      // The event's own clock. Without it the tablet formats startsAt in the
      // DEVICE's timezone — and a check-in tablet is a rented or borrowed
      // Android device whose zone nobody has ever checked.
      timezone: event.timezone || null,
      venue: event.location_name || null,
      venueAddress: event.location_address || null,
      brandingPrimaryColor: (event.custom_colors && event.custom_colors.primary) || null,
      // The event's own photograph — the couple, on a wedding. Same column the
      // invitation and the share card use, so the tablet shows the picture the
      // guests have already seen rather than a second one nobody chose.
      //
      // Only ever an absolute http(s) URL. The device downloads this ONCE during
      // preparation and renders from disk thereafter (§9.8: branding must render
      // with no network access), so a relative path or a data: URI would give it
      // nothing it could fetch at an office and nothing to show at a venue.
      coverImageUrl: httpUrlOrNull(event.cover_image_url),
      noKidsAllowed: !!event.no_kids_allowed,
    },
    // Roster ships as HASHES only. A plaintext PIN must never be transmitted
    // or stored (§18.5); the device compares against the hash offline.
    staff: (staff || []).map((s) => ({
      staffId: s.id, displayName: s.display_name, role: s.role, pinHash: s.pin_hash,
    })),
    /*
     * `name` is kept as the key rather than `tableName` — the device has parsed
     * it under that name since the first bundle, and a tablet in the field
     * ignores fields it does not know but cannot invent one it stops receiving.
     *
     * Numbers are coerced HERE, once. Postgres DECIMAL comes back from
     * PostgREST as a JSON string, and a device that concatenates "12.5" + 0
     * instead of adding draws the room somewhere off the canvas. `numOrNull`
     * keeps null meaning "not set" — which for a zone's width means "use the
     * catalogue's", a distinction 0 would destroy.
     */
    tables: (tables || []).map((t) => ({
      id: t.id,
      name: t.table_name,
      capacity: t.max_capacity,
      elementType: t.element_type || 'table',
      shape: t.shape || null,
      positionX: numOrNull(t.position_x),
      positionY: numOrNull(t.position_y),
      width: numOrNull(t.width),
      height: numOrNull(t.height),
      rotation: numOrNull(t.rotation),
      color: t.color || null,
    })),
    // Seeded into the device's local check_ins so its Layer 1 duplicate guard
    // (§5.3) is correct from the first scan, not only from the first delta.
    existingCheckIns: (existingCheckIns || []).map((c) => ({
      guestId: c.guest_id,
      partyId: c.party_id,
      checkedInAt: c.checked_in_at,
      method: c.method,
      serverSeq: c.server_seq,
      staffName: c.staff_display_name,
      deviceLabel: c.device_label,
    })),
    integrity: {
      recordCount: flat.length,
      contentHash: crypto.createHash('sha256').update(canonicalizeGuests(flat)).digest('hex'),
      pageSize: BUNDLE_PAGE_SIZE,
      totalPages: Math.max(Math.ceil(flat.length / BUNDLE_PAGE_SIZE), 1),
    },
    bundleVersion,
    lastSeq: cursor?.last_seq ?? 0,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  MAX_BATCH,
  BUNDLE_PAGE_SIZE,
  extractTicketToken,
  fingerprintToken,
  verifyScanToken,
  submitCheckInBatch,
  undoCheckIn,
  getDelta,
  getBundleVersion,
  getGuestDelta,
  getSyncControls,
  setSyncControls,
  getBundlePage,
  getBundleManifest,
  listConflicts,
  resolveConflict,
  listAnomalies,
  canonicalizeGuests,
};
