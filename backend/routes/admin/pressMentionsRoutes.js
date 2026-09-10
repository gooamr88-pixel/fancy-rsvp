const express = require('express');
const { registerUuidParams } = require('../../middleware/uuidParam');
const { requirePermission } = require('../../middleware/permissions');
const { listPressMentions, createPressMention, updatePressMention, deletePressMention } = require('../../controllers/admin/pressMentionsController');

// requireAuth is applied by the parent admin router.
const router = express.Router();


// Identifier guards. app.param() in app.js does NOT fire for parameters
// declared inside a mounted router — see middleware/uuidParam.js.
registerUuidParams(router, ['pressMentionId']);
router.get('/', requirePermission('cms.view'), listPressMentions);
router.post('/', requirePermission('cms.manage'), createPressMention);
router.patch('/:pressMentionId', requirePermission('cms.manage'), updatePressMention);
router.delete('/:pressMentionId', requirePermission('cms.manage'), deletePressMention);

module.exports = router;
