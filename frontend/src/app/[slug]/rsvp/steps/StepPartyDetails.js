'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FadeInUp, StaggerChildren, StaggerItem } from '../../../components/guest/GuestAnimations';
import { PremiumButton, PartySizeStepper, FormField, inputFocus, inputBlur } from '../../../components/guest/GuestUI';
import { S } from '../styles';
import { RsvpSectionHeading, RsvpDivider } from '../components';
import { darken } from '../../../utils/color';
import { TITLE_OPTIONS, splitName, joinName } from '../../../utils/nameFields';
import CountryCodePhoneInput from '../../../components/CountryCodePhoneInput';
import SmsConsentText, { SmsConsentIndependence } from '../../../components/guest/SmsConsentText';
import ContactRegisteredNotice from '../../../components/guest/rsvp/ContactRegisteredNotice';
import AdultsOnlyNotice from '../../../components/guest/AdultsOnlyNotice';
import CompanionMealCounter from '../../../components/guest/rsvp/CompanionMealCounter';
import { BoltIcon, CalendarIcon, PlaneIcon, ClipboardIcon, HeartPulseIcon, DotsIcon, ClockIcon, EnvelopeIcon, PeopleIcon } from '../../../components/guest/RsvpIcons';

const MAYBE_OPTIONS = [
  { value: '24 Hours', Icon: BoltIcon, labelEn: 'Within 24 Hours', labelAr: 'خلال ٢٤ ساعة', subEn: "I'll know very soon", subAr: 'سأعلمكم قريباً جداً' },
  { value: '3 Days', Icon: CalendarIcon, labelEn: 'Within 3 Days', labelAr: 'خلال ٣ أيام', subEn: 'I need a short while to confirm', subAr: 'أحتاج وقت قصير للتأكد' },
  { value: '1 Week', Icon: CalendarIcon, labelEn: 'Within 1 Week', labelAr: 'خلال أسبوع', subEn: "I'm working out some details", subAr: 'أنتظر ترتيب بعض الأمور' },
];

const DECLINE_REASONS = [
  { value: 'Travel', Icon: PlaneIcon, labelEn: 'Travel Commitment', labelAr: 'ارتباط بسفر' },
  { value: 'Schedule Conflict', Icon: ClipboardIcon, labelEn: 'Schedule Conflict', labelAr: 'تعارض في الجدول' },
  { value: 'Health', Icon: HeartPulseIcon, labelEn: 'Health Reasons', labelAr: 'أسباب صحية' },
  { value: 'Other', Icon: DotsIcon, labelEn: 'Other Reasons', labelAr: 'أسباب أخرى' },
];

