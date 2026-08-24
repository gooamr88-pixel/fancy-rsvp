'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import PlacesAutocomplete from '../../../../app/components/PlacesAutocomplete';
import InlineFormBuilder from './InlineFormBuilder';
import { extractYouTubeId, checkYouTubeEmbeddable } from '../../../utils/youtube';
import RepeatableListEditor from '../../components/RepeatableListEditor';
import DaysEditor from './DaysEditor';
import SectionsOrderEditor from './SectionsOrderEditor';
import { getHaDays } from '../../../utils/haDays';
import { CUSTOM_CATEGORY_BY_KEY } from '../../../utils/customEventCategories';
import { resolveOccasion, occasionPolicyFor } from '../../../utils/eventOccasion';
import OccasionPicker from '../../../components/OccasionPicker';
import LetterPortraitFields from '../../../components/LetterPortraitFields';
import { getCinematicTemplate } from '../../../components/templates/cinematic/cinematicThemes';
import EventCategoryIcon from '../../../components/icons/EventCategoryIcon';
import Icon from '../../../components/icons/Icon';

const C = {
  gold: '#B8944F', goldHover: '#a6833f',
  charcoal: '#191B1E', ivory: '#F8F4EC',
  champagne: '#D7BE80', stone: '#77736A',
  border: '#E8E2D6', white: '#FFFFFF', softBg: '#FAFAF8',
  error: '#C45E5E', success: '#3B9B6D',
};

const DRESS_CODES = ['', 'Black Tie', 'Cocktail Attire', 'Semi-Formal', 'Business Casual', 'Smart Casual', 'Casual', 'Festive', 'Traditional'];

/* Curated templates whose DEFAULT occasion is a wedding, for events that have
   not answered the occasion picker. It no longer decides which fields render
   — the occasion's `kind` does that now, for every template — so this is only
   a fallback for the retired visual variants, which have no cinematic entry
   to carry a `defaultOccasion`. Keep in sync with create-event/page.js. */
const WEDDING_STYLE_TEMPLATE_KEYS = [
  'wedding', 'tuscany', 'marrakesh', 'kyoto', 'nordic', 'havana',
  'estate', 'roseAtelier', 'orchid', 'clay', 'alpine', 'coastal', 'heritageArch',
];

// Templates rendered as the full-page snap-scroll guest experience — the
// wedding-style templates, engagement, and custom, which all map onto the
// same ha_* section fields (corporate/birthday/gala keep the continuous-
// scroll layout and their own content fields).
// Keep in sync with FULL_PAGE_TEMPLATES in [slug]/EventPageClient.js.
const FULL_PAGE_TEMPLATE_KEYS = [...WEDDING_STYLE_TEMPLATE_KEYS, 'engagement', 'custom', 'ring', 'bab', 'swans'];
const isFullPage = (t) => FULL_PAGE_TEMPLATE_KEYS.includes(t);

/* `ENGAGEMENT_TEMPLATE_KEYS` / `isEngagementStyle` are gone. They named the
   two templates that were engagements, and the block they gated re-rendered
   the partner name and email fields on top of the couple block above — which
   was invisible while only those two matched, and a double-render bound to
   the same keys the moment any template could be an engagement. The one field
   that was genuinely theirs (the proposal story) is now shown by occasion. */

// The occasion catalogue — shared with the guest-facing HeritageArchPage so
// the organizer's picker and the hero's name/tagline can never drift apart.
// See customEventCategories.js for the full list and per-category field copy.

const PRIVACY_MODES = [
  { key: 'public', label: 'Public Link', icon: 'globe', desc: 'Anyone with the link can RSVP' },
  { key: 'private', label: 'Private', icon: 'lock', desc: 'Guests must be on your list' },
  { key: 'password', label: 'Passcode', icon: 'lockKey', desc: 'Requires a passcode to access' },
];

const iStyle = {
  width: '100%', boxSizing: 'border-box',
  background: C.white, border: `1px solid ${C.border}`,
  borderRadius: 8, padding: '10px 14px',
  fontSize: 14, color: C.charcoal,
  outline: 'none', fontFamily: 'var(--font-sans)',
  transition: 'border-color 0.25s, box-shadow 0.25s',
};
const lblStyle = {
  display: 'block', fontSize: 11, fontWeight: 600,
  color: C.stone, textTransform: 'uppercase',
  letterSpacing: '0.06em', marginBottom: 6,
  fontFamily: 'var(--font-sans)',
};
const onFocus = (e) => { e.target.style.borderColor = C.gold; e.target.style.boxShadow = '0 0 0 3px rgba(184,148,79,0.08)'; };
const onBlur = (e) => { e.target.style.borderColor = C.border; e.target.style.boxShadow = 'none'; };

/* ═══ Accordion Section ═══ */
function Section({ title, icon, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      background: C.white, border: `1px solid ${C.border}`,
      borderRadius: 16, overflow: 'hidden',
      borderLeft: open ? `3px solid ${C.gold}` : `3px solid transparent`,
      transition: 'border-color 0.3s',
    }}>
      <button onClick={() => setOpen(!open)} style={{
        width: '100%', display: 'flex', alignItems: 'center',
        gap: 10, padding: '18px 24px', background: 'none',
        border: 'none', cursor: 'pointer', textAlign: 'left',
      }}>
        <Icon name={icon} size={17} color={C.gold} strokeWidth={1.5} />
        <span style={{
          fontFamily: 'var(--font-serif)', fontSize: 16,
          fontWeight: 600, color: C.charcoal, flex: 1,
        }}>{title}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke={C.stone} strokeWidth="2" strokeLinecap="round"
          style={{
            transition: 'transform 0.3s cubic-bezier(0.16,1,0.3,1)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}>
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '0 24px 24px' }}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ═══ Field wrapper ═══ */
// Every field that isn't explicitly `required` gets the same "Optional" pill
// next to its label — one consistent, distinctive marker instead of the
// inconsistent mix of "(optional)" suffixes and "Optional — " hint prefixes
// individual fields used to spell out (or, often, didn't) on their own.
function Field({ label: lbl, required, hint, children, style: wrapStyle, htmlFor }) {
  return (
    <div style={{ marginBottom: 16, ...wrapStyle }}>
      <label style={{ ...lblStyle, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 7 }} htmlFor={htmlFor}>
        <span>{lbl}{required && <span style={{ color: C.error, marginLeft: 2 }}>*</span>}</span>
        {!required && (
          <span style={{
            fontSize: 'var(--fx-micro)', fontWeight: 700, color: C.gold, background: 'rgba(184,148,79,0.1)',
            border: '1px solid rgba(184,148,79,0.3)', borderRadius: 4, padding: '1.5px 6px',
            textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'var(--font-sans)',
          }}>
            Optional
          </span>
        )}
      </label>
      {children}
      {hint && <span style={{ fontSize: 'var(--fx-micro)', color: '#A09A91', display: 'block', marginTop: 4 }}>{hint}</span>}
    </div>
  );
}

