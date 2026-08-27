-- ═══════════════════════════════════════════════════════════════════════
-- FANCY — combined manual apply, generated 2026-08-27
--
-- Every migration added or renamed in this session, in dependency order
-- (which is also filename order). Paste the whole thing into the Supabase
-- SQL editor and run once.
--
-- SAFE TO RE-RUN. Every statement is idempotent: ADD COLUMN IF NOT EXISTS,
-- CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION, and backfills
-- guarded so they only ever move a value one way.
-- ═══════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════════════════════════════════════════
-- FILE: 20260727000001_guest_analytics_composite_indexes.sql
-- ══════════════════════════════════════════════════════════════════════

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


-- ══════════════════════════════════════════════════════════════════════
-- FILE: 20260818000002_tier_identity.sql
-- ══════════════════════════════════════════════════════════════════════

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


-- ══════════════════════════════════════════════════════════════════════
-- FILE: 20260830000000_assign_checkin_app_feature.sql
-- ══════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════
-- ASSIGN `checkin_app` TO THE PLANS THAT ALREADY HAD IT IN PRACTICE
-- ────────────────────────────────────────────────────────────────────────
-- `checkin_app` is the paid entitlement for the Fancy Check-in door app. It
-- has existed in backend/config/featureRegistry.js since the app shipped and
-- has been assigned to NO tier by any migration — the registry's own comment
-- says "Nothing is assigned by default", the expectation being that an admin
-- would tick it per tier in Admin -> Config -> Subscription Tiers.
--
-- That was harmless only because the key was never really enforced. Its one
-- gate sat on GET /checkin-app/download, while the public /checkin-app page
-- links the same APK straight off the web root and states, correctly, that
-- installing it needs no account — and device pairing was not gated at all.
-- So in practice the door app was included with every plan that carried
-- check-in, and organizers have been using it on that basis.
--
-- Enforcement has now moved to where a tablet cannot walk around it: pairing
-- code issuance, via backend/middleware/checkinAppGate.js. Without this
-- migration that change would refuse every organizer on the platform, because
-- no tier grants the key it now demands. A grandfather clause in that
-- middleware (an event with a paired device keeps pairing spares) prevents a
-- live door from failing mid-event, but it is a safety net, not the fix — a
-- brand new event on a real plan would still be refused.
--
-- ── The rule, and why it is this one ──
--
-- Every tier that already grants `qr_checkin` or `manual_checkin` also gets
-- `checkin_app`. That is the entitlement customers already have, so switching
-- the gate on takes NOTHING away from anyone — which is the only safe way to
-- turn a decorative flag into a real one. It deliberately does not try to
-- guess a pricing strategy: narrowing the app to premium plans is a commercial
-- decision, it is one click per tier in the admin UI, and doing it there
-- affects only future purchases while every event already running keeps its
-- snapshot.
--
-- No tier NAME appears below. Tiers are renamed freely and identity lives in
-- `key`; a migration matching on "Professional" would silently do nothing on a
-- deployment where that plan is called something else.
--
-- Additive and idempotent: a tier that already carries the key is untouched,
-- nothing is removed or reordered, and re-running changes nothing.
-- ════════════════════════════════════════════════════════════════════════

UPDATE public.super_admin_config
SET pricing_tiers = COALESCE((
  SELECT jsonb_agg(
    CASE
      WHEN (
        COALESCE(arr.tier -> 'features', '[]'::jsonb) ? 'qr_checkin'
        OR COALESCE(arr.tier -> 'features', '[]'::jsonb) ? 'manual_checkin'
      )
      AND NOT (COALESCE(arr.tier -> 'features', '[]'::jsonb) ? 'checkin_app')
      THEN arr.tier || jsonb_build_object(
        'features',
        COALESCE(arr.tier -> 'features', '[]'::jsonb) || '["checkin_app"]'::jsonb
      )
      ELSE arr.tier
    END
    -- WITH ORDINALITY + ORDER BY, because jsonb_agg without one has NO defined
    -- order and this array IS the display order of the plans on the public
    -- pricing page. 20260729000000_backfill_baseline_tier_features.sql omits
    -- this and has been reshuffling the pricing ladder by luck ever since.
    ORDER BY arr.ord
  )
  FROM jsonb_array_elements(super_admin_config.pricing_tiers) WITH ORDINALITY AS arr(tier, ord)
-- COALESCE back to the original, and the length guard below.
--
-- `jsonb_agg` over ZERO rows returns NULL, not '[]'. So on a config row whose
-- pricing_tiers is an empty array this UPDATE would set the column to NULL —
-- destroying the pricing ladder rather than leaving it alone. Two independent
-- guards because the cost of being wrong here is the whole plan list, and
-- `20260729000000_backfill_baseline_tier_features.sql` has the same shape with
-- neither of them.
), pricing_tiers)
WHERE pricing_tiers IS NOT NULL
  AND jsonb_typeof(pricing_tiers) = 'array'
  AND jsonb_array_length(pricing_tiers) > 0;

