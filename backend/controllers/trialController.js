/**
 * POST /payments/events/:eventId/start-trial
 *
 * The self-service third door beside "pay by card" and "redeem a promo code":
 * publish this event now, free, for the configured trial window. All the
 * decisions live in services/trialService.js; this file is the HTTP shape.
 *
 * Ownership is already established by `verifyEventOwner` on the route, which
 * is also where `org_id` comes from — the org is never taken from the body.
 */

const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const { startTrial } = require('../services/trialService');

/**
 * Refusals, mapped to the status that describes them.
 *
 * `TRIAL_ALREADY_USED` is 409 rather than 403: nothing is wrong with the
 * request or the caller's permission — the resource simply is not available a
 * second time, and a 403 would send the client's error handling toward "log in
 * again", which is exactly the wrong advice.
 *
 * The two configuration refusals are 503, not 500. The platform is working;
 * this one offer is not currently on. A 500 would page somebody.
 */
const STATUS_BY_ERROR = {
  TRIAL_NOT_CONFIGURED: 503,
  NO_FREE_PLAN: 503,
  CONFIG_ERROR: 503,
  ORG_NOT_FOUND: 404,
  EVENT_NOT_FOUND: 404,
  ORG_NOT_ACTIVE: 403,
  EMAIL_NOT_VERIFIED: 403,
  TRIAL_ALREADY_USED: 409,
  ALREADY_PAID: 409,
  EVENT_NOT_DRAFT: 409,
  ACTIVATION_FAILED: 500,
};

const startEventTrial = async (req, res, next) => {
  const { eventId } = req.params;

  try {
    const { data: event, error } = await supabase
      .from('events')
      .select('id, org_id')
      .eq('id', eventId)
      .single();

    if (error || !event) {
      return res.status(404).json({ success: false, error: 'EVENT_NOT_FOUND', message: 'Event not found.' });
    }

    const result = await startTrial({
      eventId,
      orgId: event.org_id,
      actorId: req.user?.id,
    });

    if (!result.ok) {
      return res.status(STATUS_BY_ERROR[result.error] || 400).json({
        success: false,
        error: result.error,
        message: result.message,
      });
    }

    return res.json({
      success: true,
      message: `Your event is live. Your free trial runs for ${result.days} days.`,
      event: result.event,
      trialEndsAt: result.endsAt,
    });
  } catch (err) {
    logger.error({ err, eventId }, '[trial] start failed');
    return next(err);
  }
};

module.exports = { startEventTrial };
