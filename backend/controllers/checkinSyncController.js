/**
 * Offline-first check-in sync endpoints (`/api/v1/checkin/...`).
 *
 * Spec: FANCY_RSVP_CHECKIN_SPEC.md v1.0 as amended by
 *       docs/Checkin-Spec-Amendments.md.
 *
 * Versioned independently of the organizer API (amendment A-6, spec §21.4): a
 * breaking change here creates /v2 while /v1 keeps serving tablets that may not
 * have been updated for weeks and may be sitting offline at a venue. Every
 * response carries MIN_SUPPORTED_APP_VERSION so a device can tell it is behind
 * — but the app must only ever act on that during PREPARATION. Blocking a
 * device that is already at a venue is the one thing §21.4 forbids outright.
 */
const { supabase } = require('../config/supabase');
const checkinSync = require('../services/checkinSyncService');
const checkinDevice = require('../services/checkinDeviceService');
const checkinReport = require('../services/checkinReportService');
const { generateCheckinReport } = require('../utils/checkinReportExcel');
const { sendOk, sendFail } = require('../utils/responseEnvelope');
const { broadcast } = require('../utils/realtime');
const logger = require('../utils/logger');

/** Bumped only when a device below this version genuinely cannot work. */
const MIN_SUPPORTED_APP_VERSION = '1.0.0';
const API_CONTRACT_VERSION = 1;

const syncMeta = (extra = {}) => ({
  min_supported_app_version: MIN_SUPPORTED_APP_VERSION,
  api_contract_version: API_CONTRACT_VERSION,
  server_time: new Date().toISOString(),
  ...extra,
});

/**
 * GET /api/v1/checkin/events
 * Events this caller may prepare a device for.
 */
