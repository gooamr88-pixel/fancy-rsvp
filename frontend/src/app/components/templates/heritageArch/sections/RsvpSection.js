'use client';

import React, { useState, useEffect, useRef, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CalendarButton, ShareButton } from '../../../guest/GuestUI';
import { LockIcon } from '../../../guest/RsvpIcons';
import { ConfettiExplosion } from '../../../guest/GuestAnimations';
import GuestPassCard from '../../../guest/GuestPassGenerator';
import ContactRegisteredNotice from '../../../guest/rsvp/ContactRegisteredNotice';
import AdultsOnlyNotice from '../../../guest/AdultsOnlyNotice';
import CompanionMealCounter, { trimMealCounts } from '../../../guest/rsvp/CompanionMealCounter';
import CountryCodePhoneInput from '../../../CountryCodePhoneInput';
import SmsConsentText, { SmsConsentIndependence } from '../../../guest/SmsConsentText';
import CreateYourOwnEvent from '../../../guest/CreateYourOwnEvent';
import TurnstileWidget, { turnstileEnabled } from '../../../guest/TurnstileWidget';
import { normalizeToE164 } from '../../../../utils/phone';
import { publicApiFetch } from '../../../../utils/publicApi';
import { useIdempotentRsvpSubmit } from '../../../guest/rsvp/useIdempotentRsvpSubmit';
import { rememberGuest } from '../../../guest/rsvp/useRsvpResolver';
import { getCelebrationPreset } from '../../../../utils/patternCelebration';
import { useFullPageTheme } from '../theme';
import { SectionShell, SectionHeading, DiamondDivider } from '../shared';
import Icon from '../../../icons/Icon';
import { findMealField } from '../../../../utils/mealField';
import { isSeatingRevealed } from '../../../../utils/seating';
import { getRsvpDeadlineStatus, daysLeftPhrase } from '../../../../utils/rsvpDeadline';
import { useSeatingLookup } from '../../../../[slug]/rsvp/hooks/useSeatingLookup';
import SeatingResultPanel from '../../../../[slug]/rsvp/steps/SeatingResultPanel';
import { alpha, darken, isDark } from '../../../../utils/color';
import { safeZone } from '../../../../utils/timezone';

