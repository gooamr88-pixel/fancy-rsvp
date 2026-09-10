-- ─── WHICH SMS MIGRATIONS HAVE ACTUALLY BEEN APPLIED? ────────────────────────
--
-- Read-only. Run this in the SQL editor before or after applying anything; it
-- reports one row per object the SMS subsystem needs, and which migration
-- supplies it. Anything showing MISSING tells you exactly which file to run.
--
-- Written because a migration failing with `relation "x" does not exist` names
-- the symptom, not the gap — and applying files one at a time out of order is
-- how that gap appears in the first place.

WITH expected(sort_key, object_name, kind, supplied_by) AS (VALUES
  (1,  'sms_credit_wallets',                      'table',  '20260607100000_schema_completion'),
  (2,  'sms_credit_ledger',                       'table',  '20260607100000_schema_completion'),
  (3,  'sms_campaigns',                           'table',  '20260627000000_sms_campaign_jobs'),
  (4,  'sms_campaign_recipients',                 'table',  '20260627000000_sms_campaign_jobs'),
  (5,  'sms_opt_outs',                            'table',  '20260809000000_sms_compliance'),
  (6,  'sms_optin_submissions',                   'table',  '20260810000000_sms_optin_submissions'),
  (7,  'sms_consent_log',                         'table',  '20260811010000_sms_consent_log'),
  (8,  'sms_consent_log.method',                  'column', '20260812010000_host_sms_consent_attestation'),
  (9,  'rsvp_parties.sms_consent_method',         'column', '20260812010000_host_sms_consent_attestation'),
  (10, 'sms_log',                                 'table',  '20260818000000_sms_addon'),
  (11, 'events.sms_addon_purchased_at',           'column', '20260818000000_sms_addon'),
  (12, 'events.sms_settings',                     'column', '20260818000000_sms_addon'),
  (13, 'organizations.sms_consent',               'column', '20260818000000_sms_addon'),
  (14, 'super_admin_config.sms_pricing_config',   'column', '20260819000000_sms_pricing_config'),
  (15, 'sms_credit_ledger.cost_cents',            'column', '20260820000000_sms_usage_and_limits'),
  (16, 'sms_credit_wallets.last_used_at',         'column', '20260820000000_sms_usage_and_limits'),
  (17, 'organizations.sms_delivered_total',       'column', '20260820000000_sms_usage_and_limits'),
  (18, 'increment_sms_delivered',                 'function', '20260820000000_sms_usage_and_limits'),
  (19, 'reset_sms_balance_alerts',                'function', '20260820000000_sms_usage_and_limits'),
  (20, 'sms_admin_analytics',                     'function', '20260820000000_sms_usage_and_limits'),
  (21, 'organizations.sms_consent_text_version',  'column', '20260821000000_sms_organizer_optin_and_perf'),
  (22, 'organizations.sms_consent_ip',            'column', '20260821000000_sms_organizer_optin_and_perf'),
  (23, 'rsvp_parties.preferred_lang',             'column', '20260821000000_sms_organizer_optin_and_perf'),
  (24, 'event_payments.sms_addon_segments',       'column', '20260821000000_sms_organizer_optin_and_perf'),
  (25, 'sms_skip_summary',                        'function', '20260821000000_sms_organizer_optin_and_perf'),
  (26, 'seating_notify_queue',                    'table',  '20260822000000_sms_rebuild'),
  (27, 'events.cancelled_at',                     'column', '20260822000000_sms_rebuild'),
  (28, 'events.cancellation_reason',              'column', '20260822000000_sms_rebuild'),
  (29, 'short_links',                             'table',  '20260822000000_sms_rebuild')
)
SELECT
  e.object_name,
  e.kind,
  CASE
    WHEN e.kind = 'table' THEN
      CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = e.object_name
      ) THEN 'ok' ELSE 'MISSING' END
    WHEN e.kind = 'column' THEN
      CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name  = split_part(e.object_name, '.', 1)
          AND column_name = split_part(e.object_name, '.', 2)
      ) THEN 'ok' ELSE 'MISSING' END
    ELSE
      CASE WHEN EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = e.object_name
      ) THEN 'ok' ELSE 'MISSING' END
  END AS status,
  e.supplied_by
FROM expected e
ORDER BY e.sort_key;


-- ─── The one thing an existence check cannot see ─────────────────────────────
--
-- sms_rate_cents_per_credit EXISTS whether or not 20260822000000 ran — it has
-- existed since 20260607100000. What changed is its TYPE, and that change is the
-- entire point: as an INTEGER the column accepted the true carrier rate of 1.1
-- and silently stored 1, understating our cost by about 9% everywhere it is used.
-- The failure is invisible in the UI, in the API and in this script's table above.
-- So assert the type, and assert the stored value is not the old rounded one.

SELECT
  'super_admin_config.sms_rate_cents_per_credit' AS object_name,
  data_type,
  CASE WHEN data_type = 'numeric' THEN 'ok'
       ELSE 'MISSING — still INTEGER; 20260822000000_sms_rebuild has not run, and every fractional rate is being rounded on write'
  END AS status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'super_admin_config'
  AND column_name  = 'sms_rate_cents_per_credit';

SELECT
  sms_rate_cents_per_credit AS carrier_cost_cents_per_segment,
  sms_markup_percentage     AS markup_pct,
  ROUND(sms_rate_cents_per_credit * (1 + sms_markup_percentage / 100), 2) AS list_price_cents_per_segment,
  CASE
    WHEN sms_rate_cents_per_credit = 8 THEN 'stale — pre-rebuild default (8 cents) is ~7x the real carrier cost'
    WHEN sms_rate_cents_per_credit = 1 THEN 'ROUNDED — someone saved 1.1 into an INTEGER column'
    ELSE 'ok'
  END AS status,
  sms_pricing_config ? 'guest_bands'  AS has_guest_bands,
  sms_pricing_config ? 'type_weights' AS has_type_weights
FROM super_admin_config
WHERE id = '00000000-0000-0000-0000-000000000000';
