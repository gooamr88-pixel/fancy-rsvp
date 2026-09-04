const crypto = require('crypto');
const {
  SMS_MESSAGE_TYPES, sanitizeSmsSettings, isRetiredSmsType, labelForKind,
} = require('../config/smsMessageTypes');
const { tagsForType, sampleContext, maxContext } = require('../config/smsMergeTags');
const { renderSmsBody } = require('../utils/smsTemplates');
const {
  measureTemplate, sanitizeSmsTemplates, MAX_TEMPLATE_SEGMENTS, MAX_TEMPLATE_CHARS,
} = require('../utils/smsTemplateValidation');
const { resolveProvider, resolveWebhookProvider } = require('../services/smsProviders');
const { normalizeSmsPricing, maxPerSendFor } = require('../config/smsPricing');
const { getPlatformConfig } = require('../utils/configCache');
const { selectEventWithTier } = require('../utils/tierResolver');
const { summarizeBalance, coverageForGuests, explainSkip, isResendable } = require('../utils/smsUsage');
const { normalizeToE164 } = require('../utils/phone');
const {
  SMS_CONSENT_TEXT_VERSION, ORGANIZER_SMS_CONSENT_TEXT_VERSION, logSmsConsentDecision,
} = require('../utils/smsConsent');
const { describeSmsCharge, volumeDiscountsFromConfig } = require('../utils/pricing');
const { getPublicBaseUrl } = require('../utils/publicUrl');
// Module scope, deliberately. buildResendContext needs this partway through its
// body, and a require() further down the same function would sit in the temporal
// dead zone of the earlier use — a ReferenceError only the resend path would hit.
const { buildGuestEventUrl } = require('../utils/emailTemplates');
const tokenService = require('../services/tokenService');
const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
/* The SAME helper the send gate uses to answer "does this plan include texting?".
   Imported rather than re-implemented: two answers to one entitlement question is
   how a surface ends up visible and un-callable. */
const { tierGrantsSms, SMS_FEATURE_KEY } = require('../middleware/smsAddonGate');

/**
 * The names of the plans that currently carry text messaging.
 *
 * So the locked state can say "available on Professional and Enterprise" rather
 * than a bare "upgrade", which leaves the organizer to go and work out which
 * plan they are being sold. Read from the live admin config, so renaming or
 * re-pricing a tier updates the upsell everywhere without a deploy.
 *
 * Custom/enquiry tiers are excluded: naming a "Contact us" tier as the fix for a
 * locked button is not an answer an organizer can act on by themselves.
 */
async function plansOfferingSms() {
  const config = await getPlatformConfig();
  return (config?.pricing_tiers || [])
    .filter((t) => t && t.is_custom !== true && Array.isArray(t.features) && t.features.includes(SMS_FEATURE_KEY))
    .map((t) => String(t.name || '').trim())
    .filter(Boolean);
}
const {
  normalizePhone, isValidPhone,
  sendTransactionalSms, canonicalPhone, COMPLIANCE_FOOTER, HELP_REPLY,
} = require('../services/smsDispatch');

/**
 * The per-send cap for this event's organization. `{ maxPerSend: 0 }` = unlimited.
 *
 * Shared by the middleware (explicit recipient lists) and the audience path
 * below, so both answer the ramp-up question identically. Fails OPEN for the same
 * reason the middleware does: this is abuse friction, not an entitlement check,
 * and every gate that protects consent or billing has already run and fails closed.
 */
async function resolveSendLimit(eventId, user, preloadedConfig = null) {
  if (user?.isSuperAdmin) return { maxPerSend: 0, delivered: 0 };
  try {
    const { data: event } = await supabase.from('events').select('org_id').eq('id', eventId).single();
    if (!event?.org_id) return { maxPerSend: 0, delivered: 0 };

    // Callers that already hold the platform config pass it in — the settings
    // endpoint fetches it for the balance summary and would otherwise pay for the
    // identical row twice on one request.
    const [{ data: org }, config] = await Promise.all([
      supabase.from('organizations').select('sms_delivered_total').eq('id', event.org_id).maybeSingle(),
      preloadedConfig ? Promise.resolve(preloadedConfig) : getPlatformConfig().catch(() => null),
    ]);

    const pricing = normalizeSmsPricing(config?.sms_pricing_config);
    const delivered = Number(org?.sms_delivered_total) || 0;
    return { maxPerSend: maxPerSendFor(delivered, pricing.limits.ramp_up), delivered };
  } catch (err) {
    logger.warn({ err, eventId }, 'send-limit lookup failed — allowing the send');
    return { maxPerSend: 0, delivered: 0 };
  }
}

/**
 * Fetch the wallet and the credit ledger.
 * GET /api/v1/events/:eventId/campaigns/history
 */
