'use client';

import React, { useState, useRef, useEffect, useCallback, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ConfettiExplosion } from './GuestAnimations';
import { lighten, darken } from '../../utils/color';
import { isWhiteLabel } from '../../utils/guestBranding';
import { viewOf } from '../../utils/frameDocument';
import { useModalA11y } from '../../hooks/useModalA11y';
import { CelebrateIcon, ClockIcon, EnvelopeIcon, CalendarIcon, CheckIcon, LinkIcon } from './RsvpIcons';

/* ═══════════════════════════════════════════════════════════════
   FANCY RSVP — Premium Guest UI Component Library
   Shared components for the guest experience
   ═══════════════════════════════════════════════════════════════ */

// ─── GlassmorphismCard ───
export function GlassmorphismCard({
  children, style = {}, className = '', onClick, hoverable = true,
  bg = 'rgba(255, 255, 255, 0.85)', blur = 16, border = 'rgba(255,255,255,0.3)',
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <motion.div
      className={className}
      onClick={onClick}
      onMouseEnter={() => hoverable && setHovered(true)}
      onMouseLeave={() => hoverable && setHovered(false)}
      animate={hovered ? { y: -4, boxShadow: '0 20px 60px rgba(0,0,0,0.12)' } : { y: 0, boxShadow: '0 8px 32px rgba(0,0,0,0.06)' }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      style={{
        background: bg,
        backdropFilter: `blur(${blur}px)`,
        WebkitBackdropFilter: `blur(${blur}px)`,
        border: `1px solid ${border}`,
        borderRadius: '20px',
        padding: '32px',
        ...style,
      }}
    >
      {children}
    </motion.div>
  );
}

// ─── PremiumButton ───
export function PremiumButton({
  children, onClick, disabled = false, variant = 'gold', size = 'md', fullWidth = false,
  style = {}, icon, loading = false, testId, accentColor,
}) {
  const variants = {
    gold: accentColor
      // When the caller passes the event's own theme color, override the
      // otherwise-fixed gold CTA fill so this button (the actual RSVP submit/
      // continue action) isn't permanently gold for every non-gold event.
      // Darkened for contrast the same way the fixed gold value was chosen
      // (DES-1: white text must stay AA-safe against the fill).
      ? {
          bg: darken(accentColor, 0.15), hoverBg: darken(accentColor, 0.3), color: '#FFFFFF',
          shadow: `0 8px 25px ${accentColor}4D`,
          glow: `0 0 30px ${accentColor}33`,
        }
      : {
          // DES-1: contrast-safe CTA gold (white text = 4.86:1, passes AA).
          bg: '#8A6D34', hoverBg: '#765C2B', color: '#FFFFFF',
          shadow: '0 8px 25px rgba(184, 148, 79, 0.3)',
          glow: '0 0 30px rgba(184, 148, 79, 0.2)',
        },
    dark: {
      bg: '#191B1E', hoverBg: '#2a2d32', color: '#D7BE80',
      shadow: '0 8px 25px rgba(25, 27, 30, 0.3)',
      glow: '0 0 30px rgba(25, 27, 30, 0.15)',
    },
    outline: {
      bg: 'transparent', hoverBg: '#191B1E', color: '#191B1E',
      shadow: 'none', glow: 'none', border: '2px solid #191B1E', hoverColor: '#FFFFFF',
    },
    ghost: {
      // DES-1: gold text on a light surface must use the contrast-safe gold.
      bg: 'transparent', hoverBg: 'rgba(184, 148, 79, 0.08)', color: '#8A6D34',
      shadow: 'none', glow: 'none',
    },
    'outline-light': {
      bg: 'transparent', hoverBg: '#FFFFFF', color: '#FFFFFF', hoverColor: '#121212',
      shadow: '0 8px 25px rgba(255, 255, 255, 0.2)', glow: 'none', border: '1.5px solid rgba(255, 255, 255, 0.5)',
    },
    'ghost-light': {
      bg: 'transparent', hoverBg: 'rgba(255, 255, 255, 0.1)', color: 'rgba(255, 255, 255, 0.85)', hoverColor: '#FFFFFF',
      shadow: 'none', glow: 'none',
    },
    'outline-gold': {
      bg: 'transparent', hoverBg: '#D7BE80', color: '#D7BE80', hoverColor: '#121212',
      shadow: '0 8px 25px rgba(215, 190, 128, 0.25)', glow: 'none', border: '1.5px solid rgba(215, 190, 128, 0.5)',
    },
    'ghost-gold': {
      bg: 'transparent', hoverBg: 'rgba(215, 190, 128, 0.1)', color: '#D7BE80', hoverColor: '#FFFFFF',
      shadow: 'none', glow: 'none',
    },
  };

  const sizes = {
    sm: { padding: '10px 20px', fontSize: '12px' },
    md: { padding: '14px 32px', fontSize: '14px' },
    lg: { padding: '18px 40px', fontSize: '16px' },
  };

  const v = variants[variant] || variants.gold;
  const s = sizes[size];

  return (
    <motion.button
      data-testid={testId}
      onClick={onClick}
      disabled={disabled || loading}
      whileHover={disabled ? {} : {
        scale: 1.02, y: -2,
        boxShadow: v.shadow,
        backgroundColor: v.hoverBg,
        color: v.hoverColor || v.color,
      }}
      whileTap={disabled ? {} : { scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
        padding: s.padding, fontSize: s.fontSize,
        minHeight: '44px', // MOB-2: minimum touch target
        background: v.bg, color: v.color,
        border: v.border || 'none', borderRadius: '12px',
        fontWeight: 700, fontFamily: 'var(--font-sans)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        letterSpacing: '0.03em',
        width: fullWidth ? '100%' : 'auto',
        transition: 'background 0.2s, color 0.2s',
        ...style,
      }}
    >
      {loading ? (
        <div style={{
          width: '18px', height: '18px', border: '2px solid transparent',
          borderTop: `2px solid ${v.color}`, borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
      ) : (
        <>
          {icon && <span style={{ fontSize: '1.1em' }}>{icon}</span>}
          {children}
        </>
      )}
    </motion.button>
  );
}

// ─── BentoCard ───
export function BentoCard({
  children, style = {}, className = '', bg = 'rgba(255, 255, 255, 0.85)',
  border = 'rgba(232,226,214,0.6)', glowColor = 'rgba(184, 148, 79, 0.1)', delay = 0
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <motion.div
      className={className}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.6, delay, type: 'spring', stiffness: 100 }}
      animate={hovered ? { y: -4, boxShadow: `0 20px 40px rgba(0,0,0,0.08), 0 0 20px ${glowColor}` } : { y: 0, boxShadow: '0 8px 32px rgba(0,0,0,0.04)' }}
      style={{
        background: bg,
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: `1px solid ${border}`,
        borderRadius: '24px',
        padding: '32px',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      {children}
    </motion.div>
  );
}

// ─── MagneticButton ───
export function MagneticButton({
  children, onClick, variant = 'gold', size = 'md', fullWidth = false,
  style = {}, icon, disabled = false, testId
}) {
  const containerRef = useRef(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e) => {
    if (!containerRef.current || disabled) return;
    const { clientX, clientY } = e;
    const { height, width, left, top } = containerRef.current.getBoundingClientRect();
    const middleX = clientX - (left + width / 2);
    const middleY = clientY - (top + height / 2);
    setPosition({ x: middleX * 0.2, y: middleY * 0.2 });
  };

  const reset = () => setPosition({ x: 0, y: 0 });

  const { x, y } = position;

  return (
    <motion.div
      ref={containerRef}
      style={{ display: fullWidth ? 'block' : 'inline-block', position: 'relative' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={reset}
      animate={{ x, y }}
      transition={{ type: 'spring', stiffness: 150, damping: 15, mass: 0.1 }}
    >
      <PremiumButton
        testId={testId}
        variant={variant}
        size={size}
        fullWidth={fullWidth}
        style={style}
        icon={icon}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </PremiumButton>
    </motion.div>
  );
}


// ─── AttendanceCard: Interactive attendance choice ───
/* AttendanceCard renders in two weights so the three responses aren't three
   equal boxes competing for attention: "yes" is the emotionally-primary
   answer a wedding invitation is written to receive, so it gets the large,
   theme-colored hero treatment; "maybe"/"no" are real, necessary options but
   sit as quieter secondary chips beneath it. `accentColor` (the event's own
   theme color) drives the "yes" card so it matches the invitation itself
   instead of a fixed green. */
export function AttendanceCard({ type, selected, onClick, isRTL = false, variant = 'primary', accentColor = '#10b981' }) {
  const configs = {
    yes: {
      Icon: CelebrateIcon, label: isRTL ? 'سأحضر بكل سرور' : 'Joyfully Accept',
      subtitle: isRTL ? 'أتطلع للمشاركة في هذه المناسبة الجميلة' : 'I look forward to celebrating with you',
      borderColor: accentColor, glowColor: `${accentColor}33`,
    },
    maybe: {
      Icon: ClockIcon, label: isRTL ? 'ربما' : 'Tentative',
      borderColor: '#6366f1', glowColor: 'rgba(99,102,241,0.18)',
    },
    no: {
      Icon: EnvelopeIcon, label: isRTL ? 'أعتذر' : "Can't make it",
      borderColor: '#A09A91', glowColor: 'rgba(160,154,145,0.15)',
    },
  };

  const config = configs[type];
  const isSelected = selected === type;

  // A quick sparkle right when "Yes" is picked — the guest shouldn't have to
  // wait until final submit to feel something happen.
  const [celebrate, setCelebrate] = useState(false);
  const handleClick = () => {
    const wasAlreadySelected = selected === type;
    onClick(type);
    if (wasAlreadySelected) return;
    if (type === 'yes') {
      setCelebrate(true);
      setTimeout(() => setCelebrate(false), 1000);
    }
  };
  const sparkle = celebrate && (
    <ConfettiExplosion
      active duration={950} particleCount={46} spread={0.45}
      colors={[accentColor, lighten(accentColor, 0.35), lighten(accentColor, 0.7), '#FFFFFF']}
      shapes={['star', 'circle']}
    />
  );

  if (variant === 'compact') {
    return (
      <>
        <motion.button
          data-testid={`attendance-${type}`}
          aria-pressed={isSelected}
          aria-label={config.label}
          onClick={handleClick}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.97 }}
          animate={isSelected ? {
            borderColor: config.borderColor,
            boxShadow: `0 6px 18px ${config.glowColor}`,
          } : {
            borderColor: '#E8E2D6',
            boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
          }}
          transition={{ type: 'spring', stiffness: 300, damping: 24 }}
          style={{
            width: '100%', padding: '13px 10px',
            border: `1.5px solid ${isSelected ? config.borderColor : '#E8E2D6'}`,
            borderRadius: '12px', textAlign: 'center',
            background: isSelected ? `${config.borderColor}0D` : '#FFFFFF',
            cursor: 'pointer', fontFamily: 'var(--font-sans)',
            display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: '7px',
          }}
        >
          <span style={{ display: 'flex', color: isSelected ? config.borderColor : '#9A958A' }}>
            <config.Icon size={17} />
          </span>
          <span style={{ fontWeight: 600, fontSize: '13px', color: isSelected ? config.borderColor : '#4A463F' }}>
            {config.label}
          </span>
        </motion.button>
        {sparkle}
      </>
    );
  }

  return (
    <>
    <motion.button
      data-testid={`attendance-${type}`}
      aria-pressed={isSelected}
      aria-label={config.label}
      onClick={handleClick}
      whileHover={{ scale: 1.01, y: -3 }}
      whileTap={{ scale: 0.98 }}
      animate={isSelected ? {
        borderColor: config.borderColor,
        boxShadow: `0 0 34px ${config.glowColor}, 0 14px 40px rgba(0,0,0,0.08)`,
      } : {
        borderColor: `${config.borderColor}55`,
        boxShadow: '0 6px 20px rgba(0,0,0,0.05)',
      }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      style={{
        width: '100%', padding: '24px 20px',
        border: `2px solid ${isSelected ? config.borderColor : `${config.borderColor}55`}`,
        borderRadius: '18px', textAlign: isRTL ? 'right' : 'left',
        background: isSelected
          ? `linear-gradient(135deg, ${config.borderColor}14, ${config.borderColor}04)`
          : `linear-gradient(135deg, ${config.borderColor}08, transparent)`,
        cursor: 'pointer', fontFamily: 'var(--font-sans)',
        display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '16px',
      }}
    >
      <motion.span
        animate={isSelected ? { scale: [1, 1.08, 1] } : { scale: 1 }}
        transition={{ duration: 0.5 }}
        style={{
          width: '52px', height: '52px', borderRadius: '50%', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `${config.borderColor}14`, color: config.borderColor,
        }}
      >
        <config.Icon size={26} strokeWidth={1.5} />
      </motion.span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 700, fontSize: '16px', color: isSelected ? config.borderColor : '#191B1E' }}>
          {config.label}
        </span>
        <span style={{ fontSize: '12px', color: '#77736A', fontWeight: 400, lineHeight: 1.4 }}>
          {config.subtitle}
        </span>
      </span>
      <motion.div
        initial={false}
        animate={isSelected ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 15 }}
        style={{
          width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0,
          background: config.borderColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#FFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </motion.div>
    </motion.button>
    {sparkle}
    </>
  );
}

// ─── ProgressBar: Animated step progress ───
export function ProgressBar({ currentStep, totalSteps, color = '#B8944F' }) {
  const progress = (currentStep / totalSteps) * 100;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '28px' }}>
      <div style={{
        height: '4px', borderRadius: '2px', background: '#F0ECE3', overflow: 'hidden',
      }}>
        <motion.div
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
          style={{ height: '100%', borderRadius: '2px', background: color }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '6px' }}>
        {Array.from({ length: totalSteps }, (_, i) => (
          <motion.div
            key={i}
            animate={{
              width: currentStep >= i + 1 ? '20px' : '8px',
              background: currentStep >= i + 1 ? color : '#E8E2D6',
            }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            style={{ height: '8px', borderRadius: '4px' }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── GalleryLightbox: Full-screen image viewer ───
export function GalleryLightbox({ images, initialIndex = 0, onClose }) {
  const [current, setCurrent] = useState(initialIndex);
  const touchStartX = useRef(0);

  const next = useCallback(() => setCurrent(i => (i + 1) % images.length), [images.length]);
  const prev = useCallback(() => setCurrent(i => (i - 1 + images.length) % images.length), [images.length]);

  const dialogRef = useModalA11y(true, { onClose });

  // Escape-to-close, focus trap, initial focus, and scroll lock are handled
  // by the shared useModalA11y hook — this effect only owns the
  // arrow-key gallery navigation, which isn't part of that hook's contract.
  useEffect(() => {
    /* Bound to the dialog's OWN window. In the organizer's preview this page
       is portalled into an iframe (components/templates/PreviewFrame.js) and
       the key events fire on the frame's document, which never reaches the
       dashboard's `window`. Identical to `window` for a real guest.
       See utils/frameDocument.js. */
    const view = viewOf(dialogRef.current);
    if (!view) return undefined;
    const handleKey = (e) => {
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    view.addEventListener('keydown', handleKey);
    return () => view.removeEventListener('keydown', handleKey);
  }, [next, prev, dialogRef]);

  const handleTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e) => {
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) diff > 0 ? next() : prev();
  };

  return (
    <motion.div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Photo gallery"
      tabIndex={-1}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(20px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
        outline: 'none',
      }}
      onClick={onClose}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute', top: '20px', right: '20px', zIndex: 10001,
          width: '44px', height: '44px', borderRadius: '50%',
          background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
          color: '#FFFFFF', fontSize: '20px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >✕</button>

      {/* Navigation arrows */}
      {images.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); prev(); }}
            style={{
              position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)',
              width: '48px', height: '48px', borderRadius: '50%',
              background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)',
              color: '#FFF', fontSize: '22px', cursor: 'pointer', zIndex: 10001,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >‹</button>
          <button
            onClick={(e) => { e.stopPropagation(); next(); }}
            style={{
              position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)',
              width: '48px', height: '48px', borderRadius: '50%',
              background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)',
              color: '#FFF', fontSize: '22px', cursor: 'pointer', zIndex: 10001,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >›</button>
        </>
      )}

      {/* Image */}
      <AnimatePresence mode="wait">
        <motion.img
          key={current}
          src={images[current]}
          alt={`Gallery photo ${current + 1}`}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.3 }}
          onClick={(e) => e.stopPropagation()}
          style={{
            maxWidth: '90vw', maxHeight: '85vh', objectFit: 'contain',
            borderRadius: '8px', cursor: 'default',
          }}
        />
      </AnimatePresence>

      {/* Dots */}
      {images.length > 1 && (
        <div style={{
          position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
          display: 'flex', gap: '8px',
        }}>
          {images.map((_, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); setCurrent(i); }}
              style={{
                width: current === i ? '24px' : '8px', height: '8px',
                borderRadius: '4px', border: 'none', cursor: 'pointer',
                background: current === i ? '#B8944F' : 'rgba(255,255,255,0.3)',
                transition: 'all 0.3s ease',
              }}
            />
          ))}
        </div>
      )}

      {/* Counter */}
      <span style={{
        position: 'absolute', top: '24px', left: '24px',
        color: 'rgba(255,255,255,0.6)', fontSize: '14px',
        fontFamily: 'var(--font-sans)', fontWeight: 500,
      }}>
        {current + 1} / {images.length}
      </span>
    </motion.div>
  );
}

