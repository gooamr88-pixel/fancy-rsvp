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
