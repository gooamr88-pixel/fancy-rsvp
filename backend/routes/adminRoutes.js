const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, requireAdmin } = require('../middleware/permissions');
const { manualCashApproval, updatePricingConfig, getPricingConfig, getPendingPayments, previewSmsPricing } = require('../controllers/paymentController');
const { getAdminEvents, deleteEvent } = require('../controllers/eventController');
const { PLATFORM_FEATURES, FEATURE_CATEGORIES, getFeaturesByCategory } = require('../config/featureRegistry');
const rbacRoutes = require('./admin/rbacRoutes');
const creditRoutes = require('./admin/creditRoutes');
const financeRoutes = require('./admin/financeRoutes');
const userMgmtRoutes = require('./admin/userMgmtRoutes');
const securityRoutes = require('./admin/securityRoutes');
const testimonialsRoutes = require('./admin/testimonialsRoutes');
const pressMentionsRoutes = require('./admin/pressMentionsRoutes');
const blogRoutes = require('./admin/blogRoutes');
const shopRoutes = require('./admin/shopRoutes');
const referralAdminRoutes = require('./admin/referralAdminRoutes');
const contactInquiriesRoutes = require('./admin/contactInquiriesRoutes');
const promoCodeRoutes = require('./admin/promoCodeRoutes');
const checkinAdminRoutes = require('./admin/checkinAdminRoutes');
const {
  listPlatformUsers,
  setUserRole,
  getPlatformOverview,
  listOrganizations,
  listAllPayments,
  listDisputes,
  refundPayment,
  declineManualPayment,
  updateEventAdmin,
  grantSmsCredits,
  listSmsWallets,
  getGlobalActivity,
} = require('../controllers/adminController');

const router = express.Router();

// UUID format validation for :paymentId param
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.param('paymentId', (req, res, next, value) => {
  if (!UUID_REGEX.test(value)) {
    return res.status(400).json({ success: false, error: 'INVALID_PARAM', message: 'paymentId must be a valid UUID.' });
  }
  next();
});

// All admin routes require authentication. Per-route requirePermission() then
// enforces the granular RBAC matrix (Master Plan §18). super_admin satisfies
// every permission implicitly, so existing super-admin access is preserved.
router.use(requireAuth);

// ── Current admin identity & permissions (powers the dashboard nav gating) ──
// GET /api/v1/admin/me — any active admin.
router.get('/me', requireAdmin, (req, res) => {
  const a = req.user.access;
  return res.json({
    success: true,
    me: {
      userId: req.user.id,
      email: req.user.email,
      isSuperAdmin: a.isSuperAdmin,
      roles: a.roleKeys,
      permissions: a.isSuperAdmin ? ['*'] : Array.from(a.permissions),
    },
  });
});

// ── Role & permission management ──
router.use('/rbac', rbacRoutes);

// ── Phase 1: money — credit packages, finance ──
router.use('/credits', creditRoutes);
router.use('/finance', financeRoutes);

// ── Landing CMS — testimonials + press mentions + blog management ──
router.use('/testimonials', testimonialsRoutes);
router.use('/press-mentions', pressMentionsRoutes);
router.use('/blog', blogRoutes);

// ── Printed Invitations — the physical-card catalogue sold by WhatsApp ──
// Same cms.view / cms.manage pair as the CMS routers above.
router.use('/shop', shopRoutes);

// ── Marketing — referral / affiliate program oversight, contact inquiries ──
router.use('/referrals', referralAdminRoutes);
router.use('/inquiries', contactInquiriesRoutes);
router.use('/promo-codes', promoCodeRoutes);

// ── Check-in — cross-org device registry, global revoke/wipe, ops summary ──
router.use('/checkin', checkinAdminRoutes);

// ── Phase 2: RBAC & security — user/organizer lifecycle, audit, security, health ──
router.use('/', userMgmtRoutes);
router.use('/', securityRoutes);

// ── Platform overview / analytics ──
router.get('/overview', requirePermission('overview.view'), getPlatformOverview);

// ── Events ──
router.get('/events', requirePermission('events.view'), getAdminEvents);
router.patch('/events/:eventId', requirePermission('events.manage'), updateEventAdmin);
router.delete('/events/:eventId', requirePermission('events.manage'), deleteEvent);
router.post('/events/:eventId/grant-sms', requirePermission('credits.manage'), grantSmsCredits);

// ── Organizations ──
router.get('/organizations', requirePermission('organizers.view'), listOrganizations);

// ── Payments / revenue ──
router.get('/pending-payments', requirePermission('payments.view'), getPendingPayments);
router.get('/payments', requirePermission('payments.view'), listAllPayments);
router.get('/payments/disputes', requirePermission('payments.view'), listDisputes);
router.post('/manual-approve', requirePermission('payments.manage'), manualCashApproval);
router.post('/payments/:paymentId/refund', requirePermission('payments.refund'), refundPayment);
router.post('/payments/:paymentId/decline', requirePermission('payments.manage'), declineManualPayment);

// ── SMS credit wallets ──
router.get('/sms-wallets', requirePermission('credits.view'), listSmsWallets);

// ── Feature Registry (for the tier feature selector UI) ──
router.get('/feature-registry', requirePermission('subscriptions.view'), (req, res) => {
  const grouped = {};
  for (const [cat, features] of getFeaturesByCategory()) {
    // `alwaysOn` rides along so the tier editor can render those switches
    // checked-and-locked. Without it the admin sees a live-looking toggle for a
    // capability every plan carries — one that cannot be turned off, because
    // entitledFeatures() unions it into every tier.
    grouped[cat] = features.map(f => ({ key: f.key, label: f.label, description: f.description, freeDefault: f.freeDefault, builtIn: f.builtIn !== false, alwaysOn: !!f.alwaysOn, comingSoon: !!f.comingSoon }));
  }
  return res.json({
    success: true,
    categories: FEATURE_CATEGORIES,
    features: grouped,
    allFeatures: PLATFORM_FEATURES.map(f => ({ key: f.key, label: f.label, description: f.description, category: f.category, freeDefault: f.freeDefault, builtIn: f.builtIn !== false, alwaysOn: !!f.alwaysOn, comingSoon: !!f.comingSoon })),
  });
});

// ── Pricing configuration ──
router.get('/pricing', requirePermission('subscriptions.view'), getPricingConfig);
router.patch('/pricing', requirePermission('subscriptions.manage'), updatePricingConfig);
// Price an unsaved SMS pricing model — what customers would pay, what it costs
// us, and what Fancy keeps. Read-only; persists nothing. Same permission as the
// save it previews, since it exposes cost and margin figures.
router.post('/pricing/sms-preview', requirePermission('subscriptions.manage'), previewSmsPricing);

// ── Users & legacy role flag ──
router.get('/users', requirePermission('users.view'), listPlatformUsers);
router.patch('/users/role', requirePermission('rbac.manage'), setUserRole);

// ── Audit / activity ──
router.get('/activity', requirePermission('audit.view'), getGlobalActivity);

module.exports = router;
