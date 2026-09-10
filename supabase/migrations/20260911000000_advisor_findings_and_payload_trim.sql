-- ════════════════════════════════════════════════════════════════════════════
-- SUPABASE ADVISOR FINDINGS + THE DASHBOARD PAYLOAD TRIM
--
-- Everything here was found by reading the LIVE database on 2026-09-10 — the
-- Supabase Advisor report and pg_stat_statements — rather than the source. That
-- distinction matters: the three security items below survived the previous
-- hardening pass precisely because a source-only audit cannot see them.
--
-- ── WHAT THE INCIDENT ACTUALLY WAS, SO NOBODY RE-DIAGNOSES IT ──────────────
--
-- The 2026-09-03 outage was NOT a database problem. The project's own status
-- history reads:
--
--     Grace period started .......... 2026-07-30
--     Grace period ending soon ...... 2026-08-12
--     Service restrictions active ... 2026-09-04   (Critical)
--     "Your services are restricted as your organization used up your
--      Plan's quota."
--
-- and the Postgres log for the night of the 3rd contains nothing but routine
-- checkpoints writing 0.0%-0.1% of shared buffers. No errors, no lock waits, no
-- slow queries, no connection pressure. The database was very nearly idle while
-- the site was down. The account was administratively restricted for exceeding
-- the free tier's egress allowance, over a grace period five weeks long.
--
-- Nothing in this file would have prevented that outage, and no amount of extra
-- database capacity would have either. It is filed as hygiene and as headroom.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SECURITY: five SECURITY DEFINER functions with a MUTABLE search_path
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Advisor: "Function Search Path Mutable" on enforce_tier_guest_cap,
-- enforce_tier_guest_cap_on_response_update, deduct_sms_credit_atomic,
-- refund_sms_credit_atomic, count_reserved_guests.
--
-- A SECURITY DEFINER function runs as its OWNER. If it does not pin
-- `search_path`, the CALLER chooses which schema its unqualified table and
-- function references resolve to. Anyone able to create objects in a schema on
-- the caller's path can therefore shadow `guests`, or `count_reserved_guests`,
-- with their own object and have it executed with the owner's privileges. That
-- is the textbook Postgres privilege-escalation path, and the reason
-- 20260611100000_search_path_hardening.sql exists at all — these five were
-- simply missed by it, and three of them (the two cap triggers and
-- count_reserved_guests) did not exist yet when it ran.
--
-- ── WHY `ALTER FUNCTION` AND NOT `CREATE OR REPLACE` ──
--
-- Because the bodies are not being changed and MUST not be. This database has a
-- 122-file migration chain that has never been applied in order (see §4), so the
-- live definition of any given function is not reliably the one in the newest
-- file that mentions it. Re-creating from source would silently roll a function
-- back to whatever the repo last recorded. `ALTER FUNCTION ... SET search_path`
-- touches the configuration and nothing else, so it is correct even when the
-- live body has drifted from every file here.
--
-- Looped by NAME so every overload is covered without this file having to know
-- the signatures — which is the same drift problem one layer down.
DO $$
DECLARE
  r        RECORD;
  v_names  TEXT[] := ARRAY[
    'enforce_tier_guest_cap',
    'enforce_tier_guest_cap_on_response_update',
    'deduct_sms_credit_atomic',
    'refund_sms_credit_atomic',
    'count_reserved_guests'
  ];
  v_fixed  INT := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (v_names)
      -- Only those still missing the setting, so re-running is free and the
      -- NOTICE below reports real work rather than a fixed number.
      AND NOT EXISTS (
        SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) c
        WHERE c LIKE 'search_path=%'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', r.sig);
    RAISE NOTICE 'search_path pinned on %', r.sig;
    v_fixed := v_fixed + 1;
  END LOOP;

  RAISE NOTICE 'functions hardened: % (0 means they were already pinned)', v_fixed;

  -- Say so loudly if a name is absent entirely: that means the function was
  -- renamed or dropped and this list has itself drifted.
  FOR r IN
    SELECT unnest(v_names) AS proname
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = r.proname
    ) THEN
      RAISE WARNING 'function %.% does not exist — the hardening list is stale', 'public', r.proname;
    END IF;
  END LOOP;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SECURITY: mv_daily_revenue is readable through the public API
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Advisor: "Materialized View in API — public.mv_daily_revenue".
--
-- This is EVERY DAY'S GROSS, REFUNDED AND NET REVENUE for the whole platform,
-- plus the payment count. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is compiled into the
-- browser bundle, so `GET /rest/v1/mv_daily_revenue?select=*` hands the
-- company's entire revenue history to anyone who opens the site.
--
-- 20260910010000_anon_surface_lockdown.sql closed the anon FUNCTION surface and
-- the anon TABLE surface, and it closed neither of them here: a materialized
-- view is not a function, and — the part worth remembering — **RLS CANNOT BE
-- ENABLED ON A MATERIALIZED VIEW AT ALL**. `ALTER MATERIALIZED VIEW ... ENABLE
-- ROW LEVEL SECURITY` is not valid syntax. The only control available is the
-- GRANT, which is why this needs its own statement rather than being covered by
-- the blanket table sweep.
--
-- The backend reads this as the service role (adminController → the Financial
-- Command Center), and the service role's access does not flow through these
-- grants, so nothing the product does is affected.
-- ── ONE STATEMENT, PUBLIC NAMED FIRST ──
--
-- The target list is composed rather than written out because `anon` and
-- `authenticated` are created by the Supabase platform, not by this chain: a
-- bare Postgres (a contributor's instance, a restore into an empty cluster)
-- would fail on an undefined role and take the migration with it.
--
-- What it does NOT do is issue one revoke per role. `REVOKE ... FROM anon` on
-- its own is the exact ineffective line that 20260910010000 was written to undo
-- — the privilege is held via PUBLIC, and revoking it from a role that inherits
-- it changes nothing — and backend/test/dbHardeningChain.test.js fails any
-- migration that reintroduces the shape, including this one. Which it did, on
-- the first draft of this file. PUBLIC leads the list.
DO $$
DECLARE
  v_targets TEXT := 'PUBLIC';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'mv_daily_revenue' AND c.relkind = 'm'
  ) THEN
    RAISE WARNING 'mv_daily_revenue not found — skipping (the Financial Command Center will be empty)';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    v_targets := v_targets || ', anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    v_targets := v_targets || ', authenticated';
  END IF;

  EXECUTE format('REVOKE ALL ON public.mv_daily_revenue FROM %s', v_targets);

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT ON public.mv_daily_revenue TO service_role;
  END IF;

  RAISE NOTICE 'mv_daily_revenue: revoked from %, granted to service_role', v_targets;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. REPORT ONLY: the duplicate index on public.events
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Advisor: "Duplicate Index — public.events".
--
-- A redundant index is not free: every INSERT and UPDATE on `events` maintains
-- it, it consumes cache that useful indexes want, and it makes the planner's job
-- marginally harder. It is also the single most tempting thing in this file to
-- drop automatically, and this migration deliberately DOES NOT.
--
-- Dropping an index is not reversible inside the transaction that finds it: if
-- the "duplicate" turns out to back a constraint, or to differ in an operator
-- class, or to be the one a hot query was actually planned against, the repair
-- is a rebuild on a live table. A file that cannot see the database has no
-- business making that call on its own.
--
-- So this NAMES them and stops. Read the NOTICE, confirm which of the pair you
-- want gone, and drop it by hand:  DROP INDEX CONCURRENTLY public.<name>;
-- ── A BUG THIS QUERY HAD, AND WHAT IT TAUGHT ──
--
-- The first version joined `pg_constraint` to label each index CONSTRAINT or
-- plain:
--
--     LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid
--
-- and reported `events_pkey` as duplicated TWENTY-NINE TIMES. It is not
-- duplicated at all. For a FOREIGN KEY, `conindid` is the index on the
-- REFERENCED table that enforces it — so every one of the 29 tables with an FK
-- to `events` produced another row for the single `events_pkey`, and the
-- aggregate counted them. `guests_pkey` came back four times, `tables_pkey`
-- five, for exactly the same reason.
--
-- A report that cries wolf 20 times to name one real finding is worse than no
-- report: the one real row (`events_slug_key` vs `idx_events_slug`) was buried.
-- The constraint check is now a scalar subquery, which cannot multiply rows,
-- and the HAVING counts DISTINCT index oids so a repeated join can never again
-- be mistaken for a repeated index.
DO $$
DECLARE
  r          RECORD;
  v_found    INT := 0;
