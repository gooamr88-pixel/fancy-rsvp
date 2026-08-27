/**
 * Central Feature Registry — the single source of truth for every gateable
 * platform capability.
 *
 * Each feature has a machine-readable key (used in middleware + DB), a human
 * label (shown in admin UI and on the pricing page), a description (admin
 * tooltip), a category (for UI grouping), and a freeDefault flag indicating
 * whether the feature is available on unpaid / free-tier events.
 *
 * ── A feature is in exactly one of THREE enforcement states ────────────────
 *
 * Every key here becomes a per-tier toggle in Admin -> Config -> Subscription
 * Tiers, and an admin reasonably reads a toggle as "this switch controls
 * access". For most keys it does. For two kinds it does not, and both must say
 * so on the switch itself — an inert toggle that looks live is how a plan gets
 * sold on a capability the product hands out anyway, or withholds regardless.
 *
 *   1. GATED (the default — no flag). A route mounts `requireFeature(key)`.
 *      The toggle is the access control.
 *
 *   2. `builtIn: false` — a pricing-page bullet with no capability behind it
 *      yet. Nothing mounts a gate, so the toggle cannot affect access. Ship
 *      the capability + mount the gate, then remove the flag.
 *
 *      `comingSoon: true` refines that state: the capability is on the roadmap
 *      and the admin UI says "Soon" rather than the blunter "Not built yet", so
 *      a plan can be designed around it without it being sold today. It changes
 *      nothing about enforcement — a coming-soon key is still `builtIn: false`
 *      and is still withheld from every customer-facing price list.
 *
 *   3. `alwaysOn: true` — a capability EVERY plan includes, paid or not.
 *      Nothing gates it because nothing should: `entitledFeatures()` unions
 *      these into every tier, so unticking one cannot take it away. The flag
 *      exists so the admin UI can render it checked-and-locked rather than as
 *      a live switch that silently does nothing.
 *
 * `alwaysOn` is a promise about enforcement; `freeDefault` is a statement about
 * unpaid events. They coincide today and are still different questions — a
 * future free-tier trial feature would be `freeDefault` without being
 * `alwaysOn`. Neither flag may be set on a key that a route gates.
 * `test/featureCoverage.test.js` holds all three states to their word.
 *
 * Adding a new feature:
 *   1. Add an entry here.
 *   2. Mount `requireFeature('your_key')` on the relevant route(s).
 *   3. The admin UI picks it up automatically from GET /admin/feature-registry.
 */

