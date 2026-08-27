'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../utils/apiClient';
import { usePublicPricing } from '../../utils/usePublicPricing';
import {
  CHECKIN_APK_URL, CHECKIN_APK_SIZE_LABEL, CHECKIN_MIN_ANDROID, CHECKIN_SCREENS,
  CHECKIN_APP_FEATURE_LABEL as FEATURE_LABEL,
} from '../../utils/checkinApp';

const C = {
  gold: '#B8944F', charcoal: '#191B1E', ivory: '#F8F4EC', stone: '#77736A',
  border: '#E8E2D6', white: '#FFFFFF', softBg: '#FAFAF8', success: '#2E7D5B',
};

// FEATURE_LABEL is the registry label, imported above — DeviceManagement needs
// the same string to name the plans that carry the app, and two hand-typed
// copies of it is one typo away from telling a paying customer they are not
// entitled.

const formatSize = (bytes) => (bytes > 0 ? `${(bytes / 1024 / 1024).toFixed(0)} MB` : null);

/**
 * "Get the app" — the first thing an organizer needs and the one thing the
 * check-in setup page never mentioned.
 *
 * The page used to open on "Tablets → Create pairing code": a code for an app
 * with no download link anywhere in the product. This closes that gap, and it
 * answers two questions depending on who is looking:
 *
 *   not entitled  → what it is, and which plans include it
 *   entitled      → the announcement, the file, how to verify it, how to
 *                   install it
 *
 * There was a third state — "not released yet, we will email you" — and it is
 * gone. See the note above the AvailableState return for why: it contradicted
 * the rest of the product, and neither half of what it promised existed.
 *
 * Which plans include it is read from the LIVE pricing config rather than
 * written here. A hardcoded "Enterprise and above" is a promise this file
 * cannot keep — the admin can move the feature between tiers in one click, and
 * the sentence would go on claiming the old arrangement.
 */
export default function CheckinAppDownload({ eventId }) {
  const [state, setState] = useState({ phase: 'loading', release: null });
  const { tiers } = usePublicPricing();

  useEffect(() => {
    if (!eventId) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const res = await apiFetch(`/events/${eventId}/checkin-app/release`);
        if (!cancelled) setState({ phase: 'ok', release: res?.data || null });
      } catch (err) {
        if (cancelled) return;
        // A feature-gate denial is not an error to apologise for — it is the
        // upsell. Matched on the code rather than the message: featureGate.js
        // returns FEATURE_REQUIRES_PAYMENT for an unpaid event and
        // FEATURE_NOT_AVAILABLE when the tier simply doesn't carry it, both 403.
        // Anything else genuinely failed and should say so.
        // `err.code` is apiClient's own passthrough of the API's `error` field,
        // added for precisely this ("a feature-gated 403 wants an upgrade
        // prompt, not the raw sentence the API returned").
        const locked = err?.code === 'FEATURE_REQUIRES_PAYMENT'
          || err?.code === 'FEATURE_NOT_AVAILABLE';
        setState({ phase: locked ? 'locked' : 'error', release: null });
      }
    })();

    return () => { cancelled = true; };
  }, [eventId]);

  const includedIn = (tiers || [])
    .filter((t) => (t.features || []).includes(FEATURE_LABEL))
    .map((t) => t.name);

  if (state.phase === 'loading') {
    return <Shell><p style={{ margin: 0, color: C.stone, fontSize: '15px' }}>Checking your plan…</p></Shell>;
  }

  if (state.phase === 'error') {
    return (
      <Shell>
        <p style={{ margin: 0, color: C.stone, fontSize: '15px' }}>
          We couldn&apos;t check the app release just now. Refresh the page to try again.
        </p>
      </Shell>
    );
  }

  if (state.phase === 'locked') return <LockedState includedIn={includedIn} />;

  /**
   * THE APP IS OUT. There is no "coming soon" state any more.
   *
   * There used to be, and it was the product contradicting itself in two
   * places at once. This page told an entitled organizer "opening soon — we
   * will email you the moment it opens", while /checkin-app and the dashboard
   * announcement card both said "Now available" and linked a working APK. The
   * organizer most likely to be reading this — one who has already paid for a
   * plan that includes the door app and has reached the setup page — was the
   * only person in the product being told to wait.
   *
   * Both halves of that message were also untrue on their own terms. Nothing
   * anywhere sends a release email, so the promise had no implementation. And
   * the state was keyed on `platform_config.checkin_app.enabled`, which NO
   * admin screen writes — the only way to flip it is editing the config row by
   * hand in the database, which is why it never got flipped.
   *
   * So availability is no longer a question this component asks. What the
   * admin release record still decides is WHICH FILE it hands over:
   *
   *   configured  → the event-scoped endpoint, which 302s to a 120-second
   *                 signed Storage URL and writes an audit row
   *   otherwise   → the public APK the marketing site already serves
   *
   * The fallback is the honest one: that file is live, it is the same build,
   * and installing it grants nothing on its own — pairing is what is gated,
   * and pairing goes through requireFeature('checkin_app') on the backend.
   */
  const r = state.release || {};
  return <AvailableState release={r} eventId={eventId} includedIn={includedIn} />;
}

