const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * RBAC access-context resolver with a short-lived in-memory cache.
 *
 * A single call replaces the two uncached per-request lookups the auth
 * middleware used to perform (organizations + user_roles), resolving the full
 * picture — organizer status, admin status, role keys and the flattened
 * permission set — in one cached unit (Master Plan B4 fix / Foundation F1).
 *
 * The cache TTL is intentionally short so role/permission changes take effect
 * within a minute without a deploy; mutations can also call invalidate(userId)
 * for immediate effect.
 */

const CACHE_TTL_MS = 60 * 1000;
const MAX_CACHE_SIZE = 5000; // maximum number of cached entries
const CACHE_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // sweep expired entries every 5 minutes
const cache = new Map(); // userId -> { value, expires }

/**
 * @typedef {Object} AccessContext
 * @property {boolean} isOrganizer
 * @property {string|null} orgId
 * @property {string|null} orgStatus    'active' | 'suspended' | 'banned'
 * @property {boolean} isAdmin          has an active admin_users row
 * @property {boolean} isSuperAdmin     holds the 'super_admin' role (implicit wildcard)
 * @property {string[]} roleKeys
 * @property {Set<string>} permissions
 */

/**
 * Loads the access context for a user, bypassing the cache.
 * @param {string} userId
 * @returns {Promise<AccessContext>}
 */
async function loadAccessContext(userId) {
  // Organizer side (legacy model) — confirms the account still exists & status.
  //
  // `must_reset_password` rides along on this existing read rather than costing
  // a query of its own. It is checked on EVERY authenticated request (see
  // middleware/auth.enforcePasswordReset), and a separate lookup for one boolean
  // on the hottest path in the API would not be worth it. Cached for the same
  // 60s as everything else here; `changePassword` invalidates on clear so the
  // user is not left locked out after complying.
  const orgPromise = supabase
    .from('organizations')
    .select('id, status, must_reset_password')
    .eq('owner_user_id', userId)
    .maybeSingle();

  // Admin side (new RBAC model) — roles + their granted permissions.
  const adminPromise = supabase
    .from('admin_users')
    .select('id, status, admin_user_roles(roles(key, role_permissions(permissions(key))))')
    .eq('user_id', userId)
    .maybeSingle();

  const [{ data: org, error: orgErr }, { data: admin, error: adminErr }] = await Promise.all([orgPromise, adminPromise]);
  if (adminErr) logger.warn({ err: adminErr, userId }, 'rbacService: admin lookup failed');
  /**
   * A database that has not been given `must_reset_password` yet fails this
   * whole select (PostgREST rejects the request over one unknown column), which
   * would make every authenticated request answer "user no longer exists". So
   * the read is retried without it — the same missing-column tolerance
   * selectEventWithTier applies for the tier columns, and for the same reason:
   * shipping code ahead of its migration must degrade, never black out.
   */
  let orgRow = org;
  if (orgErr && (orgErr.code === '42703' || /column .* does not exist/i.test(orgErr.message || ''))) {
    logger.warn({ userId }, 'rbacService: must_reset_password column missing — re-reading without it');
    const retry = await supabase
      .from('organizations').select('id, status').eq('owner_user_id', userId).maybeSingle();
    orgRow = retry.data;
  } else if (orgErr) {
    logger.warn({ err: orgErr, userId }, 'rbacService: organization lookup failed');
  }

  const roleKeys = [];
  const permissions = new Set();
  let isSuperAdmin = false;
  const isAdmin = !!(admin && admin.status === 'active');

  if (isAdmin) {
    for (const aur of admin.admin_user_roles || []) {
      const role = aur.roles;
      if (!role) continue;
      roleKeys.push(role.key);
      if (role.key === 'super_admin') isSuperAdmin = true;
      for (const rp of role.role_permissions || []) {
        if (rp.permissions?.key) permissions.add(rp.permissions.key);
      }
    }
  }

  return {
    isOrganizer: !!orgRow,
    orgId: orgRow?.id || null,
    orgStatus: orgRow?.status || null,
    // Undefined (rather than false) on a database without the column, so a
    // caller can tell "not flagged" from "cannot know". Both read as false.
    mustResetPassword: orgRow?.must_reset_password === true,
    isAdmin,
    isSuperAdmin,
    roleKeys,
    permissions,
  };
}

/**
 * Cached access-context accessor.
 * @param {string} userId
 * @returns {Promise<AccessContext>}
 */
async function getAccessContext(userId) {
  const hit = cache.get(userId);
  if (hit && hit.expires > Date.now()) return hit.value;

  const value = await loadAccessContext(userId);

  // Evict the oldest entry if cache is at capacity
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }

  cache.set(userId, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Evicts a user's cached context so the next request reloads it immediately. */
function invalidate(userId) {
  cache.delete(userId);
}

/** Clears the entire cache (e.g. after a bulk role change). */
function invalidateAll() {
  cache.clear();
}

/** Periodic sweep: removes expired entries from the cache. */
function _sweepExpired() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expires <= now) cache.delete(key);
  }
}
const _sweepTimer = setInterval(_sweepExpired, CACHE_SWEEP_INTERVAL_MS);
if (_sweepTimer.unref) _sweepTimer.unref(); // don't keep the process alive

/**
 * Whether a resolved context satisfies a permission key.
 * super_admin is an implicit wildcard — it holds every permission.
 * @param {AccessContext} ctx
 * @param {string} permissionKey
 */
function hasPermission(ctx, permissionKey) {
  if (!ctx) return false;
  if (ctx.isSuperAdmin) return true;
  return ctx.permissions.has(permissionKey);
}

module.exports = {
  getAccessContext,
  loadAccessContext,
  invalidate,
  invalidateAll,
  hasPermission,
  CACHE_TTL_MS,
  MAX_CACHE_SIZE,
};
