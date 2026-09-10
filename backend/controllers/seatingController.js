const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const invitationService = require('../services/invitationService');
const { broadcast } = require('../utils/realtime');

/**
 * Queue a guest to be TEXTED their table — later, once the organizer stops moving
 * people around.
 *
 * Every seating endpoint calls this instead of sending. The queue is keyed on
 * (event_id, party_id), so each move overwrites the previous row and the last
 * table wins; emailScheduler.jobSeatingNotices sweeps rows that have been still
 * for ten minutes and sends once.
 *
 * Why not just send here: a drag-and-drop session on a 200-guest chart issues one
 * request per drop. Sending inline meant an organizer tidying their layout for
 * twenty minutes spent hundreds of charged messages, and a guest moved four times
 * got four texts, three of them naming a table they are not sitting at.
 *
 * Best-effort by design. A queue failure must never fail the seating operation
 * itself — the organizer's chart is the thing they are actually doing, and the
 * email carrying the real pass has already gone.
 */
async function queueSeatingNotice(eventId, partyId, tableId) {
  if (!eventId || !partyId) return;
  try {
    await supabase.from('seating_notify_queue').upsert(
      {
        event_id: eventId,
        party_id: partyId,
        table_id: tableId || null,
        queued_at: new Date().toISOString(),
        // Reset on every move: a guest already texted about table 7 who is moved
        // to table 3 is owed a new message.
        notified_at: null,
      },
      { onConflict: 'event_id,party_id' },
    );
  } catch (err) {
    logger.warn({ err, eventId, partyId }, 'Could not queue the seating text (seating itself succeeded)');
  }
}

/**
 * Assigns a guest party to a table atomically.
 * POST /api/v1/events/:eventId/seating/assign
 */
