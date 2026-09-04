'use client';

/* `React` is imported and it is NOT unused — vitest compiles this file with the
   classic JSX runtime. See SmsConsentText.js for the full note. */
import React from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import { isWhiteLabel } from '../../utils/guestBranding';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "CREATE YOUR OWN" — the one piece of our marketing a guest ever sees.
 *
 * It renders at the very bottom of the RSVP result screen, after a guest has
 * answered. That position is the entire strategy: they have just been through a
 * wax-seal reveal, an invitation card, a form that behaved, confetti and their
 * own entry pass. They are at peak appreciation of the product, and the pitch
 * writes itself — *the thing you just opened was made here.*
 *
 * ── WHY IT IS NOT UNDER THE FORM ITSELF ──
 *
 * The obvious reading of "under the RSVP form" is directly beneath the submit
 * button, before the guest has answered. That is the one place it must not go.
 * The host is our paying customer and their conversion is the guest completing
 * the RSVP; a competing call-to-action sitting next to their submit button
 * spends the host's conversion to buy ours. After the answer, nothing is being
 * competed with — the guest is done, and the only remaining question is what
 * they do next.
 *
 * ── THE DESIGN CONSTRAINT THAT SHAPED EVERYTHING ──
 *
 * This appears at the bottom of somebody's WEDDING INVITATION. If it reads as an
 * advertisement it cheapens the host's event, which is the product our actual
 * customer is paying us for. So:
 *
 *   • it takes the EVENT's colour, not our gold, and reads as the last section
 *     of their invitation rather than a banner pasted underneath one;
 *   • the artwork is a miniature of the card they just opened, seal and all —
 *     a memory hook and a product demonstration in one element, and the only
 *     "screenshot" that never goes out of date because it is drawn in CSS;
 *   • no logo lockup, no badge, no "Powered by" bar. One quiet tracked line;
 *   • it enters LAST and slowly. It is the least important thing on the screen
 *     and it should behave like it.
 *
 * ── WHITE LABEL IS A HARD GATE ──
 *
 * An organizer who paid to remove our branding must never find our marketing on
 * their guest page. `isWhiteLabel` is the same helper the share preview, the tab
 * title, the JSON-LD and the .ics file use — one condition, so this surface
 * cannot drift out of agreement with the other four.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** `#RRGGBB` + opacity → `rgba()`. Local so this file does not import from a template. */
const alpha = (hex, a) => {
  const h = String(hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n) || full.length !== 6) return `rgba(184,148,79,${a})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/**
 * THE MINIATURE INVITATION.
 *
 * Drawn rather than photographed, for three reasons that all matter: it takes
 * the event's own colour so it looks like THEIR invitation shrunk down, it costs
 * no image request on a phone at the end of a long page, and it can never go
 * stale the way a screenshot of a product does.
 *
 * The tilt and the shadow are what stop it reading as a rectangle: it is a
 * physical card lying on the page. Purely decorative, so it is hidden from
 * assistive technology entirely — a screen reader gets the headline and the
 * button, which is the whole message.
 */
function MiniInvitation({ color, reduceMotion }) {
  const card = (
    <div
      style={{
        width: 132, height: 92, borderRadius: 10, position: 'relative',
        background: 'linear-gradient(155deg, #FFFFFF 0%, #FDFBF6 100%)',
        border: `1px solid ${alpha(color, 0.28)}`,
        boxShadow: `0 18px 34px -18px ${alpha(color, 0.55)}, 0 2px 6px -2px rgba(0,0,0,0.06)`,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 7, overflow: 'hidden',
      }}
    >
      {/* A hairline inset frame — the single detail that makes a rectangle read
          as stationery rather than as a UI card. */}
      <span style={{
        position: 'absolute', inset: 6, borderRadius: 6,
        border: `1px solid ${alpha(color, 0.16)}`, pointerEvents: 'none',
      }} />
      {/* Three ruled lines standing in for the copy, tapering like centred text. */}
      {[38, 52, 30].map((w, i) => (
        <span key={w} style={{
          width: w, height: i === 1 ? 3 : 2, borderRadius: 2,
          background: alpha(color, i === 1 ? 0.5 : 0.24),
        }} />
      ))}
    </div>
  );

  const seal = (
    <div
      style={{
        position: 'absolute', bottom: -13, insetInlineEnd: -11,
        width: 40, height: 40, borderRadius: '50%',
        background: `radial-gradient(circle at 34% 30%, ${alpha(color, 0.95)}, ${alpha(color, 0.72)} 62%, ${alpha(color, 0.9)})`,
        boxShadow: `0 6px 14px -4px ${alpha(color, 0.6)}, inset 0 -2px 4px ${alpha('#000000', 0.18)}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 3.6l2.3 4.9 5.3.7-3.9 3.7 1 5.3-4.7-2.6-4.7 2.6 1-5.3L4.4 9.2l5.3-.7z"
          fill="rgba(255,255,255,0.92)"
        />
      </svg>
    </div>
  );

  const inner = (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {card}
      {seal}
    </div>
  );

  if (reduceMotion) {
    // The card still sits at its resting tilt — the angle is the design, only
    // the movement is the animation.
    return <div aria-hidden="true" style={{ display: 'inline-block', transform: 'rotate(-5deg)' }}>{inner}</div>;
  }
  return (
    <motion.div
      aria-hidden="true"
      /* `animate`, not `whileInView`. Both hosts are short confirmation screens
         where this is on screen the moment it mounts, so the observer buys no
         effect — and it costs a real risk: whileInView leaves the element at
         `initial` (opacity 0) until an IntersectionObserver callback fires, so
         anything that stops the observer running leaves the block permanently
         invisible. It also matches the neighbours, which all use initial/animate
         or FadeInUp. */
      initial={{ opacity: 0, y: 14, rotate: -8, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, rotate: -5, scale: 1 }}
      transition={{ duration: 0.7, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
      style={{ display: 'inline-block', transformOrigin: 'center' }}
    >
      {inner}
    </motion.div>
  );
}

/** One of the three micro-proofs. An icon and two words, never a bullet list. */
function Proof({ children, color, icon }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontFamily: 'var(--font-sans)', fontSize: 12, color: alpha('#191B1E', 0.62),
      whiteSpace: 'nowrap',
    }}>
      <span aria-hidden="true" style={{ color, display: 'inline-flex' }}>{icon}</span>
      {children}
    </span>
  );
}

