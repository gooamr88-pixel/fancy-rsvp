const express = require('express');
const { registerUuidParams } = require('../../middleware/uuidParam');
const { requirePermission } = require('../../middleware/permissions');
const { listTestimonials, createTestimonial, updateTestimonial, deleteTestimonial } = require('../../controllers/admin/testimonialsController');

// requireAuth is applied by the parent admin router.
const router = express.Router();


// Identifier guards. app.param() in app.js does NOT fire for parameters
// declared inside a mounted router — see middleware/uuidParam.js.
registerUuidParams(router, ['testimonialId']);
router.get('/', requirePermission('cms.view'), listTestimonials);
router.post('/', requirePermission('cms.manage'), createTestimonial);
router.patch('/:testimonialId', requirePermission('cms.manage'), updateTestimonial);
router.delete('/:testimonialId', requirePermission('cms.manage'), deleteTestimonial);

module.exports = router;
