'use client';
import { toast } from '../../utils/toast';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';
import { supabase } from '../../utils/supabaseClient';
import { startSmsCreditPurchase } from '../../utils/smsPurchase';
import { toTagArray } from '../components/TagListEditor';
import { TEMPLATES, TEMPLATE_PREVIEW_PATTERN, RETIRED_TEMPLATE_SUCCESSOR } from '../../utils/curatedTemplates';
import { CINEMATIC_KEYS } from '../../components/templates/cinematic/cinematicThemes';
import { resolveOccasion } from '../../utils/eventOccasion';
import { buildPreviewEvent } from './components/previewEvent';
import { instantToWallClock } from '../../utils/timezone';
import { useOrganizerTimeZone } from '../components/OrganizerClock';

/* ═══════════════════════════════════════════════════════
   LAZY-LOADED STAGE COMPONENTS
   ═══════════════════════════════════════════════════════ */
const WizardShell = dynamic(() => import('./components/WizardShell'), { ssr: false });
const Stage1_TemplatesSimulator = dynamic(() => import('./components/Stage1_TemplatesSimulator'), { ssr: false });
const Stage2_FormConfiguration = dynamic(() => import('./components/Stage2_FormConfiguration'), { ssr: false });
const StagePayment = dynamic(() => import('./components/StagePayment'), { ssr: false });
const StageTables = dynamic(() => import('./components/StageTables'), { ssr: false });
const Stage3_Distribution = dynamic(() => import('./components/Stage3_Distribution'), { ssr: false });
/* Split for the same reason the stages are: it pulls the entire guest renderer
   — every section, the RSVP form, both cinematic openings — and most organizers
   reach Continue without ever opening it. */
const PreviewModal = dynamic(() => import('./components/PreviewModal'), { ssr: false });

/* Wizard step labels (drives the top progress bar). Payment now comes right
   after picking a template/tier and before the event-details form, per the
   "Login -> Pay Upfront -> Access Event Creation" flow. */
const WIZARD_LABELS = ['Templates', 'Payment', 'Configure', 'Tables', 'Distribute'];
const LAST_STEP = 4;

/* ═══════════════════════════════════════════════════════
   DESIGN TOKENS
   ═══════════════════════════════════════════════════════ */
const C = {
  gold: '#B8944F', goldHover: '#a6833f', goldLight: 'rgba(184,148,79,0.15)',
  charcoal: '#191B1E', darkBg: '#0A0A0F',
  ivory: '#F8F4EC', champagne: '#D7BE80', stone: '#77736A',
  border: '#E8E2D6', white: '#FFFFFF', softBg: '#FAFAF8',
  error: '#C45E5E', success: '#3B9B6D',
};

/* Visual-only template keys — each is a distinct InvitationCard pattern, but
   semantically they're all "a wedding" (Groom's/Bride's Side labels, meal
   selection, the Stage2 partner/ceremony fields, etc. all key off event_type
   === 'wedding'). Kept as a single list so template_type and event_type can
   diverge cleanly without scattering the same OR-chain across the app. */
/* The retired visual variants, whose DEFAULT occasion is a wedding.

   This used to be the list that made a template mean an occasion — Door of
   Joy was in it, so it collected Groom's/Bride's Side labels and the wedding
   field set no matter what the organizer was actually celebrating. The
   cinematic templates now carry their own `defaultOccasion` and are gone from
   here; what is left is the keys that have no entry of their own to say so. */
const WEDDING_STYLE_TEMPLATE_KEYS = [
  'tuscany', 'marrakesh', 'kyoto', 'nordic', 'havana',
  'estate', 'roseAtelier', 'orchid', 'clay', 'alpine', 'coastal', 'heritageArch',
];

/**
 * The `event_type` this event should carry.
 *
 * `event_type` is the coarse category the REST of the product keys off —
 * Groom's/Bride's Side labels (utils/sideLabel.js), meal selection
 * (RsvpSection), the RSVP wizard, EditGuestModal, SendInvitationModal and the
 * CSV export all read it and none of them knows a template key. Resolving the
 * occasion HERE is what makes all of them correct with no further edits;
 * adding a template to a list inside each of those files is how the "Groom's
 * Side" label ends up on a birthday.
 */
function deriveEventType(templateType, templateData) {
  /* The organizer's own answer, whatever artwork they picked — the line that
     makes a birthday on Velvet Ring behave like a birthday everywhere
     downstream. Through the SAME resolver the guest page and both editors
     use, so the event_type written here can never disagree with the occasion
     those screens render. */
  return resolveOccasion(templateType, templateData)
    /* No occasion at all: the retired continuous-scroll categories, which are
       their own event_type and have no occasion to resolve. */
    || templateType;
}

/**
 * Client-side mirror of the backend's event-date ordering rules
 * (eventController.updateEvent): the end must not precede the start, and the
 * RSVP deadline must fall on or before the event date. Catches the mistake
 * before any request goes out — so the organizer gets an instant message
 * instead of a failed round-trip 400. Returns a user-facing message for the
 * first violated rule, or null when the dates are consistent. A blank end date
 * or deadline is optional and skips its own check. Comparisons use the same
 * `new Date(...)` parsing the server uses, keeping client and server verdicts
 * in lockstep (equal end==start and deadline==event are allowed, matching the
 * server's strict `<` / `>` checks).
 */
function getDateOrderError(eventDate, eventEndDate, rsvpDeadline) {
  if (!eventDate) return null; // presence is validated separately
  const start = new Date(eventDate);
  if (eventEndDate && new Date(eventEndDate) < start) {
    return 'The end date must be on or after the start date.';
  }
  if (rsvpDeadline && new Date(rsvpDeadline) > start) {
    return 'The RSVP deadline must be on or before the event date.';
  }
  return null;
}

/* ═══════════════════════════════════════════════════════
   CURATED TEMPLATE DEFINITIONS — see utils/curatedTemplates.js
   ═══════════════════════════════════════════════════════ */
/* Three templates in the picker: Velvet Ring, Door of Joy, Custom Canvas.
   Every other key this file still knows about is retired FROM THE PICKER and
   from nowhere else — Royale Wedding ('wedding') and Eternal Love
   ('engagement'), the categories corporate/birthday/gala, and the
   wedding-style variants (tuscany, marrakesh, kyoto, nordic, havana, estate,
   roseAtelier, orchid, clay, alpine, coastal, heritageArch). Their field sets
   below and their render patterns in the guest renderer are intact, so an
   existing event on any of them keeps working exactly as before. `TEMPLATES`
   itself lives in utils/curatedTemplates.js, shared with EventSettings' Visual
   Template picker, so the two can never show a different set of "real"
   templates. */

/* Each template type owns a distinct slice of templateData — used by
   handleTemplateSelect to drop a previous type's fields (e.g. wedding's
   loveStory) when the organizer switches to a type that doesn't use them,
   instead of silently carrying them over into the new type's submission. */
// The full-page guest experience's own section fields (a flexible list of
// days — each with its own venue and schedule, see ha_days/DaysEditor —
// accommodation & FAQ lists, meal options, invited-to city, menu, things-to-do,
// getting-there, gift bank details). Shared by EVERY
// full-page template so switching template type never wipes them. The legacy
// ha_schedule_day1/day2 and ha_venue_day1/day2_* keys are deliberately left
// out of every template's list now (see getHaDays) — that makes them "not
// template-specific" to handleTemplateSelect below, so they're never pruned
// on a template switch and existing events keep rendering from them.
const HA_SECTION_FIELD_KEYS = [
  'ha_days',
  'ha_accommodation', 'ha_faq', 'ha_meal_options', 'ha_invited_to_city', 'ha_invited_to_lat', 'ha_invited_to_lng', 'ha_our_story',
  'ha_menu_courses', 'ha_things_to_do', 'ha_getting_there',
  'ha_gift_bank_name', 'ha_gift_account_name', 'ha_gift_iban', 'ha_gift_registry_label', 'ha_gift_message',
];
const WEDDING_FIELD_KEYS = [
  'partner1', 'partner2', 'partner1_email', 'partner2_email', 'loveStory',
  'ceremony_venue_name', 'ceremony_venue_address', 'ceremony_lat', 'ceremony_lng', 'ceremony_place_id', 'ceremony_time_of_day',
  'reception_venue_name', 'reception_venue_address', 'reception_lat', 'reception_lng', 'reception_place_id', 'reception_time_of_day',
  'giftRegistry', 'accommodations',
  ...HA_SECTION_FIELD_KEYS,
];
// The occasion picker's own fields (Stage 2). `custom_category` holds the
// answer; the rest are the three content shapes it selects between — a couple,
// a single honoree, or a baby shower — see utils/customEventCategories.js.
const CUSTOM_CATEGORY_FIELD_KEYS = [
  'custom_category',
  'partner1', 'partner2', 'partner1_email', 'partner2_email', 'loveStory', 'proposalStory',
  'custom_honoree', 'custom_milestone',
  'custom_parents', 'custom_baby_name', 'custom_baby_due',
];
/* Every full-page template now carries the SAME set: the wedding fields plus
   the occasion picker's.

   This list is what handleTemplateSelect PRUNES by. It governs switching
   TEMPLATES, not which inputs render (the occasion's `kind` decides that).
   Now that any template can be any occasion, a per-template set would mean
   moving a birthday from Velvet Ring to Door of Joy silently deletes the
   honoree's name — the two screens offer identical fields, but the pruner
   would not know it. One universal set makes that impossible. */
