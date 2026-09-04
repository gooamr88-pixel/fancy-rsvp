'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import { FadeInUp, ConfettiExplosion } from '../../../components/guest/GuestAnimations';
import { PremiumButton, CalendarButton, ShareButton } from '../../../components/guest/GuestUI';
import GuestPassCard from '../../../components/guest/GuestPassGenerator';
import SeatingResultPanel from './SeatingResultPanel';
import { getCelebrationPreset } from '../../../utils/patternCelebration';
import { CelebrateIcon, CalendarIcon, EnvelopeIcon, MapPinIcon } from '../../../components/guest/RsvpIcons';
import { RsvpDivider } from '../components';
import CreateYourOwnEvent from '../../../components/guest/CreateYourOwnEvent';

/** A theatrical "materializing" entrance for the pass card — a slight 3D
    tilt-and-land plus a one-shot light sweep, like the card catching the
    light as it's set down. Falls back to a plain fade for reduced-motion. */
function PassCardReveal({ delay = 0, children }) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) {
    return <FadeInUp delay={delay} y={12}>{children}</FadeInUp>;
  }
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.82, rotateX: 18, y: 26 }}
      animate={{ opacity: 1, scale: 1, rotateX: 0, y: 0 }}
      transition={{ type: 'spring', stiffness: 170, damping: 16, delay }}
      style={{ position: 'relative', perspective: 800 }}
    >
      {children}
      <motion.div
        aria-hidden
        initial={{ opacity: 0.9, x: '-120%' }}
        animate={{ opacity: 0, x: '120%' }}
        transition={{ duration: 0.9, delay: delay + 0.35, ease: 'easeOut' }}
        style={{
          position: 'absolute', inset: 0, borderRadius: 18, pointerEvents: 'none',
          background: 'linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.55) 48%, rgba(255,255,255,0.15) 54%, transparent 70%)',
        }}
      />
    </motion.div>
  );
}

/** Three staggered confetti bursts instead of one flat explosion — reads as
    a proper fireworks finale. Reuses the same themed colors/shapes so it
    still feels like THIS invitation's celebration, just bigger. Drops to two,
    lighter waves on devices reporting few logical cores (a widely-supported,
    if imprecise, low-end-hardware signal) so three overlapping particle
    systems don't compete for paint budget on the guest's actual phone. */
function FireworksFinale({ colors, shapes }) {
  const [lowEnd] = useState(
    () => typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= 4
  );
  const [waves, setWaves] = useState([true, false, false]);
  useEffect(() => {
    const t1 = setTimeout(() => setWaves(w => [w[0], true, w[2]]), 260);
    if (lowEnd) return () => clearTimeout(t1);
    const t2 = setTimeout(() => setWaves(w => [w[0], w[1], true]), 520);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [lowEnd]);
  return (
    <>
      {waves[0] && <ConfettiExplosion active duration={4200} particleCount={lowEnd ? 70 : 110} colors={colors} shapes={shapes} spread={0.9} />}
      {waves[1] && <ConfettiExplosion active duration={3800} particleCount={lowEnd ? 60 : 90} colors={colors} shapes={shapes} spread={1.3} />}
      {!lowEnd && waves[2] && <ConfettiExplosion active duration={3600} particleCount={90} colors={colors} shapes={shapes} spread={1.6} />}
    </>
  );
}

/** A one-shot full-screen radial flash in the event's own theme color — the
    same "cinematic gateway" language as the DigitalEnvelope's opening
    whiteout, so the journey feels bookended: it opened in light, it closes
    in light. */
function CelebrationFlash({ color }) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return null;
  return (
    <motion.div
      aria-hidden
      initial={{ opacity: 0.85 }}
      animate={{ opacity: 0 }}
      transition={{ duration: 1.1, ease: 'easeOut' }}
      style={{
        position: 'fixed', inset: 0, zIndex: 40, pointerEvents: 'none',
        background: `radial-gradient(circle at 50% 40%, #FFFFFF 0%, ${color} 45%, transparent 75%)`,
      }}
    />
  );
}