export default function Stage2_FormConfiguration({
  templateType, templates,
  customColors, setCustomColors,
  title, setTitle, slug, setSlug,
  slugStatus, suggestedSlug,
  description, setDescription,
  eventDate, setEventDate,
  eventEndDate, setEventEndDate,
  locationName, setLocationName,
  locationAddress, setLocationAddress,
  onPlaceSelect,
  templateData, setTemplateData,
  onRowImageUpload,
  dressCode, setDressCode,
  rsvpDeadline, setRsvpDeadline,
  privacyMode, setPrivacyMode,
  accessPassword, setAccessPassword, hasAccessPassword = false,
  notificationEmail, setNotificationEmail,
  allowGuestEdits, setAllowGuestEdits,
  trackGuestSide, setTrackGuestSide,
  noKidsAllowed, setNoKidsAllowed,
  collectDietaryRestrictions, setCollectDietaryRestrictions,
  coverImageUrl, setCoverImageUrl, onCoverImageUpload, coverImageUploading,
  backgroundMusicUrl, setBackgroundMusicUrl, onMusicUpload, musicUploading,
  galleryUrls = [], onGalleryUpload, galleryUploading, onRemoveGalleryUrl,
  customFields, onFieldsChange,
  onNext, onBack, onSaveDraft, savingDraft, onPreview,
}) {
  const tpl = templates.find(t => t.key === templateType) || templates[0];
  // Dress code starts in "custom" mode if it's already set to something outside
  // the preset pills (e.g. loaded from a draft), so the free-text box shows up
  // with the existing value instead of looking like nothing was chosen.
  const [customDressMode, setCustomDressMode] = useState(!!dressCode && !DRESS_CODES.includes(dressCode));
  const td = (key) => templateData[key] || '';
  const setTd = (key) => (val) => setTemplateData(d => ({ ...d, [key]: val }));
  const anyMediaUploading = !!(musicUploading || coverImageUploading || galleryUploading);

  // Actually attempts to embed the pasted YouTube link (debounced while
  // typing) so a song that can't play on the live guest page — a very common
  // restriction on official/label music videos with embedding disabled — is
  // flagged here, before publishing, instead of the organizer only finding
  // out when a guest tells them the music button does nothing.
  const [musicEmbedStatus, setMusicEmbedStatus] = useState('idle'); // 'idle' | 'checking' | 'ok' | 'blocked'
  useEffect(() => {
    const id = extractYouTubeId(backgroundMusicUrl);
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
  }, [backgroundMusicUrl]);

  /* The occasion the organizer picked, for ANY template — falling back to the
     template's own default for a draft started before the picker existed.
     One shared resolver: see the note in utils/eventOccasion.js for what the
     three hand-written copies of this chain got wrong. */
  const occasionChoice = resolveOccasion(templateType, templateData);
  const customCategoryMeta = CUSTOM_CATEGORY_BY_KEY[occasionChoice] || null;
  const occasionPolicy = occasionPolicyFor(templateType);
  /* Which fields show is now decided ENTIRELY by the occasion's `kind`, not
     by which artwork was picked. That is the whole change: a birthday on
     Velvet Ring must show the honoree fields, and asking a template what
     shape its content is cannot answer that. */
  const showCoupleFields = customCategoryMeta?.kind === 'couple';

  // Ceremony/reception venue pickers behave like the main Venue field: a plain-
  // address prediction (as opposed to a named venue) has no distinct `place.name`
  // — falling back to the raw search text there would leave the venue name stale,
  // so fall back to the address's first segment instead.
  const makePlaceSelectHandler = (prefix) => (place) => setTemplateData(d => ({
    ...d,
    [`${prefix}_venue_name`]: place.name && place.name !== place.address
      ? place.name
      : (place.address ? place.address.split(',')[0] : d[`${prefix}_venue_name`]),
    [`${prefix}_venue_address`]: place.address,
    [`${prefix}_lat`]: place.lat,
    [`${prefix}_lng`]: place.lng,
    [`${prefix}_place_id`]: place.placeId,
  }));
  const onCeremonyPlaceSelect = makePlaceSelectHandler('ceremony');
  const onReceptionPlaceSelect = makePlaceSelectHandler('reception');

  // "Invited to" city — captures coordinates too, so the world-map pin in the
  // Invited-To section actually points at this city instead of silently
  // reusing the Day 1 venue's coordinates.
  const onHaInvitedToPlaceSelect = (place) => setTemplateData(d => ({
    ...d,
    ha_invited_to_city: place.name && place.name !== place.address
      ? place.name
      : (place.address ? place.address.split(',')[0] : d.ha_invited_to_city),
    ha_invited_to_lat: place.lat,
    ha_invited_to_lng: place.lng,
  }));

  return (
    <div className="fx-container fx-container--xl fx-gutter fx-gutter--sm" style={{ paddingTop: '40px', paddingBottom: '120px' }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'rgba(184,148,79,0.08)', border: '1px solid rgba(184,148,79,0.15)',
          borderRadius: 20, padding: '5px 14px', marginBottom: 12,
        }}>
          <span style={{ fontSize: 11, color: C.gold, fontWeight: 600, fontFamily: 'var(--font-sans)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Step 2 of 3
          </span>
        </div>
        <h2 style={{
          fontFamily: 'var(--font-serif)', fontSize: 28,
          fontWeight: 600, color: C.charcoal, margin: 0,
        }}>Configure Your Event</h2>
        <p style={{
          fontFamily: 'var(--font-sans)', fontSize: 14,
          color: C.stone, margin: '8px 0 0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
        }}>
          <EventCategoryIcon name={tpl.key} size={13} color={C.stone} /> Using <strong>{tpl.label}</strong> template • Fill in the details for your event
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* ═══ Section A: Core Details ═══ */}
        <Section title="Core Event Details" icon="calendar">
          <Field label="Event Title" required>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="My Beautiful Event" style={iStyle}
              onFocus={onFocus} onBlur={onBlur} />
          </Field>

          <Field label={<><Icon name="globe" size={11} strokeWidth={1.8} style={{ verticalAlign: '-1px', marginRight: 4 }} />Arabic Title</>} hint="Shown when a guest switches the page to Arabic">
            <input type="text" dir="rtl" value={td('title_ar')} onChange={e => setTd('title_ar')(e.target.value)}
              placeholder="عنوان الفعالية بالعربي" style={{ ...iStyle, fontFamily: "'Noto Sans Arabic', var(--font-sans)" }}
              onFocus={onFocus} onBlur={onBlur} />
          </Field>

          <Field label="Event URL" required hint={
            slugStatus === 'checking' ? <><Icon name="hourglass" size={10} strokeWidth={1.8} style={{ verticalAlign: '-1px', marginRight: 3 }} />Checking availability...</> :
            slugStatus === 'available' ? <><Icon name="check" size={10} strokeWidth={1.8} style={{ verticalAlign: '-1px', marginRight: 3 }} />This URL is available!</> :
            slugStatus === 'taken' ? <><Icon name="cross" size={10} strokeWidth={1.8} style={{ verticalAlign: '-1px', marginRight: 3 }} />Taken. Try: {suggestedSlug}</> : null
          }>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0 }}>
              <span style={{
                background: C.ivory, border: `1px solid ${C.border}`,
                borderRight: 'none', borderRadius: '8px 0 0 8px',
                padding: '10px 12px', fontSize: 13,
                color: C.stone, fontFamily: 'var(--font-sans)',
                whiteSpace: 'nowrap',
              }}>fancyrsvp.com/</span>
              <input type="text" value={slug} data-testid="event-slug"
                onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="my-event"
                style={{ ...iStyle, borderRadius: '0 8px 8px 0', flex: 1 }}
                onFocus={onFocus} onBlur={onBlur} />
            </div>
            <p className="url-preview" style={{ fontSize: '12px', color: C.stone, marginTop: '8px', fontFamily: 'monospace' }}>
              Live Preview: <strong style={{ color: C.gold }}>fancyrsvp.com/{slug || 'your-event-name'}</strong>
            </p>
          </Field>

          <Field label="Description">
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              rows={3} placeholder="Tell guests about your event…"
              style={{ ...iStyle, resize: 'vertical', minHeight: 80 }}
              onFocus={onFocus} onBlur={onBlur} />
          </Field>

          <Field label={<><Icon name="globe" size={11} strokeWidth={1.8} style={{ verticalAlign: '-1px', marginRight: 4 }} />Arabic Description</>}>
            <textarea dir="rtl" value={td('description_ar')} onChange={e => setTd('description_ar')(e.target.value)}
              rows={3} placeholder="وصف الفعالية بالعربي"
              style={{ ...iStyle, resize: 'vertical', minHeight: 80, fontFamily: "'Noto Sans Arabic', var(--font-sans)" }}
              onFocus={onFocus} onBlur={onBlur} />
          </Field>

          <div className="s2-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Start Date & Time" required>
              <input type="datetime-local" value={eventDate}
                onChange={e => setEventDate(e.target.value)}
                style={iStyle} onFocus={onFocus} onBlur={onBlur} />
            </Field>
            <Field label="End Date & Time">
              <input type="datetime-local" value={eventEndDate}
                onChange={e => setEventEndDate(e.target.value)}
                style={iStyle} onFocus={onFocus} onBlur={onBlur} />
            </Field>
          </div>

          <div className="s2-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Venue" htmlFor="s2-venue" hint="Type a name or address and pick a suggestion — or if Google can't find your venue, just type the name in and enter the address manually on the right">
              <PlacesAutocomplete
                id="s2-venue"
                value={locationName}
                onChange={setLocationName}
                onPlaceSelect={onPlaceSelect}
                placeholder="Search for a venue…"
                style={iStyle}
              />
            </Field>
            <Field label="Address" hint="Auto-filled from the selected venue — or type it in yourself, it's always editable">
              <input type="text" value={locationAddress} onChange={e => setLocationAddress(e.target.value)}
                placeholder="Grand Ballroom, 123 Main St" style={iStyle}
                onFocus={onFocus} onBlur={onBlur} />
            </Field>
          </div>
        </Section>

        {/* ═══ Section B: Template-Specific ═══ */}
        {(
          <Section title={`${tpl.label} Details`} icon="palette">
            {/* Every cinematic template is included: their sections recolour
                from these values through buildPalette exactly like the others
                do, so withholding the picker would leave the templates whose
                palette is most visible the only ones that can't be tuned.
                Asked of the registry rather than by naming keys — the literal
                `templateType === 'bab'` here is exactly the shape that left
                each newly-added template silently without a colour picker. */}
            {(templateType === 'wedding' || templateType === 'engagement' || !!getCinematicTemplate(templateType)) && customColors && setCustomColors && (
              <div style={{
                marginBottom: 18, padding: 14, borderRadius: 12,
                background: C.softBg, border: `1px solid ${C.border}`,
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.charcoal, fontFamily: 'var(--font-sans)', marginBottom: 10 }}>
                  <Icon name="palette" size={13} strokeWidth={1.6} style={{ verticalAlign: '-2px', marginRight: 5 }} />Design &amp; Colors — override the preset above with any color you like
                </div>
                <div className="s2-swatch-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                  {[
                    { key: 'primary', label: 'Primary' },
                    { key: 'secondary', label: 'Secondary' },
                    { key: 'accent', label: 'Accent' },
                    { key: 'background', label: 'Background' },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <label style={lblStyle}>{label}</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, border: `1px solid ${C.border}`, borderRadius: 8, padding: '5px 8px', background: C.white }}>
                        <input type="color" value={customColors[key] || '#B8944F'}
                          onChange={e => setCustomColors(prev => ({ ...prev, [key]: e.target.value }))}
                          style={{ width: 26, height: 26, border: 'none', background: 'none', padding: 0, cursor: 'pointer', borderRadius: 6 }} />
                        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: C.stone, textTransform: 'uppercase' }}>{customColors[key]}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Every template that can render an occasion, not just Custom
                Canvas: the template decides how the invitation looks, this
                decides what the event is.

                Gated on isFullPage because the retired continuous-scroll
                categories (Corporate, Birthday, Gala) have no hero, no badge
                and no honoree fields to drive — offering the choice there
                would let a resumed draft set an occasion that nothing on the
                page can show, while quietly rewriting its event_type. */}
            {isFullPage(templateType) && (
              <OccasionPicker
                value={occasionChoice}
                onChange={setTd('custom_category')}
                /* The template's own policy — so a locked one (Velvet Ring)
                   states its occasion here instead of offering 25 tiles it
                   would then refuse, and the wizard agrees with the badge the
                   organizer just chose the template by. */
                allowed={occasionPolicy.allowed}
                lockedNote={occasionPolicy.note}
                labelStyle={lblStyle}
              />
            )}
            {showCoupleFields && (
              <>
                <div className="s2-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <Field label="Partner 1 Name">
                    <input type="text" value={td('partner1')} onChange={e => setTd('partner1')(e.target.value)}
                      placeholder="First partner name" style={iStyle} onFocus={onFocus} onBlur={onBlur} />
                  </Field>
                  <Field label="Partner 2 Name">
                    <input type="text" value={td('partner2')} onChange={e => setTd('partner2')(e.target.value)}
                      placeholder="Second partner name" style={iStyle} onFocus={onFocus} onBlur={onBlur} />
                  </Field>
                </div>
                <div className="s2-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <Field label="Partner 1 Email" hint="If set, this person also gets an email every time a guest RSVPs">
                    <input type="email" value={td('partner1_email')} onChange={e => setTd('partner1_email')(e.target.value)}
                      placeholder="groom@email.com" style={iStyle} onFocus={onFocus} onBlur={onBlur} />
                  </Field>
                  <Field label="Partner 2 Email" hint="If set, this person also gets an email every time a guest RSVPs">
                    <input type="email" value={td('partner2_email')} onChange={e => setTd('partner2_email')(e.target.value)}
                      placeholder="bride@email.com" style={iStyle} onFocus={onFocus} onBlur={onBlur} />
                  </Field>
                </div>
                {/* Full-page templates use the dedicated "Our Story" field below
                    (ha_our_story) for the same guest section — showing both here
                    duplicated the input, so "Our Love Story" is only for the
                    non-full-page wedding layouts. */}
                {!isFullPage(templateType) && (
                  <Field label="Our Love Story">
                    <textarea value={td('loveStory')} onChange={e => setTd('loveStory')(e.target.value)}
                      rows={3} placeholder="Share your beautiful story…"
                      style={{ ...iStyle, resize: 'vertical' }} onFocus={onFocus} onBlur={onBlur} />
                  </Field>
                )}
                {/* Full-page templates have their own Day 1 / Day 2 venue pickers
                    below — a single Ceremony/Reception pair doesn't fit a
                    multi-day site (Day 1 isn't necessarily "the ceremony"). */}
                {!isFullPage(templateType) && (
                  <>
                    <div className="s2-row" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
                      <Field label="Ceremony Venue" htmlFor="s2-ceremony-venue" hint="Search and pick where the ceremony takes place">
                        <PlacesAutocomplete
                          id="s2-ceremony-venue"
                          value={td('ceremony_venue_name')}
                          onChange={setTd('ceremony_venue_name')}
                          onPlaceSelect={onCeremonyPlaceSelect}
                          placeholder="Search for the ceremony venue…"
                          style={iStyle}
                        />
                      </Field>
                      <Field label="Ceremony Time">
                        <input type="time" value={td('ceremony_time_of_day')} onChange={e => setTd('ceremony_time_of_day')(e.target.value)}
                          style={iStyle} onFocus={onFocus} onBlur={onBlur} />
                      </Field>
                    </div>
                    <div className="s2-row" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
                      <Field label="Reception Venue" htmlFor="s2-reception-venue" hint="Search and pick where the reception takes place">
                        <PlacesAutocomplete
                          id="s2-reception-venue"
                          value={td('reception_venue_name')}
                          onChange={setTd('reception_venue_name')}
                          onPlaceSelect={onReceptionPlaceSelect}
                          placeholder="Search for the reception venue…"
                          style={iStyle}
                        />
                      </Field>
                      <Field label="Reception Time">
                        <input type="time" value={td('reception_time_of_day')} onChange={e => setTd('reception_time_of_day')(e.target.value)}
                          style={iStyle} onFocus={onFocus} onBlur={onBlur} />
                      </Field>
                    </div>
                  </>
                )}
                {/* The engagement counterpart to "Our Love Story" above.
                    It used to live in a separate `isEngagementStyle` block
                    that ALSO re-rendered the partner name and email fields —
                    harmless while only the engagement templates matched it,
                    and a double-render bound to the same keys the moment any
                    template could be an engagement. The story is the only
                    thing that was ever unique to it. */}
                {occasionChoice === 'engagement' && (
                  <Field label="The Proposal Story">
                    <textarea value={td('proposalStory')} onChange={e => setTd('proposalStory')(e.target.value)}
                      rows={3} placeholder="How did the magic happen…"
                      style={{ ...iStyle, resize: 'vertical' }} onFocus={onFocus} onBlur={onBlur} />
                  </Field>
                )}
                <Field label="Gift Registry URL">
                  <input type="url" value={td('giftRegistry')} onChange={e => setTd('giftRegistry')(e.target.value)}
                    placeholder="https://registry.example.com" style={iStyle} onFocus={onFocus} onBlur={onBlur} />
                </Field>
                <Field label="Guest Accommodations" hint={isFullPage(templateType) ? 'Shown to guests only as a fallback note, and only if no hotels are added in the Accommodation list below' : undefined}>
                  <textarea value={td('accommodations')} onChange={e => setTd('accommodations')(e.target.value)}
                    rows={2} placeholder="Hotel blocks, parking info…"
                    style={{ ...iStyle, resize: 'vertical' }} onFocus={onFocus} onBlur={onBlur} />
                </Field>
              </>
            )}

            {customCategoryMeta?.kind === 'honoree' && (
              <>
                <Field label={customCategoryMeta.honoreeLabel} hint={customCategoryMeta.honoreeHint}>
                  <input type="text" value={td('custom_honoree')} onChange={e => setTd('custom_honoree')(e.target.value)}
                    placeholder={customCategoryMeta.honoreePlaceholder} style={iStyle} onFocus={onFocus} onBlur={onBlur} />
                </Field>
                <Field label={customCategoryMeta.milestoneLabel} hint={customCategoryMeta.milestoneHint}>
                  <input type="text" value={td('custom_milestone')} onChange={e => setTd('custom_milestone')(e.target.value)}
                    placeholder={customCategoryMeta.milestonePlaceholder} style={iStyle} onFocus={onFocus} onBlur={onBlur} />
                </Field>
              </>
            )}

            {customCategoryMeta?.kind === 'babyShower' && (
              <>
                <Field label="Parent(s)-to-be" hint="Shown as the name on your guest page">
                  <input type="text" value={td('custom_parents')} onChange={e => setTd('custom_parents')(e.target.value)}
                    placeholder="e.g. Sarah & Michael" style={iStyle} onFocus={onFocus} onBlur={onBlur} />
                </Field>
                <div className="s2-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <Field label="Baby's Name" hint="Leave blank if not revealed yet">
                    <input type="text" value={td('custom_baby_name')} onChange={e => setTd('custom_baby_name')(e.target.value)}
                      placeholder="Leave blank if unrevealed" style={iStyle} onFocus={onFocus} onBlur={onBlur} />
                  </Field>
                  <Field label="Due Date / Theme" hint="Shown as the tagline, e.g. Due June 2026, or Oh Baby! A Gender Reveal">
                    <input type="text" value={td('custom_baby_due')} onChange={e => setTd('custom_baby_due')(e.target.value)}
                      placeholder="e.g. Due June 2026" style={iStyle} onFocus={onFocus} onBlur={onBlur} />
                  </Field>
                </div>
              </>
            )}

            {/* Wedding/engagement already collect this via the Partner 1/2 Email
                fields above (same underlying template_data.partner1_email/
                partner2_email the backend emails on every RSVP) — this covers
                the categories that don't have a "couple": celebration, baby
                shower, and a plain custom event with no category chosen yet.
                `engagement` is excluded explicitly (not just via
                `showCoupleFields`, which is false for it) since it renders its
                own dedicated Partner 1/2 Email block below — without this,
                both blocks rendered at once, bound to the same two keys. */}
            {isFullPage(templateType) && !showCoupleFields && (
              <div className="s2-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Field label="Notify by Email" hint="This person also gets an email every time a guest RSVPs">
                  <input type="email" value={td('partner1_email')} onChange={e => setTd('partner1_email')(e.target.value)}
                    placeholder="host@email.com" style={iStyle} onFocus={onFocus} onBlur={onBlur} />
                </Field>
                <Field label="Also Notify" hint="A second person who should also get an email every time a guest RSVPs">
                  <input type="email" value={td('partner2_email')} onChange={e => setTd('partner2_email')(e.target.value)}
                    placeholder="co-host@email.com" style={iStyle} onFocus={onFocus} onBlur={onBlur} />
                </Field>
              </div>
            )}

            {/* Sealed Letter's hero is the ONLY one an organizer fills in —
                the other templates open onto photography we shipped. Gated on
                the template key, not on the occasion: this is about the
                artwork having a panel in it, which no occasion changes. The
                same block, from the same component, is in EventSettings. */}
            {templateType === 'letter' && (
              <Field
                label="Your Photograph"
                hint="Your own photo fills the whole page your guests land on once the letter opens, with your names and your words written over it. Leave it empty and they land on your names alone, on the template's paper."
              >
                <LetterPortraitFields
                  value={templateData}
                  onChange={(patch) => setTemplateData(d => ({ ...d, ...patch }))}
                  // 'portraits', the same folder Event Details writes to — see
                  // uploadRowImage. Without it this lands in `venues/`.
                  onUploadImage={(file) => onRowImageUpload?.(file, 'portraits')}
                />
              </Field>
            )}

            {isFullPage(templateType) && (
              <>
                <div style={{ fontSize: 12, color: C.stone, fontFamily: 'var(--font-sans)', marginBottom: 4 }}>
                  Full-page guest experience — each section below appears on the guest page only when you fill it in.
                </div>
                <Field label="Our Story" hint="Shown in the guest page's story section">
                  <textarea value={td('ha_our_story')} onChange={e => setTd('ha_our_story')(e.target.value)}
                    rows={3} placeholder="Tell your story…"
                    style={{ ...iStyle, resize: 'vertical' }} onFocus={onFocus} onBlur={onBlur} />
                </Field>
                <Field label="Closing Message" hint="Optional — shown just before RSVP">
                  <textarea value={td('ha_closing_message')} onChange={e => setTd('ha_closing_message')(e.target.value)}
                    rows={2} placeholder="Looking forward to welcoming you"
                    style={{ ...iStyle, resize: 'vertical' }} onFocus={onFocus} onBlur={onBlur} />
                </Field>
                {/* Meal options are configured once via the "🍽 Add Meal Options"
                    shortcut in Custom RSVP Questions (the single source of truth the
                    guest RSVP + backend read) — the old duplicate ha_meal_options
                    input was removed from here to end the two-places confusion. */}
                <div className="s2-row" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
                  <Field label={'"You\'re Invited To" City'} htmlFor="s2-ha-invited-to" hint="Search and pick a city — its map pin uses this location, not your first day's venue">
                    <PlacesAutocomplete
                      id="s2-ha-invited-to"
                      value={td('ha_invited_to_city')}
                      // Retyping the city without picking a fresh suggestion must clear the
                      // old lat/lng — otherwise the guest page's map pin silently keeps
                      // pointing at whatever city was last actually selected, while the
                      // label text shows the new (unrelated) name typed here.
                      onChange={(val) => setTemplateData(d => ({ ...d, ha_invited_to_city: val, ha_invited_to_lat: null, ha_invited_to_lng: null }))}
                      onPlaceSelect={onHaInvitedToPlaceSelect}
                      placeholder="Miami"
                      style={iStyle}
                    />
                  </Field>
                </div>
                <Field label="Days, Venues &amp; Schedule" hint="Most events are one day — add more only if yours has several (e.g. a henna night, then the wedding, then a reception)">
                  <DaysEditor
                    days={Array.isArray(templateData.ha_days) ? templateData.ha_days : getHaDays(templateData)}
                    onChange={(nextDays) => setTemplateData(d => ({ ...d, ha_days: nextDays }))}
                    onUploadImage={onRowImageUpload}
                  />
                </Field>
                <Field label="Accommodation">
                  <RepeatableListEditor
                    items={Array.isArray(templateData.ha_accommodation) ? templateData.ha_accommodation : []}
                    onChange={(items) => setTemplateData(d => ({ ...d, ha_accommodation: items }))}
                    onUploadImage={onRowImageUpload}
                    itemNoun="Hotel"
                    addLabel="+ Add hotel"
                    emptyLabel="No hotels yet — a sample hotel shows on the guest page until you add one."
                    columns={[
                      { key: 'name', label: 'Hotel name', placeholder: 'Hotel Costa' },
                      { key: 'price', label: 'Price', placeholder: '$4,100' },
                      { key: 'link', label: 'Booking link', placeholder: 'https://…' },
                      { key: 'imageUrl', label: 'Photo', type: 'image' },
                      { key: 'description', label: 'Note', type: 'textarea', placeholder: 'Book directly for a discount' },
                    ]}
                  />
                </Field>
                <Field label="FAQ">
                  <RepeatableListEditor
                    items={Array.isArray(templateData.ha_faq) ? templateData.ha_faq : []}
                    onChange={(items) => setTemplateData(d => ({ ...d, ha_faq: items }))}
                    itemNoun="Question"
                    addLabel="+ Add question"
                    emptyLabel="No FAQ items yet — sample questions show on the guest page until you add some."
                    columns={[
                      { key: 'question', label: 'Question', placeholder: 'Can I bring my children?' },
                      { key: 'answer', label: 'Answer', type: 'textarea', placeholder: 'Answer shown to guests…' },
                    ]}
                  />
                </Field>
                <Field label="Menu" hint="Each course shows on the guest page only if you add it here">
                  <RepeatableListEditor
                    items={Array.isArray(templateData.ha_menu_courses) ? templateData.ha_menu_courses : []}
                    onChange={(items) => setTemplateData(d => ({ ...d, ha_menu_courses: items }))}
                    itemNoun="Course"
                    addLabel="+ Add course"
                    emptyLabel="No menu courses yet — the Menu section stays hidden until you add one."
                    columns={[
                      { key: 'label', label: 'Course', placeholder: 'Starter' },
                      { key: 'name', label: 'Dish', placeholder: 'Burrata & Heirloom Tomatoes' },
                      { key: 'description', label: 'Description', type: 'textarea', placeholder: 'Shown under the dish name…' },
                    ]}
                  />
                </Field>
                <Field label="Things to Do">
                  <RepeatableListEditor
                    items={Array.isArray(templateData.ha_things_to_do) ? templateData.ha_things_to_do : []}
                    onChange={(items) => setTemplateData(d => ({ ...d, ha_things_to_do: items }))}
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
                </Field>
                <Field label="Getting There" hint="Transport, parking, and directions notes">
                  <textarea value={td('ha_getting_there')} onChange={e => setTd('ha_getting_there')(e.target.value)}
                    rows={3} placeholder="How to get there, parking, shuttle info…"
                    style={{ ...iStyle, resize: 'vertical' }} onFocus={onFocus} onBlur={onBlur} />
                </Field>
                <Field label="Gift Registry Button Label" hint="Text on the registry button, e.g. Amazon">
                  <input type="text" value={td('ha_gift_registry_label')} onChange={e => setTd('ha_gift_registry_label')(e.target.value)}
                    placeholder="Gift Registry" style={iStyle} onFocus={onFocus} onBlur={onBlur} />
                </Field>
                <Field label="Gift Message" hint="Shown above the registry button / bank details">
                  <textarea value={td('ha_gift_message')} onChange={e => setTd('ha_gift_message')(e.target.value)}
                    rows={2} placeholder="Your presence is your gift, but contributions can go to…"
                    style={{ ...iStyle, resize: 'vertical' }} onFocus={onFocus} onBlur={onBlur} />
                </Field>
                <div className="s2-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                  <Field label="Bank Name">
                    <input type="text" value={td('ha_gift_bank_name')} onChange={e => setTd('ha_gift_bank_name')(e.target.value)}
                      placeholder="KBC" style={iStyle} onFocus={onFocus} onBlur={onBlur} />
                  </Field>
                  <Field label="Account Holder">
                    <input type="text" value={td('ha_gift_account_name')} onChange={e => setTd('ha_gift_account_name')(e.target.value)}
                      placeholder="Full name" style={iStyle} onFocus={onFocus} onBlur={onBlur} />
                  </Field>
                  <Field label="IBAN">
                    <input type="text" value={td('ha_gift_iban')} onChange={e => setTd('ha_gift_iban')(e.target.value)}
                      placeholder="BE89 5655 5224 55" style={iStyle} onFocus={onFocus} onBlur={onBlur} />
                  </Field>
                </div>
              </>
            )}

            {templateType === 'corporate' && (
              <>
                <Field label="Company / Organization">
                  <input type="text" value={td('company')} onChange={e => setTd('company')(e.target.value)}
                    placeholder="Acme Corporation" style={iStyle} onFocus={onFocus} onBlur={onBlur} />
                </Field>
                <Field label="Event Itinerary / Agenda">
                  <textarea value={td('agenda')} onChange={e => setTd('agenda')(e.target.value)}
                    rows={4} placeholder="Outline the event schedule…"
                    style={{ ...iStyle, resize: 'vertical' }} onFocus={onFocus} onBlur={onBlur} />
                </Field>
                <Field label="Keynote Speakers">
                  <textarea value={td('speakers')} onChange={e => setTd('speakers')(e.target.value)}
                    rows={2} placeholder="List keynote speakers…"
                    style={{ ...iStyle, resize: 'vertical' }} onFocus={onFocus} onBlur={onBlur} />
                </Field>
                <Field label="Sponsors">
                  <textarea value={td('sponsors')} onChange={e => setTd('sponsors')(e.target.value)}
                    rows={2} placeholder="Event sponsors…"
                    style={{ ...iStyle, resize: 'vertical' }} onFocus={onFocus} onBlur={onBlur} />
                </Field>
                <Field label="Networking Notes">
                  <textarea value={td('networkingNotes')} onChange={e => setTd('networkingNotes')(e.target.value)}
                    rows={2} placeholder="Tips for networking, meet-and-greet details…"
                    style={{ ...iStyle, resize: 'vertical' }} onFocus={onFocus} onBlur={onBlur} />
                </Field>
              </>
            )}

            {templateType === 'birthday' && (
              <>
                <div className="s2-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <Field label="Celebrant Name">
                    <input type="text" value={td('celebrant')} onChange={e => setTd('celebrant')(e.target.value)}
                      style={iStyle} onFocus={onFocus} onBlur={onBlur} />
                  </Field>
                  <Field label="Age Milestone">
                    <input type="text" value={td('age')} onChange={e => setTd('age')(e.target.value)}
                      placeholder="e.g. 30" style={iStyle} onFocus={onFocus} onBlur={onBlur} />
                  </Field>
                </div>
                <Field label="Party Theme / Details">
                  <input type="text" value={td('partyTheme')} onChange={e => setTd('partyTheme')(e.target.value)}
                    placeholder="e.g. Masquerade Ball" style={iStyle} onFocus={onFocus} onBlur={onBlur} />
                </Field>
                <Field label="Gift Registry URL">
                  <input type="url" value={td('giftRegistry')} onChange={e => setTd('giftRegistry')(e.target.value)}
                    placeholder="https://registry.example.com" style={iStyle} onFocus={onFocus} onBlur={onBlur} />
                </Field>
              </>
            )}

            {templateType === 'gala' && (
              <>
                <Field label="Guest(s) of Honor / Honoree">
                  <input type="text" value={td('honoree')} onChange={e => setTd('honoree')(e.target.value)}
                    style={iStyle} onFocus={onFocus} onBlur={onBlur} />
                </Field>
                <Field label="Evening Program Schedule">
                  <textarea value={td('program')} onChange={e => setTd('program')(e.target.value)}
                    rows={3} placeholder="Detail the evening's program…"
                    style={{ ...iStyle, resize: 'vertical' }} onFocus={onFocus} onBlur={onBlur} />
                </Field>
                <Field label="Corporate Sponsor Packages">
                  <textarea value={td('sponsorPackages')} onChange={e => setTd('sponsorPackages')(e.target.value)}
                    rows={2} style={{ ...iStyle, resize: 'vertical' }} onFocus={onFocus} onBlur={onBlur} />
                </Field>
              </>
            )}

            {isFullPage(templateType) && (
              <SectionsOrderEditor templateData={templateData} setTemplateData={setTemplateData} />
            )}
          </Section>
        )}

        {/* ═══ Premium Invitation Seal & Stationery ═══ */}
        <Section title="Invitation Seal & Stationery" icon="sparkle">
          <p style={{ fontSize: 12.5, color: C.stone, lineHeight: 1.6, margin: '0 0 14px', fontFamily: 'var(--font-sans)' }}>
            This is engraved on the gold wax seal your guests unseal when they open the link.
            Leave it blank and we&apos;ll use your event name automatically.
          </p>

          <Field label="Seal Name / Monogram" hint="Engraved at the centre of the wax seal — e.g. حسن, or initials like A&J. Defaults to your event name.">
            <input type="text" value={td('seal_text')} onChange={e => setTd('seal_text')(e.target.value)}
              placeholder="Auto from event name" style={iStyle} onFocus={onFocus} onBlur={onBlur} maxLength={24} />
          </Field>

        </Section>

        {/* ═══ Section C: Settings ═══ */}
        <Section title="Event Settings" icon="gear">
          {/* Dress Code Pills */}
          <Field label="Dress Code">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {DRESS_CODES.map(dc => (
                <button key={dc || '__none'} onClick={() => { setCustomDressMode(false); setDressCode(dc); }}
                  style={{
                    padding: '7px 14px', minHeight: 'var(--fx-touch)', borderRadius: 20,
                    fontSize: 12, fontWeight: 600,
                    fontFamily: 'var(--font-sans)',
                    cursor: 'pointer',
                    border: (!customDressMode && dressCode === dc) ? `1.5px solid ${C.gold}` : `1px solid ${C.border}`,
                    background: (!customDressMode && dressCode === dc) ? C.gold : C.white,
                    color: (!customDressMode && dressCode === dc) ? C.white : C.stone,
                    transition: 'all 0.2s ease',
                  }}
                >{dc || 'No Dress Code'}</button>
              ))}
              <button onClick={() => { setCustomDressMode(true); if (DRESS_CODES.includes(dressCode)) setDressCode(''); }}
                style={{
                  padding: '7px 14px', minHeight: 'var(--fx-touch)', borderRadius: 20,
                  fontSize: 12, fontWeight: 600,
                  fontFamily: 'var(--font-sans)',
                  cursor: 'pointer',
                  border: customDressMode ? `1.5px solid ${C.gold}` : `1px solid ${C.border}`,
                  background: customDressMode ? C.gold : C.white,
                  color: customDressMode ? C.white : C.stone,
                  transition: 'all 0.2s ease',
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                }}
              ><Icon name="pencil" size={12} strokeWidth={1.7} /> Custom…</button>
            </div>
            {customDressMode && (
              <input type="text" value={dressCode} onChange={e => setDressCode(e.target.value)}
                placeholder="e.g. Everyone wears white" maxLength={80}
                style={{ ...iStyle, marginTop: 10 }} onFocus={onFocus} onBlur={onBlur} />
            )}
          </Field>

          <Field label={<><Icon name="globe" size={11} strokeWidth={1.8} style={{ verticalAlign: '-1px', marginRight: 4 }} />Arabic Dress Code</>}>
            <input type="text" dir="rtl" value={td('dress_code_ar')} onChange={e => setTd('dress_code_ar')(e.target.value)}
              placeholder="ملابس رسمية، كاجوال..." style={{ ...iStyle, fontFamily: "'Noto Sans Arabic', var(--font-sans)" }}
              onFocus={onFocus} onBlur={onBlur} />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            <Field label="Guidance for Ladies" hint="Optional">
              <textarea value={td('ha_dress_ladies')} onChange={e => setTd('ha_dress_ladies')(e.target.value)}
                placeholder="Formal dresses in elegant, polished styles are encouraged."
                rows={2} style={{ ...iStyle, resize: 'vertical' }} onFocus={onFocus} onBlur={onBlur} />
            </Field>
            <Field label="Guidance for Gentlemen" hint="Optional">
              <textarea value={td('ha_dress_gentlemen')} onChange={e => setTd('ha_dress_gentlemen')(e.target.value)}
                placeholder="Well-tailored suits with classic dress shoes are preferred."
                rows={2} style={{ ...iStyle, resize: 'vertical' }} onFocus={onFocus} onBlur={onBlur} />
            </Field>
          </div>

          <Field label="RSVP Response Deadline" hint="Guests cannot RSVP after this date">
            <input type="datetime-local" value={rsvpDeadline}
              onChange={e => setRsvpDeadline(e.target.value)}
              style={iStyle} onFocus={onFocus} onBlur={onBlur} />
          </Field>

          {/* Privacy Mode Cards */}
          <Field label="Invitation Privacy">
            <div className="s2-privacy" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {PRIVACY_MODES.map(pm => (
                <div key={pm.key} onClick={() => setPrivacyMode(pm.key)}
                  style={{
                    padding: '16px 14px', borderRadius: 12,
                    border: privacyMode === pm.key ? `2px solid ${C.gold}` : `1px solid ${C.border}`,
                    background: privacyMode === pm.key ? 'rgba(184,148,79,0.04)' : C.white,
                    cursor: 'pointer', textAlign: 'center',
                    transition: 'all 0.25s cubic-bezier(0.16,1,0.3,1)',
                    transform: privacyMode === pm.key ? 'scale(1.02)' : 'scale(1)',
                  }}
                >
                  <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', marginBottom: 6 }}><Icon name={pm.icon} size={22} color={C.gold} strokeWidth={1.4} /></div>
                  <div style={{
                    fontFamily: 'var(--font-sans)', fontSize: 13,
                    fontWeight: 700, color: C.charcoal,
                  }}>{pm.label}</div>
                  <div style={{
                    fontFamily: 'var(--font-sans)', fontSize: 'var(--fx-micro)',
                    color: C.stone, marginTop: 4,
                  }}>{pm.desc}</div>
                </div>
              ))}
            </div>
          </Field>

          {/* Password input */}
          <AnimatePresence>
            {privacyMode === 'password' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25 }}
                style={{ overflow: 'hidden' }}
              >
                <Field label="Access Passcode">
                  <input type="text" value={accessPassword}
                    onChange={e => setAccessPassword(e.target.value)}
                    placeholder={hasAccessPassword ? 'Passcode is set — leave blank to keep it' : 'Enter access passcode'}
                    style={iStyle} onFocus={onFocus} onBlur={onBlur} />
                </Field>
              </motion.div>
            )}
          </AnimatePresence>

          <Field label="Notification Preferences">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, fontSize: 13, color: C.charcoal, cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={notificationEmail}
                  onChange={e => setNotificationEmail(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: C.gold, cursor: 'pointer' }} />
                Receive email notification when a guest submits an RSVP
              </label>
              <span style={{ fontSize: 11, color: '#A09A91', marginLeft: 26 }}>
                This also controls email alerts to the Groom/Bride emails below, if set.
              </span>
              <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, fontSize: 13, color: '#A8A29E', cursor: 'not-allowed', userSelect: 'none', opacity: 0.6 }}>
                <input type="checkbox" checked={false} disabled
                  style={{ width: 16, height: 16, cursor: 'not-allowed' }} />
                <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  Receive WhatsApp notification when a guest submits an RSVP
                  <span style={{
                    fontSize: 'var(--fx-micro)', fontWeight: 600, color: C.gold, background: `${C.gold}15`,
                    border: `1px solid ${C.gold}30`, borderRadius: 4, padding: '2px 6px',
                    letterSpacing: '0.5px', textTransform: 'uppercase', whiteSpace: 'nowrap', opacity: 1,
                  }}>Coming Soon</span>
                </span>
              </label>
            </div>
          </Field>

          <Field label="Guest RSVP Options">
            <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 10, fontSize: 13, color: C.charcoal, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={allowGuestEdits}
                onChange={e => setAllowGuestEdits(e.target.checked)}
                style={{ width: 16, height: 16, marginTop: 2, accentColor: C.gold, cursor: 'pointer' }} />
              <span>
                Allow guests to change their response after submitting
                <span style={{ display: 'block', color: C.stone, fontSize: 12, marginTop: 3, fontWeight: 400, lineHeight: 1.5 }}>
                  When on, a guest can reopen and update their RSVP from their invitation link until the RSVP deadline. When off, responses are locked and any change must go through you.
                </span>
              </span>
            </label>
          </Field>

          <Field label="Guest Segmentation">
            <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 10, fontSize: 13, color: C.charcoal, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={trackGuestSide}
                onChange={e => setTrackGuestSide(e.target.checked)}
                style={{ width: 16, height: 16, marginTop: 2, accentColor: C.gold, cursor: 'pointer' }} />
              <span>
                {/* The OCCASION, not the artwork — this label has to match
                    what utils/sideLabel.js will actually print, and that reads
                    event_type, which the occasion now drives. Keyed on the
                    template it promised "Groom's Side" for a wedding on a
                    retired variant and "Partner 1's Side" for a wedding on
                    Velvet Ring. */}
                {occasionChoice === 'wedding' ? "Tag guests as Groom's Side / Bride's Side" : "Tag guests as Partner 1's Side / Partner 2's Side"}
                <span style={{ display: 'block', color: C.stone, fontSize: 12, marginTop: 3, fontWeight: 400, lineHeight: 1.5 }}>
                  Lets you and your guests mark which side of the party they belong to. Off by default — no extra field appears anywhere until you turn this on.
                </span>
              </span>
            </label>
          </Field>

          {/* Offered for every full-page template, not just wedding/engagement.
              A Custom Canvas event or one of the curated wedding variants could
              not turn this on at all, even though the guest page renders the
              notice for any event whose flag is set — see the matching gates in
              HeritageArchPage and EventSettings, both widened alongside this. */}
          {isFullPage(templateType) && setNoKidsAllowed && (
            <Field label="Adults-Only Notice">
              <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 10, fontSize: 13, color: C.charcoal, cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={!!noKidsAllowed}
                  onChange={e => setNoKidsAllowed(e.target.checked)}
                  style={{ width: 16, height: 16, marginTop: 2, accentColor: C.gold, cursor: 'pointer' }} />
                <span>
                  Show &quot;No Kids Allowed&quot; on the invitation
                  <span style={{ display: 'block', color: C.stone, fontSize: 12, marginTop: 3, fontWeight: 400, lineHeight: 1.5 }}>
                    {/* Kept identical to EventSettings' copy — the organizer
                        reads one of these when creating and the other when
                        editing, and two descriptions of one switch is how a
                        feature acquires a reputation for being unpredictable.
                        The "envelope reveal" clause was removed from both: the
                        reveal has carried no adults-only copy since its rebuild. */}
                    Off by default. When on, a quiet notice appears on the invitation card, the invitation page gains its own &quot;A Kind Note&quot; section, and guests are reminded on the RSVP form as they choose how many people are coming.
                  </span>
                </span>
              </label>
            </Field>
          )}

          <Field label="Dietary Restrictions">
            <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 10, fontSize: 13, color: C.charcoal, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={!!collectDietaryRestrictions}
                onChange={e => setCollectDietaryRestrictions(e.target.checked)}
                style={{ width: 16, height: 16, marginTop: 2, accentColor: C.gold, cursor: 'pointer' }} />
              <span>
                Ask guests about food allergies &amp; dietary restrictions
                <span style={{ display: 'block', color: C.stone, fontSize: 12, marginTop: 3, fontWeight: 400, lineHeight: 1.5 }}>
                  On by default. Turn off to remove the allergies question from your RSVP form entirely.
                </span>
              </span>
            </label>
          </Field>

          <Field label="Cover Image">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <label style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, cursor: coverImageUploading ? 'wait' : 'pointer',
                padding: '10px 16px', borderRadius: 8, border: `1px solid ${C.gold}`, color: C.gold,
                fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap',
                opacity: coverImageUploading ? 0.6 : 1,
              }}>
                {coverImageUploading ? 'Uploading…' : '⬆ Upload'}
                <input type="file" accept="image/*" onChange={onCoverImageUpload} disabled={coverImageUploading} style={{ display: 'none' }} />
              </label>
            </div>
            {/* Drag-and-drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = C.gold; e.currentTarget.style.background = 'rgba(184,148,79,0.04)'; }}
              onDragLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.softBg; }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.style.borderColor = C.border;
                e.currentTarget.style.background = C.softBg;
                const file = e.dataTransfer.files?.[0];
                if (file && file.type.startsWith('image/')) {
                  const dt = new DataTransfer(); dt.items.add(file);
                  const inp = document.createElement('input'); inp.type = 'file';
                  inp.files = dt.files;
                  onCoverImageUpload?.({ target: inp });
                }
              }}
              style={{
                marginTop: 10, padding: '18px 16px', borderRadius: 12,
                border: `2px dashed ${C.border}`, background: C.softBg,
                textAlign: 'center', transition: 'all 0.25s', cursor: 'pointer',
              }}
              onClick={() => {
                const fi = document.createElement('input');
                fi.type = 'file'; fi.accept = 'image/*';
                fi.onchange = (ev) => onCoverImageUpload?.(ev);
                fi.click();
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={C.stone} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="3"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <path d="m21 15-5-5L5 21"/>
                </svg>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.stone, fontFamily: 'var(--font-sans)' }}>
                  {coverImageUploading ? 'Uploading…' : 'Drop image here or click to browse'}
                </span>
                <span style={{ fontSize: 'var(--fx-micro)', color: '#A09A91', fontFamily: 'var(--font-sans)' }}>JPG, PNG, WebP • Max 8MB</span>
              </div>
            </div>
            {/* Preview */}
            {coverImageUrl && (
              <div style={{
                borderRadius: 12, overflow: 'hidden',
                border: `1px solid ${C.border}`, height: 140,
                background: C.softBg, marginTop: 10,
                position: 'relative',
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={coverImageUrl} alt="Cover preview"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={e => { e.target.style.display = 'none'; }} />
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'linear-gradient(to top, rgba(0,0,0,0.3) 0%, transparent 50%)',
                }} />
                <button type="button" onClick={() => setCoverImageUrl('')}
                  style={{
                    position: 'absolute', top: 6, right: 6, width: 26, height: 26,
                    borderRadius: '50%', border: 'none', background: 'rgba(25,27,30,0.75)',
                    color: '#fff', cursor: 'pointer', fontSize: 14, lineHeight: 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>×</button>
              </div>
            )}
          </Field>

          <Field label="Background Music">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, cursor: musicUploading ? 'wait' : 'pointer',
                padding: '10px 16px', borderRadius: 8, border: `1px solid ${C.gold}`, color: C.gold,
                fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap',
                opacity: musicUploading ? 0.6 : 1,
              }}>
                {musicUploading ? 'Uploading…' : '⬆ Upload'}
                <input type="file" accept="audio/*" onChange={onMusicUpload} disabled={musicUploading} style={{ display: 'none' }} />
              </label>
            </div>
            {/* Drag-and-drop zone for music */}
            <div
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = C.gold; e.currentTarget.style.background = 'rgba(184,148,79,0.04)'; }}
              onDragLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.softBg; }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.style.borderColor = C.border;
                e.currentTarget.style.background = C.softBg;
                const file = e.dataTransfer.files?.[0];
                if (file && file.type.startsWith('audio/')) {
                  const dt = new DataTransfer(); dt.items.add(file);
                  const inp = document.createElement('input'); inp.type = 'file';
                  inp.files = dt.files;
                  onMusicUpload?.({ target: inp });
                }
              }}
              style={{
                marginTop: 10, padding: '14px 16px', borderRadius: 12,
                border: `2px dashed ${C.border}`, background: C.softBg,
                textAlign: 'center', transition: 'all 0.25s', cursor: 'pointer',
              }}
              onClick={() => {
                const fi = document.createElement('input');
                fi.type = 'file'; fi.accept = 'audio/*';
                fi.onchange = (ev) => onMusicUpload?.(ev);
                fi.click();
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.stone} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                </svg>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.stone, fontFamily: 'var(--font-sans)' }}>
                  {musicUploading ? 'Uploading…' : 'Drop audio file here or click to browse'}
                </span>
              </div>
              <span style={{ fontSize: 'var(--fx-micro)', color: '#A09A91', fontFamily: 'var(--font-sans)', marginTop: 4, display: 'block' }}>MP3, OGG, WAV • Max 8MB</span>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, margin: '12px 0' }}>
              <div style={{ flex: 1, height: 1, background: C.border }} />
              <span style={{ fontSize: 11, color: C.stone, fontFamily: 'var(--font-sans)', fontWeight: 600 }}>or</span>
              <div style={{ flex: 1, height: 1, background: C.border }} />
            </div>
            <input
              type="url" value={backgroundMusicUrl || ''}
              onChange={e => setBackgroundMusicUrl(e.target.value)}
              placeholder="Paste a YouTube link (e.g. https://youtu.be/…)"
              style={iStyle} onFocus={onFocus} onBlur={onBlur}
            />

            {backgroundMusicUrl && (
              extractYouTubeId(backgroundMusicUrl) ? (
                musicEmbedStatus === 'blocked' ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(196,94,94,0.06)', border: '1px solid rgba(196,94,94,0.25)' }}>
                    <Icon name="warning" size={14} color={C.error} strokeWidth={1.6} />
                    <span style={{ fontSize: 12, color: C.error, fontFamily: 'var(--font-sans)', flex: 1, lineHeight: 1.5 }}>
                      This video can&apos;t be played embedded on other sites — a common restriction on official music videos. Guests won&apos;t hear it. Try a lyric video, cover, or a different link.
                    </span>
                    <button type="button" onClick={() => setBackgroundMusicUrl('')}
                      style={{ padding: '6px 12px', minHeight: 'var(--fx-touch)', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: C.error, fontWeight: 600, fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap' }}>Remove</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10, padding: '8px 12px', borderRadius: 8, background: C.softBg, border: `1px solid ${C.border}` }}>
                    <Icon name={musicEmbedStatus === 'checking' ? 'hourglass' : 'play'} size={14} color={C.gold} strokeWidth={1.4} />
                    <span style={{ fontSize: 12, color: C.charcoal, fontFamily: 'var(--font-sans)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {musicEmbedStatus === 'checking' ? 'Checking this video can be played…' : 'YouTube song linked — guests tap the music icon to play it'}
                    </span>
                    <button type="button" onClick={() => setBackgroundMusicUrl('')}
                      style={{ padding: '6px 12px', minHeight: 'var(--fx-touch)', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: C.error, fontWeight: 600, fontFamily: 'var(--font-sans)' }}>Remove</button>
                  </div>
                )
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10 }}>
                  <audio controls src={backgroundMusicUrl} style={{ flex: 1, height: 36 }} />
                  <button type="button" onClick={() => setBackgroundMusicUrl('')}
                    style={{ padding: '6px 12px', minHeight: 'var(--fx-touch)', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: C.error, fontWeight: 600, fontFamily: 'var(--font-sans)' }}>Remove</button>
                </div>
              )
            )}
          </Field>

          <Field label="Photo Gallery">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, cursor: galleryUploading ? 'wait' : 'pointer',
                padding: '10px 16px', borderRadius: 8, border: `1px solid ${C.gold}`, color: C.gold,
                fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap',
                opacity: galleryUploading ? 0.6 : 1,
              }}>
                {galleryUploading ? 'Uploading…' : '⬆ Upload'}
                <input type="file" accept="image/*" multiple onChange={onGalleryUpload} disabled={galleryUploading} style={{ display: 'none' }} />
              </label>
            </div>
            {/* Drag-and-drop zone for gallery */}
            <div
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = C.gold; e.currentTarget.style.background = 'rgba(184,148,79,0.04)'; }}
              onDragLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.softBg; }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.style.borderColor = C.border;
                e.currentTarget.style.background = C.softBg;
                const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
                if (files.length > 0) {
                  const dt = new DataTransfer();
                  files.forEach(f => dt.items.add(f));
                  const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true;
                  inp.files = dt.files;
                  onGalleryUpload?.({ target: inp });
                }
              }}
              style={{
                marginTop: 10, padding: '18px 16px', borderRadius: 12,
                border: `2px dashed ${C.border}`, background: C.softBg,
                textAlign: 'center', transition: 'all 0.25s', cursor: 'pointer',
              }}
              onClick={() => {
                const fi = document.createElement('input');
                fi.type = 'file'; fi.accept = 'image/*'; fi.multiple = true;
                fi.onchange = (ev) => onGalleryUpload?.(ev);
                fi.click();
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.stone} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="3"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <path d="m21 15-5-5L5 21"/>
                </svg>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.stone, fontFamily: 'var(--font-sans)' }}>
                  {galleryUploading ? 'Uploading…' : 'Drop images here or click to browse'}
                </span>
                <span style={{ fontSize: 'var(--fx-micro)', color: '#A09A91', fontFamily: 'var(--font-sans)' }}>Multiple images • JPG, PNG, WebP • Max 8MB each</span>
              </div>
            </div>
            {galleryUrls.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
                {galleryUrls.map((url, i) => (
                  <div key={i} style={{
                    position: 'relative', width: 84, height: 84, borderRadius: 10,
                    overflow: 'hidden', border: `1px solid ${C.border}`, background: C.softBg,
                    transition: 'transform 0.2s, box-shadow 0.2s',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = 'none'; }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Gallery ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={e => { e.target.style.display = 'none'; }} />
                    <button type="button" onClick={() => onRemoveGalleryUrl?.(i)} title="Remove"
                      style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'rgba(25,27,30,0.75)', color: '#fff', cursor: 'pointer', fontSize: 13, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </Field>
        </Section>

        {/* ═══ Section D: Custom Questions ═══ */}
        <Section title="Custom RSVP Questions" icon="question">
          <InlineFormBuilder fields={customFields} onFieldsChange={onFieldsChange} />
        </Section>
      </div>

      {/* ═══ NAVIGATION FOOTER ═══ */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(12px)',
        borderTop: `1px solid ${C.border}`,
        padding: '16px 24px', paddingBottom: 'max(16px, calc(env(safe-area-inset-bottom) + 8px))', zIndex: 50,
        display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
      }}>
        <div className="s2-footer-inner" style={{
          display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between',
          alignItems: 'center', maxWidth: 860, width: '100%',
        }}>
          <button onClick={onBack} className="s2-footer-btn" style={{
            height: 48, padding: '0 24px',
            background: 'none', border: `1.5px solid ${C.charcoal}`,
            borderRadius: 12, fontFamily: 'var(--font-sans)',
            fontSize: 14, fontWeight: 700, color: C.charcoal,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
            transition: 'all 0.2s',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = C.charcoal; e.currentTarget.style.color = C.white; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = C.charcoal; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
            Back
          </button>

          <div className="s2-footer-actions" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
            {/* Deliberately here, immediately before Continue: this is the last
                moment the organizer can look at what they are publishing, and
                the whole reason it exists is that they were previously asked to
                commit without ever having seen it. Gated on the same three
                fields as Save as Draft — with no title or date there is not yet
                an invitation to show. */}
            {onPreview && (
              <button onClick={onPreview} type="button" className="s2-footer-btn"
                disabled={!title || !eventDate}
                title="See the real invitation your guests will receive"
                style={{
                  height: 48, padding: '0 22px',
                  background: C.white, border: `1.5px solid ${C.charcoal}`,
                  borderRadius: 12, fontFamily: 'var(--font-sans)',
                  fontSize: 14, fontWeight: 700, color: C.charcoal,
                  cursor: (!title || !eventDate) ? 'not-allowed' : 'pointer',
                  opacity: (!title || !eventDate) ? 0.5 : 1,
                  display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s',
                }}
              >
                <Icon name="search" size={15} strokeWidth={1.9} />
                Preview
              </button>
            )}

            {onSaveDraft && (
              <button onClick={onSaveDraft} type="button" className="s2-footer-btn"
                disabled={!title || !slug || !eventDate || savingDraft}
                title="Save your progress and finish later from Dashboard → Drafts"
                style={{
                  height: 48, padding: '0 22px',
                  background: C.white, border: `1.5px solid ${C.gold}`,
                  borderRadius: 12, fontFamily: 'var(--font-sans)',
                  fontSize: 14, fontWeight: 700, color: C.gold,
                  cursor: (!title || !slug || !eventDate || savingDraft) ? 'not-allowed' : 'pointer',
                  opacity: (!title || !slug || !eventDate || savingDraft) ? 0.5 : 1,
                  display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                {savingDraft ? 'Saving…' : 'Save as Draft'}
              </button>
            )}

            <button onClick={onNext} data-testid="wizard-next" className="s2-footer-btn"
            disabled={!title || !slug || !eventDate || anyMediaUploading}
            style={{
              height: 48, padding: '0 32px',
              background: (!title || !slug || !eventDate || anyMediaUploading) ? '#ccc' : 'linear-gradient(135deg, #B8944F, #a6833f)',
              color: C.white, border: 'none', borderRadius: 12,
              fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 700,
              cursor: (!title || !slug || !eventDate || anyMediaUploading) ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
              boxShadow: (!title || !slug || !eventDate || anyMediaUploading) ? 'none' : '0 4px 16px rgba(184,148,79,0.3)',
              transition: 'all 0.3s',
            }}
          >
            {anyMediaUploading ? 'Uploading…' : 'Continue to Distribution'}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        @media (max-width: 767.98px) {
          .s2-row { grid-template-columns: 1fr !important; }
          .s2-privacy { grid-template-columns: 1fr !important; }
          .s2-swatch-row { grid-template-columns: repeat(2, 1fr) !important; }
        }
        /* The 3-button footer (Back / Save as Draft / Continue) has no wrap
           and the root overflow guard clips rather than scrolls, so past
           ~550px combined width "Continue" — the only way to advance the
           wizard — gets pushed off-screen and becomes untappable. Stack it
           full-width instead, Continue on top since it's the primary action. */
        @media (max-width: 639.98px) {
          .s2-footer-inner { flex-direction: column-reverse !important; align-items: stretch !important; gap: 10px !important; }
          .s2-footer-actions { flex-direction: column-reverse !important; align-items: stretch !important; width: 100% !important; gap: 10px !important; }
          .s2-footer-btn { width: 100% !important; justify-content: center !important; }
        }
      `}</style>
    </div>
  );
}