// ─── Calendar link/ICS builder — shared by CalendarButton below and the
// full-page shell's floating calendar button (heritageArch/shared.js), so
// the date-formatting and ICS format have one source of truth. ───
export function buildCalendarLinks(event) {
  if (!event) return null;

  const formatDate = (date) => {
    return new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  };

  const title = encodeURIComponent(event.title || '');
  const location = encodeURIComponent(event.location_name || event.location_address || '');
  const description = encodeURIComponent(event.description || '');
  const startDate = event.event_date ? formatDate(event.event_date) : '';
  const endDate = event.event_end_date ? formatDate(event.event_end_date) : (event.event_date ? formatDate(new Date(new Date(event.event_date).getTime() + 3 * 60 * 60 * 1000)) : '');

  const googleUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startDate}/${endDate}&details=${description}&location=${location}`;

  const downloadIcs = () => {
    const ics = [
      // PRODID names the software that produced the file. It is not rendered by
      // calendar apps, but the guest downloads this and can open it in a text
      // editor — and on a white-label plan the whole promise is that nothing
      // they receive names us. The RFC only requires the value be unique-ish.
      'BEGIN:VCALENDAR', 'VERSION:2.0',
      isWhiteLabel(event) ? `PRODID:-//${event.title || 'Event'}//EN` : 'PRODID:-//Fancy RSVP//EN',
      'BEGIN:VEVENT',
      `DTSTART:${startDate}`, `DTEND:${endDate}`,
      `SUMMARY:${event.title || ''}`,
      `DESCRIPTION:${event.description || ''}`,
      `LOCATION:${event.location_name || ''}`,
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(event.title || 'event').replace(/[^a-zA-Z0-9]/g, '_')}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return { googleUrl, downloadIcs };
}

