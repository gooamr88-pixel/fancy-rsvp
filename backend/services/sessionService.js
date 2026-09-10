const crypto = require('crypto');
const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const { captureRequestMeta } = require('../middleware/adminAudit');
const { sendEmailViaBrevo } = require('../utils/notificationService');
const { getNewSignInTemplate } = require('../utils/emailTemplates');
const { formatInZone, zoneAbbreviation } = require('../utils/timezone');

/**
 * Best-effort security alert: emails the organizer when their account is accessed
 * from a NEW device. The device is fingerprinted on the user-agent (not the IP, so
 * mobile-network IP churn doesn't spam alerts), and we never alert on the user's
 * very first device — only genuinely additional ones. Fully non-blocking.
 */
async function maybeAlertNewDevice(req, userId) {
  try {
    const { ip, userAgent, browser, os } = captureRequestMeta(req);
    const fingerprint = crypto.createHash('sha256').update(String(userAgent || 'unknown')).digest('hex');
    const deviceLabel = `${browser || 'Unknown browser'} on ${os || 'unknown OS'}`;

    /**
     * ── WHY THIS READS FIRST INSTEAD OF LETTING THE INSERT FAIL ──
     *
     * This used to INSERT unconditionally and treat the resulting error as the
     * answer to "have I seen this device before?":
     *
     *     const { error: insErr } = await supabase.from('devices').insert(…);
     *     if (insErr) { …update last_seen…; return; }   // ← the failure WAS the logic
     *
     * It worked, and it was the single loudest thing in the Postgres log. Every
     * returning sign-in from a known browser raised
     *
     *     duplicate key value violates unique constraint
     *     "devices_user_id_fingerprint_key"
     *
     * which is a real ERROR-level line, on the happy path, on every login. Three
     * costs, in ascending order of how much they matter:
     *
     *   1. Three round trips (count, failed insert, update) where two will do.
     *   2. Postgres opens and aborts a subtransaction for each violation.
     *   3. THE ONE THAT ACTUALLY BIT: it drowned the error log. Reading the logs
     *      for the 2026-09-03 outage meant scrolling past these to find out
     *      whether anything real had happened. An error you expect is an error
     *      you stop reading.
     *
     * One read now answers both questions at once — how many devices this user
     * has, and whether THIS one is among them — because a user has a handful of
     * devices, not a page of them.
     */
    const { data: known, error: readErr } = await supabase
      .from('devices')
      .select('id, fingerprint')
      .eq('user_id', userId)
      .limit(100);

    if (readErr) throw readErr;

    const priorCount = (known || []).length;
    const alreadyKnown = (known || []).some((d) => d.fingerprint === fingerprint);

    if (alreadyKnown) {
      // Known device → refresh last_seen, no alert. Same outcome as before, one
      // fewer round trip and no exception.
      await supabase.from('devices').update({ last_seen: new Date().toISOString() })
        .eq('user_id', userId).eq('fingerprint', fingerprint);
      return;
    }

    /**
     * `upsert`, not `insert`, purely for the race: two tabs signing in at the
     * same instant both read "not known" and both write. With insert that is a
     * 23505 — the exact log line this change exists to remove, reintroduced in
     * the one case nobody would think to test. With upsert the loser updates.
     *
     * The conflict target is the unique index this whole comment is about.
     */
    const { error: upErr } = await supabase
      .from('devices')
      .upsert(
        { user_id: userId, fingerprint, label: deviceLabel, last_seen: new Date().toISOString() },
        { onConflict: 'user_id,fingerprint' },
      );

    if (upErr) throw upErr;

    // A first-ever device is expected, not suspicious — alert only on additions.
    if (priorCount === 0) return;

    const { data: org } = await supabase
      .from('organizations').select('name, email, timezone').eq('owner_user_id', userId).single();
    if (!org || !org.email) return;

    // On the ORGANIZER's own clock, and labelled with it.
    //
    // This is a security alert — "someone signed in to your account at X" —
    // and its entire value depends on the recipient being able to answer "was
    // that me?". A time rendered in the server's timezone makes that question
    // unanswerable: an organizer who signed in at 9pm reads "4:00 PM" and
    // cannot tell a hosting detail from an intruder.
    const now = new Date().toISOString();
    const stamp = formatInZone(now, org.timezone, { dateStyle: 'medium', timeStyle: 'short' });
    const abbr = zoneAbbreviation(now, org.timezone);
    const when = abbr ? `${stamp} ${abbr}` : stamp;
    const html = getNewSignInTemplate(org.name, { device: deviceLabel, ip, when });
    sendEmailViaBrevo(org.email, 'New Sign-in to Your Fancy RSVP Account', html).catch(() => {});
  } catch (err) {
    logger.warn({ err, userId }, 'sessionService: new-device alert skipped');
  }
}

/**
 * Server-side session lifecycle (Master Plan §4 / §19 / Foundation F2).
 *
 * Issuing a token now also records a `sessions` row keyed by the JWT `jti`, so
 * sessions can be listed and revoked. requireAuth validates the jti against this
 * table (see middleware/auth.js — isSessionValid). All writes are best-effort:
 * an auth flow must never fail because session bookkeeping hiccuped.
 */

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // mirrors the JWT 24h expiry

/** Generates a unique jti for a new token. */
function newJti() {
  return crypto.randomUUID();
}

/**
 * Persists a session row for a freshly issued token.
 * @param {import('express').Request} req
 * @param {{ userId: string, jti: string, deviceLabel?: string }} info
 */
async function recordSession(req, { userId, jti, deviceLabel }) {
  try {
    const { ip, userAgent, browser, os } = captureRequestMeta(req);
    await supabase.from('sessions').insert({
      user_id: userId,
      jti,
      ip,
      user_agent: userAgent,
      device_label: deviceLabel || `${browser} on ${os}`,
      expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    });
  } catch (err) {
    logger.warn({ err, userId }, 'sessionService: failed to record session');
  }
  // Fire-and-forget new-device security alert (never blocks the auth flow).
  maybeAlertNewDevice(req, userId).catch(() => {});
}

/** Revokes a single session by jti (used on logout). */
async function revokeByJti(jti) {
  if (!jti) return;
  try {
    await supabase.from('sessions').update({ revoked_at: new Date().toISOString() }).eq('jti', jti).is('revoked_at', null);
  } catch (err) {
    logger.warn({ err }, 'sessionService: failed to revoke session');
  }
}

/** Revokes every active session for a user (suspend/ban/force-logout). */
async function revokeAllForUser(userId) {
  if (!userId) return 0;
  const { data, error } = await supabase
    .from('sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('revoked_at', null)
    .select('id');
  if (error) throw error;
  return (data || []).length;
}

/** Records a login attempt (success or failure) into login_history. */
async function recordLogin(req, { userId, email, success, failureReason }) {
  try {
    const { ip, userAgent } = captureRequestMeta(req);
    await supabase.from('login_history').insert({
      user_id: userId || null,
      email: email || null,
      ip,
      user_agent: userAgent,
      success: !!success,
      failure_reason: failureReason || null,
    });
  } catch (err) {
    logger.warn({ err, email }, 'sessionService: failed to record login history');
  }
}

module.exports = { newJti, recordSession, revokeByJti, revokeAllForUser, recordLogin, SESSION_TTL_MS };
