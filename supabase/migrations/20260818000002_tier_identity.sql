-- ════════════════════════════════════════════════════════════════════════
-- PRICING TIERS GET AN IDENTITY (and events get an entitlement snapshot)
-- ────────────────────────────────────────────────────────────────────────
-- ⚠ RENAMED 2026-08-26: this file was `20260818000000_tier_identity.sql` and
--   shared that version prefix with `20260818000000_sms_addon.sql`.
--
--   `supabase_migrations.schema_migrations` is keyed on the version — the digits
--   before the first underscore — so two files claiming one version cannot both
--   be recorded. Whichever ran first took the version; the second was then
--   indistinguishable from a migration that had already been applied, and was
--   silently never run again. The symptom of THIS file losing that race is
--   exactly the report that started the audit: `events.tier_key` and
--   `events.tier_features` do not exist, `selectEventWithTier()` quietly falls
--   back to resolving plans by display name, entitlement snapshots are never
--   written, and subscription tiers appear not to work.
--
--   Renaming to an unclaimed version is what makes it run. It is safe to run
--   again if it did already apply: every statement below is idempotent —
--   ADD COLUMN IF NOT EXISTS, key minting that skips tiers that already have a
--   key, backfills guarded on `tier_key IS NULL`, CREATE INDEX IF NOT EXISTS,
--   and CREATE OR REPLACE FUNCTION.
--
--   `_sms_addon.sql` deliberately KEEPS the original version: its columns are in
--   production use, so the recorded row belongs to it, and renaming it too would
--   leave `20260818000000` recorded with no matching file — which the CLI reports
--   as remote/local drift needing `supabase migration repair`.
--
--   `backend/test/migrationVersions.test.js` fails the build if two migrations
--   ever share a version again.
-- ────────────────────────────────────────────────────────────────────────
-- Until now a pricing tier had no identity: tiers are elements of the
-- `super_admin_config.pricing_tiers` JSON array, and an event's only link to
-- the one it bought was `events.tier_name TEXT`. The DISPLAY NAME was the
-- primary key.
--
-- So renaming a plan in the admin UI was indistinguishable from deleting it
-- and creating a different one. Renaming "Enterprise":
--   • revoked every paid feature on every event that had bought it (the
--     feature gate found no tier and, by design, granted nothing);
--   • made upgrades charge the new plan's FULL price instead of the
--     difference, because the "previous tier" no longer resolved;
--   • hid the upgrade button entirely in the dashboard;
--   • turned every promo code for that tier into an UNLIMITED-guest grant,
--     since an unresolved tier yields max_guests NULL and NULL means no cap.
-- None of it warned, logged or migrated.
--
-- This migration adds the two things that fix it:
--
--   1. `key` on every tier — stable identity, minted once from the name here
--      and NEVER re-derived from it again. From now on a rename is a rename.
--
--   2. `events.tier_features` — an entitlement SNAPSHOT, written at purchase
--      exactly as tier_max_guests already was. A key survives a rename; only a
--      snapshot survives a DELETION. What a customer paid for must not depend
--      on an admin never touching the config again.
--
-- The backfill below is safe precisely because it runs BEFORE any rename can
-- have happened: every existing tier_name still matches a live tier, so
-- matching on the name one final time assigns each event the right key. That
-- is also why this must be applied before the admin UI ships the rename
-- warning — after a rename, the information needed to backfill is gone.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Identity + entitlement snapshot columns ──────────────────────────
ALTER TABLE events         ADD COLUMN IF NOT EXISTS tier_key         TEXT;
ALTER TABLE events         ADD COLUMN IF NOT EXISTS tier_features    JSONB;
ALTER TABLE events         ADD COLUMN IF NOT EXISTS tier_price_cents INTEGER;
ALTER TABLE event_payments ADD COLUMN IF NOT EXISTS tier_key         TEXT;
ALTER TABLE event_payments ADD COLUMN IF NOT EXISTS tier_features    JSONB;
ALTER TABLE event_payments ADD COLUMN IF NOT EXISTS tier_price_cents INTEGER;
ALTER TABLE promo_codes    ADD COLUMN IF NOT EXISTS tier_key         TEXT;

