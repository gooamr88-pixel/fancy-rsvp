'use client';

import React, { useState } from 'react';
import Icon from '../../../components/icons/Icon';
import TrialCard from './TrialCard';

const C = {
  gold: '#B8944F', goldHover: '#a6833f',
  charcoal: '#191B1E', ivory: '#F8F4EC',
  stone: '#77736A', border: '#E8E2D6',
  white: '#FFFFFF', softBg: '#FAFAF8',
  error: '#C45E5E', success: '#3B9B6D',
};

const METHOD_ICON = { bank: 'bank', wallet: 'mobile', instapay: 'lightning', cash: 'cash', paypal: 'wallet', other: 'creditCard' };

/* ── SMS price preview ─────────────────────────────────────────────────────
   Mirrors backend/utils/pricing.js computeSmsChargeCents so the slider can show a
   live price without a request per tick. The server recomputes it at checkout and
   ITS number is the one charged.

   The discount TIERS are passed in, never hardcoded. They used to be a literal
   500 / 12.5% pair here — which silently became a lie the moment volume discounts
   became admin-editable, quoting every customer a price the checkout would not
   honour. The algorithm is stable; only the data changes, so only the data is
   fetched. */
function previewSmsCents(listPriceCents, segments, volumeDiscounts = null) {
  if (!Number.isFinite(listPriceCents) || !Number.isFinite(segments) || segments <= 0) return null;

  // The server sends the finished list price, so there is no markup to apply
  // here — the client is never told what a segment costs us.
  let total = listPriceCents * segments;

  // Tiers arrive sorted descending, so the first match is the best one earned.
  // Never cumulative — stacking them is how a discount table reaches 100% off.
  const tiers = Array.isArray(volumeDiscounts) ? volumeDiscounts : [];
  for (const tier of tiers) {
    if (segments >= Number(tier.min_segments)) {
      total *= (1 - (Number(tier.discount_pct) || 0) / 100);
      break;
    }
  }
  return Math.max(0, Math.round(total));
}

/**
 * Text messaging, offered on the plan screen and paid for in the same checkout.
 *
 * ── Why this reads the way it does ──
 *
 * The person on this screen is planning a wedding. They have never heard of a
 * segment, they do not know how many texts an event needs, and asking them to
 * pick a number is asking a question they have no way to answer. The previous
 * version led with a slider and explained encodings; this one leads with the
 * answer and keeps the slider as an afterthought.
 *
 * Four rules hold throughout:
 *
 *  • THE SYSTEM DECIDES FIRST. A recommended number and its price are stated
 *    plainly. Adjusting is available but secondary — most people should be able
 *    to tick the box, glance at the price, and move on.
 *  • NO JARGON. Not "segments", "credits", "allowance", "UCS-2" or "add-on".
 *    Just messages, guests, and money.
 *  • OFF BY DEFAULT. It is an extra charge; pre-ticking it takes money from
 *    someone who never decided to spend it.
 *  • WARN, NEVER BLOCK. Choosing less than we suggest produces a sentence, not a
 *    locked button. An organizer may know only forty of their guests use SMS.
 */
