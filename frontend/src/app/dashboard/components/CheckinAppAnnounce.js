'use client';

import React, { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePublicPricing } from '../../utils/usePublicPricing';
import {
  CHECKIN_APK_URL,
  CHECKIN_APK_SIZE_LABEL,
  CHECKIN_MIN_ANDROID,
  CHECKIN_SCREENS,
} from '../../utils/checkinApp';

/* ═══════════════════════════════════════════════════════════════════════════
   FANCY CHECK-IN — the announcement.

   ── The gap this fills ───────────────────────────────────────────────────

   The app had two surfaces inside the product and an organizer could easily
   meet neither:

     · CheckinAppDownload, the real download, lives on /dashboard/checkin-setup
       — a page you have to already know exists to navigate to;
     · CheckInBanner, on the overview, appears ONLY inside 72 hours of an event
       (hasImminentEvent), and its app link goes to the public marketing page
       rather than to the file.

   So the one thing that keeps working in a ballroom with no signal was
   announced to the people who need it three days before they need it, and
   then only as a link to a brochure. This card is the announcement: it sits on
   the overview outside that window, shows the app rather than describing it,
   and hands over the download.

   ── Three things it refuses to do ────────────────────────────────────────

   1. NAME A PLAN. Which tiers include the app is read live from the pricing
      config, the same way CheckinAppDownload does it. An admin can move the
      feature between tiers in one click, and a hardcoded "Enterprise and
      above" would go on claiming the old arrangement forever.

   2. NAG. It is dismissible and stays dismissed. An announcement that cannot
      be closed is an advertisement, and this one sits on the screen an
      organizer opens every day.

   3. PROMISE A VERSION. checkinApp.js explains why no version string is
      published from this repository — what we would build is not necessarily
      what the web root is serving.

   ── Which download ───────────────────────────────────────────────────────

   The PUBLIC apk (checkinApp.js), not the event-scoped signed URL. This card
   has no event in scope, and the public file is safe to hand anyone: the app
   is inert until it is paired, and pairing goes through
   requireFeature('checkin_app') on the backend. The entitlement lives at the
   door, not at the download — which is also why an organizer whose plan does
   not include it is shown the plans rather than a broken button.
   ═══════════════════════════════════════════════════════════════════════════ */

const C = {
  ink: '#191B1E',
  inkLift: '#22252A',
  gold: '#B8944F',
  goldSoft: '#D7BE80',
  ivory: '#F8F4EC',
  onDark: 'rgba(248,244,236,0.66)',
  onDarkMuted: 'rgba(248,244,236,0.44)',
  hairline: 'rgba(248,244,236,0.14)',
};

/* The registry label, verbatim — the public pricing endpoint renders tier
   features by label, so this is how a tier is recognised as including the app.
   Matching on the key would find nothing: keys never reach the client. */
const FEATURE_LABEL = 'Fancy Check-in app (offline door scanner)';

const DISMISS_KEY = 'fancy.checkinAppAnnounce.dismissed';

/* ── The dismissal, read as what it is: a value that lives outside React ──
   This used to be `useState(true)` plus an effect that read localStorage on
   mount, with the initial `true` standing in for "assume hidden until we have
   looked" — a duplicate of the stored value, and a comment explaining why the
   duplicate starts out lying. `useSyncExternalStore` states the same contract
   in code: the server (and the hydrating client) get `true`, so the markup
   matches and nothing flashes; the browser gets the real answer. */
const dismissListeners = new Set();
const subscribeDismissed = (fn) => { dismissListeners.add(fn); return () => dismissListeners.delete(fn); };

/* Closed for this page-load even where we could not write it down. Without
   this, an organizer in a private window would click the X and watch the card
   stay exactly where it was — the write throws, and the store would keep
   answering "not dismissed". */
let dismissedThisLoad = false;

const readDismissed = () => {
  if (dismissedThisLoad) return true;
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    // Private mode, or storage disabled. Showing it is the safe default: the
    // cost is a card somebody closes again, not a broken dashboard.
    return false;
  }
};