COMMENT ON COLUMN events.tier_key IS
  'Stable identity of the purchased pricing tier. Resolve plans by THIS, never by tier_name — the name is display text an admin may edit at any time.';
COMMENT ON COLUMN events.tier_features IS
  'Feature keys granted at purchase time. Entitlement falls back to this when the tier no longer exists, so deleting a plan cannot revoke what was paid for.';
COMMENT ON COLUMN events.tier_price_cents IS
  'Licence price at purchase time. The upgrade credit when the plan can no longer be resolved — payment history cannot be used for this because a checkout may bundle an SMS allowance into the same amount.';

-- ── 2. Mint a key for every tier that lacks one ─────────────────────────
-- Same slug rule as utils/tierResolver.slugifyTierName, so a tier created
-- through the admin UI and one keyed here end up with the same shape.
-- WITH ORDINALITY keeps the array order intact; a duplicate slug (two tiers
-- differing only in punctuation) gets the ordinal appended rather than
-- colliding, because two tiers sharing a key would make entitlement ambiguous
-- for every event on either of them.
-- THIS RAN IN THREE STAGES BECAUSE IT HAS TO.
--
-- The first version computed the duplicate count with
-- `COUNT(*) OVER (PARTITION BY ...)` INSIDE `jsonb_agg(...)`, and Postgres
-- rejects that outright:
--     42803: aggregate function calls cannot contain window function calls
-- Window functions are evaluated after aggregation, so one can never be an
-- argument to the other. That error is why this migration had never been
-- applied anywhere — it could not be.
--
-- Splitting it fixes that: `exploded` derives the slug, `counted` runs the
-- window over those slugs, and only then does `keyed` aggregate.
WITH exploded AS (
  SELECT
    sac.id,
    arr.tier,
    arr.ord,
    -- The slug, computed ONCE and reused. The original derived it twice with
    -- two different expressions — the PARTITION BY skipped the trim and the
    -- 'tier' fallback that the written key applied. Two tiers named "Pro" and
    -- "_Pro_" would therefore land in different partitions, neither would be
    -- seen as a duplicate, and both would be written the identical key `pro`.
    -- Duplicate keys make entitlement ambiguous for every event on either
    -- tier, which is the exact outcome the ordinal exists to prevent.
    COALESCE(
      NULLIF(trim(both '_' from regexp_replace(lower(arr.tier->>'name'), '[^a-z0-9]+', '_', 'g')), ''),
      'tier'
    ) AS slug
  FROM super_admin_config sac,
       LATERAL jsonb_array_elements(sac.pricing_tiers) WITH ORDINALITY AS arr(tier, ord)
),
counted AS (
  SELECT
    exploded.*,
    COUNT(*) OVER (PARTITION BY id, slug) AS same_slug
  FROM exploded
),
keyed AS (
  SELECT
    id,
    jsonb_agg(
      CASE
        WHEN COALESCE(NULLIF(tier->>'key', ''), '') <> '' THEN tier
        ELSE tier || jsonb_build_object(
          'key',
          CASE WHEN same_slug > 1 THEN slug || '_' || ord::text ELSE slug END
        )
      END
      ORDER BY ord
    ) AS tiers
  FROM counted
  GROUP BY id
)
UPDATE super_admin_config sac
SET pricing_tiers = keyed.tiers
FROM keyed
WHERE sac.id = keyed.id;

-- ── 3. Backfill every reference, by name, one last time ─────────────────
UPDATE events e
SET tier_key = t.tier->>'key',
    tier_features = COALESCE(t.tier->'features', '[]'::jsonb),
    tier_price_cents = COALESCE((t.tier->>'price_cents')::int, 0)
FROM super_admin_config sac,
     LATERAL jsonb_array_elements(sac.pricing_tiers) AS t(tier)
WHERE sac.id = '00000000-0000-0000-0000-000000000000'
  AND e.tier_name IS NOT NULL
  AND e.tier_key IS NULL
  AND lower(trim(e.tier_name)) = lower(trim(t.tier->>'name'));

