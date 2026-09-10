const express = require('express');
const { registerUuidParams } = require('../../middleware/uuidParam');
const { requirePermission } = require('../../middleware/permissions');
const { listContactInquiries, respondToInquiry, updateInquiryStatus } = require('../../controllers/admin/contactInquiriesController');

// requireAuth is applied by the parent admin router.
const router = express.Router();


// Identifier guards. app.param() in app.js does NOT fire for parameters
// declared inside a mounted router — see middleware/uuidParam.js.
registerUuidParams(router, ['inquiryId']);
router.get('/', requirePermission('marketing.view'), listContactInquiries);
router.post('/:inquiryId/respond', requirePermission('marketing.manage'), respondToInquiry);
router.patch('/:inquiryId/status', requirePermission('marketing.manage'), updateInquiryStatus);

module.exports = router;
