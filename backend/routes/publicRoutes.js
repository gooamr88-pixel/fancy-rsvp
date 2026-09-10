const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, param, query } = require('express-validator');
const validate = require('../middleware/validate');
const { getPublicEventBySlug } = require('../controllers/eventController');
const { submitPublicRSVP, searchPublicGuests, verifyPublicSeating, getGuestById, getGuestSeatingMap, getTicketSeatingView, getRsvpInvite, respondViaToken, claimRsvpByEmail } = require('../controllers/rsvpController');
const checkinController = require('../controllers/checkinController');
const { trackGuestEvent } = require('../controllers/analyticsController');
const { handleSmsStatusCallback, handleInboundSms } = require('../controllers/campaignController');
const { subscribeNewsletter, submitContactForm, submitSmsOptIn, getPublicTestimonials, getPublicPressMentions, getPublicBlogPosts, getPublicBlogPostBySlug } = require('../controllers/marketingController');
const { getPublicShop, getPublicProductBySlug, recordShopInquiry } = require('../controllers/shopController');
const { verifyTurnstile } = require('../middleware/captcha');
const { generateQRCodeBuffer } = require('../utils/qrHelper');
const { getPlatformConfig } = require('../utils/configCache');
const { getLandingCounts } = require('../utils/landingCounts');
const { getPublicBaseUrl } = require('../utils/publicUrl');
const shortLinks = require('../utils/shortLinks');

const router = express.Router();

// Sends an email on every accepted call, so it is capped far tighter than the
// ordinary public endpoints: a guest needs one link, maybe two after a typo.
// Anything beyond that is somebody using the endpoint to post mail at an
// address, and the flat reply means they cannot even tell whether it landed.
const rsvpClaimLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'TOO_MANY_REQUESTS', message: 'Too many requests. Please try again later.' },
});

// Anonymous marketing forms — capped generously above normal human use, just
// enough to stop scripted spam without penalizing a legitimate visitor.
const marketingFormLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'TOO_MANY_REQUESTS', message: 'Too many submissions. Please try again later.' },
});

// Twilio SMS delivery-status webhook (signature-verified inside the handler).
// Public + unauthenticated by design; reconciles + auto-refunds failed deliveries.
router.post('/sms/status', handleSmsStatusCallback);

// Twilio inbound-message webhook (signature-verified inside the handler).
// Records STOP/UNSUBSCRIBE/CANCEL/END/QUIT opt-outs into sms_opt_outs — the
// suppression list every SMS send path enforces. Point the Twilio number's
// "A message comes in" hook here.
router.post('/sms/inbound', handleInboundSms);

// Short-link resolution for /i/:code.
//
// The short domain is the SITE, not the API — `fancyrsvp.com/i/k7m2xq4p`, because
// putting the API hostname in the link would give back most of the characters the
// short link exists to save. So the public-facing hop is a Next.js route handler
// (frontend/src/app/i/[code]/route.js) and this is what it asks.
//
// Rate-limited because a code is the only thing guarding the RSVP page it points
// at. 8 characters of a 30-symbol alphabet is ~10^11 combinations, which is not
// brute-forceable at 60 tries a minute, and is the reason for the cap rather than
// an afterthought to it.
const shortLinkLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'TOO_MANY_REQUESTS', message: 'Too many requests.' },
});

router.get('/links/:code', shortLinkLimiter, async (req, res) => {
  try {
    const target = await shortLinks.resolve(req.params.code);
    if (!target) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'That link is not valid.' });
    }
    return res.json({ success: true, url: target });
  } catch {
    // Deliberately indistinguishable from a genuine miss: a different response for
    // "exists but we broke" would turn this endpoint into an oracle for probing
    // which codes are real.
    return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'That link is not valid.' });
  }
});