// ─── CalendarButton: Add to Calendar ───
export function CalendarButton({ event, isRTL = false, variant = 'outline', style = {}, buttonStyle = {} }) {
  const [open, setOpen] = useState(false);

  const links = buildCalendarLinks(event);
  if (!links) return null;

  const options = [
    { label: 'Google Calendar', action: () => { window.open(links.googleUrl, '_blank'); setOpen(false); } },
    { label: 'Apple Calendar', action: () => { links.downloadIcs(); setOpen(false); } },
    { label: 'Outlook / Other', action: () => { links.downloadIcs(); setOpen(false); } },
  ];

  return (
    <div style={{ position: 'relative', display: 'inline-block', ...style }}>
      <MagneticButton variant={variant} size="sm" icon={<CalendarIcon size={15} />} onClick={() => setOpen(!open)} style={buttonStyle}>
        {isRTL ? 'أضف إلى التقويم' : 'Add to Calendar'}
      </MagneticButton>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            style={{
              position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
              marginBottom: '8px', background: '#FFFFFF',
              border: '1px solid #E8E2D6', borderRadius: '12px',
              boxShadow: '0 12px 40px rgba(0,0,0,0.12)', padding: '8px',
              minWidth: '200px', zIndex: 100,
            }}
          >
            {options.map((opt, i) => (
              <button
                key={i}
                onClick={opt.action}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  width: '100%', padding: '10px 14px', border: 'none',
                  background: 'transparent', borderRadius: '8px',
                  cursor: 'pointer', fontFamily: 'var(--font-sans)',
                  fontSize: '13px', fontWeight: 500, color: '#191B1E',
                  textAlign: isRTL ? 'right' : 'left',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#F8F4EC'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ display: 'flex', color: '#B8944F' }}><CalendarIcon size={16} /></span>
                <span>{opt.label}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── ShareButton: Native Share API or fallback ───
export function ShareButton({ title, text, url, isRTL = false, variant = 'ghost', style = {} }) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url: url || window.location.href });
      } catch (e) { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(url || window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <MagneticButton variant={variant} size="sm" icon={copied ? <CheckIcon size={15} /> : <LinkIcon size={15} />} onClick={handleShare} style={style}>
      {copied ? (isRTL ? 'تم النسخ!' : 'Link Copied!') : (isRTL ? 'مشاركة الدعوة' : 'Share Invitation')}
    </MagneticButton>
  );
}

// ─── PartySizeStepper: Animated +/- stepper for party size ───
export function PartySizeStepper({ value, onChange, min = 1, max = 20, label, isRTL = false }) {
  return (
    <div>
      {label && <label style={{
        fontSize: '12px', fontWeight: 600, color: '#77736A',
        display: 'block', marginBottom: '8px', fontFamily: 'var(--font-sans)',
      }}>{label}</label>}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '16px',
        background: '#F8F4EC', borderRadius: '14px', padding: '8px 16px',
        border: '1px solid #E8E2D6',
      }}>
        <motion.button
          type="button"
          aria-label={isRTL ? 'إنقاص عدد الأفراد' : 'Decrease party size'}
          whileTap={{ scale: 0.85 }}
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          style={{
            width: '44px', height: '44px', borderRadius: '12px',
            border: '1px solid #E8E2D6', background: '#FFFFFF',
            fontSize: '20px', cursor: value <= min ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: value <= min ? '#D7BE80' : '#191B1E', fontWeight: 700,
          }}
        >−</motion.button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <AnimatePresence mode="popLayout">
            <motion.span
              key={value}
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{
                fontSize: '28px', fontWeight: 800, color: '#B8944F',
                fontFamily: 'var(--font-sans)', display: 'block',
              }}
            >
              {value}
            </motion.span>
          </AnimatePresence>
          <span style={{ fontSize: '11px', color: '#77736A', fontWeight: 500 }}>
            {value === 1 ? (isRTL ? 'شخص' : 'person') : (isRTL ? 'أشخاص' : 'people')}
          </span>
        </div>
        <motion.button
          type="button"
          aria-label={isRTL ? 'زيادة عدد الأفراد' : 'Increase party size'}
          whileTap={{ scale: 0.85 }}
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          style={{
            width: '44px', height: '44px', borderRadius: '12px',
            border: '1px solid #E8E2D6', background: '#FFFFFF',
            fontSize: '20px', cursor: value >= max ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: value >= max ? '#D7BE80' : '#191B1E', fontWeight: 700,
          }}
        >+</motion.button>
      </div>
    </div>
  );
}

