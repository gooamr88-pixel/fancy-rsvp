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
//
// ── EVERY public write, not just the RSVP one ──
//
// This used to cover the RSVP paths alone, which left the other unauthenticated
// writes on the same prefix — the analytics beacon, the seating verifier, the
// self-check-in — inheriting the 50mb ceiling. The beacon in particular stores
// caller-supplied JSON (`metadata`), so a 50mb body was a 50mb row, written by
// anybody, on the endpoint least likely to be watched. Egress and storage are
// the resource class that has already restricted this project's services once.
//
// The beacon gets its own, much tighter parser: it carries an event name, a
// session id and a small metadata object, and nothing legitimate approaches
// even 8kb.
const tightJson = express.json({ limit: '64kb' });
const beaconJson = express.json({ limit: '8kb' });
app.use('/api/v1/public/events/:slug/analytics', beaconJson);
app.use('/api/v1/public/events/:slug/rsvp', tightJson);
app.use('/api/v1/public/events/:slug/seating/verify', tightJson);
app.use('/api/v1/public/events/:slug/self-checkin', tightJson);
app.use('/api/v1/public/rsvp', tightJson);
app.use('/api/v1/public/sms-opt-in', tightJson);
app.use('/api/v1/public/newsletter-subscribe', tightJson);
app.use('/api/v1/public/contact', tightJson);

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

/**
 * Say it at boot, once, when the limiters are per-process AND there is more than
 * one process.
 *
 * The comment inside storeFor() has always described this, but a comment is read
 * by whoever is already in this file. `ecosystem.config.js` runs the API with
 * `instances: 'max'` in cluster mode, so with no REDIS_URL the effective ceiling
 * on EVERY limiter — including the 15-attempt auth limiter — is N× the
 * configured value and varies by which worker answered. Both optional packages
 * are already installed; this is one environment variable away from correct, and
 * the only reason it stayed unnoticed is that nothing ever said so out loud.
 */
if (!RATE_LIMIT_DISABLED && !redisClient) {
  const clustered = process.env.NODE_APP_INSTANCE !== undefined;
  const msg = 'Rate limiting is using the per-process in-memory store (no REDIS_URL).';
  if (clustered) {
    logger.warn(`⚠️  ${msg} This process is one of a pm2 CLUSTER, so every limit is effectively multiplied by the worker count and is not deterministic. Set REDIS_URL to make limits coherent.`);
  } else {
    logger.info(`${msg} Fine for a single process; set REDIS_URL before scaling out.`);
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

/**
 * The guest surface, which has its OWN budget below and must not be capped by
 * the general one first.
 *
 * `publicReadLimiter` is deliberately set to 1200/15min with a note explaining
 * that households, offices and mobile CGNAT put many real guests behind one
 * address. That number never applied: `apiLimiter` is mounted on `/api` before
 * it, at 1000, and skipped only loopback and the carrier webhooks — so guests
 * were cut off at 1000 and the wider budget was unreachable. Exempting these
 * prefixes here is what makes the specific limiter the one that decides.
 *
 * Safe because nothing is left uncapped: every path below is covered by
 * publicReadLimiter, and the state-changing ones additionally by
 * publicWriteLimiter.
 */
const PUBLIC_GUEST_PREFIXES = ['/api/v1/public/events', '/api/v1/public/rsvp'];
const isPublicGuestSurface = (req) => {
  const path = (req.originalUrl || '').split('?')[0];
  return PUBLIC_GUEST_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
};

/**
 * The fire-and-forget guest analytics beacon.
 *
 * Singled out because it is the one endpoint on the guest surface whose request
 * count is driven by how much a guest DOES rather than how many pages they open,
 * and it shares `/api/v1/public/events` with `GET /public/events/:slug` — the
 * invitation itself.
 *
 * A full guest journey now sends roughly sixteen of these (a page view, the four
 * envelope events, the five funnel steps, and up to seven engagement actions),
 * up from about nine before the engagement actions were wired up. Left on the
 * read budget, a busy shared address — carrier CGNAT, one venue's Wi-Fi — would
 * spend that budget on BEACONS and then start refusing to serve the invitation
 * page, which the guest UI renders as a permanent "Event Not Found". Telemetry
 * must never be able to cost a guest their invitation.
 */
const isAnalyticsBeacon = (req) => {
  if (req.method !== 'POST') return false;
  const path = (req.originalUrl || '').split('?')[0];
  return /^\/api\/v1\/public\/events\/[^/]+\/analytics\/?$/.test(path);
};

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
    skip: (req) => skipInternal(req) || isTwilioWebhook(req) || isPublicGuestSurface(req),
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
    // The beacon is excluded because it has its OWN budget below. Skipping it
    // here is what actually separates the two: mounting a second limiter would
    // otherwise just charge each beacon to both buckets, which is the problem
    // rather than the fix.
    skip: (req) => skipInternal(req) || req.method === 'OPTIONS' || isAnalyticsBeacon(req),
    store: storeFor('publicread'),
  });

  /**
   * The analytics beacon's own budget.
   *
   * Deliberately LARGER than the read limiter, which looks backwards until you
   * count: one guest produces ~16 beacons against a handful of page reads, so
   * serving the same number of humans behind one address takes a bigger number,
   * not a smaller one. 2000/15min is roughly 125 complete guest journeys from a
   * single shared IP — comfortably above any real household, venue or CGNAT
   * pool, and still a hard ceiling on how fast one address can inflate
   * `guest_analytics`. That table is fed by an unauthenticated endpoint and read
   * whole (up to ANALYTICS_ROW_CAP) on every organizer dashboard load, and
   * storage/egress is the resource class that has already had this project's
   * services restricted once.
   *
   * Its own store, so beacons and reads cannot evict each other's counters.
   */
  const beaconLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 2000,
    message: { success: false, error: 'TOO_MANY_REQUESTS', message: 'Too many requests. Please try again in a moment.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => skipInternal(req) || req.method === 'OPTIONS',
    store: storeFor('beacon'),
  });
  app.post('/api/v1/public/events/:slug/analytics', beaconLimiter);

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

