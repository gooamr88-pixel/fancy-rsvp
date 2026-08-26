const express = require('express');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const authController = require('../controllers/authController');

const router = express.Router();

// SEC H1: Strict per-endpoint rate limiters for sensitive auth routes.
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'TOO_MANY_REQUESTS', message: 'Too many login attempts. Please try again after a minute.' },
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'TOO_MANY_REQUESTS', message: 'Too many registration attempts. Please try again later.' },
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'TOO_MANY_REQUESTS', message: 'Too many password reset attempts. Please try again later.' },
});

// Defense-in-depth alongside the per-account otp_attempts cap in the controller
// (which is what actually stops a single account's code from being brute-forced) —
// this just brings verify-registration in line with every other sensitive auth
// route, all of which already have an IP-level limiter.
const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'TOO_MANY_REQUESTS', message: 'Too many verification attempts. Please try again later.' },
});

// Register new organizer (creates unverified account + sends OTP): POST /api/v1/auth/register
router.post('/register', [
  signupLimiter,
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('name').trim().notEmpty().withMessage('Your name is required'),
  // Organization name is optional — the controller falls back to the person's name
  // (mirroring the Google sign-up flow). Validate length only when a value is present.
  body('orgName').optional({ values: 'falsy' }).trim().isLength({ max: 200 }).withMessage('Organization name must be 200 characters or fewer'),
  validate
], authController.register);

// Verify registration OTP (activates account + issues auth cookie): POST /api/v1/auth/verify-registration
router.post('/verify-registration', [
  otpVerifyLimiter,
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('otp').isLength({ min: 6, max: 6 }).isNumeric().withMessage('Valid 6-digit OTP is required'),
  validate
], authController.verifyRegistration);

// Login organizer (issues auth cookie): POST /api/v1/auth/login
router.post('/login', [
  loginLimiter,
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
  validate
], authController.login);

// Logout (clears auth cookie): POST /api/v1/auth/logout
router.post('/logout', authController.logout);

// Ends an active admin impersonation session, restoring the admin's own session:
// POST /api/v1/auth/stop-impersonating
router.post('/stop-impersonating', requireAuth, authController.stopImpersonating);

// Google OAuth (unified — logs in existing users, creates new ones): POST /api/v1/auth/google
router.post('/google', [
  body('credential').notEmpty().withMessage('Google credential is required'),
  validate
], authController.googleAuth);

// Forgot password link trigger: POST /api/v1/auth/forgot-password
router.post('/forgot-password', [
  passwordResetLimiter,
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  validate
], authController.forgotPassword);

// Reset password with OTP code: POST /api/v1/auth/reset-password
router.post('/reset-password', [
  passwordResetLimiter,
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('otp').isLength({ min: 6, max: 6 }).isNumeric().withMessage('Valid 6-digit OTP is required'),
  body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('confirmPassword').notEmpty().withMessage('Confirm password is required'),
  validate
], authController.resetPassword);

// Get authenticated user's profile: GET /api/v1/auth/profile
router.get('/profile', requireAuth, authController.getProfile);

// Update authenticated user's profile: PATCH /api/v1/auth/profile
router.patch('/profile', [
  requireAuth,
  body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
  body('phone').optional().trim().notEmpty().withMessage('Phone cannot be empty'),
  validate
], authController.updateProfile);

/* Apply the account timezone to existing events: POST /api/v1/auth/profile/timezone/apply
   The confirm half of the proposal PATCH /profile returns. Deliberately a
   separate call — it rewrites stored instants on every event the organization
   owns, which is not something a profile save should do as a side effect. */
router.post('/profile/timezone/apply', requireAuth, authController.applyTimezoneToEvents);

// Change password (requires current password): POST /api/v1/auth/change-password
router.post('/change-password', [
  requireAuth,
  body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
  validate
], authController.changePassword);

// Get active sessions: GET /api/v1/auth/sessions
router.get('/sessions', requireAuth, authController.getSessions);

// Revoke a specific session: POST /api/v1/auth/sessions/:sessionId/revoke
router.post('/sessions/:sessionId/revoke', requireAuth, authController.revokeSession);

module.exports = router;
