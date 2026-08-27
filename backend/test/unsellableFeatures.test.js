/**
 * A PRICE TAG MAY NOT CARRY A PROMISE THE PRODUCT CANNOT KEEP.
 *
 * `pricing_tiers[].features` is an array of registry keys an admin ticks, and
 * two kinds of key must never become a bullet on a customer-facing plan card:
 *
 *   • `builtIn: false` — NOBODY HAS WRITTEN THE CAPABILITY. A tier carrying
 *     `sso_team_mgmt` rendered "SSO & team management" on the public pricing
 *     page and on the payment step's tier cards, and an enterprise customer
 *     could buy a plan for it. The admin UI now disables those toggles, so no
 *     admin can newly tick one — but config saved before that flag existed
 *     still carries them, and both surfaces went on advertising them.
 *   • `supersededBy` — granted by some other mechanism now, so the bullet tells
 *     a customer they already have what the card is charging them for.
 *
 * The two endpoints withhold them DIFFERENTLY, which is why both are asserted:
 * getPublicPricing builds its labels server-side and simply omits them, while
 * getOrganizerPricing hands the client a `hiddenTierFeatures` list to filter
 * with. One of them silently regressing would leave the false promise on
 * exactly one screen — and the payment step is the more expensive one to lose.
 */
require('./helpers/env');

const { describe, it } = require('node:test');
const t = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const backendDir = path.resolve(__dirname, '..');

const { PLATFORM_FEATURES, getFeatureByKey } = require('../config/featureRegistry');

/** A real unbuilt key and a real built one, taken from the registry itself. */
const UNBUILT = PLATFORM_FEATURES.find((f) => f.builtIn === false);
const BUILT = PLATFORM_FEATURES.find((f) => f.builtIn !== false && !f.alwaysOn);

const CONFIG = {
  id: '00000000-0000-0000-0000-000000000000',
  pricing_tiers: [
    {
      key: 'grand', name: 'Grand', price_cents: 99900, max_guests: 1000,
      // An admin ticked an unbuilt capability back when the toggle still allowed it.
      features: [BUILT.key, UNBUILT.key],
    },
  ],
  manual_payment_methods: [],
  sms_pricing_config: null,
  sms_rate_cents_per_credit: 1.1,
  sms_markup_percentage: 100,
};

function injectAbsolute(absFile, exportsObj) {
  const resolved = require.resolve(absFile);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}

injectAbsolute(path.join(backendDir, 'config', 'supabase.js'), {
  supabase: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: CONFIG, error: null }) }) }) }) },
});
injectAbsolute(path.join(backendDir, 'utils', 'configCache.js'), {
  getPlatformConfig: async () => CONFIG,
  invalidate: () => {},
  CONFIG_ID: '00000000-0000-0000-0000-000000000000',
  TTL_MS: 30000,
});
injectAbsolute(path.join(backendDir, 'utils', 'notificationService.js'), { sendEmailViaBrevo: async () => true });

const ctrl = require(path.join(backendDir, 'controllers', 'paymentController.js'));

function makeRes() {
  return {
    statusCode: 200, body: undefined, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    set(k, v) { this.headers[k] = v; return this; },
  };
}
const next = (err) => { throw err; };

let publicPayload;
let organizerPayload;

t.before(async () => {
  const r1 = makeRes();
  await ctrl.getPublicPricing({}, r1, next);
  publicPayload = r1.body;

  const r2 = makeRes();
  await ctrl.getOrganizerPricing({}, r2, next);
  organizerPayload = r2.body;
});

describe('the public pricing page', () => {
  it('does not advertise a capability nobody has built', () => {
    const tier = publicPayload.tiers[0];
    const label = getFeatureByKey(UNBUILT.key).label;

    assert.ok(
      !tier.feature_keys.includes(UNBUILT.key),
      `${UNBUILT.key} is builtIn:false and must not reach a plan card`,
    );
    assert.ok(
      !tier.features.includes(label),
      `"${label}" was printed as a plan bullet for a capability that does not exist`,
    );
  });

  it('still advertises what the plan really carries', () => {
    const tier = publicPayload.tiers[0];

    assert.ok(tier.feature_keys.includes(BUILT.key), 'a real feature was filtered out with the fake ones');
    assert.ok(tier.features.includes(getFeatureByKey(BUILT.key).label));
  });

  it('keeps the builtIn flag itself internal', () => {
    // Withholding the bullet is the fix; publishing our build status is not.
    const serialized = JSON.stringify(publicPayload);
    assert.ok(!serialized.includes('builtIn'), 'the internal build marker leaked to the public endpoint');
  });
});

describe('the payment step', () => {
  it('tells the client to hide every unbuilt capability', () => {
    // This endpoint serves tiers raw and filters on the client, so the contract
    // is the list — not the absence of the key from pricing_tiers.
    assert.ok(
      organizerPayload.hiddenTierFeatures.includes(UNBUILT.key),
      `${UNBUILT.key} is builtIn:false and must be in hiddenTierFeatures, or the tier `
      + 'cards on the last screen before payment will print it',
    );
  });

  it('does not hide a capability the plan genuinely includes', () => {
    assert.ok(
      !organizerPayload.hiddenTierFeatures.includes(BUILT.key),
      'a real, gated feature must stay visible on the card the customer is buying',
    );
  });

  it('hides every unbuilt key in the registry, not just the one under test', () => {
    const unbuilt = PLATFORM_FEATURES.filter((f) => f.builtIn === false).map((f) => f.key);
    const missing = unbuilt.filter((k) => !organizerPayload.hiddenTierFeatures.includes(k));

    assert.deepEqual(missing, [], `these unbuilt keys can still be advertised: ${missing.join(', ')}`);
  });
});
