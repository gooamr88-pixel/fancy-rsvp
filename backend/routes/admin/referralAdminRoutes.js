const express = require('express');
const { requirePermission } = require('../../middleware/permissions');
const { listReferrals, updateReferralConfig, adjustCredit } = require('../../controllers/admin/referralAdminController');

// requireAuth is applied by the parent admin router.
const router = express.Router();

// No `registerUuidParams` here on purpose: every route below is a fixed path,
// so this router declares no route parameters at all. Registering guards for
// names it does not use would be the same mistake app.js made — a list that
// reads as coverage and enforces nothing. Add them alongside the first
// parameterised route, not before it.
router.get('/', requirePermission('marketing.view'), listReferrals);
router.patch('/config', requirePermission('marketing.manage'), updateReferralConfig);
router.post('/adjust', requirePermission('marketing.manage'), adjustCredit);

module.exports = router;