// Public landing-page stat counters (admin-editable via super_admin_config.landing_stats).
// Reads the cached config and exposes ONLY this column — never the rest of the row
// (pricing, payment methods, etc.) to anonymous clients. Entries tagged
// source: 'events_count' / 'guests_count' get their `target` overwritten with a
// real COUNT(*) rather than the admin-typed number — only genuinely
// unmeasurable stats (e.g. uptime) stay purely admin-set.
//
// Those two counts come from utils/landingCounts, which CACHES them. They are
// `count: 'exact'` reads — a bare SELECT count(*), i.e. a full scan, one of them
// over `guests`. Uncached, this endpoint made the marketing home page cost two
// sequential scans per visit, growing with the size of the business. The
// Cache-Control header below is advice to one browser and does nothing for a
// crawler or a server render; see that module for the reasoning and the
// behaviour when a count fails.
router.get('/landing-stats', async (req, res) => {
  try {
    const config = await getPlatformConfig();
    const stats = config.landing_stats || [];

    const needsEvents = stats.some(s => s.source === 'events_count');
    const needsGuests = stats.some(s => s.source === 'guests_count');
    const counts = (needsEvents || needsGuests)
      ? await getLandingCounts({ needsEvents, needsGuests })
      : { events: null, guests: null };

    const liveStats = stats.map((s) => {
      if (s.source === 'events_count' && counts.events != null) {
        return { ...s, target: counts.events };
      }
      if (s.source === 'guests_count' && counts.guests != null) {
        return { ...s, target: counts.guests };
      }
      return s;
    });

    res.set('Cache-Control', 'public, max-age=30');
    return res.json({ success: true, stats: liveStats });
  } catch (err) {
    return res.status(200).json({ success: false, stats: [] });
  }
});

// Real, admin-managed customer testimonials (published only) — see
// controllers/admin/testimonialsController.js for the full CRUD surface.
router.get('/testimonials', getPublicTestimonials);

// Real, admin-managed "As Seen In" press mentions / trust badges (published
// only) — see controllers/admin/pressMentionsController.js for full CRUD.
router.get('/press-mentions', getPublicPressMentions);

// Real, admin-managed blog (published only) — see
// controllers/admin/blogController.js for the full CRUD surface.
router.get('/blog', getPublicBlogPosts);
router.get('/blog/:slug', getPublicBlogPostBySlug);

// Printed Invitations — the physical-card catalogue at /printed-invitations
// (published rows only). Full CRUD in controllers/admin/shopController.js.
router.get('/shop', getPublicShop);
router.get('/shop/:slug', getPublicProductBySlug);

// "Order on WhatsApp" beacon. Capped: the whole funnel leaves the site here, so
// this counter is the only demand signal there is, and an uncapped anonymous
// write is an invitation to inflate it. Generous enough that a real visitor
// comparing several cards is never blocked.
router.post(
  '/shop/:productId/inquiry',
  rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'TOO_MANY_REQUESTS', message: 'Too many requests.' },
  }),
  param('productId').isUUID().withMessage('Invalid product'),
  validate,
  recordShopInquiry,
);

// Live SMS opt-in form on /sms-opt-in (the Toll-Free Verification opt-in URL).
// Records a timestamped, consent-text-versioned opt-in (marketingController).
router.post('/sms-opt-in', [
  marketingFormLimiter,
  body('fullName').optional({ values: 'falsy' }).trim().isLength({ max: 200 }).withMessage('Name too long'),
  body('phone').isString().trim().notEmpty().isLength({ max: 30 }).withMessage('A phone number is required'),
  body('consent').isBoolean().withMessage('consent must be a boolean'),
  validate
], submitSmsOptIn);

// Footer + blog newsletter signup
router.post('/newsletter-subscribe', [
  marketingFormLimiter,
  body('email').isEmail().normalizeEmail().withMessage('A valid email is required'),
  body('source').optional().isIn(['footer', 'blog']).withMessage('Invalid source'),
  validate
], subscribeNewsletter);

