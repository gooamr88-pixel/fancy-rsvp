'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import SeatingMiniMap from '../SeatingMiniMap';
import SeatingMapFullscreen from '../SeatingMapFullscreen';
import { UtensilsIcon, WarningIcon } from '../../../components/guest/RsvpIcons';
import { formatTableLabel } from '../../../utils/tableLabel';

/**
 * Shows the guest's table + a highlighted map + the companions THEY brought.
 * Distinguishes the host (gold-bordered card with crown) from companions and
 * surfaces their meal/dietary notes. Deliberately never lists other parties
 * seated at the same table.
 *
 * `compact` tightens everything for the emailed entry pass (/ticket/[token]),
 * where this panel sits BELOW a 200px QR code inside a 540px card rather than
 * being the whole screen. Same component, same "you only ever see your own
 * party" guarantee — only the map preview and the spacing change, so the two
 * surfaces cannot drift apart in what they disclose.
 */
export default function SeatingResultPanel({ view, loading, isRTL, onBack, compact = false }) {
  const [fullscreen, setFullscreen] = useState(false);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '16px 0' }}>
        <div style={{ width: '28px', height: '28px', border: '3px solid #E8E2D6', borderTop: '3px solid #B8944F', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 8px' }} />
        <p style={{ color: '#77736A', fontSize: '12px' }}>{isRTL ? 'جاري التحميل...' : 'Loading...'}</p>
      </div>
    );
  }
  if (!view) return null;
  const assigned = !!view.myTableName;
  const members = view.party || [];
  const host = members.find((p) => p.isHost) || null;
  const companions = members.filter((p) => !p.isHost);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      style={{ display: 'flex', flexDirection: 'column', gap: '14px', textAlign: isRTL ? 'right' : 'left' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        {/* The one fact this screen exists to deliver, set like it. It was an
            18px line of the same weight as everything under it, on a page where
            the guest is looking for exactly one thing. */}
        <div style={{ minWidth: 0 }}>
          <span style={{
            fontSize: '9.5px', textTransform: 'uppercase', letterSpacing: '0.2em',
            color: '#8A8478', fontWeight: 700, display: 'block', fontFamily: 'var(--font-sans)',
          }}>
            {isRTL ? 'طاولتك' : 'Your table'}
          </span>
          <strong style={{
            display: 'block', marginTop: '1px',
            fontSize: compact ? '24px' : '28px', lineHeight: 1.1,
            color: assigned ? '#8A6D34' : '#A09A91',
            fontFamily: 'var(--font-serif)', fontWeight: 600,
            letterSpacing: '-0.01em', unicodeBidi: 'plaintext', overflowWrap: 'anywhere',
          }}>
            {assigned ? formatTableLabel(view.myTableName, isRTL) : (isRTL ? 'لم تُخصّص بعد' : 'Not assigned yet')}
          </strong>
        </div>
        {onBack && (
          <button onClick={onBack} style={{
            background: 'none', border: 'none', color: '#77736A', fontSize: '12px',
            fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)', textDecoration: 'underline',
          }}>
            {isRTL ? 'رجوع' : 'Back'}
          </button>
        )}
      </div>

      {/**
        * MAP PREVIEW + A REAL BUTTON UNDER IT.
        *
        * The expand control used to be a small pill floating in the map's top
        * corner. Three things were wrong with that on a phone: it covered the
        * corner of the plan it was inviting you to look at, it sat exactly
        * where a thumb rests while scrolling, and a translucent chip on top of
        * a drawing does not read as the primary action — so guests pinched at
        * the thumbnail instead, which does nothing, and concluded the map was
        * simply too small to use.
        *
        * Now the preview is a tappable card and the action is stated in full
        * underneath it, at touch size, in the event's own gold. `compact`
        * callers (the emailed entry pass) shrink the preview further; the
        * button is what carries the detail either way.
        */}
      {(view.tables || []).length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            aria-label={isRTL ? 'فتح خريطة الجلوس كاملة' : 'Open the full seating map'}
            style={{
              display: 'block', width: '100%', padding: 0, border: 'none',
              background: 'none', cursor: 'zoom-in', textAlign: 'inherit',
            }}
          >
            {/* No `youLabel` any more: the guest's table is marked with a gold
                star, not a worded pill — see markerStyle in seatingPlanStyle.js
                for why the words had to go. */}
            <SeatingMiniMap
              tables={view.tables}
              myTableId={view.myTableId}
              maxHeight={compact ? 240 : 340}
            />
          </button>
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            /* Solid, not a washed beige gradient with gold text on it. This is
               the primary action of the screen — the thumbnail is a preview and
               the full map is where the guest actually finds their seat — and it
               was the palest element on the page. Same gold as the "My seat"
               button inside the map it opens, so the two read as one journey. */
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              width: '100%', minHeight: '46px', padding: '12px 16px',
              borderRadius: '13px', border: 'none', cursor: 'pointer',
              background: 'linear-gradient(150deg, #C9A85C, #A8873F)',
              boxShadow: '0 10px 24px -12px rgba(138,109,52,0.7)',
              fontFamily: 'var(--font-sans)', fontSize: '13.5px', fontWeight: 700,
              color: '#FFFFFF', letterSpacing: '0.01em',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
            {assigned
              ? (isRTL ? 'كبّر الخريطة وشوف مكانك' : 'Open full map & find my seat')
              : (isRTL ? 'كبّر خريطة القاعة' : 'Open the full venue map')}
          </button>
        </div>
      ) : (
        <SeatingMiniMap tables={view.tables} myTableId={view.myTableId} maxHeight={compact ? 240 : 340} />
      )}

      {/**
        * ── ONE PARTY LIST, NOT A CARD PLUS A BOX OF CARDS ──
        *
        * This was a gold-gradient-bordered card wrapping a second gradient for
        * the invitee, then a grey box containing one bordered white card per
        * companion: four levels of container, five border colours and three
        * gradients, sitting directly under a floor plan that had just been
        * stripped back to ink on paper. It read as a different product.
        *
        * Three things went, and each was doing harm rather than nothing:
        *
        *  • THE NUMBERS. Each companion carried a circled 2, 3, 4 — their index
        *    in the party, offset by one because the invitee was silently 1. On
        *    a screen whose whole subject is table numbers, a guest reading
        *    "Omar Farouk (2)" has every reason to read it as table 2. It is
        *    the person's initial now — decoration that at least belongs to
        *    them.
        *  • THE ♛. A text glyph, so it was a chess queen on one phone, a
        *    different crown on the next and a tofu box on the rest — and it was
        *    saying what the label beside it already said.
        *  • THE BOXES. The invitee is now simply the first row, marked with the
        *    one gold thing on the list. Rows are separated by a hairline, the
        *    way a guest list is set on paper.
        */}
      {members.length > 0 && (
        <div>
          <span style={{
            fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.14em',
            color: '#8A8478', fontWeight: 700, display: 'block', marginBottom: '2px',
            fontFamily: 'var(--font-sans)',
          }}>
            {isRTL ? `مجموعتك (${members.length})` : `Your party (${members.length})`}
          </span>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {[...(host ? [host] : []), ...companions].map((p, i) => (
              <li
                key={`${p.name}-${i}`}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '11px',
                  padding: '11px 0',
                  borderTop: i === 0 ? 'none' : '1px solid #EFEBE2',
                }}
              >
                <span aria-hidden style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
                  background: p.isHost ? 'linear-gradient(150deg, #C9A85C, #A8873F)' : '#F2EEE5',
                  color: p.isHost ? '#FFFFFF' : '#8A8478',
                  fontFamily: 'var(--font-serif)', fontSize: '13px', fontWeight: 600,
                  lineHeight: 1,
                }}>
                  {String(p.name || '').trim().charAt(0).toUpperCase()}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{
                    display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '7px',
                  }}>
                    <strong style={{
                      fontSize: p.isHost ? '15px' : '14px',
                      fontFamily: 'var(--font-serif)', fontWeight: 600,
                      color: '#191B1E', lineHeight: 1.25,
                      unicodeBidi: 'plaintext', overflowWrap: 'anywhere',
                    }}>{p.name}</strong>
                    {p.isHost && (
                      <span style={{
                        fontSize: '8.5px', letterSpacing: '0.16em', textTransform: 'uppercase',
                        fontWeight: 800, color: '#8A6D34', fontFamily: 'var(--font-sans)',
                        border: '1px solid rgba(138,109,52,0.35)', borderRadius: '999px',
                        padding: '2px 7px', whiteSpace: 'nowrap',
                      }}>
                        {isRTL ? 'أنت' : 'You'}
                      </span>
                    )}
                  </span>
                  {(p.meal || p.dietaryNotes) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '5px' }}>
                      {p.meal && <Tag color="gold"><UtensilsIcon size={11} strokeWidth={1.8} />{p.meal}</Tag>}
                      {p.dietaryNotes && <Tag color="muted" dim><WarningIcon size={11} strokeWidth={1.8} />{p.dietaryNotes}</Tag>}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Says how to read the plan now that it carries numerals instead of
          names — without this the gold star is decoration the guest has to
          decode. Set as a caption, not as italic afterthought text. */}
      <p style={{
        fontSize: '11.5px', lineHeight: 1.5, color: '#8A8478',
        fontFamily: 'var(--font-sans)', margin: 0,
        borderTop: '1px solid #EFEBE2', paddingTop: '12px',
      }}>
        {/* "marked in gold", not "marked with a gold star": the star is a pin
            that is only drawn once the table is big enough to carry one, so on
            the preview above there is no star to look for — the gold table is
            the mark. Naming the colour is true on both surfaces. */}
        {isRTL
          ? 'الأرقام على الخريطة هي أرقام الطاولات، وطاولتك مميّزة باللون الذهبي.'
          : 'The numbers on the plan are table numbers. Yours is the one marked in gold.'}
      </p>

      {fullscreen && (
        <SeatingMapFullscreen
          tables={view.tables}
          myTableId={view.myTableId}
          myTableName={view.myTableName}
          isRTL={isRTL}
          onClose={() => setFullscreen(false)}
        />
      )}
    </motion.div>
  );
}

function Tag({ color = 'muted', dim, children }) {
  const palette = {
    rose:   { bg: 'rgba(190,128,140,0.10)', fg: '#9B5A6A' },
    sky:    { bg: 'rgba(110,150,180,0.10)', fg: '#4B7088' },
    gold:   { bg: 'rgba(184,148,79,0.12)',  fg: '#8A6D34' },
    muted:  { bg: '#F0ECE3',                fg: '#77736A' },
  };
  const p = palette[color] || palette.muted;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '3px',
      padding: '2px 8px', borderRadius: '999px',
      background: p.bg, color: p.fg,
      fontSize: '10.5px', fontWeight: dim ? 500 : 600, lineHeight: 1.4,
      fontFamily: 'var(--font-sans)',
    }}>{children}</span>
  );
}