/* ── Shared frame ───────────────────────────────────────────────────────── */

function Shell({ children, accent = C.border }) {
  return (
    <div style={{
      background: C.white, border: `1px solid ${C.border}`, borderLeft: `4px solid ${accent}`,
      borderRadius: '14px', padding: '24px',
    }}>
      {children}
    </div>
  );
}

function Heading({ title, sub }) {
  return (
    <>
      <h3 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: '20px', fontWeight: 600, color: C.charcoal }}>
        {title}
      </h3>
      {sub && <p style={{ margin: '6px 0 0', fontSize: '15px', lineHeight: 1.65, color: C.stone }}>{sub}</p>}
    </>
  );
}

/* ── States ─────────────────────────────────────────────────────────────── */

function LockedState({ includedIn }) {
  return (
    <Shell accent={C.gold}>
      <Heading
        title="Fancy Check-in — the door app"
        sub="A dedicated Android app for the door. It holds your whole guest list on the tablet, so it keeps scanning and admitting guests with no internet at the venue — then syncs everything the moment it is back."
      />
      <p style={{ margin: '16px 0 0', fontSize: '15px', lineHeight: 1.65, color: C.charcoal }}>
        {includedIn.length > 0
          ? <>Included with <strong>{includedIn.join(', ')}</strong>.</>
          : <>Not included in this event&apos;s plan.</>}
      </p>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '18px' }}>
        <Link href="/pricing" style={btnPrimary}>See plans</Link>
        <Link href="/checkin-app" style={btnGhost}>How it works</Link>
      </div>
    </Shell>
  );
}

/**
 * The release announcement.
 *
 * Dark, and that is the one decision worth defending. Every other card on this
 * page sits on the dashboard's ivory ground — but the subject here is a
 * screenshot of a deep-green app, and a deep-green rectangle dropped onto
 * ivory reads as a hole punched in the page rather than as a product. Giving
 * it its own dark ground is what turns the screenshot into a product shot, and
 * it is the same device /checkin-app's hero uses, so an organizer who has seen
 * the marketing page meets a surface they recognise.
 *
 * The tablet bezel is drawn in CSS rather than shipped as an image: a bare
 * <img> reads as a screenshot, and the same picture inside a tilted device with
 * a real shadow under it reads as the thing you are about to hold at the door.
 * No new asset, nothing to re-export when the app's UI changes.
 */
