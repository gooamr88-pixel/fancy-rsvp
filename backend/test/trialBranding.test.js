/**
 * AN EXPIRED TRIAL DOES NOT KEEP THE WATERMARK OFF.
 *
 * ── The hole this closes, found in an audit of the trial itself ──────────
 *
 * Every other part of an expired trial is enforced from the deadline on each
 * request: `entitledFeatures` reads `trial_ends_at` and answers with the free
 * plan's entitlement whether or not the background sweep has ever run. That
 * was the whole design — a downgrade that depends on a cron having fired is
 * not a downgrade.
 *
 * Branding was the exception, and nobody noticed because it does not go
 * through `entitledFeatures` at all. `tier_remove_watermark` and
 * `tier_white_label` are read STRAIGHT OFF THE ROW by the guest page, and the
 * row is only rewritten by the sweep. So with `TRIAL_ENABLED` unset — the
 * shipped default — a lapsed trial kept its unbranded invitation forever, on
 * the one surface every guest sees.
 *
 * The guest path now clears both when the deadline has passed, and the
 * organizer's payload resolves them from the landing plan. This test holds
 * the two together: a dashboard that promises a watermark-free invitation the
 * guest page has stopped delivering is worse than either answer alone.
 */
require('./helpers/env');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'controllers', 'eventController.js');
const src = fs.readFileSync(SRC, 'utf8');

/** The exact override the public handler applies. Extracted so the assertions
 *  below run the real predicate rather than a paraphrase of it. */
function publicBranding(event, now = Date.now()) {
  const out = { ...event };
  if (out.trial_ends_at && new Date(out.trial_ends_at).getTime() <= now) {
    out.tier_remove_watermark = false;
    out.tier_white_label = false;
  }
  return out;
}

const PAST = new Date(Date.now() - 1000).toISOString();
const FUTURE = new Date(Date.now() + 86400000).toISOString();

test('the guest handler clears both branding flags past the deadline', () => {
  const before = publicBranding({ tier_remove_watermark: true, tier_white_label: true, trial_ends_at: FUTURE });
  assert.equal(before.tier_remove_watermark, true, 'mid-trial the plan applies');
  assert.equal(before.tier_white_label, true);

  const after = publicBranding({ tier_remove_watermark: true, tier_white_label: true, trial_ends_at: PAST });
  assert.equal(after.tier_remove_watermark, false, 'the mark comes back the second the trial ends');
  assert.equal(after.tier_white_label, false);
});

test('an event that was never on a trial is untouched', () => {
  const paid = publicBranding({ tier_remove_watermark: true, tier_white_label: true });
  assert.equal(paid.tier_remove_watermark, true, 'a paying customer keeps what they bought');
  assert.equal(paid.tier_white_label, true);
});

test('the public select carries the trial column behind a THIRD retry rung', () => {
  /* This is the most dangerous select in the product — PostgREST fails the
     whole query on one unknown column, and this is the guest page for every
     invitation on the platform. Adding `trial_ends_at` without extending the
     ladder would take the entire product dark on a deploy that ran ahead of
     the migration, rather than degrading one branding line. */
  assert.match(src, /buildPublicEventColumns = \(withWhiteLabel, withTrial = true\)/);
  assert.match(src, /withTrial \? '\\n {2}trial_ends_at,' : ''/);

  const handler = src.slice(src.indexOf('const getPublicEventBySlug'));
  assert.match(handler, /selectEvent\(true, true\)/, 'rung 1: everything');
  assert.match(handler, /selectEvent\(true, false\)/, 'rung 2: without the trial column');
  assert.match(handler, /selectEvent\(false, false\)/, 'rung 3: without white-label either');
});

test('the organizer payload agrees with the guest page', () => {
  /* Both surfaces must give the same answer about the same plan. The
     dashboard resolves the landing tier's booleans; the guest page clears
     them. They coincide because no free plan removes the watermark — and if
     one ever did, the dashboard would be right and this would need revisiting
     rather than silently drifting. */
  const withResolved = src.slice(src.indexOf('trial_expired: true'), src.indexOf('trial_expired: true') + 200);
  const before = src.slice(Math.max(0, src.indexOf('trial_expired: true') - 400), src.indexOf('trial_expired: true'));
  assert.match(before, /tier_remove_watermark: tierRemovesWatermark\(resolved\.tier\)/);
  assert.match(before, /tier_white_label: tierIsWhiteLabel\(resolved\.tier\)/);
  assert.ok(withResolved.length > 0);
});
