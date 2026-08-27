/**
 * EVERY TOGGLE IN THE ADMIN UI MUST MEAN SOMETHING.
 *
 * The Feature Registry is rendered verbatim as a per-tier switch list in
 * Admin -> Config -> Subscription Tiers. An admin reads a switch as an access
 * control, prices a plan around it, and sells it. So a key that no route gates
 * is not a harmless leftover — it is a capability sold and then handed out
 * anyway, or withheld from someone who paid for it, with nothing anywhere
 * reporting a fault.
 *
 * That is not hypothetical. An audit of this registry found:
 *
 *   • `table_management` — mounted NOWHERE for its entire life. Every table
 *     write asked for `seating_map`, so a plan sold on table management had no
 *     tables at all, and its switch did nothing in either direction.
 *   • `remove_watermark` — read by nothing. The watermark was decided by a
 *     separate checkbox on the tier, so ticking the feature shipped the mark.
 *   • four keys (`rsvp_basic`, `analytics_basic`, `email_notifications`,
 *     `support_community`) that no code path has ever consulted.
 *
 * None of it could fail a build or a test, because all of it compiles. This
 * file is the check that would have caught every one: it holds each of the
 * registry's three enforcement states to its word.
 *
 * Text-scanning routes/ rather than booting the app is deliberate — mounting is
 * a fact about the source, and a runtime probe would need every controller,
 * every DB mock and a request per key to learn less.
 */
require('./helpers/env');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  PLATFORM_FEATURES, GATED_FEATURES, ALWAYS_ON_FEATURES,
} = require('../config/featureRegistry');

const ROUTES_DIR = path.join(__dirname, '..', 'routes');
const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const FRONTEND_DIR = path.join(__dirname, '..', '..', 'frontend', 'src', 'app');

/** Every .js under routes/, including the admin subfolder. */
function routeFiles(dir = ROUTES_DIR) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

/**
 * key -> the route files that gate it.
 *
 * Parsed from the gate CALLS rather than grepped for the bare key: a key named
 * in a comment — and this codebase comments its gates heavily — would otherwise
 * count as enforcement, which is the precise mistake that let `checkin_app`
 * claim for months that pairing was gated when only the download was.
 */
