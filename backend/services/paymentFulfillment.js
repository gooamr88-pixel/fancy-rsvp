const { supabase } = require('../config/supabase');
const logger = require('../utils/logger');
const { sendEmailViaBrevo } = require('../utils/notificationService');
const { getStripePaymentReceiptTemplate } = require('../utils/emailTemplates');
const { getPlatformConfig } = require('../utils/configCache');
const { resolveTier } = require('../utils/tierResolver');
const { captureReferralHold, spendReferralCredit, grantReferralRewardIfEligible, reverseReferralForRefundedPayment } = require('./referralService');

/**
 * Single source of truth for fulfilling a completed Stripe Checkout Session.
 *
 * Called from BOTH the Stripe webhook (async, the backstop) and the synchronous
 * /payments/verify endpoint (hit on the browser redirect). Because either path
 * may run first — and Stripe retries webhooks — every write here is idempotent:
 *   • event_fee   → guarded by the unique event_payments.stripe_checkout_session_id
 *   • sms_credits → guarded inside record_sms_purchase() (unique payment_intent)
 *
 * Returns { ok, type, alreadyProcessed, eventId } so callers can shape a response.
 * Throws only on genuine/unexpected DB failures (so the webhook can 5xx → retry).
 */
/**
 * Remember the Stripe customer, if this organization did not have one.
 *
 * SMS-credit checkout now falls back to `customer_email` when the organization
 * has no `stripe_customer_id` — which is the normal state for an event paid by
 * promo code, bank transfer or an admin comp, since that column is only ever
 * written by the card checkout. Stripe creates a customer for such a session
 * and returns its id.
 *
 * Without capturing it here, every subsequent top-up creates ANOTHER customer:
 * the organization accumulates duplicates in Stripe, no payment method is ever
 * reusable, and the column stays null forever. Nothing breaks loudly, which is
 * why it would not have been noticed.
 *
 * Guarded on the column still being null so a real card customer is never
 * overwritten, and best-effort throughout: the credits are the point of this
 * webhook, and failing to record a customer id must not fail fulfilment.
 */
async function rememberStripeCustomer(orgId, customerId) {
  if (!orgId || !customerId || typeof customerId !== 'string') return;
  try {
    await supabase
      .from('organizations')
      .update({ stripe_customer_id: customerId })
      .eq('id', orgId)
      .is('stripe_customer_id', null);
  } catch (err) {
    logger.warn({ err, orgId }, '[fulfill] could not record the Stripe customer id');
  }
}

