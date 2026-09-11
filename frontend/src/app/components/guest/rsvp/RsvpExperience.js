'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import InvitationReveal from '../InvitationReveal';
import GuestPassCard from '../GuestPassGenerator';
import { GlassmorphismCard, PremiumButton, CalendarButton, ShareButton } from '../GuestUI';
import { ScaleIn, FadeInUp, ShimmerPlaceholder, ConfettiExplosion } from '../GuestAnimations';
import { useRsvpResolver, rememberGuest } from './useRsvpResolver';
import { useIdempotentRsvpSubmit } from './useIdempotentRsvpSubmit';
import { useSeatingLookup } from '../../../[slug]/rsvp/hooks/useSeatingLookup';
import SeatingResultPanel from '../../../[slug]/rsvp/steps/SeatingResultPanel';
import { CelebrateIcon, ClockIcon, EnvelopeIcon, CreditCardIcon, DoorIcon, SearchIcon, PencilIcon } from '../RsvpIcons';
import { useGuestAnalytics, GuestAnalyticsProvider } from '../../../utils/useGuestAnalytics';

/**
 * RsvpExperience — the unified orchestration engine for the entire guest RSVP
 * journey. ONE component owns resolution, the zero-flash loading skeleton, the
 * DigitalEnvelope intro, the bulletproof "already responded" lock, every terminal
 * status (closed / under review / unpaid / unavailable), and the single idempotent
 * submit. The actual input surface (one-click confirm OR the full multi-step form)
 * is supplied as a render-prop child, so all three entry contexts share one engine
 * while keeping their legitimately-different UX.
 *
 * Usage:
 *   <RsvpExperience context={{ kind: 'token', token }} lang="en">
 *     {(api) => <QuickConfirm {...api} />}
 *   </RsvpExperience>
 *
 *   <RsvpExperience context={{ kind: 'slug', slug, guestId, partyId }} envelope lang={lang}>
 *     {(api) => <RsvpWizard {...api} />}
 *   </RsvpExperience>
 *
 * Render-prop `api`: { event, guest, intendedResponse, allowEdits, context, isRTL,
 *                      submit, submitting, lock, rememberGuest }
 */

const STONE = '#77736A';

function Centered({ children }) {
  return (
    <div style={{ minHeight: '100dvh', background: '#F8F4EC', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: 'var(--font-sans)' }}>
      {children}
    </div>
  );
}

/** Zero-flash loading: an elegant skeleton — never mock/empty real data. */
function RsvpSkeleton() {
  return (
    <Centered>
      <div role="status" aria-busy="true" aria-label="Loading your invitation" style={{ maxWidth: '520px', width: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <ShimmerPlaceholder width="120px" height="14px" borderRadius="4px" />
          <ShimmerPlaceholder width="280px" height="30px" borderRadius="8px" />
          <ShimmerPlaceholder width="200px" height="14px" borderRadius="4px" />
          <div style={{ height: '8px' }} />
          <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
            <ShimmerPlaceholder width="100%" height="110px" borderRadius="16px" />
            <ShimmerPlaceholder width="100%" height="110px" borderRadius="16px" />
            <ShimmerPlaceholder width="100%" height="110px" borderRadius="16px" />
          </div>
          <ShimmerPlaceholder width="100%" height="52px" borderRadius="12px" />
        </div>
        <motion.p animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          style={{ color: STONE, fontSize: '13px', marginTop: '24px', fontWeight: 500, textAlign: 'center' }}>
          Preparing your invitation…
        </motion.p>
      </div>
    </Centered>
  );
}

/** Generic terminal status card (closed / under review / unpaid / unavailable).
 *  `onRetry` makes it non-terminal — used by the recoverable transient state,
 *  which must offer a way forward instead of reading as a dead invitation. */
function StatusCard({ icon, title, message, slug, onRetry, retryLabel }) {
  return (
    <Centered>
      <ScaleIn>
        <GlassmorphismCard bg="rgba(255,255,255,0.92)" hoverable={false} style={{ maxWidth: '440px', width: '100%', textAlign: 'center', padding: '48px 32px' }}>
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 12, delay: 0.15 }} style={{
            width: '76px', height: '76px', borderRadius: '50%', margin: '0 auto',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(184,148,79,0.1)', color: '#B8944F',
          }}>{icon}</motion.span>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '24px', fontWeight: 600, color: '#B8944F', marginTop: '12px' }}>{title}</h1>
          <p style={{ color: STONE, marginTop: '12px', fontSize: '14px', lineHeight: 1.7, fontWeight: 300 }}>{message}</p>
          {onRetry && (
            <div style={{ marginTop: '24px' }}>
              <PremiumButton variant="gold" onClick={onRetry}>{retryLabel || 'Try Again'}</PremiumButton>
            </div>
          )}
          {slug && (
            <div style={{ marginTop: onRetry ? '12px' : '24px' }}>
              <Link href={`/${slug}`} style={{ textDecoration: 'none' }}>
                <PremiumButton variant="outline">View Event Details</PremiumButton>
              </Link>
            </div>
          )}
        </GlassmorphismCard>
      </ScaleIn>
    </Centered>
  );
}

