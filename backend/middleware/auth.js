const jwt = require('jsonwebtoken');
const { supabase } = require('../config/supabase');
const { getAccessContext } = require('../services/rbacService');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('FATAL: JWT_SECRET environment variable is required');

/** Cookie configuration — single source of truth for all auth endpoints. */
const COOKIE_NAME = 'fancy_session';
// 'lax' (not 'strict') so the session survives top-level navigations back from
// external providers like Stripe Checkout. 'strict' withholds the cookie on the
// return navigation, which logs the user out after paying. 'lax' still blocks the
// cookie on cross-site POST/embedded requests, preserving CSRF protection.
const getCookieOptions = (maxAge) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge, // milliseconds
});

/**
 * Sets the httpOnly auth cookie on the response.
 * @param {import('express').Response} res
 * @param {string} token - JWT to store
 * @param {number} [maxAge] - cookie lifetime in ms. Must match the token's own
 *   expiry (see jwt.sign's expiresIn at each call site) — a longer cookie
 *   just means the browser keeps resending a token that verify() will reject
 *   once it expires, but callers issuing short-lived tokens (e.g. impersonation)
 *   should pass the matching maxAge here so the cookie doesn't linger.
 */
const setAuthCookie = (res, token, maxAge = 24 * 60 * 60 * 1000) => {
  res.cookie(COOKIE_NAME, token, getCookieOptions(maxAge));
};

/**
 * Clears the httpOnly auth cookie from the response.
 * @param {import('express').Response} res
 */
const clearAuthCookie = (res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
};

/**
 * Extracts JWT from request: cookie first, then Authorization header (backward compat).
 * @param {import('express').Request} req
 * @returns {string|null}
 */
const extractToken = (req) => {
  // 1. httpOnly cookie (primary)
  if (req.cookies && req.cookies[COOKIE_NAME]) {
    return req.cookies[COOKIE_NAME];
  }
  // 2. Authorization header (backward compatibility for mobile clients / external API consumers)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }
  return null;
};

/**
 * Validates a token's server-side session by its `jti` claim.
 * Tokens issued before the sessions migration carry no `jti`; those are treated
 * as legacy-valid until their natural 24h expiry so deploys don't force logouts.
 * @returns {Promise<boolean>} true if the session is valid (or legacy)
 */
const isSessionValid = async (decoded) => {
  // SEC-6: EVERY session must be server-side revocable. Tokens are always issued
  // with a `jti` (see authController.issueAuthCookie), so a token lacking one is
  // forged or predates the sessions system — deny it (fail-closed). The previous
  // legacy allowance is removed now that there are no pre-migration tokens to honor.
  if (!decoded.jti) return false;
  try {
    const { data, error } = await supabase
      .from('sessions')
      .select('revoked_at, expires_at')
      .eq('jti', decoded.jti)
      .maybeSingle();
    // SECURITY (M1): FAIL CLOSED. A token that asserts a `jti` must map to a live,
    // non-revoked session. If we can't positively confirm that — lookup error,
    // missing row, revoked, or expired — deny. Previously this fail-OPENED on a
    // lookup error, so a revoked/forged session slipped through on a transient DB
    // hiccup.
    if (error) {
      logger.error({ err: error, jti: decoded.jti }, 'session validation lookup failed — denying (fail-closed)');
      return false;
    }
    if (!data) return false;            // jti present but no session → revoked/forged
    if (data.revoked_at) return false;  // explicitly revoked (logout / suspension)
    if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return false;
    return true;
  } catch (e) {
    logger.error({ err: e, jti: decoded.jti }, 'session validation threw — denying (fail-closed)');
    return false;
  }
};

/**
 * Middleware to enforce authentication.
 * Reads JWT from httpOnly cookie or Authorization header, validates any
 * server-side session, then resolves a single cached RBAC access context
 * (organizer + admin + permissions) — replacing the previous two uncached
 * lookups (Master Plan B4 fix).
 */
