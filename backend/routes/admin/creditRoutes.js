const express = require('express');
const { registerUuidParams } = require('../../middleware/uuidParam');
const { requirePermission } = require('../../middleware/permissions');
const { listPackages, createPackage, updatePackage, deletePackage } = require('../../controllers/admin/creditController');

// requireAuth is applied by the parent admin router.
const router = express.Router();


// Identifier guards. app.param() in app.js does NOT fire for parameters
// declared inside a mounted router — see middleware/uuidParam.js.
registerUuidParams(router, ['packageId']);
router.get('/packages', requirePermission('credits.view'), listPackages);
router.post('/packages', requirePermission('credits.manage'), createPackage);
router.patch('/packages/:packageId', requirePermission('credits.manage'), updatePackage);
router.delete('/packages/:packageId', requirePermission('credits.manage'), deletePackage);

module.exports = router;