// ─── FormField: Premium animated form field ───
export function FormField({
  label, required, error, children, style = {}, htmlFor,
}) {
  // A11Y-3: associate the <label> with its control and wire the error message to
  // the input via aria-describedby + role="alert" so screen readers announce both
  // the field name and validation errors. A stable id is generated when the caller
  // doesn't supply one, and injected into a single child element.
  const autoId = useId();
  const fieldId = htmlFor || autoId;
  const errorId = `${fieldId}-error`;

  const control = React.isValidElement(children)
    ? React.cloneElement(children, {
        id: children.props.id || fieldId,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': error ? errorId : children.props['aria-describedby'],
      })
    : children;

  return (
    <div style={{ ...style }}>
      {label && (
        <label htmlFor={fieldId} style={{
          fontSize: '12px', fontWeight: 600, color: '#77736A',
          display: 'block', marginBottom: '6px', fontFamily: 'var(--font-sans)',
        }}>
          {label} {required && <span style={{ color: '#ef4444' }} aria-hidden="true">*</span>}
        </label>
      )}
      {control}
      <AnimatePresence>
        {error && (
          <motion.span
            id={errorId}
            role="alert"
            initial={{ opacity: 0, y: -4, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -4, height: 0 }}
            style={{ fontSize: '11px', color: '#ef4444', display: 'block', marginTop: '4px' }}
          >
            {error}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
export const inputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '14px 16px',
  background: '#FFFFFF', border: '1px solid #E8E2D6',
  // 16px — under that, iOS Safari auto-zooms the page when a guest taps
  // into the field.
  borderRadius: '12px', fontSize: '16px', color: '#191B1E',
  outline: 'none', fontFamily: 'var(--font-sans)',
  transition: 'border-color 0.25s ease, box-shadow 0.25s ease',
};

export const inputFocus = (e, accentColor = '#B8944F') => {
  e.target.style.borderColor = accentColor;
  e.target.style.boxShadow = `0 0 0 3px ${accentColor}1A`;
};

export const inputBlur = (e, hasError) => {
  e.target.style.borderColor = hasError ? '#ef4444' : '#E8E2D6';
  e.target.style.boxShadow = 'none';
};