BEGIN
  FOR r IN
    SELECT
      c.relname AS table_name,
      array_agg(i.indexrelid::regclass::text ORDER BY i.indexrelid) AS idx_names,
      -- Scalar, not a join. A constraint-backed index must be the survivor:
      -- dropping it drops the guarantee, not just the lookup.
      array_agg(
        CASE WHEN EXISTS (
          SELECT 1 FROM pg_constraint con WHERE con.conindid = i.indexrelid AND con.conrelid = i.indrelid
        ) THEN 'CONSTRAINT' ELSE 'plain' END
        ORDER BY i.indexrelid
      ) AS kinds,
      pg_get_indexdef(min(i.indexrelid)) AS definition
    FROM pg_index i
    JOIN pg_class c     ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
    GROUP BY c.relname, i.indrelid, i.indkey, i.indclass, i.indexprs, i.indpred, i.indisunique
    HAVING count(DISTINCT i.indexrelid) > 1
  LOOP
    v_found := v_found + 1;
    RAISE NOTICE 'DUPLICATE INDEX on %: % (kinds: %) — def: %',
      r.table_name, r.idx_names, r.kinds, r.definition;
  END LOOP;

  IF v_found = 0 THEN
    RAISE NOTICE 'no duplicate indexes found (the advisor finding may already be resolved)';
  ELSE
    RAISE NOTICE 'duplicate index groups: % — DROP the "plain" one BY HAND, never the CONSTRAINT one', v_found;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. PAYLOAD: get_event_parties returns 23 party columns; the caller reads 10
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ── WHY THIS IS AN EGRESS FIX, NOT A SPEED FIX ──
--
-- pg_stat_statements makes this the heaviest APPLICATION statement on the
-- database — 277,464 ms across 14,476 calls — but at 19.2 ms a call it is not
-- slow. What it is, is BIG, and big is what actually cost money here: the
-- account was restricted for egress, and every byte PostgREST returns to the
-- Express server is billed egress before it is ever billed again to the browser.
--
-- The dashboard polls this every 20 seconds per open tab (useRealtimeRSVPs) and
-- walks EVERY page of it (fetchAllRsvps), so the multiplier on each surplus
-- column is large and continuous. Both of those live in the front end and are
-- deliberately untouched here; this narrows what the server hands them.
--
-- ── THE CONTRACT, VERIFIED AGAINST ITS ONE CONSUMER ──
--
-- `to_jsonb(p)` splatted all 23 columns of rsvp_parties. There is exactly one
-- caller in the codebase — guestService.listParties → rsvpController.getRSVPs →
-- frontend/src/app/dashboard/page.js — and it reads exactly ten of them:
--
--     id, label, response, notes, side, created_at,
--     companion_meal_counts, sms_consent, sms_consent_at, sms_consent_method
--
-- The thirteen now withheld are event_id (the caller supplied it),
-- max_party_size, decline_reason, maybe_confirm_by, response_source,
-- responded_at, updated_at, created_by_organizer, preferred_lang,
-- sms_consent_text_version, sms_consent_source, sms_consent_attested_by and
-- sms_consent_attested_at. `sms_opted_out` is absent from this list on purpose:
-- it is not a column at all — rsvpController attaches it to each party after the
-- fact from the global sms_opt_outs table.
--
-- backend/test/rsvpListPayloadContract.test.js pins that list, so adding a field
-- to the dashboard without adding it here fails a test instead of rendering a
-- blank column in production.
--
-- `guests`, `custom_answers`, `seating_assignments` and `invitations` are
-- returned UNCHANGED. Trimming the guest rows would save more, and it is not
-- done here: those rows are passed through whole to several dashboard
-- components (the party modal, the seating editor, the exports) and narrowing
-- them safely needs an audit of the front end, which is out of scope for this
-- phase.
CREATE OR REPLACE FUNCTION public.get_event_parties(
  p_event_id           UUID,
  p_response           TEXT DEFAULT NULL,   -- 'yes'|'no'|'maybe'|'pending'|'waitlist' (already validated)
  p_search             TEXT DEFAULT NULL,   -- pre-escaped LIKE fragment, matched as %…% on the label
  p_seated             TEXT DEFAULT NULL,   -- 'true' | 'false' | NULL (no filter)
  p_meal               TEXT DEFAULT NULL,
  p_custom_field_id    UUID DEFAULT NULL,
  p_custom_field_value TEXT DEFAULT NULL,
  p_sort               TEXT DEFAULT NULL,   -- 'name_asc'|'name_desc'|'date_asc' | default: created_at DESC
  p_limit              INT  DEFAULT 50,
  p_offset             INT  DEFAULT 0
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT p.id, p.label, p.created_at
    FROM rsvp_parties p
    WHERE p.event_id = p_event_id
      AND (p_response IS NULL OR p.response::text = p_response)
      AND (p_search IS NULL OR p.label ILIKE '%' || p_search || '%')
      AND (
        p_seated IS NULL
        OR (p_seated = 'true'  AND     EXISTS (SELECT 1 FROM seating_assignments sa WHERE sa.party_id = p.id AND sa.event_id = p_event_id))
        OR (p_seated = 'false' AND NOT EXISTS (SELECT 1 FROM seating_assignments sa WHERE sa.party_id = p.id AND sa.event_id = p_event_id))
      )
      AND (
        p_meal IS NULL
        OR EXISTS (SELECT 1 FROM guests g WHERE g.party_id = p.id AND g.meal_selection = p_meal)
      )
      AND (
        p_custom_field_id IS NULL
        OR EXISTS (
          SELECT 1 FROM custom_answers ca
          WHERE ca.party_id = p.id
            AND ca.field_id = p_custom_field_id
            -- answer_value is jsonb; `#>> '{}'` yields the scalar as unquoted text,
            -- matching the JS `String(answer_value).trim().toLowerCase()` compare.
            AND (
              p_custom_field_value IS NULL
              OR lower(btrim(ca.answer_value #>> '{}')) = lower(btrim(p_custom_field_value))
            )
        )
      )
  ),
  page AS (
    SELECT f.id,
           row_number() OVER (
             ORDER BY
               CASE WHEN p_sort = 'name_asc'  THEN f.label      END ASC  NULLS LAST,
               CASE WHEN p_sort = 'name_desc' THEN f.label      END DESC NULLS LAST,
               CASE WHEN p_sort = 'date_asc'  THEN f.created_at END ASC,
               CASE WHEN p_sort IS NULL OR p_sort NOT IN ('name_asc', 'name_desc', 'date_asc')
                    THEN f.created_at END DESC
           ) AS rn
    FROM filtered f
    ORDER BY rn
    LIMIT  GREATEST(p_limit, 0)
    OFFSET GREATEST(p_offset, 0)
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtered),
    'parties', COALESCE((
      SELECT jsonb_agg(party_json ORDER BY rn)
      FROM (
        SELECT
          pg.rn,
          -- Explicit, not to_jsonb(p). See the note above: this is the contract,
          -- and backend/test/rsvpListPayloadContract.test.js enforces it.
          jsonb_build_object(
                 'id',                    p.id,
                 'label',                 p.label,
                 'response',              p.response,
                 'notes',                 p.notes,
                 'side',                  p.side,
                 'created_at',            p.created_at,
                 'companion_meal_counts', p.companion_meal_counts,
                 'sms_consent',           p.sms_consent,
                 'sms_consent_at',        p.sms_consent_at,
                 'sms_consent_method',    p.sms_consent_method
               )
            || jsonb_build_object(
                 'guests', COALESCE((
                   SELECT jsonb_agg(to_jsonb(g) ORDER BY g.is_primary_contact DESC, g.id)
                   FROM guests g WHERE g.party_id = p.id
                 ), '[]'::jsonb),
                 'custom_answers', COALESCE((
                   SELECT jsonb_agg(to_jsonb(ca) ORDER BY ca.created_at, ca.id)
                   FROM custom_answers ca WHERE ca.party_id = p.id
                 ), '[]'::jsonb),
                 'seating_assignments', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'id', sa.id,
                            'table_id', sa.table_id,
                            'tables', CASE WHEN t.id IS NULL THEN NULL
                                      ELSE jsonb_build_object('table_name', t.table_name) END)
                          ORDER BY sa.assigned_at, sa.id)
                   FROM seating_assignments sa
                   LEFT JOIN tables t ON t.id = sa.table_id
                   WHERE sa.party_id = p.id AND sa.event_id = p_event_id
                 ), '[]'::jsonb),
                 'invitations', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object('channel', i.channel, 'status', i.status)
                          ORDER BY i.created_at, i.id)
                   FROM invitations i WHERE i.party_id = p.id
                 ), '[]'::jsonb)
               ) AS party_json
        FROM page pg
        JOIN rsvp_parties p ON p.id = pg.id
      ) x
    ), '[]'::jsonb)
  );