const fulfillCheckoutSession = async (session) => {
  const { event_id, type } = session.metadata || {};

  if (!event_id || !type) {
    // Nothing we can do with an unidentifiable session — treat as a no-op so a
    // stray event never wedges the webhook into a retry loop.
    return { ok: true, type: type || null, alreadyProcessed: false, eventId: event_id || null, skipped: 'missing_metadata' };
  }

  if (type === 'event_fee') {
    // Idempotency: has this checkout session already been recorded?
    const { data: existingPayment } = await supabase
      .from('event_payments')
      .select('id')
      .eq('stripe_checkout_session_id', session.id)
      .limit(1);

    if (existingPayment && existingPayment.length > 0) {
      return { ok: true, type, alreadyProcessed: true, eventId: event_id };
    }

    // Snapshot the purchased tier ("current plan") from the checkout metadata
    // (set in createCheckoutSession). tier_max_guests arrives as a string.
    const tierName = session.metadata.tier_name || null;
    const tierKey = session.metadata.tier_key || null;
    const rawCap = session.metadata.tier_max_guests;
    const parsedCap = rawCap !== undefined && rawCap !== '' ? parseInt(rawCap, 10) : NaN;
    const tierMaxGuests = Number.isFinite(parsedCap) ? parsedCap : null;
    const tierRemoveWatermark = session.metadata.tier_remove_watermark === '1';
    // White label implies the mark is gone; tierRemovesWatermark already folded
    // that in when the metadata was written, so these two never disagree.
    const tierWhiteLabel = session.metadata.tier_white_label === '1';
    const isUpgrade = session.metadata.is_upgrade === '1';
    const rawPrice = session.metadata.tier_price_cents;
    const parsedPrice = rawPrice !== undefined && rawPrice !== '' ? parseInt(rawPrice, 10) : NaN;
    const tierPriceCents = Number.isFinite(parsedPrice) ? parsedPrice : null;

    // The feature list is NOT in the metadata (Stripe caps a value at 500
    // chars); it is read from the live config by key and written onto the event
    // so the purchase carries its own entitlement from the moment it completes.
    // A checkout can outlive an admin's config edit — session creation and this
    // webhook are minutes and a redirect apart — so if the plan cannot be
    // resolved here the snapshot is simply omitted rather than written empty,
    // and withResolvedTier heals the row on the next read.
    let tierFeatures = null;
    try {
      const cfg = await getPlatformConfig();
      const { tier: resolved } = resolveTier(cfg.pricing_tiers, { key: tierKey, name: tierName });
      if (resolved && Array.isArray(resolved.features)) tierFeatures = resolved.features;
    } catch { /* leave unsnapshotted; the read path will heal it */ }

    // BIZ-2: re-check the tier's max_events cap authoritatively HERE, not just
    // at checkout-session creation (createCheckoutSession). The cap check
    // there and this write happen minutes apart across a Stripe redirect/
    // webhook — two concurrent checkouts for the same org (two tabs, a
    // double-click, or an upgrade racing a second event's fresh purchase) can
    // both pass that earlier check and both land here, silently exceeding the
    // org's plan cap. If exceeded now, take the money (already charged — a
    // refund needs a human decision) but do NOT activate the tier; flag it
    // for manual reconciliation instead of silently over-provisioning.
    let tierCapExceeded = false;
    // Also doubles as the org lookup for the referral-credit spend / reward-grant
    // hooks further below — one read serves both, regardless of tierName.
    const { data: eventOrgRow } = await supabase.from('events').select('org_id').eq('id', event_id).maybeSingle();
    const eventOrgId = eventOrgRow?.org_id || null;
    if ((tierName || tierKey) && eventOrgId) {
      try {
        const adminConfig = await getPlatformConfig();
        const { tier } = resolveTier(adminConfig.pricing_tiers, { key: tierKey, name: tierName });
        if (tier && Number(tier.max_events) > 0) {
          // By key, with a second count for rows sold before keys existed:
          // counting by name alone stopped counting an event the moment its
          // plan was renamed, which quietly un-enforced the cap.
          //
          // Two counts rather than one `.or()`, because an `.or()` filter is a
          // hand-built string and a tier NAME goes into it — "Pro, Plus" would
          // inject a comma into PostgREST's filter grammar. Individual filter
          // methods encode their values.
          const base = () => supabase
            .from('events')
            .select('id', { count: 'exact', head: true })
            .eq('org_id', eventOrgId)
            .eq('is_paid', true)
            .neq('id', event_id);
          const key = String(tier.key || '').trim();
          let count = 0;
          if (key) {
            const [byKey, legacy] = await Promise.all([
              base().eq('tier_key', key),
              base().is('tier_key', null).ilike('tier_name', tier.name),
            ]);
            count = (byKey.count || 0) + (legacy.count || 0);
          } else {
            ({ count } = await base().ilike('tier_name', tier.name));
          }
          if ((count || 0) >= tier.max_events) tierCapExceeded = true;
        }
      } catch (e) {
        logger.warn({ err: e, eventId: event_id }, '[fulfill] tier cap re-check skipped (config fetch failed)');
      }
    }

    // SEC C5: Optimistic locking — only meaningful for a FIRST-TIME payment's
    // false->true transition. It used to run unconditionally, which meant an
    // UPGRADE (is_paid already true before this checkout even started) could
    // never match `.eq('is_paid', false)` — the UPDATE always affected 0 rows,
    // so every upgrade was silently treated as "already processed": Stripe
    // charged the card, but the new tier/guest-cap was never applied and no
    // event_payments row further below was ever reached. An upgrade also must
    // NOT reset `status` back to 'pending_review' — that would bounce an
    // already-live, already-approved event back into admin review on every
    // upgrade, hiding it from guests until someone re-approves it.
    const eventUpdate = { is_paid: true, updated_at: new Date().toISOString() };
    if (!isUpgrade) eventUpdate.status = 'pending_review';

    let eventQuery = supabase.from('events').update(eventUpdate).eq('id', event_id);
    if (!isUpgrade) eventQuery = eventQuery.eq('is_paid', false);
    const { data: updatedEvent, error: eventError } = await eventQuery.select('id').maybeSingle();

    if (eventError) throw eventError;

    // If no row was updated, a concurrent call already fulfilled this event
    // (only reachable for a first-time payment now that the guard is
    // conditional — an upgrade always targets `.eq('id', event_id)` alone).
    if (!updatedEvent) {
      return { ok: true, type, alreadyProcessed: true, eventId: event_id };
    }

    // The org's own cap on this tier was exceeded by the time we got here (see
    // the BIZ-2 re-check above) — the payment is still recorded below (money
    // was already charged; refunding needs a human decision), but the tier is
    // deliberately NOT applied, so the org can't silently end up with more
    // events on this tier than their plan allows.
    if (tierCapExceeded) {
      logger.error({ eventId: event_id, tierName, sessionId: session.id },
        '[fulfill] TIER CAP EXCEEDED — payment charged but tier NOT applied, needs manual reconciliation');
      try {
        await supabase.from('activity_logs').insert({
          event_id,
          action: 'tier_cap_exceeded',
          entity_type: 'event_payment',
          metadata: { tier_name: tierName, session_id: session.id },
        });
      } catch (e) {
        logger.warn({ err: e, eventId: event_id }, '[fulfill] activity_log skipped for tier_cap_exceeded');
      }
    } else if (tierName || tierKey || tierMaxGuests !== null) {
      // Persist the tier separately and best-effort: the tier_name/tier_max_guests
      // columns ship in migration 20260624000000. If it hasn't been applied yet we
      // must NOT fail (and make Stripe retry) the already-committed activation — so
      // this write is isolated. Its error is logged at `error` (not `warn`) and
      // recorded in activity_logs — a customer has been charged with no tier/guest
      // cap applied, which needs an operator's attention, not a log line nobody
      // reads. Apply the migration to make the "Current Plan" panel light up.
      const { error: tierErr } = await supabase
        .from('events')
        .update({
          tier_name: tierName,
          tier_key: tierKey,
          tier_max_guests: tierMaxGuests,
          tier_remove_watermark: tierRemoveWatermark,
        tier_white_label: tierWhiteLabel,
          ...(tierFeatures ? { tier_features: tierFeatures } : {}),
          ...(tierPriceCents !== null ? { tier_price_cents: tierPriceCents } : {}),
        })
        .eq('id', event_id);
      if (tierErr) {
        logger.error({ err: tierErr, eventId: event_id }, '[fulfill] TIER PERSISTENCE FAILED — customer charged but tier/guest-cap not applied (run migration 20260624000000)');
        try {
          await supabase.from('activity_logs').insert({
            event_id,
            action: 'tier_persistence_failed',
            entity_type: 'event_payment',
            metadata: { tier_name: tierName, tier_max_guests: tierMaxGuests, error: tierErr.message },
          });
        } catch (e) {
          logger.warn({ err: e, eventId: event_id }, '[fulfill] activity_log skipped for tier_persistence_failed');
        }
      }
    }

    // REFERRAL-1: the credit was HELD at checkout-session creation
    // (createCheckoutSession) — this is where the hold becomes a real spend, now
    // that the payment is confirmed. Both the amount and the hold id are read back
    // from Stripe's own metadata rather than re-querying the live balance, so the
    // amount charged and the amount debited from the ledger always agree even if
    // the balance moved in between.
    const rawCreditApplied = session.metadata.referral_credit_applied_cents;
    const referralCreditAppliedCents = rawCreditApplied !== undefined ? parseInt(rawCreditApplied, 10) || 0 : 0;
    const referralHoldId = session.metadata.referral_hold_id || null;

    // Record the payment.
    const { data: insertedPayment, error: insertError } = await supabase.from('event_payments').insert({
      event_id,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: session.payment_intent,
      amount_cents: session.amount_total,
      currency: session.currency,
      status: 'completed',
      payment_method: 'stripe',
      // The card path never recorded which plan it bought — every other
      // payment path did. That gap is why a Stripe receipt could not name the
      // plan and why the event's tier could only ever be re-derived.
      tier_key: tierKey,
      tier_name: tierName,
      tier_max_guests: tierMaxGuests,
      tier_remove_watermark: tierRemoveWatermark,
        tier_white_label: tierWhiteLabel,
      ...(tierFeatures ? { tier_features: tierFeatures } : {}),
      ...(tierPriceCents !== null ? { tier_price_cents: tierPriceCents } : {}),
      referral_credit_applied_cents: referralCreditAppliedCents,
      referral_hold_id: referralHoldId,
      completed_at: new Date().toISOString(),
    }).select('id').single();

    if (insertError) {
      // A racing call (webhook vs verify) may insert first — treat the unique
      // violation as "already processed" rather than an error.
      if (insertError.code === '23505' || (insertError.message || '').includes('duplicate key')) {
        return { ok: true, type, alreadyProcessed: true, eventId: event_id };
      }
      throw insertError;
    }

    if (referralCreditAppliedCents > 0 && eventOrgId) {
      const note = `Applied to ${tierName || 'plan'} activation (card payment)`;
      let ok = false;
      if (referralHoldId) {
        // Capture the reservation cut at checkout. Idempotent — the webhook and
        // the synchronous /payments/verify path both land here and race.
        const capture = await captureReferralHold({ holdId: referralHoldId, paymentId: insertedPayment?.id || null, note });
        ok = capture.captured;
      } else {
        // Legacy: a checkout session created BEFORE the holds migration carries a
        // credit amount but no hold — write the spend directly.
        try {
          await spendReferralCredit({
            orgId: eventOrgId,
            amountCents: referralCreditAppliedCents,
            eventId: event_id,
            paymentId: insertedPayment?.id || null,
            note,
          });
          ok = true;
        } catch (e) {
          logger.error({ err: e, eventId: event_id }, '[fulfill] legacy referral credit spend failed');
        }
      }
      if (!ok) {
        logger.error({ eventId: event_id, holdId: referralHoldId }, '[fulfill] referral credit capture failed — charged discounted but ledger not debited, needs reconciliation');
        try {
          await supabase.from('activity_logs').insert({
            event_id,
            action: 'referral_credit_capture_failed',
            entity_type: 'event_payment',
            metadata: { amount_cents: referralCreditAppliedCents, payment_id: insertedPayment?.id || null, hold_id: referralHoldId },
          });
        } catch { /* best-effort breadcrumb */ }
      }
    }

    if (!isUpgrade && eventOrgId) {
      grantReferralRewardIfEligible({ referredOrgId: eventOrgId, eventId: event_id }).catch((e) =>
        logger.warn({ err: e, eventId: event_id }, '[fulfill] referral reward grant skipped')
      );
    }

    // SMS add-on bought on the SAME session as the licence (a second line item).
    // Runs after the event is activated so the add-on can never be credited to an
    // event that failed to activate. record_sms_purchase is idempotent on the
    // payment intent, so a Stripe retry of this webhook cannot double-credit.
    await fulfillSmsAddon(session, event_id);

    // Audit log is best-effort — never fail fulfillment (and never make Stripe
    // retry an already-committed activation) because of a logging hiccup.
    try {
      await supabase.from('activity_logs').insert({
        event_id,
        action: 'event_payment_completed',
        entity_type: 'event_payment',
        metadata: { amount_cents: session.amount_total },
      });
    } catch (e) {
      logger.warn({ err: e, eventId: event_id }, '[fulfill] activity_log skipped');
    }

    // Email the organizer a card-payment receipt (best-effort — never block/fault
    // the already-committed fulfillment). The event is now under review.
    try {
      const { data: ev } = await supabase
        .from('events')
        .select('title, organizations(name, email)')
        .eq('id', event_id)
        .single();
      const orgEmail = ev?.organizations?.email;
      if (orgEmail) {
        const html = getStripePaymentReceiptTemplate({
          orgName: ev.organizations.name || 'Organizer',
          eventTitle: ev.title || 'Your event',
          amountCents: session.amount_total,
          tierName: tierName || null,
          referenceNumber: session.payment_intent || session.id,
        });
        await sendEmailViaBrevo(orgEmail, `Payment Received — ${ev.title || 'Your Event'}`, html);
      }
    } catch (e) {
      logger.warn({ err: e, eventId: event_id }, '[fulfill] receipt email skipped');
    }

    return { ok: true, type, alreadyProcessed: false, eventId: event_id };
  }

  if (type === 'sms_credits') {
    const creditCount = parseInt(session.metadata.credit_count, 10);
    if (!Number.isInteger(creditCount) || creditCount <= 0) {
      throw new Error(`Invalid credit_count value: ${session.metadata.credit_count}`);
    }

    // Capture the customer Stripe created for an organization that had none —
    // see rememberStripeCustomer. Before the credit RPC, so a duplicate webhook
    // delivery (which returns early as already_processed) still fills the column
    // if the first delivery somehow did not.
    if (session.customer) {
      const { data: orgRow } = await supabase.from('events').select('org_id').eq('id', event_id).maybeSingle();
      await rememberStripeCustomer(orgRow?.org_id, session.customer);
    }

    // Single transactional RPC: ensures wallet, writes the idempotency ledger row,
    // and credits the wallet atomically. Duplicate delivery → already_processed.
    // p_amount_cents is stored on the ledger row so this revenue stream shows up
    // in admin revenue totals (previously invisible — sms_credit_ledger never
    // recorded a dollar amount at all).
    const { data: purchaseResult, error: purchaseError } = await supabase.rpc('record_sms_purchase', {
      p_event_id: event_id,
      p_credits: creditCount,
      p_payment_intent: session.payment_intent,
      p_amount_cents: session.amount_total ?? null,
    });

    if (purchaseError) throw purchaseError;
    if (purchaseResult && purchaseResult.success === false) {
      throw new Error(`record_sms_purchase failed: ${purchaseResult.error}`);
    }

    // A standalone purchase can be the FIRST one (the free-tier add-on path, which
    // creates an SMS-only session) or a later top-up. Either way, credit implies
    // entitlement: an event holding paid-for messages it is not allowed to send
    // would be the worst of both states. unlockSmsAddon is idempotent.
    await unlockSmsAddon(event_id);

    if (!purchaseResult?.already_processed) {
      try {
        await supabase.from('activity_logs').insert({
          event_id,
          action: 'sms_credits_purchased',
          entity_type: 'sms_wallet',
          metadata: { credit_count: creditCount, addon_unlock: session.metadata?.sms_addon_unlock === '1' },
        });
      } catch (e) {
        logger.warn({ err: e, eventId: event_id }, '[fulfill] activity_log skipped for sms purchase');
      }
    }

    return { ok: true, type, alreadyProcessed: !!purchaseResult?.already_processed, eventId: event_id };
  }

  return { ok: true, type, alreadyProcessed: false, eventId: event_id, skipped: 'unknown_type' };
};

