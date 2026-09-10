const express = require('express');
const { registerUuidParams } = require('../../middleware/uuidParam');
const rateLimit = require('express-rate-limit');
const { requirePermission } = require('../../middleware/permissions');
const {
  getUserDetail,
  setUserStatus,
  listUserSessions,
  revokeUserSession,
  resetOrganizerPassword,
  impersonateOrganizer,
} = require('../../controllers/admin/userMgmtController');

// requireAuth is applied by the parent admin router.
const router = express.Router();


// Identifier guards. app.param() in app.js does NOT fire for parameters
// declared inside a mounted router — see middleware/uuidParam.js.
registerUuidParams(router, ['userId', 'sessionId']);
// Caps the blast radius if an admin token is compromised — these two actions
// (issuing a temp password, minting an impersonation session) are the most
// sensitive mutations in the admin surface.
const sensitiveActionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Please try again after a minute.' },
});

// ── Users (§4) ──
router.get('/users/:userId', requirePermission('users.view'), getUserDetail);
router.patch('/users/:userId/status', requirePermission('users.manage'), setUserStatus);
router.get('/users/:userId/sessions', requirePermission('users.sessions'), listUserSessions);
router.post('/users/:userId/sessions/:sessionId/revoke', requirePermission('users.sessions'), revokeUserSession);

// ── Organizers (§5) ──
router.get('/organizers/:userId', requirePermission('organizers.view'), getUserDetail);
router.patch('/organizers/:userId/status', requirePermission('organizers.manage'), setUserStatus);
router.post('/organizers/:userId/reset-password', sensitiveActionLimiter, requirePermission('organizers.manage'), resetOrganizerPassword);
router.post('/organizers/:userId/impersonate', sensitiveActionLimiter, requirePermission('organizers.impersonate'), impersonateOrganizer);

module.exports = router;
