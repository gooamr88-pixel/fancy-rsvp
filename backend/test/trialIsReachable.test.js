/**
 * THE TRIAL HAS TO BE REACHABLE, NOT JUST CORRECT.
 *
 * ── What happened ────────────────────────────────────────────────────────
 *
 * The free trial shipped complete and completely invisible. Every unit test
 * passed, the gates were right, the sweep was right — and an organizer who
 * went to publish an event saw no "start free" card, no banner and no error,
 * because the trial is a TIER in `super_admin_config.pricing_tiers` and
 * nothing had ever created one. `trialTier()` answered null, so
 * `getOrganizerPricing` answered `trial: null`, so the wizard rendered
 * nothing. Correct behaviour for "no trial configured", and a dead feature.
 *
 * There was no admin control to create one either, so it could be neither
 * used nor diagnosed from inside the product.
 *
 * ── What this file checks ────────────────────────────────────────────────
 *
 * Not the logic — the other four trial test files do that. This checks the
 * three things that have to exist OUTSIDE the logic for any of it to be
 * reachable at all: a seeded plan, an admin control, and a wizard that renders
 * the card when the server offers one.
 *
 * A unit test cannot notice an unconfigured feature, which is exactly why this
 * is written against the migration and the forms rather than against the
 * functions.
 */
require('./helpers/env');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const { trialTier } = require('../utils/trialTier');
const { resolveTrialPlans } = require('../services/trialService');

test('a migration seeds the trial plan', () => {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const seed = fs.readdirSync(dir).find((f) => /seed_trial_plan\.sql$/.test(f));
  assert.ok(seed, 'without a seeded plan the whole feature renders nothing, silently');

  const sql = fs.readFileSync(path.join(dir, seed), 'utf8');
  assert.match(sql, /'is_trial',\s*true/, 'the flag that makes it THE trial');
  assert.match(sql, /'trial_days',\s*7/);
  assert.match(sql, /'max_guests',\s*25/, 'the cap that stops a real wedding running free');
  assert.match(sql, /WHERE NOT EXISTS/, 're-running must be a no-op — these are applied by hand');
  assert.match(sql, /pricing_tiers = COALESCE\(pricing_tiers, '\[\]'::jsonb\) \|\|/,
    'it must APPEND — a rewrite could re-price or drop a plan somebody is on');

  // The two features a trial must never carry, checked against the seed
  // itself rather than trusted to the code that strips them.
  assert.doesNotMatch(sql.split('WHERE NOT EXISTS')[0], /'white_label'/);
  assert.doesNotMatch(sql.split('WHERE NOT EXISTS')[0], /'remove_watermark',\s*\n?\s*'/);
});

test('the seeded plan actually resolves as a trial', () => {
  /* Parses the feature list out of the migration and runs it through the real
     resolver. A seed that the code does not recognise is the same dead feature
     with more SQL. */
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const sql = fs.readFileSync(
    path.join(dir, fs.readdirSync(dir).find((f) => /seed_trial_plan\.sql$/.test(f))), 'utf8');

  const features = [...sql.matchAll(/^\s{6}'([a-z_]+)'/gm)].map((m) => m[1]);
  assert.ok(features.includes('seating_map'), 'sanity: the parse found the feature list');

  const seeded = {
    key: 'free_trial', name: 'Free trial', is_trial: true, trial_days: 7,
    price_cents: 0, max_guests: 25, features,
  };
  assert.equal(trialTier([seeded])?.key, 'free_trial');

  const plans = resolveTrialPlans([seeded]);
  assert.equal(plans.ok, true, 'and it is offerable with no other plan configured');
  assert.equal(plans.days, 7);
  assert.equal(plans.tier.features.includes('white_label'), false);
  assert.ok(plans.tier.features.includes('sms_campaigns'),
    'the messaging SCREENS are included — the messages themselves are still bought');
});

test('an admin can create and edit a trial plan without SQL', () => {
  const form = read('frontend', 'src', 'app', 'admin', '(panel)', 'config', 'page.js');
  assert.match(form, /setTrialTier\(selectedTierIdx, e\.target\.checked\)/, 'the switch');
  assert.match(form, /handleTierChange\(selectedTierIdx, 'trial_days'/, 'and its length');
  assert.match(form, /is_trial: false/, 'a NEW plan starts as an ordinary one');

  /* trialTier() takes the FIRST flagged plan, so a second one is not an error —
     it is silently ignored. The switch is exclusive for that reason. */
  assert.match(form, /i === idx \? \{ \.\.\.tier, is_trial: on \} : \(on \? \{ \.\.\.tier, is_trial: false \}/);
});

test('the admin form and the save whitelist agree', () => {
  /* `updatePricingConfig` rebuilds every tier from a named list, so a field the
     form writes but the whitelist omits is deleted on save with no error. That
     is how `is_trial` would have quietly stopped working after the first
     pricing edit. */
  const api = read('backend', 'controllers', 'paymentController.js');
  assert.match(api, /is_trial: !!t\.is_trial/);
  assert.match(api, /trial_days: Math\.min\(90, Math\.max\(1,/);
});

test('the wizard renders the card exactly when the server offers one', () => {
  const page = read('frontend', 'src', 'app', 'dashboard', 'create-event', 'page.js');
  const stage = read('frontend', 'src', 'app', 'dashboard', 'create-event', 'components', 'StagePayment.js');
  const api = read('backend', 'controllers', 'paymentController.js');

  // server → wizard → card, the chain that was broken end to end.
  assert.match(api, /trial,\n\s*config: \{/, 'the endpoint publishes a `trial` descriptor');
  assert.match(page, /setTrial\(data\.trial \|\| null\)/, 'the wizard stores it');
  assert.match(page, /onStartTrial=\{trial \? handleStartTrial : undefined\}/, 'and only offers when there is one');
  assert.match(stage, /onStartTrial && \(/, 'and the card is gated on that');
});

test('the offer and the grant agree on their conditions', () => {
  /* The card is drawn from `getOrganizerPricing`'s `trial` descriptor and the
     click is answered by `resolveTrialPlans`. A condition on one side only
     produces either a card whose click 400s, or — the version that shipped —
     no card and no error at all.

     `resolveTrialPlans` returns ok on a trial plan alone, so the descriptor
     must be built from the trial plan alone. It once also required a landing
     tier, which is why this is asserted rather than assumed. */
  const api = read('backend', 'controllers', 'paymentController.js');
  assert.doesNotMatch(api, /const trial = trialPlan && landing/,
    'a configured landing plan is NOT a condition of either side any more');

  /* The one condition the offer may add is the one the grant also enforces:
     a trial already spent by this account. Anything else here is a card the
     click would refuse. */
  assert.match(api, /const trial = trialPlan && !trialSpent/);
  assert.match(api, /trialSpent = !orgError && !!org\?\.trial_event_id/);
  assert.match(api, /TRIAL_ALREADY_USED/, 'and the grant refuses the same case');

  const trialOnly = resolveTrialPlans([{
    key: 'free_trial', is_trial: true, trial_days: 7, price_cents: 0, max_guests: 25, features: [],
  }]);
  assert.equal(trialOnly.ok, true, 'the grant side, with nothing else configured at all');
  assert.equal(trialOnly.landing, null);
});

test('the dashboard banner is gated on the event, not on config', () => {
  const dash = read('frontend', 'src', 'app', 'dashboard', 'page.js');
  assert.match(dash, /activeEvent\?\.trial_ends_at && \(/,
    'no trial started means no banner — which is right, and was the second half of the silence');
});
