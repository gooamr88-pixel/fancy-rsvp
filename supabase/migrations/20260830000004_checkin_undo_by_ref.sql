-- ════════════════════════════════════════════════════════════════════════
-- Reverse a check-in by SERVER ID, not only by the client id that made it.
-- ────────────────────────────────────────────────────────────────────────
-- THE BUG THIS FIXES
--
-- `checkin_undo` resolves its target with one lookup:
--
--     WHERE event_id = p_event_id AND client_checkin_id = p_client_checkin_id
--
-- A tablet can therefore only reverse a check-in IT created. Every other
-- arrival it holds was reconstructed locally under an invented id —
--
--     seed:<eventId>:<guestId>   arrivals already recorded when the device was
--                                prepared            (BundleRepository)
--     remote:<serverId>          another device's arrival, from the delta
--                                                    (SyncRepository)
--
-- — and neither is a `client_checkin_id` the server has ever held. It is not
-- even a uuid, which is what the parameter declares.
--
-- With two gates that is most of the guest list. A supervisor at gate B undoes
-- someone admitted at gate A, the tablet marks it reversed locally and reports
-- success, and the request can never be applied: the dashboard goes on counting
-- that guest as present, permanently, with nothing on either screen admitting
-- it. That is the defect being closed.
--
-- Translating a server id into a client id in the API layer does NOT work, and
-- it is worth writing down why: the web console inserts check-ins with no
-- `client_checkin_id` at all (guestService.checkInParty), so for anyone admitted
-- from the dashboard there is nothing to translate to. The lookup itself has to
-- accept the server id.
--
-- ── WHY A NEW NAME AND NOT A NEW PARAMETER ──
--
-- Adding `p_server_id` to `checkin_undo` would create an OVERLOAD rather than
-- replace it, and PostgREST resolves RPCs by parameter NAME: with both forms
-- present a call matches two candidates and fails as ambiguous (PGRST203). The
-- 20260814000000 migration had to drop the old 4-argument form by hand for
-- exactly this reason, and its comment records the trap.
--
-- So this migration is purely ADDITIVE. Nothing is dropped, nothing is
-- replaced, no existing signature moves, and `checkin_undo` keeps working
-- untouched. If this is applied and the backend is not yet deployed, nothing
-- changes; if the backend is deployed and this is not applied, the API falls
-- back to the old function and only the NEW capability is missing. Either order
-- is safe, which is what you want from a migration that ships to a live event.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.checkin_undo_by_ref(
  p_event_id          uuid,
  p_client_checkin_id uuid,
  p_server_id         uuid,
  p_actor             uuid,
  p_reason            text,
  p_staff_id          uuid DEFAULT NULL,
  p_staff_name        text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.check_ins%ROWTYPE;
  v_seq bigint;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  -- Neither key given. Distinguished from NOT_FOUND on purpose: one is a
  -- malformed request, the other is a request about a check-in that is not here.
  IF p_server_id IS NULL AND p_client_checkin_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_REFERENCE');
  END IF;

  -- The same lock the batch upsert takes, so an undo cannot interleave with a
  -- concurrent admission of the same guest and allocate a sequence number out
  -- of order.
  PERFORM pg_advisory_xact_lock(hashtext('checkin_batch:' || p_event_id::text));

  -- The SERVER ID WINS when it is given. It is the row's own primary key, it is
  -- present on every check-in however it was created, and a client id is only
  -- ever a secondary handle — one that a web-created row does not have at all.
  SELECT * INTO v_row FROM public.check_ins
   WHERE event_id = p_event_id
     AND (
           (p_server_id IS NOT NULL AND id = p_server_id)
        OR (p_server_id IS NULL AND client_checkin_id = p_client_checkin_id)
         );

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;

  IF v_row.deleted_at IS NOT NULL THEN
    -- Idempotent: undoing an undone check-in is a no-op success, so a retried
    -- request cannot fail spuriously.
    RETURN jsonb_build_object('ok', true, 'already_undone', true, 'server_id', v_row.id);
  END IF;

  INSERT INTO public.event_checkin_cursors AS c (event_id, last_seq)
    VALUES (p_event_id, 1)
  ON CONFLICT (event_id)
    DO UPDATE SET last_seq = c.last_seq + 1, updated_at = now()
  RETURNING c.last_seq INTO v_seq;

  -- server_seq is left EXACTLY as it was; the undo gets its own position, so a
  -- device replaying the delta sees the admission and the reversal as two
  -- distinct events in the order they happened.
  UPDATE public.check_ins
     SET deleted_at           = now(),
         deleted_by           = p_actor,
         undone_by_staff_id   = p_staff_id,
         undone_by_staff_name = p_staff_name,
         undo_reason          = trim(p_reason),
         undo_seq             = v_seq
   WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'ok', true, 'server_id', v_row.id,
    'guest_id', v_row.guest_id, 'party_id', v_row.party_id, 'server_seq', v_seq
  );
END;
$$;

-- Same posture as checkin_undo: reachable only by the service role the API uses.
-- An undo erases the evidence that a guest was admitted; it is never something a
-- browser-held key may do directly.
REVOKE ALL ON FUNCTION public.checkin_undo_by_ref(uuid, uuid, uuid, uuid, text, uuid, text)
  FROM anon, authenticated;

COMMENT ON FUNCTION public.checkin_undo_by_ref(uuid, uuid, uuid, uuid, text, uuid, text) IS
  'Soft-deletes one check-in, resolved by server id when given and by client_checkin_id otherwise. Additive replacement for checkin_undo, which can only resolve check-ins a device created itself.';

COMMIT;
