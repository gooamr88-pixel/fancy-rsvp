'use client';

import React, { useCallback, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useFullPageTheme } from '../theme';
import { SectionShell, SectionHeading, ScrollToRsvpHint } from '../shared';
import { useTrackGuestAction } from '../../../../utils/useGuestAnalytics';

export default function GallerySection({ images, isRTL }) {
  const C = useFullPageTheme();
  const [index, setIndex] = useState(0);

  /* ═══ `gallery_viewed` ═══
     This template's gallery is an inline carousel sitting in the page flow —
     there is no lightbox and therefore NO "opened it" moment to report. The
     beacon was originally wired into GuestUI's GalleryLightbox, which only the
     other (continuous-scroll) page ever renders, so this template — the one
     nearly every event actually uses — reported nothing and the organizer's
     "Opened the gallery" count sat at zero for good.

     Mounting is not the signal either: the section is always mounted once the
     guest reaches it, so firing on mount would count scrolling past it.
     Advancing a photo IS a deliberate act, so the FIRST arrow press is the
     honest "this guest looked at the photos" moment.

     Once per mount, hence the ref: an organizer's count of guests who browsed
     the gallery must not be a count of how many times they pressed an arrow.
     (GalleryLightbox reports once per open for the same reason.)

     Hooks sit above the empty-images early return below — a hook after a
     conditional return is a different hook order on the next render. */
  const trackAction = useTrackGuestAction();
  const browsedRef = useRef(false);
  const reportBrowsed = useCallback(() => {
    if (browsedRef.current) return;
    browsedRef.current = true;
    trackAction('gallery_viewed');
  }, [trackAction]);

  if (!images || images.length === 0) return null;

  const next = () => { reportBrowsed(); setIndex((i) => (i + 1) % images.length); };
  const prev = () => { reportBrowsed(); setIndex((i) => (i - 1 + images.length) % images.length); };

  return (
    <SectionShell background={C.paper}>
      <SectionHeading subtitle={isRTL ? 'لحظات نعتز بها' : 'Moments we treasure'} isRTL={isRTL}>
        {isRTL ? 'معرض الصور' : 'Photo Gallery'}
      </SectionHeading>

      <div style={{ position: 'relative', width: '100%', maxWidth: '420px', aspectRatio: '4/5', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 24px 60px rgba(58,42,34,0.25)' }}>
        <AnimatePresence mode="wait">
          <motion.img
            key={index}
            src={images[index]}
            alt={`Gallery photo ${index + 1}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </AnimatePresence>

        {/* Soft fabric-curtain flaps framing the photo, fading into it at the center */}
        <div aria-hidden="true" style={curtainStyle('left')} />
        <div aria-hidden="true" style={curtainStyle('right')} />

        {images.length > 1 && (
          <>
            <button type="button" onClick={prev} aria-label="Previous photo" style={navBtnStyle('left')}>‹</button>
            <button type="button" onClick={next} aria-label="Next photo" style={navBtnStyle('right')}>›</button>
          </>
        )}
      </div>

      <ScrollToRsvpHint isRTL={isRTL} />
    </SectionShell>
  );
}

function navBtnStyle(side) {
  return {
    position: 'absolute', top: '50%', transform: 'translateY(-50%)', [side]: '10px',
    width: '38px', height: '38px', borderRadius: '50%', border: 'none',
    background: 'rgba(255,255,255,0.85)', color: '#3A2A22', fontSize: '20px', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2,
  };
}

function curtainStyle(side) {
  const isLeft = side === 'left';
  const fold = `repeating-linear-gradient(${isLeft ? '95deg' : '85deg'}, rgba(255,253,248,0.96) 0px, rgba(232,222,198,0.82) 9px, rgba(255,253,248,0.96) 18px)`;
  const fade = `linear-gradient(to ${isLeft ? 'right' : 'left'}, black 0%, black 30%, transparent 100%)`;
  return {
    position: 'absolute', top: 0, bottom: 0, [side]: 0, width: '26%', zIndex: 1,
    background: fold,
    WebkitMaskImage: fade, maskImage: fade,
    boxShadow: isLeft ? '8px 0 20px rgba(40,26,18,0.18)' : '-8px 0 20px rgba(40,26,18,0.18)',
  };
}
