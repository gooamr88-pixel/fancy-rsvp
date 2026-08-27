'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import adminApi from '../../_lib/adminApi';
import { T, card } from '../../_components/theme';
import { Button } from '../../_components/Modal';
import { useAlert } from '../../_components/AlertContext';
import { Field } from '../../_components/Field';
import { PageLoading } from '../../_components/Spinner';
import { ErrorState } from '../../_components/ErrorState';
import Icon from '../../../components/icons/Icon';

// ── Toggle Switch component ──
function Toggle({ checked, onChange, disabled }) {
  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 40, height: 22, borderRadius: 11, border: 'none', padding: 2,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        background: checked ? T.primary : T.border,
        display: 'flex', alignItems: 'center',
        justifyContent: checked ? 'flex-end' : 'flex-start',
        transition: 'background 0.2s ease',
      }}
    >
      <motion.div
        layout
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        style={{
          width: 18, height: 18, borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
        }}
      />
    </motion.button>
  );
}

/**
 * THE THREE THINGS A FEATURE SWITCH CAN BE, said on the switch itself.
 *
 * Every key in the registry becomes a toggle here, and an admin reads a toggle
 * as an access control — prices a plan around it, and sells it. Three of these
 * states are NOT access controls, and a plain switch for them is how a plan gets
 * sold on a capability the product hands out anyway, or one nobody has written.
 *
 *   ESSENTIAL  every plan carries it and it cannot be switched off. The switch
 *              is on and locked because the answer is genuinely fixed.
 *   SOON       on the roadmap. Design a plan around it, but it is withheld from
 *              every price list until it exists.
 *   NOT BUILT  no capability behind it and no date. The bluntest label, on
 *              purpose — it is the one an admin most needs to not sell.
 *
 * Rendered as a small caps pill rather than an icon: at 9px an icon is a smudge,
 * and this has to be legible in a dense list of 25 rows.
 *
 * ── Why the borders are rgba literals and not `T.primary + '55'` ──
 *
 * Every colour in this theme is a CSS custom property — `T.primary` is the
 * STRING `var(--admin-primary, #B8944F)`, not a hex value. Appending an alpha
 * suffix to it yields `var(--admin-primary, #B8944F)55`, which is not a colour
 * at any level of CSS: the browser drops the whole declaration and the border
 * silently disappears. It looks like it works because a missing hairline is not
 * something you notice. (The category header a few lines below does exactly
 * this with `T.primary + '40'` and has been borderless ever since.)
 */
