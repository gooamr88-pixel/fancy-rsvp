const invitationService = require('../services/invitationService');
const { sendOk, sendFail } = require('../utils/responseEnvelope');

/**
 * Unified invitation dispatch — one endpoint, one response shape, regardless of
 * channel. Replaces the old two-endpoint split (POST .../send-invitations for
 * email, POST .../campaigns/send-sms for SMS) whose result shapes disagreed
 * (sync counts vs. an async 202 with no counts at all).
 *
 * ── What changed in the four-type rebuild ──
 *
 * The `sms` branch used to FORWARD to the campaign blaster, which wrote directly
 * to `res` — so this file monkey-patched `res.json` and `res.status`, ran the
 * other controller, and rewrote its response on the way out. The restore path
 * lived inside the patched function, which meant any early return that never
 * reached it left `res.json` patched for the rest of the request.
 *
 * It also carried a body shape that made no sense here: `messageTemplate`,
 * `audience`, `clientToken`, `async` — an invitation endpoint accepting free text
 * and an audience segment, because that was what the thing underneath wanted.
 *
 * Now all three channels do the same thing in the same way: take a list of
 * parties, send one templated message each, count the outcomes. The proxy is
 * gone rather than fixed, which is the better outcome — there is no longer
 * anything to keep in sync.
 *
 * POST /api/v1/events/:eventId/invitations/send
 * body (channel: 'email'): { partyIds?: string[], resend?: boolean }
 * body (channel: 'qr'):    { partyIds: string[] }
 * body (channel: 'sms'):   { partyIds: string[], smsType?: 'invitation' | 'rsvp_confirmation'
 *                                                        | 'seating_reminder' | 'event_update' }
 * body (channel: 'detail-sms'): { partyIds: string[] }   // alias, see below
 */
const sendInvitations = async (req, res, next) => {
  const { eventId } = req.params;
  const channel = req.body?.channel;

  if (!['email', 'sms', 'qr', 'detail-sms'].includes(channel)) {
    return sendFail(res, { status: 400, error: 'VALIDATION_ERROR', message: 'channel must be one of: email, sms, qr, detail-sms.' });
  }

  try {
    if (channel === 'email') {
      const { partyIds, resend } = req.body || {};
      const result = await invitationService.sendEmailBulk(eventId, { partyIds, resend: !!resend });
      if (result.code) {
        return sendFail(res, { status: result.code === 'EVENT_NOT_FOUND' ? 404 : 403, error: result.code, message: result.message });
      }
      return sendOk(res, {
        channel: 'email', async: false,
        queued: result.queued, sent: result.sent, skipped: result.skipped, failed: result.failed,
        failures: result.failures || [],
        message: result.message || `Invitations sent: ${result.sent}` + (result.skipped ? `, skipped ${result.skipped}` : '') + (result.failed ? `, failed ${result.failed}` : '') + '.',
      });
    }

    if (channel === 'qr') {
      const { partyIds } = req.body || {};
      if (!Array.isArray(partyIds) || partyIds.length === 0) {
        return sendFail(res, { status: 400, error: 'VALIDATION_ERROR', message: 'partyIds is required for the qr channel.' });
      }
      let sent = 0, failed = 0, skipped = 0;
      const failures = [];
      for (const partyId of partyIds) {
        try {
          const r = await invitationService.sendQrTicketEmail(eventId, partyId);
          if (r.sent) sent++;
          else if (r.reason === 'NO_EMAIL') skipped++;
          else { failed++; failures.push({ partyId, reason: r.reason }); }
        } catch (err) {
          failed++; failures.push({ partyId, reason: err.message });
        }
      }
      return sendOk(res, { channel: 'qr', async: false, queued: partyIds.length, sent, skipped, failed, failures });
    }

    /**
     * channel === 'sms' | 'detail-sms'
     *
     * Every guest-facing message type down one path. Same gates, same batching,
     * same billing — the only difference is which template renders, which is why
     * they share this branch rather than each getting one to keep in sync.
     *
     * ── HOW THE TYPE IS CHOSEN, AND WHY `detail-sms` STILL EXISTS ──
     *
     * `smsType` names it directly, against the registry
     * (invitationService.MANUAL_SMS_TYPES). That is the form to use.
     *
     * `channel: 'detail-sms'` predates it and is kept as an exact alias for
     * `{ channel: 'sms', smsType: 'rsvp_confirmation' }`. Not for tidiness: the
     * dashboard keys its per-guest spinner off the channel string it sent and
     * the API echoes back, so a client mid-deploy that posts `detail-sms` has to
     * keep getting `detail-sms` in the response or its button spins forever.
     * Both forms therefore stay, and both resolve here rather than downstream.
     */
    const { partyIds, smsType } = req.body || {};
    if (!Array.isArray(partyIds) || partyIds.length === 0) {
      return sendFail(res, { status: 400, error: 'VALIDATION_ERROR', message: `partyIds is required for the ${channel} channel.` });
    }

    const type = channel === 'detail-sms'
      ? 'rsvp_confirmation'
      : (smsType || 'invitation');

    const result = await invitationService.sendInvitationSmsBulk(eventId, partyIds, {
      user: req.user,
      type,
    });
    if (result.code) {
      const status = result.code === 'EVENT_NOT_FOUND' ? 404
        : result.code === 'ADDON_INACTIVE' ? 402
          : result.code === 'SEND_LIMIT' ? 429
            : 400;
      return sendFail(res, { status, error: result.code, message: result.message });
    }

    /**
     * `smsType` is echoed alongside `channel` so a client that sent one can tell
     * which of several in-flight sends this response belongs to. `channel` alone
     * is now ambiguous — four types share the string 'sms'.
     */

    return sendOk(res, {
      // Echo the channel the caller asked for, not a hardcoded 'sms' — the client
      // keys its per-button spinner off it, so reporting the wrong one leaves the
      // pressed button spinning forever.
      channel, smsType: type, async: false,
      queued: partyIds.length,
      sent: result.sent, skipped: result.skipped, failed: result.failed,
      // Grouped and already in plain language — "3 haven't agreed to receive
      // texts" rather than NO_CONSENT × 3. The email channel returns per-recipient
      // `failures`; SMS returns a grouped `breakdown` because its failures are
      // overwhelmingly one of five shared reasons, and 200 identical rows is not a
      // more useful answer than one row saying 200.
      breakdown: result.breakdown || [],
      message: result.message,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { sendInvitations };
