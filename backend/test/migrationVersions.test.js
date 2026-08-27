/**
 * TWO MIGRATIONS MAY NEVER SHARE A VERSION.
 *
 * `supabase_migrations.schema_migrations` is keyed on the version — the digits
 * before the first underscore in the filename. Two files claiming one version
 * cannot both be recorded: whichever runs first takes it, and the second is
 * from then on indistinguishable from a migration that has already been
 * applied. It is never run, nothing errors, and nothing anywhere reports it.
 *
 * That is not a hypothetical. `20260818000000_sms_addon.sql` and
 * `20260818000000_tier_identity.sql` shared a version, and the consequence of
 * the tier one losing was a platform where `events.tier_key` and
 * `events.tier_features` did not exist — so plans resolved by display name,
 * entitlement snapshots were never written, and subscription tiers looked
 * broken while every line of code that read them was correct.
 *
 * A collision is invisible in review (the files sort next to each other and
 * look deliberate), invisible in CI (nothing runs migrations), and invisible in
 * production until someone asks why a feature does not work. So it is checked
 * here, where a filename is all the evidence needed.
 */
require('./helpers/env');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'supabase', 'migrations');

const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

describe('supabase migrations', () => {
  it('finds the migrations directory', () => {
    // A path that quietly resolves to nothing would make every assertion below
    // pass over an empty list — a green check that proves nothing.
    assert.ok(files.length > 0, `no .sql migrations found under ${MIGRATIONS_DIR}`);
  });

  it('gives every migration a unique version', () => {
    const byVersion = new Map();
    for (const file of files) {
      const version = file.split('_')[0];
      if (!byVersion.has(version)) byVersion.set(version, []);
      byVersion.get(version).push(file);
    }

    const collisions = [...byVersion.entries()].filter(([, group]) => group.length > 1);

    assert.deepEqual(collisions, [], (
      'These migrations share a version, so only ONE of each group can ever be '
      + 'recorded and applied — the rest are silently skipped forever:\n'
      + collisions.map(([v, group]) => `  ${v}: ${group.join(', ')}`).join('\n')
      + '\nRename all but the one already applied in production to an unclaimed version, '
      + 'and make the renamed file idempotent so re-running it is harmless.'
    ));
  });

  it('names every migration <version>_<description>.sql', () => {
    /**
     * A file whose version is not a plain 14-digit timestamp sorts unpredictably
     * against the others, and apply ORDER is the only thing making a migration
     * that depends on an earlier one safe.
     *
     * One documented exception, and it is NOT renamed on purpose. Its version is
     * 8 digits, which string-sorts before every 14-digit version that starts with
     * the same date — so its position in the run is already correct and can only
     * stay correct, since every new migration here is a full timestamp far later
     * than June. Renaming it would change its version, which for a file that is
     * probably already recorded means an orphaned `schema_migrations` row and the
     * CLI reporting remote/local drift — a real problem traded for a cosmetic
     * one. It is idempotent (a guarded DO block), so it is harmless where it is.
     */
    const LEGACY_SHORT_VERSION = new Set(['20260612_add_template_data.sql']);

    const malformed = files
      .filter((f) => !LEGACY_SHORT_VERSION.has(f))
      .filter((f) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(f));

    assert.deepEqual(malformed, [], (
      `These do not match <14-digit version>_<snake_case>.sql: ${malformed.join(', ')}. `
      + 'The version prefix is what orders the run and what schema_migrations stores.'
    ));
  });
});
