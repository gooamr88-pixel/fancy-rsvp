const express = require('express');
const rateLimit = require('express-rate-limit');
const { uploadAsset, MAX_INPUT_BYTES, ACCEPTED } = require('../controllers/uploadController');

const router = express.Router();

/**
 * Raw bytes, not multipart and not base64.
 *
 * multipart would need a new dependency (multer/busboy) to parse one file per
 * request, and base64-in-JSON inflates every upload by a third — on the exact
 * axis, egress, that this whole piece of work exists to reduce. `express.raw`
 * is built in and hands the controller a Buffer.
 *
 * The type list is the parser's filter as well as the controller's: a body with
 * an unlisted Content-Type is never read into memory at all, so an
 * `application/zip` never gets buffered before being rejected.
 */
const rawImage = express.raw({
  type: (req) => ACCEPTED.has((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()),
  limit: MAX_INPUT_BYTES,
});

/**
 * Tighter than the global 1000/15min, because this one costs CPU.
 *
 * Every accepted request runs a sharp resize+encode, which is the only
 * genuinely expensive thing this API does per request. 120/15min is far above
 * a person filling in a gallery (the multi-file picker uploads sequentially)
 * and well below anything that would keep a core busy.
 */
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'TOO_MANY_REQUESTS', message: 'Too many uploads. Please wait a moment.' },
});

// `requireAuth` is applied by app.js at the mount point, so every route here is
// already behind a session — there is no unauthenticated path into this router.
router.post('/:kind', uploadLimiter, rawImage, uploadAsset);

module.exports = router;