/**
 * Mark an event as SMS-entitled. Idempotent by construction: the guard means a
 * repeated webhook, or a top-up on an event that already bought the add-on, never
 * moves the original purchase date — which is the field the gate and the audit
 * trail both read.
 */
async function unlockSmsAddon(eventId) {
  if (!eventId) return;

  // Re-arm the balance warnings. Without this, an organizer warned once, who then
  // tops up and later runs low again, is never warned a second time — the stamp
  // is still set from the first occasion. Topping up is exactly the moment the
  // previous warning stops being true.
  //
  // supabase-js RESOLVES with an { error } object rather than throwing, so the
  // error is checked rather than caught; the try/catch is only for a transport
  // failure. Either way this is best-effort: a missing function (pre-migration)
  // costs a future warning, never the purchase.
  try {
    const { error } = await supabase.rpc('reset_sms_balance_alerts', { p_event_id: eventId });
    if (error) logger.warn({ err: error, eventId }, '[fulfill] could not re-arm SMS balance warnings');
  } catch (e) {
    logger.warn({ err: e, eventId }, '[fulfill] re-arming SMS balance warnings threw');
  }

  try {
    const { error } = await supabase
      .from('events')
      .update({ sms_addon_purchased_at: new Date().toISOString() })
      .eq('id', eventId)
      .is('sms_addon_purchased_at', null);
    if (error) {
      // Loud: the money is taken and the wallet credited, but the event cannot
      // send. That is a support ticket waiting to happen, so it must be findable.
      logger.error({ err: error, eventId },
        '[fulfill] SMS add-on paid and credited but the unlock flag FAILED to set — the event cannot send until this is repaired.');
    }
  } catch (e) {
    logger.error({ err: e, eventId }, '[fulfill] SMS add-on unlock threw');
  }
}

