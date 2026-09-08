'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Icon from '../../components/icons/Icon';

const C = {
  gold: '#B8944F', charcoal: '#191B1E', stone: '#77736A',
  border: '#E8E2D6', white: '#FFFFFF', ivory: '#F8F4EC',
};

const DAY_MS = 24 * 60 * 60 * 1000;

/* ═══════════════════════════════════════════════════════════════════════════
   WHERE THE ORGANIZER STANDS.

   Two states, and the second one is the reason this component exists.

   ── Counting DOWN ────────────────────────────────────────────────────────

   Plain, quiet, one line. It is not a nag: somebody who started a trial an
   hour ago does not need to be sold to, and a countdown that shouts from day
   one is the fastest way to make a product feel like a trap. It gets more
   prominent in the last two days, which is also when the email goes out.

   ── After it has ENDED ───────────────────────────────────────────────────

   This is the moment the product is most likely to be misread. The organizer
   opens their dashboard, finds padlocks where seating used to be, and their
   first thought is that their event has broken — with a wedding on the way
   and guests already invited, that is a genuinely frightening five minutes.

   So the ended state LEADS with what still works and only then names what is
   locked. Both halves are true: the sweep touches neither `is_paid` nor
   `status`, so the invitation is live and guests are still replying; and
   nothing was deleted, so the seating chart they built is sitting there
   waiting rather than gone.

   A dead-honest inventory is also the better sales pitch. "Your seating chart
   is still there, pick a plan to open it" converts; "upgrade to continue"
   reads as a shakedown for something they suspect they have already lost.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @param {object}  event      the active event, as the dashboard already holds it
 * @param {string}  upgradeHref where "choose a plan" goes
 */
export default function TrialBanner({ event, upgradeHref }) {
  /* Read ONCE, in a lazy initializer, rather than from the render body.

     `Date.now()` during render is impure — the React Compiler rejects it,
     correctly: a component that reads the clock while rendering produces a
     different result every time React happens to re-render it, which is not
     something a caller can reason about. A lazy useState initializer runs
     exactly once per mount and is the pattern this dashboard already uses for
     a clock (see OrganizerProfile).

     It deliberately does NOT tick. This says "3 days left"; a countdown that
     re-rendered every second to change nothing visible would cost more than
     the accuracy it buys, and the day it does change the organizer has almost
     certainly reloaded the page. */
  const [now] = useState(() => Date.now());

  const endsAt = event?.trial_ends_at;
  if (!endsAt) return null;

  const msLeft = new Date(endsAt).getTime() - now;
  if (!Number.isFinite(msLeft)) return null;

  /* WHETHER THE TRIAL HAS ENDED IS THE SERVER'S CALL, NOT THE CLOCK'S.
     `trial_expired` is set by withResolvedTier only when entitlement actually
     resolved to the landing plan. The clock alone is not the same question,
     and getting them confused is a real defect: an organizer who UPGRADES on
     day 3 keeps `trial_ends_at` — payment rewrites the plan, not the trial
     columns — so from day 8 a clock-driven banner would tell a paying
     customer that their seating and analytics were locked, in the same
     dashboard where both plainly work. Nothing is more corrosive than a
     product contradicting itself about what somebody has paid for.

     A passed deadline with no flag means the server could not confirm the
     downgrade (its config read failed). Say nothing rather than guess: a
     wrong banner here is worse than no banner. */
  const ended = event?.trial_expired === true;
  if (!ended && msLeft <= 0) return null;
  // Ceil, not round: with 30 hours left a host has "2 days", and telling them
  // "1" the moment they cross 24h is the kind of small dishonesty that makes
  // people distrust the bigger numbers on the page.
  const daysLeft = Math.max(1, Math.ceil(msLeft / DAY_MS));
  const urgent = !ended && msLeft <= 2 * DAY_MS;

  const planName = event?.tier_name || 'the free plan';

  return (
    <div
      role={ended ? 'status' : undefined}
      className="trial-banner fx-row"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 14,
        padding: '14px 18px',
        marginBottom: 20,
        borderRadius: 14,
        background: ended
          ? C.white
          : (urgent ? 'linear-gradient(135deg, #FFFDF7 0%, #FBF1DC 100%)' : C.white),
        border: `1px solid ${ended || urgent ? C.gold : C.border}`,
        boxShadow: ended || urgent ? '0 2px 14px rgba(184, 148, 79, 0.10)' : 'none',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: 'rgba(184, 148, 79, 0.13)',
          // flexWrap even on a one-child centring box: mobileFit's ratchet
          // counts any gap/justify-content row that cannot break, and it is a
          // ratchet precisely so nobody has to judge which ones "obviously"
          // fit. Wrapping a single child is a no-op.
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Icon name={ended ? 'dove' : 'hourglass'} size={17} color={C.gold} strokeWidth={1.7} />
      </span>

      {/* min-width: 0 so this column can shrink instead of forcing the row
          wider than a phone. A flex child defaults to min-width: auto, which
          is its min-content width — and a sentence's min-content width is its
          longest word, but a BUTTON's is the whole label. */}
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        <p style={{
          margin: 0, fontFamily: 'var(--font-sans)', fontSize: 13.5,
          fontWeight: 700, color: C.charcoal, lineHeight: 1.45,
        }}>
          {ended
            ? 'Your free trial has ended — your invitation is still live'
            : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left on your free trial`}
        </p>
        <p style={{
          margin: '3px 0 0', fontFamily: 'var(--font-sans)', fontSize: 12.5,
          color: C.stone, lineHeight: 1.55,
        }}>
          {ended
            ? `Guests can still open your invitation and reply. You are on ${planName} now, so seating, the full analytics, exports and branding are locked — everything you built with them is still here and comes straight back.`
            /* NOT "every feature". That stopped being true when white-labelling
               was excluded from trials, and text messages have always been
               bought separately — the card on the payment step was corrected
               for exactly this and this line was missed. A banner an organizer
               reads every day is the worst place to keep a promise the product
               does not keep. */
            : 'Seating, analytics, check-in and your own branding are all switched on. Choose a plan any time — your event stays live either way.'}
        </p>
      </div>

      <Link
        href={upgradeHref}
        style={{
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 'var(--fx-touch)',
          padding: '10px 20px',
          borderRadius: 10,
          background: ended || urgent ? `linear-gradient(135deg, #D7BE80 0%, ${C.gold} 100%)` : 'transparent',
          border: ended || urgent ? 'none' : `1px solid ${C.border}`,
          color: ended || urgent ? C.white : C.charcoal,
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          fontWeight: 700,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        Choose a plan
      </Link>
    </div>
  );
}