const FULL_PAGE_FIELD_KEYS = [
  ...new Set([...WEDDING_FIELD_KEYS, ...CUSTOM_CATEGORY_FIELD_KEYS]),
];

const TEMPLATE_TYPE_FIELD_KEYS = {
  // The continuous-scroll categories keep their own fields: they are retired
  // from the picker, they have no ha_* sections, and nothing new points here.
  corporate: ['company', 'agenda', 'speakers', 'sponsors', 'networkingNotes'],
  birthday: ['celebrant', 'age', 'partyTheme', 'giftRegistry'],
  gala: ['honoree', 'program', 'sponsorPackages'],
};
// Every full-page template — the cinematic ones, custom, wedding, engagement,
// and the retired visual variants — shares the universal set above.
[...WEDDING_STYLE_TEMPLATE_KEYS, 'wedding', 'engagement', 'custom', ...CINEMATIC_KEYS]
  .forEach((key) => { TEMPLATE_TYPE_FIELD_KEYS[key] = FULL_PAGE_FIELD_KEYS; });

/* Defaults for the guided Custom builder (Template #3) — design only. The
   event's title, cover image, and content (including what kind of event
   this is) are configured on Step 2 like every other template. */
const DEFAULT_CUSTOM_CONFIG = {
  headingFont: 'serif',          // serif | sans | script | display | minimal | whimsical (see CustomBuilder's FONTS)
  primary: '#8B7355',
  secondary: '#D4C5A9',
  accent: '#8B7355',
  background: '#FAF8F5',
};

const STEPS = [
  { key: 'templates', label: 'Templates' },
  { key: 'configure', label: 'Configure' },
  { key: 'distribute', label: 'Distribute' },
];

/* ═══════════════════════════════════════════════════════
   STEP TRANSITION VARIANTS
   ═══════════════════════════════════════════════════════ */
