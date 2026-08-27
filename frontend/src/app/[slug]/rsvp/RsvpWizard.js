'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { translations } from '../../utils/translations';
import { guestTitle } from '../../utils/guestBranding';
import { normalizeToE164 } from '../../utils/phone';
import { publicApiFetch } from '../../utils/publicApi';
import { useGuestAnalytics, useRsvpFunnelTracking, useAbandonmentTracking } from '../../utils/useGuestAnalytics';
import { isSeatingRevealed } from '../../utils/seating';
import { getRsvpDeadlineStatus, daysLeftPhrase } from '../../utils/rsvpDeadline';
import { splitName } from '../../utils/nameFields';
import { trimMealCounts } from '../../components/guest/rsvp/CompanionMealCounter';
import { findMealField } from './styles';
import { LangSwitchPill, RsvpDivider, SparkMark } from './components';
import { useSeatingLookup } from './hooks/useSeatingLookup';
import { lighten } from '../../utils/color';
import { getCelebrationPreset } from '../../utils/patternCelebration';
import { FloatingParticles } from '../../components/guest/GuestAnimations';
import TurnstileWidget, { turnstileEnabled } from '../../components/guest/TurnstileWidget';
import Icon from '../../components/icons/Icon';
import StepAttendance from './steps/StepAttendance';
import StepPartyDetails from './steps/StepPartyDetails';
import StepCustomQuestions from './steps/StepCustomQuestions';
import StepSuccess from './steps/StepSuccess';
import { safeZone } from '../../utils/timezone';

/**
 * RsvpWizard — the single-page input surface for the public RSVP form, rendered
 * as a child of <RsvpExperience> (which owns resolution, the already-responded
 * lock, terminal statuses, and the single idempotent submit). Sections reveal
 * progressively on ONE scrollable page (name -> attendance -> details/
 * questions -> submit) instead of step-by-step navigation; this shell owns the
 * form's local state and validation, the actual per-section UI lives in ./steps/*.
 */
