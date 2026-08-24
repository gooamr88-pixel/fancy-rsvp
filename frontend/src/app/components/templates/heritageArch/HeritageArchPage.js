'use client';

import React from 'react';
import SnapShell from './SnapShell';
import { FullPageThemeProvider, buildPalette } from './theme';
import { HERITAGE_ARCH_DEFAULTS as D } from './defaultContent';
import { getHaDays } from '../../../utils/haDays';
import { CUSTOM_CATEGORY_BY_KEY, occasionTagline } from '../../../utils/customEventCategories';
import { resolveOccasion } from '../../../utils/eventOccasion';
import { getCinematicTemplate, getCinematicOccasion, getCinematicCopy } from '../cinematic/cinematicThemes';
import VelvetRingHero from '../cinematic/VelvetRingHero';
import DoorOfJoyHero from '../cinematic/DoorOfJoyHero';
import SwanLakeHero from '../cinematic/SwanLakeHero';
import LetterPortraitHero from '../cinematic/LetterPortraitHero';

/* Keyed by `cinematic.hero`, not chosen by a ternary — see the note on
   CINEMATIC_OPENINGS in [slug]/EventPageClient.js. The ternary this replaces
   would have handed Swan Lake the Door of Joy hero, silently. */
const CINEMATIC_HEROES = {
  velvetRing: VelvetRingHero,
  doorOfJoy: DoorOfJoyHero,
  swanLake: SwanLakeHero,
  letterPortrait: LetterPortraitHero,
};
import AmbientFx from '../../guest/fx/AmbientFx';
import HeroSection from './sections/HeroSection';
import EventDateSection from './sections/EventDateSection';
import CoverPhotoSection from './sections/CoverPhotoSection';
import CountdownSection from './sections/CountdownSection';
import ClosingSection from './sections/ClosingSection';
import ScheduleSection from './sections/ScheduleSection';
import VenuesSection from './sections/VenuesSection';
import DressCodeSection from './sections/DressCodeSection';
import NoKidsSection from './sections/NoKidsSection';
import OurStorySection from './sections/OurStorySection';
import DescriptionSection from './sections/DescriptionSection';
import AccommodationSection from './sections/AccommodationSection';
import MenuSection from './sections/MenuSection';
import GiftListSection from './sections/GiftListSection';
import FaqSection from './sections/FaqSection';
import GallerySection from './sections/GallerySection';
import InvitedToSection from './sections/InvitedToSection';
import ThingsToDoSection from './sections/ThingsToDoSection';
import GettingThereSection from './sections/GettingThereSection';
import RsvpSection from './sections/RsvpSection';
import { formatInZone, instantToWallClock } from '../../../utils/timezone';

/* Custom Canvas's "Heading Typography" options (CustomBuilder.js's FONTS),
   mapped to the custom properties globals.css declares for them.

   'serif' is deliberately absent: it is the default, and writing
   `--font-serif: var(--font-serif)` on the element that declares it is a
   circular reference — CSS resolves those to the guaranteed-invalid value, so
   the page would silently lose its heading face instead of keeping it. */
const CUSTOM_HEADING_FONTS = {
  sans: 'var(--font-sans)',
  script: 'var(--font-script)',
  display: 'var(--font-display)',
  minimal: 'var(--font-minimal)',
  whimsical: 'var(--font-whimsical)',
};

/* Same allowlist EventPageClient applies before putting a family name in a
   stylesheet — these values come from an organizer-editable column and end up
   inside a CSS declaration. Duplicated rather than imported for the reason
   given in GuestExperiencePreview: importing one export from EventPageClient
   evaluates the whole guest route. */
function sanitizeFontName(name) {
  if (!name) return null;
  const clean = String(name).replace(/[^a-zA-Z0-9 -]/g, '').trim();
  return clean || null;
}

/**
 * The organizer's Heading Font / Body Font, as page-wide custom properties.
 *
 * These two pickers have been in the Design tab for a long time and have never
 * once applied here. The CSS that honours them lives in EventPageClient's
 * LEGACY continuous-scroll branch — after the `FULL_PAGE_TEMPLATES` early
 * return — and every currently-offered template is full-page, so every event
 * created since then loaded an organizer-chosen webfont from a third-party
 * host and then rendered in the brand faces regardless.
 *
 * Routed through --font-serif / --font-sans because that is what the sections
 * already ask for, so one pair of declarations reaches all of them. The
 * families are appended to the existing stacks rather than replacing them: if
 * the webfont never arrives (fonts.googleapis.com is unreachable in several
 * countries and behind many corporate proxies) the page falls back to the
 * brand face instead of to the browser default.
 */
