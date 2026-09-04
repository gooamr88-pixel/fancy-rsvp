// Size the libuv threadpool BEFORE anything triggers it (PBKDF2 password hashing
// runs on this pool; the default of 4 makes concurrent logins queue). Authoritative
// value comes from the environment (pm2 ecosystem sets 16); this is the fallback
// for a direct `node server.js`. Must run before the first crypto/fs/dns call.
if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = '16';
}

// Load .env WITHOUT override so real environment variables always win. In
// production pm2 sets NODE_ENV/PORT/UV_THREADPOOL_SIZE via ecosystem.config.js;
// `override: true` let a stale backend/.env silently clobber those (e.g. flip
// NODE_ENV back to development, disabling secure cookies). dotenv only fills in
// keys that aren't already present in the environment, so nothing is lost.
require('dotenv').config();
const app = require('./app');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  logger.info(`=========================================`);
  logger.info(`🚀 Fancy RSVP Backend running on port ${PORT}`);
  logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`=========================================`);

  // BACKEND_URL feeds absolute URLs embedded in outgoing emails (e.g. the QR
  // check-in ticket image). Left unset in production, it silently falls back
  // to localhost — guests then get an image no one outside this machine can
  // ever load. Catch that misconfiguration loudly at boot instead.
  if (process.env.NODE_ENV === 'production' && !process.env.BACKEND_URL) {
    logger.error('BACKEND_URL is not set in production — emailed QR code images and other absolute links will point at localhost and fail to load for guests.');
  }

  // Which SMS carrier is live, said once, at boot. Without this the only way to
  // answer "are we on Twilio or Vonage right now?" is to read .env on the server —
  // and the answer decides whether messages are going out at all. Each provider
  // also warns here about its own half-configured states (missing credentials, or
  // a missing Vonage signature secret, which silently disables refunds).
  try {
    const smsProvider = require('./services/smsProviders').resolveProvider();
    logger.info(`📱 SMS carrier: ${smsProvider.name} (${smsProvider.isConfigured() ? 'configured' : 'NOT configured — sending disabled'})`);
    smsProvider.logConfigWarnings();
  } catch (err) {
    logger.warn({ err }, 'Could not report the active SMS carrier at boot');
  }

  // Lifecycle email automation (reminders, reports, post-event). No-ops unless
  // EMAIL_AUTOMATION_ENABLED=true; single-leader + idempotent (see emailScheduler).
  try {
    require('./services/emailScheduler').start();
  } catch (err) {
    logger.warn({ err }, 'Email scheduler failed to start (non-fatal)');
  }

  // The async SMS campaign worker used to start here. It drained free-text
  // campaigns, which no longer exist — the four-type rebuild replaced them with
  // templated messages that send inline or from the email scheduler, so there is
  // no queue left to drain. SMS_WORKER_ENABLED is now unread; remove it from any
  // deployment env file you still have it in.

  // Daily revenue rollup refresher — keeps mv_daily_revenue (Financial Command
  // Center §22) current. On by default; single-leader + idempotent (see
  // revenueRollup). Disable with REVENUE_ROLLUP_ENABLED=false.
  try {
    require('./services/revenueRollup').start();
  } catch (err) {
    logger.warn({ err }, 'Revenue rollup refresher failed to start (non-fatal)');
  }

  // Abandoned draft cleanup — removes never-paid 'draft' events untouched for
  // DRAFT_EXPIRY_DAYS (default 30). On by default; single-leader + idempotent
  // (see draftCleanup). Disable with DRAFT_CLEANUP_ENABLED=false.
  try {
    require('./services/draftCleanup').start();
  } catch (err) {
    logger.warn({ err }, 'Draft cleanup failed to start (non-fatal)');
  }

  // Post-event data purge — warns the organizer when their event ends, then
  // permanently deletes everything belonging to it PURGE_GRACE_HOURS later
  // (default 24). OFF by default and opt-in, unlike the cleanup above: this one
  // destroys real customer data. Enable with EVENT_PURGE_ENABLED=true.
  try {
    require('./services/eventPurge').start();
  } catch (err) {
    logger.warn({ err }, 'Event purge failed to start (non-fatal)');
  }
});

// Handle graceful shutdown
function gracefulShutdown(signal) {
  logger.info(`${signal} signal received: closing HTTP server`);
  try { require('./services/emailScheduler').stop(); } catch { /* ignore */ }
  try { require('./services/revenueRollup').stop(); } catch { /* ignore */ }
  try { require('./services/draftCleanup').stop(); } catch { /* ignore */ }
  try { require('./services/eventPurge').stop(); } catch { /* ignore */ }
  server.close(() => {
    logger.info('HTTP server closed — all connections drained');
    process.exit(0);
  });
  // Force exit after 10 seconds if connections don't drain
  const forceTimer = setTimeout(() => {
    logger.warn(`Forced shutdown after 10s timeout (${signal})`);
    process.exit(1);
  }, 10000);
  if (forceTimer.unref) forceTimer.unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

// Catch uncaught exceptions — log and exit gracefully
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — shutting down');
  server.close(() => {
    process.exit(1);
  });
  // Force exit if server hasn't closed within 10 seconds
  setTimeout(() => process.exit(1), 10000).unref();
});
