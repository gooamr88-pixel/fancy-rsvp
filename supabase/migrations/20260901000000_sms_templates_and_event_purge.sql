-- ════════════════════════════════════════════════════════════════════════════
-- ORGANIZER-AUTHORED SMS BODIES, AND THE POST-EVENT DATA PURGE
--
-- Two unrelated features in one migration because they ship together and both
-- add columns to `events`. Splitting them would mean two versions to apply in
-- order for one deploy, and this repo already carries the scars of a migration
-- that was assumed applied and was not.
--
-- ── PART 1: events.sms_templates ──
--
-- Every SMS body is currently a hard-coded function in
-- backend/utils/smsTemplates.js. An organizer can switch a type on or off and
-- nothing else — the wording, in either language, is ours.
--
-- This column holds their overrides, shaped:
--
--     { "<type key>": { "en": "Hi {name}! ...", "ar": "..." } }
--
-- An ABSENT key, a null, or an empty string all mean "use the built-in body".
-- That is deliberate and it is why the default is `{}` rather than a
-- pre-populated object: an organizer who has never opened the editor must keep
-- getting the measured, segment-budgeted copy, and a future edit to that copy
-- must reach them. Materializing today's wording into every row would freeze
-- 100% of the customer base onto whatever the templates said the day this ran.
--
-- The compliance footer is NOT stored here and cannot be overridden. It is
-- appended centrally by smsDispatch to every outbound body, so an organizer
-- cannot remove the STOP/HELP language no matter what they type.
--
-- ── PART 2: the purge columns ──
--
-- 24 hours after an event finishes, everything belonging to it is deleted. The
-- organizer is warned by email first, with a link to download a full archive.
--
-- THREE columns rather than one computed deadline, and the split is the safety
-- property:
--
--   purge_warning_sent_at  when we actually told them
--   purge_scheduled_at     when the delete becomes due
--   purge_opt_out          they clicked "keep this"
--
-- `purge_scheduled_at` is stamped from the moment the WARNING IS SENT, never
-- derived from the event's end date at read time. If the scheduler is down for
-- two days, a deadline computed from the end date would already be in the past
-- when it came back — and the first sweep would delete a pile of events whose
-- owners were never warned about anything. Persisting the grace window means
-- the clock cannot start before the notice goes out.
-- ════════════════════════════════════════════════════════════════════════════


/* ── 1. Organizer-authored SMS bodies ───────────────────────────────────────── */

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS sms_templates JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.events.sms_templates IS
  'Per-event SMS body overrides, shaped {"<type key>":{"en":"...","ar":"..."}} against backend/config/smsMessageTypes.js. An absent key / null / empty string means "use the built-in template" — the default is deliberately {} rather than today''s wording, so an organizer who never edits keeps receiving improvements to the measured copy. The compliance footer is appended by smsDispatch and is NOT overridable.';


/* ── 2. The post-event purge ─────────────────────────────────────────────────
 *
 * All three are nullable/defaulted and read by a service that tolerates their
 * absence, so applying this before or after the backend deploy is equally safe.
 */

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS purge_warning_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS purge_scheduled_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS purge_opt_out         BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.purge_warning_sent_at IS
  'When the organizer was emailed that this event''s data is about to be deleted. NULL = not yet warned.';
COMMENT ON COLUMN public.events.purge_scheduled_at IS
  'When the hard delete becomes due. Stamped as (warning sent + grace window), NEVER derived from event_date at read time — a scheduler outage would otherwise produce a deadline already in the past and delete events whose owners were never warned.';
COMMENT ON COLUMN public.events.purge_opt_out IS
  'The organizer asked to keep this event''s data. Excluded from both the warning sweep and the delete sweep.';

/* The delete sweep's only predicate. Partial, because the overwhelming majority
   of rows have never been warned and so carry NULL here — indexing them would
   be paying for the 99% to find the 1%. */
CREATE INDEX IF NOT EXISTS idx_events_purge_due
  ON public.events (purge_scheduled_at)
  WHERE purge_scheduled_at IS NOT NULL AND purge_opt_out = false;

/* The warning sweep walks finished-but-unwarned events by date. */
CREATE INDEX IF NOT EXISTS idx_events_purge_unwarned
  ON public.events (event_date)
  WHERE purge_warning_sent_at IS NULL;


/* ── 3. The record that outlives the row ─────────────────────────────────────
 *
 * The purge is a DELETE on `events`, which cascades through every related
 * table. Without this there would be no evidence anywhere that the event ever
 * existed — so a customer asking "where did my event go?", a billing dispute,
 * or an audit of what data we held and when we destroyed it would all have
 * nothing to answer from.
 *
 * `event_id` carries NO foreign key, and that is the entire point. An FK with
 * ON DELETE CASCADE would delete this row with the event, and ON DELETE SET
 * NULL would erase the one identifier that makes it useful. It is a bare UUID
 * pointing at something that is deliberately gone.
 *
 * The counts are denormalized for the same reason: after the cascade there is
 * nothing left to count.
 */
CREATE TABLE IF NOT EXISTS public.event_purge_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL,            -- deliberately NOT a foreign key (see above)
  org_id        UUID,                     -- surviving owner, for support lookups
  event_title   TEXT,
  event_slug    TEXT,
  ended_at      TIMESTAMPTZ,              -- the effective end we computed
  warned_at     TIMESTAMPTZ,              -- when the organizer was told
  purged_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  party_count   INTEGER,
  guest_count   INTEGER,
  checkin_count INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.event_purge_log IS
  'Append-only record of every event destroyed by the post-event purge. event_id carries no FK on purpose: an FK would cascade this row away with the event it documents. Service-role only.';
COMMENT ON COLUMN public.event_purge_log.event_id IS
  'The deleted event''s id. No foreign key — the referenced row is gone by design.';

CREATE INDEX IF NOT EXISTS idx_event_purge_log_event ON public.event_purge_log (event_id);
CREATE INDEX IF NOT EXISTS idx_event_purge_log_org   ON public.event_purge_log (org_id, purged_at DESC);

-- Service-role only: RLS enabled with no policies — anon/authenticated keys can
-- neither read nor write it; only the backend service key can.
ALTER TABLE public.event_purge_log ENABLE ROW LEVEL SECURITY;
