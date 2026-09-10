const crypto = require('crypto');
const sharp = require('sharp');
const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const { sendOk, sendFail } = require('../utils/responseEnvelope');

/* ═══════════════════════════════════════════════════════════════════════════
   SERVER-SIDE UPLOAD

   ── THE THREE PROBLEMS THIS ONE ENDPOINT CLOSES ──

   Until now the browser uploaded straight to Supabase Storage with the anon key
   (frontend/src/app/admin/_lib/uploadImage.js and three other call sites). That
   arrangement produced all three of the following, and no amount of tidying the
   front end fixes any of them.

   1. ANYONE COULD WRITE TO THE BUCKET.
      `allow_insert_images` grants INSERT to `anon`, and the anon key ships in
      the browser bundle. It could not simply be revoked, because this platform
      does not use Supabase Auth — no organizer ever holds a Supabase JWT (MAU
      reads 0), so every upload the product makes IS anonymous. The policy was
      load-bearing. Routing uploads through here, authenticated by the app's own
      session and executed with the service role, is what finally makes that
      grant removable.

   2. NOTHING WAS EVER COMPRESSED.
      The old path capped a file at 8 MB and sent it as-is. Measured 2026-09-10:
      gallery averaged 1,469 kB (max 7,994 kB), covers 1,610 kB (max 6,708 kB).
      A guest opening one invitation pulled ~15 MB, and 8.7 GB of egress in six
      days is what got this project's services restricted.

   3. THE SAME FILE WAS STORED OVER AND OVER.
      19 music files hashed to 10 distinct ones — one track had FIVE identical
      copies, 49.3 MB of the 82.8 MB. Because every upload minted a fresh
      `wizard-<timestamp>` name, two organizers choosing the same song produced
      two files, forever.

   ── WHY THE FILENAME IS A HASH OF THE PROCESSED BYTES ──

   It makes de-duplication a property of the system rather than a cleanup job.
   Identical content lands on an identical key, the upsert is a no-op, and the
   fifth copy of a popular track costs nothing. It also makes this endpoint
   idempotent: a retry after a dropped connection cannot create a second object.

   The hash is taken AFTER processing, not before, so two different originals
   that normalise to the same output (the same photo saved twice at different
   JPEG qualities, re-encoded here to the same WebP) also collapse.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Where each kind of asset lives, and how big it is allowed to be on the way in.
 *
 * A closed list, not a caller-supplied path. `pathPrefix` used to come from the
 * front end, which means the front end chose where to write — fine when the
 * only writer was our own code, and an arbitrary-write primitive the moment
 * this endpoint is reachable with a session cookie.
 */
const KINDS = {
  cover: { folder: 'covers', maxWidth: 1600 },
  gallery: { folder: 'gallery', maxWidth: 2000 },
  portrait: { folder: 'portraits', maxWidth: 1600 },
  logo: { folder: 'logos', maxWidth: 600 },
  seal: { folder: 'seals', maxWidth: 600 },
  'invitation-bg': { folder: 'invitation-bg', maxWidth: 2000 },
  venue: { folder: 'venues', maxWidth: 1600 },
  shop: { folder: 'shop', maxWidth: 1600 },
  'shop-category': { folder: 'shop-categories', maxWidth: 1600 },
  'blog-cover': { folder: 'blog-covers', maxWidth: 1600 },
  testimonial: { folder: 'testimonials', maxWidth: 800 },
  'press-logo': { folder: 'press-logos', maxWidth: 600 },

  /**
   * ── AUDIO IS STORED, NOT TRANSCODED, AND THAT IS DELIBERATE ──
   *
   * `music` exists here for one reason: to get background-music uploads OFF the
   * anon key. Until every writer goes through this endpoint, `allow_insert_images`
   * cannot be revoked — and leaving one upload path on anon would keep the
   * bucket world-writable while looking fixed.
   *
   * It does NOT re-encode. That needs ffmpeg on the server, which is a deploy
   * dependency and a separate decision, and the offline pass
   * (backend/scripts/reencode-audio.js) has already dealt with the 83 MB
   * already in the bucket.
   *
   * The content-hash filename still applies, and for audio it is the bigger win
   * of the two: the measured bucket held 19 music files that hashed to 10
   * distinct ones — five identical copies of a single track — precisely because
   * every upload minted a fresh `wizard-<timestamp>` name. From here on, the
   * second organizer to pick that song reuses the first one's object.
   */
  music: { folder: 'music', audio: true },
};