function FeatureStateBadge({ feature }) {
  const badge = feature.alwaysOn === true
    ? {
      label: 'Essential',
      title: 'Every plan includes this, paid or not. It cannot be switched off — nothing gates it, and it is granted to every tier automatically.',
      fg: T.primary,
      bg: T.primarySoft,
      border: 'rgba(184, 148, 79, 0.38)',
    }
    : feature.comingSoon === true
      ? {
        label: 'Soon',
        title: 'On the roadmap. You can plan pricing around it, but it grants nothing yet and is deliberately hidden from the public pricing page and the payment step.',
        fg: T.text700,
        bg: 'transparent',
        border: T.border,
      }
      : feature.builtIn === false
        ? {
          label: 'Not built',
          title: "This capability doesn't exist yet — toggling it here has no effect on access, and it is hidden from every customer-facing price list.",
          fg: T.warning,
          bg: T.warningSoft,
          border: 'rgba(245, 158, 11, 0.32)',
        }
        : null;

  if (!badge) return null;

  return (
    <span
      title={badge.title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: '0.09em',
        textTransform: 'uppercase',
        padding: '2px 7px',
        borderRadius: 999,
        lineHeight: 1.5,
        color: badge.fg,
        background: badge.bg,
        border: `1px solid ${badge.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {badge.label}
    </span>
  );
}

// ── Feature Selector for a single tier ──
function FeatureSelector({ tierFeatures, registry, onChange }) {
  const [expandedCats, setExpandedCats] = useState({});
  const featureSet = useMemo(() => new Set(tierFeatures || []), [tierFeatures]);

  /**
   * What this plan actually grants — the stored keys PLUS the always-on ones.
   *
   * The header count used to be `featureSet.size`, which reads the raw array and
   * so disagreed with the switches directly beneath it the moment an always-on
   * capability rendered as ON. A count that contradicts what is on screen is
   * worse than no count: it is the one number an admin uses to sanity-check a
   * plan before saving it.
   */
  const grantedCount = useMemo(() => {
    const all = registry?.allFeatures || [];
    if (all.length === 0) return featureSet.size;
    return all.filter((f) => featureSet.has(f.key) || f.alwaysOn === true).length;
  }, [registry, featureSet]);
  const totalCount = grantedCount;

  const toggleFeature = useCallback((key) => {
    const updated = featureSet.has(key)
      ? [...featureSet].filter(k => k !== key)
      : [...featureSet, key];
    onChange(updated);
  }, [featureSet, onChange]);

  const toggleCategory = (cat) => {
    setExpandedCats(prev => ({ ...prev, [cat]: prev[cat] === false ? true : false }));
  };

  if (!registry) {
    return <p style={{ fontSize: 12, color: T.text500, fontStyle: 'italic' }}>Loading feature registry...</p>;
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h4 style={{ fontSize: 13, fontWeight: 700, color: T.text900, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Plan Features</h4>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          minWidth: 24, height: 20, padding: '0 8px', borderRadius: 10, fontSize: 11, fontWeight: 700,
          background: totalCount > 0 ? T.primarySoft : 'transparent',
          color: totalCount > 0 ? T.primary : T.text400,
          border: totalCount > 0 ? `1px solid ${T.primary}` : `1px solid ${T.border}`,
        }}>
          {totalCount} selected
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
        {registry.categories.map(cat => {
          const catFeatures = registry.features[cat] || [];
          // Same rule as the switches below — see grantedCount.
          const catSelected = catFeatures.filter(f => featureSet.has(f.key) || f.alwaysOn === true).length;
          const isExpanded = expandedCats[cat] !== false; // default open

          return (
            <div key={cat} style={{
              // rgba literal, not `T.primary + '40'`: T.primary is a var()
              // string, so the concatenation produced an invalid colour and this
              // border has never rendered. See FeatureStateBadge's note.
              border: `1px solid ${catSelected > 0 ? 'rgba(184, 148, 79, 0.25)' : T.border}`,
              borderRadius: T.radiusSm,
              background: catSelected > 0 ? T.primarySoft : T.surface,
              transition: 'all 0.2s ease',
            }}>
              {/* Category header */}
              <button
                type="button"
                onClick={() => toggleCategory(cat)}
                style={{
                  width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer',
                  color: catSelected > 0 ? T.text900 : T.text700, fontSize: 12, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                  borderLeft: `3px solid ${catSelected > 0 ? T.primary : 'transparent'}`,
                  transition: 'all 0.2s',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', fontSize: 8 }}>▶</span>
                  {cat}
                </span>
                {catSelected > 0 && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: T.primary, opacity: 0.8 }}>
                    {catSelected}/{catFeatures.length} selected
                  </span>
                )}
              </button>

              <AnimatePresence initial={false}>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div style={{ padding: '4px 14px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {catFeatures.map(feat => {
                        // An always-on capability is shown ON and locked, because
                        // it IS on: entitledFeatures() unions it into every tier,
                        // so whether the key sits in this array changes nothing.
                        // Rendering it as an ordinary switch invited an admin to
                        // "remove" something from a plan and watch nothing happen.
                        const on = featureSet.has(feat.key) || feat.alwaysOn === true;
                        const locked = feat.builtIn === false || feat.alwaysOn === true;
                        return (
                        <div key={feat.key} style={{
                          display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px',
                          borderRadius: 8,
                          background: on ? 'rgba(184, 148, 79, 0.05)' : 'rgba(0,0,0,0.01)',
                          border: `1px solid ${on ? 'rgba(184, 148, 79, 0.15)' : 'transparent'}`,
                          transition: 'all 0.15s',
                          opacity: feat.builtIn === false ? 0.6 : 1,
                        }}>
                          <Toggle
                            checked={on}
                            onChange={() => toggleFeature(feat.key)}
                            disabled={locked}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {/* flexWrap, because this row can now carry a label
                                plus a badge. A nowrap flex row's min-content
                                width is the SUM of its children, so on a narrow
                                admin window "Basic RSVP forms" + a pill would
                                push out of its own box rather than reflow. */}
                            <div style={{ fontSize: 12.5, fontWeight: 600, color: T.text900, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              {feat.label}
                              {/* "Free" is suppressed next to "Always on": every
                                  alwaysOn key is also freeDefault, and stacking
                                  two pills that say the same thing reads as two
                                  different facts. The stronger claim wins. */}
                              {feat.freeDefault && feat.alwaysOn !== true && (
                                <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: T.successSoft, color: T.success, textTransform: 'uppercase' }}>Free</span>
                              )}
                              <FeatureStateBadge feature={feat} />
                            </div>
                            <div style={{ fontSize: 11, color: T.text500, marginTop: 1, lineHeight: 1.3 }}>{feat.description}</div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SMS PRICING
 *
 * Every number that decides what an organizer pays for text messaging, and what
 * Fancy keeps, edited here rather than in source.
 *
 * The design principle throughout: NEVER show a knob without showing its
 * consequence. Each card sits above a server-computed preview, because the
 * failure this screen has to prevent is not a typo — it is an admin confidently
 * setting a markup that sells messages below carrier cost, on every event, until
 * someone reads a P&L. Cost, charge and margin are therefore always on screen
 * together, and always computed by the same backend function that bills.
 * ═══════════════════════════════════════════════════════════════════════════ */

const money = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;

const smsCardHeader = (title, subtitle) => (
  <div style={{ borderBottom: `1px solid ${T.border}`, paddingBottom: 12, marginBottom: 18 }}>
    <h3 style={{ fontSize: 15, fontWeight: 800, color: T.text900, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>{title}</h3>
    <p style={{ fontSize: 12, color: T.text500, margin: '4px 0 0', lineHeight: 1.55 }}>{subtitle}</p>
  </div>
);

const smsInput = {
  width: '100%', padding: '9px 11px', borderRadius: 8,
  border: `1px solid ${T.border}`, background: T.surface,
  color: T.text900, fontSize: 13, outline: 'none', boxSizing: 'border-box',
};

const smsHint = { fontSize: 11, color: T.text400, marginTop: 4, display: 'block', lineHeight: 1.5 };

/** The headline: what we charge, what it costs us, what we keep. */
function SmsMarginSummary({ preview, loading, rate, markup }) {
  // Use the mid-volume row so the figure is representative rather than the
  // cheapest or the most discounted.
  const rows = preview?.rows || [];
  const sample = rows.length ? rows[Math.floor(rows.length / 2)] : null;
  const belowCost = Number(markup) < 0;

  const stat = (label, value, color) => (
    <div style={{ flex: '1 1 140px' }}>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.07em', color: T.text400, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || T.text900, marginTop: 3 }}>{value}</div>
    </div>
  );

  return (
    <div style={{
      ...card, padding: 22,
      borderColor: belowCost ? '#C45E5E' : T.border,
      background: belowCost ? 'rgba(196,94,94,0.06)' : card.background,
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        {stat('Carrier cost', `${Number(rate) || 0}¢ / msg`)}
        {stat('Markup', `${Number(markup) || 0}%`, belowCost ? '#C45E5E' : T.text900)}
        {stat('Sell price', sample ? `${sample.effectiveCentsPerSegment}¢ / msg` : (loading ? '…' : '—'))}
        {stat('Gross margin', sample ? `${sample.marginPct}%` : (loading ? '…' : '—'),
          sample && sample.marginPct < 0 ? '#C45E5E' : '#3B9B6D')}
      </div>

      {belowCost && (
        <p style={{ fontSize: 12, color: '#C45E5E', margin: '14px 0 0', lineHeight: 1.6, fontWeight: 600 }}>
          A negative markup sells messages below what the carrier charges us. Every message sent
          on every event will lose money.
        </p>
      )}
      {sample && sample.marginPct < 0 && !belowCost && (
        <p style={{ fontSize: 12, color: '#C45E5E', margin: '14px 0 0', lineHeight: 1.6, fontWeight: 600 }}>
          Volume discounts have pushed the sell price below cost at this volume. Reduce a discount
          tier or raise the markup.
        </p>
      )}
    </div>
  );
}

/** The two headline numbers. */
function SmsRateCard({ rate, onRate, markup, onMarkup }) {
  return (
    <div style={{ ...card, padding: 28 }}>
      {smsCardHeader('Rate & Margin', 'What one message costs us, and what we add on top. These two drive every price below.')}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
        <Field label="Carrier cost per message (cents)">
          {/* step 0.01, not 0.1 — the real figure is 1.1 and the column was
              INTEGER until 20260822000000, which silently rounded it to 1 and
              made every margin on this page ~9% too optimistic. The input had
              always ACCEPTED a fraction; only the storage refused it. */}
          <input type="number" step="0.01" min="0" value={rate} onChange={(e) => onRate(e.target.value)} style={smsInput} />
          <span style={smsHint}>
            What the carrier bills us per segment. Vonage US outbound is $0.00809 plus
            roughly $0.002–0.003 of carrier pass-through fees, so ≈ <strong>1.1</strong>. Not shown to customers.
          </span>
        </Field>
        <Field label="Fancy markup (%)">
          <input type="number" step="0.1" value={markup} onChange={(e) => onMarkup(e.target.value)} style={smsInput} />
          <span style={smsHint}>Added to the carrier cost. 172.73% on a 1.1¢ message sells it at 3.0¢.</span>
        </Field>
      </div>
    </div>
  );
}

/** Tiered volume discounts — add, edit and remove thresholds. */
function SmsDiscountTiers({ tiers, onChange }) {
  const rows = Array.isArray(tiers) ? tiers : [];

  const update = (idx, key, value) => {
    const next = rows.map((t, i) => (i === idx ? { ...t, [key]: Number(value) } : t));
    onChange(next);
  };
  const remove = (idx) => onChange(rows.filter((_, i) => i !== idx));
  const add = () => {
    const highest = rows.reduce((m, t) => Math.max(m, Number(t.min_segments) || 0), 0);
    onChange([...rows, { min_segments: highest ? highest * 2 : 500, discount_pct: 5 }]);
  };

  return (
    <div style={{ ...card, padding: 28 }}>
      {smsCardHeader('Volume Discounts', 'Bulk pricing. Tiers are not cumulative — a customer gets the single best tier they qualify for.')}

      {rows.length === 0 && (
        <p style={{ fontSize: 12.5, color: T.text500, margin: '0 0 14px' }}>
          No volume discounts. Every purchase is charged at full price.
        </p>
      )}

      {rows.map((tier, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 160px' }}>
            <label style={{ fontSize: 11, color: T.text500, fontWeight: 600, display: 'block', marginBottom: 4 }}>From (messages)</label>
            <input type="number" min="1" value={tier.min_segments} onChange={(e) => update(idx, 'min_segments', e.target.value)} style={smsInput} />
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label style={{ fontSize: 11, color: T.text500, fontWeight: 600, display: 'block', marginBottom: 4 }}>Discount (%)</label>
            <input type="number" step="0.5" min="0" max="50" value={tier.discount_pct} onChange={(e) => update(idx, 'discount_pct', e.target.value)} style={smsInput} />
          </div>
          <button
            type="button"
            onClick={() => remove(idx)}
            style={{ padding: '9px 14px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: '#C45E5E', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
          >
            Remove
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        style={{ marginTop: 6, padding: '9px 16px', borderRadius: 8, border: `1px dashed ${T.border}`, background: 'transparent', color: T.primary, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
      >
        + Add a discount tier
      </button>

      <p style={{ ...smsHint, marginTop: 12 }}>
        A tier with a 0% discount, or one reusing a threshold another tier already claims, is
        dropped on save — the applicable tier has to be unambiguous.
        {' '}
        <strong>Discounts are capped at 50%</strong>, not 90%: at a 1.1¢ cost and a 3.0¢ list price
        the break-even discount is 63%, so a mistyped 65 would have saved without complaint and lost
        money on exactly the large orders these tiers exist to win.
      </p>
    </div>
  );
}

/** Purchase floor, ceiling and slider step. */
function SmsBoundsCard({ bounds, onChange }) {
  return (
    <div style={{ ...card, padding: 28 }}>
      {smsCardHeader('Purchase Limits', 'The smallest and largest bundle an organizer can buy, and the increment the slider moves in.')}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 20 }}>
        <Field label="Minimum purchase">
          <input type="number" min="1" value={bounds.min} onChange={(e) => onChange('min', Number(e.target.value))} style={smsInput} />
          <span style={smsHint}>Below this, the transaction fee outweighs the sale.</span>
        </Field>
        <Field label="Maximum purchase">
          <input type="number" min="1" value={bounds.max} onChange={(e) => onChange('max', Number(e.target.value))} style={smsInput} />
          <span style={smsHint}>A ceiling on a single order.</span>
        </Field>
        <Field label="Slider step">
          <input type="number" min="1" value={bounds.step} onChange={(e) => onChange('step', Number(e.target.value))} style={smsInput} />
          <span style={smsHint}>Recommendations round up to this, so customers buy round numbers.</span>
        </Field>
      </div>
    </div>
  );
}

/** The assumptions behind the bundle we recommend at checkout. */
function SmsEstimatorCard({ estimator, onChange }) {
  return (
    <div style={{ ...card, padding: 28 }}>
      {smsCardHeader(
        'Recommendation Model',
        'How the suggested bundle size is calculated on the customer\'s payment screen. Tune these against real usage — they change what customers are advised to buy, not what a message costs.',
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
        <Field label="Guests per invitation">
          <input type="number" step="0.1" min="1" max="20" value={estimator.guests_per_party} onChange={(e) => onChange('guests_per_party', Number(e.target.value))} style={smsInput} />
          <span style={smsHint}>
            Texts go to one contact per invitation, not per head. A 200-guest plan at 2.2 is ~91 recipients.
          </span>
        </Field>
        <Field label="Segments per message — Latin">
          <input type="number" step="0.1" min="1" max="10" value={estimator.segments_per_message_latin} onChange={(e) => onChange('segments_per_message_latin', Number(e.target.value))} style={smsInput} />
          <span style={smsHint}>160 characters per segment. A typical body plus the compliance footer is ~1.4.</span>
        </Field>
        <Field label="Segments per message — Arabic">
          <input type="number" step="0.1" min="1" max="10" value={estimator.segments_per_message_arabic} onChange={(e) => onChange('segments_per_message_arabic', Number(e.target.value))} style={smsInput} />
          <span style={smsHint}>Arabic forces UCS-2 at only 70 characters per segment, so the same message costs 2–3×.</span>
        </Field>
        <Field label="Assumed guests — unlimited plans">
          <input type="number" min="1" value={estimator.unlimited_tier_assumed_guests} onChange={(e) => onChange('unlimited_tier_assumed_guests', Number(e.target.value))} style={smsInput} />
          <span style={smsHint}>Plans with no guest cap still need a finite number to size a bundle from.</span>
        </Field>
      </div>
    </div>
  );
}

/**
 * THE ALLOWANCE LADDER — messages budgeted per invitation, by guest count.
 *
 * The control that decides whether a large event is affordable. The model this
 * replaced multiplied a flat frequency by party count, so a 3,000-guest event
 * was quoted almost exactly ten times a 300-guest one — arithmetically
 * consistent and commercially useless.
 */
function SmsGuestBands({ bands, onChange }) {
  const rows = Array.isArray(bands) ? bands : [];

  const set = (i, key, value) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r));
    onChange(next);
  };

  return (
    <div style={{ ...card, padding: 28 }}>
      {smsCardHeader(
        'Messages Per Invitation, By Event Size',
        'The bigger the guest list, the fewer messages each invitation is budgeted. Run alongside the volume discounts below, this is what stops a 3,000-guest event costing ten times a 300-guest one.',
      )}

      {rows.map((b, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 180px' }}>
            <label style={{ fontSize: 11.5, color: T.text900, fontWeight: 600, display: 'block', marginBottom: 4 }}>
              Up to this many guests
            </label>
            <input
              type="number" min="1"
              value={b.max_guests ?? ''}
              placeholder="No limit"
              onChange={(e) => set(i, 'max_guests', e.target.value === '' ? null : Number(e.target.value))}
              style={smsInput}
            />
          </div>
          <div style={{ flex: '1 1 180px' }}>
            <label style={{ fontSize: 11.5, color: T.text900, fontWeight: 600, display: 'block', marginBottom: 4 }}>
              Messages per invitation
            </label>
            <input
              type="number" step="0.1" min="0"
              value={b.messages_per_party ?? 0}
              onChange={(e) => set(i, 'messages_per_party', Number(e.target.value))}
              style={smsInput}
            />
          </div>
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
            style={{ padding: '9px 14px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: '#C45E5E', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginBottom: 2 }}
          >
            Remove
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...rows, { max_guests: 500, messages_per_party: 2 }])}
        style={{ marginTop: 6, padding: '9px 16px', borderRadius: 8, border: `1px dashed ${T.border}`, background: 'transparent', color: T.primary, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
      >
        + Add a band
      </button>

      <p style={{ ...smsHint, marginTop: 12 }}>
        The LAST band must be open-ended — leave its guest limit blank. Without one, an event
        bigger than every band would be quoted zero messages, which unlocks the add-on and then
        cannot send anything. If you forget, it is forced open on save and you will be told.
      </p>
    </div>
  );
}

/**
 * How a band's budget is split across the guest message types.
 *
 * RELATIVE shares. Doubling every weight changes nothing — only the ratios
 * matter. Deliberately a separate control from the organizer frequency below,
 * because the two mean genuinely different things and one input meaning both is
 * how a wrong invoice gets written two years from now.
 */
function SmsTypeWeights({ weights, frequencies, messageTypes, onWeight, onFrequency }) {
  /**
   * Fall back to the keys in the stored config when the type catalogue has not
   * arrived (or the endpoint stopped sending it).
   *
   * The card this replaced had exactly this fallback, and dropping it meant a
   * failed or slow `smsMessageTypes` fetch rendered an EMPTY panel — an admin
   * looking at a pricing screen with a silently missing control, unable to tell
   * whether the weights were unset or the page was broken.
   */
  const types = messageTypes.length
    ? messageTypes
    : [
      ...Object.keys(weights || {}).map((key) => ({ key, label: key, audience: 'guest' })),
      ...Object.keys(frequencies || {}).map((key) => ({ key, label: key, audience: 'organizer' })),
    ];

  const guestTypes = types.filter((t) => t.audience === 'guest');
  const orgTypes = types.filter((t) => t.audience === 'organizer');
  const totalWeight = guestTypes.reduce((s, t) => s + Number(weights[t.key] ?? 0), 0) || 1;

  return (
    <div style={{ ...card, padding: 28 }}>
      {smsCardHeader(
        'How The Budget Is Split',
        'Relative shares, not absolute counts. Only the ratios matter — the share column shows what each type actually gets.',
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        {guestTypes.map((t) => (
          <div key={t.key}>
            <label style={{ fontSize: 11.5, color: T.text900, fontWeight: 600, display: 'block', marginBottom: 4 }}>
              {t.label}
              <span style={{ marginLeft: 6, fontSize: 10, color: T.text400, fontWeight: 500 }}>
                {Math.round((Number(weights[t.key] ?? 0) / totalWeight) * 100)}% of the budget
              </span>
            </label>
            <input
              type="number" step="0.1" min="0"
              value={weights[t.key] ?? 0}
              onChange={(e) => onWeight(t.key, Number(e.target.value))}
              style={smsInput}
            />
          </div>
        ))}
      </div>

      {orgTypes.length > 0 && (
        <>
          <div style={{ height: 1, background: T.border, margin: '20px 0 16px' }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            {orgTypes.map((t) => (
              <div key={t.key}>
                <label style={{ fontSize: 11.5, color: T.text900, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  {t.label}
                  <span style={{ marginLeft: 6, fontSize: 10, color: T.text400, fontWeight: 500 }}>per event, absolute</span>
                </label>
                <input
                  type="number" step="0.5" min="0"
                  value={frequencies[t.key] ?? 0}
                  onChange={(e) => onFrequency(t.key, Number(e.target.value))}
                  style={smsInput}
                />
              </div>
            ))}
          </div>
          <p style={{ ...smsHint, marginTop: 12 }}>
            Organizer messages are counted once per EVENT, never per invitation — the same few
            reports go out whether they invite 20 people or 2,000, so multiplying them by the
            guest list would overcharge every large event.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Anti-abuse ramp-up and the low-balance warning.
 *
 * The ramp-up is the one control on this screen that can stop a paying customer
 * from sending, so it is presented as what it is — a cap per send that lifts
 * itself — rather than as a security setting. An admin needs to see immediately
 * that the top band is unlimited, because the fear this control creates is
 * "am I permanently throttling my own customers?".
 */
function SmsLimitsCard({ limits, alerts, onChangeRampUp, onChangeAlert }) {
  const bands = Array.isArray(limits?.ramp_up) ? limits.ramp_up : [];

  const update = (idx, key, value) => {
    onChangeRampUp(bands.map((b, i) => (i === idx ? { ...b, [key]: Number(value) } : b)));
  };
  const remove = (idx) => onChangeRampUp(bands.filter((_, i) => i !== idx));
  const add = () => {
    const highest = bands.reduce((m, b) => Math.max(m, Number(b.delivered_min) || 0), 0);
    onChangeRampUp([...bands, { delivered_min: highest ? highest * 5 : 200, max_per_send: 500 }]);
  };

  return (
    <div style={{ ...card, padding: 28 }}>
      {smsCardHeader(
        'Sending Limits & Warnings',
        'How many messages a new account may send at once, and when an organizer is warned that they are running low.',
      )}

      <p style={{ fontSize: 12.5, color: T.text500, lineHeight: 1.6, margin: '0 0 14px' }}>
        A brand-new account can otherwise spend its whole balance in one request — which is
        exactly what a fraudulent signup would do, and the carrier damage lands on the shared
        number every customer sends from. The cap rises automatically as an organization
        delivers real messages, so a genuine customer lifts their own limit. Set{' '}
        <strong>0</strong> for unlimited.
      </p>

      {bands.map((band, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 170px' }}>
            <label style={{ fontSize: 11, color: T.text500, fontWeight: 600, display: 'block', marginBottom: 4 }}>After delivering</label>
            <input type="number" min="0" value={band.delivered_min} onChange={(e) => update(idx, 'delivered_min', e.target.value)} style={smsInput} />
          </div>
          <div style={{ flex: '1 1 170px' }}>
            <label style={{ fontSize: 11, color: T.text500, fontWeight: 600, display: 'block', marginBottom: 4 }}>
              Max per send {Number(band.max_per_send) === 0 && <span style={{ color: T.success, fontWeight: 700 }}>(unlimited)</span>}
            </label>
            <input type="number" min="0" value={band.max_per_send} onChange={(e) => update(idx, 'max_per_send', e.target.value)} style={smsInput} />
          </div>
          <button
            type="button"
            onClick={() => remove(idx)}
            style={{ padding: '9px 14px', borderRadius: 8, border: `1px solid ${T.border}`, background: 'transparent', color: '#C45E5E', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
          >
            Remove
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        style={{ marginTop: 4, padding: '9px 16px', borderRadius: 8, border: `1px dashed ${T.border}`, background: 'transparent', color: T.primary, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
      >
        + Add a band
      </button>

      {bands.length === 0 && (
        <p style={{ fontSize: 12, color: '#C45E5E', marginTop: 12, fontWeight: 600, lineHeight: 1.6 }}>
          No bands configured — every account can send without limit. Fine for a private
          deployment; risky anywhere with open signups.
        </p>
      )}

      <div style={{ marginTop: 24, paddingTop: 20, borderTop: `1px solid ${T.border}`, maxWidth: 260 }}>
        <Field label="Warn when messages left fall below (%)">
          <input
            type="number" min="1" max="90"
            value={alerts?.low_balance_pct ?? 20}
            onChange={(e) => onChangeAlert('low_balance_pct', Number(e.target.value))}
            style={smsInput}
          />
          <span style={smsHint}>
            One email while there is still time to top up. A second is sent when they reach
            zero. Warning only at zero — the old behaviour — arrives after guests have already
            stopped receiving texts.
          </span>
        </Field>
      </div>
    </div>
  );
}

/** What a customer pays at each volume, and what we keep. */
function SmsPriceTable({ preview, loading }) {
  const rows = preview?.rows || [];

  return (
    <div style={{ ...card, padding: 28 }}>
      {smsCardHeader('Price Table', 'What an organizer pays at each volume, and what Fancy keeps after carrier cost. Rows sit either side of each discount threshold so the step is visible.')}

      {loading && rows.length === 0 && <p style={{ fontSize: 12.5, color: T.text500 }}>Calculating…</p>}
      {!loading && rows.length === 0 && <p style={{ fontSize: 12.5, color: T.text500 }}>No preview available.</p>}

      {rows.length > 0 && (
        <div className="fx-scroll-x">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 560 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                {['Messages', 'Customer pays', 'Per msg', 'Discount', 'Our cost', 'We keep', 'Margin'].map((h, i) => (
                  <th key={h} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '8px 10px', color: T.text400, fontWeight: 700, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                /* A loss is painted in the row that causes it, not discovered in
                   a monthly total three weeks later. `belowCost` comes from the
                   same describeSmsCharge the checkout uses, so a red row here is
                   a real order that would really lose money. */
                <tr key={r.segments} style={{
                  borderBottom: `1px solid ${T.border}`,
                  background: r.belowCost ? 'rgba(196,94,94,0.07)' : 'transparent',
                }}>
                  <td style={{ padding: '8px 10px', color: T.text900, fontWeight: 700 }}>
                    {r.segments.toLocaleString()}
                    {r.belowCost && (
                      <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#C45E5E', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        below cost
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: T.text900, fontWeight: 700 }}>{money(r.chargeCents)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: T.text500 }}>{r.effectiveCentsPerSegment}¢</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: r.discountPct > 0 ? '#3B9B6D' : T.text400 }}>
                    {r.discountPct > 0 ? `−${r.discountPct}%` : '—'}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: T.text500 }}>{money(r.baseCostCents)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: r.profitCents < 0 ? '#C45E5E' : '#3B9B6D', fontWeight: 700 }}>{money(r.profitCents)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: r.marginPct < 0 ? '#C45E5E' : T.text500 }}>{r.marginPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** What a real customer on each plan is quoted — the number they actually see. */
function SmsTierPreview({ preview }) {
  const tiers = preview?.tierPreviews || [];
  if (tiers.length === 0) return null;

  return (
    <div style={{ ...card, padding: 28 }}>
      {smsCardHeader('What Each Plan Is Quoted', 'The bundle we recommend on the payment screen for each plan, and what it earns. Arabic events are shown separately because they cost roughly twice as much to serve.')}

      <div className="fx-scroll-x">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 620 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${T.border}` }}>
              {['Plan', 'Recipients', 'Latin — size', 'Latin — price', 'Latin — margin', 'Arabic — size', 'Arabic — price'].map((h, i) => (
                <th key={h} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '8px 10px', color: T.text400, fontWeight: 700, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => (
              <tr key={t.tierName} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td style={{ padding: '8px 10px', color: T.text900, fontWeight: 700 }}>
                  {t.tierName}
                  <span style={{ display: 'block', fontSize: 10.5, color: T.text400, fontWeight: 500 }}>
                    {t.maxGuests ? `${t.maxGuests} guests` : 'unlimited'}
                  </span>
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: T.text500 }}>{t.latin.estimatedParties}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: T.text500 }}>{t.latin.recommendedSegments.toLocaleString()}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: T.text900, fontWeight: 700 }}>{money(t.latin.chargeCents)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: t.latin.marginPct < 0 ? '#C45E5E' : '#3B9B6D' }}>{t.latin.marginPct}%</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: T.text500 }}>{t.arabic.recommendedSegments.toLocaleString()}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: T.text900, fontWeight: 700 }}>{money(t.arabic.chargeCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main Page ──
export default function ConfigPage() {
  const { showAlert, showConfirm } = useAlert();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Form states
  const [smsRate, setSmsRate] = useState(8);
  const [smsMarkupPercentage, setSmsMarkupPercentage] = useState(40.0);
  const [platformCommissionPct, setPlatformCommissionPct] = useState(0.0);
  const [pricingTiers, setPricingTiers] = useState([]);
  const [manualMethods, setManualMethods] = useState([]);
  const [landingStats, setLandingStats] = useState([]);
  const [featureRegistry, setFeatureRegistry] = useState(null);

  /* ── SMS pricing model ──
     Everything that decides what an organizer is quoted for text messaging and
     what Fancy earns on it. `smsPricing` is the NORMALIZED model as returned by
     the server, so the form always renders the values that will actually be
     applied rather than whatever was typed. */
  const [smsPricing, setSmsPricing] = useState(null);
  const [smsMessageTypes, setSmsMessageTypes] = useState([]);
  // Server-computed margin preview. Deliberately not calculated in the browser:
  // a client-side copy of pricing maths is how an admin ends up tuning a margin
  // against numbers that quietly stopped matching what customers are charged.
  const [smsPreview, setSmsPreview] = useState(null);
  const [smsPreviewLoading, setSmsPreviewLoading] = useState(false);

  // UI state
  const [activeTab, setActiveTab] = useState('pricing'); // 'pricing' | 'sms' | 'tiers' | 'payments' | 'stats'
  const [selectedTierIdx, setSelectedTierIdx] = useState(0);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    // Re-arm the loading spinner for a manual retry, not just the initial mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    (async () => {
      try {
        const [pricingRes, registryRes] = await Promise.all([
          adminApi.get('/pricing'),
          adminApi.get('/feature-registry').catch(() => null),
        ]);
        if (pricingRes.config) {
          setSmsRate(pricingRes.config.sms_rate_cents_per_credit ?? 8);
          setSmsMarkupPercentage(pricingRes.config.sms_markup_percentage ?? 40.0);
          setPlatformCommissionPct(pricingRes.config.platform_commission_pct ?? 0.0);
          setPricingTiers(pricingRes.config.pricing_tiers || []);
          setManualMethods(pricingRes.config.manual_payment_methods || []);
          setLandingStats(pricingRes.config.landing_stats || []);
        }
        // The normalized SMS model + the message-type catalogue the frequency
        // table is built from.
        if (pricingRes.smsPricing) setSmsPricing(pricingRes.smsPricing);
        if (Array.isArray(pricingRes.smsMessageTypes)) setSmsMessageTypes(pricingRes.smsMessageTypes);
        if (registryRes) setFeatureRegistry(registryRes);
        setError(null);
      } catch (err) {
        setError(err.message || 'Failed to load configuration');
      } finally {
        setLoading(false);
      }
    })();
  }, [retryTick]);

  /* ── Live margin preview ──
     Re-priced by the SERVER on every change, debounced. This is the screen where
     someone can accidentally set a markup below carrier cost and sell messages at
     a loss on every event; showing cost, charge and margin side by side — computed
     by the same function that charges the customer — is what makes that visible
     before it is saved rather than after. */
  useEffect(() => {
    if (activeTab !== 'sms' || !smsPricing) return;
    let cancelled = false;
    setSmsPreviewLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await adminApi.post('/pricing/sms-preview', {
          smsRateCentsPerCredit: parseFloat(smsRate),
          smsMarkupPercentage: parseFloat(smsMarkupPercentage),
          smsPricingConfig: smsPricing,
        });
        if (!cancelled) setSmsPreview(res);
      } catch {
        if (!cancelled) setSmsPreview(null);
      } finally {
        if (!cancelled) setSmsPreviewLoading(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [activeTab, smsPricing, smsRate, smsMarkupPercentage]);

  /* Immutable-update helpers for the nested pricing model. */
  const patchSmsPricing = useCallback((patch) => {
    setSmsPricing((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);
  const patchSmsSection = useCallback((section, key, value) => {
    setSmsPricing((prev) => (prev ? { ...prev, [section]: { ...prev[section], [key]: value } } : prev));
  }, []);

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await adminApi.patch('/pricing', {
        smsRateCentsPerCredit: parseFloat(smsRate),
        smsMarkupPercentage: parseFloat(smsMarkupPercentage),
        platformCommissionPct: parseFloat(platformCommissionPct),
        pricingTiers,
        manualPaymentMethods: manualMethods,
        landingStats,
        ...(smsPricing ? { smsPricingConfig: smsPricing } : {}),
      });

      // Re-render from what was STORED, not what was typed. The server clamps
      // out-of-range values rather than rejecting the save, so the form must show
      // the applied model — otherwise the admin walks away believing a number that
      // was silently adjusted.
      if (res?.smsPricing) setSmsPricing(res.smsPricing);

      const notes = Array.isArray(res?.smsPricingNotes) ? res.smsPricingNotes : [];
      if (notes.length > 0) {
        await showAlert(`Saved, with adjustments:\n\n• ${notes.join('\n• ')}`, 'Saved', 'warning');
      } else {
        await showAlert('Configuration saved successfully.', 'Success', 'success');
      }
    } catch (err) {
      await showAlert(err.message || 'Failed to save configuration', 'Error', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Pricing tier helpers
  const handleTierChange = (idx, field, val) => {
    setPricingTiers(prev => prev.map((tier, i) => i === idx ? { ...tier, [field]: val } : tier));
  };

  const addTier = (e) => {
    e?.preventDefault?.();
    const newTier = { name: 'New Tier', price_cents: 1900, max_guests: 100, max_events: 0, remove_watermark: false, recommended: false, is_custom: false, features: [] };
    setPricingTiers(prev => [...prev, newTier]);
    setSelectedTierIdx(pricingTiers.length);
  };

  const removeTier = async (idx) => {
    if (pricingTiers.length <= 1) return;
    const tier = pricingTiers[idx];
    const ok = await showConfirm(
      `Delete the "${tier?.name || 'this'}" tier? This takes effect once you save.

` +
      `Events already on it keep the guest cap AND the features they paid for — those were snapshotted at purchase. ` +
      `But the plan disappears from checkout, nobody can be upgraded onto it, and any promo code granting it stops working ` +
      `until you point it at another plan.

` +
      `To rename it instead, edit the Tier Name field — that is safe and keeps every event attached.`,
      'Delete Pricing Tier',
      'danger'
    );
    if (!ok) return;
    setPricingTiers(prev => prev.filter((_, i) => i !== idx));
    setSelectedTierIdx(prev => Math.max(0, prev - 1));
  };

  // Manual payment method helpers
  const updateMethod = (idx, field, val) => {
    setManualMethods(prev => prev.map((m, i) => i === idx ? { ...m, [field]: val } : m));
  };

  const addMethod = (e) => {
    e?.preventDefault?.();
    setManualMethods(prev => [
      ...prev,
      { label: 'New Method', type: 'bank', details: '', instructions: '', is_active: true }
    ]);
  };

  const removeMethod = async (idx) => {
    const m = manualMethods[idx];
    const ok = await showConfirm(
      `Remove the "${m?.label || 'this'}" payment method? Organizers will no longer see it as an option at checkout once you save.`,
      'Remove Payment Method',
      'warning'
    );
    if (!ok) return;
    setManualMethods(prev => prev.filter((_, i) => i !== idx));
  };

  // Landing page stat counter helpers
  const updateStat = (idx, field, val) => {
    setLandingStats(prev => prev.map((s, i) => i === idx ? { ...s, [field]: val } : s));
  };

  const addStat = (e) => {
    e?.preventDefault?.();
    setLandingStats(prev => [...prev, { label: 'New Stat', target: 0, suffix: '+', decimals: 0, source: 'static' }]);
  };

  const removeStat = async (idx) => {
    const s = landingStats[idx];
    const ok = await showConfirm(
      `Remove the "${s?.label || 'this'}" stat counter from the landing page once you save?`,
      'Remove Stat Counter',
      'warning'
    );
    if (!ok) return;
    setLandingStats(prev => prev.filter((_, i) => i !== idx));
  };

  const tabStyle = (tab) => ({
    padding: '12px 18px',
    background: activeTab === tab ? T.surface : 'transparent',
    border: 'none',
    borderBottom: activeTab === tab ? `2px solid ${T.primary}` : '2px solid transparent',
    color: activeTab === tab ? T.text900 : T.text500,
    fontSize: 13,
    fontWeight: activeTab === tab ? 700 : 500,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    transition: 'all 0.2s ease',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  });

  if (loading) return <PageLoading label="Loading configuration…" />;
  if (error) return <ErrorState message={error} onRetry={() => setRetryTick((t) => t + 1)} />;

  const currentTier = pricingTiers[selectedTierIdx];

  return (
    <div className="fx-container fx-container--xl" style={{ paddingBottom: 60 }}>
      {/* Premium Elegant Header */}
      <header style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: T.text900, margin: 0, fontFamily: 'var(--font-serif)', letterSpacing: '-0.02em' }}>System Configuration</h1>
        <p style={{ fontSize: 13.5, color: T.text500, margin: '6px 0 0', lineHeight: 1.5 }}>
          Configure global platform pricing rules, manage license tiers, activate offline payment coordinators, and edit social-proof statistics.
        </p>
      </header>

      {/* Tabs Shell */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${T.border}`, marginBottom: 24, gap: 4, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <button type="button" onClick={() => setActiveTab('pricing')} style={tabStyle('pricing')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2" /><line x1="12" y1="4" x2="12" y2="20" /><line x1="2" y1="12" x2="22" y2="12" /></svg>
          Global Pricing
        </button>
        <button type="button" onClick={() => setActiveTab('sms')} style={tabStyle('sms')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
          SMS Pricing
        </button>
        <button type="button" onClick={() => setActiveTab('tiers')} style={tabStyle('tiers')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
          Subscription Tiers
        </button>
        <button type="button" onClick={() => setActiveTab('payments')} style={tabStyle('payments')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg>
          Offline Payments
        </button>
        <button type="button" onClick={() => setActiveTab('stats')} style={tabStyle('stats')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
          Landing Stats
        </button>
      </div>

      <form onSubmit={handleSaveConfig}>
        <div style={{ minHeight: 400, marginBottom: 28 }}>
          <AnimatePresence mode="wait">
            {/* TAB 1: Global Pricing */}
            {activeTab === 'pricing' && (
              <motion.div
                key="pricing"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                style={{ ...card, padding: 28 }}
              >
                <div style={{ borderBottom: `1px solid ${T.border}`, paddingBottom: 12, marginBottom: 20 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 800, color: T.text900, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>Global Core Pricing Variables</h3>
                  <p style={{ fontSize: 12, color: T.text500, margin: '4px 0 0' }}>Configure default rates and platform-wide commission structures.</p>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
                  <Field label="Platform Commission (%)">
                    <input type="number" step="0.1" value={platformCommissionPct} onChange={e => setPlatformCommissionPct(e.target.value)} style={inputStyle} />
                    <span style={{ fontSize: 11, color: T.text400, marginTop: 4, display: 'block' }}>Fee rate percentage taken from ticketing/sales.</span>
                  </Field>
                </div>

                {/* The SMS rate and markup used to live here as two bare inputs. They
                    moved to their own tab — not to tidy up, but because editing a
                    price without seeing its margin is how messages end up sold below
                    carrier cost. They are the same two values; duplicating the inputs
                    across tabs would just make it unclear which one "counts". */}
                <button
                  type="button"
                  onClick={() => setActiveTab('sms')}
                  style={{
                    marginTop: 22, width: '100%', textAlign: 'left', cursor: 'pointer',
                    padding: '14px 16px', borderRadius: 10,
                    border: `1px solid ${T.border}`, background: T.surfaceAlt,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  }}
                >
                  <span>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: T.text900 }}>
                      SMS rate, markup &amp; volume discounts
                    </span>
                    <span style={{ display: 'block', fontSize: 11.5, color: T.text500, marginTop: 2 }}>
                      Currently {Number(smsRate) || 0}¢ per message with a {Number(smsMarkupPercentage) || 0}% markup.
                    </span>
                  </span>
                  <span style={{ color: T.primary, fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>Open →</span>
                </button>
              </motion.div>
            )}

            {/* TAB 2: SMS Pricing — the full commercial model for text messaging */}
            {activeTab === 'sms' && (
              <motion.div
                key="sms"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
              >
                {!smsPricing ? (
                  <div style={{ ...card, padding: 28, color: T.text500, fontSize: 13 }}>
                    SMS pricing configuration is unavailable. Apply migration
                    <code style={{ margin: '0 4px' }}>20260819000000_sms_pricing_config.sql</code>
                    and reload.
                  </div>
                ) : (
                  <>
                    <SmsMarginSummary preview={smsPreview} loading={smsPreviewLoading} rate={smsRate} markup={smsMarkupPercentage} />

                    <SmsRateCard
                      rate={smsRate} onRate={setSmsRate}
                      markup={smsMarkupPercentage} onMarkup={setSmsMarkupPercentage}
                    />

                    <SmsDiscountTiers
                      tiers={smsPricing.volume_discounts}
                      onChange={(next) => patchSmsPricing({ volume_discounts: next })}
                    />

                    <SmsBoundsCard
                      bounds={smsPricing.bounds}
                      onChange={(key, value) => patchSmsSection('bounds', key, value)}
                    />

                    <SmsEstimatorCard
                      estimator={smsPricing.estimator}
                      onChange={(key, value) => patchSmsSection('estimator', key, value)}
                    />

                    <SmsGuestBands
                      bands={smsPricing.guest_bands}
                      onChange={(next) => patchSmsPricing({ guest_bands: next })}
                    />

                    <SmsTypeWeights
                      weights={smsPricing.type_weights || {}}
                      frequencies={smsPricing.type_frequencies || {}}
                      messageTypes={smsMessageTypes}
                      onWeight={(key, value) => patchSmsSection('type_weights', key, value)}
                      onFrequency={(key, value) => patchSmsSection('type_frequencies', key, value)}
                    />

                    <SmsLimitsCard
                      limits={smsPricing.limits}
                      alerts={smsPricing.alerts}
                      onChangeRampUp={(next) => patchSmsPricing({ limits: { ...smsPricing.limits, ramp_up: next } })}
                      onChangeAlert={(key, value) => patchSmsSection('alerts', key, value)}
                    />

                    <SmsPriceTable preview={smsPreview} loading={smsPreviewLoading} />
                    <SmsTierPreview preview={smsPreview} />
                  </>
                )}
              </motion.div>
            )}

            {/* TAB 3: Subscription Tiers */}
            {activeTab === 'tiers' && (
              <motion.div
                key="tiers"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="cfg-responsive-grid"
                style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 24 }}
              >
                {/* Tiers Sidebar List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <h4 style={{ fontSize: 11, fontWeight: 700, color: T.text400, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px 6px' }}>Tiers List</h4>
                  {pricingTiers.map((tier, idx) => (
                    <button
                      key={tier.name + idx}
                      type="button"
                      onClick={() => setSelectedTierIdx(idx)}
                      style={{
                        padding: '12px 14px',
                        background: selectedTierIdx === idx ? T.primarySoft : T.surface,
                        border: `1px solid ${selectedTierIdx === idx ? T.primary : T.border}`,
                        borderRadius: T.radiusSm,
                        color: selectedTierIdx === idx ? T.primary : T.text700,
                        fontSize: 12.5,
                        fontWeight: 700,
                        textAlign: 'left',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <span>{tier.name}</span>
                      {tier.recommended && <Icon name="star" size={11} strokeWidth={1.7} />}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={addTier}
                    style={{
                      padding: '10px 14px',
                      background: 'transparent',
                      border: `1px dashed ${T.border}`,
                      borderRadius: T.radiusSm,
                      color: T.primary,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      marginTop: 8,
                      textAlign: 'center',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = T.primary}
                    onMouseLeave={e => e.currentTarget.style.borderColor = T.border}
                  >
                    + Add New Tier
                  </button>
                </div>

                {/* Selected Tier Configuration Card */}
                {currentTier ? (
                  <div className="cfg-tier-card" style={{ ...card, padding: 28, minWidth: 0 }}>
                    <div className="cfg-tier-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${T.border}`, paddingBottom: 14, marginBottom: 20 }}>
                      <div>
                        <h3 style={{ fontSize: 15, fontWeight: 800, color: T.text900, margin: 0 }}>Configure Tier: {currentTier.name}</h3>
                        <p style={{ fontSize: 12, color: T.text500, margin: '2px 0 0' }}>Plan limits, core parameters, pricing labels, and gated features registry.</p>
                      </div>
                      <Button type="button" variant="danger" disabled={pricingTiers.length <= 1} onClick={() => removeTier(selectedTierIdx)}>Delete Tier</Button>
                    </div>

                    <div className="cfg-responsive-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
                      <Field label="Tier Name">
                        <input value={currentTier.name} onChange={e => handleTierChange(selectedTierIdx, 'name', e.target.value)} style={inputStyle} />
                        {/* Renaming used to be destructive and silent: a plan
                            had no identity beyond this text, so editing it
                            detached every event that had bought the plan —
                            revoking their paid features, breaking upgrade
                            pricing and turning that plan's promo codes into
                            unlimited-guest grants. Plans now carry a stable
                            key, shown here so it is visible that the name is
                            only a label. */}
                        <p style={{ fontSize: 11, color: T.text500, margin: '6px 0 0', lineHeight: 1.5 }}>
                          {currentTier.key
                            ? <>Display name only — safe to change. Events stay attached to this plan by its ID <code style={{ fontFamily: 'monospace', color: T.text900 }}>{currentTier.key}</code>.</>
                            : <>This plan gets its permanent ID when you save.</>}
                        </p>
                      </Field>
                      <Field label={currentTier.is_custom ? 'Price (cents - Custom)' : 'Price (cents)'}>
                        <input type="number" value={currentTier.price_cents} disabled={currentTier.is_custom} onChange={e => handleTierChange(selectedTierIdx, 'price_cents', e.target.value)} style={{ ...inputStyle, opacity: currentTier.is_custom ? 0.5 : 1 }} />
                      </Field>
                      <Field label="Max Guests (0 = unlimited)">
                        <input type="number" value={currentTier.max_guests} onChange={e => handleTierChange(selectedTierIdx, 'max_guests', e.target.value)} style={inputStyle} />
                      </Field>
                    </div>

                    <div className="cfg-responsive-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                      <Field label="Display Price Label (e.g. Custom)">
                        <input value={currentTier.price_label || ''} onChange={e => handleTierChange(selectedTierIdx, 'price_label', e.target.value)} placeholder="auto from price" style={inputStyle} />
                      </Field>
                      <Field label="CTA Button Label">
                        <input value={currentTier.cta_label || ''} onChange={e => handleTierChange(selectedTierIdx, 'cta_label', e.target.value)} placeholder="Get Started" style={inputStyle} />
                      </Field>
                    </div>

                    <div className="cfg-responsive-grid" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 18 }}>
                      <Field label="Description">
                        <input value={currentTier.description || ''} onChange={e => handleTierChange(selectedTierIdx, 'description', e.target.value)} style={inputStyle} />
                      </Field>
                      <Field label="Max Events (0 = unlimited)">
                        <input type="number" min="0" value={currentTier.max_events ?? ''} onChange={e => handleTierChange(selectedTierIdx, 'max_events', e.target.value)} placeholder="unlimited" style={inputStyle} />
                      </Field>
                    </div>

                    {/* Checkbox settings */}
                    <div style={{ display: 'flex', gap: 20, marginBottom: 20, flexWrap: 'wrap', padding: '12px 16px', background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: T.radiusSm }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.text700, cursor: 'pointer', fontWeight: 600 }}>
                        <input type="checkbox" checked={currentTier.recommended === true} onChange={e => handleTierChange(selectedTierIdx, 'recommended', e.target.checked)} />
                        <Icon name="star" size={13} strokeWidth={1.6} /> Most Popular
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.text700, cursor: 'pointer', fontWeight: 600 }}>
                        <input type="checkbox" checked={currentTier.is_custom === true} onChange={e => handleTierChange(selectedTierIdx, 'is_custom', e.target.checked)} />
                        <Icon name="creditCard" size={13} strokeWidth={1.6} /> Contact Sales / Custom Price
                      </label>
                      {/* One outcome, two switches — this and the "Remove Fancy
                          watermark" entry in the feature list below. Either grants
                          it (tierRemovesWatermark), and the title says so, because
                          an admin who ticks only the other one and sees the mark
                          ship anyway has no way to work out why. */}
                      <label
                        title="Same setting as 'Remove Fancy watermark' in the plan features below — either one drops the mark from guest pages."
                        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.text700, cursor: 'pointer', fontWeight: 600 }}
                      >
                        <input type="checkbox" checked={currentTier.remove_watermark === true} onChange={e => handleTierChange(selectedTierIdx, 'remove_watermark', e.target.checked)} />
                        <Icon name="ban" size={13} strokeWidth={1.6} /> Remove Watermark
                      </label>
                    </div>

                    {/* Features checklist dropdowns */}
                    <FeatureSelector
                      tierFeatures={currentTier.features}
                      registry={featureRegistry}
                      onChange={(features) => handleTierChange(selectedTierIdx, 'features', features)}
                    />
                  </div>
                ) : (
                  <p style={{ fontSize: 12, color: T.text500, fontStyle: 'italic' }}>No tiers configured.</p>
                )}
              </motion.div>
            )}

            {/* TAB 3: Offline Payment Methods */}
            {activeTab === 'payments' && (
              <motion.div
                key="payments"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                style={{ ...card, padding: 28 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${T.border}`, paddingBottom: 12, marginBottom: 20 }}>
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 800, color: T.text900, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>Offline Payment Methods</h3>
                    <p style={{ fontSize: 12, color: T.text500, margin: '4px 0 0' }}>These methods are displayed to organizers who choose the cash/manual payout options at checkout.</p>
                  </div>
                  <Button type="button" variant="ghost" onClick={addMethod}>+ Add Method</Button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <AnimatePresence mode="popLayout">
                    {manualMethods.length ? manualMethods.map((m, idx) => (
                      <motion.div
                        key={idx}
                        layout
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        style={{
                          padding: 20,
                          background: T.surfaceAlt,
                          border: `1px solid ${T.border}`,
                          borderRadius: T.radiusSm,
                          opacity: m.is_active === false ? 0.6 : 1,
                        }}
                      >
                        <div className="cfg-responsive-grid" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr auto', gap: 12, alignItems: 'end', marginBottom: 12 }}>
                          <Field label="Label (e.g. Bank Transfer — CIB)">
                            <input value={m.label} onChange={e => updateMethod(idx, 'label', e.target.value)} style={inputStyle} />
                          </Field>
                          <Field label="Type">
                            <select value={m.type} onChange={e => updateMethod(idx, 'type', e.target.value)}
                              style={{ ...inputStyle, cursor: 'pointer' }}>
                              {['bank', 'wallet', 'instapay', 'cash', 'paypal', 'other'].map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                            </select>
                          </Field>
                          <Button type="button" variant="danger" onClick={() => removeMethod(idx)}>✕</Button>
                        </div>
                        
                        <div style={{ marginBottom: 12 }}>
                          <Field label="Account / Coordinate details">
                            <input value={m.details} onChange={e => updateMethod(idx, 'details', e.target.value)} style={inputStyle} />
                          </Field>
                        </div>

                        <div style={{ marginBottom: 12 }}>
                          <Field label="Instructions to Payer">
                            <textarea value={m.instructions} onChange={e => updateMethod(idx, 'instructions', e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
                          </Field>
                        </div>

                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.text700, cursor: 'pointer', fontWeight: 600 }}>
                          <input type="checkbox" checked={m.is_active !== false} onChange={e => updateMethod(idx, 'is_active', e.target.checked)} />
                          Active (visible to organizers during checkout)
                        </label>
                      </motion.div>
                    )) : (
                      <p style={{ fontSize: 13, color: T.text500, fontStyle: 'italic', textAlign: 'center', padding: '24px 0' }}>No offline payment methods configured. Click Add Method to create one.</p>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}

            {/* TAB 4: Landing Page Stats */}
            {activeTab === 'stats' && (
              <motion.div
                key="stats"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                style={{ ...card, padding: 28 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${T.border}`, paddingBottom: 12, marginBottom: 20 }}>
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 800, color: T.text900, textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>Landing Page Social-Proof Statistics</h3>
                    <p style={{ fontSize: 12, color: T.text500, margin: '4px 0 0' }}>Configure the animated counter stats displayed on the public landing page.</p>
                  </div>
                  <Button type="button" variant="ghost" onClick={addStat}>+ Add Stat</Button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <AnimatePresence mode="popLayout">
                    {landingStats.length ? landingStats.map((s, idx) => (
                      <motion.div
                        key={idx}
                        layout
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        style={{
                          padding: 18,
                          background: T.surfaceAlt,
                          border: `1px solid ${T.border}`,
                          borderRadius: T.radiusSm,
                        }}
                      >
                        <div className="cfg-responsive-grid" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 0.7fr 0.7fr auto', gap: 12, alignItems: 'end' }}>
                          <Field label="Label">
                            <input value={s.label} onChange={e => updateStat(idx, 'label', e.target.value)} style={inputStyle} />
                          </Field>
                          <Field label={s.source === 'events_count' || s.source === 'guests_count' ? 'Value (live count)' : 'Value'}>
                            {s.source === 'events_count' || s.source === 'guests_count' ? (
                              <input
                                type="text"
                                value={s.source === 'events_count' ? 'Live events count' : 'Live guests count'}
                                disabled
                                title="This number is computed from real platform data at request time, not admin-set."
                                style={{ ...inputStyle, color: T.text500, fontStyle: 'italic', cursor: 'not-allowed' }}
                              />
                            ) : (
                              <input type="number" step="any" value={s.target} onChange={e => updateStat(idx, 'target', e.target.value)} style={inputStyle} />
                            )}
                          </Field>
                          <Field label="Suffix (e.g. + or %)">
                            <input value={s.suffix} onChange={e => updateStat(idx, 'suffix', e.target.value)} style={inputStyle} />
                          </Field>
                          <Field label="Decimal places">
                            <input type="number" min="0" max="2" value={s.decimals} onChange={e => updateStat(idx, 'decimals', e.target.value)} style={inputStyle} />
                          </Field>
                          <Button type="button" variant="danger" onClick={() => removeStat(idx)}>✕</Button>
                        </div>
                      </motion.div>
                    )) : (
                      <p style={{ fontSize: 13, color: T.text500, fontStyle: 'italic', textAlign: 'center', padding: '24px 0' }}>No stat counters configured. Click Add Stat to create one.</p>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Global Save Controls Container */}
        <div style={{
          position: 'sticky',
          // MOB-9: matches the site's established bottom-safe-area convention
          // (globals.css .floating-cta/.guest-sticky-footer) so this sticky
          // bar doesn't sit flush against the iOS home-indicator.
          bottom: 'max(24px, calc(env(safe-area-inset-bottom) + 12px))',
          background: 'var(--admin-surface, #FFFFFF)',
          border: `1px solid var(--admin-border, #E8E2D6)`,
          borderRadius: '16px',
          boxShadow: '0 16px 36px rgba(0, 0, 0, 0.15), 0 2px 8px rgba(0, 0, 0, 0.05)',
          padding: '14px 24px',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          marginTop: 40,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--admin-text-900, #191B1E)', fontFamily: 'var(--font-sans)' }}>
              System Configuration
            </span>
            <span style={{ fontSize: 11, color: 'var(--admin-text-500, #77736A)', fontFamily: 'var(--font-sans)' }}>
              Click save to apply modifications platform-wide.
            </span>
          </div>
          <Button type="submit" variant="primary" disabled={saving} style={{ padding: '10px 24px', fontSize: 13, fontWeight: 700, borderRadius: '8px' }}>
            {saving ? 'Saving...' : 'Save Configuration'}
          </Button>
        </div>

        {/* `global` is load-bearing, not cosmetic: the OUTER tiers grid
            (200px list + 1fr editor) lives on a <motion.div>, and styled-jsx does
            not reliably stamp its scoping class onto custom components — only onto
            plain DOM elements. Scoped, the rule silently missed that one grid, so
            the tiers editor kept its 200px sidebar on a phone and the actual
            editing column collapsed to ~120px. A global rule applies regardless of
            element type; the cfg- prefix keeps it from colliding with anything. */}
        <style jsx global>{`
          /* MOB-9: every fixed multi-column field grid on this page (tiers
             split, tier fields, offline-payment rows, landing-stat rows —
             the last one 5 columns wide) had no breakpoint at all, making the
             pricing/tiers editor genuinely unusable below ~600px. */
          @media (max-width: 639.98px) {
            .cfg-responsive-grid { grid-template-columns: 1fr !important; }
            /* Title + "Delete Tier" was a no-wrap space-between row. */
            .cfg-tier-head { flex-wrap: wrap; gap: 12px; }
            .cfg-tier-card { padding: 18px !important; }
          }
        `}</style>
      </form>
    </div>
  );
}


const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  border: `1px solid ${T.border}`,
  borderRadius: T.radiusSm,
  fontSize: 13,
  background: T.surface,
  color: T.text900,
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 0.2s',
};