const stepVariants = {
  enter: (direction) => ({
    x: direction > 0 ? 80 : -80,
    opacity: 0,
    scale: 0.97,
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
    transition: {
      x: { type: 'spring', stiffness: 300, damping: 30 },
      opacity: { duration: 0.3 },
      scale: { duration: 0.3 },
    },
  },
  exit: (direction) => ({
    x: direction > 0 ? -80 : 80,
    opacity: 0,
    scale: 0.97,
    transition: { duration: 0.25 },
  }),
};

/* ═══════════════════════════════════════════════════════
   MAIN WIZARD COMPONENT
   ═══════════════════════════════════════════════════════ */
export default function CreateEventWizard() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
  const frontendUrl = process.env.NEXT_PUBLIC_FRONTEND_URL || 'https://fancyrsvp.com';

  /* ─── Wizard Navigation State ─── */
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);
  const draftHydratedRef = useRef(false);

  /* ─── Draft event + payment state ─── */
  const [eventId, setEventId] = useState(null);
  const [pricingTiers, setPricingTiers] = useState([]);
  const [manualMethods, setManualMethods] = useState([]);
  const [referralCreditCents, setReferralCreditCents] = useState(0);
  const [smsListPriceCents, setSmsListPriceCents] = useState(null);

  /* ═══ SMS add-on, chosen on the payment step ═══
     Sizing comes from the server (payments/pricing-config → smsEstimates), keyed
     by tier and script, so the recommendation the organizer sees and the price
     Stripe charges are derived from ONE definition. Off by default: SMS is an
     opt-in purchase, and defaulting it on would charge people who never asked. */
  const [smsAddonEnabled, setSmsAddonEnabled] = useState(false);
  const [smsAddonSegments, setSmsAddonSegments] = useState(null);
  const [smsEstimates, setSmsEstimates] = useState({});
  // The admin's live discount tiers, so the purchase screen's price preview
  // matches what checkout will actually charge.
  const [smsVolumeDiscounts, setSmsVolumeDiscounts] = useState(null);
  // Registry key -> human label, so tier bullets never print `add_guest_manual`.
  const [featureLabels, setFeatureLabels] = useState({});
  const [hiddenTierFeatures, setHiddenTierFeatures] = useState([]);
  // Registry key -> "charged separately" caption, for features a plan grants
  // ACCESS to rather than includes outright (text messaging). Without it a tier
  // bullet reading plain "Text messaging" is a promise the product does not
  // keep, and the organizer discovers the difference when they try to send.
  const [featureNotes, setFeatureNotes] = useState({});
  // Which paid integrations are live right now (server-driven). Default OFF so the
  // UI is manual-first until the backend reports card/SMS are enabled.
  const [features, setFeatures] = useState({ stripeEnabled: false, smsEnabled: false });
  const [selectedTierName, setSelectedTierName] = useState('');
  /**
   * The stable key of the plan the organizer picked.
   *
   * The wizard tracks its selection by NAME (the estimates map and the resume
   * snapshot are both keyed that way), but the name is display text an admin
   * can change at any moment — including between this page loading and the
   * organizer pressing Pay, which used to fail checkout outright with
   * "Pricing tier 'X' not found". The key is resolved from the loaded tiers at
   * submit time and sent alongside. See backend/utils/tierResolver.js.
   */
  const selectedTierKey = (pricingTiers.find(
    t => String(t?.name || '').toLowerCase() === String(selectedTierName || '').toLowerCase(),
  ) || {}).key || undefined;
  const [manualRef, setManualRef] = useState('');
  const [payProcessing, setPayProcessing] = useState(false);
  const [payError, setPayError] = useState('');
  /* Post-Stripe redirect handling (card flow) */
  const [paymentConfirmed, setPaymentConfirmed] = useState(false); // verified paid
  const [paymentNotice, setPaymentNotice] = useState('');          // banner text
  const [verifyingPayment, setVerifyingPayment] = useState(false);
  // Kept around (the URL's own session_id param gets stripped right after the
  // resume effect reads it) so a "Check again" button can re-verify without a
  // page reload if the webhook is slow and the synchronous verify above came
  // back "still processing".
  const [pendingSessionId, setPendingSessionId] = useState('');
  // Current plan: populated when the event is already paid (shows the locked
  // "Current Plan" panel + upgrade option instead of the tier picker).
  const [eventIsPaid, setEventIsPaid] = useState(false);
  const [currentTierName, setCurrentTierName] = useState('');
  const [currentTierMaxGuests, setCurrentTierMaxGuests] = useState(null);

  /* ─── Template & Preset State ─── */
  /* The first template in the picker, not a hardcoded key. This defaulted to
     'engagement' — one of the two retired templates — so removing them from
     TEMPLATES would have left the wizard opening on a template that is no
     longer in its own list: no card selected, no presets, and the specs strip
     falling back to whatever TEMPLATES[0] happened to be. */
  const [templateType, setTemplateType] = useState(TEMPLATES[0].key);
  /* Likewise derived. The old literal named 'engagement'/'wedding'/'custom',
     so every template added since (ring, bab) has been missing an entry and
     silently reading `undefined || 0`. */
  const [selectedPresets, setSelectedPresets] = useState(
    () => Object.fromEntries(TEMPLATES.map((t) => [t.key, 0])),
  );

  /* ─── Guided Custom builder config (Template #3) ─── */
  const [customConfig, setCustomConfig] = useState(DEFAULT_CUSTOM_CONFIG);

  /* ─── Core Event Details ─── */
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugStatus, setSlugStatus] = useState(null);
  const [suggestedSlug, setSuggestedSlug] = useState('');
  const [description, setDescription] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventEndDate, setEventEndDate] = useState('');
  const [locationName, setLocationName] = useState('');
  const [locationAddress, setLocationAddress] = useState('');
  const [locationLat, setLocationLat] = useState(null);
  const [locationLng, setLocationLng] = useState(null);
  const [locationPlaceId, setLocationPlaceId] = useState('');

  /* ─── Template-Specific Data ─── */
  const [templateData, setTemplateData] = useState({});

  /* ─── Event Settings ─── */
  const [dressCode, setDressCode] = useState('');
  const [rsvpDeadline, setRsvpDeadline] = useState('');
  const [privacyMode, setPrivacyMode] = useState('private');
  const [accessPassword, setAccessPassword] = useState('');
  // Display-only — the server never sends the stored password hash back (see
  // eventController.withResolvedTier), so this tells the UI a password is
  // already configured even though the (always-blank) field can't show it.
  const [hasAccessPassword, setHasAccessPassword] = useState(false);
  const [notificationEmail, setNotificationEmail] = useState(true);
  const [allowGuestEdits, setAllowGuestEdits] = useState(false);
  const [trackGuestSide, setTrackGuestSide] = useState(false);
  const [noKidsAllowed, setNoKidsAllowed] = useState(false);
  const [collectDietaryRestrictions, setCollectDietaryRestrictions] = useState(true);
  const [coverImageUrl, setCoverImageUrl] = useState('');
  const [coverImageUploading, setCoverImageUploading] = useState(false);
  const [backgroundMusicUrl, setBackgroundMusicUrl] = useState('');
  const [musicUploading, setMusicUploading] = useState(false);
  const [galleryUrls, setGalleryUrls] = useState([]);
  const [galleryUploading, setGalleryUploading] = useState(false);

  /* ─── Custom Colors (derived from preset) ─── */
  const [customColors, setCustomColors] = useState({
    primary: '#B8944F', secondary: '#D7BE80',
    accent: '#B8944F', background: '#FFFDF7',
  });

  /* ─── Custom Form Fields (Stage 2 builder) ─── */
  const [customFields, setCustomFields] = useState([]);
  // Snapshot of the fields as they existed on the server at draft-resume time —
  // handleSubmit diffs the live customFields against this to know which
  // already-persisted fields were edited or removed during this session (only
  // brand-new fields used to be sent, silently dropping edits/deletes on resume).
  const originalFieldsRef = useRef([]);

  /* ─── Distribution Methods (Stage 3) ─── */
  const [distributionMethods, setDistributionMethods] = useState({
    link: true, qr: false, sms: false,
  });
  const [smsTemplate, setSmsTemplate] = useState('');

  /* ─── SMS credit wallet (distribution step) ─── */
  const [smsCredits, setSmsCredits] = useState(null);
  const [smsCreditsLoading, setSmsCreditsLoading] = useState(false);
  const [buyingCredits, setBuyingCredits] = useState(false);
  const [creditError, setCreditError] = useState('');

  /* ─── Slug availability debounce ref ─── */
  const slugTimerRef = useRef(null);
  // The event title and the event URL are independent. We seed the URL from the
  // title for convenience, but the moment the organizer edits the URL themselves
  // this flips true and the title stops overwriting their chosen slug.
  const slugManuallyEditedRef = useRef(false);

  /* ═══ Mount animation trigger ═══ */
  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  /* ═══ Auth check ═══ */
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const orgId = localStorage.getItem('org_id');
      if (!orgId) {
        window.location.href = '/login';
      }
    }
  }, []);

  /* ═══ Surface every form/save error to the organizer as a toast ═══
     The wizard is one very long single-page form and the inline error banner
     lives INSIDE the individual step components — the Configure step (where the
     title/URL/date validations and the backend save happen) renders no banner
     at all, so a rejected save (e.g. the API refusing an end date that precedes
     the start date) set `error` but showed the organizer nothing. Mirroring the
     error state into a toast guarantees it's seen no matter which step they're
     on or how far they've scrolled. Existing banners stay where they render. */
  useEffect(() => { if (error) toast.error(error); }, [error]);
  // Payment/credit failures already render an inline banner on the Payment step,
  // but mirror them to a toast too so every wizard error reaches the organizer
  // through the same channel, wherever they are in the flow.
  useEffect(() => { if (payError) toast.error(payError); }, [payError]);
  useEffect(() => { if (creditError) toast.error(creditError); }, [creditError]);

  /* ═══ Resume an existing DRAFT (Dashboard → Drafts → Continue setup) ═══
     ?draft=<eventId> hydrates every event field from the saved draft and drops the
     organizer back on the Configure step to keep editing. */
  useEffect(() => {
    if (typeof window === 'undefined' || draftHydratedRef.current) return;
    const draftId = new URLSearchParams(window.location.search).get('draft');
    if (!draftId) return;
    draftHydratedRef.current = true;
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/events/${draftId}`, { credentials: 'include' });
        const data = await res.json();
        const ev = data?.event;
        if (!ev) return;
        /* ISO instant → datetime-local, ON THE EVENT'S CLOCK.
           This used to be `String(v).slice(0, 16)`, which was correct while a
           stored date WAS the typed digits with a UTC suffix — slicing simply
           removed the suffix. It is now destructive: the stored instant for a
           6:30pm San Diego draft is 01:30 the next day in UTC, so slicing
           prefills tomorrow at 1:30am. The organizer resumes their draft,
           sees a time they never typed, and saving writes it back. */
        const dt = (v) => instantToWallClock(v, ev.timezone);
        setEventId(ev.id);
        /* A draft saved before Royale Wedding / Eternal Love were retired
           still carries one of their keys. Selecting it here would leave the
           picker with NO card highlighted — the key is not in TEMPLATES any
           more — and the specs strip showing a different template's features
           than the one Stage 2 is configuring. The successor takes the same
           field set, so nothing the organizer already typed is dropped. */
        if (ev.template_type) {
          setTemplateType(RETIRED_TEMPLATE_SUCCESSOR[ev.template_type] || ev.template_type);
        }
        setTitle(ev.title || '');
        if (ev.slug) { slugManuallyEditedRef.current = true; setSlug(ev.slug); }
        setDescription(ev.description || '');
        setEventDate(dt(ev.event_date));
        setEventEndDate(dt(ev.event_end_date));
        setLocationName(ev.location_name || '');
        setLocationAddress(ev.location_address || '');
        setLocationLat(ev.location_lat ?? null);
        setLocationLng(ev.location_lng ?? null);
        setLocationPlaceId(ev.location_place_id || '');
        setDressCode(ev.dress_code || '');
        setRsvpDeadline(dt(ev.rsvp_deadline));
        setPrivacyMode(ev.privacy_mode || 'private');
        setAccessPassword('');
        setHasAccessPassword(!!ev.has_access_password);
        setNotificationEmail(ev.notification_preferences?.email !== false);
        setAllowGuestEdits(!!ev.allow_guest_edits);
        setTrackGuestSide(!!ev.track_guest_side);
        setCoverImageUrl(ev.cover_image_url || '');
        setGalleryUrls(Array.isArray(ev.gallery_urls) ? ev.gallery_urls : []);
        setBackgroundMusicUrl(ev.background_music_url || '');
        if (ev.custom_colors) setCustomColors(ev.custom_colors);
        if (ev.template_data) {
          setTemplateData(ev.template_data);
          if (ev.template_data.customDesign) setCustomConfig(ev.template_data.customDesign);
        }

        // Restore previously-saved custom RSVP questions/meal fields — without this,
        // the form builder shows empty on resume even though fields already exist in
        // the DB, and re-adding them collides with the existing field_key on save.
        try {
          const fieldsRes = await fetch(`${apiUrl}/events/${ev.id}/fields`, { credentials: 'include' });
          const fieldsData = await fieldsRes.json();
          if (fieldsRes.ok && Array.isArray(fieldsData?.fields)) {
            const hydratedFields = fieldsData.fields.map((f) => ({
              id: f.id,
              key: f.field_key,
              label: f.field_label,
              type: f.field_type,
              options: Array.isArray(f.options) ? f.options : [],
              isRequired: !!f.is_required,
              sortOrder: f.sort_order ?? 0,
              isMealField: !!f.is_meal_field,
              condition: f.condition || 'attending',
              savedToServer: true,
            }));
            setCustomFields(hydratedFields);
            originalFieldsRef.current = hydratedFields;
          }
        } catch { /* non-fatal — organizer can re-add fields */ }

        // Restore payment state from event_payments if a pending manual payment exists.
        const payments = Array.isArray(ev.event_payments) ? ev.event_payments : [];
        const pendingCash = payments.find(p => p && p.status === 'pending' && p.payment_method === 'cash_manual');
        if (pendingCash) {
          setManualRef(pendingCash.reference_number || '');
          if (pendingCash.tier_name) setSelectedTierName(pendingCash.tier_name);
        }
        // If the event is already paid, restore that state too (tier name/cap are
        // refetched correctly once the wizard reaches the Payment step).
        if (ev.is_paid) setEventIsPaid(true);

        // Paid drafts resume on Configure (step 2); unpaid ones go back to
        // Payment (step 1) since access to the details form is gated on payment.
        setDirection(1);
        setStep(ev.is_paid ? 2 : 1);
        window.history.replaceState({}, '', '/dashboard/create-event');
      } catch { /* non-fatal — organizer can start fresh */ }
    })();
  }, [apiUrl]);

  /* Re-verifiable on demand (a "Check again" button) as well as on the initial
     redirect below — pulled out so both call sites share one implementation.
     Defined before the resume effect below so that effect can call it
     directly without a ref-indirection workaround. */
  const verifyPaymentSession = useCallback(async (sessionId) => {
    if (!sessionId) return;
    setVerifyingPayment(true);
    setPayProcessing(true);
    try {
      const res = await fetch(`${apiUrl}/payments/verify?session_id=${encodeURIComponent(sessionId)}`, { credentials: 'include' });
      const data = await res.json();
      if (data.success && data.paid) {
        setPaymentConfirmed(true);
        setPaymentNotice('Payment received — your event is now under review. It goes live to guests once approved; you can keep setting it up in the meantime.');
      } else if (data.success && !data.paid) {
        setPaymentNotice('Payment is still processing. It will be confirmed automatically once it clears.');
      } else {
        setPaymentNotice(data.message || 'We could not confirm the payment yet. It will be confirmed automatically shortly.');
      }
    } catch {
      setPaymentNotice('We could not reach the server to confirm payment. It will be confirmed automatically shortly.');
    } finally {
      setVerifyingPayment(false);
      setPayProcessing(false);
    }
  }, [apiUrl]);

  /* ═══ Resume after returning from Stripe Checkout (card flow) ═══
     The card flow leaves this SPA entirely, so before redirecting we stash a
     small resume payload in sessionStorage. On return Stripe appends
     ?payment=success|cancelled&session_id=…; we rehydrate, jump back to the
     payment step, synchronously verify the session (so success no longer depends
     on the async webhook), then clean the URL. */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    if (payment !== 'success' && payment !== 'cancelled') return;

    // Everything below is genuinely a one-time (URL-param-gated) mount side
    // effect — reading/clearing sessionStorage, rewriting the URL, and
    // verifying the session — so it stays in an effect. It's nested in an
    // IIFE (same technique as the other effects in this pass) so none of its
    // setState calls are bare top-level statements in the effect body.
    (async () => {
      let resume = {};
      try { resume = JSON.parse(sessionStorage.getItem('ce_resume') || '{}'); } catch { resume = {}; }
      sessionStorage.removeItem('ce_resume');

      const resumedEventId = params.get('event') || resume.eventId || null;
      if (resumedEventId) setEventId(resumedEventId);
      if (resume.selectedTierName) setSelectedTierName(resume.selectedTierName);
      if (resume.slug) { slugManuallyEditedRef.current = true; setSlug(resume.slug); }

      // Land back on the Payment step (now index 1) where the user left off.
      setDirection(1);
      setStep(1);

      // Strip the payment params so a refresh doesn't re-run this.
      const clean = `${window.location.pathname}`;
      window.history.replaceState({}, '', clean);

      if (payment === 'cancelled') {
        setPaymentNotice('Payment was cancelled. You can try again or choose another method.');
        return;
      }

      const sessionId = params.get('session_id');
      if (!sessionId) {
        // No session to verify — fall back to a soft success notice; the webhook
        // remains the backstop that flips the event to paid.
        setPaymentNotice('Returned from checkout. If your payment went through, it will be confirmed shortly.');
        return;
      }

      setPendingSessionId(sessionId);
      await verifyPaymentSession(sessionId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl]);

  const handleRecheckPayment = useCallback(() => {
    if (pendingSessionId) verifyPaymentSession(pendingSessionId);
  }, [pendingSessionId, verifyPaymentSession]);

  /* ═══ The organizer's own clock ═══
     The preview converts the wizard's naive date fields exactly as the server
     will on save; without the right zone it would show the organizer a page
     their guests never get, which is the one failure the preview exists to
     prevent.

     Read from the context the dashboard layout already establishes, NOT
     fetched here. This page fetched /auth/profile for itself first, and that
     was a second request for a value the layout had already loaded on the same
     page load — the layout wraps the no-chrome routes too, precisely so the
     wizard and the seating map are not left to re-derive it. */
  const orgTimezone = useOrganizerTimeZone();

  /* ═══ Fetch platform pricing tiers (for the payment step) ═══ */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/payments/pricing-config`, { credentials: 'include' });
        const data = await res.json();
        if (!cancelled && data.success && data.config?.pricing_tiers) {
          setPricingTiers(data.config.pricing_tiers);
          // Default to the first billable tier (Contact-Sales tiers can't be paid
          // online), without clobbering a tier already restored from a post-Stripe resume.
          const firstBillable = data.config.pricing_tiers.find(t => t && t.is_custom !== true);
          if (firstBillable) setSelectedTierName(prev => prev || firstBillable.name);
          setManualMethods((data.config.manual_payment_methods || []).filter(m => m && m.is_active !== false));
          if (data.features) setFeatures(data.features);
          // For the SMS credit-buy button's price preview (Stage3_Distribution) —
          // that button previously redirected to Stripe Checkout with no price
          // shown at all, unlike every other paid action in this wizard.
          // The finished LIST PRICE per segment, not our cost and margin.
          // This screen only ever needed the public number; asking for the two
          // private ones to multiply them together meant the server had to
          // hand every organizer our carrier cost and our gross margin.
          if (Number.isFinite(data.config.sms_list_price_cents_per_segment)) {
            setSmsListPriceCents(data.config.sms_list_price_cents_per_segment);
          }
          // Per-tier allowance recommendations + the message-type catalogue, both
          // computed server-side so the estimate can never drift from the charge.
          if (data.smsEstimates) setSmsEstimates(data.smsEstimates);
          if (data.smsPricing?.volume_discounts) setSmsVolumeDiscounts(data.smsPricing.volume_discounts);
          if (data.featureLabels) setFeatureLabels(data.featureLabels);
          if (Array.isArray(data.hiddenTierFeatures)) setHiddenTierFeatures(data.hiddenTierFeatures);
          if (data.featureNotes) setFeatureNotes(data.featureNotes);
        }
      } catch { /* non-fatal — payment step shows a skip option */ }
    })();
    return () => { cancelled = true; };
  }, [apiUrl]);

  /* ═══ Seed the SMS allowance from the chosen plan ═══
     A bigger plan means more guests means more messages, so the recommendation
     has to follow the tier rather than sit at whatever the first one suggested.
     Re-seeds on every tier change — including back to a smaller plan, where
     leaving a larger number in place would quietly overcharge.

     Estimates are keyed by script; 'latin' is used because the event's language is
     a guest-facing choice made elsewhere. Arabic messages cost roughly double
     (UCS-2 caps a segment at 70 characters), which the card says plainly and the
     slider lets the organizer act on.

     Seeded DURING the render that changes the tier rather than in an effect
     after it, which is React's documented shape for "derived from a prop
     until the organizer moves the slider". Two things it buys: the card never
     paints one frame of the new plan next to the old plan's allowance, and
     the seed is now tied to the TIER — so a later change to `smsEstimates`
     cannot silently reset a number the organizer has since adjusted by hand. */
  const recommendedSegments = selectedTierName
    ? smsEstimates?.[selectedTierName]?.latin?.recommendedSegments
    : undefined;
  const [seededForTier, setSeededForTier] = useState(null);
  if (Number.isFinite(recommendedSegments) && seededForTier !== selectedTierName) {
    setSeededForTier(selectedTierName);
    setSmsAddonSegments(recommendedSegments);
  }

  /* ═══ Referral credit balance (preview-only — the backend is always the
     source of truth for what's actually charged; see StagePayment) ═══ */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/referrals/me`, { credentials: 'include' });
        const data = await res.json();
        if (!cancelled && data.success) setReferralCreditCents(data.creditBalanceCents || 0);
      } catch { /* non-fatal — the discount simply won't preview */ }
    })();
    return () => { cancelled = true; };
  }, [apiUrl]);

  /* ═══ Load paid status + current plan when entering the Payment step ═══
     Also re-runs when `paymentConfirmed` flips true — a successful UPGRADE
     verified above (line ~385) used to leave this stale: the "Current Plan"
     panel kept showing the pre-upgrade tier name/guest cap/price until the
     organizer left and re-entered this step, since this effect only ever
     depended on [step, eventId, apiUrl]. */
  useEffect(() => {
    // Payment is wizard step index 1 (Templates, Payment, Configure, …).
    if (step !== 1 || !eventId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/events/${eventId}`, { credentials: 'include' });
        const data = await res.json();
        const ev = data?.event;
        if (!cancelled && ev) {
          setEventIsPaid(!!ev.is_paid);
          setCurrentTierName(ev.tier_name || '');
          setCurrentTierMaxGuests(ev.tier_max_guests ?? null);
        }
      } catch { /* non-fatal — falls back to the tier picker */ }
    })();
    return () => { cancelled = true; };
  }, [step, eventId, apiUrl, paymentConfirmed]);

  /* ═══ Sync preset colors → customColors ═══
     Adjusted during render (like RsvpWizard's prevLangParam) rather than in an
     effect. customColors isn't pure derived state — it's also independently
     seeded when resuming a saved draft (see `ev.custom_colors` above) — so it
     needs a reset-on-change guard, not a plain useMemo/const. The guard's
     "previous" sentinel starts at null (not the current key) so the very
     first render still runs the sync, matching the original effect's
     guaranteed first run on mount. */
  const colorSyncKey = JSON.stringify([templateType, selectedPresets, customConfig]);
  const [prevColorSyncKey, setPrevColorSyncKey] = useState(null);
  if (colorSyncKey !== prevColorSyncKey) {
    setPrevColorSyncKey(colorSyncKey);
    if (templateType === 'custom') {
      setCustomColors({
        primary: customConfig.primary,
        secondary: customConfig.secondary,
        accent: customConfig.accent || customConfig.primary,
        background: customConfig.background,
      });
    } else {
      const tpl = TEMPLATES.find(t => t.key === templateType);
      if (tpl) {
        const presetIdx = selectedPresets[templateType] || 0;
        const preset = tpl.presets[presetIdx];
        if (preset) {
          setCustomColors({
            primary: preset.primary,
            secondary: preset.secondary,
            accent: preset.accent || preset.primary,
            background: preset.background,
          });
        }
      }
    }
  }

  /* ═══ Seed the URL from the title — ONLY until the organizer edits the URL ═══
     The title and the event URL are separate fields. We auto-fill a sensible slug
     from the title for convenience, but once the organizer hand-edits the URL
     (slugManuallyEditedRef) we never overwrite their choice again. */
  // slugManuallyEditedRef is a ref, and refs may only be read in effects/
  // event handlers (not during render — react-hooks/refs), so this stays an
  // effect. The setSlug call is wrapped in an IIFE (same technique as
  // elsewhere in this pass) so it isn't a bare top-level setState statement.
  useEffect(() => {
    if (slugManuallyEditedRef.current) return;
    if (!title) return;
    (async () => {
      const generated = title
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/[\s]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      setSlug(generated);
    })();
  }, [title]);

  /* The organizer edited the URL directly → decouple it from the title from now on. */
  const handleSlugChange = useCallback((value) => {
    slugManuallyEditedRef.current = true;
    setSlug(value);
  }, []);

  // Clear a stale status the instant the slug drops below the checkable
  // length — adjusted during render (like RsvpWizard's prevLangParam) rather
  // than in an effect. slugStatus isn't pure derived state (it's also set
  // directly by the submit handlers below on a "taken" response), so this is
  // a reset-on-change guard, keyed on `slug` to match the debounce effect's
  // own dependency below.
  const [prevSlugForStatus, setPrevSlugForStatus] = useState(slug);
  if (slug !== prevSlugForStatus) {
    setPrevSlugForStatus(slug);
    if (!slug || slug.length < 3) setSlugStatus(null);
  }

  /* ═══ Slug availability checker (debounced) ═══ */
  useEffect(() => {
    if (slugTimerRef.current) clearTimeout(slugTimerRef.current);
    if (!slug || slug.length < 3) return;
    // Wrapped in an IIFE (same technique as elsewhere in this pass) so this
    // isn't a bare top-level setState call — keeps the "checking" indicator
    // appearing immediately (same tick), same as before, ahead of the 500ms
    // debounced availability fetch below.
    (async () => { setSlugStatus('checking'); })();
    slugTimerRef.current = setTimeout(async () => {
      try {
        // Pass the current eventId so the backend can exclude the event's own slug
        // from the "taken" check when resuming a draft.
        const checkUrl = `${apiUrl}/public/events/${slug}${eventId ? `?exclude=${encodeURIComponent(eventId)}` : ''}`;
        const res = await fetch(checkUrl);
        if (res.status === 404) {
          setSlugStatus('available');
          setSuggestedSlug('');
        } else if (res.ok || res.status === 402 || res.status === 403) {
          // 200 (live), 402 (exists but unpaid), and 403 (exists but private) all mean
          // the slug is already in use — only a 404 means it's free.
          setSlugStatus('taken');
          const year = new Date().getFullYear();
          setSuggestedSlug(`${slug}-${year}`);
        } else {
          setSlugStatus('error');
        }
      } catch {
        setSlugStatus('error');
      }
    }, 500);
    return () => {
      if (slugTimerRef.current) clearTimeout(slugTimerRef.current);
    };
  }, [slug, apiUrl, eventId]);

  /* ═══ Derived values ═══ */
  const activeTemplate = TEMPLATES.find(t => t.key === templateType) || TEMPLATES[0];
  const activePresetIndex = selectedPresets[templateType] || 0;
  const activePresetColors = activeTemplate.presets[activePresetIndex];

  /* ═══ "What your guests will see" ═══
     The real guest renderer, fed this wizard's unsaved state. Built on demand
     rather than memoised: it is only read while the modal is open, and every
     field it maps is state this component already re-renders on. */
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewEvent = previewOpen ? buildPreviewEvent({
    templateType, title, description, eventDate, eventEndDate,
    locationName, locationAddress, locationLat, locationLng,
    dressCode, rsvpDeadline, coverImageUrl, galleryUrls,
    customColors, templateData, customConfig,
    allowGuestEdits, trackGuestSide, noKidsAllowed, collectDietaryRestrictions,
    customFields, slug,
    timeZone: orgTimezone,
  }) : null;

  /* ═══ Template selection handlers ═══ */
  const handleTemplateSelect = useCallback((key) => {
    setTemplateType(key);
    const keepKeys = new Set(TEMPLATE_TYPE_FIELD_KEYS[key] || []);
    const otherTypeKeys = new Set(Object.values(TEMPLATE_TYPE_FIELD_KEYS).flat());
    setTemplateData((d) => {
      const next = {};
      for (const [k, v] of Object.entries(d)) {
        if (!otherTypeKeys.has(k) || keepKeys.has(k)) next[k] = v;
      }
      return next;
    });
  }, []);

  const handlePresetSelect = useCallback((tplKey, presetIdx) => {
    setSelectedPresets(prev => ({ ...prev, [tplKey]: presetIdx }));
  }, []);

  /* ═══ Guided Custom builder updates ═══ */
  const handleCustomConfigChange = useCallback((patch) => {
    setCustomConfig(prev => ({
      ...prev,
      ...patch,
      sections: patch.sections ? { ...prev.sections, ...patch.sections } : prev.sections,
    }));
  }, []);

  /* ═══ Place selection handler ═══ */
  const handlePlaceSelect = useCallback((place) => {
    setLocationAddress(place.address);
    // Plain-address predictions (as opposed to named venues/businesses) have no
    // distinct `place.name` — it either comes back empty or identical to the
    // address. Previously that left the Venue field untouched (often still
    // showing whatever partial text the user was mid-typing), which looked like
    // the selection had only filled in the Address. Fall back to the first
    // segment of the address so Venue always reflects the picked place.
    setLocationName(place.name && place.name !== place.address
      ? place.name
      : (place.address ? place.address.split(',')[0] : ''));
    setLocationLat(place.lat);
    setLocationLng(place.lng);
    setLocationPlaceId(place.placeId);
  }, []);

  /* ═══ Distribution method toggle ═══ */
  const handleMethodToggle = useCallback((method) => {
    if (method === 'link') return; // link is always on
    setDistributionMethods(prev => ({ ...prev, [method]: !prev[method] }));
  }, []);

  /* ═══ Cover image upload (Supabase storage — no base64 fallback) ═══ */
  const handleCoverImageUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast.error('File exceeds 8MB. Please use a smaller file.');
      return;
    }
    setCoverImageUploading(true);
    try {
      if (!supabase) throw new Error('Storage client not configured.');
      const ext = file.name.split('.').pop();
      const filePath = `covers/wizard-${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('event-assets')
        .upload(filePath, file, { cacheControl: '3600', upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage.from('event-assets').getPublicUrl(filePath);
      setCoverImageUrl(publicUrl);
    } catch (err) {
      console.error('Cover image upload failed:', err);
      toast.error('Cover image upload failed. Please try again.');
    } finally {
      setCoverImageUploading(false);
    }
  }, []);

  /* Generic single-image upload that RETURNS the public URL (rather than
     writing a fixed template_data key) — used by list rows like Accommodation
     hotels so each row's photo becomes a real upload instead of a pasted URL.

     `folder` defaults to 'venues' because that is what every existing caller
     is, and it was HARDCODED until Sealed Letter's hero portrait started using
     this. That put a couple's photograph in `venues/` from the wizard while
     the very same field written from Event Details landed in `covers/` — one
     field, two folders, and one of them named after something else entirely. */
  const uploadRowImage = useCallback(async (file, folder = 'venues') => {
    if (!file) return null;
    if (file.size > 8 * 1024 * 1024) {
      toast.error('File exceeds 8MB. Please use a smaller file.');
      return null;
    }
    try {
      if (!supabase) throw new Error('Storage client not configured.');
      const ext = file.name.split('.').pop();
      const filePath = `${folder}/wizard-row-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('event-assets')
        .upload(filePath, file, { cacheControl: '3600', upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage.from('event-assets').getPublicUrl(filePath);
      return publicUrl;
    } catch (err) {
      console.error('Row image upload failed:', err);
      toast.error('Image upload failed. Please try again.');
      return null;
    }
  }, []);

  /* ═══ Background music upload (Supabase storage — no base64 fallback) ═══ */
  const handleMusicUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast.error('File exceeds 8MB. Please use a smaller file.');
      return;
    }
    setMusicUploading(true);
    try {
      if (!supabase) throw new Error('Storage client not configured.');
      const ext = file.name.split('.').pop();
      const filePath = `music/wizard-${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('event-assets')
        .upload(filePath, file, { cacheControl: '3600', upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage.from('event-assets').getPublicUrl(filePath);
      setBackgroundMusicUrl(publicUrl);
    } catch (err) {
      console.error('Music upload failed:', err);
      toast.error('Music upload failed. Please try again.');
    } finally {
      setMusicUploading(false);
    }
  }, []);

  /* ═══ Gallery image upload (Supabase storage — no base64 fallback) ═══ */
  const handleGalleryUpload = useCallback(async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setGalleryUploading(true);
    for (const file of files) {
      if (file.size > 8 * 1024 * 1024) {
        toast.error(`"${file.name}" exceeds 8MB and was skipped.`);
        continue;
      }
      try {
        if (!supabase) throw new Error('Storage client not configured.');
        const ext = file.name.split('.').pop();
        const filePath = `gallery/wizard-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('event-assets')
          .upload(filePath, file, { cacheControl: '3600', upsert: true });
        if (uploadErr) throw uploadErr;
        const { data: { publicUrl } } = supabase.storage.from('event-assets').getPublicUrl(filePath);
        setGalleryUrls(prev => [...prev, publicUrl]);
      } catch (err) {
        console.error('Gallery upload failed:', err);
        toast.error(`"${file.name}" could not be uploaded. Please try again.`);
      }
    }
    setGalleryUploading(false);
  }, []);

  const removeGalleryUrl = useCallback((index) => {
    setGalleryUrls(prev => prev.filter((_, i) => i !== index));
  }, []);

  /* ═══ Step navigation ═══ */
  const goNext = useCallback(() => {
    setDirection(1);
    setStep(prev => Math.min(prev + 1, LAST_STEP));
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const goBack = useCallback(() => {
    setDirection(-1);
    setStep(prev => Math.max(prev - 1, 0));
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const goToStep = useCallback((targetStep) => {
    if (targetStep < step) {
      setDirection(-1);
      setStep(targetStep);
      setError('');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [step]);

  /* ═══ Template data, with the Custom builder design folded in ═══ */
  const buildTemplateData = useCallback(() => {
    const merged = templateType === 'custom'
      ? { ...templateData, customDesign: customConfig }
      : { ...templateData };
    // Meal options are edited as chips (an array); coerce any legacy
    // comma-separated string (e.g. from a draft made before the switch) so the
    // stored shape stays consistently an array.
    if ('ha_meal_options' in merged) merged.ha_meal_options = toTagArray(merged.ha_meal_options);
    return Object.keys(merged).length > 0 ? merged : undefined;
  }, [templateType, templateData, customConfig]);

  /* ═══ Safety-net: strip any accidental base64 data URIs so they never
     reach the API payload (prevents 413 / oversized JSON crashes) ═══ */
  const sanitizeUrl = useCallback((url) => {
    if (typeof url === 'string' && url.startsWith('data:')) return '';
    return url;
  }, []);

  /* ═══ Build the create (camelCase) payload from current state ═══ */
  const buildCreatePayload = useCallback(() => ({
    slug,
    templateType,
    title,
    description: description || undefined,
    eventDate,
    eventEndDate: eventEndDate || undefined,
    locationName: locationName || undefined,
    locationAddress: locationAddress || undefined,
    locationLat: locationLat || undefined,
    locationLng: locationLng || undefined,
    locationPlaceId: locationPlaceId || undefined,
    dressCode: dressCode || undefined,
    rsvpDeadline: rsvpDeadline || undefined,
    privacyMode,
    // Blank while still in 'password' mode means "keep the existing password"
    // (the field always starts blank — the server never sends the hash back —
    // so treating blank as "clear it" would wipe an already-configured
    // password the moment the organizer touched any other field).
    accessPassword: privacyMode === 'password' ? (accessPassword.trim() || undefined) : undefined,
    coverImageUrl: sanitizeUrl(coverImageUrl) || undefined,
    galleryUrls: galleryUrls.length > 0 ? galleryUrls.filter(u => !u.startsWith('data:')) : undefined,
    customColors,
    templateData: buildTemplateData(),
    // The curated wedding variants are not distinct event categories — every
    // event_type-gated behavior elsewhere (Groom's/Bride's Side labels, meal
    // selection, guest-side tracking) treats them as one. Swan Lake resolves
    // to whichever occasion the organizer picked. See deriveEventType.
    eventType: deriveEventType(templateType, buildTemplateData()),
    backgroundMusicUrl: sanitizeUrl(backgroundMusicUrl) || '',
    notificationPreferences: { email: notificationEmail, whatsapp: false },
    allowGuestEdits,
    trackGuestSide,
    noKidsAllowed,
    collectDietaryRestrictions,
  }), [
    slug, templateType, title, description, eventDate, eventEndDate,
    locationName, locationAddress, locationLat, locationLng, locationPlaceId,
    dressCode, rsvpDeadline, privacyMode, accessPassword, coverImageUrl,
    galleryUrls, customColors, buildTemplateData, backgroundMusicUrl, sanitizeUrl,
    notificationEmail, allowGuestEdits, trackGuestSide, noKidsAllowed, collectDietaryRestrictions,
  ]);

  /* ═══ Create the draft event (first time) or update it (on revisits) ═══ */
  const ensureDraftEvent = useCallback(async () => {
    // Returns the eventId. Creates a draft if none exists yet, otherwise PATCHes it.
    if (!eventId) {
      const res = await fetch(`${apiUrl}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(buildCreatePayload()),
      });
      const data = res.status === 413 ? {} : await res.json();
      if (!res.ok) {
        if (res.status === 413) {
          throw new Error('Your media files are too large to save. Please use smaller images or a shorter audio file.');
        }
        if (data.error === 'SLUG_TAKEN') {
          setSlugStatus('taken');
          setSuggestedSlug(data.suggestedSlug || `${slug}-${new Date().getFullYear()}`);
          const e = new Error('This event URL is already taken. Please choose a different slug.');
          e.code = 'SLUG_TAKEN';
          throw e;
        }
        throw new Error(data.message || 'Failed to create event.');
      }
      setEventId(data.event.id);
      return data.event.id;
    }

    // Existing draft → push the latest details (PATCH uses snake_case fields).
    const res = await fetch(`${apiUrl}/events/${eventId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        slug,
        template_type: templateType,
        title,
        description: description || null,
        event_date: eventDate,
        event_end_date: eventEndDate || null,
        location_name: locationName || null,
        location_address: locationAddress || null,
        location_lat: locationLat || null,
        location_lng: locationLng || null,
        location_place_id: locationPlaceId || null,
        dress_code: dressCode || null,
        rsvp_deadline: rsvpDeadline || null,
        privacy_mode: privacyMode,
        // Blank while still in 'password' mode → omit the key (JSON.stringify
        // drops undefined-valued properties) so the backend leaves the existing
        // password untouched; switching away from 'password' mode explicitly
        // clears it, matching the original behavior.
        access_password: privacyMode === 'password' ? (accessPassword.trim() || undefined) : null,
        cover_image_url: coverImageUrl || null,
        gallery_urls: galleryUrls,
        background_music_url: backgroundMusicUrl || null,
        custom_colors: customColors,
        template_data: buildTemplateData() || {},
        event_type: deriveEventType(templateType, buildTemplateData()),
        notification_preferences: { email: notificationEmail, whatsapp: false },
        allow_guest_edits: allowGuestEdits,
        track_guest_side: trackGuestSide,
        no_kids_allowed: noKidsAllowed,
        collect_dietary_restrictions: collectDietaryRestrictions,
      }),
    });
    const data = res.status === 413 ? {} : await res.json();
    if (!res.ok) {
      if (res.status === 413) {
        throw new Error('Your media files are too large to save. Please use smaller images or a shorter audio file.');
      }
      if (data.error === 'SLUG_TAKEN') {
        setSlugStatus('taken');
        const e = new Error('This event URL is already taken. Please choose a different slug.');
        e.code = 'SLUG_TAKEN';
        throw e;
      }
      throw new Error(data.message || 'Failed to update event.');
    }
    return eventId;
  }, [
    eventId, apiUrl, buildCreatePayload, slug, templateType, title, description,
    eventDate, eventEndDate, locationName, locationAddress, locationLat, locationLng,
    locationPlaceId, dressCode, rsvpDeadline, privacyMode, accessPassword,
    coverImageUrl, galleryUrls, customColors, buildTemplateData, backgroundMusicUrl,
    notificationEmail, allowGuestEdits, trackGuestSide, noKidsAllowed, collectDietaryRestrictions,
  ]);

  /* ═══ Advance from Templates → create the placeholder draft, then go to Payment ═══
     Only templateType is known at this point; ensureDraftEvent's create branch
     happily accepts the empty title/slug/eventDate (the backend defaults them) —
     this just reserves an eventId so Stripe checkout has something to attach to.
     The One-Page Form (Configure) PATCHes this same event with the real details
     once payment is confirmed. */
  const handleTemplateNext = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await ensureDraftEvent();
      goNext();
    } catch (err) {
      setError(err.message || 'Could not start your event. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [submitting, ensureDraftEvent, goNext]);

  /* ═══ Advance from Configure (One-Page Form) → save details, then go to Tables ═══
     By this point the event already exists and is paid (Payment now gates entry
     to this step) — ensureDraftEvent's PATCH branch persists the real details. */
  const handleConfigureNext = useCallback(async () => {
    if (submitting) return;
    if (!title || !slug || !eventDate) {
      setError('Please complete the title, URL, and date before continuing.');
      return;
    }
    if (slugStatus === 'taken') {
      setError('Please choose an available event URL.');
      return;
    }
    // Catch backwards dates before the round-trip — the server would reject
    // these with a 400 anyway, but a local check gives the organizer an instant
    // toast instead of a silent failed request.
    const dateError = getDateOrderError(eventDate, eventEndDate, rsvpDeadline);
    if (dateError) {
      setError(dateError);
      return;
    }
    // Guard: block navigation while any media upload is still in flight, so the
    // organizer can't advance before the file lands in storage (and the upload's
    // own state update doesn't race with ensureDraftEvent's payload below).
    if (musicUploading || coverImageUploading || galleryUploading) {
      setError('Please wait for your file uploads to finish before continuing.');
      return;
    }
    // Guard: warn the organizer early if any media is still a base64 data URI
    // (upload failed silently or Supabase was unreachable). They won't be sent
    // to the API, so the event would lose those assets.
    const hasBase64Media =
      (coverImageUrl && coverImageUrl.startsWith('data:')) ||
      (backgroundMusicUrl && backgroundMusicUrl.startsWith('data:')) ||
      galleryUrls.some(u => u.startsWith('data:'));
    if (hasBase64Media) {
      setError('Some uploaded files could not be saved to storage. Please re-upload them before continuing.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await ensureDraftEvent();
      goNext();
    } catch (err) {
      if (err.code === 'SLUG_TAKEN') {
        setError('This event URL is already taken. Please choose a different slug.');
      } else if (err.message && err.message.includes('too large')) {
        setError('Your event data is too large to save. Please use smaller images for your media.');
      } else {
        setError(err.message || 'Could not save your event. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }, [submitting, title, slug, eventDate, eventEndDate, rsvpDeadline, slugStatus, musicUploading, coverImageUploading, galleryUploading, coverImageUrl, backgroundMusicUrl, galleryUrls, ensureDraftEvent, goNext]);

  /* ═══ Save the event as a draft and exit to the dashboard Drafts section ═══
     Persists everything entered so far (creates the draft if needed, else PATCHes)
     so the organizer can leave and resume later from Dashboard → Drafts. */
  const handleSaveDraft = useCallback(async () => {
    if (savingDraft || submitting) return;
    if (!title || !slug || !eventDate) {
      setError('Add a title, URL and date before saving a draft.');
      return;
    }
    if (slugStatus === 'taken') {
      setError('Please choose an available event URL.');
      return;
    }
    const dateError = getDateOrderError(eventDate, eventEndDate, rsvpDeadline);
    if (dateError) {
      setError(dateError);
      return;
    }
    setSavingDraft(true);
    setError('');
    try {
      await ensureDraftEvent();
      if (typeof window !== 'undefined') {
        window.location.href = '/dashboard?tab=drafts&saved=draft';
      }
    } catch (err) {
      if (err.code === 'SLUG_TAKEN') setError('This event URL is already taken. Please choose a different slug.');
      else setError(err.message || 'Could not save your draft. Please try again.');
      setSavingDraft(false);
    }
  }, [savingDraft, submitting, title, slug, eventDate, eventEndDate, rsvpDeadline, slugStatus, ensureDraftEvent]);

  /* ═══ Payment handlers ═══ */
  const handlePayStripe = useCallback(async () => {
    // Re-entrancy guard: relying solely on the button's `disabled` attribute
    // left a window for a fast double-click (before React re-renders) to fire
    // two POSTs to create-checkout — risking two Stripe sessions. Mirrors the
    // explicit guard already in handleBuyCredits below.
    if (!eventId || !selectedTierName || payProcessing) return;
    setPayProcessing(true);
    setPayError('');
    try {
      const res = await fetch(`${apiUrl}/payments/events/${eventId}/create-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        // The SMS add-on rides on the SAME checkout as the licence — one payment,
        // two line items. null when the organizer left it switched off.
        body: JSON.stringify({
          eventId,
          tierKey: selectedTierKey,
          tierName: selectedTierName,
          smsAddonSegments: smsAddonEnabled ? smsAddonSegments : null,
        }),
      });
      const data = await res.json();
      if (!res.ok || (!data.checkoutUrl && !data.activated)) throw new Error(data.message || 'Could not start checkout.');

      // A free ($0) tier is activated synchronously server-side — no Stripe
      // round-trip needed, so just show the success state directly. It can still
      // return a checkoutUrl when the SMS add-on was requested: the plan is free,
      // the messaging is not, so that purchase still has to be completed.
      if (data.activated && !data.checkoutUrl) {
        setPaymentConfirmed(true);
        setPaymentNotice(data.message || 'Your plan is now active.');
        setPayProcessing(false);
        return;
      }

      // The card flow leaves the SPA — stash just enough to resume the wizard on
      // return (the full event draft already lives server-side from the Configure
      // step). See the resume effect above.
      try {
        sessionStorage.setItem('ce_resume', JSON.stringify({ eventId, selectedTierName, slug }));
      } catch { /* sessionStorage unavailable — resume still works via ?event= */ }
      window.location.href = data.checkoutUrl; // redirect to Stripe
    } catch (err) {
      setPayError(err.message || 'Payment could not be started.');
      setPayProcessing(false);
    }
  }, [apiUrl, eventId, selectedTierName, selectedTierKey, slug, payProcessing, smsAddonEnabled, smsAddonSegments]);

  const handlePayManual = useCallback(async (methodLabel = '', payerReference = '') => {
    // Same re-entrancy guard as handlePayStripe above.
    if (!eventId || !selectedTierName || payProcessing) return;
    setPayProcessing(true);
    setPayError('');
    try {
      const res = await fetch(`${apiUrl}/payments/events/${eventId}/manual-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        // The add-on rides on the bank transfer too — the amount the organizer is
        // told to send must cover everything they chose, not the licence alone.
        body: JSON.stringify({
          tierKey: selectedTierKey,
          tierName: selectedTierName,
          methodLabel,
          payerReference,
          smsAddonSegments: smsAddonEnabled ? smsAddonSegments : null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Could not record manual payment.');

      // Referral credit covered the whole fee — the server activated the event
      // outright, so there is no transfer to make and no reference code to show.
      if (data.activated) {
        setPaymentConfirmed(true);
        setEventIsPaid(true);
        setPaymentNotice(data.message || 'Your plan is now active.');
        return;
      }

      setManualRef(data.referenceNumber);
    } catch (err) {
      setPayError(err.message || 'Manual payment could not be recorded.');
    } finally {
      setPayProcessing(false);
    }
  }, [apiUrl, eventId, selectedTierName, selectedTierKey, payProcessing, smsAddonEnabled, smsAddonSegments]);

  // Self-service alternative to both payment paths above: a valid super-admin
  // -issued promo code publishes the event immediately, free — same end
  // state as a successful payment (isPaid/currentTierName/paymentConfirmed),
  // just without a Stripe/manual round trip. Returns { ok, message } instead
  // of throwing so StagePayment's inline redeem box can show the result
  // without a top-level page error banner.
  const handleRedeemPromoCode = useCallback(async (code) => {
    if (!eventId) return { ok: false, message: 'Event not ready yet — please try again in a moment.' };
    try {
      const res = await fetch(`${apiUrl}/payments/events/${eventId}/redeem-promo-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { ok: false, message: data.message || 'That promo code could not be redeemed.' };
      }
      setEventIsPaid(true);
      setCurrentTierName(data.event?.tier_name || '');
      setCurrentTierMaxGuests(data.event?.tier_max_guests ?? null);
      setPaymentConfirmed(true);
      setPaymentNotice(data.message || 'Your event is now live!');
      setManualRef('');
      return { ok: true, message: data.message || 'Your event is now live!' };
    } catch (err) {
      return { ok: false, message: err.message || 'That promo code could not be redeemed.' };
    }
  }, [apiUrl, eventId]);

  /* ═══ SMS credit balance + top-up (distribution step) ═══ */
  const fetchSmsCredits = useCallback(async () => {
    if (!eventId) return;
    setSmsCreditsLoading(true);
    try {
      const res = await fetch(`${apiUrl}/events/${eventId}/campaigns/history`, { credentials: 'include' });
      const data = await res.json();
      if (data.success) setSmsCredits(data.wallet?.credits_remaining ?? 0);
    } catch { /* leave previous value */ }
    finally { setSmsCreditsLoading(false); }
  }, [apiUrl, eventId]);

  // Refresh the balance whenever the user returns to this tab (e.g. after finishing
  // the credit purchase in the Stripe tab we opened) so the count stays live without
  // leaving the wizard. Initial load happens on navigation (goToDistribution).
  useEffect(() => {
    if (step !== LAST_STEP || !eventId) return;
    const onFocus = () => fetchSmsCredits();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [step, eventId, fetchSmsCredits]);

  // Advance from the tables step into distribution and prime the credit balance.
  const goToDistribution = useCallback(() => {
    goNext();
    fetchSmsCredits();
  }, [goNext, fetchSmsCredits]);

  const handleBuyCredits = useCallback(async (creditCount) => {
    if (!eventId || buyingCredits) return;
    // SMS credit top-ups run through Stripe Checkout — unavailable while card
    // payments are off. Bail with a clear message instead of a failed redirect.
    if (!features.smsEnabled) {
      setCreditError('SMS credit top-ups are temporarily unavailable.');
      return;
    }
    setCreditError('');
    setBuyingCredits(true);
    try {
      // Shared with the campaigns page so both top-up entry points behave the same.
      await startSmsCreditPurchase({ apiUrl, eventId, creditCount });
    } catch (err) {
      setCreditError(err.message || 'Credit purchase could not be started.');
    } finally {
      setBuyingCredits(false);
    }
  }, [apiUrl, eventId, buyingCredits, features.smsEnabled]);

  /* ═══ FINAL SUBMISSION ═══ */
  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    if (!title || !slug || !eventDate) {
      setError('Please complete all required fields before creating.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      /* ─── 1. Ensure the event exists (it normally does from the Configure step) ─── */
      let id = eventId;
      if (!id) {
        try {
          id = await ensureDraftEvent();
        } catch (err) {
          if (err.code === 'SLUG_TAKEN') {
            setDirection(-1);
            setStep(2);
            setError('This event URL is already taken. Please choose a different slug.');
            setSubmitting(false);
            return;
          }
          throw err;
        }
      }

      /* ─── 2. Sync custom form fields: create new ones, PATCH edited ones, ───
             ─── DELETE ones removed since resuming a draft ───────────────── */
      if (id) {
        const originalById = new Map(originalFieldsRef.current.map((f) => [f.id, f]));
        const currentSavedIds = new Set(customFields.filter((f) => f.savedToServer).map((f) => f.id));

        const newFields = customFields.filter((field) => !field.savedToServer);
        const editedFields = customFields.filter((field) => {
          if (!field.savedToServer) return false;
          const orig = originalById.get(field.id);
          if (!orig) return false;
          return (
            orig.label !== field.label ||
            orig.type !== field.type ||
            !!orig.isRequired !== !!field.isRequired ||
            JSON.stringify(orig.options || []) !== JSON.stringify(field.options || [])
          );
        });
        const deletedFieldIds = originalFieldsRef.current
          .map((f) => f.id)
          .filter((fid) => !currentSavedIds.has(fid));

        const failedLabels = [];

        const createPromises = newFields.map((field, idx) =>
          fetch(`${apiUrl}/events/${id}/fields`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              fieldKey: field.key,
              fieldLabel: field.label,
              fieldType: field.type,
              options: field.options || [],
              isRequired: field.isRequired,
              sortOrder: idx,
              // Trust the explicit flag the builder attaches (true only when the
              // organizer used the "Add Meal Options" shortcut) — previously this
              // re-derived the flag from key/type, so manually typing a label
              // that happened to slug to a reserved meal key silently became
              // the real meal field instead of getting the builder's
              // "reserved key" rejection.
              isMealField: !!field.isMealField,
              condition: field.condition || 'attending',
            }),
          }).then((res) => {
            if (!res.ok) failedLabels.push(field.label);
          }).catch(() => {
            failedLabels.push(field.label);
          })
        );

        const updatePromises = editedFields.map((field) =>
          fetch(`${apiUrl}/events/${id}/fields/${field.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              fieldLabel: field.label,
              fieldType: field.type,
              options: field.options || [],
              isRequired: field.isRequired,
              condition: field.condition || 'attending',
            }),
          }).then((res) => {
            if (!res.ok) failedLabels.push(field.label);
          }).catch(() => {
            failedLabels.push(field.label);
          })
        );

        const deletePromises = deletedFieldIds.map((fieldId) =>
          fetch(`${apiUrl}/events/${id}/fields/${fieldId}`, {
            method: 'DELETE',
            credentials: 'include',
          }).then((res) => {
            if (!res.ok) failedLabels.push('a removed question');
          }).catch(() => {
            failedLabels.push('a removed question');
          })
        );

        await Promise.allSettled([...createPromises, ...updatePromises, ...deletePromises]);

        if (failedLabels.length > 0) {
          setError(`These custom questions could not be saved: ${failedLabels.join(', ')}. Please try again before leaving this page.`);
          setSubmitting(false);
          return;
        }
      }

      /* ─── 3. Success → redirect to dashboard ─── */
      window.location.href = '/dashboard';

    } catch (err) {
      console.error('Event finalization failed:', err);
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [submitting, title, slug, eventDate, eventId, ensureDraftEvent, customFields, apiUrl]);

  /* ═══ Loading state ═══ */
  if (!mounted) {
    return (
      <div style={{
        minHeight: '100vh', background: '#FAF8F5',
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          width: 40, height: 40,
          border: `3px solid rgba(184,148,79,0.2)`,
          borderTopColor: C.gold,
          borderRadius: '50%',
          animation: 'ce-spin 0.6s linear infinite',
        }} />
        <style jsx>{`@keyframes ce-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  /* ═══ RENDER ═══ */
  return (
    <WizardShell step={step} onStepClick={goToStep} labels={WIZARD_LABELS}>
      <AnimatePresence mode="wait" custom={direction}>
        {step === 0 && (
          <motion.div
            key="stage1"
            custom={direction}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <Stage1_TemplatesSimulator
              templates={TEMPLATES}
              templateType={templateType}
              onTemplateSelect={handleTemplateSelect}
              selectedPresets={selectedPresets}
              onPresetSelect={handlePresetSelect}
              activePresetColors={activePresetColors}
              customConfig={customConfig}
              onCustomConfigChange={handleCustomConfigChange}
              onNext={handleTemplateNext}
              onPreview={() => setPreviewOpen(true)}
            />
          </motion.div>
        )}

        {step === 1 && (
          <motion.div
            key="stagePayment"
            custom={direction}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <StagePayment
              tiers={pricingTiers}
              manualMethods={manualMethods}
              selectedTierName={selectedTierName}
              onSelectTier={setSelectedTierName}
              onPayStripe={handlePayStripe}
              onPayManual={handlePayManual}
              manualRef={manualRef}
              /* SMS add-on — bought here, on the screen where the plan is chosen
                 and the payment happens. */
              smsAddonEnabled={smsAddonEnabled}
              onToggleSmsAddon={setSmsAddonEnabled}
              smsAddonSegments={smsAddonSegments}
              onChangeSmsAddonSegments={setSmsAddonSegments}
              smsEstimate={smsEstimates?.[selectedTierName]?.latin || null}
              smsVolumeDiscounts={smsVolumeDiscounts}
              featureLabels={featureLabels}
              hiddenTierFeatures={hiddenTierFeatures}
              featureNotes={featureNotes}
              smsListPriceCents={smsListPriceCents}
              processing={payProcessing}
              error={payError}
              paymentConfirmed={paymentConfirmed}
              paymentNotice={paymentNotice}
              verifying={verifyingPayment}
              onRecheckPayment={pendingSessionId ? handleRecheckPayment : undefined}
              onContinue={goNext}
              onBack={goBack}
              isPaid={eventIsPaid}
              currentTierName={currentTierName}
              currentTierMaxGuests={currentTierMaxGuests}
              stripeEnabled={features.stripeEnabled}
              referralCreditCents={referralCreditCents}
              onRedeemPromoCode={handleRedeemPromoCode}
            />
          </motion.div>
        )}

        {step === 2 && (
          <motion.div
            key="stage2"
            custom={direction}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <Stage2_FormConfiguration
              templateType={templateType}
              templates={TEMPLATES}
              customColors={customColors} setCustomColors={setCustomColors}
              title={title} setTitle={setTitle}
              slug={slug} setSlug={handleSlugChange}
              slugStatus={slugStatus}
              suggestedSlug={suggestedSlug}
              description={description} setDescription={setDescription}
              eventDate={eventDate} setEventDate={setEventDate}
              eventEndDate={eventEndDate} setEventEndDate={setEventEndDate}
              locationName={locationName} setLocationName={setLocationName}
              locationAddress={locationAddress} setLocationAddress={setLocationAddress}
              onPlaceSelect={handlePlaceSelect}
              templateData={templateData} setTemplateData={setTemplateData}
              onRowImageUpload={uploadRowImage}
              dressCode={dressCode} setDressCode={setDressCode}
              rsvpDeadline={rsvpDeadline} setRsvpDeadline={setRsvpDeadline}
              privacyMode={privacyMode} setPrivacyMode={setPrivacyMode}
              accessPassword={accessPassword} setAccessPassword={setAccessPassword} hasAccessPassword={hasAccessPassword}
              notificationEmail={notificationEmail} setNotificationEmail={setNotificationEmail}
              allowGuestEdits={allowGuestEdits} setAllowGuestEdits={setAllowGuestEdits}
              trackGuestSide={trackGuestSide} setTrackGuestSide={setTrackGuestSide}
              noKidsAllowed={noKidsAllowed} setNoKidsAllowed={setNoKidsAllowed}
              collectDietaryRestrictions={collectDietaryRestrictions} setCollectDietaryRestrictions={setCollectDietaryRestrictions}
              coverImageUrl={coverImageUrl} setCoverImageUrl={setCoverImageUrl}
              onCoverImageUpload={handleCoverImageUpload} coverImageUploading={coverImageUploading}
              backgroundMusicUrl={backgroundMusicUrl} setBackgroundMusicUrl={setBackgroundMusicUrl}
              onMusicUpload={handleMusicUpload} musicUploading={musicUploading}
              galleryUrls={galleryUrls} onGalleryUpload={handleGalleryUpload}
              galleryUploading={galleryUploading} onRemoveGalleryUrl={removeGalleryUrl}
              customFields={customFields} onFieldsChange={setCustomFields}
              onNext={handleConfigureNext} onBack={goBack}
              onSaveDraft={handleSaveDraft} savingDraft={savingDraft}
              onPreview={() => setPreviewOpen(true)}
            />
          </motion.div>
        )}

        {step === 3 && (
          <motion.div
            key="stageTables"
            custom={direction}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <StageTables
              apiUrl={apiUrl}
              eventId={eventId}
              onContinue={goToDistribution}
              onBack={goBack}
            />
          </motion.div>
        )}

        {step === 4 && (
          <motion.div
            key="stage3"
            custom={direction}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <Stage3_Distribution
              slug={slug}
              distributionMethods={distributionMethods}
              onMethodToggle={handleMethodToggle}
              smsTemplate={smsTemplate}
              setSmsTemplate={setSmsTemplate}
              smsCredits={smsCredits}
              smsCreditsLoading={smsCreditsLoading}
              onRefreshCredits={fetchSmsCredits}
              onBuyCredits={handleBuyCredits}
              buyingCredits={buyingCredits}
              creditError={creditError}
              smsEnabled={features.smsEnabled}
              smsListPriceCents={smsListPriceCents}
              onSubmit={handleSubmit}
              onBack={goBack}
              submitting={submitting}
              error={error}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {previewOpen && previewEvent && (
        <PreviewModal
          event={previewEvent}
          // The same card artwork the guest page picks for this template — it
          // is what "Save the invitation" captures inside the hero.
          invitationPattern={TEMPLATE_PREVIEW_PATTERN[templateType] || 'serif'}
          invitationTheme={{
            primary: customColors.primary || activePresetColors?.primary,
            secondary: customColors.secondary || activePresetColors?.secondary,
          }}
          // Step 0 is the template picker: nothing has been typed yet, so the
          // sections fill with sample content. From Configure onward it is
          // their own page, empty sections and all.
          showSampleContent={step === 0}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </WizardShell>
  );
}
