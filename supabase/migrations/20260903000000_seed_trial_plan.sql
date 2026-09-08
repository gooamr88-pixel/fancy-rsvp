-- ════════════════════════════════════════════════════════════════════════════
-- THE TRIAL PLAN ITSELF
--
-- 20260902000000 added the columns. This adds the PLAN, and without it the
-- whole feature is invisible: the trial is a tier in
-- `super_admin_config.pricing_tiers` carrying `is_trial: true`, and with no
-- such tier `trialTier()` answers null, `getOrganizerPricing` returns
-- `trial: null`, the wizard never renders the "start free" card, no event ever
-- gets a `trial_ends_at`, and the dashboard banner never appears.
--
-- Every one of those is correct behaviour for "no trial is configured". The
-- mistake was shipping the code that reads the plan without the plan, and with
-- no admin control to create one — so the feature could be neither used nor
-- fixed. (The admin pricing screen now has the two switches; this seeds a
-- sensible starting point so it works the moment the migration lands.)
--
-- ── WHAT IT DOES AND DOES NOT TOUCH ──────────────────────────────────────
--
-- It APPENDS one tier and changes nothing else. Existing plans keep their
-- keys, prices, features and order — this is a JSONB array edit that reads the
-- current value and writes it back with one element added, so a plan somebody
-- is on cannot be renamed, re-priced or dropped by running it.
--
-- It is a no-op when a trial tier already exists, so re-running is free. That
-- matters more than usual here: migrations in this repo are applied by hand,
-- with no record of what has run.
--
-- ── WHY THESE FEATURES ───────────────────────────────────────────────────
--
-- Everything an organizer can SEE the value of in a week, and nothing that
-- costs us money to hand out:
--
--   seating_map / table_management   the thing people actually evaluate
--   rsvp_custom_fields               their own questions on their own form
--   import_guests_csv                so they can bring a real list
--   guest_export_csv                 so their data is never held hostage
--   qr_checkin / manual_checkin      the door, which is half the pitch
--   analytics_advanced               the numbers that make it feel live
--   custom_branding                  their colours and fonts
--   sms_campaigns                    the SCREENS only — messages are still
--                                    bought, because SMS is the one genuinely
--                                    metered cost on the platform. See
--                                    services/trialService.js.
--
-- NOT included, deliberately:
--   white_label          the top plan's headline item, and a trial invitation
--                        is a marketing surface. Stripped in code as well
--                        (TRIAL_EXCLUDED_FEATURES) — this is belt and braces.
--   remove_watermark     every guest opening a trial invitation is somebody
--                        discovering the product through a friend's wedding.
--                        That is the cheapest acquisition this business has,
--                        and a trial is the last place to switch it off.
--   guest_export_excel   a paid-tier nicety; CSV already means nobody is
--                        locked in.
--   checkin_app          the offline door scanner is assigned by hand today
--                        (see 20260830000000) rather than seeded on any plan.
--
-- max_guests = 25 is the bound that stops somebody running a real wedding for
-- free. It is enforced by a DATABASE TRIGGER, and that trigger reads both NULL
-- and 0 as UNLIMITED — so this number must never be blanked.
-- ════════════════════════════════════════════════════════════════════════════

UPDATE public.super_admin_config
SET pricing_tiers = COALESCE(pricing_tiers, '[]'::jsonb) || jsonb_build_array(
  jsonb_build_object(
    'key',          'free_trial',
    'name',         'Free trial',
    'is_trial',     true,
    'trial_days',   7,
    'price_cents',  0,
    'max_guests',   25,
    'max_events',   0,
    'is_custom',    false,
    'recommended',  false,
    'remove_watermark', false,
    'price_label',  'Free for 7 days',
    'cta_label',    'Start my free days',
    'description',  'Publish a real event and try everything for a week. No card.',
    'features',     jsonb_build_array(
      'rsvp_custom_fields',
      'add_guest_manual',
      'import_guests_csv',
      'guest_export_csv',
      'seating_map',
      'table_management',
      'qr_checkin',
      'manual_checkin',
      'analytics_advanced',
      'custom_branding',
      'sms_campaigns'
    )
  )
)
WHERE NOT EXISTS (
  /* Already configured — leave whatever the operator has set up alone.

     CORRELATED to the row being updated (`super_admin_config.pricing_tiers`,
     no second FROM), which is how 20260811000000 does the same job. The
     uncorrelated version scanned the whole table, so a stray second config row
     carrying a trial would have suppressed the append on the REAL one — the
     canonical id 00000000-0000-0000-0000-000000000000 that configCache reads —
     while the self-report below happily printed the other row's plan and
     declared success. That is this feature's original failure dressed as a
     green tick, and it is not worth the two words it saves. */
  SELECT 1
  FROM jsonb_array_elements(COALESCE(super_admin_config.pricing_tiers, '[]'::jsonb)) AS t
  WHERE (t->>'is_trial')::boolean IS TRUE
);

-- What is now true, so applying this by hand shows its own result.
--
-- The plan is read from the CANONICAL row by id, because that is the only row
-- the application ever reads (utils/configCache.js pins this id). A report that
-- answers from any row in the table can say "Free trial" while the row the
-- product uses has none — which is the precise way this feature failed the
-- first time, and the reason it took a bug report to find.
--
-- The COLUMNS are checked too, and separately, because these two migrations are
-- independent and get pasted by hand. With this one applied and 20260902 not,
-- everything looks right — the plan exists, the wizard renders the "start free"
-- card — and the click fails on a missing `trial_started_at` with nothing but a
-- generic "please try again". Both rows must read OK before the trial works.
SELECT
  'TRIAL PLAN' AS question,
  COALESCE(
    (SELECT t->>'name'
     FROM public.super_admin_config c,
          LATERAL jsonb_array_elements(COALESCE(c.pricing_tiers, '[]'::jsonb)) AS t
     WHERE c.id = '00000000-0000-0000-0000-000000000000'
       AND (t->>'is_trial')::boolean IS TRUE
     LIMIT 1),
    '** MISSING — the free trial will not be offered **'
  ) AS answer
UNION ALL
SELECT
  'TRIAL COLUMNS',
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'trial_ends_at'
  ) THEN 'present'
  ELSE '** MISSING — apply 20260902000000_free_trial.sql or every grant fails **'
  END;
