'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import TemplateCard from './TemplateCard';
import PhoneSimulator from './PhoneSimulator';
import CustomBuilder from './CustomBuilder';
import { buildPreviewEvent } from './previewEvent';
import EventCategoryIcon from '../../../components/icons/EventCategoryIcon';
import { CUSTOM_CATEGORIES } from '../../../utils/customEventCategories';
import { occasionPolicyFor } from '../../../utils/eventOccasion';
// This file's own SSR-safe useSyncExternalStore hook was the good one in
// the codebase; it has been promoted to src/app/hooks/useMediaQuery.js so
// everything else can share it. Same 768px threshold, so no behaviour
// change here.
import { useIsMobile } from '../../../hooks/useMediaQuery';

/* ═══ Template → MobilePreview pattern mapping ═══ */
const TEMPLATE_PREVIEW_MAP = {
  wedding:    { name: 'Timeless Elegance', pattern: 'serif',   accent: '#B8944F' },
  // Duplicated from Wedding — same "serif" card artwork the guest page now
  // renders for both (see INVITATION_PATTERN_BY_TEMPLATE in EventPageClient.js).
  engagement: { name: 'Timeless Elegance', pattern: 'serif',  accent: '#D4A574' },
  corporate:  { name: 'Urban Edge',       pattern: 'geo',     accent: '#3B82F6' },
  birthday:   { name: 'Garden Party',     pattern: 'floral',  accent: '#E88FAC' },
  gala:       { name: 'Pure & Simple',    pattern: 'minimal', accent: '#C5A059' },
  custom:     { name: 'Woodland Romance', pattern: 'organic', accent: '#8B7355' },
  // The cinematic templates. Their guest page opens on photography rather
  // than a stationery card, but the simulator still previews the card — it is
  // what "Save the invitation" produces — so they map to the same serif
  // artwork Wedding and Engagement use, tinted to their own accent.
  ring:       { name: 'Velvet Ring',       pattern: 'serif',       accent: '#d4af6a' },
  bab:        { name: 'Door of Joy',       pattern: 'serif',       accent: '#a97fc0' },
  swans:      { name: 'Swan Lake',         pattern: 'serif',       accent: '#6d6f4e' },
  letter:     { name: 'Sealed Letter',     pattern: 'serif',       accent: '#a6705f' },
  tuscany:    { name: 'Tuscan Vineyard',   pattern: 'tuscany',     accent: '#6B7A4F' },
  marrakesh:  { name: 'Marrakesh Nights',  pattern: 'marrakesh',   accent: '#D9A94E' },
  kyoto:      { name: 'Kyoto Blossom',     pattern: 'kyoto',       accent: '#B23A48' },
  nordic:     { name: 'Nordic Frost',      pattern: 'nordic',      accent: '#33495D' },
  havana:     { name: 'Havana Sunset',     pattern: 'havana',      accent: '#FF7A59' },
  estate:     { name: 'Old Money Estate',  pattern: 'estate',      accent: '#1B2A41' },
  roseAtelier:{ name: 'Rosé Atelier',      pattern: 'roseAtelier', accent: '#C98A93' },
  orchid:     { name: 'Midnight Orchid',   pattern: 'orchid',      accent: '#C9A24B' },
  clay:       { name: 'Copper & Clay',     pattern: 'clay',        accent: '#B5502F' },
  alpine:     { name: 'Alpine Pine',       pattern: 'alpine',      accent: '#D9C9A3' },
  coastal:    { name: 'Coastal Linen',     pattern: 'coastal',     accent: '#2B5F5A' },
  heritageArch: { name: 'Heritage Arch',   pattern: 'heritageArch', accent: '#7A1E2C' },
};

/* getLiningGradId lived here, mapping each template to an SVG gradient id for
   the envelope's paper lining. Removed with the preview rewrite: the envelope
   is now the real InvitationReveal, which derives its own colours from
   `event.custom_colors` rather than taking a gradient id. The id was still
   being computed and threaded through two components to reach nobody. */