const ALLERGY_OPTIONS = ['Gluten-free / Celiac', 'Lactose-free', 'Nut allergy', 'Seafood'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Warm dusty-rose validation red — distinct from the burgundy accent so an error
// never reads as "selected", yet still belongs to the palette's warm family.
const ERR = '#C45E5E';

/* ── ThemedField ──────────────────────────────────────────────────────────
   Module-scope (never re-created per render → inputs keep focus while typing)
   label + control + animated error, wired for a11y (label/for, aria-invalid,
   aria-describedby, role="alert"). Colored from the caller's palette instead of
   the generic gold GuestUI.FormField, so it reads as part of the burgundy theme. */
function ThemedField({ label, required, error, hint, labelColor, children }) {
  const autoId = useId();
  const fieldId = (React.isValidElement(children) && children.props.id) || autoId;
  const errorId = `${fieldId}-err`;
  const control = React.isValidElement(children)
    ? React.cloneElement(children, {
        id: children.props.id || fieldId,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': error ? errorId : children.props['aria-describedby'],
      })
    : children;
  return (
    <div>
      {label && (
        <label htmlFor={fieldId} style={{
          fontSize: '12px', fontWeight: 700, letterSpacing: '0.01em',
          color: labelColor, opacity: 0.82, display: 'block', marginBottom: '7px', fontFamily: 'var(--font-sans)',
        }}>
          {label} {required && <span style={{ color: ERR }} aria-hidden="true">*</span>}
        </label>
      )}
      {control}
      {hint && !error && (
        <span style={{ display: 'block', marginTop: '5px', fontSize: '11px', color: labelColor, opacity: 0.55, fontFamily: 'var(--font-sans)' }}>{hint}</span>
      )}
      <AnimatePresence>
        {error && (
          <motion.span
            id={errorId} role="alert"
            initial={{ opacity: 0, y: -3, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, y: -3, height: 0 }}
            style={{ fontSize: '11.5px', color: ERR, display: 'block', marginTop: '5px', fontWeight: 600, fontFamily: 'var(--font-sans)' }}
          >
            {error}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── PartyStepper ── themed −/N/+ counter (replaces the off-brand gold GuestUI one). */
function PartyStepper({ value, onChange, min = 1, max = 20, label, isRTL, C }) {
  const btn = (disabled) => ({
    width: '46px', height: '46px', borderRadius: '13px', flexShrink: 0,
    border: `1px solid ${C.border}`, background: C.cream,
    fontSize: '22px', lineHeight: 1, fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: disabled ? alpha(C.maroon, 0.3) : C.maroon,
  });
  return (
    <div>
      {label && <label style={{ fontSize: '12px', fontWeight: 700, color: C.ink, opacity: 0.82, display: 'block', marginBottom: '7px', fontFamily: 'var(--font-sans)' }}>{label}</label>}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '14px',
        background: C.cream, borderRadius: '15px', padding: '8px 14px', border: `1px solid ${C.border}`,
      }}>
        <motion.button type="button" whileTap={{ scale: 0.88 }} aria-label={isRTL ? 'إنقاص العدد' : 'Decrease party size'}
          onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} style={btn(value <= min)}>−</motion.button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <AnimatePresence mode="popLayout">
            <motion.span key={value} initial={{ y: -18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 18, opacity: 0 }} transition={{ duration: 0.2 }}
              style={{ fontSize: '30px', fontWeight: 800, color: C.maroon, fontFamily: 'var(--font-serif)', display: 'block', lineHeight: 1.1 }}>
              {value}
            </motion.span>
          </AnimatePresence>
          <span style={{ fontSize: '11px', color: C.ink, opacity: 0.6, fontWeight: 600 }}>
            {value === 1 ? (isRTL ? 'ضيف واحد' : 'guest') : (isRTL ? 'ضيوف' : 'guests')}
          </span>
        </div>
        <motion.button type="button" whileTap={{ scale: 0.88 }} aria-label={isRTL ? 'زيادة العدد' : 'Increase party size'}
          onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} style={btn(value >= max)}>+</motion.button>
      </div>
    </div>
  );
}

/* ── AttendanceChoice ── the emotional core: "will you be there?" as two large,
   tactile reply cards (accept = warm burgundy hero, decline = quiet but real). */
function AttendanceChoice({ value, onSelect, C, isRTL }) {
  const OPTIONS = [
    {
      key: 'yes', accent: C.maroon,
      title: isRTL ? 'نعم، سأكون هناك' : "Yes, I'll be there",
      sub: isRTL ? 'بكل سرور وحب' : 'With joy & love',
      glyph: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      ),
    },
    {
      key: 'no', accent: darken(C.ink, 0.05),
      title: isRTL ? 'للأسف، لا أستطيع' : "Sadly, can't make it",
      sub: isRTL ? 'سنفتقد وجودكم' : "You'll be missed",
      glyph: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4l16 16M20 4L4 20" /></svg>
      ),
    },
  ];
  return (
    <div role="radiogroup" aria-label={isRTL ? 'هل ستحضر؟' : 'Will you attend?'}
      className="ha-attend-grid fx-grid" style={{ '--fx-col': '190px', '--fx-gap': '12px' }}>
      {OPTIONS.map((opt) => {
        const selected = value === opt.key;
        const isYes = opt.key === 'yes';
        return (
          <motion.button
            key={opt.key} type="button" role="radio" aria-checked={selected}
            onClick={() => onSelect(opt.key)}
            whileHover={{ y: -3 }} whileTap={{ scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 22 }}
            style={{
              position: 'relative', overflow: 'hidden', textAlign: isRTL ? 'right' : 'left',
              padding: '18px 18px', borderRadius: '18px', cursor: 'pointer',
              minHeight: '104px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '12px',
              fontFamily: 'var(--font-sans)',
              border: `1.5px solid ${selected ? opt.accent : C.border}`,
              background: selected
                ? (isYes ? `linear-gradient(150deg, ${C.solidFill} 0%, ${C.solidFillDeep} 100%)` : C.paper)
                : C.cream,
              color: selected ? (isYes ? '#FFFCF6' : C.ink) : C.ink,
              boxShadow: selected ? `0 16px 34px -16px ${alpha(opt.accent, 0.6)}` : `0 2px 10px ${alpha(C.ink, 0.05)}`,
            }}
          >
            <span aria-hidden style={{
              width: '38px', height: '38px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: selected ? (isYes ? alpha('#FFFCF6', 0.18) : alpha(C.maroon, 0.1)) : alpha(C.maroon, 0.08),
              color: selected ? (isYes ? '#FFFCF6' : C.maroon) : C.maroon,
              border: isYes && selected ? '1px solid rgba(255,252,246,0.4)' : 'none',
            }}>{opt.glyph}</span>
            <span>
              <span style={{ display: 'block', fontSize: '15px', fontWeight: 700, lineHeight: 1.25 }}>{opt.title}</span>
              <span style={{ display: 'block', fontSize: '12px', marginTop: '3px', opacity: selected ? 0.85 : 0.55 }}>{opt.sub}</span>
            </span>
            {/* Selected corner tick — a quiet confirmation flourish. */}
            {selected && (
              <motion.span aria-hidden initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 16 }}
                style={{
                  position: 'absolute', top: '12px', ...(isRTL ? { left: '12px' } : { right: '12px' }),
                  width: '20px', height: '20px', borderRadius: '50%',
                  background: isYes ? '#FFFCF6' : C.maroon, color: isYes ? C.maroon : '#FFFCF6',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </motion.span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}

export default function RsvpSection({ event, slug, guestRsvp, hasResponded, responseStatus, allowGuestEdits, effectiveRsvpId, mealOptions: mealOptionsProp, isRTL, trackEvent, readOnly = false }) {
  const C = useFullPageTheme();
  // Whether this event's page is a dark theme (several style variants ship
  // dark backgrounds — marrakesh, saffron, orchid). Used below so the RSVP
  // card's glassmorphism tint is frosted glass over the PAGE'S OWN material
  // (dark-tinted on a dark page) rather than a fixed white panel that would
  // otherwise sit as a jarring bright patch on a dark theme.
  const pageIsDark = isDark(C.background);
  // Opt-out toggle (EventSettings "Ask guests about food allergies & dietary
  // restrictions") — on unless the organizer explicitly turned it off.
  const collectDietary = event?.collect_dietary_restrictions !== false;
  // Wording only — "Groom's/Bride's Side" for a wedding, "Partner 1/2's Side"
  // for every other couple-style event (engagement, vow renewal, custom).
  // Matches RsvpWizard/StepPartyDetails' own isWedding convention exactly.
  const isWedding = event?.event_type === 'wedding';
  // Personalized side labels — "Ahmed's Side" reads far more like a real
  // invitation than a generic "Groom's Side" once the organizer has actually
  // named the couple, which they always have by the time RSVP is live.
  const sideTd = event?.template_data || {};
  const partner1Name = sideTd.groom_name || sideTd.partner1Name || sideTd.partner1 || '';
  const partner2Name = sideTd.bride_name || sideTd.partner2Name || sideTd.partner2 || '';
  const side1Fallback = isWedding ? (isRTL ? 'العريس' : 'Groom') : (isRTL ? 'الشريك الأول' : 'Partner 1');
  const side2Fallback = isWedding ? (isRTL ? 'العروس' : 'Bride') : (isRTL ? 'الشريك الثاني' : 'Partner 2');
  const side1Label = isRTL ? `جانب ${partner1Name || side1Fallback}` : `${partner1Name || side1Fallback}'s Side`;
  const side2Label = isRTL ? `جانب ${partner2Name || side2Fallback}` : `${partner2Name || side2Fallback}'s Side`;
  const side1Initial = (partner1Name || side1Fallback).trim().charAt(0).toUpperCase();
  const side2Initial = (partner2Name || side2Fallback).trim().charAt(0).toUpperCase();

  // ── Themed input chrome (burgundy palette, not GuestUI's gold) ──
  const fieldStyle = {
    width: '100%', boxSizing: 'border-box', padding: '13px 15px',
    background: C.cream, border: `1px solid ${C.border}`, borderRadius: '11px',
    // 16px — under that, iOS Safari auto-zooms the page on focus.
    fontSize: '16px', color: C.ink, outline: 'none', fontFamily: 'var(--font-sans)',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
  };
  const onFieldFocus = (e) => { e.target.style.borderColor = C.maroon; e.target.style.boxShadow = `0 0 0 3px ${alpha(C.maroon, 0.12)}`; };
  const onFieldBlur = (e, invalid) => { e.target.style.borderColor = invalid ? ERR : C.border; e.target.style.boxShadow = 'none'; };
  const labelStyle = { fontSize: '12px', fontWeight: 700, color: C.ink, opacity: 0.82, display: 'block', marginBottom: '7px' };
  const errorTextStyle = { display: 'block', marginTop: '6px', fontSize: '11.5px', color: ERR, fontWeight: 600 };
  // Wide letter-spacing is an elegant, deliberate look on English all-caps
  // eyebrows — but Arabic script relies on its letters staying connected to
  // render properly, so the same tracking visually pries them apart into
  // disjointed, "broken"-looking characters. Skipped entirely for Arabic.
  const eyebrowStyle = { fontSize: '11px', fontWeight: 800, letterSpacing: isRTL ? 'normal' : '0.16em', textTransform: isRTL ? 'none' : 'uppercase', color: C.maroon, opacity: 0.9 };

  // Card frame shared by the details/companion blocks — a hairline gold→maroon
  // gradient edge over cream, giving each grouping a soft printed-stationery lift.
  const cardOuter = {
    padding: '1.25px', borderRadius: '19px',
    background: `linear-gradient(140deg, ${alpha(C.gold, 0.55)}, ${alpha(C.maroon, 0.35)} 55%, ${alpha(C.gold, 0.45)})`,
    boxShadow: `0 18px 40px -22px ${alpha(C.maroon, 0.4)}`,
  };
  const cardInner = {
    background: `linear-gradient(180deg, ${C.cream} 0%, ${C.background} 140%)`,
    borderRadius: '18px', padding: 'clamp(16px, 4.5vw, 20px)', display: 'flex', flexDirection: 'column', gap: '15px',
  };

  // ── Form Builder integration (unchanged contract — mirrors RsvpWizard) ──
  const allCustomFields = event?.custom_form_fields || [];
  const mealField = findMealField(allCustomFields);
  const mealOptions = (mealField?.options && mealField.options.length > 0) ? mealField.options : mealOptionsProp;
  const customQuestions = mealField ? allCustomFields.filter((f) => f.id !== mealField.id) : allCustomFields;
  const alwaysQuestions = customQuestions.filter((f) => f.condition === 'always');
  const attendingQuestions = customQuestions.filter((f) => f.condition !== 'always');

  const [guestName, setGuestName] = useState(guestRsvp?.guest_name || '');
  const [phone, setPhone] = useState(guestRsvp?.phone || '');
  const [email, setEmail] = useState(guestRsvp?.email || '');
  const [attending, setAttending] = useState(hasResponded ? (guestRsvp.response === 'no' ? 'no' : 'yes') : null);
  const [partySize, setPartySize] = useState(1);
  const [additionalGuests, setAdditionalGuests] = useState([]);
  const [allergies, setAllergies] = useState([]);
  const [otherAllergy, setOtherAllergy] = useState('');
  const [meal, setMeal] = useState('');
  // Which partner's side a guest belongs to — organizer-gated
  // (event.track_guest_side), mirrors RsvpWizard/StepPartyDetails' own
  // showSidePicker. This full-page inline form (used by every heritageArch
  // event, wedding AND engagement alike) never had this field at all, unlike
  // the standalone /[slug]/rsvp route — the two guest-RSVP render paths
  // drifting again, same class of gap documented elsewhere in this codebase.
  const [side, setSide] = useState('');
  const [message, setMessage] = useState('');
  const [smsConsent, setSmsConsent] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // A resubmit the backend rejected as a duplicate (same email/phone already has
  // a response on file). Distinct from `submitted` — a locked attempt wrote
  // nothing, so it must never be treated as a fresh success.
  const [locked, setLocked] = useState(false);
  const [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState({});
  const [customAnswers, setCustomAnswers] = useState({});
  // Organizer preview only: their submit passed validation and stopped there.
  // Says so, rather than appearing to have done nothing.
  const [previewNotice, setPreviewNotice] = useState(false);

  // Cloudflare Turnstile — mirrors RsvpWizard. When NEXT_PUBLIC_TURNSTILE_SITEKEY
  // is set, the backend's verifyTurnstile middleware rejects any submit without a
  // solved token, so this full-page form must collect one too.
  const [captchaToken, setCaptchaToken] = useState(null);
  const [captchaLoadError, setCaptchaLoadError] = useState(false);
  const turnstileRef = useRef(null);
  // Signed entrance-ticket token minted by the submit response — powers the
  // scannable QR pass on the "yes" success screen.
  const [qrToken, setQrToken] = useState(null);
  // A submitted email/phone that already belongs to an ANSWERED party. Kept out
  // of `errors` because it carries an action ("That's me") and must survive
  // until the guest edits the field or confirms, rather than clearing on the
  // next submit attempt like a validation flag.
  const [contactRegistered, setContactRegistered] = useState(null);
  const [claiming, setClaiming] = useState(false);

  // Companion meals: { "Beef": 2, "Fish": 1 } for the whole group — companions
  // are names only, so a meal is a count, not a choice tied to a person.
  const [companionMealCounts, setCompanionMealCounts] = useState({});
  const setCompanionMealCount = (option, n) => setCompanionMealCounts((prev) => {
    const next = { ...prev };
    if (n > 0) next[option] = n; else delete next[option];
    return next;
  });
  const [submittedPartyId, setSubmittedPartyId] = useState(null);

  const { submit, submitting } = useIdempotentRsvpSubmit({
    onSuccess: (data) => {
      if (data?.qrToken) setQrToken(data.qrToken);
      // Remember this device's party id so a return visit resolves to the
      // already-registered card instead of a blank, re-submittable form.
      if (data?.partyId) { setSubmittedPartyId(data.partyId); rememberGuest(slug, data.partyId); }
      setSubmitted(true);
    },
    // The RPC rejected this as a duplicate — nothing was written. Flag it as
    // `locked`, NOT `submitted`, so the confirmation screen below renders the
    // "already registered" copy (with the edit affordance) instead of quietly
    // claiming a fresh success for a response that was never saved.
    onLocked: () => setLocked(true),
  });

  // A returning guest who already responded lands on the confirmation card, NOT a
  // fresh form — unless they explicitly tap "Update my response". A resubmit the
  // backend locked as a duplicate lands here too (locked), while a genuine fresh
  // submit (submitted) always shows the card regardless of editing state.
  const showConfirmation = submitted || ((hasResponded || locked) && !editing);

  // Analytics — fire once when the form is actually presented.
  useEffect(() => {
    if (!showConfirmation) trackEvent?.('rsvp_started');
  }, [trackEvent, showConfirmation]);

  // Prefill from the guest's existing RSVP once it resolves (EventPageClient paints
  // from the SSR snapshot with guestRsvp still null, then fills it after refetch —
  // a render-time initializer alone would miss it). Only fills untouched fields, so
  // an edit shows the real party/meal/dietary/message instead of resetting them.
  const prefilledRef = useRef(false);
  /* eslint-disable react-hooks/set-state-in-effect -- legitimate prop→state sync:
     guestRsvp resolves asynchronously after the SSR paint (see comment above). */
  useEffect(() => {
    if (prefilledRef.current || !guestRsvp) return;
    prefilledRef.current = true;
    setGuestName((prev) => prev || guestRsvp.guest_name || '');
    setPhone((prev) => prev || guestRsvp.phone || '');
    setEmail((prev) => prev || guestRsvp.email || '');
    setAttending((prev) => prev || (['yes', 'no', 'maybe'].includes(guestRsvp.response) ? (guestRsvp.response === 'no' ? 'no' : 'yes') : null));
    if (guestRsvp.party_size) setPartySize((prev) => (prev && prev !== 1 ? prev : guestRsvp.party_size));
    if (guestRsvp.primary_meal) setMeal((prev) => prev || guestRsvp.primary_meal);
    if (guestRsvp.side) setSide((prev) => prev || guestRsvp.side);
    if (Array.isArray(guestRsvp.additionalGuests) && guestRsvp.additionalGuests.length > 0) {
      setAdditionalGuests((prev) => (prev.some((g) => g.fullName) ? prev : guestRsvp.additionalGuests.map((g) => {
        // Same known-pill / free-text split as the primary guest's dietary notes below.
        const parts = String(g.dietaryNotes || '').split(',').map((s) => s.trim()).filter(Boolean);
        const known = parts.filter((p) => ALLERGY_OPTIONS.includes(p));
        const other = parts.filter((p) => !ALLERGY_OPTIONS.includes(p)).join(', ');
        return {
          fullName: g.fullName || '', email: g.email || '', phone: g.phone || '',
          mealSelection: g.mealSelection || '', dietaryNotes: other, allergies: known, customAnswers: {},
        };
      })));
    }
    if (guestRsvp.primary_dietary_notes) {
      const parts = String(guestRsvp.primary_dietary_notes).split(',').map((s) => s.trim()).filter(Boolean);
      const known = parts.filter((p) => ALLERGY_OPTIONS.includes(p));
      const other = parts.filter((p) => !ALLERGY_OPTIONS.includes(p)).join(', ');
      if (known.length) setAllergies((prev) => (prev.length ? prev : known));
      if (other) setOtherAllergy((prev) => prev || other);
    }
    if (guestRsvp.notes) {
      setMessage((prev) => prev || guestRsvp.notes);
    }
  }, [guestRsvp]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Seating — a "yes" guest's own table + companions on the venue map. Gated to
  // the 24h reveal window (or organizer-added guests). Auto-fetched once the guest
  // is confirmed (fresh submit or a returning locked "yes"); before the window the
  // backend returns a locked/empty view, which SeatingResultPanel renders safely.
  const seatingApi = useSeatingLookup(slug);
  const seatingFetchedFor = useRef(null);
  const isYesResponse = attending === 'yes' || (!!guestRsvp?.response && guestRsvp.response !== 'no');
  const seatingRevealed = guestRsvp?.createdByOrganizer === true || (event?.event_date ? isSeatingRevealed(event.event_date) : false);
  const seatingPartyId = submittedPartyId || guestRsvp?.id || null;
  useEffect(() => {
    if (showConfirmation && isYesResponse && seatingRevealed && seatingPartyId && seatingFetchedFor.current !== seatingPartyId) {
      seatingFetchedFor.current = seatingPartyId;
      seatingApi.fetchSeatingMap(seatingPartyId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showConfirmation, isYesResponse, seatingRevealed, seatingPartyId]);

  // The glass panel wrapping the whole form. validate() searches inside it for
  // the first invalid control rather than searching the document.
  const formPanelRef = useRef(null);

  // Bring the revealed detail block into view when the guest picks an answer, so
  // it's obvious something new appeared below the (now-answered) choice.
  const detailsRef = useRef(null);
  const onSelectAttending = (val) => {
    setAttending(val);
    clearError('attending');
    requestAnimationFrame(() => detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };

  const toggleAllergy = (opt) => setAllergies((prev) => (prev.includes(opt) ? prev.filter((o) => o !== opt) : [...prev, opt]));

  const updateAdditionalGuest = (idx, patch) => {
    setAdditionalGuests((prev) => {
      const copy = [...prev];
      copy[idx] = { ...(copy[idx] || {}), ...patch };
      return copy;
    });
  };

  const handlePartySizeChange = (v) => {
    setPartySize(v);
    setAdditionalGuests((prev) => prev.slice(0, Math.max(0, v - 1)));
  // Dropping the party size must drop the meals with it. Without this the tally
  // keeps a total for a group that no longer exists, and the guest is told
  // "too many meals chosen" about companions they just removed.
    setCompanionMealCounts((prev) => trimMealCounts(prev, Math.max(0, v - 1)));
  };

  const setCustomAnswer = (fieldId, value) => {
    setCustomAnswers((prev) => ({ ...prev, [fieldId]: value }));
    setErrors((prev) => { const n = { ...prev }; delete n[`field_${fieldId}`]; return n; });
  };
  const toggleCustomMulti = (fieldId, opt) => {
    setCustomAnswers((prev) => {
      const cur = (prev[fieldId] || '').split(',').map((s) => s.trim()).filter(Boolean);
      const i = cur.indexOf(opt);
      if (i >= 0) cur.splice(i, 1); else cur.push(opt);
      return { ...prev, [fieldId]: cur.join(', ') };
    });
    setErrors((prev) => { const n = { ...prev }; delete n[`field_${fieldId}`]; return n; });
  };

  const clearError = (key) => setErrors((prev) => { if (!prev[key]) return prev; const n = { ...prev }; delete n[key]; return n; });

  /**
   * "That's me" asks the server to email a short-lived link to the address on
   * file, rather than merging on a click — a click proves nothing about who is
   * holding the keyboard.
   */
  const requestClaimLink = async () => {
    if (claiming) return;
    setClaiming(true);
    try {
      await publicApiFetch(`/public/events/${slug}/rsvp/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, lang: isRTL ? 'ar' : 'en' }),
      });
    } catch { /* the reply is identical either way by design — see the handler */ }
    setContactRegistered((prev) => (prev ? { ...prev, sent: true } : prev));
    setClaiming(false);
  };

  const CUSTOM_INPUT_TYPE = { email: 'email', phone: 'tel', url: 'url', number: 'number', date: 'date' };
  const optionRowStyle = { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: C.ink, cursor: 'pointer', minHeight: '44px' };
  // The shared "pill" the whole form speaks in — attend yes/no, meal, custom
  // radio/multiselect — all render as the same rounded chip (44px tap target).
  const pillStyle = (selected, { size = 'md', full = false } = {}) => ({
    padding: size === 'sm' ? '9px 15px' : '11px 18px',
    minHeight: '44px', boxSizing: 'border-box',
    borderRadius: full ? '13px' : '999px', cursor: 'pointer',
    fontFamily: 'var(--font-sans)', fontSize: size === 'sm' ? '13px' : '14px', fontWeight: 600,
    border: selected ? `1.5px solid ${C.maroon}` : `1px solid ${C.border}`,
    background: selected ? C.maroon : C.cream,
    color: selected ? '#FFFDF8' : C.ink,
    transition: 'all 0.18s ease',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
  });

  const renderCustomControl = (field, { value, onSet, onToggle, invalid }) => {
    const type = field.field_type;
    const inputStyle = invalid ? { ...fieldStyle, borderColor: ERR } : fieldStyle;
    if (['text', 'email', 'phone', 'url', 'number', 'date'].includes(type)) {
      return <input type={CUSTOM_INPUT_TYPE[type] || 'text'} value={value} aria-invalid={invalid} onChange={(e) => onSet(e.target.value)} style={inputStyle} onFocus={onFieldFocus} onBlur={(e) => onFieldBlur(e, invalid)} />;
    }
    if (type === 'textarea') {
      return <textarea rows={3} value={value} aria-invalid={invalid} onChange={(e) => onSet(e.target.value)} style={{ ...inputStyle, resize: 'vertical' }} onFocus={onFieldFocus} onBlur={(e) => onFieldBlur(e, invalid)} />;
    }
    if (type === 'select') {
      return (
        <select value={value} aria-invalid={invalid} onChange={(e) => onSet(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }} onFocus={onFieldFocus} onBlur={(e) => onFieldBlur(e, invalid)}>
          <option value="">{isRTL ? 'اختر...' : 'Select...'}</option>
          {(field.options || []).map((opt, i) => <option key={i} value={opt}>{opt}</option>)}
        </select>
      );
    }
    if (type === 'radio') {
      return (
        <div role="radiogroup" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
          {(field.options || []).map((opt, i) => (
            <button type="button" key={i} role="radio" aria-checked={value === opt} onClick={() => onSet(opt)} style={pillStyle(value === opt, { size: 'sm' })}>{opt}</button>
          ))}
        </div>
      );
    }
    if (type === 'multiselect') {
      const chosen = value.split(',').map((s) => s.trim()).filter(Boolean);
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
          {(field.options || []).map((opt, i) => {
            const on = chosen.includes(opt);
            return <button type="button" key={i} aria-pressed={on} onClick={() => onToggle(opt)} style={pillStyle(on, { size: 'sm' })}>{on ? '✓ ' : ''}{opt}</button>;
          })}
        </div>
      );
    }
    if (type === 'checkbox') {
      return (
        <label style={optionRowStyle}>
          <input type="checkbox" checked={value === 'Yes'} onChange={(e) => onSet(e.target.checked ? 'Yes' : '')} style={{ accentColor: C.maroon, width: '17px', height: '17px' }} />
          {isRTL ? 'نعم' : 'Yes'}
        </label>
      );
    }
    return null;
  };

  const primaryControl = (field) => renderCustomControl(field, {
    value: customAnswers[field.id] || '',
    onSet: (v) => setCustomAnswer(field.id, v),
    onToggle: (opt) => toggleCustomMulti(field.id, opt),
    invalid: !!errors[`field_${field.id}`],
  });

  /* The number and the consent box are REQUIRED to submit — unless the guest is
     declining, who receives no table, no pass and no transactional message at
     all and is therefore exempt from both. `showSmsConsent` used to mean "has
     typed a number"; it means "is not saying no" now.

     Mirrors StepPartyDetails exactly, including the decline exemption. These two
     RSVP paths have drifted apart before, and a validator that disagrees with
     the form it validates rejects submissions for fields it never showed. Full
     rationale — and the Twilio re-filing this requires — in SmsConsentText.js. */
  const hasPhone = !!phone.trim();
  const isDeclining = attending === 'no';
  const showSmsConsent = !isDeclining;

  const validate = () => {
    const e = {};
    const isAttending = attending === 'yes';
    if (!attending) e.attending = true;
    if (!guestName.trim()) e.guestName = isRTL ? 'مطلوب' : 'Required';

    // Phone: REQUIRED unless declining — it is the address the consent below is
    // consent to use, and a decline has nothing to consent to. Blank and
    // malformed are reported separately so a guest who typed something is not
    // told it is missing.
    const normalizedPhone = hasPhone ? normalizeToE164(phone) : '';
    if (isDeclining) {
      // Still format-checked when volunteered: a decliner may leave a number for
      // the host's records, and a malformed one helps nobody.
      if (hasPhone && !normalizedPhone) e.phone = isRTL ? 'رقم هاتف غير صالح' : 'Invalid phone number';
    } else if (!hasPhone) {
      e.phone = isRTL ? 'مطلوب' : 'Required';
    } else if (!normalizedPhone) {
      e.phone = isRTL ? 'رقم هاتف غير صالح' : 'Invalid phone number';
    }

    // Email: required for attendees (confirmation + logistics), optional for declines.
    if (isAttending) {
      if (!email.trim()) e.email = isRTL ? 'مطلوب' : 'Required';
      else if (!EMAIL_RE.test(email.trim())) e.email = isRTL ? 'بريد إلكتروني غير صالح' : 'Invalid email';
    } else if (email.trim() && !EMAIL_RE.test(email.trim())) {
      e.email = isRTL ? 'بريد إلكتروني غير صالح' : 'Invalid email';
    }

    // SMS consent is REQUIRED to submit, unless declining. Its own error rather
    // than being folded into the phone one: a blank field and an unmade
    // decision are different problems and need different sentences.
    if (!isDeclining && !smsConsent) {
      e.smsConsent = isRTL
        ? 'يرجى الموافقة على استلام رسائل الفعالية لنتمكن من إرسال طاولتك وتذكرة دخولك'
        : 'Please agree to receive event texts so we can send your table and entry pass';
    }

    // Bot check — only when Turnstile is configured (mirrors the backend gate).
    if (turnstileEnabled && !captchaToken) e.captcha = true;

    if (isAttending && partySize > 1) {
      for (let i = 0; i < partySize - 1; i++) {
        const g = additionalGuests[i];
        // Per-field flags (not one blanket "additionalGuests" flag) — that flag
        // was never actually read anywhere in the render below, so an incomplete
        // companion field blocked submission with the generic "review the
        // highlighted fields" banner but nothing was actually highlighted,
        // leaving the guest unable to tell which field needed fixing.
        // A companion is a name — email, phone, meal and guest-scoped question
        // checks used to sit here and went with the fields themselves. See the
        // companion row in the render below.
        if (!g?.fullName?.trim()) e[`companion_${i}_fullName`] = true;
      }
    }
    // 'always'-condition required questions apply to every response.
    alwaysQuestions.filter((f) => f.is_required).forEach((f) => {
      const v = customAnswers[f.id];
      if (!v || !v.toString().trim()) e[`field_${f.id}`] = true;
    });
    // Required meal + 'attending'-only required questions are asked of attendees.
    if (isAttending) {
      if (mealField?.is_required && !meal.trim()) e.meal = true;
      // Same two rules the RPC enforces: never more meals than companions, and
      // a complete tally when the organizer made the meal question required.
      if (partySize > 1 && mealOptions?.length > 0) {
        const assigned = Object.values(companionMealCounts).reduce((sum, n) => sum + (Number(n) || 0), 0);
        if (assigned > partySize - 1 || (mealField?.is_required && assigned !== partySize - 1)) {
          e.companionMealCounts = true;
        }
      }
      attendingQuestions.filter((f) => f.is_required).forEach((f) => {
        const v = customAnswers[f.id];
        if (!v || !v.toString().trim()) e[`field_${f.id}`] = true;
      });
    }
    setErrors(e);
    if (Object.keys(e).length > 0) {
      requestAnimationFrame(() => {
        /* Scoped to this form's own panel, not the global document. Two
           reasons, and the second is the one that bit: a page can hold more
           than one aria-invalid control, and in the organizer's preview the
           form is portalled into an iframe — so the dashboard's `document`
           does not contain it and nothing was ever scrolled to. See
           utils/frameDocument.js. */
        const el = formPanelRef.current?.querySelector('[aria-invalid="true"]');
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    /* The organizer's preview runs everything above this line — every required
       field, every custom question, the meal tally, the companion rows — because
       checking that the form they built actually works is most of why they
       opened the preview. It stops here.

       Deliberately AFTER validate(), not before: a submit button that succeeds
       without checking anything would be its own kind of lie, and the organizer
       would ship a form whose validation they had never seen fire. And the
       event does not exist yet at this point in the wizard, so there is no
       `slug` to post to — this would 404 rather than record anything. */
    if (readOnly) {
      setPreviewNotice(true);
      return;
    }

    const isAttending = attending === 'yes';
    const dietaryNotes = [...allergies, otherAllergy.trim()].filter(Boolean).join(', ') || null;
    const notes = message.trim() || null;
    const normalizedPhone = phone.trim() ? (normalizeToE164(phone) || phone) : undefined;

    const body = {
      partyId: guestRsvp?.id || effectiveRsvpId || undefined,
      guestName: guestName.trim(),
      email: email.trim() || undefined,
      phone: normalizedPhone,
      response: attending,
      partySize: isAttending ? partySize : 1,
      notes,
      primaryGuestMeal: isAttending ? (meal || null) : null,
      primaryGuestDietaryNotes: isAttending ? dietaryNotes : null,
      // Name only. The server ignores everything else on a companion now, and
      // posting a stale draft's email would misrepresent what was collected.
      additionalGuests: isAttending
        ? additionalGuests.slice(0, partySize - 1).map((g) => ({ fullName: g.fullName }))
        : [],
      customAnswers: Object.keys(customAnswers)
        .filter((fieldId) => isAttending || alwaysQuestions.some((f) => f.id === fieldId))
        .map((fieldId) => ({ fieldId, value: customAnswers[fieldId] })),
      side: event?.track_guest_side ? (side || undefined) : undefined,
      smsConsent,
      consentSource: 'guest_form_template', // provenance for the sms_consent record (backend whitelists values)
      // A tally for the group rather than a dish per companion.
      companionMealCounts: isAttending && partySize > 1 ? companionMealCounts : null,
      lang: isRTL ? 'ar' : 'en', // sends the confirmation email in the language the guest used
      // The widget is rendered and the token validated above, but it was never
      // actually sent — with TURNSTILE_SECRET set the backend rejects every
      // submission from this surface with CAPTCHA_REQUIRED (RsvpWizard sends it).
      ...(captchaToken ? { captchaToken } : {}),
    };

    const r = await submit({ url: `/public/events/${slug}/rsvp`, body, reconcileId: body.partyId });
    // Turnstile tokens are single-use — force a fresh challenge before any retry.
    if (!r.ok && turnstileEnabled) { turnstileRef.current?.reset(); setCaptchaToken(null); }
    if (!r.ok && r.reason === 'CONTACT_REGISTERED') {
      setContactRegistered({ field: r.field, canUpdate: r.canUpdate });
    }
  };

  /* ═══════════════════════════ SUCCESS / LOCKED ═══════════════════════════ */
  if (showConfirmation) {
    const returning = (hasResponded || locked) && !submitted; // already-registered, not a fresh submit
    // The organizer's "allow guests to change their response" promise is "... until
    // the RSVP deadline", so the edit affordance honors both the toggle and the date.
    const deadlinePassed = !!event?.rsvp_deadline && new Date() > new Date(event.rsvp_deadline);
    const canEdit = allowGuestEdits && !deadlinePassed;
    const isYes = attending === 'yes' || (!!guestRsvp?.response && guestRsvp.response !== 'no');
    const label = responseStatus?.label || (isYes ? (isRTL ? 'تأكيد الحضور' : 'Attending') : (isRTL ? 'الاعتذار عن الحضور' : 'Declined'));
    const celebration = getCelebrationPreset(event?.template_type);
    // The scannable pass works both right after a fresh "yes" (token from the
    // submit response) and for a returning guest (token supplied on guestRsvp).
    const passQrToken = qrToken || guestRsvp?.qrToken || null;
    const passGuestName = guestName || guestRsvp?.guest_name || '';
    return (
      <SectionShell background={C.background}>
        {submitted && isYes && (
          <ConfettiExplosion active duration={4200} particleCount={110} colors={celebration.colors} shapes={celebration.shapes} spread={1.1} />
        )}
        <motion.div
          initial={{ opacity: 0, y: 22, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          style={{ ...cardOuter, width: '100%', maxWidth: '440px' }}
        >
          <div style={{ ...cardInner, alignItems: 'center', textAlign: 'center', padding: 'clamp(28px, 7vw, 40px) clamp(20px, 6vw, 30px)', gap: '6px' }}>
            <motion.div
              initial={{ scale: 0, rotate: -12 }} animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.15 }} aria-hidden="true"
              style={{
                width: '78px', height: '78px', borderRadius: '50%', marginBottom: '14px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isYes ? `linear-gradient(150deg, ${C.solidFill}, ${C.solidFillDeep})` : alpha(C.ink, 0.08),
                color: isYes ? '#FFFCF6' : C.ink, boxShadow: isYes ? `0 14px 30px -12px ${alpha(C.solidFill, 0.6)}` : 'none',
              }}
            >
              {isYes ? (
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              ) : (
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16v12H4z" /><path d="m4 7 8 6 8-6" /></svg>
              )}
            </motion.div>

            <SectionHeading isRTL={isRTL} style={{ marginBottom: '4px' }}>
              {returning ? (isRTL ? 'أنت مسجّل بالفعل' : "You're already registered") : (isRTL ? 'شكراً لك' : 'Thank you')}
            </SectionHeading>
            <DiamondDivider />

            <p style={{ fontSize: '15px', color: C.ink, opacity: 0.85, maxWidth: '360px', lineHeight: 1.75, margin: '4px 0 0' }}>
              {returning
                ? (isYes
                    ? (isRTL ? 'لدينا ردك بالفعل — نتطلّع لرؤيتك!' : "We already have your response on file — we can't wait to see you.")
                    : (isRTL ? 'لدينا ردك بالفعل. شكراً لإعلامنا.' : 'We already have your response on file. Thanks for letting us know.'))
                : (isYes
                    ? (isRTL ? 'يسعدنا انضمامكم إلينا — تم تسجيل ردكم بنجاح.' : "We're so happy you'll be joining us — your response is recorded.")
                    : (isRTL ? 'شكراً لإعلامنا. سنفتقد وجودكم، ونتمنى لكم كل الخير.' : "Thank you for letting us know — you'll be missed, and we wish you all the best."))}
            </p>

            <div style={{ marginTop: '16px', padding: '9px 20px', borderRadius: '999px', background: C.cream, border: `1px solid ${C.border}`, display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: isYes ? '#3B9B6D' : ERR }} />
              <span style={{ fontSize: '13px', fontWeight: 700, letterSpacing: isRTL ? 'normal' : '0.04em', color: C.maroon }}>{label}</span>
            </div>

            {isYes && (
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '24px' }}>
                <CalendarButton event={event} isRTL={isRTL} />
                <ShareButton title={event.title} text={event.description} isRTL={isRTL} />
              </div>
            )}

            {/* Returning guest: an explicit edit affordance (host-gated) — never a
                silent re-registration. */}
            {returning && (
              <div style={{ marginTop: '20px', paddingTop: '18px', borderTop: `1px solid ${C.border}`, width: '100%' }}>
                {canEdit ? (
                  <>
                    <p style={{ fontSize: '12px', color: C.ink, opacity: 0.6, lineHeight: 1.6, margin: '0 0 12px' }}>
                      {isRTL ? 'تغيّرت خططك؟ يمكنك تحديث ردك قبل الموعد النهائي.' : 'Plans changed? You can update your response before the deadline.'}
                    </p>
                    <motion.button
                      type="button" onClick={() => setEditing(true)} whileTap={{ scale: 0.98 }}
                      style={{
                        padding: '11px 24px', borderRadius: '999px', cursor: 'pointer',
                        border: `1.5px solid ${C.maroon}`, background: 'transparent', color: C.maroon,
                        fontWeight: 700, fontSize: '13px', fontFamily: 'var(--font-sans)',
                      }}
                    >
                      {isRTL ? 'تحديث ردّي' : 'Update my response'}
                    </motion.button>
                  </>
                ) : allowGuestEdits ? (
                  <p style={{ fontSize: '12px', color: C.ink, opacity: 0.6, lineHeight: 1.6, margin: 0 }}>
                    {isRTL ? 'انتهى موعد تعديل الردود. يُرجى التواصل مع المضيف لأي تغيير.' : 'The deadline to change your response has passed — please contact your host for any changes.'}
                  </p>
                ) : (
                  <p style={{ fontSize: '12px', color: C.ink, opacity: 0.6, lineHeight: 1.6, margin: 0 }}>
                    {isRTL ? 'لتغيير ردك، يُرجى التواصل مع المضيف مباشرةً.' : 'Need to change your response? Please contact your host directly.'}
                  </p>
                )}
              </div>
            )}
          </div>
        </motion.div>

        {/* Entrance pass — a real, scannable QR ticket for attendees, shown here
            (fresh submit) and to any returning guest whose token is on file. */}
        {isYes && passQrToken && event && (
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            style={{ width: '100%', maxWidth: '380px', marginTop: '26px' }}
          >
            <GuestPassCard
              guestName={passGuestName}
              eventTitle={event.title}
              eventDate={event.event_date}
              eventTimezone={event.timezone}
              eventLocation={event.location_name || event.location_address}
              tableName={guestRsvp?.table_name || null}
              response="yes"
              qrData={typeof window !== 'undefined' ? `${window.location.origin}/ticket/${passQrToken}` : null}
              themeColor={C.maroon}
              isRTL={isRTL}
              removeWatermark={!!event?.tier_remove_watermark}
            />
          </motion.div>
        )}

        {/* Seating map — the guest's own table + companions, once seating is revealed. */}
        {isYes && seatingRevealed && (seatingApi.seatingLoading || seatingApi.seatingView) && (
          <motion.div
            initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            style={{ ...cardOuter, width: '100%', maxWidth: '440px', marginTop: '22px' }}
          >
            <div style={{ ...cardInner, gap: '10px' }}>
              <span style={eyebrowStyle}>{isRTL ? 'طاولتك' : 'Your table'}</span>
              <SeatingResultPanel view={seatingApi.seatingView} loading={seatingApi.seatingLoading} isRTL={isRTL} />
            </div>
          </motion.div>
        )}

        {/* Last on the confirmation screen, after the pass and the seating map —
            the guest's own business with this event is finished by then.
            Constrained to the same 440px column as the cards above so it reads
            as the closing note of this page rather than a full-bleed band.
            Renders nothing for a white-labelled event. */}
        <div style={{ width: '100%', maxWidth: '440px' }}>
          <CreateYourOwnEvent event={event} themeColor={C.maroon} isRTL={isRTL} />
        </div>
      </SectionShell>
    );
  }

  /* ═════════════════════════════════ FORM ═════════════════════════════════ */
  const reveal = { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } };
  const greetingName = (guestRsvp?.guest_name || '').split(' ')[0];

  return (
    <SectionShell background={C.background} style={{ paddingBottom: '120px' }}>
      {/* Glassmorphism card behind the whole form — a single translucent panel,
          matching the reference; the cardOuter/cardInner sub-blocks inside stay
          opaque cream (their own existing style) so nested glass-on-glass never
          hurts legibility of the fields themselves. */}
      <div ref={formPanelRef} style={{
        width: '100%', maxWidth: '540px', display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: 'clamp(20px, 5vw, 36px) clamp(16px, 4vw, 28px)', borderRadius: '28px',
        background: pageIsDark ? 'rgba(0,0,0,0.26)' : 'rgba(255,255,255,0.32)',
        backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
        border: pageIsDark ? '1px solid rgba(255,255,255,0.14)' : '1px solid rgba(255,255,255,0.5)',
        boxShadow: '0 30px 70px -30px rgba(20,12,10,0.25)',
      }}>
        {/* Heading */}
        <motion.span {...reveal} style={{ ...eyebrowStyle, marginBottom: '10px' }}>
          {isRTL ? 'نتشرّف بحضوركم' : 'Kindly Reply'}
        </motion.span>
        <SectionHeading isRTL={isRTL} style={{ marginBottom: '6px' }}>
          {isRTL ? 'الرد على الدعوة' : 'RSVP'}
        </SectionHeading>
        <DiamondDivider />
        <motion.p {...reveal} style={{ fontSize: '14.5px', color: C.ink, opacity: 0.72, textAlign: 'center', maxWidth: '400px', lineHeight: 1.7, margin: '4px 0 26px' }}>
          {greetingName
            ? (isRTL ? `${greetingName}، يسعدنا أن نعرف إن كنت ستشاركنا الاحتفال.` : `${greetingName}, we'd love to know if you'll be celebrating with us.`)
            : (isRTL ? 'يسعدنا أن نعرف إن كنت ستشاركنا الاحتفال.' : "We'd love to know if you'll be celebrating with us.")}
        </motion.p>

        {event?.rsvp_deadline && (() => {
          const status = getRsvpDeadlineStatus(event.rsvp_deadline);
          // Three distinct, unambiguous states instead of always showing the raw
          // date: a plain upcoming deadline, an urgent one (≤3 days left, so a
          // guest who hasn't decided yet knows time is short), and a passed one
          // (previously this pill kept quietly showing a date already in the
          // past, which read as broken rather than as "please respond now").
          const tone = status.passed ? ERR : status.urgent ? C.gold : C.maroon;
          const deadlineText = new Date(event.rsvp_deadline).toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: safeZone(event.timezone) });
          // A full-width, prominent banner, not a small inline pill — the
          // passed/urgent states in particular are the single most
          // time-critical thing a guest can read on this page. Letter-spacing
          // skipped for Arabic (see eyebrowStyle above): applied to English
          // only, since tracking pries Arabic's connected letterforms apart
          // into disjointed, "broken"-looking text.
          return (
            <motion.div {...reveal} style={{
              display: 'flex', alignItems: 'center', gap: '16px', width: '100%',
              margin: '-4px 0 26px', padding: '18px 22px', borderRadius: '18px',
              background: `${tone}14`, border: `2px solid ${tone}66`,
              boxShadow: `0 10px 26px -16px ${alpha(tone, 0.5)}`,
              boxSizing: 'border-box',
            }}>
              <span style={{
                flexShrink: 0, width: '44px', height: '44px', borderRadius: '50%',
                background: `${tone}1E`, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon name={status.passed ? 'warning' : 'clock'} size={22} color={tone} strokeWidth={1.8} />
              </span>
              <span style={{
                fontSize: 'clamp(16px, 4.4vw, 19px)', fontWeight: 800, letterSpacing: isRTL ? 'normal' : '0.01em', color: tone,
                fontFamily: 'var(--font-sans)', lineHeight: 1.5, textAlign: isRTL ? 'right' : 'left',
              }}>
                {status.passed
                  ? (isRTL ? `انتهى الموعد النهائي للرد (${deadlineText}) — يرجى الرد في أقرب وقت` : `RSVP deadline was ${deadlineText} — please respond as soon as possible`)
                  : status.urgent
                    ? (isRTL ? `يرجى الرد بحلول ${deadlineText} — بقي ${daysLeftPhrase(status.daysLeft, isRTL)} فقط` : `Please RSVP by ${deadlineText} — only ${daysLeftPhrase(status.daysLeft, isRTL)} left`)
                    : (isRTL ? `يرجى الرد بحلول ${deadlineText}` : `Please RSVP by ${deadlineText}`)}
              </span>
            </motion.div>
          );
        })()}

        {/* ── The decision: coming or not ── */}
        <div style={{ width: '100%' }}>
          <label style={{ ...labelStyle, textAlign: 'center', opacity: 1, marginBottom: '12px', fontSize: '13px' }}>
            {isRTL ? 'هل ستشرّفنا بحضورك؟' : 'Will you be joining us?'}
          </label>
          <AttendanceChoice value={attending} onSelect={onSelectAttending} C={C} isRTL={isRTL} />
          {errors.attending && (
            <p style={{ ...errorTextStyle, textAlign: 'center', marginTop: '10px' }}>{isRTL ? 'يرجى اختيار إجابة' : 'Please choose an answer'}</p>
          )}
        </div>

        {/* ── Everything below reveals only after a choice is made ── */}
        <AnimatePresence>
          {attending && (
            <motion.div
              ref={detailsRef}
              key="rsvp-details"
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              style={{ width: '100%', overflow: 'hidden' }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', paddingTop: '26px' }}>

                {/* Your details */}
                <motion.div {...reveal} style={cardOuter}>
                  <div style={cardInner}>
                    <span style={eyebrowStyle}>{isRTL ? 'بياناتك' : 'Your details'}</span>
                    <ThemedField label={isRTL ? 'الاسم الكامل' : 'Full name'} required error={errors.guestName} labelColor={C.ink}>
                      <input value={guestName} onChange={(e) => { setGuestName(e.target.value); clearError('guestName'); }} placeholder={isRTL ? 'اسمك' : 'Your name'} style={fieldStyle} onFocus={onFieldFocus} onBlur={(e) => onFieldBlur(e, !!errors.guestName)} />
                    </ThemedField>

                    <ThemedField label={isRTL ? 'البريد الإلكتروني' : 'Email'} required={attending === 'yes'} error={errors.email} labelColor={C.ink}>
                      <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); clearError('email'); setContactRegistered(null); }} placeholder="your@email.com" style={fieldStyle} onFocus={onFieldFocus} onBlur={(e) => onFieldBlur(e, !!errors.email)} />
                    </ThemedField>

                    <div>
                      <label style={labelStyle}>
                        {/* The label follows the rule rather than stating a
                            constant: required for anyone not declining, optional
                            for a decline. A mandatory field labelled optional is
                            the worse error; an optional one marked with a red
                            asterisk is the same error mirrored, and sends a
                            decliner hunting for a number nobody needs. */}
                        {isRTL ? 'رقم الهاتف' : 'Phone number'}
                        {isDeclining
                          ? <span style={{ opacity: 0.5, fontWeight: 500 }}> {isRTL ? '(اختياري)' : '(optional)'}</span>
                          : <span style={{ color: '#C0392B', marginInlineStart: '3px', fontWeight: 700 }} aria-hidden="true">*</span>}
                      </label>
                      <CountryCodePhoneInput value={phone} onChange={(v) => { setPhone(v); clearError('phone'); setContactRegistered(null); }} hasError={!!errors.phone} isRTL={isRTL} />
                      {errors.phone && <span style={errorTextStyle}>{typeof errors.phone === 'string' ? errors.phone : (isRTL ? 'مطلوب' : 'Required')}</span>}
                    </div>

                    {/* Under the two fields it can be about, so the guest reads
                        it beside the value that caused it. */}
                    {contactRegistered && (
                      <ContactRegisteredNotice
                        field={contactRegistered.field}
                        canUpdate={contactRegistered.canUpdate}
                        sent={!!contactRegistered.sent}
                        onConfirm={requestClaimLink}
                        busy={claiming}
                        isRTL={isRTL}
                        accentColor={C.maroon}
                      />
                    )}

                    {/* SMS consent — REQUIRED to submit, unless declining.
                        Rendered for everyone who is not saying no, and NOT gated
                        on having typed a number: a control that blocks
                        submission must be visible when the guest decides
                        whether to fill the field above it.

                        The disclosure notice renders OUTSIDE the <label>, so
                        ticking the box agrees to the SMS sentence and nothing
                        else — Privacy/Terms are linked from the notice, never
                        from the label. See SmsConsentText.js. */}
                    {showSmsConsent && (
                    <div>
                      <label
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer',
                          padding: '12px 14px', borderRadius: '12px',
                          // The whole card turns on error — one unticked box in a
                          // long form is easy to miss when only a small line
                          // beneath it changes colour.
                          background: errors.smsConsent ? '#FBF0F0' : alpha(C.maroon, 0.05),
                          border: `1px solid ${errors.smsConsent ? '#D98A8A' : C.border}`,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={smsConsent}
                          onChange={(e) => {
                            setSmsConsent(e.target.checked);
                            // Clear on comply, so the card stops being red the
                            // moment they tick rather than at the next submit.
                            if (e.target.checked) clearError('smsConsent');
                          }}
                          required
                          aria-invalid={errors.smsConsent ? 'true' : undefined}
                          aria-describedby={errors.smsConsent ? 'ha-sms-consent-error' : undefined}
                          style={{ marginTop: '2px', width: '17px', height: '17px', accentColor: C.maroon, flexShrink: 0 }}
                        />
                        <span style={{ fontSize: '12px', color: C.ink, opacity: 0.85, lineHeight: 1.6, fontFamily: 'var(--font-sans)' }}>
                          <SmsConsentText isRTL={isRTL} />
                          <span style={{ color: '#C0392B', marginInlineStart: '3px', fontWeight: 700 }} aria-hidden="true">*</span>
                        </span>
                      </label>
                      {errors.smsConsent && (
                        <p id="ha-sms-consent-error" role="alert" style={{
                          margin: '6px 0 0', padding: '0 2px',
                          fontFamily: 'var(--font-sans)', fontSize: '12px', color: '#B23B3B',
                        }}>
                          {errors.smsConsent}
                        </p>
                      )}
                      <SmsConsentIndependence isRTL={isRTL} linkStyle={{ color: C.maroon }} style={{ margin: '8px 0 0', padding: '0 2px' }} />
                    </div>
                    )}
                  </div>
                </motion.div>

                {/* Always-show custom questions (asked of the primary guest for any response). */}
                {alwaysQuestions.length > 0 && (
                  <motion.div {...reveal} style={cardOuter}>
                    <div style={cardInner}>
                      <span style={eyebrowStyle}>{isRTL ? 'تفاصيل إضافية' : 'A few more details'}</span>
                      {alwaysQuestions.map((field) => (
                        <ThemedField key={field.id} label={field.field_label} required={field.is_required} error={errors[`field_${field.id}`] ? (isRTL ? 'مطلوب' : 'Required') : null} labelColor={C.ink}>
                          {primaryControl(field)}
                        </ThemedField>
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* ── Attending-only details ── */}
                <AnimatePresence>
                  {attending === 'yes' && (
                    <motion.div
                      key="attending-details"
                      initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.4 }} style={{ overflow: 'hidden' }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                        {/* Primary guest's allergies — right under their own details,
                            ahead of meal/party/companions, instead of tacked on at
                            the end of the whole attending block. Organizer-gated
                            (EventSettings "collect_dietary_restrictions"). */}
                        {collectDietary && (
                          <div style={cardOuter}>
                            <div style={cardInner}>
                              <span style={eyebrowStyle}>⚠ {isRTL ? 'الحساسية وقيود الطعام' : 'Food allergies & intolerances'}</span>
                              <p style={{ fontSize: '12px', color: C.ink, opacity: 0.65, margin: 0, lineHeight: 1.5 }}>
                                {isRTL ? 'من المهم معرفة أي قيود غذائية — اختر ما ينطبق:' : 'It helps us to know any dietary restrictions. Select all that apply:'}
                              </p>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                {ALLERGY_OPTIONS.map((opt) => (
                                  <button type="button" key={opt} aria-pressed={allergies.includes(opt)} onClick={() => toggleAllergy(opt)} style={pillStyle(allergies.includes(opt), { size: 'sm' })}>
                                    {allergies.includes(opt) ? '✓ ' : ''}{opt}
                                  </button>
                                ))}
                              </div>
                              <input placeholder={isRTL ? 'حساسية أخرى أو قيود' : 'Other allergies or restrictions'} value={otherAllergy} onChange={(e) => setOtherAllergy(e.target.value)} style={fieldStyle} onFocus={onFieldFocus} onBlur={onFieldBlur} />
                            </div>
                          </div>
                        )}

                        {/* Meal */}
                        {mealOptions && mealOptions.length > 0 && (
                          <div style={{ padding: '18px', borderRadius: '18px', border: `1px solid ${errors.meal ? ERR : alpha(C.maroon, 0.28)}`, background: alpha(C.maroon, 0.05) }}>
                            <label style={{ ...labelStyle, opacity: 1, marginBottom: 0 }}>🍽 {isRTL ? 'اختر وجبتك' : 'Choose your meal'}{mealField?.is_required && <span style={{ color: ERR }}> *</span>}</label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '12px' }}>
                              {mealOptions.map((opt) => (
                                <button type="button" key={opt} aria-pressed={meal === opt} onClick={() => { setMeal(opt); clearError('meal'); }} style={pillStyle(meal === opt)}>{opt}</button>
                              ))}
                            </div>
                            {errors.meal && <span style={errorTextStyle}>{isRTL ? 'يرجى اختيار وجبة' : 'Please select a meal'}</span>}
                          </div>
                        )}

                        {/* Which side — organizer-gated (EventSettings "Track which
                            side each guest is on"), same feature/wording as the
                            standalone RSVP wizard, just previously missing here.
                            A distinct split card (not another pill row) so it
                            reads as its own moment: two named halves meeting at
                            a rings monogram, the selected half filling with the
                            theme's own gold→maroon gradient. */}
                        {event?.track_guest_side && (
                          <div style={cardOuter}>
                            <div style={{ ...cardInner, paddingTop: '18px', paddingBottom: '18px' }}>
                              <span style={eyebrowStyle}>
                                {isRTL ? 'مع مين هتحتفل؟' : "Whose Side Are You On?"}
                              </span>
                              <div style={{ position: 'relative', display: 'flex', alignItems: 'stretch', gap: '3px', marginTop: '14px' }}>
                                {[
                                  { key: 'partner1', label: side1Label, initial: side1Initial },
                                  { key: 'partner2', label: side2Label, initial: side2Initial },
                                ].map((opt) => {
                                  const selected = side === opt.key;
                                  return (
                                    <motion.button
                                      key={opt.key} type="button" aria-pressed={selected}
                                      onClick={() => setSide(opt.key)}
                                      whileTap={{ scale: 0.97 }}
                                      animate={{ scale: selected ? 1.015 : 1 }}
                                      transition={{ type: 'spring', stiffness: 400, damping: 26 }}
                                      style={{
                                        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '9px',
                                        padding: '20px 10px', borderRadius: '15px', cursor: 'pointer', border: 'none',
                                        background: selected ? `linear-gradient(155deg, ${C.gold}, ${C.maroon})` : alpha(C.maroon, 0.05),
                                        boxShadow: selected ? `0 12px 26px -12px ${alpha(C.maroon, 0.6)}` : 'none',
                                        transition: 'background 0.35s ease, box-shadow 0.35s ease',
                                      }}
                                    >
                                      <span aria-hidden style={{
                                        width: '40px', height: '40px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        background: selected ? 'rgba(255,255,255,0.2)' : alpha(C.maroon, 0.12),
                                        color: selected ? '#fff' : C.maroon, fontFamily: 'var(--font-serif)', fontWeight: 700, fontSize: '17px',
                                        border: selected ? '1px solid rgba(255,255,255,0.45)' : `1px solid ${alpha(C.maroon, 0.2)}`,
                                        transition: 'background 0.35s ease, color 0.35s ease, border-color 0.35s ease',
                                      }}>{opt.initial}</span>
                                      <span style={{ fontSize: '13px', fontWeight: 700, color: selected ? '#fff' : C.ink, textAlign: 'center', lineHeight: 1.3 }}>
                                        {opt.label}
                                      </span>
                                    </motion.button>
                                  );
                                })}
                                <span aria-hidden style={{
                                  position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
                                  width: '30px', height: '30px', borderRadius: '50%', background: C.background,
                                  border: `1.5px solid ${alpha(C.gold, 0.5)}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  boxShadow: `0 2px 10px ${alpha(C.maroon, 0.18)}`, zIndex: 2,
                                }}>
                                  <Icon name="rings" size={14} color={C.gold} strokeWidth={1.8} />
                                </span>
                              </div>
                            </div>
                          </div>
                        )}

                        <PartyStepper value={partySize} onChange={handlePartySizeChange} label={isRTL ? 'عدد الضيوف (بما فيهم أنت)' : 'Number of guests (including you)'} isRTL={isRTL} C={C} />

                        {/* Directly under the stepper, because this is the
                            control the rule constrains — "Number of guests
                            (including you)" with the notice only somewhere
                            further up the invitation page reads as an open
                            invitation to count the children. Mirrored in
                            StepPartyDetails for the other RSVP path. */}
                        {!!event?.no_kids_allowed && (
                          <AdultsOnlyNotice isRTL={isRTL} themeColor={C.gold} />
                        )}

                        {/* Companions — one name each, in ONE card rather than a
                            card per person. Each used to get a full block (email,
                            phone, meal pills, per-guest questions, its own
                            allergies rectangle); with a single field left, that
                            shape turned a party of four into four near-empty
                            panels. A numbered list reads as what it is: who else
                            is coming, so the host can seat them. */}
                        {partySize > 1 && (
                          <div style={cardOuter}>
                            <div style={cardInner}>
                              <span style={eyebrowStyle}>
                                {isRTL ? 'مين جاي معاك' : "Who's coming with you"}
                              </span>
                              <p style={{ ...labelStyle, opacity: 0.75, margin: 0 }}>
                                {isRTL
                                  ? 'الأسماء بس — دعوتك وباج الدخول بيغطّوا المجموعة كلها.'
                                  : 'Names only — your invitation and entry pass cover the whole group.'}
                              </p>
                              {Array.from({ length: Math.max(0, partySize - 1) }).map((_, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <span aria-hidden style={{ width: '26px', height: '26px', flexShrink: 0, borderRadius: '50%', background: alpha(C.maroon, 0.12), color: C.maroon, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800 }}>{i + 2}</span>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <ThemedField error={errors[`companion_${i}_fullName`] ? (isRTL ? 'مطلوب' : 'Required') : null} labelColor={C.ink}>
                                      <input
                                        placeholder={isRTL ? `الاسم الكامل للضيف ${i + 2}` : `Guest ${i + 2} full name`}
                                        aria-label={isRTL ? `الاسم الكامل للضيف ${i + 2}` : `Guest ${i + 2} full name`}
                                        value={additionalGuests[i]?.fullName || ''}
                                        onChange={(e) => { updateAdditionalGuest(i, { fullName: e.target.value }); clearError(`companion_${i}_fullName`); }}
                                        style={errors[`companion_${i}_fullName`] ? { ...fieldStyle, borderColor: ERR } : fieldStyle}
                                        onFocus={onFieldFocus}
                                        onBlur={(e) => onFieldBlur(e, !!errors[`companion_${i}_fullName`])}
                                      />
                                    </ThemedField>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {partySize > 1 && mealOptions && mealOptions.length > 0 && (
                          <div style={cardOuter}>
                            <div style={cardInner}>
                              <CompanionMealCounter
                                options={mealOptions}
                                counts={companionMealCounts}
                                onChange={setCompanionMealCount}
                                companionCount={partySize - 1}
                                required={!!mealField?.is_required}
                                invalid={!!errors.companionMealCounts}
                                isRTL={isRTL}
                                accentColor={C.maroon}
                              />
                            </div>
                          </div>
                        )}

                        {/* Attending-only custom questions */}
                        {attendingQuestions.length > 0 && (
                          <div style={cardOuter}>
                            <div style={cardInner}>
                              <span style={eyebrowStyle}>{isRTL ? 'تفاصيل الحضور' : 'A few details for your visit'}</span>
                              {attendingQuestions.map((field) => (
                                <ThemedField key={field.id} label={field.field_label} required={field.is_required} error={errors[`field_${field.id}`] ? (isRTL ? 'مطلوب' : 'Required') : null} labelColor={C.ink}>
                                  {primaryControl(field)}
                                </ThemedField>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Message — for every response */}
                <ThemedField label={isRTL ? 'رسالة للعروسين (اختياري)' : 'Message for the couple (optional)'} labelColor={C.ink}>
                  <textarea rows={3} placeholder={isRTL ? 'اكتب لنا بضع كلمات...' : 'Write us a few words...'} value={message} onChange={(e) => setMessage(e.target.value)} style={{ ...fieldStyle, resize: 'vertical' }} onFocus={onFieldFocus} onBlur={onFieldBlur} />
                </ThemedField>

                {turnstileEnabled && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                    <TurnstileWidget
                      ref={turnstileRef}
                      onVerify={(token) => { setCaptchaToken(token); setCaptchaLoadError(false); clearError('captcha'); }}
                      onExpire={() => setCaptchaToken(null)}
                      onError={() => { setCaptchaToken(null); setCaptchaLoadError(true); }}
                    />
                    {errors.captcha && (
                      <span style={{ ...errorTextStyle, textAlign: 'center' }}>
                        {captchaLoadError
                          ? (isRTL ? 'تعذّر تحميل التحقق الأمني. حاول تعطيل مانع الإعلانات أو تغيير الشبكة ثم أعد تحميل الصفحة.' : "The security check couldn't load — try disabling an ad-blocker or switching networks, then reload the page.")
                          : (isRTL ? 'يرجى إكمال التحقق الأمني.' : 'Please complete the security check.')}
                      </span>
                    )}
                  </div>
                )}

                {Object.keys(errors).length > 0 && (
                  <p style={{ fontSize: '12px', color: ERR, margin: 0, textAlign: 'center', fontWeight: 600 }}>
                    {isRTL ? 'يرجى مراجعة الحقول المطلوبة بالأعلى.' : 'Please review the highlighted fields above.'}
                  </p>
                )}

                {/* Data-privacy reassurance, right before the final submit — same
                    placement/reasoning as the wizard flow's own note. */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '12px 14px', borderRadius: '12px',
                  background: C.cream, border: `1px solid ${C.border}`,
                }}>
                  <LockIcon size={16} strokeWidth={1.6} color={C.maroon} />
                  <span style={{ fontSize: '11.5px', color: C.ink, opacity: 0.75, lineHeight: 1.5, fontFamily: 'var(--font-sans)' }}>
                    {isRTL ? 'بياناتك محفوظة بسرية وأمان تام، ولا تُشارَك إلا مع المضيف.' : 'Your information is kept private and secure, and is only ever shared with your host.'}
                  </span>
                </div>

                <motion.button
                  type="button" onClick={() => handleSubmit()} disabled={submitting}
                  whileHover={submitting ? undefined : { y: -2 }} whileTap={submitting ? undefined : { scale: 0.99 }}
                  style={{
                    width: '100%', padding: '16px', borderRadius: '14px', border: 'none',
                    background: submitting ? alpha(C.solidFill, 0.55) : `linear-gradient(150deg, ${C.solidFill}, ${C.solidFillDeep})`,
                    color: '#FFFCF6', fontWeight: 700, fontSize: '15px', letterSpacing: isRTL ? 'normal' : '0.03em',
                    cursor: submitting ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-sans)',
                    boxShadow: submitting ? 'none' : `0 16px 34px -16px ${alpha(C.solidFill, 0.7)}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                  }}
                >
                  {submitting && (
                    <motion.span aria-hidden animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.7, ease: 'linear' }}
                      style={{ width: '16px', height: '16px', border: '2px solid rgba(255,252,246,0.4)', borderTopColor: '#FFFCF6', borderRadius: '50%' }} />
                  )}
                  {submitting
                    ? (isRTL ? 'جارٍ الإرسال...' : 'Sending...')
                    : attending === 'no' ? (isRTL ? 'إرسال الاعتذار' : 'Send my reply') : (isRTL ? 'تأكيد الحضور' : 'Send RSVP')}
                </motion.button>

                {/* Preview only. The form validated and stopped — without
                    saying so, a submit that visibly does nothing reads as a
                    broken button, which is the opposite of the reassurance
                    this screen exists to give. */}
                <AnimatePresence>
                  {previewNotice && (
                    <motion.p
                      role="status"
                      initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      style={{
                        margin: '12px 0 0', padding: '12px 14px', borderRadius: '12px',
                        background: alpha(C.gold, 0.12), border: `1px dashed ${C.gold}`,
                        color: C.ink, fontSize: '12.5px', lineHeight: 1.6, textAlign: 'center',
                        fontFamily: 'var(--font-sans)',
                      }}
                    >
                      {isRTL
                        ? 'هذه معاينة — الاستمارة تعمل كما سيراها ضيوفك، لكن لا يُسجَّل أي ردّ من هنا.'
                        : "This is a preview — the form works exactly as your guests will see it, but nothing is recorded from here."}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <style jsx>{`
        /* Stop iOS Safari from zooming in whenever a sub-16px field gains focus —
           the single biggest mobile RSVP annoyance. Scoped to this section via the
           SnapShell's #ha-rsvp wrapper so it can't leak to other sections. */
        @media (max-width: 639.98px) {
          :global(#ha-rsvp input),
          :global(#ha-rsvp select),
          :global(#ha-rsvp textarea) { font-size: 16px !important; }
        }
        /* The yes/no choice used to stack via an off-scale 460px query, with
           a second 360px tier tightening the buttons. Both are gone: the
           grid is now .fx-grid with a 190px column floor, so two cards need
           2x190+12 = 392px and it goes one-up on its own somewhere just
           under a 430px viewport — the same place the 460px rule was aiming
           for — with no breakpoint to keep in sync. min(190px, 100%) also
           means it can never overflow, which the old "1fr 1fr" could once
           the button labels grew. */
        @media (max-width: 639.98px) {
          :global(.ha-attend-grid) button { min-height: 92px !important; padding: 15px !important; }
        }
      `}</style>
    </SectionShell>
  );
}
