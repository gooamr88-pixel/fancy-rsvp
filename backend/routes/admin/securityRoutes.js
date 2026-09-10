const express = require('express');
const { registerUuidParams } = require('../../middleware/uuidParam');
const { requirePermission } = require('../../middleware/permissions');
const { listAuditLogs } = require('../../controllers/admin/auditController');
const { listActiveSessions, revokeSession, listSecurityEvents, listLoginHistory } = require('../../controllers/admin/securityController');
const { getSystemHealth } = require('../../controllers/admin/systemHealthController');

// requireAuth is applied by the parent admin router. This file groups the
// governance surfaces: audit (§17), security (§19) and health (§20).
const router = express.Router();


// Identifier guards. app.param() in app.js does NOT fire for parameters
// declared inside a mounted router — see middleware/uuidParam.js.
registerUuidParams(router, ['sessionId']);
// ── Audit (§17) ──
router.get('/audit', requirePermission('audit.view'), listAuditLogs);

// ── Security (§19) ──
router.get('/security/sessions', requirePermission('security.view'), listActiveSessions);
router.post('/security/sessions/:sessionId/revoke', requirePermission('security.manage'), revokeSession);
router.get('/security/events', requirePermission('security.view'), listSecurityEvents);
router.get('/security/login-history', requirePermission('security.view'), listLoginHistory);

// ── System Health (§20) ──
router.get('/health', requirePermission('health.view'), getSystemHealth);

module.exports = router;