const STATUS_META = {
  yes:   { label: 'Attending', color: '#10b981', soft: 'rgba(16,185,129,0.1)',  Icon: CelebrateIcon },
  maybe: { label: 'Tentative', color: '#6366f1', soft: 'rgba(99,102,241,0.1)',  Icon: ClockIcon },
  no:    { label: 'Declined',  color: '#ef4444', soft: 'rgba(239,68,68,0.08)',  Icon: EnvelopeIcon },
};

/** The bulletproof read-only lock. The input form is NOT rendered here — the only
 *  way past it is the host-gated "Update my response" action (requirement #3). */
function RsvpLockedCard({ event, guest, allowEdits, isRTL, onEdit, onReset, seatingView, seatingLoading }) {
  const meta = STATUS_META[guest?.response] || STATUS_META.yes;
  const name = guest?.guest_name || '';
  // Edits are allowed "until the RSVP deadline" — honor both the host toggle and
  // the date client-side (the backend also rejects a late edit: RESPONSE_EDITS_CLOSED).
  const deadlinePassed = !!event?.rsvp_deadline && new Date() > new Date(event.rsvp_deadline);
  const canEdit = allowEdits && !deadlinePassed;
  return (
    <Centered>
      <ScaleIn>
        <GlassmorphismCard bg="rgba(255,255,255,0.94)" hoverable={false} style={{ maxWidth: '460px', width: '100%', textAlign: 'center', padding: '44px 34px' }}>
          <motion.span animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 0.8, delay: 0.2 }} style={{
            width: '80px', height: '80px', borderRadius: '50%', margin: '0 auto 12px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: meta.soft, color: meta.color,
          }}>
            <meta.Icon size={38} strokeWidth={1.5} />
          </motion.span>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '25px', fontWeight: 600, color: '#191B1E', marginBottom: '8px' }}>
            {isRTL ? 'أنت مسجّل بالفعل' : 'You’re already registered'}
          </h1>
          <p style={{ color: STONE, fontSize: '14px', lineHeight: 1.7, maxWidth: '360px', margin: '0 auto 18px' }}>
            {name ? (isRTL ? `شكراً ${name}، ` : `Thanks ${name}, `) : ''}
            {isRTL ? 'لدينا ردك بالفعل.' : 'we already have your response on file.'}
          </p>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 18px', borderRadius: '999px', background: meta.soft, border: `1px solid ${meta.color}33`, color: meta.color, fontWeight: 700, fontSize: '13px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: meta.color }} />
            {meta.label}
            {guest?.response === 'yes' && guest?.party_size > 1 && (
              <span style={{ color: STONE, fontWeight: 600 }}>· {isRTL ? `${guest.party_size} أشخاص` : `Party of ${guest.party_size}`}</span>
            )}
          </span>

          {(guest?.response === 'yes' || guest?.response === 'maybe') && event && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '24px' }}>
              <CalendarButton event={event} isRTL={isRTL} />
              <ShareButton title={event.title} text={isRTL ? `دعوة لحضور ${event.title}` : `You're invited to ${event.title}`} url={typeof window !== 'undefined' ? `${window.location.origin}/${event.slug}` : ''} isRTL={isRTL} />
            </div>
          )}

          {/* Entrance pass — a guest who confirmed "yes" and comes back later (the
              common case; most guests don't linger on the success screen) had no
              way to pull their real QR back up in-app before this. Same signed
              ticket the success screen and the emailed link use. */}
          {guest?.response === 'yes' && guest?.qrToken && event && (
            <div style={{ marginTop: '24px' }}>
              <GuestPassCard
                guestName={guest.guest_name}
                eventTitle={event.title}
                eventDate={event.event_date}
                eventTimezone={event.timezone}
                eventLocation={event.location_name || event.location_address}
                tableName={guest.table_name || null}
                response="yes"
                qrData={typeof window !== 'undefined' ? `${window.location.origin}/ticket/${guest.qrToken}` : null}
                themeColor={event?.custom_colors?.primary || '#B8944F'}
                isRTL={isRTL}
                removeWatermark={!!event?.tier_remove_watermark}
              />
            </div>
          )}

          {/* Seating map — a guest revisiting their (already-locked) invitation had no
              way to see where the organizer seated them; StepSuccess only ever showed
              this right after the original submit. Fetched in the parent effect below
              and rendered here whenever the lookup found a seated party. */}
          {guest?.response === 'yes' && (seatingLoading || seatingView) && (
            <div style={{ borderTop: '1px solid #F0ECE3', marginTop: '24px', paddingTop: '20px', textAlign: isRTL ? 'right' : 'left' }}>
              <SeatingResultPanel view={seatingView} loading={seatingLoading} isRTL={isRTL} />
            </div>
          )}

          <div style={{ borderTop: '1px solid #F0ECE3', marginTop: '24px', paddingTop: '20px' }}>
            {canEdit ? (
              <>
                <p style={{ fontSize: '12px', color: '#A09A91', lineHeight: 1.6, marginBottom: '14px' }}>
                  {isRTL ? 'تغيّرت خططك؟ يمكنك تحديث ردك قبل الموعد النهائي.' : 'Plans changed? You can update your response before the deadline.'}
                </p>
                <PremiumButton variant="outline" onClick={onEdit} icon={<PencilIcon size={15} />}>
                  {isRTL ? 'تحديث ردّي' : 'Update my response'}
                </PremiumButton>
              </>
            ) : allowEdits ? (
              <p style={{ fontSize: '12px', color: '#A09A91', lineHeight: 1.6 }}>
                {isRTL ? 'انتهى موعد تعديل الردود. يُرجى التواصل مع المضيف لأي تغيير.' : 'The deadline to change your response has passed — please reach out to your host directly.'}
              </p>
            ) : (
              <p style={{ fontSize: '12px', color: '#A09A91', lineHeight: 1.6 }}>
                {isRTL ? 'هل تحتاج إلى تعديل ردك؟ يُرجى التواصل مع المضيف مباشرةً.' : 'Need to change your response? Please reach out to your host directly.'}
              </p>
            )}
          </div>
          <div style={{ borderTop: '1px solid #F0ECE3', marginTop: '16px', paddingTop: '16px', textAlign: 'center' }}>
            <button
              onClick={onReset}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '12px', color: '#A09A91', fontFamily: 'var(--font-sans)',
                textDecoration: 'underline', textUnderlineOffset: '3px',
                transition: 'color 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#191B1E'}
              onMouseLeave={e => e.currentTarget.style.color = '#A09A91'}
            >
              {isRTL
                ? `لست ${name}؟ سجّل كشخص آخر`
                : `Not ${name}? RSVP as someone else`}
            </button>
          </div>
        </GlassmorphismCard>
      </ScaleIn>
    </Centered>
  );
}