/* Deterministic pseudo-random so SSR and client markup match exactly (no hydration mismatch, no effect) */
function pseudoRandom(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
const SHIMMER_PARTICLES = Array.from({ length: 15 }, (_, i) => ({
  id: i,
  size: 4 + pseudoRandom(i + 1) * 6,
  left: `${pseudoRandom(i + 2) * 100}%`,
  delay: `${pseudoRandom(i + 3) * 12}s`,
  duration: `${14 + pseudoRandom(i + 4) * 8}s`,
  opacity: 0.15 + pseudoRandom(i + 5) * 0.2,
}));

/* ═══ Floating Champagne Shimmers ═══ */
function FloatingParticles() {
  const particles = SHIMMER_PARTICLES;

  return (
    <div style={{
      position: 'absolute', inset: 0, overflow: 'hidden',
      pointerEvents: 'none', zIndex: 0,
    }}>
      {particles.map(p => (
        <div key={p.id} style={{
          position: 'absolute',
          bottom: '-20px',
          left: p.left,
          width: p.size, height: p.size,
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(184,148,79,${p.opacity}) 0%, rgba(215,190,128,0) 70%)`,
          animation: `s1-float ${p.duration} ${p.delay} linear infinite`,
        }} />
      ))}
    </div>
  );
}

/* ═══ Mobile Template Chip (horizontal carousel item) ═══ */
function MobileTemplateChip({ template, isSelected, onSelect, preset }) {
  /* The template's own hero still, thumbnailed — the same artwork the desktop
     card shows and the same frame the guest opens on. This used to be a
     hand-drawn "mini card silhouette" over a per-key gradient, and the key map
     it read still named 'wedding' and 'engagement', so every template added
     since (both cinematic ones) fell through to the same untinted default. */
  const poster = template.preview?.kind === 'poster' ? template.preview.src : null;

  return (
    <button
      onClick={() => onSelect(template.key)}
      style={{
        flex: '0 0 auto',
        display: 'flex', alignItems: 'stretch', gap: 0,
        borderRadius: 16,
        border: isSelected ? '2px solid #B8944F' : '1.5px solid rgba(184,148,79,0.15)',
        background: isSelected ? 'rgba(255,255,255,0.97)' : 'rgba(255,255,255,0.7)',
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        boxShadow: isSelected
          ? '0 6px 24px rgba(184,148,79,0.18), 0 2px 8px rgba(0,0,0,0.06)'
          : '0 2px 8px rgba(0,0,0,0.03)',
        cursor: 'pointer',
        transition: 'all 0.3s cubic-bezier(0.16,1,0.3,1)',
        WebkitTapHighlightColor: 'transparent',
        minWidth: 0, overflow: 'hidden',
      }}
    >
      {/* Visual preview strip */}
      <div style={{
        width: 56, flexShrink: 0,
        background: poster ? '#15100d' : (preset.background || '#FAF8F5'),
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 3, padding: poster ? 0 : '8px 6px',
        position: 'relative', overflow: 'hidden',
      }}>
        {poster ? (
          <img
            src={poster} alt="" aria-hidden="true" loading="lazy"
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: 'cover', objectPosition: template.preview.position || '50% 50%',
            }}
          />
        ) : (
          /* Custom Canvas has no photography — its identity is the palette the
             organizer picks, so the chip shows exactly that. */
          <div style={{
            width: 34, height: 44, borderRadius: 4,
            border: `1px solid ${preset.primary}40`,
            background: '#FFFFFF',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
          }}>
            <span style={{ width: 20, height: 3, borderRadius: 2, background: preset.primary }} />
            <span style={{ width: 20, height: 3, borderRadius: 2, background: preset.secondary }} />
            <span style={{ width: 20, height: 3, borderRadius: 2, background: preset.background, border: `1px solid ${preset.primary}22` }} />
          </div>
        )}
      </div>

      {/* Text content */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '10px 14px 10px 10px', minWidth: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontFamily: 'var(--font-serif)', fontSize: 13, fontWeight: 600,
            color: isSelected ? '#191B1E' : '#555',
            whiteSpace: 'nowrap',
          }}>{template.label}</span>
          <span style={{
            fontFamily: 'var(--font-sans)', fontSize: 7.5, fontWeight: 700,
            color: '#B8944F', background: 'rgba(184,148,79,0.10)',
            border: '1px solid rgba(184,148,79,0.18)',
            borderRadius: 4, padding: '1px 5px',
            textTransform: 'uppercase', letterSpacing: '0.05em',
            whiteSpace: 'nowrap',
          }}>{template.tier}</span>
        </div>
        <span style={{
          fontFamily: 'var(--font-sans)', fontSize: 10,
          color: '#99958D', whiteSpace: 'nowrap',
          maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{template.tagline}</span>
      </div>

      {isSelected && (
        <div style={{
          width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
          background: '#B8944F', margin: 'auto 10px auto 0',
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4L19 7"/>
          </svg>
        </div>
      )}
    </button>
  );
}


/* ═══ Mobile Preset Selector Row ═══ */
function MobilePresetRow({ template, activePresetIndex, onPresetSelect }) {
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center',
      gap: 12, padding: '8px 0',
    }}>
      {template.presets.map((p, pi) => (
        <button
          key={pi}
          onClick={() => onPresetSelect(template.key, pi)}
          style={{
            width: 28, height: 28, borderRadius: '50%',
            background: p.primary, cursor: 'pointer', border: 'none',
            outline: pi === activePresetIndex ? '2.5px solid #B8944F' : '2px solid rgba(255,255,255,0.5)',
            outlineOffset: 2,
            boxShadow: pi === activePresetIndex
              ? '0 0 0 4px rgba(184,148,79,0.2), 0 2px 8px rgba(0,0,0,0.15)'
              : '0 2px 6px rgba(0,0,0,0.12)',
            transition: 'all 0.25s cubic-bezier(0.16,1,0.3,1)',
            transform: pi === activePresetIndex ? 'scale(1.15)' : 'scale(1)',
            WebkitTapHighlightColor: 'transparent',
          }}
          aria-label={p.name}
        />
      ))}
      <span style={{
        fontFamily: 'var(--font-sans)', fontSize: 11,
        color: '#77736A', fontWeight: 500,
        marginLeft: 2,
      }}>{template.presets[activePresetIndex]?.name}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   "Preview as" — the badge's claim, demonstrated.

   A horizontal scroller, not a wrapping grid: it sits directly above a phone
   frame and must never push the column taller than the device it is
   introducing. `.fx-scroll-x` is the one construct frontend/AGENTS.md treats
   as contributing zero min-content width, which is exactly what a 25-item
   strip beside a 320px phone needs.

   A LOCKED template gets a single static pill instead. Twenty-five tiles with
   twenty-four disabled would invite the organizer to try each one and be
   refused; saying it once is the better answer.
   ═══════════════════════════════════════════════════════════════ */
export function OccasionPreviewStrip({ policy, value, onChange, compact }) {
  const options = policy.allowed === 'any'
    ? CUSTOM_CATEGORIES
    : CUSTOM_CATEGORIES.filter((c) => policy.allowed.includes(c.key));

  return (
    /* `minWidth: 0` is load-bearing, and its absence is not a subtle bug.

       A grid or flex track sizes to its content's MAX-CONTENT width by
       default, and this strip's content is 25 pills — about 3,300px. So
       `width: 100%` resolved against 3,300px, `.fx-scroll-x`'s
       `max-width: 100%` had a 3,300px hundred-percent to clamp against and
       clamped nothing, and the "You choose for real" line was laid out at
       x=3166 — off screen, invisible, and dragging the whole column wide.
       Measured, not guessed: see .visual/badges/probe.html.

       `min-width: 0` is what lets the track shrink below its content, which
       is the whole precondition for a scroll port working. globals.css ships
       `.fx-min0` for exactly this; it is inline here because this element
       already carries no class of its own. */
    <div style={{ width: '100%', minWidth: 0 }} data-testid="occasion-preview-strip">
      {/* Wraps: a label beside a hint is two whole units, and on a 320px
          phone "PREVIEW AS" and "You choose for real in the next step" do not
          share a line. The pills below scroll instead — see .fx-scroll-x —
          because a tab strip stops reading as one the moment it stacks. */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between',
        gap: 8, marginBottom: 6, padding: compact ? '0 4px' : 0,
      }}>
        <span style={{
          fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700,
          letterSpacing: '0.09em', textTransform: 'uppercase', color: '#8A6D34',
        }}>
          {policy.locked ? 'Made for' : 'Preview as'}
        </span>
        {!policy.locked && (
          /* #77736A, not the #A09A91 used for hints elsewhere in the wizard:
             at --fx-micro on this cream ground that lighter grey lands around
             2.5:1, under the 4.5:1 AA needs for small text, and it is the line
             that explains the control is a preview. */
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fx-micro)', color: '#77736A' }}>
            You choose for real in the next step
          </span>
        )}
      </div>

      {policy.locked ? (
        <div
          data-testid="occasion-preview-locked"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '8px 14px', borderRadius: 999,
            border: '1px solid rgba(184,148,79,0.35)', background: 'rgba(184,148,79,0.08)',
          }}
        >
          <EventCategoryIcon name={policy.occasion} size={14} color="#8A6D34" strokeWidth={1.8} />
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 700, color: '#8A6D34' }}>
            {policy.label}
          </span>
        </div>
      ) : (
        <div
          className="fx-scroll-x"
          style={{
            display: 'flex', gap: 6, padding: '2px 2px 6px',
            scrollbarWidth: 'none', msOverflowStyle: 'none',
          }}
        >
          {options.map(({ key, label }) => {
            const active = value === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => onChange(key)}
                data-testid={`preview-occasion-${key}`}
                style={{
                  flex: '0 0 auto',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '7px 12px', borderRadius: 999, cursor: 'pointer',
                  border: `1px solid ${active ? '#B8944F' : 'rgba(184,148,79,0.18)'}`,
                  background: active ? 'linear-gradient(135deg,#B8944F,#a6833f)' : 'rgba(255,255,255,0.7)',
                  color: active ? '#FFFFFF' : '#77736A',
                  fontFamily: 'var(--font-sans)', fontSize: 11.5, fontWeight: 600,
                  WebkitBackdropFilter: 'blur(10px)', backdropFilter: 'blur(10px)',
                  whiteSpace: 'nowrap',
                  WebkitTapHighlightColor: 'transparent',
                  transition: 'background 0.2s ease, border-color 0.2s ease',
                }}
              >
                <EventCategoryIcon name={key} size={13} color={active ? '#FFFFFF' : '#8A6D34'} strokeWidth={1.7} />
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Stage1_TemplatesSimulator({
  templates, templateType, onTemplateSelect,
  selectedPresets, onPresetSelect, activePresetColors,
  customConfig, onCustomConfigChange, onNext, onPreview,
}) {
  const isCustom = templateType === 'custom';
  const activeTemplate = templates.find(t => t.key === templateType) || templates[0];
  const presetIdx = selectedPresets[templateType] || 0;
  const carouselRef = useRef(null);
  const isMobile = useIsMobile();

  /* Scroll selected chip into view */
  useEffect(() => {
    if (!isMobile || !carouselRef.current) return;
    const idx = templates.findIndex(t => t.key === templateType);
    const chip = carouselRef.current.children[idx];
    if (chip) chip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [templateType, isMobile, templates]);

  /* Dynamic guest name state for simulator preview.

     One person, not a couple. This defaulted to "Sarah & John", which reads as
     the HOSTS — and it feeds the recipient slot: the card's "Reserved for …"
     line and, now, the addressee written on the envelope. The mistake was
     invisible while the name only appeared in small print on the card; the
     envelope prints it large, in script, under "For", where a couple's name
     makes the preview look like it is addressed to the people sending it. */
  const [guestName, setGuestName] = useState('Sarah Al-Mansouri');

  /* ── "Preview as" ────────────────────────────────────────────────────────
     The card's badge claims a template works for any occasion. This is where
     that claim is PROVEN: pick one and the phone beside it re-renders the
     real guest page under it — kicker, tagline and all.

     Preview only. The occasion is answered for real in Step 2; committing it
     here would reorder the wizard, and an organizer comparing templates is
     not yet deciding what they are celebrating. Reset whenever the template
     changes, because the previous pick may not even be allowed on the new
     one (Velvet Ring is engagements only). */
  const policy = occasionPolicyFor(templateType);
  const [previewOccasion, setPreviewOccasion] = useState(policy.occasion);
  useEffect(() => {
    setPreviewOccasion(occasionPolicyFor(templateType).occasion);
  }, [templateType]);

  /* Build props for PhoneSimulator. The Custom template renders the editable
     `custom` pattern driven entirely by the live builder config; the others
     map to a curated preview pattern + the selected preset swatch. */
  const previewMap = TEMPLATE_PREVIEW_MAP[templateType] || TEMPLATE_PREVIEW_MAP.wedding;
  const simulatorTemplate = isCustom
    ? { name: 'Custom', pattern: 'custom', accent: customConfig?.accent || '#8B7355' }
    : { name: previewMap.name, pattern: previewMap.pattern, accent: previewMap.accent };
  const simulatorTheme = isCustom
    ? {
        id: 'custom',
        primary: customConfig?.primary || '#8B7355',
        secondary: customConfig?.secondary || '#D4C5A9',
        accent: customConfig?.accent || customConfig?.primary || '#8B7355',
      }
    : {
        id: (activePresetColors?.name || 'default').toLowerCase().replace(/\s+/g, '-'),
        primary: activePresetColors?.primary || '#B8944F',
        secondary: activePresetColors?.secondary || '#D7BE80',
        accent: activePresetColors?.accent || activePresetColors?.primary || '#B8944F',
      };
  /* The event the phone renders. Nothing has been entered at this step — the
     organizer is choosing a look, not filling in details — so this carries
     only the template and its colours, and HeritageArchPage's `isPreview`
     fills the sections with curated sample content. That is the honest thing
     to show here: "this is the template, with example content". Stage 2's
     Preview then shows the same page with their own words in it. */
  const simulatorEvent = useMemo(() => buildPreviewEvent({
    templateType,
    customColors: isCustom
      /* `background` was missing here, and buildPalette() derives the page's
         background, paper, cream and ink from it. So Custom Canvas's
         Background swatch changed nothing in the phone beside it, then
         changed the whole page once saved — the save path
         (create-event/page.js's colour sync) has always sent it. The
         organizer was tuning a control with no visible effect. */
      ? {
          primary: customConfig?.primary,
          secondary: customConfig?.secondary,
          accent: customConfig?.accent,
          background: customConfig?.background,
        }
      : activePresetColors,
    customConfig,
    // The one field the organizer can drive from this step. resolveOccasion()
    // clamps it on read, so a locked template ignores anything it is not for.
    templateData: previewOccasion ? { custom_category: previewOccasion } : {},
  }), [templateType, isCustom, customConfig, activePresetColors, previewOccasion]);

  return (
    <div style={{
      position: 'relative', minHeight: 'calc(100vh - 60px)',
      background: 'linear-gradient(135deg, #FAF8F5 0%, #FCFBF9 50%, #F5F3EF 100%)',
      overflow: 'hidden',
    }} className="s1-root">
      <FloatingParticles />

      {/* Radial champagne glow overlay */}
      <div style={{
        position: 'absolute', top: '30%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '80%', height: '60%',
        background: 'radial-gradient(ellipse, rgba(184,148,79,0.05) 0%, transparent 60%)',
        pointerEvents: 'none', zIndex: 0,
      }} />

      {/* fx-gutter: .fx-container carries no horizontal padding of its own, and
          neither .s1-root above nor .s1-inner supplies one — so the whole first
          wizard stage rendered flush against both screen edges on a phone. */}
      <div style={{ position: 'relative', zIndex: 1 }} className="s1-inner fx-container fx-container--5xl fx-gutter fx-gutter--sm">
        {/* ═══ HEADER ═══ */}
        <div style={{ textAlign: 'center' }} className="s1-header">
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'rgba(184,148,79,0.06)',
            border: '1px solid rgba(184,148,79,0.15)',
            borderRadius: 20, padding: '5px 14px',
            marginBottom: 16,
          }}>
            <span style={{
              fontFamily: 'var(--font-sans)', fontSize: 11,
              color: '#B8944F', fontWeight: 600,
              letterSpacing: '0.05em', textTransform: 'uppercase',
            }}>Step 1 of 3</span>
          </div>

          <h1 style={{ margin: 0, lineHeight: 1.2 }}>
            <span style={{
              fontFamily: 'var(--font-serif)', fontSize: 'clamp(24px, 4vw, 36px)',
              color: '#191B1E', fontWeight: 600,
            }}>Choose Your </span>
            <span style={{
              fontFamily: 'var(--font-script)',
              fontSize: 'clamp(32px, 5vw, 46px)',
              color: '#B8944F',
            }}>Fancy</span>
            <span style={{
              fontFamily: 'var(--font-serif)', fontSize: 'clamp(24px, 4vw, 36px)',
              color: '#191B1E', fontWeight: 600,
            }}> Template</span>
          </h1>

          <p className="s1-subtitle" style={{
            fontFamily: 'var(--font-sans)', fontSize: 14,
            color: '#77736A', marginTop: 12,
            maxWidth: 480, margin: '12px auto 0',
            lineHeight: 1.5,
          }}>
            Select a premium invitation template and preview the live experience your guests will see
          </p>
        </div>

        {/* ═══ MOBILE LAYOUT ═══ */}
        {isMobile && (
          <div className="s1-mobile-layout">
            {/* Phone preview — immersive hero */}
            <div className="s1-mobile-preview">
              <PhoneSimulator
                key={templateType}
                template={simulatorTemplate}
                theme={simulatorTheme}
                guestName={guestName}
                onGuestNameChange={setGuestName}
                event={simulatorEvent}
                isMobile={true}
              />
            </div>

            {/* Under the phone on mobile, where the thumb is — above it would
                push the device below the fold on a short screen. */}
            <div style={{ padding: '10px 16px 0' }}>
              <OccasionPreviewStrip
                policy={policy}
                value={previewOccasion}
                onChange={setPreviewOccasion}
                compact
              />
            </div>

            {/* Preset color dots (curated templates only) */}
            {!isCustom && (
              <MobilePresetRow
                template={activeTemplate}
                activePresetIndex={presetIdx}
                onPresetSelect={onPresetSelect}
              />
            )}

            {/* Horizontal template carousel */}
            <div
              ref={carouselRef}
              className="s1-carousel"
              style={{
                display: 'flex', gap: 10,
                overflowX: 'auto', overflowY: 'hidden',
                padding: '4px 20px 8px',
                scrollSnapType: 'x mandatory',
                WebkitOverflowScrolling: 'touch',
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
              }}
            >
              {templates.map((tpl) => (
                <div key={tpl.key} style={{ scrollSnapAlign: 'center' }}>
                  <MobileTemplateChip
                    template={tpl}
                    isSelected={templateType === tpl.key}
                    onSelect={onTemplateSelect}
                    preset={tpl.presets[selectedPresets[tpl.key] || 0]}
                  />
                </div>
              ))}
            </div>

            {/* Custom builder OR specs pills */}
            {isCustom ? (
              <div style={{ padding: '4px 16px 0' }}>
                <CustomBuilder config={customConfig} onChange={onCustomConfigChange} />
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '4px 20px 0', justifyContent: 'center' }}>
                {activeTemplate.specs.map((spec, i) => (
                  <span key={i} style={{
                    fontFamily: 'var(--font-sans)', fontSize: 10, color: '#77736A',
                    background: 'rgba(184,148,79,0.04)', border: '1px solid rgba(184,148,79,0.12)',
                    borderRadius: 6, padding: '4px 9px', fontWeight: 500,
                  }}>✦ {spec}</span>
                ))}
              </div>
            )}

            {/* CTA */}
            <div style={{ padding: '0 20px' }}>
              {/* Before Continue, because Continue leads to payment. The phone
                  above is a 320px window onto the same page; this opens it at
                  full size, in either language, with the arrival playing. */}
              {onPreview && (
                <button
                  onClick={onPreview}
                  type="button"
                  style={{
                    marginTop: 16, width: '100%', height: 48,
                    background: '#FFFFFF', color: '#191B1E',
                    border: '1.5px solid #191B1E', borderRadius: 16,
                    fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 700,
                    cursor: 'pointer', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', gap: 8,
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <EventCategoryIcon name={templateType} size={15} color="#191B1E" strokeWidth={1.7} />
                  See the full experience
                </button>
              )}
              <button
                onClick={onNext}
                data-testid="wizard-next"
                style={{
                  marginTop: 16, width: '100%', height: 54,
                  background: 'linear-gradient(135deg, #B8944F, #a6833f)',
                  color: '#FFFFFF', border: 'none', borderRadius: 16,
                  fontFamily: 'var(--font-sans)', fontSize: 15,
                  fontWeight: 700, cursor: 'pointer',
                  display: 'flex', alignItems: 'center',
                  justifyContent: 'center', gap: 8,
                  boxShadow: '0 4px 20px rgba(184,148,79,0.35)',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                Continue
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18l6-6-6-6"/>
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* ═══ DESKTOP SPLIT PANE ═══ */}
        {!isMobile && (
        <div className="s1-split" style={{
          display: 'grid', gridTemplateColumns: '1.2fr 0.8fr',
          gap: 48, alignItems: 'start',
        }}>
          {/* ─── LEFT: Template Gallery (responsive card grid) ─── */}
          <div>
            <div className="s1-grid" style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 14,
            }}>
              {templates.map((tpl, i) => (
                <TemplateCard
                  key={tpl.key}
                  template={tpl}
                  isSelected={templateType === tpl.key}
                  onSelect={onTemplateSelect}
                  index={i}
                  activePresetIndex={selectedPresets[tpl.key] || 0}
                  onPresetSelect={onPresetSelect}
                  // Only Custom Canvas reads it: its card previews the live
                  // builder config rather than a fixed piece of artwork.
                  customConfig={customConfig}
                />
              ))}
            </div>

            {/* Custom builder OR specs/fields for curated templates */}
            {isCustom ? (
              <div style={{ marginTop: 18 }}>
                <CustomBuilder config={customConfig} onChange={onCustomConfigChange} />
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 20, padding: '0 4px' }}>
                  {activeTemplate.specs.map((spec, i) => (
                    <span key={i} style={{
                      fontFamily: 'var(--font-sans)', fontSize: 11, color: '#77736A',
                      background: 'rgba(184,148,79,0.04)', border: '1px solid rgba(184,148,79,0.12)',
                      borderRadius: 6, padding: '5px 10px', fontWeight: 500,
                    }}>✦ {spec}</span>
                  ))}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12, padding: '0 4px' }}>
                  <span style={{
                    fontFamily: 'var(--font-sans)', fontSize: 10, color: '#77736A', textTransform: 'uppercase',
                    letterSpacing: '0.06em', fontWeight: 600, marginRight: 4, alignSelf: 'center',
                  }}>Includes:</span>
                  {activeTemplate.fields.map((f, i) => (
                    <span key={i} style={{
                      fontFamily: 'var(--font-sans)', fontSize: 10, color: '#191B1E',
                      background: 'rgba(25,27,30,0.04)', border: '1px solid rgba(25,27,30,0.08)',
                      borderRadius: 4, padding: '3px 8px', fontWeight: 600,
                    }}>{f}</span>
                  ))}
                </div>
              </>
            )}

            {/* CTA Button */}
            {onPreview && (
              <button
                onClick={onPreview}
                type="button"
                style={{
                  marginTop: 24, width: '100%', height: 48,
                  background: '#FFFFFF', color: '#191B1E',
                  border: '1.5px solid #191B1E', borderRadius: 14,
                  fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 700,
                  cursor: 'pointer', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', gap: 8,
                }}
              >
                <EventCategoryIcon name={templateType} size={15} color="#191B1E" strokeWidth={1.7} />
                See the full experience
              </button>
            )}
            <button
              onClick={onNext}
              data-testid="wizard-next"
              style={{
                marginTop: onPreview ? 12 : 32, width: '100%', height: 52,
                background: 'linear-gradient(135deg, #B8944F, #a6833f)',
                color: '#FFFFFF', border: 'none', borderRadius: 14,
                fontFamily: 'var(--font-sans)', fontSize: 14,
                fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: 8,
                transition: 'all 0.3s cubic-bezier(0.16,1,0.3,1)',
                boxShadow: '0 4px 16px rgba(184,148,79,0.3)',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 8px 24px rgba(184,148,79,0.4)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(184,148,79,0.3)';
              }}
            >
              Continue to Configuration
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </button>
          </div>

          {/* ─── RIGHT: Phone Simulator ─── */}
          <div className="s1-phone">
            {/* Directly above the device, so the claim on the card and the
                proof of it are the same glance. */}
            <div style={{ marginBottom: 12 }}>
              <OccasionPreviewStrip
                policy={policy}
                value={previewOccasion}
                onChange={setPreviewOccasion}
              />
            </div>
            <PhoneSimulator
              key={templateType}
              template={simulatorTemplate}
              theme={simulatorTheme}
              guestName={guestName}
              onGuestNameChange={setGuestName}
              event={simulatorEvent}
            />
          </div>
        </div>
        )}
      </div>

      <style jsx>{`
        @keyframes s1-float {
          0% { transform: translateY(0) scale(1); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(-100vh) scale(0.4); opacity: 0; }
        }

        /* ── Desktop defaults ── */
        .s1-root { padding: 48px 24px 80px; }
        .s1-header { margin-bottom: 48px; }
        .s1-mobile-layout { display: none; }

        @media (max-width: 1023.98px) {
          .s1-split { grid-template-columns: 1fr 1fr !important; gap: 32px !important; }
        }

        /* ── Mobile: full reimagination ── */
        @media (max-width: 767.98px) {
          .s1-root { padding: 16px 0 32px !important; }
          .s1-header { margin-bottom: 12px !important; padding: 0 20px; }
          .s1-subtitle { font-size: 12px !important; margin-top: 8px !important; }
          .s1-split { display: none !important; }
          .s1-mobile-layout {
            display: flex !important;
            flex-direction: column;
            gap: 12px;
          }
          .s1-mobile-preview {
            display: flex;
            justify-content: center;
            padding: 0 8px;
          }
          .s1-carousel::-webkit-scrollbar { display: none; }
        }

        @media (max-width: 639.98px) {
          .s1-header h1 { font-size: clamp(20px, 6vw, 28px) !important; }
          .s1-header h1 span { font-size: inherit !important; }
          .s1-header h1 span:nth-child(2) { font-size: clamp(26px, 7.5vw, 36px) !important; }
        }
      `}</style>
    </div>
  );
}
