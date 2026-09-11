'use client';

import React, { useRef, useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { formatTableLabel } from '../../utils/tableLabel';
import { lighten, luminance } from '../../utils/color';
import { safeZone } from '../../utils/timezone';
import { useTrackGuestAction } from '../../utils/useGuestAnalytics';

// This card's body is a fixed near-black (#191B1E) regardless of the event's
// own custom_colors — callers pass in a raw, unclamped organizer color (e.g.
// RsvpSection's C.maroon, which on a light-theme event IS the organizer's own
// picked primary verbatim; StepSuccess's raw event.custom_colors.primary).
// Many real palettes pick a DARK primary (navy, forest green, near-black,
// deep burgundy) — perfectly readable on their own light invitation pages,
// but invisible as dark-on-near-black text/pill-fill here. Lightening only
// when genuinely too dark leaves already-legible colors (gold, coral, cream)
// untouched.
function safePassAccent(color) {
  return luminance(color) < 0.4 ? lighten(color, 0.5) : color;
}

// A boarding-pass aesthetic reads as a deliberately-designed object, not a
// themed section of the invitation — so unlike the rest of the guest page,
// this deliberately does NOT inherit the organizer's chosen template fonts
// (var(--font-serif)/var(--font-sans), which could be anything from a heavy
// script to a condensed sans and would clash with this card's tight ticket
// layout). Same reasoning as InvitationReveal's locally-scoped font vars.
const PASS_FONT_SERIF = "'Cormorant Garamond', Georgia, 'Times New Roman', serif";
const PASS_FONT_SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";

/* ═══════════════════════════════════════════════════════════════
   FANCY RSVP — Premium Guest Pass / Ticket Generator
   A real boarding-pass-style object: a main stub + a tear-off QR
   stub joined by a die-cut perforation, foil corner seal, and a
   slow gold shimmer sweep. Generates a matching downloadable PNG.
   ═══════════════════════════════════════════════════════════════ */

// The perforation's "holes" are small circles painted in the card's resting
// background. GuestPassCard is only ever mounted inside the wizard's white
// success-step body, so matching that exact white keeps the die-cut illusion
// seamless without needing a real CSS mask (better Safari/print compatibility).
const PUNCH_BG = '#FFFFFF';

function Perforation({ isRTL }) {
  const holes = Array.from({ length: 9 });
  return (
    <div aria-hidden style={{
      position: 'absolute', top: 0, bottom: 0, [isRTL ? 'right' : 'left']: '70%',
      width: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      alignItems: 'center', zIndex: 3, pointerEvents: 'none',
    }}>
      <div style={{ width: '9px', height: '9px', borderRadius: '50%', background: PUNCH_BG, marginTop: '-4px' }} />
      <div style={{
        flex: 1, width: 0, borderLeft: '1.5px dashed rgba(255,255,255,0.22)',
        margin: '2px 0',
      }} />
      <div style={{ width: '9px', height: '9px', borderRadius: '50%', background: PUNCH_BG, marginBottom: '-4px' }} />
    </div>
  );
}

export default function GuestPassCard({
  guestName, eventTitle, eventDate, eventLocation, eventTimezone,
  tableName, response = 'yes', qrData, themeColor = '#B8944F',
  isRTL = false, onDownload, removeWatermark = false,
}) {
  const [qrImageUrl, setQrImageUrl] = useState(null);
  const [flipped, setFlipped] = useState(false);
  // The only accent color actually rendered — see safePassAccent above.
  const accent = safePassAccent(themeColor);

  // Generate QR code client-side
  useEffect(() => {
    if (!qrData) return;
    import('qrcode').then(QRCode => {
      QRCode.toDataURL(qrData, {
        width: 320, margin: 1,
        color: { dark: '#191B1E', light: '#FFFFFF' },
      }).then(url => setQrImageUrl(url)).catch(() => {});
    }).catch(() => {});
  }, [qrData]);

  const dateFormatted = eventDate
    ? new Date(eventDate).toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: safeZone(eventTimezone) })
    : '';
  const dateShort = eventDate
    ? new Date(eventDate).toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', { month: 'short', day: '2-digit', timeZone: safeZone(eventTimezone) })
    : '';
  const timeFormatted = eventDate
    ? new Date(eventDate).toLocaleTimeString(isRTL ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit', timeZone: safeZone(eventTimezone) })
    : '';

  const statusMeta = response === 'yes'
    ? { label: { en: 'Confirmed', ar: 'مؤكد' }, color: '#10b981', soft: 'rgba(16,185,129,0.15)' }
    : response === 'maybe'
      ? { label: { en: 'Tentative', ar: 'مبدئي' }, color: '#6366f1', soft: 'rgba(99,102,241,0.15)' }
      : { label: { en: 'Registered', ar: 'مسجل' }, color: '#77736A', soft: 'rgba(255,255,255,0.08)' };

  /**
   * Saves the bare QR on its own, alongside the full-pass download below.
   * Both exist because they solve different moments: the pass is the keepsake
   * a guest shares, the bare code is what actually scans fastest at the door —
   * a door scanner reading the QR out of the pass artwork is fighting the
   * surrounding foil, the perforation and a 112px render. Re-encoded at 1024px
   * here rather than reusing the on-screen data URL for the same reason.
   */
  /* `guest_pass_downloaded` covers BOTH saves — the full keepsake pass and the
     bare check-in QR. They are different artefacts but one organizer question
     ("did guests take their pass with them?"), and the dashboard shows a single
     count; `kind` in the metadata keeps them separable later without needing a
     second event type in the backend whitelist. */
  const trackAction = useTrackGuestAction();

  const handleDownloadQr = useCallback(() => {
    if (!qrData) return;
    trackAction('guest_pass_downloaded', { kind: 'qr' });
    import('qrcode').then(QRCode => {
      QRCode.toDataURL(qrData, {
        width: 1024, margin: 3, errorCorrectionLevel: 'Q',
        color: { dark: '#191B1E', light: '#FFFFFF' },
      }).then(url => {
        const a = document.createElement('a');
        a.href = url;
        a.download = `check-in-qr-${(guestName || 'guest').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}.png`;
        a.click();
      }).catch(() => {});
    }).catch(() => {});
  }, [qrData, guestName, trackAction]);

  const handleDownload = useCallback(async () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const w = 900;
    const h = 460;
    const stubX = w - 240; // QR stub starts here
    canvas.width = w;
    canvas.height = h;

    const clipRoundRect = (x, y, ww, hh, r) => { ctx.beginPath(); ctx.roundRect(x, y, ww, hh, r); };

    // Body
    ctx.fillStyle = '#191B1E';
    clipRoundRect(0, 0, w, h, 26);
    ctx.fill();

    // Shimmering spine — tinted to the event's own theme color
    const spine = ctx.createLinearGradient(0, 0, w, 0);
    spine.addColorStop(0, themeColor); spine.addColorStop(0.5, '#F4E6C2'); spine.addColorStop(1, themeColor);
    ctx.fillStyle = spine;
    ctx.fillRect(0, 0, w, 6);

    // Perforation holes (cut into the body color so they read as real punches)
    for (let i = 0; i <= 8; i++) {
      const y = 20 + i * ((h - 40) / 8);
      ctx.beginPath();
      ctx.arc(stubX, y, 9, 0, Math.PI * 2);
      ctx.fillStyle = '#0E0F10';
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.setLineDash([6, 7]);
    ctx.beginPath(); ctx.moveTo(stubX, 30); ctx.lineTo(stubX, h - 30); ctx.stroke();
    ctx.setLineDash([]);

    // Left section — main stub
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '700 11px sans-serif';
    ctx.fillText('G U E S T   P A S S', 44, 50);

    ctx.fillStyle = accent;
    ctx.font = '700 30px Georgia, serif';
    ctx.fillText((eventTitle || '').slice(0, 38), 44, 94);

    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '400 15px sans-serif';
    ctx.fillText(`${dateFormatted}${timeFormatted ? '  ·  ' + timeFormatted : ''}`, 44, 128);
    if (eventLocation) ctx.fillText(eventLocation, 44, 152);

    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.moveTo(44, 188); ctx.lineTo(stubX - 50, 188); ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '700 10px sans-serif';
    ctx.fillText('GUEST', 44, 222);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '600 26px Georgia, serif';
    ctx.fillText(guestName || '', 44, 256);

    if (tableName) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '700 10px sans-serif';
      ctx.fillText('TABLE', 44, 296);
      ctx.fillStyle = accent;
      ctx.font = '700 24px sans-serif';
      ctx.fillText(tableName, 44, 326);
    }

    const statusText = (response === 'yes' ? 'CONFIRMED' : response === 'maybe' ? 'TENTATIVE' : 'REGISTERED');
    ctx.font = '700 11px sans-serif';
    const statusWidth = ctx.measureText(statusText).width + 28;
    clipRoundRect(44, 358, statusWidth, 32, 16);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.fillStyle = '#0E0F10';
    ctx.fillText(statusText, 58, 379);

    if (!removeWatermark) {
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.font = '400 11px sans-serif';
      ctx.fillText('Powered by Fancy RSVP', 44, h - 24);
    }

    // Right section — QR stub
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '700 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(dateShort.toUpperCase(), stubX + (w - stubX) / 2, 44);

    const finish = () => downloadCanvas(canvas, guestName);

    if (qrImageUrl) {
      const qrImg = new Image();
      qrImg.crossOrigin = 'anonymous';
      qrImg.onload = () => {
        const qrSize = 168;
        const qrX = stubX + ((w - stubX) - qrSize) / 2;
        const qrY = (h - qrSize) / 2 - 10;
        ctx.fillStyle = '#FFFFFF';
        clipRoundRect(qrX - 12, qrY - 12, qrSize + 24, qrSize + 24, 14);
        ctx.fill();
        ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '500 11px sans-serif';
        ctx.fillText('SCAN TO CHECK IN', stubX + (w - stubX) / 2, qrY + qrSize + 36);
        ctx.textAlign = 'start';
        finish();
      };
      qrImg.onerror = finish;
      qrImg.src = qrImageUrl;
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.font = '500 12px sans-serif';
      ctx.fillText('QR sent', stubX + (w - stubX) / 2, h / 2 - 8);
      ctx.fillText('separately', stubX + (w - stubX) / 2, h / 2 + 12);
      ctx.textAlign = 'start';
      finish();
    }

    trackAction('guest_pass_downloaded', { kind: 'pass' });
    if (onDownload) onDownload();
  }, [eventTitle, dateFormatted, dateShort, timeFormatted, eventLocation, guestName, tableName, response, themeColor, accent, qrImageUrl, onDownload, removeWatermark, trackAction]);

  return (
    <div style={{ perspective: '1400px', maxWidth: '480px', width: '100%', margin: '0 auto' }}>
      <motion.div
        initial={{ opacity: 0, y: 28, scale: 0.93, rotateX: -10 }}
        animate={{ opacity: 1, y: 0, scale: 1, rotateX: 0 }}
        transition={{ type: 'spring', stiffness: 180, damping: 18, delay: 0.25 }}
        whileHover={{ rotateX: 2, rotateY: -2, scale: 1.012 }}
        style={{ position: 'relative', transformStyle: 'preserve-3d' }}
      >
        {/* ── FRONT ── */}
        <motion.div
          animate={{ rotateY: flipped ? 180 : 0, opacity: flipped ? 0 : 1 }}
          transition={{ duration: 0.55, ease: [0.4, 0, 0.2, 1] }}
          style={{
            backfaceVisibility: 'hidden', position: flipped ? 'absolute' : 'relative', inset: 0,
            background: '#191B1E', borderRadius: '20px', overflow: 'hidden',
            boxShadow: '0 26px 70px -16px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)',
          }}
        >
          {/* Shimmering gold spine — reuses the brand's shimmer utility for a moving highlight. */}
          <div className="gold-shimmer-line" style={{ height: '5px' }} />

          {/* Foil corner seal */}
          <div aria-hidden style={{
            position: 'absolute', top: 0, [isRTL ? 'left' : 'right']: 0, width: '86px', height: '86px',
            overflow: 'hidden', zIndex: 2, pointerEvents: 'none',
          }}>
            <div style={{
              position: 'absolute', top: '14px', [isRTL ? 'left' : 'right']: '-34px',
              width: '120px', transform: isRTL ? 'rotate(-45deg)' : 'rotate(45deg)',
              background: `linear-gradient(100deg, ${accent}, #F4E6C2 50%, ${accent})`,
              color: '#191B1E', fontSize: '9px', fontWeight: 800, letterSpacing: '0.12em',
              textAlign: 'center', padding: '3px 0', textTransform: 'uppercase',
              boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
            }}>
              {isRTL ? 'دعوة فاخرة' : 'VIP Invite'}
            </div>
          </div>

          <Perforation isRTL={isRTL} />

          <div className="gp-front-row" style={{ display: 'flex' }}>
            {/* Main stub */}
            {/* flex and padding come from the stylesheet, not from here — the
                mobile block below overrides both, and an inline value would make
                those overrides unreachable. */}
            <div className="gp-main-stub" style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '3px', color: 'rgba(255,255,255,0.4)', fontWeight: 700, fontFamily: PASS_FONT_SANS }}>
                    {isRTL ? 'بطاقة الضيف' : 'Guest Pass'}
                  </span>
                  <h3 style={{ fontFamily: PASS_FONT_SERIF, fontSize: '19px', fontWeight: 600, color: accent, marginTop: '4px', lineHeight: 1.25 }}>
                    {eventTitle}
                  </h3>
                </div>
                <span style={{
                  flexShrink: 0, padding: '5px 11px', borderRadius: '20px', background: statusMeta.soft, color: statusMeta.color,
                  fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', border: `1px solid ${statusMeta.color}33`,
                }}>
                  {isRTL ? statusMeta.label.ar : statusMeta.label.en}
                </span>
              </div>

              <div style={{ display: 'flex', gap: '22px', flexWrap: 'wrap' }}>
                <Field label={isRTL ? 'التاريخ' : 'Date'} value={dateFormatted} isRTL={isRTL} />
                <Field label={isRTL ? 'الوقت' : 'Time'} value={timeFormatted} isRTL={isRTL} />
              </div>

              <div style={{ borderTop: '1px dashed rgba(255,255,255,0.1)' }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
                <div>
                  <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: 700, display: 'block', marginBottom: '4px', fontFamily: PASS_FONT_SANS }}>
                    {isRTL ? 'الضيف' : 'Guest'}
                  </span>
                  <span style={{ fontFamily: PASS_FONT_SERIF, fontSize: '17px', fontWeight: 600, color: '#FFFFFF' }}>{guestName}</span>
                </div>
                {tableName && (
                  <div style={{ textAlign: isRTL ? 'left' : 'right' }}>
                    <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: 700, display: 'block', marginBottom: '4px', fontFamily: PASS_FONT_SANS }}>
                      {isRTL ? 'طاولتك' : 'Your table'}
                    </span>
                    <span style={{ fontSize: '17px', fontWeight: 800, color: accent, fontFamily: PASS_FONT_SANS }}>{formatTableLabel(tableName, isRTL)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* QR stub */}
            <div className="gp-qr-stub" style={{
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: '10px', background: 'rgba(255,255,255,0.02)',
            }}>
              {dateShort && (
                <span style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.45)', fontFamily: PASS_FONT_SANS }}>
                  {dateShort.toUpperCase()}
                </span>
              )}
              {qrImageUrl ? (
                <div style={{ padding: '6px', background: '#FFFFFF', borderRadius: '10px' }}>
                  <img src={qrImageUrl} alt="Check-in QR" style={{ width: '112px', height: '112px', display: 'block' }} />
                </div>
              ) : (
                <div style={{
                  width: '112px', height: '112px', borderRadius: '10px', border: '1px dashed rgba(255,255,255,0.18)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
                  fontSize: '9px', color: 'rgba(255,255,255,0.3)', padding: '8px', fontFamily: PASS_FONT_SANS,
                }}>
                  {isRTL ? 'سيُرسل لاحقاً' : 'Sent separately'}
                </div>
              )}
              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)', textAlign: 'center', lineHeight: 1.4, fontFamily: PASS_FONT_SANS }}>
                {isRTL ? 'امسح للتسجيل' : 'Scan to check in'}
              </span>
            </div>
          </div>

          <div style={{ padding: '0 26px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button
              onClick={handleDownload}
              style={{
                width: '100%', padding: '12px', borderRadius: '10px',
                border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)',
                color: 'rgba(255,255,255,0.75)', fontSize: '13px', fontWeight: 600,
                cursor: 'pointer', fontFamily: PASS_FONT_SANS,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#FFFFFF'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; }}
            >
              ⬇ {isRTL ? 'تحميل بطاقة الدخول' : 'Download Guest Pass'}
            </button>
            {qrImageUrl && (
              <button
                onClick={handleDownloadQr}
                style={{
                  width: '100%', padding: '11px', borderRadius: '10px',
                  border: `1px solid ${accent}55`, background: 'transparent',
                  color: accent, fontSize: '12.5px', fontWeight: 600,
                  cursor: 'pointer', fontFamily: PASS_FONT_SANS,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = `${accent}14`; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                ⬇ {isRTL ? 'تحميل رمز الدخول فقط' : 'Download QR code only'}
              </button>
            )}
            <button
              onClick={() => setFlipped(true)}
              aria-label={isRTL ? 'عرض تفاصيل التذكرة' : 'View pass details'}
              style={{
                background: 'none', border: 'none', padding: '4px', cursor: 'pointer',
                textAlign: 'center', fontSize: '10px', color: 'rgba(255,255,255,0.4)',
                letterSpacing: '0.04em', fontFamily: PASS_FONT_SANS, textDecoration: 'underline',
                textUnderlineOffset: '2px',
              }}
            >
              {isRTL ? 'تفاصيل التذكرة ›' : 'Pass details ›'}
            </button>
          </div>
        </motion.div>

        {/* ── BACK ── */}
        <motion.div
          animate={{ rotateY: flipped ? 0 : -180, opacity: flipped ? 1 : 0 }}
          transition={{ duration: 0.55, ease: [0.4, 0, 0.2, 1] }}
          style={{
            backfaceVisibility: 'hidden', position: flipped ? 'relative' : 'absolute', inset: 0,
            background: 'linear-gradient(160deg, #15161A 0%, #1F2126 100%)', borderRadius: '20px',
            boxShadow: '0 26px 70px -16px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)',
            padding: '30px 28px', display: 'flex', flexDirection: 'column', gap: '16px',
            textAlign: isRTL ? 'right' : 'left', minHeight: '280px',
          }}
        >
          <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '3px', color: 'rgba(255,255,255,0.35)', fontWeight: 700, fontFamily: PASS_FONT_SANS }}>
            {isRTL ? 'تفاصيل التذكرة' : 'Pass Details'}
          </span>
          <div style={{ height: '1px', background: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.15) 0, rgba(255,255,255,0.15) 6px, transparent 6px, transparent 12px)' }} />
          {eventLocation && (
            <div>
              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: 700, display: 'block', marginBottom: '4px', fontFamily: PASS_FONT_SANS }}>
                {isRTL ? 'الموقع' : 'Venue'}
              </span>
              <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.85)', lineHeight: 1.5, fontFamily: PASS_FONT_SANS }}>{eventLocation}</span>
            </div>
          )}
          <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.45)', lineHeight: 1.7, fontStyle: 'italic', fontFamily: PASS_FONT_SERIF }}>
            {isRTL
              ? 'يُرجى إبراز رمز QR عند الوصول لتسجيل دخولك بسلاسة. هذه التذكرة شخصية وغير قابلة للتحويل.'
              : 'Present this QR at the entrance for a seamless check-in. This pass is personal and non-transferable.'}
          </p>
          <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: removeWatermark ? 'flex-end' : 'space-between' }}>
            {!removeWatermark && (
              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.2)', letterSpacing: '1px', fontFamily: PASS_FONT_SANS }}>Fancy RSVP</span>
            )}
            <button
              onClick={() => setFlipped(false)}
              aria-label={isRTL ? 'العودة إلى بطاقة الدخول' : 'Back to pass'}
              style={{
                background: 'none', border: 'none', padding: '4px', cursor: 'pointer',
                fontSize: '10px', color: accent, fontWeight: 700, fontFamily: PASS_FONT_SANS,
              }}
            >
              {isRTL ? '↺ العودة' : '↺ Back to pass'}
            </button>
          </div>
        </motion.div>
      </motion.div>

      <style jsx>{`
        /* The QR stub's fixed 112px QR code + its own padding needs ~152px,
           but its 35% flex-basis only clears that on a ~435px+ wide card —
           on real phone widths (320-414px) the row silently clips the title,
           guest name, and status badge instead of scrolling (the card has
           overflow:hidden). Stack the QR full-width below the details
           instead of shrinking it, since a shrunk QR risks becoming
           unscannable at the door.

           The two flex values and the QR stub's padding used to be inline, which
           meant the two rules below that override them never applied — the half of
           this fix that shrank the QR column back to 35% survived on phones, which
           is precisely the failure the comment above describes. */
        .gp-main-stub { flex: 1 1 65%; padding: 26px 26px 22px; }
        .gp-qr-stub { flex: 0 0 35%; padding: 22px 14px; }

        @media (max-width: 639.98px) {
          .gp-front-row { flex-direction: column; }
          .gp-main-stub { flex: 1 1 auto; }
          .gp-qr-stub { flex: 1 1 auto; width: 100%; padding: 18px 14px 24px; border-top: 1px dashed rgba(255,255,255,0.1); }
        }
      `}</style>
    </div>
  );
}

function Field({ label, value, isRTL }) {
  if (!value) return null;
  return (
    <div>
      <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: 700, display: 'block', marginBottom: '2px', fontFamily: PASS_FONT_SANS }}>
        {label}
      </span>
      <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.8)', fontWeight: 500, fontFamily: PASS_FONT_SANS }}>{value}</span>
    </div>
  );
}

function downloadCanvas(canvas, guestName) {
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `guest-pass-${(guestName || 'ticket').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}.png`;
  a.click();
}
