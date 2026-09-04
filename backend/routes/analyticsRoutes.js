const express = require('express');
const router = express.Router();
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
