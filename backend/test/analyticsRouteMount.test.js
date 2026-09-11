/**
 * THE ANALYTICS ROUTE MOUNT — req.params.eventId must survive the router.
 *
 * `analyticsRoutes` was created with a bare `express.Router()` while being
 * mounted at /api/v1/events/:eventId/analytics. An Express 4 child router
 * REPLACES req.params with its own matched params on the way in, so the
 * controller received `eventId: undefined` on every request that ever hit it.
 *
 * Nothing threw. Every Supabase query filtered on `undefined`, PostgREST
 * rejected the UUID cast, the controller discarded those errors, and the
 * endpoint answered 200 with every figure at zero — indistinguishable from a
 * brand-new event. `eventHasFeature(undefined, …)` withheld on top of that, so
 * `advanced: false` came back and the page drew the upgrade padlock over
 * analytics the organizer was already paying for.
 *
 * The existing analytics tests could not see any of this: they call the
 * controller directly with a hand-built `req`, which is exactly the layer the
 * bug was NOT in. So this file drives a real Express app over a real socket.
 *
 * Two tests, deliberately different in kind:
 *   1. The behavioural one — mount it for real, request it for real, and read
 *      back what the controller actually got.
 *   2. The static one — every sibling router on the same param-carrying prefix
 *      has the same requirement, and a new one added next month would ship with
 *      the same silent failure. That one is a source scan, so it also has to
 *      cope with source files that TALK about the rule (this file, and the
 *      comment in analyticsRoutes.js) without being fooled by them.
 */
require('./helpers/env');

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { injectModule } = require('./helpers/inject');

const BACKEND = path.join(__dirname, '..');
const EVENT = '11111111-1111-4111-8111-111111111111';

/* Stubbed BEFORE the router is required, so requiring the router never pulls in
   the real controller (and through it supabase, the feature gate and the
   platform config). What the controller does is not under test here — only
   what it is handed. */
let seenParams = null;
injectModule('../../controllers/analyticsController', {
  getEventAnalytics: async (req, res) => {
    seenParams = { ...req.params };
    res.json({ success: true });
  },
});

const analyticsRoutes = require('../routes/analyticsRoutes');

/** Mounts the router exactly as app.js does and issues one real request. */
async function requestThroughMount(url) {
  const app = express();
  // The same shape as app.js:500 — middleware in the app.use stack, then the
  // child router. The middleware slot is where verifyEventOwner sits, and it
  // reads req.params.eventId successfully even with the bug present, which is
  // why ownership was never affected and why the failure was data-only.
  app.use('/api/v1/events/:eventId/analytics', analyticsRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${url}`);
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('analytics route mount', () => {
  test('the controller receives eventId from the mount path', async () => {
    seenParams = null;
    const res = await requestThroughMount(`/api/v1/events/${EVENT}/analytics`);

    assert.equal(res.status, 200);
    assert.notEqual(seenParams, null, 'the controller must have been reached at all');
    assert.equal(
      seenParams.eventId, EVENT,
      'req.params.eventId was lost crossing into the child router — analyticsRoutes '
      + 'needs express.Router({ mergeParams: true })',
    );
  });

  test('a query string does not disturb the param', async () => {
    seenParams = null;
    const res = await requestThroughMount(`/api/v1/events/${EVENT}/analytics?from=2026-09-01&to=2026-09-08`);

    assert.equal(res.status, 200);
    assert.equal(seenParams.eventId, EVENT);
  });
});

/* ─── The general rule ─── */

/**
 * Strips comments so a scan reads CODE, not prose.
 *
 * This matters here more than usual: analyticsRoutes.js now carries a long
 * comment explaining the flag, and this very file names it repeatedly. A
 * scanner that searched raw source would pass a file that only ever MENTIONS
 * `mergeParams` in a comment — the precise failure it exists to catch.
 *
 * `[^\n\r]*` for line comments, never `.*` — `.` already excludes newlines in
 * JS regex, but being explicit keeps the intent readable next to the multiline
 * block-comment pattern above it.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n\r]*/g, '');
}

describe('every router on a param-carrying mount merges its params', () => {
  test('routers mounted under /events/:eventId use mergeParams', () => {
    const appSrc = stripComments(fs.readFileSync(path.join(BACKEND, 'app.js'), 'utf8'));

    // `const seatingRoutes = require('./routes/seatingRoutes');`
    const requires = new Map();
    for (const m of appSrc.matchAll(/const\s+(\w+)\s*=\s*require\(['"]\.\/(routes\/[\w/-]+)['"]\)/g)) {
      requires.set(m[1], m[2]);
    }

    // `app.use('/api/v1/events/:eventId/seating', requireAuth, verifyEventOwner, seatingRoutes);`
    const mounts = [...appSrc.matchAll(
      /app\.use\(\s*['"](\/api\/v1\/events\/:eventId\/[\w-]+)['"]\s*,([^)]*)\)/g,
    )];

    assert.ok(mounts.length >= 9, `expected the :eventId mounts to be found, saw ${mounts.length}`);

    const offenders = [];
    let checked = 0;

    for (const [, mountPath, args] of mounts) {
      const ident = args.split(',').map((s) => s.trim()).filter(Boolean).pop();
      const rel = requires.get(ident);
      if (!rel) continue; // not a router module we can resolve — nothing to assert

      const file = path.join(BACKEND, `${rel}.js`);
      if (!fs.existsSync(file)) continue;

      const src = stripComments(fs.readFileSync(file, 'utf8'));
      checked += 1;

      // The flag has to be on the ACTUAL constructor call, not merely present
      // in the file — hence matching the call site rather than the word.
      const construction = src.match(/express\.Router\(([^)]*)\)/);
      const merges = !!construction && /mergeParams\s*:\s*true/.test(construction[1]);

      if (!merges) offenders.push(`${mountPath} -> ${rel}.js`);
    }

    assert.ok(checked >= 9, `expected to have checked the :eventId routers, checked ${checked}`);
    assert.deepEqual(
      offenders, [],
      'These routers are mounted on a path carrying :eventId but do not merge params, so '
      + 'req.params.eventId will be undefined inside them:\n  ' + offenders.join('\n  '),
    );
  });
});
