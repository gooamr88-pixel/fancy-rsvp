'use client';

import React, { useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import HeritageArchPage from './heritageArch/HeritageArchPage';
import InvitationReveal from '../guest/InvitationReveal';
import VelvetBoxOpening from '../guest/openings/VelvetBoxOpening';
import KnockDoorOpening from '../guest/openings/KnockDoorOpening';
import WaxEnvelopeOpening from '../guest/openings/WaxEnvelopeOpening';
import SealedLetterOpening from '../guest/openings/SealedLetterOpening';
import { getCinematicTemplate, getCinematicOccasion } from './cinematic/cinematicThemes';

/* Keyed, not chosen by a ternary — see CINEMATIC_OPENINGS in
   [slug]/EventPageClient.js. Statically imported rather than dynamic(): this
   file is already inside the organizer bundle, and a preview that has to
   round-trip for a chunk before the cover appears defeats the point of it. */
const CINEMATIC_OPENINGS = {
  velvetBox: VelvetBoxOpening,
  knockDoor: KnockDoorOpening,
  waxEnvelope: WaxEnvelopeOpening,
  sealedLetter: SealedLetterOpening,
};
import { translations } from '../../utils/translations';
// From the shared util, NOT from [slug]/EventPageClient. Importing one named
// export from that module still evaluates it, which pulled the whole guest
// route — GuestUI, GuestAnimations, LegacyChrome, the analytics hooks — into
// the create-event bundle.
import { buildInvitationCardData } from '../../utils/invitationCardData';

/* ═══════════════════════════════════════════════════════════════
   The guest experience, rendered for the organizer.

   THE ONE RULE: this file must never draw anything. Every pixel comes from
   the components a guest actually receives — the same opening, the same hero,
   the same sections in the same order, the same RSVP form with the same
   custom questions. The moment a preview renders its own version of the page
   it can drift from the page, and a preview that has drifted is worse than no
   preview at all: it is a confident answer to the wrong question.

   That is not hypothetical here. The component this replaces was labelled
   "Live Guest Journey" and drew a scene of its own, complete with a hardcoded
   venue — so an organizer could fill in every field of the wizard and still be
   shown "The Grand Ballroom · Plaza Hotel, New York".

   What it deliberately leaves out is everything that only means something for
   a real guest:

     ANALYTICS      an organizer opening this twenty times while choosing a
                    template must not appear in their own funnel.
     GUEST IDENTITY no localStorage, no remembered party — nobody is being
                    identified, so `guestRsvp` stays null and the form is the
                    blank one a first-time guest meets.
     MUSIC          `hasBackgroundMusic={false}`. A wizard panel that starts
                    playing audio is a bug report, not a feature.
     SUBMISSION     RsvpSection's own `isPreview` stops at validation — see
                    the note there for why it stops AFTER validating and not
                    before.
   ═══════════════════════════════════════════════════════════════ */

/* One frozen empty object rather than a fresh `{}` per reset: an identity that
   changes is a re-render of everything below that reads it, to say the same
   nothing. */
const NO_COUNTDOWN = Object.freeze({});

/** Same arithmetic as EventPageClient's countdown, so the numbers agree. */
function useCountdown(eventDate) {
  /* "No date yet" and "an unparseable date" are answered from the props during
     the render that asks, not by an effect that pushes an empty object in
     afterwards — there is nothing external to synchronise with in that case. */
  const target = eventDate ? +new Date(eventDate) : null;
  const live = target !== null && target !== 0 && !Number.isNaN(target);

  const [timeLeft, setTimeLeft] = useState(NO_COUNTDOWN);

  useEffect(() => {
    if (!live) return undefined;
    let timer;
    const tick = () => {
      const difference = target - Date.now();
      if (difference <= 0) { setTimeLeft(NO_COUNTDOWN); clearInterval(timer); return; }
      setTimeLeft({
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((difference / 1000 / 60) % 60),
        seconds: Math.floor((difference / 1000) % 60),
      });
    };
    tick();
    timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [target, live]);

  return live ? timeLeft : NO_COUNTDOWN;
}

/** The recipient's name printed on the envelope / carved on the cover. */
const PREVIEW_ADDRESSEE = { en: 'Sarah Al-Mansouri', ar: 'سارة المنصوري' };

export default function GuestExperiencePreview({
  event,
  lang: langProp,
  onLangChange,
  /* The recipient. Real invitations are addressed — the envelope prints the
     name on its face and the card reserves a seat for it — so previewing with
     an anonymous guest hides half of what the organizer is checking. The
     wizard exposes this as an editable field; the fallback is a sample name,
     never a couple (a couple here reads as the invitation being addressed to
     the people sending it). */
  guestName,
  // Whether to play the opening. The wizard's inline phone starts past it (the
  // organizer is comparing templates, not re-watching a cover each time they
  // click one); the full-screen preview starts at the arrival.
  playOpening = true,
  // Bumping this remounts the opening. The openings are one-shot by design —
  // they call onComplete exactly once — so replaying means a fresh mount, not
  // a reset. Same contract as EventSettings' RevealPreviewModal.
  replayKey = 0,
  /* Fill empty sections with sample content.
     TRUE in Stage 1, where the organizer is judging a template and has typed
     nothing — a page of hidden sections shows them nothing to judge.
     FALSE in Stage 2, where the question is "what will my guests actually
     get" and an invented itinerary answers a different one. Defaults to false
     because showing someone content they did not write is the mistake worth
     making harder. */
  showSampleContent = false,
  embedded = true,
  invitationPattern,
  invitationTheme,
  /* Optional override. Left out — the normal case — the card's data is built
     through the guest page's own buildInvitationCardData, so the card inside
     the hero can never disagree with the page around it. Passing nothing at
     all is the dangerous option: InvitationCard then falls back to its demo
     copy and advertises a venue the organizer never typed. */
  invitationData: invitationDataProp,
}) {
  // Controlled when the caller supplies a language (the modal's EN/AR toggle),
  // self-managed otherwise, so the guest page's own language pill still works.
  const [internalLang, setInternalLang] = useState('en');
  const lang = langProp ?? internalLang;
  const setLang = onLangChange ?? setInternalLang;

  const isRTL = lang === 'ar';
  const t = translations[lang];
  const timeLeft = useCountdown(event?.event_date);

  const cinematic = getCinematicTemplate(event?.template_type);
  const CinematicOpening = cinematic ? CINEMATIC_OPENINGS[cinematic.opening] : null;
  const occasion = getCinematicOccasion(cinematic, event?.template_data);
  const [openingDone, setOpeningDone] = useState(!playOpening);

  /* A fresh replayKey re-arms the opening; a change to playOpening (the inline
     phone's stepper moving between "envelope" and "opened") follows it too.

     Re-armed during the render that changes them, React's documented shape for
     resetting state on a prop change. As an effect it painted one frame of the
     PREVIOUS arm state first — for the stepper that is a visible flash of the
     opened page before the envelope, on the one control whose whole job is to
     show the organizer the envelope. */
  const armKey = `${replayKey}|${playOpening ? 1 : 0}`;
  const [armedFor, setArmedFor] = useState(armKey);
  if (armedFor !== armKey) {
    setArmedFor(armKey);
    setOpeningDone(!playOpening);
  }

  if (!event) return null;

  const addressee = (guestName || '').trim() || PREVIEW_ADDRESSEE[isRTL ? 'ar' : 'en'];
  const invitationData = invitationDataProp ?? buildInvitationCardData(event, isRTL);
  const openingNames = (() => {
    const td = event.template_data || {};
    if (isRTL && (event.title_ar || td.title_ar)) return event.title_ar || td.title_ar;
    const a = td.groom_name || td.partner1Name || td.partner1;
    const b = td.bride_name || td.partner2Name || td.partner2;
    return a && b ? `${a} & ${b}` : (event.title || '');
  })();

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <HeritageArchPage
        event={event}
        guestRsvp={null}
        lang={lang}
        setLang={setLang}
        isRTL={isRTL}
        t={t}
        timeLeft={timeLeft}
        musicPlaying={false}
        toggleMusic={() => {}}
        hasBackgroundMusic={false}
        hasResponded={false}
        responseStatus={null}
        allowGuestEdits={!!event.allow_guest_edits}
        slug={event.slug || 'preview'}
        effectiveRsvpId={null}
        trackEvent={() => {}}
        invitationPattern={invitationPattern}
        invitationTheme={invitationTheme}
        invitationGuestName={addressee}
        invitationData={invitationData}
        isPreview={showSampleContent}
        // Never negotiable, whichever surface mounts this: no preview may
        // write. The event may not even exist on the server yet.
        readOnly
        embedded={embedded}
        // So Swan Lake's hero blooms out of its embossed state as the cover
        // dissolves here too, rather than the organizer only ever seeing the
        // finished picture and never the transition they are buying.
        openingActive={!openingDone}
      />

      {/* Layered over the page, exactly as the real router layers it — so the
          organizer sees the cover dissolve into the hero rather than the two
          as separate screens. */}
      <AnimatePresence>
        {!openingDone && (
          CinematicOpening ? (
            <CinematicOpening
              key={`opening-${replayKey}`}
              template={cinematic}
              names={openingNames}
              lang={lang}
              occasion={occasion}
              sessionKey={null}
              onComplete={() => setOpeningDone(true)}
            />
          ) : (
            <InvitationReveal
              key={`opening-${replayKey}`}
              embedded
              mode="invitation"
              event={event}
              guestName={addressee}
              lang={lang}
              onComplete={() => setOpeningDone(true)}
            />
          )
        )}
      </AnimatePresence>
    </div>
  );
}
