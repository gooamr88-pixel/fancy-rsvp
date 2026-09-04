const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const logger = require('./utils/logger');
const { requireAuth, verifyEventOwner, requireSuperAdmin } = require('./middleware/auth');

// Startup environment validation — fail fast if critical secrets are missing.
const REQUIRED_ENV = ['JWT_SECRET', 'QR_JWT_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GOOGLE_CLIENT_ID', 'IP_HASH_SALT'];
// Stripe secrets are required only when card payments are turned ON. Pre-live /
// manual-only mode boots with no Stripe keys. Keyed off the operator's INTENT
// (the flag) so enabling card payments without keys fails loudly instead of
// silently staying disabled.
const stripeIntended = /^(1|true|yes|on)$/i.test(String(process.env.PAYMENTS_STRIPE_ENABLED || '').trim());
if (stripeIntended) REQUIRED_ENV.push('STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET');
const missing = REQUIRED_ENV.filter(key => !process.env[key]);
if (missing.length > 0) {
  logger.error(`FATAL: Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const app = express();

// Behind nginx (Hostinger) the app receives every request from 127.0.0.1 with the
// real client IP in X-Forwarded-For. Trust exactly ONE proxy hop so:
//   • req.ip is the real client → rate limiters bucket per-user, not globally
//   • req.protocol reflects https (X-Forwarded-Proto) for correct redirect/callback URLs
// Use a numeric hop count (not `true`) so a spoofed XFF can't impersonate an IP.
app.set('trust proxy', 1);

// Enable security headers
app.use(helmet({
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  crossOriginEmbedderPolicy: false,
  // Explicit HSTS (L2): force HTTPS for a year, including subdomains, preload-eligible.
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));


// Configure CORS with multi-origin support.
// Use the shared resolver so malformed FRONTEND_URL entries (missing colon, trailing
// slash) are repaired into valid origins instead of silently failing CORS.
const { getAllowedOrigins } = require('./utils/publicUrl');
const allowedOrigins = getAllowedOrigins();
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Gzip responses (large JSON: event lists, RSVP lists, exports). The threshold
// avoids spending CPU compressing tiny payloads.
app.use(compression({ threshold: 1024 }));

// Parse cookies (httpOnly auth cookie)
app.use(cookieParser());

// SEC-2: the public, unauthenticated guest RSVP writes must NOT accept large
// bodies (the 50mb global limit exists for authenticated CSV/image uploads). A
// tight parser mounted on these paths first sets req._body, so the global parser
// below short-circuits for them. An RSVP — even a party of 20 with custom answers
// — is well under 64kb.
const tightJson = express.json({ limit: '64kb' });
app.use('/api/v1/public/events/:slug/rsvp', tightJson);
app.use('/api/v1/public/rsvp', tightJson);

app.use(express.json({
  limit: '50mb',
  verify: (req, res, buf) => {
    if (req.originalUrl && req.originalUrl.startsWith('/api/v1/payments/webhook')) {
      req.rawBody = buf;
    }
  }
}));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ─── RATE LIMITING ───
// DISABLE_RATE_LIMIT=true turns limiting off entirely — ONLY for load testing
// against a throwaway environment. Never set this in production.
const RATE_LIMIT_DISABLED = process.env.DISABLE_RATE_LIMIT === 'true';

// Optional shared Redis store so limits are GLOBAL across pm2 cluster workers /
// horizontally-scaled instances. The default MemoryStore is per-process, which
// means with `instances: N` the effective limit is N× and inconsistent. Activates
// only when REDIS_URL is set AND the optional deps (ioredis, rate-limit-redis)
// are installed; otherwise it transparently falls back to the in-memory store.
let redisClient = null;
if (!RATE_LIMIT_DISABLED && process.env.REDIS_URL) {
  try {
    const IORedis = require('ioredis');
    redisClient = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: 2 });
    redisClient.on('error', (e) => logger.error({ err: e.message }, 'Redis (rate-limit) error'));
    logger.info('Rate limiting backed by Redis (shared across instances)');
  } catch (e) {
    logger.warn(`REDIS_URL set but ioredis unavailable — falling back to in-memory rate limiter. (${e.message})`);
  }
}
// `rate-limit-redis` is resolved ONCE, here, rather than inside storeFor(). It is
// an optional dependency, so it can legitimately be absent — and when it was
// required lazily per limiter, having ioredis installed WITHOUT it threw an
// uncaught MODULE_NOT_FOUND while the limiters were being constructed, i.e. the
// API refused to boot at all. A missing optional dep must degrade to the
// in-memory store with a warning, never take the server down.
let RedisStore = null;
if (redisClient) {
  try {
    ({ RedisStore } = require('rate-limit-redis'));
  } catch (e) {
    RedisStore = null;
    redisClient = null;
    logger.warn(`REDIS_URL set and ioredis present, but rate-limit-redis is not installed — falling back to the per-process in-memory rate limiter. Install it with: npm install rate-limit-redis (${e.message})`);
  }
}

const storeFor = (prefix) => {
  // undefined => express-rate-limit's default MemoryStore. NOTE: MemoryStore is
  // PER PROCESS, and ecosystem.config.js runs the API with `instances: 'max'` in
  // cluster mode — so without Redis each worker keeps its own counter and the
  // effective limit is N× and, worse, non-deterministic: the same client can be
  // allowed or throttled depending purely on which worker answered. Set REDIS_URL
  // (and install the two optional deps) to make limits coherent.
  if (!redisClient || !RedisStore) return undefined;
  return new RedisStore({ sendCommand: (...args) => redisClient.call(...args), prefix: `rl:${prefix}:` });
};

// The Next.js server renders public event pages by calling this API. Those calls
// arrive from the box itself, so they all collapse onto ONE rate-limit key and
// would otherwise throttle server-side rendering for every guest on earth after a
// few dozen renders. Loopback is not a threat model — exempt it everywhere.
// (See frontend/src/app/[slug]/page.js, which now targets INTERNAL_API_URL.)
const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const skipInternal = (req) => LOOPBACK_IPS.has(req.ip);

// Twilio's two webhooks. Every message in a campaign produces 2-3 status callbacks,
// so a 20,000-recipient send generates tens of thousands of POSTs from Twilio's
// narrow IP range — far past the general 1,000/15min budget. Worse, Twilio does NOT
// retry the INBOUND-message webhook: a 429 on /sms/inbound means a guest's STOP is
// lost permanently, which is a TCPA violation, not a dropped request.
//
// Exempting them is safe because neither is authenticated by IP or volume: both
// verify an HMAC-SHA1 X-Twilio-Signature over the full URL + body before touching
// the database (campaignController.validateTwilioSignature), and an unsigned request
// is rejected with 403. A dedicated wide limiter below still bounds total volume.
const TWILIO_WEBHOOK_PATHS = new Set([
  '/api/v1/public/sms/status',
  '/api/v1/public/sms/inbound',
]);
const isTwilioWebhook = (req) => TWILIO_WEBHOOK_PATHS.has((req.originalUrl || '').split('?')[0]);

if (RATE_LIMIT_DISABLED) {
  logger.warn('⚠️  Rate limiting is DISABLED (DISABLE_RATE_LIMIT=true). Do NOT run production like this.');
} else {
  // Permissive limiter for organizer dashboards (preventing blockages on updates)
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limit each IP to 1000 requests per window
    message: { success: false, error: 'TOO_MANY_REQUESTS', message: 'Too many requests. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => skipInternal(req) || isTwilioWebhook(req),
    store: storeFor('api'),
  });
  app.use('/api', apiLimiter);

  // Signature-verified Twilio callbacks get their own, far wider ceiling: high
  // enough that a maximum-size campaign's delivery receipts never touch it, low
  // enough to bound an unsigned flood (which is rejected at 403 anyway).
  const twilioWebhookLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100000,
    message: { success: false, error: 'TOO_MANY_REQUESTS' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipInternal,
    store: storeFor('twilio-webhook'),
  });
  app.use('/api/v1/public/sms/status', twilioWebhookLimiter);
  app.use('/api/v1/public/sms/inbound', twilioWebhookLimiter);

  // Strict limiter for authentication endpoints (brute-force protection)
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15, // 15 attempts per 15 minutes per IP
    message: { success: false, error: 'TOO_MANY_AUTH_REQUESTS', message: 'Too many authentication attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    store: storeFor('auth'),
  });
  app.use('/api/v1/auth/login', authLimiter);
  app.use('/api/v1/auth/register', authLimiter);
  app.use('/api/v1/auth/forgot-password', authLimiter);
  app.use('/api/v1/auth/reset-password', authLimiter);
  app.use('/api/v1/auth/verify-registration', authLimiter);
  app.use('/api/v1/auth/google', authLimiter);

  // Device pairing and token refresh are UNAUTHENTICATED credential exchanges
  // (the tablet has nothing else yet), so they get the same brute-force budget
  // as login. An 8-char code from a 31-symbol alphabet is only safe inside its
  // 10-minute window if guessing is rate-limited.
  app.use('/api/v1/checkin/devices/pair', authLimiter);
  app.use('/api/v1/checkin/devices/refresh', authLimiter);

  // ─── Public guest surface: READS and WRITES are limited SEPARATELY ───
  //
  // These used to share one 30-per-15-minutes limiter mounted on the whole
  // `/api/v1/public/events` PREFIX. That prefix is not just RSVP submissions — it
  // is also `GET /public/events/:slug`, i.e. the invitation page itself, plus the
  // analytics beacon and the seating lookups. Since `trust proxy` correctly
  // resolves req.ip to the real client, and guests overwhelmingly arrive from
  // shared addresses (mobile carrier CGNAT, one household/office/venue Wi-Fi),
  // ~15 invitation opens per address per 15 minutes would start returning 429 —
  // which the guest UI rendered as a permanent "Event Not Found". Reads now get a
  // budget sized for humans sharing an IP; only the state-changing endpoints keep
  // the strict submission cap.
  const publicWriteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30, // 30 submissions per 15 minutes per IP
    message: { success: false, error: 'TOO_MANY_REQUESTS', message: 'Too many submissions. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipInternal,
    store: storeFor('publicwrite'),
  });
  const publicReadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1200, // ~80 invitation opens/minute from a single shared address
    message: { success: false, error: 'TOO_MANY_REQUESTS', message: 'Too many requests. Please try again in a moment.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => skipInternal(req) || req.method === 'OPTIONS',
    store: storeFor('publicread'),
  });

  // Writes first — these are the abuse surface (ballot stuffing, seating probing).
  app.post('/api/v1/public/events/:slug/rsvp', publicWriteLimiter);
  app.post('/api/v1/public/events/:slug/seating/verify', publicWriteLimiter);
  app.post('/api/v1/public/events/:slug/self-checkin', publicWriteLimiter);
  app.post('/api/v1/public/rsvp/respond', publicWriteLimiter);

  // Then the generous read budget for everything else on the guest surface.
  app.use('/api/v1/public/events', publicReadLimiter);
  // SEC-1: the token-based RSVP paths (one-click respond, guest/invite resolvers)
  // live under /public/rsvp and were previously covered only by the general
  // 1000/15m limiter. They stay covered here; the one state-changing route among
  // them (/rsvp/respond) is additionally capped by publicWriteLimiter above.
  app.use('/api/v1/public/rsvp', publicReadLimiter);

  /**
   * The post-event retention links, capped far tighter than anything else.
   *
   * `/events/archive` is the most expensive public endpoint in the API: it walks
   * up to 10,000 party rows, runs three more queries and builds a four-sheet
   * workbook, all outside `requireAuth` — a signed token in an email is the only
   * thing in front of it. The general 1000/15m budget would allow a thousand of
   * those from one address, and that email can be forwarded or sit in a shared
   * inbox for the whole 24-hour grace window.
   *
   * A real organizer presses "Download everything" once, maybe a few times if
   * they misplace the file. Ten is generous for that and useless for a flood.
   * Applied to the prefix so `/events/keep` is covered by the same ceiling; the
   * mount is BEFORE the authed events router, exactly like the routes it caps.
   */
  const retentionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, error: 'TOO_MANY_REQUESTS', message: 'Too many download attempts. Please try again in a few minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => skipInternal(req) || req.method === 'OPTIONS',
    store: storeFor('retention'),
  });
  app.use('/api/v1/events/archive', retentionLimiter);
  app.use('/api/v1/events/keep', retentionLimiter);
}

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    // Strip the query string before logging: public search endpoints carry guest
    // names (e.g. ?query=John%20Doe) which would otherwise land guest PII in logs.
    const path = (req.originalUrl || '').split('?')[0];
    logger.info({
      method: req.method,
      url: path,
      status: res.statusCode,
      duration: Date.now() - start,
      ip: req.ip,
    }, `${req.method} ${path} ${res.statusCode}`);
  });
  next();
});

// CSRF defense-in-depth (M2): reject state-changing requests whose browser
// Origin/Referer isn't on the allowlist. Runs after body parsing, before routes.
const { csrfOriginGuard } = require('./middleware/csrf');
app.use(csrfOriginGuard);

// UUID format validation middleware for :eventId param
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
app.param('eventId', (req, res, next, value) => {
  if (!UUID_REGEX.test(value)) {
    return res.status(400).json({ success: false, error: 'INVALID_PARAM', message: 'eventId must be a valid UUID.' });
  }
  next();
});

// ─── ROUTES ───

const authRoutes = require('./routes/authRoutes');
const seatingRoutes = require('./routes/seatingRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const checkinRoutes = require('./routes/checkinRoutes');
const checkinAppRoutes = require('./routes/checkinAppRoutes');
const checkinSyncRoutes = require('./routes/checkinSyncRoutes');
const eventRoutes = require('./routes/eventRoutes');
const rsvpRoutes = require('./routes/rsvpRoutes');
const publicRoutes = require('./routes/publicRoutes');
const tableRoutes = require('./routes/tableRoutes');
const campaignRoutes = require('./routes/campaignRoutes');
const invitationRoutes = require('./routes/invitationRoutes');
const adminRoutes = require('./routes/adminRoutes');
const fieldRoutes = require('./routes/fieldRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const referralRoutes = require('./routes/referralRoutes');

// Mount public routes
app.use('/api/v1/public', publicRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/payments', paymentRoutes); // paymentRoutes handles internal protection on endpoints (except webhook)

// Mount protected organizer routes
app.use('/api/v1/events/:eventId/seating', requireAuth, verifyEventOwner, seatingRoutes);
app.use('/api/v1/events/:eventId/notifications', requireAuth, verifyEventOwner, notificationRoutes);
app.use('/api/v1/events/:eventId/checkin', requireAuth, verifyEventOwner, checkinRoutes);
// Event-scoped because the entitlement is: this platform sells per event, so
// the plan that unlocks the door app is the plan on THIS event.
app.use('/api/v1/events/:eventId/checkin-app', requireAuth, verifyEventOwner, checkinAppRoutes);
app.use('/api/v1/events/:eventId/rsvps', requireAuth, verifyEventOwner, rsvpRoutes);
app.use('/api/v1/events/:eventId/tables', requireAuth, verifyEventOwner, tableRoutes);
app.use('/api/v1/events/:eventId/campaigns', requireAuth, verifyEventOwner, campaignRoutes);
app.use('/api/v1/events/:eventId/invitations', requireAuth, verifyEventOwner, invitationRoutes);
app.use('/api/v1/events/:eventId/fields', requireAuth, verifyEventOwner, fieldRoutes);
app.use('/api/v1/events/:eventId/analytics', requireAuth, verifyEventOwner, analyticsRoutes);
// Offline-first check-in sync surface for the Android door app. Mounted at its
// own top-level path, versioned independently of the organizer API (spec §21.4)
// so a breaking change can ship as /checkin/v2 while tablets already at venues
// keep talking to v1. The router applies requireAuth + verifyEventOwner itself.
app.use('/api/v1/checkin', checkinSyncRoutes);
app.use('/api/v1/dashboard', requireAuth, dashboardRoutes);
app.use('/api/v1/referrals', requireAuth, referralRoutes);
/**
 * The two links in the post-event data-deletion warning email. Token-authorized
 * rather than session-authorized, so they MUST be mounted before the line below
 * — which wraps the whole organizer router in `requireAuth`. See
 * routes/eventRetentionRoutes.js.
 */
app.use('/api/v1/events', require('./routes/eventRetentionRoutes'));
app.use('/api/v1/events', requireAuth, eventRoutes);

// Mount super admin control routes
app.use('/api/v1/admin', adminRoutes);

// OpenAPI Specification Route — gated behind auth in production
const serveOpenApiSpec = (req, res) => {
  res.sendFile(require('path').join(__dirname, 'docs', 'openapi.json'));
};

// Interactive API Docs Route (Swagger UI CDN)
const serveSwaggerDocs = (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>Fancy RSVP API Documentation</title>
      <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    </head>
    <body>
      <div id="swagger-ui"></div>
      <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
      <script>
        window.onload = () => {
          window.ui = SwaggerUIBundle({
            url: '/api/v1/openapi.json',
            dom_id: '#swagger-ui',
            deepLinking: true
          });
        };
      </script>
    </body>
    </html>
  `);
};

