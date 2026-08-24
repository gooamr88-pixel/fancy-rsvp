'use client';
import { toast } from '../../utils/toast';
import { instantToWallClock, formatInZone } from '../../utils/timezone';

import React, { useCallback, useEffect, useState } from 'react';
import PlacesAutocomplete from '../../components/PlacesAutocomplete';
import FontPicker from './FontPicker';
import { supabase } from '../../utils/supabaseClient';
import { extractYouTubeId, checkYouTubeEmbeddable } from '../../utils/youtube';
import RepeatableListEditor from './RepeatableListEditor';
import ConfirmGuestNotifyModal from './ConfirmGuestNotifyModal';
import Icon from '../../components/icons/Icon';
import TagListEditor, { toTagArray } from './TagListEditor';
import InvitationReveal, { REVEAL_TONES } from '../../components/guest/InvitationReveal';
import VelvetBoxOpening from '../../components/guest/openings/VelvetBoxOpening';
import KnockDoorOpening from '../../components/guest/openings/KnockDoorOpening';
import WaxEnvelopeOpening from '../../components/guest/openings/WaxEnvelopeOpening';
import SealedLetterOpening from '../../components/guest/openings/SealedLetterOpening';
import { getCinematicOccasion } from '../../components/templates/cinematic/cinematicThemes';
import { preloadRevealAssets } from '../../components/guest/revealAssets';
import ImageUploadField from './ImageUploadField';
import DaysEditor from '../create-event/components/DaysEditor';
import CustomBuilder from '../create-event/components/CustomBuilder';
import SectionsOrderEditor from '../create-event/components/SectionsOrderEditor';
import { getHaDays } from '../../utils/haDays';
import { TEMPLATES, palettesFor, matchPaletteIndex } from '../../utils/curatedTemplates';
import { getTemplateOpening } from '../../utils/templateOpening';
import { buildPalette } from '../../components/templates/heritageArch/theme';
import TemplateCard from '../create-event/components/TemplateCard';
import PreviewFrame from '../../components/templates/PreviewFrame';
import { CUSTOM_CATEGORY_BY_KEY } from '../../utils/customEventCategories';
import { resolveOccasion, occasionPolicyFor } from '../../utils/eventOccasion';
import OccasionPicker from '../../components/OccasionPicker';
import LetterPortraitFields from '../../components/LetterPortraitFields';

const COLORS = {
  gold: '#B8944F', goldHover: '#a6833f', charcoal: '#191B1E', ivory: '#F8F4EC',
  champagne: '#D7BE80', stone: '#77736A', border: '#E8E2D6', white: '#FFFFFF', softBg: '#FAFAF8',
};

/* The opening a cinematic template mounts, keyed by `cinematic.opening`.
   See the note on CINEMATIC_OPENINGS in [slug]/EventPageClient.js — a ternary
   here previewed Door of Joy for every template that was not Velvet Ring. */
const CINEMATIC_OPENINGS = {
  velvetBox: VelvetBoxOpening,
  knockDoor: KnockDoorOpening,
  waxEnvelope: WaxEnvelopeOpening,
  sealedLetter: SealedLetterOpening,
};


// Templates rendered as the full-page snap-scroll guest experience — the
// wedding-style templates, engagement and custom (corporate/birthday/gala
// keep the continuous-scroll layout and their own content fields).
// Keep in sync with FULL_PAGE_TEMPLATES in [slug]/EventPageClient.js and
// FULL_PAGE_TEMPLATE_KEYS in create-event/components/Stage2_FormConfiguration.js
// ('custom' was previously missing here, so a custom-template event's
// full-page content — Our Story, Days/Venues, Accommodation, FAQ, etc. —
// never showed an edit surface after creation).
const FULL_PAGE_TEMPLATE_KEYS = [
  'wedding', 'tuscany', 'marrakesh', 'kyoto', 'nordic', 'havana',
  'estate', 'roseAtelier', 'orchid', 'clay', 'alpine', 'coastal', 'heritageArch',
  'engagement', 'custom',
  // The cinematic templates — same full-page sections, different opening and hero.
  'ring', 'bab', 'swans',
];
const isFullPage = (t) => FULL_PAGE_TEMPLATE_KEYS.includes(t);

/* No WEDDING_STYLE_TEMPLATE_KEYS here any more. It existed to answer "does
   this template use the couple fields?", which is now the occasion's `kind`,
   and the per-template wedding fallback it also served moved into the one
   shared resolver — see utils/eventOccasion.js. */

const DRESS_CODES = ['', 'Black Tie', 'Cocktail Attire', 'Semi-Formal', 'Business Casual', 'Smart Casual', 'Casual', 'Festive', 'Traditional'];

// Matches PRIVACY_MODES in create-event/components/Stage2_FormConfiguration.js
// — same three link types, same labels, so the concept never has to be
// relearned between creating an event and editing it afterward.
const PRIVACY_MODES = [
  { key: 'public', label: 'Public Link', icon: 'globe', desc: 'Anyone with the link can RSVP' },
  { key: 'private', label: 'Private', icon: 'lock', desc: 'Guests must be on your list' },
  { key: 'password', label: 'Passcode', icon: 'lockKey', desc: 'Requires a passcode to access' },
];

const DEFAULT_CUSTOM_DESIGN = { headingFont: 'serif', primary: '#B8944F', secondary: '#D7BE80', accent: '#B8944F', background: '#FFFDF7' };

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const TABS = [
  { key: 'details', label: 'Details', icon: 'calendar' },
  { key: 'design', label: 'Design & Template', icon: 'palette' },
  { key: 'content', label: 'Content & Sections', icon: 'book' },
  { key: 'guest', label: 'Guest Experience', icon: 'guests' },
  { key: 'status', label: 'Status & Danger Zone', icon: 'gear' },
];

// Event dates are real instants now, so prefilling this form means rendering
// each one on the EVENT's clock — not the browser's, and no longer by reading
// the raw UTC digits back.
//
// Reading UTC digits was correct while the stored value WAS those digits. It
// is now actively destructive: the stored instant for a 6:30pm San Diego event
// is 01:30 the next day in UTC, so the old helper would prefill the field with
// tomorrow at 1:30am. The organizer sees a time they never set, and saving
// writes it back — moving the event further on every visit.
//
// `instantToWallClock` is the exact inverse of the conversion the server
// applies on save, which is what makes open → save a no-op instead of a drift.
function toLocalDatetimeString(dateStr, timeZone) {
  return instantToWallClock(dateStr, timeZone);
}

/* A draft/pending_review event (already-created, revisited from the dashboard
   — as opposed to StagePayment's create-event wizard, which has its own
   equivalent redeem box) can still self-publish via a promo code here. A
   valid code publishes the event immediately — free, no payment, no waiting
   for admin review — same end state as an admin approving it manually. */