/**
 * Credit the SMS add-on that was bought as a second line item on an event-fee
 * session, then unlock it.
 *
 * Deliberately best-effort and non-throwing: the licence payment has already been
 * committed by the time this runs, and throwing here would make Stripe retry the
 * whole webhook — re-running an event activation that already succeeded — to fix a
 * wallet credit that `record_sms_purchase` can safely apply on its own schedule.
 * A failure is logged loudly instead, leaving a paid-but-uncredited state that is
 * visible and repairable rather than a retry storm.
 */
async function fulfillSmsAddon(session, eventId) {
  const raw = session?.metadata?.sms_addon_segments;
  if (!raw) return;

  const segments = parseInt(raw, 10);
  if (!Number.isInteger(segments) || segments <= 0) {
    logger.warn({ eventId, raw }, '[fulfill] ignoring malformed sms_addon_segments');
    return;
  }

  try {
    const amountCents = parseInt(session.metadata.sms_addon_amount_cents, 10);
    const { data, error } = await supabase.rpc('record_sms_purchase', {
      p_event_id: eventId,
      p_credits: segments,
      // Shares the licence's payment intent, which is exactly what makes this
      // idempotent: the ledger's partial unique index on
      // (stripe_payment_intent_id) WHERE transaction_type = 'purchase' rejects a
      // second credit for the same payment.
      p_payment_intent: session.payment_intent,
      p_amount_cents: Number.isInteger(amountCents) ? amountCents : null,
    });
    if (error) throw error;
    if (data && data.success === false) throw new Error(data.error || 'RECORD_SMS_PURCHASE_FAILED');

    await unlockSmsAddon(eventId);

    if (!data?.already_processed) {
      try {
        await supabase.from('activity_logs').insert({
          event_id: eventId,
          action: 'sms_addon_purchased',
          entity_type: 'sms_wallet',
          metadata: { credit_count: segments, amount_cents: Number.isInteger(amountCents) ? amountCents : null, bought_with: 'event_fee' },
        });
      } catch { /* best-effort breadcrumb */ }
    }
  } catch (e) {
    logger.error({ err: e, eventId, segments },
      '[fulfill] SMS add-on was PAID FOR but could not be credited — needs manual reconciliation.');
  }
}

