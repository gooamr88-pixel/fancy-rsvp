-- ════════════════════════════════════════════════════════════════════════
-- Give a check-in recorded from the WEB a position in the change stream.
-- ────────────────────────────────────────────────────────────────────────
-- THE BUG THIS FIXES
--
-- Devices learn about arrivals from `getDelta`, which selects on
--
--     server_seq > since  OR  undo_seq > since
--
-- `server_seq` is a plain nullable column with no trigger, and it is assigned
-- in exactly one place: `checkin_batch_upsert`, the function tablets drain
-- into. The web console does not go through it — `guestService.checkInParty`
-- runs a direct `INSERT`, so every arrival recorded at the front desk lands
-- with `server_seq = NULL` and matches no possible delta request. No tablet is
-- ever told.
--
-- The consequence is not a wrong total, which is why it survived so long. The
-- guest scans at a door, the tablet has never heard of them, admits them, and
-- the batch endpoint answers `conflict` and keeps the original row — so the
-- count stays right and a conflict is raised instead. Correct by accident, and
-- noisy: a busy front desk manufactures a conflict for every guest it admits.
--
-- Section 2 of 20260814000000 already backfilled the rows that predated
-- sequencing, and its own comment states the reason plainly: "a guest checked
-- in by the web kiosk before the app was armed is physically inside the venue,
-- and a device that cannot see them will admit them twice." That reasoning
-- applies just as much to the arrival recorded thirty seconds ago. Nothing was
-- ever added to make FUTURE web check-ins allocate a number.
--
-- ── WHY A NEW FUNCTION AND NOT `checkin_batch_upsert` ──
--
-- The obvious fix is to route the web path through the function that already
-- does this correctly. It does not work: `checkin_batch_upsert` hard-codes
-- `checked_in_by` to NULL, deliberately (see its comment — a prior bug put a
-- device label in that column and crashed every insert). `checked_in_by` is the
-- ORGANIZER audit uuid, and it is the whole point of a desk check-in: it
-- records WHICH member of staff admitted the party from the dashboard. Routing
-- the web through the device function would trade one silent data loss for
-- another.
--
-- ── WHY NOT JUST ADD A PARAMETER TO IT ──
--
-- Adding `p_checked_in_by` to `checkin_batch_upsert` creates an OVERLOAD rather
-- than replacing it, and PostgREST resolves RPCs by parameter NAME: with both
-- signatures present, every existing call matches two candidates and fails as
-- ambiguous (PGRST203). Devices at venues would stop draining. The same trap is
-- documented at 20260814000000:768 and worked around again in 20260830000004.
-- A new name is the only additive option.
--
-- ── WHY ALLOCATE AND INSERT IN ONE FUNCTION ──
--
-- Allocating the sequence in the API and then inserting is not equivalent, and
-- the gap is a real race, not a theoretical one. A device polling in that
-- window reads `max_seq` from the cursor — already advanced — applies nothing,
-- and moves its own cursor past a row that lands a moment later. The row is
-- then invisible to that device forever, which is precisely the failure being
-- fixed. Both statements have to be inside one transaction, under the same
-- advisory lock the batch drain takes.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.checkin_web_upsert(
  p_event_id      uuid,
  p_party_id      uuid,
  p_method        text,
  p_checked_in_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_method     text;
  v_total      integer;
  v_guest_id   uuid;
  v_seq        bigint;
  v_inserted   integer := 0;
  v_first_at   timestamptz;
  v_existing   timestamptz;
BEGIN
  -- Mirrors the batch function: an unrecognised method is corrected rather than
  -- rejected. The arrival is the fact worth keeping; the label is metadata.
  v_method := coalesce(nullif(p_method, ''), 'manual_search');
  IF v_method NOT IN ('qr_scan', 'manual_search', 'self_service', 'group', 'override') THEN
    v_method := 'manual_search';
  END IF;

  SELECT count(*) INTO v_total
    FROM public.guests
   WHERE party_id = p_party_id AND event_id = p_event_id;

  -- Scoped to the event as well as the party, so a party id from another event
  -- resolves to nothing rather than to somebody else's guests.
  IF v_total = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'GUEST_NOT_FOUND');
  END IF;

  -- The same lock the device drain and the undo take. Serialising per EVENT is
  -- cheap — a desk check-in is one party — and it is what makes the
  -- read-then-write below sound against a tablet draining at the same moment.
  PERFORM pg_advisory_xact_lock(hashtext('checkin_batch:' || p_event_id::text));

  -- Reported when the whole party is already in, so the desk can say WHEN they
  -- arrived rather than only that they did.
  SELECT min(ci.checked_in_at) INTO v_existing
    FROM public.check_ins ci
    JOIN public.guests g ON g.id = ci.guest_id
   WHERE ci.event_id = p_event_id
     AND g.party_id = p_party_id
     AND ci.deleted_at IS NULL;

  FOR v_guest_id IN
    SELECT g.id
      FROM public.guests g
     WHERE g.party_id = p_party_id
       AND g.event_id = p_event_id
       AND NOT EXISTS (
             SELECT 1 FROM public.check_ins c
              WHERE c.event_id = p_event_id
                AND c.guest_id = g.id
                AND c.deleted_at IS NULL)
     ORDER BY g.id
  LOOP
    BEGIN
      INSERT INTO public.event_checkin_cursors AS c (event_id, last_seq)
        VALUES (p_event_id, 1)
      ON CONFLICT (event_id)
        DO UPDATE SET last_seq = c.last_seq + 1, updated_at = now()
      RETURNING c.last_seq INTO v_seq;

      -- `client_checkin_id` stays NULL, as it always has for a desk check-in.
      -- Nothing reads it as a signal, and the reversal paths resolve a web row
      -- by server id or by party — never by a client id it never had.
      INSERT INTO public.check_ins (
        event_id, guest_id, party_id,
        checked_in_at, server_received_at,
        method, server_seq, checked_in_by
      ) VALUES (
        p_event_id, v_guest_id, p_party_id,
        now(), now(),
        v_method, v_seq, p_checked_in_by
      );

      v_inserted := v_inserted + 1;
      IF v_first_at IS NULL THEN v_first_at := now(); END IF;

    EXCEPTION WHEN unique_violation THEN
      -- uq_check_ins_event_guest_live fired: this guest was admitted between
      -- the NOT EXISTS above and this insert. Only reachable from a writer that
      -- did not take the advisory lock — the legacy direct INSERT still running
      -- during a partial deployment. Skipped, not failed: the guest is admitted
      -- either way, and aborting would refuse the rest of the party over
      -- somebody else's success.
      NULL;
    END;
  END LOOP;

  IF v_inserted = 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'ALREADY_CHECKED_IN',
      'total_guests', v_total,
      'checked_in_at', v_existing
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'checked_in_count', v_inserted,
    'total_guests', v_total,
    'already_checked_in', v_total - v_inserted,
    'checked_in_at', v_first_at
  );
END;
$$;

-- Same posture as every other function in this schema: the Express API holds
-- the service role and is the only real gate (amendment A-9 — RLS is inert on
-- this platform because policies key off auth.uid(), which this app never
-- populates).
REVOKE ALL ON FUNCTION public.checkin_web_upsert(uuid, uuid, text, uuid)
  FROM anon, authenticated;

COMMENT ON FUNCTION public.checkin_web_upsert(uuid, uuid, text, uuid) IS
  'Records a party arrival from the web console, allocating a server_seq so devices see it in the delta. Preserves checked_in_by, which checkin_batch_upsert deliberately does not.';

COMMIT;
