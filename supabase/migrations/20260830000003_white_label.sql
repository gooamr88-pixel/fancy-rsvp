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