/**
 * The standalone /[slug]/rsvp route's half of the engagement tracking.
 *
 * Same job as the wrapper on EventPageClient, and the same reason for being a
 * wrapper: the component below has nine early returns, so a provider placed
 * inside it would cover some phases and not others. It renders CalendarButton,
 * ShareButton and the guest pass, and calls useSeatingLookup in its own body —
 * all of which read this tracker from context.
 */
export default function RsvpExperience({ context, ...rest }) {
  /* The resolver is called HERE, one level up, rather than in the component
     below — and that is the whole reason this wrapper can exist without any
     extra state or an effect.

     The slug is not always known up front. `{ kind: 'slug' }` (public link,
     private SMS ?g=, invite ?party_id=) carries it; `{ kind: 'token' }`, the
     one-click link in an email, carries only a signed token and the slug is not
     known until the event resolves. Reading it off the engine covers both, and
     the engine is a hook called exactly once either way — lifting it changes
     nothing about how many times the event is fetched. */
  const engine = useRsvpResolver(context);
  const { trackEvent } = useGuestAnalytics(engine.event?.slug || context?.slug || '');

  return (
    <GuestAnalyticsProvider trackEvent={trackEvent}>
      <RsvpExperienceInner context={context} engine={engine} {...rest} />
    </GuestAnalyticsProvider>
  );
}