/** Step 5 — the celebratory / follow-up / farewell screen, branched by response. */
export default function StepSuccess({
  t, isRTL, attending, event, localizedTitle, guestName, email, partySize,
  partyId, slug, themeColor, assignedTableName, maybeFollowUp, declineReason,
  seatingApi, seatingRevealed, qrToken,
}) {
  // The pass's QR must encode a REAL signed ticket (the same shape the emailed
  // ticket link and the door scanner use), never a placeholder string — a fake
  // QR here would look scannable but fail at checkinController's verifyQrTicket.
  // qrToken is only minted server-side for a confirmed "yes" (see
  // tokenService.signQrTicketForResponse), so a "maybe" correctly falls back to
  // GuestPassCard's existing "sent separately" placeholder instead of a lie.
  const qrData = qrToken && typeof window !== 'undefined' ? `${window.location.origin}/ticket/${qrToken}` : null;

  const { seatingView, seatingLoading, fetchSeatingMap } = seatingApi;
  // The confetti burst matches THIS invitation's own identity — gilded stars
  // for a riad/vineyard theme, petals for a garden theme, snowy rings for a
  // winter theme — instead of one generic gold/rainbow burst for every event.
  const celebration = getCelebrationPreset(event?.template_type);

  return (
    <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '24px', padding: '16px 0' }}>

      {attending === 'yes' && (
        <>
          <CelebrationFlash color={themeColor} />
          <FireworksFinale colors={celebration.colors} shapes={celebration.shapes} />

          <FadeInUp y={20}>
            <motion.span
              animate={{ scale: [1, 1.08, 1] }}
              transition={{ duration: 0.8, delay: 0.3 }}
              style={{
                width: '72px', height: '72px', borderRadius: '50%', margin: '0 auto',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: `${themeColor}14`, color: themeColor,
              }}
            >
              <CelebrateIcon size={34} strokeWidth={1.4} />
            </motion.span>
          </FadeInUp>

          <FadeInUp delay={0.2} y={15}>
            <h2 style={{ fontFamily: event?.custom_fonts?.card_title || 'var(--font-serif)', fontSize: '26px', fontWeight: 600, color: '#191B1E' }}>
              {t.thank_you.replace('{name}', guestName)}
            </h2>
          </FadeInUp>

          <FadeInUp delay={0.35} y={10}>
            <p style={{ color: '#77736A', maxWidth: '400px', margin: '0 auto', fontSize: '14px', lineHeight: 1.7, fontFamily: 'var(--font-sans)' }}>
              {t.attending_success_desc.replace('{email}', email)}
            </p>
          </FadeInUp>

          {/* Delayed until after the fireworks' three waves (0/260/520ms) have
              launched — landing the pass card's own 3D entrance here instead
              of at 0.5s means the guest isn't fighting three confetti bursts
              and a spring-physics card materialization for GPU/paint budget
              in the same instant they need to actually read the pass. */}
          <PassCardReveal delay={1.0}>
            <GuestPassCard
              guestName={guestName}
              eventTitle={localizedTitle}
              eventDate={event?.event_date}
              eventTimezone={event?.timezone}
              eventLocation={event?.location_name || event?.location_address}
              tableName={assignedTableName}
              response="yes"
              qrData={qrData}
              themeColor={themeColor}
              isRTL={isRTL}
              removeWatermark={!!event?.tier_remove_watermark}
            />
          </PassCardReveal>

          <FadeInUp delay={1.15} y={10}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <CalendarButton event={event} isRTL={isRTL} />
              <ShareButton
                title={localizedTitle}
                text={isRTL ? `أنا سأحضر ${localizedTitle}!` : `I'm attending ${localizedTitle}!`}
                url={typeof window !== 'undefined' ? window.location.origin + '/' + slug : ''}
                isRTL={isRTL}
              />
            </div>
          </FadeInUp>

          {partyId && seatingRevealed && (
            <FadeInUp delay={1.25} y={15}>
              {seatingView ? (
                <div style={{ marginTop: '4px' }}>
                  <SeatingResultPanel view={seatingView} loading={seatingLoading} isRTL={isRTL} />
                </div>
              ) : (
                <PremiumButton variant="outline" onClick={() => fetchSeatingMap(partyId)} loading={seatingLoading} icon={<MapPinIcon size={15} />}>
                  {isRTL ? 'اعرض طاولتي على الخريطة' : 'Find my table on the map'}
                </PremiumButton>
              )}
            </FadeInUp>
          )}

          <FadeInUp delay={1.35} y={5}>
            <p style={{ fontSize: '12px', color: '#A09A91', fontStyle: 'italic', fontFamily: 'var(--font-sans)' }}>{t.qr_notice}</p>
          </FadeInUp>
        </>
      )}

      {attending === 'maybe' && (
        <>
          <FadeInUp y={20}>
            <motion.span
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 2, repeat: Infinity }}
              style={{
                width: '72px', height: '72px', borderRadius: '50%', margin: '0 auto',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(99,102,241,0.1)', color: '#6366f1',
              }}
            >
              <CalendarIcon size={32} strokeWidth={1.4} />
            </motion.span>
          </FadeInUp>

          <FadeInUp delay={0.2} y={15}>
            <h2 style={{ fontFamily: event?.custom_fonts?.card_title || 'var(--font-serif)', fontSize: '26px', fontWeight: 600, color: '#191B1E' }}>
              {t.thank_you.replace('{name}', guestName)}
            </h2>
          </FadeInUp>

          <FadeInUp delay={0.35} y={10}>
            <p style={{ color: '#77736A', maxWidth: '400px', margin: '0 auto', fontSize: '14px', lineHeight: 1.7 }}>
              {isRTL ? 'تم تسجيل ردك المبدئي. سنتابع معك قريباً للتأكيد النهائي.' : "Your tentative response has been recorded. We'll follow up with you soon for final confirmation."}
            </p>
          </FadeInUp>

          {maybeFollowUp && (
            <FadeInUp delay={0.45} y={10}>
              <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', padding: '16px 24px', borderRadius: '14px', display: 'inline-block', margin: '0 auto' }}>
                <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1.5px', color: '#6366f1', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
                  {isRTL ? 'المتابعة المتوقعة' : 'Expected Follow-up'}
                </span>
                <strong style={{ fontSize: '16px', color: '#6366f1', fontFamily: 'var(--font-serif)' }}>{maybeFollowUp}</strong>
              </div>
            </FadeInUp>
          )}

          <PassCardReveal delay={0.5}>
            <GuestPassCard
              guestName={guestName}
              eventTitle={localizedTitle}
              eventDate={event?.event_date}
              eventTimezone={event?.timezone}
              eventLocation={event?.location_name || event?.location_address}
              tableName={assignedTableName}
              response="maybe"
              qrData={qrData}
              themeColor={themeColor}
              isRTL={isRTL}
              removeWatermark={!!event?.tier_remove_watermark}
            />
          </PassCardReveal>

          <FadeInUp delay={0.6} y={10}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <CalendarButton event={event} isRTL={isRTL} />
              <ShareButton
                title={localizedTitle}
                text={isRTL ? `دعوة لحضور ${localizedTitle}` : `You're invited to ${localizedTitle}`}
                url={typeof window !== 'undefined' ? window.location.origin + '/' + slug : ''}
                isRTL={isRTL}
              />
            </div>
          </FadeInUp>
        </>
      )}

      {attending === 'no' && (
        <>
          <FadeInUp y={20}>
            <motion.span
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.2 }}
              style={{
                width: '72px', height: '72px', borderRadius: '50%', margin: '0 auto',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(160,154,145,0.14)', color: '#A09A91',
              }}
            >
              <EnvelopeIcon size={32} strokeWidth={1.4} />
            </motion.span>
          </FadeInUp>

          <FadeInUp delay={0.2} y={15}>
            <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '26px', fontWeight: 600, color: '#191B1E' }}>
              {isRTL ? 'شكراً لإعلامنا بقرارك' : 'Thank you for letting us know'}
            </h2>
          </FadeInUp>

          <FadeInUp delay={0.35} y={10}>
            <p style={{ color: '#77736A', maxWidth: '380px', margin: '0 auto', fontSize: '14px', lineHeight: 1.7 }}>{t.decline_success_desc}</p>
          </FadeInUp>

          {declineReason && (
            <FadeInUp delay={0.45} y={10}>
              <div style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.1)', padding: '14px 20px', borderRadius: '14px', display: 'inline-block', margin: '0 auto' }}>
                <span style={{ fontSize: '13px', color: '#77736A' }}>
                  {isRTL ? 'السبب: ' : 'Reason: '}<span style={{ fontWeight: 600, color: '#191B1E' }}>{declineReason}</span>
                </span>
              </div>
            </FadeInUp>
          )}

          <FadeInUp delay={0.5} y={5}>
            <RsvpDivider themeColor={themeColor} spacing={8} />
          </FadeInUp>

          <FadeInUp delay={0.55} y={10}>
            <p style={{ fontFamily: 'var(--font-serif)', fontSize: '15px', color: themeColor, fontStyle: 'italic', lineHeight: 1.6 }}>
              {isRTL ? 'نتمنى لك كل الخير ونأمل أن نلتقي في مناسبة قريبة' : 'We wish you all the best and hope to see you at a future celebration'}
            </p>
          </FadeInUp>
        </>
      )}

      <FadeInUp delay={0.8} y={5}>
        <RsvpDivider themeColor={themeColor} spacing={4} />
        <div style={{ paddingTop: '20px' }}>
          <Link href={`/${slug}`} style={{ color: themeColor, fontSize: '14px', fontWeight: 600, textDecoration: 'none', fontFamily: 'var(--font-sans)' }}>
            {t.return_btn}
          </Link>
        </div>
      </FadeInUp>

      {/* LAST on the screen, and after the "return to invitation" link on
          purpose: the guest's own business with this event is finished by the
          time they reach it. Renders nothing for a white-labelled event.
          Shown for a decline as well as an acceptance — somebody who cannot
          attend has still just seen what the product does. */}
      <CreateYourOwnEvent event={event} themeColor={themeColor} isRTL={isRTL} />
    </div>
  );
}