$$;

-- Callable only by the backend. Re-stated because CREATE OR REPLACE resets the
-- ACL to the default — which, as 20260910010000 documented at length, is a grant
-- to PUBLIC. Leaving this off would silently re-open the function that returns a
-- whole event's guest list.
-- PUBLIC first, in one statement, for the reason spelled out above §2.
DO $$
DECLARE
  v_sig     TEXT := 'public.get_event_parties(UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, INT, INT)';
  v_targets TEXT := 'PUBLIC';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    v_targets := v_targets || ', anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    v_targets := v_targets || ', authenticated';
  END IF;

  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s', v_sig, v_targets);

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_sig);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. SECURITY: the whole asset bucket is anonymously enumerable
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Advisor: "Public Bucket Allows Listing — storage.event-assets". Verified
-- against production on 2026-09-10 with nothing but the anon key that ships in
-- the browser bundle:
--
--     POST /storage/v1/object/list/event-assets  {"prefix":"","limit":100}
--       → 200, 12 folders: blog-covers, covers, gallery, hero-video,
--         invitation-bg, music, portraits, seals
--     POST … {"prefix":"portraits"} → 200, filenames
--     POST … {"prefix":"gallery"}   → 200, filenames
--
-- 283 objects, enumerable recursively by anyone who opens the site. And the
-- filenames are `<event-uuid>-<timestamp>-<rand>.<ext>`, so the listing does not
-- just leak every customer's uploaded photographs — it leaks the EVENT IDS,
-- which are the identifiers other endpoints accept.
--
-- ── WHY DROPPING THE READ POLICY IS SAFE, WHICH IS NOT OBVIOUS ──
--
-- The instinct is to set `public = false` on the bucket. That would break every
-- invitation page on the platform, because the guest pages load these images by
-- public URL. This does something narrower.
--
-- Two facts, both checked rather than assumed:
--
--   1. NOTHING IN THE PRODUCT LISTS. A grep of frontend/src for the Storage API
--      finds `.upload()` and `.getPublicUrl()` and no `.list()` anywhere.
--      `getPublicUrl` builds a string client-side; it performs no request and
--      needs no policy.
--
--   2. PUBLIC SERVING DOES NOT GO THROUGH RLS. On a public bucket the
--      `/object/public/…` route bypasses row-level security entirely. Verified:
--      a HEAD for one of the portraits above, with NO apikey and NO headers of
--      any kind, returned HTTP 200, image/jpeg, 190,795 bytes.
--
-- So the SELECT policy is what enables the LIST endpoint, and only that. Images
-- keep loading; enumeration stops.
--
-- ── WHAT THIS DELIBERATELY DOES NOT TOUCH: THE INSERT POLICY ──
--
-- `allow_insert_images` grants INSERT to `anon`, which means anyone holding the
-- browser key can upload into this bucket. That is worse than the listing — it
-- is an anonymous file host attached to the egress bill that got this project
-- restricted on 2026-09-03 — and it CANNOT simply be dropped or narrowed to
-- `authenticated`, because **this platform does not use Supabase Auth**. No
-- organizer ever holds a Supabase JWT (Monthly Active Users reads 0), so every
-- upload the dashboard and the admin make is anonymous BY DESIGN. Removing the
-- policy would break image upload everywhere in the product.
--
-- The real fix is to route uploads through the Express API on the service role
-- and revoke anon INSERT. That is an architectural change, it touches the front
-- end, and it belongs to its own phase. Filed here as NEEDS ACTION rather than
-- silently half-done.
DO $$
DECLARE
  r       RECORD;
  v_count INT := 0;
