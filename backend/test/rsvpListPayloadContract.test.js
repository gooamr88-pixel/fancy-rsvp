require('./helpers/env');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE get_event_parties PAYLOAD CONTRACT
 *
 * 20260911000000 stopped `get_event_parties` splatting all 23 columns of
 * rsvp_parties with `to_jsonb(p)` and gave it an explicit ten-key list instead.
 * That is an egress fix — the RPC is the heaviest application statement on the
 * database (277,464 ms / 14,476 calls) and the dashboard polls it every 20
 * seconds per open tab, walking every page — but it converts a whole class of
 * mistake from "impossible" into "silent".
 *
 * With `to_jsonb`, adding a column to rsvp_parties and reading it in the
 * dashboard Just Worked. With an explicit list, that same change ships a field
 * that is `undefined` in the browser: no error, no failed request, just an empty
 * cell that looks like missing data rather than a bug. Nobody would think to
 * check a SQL file.
 *
 * So this test reads BOTH SIDES and compares them. It needs no database, which
 * is the point — it runs in the ordinary suite, on every change, and fails at
 * the moment the two drift rather than whenever somebody next looks at that
 * column in production.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const REPO = path.join(__dirname, '..', '..');
const MIGRATION = path.join(
  REPO, 'supabase', 'migrations', '20260911000000_advisor_findings_and_payload_trim.sql',
);
const DASHBOARD = path.join(REPO, 'frontend', 'src', 'app', 'dashboard', 'page.js');

/**
 * Keys the RPC promises. Kept here as well as in the SQL deliberately: if this
 * list and the migration disagree, one of the two was edited without thinking
 * about the other, and that is exactly the failure worth catching.
 */
const EXPECTED_PARTY_KEYS = [
  'id',
  'label',
  'response',
  'notes',
  'side',
  'created_at',
  'companion_meal_counts',
  'sms_consent',
  'sms_consent_at',
  'sms_consent_method',
];

/** The four embedded collections, added by the second jsonb_build_object. */
const NESTED_KEYS = ['guests', 'custom_answers', 'seating_assignments', 'invitations'];

/**
 * Read the first jsonb_build_object in the party_json expression — the scalar
 * column list. Anchored on the comment the migration puts directly above it so a
 * reformat of the SQL does not quietly make this test read the wrong object.
 */
function partyKeysFromMigration() {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const anchor = sql.indexOf('-- Explicit, not to_jsonb(p).');
  assert.notEqual(anchor, -1, 'anchor comment missing from the migration — did the RPC get rewritten?');

  const open = sql.indexOf('jsonb_build_object(', anchor);
  assert.notEqual(open, -1, 'no jsonb_build_object after the anchor');

  // Walk to the matching paren so a nested call cannot truncate the slice.
  let depth = 0;
  let end = -1;
  for (let i = sql.indexOf('(', open); i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  assert.notEqual(end, -1, 'unbalanced parentheses in the party_json object');

  const body = sql.slice(open, end);
  return [...body.matchAll(/'([a-z_][a-z0-9_]*)'\s*,/g)].map((m) => m[1]);
}

/**
 * Every `r.<field>` the dashboard reads off a party row. Scoped to the mapping
 * block rather than the whole file, because `r` is a short and popular name.
 */
function partyFieldsReadByDashboard() {
  const js = fs.readFileSync(DASHBOARD, 'utf8');
  const start = js.indexOf('(rsvpsData.data?.rsvps || []).map(');
  assert.notEqual(start, -1, 'the rsvps mapping block moved — this test needs re-anchoring');

  // The map callback ends where the surrounding statement does; a generous
  // window is safer than brace-matching through JSX-adjacent code.
  const block = js.slice(start, start + 4000);
  const found = [...new Set([...block.matchAll(/\br\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1]))];

  /**
   * The guard that stops this whole test going quietly vacuous.
   *
   * If the mapping is refactored — renamed callback parameter, destructuring,
   * moved to its own module — this regex finds nothing, `missing` is empty, and
   * the assertion below passes while checking absolutely nothing. A test that
   * cannot fail is worse than no test, because it is also a claim.
   *
   * Fifteen is what it finds today; ten is a floor loose enough to survive an
   * ordinary edit and tight enough to catch the scan breaking.
   */
  assert.ok(
    found.length >= 10,
    `only found ${found.length} party fields in the dashboard mapping — the scan is broken, not the code`,
  );
  return found;
}

test('the migration returns exactly the ten agreed party columns', () => {
  const keys = partyKeysFromMigration();
  assert.deepEqual(
    keys.slice().sort(),
    EXPECTED_PARTY_KEYS.slice().sort(),
    'get_event_parties party columns drifted from the contract',
  );
});

test('every party field the dashboard reads is one the RPC actually returns', () => {
  const returned = new Set([...partyKeysFromMigration(), ...NESTED_KEYS]);

  /**
   * `sms_opted_out` is NOT a column and must never be added to the RPC. It is
   * attached to each party by rsvpController.getRSVPs after the fact, from the
   * global sms_opt_outs table, because suppression is per-phone-number and
   * platform-wide rather than per-party. Asserted rather than merely skipped, so
   * that the day somebody "fixes" it by adding a column, this says why not.
   */
  const ATTACHED_BY_CONTROLLER = new Set(['sms_opted_out']);
  assert.ok(
    !returned.has('sms_opted_out'),
    'sms_opted_out came from the RPC — it belongs to the controller, see getRSVPs',
  );

  const missing = partyFieldsReadByDashboard()
    .filter((f) => !returned.has(f) && !ATTACHED_BY_CONTROLLER.has(f));

  assert.deepEqual(
    missing, [],
    `the dashboard reads party fields the RPC no longer sends: ${missing.join(', ')}. `
    + 'Add them to the jsonb_build_object in 20260911000000 AND to EXPECTED_PARTY_KEYS here.',
  );
});

test('the trimmed columns really are gone (the fix did not silently no-op)', () => {
  const keys = new Set(partyKeysFromMigration());
  // A representative few of the thirteen withheld. If `to_jsonb(p)` ever comes
  // back these reappear, and the egress win is lost without anything failing.
  for (const dropped of ['event_id', 'updated_at', 'max_party_size', 'sms_consent_attested_by']) {
    assert.ok(!keys.has(dropped), `${dropped} is back in the payload — was to_jsonb(p) restored?`);
  }
});
