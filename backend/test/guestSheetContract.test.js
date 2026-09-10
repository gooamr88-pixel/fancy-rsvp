require('./helpers/env');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * CROSS-LAYER CONTRACT — the guest spreadsheet.
 *
 * Four things have to agree about what a column is called:
 *
 *   1. `backend/config/guestImportColumns.js` — the canonical keys and aliases;
 *   2. `controllers/rsvpController.importGuestsCSV` — which of them it reads;
 *   3. `controllers/rsvpController.exportGuestsCSV` — the round-trip header row;
 *   4. `frontend/src/app/utils/guestSheetColumns.js` — what the organizer is
 *      TOLD, and the template they download.
 *
 * They disagreed in every direction before this file existed. `sms_consent` was
 * accepted under three spellings client-side and one server-side. The .xlsx
 * branch read `note`; the CSV branch did not. The import modal documented nine
 * columns; the importer read eleven. And a column named in the documentation but
 * absent from the reader does not fail — it imports blank, which is the failure
 * mode nobody catches because there is nothing to catch.
 *
 * The frontend is regex-scraped rather than imported: a CommonJS test cannot
 * `require` an ESM module out of the Next tree, and the alternative — restating
 * the column list here — is the very drift being guarded against.
 */

const REPO = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

const {
  GUEST_IMPORT_COLUMNS, RECOGNISED_HEADERS, normalizeHeader, unknownColumns,
} = require('../config/guestImportColumns');

/** `key: 'guest_name', aliases: ['name', 'guest']` out of the frontend spec. */
function scrapeFrontendColumns() {
  const src = read('frontend/src/app/utils/guestSheetColumns.js');
  const block = src.match(/export const GUEST_SHEET_COLUMNS = \[([\s\S]*?)\n\];/);
  assert.ok(block, 'GUEST_SHEET_COLUMNS array not found — did the export get renamed?');

  const out = [];
  for (const [, key, rawAliases] of block[1].matchAll(
    /key:\s*'([\w]+)',\s*\n?\s*aliases:\s*\[([^\]]*)\]/g,
  )) {
    out.push({
      key,
      aliases: [...rawAliases.matchAll(/'([^']+)'/g)].map((m) => m[1]),
    });
  }
  assert.ok(out.length >= 8, `scrape found only ${out.length} columns — the regex has drifted from the file`);
  return out;
}

/** The `IGNORED_COLUMNS` list the organizer is shown. */
function scrapeFrontendIgnored() {
  const src = read('frontend/src/app/utils/guestSheetColumns.js');
  const m = src.match(/export const IGNORED_COLUMNS = \[([^\]]*)\]/);
  assert.ok(m, 'IGNORED_COLUMNS not found');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const backendImported = GUEST_IMPORT_COLUMNS.filter((c) => c.imported !== false);
const backendIgnored = GUEST_IMPORT_COLUMNS.filter((c) => c.imported === false);

/**
 * The CSV export's header row.
 *
 * Anchored INSIDE exportGuestsCSV rather than matched against the whole file.
 * `const headers = [` appears twice in that controller — the .xlsx import branch
 * declares an empty one first — and a whole-file regex silently picked up the
 * empty one, which turned the round-trip check below into a loop over nothing
 * that could never fail. A false pass on the contract test guarding the round
 * trip is worse than no test at all.
 */
function exportedHeaders() {
  const src = read('backend/controllers/rsvpController.js');
  const fn = src.slice(src.indexOf('const exportGuestsCSV'));
  const m = fn.match(/const headers = \[([^\]]*)\];/);
  assert.ok(m, 'exportGuestsCSV header array not found');
  const list = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.ok(list.length >= 10, `found only ${list.length} export headers — the anchor has drifted`);
  return list;
}

/* ── The documented set IS the accepted set ─────────────────────────────── */

test('every column the organizer is shown is one the importer reads', () => {
  const documented = scrapeFrontendColumns().map((c) => c.key).sort();
  const accepted = backendImported.map((c) => c.key).sort();
  assert.deepEqual(documented, accepted,
    'the guest sheet reference and the importer disagree about which columns exist');
});

test('every alternative spelling shown is one the importer answers to', () => {
  // The direction that matters most. An alias printed in the reference that the
  // importer does not accept is a column the organizer will name confidently and
  // lose entirely, with a green "Import Complete" on top.
  for (const col of scrapeFrontendColumns()) {
    for (const alias of col.aliases) {
      assert.ok(RECOGNISED_HEADERS.has(alias),
        `the reference offers "${alias}" for ${col.key}, but the importer does not accept it`);
    }
  }
});

test('no accepted alias is hidden from the organizer', () => {
  // The reverse direction is a smaller harm — a working spelling nobody knows
  // about — but it is still a promise the backend keeps and the UI does not.
  const shown = new Map(scrapeFrontendColumns().map((c) => [c.key, new Set(c.aliases)]));
  for (const col of backendImported) {
    for (const alias of col.aliases) {
      assert.ok(shown.get(col.key)?.has(alias),
        `the importer accepts "${alias}" for ${col.key}, but the reference never mentions it`);
    }
  }
});

test('the never-imported columns are the same list on both sides', () => {
  assert.deepEqual(
    scrapeFrontendIgnored().sort(),
    backendIgnored.map((c) => c.key).sort(),
  );
});

/* ── The round trip ─────────────────────────────────────────────────────── */

