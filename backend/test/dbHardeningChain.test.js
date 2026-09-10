/**
 * THREE DATABASE MISTAKES THAT ARE INVISIBLE UNTIL THEY ARE EXPENSIVE.
 *
 * Each of these was found in this schema, none of them failed anything, and all
 * three are a one-line omission in an otherwise correct migration. So they are
 * checked here, against the migration chain itself, where a filename and a
 * `CREATE TABLE` are all the evidence needed.
 *
 * ── 1. A NEW TABLE WITH NO `ENABLE ROW LEVEL SECURITY` IS PUBLIC ──
 *
 * Supabase's stock `ALTER DEFAULT PRIVILEGES` grants ALL on new tables in
 * `public` to `anon` and `authenticated`, and the anon key is compiled into the
 * browser bundle. RLS is therefore the only thing standing between a new table
 * and the internet. Four tables shipped without it — `contact_submissions`,
 * `newsletter_subscribers`, `sms_campaigns`, `sms_campaign_recipients` —
 * carrying inquiry PII, the marketing list, and the retained SMS compliance
 * record with its recipient phone numbers.
 *
 * ── 2. AN UNINDEXED FOREIGN KEY IS A SEQUENTIAL SCAN PER PARENT ROW ──
 *
 * `ON DELETE CASCADE` / `SET NULL` is enforced with `DELETE FROM child WHERE
 * fk = $1`, once per deleted parent row. With no index whose LEADING column is
 * that FK, each one scans the whole child table. `submit_rsvp_v2` deletes and
 * re-inserts a party's guests on every RSVP re-submission, inside a per-event
 * advisory lock — so on this schema an unindexed FK is not a maintenance-window
 * problem, it is on the public guest write path. A PARTIAL index does not
 * count: `(event_id) WHERE is_active` cannot serve the unconditional lookup a
 * cascade issues.
 *
 * ── 3. `REVOKE ... FROM anon` DOES NOT REVOKE ANYTHING ──
 *
 * PostgreSQL grants EXECUTE on a new function to PUBLIC, and a privilege held
 * via PUBLIC survives being revoked from a role. Forty migrations in this chain
 * end with `REVOKE ALL ON FUNCTION … FROM anon, authenticated` and not one of
 * them closed the function. 20260910010000 revokes from PUBLIC and re-grants
 * service_role; this test stops the pattern being reintroduced by a later
 * migration that copies the old, ineffective line.
 */
require('./helpers/env');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

/** The migration that closed the anon surface. Rules below apply from here on. */
const LOCKDOWN_VERSION = '20260910010000';

/** `--` comments, stripped CRLF-safely (a JS `.` does not match `\r`). */
const strip = (src) => src.replace(/--[^\r\n]*/g, '');

const read = (f) => strip(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));

const norm = (t) => t.replace(/"/g, '').replace(/^public\./i, '').toLowerCase();

/* ── Parse the chain once ─────────────────────────────────────────────────── */

const createdTables = new Map();      // table -> file
const rlsEnabled = new Set();
const renamedTo = new Map();          // old -> new
const fks = [];                       // { table, col, parent, action, file }
const indexLeading = new Map();       // table -> Set(leading column)

function addLeading(table, colExpr) {
  const t = norm(table);
  const c = String(colExpr).replace(/"/g, '').trim().split(/\s+/)[0].toLowerCase();
  if (!indexLeading.has(t)) indexLeading.set(t, new Set());
  indexLeading.get(t).add(c);
}

/** First top-level column of an index/constraint column list. */
function firstColumn(list) {
  let depth = 0;
  let out = '';
  for (const ch of list) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) break;
    out += ch;
  }
  return out;
}