function SmsAddonCard({
  enabled, onToggle, segments, onChangeSegments,
  estimate, listPriceCents, volumeDiscounts, fmt,
}) {
  const [showAdjust, setShowAdjust] = useState(false);

  const bounds = estimate?.bounds || { min: 50, max: 50000, step: 50 };
  const recommended = estimate?.recommendedSegments || null;
  const value = Number.isFinite(segments) ? segments : (recommended || bounds.min);
  const priceCents = previewSmsCents(listPriceCents, value, volumeDiscounts);

  const invitations = estimate?.estimatedParties || 0;
  const shortOfSuggestion = recommended != null && value < recommended;

  // What the money buys, in the customer's words. Built from the same per-type
  // figures the recommendation is calculated from, so the list and the number
  // cannot disagree.
  const included = (estimate?.breakdown || [])
    .filter((b) => b.audience === 'guest' && b.enabled && b.messages > 0)
    .map((b) => b.label.toLowerCase());

  const step = bounds.step || 50;
  const nudge = (delta) => {
    const next = Math.min(bounds.max, Math.max(bounds.min, value + delta));
    onChangeSegments && onChangeSegments(next);
  };

  return (
    <div style={{
      border: `1px solid ${enabled ? C.gold : C.border}`,
      background: enabled ? 'rgba(184,148,79,0.05)' : C.softBg,
      borderRadius: 12, padding: '18px 20px', marginTop: 18, transition: 'all 0.2s',
    }}>
      <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle && onToggle(e.target.checked)}
          style={{ marginTop: 3, width: 17, height: 17, accentColor: C.gold, flexShrink: 0, cursor: 'pointer' }}
        />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontFamily: 'var(--font-serif)', fontSize: 17, fontWeight: 700, color: C.charcoal }}>
            Send text messages to your guests
          </span>
          <span style={{ display: 'block', fontSize: 13, color: C.stone, lineHeight: 1.65, marginTop: 5, fontFamily: 'var(--font-sans)' }}>
            Most people read a text within minutes and an email much later — if at all.
            Reach your guests on their phones with invitations, reminders and their
            entry pass. Works with any plan.
          </span>
        </span>
      </label>

      {enabled && (
        <div style={{ marginTop: 18, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>

          {/* THE ANSWER, stated before anything is asked.
              Two sentences, because an unlimited plan has no cap to quote — the
              earlier single-sentence version fell back to the word "your" and
              rendered "Your plan covers up to your guests." */}
          {estimate && (
            <p style={{ fontSize: 13, color: C.stone, lineHeight: 1.65, margin: '0 0 14px', fontFamily: 'var(--font-sans)' }}>
              {estimate.maxGuests ? (
                <>
                  Your plan covers up to <strong style={{ color: C.charcoal }}>{estimate.maxGuests} guests</strong>.
                  {' '}Since one text goes to each invitation rather than each person, that is about{' '}
                  <strong style={{ color: C.charcoal }}>{invitations} people</strong> to reach.
                </>
              ) : (
                <>
                  Your plan has no guest limit, so we have started you off at about{' '}
                  <strong style={{ color: C.charcoal }}>{invitations} people</strong> — one text goes to each
                  invitation rather than each person. Change the amount below if you expect more.
                </>
              )}
            </p>
          )}

          <div style={{
            background: C.white, border: `1px solid ${C.border}`, borderRadius: 10,
            padding: '16px 18px', display: 'flex', flexWrap: 'wrap',
            alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}>
            <div>
              <div style={{ fontSize: 11.5, color: C.stone, fontFamily: 'var(--font-sans)', marginBottom: 2 }}>
                {shortOfSuggestion ? 'You chose' : 'We suggest'}
              </div>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 26, fontWeight: 700, color: C.charcoal, lineHeight: 1.1 }}>
                {value.toLocaleString()}
                <span style={{ fontSize: 14, fontWeight: 400, color: C.stone, marginLeft: 6 }}>messages</span>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11.5, color: C.stone, fontFamily: 'var(--font-sans)', marginBottom: 2 }}>Added to your total</div>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 26, fontWeight: 700, color: C.gold, lineHeight: 1.1 }}>
                {priceCents == null ? '—' : fmt(priceCents)}
              </div>
            </div>
          </div>

          {included.length > 0 && (
            <p style={{ fontSize: 12, color: C.stone, lineHeight: 1.65, margin: '12px 0 0', fontFamily: 'var(--font-sans)' }}>
              <strong style={{ color: C.charcoal }}>Covers:</strong> {included.join(' · ')}
            </p>
          )}

          {/* The ladder, said out loud.
              The single most reassuring fact about this purchase is that the
              budget is per INVITATION and gets smaller as the event grows — and
              it is invisible in a total. An organizer who can see "about 3
              messages each" can check the arithmetic against their own guest
              list, which is the difference between a price and a quote. */}
          {estimate?.messagesPerParty && (
            <p style={{ fontSize: 12, color: C.stone, lineHeight: 1.65, margin: '7px 0 0', fontFamily: 'var(--font-sans)' }}>
              <strong style={{ color: C.charcoal }}>That is about {estimate.messagesPerParty} messages per invitation</strong>
              {' '}over the life of your event. Bigger events need fewer each, and pay less per message.
            </p>
          )}

          <p style={{ fontSize: 12, margin: '10px 0 0', fontFamily: 'var(--font-sans)' }}>
            <a
              href="/dashboard/sms-plans"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: C.gold, fontWeight: 700, textDecoration: 'underline' }}
            >
              See exactly what your guests receive, and how this is priced
            </a>
          </p>

          {/* Adjusting is deliberately quiet — a link, not a control competing
              with the number above it. */}
          {!showAdjust ? (
            <button
              type="button"
              onClick={() => setShowAdjust(true)}
              style={{
                marginTop: 14, background: 'transparent', border: 'none', padding: 0,
                color: C.gold, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                textDecoration: 'underline', fontFamily: 'var(--font-sans)',
              }}
            >
              Change this amount
            </button>
          ) : (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => nudge(-step)} aria-label="Fewer messages"
                  style={{ width: 38, height: 38, borderRadius: 8, border: `1px solid ${C.border}`, background: C.white, color: C.charcoal, fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>−</button>
                <input
                  type="range"
                  min={bounds.min}
                  max={Math.max(bounds.min, Math.min(bounds.max, (recommended || bounds.min) * 3))}
                  step={step}
                  value={value}
                  onChange={(e) => onChangeSegments && onChangeSegments(Number(e.target.value))}
                  style={{ flex: '1 1 140px', accentColor: C.gold, cursor: 'pointer' }}
                />
                <button type="button" onClick={() => nudge(step)} aria-label="More messages"
                  style={{ width: 38, height: 38, borderRadius: 8, border: `1px solid ${C.border}`, background: C.white, color: C.charcoal, fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>+</button>
              </div>
              {recommended != null && value !== recommended && (
                <button
                  type="button"
                  onClick={() => onChangeSegments && onChangeSegments(recommended)}
                  style={{ marginTop: 10, background: 'transparent', border: 'none', padding: 0, color: C.gold, fontSize: 12, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'var(--font-sans)' }}
                >
                  Back to our suggestion ({recommended.toLocaleString()})
                </button>
              )}
            </div>
          )}

          {/* Warning, never a block (requirement 10). */}
          {shortOfSuggestion && (
            <p style={{
              fontSize: 12.5, color: '#8A6D34', lineHeight: 1.65, margin: '14px 0 0',
              background: 'rgba(184,148,79,0.10)', border: `1px solid ${C.border}`,
              borderRadius: 8, padding: '10px 12px', fontFamily: 'var(--font-sans)',
            }}>
              This may not be enough for {invitations} people. You can still choose it — if you
              run out, your guests simply keep getting everything by email, and you can add
              more messages at any time.
            </p>
          )}

          <p style={{ fontSize: 11.5, color: C.stone, fontFamily: 'var(--font-sans)', margin: '12px 0 0', lineHeight: 1.65 }}>
            Guests only receive texts if they agree to them. Messages written in Arabic use
            about twice as many. You can turn any kind of message on or off later.
          </p>
        </div>
      )}
    </div>
  );
}

/* Collapsed "Have a promo code?" link that expands into a redeem box. A
   valid code publishes the event immediately — free, no Stripe/manual
   payment, no admin review wait — via the onRedeem callback the wizard
   provides (mirrors onPayStripe/onPayManual: this component never talks to
   the API directly, the wizard owns that and updates isPaid/currentTierName
   on success the same way a real payment would). */
