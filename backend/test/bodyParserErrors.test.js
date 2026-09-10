require('./helpers/env');

/**
 * app.js validates REQUIRED_ENV at require-time and calls `process.exit(1)` on
 * anything missing — which, in a test runner, kills the worker with no
 * assertion and a bare "test failed". `helpers/env` covers what the service
 * modules need; these three are only demanded by app.js itself.
 */
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-client-id';
process.env.IP_HASH_SALT = process.env.IP_HASH_SALT || 'test-ip-hash-salt';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_dummy';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mockRes } = require('./helpers/http');

/* ═══════════════════════════════════════════════════════════════════════════
   BODY-PARSER FAILURES MUST NOT LOOK LIKE SERVER FAULTS.

   `express.raw` / `express.json` reject an oversized or malformed body by
   throwing an error that already carries the correct status — 413 for
   `entity.too.large`, 400 for bad JSON — before any route handler runs.

   The catch-all error handler ignored that and answered 500
   INTERNAL_SERVER_ERROR for every one. Once uploads moved server-side that
   became a real defect: a photo over the 12 MB ceiling told the organizer "An
   unexpected error occurred on the server", and the upload controller's own
   size check could never report it, because the parser rejects the body first.

   The second test is the one that keeps this honest. Trusting `err.status`
   unconditionally would let any internal fault choose its own status code and
   leak its message; the handler only trusts errors that also carry `err.type`,
   which is body-parser's own marker.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The app's final error middleware, pulled off the stack by arity. */
function errorHandler() {
  const app = require('../app');
  const layers = app._router
    ? app._router.stack
    : (app.router && app.router.stack) || [];
  const layer = layers.filter((l) => l.handle && l.handle.length === 4).pop();
  assert.ok(layer, 'no 4-arity error middleware found on the app');
  return layer.handle;
}

const run = (err) => {
  const res = mockRes();
  errorHandler()(err, { originalUrl: '/api/v1/uploads/cover', method: 'POST' }, res, () => {});
  return res;
};

test('an oversized body answers 413 FILE_TOO_LARGE, not 500', () => {
  const err = Object.assign(new Error('request entity too large'), {
    type: 'entity.too.large', status: 413, statusCode: 413, expose: true,
  });

  const res = run(err);
  assert.equal(res.statusCode, 413);
  assert.equal(res.body.error, 'FILE_TOO_LARGE');
  assert.match(res.body.message, /too large/i);
});

test('the 413 names the limit of the parser that actually rejected the body', () => {
  /* The message used to be the fixed sentence "The limit is 12 MB." That was
     true of the upload parser and of nothing else. There are four parsers with
     four ceilings — 8kb for the analytics beacon, 64kb for the public guest
     writes, 12MB for uploads, 50mb for authenticated payloads — so the fixed
     sentence told a caller rejected at 64kb that it had 12 MB to work with.

     body-parser puts the real ceiling on `err.limit`, in bytes (verified
     against express 4.22.2: a 8kb json parser raises limit: 8192). */
  const at = (limit) => run(Object.assign(new Error('request entity too large'), {
    type: 'entity.too.large', status: 413, statusCode: 413, expose: true, limit,
  })).body.message;

  assert.match(at(8192), /8 KB/, 'the beacon parser must report KB, not MB');
  assert.match(at(65536), /64 KB/);
  assert.match(at(12 * 1024 * 1024), /12 MB/);
  assert.match(at(50 * 1024 * 1024), /50 MB/);

  // And an error carrying no limit still produces a sensible sentence rather
  // than "undefined".
  const noLimit = run(Object.assign(new Error('request entity too large'), {
    type: 'entity.too.large', status: 413, statusCode: 413, expose: true,
  })).body.message;
  assert.match(noLimit, /too large/i);
  assert.doesNotMatch(noLimit, /undefined|NaN/);
});

test('malformed JSON answers 400, not 500', () => {
  const err = Object.assign(new SyntaxError('Unexpected token } in JSON'), {
    type: 'entity.parse.failed', status: 400, statusCode: 400, expose: true,
  });

  const res = run(err);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'INVALID_BODY');
});

test('a REAL internal error is still an opaque 500 — no status smuggling', () => {
  /**
   * The dangerous shortcut would have been `res.status(err.status || 500)`.
   * A database driver error carrying an unrelated numeric `status`, or anything
   * a caller can influence, would then pick its own response code — and with a
   * message that L1 deliberately hides in production.
   *
   * `err.type` is body-parser's marker and nothing else in this codebase sets
   * it, so it is what separates "the client sent something we cannot read" from
   * "we broke".
   */
  const err = Object.assign(new Error('connection terminated unexpectedly'), {
    status: 400, // present, but WITHOUT err.type
  });

  const res = run(err);
  assert.equal(res.statusCode, 500, 'an error with no err.type must not choose its own status');
  assert.equal(res.body.error, 'INTERNAL_SERVER_ERROR');
  assert.doesNotMatch(
    JSON.stringify(res.body), /connection terminated/,
    'the internal message must not reach the client',
  );
});

test('a 5xx carrying err.type is still treated as ours, not the client\'s', () => {
  // `status < 500` is the guard: a body-parser error can only ever be a client
  // error, so anything at 500 or above is a fault on this side however it is
  // labelled.
  const err = Object.assign(new Error('stream failed'), {
    type: 'entity.parse.failed', status: 503,
  });

  const res = run(err);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'INTERNAL_SERVER_ERROR');
});
