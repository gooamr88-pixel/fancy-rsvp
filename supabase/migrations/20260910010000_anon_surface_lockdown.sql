-- ════════════════════════════════════════════════════════════════════════
-- CLOSING THE ANON-KEY SURFACE (tables, policies, and RPC EXECUTE)
-- ────────────────────────────────────────────────────────────────────────
-- `NEXT_PUBLIC_SUPABASE_ANON_KEY` is compiled into the browser bundle
-- (frontend/src/app/utils/supabaseClient.js — it is there for Storage
-- uploads). Anyone who opens the site therefore holds a working PostgREST
-- credential for the `anon` role. Everything reachable by `anon` is public.
--
-- 20260615400000_rls_pii_lockdown.sql established the rule this migration
-- restores and then extends: **this platform does not use Supabase Auth for
-- organizers**. Every read and write goes through the Express API with the
-- SERVICE ROLE key. A grep of frontend/src confirms the browser client is
-- used for `supabase.storage` only — there is not one `.from()` or `.rpc()`
-- call against a table or function anywhere in the front end. So `anon` and
-- `authenticated` need NO table access and NO function access, and taking
-- both away cannot break a code path that exists.
--
-- Three separate holes are closed here.
--
-- ── 1. FOUR TABLES NEVER HAD RLS ENABLED ──
--
--   contact_submissions       name, email, subject, message, IP of every
--                             inquiry, including the qualified /solutions
--                             sales leads
--   newsletter_subscribers    the marketing email list
--   sms_campaigns             historical campaign bodies
--   sms_campaign_recipients   historical recipient PHONE NUMBERS — kept
--                             deliberately as the SMS compliance record
--
-- Supabase's stock `ALTER DEFAULT PRIVILEGES` grants ALL on new tables in
-- `public` to anon and authenticated, and nothing in this chain revokes that.
-- With RLS off, those grants are the whole story: any visitor could SELECT,
-- INSERT, UPDATE and DELETE these tables directly. Enabling RLS with no
-- policies denies by default — the same shape already used for sms_log,
-- sms_opt_outs, sms_consent_log and seating_notify_queue — while the
-- service-role backend is unaffected because it bypasses RLS entirely.
--
-- ── 2. TWO PUBLIC READ POLICIES WERE ADDED BACK AFTER THE PII LOCKDOWN ──
--
-- 20260822000000_sms_rebuild.sql created:
--
--   short_links  public_select_short_links  FOR SELECT TO public USING (true)
--
-- which defeats the entire security argument for short links. That file's own
-- comment says "what a code exposes if guessed is exactly what the link it
-- replaces exposes, which is why the code must be long enough not to be
-- enumerable" — and then makes guessing unnecessary: `GET /rest/v1/short_links
-- ?select=*` hands back every code and target URL on the platform, i.e. every
-- guest's personalised RSVP link for every event. Those links carry `party_id`,
-- which getPublicEventBySlug accepts as an invitation token: it unlocks PRIVATE
-- events and returns that party's name, email, phone and response.
--
-- The same file also recreated `guest_select_events ... USING (status IN
-- ('active','cancelled'))`, re-exposing the whole events row — access_password
-- hash, is_paid, org_id, template_data, sms_settings, sms_templates — for every
-- live event. `utils/shortLinks.resolve()` and `getPublicEventBySlug` both run
-- as the service role, so neither policy is used by anything.
--
-- Rather than name the two, this drops EVERY policy in `public` that grants to
-- PUBLIC or to `anon`, because the class of mistake — a later migration quietly
-- re-adding one — is what actually happened here twice.
--
-- ── 3. `REVOKE ... FROM anon, authenticated` NEVER BLOCKED ANYTHING ──
--
-- This is the important one. Forty-odd migrations end with a line like
--
--     REVOKE ALL ON FUNCTION public.submit_rsvp_v2(…) FROM anon, authenticated;
--
-- and every one of them is a no-op for access control. PostgreSQL grants
-- EXECUTE on a new function to **PUBLIC** by default, and PUBLIC is not a role
-- you can be revoked out of: revoking the privilege from `anon` removes only
-- the grant held *as anon*, leaving the one held *via PUBLIC* fully effective.
-- So `submit_rsvp_v2`, `get_event_parties`, `checkin_batch_upsert`,
-- `checkin_undo`, `redeem_promo_code`, `record_sms_purchase`,
-- `reserve_referral_credit`, `increment_sms_credits` and the rest have been
-- callable by anyone holding the anon key for the life of the project, in spite
-- of the REVOKE line directly beneath each definition.
--
-- Two consequences, both real:
--   • Authorisation bypass. `increment_sms_credits(event_id, n)` takes no
--     actor and performs no check — it adds paid SMS credits to a wallet.
--     `get_event_parties(event_id, …)` returns a whole event's guest list with
--     names, emails, phones and custom answers.
--   • Database load. These are the most expensive statements in the product
--     and they sit behind no Express rate limiter at all — PostgREST is a
--     different origin from the API. `get_event_parties` on a large event, or
--     `refresh_daily_revenue()` (which re-aggregates every payment ever taken)
--     in a loop, is an anonymous, unauthenticated way to saturate the database.
--
-- The fix revokes from PUBLIC as well as from anon/authenticated, for every
-- function in `public`, and then grants EXECUTE back to service_role — the one
-- role that actually calls them. Function owners keep their privileges
-- implicitly, so trigger functions are unaffected (and PostgreSQL checks
-- EXECUTE on a trigger function at CREATE TRIGGER time, not on each fire).
--
-- The matching ALTER DEFAULT PRIVILEGES at the end is what stops this coming
-- back with the next migration that adds a function.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. RLS on the four tables that never had it ─────────────────────────
-- No policies: RLS-on-with-no-policy denies every non-superuser role that does
-- not bypass RLS. The backend's service role bypasses it.

ALTER TABLE public.contact_submissions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_subscribers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_campaigns           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_campaign_recipients ENABLE ROW LEVEL SECURITY;


-- ─── 2. Drop every policy in `public` that grants to PUBLIC or to anon ───
--
-- polroles = '{0}' is the catalog's representation of TO PUBLIC. Policies
-- scoped to `authenticated` are LEFT ALONE: they are unreachable today (no
-- organizer holds a Supabase-Auth JWT) and they are the defence-in-depth the
-- PII lockdown deliberately preserved for a future migration to Supabase Auth.

DO $$
DECLARE
  r          RECORD;
  v_anon_oid OID := (SELECT oid FROM pg_roles WHERE rolname = 'anon');
  v_dropped  INT := 0;
BEGIN
  FOR r IN
    SELECT pol.polname, cls.relname
    FROM pg_policy pol
    JOIN pg_class     cls ON cls.oid = pol.polrelid
    JOIN pg_namespace nsp ON nsp.oid = cls.relnamespace
    WHERE nsp.nspname = 'public'
      AND (
        pol.polroles = '{0}'::oid[]
        OR (v_anon_oid IS NOT NULL AND v_anon_oid = ANY (pol.polroles))
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.polname, r.relname);
    RAISE NOTICE 'dropped anon/public policy %.% ', r.relname, r.polname;
    v_dropped := v_dropped + 1;
  END LOOP;
  RAISE NOTICE 'anon/public policies dropped: %', v_dropped;
END $$;


-- ─── 3. EXECUTE: revoke from PUBLIC (the grant that was actually in force) ──

-- Role names are guarded throughout: `anon`, `authenticated` and `service_role`
-- are created by the Supabase platform, not by this chain, so a plain
-- Postgres — a contributor's own instance, a restore into a bare cluster —
-- would otherwise fail the whole migration on an undefined role.
DO $$
DECLARE
  r         RECORD;
  v_count   INT := 0;
  v_roles   TEXT[] := ARRAY(
    SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
  );
  v_svc     BOOLEAN := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role');
  v_role    TEXT;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind IN ('f', 'p')   -- functions and procedures; not aggregates/windows
  LOOP
    -- THE ONE THAT MATTERS. Everything else in this loop is tidying: the
    -- privilege actually in force is the built-in grant to PUBLIC.
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);

    FOREACH v_role IN ARRAY v_roles LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', r.sig, v_role);
    END LOOP;

    -- The backend is the only caller. Granted explicitly because the PUBLIC
    -- revoke above would otherwise take service_role's access with it.
    IF v_svc THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    END IF;

    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'functions locked to service_role: %', v_count;
END $$;


-- ─── 4. Stop the next migration from re-opening any of it ────────────────
--
-- Applies to objects created by the role running THIS statement — which is the
-- role that runs every migration — so a function or table added by a future
-- migration arrives closed instead of open. Anything that genuinely needs anon
-- access must then GRANT it deliberately, in writing, in its own migration.
--
-- Caveat worth knowing rather than discovering: `ALTER DEFAULT PRIVILEGES` is
-- per grantor. If the platform's stock defaults were installed by a different
-- role (supabase_admin rather than postgres), this does not cancel them and a
-- future table can still arrive with anon grants. That is why the RLS guard in
-- backend/test/dbHardeningChain.test.js exists as well — the belt is here, the
-- braces are the test.

DO $$
DECLARE v_targets TEXT := 'PUBLIC';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    v_targets := v_targets || ', anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    v_targets := v_targets || ', authenticated';
  END IF;

  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM %s',
    v_targets
  );

  -- Tables have no built-in PUBLIC grant, so only the two platform roles are
  -- relevant here.
  IF v_targets <> 'PUBLIC' THEN
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %s',
      replace(v_targets, 'PUBLIC, ', '')
    );
  END IF;
END $$;

COMMIT;
