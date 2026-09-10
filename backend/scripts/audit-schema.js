/**
 * ─────────────────────────────────────────────────────────────────────────────
 * DOES THE MIGRATION CHAIN ACTUALLY BUILD THE DATABASE THE CODE EXPECTS?
 *
 * A static audit. It reads no database — it compares two things that both live
 * in this repository and are supposed to agree:
 *
 *   what `supabase/migrations/*.sql` CREATES   (tables, columns, functions)
 *   what the backend REFERENCES               (.from('t').select('a, b'), .rpc('f'))
 *
 * WHY THIS IS WORTH A SCRIPT RATHER THAN A GREP
 *
 * PostgREST fails the WHOLE query when one listed column is unknown — it does
 * not return the other columns, it returns an error. So a single column that
 * exists in code but in no migration does not degrade a feature; it takes down
 * every request that runs that select. Login, the guest page and the analytics
 * dashboard have each been broken this way.
 *
 * That makes "which selected columns have no migration" the single highest-value
 * question that can be answered without a database, and it is not greppable:
 * you have to parse the select lists, expand embedded resources, and diff them
 * against 100+ migration files that add columns in `ALTER TABLE`, in `DO $$`
 * blocks, and inside `CREATE TABLE` bodies.
 *
 * WHAT A FINDING MEANS
 *
 * Not necessarily a bug. The chain is not the only thing that has ever built
 * this database — `backend/migrations/` holds files that were applied by hand
 * and never folded in, and a long-lived environment may carry columns from
 * them. That is precisely the risk: those environments work, and a fresh
 * `supabase db reset` produces a database the code cannot run against. A
 * finding here means "this would break on a clean rebuild", which is the state
 * a new environment, a restored backup, and a local dev database all start in.
 *
 * Usage: node scripts/audit-schema.js [--verbose]
 * ─────────────────────────────────────────────────────────────────────────────
 */
const fs = require('fs');
const path = require('path');

/*
 * Runs only when invoked directly.
 *
 * This file is top-level script code that ends in `process.exit(0)`, so
 * REQUIRING it used to run the whole audit and then kill the requiring process.
 * Any tool that walks and imports the tree — a coverage run, a dependency
 * graph, a module-load smoke check — died on it silently, with nothing naming
 * the file responsible.
 *
 * A bare `return` is legal at the top level of a CommonJS module (Node wraps
 * every module in a function), which makes this the whole fix.
 */
if (require.main !== module) return;

const VERBOSE = process.argv.includes('--verbose');
const ROOT = path.join(__dirname, '..', '..');
const TRACKED = path.join(ROOT, 'supabase', 'migrations');
const UNTRACKED = path.join(ROOT, 'backend', 'migrations');
const CODE_DIRS = ['controllers', 'services', 'utils', 'middleware'].map((d) => path.join(ROOT, 'backend', d));

/* ── Reading SQL ─────────────────────────────────────────────────────────── */

/**
 * Strips line comments before parsing.
 *
 * Not cosmetic: these migrations carry long explanatory headers, and several
 * of them quote real DDL inside a comment while explaining why it was NOT
 * done. Parsing those would report columns as existing that nothing creates —
 * the exact false negative this audit cannot afford.
 */