test("every column the CSV export writes can be read back", () => {
  // The export header array is the round-trip contract. A column written and not
  // recognised means downloading a list and re-uploading it loses that field —
  // which has happened, repeatedly, to response/side/table/meals.
  for (const h of exportedHeaders()) {
    assert.ok(RECOGNISED_HEADERS.has(h),
      `the export writes "${h}" but no importer column recognises it — that field is lost on re-import`);
  }
});

/* ── Header folding ─────────────────────────────────────────────────────── */

test('headers are matched case- and space-insensitively', () => {
  // The bug: `parseCSV` keyed rows by the RAW header, so "Guest Name" matched
  // nothing and every row imported as "Unnamed Guest" — silently, under a green
  // success panel — while the same file worked as .xlsx.
  assert.equal(normalizeHeader('Guest Name'), 'guest_name');
  assert.equal(normalizeHeader('  PHONE  '), 'phone');
  assert.equal(normalizeHeader('Party  Size'), 'party_size');
});

test('the UTF-8 BOM Excel writes onto the first header is stripped', () => {
  assert.equal(normalizeHeader('﻿guest_name'), 'guest_name');
});

test('a quoted header is unquoted', () => {
  assert.equal(normalizeHeader('"guest_name"'), 'guest_name');
});

test('parseCSV folds its headers, so a human-typed file imports', () => {
  const { parseCSV } = require('../utils/csvHelper');
  const rows = parseCSV('Guest Name,Email,PHONE, Party Size\nSara,s@e.com,+15551234567,2');

  assert.deepEqual(rows[0], {
    guest_name: 'Sara', email: 's@e.com', phone: '+15551234567', party_size: '2',
  });
});

test('parseCSV keeps the raw header row, without it looking like a guest', () => {
  const { parseCSV } = require('../utils/csvHelper');
  const rows = parseCSV('Guest Name,Email\nSara,s@e.com');

  assert.deepEqual(rows.headers, ['Guest Name', 'Email']);
  // Non-enumerable on purpose: every caller iterates these rows, and an array
  // of header strings in that list would be imported as a guest.
  assert.equal(rows.length, 1);
  assert.equal(JSON.parse(JSON.stringify(rows)).length, 1);
});

/* ── Unrecognised columns are named, not swallowed ──────────────────────── */

test('an unknown column is reported by its folded name', () => {
  assert.deepEqual(unknownColumns(['Guest Name', 'Mobile', 'Gift Received']), ['mobile', 'gift_received']);
});

test('blank headers from a trailing comma are not reported', () => {
  assert.deepEqual(unknownColumns(['guest_name', '', '   ']), []);
});

test('the columns our own export writes are never reported as unknown', () => {
  // Otherwise every re-imported export would accuse the organizer of four
  // mystery columns this platform put there itself.
  assert.deepEqual(unknownColumns(exportedHeaders()), []);
});

/* ── The .xlsx import branch reads the .xlsx export's own headers ────────── */

/**
 * The object literal the Excel importer builds per row.
 *
 * Anchored the same way `exportedHeaders` is, and for the same reason: this
 * controller is long, the same key names appear in several places, and a
 * whole-file match would pass against the wrong one.
 */
function xlsxRowMapping() {
  const src = read('backend/controllers/rsvpController.js');
  const at = src.indexOf('const mappedRow = {');
  assert.notEqual(at, -1, 'the .xlsx per-row mapping was not found — this test has drifted');
  const rest = src.slice(at);
  const end = rest.indexOf('\n          };');
  assert.notEqual(end, -1, 'could not find the end of the .xlsx per-row mapping');
  return rest.slice(0, end);
}

test('the .xlsx importer maps each column exactly once', () => {
  /* THE BUG THIS EXISTS FOR.
   *
   * `table_name` and `meal_selections` were each declared TWICE in this object
   * literal. Duplicate keys are legal JavaScript and the last wins, so the
   * first pair — the one carrying the .xlsx export's own header names — was
   * silently dead. Nothing errored; the round-trip tests all passed, because
   * they only ever exercised the CSV branch.
   *
   * Checked for every mapped column, not just the two that broke: the failure
   * is invisible by construction, so the guard has to be about the shape rather
   * than about the specific keys that happened to be wrong once. */
  const body = xlsxRowMapping();
  const keys = [...body.matchAll(/^\s{12}([a-z_]+):/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 8, `found only ${keys.length} mapped keys — the anchor has drifted`);

  const seen = new Set();
  const duplicated = keys.filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
  assert.deepEqual(duplicated, [],
    `duplicate keys in the .xlsx row mapping silently discard the earlier definition: ${duplicated.join(', ')}`);
});

test('the .xlsx importer answers to the headers the .xlsx export writes', () => {
  /* The round trip that matters most in practice: an organizer downloads the
     Excel guest list, edits it, and uploads it again. Its headers fold to
     `assigned_table` and `primary_meal_selection`, which are NOT the canonical
     names — so the importer has to accept them explicitly, and did not. */
  const body = xlsxRowMapping();
  for (const alias of ['assigned_table', 'primary_meal_selection']) {
    // A plain substring test, deliberately: building this as a RegExp needs
    // `\\.` and `\\b`, and getting either escape wrong yields a pattern that
    // silently never matches — which is the same shape of invisible failure
    // this whole test exists to catch.
    assert.ok(body.includes(`rowObj.${alias}`),
      `the .xlsx importer must read '${alias}' — it is a header our own Excel export writes`);
  }
});