/**
 * ── THE LITERAL STRING "undefined" REACHING POSTGRES ──
 *
 * The Postgres log carries bursts of
 *
 *     invalid input syntax for type uuid: "undefined"
 *
 * — thirteen of them inside 22 seconds on 2026-09-10, eight inside one second on
 * 2026-09-08. That is JavaScript's `undefined` stringified into a URL by a
 * caller and handed to PostgREST as if it were an id: `?partyId=undefined`, or
 * `/rsvps/undefined`. Postgres rejects it at parse time, so each one is a wasted
 * round trip that fails, and — as with the `devices` violations — a real
 * ERROR-level line on a path nobody considers broken.
 *
 * The correct long-term fix is in whatever builds those URLs, which is front-end
 * work and out of scope for this phase. This is the guard on the DATABASE side
 * of the boundary: nothing that is obviously not an id should reach a query.
 *
 * Two layers, because the log shows both shapes arriving:
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Layer 1 — QUERY STRING. `?partyId=undefined` is indistinguishable from a
 * caller that meant to omit the filter, so treat it as omitted rather than
 * 400-ing: the burst pattern says these come from optional filters, and failing
 * the whole request would turn a cosmetic front-end bug into a broken page.
 *
 * Only the two literals JavaScript produces by accident. A guest whose name is
 * genuinely "null" still searches fine, because `?query=null` is a search term,
 * not an id — which is why this scrubs by VALUE and not by key.
 */
const JS_ACCIDENTS = new Set(['undefined', 'null', 'NaN']);
app.use((req, res, next) => {
  if (req.query) {
    for (const [key, value] of Object.entries(req.query)) {
      // Ids only. Free-text params (search, query, q) are left completely alone.
      if (typeof value === 'string' && JS_ACCIDENTS.has(value) && /Id$|^id$/.test(key)) {
        delete req.query[key];
      }
    }
  }
  next();
});