/** Step 3 (attending=yes: party details) / 3B (maybe: follow-up) / 3C (no: decline reason). */
export default function StepPartyDetails({
  t, isRTL, attending,
  partySize, setPartySize, mealField, primaryMeal, setPrimaryMeal,
  dietaryNotes, setDietaryNotes,
  additionalGuests, setAdditionalGuests, email, setEmail, phone, setPhone,
  validationErrors, setValidationErrors, onBack, onContinue,
  maybeFollowUp, setMaybeFollowUp, declineReason, setDeclineReason,
  guestName, setGuestName,
  side, setSide, showSidePicker, isWedding, showDietary = true,
  contactRegistered, onConfirmContactUpdate, confirmingContact = false,
  companionMealCounts = {}, setCompanionMealCount,
  smsConsent, setSmsConsent,
  // The organizer's adults-only toggle (events.no_kids_allowed), threaded from
  // RsvpWizard's `event`. Off by default, exactly as the column is.
  noKidsAllowed = false,
  themeColor = '#B8944F', secondaryColor = '#D7BE80',
}) {
  // NOTE: organizer-authored meal options have no Arabic-translation mechanism
  // today (custom_form_fields has no options_ar column) — always show the
  // options exactly as the organizer typed them, regardless of guest language.
  const mealOptions = mealField?.options;

  const isAttending = attending === 'yes';

  /**
   * A DECLINE IS EXEMPT from the number and the consent box.
   *
   * Not a display nicety — it mirrors the validator in RsvpWizard exactly, and
   * the two disagreeing is how a form ends up rejecting a submission for a
   * field it never showed. The rationale (a decliner receives no table, no pass
   * and no transactional message at all, so the disclosure under the checkbox
   * would not apply to them) lives with the validator.
   *
   * `showSmsConsent` used to mean "has typed a number". It means "is not saying
   * no" now, which is a different question with a different answer.
   */
  const isDeclining = attending === 'no';
  const showSmsConsent = !isDeclining;

  const renderHostDetailsCard = (includeMeal = false) => {
    return (
      <FadeInUp delay={0.18} y={15}>
        <div style={{
          position: 'relative',
          padding: '1.5px',
          borderRadius: '18px',
          background: `linear-gradient(135deg, ${secondaryColor} 0%, ${themeColor} 50%, ${secondaryColor} 100%)`,
          boxShadow: `0 18px 40px -16px ${themeColor}52`,
        }}>
          <div style={{
            background: 'linear-gradient(180deg, #FFFCF6 0%, #F8F4EC 100%)',
            borderRadius: '16.5px', padding: '20px',
            display: 'flex', flexDirection: 'column', gap: '14px',
          }}>
            {/* Badge ribbon */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span aria-hidden style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: '36px', height: '36px', borderRadius: '50%',
                  background: `linear-gradient(135deg, ${secondaryColor}, ${themeColor})`,
                  color: '#FFFFFF', fontSize: '18px', flexShrink: 0,
                  boxShadow: `0 6px 14px ${themeColor}73`,
                }}>♛</span>
                <div>
                  <span style={{ ...S.eyebrow, color: darken(themeColor, 0.15), display: 'block' }}>{t.host_badge}</span>
                  <strong style={{
                    fontSize: '17px', color: '#191B1E', display: 'block',
                    fontFamily: 'var(--font-serif)', fontWeight: 600, lineHeight: 1.2,
                  }}>{guestName || (isRTL ? 'صاحب الدعوة' : 'Invitee')}</strong>
                </div>
              </div>
              <span style={{
                fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '999px',
                background: `${themeColor}24`, color: darken(themeColor, 0.15), whiteSpace: 'nowrap',
                fontFamily: 'var(--font-sans)',
              }}>{t.host_section_title}</span>
            </div>

            <p style={{ fontSize: '12px', color: '#77736A', margin: 0, lineHeight: 1.6 }}>
              {t.host_subtitle}
            </p>

            {(() => {
              const { title: hTitle, first: hFirst, last: hLast } = splitName(guestName);
              const setHostName = (newTitle, newFirst, newLast) => {
                setGuestName(joinName(newTitle, newFirst, newLast));
                if (validationErrors.guestNameTitle || validationErrors.guestNameFirst || validationErrors.guestNameLast) {
                  setValidationErrors(prev => {
                    const n = { ...prev };
                    delete n.guestNameTitle; delete n.guestNameFirst; delete n.guestNameLast;
                    return n;
                  });
                }
              };
              return (
                <div className="name-title-row" style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gap: '10px' }}>
                  <FormField label={isRTL ? 'اللقب' : 'Title'} error={validationErrors.guestNameTitle}>
                    <select
                      value={hTitle.replace('.', '')}
                      onChange={e => setHostName(e.target.value ? e.target.value + '.' : '', hFirst, hLast)}
                      style={{ ...S.inputBase, cursor: 'pointer', padding: '14px 8px', ...(validationErrors.guestNameTitle ? { borderColor: '#ef4444' } : {}) }}
                      onFocus={e => inputFocus(e)} onBlur={e => inputBlur(e, !!validationErrors.guestNameTitle)}
                    >
                      <option value="">-</option>
                      {TITLE_OPTIONS.map(tt => <option key={tt} value={tt}>{tt === 'Child' ? 'Child' : tt + '.'}</option>)}
                    </select>
                  </FormField>
                  <FormField label={isRTL ? 'الاسم الأول' : 'First Name'} error={validationErrors.guestNameFirst}>
                    <input
                      type="text" value={hFirst}
                      onChange={e => setHostName(hTitle, e.target.value, hLast)}
                      placeholder={isRTL ? 'الاسم الأول' : 'First Name'}
                      style={{ ...S.inputBase, ...(validationErrors.guestNameFirst ? { borderColor: '#ef4444' } : {}) }}
                      onFocus={e => inputFocus(e)} onBlur={e => inputBlur(e, !!validationErrors.guestNameFirst)}
                    />
                  </FormField>
                  <FormField label={isRTL ? 'اسم العائلة' : 'Last Name'} error={validationErrors.guestNameLast}>
                    <input
                      type="text" value={hLast}
                      onChange={e => setHostName(hTitle, hFirst, e.target.value)}
                      placeholder={isRTL ? 'اسم العائلة' : 'Family Name'}
                      style={{ ...S.inputBase, ...(validationErrors.guestNameLast ? { borderColor: '#ef4444' } : {}) }}
                      onFocus={e => inputFocus(e)} onBlur={e => inputBlur(e, !!validationErrors.guestNameLast)}
                    />
                  </FormField>
                </div>
              );
            })()}

            <div className="email-phone-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <FormField label={isAttending ? t.email_label : `${t.email_label}${isRTL ? ' (اختياري)' : ' (optional)'}`} error={validationErrors.email}>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@email.com"
                  style={{ ...S.inputBase, ...(validationErrors.email ? { borderColor: '#ef4444' } : {}) }}
                  onFocus={e => inputFocus(e)} onBlur={e => inputBlur(e, !!validationErrors.email)} />
              </FormField>
              {/* The label follows the RULE, it does not state a constant.
                  Required for anyone not declining; optional for a decline. The
                  one thing worse than a mandatory phone field is a mandatory one
                  labelled optional — and the mirror image, an optional field
                  marked with a red asterisk, sends a decliner hunting for a
                  number they do not need to give. */}
              <FormField
                label={isDeclining
                  ? `${t.phone_label}${isRTL ? ' (اختياري)' : ' (optional)'}`
                  : `${t.phone_label} *`}
                error={validationErrors.phone}
              >
                <CountryCodePhoneInput value={phone} onChange={setPhone} hasError={!!validationErrors.phone} isRTL={isRTL} />
              </FormField>
            </div>

            {/* Sits directly under the two fields it can be about, so the guest
                reads it next to the value that caused it rather than as a toast
                somewhere else on a long single-page form. */}
            {contactRegistered && (
              <ContactRegisteredNotice
                field={contactRegistered.field}
                canUpdate={contactRegistered.canUpdate}
                sent={!!contactRegistered.sent}
                onConfirm={onConfirmContactUpdate}
                busy={confirmingContact}
                isRTL={isRTL}
                accentColor={themeColor}
              />
            )}

            {/* SMS opt-in consent — REQUIRED to submit, unless declining.

                Rendered for everyone who is not saying no, and NOT gated on
                having typed a number. It used to appear only once a guest
                volunteered one, which was right while both were optional; with
                both required, hiding it until the phone field is filled would
                produce a form that grows a new mandatory control after you start
                typing, and whose blocking requirement is invisible at the moment
                you decide whether to fill it in.

                A decline sees neither this nor a required number — see
                `isDeclining` above.

                The disclosure notice sits OUTSIDE the <label> so that ticking
                the box agrees to the SMS sentence and nothing else. See
                SmsConsentText.js for the full rationale and the Twilio re-filing
                this requires. */}
            {showSmsConsent && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: '10px',
                padding: '12px 14px', borderRadius: '12px',
                // The error state recolours the whole card, not just a message
                // below it. A single unticked checkbox in a long form is very
                // easy to miss when only a 12px line under it turns red.
                background: validationErrors?.smsConsent ? '#FBF0F0' : `${themeColor}0D`,
                border: `1px solid ${validationErrors?.smsConsent ? '#D98A8A' : `${themeColor}40`}`,
                transition: 'all 0.2s ease',
              }}>
                <input
                  type="checkbox"
                  id="sms-consent-checkbox"
                  checked={smsConsent}
                  onChange={e => {
                    setSmsConsent(e.target.checked);
                    // Clear the error the moment they comply, rather than
                    // leaving a red card until the next submit attempt.
                    if (e.target.checked && setValidationErrors) {
                      setValidationErrors(prev => { const n = { ...prev }; delete n.smsConsent; return n; });
                    }
                  }}
                  // required + aria-invalid so the browser and a screen reader
                  // both know this blocks submission. The visible asterisk below
                  // is for everyone else.
                  required
                  aria-invalid={validationErrors?.smsConsent ? 'true' : undefined}
                  aria-describedby={validationErrors?.smsConsent ? 'sms-consent-error' : undefined}
                  style={{ marginTop: '3px', width: '16px', height: '16px', accentColor: themeColor, cursor: 'pointer', flexShrink: 0 }}
                />
                <label htmlFor="sms-consent-checkbox" style={{ fontSize: '12px', color: '#5E5A52', lineHeight: 1.6, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
                  <SmsConsentText isRTL={isRTL} />
                  <span style={{ color: '#C0392B', marginInlineStart: '3px', fontWeight: 700 }} aria-hidden="true">*</span>
                </label>
              </div>
              {validationErrors?.smsConsent && (
                <p id="sms-consent-error" role="alert" style={{
                  margin: '2px 0 0', padding: '0 2px',
                  fontFamily: 'var(--font-sans)', fontSize: '12px', color: '#B23B3B',
                }}>
                  {validationErrors.smsConsent}
                </p>
              )}
              <SmsConsentIndependence isRTL={isRTL} linkStyle={{ color: themeColor }} style={{ margin: '2px 0 0', padding: '0 2px' }} />
            </div>
            )}

            {showSidePicker && (
              <FormField label={isWedding ? (isRTL ? 'جانب الاحتفال' : "Which side are you celebrating with?") : (isRTL ? 'الجانب' : "Which partner's side?")}>
                <select value={side} onChange={e => setSide(e.target.value)} style={{ ...S.inputBase, cursor: 'pointer' }}
                  onFocus={e => inputFocus(e)} onBlur={e => inputBlur(e)}>
                  <option value="">{isRTL ? 'غير محدد' : 'Not sure / prefer not to say'}</option>
                  <option value="partner1">{isWedding ? (isRTL ? 'جانب العريس' : "Groom's Side") : (isRTL ? 'جانب الشريك الأول' : "Partner 1's Side")}</option>
                  <option value="partner2">{isWedding ? (isRTL ? 'جانب العروس' : "Bride's Side") : (isRTL ? 'جانب الشريك الثاني' : "Partner 2's Side")}</option>
                </select>
              </FormField>
            )}

            {includeMeal && mealField && (
              <FormField label={mealField.field_label.replace('{name}', '').replace(/\s{2,}/g, ' ').trim()} error={validationErrors.primaryMeal}>
                <select value={primaryMeal} onChange={e => {
                  setPrimaryMeal(e.target.value);
                  if (validationErrors.primaryMeal) {
                    setValidationErrors(prev => { const n = { ...prev }; delete n.primaryMeal; return n; });
                  }
                }} style={{ ...S.inputBase, cursor: 'pointer', ...(validationErrors.primaryMeal ? { borderColor: '#ef4444' } : {}) }}
                  onFocus={e => inputFocus(e)} onBlur={e => inputBlur(e, !!validationErrors.primaryMeal)}>
                  <option value="">{t.meal_select_placeholder}</option>
                  {mealOptions?.map((opt, i) => (<option key={i} value={opt}>{opt}</option>))}
                </select>
              </FormField>
            )}

            {includeMeal && showDietary && (
              <FormField label={isRTL ? 'متطلبات غذائية أو حساسية (اختياري)' : 'Dietary Restrictions & Allergies (Optional)'}>
                <input
                  type="text" value={dietaryNotes} onChange={e => setDietaryNotes(e.target.value)}
                  placeholder={isRTL ? 'مثال: نباتي، حساسية من المكسرات...' : 'e.g. Vegetarian, Peanut allergy...'}
                  style={S.inputBase}
                  onFocus={e => inputFocus(e)} onBlur={e => inputBlur(e)}
                />
              </FormField>
            )}
          </div>

          <style jsx>{`
            @media (max-width: 640px) {
              .name-title-row {
                grid-template-columns: 1fr !important;
              }
              .email-phone-row {
                grid-template-columns: 1fr !important;
              }
            }
          `}</style>
        </div>
      </FadeInUp>
    );
  };

  /* ─── attending = maybe ─── */
  if (attending === 'maybe') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <FadeInUp y={15}>
          <div style={{ textAlign: 'center' }}>
            <motion.span animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 1.5, repeat: Infinity }} style={{
              width: '64px', height: '64px', borderRadius: '50%', margin: '0 auto 12px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(99,102,241,0.1)', color: '#6366f1',
            }}>
              <ClockIcon size={30} strokeWidth={1.5} />
            </motion.span>
            <RsvpSectionHeading kicker={isRTL ? 'المتابعة' : 'FOLLOW-UP'} themeColor={themeColor} isRTL={isRTL} align="center">
              {isRTL ? 'متى يمكننا توقع تأكيدك؟' : 'When can we expect your confirmation?'}
            </RsvpSectionHeading>
            <p style={{ fontSize: '13px', color: '#77736A', marginTop: '10px' }}>
              {isRTL ? 'حتى نتمكن من المتابعة معك' : "So we can follow up with you at the right time"}
            </p>
          </div>
        </FadeInUp>

        <StaggerChildren staggerDelay={0.1}>
          {MAYBE_OPTIONS.map(opt => (
            <StaggerItem key={opt.value}>
              <motion.button
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setMaybeFollowUp(opt.value)}
                animate={maybeFollowUp === opt.value ? { borderColor: '#6366f1', boxShadow: '0 0 25px rgba(99,102,241,0.15)' } : { borderColor: '#E8E2D6', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}
                transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                style={{
                  width: '100%', padding: '20px',
                  border: `2px solid ${maybeFollowUp === opt.value ? '#6366f1' : '#E8E2D6'}`,
                  borderRadius: '14px', cursor: 'pointer',
                  background: maybeFollowUp === opt.value ? 'linear-gradient(135deg, rgba(99,102,241,0.06), rgba(99,102,241,0.02))' : '#FFFFFF',
                  fontFamily: 'var(--font-sans)', display: 'flex', alignItems: 'center', gap: '16px',
                  textAlign: isRTL ? 'right' : 'left',
                }}
              >
                <span style={{
                  width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: maybeFollowUp === opt.value ? 'rgba(99,102,241,0.12)' : '#F5F3EF',
                  color: maybeFollowUp === opt.value ? '#6366f1' : '#8A8578',
                }}>
                  <opt.Icon size={20} />
                </span>
                <div>
                  <span style={{ fontWeight: 700, fontSize: '14px', display: 'block', color: maybeFollowUp === opt.value ? '#6366f1' : '#191B1E' }}>
                    {isRTL ? opt.labelAr : opt.labelEn}
                  </span>
                  <span style={{ fontSize: '12px', color: '#77736A', marginTop: '2px', display: 'block' }}>
                    {isRTL ? opt.subAr : opt.subEn}
                  </span>
                </div>
                {maybeFollowUp === opt.value && (
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                    style={{ marginLeft: 'auto', width: '24px', height: '24px', borderRadius: '50%', background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  </motion.div>
                )}
              </motion.button>
            </StaggerItem>
          ))}
        </StaggerChildren>

        {maybeFollowUp && renderHostDetailsCard(false)}

        {(onBack || onContinue) && (
          <>
            <RsvpDivider themeColor={themeColor} />
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '4px' }}>
              {onBack && <button onClick={onBack} style={S.backBtn}>{isRTL ? 'رجوع' : 'Back'}</button>}
              {onContinue && <PremiumButton disabled={!maybeFollowUp} onClick={onContinue} accentColor={themeColor}>{t.continue}</PremiumButton>}
            </div>
          </>
        )}
      </div>
    );
  }

  /* ─── attending = no ─── */
  if (attending === 'no') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <FadeInUp y={15}>
          <div style={{ textAlign: 'center' }}>
            <motion.span initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.2 }} style={{
              width: '64px', height: '64px', borderRadius: '50%', margin: '0 auto 12px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(239,68,68,0.08)', color: '#ef4444',
            }}>
              <EnvelopeIcon size={30} strokeWidth={1.5} />
            </motion.span>
            <RsvpSectionHeading kicker={isRTL ? 'ردّكم' : 'YOUR RESPONSE'} themeColor={themeColor} isRTL={isRTL} align="center">
              {isRTL ? 'نتفهم ذلك ونتمنى لك كل الخير' : 'We understand and wish you well'}
            </RsvpSectionHeading>
            <p style={{ fontSize: '13px', color: '#77736A', marginTop: '10px', lineHeight: 1.6 }}>
              {isRTL ? 'لو تكرمت بإخبارنا بالسبب (اختياري)' : 'Would you mind sharing the reason? (optional)'}
            </p>
          </div>
        </FadeInUp>

        <StaggerChildren staggerDelay={0.08}>
          {DECLINE_REASONS.map(reason => (
            <StaggerItem key={reason.value}>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setDeclineReason(reason.value)}
                animate={declineReason === reason.value ? { borderColor: '#ef4444', boxShadow: '0 0 20px rgba(239,68,68,0.1)' } : { borderColor: '#E8E2D6', boxShadow: 'none' }}
                transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                style={{
                  width: '100%', padding: '16px 20px',
                  border: `2px solid ${declineReason === reason.value ? '#ef4444' : '#E8E2D6'}`,
                  borderRadius: '14px', cursor: 'pointer',
                  background: declineReason === reason.value ? 'linear-gradient(135deg, rgba(239,68,68,0.04), rgba(239,68,68,0.01))' : '#FFFFFF',
                  fontFamily: 'var(--font-sans)', display: 'flex', alignItems: 'center', gap: '14px',
                  textAlign: isRTL ? 'right' : 'left',
                }}
              >
                <span style={{
                  width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: declineReason === reason.value ? 'rgba(239,68,68,0.08)' : '#F5F3EF',
                  color: declineReason === reason.value ? '#ef4444' : '#8A8578',
                }}>
                  <reason.Icon size={17} />
                </span>
                <span style={{ fontWeight: 600, fontSize: '14px', color: declineReason === reason.value ? '#ef4444' : '#191B1E' }}>
                  {isRTL ? reason.labelAr : reason.labelEn}
                </span>
                {declineReason === reason.value && (
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                    style={{ marginLeft: 'auto', width: '22px', height: '22px', borderRadius: '50%', background: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#FFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  </motion.div>
                )}
              </motion.button>
            </StaggerItem>
          ))}
        </StaggerChildren>

        {declineReason && renderHostDetailsCard(false)}

        {(onBack || onContinue) && (
          <>
            <RsvpDivider themeColor={themeColor} />
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '4px' }}>
              {onBack && <button onClick={onBack} style={S.backBtn}>{isRTL ? 'رجوع' : 'Back'}</button>}
              {onContinue && <PremiumButton onClick={onContinue} accentColor={themeColor}>{t.continue}</PremiumButton>}
            </div>
          </>
        )}
      </div>
    );
  }

  /* ─── attending = yes ─── */


  const updateCompanion = (index, patch) => {
    setAdditionalGuests(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], ...patch };
      return copy;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <FadeInUp y={15}>
        <RsvpSectionHeading kicker={isRTL ? 'التفاصيل' : 'PARTY & CONTACT DETAILS'} themeColor={themeColor} isRTL={isRTL}>
          {mealField ? t.party_details : (isRTL ? 'تفاصيل المجموعة' : 'Party Details')}
        </RsvpSectionHeading>
      </FadeInUp>

      <FadeInUp delay={0.1} y={15}>
        <PartySizeStepper value={partySize} onChange={setPartySize} label={t.party_size_label} isRTL={isRTL} />
      </FadeInUp>

      {/* Directly under the stepper — the control the rule constrains. The
          other RSVP path (RsvpSection) renders the same component in the same
          position; see AdultsOnlyNotice for why it is one component. */}
      {noKidsAllowed && (
        <FadeInUp delay={0.14} y={10}>
          <AdultsOnlyNotice isRTL={isRTL} themeColor={themeColor} />
        </FadeInUp>
      )}

      {renderHostDetailsCard(true)}

      {/* ═══ COMPANION CARDS ═══ */}
      {additionalGuests.length > 0 && (
        <FadeInUp delay={0.24} y={10}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            paddingTop: '8px',
          }}>
            <span aria-hidden style={{ display: 'flex', color: themeColor }}><PeopleIcon size={19} strokeWidth={1.5} /></span>
            <div>
              <h4 style={{
                margin: 0, fontFamily: 'var(--font-serif)', fontSize: '16px', fontWeight: 600, color: '#191B1E',
              }}>{t.companions_section_title}</h4>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#77736A', lineHeight: 1.5 }}>
                {t.companions_section_desc}
              </p>
            </div>
          </div>
        </FadeInUp>
      )}

      <AnimatePresence>
        {additionalGuests.map((g, index) => {
          const { title, first, last } = splitName(g.fullName);
          const hasError = !!validationErrors[`additionalGuest_${index}`];
          const setName = (newTitle, newFirst, newLast) => updateCompanion(index, { fullName: joinName(newTitle, newFirst, newLast) });

          return (
            <motion.div
              key={g.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              transition={{ duration: 0.35, delay: index * 0.06 }}
              style={{
                padding: '20px', border: '1px solid #E8E2D6', borderRadius: '16px',
                background: '#FFFFFF',
                boxShadow: '0 2px 8px rgba(25,27,30,0.04)',
                display: 'flex', flexDirection: 'column', gap: '14px',
                position: 'relative',
              }}
            >
              {/* Companion badge */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span aria-hidden style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: '30px', height: '30px', borderRadius: '50%',
                    background: `${themeColor}14`, color: darken(themeColor, 0.1),
                    fontSize: '13px', fontWeight: 700, flexShrink: 0,
                    fontFamily: 'var(--font-sans)',
                  }}>{index + 2}</span>
                  <div>
                    <span style={{
                      fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.15em',
                      color: '#A09A91', fontWeight: 700, display: 'block', fontFamily: 'var(--font-sans)',
                    }}>{t.companion_badge}</span>
                    <strong style={{
                      fontSize: '14px', color: '#191B1E', display: 'block',
                      fontFamily: 'var(--font-sans)', fontWeight: 600, lineHeight: 1.2,
                    }}>{first || last ? joinName(title, first, last) : (isRTL ? `الضيف رقم ${index + 2}` : `Guest #${index + 2}`)}</strong>
                  </div>
                </div>
              </div>

              {/* Name row */}
              <div className="name-title-row" style={{ display: 'grid', gridTemplateColumns: '80px 1fr 1fr', gap: '10px' }}>
                <FormField label={isRTL ? 'اللقب' : 'Title'} error={validationErrors[`additionalGuest_title_${index}`]}>
                  <select
                    value={title.replace('.', '')}
                    onChange={e => setName(e.target.value ? e.target.value + '.' : '', first, last)}
                    style={{ ...S.inputBase, cursor: 'pointer', padding: '14px 8px', ...(validationErrors[`additionalGuest_title_${index}`] ? { borderColor: '#ef4444' } : {}) }}
                    onFocus={e => inputFocus(e)} onBlur={e => inputBlur(e, !!validationErrors[`additionalGuest_title_${index}`])}
                  >
                    <option value="">-</option>
                    {TITLE_OPTIONS.map(tt => <option key={tt} value={tt}>{tt === 'Child' ? 'Child' : tt + '.'}</option>)}
                  </select>
                </FormField>
                <FormField label={isRTL ? 'الاسم الأول' : 'First Name'} error={validationErrors[`additionalGuest_${index}`]}>
                  <input
                    type="text" value={first}
                    onChange={e => setName(title, e.target.value, last)}
                    placeholder={isRTL ? 'الاسم الأول' : 'First Name'}
                    style={{ ...S.inputBase, ...(hasError ? { borderColor: '#ef4444' } : {}) }}
                    onFocus={e => inputFocus(e)} onBlur={e => inputBlur(e, hasError)}
                  />
                </FormField>
                <FormField label={isRTL ? 'اسم العائلة' : 'Last Name'} error={validationErrors[`additionalGuest_last_${index}`]}>
                  <input
                    type="text" value={last}
                    onChange={e => setName(title, first, e.target.value)}
                    placeholder={isRTL ? 'اسم العائلة' : 'Family Name'}
                    style={{ ...S.inputBase, ...(validationErrors[`additionalGuest_last_${index}`] ? { borderColor: '#ef4444' } : {}) }}
                    onFocus={e => inputFocus(e)} onBlur={e => inputBlur(e, !!validationErrors[`additionalGuest_last_${index}`])}
                  />
                </FormField>
              </div>

              {/* A companion's name is the whole card. Email, phone, meal and
                  dietary notes used to sit here and are deliberately gone: the
                  person filling this in gives their own contact details, and
                  everyone they bring is recorded so the host can seat, count and
                  check them in. Asking for a companion's email is what pushed
                  households sharing one inbox into the per-event unique index,
                  where the address was silently thrown away. */}
            </motion.div>
          );
        })}
      </AnimatePresence>

      {isAttending && additionalGuests.length > 0 && mealOptions?.length > 0 && (
        <FadeInUp delay={0.28} y={10}>
          <CompanionMealCounter
            options={mealOptions}
            counts={companionMealCounts}
            onChange={setCompanionMealCount}
            companionCount={additionalGuests.length}
            required={!!mealField?.is_required}
            invalid={!!validationErrors.companionMealCounts}
            isRTL={isRTL}
            accentColor={themeColor}
          />
        </FadeInUp>
      )}

      {(onBack || onContinue) && (
        <>
          <RsvpDivider themeColor={themeColor} />
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '4px' }}>
            {onBack && <button onClick={onBack} style={S.backBtn}>{isRTL ? 'رجوع' : 'Back'}</button>}
            {onContinue && <PremiumButton testId="rsvp-next" onClick={onContinue} accentColor={themeColor}>{t.continue}</PremiumButton>}
          </div>
        </>
      )}

      {/* The companion rows above reuse .name-title-row / .email-phone-row, but
          they render in THIS scope — not renderHostDetailsCard's — so they need
          their own copy of the mobile single-column collapse. styled-jsx scopes
          a <style jsx> to the render function it sits in, so the host card's
          block (see renderHostDetailsCard) never reached these. */}
      <style jsx>{`
        @media (max-width: 640px) {
          .name-title-row { grid-template-columns: 1fr !important; }
          .email-phone-row { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