function buildFontVars(customFonts) {
  if (!customFonts) return null;
  const heading = sanitizeFontName(customFonts.heading);
  const body = sanitizeFontName(customFonts.body);
  const vars = {};
  if (heading) vars['--font-serif'] = `'${heading}', var(--font-heading), Georgia, serif`;
  if (body) vars['--font-sans'] = `'${body}', var(--font-body), system-ui, sans-serif`;
  return Object.keys(vars).length ? vars : null;
}

function formatDateLine(startISO, endISO, isRTL, timeZone) {
  if (!startISO) return null;
  const locale = isRTL ? 'ar-EG' : 'en-US';
  const opts = { month: 'long', day: 'numeric', year: 'numeric' };
  const start = (formatInZone(startISO, timeZone, opts, locale) || '').toUpperCase();
  if (!endISO) return start;
  const end = (formatInZone(endISO, timeZone, opts, locale) || '').toUpperCase();
  return `${start} - ${end}`;
}

// Event time — separate from the date line so a multi-day range (which already
// reads as "START - END") never has a single time awkwardly glued onto it.
function formatTimeLine(startISO, isRTL, timeZone) {
  if (!startISO) return null;
  // A bare DATE-only value (no clock component supplied at creation) becomes
  // midnight — showing "12:00 AM" for those would read as a real start time
  // instead of "no time set," so this is intentionally hidden then.
  //
  // The midnight test MUST be made in the event's own zone. It used to read
  // getUTCHours(), which was right while the stored value was the typed digits
  // filed as UTC — and is now actively wrong: a 5:00pm San Diego event is
  // exactly 00:00 UTC, so a UTC test would classify a perfectly ordinary
  // evening start as "no time set" and silently drop the time from the
  // invitation. Reading the wall clock in the event's zone asks the question
  // that was always meant: did the organizer leave the clock at midnight?
  const wall = instantToWallClock(startISO, timeZone);
  if (wall.endsWith('T00:00')) return null;
  return formatInZone(startISO, timeZone, { hour: 'numeric', minute: '2-digit' }, isRTL ? 'ar-EG' : 'en-US');
}

function parseMealOptions(raw, isPreview) {
  if (Array.isArray(raw) && raw.length > 0) return raw;
  if (typeof raw === 'string' && raw.trim()) return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return isPreview ? D.mealOptions : [];
}