const PLATFORM_FEATURES = [
  // ── Guests & RSVP ──
  { key: 'rsvp_basic',           label: 'Basic RSVP forms',              description: 'Standard RSVP form with attending / declined status options.',                      category: 'Guests & RSVP',     freeDefault: true, alwaysOn: true },
  { key: 'rsvp_custom_fields',   label: 'Custom RSVP form builder',      description: 'Add custom questions, dropdowns, and fields to your RSVP form.',                    category: 'Guests & RSVP',     freeDefault: false },
  { key: 'add_guest_manual',     label: 'Manual guest entry',            description: 'Organizers can manually add guests from the dashboard.',                             category: 'Guests & RSVP',     freeDefault: false },
  { key: 'import_guests_csv',    label: 'CSV guest import',              description: 'Bulk-import guest lists from a CSV file.',                                           category: 'Guests & RSVP',     freeDefault: false },
  { key: 'guest_export_csv',     label: 'Guest export (CSV)',            description: 'Download the full guest list as a CSV spreadsheet.',                                 category: 'Guests & RSVP',     freeDefault: false },
  { key: 'guest_export_excel',   label: 'Guest export (Excel)',          description: 'Download the full guest list as a formatted Excel workbook.',                        category: 'Guests & RSVP',     freeDefault: false },

  // ── Seating & Tables ──
  { key: 'seating_map',          label: 'Seating chart designer',        description: 'Visual drag-and-drop seating chart with table assignment.',                          category: 'Seating & Tables',  freeDefault: false },
  // Gated as `requireAnyFeature('seating_map', 'table_management')` on the table
  // routes. EITHER key opens them: this one was mounted NOWHERE for its whole
  // life — every table write asked for `seating_map` — so a tier sold on "table
  // management" alone had no tables at all, and the toggle was decorative. The
  // OR keeps every existing seating_map tier working untouched while making this
  // switch mean what it says.
  { key: 'table_management',     label: 'Table management',              description: 'Create, edit, duplicate, and position tables for your event.',                       category: 'Seating & Tables',  freeDefault: false },

  // ── Check-in ──
  { key: 'qr_checkin',           label: 'QR code check-in',             description: 'Scan QR ticket codes to check guests in at the door.',                               category: 'Check-in',          freeDefault: false },
  { key: 'manual_checkin',       label: 'Manual check-in',              description: 'Search and check in guests by name from the check-in console.',                      category: 'Check-in',          freeDefault: false },
  // The dedicated Android door app, distinct from qr_checkin (which is the
  // browser kiosk at /checkin and needs a live connection). This one gates the
  // APK download; assign it to whichever tiers should get it in
  // Admin -> Config -> Subscription Tiers. Nothing is assigned by default.
  { key: 'checkin_app',          label: 'Fancy Check-in app (offline door scanner)', description: 'Dedicated Android app for the door: scans tickets and checks guests in with no internet at the venue.', category: 'Check-in', freeDefault: false },

  // ── Campaigns & SMS ──
  /**
   * TEXT MESSAGING — a REAL tier gate again, and a metered one.
   *
   * ── The history, because it explains the two-part rule ──
   *
   * This started as an ordinary tier feature, then became decorative
   * (`builtIn: false`, `supersededBy: 'sms_addon'`) when SMS moved to a per-event
   * add-on bought at checkout: any plan could buy it, so gating it by tier was
   * wrong. The key stayed only so existing tiers would not show an unknown-key
   * warning, and its own comment said to delete it.
   *
   * It is now switched on from Admin -> Config -> Subscription Tiers, and it means
   * something again. The two questions are DIFFERENT, and both are asked:
   *
   *   1. May this plan use texting at all?   ← this feature, set per tier
   *   2. Has this event paid for messages?   ← events.sms_addon_purchased_at
   *
   * A plan without the feature never sees the surface; a plan with it sees the
   * surface and buys an allowance. Neither answer implies the other, which is
   * exactly why the old single-question design could not express "available on
   * Professional and above, still charged per message".
   *
   * ── meteredNote ──
   *
   * Every other feature in this registry is included in the price of the plan.
   * This one is not: switching it on grants ACCESS to buy, not messages. The note
   * rides with the feature so every surface that lists plan contents — the public
   * pricing page, the payment step's tier cards, the admin toggle — says so in
   * the same words, instead of three places inventing their own caveat or, worse,
   * listing it as though it were included.
   *
   * Grandfathering lives in middleware/smsAddonGate.js: an event that already
   * bought credits keeps sending even if its tier later loses this feature. You
   * do not take away something somebody paid for.
   */
  {
    key: 'sms_campaigns',
    label: 'Text messaging',
    description: 'Lets this plan send invitations, reminders and entry passes by SMS. Access only — messages are bought separately per event.',
    category: 'Campaigns & SMS',
    freeDefault: false,
    meteredNote: 'Charged separately per message',
  },

  // ── Branding ──
  /**
   * `builtIn: false` here is STRUCTURAL, not a to-do. Read this before trying
   * to gate it — the obvious implementation breaks event creation.
   *
   * The capability behind it is `events.custom_colors` / `custom_fonts`, written
   * by the design tab and by the create wizard. Two things stop a per-event gate:
   *
   *   1. AN EVENT HAS NO PLAN WHILE IT IS BEING DESIGNED. The organizer builds
   *      the event as an unpaid draft and picks a tier at checkout, at the END.
   *      So at the only moment the colours are chosen there is no tier to ask,
   *      and gating it for paid events alone is theatre: the design is already
   *      set by the time a plan exists.
   *   2. EVERY SAVE RESUBMITS THEM. EventSettings.handleSave packs custom_colors
   *      and custom_fonts into the body unconditionally, so a naive gate would
   *      403 an organizer changing their venue address.
   *
   * Gating this therefore needs a product decision — most plausibly separating
   * the template's own palettes (free) from the Custom Canvas builder (paid),
   * and moving the plan choice earlier — not a middleware mount. Until then the
   * flag keeps its switch greyed out and off the price list, which is the
   * honest state.
   */
  { key: 'custom_branding',      label: 'Custom themes & branding',     description: 'Apply custom colors, logos, and themes to your RSVP pages.',                         category: 'Branding',          freeDefault: false, builtIn: false },
  /**
   * The watermark has TWO switches in the admin tier editor: the `remove_watermark`
   * checkbox beside "Most Popular", and this entry in the features checklist.
   * Only the checkbox ever did anything — the guest page reads
   * `events.tier_remove_watermark`, snapshotted from `tier.remove_watermark` at
   * purchase, and nothing on the platform read this key. An admin who ticked the
   * obvious one, in the list of everything else the plan includes, shipped the
   * watermark anyway.
   *
   * Rather than delete a switch an admin may already have used, `tierRemovesWatermark()`
   * in utils/tierResolver.js now treats EITHER as granting it, and every write of
   * `tier_remove_watermark` goes through it. That is the whole enforcement: this key
   * is deliberately not a `requireFeature()` gate, because the watermark is a render
   * decision on a public page, not an API call to reject.
   */
  { key: 'remove_watermark',     label: 'Remove Fancy watermark',       description: 'Remove the "Powered by Fancy RSVP" branding from guest-facing pages.',               category: 'Branding',          freeDefault: false },
  /**
   * WHITE LABEL — the guest never learns which company built this.
   *
   * A superset of `remove_watermark`, and enforced through the same one door:
   * `tierRemovesWatermark()` returns true for either, so a white-label plan can
   * never end up with the mark still on the page because somebody forgot the
   * other switch.
   *
   * What it strips, everywhere a GUEST can see:
   *   • the "Powered by Fancy RSVP" mark on the invitation page and the pass;
   *   • the logo lockup, the gold wordmark and the tagline in every event email;
   *   • the "Sent via Fancy RSVP on behalf of the organizer" line.
   * The event's own name takes the wordmark's place, so the email still has a
   * masthead rather than a hole.
   *
   * What it does NOT strip, deliberately:
   *   • THE LEGAL FOOTER. The company name and postal address in event email is
   *     a CAN-SPAM requirement on the sender, and we are the sender — the mail
   *     leaves our infrastructure and our domain. Removing it to look whiter
   *     trades a branding preference for an unlawful email and a deliverability
   *     hit that lands on every customer sharing the sending reputation. It is
   *     set in the smallest muted type in the document; it is disclosure, not
   *     marketing.
   *   • The ORGANIZER's own account mail — verification, password resets,
   *     receipts. Those are genuinely from us to our customer. White-labelling
   *     them would mean sending unbranded security mail, which is how a
   *     password-reset email gets read as phishing.
   *   • A CUSTOM DOMAIN. Guest links stay on the platform domain: that needs DNS
   *     and certificate provisioning per customer, which is infrastructure, not
   *     a feature flag. The description says what the flag actually delivers so
   *     that nobody sells a domain this switch cannot provide.
   */
  { key: 'white_label',          label: 'White-label solution',         description: 'Removes every Fancy mark a guest can see — the invitation page, the entry pass and all event emails carry the host\'s name alone.', category: 'Branding',          freeDefault: false },

  // ── Analytics ──
  { key: 'analytics_basic',      label: 'Basic analytics dashboard',    description: 'View RSVP counts, response rates, and basic event metrics.',                        category: 'Analytics',         freeDefault: true, alwaysOn: true },
  // Enforced INSIDE the response, not on the route: the basic overview is on
  // every plan and lives in the same payload, so 403'ing /analytics to withhold
  // the charts would take the whole dashboard away. analyticsController asks
  // `eventHasFeature` and returns `analytics.advanced: false` with the deep
  // blocks omitted, which is what the page draws its plan lock from.
  { key: 'analytics_advanced',   label: 'Real-time analytics & reports',description: 'Advanced charts, real-time tracking, guest demographics, and PDF reports.',          category: 'Analytics',         freeDefault: false },

  // ── Notifications ──
  { key: 'email_notifications',  label: 'Email notifications',          description: 'Automatic email confirmations and reminders for guests.',                            category: 'Notifications',    freeDefault: true, alwaysOn: true },

  // ── Support ──
  { key: 'support_community',    label: 'Community support',            description: 'Access to community forums and knowledge-base articles.',                            category: 'Support',           freeDefault: true, alwaysOn: true },
  { key: 'support_priority',     label: 'Priority email & chat support',description: 'Faster response times via dedicated email and live chat channels.',                  category: 'Support',           freeDefault: false, builtIn: false },
  { key: 'support_dedicated',    label: 'Dedicated account manager',    description: 'A named account manager for onboarding, strategy, and escalations.',                 category: 'Support',           freeDefault: false, builtIn: false },

  // ── Integrations ──
  { key: 'all_integrations',     label: 'All integrations',             description: 'Access every available third-party integration.',                                    category: 'Integrations',      freeDefault: false, builtIn: false, comingSoon: true },
  { key: 'custom_api',           label: 'Custom integrations & API',    description: 'Build custom integrations using the Fancy RSVP developer API.',                      category: 'Integrations',      freeDefault: false, builtIn: false, comingSoon: true },

  // ── Security ──
  { key: 'sso_team_mgmt',        label: 'SSO & team management',        description: 'Single Sign-On (SAML/OIDC) and multi-user team roles.',                              category: 'Security',          freeDefault: false, builtIn: false, comingSoon: true },
  { key: 'advanced_security',    label: 'Advanced security & compliance',description: 'Audit logs, IP allowlisting, data-residency controls, and SOC 2 readiness.',       category: 'Security',          freeDefault: false, builtIn: false, comingSoon: true },
];

