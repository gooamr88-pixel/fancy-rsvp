/**
 * Offline-first check-in surface — mounted at /api/v1/checkin.
 *
 * Versioned independently of the organizer API (spec §21.4, amendment A-6) so a
 * breaking change can create /v2 while tablets in the field keep talking to /v1.
 *
 * ── Three auth postures, on purpose (spec §18.1) ──
 *
 *   PUBLIC   /devices/pair, /devices/refresh
 *            The tablet has no credential yet, or a stale one. The pairing code
 *            itself is the credential; strict rate limiting is applied in app.js.
 *
 *   DEVICE   the sync endpoints, via `Authorization: Device <token>`
 *            Scoped to the device's own event by the token, never by the path.
 *
 *   ORGANIZER  provisioning + roster management, via the session cookie
 *            Creating pairing codes and resetting PINs are administrative acts
 *            and must never be reachable with a door tablet's credential.
 *
 * The sync endpoints accept EITHER a device token or an organizer session, so
 * the existing web kiosk and the dashboard keep working against the same API.
 *
 * ── Feature gating: on preparation only ──
 *
 * Check-in is a paid feature, but the gate sits exclusively on the bundle
 * endpoints. A tier change while a device is at a venue must never start
 * 403-ing queued check-ins that exist nowhere else — that is the data loss
 * §21.3 forbids. Decision D-21, enforced here by route placement.
 */
const express = require('express');
const { requireAuth, verifyEventOwner } = require('../middleware/auth');
const { requireAnyFeature } = require('../middleware/featureGate');
const { requireCheckinApp } = require('../middleware/checkinAppGate');
const { requireDevice, requireDeviceOrAuth } = require('../middleware/deviceAuth');
const checkinSync = require('../controllers/checkinSyncController');
const checkinDevice = require('../controllers/checkinDeviceController');

const router = express.Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidParam = (name) => (req, res, next, value) => {
  if (!UUID_REGEX.test(value)) {
    return res.status(400).json({
      success: false, error: 'INVALID_PARAM', message: `${name} must be a valid UUID.`,
    });
  }
  next();
};

/**
 * A check-in reference, which is NOT a uuid and must not be guarded as one.
 *
 * ── WHY THIS PARAMETER IS THE ODD ONE OUT ──
 *
 * `:clientCheckinId` carried `uuidParam` for most of its life, and that single
 * line silently disabled two-device undo for every event on the platform.
 *
 * A tablet can only produce a real uuid for a check-in IT created. Every other
 * arrival it holds was rebuilt locally under an invented key — `seed:<eventId>:
 * <guestId>` for arrivals already recorded when the device was prepared
 * (BundleRepository), `remote:<serverId>` for another gate's (SyncRepository).
 * Those are what it puts in this path segment, and a uuid guard answers all of
 * them with 400 before any handler runs.
 *
 * The damage was not one failed request. `checkinSyncService.undoCheckIn` was
 * deliberately rewritten to accept exactly these keys and resolve the row by
 * `serverId` instead — code the guard made unreachable. Meanwhile the device
 * marks the guest reversed locally BEFORE queueing, and only takes that mark
 * back on a 404, so a 400 left the tablet insisting on a reversal the server
 * had refused, permanently, while its queue entry stalled and blocked closing
 * the event.
 *
 * Nothing downstream needs the guard. `asUuid()` (checkinSyncService.js) is the
 * real validator: it returns null for anything that is not a uuid, so a
 * malformed reference reaches Postgres as NULL rather than as a cast that
 * raises `22P02` — and with neither a usable client id nor a server id the
 * service answers NOT_FOUND, which the device is built to handle.
 *
 * So all this needs to do is refuse input too large to be any legitimate key.
 * The longest real one is `seed:` + two uuids + two colons = 79 characters.
 */
const MAX_CHECKIN_REF_LENGTH = 200;
const checkinRefParam = (req, res, next, value) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CHECKIN_REF_LENGTH) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_PARAM',
      message: `clientCheckinId must be 1–${MAX_CHECKIN_REF_LENGTH} characters.`,
    });
  }
  next();
};

// app.js registers an app.param('eventId') guard, but this router is mounted on
// a path that carries no :eventId at mount time, so the guards are declared here.
router.param('eventId', uuidParam('eventId'));
router.param('clientCheckinId', checkinRefParam);
router.param('deviceId', uuidParam('deviceId'));
router.param('staffId', uuidParam('staffId'));

// Either identity satisfies the event-scoped sync endpoints.
const deviceOrOrganizer = requireDeviceOrAuth([requireAuth, verifyEventOwner]);

// ═══════════════════════════════════════════════════════════
// PUBLIC — device pairing and token refresh
// ═══════════════════════════════════════════════════════════
router.post('/devices/pair', checkinDevice.pairDevice);
router.post('/devices/refresh', checkinDevice.refreshDevice);

// ═══════════════════════════════════════════════════════════
// DEVICE — reports its own local data destroyed (§20.5)
// ═══════════════════════════════════════════════════════════
router.post('/devices/wipe-confirm', requireDevice, checkinDevice.confirmWipe);

// ═══════════════════════════════════════════════════════════
// ORGANIZER — which events can be armed
// ═══════════════════════════════════════════════════════════
// Ungated: an organizer on a free tier still needs the list, and to be told
// what upgrading unlocks.
router.get('/events', requireAuth, checkinSync.listCheckinEvents);