/**
 * Reverts a payment when Stripe reports a refund (charge.refunded). Idempotent:
 * an already-refunded payment / already-recorded SMS refund is left untouched.
 */
const handleChargeRefunded = async (charge) => {
  const paymentIntentId = charge.payment_intent;
  if (!paymentIntentId) return { ok: true, skipped: 'missing_payment_intent' };

  // 1. Event fee refund → revert activation.
  const { data: payment } = await supabase
    .from('event_payments')
    .select('id, event_id, status, amount_cents, referral_credit_applied_cents')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();

  if (payment) {
    // Already fully refunded → no-op (idempotent with the admin refund path).
    if (payment.status === 'refunded') return { ok: true, alreadyProcessed: true };

    // Stripe reports the CUMULATIVE refunded amount on the charge. Record it so
    // the books match whether the refund originated here (Stripe dashboard) or
    // via the admin endpoint — and so the daily-revenue rollup is accurate. Only
    // a FULL refund reverts the event to unpaid/paused; partials leave it live.
    const fullAmount = payment.amount_cents || 0;
    const refundedCumulative = Number.isInteger(charge.amount_refunded) ? charge.amount_refunded : fullAmount;
    const isFullRefund = fullAmount === 0 || charge.refunded === true || refundedCumulative >= fullAmount;

    const update = {
      refund_amount_cents: refundedCumulative,
      refunded_at: new Date().toISOString(),
    };
    if (isFullRefund) update.status = 'refunded';

    const { error: updErr } = await supabase
      .from('event_payments')
      .update(update)
      .eq('id', payment.id);
    if (updErr) throw updErr;

    if (isFullRefund) {
      const { error: evtErr } = await supabase
        .from('events')
        .update({ is_paid: false, status: 'paused', updated_at: new Date().toISOString() })
        .eq('id', payment.event_id);
      if (evtErr) throw evtErr;

      // Restore consumed referral credit + claw back the earned reward. Idempotent
      // with the admin-refund path (stripeRefundService) — whichever fires first
      // wins, the other no-ops via the unique reversal indexes.
      await reverseReferralForRefundedPayment(payment);
    }

    return { ok: true, type: 'event_fee', eventId: payment.event_id, fullRefund: isFullRefund };
  }

  // 2. SMS credit refund → deduct via ledger.
  const { data: ledgerEntry } = await supabase
    .from('sms_credit_ledger')
    .select('id, wallet_id, event_id, credits')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .eq('transaction_type', 'purchase')
    .maybeSingle();

  if (!ledgerEntry) return { ok: true, skipped: 'no_matching_payment' };

  const refundCredits = Math.abs(ledgerEntry.credits);

  const { data: existingRefund } = await supabase
    .from('sms_credit_ledger')
    .select('id')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .eq('transaction_type', 'refund')
    .limit(1);
  if (existingRefund && existingRefund.length > 0) return { ok: true, alreadyProcessed: true };

  const { data: wallet, error: wErr } = await supabase
    .from('sms_credit_wallets')
    .select('id, credits_purchased')
    .eq('id', ledgerEntry.wallet_id)
    .single();
  if (wErr) throw wErr;

  const { error: updWErr } = await supabase
    .from('sms_credit_wallets')
    .update({
      credits_purchased: Math.max(0, (wallet.credits_purchased || 0) - refundCredits),
      updated_at: new Date().toISOString(),
    })
    .eq('id', wallet.id);
  if (updWErr) throw updWErr;

  const { error: ledErr } = await supabase
    .from('sms_credit_ledger')
    .insert({
      wallet_id: wallet.id,
      event_id: ledgerEntry.event_id,
      transaction_type: 'refund',
      credits: -refundCredits,
      stripe_payment_intent_id: paymentIntentId,
    });
  if (ledErr) throw ledErr;

  return { ok: true, type: 'sms_credits', eventId: ledgerEntry.event_id };
};

