/**
 * A FREE TRIAL IS NEVER WHITE-LABELLED.
 *
 * `white_label` removes every trace of Fancy from the invitation and from
 * every email the event sends, and puts the host's name there instead. Two
 * reasons it must not be part of a trial, and they point the same way:
 *
 *   It is the headline item of the most expensive plan. A trial that includes
 *   it has demonstrated that the plan carrying it is optional.
 *
 *   And a trial event is a MARKETING SURFACE — every guest opening a trial
 *   invitation is somebody discovering the product through a friend's wedding,
 *   which is the cheapest acquisition this business has. White-labelling the
 *   trial spends that for nothing.
 *
 * ── Why this is four assertions and not one ──────────────────────────────
 *
 * "Do not tick that box" is not an implementation. There are four independent
 * ways white-labelling reaches a guest, and each has to be closed:
 *
 *   1. the stored plan          — updatePricingConfig strips it on save
 *   2. the grant                — trialTier() sanitises what it hands over
 *   3. the request-time gate    — entitledFeatures sanitises a resolved trial
 *   4. the EVENT COLUMN         — which is what the guest page actually reads,
 *                                 and what syncBrandingSnapshots pushes
 *
 * Closing three of four would look correct in review and still ship a
 * white-labelled invitation.
 */
require('./helpers/env');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { trialTier, sanitizeTrialTier, TRIAL_EXCLUDED_FEATURES } = require('../utils/trialTier');
const { entitledFeatures, tierIsWhiteLabel } = require('../utils/tierResolver');
const { planColumns } = require('../services/trialService');

/** A trial plan an admin has (wrongly) ticked white-label on. */
const GREEDY_TRIAL = {
  key: 'trial', name: 'Free trial', is_trial: true, trial_days: 7,
  price_cents: 0, max_guests: 25,
  features: ['seating_map', 'sms_campaigns', 'white_label', 'remove_watermark'],
};
const FREE = { key: 'free', name: 'Free', price_cents: 0, max_guests: 100, features: [] };
const BESPOKE = {
  key: 'bespoke', name: 'Bespoke', price_cents: 59900, max_guests: 0,
  features: ['seating_map', 'white_label'],
};

const TIERS = [GREEDY_TRIAL, FREE, BESPOKE];

test('the plan handed to a grant has it removed', () => {
  assert.deepEqual(trialTier(TIERS).features, ['seating_map', 'sms_campaigns', 'remove_watermark']);
});

test('the grant writes the column false, whatever the plan said', () => {
  const cols = planColumns(trialTier(TIERS));
  assert.equal(cols.tier_white_label, false, 'this column is what the guest page reads');
  assert.ok(!cols.tier_features.includes('white_label'));
});

test('a trial event is not white-labelled at request time either', () => {
  /* The belt for config written before this rule, or edited straight into the
     database, where the stored plan still carries the key. */
  const onTrial = {
    is_paid: true, manual_override: false,
    tier_key: 'trial', tier_name: 'Free trial',
    trial_ends_at: new Date(Date.now() + 86400000).toISOString(),
  };
  const { features, tier } = entitledFeatures(TIERS, onTrial);
  assert.equal(features.includes('white_label'), false);
  assert.equal(tierIsWhiteLabel(tier), false);
  assert.ok(features.includes('seating_map'), 'and everything else the trial does include is untouched');
});

test('the admin config cannot store it on a trial plan', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'paymentController.js'), 'utf8');
  assert.match(src, /t\.is_trial === true\s*\n?\s*\? valid\.filter\(\(k\) => !TRIAL_EXCLUDED_FEATURES\.includes\(k\)\)/);
  assert.match(src, /features: kept,/, 'and the stripped list is what gets stored');
  /* Stripping at save is what makes syncBrandingSnapshots safe: it pushes the
     stored plan's booleans onto every event on that tier, so a plan that
     cannot hold the key cannot push it to a running trial either. */
  assert.match(src, /syncBrandingSnapshots/);
});

test('a PAYING white-label plan is completely unaffected', () => {
  /* The exclusion is scoped to trials by `isTrialTier`, and this is the test
     that would fail if somebody widened it. */
  assert.equal(sanitizeTrialTier(BESPOKE), BESPOKE, 'not a trial — returned untouched, same identity');
  const paid = { is_paid: true, tier_key: 'bespoke', tier_name: 'Bespoke' };
  const { features } = entitledFeatures(TIERS, paid);
  assert.ok(features.includes('white_label'), 'somebody who paid for it still has it');
});

test('a trial that never carried the key is returned unchanged', () => {
  const plain = { key: 'trial', is_trial: true, features: ['seating_map'] };
  assert.equal(sanitizeTrialTier(plain), plain, 'no needless object churn');
});

test('the exclusion list is exactly white_label — remove_watermark is a separate decision', () => {
  /* `remove_watermark` is the smaller switch: one line on the invitation
     rather than the whole identity. Whether a trial keeps the Fancy mark is a
     pricing call an admin may make either way, so it is deliberately NOT
     excluded. If that ever changes it should change here, visibly. */
  assert.deepEqual(TRIAL_EXCLUDED_FEATURES, ['white_label']);
  assert.ok(trialTier(TIERS).features.includes('remove_watermark'));
});
