const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireCheckinApp } = require('../middleware/checkinAppGate');
const checkinAppController = require('../controllers/checkinAppController');

const router = express.Router({ mergeParams: true });

// Each hit mints a signed URL for a ~60 MB object. An organizer needs one per
// tablet, and a venue might set up a handful — generous enough for that, tight
// enough that a leaked session cannot be used to farm signed links.
const downloadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'TOO_MANY_REQUESTS', message: 'Too many download requests. Please try again later.' },
});

// Both gated on `checkin_app` — the plan entitlement. Availability of the build
// itself is a separate switch inside the controller, because "your plan does
// not include this" and "this is not open yet" are different answers and the
// dashboard renders them differently.
//
// `requireCheckinApp`, the same middleware that guards pairing, rather than a
// bare requireFeature: ONE answer to "may this event use the door app", or the
// dashboard shows a padlock over a tablet that is already scanning guests. The
// grandfather clause lives there — an event that has paired a device keeps
// downloading the build for its spares.
router.get('/release', requireCheckinApp, checkinAppController.getRelease);
router.get('/download', downloadLimiter, requireCheckinApp, checkinAppController.downloadApk);

module.exports = router;
