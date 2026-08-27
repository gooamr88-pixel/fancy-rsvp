/**
 * THE FEATURES A PLAN LISTS ARE THE FEATURES THE ACCOUNT GETS.
 *
 * Two entitlement decisions used to be made from the wrong field, quietly:
 *
 *   1. The WATERMARK. A tier carries a `remove_watermark` boolean AND a
 *      `remove_watermark` entry in its feature checklist — two switches, one
 *      outcome — and only the boolean was ever read. An admin who ticked the
 *      feature, in the list of everything else the plan includes, shipped the
 *      "Powered by Fancy RSVP" mark to a paying customer's guests.
 *
 *   2. The BASELINE. `entitledFeatures` returned the tier's stored array
 *      verbatim, so a paid plan that omitted a free-default key granted less
 *      than an unpaid event does.
 *
 * Both are pure functions of a tier object, which is why they are pinned here
 * rather than through a middleware: there is no request, no database and no
 * mock between the input and the wrong answer.
 */
require('./helpers/env');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  tierRemovesWatermark, tierSnapshot, entitledFeatures, withBaseline, BASELINE_FEATURES,
} = require('../utils/tierResolver');
const { FREE_TIER_FEATURES, ALWAYS_ON_FEATURES } = require('../config/featureRegistry');

describe('tierRemovesWatermark — either switch grants it', () => {
  it('honours the tier checkbox', () => {
    assert.equal(tierRemovesWatermark({ remove_watermark: true, features: [] }), true);
  });

  it('honours the feature checklist entry', () => {
    assert.equal(
      tierRemovesWatermark({ remove_watermark: false, features: ['seating_map', 'remove_watermark'] }),
      true,
      'ticking "Remove Fancy watermark" in the plan features must drop the mark — this is the bug',
    );
  });

  it('grants it when both are set', () => {
    assert.equal(tierRemovesWatermark({ remove_watermark: true, features: ['remove_watermark'] }), true);
  });

  it('withholds it when neither is set', () => {
    assert.equal(tierRemovesWatermark({ remove_watermark: false, features: ['seating_map'] }), false);
  });

  it('survives a tier with no features array at all', () => {
    assert.equal(tierRemovesWatermark({ remove_watermark: false }), false);
    assert.equal(tierRemovesWatermark(null), false);
  });

  it('is what the purchase snapshot records', () => {
    // The snapshot is what a guest page reads months later, and what survives
    // the plan being deleted. Computing it from the boolean alone froze the bug
    // onto the event row, where no later config edit could correct it.
    const snap = tierSnapshot({
      key: 'pro', name: 'Pro', price_cents: 4900, max_guests: 200,
      remove_watermark: false, features: ['remove_watermark'],
    });
    assert.equal(snap.tier_remove_watermark, true);
  });
});

describe('entitledFeatures — the baseline floor', () => {
  const TIERS = [{ key: 'bare', name: 'Bare', features: ['seating_map'] }];

  it('unions the always-on baseline onto a live tier', () => {
    const { features, source } = entitledFeatures(TIERS, { tier_key: 'bare' });

    assert.equal(source, 'tier', 'the baseline is not a resolution outcome — source still reports the tier');
    assert.ok(features.includes('seating_map'), 'the tier keeps its own features');
    for (const key of BASELINE_FEATURES) {
      assert.ok(features.includes(key), `${key} is granted to every plan`);
    }
  });

  it('unions it onto a purchase snapshot when the plan is gone', () => {
    const { features, source } = entitledFeatures([], {
      tier_key: 'deleted', tier_features: ['qr_checkin'],
    });

    assert.equal(source, 'snapshot');
    assert.ok(features.includes('qr_checkin'));
    assert.ok(features.includes('rsvp_basic'), 'a deleted plan still cannot leave an event below the floor');
  });

  it('is a floor, never a wildcard', () => {
    const { features } = entitledFeatures(TIERS, { tier_key: 'bare' });

    assert.ok(!features.includes('qr_checkin'), 'a capability the plan never listed stays withheld');
    assert.ok(!features.includes('sms_campaigns'));
  });

  it('covers both flags, so neither can drift out of the floor', () => {
    for (const key of [...FREE_TIER_FEATURES, ...ALWAYS_ON_FEATURES]) {
      assert.ok(
        BASELINE_FEATURES.includes(key),
        `${key} is freeDefault and/or alwaysOn but is not in the baseline — a paid plan `
        + `could grant less than a free event.`,
      );
    }
  });

  it('does not duplicate a key the tier already lists', () => {
    const features = withBaseline(['rsvp_basic', 'seating_map']);
    const seen = new Set(features);

    assert.equal(features.length, seen.size, 'no duplicates');
    assert.equal(features.filter((k) => k === 'rsvp_basic').length, 1);
  });

  it('tolerates junk where a features array should be', () => {
    assert.deepEqual(withBaseline(null), BASELINE_FEATURES);
    assert.deepEqual(withBaseline(undefined), BASELINE_FEATURES);
    assert.deepEqual(entitledFeatures(null, null).features, BASELINE_FEATURES);
  });
});