/** What the app does, in the three sentences that actually sell it. */
const POINTS = [
  {
    title: 'Works with no signal',
    body: 'The whole guest list lives on the tablet, so it keeps scanning through a venue\'s dead spots and syncs when it reconnects.',
  },
  {
    title: 'The table number, large',
    body: 'A scan answers the only question anyone asks at a door — where do I sit — without the person on the door reading a list.',
  },
  {
    title: 'Meals and access notes',
    body: 'Party size, meal choices and anything you flagged come up with the name, so the room is ready before they reach it.',
  },
];

export default function CheckinAppAnnounce() {
  // `true` on the server and during hydration: hidden is the state whose
  // markup is safe to be wrong about for one frame.
  const dismissed = useSyncExternalStore(subscribeDismissed, readDismissed, () => true);
  const { tiers } = usePublicPricing();

  const close = () => {
    dismissedThisLoad = true;
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Nothing to do — it will be back next visit, which is survivable.
    }
    dismissListeners.forEach((fn) => fn());
  };

  if (dismissed) return null;

  const includedIn = (tiers || [])
    .filter((t) => (t.features || []).includes(FEATURE_LABEL))
    .map((t) => t.name);

  const shot = CHECKIN_SCREENS[0];

  return (
    <section className="caa ov-section" aria-labelledby="caa-title">
      <button type="button" className="caa-close" onClick={close} aria-label="Dismiss">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <div className="caa-copy">
        <span className="caa-kicker">
          Fancy Check-in
          <span aria-hidden="true" className="caa-rule" />
        </span>

        <h2 id="caa-title" className="caa-title">The door, running on a tablet.</h2>

        <p className="caa-lead">
          Turn any Android tablet into the entrance: scan a guest&rsquo;s pass and
          their table, party and meal come up instantly — with no internet at the
          venue at all.
        </p>

        <ul className="caa-points">
          {POINTS.map((p) => (
            <li key={p.title}>
              <span className="caa-point-title">{p.title}</span>
              <span className="caa-point-body">{p.body}</span>
            </li>
          ))}
        </ul>

        <div className="caa-actions">
          <a className="caa-btn caa-btn--gold" href={CHECKIN_APK_URL} download>
            Download for Android
          </a>
          <Link className="caa-btn caa-btn--ghost" href="/checkin-app">
            See how it works
          </Link>
        </div>

        <p className="caa-fine">
          {CHECKIN_APK_SIZE_LABEL} &middot; {CHECKIN_MIN_ANDROID}
          {includedIn.length > 0 && (
            <>
              {' '}&middot; Pairing a tablet needs {includedIn.join(' or ')}
              {' '}
              <Link href="/pricing" className="caa-fine-link">See plans</Link>
            </>
          )}
        </p>
      </div>

      {/* THE APP, not a drawing of it. This is the real scan-result screen,
          produced by the screenshot pipeline, so a redesign of the app cannot
          leave a stale picture selling it. */}
      <figure className="caa-art">
        <div className="caa-tablet">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shot.src} alt={shot.alt} width={1400} height={875} loading="lazy" />
        </div>
        <figcaption>{shot.caption}</figcaption>
      </figure>

      {/* A plain <style>, not styled-jsx: this component is nested and
          styled-jsx does not reliably compile in that position in this build,
          and its hash never lands on a next/link. Classes are prefixed "caa-".

          No backticks inside these CSS comments — one would terminate the
          template literal and produce a parse error. */}
      <style>{`
        .caa {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 26px;
          background: linear-gradient(135deg, ${C.ink} 0%, ${C.inkLift} 100%);
          border-radius: 18px;
          padding: 26px 22px 28px;
          box-shadow: 0 8px 32px rgba(25,27,30,0.18);
          overflow: hidden;
        }
        .caa-close {
          position: absolute;
          top: 12px;
          inset-inline-end: 12px;
          z-index: 2;
          display: flex;
          align-items: center;
          justify-content: center;
          /* 36px, not 24: this is the only control on the card a person
             presses by accident if it is small, and missing it means the
             announcement never goes away. */
          width: 36px;
          height: 36px;
          border-radius: 50%;
          border: 1px solid ${C.hairline};
          background: transparent;
          color: ${C.onDarkMuted};
          cursor: pointer;
          transition: color .25s ease, border-color .25s ease;
        }
        .caa-close:hover { color: ${C.ivory}; border-color: ${C.goldSoft}; }

        .caa-kicker {
          display: inline-flex;
          align-items: center;
          gap: 11px;
          font-family: var(--font-sans);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: ${C.goldSoft};
          white-space: nowrap;
        }
        .caa-rule {
          display: block;
          flex: none;
          width: 26px;
          height: 1px;
          background: ${C.gold};
          opacity: 0.6;
        }
        .caa-title {
          font-family: var(--font-cormorant), Georgia, serif;
          font-weight: 300;
          font-size: 30px;
          line-height: 1.1;
          letter-spacing: -0.015em;
          color: ${C.ivory};
          margin: 14px 0 0;
        }
        .caa-lead {
          font-family: var(--font-sans);
          font-size: 13.5px;
          font-weight: 300;
          line-height: 1.75;
          color: ${C.onDark};
          margin: 10px 0 0;
          max-width: 52ch;
        }

        .caa-points {
          list-style: none;
          margin: 20px 0 0;
          padding: 0;
          display: grid;
          gap: 14px;
        }
        .caa-points li {
          padding-top: 13px;
          border-top: 1px solid ${C.hairline};
          min-width: 0;
        }
        .caa-point-title {
          display: block;
          font-family: var(--font-sans);
          font-size: 12.5px;
          font-weight: 700;
          color: ${C.ivory};
        }
        .caa-point-body {
          display: block;
          margin-top: 5px;
          font-family: var(--font-sans);
          font-size: 12px;
          font-weight: 300;
          line-height: 1.7;
          color: ${C.onDarkMuted};
        }

        .caa-actions {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 22px;
        }
        .caa-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          /* 48px: a download button people press on a phone. */
          min-height: 48px;
          padding: 0 22px;
          font-family: var(--font-sans);
          font-size: 11.5px;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          white-space: nowrap;
          text-decoration: none;
          border-radius: 10px;
          transition: background .3s ease, color .3s ease, border-color .3s ease;
        }
        .caa-btn--gold {
          background: linear-gradient(135deg, ${C.goldSoft}, ${C.gold});
          color: ${C.ink};
          border: 1px solid transparent;
        }
        .caa-btn--gold:hover { filter: brightness(1.06); }
        .caa-btn--ghost {
          background: transparent;
          color: ${C.ivory};
          border: 1px solid ${C.hairline};
        }
        .caa-btn--ghost:hover { border-color: ${C.goldSoft}; color: ${C.goldSoft}; }

        .caa-fine {
          font-family: var(--font-sans);
          font-size: 11px;
          line-height: 1.7;
          color: ${C.onDarkMuted};
          margin: 14px 0 0;
        }
        .caa-fine-link { color: ${C.goldSoft}; text-decoration: none; white-space: nowrap; }
        .caa-fine-link:hover { text-decoration: underline; }

        .caa-art { margin: 0; }
        .caa-tablet {
          border-radius: 14px;
          padding: 9px;
          background: linear-gradient(155deg, #45464C, #1D1D20 55%, #0B0B0C);
          box-shadow: 0 26px 60px -28px rgba(0,0,0,0.9), 0 0 0 1px rgba(248,244,236,0.06);
        }
        .caa-tablet img {
          display: block;
          width: 100%;
          height: auto;
          border-radius: 7px;
        }
        .caa-art figcaption {
          margin-top: 12px;
          text-align: center;
          font-family: var(--font-sans);
          font-size: 10px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: ${C.onDarkMuted};
        }

        @media (min-width: 768px) {
          .caa {
            display: grid;
            grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
            align-items: center;
            gap: 44px;
            padding: 34px 36px;
          }
          .caa-title { font-size: 38px; margin-top: 16px; }
          .caa-lead { font-size: 14.5px; margin-top: 12px; }
          .caa-points { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
          .caa-actions { flex-direction: row; margin-top: 26px; }
          .caa-tablet { border-radius: 18px; padding: 12px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .caa-close, .caa-btn { transition: none; }
        }
      `}</style>
    </section>
  );
}
