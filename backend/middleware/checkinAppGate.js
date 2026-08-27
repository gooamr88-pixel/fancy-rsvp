/**
 * DOOR APP ACCESS GATE — may this event put the Android app on a tablet?
 *
 * ── Why the download gate was not one ──
 *
 * `checkin_app` is a paid registry feature, and for its whole life the only
 * thing that asked for it was `GET /checkin-app/download`. The APK is not a
 * secret: the public /checkin-app marketing page links the same static file
 * from the web root and says, in as many words, that installing it needs no
 * account — and the dashboard card falls back to that URL too. So the gate
 * guarded a door standing next to an open one, and the app was in practice
 * included with every plan that had check-in at all.
 *
 * A tablet cannot pair without a pairing code, and a code cannot be minted
 * without an organizer session on this event. That is the one moment the
 * entitlement is genuinely decidable, so it is where it is asked.
 *
 * ── GRANDFATHERING, and why it comes first ──
 *
 * Mirrors middleware/smsAddonGate.js deliberately. `checkin_app` has
 * `freeDefault: false` and is seeded on NO tier by any migration — it is
 * assigned by hand in Admin -> Config -> Subscription Tiers. So on the day this
 * gate ships, a deployment where nobody has assigned it yet would refuse every
 * organizer on the platform, including the ones already running the app.
 *
 * An event that has ALREADY paired a device therefore keeps pairing more. The
 * concrete case is not theoretical and not rare: a tablet dies at the venue and
 * a spare has to be paired during the event. Refusing that mid-event, over a
 * config field an admin has not filled in yet, breaks a door that was working
 * ten minutes ago — a far worse failure than an ungated one, and the same
 * judgement the SMS gate makes about an allowance somebody already bought.
 *
 * The grandfather is per EVENT and events are short-lived, so it drains on its
 * own: the next event the organizer creates asks the plan properly.
 *
 * Everything downstream of pairing — pair, refresh, drain, delta, controls —
 * stays ungated on purpose (spec decision D-21: a device already at a venue
 * must never be locked out by a tier lookup).
 */

const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const { getPlatformConfig } = require('../utils/configCache');
const { getFeatureByKey } = require('../config/featureRegistry');
const { entitledFeatures, selectEventWithTier } = require('../utils/tierResolver');

/** The registry key an admin assigns per tier to sell the door app. */
const CHECKIN_APP_FEATURE_KEY = 'checkin_app';

/** Has this event ever had a device pair successfully? */
async function hasPairedDevice(eventId) {
  const { data, error } = await supabase
    .from('event_devices')
    .select('id')
    .eq('event_id', eventId)
    .limit(1);

  // A failed lookup grandfathers rather than denies. This branch exists to
  // avoid stranding a working door, so an unanswerable question must not be
  // the thing that strands one — the tier check below still has to pass for
  // any event that has never paired anything.
  if (error) {
    logger.warn({ err: error, eventId }, 'checkinAppGate: device lookup failed — treating as paired');
    return true;
  }
  return Array.isArray(data) && data.length > 0;
}

const requireCheckinApp = async (req, res, next) => {
  const { eventId } = req.params;

  // Super admins bypass, mirroring requireFeature and the RBAC middleware.
  if (req.user?.isSuperAdmin) return next();

  try {
    const { data: event, error } = await selectEventWithTier(
      supabase, eventId, 'id, is_paid, manual_override, status');

    if (error || !event) {
      return res.status(404).json({
        success: false,
        error: 'EVENT_NOT_FOUND',
        message: 'Event not found.',
      });
    }

    // ① Comped events have always meant full access.
    if (event.manual_override) {
      req.event = event;
      return next();
    }

    // ② Does the plan carry the app? Asked BEFORE the grandfather check, even
    //    though grandfathering is what makes this gate safe to ship.
    //
    //    The two are a plain OR — pass if the plan grants it or a tablet is
    //    already paired — so the order cannot change who gets in, only what it
    //    costs to find out. The tier answer comes from a 30s-cached config; the
    //    grandfather answer is a database round trip on a table that is empty
    //    for most events. Asking the cheap question first means an entitled
    //    organizer never pays for the expensive one, and the fail-open branch
    //    inside hasPairedDevice is never even reached for them.
    //
    //    (smsAddonGate checks its grandfather first because there the evidence
    //    is a column already loaded on the event, so it is free.)
    let planHasApp = false;
    try {
      const config = await getPlatformConfig();
      planHasApp = entitledFeatures(config.pricing_tiers, event)
        .features.includes(CHECKIN_APP_FEATURE_KEY);
    } catch (configErr) {
      // Fail CLOSED on an unverifiable entitlement, same as featureGate.
      logger.error({ err: configErr, eventId }, 'checkinAppGate: tier lookup failed — denying');
      return res.status(500).json({
        success: false,
        error: 'CONFIG_ERROR',
        message: 'Could not verify door-app access. Please try again.',
      });
    }

    if (planHasApp) {
      req.event = event;
      return next();
    }

    // ③ The plan does not carry it — but an event already running the app keeps
    //    pairing spares. See the grandfathering note in the header.
    if (await hasPairedDevice(eventId)) {
      req.event = event;
      return next();
    }

    const feat = getFeatureByKey(CHECKIN_APP_FEATURE_KEY);
    return res.status(403).json({
      success: false,
      error: 'FEATURE_NOT_AVAILABLE',
      feature: CHECKIN_APP_FEATURE_KEY,
      featureLabel: feat?.label || 'Fancy Check-in app',
      message: `Your current plan${event.tier_name ? ` ('${event.tier_name}')` : ''} does not include the Fancy Check-in door app. Upgrade your plan to pair a tablet for this event.`,
      currentTier: event.tier_name || null,
      upgrade_action: 'upgrade_plan',
    });
  } catch (err) {
    logger.error({ err, eventId }, 'checkinAppGate: unexpected error');
    return next(err);
  }
};

// Only the middleware is exported. smsAddonGate also exports its key, but that
// is because two controllers genuinely read it; exporting this one "for
// symmetry" would just be an unused export waiting to be mistaken for an API.
module.exports = { requireCheckinApp };
