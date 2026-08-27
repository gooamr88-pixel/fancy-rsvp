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