/** 12 MB of raw upload. Generous for a phone photo; the output is a fraction. */
const MAX_INPUT_BYTES = 12 * 1024 * 1024;

/**
 * GIFs are stored as-is — sharp would flatten an animation to one frame — so
 * they are the only input whose STORED size equals its uploaded size. They get
 * their own ceiling because 12 MB of that is served to every guest, uncompressed
 * and forever.
 */
const MAX_GIF_BYTES = 3 * 1024 * 1024;

const ACCEPTED_IMAGE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/tiff']);
const ACCEPTED_AUDIO = new Set(['audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac', 'audio/webm']);
const ACCEPTED = new Set([...ACCEPTED_IMAGE, ...ACCEPTED_AUDIO]);

/** mp3 is 'audio/mpeg'; the rest map cleanly off the subtype. */
const AUDIO_EXT = {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav',
  'audio/x-wav': 'wav', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'weba',
};

/**
 * POST /api/v1/uploads/:kind
 * Body: the raw image bytes. Content-Type must be one of ACCEPTED.
 */
const uploadAsset = async (req, res, next) => {
  const kind = KINDS[req.params.kind];
  if (!kind) {
    return sendFail(res, {
      status: 400,
      error: 'UNKNOWN_KIND',
      message: `kind must be one of: ${Object.keys(KINDS).join(', ')}`,
    });
  }

  const contentType = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();

  /**
   * The kind decides which family is allowed, not just whether the type is on
   * some global list. Otherwise `POST /uploads/logo` with an mp3 body would
   * happily store an audio file in `logos/` — accepted, hashed, and served as a
   * broken image forever after.
   */
  const wantsAudio = kind.audio === true;
  const allowed = wantsAudio ? ACCEPTED_AUDIO : ACCEPTED_IMAGE;
  if (!allowed.has(contentType)) {
    return sendFail(res, {
      status: 415,
      error: 'UNSUPPORTED_TYPE',
      message: wantsAudio
        ? 'Upload an MP3, OGG, WAV, M4A or AAC audio file.'
        : 'Upload a JPEG, PNG, WebP, AVIF, GIF or TIFF image.',
    });
  }

  const input = req.body;
  if (!Buffer.isBuffer(input) || input.length === 0) {
    return sendFail(res, { status: 400, error: 'EMPTY_BODY', message: 'No image data was received.' });
  }
  if (input.length > MAX_INPUT_BYTES) {
    return sendFail(res, {
      status: 413,
      error: 'FILE_TOO_LARGE',
      message: `That image is ${(input.length / 1048576).toFixed(1)} MB. The limit is ${MAX_INPUT_BYTES / 1048576} MB.`,
    });
  }

  try {
    /**
     * An animated GIF is passed through untouched.
     *
     * sharp would flatten it to a single frame, and an animation that stops
     * moving reads as a broken image rather than a small one — the same
     * reasoning as the GIF guard in frontend/src/app/utils/assetUrl.js. Rare
     * enough not to be worth an animated-WebP pipeline; common enough that
     * silently killing it would be a bug somebody eventually reports.
     */
    let output;
    let outType;
    let outExt;

    if (wantsAudio) {
      // Stored as uploaded. See the note on the `music` kind above.
      output = input;
      outType = contentType;
      outExt = AUDIO_EXT[contentType] || 'bin';
    } else if (contentType === 'image/gif' && input.length > MAX_GIF_BYTES) {
      /**
       * A GIF is passed through unprocessed (see below), which means it is the
       * ONE format that escapes every size reduction this endpoint exists to
       * apply. At the 12 MB ceiling that is a 12 MB animation delivered to every
       * guest who opens the invitation — precisely the egress that got this
       * project's services restricted, arriving through the very endpoint built
       * to stop it.
       *
       * So GIFs get their own, much tighter ceiling. Rejected with a message
       * that names the real fix, because "too large" alone invites the organizer
       * to re-export the same animation slightly smaller and try again.
       */
      return sendFail(res, {
        status: 413,
        error: 'GIF_TOO_LARGE',
        message: `Animated images can't be compressed here, so they are limited to ${MAX_GIF_BYTES / 1048576} MB `
          + `(this one is ${(input.length / 1048576).toFixed(1)} MB). Upload it as a video, or use a still image.`,
      });
    } else if (contentType === 'image/gif') {
      output = input;
      outType = 'image/gif';
      outExt = 'gif';
    } else {
      output = await sharp(input)
        // EXIF Orientation is honoured HERE and then discarded. Without this a
        // portrait photo from a phone arrives sideways, because the pixels are
        // landscape and only the tag says otherwise.
        .rotate()
        .resize({
          width: kind.maxWidth,
          // Never upscale: a 400px logo blown up to 600 is bigger and no better.
          withoutEnlargement: true,
          fit: 'inside',
        })
        // WebP at 80 is visually indistinguishable from source JPEG at typical
        // photo sizes and roughly a third of the bytes.
        .webp({ quality: 80, effort: 4 })
        .toBuffer();
      outType = 'image/webp';
      outExt = 'webp';

      /**
       * If the pipeline somehow made the file bigger, keep the original.
       *
       * The same guard as backend/scripts/reencode-audio.js, and for the same
       * reason: that script's first run inflated a 50 kB clip to 253 kB while
       * reporting an overall "-58%". A compression step that can silently grow
       * a file needs the check regardless of how unlikely it looks.
       */
      if (output.length >= input.length) {
        output = input;
        outType = contentType;
        outExt = contentType === 'image/png' ? 'png' : contentType.split('/')[1];
      }
    }

    // Content-addressed: identical bytes → identical key → one stored object.
    const hash = crypto.createHash('sha256').update(output).digest('hex').slice(0, 32);
    const objectPath = `${kind.folder}/${hash}.${outExt}`;

    const { error } = await supabase.storage
      .from('event-assets')
      .upload(objectPath, output, {
        contentType: outType,
        // A year, immutable. The key IS the content hash, so this object can
        // never change meaning — the old `cacheControl: '3600'` was re-fetching
        // unchanged bytes every hour for no reason.
        cacheControl: '31536000, immutable',
        // Same hash means byte-identical content, so overwriting is a no-op that
        // costs one request and saves branching on "does it already exist".
        upsert: true,
      });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage.from('event-assets').getPublicUrl(objectPath);

    logger.info({
      kind: req.params.kind,
      inBytes: input.length,
      outBytes: output.length,
      saved: `${Math.round((1 - output.length / input.length) * 100)}%`,
    }, 'upload processed');

    return sendOk(res, {
      url: publicUrl,
      path: objectPath,
      bytes: output.length,
      originalBytes: input.length,
    }, { status: 201 });
  } catch (err) {
    // sharp throws on a file whose bytes are not the image its Content-Type
    // claims — which is the interesting case, not an infrastructure failure.
    if (/unsupported image format|Input buffer contains unsupported/i.test(err?.message || '')) {
      return sendFail(res, {
        status: 400,
        error: 'NOT_AN_IMAGE',
        message: 'That file could not be read as an image.',
      });
    }
    logger.error({ err, kind: req.params.kind }, 'upload failed');
    return next(err);
  }
};

module.exports = { uploadAsset, KINDS, MAX_INPUT_BYTES, ACCEPTED, ACCEPTED_IMAGE, ACCEPTED_AUDIO };
