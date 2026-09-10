-- ════════════════════════════════════════════════════════════════════════
-- FOREIGN-KEY AND HOT-PATH INDEX COVERAGE
-- ────────────────────────────────────────────────────────────────────────
-- Every index below closes a SEQUENTIAL SCAN that runs on a path this
-- product exercises constantly. None of them changes behaviour; each one
-- removes work.
--
-- ── WHY AN UNINDEXED FOREIGN KEY IS NOT A COSMETIC PROBLEM ──
--
-- PostgreSQL enforces `ON DELETE CASCADE` / `ON DELETE SET NULL` with a
-- per-parent-row statement against the CHILD table:
--
--     DELETE FROM child WHERE fk_col = $1        -- once per deleted parent row
--
-- With no index whose LEADING column is `fk_col`, that is a full scan of the
-- child table — for EVERY parent row deleted. The child tables below are the
-- fastest-growing tables in the schema, and the parent deletes are not rare
-- administrative events: they are on the guest RSVP path.
--
-- Concretely, `submit_rsvp_v2` (public, unauthenticated, one call per RSVP)
-- runs, inside a per-event advisory lock:
--
--     DELETE FROM guests             WHERE party_id = …   -- on every re-submit
--     DELETE FROM custom_answers     WHERE party_id = …
--     DELETE FROM seating_assignments WHERE party_id = …  -- on a decline
--
-- and `trg_party_response_change` runs the seating delete again on every
-- response change. Deleting the guests then cascades into `check_ins` and
-- `event_check_in_conflicts` by `guest_id`. Before this migration:
--   • seating_assignments.party_id  — UNINDEXED (the UNIQUE is (event_id,
--     party_id), so party_id alone is not a usable leading column)
--   • check_ins.guest_id            — UNINDEXED (the UNIQUE is (event_id,
--     guest_id) WHERE deleted_at IS NULL — partial AND wrong leading column)
--   • event_check_in_conflicts.guest_id — UNINDEXED
--   • guest_analytics.party_id      — UNINDEXED, and this is the largest,
--     fastest-growing table in the schema (one row per guest page view).
--
-- So one party of five re-submitting their RSVP could trigger five sequential
-- scans of `check_ins`, five of `event_check_in_conflicts`, one of
-- `seating_assignments`, and — on any delete that reaches rsvp_parties — one
-- scan of `guest_analytics` per party. All of it holding the event's advisory
-- lock, so every other guest submitting at the same moment queues behind it,
-- each holding a pooler connection while it waits.
--
-- ── custom_form_fields(event_id) ──
--
-- Separately and just as load-bearing: `custom_form_fields` (created as
-- `rsvp_form_fields` in 20260607100000 and renamed in 20260705000000) has
-- carried NO index on event_id since the day it was created. Its only index is
-- the PARTIAL unique `(event_id) WHERE is_meal_field = true`, which cannot
-- serve a plain `WHERE event_id = $1`. That predicate is read by:
--   • GET /events/:id/fields — part of the organizer dashboard's 20-second
--     refresh, so it runs continuously for every open dashboard,
--   • submit_rsvp_v2's meal-field and custom-answer validation — every RSVP,
--   • the public RSVP form payload.
--
-- ── LOCKING NOTE FOR WHOEVER APPLIES THIS ──
--
-- The Supabase CLI wraps each migration in one transaction, so
-- `CREATE INDEX CONCURRENTLY` is not available here. A plain CREATE INDEX
-- takes a SHARE lock: it blocks WRITES to that table for the duration (reads
-- are unaffected). Every table below is small except `guest_analytics` and
-- `check_ins`. If either is large enough for that pause to matter, SKIP those
-- two statements here and build them by hand, outside any transaction:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_guest_analytics_party
--     ON public.guest_analytics(party_id) WHERE party_id IS NOT NULL;
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_check_ins_guest
--     ON public.check_ins(guest_id);
--
-- `IF NOT EXISTS` makes re-running this file harmless either way.
-- ════════════════════════════════════════════════════════════════════════

-- ─── The RSVP write path: cascade targets of DELETE FROM guests / rsvp_parties ───

-- Cascade from guests. Hit once per guest row on every RSVP re-submission and
-- every organizer party edit (guestService.updateParty reconciles by delete).
CREATE INDEX IF NOT EXISTS idx_check_ins_guest
  ON public.check_ins(guest_id);

CREATE INDEX IF NOT EXISTS idx_checkin_conflicts_guest
  ON public.event_check_in_conflicts(guest_id);

-- Cascade from rsvp_parties, AND the explicit deletes in submit_rsvp_v2 and
-- handle_party_response_change. The existing UNIQUE(event_id, party_id) cannot
-- serve `WHERE party_id = $1` on its own.
CREATE INDEX IF NOT EXISTS idx_seating_assignments_party
  ON public.seating_assignments(party_id);

-- Cascade (SET NULL) from rsvp_parties into the largest table in the schema.
-- Partial because most analytics rows are anonymous page views with a NULL
-- party_id, and `party_id = $1` implies `party_id IS NOT NULL`, so the planner
-- can use the partial index for the referential-integrity lookup.
CREATE INDEX IF NOT EXISTS idx_guest_analytics_party
  ON public.guest_analytics(party_id) WHERE party_id IS NOT NULL;

-- ─── The custom-fields read path (dashboard poll + every RSVP submission) ───

CREATE INDEX IF NOT EXISTS idx_custom_form_fields_event
  ON public.custom_form_fields(event_id);

-- ─── Event deletion: draftCleanup, deleteEvent and eventPurge all DELETE events ───
--
-- These three tables have only PARTIAL indexes on event_id
-- (`WHERE is_active`, `WHERE resolved_at IS NULL`) or none at all, and a
-- partial index cannot serve the unconditional `WHERE event_id = $1` that the
-- cascade issues. draftCleanup deletes in bulk on a schedule, and eventPurge
-- deletes an entire live event's data 24h after it ends.

CREATE INDEX IF NOT EXISTS idx_event_devices_event_all
  ON public.event_devices(event_id);

CREATE INDEX IF NOT EXISTS idx_checkin_conflicts_event_all
  ON public.event_check_in_conflicts(event_id);

-- Retired but deliberately retained as the SMS compliance record
-- (see 20260822000000_sms_rebuild.sql). It holds one row per recipient per
-- campaign, so it is the biggest of the event-cascade children with no
-- event_id index at all.
CREATE INDEX IF NOT EXISTS idx_sms_campaign_recipients_event
  ON public.sms_campaign_recipients(event_id);