function RsvpExperienceInner({ context, engine, lang = 'en', envelope = false, children }) {
  const isRTL = lang === 'ar';
  const reduceMotion = useReducedMotion();

  // DigitalEnvelope intro — plays every time this page loads (no "seen before"
  // memory, consistent with the main event page's envelope), and never when
  // the guest prefers reduced motion. Shown only for the rich (slug) experience.
  const [envelopeDismissed, setEnvelopeDismissed] = useState(false);
  // Also off when the organizer has switched the envelope off for this event
  // (events.reveal_enabled). `!== false` so a payload predating the column
  // keeps the reveal rather than silently losing it.
  //
  // NOTE: reveal_replay is deliberately NOT read here. It governs the
  // invitation page, where the envelope is the arrival moment. This one gates
  // a form the guest is part-way through, so it stays once-per-session
  // regardless — replaying it on every refresh mid-RSVP would be hostile.
  const envelopeOpen = !!envelope && !reduceMotion && engine.phase !== 'resolving'
    && !!engine.event && engine.event.reveal_enabled !== false && !envelopeDismissed;

  const closeEnvelope = () => setEnvelopeDismissed(true);

  // The single idempotent submit. A duplicate/already-responded result ALWAYS locks
  // centrally — the child never has to reimplement the lock.
  const { submit, submitting } = useIdempotentRsvpSubmit({
    onLocked: (data) => engine.lock({ response: data.response, guest_name: data.guestName }),
    messages: {
      closed: isRTL ? 'هذا الحدث لم يعد يستقبل الردود.' : 'This event is no longer accepting RSVPs.',
      full:   isRTL ? 'اكتمل عدد الضيوف. يُرجى التواصل مع المضيف.' : 'This event has reached its guest limit. Please contact the host.',
      failed: isRTL ? 'تعذّر حفظ ردك. تحقق من اتصالك وحاول مرة أخرى.' : 'We couldn’t save your RSVP. Please check your connection and try again.',
    },
  });

  // A guest who already responded 'yes' lands straight on the locked card (never
  // back in <RsvpWizard>), so this is the only chance to show them where the
  // organizer seated them. `fetchSeatingMap` isn't memoized (new fn each render of
  // the hook), so it's deliberately left out of the deps array in favor of a
  // fetched-once-per-party ref — including it would re-fire this effect on every
  // render once seatingView's setState triggers a re-render.
  const seatingApi = useSeatingLookup(engine.event?.slug);
  const seatingFetchedFor = useRef(null);
  useEffect(() => {
    const partyId = engine.guest?.id;
    if (engine.phase === 'locked' && engine.guest?.response === 'yes' && partyId && seatingFetchedFor.current !== partyId) {
      seatingFetchedFor.current = partyId;
      seatingApi.fetchSeatingMap(partyId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.phase, engine.guest?.id, engine.guest?.response]);

  // ── Zero-flash gate: never render the child (or mock data) until resolved ──
  if (engine.phase === 'resolving') return <RsvpSkeleton />;

  if (engine.phase === 'paymentRequired') return <StatusCard icon={<CreditCardIcon size={34} strokeWidth={1.5} />} title={isRTL ? 'الفعالية غير مفعّلة' : 'Event Unpaid'} message={isRTL ? 'هذه الصفحة غير متاحة حالياً.' : 'This event page is offline pending activation.'} />;
  if (engine.phase === 'underReview')   return <StatusCard icon={<CelebrateIcon size={34} strokeWidth={1.5} />} title={isRTL ? 'جاهز قريباً' : 'Almost Ready'} message={isRTL ? 'تتم مراجعة هذه الدعوة وستكون جاهزة قريباً.' : 'This invitation is getting its final touches and will be live shortly.'} />;
  if (engine.phase === 'closed')        return <StatusCard icon={<DoorIcon size={34} strokeWidth={1.5} />} title={isRTL ? 'انتهت فترة الرد' : 'RSVPs Are Closed'} message={isRTL ? 'لم يعد بالإمكان الرد على هذه الدعوة.' : 'Responses are no longer being accepted for this event.'} slug={engine.event?.slug} />;
  if (engine.phase === 'unavailable')   return <StatusCard icon={<SearchIcon size={34} strokeWidth={1.5} />} title={isRTL ? 'الدعوة غير متاحة' : 'Invitation Unavailable'} message={engine.error || (isRTL ? 'تعذّر العثور على هذه الدعوة.' : 'This invitation could not be found.')} />;
  // Recoverable, unlike every other status above: the guest's link is valid, the
  // server just couldn't answer this instant (throttled, restarting, flaky link).
  // Offer a retry rather than reporting a dead invitation.
  if (engine.phase === 'temporarilyUnavailable') return (
    <StatusCard
      icon={<ClockIcon size={34} strokeWidth={1.5} />}
      title={isRTL ? 'لحظة من فضلك' : 'Just a moment'}
      message={isRTL
        ? 'تعذّر تحميل الدعوة الآن. الرابط سليم — برجاء المحاولة مرة أخرى بعد ثوانٍ.'
        : 'We couldn’t load this invitation right now. Your link is fine — please try again in a few seconds.'}
      onRetry={engine.refetch}
      retryLabel={isRTL ? 'إعادة المحاولة' : 'Try Again'}
    />
  );

  const envelopeOverlay = envelopeOpen && engine.event ? (
    <InvitationReveal
      mode="rsvp"
      event={engine.event}
      guestName={engine.guest?.guest_name || ''}
      lang={lang}
      sessionKey={engine.event?.slug}
      onComplete={closeEnvelope}
    />
  ) : null;

  if (engine.phase === 'locked') {
    return (
      <>
        <RsvpLockedCard event={engine.event} guest={engine.guest} allowEdits={engine.allowEdits} isRTL={isRTL} onEdit={engine.openEdit} onReset={() => {
          const slug = engine.event?.slug;
          if (slug && typeof window !== 'undefined') {
            try { window.localStorage.removeItem(`fancy_rsvp_${slug}`); } catch {}
          }
          engine.refetch();
        }} seatingView={seatingApi.seatingView} seatingLoading={seatingApi.seatingLoading} />
        {envelopeOverlay}
      </>
    );
  }

  // phase === 'ready' → hand control to the input surface with the unified api.
  return (
    <>
      {children({
        event: engine.event,
        guest: engine.guest,
        intendedResponse: engine.intendedResponse,
        allowEdits: engine.allowEdits,
        context,
        isRTL,
        submit,
        submitting,
        lock: engine.lock,
        rememberGuest,
      })}
      {envelopeOverlay}
    </>
  );
}

export { ConfettiExplosion };