-- What this did, so a deploy log can be read afterwards without guessing.
DO $$
DECLARE
  v_granted int;
BEGIN
  SELECT count(*) INTO v_granted
  FROM super_admin_config sac,
       LATERAL jsonb_array_elements(sac.pricing_tiers) AS t(tier)
  WHERE t.tier -> 'features' ? 'checkin_app';

  RAISE NOTICE 'checkin_app is now granted by % pricing tier(s).', v_granted;

  IF v_granted = 0 THEN
    RAISE WARNING 'No tier grants checkin_app. Every organizer will be refused a pairing code unless their event has already paired a device. Assign it in Admin -> Config -> Subscription Tiers.';
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════════════
-- FILE: 20260830000001_assign_analytics_advanced_feature.sql
-- ══════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════
-- ASSIGN `analytics_advanced` TO THE PAID PLANS
-- ────────────────────────────────────────────────────────────────────────
-- `analytics_advanced` was a pricing-page bullet with no gate behind it
-- (`builtIn: false`), and it is now enforced: analyticsController asks
-- `eventHasFeature` and withholds the funnel, sources, engagement, envelope
-- reveal and day-by-day timeline from a plan that does not carry it.
--
-- Without this migration that change QUIETLY DELETES A WORKING FEATURE. The
-- key is in no migration, and because its admin toggle was disabled for being
-- unbuilt, no admin could ever have ticked it — so not one tier grants it, and
-- every organizer on the platform would open the analytics page tomorrow and
-- find a plan lock where their charts used to be. Worse, the lock names the
-- plans that include the capability, and with no tier carrying it the panel
-- could not even answer "so which plan do I need?".
--
-- ── The rule ──
--
-- Every PAID tier gets it: `price_cents > 0` OR `is_custom` (a "contact sales"
-- plan is priced at zero and is the most expensive thing we sell — keying on
-- price alone would hand the deep charts to everyone EXCEPT the enterprise
-- customer, which is the exact inversion this clause exists to prevent).
--
-- ── The one deliberate behaviour change on this deploy ──
--
-- A tier priced at zero and not marked custom — a genuine free plan — now sees
-- the plan lock instead of the deep charts. That is the only thing anyone
-- loses, it is what makes the feature a feature, and it is one tick in
-- Admin -> Config -> Subscription Tiers to give back. Nobody who has paid for
-- an event loses anything they can see today.
--
-- No tier NAME appears below; identity is `key` and names are edited freely.
-- Additive and idempotent — a tier that already carries the key is untouched.
-- ════════════════════════════════════════════════════════════════════════

UPDATE public.super_admin_config
SET pricing_tiers = COALESCE((
  SELECT jsonb_agg(
    CASE
      WHEN (
        COALESCE((arr.tier ->> 'price_cents')::numeric, 0) > 0
        OR COALESCE((arr.tier ->> 'is_custom')::boolean, false)
      )
      AND NOT (COALESCE(arr.tier -> 'features', '[]'::jsonb) ? 'analytics_advanced')
      THEN arr.tier || jsonb_build_object(
        'features',
        COALESCE(arr.tier -> 'features', '[]'::jsonb) || '["analytics_advanced"]'::jsonb
      )
      ELSE arr.tier
    END
    -- Order is the pricing ladder's display order; jsonb_agg has none without this.
    ORDER BY arr.ord
  )
  FROM jsonb_array_elements(super_admin_config.pricing_tiers) WITH ORDINALITY AS arr(tier, ord)
-- `jsonb_agg` over zero rows returns NULL, which would set the column to NULL
-- and destroy the pricing ladder. Guarded twice — here and in the WHERE.
), pricing_tiers)
WHERE pricing_tiers IS NOT NULL
  AND jsonb_typeof(pricing_tiers) = 'array'
  AND jsonb_array_length(pricing_tiers) > 0;

