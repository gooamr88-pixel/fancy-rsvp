'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import MobilePreview from '../../../../app/components/templates/MobilePreview';

/* Logical device size — increased for better content visibility.
   The frame is always rendered at this exact pixel size and then
   uniformly scaled to fit its column — so the preview content
   never reflows or re-wraps; it only scales. */
const BASE_W = 320;
const BASE_H = 650;

/* ═══ Fit-to-width scale hook (ResizeObserver, SSR-safe) ═══ */
function useFitScale(baseWidth, maxScale = 1) {
  const ref = useRef(null);
  const [scale, setScale] = useState(maxScale);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(Math.min(maxScale, w / baseWidth));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [baseWidth, maxScale]);
  return [ref, scale];
}

/* ═══ The journey, as three real moments ═══
   `attending` / `declined` are gone: they drove a mock RSVP sheet that has
   been deleted. The RSVP is now the real form at the foot of the real page,
   so "see the RSVP" means scrolling to it, exactly as a guest does. */
const FLOW_STEPS = [
  { key: 'received', label: 'Receive' },
  { key: 'envelope', label: 'Open' },
  { key: 'opened', label: 'Invitation' },
];

function FlowStepper({ step, onSelect, compact }) {
  return (
    <div
      className="ps-stepper"
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'rgba(255,255,255,0.7)',
        border: '1px solid rgba(184,148,79,0.18)',
        borderRadius: 999, padding: 4,
        boxShadow: '0 4px 16px rgba(0,0,0,0.04)',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        overflowX: compact ? 'auto' : 'visible',
        scrollbarWidth: 'none', maxWidth: '100%',
        boxSizing: 'border-box',
      }}
    >
      {FLOW_STEPS.map((s, i) => {
        const active = s.key === step;
        return (
          <button
            key={s.key}
            onClick={() => onSelect(s.key)}
            style={{
              flex: '0 0 auto',
              display: 'flex', alignItems: 'center', gap: 5,
              padding: compact ? '6px 9px' : '6px 11px',
              borderRadius: 999, border: 'none', cursor: 'pointer',
              background: active ? 'linear-gradient(135deg,#B8944F,#a6833f)' : 'transparent',
              color: active ? '#fff' : '#77736A',
              fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 700,
              letterSpacing: '0.02em',
              boxShadow: active ? '0 2px 8px rgba(184,148,79,0.35)' : 'none',
              transition: 'all 0.25s cubic-bezier(0.16,1,0.3,1)',
              WebkitTapHighlightColor: 'transparent', whiteSpace: 'nowrap',
            }}
          >
            <span style={{
              width: 15, height: 15, borderRadius: '50%',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: active ? 'rgba(255,255,255,0.25)' : 'rgba(184,148,79,0.12)',
              color: active ? '#fff' : '#B8944F', fontSize: 8.5, fontWeight: 800,
            }}>{i + 1}</span>
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

export default function PhoneSimulator({ template, theme, guestName, onGuestNameChange, event, slug, invitationData, isMobile = false }) {
  /* Starts on the invitation rather than the arrival. Stage 1 remounts this
     on every template switch (`key={templateType}`), and replaying a cover
     each time the organizer clicks a different template would put a video
     between them and the comparison they are actually making. The stepper is
     right there for anyone who wants to watch the arrival. */
  const [step, setStep] = useState('opened');
  const [wrapRef, scale] = useFitScale(BASE_W, 1);

  const handleSelect = useCallback((key) => setStep(key), []);

  /* Derive accent for ambient glow */
  const accentColor = theme?.primary || template?.accent || '#B8944F';

  /* The phone frame, rendered at fixed logical size then scaled */
  const frame = (
    <div style={{ width: BASE_W * scale, height: BASE_H * scale }}>
      <div style={{ width: BASE_W, height: BASE_H, transform: `scale(${scale})`, transformOrigin: 'top center' }}>
        <div style={{
          width: BASE_W, height: BASE_H,
          background: '#111111', borderRadius: 46, padding: 8,
          boxShadow: `0 0 0 1px rgba(255,255,255,0.06), 0 25px 70px rgba(0,0,0,0.25), 0 10px 30px rgba(0,0,0,0.15), 0 0 60px ${accentColor}08`,
          position: 'relative', boxSizing: 'border-box',
        }}>
          {/* Dynamic Island */}
          <div style={{
            position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
            width: 100, height: 28, borderRadius: 16, background: '#000', zIndex: 60,
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 8,
            boxShadow: 'inset 0 0 2px rgba(255,255,255,0.05)',
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#1a1a2e', border: '1.5px solid #2a2a3e' }} />
            <div style={{ width: 32, height: 3, borderRadius: 2, background: '#1a1a2e' }} />
          </div>

          {/* Glass reflection overlay */}
          <div style={{
            position: 'absolute', inset: 10, borderRadius: 38, zIndex: 55,
            pointerEvents: 'none', overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(160deg, rgba(255,255,255,0.08) 0%, transparent 30%, transparent 70%, rgba(255,255,255,0.03) 100%)',
              mixBlendMode: 'overlay',
            }} />
          </div>

          {/* Screen */}
          <div style={{
            width: '100%', height: '100%', borderRadius: 38, overflow: 'hidden',
            border: '0.5px solid rgba(255,255,255,0.05)',
            background: '#000', position: 'relative', display: 'flex', flexDirection: 'column',
          }}>
            <MobilePreview
              event={event}
              slug={slug}
              guestName={guestName}
              invitationPattern={template?.pattern}
              invitationTheme={theme}
              invitationData={invitationData}
              step={step}
              onStepChange={setStep}
            />
          </div>

          {/* Home indicator */}
          <div style={{
            position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
            width: 96, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)', zIndex: 60,
          }} />
        </div>
      </div>
    </div>
  );

  /* ═══ MOBILE: immersive ═══ */
  if (isMobile) {
    return (
      <div className="ce-phone" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', gap: 10 }}>
        <div ref={wrapRef} style={{ width: '100%', maxWidth: 320, display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
          {frame}
        </div>
        <FlowStepper step={step} onSelect={handleSelect} compact />
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3B9B6D', animation: 'ps-blink 2s ease-in-out infinite' }} />
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600, color: '#77736A', letterSpacing: '0.04em' }}>Walk through the full guest journey</span>
        </div>
        <style jsx>{`@keyframes ps-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
      </div>
    );
  }

  /* ═══ DESKTOP: sticky panel ═══
     One panel under the phone, not three stacked blocks. The label, the step
     control and the guest-name field are a single instrument — "who is this
     addressed to, and where in their journey am I looking" — and splitting
     them across three floating cards of three different widths read as
     leftovers rather than as a control surface. */
  return (
    <div className="ce-phone-container">
      <div ref={wrapRef} style={{ width: '100%', maxWidth: BASE_W, display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
        {frame}
      </div>

      <div style={{
        width: '100%', maxWidth: BASE_W, boxSizing: 'border-box',
        background: 'rgba(255,255,255,0.82)', border: '1px solid rgba(184,148,79,0.16)',
        borderRadius: 18, padding: 14, boxShadow: '0 6px 24px rgba(0,0,0,0.04)',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: '#3B9B6D', animation: 'ps-blink 2s ease-in-out infinite' }} />
          <span className="fx-min0" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 700, color: '#191B1E', letterSpacing: '0.02em' }}>
              Live guest journey
            </span>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10.5, color: '#77736A', lineHeight: 1.35 }}>
              The real invitation, at the size a guest holds it
            </span>
          </span>
        </div>

        {/* Where in the journey */}
        <FlowStepper step={step} onSelect={handleSelect} compact />

        {/* Who it is addressed to */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label htmlFor="ps-guest-name" style={{ fontSize: 'var(--fx-micro)', fontWeight: 700, color: '#77736A', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-sans)' }}>
            Addressed to
          </label>
          <input
            id="ps-guest-name"
            type="text"
            value={guestName || ''}
            onChange={e => onGuestNameChange(e.target.value)}
            // One guest, not a couple: this fills the RECIPIENT slot — the card's
            // "Reserved for …" line and the addressee on the envelope.
            placeholder="e.g. Sarah Al-Mansouri"
            style={{
              width: '100%', boxSizing: 'border-box', background: '#FFFFFF', border: '1px solid #E8E2D6',
              // 12.5px is the designed desktop size; globals.css lifts every
              // form control to 16px below 768px on its own, so this must not
              // be bumped here (see the iOS focus-zoom block there).
              borderRadius: 9, padding: '9px 12px', fontSize: 12.5, color: '#191B1E', outline: 'none',
              fontFamily: 'var(--font-sans)', transition: 'border-color 0.25s, box-shadow 0.25s',
            }}
            onFocus={e => { e.target.style.borderColor = '#B8944F'; e.target.style.boxShadow = '0 0 0 3px rgba(184,148,79,0.08)'; }}
            onBlur={e => { e.target.style.borderColor = '#E8E2D6'; e.target.style.boxShadow = 'none'; }}
          />
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10, color: '#99958D', lineHeight: 1.35 }}>
            Preview only — your guests&rsquo; real names come from your guest list.
          </span>
        </div>
      </div>

      <style jsx>{`
        .ce-phone-container {
          position: sticky; top: 32px;
          display: flex; flex-direction: column; align-items: center; gap: 14px; width: 100%;
        }
        @keyframes ps-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
      `}</style>
    </div>
  );
}