// Contact page form — also the target for the /solutions/* (Planners / Venues /
// Corporate) inquiry forms, which pass the extra optional fields below plus a
// `segment` so a qualified sales lead is distinguishable from a routine
// support question (see marketingController.submitContactForm).
router.post('/contact', [
  marketingFormLimiter,
  body('name').trim().notEmpty().isLength({ max: 200 }).withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('A valid email is required'),
  body('subject').trim().notEmpty().isLength({ max: 200 }).withMessage('Subject is required'),
  body('message').trim().notEmpty().isLength({ max: 5000 }).withMessage('Message is required'),
  body('segment').optional({ values: 'falsy' }).isIn(['general', 'planners', 'venues', 'corporate']).withMessage('Invalid segment'),
  body('company').optional({ values: 'falsy' }).trim().isLength({ max: 200 }).withMessage('Company name too long'),
  // Optional on the generic Contact page (segment omitted/'general'), but the
  // /solutions/* B2B inquiry forms collect these and must not submit without them.
  // The .custom() runs first (unconditionally) to enforce that; .optional()
  // after it then preserves the exact prior skip-on-falsy behavior for the
  // generic Contact page, which never sends these fields at all.
  body('phone')
    .custom((value, { req }) => {
      const isB2B = req.body.segment && req.body.segment !== 'general';
      if (isB2B && !String(value || '').trim()) throw new Error('Phone number is required');
      return true;
    })
    .optional({ values: 'falsy' }).trim().isLength({ max: 30 }).withMessage('Phone number too long'),
  body('expectedGuests')
    .custom((value, { req }) => {
      const isB2B = req.body.segment && req.body.segment !== 'general';
      if (isB2B && !String(value || '').trim()) throw new Error('Expected guest volume is required');
      return true;
    })
    .optional({ values: 'falsy' }).trim().isLength({ max: 50 }).withMessage('Invalid guest volume'),
  validate
], submitContactForm);

// Public event-by-slug fetch
router.get('/events/:slug', getPublicEventBySlug);

// Personalized invitation resolver (guest-specific link)
router.get('/rsvp/guest/:guestId', [
  param('guestId').isUUID().withMessage('Valid guest ID is required'),
  validate
], getGuestById);

// Resolve a signed email-invitation token into guest/event context (read-only)
router.get('/rsvp/invite', [
  query('token').notEmpty().withMessage('Token is required'),
  validate
], getRsvpInvite);

// Record a one-click RSVP response from a signed invitation token
router.post('/rsvp/respond', [
  body('token').notEmpty().withMessage('Token is required'),
  body('response').optional().isIn(['accepted', 'declined', 'maybe', 'yes', 'no']).withMessage('Invalid response'),
  body('partySize').optional().isInt({ min: 1, max: 20 }).withMessage('Party size must be between 1 and 20'),
  validate
], respondViaToken);

// Public guest RSVP name validation search
router.get('/events/:slug/rsvp/search', [
  query('query').optional().trim().isLength({ max: 200 }).withMessage('Search query too long'),
  validate
], searchPublicGuests);

// Verify a guest by exact name + last 4 phone digits, returning ONLY their own
// seating map. Replaces the old name-search (which enumerated every match).
// POST + the strict /public/events limiter (30/15m per IP) throttle guessing.
router.post('/events/:slug/seating/verify', [
  body('name').trim().notEmpty().isLength({ max: 200 }).withMessage('Name is required'),
  body('phoneLast4').trim().matches(/^\d{4}$/).withMessage('Enter the last 4 digits of your phone number'),
  validate
], verifyPublicSeating);

// Personal seating map for one guest (their table + own party, never other guests)
router.get('/events/:slug/seating/guest/:guestId', [
  param('guestId').isUUID().withMessage('Valid guest ID is required'),
  validate
], getGuestSeatingMap);

// Self-scan: resolves a guest's own QR check-in ticket into their seating view
// (table + own party only). The ticket's signature IS the authentication —
// no slug/guestId needed, everything is decoded from the signed token.
router.get('/ticket/:token', getTicketSeatingView);

