const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');

/**
 * How many of an organization's events the timezone proposal and its apply
 * will consider — ONE constant, used by both.
 *
 * They were 200 and 500. An organization with 250 events would have been told
 * "200 events are on a different clock" and then had 250 of them changed: a
 * number on screen that did not describe what the button did. The mismatch was
 * invisible in every realistic test because nobody has 200 events.
 *
 * The cap itself is a memory guard, not a business rule. `truncated` is
 * reported when it binds, because the alternative is the same silent-cap bug
 * this file has already been bitten by elsewhere.
 */
const MAX_EVENTS_PER_ORG = 500;
const { escapeHtml, getEmailVerificationTemplate, getPasswordResetTemplate, getOrganizerWelcomeTemplate, getPasswordChangedTemplate } = require('../utils/emailTemplates');
const { setAuthCookie, clearAuthCookie, COOKIE_NAME } = require('../middleware/auth');
const { sendEmailViaBrevo } = require('../utils/notificationService');
const { newJti, recordSession, revokeByJti, revokeAllForUser, recordLogin } = require('../services/sessionService');
const { getAccessContext } = require('../services/rbacService');
const { generateUniqueReferralCode, resolveReferrerOrgId } = require('../services/referralService');
const { captureRequestMeta } = require('../middleware/adminAudit');
const { resolveTimezoneFromIp } = require('../utils/timezoneFromIp');
const {
  PLATFORM_TIMEZONE, isValidTimeZone, safeZone, formatInZone, zoneOffsetMs,
  instantToWallClock, wallClockToInstant,
} = require('../utils/timezone');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('FATAL: JWT_SECRET environment variable is required');

const CURRENT_ITERATIONS = 600000;
const LEGACY_ITERATIONS = 1000;

/**
 * Password strength regex: at least 8 chars, one uppercase, one lowercase, one digit.
 */
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

/**
 * Hashes a password using async PBKDF2 with 600,000 iterations.
 */
const hashPassword = (password) => {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.pbkdf2(password, salt, CURRENT_ITERATIONS, 64, 'sha512', (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
};

/**
 * Verifies a password against a stored PBKDF2 hash.
 * Implements dual-hash migration: tries 600k iterations first, then falls back
 * to legacy 1,000 iterations. If legacy succeeds, rehashes with 600k and updates DB.
 * Uses crypto.timingSafeEqual for constant-time comparison.
 */
const verifyPassword = async (password, storedHash, orgEmail) => {
  if (!storedHash) return false;
  const [salt, originalHash] = storedHash.split(':');
  if (!salt || !originalHash) return false;

  const originalHashBuffer = Buffer.from(originalHash, 'hex');

  // Try current iterations (600,000) first
  const currentMatch = await new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, CURRENT_ITERATIONS, 64, 'sha512', (err, derivedKey) => {
      if (err) return reject(err);
      try {
        resolve(crypto.timingSafeEqual(derivedKey, originalHashBuffer));
      } catch {
        resolve(false);
      }
    });
  });

  if (currentMatch) return true;

  // Fallback: try legacy iterations (1,000)
  const legacyMatch = await new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, LEGACY_ITERATIONS, 64, 'sha512', (err, derivedKey) => {
      if (err) return reject(err);
      try {
        resolve(crypto.timingSafeEqual(derivedKey, originalHashBuffer));
      } catch {
        resolve(false);
      }
    });
  });

  if (legacyMatch && orgEmail) {
    // Rehash with current iterations and update DB
    try {
      const newHash = await hashPassword(password);
      await supabase
        .from('organizations')
        .update({ password_hash: newHash })
        .eq('email', orgEmail);
      logger.info({ email: orgEmail }, 'Migrated password hash to current iteration count');
    } catch (rehashErr) {
      logger.error({ err: rehashErr }, 'Failed to rehash password during migration');
    }
  }

  return legacyMatch;
};

/**
 * SEC: timing-safe existence check. Computed once (lazily) so that a login
 * attempt against a non-existent email pays the same ~600k-iteration PBKDF2
 * cost as a real password check against an existing account, instead of
 * returning near-instantly. Without this, an attacker can fingerprint which
 * emails have accounts purely by response time — the generic "Invalid email
 * or password" message defeats text-based enumeration, but not timing-based.
 */
let dummyHashPromise = null;
const getDummyHash = () => {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(crypto.randomBytes(32).toString('hex'));
  return dummyHashPromise;
};

/**
 * Generates a signed JWT (with a unique `jti`), attaches it as an httpOnly
 * cookie, and records a server-side session so it can later be revoked
 * (Master Plan §4/§19). Best-effort session write never blocks the auth flow.
 */
const issueAuthCookie = async (req, res, payload) => {
  const jti = newJti();
  const token = jwt.sign({ ...payload, jti }, JWT_SECRET, { expiresIn: '24h' });
  setAuthCookie(res, token);
  await recordSession(req, { userId: payload.id, jti });
  return token;
};

/**
 * The timezone columns for a brand-new organization, resolved from the IP the
 * account is being created on.
 *
 * Stamped ONCE, here, and never recomputed — the same one-shot rule the
 * referral attribution beside it follows, for a closely related reason. A
 * referrer that could change retroactively could be gamed; a timezone that
 * could change retroactively would move the advertised start time of events
 * that already have invitations out. Both facts are about the moment the
 * account was created, so both are settled at that moment and frozen.
 *
 * This is what makes "signed up in San Diego, signing in from Cairo" keep
 * San Diego time: no later request re-asks the question.
 *
 * Always resolves — never rejects, never blocks signup. A failed lookup
 * records the platform default with source 'default', which is a durable
 * marker that this account's zone was never truly established rather than a
 * silent pretence that San Diego was detected.
 */
const resolveSignupTimezone = async (req) => {
  try {
    const { ip } = captureRequestMeta(req);
    const geo = await resolveTimezoneFromIp(ip);
    if (geo) {
      return {
        timezone: geo.timeZone,
        timezone_source: 'ip',
        signup_ip_country: geo.country,
      };
    }
  } catch (err) {
    // resolveTimezoneFromIp already swallows its own failures; this catch
    // exists so that an unexpected throw in captureRequestMeta cannot take
    // down registration over a cosmetic field.
    logger.warn({ err }, 'resolveSignupTimezone: falling back to the platform default');
  }
  return {
    timezone: PLATFORM_TIMEZONE,
    timezone_source: 'default',
    signup_ip_country: null,
  };
};

