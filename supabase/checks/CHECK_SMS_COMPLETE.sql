-- ============================================================================
--  CHECK_SMS_COMPLETE.sql  —  read-only. Changes nothing. Safe to run anytime.
--
--  WHY THIS EXISTS
--  A live send failed with `column "idempotency_key" does not exist`, which
--  proved the production database was behind on migrations — and not only the
--  recent SMS ones: the missing column comes from 20260611200000_audit_fixes.
--  check_sms_schema.sql only covers 20260809 onward, so it reported "ok" while
--  an older prerequisite was absent.
--
--  This checks EVERY object the SMS runtime actually touches, across all
--  migrations, and names the file that supplies each missing one.
--
--  HOW TO READ IT
--  Every row must say `ok`. Any `MISSING` row breaks SMS at runtime — usually
--  as a confusing error attributed to the carrier rather than to the database.
--  Apply the migration named in `supplied_by`, then run this again.
-- ============================================================================

WITH expected(sort_key, object_name, kind, supplied_by) AS (VALUES
  -- ── Core wallet + ledger ────────────────────────────────────────────────
  (1,  'sms_credit_wallets',                       'table',    '20260607100000_schema_completion'),
  (2,  'sms_credit_ledger',                        'table',    '20260607100000_schema_completion'),
  (3,  'sms_credit_ledger.idempotency_key',        'column',   '20260611200000_audit_fixes'),
  (4,  'sms_credit_ledger.sms_sid',                'column',   '20260609000000_sms_ledger_idempotency'),

  -- ── Atomic billing RPCs. Without these every send fails at the debit,
  --    before the carrier is ever contacted. ───────────────────────────────
  (5,  'deduct_sms_credit_atomic',                 'function', '20260611200000_audit_fixes'),
  (6,  'refund_sms_credit_atomic',                 'function', '20260611000001_missing_rpc_functions'),
  (7,  'deduct_sms_credits_atomic',                'function', '20260626000000_sms_multi_credit'),
  (8,  'refund_sms_credits_atomic',                'function', '20260626000000_sms_multi_credit'),
  (9,  'record_sms_purchase',                      'function', '20260717000000_admin_revenue_consistency_fix'),

  -- ── Campaign queue ──────────────────────────────────────────────────────
  (10, 'sms_campaigns',                            'table',    '20260627000000_sms_campaign_jobs'),
  (11, 'sms_campaign_recipients',                  'table',    '20260627000000_sms_campaign_jobs'),
  (12, 'claim_sms_recipients',                     'function', '20260627000000_sms_campaign_jobs'),
  (13, 'requeue_stale_sms_recipients',             'function', '20260627000000_sms_campaign_jobs'),
  (14, 'sms_campaign_progress',                    'function', '20260627000000_sms_campaign_jobs'),

  -- ── Delivery reconciliation + auto-refund ───────────────────────────────
  (15, 'reconcile_sms_delivery',                   'function', '20260628000000_sms_delivery_reconcile'),

  -- ── Consent + compliance ────────────────────────────────────────────────
  (16, 'sms_opt_outs',                             'table',    '20260809000000_sms_compliance'),
  (17, 'sms_optin_submissions',                    'table',    '20260810000000_sms_optin_submissions'),
  (18, 'sms_consent_log',                          'table',    '20260811010000_sms_consent_log'),
  (19, 'sms_consent_log.method',                   'column',   '20260812010000_host_sms_consent_attestation'),
  (20, 'rsvp_parties.sms_consent',                 'column',   '20260718000000_rsvp_sms_consent'),
  (21, 'rsvp_parties.sms_consent_method',          'column',   '20260812010000_host_sms_consent_attestation'),

  -- ── The paid add-on, per-event settings, message log ────────────────────
  (22, 'sms_log',                                  'table',    '20260818000000_sms_addon'),
  (23, 'events.sms_addon_purchased_at',            'column',   '20260818000000_sms_addon'),
  (24, 'events.sms_settings',                      'column',   '20260818000000_sms_addon'),
  (25, 'organizations.sms_consent',                'column',   '20260818000000_sms_addon'),
  (26, 'organizations.sms_phone',                  'column',   '20260818000000_sms_addon'),

  -- ── Admin pricing ───────────────────────────────────────────────────────
  (27, 'super_admin_config.sms_pricing_config',    'column',   '20260819000000_sms_pricing_config'),

  -- ── Usage, limits, analytics ────────────────────────────────────────────
  (28, 'sms_credit_ledger.cost_cents',             'column',   '20260820000000_sms_usage_and_limits'),
  (29, 'sms_credit_wallets.last_used_at',          'column',   '20260820000000_sms_usage_and_limits'),
  (30, 'organizations.sms_delivered_total',        'column',   '20260820000000_sms_usage_and_limits'),
  (31, 'increment_sms_delivered',                  'function', '20260820000000_sms_usage_and_limits'),
  (32, 'reset_sms_balance_alerts',                 'function', '20260820000000_sms_usage_and_limits'),
  (33, 'sms_admin_analytics',                      'function', '20260820000000_sms_usage_and_limits'),

  -- ── Organizer opt-in, guest language, bank transfer, fast skip counts ───
  (34, 'organizations.sms_consent_text_version',   'column',   '20260821000000_sms_organizer_optin_and_perf'),
  (35, 'organizations.sms_consent_ip',             'column',   '20260821000000_sms_organizer_optin_and_perf'),
  (36, 'rsvp_parties.preferred_lang',              'column',   '20260821000000_sms_organizer_optin_and_perf'),
  (37, 'event_payments.sms_addon_segments',        'column',   '20260821000000_sms_organizer_optin_and_perf'),
  (38, 'sms_skip_summary',                         'function', '20260821000000_sms_organizer_optin_and_perf')
)
SELECT
  e.object_name,
  e.kind,
  CASE
    WHEN e.kind = 'table' THEN
      CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables
                        WHERE table_schema = 'public' AND table_name = e.object_name)
           THEN 'ok' ELSE 'MISSING' END
    WHEN e.kind = 'column' THEN
      CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name  = split_part(e.object_name, '.', 1)
                          AND column_name = split_part(e.object_name, '.', 2))
           THEN 'ok' ELSE 'MISSING' END
    ELSE
      CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                        WHERE n.nspname = 'public' AND p.proname = e.object_name)
           THEN 'ok' ELSE 'MISSING' END
  END AS status,
  e.supplied_by
FROM expected e
ORDER BY e.sort_key;