const stripComments = (sql) => sql
  // CRLF is normalised FIRST, and that is load-bearing rather than tidy.
  //
  // These files are CRLF, and in a JavaScript regex `.` does not match \r —
  // it is a line terminator, like \n. So `/--.*$/` on the line
  //     owner_user_id UUID NOT NULL,   -- Links to auth.users
  // matches `--` then runs `.*` up to the \r, and then `$` (with no `m` flag)
  // demands the very end of the string, which is AFTER the \r. The match
  // fails, and the comment survives.
  //
  // The comment surviving is not cosmetic: the column-splitter then treats
  // `-- Links to auth.users\n    name TEXT NOT NULL` as ONE item beginning
  // with `--`, discards it, and `name` disappears from the parsed table. That
  // silently under-reported the schema and produced confident findings that
  // `organizations.name` and `organizations.password_hash` had no migration.
  .replace(/\r\n?/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  // `[^\n]*` rather than `.*$` — says what it means and cannot be re-broken
  // by a stray carriage return.
  .replace(/--[^\n]*/g, '');

function collectSchema(dir) {
  const tables = new Map(); // name -> Set(columns)
  const functions = new Set();
  if (!fs.existsSync(dir)) return { tables, functions };

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = stripComments(fs.readFileSync(path.join(dir, file), 'utf8'));

    // CREATE TABLE [IF NOT EXISTS] name ( ...body... )
    // Body is matched to the matching close paren by counting depth, because a
    // column can carry its own parens (NUMERIC(10,2), CHECK (x IN ('a','b'))).
    const createRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["']?([a-z_0-9]+)["']?\s*\(/gi;
    let m;
    while ((m = createRe.exec(sql)) !== null) {
      const name = m[1].toLowerCase();
      let depth = 1;
      let i = createRe.lastIndex;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '(') depth++;
        else if (sql[i] === ')') depth--;
        i++;
      }
      const body = sql.slice(createRe.lastIndex, i - 1);
      const cols = tables.get(name) || new Set();

      // Split on top-level commas only.
      let d = 0, cur = '';
      const parts = [];
      for (const ch of body) {
        if (ch === '(') d++;
        else if (ch === ')') d--;
        if (ch === ',' && d === 0) { parts.push(cur); cur = ''; } else cur += ch;
      }
      parts.push(cur);

      for (const part of parts) {
        const t = part.trim();
        if (!t) continue;
        // Skip table-level constraints — they are not columns.
        if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|EXCLUDE|LIKE)\b/i.test(t)) continue;
        const cm = t.match(/^["']?([a-z_0-9]+)["']?\s/i);
        if (cm) cols.add(cm[1].toLowerCase());
      }
      tables.set(name, cols);
    }

    // ALTER TABLE t ADD COLUMN [IF NOT EXISTS] c  — including the multi-column
    // comma form, which several migrations use.
    const alterRe = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?["']?([a-z_0-9]+)["']?([\s\S]*?);/gi;
    while ((m = alterRe.exec(sql)) !== null) {
      const name = m[1].toLowerCase();
      const cols = tables.get(name) || new Set();
      const addRe = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?([a-z_0-9]+)["']?/gi;
      let a;
      while ((a = addRe.exec(m[2])) !== null) cols.add(a[1].toLowerCase());
      const renameRe = /RENAME\s+COLUMN\s+["']?([a-z_0-9]+)["']?\s+TO\s+["']?([a-z_0-9]+)["']?/gi;
      while ((a = renameRe.exec(m[2])) !== null) cols.add(a[2].toLowerCase());
      if (cols.size) tables.set(name, cols);
    }

    // ALTER TABLE old RENAME TO new — the table keeps its columns under a new
    // name. Missing this reported `custom_form_fields` as never created, when
    // in fact it is `rsvp_form_fields` (created in 20260607100000) renamed by
    // the guest rebuild. A rename is invisible to a CREATE-only parser, and
    // the resulting finding is confident and wrong.
    const renameTableRe = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?["']?([a-z_0-9]+)["']?\s+RENAME\s+TO\s+["']?([a-z_0-9]+)["']?/gi;
    while ((m = renameTableRe.exec(sql)) !== null) {
      const from = m[1].toLowerCase();
      const to = m[2].toLowerCase();
      const cols = tables.get(from);
      if (cols) {
        // Merge rather than overwrite: a later migration may already have
        // added columns under the new name.
        const target = tables.get(to) || new Set();
        for (const c of cols) target.add(c);
        tables.set(to, target);
        tables.delete(from);
      }
    }

    const fnRe = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?["']?([a-z_0-9]+)["']?/gi;
    while ((m = fnRe.exec(sql)) !== null) functions.add(m[1].toLowerCase());

    const viewRe = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["']?([a-z_0-9]+)["']?/gi;
    while ((m = viewRe.exec(sql)) !== null) if (!tables.has(m[1].toLowerCase())) tables.set(m[1].toLowerCase(), new Set(['*']));
  }
  return { tables, functions };
}

/* ── Reading the backend ─────────────────────────────────────────────────── */

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/**
 * Splits a PostgREST select list on TOP-LEVEL commas, respecting nesting.
 *
 * `admin_user_roles(roles(key, role_permissions(permissions(key))))` is one
 * item, not four. A naive `.split(',')` shreds it into fragments like
 * `roles(key` and `))))`, and every fragment then reports as a missing column.
 */
function splitTopLevel(list) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/**
 * Walks a select list, attributing each column to the table it is selected
 * FROM — descending into embedded resources, which resolve against their own
 * table. An unknown column inside an embed fails the parent query just the
 * same, so embeds are audited, not skipped.
 */
function parseSelect(list, table, note, where) {
  for (const rawItem of splitTopLevel(list)) {
    const item = rawItem.trim();
    if (!item || item === '*') continue;

    // An embedded resource: name[!hint][:alias](inner-list)
    const embed = item.match(/^([a-z_0-9]+)\s*(?:![a-z]+)?\s*\(([\s\S]*)\)$/i);
    if (embed) { parseSelect(embed[2], embed[1].toLowerCase(), note, where); continue; }

    // An aliased embed written as `alias:table(cols)`.
    const aliased = item.match(/^[a-z_0-9]+\s*:\s*([a-z_0-9]+)\s*(?:![a-z]+)?\s*\(([\s\S]*)\)$/i);
    if (aliased) { parseSelect(aliased[2], aliased[1].toLowerCase(), note, where); continue; }

    // A plain column, possibly `alias:column` or `column::cast`.
    const col = item.toLowerCase().replace(/^[a-z_0-9]+\s*:\s*/, '').split(/\s|::/)[0];
    if (!col || col === '*' || col === 'count') continue;
    if (!/^[a-z_][a-z_0-9]*$/.test(col)) continue; // not an identifier — skip rather than guess
    note(table, col, where);
  }
}

/**
 * Pulls `.from('table').select('a, b, embedded(c, d)')` pairs out of source.
 *
 * TWO RULES THAT KEEP THIS HONEST, both learned by getting them wrong first:
 *
 *  1. The select must belong to the SAME chain. The first version scanned a
 *     fixed window ahead of `.from()` and happily grabbed a select belonging to
 *     a completely different query further down the file, then reported that
 *     query's columns as missing from this table. So the scan now stops at the
 *     next `.from(` — if a select does not appear before it, this call simply
 *     has no statically-known select list.
 *
 *  2. A select built from a template literal (`${cols}`) is not resolvable
 *     here and is skipped entirely rather than parsed. tierResolver builds its
 *     column list at runtime; pretending to read it produced findings named
 *     `events.${basecolumns}`, which is noise that teaches a reader to ignore
 *     the report.
 */
function collectUsage(files) {
  const used = new Map();  // table -> Map(column -> Set(file:line))
  const rpcs = new Map();  // fn -> Set(file:line)
  let skippedDynamic = 0;

  const note = (table, column, where) => {
    if (!used.has(table)) used.set(table, new Map());
    const cols = used.get(table);
    if (!cols.has(column)) cols.set(column, new Set());
    cols.get(column).add(where);
  };

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const lineOf = (idx) => src.slice(0, idx).split('\n').length;

    const fromRe = /\.from\(\s*['"`]([a-z_0-9]+)['"`]\s*\)/gi;
    let m;
    while ((m = fromRe.exec(src)) !== null) {
      const table = m[1].toLowerCase();
      const where = `${rel}:${lineOf(m.index)}`;

      // Rule 1: stop at the next .from( so a neighbouring query's select can
      // never be attributed to this one.
      const rest = src.slice(m.index + m[0].length);
      const nextFrom = rest.search(/\.from\(\s*['"`]/);
      const chain = nextFrom === -1 ? rest : rest.slice(0, nextFrom);

      const sel = chain.match(/^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*\.select\(\s*(['"`])([\s\S]*?)\1/);
      if (!sel) { note(table, '*', where); continue; }

      // Rule 2: a runtime-built list is unknowable statically.
      if (sel[2].includes('${')) { skippedDynamic++; note(table, '*', where); continue; }

      parseSelect(sel[2], table, note, where);
    }

    const rpcRe = /\.rpc\(\s*['"`]([a-z_0-9]+)['"`]/gi;
    while ((m = rpcRe.exec(src)) !== null) {
      const fn = m[1].toLowerCase();
      if (!rpcs.has(fn)) rpcs.set(fn, new Set());
      rpcs.get(fn).add(`${rel}:${lineOf(m.index)}`);
    }
  }
  return { used, rpcs, skippedDynamic };
}

/* ── Report ──────────────────────────────────────────────────────────────── */

const tracked = collectSchema(TRACKED);
const untracked = collectSchema(UNTRACKED);
const { used, rpcs, skippedDynamic } = collectUsage(CODE_DIRS.flatMap((d) => walk(d)));

const inUntrackedOnly = [];
const missingEverywhere = [];
const missingTables = [];

for (const [table, cols] of [...used.entries()].sort()) {
  const t = tracked.tables.get(table);
  const u = untracked.tables.get(table);

  if (!t) {
    (u ? inUntrackedOnly : missingTables).push({
      table, kind: 'TABLE', where: [...(cols.get('*') || cols.values().next().value || [])][0],
    });
    continue;
  }
  if (t.has('*')) continue; // a view — columns not parsed

  for (const [col, where] of cols) {
    if (col === '*') continue;
    if (t.has(col)) continue;
    const entry = { table, col, where: [...where] };
    if (u && u.has(col)) inUntrackedOnly.push(entry);
    else missingEverywhere.push(entry);
  }
}

const missingRpcs = [...rpcs.entries()]
  .filter(([fn]) => !tracked.functions.has(fn))
  .map(([fn, where]) => ({ fn, where: [...where], inUntracked: untracked.functions.has(fn) }));

const line = '─'.repeat(78);
console.log(`\n${line}\nSCHEMA AUDIT — code vs. supabase/migrations\n${line}`);
console.log(`${tracked.tables.size} tables and ${tracked.functions.size} functions built by the tracked chain.`);
console.log(`${untracked.tables.size} tables and ${untracked.functions.size} functions in backend/migrations (NOT in the chain).\n`);

const section = (title, items, render) => {
  console.log(`\n${title}  (${items.length})`);
  console.log(line);
  if (!items.length) { console.log('  none'); return; }
  for (const i of items) console.log(render(i));
};

section(
  '❌ MISSING TABLES — referenced by code, created by no migration anywhere',
  missingTables,
  (i) => `  ${i.table.padEnd(30)} ${i.where || ''}`,
);

section(
  '⚠  ONLY IN backend/migrations — a fresh `supabase db reset` will NOT have these',
  inUntrackedOnly,
  (i) => `  ${(i.table + (i.col ? '.' + i.col : ' (whole table)')).padEnd(44)} ${(i.where || []).slice(0, 2).join('  ')}`,
);

section(
  '❌ MISSING COLUMNS — selected by code, added by no migration anywhere',
  missingEverywhere,
  (i) => `  ${(i.table + '.' + i.col).padEnd(44)} ${i.where.slice(0, VERBOSE ? 99 : 2).join('  ')}`,
);

section(
  '❌ MISSING FUNCTIONS — .rpc() targets with no CREATE FUNCTION in the chain',
  missingRpcs,
  (i) => `  ${i.fn.padEnd(38)}${i.inUntracked ? '[in backend/migrations] ' : ''}${i.where.slice(0, 2).join('  ')}`,
);

const total = missingTables.length + inUntrackedOnly.length + missingEverywhere.length + missingRpcs.length;
console.log(`\n${line}\n${total} finding(s).`);
console.log('A finding means the code would break on a database built only from supabase/migrations —');
console.log('which is what a fresh environment, a restored backup, and every local dev database is.\n');
process.exit(0);