function PromoCodeRedeemBox({ eventId, apiUrl, onRedeemed }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { type: 'error'|'success', text }
  const [focused, setFocused] = useState(false);
  const SUCCESS = '#3B9B6D', ERROR = '#C45E5E';

  const submit = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiUrl}/payments/events/${eventId}/redeem-promo-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'That promo code could not be redeemed.');
      setMsg({ type: 'success', text: data.message || 'Your event is now live!' });
      onRedeemed?.(data.event);
    } catch (err) {
      setMsg({ type: 'error', text: err.message || 'That promo code could not be redeemed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        marginTop: '16px', padding: '18px 20px',
        background: 'linear-gradient(160deg, #FFFEFC 0%, #FBF6EA 100%)',
        border: `1.5px dashed ${COLORS.gold}`, borderRadius: '14px',
        boxShadow: '0 2px 16px rgba(184, 148, 79, 0.08)',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
        <span style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(184, 148, 79, 0.12)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name="ticket" size={15} color={COLORS.gold} strokeWidth={1.6} />
        </span>
        <div>
          <h4 style={{ margin: 0, fontSize: '13.5px', fontWeight: 700, color: COLORS.charcoal, fontFamily: 'var(--font-sans)' }}>Have a promo code?</h4>
          <p style={{ fontSize: '11.5px', color: COLORS.stone, margin: '2px 0 0', lineHeight: 1.5, fontFamily: 'var(--font-sans)' }}>
            Publishes this event immediately — free, no payment, no review wait.
          </p>
        </div>
      </div>
      <div className="promo-redeem-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '14px' }}>
        <input
          value={code}
          onChange={(e) => { setCode(e.target.value.toUpperCase()); setMsg(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="e.g. FANCY2026"
          disabled={busy}
          style={{
            flex: '1 1 160px', height: '42px', padding: '0 14px',
            border: `1.5px solid ${focused ? COLORS.gold : COLORS.border}`, borderRadius: '9px',
            fontSize: '13px', fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.05em', color: COLORS.charcoal,
            background: COLORS.white, outline: 'none', boxSizing: 'border-box',
            boxShadow: focused ? '0 0 0 3px rgba(184, 148, 79, 0.15)' : 'none',
            transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || !code.trim()}
          className="promo-redeem-submit"
          style={{
            height: '42px', padding: '0 20px', borderRadius: '9px', border: 'none',
            background: (busy || !code.trim()) ? '#C9C4BA' : 'linear-gradient(135deg, #C5A86B, #A6833F)',
            color: COLORS.white, fontSize: '12.5px', fontWeight: 700, fontFamily: 'var(--font-sans)',
            cursor: (busy || !code.trim()) ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap',
            transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {busy ? 'Redeeming…' : 'Redeem'}
        </button>
      </div>
      {msg && (
        <div
          style={{
            marginTop: '12px', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '8px', padding: '9px 11px',
            borderRadius: '9px', background: msg.type === 'success' ? 'rgba(59, 155, 109, 0.08)' : 'rgba(196, 94, 94, 0.08)',
            border: `1px solid ${msg.type === 'success' ? 'rgba(59, 155, 109, 0.25)' : 'rgba(196, 94, 94, 0.25)'}`,
          }}
        >
          <span style={{ flexShrink: 0, marginTop: 1 }}>
            <Icon name={msg.type === 'success' ? 'check' : 'warning'} size={14} color={msg.type === 'success' ? SUCCESS : ERROR} strokeWidth={1.8} />
          </span>
          <p style={{ fontSize: '12px', fontWeight: 600, color: msg.type === 'success' ? SUCCESS : ERROR, margin: 0, lineHeight: 1.5, fontFamily: 'var(--font-sans)' }}>
            {msg.text}
          </p>
        </div>
      )}
      <style jsx>{`
        .promo-redeem-submit:not(:disabled):hover { filter: brightness(1.06); box-shadow: 0 6px 18px rgba(184, 148, 79, 0.3); transform: translateY(-1px); }
        @media (max-width: 639.98px) {
          .promo-redeem-row { flex-direction: column; }
          .promo-redeem-row button { width: 100%; }
        }
      `}</style>
    </div>
  );
}

/* Amber inline warning used for the two settings changes with real
   downstream consequences (slug + template swap) — organizer's call, eyes
   open, not a blocking confirmation. */
function InlineWarning({ children }) {
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 8, marginTop: 8, padding: '9px 11px',
      borderRadius: 9, background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.25)',
    }}>
      <span style={{ flexShrink: 0, marginTop: 1 }}>
        <Icon name="warning" size={13} color="#B45309" strokeWidth={1.8} />
      </span>
      <p style={{ fontSize: 11.5, fontWeight: 500, color: '#92400E', margin: 0, lineHeight: 1.5, fontFamily: 'var(--font-sans)' }}>
        {children}
      </p>
    </div>
  );
}

export default function EventSettings({ eventId, event, onEventUpdated, onEventDeleted }) {
  const [activeTab, setActiveTab] = useState('details');
  const [form, setForm] = useState({
    title: '', slug: '', description: '', event_date: '', event_end_date: '', location_name: '', location_address: '',
    location_lat: null, location_lng: null, location_place_id: '',
    rsvp_deadline: '', privacy_mode: 'public', access_password: '',
    dress_code: '', cover_image_url: '',
    primary_color: '#B8944F', secondary_color: '#D7BE80', accent_color: '#B8944F', background_color: '#FFFDF7',
    background_music_url: '', gallery_urls: [],
    font_heading: 'Playfair Display',
    font_body: 'Inter',
    event_type: 'wedding',
    template_type: '',
    notification_email: true,
    notification_whatsapp: false,
    allow_guest_edits: false,
    track_guest_side: false,
    no_kids_allowed: false,
    collect_dietary_restrictions: true,
    // Both default ON, matching the schema — an organizer who never opens
    // this section keeps exactly the behaviour their event already had.
    reveal_enabled: true,
    reveal_replay: true
  });
  // Key names mirror the create-event wizard's Stage2_FormConfiguration (the
  // canonical writer of these fields) so the digital card never has to guess
  // which naming scheme an event was created with.
  const [templateData, setTemplateData] = useState({
    partner1: '', partner2: '', partner1_email: '', partner2_email: '', family_names: '',
    ceremony_venue_name: '', ceremony_venue_address: '', ceremony_lat: null, ceremony_lng: null, ceremony_place_id: '', ceremony_time_of_day: '',
    reception_venue_name: '', reception_venue_address: '', reception_lat: null, reception_lng: null, reception_place_id: '', reception_time_of_day: '',
    company: '', agenda: '', speakers: '', sponsors: '', networkingNotes: '',
    proposalStory: '', giftRegistry: '', loveStory: '', accommodations: '',
    celebrant: '', age: '', partyTheme: '',
    honoree: '', program: '', sponsorPackages: '',
    seal_text: '', reveal_tone: 'classic',
    title_ar: '', description_ar: '', dress_code_ar: '',
    // Custom Canvas — "what kind of event is this?" category + its
    // per-kind fields (see utils/customEventCategories.js), and the
    // look-and-feel config CustomBuilder edits (heading font + palette).
    custom_category: '', custom_honoree: '', custom_milestone: '',
    custom_parents: '', custom_baby_name: '', custom_baby_due: '',
    customDesign: { ...DEFAULT_CUSTOM_DESIGN },
    // Section visibility/order for full-page templates — see SectionsOrderEditor.
    enabledSections: {}, sectionOrder: [],
    ha_days: [],
    // Legacy pre-DaysEditor shape — no longer editable here (superseded by
    // ha_days below), kept only so an old event's values round-trip on save
    // instead of being silently dropped.
    ha_schedule_day1: [], ha_schedule_day2: [],
    ha_venue_day1_name: '', ha_venue_day1_address: '', ha_venue_day1_lat: null, ha_venue_day1_lng: null, ha_venue_day1_image: '',
    ha_venue_day2_name: '', ha_venue_day2_address: '', ha_venue_day2_lat: null, ha_venue_day2_lng: null, ha_venue_day2_image: '',
    ha_accommodation: [], ha_faq: [], ha_meal_options: [],
    ha_invited_to_city: '', ha_invited_to_lat: null, ha_invited_to_lng: null, ha_our_story: '',
    ha_menu_courses: [], ha_things_to_do: [], ha_getting_there: '',
    ha_gift_bank_name: '', ha_gift_account_name: '', ha_gift_iban: '', ha_gift_registry_label: '', ha_gift_message: '',
    ha_dress_ladies: '', ha_dress_gentlemen: '', ha_closing_message: '',
    // Sealed Letter's portrait — see the matching block in the hydration below.
    letter_hero_photo: '', letter_hero_focus: 'center',
    letter_hero_caption: '', letter_hero_caption_sub: '',
  });
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  // Display-only — whether a password is already set, so the (always-blank)
  // input can show "Password is set — leave blank to keep it" instead of
  // looking like no password exists at all.
  const [hasAccessPassword, setHasAccessPassword] = useState(false);
  const [statusLoading, setStatusLoading] = useState('');
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [musicUploading, setMusicUploading] = useState(false);
  // Actually attempts to embed the pasted YouTube link (debounced while
  // typing) so a song that can't play on the live guest page — a very common
  // restriction on official/label music videos with embedding disabled — is
  // flagged here, before publishing, instead of the organizer only finding
  // out when a guest tells them the music button does nothing.
  const [musicEmbedStatus, setMusicEmbedStatus] = useState('idle'); // 'idle' | 'checking' | 'ok' | 'blocked'
  useEffect(() => {
    const id = extractYouTubeId(form.background_music_url);
    if (!id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMusicEmbedStatus('idle');
      return undefined;
    }
    let cancelled = false;
    // Re-arm for this new link on every change, not just the initial mount.
    setMusicEmbedStatus('checking');
    const timer = setTimeout(() => {
      checkYouTubeEmbeddable(id).then((ok) => { if (!cancelled) setMusicEmbedStatus(ok ? 'ok' : 'blocked'); });
    }, 600);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [form.background_music_url]);
  const [coverUploading, setCoverUploading] = useState(false);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  // Cancelling is a different action from deleting, so it gets its own state
  // rather than sharing the delete confirmation's — the two must never be one
  // keystroke apart.
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  // How many guests a cancellation would reach, fetched when the dialog opens so
  // the confirm can name real numbers instead of asking blind.
  const [cancelReach, setCancelReach] = useState({ parties: null, smsReachable: null, smsRemaining: null });
  // The save's proposal to tell the guests, and the send that follows it.
  const [changeNotice, setChangeNotice] = useState(null);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  // Custom dress-code text mode — starts on if the saved value isn't one of
  // the curated pills (e.g. a legacy free-text value), so it displays instead
  // of silently looking like nothing was chosen. Mirrors Stage2's customDressMode.
  const [customDressMode, setCustomDressMode] = useState(false);
  const [revealPreviewOpen, setRevealPreviewOpen] = useState(false);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

  const handleMusicUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 8 * 1024 * 1024) {
      toast.error("File size exceeds 8MB. Please use a smaller file.");
      return;
    }

    setMusicUploading(true);
    try {
      if (!supabase) {
        throw new Error("Supabase client is not initialized.");
      }

      const fileExt = file.name.split('.').pop();
      const fileName = `${eventId}-${Date.now()}.${fileExt}`;
      const filePath = `music/${fileName}`;

      const { data, error: uploadErr } = await supabase.storage
        .from('event-assets')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadErr) {
        throw uploadErr;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('event-assets')
        .getPublicUrl(filePath);

      setForm(prev => ({ ...prev, background_music_url: publicUrl }));
      setSuccess(false);
    } catch (err) {
      console.error("Storage upload failed, falling back to base64 encoding:", err);
      // base64 inflates the payload by ~33%; the API server rejects bodies over 5MB.
      // Keep the embedded data URL safely under that limit.
      if (file.size > 3.5 * 1024 * 1024) {
        toast.error("Couldn't upload to storage, and this file is too large to embed directly (max ~3.5MB). Please use a smaller file.");
        setMusicUploading(false);
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        setForm(prev => ({ ...prev, background_music_url: event.target.result }));
        setSuccess(false);
        setMusicUploading(false);
      };
      reader.onerror = () => {
        toast.error("Failed to read the audio file. Please try again.");
        setMusicUploading(false);
      };
      reader.readAsDataURL(file);
      return;
    }
    setMusicUploading(false);
  };

  const handleCoverUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast.error('File size exceeds 8MB. Please use a smaller file.');
      return;
    }
    setCoverUploading(true);
    try {
      if (!supabase) throw new Error('Supabase client is not initialized.');
      const fileExt = file.name.split('.').pop();
      const fileName = `${eventId}-${Date.now()}.${fileExt}`;
      const filePath = `covers/${fileName}`;
      const { error: uploadErr } = await supabase.storage
        .from('event-assets')
        .upload(filePath, file, { cacheControl: '3600', upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage
        .from('event-assets')
        .getPublicUrl(filePath);
      setForm(prev => ({ ...prev, cover_image_url: publicUrl }));
      setSuccess(false);
    } catch (err) {
      console.error('Cover image upload failed, falling back to base64:', err);
      if (file.size > 3.5 * 1024 * 1024) {
        toast.error("Couldn't upload to storage, and this file is too large to embed directly (max ~3.5MB). Please use a smaller file.");
        setCoverUploading(false);
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        setForm(prev => ({ ...prev, cover_image_url: event.target.result }));
        setSuccess(false);
        setCoverUploading(false);
      };
      reader.onerror = () => {
        toast.error('Failed to read the image file. Please try again.');
        setCoverUploading(false);
      };
      reader.readAsDataURL(file);
      return;
    }
    setCoverUploading(false);
  };

  /* Shared upload path for the gallery/seal/background fields below — tries
     Supabase storage first, falls back to an embedded base64 data URL (capped
     at ~3.5MB) so a misconfigured bucket never silently loses the upload. */
  const uploadFile = async (file, folder) => {
    if (file.size > 8 * 1024 * 1024) {
      toast.error('File size exceeds 8MB. Please use a smaller file.');
      return null;
    }
    try {
      if (!supabase) throw new Error('Supabase client is not initialized.');
      const fileExt = file.name.split('.').pop();
      const fileName = `${eventId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${fileExt}`;
      const filePath = `${folder}/${fileName}`;
      const { error: uploadErr } = await supabase.storage
        .from('event-assets')
        .upload(filePath, file, { cacheControl: '3600', upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage.from('event-assets').getPublicUrl(filePath);
      return publicUrl;
    } catch (err) {
      console.error(`${folder} upload failed, falling back to base64:`, err);
      if (file.size > 3.5 * 1024 * 1024) {
        toast.error("Couldn't upload to storage, and this file is too large to embed directly (max ~3.5MB). Please use a smaller file.");
        return null;
      }
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target.result);
        reader.onerror = () => { toast.error('Failed to read the file. Please try again.'); resolve(null); };
        reader.readAsDataURL(file);
      });
    }
  };

  const handleGalleryUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setGalleryUploading(true);
    for (const file of files) {
      const url = await uploadFile(file, 'gallery');
      if (url) {
        setForm(prev => ({ ...prev, gallery_urls: [...prev.gallery_urls, url] }));
        setSuccess(false);
      }
    }
    setGalleryUploading(false);
  };

  const removeGalleryUrl = (index) => {
    setForm(prev => ({ ...prev, gallery_urls: prev.gallery_urls.filter((_, i) => i !== index) }));
    setSuccess(false);
  };


  // Prefill the form whenever the `event` prop is replaced (mirrors the
  // previous `useEffect(..., [event])` exactly — comparing the object
  // reference, same as React's dependency-array comparison, so this refires
  // on the SAME occasions the old effect did, including the resync that
  // happens after a save round-trips through onEventUpdated). Resetting
  // during render instead of in an effect avoids the setState-in-effect
  // cascading-render pattern.
  //
  // prevEvent starts at `null`, NOT `event` — this component unmounts/remounts
  // every time the Settings tab is opened (it's rendered behind a ternary in
  // page.js), so by the time it mounts, `event` is already the loaded object.
  // Seeding prevEvent with that same reference meant `event !== prevEvent` was
  // false on the very first render and the initial prefill never ran, leaving
  // every field at its hardcoded blank default until the next save round-trip.
  const [prevEvent, setPrevEvent] = useState(null);
  if (event !== prevEvent) {
    setPrevEvent(event);
    if (event) {
      setForm({
        title: event.title || '',
        slug: event.slug || '',
        description: event.description || '',
        event_date: toLocalDatetimeString(event.event_date || event.date, event.timezone),
        event_end_date: toLocalDatetimeString(event.event_end_date || event.end_date, event.timezone),
        location_name: event.location_name || event.venue_name || '',
        location_address: event.location_address || event.venue_address || '',
        location_lat: event.location_lat || null,
        location_lng: event.location_lng || null,
        location_place_id: event.location_place_id || '',
        rsvp_deadline: toLocalDatetimeString(event.rsvp_deadline, event.timezone),
        privacy_mode: event.privacy_mode || 'public',
        // The server no longer sends the stored password hash at all (see
        // withResolvedTier) — this always starts blank. Pre-filling it with the
        // raw hash used to mean every settings save re-submitted that hash as if
        // it were a new plaintext password, which the backend then re-hashed —
        // silently corrupting the real guest password on every unrelated save.
        access_password: '',
        dress_code: event.dress_code || '',
        cover_image_url: event.cover_image_url || '',
        primary_color: event.custom_colors?.primary || '#B8944F',
        secondary_color: event.custom_colors?.secondary || '#D7BE80',
        accent_color: event.custom_colors?.accent || '#B8944F',
        background_color: event.custom_colors?.background || '#FFFDF7',
        background_music_url: event.background_music_url || '',
        gallery_urls: Array.isArray(event.gallery_urls) ? event.gallery_urls : [],
        font_heading: event.custom_fonts?.heading || 'Playfair Display',
        font_body: event.custom_fonts?.body || 'Inter',
        event_type: event.event_type || 'wedding',
        template_type: event.template_type || '',
        notification_email: event.notification_preferences?.email !== false,
        notification_whatsapp: !!event.notification_preferences?.whatsapp,
        allow_guest_edits: !!event.allow_guest_edits,
        track_guest_side: !!event.track_guest_side,
        no_kids_allowed: !!event.no_kids_allowed,
        collect_dietary_restrictions: event.collect_dietary_restrictions !== false,
        // `!== false`, not truthy: an event saved before these columns existed
        // comes back undefined and must read as ON, not silently switch off.
        reveal_enabled: event.reveal_enabled !== false,
        reveal_replay: event.reveal_replay !== false
      });
      setCustomDressMode(!!event.dress_code && !DRESS_CODES.includes(event.dress_code));
      setHasAccessPassword(!!event.has_access_password);
      setTemplateData({
        // Fall back to the legacy bride_name/groom_name/ceremony_time/reception_time
        // keys for events saved before this rename, so existing data still loads.
        partner1: event.template_data?.partner1 || event.template_data?.groom_name || '',
        partner2: event.template_data?.partner2 || event.template_data?.bride_name || '',
        partner1_email: event.template_data?.partner1_email || '',
        partner2_email: event.template_data?.partner2_email || '',
        family_names: event.template_data?.family_names || '',
        // No legacy fallback here (unlike the fields above) — the old
        // ceremonyLocation/ceremony_time fields stored one free-text string
        // mixing venue and time together, which can't be reliably split into
        // the new venue-search + time-picker fields. Leaving these blank for
        // events that predate this rename lets the organizer fill them in
        // explicitly; the public page still falls back to the legacy string
        // (see ceremonyReceptionLine in EventPageClient) until they do.
        ceremony_venue_name: event.template_data?.ceremony_venue_name || '',
        ceremony_venue_address: event.template_data?.ceremony_venue_address || '',
        ceremony_lat: event.template_data?.ceremony_lat || null,
        ceremony_lng: event.template_data?.ceremony_lng || null,
        ceremony_place_id: event.template_data?.ceremony_place_id || '',
        ceremony_time_of_day: event.template_data?.ceremony_time_of_day || '',
        reception_venue_name: event.template_data?.reception_venue_name || '',
        reception_venue_address: event.template_data?.reception_venue_address || '',
        reception_lat: event.template_data?.reception_lat || null,
        reception_lng: event.template_data?.reception_lng || null,
        reception_place_id: event.template_data?.reception_place_id || '',
        reception_time_of_day: event.template_data?.reception_time_of_day || '',
        company: event.template_data?.company || event.template_data?.company_name || '',
        agenda: event.template_data?.agenda || '',
        speakers: event.template_data?.speakers || '',
        sponsors: event.template_data?.sponsors || '',
        networkingNotes: event.template_data?.networkingNotes || '',
        proposalStory: event.template_data?.proposalStory || '',
        giftRegistry: event.template_data?.giftRegistry || '',
        loveStory: event.template_data?.loveStory || '',
        accommodations: event.template_data?.accommodations || '',
        celebrant: event.template_data?.celebrant || '',
        age: event.template_data?.age || '',
        partyTheme: event.template_data?.partyTheme || '',
        honoree: event.template_data?.honoree || '',
        program: event.template_data?.program || '',
        sponsorPackages: event.template_data?.sponsorPackages || '',
        seal_text: event.template_data?.seal_text || '',
        reveal_tone: event.template_data?.reveal_tone || 'classic',
        title_ar: event.template_data?.title_ar || '',
        description_ar: event.template_data?.description_ar || '',
        dress_code_ar: event.template_data?.dress_code_ar || '',
        custom_category: event.template_data?.custom_category || '',
        custom_honoree: event.template_data?.custom_honoree || '',
        custom_milestone: event.template_data?.custom_milestone || '',
        custom_parents: event.template_data?.custom_parents || '',
        custom_baby_name: event.template_data?.custom_baby_name || '',
        custom_baby_due: event.template_data?.custom_baby_due || '',
        /* Seeded from the event's OWN colours, not from the gold defaults.

           `customDesign` is written by the create-event wizard, so an event
           built there always has one. An event created through the API, one
           switched TO Custom Canvas on this screen, or one predating that key
           has none — and merging bare DEFAULT_CUSTOM_DESIGN showed the builder
           gold while the page was rendering the event's real `custom_colors`.

           That was cosmetic while this panel only fed the small invitation
           card. It is not any more: its onChange now writes the page palette
           too (see customDesignConfig), so the first font tweak on such an
           event would have quietly repainted the whole invitation gold. */
        customDesign: {
          ...DEFAULT_CUSTOM_DESIGN,
          ...(event.custom_colors?.primary ? {
            primary: event.custom_colors.primary,
            secondary: event.custom_colors.secondary || DEFAULT_CUSTOM_DESIGN.secondary,
            accent: event.custom_colors.accent || event.custom_colors.primary,
            background: event.custom_colors.background || DEFAULT_CUSTOM_DESIGN.background,
          } : {}),
          ...(event.template_data?.customDesign || {}),
        },
        enabledSections: event.template_data?.enabledSections || {},
        sectionOrder: Array.isArray(event.template_data?.sectionOrder) ? event.template_data.sectionOrder : [],
        // Heritage Arch template — full-page multi-day site content. ha_days is
        // the live source the guest page actually reads (getHaDays prioritizes
        // it over the legacy day1/day2 fields below) — synthesized from those
        // legacy fields on first load if the event predates ha_days, so an old
        // event's Day 1/2 venues appear pre-filled here instead of blank.
        ha_days: Array.isArray(event.template_data?.ha_days) ? event.template_data.ha_days : getHaDays(event.template_data || {}),
        ha_schedule_day1: Array.isArray(event.template_data?.ha_schedule_day1) ? event.template_data.ha_schedule_day1 : [],
        ha_schedule_day2: Array.isArray(event.template_data?.ha_schedule_day2) ? event.template_data.ha_schedule_day2 : [],
        ha_venue_day1_name: event.template_data?.ha_venue_day1_name || '',
        ha_venue_day1_address: event.template_data?.ha_venue_day1_address || '',
        ha_venue_day1_lat: event.template_data?.ha_venue_day1_lat ?? null,
        ha_venue_day1_lng: event.template_data?.ha_venue_day1_lng ?? null,
        ha_venue_day1_image: event.template_data?.ha_venue_day1_image || '',
        ha_venue_day2_name: event.template_data?.ha_venue_day2_name || '',
        ha_venue_day2_address: event.template_data?.ha_venue_day2_address || '',
        ha_venue_day2_lat: event.template_data?.ha_venue_day2_lat ?? null,
        ha_venue_day2_lng: event.template_data?.ha_venue_day2_lng ?? null,
        ha_venue_day2_image: event.template_data?.ha_venue_day2_image || '',
        ha_accommodation: Array.isArray(event.template_data?.ha_accommodation) ? event.template_data.ha_accommodation : [],
        ha_faq: Array.isArray(event.template_data?.ha_faq) ? event.template_data.ha_faq : [],
        ha_meal_options: toTagArray(event.template_data?.ha_meal_options),
        ha_invited_to_city: event.template_data?.ha_invited_to_city || '',
        ha_invited_to_lat: event.template_data?.ha_invited_to_lat ?? null,
        ha_invited_to_lng: event.template_data?.ha_invited_to_lng ?? null,
        ha_our_story: event.template_data?.ha_our_story || '',
        ha_menu_courses: Array.isArray(event.template_data?.ha_menu_courses) ? event.template_data.ha_menu_courses : [],
        ha_things_to_do: Array.isArray(event.template_data?.ha_things_to_do) ? event.template_data.ha_things_to_do : [],
        ha_getting_there: event.template_data?.ha_getting_there || '',
        ha_gift_bank_name: event.template_data?.ha_gift_bank_name || '',
        ha_gift_account_name: event.template_data?.ha_gift_account_name || '',
        ha_gift_iban: event.template_data?.ha_gift_iban || '',
        ha_gift_registry_label: event.template_data?.ha_gift_registry_label || '',
        ha_gift_message: event.template_data?.ha_gift_message || '',
        ha_dress_ladies: event.template_data?.ha_dress_ladies || '',
        ha_dress_gentlemen: event.template_data?.ha_dress_gentlemen || '',
        ha_closing_message: event.template_data?.ha_closing_message || '',
        /* Sealed Letter's portrait. These MUST be listed here even though the
           save merges onto event.template_data and so would not lose them:
           this object REPLACES the local state rather than extending it, so a
           key that is missing reads as undefined in the editor — and the
           organizer would open Event Details on an event that has a
           photograph and be shown an empty upload box and a preview of the
           frame's stock illustration. Every field this screen renders belongs
           in this list. */
        letter_hero_photo: event.template_data?.letter_hero_photo || '',
        letter_hero_focus: event.template_data?.letter_hero_focus || 'center',
        letter_hero_caption: event.template_data?.letter_hero_caption || '',
        letter_hero_caption_sub: event.template_data?.letter_hero_caption_sub || '',
      });
    }
  }

  const handleChange = (field) => (e) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }));
    setSuccess(false);
  };

  // Ceremony/reception venue pickers behave like the main Location Name field: a
  // plain-address prediction has no distinct `place.name` — falling back to the
  // raw search text there would leave the venue name stale, so fall back to the
  // address's first segment instead.
  const makeTemplatePlaceSelectHandler = (prefix) => (place) => {
    setTemplateData(prev => ({
      ...prev,
      [`${prefix}_venue_name`]: place.name && place.name !== place.address
        ? place.name
        : (place.address ? place.address.split(',')[0] : prev[`${prefix}_venue_name`]),
      [`${prefix}_venue_address`]: place.address,
      [`${prefix}_lat`]: place.lat,
      [`${prefix}_lng`]: place.lng,
      [`${prefix}_place_id`]: place.placeId,
    }));
    setSuccess(false);
  };

  // "Invited to" city — captures coordinates so the world-map pin actually
  // points at this city instead of silently reusing Day 1's venue coordinates.
  const onHaInvitedToPlaceSelect = (place) => {
    setTemplateData(prev => ({
      ...prev,
      ha_invited_to_city: place.name && place.name !== place.address
        ? place.name
        : (place.address ? place.address.split(',')[0] : prev.ha_invited_to_city),
      ha_invited_to_lat: place.lat,
      ha_invited_to_lng: place.lng,
    }));
    setSuccess(false);
  };

  const handleSave = async () => {
    // Validate date ordering up front — previously an event could be saved
    // with an end date before its start date, or an RSVP deadline after the
    // event itself, with no warning anywhere (client or server).
    if (form.event_end_date && form.event_date && new Date(form.event_end_date) < new Date(form.event_date)) {
      setError('The end date/time must be after the start date/time.');
      return;
    }
    if (form.rsvp_deadline && form.event_date && new Date(form.rsvp_deadline) > new Date(form.event_date)) {
      setError('The RSVP deadline must be on or before the event date.');
      return;
    }
    if (form.slug && !SLUG_REGEX.test(form.slug)) {
      setError('Event URL slug must contain only lowercase letters, numbers, and single dashes.');
      return;
    }
    setSaving(true); setError(''); setSuccess(false);
    try {
      const body = { ...form };
      // The date fields are sent EXACTLY as typed — "2027-05-15T18:30", with
      // no zone suffix — and the server converts them through the event's own
      // timezone.
      //
      // This used to append ":00.000Z" here, back when the stored value was
      // the raw digits filed as UTC. Continuing to do that would now be worse
      // than useless: a value carrying a zone designator is already an instant
      // by definition, so the server's converter passes it through untouched.
      // The suffix would therefore silently DISABLE the conversion and refile
      // every edited event under the old broken convention — the one bug this
      // change exists to remove, reintroduced by one line on the way out.
      //
      // Routing through `new Date(...).toISOString()` is equally wrong and for
      // the original reason: it reads a naive string as the BROWSER's local
      // time, shifting the value by the organizer's own offset on every save.
      // Send the digits; let the server decide whose clock they are on.
      // access_password now always starts blank (the server never sends the
      // stored hash back — see withResolvedTier), so only include it when the
      // organizer actually typed a new one; otherwise omit it entirely so
      // updateEvent leaves the existing password untouched. Previously this
      // only checked privacy_mode, so a password-protected event resubmitted
      // whatever was pre-filled (the raw hash) on every unrelated save.
      if (body.privacy_mode !== 'password' || !body.access_password.trim()) delete body.access_password;
      // Don't send an unchanged/empty slug — updateEvent treats an omitted
      // field as "leave as-is", which is what we want when the organizer
      // never touched this field.
      if (!body.slug) delete body.slug;
      if (!body.template_type) delete body.template_type;

      // Pack custom fonts
      body.custom_fonts = {
        heading: body.font_heading,
        body: body.font_body
      };
      delete body.font_heading;
      delete body.font_body;

      // Pack the color pickers' flat `*_color` fields into the `custom_colors`
      // jsonb column the backend actually persists — the backend's field
      // whitelist has no bare `primary_color` field, so sending them as-is was
      // silently dropped and never saved.
      body.custom_colors = {
        ...event?.custom_colors,
        primary: body.primary_color,
        secondary: body.secondary_color,
        accent: body.accent_color,
        background: body.background_color,
      };
      delete body.primary_color;
      delete body.secondary_color;
      delete body.accent_color;
      delete body.background_color;

      // Pack template data — merge onto the event's existing template_data so
      // fields this form doesn't surface (seal artwork, love story, gift
      // registry, custom category, section order, etc.) survive instead of
      // being wiped out.
      body.template_data = {
        ...event?.template_data,
        ...templateData,
      };

      // Pack notification preferences
      body.notification_preferences = {
        email: body.notification_email,
        whatsapp: false // WhatsApp notifications not yet available
      };
      delete body.notification_email;
      delete body.notification_whatsapp;

      const res = await fetch(`${apiUrl}/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to save settings');
      setSuccess(true);
      onEventUpdated?.(data.event || data);
      setTimeout(() => setSuccess(false), 3000);

      /**
       * TELLING THE GUESTS — the half of this feature that was never connected.
       *
       * `updateEvent` has always returned a `changeNotice` when a live event's date
       * or venue actually moved: what changed, a `changeKey`, and how many guests
       * would be reached. `POST /events/:id/notify-change` has always been there to
       * send it. `ConfirmGuestNotifyModal` has always supported `mode="change"`.
       *
       * Nothing read any of it. `grep changeNotice frontend/src` returned nothing,
       * so **moving a wedding's date or venue told not one guest** — silently, while
       * reporting "Settings saved successfully". Three finished pieces and no wire
       * between them.
       *
       * Deliberately a PROPOSAL, not an automatic send: the same save can now text
       * several hundred people, so fixing a typo'd venue and saving the correction
       * would spend an organizer's balance twice before any dialog appeared. The
       * server proposes here; the organizer decides in the dialog.
       */
      if (data.changeNotice) setChangeNotice(data.changeNotice);
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Send the change the organizer just saved and confirmed.
   *
   * `changeKey` travels with the proposal and back again so a dialog left open
   * while the venue changed a second time cannot broadcast the FIRST change's key —
   * the server recomputes it and answers 409 CHANGE_SUPERSEDED, which is the one
   * error here worth its own sentence.
   */
  const handleNotifyChange = async ({ sendSms }) => {
    setNotifyBusy(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/events/${eventId}/notify-change`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changeKey: changeNotice?.changeKey,
          channels: sendSms ? ['email', 'sms'] : ['email'],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // Not a failure to retry blindly — the details moved again underneath them.
        setChangeNotice(null);
        toast.error(data.message || 'These details changed again. Review them and send once more.');
        return;
      }
      if (!res.ok || data.success === false) throw new Error(data.message || 'Could not tell your guests.');
      setChangeNotice(null);
      toast.success(data.message || 'Your guests have been told.');
    } catch (err) {
      setError(err.message || 'Could not tell your guests.');
    } finally {
      setNotifyBusy(false);
    }
  };

  const handleStatusChange = async (newStatus) => {
    // Both this and handleSave render into the same success/error banners
    // below — without clearing them here, a stale "Settings saved
    // successfully" (or a stale error) from an earlier Save could keep
    // showing while a status change is in flight or just completed.
    setStatusLoading(newStatus);
    setError('');
    setSuccess(false);
    try {
      const res = await fetch(`${apiUrl}/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to update status');
      onEventUpdated?.(data.event || data);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setStatusLoading('');
    }
  };

  const handleDeleteEvent = async () => {
    setDeleting(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/events/${eventId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      // The server refuses to hard-delete a live event that has guests, and says
      // so with CANCEL_FIRST. Surfacing its message verbatim is the point — it
      // names the guest count and explains that cancelling tells them, which is
      // the choice the organizer almost certainly meant to make.
      if (!res.ok) throw new Error(data.message || 'Failed to delete event');
      onEventDeleted?.(eventId);
    } catch (err) {
      setError(err.message || 'Something went wrong');
      setDeleting(false);
    }
  };

  /**
   * Load who a cancellation would actually reach, when the dialog opens.
   *
   * Fetched here rather than held permanently: it is two counts and a balance,
   * needed on one rare screen, and keeping them live for every settings visit
   * would be three queries per page load to answer a question nobody asked.
   *
   * An inline async IIFE rather than a useCallback the effect then calls — the
   * lint rule in this repo treats the latter as a set-state-in-effect violation.
   */
  useEffect(() => {
    /**
     * Fetched for EITHER dialog, not just the cancel one.
     *
     * This was gated on `cancelOpen` alone. The change dialog reads the same
     * balance, and ConfirmGuestNotifyModal decides whether to offer the text
     * option from `smsRemaining !== null` — so leaving it null there would have
     * silently hidden the "also send a text" checkbox and quietly downgraded every
     * date-and-venue change to email only.
     */
    if ((!cancelOpen && !changeNotice) || !eventId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/events/${eventId}/campaigns/settings`, { credentials: 'include' });
        const data = await res.json();
        if (cancelled || !data?.success) return;
        setCancelReach({
          parties: data.coverage?.invitations ?? null,
          // The REAL consented count, not the invitation count.
          //
          // This used to reuse coverage.invitations, which is every invitation on
          // the list — so the dialog promised to text guests who had never agreed
          // to be texted, and the number it showed was always too high.
          smsReachable: data.addonActive ? (data.smsReachableParties ?? 0) : 0,
          smsRemaining: data.addonActive ? (data.balance?.remaining ?? 0) : null,
        });
      } catch { /* the dialog still works, it just cannot promise numbers */ }
    })();
    return () => { cancelled = true; };
    // `changeNotice` is a dependency, not just a guard — without it the effect
    // never re-runs when the save proposes a notification, so the balance stays
    // null and the text option stays hidden.
  }, [cancelOpen, changeNotice, eventId, apiUrl]);

  /**
   * Call the event off, and tell the guests.
   *
   * A dedicated endpoint rather than a status PATCH: cancelling notifies
   * everyone and cannot be undone from a guest's side, so it must never be
   * reachable by the generic settings save.
   */
  const handleCancelEvent = async ({ sendSms, reason }) => {
    setCancelBusy(true);
    setError('');
    try {
      const res = await fetch(`${apiUrl}/events/${eventId}/cancel`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, notify: true, channels: sendSms ? ['email', 'sms'] : ['email'] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.message || 'Could not cancel the event.');
      setCancelOpen(false);
      // Same callback the ordinary save uses, so the dashboard re-reads the event
      // and the status badge, the RSVP form state and this panel all agree.
      onEventUpdated?.(data.message || 'Event cancelled.');
    } catch (err) {
      setError(err.message || 'Could not cancel the event.');
    } finally {
      setCancelBusy(false);
    }
  };

  const sectionStyle = {
    background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: '14px',
    padding: '26px', marginBottom: '20px', boxShadow: '0 2px 14px rgba(25,27,30,0.04)',
  };
  const sectionTitleStyle = {
    fontFamily: 'var(--font-serif)', fontSize: '16.5px', fontWeight: 600, color: COLORS.charcoal,
    margin: '0 0 22px', paddingBottom: '14px', borderBottom: `1px solid ${COLORS.border}`,
    letterSpacing: '0.01em',
  };
  /**
   * THE READING FLOOR, applied at the shared objects rather than per call site.
   *
   * These four objects are spread across most of this 2,900-line screen, so
   * moving them to the `--fx-*` type tokens fixes dozens of render sites at once
   * — and, more usefully, means the next label added here inherits a size that
   * grows on a phone instead of copying an 11px literal.
   *
   * The tokens are READ here, never set: a call site that wrote
   * `'--fx-label': '11px'` inline would kill the media behaviour for it, which is
   * exactly the --fx-pad-x trap documented in globals.css.
   */
  const labelStyle = {
    display: 'block', fontSize: 'var(--fx-label)', fontWeight: 600, color: COLORS.stone,
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px', fontFamily: 'var(--font-sans)',
  };
  const inputStyle = {
    width: '100%', padding: '10.5px 14px', minHeight: 'var(--fx-touch)',
    border: `1px solid ${COLORS.border}`, borderRadius: '9px',
    fontSize: '14px', fontFamily: 'var(--font-sans)', color: COLORS.charcoal, background: COLORS.white,
    outline: 'none', boxShadow: 'none', transition: 'border-color 0.2s, box-shadow 0.2s', boxSizing: 'border-box',
  };
  // Icon badge — the small colored-circle icon container already used by
  // PromoCodeRedeemBox, applied consistently to every section header so the
  // whole page reads as one designed system instead of ad hoc bare icons.
  const iconBadgeStyle = {
    width: 32, height: 32, borderRadius: 9, background: 'rgba(184, 148, 79, 0.12)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  };
  const fieldGroupStyle = { marginBottom: '16px' };
  const rowStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' };
  // 10px was the single most-repeated size on this screen and the least
  // readable. --fx-micro is the floor of the reading scale: ~11px on a phone,
  // 10.5px on a desktop, so the desk view barely moves.
  const hintStyle = { fontSize: 'var(--fx-micro)', color: COLORS.stone, display: 'block', marginTop: '4px', lineHeight: 1.55 };
  const pillStyle = (active) => ({
    // 7px of vertical padding made these ~31px tall. They are the primary way
    // several settings are chosen, and they were below every platform's minimum
    // target size — a miss on a phone selects nothing and looks like a dead UI.
    padding: '7px 14px', minHeight: 'var(--fx-touch)',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 999, cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
    fontFamily: 'var(--font-sans)', border: `1.5px solid ${active ? COLORS.gold : COLORS.border}`,
    background: active ? 'rgba(184,148,79,0.08)' : COLORS.white, color: active ? COLORS.gold : COLORS.stone,
    transition: 'all 0.2s',
  });

  const currentStatus = event?.status || 'active';
  const statusColors = {
    active: '#22C55E', paused: '#F59E0B', completed: '#6B8EAE',
    draft: '#9CA3AF', pending_review: '#B8944F',
  };
  const statusLabels = {
    active: 'Active', paused: 'Paused', completed: 'Completed',
    draft: 'Draft', pending_review: 'Pending Review',
  };
  // Status controls only make sense for a live event; draft/pending_review are
  // pre-publish states handled by the payment + review flow.
  const statusActionable = ['active', 'paused', 'completed'].includes(currentStatus);
  const statusColor = statusColors[currentStatus] || statusColors.active;

  // Falls back to the coarser event_type when no template_type is set yet
  // (older events saved before that field existed).
  const effectiveTemplateType = form.template_type || (form.event_type === 'wedding' ? 'wedding' : '');
  /* The occasion, for ANY template — the same question the wizard's Step 2
     asks. It has to be answerable here too, or an organizer who picked the
     wrong one at creation could never change it, and the answer drives the
     invitation's wording and the Groom's/Bride's Side labels, not just a
     heading. Unanswered falls to the template's own default, so an event
     created before the picker existed resolves exactly as it always did. */
  const occasionChoice = resolveOccasion(effectiveTemplateType, templateData)
    /* Events saved before `template_type` existed, where `effectiveTemplateType`
       is '' and only the coarse event_type names the occasion. */
    || (!form.template_type && CUSTOM_CATEGORY_BY_KEY[form.event_type] ? form.event_type : '');
  const occasionMeta = CUSTOM_CATEGORY_BY_KEY[occasionChoice] || null;
  // What this template may be used for — the same source the picker card's
  // badge reads, so the two can never disagree.
  const occasionPolicy = occasionPolicyFor(effectiveTemplateType);
  // Which fields show is decided by the occasion's `kind`, for every template.
  const showCoupleFields = occasionMeta?.kind === 'couple';

  /* The retired continuous-scroll TEMPLATES (Corporate, Birthday, Gala) have
     their own content blocks below — celebrant/age, company/agenda, honoree/
     program. Those were gated on `event_type`, which was safe only while
     event_type could not disagree with the artwork.

     It can now: an organizer who picks Birthday as the OCCASION on Velvet Ring
     gets `event_type: 'birthday'`, and the old gate would have rendered the
     legacy celebrant/age fields alongside the occasion's own honoree fields —
     two inputs for one name, writing to different keys, on the same screen.
     Gating on the template key confines them to events actually created as
     one of those templates. */
  const isLegacyCategoryTemplate = (key) => form.template_type === key
    || (!form.template_type && form.event_type === key);
  const isCustomTemplate = effectiveTemplateType === 'custom';

  /* ─── Colour palette ───
     The four `<input type="color">` boxes this replaces let an organizer set
     any hex for heading, accent and paper independently — including the
     combinations where two of them are the same colour — while offering none
     of the three palettes their template actually ships, and no route back to
     the one they picked in the wizard. Curated palettes only now: the whole
     page (headings, labels, dividers, buttons, body copy, paper) is derived
     from these three values together in buildPalette(), so they are only ever
     meaningful as a set. */
  const activePalettes = palettesFor(effectiveTemplateType);
  const activePaletteIndex = matchPaletteIndex(activePalettes, {
    primary: form.primary_color,
    secondary: form.secondary_color,
    background: form.background_color,
  });
  /* Writes the flat `*_color` form fields, which handleSave packs back into
     the `custom_colors` jsonb. Accepts a preset OR a Custom Canvas design
     object — they carry the same four keys, which is what lets the Custom
     builder feed the page palette here the way it already does in the wizard. */
  const applyPalette = (p) => {
    if (!p) return;
    setForm(prev => ({
      ...prev,
      primary_color: p.primary,
      secondary_color: p.secondary,
      accent_color: p.accent || p.primary,
      background_color: p.background,
    }));
    setSuccess(false);
  };

  /* The Custom builder's config. Seeded at load from the event's own colours
     (see the customDesign note in the load effect); the fallback here only
     covers the render before that effect has run. */
  const customDesignConfig = templateData.customDesign || DEFAULT_CUSTOM_DESIGN;

  /** The arrival this event's guests actually get — a box, a door or an envelope. */
  const opening = getTemplateOpening(effectiveTemplateType);

  /**
   * Who may switch the adults-only notice on: anything the full-page engine
   * renders, which is exactly where HeritageArchPage can show the section.
   *
   * This was a wedding/engagement-only gate, mirroring an identical gate in
   * HeritageArchPage. Both are gone. A Custom Canvas event — the template
   * whose whole premise is "any feature from any event type" — could not offer
   * an adults-only notice at all, and neither could any of the curated wedding
   * variants (Tuscany, Marrakesh, Kyoto…), which are weddings in every respect
   * that matters. Nothing surfaced the exclusion; the toggle was simply absent.
   *
   * `isFullPage` is reused rather than re-listed so this and the guest page
   * cannot drift apart again — the previous pair drifted the moment the
   * variants and Custom were added to the engine and this was not updated.
   */
  const canShowNoKidsToggle = isFullPage(effectiveTemplateType)
    // Legacy fallback: events saved before `template_type` existed, where
    // `effectiveTemplateType` is '' and only `event_type` names the occasion.
    || (!form.template_type && (form.event_type === 'engagement' || form.event_type === 'wedding'));

  return (
    <div style={{ maxWidth: '780px' }}>

      {/**
        * ═══ TAB NAV ═══
        *
        * SCROLLS SIDEWAYS ON A PHONE, rather than wrapping.
        *
        * Five tabs with labels like "Status & Danger Zone" and "Design &
        * Template" wrapped to three or four lines on a 320px screen — a
        * navigation bar taller than the first field it sits above, and one that
        * changed height as you moved between tabs.
        *
        * `.fx-row--scroll` is the sanctioned exception to the wrap rule
        * (globals.css): a row that genuinely should stay on one line scrolls
        * instead of overflowing the page. A tab strip is the archetype — the
        * horizontal run IS the affordance, and stacked tabs stop reading as
        * tabs at all.
        *
        * `flexWrap` is deleted rather than left beside the class, or it would
        * win outright and the class would do nothing (AGENTS.md's one rule).
        */}
      <div className="es-tabs fx-row--scroll" style={{
        display: 'flex', gap: 6, marginBottom: 22, padding: 5, borderRadius: 14,
        background: COLORS.softBg, border: `1px solid ${COLORS.border}`,
      }}>
        {TABS.map((t) => {
          const active = activeTab === t.key;
          return (
            <button key={t.key} type="button" onClick={() => setActiveTab(t.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 10,
                // flexShrink: a scrolling row must not squeeze its children to
                // fit — that is the wrapping behaviour it exists to avoid,
                // achieved by a different mechanism.
                minHeight: 'var(--fx-touch)', flexShrink: 0,
                border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, fontFamily: 'var(--font-sans)',
                background: active ? COLORS.white : 'transparent', color: active ? COLORS.gold : COLORS.stone,
                boxShadow: active ? '0 2px 10px rgba(184,148,79,0.15)' : 'none',
                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)', whiteSpace: 'nowrap',
              }}
            >
              <Icon name={t.icon} size={13} strokeWidth={1.7} />
              {t.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'details' && (
      <>
      {/* ═══ EVENT DETAILS ═══ */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
            <span style={iconBadgeStyle}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={COLORS.gold} strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span>
            Event Details
          </span>
        </h3>

        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Event Title</label>
          <input value={form.title} onChange={handleChange('title')} placeholder="My Event" style={inputStyle}
            onFocus={(e) => { e.target.style.borderColor = COLORS.gold; e.target.style.boxShadow = '0 0 0 3px rgba(184,148,79,0.1)'; }}
            onBlur={(e) => { e.target.style.borderColor = COLORS.border; e.target.style.boxShadow = 'none'; }}
          />
        </div>

        <div style={fieldGroupStyle}>
          <label style={labelStyle}>
            <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
              <Icon name="globe" size={12} strokeWidth={1.7} /> Arabic Title <span style={{ fontSize: '11px', color: '#999', fontWeight: 400 }}>(optional — shown when guest switches to Arabic)</span>
            </span>
          </label>
          <input
            value={templateData.title_ar || ''}
            onChange={(e) => { setTemplateData(prev => ({ ...prev, title_ar: e.target.value })); setSuccess(false); }}
            placeholder="عنوان الفعالية بالعربي"
            dir="rtl"
            style={{ ...inputStyle, fontFamily: "'Noto Sans Arabic', 'Segoe UI', sans-serif" }}
            onFocus={(e) => { e.target.style.borderColor = COLORS.gold; e.target.style.boxShadow = '0 0 0 3px rgba(184,148,79,0.1)'; }}
            onBlur={(e) => { e.target.style.borderColor = COLORS.border; e.target.style.boxShadow = 'none'; }}
          />
        </div>

        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Event URL</label>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{
              background: COLORS.ivory, border: `1px solid ${COLORS.border}`, borderRight: 'none',
              borderRadius: '8px 0 0 8px', padding: '10px 12px', fontSize: 13, color: COLORS.stone,
              fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap',
            }}>fancyrsvp.com/</span>
            <input
              value={form.slug}
              onChange={(e) => { setForm(prev => ({ ...prev, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })); setSuccess(false); }}
              placeholder="my-event"
              style={{ ...inputStyle, borderRadius: '0 8px 8px 0' }}
              onFocus={(e) => { e.target.style.borderColor = COLORS.gold; }}
              onBlur={(e) => { e.target.style.borderColor = COLORS.border; }}
            />
          </div>
          <InlineWarning>
            Changing this breaks any invitation link or QR code you&apos;ve already shared — guests using the old link will get a &ldquo;not found&rdquo; page.
          </InlineWarning>
        </div>

        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Description</label>
          <textarea value={form.description} onChange={handleChange('description')} rows={3}
            placeholder="Tell guests about your event…" style={{ ...inputStyle, resize: 'vertical', minHeight: '80px' }}
            onFocus={(e) => { e.target.style.borderColor = COLORS.gold; e.target.style.boxShadow = '0 0 0 3px rgba(184,148,79,0.1)'; }}
            onBlur={(e) => { e.target.style.borderColor = COLORS.border; e.target.style.boxShadow = 'none'; }}
          />
        </div>

        <div style={fieldGroupStyle}>
          <label style={labelStyle}>
            <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
              <Icon name="globe" size={12} strokeWidth={1.7} /> Arabic Description <span style={{ fontSize: '11px', color: '#999', fontWeight: 400 }}>(optional)</span>
            </span>
          </label>
          <textarea
            value={templateData.description_ar || ''}
            onChange={(e) => { setTemplateData(prev => ({ ...prev, description_ar: e.target.value })); setSuccess(false); }}
            placeholder="وصف الفعالية بالعربي"
            rows={3}
            dir="rtl"
            style={{ ...inputStyle, resize: 'vertical', minHeight: '80px', fontFamily: "'Noto Sans Arabic', 'Segoe UI', sans-serif" }}
            onFocus={(e) => { e.target.style.borderColor = COLORS.gold; e.target.style.boxShadow = '0 0 0 3px rgba(184,148,79,0.1)'; }}
            onBlur={(e) => { e.target.style.borderColor = COLORS.border; e.target.style.boxShadow = 'none'; }}
          />
        </div>

        <div className="es-row" style={rowStyle}>
          <div style={fieldGroupStyle}>
            <label style={labelStyle}>Start Date &amp; Time</label>
            <input type="datetime-local" value={form.event_date} onChange={handleChange('event_date')} style={inputStyle}
              onFocus={(e) => { e.target.style.borderColor = COLORS.gold; }}
              onBlur={(e) => { e.target.style.borderColor = COLORS.border; }}
            />
          </div>
          <div style={fieldGroupStyle}>
            <label style={labelStyle}>End Date &amp; Time</label>
            <input type="datetime-local" value={form.event_end_date} onChange={handleChange('event_end_date')} style={inputStyle}
              onFocus={(e) => { e.target.style.borderColor = COLORS.gold; }}
              onBlur={(e) => { e.target.style.borderColor = COLORS.border; }}
            />
          </div>
        </div>

        <div className="es-row" style={rowStyle}>
          <div style={fieldGroupStyle}>
            <label style={labelStyle} htmlFor="es-location-name">Location Name</label>
            <PlacesAutocomplete
              id="es-location-name"
              value={form.location_name}
              onChange={(val) => { setForm(prev => ({ ...prev, location_name: val })); setSuccess(false); }}
              onPlaceSelect={(place) => {
                setForm(prev => ({
                  ...prev,
                  // Plain-address predictions have no distinct `place.name` (empty,
                  // or identical to the address) — falling back to the previous
                  // Venue value left it stale/blank while Address updated, making
                  // it look like the selection only filled in the address. Fall
                  // back to the address's first segment instead, same as create-event.
                  location_name: place.name && place.name !== place.address
                    ? place.name
                    : (place.address ? place.address.split(',')[0] : prev.location_name),
                  location_address: place.address,
                  location_lat: place.lat,
                  location_lng: place.lng,
                  location_place_id: place.placeId,
                }));
                setSuccess(false);
              }}
              placeholder="Search for a venue..."
            />
            <span style={hintStyle}>Type a name or address and pick a suggestion — or if Google can&apos;t find your venue, just type the name in and enter the address manually on the right</span>
          </div>
          <div style={fieldGroupStyle}>
            <label style={labelStyle}>Location Address</label>
            <input value={form.location_address} onChange={handleChange('location_address')} placeholder="Grand Ballroom, 123 Main St" style={inputStyle}
              onFocus={(e) => { e.target.style.borderColor = COLORS.gold; }}
              onBlur={(e) => { e.target.style.borderColor = COLORS.border; }}
            />
            <span style={hintStyle}>Auto-filled from the selected venue — or type it in yourself, it&apos;s always editable</span>
          </div>
        </div>

        {/* ── The occasion, in Event Details where the old "Event Type"
            select was ──────────────────────────────────────────────────────
            It replaced that select, and it was first put under Content —
            which reads, correctly, as "I cannot change the event type of this
            event any more". A control that moved somewhere nobody looks is a
            control that was removed. It lives in its old slot now.

            The select itself stays gone: it asked the same question with six
            blunt answers, and two controls for one decision is how an
            invitation ends up saying "engagement" while the guest list says
            "Groom's Side". This writes `event_type` itself.

            Kept, for a legacy row with no template_type at all, because
            nothing else can set it there. */}
        {!form.template_type ? (
          <div style={fieldGroupStyle}>
            <label style={labelStyle}>Event Type</label>
            <select value={form.event_type} onChange={handleChange('event_type')} style={{ ...inputStyle, cursor: 'pointer' }}>
              <option value="wedding">Wedding</option>
              <option value="corporate">Corporate Event</option>
              <option value="birthday">Birthday Party</option>
              <option value="engagement">Engagement Party</option>
              <option value="gala">Gala / Dinner</option>
              <option value="custom">Custom Event</option>
            </select>
          </div>
        ) : occasionPolicy.allowed !== 'any' && occasionPolicy.locked ? (
          <OccasionPicker
            label="Event Type"
            value={occasionChoice}
            onChange={() => {}}
            allowed={occasionPolicy.allowed}
            lockedNote={occasionPolicy.note}
            labelStyle={labelStyle}
            hintStyle={hintStyle}
          />
        ) : (
          <OccasionPicker
            label="Event Type"
            hint="Sets the wording on your invitation, which details you fill in below, and how guest sides are labelled — change it any time."
            value={occasionChoice}
            onChange={(key) => {
              setTemplateData(prev => ({ ...prev, custom_category: key }));
              /* event_type moves WITH the choice. It is what the side labels,
                 meal selection, the RSVP wizard and the CSV export all read —
                 none of which knows a template key — so leaving it behind
                 would show "Groom's Side" on a birthday. Mirrors
                 deriveEventType() in create-event/page.js. */
              setForm(prev => ({ ...prev, event_type: key }));
              setSuccess(false);
            }}
            allowed={occasionPolicy.allowed}
            labelStyle={labelStyle}
            hintStyle={hintStyle}
          />
        )}
      </div>

      {/* ═══ RSVP SETTINGS ═══ */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
            <span style={iconBadgeStyle}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={COLORS.gold} strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></span>
            RSVP Settings
          </span>
        </h3>

        <div style={fieldGroupStyle}>
          <label style={labelStyle}>RSVP Deadline</label>
          <input type="datetime-local" value={form.rsvp_deadline} onChange={handleChange('rsvp_deadline')} style={inputStyle}
            onFocus={(e) => { e.target.style.borderColor = COLORS.gold; e.target.style.boxShadow = '0 0 0 3px rgba(184,148,79,0.1)'; }}
            onBlur={(e) => { e.target.style.borderColor = COLORS.border; e.target.style.boxShadow = 'none'; }}
          />
        </div>

        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Event Link Type</label>
          <div className="es-privacy-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {PRIVACY_MODES.map((pm) => {
              const active = form.privacy_mode === pm.key;
              return (
                <div key={pm.key}
                  onClick={() => { setForm(prev => ({ ...prev, privacy_mode: pm.key })); setSuccess(false); }}
                  style={{
                    padding: '16px 14px', borderRadius: 12, textAlign: 'center', cursor: 'pointer',
                    border: active ? `2px solid ${COLORS.gold}` : `1px solid ${COLORS.border}`,
                    background: active ? 'rgba(184,148,79,0.04)' : COLORS.white,
                    transform: active ? 'scale(1.02)' : 'scale(1)',
                    transition: 'all 0.25s cubic-bezier(0.16,1,0.3,1)',
                  }}
                >
                  <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', marginBottom: 6 }}>
                    <Icon name={pm.icon} size={22} color={COLORS.gold} strokeWidth={1.4} />
                  </div>
                  <div style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, color: COLORS.charcoal }}>{pm.label}</div>
                  <div style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fx-micro)', color: COLORS.stone, marginTop: 4, lineHeight: 1.55 }}>{pm.desc}</div>
                </div>
              );
            })}
          </div>
          {form.privacy_mode === 'password' && (
            <div style={{ marginTop: 14 }}>
              <label style={labelStyle}>Access Passcode</label>
              <input value={form.access_password} onChange={handleChange('access_password')} type="text"
                placeholder={hasAccessPassword ? 'Passcode is set — leave blank to keep it' : 'Enter access passcode'}
                style={inputStyle}
                onFocus={(e) => { e.target.style.borderColor = COLORS.gold; }}
                onBlur={(e) => { e.target.style.borderColor = COLORS.border; }}
              />
              {!hasAccessPassword && !form.access_password.trim() && (
                <p style={{ fontSize: '11px', color: COLORS.stone, marginTop: '6px' }}>No passcode set yet — guests won&apos;t be able to access this event until you set one.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ═══ DRESS CODE ═══ */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
            <span style={iconBadgeStyle}><Icon name="dressCode" size={15} color={COLORS.gold} strokeWidth={1.7} /></span>
            Dress Code
          </span>
        </h3>

        {!customDressMode ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {DRESS_CODES.filter(Boolean).map((code) => (
              <button key={code} type="button" onClick={() => { setForm(prev => ({ ...prev, dress_code: code })); setSuccess(false); }}
                style={pillStyle(form.dress_code === code)}>
                {code}
              </button>
            ))}
            <button type="button" onClick={() => setCustomDressMode(true)} style={pillStyle(false)}>
              Custom…
            </button>
          </div>
        ) : (
          <div style={fieldGroupStyle}>
            <input value={form.dress_code} onChange={handleChange('dress_code')} placeholder="Black Tie, Cocktail, Casual…" style={inputStyle}
              onFocus={(e) => { e.target.style.borderColor = COLORS.gold; }}
              onBlur={(e) => { e.target.style.borderColor = COLORS.border; }}
            />
            <button type="button" onClick={() => { setCustomDressMode(false); setForm(prev => ({ ...prev, dress_code: '' })); }}
              style={{ marginTop: 8, background: 'none', border: 'none', color: COLORS.gold, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)', padding: 0 }}>
              ← Choose from presets instead
            </button>
          </div>
        )}

        <div style={{ ...fieldGroupStyle, marginTop: 16 }}>
          <label style={labelStyle}>
            <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
              <Icon name="globe" size={12} strokeWidth={1.7} /> Arabic Dress Code <span style={{ fontSize: '11px', color: '#999', fontWeight: 400 }}>(optional)</span>
            </span>
          </label>
          <input
            value={templateData.dress_code_ar || ''}
            onChange={(e) => { setTemplateData(prev => ({ ...prev, dress_code_ar: e.target.value })); setSuccess(false); }}
            placeholder="ملابس رسمية، كاجوال..."
            dir="rtl"
            style={{ ...inputStyle, fontFamily: "'Noto Sans Arabic', 'Segoe UI', sans-serif" }}
            onFocus={(e) => { e.target.style.borderColor = COLORS.gold; e.target.style.boxShadow = '0 0 0 3px rgba(184,148,79,0.1)'; }}
            onBlur={(e) => { e.target.style.borderColor = COLORS.border; e.target.style.boxShadow = 'none'; }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginTop: 16 }}>
          <div style={fieldGroupStyle}>
            <label style={labelStyle}>Guidance for Ladies <span style={{ fontSize: '11px', color: '#999', fontWeight: 400 }}>(optional)</span></label>
            <textarea
              value={templateData.ha_dress_ladies}
              onChange={(e) => { setTemplateData(prev => ({ ...prev, ha_dress_ladies: e.target.value })); setSuccess(false); }}
              placeholder="Formal dresses in elegant, polished styles are encouraged."
              rows={2} style={{ ...inputStyle, resize: 'vertical' }}
              onFocus={(e) => { e.target.style.borderColor = COLORS.gold; e.target.style.boxShadow = '0 0 0 3px rgba(184,148,79,0.1)'; }}
              onBlur={(e) => { e.target.style.borderColor = COLORS.border; e.target.style.boxShadow = 'none'; }}
            />
          </div>
          <div style={fieldGroupStyle}>
            <label style={labelStyle}>Guidance for Gentlemen <span style={{ fontSize: '11px', color: '#999', fontWeight: 400 }}>(optional)</span></label>
            <textarea
              value={templateData.ha_dress_gentlemen}
              onChange={(e) => { setTemplateData(prev => ({ ...prev, ha_dress_gentlemen: e.target.value })); setSuccess(false); }}
              placeholder="Well-tailored suits with classic dress shoes are preferred."
              rows={2} style={{ ...inputStyle, resize: 'vertical' }}
              onFocus={(e) => { e.target.style.borderColor = COLORS.gold; e.target.style.boxShadow = '0 0 0 3px rgba(184,148,79,0.1)'; }}
              onBlur={(e) => { e.target.style.borderColor = COLORS.border; e.target.style.boxShadow = 'none'; }}
            />
          </div>
        </div>
      </div>
      </>
      )}

      {activeTab === 'design' && (
      <>
      {/* ═══ VISUAL TEMPLATE ═══
          The SAME cards the creation wizard shows, not a second, plainer
          picker. This screen used to draw its own: a text button with one
          colour dot, no artwork at all — so the place where you change a LIVE
          event's look was the worse of the two views of the same decision.
          TemplateCard renders each template's real hero still, and its swatch
          row doubles as the palette control below. */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
            <span style={iconBadgeStyle}><Icon name="palette" size={15} color={COLORS.gold} strokeWidth={1.7} /></span>
            Template
          </span>
        </h3>
        {event?.template_type && !TEMPLATES.some(t => t.key === event.template_type) && (
          <p style={{ fontSize: 12, color: COLORS.stone, margin: '0 0 12px', fontFamily: 'var(--font-sans)' }}>
            Currently using <strong style={{ color: COLORS.charcoal }}>{event.template_type}</strong> — an earlier template style. Pick one below to switch to a currently-offered template.
          </p>
        )}
        <div className="fx-grid fx-grid--5 fx-grid--gap-sm">
          {TEMPLATES.map((t, i) => (
            <TemplateCard
              key={t.key}
              template={t}
              index={i}
              isSelected={form.template_type === t.key}
              onSelect={(key) => { setForm(prev => ({ ...prev, template_type: key })); setSuccess(false); }}
              activePresetIndex={t.key === form.template_type ? Math.max(activePaletteIndex, 0) : 0}
              onPresetSelect={(key, pi) => applyPalette(t.presets[pi])}
              customConfig={customDesignConfig}
            />
          ))}
        </div>
        {form.template_type && form.template_type !== (event?.template_type || '') && (
          <InlineWarning>
            Switching templates may hide, or require re-entering, content the new template expects — double check your Content &amp; Sections tab after saving.
          </InlineWarning>
        )}
      </div>

      {/* ═══ COLOUR PALETTE ═══ */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
            <span style={iconBadgeStyle}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={COLORS.gold} strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg></span>
            Colour palette
          </span>
        </h3>

        {isCustomTemplate ? (
          /* Custom Canvas owns its own colour control, and it is the only one
             on this screen. There used to be TWO: these four hex fields wrote
             `custom_colors` (which is what buildPalette actually reads) while
             the panel below wrote `template_data.customDesign` (which only
             reaches the small invitation card). The wizard syncs the two; this
             screen never did, so an organizer could rebuild their palette here
             and watch the page ignore it. `applyPalette` inside onChange is
             that missing sync. */
          <>
            <p style={{ fontSize: '12.5px', color: COLORS.stone, lineHeight: 1.6, margin: '0 0 12px', fontFamily: 'var(--font-sans)' }}>
              Custom Canvas is yours to colour — these are the settings your guests&apos; page is built from.
            </p>
            <CustomBuilder
              config={customDesignConfig}
              onChange={(patch) => {
                const next = { ...customDesignConfig, ...patch };
                setTemplateData(prev => ({ ...prev, customDesign: next }));
                applyPalette(next);
                setSuccess(false);
              }}
            />
          </>
        ) : (
          <>
            <p style={{ fontSize: '12.5px', color: COLORS.stone, lineHeight: 1.6, margin: '0 0 12px', fontFamily: 'var(--font-sans)' }}>
              Each palette is tuned for this template — the headings, labels, dividers, buttons and paper are derived from it together, so the page stays legible whichever you pick.
            </p>
            <div role="radiogroup" aria-label="Colour palette" className="fx-grid fx-grid--5 fx-grid--gap-sm">
              {activePalettes.map((p, i) => {
                const active = i === activePaletteIndex;
                /* The DERIVED palette, not the four raw values. buildPalette is
                   what the page actually renders from: it lifts a dark primary
                   on a dark ground, darkens a pale one on a pale ground, and
                   picks the body-copy tone from both. Swatching the raw hexes
                   would show three colours the guest never sees — and on a
                   template whose palettes are all deep velvets, three
                   near-identical dark rectangles. */
                const pal = buildPalette(p, effectiveTemplateType);
                return (
                  <button
                    key={p.name} type="button" role="radio" aria-checked={active}
                    onClick={() => applyPalette(p)}
                    style={{
                      display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left',
                      padding: 10, borderRadius: 12, cursor: 'pointer',
                      border: `1.5px solid ${active ? COLORS.gold : COLORS.border}`,
                      background: active ? 'rgba(184,148,79,0.06)' : COLORS.white,
                      boxShadow: active ? '0 4px 16px rgba(184,148,79,0.15)' : 'none',
                      transition: 'all 0.2s',
                    }}
                  >
                    {/* A miniature of the page, not a row of dots: the paper,
                        a heading on it, the eyebrow label above, a divider and
                        a line of body copy. What is being chosen here is the
                        RELATIONSHIP between the colours — whether the heading
                        reads on the paper — and only stacking them shows it. */}
                    <span aria-hidden style={{
                      display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 5,
                      height: 84, borderRadius: 8, padding: '0 12px',
                      background: pal.background, border: `1px solid ${COLORS.border}`,
                    }}>
                      {/* The eyebrow is a BAR, not the words "Save the date"
                          at 7px. Real type that small is unreadable, and
                          test/mobileFit.test.js's reading floor is right to
                          reject it on a settings screen — the bar carries the
                          same colour with nothing to squint at. */}
                      <span style={{ display: 'block', width: 34, height: 3, borderRadius: 2, background: pal.gold }} />
                      <span style={{ fontFamily: 'var(--font-serif)', fontSize: 17, lineHeight: 1.1, color: pal.maroon }}>
                        Aria &amp; Julian
                      </span>
                      <span style={{ display: 'block', width: 26, height: 1, background: pal.gold, opacity: 0.8 }} />
                      <span style={{ display: 'block', height: 3, borderRadius: 2, background: pal.ink, opacity: 0.35 }} />
                    </span>
                    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 700, color: COLORS.charcoal }}>{p.name}</span>
                  </button>
                );
              })}
            </div>

            {/* An event whose saved colours match no palette — set before these
                existed, or through the API. Shown rather than silently
                replaced: this screen must not throw away a choice just because
                it can no longer name it. */}
            {activePaletteIndex === -1 && (
              <div style={{
                display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 12,
                padding: '10px 12px', borderRadius: 10,
                background: COLORS.softBg, border: `1px solid ${COLORS.border}`,
              }}>
                <span aria-hidden style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 'none' }}>
                  {[form.primary_color, form.secondary_color, form.background_color].map((c, i) => (
                    <span key={i} style={{ width: 16, height: 16, borderRadius: '50%', background: c, border: `1px solid ${COLORS.border}` }} />
                  ))}
                </span>
                <span className="fx-min0" style={{ flex: '1 1 200px', minWidth: 0, fontSize: 12, color: COLORS.stone, lineHeight: 1.5, fontFamily: 'var(--font-sans)' }}>
                  Your event is on its own colours. They stay exactly as they are until you pick a palette above.
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* ═══ IMAGES ═══
          Was one "Appearance" section holding the cover image, the gallery,
          the colours, both font pickers, the Custom builder AND the background
          music — six unrelated decisions under one heading, with an audio
          uploader filed under how the page looks. Split into what each part
          actually is. */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
            <span style={iconBadgeStyle}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={COLORS.gold} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>
              </svg>
            </span>
            Images
          </span>
        </h3>

        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Cover Image</label>
          <div
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = COLORS.gold; e.currentTarget.style.background = 'rgba(184,148,79,0.04)'; }}
            onDragLeave={(e) => { e.currentTarget.style.borderColor = COLORS.border; e.currentTarget.style.background = COLORS.softBg; }}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.style.borderColor = COLORS.border;
              e.currentTarget.style.background = COLORS.softBg;
              const file = e.dataTransfer.files?.[0];
              if (file && file.type.startsWith('image/')) {
                const dt = new DataTransfer();
                dt.items.add(file);
                const input = e.currentTarget.querySelector('input[type="file"]');
                if (input) { input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); }
              }
            }}
            style={{
              marginTop: '8px', padding: '16px', borderRadius: '12px',
              border: `2px dashed ${COLORS.border}`, background: COLORS.softBg,
              textAlign: 'center', transition: 'all 0.2s', cursor: 'pointer',
            }}
          >
            <input
              type="file" accept="image/*" onChange={handleCoverUpload}
              disabled={coverUploading}
              style={{ display: 'none' }} id="cover-file-upload"
            />
            <label htmlFor="cover-file-upload" style={{
              cursor: coverUploading ? 'wait' : 'pointer', display: 'flex',
              flexDirection: 'column', alignItems: 'center', gap: '8px',
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.stone} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="3"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <path d="m21 15-5-5L5 21"/>
              </svg>
              <span style={{ fontSize: '12px', fontWeight: 600, color: COLORS.stone }}>
                {coverUploading ? 'Uploading…' : 'Drop image here or click to browse'}
              </span>
              <span style={{ fontSize: 'var(--fx-micro)', color: '#A09A91' }}>JPG, PNG, WebP • Max 8MB</span>
            </label>
          </div>

          {form.cover_image_url && (
            <div style={{
              marginTop: '10px', borderRadius: '12px', overflow: 'hidden',
              border: `1px solid ${COLORS.border}`, height: '140px',
              background: COLORS.softBg, position: 'relative',
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={form.cover_image_url} alt="Cover preview"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={(e) => { e.target.style.display = 'none'; }}
              />
              <div style={{
                position: 'absolute', inset: 0,
                background: 'linear-gradient(to top, rgba(0,0,0,0.3) 0%, transparent 50%)',
              }} />
              <button type="button"
                onClick={() => { setForm(prev => ({ ...prev, cover_image_url: '' })); setSuccess(false); }}
                style={{
                  position: 'absolute', top: 8, right: 8, width: 28, height: 28,
                  borderRadius: '50%', border: 'none', background: 'rgba(25,27,30,0.7)',
                  color: '#fff', cursor: 'pointer', fontSize: 14, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                }}
              >×</button>
            </div>
          )}
        </div>

        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Photo Gallery</label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: galleryUploading ? 'wait' : 'pointer',
              padding: '10px 16px', borderRadius: '8px', border: `1px solid ${COLORS.gold}`, color: COLORS.gold,
              fontSize: '13px', fontWeight: 700, fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap',
              opacity: galleryUploading ? 0.6 : 1,
            }}>
              {galleryUploading ? 'Uploading…' : '⬆ Upload'}
              <input type="file" accept="image/*" multiple onChange={handleGalleryUpload} disabled={galleryUploading} style={{ display: 'none' }} />
            </label>
          </div>
          {form.gallery_urls.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '12px' }}>
              {form.gallery_urls.map((url, i) => (
                <div key={i} style={{ position: 'relative', width: 84, height: 84, borderRadius: '10px', overflow: 'hidden', border: `1px solid ${COLORS.border}`, background: COLORS.softBg }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Gallery ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => { e.target.style.display = 'none'; }} />
                  <button type="button" onClick={() => removeGalleryUrl(i)} title="Remove"
                    style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'rgba(25,27,30,0.75)', color: '#fff', cursor: 'pointer', fontSize: 13, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* ═══ TYPOGRAPHY ═══ */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
            <span style={iconBadgeStyle}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={COLORS.gold} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 7V5h16v2M9 5v14M15 5v14M7 19h4M13 19h4"/>
              </svg>
            </span>
            Typography
          </span>
        </h3>
        <p style={{ fontSize: '12.5px', color: COLORS.stone, lineHeight: 1.6, margin: '0 0 12px', fontFamily: 'var(--font-sans)' }}>
          {isCustomTemplate
            ? 'Headings follow the face you picked in the palette panel above. This sets the body copy underneath them.'
            : 'Applied to every heading and every line of body copy on the invitation page.'}
        </p>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          {/* Custom Canvas already chooses its heading face in CustomBuilder,
              and that pick is the more specific one (HeritageArchPage lets it
              win). Showing both would be two controls for one decision. */}
          {!isCustomTemplate && (
            <FontPicker
              label="Heading Font"
              value={form.font_heading}
              onChange={(val) => { setForm(prev => ({ ...prev, font_heading: val })); setSuccess(false); }}
            />
          )}
          <FontPicker
            label="Body Font"
            value={form.font_body}
            onChange={(val) => { setForm(prev => ({ ...prev, font_body: val })); setSuccess(false); }}
          />
        </div>
      </div>

      {/* ═══ BACKGROUND MUSIC ═══ */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
            <span style={iconBadgeStyle}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={COLORS.gold} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
              </svg>
            </span>
            Background Music
          </span>
        </h3>

        <div style={fieldGroupStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
              <input
                type="file"
                accept="audio/*"
                onChange={handleMusicUpload}
                disabled={musicUploading}
                style={{ display: 'none' }}
                id="music-file-upload"
              />
              <label
                htmlFor="music-file-upload"
                style={{
                  padding: '8px 16px', minHeight: 'var(--fx-touch)',
                  backgroundColor: COLORS.softBg,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: '10px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: COLORS.stone,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'background-color 0.2s',
                  userSelect: 'none'
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                {musicUploading ? 'Uploading...' : 'Choose Audio File'}
              </label>

              {form.background_music_url && (
                <button
                  type="button"
                  onClick={() => { setForm(prev => ({ ...prev, background_music_url: '' })); setSuccess(false); }}
                  style={{
                    padding: '8px 12px', minHeight: 'var(--fx-touch)',
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    fontSize: '12px',
                    color: '#C45E5E',
                    fontWeight: 500
                  }}
                >
                  Remove Music
                </button>
              )}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', margin: '2px 0' }}>
              <div style={{ flex: 1, height: 1, background: COLORS.border }} />
              <span style={{ fontSize: '11px', color: COLORS.stone, fontWeight: 600 }}>or</span>
              <div style={{ flex: 1, height: 1, background: COLORS.border }} />
            </div>
            <input
              type="url"
              value={form.background_music_url || ''}
              onChange={e => setForm(prev => ({ ...prev, background_music_url: e.target.value }))}
              placeholder="Paste a YouTube link (e.g. https://youtu.be/…)"
              style={inputStyle}
            />

            {form.background_music_url && (
              extractYouTubeId(form.background_music_url) ? (
                musicEmbedStatus === 'blocked' ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginTop: '4px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(196,94,94,0.06)', border: '1px solid rgba(196,94,94,0.25)' }}>
                    <Icon name="warning" size={14} color="#C45E5E" strokeWidth={1.6} />
                    <span style={{ fontSize: '12px', color: '#C45E5E', flex: 1, lineHeight: 1.5 }}>
                      This video can&apos;t be played embedded on other sites — a common restriction on official music videos. Guests won&apos;t hear it. Try a lyric video, cover, or a different link.
                    </span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginTop: '4px', padding: '8px 12px', borderRadius: '8px', background: COLORS.softBg, border: `1px solid ${COLORS.border}` }}>
                    <Icon name={musicEmbedStatus === 'checking' ? 'hourglass' : 'play'} size={14} color={COLORS.gold} strokeWidth={1.4} />
                    <span style={{ fontSize: '12px', color: COLORS.charcoal, flex: 1 }}>
                      {musicEmbedStatus === 'checking' ? 'Checking this video can be played…' : 'YouTube song linked — guests tap the music icon to play it'}
                    </span>
                  </div>
                )
              ) : (
                <div style={{ marginTop: '4px' }}>
                  <audio
                    src={form.background_music_url}
                    controls
                    style={{ width: '100%', height: '36px', borderRadius: '8px' }}
                  />
                </div>
              )
            )}
          </div>
          <span style={{ fontSize: '11px', color: COLORS.stone, display: 'block', marginTop: '6px' }}>
            Upload an audio file, or paste a YouTube link, to play music on the public event page.
          </span>
        </div>
      </div>

      {/* ═══ THE OPENING ═══
          Was headed "Invitation Seal & Stationery" and described a wax
          envelope for every template. Two of the three do not have one:
          Velvet Ring opens on a velvet box, Door of Joy on a door you knock
          three times (see EventPageClient's opening branch). `seal_text` and
          `reveal_tone` are read only by InvitationReveal, so on those two the
          fields below them were dead controls — and "Preview the envelope"
          showed an envelope their guests will never see.

          `opening` resolves what this event actually opens with, and every
          label, the seal fields and the preview follow from it. */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
            <span style={iconBadgeStyle}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={COLORS.gold} strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/></svg></span>
            {opening.title}
          </span>
        </h3>
        <p style={{ fontSize: '12.5px', color: COLORS.stone, lineHeight: 1.6, margin: '0 0 14px', fontFamily: 'var(--font-sans)' }}>
          {opening.intro}
        </p>

        {opening.hasSeal && (
          <>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Seal Name / Monogram</label>
              <input value={templateData.seal_text} onChange={(e) => setTemplateData(prev => ({ ...prev, seal_text: e.target.value }))}
                placeholder="Auto from event name" maxLength={24} style={inputStyle}
                onFocus={(e) => { e.target.style.borderColor = COLORS.gold; e.target.style.boxShadow = '0 0 0 3px rgba(184,148,79,0.1)'; }}
                onBlur={(e) => { e.target.style.borderColor = COLORS.border; e.target.style.boxShadow = 'none'; }}
              />
              <span style={{ fontSize: '11px', color: COLORS.stone, display: 'block', marginTop: '6px' }}>
                Engraved on the gold wax seal. Leave blank and we&apos;ll use your event name.
              </span>
            </div>

            {/* Wax & paper tone. Curated presets rather than a colour picker —
                the envelope is photography, and an arbitrary hex applied to it
                stops looking like paper. See REVEAL_TONES. */}
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Wax &amp; paper tone</label>
              <div role="radiogroup" aria-label="Wax and paper tone" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {Object.entries(REVEAL_TONES).map(([key, t]) => {
                  const active = (templateData.reveal_tone || 'classic') === key;
                  return (
                    <button
                      key={key} type="button" role="radio" aria-checked={active}
                      onClick={() => { setTemplateData(prev => ({ ...prev, reveal_tone: key })); setSuccess(false); }}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '8px',
                        padding: '8px 14px', minHeight: 'var(--fx-touch)', cursor: 'pointer',
                        borderRadius: '10px', fontFamily: 'var(--font-sans)', fontSize: '12.5px', fontWeight: 600,
                        border: `1px solid ${active ? COLORS.gold : COLORS.border}`,
                        background: active ? 'rgba(184,148,79,0.08)' : COLORS.white,
                        color: COLORS.charcoal,
                      }}
                    >
                      <span aria-hidden style={{ width: 14, height: 14, borderRadius: '50%', background: t.swatch, border: '1px solid rgba(0,0,0,.12)', flex: 'none' }} />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '4px' }}>
          <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '10px', fontSize: '13px', color: '#191B1E', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={form.reveal_enabled}
              onChange={(e) => { setForm(prev => ({ ...prev, reveal_enabled: e.target.checked })); setSuccess(false); }}
              style={{ width: '16px', height: '16px', marginTop: '2px', accentColor: COLORS.gold, cursor: 'pointer' }}
            />
            <span>
              {opening.toggleLabel}
              <span style={{ display: 'block', color: '#77736A', fontSize: '12px', marginTop: '3px', fontWeight: 400, lineHeight: 1.5 }}>
                {opening.toggleHint}
              </span>
            </span>
          </label>

          <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '10px', fontSize: '13px', color: form.reveal_enabled ? '#191B1E' : '#A9A399', cursor: form.reveal_enabled ? 'pointer' : 'default', userSelect: 'none' }}>
            <input
              type="checkbox"
              disabled={!form.reveal_enabled}
              checked={form.reveal_replay}
              onChange={(e) => { setForm(prev => ({ ...prev, reveal_replay: e.target.checked })); setSuccess(false); }}
              style={{ width: '16px', height: '16px', marginTop: '2px', accentColor: COLORS.gold, cursor: form.reveal_enabled ? 'pointer' : 'default' }}
            />
            <span>
              {opening.replayLabel}
              <span style={{ display: 'block', color: '#77736A', fontSize: '12px', marginTop: '3px', fontWeight: 400, lineHeight: 1.5 }}>
                On by default. Turn it off and a returning guest sees it only once per browser session. (The RSVP form&apos;s envelope is always once per session — it would be tiresome to replay it mid-form.)
              </span>
            </span>
          </label>
        </div>

        <button
          type="button"
          onClick={() => setRevealPreviewOpen(true)}
          disabled={!form.reveal_enabled}
          style={{
            marginTop: '16px', padding: '10px 18px', minHeight: '42px',
            background: form.reveal_enabled ? COLORS.charcoal : COLORS.border,
            color: form.reveal_enabled ? COLORS.white : '#8A857B',
            border: 'none', borderRadius: '30px', cursor: form.reveal_enabled ? 'pointer' : 'not-allowed',
            fontFamily: 'var(--font-sans)', fontSize: '12.5px', fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', gap: '7px',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
          {opening.previewLabel}
        </button>
      </div>

      {revealPreviewOpen && (
        <RevealPreviewModal
          onClose={() => setRevealPreviewOpen(false)}
          opening={opening}
          lang={templateData.title_ar ? 'ar' : 'en'}
          event={{
            // Built from the CURRENT form, not from the saved event, so the
            // organizer previews the edit they are making rather than the one
            // they made last time.
            slug: 'demo',            // keeps previews out of the reveal funnel
            title: form.title,
            title_ar: templateData.title_ar,
            event_date: form.event_date,
            template_type: effectiveTemplateType,
            custom_colors: { primary: form.primary_color, secondary: form.secondary_color, accent: form.accent_color },
            template_data: { ...event?.template_data, ...templateData },
          }}
        />
      )}

      </>
      )}

      {activeTab === 'content' && (
      <>
      {/* ═══ TEMPLATE-SPECIFIC CONTENT ═══ */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
            <span style={iconBadgeStyle}><Icon name="book" size={15} color={COLORS.gold} strokeWidth={1.7} /></span>
            Content
          </span>
        </h3>

        {occasionMeta?.kind === 'honoree' && (
          <div className="es-row" style={rowStyle}>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>{occasionMeta.honoreeLabel}</label>
              <input value={templateData.custom_honoree} onChange={(e) => setTemplateData(prev => ({ ...prev, custom_honoree: e.target.value }))}
                placeholder={occasionMeta.honoreePlaceholder} style={inputStyle} />
              {occasionMeta.honoreeHint && <span style={hintStyle}>{occasionMeta.honoreeHint}</span>}
            </div>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>{occasionMeta.milestoneLabel}</label>
              <input value={templateData.custom_milestone} onChange={(e) => setTemplateData(prev => ({ ...prev, custom_milestone: e.target.value }))}
                placeholder={occasionMeta.milestonePlaceholder} style={inputStyle} />
              {occasionMeta.milestoneHint && <span style={hintStyle}>{occasionMeta.milestoneHint}</span>}
            </div>
          </div>
        )}

        {occasionMeta?.kind === 'babyShower' && (
          <>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Parent(s)-to-be</label>
              <input value={templateData.custom_parents} onChange={(e) => setTemplateData(prev => ({ ...prev, custom_parents: e.target.value }))}
                placeholder="e.g. Sarah & Michael" style={inputStyle} />
              <span style={hintStyle}>Shown as the name on your guest page</span>
            </div>
            <div className="es-row" style={rowStyle}>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Baby&apos;s Name</label>
                <input value={templateData.custom_baby_name} onChange={(e) => setTemplateData(prev => ({ ...prev, custom_baby_name: e.target.value }))}
                  placeholder="Leave blank if unrevealed" style={inputStyle} />
              </div>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Due Date / Theme</label>
                <input value={templateData.custom_baby_due} onChange={(e) => setTemplateData(prev => ({ ...prev, custom_baby_due: e.target.value }))}
                  placeholder="e.g. Due June 2026" style={inputStyle} />
              </div>
            </div>
          </>
        )}

        {form.event_type === 'wedding' && (
          <div style={{ marginTop: '16px', padding: '16px', background: COLORS.softBg, borderRadius: '8px', border: `1px solid ${COLORS.border}` }}>
            <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: 600, color: COLORS.charcoal }}>Wedding Template Details</h4>
            <div className="es-row" style={rowStyle}>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Groom&apos;s Name</label>
                <input value={templateData.partner1} onChange={(e) => setTemplateData(prev => ({ ...prev, partner1: e.target.value }))} placeholder="Groom Name" style={inputStyle} />
              </div>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Bride&apos;s Name</label>
                <input value={templateData.partner2} onChange={(e) => setTemplateData(prev => ({ ...prev, partner2: e.target.value }))} placeholder="Bride Name" style={inputStyle} />
              </div>
            </div>
            <div className="es-row" style={rowStyle}>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Groom&apos;s Email</label>
                <input type="email" value={templateData.partner1_email} onChange={(e) => setTemplateData(prev => ({ ...prev, partner1_email: e.target.value }))} placeholder="groom@email.com" style={inputStyle} />
                <span style={hintStyle}>Optional — if set, they&apos;ll also get an email whenever a guest RSVPs</span>
              </div>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Bride&apos;s Email</label>
                <input type="email" value={templateData.partner2_email} onChange={(e) => setTemplateData(prev => ({ ...prev, partner2_email: e.target.value }))} placeholder="bride@email.com" style={inputStyle} />
                <span style={hintStyle}>Optional — if set, they&apos;ll also get an email whenever a guest RSVPs</span>
              </div>
            </div>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Family Names / Hosts</label>
              <input value={templateData.family_names} onChange={(e) => setTemplateData(prev => ({ ...prev, family_names: e.target.value }))} placeholder="The Smith & Jones Families" style={inputStyle} />
            </div>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Gift Registry URL</label>
              <input type="url" value={templateData.giftRegistry} onChange={(e) => setTemplateData(prev => ({ ...prev, giftRegistry: e.target.value }))} placeholder="https://registry.example.com" style={inputStyle} />
            </div>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Guest Accommodations</label>
              <textarea value={templateData.accommodations} onChange={(e) => setTemplateData(prev => ({ ...prev, accommodations: e.target.value }))}
                rows={2} placeholder="Hotel blocks, parking info…" style={{ ...inputStyle, resize: 'vertical' }} />
              {isFullPage(event?.template_type) && <span style={hintStyle}>Shown to guests only as a fallback note, and only if no hotels are added in the Accommodation list below</span>}
            </div>
            {/* Full-page templates have their own Day 1 / Day 2 venue pickers
                below — a single Ceremony/Reception pair doesn't fit a multi-day site. */}
            {!isFullPage(event?.template_type) && (
              <>
                <div style={fieldGroupStyle}>
                  <label style={labelStyle}>Our Love Story</label>
                  <textarea value={templateData.loveStory} onChange={(e) => setTemplateData(prev => ({ ...prev, loveStory: e.target.value }))}
                    rows={3} placeholder="Share your beautiful story…" style={{ ...inputStyle, resize: 'vertical' }} />
                </div>
                <div className="es-row" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
                  <div style={fieldGroupStyle}>
                    <label style={labelStyle} htmlFor="es-ceremony-venue">Ceremony Venue</label>
                    <PlacesAutocomplete
                      id="es-ceremony-venue"
                      value={templateData.ceremony_venue_name}
                      onChange={(val) => setTemplateData(prev => ({ ...prev, ceremony_venue_name: val }))}
                      onPlaceSelect={makeTemplatePlaceSelectHandler('ceremony')}
                      placeholder="Search for the ceremony venue..."
                    />
                    <span style={hintStyle}>Search and pick where the ceremony takes place</span>
                  </div>
                  <div style={fieldGroupStyle}>
                    <label style={labelStyle}>Ceremony Time</label>
                    <input type="time" value={templateData.ceremony_time_of_day} onChange={(e) => setTemplateData(prev => ({ ...prev, ceremony_time_of_day: e.target.value }))} style={inputStyle} />
                  </div>
                </div>
                <div className="es-row" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
                  <div style={fieldGroupStyle}>
                    <label style={labelStyle} htmlFor="es-reception-venue">Reception Venue</label>
                    <PlacesAutocomplete
                      id="es-reception-venue"
                      value={templateData.reception_venue_name}
                      onChange={(val) => setTemplateData(prev => ({ ...prev, reception_venue_name: val }))}
                      onPlaceSelect={makeTemplatePlaceSelectHandler('reception')}
                      placeholder="Search for the reception venue..."
                    />
                    <span style={hintStyle}>Search and pick where the reception takes place</span>
                  </div>
                  <div style={fieldGroupStyle}>
                    <label style={labelStyle}>Reception Time</label>
                    <input type="time" value={templateData.reception_time_of_day} onChange={(e) => setTemplateData(prev => ({ ...prev, reception_time_of_day: e.target.value }))} style={inputStyle} />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Sealed Letter's hero is the only one the organizer fills in. The
            SAME component the create-event wizard mounts — one copy of the
            control and one copy of its wording, so the screen they create on
            and the screen they edit on cannot describe it differently. */}
        {/* effectiveTemplateType, not event.template_type: this screen lets the
            organizer change the Visual Template, and gating on the SAVED value
            means picking Sealed Letter here shows no portrait fields until
            after a save — a control that appears only once you have already
            committed to it. Same live value occasionPolicy and isCustomTemplate
            read. */}
        {effectiveTemplateType === 'letter' && (
          <div style={{ marginTop: '16px', padding: '16px', background: COLORS.softBg, borderRadius: '8px', border: `1px solid ${COLORS.border}` }}>
            <h4 style={{ margin: '0 0 4px 0', fontSize: '13px', fontWeight: 600, color: COLORS.charcoal }}>The Portrait</h4>
            <span style={hintStyle}>Your photograph goes inside the carved frame your guests open onto. Leave it empty and the frame keeps its own illustration.</span>
            <div style={{ marginTop: 12 }}>
              <LetterPortraitFields
                value={templateData}
                onChange={(patch) => setTemplateData(prev => ({ ...prev, ...patch }))}
                onUploadImage={(file) => uploadFile(file, 'portraits')}
                onError={(msg) => toast.error(msg)}
              />
            </div>
          </div>
        )}

        {isFullPage(event?.template_type) && (
          <div style={{ marginTop: '16px', padding: '16px', background: COLORS.softBg, borderRadius: '8px', border: `1px solid ${COLORS.border}` }}>
            <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: 600, color: COLORS.charcoal }}>Full-Page Guest Experience</h4>
            <span style={hintStyle}>Each section below appears on the guest page only when you fill it in.</span>

            <div style={{ ...fieldGroupStyle, marginTop: 12 }}>
              <label style={labelStyle}>Our Story</label>
              <textarea value={templateData.ha_our_story} onChange={(e) => setTemplateData(prev => ({ ...prev, ha_our_story: e.target.value }))} placeholder="Tell your story…" rows={4} style={{ ...inputStyle, resize: 'vertical' }} />
            </div>

            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Closing Message <span style={{ fontSize: '11px', color: '#999', fontWeight: 400 }}>(optional)</span></label>
              <textarea value={templateData.ha_closing_message} onChange={(e) => setTemplateData(prev => ({ ...prev, ha_closing_message: e.target.value }))} placeholder="Looking forward to welcoming you" rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
            </div>

            {/* Meal options moved to the single "🍽 Add Meal Options" source in
                Custom RSVP Questions — the duplicate ha_meal_options input was
                removed here to match the create-event wizard. */}
            <div style={fieldGroupStyle}>
              <label style={labelStyle} htmlFor="es-ha-invited-to">&quot;You&apos;re Invited To&quot; City</label>
              <PlacesAutocomplete
                id="es-ha-invited-to"
                value={templateData.ha_invited_to_city}
                // Retyping the city without picking a fresh suggestion must clear the
                // old lat/lng — otherwise the guest page's map pin silently keeps
                // pointing at whatever city was last actually selected, while the
                // label text shows the new (unrelated) name typed here.
                onChange={(val) => setTemplateData(prev => ({ ...prev, ha_invited_to_city: val, ha_invited_to_lat: null, ha_invited_to_lng: null }))}
                onPlaceSelect={onHaInvitedToPlaceSelect}
                placeholder="Miami"
              />
              <span style={hintStyle}>Search and pick a city — its map pin uses this location, not Day 1&apos;s venue</span>
            </div>

            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Days, Venues &amp; Schedule</label>
              <span style={hintStyle}>Most events are one day — add more only if yours has several (e.g. a henna night, then the wedding, then a reception)</span>
              <DaysEditor
                days={templateData.ha_days}
                onChange={(nextDays) => { setTemplateData(prev => ({ ...prev, ha_days: nextDays })); setSuccess(false); }}
                onUploadImage={(file) => uploadFile(file, 'venues')}
              />
            </div>

            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Accommodation</label>
              <RepeatableListEditor
                items={templateData.ha_accommodation}
                onChange={(items) => setTemplateData(prev => ({ ...prev, ha_accommodation: items }))}
                onUploadImage={(file) => uploadFile(file, 'venues')}
                itemNoun="Hotel"
                addLabel="+ Add hotel"
                emptyLabel="No hotels yet — falls back to a sample hotel on the guest page."
                columns={[
                  { key: 'name', label: 'Hotel name', placeholder: 'Hotel Costa' },
                  { key: 'price', label: 'Price', placeholder: '$4,100' },
                  { key: 'link', label: 'Booking link', placeholder: 'https://…' },
                  { key: 'imageUrl', label: 'Photo', type: 'image' },
                  { key: 'description', label: 'Note', type: 'textarea', placeholder: 'Book directly for a discount' },
                ]}
              />
            </div>

            <div style={fieldGroupStyle}>
              <label style={labelStyle}>FAQ</label>
              <RepeatableListEditor
                items={templateData.ha_faq}
                onChange={(items) => setTemplateData(prev => ({ ...prev, ha_faq: items }))}
                itemNoun="Question"
                addLabel="+ Add question"
                emptyLabel="No FAQ items yet — falls back to sample questions on the guest page."
                columns={[
                  { key: 'question', label: 'Question', placeholder: 'Can I bring my children?' },
                  { key: 'answer', label: 'Answer', type: 'textarea', placeholder: 'Answer shown to guests…' },
                ]}
              />
            </div>

            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Menu</label>
              <RepeatableListEditor
                items={templateData.ha_menu_courses}
                onChange={(items) => setTemplateData(prev => ({ ...prev, ha_menu_courses: items }))}
                itemNoun="Course"
                addLabel="+ Add course"
                emptyLabel="No menu courses yet — the Menu section stays hidden until you add one."
                columns={[
                  { key: 'label', label: 'Course', placeholder: 'Starter' },
                  { key: 'name', label: 'Dish', placeholder: 'Burrata & Heirloom Tomatoes' },
                  { key: 'description', label: 'Description', type: 'textarea', placeholder: 'Shown under the dish name…' },
                ]}
              />
            </div>

            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Things to Do</label>
              <RepeatableListEditor
                items={templateData.ha_things_to_do}
                onChange={(items) => setTemplateData(prev => ({ ...prev, ha_things_to_do: items }))}
                itemNoun="Place"
                addLabel="+ Add place"
                emptyLabel="No places yet — the Things to Do section stays hidden until you add one."
                columns={[
                  { key: 'icon', label: 'Icon', type: 'select', placeholder: 'Icon', options: [
                    { value: 'mountain', label: 'Nature/Walk' }, { value: 'food', label: 'Restaurant' },
                    { value: 'water', label: 'Beach/Lake' }, { value: 'camera', label: 'Sightseeing' },
                    { value: 'drink', label: 'Bar/Café' }, { value: 'shopping', label: 'Shopping' },
                    { value: 'landmark', label: 'Landmark' }, { value: 'star', label: 'Other' },
                  ] },
                  { key: 'title', label: 'Title', placeholder: 'Walk by the lake' },
                  { key: 'description', label: 'Description', type: 'textarea', placeholder: 'Why guests should go…' },
                ]}
              />
            </div>

            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Getting There</label>
              <textarea value={templateData.ha_getting_there} onChange={(e) => setTemplateData(prev => ({ ...prev, ha_getting_there: e.target.value }))} placeholder="How to get there, parking, shuttle info…" rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
            </div>

            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Gift Registry Button Label</label>
              <input value={templateData.ha_gift_registry_label} onChange={(e) => setTemplateData(prev => ({ ...prev, ha_gift_registry_label: e.target.value }))} placeholder="Gift Registry" style={inputStyle} />
            </div>

            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Gift Message</label>
              <textarea value={templateData.ha_gift_message} onChange={(e) => setTemplateData(prev => ({ ...prev, ha_gift_message: e.target.value }))} placeholder="Your presence is your gift, but contributions can go to…" rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
            </div>

            <div className="es-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Bank Name</label>
                <input value={templateData.ha_gift_bank_name} onChange={(e) => setTemplateData(prev => ({ ...prev, ha_gift_bank_name: e.target.value }))} placeholder="KBC" style={inputStyle} />
              </div>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Account Holder</label>
                <input value={templateData.ha_gift_account_name} onChange={(e) => setTemplateData(prev => ({ ...prev, ha_gift_account_name: e.target.value }))} placeholder="Full name" style={inputStyle} />
              </div>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>IBAN</label>
                <input value={templateData.ha_gift_iban} onChange={(e) => setTemplateData(prev => ({ ...prev, ha_gift_iban: e.target.value }))} placeholder="BE89 5655 5224 55" style={inputStyle} />
              </div>
            </div>

            <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${COLORS.border}` }}>
              <SectionsOrderEditor templateData={templateData} setTemplateData={setTemplateData} />
            </div>
          </div>
        )}

        {isLegacyCategoryTemplate('corporate') && (
          <div style={{ marginTop: '16px', padding: '16px', background: COLORS.softBg, borderRadius: '8px', border: `1px solid ${COLORS.border}` }}>
            <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: 600, color: COLORS.charcoal }}>Corporate Template Details</h4>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Company Name / Host</label>
              <input value={templateData.company} onChange={(e) => setTemplateData(prev => ({ ...prev, company: e.target.value }))} placeholder="Acme Corporation" style={inputStyle} />
            </div>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Speakers (separated by commas)</label>
              <input value={templateData.speakers} onChange={(e) => setTemplateData(prev => ({ ...prev, speakers: e.target.value }))} placeholder="John Doe (CEO), Jane Smith (VP)" style={inputStyle} />
            </div>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Agenda / Timeline</label>
              <textarea value={templateData.agenda} onChange={(e) => setTemplateData(prev => ({ ...prev, agenda: e.target.value }))} placeholder="9:00 AM - Keynote&#10;10:30 AM - Panel Discussion" rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
            </div>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Sponsors</label>
              <textarea value={templateData.sponsors} onChange={(e) => setTemplateData(prev => ({ ...prev, sponsors: e.target.value }))} placeholder="Event sponsors…" rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
            </div>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Networking Notes</label>
              <textarea value={templateData.networkingNotes} onChange={(e) => setTemplateData(prev => ({ ...prev, networkingNotes: e.target.value }))} placeholder="Tips for networking, meet-and-greet details…" rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
            </div>
          </div>
        )}

        {/* Was gated on the literal `form.event_type === 'engagement'`, so a
            Custom-template event with a "couple" category (Wedding or Vow
            Renewal under Custom — event_type is 'custom' there, never
            'wedding' or 'engagement', per create-event/page.js's mapping)
            got NO partner name/email UI at all: fields it could set once
            during creation (Stage2_FormConfiguration uses the same
            showCoupleFields gate) became permanently unreachable in
            Settings afterward. `form.event_type !== 'wedding'` keeps this
            from also rendering alongside the richer wedding-only block
            above for real weddings, which already has its own copy of
            these same two fields. */}
        {showCoupleFields && form.event_type !== 'wedding' && (
          <div style={{ marginTop: '16px', padding: '16px', background: COLORS.softBg, borderRadius: '8px', border: `1px solid ${COLORS.border}` }}>
            <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: 600, color: COLORS.charcoal }}>{form.event_type === 'engagement' ? 'Engagement Template Details' : 'Couple Details'}</h4>
            <div className="es-row" style={rowStyle}>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Partner 1 Name</label>
                <input value={templateData.partner1} onChange={(e) => setTemplateData(prev => ({ ...prev, partner1: e.target.value }))} placeholder="First partner name" style={inputStyle} />
              </div>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Partner 2 Name</label>
                <input value={templateData.partner2} onChange={(e) => setTemplateData(prev => ({ ...prev, partner2: e.target.value }))} placeholder="Second partner name" style={inputStyle} />
              </div>
            </div>
            <div className="es-row" style={rowStyle}>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Partner 1 Email</label>
                <input type="email" value={templateData.partner1_email} onChange={(e) => setTemplateData(prev => ({ ...prev, partner1_email: e.target.value }))} style={inputStyle} />
                <span style={hintStyle}>Optional — if set, they&apos;ll also get an email whenever a guest RSVPs</span>
              </div>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Partner 2 Email</label>
                <input type="email" value={templateData.partner2_email} onChange={(e) => setTemplateData(prev => ({ ...prev, partner2_email: e.target.value }))} style={inputStyle} />
                <span style={hintStyle}>Optional — if set, they&apos;ll also get an email whenever a guest RSVPs</span>
              </div>
            </div>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>The Proposal Story</label>
              <textarea value={templateData.proposalStory} onChange={(e) => setTemplateData(prev => ({ ...prev, proposalStory: e.target.value }))} placeholder="How did the magic happen…" rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
            </div>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Gift Registry URL</label>
              <input type="url" value={templateData.giftRegistry} onChange={(e) => setTemplateData(prev => ({ ...prev, giftRegistry: e.target.value }))} placeholder="https://registry.example.com" style={inputStyle} />
            </div>
          </div>
        )}

        {isLegacyCategoryTemplate('birthday') && (
          <div style={{ marginTop: '16px', padding: '16px', background: COLORS.softBg, borderRadius: '8px', border: `1px solid ${COLORS.border}` }}>
            <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: 600, color: COLORS.charcoal }}>Birthday Template Details</h4>
            <div className="es-row" style={rowStyle}>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Celebrant Name</label>
                <input value={templateData.celebrant} onChange={(e) => setTemplateData(prev => ({ ...prev, celebrant: e.target.value }))} style={inputStyle} />
              </div>
              <div style={fieldGroupStyle}>
                <label style={labelStyle}>Age Milestone</label>
                <input value={templateData.age} onChange={(e) => setTemplateData(prev => ({ ...prev, age: e.target.value }))} placeholder="e.g. 30" style={inputStyle} />
              </div>
            </div>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Party Theme / Details</label>
              <input value={templateData.partyTheme} onChange={(e) => setTemplateData(prev => ({ ...prev, partyTheme: e.target.value }))} placeholder="e.g. Masquerade Ball" style={inputStyle} />
            </div>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Gift Registry URL</label>
              <input type="url" value={templateData.giftRegistry} onChange={(e) => setTemplateData(prev => ({ ...prev, giftRegistry: e.target.value }))} placeholder="https://registry.example.com" style={inputStyle} />
            </div>
          </div>
        )}

        {isLegacyCategoryTemplate('gala') && (
          <div style={{ marginTop: '16px', padding: '16px', background: COLORS.softBg, borderRadius: '8px', border: `1px solid ${COLORS.border}` }}>
            <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: 600, color: COLORS.charcoal }}>Gala Template Details</h4>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Guest(s) of Honor / Honoree</label>
              <input value={templateData.honoree} onChange={(e) => setTemplateData(prev => ({ ...prev, honoree: e.target.value }))} style={inputStyle} />
            </div>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Evening Program Schedule</label>
              <textarea value={templateData.program} onChange={(e) => setTemplateData(prev => ({ ...prev, program: e.target.value }))} placeholder="Detail the evening's program…" rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
            </div>
            <div style={fieldGroupStyle}>
              <label style={labelStyle}>Corporate Sponsor Packages</label>
              <textarea value={templateData.sponsorPackages} onChange={(e) => setTemplateData(prev => ({ ...prev, sponsorPackages: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
            </div>
          </div>
        )}
      </div>
      </>
      )}

      {activeTab === 'guest' && (
      <>
      {/* ═══ NOTIFICATION PREFERENCES ═══ */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
            <span style={iconBadgeStyle}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={COLORS.gold} strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></span>
            Notification Preferences
          </span>
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', fontSize: '13px', color: '#191B1E', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={form.notification_email}
              onChange={(e) => { setForm(prev => ({ ...prev, notification_email: e.target.checked })); setSuccess(false); }}
              style={{ width: '16px', height: '16px', accentColor: COLORS.gold, cursor: 'pointer' }}
            />
            Receive email notification when a guest submits an RSVP
          </label>
          <span style={{ fontSize: '11px', color: COLORS.stone, marginLeft: '26px' }}>
            This also controls email alerts to the Groom/Bride emails above, if set.
          </span>

          <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', fontSize: '13px', color: '#A8A29E', cursor: 'not-allowed', userSelect: 'none', opacity: 0.6 }}>
            <input
              type="checkbox"
              checked={false}
              disabled
              style={{ width: '16px', height: '16px', cursor: 'not-allowed' }}
            />
            <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
              Receive WhatsApp notification when a guest submits an RSVP
              <span style={{
                fontSize: 'var(--fx-micro)', fontWeight: 600, color: COLORS.gold, background: `${COLORS.gold}15`,
                border: `1px solid ${COLORS.gold}30`, borderRadius: '4px', padding: '2px 6px',
                letterSpacing: '0.5px', textTransform: 'uppercase', whiteSpace: 'nowrap', opacity: 1
              }}>
                Coming Soon
              </span>
            </span>
          </label>
        </div>
      </div>

      {/* ═══ GUEST RSVP OPTIONS ═══ */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
            <span style={iconBadgeStyle}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={COLORS.gold} strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></span>
            Guest RSVP Options
          </span>
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '10px', fontSize: '13px', color: '#191B1E', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={form.allow_guest_edits}
              onChange={(e) => { setForm(prev => ({ ...prev, allow_guest_edits: e.target.checked })); setSuccess(false); }}
              style={{ width: '16px', height: '16px', marginTop: '2px', accentColor: COLORS.gold, cursor: 'pointer' }}
            />
            <span>
              Allow guests to change their response after submitting
              <span style={{ display: 'block', color: '#77736A', fontSize: '12px', marginTop: '3px', fontWeight: 400, lineHeight: 1.5 }}>
                When on, a guest can reopen and update their RSVP from their invitation link until the RSVP deadline. When off, responses are locked and any change must go through you.
              </span>
            </span>
          </label>

          <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '10px', fontSize: '13px', color: '#191B1E', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={form.track_guest_side}
              onChange={(e) => { setForm(prev => ({ ...prev, track_guest_side: e.target.checked })); setSuccess(false); }}
              style={{ width: '16px', height: '16px', marginTop: '2px', accentColor: COLORS.gold, cursor: 'pointer' }}
            />
            <span>
              {form.event_type === 'wedding' ? "Tag guests as Groom's Side / Bride's Side" : "Tag guests as Partner 1's Side / Partner 2's Side"}
              <span style={{ display: 'block', color: '#77736A', fontSize: '12px', marginTop: '3px', fontWeight: 400, lineHeight: 1.5 }}>
                When on, you and your guests can mark which side of the celebration they belong to — shown on guest cards and in RSVP emails.
              </span>
            </span>
          </label>

          {canShowNoKidsToggle && (
            <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '10px', fontSize: '13px', color: '#191B1E', cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={form.no_kids_allowed}
                onChange={(e) => { setForm(prev => ({ ...prev, no_kids_allowed: e.target.checked })); setSuccess(false); }}
                style={{ width: '16px', height: '16px', marginTop: '2px', accentColor: COLORS.gold, cursor: 'pointer' }}
              />
              <span>
                Show &quot;No Kids Allowed&quot; on the invitation
                <span style={{ display: 'block', color: '#77736A', fontSize: '12px', marginTop: '3px', fontWeight: 400, lineHeight: 1.5 }}>
                  {/* Says only what actually happens. This promised the notice
                      appeared "on the envelope reveal" — the reveal has carried
                      no adults-only copy since it was rebuilt, on any template,
                      so that clause was describing a feature nobody could find.
                      It now names the RSVP form instead, which is both true and
                      the placement that matters most. */}
                  Off by default. When on, a quiet notice appears on the invitation card, the invitation page gains its own &quot;A Kind Note&quot; section, and guests are reminded on the RSVP form as they choose how many people are coming.
                </span>
              </span>
            </label>
          )}

          <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '10px', fontSize: '13px', color: '#191B1E', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={form.collect_dietary_restrictions}
              onChange={(e) => { setForm(prev => ({ ...prev, collect_dietary_restrictions: e.target.checked })); setSuccess(false); }}
              style={{ width: '16px', height: '16px', marginTop: '2px', accentColor: COLORS.gold, cursor: 'pointer' }}
            />
            <span>
              Ask guests about food allergies &amp; dietary restrictions
              <span style={{ display: 'block', color: '#77736A', fontSize: '12px', marginTop: '3px', fontWeight: 400, lineHeight: 1.5 }}>
                On by default. Turn off to remove the allergies question from your RSVP form entirely — useful if your venue/catering already handles this separately.
              </span>
            </span>
          </label>
        </div>
      </div>
      </>
      )}

      {activeTab === 'status' && (
      <>
      {/* ═══ EVENT STATUS ═══ */}
      <div style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
            <span style={iconBadgeStyle}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={COLORS.gold} strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
            Event Status
          </span>
        </h3>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 16px',
            borderRadius: '20px', background: `${statusColor}18`,
            border: `1px solid ${statusColor}40`,
          }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: statusColor }} />
            <span style={{
              fontSize: '13px', fontWeight: 600, color: statusColor, fontFamily: 'var(--font-sans)',
            }}>{statusLabels[currentStatus] || currentStatus}</span>
          </div>
        </div>

        {!statusActionable ? (
          /* Draft / pending_review — status controls aren't applicable pre-publish. */
          <>
            <p style={{ fontSize: '13px', color: COLORS.stone, lineHeight: 1.6, fontFamily: 'var(--font-sans)' }}>
              {currentStatus === 'pending_review'
                ? 'Your event is awaiting review and will go live once approved. Pause, resume and complete controls become available once it’s active.'
                : 'Finish setup and complete payment to publish your event. Status controls become available once it’s live.'}
            </p>
            <PromoCodeRedeemBox eventId={eventId} apiUrl={apiUrl} onRedeemed={(ev) => onEventUpdated?.(ev)} />
          </>
        ) : (
          <>
            {/* Make the consequence explicit — pausing/completing takes the event offline. */}
            <p style={{ fontSize: '12px', color: COLORS.stone, lineHeight: 1.6, marginBottom: '14px', fontFamily: 'var(--font-sans)' }}>
              Pausing or completing your event takes it <strong>offline</strong> — guests can no longer view the invitation or RSVP until you resume it.
            </p>

            {confirmComplete ? (
              /* Inline confirmation for the consequential Complete action. */
              <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '16px' }}>
                <p style={{ fontSize: '13px', color: COLORS.charcoal, lineHeight: 1.6, margin: '0 0 14px', fontFamily: 'var(--font-sans)' }}>
                  Mark this event as <strong>completed</strong>? It will be taken offline and guests will no longer be able to RSVP. You can bring it back later by resuming it.
                </p>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button
                    onClick={async () => { await handleStatusChange('completed'); setConfirmComplete(false); }}
                    disabled={!!statusLoading}
                    style={{
                      padding: '8px 20px', minHeight: 'var(--fx-touch)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', border: '1px solid #6B8EAE',
                      background: '#6B8EAE', color: COLORS.white, fontSize: '12px', fontWeight: 600,
                      fontFamily: 'var(--font-sans)', cursor: statusLoading ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
                    }}
                  >
                    {statusLoading === 'completed' ? 'Completing…' : 'Yes, complete event'}
                  </button>
                  <button
                    onClick={() => setConfirmComplete(false)}
                    disabled={!!statusLoading}
                    style={{
                      padding: '8px 20px', minHeight: 'var(--fx-touch)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', border: `1px solid ${COLORS.border}`,
                      background: COLORS.white, color: COLORS.stone, fontSize: '12px', fontWeight: 600,
                      fontFamily: 'var(--font-sans)', cursor: statusLoading ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {currentStatus !== 'paused' && (
                  <button onClick={() => handleStatusChange('paused')} disabled={!!statusLoading}
                    style={{
                      padding: '8px 20px', minHeight: 'var(--fx-touch)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', border: '1px solid #F59E0B',
                      background: COLORS.white, color: '#F59E0B', fontSize: '12px', fontWeight: 600,
                      fontFamily: 'var(--font-sans)', cursor: statusLoading ? 'not-allowed' : 'pointer',
                      opacity: statusLoading && statusLoading !== 'paused' ? 0.5 : 1, transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => { if (!statusLoading) e.currentTarget.style.background = '#FFFBEB'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = COLORS.white; }}
                  >
                    {statusLoading === 'paused' ? 'Pausing…' : '⏸ Pause Event'}
                  </button>
                )}
                {currentStatus === 'paused' && (
                  <button onClick={() => handleStatusChange('active')} disabled={!!statusLoading}
                    style={{
                      padding: '8px 20px', minHeight: 'var(--fx-touch)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', border: '1px solid #22C55E',
                      background: COLORS.white, color: '#22C55E', fontSize: '12px', fontWeight: 600,
                      fontFamily: 'var(--font-sans)', cursor: statusLoading ? 'not-allowed' : 'pointer',
                      opacity: statusLoading && statusLoading !== 'active' ? 0.5 : 1, transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => { if (!statusLoading) e.currentTarget.style.background = '#F0FDF4'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = COLORS.white; }}
                  >
                    {statusLoading === 'active' ? 'Resuming…' : '▶ Resume Event'}
                  </button>
                )}
                {currentStatus !== 'completed' && (
                  <button onClick={() => setConfirmComplete(true)} disabled={!!statusLoading}
                    style={{
                      padding: '8px 20px', minHeight: 'var(--fx-touch)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', border: '1px solid #6B8EAE',
                      background: COLORS.white, color: '#6B8EAE', fontSize: '12px', fontWeight: 600,
                      fontFamily: 'var(--font-sans)', cursor: statusLoading ? 'not-allowed' : 'pointer',
                      opacity: statusLoading ? 0.5 : 1, transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => { if (!statusLoading) e.currentTarget.style.background = '#EFF6FF'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = COLORS.white; }}
                  >
                    ✓ Complete Event
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* The confirm that stands between "cancel this event" and several hundred
          people being told. It names the numbers before it acts — see the
          component for why that sentence is the whole point. */}
      <ConfirmGuestNotifyModal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={handleCancelEvent}
        mode="cancel"
        parties={cancelReach.parties}
        smsReachable={cancelReach.smsReachable}
        smsRemaining={cancelReach.smsRemaining}
        busy={cancelBusy}
      />

      {/**
        * The same dialog, in its OTHER mode — which nothing had ever opened.
        *
        * `mode="change"` and its "Tell your guests" heading have existed in
        * ConfirmGuestNotifyModal since it was written; only the cancel path used
        * it. Opening it here is what finally connects saving a new date or venue to
        * the guests it affects.
        *
        * Counts come straight from the server's proposal rather than from the
        * cancel dialog's separate fetch: they were computed against the change that
        * was actually saved, so they cannot describe a different one.
        *
        * `estimatedSegments` is supplied — the modal documents a "using about N of
        * your 1,600 messages" line that never rendered, because no caller ever
        * passed it. Two segments per guest is the measured invitation-class figure
        * (utils/smsSegments), the same basis the bulk-send dialog quotes from.
        */}
      <ConfirmGuestNotifyModal
        open={!!changeNotice}
        onClose={() => setChangeNotice(null)}
        onConfirm={handleNotifyChange}
        mode="change"
        changed={changeNotice?.changed || []}
        parties={changeNotice?.parties ?? null}
        smsReachable={changeNotice?.smsReachable ?? null}
        smsRemaining={cancelReach.smsRemaining}
        estimatedSegments={
          changeNotice?.smsReachable != null ? changeNotice.smsReachable * 2 : null
        }
        busy={notifyBusy}
      />

      {/* ═══ DANGER ZONE ═══ */}
      <div style={{ ...sectionStyle, border: '1px solid #FECACA' }}>
        <h3 style={{ ...sectionTitleStyle, color: '#C45E5E', borderBottomColor: '#FECACA' }}>
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
            <span style={{ ...iconBadgeStyle, background: 'rgba(196, 94, 94, 0.12)' }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#C45E5E" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></span>
            Danger Zone
          </span>
        </h3>

        {/* CANCEL, offered above DELETE and described first.
            Until now, calling an event off and deleting it were the same button.
            An organizer whose venue floods pressed Delete: several hundred guests
            were never told anything, and every RSVP, seating chart and consent
            record went with it. Cancelling tells the guests, closes the RSVP
            form, and keeps the records. It is what almost everyone reaching this
            section actually wants, so it goes first. */}
        {!deleteConfirmOpen && event?.status !== 'cancelled' && event?.status !== 'draft' && (
          <div style={{
            background: COLORS.softBg || '#FAFAF8', border: `1px solid ${COLORS.border}`,
            borderRadius: '12px', padding: '16px', marginBottom: '18px',
          }}>
            <p style={{ fontSize: '13px', color: COLORS.charcoal, lineHeight: 1.6, margin: '0 0 12px', fontFamily: 'var(--font-sans)' }}>
              <strong>Need to call it off?</strong> Cancelling tells every guest who said yes or
              maybe — by email, and by text if you have messaging — closes your RSVP form, and
              keeps your guest list and records intact.
            </p>
            <button
              onClick={() => setCancelOpen(true)}
              style={{
                padding: '8px 20px', minHeight: 'var(--fx-touch)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', border: `1px solid ${COLORS.stone}`,
                background: COLORS.white, color: COLORS.charcoal, fontSize: '12px', fontWeight: 700,
                fontFamily: 'var(--font-sans)', cursor: 'pointer',
              }}
            >
              Cancel this event
            </button>
          </div>
        )}

        {event?.status === 'cancelled' && (
          <div style={{
            background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '12px',
            padding: '14px', marginBottom: '18px', fontSize: '13px', lineHeight: 1.6,
            color: COLORS.charcoal, fontFamily: 'var(--font-sans)',
          }}>
            This event was cancelled{event.cancelled_at ? ` on ${formatInZone(event.cancelled_at, event.timezone, { year: 'numeric', month: 'long', day: 'numeric' })}` : ''}. Your guests have been told.
          </div>
        )}

        {!deleteConfirmOpen ? (
          <>
            <p style={{ fontSize: '13px', color: COLORS.stone, lineHeight: 1.6, marginBottom: '14px', fontFamily: 'var(--font-sans)' }}>
              Permanently delete this event and all related data — guests, RSVPs, tables, and the activity log. <strong>This cannot be undone, and no guest is told anything.</strong>
            </p>
            <button onClick={() => setDeleteConfirmOpen(true)}
              style={{
                padding: '8px 20px', minHeight: 'var(--fx-touch)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', border: '1px solid #C45E5E',
                background: COLORS.white, color: '#C45E5E', fontSize: '12px', fontWeight: 600,
                fontFamily: 'var(--font-sans)', cursor: 'pointer', transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#FEF2F2'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = COLORS.white; }}
            >
              🗑 Delete Event
            </button>
          </>
        ) : (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '12px', padding: '16px' }}>
            <p style={{ fontSize: '13px', color: COLORS.charcoal, lineHeight: 1.6, margin: '0 0 12px', fontFamily: 'var(--font-sans)' }}>
              This will permanently delete <strong>&ldquo;{event?.title}&rdquo;</strong> and all of its guests, RSVPs, and data. Type the event title below to confirm.
            </p>
            <input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={event?.title || ''}
              style={{ ...inputStyle, marginBottom: '12px' }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button
                onClick={handleDeleteEvent}
                disabled={deleting || deleteConfirmText !== (event?.title || '')}
                style={{
                  padding: '8px 20px', minHeight: 'var(--fx-touch)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', border: '1px solid #C45E5E',
                  background: '#C45E5E', color: COLORS.white, fontSize: '12px', fontWeight: 600,
                  fontFamily: 'var(--font-sans)',
                  cursor: (deleting || deleteConfirmText !== (event?.title || '')) ? 'not-allowed' : 'pointer',
                  opacity: (deleting || deleteConfirmText !== (event?.title || '')) ? 0.5 : 1,
                  transition: 'all 0.2s',
                }}
              >
                {deleting ? 'Deleting…' : 'Permanently delete this event'}
              </button>
              <button
                onClick={() => { setDeleteConfirmOpen(false); setDeleteConfirmText(''); }}
                disabled={deleting}
                style={{
                  padding: '8px 20px', minHeight: 'var(--fx-touch)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', border: `1px solid ${COLORS.border}`,
                  background: COLORS.white, color: COLORS.stone, fontSize: '12px', fontWeight: 600,
                  fontFamily: 'var(--font-sans)', cursor: deleting ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      </>
      )}

      {/* Clearance so the last section never sits behind the sticky bar below. */}
      <div style={{ height: 8 }} />

      {/* ═══ STICKY SAVE BAR ═══ — always reachable regardless of tab length
           or scroll position, with the same frosted-glass treatment as the
           wizard's sticky top bar (WizardShell.js), so Settings never makes
           you hunt for the one button that matters. */}
      <div className="es-save-bar" style={{
        position: 'sticky', bottom: 0, zIndex: 20, marginLeft: '-1px', marginRight: '-1px',
        background: 'rgba(250,248,245,0.88)', backdropFilter: 'blur(16px)',
        borderTop: `1px solid ${COLORS.border}`, borderRadius: '0 0 14px 14px',
        padding: '16px 18px', marginTop: '4px',
        boxShadow: '0 -8px 24px rgba(25,27,30,0.06)',
      }}>
        {error && (
          <div style={{
            padding: '10px 14px', borderRadius: '10px', background: '#FEF2F2', border: '1px solid #FECACA',
            color: '#C45E5E', fontSize: '12.5px', fontFamily: 'var(--font-sans)', marginBottom: '10px',
          }}>
            {error}
          </div>
        )}
        {success && (
          <div style={{
            padding: '10px 14px', borderRadius: '10px', background: '#F0FDF4', border: '1px solid #BBF7D0',
            color: '#16A34A', fontSize: '12.5px', fontFamily: 'var(--font-sans)', marginBottom: '10px',
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px',
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7"/></svg>
            Settings saved successfully
          </div>
        )}
        <button onClick={handleSave} disabled={saving}
          style={{
            padding: '13px 32px', borderRadius: '10px', border: 'none',
            background: saving ? COLORS.champagne : COLORS.gold, color: COLORS.white,
            fontSize: '14px', fontWeight: 700, fontFamily: 'var(--font-sans)',
            cursor: saving ? 'not-allowed' : 'pointer', transition: 'all 0.2s cubic-bezier(0.16,1,0.3,1)',
            display: 'flex', alignItems: 'center', gap: '8px', width: '100%', justifyContent: 'center',
            boxShadow: saving ? 'none' : '0 4px 16px rgba(184,148,79,0.28)',
          }}
          onMouseEnter={(e) => { if (!saving) { e.currentTarget.style.background = COLORS.goldHover; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
          onMouseLeave={(e) => { if (!saving) { e.currentTarget.style.background = COLORS.gold; e.currentTarget.style.transform = 'translateY(0)'; } }}
        >
          {saving && (
            <span style={{
              width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)',
              borderTopColor: COLORS.white, borderRadius: '50%', display: 'inline-block',
              animation: 'spin 0.6s linear infinite',
            }} />
          )}
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        /* MOB-10: every 2-column row (dates/location/RSVP-privacy) and every
           event-type sub-form (wedding/corporate/engagement/birthday/gala)
           shares this one rowStyle object with no breakpoint at all — the
           largest, most-used settings surface in the dashboard was entirely
           desktop-fixed. Mirrors OrganizerProfile.js's existing breakpoint
           for the same 2-column-row pattern. */
        @media (max-width: 639.98px) {
          .es-row { grid-template-columns: 1fr !important; }
          /* .es-swatch-row is gone with the four raw colour inputs it stepped
             down. The palette picker that replaced them is an .fx-grid, which
             drops columns on its own with no breakpoint to keep in sync. */
          .es-privacy-grid { grid-template-columns: 1fr !important; }
          .es-tabs { overflow-x: auto; flex-wrap: nowrap !important; }
        }
        /* MOB-11: .es-save-bar is 'position: sticky; bottom: 0', which sticks
           to the actual viewport edge — it has no idea the dashboard also pins an
           always-on mobile tab bar ('.dnav-bottombar' in globals.css, ~60px +
           safe-area, z-index 55) to that same edge on mobile/tablet widths.
           (That bar was '.dashboard-bottom-tabbar' inside dashboard/page.js until
           it moved to the shared layout. The offset below is geometry, not a class
           reference, so the rename did not affect it — but the 60px and the
           1023.98px breakpoint must still track that class.) For most of
           the scroll range the two collide: this bar (z-index 20) renders
           underneath the tab bar, so Save / the error / the "saved" banner sit
           hidden behind it, and the fields just above look permanently stuck
           in place while scrolling. Docking this bar's stuck position above
           the tab bar (same breakpoint + same calc() page.js uses for main's
           reserved padding) puts it back in view for the whole scroll range. */
        @media (max-width: 1023.98px) {
          .es-save-bar { bottom: calc(60px + env(safe-area-inset-bottom)) !important; }
        }
      `}</style>
    </div>
  );
}

/**
 * The name shown on the previewed envelope.
 *
 * Two words with a hyphenated surname on purpose: it is long enough to prove the
 * script line wraps and stays inside the paper, which a short "Sarah" would not.
 */
const PREVIEW_ADDRESSEE = 'Sarah Al-Mansouri';

/* ═══════════════════════════════════════════════════════════════════════════
   RevealPreviewModal — the organizer's own opening, at phone size.

   This renders THE REAL opening component, not a mock-up of it: same artwork,
   same choreography, same monogram, driven off the unsaved form values. The
   whole point of the exercise is that there is exactly one of each opening in
   this product, so a preview that reimplemented one would recreate the problem
   it exists to solve.

   THE REAL one, though — which until now meant InvitationReveal and nothing
   else. Velvet Ring opens on a velvet box and Door of Joy on a carved door
   (EventPageClient mounts those in place of the envelope), so on two of the
   three templates this modal was showing an envelope that does not exist for
   that event, under a button labelled "Preview the envelope", beside a wax
   seal field that reached nothing. It now mounts whichever opening the
   template actually has.

   The three do NOT share a positioning contract. InvitationReveal takes an
   `embedded` prop that swaps it from fixed to absolute; the two cinematic
   openings are unconditionally `position: fixed` and size themselves in `dvh`
   and `vw`. PreviewFrame gives all three a real 320px viewport to be fixed
   inside, which is both simpler than a per-component escape hatch and the same
   mechanism the wizard's preview uses.

   `key` is what makes "Play again" work: every opening is a one-shot by design
   (each calls onComplete exactly once), so replaying means mounting a fresh
   one, not resetting the old one.
   ═══════════════════════════════════════════════════════════════════════════ */
function RevealPreviewModal({ event, opening, lang = 'en', onClose }) {
  const [run, setRun] = useState(0);
  const [done, setDone] = useState(false);

  /* Escape, from either document.

     The opening now runs inside a PreviewFrame, and a key pressed while focus
     is inside that frame fires on the FRAME's document — it never reaches this
     window. Every opening here is started by a tap or a click on itself, so
     focus is inside the frame within a second of the modal appearing: binding
     only to `window` meant Escape stopped closing this dialog almost
     immediately. PreviewFrame takes `onDocumentKeyDown` for exactly this, and
     the wizard's PreviewModal already passes it. Both bindings are kept — the
     host one still covers the toolbar and the inline fallback path. */
  const onKey = useCallback((e) => { if (e.key === 'Escape') onClose(); }, [onClose]);

  useEffect(() => {
    // Envelope artwork only — the cinematic openings preload their own poster
    // frames, and fetching a wax seal for a velvet box wastes the bandwidth
    // the video needs.
    if (opening?.hasSeal !== false) preloadRevealAssets();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey, opening]);

  /* The names carved on a cinematic cover. Same resolution order the guest
     page uses (Arabic title override, then the couple, then the event title)
     so the preview and the real arrival never name it differently. */
  const openingNames = (() => {
    const td = event.template_data || {};
    if (lang === 'ar' && event.title_ar) return event.title_ar;
    const a = td.groom_name || td.partner1Name || td.partner1;
    const b = td.bride_name || td.partner2Name || td.partner2;
    return a && b ? `${a} & ${b}` : (event.title || '');
  })();

  // Keyed, not chosen by a ternary — see CINEMATIC_OPENINGS in
  // [slug]/EventPageClient.js for what the ternary here used to do wrong.
  const CinematicOpening = opening?.cinematic
    ? CINEMATIC_OPENINGS[opening.cinematic.opening]
    : null;

  const replay = () => { setDone(false); setRun((n) => n + 1); };

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Invitation opening preview"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200, display: 'flex',
        alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px',
        background: 'rgba(20,18,15,0.72)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        padding: '24px',
      }}
    >
      {/* The phone. Its own stacking + overflow context, so the opening's
          full-bleed artwork is cropped by the screen exactly the way a real
          handset crops it. */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          // Was a flat `width: 320`. Inside the overlay's 24px padding that
          // needed 368px, so this phone-frame preview was clipped on a 360px
          // Pixel/Galaxy and a 320px iPhone SE — exactly the handsets it
          // exists to simulate. width:100% + maxWidth keeps the 320px frame
          // wherever it fits and shrinks it where it does not; the height
          // was already guarded with min().
          position: 'relative', width: '100%', maxWidth: 320, height: 'min(640px, 72vh)',
          borderRadius: 30, overflow: 'hidden', background: '#fff',
          boxShadow: '0 40px 90px -25px rgba(0,0,0,.6)', border: '6px solid #1c1a17',
        }}
      >
        {!done ? (
          <PreviewFrame
            title="Invitation opening preview"
            // The frame document's own direction. Without it an Arabic
            // invitation previewed its opening in an LTR document — Arabic
            // type laid out left-to-right, which is not what any guest sees.
            dir={lang === 'ar' ? 'rtl' : 'ltr'}
            onDocumentKeyDown={onKey}
            style={{ width: '100%', height: '100%' }}
          >
            {CinematicOpening ? (
              <CinematicOpening
                key={run}
                template={opening.cinematic}
                names={openingNames}
                lang={lang}
                occasion={getCinematicOccasion(opening.cinematic, event?.template_data)}
                // null, never a key: the organizer is previewing on purpose
                // and must not be let straight through because a guest
                // session once saw it.
                sessionKey={null}
                onComplete={() => setDone(true)}
              />
            ) : (
              <InvitationReveal
                key={run}
                embedded
                event={event}
                lang={lang}
                /**
                 * A sample addressee, so the organizer previews the envelope a NAMED
                 * guest opens rather than the anonymous one.
                 *
                 * The envelope prints the recipient's name on its face whenever the
                 * link carries a party — which is every SMS and email invitation the
                 * dashboard sends. Leaving this out meant the one screen built for
                 * designing the envelope was the only place that never showed the
                 * line, and the component's own docblock is explicit that what the
                 * organizer designs against and what the guest opens must not be two
                 * different envelopes.
                 *
                 * Deliberately a plain sample rather than a real guest: this preview
                 * renders before any list exists, and it has to look the same on an
                 * event with no guests as on one with three hundred.
                 */
                guestName={PREVIEW_ADDRESSEE}
                onComplete={() => setDone(true)}
              />
            )}
          </PreviewFrame>
        ) : (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center',
            background: '#F8F4EC', fontFamily: 'var(--font-sans)',
          }}>
            <p style={{ margin: 0, fontSize: 13, color: '#77736A', lineHeight: 1.6 }}>
              {opening?.hasSeal === false
                ? 'The opening has finished — this is the moment your invitation takes over.'
                : 'The envelope has opened — this is the moment your invitation takes over.'}
            </p>
            <button type="button" onClick={replay} style={{
              padding: '10px 20px', minHeight: 42, borderRadius: 30, border: 'none', cursor: 'pointer',
              background: '#B8944F', color: '#fff', fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 700,
            }}>Play it again</button>
          </div>
        )}
      </div>

      <button type="button" onClick={onClose} style={{
        padding: '9px 20px', minHeight: 'var(--fx-touch)', borderRadius: 30, cursor: 'pointer',
        background: 'rgba(255,255,255,.12)', color: '#fff', border: '1px solid rgba(255,255,255,.25)',
        fontFamily: 'var(--font-sans)', fontSize: 12.5, fontWeight: 600,
      }}>Close preview</button>
    </div>
  );
}