// Public guest RSVP form submit
router.post('/events/:slug/rsvp', [
  body('guestName').trim().notEmpty().isLength({ max: 200 }).withMessage('Guest name is required (max 200 chars)'),
  // RF-6: normalize case/whitespace but PRESERVE gmail dots and +subaddressing so a
  // guest who RSVPs as "jane+wedding@gmail.com" gets their confirmation there and the
  // address they typed is the address we store.
  body('email').optional({ values: 'falsy' }).isEmail().normalizeEmail({ gmail_remove_dots: false, gmail_remove_subaddress: false, outlookdotcom_remove_subaddress: false, icloud_remove_subaddress: false, yahoo_remove_subaddress: false }).withMessage('Invalid email format'),
  body('phone').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).withMessage('Phone number too long'),
  body('response').isIn(['yes', 'no', 'maybe', 'pending']).withMessage('Response must be yes, no, maybe, or pending'),
  body('partySize').optional().isInt({ min: 1, max: 20 }).withMessage('Party size must be between 1 and 20'),
  body('decline_reason').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('Decline reason too long'),
  body('maybe_confirm_by').optional({ values: 'falsy' }).trim().isIn(['24h', '3d', '1w', '']).withMessage('Invalid follow-up duration'),
  body('side').optional({ values: 'falsy' }).isIn(['partner1', 'partner2']).withMessage('Invalid side'),
  // Language the guest filled the form in — decides the confirmation email's
  // language only. Whitelisted rather than free text since it reaches a template.
  body('lang').optional({ values: 'falsy' }).isIn(['en', 'ar']).withMessage('Unsupported language'),
  validate
], verifyTurnstile, submitPublicRSVP);

// Emails the owner of an address a short-lived link to edit the RSVP registered
// to it — the only way to change an answered response without the guest's own
// link. Replies identically whether or not anything matched (see the handler),
// so it can't be used to test who is on the guest list.
router.post('/events/:slug/rsvp/claim', rsvpClaimLimiter, [
  body('email').trim().isEmail().withMessage('Enter a valid email address'),
  body('lang').optional({ values: 'falsy' }).isIn(['en', 'ar']).withMessage('Unsupported language'),
  validate
], claimRsvpByEmail);

// Public self-service check-in
router.post('/events/:slug/self-checkin', [
  body('partyId').isUUID().withMessage('Valid party ID is required'),
  body('guestName').optional().trim().isLength({ max: 200 }).withMessage('Guest name too long'),
  validate
], checkinController.selfCheckIn);

// Public analytics tracking (fire-and-forget)
router.post('/events/:slug/analytics', [
  body('eventType').trim().notEmpty().withMessage('Event type is required'),
  body('sessionId').optional().trim().isLength({ max: 100 }),
  body('partyId').optional().isUUID(),
  validate
], trackGuestEvent);

// Serve QR code as a real PNG image (email-safe — no data URIs).
// The :token param is the signed JWT ticket; the QR itself encodes a link to
// the guest's own ticket page (not the bare token) so scanning it with an
// ordinary phone camera — not just the organizer's check-in kiosk — opens
// the guest's seating view directly. Aggressive cache headers (immutable, 30
// days) because the same token always produces the same image.
//
// `?download=1` returns the SAME code as a saved file instead of an inline
// image, so a guest can keep their pass in their photo roll and walk up to the
// door with no signal and no inbox. It has to be driven by Content-Disposition
// server-side: the HTML `download` attribute is ignored cross-origin, and the
// API and the site are different origins in every deployment. The saved copy
// renders at 1024px (vs the 200px the email displays) because it gets printed,
// zoomed, and re-shared.
router.get('/qr/:token.png', async (req, res) => {
  try {
    const download = req.query.download === '1' || req.query.download === 'true';
    const ticketUrl = `${getPublicBaseUrl()}/ticket/${encodeURIComponent(req.params.token)}`;
    const buffer = await generateQRCodeBuffer(ticketUrl, download ? { width: 1024, margin: 3 } : {});
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=2592000, immutable',
      // Filename is deliberately generic — deriving it from the guest's name
      // would mean decoding the token and hitting the DB on what is otherwise
      // a pure, cacheable render.
      ...(download ? { 'Content-Disposition': 'attachment; filename="check-in-qr-code.png"' } : {}),
    });
    res.send(buffer);
  } catch (err) {
    res.status(500).send('QR generation error');
  }
});

module.exports = router;