const IconPen = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);
const IconReplies = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.5 8.5 0 0 1 21 11.5z" />
  </svg>
);
const IconSeats = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="8" /><circle cx="12" cy="4.5" r="1.6" /><circle cx="19.5" cy="12" r="1.6" />
    <circle cx="12" cy="19.5" r="1.6" /><circle cx="4.5" cy="12" r="1.6" />
  </svg>
);

/**
 * OCCASIONS THIS MUST STAY SILENT ON.
 *
 * The platform hosts 25+ occasion types (utils/customEventCategories.js), and
 * they are not all celebrations. A memorial has an RSVP form, a guest list and
 * seating exactly like a wedding does — and putting "Create your own" under
 * somebody's celebration-of-life invitation is indefensible at any level of
 * craft. There is no wording that fixes it; the block simply does not appear.
 *
 * Matched loosely on the occasion string because it arrives from
 * `template_data` and has been written by several code paths over time.
 */
const SILENT_OCCASIONS = /memorial|funeral|condolence|tazia|عزاء|تأبين/i;

/**
 * @param {object}  props
 * @param {object}  props.event       needs `tier_white_label`; occasion is read if present
 * @param {string}  props.themeColor  the event's own accent
 * @param {boolean} props.isRTL
 */
export default function CreateYourOwnEvent({ event, themeColor = '#B8944F', isRTL = false }) {
  const reduceMotion = useReducedMotion();

  // The hard gate. See the module note.
  if (isWhiteLabel(event)) return null;

  // The tone gate. See SILENT_OCCASIONS.
  const occasion = event?.template_data?.occasion || event?.event_type || '';
  if (SILENT_OCCASIONS.test(String(occasion))) return null;

  const t = isRTL
    ? {
      eyebrow: 'صُنعت هذه الدعوة على FancyRSVP',
      heading: 'اصنع دعوتك أنت',
      // Names the BREADTH rather than one occasion: the guest reading this is
      // planning something, and it is usually not what they just attended.
      body: 'أعراس، أعياد ميلاد، تخرّج، مناسبات الشركات — الدعوة وقائمة الضيوف وخريطة الجلوس في مكان واحد.',
      design: 'صمّمها',
      replies: 'تابع الردود',
      seats: 'وزّع الطاولات',
      cta: 'اصنع مناسبتك',
      secondary: 'الأسعار',
    }
    : {
      eyebrow: 'This invitation was made with FancyRSVP',
      heading: 'Create your own',
      body: 'Weddings, birthdays, graduations, corporate evenings — the invitation, the guest list and the seating, all in one place.',
      design: 'Design it',
      replies: 'Track replies',
      seats: 'Seat everyone',
      cta: 'Create your event',
      secondary: 'See pricing',
    };

  const Wrapper = reduceMotion ? 'div' : motion.div;
  const wrapperMotion = reduceMotion ? {} : {
    initial: { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    // Last on the screen and slowest to arrive: it is the least important thing
    // here and it should behave like it.
    transition: { duration: 0.75, delay: 0.15, ease: [0.16, 1, 0.3, 1] },
  };

  return (
    <Wrapper
      {...wrapperMotion}
      dir={isRTL ? 'rtl' : 'ltr'}
      style={{
        marginTop: 34, paddingTop: 30,
        // A hairline rather than a card: this is the closing note of their
        // invitation, not a second panel competing with it.
        borderTop: `1px solid ${alpha(themeColor, 0.16)}`,
        textAlign: 'center',
      }}
    >
      <div style={{
        fontFamily: 'var(--font-sans)', fontSize: 11,
        letterSpacing: isRTL ? 'normal' : '0.16em',
        textTransform: isRTL ? 'none' : 'uppercase',
        color: alpha(themeColor, 0.85), fontWeight: 700, marginBottom: 20,
      }}>
        {t.eyebrow}
      </div>

      <MiniInvitation color={themeColor} reduceMotion={reduceMotion} />

      <h3 style={{
        fontFamily: 'var(--font-serif)',
        // clamp, not a fixed size: this headline sits between a 320px phone and
        // a desktop invitation page and has to hold its proportion in both.
        fontSize: 'clamp(23px, 6vw, 29px)',
        fontWeight: 700, color: '#191B1E',
        margin: '22px 0 8px', lineHeight: 1.25,
      }}>
        {t.heading}
      </h3>

      <p style={{
        fontFamily: 'var(--font-sans)', fontSize: 14, lineHeight: 1.7,
        color: alpha('#191B1E', 0.66), margin: '0 auto 18px', maxWidth: 340,
      }}>
        {t.body}
      </p>

      {/* .fx-row wraps; a fixed row of three nowrap items cannot fit 320px.
          Centred via the modifier rather than an inline justifyContent, which
          would make the class inert. */}
      <div className="fx-row fx-row--center" style={{ gap: 16, marginBottom: 24 }}>
        <Proof color={themeColor} icon={IconPen}>{t.design}</Proof>
        <Proof color={themeColor} icon={IconReplies}>{t.replies}</Proof>
        <Proof color={themeColor} icon={IconSeats}>{t.seats}</Proof>
      </div>

      {/**
        * BOTH LINKS GO TO MARKETING SURFACES, NOT TO THE SIGNUP FORM.
        *
        * The primary CTA pointed at `/register`. This is the coldest traffic
        * this product ever gets — somebody who came to answer a friend's
        * invitation and has, until ten seconds ago, never heard of us — and a
        * bare signup form asks them to commit before anything has explained
        * what they would be committing to. The landing page is the thing built
        * to do that explaining, and it carries its own signup CTA at the end.
        *
        * `?ref=invite` is the only attribution here: it costs nothing, needs no
        * analytics dependency, and is the difference between knowing this
        * surface works and guessing.
        */}
      <div className="fx-row fx-row--center" style={{ gap: 10 }}>
        <Link
          href="/?ref=invite"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            minHeight: 'var(--fx-touch)', padding: '13px 30px', borderRadius: 999,
            background: `linear-gradient(135deg, ${alpha(themeColor, 0.94)}, ${themeColor})`,
            color: '#FFFFFF', textDecoration: 'none',
            fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 700,
            letterSpacing: '0.01em',
            boxShadow: `0 12px 26px -12px ${alpha(themeColor, 0.85)}`,
          }}
        >
          {t.cta}
        </Link>
        <Link
          href="/pricing?ref=invite"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            minHeight: 'var(--fx-touch)', padding: '13px 20px', borderRadius: 999,
            color: alpha('#191B1E', 0.62), textDecoration: 'none',
            fontFamily: 'var(--font-sans)', fontSize: 13.5, fontWeight: 600,
          }}
        >
          {t.secondary}
        </Link>
      </div>
    </Wrapper>
  );
}
