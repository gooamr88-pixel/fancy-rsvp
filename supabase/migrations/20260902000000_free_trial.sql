-- ════════════════════════════════════════════════════════════════════════════
-- THE 7-DAY FREE TRIAL
--
-- A visitor signs up, builds a real event, publishes it, and holds every
-- feature the trial plan grants for seven days. On the eighth day the event
-- STAYS LIVE and drops to the free plan.
--
-- ── WHAT IS NOT HERE, AND WHY ─────────────────────────────────────────────
--
-- There is no `trials` table, no `is_trial` flag on `events`, and no new
-- entitlement mechanism of any kind. The trial is a TIER in
-- `super_admin_config.pricing_tiers` carrying `is_trial: true` — the same
-- JSONB array every other plan lives in, edited on the same admin screen,
-- resolved by the same `resolveTier`, snapshotted by the same `tierSnapshot`
-- and read by the same `entitledFeatures`. That array needs no migration.
--
-- What genuinely could not be expressed in the existing schema is TIME. Every
-- entitlement on this platform is permanent: `is_paid`, `manual_override` and
-- the seven `tier_*` columns are booleans and snapshots with no expiry, and
-- the only paths that ever downgrade an event (refund, lost dispute, admin
-- revoke) take it OFFLINE rather than down a tier. A subscription-period model
-- did exist once — `subscriptions.current_period_end`, with a 'trialing'
-- status — and was deliberately dropped in 20260712000000 in favour of the
-- pricing_tiers array. This does not bring it back. It adds four timestamps.
--
-- ── THE DEADLINE IS PERSISTED, NEVER DERIVED ──────────────────────────────
--
-- `trial_ends_at` is written once, at grant time, and read thereafter. It is
-- NOT recomputed from `trial_started_at + config.trial_days`, because
-- `trial_days` is admin-editable: shortening the trial from 14 days to 7 would
-- otherwise retroactively end trials people are in the middle of, and
-- lengthening it would silently extend them. The stored deadline is the
-- promise that was actually made. Same reasoning as `purge_scheduled_at`
-- in 20260901000000.
--
-- ── ORDER OF DEPLOY MATTERS LESS THAN USUAL, ON PURPOSE ───────────────────
--
-- `trial_ends_at` is read by entitledFeatures on every request through every
-- gate, which in this codebase is exactly the shape of an outage: a select on
-- a column that does not exist is a PostgREST 400, and the gates turn any
-- error on that read into 404 EVENT_NOT_FOUND. That is not hypothetical —
-- it happened here with `tier_key`, and the symptom was the pay button
-- reporting that the event did not exist.
--
-- So `selectEventWithTier` (backend/utils/tierResolver.js) grew a rung for
-- this column. Shipping the code before this migration means events have no
-- deadline, `isTrialExpired` answers false, and every gate behaves exactly as
-- it did yesterday. The trial simply cannot be granted until this runs.
--
-- Everything below is idempotent. Migrations here are applied by hand-pasting
-- into the SQL editor with no record of what has run, so re-running a file
-- must be free.
-- ════════════════════════════════════════════════════════════════════════════

-- ── The event's own trial state ──────────────────────────────────────────
--
-- NULL `trial_started_at` means this event was never on a trial, which is the
-- state of every event that exists today and every event bought outright.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_ends_at    TIMESTAMPTZ,
  -- Stamped by the sweep when it has rewritten the tier snapshot to the
  -- landing plan. Its only job is to stop the sweep doing that twice; the
  -- GATES do not read it, because they read the deadline. An event with
  -- trial_ends_at in the past and trial_expired_at still NULL is simply one
  -- the sweep has not reached yet, and it is already locked down.
  ADD COLUMN IF NOT EXISTS trial_expired_at TIMESTAMPTZ,
  -- The "two days left" email. Separate stamp so a failed send is retried
  -- rather than swallowed by the expiry stamp.
  ADD COLUMN IF NOT EXISTS trial_warned_at  TIMESTAMPTZ;

COMMENT ON COLUMN public.events.trial_ends_at IS
  'When this event''s free trial ends. Read by entitledFeatures on every gated request; the background sweep only makes the stored tier snapshot agree with it. NULL = not a trial.';

-- The sweep's two queries, and nothing else, so these stay small. Partial on
-- the stamp being NULL: once an event has been expired it never matches again,
-- and the overwhelming majority of rows have no trial at all.
CREATE INDEX IF NOT EXISTS idx_events_trial_due
  ON public.events (trial_ends_at)
  WHERE trial_ends_at IS NOT NULL AND trial_expired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_trial_warn
  ON public.events (trial_ends_at)
  WHERE trial_ends_at IS NOT NULL AND trial_warned_at IS NULL;

-- ── One trial per account ────────────────────────────────────────────────
--
-- On `organizations` rather than derived by counting events, for two reasons.
-- A count would have to scan every event the org has ever had, including ones
-- since deleted — and a trial that becomes available again by deleting the
-- event that used it is not one trial per account, it is one at a time.
--
-- `trial_event_id` carries no foreign key, deliberately: the record that this
-- account has HAD its trial must outlive the event, and an ON DELETE SET NULL
-- would hand the account a second one the moment it tidied up. (The same
-- reasoning as event_purge_log's missing FK in 20260901000000.)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS trial_event_id   UUID,
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_ends_at    TIMESTAMPTZ;

COMMENT ON COLUMN public.organizations.trial_event_id IS
  'The one event that consumed this account''s free trial. No FK on purpose: the record must survive the event being deleted, or deleting it would earn a second trial.';
