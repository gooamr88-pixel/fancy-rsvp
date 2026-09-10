require('./helpers/env');
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-client-id';
process.env.IP_HASH_SALT = process.env.IP_HASH_SALT || 'test-ip-hash-salt';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_dummy';

const { test } = require('node:test');
const assert = require('node:assert/strict');

/* ═══════════════════════════════════════════════════════════════════════════
   THE "undefined" QUERY-STRING SCRUBBER

   The Postgres log carries bursts of `invalid input syntax for type uuid:
   "undefined"` — thirteen inside 22 seconds on 2026-09-10. That is JavaScript's
   `undefined` stringified into a URL by a caller and handed to PostgREST as an
   id. Each one is a wasted round trip that fails, and an ERROR-level log line on
   a path nobody thinks is broken.

   This middleware drops those values before they reach a query. It was added to
   app.js and shipped WITHOUT A TEST — live on every request, deleting keys off
   `req.query`, with nothing pinning which keys it may touch.

   That is the risk worth covering: the scrubber deletes by KEY NAME pattern, and
   widening that pattern by one character would start eating real search terms.
   A guest legitimately named "null", or a search for the string "undefined",
   must survive.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The scrubber is the app-level middleware registered just before app.param. */
function scrubber() {
  const app = require('../app');
  const layers = app._router
    ? app._router.stack
    : (app.router && app.router.stack) || [];

  // Identify it by behaviour rather than by position: run each candidate over a
  // probe and keep the one that removes `partyId=undefined`. Anchoring on an
  // index would silently pick a different middleware the next time app.js is
  // reordered, and every assertion below would then pass against the wrong code.
  for (const l of layers) {
    const h = l.handle;
    if (typeof h !== 'function' || h.length !== 3) continue;
    const probe = { query: { partyId: 'undefined' }, headers: {}, method: 'GET' };
    try { h(probe, {}, () => {}); } catch { continue; }
    if (!('partyId' in probe.query)) return h;
  }
  assert.fail('could not locate the query scrubber middleware in app.js');
}

const scrub = (query) => {
  const req = { query: { ...query }, headers: {}, method: 'GET' };
  let called = false;
  scrubber()(req, {}, () => { called = true; });
  assert.ok(called, 'the middleware must always call next()');
  return req.query;
};

test('drops the JavaScript accidents from *Id keys', () => {
  assert.deepEqual(scrub({ partyId: 'undefined' }), {});
  assert.deepEqual(scrub({ eventId: 'null' }), {});
  assert.deepEqual(scrub({ id: 'NaN' }), {});
});

test('leaves real ids alone', () => {
  const real = { partyId: '550e8400-e29b-41d4-a716-446655440000' };
  assert.deepEqual(scrub(real), real);
});

test('NEVER touches a free-text parameter, whatever its value', () => {
  /**
   * The bug this prevents: scrubbing by VALUE alone would delete a search for
   * the word "undefined", and a guest genuinely named "null" would become
   * unfindable — a data-dependent failure that only one customer ever sees and
   * nobody can reproduce.
   */
  for (const key of ['query', 'search', 'q', 'name', 'response', 'meal', 'sort']) {
    const q = { [key]: 'undefined' };
    assert.deepEqual(scrub(q), q, `${key}=undefined must survive`);
  }
  assert.deepEqual(scrub({ search: 'null' }), { search: 'null' });
});

test('only the three literals — a value that merely contains them survives', () => {
  const keep = { partyId: 'undefined-ish' };
  assert.deepEqual(scrub(keep), keep);
  assert.deepEqual(scrub({ eventId: 'nullable' }), { eventId: 'nullable' });
});

test('is case-sensitive: "Undefined" is not the JavaScript accident', () => {
  // `String(undefined)` is always lowercase. Anything else was typed by a human
  // or came from data, and deleting it would be guessing.
  const q = { partyId: 'Undefined' };
  assert.deepEqual(scrub(q), q);
});

test('leaves other keys in place while removing one', () => {
  assert.deepEqual(
    scrub({ partyId: 'undefined', search: 'Ahmed', page: '2' }),
    { search: 'Ahmed', page: '2' },
  );
});

test('survives a request with no query at all', () => {
  const req = { headers: {}, method: 'GET' };
  let called = false;
  scrubber()(req, {}, () => { called = true; });
  assert.ok(called, 'a request without req.query must not throw');
});