function buildGateIndex() {
  const index = new Map();
  const callPattern = /require(?:Any)?Feature\s*\(([^)]*)\)/g;

  for (const file of routeFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    for (const [, args] of src.matchAll(callPattern)) {
      for (const [, key] of args.matchAll(/['"]([a-z0-9_]+)['"]/g)) {
        if (!index.has(key)) index.set(key, new Set());
        index.get(key).add(path.basename(file));
      }
    }
  }
  return index;
}

/**
 * Keys enforced by a middleware of their own instead of `requireFeature`.
 *
 * An allowlist, and a small one on purpose: each entry names the file that does
 * the enforcing, and the test reads that file to confirm it still does. An
 * exception nobody re-checks is how a gate gets deleted and its exemption left
 * behind, which reads afterwards as though the key were covered.
 */
const ENFORCED_ELSEWHERE = {
  // Two questions — may this plan text at all, and has this event bought an
  // allowance — so it cannot be a plain requireFeature mount. See the header
  // of middleware/smsAddonGate.js.
  sms_campaigns: 'middleware/smsAddonGate.js',
  // Not an API call to reject: the watermark is a render decision on a public
  // guest page, driven by events.tier_remove_watermark. tierRemovesWatermark()
  // is what turns this key into that column.
  remove_watermark: 'utils/tierResolver.js',
  // Same shape, one level up: a branding decision made when a guest page or an
  // event email RENDERS, months after purchase and with no session to reject.
  // tierIsWhiteLabel() turns the key into events.tier_white_label, and
  // test/whiteLabelEmails.test.js proves every guest template honours it.
  white_label: 'utils/tierResolver.js',
  // Carries a grandfather clause a plain requireFeature cannot express — an
  // event already running the app keeps pairing spares — so all three of its
  // surfaces (release, download, pairing codes) mount this instead.
  checkin_app: 'middleware/checkinAppGate.js',
  // Shapes a response instead of refusing one. The basic overview is on every
  // plan and shares the payload, so this is a partial gate inside the
  // controller (`eventHasFeature`), not a mount.
  analytics_advanced: 'controllers/analyticsController.js',
};

const gateIndex = buildGateIndex();

describe('feature registry coverage', () => {
  it('every gated feature is actually mounted on a route', () => {
    const unmounted = GATED_FEATURES.filter((key) => (
      !gateIndex.has(key) && !ENFORCED_ELSEWHERE[key]
    ));

    assert.deepEqual(unmounted, [], (
      `These keys are per-tier switches in the admin UI that control nothing:\n`
      + `  ${unmounted.join(', ')}\n`
      + `Mount requireFeature('<key>') on the routes that serve the capability, or — if it\n`
      + `is not built yet — mark the entry builtIn:false so the admin UI greys it out.`
    ));
  });

  it('the middleware named for each exception still references its key', () => {
    for (const [key, file] of Object.entries(ENFORCED_ELSEWHERE)) {
      const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      assert.ok(
        src.includes(`'${key}'`),
        `${file} is listed as what enforces '${key}', but no longer mentions it. `
        + `Either restore the enforcement or delete the exception — do not leave the key `
        + `looking covered.`,
      );
    }
  });

  it('nothing gates an always-on feature', () => {
    for (const key of ALWAYS_ON_FEATURES) {
      assert.ok(
        !gateIndex.has(key),
        `'${key}' is flagged alwaysOn — the admin UI shows it checked and locked, and `
        + `entitledFeatures() grants it to every tier — yet ${[...gateIndex.get(key) || []].join(', ')} `
        + `gates it. One of the two is a lie to a customer. Drop the flag or drop the gate.`,
      );
    }
  });

  it('nothing gates a feature marked "not built yet"', () => {
    const stale = PLATFORM_FEATURES
      .filter((f) => f.builtIn === false && gateIndex.has(f.key))
      .map((f) => f.key);

    assert.deepEqual(stale, [], (
      `These carry builtIn:false — the admin UI disables their switch and captions it `
      + `"Not built yet" — but a route now gates them: ${stale.join(', ')}. `
      + `The capability shipped; remove the flag so the switch works.`
    ));
  });

  it('no gate names a key that is not in the registry', () => {
    const known = new Set(PLATFORM_FEATURES.map((f) => f.key));
    const unknown = [...gateIndex.keys()].filter((k) => !known.has(k));

    assert.deepEqual(unknown, [], (
      `A route gates ${unknown.join(', ')}, which no registry entry defines. No tier can `
      + `ever grant it, so that route is closed to every customer including the ones who `
      + `paid for it — featureGate simply never finds the key.`
    ));
  });

  it('the table editor accepts either of its two keys', () => {
    // The specific regression this file was written after: table writes asked
    // for seating_map alone, so `table_management` was decorative. Both keys
    // must reach tableRoutes, and dropping seating_map would revoke the editor
    // from every tier configured to date.
    const src = fs.readFileSync(path.join(ROUTES_DIR, 'tableRoutes.js'), 'utf8');
    const call = src.match(/requireAnyFeature\s*\(([^)]*)\)/);

    assert.ok(call, 'tableRoutes must gate its writes with requireAnyFeature');
    assert.ok(call[1].includes("'seating_map'"), 'seating_map must keep opening the table editor');
    assert.ok(call[1].includes("'table_management'"), 'table_management must open the table editor too');
  });

  it('the door app is gated where a device is actually authorised', () => {
    // The APK is public — /checkin-app links it and says installing needs no
    // account — so gating the download enforced nothing. Pairing-code issuance
    // is the one moment the entitlement is decidable.
    const src = fs.readFileSync(path.join(ROUTES_DIR, 'checkinSyncRoutes.js'), 'utf8');
    const at = src.indexOf('pairing-codes');
    assert.notEqual(at, -1, 'the pairing-code route has moved or been renamed');
    const pairingRoute = src.slice(Math.max(0, at - 400), at + 200);

    assert.ok(
      /requireCheckinApp/.test(pairingRoute),
      'POST /devices/pairing-codes must carry requireCheckinApp — it is the only '
      + 'checkpoint a tablet cannot walk around, since the APK itself is public.',
    );

    // And that middleware must still ask about the right key.
    const gate = fs.readFileSync(path.join(__dirname, '..', 'middleware', 'checkinAppGate.js'), 'utf8');
    assert.ok(gate.includes("'checkin_app'"), 'checkinAppGate must resolve the checkin_app entitlement');
  });
});

