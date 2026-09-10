# `supabase/`

## What is authoritative

**`migrations/` is the only source of truth for this schema.** Nothing else in
this folder describes the database; everything else is a tool or a record.

Verify the chain against the code with:

```bash
node backend/scripts/audit-schema.js
```

It parses the chain directly and reports anything the code selects that no
migration creates. It read **0 findings** on 2026-09-10. It is itself guarded by
`backend/test/schemaChain.test.js`.

> ⚠️ **Never add DDL to `backend/migrations/`.** That directory is outside the
> chain and is exactly how this project ended up with three competing accounts of
> its own schema. It is kept only as the historical record.

## Layout

| Path | What it is |
| --- | --- |
| `migrations/` | The chain. Authoritative. Add here, never edit an applied file. |
| `functions/` | Deployed Edge Functions (`send-email`, `stripe-webhook`). |
| `checks/` | Read-only diagnostics. Safe to run against production any time. |
| `config.toml` | Supabase CLI config. Required. |
| `schema.sql` | A generated reference snapshot. **Currently stale — see below.** |
| `BASELINE-schema-migrations.sql` | One-time ledger baseline, 2026-09-10. Kept as the record of what was declared applied. |
| `clean_database.sql` | Wipes every table. **Development and staging only.** Referenced by `docs/UAT-Plan.md`. |
| `MAKE_SUPER_ADMIN.sql` | Grants super-admin. Note this platform does **not** use Supabase Auth — accounts live in `public.organizations`. |

## `schema.sql` is stale, and is kept anyway

Its own header says so: last regenerated at `20260719000000`, with ~50
migrations added since. **Do not read it to answer "what columns does X have?"**
— use `migrations/` or query the database.

It is not deleted because `docs/Checkin-Discovery-Report.md` and
`docs/Checkin-Spec-Amendments.md` cite it by line number in about ten places, and
those citations are a historical audit record.

To regenerate it properly (needs the CLI linked and the database password):

```bash
supabase db dump --schema public -f supabase/schema.sql
```

After regenerating, delete the STALE warning block at the top of the file.

## The migration ledger

`supabase_migrations.schema_migrations` held **zero rows** against 122 applied
migrations until 2026-09-10, because every migration in this project's history
has been hand-pasted into the SQL editor — which applies the SQL and records
nothing.

That made `supabase db push` a loaded gun: it would have replayed the chain from
file #1 against a database that already had everything, including
`DROP MATERIALIZED VIEW`, an `ALTER TABLE … RENAME`, and backfill `UPDATE`s over
live rows.

**Pasting a migration by hand still does not record it.** After applying one, add
its row deliberately:

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('<version>', '<name>') ON CONFLICT (version) DO NOTHING;
```

Regenerate the baseline for a new cutoff with:

```bash
node backend/scripts/generate-migration-baseline.js --through <version>
```

## What was removed on 2026-09-10

Six "paste this into the SQL editor" scripts totalling ~197 kB —
`APPLY-sms-chain.sql`, `APPLY_SMS_SCHEMA.sql`, `apply-2026-08-27.sql`,
`RUN_THIS_NOW.sql`, `RUN_THIS_NOW_2_tier_key.sql`,
`cleanup_stale_pre_clean_rows.sql`.

Every one of them was generated **verbatim from files already in `migrations/`**
(the first says so in its own header). They existed as a safety net for a period
when the ledger was empty and nobody could tell what had been applied. The
baseline plus a clean `audit-schema.js` run replaced that need; keeping them
would mean two copies of the same DDL, drifting apart.

They remain in git history if one is ever needed.