const listCheckinEvents = async (req, res, next) => {
  try {
    const { data: orgs, error: orgErr } = await supabase
      .from('organizations').select('id').eq('owner_user_id', req.user.id).limit(1);
    if (orgErr) throw orgErr;

    const org = orgs && orgs[0];
    if (!org) return sendOk(res, { events: [] }, { meta: syncMeta() });

    const { data: events, error } = await supabase
      .from('events')
      .select('id, title, event_date, timezone, location_name, status, is_paid, tier_name, manual_override')
      .eq('org_id', org.id)
      .order('event_date', { ascending: true });
    if (error) throw error;

    return sendOk(res, {
      events: (events || []).map((e) => ({
        id: e.id,
        name: e.title,
        venue: e.location_name || null,
        startsAt: e.event_date,
        timezone: e.timezone || null,
        status: e.status,
        isPaid: !!e.is_paid || !!e.manual_override,
        tierName: e.tier_name || null,
      })),
    }, { meta: syncMeta() });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/checkin/events/:eventId/bundle/manifest
 *
 * Fetched FIRST. Carries the integrity figures the device must verify the
 * guest list against before it may mark the event ready offline (§21.1).
 */
const getBundleManifest = async (req, res, next) => {
  try {
    const manifest = await checkinSync.getBundleManifest(req.params.eventId);
    return sendOk(res, manifest, { meta: syncMeta() });
  } catch (err) {
    if (err.code === 'EVENT_NOT_FOUND') {
      return sendFail(res, { status: 404, error: 'EVENT_NOT_FOUND', message: 'Event not found.' });
    }
    next(err);
  }
};

/**
 * GET /api/v1/checkin/events/:eventId/bundle?page=1
 *
 * One page of guests. Resumable by construction — pages are ordered by a
 * stable key (guest id) so re-requesting page N after an interruption returns
 * the same rows, and the device can resume rather than restart.
 */
const getBundlePage = async (req, res, next) => {
  try {
    const result = await checkinSync.getBundlePage(req.params.eventId, {
      page: req.query.page,
      limit: req.query.limit,
    });
    return sendOk(res, result, { meta: syncMeta() });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/checkin/events/:eventId/check-ins
 *
 * The batch drain. Per-element outcomes, because a batch can be partially
 * conflicted and a single overall status would force the device to either
 * re-send everything or lose the successes.
 */
const postCheckInBatch = async (req, res, next) => {
  const { eventId } = req.params;
  const records = req.body?.records;

  if (!Array.isArray(records)) {
    return sendFail(res, {
      status: 400, error: 'VALIDATION_ERROR',
      message: 'records must be an array.',
    });
  }
  if (records.length === 0) {
    return sendOk(res, {
      results: [], summary: { accepted: 0, duplicate: 0, conflict: 0, rejected: 0 }, delta: null,
    }, { meta: syncMeta() });
  }
  if (records.length > checkinSync.MAX_BATCH) {
    // A cap, not a rejection of the work: the device splits and retries. Told
    // explicitly what the limit is so it does not have to guess.
    return sendFail(res, {
      status: 413, error: 'BATCH_TOO_LARGE',
      message: `A batch may contain at most ${checkinSync.MAX_BATCH} records.`,
      meta: { max_batch: checkinSync.MAX_BATCH },
    });
  }

  // A-15: the device tells us where it is in the stream so the response can carry
  // the delta inline. Omitted (null) means "no delta please" — an older client, or
  // a device that has not yet established a baseline.
  const rawSince = req.body?.since_seq ?? req.body?.sinceSeq;
  const sinceSeq = Number.isFinite(Number(rawSince)) ? Math.max(Number(rawSince), 0) : null;

  try {
    const { results, summary, maxSeq, delta } =
      await checkinSync.submitCheckInBatch(eventId, records, {
        sinceSeq,
        // Null for an organizer/kiosk caller, which then gets the unfiltered
        // delta — correct, since it has no local copy of anything.
        deviceId: req.device?.id || null,
      });

    // Layer 2 propagation (§5.3): tell the other devices on this event. Only
    // the accepted ones are news; duplicates and conflicts mean the receiving
    // devices already know. Fire-and-forget — a dropped broadcast must never
    // fail a drain that already committed.
    const accepted = results.filter((r) => r.status === 'accepted');
    if (accepted.length > 0) {
      broadcast(eventId, 'checkin_batch_synced', {
        count: accepted.length,
        maxSeq,
        // Ids only. Guest names must not travel over a channel whose
        // authorisation model is still unresolved (discovery finding R-2).
        guestIds: accepted.map((r) => r.guest_id).filter(Boolean),
      });
    }

    // `delta` is part of the documented response schema (A-15), not an optional
    // extra — a client may rely on the key being present whenever it asked for one.
    return sendOk(res, { results, summary, maxSeq, delta }, { meta: syncMeta() });
  } catch (err) {
    if (err.code === 'EVENT_NOT_FOUND') {
      return sendFail(res, { status: 404, error: 'EVENT_NOT_FOUND', message: 'Event not found.' });
    }
    if (err.code === 'INVALID_PAYLOAD') {
      return sendFail(res, { status: 400, error: 'INVALID_PAYLOAD', message: 'Malformed batch payload.' });
    }
    next(err);
  }
};

/**
 * DELETE /api/v1/checkin/events/:eventId/check-ins/:clientCheckinId
 *
 * Supervisor undo. Soft delete with a mandatory reason and a full audit trail
 * — never a hard delete (§7, §9.6). This replaces the behaviour of the legacy
 * POST /checkin/undo, which hard-deleted with no audit row at all.
 *
 * Two callers, two ways of establishing the right to undo:
 *
 *   • The organizer, over a session. `verifyEventOwner` has already proven they
 *     own the event, and the event owner outranks any roster role.
 *   • A device, over a device token. The token proves only that the tablet is
 *     paired — it says nothing about who is holding it, and every usher's tablet
 *     has one. The acting staff id must therefore be supplied and checked against
 *     the roster (§18.2: a client-side role check "must never be the sole gate").
 *
 * The Android side gates this in `GuestListScreen`'s `canUndo`, but that gate is
 * a convenience for the person at the door, not a security boundary.
 */
const deleteCheckIn = async (req, res, next) => {
  const { eventId, clientCheckinId } = req.params;
  const reason = req.body?.reason;

  if (!reason || !String(reason).trim()) {
    return sendFail(res, {
      status: 400, error: 'REASON_REQUIRED',
      message: 'An undo requires a reason — it is recorded in the audit trail.',
    });
  }

  // Resolve who is undoing, and prove they are allowed to.
  let actorId = req.user?.id || null;
  let actorStaff = null;

  if (!req.user) {
    const auth = await checkinDevice.authorizeStaff(
      eventId, req.body?.staffId || null, 'supervisor',
    );
    if (!auth.ok) {
      logger.warn(
        { eventId, clientCheckinId, deviceId: req.device?.id || null, staffId: req.body?.staffId || null, reason: auth.error },
        '[checkinSync] undo refused',
      );
      return auth.error === 'UNKNOWN_STAFF'
        ? sendFail(res, {
          status: 403, error: 'UNKNOWN_STAFF',
          message: 'An undo must identify an active staff member on this event.',
        })
        : sendFail(res, {
          status: 403, error: 'SUPERVISOR_REQUIRED',
          message: 'Only a supervisor can undo a check-in.',
        });
    }
    actorStaff = auth.staff;
  }

  try {
    const result = await checkinSync.undoCheckIn(eventId, clientCheckinId, {
      actorId,
      actorStaffId: actorStaff?.staffId || null,
      actorStaffName: actorStaff?.displayName || null,
      reason: String(reason).trim(),
      /*
       * The check-in's own server id, when the device knows it.
       *
       * A tablet can only name a `client_checkin_id` for check-ins IT created.
       * Everything else it holds — an arrival seeded when it was prepared, or
       * one that arrived from another gate in the delta — carries an id the
       * device invented locally, and the server has never seen it. Sending the
       * server id is what makes those reversible at all; without it the request
       * 404s and the guest stays counted as present.
       *
       * Not a security concern: it names WHICH check-in, and the row is still
       * scoped to `eventId` inside the function. Who is allowed to reverse it
       * has already been settled above, from the session or the roster.
       */
      serverId: req.body?.serverId || null,
    });

    if (result.ok === false) {
      if (result.error === 'NOT_FOUND') {
        return sendFail(res, { status: 404, error: 'NOT_FOUND', message: 'No check-in found for that id.' });
      }
      if (result.error === 'REASON_REQUIRED') {
        return sendFail(res, { status: 400, error: 'REASON_REQUIRED', message: 'A reason is required.' });
      }
      return sendFail(res, { status: 400, error: result.error || 'UNDO_FAILED' });
    }

    // Audit row alongside the soft delete. Best-effort, matching how every
    // other activity_logs write in this codebase behaves — the undo itself is
    // already durably recorded on the check_ins row.
    supabase.from('activity_logs').insert({
      event_id: eventId,
      actor_id: req.user?.id || null,
      action: 'checkin_undone',
      entity_type: 'check_in',
      entity_id: result.server_id || null,
      metadata: { reason: String(reason).trim(), client_checkin_id: clientCheckinId },
    }).then(({ error }) => {
      if (error) logger.warn({ err: error, eventId }, '[checkinSync] undo audit log write failed');
    });

    if (!result.already_undone) {
      broadcast(eventId, 'checkin_undone', {
        serverId: result.server_id, guestId: result.guest_id, serverSeq: result.server_seq,
      });
    }

    return sendOk(res, {
      serverId: result.server_id,
      alreadyUndone: !!result.already_undone,
      serverSeq: result.server_seq ?? null,
    }, { meta: syncMeta() });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/checkin/events/:eventId/delta?since_seq=N
 *
 * The polling fallback (§17.5) — built and shipped regardless of whether
 * realtime works, because realtime is an optimisation and never a correctness
 * dependency (§17.1). When nothing has changed this returns an empty changes
 * array, not a guest list.
 */
const getDelta = async (req, res, next) => {
  try {
    const result = await checkinSync.getDelta(req.params.eventId, req.query.since_seq);
    return sendOk(res, result, { meta: syncMeta() });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/checkin/events/:eventId/guest-delta?since_version=N
 *
 * Guest-data changes since a bundle version (§19.4). Returns current state for
 * changed guests, so it is idempotent and safe to re-run.
 *
 * When `requiresFullResync` is true the device must perform a full bundle
 * download and must NOT attempt to reconcile — a half-updated guest list is
 * worse than a stale one (§19.4).
 */
const getGuestDelta = async (req, res, next) => {
  try {
    const result = await checkinSync.getGuestDelta(req.params.eventId, req.query.since_version, {
      limit: Number(req.query.limit) || 500,
    });
    return sendOk(res, result, { meta: syncMeta() });
  } catch (err) {
    if (err.code === 'EVENT_NOT_FOUND') {
      return sendFail(res, { status: 404, error: 'EVENT_NOT_FOUND', message: 'Event not found.' });
    }
    next(err);
  }
};

/**
 * GET /api/v1/checkin/events/:eventId/controls
 *
 * Emergency control state (§21.5). Devices cache this so one that goes offline
 * keeps the last instruction rather than reverting to a default.
 */
const getControls = async (req, res, next) => {
  try {
    return sendOk(res, await checkinSync.getSyncControls(req.params.eventId), { meta: syncMeta() });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/checkin/events/:eventId/controls
 *
 * The kill switch. Organizer/admin only, recorded with the acting identity.
 *
 * Its maximum effect is to stop NETWORK activity across the event's devices.
 * Scanning, local duplicate detection, and queueing continue unconditionally —
 * a device with sync disabled behaves exactly as it does offline, which the
 * whole architecture already assumes. It cannot stop a door, by construction.
 */
const setControls = async (req, res, next) => {
  const { syncDisabled, realtimeDisabled, pollingOnly, note } = req.body || {};

  if ([syncDisabled, realtimeDisabled, pollingOnly].every((v) => v === undefined)) {
    return sendFail(res, {
      status: 400, error: 'VALIDATION_ERROR',
      message: 'At least one of syncDisabled, realtimeDisabled, pollingOnly is required.',
    });
  }

  try {
    const controls = await checkinSync.setSyncControls(req.params.eventId, {
      syncDisabled, realtimeDisabled, pollingOnly, note, actorId: req.user?.id || null,
    });

    supabase.from('activity_logs').insert({
      event_id: req.params.eventId,
      actor_id: req.user?.id || null,
      action: 'checkin_controls_changed',
      entity_type: 'event',
      entity_id: req.params.eventId,
      metadata: { ...controls, note: note || null },
    }).then(({ error }) => {
      if (error) logger.warn({ err: error }, '[checkinSync] controls audit write failed');
    });

    // Tell the fleet immediately; devices also pick it up on their next sync.
    broadcast(req.params.eventId, 'checkin_controls_changed', controls);

    logger.warn({ eventId: req.params.eventId, ...controls, actorId: req.user?.id || null },
      '[checkinSync] emergency controls changed');

    return sendOk(res, controls, { meta: syncMeta() });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/checkin/events/:eventId/report?format=xlsx|json
 *
 * The post-event attendance report (§9.7).
 *
 * `json` exists so the organizer dashboard can render the same figures inline
 * without downloading a workbook — one computation, two presentations, so the
 * number on screen can never disagree with the number in the file.
 *
 * PDF is NOT implemented: no PDF library is a dependency of this project, and
 * adding a native/heavyweight one to a pm2 cluster deploy is a decision for the
 * project owner, not a side effect of this endpoint. Requesting it returns a
 * clear 501 rather than silently handing back the wrong format.
 */
const getReport = async (req, res, next) => {
  const format = String(req.query.format || 'xlsx').toLowerCase();

  if (format === 'pdf') {
    return sendFail(res, {
      status: 501, error: 'FORMAT_NOT_IMPLEMENTED',
      message: 'PDF export is not available yet. Use format=xlsx.',
    });
  }
  if (!['xlsx', 'json'].includes(format)) {
    return sendFail(res, {
      status: 400, error: 'VALIDATION_ERROR',
      message: 'format must be xlsx or json.',
    });
  }

  try {
    const report = await checkinReport.gatherReportData(req.params.eventId);

    if (format === 'json') {
      return sendOk(res, report, { meta: syncMeta() });
    }

    const buffer = await generateCheckinReport(report);
    // Allowlist, not a blocklist: the title is organizer-supplied and lands in
    // a Content-Disposition header, where a quote or CRLF would let it break
    // out of the filename. Runs of whitespace are collapsed so stripping a
    // character like "&" does not leave a double space in the name.
    const safeName = (report.event.title || 'event')
      .replace(/[^\p{L}\p{N} _-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'event';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="checkin-report-${safeName}.xlsx"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(Buffer.from(buffer));
  } catch (err) {
    if (err.code === 'EVENT_NOT_FOUND') {
      return sendFail(res, { status: 404, error: 'EVENT_NOT_FOUND', message: 'Event not found.' });
    }
    if (err.code === 'FILE_TOO_LARGE') {
      return sendFail(res, { status: 413, error: 'FILE_TOO_LARGE', message: err.message });
    }
    next(err);
  }
};

/**
 * GET /api/v1/checkin/events/:eventId/conflicts?includeResolved=1
 *
 * Duplicate admissions awaiting a human (§5.3 Layer 4, A-16 item 5), alongside
 * the §19.5 anomalies — both answer "is the attendance figure trustworthy?", so
 * they are returned together rather than making a supervisor check two screens.
 */
const getConflicts = async (req, res, next) => {
  try {
    const includeResolved = req.query.includeResolved === '1' || req.query.includeResolved === 'true';
    const [conflicts, anomalies] = await Promise.all([
      checkinSync.listConflicts(req.params.eventId, { includeResolved }),
      checkinSync.listAnomalies(req.params.eventId),
    ]);
    return sendOk(res, { conflicts, anomalies }, { meta: syncMeta() });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/checkin/events/:eventId/conflicts/:conflictId/resolve
 *
 * Records that a human has looked at a conflict. Changes no check-in — reversing
 * an admission is the separately-audited undo flow.
 */
const resolveConflict = async (req, res, next) => {
  try {
    const result = await checkinSync.resolveConflict(
      req.params.eventId,
      req.params.conflictId,
      { actorId: req.user?.id || null, note: req.body?.note },
    );

    if (!result.ok) {
      return sendFail(res, {
        status: 404, error: 'NOT_FOUND',
        message: 'That conflict was not found, or it has already been resolved.',
      });
    }

    supabase.from('activity_logs').insert({
      event_id: req.params.eventId,
      actor_id: req.user?.id || null,
      action: 'checkin_conflict_resolved',
      entity_type: 'event_check_in_conflict',
      entity_id: req.params.conflictId,
      metadata: { note: req.body?.note || null },
    }).then(({ error }) => {
      if (error) logger.warn({ err: error }, '[checkinSync] conflict resolve audit write failed');
    });

    return sendOk(res, { resolved: true });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  MIN_SUPPORTED_APP_VERSION,
  API_CONTRACT_VERSION,
  getConflicts,
  resolveConflict,
  getReport,
  listCheckinEvents,
  getBundleManifest,
  getBundlePage,
  postCheckInBatch,
  deleteCheckIn,
  getDelta,
  getGuestDelta,
  getControls,
  setControls,
};