/**
 * ── PRINCIPLE 2 ──
 * MAKING A DEAD SWITCH REAL MUST NOT DELETE A WORKING FEATURE.
 *
 * The registry has had keys that gated nothing for most of this product's life.
 * Wiring one up is a good change and a dangerous one in the same commit: the
 * capability was reaching EVERY customer while it was ungated, and the moment a
 * gate appears it reaches only the plans that list the key — which, for a key
 * that was never enforced, is usually no plan at all.
 *
 * That is not hypothetical either. `analytics_advanced` was gated in exactly
 * this way, and because its admin toggle had been disabled for being unbuilt, no
 * tier carried it. Every organizer on the platform would have opened the
 * analytics page to find a plan lock where their charts had been — and the lock
 * could not even name a qualifying plan, because there wasn't one.
 *
 * So: a key that a gate enforces must be GRANTED by some migration, or be named
 * below as a capability that never shipped to anyone. Both are one line. The
 * point is that the line has to be written at the moment the gate goes in,
 * which is the moment somebody is in a position to notice.
 */
const NEVER_SHIPPED = {
  // Enforced from the day it first did anything. There is nothing to take away:
  // no guest page, pass or email has ever rendered without our marks, so no
  // customer notices this becoming real. An admin ticks it on the plans that
  // should sell it — a pricing decision, not a migration.
  white_label: 'A brand-new capability; nothing was ever delivered under this key.',
};

describe('a newly enforced feature does not silently vanish', () => {
  const migrations = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));

  it('every gated feature is granted to some tier by a migration', () => {
    const ungranted = GATED_FEATURES.filter((key) => {
      if (NEVER_SHIPPED[key]) return false;
      // The key as it appears inside a JSON features array. Matching the bare
      // word would count a mention in a comment — and these migrations are
      // heavily commented, which would make this assertion pass on prose.
      const inFeaturesArray = new RegExp(`"${key}"`);
      return !migrations.some((sql) => inFeaturesArray.test(sql));
    });

    assert.deepEqual(ungranted, [], (
      'These keys are enforced but no migration grants them to any tier, so every '
      + `customer loses the capability the day this deploys: ${ungranted.join(', ')}.\n`
      + 'Add a migration assigning the key to the plans that should keep it — the rule is '
      + 'that nobody who can use the feature today may lose it — or, if the capability has '
      + 'never shipped to anyone, add it to NEVER_SHIPPED above with the reason.'
    ));
  });

  it('nothing sits in NEVER_SHIPPED that a migration already grants', () => {
    // An exemption that has quietly become false is worse than no exemption: it
    // reads as "we checked" long after the thing it claimed stopped being true.
    const stale = Object.keys(NEVER_SHIPPED)
      .filter((key) => migrations.some((sql) => new RegExp(`"${key}"`).test(sql)));

    assert.deepEqual(stale, [], (
      `${stale.join(', ')} is exempted as never-shipped, but a migration grants it. `
      + 'Delete the exemption.'
    ));
  });
});

/**
 * ── PRINCIPLE 3 ──
 * THE SCREEN AND THE SERVER MUST ASK THE SAME QUESTION.
 *
 * When they disagree you get one of two products: a padlock over an endpoint
 * that answers, or an inviting button that 403s in the customer's face. Both
 * have shipped here before.
 *
 * A whole-system proof of agreement is not something a unit test can do, but the
 * cheapest half of it is: every feature key the FRONTEND gates on must exist in
 * the registry. A typo'd or renamed key in the browser fails open — the padlock
 * simply never draws — and nothing anywhere reports it.
 */
describe('the frontend gates on real feature keys', () => {
  /** Every .js under the frontend app tree. */
  const frontendFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return frontendFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });

  it('names no key the registry does not define', () => {
    const known = new Set(PLATFORM_FEATURES.map((f) => f.key));
    const offenders = [];

    for (const file of frontendFiles(FRONTEND_DIR)) {
      const src = fs.readFileSync(file, 'utf8');
      // The two shapes the client gates with: a <FeatureGate feature="key"> prop
      // and a direct tier_features membership test.
      const patterns = [
        /feature=["']([a-z0-9_]+)["']/g,
        /features\.includes\(\s*['"]([a-z0-9_]+)['"]\s*\)/g,
      ];
      for (const re of patterns) {
        for (const [, key] of src.matchAll(re)) {
          if (!known.has(key)) offenders.push(`${path.basename(file)} → ${key}`);
        }
      }
    }

    assert.deepEqual(offenders, [], (
      'These gate on a key no registry entry defines, so the lock can never appear and '
      + `the surface stays open until the API refuses it: ${offenders.join(', ')}`
    ));
  });
});
