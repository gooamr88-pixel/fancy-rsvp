const express = require('express');
const rsvpController = require('../controllers/rsvpController');
const { requireFeature } = require('../middleware/featureGate');

const router = express.Router({ mergeParams: true });

// UUID format validation for :partyId param
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.param('partyId', (req, res, next, value) => {
  if (!UUID_REGEX.test(value)) {
    return res.status(400).json({ success: false, error: 'INVALID_PARAM', message: 'partyId must be a valid UUID.' });
  }
  next();
});

// Route to fetch the party list for an event (free — read-only, always allowed)
router.get('/', rsvpController.getRSVPs);

// Route to manually add a guest (organizer) — paid feature
router.post('/', requireFeature('add_guest_manual'), rsvpController.addGuestManually);

// Route to import guests via CSV upload — paid feature
router.post('/import', requireFeature('import_guests_csv'), rsvpController.importGuestsCSV);

// Route to fetch aggregated RSVP statistics for the dashboard cards (free)
router.get('/stats', rsvpController.getRsvpStats);

/**
 * The dashboard's 20-second poll target.
 *
 * Mounted BEFORE '/:partyId' for the same reason '/clear-preview' is: Express
 * matches in order, and '/:partyId' would otherwise swallow '/version' and hand
 * the string "version" to a UUID validator.
 *
 * Free and read-only — it is the cheap substitute for re-downloading the list,
 * so gating it behind a paid feature would push callers straight back to the
 * expensive path this exists to avoid.
 */
router.get('/version', rsvpController.getRsvpsVersion);

// Route to export guests to downloadable CSV stream — paid feature
router.get('/export', requireFeature('guest_export_csv'), rsvpController.exportGuestsCSV);

// Route to export guests to downloadable Excel stream — paid feature
router.get('/export-excel', requireFeature('guest_export_excel'), rsvpController.exportGuestsExcel);

// What clearing the whole list would remove — read-only, powers the confirm dialog.
router.get('/clear-preview', rsvpController.previewClearGuests);

/**
 * Clear the entire guest list.
 *
 * Mounted BEFORE '/:partyId' deliberately. Express matches in order, and while
 * these two cannot actually collide today (the param route is a DELETE on a
 * sub-path, and :partyId is UUID-validated above), keeping the specific route
 * above the parameterised one is the rule that stops the next added path from
 * being swallowed silently.
 *
 * Free, like the single delete: removing your own data must never be gated
 * behind a plan. The confirmation guards live in the controller.
 */
router.delete('/', rsvpController.deleteAllRSVPs);

// Route to update a single party (organizer edit — free, basic RSVP management)
router.patch('/:partyId', rsvpController.updateRSVP);

// Route to delete a single party (free — basic management)
router.delete('/:partyId', rsvpController.deleteRSVP);

module.exports = router;
