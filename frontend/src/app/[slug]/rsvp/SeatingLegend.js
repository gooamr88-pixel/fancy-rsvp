'use client';

import React from 'react';
import Icon from '../../components/icons/Icon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE SHAPES ON THE PLAN ARE CALLED.
 *
 * The plan is drawn clean — a table carries its number, a zone carries a glyph,
 * and a zone only carries its NAME when it is drawn large enough to set one
 * (see `zoneLabel` in utils/seatingPlanStyle.js). That is what keeps fourteen
 * captions from competing with the one table the guest opened the map to find.
 *
 * It only works if the names are said SOMEWHERE, and until now they were said
 * in exactly one place: a legend at the foot of the expanded, pannable map.
 * The thumbnail — the map on the emailed entry pass, and the one at the end of
 * the RSVP, which is the map most guests will ever see — had no legend at all.
 * A guest looking at it saw five coloured boxes with 9px glyphs in them and no
 * way on earth to learn that one was the bar.
 *
 * So the legend is a component now, and both maps use it. One presentation of a
 * venue's own vocabulary, in the host's own words, wherever the plan appears.
 *
 * `compact` is the thumbnail's version: smaller swatches, tighter type, and it
 * wraps rather than scrolling, because a key that runs off the side of a phone
 * is a key nobody reads the end of.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function SeatingLegend({ items, compact = false, style }) {
  if (!items || items.length === 0) return null;

  const swatch = compact ? 16 : 20;
  const glyph = compact ? 10 : 12;
  const font = compact ? 10.5 : 11.5;

  return (
    <ul
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexWrap: 'wrap',
        gap: compact ? '6px 12px' : '8px 20px',
        fontFamily: 'var(--font-sans)',
        ...style,
      }}
    >
      {items.map((z) => (
        <li
          key={z.key || z.shape}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: compact ? '6px' : '7px',
            fontSize: `${font}px`, color: '#6B6355', lineHeight: 1.3,
            // A long venue name breaks inside the row rather than widening it
            // past the phone.
            minWidth: 0,
          }}
        >
          <span
            aria-hidden
            style={{
              width: `${swatch}px`, height: `${swatch}px`, borderRadius: compact ? '5px' : '6px',
              flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: `${z.color}2E`, border: `1px solid ${z.color}5E`,
            }}
          >
            <Icon name={z.icon} size={glyph} color={z.color} strokeWidth={1.7} />
          </span>
          {/* The host's own name for the zone — see planLegend.
              `overflowWrap: anywhere` because a venue name is free text: the
              usual break-word still refuses to split one long unbroken token,
              and a 320px phone has 280px of usable width to lose it in. */}
          <span style={{ unicodeBidi: 'plaintext', minWidth: 0, overflowWrap: 'anywhere' }}>{z.label}</span>
          {z.count > 1 && (
            <span style={{ opacity: 0.55, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              ×{z.count}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