export default function HeritageArchPage({
  event, guestRsvp, lang, setLang, isRTL, t, timeLeft, musicPlaying, toggleMusic,
  hasBackgroundMusic, hasResponded, responseStatus, allowGuestEdits, slug, effectiveRsvpId, trackEvent,
  invitationPattern, invitationTheme, invitationGuestName, invitationData,
  /* Fill EMPTY sections with curated sample content. True for the marketing
     demo and for Stage 1 of the wizard, where the organizer is judging a
     template and has entered nothing yet — a page of hidden sections would
     show them nothing to judge.
     FALSE for the Stage 2 preview, where every empty section must stay hidden:
     the question there is "what will my guests get", and inventing hotels and
     an itinerary they never entered answers a different one. */
  isPreview = false,
  /* Nothing here may write. Separate from isPreview on purpose — the Stage 2
     preview wants real content (isPreview false) AND an inert RSVP, and
     conflating the two would have that preview POST a real submission to an
     event that does not exist yet. */
  readOnly = false,
  // Rendered inside a frame (the organizer's preview) rather than as the
  // document. Only affects how the scroll container is sized — see SnapShell.
  embedded = false,
  /* True while a cinematic opening is still covering this page. Read by Swan
     Lake's hero only, which holds its embossed state until the cover goes and
     then blooms into colour with it. Defaults false so any caller that does
     not manage an opening (the marketing demo) renders the finished hero. */
  openingActive = false,
}) {
  const td = event.template_data || {};
  const customColors = event.custom_colors || {};
  // Explicit per-section on/off, set by the organizer in Stage 2's "Sections"
  // panel. Defaults to true (unset === shown) so existing events — which never
  // set this — keep their current auto-hide-when-empty behavior; an organizer
  // can still force a section off even when it has content.
  const enabledSections = td.enabledSections || {};
  const sectionOn = (key) => enabledSections[key] !== false;
  // Derived section palette — Heritage Arch returns its own fixed burgundy/cream
  // constants (guarded in buildPalette); every other template gets a palette
  // derived from its custom_colors so the same sections recolor per event.
  const palette = buildPalette(customColors, event.template_type);
  // In preview/demo contexts the template shows curated demo content so it
  // always previews as a complete page; for REAL guests, unfilled sections
  // gracefully hide instead of showing placeholder data (fake hotels/story/etc).
  const demo = (value) => (isPreview ? value : null);

  const partner1 = td.groom_name || td.partner1Name || td.partner1 || demo(D.partner1) || '';
  const partner2 = td.bride_name || td.partner2Name || td.partner2 || demo(D.partner2) || '';
  const dateLine = formatDateLine(event.event_date, event.event_end_date, isRTL, event.timezone);
  // Only shown for a single-day event — a start/end range already reads as a
  // full span, and gluing one clock time onto it would misleadingly imply
  // the whole range starts then.
  const timeLine = !event.event_end_date ? formatTimeLine(event.event_date, isRTL, event.timezone) : null;
  // Event start/end time for the Countdown section's "Event Time" card.
  // Single-day events already show their date + start time in the Hero, so
  // the card is suppressed then to avoid repeating the same line twice on
  // one page; it only surfaces for multi-day events, where the Hero
  // deliberately omits time and this is the sole place guests see it.
  const startTimeLine = event.event_end_date ? formatTimeLine(event.event_date, isRTL, event.timezone) : null;
  const endTimeLine = event.event_end_date ? formatTimeLine(event.event_end_date, isRTL, event.timezone) : null;

  // Custom's "what kind of event is this?" category (Stage 2) drives the hero
  // name/tagline for every category with no "couple" — wedding/engagement
  // categories already work via partner1/partner2 above. All fall back to
  // the event's own title when the organizer hasn't named a celebrant/parents
  // yet, exactly like every other template does.
  /* "What kind of event is this?" — asked of EVERY template now, and stored
     in one place for all of them.

     This used to be read only for Custom Canvas, because every other template
     WAS an occasion: Velvet Ring was an engagement and Door of Joy a wedding,
     so the artwork and the celebration were a single decision. Now the
     template supplies only a default (see getCinematicOccasion), which is
     what keeps every event created before the picker rendering as it did. */
  const customCategory = resolveOccasion(event.template_type, td);
  /* Custom Canvas's "Heading Typography" pick, applied to the PAGE.

     It used to reach exactly one element: the small invitation card inside the
     hero (InvitationCard's `custom` arm reads cfg.headingFont). Every heading
     on the page below it stayed on the brand serif, so an organizer could
     choose "Whimsical", watch nothing change, and reasonably conclude the
     control did nothing.

     Overriding --font-serif on the page container routes it through all of
     them at once, because every section already asks for its headings by that
     name. 'serif' is absent from the map on purpose: `--font-serif:
     var(--font-serif)` on the same element is a circular reference, which
     resolves to the guaranteed-invalid value and would drop the page to a
     default face rather than leaving it alone. */
  const pageHeadingFont = event.template_type === 'custom'
    ? CUSTOM_HEADING_FONTS[td.customDesign?.headingFont]
    : null;
  /* Custom Canvas's own heading pick wins over the generic Heading Font: it is
     the more specific control, it sits right next to the palette it belongs
     with, and the settings screen hides the generic one for that template so
     the two can never be set to different things on purpose. */
  const pageStyleVars = (() => {
    const vars = { ...(buildFontVars(event.custom_fonts) || {}) };
    if (pageHeadingFont) vars['--font-serif'] = pageHeadingFont;
    return Object.keys(vars).length ? vars : undefined;
  })();
  const customCategoryMeta = customCategory ? CUSTOM_CATEGORY_BY_KEY[customCategory] : null;
  const isHonoreeCategory = customCategoryMeta?.kind === 'honoree';
  const isBabyShowerCategory = customCategoryMeta?.kind === 'babyShower';
  /* HeroSection's generic couple fallback tagline is "We are getting married",
     which is wrong for an engagement — nobody is married yet — so an
     engagement needs an explicit override instead of inheriting wedding copy.

     No template keys left in this test. It used to name 'ring' explicitly,
     because Velvet Ring WAS the engagement; now every template's occasion
     arrives through `customCategory`, and the retired 'engagement' template
     is the only key that still has to answer for itself (it has no cinematic
     entry to carry a defaultOccasion). */
  const isEngagementEvent = customCategory === 'engagement' || event.template_type === 'engagement';
  const heroTitle = isHonoreeCategory ? (td.custom_honoree || event.title)
    : isBabyShowerCategory ? (td.custom_parents || event.title)
    : event.title;
  // Arabic override typed in the wizard/EventSettings — same field the classic
  // template's InvitationCard and InvitationReveal envelope already read; this
  // full-page hero was the one place still stuck on the English title/dress
  // code even with the page switched to Arabic.
  const titleAr = event.title_ar || td.title_ar || null;
  const heroTagline = isHonoreeCategory
    ? (td.custom_milestone || (isRTL ? 'يسعدنا احتفالنا معكم' : 'Join us to celebrate'))
    : isBabyShowerCategory
    ? (td.custom_baby_name ? (isRTL ? `نستقبل قدوم ${td.custom_baby_name}` : `Welcoming ${td.custom_baby_name}`) : (td.custom_baby_due || (isRTL ? 'ينتظرنا مولود جديد' : "We're expecting!")))
    /* Every other occasion's line comes from the catalogue, which is where it
       now lives beside that occasion's label, icon and field copy. Vow Renewal
       and Engagement both need one because HeroSection's built-in couple
       default — "We are getting married" — is wrong for each in its own way.
       Wedding deliberately has none, so it still falls through to the
       template's own line or to that default; see the note in
       customEventCategories.js. */
    : (occasionTagline(customCategory, isRTL)
      // The retired Engagement template has no catalogue entry of its own.
      || (isEngagementEvent ? (isRTL ? 'تمت خطوبتنا!' : 'We Are Getting Engaged') : ''));
  // A small icon+label pill above the hero name so guests immediately see
  // what kind of event this is (e.g. a graduation cap + "Graduation") —
  // wedding/engagement skip this since the couple names + their own tagline
  // above already make the occasion obvious without it.
  const categoryBadge = (isHonoreeCategory || isBabyShowerCategory) && customCategoryMeta
    ? { iconName: customCategory, label: isRTL ? customCategoryMeta.labelAr : customCategoryMeta.label }
    : null;

  // A flexible list of days — one for a single-day event, two, three, or
  // more — each with its own venue and schedule. Falls back to the older
  // fixed day1/day2 fields for events saved before this was dynamic, then to
  // the plain ceremony/location fields, then (preview only) to demo content,
  // so every event still shows something reasonable.
  let haDays = getHaDays(td);
  if (haDays.length === 0 && isPreview) {
    haDays = [
      { label: 'Day 1', schedule: D.schedule.day1, venue: { name: D.venues.day1.name, address: D.venues.day1.address, lat: D.venues.day1.lat, lng: D.venues.day1.lng, image: null } },
      { label: 'Day 2', schedule: D.schedule.day2, venue: { name: D.venues.day2.name, address: D.venues.day2.address, lat: D.venues.day2.lat, lng: D.venues.day2.lng, image: null } },
    ];
  }
  if (haDays.length === 0 && !isPreview) {
    const fallbackVenue = {
      name: td.ceremony_venue_name || event.location_name || '',
      address: td.ceremony_venue_address || event.location_address || '',
      lat: td.ceremony_lat ?? event.location_lat ?? null,
      lng: td.ceremony_lng ?? event.location_lng ?? null,
      image: event.cover_image_url || null,
    };
    if (fallbackVenue.name || fallbackVenue.address) {
      haDays = [{ label: '', schedule: [], venue: fallbackVenue }];
    }
  }
  const primaryVenue = haDays[0]?.venue || {};
  const hasVenues = haDays.some((d) => d.venue?.name || d.venue?.address);
  const hasSchedule = haDays.some((d) => Array.isArray(d.schedule) && d.schedule.length > 0);

  // Structured ha_accommodation (this template's own list editor) wins; the
  // plain-text `accommodations` field organizers may have already filled in
  // via the shared wedding-schema wizard step is shown as a fallback note.
  const hasStructuredAccommodation = Array.isArray(td.ha_accommodation) && td.ha_accommodation.length > 0;
  const accommodation = hasStructuredAccommodation ? td.ha_accommodation : (isPreview ? D.accommodation : []);
  const accommodationNote = !hasStructuredAccommodation ? (td.accommodations || null) : null;
  const hasAccommodation = accommodation.length > 0 || !!accommodationNote;

  const faq = Array.isArray(td.ha_faq) && td.ha_faq.length > 0 ? td.ha_faq : (isPreview ? D.faq : []);
  const hasFaq = faq.length > 0;
  const ourStory = td.ha_our_story || td.loveStory || td.proposalStory || demo(D.ourStory) || '';
  // Same event.description / template_data.description_ar the non-full-page
  // hero (EventPageClient) already shows — see descAr/localizedDesc there.
  const descriptionAr = event.description_ar || td.description_ar || null;
  const description = (isRTL && descriptionAr) ? descriptionAr : (event.description || '');
  const dressCode = (isRTL && td.dress_code_ar) || event.dress_code || demo(D.dressCode) || '';
  const invitedToCity = td.ha_invited_to_city || (event.location_name ? event.location_name.split(',')[0] : (isPreview ? D.invitedToCity : ''));
  // The map pin uses the city's own coordinates when the organizer picked one
  // via the address search (ha_invited_to_lat/lng); only falls back to Day 1's
  // venue when no city coordinates were ever captured, so a custom "invited to"
  // city never shows a pin sitting on a different, unrelated location.
  const invitedToLat = td.ha_invited_to_lat ?? primaryVenue.lat;
  const invitedToLng = td.ha_invited_to_lng ?? primaryVenue.lng;
  const mealOptions = parseMealOptions(td.ha_meal_options, isPreview);
  const galleryImages = Array.isArray(event.gallery_urls) && event.gallery_urls.length > 0 ? event.gallery_urls : [];
  const giftRegistry = td.registryUrl || td.giftRegistry || null;

  // ── New sections (Phase 1): all graceful-hide when their data is empty ──
  const menuCourses = Array.isArray(td.ha_menu_courses) ? td.ha_menu_courses : [];
  const thingsToDo = Array.isArray(td.ha_things_to_do) ? td.ha_things_to_do : [];
  const gettingThere = td.ha_getting_there || '';
  const giftBank = {
    name: td.ha_gift_bank_name || '',
    accountName: td.ha_gift_account_name || '',
    iban: td.ha_gift_iban || '',
  };
  const hasGiftList = !!(giftRegistry || giftBank.name || giftBank.iban);

  // Sections are assembled Hero (+ Cover Photo/About) first, then the
  // reorderable middle content, then Countdown immediately before RSVP —
  // all three (Hero, Countdown, RSVP) are fixed anchors, never part of the
  // organizer's reorderable middle section. Every content section in between
  // is keyed by the same SECTION_TOGGLES key Stage 2's "Sections" panel uses,
  // built only when it has real data (or in preview) — same pattern as
  // Gallery — then reordered by the organizer's saved sectionOrder (see the
  // ↑/↓ arrangement controls), falling back to this default order for anyone
  // who never touched it.
  const middleSections = {};
  if (hasSchedule && sectionOn('schedule')) {
    middleSections.schedule = { id: 'ha-schedule', content: <ScheduleSection days={haDays} isRTL={isRTL} /> };
  }
  if (hasVenues && sectionOn('venues')) {
    middleSections.venues = { id: 'ha-venues', content: <VenuesSection days={haDays} isRTL={isRTL} t={t} /> };
  }
  if (dressCode && sectionOn('dresscode')) {
    middleSections.dresscode = { id: 'ha-dresscode', content: <DressCodeSection dressCode={dressCode} customColors={customColors} ladiesText={td.ha_dress_ladies} gentlemenText={td.ha_dress_gentlemen} isRTL={isRTL} /> };
  }
  // Not part of SECTION_TOGGLES (same convention Cover Photo/Gift List used) —
  // shows automatically once the organizer flips EventSettings' "Adults-Only
  // Notice" toggle. Previously the ONLY guest-facing trace of this toggle was
  // 6.5px text on the miniature invitation card and a generic "Note" row in
  // the reveal's expand panel — easy to miss entirely, not the premium,
  // unmissable notice an adults-only celebration needs guests to actually see.
  /**
   * THE FLAG IS THE GATE. The template is not.
   *
   * This used to also require `template_type` to be exactly 'wedding' or
   * 'engagement', which quietly excluded every other event rendered by this
   * same engine — Custom Canvas above all, the one template whose entire
   * premise is "every feature from every event type, add or remove what you
   * like". An organizer running an adults-only graduation dinner or a curated
   * Tuscany wedding could not show the notice at all, and nothing told them
   * why: the section simply never appeared.
   *
   * `no_kids_allowed` already defaults to false, so an event that has not
   * asked for it still shows nothing. The template check was adding no safety
   * on top of that — only a silent exclusion.
   */
  const showNoKids = !!event.no_kids_allowed;
  if (showNoKids) {
    middleSections.nokids = { id: 'ha-nokids', content: <NoKidsSection isRTL={isRTL} /> };
  }
  if (description.trim() && sectionOn('about')) {
    middleSections.about = { id: 'ha-about', content: <DescriptionSection text={description} isRTL={isRTL} /> };
  }
  if (ourStory && sectionOn('story')) {
    middleSections.story = { id: 'ha-story', content: <OurStorySection story={ourStory} isRTL={isRTL} /> };
  }
  if (hasAccommodation && sectionOn('accommodation')) {
    middleSections.accommodation = { id: 'ha-accommodation', content: <AccommodationSection hotels={accommodation} note={accommodationNote} isRTL={isRTL} /> };
  }
  if (menuCourses.length > 0 && sectionOn('menu')) {
    middleSections.menu = { id: 'ha-menu', content: <MenuSection courses={menuCourses} isRTL={isRTL} /> };
  }
  if (hasGiftList && sectionOn('giftlist')) {
    middleSections.giftlist = { id: 'ha-giftlist', content: <GiftListSection registryUrl={giftRegistry} registryLabel={td.ha_gift_registry_label} bank={giftBank} message={td.ha_gift_message} isRTL={isRTL} /> };
  }
  if (hasFaq && sectionOn('faq')) {
    middleSections.faq = { id: 'ha-faq', content: <FaqSection items={faq} isRTL={isRTL} /> };
  }
  if (galleryImages.length > 0 && sectionOn('gallery')) {
    middleSections.gallery = { id: 'ha-gallery', content: <GallerySection images={galleryImages} isRTL={isRTL} /> };
  }
  // The "You're Invited To" city/map section is dropped for Wedding and
  // Engagement — those two show full venue details (name + address) on the
  // invitation card and in Venues/Getting There instead, so a same-city
  // guest was seeing a redundant, sometimes-wrong "city" (it silently fell
  // back to the venue's own name split on the first comma when no explicit
  // ha_invited_to_city was set, e.g. showing "The Grand Ballroom" as if it
  // were a city). Destination-style variants and Custom Canvas keep it —
  // they're the events where telling a guest which city they're flying to
  // is genuinely useful.
  // The cinematic pair join them: both show the full venue name and address
  // in Venues/Getting There, so a "city" screen would be the same information
  // a third time — and it is the one that guesses when unset.
  const isWeddingOrEngagement = ['wedding', 'engagement', 'ring', 'bab'].includes(event.template_type);
  if (invitedToCity && sectionOn('invited') && !isWeddingOrEngagement) {
    middleSections.invited = { id: 'ha-invited', content: <InvitedToSection city={invitedToCity} lat={invitedToLat} lng={invitedToLng} isRTL={isRTL} /> };
  }
  if (thingsToDo.length > 0 && sectionOn('thingstodo')) {
    middleSections.thingstodo = { id: 'ha-thingstodo', content: <ThingsToDoSection items={thingsToDo} isRTL={isRTL} /> };
  }
  if (gettingThere.trim() && sectionOn('gettingthere')) {
    middleSections.gettingthere = { id: 'ha-gettingthere', content: <GettingThereSection text={gettingThere} isRTL={isRTL} /> };
  }

  // Grouped into a narrative arc instead of an arbitrary list: the personal
  // story first (right after Hero/About), then a broad "where" before the
  // specific "when/where/what to wear" logistics, then everything an
  // out-of-town guest needs travel-wise grouped together (previously
  // Accommodation and Getting There sat far apart in the list despite
  // covering the same territory), then day-of details, FAQ as a catch-all,
  // and Gallery as a visual close before Countdown builds anticipation
  // right into the RSVP ask.
  const DEFAULT_SECTION_ORDER = ['about', 'story', 'invited', 'schedule', 'venues', 'dresscode', 'nokids', 'accommodation', 'gettingthere', 'thingstodo', 'menu', 'giftlist', 'faq', 'gallery'];
  const savedOrder = Array.isArray(td.sectionOrder) ? td.sectionOrder : [];
  const resolvedOrder = [
    ...savedOrder.filter((k) => middleSections[k]),
    ...DEFAULT_SECTION_ORDER.filter((k) => middleSections[k] && !savedOrder.includes(k)),
  ];

  // Short bilingual label per section id, shown as a hover tooltip on the
  // side nav dots (SnapShell's DotNav) — covers every fixed anchor and
  // every possible reorderable middle section pushed below.
  const SECTION_LABELS = {
    'ha-hero': isRTL ? 'الرئيسية' : 'Home',
    'ha-date': isRTL ? 'الموعد' : 'The Date',
    'ha-cover-photo': isRTL ? 'صورة الغلاف' : 'Cover Photo',
    'ha-schedule': isRTL ? 'البرنامج' : 'Schedule',
    'ha-venues': isRTL ? 'المكان' : 'Venue',
    'ha-dresscode': isRTL ? 'الزي' : 'Dress Code',
    'ha-nokids': isRTL ? 'ملاحظة' : 'A Kind Note',
    'ha-about': isRTL ? 'عن المناسبة' : 'About',
    'ha-story': isRTL ? 'قصتنا' : 'Our Story',
    'ha-accommodation': isRTL ? 'الإقامة' : 'Accommodation',
    'ha-menu': isRTL ? 'القائمة' : 'Menu',
    'ha-giftlist': isRTL ? 'الهدايا' : 'Gift List',
    'ha-faq': isRTL ? 'الأسئلة الشائعة' : 'FAQ',
    'ha-gallery': isRTL ? 'معرض الصور' : 'Gallery',
    'ha-invited': isRTL ? 'المدينة' : "You're Invited To",
    'ha-thingstodo': isRTL ? 'أنشطة' : 'Things To Do',
    'ha-gettingthere': isRTL ? 'الوصول' : 'Getting There',
    'ha-countdown': isRTL ? 'العد التنازلي' : 'Countdown',
    'ha-closing': isRTL ? 'كلمة ختامية' : 'Closing',
    'ha-rsvp': isRTL ? 'تأكيد الحضور' : 'RSVP',
  };
  const withLabel = (entry) => (entry ? { ...entry, label: SECTION_LABELS[entry.id] || '' } : entry);

  /* The cinematic templates (Velvet Ring, Door of Joy, Swan Lake) swap the
     hero — and only the hero. Everything below it is this file's ordinary
     section list, built from the organizer's dashboard exactly as it is for
     every other template, and recoloured to the template's own palette by
     buildPalette above. The photography stops at the fold; the content does
     not change. */
  const cinematic = getCinematicTemplate(event.template_type);
  const CinematicHero = cinematic ? CINEMATIC_HEROES[cinematic.hero] : null;
  // 'wedding' | 'engagement' for Swan Lake (the organizer's Step 2 answer);
  // the template's own fixed occasion for the other two.
  const cinematicOccasion = getCinematicOccasion(cinematic, td);
  const cinematicCopy = cinematic ? getCinematicCopy(cinematic, { isRTL, occasion: cinematicOccasion }) : null;
  const heroDisplayName = (isRTL && titleAr) ? titleAr
    : (partner1 && partner2 ? `${partner1} & ${partner2}` : (heroTitle || partner1 || partner2 || ''));
  const heroCoupleNames = (!(isRTL && titleAr) && partner1 && partner2) ? [partner1, partner2] : null;

  const sections = [
    {
      id: 'ha-hero',
      label: SECTION_LABELS['ha-hero'],
      /* The cinematic heroes end on their own "Scroll down" cue, part of the
         composition rather than page chrome. SnapShell also pins a fixed
         "SCROLL TO RSVP" hint to the bottom of every screen, so the first
         screen carried two scroll prompts — and on Velvet Ring, whose hero
         runs past the fold, they landed on top of each other and neither was
         readable. One cue per screen: the hero's own on this one, SnapShell's
         from the next section down. */
      ownScrollCue: !!CinematicHero,
      content: CinematicHero ? (
        <CinematicHero
          template={cinematic}
          names={heroDisplayName}
          coupleNames={heroCoupleNames}
          // The template's own worded line is the fallback, not a hardcoded
          // "we are getting married" — Velvet Ring is an engagement.
          /* The occasion's own line first (it is the specific one — a
             milestone the organizer typed, or the catalogue's wording), then
             the template's. `cinematicCopy.sub` is already occasion-aware: it
             is the template's own voice on its own occasion and empty on any
             other, so a birthday can never inherit a wedding's sentence. */
          tagline={(isPreview ? D.tagline : heroTagline) || cinematicCopy.sub}
          dateLine={[dateLine, timeLine].filter(Boolean).join(isRTL ? ' — ' : ' — ')}
          coverImageUrl={event.cover_image_url || null}
          /* Sealed Letter's own four, and only it reads them. Deliberately
             NOT event.cover_image_url: that is the social card, the dashboard
             tile and its own cover-photo section. This one fills the fold on
             a phone, so it is a different picture with a different crop —
             reusing the cover would print the same image twice on one page.
             See LetterPortraitHero.

             No `isPreview` sample fallback, unlike most of this file. An empty
             hero is not a broken one here: it falls back to a typographic
             page on the template's own paper, which is a finished look in its
             own right. Substituting a stock photograph would be showing the
             organizer something they did not upload and will never get. */
          heroPhoto={td.letter_hero_photo || null}
          heroFocus={td.letter_hero_focus}
          heroTextPos={td.letter_hero_text_pos}
          heroCaption={td.letter_hero_caption}
          heroCaptionSub={td.letter_hero_caption_sub}
          invitationPattern={invitationPattern} invitationTheme={invitationTheme}
          invitationGuestName={invitationGuestName} invitationData={invitationData}
          title={heroTitle} isRTL={isRTL}
          // Only Swan Lake and Sealed Letter read these two; the others ignore
          // them.
          occasion={cinematicOccasion} openingActive={openingActive}
        />
      ) : (
        <HeroSection
          partner1={partner1} partner2={partner2} title={heroTitle}
          tagline={isPreview ? D.tagline : heroTagline} titleAr={titleAr}
          invitationPattern={invitationPattern} invitationTheme={invitationTheme}
          invitationGuestName={invitationGuestName} invitationData={invitationData}
          categoryBadge={isPreview ? null : categoryBadge}
          isRTL={isRTL} t={t}
        />
      ),
    },
  ];

  // The date/time, promoted to its own full section right after the Hero/
  // invitation-card showcase — previously a small pill crowded underneath
  // the card itself, easy to miss on the single most important fact here.
  // Skipped for the cinematic templates: their hero states the date and time
  // directly under the names, so a full "Save the Date" screen immediately
  // below would be the same sentence twice in a row — the same reason
  // startTimeLine is suppressed for single-day events above.
  if (dateLine && !cinematic) {
    sections.push({
      id: 'ha-date',
      label: SECTION_LABELS['ha-date'],
      content: <EventDateSection dateLine={dateLine} timeLine={timeLine} isRTL={isRTL} />,
    });
  }

  // The cover photo, now that the template card is the hero centerpiece, gets
  // its own framed slide — shown only when the organizer uploaded one.
  if (event.cover_image_url) {
    sections.push({ id: 'ha-cover-photo', label: SECTION_LABELS['ha-cover-photo'], content: <CoverPhotoSection imageUrl={event.cover_image_url} isRTL={isRTL} /> });
  }

  for (const key of resolvedOrder) {
    sections.push(withLabel(middleSections[key]));
  }

  sections.push({ id: 'ha-countdown', label: SECTION_LABELS['ha-countdown'], content: <CountdownSection timeLeft={timeLeft} isRTL={isRTL} startTime={startTimeLine} endTime={endTimeLine} /> });

  sections.push({
    id: 'ha-closing',
    label: SECTION_LABELS['ha-closing'],
    content: <ClosingSection closingMessage={td.ha_closing_message} isRTL={isRTL} />,
  });

  sections.push({
    id: 'ha-rsvp',
    label: SECTION_LABELS['ha-rsvp'],
    content: (
      <RsvpSection
        event={event} slug={slug} guestRsvp={guestRsvp} hasResponded={hasResponded}
        responseStatus={responseStatus} allowGuestEdits={allowGuestEdits} effectiveRsvpId={effectiveRsvpId}
        mealOptions={mealOptions} isRTL={isRTL} trackEvent={trackEvent}
        readOnly={readOnly}
      />
    ),
  });

  return (
    <FullPageThemeProvider palette={palette}>
      {/* Gold dust, drifting petals and the pointer sparkle — fixed to the
          viewport, so the motion carries across every section instead of
          restarting at each one. A sibling of the shell rather than a child:
          it is position:fixed either way, and keeping it out of the scroll
          container means no future transform/filter on that container can
          silently re-anchor it. */}
      {cinematic && <AmbientFx recipe={cinematic.fx} cssVars={cinematic.cssVars} />}
      <SnapShell
        sections={sections}
        event={event}
        lang={lang}
        setLang={setLang}
        isRTL={isRTL}
        musicPlaying={musicPlaying}
        toggleMusic={toggleMusic}
        hasBackgroundMusic={hasBackgroundMusic}
        embedded={embedded}
        styleVars={pageStyleVars}
      />
    </FullPageThemeProvider>
  );
}