DO $$
DECLARE
  v_granted int;
  v_total   int;
BEGIN
  SELECT
    count(*) FILTER (WHERE t.tier -> 'features' ? 'analytics_advanced'),
    count(*)
  INTO v_granted, v_total
  FROM super_admin_config sac,
       LATERAL jsonb_array_elements(sac.pricing_tiers) AS t(tier);

  RAISE NOTICE 'analytics_advanced is now granted by % of % pricing tier(s).', v_granted, v_total;

  IF v_granted = 0 THEN
    RAISE WARNING 'No tier grants analytics_advanced. Every organizer will see a plan lock instead of the funnel, sources and timeline. Assign it in Admin -> Config -> Subscription Tiers.';
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════════════
-- FILE: 20260830000002_reconcile_watermark_switches.sql
-- ══════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════
-- ONE WATERMARK DECISION, TWO SWITCHES — RECONCILED BEFORE THEY BOTH GO LIVE
-- ────────────────────────────────────────────────────────────────────────
-- A pricing tier carries the watermark decision twice: the `remove_watermark`
-- BOOLEAN (the checkbox beside "Most Popular" in the admin tier editor) and a
-- `remove_watermark` entry in its `features` array (the plan feature checklist).
--
-- Only the boolean has ever been read. `tierRemovesWatermark()` now honours
-- EITHER, so that ticking the entry an admin is most likely to reach — the one
-- sitting among everything else the plan includes — finally does what it says.
--
-- ── Why that needs this migration ──
--
-- The features entry is not always an admin's decision. `20260727000000_backfill_
-- pricing_tier_features.sql` bulk-inserted a fixed list into every tier whose
-- features array was empty, and "remove_watermark" is in that list. Any tier it
-- touched therefore claims the key without anyone having chosen it.
--
-- Start honouring the key without cleaning that up and the guest pages of those
-- plans lose the "Powered by Fancy RSVP" mark on deploy — branding silently
-- withdrawn from cheap plans because of a migration written for a different
-- purpose a month earlier.
--
-- ── What this does ──
--
-- Where the checkbox says NO, the stale key is dropped. The checkbox is the
-- authority precisely because it is the only one that has ever been enforced,
-- so it is the only one carrying real intent. After this runs:
--
--   • enforcement is IDENTICAL to today's for every existing tier;
--   • the two switches agree, and from now on either one works.
--
-- The reverse is deliberately NOT done — a tier whose checkbox is ticked does
-- not gain the features entry. That entry is also a PUBLIC PRICING BULLET, and
-- adding it would put a new line on live plan cards. Enforcement already covers
-- that case through the boolean; advertising it is a marketing decision and
-- belongs to whoever writes the pricing page, not to a migration.
--
-- Idempotent: re-running finds nothing left to strip.
-- ════════════════════════════════════════════════════════════════════════

UPDATE public.super_admin_config
SET pricing_tiers = COALESCE((
  SELECT jsonb_agg(
    CASE
      WHEN NOT COALESCE((arr.tier ->> 'remove_watermark')::boolean, false)
       AND COALESCE(arr.tier -> 'features', '[]'::jsonb) ? 'remove_watermark'
      THEN jsonb_set(
        arr.tier,
        '{features}',
        (
          SELECT COALESCE(jsonb_agg(k ORDER BY o), '[]'::jsonb)
          FROM jsonb_array_elements_text(arr.tier -> 'features') WITH ORDINALITY AS e(k, o)
          WHERE k <> 'remove_watermark'
        )
      )
      ELSE arr.tier
    END
    ORDER BY arr.ord
  )
  FROM jsonb_array_elements(super_admin_config.pricing_tiers) WITH ORDINALITY AS arr(tier, ord)
), pricing_tiers)
WHERE pricing_tiers IS NOT NULL
  AND jsonb_typeof(pricing_tiers) = 'array'
  AND jsonb_array_length(pricing_tiers) > 0;

DO $$
DECLARE
  v_disagree int;
BEGIN
  SELECT count(*) INTO v_disagree
  FROM super_admin_config sac,
       LATERAL jsonb_array_elements(sac.pricing_tiers) AS t(tier)
  WHERE (t.tier -> 'features' ? 'remove_watermark')
    <> COALESCE((t.tier ->> 'remove_watermark')::boolean, false);

  IF v_disagree = 0 THEN
    RAISE NOTICE 'Watermark switches agree on every tier.';
  ELSE
    -- Only the checkbox-on / key-absent direction can remain, and that one is
    -- harmless: the boolean already grants it. Named so the count is not read
    -- as leftover work.
    RAISE NOTICE '% tier(s) have the watermark checkbox ticked without the matching feature bullet. Enforcement is correct; only the public plan card omits the line.', v_disagree;
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════════════
-- FILE: 20260830000003_white_label.sql
-- ══════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════
-- WHITE LABEL — the guest never learns which company built this
-- ────────────────────────────────────────────────────────────────────────
-- `white_label` has been a pricing-page bullet with nothing behind it since the
-- registry was written (`builtIn: false`). It is a real capability now, and it
-- needs the same thing the watermark needed: a value ON THE EVENT.
--
-- Why a column rather than reading the plan at render time: the invitation page
-- is PUBLIC and the event emails are sent months after the purchase, by a
-- background job with no session. Both read the event row. Resolving a plan
-- from `super_admin_config` at those moments would mean a guest page whose
-- branding changes when an admin edits pricing, and — the case that actually
-- matters — a customer losing what they paid for the day their plan is renamed
-- or deleted. `tier_remove_watermark` has worked this way since
-- 20260712000000; this is the same shape for the same reasons.
--
-- Backfilled from the entitlement snapshot already on each event, so an event
-- bought on a white-label plan before this column existed gets it without
-- anyone touching the config. Today that backfill matches nothing — no tier
-- grants the key yet, which is precisely why enforcing it takes nothing away
-- from anybody.
--
-- Idempotent: IF NOT EXISTS columns, and the backfill only ever sets true.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE events         ADD COLUMN IF NOT EXISTS tier_white_label BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE event_payments ADD COLUMN IF NOT EXISTS tier_white_label BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN events.tier_white_label IS
  'Purchased white-label branding: no Fancy mark on the invitation page, the entry pass, or any event email. Snapshotted at purchase like tier_remove_watermark — the public guest page and the email jobs read the event, not the live pricing config. Implies tier_remove_watermark; see utils/tierResolver.tierRemovesWatermark.';
COMMENT ON COLUMN event_payments.tier_white_label IS
  'What the payment bought, so a manual/bank-transfer approval can restore the same branding the card path does.';

-- ── Backfill from the entitlement snapshot already on the row ────────────
-- `tier_features` is the list frozen at purchase (20260818000002). An event
-- whose plan carried white_label gets the column, and gets the watermark
-- removed with it — white label is a superset, and a row that had one without
-- the other would put "Powered by Fancy RSVP" on a white-label invitation.
UPDATE events
SET tier_white_label = true,
    tier_remove_watermark = true
WHERE tier_white_label = false
  AND jsonb_typeof(tier_features) = 'array'
  AND tier_features ? 'white_label';

UPDATE event_payments
SET tier_white_label = true
WHERE tier_white_label = false
  AND jsonb_typeof(tier_features) = 'array'
  AND tier_features ? 'white_label';

DO $$
DECLARE
  v_events int;
BEGIN
  SELECT count(*) INTO v_events FROM events WHERE tier_white_label;
  RAISE NOTICE 'white_label is active on % event(s).', v_events;
END $$;