const getCampaignHistory = async (req, res, next) => {
  const { eventId } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  try {
    const { data: wallet } = await supabase
      .from('sms_credit_wallets').select('*').eq('event_id', eventId).single();

    const { data: config } = await supabase
      .from('super_admin_config').select('sms_rate_cents_per_credit')
      .eq('id', '00000000-0000-0000-0000-000000000000').single();

    const { data: ledger, error, count: totalCount } = await supabase
      .from('sms_credit_ledger')
      .select('*', { count: 'exact' })
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw error;

    return res.json({
      success: true,
      wallet: wallet || { credits_purchased: 0, credits_used: 0, credits_remaining: 0 },
      history: ledger || [],
      // ?? not ||, and 1.1 not 8, and both corrections matter.
      //
      // The old default of 8 was the INTEGER column's default, which was itself
      // about seven times the real carrier cost. And `||` treats a legitimate 0 —
      // a platform running SMS at cost, or on a carrier plan with no per-message
      // fee — as "unset", silently substituting a price nobody chose.
      smsRateCents: config?.sms_rate_cents_per_credit ?? 1.1,
      // Kept even though the composer is gone: the top-up screen still shows what
      // a message costs, and the footer is what makes a one-segment message
      // two. Served from the one definition rather than copied client-side, so
      // editing the compliance wording cannot silently make every quoted price
      // wrong.
      complianceFooter: COMPLIANCE_FOOTER,
      pagination: { page, limit, count: (ledger || []).length, total: totalCount },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Twilio delivery-status webhook → reconcile + auto-refund undelivered/failed SMS.
 * Public + signature-verified. Idempotent: the refund deletes the consumption row,
 * so repeated callbacks for the same SID are no-ops.
 *
 * POST /api/v1/public/sms/status   (Twilio statusCallback target)
 */
const handleSmsStatusCallback = async (req, res) => {
  // Routed by PAYLOAD SHAPE, not by SMS_PROVIDER: a receipt for a message sent
  // before a carrier switch must still be understood, or its failure never
  // refunds. See resolveWebhookProvider.
  const provider = resolveWebhookProvider(req);

  // Resembles neither carrier (mock/dev, a probe, a misconfigured URL) → nothing
  // to reconcile. 200 stops the sender retrying into an endpoint that can never
  // do anything with it.
  if (!provider) return res.status(200).send('ok');

  // Shaped like a carrier we cannot verify. REFUSE rather than trust it: this
  // endpoint issues refunds, so accepting an unverifiable receipt would let anyone
  // who knows the URL mint credit by forging a failure.
  if (!provider.isConfigured()) {
    logger.warn({ provider: provider.name }, 'Rejected SMS status callback: payload is for a carrier that is not configured, so it cannot be verified');
    return res.status(403).send('unverifiable');
  }

  // Both carriers fail closed here, for the same reason: this endpoint triggers
  // automatic refunds, so an unverified request is a request that can move money.
  if (!provider.verifyStatusWebhook(req)) {
    logger.warn({ provider: provider.name }, 'Rejected SMS status callback: signature verification failed');
    return res.status(403).send('invalid signature');
  }

  // Carrier vocabulary in, ours out — reconcile_sms_delivery keeps receiving the
  // `failed`/`delivered` values it already understands, whichever carrier sent.
  const parsed = provider.parseStatusWebhook(req.body || {});
  if (!parsed) return res.status(200).send('ok');

  const { id: sid, status, errorCode } = parsed;
  if (!sid) return res.status(200).send('ok');

  // The carrier knows about an opt-out we may not. On toll-free, STOP is enforced
  // network-side, so a guest can be blocked without our inbound webhook ever seeing
  // the keyword — this receipt is then the ONLY signal. Recording it keeps our
  // suppression list in step with the network instead of paying to retry a number
  // that can never receive. Best-effort: it must never block the refund below.
  if (parsed.to && parsed.errorCode && typeof provider.isBlacklistError === 'function'
      && provider.isBlacklistError(parsed.errorCode)) {
    supabase.from('sms_opt_outs').upsert(
      {
        phone: parsed.to,
        opted_out_at: new Date().toISOString(),
        keyword: 'carrier-blocked',
        message_sid: parsed.id,
        opted_back_in_at: null,
      },
      { onConflict: 'phone' },
    ).then(
      ({ error }) => {
        if (error) logger.warn({ err: error, phone: parsed.to }, 'carrier-reported opt-out not recorded');
        else logger.info({ phone: parsed.to, provider: provider.name, code: parsed.errorCode }, 'Opt-out recorded from carrier delivery receipt');
      },
      (err) => logger.warn({ err, phone: parsed.to }, 'carrier-reported opt-out rejected'),
    );
  }

  // When the carrier reports what it actually charged, record it — that is what
  // turns the admin P&L from an estimate into a measurement.
  if (parsed.costCents != null) {
    supabase.from('sms_credit_ledger').update({ cost_cents: parsed.costCents }).eq('sms_sid', sid)
      .then(({ error }) => { if (error) logger.warn({ err: error, sid }, 'carrier cost stamp failed'); },
            (err) => logger.warn({ err, sid }, 'carrier cost stamp rejected'));
  }

  try {
    const { data, error } = await supabase.rpc('reconcile_sms_delivery', {
      // The RPC decides failure from the status word, so hand it a value it
      // recognises rather than the carrier's own dialect.
      p_sms_sid: sid, p_status: parsed.failed ? 'failed' : (status || 'delivered'), p_error_code: errorCode,
    });
    if (error) {
      const undef = error.code === '42883' || error.code === 'PGRST202' ||
        /Could not find the function|does not exist/i.test(error.message || '');
      if (undef) {
        logger.warn('reconcile_sms_delivery missing — apply 20260628000000_sms_delivery_reconcile.sql');
        return res.status(200).send('ok'); // don't trigger Twilio retry loops
      }
      throw error;
    }
    if (data && data.refunded) {
      // campaign_id is still returned by reconcile_sms_delivery, and still
      // populated for sends made before the four-type rebuild — carrier delivery
      // receipts arrive for days, so historic campaign sends keep reporting in
      // long after the feature was removed. The refund below is what matters and
      // it works identically either way; there is simply no longer a campaign
      // progress row to refresh, so the id is logged and nothing else.
      logger.info({ sid, status, credits: data.credits, campaignId: data.campaign_id || null }, 'SMS delivery failed → credits refunded');
    }
    return res.status(200).send('ok');
  } catch (err) {
    logger.error({ err, sid, status }, 'SMS status reconciliation failed');
    return res.status(500).send('error'); // 5xx → Twilio retries later
  }
};

/* ─── Inbound SMS (STOP/HELP) webhook ──────────────────────────────────────── */

// CTIA opt-out keyword set (mirrors the Privacy Policy §3 and Terms §5 lists).
const OPT_OUT_KEYWORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']);
const OPT_IN_KEYWORDS = new Set(['start', 'unstop', 'yes']);
const HELP_KEYWORDS = new Set(['help', 'info']);

/**
 * Twilio inbound-message webhook → record STOP/UNSUBSCRIBE/CANCEL/END/QUIT
 * opt-outs (and START/UNSTOP/YES opt-back-ins) in sms_opt_outs, which every
 * send path enforces (smsDispatch.sendRecipient + the campaign audience filter).
 *
 * Auto-replies are deliberately NOT sent from here: toll-free STOP/UNSTOP
 * handling is network-level (cannot be disabled) and sends the carrier-mandated
 * confirmations itself; HELP gets Twilio's default auto-response and is not
 * forwarded to this webhook at all without a Messaging Service (which this
 * codebase does not use). Replying here too would double-message the guest.
 * This webhook is the app-side system of record, returning empty TwiML.
 *
 * POST /api/v1/public/sms/inbound   (Twilio "A message comes in" target)
 */
const handleInboundSms = async (req, res) => {
  // Twilio expects TwiML; Vonage only needs a 200. An empty TwiML document is a
  // valid 200 to both, so one response satisfies either carrier.
  const twiml = () => res.type('text/xml').status(200).send('<Response/>');

  // Routed by PAYLOAD SHAPE (see resolveWebhookProvider): a STOP sent to the
  // previous carrier's number after a switch must still register. Dropping it
  // because the payload is the "wrong" shape is a TCPA violation.
  const provider = resolveWebhookProvider(req);
  // Resembles neither carrier (mock/dev, a probe) → nothing real can arrive here.
  if (!provider) return twiml();
  // Shaped like a carrier we cannot verify: refuse rather than act on it.
  if (!provider.isConfigured()) {
    logger.warn({ provider: provider.name }, 'Rejected inbound SMS webhook: payload is for a carrier that is not configured');
    return res.status(403).send('unverifiable');
  }

  // Note the asymmetry with the status webhook above, which fails CLOSED: a
  // forged inbound can only SUPPRESS a number, and dropping a genuine STOP is a
  // TCPA violation while recording a spurious one is a nuisance. So each provider
  // decides — Twilio always verifies, Vonage accepts unsigned with a warning.
  if (!provider.verifyInboundWebhook(req)) {
    logger.warn({ provider: provider.name }, 'Rejected inbound SMS webhook: signature verification failed');
    return res.status(403).send('invalid signature');
  }

  const parsed = provider.parseInboundWebhook(req.body || {});
  if (!parsed || !parsed.from) return twiml();

  const from = parsed.from;
  const sid = parsed.messageId;
  // Keyword matching per CTIA: single-word commands, case-insensitive, tolerant
  // of trailing punctuation ("STOP.", "Stop!"). Vonage already extracts and
  // uppercases the first word, so its value is preferred when present; Twilio
  // sends the whole body and it is derived here.
  const keyword = String(parsed.keyword || parsed.text || '')
    .trim().toLowerCase().replace(/[.!,]+$/, '');

  try {
    if (OPT_OUT_KEYWORDS.has(keyword)) {
      const { error } = await supabase.from('sms_opt_outs').upsert(
        { phone: from, opted_out_at: new Date().toISOString(), keyword, message_sid: sid, opted_back_in_at: null },
        { onConflict: 'phone' },
      );
      if (error) throw error;
      logger.info({ from, keyword }, 'SMS opt-out recorded');
      return twiml();
    }
    if (OPT_IN_KEYWORDS.has(keyword)) {
      const { error } = await supabase
        .from('sms_opt_outs')
        .update({ opted_back_in_at: new Date().toISOString() })
        .eq('phone', from);
      if (error) throw error;
      logger.info({ from, keyword }, 'SMS opt-back-in recorded');
      return twiml();
    }
    if (HELP_KEYWORDS.has(keyword)) {
      logger.info({ from, provider: provider.name }, 'SMS HELP received');
      // Answer it ourselves only where the carrier does not. Twilio replies from
      // the number's own configured HELP response, so replying here too would
      // double-message; Vonage's keyword service does not cover toll-free, so
      // staying silent there would leave a mandatory CTIA keyword unanswered.
      if (!provider.handlesHelpKeyword) {
        // Deliberately NOT routed through sendTransactionalSms. A legally mandated
        // reply is not a billable message: it must not deduct credits, must not
        // require the paid add-on, and must not be withheld on a zero balance.
        // A failure here is logged, never surfaced — the carrier must still get
        // its 200 or it will retry the opt-out/HELP record indefinitely.
        try {
          await provider.send({ to: from, body: HELP_REPLY, transport: provider.getTransport() });
          logger.info({ from }, 'HELP reply sent (this carrier does not answer HELP itself)');
        } catch (helpErr) {
          logger.error({ err: helpErr, from }, 'HELP reply failed to send');
        }
      }
      return twiml();
    }
    // Any other inbound content: acknowledged, never auto-replied.
    return twiml();
  } catch (err) {
    if (/relation .* does not exist|Could not find the table/i.test(err.message || '') || err.code === '42P01') {
      logger.error('sms_opt_outs missing — apply 20260809000000_sms_compliance.sql. Opt-out NOT recorded!');
      return twiml(); // don't make Twilio retry into the same missing table
    }
    logger.error({ err, from, keyword }, 'Inbound SMS processing failed');
    return res.status(500).send('error'); // 5xx → Twilio retries later
  }
};

/* ─── SMS settings: the add-on's status and the per-type switches ─────────── */

/**
 * Everything the organizer's SMS panel needs, in one call.
 * GET /api/v1/events/:eventId/campaigns/settings
 *
 * Deliberately NOT behind requireSmsAddon: an event that has not bought the add-on
 * is exactly the one that needs to see this screen, so it can be told what SMS
 * would give it and offered the purchase.
 */
const getSmsSettings = async (req, res, next) => {
  const { eventId } = req.params;
  try {
    // The tier columns are NOT optional here: they are what tierGrantsSms and
    // the grandfathering check below read. Omitting them would make every
    // event report `access: 'locked'` and lock the SMS surfaces for the entire
    // platform — silently, since a missing column reads as undefined rather
    // than throwing. selectEventWithTier also keeps this page working if the
    // tier-identity migration has not been applied yet.
    const { data: event, error } = await selectEventWithTier(
      supabase, eventId, 'id, sms_addon_purchased_at, sms_settings, manual_override');
    if (error || !event) {
      return res.status(404).json({ success: false, error: 'EVENT_NOT_FOUND', message: 'Event not found.' });
    }

    // Issued together rather than awaited one after another: none of them depends
    // on another's result, and run sequentially they made the Messages page wait
    // on five separate round trips before rendering a single number.
    const [
      { data: wallet },
      config,
      { count: guestCount },
      { data: skipRows },
      organization,
      { count: reachableCount },
    ] = await Promise.all([
      supabase.from('sms_credit_wallets')
        .select('credits_purchased, credits_used, credits_remaining, last_used_at')
        .eq('event_id', eventId).maybeSingle(),
      getPlatformConfig().catch(() => null),
      supabase.from('guests').select('id', { count: 'exact', head: true })
        .eq('event_id', eventId).then((r) => r, () => ({ count: 0 })),
      // GROUP BY in the database. This previously pulled up to 5,000 skipped rows
      // and tallied them in JavaScript on every page load, to render six numbers.
      supabase.rpc('sms_skip_summary', { p_event_id: eventId }).then((r) => r, () => ({ data: null })),
      supabase.from('events').select('organizations(sms_consent, sms_phone)')
        .eq('id', eventId).single()
        .then((r) => {
          const o = r.data?.organizations;
          return Array.isArray(o) ? o[0] : o;
        }, () => null),
      /**
       * How many parties can ACTUALLY be texted about this event.
       *
       * Distinct from `coverage.invitations`, which is every invitation on the
       * list. Callers that need to promise a number before a broadcast — the
       * cancel dialog, above all — were using the invitation count as a stand-in
       * and therefore telling the organizer that guests who never consented would
       * be texted. A head-only count, so it costs one cheap query.
       */
      supabase.from('rsvp_parties').select('id', { count: 'exact', head: true })
        .eq('event_id', eventId).eq('sms_consent', true).in('response', ['yes', 'maybe'])
        .then((r) => r, () => ({ count: 0 })),
    ]);

    // Everything already translated into the customer's terms — messages left, a
    // percentage, when one last went out. See utils/smsUsage.js for why that
    // translation lives in one place.
    const balance = summarizeBalance(wallet, config?.sms_pricing_config);

    // How far the remaining balance goes against the guest list as it stands.
    // This is what turns "1,350 messages" into something actionable.
    const coverage = coverageForGuests(balance.remaining, guestCount || 0, config?.sms_pricing_config);

    // Skip totals let the page answer "why didn't my guests get this?" without
    // making the organizer read a log line by line. A null result means the RPC
    // is not applied yet — diagnostic data, so it degrades to empty.
    const skipSummary = (skipRows && typeof skipRows === 'object') ? skipRows : {};

    // The config is already in hand; passing it through saves resolveSendLimit
    // re-fetching the very same row.
    const sendLimit = await resolveSendLimit(eventId, req.user, config);

    /**
     * WHETHER THE PLAN INCLUDES TEXTING — computed here, never on the client.
     *
     * The dashboard has to lock every SMS surface when the plan does not carry
     * the feature, and it must reach the SAME verdict the send endpoints will.
     * Re-deriving "does tier X include sms_campaigns?" in the browser is a
     * second implementation of an entitlement rule, and the two disagree the
     * first time an admin renames a tier — leaving a surface that looks open and
     * 403s, or one that looks locked on an event that was allowed all along.
     *
     * So this endpoint — which is deliberately ungated, because an event WITHOUT
     * access is exactly the one that needs to be told so — answers it once, from
     * the same helper the gate uses.
     *
     * `access` is what the UI keys off:
     *   'granted'      → the plan includes it (buy an allowance, then send)
     *   'grandfathered'→ plan does not, but this event already paid — still works
     *   'locked'       → neither: show the upgrade badge
     */
    let planIncludesSms = false;
    try {
      planIncludesSms = await tierGrantsSms(event);
    } catch {
      // Read-only surface: a config blip must not turn the page into an error.
      // It degrades to "not granted", and the send endpoints still fail closed.
      planIncludesSms = false;
    }
    const purchased = !!event.sms_addon_purchased_at || !!event.manual_override;
    const access = planIncludesSms ? 'granted' : (purchased ? 'grandfathered' : 'locked');

    return res.json({
      success: true,
      addonActive: !!event.sms_addon_purchased_at,
      purchasedAt: event.sms_addon_purchased_at,
      // ── Plan-level access (see above) ──
      access,
      planIncludesSms,
      smsFeatureKey: SMS_FEATURE_KEY,
      tierName: event.tier_name || null,
      // Which plans DO carry texting, so the locked badge can name them instead
      // of saying "upgrade" and leaving the organizer to go and find out which.
      plansWithSms: await plansOfferingSms().catch(() => []),
      settings: sanitizeSmsSettings(event.sms_settings),
      messageTypes: SMS_MESSAGE_TYPES,
      wallet: wallet || { credits_purchased: 0, credits_used: 0, credits_remaining: 0 },
      balance,
      coverage,
      // Parties that would actually receive a text right now — consented, not
      // opted out by us, and still attending. What a confirm dialog may promise.
      smsReachableParties: reachableCount || 0,
      sendLimit,
      // The organizer's own opt-in. Without this the settings panel cannot show
      // the state of the one message type addressed to them — which is how it
      // came to ship as a toggle over a flag nothing could set.
      organizerSms: {
        consent: !!organization?.sms_consent,
        phone: organization?.sms_phone || null,
      },
      skipSummary,
      skipLabels: Object.fromEntries(
        Object.keys(skipSummary).map((r) => [r, explainSkip(r)]),
      ),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Record (or withdraw) the ORGANIZER's own opt-in to operational texts.
 * PATCH /api/v1/events/:eventId/campaigns/organizer-sms   body: { phone, consent }
 *
 * This is the missing half of the organizer_report message type. Its consent flag
 * and phone number existed on `organizations` from the day the type shipped, but
 * nothing ever wrote them — so the flag stayed false, every report skipped with
 * NO_CONSENT, and the estimate charged three messages an event for something that
 * could not fire.
 *
 * The organizer is our customer rather than a third party, but that is not a
 * licence to text them unasked. They get the same treatment a guest gets:
 *
 *   • an explicit opt-in, never implied by having an account or buying the add-on
 *   • the canonical consent wording, version-stamped on the record
 *   • an append-only entry in sms_consent_log, refusals included
 *   • the same global STOP suppression — and, as on /sms-opt-in, a deliberate
 *     opt-in here lifts an earlier STOP, because that is plainly a change of mind
 *
 * Scoped to an event route because that is where the settings panel lives, but it
 * writes the ORGANIZATION: one number, one decision, across all their events.
 * verifyEventOwner has already established they own this event, hence the org.
 */
const updateOrganizerSmsConsent = async (req, res, next) => {
  const { eventId } = req.params;
  const consent = req.body?.consent === true || req.body?.consent === 'true';
  const rawPhone = req.body?.phone;

  try {
    const { data: event, error: eventErr } = await supabase
      .from('events').select('org_id').eq('id', eventId).single();
    if (eventErr || !event?.org_id) {
      return res.status(404).json({ success: false, error: 'EVENT_NOT_FOUND', message: 'Event not found.' });
    }

    // A consent with nowhere to send is not a consent. Rejected rather than
    // stored, so the organizer is told now instead of wondering later why no
    // alert ever arrived.
    let phone = null;
    if (rawPhone !== undefined && rawPhone !== null && String(rawPhone).trim() !== '') {
      phone = normalizeToE164(rawPhone);
      if (!phone) {
        return res.status(400).json({
          success: false, error: 'VALIDATION_ERROR',
          message: 'Enter a valid phone number in international format (e.g. +1 555 123 4567).',
        });
      }
    }
    if (consent && !phone) {
      return res.status(400).json({
        success: false, error: 'VALIDATION_ERROR',
        message: 'Add a mobile number to receive text alerts.',
      });
    }

    const nowISO = new Date().toISOString();
    const patch = {
      sms_consent: consent,
      sms_consent_at: nowISO,
      sms_phone: phone,
      // The ORGANIZER's version, not the guest one. What they agreed to is a
      // headcount summary about their own event; the guest sentence describes
      // invitation links and RSVP confirmations they will never receive, and
      // stamping it here recorded consent to the wrong document.
      sms_consent_text_version: consent ? ORGANIZER_SMS_CONSENT_TEXT_VERSION : null,
      sms_consent_ip: consent ? (req.ip || null) : null,
    };

    const { error: updErr } = await supabase
      .from('organizations').update(patch).eq('id', event.org_id);
    if (updErr) {
      // The provenance columns arrive in 20260821000000; on a database without
      // them the consent itself must still be recordable.
      if (/sms_consent_text_version|sms_consent_ip/i.test(updErr.message || '')) {
        logger.warn('organizations.sms_consent_text_version missing — apply 20260821000000_sms_organizer_optin_and_perf.sql');
        const { error: retryErr } = await supabase
          .from('organizations')
          .update({ sms_consent: consent, sms_consent_at: nowISO, sms_phone: phone })
          .eq('id', event.org_id);
        if (retryErr) throw retryErr;
      } else {
        throw updErr;
      }
    }

    if (phone) {
      // Opting in after a STOP is a change of mind, and the only way to act on it
      // — nothing else can clear a suppression. Matches /sms-opt-in exactly.
      if (consent) {
        const { error: liftErr } = await supabase
          .from('sms_opt_outs')
          .update({ opted_back_in_at: nowISO })
          .eq('phone', phone)
          .is('opted_back_in_at', null);
        if (liftErr) logger.warn({ err: liftErr }, 'organizer opt-in: lifting suppression failed');
      }

      // Logged either way. A dated refusal is evidence the question was asked
      // separately and freely answered — the same reason guest refusals are kept.
      logSmsConsentDecision({
        eventId, phone, consent, source: 'organizer_settings',
      });
    }

    return res.json({
      success: true,
      organizerSms: { consent, phone },
      message: consent
        ? 'You will now get text alerts about your events.'
        : 'Text alerts turned off.',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Price a top-up BEFORE the organizer commits to it.
 * GET /api/v1/events/:eventId/campaigns/topup-quote?messages=N
 *
 * Requirement: never let someone reach Stripe and discover the price there. The
 * figure comes from describeSmsCharge — the same function the checkout charges
 * with — so the quote and the invoice cannot disagree.
 *
 * Also returns what that quantity would COVER, because "500 messages for $44" is
 * only meaningful next to "enough for your 180 guests".
 */
const getTopUpQuote = async (req, res, next) => {
  const { eventId } = req.params;
  try {
    const config = await getPlatformConfig();
    const pricing = normalizeSmsPricing(config.sms_pricing_config);

    const requested = Number(req.query.messages);
    const messages = Number.isFinite(requested)
      ? Math.min(Math.max(Math.round(requested), pricing.bounds.min), pricing.bounds.max)
      : pricing.bounds.min;

    const charge = describeSmsCharge({
      unitPriceCents: config.sms_rate_cents_per_credit,
      creditCount: messages,
      markupPct: config.sms_markup_percentage,
      volumeDiscounts: volumeDiscountsFromConfig(config),
    });

    let coverage = null;
    try {
      const { count } = await supabase
        .from('guests').select('id', { count: 'exact', head: true }).eq('event_id', eventId);
      coverage = coverageForGuests(messages, count || 0, config.sms_pricing_config);
    } catch { /* advisory */ }

    return res.json({
      success: true,
      messages,
      priceCents: charge.chargeCents,
      discountPct: charge.discountPct,
      bounds: pricing.bounds,
      coverage,
      // Never expose baseCostCents / profitCents here: this endpoint is reachable
      // by any event owner, and what the carrier charges us is not their business.
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Re-send ONE previously-failed message.
 * POST /api/v1/events/:eventId/campaigns/resend/:logId
 *
 * Requirement: a failed message should be one button, not a whole new campaign.
 * Building a campaign to reach one guest is both absurd and dangerous — the
 * audience filters would sweep in everyone else who matches.
 *
 * Only failures the organizer can actually fix are resendable (see
 * smsUsage.isResendable). A guest who replied STOP, or who never agreed to texts,
 * is not offered a retry: the button would imply it might override their choice,
 * and it never will.
 */
const resendSmsMessage = async (req, res, next) => {
  const { eventId, logId } = req.params;
  try {
    const { data: row, error } = await supabase
      .from('sms_log')
      .select('id, kind, ref, party_id, event_id, status, skip_reason')
      .eq('id', logId)
      .eq('event_id', eventId)   // scope to the authorized event — never trust the id alone
      .maybeSingle();

    if (error || !row) {
      return res.status(404).json({ success: false, error: 'MESSAGE_NOT_FOUND', message: 'That message could not be found.' });
    }
    // A type this platform no longer sends can never be resent, and this check
    // MUST come before the delete below.
    //
    // The order is the whole point. The delete is correct for a live type — the
    // (kind, ref) unique index would otherwise make a deliberate retry a silent
    // no-op — but for a retired kind the re-dispatch that follows fails on
    // UNKNOWN_TYPE, and by then the row is gone. The organizer would get an error
    // and we would have destroyed a compliance record to produce it.
    //
    // isResendable already returns false for these, so this is the second of two
    // guards rather than the only one. It is here because the cost of the two
    // disagreeing is an unrecoverable deletion, and belt-and-braces is cheap.
    if (isRetiredSmsType(row.kind)) {
      return res.status(400).json({
        success: false, error: 'RETIRED_TYPE',
        message: 'That kind of message is no longer sent. It is kept here for your records.',
      });
    }

    if (!isResendable(row)) {
      return res.status(400).json({
        success: false, error: 'NOT_RESENDABLE',
        message: row.status === 'sent'
          ? 'That message was already delivered.'
          : `This one can't be resent — ${(explainSkip(row.skip_reason) || 'it could not be delivered').toLowerCase()}.`,
      });
    }

    // Clear the old attempt. sendTransactionalSms refuses duplicates on
    // (kind, ref), which is exactly right for a scheduler re-run and exactly
    // wrong for a deliberate retry — without this the resend would report
    // "already sent" and do nothing.
    await supabase.from('sms_log').delete().eq('id', row.id);

    const result = await sendTransactionalSms({
      type: row.kind,
      eventId,
      partyId: row.party_id,
      ref: row.ref,
      context: await buildResendContext(eventId, row),
    });

    if (result.sent) {
      return res.json({ success: true, message: 'Message sent.' });
    }
    return res.status(200).json({
      success: false,
      error: result.reason,
      message: `Still not sent — ${(explainSkip(result.reason) || 'it could not be delivered').toLowerCase()}.`,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Rebuild the template values for a resend.
 *
 * The original context is not stored — sms_log records what happened, not the
 * variables that produced it. Re-deriving from current data is also more correct
 * than replaying stale values: if the guest's name or their table changed since
 * the failed attempt, the resend should carry the new one.
 */
async function buildResendContext(eventId, row) {
  // Seeded with safe defaults for EVERY value any template interpolates. A
  // template reads its context blindly, so a missing key renders the literal
  // "undefined" into a message a guest receives — and an organizer report resent
  // without stats would read "Gala: undefined attending, undefined awaiting
  // reply." Defaults first, real values over the top.
  const base = getPublicBaseUrl();
  const ctx = {
    guestName: 'Guest',
    eventTitle: '',
    response: null,
    tableName: null,
    ticketUrl: null,
    url: base,
    cancelled: false,
    dateLabel: null,
    attending: 0,
    pending: 0,
    rsvpUrl: `${base}/dashboard`,
    dashboardUrl: `${base}/dashboard`,
  };

  try {
    const { data: event } = await supabase
      .from('events').select('title, slug, event_date, timezone, status').eq('id', eventId).single();
    ctx.eventTitle = event?.title || '';
    if (event?.slug) {
      ctx.url = `${base}/${event.slug}`;
      /**
       * Same URL the original send used — the INVITATION page, not the RSVP form.
       *
       * This rebuilt the link by hand as `/{slug}/rsvp?g=…` while invitationService
       * sends `/{slug}?party_id=…`, so a resend quietly downgraded the guest from the
       * full invitation to a bare form. Nobody would notice: the message is identical,
       * only the destination differs, and the person who sees it is not the person who
       * pressed the button.
       *
       * Going through the shared helper is the point. A hand-built copy of a URL
       * shape is a second definition that has to be remembered on every change, and
       * this one already fell behind once.
       */
      if (row.party_id) ctx.rsvpUrl = buildGuestEventUrl(event.slug, row.party_id);
    }
    // A change notice resent after the event was called off must say "cancelled",
    // not "the details have changed" — re-deriving from CURRENT state is exactly
    // why this rebuilds rather than replays.
    ctx.cancelled = event?.status === 'cancelled';

    let party = null;
    if (row.party_id) {
      const { data } = await supabase
        .from('rsvp_parties')
        /* `guests(id)` and NOT `party_size` — there has never been a
           `party_size` column on rsvp_parties.
           The cap is `max_party_size`; the actual size is the number of rows in
           `guests`, which is how invitationService and emailScheduler both
           derive it. Selecting a column that does not exist does not return
           null for that field — PostgREST rejects the WHOLE query, so this
           lookup returned nothing at all and every seating reminder built from
           it went out with no pass link. */
        .select('label, response, guests(id), seating_assignments(tables(table_name))')
        .eq('id', row.party_id).maybeSingle();
      party = data;
      if (party?.label) ctx.guestName = party.label;
      ctx.response = party?.response ?? null;
      ctx.tableName = party?.seating_assignments?.[0]?.tables?.table_name || null;
    }

    // The entry-pass link is a signed token, not a derivable URL, so it costs a
    // mint — and only the type that actually shows one pays for it.
    //
    // signQrTicketForResponse returns null for anyone who is not a confirmed
    // 'yes', which is precisely the gate wanted here: a guest who declined has no
    // pass, and the template's no-link shape is the correct message for them.
    if (row.kind === 'seating_reminder' && row.party_id && party) {
      const { buildTicketLinks } = require('../utils/emailTemplates');
      const token = tokenService.signQrTicketForResponse({
        response: party.response,
        partyId: row.party_id,
        eventId,
        tableName: ctx.tableName,
        partySize: (party.guests || []).length || 1,
        eventDate: event?.event_date,
      });
      if (token) ctx.ticketUrl = buildTicketLinks(token).ticketUrl;
    }

    // Only the organizer-facing report needs live counts, and only it pays for
    // the extra query.
    if (row.kind === 'organizer_report') {
      const { getEventStats } = require('../utils/emailContext');
      const stats = await getEventStats(eventId);
      ctx.attending = stats?.attending ?? 0;
      ctx.pending = stats?.pending ?? 0;
    }
  } catch { /* the defaults above still render a correct, if plainer, message */ }

  return ctx;
}

/**
 * Update the per-type switches.
 * PATCH /api/v1/events/:eventId/campaigns/settings   body: { settings: {...} }
 *
 * The payload is passed through sanitizeSmsSettings, so unknown keys and
 * non-boolean values can never reach the jsonb column — the switches are read at
 * send time to decide whether to spend an organizer's money, and a smuggled value
 * there would be read as truthy.
 */
const updateSmsSettings = async (req, res, next) => {
  const { eventId } = req.params;
  try {
    const settings = sanitizeSmsSettings(req.body?.settings);
    const { data, error } = await supabase
      .from('events')
      .update({ sms_settings: settings, updated_at: new Date().toISOString() })
      .eq('id', eventId)
      .select('id, sms_settings')
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, error: 'EVENT_NOT_FOUND', message: 'Event not found.' });
    }

    return res.json({ success: true, settings: sanitizeSmsSettings(data.sms_settings) });
  } catch (err) {
    next(err);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
 * ORGANIZER-AUTHORED MESSAGE BODIES
 *
 * Everything the composer needs to open, in one request: the types, the tags
 * each type allows, what OUR body says, what THEIRS says, and what either one
 * costs at worst case.
 *
 * The default bodies are rendered here rather than shipped to the client as
 * strings, and that is the only way this can be right. The built-in templates
 * are JavaScript functions with branches in them — `seating_reminder` has four
 * shapes depending on whether a table and a date are known — so there is no
 * string to send. Rendering them server-side through the same `renderSmsBody`
 * the dispatcher calls means the "this is what we send" preview cannot drift
 * from what actually goes out.
 * ═══════════════════════════════════════════════════════════════════════════ */

const getSmsTemplates = async (req, res, next) => {
  const { eventId } = req.params;
  try {
    const { data: event, error } = await supabase
      .from('events').select('id, sms_templates').eq('id', eventId).maybeSingle();
    if (error || !event) {
      return res.status(404).json({ success: false, error: 'EVENT_NOT_FOUND', message: 'Event not found.' });
    }

    const stored = (event.sms_templates && typeof event.sms_templates === 'object') ? event.sms_templates : {};

    const types = SMS_MESSAGE_TYPES.map((type) => {
      const tags = tagsForType(type.key).map(({ tag, label, sample, max }) => ({ tag, label, sample, max }));
      const context = sampleContext(type.key);

      const languages = {};
      for (const lang of ['en', 'ar']) {
        // No `override` — this is deliberately OUR body, so the composer can
        // show it beside theirs and offer "start from this".
        const body = renderSmsBody(type.key, lang, context) || '';
        const custom = stored?.[type.key]?.[lang] || null;
        languages[lang] = {
          default: body,
          /**
           * MEASURED AGAINST maxContext, NOT AGAINST THE BODY SHOWN.
           *
           * `body` is rendered from sampleContext because it has to be READABLE
           * — it is the copy displayed in the editor. Measuring that string
           * quotes a typical case: the Arabic confirmation reports 7 segments
           * where it can actually bill 8. So the price comes from a second
           * render at the true ceiling, and the two deliberately differ.
           *
           * `measureTemplate` cannot fix this on its own here: the built-in body
           * arrives with its values already substituted, so there are no {tags}
           * left for its worst-case map to expand.
           */
          defaultMeasured: measureTemplate(type.key, renderSmsBody(type.key, lang, maxContext(type.key)) || ''),
          custom,
          // Null when they have not written one — the client renders the
          // default's figures in that case rather than a zero.
          customMeasured: custom ? measureTemplate(type.key, custom) : null,
        };
      }

      return {
        key: type.key,
        label: type.label,
        description: type.description,
        audience: type.audience,
        trigger: type.trigger,
        tags,
        languages,
      };
    });

    return res.json({
      success: true,
      types,
      // The footer is appended to every body and counts against every segment,
      // so the composer has to render it inside the preview bubble. Sent rather
      // than duplicated client-side: a mirrored copy has already drifted once
      // (see the note on COMPLIANCE_FOOTER in services/smsDispatch.js).
      complianceFooter: COMPLIANCE_FOOTER,
      limits: { maxSegments: MAX_TEMPLATE_SEGMENTS, maxChars: MAX_TEMPLATE_CHARS },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Save message bodies.
 *
 * A MERGE, not a replace. The composer edits one type in one language at a time
 * and PATCHes just that; replacing the column would wipe every other body the
 * organizer has written the moment they touch a second one.
 *
 * A `null` value is how the UI says "reset this one to yours" — the key is
 * deleted rather than stored as null, so `sms_templates` never accumulates
 * tombstones and `renderSmsBody`'s optional chain finds nothing, which is
 * exactly the built-in path.
 */
const updateSmsTemplates = async (req, res, next) => {
  const { eventId } = req.params;
  try {
    const result = sanitizeSmsTemplates(req.body?.templates);
    if (!result.ok) {
      return res.status(400).json({
        success: false,
        error: result.error,
        message: result.message,
        // Which box to put the error under. Without these the composer can only
        // show the sentence at the top of the page and let the organizer hunt
        // for which of ten editors it refers to.
        type: result.type || null,
        lang: result.lang || null,
        measured: result.measured || null,
      });
    }

    const { data: current, error: readErr } = await supabase
      .from('events').select('id, sms_templates').eq('id', eventId).maybeSingle();
    if (readErr) throw readErr;
    if (!current) {
      return res.status(404).json({ success: false, error: 'EVENT_NOT_FOUND', message: 'Event not found.' });
    }

    const merged = { ...(current.sms_templates && typeof current.sms_templates === 'object' ? current.sms_templates : {}) };
    for (const [type, byLang] of Object.entries(result.templates)) {
      const next = { ...(merged[type] || {}) };
      for (const [lang, value] of Object.entries(byLang)) {
        if (value === null) delete next[lang];
        else next[lang] = value;
      }
      // An empty object left behind reads as "this type has overrides" to
      // anything scanning keys. Drop it.
      if (Object.keys(next).length === 0) delete merged[type];
      else merged[type] = next;
    }

    const { data, error } = await supabase
      .from('events')
      .update({ sms_templates: merged, updated_at: new Date().toISOString() })
      .eq('id', eventId)
      .select('id, sms_templates')
      .maybeSingle();
    if (error) throw error;

    return res.json({
      success: true,
      templates: data?.sms_templates || {},
      measured: result.measured,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Recent send attempts, skips included.
 * GET /api/v1/events/:eventId/campaigns/log
 *
 * The skipped rows are the point. A campaign reporting "sent 52, skipped 3" is
 * only actionable if the organizer can see WHICH three and WHY.
 */
const getSmsLog = async (req, res, next) => {
  const { eventId } = req.params;
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  try {
    const { data, error } = await supabase
      .from('sms_log')
      .select('id, kind, recipient, party_id, status, skip_reason, segments, credits, error, created_at')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;

    const rows = data || [];

    // Resolve guest names in ONE query. A log listing phone numbers is unreadable
    // to the organizer and useless to support: nobody recognises +1555… as their
    // aunt, which is the exact question a "why didn't they get it?" ticket asks.
    const partyIds = [...new Set(rows.map((r) => r.party_id).filter(Boolean))];
    const names = {};
    if (partyIds.length > 0) {
      const { data: parties } = await supabase
        .from('rsvp_parties').select('id, label').in('id', partyIds);
      for (const p of (parties || [])) names[p.id] = p.label;
    }

    // Every row is decorated server-side so the reason a message did not arrive is
    // stated identically in the dashboard, in support tooling, and anywhere else
    // this is read — rather than each client inventing its own wording for the
    // same code, or worse, showing the raw code.
    const entries = rows.map((r) => ({
      ...r,
      guestName: r.party_id ? (names[r.party_id] || null) : null,
      // What KIND of message this was, in words. The log keeps history for types
      // the platform has since retired, and a row reading "campaign" or
      // "qr_ticket" means nothing to an organizer — labelForKind resolves live
      // types to their current label and retired ones to a name that says so.
      typeLabel: labelForKind(r.kind),
      retiredType: isRetiredSmsType(r.kind),
      // The whole outcome in one readable phrase.
      outcome: r.status === 'sent' ? 'Delivered' : 'Not sent',
      reason: r.status === 'sent' ? null : explainSkip(r.skip_reason || r.error),
      canResend: isResendable(r),
    }));

    return res.json({ success: true, entries });
  } catch (err) {
    // The log is diagnostic; a missing table (migration not yet applied) must
    // degrade to an empty list rather than break the settings screen.
    logger.warn({ err, eventId }, 'sms log read failed — returning empty');
    return res.status(200).json({ success: true, entries: [] });
  }
};

module.exports = {
  // Not a route handler — exported so invitationService can apply the identical
  // ramp-up rule the middleware applies, rather than growing a second opinion
  // about how many messages a new account may send at once.
  resolveSendLimit,
  getCampaignHistory,
  getSmsSettings,
  updateSmsSettings,
  getSmsTemplates,
  updateSmsTemplates,
  getSmsLog,
  getTopUpQuote,
  resendSmsMessage,
  updateOrganizerSmsConsent,
  handleSmsStatusCallback,
  handleInboundSms,
};
