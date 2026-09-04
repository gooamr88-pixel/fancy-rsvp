'use client';

// Guest self-scan ticket view — reached by scanning the QR code emailed from
// the organizer dashboard's RSVPs tab ("Resend QR ticket email"). The token
// IS the authentication (a signed, purpose-scoped JWT — see
// backend/services/tokenService.js signQrTicket/verifyQrTicket), so this page
// needs no login and no slug: everything is decoded server-side from the
// token in GET /public/ticket/:token.
//
// Reuses <SeatingResultPanel> (the same "find my seat" component shown right
// after a guest submits their RSVP) so the guarantee that a guest only ever
// sees their OWN table + own party on the real venue map — never who else is
// seated where — lives in one place instead of being re-implemented here.

import React, { Suspense, use, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { publicApiFetch, PublicApiError, API_URL } from '../../utils/publicApi';
import SeatingResultPanel from '../../[slug]/rsvp/steps/SeatingResultPanel';
import Icon from '../../components/icons/Icon';
// The same coordinates-first / address-fallback builder the guest page's venue
// sections use, so the pin a guest gets here is the pin they get everywhere.
import { getDirectionsUrl } from '../../components/templates/heritageArch/shared';
import { safeZone } from '../../utils/timezone';
import SelfCheckIn from './SelfCheckIn';

/**
 * Turns a failed ticket lookup into something true.
 *
 * Every failure here used to render one sentence — "Could not load your ticket.
 * Please try again later." — and that sentence was wrong for three of the four
 * ways this can fail. A ticket token is signed and long-lived, so it outlives the
 * rows it points at: the party can be deleted, the event can be unpublished. In
 * those cases the link will NEVER work, and telling a guest standing at the door
 * to try again later sends them to wait for something that is not coming.
 *
 * The distinction that matters to a guest is not the error code, it is whether
 * waiting helps. Only a network fault or a 5xx is worth retrying; everything else
 * needs the host, so those messages point at the host instead.
 */
export function describeTicketError(err, isRTL) {
  const code = err instanceof PublicApiError ? err.code : null;
  const askHost = isRTL
    ? 'كلّم صاحب الدعوة عشان يبعتلك تذكرة جديدة.'
    : 'Please contact whoever invited you for a new ticket.';

  switch (code) {
    case 'INVALID_TICKET':
      return {
        title: isRTL ? 'التذكرة دي مش صالحة.' : "This ticket isn't valid.",
        hint: askHost,
        retryable: false,
      };

    // The common one, and the reason this function exists. Clearing a guest list
    // and re-importing it mints new party IDs, which orphans every ticket already
    // sent — the link is intact, the guest behind it is gone.
    case 'GUEST_NOT_FOUND':
      return {
        title: isRTL ? 'مش لاقيين اسمك في قائمة الضيوف.' : "We can't find you on the guest list.",
        hint: isRTL
          ? 'يمكن القائمة اتحدّثت بعد ما وصلتك التذكرة. كلّم صاحب الدعوة عشان يبعتلك واحدة جديدة.'
          : 'The list may have been updated after your ticket was sent. Ask your host to resend it.',
        retryable: false,
      };

    case 'EVENT_INACTIVE':
      return {
        title: isRTL ? 'الفعالية دي مش مفتوحة للضيوف حالياً.' : "This event isn't open to guests right now.",
        hint: askHost,
        retryable: false,
      };

    case 'EVENT_NOT_FOUND':
      return {
        title: isRTL ? 'الفعالية دي مابقتش موجودة.' : 'This event no longer exists.',
        hint: askHost,
        retryable: false,
      };

    // Genuinely transient: no signal, or the API is down. Here "try again" is
    // real advice rather than a shrug, so this is the only branch that offers it.
    default:
      return {
        title: isRTL ? 'تعذّر تحميل تذكرتك.' : "We couldn't load your ticket.",
        hint: isRTL
          ? 'اتأكد من الإنترنت وجرّب تاني.'
          : 'Check your connection and try again.',
        retryable: true,
      };
  }
}

function TicketRoute({ token }) {
  const searchParams = useSearchParams();
  const isRTL = searchParams.get('lang') === 'ar';

  const [status, setStatus] = useState('loading'); // 'loading' | 'error' | 'locked' | 'ready'
  const [error, setError] = useState(null); // { title, hint, retryable }
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await publicApiFetch(`/public/ticket/${encodeURIComponent(token)}`);
        if (cancelled) return;
        setPayload(data);
        setStatus(data.locked ? 'locked' : 'ready');
      } catch (err) {
        if (cancelled) return;
        setError(describeTicketError(err, isRTL));
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [token, isRTL]);

  const event = payload?.event;
  const guest = payload?.guest;
  const qrSrc = `${API_URL}/public/qr/${encodeURIComponent(token)}.png`;
  const themeColor = event?.custom_colors?.primary || '#B8944F';
  const formattedDate = event?.event_date
    ? new Date(event.event_date).toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: safeZone(event.timezone) })
    : '';

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} style={{
      minHeight: '100dvh', position: 'relative',
      background: 'radial-gradient(120% 100% at 50% 0%, #EFE2C233 0%, #F8F4EC 45%, #EFE6D4 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px', fontFamily: 'var(--font-sans)', textAlign: isRTL ? 'right' : 'left',
    }}>
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        style={{
          position: 'relative', maxWidth: '540px', width: '100%',
          borderRadius: '22px', padding: '1.5px',
          background: `linear-gradient(135deg, #D7BE80, ${themeColor} 45%, #D7BE80)`,
          boxShadow: '0 36px 90px -24px rgba(110,74,34,0.38), 0 10px 30px rgba(25,27,30,0.07)',
        }}
      >
        <div style={{ background: '#FFFFFF', borderRadius: '20.5px', overflow: 'hidden' }}>
          <div style={{
            background: 'linear-gradient(135deg, #191B1E 0%, #2a2d32 100%)',
            color: '#FFFFFF', padding: '32px 32px 26px', textAlign: 'center',
          }}>
            <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '4px', color: themeColor, fontWeight: 700, display: 'block', marginBottom: '10px' }}>
              {isRTL ? 'تذكرتك' : 'Your Ticket'}
            </span>
            <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '22px', fontWeight: 400, lineHeight: 1.3, color: '#FFFFFF' }}>
              {event?.title || (isRTL ? 'الفعالية' : 'Event')}
            </h1>
            {formattedDate && (
              <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', marginTop: '8px' }}>{formattedDate}</p>
            )}
            {/* ── The venue, as a way to GET there ────────────────────────
                This was plain text, and this page is the only thing the
                day-before SMS links to: the text says "show this at the
                door", the guest opens it outside the venue, and the one
                question they have — how do I get in there — had no answer
                anywhere in the flow. The email has had a directions link all
                along; the text and this page did not.

                Deliberately NOT added to the SMS body instead. Measured, the
                seating reminder has 47 GSM-7 units of slack in English and 40
                UCS-2 units in Arabic at worst case; a shortened link plus a
                label needs ~43. Arabic would tip 4 segments to 5 for every
                guest on every event. The link is free here and the text
                already points here. */}
            {(event?.location_name || event?.location_address) && (
              <a
                href={getDirectionsUrl(event.location_lat, event.location_lng, event.location_address || event.location_name)}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="ticket-directions"
                style={{
                  fontSize: '12px', color: 'rgba(255,255,255,0.72)', marginTop: '4px',
                  display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center',
                  justifyContent: 'center', gap: '5px',
                  textDecoration: 'none', borderBottom: '1px solid rgba(255,255,255,0.28)',
                  paddingBottom: '1px',
                }}
              >
                <Icon name="mapPin" size={12} strokeWidth={1.6} />
                {event.location_name || event.location_address}
                <span style={{ color: themeColor, fontWeight: 600 }}>
                  · {isRTL ? 'الاتجاهات' : 'Directions'}
                </span>
              </a>
            )}
          </div>

          <div style={{ padding: '28px 32px 32px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {status === 'loading' && (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <div style={{ width: '32px', height: '32px', border: '3px solid #E8E2D6', borderTop: `3px solid ${themeColor}`, borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
                <p style={{ color: '#77736A', fontSize: '13px' }}>{isRTL ? 'جاري تحميل تذكرتك...' : 'Loading your ticket...'}</p>
              </div>
            )}

            {status === 'error' && error && (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <Icon name="warning" size={34} color="#C45E5E" strokeWidth={1.3} />
                <p style={{ color: '#191B1E', fontSize: '15px', fontWeight: 600, marginTop: '12px', lineHeight: 1.5 }}>{error.title}</p>
                <p style={{ color: '#77736A', fontSize: '13px', marginTop: '8px', lineHeight: 1.6, maxWidth: '340px', marginInline: 'auto' }}>{error.hint}</p>
                {/* Shown only when waiting can actually help. A retry button under
                    "your name is not on the list" is an invitation to keep tapping
                    at something that will never change. */}
                {error.retryable && (
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    style={{
                      marginTop: '18px', padding: '11px 22px', borderRadius: '12px',
                      border: 'none', cursor: 'pointer',
                      background: themeColor, color: '#FFFFFF', fontSize: '14px', fontWeight: 700,
                    }}
                  >
                    {isRTL ? 'حاول تاني' : 'Try again'}
                  </button>
                )}
              </div>
            )}

            {/* The QR renders for BOTH 'ready' and 'locked'. Only the seating CHART
                is embargoed until 24h before the event — the entrance credential
                never is. Gating the whole body on 'ready' meant a guest opening
                their emailed pass a week early got a padlock and no way to reach
                the one thing the email told them to save. */}
            {(status === 'ready' || status === 'locked') && guest && (
              <>
                <div style={{ textAlign: 'center', paddingBottom: '4px', borderBottom: '1px solid #F0ECE3' }}>
                  <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1.2px', color: '#77736A', fontWeight: 700 }}>
                    {isRTL ? 'الضيف' : 'Guest'}
                  </span>
                  <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '19px', fontWeight: 600, color: '#191B1E', marginTop: '4px' }}>{guest.guest_name}</h2>
                  <span style={{ fontSize: '12px', color: '#77736A' }}>{isRTL ? `عدد الأفراد: ${guest.party_size}` : `Party of ${guest.party_size}`}</span>
                </div>

                {/* The actual entrance credential — this page is reached via the same
                    signed token the door scanner verifies, so the QR rendered here (the
                    backend's own PNG, not a client-side re-encode) is always the real,
                    working ticket, unlike the decorative preview shown right after RSVP. */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '20px 0 4px' }}>
                  <div style={{ padding: '14px', background: '#FFFFFF', border: '1px solid #E8E2D6', borderRadius: '16px', boxShadow: '0 8px 24px rgba(25,27,30,0.06)' }}>
                    <img
                      src={qrSrc}
                      alt={isRTL ? 'رمز الدخول' : 'Entrance QR code'}
                      width={200}
                      height={200}
                      style={{ display: 'block', width: '200px', height: '200px' }}
                    />
                  </div>
                  <span style={{ fontSize: '11px', color: '#A09A91', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
                    {isRTL ? 'اعرض هذا الرمز عند الدخول' : 'Show this at the door'}
                  </span>
                </div>

                {/* Saving the code is the point of this page: at the venue the guest
                    may have no signal. A plain <a download> would be ignored here —
                    the API is a different origin — so the attachment header comes
                    from the backend via ?download=1. */}
                <a
                  href={`${qrSrc}?download=1`}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    padding: '13px 20px', borderRadius: '12px', textDecoration: 'none',
                    background: themeColor, color: '#FFFFFF', fontSize: '14px', fontWeight: 700,
                    boxShadow: '0 8px 20px -6px rgba(25,27,30,0.35)',
                  }}
                >
                  <Icon name="download" size={16} strokeWidth={1.8} />
                  {isRTL ? 'حمّل رمز الدخول' : 'Download my QR code'}
                </a>
                <p style={{ fontSize: '12px', color: '#A09A91', textAlign: 'center', lineHeight: 1.6, marginTop: '-8px' }}>
                  {isRTL
                    ? 'احفظه في صورك عشان يبقى معاك عند البوابة حتى من غير إنترنت.'
                    : 'Save it to your photos so you have it at the gate even without a signal.'}
                </p>

                {status === 'locked' ? (
                  <div style={{ textAlign: 'center', padding: '18px 0 4px', borderTop: '1px solid #F0ECE3' }}>
                    <Icon name="lock" size={28} color={themeColor} strokeWidth={1.3} />
                    <p style={{ color: '#191B1E', fontSize: '14px', fontWeight: 600, marginTop: '10px' }}>
                      {isRTL ? 'خريطة الجلوس لسه مش متاحة.' : "The seating chart isn't available yet."}
                    </p>
                    <p style={{ color: '#77736A', fontSize: '12px', marginTop: '6px' }}>
                      {isRTL ? 'هتظهر قبل الفعالية بيوم واحد — رمز الدخول شغّال من دلوقتي.' : 'It unlocks 24 hours before the event — your QR code already works.'}
                    </p>
                  </div>
                ) : (
                  <div style={{ borderTop: '1px solid #F0ECE3', paddingTop: '18px' }}>
                    {/* A quiet heading so the seating block reads as a second
                        section of the pass rather than more of the QR area —
                        without it the map appeared to be part of the download
                        instructions directly above. */}
                    <span style={{
                      display: 'block', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1.2px',
                      color: '#77736A', fontWeight: 700, marginBottom: '12px', textAlign: 'center',
                    }}>
                      {isRTL ? 'مكانك في القاعة' : 'Where you are sitting'}
                    </span>
                    <SeatingResultPanel
                      view={{ myTableName: payload.myTableName, myTableId: payload.myTableId, party: payload.party, tables: payload.tables }}
                      loading={false}
                      isRTL={isRTL}
                      // The QR is what this page exists for. Everything below it
                      // is reference, so the map preview shrinks and the expand
                      // button carries anyone who actually wants to study it.
                      compact
                    />
                  </div>
                )}

                {/* Self-service arrival. Only once the seating embargo has
                    lifted — before that the pass is a keepsake, not a door. */}
                {status === 'ready' && (
                  <SelfCheckIn
                    slug={event?.slug}
                    partyId={guest?.id}
                    guestName={guest?.guest_name}
                    isRTL={isRTL}
                    themeColor={themeColor}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </motion.div>

      {/* No local @keyframes here on purpose: styled-jsx renames a scoped keyframe
          to `spin-jsx-<hash>`, and it cannot rewrite the `animation: 'spin ...'`
          sitting in an inline style object — so the scoped copy matched nothing and
          the spinners were resolving against globals.css's `spin` all along. */}
    </div>
  );
}

export default function TicketPage({ params }) {
  const { token } = use(params);
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100dvh', background: '#F8F4EC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '48px', height: '48px', border: '3px solid #E8E2D6', borderTop: '3px solid #B8944F', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      </div>
    }>
      <TicketRoute token={token} />
    </Suspense>
  );
}
