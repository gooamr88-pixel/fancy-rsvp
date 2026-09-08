'use client';

import React, { useState } from 'react';
import Icon from '../../../components/icons/Icon';

const C = {
  gold: '#B8944F', charcoal: '#191B1E', stone: '#77736A',
  border: '#E8E2D6', white: '#FFFFFF', error: '#C45E5E',
};

/* ═══════════════════════════════════════════════════════════════════════════
   START THE FREE TRIAL — the third way to publish, above the plans.

   ── Why it sits ABOVE the price list and not beside it ───────────────────

   The person on this screen has just built an invitation and is being asked
   to pay for something they have never seen working. Every plan below is an
   answer to "how much"; this is an answer to "can I be sure first", which is
   the question actually stopping them. Putting it after the prices would make
   it a consolation for people who found the plans too expensive. Before them,
   it is the recommended path.

   ── What it says, and why it says the ending first ───────────────────────

   The three lines are ordered by what a cautious person needs to hear:
   everything is included, no card is taken, and — the one that decides it —
   the invitation does not stop working when the trial ends. That last line is
   TRUE (services/trialService.js's landing update touches neither `is_paid`
   nor `status`), and it is the difference between a trial that reads as an
   offer and one that reads as a countdown to a hostage situation. A host
   choosing a wedding platform is not worried about losing features; they are
   worried about their guests hitting a dead link.

   The guest cap is stated plainly rather than buried. Somebody who needs 200
   guests should find that out here, in one line, not on the day they import
   their list.

   This component never talks to the API — the wizard owns that, exactly as it
   does for the Stripe, manual and promo-code paths, so all four update
   isPaid/currentTierName through the same handler.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function TrialCard({ onStartTrial, processing, days = 7, maxGuests = 25 }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const start = async () => {
    if (busy || processing) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onStartTrial();
      if (!result?.ok) setError(result?.message || 'Could not start your free trial. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const point = (icon, text) => (
    /* A GRID, not a flex row, and both halves of that matter.

       Flex wraps an item onto a new line when its hypothetical size — the
       max-content width, with `flex-basis: auto` — exceeds the line, and only
       shrinks it afterwards. So the longest bullet dropped below its own icon.
       The fix within flex is `flex: 1 1 0`, which is the one value jsdom
       silently drops from an inline style object: the shots harness would then
       photograph the BROKEN layout and report it fixed.

       `auto 1fr` has neither problem. The icon takes what it needs, the text
       column takes the rest and wraps inside itself, and nothing can ever
       break onto a second row. It is also not the fixed-column grid the
       responsive checker warns about — that is `repeat(N, 1fr)` on cards,
       where every track has a min-content floor. A 1fr text track shrinks to
       nothing. */
    <li style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 9, alignItems: 'start' }}>
      <span style={{ marginTop: 1 }}>
        <Icon name={icon} size={14} color={C.gold} strokeWidth={1.9} />
      </span>
      {/* flex + minWidth:0 so a long line SHRINKS beside its icon instead of
          wrapping underneath it. The row carries flexWrap (mobileFit's ratchet
          requires every gap row to be breakable), and without this the third
          bullet — the longest — broke onto its own line and left the icon
          stranded above it. `1 1 auto`, never `1 1 0`: jsdom drops a unitless
          flex-basis from an inline style object, so the shots harness would
          photograph the unfixed layout and report it as fixed. */}
      <span style={{ minWidth: 0, fontFamily: 'var(--font-sans)', fontSize: 13, lineHeight: 1.55, color: C.charcoal }}>{text}</span>
    </li>
  );

  return (
    <div
      style={{
        background: 'linear-gradient(160deg, #FFFEFC 0%, #FBF6EA 100%)',
        border: `1.5px solid ${C.gold}`,
        borderRadius: 18,
        padding: 22,
        marginBottom: 26,
        boxShadow: '0 4px 22px rgba(184, 148, 79, 0.12)',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 11, marginBottom: 14 }}>
        <span style={{
          width: 38, height: 38, borderRadius: 11, flexShrink: 0,
          background: 'rgba(184, 148, 79, 0.14)',
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="sparkle" size={18} color={C.gold} strokeWidth={1.6} />
        </span>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 16, fontWeight: 600, letterSpacing: '0.01em', color: C.charcoal, margin: 0 }}>
            Try it free for {days} days
          </h3>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 12.5, color: C.stone, margin: '2px 0 0', lineHeight: 1.5 }}>
            Publishes your event now. No card, no review wait.
          </p>
        </div>
      </div>

      <ul style={{ listStyle: 'none', margin: '0 0 18px', padding: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
        {/* NAMES what it includes rather than claiming "every feature", which
            stopped being true when white-labelling was excluded from trials.
            "Your own colours and fonts" is `custom_branding` and is genuinely
            included; removing the Fancy mark entirely is not, and a bullet
            saying "your own branding" would be read as exactly that. */}
        {point('check', 'Seating, analytics, check-in, your own colours and fonts — all switched on.')}
        {point('guests', `Up to ${maxGuests} guests while you are trying it out.`)}
        {/* THE LINE THAT SELLS IT. Stated before the ask, because it is the
            objection, and it is true. */}
        {point('dove', 'When the trial ends your invitation stays live and your guests can still reply — you only lose the extra tools until you pick a plan.')}
      </ul>

      {error && (
        <p role="alert" style={{
          fontFamily: 'var(--font-sans)', fontSize: 12.5, lineHeight: 1.55, color: C.error,
          background: 'rgba(196, 94, 94, 0.07)', border: '1px solid rgba(196, 94, 94, 0.28)',
          borderRadius: 10, padding: '10px 12px', margin: '0 0 14px',
        }}>
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={start}
        disabled={busy || processing}
        style={{
          width: '100%',
          minHeight: 'var(--fx-touch)',
          padding: '14px 20px',
          borderRadius: 12,
          border: 'none',
          background: busy || processing ? 'rgba(184, 148, 79, 0.5)' : `linear-gradient(135deg, #D7BE80 0%, ${C.gold} 100%)`,
          color: C.white,
          fontFamily: 'var(--font-sans)',
          fontSize: 14.5,
          fontWeight: 700,
          letterSpacing: '0.01em',
          cursor: busy || processing ? 'not-allowed' : 'pointer',
        }}
      >
        {busy ? 'Starting your trial…' : `Start my ${days} free days`}
      </button>

      <p style={{
        fontFamily: 'var(--font-sans)', fontSize: 11.5, lineHeight: 1.55,
        color: C.stone, margin: '11px 0 0', textAlign: 'center',
      }}>
        One trial per account · Text messages and white-labelling are paid extras
      </p>
    </div>
  );
}