function PromoCodeBox({ onRedeem, processing }) {
  const [expanded, setExpanded] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { type: 'error'|'success', text }
  const [focused, setFocused] = useState(false);

  const submit = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const result = await onRedeem(code.trim());
      setMsg({ type: result?.ok ? 'success' : 'error', text: result?.message || (result?.ok ? 'Your event is now live!' : 'That code could not be redeemed.') });
    } finally {
      setBusy(false);
    }
  };

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="promo-trigger"
        style={{
          background: C.white, border: `1.5px dashed ${C.gold}`, borderRadius: 999,
          color: C.gold, fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700,
          cursor: 'pointer', marginBottom: 20, display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '9px 16px 9px 9px', minHeight: 'var(--fx-touch)', transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(184, 148, 79, 0.12)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name="ticket" size={13} strokeWidth={1.8} />
        </span>
        Have a promo code?
        <style jsx>{`
          .promo-trigger:hover { background: rgba(184, 148, 79, 0.06); box-shadow: 0 4px 14px rgba(184, 148, 79, 0.16); transform: translateY(-1px); }
        `}</style>
      </button>
    );
  }

  return (
    <div
      style={{
        background: 'linear-gradient(160deg, #FFFEFC 0%, #FBF6EA 100%)',
        border: `1.5px dashed ${C.gold}`, borderRadius: 16, padding: 20, marginBottom: 24,
        boxShadow: '0 2px 16px rgba(184, 148, 79, 0.08)',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(184, 148, 79, 0.12)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name="ticket" size={17} color={C.gold} strokeWidth={1.6} />
        </span>
        <div>
          <h4 style={{ fontFamily: 'var(--font-serif)', fontSize: 15, fontWeight: 600, color: C.charcoal, margin: 0 }}>Redeem a Promo Code</h4>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: C.stone, margin: '2px 0 0', lineHeight: 1.5 }}>
            Publishes your event immediately — free, no payment, no review wait.
          </p>
        </div>
      </div>
      <div className="promo-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
        <input
          value={code}
          onChange={(e) => { setCode(e.target.value.toUpperCase()); setMsg(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="e.g. FANCY2026"
          disabled={busy || processing}
          style={{
            flex: '1 1 180px', height: 46, padding: '0 16px',
            border: `1.5px solid ${focused ? C.gold : C.border}`, borderRadius: 10,
            fontFamily: 'monospace', fontSize: 14, fontWeight: 700, letterSpacing: '0.06em', color: C.charcoal,
            outline: 'none', boxSizing: 'border-box', background: C.white,
            boxShadow: focused ? '0 0 0 3px rgba(184, 148, 79, 0.15)' : 'none',
            transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || processing || !code.trim()}
          className="promo-submit"
          style={{
            height: 46, padding: '0 24px', borderRadius: 10, border: 'none',
            background: (busy || processing || !code.trim()) ? '#C9C4BA' : 'linear-gradient(135deg, #C5A86B, #A6833F)',
            color: C.white, fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700,
            cursor: (busy || processing || !code.trim()) ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap',
            transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {busy ? 'Redeeming…' : 'Redeem'}
        </button>
      </div>
      {msg && (
        <div
          style={{
            marginTop: 12, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 8, padding: '10px 12px',
            borderRadius: 10, background: msg.type === 'success' ? 'rgba(59, 155, 109, 0.08)' : 'rgba(196, 94, 94, 0.08)',
            border: `1px solid ${msg.type === 'success' ? 'rgba(59, 155, 109, 0.25)' : 'rgba(196, 94, 94, 0.25)'}`,
          }}
        >
          <span style={{ flexShrink: 0, marginTop: 1 }}>
            <Icon name={msg.type === 'success' ? 'check' : 'warning'} size={15} color={msg.type === 'success' ? C.success : C.error} strokeWidth={1.8} />
          </span>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 600, color: msg.type === 'success' ? C.success : C.error, margin: 0, lineHeight: 1.5 }}>
            {msg.text}
          </p>
        </div>
      )}
      <style jsx>{`
        .promo-submit:not(:disabled):hover { filter: brightness(1.06); box-shadow: 0 6px 18px rgba(184, 148, 79, 0.3); transform: translateY(-1px); }
        @media (max-width: 639.98px) {
          .promo-row { flex-direction: column; }
          .promo-row button { width: 100%; }
        }
      `}</style>
    </div>
  );
}

function CopyBtn({ value }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button type="button"
      onClick={() => { navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
      style={{ border: `1px solid ${C.border}`, background: C.white, borderRadius: 8, padding: '4px 10px', minHeight: 'var(--fx-touch)', fontSize: 11, fontWeight: 700, color: copied ? C.success : C.gold, cursor: 'pointer', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' }}>
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

/**
 * Step 2 — Platform Fee Payment (now comes right after picking a template,
 * before the event-details form — pay upfront, then access creation).
 *   • Pay by card  → redirect to Stripe Checkout
 *   • Manual/Cash  → choose one of the Super-Admin-configured methods, transfer
 *     to those details, submit the proof reference, get a reference code; a Super
 *     Admin then verifies the money arrived and activates the event.
 */
export default function StagePayment({
  tiers, manualMethods = [], selectedTierName, onSelectTier,
  onPayStripe, onPayManual, manualRef,
  processing, error, onContinue, onBack, onSkip,
  paymentConfirmed = false, paymentNotice = '', verifying = false, onRecheckPayment,
  isPaid = false, currentTierName = '', currentTierMaxGuests = null,
  stripeEnabled = true, referralCreditCents = 0, onRedeemPromoCode,
  onStartTrial, trialDays = 7, trialMaxGuests = 25,
  // ── SMS add-on ──
  smsAddonEnabled = false, onToggleSmsAddon,
  smsAddonSegments = null, onChangeSmsAddonSegments,
  smsEstimate = null, smsVolumeDiscounts = null,
  featureLabels = {}, hiddenTierFeatures = [], featureNotes = {},
  smsListPriceCents = null,
}) {
  const fmt = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;
  // What the SMS choice adds to whatever the plan costs. Zero when it is off, so
  // both the card button and the transfer amount can add it unconditionally.
  const smsAddonCents = (smsAddonEnabled && Number.isFinite(smsAddonSegments))
    ? (previewSmsCents(smsListPriceCents, smsAddonSegments, smsVolumeDiscounts) || 0)
    : 0;

  // Tier bullets: hide keys that no longer grant anything, and never print a raw
  // key to a customer.
  const visibleFeatures = (list) =>
    (list || []).filter((f) => f && !hiddenTierFeatures.includes(f));
  // When card payments are off (pre-live), the manual-transfer panel IS the flow —
  // open it straight away and don't offer a card path. All card UI stays in the
  // code, gated behind stripeEnabled, ready to switch back on with live keys.
  const [showManual, setShowManual] = useState(!stripeEnabled);
  const [chosenMethod, setChosenMethod] = useState('');
  const [payerRef, setPayerRef] = useState('');
  // When already paid, the plans stay locked on the current plan until the user
  // explicitly chooses to upgrade.
  const [upgrading, setUpgrading] = useState(false);
  // Capture the plan name at the time of manual payment submission so it doesn't
  // change when the user clicks other tiers during upgrade.
  const [paidPlanName, setPaidPlanName] = useState(selectedTierName);

  const activeMethods = (manualMethods || []).filter(m => m && m.is_active !== false);
  // "Contact Sales" tiers have no fixed price, so they can't be paid online here.
  const billableTiers = (tiers || []).filter(t => t && t.is_custom !== true);
  // The plan the organizer is about to pay for (shown in the manual-transfer panel
  // so card and manual flows both make the chosen plan + price explicit).
  const selectedTier = (tiers || []).find(t => t.name === selectedTierName) || null;

  // Resolve the current plan from the live tier list (falls back to the snapshot
  // saved on the event if the tier was later renamed/removed by an admin).
  const currentTier = (tiers || []).find(t => t.name === currentTierName) || null;
  const currentPrice = currentTier ? currentTier.price_cents : null;

  // The pending/current plan name for upgrade comparison.
  // Use the captured paidPlanName (frozen at payment time) instead of the live selectedTierName.
  const lockedPlanName = isPaid ? currentTierName : (manualRef ? paidPlanName : null);
  const lockedTier = lockedPlanName ? (tiers || []).find(t => t.name === lockedPlanName) : null;
  const lockedPrice = lockedTier ? lockedTier.price_cents : null;

  // The effective price for upgrade filtering: use whichever is set (paid or pending).
  const effectivePrice = currentPrice ?? lockedPrice;
  // Only strictly more expensive tiers count as an upgrade.
  const upgradeTiers = effectivePrice == null
    ? billableTiers
    : billableTiers.filter(t => t.price_cents > effectivePrice);

  // PRICING-1: an upgrade charges only the DIFFERENCE from the already-paid/pending
  // plan — never the new tier's full price again. `currentPrice` is what's already
  // on file (it only flips to the new tier once the upgrade is actually approved/
  // fulfilled), so it's the correct base for the credit even while a pending
  // upgrade payment exists. The backend (createCheckoutSession / initiateManualPayment)
  // computes this exact same way and is the source of truth for what's charged —
  // this is purely a transparent preview so the organizer sees it before paying.
  const upgradeAdjustedCents = (tierPriceCents) => (currentPrice != null && tierPriceCents > currentPrice) ? tierPriceCents - currentPrice : tierPriceCents;
  // REFERRAL-1: same read-only preview principle as the upgrade credit above —
  // the backend (createCheckoutSession / initiateManualPayment) is the actual
  // source of truth for the redeemed amount; this only mirrors it visually.
  const referralDeductionFor = (tierPriceCents) => referralCreditCents > 0 ? Math.min(referralCreditCents, Math.max(0, upgradeAdjustedCents(tierPriceCents))) : 0;
  const dueNowCents = (tierPriceCents) => Math.max(0, upgradeAdjustedCents(tierPriceCents) - referralDeductionFor(tierPriceCents));
  const isProratedTier = (tierPriceCents) => currentPrice != null && tierPriceCents > currentPrice;
  // Tiers shown in the selectable grid depend on the mode.
  // When upgrading, show ALL plans but mark the current one as locked.
  const selectableTiers = billableTiers;
  // The locked "Current Plan" view: paid and not actively upgrading.
  const showCurrentPlan = isPaid && !!currentTierName && !upgrading;
  // When manualRef exists, the payment was submitted but awaiting verification.
  // Hide the plan cards and show a "Pending Plan" banner instead.
  const showPendingPlan = !!manualRef && !isPaid && !upgrading;
  const currentMaxGuests = currentTier ? currentTier.max_guests : currentTierMaxGuests;
  const currentFeatures = Array.isArray(currentTier?.features) ? currentTier.features.filter(Boolean) : [];

  const submitManual = () => {
    const label = chosenMethod || (activeMethods[0]?.label || 'Manual Transfer');
    setPaidPlanName(selectedTierName); // Freeze the plan name at submission time
    onPayManual(label, payerRef.trim());
  };

  const startUpgrade = () => {
    setUpgrading(true);
    setShowManual(!stripeEnabled); // Reset to initial payment state
    // Don't pre-select any upgrade tier — let the user choose
  };
  const cancelUpgrade = () => {
    setUpgrading(false);
    setShowManual(false);
  };

  return (
    <div className="sp-page fx-container fx-container--xl fx-gutter fx-gutter--sm" style={{ paddingTop: '40px', paddingBottom: '140px' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'rgba(184,148,79,0.08)', border: '1px solid rgba(184,148,79,0.15)',
          borderRadius: 20, padding: '5px 14px', marginBottom: 12,
        }}>
          <span style={{ fontSize: 11, color: C.gold, fontWeight: 600, fontFamily: 'var(--font-sans)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {showCurrentPlan ? 'Step 2 — Your Plan' : showPendingPlan ? 'Step 2 — Pending' : upgrading ? 'Step 2 — Upgrade Plan' : 'Step 2 — Platform Fee'}
          </span>
        </div>
        <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 28, fontWeight: 600, color: C.charcoal, margin: 0 }}>
          {showCurrentPlan ? 'Your Event is Active' : showPendingPlan ? 'Payment Pending' : upgrading ? 'Upgrade Your Plan' : 'Activate Your Event'}
        </h2>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: C.stone, margin: '8px 0 0' }}>
          {showCurrentPlan
            ? 'Your platform fee is paid and your event is live. Here is your current plan.'
            : showPendingPlan
              ? 'Your payment is pending approval. You can continue setting up your event.'
              : upgrading
                ? 'Choose a higher tier below. Upgrading is a one-time charge for the new license.'
                : 'Choose a license tier and complete the one-time platform fee. Your event stays a private draft until paid.'}
        </p>
      </div>

      {/* Post-Stripe return: verifying / success / notice banner */}
      {verifying && (
        <div style={{
          background: 'rgba(184,148,79,0.06)', border: '1px solid rgba(184,148,79,0.25)',
          borderRadius: 12, padding: '14px 18px', marginBottom: 20,
          fontFamily: 'var(--font-sans)', fontSize: 14, color: C.charcoal, fontWeight: 600,
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
        }}>
          <Icon name="hourglass" size={15} strokeWidth={1.6} /> Confirming your payment…
        </div>
      )}

      {!verifying && paymentConfirmed && (
        <div style={{
          background: 'rgba(59,155,109,0.07)', border: '1px solid rgba(59,155,109,0.3)',
          borderRadius: 12, padding: '18px 20px', marginBottom: 20,
        }}>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 15, color: C.success, margin: '0 0 4px', fontWeight: 800 }}>
            ✓ Payment received
          </p>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: C.stone, margin: 0, lineHeight: 1.6 }}>
            {paymentNotice || 'Your event is now under review. It goes live to guests once approved; you can keep setting it up in the meantime.'}
          </p>
        </div>
      )}

      {!verifying && !paymentConfirmed && paymentNotice && (
        <div style={{
          background: 'rgba(184,148,79,0.06)', border: '1px solid rgba(184,148,79,0.25)',
          borderRadius: 12, padding: '14px 18px', marginBottom: 20,
          fontFamily: 'var(--font-sans)', fontSize: 13, color: C.charcoal, fontWeight: 600, lineHeight: 1.6,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
        }}>
          <span>{paymentNotice}</span>
          {/* Previously the only way to re-check was leaving and re-entering this
              step (which itself only re-fetched on [step, eventId] — see the
              wizard's tier-load effect). If the webhook is delayed, offer an
              explicit re-check without navigating away. */}
          {onRecheckPayment && (
            <button type="button" onClick={onRecheckPayment} style={{
              border: `1px solid ${C.gold}`, background: C.white, color: C.gold, borderRadius: 8,
              padding: '6px 14px', minHeight: 'var(--fx-touch)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-sans)',
              whiteSpace: 'nowrap',
            }}>
              Check again
            </button>
          )}
        </div>
      )}

      {/* Current Plan (locked) — shown after successful payment */}
      {showCurrentPlan && (
        <div style={{
          background: 'linear-gradient(135deg, #FFFDF7 0%, #FFFFFF 100%)',
          border: `2px solid ${C.gold}`, borderRadius: 18, padding: 26, marginBottom: 24,
          boxShadow: '0 8px 30px rgba(184,148,79,0.12)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fx-micro)', fontWeight: 700, color: C.gold, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Current Plan</span>
              <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 700, color: C.charcoal, margin: '4px 0 0' }}>{currentTierName}</h3>
            </div>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 100,
              background: 'rgba(59,155,109,0.10)', border: '1px solid rgba(59,155,109,0.25)',
              fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 700, color: C.success, textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.success }} /> Active
            </span>
          </div>
          {currentTier && (
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 700, color: C.gold, margin: '14px 0 2px' }}>{fmt(currentTier.price_cents)}</div>
          )}
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: C.stone, margin: '4px 0 0' }}>
            {currentMaxGuests > 0 ? `Up to ${currentMaxGuests} guests` : 'Unlimited guests'}
          </p>
          {/* Same key -> label mapping as the tier cards: the current-plan panel
              was printing raw registry keys too. */}
          {visibleFeatures(currentFeatures).length > 0 && (
            <ul style={{ listStyle: 'none', margin: '16px 0 0', padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
              {visibleFeatures(currentFeatures).map((f, i) => (
                <li key={i} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 8, fontFamily: 'var(--font-sans)', fontSize: 13, color: C.charcoal }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.gold} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}><path d="M5 13l4 4L19 7" /></svg>
                  <span>{featureLabels[f] || f}</span>
                </li>
              ))}
            </ul>
          )}
          <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
            {upgradeTiers.length > 0 ? (
              <button onClick={startUpgrade} disabled={processing} style={{
                height: 48, padding: '0 26px', borderRadius: 12, border: 'none',
                background: 'linear-gradient(135deg, #B8944F, #a6833f)', color: C.white,
                fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 700,
                cursor: processing ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
                boxShadow: '0 4px 16px rgba(184,148,79,0.28)',
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                Upgrade Plan
              </button>
            ) : (
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: C.stone, margin: 0 }}>
                ✓ You&apos;re on the highest available plan.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Pending Plan banner — shown after manual payment submission, before admin verification */}
      {showPendingPlan && lockedTier && (
        <div style={{
          background: 'linear-gradient(135deg, #FFFDF7 0%, #FFFFFF 100%)',
          border: `2px solid ${C.gold}`, borderRadius: 18, padding: 26, marginBottom: 24,
          boxShadow: '0 8px 30px rgba(184,148,79,0.12)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fx-micro)', fontWeight: 700, color: C.gold, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Selected Plan</span>
              <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 700, color: C.charcoal, margin: '4px 0 0' }}>{lockedTier.name}</h3>
            </div>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 100,
              background: 'rgba(184,148,79,0.10)', border: '1px solid rgba(184,148,79,0.25)',
              fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 700, color: C.gold, textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.gold, animation: 'sp-pulse 2s ease-in-out infinite' }} /> Pending Payment
            </span>
          </div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 700, color: C.gold, margin: '14px 0 2px' }}>
            {fmt(dueNowCents(lockedTier.price_cents))}
            {isProratedTier(lockedTier.price_cents) && (
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 600, color: C.stone, marginLeft: 8 }}>
                due now &middot; full plan price {fmt(lockedTier.price_cents)}, credited {fmt(currentPrice)} for your current plan
              </span>
            )}
          </div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: C.stone, margin: '4px 0 0' }}>
            {lockedTier.max_guests > 0 ? `Up to ${lockedTier.max_guests} guests` : 'Unlimited guests'}
          </p>
          {upgradeTiers.length > 0 && (
            <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
              <button onClick={startUpgrade} disabled={processing} style={{
                height: 48, padding: '0 26px', borderRadius: 12, border: 'none',
                background: 'linear-gradient(135deg, #B8944F, #a6833f)', color: C.white,
                fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 700,
                cursor: processing ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
                boxShadow: '0 4px 16px rgba(184,148,79,0.28)',
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                Upgrade Plan
              </button>
            </div>
          )}
          <style>{`@keyframes sp-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
        </div>
      )}

      {/* Referral credit banner — the discount itself is applied server-side; this
          is purely a heads-up so the price below doesn't come as a surprise. */}
      {referralCreditCents > 0 && !showCurrentPlan && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 10, marginBottom: 20,
          background: 'rgba(59,155,109,0.06)', border: '1px solid rgba(59,155,109,0.25)',
          borderRadius: 12, padding: '12px 16px',
        }}>
          <span style={{ fontSize: 16, flexShrink: 0, lineHeight: '20px' }}>🎁</span>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: C.charcoal, fontWeight: 600, minWidth: 0, lineHeight: 1.5 }}>
            You have {fmt(referralCreditCents)} in referral credit — it will be applied automatically to your payment below.
          </span>
        </div>
      )}

      {/* The free trial — offered FIRST, and on the same terms as the promo
          box below: only on a fresh, unpaid event, never mid-upgrade. An
          already-live event moving up a tier is a real paid change, and a
          trial there would be a downgrade dressed as an offer.

          `onStartTrial` is absent when the platform has no trial plan
          configured, or no free plan for one to land on — the server refuses
          in both cases (services/trialService.js), so the card must not be
          shown promising something that would be refused on the click. */}
      {!showCurrentPlan && !showPendingPlan && !upgrading && onStartTrial && (
        <TrialCard
          onStartTrial={onStartTrial}
          processing={processing}
          days={trialDays}
          maxGuests={trialMaxGuests}
        />
      )}

      {/* Promo code — self-service alternative to paying at all. Only offered
          on a fresh/unpaid event, not mid-upgrade (an already-active event
          upgrading tiers is a real paid change, not something a free-publish
          code is meant to cover). */}
      {!showCurrentPlan && !showPendingPlan && !upgrading && onRedeemPromoCode && (
        <PromoCodeBox onRedeem={onRedeemPromoCode} processing={processing} />
      )}

      {/* Tier cards (selection / upgrade) */}
      {!showCurrentPlan && !showPendingPlan && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 28 }}>
        {selectableTiers.length === 0 ? (
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: C.stone, fontStyle: 'italic' }}>
            {upgrading ? 'You are already on the highest available plan.' : 'No pricing tiers are configured yet. You can skip and pay later from the dashboard.'}
          </p>
        ) : selectableTiers.map((tier) => {
          const isLocked = upgrading && lockedPlanName && tier.name === lockedPlanName;
          const isBelowCurrent = upgrading && lockedPrice != null && tier.price_cents <= lockedPrice && !isLocked;
          const isDisabled = isLocked || isBelowCurrent;
          const isActive = !isDisabled && selectedTierName === tier.name;
          const features = Array.isArray(tier.features) ? tier.features.filter(Boolean) : [];
          return (
            <div key={tier.name}
              onClick={() => !processing && !isDisabled && onSelectTier(tier.name)}
              style={{
                background: isLocked ? 'linear-gradient(135deg, #FFFDF7 0%, #FBF8F0 100%)' : isBelowCurrent ? '#FAFAF8' : C.white,
                border: isLocked ? `2px solid ${C.gold}` : isActive ? `2px solid ${C.gold}` : `1.5px solid ${C.border}`,
                borderRadius: 16, padding: 22,
                cursor: isDisabled ? 'default' : processing ? 'default' : 'pointer',
                transition: 'all 0.25s cubic-bezier(0.16,1,0.3,1)',
                boxShadow: isLocked ? '0 4px 20px rgba(184,148,79,0.10)' : isActive ? '0 4px 20px rgba(184,148,79,0.12)' : '0 2px 8px rgba(0,0,0,0.04)',
                opacity: isBelowCurrent ? 0.5 : 1,
                position: 'relative',
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 17, fontWeight: 600, color: isDisabled ? C.stone : C.charcoal, margin: 0 }}>
                  {tier.name}
                  {isLocked && (
                    <span style={{ marginLeft: 8, fontFamily: 'var(--font-sans)', fontSize: 'var(--fx-micro)', fontWeight: 700, color: C.success, background: 'rgba(59,155,109,0.10)', border: '1px solid rgba(59,155,109,0.20)', padding: '2px 8px', borderRadius: 100, textTransform: 'uppercase', letterSpacing: '0.05em', verticalAlign: 'middle' }}>Current Plan</span>
                  )}
                  {tier.recommended && !isLocked && (
                    <span style={{ marginLeft: 8, fontFamily: 'var(--font-sans)', fontSize: 'var(--fx-micro)', fontWeight: 700, color: C.gold, background: 'rgba(184,148,79,0.12)', padding: '2px 8px', borderRadius: 100, textTransform: 'uppercase', letterSpacing: '0.05em', verticalAlign: 'middle' }}>Popular</span>
                  )}
                </h3>
                {isLocked ? (
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%',
                    background: C.success,
                    display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><path d="M5 13l4 4L19 7" /></svg>
                  </div>
                ) : (
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%',
                    border: isActive ? `2px solid ${C.gold}` : `2px solid ${C.border}`,
                    background: isActive ? C.gold : 'transparent',
                    display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {isActive && (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><path d="M5 13l4 4L19 7" /></svg>
                    )}
                  </div>
                )}
              </div>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 26, fontWeight: 700, color: C.gold, margin: '10px 0 4px' }}>
                {fmt(dueNowCents(tier.price_cents))}
                {!isDisabled && isProratedTier(tier.price_cents) && (
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fx-micro)', fontWeight: 700, color: C.stone, marginLeft: 6, verticalAlign: 'middle' }}>
                    due now
                  </span>
                )}
              </div>
              {!isDisabled && isProratedTier(tier.price_cents) && (
                <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: C.stone, margin: '0 0 4px', textDecoration: 'line-through', opacity: 0.7 }}>
                  Full price {fmt(tier.price_cents)}
                </p>
              )}
              {!isDisabled && referralDeductionFor(tier.price_cents) > 0 && (
                <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: C.success, margin: '0 0 4px', fontWeight: 600 }}>
                  🎁 −{fmt(referralDeductionFor(tier.price_cents))} referral credit applied
                </p>
              )}
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: C.stone, margin: 0 }}>
                {tier.max_guests > 0 ? `Up to ${tier.max_guests} guests` : 'Unlimited guests'}
              </p>
              {/* Raw registry KEYS are what pricing_tiers stores; the customer must
                  see the human label.

                  `featureNotes` is what stops a bullet over-promising. Text
                  messaging is a real plan feature again, but the plan grants the
                  RIGHT TO BUY messages, not the messages — so its bullet carries
                  "Charged separately per message" underneath. Without that line
                  the card says a plan includes texting and the organizer finds
                  out otherwise at the moment they try to send, which is the
                  worst possible moment to learn it. */}
              {visibleFeatures(features).length > 0 && (
                <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {visibleFeatures(features).map((f, i) => (
                    <li key={i} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 8, fontFamily: 'var(--font-sans)', fontSize: 12, color: C.charcoal }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.gold} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}><path d="M5 13l4 4L19 7" /></svg>
                      <span className="fx-min0">
                        {featureLabels[f] || f}
                        {/* --fx-micro, not a raw 10.5px: this file is on the
                            reading-floor tokens, and a caveat about money is the
                            last thing that should be set below the floor. */}
                        {featureNotes[f] && (
                          <span style={{ display: 'block', fontSize: 'var(--fx-micro)', color: C.stone, lineHeight: 1.45, marginTop: 1 }}>
                            {featureNotes[f]}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        </div>
      )}

      {/* Cancel upgrade — return to the locked current-plan / pending view */}
      {upgrading && (
        <button onClick={cancelUpgrade} disabled={processing} style={{
          background: 'none', border: 'none', color: C.stone, marginBottom: 20,
          fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600,
          cursor: processing ? 'not-allowed' : 'pointer', textDecoration: 'underline',
        }}>
          ← Keep my current plan ({lockedPlanName || currentTierName})
        </button>
      )}

      {/* Manual reference confirmation — hide during upgrade */}
      {manualRef && !upgrading && (
        <div style={{
          background: 'rgba(59,155,109,0.06)', border: '1px solid rgba(59,155,109,0.25)',
          borderRadius: 12, padding: '18px 20px', marginBottom: 20,
        }}>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: C.charcoal, margin: '0 0 8px', fontWeight: 700 }}>
            ✓ Payment submitted — pending payment
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: C.stone }}>Reference code:</span>
            <code style={{ background: C.ivory, padding: '4px 10px', borderRadius: 6, color: C.gold, fontWeight: 700, fontSize: 14 }}>{manualRef}</code>
            <CopyBtn value={manualRef} />
          </div>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: C.stone, margin: 0, lineHeight: 1.6 }}>
            Make sure you have sent the transfer using this reference as the note. A Super Admin will confirm the money arrived and your event will go live automatically. You can continue setting up tables now.
          </p>
        </div>
      )}

      {/* SMS add-on — offered on the same screen as the plan, and paid for with it.
          Shown on BOTH payment paths.

          It was card-only, on the reasoning that a bank transfer is verified
          against a single agreed amount with nowhere to put a second line item.
          That was wrong in the one case that matters most: while card payments are
          switched off, manual IS the only path, so the toggle was invisible to
          every customer and nobody could buy messaging at all. The amount now
          includes it and the approving admin verifies one figure — the count rides
          on the payment row so approval knows what the money bought. */}
      {((!manualRef && !paymentConfirmed && !showCurrentPlan) || (upgrading && selectedTierName && selectedTierName !== lockedPlanName)) && (
        <SmsAddonCard
          enabled={smsAddonEnabled}
          onToggle={onToggleSmsAddon}
          segments={smsAddonSegments}
          onChangeSegments={onChangeSmsAddonSegments}
          estimate={smsEstimate}
          listPriceCents={smsListPriceCents}
          volumeDiscounts={smsVolumeDiscounts}
          fmt={fmt}
        />
      )}

      {/* Payment method selection — show when: no prior ref OR actively upgrading with a higher tier selected */}
      {((!manualRef && !paymentConfirmed && !showCurrentPlan) || (upgrading && selectedTierName && selectedTierName !== lockedPlanName)) && (
        <>
          {(!showManual && stripeEnabled) ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <button
                onClick={onPayStripe}
                disabled={processing || !selectedTierName}
                style={{
                  flex: '1 1 240px', height: 54,
                  background: (processing || !selectedTierName) ? '#C9C4BA' : 'linear-gradient(135deg, #B8944F, #a6833f)',
                  color: C.white, border: 'none', borderRadius: 14,
                  fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 700,
                  cursor: (processing || !selectedTierName) ? 'not-allowed' : 'pointer',
                  boxShadow: (processing || !selectedTierName) ? 'none' : '0 4px 18px rgba(184,148,79,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                <Icon name="creditCard" size={16} strokeWidth={1.6} /> Pay with Card{selectedTier ? ` · ${fmt(dueNowCents(selectedTier.price_cents) + smsAddonCents)}` : ''}
              </button>
              <button
                onClick={() => setShowManual(true)}
                disabled={processing || !selectedTierName}
                style={{
                  flex: '1 1 240px', height: 54,
                  background: C.white, color: C.charcoal,
                  border: `1.5px solid ${C.charcoal}`, borderRadius: 14,
                  fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 700,
                  cursor: (processing || !selectedTierName) ? 'not-allowed' : 'pointer',
                  opacity: (processing || !selectedTierName) ? 0.5 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                <Icon name="bank" size={16} strokeWidth={1.6} /> Manual / Bank Transfer
              </button>
            </div>
          ) : (
            <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 16, padding: 22, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600, color: C.charcoal, margin: 0 }}>Pay by Manual Transfer</h3>
                {stripeEnabled && (
                  <button onClick={() => setShowManual(false)} style={{ background: 'none', border: 'none', color: C.stone, fontSize: 13, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'var(--font-sans)' }}>← Other methods</button>
                )}
              </div>
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: C.stone, margin: '0 0 14px', lineHeight: 1.6 }}>
                Transfer the platform fee to one of the accounts below, then submit your proof. We&apos;ll verify and activate your event.
              </p>

              {selectedTier && (
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                  background: 'rgba(184,148,79,0.06)', border: '1px solid rgba(184,148,79,0.2)',
                  borderRadius: 12, padding: '12px 16px', marginBottom: 18,
                }}>
                  <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: C.charcoal, fontWeight: 600 }}>
                    Activating <strong>{selectedTier.name}</strong>
                    {selectedTier.max_guests > 0 ? ` · up to ${selectedTier.max_guests} guests` : ' · unlimited guests'}
                    {isProratedTier(selectedTier.price_cents) && (
                      <span style={{ display: 'block', fontWeight: 400, color: C.stone, fontSize: 12, marginTop: 2 }}>
                        Full price {fmt(selectedTier.price_cents)} − {fmt(currentPrice)} already paid for your current plan
                      </span>
                    )}
                    {referralDeductionFor(selectedTier.price_cents) > 0 && (
                      <span style={{ display: 'block', fontWeight: 600, color: C.success, fontSize: 12, marginTop: 2 }}>
                        🎁 −{fmt(referralDeductionFor(selectedTier.price_cents))} referral credit applied
                      </span>
                    )}
                    {smsAddonCents > 0 && (
                      <span style={{ display: 'block', fontWeight: 600, color: C.stone, fontSize: 12, marginTop: 2 }}>
                        + {fmt(smsAddonCents)} for {smsAddonSegments.toLocaleString()} text messages
                      </span>
                    )}
                  </span>
                  {/* Includes the messages. Transferring the licence price alone
                      would leave the admin approving an amount that does not match
                      what was bought. */}
                  <span style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 700, color: C.gold }}>{fmt(dueNowCents(selectedTier.price_cents) + smsAddonCents)}</span>
                </div>
              )}

              {activeMethods.length === 0 ? (
                <div style={{ background: C.softBg, border: `1px dashed ${C.border}`, borderRadius: 12, padding: '16px 18px', marginBottom: 18 }}>
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: C.stone, margin: 0 }}>
                    No payment accounts are published yet. You can still generate a reference code and our team will share transfer details with you.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
                  {activeMethods.map((m, i) => {
                    const sel = (chosenMethod || activeMethods[0]?.label) === m.label;
                    return (
                      <div key={m.id || i}
                        onClick={() => setChosenMethod(m.label)}
                        style={{
                          border: sel ? `2px solid ${C.gold}` : `1.5px solid ${C.border}`,
                          background: sel ? 'rgba(184,148,79,0.05)' : C.white,
                          borderRadius: 14, padding: 16, cursor: 'pointer', transition: 'all 0.2s',
                        }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: m.details || m.instructions ? 10 : 0 }}>
                          <Icon name={METHOD_ICON[m.type] || METHOD_ICON.other} size={17} strokeWidth={1.5} />
                          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 700, color: C.charcoal, flex: 1 }}>{m.label}</span>
                          <div style={{
                            width: 20, height: 20, borderRadius: '50%',
                            border: sel ? `2px solid ${C.gold}` : `2px solid ${C.border}`,
                            background: sel ? C.gold : 'transparent',
                            display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {sel && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><path d="M5 13l4 4L19 7" /></svg>}
                          </div>
                        </div>
                        {m.details && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, background: C.softBg, borderRadius: 8, padding: '8px 12px', marginBottom: m.instructions ? 8 : 0 }}>
                            <code style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 13, color: C.charcoal, fontWeight: 600, flex: 1, wordBreak: 'break-all' }}>{m.details}</code>
                            <CopyBtn value={m.details} />
                          </div>
                        )}
                        {m.instructions && (
                          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: C.stone, margin: 0, lineHeight: 1.5, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 5 }}><Icon name="info" size={13} strokeWidth={1.6} style={{ flexShrink: 0, marginTop: 1 }} /> {m.instructions}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <label style={{ display: 'block', fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 700, color: C.charcoal, marginBottom: 6 }}>
                Proof of transfer <span style={{ color: C.stone, fontWeight: 500 }}>(transaction ID / sender number — optional but speeds up approval)</span>
              </label>
              <input
                value={payerRef}
                onChange={(e) => setPayerRef(e.target.value)}
                placeholder="e.g. Txn #889217734 from 0100-123-4567"
                style={{
                  width: '100%', boxSizing: 'border-box', height: 46, padding: '0 14px',
                  border: `1.5px solid ${C.border}`, borderRadius: 12, fontSize: 14,
                  fontFamily: 'var(--font-sans)', color: C.charcoal, outline: 'none', marginBottom: 18,
                }}
              />

              <button
                onClick={submitManual}
                disabled={processing || !selectedTierName}
                style={{
                  width: '100%', height: 52,
                  background: (processing || !selectedTierName) ? '#C9C4BA' : 'linear-gradient(135deg, #B8944F, #a6833f)',
                  color: C.white, border: 'none', borderRadius: 14,
                  fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 700,
                  cursor: (processing || !selectedTierName) ? 'not-allowed' : 'pointer',
                  boxShadow: (processing || !selectedTierName) ? 'none' : '0 4px 18px rgba(184,148,79,0.3)',
                }}
              >
                {processing ? 'Submitting…' : "I've Transferred — Get Reference Code"}
              </button>
            </div>
          )}
        </>
      )}

      {error && (
        <div style={{
          background: 'rgba(196,94,94,0.06)', border: '1px solid rgba(196,94,94,0.2)',
          borderRadius: 10, padding: '12px 16px', marginTop: 16,
          color: C.error, fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600,
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
        }}><Icon name="warning" size={14} strokeWidth={1.6} /> {error}</div>
      )}

      {/* Footer */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(12px)',
        borderTop: `1px solid ${C.border}`, padding: '16px 24px', paddingBottom: 'max(16px, calc(env(safe-area-inset-bottom) + 8px))', zIndex: 50,
        display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
      }}>
        <div className="sp-footer-inner" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', maxWidth: 860, width: '100%' }}>
          <button onClick={onBack} disabled={processing} className="sp-footer-btn" style={{
            height: 48, padding: '0 24px', background: 'none',
            border: `1.5px solid ${C.charcoal}`, borderRadius: 12,
            fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 700, color: C.charcoal,
            cursor: processing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
            Back
          </button>

          <div className="sp-footer-actions" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
            {!isPaid && onSkip && (
              <button onClick={onSkip} disabled={processing} className="sp-footer-btn" style={{
                background: 'none', border: 'none', color: C.stone,
                fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600,
                cursor: processing ? 'not-allowed' : 'pointer', textDecoration: 'underline',
              }}>
                Skip &amp; pay later
              </button>
            )}
            {(() => {
              // Paid/confirmed events can proceed; unpaid require a submitted manual ref.
              const continueReady = isPaid || paymentConfirmed || !!manualRef;
              return (
                <button onClick={onContinue} disabled={processing || !continueReady} className="sp-footer-btn" style={{
                  height: 52, padding: '0 32px',
                  background: (processing || !continueReady) ? '#C9C4BA' : 'linear-gradient(135deg, #B8944F, #a6833f)',
                  color: C.white, border: 'none', borderRadius: 14,
                  fontFamily: 'var(--font-sans)', fontSize: 15, fontWeight: 700,
                  cursor: (processing || !continueReady) ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  Continue
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
                </button>
              );
            })()}
          </div>
        </div>
      </div>

      <style jsx>{`
        /* Same failure Stage2's footer already fixed: Back + "Skip & pay later"
           + Continue is a no-wrap row ~380px wide plus 48px padding, and
           the root overflow guard CLIPS rather than scrolls — so on any phone the
           Continue button (the only way to actually pay) was pushed off-screen and
           became untappable. Stack full-width, Continue on top as the primary
           action, and grow the page's bottom padding to clear the now-taller
           fixed footer so the last tier card isn't hidden behind it. */
        @media (max-width: 639.98px) {
          .sp-footer-inner { flex-direction: column-reverse !important; align-items: stretch !important; gap: 10px !important; }
          .sp-footer-actions { flex-direction: column-reverse !important; align-items: stretch !important; width: 100% !important; gap: 10px !important; }
          .sp-footer-btn { width: 100% !important; justify-content: center !important; }
          /* The gutter moved to .fx-gutter--sm in globals.css — setting
             --fx-pad-x here was inert against the inline 24px on this element.
             See the note in Stage3_Distribution; same bug, same shape. */
          .sp-page {
            padding-top: 32px !important;
            padding-bottom: 240px !important;
          }
        }
      `}</style>
    </div>
  );
}
