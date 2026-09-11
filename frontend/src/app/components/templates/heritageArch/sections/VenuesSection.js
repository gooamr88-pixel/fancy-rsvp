'use client';

import React, { useState } from 'react';
import { useFullPageTheme } from '../theme';
import { SectionShell, SectionHeading, DayTabs, ScrollToRsvpHint, MapEmbed, getDirectionsUrl } from '../shared';
import { useTrackGuestAction } from '../../../../utils/useGuestAnalytics';

// A small decorative venue glyph (a classical arch/colonnade) shown above the
// venue name — bundled with the template, tinted from the event's palette,
// not an organizer-uploaded photo.
function VenueMonogram({ color }) {
  return (
    <svg width="44" height="34" viewBox="0 0 44 34" fill="none" aria-hidden="true" style={{ marginBottom: '4px' }}>
      <path d="M6 32V16M14 32V16M22 32V13M30 32V16M38 32V16" stroke={color} strokeWidth="1.4" opacity="0.7" />
      <path d="M2 32h40" stroke={color} strokeWidth="1.6" opacity="0.8" />
      <path d="M2 16 22 3l20 13" stroke={color} strokeWidth="1.4" fill="none" opacity="0.7" />
      <circle cx="22" cy="8" r="1.6" fill={color} opacity="0.8" />
    </svg>
  );
}

export default function VenuesSection({ days, isRTL, t }) {
  const C = useFullPageTheme();
  const trackAction = useTrackGuestAction();
  const [dayIndex, setDayIndex] = useState(0);
  const venue = days?.[dayIndex]?.venue || {};
  const hasName = !!(venue.name || venue.address);
  const hasMap = !!(venue.address || (venue.lat != null && venue.lng != null));

  return (
    <SectionShell>
      <SectionHeading isRTL={isRTL}>{isRTL ? 'الأماكن' : 'Venues'}</SectionHeading>
      <DayTabs days={days} activeIndex={dayIndex} onChange={setDayIndex} isRTL={isRTL} />

      <div style={{ width: '100%', maxWidth: '520px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px' }}>
        {hasMap ? (
          // Venue name/address read as a place-card layered directly onto the
          // map — the same "pin card" pattern real map apps use — instead of
          // a separate text block stacked underneath it.
          <div style={{ position: 'relative', width: '100%' }}>
            <MapEmbed lat={venue.lat} lng={venue.lng} address={venue.address} height="320px" />
            {hasName && (
              <div style={{
                position: 'absolute', left: '50%', bottom: '14px', transform: 'translateX(-50%)',
                width: 'calc(100% - 28px)', maxWidth: '420px', pointerEvents: 'none',
                background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
                borderRadius: '14px', border: `1px solid ${C.border}`,
                boxShadow: '0 12px 30px rgba(0,0,0,0.24)',
                padding: '14px 20px', textAlign: 'center',
              }}>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <VenueMonogram color={C.gold} />
                </div>
                <h3 style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: '19px', color: C.maroon, margin: 0 }}>
                  {venue.name}
                </h3>
                {venue.address && (
                  <p style={{ fontSize: '12.5px', color: C.ink, opacity: 0.8, margin: '3px 0 0' }}>{venue.address}</p>
                )}
              </div>
            )}
          </div>
        ) : hasName && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <VenueMonogram color={C.gold} />
            </div>
            <h3 style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: '22px', color: C.maroon, margin: '4px 0' }}>{venue.name}</h3>
            {venue.address && <p style={{ fontSize: '14px', color: C.ink, opacity: 0.8, margin: 0 }}>{venue.address}</p>}
          </div>
        )}

        {hasMap && (
          <a
            href={getDirectionsUrl(venue.lat, venue.lng, venue.address)}
            onClick={() => trackAction('directions_clicked')}
            target="_blank" rel="noopener noreferrer"
            style={{
              alignSelf: 'center', display: 'inline-flex', alignItems: 'center', gap: '8px',
              padding: '12px 26px', borderRadius: '999px', border: `1px solid ${C.maroon}`,
              color: C.maroon, textDecoration: 'none', fontWeight: 700, fontSize: '13px',
              letterSpacing: '0.04em', fontFamily: 'var(--font-sans)',
            }}
          >
            {isRTL ? 'احصل على الاتجاهات' : 'Get directions'}
          </a>
        )}
      </div>

      <ScrollToRsvpHint isRTL={isRTL} />
    </SectionShell>
  );
}