const assignSeat = async (req, res, next) => {
  const { eventId } = req.params;
  const { rsvpId, tableId, force } = req.body;
  const assignedBy = req.user?.id || null; // Assume auth middleware sets req.user

  if (!rsvpId || !tableId) {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'rsvpId and tableId are required fields.'
    });
  }

  try {
    // Capacity is enforced authoritatively — and atomically — inside the assign_seat
    // RPC, which computes live occupancy from guest counts and returns
    // CAPACITY_EXCEEDED unless p_force is set. A JS pre-check here would be both
    // non-atomic (TOCTOU between the check and the insert) and, since the guest-model
    // rebuild removed the `rsvps` table the old check read, silently always-zero — so
    // the RPC is the single source of truth for capacity.
    const { data, error } = await supabase.rpc('assign_seat', {
      p_event_id: eventId,
      p_party_id: rsvpId,
      p_table_id: tableId,
      p_assigned_by: assignedBy,
      p_force: !!force
    });

    if (error) {
      logger.error({ err: error }, 'Database RPC error in assignSeat');
      return res.status(500).json({
        success: false,
        error: 'DATABASE_ERROR',
        message: 'A database error occurred during seat assignment.'
      });
    }

    if (!data.success) {
      return res.status(409).json({
        success: false,
        error: data.error,
        message: data.message
      });
    }

    // Broadcast the update (fire-and-forget REST broadcast — no per-request socket).
    broadcast(eventId, 'seating_update', { rsvpId, tableId, seatsRemaining: data.seats_remaining });

    // The EMAIL goes immediately — it is free, and it is the thing that actually
    // carries the scannable pass.
    //
    // NOT awaited, matching the batch path below. A Brevo round trip is
    // hundreds of milliseconds and this endpoint is fired once per drop on a
    // drag-and-drop chart, so awaiting it made the organizer wait on a mail API
    // for every guest they moved — while the batch save, which the comment
    // there says must not "hold up the response", already did the opposite.
    // Two paths through the same action should not disagree about that.
    //
    // Nothing downstream reads the outcome: the response reports the SEATING,
    // and a failed pass email is recoverable from the guest list's resend
    // button. A rejection is logged rather than left unhandled.
    invitationService.sendQrTicketEmail(eventId, rsvpId).catch((emailErr) => {
      logger.error({ err: emailErr, rsvpId }, 'Failed to auto-send QR ticket email');
    });

    // The TEXT is queued, not sent. See queueSeatingNotice.
    await queueSeatingNotice(eventId, rsvpId, tableId);

    return res.status(200).json({
      success: true,
      message: 'Guest assigned to table successfully. QR ticket email triggered.',
      data
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Reassigns a guest party to a different table atomically.
 * POST /api/v1/events/:eventId/seating/reassign
 */
const reassignSeat = async (req, res, next) => {
  const { eventId } = req.params;
  const { rsvpId, newTableId, force } = req.body;
  const assignedBy = req.user?.id || null;

  if (!rsvpId || !newTableId) {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'rsvpId and newTableId are required fields.'
    });
  }

  try {
    // Call the postgres atomic reassignment function
    const { data, error } = await supabase.rpc('reassign_seat', {
      p_event_id: eventId,
      p_party_id: rsvpId,
      p_new_table_id: newTableId,
      p_assigned_by: assignedBy,
      p_force: !!force
    });

    if (error) {
      logger.error({ err: error }, 'Database RPC error in reassignSeat');
      return res.status(500).json({
        success: false,
        error: 'DATABASE_ERROR',
        message: 'A database error occurred during seat reassignment.'
      });
    }

    if (!data.success) {
      return res.status(409).json({
        success: false,
        error: data.error,
        message: data.message
      });
    }

    // Broadcast the update (fire-and-forget REST broadcast — no per-request socket).
    broadcast(eventId, 'seating_update', {
      rsvpId,
      fromTable: data.from_table,
      toTable: data.to_table,
      seatsRemainingNewTable: data.seats_remaining_new_table,
    });

    // Still deliberately NOT auto-emailing: a move is not worth a second email
    // carrying a pass the guest already has.
    //
    // But it IS worth a text, because the text is the thing that names the table,
    // and a guest holding a message that says "table 7" when they have been moved
    // to table 3 is worse off than one holding no message at all.
    //
    // Queued rather than sent — which is what makes this safe to do on every move
    // where it previously could not be done at all. Ten drags of the same guest
    // collapse to one row, and one text naming where they finally ended up.
    await queueSeatingNotice(eventId, rsvpId, req.body?.tableId || data.to_table || null);

    return res.status(200).json({
      success: true,
      message: 'Guest reassigned to table successfully.',
      data
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Unassigns a guest from any table atomically.
 * POST /api/v1/events/:eventId/seating/unassign
 */
const unassignSeat = async (req, res, next) => {
  const { eventId } = req.params;
  const { rsvpId } = req.body;
  const assignedBy = req.user?.id || null;

  if (!rsvpId) {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'rsvpId is required.'
    });
  }

  try {
    const { data, error } = await supabase.rpc('unassign_seat', {
      p_event_id: eventId,
      p_party_id: rsvpId,
      p_assigned_by: assignedBy
    });

    if (error) {
      logger.error({ err: error }, 'Database RPC error in unassignSeat');
      return res.status(500).json({
        success: false,
        error: 'DATABASE_ERROR',
        message: 'A database error occurred during unseating.'
      });
    }

    if (!data.success) {
      return res.status(409).json({
        success: false,
        error: data.error,
        message: data.message
      });
    }

    // Broadcast the update (fire-and-forget REST broadcast — no per-request socket).
    broadcast(eventId, 'seating_update', { rsvpId, tableId: '', seatsRemaining: data.seats_remaining });

    // Drop any pending seating text for this guest.
    //
    // If they were queued a minute ago and have now been unseated, the message
    // waiting to go out names a table they no longer have. Deleting the row is
    // the whole reason the queue is a table rather than a fired-and-forgotten
    // send: an unsent message can still be recalled.
    try {
      await supabase.from('seating_notify_queue')
        .delete().eq('event_id', eventId).eq('party_id', rsvpId);
    } catch (err) {
      logger.warn({ err, rsvpId }, 'Could not clear the queued seating text after unseating');
    }

    return res.status(200).json({
      success: true,
      message: 'Guest unassigned from table successfully.',
      data
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Saves a batch of seating assignments/unassignments for an event.
 * POST /api/v1/events/:eventId/seating/save-batch
 */
const saveSeatingBatch = async (req, res, next) => {
  const { eventId } = req.params;
  const { assignments, force } = req.body; // Array of { rsvpId, tableId }; force = override capacity
  const assignedBy = req.user?.id || null;
  const forceFlag = !!force;

  if (!Array.isArray(assignments)) {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'assignments must be an array.'
    });
  }

  try {
    // 1. Fetch current seating assignments for this event to compare
    const { data: currentAssignments, error: fetchErr } = await supabase
      .from('seating_assignments')
      .select('party_id, table_id')
      .eq('event_id', eventId);

    if (fetchErr) throw fetchErr;

    const currentMap = {};
    (currentAssignments || []).forEach(a => {
      currentMap[a.party_id] = a.table_id;
    });

    const results = [];

    // 2. Process each assignment in the batch
    for (const item of assignments) {
      const { rsvpId, tableId } = item;
      if (!rsvpId) continue;

      const currentTableId = currentMap[rsvpId];

      if (!tableId) {
        // We want to unassign
        if (currentTableId) {
          const { data, error } = await supabase.rpc('unassign_seat', {
            p_event_id: eventId,
            p_party_id: rsvpId,
            p_assigned_by: assignedBy
          });
          results.push({ rsvpId, action: 'unassign', success: !error && data?.success, error: error || data?.message });
        }
      } else {
        // We want to assign or reassign
        if (!currentTableId) {
          // Assign
          const { data, error } = await supabase.rpc('assign_seat', {
            p_event_id: eventId,
            p_party_id: rsvpId,
            p_table_id: tableId,
            p_assigned_by: assignedBy,
            p_force: forceFlag
          });
          results.push({ rsvpId, tableId, action: 'assign', success: !error && data?.success, error: error || data?.message });
        } else if (currentTableId !== tableId) {
          // Reassign
          const { data, error } = await supabase.rpc('reassign_seat', {
            p_event_id: eventId,
            p_party_id: rsvpId,
            p_new_table_id: tableId,
            p_assigned_by: assignedBy,
            p_force: forceFlag
          });
          results.push({ rsvpId, tableId, action: 'reassign', success: !error && data?.success, error: error || data?.message });
        }
      }
    }

    // 3. Broadcast (fire-and-forget REST broadcast — no per-request socket).
    broadcast(eventId, 'seating_update', { batch: true, results });

    // EMAIL: only for guests NEWLY seated in this batch (action === 'assign' —
    // they had no table before). Batch reassignments stay silent on email, same
    // as reassignSeat, because the pass a moved guest already holds is still
    // valid. Fired without awaiting so a large batch doesn't hold up the response.
    results
      .filter((r) => r.action === 'assign' && r.success)
      .forEach((r) => {
        invitationService.sendQrTicketEmail(eventId, r.rsvpId).catch((emailErr) => {
          logger.error({ err: emailErr, rsvpId: r.rsvpId }, 'Failed to auto-send QR ticket email (batch)');
        });
      });

    // TEXT: queued for BOTH assign and reassign — this is the case the debounce
    // was built for.
    //
    // A batch save is the seating screen handing over a whole afternoon of
    // rearranging at once, so it is simultaneously the most valuable moment to
    // tell guests where they are sitting and the most dangerous moment to send
    // anything. The queue resolves it: 200 rows here collapse to 200 upserts, one
    // per guest, and each guest is texted once with wherever they finally landed.
    await Promise.all(
      results
        .filter((r) => (r.action === 'assign' || r.action === 'reassign') && r.success)
        .map((r) => queueSeatingNotice(eventId, r.rsvpId, r.tableId)),
    );

    // An unseated guest's pending text is withdrawn — see unassignSeat.
    const unseated = results.filter((r) => r.action === 'unassign' && r.success).map((r) => r.rsvpId);
    if (unseated.length > 0) {
      try {
        await supabase.from('seating_notify_queue')
          .delete().eq('event_id', eventId).in('party_id', unseated);
      } catch (err) {
        logger.warn({ err, eventId }, 'Could not clear queued seating texts for unseated guests');
      }
    }

    // Check if there was any failure in the batch
    const failures = results.filter(r => !r.success);
    if (failures.length > 0) {
      /**
       * `f.error` is either an RPC message string or a PostgrestError OBJECT,
       * because the loop above stores `error || data?.message`. Joining them
       * raw produced "Some seating assignments failed: [object Object]" for
       * every genuine database failure — the exact case where the organizer
       * most needs to be told what happened.
       */
      const describe = (e) => {
        if (!e) return 'unknown error';
        if (typeof e === 'string') return e;
        return e.message || e.details || e.code || 'unknown error';
      };
      // De-duplicated: a batch of 200 rows that all hit the same full table
      // should say so once, not print the same sentence two hundred times.
      const errorMsg = [...new Set(failures.map((f) => describe(f.error)))].join(', ');
      return res.status(400).json({
        success: false,
        error: 'BATCH_SAVE_FAILED',
        message: `Some seating assignments failed: ${errorMsg}`,
        results
      });
    }

    return res.status(200).json({
      success: true,
      message: 'All seating assignments saved successfully.',
      results
    });

  } catch (err) {
    next(err);
  }
};

/**
 * Paginated + searchable list of ATTENDING guests for the seating panel.
 * Backed by the get_seating_guests RPC so we never stream 100k rows into Node.
 * GET /api/v1/events/:eventId/seating/guests?search=&filter=all|seated|unseated&page=&pageSize=
 */
const getSeatingGuests = async (req, res, next) => {
  const { eventId } = req.params;
  const search = (req.query.search || '').toString().trim();
  const filter = ['all', 'seated', 'unseated'].includes(req.query.filter) ? req.query.filter : 'all';
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize) || 100, 1), 500);
  const offset = (page - 1) * pageSize;
  const tableId = req.query.tableId ? String(req.query.tableId) : null;

  try {
    const { data, error } = await supabase.rpc('get_seating_guests', {
      p_event_id: eventId,
      p_search: search,
      p_filter: filter,
      p_limit: pageSize,
      p_offset: offset,
      p_table_id: tableId
    });

    if (error) throw error;

    const rows = data || [];
    const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
    const guests = rows.map(r => ({
      id: r.id,
      guest_name: r.guest_name,
      party_size: r.party_size,
      tableId: r.table_id || ''
    }));

    return res.json({
      success: true,
      guests,
      pagination: { page, pageSize, total, hasMore: offset + guests.length < total }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Aggregate seating summary counts (attending / seated / unseated) without
 * loading any rows client-side.
 * GET /api/v1/events/:eventId/seating/summary
 */
const getSeatingSummary = async (req, res, next) => {
  const { eventId } = req.params;
  try {
    const { data, error } = await supabase.rpc('get_seating_summary', { p_event_id: eventId });
    if (error) throw error;
    return res.json({
      success: true,
      summary: data || {
        attendingParties: 0, attendingGuests: 0,
        seatedParties: 0, seatedGuests: 0,
        unseatedParties: 0, unseatedGuests: 0
      }
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  assignSeat,
  reassignSeat,
  unassignSeat,
  saveSeatingBatch,
  getSeatingGuests,
  getSeatingSummary
};
