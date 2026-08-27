/* ═══════════════════════════════════════════════════════════════
   Fancy Check-in — the published Android build.

   ── Two download paths, and they are not interchangeable ─────────────────
   PUBLIC (this file): a signed APK served straight off the web root at
   `/download/fancy-checkin.apk`. Anyone may take it. That is safe because
   installing the app grants nothing — it is inert until it is paired to an
   event, and a tablet cannot pair without a code, which only an organizer on
   an entitled plan can mint: `requireFeature('checkin_app')` sits on
   POST /checkin/events/:eventId/devices/pairing-codes.

   That sentence was written here before it was true. For a while the ONLY
   `checkin_app` gate on the platform was the download endpoint below — which
   this very file routes around, by design and on a public marketing page — so
   the paid door app was, in practice, included with every plan that had
   check-in at all. The entitlement lives at the door now, as claimed.

   GATED (`controllers/checkinAppController.js`): an event-scoped 302 to a
   120-second signed Supabase Storage URL, which writes an audit row and is
   what the dashboard uses. Untouched by this file.

   The public URL had existed since the first deploy and appeared NOWHERE in
   this repository — the marketing page told readers to fetch the app from a
   dashboard they might not have, and the one link that actually worked was
   written down only in notes. This module is so there is one place to change
   when a new build is published.
   ═══════════════════════════════════════════════════════════════ */

/** Served by nginx from the web root — not the API, and not Storage. */
export const CHECKIN_APK_URL = 'https://fancyrsvp.com/download/fancy-checkin.apk';

/**
 * The registry label for `checkin_app`, verbatim.
 *
 * The public pricing endpoint renders a tier's features by LABEL
 * (paymentController -> getFeatureByKey(key).label), so this is how a plan is
 * recognised as carrying the door app on the client — matching on the key
 * would find nothing, because keys never reach the browser. Exported rather
 * than repeated: two screens now say which plans include it, and a second copy
 * of a string that has to match the backend registry character-for-character
 * is a silent "Not included in this event's plan" waiting to happen.
 */
export const CHECKIN_APP_FEATURE_LABEL = 'Fancy Check-in app (offline door scanner)';

/**
 * Rounded, and deliberately approximate.
 *
 * It exists so nobody starts a large download on event-day mobile data
 * without warning. An exact byte count would have to be re-measured on every
 * publish and would be wrong far more often than "about 60 MB" is.
 */
export const CHECKIN_APK_SIZE_LABEL = 'about 60 MB';

/**
 * From `android/app/build.gradle.kts` → `minSdk = 26`. API 26 is Android 8.0
 * (Oreo). Keep the two in step: this is a promise made to somebody standing in
 * a shop deciding which tablet to buy.
 */
export const CHECKIN_MIN_ANDROID = 'Android 8.0 or later';

/**
 * NO VERSION STRING HERE, ON PURPOSE.
 *
 * `build.gradle.kts` is the version this repository would BUILD; it is not
 * necessarily the version the web root is SERVING. Those two have already
 * drifted once (a deploy shipped a versionCode identical to its predecessor,
 * so no tablet could tell them apart). A marketing page naming the wrong
 * version is worse than one naming none, and nothing a customer does depends
 * on knowing it — the app self-reports its build in Menu → About.
 *
 * If you want a version on the page, publish it from the release config the
 * server actually reads, not from source.
 */

/** The screens shown on /checkin-app, rendered from the app's own design. */
export const CHECKIN_SCREENS = [
  {
    src: '/images/checkin/welcome.webp',
    alt: 'The Fancy Check-in scan result: a guest name, their party, meal and access note on the left, and their table number set large on the right.',
    caption: 'The moment a pass is scanned',
  },
  {
    src: '/images/checkin/vip.webp',
    alt: 'The same screen for a VIP guest, on a bronze ground with the table number in foil.',
    caption: 'A VIP arrival, marked without shouting',
  },
];
