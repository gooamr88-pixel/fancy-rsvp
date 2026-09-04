const express = require('express');
const { query } = require('express-validator');
const validate = require('../middleware/validate');
const { downloadEventArchive, keepEventData } = require('../controllers/eventRetentionController');

const router = express.Router();

/**
 * THE POST-EVENT RETENTION LINKS — reached from an email, not from the dashboard.
 *
 * ── WHY THIS IS A SEPARATE ROUTER MOUNTED BEFORE eventRoutes ──
 *
 * `app.use('/api/v1/events', requireAuth, eventRoutes)` applies `requireAuth` to
 * the entire organizer router, so these two cannot live inside it: they are
 * opened from an inbox, on a phone, at whatever hour the deletion warning lands,
 * and a login wall on a 24-hour deadline is a reliable way to ensure the archive
 * is never downloaded.
 *
 * They are authorized by a signed, purpose-scoped, grace-window-expiring token
 * instead (services/tokenService). Mounted at the same `/api/v1/events` prefix
 * but BEFORE the authed router, because Express matches routers in registration
 * order — `/archive` and `/keep` are claimed here, and every other path falls
 * through to `next()` and reaches the organizer API exactly as before.
 *
 * The literal paths must never collide with an `:eventId` route. They cannot:
 * `eventRoutes` matches `/:eventId` only after this router has declined, and no
 * event id is the string "archive" or "keep".
 */

const tokenRule = query('token').isString().isLength({ min: 20, max: 4096 })
  .withMessage('A valid link token is required.');

// Build and stream the full event archive as a multi-sheet .xlsx.
router.get('/archive', [tokenRule, validate], downloadEventArchive);

// Cancel the scheduled deletion for one event.
router.get('/keep', [tokenRule, validate], keepEventData);

module.exports = router;