/**
 * Records a Stripe dispute / chargeback (charge.dispute.created and updates) into
 * payment_disputes (Master Plan §9). Idempotent on stripe_dispute_id.
 */
const handleDisputeEvent = async (dispute) => {
  if (!dispute || !dispute.id) return { ok: true, skipped: 'missing_dispute' };

  // Link to the originating payment via the charge's payment_intent when present.
  let paymentId = null;
  let eventId = null;
  let disputedPayment = null;
  const paymentIntentId = dispute.payment_intent;
  if (paymentIntentId) {
    const { data: payment } = await supabase
      .from('event_payments')
      .select('id, event_id, referral_credit_applied_cents')
      .eq('stripe_payment_intent_id', paymentIntentId)
      .maybeSingle();
    disputedPayment = payment || null;
    paymentId = payment?.id || null;
    eventId = payment?.event_id || null;
  }

  const row = {
    payment_id: paymentId,
    stripe_dispute_id: dispute.id,
    stripe_charge_id: dispute.charge || null,
    status: dispute.status || null,
    amount_cents: dispute.amount ?? null,
    currency: dispute.currency || 'usd',
    reason: dispute.reason || null,
    evidence_due_at: dispute.evidence_details?.due_by
      ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
      : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('payment_disputes')
    .upsert(row, { onConflict: 'stripe_dispute_id' });
  if (error) throw error;

  // A dispute previously only got recorded here with NO effect on the event —
  // it stayed fully live/active while money was potentially being clawed back.
  // Pause it as soon as a dispute opens (mirrors the full-refund behavior in
  // handleChargeRefunded); a 'lost' dispute additionally reverts is_paid, since
  // that's a confirmed loss of the funds, same as a refund.
  if (eventId) {
    const activeDisputeStatuses = ['warning_needs_response', 'needs_response', 'under_review', 'warning_under_review'];
    if (dispute.status === 'lost') {
      const { error: evtErr } = await supabase
        .from('events')
        .update({ is_paid: false, status: 'paused', updated_at: new Date().toISOString() })
        .eq('id', eventId);
      if (evtErr) throw evtErr;

      // A lost chargeback is a confirmed loss of the funds, same as a full
      // refund — restore consumed credit and claw back the earned reward.
      if (disputedPayment) await reverseReferralForRefundedPayment(disputedPayment);
    } else if (activeDisputeStatuses.includes(dispute.status)) {
      const { error: evtErr } = await supabase
        .from('events')
        .update({ status: 'paused', updated_at: new Date().toISOString() })
        .eq('id', eventId);
      if (evtErr) throw evtErr;
    }
    // 'won' / 'warning_closed': leave the event as-is — no automatic resume,
    // since an admin should confirm before un-pausing (mirrors manual review
    // elsewhere in this codebase rather than auto-reactivating).
  }

  return { ok: true, disputeId: dispute.id, paymentId, eventId };
};

module.exports = { fulfillCheckoutSession, handleChargeRefunded, handleDisputeEvent };
