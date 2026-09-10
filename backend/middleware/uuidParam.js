/**
 * ROUTE-PARAMETER UUID GUARDS — and why they cannot live in app.js alone.
 *
 * ── The bug this file exists to close ──
 *
 * `app.js` registers `app.param()` for twenty-two identifier names, with a long
 * comment explaining that it stops `?partyId=undefined` and `/rsvps/undefined`
 * from reaching Postgres as `invalid input syntax for type uuid`. That guard was
 * almost entirely inert, and the reason is a documented Express rule rather than
 * a mistake in the regex:
 *
 *     A param callback registered on the APP fires only for parameters that
 *     appear in the app's own routing — which includes an `app.use()` MOUNT
 *     path, but never a parameter declared inside a mounted Router.
 *
 * Verified against express 4.22.2: a param declared by `router.patch('/x/:id')`
 * fired the app-level callback zero times; the same name in an `app.use('/y/:id')`
 * mount path fired it once.
 *
 * So of the twenty-two, only `:eventId` was ever guarded, and only on the
 * routers mounted at `/api/v1/events/:eventId/...`. Everything else —
 * `:userId`, `:sessionId`, `:roleId`, `:testimonialId`, and even
 * `GET /api/v1/events/:eventId` itself, whose router is mounted at
 * `/api/v1/events` with the parameter declared inside — went straight through.
 *
 * ── The fix ──
 *
 * One helper, registered on the router that actually declares the parameter.
 * Several routers had already grown their own private copy of this exact
 * function (checkinSyncRoutes, shopRoutes, rsvpRoutes, tableRoutes, …); those
 * now import this one, so there is a single definition of what an id looks like
 * and a single error shape when it is not one.
 *
 * ── Why 400 and not a scrub ──
 *
 * A path segment is not optional. `/events/undefined/rsvps` has no sensible
 * reading, and answering `400 INVALID_PARAM` tells whoever wrote that caller
 * exactly what is wrong — which `invalid input syntax for type uuid`, buried in
 * a Postgres log, did not. Query-string scrubbing is a different problem and
 * stays in app.js, where it belongs: there, `?partyId=undefined` genuinely is
 * indistinguishable from an omitted optional filter.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` is a canonical UUID string. */
const isUuid = (value) => typeof value === 'string' && UUID_REGEX.test(value);

/**
 * An Express `router.param` callback that rejects anything that is not a UUID.
 * @param {string} name  the parameter name, used in the error message
 */
const uuidParam = (name) => (req, res, next, value) => {
  if (!UUID_REGEX.test(value)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_PARAM',
      message: `${name} must be a valid UUID.`,
    });
  }
  next();
};

/**
 * Register the guard for several parameter names on one router.
 *
 * Registering a name the router never declares is harmless — the callback
 * simply never fires — so a list may safely cover a router's whole surface
 * rather than being pruned to exactly what is mounted today. That matters: the
 * failure mode here is a parameter added later with no guard, and a list that
 * anticipates the name costs nothing.
 *
 * @param {import('express').Router} router
 * @param {string[]} names
 */
const registerUuidParams = (router, names) => {
  for (const name of names) router.param(name, uuidParam(name));
  return router;
};

module.exports = { UUID_REGEX, isUuid, uuidParam, registerUuidParams };
