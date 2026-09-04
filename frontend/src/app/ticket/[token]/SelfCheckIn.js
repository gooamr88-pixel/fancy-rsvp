'use client';

/* `React` is imported and it is NOT unused. Next compiles JSX with the automatic
   runtime; vitest compiles it with the CLASSIC one, so every element here becomes
   React.createElement at test time. Removing it as "dead" breaks the screenshot
   probe and any render test while the app itself still builds. */
import React, { useState } from 'react';
import { publicApiFetch } from '../../utils/publicApi';

/**
 * "I'VE ARRIVED" — the guest checking themselves in from their own ticket.
 *
 * ── Why this exists ──
 *
 * POST /public/events/:slug/self-checkin shipped complete: a name second factor,
 * an active-event guard, `self_service` as a first-class method in the database
 * constraint, the SMS/report templates and the attendance export. It had no
 * caller anywhere — no page in the product could reach it — so the whole
 * self-service path existed only as an endpoint nobody could use.
 *
 * ── Why it belongs on the ticket page and nowhere else ──
 *
 * The endpoint needs a party id AND a matching name, deliberately: a party id
 * alone travels in shared links and would otherwise let anyone mark a no-show as
 * arrived. This page has already proven who the holder is — it was reached with
 * a signed ticket token — and the payload carries both values. Any other
 * placement would have to ask the guest to type a name to be matched against the
 * record, which is a worse experience AND a weaker check.
 *
 * ── What it deliberately does not do ──
 *
 * It never claims the guest is checked in until the server says so, and it does
 * not hide itself on failure. A door is the wrong place to have to guess.
 */
export default function SelfCheckIn({ slug, partyId, guestName, isRTL = false, themeColor = '#B8944F' }) {
  // 'idle' | 'sending' | 'done' | 'already' | 'error'
  const [state, setState] = useState('idle');
  const [message, setMessage] = useState('');

  if (!slug || !partyId) return null;

  const t = (en, ar) => (isRTL ? ar : en);

  const submit = async () => {
    setState('sending');
    try {
      const data = await publicApiFetch(`/public/events/${encodeURIComponent(slug)}/self-checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partyId, guestName }),
      });
      setMessage(data?.tableName || '');
      setState('done');
    } catch (err) {
      /* 409 ALREADY_CHECKED_IN is not a failure — it is the answer. Someone at
         the door may have scanned this same ticket a minute ago, and telling the
         guest "something went wrong" would send them to find a member of staff
         to fix a thing that is already correct. */
      if (err.code === 'ALREADY_CHECKED_IN') {
        setMessage(err.meta?.tableName || '');
        setState('already');
        return;
      }
      setMessage(err.message || t('Could not check you in.', 'تعذّر تسجيل وصولك.'));
      setState('error');
    }
  };

  const box = {
    borderTop: '1px solid #F0ECE3',
    paddingTop: '18px',
    marginTop: '18px',
    textAlign: 'center',
  };

  if (state === 'done' || state === 'already') {
    return (
      <div style={box}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px',
          padding: '11px 18px', borderRadius: '999px',
          background: 'rgba(59,155,109,0.10)', border: '1px solid rgba(59,155,109,0.35)',
          color: '#2F7A55', fontSize: '13.5px', fontWeight: 700,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {state === 'already'
            ? t("You're already checked in", 'تم تسجيل وصولك بالفعل')
            : t("You're checked in", 'تم تسجيل وصولك')}
        </div>
        {message && (
          <p style={{ color: '#77736A', fontSize: '12.5px', marginTop: '9px' }}>
            {t('Your table: ', 'طاولتك: ')}<strong style={{ color: '#191B1E' }}>{message}</strong>
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={box}>
      <button
        type="button"
        onClick={submit}
        disabled={state === 'sending'}
        style={{
          width: '100%', maxWidth: '280px', padding: '13px 22px',
          borderRadius: '999px', border: 'none',
          background: state === 'sending' ? '#D5D0C6' : themeColor,
          color: '#FFFFFF', fontSize: '14px', fontWeight: 700,
          fontFamily: 'var(--font-sans)',
          cursor: state === 'sending' ? 'wait' : 'pointer',
        }}
      >
        {state === 'sending' ? t('Checking you in…', 'جارٍ التسجيل…') : t("I've arrived", 'وصلت')}
      </button>

      <p style={{ color: '#77736A', fontSize: '11.5px', marginTop: '9px', lineHeight: 1.6 }}>
        {t('Only if the host asked you to check yourself in. Otherwise just show the code above.',
          'استخدمه فقط إذا طلب منك المضيف تسجيل وصولك بنفسك. غير ذلك اعرض الرمز بالأعلى.')}
      </p>

      {state === 'error' && (
        <p role="alert" style={{ color: '#C45E5E', fontSize: '12.5px', marginTop: '8px', fontWeight: 600 }}>
          {message}
        </p>
      )}
    </div>
  );
}
