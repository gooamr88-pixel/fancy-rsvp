-- ════════════════════════════════════════════════════════════════════════
-- WHICH MIGRATIONS HAS THIS DATABASE ACTUALLY RECEIVED?
--
-- Paste this whole file into the Supabase SQL Editor and run it. It changes
-- nothing — every statement is a SELECT.
--
-- WHY THIS EXISTS
--
-- Migrations here are applied by hand, by copy-pasting each file into the SQL
-- Editor (deployment/README.md §74). That means there is NO record anywhere of
-- what has been applied — no `schema_migrations` table, nothing to query. The
-- README itself notes that its own checklist "silently fell ~39 files behind
-- the repo once before".
--
-- So the only honest way to answer "what do I still need to run" is to look
-- for the objects each migration creates. That is what this does: one row per
-- migration, saying APPLIED or ** MISSING **.
--
-- WHAT IT CANNOT SEE
--
-- Two of the recent migrations only run UPDATE statements — they change data,
-- not structure, so they leave no object to detect. They are listed at the
-- bottom as UNVERIFIABLE rather than silently omitted, because "not shown"
-- would read as "fine".
-- ════════════════════════════════════════════════════════════════════════

WITH checks(sort_key, migration, adds, present) AS (
  VALUES
    -- ── Structural migrations, newest risk window first ──────────────────
    (1, '20260705500000_fold_in_untracked_schema',
        'organizations.password_hash — WITHOUT THIS NOBODY CAN SIGN IN on a fresh DB',
        EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='organizations'
                  AND column_name='password_hash')),

    (2, '20260705500000_fold_in_untracked_schema',
        'guest_analytics table — the analytics page 500s without it',
        to_regclass('public.guest_analytics') IS NOT NULL),

    (3, '20260705500000_fold_in_untracked_schema',
        'enforce_tier_guest_cap() — without it every paid plan is unlimited',
        EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enforce_tier_guest_cap')),

    (4, '20260818000000_tier_identity',
        'events.tier_key — renaming a plan revokes paid features without it',
        EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='events'
                  AND column_name='tier_key')),

    (5, '20260822000000_sms_rebuild',
        'short_links table — every /i/ SMS link is dead without it',
        to_regclass('public.short_links') IS NOT NULL),

    (6, '20260822000000_sms_rebuild',
        'seating_notify_queue table',
        to_regclass('public.seating_notify_queue') IS NOT NULL),

    (7, '20260825000000_printed_invitations',
        'shop_products table — the whole /shop section',
        to_regclass('public.shop_products') IS NOT NULL),

    (8, '20260826000000_shop_usd_and_moq',
        'shop_products.min_order_qty default = 100',
        EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='shop_products'
                  AND column_name='min_order_qty'
                  AND column_default LIKE '%100%')),

    (9, '20260827000000_shop_category_cover',
        'shop_categories.cover_image_url',
        EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='shop_categories'
                  AND column_name='cover_image_url')),

    (10, '20260828000000_organizer_timezone',
         'organizations.timezone — REQUIRED BEFORE deploying the timezone code',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='organizations'
                   AND column_name='timezone')),

    (11, '20260828000000_organizer_timezone',
         'events.timezone — the per-event clock snapshot',
         EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='events'
                   AND column_name='timezone'))
)
SELECT
    migration,
    CASE WHEN present THEN 'applied' ELSE '** MISSING **' END AS status,
    adds
FROM checks
ORDER BY present, sort_key;

-- ── The two that cannot be detected ──────────────────────────────────────
--
-- Both are data-only UPDATEs, so there is no object to look for. Run these
-- two queries and read the answers yourself:

--   20260823000000_sms_rsvp_confirmation — adds an `rsvp_confirmation` weight
--   into super_admin_config.sms_pricing_config -> type_weights. If the key is
--   absent, the migration has not run.
SELECT 'IS THE rsvp_confirmation SMS WEIGHT SET?' AS question,
       COALESCE(
         (SELECT sms_pricing_config #>> '{type_weights,rsvp_confirmation}'
          FROM public.super_admin_config LIMIT 1),
         '** MISSING — migration 20260823000000 has not run **'
       ) AS answer;

--   20260824000000_retire_wedding_engagement_templates — repoints events off
--   the two retired template keys onto their successors:
--       'wedding'    -> 'bab'
--       'engagement' -> 'ring'
--   A non-zero count means the migration has NOT run (or events have been
--   created on the old keys since, which would be its own problem).
SELECT 'EVENTS STILL ON A RETIRED TEMPLATE' AS question,
       count(*)::text AS answer
FROM public.events
WHERE template_type IN ('wedding', 'engagement');
