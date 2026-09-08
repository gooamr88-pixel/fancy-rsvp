'use client';

import React from 'react';
import Link from 'next/link';
import { useFullPageTheme } from '../../components/templates/heritageArch/theme';
import { alpha } from '../../utils/color';

/* ═══════════════════════════════════════════════════════════════════════════
   THE TURN — from guest to host.

   This replaces "Create your own event" at the foot of the RSVP confirmation
   for the demo only. A real guest still gets the real block.

   ── WHY IT IS NOT A SIGNUP BUTTON ────────────────────────────────────────

   The visitor has just answered an invitation. What they are curious about
   at that exact second is not a price — it is what just happened to the
   answer they gave. "Where did that go?" is the question the product can
   answer better than any pricing page can, and answering it is what earns
   the signup two screens later.

   ── WHY IT TAKES THE INVITATION'S COLOUR AND NOT THE BRAND'S ─────────────

   It renders inside somebody's wedding, which is the same constraint
   CreateYourOwnEvent is built around: an element in Fancy gold sitting at
   the bottom of a burgundy invitation reads as an advertisement pasted onto
   it. `useFullPageTheme` is read positionally — this element is CREATED in
   the demo page, outside the provider, but RENDERED inside RsvpSection's
   subtree, and React context resolves by position in the tree rather than by
   where the element was written. So it wears whatever palette the visitor
   just picked in stage 3.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function DemoHandoff() {
  const C = useFullPageTheme();

  return (
    <aside
      style={{
        marginTop: 26,
        padding: '1.25px',
        borderRadius: '19px',
        background: `linear-gradient(140deg, ${alpha(C.gold, 0.55)}, ${alpha(C.maroon, 0.35)} 55%, ${alpha(C.gold, 0.45)})`,
      }}
    >
      <div
        style={{
          background: C.cream,
          borderRadius: '18px',
          padding: '22px 20px',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '10.5px',
            fontWeight: 800,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: C.maroon,
            opacity: 0.9,
          }}
        >
          That was the guest&rsquo;s half
        </span>

        <p
          style={{
            margin: 0,
            fontFamily: 'var(--font-serif)',
            fontSize: '21px',
            lineHeight: 1.3,
            color: C.ink,
          }}
        >
          Your reply just landed on somebody&rsquo;s guest list.
        </p>

        <p
          style={{
            margin: 0,
            fontFamily: 'var(--font-sans)',
            fontSize: '13px',
            lineHeight: 1.7,
            color: C.ink,
            opacity: 0.72,
            maxWidth: '34ch',
          }}
        >
          Meals counted, a seat to find, a pass to scan at the door. Here is the
          side of it the host sees.
        </p>

        <Link
          href="/demo/dashboard"
          style={{
            marginTop: '6px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '9px',
            minHeight: '50px',
            padding: '0 26px',
            background: C.solidFill,
            color: C.cream,
            borderRadius: '13px',
            textDecoration: 'none',
            fontFamily: 'var(--font-sans)',
            fontSize: '11.5px',
            fontWeight: 700,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}
        >
          See what the organizer sees
          <span aria-hidden="true">&rarr;</span>
        </Link>
      </div>
    </aside>
  );
}
