const express = require('express');
/**
 * `mergeParams` IS LOAD-BEARING. This router is mounted under a path that
 * carries a param — /api/v1/events/:eventId/analytics — and an Express 4 child
 * router REPLACES req.params with its own matched params on the way in. Without
 * this flag `req.params.eventId` is `undefined` by the time the controller runs.
 *
 * That failure was silent and total, which is why it is worth a comment rather
 * than just a flag. Every Supabase query in the controller became
 * `.eq('event_id', undefined)`, PostgREST rejected the UUID cast, and the
 * controller discards those errors (`{ data }` destructured without `error`) —
 * so the endpoint answered 200 with every figure at zero. Worse,
 * `eventHasFeature(undefined, 'analytics_advanced')` cannot find the event and
 * withholds, so `advanced: false` came back for organizers who were paying for
 * it and the page drew the upgrade padlock over their own analytics.
 *
 * Ownership was never affected: verifyEventOwner runs at the app.use layer,
 * where req.params.eventId still exists.
 *
 * Every sibling router on this prefix — seating, notifications, checkin,
 * checkin-app, rsvps, tables, campaigns, invitations, fields — already sets it.
 * This one was the only exception.
 */
const router = express.Router({ mergeParams: true });
const { getEventAnalytics } = require('../controllers/analyticsController');

/**
 * Organizer analytics routes — mounted at /api/v1/events/:eventId/analytics
 * Protected by requireAuth + verifyEventOwner in app.js
 */

// Full analytics dashboard data
router.get('/', getEventAnalytics);

// `GET /maybe-guests` was here and is gone — no caller anywhere, no test, no
// screen. See the note in analyticsController.js.

module.exports = router;