/**
 * Layer 2 — ROUTE PARAMS. Every `:*Id` in the routing table is a UUID column in
 * this schema, so a value that is not a UUID cannot match anything and is worth
 * one cheap regex to stop at the edge.
 *
 * Rejected here rather than scrubbed: a path segment is not optional. A request
 * to `/events/undefined/rsvps` has no sensible interpretation, and answering 400
 * INVALID_PARAM tells whoever wrote that caller exactly what is wrong — which
 * `invalid input syntax for type uuid` buried in a Postgres log did not.
 *
 * ── WHAT THIS LAYER CAN AND CANNOT REACH ──────────────────────────────────
 *
 * This list once carried twenty-two names and read as though it covered the
 * whole routing table. It never did, and the reason is a documented Express
 * rule rather than a bug in the regex: an `app.param()` callback fires only for
 * parameters that appear in the APP's own routing — which includes an
 * `app.use()` MOUNT path, but never a parameter declared inside a mounted
 * Router. Verified against express 4.22.2.
 *
 * So the only names worth registering here are the ones that genuinely appear
 * in a mount path below, and that is `:eventId` alone. Every other identifier
 * is declared inside a router and is guarded THERE, by
 * `middleware/uuidParam.js` — see that file for the full account.
 *
 * Keeping the long list would have been worse than useless: it looked like
 * coverage, so nobody went looking for the routers that had none.
 *
 * `code`, `slug` and `token` are deliberately NOT guarded as UUIDs anywhere:
 * short-link codes, event slugs and signed JWTs are not UUIDs and each has its
 * own validation.
 */
const MOUNT_PATH_UUID_PARAMS = ['eventId'];
for (const name of MOUNT_PATH_UUID_PARAMS) {
  app.param(name, (req, res, next, value) => {
    if (!UUID_REGEX.test(value)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_PARAM',
        message: `${name} must be a valid UUID.`,
      });
    }
    next();
  });
}

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
 * Image upload, replacing the browser's direct-to-Storage path.
 *
 * The browser used to upload with the anon key, which meant (a) anyone holding
 * that key — i.e. anyone who opened the site — could write to the bucket, and
 * (b) nothing was ever resized, which is how 0.4 GB of stored assets turned
 * into 8.7 GB of egress in six days. See controllers/uploadController.js.
 *
 * Mounted AFTER the global express.json above, and that ordering is fine: the
 * router's own express.raw only claims image Content-Types, which json never
 * matches, so the two parsers cannot fight over a body.
 */
app.use('/api/v1/uploads', requireAuth, require('./routes/uploadRoutes'));
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
  /**
   * ── BODY-PARSER FAILURES ARE THE CLIENT'S FAULT, NOT A SERVER FAULT ──
   *
   * `express.raw` and `express.json` reject an oversized or malformed body by
   * throwing an error that already carries the right HTTP status — 413 for
   * `entity.too.large`, 400 for bad JSON. This handler used to ignore that and
   * answer 500 INTERNAL_SERVER_ERROR for all of them.
   *
   * That mattered the moment uploads moved server-side: a guest photo over the
   * 12 MB ceiling produced "An unexpected error occurred on the server" with no
   * hint that the file was simply too big, and it was logged at error level as
   * though the API had broken. The controller's own size check could never
   * report it either, because the parser rejects the body before any handler
   * runs.
   *
   * Only body-parser errors are trusted this way — they set `expose = true` on
   * exactly the messages that are safe to show. Anything else still falls
   * through to the opaque 500 below, so a genuine internal fault cannot smuggle
   * its message out by setting a status.
   */
  if (err && err.type && typeof err.status === 'number' && err.status < 500) {
    const isTooLarge = err.type === 'entity.too.large';
    logger.warn({
      type: err.type, status: err.status, limit: err.limit, url: req.originalUrl, method: req.method,
    }, 'request body rejected');

    /**
     * The limit is read off the error, not hardcoded.
     *
     * This said "The limit is 12 MB." for every oversized body, which was true
     * only of the upload parser. There are now four parsers with four different
     * ceilings — 8kb for the analytics beacon, 64kb for the public guest
     * writes, 12MB for uploads, 50mb for authenticated CSV/JSON — so a fixed
     * sentence is wrong for three of them, and wrong in the unhelpful
     * direction: it tells a caller rejected at 64kb that they have 12 MB to
     * play with.
     *
     * body-parser sets `err.limit` in bytes on exactly this error type.
     */
    const describeLimit = (bytes) => {
      if (!Number.isFinite(bytes)) return null;
      if (bytes >= 1048576) return `${+(bytes / 1048576).toFixed(1)} MB`;
      return `${Math.round(bytes / 1024)} KB`;
    };
    const limit = describeLimit(err.limit);

    return res.status(err.status).json({
      success: false,
      error: isTooLarge ? 'FILE_TOO_LARGE' : 'INVALID_BODY',
      message: isTooLarge
        ? (limit
          ? `That request body is too large. The limit for this endpoint is ${limit}.`
          : 'That request body is too large.')
        : 'The request body could not be read.',
    });
  }

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