BEGIN
  FOR r IN
    SELECT p.polname
    FROM pg_policy p
    JOIN pg_class     c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'storage'
      AND c.relname = 'objects'
      AND p.polcmd = 'r'                      -- SELECT only. INSERT is left alone, see above.
      AND EXISTS (
        SELECT 1 FROM pg_roles ro
        WHERE ro.oid = ANY (p.polroles) AND ro.rolname = 'anon'
      )
  LOOP
    -- Quoted: the live policy is named `allow_read_images 1kg7cba_0` — a space
    -- and a generated suffix, courtesy of the Storage UI.
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', r.polname);
    RAISE NOTICE 'dropped anon SELECT policy on storage.objects: %', r.polname;
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    RAISE NOTICE 'no anon SELECT policy on storage.objects (already resolved)';
  END IF;

  -- Say the remaining exposure out loud on every run, so it cannot be forgotten
  -- just because the listing hole closed.
  IF EXISTS (
    SELECT 1 FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'storage' AND c.relname = 'objects' AND p.polcmd = 'a'
      AND EXISTS (SELECT 1 FROM pg_roles ro WHERE ro.oid = ANY (p.polroles) AND ro.rolname = 'anon')
  ) THEN
    RAISE WARNING 'STILL OPEN: anon can INSERT into storage. Uploads are anonymous by design (no Supabase Auth) — fix by moving uploads server-side, not by dropping this policy.';
  END IF;
END $$;

COMMIT;