for (const file of files) {
  const src = read(file);
  let m;

  const createTable = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_."]+)\s*\(([\s\S]*?)\n\s*\)\s*;/gi;
  while ((m = createTable.exec(src)) !== null) {
    const table = norm(m[1]);
    if (!createdTables.has(table)) createdTables.set(table, file);

    // Split the body on top-level commas.
    const parts = [];
    let depth = 0;
    let cur = '';
    for (const ch of m[2]) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);

    for (const raw of parts) {
      const p = raw.trim();
      if (!p) continue;
      let mm;
      if ((mm = /^(?:CONSTRAINT\s+\S+\s+)?(?:PRIMARY\s+KEY|UNIQUE)\s*\(([^)]*)\)/i.exec(p))) {
        addLeading(table, firstColumn(mm[1]));
        continue;
      }
      if ((mm = /^(?:CONSTRAINT\s+\S+\s+)?FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+([A-Za-z0-9_."]+)([\s\S]*)$/i.exec(p))) {
        fks.push({ table, col: norm(firstColumn(mm[1])), parent: norm(mm[2]), action: onDelete(mm[3]), file });
        continue;
      }
      const col = p.split(/\s+/)[0];
      if (/^(PRIMARY|UNIQUE|CHECK|CONSTRAINT|FOREIGN|EXCLUDE|LIKE)$/i.test(col)) continue;
      if (/\bPRIMARY\s+KEY\b/i.test(p) || /\bUNIQUE\b/i.test(p)) addLeading(table, col);
      if ((mm = /\bREFERENCES\s+([A-Za-z0-9_."]+)([\s\S]*)$/i.exec(p))) {
        fks.push({ table, col: norm(col), parent: norm(mm[1]), action: onDelete(mm[2]), file });
      }
    }
  }

  const alterFk = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([A-Za-z0-9_."]+)\s+ADD\s+(?:CONSTRAINT\s+\S+\s+)?FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+([A-Za-z0-9_."]+)([^;]*);/gi;
  while ((m = alterFk.exec(src)) !== null) {
    fks.push({ table: norm(m[1]), col: norm(firstColumn(m[2])), parent: norm(m[3]), action: onDelete(m[4]), file });
  }

  const alterUnique = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([A-Za-z0-9_."]+)\s+ADD\s+(?:CONSTRAINT\s+\S+\s+)?(?:PRIMARY\s+KEY|UNIQUE)\s*\(([^)]*)\)/gi;
  while ((m = alterUnique.exec(src)) !== null) addLeading(m[1], firstColumn(m[2]));

  /**
   * A partial index generally CANNOT serve the unconditional lookup a cascade
   * issues (`(event_id) WHERE is_active` is useless for `event_id = $1` on an
   * inactive row) — with one exception the planner really does take: when the
   * predicate is `<the leading column> IS NOT NULL`. `=` is strict, so
   * `col = $1` proves `col IS NOT NULL`, and PostgreSQL's predicate-implication
   * check accepts the index. That shape is worth keeping on a wide, mostly-NULL
   * column, so it counts here.
   */
  const createIndex = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?[A-Za-z0-9_"]+\s+ON\s+(?:ONLY\s+)?([A-Za-z0-9_."]+)\s*(?:USING\s+\w+\s*)?\(([^;]*?)\)\s*(WHERE[^;]*?)?;/gis;
  while ((m = createIndex.exec(src)) !== null) {
    const lead = firstColumn(m[2]).replace(/"/g, '').trim().split(/\s+/)[0];
    const where = (m[3] || '').replace(/\s+/g, ' ').trim();
    if (where) {
      const notNullOnly = new RegExp(`^WHERE \\(?${lead}\\)? IS NOT NULL\\)?$`, 'i');
      if (!notNullOnly.test(where)) continue;
    }
    addLeading(m[1], lead);
  }

  const rls = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([A-Za-z0-9_."]+)\s+(?:FORCE\s+)?ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
  while ((m = rls.exec(src)) !== null) rlsEnabled.add(norm(m[1]));

  const rename = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_."]+)\s+RENAME\s+TO\s+([A-Za-z0-9_."]+)/gi;
  while ((m = rename.exec(src)) !== null) renamedTo.set(norm(m[1]), norm(m[2]));
}

function onDelete(tail) {
  const m = /ON\s+DELETE\s+(CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION|SET\s+DEFAULT)/i.exec(tail || '');
  return m ? m[1].toUpperCase().replace(/\s+/g, ' ') : 'NO ACTION';
}

/** A renamed table keeps its indexes and its RLS setting. */
function resolve(table) {
  let t = table;
  const seen = new Set();
  while (renamedTo.has(t) && !seen.has(t)) { seen.add(t); t = renamedTo.get(t); }
  return t;
}

/* ── 1. RLS ───────────────────────────────────────────────────────────────── */

describe('row level security', () => {
  it('every table the chain creates has RLS enabled', () => {
    const missing = [...createdTables.keys()]
      .filter((t) => !rlsEnabled.has(t) && !rlsEnabled.has(resolve(t)))
      .sort();

    assert.deepEqual(missing, [], (
      'These tables are created by the migration chain and never have RLS turned on. '
      + "Supabase's default privileges grant anon and authenticated ALL on new tables in "
      + '`public`, and the anon key ships in the browser bundle — so with RLS off these are '
      + 'readable AND writable by any visitor:\n'
      + missing.map((t) => `  ${t}  (created in ${createdTables.get(t)})`).join('\n')
      + '\nAdd `ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;` in the same migration. '
      + 'With no policy that denies everyone; the service-role backend bypasses RLS.'
    ));
  });
});

/* ── 2. Foreign-key index coverage ────────────────────────────────────────── */

/**
 * Deliberate exceptions, each with the reason it is safe to leave uncovered.
 * A cascade scan is only cheap while the child table is small AND the parent
 * delete is rare — if either stops being true, delete the line and add the index.
 */
const FK_INDEX_EXCEPTIONS = new Map(Object.entries({
  'admin_user_roles.role_id': 'roles has a handful of rows and is never deleted',
  'role_permissions.permission_id': 'permissions is a fixed seed list; rows are not deleted',
  'subscriptions.plan_id': 'plans is the pricing ladder — six rows, SET NULL, never deleted',
  'check_ins.rsvp_id': 'legacy column from the pre-party model; `rsvps` is retired and no longer written',
  'seating_assignments.rsvp_id': 'legacy column from the pre-party model; `rsvps` is retired and no longer written',
  'check_ins.checked_in_by': 'FK to auth.users was dropped in 20260728000000_drop_checkin_actor_fk.sql',
  'security_events.user_id': 'FK to auth.users was dropped in 20260808000000_drop_auth_users_actor_fks.sql',
  'promo_codes.created_by': 'FK to auth.users was dropped in 20260808000000_drop_auth_users_actor_fks.sql',
  'promo_code_redemptions.redeemed_by': 'FK to auth.users was dropped in 20260808000000_drop_auth_users_actor_fks.sql',
  'event_device_pairing_codes.gate_table_id': 'pairing codes are consumed within 10 minutes; the table stays tiny',
  'event_device_pairing_codes.consumed_device_id': 'same table — tiny and short-lived',
  'event_check_in_conflicts.winning_check_in_id': 'conflicts are rare; the table is orders of magnitude smaller than check_ins',
  'referral_credit_holds.org_id': 'one row per pending referral redemption; the table stays small',
  'referral_credit_holds.event_id': 'same table — small',
  'referral_credit_ledger.referred_org_id': 'one row per referral event; small, and organizations are not deleted in bulk',
  'referral_credit_ledger.event_id': 'same table — small',
  'referral_credit_ledger.payment_id': 'same table — small',
  'rsvp_form_fields.event_id': 'renamed to custom_form_fields in 20260705000000; covered by idx_custom_form_fields_event',
  'sms_credit_ledger.wallet_id': 'wallets are 1:1 with events and are never deleted independently of the event',
  'event_devices.gate_table_id': 'a handful of devices per event; SET NULL on a table delete, which is an organizer edit',
}));

describe('foreign key index coverage', () => {
  it('every foreign key column has a full index with it as the leading column', () => {
    const seen = new Set();
    const uncovered = [];

    for (const fk of fks) {
      const table = resolve(fk.table);
      const key = `${fk.table}.${fk.col}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (FK_INDEX_EXCEPTIONS.has(key)) continue;

      const leading = indexLeading.get(table) || indexLeading.get(fk.table) || new Set();
      if (!leading.has(fk.col)) uncovered.push(`  ${key} -> ${fk.parent}  ON DELETE ${fk.action}  [${fk.file}]`);
    }

    assert.deepEqual(uncovered, [], (
      'These foreign key columns have no full index with the FK column first, so PostgreSQL '
      + 'sequentially scans the child table once per deleted parent row:\n'
      + uncovered.join('\n')
      + '\nAdd `CREATE INDEX ... ON <child>(<fk col>)`, or add the column to '
      + 'FK_INDEX_EXCEPTIONS in this file with the reason it is genuinely safe. '
      + 'A PARTIAL index does not count unless its predicate is implied by `col = $1`.'
    ));
  });
});

/* ── 3. The anon surface stays closed ─────────────────────────────────────── */

describe('anon surface', () => {
  const later = files.filter((f) => f.split('_')[0] > LOCKDOWN_VERSION);

  it('no migration after the lockdown creates a policy granting to PUBLIC or anon', () => {
    const offenders = [];
    for (const file of later) {
      const src = read(file);
      const re = /CREATE\s+POLICY\s+("?[A-Za-z0-9_ ]+"?)\s+ON\s+([A-Za-z0-9_."]+)([\s\S]{0,300}?);/gi;
      let m;
      while ((m = re.exec(src)) !== null) {
        const body = m[3].replace(/\s+/g, ' ');
        const to = /\bTO\s+([A-Za-z0-9_,\s]+?)(?:\s+USING|\s+WITH|$)/i.exec(body);
        // No TO clause at all means TO PUBLIC.
        if (!to || /\b(public|anon)\b/i.test(to[1])) {
          offenders.push(`  ${file}: policy ${m[1].trim()} on ${m[2]} TO ${to ? to[1].trim() : 'PUBLIC (implicit)'}`);
        }
      }
    }

    assert.deepEqual(offenders, [], (
      'A policy granting to PUBLIC or anon re-opens the table to anyone holding the anon key, '
      + 'which ships in the browser bundle. This has already happened twice — 20260822000000 '
      + 're-added public read on `events` and `short_links` after 20260615400000 removed it:\n'
      + offenders.join('\n')
      + '\nNothing in frontend/src reads a table with the anon client (Storage only), so a '
      + 'public policy grants access no code path needs.'
    ));
  });

  /**
   * Strip `--` line comments before scanning.
   *
   * Without this the scanner reads the PROSE. Every migration here explains
   * itself at length, and any file that describes the mistake — "`REVOKE ...
   * FROM anon` on its own does nothing" — was reported as committing it. The
   * first version of 20260911000000 failed this test on a comment warning
   * against the very pattern the test enforces.
   *
   * `[^\n\r]` rather than `.`: these files are CRLF, and a JS regex `.` does not
   * match `\r`, so `--.*$` silently strips nothing and leaves every comment in
   * place. That exact bug once made whole tables vanish from
   * backend/scripts/audit-schema.js's parse.
   *
   * Block comments and `--` inside string literals are left alone: neither
   * appears in this chain, and a half-correct SQL tokeniser in a test is a
   * bigger liability than the case it covers.
   */
  const stripComments = (sql) => sql.replace(/--[^\n\r]*/g, '');

  it('no migration after the lockdown relies on REVOKE ... FROM anon alone', () => {
    const offenders = [];
    for (const file of later) {
      const src = stripComments(read(file));
      /**
       * Bounded by `;` on both spans so a match cannot run out of one statement
       * and into the next. It used to be able to: a revoke written as
       *
       *     EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s', v_sig, v_targets);
       *
       * has a target of `%s`, which does not match the role-name class, so the
       * engine kept extending the search and bound `FROM` to the next unrelated
       * statement — reporting `REVOKE ... FROM pg_roles WHERE rolname`. A
       * nonsense finding that nevertheless fails the build.
       */
      const re = /REVOKE\s+[^;]{0,40}?\s+ON\s+FUNCTION\s+([^;]{0,240}?)\s+FROM\s+([A-Za-z0-9_,%\s]+)/gi;
      let m;
      while ((m = re.exec(src)) !== null) {
        const target = m[2].trim();

        /**
         * A composed target — `FROM %s` inside format() — cannot be judged by
         * reading this line, because the role list is built at runtime from
         * pg_roles (the platform roles do not exist on a bare Postgres, and
         * naming them unconditionally fails the migration).
         *
         * The check moves to where the answer actually is: the variable must be
         * SEEDED with PUBLIC, so PUBLIC is in the list however the guards fall.
         * `:= 'PUBLIC'` is the whole convention, and it is enforced rather than
         * assumed — a file that builds a target list starting from anything else
         * is reported exactly like a literal revoke that omits PUBLIC.
         */
        if (/%[sIL]/.test(target)) {
          if (!/:=\s*'PUBLIC'/i.test(src)) {
            offenders.push(`  ${file}: dynamic REVOKE whose target list is not seeded with PUBLIC`);
          }
          continue;
        }

        if (!/\bPUBLIC\b/i.test(target)) {
          offenders.push(`  ${file}: REVOKE ... FROM ${target} — PUBLIC not included`);
        }
      }
    }

    assert.deepEqual(offenders, [], (
      'PostgreSQL grants EXECUTE on a new function to PUBLIC, and a privilege held via PUBLIC '
      + 'survives `REVOKE ... FROM anon`. A revoke that does not name PUBLIC leaves the '
      + 'function callable by anyone with the anon key:\n'
      + offenders.join('\n')
      + '\nWrite `REVOKE ALL ON FUNCTION <sig> FROM PUBLIC, anon, authenticated;` followed by '
      + '`GRANT EXECUTE ON FUNCTION <sig> TO service_role;`.'
    ));
  });
});