// ── Derived lookups (computed once at require-time) ──

const _byKey = new Map(PLATFORM_FEATURES.map(f => [f.key, f]));

const FEATURE_CATEGORIES = [...new Set(PLATFORM_FEATURES.map(f => f.category))];

const FREE_TIER_FEATURES = new Set(
  PLATFORM_FEATURES.filter(f => f.freeDefault).map(f => f.key),
);

/**
 * Included in EVERY plan, and not removable by unticking it.
 *
 * `entitledFeatures()` unions these into whatever a tier stores, so a paid plan
 * can never grant less than an unpaid event does. Before that union, a tier
 * whose `features` array happened to omit `rsvp_basic` gave a paying customer
 * strictly fewer capabilities than someone who had paid nothing — harmless only
 * for as long as none of these keys was gated, and an outage the moment one was.
 */
const ALWAYS_ON_FEATURES = new Set(
  PLATFORM_FEATURES.filter(f => f.alwaysOn).map(f => f.key),
);

/**
 * The keys a route is expected to gate — i.e. everything that is neither
 * "not built yet" nor "everyone has it". `test/featureCoverage.test.js` asserts
 * each of these is actually mounted somewhere in routes/, so a key can never
 * again sit in the admin UI as a live-looking switch that controls nothing.
 */