const requireAuth = async (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHENTICATED',
      message: 'Authentication token is required.'
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    const userId = decoded.id || decoded.sub;

    if (!(await isSessionValid(decoded))) {
      return res.status(401).json({ success: false, error: 'SESSION_REVOKED', message: 'This session is no longer valid.' });
    }

    const access = await getAccessContext(userId);

    // The account must still exist as an organizer or an admin.
    if (!access.isOrganizer && !access.isAdmin) {
      return res.status(401).json({ success: false, error: 'User no longer exists' });
    }
    // Banned organizers are denied platform access entirely.
    if (access.isOrganizer && access.orgStatus === 'banned') {
      return res.status(403).json({ success: false, error: 'ACCOUNT_BANNED', message: 'This account has been banned.' });
    }

    req.user = {
      id: userId,
      email: decoded.email,
      role: decoded.role,
      jti: decoded.jti || null,
      access,
      isSuperAdmin: access.isSuperAdmin, // backward-compat mirror for existing controllers
      // Set only on a token minted by admin/userMgmtController.js's impersonateOrganizer —
      // holds the impersonating admin's user id so the app can show a "you are
      // impersonating" indicator and offer a way back (see authController.stopImpersonating).
      imp: decoded.imp || null,
    };

    /**
     * The forced-reset gate lives HERE rather than as a separate mount, so that
     * every authenticated route is covered by construction. Mounting it beside
     * `requireAuth` on each of the fifteen protected prefixes would work today
     * and would be one forgotten line away from not working tomorrow — which is
     * how this flag came to be enforced nowhere at all in the first place.
     */
    const blocked = passwordResetBlock(req);
    if (blocked) return res.status(403).json(blocked);

    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Authentication token is invalid or expired.'
    });
  }
};

/**
 * Middleware for optional authentication (public endpoints that behave differently if logged in).
 */
const optionalAuth = async (req, res, next) => {
  const token = extractToken(req);
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });

    // A revoked/expired session must not populate req.user here either — otherwise
    // a banned/logged-out user keeps being treated as authenticated on every
    // optionalAuth route until the JWT's natural expiry, even though requireAuth
    // would already be rejecting the same token elsewhere.
    if (decoded && (await isSessionValid(decoded))) {
      const userId = decoded.id || decoded.sub;
      const access = await getAccessContext(userId);
      req.user = {
        id: userId,
        email: decoded.email,
        role: decoded.role,
        jti: decoded.jti || null,
        access,
        isSuperAdmin: access.isSuperAdmin,
      };
    }
  } catch (e) {
    // Ignore errors for optional auth
  }
  next();
};

/**
 * ── A FORCED PASSWORD RESET THAT IS ACTUALLY FORCED ───────────────────────
 *
 * `organizations.must_reset_password` is set when an admin resets somebody's
 * password on their behalf (admin/userMgmtController.resetOrganizerPassword).
 * It was written, returned once in the login response, and cleared on change —
 * and enforced by nothing. There was no server-side gate, and the flag was not
 * even included in `GET /auth/profile`, so a user who dismissed the prompt and
 * reloaded the page never saw it again and kept full access on a password an
 * administrator had chosen and knows.
 *
 * This is the gate. It runs after `requireAuth` has resolved the session and
 * refuses everything except the handful of routes needed to comply: read your
 * profile (which now carries the flag), change the password, and log out.
 *
 * ── Why an allowlist of paths rather than a flag on each route ──
 *
 * The set of things you may do while locked out is small, fixed, and about
 * ESCAPING the lockout. Expressing it as "these three, nothing else" means a
 * route added tomorrow is closed by default, which is the correct direction —
 * the alternative would require every future author to know this flag exists.
 */
const PASSWORD_RESET_EXEMPT = [
  { method: 'GET', path: '/api/v1/auth/profile' },
  { method: 'POST', path: '/api/v1/auth/change-password' },
  { method: 'POST', path: '/api/v1/auth/logout' },
  // The way back out of an impersonation session. See the `imp` check below for
  // why an impersonating admin should never reach the gate at all — this entry
  // is the belt for a session that somehow does.
  { method: 'POST', path: '/api/v1/auth/stop-impersonating' },
];