export default function RsvpWizard({ event, guest, context, submit: doSubmit, rememberGuest, embedded = false, lang: langProp, onGuestIdentified }) {
  const slug = context?.slug || event?.slug;
  const searchParams = useSearchParams();
  const langParam = langProp || searchParams.get('lang') || 'en';

  const [lang, setLang] = useState(langParam);
  const [submitted, setSubmitted] = useState(false);

  const [guestName, setGuestName] = useState('');
  const [attending, setAttending] = useState(null);
  const revealedSectionRef = useRef(null);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [partySize, setPartySize] = useState(1);
  const [additionalGuests, setAdditionalGuests] = useState([]);
  const [customAnswers, setCustomAnswers] = useState({});
  const [notes, setNotes] = useState('');
  const [primaryMeal, setPrimaryMeal] = useState('');
  const [dietaryNotes, setDietaryNotes] = useState('');
  const [side, setSide] = useState('');
  const [smsConsent, setSmsConsent] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [partyId, setPartyId] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});
  const [assignedTableName, setAssignedTableName] = useState(null);
  const [qrToken, setQrToken] = useState(null);

  // A failed submit on this long single-page form previously left the guest
  // staring at whatever section they were scrolled to, with no indication
  // that an error appeared somewhere else on the page. FormField already
  // marks invalid inputs with aria-invalid once validationErrors is set —
  // scroll/focus the first one into view once that render commits.
  useEffect(() => {
    if (Object.keys(validationErrors).length === 0) return;
    const firstInvalid = document.querySelector('[aria-invalid="true"]');
    if (firstInvalid) {
      firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
      firstInvalid.focus?.({ preventScroll: true });
    }
  }, [validationErrors]);

  // Choosing "Attending" reveals a whole new set of required fields below the
  // fold with no cue that anything changed — bring the newly-revealed section
  // into view instead of leaving the guest looking at the (now-answered)
  // attendance question with no obvious next step.
  useEffect(() => {
    if (!attending) return;
    revealedSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [attending]);

  // A submitted email/phone that already belongs to an ANSWERED party. Held as
  // state rather than pushed through validationErrors because it carries an
  // action ("That's me"), and it must survive until the guest either edits the
  // field or confirms — unlike a validation error, which clears on the next
  // submit attempt.
  const [contactRegistered, setContactRegistered] = useState(null);
  const [claiming, setClaiming] = useState(false);

  // Companion meals: { "Beef": 2, "Fish": 1 } for the whole group. Companions
  // are names only, so a meal is a count rather than a choice attached to a
  // person — see the RSVP form's companion section.
  const [companionMealCounts, setCompanionMealCounts] = useState({});
  const setCompanionMealCount = (option, n) => setCompanionMealCounts((prev) => {
    const next = { ...prev };
    if (n > 0) next[option] = n; else delete next[option];
    return next;
  });

  // Dropping the party size must drop the meals with it. Without this the tally
  // keeps a total for a group that no longer exists, and the guest is told
  // "too many meals chosen" about companions they just removed.
  const setPartySizeAndTrimMeals = (v) => {
    setPartySize(v);
    setCompanionMealCounts((prev) => trimMealCounts(prev, Math.max(0, (parseInt(v, 10) || 1) - 1)));
  };

  const [maybeFollowUp, setMaybeFollowUp] = useState(null);
  const [declineReason, setDeclineReason] = useState(null);
  const [showTableLookup, setShowTableLookup] = useState(false);

  // Cloudflare Turnstile: only active when NEXT_PUBLIC_TURNSTILE_SITEKEY is set,
  // mirroring the backend gate. The solved token rides along in the submit body
  // as `captchaToken`; the ref lets us request a fresh one after a failed submit.
  const [captchaToken, setCaptchaToken] = useState(null);
  // Distinguishes "the widget failed to load" (network block / ad-blocker —
  // retrying won't help) from a plain expired/not-yet-solved token, so we can
  // show the guest something more useful than "please try again."
  const [captchaLoadError, setCaptchaLoadError] = useState(false);
  const turnstileRef = useRef(null);

  const seatingApi = useSeatingLookup(slug);

  // Typing in the field the notice is about retires it — it describes a value
  // that is no longer what will be submitted.
  const setEmailAndClearNotice = (v) => { setEmail(v); setContactRegistered(null); };
  const setPhoneAndClearNotice = (v) => { setPhone(v); setContactRegistered(null); };

  /**
   * "That's me" no longer resubmits — a click was never proof of anything. It
   * asks the server to email a short-lived link to the address on file, so only
   * someone who can read that inbox can change the response behind it.
   */
  const requestClaimLink = async () => {
    if (claiming) return;
    setClaiming(true);
    try {
      await publicApiFetch(`/public/events/${slug}/rsvp/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, lang: lang === 'ar' ? 'ar' : 'en' }),
      });
    } catch { /* the reply is deliberately identical either way — see the handler */ }
    // Shown even on a network error: the endpoint never reports whether the
    // address matched, so the card can't claim more than "we've sent it".
    setContactRegistered((prev) => (prev ? { ...prev, sent: true } : prev));
    setClaiming(false);
  };

  /* ═══ Analytics ═══
     The funnel/abandonment trackers just want a numeric "how far along" signal —
     derive it from the page's reveal state instead of a navigable step index. */
  const analyticsStep = submitted ? 5 : (attending ? 3 : 2);
  const { trackEvent } = useGuestAnalytics(slug);
  useRsvpFunnelTracking(slug, analyticsStep);
  useAbandonmentTracking(slug, analyticsStep, submitted);

  useEffect(() => { trackEvent('rsvp_started'); }, [trackEvent]);

  const [prevLangParam, setPrevLangParam] = useState(langParam);
  if (langParam !== prevLangParam) { setPrevLangParam(langParam); setLang(langParam); }

  /* ═══ Prefill from the engine-resolved guest ═══
     The unified <RsvpExperience> engine resolves the event + this party (via token,
     ?g=, ?party_id, or a remembered id) and renders this form only in the 'ready'
     phase. We pre-fill the known fields once. A responded guest reaches here only in
     edit mode (host allowed edits), so we also seed their previous response and skip
     the name-search step. Resolution / lock / status now live in the engine. */
  useEffect(() => {
    if (!guest) return;
    // Synchronizing local form state to the engine-resolved `guest` prop, which
    // only becomes available asynchronously — this is the prop-to-state sync
    // case the rule's "subscribe to external updates" carve-out is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (guest.id) setPartyId(guest.id);
    if (guest.guest_name) setGuestName(guest.guest_name);
    if (guest.email) setEmail(guest.email);
    if (guest.phone) setPhone(guest.phone);
    if (guest.party_size) setPartySize(guest.party_size);
    // BUG FIX: the primary guest's own meal choice was never pre-filled here
    // (only companions' were, via additionalGuests below), so reopening an
    // editable RSVP silently reset the host's meal picker to blank — and
    // resubmitting overwrote their saved meal_selection with NULL.
    if (guest.primary_meal) setPrimaryMeal(guest.primary_meal);
    if (guest.primary_dietary_notes) setDietaryNotes(guest.primary_dietary_notes);
    // Pre-fill companions already on file (e.g. entered by the organizer during guest
    // import) so the form asks the responder to confirm/edit each real person instead
    // of generating blank "Guest 2", "Guest 3" fields that silently discard their names.
    if (Array.isArray(guest.additionalGuests) && guest.additionalGuests.length > 0) {
      setAdditionalGuests(guest.additionalGuests.map(g => ({
        id: g.id || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        // Only the name is carried over. A party imported before this change may
        // still have a companion email/meal on file server-side; that data stays
        // exactly where it is, but the form no longer edits it.
        fullName: g.fullName || '',
      })));
    }
    if (guest.notes) setNotes(guest.notes);
    if (guest.side) setSide(guest.side);
    // Restores a returning guest's OWN recorded opt-in — not a pre-checked box.
    // The checkbox defaults to unchecked (useState(false)); it is only ticked
    // here when this guest previously ticked it themselves. Forcing it back to
    // unchecked would be worse than a dark pattern: re-submitting the form would
    // then write sms_consent = false and silently revoke a consent the guest
    // never withdrew. A guest who wants to withdraw unticks it, or replies STOP.
    if (guest.sms_consent) setSmsConsent(true);
    if (['yes', 'no', 'maybe'].includes(guest.response)) setAttending(guest.response);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ═══ Draft autosave (MOB-18) ═══
     A large party (companions, meals, custom answers) is a lot to type on a
     phone — losing all of it to an interrupted app-switch, low battery, or
     accidental reload had no recovery path. Debounce-persisted per slug in
     sessionStorage; rehydration below only ever fills in fields that are
     STILL blank, so the guest-prefill effect's server-resolved data (above)
     always wins over a locally-cached draft. Functional setState updates
     throughout so this is correct regardless of which mount effect's queued
     update React actually applies first. */
  const draftKey = slug ? `fancy_rsvp_draft_${slug}` : null;

  useEffect(() => {
    if (!draftKey || typeof window === 'undefined') return;
    let draft;
    try { draft = JSON.parse(window.sessionStorage.getItem(draftKey) || 'null'); } catch { draft = null; }
    if (!draft) return;
    // Rehydrating locally-cached draft answers into state on mount — the same
    // prop/storage-to-state sync case as the guest-prefill effect above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (draft.guestName) setGuestName(prev => prev || draft.guestName);
    if (draft.email) setEmail(prev => prev || draft.email);
    if (draft.phone) setPhone(prev => prev || draft.phone);
    if (draft.attending) setAttending(prev => prev || draft.attending);
    if (draft.partySize) setPartySize(prev => (prev && prev !== 1) ? prev : draft.partySize);
    if (draft.notes) setNotes(prev => prev || draft.notes);
    if (draft.primaryMeal) setPrimaryMeal(prev => prev || draft.primaryMeal);
    if (draft.dietaryNotes) setDietaryNotes(prev => prev || draft.dietaryNotes);
    if (draft.side) setSide(prev => prev || draft.side);
    if (draft.smsConsent) setSmsConsent(true);
    if (Array.isArray(draft.additionalGuests) && draft.additionalGuests.length > 0) {
      setAdditionalGuests(prev => (prev.some(g => g.fullName)) ? prev : draft.additionalGuests);
    }
    if (draft.customAnswers && typeof draft.customAnswers === 'object' && Object.keys(draft.customAnswers).length > 0) {
      setCustomAnswers(prev => (Object.keys(prev).length > 0 ? prev : draft.customAnswers));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draftKey || submitted || typeof window === 'undefined') return;
    const t = setTimeout(() => {
      try {
        window.sessionStorage.setItem(draftKey, JSON.stringify({
          guestName, email, phone, attending, partySize, additionalGuests, customAnswers,
          notes, primaryMeal, dietaryNotes, side, smsConsent,
        }));
      } catch { /* storage unavailable/full — best effort only */ }
    }, 600);
    return () => clearTimeout(t);
  }, [draftKey, submitted, guestName, email, phone, attending, partySize, additionalGuests, customAnswers, notes, primaryMeal, dietaryNotes, side, smsConsent]);

  // Draft served its purpose once submitted — don't resurrect stale answers
  // on a future visit to the same event.
  useEffect(() => {
    if (submitted && draftKey && typeof window !== 'undefined') {
      try { window.sessionStorage.removeItem(draftKey); } catch { /* fine */ }
    }
  }, [submitted, draftKey]);

  /* ═══ Document title ═══ */
  useEffect(() => {
    if (event) {
      // Same rule as the invitation page: the tab is a guest-facing surface.
      document.title = guestTitle(event, 'RSVP - ');
      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc) { metaDesc.setAttribute('content', event.description || `RSVP to ${event.title}`); }
      else {
        const meta = document.createElement('meta');
        meta.name = 'description';
        meta.content = event.description || `RSVP to ${event.title}`;
        document.head.appendChild(meta);
      }
    }
  }, [event]);

  /* ═══ Lightweight table fetch (post-submit success screen) ═══
     Unlike the engine's resolution this never locks the view — it only fills in the
     table name (if seating has been revealed) for the celebratory pass card. */
  const fetchAssignedTable = async (id, attempt = 0) => {
    if (!id) return;
    try {
      const data = await publicApiFetch(`/public/rsvp/guest/${id}`);
      if (data.guest?.table_name) setAssignedTableName(data.guest.table_name);
    } catch (err) {
      console.error('Table fetch failed:', err);
      // One quiet retry — a transient network blip right after submit shouldn't
      // permanently hide the table name from the success screen.
      if (attempt === 0) setTimeout(() => fetchAssignedTable(id, 1), 1500);
    }
  };

  /* ═══ Dynamic Font Loader ═══ */
  useEffect(() => {
    if (!event) return;
    const titleFont = event.custom_fonts?.card_title;
    const bodyFont = event.custom_fonts?.card_body;
    const fontsToLoad = [];
    if (titleFont && titleFont !== 'Playfair Display') fontsToLoad.push(titleFont.replace(/ /g, '+'));
    if (bodyFont && bodyFont !== 'Montserrat') fontsToLoad.push(bodyFont.replace(/ /g, '+'));
    if (fontsToLoad.length > 0) {
      const link = document.createElement('link');
      link.href = `https://fonts.googleapis.com/css2?family=${fontsToLoad.join('&family=')}&display=swap`;
      link.rel = 'stylesheet';
      document.head.appendChild(link);
      return () => { if (document.head.contains(link)) document.head.removeChild(link); };
    }
  }, [event]);

  /* ═══ Sync additional guests with party size ═══
     Only ever GROWS the underlying array — never truncates it. A guest who taps
     the party-size stepper down (e.g. to fix a typo) and back up used to lose
     every companion's already-typed name/email/meal, because this effect
     `splice`d the array down to the new size and regrowth only ever pushed
     fresh blank entries. Trimming for render/submit now happens separately
     (see additionalGuests.slice below and in handleSubmit), so a transient dip
     in party size no longer discards data — it reappears when size goes back up. */
  useEffect(() => {
    const size = parseInt(partySize) || 1;
    const diff = Math.max(size - 1, 0);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAdditionalGuests(prev => {
      if (diff <= prev.length) return prev;
      const copy = [...prev];
      while (copy.length < diff)
        copy.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          fullName: '',
        });
      return copy;
    });
  }, [partySize]);

  // The visible/submittable slice of additionalGuests — always exactly
  // partySize-1 entries, even though the underlying state array may hold more
  // (preserved from a larger party size the guest dialed back from).
  const visibleAdditionalGuests = additionalGuests.slice(0, Math.max((parseInt(partySize) || 1) - 1, 0));

  const themeColor = event?.custom_colors?.primary || '#B8944F';
  // Falls back to a lightened tint of the primary when the event has no
  // explicit secondary, so the card's frame/accents still feel bespoke
  // instead of defaulting to the fixed gold-on-cream look for every template.
  const secondaryColor = event?.custom_colors?.secondary || lighten(themeColor, 0.35);
  // Ties the whole page's ambient atmosphere to the chosen template family —
  // drifting petals for a garden theme, slow snow for a winter theme — while
  // still using this event's own color, not a generic preset.
  const celebration = getCelebrationPreset(event?.template_type);
  const isRTL = lang === 'ar';
  const t = translations[lang];

  // A11Y-3: keep the document's language/direction in sync with the guest's choice
  // so screen readers announce content in the right language and RTL is correct.
  useEffect(() => {
    const rtl = lang === 'ar';
    document.documentElement.lang = rtl ? 'ar' : 'en';
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
  }, [lang]);

  const localizedTitle = isRTL && (event?.title_ar || event?.template_data?.title_ar) ? (event?.title_ar || event?.template_data?.title_ar) : (event?.title || '');
  const coverImage = event?.cover_image_url;
  // The seating chart (table search + personal map) is hidden until 24h before
  // the event — UNLESS the organizer specifically added this guest (CSV import /
  // Add Guest), in which case it's visible immediately since their identity is
  // already confirmed by the organizer.
  const seatingRevealed = guest?.createdByOrganizer === true
    || (event?.event_date ? isSeatingRevealed(event.event_date) : false);

  // The meal field is shown as its own dedicated picker in step 3 (driven by the
  // organizer's configured options) rather than asked again as a generic custom
  // question in step 4.
  const allCustomFields = event?.custom_form_fields || [];
  const mealField = findMealField(allCustomFields);
  const customQuestionFields = mealField ? allCustomFields.filter(f => f.id !== mealField.id) : allCustomFields;
  // scope === 'guest' fields are asked once per companion (e.g. dietary needs);
  // everything else is party-scoped and asked once for the whole party.
  const partyScopedFields = customQuestionFields.filter(f => f.scope !== 'guest');
  const guestScopedFields = customQuestionFields.filter(f => f.scope === 'guest');

  const setAnswer = (fieldId, value) => {
    setCustomAnswers(prev => ({ ...prev, [fieldId]: value }));
    setValidationErrors(prev => { const n = { ...prev }; delete n[`field_${fieldId}`]; return n; });
  };
  const toggleMultiAnswer = (fieldId, opt) => {
    setCustomAnswers(prev => {
      const cur = (prev[fieldId] || '').split(',').map(s => s.trim()).filter(Boolean);
      const idx = cur.indexOf(opt);
      if (idx >= 0) cur.splice(idx, 1); else cur.push(opt);
      return { ...prev, [fieldId]: cur.join(', ') };
    });
    setValidationErrors(prev => { const n = { ...prev }; delete n[`field_${fieldId}`]; return n; });
  };

  /* ═══ Submit Handler — delegates to the engine's idempotent submit ═══
     Validation stays local; idempotency, lost-response reconciliation, the
     DUPLICATE_RSVP -> lock transition and the CLOSED / GUEST_LIMIT toasts are all
     owned by the engine. We react only to a clean success here. */
  const handleSubmit = async () => {
    const errors = {};
    const { title: hTitle, first: hFirst, last: hLast } = splitName(guestName);
    if (!hTitle) errors.guestNameTitle = 'Title is required';
    if (!hFirst.trim()) errors.guestNameFirst = 'First name is required';
    if (!hLast.trim()) errors.guestNameLast = 'Last name is required';
    // Email required for attendees (confirmation + logistics); optional for a
    // decline (validated for format only when supplied).
    if (attending === 'yes') {
      if (!email || !email.trim()) {
        errors.email = 'Email address is required';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.email = 'Invalid email format';
      }
    } else if (email && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Invalid email format';
    }

    // Phone is OPTIONAL for everyone (Twilio TFV 30475) — only its format is
    // checked, and only when the guest chose to supply one. Requiring it from
    // attendees made the SMS program's identifier a precondition of registering,
    // so "agreeing to receive messages" was not genuinely optional: there was no
    // way to RSVP while staying out of the program entirely. Do not reintroduce
    // a required-phone error here (see rsvpController's matching comment).
    const normalizedPhone = phone.trim() ? normalizeToE164(phone) : '';
    if (phone.trim() && !normalizedPhone) {
      errors.phone = t.phone_invalid || 'Enter a valid phone number';
    }
    // TCPA / Twilio Toll-Free Verification: SMS consent is INDEPENDENT and
    // OPTIONAL. It is deliberately NOT validated here. Blocking submission on
    // an unticked box (which this did until 2026-08-01) made SMS opt-in a
    // condition of RSVPing — phone is required for attendees, so "attend" and
    // "consent to texts" were the same act. That is precisely the bundled
    // consent Twilio rejects, and it contradicts the independence notice
    // rendered under the checkbox (SmsConsentText.js).
    //
    // The unticked state is not discarded: it is submitted as smsConsent:false,
    // stored with a timestamp, and enforced at send time — only sms_consent =
    // true is sendable (backend/services/smsDispatch.js). Do not reintroduce a
    // validation error here.

    if (partySize < 1 || partySize > 20) errors.partySize = 'Party size must be between 1 and 20';
    if (attending === 'yes') {
      // Meal requiredness was previously enforced ONLY by the backend RPC, and
      // only when it happened to find the field by a hardcoded key — the
      // frontend never checked this at all, so a guest could submit with every
      // meal picker left blank whenever that lookup missed (see mealField.js).
      if (mealField?.is_required && (!primaryMeal || !primaryMeal.trim())) {
        errors.primaryMeal = 'Meal selection is required';
      }
      // The group tally has to be complete (when the organizer made the meal
      // question required) and can never exceed the number of companions —
      // the same two rules the RPC enforces, checked here so the guest is told
      // before the round trip.
      if (partySize > 1 && mealField?.options?.length > 0) {
        const assigned = Object.values(companionMealCounts).reduce((sum, n) => sum + (Number(n) || 0), 0);
        if (assigned > partySize - 1) errors.companionMealCounts = 'Too many meals chosen';
        else if (mealField?.is_required && assigned !== partySize - 1) errors.companionMealCounts = 'Choose a meal for each guest';
      }
      // These used to be gated by a per-section "Continue" button that's gone
      // now everything lives on one page — enforce them at submit instead.
      // A companion is a name — nothing else is collected, so nothing else is
      // validated. Email, phone, meal and guest-scoped question checks used to
      // live here; see StepPartyDetails' companion card for why they went.
      if (partySize > 1) {
        visibleAdditionalGuests.forEach((g, index) => {
          const { title: cTitle, first: cFirst, last: cLast } = splitName(g.fullName);
          if (!cTitle) errors[`additionalGuest_title_${index}`] = 'Title is required';
          if (!cFirst.trim()) errors[`additionalGuest_${index}`] = 'First name is required';
          if (!cLast.trim()) errors[`additionalGuest_last_${index}`] = 'Last name is required';
        });
      }
      partyScopedFields.filter(f => f.is_required).forEach(field => {
        if (!customAnswers[field.id] || !customAnswers[field.id].toString().trim()) {
          errors[`field_${field.id}`] = `${field.field_label} is required`;
        }
      });
      // Guest-scoped required questions now also apply to the primary guest
      // (previously only companions were ever asked/validated) — same
      // customAnswers bucket as party-scoped fields, since the two never
      // share field IDs.
      guestScopedFields.filter(f => f.is_required).forEach(field => {
        if (!customAnswers[field.id] || !customAnswers[field.id].toString().trim()) {
          errors[`primary_field_${field.id}`] = `${field.field_label} is required`;
        }
      });
    }
    // 'always'-condition required questions must be answered for every response,
    // including declines/maybe (attendees are fully validated inside the block above).
    if (attending && attending !== 'yes') {
      partyScopedFields.filter(f => f.condition === 'always' && f.is_required).forEach(field => {
        if (!customAnswers[field.id] || !customAnswers[field.id].toString().trim()) {
          errors[`field_${field.id}`] = `${field.field_label} is required`;
        }
      });
      guestScopedFields.filter(f => f.condition === 'always' && f.is_required).forEach(field => {
        if (!customAnswers[field.id] || !customAnswers[field.id].toString().trim()) {
          errors[`primary_field_${field.id}`] = `${field.field_label} is required`;
        }
      });
    }
    if (attending === 'maybe' && !maybeFollowUp) errors.maybeFollowUp = 'Please select a follow-up timeframe';
    // Bot check — only enforced when Turnstile is configured (matches the backend).
    if (turnstileEnabled && !captchaToken) {
      errors.captcha = captchaLoadError
        ? (isRTL ? 'تعذر تحميل التحقق الأمني. قد يكون ذلك بسبب حظر الشبكة أو أداة حظر الإعلانات — يرجى تعطيلها أو تجربة شبكة أخرى، ثم إعادة تحميل الصفحة.' : "The security check couldn't load. This can happen on restrictive networks or with an ad-blocker enabled — try disabling it or switching networks, then reload the page.")
        : (t.captcha_required || (isRTL ? 'يرجى إكمال التحقق الأمني.' : 'Please complete the security check.'));
    }
    if (Object.keys(errors).length > 0) { setValidationErrors(errors); return; }
    setValidationErrors({});
    setContactRegistered(null);
    setSubmitting(true);

    let enrichedNotes = notes;
    if (attending === 'maybe' && maybeFollowUp) enrichedNotes = `[Follow-up: ${maybeFollowUp}] ${enrichedNotes}`.trim();
    if (attending === 'no' && declineReason) enrichedNotes = `[Decline reason: ${declineReason}] ${enrichedNotes}`.trim();

    const body = {
      partyId, guestName, email, phone: normalizedPhone, response: attending,
      partySize: attending === 'yes' ? partySize : 1,
      notes: enrichedNotes, primaryGuestMeal: primaryMeal, primaryGuestDietaryNotes: dietaryNotes,
      // Name only — the server ignores anything else on a companion, and sending
      // a stale draft's email/phone would only make the payload lie about what
      // was collected.
      additionalGuests: attending === 'yes' ? visibleAdditionalGuests.map(g => ({ fullName: g.fullName })) : [],
      customAnswers: Object.keys(customAnswers).map(fieldId => ({ fieldId, value: customAnswers[fieldId] })),
      decline_reason: attending === 'no' ? declineReason : undefined,
      maybe_confirm_by: attending === 'maybe' ? maybeFollowUp : undefined,
      side: event?.track_guest_side ? (side || undefined) : undefined,
      smsConsent,
      consentSource: 'guest_form_wizard', // provenance for the sms_consent record (backend whitelists values)
      lang: isRTL ? 'ar' : 'en', // sends the confirmation email in the language the guest used
      // Companion meals are a tally for the group, not a dish per person.
      companionMealCounts: attending === 'yes' && partySize > 1 ? companionMealCounts : null,
      ...(captchaToken ? { captchaToken } : {}),
    };

    const r = await doSubmit({ url: `/public/events/${slug}/rsvp`, body, reconcileId: partyId });
    setSubmitting(false);
    if (!r.ok) {
      // Turnstile tokens are single-use — force a fresh challenge before any retry.
      if (turnstileEnabled) { turnstileRef.current?.reset(); setCaptchaToken(null); }
      if (r.reason === 'CONTACT_REGISTERED') {
        setContactRegistered({ field: r.field, canUpdate: r.canUpdate });
      }
    }
    if (r.ok) {
      const resolvedId = r.data?.partyId || partyId;
      if (resolvedId) {
        setPartyId(resolvedId);
        rememberGuest(slug, resolvedId);
        if (attending === 'yes') fetchAssignedTable(resolvedId);
      }
      if (r.data?.qrToken) setQrToken(r.data.qrToken);
      // Tell the host page (EventPageClient) the guest's real name — its own
      // invitation greeting/envelope is fetched once on page load and has no
      // way to know a name was just typed in and submitted here, so without
      // this it keeps showing the generic "Esteemed Guest" placeholder until
      // the page is reloaded.
      onGuestIdentified?.({ id: resolvedId, guest_name: guestName, response: attending });
      setSubmitted(true);
    }
    // r.reason === 'LOCKED' -> engine has already swapped to the locked card.
  };

  /* ═══ Render ═══
     `embedded` mode (mounted as a section inside EventPageClient) drops the
     full-viewport centering shell, ambient particles, and the inner language
     toggle — the host page already supplies page-level background/chrome and
     its own language control. The card itself is unchanged either way. */
  const outerStyle = embedded
    ? {
        position: 'relative', width: '100%',
        display: 'flex', justifyContent: 'center',
        fontFamily: 'var(--font-sans)', textAlign: isRTL ? 'right' : 'left',
      }
    : {
        minHeight: '100dvh', position: 'relative', overflow: 'hidden',
        background: `radial-gradient(120% 100% at 50% 0%, ${secondaryColor}66 0%, #F8F4EC 45%, #EFE6D4 100%)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px', fontFamily: 'var(--font-sans)', textAlign: isRTL ? 'right' : 'left',
      };

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} style={outerStyle}>
      {/* Ambient dust — a quiet echo of the envelope's ignition, tinted to this event's own theme and shaped to its template family. */}
      {!embedded && <FloatingParticles count={18} color={secondaryColor} shape={celebration.ambient} />}

      <motion.div
        initial={{ opacity: 0, y: 34, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        style={{
          position: 'relative', zIndex: 1, maxWidth: '540px', width: '100%',
          borderRadius: '22px', padding: '1.5px',
          background: `linear-gradient(135deg, ${secondaryColor}, ${themeColor} 45%, ${secondaryColor})`,
          boxShadow: '0 36px 90px -24px rgba(110,74,34,0.38), 0 10px 30px rgba(25,27,30,0.07)',
        }}
      >
        <div style={{ background: '#FFFFFF', borderRadius: '20.5px', overflow: 'hidden' }}>
          <div style={{
            background: coverImage
              ? `linear-gradient(180deg, rgba(25,27,30,0.32) 0%, rgba(25,27,30,0.88) 100%), url(${coverImage}) center/cover`
              : 'linear-gradient(135deg, #191B1E 0%, #2a2d32 100%)',
            color: '#FFFFFF', padding: '38px 32px 32px', textAlign: 'center', position: 'relative',
            minHeight: coverImage ? '170px' : 'auto',
            display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
          }}>
            {/* Corner flourish — a quiet nod to the invitation's print-stationery roots. */}
            <span aria-hidden style={{
              position: 'absolute', top: '14px', ...(isRTL ? { right: '16px' } : { left: '16px' }), zIndex: 2,
            }}>
              <SparkMark color={secondaryColor} size={16} opacity={0.55} />
            </span>

            {!embedded && (
              <div style={{ position: 'absolute', top: '14px', ...(isRTL ? { left: '14px' } : { right: '14px' }), zIndex: 2 }}>
                <LangSwitchPill lang={lang} setLang={setLang} themeColor={themeColor} />
              </div>
            )}

            <motion.span initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
              style={{ fontSize: '10px', textTransform: isRTL ? 'none' : 'uppercase', letterSpacing: isRTL ? 'normal' : '4px', color: secondaryColor, fontWeight: 700, display: 'block', marginBottom: '10px', fontFamily: 'var(--font-sans)' }}>
              {t.rsvp_portal}
            </motion.span>
            <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.6 }}
              style={{ fontFamily: event?.custom_fonts?.card_title || 'var(--font-serif)', fontSize: '22px', fontWeight: 400, letterSpacing: '0.5px', lineHeight: 1.3 }}>
              {localizedTitle}
            </motion.h1>
            {/* Themed equivalent of the global .gold-shimmer-line class (kept
                out of globals.css since that class is also shared by the
                marketing footer and the ticket pass card) — same shimmer
                keyframe, defined locally below, tinted to this event's colors
                instead of a fixed gold. */}
            <motion.div aria-hidden initial={{ opacity: 0, scaleX: 0 }} animate={{ opacity: 1, scaleX: 1 }} transition={{ delay: 0.55, duration: 0.7 }}
              style={{
                width: '64px', margin: '14px auto 0', height: '1px',
                background: `linear-gradient(90deg, transparent 0%, ${lighten(secondaryColor, 0.3)} 30%, ${themeColor} 50%, ${lighten(secondaryColor, 0.3)} 70%, transparent 100%)`,
                backgroundSize: '200% 100%', animation: 'shimmer 3s linear infinite',
              }} />
            {!submitted && event?.rsvp_deadline && (() => {
              const status = getRsvpDeadlineStatus(event.rsvp_deadline);
              // Fixed, theme-independent warning colors (not derived from the
              // event's own palette) — these are semantic "urgent"/"passed"
              // states and need to read the same regardless of custom colors,
              // same as the plain "clock" pill always did for the normal case.
              const tone = status.passed ? '#E8A0A0' : status.urgent ? '#F0C36B' : lighten(secondaryColor, 0.35);
              const deadlineText = new Date(event.rsvp_deadline).toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: safeZone(event.timezone) });
              const label = status.passed
                ? t.reply_by_passed.replace('{date}', deadlineText)
                : status.urgent
                  ? t.reply_by_urgent.replace('{date}', deadlineText).replace('{daysPhrase}', daysLeftPhrase(status.daysLeft, isRTL))
                  : `${t.reply_by} ${deadlineText}`;
              // A full-width banner, not a small inline pill — the passed/
              // urgent states are the single most time-critical thing a guest
              // can read here, and an 11.5px pill was easy to miss entirely.
              return (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.65 }}
                  style={{
                    display: 'flex', alignSelf: 'stretch', alignItems: 'center', gap: '14px',
                    margin: '16px 0 0', padding: '16px 20px', borderRadius: '16px',
                    background: 'rgba(255,255,255,0.1)', border: `1.5px solid ${tone}55`,
                  }}>
                  <span style={{
                    flexShrink: 0, width: '38px', height: '38px', borderRadius: '50%',
                    background: 'rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon name={status.passed ? 'warning' : 'clock'} size={19} color={tone} strokeWidth={1.8} />
                  </span>
                  <span style={{ fontSize: '15px', fontWeight: 700, color: tone, fontFamily: 'var(--font-sans)', lineHeight: 1.45, textAlign: isRTL ? 'right' : 'left' }}>
                    {label}
                  </span>
                </motion.div>
              );
            })()}
          </div>

          <div style={{ padding: '28px 32px 32px', display: 'flex', flexDirection: 'column', gap: '28px' }}>

            {submitted ? (
              <StepSuccess
                t={t} isRTL={isRTL} attending={attending} event={event} localizedTitle={localizedTitle}
                guestName={guestName} email={email} partySize={partySize} partyId={partyId} slug={slug}
                themeColor={themeColor} assignedTableName={assignedTableName} qrToken={qrToken}
                maybeFollowUp={maybeFollowUp} declineReason={declineReason}
                seatingApi={seatingApi} seatingRevealed={seatingRevealed}
              />
            ) : (
              <>
                <StepAttendance
                  t={t} isRTL={isRTL} guestName={guestName} attending={attending}
                  onSelect={(val) => setAttending(val)}
                  themeColor={themeColor}
                />

                {attending && (
                  <motion.div ref={revealedSectionRef} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
                    style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
                    <RsvpDivider themeColor={themeColor} />
                    <StepPartyDetails
                      t={t} isRTL={isRTL} attending={attending}
                      guestName={guestName} setGuestName={setGuestName}
                      partySize={partySize} setPartySize={setPartySizeAndTrimMeals}
                      mealField={mealField} primaryMeal={primaryMeal} setPrimaryMeal={setPrimaryMeal}
                      dietaryNotes={dietaryNotes} setDietaryNotes={setDietaryNotes}
                      contactRegistered={contactRegistered}
                      onConfirmContactUpdate={requestClaimLink}
                      confirmingContact={claiming}
                      companionMealCounts={companionMealCounts}
                      setCompanionMealCount={setCompanionMealCount}
                      additionalGuests={visibleAdditionalGuests} setAdditionalGuests={setAdditionalGuests}
                      email={email} setEmail={setEmailAndClearNotice} phone={phone} setPhone={setPhoneAndClearNotice}
                      validationErrors={validationErrors} setValidationErrors={setValidationErrors}
                      maybeFollowUp={maybeFollowUp} setMaybeFollowUp={setMaybeFollowUp}
                      declineReason={declineReason} setDeclineReason={setDeclineReason}
                      side={side} setSide={setSide}
                      showSidePicker={!!event?.track_guest_side}
                      showDietary={event?.collect_dietary_restrictions !== false}
                      isWedding={event?.event_type === 'wedding'}
                      noKidsAllowed={!!event?.no_kids_allowed}
                      smsConsent={smsConsent} setSmsConsent={setSmsConsent}
                      themeColor={themeColor} secondaryColor={secondaryColor}
                    />

                    {turnstileEnabled && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                        <TurnstileWidget
                          ref={turnstileRef}
                          onVerify={(token) => {
                            setCaptchaToken(token);
                            setCaptchaLoadError(false);
                            setValidationErrors(prev => { const n = { ...prev }; delete n.captcha; return n; });
                          }}
                          onExpire={() => setCaptchaToken(null)}
                          onError={() => { setCaptchaToken(null); setCaptchaLoadError(true); }}
                        />
                        {validationErrors.captcha && (
                          <span style={{ fontSize: '12px', color: '#ef4444' }}>{validationErrors.captcha}</span>
                        )}
                      </div>
                    )}

                    <RsvpDivider themeColor={themeColor} />
                    <StepCustomQuestions
                      t={t} isRTL={isRTL} fields={attending === 'yes' ? partyScopedFields : partyScopedFields.filter(f => f.condition === 'always')}
                      guestName={guestName}
                      guestScopedFields={attending === 'yes' ? guestScopedFields : guestScopedFields.filter(f => f.condition === 'always')}
                      customAnswers={customAnswers} setAnswer={setAnswer} toggleMultiAnswer={toggleMultiAnswer}
                      notes={notes} setNotes={setNotes} validationErrors={validationErrors}
                      submitting={submitting}
                      onSubmit={handleSubmit}
                      themeColor={themeColor}
                    />
                  </motion.div>
                )}
              </>
            )}
          </div>
        </div>
      </motion.div>

      <style jsx>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
      `}</style>
    </div>
  );
}