function AvailableState({ release, eventId, includedIn }) {
  const size = formatSize(release.sizeBytes) || CHECKIN_APK_SIZE_LABEL;
  const minAndroid = release.minAndroid ? `Android ${release.minAndroid}+` : CHECKIN_MIN_ANDROID;

  /* The gated endpoint when an admin has published a release through it —
     that path signs a short-lived Storage URL and writes an audit row. The
     public APK otherwise, because it is live, it is the same build, and
     handing the organizer a working file beats handing them a wait. */
  const href = release.available
    ? `${process.env.NEXT_PUBLIC_API_URL || '/api/v1'}/events/${eventId}/checkin-app/download`
    : CHECKIN_APK_URL;

  const shot = CHECKIN_SCREENS[0];

  return (
    <div>
      <section className="cad-hero" aria-labelledby="cad-title">
        <div className="cad-grid">
          <div>
            <span className="cad-kicker">
              <span aria-hidden="true" className="cad-dot" />
              Now available
            </span>

            <h3 id="cad-title" className="cad-title">
              The door app is ready.<br />Take it to your next event.
            </h3>

            <p className="cad-lead">
              Install Fancy Check-in on any Android tablet. It holds your whole guest
              list on the device, admits a guest in about a second, and needs no
              internet at the venue at all.
            </p>

            <div className="cad-actions">
              {/* A plain anchor, not fetch(): the gated route 302s to a signed
                  storage URL, and letting the browser follow the redirect is
                  what makes the file download instead of landing in memory. */}
              <a className="cad-btn cad-btn--gold" href={href}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download for Android{release.version ? ` · v${release.version}` : ''}
              </a>
              <Link className="cad-btn cad-btn--ghost" href="/checkin-app">See how it works</Link>
            </div>

            <p className="cad-fine">
              {[size, minAndroid].filter(Boolean).join(' · ')}
              {/* Read from the live pricing config, never hardcoded: an admin
                  can move this feature between tiers in one click, and a
                  written-in "Enterprise and above" would go on claiming the
                  old arrangement. */}
              {includedIn.length > 0 && <> · Pairing a tablet needs {includedIn.join(' or ')}</>}
            </p>
          </div>

          <div className="cad-device-wrap">
            <div className="cad-device">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shot.src} alt={shot.alt} />
              <span aria-hidden="true" className="cad-cam" />
              <span aria-hidden="true" className="cad-glass" />
            </div>
          </div>
        </div>
      </section>

      {/* Verification and the install walkthrough stay on the light ground:
          they are reference material an organizer works THROUGH, not an
          announcement they look at. */}
      <div className="cad-panel">
        {release.sha256 && (
          <div style={{ marginBottom: '4px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.stone }}>
              SHA-256
            </span>
            {/* Published so a venue's IT can verify the file is the one we
                shipped. It is the only defence a sideloaded APK has. */}
            <code style={{
              display: 'block', marginTop: '6px', fontSize: '12px', lineHeight: 1.6,
              color: C.charcoal, background: C.softBg, border: `1px solid ${C.border}`,
              borderRadius: '8px', padding: '10px 12px', overflowWrap: 'anywhere',
            }}>{release.sha256}</code>
          </div>
        )}
        <InstallGuide divided={!!release.sha256} />
      </div>

      {/* A plain <style>, not styled-jsx: this component is nested and
          styled-jsx does not reliably compile in that position in this build,
          and its hash never lands on a next/link. Classes are prefixed "cad-".

          No backticks inside these CSS comments — one would terminate the
          template literal and produce a parse error. */}
      <style>{`
        .cad-hero {
          position: relative;
          overflow: hidden;
          border-radius: 14px;
          background: linear-gradient(158deg, #14171A 0%, #191B1E 44%, #232019 100%);
          border: 1px solid #2A2722;
          padding: 32px;
        }
        /* One off-canvas warm light. A flat dark fill has no light in it. */
        .cad-hero::before {
          content: "";
          position: absolute;
          pointer-events: none;
          top: -40%;
          left: -12%;
          width: 70%;
          height: 170%;
          background: radial-gradient(ellipse at 32% 42%, rgba(184,148,79,0.20), transparent 63%);
        }
        .cad-grid {
          position: relative;
          z-index: 1;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 32px;
          align-items: center;
        }
        .cad-kicker {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          padding: 7px 15px 7px 11px;
          border-radius: 100px;
          background: rgba(184,148,79,0.13);
          border: 1px solid rgba(184,148,79,0.34);
          font-size: 11.5px;
          font-weight: 700;
          color: #E4CE9B;
          letter-spacing: 1.7px;
          text-transform: uppercase;
        }
        .cad-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #7BC49A;
          box-shadow: 0 0 0 3px rgba(123,196,154,0.18);
        }
        /* Cormorant, NOT var(--font-serif).
           On the dashboard that variable resolves to Aboreto, an all-caps
           display face — it set this two-line headline as
           "THE DOOR APP IS READY. TAKE IT TO YOUR NEXT EVENT.", which shouts
           where the sentence wants to be spoken. It is also the wrong
           neighbour: the sibling announcement card (CheckinAppAnnounce) sets
           its own title in Cormorant at 300, and two announcements for the
           same product in two different serifs read as two products. */
        .cad-title {
          font-family: var(--font-cormorant), Georgia, serif;
          font-weight: 300;
          font-size: 31px;
          line-height: 1.2;
          color: #F8F4EC;
          margin: 18px 0 0;
          letter-spacing: -0.015em;
        }
        .cad-lead {
          margin: 13px 0 0;
          font-size: 15px;
          line-height: 1.68;
          color: rgba(248,244,236,0.70);
          max-width: 44ch;
        }
        .cad-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: center;
          margin-top: 24px;
        }
        .cad-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          border-radius: 10px;
          padding: 13px 22px;
          font-size: 15px;
          font-weight: 600;
          text-decoration: none;
          min-height: 44px;
        }
        .cad-btn--gold {
          background: linear-gradient(180deg, #D2AC63, #B8944F);
          color: #17140E;
          border: 1px solid #D7BE80;
          font-weight: 700;
          box-shadow: 0 6px 18px rgba(184,148,79,0.22);
        }
        .cad-btn--ghost {
          color: rgba(248,244,236,0.86);
          border: 1px solid rgba(248,244,236,0.26);
        }
        .cad-fine {
          margin: 15px 0 0;
          font-size: 12.5px;
          line-height: 1.6;
          color: rgba(248,244,236,0.48);
        }

        /* The device. perspective on the wrapper, not the element, so the
           tilt is a real projection rather than a skew. */
        .cad-device-wrap { perspective: 1400px; }
        .cad-device {
          position: relative;
          transform: rotateY(-12deg) rotateX(4deg) rotateZ(-0.6deg);
          border-radius: 18px;
          padding: 10px;
          background: linear-gradient(150deg, #3A362F 0%, #16140F 52%, #2B2721 100%);
          box-shadow:
            0 34px 60px -18px rgba(0,0,0,0.72),
            0 8px 18px rgba(0,0,0,0.40),
            inset 0 1px 0 rgba(255,255,255,0.10);
        }
        .cad-device img {
          display: block;
          width: 100%;
          border-radius: 9px;
        }
        /* The camera pinhole. Small, and the thing that makes a rounded
           rectangle read as a device rather than a card. */
        .cad-cam {
          position: absolute;
          top: 50%;
          left: 4.5px;
          width: 4px;
          height: 4px;
          margin-top: -2px;
          border-radius: 50%;
          background: #0B0A08;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.10);
        }
        /* A single raking highlight across the glass. */
        .cad-glass {
          position: absolute;
          inset: 10px;
          border-radius: 9px;
          pointer-events: none;
          background: linear-gradient(103deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.04) 17%, transparent 42%);
        }

        .cad-panel {
          background: #FFFFFF;
          border: 1px solid #E8E2D6;
          border-radius: 14px;
          padding: 20px 24px;
          margin-top: 14px;
        }

        @media (max-width: 767.98px) {
          .cad-hero { padding: 24px 20px; }
          .cad-grid { grid-template-columns: 1fr; gap: 26px; }
          .cad-title { font-size: 25px; }
          /* Flat on a phone. The tilt costs horizontal room the screenshot
             needs more, and a 12-degree rotation at 320px just clips. */
          .cad-device { transform: none; }
        }
      `}</style>
    </div>
  );
}

function InstallGuide({ divided = true }) {
  const steps = [
    'On the tablet, open this page and tap Download. Chrome will warn that this file type can harm your device — that warning appears for every APK, including ones from a vendor you trust. Tap Download anyway.',
    'Open the downloaded file. Android will say your browser is not allowed to install unknown apps, and offer a Settings button.',
    'Tap Settings and turn on "Allow from this source" for the browser you used. On Samsung this reads "Install unknown apps"; on Xiaomi, "Install via USB / unknown sources".',
    'Go back and tap Install. This permission only applies to that one browser — you can turn it off again afterwards.',
    'Open Fancy Check-in and enter the pairing code from the next step.',
  ];

  return (
    /* The rule only earns its place when something sits above it. In the
       common case — no admin-published release, so no SHA-256 — an
       unconditional borderTop drew a divider separating this from nothing,
       with 36px of dead space above it at the top of an otherwise empty
       panel. */
    <details style={divided
      ? { marginTop: '20px', borderTop: `1px solid ${C.border}`, paddingTop: '16px' }
      : { marginTop: 0 }}>
      <summary style={{ cursor: 'pointer', fontSize: '15px', fontWeight: 600, color: C.charcoal }}>
        Installing it on the tablet — step by step
      </summary>
      <ol style={{ margin: '14px 0 0', paddingInlineStart: '22px', color: C.stone, fontSize: '14.5px', lineHeight: 1.75 }}>
        {steps.map((s, i) => <li key={i} style={{ marginBottom: '8px' }}>{s}</li>)}
      </ol>
      <p style={{ margin: '12px 0 0', fontSize: '13.5px', color: C.stone, fontStyle: 'italic' }}>
        Do this at the office on wifi, not at the venue. The app works offline once the guest list
        is loaded, but installing it and loading the list both need a connection.
      </p>
    </details>
  );
}

const btnPrimary = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: C.charcoal, color: C.ivory, border: `1px solid ${C.charcoal}`,
  borderRadius: '10px', padding: '13px 22px', fontSize: '15px', fontWeight: 600,
  textDecoration: 'none', cursor: 'pointer', minHeight: '44px',
};

const btnGhost = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', color: C.charcoal, border: `1px solid ${C.border}`,
  borderRadius: '10px', padding: '13px 22px', fontSize: '15px', fontWeight: 600,
  textDecoration: 'none', cursor: 'pointer', minHeight: '44px',
};
