-- ════════════════════════════════════════════════════════════════════════
-- GUEST ANALYTICS — COMPOSITE INDEXES FOR THE ORGANIZER DASHBOARD
--
-- ⚠ RENAMED 2026-08-26: was `20260727000000_guest_analytics_composite_indexes.sql`
--   and shared that version with `20260727000000_backfill_pricing_tier_features.sql`.
--   `schema_migrations` is keyed on the version, so only one of the two could
--   ever be recorded — the other was then indistinguishable from an applied
--   migration and silently never run.
--
--   THIS is the file that was renamed, not the backfill, because it is the safe
--   half of the pair either way: every statement here is IF NOT EXISTS /
--   IF EXISTS, so re-running costs milliseconds and changes nothing, whereas the
--   backfill mutates pricing configuration. Evidence also points at the backfill
--   being the one that took the version — 20260729000000's header describes the
--   production symptom left behind by it having run and skipped non-empty tiers.
--
--   Found by `backend/test/migrationVersions.test.js`, which now fails the build
--   on any duplicate version.
--
-- guest_analytics was created (backend/migrations/002_guest_analytics.sql)
-- with four SINGLE-column indexes: event_id, event_type, created_at,
-- session_id. Every query the analytics dashboard makes filters on event_id
-- AND something else:
--
--   • event_id + created_at range   (the ?from/?to window, now actually
--                                    applied — see analyticsController)
--   • event_id + event_type IN (…)  (the envelope reveal funnel)
--
-- With only single-column indexes Postgres has to either scan every row for
-- the event and filter the rest in memory, or pay for a bitmap AND of two
-- indexes. Neither degrades gracefully: this table is append-only and grows
-- with every guest interaction on every event on the platform, forever, so
-- the row count only ever goes one direction.
--
-- Column order matters and is not arbitrary. event_id leads because it is
-- always an equality filter and is by far the most selective; the range /
-- IN-list column follows, so one index scan answers the whole predicate.
--
-- Deliberately NOT `CONCURRENTLY`, despite this being a table taking live
-- guest beacons. Migration runners — the Supabase CLI included — apply each
-- file inside a single transaction, and CREATE INDEX CONCURRENTLY is one of
-- the few statements Postgres refuses to run in one ("cannot run inside a
-- transaction block"). Written with it, this file does not build the indexes
-- slowly; it fails outright and builds nothing.
--
-- The plain form takes a brief ACCESS EXCLUSIVE lock. At this table's current
-- size that is milliseconds, and the cost of a dropped analytics beacon is a
-- missing row in a chart. If this table has grown large by the time you read
-- this, run these two statements by hand outside a transaction WITH
-- CONCURRENTLY instead of changing this file.
-- ════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_guest_analytics_event_created
  ON public.guest_analytics (event_id, created_at);

CREATE INDEX IF NOT EXISTS idx_guest_analytics_event_type_pair
  ON public.guest_analytics (event_id, event_type);

-- The standalone event_id index is now redundant: both composites above lead
-- with event_id, so either can serve an event_id-only lookup. Dropping it
-- saves the write amplification of maintaining a third index on an
-- append-only table.
DROP INDEX IF EXISTS public.idx_guest_analytics_event_id;
