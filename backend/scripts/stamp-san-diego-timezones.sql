-- ═══════════════════════════════════════════════════════════════════════════
-- STAMP THE TIMEZONES THAT ARE CURRENTLY BEING GUESSED.
--
-- Confirmed 2026-08-26 by the organizer: the engagement really is
-- 30 Aug 2026, 8:00 PM SAN DIEGO time, which is exactly what the row already
-- holds (2026-08-31T03:00:00Z = Aug 30 20:00 America/Los_Angeles).
--
-- So NO time is wrong and NOTHING here moves an event. Every statement below
-- only writes down the assumption the platform is already running on, so it
-- stops being an assumption.
--
-- ── WHY BOTHER, IF NOTHING CHANGES ──
--
-- `safeZone(null)` resolves to `PLATFORM_TIMEZONE`, which is read from the
-- environment (backend/utils/timezone.js). Every NULL-timezone row is therefore
-- silently pinned to a value that a deploy can change. The day anyone sets
-- PLATFORM_TIMEZONE to anything else — a second region, a test box, a typo in
-- an env file — every one of these events moves by the difference, with no
-- migration, no log line and no way to tell it happened.
--
-- ── ⚠ ORDER MATTERS: RUN THIS BEFORE apply-organizer-timezones.js ⚠ ──
--
-- That backfill's phase 2 assumes a NULL-timezone event was stored under the
-- OLD convention (typed digits filed as though they were UTC) and REINTERPRETS
-- it. This event was not: it holds a correct instant. Reinterpreting it would
-- read "2026-08-31T03:00" out of UTC and refile it as 3:00 AM San Diego —
-- moving a real event seven hours, silently, with no way to undo it by
-- re-running anything.
--
-- Phase 2's guard is `WHERE timezone IS NULL`. Stamping the column here is
-- what makes the backfill skip these rows instead of corrupting them.
--
-- Read-check first, then run in a transaction:
--   psql "$DATABASE_URL" -f scripts/stamp-san-diego-timezones.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The two organizations with no zone of their own ──────────────────────
-- Confirmed by the organizer: both are San Diego.
--
-- `timezone_source = 'manual'` and not 'ip': this is a human answering the
-- question, and the column exists so a later IP-based lookup knows never to
-- overwrite it. Filing a person's explicit answer as a geo guess is how it
-- gets silently "corrected" later.
UPDATE public.organizations
   SET timezone = 'America/Los_Angeles',
       timezone_source = 'manual'
 WHERE timezone IS NULL;

-- ── 2. Events still running on the platform default ─────────────────────────
--
-- Each event takes the zone of the ORGANIZATION THAT OWNS IT, not a literal.
--
-- The first draft of this file wrote 'America/Los_Angeles' straight into every
-- NULL row. That happens to be right for the two organizations above, and
-- would have been quietly WRONG for any event belonging to one of the other
-- two — which do have zones of their own, and are not obliged to be in
-- California. A repair script that hardcodes one customer's answer for every
-- customer is the same class of mistake as the bug it is repairing.
--
-- Runs after step 1, so every organization now has a zone and no event is left
-- behind by the IS NOT NULL guard.
--
-- `event_date` is deliberately NOT touched. The stored instant is already
-- correct under this zone — that is the whole finding above — so this only
-- records which clock it is correct on.
UPDATE public.events e
   SET timezone = o.timezone
  FROM public.organizations o
 WHERE e.org_id = o.id
   AND e.timezone IS NULL
   AND o.timezone IS NOT NULL;

-- ── 3. Prove nothing moved ──────────────────────────────────────────────────
-- Should print the same wall-clock times you saw in the diagnostic. If any
-- event reads differently from before, ROLLBACK rather than COMMIT.
-- Rendered in each event's OWN zone, which is the only reading that means
-- anything now that they no longer all share one.
SELECT id,
       title,
       event_date,
       timezone,
       to_char(event_date AT TIME ZONE timezone, 'Mon DD YYYY HH24:MI') AS reads_as
  FROM public.events
 WHERE status = 'active'
 ORDER BY event_date;

COMMIT;
