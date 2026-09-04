'use client';

/* `React` is imported and it is NOT unused. Next compiles JSX with the automatic
   runtime, but vitest here compiles it with the CLASSIC one, so every element in
   this file becomes React.createElement at test time. Removing this import as
   "dead" makes the screenshot probe and any future render test throw
   "React is not defined" while the app itself keeps building. */
import React, { useState } from 'react';
import { toast } from '../../utils/toast';
import {
  OrganizerSmsConsentText,
  SmsConsentIndependence,
} from '../../components/guest/SmsConsentText';

/**
 * THE ORGANIZER'S OWN SMS OPT-IN.
 *
 * ── Why this exists ──
 *
 * `organizer_report` — the headcount summary texted to the customer before
 * their own event — reads `organizations.sms_consent` before every send. The
 * endpoint that writes it (PATCH /events/:id/campaigns/organizer-sms) shipped,
 * was tested, and the settings response already carried `organizerSms`. But no
 * screen in the product could reach it, so the flag stayed false for every
 * organization and that message type could never fire for anybody. The switch
 * list on the Messages page even told people to "add your own number below",
 * pointing at nothing.
 *
 * ── Why it is a separate file ──
 *
 * So it can be rendered on its own and LOOKED AT (test/shots/organizerSmsProbe).
 * A compliance surface whose layout has never been seen is a compliance surface
 * on trust.
 *
 * ── The three rules it inherits from the guest opt-in ──
 *
 * All three are Twilio TFV requirements, and the guest surfaces drifted apart
 * over exactly these once already:
 *
 *   1. The sentence comes from the canonical module. Never inline a variant.
 *   2. It sits INSIDE the label, carrying no links and no mention of any other
 *      agreement.
 *   3. The independence notice sits OUTSIDE the label, below it, and is where
 *      the Privacy / Terms links live. Bundling them into the label reads as
 *      "ticking this also accepts our Terms" — the construction that failed
 *      review 30475.
 *
 * The checkbox is never required in order to save: an organizer may correct
 * their number with consent off, and withdrawing must always be one click.
 */

const C = {
  gold: '#B8944F',
  charcoal: '#191B1E',
  stone: '#77736A',
  border: '#E8E2D6',
  white: '#FFFFFF',
  muted: '#D5D0C6',
};

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  background: C.white,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: '12px 14px',
  // 16px, not smaller: iOS zooms the whole page when a focused input is under
  // 16px, and the organizer is often on a phone when they set this up.
  fontSize: 16,
  color: C.charcoal,
  outline: 'none',
  fontFamily: 'var(--font-sans)',
};

export default function OrganizerSmsPanel({ apiUrl, eventId, organizerSms, onSaved }) {
  const saved = organizerSms || {};
  const [phone, setPhone] = useState(saved.phone || '');
  const [consent, setConsent] = useState(!!saved.consent);
  const [busy, setBusy] = useState(false);

  /* Re-seed when the page reloads its data — a save made elsewhere should show
     here rather than be masked by whatever this form last held. Adjusted during
     render rather than in an effect: this is derived state reacting to a prop
     change, which is the case React documents for exactly this pattern. */
  const [prevSaved, setPrevSaved] = useState(saved);
  if (saved !== prevSaved) {
    setPrevSaved(saved);
    setPhone(saved.phone || '');
    setConsent(!!saved.consent);
  }

  const dirty = consent !== !!saved.consent || (phone || '') !== (saved.phone || '');

  const submit = async (nextConsent, nextPhone) => {
    setBusy(true);
    try {
      const res = await fetch(`${apiUrl}/events/${eventId}/campaigns/organizer-sms`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent: nextConsent, phone: nextPhone }),
      });
      const j = await res.json();
      /* The server validates the number and refuses a consent with nowhere to
         send. Its message names the actual problem ("Add a mobile number to
         receive text alerts"), so it is shown verbatim instead of being
         flattened into a generic failure. */
      if (!res.ok || j.success === false) throw new Error(j.message || 'Could not save that.');
      toast.success(nextConsent ? 'You will get a text before each event.' : 'Texts to you are off.');
      if (onSaved) await onSaved();
    } catch (err) {
      toast.error(err.message || 'Could not save that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={{
      background: C.white, border: `1px solid ${C.border}`, borderRadius: 14,
      padding: 20, marginBottom: 22,
    }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: C.charcoal, fontFamily: 'var(--font-serif)' }}>
        Texts to you
      </h2>
      <p style={{ margin: '5px 0 14px', fontSize: 13, color: C.stone, fontFamily: 'var(--font-sans)' }}>
        A summary of who said yes, sent to your own phone before each event.
      </p>

      <div className="fx-stack fx-stack--gap">
        <div>
          <label
            htmlFor="organizer-sms-phone"
            style={{
              display: 'block', fontSize: 12.5, fontWeight: 700, color: C.charcoal,
              marginBottom: 6, fontFamily: 'var(--font-sans)',
            }}
          >
            Your mobile number
          </label>
          <input
            id="organizer-sms-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            disabled={busy}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555 123 4567"
            style={inputStyle}
          />
          <p style={{ margin: '6px 0 0', fontSize: 12, color: C.stone, fontFamily: 'var(--font-sans)' }}>
            Include the country code. Guests never see this number.
          </p>
        </div>

        <div>
          {/* `flexWrap` is required by test/mobileFit.test.js, whose ratchet for
              rigid horizontal rows is at zero and must stay there. In practice
              it never engages here — a 17px box plus a 10px gap leaves the
              sentence 253px at the 320px floor — but the rule is right to be
              blanket: a row that CAN'T wrap is one bad string away from pushing
              the page sideways, and `html { overflow-x: clip }` would then hide
              the overflow rather than make it reachable. */}
          <label style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 10,
            cursor: busy ? 'wait' : 'pointer',
          }}>
            <input
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(e) => setConsent(e.target.checked)}
              style={{ marginTop: 3, width: 17, height: 17, accentColor: C.gold, flexShrink: 0 }}
            />
            <span style={{ fontSize: 12.5, lineHeight: 1.65, color: C.charcoal, fontFamily: 'var(--font-sans)' }}>
              <OrganizerSmsConsentText />
            </span>
          </label>

          {/* OUTSIDE the label — rule 3 above. */}
          <SmsConsentIndependence style={{ marginLeft: 27 }} />
        </div>

        <div className="fx-row fx-row--gap" style={{ alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => submit(consent, phone)}
            disabled={busy || !dirty}
            style={{
              background: dirty ? C.gold : C.muted, color: C.white, border: 'none',
              borderRadius: 8, padding: '11px 22px', fontSize: 13.5, fontWeight: 700,
              cursor: busy ? 'wait' : (dirty ? 'pointer' : 'default'),
              fontFamily: 'var(--font-sans)',
            }}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>

          {/* Withdrawing must never be harder than giving, and must not require
              finding and unticking a box first. */}
          {saved.consent && (
            <button
              type="button"
              onClick={() => { setConsent(false); submit(false, phone); }}
              disabled={busy}
              style={{
                background: 'transparent', color: C.stone, border: `1px solid ${C.border}`,
                borderRadius: 8, padding: '11px 18px', fontSize: 13.5, fontWeight: 600,
                cursor: busy ? 'wait' : 'pointer', fontFamily: 'var(--font-sans)',
              }}
            >
              Stop texting me
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