/**
 * Matched case-INSENSITIVELY, because Express routes that way.
 *
 * `caseSensitive` is off by default, so `/API/v1/auth/Change-Password` reaches
 * the change-password handler perfectly well. An exact-case comparison here
 * therefore blocked the one route that CLEARS the flag, for any client that
 * differed in case — leaving that user permanently refused with no way to
 * comply. The mismatch failed in the safe direction (more restrictive, never
 * less), which is exactly why it would have gone unnoticed.
 *
 * Matching the router's own behaviour is the correct rule: if a path resolves
 * to an exempt handler, it is exempt.
 */
const isPasswordResetExempt = (req) => {
  const path = (req.originalUrl || '').split('?')[0].replace(/\/+$/, '').toLowerCase();
  const method = String(req.method || '').toUpperCase();
  return PASSWORD_RESET_EXEMPT.some((r) => r.method === method && r.path === path);
};

/**
 * Answers `null` to let the request through, or the response body to refuse it.
 *
 * Reads the flag off the already-resolved, already-cached access context, so
 * this costs nothing per request. FAILS OPEN by construction: a database
 * without the column resolves `mustResetPassword` to false, which is what was
 * true before the flag existed.
 */
const passwordResetBlock = (req) => {
  if (!req.user || isPasswordResetExempt(req)) return null;

  // Admins are exempt: the flag is only ever set on an organizer account, and
  // locking an admin out of the admin surface over it would be a way to lock
  // the platform's operators out of their own tools.
  if (req.user.access?.isAdmin) return null;

  /**
   * An IMPERSONATION session is exempt, and this one is not cosmetic.
   *
   * When an admin impersonates an organizer, `req.user.access` is resolved for
   * the ORGANIZER — so `isAdmin` above is false. If that organizer happens to
   * be flagged for a forced reset, the gate would refuse the admin every route
   * INCLUDING the one that ends the impersonation, stranding them in a session
   * they cannot leave and cannot use. And the demand itself is nonsense: the
   * person at the keyboard is not the account holder and must not be invited to
   * choose that account's password.
   *
   * `imp` is set only by admin/userMgmtController.impersonateOrganizer, which
   * is already permission-checked, so trusting it here adds no new authority.
   */
  if (req.user.imp) return null;

  if (!req.user.access?.mustResetPassword) return null;

  return {
    success: false,
    error: 'PASSWORD_RESET_REQUIRED',
    message: 'Your password was reset by an administrator. Choose a new password to continue.',
  };
};

/**
 * Middleware to restrict access to super administrators only.
 */
const requireSuperAdmin = (req, res, next) => {
  if (!req.user || !req.user.access?.isSuperAdmin) {
    return res.status(403).json({
      success: false,
      error: 'FORBIDDEN',
      message: 'Access restricted to system administrators.'
    });
  }
  next();
};

/**
 * Middleware to verify that the logged-in user owns the event being accessed.
 * Super admins bypass this check automatically.
 */
const verifyEventOwner = async (req, res, next) => {
  const { eventId } = req.params;
  if (!eventId) return next();

  if (req.user?.isSuperAdmin) return next();

  try {
    const { data: event, error } = await supabase
      .from('events')
      .select('org_id, organizations(owner_user_id)')
      .eq('id', eventId)
      .single();

    if (error || !event) {
      return res.status(404).json({
        success: false,
        error: 'EVENT_NOT_FOUND',
        message: 'Event not found.'
      });
    }

    const ownerId = event.organizations?.owner_user_id;
    if (ownerId !== req.user?.id) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: 'You do not have permission to access resources for this event.'
      });
    }

    next();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  requireAuth,
  optionalAuth,
  requireSuperAdmin,
  verifyEventOwner,
  // Exported for tests and for anything that needs to ask the same question
  // without going through requireAuth.
  passwordResetBlock,
  setAuthCookie,
  clearAuthCookie,
  COOKIE_NAME,
};