// ═══════════════════════════════════════════════════════════
// ORGANIZER — provisioning and roster (never reachable by a tablet)
// ═══════════════════════════════════════════════════════════
const organizerOnly = [requireAuth, verifyEventOwner];

// Gates come from the seating map (amendment A-17). Listed separately so the
// provisioning UI can state plainly that there are none yet and link to the map
// editor, rather than presenting an empty dropdown.
router.get('/events/:eventId/gates', organizerOnly, checkinDevice.listGates);

/**
 * THE `checkin_app` ENTITLEMENT MOMENT.
 *
 * Until now the only thing `requireFeature('checkin_app')` guarded was the APK
 * download — and the APK is not a secret: the public /checkin-app page links the
 * same static file and says in as many words that installing it needs no
 * account. So the paid door-app feature was enforced by an obstacle anyone could
 * walk around, and an event on a plan without it could pair a tablet and run the
 * door with the app all night.
 *
 * A device cannot exist without a pairing code, and a code cannot be minted
 * without an organizer session on THIS event. That makes this the one place the
 * entitlement is genuinely decidable, so this is where it is asked. Everything
 * downstream — pair, refresh, drain, delta — stays ungated on purpose (decision
 * D-21: a tablet already at a venue must never be locked out mid-event by a
 * tier lookup).
 *
 * `requireCheckinApp` rather than a bare `requireFeature('checkin_app')`: an
 * event that has already paired a tablet keeps pairing spares, even if its plan
 * does not carry the app. See middleware/checkinAppGate.js — the key is seeded
 * on no tier by any migration, so a plain gate would have refused every
 * organizer on the platform the moment it deployed.
 */
router.post(
  '/events/:eventId/devices/pairing-codes',
  organizerOnly,
  requireCheckinApp,
  checkinDevice.createPairingCode,
);
router.get('/events/:eventId/devices', organizerOnly, checkinDevice.listDevices);
router.delete('/events/:eventId/devices/:deviceId', organizerOnly, checkinDevice.revokeDevice);
router.post('/events/:eventId/devices/:deviceId/wipe', organizerOnly, checkinDevice.requestWipe);
router.patch('/events/:eventId/devices/:deviceId/gate', organizerOnly, checkinDevice.reassignGate);

router.post('/events/:eventId/staff', organizerOnly, checkinDevice.createStaff);
router.get('/events/:eventId/staff', organizerOnly, checkinDevice.listStaff);
router.patch('/events/:eventId/staff/:staffId/pin', organizerOnly, checkinDevice.resetStaffPin);
router.delete('/events/:eventId/staff/:staffId', organizerOnly, checkinDevice.deactivateStaff);

// ═══════════════════════════════════════════════════════════
// DEVICE or ORGANIZER — preparation (gated: this is the paid capability)
// ═══════════════════════════════════════════════════════════
router.get(
  '/events/:eventId/bundle/manifest',
  deviceOrOrganizer,
  requireAnyFeature('qr_checkin', 'manual_checkin'),
  checkinSync.getBundleManifest,
);
router.get(
  '/events/:eventId/bundle',
  deviceOrOrganizer,
  requireAnyFeature('qr_checkin', 'manual_checkin'),
  checkinSync.getBundlePage,
);

// ═══════════════════════════════════════════════════════════
// DEVICE or ORGANIZER — live operation and reconciliation
// ═══════════════════════════════════════════════════════════
// Ungated. See the header note and decision D-21: a drain must never fail
// because of a tier lookup.
router.post('/events/:eventId/check-ins', deviceOrOrganizer, checkinSync.postCheckInBatch);
router.get('/events/:eventId/delta', deviceOrOrganizer, checkinSync.getDelta);
// Undo is a privileged action, and a device token does not carry a role — every
// usher's tablet has one. The handler resolves the acting staff against the
// event roster and requires a supervisor before it will reverse anything (§18.2).
router.delete('/events/:eventId/check-ins/:clientCheckinId', deviceOrOrganizer, checkinSync.deleteCheckIn);

// Guest-data delta (§19.4). Ungated for the same reason as the drain: a device
// already at a venue must be able to pick up a table change even if the event's
// tier lookup would now fail.
router.get('/events/:eventId/guest-delta', deviceOrOrganizer, checkinSync.getGuestDelta);

// Emergency controls (§21.5). Devices READ them on every sync; only an
// organizer/admin may SET them.
router.get('/events/:eventId/controls', deviceOrOrganizer, checkinSync.getControls);
router.patch('/events/:eventId/controls', organizerOnly, checkinSync.setControls);

// ═══════════════════════════════════════════════════════════
// ORGANIZER — conflicts and anomalies (§5.3 L4, §19.5)
// ═══════════════════════════════════════════════════════════
// Organizer-only: these expose guest names alongside who admitted them, which a
// door tablet has no reason to pull in bulk.
router.param('conflictId', uuidParam('conflictId'));
router.get('/events/:eventId/conflicts', organizerOnly, checkinSync.getConflicts);
router.post('/events/:eventId/conflicts/:conflictId/resolve', organizerOnly, checkinSync.resolveConflict);

// ═══════════════════════════════════════════════════════════
// ORGANIZER — post-event attendance report (§9.7)
// ═══════════════════════════════════════════════════════════
// Organizer-only: it is a full attendance record of a private event, and a door
// tablet has no business being able to pull one. Gated like the other exports.
router.get(
  '/events/:eventId/report',
  organizerOnly,
  requireAnyFeature('qr_checkin', 'manual_checkin'),
  checkinSync.getReport,
);

module.exports = router;