/**
 * Registers a new organizer account.
 * Creates the user in an UNVERIFIED state, generates 6-digit OTP, and dispatches email.
 * No auth cookie is issued until the OTP is verified via /verify-registration.
 * POST /api/v1/auth/register
 */
const register = async (req, res, next) => {
  const { password, name } = req.body;
  // Organization name is optional — individuals creating an event aren't an "organization".
  // Falls back to the person's name, mirroring the Google sign-up flow (see googleAuth below).
  const orgName = req.body.orgName && req.body.orgName.trim() ? req.body.orgName.trim() : name;
  // Normalize email to lowercase so registration and login resolve the same record.
  // (login() looks up by lowercased email; storing verbatim here would lock the user out.)
  const email = req.body.email ? req.body.email.toLowerCase().trim() : '';

  if (!email || !password || !name) {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'email, password, and name are required.'
    });
  }

  // Password strength validation
  if (!passwordRegex.test(password)) {
    return res.status(400).json({ success: false, error: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters with uppercase, lowercase, and a number' });
  }

  // Normalize email so lookups match login/Google flows (all lowercase, trimmed)
  // L11: email is already lowercased+trimmed above — reuse it directly.
  const normalizedEmail = email;

  try {
    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('organizations')
      .select('id, email_verified, referred_by_org_id')
      .eq('email', normalizedEmail)
      .limit(1);

    if (existingUser && existingUser.length > 0) {
      // If already verified, reject
      if (existingUser[0].email_verified) {
        return res.status(409).json({
          success: false,
          error: 'USER_EXISTS',
          message: 'A user with this email is already registered.'
        });
      }
      // If unverified, allow re-registration (overwrite pending registration)
    }

    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(password);

    // Generate 6-digit OTP for email verification
    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes

    // Referral attribution: resolved once and stamped at account creation only —
    // the referrer never changes after this, so it can't be gamed retroactively
    // by a later "?ref=" visit. A bad/unknown code silently resolves to null
    // rather than blocking registration.
    const refCode = (req.body.refCode || '').toString().trim();
    // Resolved concurrently with the referrer rather than after it: both are
    // independent network round-trips on the signup critical path, and running
    // them in series would add the geo lookup's latency to every registration
    // for no reason.
    const [referrerOrgId, signupTimezone] = await Promise.all([
      refCode ? resolveReferrerOrgId(refCode) : Promise.resolve(null),
      resolveSignupTimezone(req),
    ]);

    if (existingUser && existingUser.length > 0) {
      // Update existing unverified record. Only attach a referrer if this
      // pending registration didn't already have one — first touch wins.
      const updatePayload = {
        owner_user_id: userId,
        name: orgName,
        password_hash: passwordHash,
        registration_otp: otpHash,
        registration_otp_expires_at: otpExpiresAt,
        otp_attempts: 0,
        email_verified: false,
        // Re-stamped, unlike the referrer directly below, and the asymmetry is
        // intentional. This branch only runs for a record that was never
        // verified — no login ever happened, no event was ever created, so
        // there is no earlier decision to protect. What is being overwritten
        // here is an abandoned attempt, and the person in front of us now is
        // the one whose clock the account should keep. The referrer resists
        // overwriting because first-touch attribution is a claim someone else
        // has on this signup; a timezone is not.
        ...signupTimezone,
      };
      if (referrerOrgId && !existingUser[0].referred_by_org_id) {
        updatePayload.referred_by_org_id = referrerOrgId;
      }
      const { error: updateError } = await supabase
        .from('organizations')
        .update(updatePayload)
        .eq('email', normalizedEmail);
      if (updateError) throw updateError;
    } else {
      // Create new organization in unverified state
      const referralCode = await generateUniqueReferralCode();
      const { error: orgError } = await supabase
        .from('organizations')
        .insert({
          owner_user_id: userId,
          name: orgName,
          email: normalizedEmail,
          password_hash: passwordHash,
          registration_otp: otpHash,
          registration_otp_expires_at: otpExpiresAt,
          otp_attempts: 0,
          email_verified: false,
          referral_code: referralCode,
          referred_by_org_id: referrerOrgId,
          ...signupTimezone,
        });

      if (orgError) throw orgError;
    }

    // Dispatch verification email via Brevo (premium centralized template)
    const emailHtml = getEmailVerificationTemplate(name, otp);

    await sendEmailViaBrevo(normalizedEmail, 'Verify Your Email — Fancy RSVP', emailHtml);

    logger.info({ email: normalizedEmail }, 'Registration OTP dispatched');

    return res.status(201).json({
      success: true,
      message: 'Registration initiated. Please check your email for the verification code.',
      requiresVerification: true,
      email: normalizedEmail,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Verifies the registration OTP and activates the account.
 * On success, issues the first httpOnly auth cookie.
 * POST /api/v1/auth/verify-registration
 */
const verifyRegistration = async (req, res, next) => {
  const { otp } = req.body;
  const email = req.body.email ? req.body.email.toLowerCase().trim() : '';

  if (!email || !otp) {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'email and otp are required.'
    });
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    // 1. Fetch unverified organization
    const { data: orgs, error: fetchError } = await supabase
      .from('organizations')
      .select('id, owner_user_id, name, email, registration_otp, registration_otp_expires_at, otp_attempts, email_verified')
      .eq('email', normalizedEmail)
      .limit(1);

    if (fetchError) throw fetchError;

    const org = orgs && orgs[0];
    if (!org) {
      return res.status(400).json({ success: false, error: 'NOT_FOUND', message: 'No pending registration found for this email.' });
    }

    if (org.email_verified) {
      return res.status(400).json({ success: false, error: 'ALREADY_VERIFIED', message: 'This email is already verified. Please log in.' });
    }

    // 2. Rate limit OTP attempts
    const otpAttempts = org.otp_attempts || 0;
    if (otpAttempts >= 5) {
      return res.status(429).json({
        success: false,
        error: 'TOO_MANY_ATTEMPTS',
        message: 'Too many verification attempts. Please register again to receive a new code.'
      });
    }

    // 3. Validate OTP
    const storedOtp = org.registration_otp;
    const expiresAt = org.registration_otp_expires_at;

    if (!storedOtp || !expiresAt || new Date() > new Date(expiresAt)) {
      await supabase.from('organizations').update({ otp_attempts: otpAttempts + 1 }).eq('email', normalizedEmail);
      return res.status(400).json({ success: false, error: 'OTP_EXPIRED', message: 'The verification code has expired. Please register again.' });
    }

    const submittedHash = crypto.createHash('sha256').update(String(otp)).digest('hex');
    const otpMatch = storedOtp.length === submittedHash.length &&
      crypto.timingSafeEqual(Buffer.from(storedOtp, 'utf8'), Buffer.from(submittedHash, 'utf8'));

    if (!otpMatch) {
      await supabase.from('organizations').update({ otp_attempts: otpAttempts + 1 }).eq('email', normalizedEmail);
      return res.status(400).json({ success: false, error: 'INVALID_OTP', message: 'Invalid verification code.' });
    }

    // 4. Activate the account
    const { error: updateError } = await supabase
      .from('organizations')
      .update({
        email_verified: true,
        registration_otp: null,
        registration_otp_expires_at: null,
        otp_attempts: 0,
      })
      .eq('email', normalizedEmail);

    if (updateError) throw updateError;

    // 5. Issue auth cookie
    const userId = org.owner_user_id;
    await issueAuthCookie(req, res, { id: userId, email: normalizedEmail, role: 'organizer' });

    logger.info({ email: normalizedEmail }, 'Registration verified, account activated');

    // Onboarding welcome (best-effort, non-blocking).
    sendEmailViaBrevo(normalizedEmail, 'Welcome to Fancy RSVP', getOrganizerWelcomeTemplate(org.name))
      .catch(() => {});
    supabase.from('organizations').update({ welcome_sent_at: new Date().toISOString() }).eq('id', org.id).then(() => {}, () => {});

    return res.status(200).json({
      success: true,
      message: 'Email verified. Welcome to Fancy RSVP!',
      user: { id: userId, email: normalizedEmail, name: org.name, role: 'organizer' },
      organization: { id: org.id, owner_user_id: userId, name: org.name, email: org.email },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Authenticates organizer login credentials.
 * Sets httpOnly auth cookie on success.
 * POST /api/v1/auth/login
 */
const login = async (req, res, next) => {
  const { email, password } = req.body;
  const normalizedEmail = email ? email.toLowerCase().trim() : '';

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'email and password are required.'
    });
  }

  try {
    // Resolve organization by email
    const { data: orgs } = await supabase
      .from('organizations')
      .select('id, owner_user_id, name, email, phone, password_hash, failed_login_attempts, lockout_until, email_verified, must_reset_password')
      .eq('email', normalizedEmail)
      .limit(1);

    const org = orgs && orgs[0];

    // SEC H4 / timing: pay the same PBKDF2 cost for every request *before*
    // branching on account state (unverified / google-only / no-account /
    // wrong-password all return the identical "Invalid email or password"
    // message). Previously the unverified and google-only branches returned
    // immediately without hashing, so response latency alone could distinguish
    // those states from a genuine wrong-password/no-such-account attempt —
    // the message was generic but the clock wasn't. Computing this up front,
    // at a single fixed point every request passes through, closes that gap.
    const passwordOk = (org && org.password_hash)
      ? await verifyPassword(password, org.password_hash, normalizedEmail)
      : await verifyPassword(password, await getDummyHash(), null);

    // SEC H4: Return a generic error for unverified accounts — do not reveal
    // that a specific email is registered but unverified.
    if (org && org.email_verified === false) {
      await recordLogin(req, { userId: org?.owner_user_id, email: normalizedEmail, success: false, failureReason: 'email_not_verified' });
      return res.status(401).json({
        success: false,
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.'
      });
    }

    // Check account lockout
    if (org && org.lockout_until && new Date(org.lockout_until) > new Date()) {
      const remainingMs = new Date(org.lockout_until) - new Date();
      const remainingMin = Math.ceil(remainingMs / 60000);
      return res.status(429).json({
        success: false,
        error: 'ACCOUNT_LOCKED',
        message: `Account temporarily locked due to too many failed login attempts. Try again in ${remainingMin} minute(s).`
      });
    }

    // SEC H4: Return a generic error for Google-only accounts — do not reveal
    // the auth method tied to a specific email.
    if (org && !org.password_hash) {
      await recordLogin(req, { userId: org?.owner_user_id, email: normalizedEmail, success: false, failureReason: 'google_only_account' });
      return res.status(401).json({
        success: false,
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.'
      });
    }

    if (!org || !passwordOk) {
      // Increment failed attempts if org exists
      if (org) {
        const attempts = (org.failed_login_attempts || 0) + 1;
        const updateData = { failed_login_attempts: attempts };
        // Lock account after 5 failed attempts for 15 minutes
        if (attempts >= 5) {
          updateData.lockout_until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
          updateData.failed_login_attempts = 0; // Reset counter after lockout
        }
        await supabase
          .from('organizations')
          .update(updateData)
          .eq('email', normalizedEmail);
      }
      await recordLogin(req, { userId: org?.owner_user_id, email: normalizedEmail, success: false, failureReason: 'invalid_credentials' });
      return res.status(401).json({
        success: false,
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.'
      });
    }

    // Reset failed attempts on successful login
    if (org.failed_login_attempts > 0 || org.lockout_until) {
      await supabase
        .from('organizations')
        .update({ failed_login_attempts: 0, lockout_until: null })
        .eq('email', normalizedEmail);
    }

    const userId = org.owner_user_id;

    // Resolve role from the RBAC tables (admin_users → admin_user_roles →
    // roles) — the single source of truth for admin access.
    const access = await getAccessContext(userId);
    const role = access.isSuperAdmin ? 'super_admin' : 'organizer';

    // Issue httpOnly auth cookie + server-side session
    await issueAuthCookie(req, res, { id: userId, email: normalizedEmail, role });
    await recordLogin(req, { userId, email: normalizedEmail, success: true });

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      user: { id: userId, email: normalizedEmail, name: org.name, role, mustResetPassword: !!org.must_reset_password },
      organization: {
        id: org.id,
        owner_user_id: org.owner_user_id,
        name: org.name,
        email: org.email,
        phone: org.phone
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Logs the user out by clearing the httpOnly auth cookie.
 * POST /api/v1/auth/logout
 */
const logout = async (req, res) => {
  // Revoke the server-side session for this token's jti so it can't be replayed.
  try {
    const token = req.cookies?.[COOKIE_NAME] ||
      (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null);
    if (token) {
      const decoded = jwt.decode(token);
      if (decoded?.jti) await revokeByJti(decoded.jti);
    }
  } catch {
    // Non-fatal: clearing the cookie below still logs the user out.
  }
  clearAuthCookie(res);
  return res.status(200).json({ success: true, message: 'Logged out successfully.' });
};

/**
 * Handles password resets by generating and emailing a 6-digit OTP code.
 * POST /api/v1/auth/forgot-password
 */
const forgotPassword = async (req, res, next) => {
  const email = req.body.email ? req.body.email.toLowerCase().trim() : '';

  if (!email) {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'email is required.'
    });
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    // 1. Resolve organization by email
    const { data: orgs, error: fetchError } = await supabase
      .from('organizations')
      .select('id, name')
      .eq('email', normalizedEmail)
      .limit(1);

    if (fetchError) throw fetchError;

    const org = orgs && orgs[0];
    
    // If organization doesn't exist, return success anyway (prevent email enumeration vulnerability)
    if (!org) {
      logger.info('Password reset requested');
      return res.status(200).json({
        success: true,
        message: 'If the email exists, a password reset OTP code has been dispatched.'
      });
    }

    // 2. Generate 6-digit OTP code
    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes validity



    // 3. Save hashed OTP to organizations table and reset otp_attempts counter
    const { error: updateError } = await supabase
      .from('organizations')
      .update({
        reset_otp: otpHash,
        reset_otp_expires_at: expiresAt,
        otp_attempts: 0
      })
      .eq('email', normalizedEmail);

    if (updateError) throw updateError;

    // 4. Send email containing OTP (premium centralized template)
    const emailHtml = getPasswordResetTemplate(org.name, otp);

    const emailSent = await sendEmailViaBrevo(normalizedEmail, 'Password Reset Verification Code - Fancy RSVP', emailHtml);
    if (!emailSent) {
      throw new Error('Failed to dispatch password recovery email.');
    }

    logger.info({ email: normalizedEmail }, 'Password reset OTP dispatched');

    return res.status(200).json({
      success: true,
      message: 'If the email exists, a password reset OTP code has been dispatched.'
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Validates the reset OTP and updates the user's password.
 * POST /api/v1/auth/reset-password
 */
const resetPassword = async (req, res, next) => {
  const { otp, newPassword, confirmPassword } = req.body;
  const email = req.body.email ? req.body.email.toLowerCase().trim() : '';

  if (!email || !otp || !newPassword || !confirmPassword) {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'email, otp, newPassword, and confirmPassword are required.'
    });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'Passwords do not match.'
    });
  }

  // Password strength validation
  if (!passwordRegex.test(newPassword)) {
    return res.status(400).json({ success: false, error: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters with uppercase, lowercase, and a number' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    // 1. Fetch organization by email
    const { data: orgs, error: fetchError } = await supabase
      .from('organizations')
      .select('id, owner_user_id, email, reset_otp, reset_otp_expires_at, otp_attempts, password_hash')
      .eq('email', normalizedEmail)
      .limit(1);

    if (fetchError) throw fetchError;

    const org = orgs && orgs[0];
    if (!org) {
      return res.status(400).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'Invalid email or OTP code.'
      });
    }

    // 2. Check OTP attempt count (rate limiting)
    const otpAttempts = org.otp_attempts || 0;
    if (otpAttempts >= 5) {
      return res.status(429).json({
        success: false,
        error: 'TOO_MANY_ATTEMPTS',
        message: 'Too many attempts. Request a new OTP.'
      });
    }

    // 3. Validate OTP value and expiration
    const storedOtp = org.reset_otp;
    const expiresAt = org.reset_otp_expires_at;

    if (!storedOtp || !expiresAt || new Date() > new Date(expiresAt)) {
      // Increment OTP attempts on failure
      await supabase
        .from('organizations')
        .update({ otp_attempts: otpAttempts + 1 })
        .eq('email', normalizedEmail);

      return res.status(400).json({
        success: false,
        error: 'INVALID_OTP',
        message: 'The OTP code is invalid or has expired.'
      });
    }

    // Hash the submitted OTP and compare against stored hash (constant-time)
    const submittedHash = crypto.createHash('sha256').update(String(otp)).digest('hex');
    const otpMatch = storedOtp.length === submittedHash.length &&
      crypto.timingSafeEqual(Buffer.from(storedOtp, 'utf8'), Buffer.from(submittedHash, 'utf8'));

    if (!otpMatch) {
      // Increment OTP attempts on failure
      await supabase
        .from('organizations')
        .update({ otp_attempts: otpAttempts + 1 })
        .eq('email', normalizedEmail);

      return res.status(400).json({
        success: false,
        error: 'INVALID_OTP',
        message: 'The OTP code is invalid or has expired.'
      });
    }

    // 4. Hash the new password and clear the OTP fields, reset attempts
    const passwordHash = await hashPassword(newPassword);

    const { error: updateError } = await supabase
      .from('organizations')
      .update({
        password_hash: passwordHash,
        reset_otp: null,
        reset_otp_expires_at: null,
        otp_attempts: 0
      })
      .eq('email', normalizedEmail);

    if (updateError) throw updateError;

    // SECURITY: a password reset must invalidate EVERY existing session for this
    // account. Otherwise an attacker holding a live session (often the very reason
    // the user is resetting) keeps access until the 24h JWT expiry. Best-effort —
    // the reset itself has already committed, so session bookkeeping must not 500.
    try {
      await revokeAllForUser(org.owner_user_id);
    } catch (revokeErr) {
      logger.warn({ err: revokeErr, email: normalizedEmail }, 'resetPassword: failed to revoke existing sessions');
    }

    // Clear any existing auth cookie (force re-login with new password)
    clearAuthCookie(res);

    // Security confirmation (best-effort, non-blocking).
    sendEmailViaBrevo(normalizedEmail, 'Your Password Was Changed — Fancy RSVP', getPasswordChangedTemplate(org.name))
      .catch(() => {});

    return res.status(200).json({
      success: true,
      message: 'Your password has been successfully reset.'
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Fetches the authenticated user's organization profile.
 * GET /api/v1/auth/profile
 */
const getProfile = async (req, res, next) => {
  try {
    let { data: org, error } = await supabase
      .from('organizations')
      // `timezone` rides the branded select rather than the fallback below on
      // purpose: this endpoint already degrades gracefully when a column is
      // missing, so on a database without the timezone migration the profile
      // still loads — it just comes back without a zone, and every reader
      // falls back to the platform default instead of the dashboard breaking.
      .select('id, name, email, phone, created_at, bio, website, logo_url, social_links, password_hash, timezone, timezone_source')
      .eq('owner_user_id', req.user.id)
      .single();

    if (error && error.message && (error.message.includes('column') || error.message.includes('does not exist'))) {
      logger.info('Branding columns do not exist in organizations table yet; falling back to core fields');
      const fallbackResult = await supabase
        .from('organizations')
        .select('id, name, email, phone, created_at, password_hash')
        .eq('owner_user_id', req.user.id)
        .single();
      if (fallbackResult.error || !fallbackResult.data) {
        return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Profile not found' });
      }
      org = fallbackResult.data;
    } else if (error || !org) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Profile not found' });
    }

    // Surface an active impersonation session (see stopImpersonating below) so
    // the organizer-facing app can show a persistent indicator + a way back,
    // instead of an admin silently browsing as this account with no reminder.
    let impersonatorEmail = null;
    if (req.user.imp) {
      const { data: impOrg } = await supabase
        .from('organizations').select('email').eq('owner_user_id', req.user.imp).maybeSingle();
      impersonatorEmail = impOrg?.email || null;
    }

    const profileData = {
      ...org,
      hasPassword: !!org.password_hash,
      role: req.user.role || 'organizer',
      isSuperAdmin: !!req.user.isSuperAdmin,
      impersonating: !!req.user.imp,
      impersonatorEmail,
    };
    delete profileData.password_hash;

    res.json({ success: true, profile: profileData });
  } catch (err) {
    next(err);
  }
};

/**
 * Updates the authenticated user's organization profile.
 * PATCH /api/v1/auth/profile
 */
const updateProfile = async (req, res, next) => {
  try {
    const { name, phone, bio, website, logo_url, social_links, timezone } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (phone !== undefined) updates.phone = phone.trim();
    if (bio !== undefined) updates.bio = bio !== null ? bio.trim() : null;
    if (website !== undefined) updates.website = website !== null ? website.trim() : null;
    if (logo_url !== undefined) updates.logo_url = logo_url !== null ? logo_url.trim() : null;
    if (social_links !== undefined) updates.social_links = social_links;

    /**
     * The escape hatch the IP-detection design requires.
     *
     * Detection is a guess about a moment, and it has one predictable failure:
     * someone opening an account for a business in one country while sitting
     * in another. That organizer would be stamped with the wrong clock and,
     * with no way to correct it, would have no route back — every event they
     * ever create would advertise the wrong hour.
     *
     * Setting it by hand marks the row 'manual', which is what protects the
     * correction: any later re-resolution pass skips manual rows, so a human
     * decision is never overwritten by a lookup.
     *
     * Validated against the runtime's tz database rather than accepted as
     * free text — an unrecognised zone written here would throw much later,
     * inside a guest page render, with nothing pointing back at this request.
     */
    if (timezone !== undefined) {
      if (!isValidTimeZone(timezone)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_TIMEZONE',
          message: 'That is not a recognised timezone name.',
        });
      }
      updates.timezone = timezone;
      updates.timezone_source = 'manual';
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'NO_UPDATES', message: 'No fields to update' });
    }

    const { data: org, error } = await supabase
      .from('organizations')
      .update(updates)
      .eq('owner_user_id', req.user.id)
      .select('id, name, email, phone, bio, website, logo_url, social_links, timezone, timezone_source')
      .single();

    if (error) {
      if (error.message && (error.message.includes('column') || error.message.includes('does not exist'))) {
        logger.warn('Failed to update branding columns (columns do not exist); retrying with core fields only');
        const coreUpdates = {};
        if (name !== undefined) coreUpdates.name = name.trim();
        if (phone !== undefined) coreUpdates.phone = phone.trim();
        
        if (Object.keys(coreUpdates).length === 0) {
          return res.status(400).json({ success: false, error: 'MIGRATION_REQUIRED', message: 'Branding columns do not exist in the database. Please apply migrations.' });
        }

        /**
         * A DROPPED TIMEZONE IS NOT A PARTIAL SUCCESS — IT IS A FAILURE.
         *
         * This fallback exists so a database missing the optional branding
         * columns can still save a name and a phone number. Fine for a bio or a
         * logo: the organizer sees the field did not stick and tries again.
         *
         * The timezone is different in kind. It is invisible after saving —
         * nothing on this screen re-reads it against the server — so silently
         * discarding it and answering `success: true` teaches the organizer
         * their clock is set when the column is still null. Every event they
         * then create is filed under the platform default, and the first
         * symptom is a reminder arriving at the wrong hour days later, with
         * nothing connecting it back to this request.
         *
         * So: refuse. A visible error costs one confused save; a silent one
         * costs an event.
         */
        if (updates.timezone !== undefined) {
          logger.error({ err: error }, 'updateProfile: timezone could not be written — refusing to report success');
          return res.status(500).json({
            success: false,
            error: 'TIMEZONE_NOT_SAVED',
            message: 'Your timezone could not be saved. Nothing was changed — please try again or contact support.',
          });
        }

        const { data: retryOrg, error: retryErr } = await supabase
          .from('organizations')
          .update(coreUpdates)
          .eq('owner_user_id', req.user.id)
          .select('id, name, email, phone')
          .single();
          
        if (retryErr) throw retryErr;
        return res.json({ 
          success: true, 
          profile: retryOrg, 
          message: 'Profile updated (core fields only; branding columns do not exist).' 
        });
      }
      throw error;
    }

    /**
     * ── THE ACCOUNT ZONE DOES NOT REACH EXISTING EVENTS BY ITSELF ──
     *
     * `events.timezone` is a snapshot taken at creation, and that freeze is
     * deliberate: reading the organization's zone live would mean that
     * correcting a misdetected account silently moved every event, including
     * ones whose invitations already went out.
     *
     * The freeze is right and it is also incomplete — it left an organizer who
     * was filed under the wrong zone with no way to fix the events they already
     * had. So the answer is neither "follow live" nor "never follow": the save
     * REPORTS which events are on a different clock and the organizer applies
     * it in one deliberate step (POST /auth/profile/timezone/apply).
     *
     * The same propose-then-confirm shape the event-change notice already uses
     * — see eventController's `changeNotice`. Nothing here writes to events.
     */
    let timezonePropagation = null;
    if (updates.timezone) {
      try {
        const { data: stale } = await supabase
          .from('events')
          .select('id, title, event_date, timezone')
          .eq('org_id', org.id)
          .neq('status', 'cancelled')
          // The SAME set the apply will act on — including the upcoming-only
          // bound. A proposal that counts a different population than the
          // button changes is a number that lies, which is the failure this
          // whole propose-then-confirm shape exists to avoid.
          .gte('event_date', new Date().toISOString())
          .limit(MAX_EVENTS_PER_ORG);

        /**
         * A NULL ZONE ALWAYS NEEDS STAMPING — even when it resolves to the
         * target already.
         *
         * The obvious filter is `safeZone(e.timezone) !== target`, and it has a
         * hole that swallows the most common case on this platform: set the
         * account to America/Los_Angeles — which IS `PLATFORM_TIMEZONE` — and
         * every null-zone event resolves to exactly that, compares equal, and
         * is dropped from the proposal. The organizer is told nothing needs
         * changing while their events stay pinned to nothing at all.
         *
         * Two guesses matching is not agreement. A null row is not "already
         * correct", it is running on a value that lives in an environment
         * variable: the day `PLATFORM_TIMEZONE` changes — a second region, a
         * test box, a typo in an env file — every one of those events moves,
         * with no migration and no log line.
         *
         * So null is always included. Re-anchoring it is a no-op on the dates
         * when the effective zone already matches; the point is to write the
         * column down.
         */
        const affected = (stale || []).filter(
          (e) => !e.timezone || safeZone(e.timezone) !== updates.timezone,
        );
        if (affected.length > 0) {
          timezonePropagation = {
            timezone: updates.timezone,
            count: affected.length,
            // True when the cap bound, so the UI can say "at least N" rather
            // than quoting a number that is really a limit.
            truncated: (stale || []).length >= MAX_EVENTS_PER_ORG,
            /**
             * `readsAs` and `shiftHours`, NOT a before/after pair of times.
             *
             * A first draft sent both a "reads now" and a "would read" and they
             * came out identical — which is not a bug in the formatting, it is
             * the whole point of re-anchoring: the hour the organizer typed is
             * kept and the underlying instant is what moves. Showing the same
             * string twice would tell them nothing changes, when in fact their
             * reminders move by `shiftHours`.
             *
             * So: the hour that stays, and the size of the move underneath it.
             */
            events: affected.slice(0, 20).map((e) => {
              const at = e.event_date ? new Date(e.event_date).getTime() : Date.now();
              const from = safeZone(e.timezone);
              // Positive = the real moment moves LATER.
              const shiftMs = zoneOffsetMs(at, from) - zoneOffsetMs(at, updates.timezone);
              return {
                id: e.id,
                title: e.title,
                currentTimezone: e.timezone || null,
                readsAs: formatInZone(e.event_date, from, {
                  year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
                }),
                shiftHours: Number((shiftMs / 3600000).toFixed(2)),
              };
            }),
          };
        }
      } catch (propErr) {
        // Never fail the profile save over the proposal — the zone IS saved.
        logger.warn({ err: propErr }, 'updateProfile: could not build the timezone propagation proposal');
      }
    }

    res.json({ success: true, profile: org, timezonePropagation, message: 'Profile updated successfully' });
  } catch (err) {
    next(err);
  }
};

/**
 * Applies the organization's timezone to its existing events.
 * POST /api/v1/auth/profile/timezone/apply
 *
 * The confirm half of the proposal `updateProfile` returns. Separate endpoint,
 * separate deliberate action — see the note there for why the account zone does
 * not simply flow through to events on its own.
 *
 * ── WHAT THIS ACTUALLY DOES TO A DATE ──
 *
 * RE-ANCHORS it: the wall clock the organizer typed is kept and the stored
 * instant is recomputed. An event showing "18:30" still shows "18:30"
 * afterwards, on every screen and in every invitation already sent — what moves
 * is the moment that 18:30 refers to, and with it the reminder, the seating
 * reveal and every "is this over yet" check.
 *
 * That is the correct direction for the case this exists to fix — an account
 * filed under the wrong zone — and it is the reason the operation is safe to
 * offer at all: nothing a guest has ever been shown changes.
 *
 * Idempotent: an event already on the target zone is skipped, so running it
 * twice cannot double-shift anything. That guard is load-bearing — a double
 * shift is silent and looks exactly like the original error.
 */
const applyTimezoneToEvents = async (req, res, next) => {
  try {
    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .select('id, timezone')
      .eq('owner_user_id', req.user.id)
      .single();

    if (orgErr || !org) {
      return res.status(403).json({ success: false, error: 'ORG_NOT_FOUND', message: 'No organization found for this user' });
    }
    if (!org.timezone) {
      return res.status(400).json({
        success: false,
        error: 'NO_ACCOUNT_TIMEZONE',
        message: 'Set your account timezone first.',
      });
    }

    const target = org.timezone;
    /**
     * UPCOMING EVENTS ONLY — a past one is left exactly as recorded.
     *
     * Re-anchoring a finished event buys nothing: the hour it displays is
     * computed in its own zone, so moving both together leaves every screen
     * reading identically. There is no visible gain.
     *
     * There is a real loss. Shifting a just-finished event forward can push it
     * back inside the 24-hour reminder window, and the reminder's dedupe ref
     * now carries the event date — so the new instant mints a NEW key and the
     * day-before reminder fires again, to every confirmed guest, about a party
     * that has already happened. Charged texts for an event that is over.
     *
     * `event_date >= now` is the cheapest boundary that cannot do that.
     */
    const { data: events, error: evErr } = await supabase
      .from('events')
      .select('id, event_date, event_end_date, rsvp_deadline, timezone')
      .eq('org_id', org.id)
      .neq('status', 'cancelled')
      .gte('event_date', new Date().toISOString())
      .limit(MAX_EVENTS_PER_ORG);

    if (evErr) throw evErr;

    let updated = 0;
    const failures = [];

    for (const ev of (events || [])) {
      const from = safeZone(ev.timezone);
      /**
       * The idempotency guard — and it deliberately does NOT skip a null zone.
       *
       * `ev.timezone &&` is the load-bearing half. Without it, an event with no
       * zone whose default happens to resolve to the target is skipped as
       * "already done" and its column stays null forever — which is precisely
       * the state this endpoint exists to end. See the matching note in
       * updateProfile.
       *
       * For such a row the re-anchor below is a no-op on every date (same zone
       * in, same zone out) and the only real write is the column itself.
       *
       * What the guard DOES stop is a second run re-anchoring an event that has
       * already moved. That matters: a double shift is silent (18:30 → 01:30 →
       * 08:30), looks exactly like the original error, and nothing in the row
       * records that it happened twice.
       */
      if (ev.timezone && from === target) continue;

      const patch = { timezone: target };
      for (const field of ['event_date', 'event_end_date', 'rsvp_deadline']) {
        const stored = ev[field];
        if (!stored) continue;
        const wall = instantToWallClock(stored, from);
        if (!wall) continue;
        patch[field] = wallClockToInstant(wall, target);
      }

      // One row at a time, and a failure does not abandon the rest: a partial
      // apply leaves some events corrected and some not, which the organizer
      // can see and re-run, whereas aborting on the first error leaves them
      // with no idea how far it got.
      const { error: upErr } = await supabase.from('events').update(patch).eq('id', ev.id);
      if (upErr) failures.push(ev.id); else updated += 1;
    }

    if (failures.length > 0) {
      logger.error({ orgId: org.id, failures }, 'applyTimezoneToEvents: some events could not be updated');
    }

    return res.json({
      success: failures.length === 0,
      timezone: target,
      updated,
      failed: failures.length,
      message: failures.length === 0
        ? `${updated} event${updated === 1 ? '' : 's'} moved to ${target}. The times shown to guests are unchanged.`
        : `${updated} updated, ${failures.length} could not be changed. Please try again.`,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Changes the authenticated user's password after verifying the current one.
 * POST /api/v1/auth/change-password
 */
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({ success: false, error: 'MISSING_FIELDS', message: 'New password is required' });
    }

    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({ success: false, error: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters with uppercase, lowercase, and a number' });
    }

    // Get current org
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, email, password_hash')
      .eq('owner_user_id', req.user.id)
      .single();

    if (orgError || !org) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Profile not found' });
    }

    if (org.password_hash) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, error: 'MISSING_FIELDS', message: 'Current password is required' });
      }
      const isValid = await verifyPassword(currentPassword, org.password_hash, org.email);
      if (!isValid) {
        return res.status(400).json({ success: false, error: 'WRONG_PASSWORD', message: 'Current password is incorrect' });
      }
      if (currentPassword === newPassword) {
        return res.status(400).json({ success: false, error: 'SAME_PASSWORD', message: 'New password must be different from your current password.' });
      }
    }

    const newHash = await hashPassword(newPassword);

    const { error: updateError } = await supabase
      .from('organizations')
      .update({ password_hash: newHash, must_reset_password: false })
      .eq('id', org.id);

    if (updateError) throw updateError;

    // SECURITY: revoke all existing sessions on password change (e.g. a stolen
    // session on another device), THEN mint a fresh session below so this device
    // stays logged in. Order matters: issueAuthCookie records a NEW jti after the
    // revoke, so the new session survives. Best-effort — the change already committed.
    try {
      await revokeAllForUser(req.user.id);
    } catch (revokeErr) {
      logger.warn({ err: revokeErr, userId: req.user.id }, 'changePassword: failed to revoke existing sessions');
    }

    // Re-issue auth cookie with fresh token after password change
    await issueAuthCookie(req, res, { id: req.user.id, email: org.email, role: req.user.role });

    // Security confirmation (best-effort, non-blocking).
    sendEmailViaBrevo(org.email, 'Your Password Was Changed — Fancy RSVP', getPasswordChangedTemplate(org.name))
      .catch(() => {});

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    next(err);
  }
};

/**
 * Authenticates via Google OAuth — works for ALL users, new and existing.
 *
 * Single "Continue with Google" entry point used by both the sign-in and
 * sign-up pages:
 *   - If the email already has an account → logs them in.
 *   - If the email is new → creates the account (no password, email auto-verified
 *     since Google already verified it) and logs them in.
 *   - If an unverified email/password registration exists → activates it and logs in.
 *
 * POST /api/v1/auth/google
 */
const googleAuth = async (req, res, next) => {
  const { credential } = req.body;

  if (!credential) {
    return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', message: 'Google credential is required.' });
  }

  try {
    // Verify Google token using google-auth-library (cryptographic verification)
    const expectedClientId = process.env.GOOGLE_CLIENT_ID;
    if (!expectedClientId) {
      return res.status(500).json({ success: false, error: 'CONFIG_ERROR', message: 'Google Sign-In is not configured on the server.' });
    }

    let googleData;
    try {
      const oAuth2Client = new OAuth2Client(expectedClientId);
      const ticket = await oAuth2Client.verifyIdToken({
        idToken: credential,
        audience: expectedClientId,
      });
      googleData = ticket.getPayload();
    } catch (tokenErr) {
      logger.warn({ error: tokenErr.message }, 'Google token verification failed');
      return res.status(401).json({ success: false, error: 'INVALID_TOKEN', message: 'Invalid or expired Google token.' });
    }

    if (!googleData.email_verified) {
      return res.status(400).json({ success: false, error: 'EMAIL_NOT_VERIFIED', message: 'Your Google email is not verified.' });
    }

    const email = googleData.email ? googleData.email.toLowerCase().trim() : '';
    if (!email) {
      return res.status(400).json({ success: false, error: 'NO_EMAIL', message: 'Could not retrieve your email from Google.' });
    }
    const name = googleData.name || googleData.given_name || 'User';

    // Look up an existing account by email
    const { data: orgs } = await supabase
      .from('organizations')
      .select('id, owner_user_id, name, email, phone, email_verified')
      .eq('email', email)
      .limit(1);

    let org = orgs && orgs[0];
    const isNewAccount = !org;

    if (org) {
      // Existing account → ensure it's verified (Google already verified the email).
      if (!org.email_verified) {
        // SECURITY (account pre-hijacking): an account that is still UNVERIFIED at
        // this point may carry a password_hash that was set before anyone proved
        // ownership of the email — e.g. an attacker who pre-registered the victim's
        // address with their own password, betting the real owner would later sign
        // in with Google (which auto-verifies and activates the account). If we only
        // flip email_verified, that attacker password keeps working forever. Wipe
        // any such credential so only Google — or a fresh, email-verified reset —
        // can authenticate, and revoke any sessions the pre-registration opened.
        await supabase
          .from('organizations')
          .update({ email_verified: true, password_hash: null })
          .eq('email', email);
        try {
          await revokeAllForUser(org.owner_user_id);
        } catch (revokeErr) {
          logger.warn({ err: revokeErr, email }, 'googleAuth: failed to revoke sessions on account activation');
        }
      }
    } else {
      // New account → create it with no password, email pre-verified
      const newUserId = crypto.randomUUID();
      const refCode = (req.body.refCode || '').toString().trim();
      const [referrerOrgId, referralCode, signupTimezone] = await Promise.all([
        refCode ? resolveReferrerOrgId(refCode) : Promise.resolve(null),
        generateUniqueReferralCode(),
        // Google sign-up creates a real account with no OTP step, so it is a
        // first-class signup path and must stamp the zone exactly as the
        // password path does. Missing it here would have left every
        // Google-created organizer on the fallback default forever, since
        // nothing downstream ever revisits the question.
        resolveSignupTimezone(req),
      ]);
      const { error: orgError } = await supabase
        .from('organizations')
        .insert({
          owner_user_id: newUserId,
          name,
          email,
          password_hash: null,
          email_verified: true,
          referral_code: referralCode,
          referred_by_org_id: referrerOrgId,
          ...signupTimezone,
        });
      if (orgError) throw orgError;

      // Re-fetch to pick up the DB-generated id
      const { data: created } = await supabase
        .from('organizations')
        .select('id, owner_user_id, name, email, phone')
        .eq('email', email)
        .single();
      org = created || { owner_user_id: newUserId, name, email };
    }

    const userId = org.owner_user_id;

    // Resolve role from the RBAC tables — same source of truth as password login.
    const access = await getAccessContext(userId);
    const role = access.isSuperAdmin ? 'super_admin' : 'organizer';

    // Issue auth cookie
    await issueAuthCookie(req, res, { id: userId, email: email, role });
    await recordLogin(req, { userId, email, success: true });

    logger.info({ email, isNewAccount }, 'Google authentication successful');

    // Onboarding welcome for brand-new Google accounts (best-effort, non-blocking).
    if (isNewAccount) {
      sendEmailViaBrevo(email, 'Welcome to Fancy RSVP', getOrganizerWelcomeTemplate(org.name || name))
        .catch(() => {});
      supabase.from('organizations').update({ welcome_sent_at: new Date().toISOString() }).eq('owner_user_id', userId).then(() => {}, () => {});
    }

    return res.status(isNewAccount ? 201 : 200).json({
      success: true,
      message: isNewAccount ? 'Account created successfully via Google.' : 'Login successful.',
      user: { id: userId, email, name: org.name || name, role },
      organization: { id: org.id, owner_user_id: userId, name: org.name || name, email: org.email || email, phone: org.phone }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Ends the current admin impersonation session and restores the impersonating
 * admin's own session — the counterpart to admin/userMgmtController.js's
 * impersonateOrganizer. Trusts the `imp` claim because it can only ever have
 * been set by that already-permission-checked endpoint; re-validates the
 * impersonator still holds admin access before restoring them (they may have
 * been demoted/banned while the impersonation was live).
 * POST /api/v1/auth/stop-impersonating
 */
const stopImpersonating = async (req, res, next) => {
  const impersonatorId = req.user.imp;
  if (!impersonatorId) {
    return res.status(400).json({ success: false, error: 'NOT_IMPERSONATING', message: 'You are not currently impersonating anyone.' });
  }
  try {
    // Revoke the impersonation session so the token that led here can't be replayed.
    if (req.user.jti) await revokeByJti(req.user.jti);

    const access = await getAccessContext(impersonatorId);
    if (!access.isAdmin) {
      clearAuthCookie(res);
      return res.status(403).json({ success: false, error: 'ADMIN_ACCESS_REVOKED', message: 'Your admin access has been revoked. Please log in again.' });
    }

    const { data: adminOrg } = await supabase
      .from('organizations').select('email').eq('owner_user_id', impersonatorId).maybeSingle();
    const role = access.isSuperAdmin ? 'super_admin' : 'organizer';

    await issueAuthCookie(req, res, { id: impersonatorId, email: adminOrg?.email || null, role });

    return res.json({ success: true, message: 'Returned to your admin account.' });
  } catch (err) {
    next(err);
  }
};

const getSessions = async (req, res, next) => {
  try {
    const { data: sessions, error } = await supabase
      .from('sessions')
      .select('id, jti, ip, user_agent, device_label, created_at, last_seen_at, expires_at, revoked_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const activeSessions = (sessions || []).map(s => ({
      id: s.id,
      ip: s.ip,
      user_agent: s.user_agent,
      device_label: s.device_label,
      created_at: s.created_at,
      last_seen_at: s.last_seen_at,
      expires_at: s.expires_at,
      revoked_at: s.revoked_at,
      isCurrent: s.jti === req.user.jti,
      isActive: !s.revoked_at && (!s.expires_at || new Date(s.expires_at).getTime() > Date.now())
    }));

    res.json({ success: true, sessions: activeSessions });
  } catch (err) {
    next(err);
  }
};

const revokeSession = async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'MISSING_SESSION_ID', message: 'Session ID is required.' });
    }

    const { data: session, error: findError } = await supabase
      .from('sessions')
      .select('jti, user_id')
      .eq('id', sessionId)
      .single();

    if (findError || !session) {
      return res.status(404).json({ success: false, error: 'SESSION_NOT_FOUND', message: 'Session not found.' });
    }

    if (session.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'FORBIDDEN', message: 'You do not have permission to revoke this session.' });
    }

    const { error: updateError } = await supabase
      .from('sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', sessionId);

    if (updateError) throw updateError;

    res.json({ success: true, message: 'Session revoked successfully.' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  register,
  verifyRegistration,
  login,
  logout,
  forgotPassword,
  resetPassword,
  getProfile,
  updateProfile,
  applyTimezoneToEvents,
  changePassword,
  googleAuth,
  stopImpersonating,
  getSessions,
  revokeSession,
  // Exposed for admin tooling (Master Plan §5 — admin-initiated password reset).
  hashPassword,
};
