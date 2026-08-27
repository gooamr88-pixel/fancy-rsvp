const express = require('express');
const { createTable, getTables, updateTablePositions, deleteTable, updateTable, duplicateTable } = require('../controllers/tableController');
const { requireAnyFeature } = require('../middleware/featureGate');

const router = express.Router({ mergeParams: true });

/**
 * EITHER key opens the table editor.
 *
 * `table_management` is a registry feature with its own per-tier toggle, and it
 * was mounted NOWHERE — every write below asked for `seating_map`. So a plan
 * sold on "Table management" and nothing else had no tables at all, while the
 * toggle sat in the admin UI looking like it did something. Making it an
 * either/or rather than replacing `seating_map` matters: every tier already
 * configured grants seating_map, and swapping the key would have revoked the
 * table editor from all of them at once, on deploy.
 */
const requireTableAccess = requireAnyFeature('seating_map', 'table_management');

// UUID format validation for :tableId param
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.param('tableId', (req, res, next, value) => {
  if (!UUID_REGEX.test(value)) {
    return res.status(400).json({ success: false, error: 'INVALID_PARAM', message: 'tableId must be a valid UUID.' });
  }
  next();
});

// Route to fetch all tables with seating occupancy
router.get('/', getTables);

// Route to create a new table
router.post('/', requireTableAccess, createTable);

// Route to save visual coordinates layout changes
router.patch('/positions', requireTableAccess, updateTablePositions);

// Route to update table settings
router.patch('/:tableId', requireTableAccess, updateTable);

// Route to duplicate a table
router.post('/:tableId/duplicate', requireTableAccess, duplicateTable);

// Route to delete an empty table
router.delete('/:tableId', requireTableAccess, deleteTable);

module.exports = router;