UPDATE event_payments p
SET tier_key = t.tier->>'key',
    tier_features = COALESCE(t.tier->'features', '[]'::jsonb),
    tier_price_cents = COALESCE((t.tier->>'price_cents')::int, 0)
FROM super_admin_config sac,
     LATERAL jsonb_array_elements(sac.pricing_tiers) AS t(tier)
WHERE sac.id = '00000000-0000-0000-0000-000000000000'
  AND p.tier_name IS NOT NULL
  AND p.tier_key IS NULL
  AND lower(trim(p.tier_name)) = lower(trim(t.tier->>'name'));

UPDATE promo_codes c
SET tier_key = t.tier->>'key'
FROM super_admin_config sac,
     LATERAL jsonb_array_elements(sac.pricing_tiers) AS t(tier)
WHERE sac.id = '00000000-0000-0000-0000-000000000000'
  AND c.tier_key IS NULL
  AND lower(trim(c.tier_name)) = lower(trim(t.tier->>'name'));

-- An event whose plan was ALREADY unresolvable (a tier deleted before this
-- migration) keeps tier_features NULL rather than an empty array: NULL means
-- "never snapshotted", [] would mean "paid for nothing", and the entitlement
-- code treats those differently.

CREATE INDEX IF NOT EXISTS idx_events_tier_key ON events(tier_key) WHERE tier_key IS NOT NULL;

-- ── 4. The promo-code RPC returns the key alongside the name ────────────
-- Redemption resolves the granted tier from what this returns; without the key
-- it would keep resolving by name and a renamed tier would still hand out an
-- uncapped, feature-less event.
-- Reproduced from 20260807000000_promo_codes.sql VERBATIM except for the final
-- RETURN, which now carries tier_key as well. Restating it from memory instead
-- dropped the advisory lock, the empty-code guard and the unique_violation
-- handler, and renamed two error codes the Node ERROR_MESSAGES map keys on —
-- so the body below is a copy, not a rewrite.
CREATE OR REPLACE FUNCTION public.redeem_promo_code(
  p_code      text,
  p_event_id  uuid,
  p_org_id    uuid,
  p_actor     uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code_row promo_codes%ROWTYPE;
  v_norm_code text := upper(trim(coalesce(p_code, '')));
BEGIN
  IF v_norm_code = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
  END IF;

  -- Serialize redemptions of the SAME code so two concurrent redeems can't
  -- both squeeze past a near-exhausted max_redemptions cap.
  PERFORM pg_advisory_xact_lock(hashtext('promo_code:' || v_norm_code));

  SELECT * INTO v_code_row FROM promo_codes WHERE code = v_norm_code FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
  END IF;

  IF NOT v_code_row.is_active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CODE_INACTIVE');
  END IF;

  IF v_code_row.expires_at IS NOT NULL AND v_code_row.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CODE_EXPIRED');
  END IF;

  IF v_code_row.max_redemptions IS NOT NULL AND v_code_row.redemption_count >= v_code_row.max_redemptions THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CODE_LIMIT_REACHED');
  END IF;

  IF EXISTS (SELECT 1 FROM promo_code_redemptions WHERE event_id = p_event_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EVENT_ALREADY_REDEEMED');
  END IF;

  INSERT INTO promo_code_redemptions (promo_code_id, event_id, org_id, redeemed_by, tier_name)
  VALUES (v_code_row.id, p_event_id, p_org_id, p_actor, v_code_row.tier_name);

  UPDATE promo_codes SET redemption_count = redemption_count + 1, updated_at = now()
  WHERE id = v_code_row.id;

  RETURN jsonb_build_object('ok', true, 'promo_code_id', v_code_row.id,
                            'tier_name', v_code_row.tier_name,
                            'tier_key', v_code_row.tier_key);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'error', 'EVENT_ALREADY_REDEEMED');
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_promo_code(text, uuid, uuid, uuid) FROM anon, authenticated;

COMMIT;
