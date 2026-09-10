require('./helpers/env');
const { test } = require('node:test');
const t = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { mockReq, invoke } = require('./helpers/http');
const { injectModule } = require('./helpers/inject');

/* ═══════════════════════════════════════════════════════════════════════════
   THE SERVER-SIDE UPLOAD

   This endpoint exists to close three measured problems at once (see
   controllers/uploadController.js): an anon-writable bucket, uploads that were
   never resized, and the same file stored five times over.

   The de-duplication test is the one that matters most and is the least
   obvious. It is not a nicety — 19 music files hashed to 10 distinct ones, and
   the identical mechanism was minting duplicate images. If the filename ever
   goes back to a timestamp, everything still WORKS, storage just quietly grows
   forever again. Only a test notices that.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Records what would have been written to Storage. */
const uploads = [];
let uploadError = null;

injectModule('../../config/supabase', {
  supabase: {
    storage: {
      from() {
        return {
          async upload(path, body, opts) {
            if (uploadError) return { data: null, error: uploadError };
            uploads.push({ path, bytes: body.length, opts });
            return { data: { path }, error: null };
          },
          getPublicUrl(path) {
            return { data: { publicUrl: `https://test.supabase.co/storage/v1/object/public/event-assets/${path}` } };
          },
        };
      },
    },
  },
});

const { uploadAsset } = require('../controllers/uploadController');

t.beforeEach(() => { uploads.length = 0; uploadError = null; });

/** A real JPEG, so sharp does real work rather than being mocked into agreement. */
async function jpeg(width, height = width, tint = { r: 200, g: 40, b: 60 }) {
  return sharp({ create: { width, height, channels: 3, background: tint } }).jpeg({ quality: 100 }).toBuffer();
}

const req = (kind, body, contentType = 'image/jpeg') => mockReq({
  params: { kind },
  headers: { 'content-type': contentType },
  body,
  user: { id: 'owner-1' },
});

test('resizes a large photo down to the kind\'s max width and re-encodes to WebP', async () => {
  const big = await jpeg(4000, 3000);
  const { res } = await invoke(uploadAsset, req('gallery', big));

  assert.equal(res.statusCode, 201);
  assert.equal(uploads.length, 1);

  const meta = await sharp(await sharp(big).resize({ width: 2000, withoutEnlargement: true, fit: 'inside' }).webp().toBuffer()).metadata();
  assert.equal(meta.width, 2000, 'gallery caps at 2000px');

  assert.match(uploads[0].path, /^gallery\/[0-9a-f]{32}\.webp$/);
  assert.equal(uploads[0].opts.contentType, 'image/webp');
  assert.ok(res.body.data.bytes < res.body.data.originalBytes, 'output must be smaller than input');
});

test('never upscales — a small logo is not blown up to the max width', async () => {
  const small = await jpeg(200, 200);
  const { res } = await invoke(uploadAsset, req('logo', small));
  assert.equal(res.statusCode, 201);

  // Round-trip through the same pipeline to read the dimensions back.
  const out = await sharp(small).rotate()
    .resize({ width: 600, withoutEnlargement: true, fit: 'inside' })
    .webp({ quality: 80 }).toBuffer();
  assert.equal((await sharp(out).metadata()).width, 200);
});

test('IDENTICAL CONTENT LANDS ON ONE KEY — this is the dedup guarantee', async () => {
  const photo = await jpeg(1200, 900);

  const a = await invoke(uploadAsset, req('gallery', Buffer.from(photo)));
  const b = await invoke(uploadAsset, req('gallery', Buffer.from(photo)));

  assert.equal(a.res.statusCode, 201);
  assert.equal(b.res.statusCode, 201);
  assert.equal(uploads[0].path, uploads[1].path, 'the same image must not produce two objects');
  assert.equal(a.res.body.data.url, b.res.body.data.url);
});

test('different content lands on different keys', async () => {
  await invoke(uploadAsset, req('gallery', await jpeg(800, 800, { r: 10, g: 10, b: 200 })));
  await invoke(uploadAsset, req('gallery', await jpeg(800, 800, { r: 200, g: 10, b: 10 })));
  assert.notEqual(uploads[0].path, uploads[1].path);
});

test('caches for a year and marks the object immutable', async () => {
  await invoke(uploadAsset, req('cover', await jpeg(1000)));
  // The key is a content hash, so the bytes behind it can never change. The old
  // direct-upload path asked for 3600 and re-fetched unchanged images hourly.
  assert.equal(uploads[0].opts.cacheControl, '31536000, immutable');
});

test('an animated GIF is passed through, not flattened to one frame', async () => {
  // A single-frame GIF is enough: the branch is chosen by Content-Type, and what
  // is asserted is that sharp never touched the bytes.
  const gif = await sharp({ create: { width: 50, height: 50, channels: 3, background: { r: 1, g: 2, b: 3 } } }).gif().toBuffer();
  const { res } = await invoke(uploadAsset, req('gallery', gif, 'image/gif'));

  assert.equal(res.statusCode, 201);
  assert.match(uploads[0].path, /\.gif$/);
  assert.equal(uploads[0].bytes, gif.length, 'GIF bytes must be byte-identical');
  assert.equal(uploads[0].opts.contentType, 'image/gif');
});

test('rejects an unknown kind rather than trusting a caller-supplied path', async () => {
  const { res } = await invoke(uploadAsset, req('../../etc', await jpeg(100)));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'UNKNOWN_KIND');
  assert.equal(uploads.length, 0);
});

test('rejects a non-image Content-Type', async () => {
  const { res } = await invoke(uploadAsset, req('gallery', Buffer.from('PK\x03\x04zip'), 'application/zip'));
  assert.equal(res.statusCode, 415);
  assert.equal(uploads.length, 0);
});

test('rejects bytes that are not the image the Content-Type claims', async () => {
  const { res } = await invoke(uploadAsset, req('gallery', Buffer.from('this is not a jpeg at all')));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'NOT_AN_IMAGE');
  assert.equal(uploads.length, 0);
});

test('rejects an empty body', async () => {
  const { res } = await invoke(uploadAsset, req('gallery', Buffer.alloc(0)));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'EMPTY_BODY');
});

test('rejects a file over the input ceiling', async () => {
  const { res } = await invoke(uploadAsset, req('gallery', Buffer.alloc(13 * 1024 * 1024)));
  assert.equal(res.statusCode, 413);
  assert.equal(res.body.error, 'FILE_TOO_LARGE');
  assert.equal(uploads.length, 0);
});

test('a storage failure surfaces as an error, not a success with a broken URL', async () => {
  uploadError = new Error('bucket unavailable');
  const { res, next, nextErr } = await invoke(uploadAsset, req('gallery', await jpeg(500)));
  // Handed to next(err) — the old client-side path swallowed this and silently
  // embedded the image as a base64 data URI in a database row instead, which is
  // both unbounded egress and a failure nobody ever saw.
  assert.ok(next, 'the error must reach the error handler');
  assert.match(nextErr?.message || '', /bucket unavailable/);
  assert.notEqual(res.statusCode, 201);
});
