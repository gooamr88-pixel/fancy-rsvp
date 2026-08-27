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
