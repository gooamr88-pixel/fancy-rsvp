const express = require('express');
const { requireAuth, verifyEventOwner } = require('../middleware/auth');
const { createCheckoutSession, purchaseSMSCredits, stripeWebhook, verifyCheckoutSession, getPricingConfig, getOrganizerPricing, getPublicPricing, initiateManualPayment, redeemPromoCode } = require('../controllers/paymentController');
const { startEventTrial } = require('../controllers/trialController');

const router = express.Router({ mergeParams: true });

// Route for Stripe Webhooks (must remain public, verified with Stripe signature)
router.post('/webhook', stripeWebhook);

// Synchronous confirmation on the browser redirect (ownership enforced inside via
// the session's authenticated org; requires a logged-in organizer).
router.get('/verify', requireAuth, verifyCheckoutSession);

// Public pricing for the marketing/landing page (no auth — customer-safe fields only)
router.get('/public-pricing', getPublicPricing);

// Protected routes to create a Stripe checkout session or purchase credits
router.post('/events/:eventId/create-checkout', requireAuth, verifyEventOwner, createCheckoutSession);
router.post('/events/:eventId/sms-credits', requireAuth, verifyEventOwner, purchaseSMSCredits);
router.post('/events/:eventId/manual-payment', requireAuth, verifyEventOwner, initiateManualPayment);
router.post('/events/:eventId/redeem-promo-code', requireAuth, verifyEventOwner, redeemPromoCode);

// The third way to publish an event, beside paying and redeeming a code: the
// account's one free trial. Same guard pair as the other two — the trial makes
// an event publicly live, so it must never be reachable without ownership.
router.post('/events/:eventId/start-trial', requireAuth, verifyEventOwner, startEventTrial);

// Allow organizers to fetch platform licensing and SMS config
// Organizer-facing pricing. Deliberately NOT getPricingConfig (the admin
// handler): that one does select('*') on super_admin_config, so behind plain
// requireAuth it served our carrier cost, our margin, the platform commission
// and the referral budget to every logged-in customer. getOrganizerPricing is
// a whitelist of what a purchase screen actually needs.
router.get('/pricing-config', requireAuth, getOrganizerPricing);

module.exports = router;