const GATED_FEATURES = PLATFORM_FEATURES
  .filter(f => f.builtIn !== false && !f.alwaysOn)
  .map(f => f.key);

/**
 * Keys that must NEVER be printed as a plan bullet on a customer-facing surface.
 *
 * Two kinds, one rule — do not put a promise on a price tag that the product
 * cannot keep:
 *
 *   • `supersededBy` — granted through some other mechanism now, so a bullet
 *     tells a customer they already have what the card is charging for.
 *   • `builtIn: false` — THE CAPABILITY DOES NOT EXIST. A tier carrying
 *     `sso_team_mgmt` in stored config renders "SSO & team management" on the
 *     public pricing page and on the payment step's tier cards, and someone
 *     buys an enterprise plan for a feature nobody has written. The admin UI
 *     disables these toggles and captions them "Not built yet", so no admin can
 *     newly tick one — but config saved before that flag existed still carries
 *     them, and the pricing page went on advertising them regardless.
 *
 * The FLAG itself stays internal (getPublicPricing's own note is right that it
 * is nobody's business outside this repo). The bullet is simply not emitted.
 */
const UNSELLABLE_FEATURES = PLATFORM_FEATURES
  .filter(f => f.supersededBy || f.builtIn === false)
  .map(f => f.key);

/** Is this key safe to print on a plan card a customer is looking at? */
function isSellableFeature(key) {
  const feat = _byKey.get(key);
  return !!feat && !feat.supersededBy && feat.builtIn !== false;
}

/** Returns a Map<category, feature[]> preserving insertion order. */
function getFeaturesByCategory() {
  const map = new Map();
  for (const f of PLATFORM_FEATURES) {
    if (!map.has(f.category)) map.set(f.category, []);
    map.get(f.category).push(f);
  }
  return map;
}

/** Returns the feature definition for a key, or undefined. */
function getFeatureByKey(key) {
  return _byKey.get(key);
}

/**
 * key -> the "this costs extra" caption, for every feature that is access-only.
 *
 * One map, handed to every surface that prints plan contents, so the caveat is
 * worded identically on the public pricing page, the payment step's tier cards
 * and the admin toggle. Without it each of those three invents its own — and the
 * one that forgets lists a metered add-on as though the plan included it.
 */
const FEATURE_NOTES = Object.fromEntries(
  PLATFORM_FEATURES.filter((f) => f.meteredNote).map((f) => [f.key, f.meteredNote]),
);

/** Checks whether a key exists in the registry. */
function isValidFeatureKey(key) {
  return _byKey.has(key);
}

/**
 * Splits an array of keys into { valid, invalid }.
 * Unknown keys are silently stripped on save; the admin UI only offers valid
 * keys, so invalid ones indicate stale data or API misuse.
 */
function validateFeatureKeys(keys) {
  const valid = [];
  const invalid = [];
  for (const k of keys) {
    if (typeof k === 'string' && _byKey.has(k)) valid.push(k);
    else invalid.push(k);
  }
  return { valid, invalid };
}

module.exports = {
  PLATFORM_FEATURES,
  FEATURE_CATEGORIES,
  FREE_TIER_FEATURES,
  ALWAYS_ON_FEATURES,
  GATED_FEATURES,
  UNSELLABLE_FEATURES,
  isSellableFeature,
  FEATURE_NOTES,
  getFeaturesByCategory,
  getFeatureByKey,
  isValidFeatureKey,
  validateFeatureKeys,
};