// Gated unconditionally (not just when NODE_ENV === 'production'): a deploy
// that forgets to set NODE_ENV must never expose the full API surface publicly.
app.get('/api/v1/openapi.json', requireAuth, requireSuperAdmin, serveOpenApiSpec);
app.get('/docs', requireAuth, requireSuperAdmin, serveSwaggerDocs);

// Health Check Endpoint
app.get('/api/v1/health', async (req, res) => {
  try {
    const { supabase } = require('./config/supabase');
    // Attempt to query the super_admin_config table
    const { error } = await supabase.from('super_admin_config').select('id').limit(1);
    
    let dbStatus = 'connected';
    let details = null;

    if (error) {
      // PGRST205 indicates the connection itself is alive but the table is missing (migration pending)
      if (error.code === 'PGRST205') {
        dbStatus = 'migration_pending';
        details = 'Database connection is healthy, but the super_admin_config table does not exist. Apply migrations.';
      } else {
        dbStatus = 'degraded';
        logger.warn({ err: error }, 'Health check: database degraded');
        details = 'Database is experiencing issues. Check server logs for details.';
      }
    }
    
    return res.status(200).json({
      status: 'healthy',
      database: dbStatus,
      ...(details && { details }),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    logger.error({ err }, 'Health check: database disconnected');
    return res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: 'Database connection failed. Check server logs for details.',
      timestamp: new Date().toISOString()
    });
  }
});

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Fancy RSVP API - Version 1.0.0 is live',
    documentation: '/docs'
  });
});

// 404 catch-all for unmatched routes
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'The requested resource was not found.' });
});

// Centralized error handling middleware
app.use((err, req, res, next) => {
  logger.error({ err, stack: err.stack, url: req.originalUrl, method: req.method }, 'Unhandled error');
  
  // L1: never leak internal error identifiers (err.code / err.name / stack) to
  // clients in production — they aid fingerprinting. The full error is already
  // logged above for cross-referencing. Detail is exposed only in development.
  res.status(500).json({
    success: false,
    error: 'INTERNAL_SERVER_ERROR',
    message: process.env.NODE_ENV === 'development'
      ? err.message
      : 'An unexpected error occurred on the server.',
    ...(process.env.NODE_ENV === 'development' && { code: err.code || err.name || 'UNKNOWN', stack: err.stack })
  });
});

module.exports = app;
