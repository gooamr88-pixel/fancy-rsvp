'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { guestTitle } from '../utils/guestBranding';
import { motion, AnimatePresence, useInView } from 'framer-motion';
import { translations } from '../utils/translations';
import { useGuestAnalytics } from '../utils/useGuestAnalytics';
import { useIsClient } from '../utils/useIsClient';
import { extractYouTubeId, loadYouTubeIframeApi } from '../utils/youtube';
import { getRsvpDeadlineStatus, daysLeftPhrase } from '../utils/rsvpDeadline';
import {
  FadeInUp,
  StaggerChildren,
  StaggerItem,
  ScaleIn,
  FloatingParticles,
  CountdownDigit,
  AnimatedText,
  ShimmerPlaceholder,
  PageTransition,
  GlowPulse,
} from '../components/guest/GuestAnimations';
import {
  GlassmorphismCard,
  PremiumButton,
  BentoCard,
  MagneticButton,
  GalleryLightbox,
  CalendarButton,
  ShareButton,
  buildCalendarLinks,
  inputStyle,
  inputFocus,
  inputBlur,
} from '../components/guest/GuestUI';
import { ScrollProgressBar as LegacyScrollProgressBar, DotNav as LegacyDotNav, FloatingCalendarButton as LegacyFloatingCalendarButton, ScrollHint as LegacyScrollHint } from '../components/guest/LegacyChrome';
import InvitationReveal from '../components/guest/InvitationReveal';
import InvitationCard from '../components/templates/InvitationCard';
import { CINEMATIC_KEYS, getCinematicTemplate, getCinematicOccasion } from '../components/templates/cinematic/cinematicThemes';
import { occasionKicker } from '../utils/customEventCategories';
import { rememberedId } from '../components/guest/rsvp/useRsvpResolver';
import { WEDDING_VARIANT_TEMPLATES } from '../utils/templateFamilies';
import { buildInvitationCardData } from '../utils/invitationCardData';
import Icon from '../components/icons/Icon';
import { safeZone } from '../utils/timezone';

/* ═══════════════════════════════════════════════════════════════
   Route-level code splitting
   ═══════════════════════════════════════════════════════════════
   This component renders exactly ONE of two mutually exclusive experiences,
   chosen at runtime from event.template_type (see FULL_PAGE_TEMPLATES below):

     • the full-page snap-scroll engine  → HeritageArchPage + its ~20 sections
     • the legacy continuous-scroll page → RsvpExperience + the RsvpWizard steps

   Statically importing both meant every guest downloaded and parsed both. A
   wedding guest — the overwhelming majority — was shipped the entire legacy RSVP
   wizard and its step components that can never render for them, and a
   corporate/birthday/gala guest was shipped the whole heritageArch section set
   for the same reason.

   ssr is left ON (the default) deliberately: the server still renders the chosen
   branch into the HTML, so there is no blank frame and no change to first paint —
   this only removes dead weight from the hydration bundle. Do NOT set ssr:false
   here; that would re-create the "invitation is a spinner until JS loads" problem
   that lifting searchParams out of this component just fixed.

   InvitationCard is intentionally NOT split: both branches use it (the legacy page
   directly, the full-page engine via HeroSection), so the bundler already emits it
   as a shared chunk and splitting it would only add a request. */
const HeritageArchPage = dynamic(
  () => import('../components/templates/heritageArch/HeritageArchPage')
);
const RsvpExperience = dynamic(
  () => import('../components/guest/rsvp/RsvpExperience')
);
const RsvpWizard = dynamic(() => import('./rsvp/RsvpWizard'));

/* The cinematic openings, split for the same reason as everything above: a
   guest whose event uses the envelope must not download a video choreography
   engine and a Web Audio synthesiser they will never run, and vice versa.
   Only one of these can ever mount for a given event.

   Keyed by `cinematic.opening`, NOT selected by a ternary. This was
   `opening === 'velvetBox' ? <VelvetBox…> : <KnockDoor…>` in four files, which
   meant every template added after the second one silently rendered Door of
   Joy — a knock-on-the-door cover over somebody else's invitation, with no
   error anywhere. A map has no "everything else" arm to fall into; an unknown
   key renders nothing and is caught by test/swanLakeTemplate.test.jsx, which
   asserts every CINEMATIC_KEYS entry resolves here. */
const CINEMATIC_OPENINGS = {
  velvetBox: dynamic(() => import('../components/guest/openings/VelvetBoxOpening')),
  knockDoor: dynamic(() => import('../components/guest/openings/KnockDoorOpening')),
  waxEnvelope: dynamic(() => import('../components/guest/openings/WaxEnvelopeOpening')),
  sealedLetter: dynamic(() => import('../components/guest/openings/SealedLetterOpening')),
};

/* ═══════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════ */

// Maps an event's template_type to the matching InvitationCard pattern —
// the same mapping the organizer sees in Stage1_TemplatesSimulator
// (TEMPLATE_PREVIEW_MAP), so the guest's card matches what was picked.
const INVITATION_PATTERN_BY_TEMPLATE = {
  wedding: 'serif',
  // Engagement is a duplicate of the wedding theme — same "serif" card
  // artwork/layout, copy swapped for an engagement context (see the
  // 'engagement' case in buildInvitationCardData below and HeritageArchPage's
  // isEngagementEvent tagline override).
  engagement: 'serif',
  corporate: 'geo',
  birthday: 'floral',
  gala: 'minimal',
  custom: 'custom',
  // The cinematic templates show photography at the fold instead of a card,
  // but the card is still what "Save the invitation" captures.
  ring: 'serif',
  bab: 'serif',
  swans: 'serif',
  letter: 'serif',
  tuscany: 'tuscany',
  marrakesh: 'marrakesh',
  kyoto: 'kyoto',
  nordic: 'nordic',
  havana: 'havana',
  estate: 'estate',
  roseAtelier: 'roseAtelier',
  orchid: 'orchid',
  clay: 'clay',
  alpine: 'alpine',
  coastal: 'coastal',
  heritageArch: 'heritageArch',
};



// The full-viewport, snap-scrolled page shell (HeritageArchPage) — originally
// only Heritage Arch — is now the guest experience for the wedding-style
// templates, engagement, AND custom, all of which map cleanly onto its
// sections (couple/host name, story, venues, gift registry, etc. — the hero
// falls back to the event title when there's no couple, so custom events like
// a birthday or baby shower render correctly too). Each renders the same
// sections recolored to its own custom_colors palette (see buildPalette), with
// the envelope reveal still playing first. Every section is individually
// toggleable by the organizer (template_data.enabledSections — see
// HeritageArchPage), which is how "custom" gets every feature from every
// event type with the ability to freely add or remove any of them.
//
// corporate / birthday / gala intentionally stay on the continuous-scroll
// layout below: their content fields (agenda/speakers/sponsors, honoree/
// program, celebrant details) have no section in the full-page engine, and
// they're retired from the organizer picker — kept only so already-existing
// events of those types keep rendering.
// The cinematic pair (Velvet Ring, Door of Joy) belong here too: they are the
// same full-page engine with the same organizer-configured sections, and
// differ only in what happens above the fold — a video opening in place of
// the envelope, and their own hero. See components/templates/cinematic/.
const FULL_PAGE_TEMPLATES = new Set([
  ...WEDDING_VARIANT_TEMPLATES, 'wedding', 'engagement', 'custom',
  ...CINEMATIC_KEYS,
]);

const templateLabels = {
  en: {
    wedding: 'wedding invitation',
    engagement: 'engagement invitation',
    birthday: 'birthday invitation',
    gala: 'gala invitation',
    corporate: 'corporate event',
    party: 'party invitation',
  },
  ar: {
    wedding: 'دعوة زفاف',
    engagement: 'دعوة خطوبة',
    birthday: 'دعوة عيد ميلاد',
    gala: 'دعوة حفل عشاء',
    corporate: 'فعالية رسمية',
    party: 'دعوة حفلة',
  }
};
// Every wedding-variant template shares the same "wedding invitation" label.
WEDDING_VARIANT_TEMPLATES.forEach(key => {
  templateLabels.en[key] = 'wedding invitation';
  templateLabels.ar[key] = 'دعوة زفاف';
});
/* The cinematic templates deliberately have no entry. This map is keyed by
   TEMPLATE, and they no longer have a fixed occasion — "engagement
   invitation" was right for Velvet Ring only while Velvet Ring could not be
   anything else. The lookup below falls back to the event's own occasion
   instead, which is the thing this label was always trying to name. */

// The /demo-wedding route renders a fixed showcase event — fully
// deterministic from the slug, so it's provided via lazy initial state
// instead of a "fetch" that only ever synchronously resolves. (It used to
// live inside fetchEvent's async body as a same-tick early-return, which is
// exactly the "setState before any await" pattern that trips up an effect
// calling that function — see the mount-fetch effect below.)
const DEMO_SLUGS = new Set(['demo-wedding']);
function getDemoEventData(slug) {
  return {
    id: 'demo-uuid',
    title: 'Julian & Sophia\'s Wedding Gala',
    title_ar: 'حفل زفاف جوليان وصوفيا الأنيق',
    description: 'Join us as we celebrate our love and write the next chapter of our story together. An evening of elegance, dinner, and dancing will follow the ceremony.',
    description_ar: 'يسعدنا انضمامكم إلينا لمشاركتنا فرحة العمر والاحتفال بعهد حبنا الجديد. تبدأ مراسم الزفاف يتبعها مأدبة عشاء فاخر وسهرة ممتعة.',
    event_date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 60).toISOString(),
    location_name: 'The Glasshouse Chelsea',
    location_address: '545 W 25th St, New York, NY 10001',
    template_type: 'wedding',
    dress_code: 'Black Tie Optional',
    dress_code_ar: 'ملابس رسمية أنيقة (Black Tie)',
    rsvp_deadline: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
    cover_image_url: 'https://images.unsplash.com/photo-1519741497674-611481863552?q=80&w=2070',
    custom_colors: { primary: '#B8944F', secondary: '#D7BE80', accent: '#191B1E', background: '#F8F4EC' },
  };
}

function sanitizeFontName(name) {
  if (!name) return null;
  return name.replace(/[^a-zA-Z0-9 -]/g, '');
}

function getDirectionsUrl(lat, lng, address, mounted = false) {
  const destination = lat && lng ? `${lat},${lng}` : encodeURIComponent(address || '');
  const isIOS = mounted && typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (isIOS) return `https://maps.apple.com/?daddr=${destination}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
}

/* Decorative floating floral spray flanking the hero photo — a stem with
   three cascading blooms (layered petal ellipses, same technique as the
   InvitationCard "floral" pattern), gently swaying. Colored to the event's
   own theme rather than a fixed pink so it suits any template; mirrored via
   scaleX for the right-hand side. */
function HeroFloralAccent({ color, mirror = false }) {
  const blooms = [{ cx: 50, cy: 225, r: 26 }, { cx: 49, cy: 128, r: 20 }, { cx: 51, cy: 48, r: 15 }];
  return (
    <motion.div
      aria-hidden
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1.2, delay: 0.6 }}
      className="ep-hero-floral"
      style={{
        width: 'clamp(64px, 8vw, 128px)', flexShrink: 0,
        transform: mirror ? 'scaleX(-1)' : 'none',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <motion.svg
        viewBox="0 0 100 260" width="100%" style={{ transformOrigin: 'bottom center', overflow: 'visible' }}
        animate={{ rotate: [-2.5, 2.5, -2.5], y: [0, -10, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
      >
        <path d="M50 260 C46 200 54 150 48 100 C45 70 55 40 50 10" fill="none" stroke={color} strokeWidth="2" opacity="0.5" />
        <path d="M48 190 Q20 185 12 160 Q34 162 48 190Z" fill={color} opacity="0.32" />
        <path d="M50 140 Q80 133 90 108 Q66 112 50 140Z" fill={color} opacity="0.28" />
        <path d="M49 80 Q26 76 20 55 Q40 58 49 80Z" fill={color} opacity="0.24" />
        {blooms.map((bloom, i) => (
          <g key={i}>
            {[0, 51, 102, 153, 204, 255, 306].map(angle => (
              <ellipse key={angle} cx={bloom.cx} cy={bloom.cy} rx={bloom.r * 0.55} ry={bloom.r * 0.32}
                fill={color} opacity={0.2 + i * 0.06}
                transform={`rotate(${angle} ${bloom.cx} ${bloom.cy})`} />
            ))}
            <circle cx={bloom.cx} cy={bloom.cy} r={bloom.r * 0.28} fill={color} opacity={0.55} />
          </g>
        ))}
      </motion.svg>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════════ */

export default function EventPageClient({
  initialEvent,
  slug: serverSlug,
  // Per-guest invitation token. Unlocks private events and lets the RSVP form
  // pre-fill. Passed down from the server component (page.js) rather than read
  // here with useSearchParams(): a client component reading search params inside
  // a Suspense boundary makes Next bail that subtree out of prerendering, so the
  // HTML shipped to guests was the spinner fallback and nothing else — the whole
  // invitation then depended on a large bundle hydrating before anything appeared.
  invitationPartyId = null,
  invitationGuestId = null,
  // ?noreveal=1 — the compliance/reviewer bypass (Twilio TFV) that skips the
  // envelope. Resolved on the server for the same reason as the tokens above.
  noReveal = false,
}) {
  const invitationRsvpId = invitationPartyId;
  // Reading localStorage must be deferred to after hydration (#418): on the
  // server, rememberedId() returns null (no window), but on the client it may
  // return a stored UUID — producing different HTML trees if read up front.
  // useIsClient's server/client snapshot split gives us that gate directly,
  // so the remembered id can be a plain derived read instead of its own
  // effect + state.
  const isClient = useIsClient();
  const deviceRememberedId = isClient ? rememberedId(serverSlug) : null;
  const effectiveRsvpId = invitationRsvpId || invitationGuestId || deviceRememberedId;

  const [slug, setSlug] = useState(serverSlug || '');
  const isDemoSlug = DEMO_SLUGS.has(slug);
  const [event, setEvent] = useState(() => initialEvent || (isDemoSlug ? getDemoEventData(slug) : null));
  const [guestRsvp, setGuestRsvp] = useState(null);
  const [loading, setLoading] = useState(() => !initialEvent && !isDemoSlug);
  const [error, setError] = useState(null);
  const [timeLeft, setTimeLeft] = useState({});
  const [lang, setLang] = useState('en');

  const isWedding = event?.template_type === 'wedding' || WEDDING_VARIANT_TEMPLATES.includes(event?.template_type);
  const isRomantic = isWedding || event?.template_type === 'engagement' || event?.template_type === 'ring';
  const customColors = event?.custom_colors || {};
  const themeColor = customColors.primary || (isWedding ? '#B8944F' : '#191B1E');


  // NOTE: there used to be a runtime <link> injection here pulling Great Vibes and
  // Playfair Display from fonts.googleapis.com. Both are already loaded — SELF-HOSTED
  // — by next/font in layout.js (--font-script and --font-playfair), so it was pure
  // duplication, and it made the invitation route the only page on the site that
  // needs a third-party host at render time. fonts.googleapis.com is blackholed in
  // several countries and by many corporate proxies; a blackholed host doesn't reset,
  // it hangs, and a stylesheet appended to <head> blocks rendering while pending —
  // so the invitation froze for exactly those guests while the marketing site (pure
  // next/font) loaded fine for them.

  // Sync HTML lang attribute with active language choice to support correct glyph-shaping/fonts
  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }, [lang]);

  // Analytics
  const { trackEvent } = useGuestAnalytics(slug);

  // Gallery lightbox
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [cardLightboxOpen, setCardLightboxOpen] = useState(false);

  // Floating CTA visibility
  const heroRef = useRef(null);
  const rsvpCardRef = useRef(null);
  const heroInView = useInView(heroRef, { amount: 0.1 });
  const rsvpCardInView = useInView(rsvpCardRef, { amount: 0.3 });
  // Fully determined by the two inView flags above — no independent state or
  // effect needed, just compute it each render.
  const showFloatingCTA = !heroInView && !rsvpCardInView;
  const [downloading, setDownloading] = useState(false);

  // Guest-experience chrome for the legacy continuous-scroll templates
  // (scroll-progress bar, side nav dots, post-reveal scroll hint) — the
  // HeritageArch family gets the equivalent of these from SnapShell instead.
  const [legacyScrollProgress, setLegacyScrollProgress] = useState(0);
  const [legacyActiveSectionId, setLegacyActiveSectionId] = useState('');
  // Whether the guest has scrolled (or 5s elapsed) since the reveal closed —
  // visibility itself is derived further below (once revealDismissed exists)
  // rather than stored, so showing the hint the instant revealDismissed
  // flips doesn't need a setState-in-effect.
  const [legacyHintDismissed, setLegacyHintDismissed] = useState(false);

  const handleDownloadCard = useCallback(async () => {
    setDownloading(true);
    try {
      const { toPng } = await import('html-to-image');
      const node = document.getElementById('invitation-card-capture');
      if (!node) throw new Error('Card element not found');

      // Wait a tiny moment to ensure fonts are fully layout-rendered
      await new Promise(r => setTimeout(r, 100));

      const dataUrl = await toPng(node, {
        quality: 0.98,
        pixelRatio: 2.5,
        style: {
          transform: 'scale(1)',
          borderRadius: '0px',
        },
        cacheBust: true,
      });

      const link = document.createElement('a');
      link.download = `${event?.title || 'invitation'}.png`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error('Failed to download invitation card:', error);
    } finally {
      setDownloading(false);
    }
  }, [event]);

  // Background music — the organizer's uploaded track, OR a pasted YouTube
  // link (played through a hidden IFrame Player instead of an <audio> tag).
  // Starts as soon as the page loads (not gated behind the envelope seal tap)
  // so it's playing from the very first moment of the guest experience.
  // Some mobile browsers still block unmuted autoplay without a prior user
  // gesture; in that case the first tap anywhere (seal, toggle) starts it.
  const musicRef = useRef(null);
  const [musicPlaying, setMusicPlaying] = useState(false);
  // Distinguishes a guest's own deliberate pause (tapping the toggle) from
  // any OTHER pause — the browser interrupting playback mid-scroll (a real,
  // observed WebKit/Chromium behavior: media elements can get silently
  // suspended during heavy scroll/compositing work), a YouTube buffering
  // hiccup, etc. Only the deliberate case should stay paused; everything
  // else self-heals below instead of leaving the guest with dead audio
  // until they happen to scroll back up into a fresh touch gesture.
  const userPausedRef = useRef(false);
  const toggleMusic = useCallback(() => {
    const el = musicRef.current;
    if (!el) return;
    if (el.paused) {
      userPausedRef.current = false;
      el.play().catch((err) => console.error('Background music playback failed:', err));
    } else {
      userPausedRef.current = true;
      el.pause();
    }
  }, []);
  // Self-heal: whenever playback stops for any reason OTHER than the guest's
  // own tap, immediately retry. Safe to call unconditionally — a browser that
  // is genuinely still blocking autoplay just no-ops here the same way the
  // gesture-retry effect below does.
  const resumeIfNotUserPaused = useCallback(() => {
    if (userPausedRef.current) return;
    const el = musicRef.current;
    if (el?.paused) el.play().catch(() => { /* still blocked — next gesture retries */ });
  }, []);

  // ── YouTube-backed music: wraps the IFrame Player API in the same
  //    { paused, play(), pause() } shape as an <audio> element, so the
  //    envelope-reveal tap and the toggle button above don't need to care
  //    which backend is actually playing. ──
  const ytPlayerElRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const youtubeMusicId = extractYouTubeId(event?.background_music_url);

  // Direct-audio-file autoplay attempt, fired as soon as the <audio> element
  // (and its src) exist. Browsers that block it will just no-op here; the
  // seal tap / toggle button below still retry on the guest's first gesture.
  useEffect(() => {
    if (!event?.background_music_url || youtubeMusicId) return;
    const el = musicRef.current;
    if (el?.paused) el.play().catch(() => { /* autoplay blocked — retried on first user gesture */ });
  }, [event?.background_music_url, youtubeMusicId]);

  // The "retried on first user gesture" comment above only actually held for
  // templates with the envelope-reveal tap (InvitationReveal calls
  // musicRef.current.play() on click). Heritage Arch deliberately skips that
  // reveal and opens straight into the sections, so it had NO gesture that
  // ever retried a blocked autoplay — a guest who didn't happen to notice
  // and tap the small corner music toggle simply never heard any music.
  // This listens for the guest's actual first interaction with the page —
  // tap/click, key press, mouse-wheel scroll, or touch-scroll — and retries
  // then, same as the envelope tap does elsewhere; it detaches itself as
  // soon as playback is confirmed (and re-attaches automatically if
  // `musicPlaying` ever flips back to false, e.g. after a browser-forced
  // interruption resumeIfNotUserPaused couldn't recover from immediately).
  useEffect(() => {
    if (!event?.background_music_url || musicPlaying) return undefined;
    document.addEventListener('pointerdown', resumeIfNotUserPaused, { passive: true });
    document.addEventListener('keydown', resumeIfNotUserPaused);
    document.addEventListener('wheel', resumeIfNotUserPaused, { passive: true });
    document.addEventListener('scroll', resumeIfNotUserPaused, { passive: true, capture: true });
    document.addEventListener('touchmove', resumeIfNotUserPaused, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', resumeIfNotUserPaused);
      document.removeEventListener('keydown', resumeIfNotUserPaused);
      document.removeEventListener('wheel', resumeIfNotUserPaused);
      document.removeEventListener('scroll', resumeIfNotUserPaused, { capture: true });
      document.removeEventListener('touchmove', resumeIfNotUserPaused);
    };
  }, [event?.background_music_url, musicPlaying, resumeIfNotUserPaused]);

  // Set when the IFrame Player reports this exact video can't be embedded
  // (error 101/150 — a very common restriction on official/label music
  // videos) or is missing/private (error 100). Hides the music toggle so
  // guests never see a "play music" control that silently does nothing —
  // previously there was no onError handler at all, so this failed silently.
  const [youtubeMusicBlocked, setYoutubeMusicBlocked] = useState(false);

  useEffect(() => {
    if (!youtubeMusicId) return undefined;
    let cancelled = false;
    // Re-arm for this new video id — a previous id's block state shouldn't
    // stick around once the organizer swaps in a different link.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setYoutubeMusicBlocked(false);

    const createPlayer = () => {
      if (cancelled || !ytPlayerElRef.current) return;
      const player = new window.YT.Player(ytPlayerElRef.current, {
        videoId: youtubeMusicId,
        playerVars: { autoplay: 0, controls: 0, loop: 1, playlist: youtubeMusicId },
        events: {
          onReady: () => {
            ytPlayerRef.current = player;
            musicRef.current = {
              get paused() { return player.getPlayerState?.() !== 1; },
              play: () => { player.playVideo(); return Promise.resolve(); },
              pause: () => player.pauseVideo(),
            };
            // Attempt autoplay as soon as the player is ready — same best-effort,
            // gesture-independent start as the direct-audio-file path below.
            player.playVideo();
          },
          onStateChange: (e) => {
            setMusicPlaying(e.data === 1);
            // States 0 (ended) and 2 (paused) firing on their own — never
            // requested via toggleMusic — mean the IFrame player got
            // interrupted (buffering hiccup, scroll-triggered compositor
            // suspension, etc). `loop`/`playlist` should replay on `ended`
            // by themselves, but resuming here too costs nothing and covers
            // players that don't honor it.
            if ((e.data === 0 || e.data === 2) && !userPausedRef.current) {
              player.playVideo();
            }
          },
          onError: () => {
            if (cancelled) return;
            setYoutubeMusicBlocked(true);
            musicRef.current = null;
          },
        },
      });
    };

    // Defer the third-party script fetch until the browser is idle (Safari
    // lacks requestIdleCallback, hence the setTimeout fallback), so it
    // doesn't compete with the critical landing-page first paint.
    const startLoading = () => { if (!cancelled) loadYouTubeIframeApi().then(createPlayer); };
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(startLoading, { timeout: 2000 });
    } else {
      setTimeout(startLoading, 200);
    }

    return () => {
      cancelled = true;
      try { ytPlayerRef.current?.destroy?.(); } catch { /* already torn down */ }
      musicRef.current = null;
    };
  }, [youtubeMusicId]);

  // (The dress-code accordion state that used to live here is gone with the
  // accordion — see the Dress Code card below for why it never did anything.)

  // Photos & Location — collapsed by default to keep the page short;
  // expands in place rather than being two more always-visible scroll-stops.
  const [moreDetailsExpanded, setMoreDetailsExpanded] = useState(false);

  // Premium envelope reveal — plays every single time this page loads (same
  // animation regardless of channel: email link, raw URL, or QR scan, and
  // regardless of any prior visit). Tracks only whether *this* mount's
  // viewing has been dismissed; a fresh page load always starts undismissed.
  // Sole exception: ?noreveal=1, a compliance/reviewer bypass (Twilio TFV)
  // that renders the page content directly. Normal guest links never carry it.
  const [revealDismissed, setRevealDismissed] = useState(() => noReveal);
  // Derived, not stored: visible once the reveal closes, until the guest
  // scrolls or 5s pass (legacyHintDismissed, set by the effect further down).
  const legacyShowScrollHint = revealDismissed && !legacyHintDismissed && !!event && !FULL_PAGE_TEMPLATES.has(event.template_type);
  // Mirrors `revealDismissed` into a ref so the background "freshness" refetch
  // below (which always re-runs on mount even when SSR already supplied
  // `initialEvent`) can check it synchronously. Without this, a guest who
  // opens the envelope before that refetch resolves would see the
  // already-opened invitation silently change — new event/RSVP data landing
  // and re-rendering the card out from under them — which is exactly the
  // "no reset after opening" bug: the fetch itself is harmless, only
  // *applying* its result after the guest has already seen the invitation is.
  const revealDismissedRef = useRef(revealDismissed);
  useEffect(() => { revealDismissedRef.current = revealDismissed; }, [revealDismissed]);

  // Auth / access states. Declared here — BEFORE the effects below that read them —
  // so their dependency arrays don't reference these bindings while they're still in
  // the temporal dead zone. A forward reference compiles fine in `next dev` but
  // crashes the minified production build ("Cannot access '…' before initialization").
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [underReview, setUnderReview] = useState(false);
  // Paid gate not yet satisfied (event still a draft / awaiting payment). Distinct
  // from "not found" so the organizer sees an accurate message, not a 404 screen.
  const [notLive, setNotLive] = useState(false);
  const fetchEventWithPasswordRef = useRef(null);

  // Plays over the fully-loaded public event page only — never over the
  // loading/password/private/review/error states, and never when the
  // organizer has switched the envelope off (events.reveal_enabled). The
  // `!== false` test rather than a truthy one is deliberate: an older cached
  // payload with no such field must keep playing the reveal, not lose it.
  // The ?noreveal=1 compliance bypass starts already-dismissed.
  const revealEnabled = !!event && event.reveal_enabled !== false;
  const showReveal = revealEnabled && !loading && !error && !passwordRequired && !isPrivate && !underReview && !notLive && !revealDismissed;

  // Whether a return visit sees the envelope again. Passing a sessionKey is
  // what gives InvitationReveal its per-session memory, so "replay every
  // visit" is expressed by withholding one. Default (reveal_replay true, and
  // any payload predating the column) keeps the long-standing behaviour of
  // this page: every load is an arrival.
  const revealSessionKey = event && event.reveal_replay === false ? slug : null;

  const handleRevealComplete = useCallback(() => {
    setRevealDismissed(true);
  }, []);

  // Legacy continuous-scroll chrome: scroll-progress bar + side nav dots,
  // tracked off window/document since this page (unlike HeritageArch's
  // SnapShell) scrolls natively rather than inside its own container.
  // No-ops once the event is known to be a FULL_PAGE_TEMPLATES type, since
  // that render path owns its own equivalent chrome inside SnapShell.
  useEffect(() => {
    if (!event || FULL_PAGE_TEMPLATES.has(event.template_type)) return undefined;
    let ticking = false;
    const updateProgress = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      setLegacyScrollProgress(scrollable > 0 ? (doc.scrollTop / scrollable) * 100 : 0);
      ticking = false;
    };
    const onScroll = () => {
      if (!ticking) { ticking = true; requestAnimationFrame(updateProgress); }
      setLegacyHintDismissed(true);
    };
    updateProgress();
    window.addEventListener('scroll', onScroll, { passive: true });

    const ids = ['lg-hero', 'lg-cover-photo', 'lg-details', 'lg-more-details', 'rsvp-section'];
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean);
    const observer = 'IntersectionObserver' in window
      ? new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting && entry.intersectionRatio > 0.3) {
              setLegacyActiveSectionId(entry.target.id);
            }
          });
        }, { threshold: [0.3] })
      : null;
    els.forEach((el) => observer?.observe(el));

    return () => {
      window.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
  }, [event?.template_type, event?.cover_image_url]);

  // Generic post-reveal "scroll down" nudge — fades in once the envelope is
  // dismissed, fades out on the guest's first scroll or after 5s, matching
  // the reference invitation's scroll hint (this page had no equivalent
  // before; HeritageArch's SnapShell has its own RSVP-focused version).
  useEffect(() => {
    if (!event || FULL_PAGE_TEMPLATES.has(event.template_type) || !revealDismissed || legacyHintDismissed) return undefined;
    const timeout = setTimeout(() => setLegacyHintDismissed(true), 5000);
    return () => clearTimeout(timeout);
  }, [revealDismissed, legacyHintDismissed, event?.template_type]);

  /* ─── Data Fetching ─── */
  const fetchEvent = useCallback(async (password) => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
      const headers = {};
      if (password) headers['x-event-password'] = password;
      // Forward the invitation/guest token (or the device-remembered id) so the
      // backend can unlock a private event and return this guest's existing RSVP.
      const query = effectiveRsvpId ? `?party_id=${encodeURIComponent(effectiveRsvpId)}` : '';
      // Bound the request. Without a signal a stalled connection just hangs — nginx
      // gives upstreams 120s — and `loading` only clears in the finally, so a guest
      // on a flaky mobile link stared at the skeleton for two minutes and then got
      // "Event Not Found". 12s is well past a slow-3G round trip and well short of
      // the point where a guest gives up and closes the tab.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);
      let res;
      try {
        res = await fetch(`${apiUrl}/public/events/${slug}${query}`, { headers, signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 402) { setNotLive(true); setLoading(false); return; }
        if (res.status === 401 && data.requiresPassword) {
          setPasswordRequired(true);
          // Only a genuinely wrong password (one was actually submitted this
          // attempt) should show the "Incorrect password" message — the
          // initial page load also hits this branch with no password sent
          // yet, and that's just "prompt for password", not an error.
          if (password) setError('WRONG_PASSWORD');
          setLoading(false);
          return;
        }
        if (res.status === 403 && data.error === 'EVENT_UNDER_REVIEW') { setUnderReview(true); setLoading(false); return; }
        if (res.status === 403 && data.error === 'EVENT_PRIVATE') { setIsPrivate(true); setLoading(false); return; }
        // INV-1: a paused/completed ("closed") event — distinct from not-found.
        if (res.status === 403 && data.error === 'EVENT_CLOSED') { setError('EVENT_CLOSED'); setLoading(false); return; }
        // A throttle or a server hiccup is NOT a missing event. Collapsing 429/5xx
        // into EVENT_NOT_FOUND told guests their invitation link was dead — with no
        // retry and nothing in the console — which is exactly how a transient
        // rate-limit reads to a customer as "the link doesn't work".
        if (res.status === 429 || res.status >= 500) throw new Error('TEMPORARILY_UNAVAILABLE');
        throw new Error('EVENT_NOT_FOUND');
      }
      const data = await res.json();
      // Once the guest has already opened the envelope and seen the
      // invitation, a background refresh landing late must not silently
      // change what's on screen (see revealDismissedRef above). Skipping the
      // two content-bearing setters here still lets this same call clear the
      // auth/gate states below — those can't be true once the reveal has
      // already shown (showReveal requires all of them false), so it's a
      // no-op in that case, not a behavior change.
      if (!revealDismissedRef.current) {
        setEvent(data.event);
        setGuestRsvp(data.guestRsvp || null);
      }
      setPasswordRequired(false);
      setIsPrivate(false);
      setNotLive(false);
    } catch (err) {
      // A timeout/abort is a transient network condition, not a missing event —
      // route it to the retryable state rather than the dead-link screen.
      setError(err.name === 'AbortError' ? 'TEMPORARILY_UNAVAILABLE' : err.message);
    } finally { setLoading(false); }
  }, [slug, effectiveRsvpId]);

  useEffect(() => {
    fetchEventWithPasswordRef.current = (pw) => { setLoading(true); setError(null); fetchEvent(pw); };
  }, [fetchEvent]);

  useEffect(() => {
    // The demo event is set via lazy initial state above — nothing to fetch.
    if (isDemoSlug) return;
    if (!slug) return;
    // `initialEvent` is the guest-agnostic SSR snapshot (backend payload cached up
    // to 60s, see page.js). It is used as the instant first paint, and it is now
    // also ENOUGH on its own for a plain public link: refetching it unconditionally
    // doubled every guest's request cost against the public rate limit for data we
    // already had, and each open also fires an analytics beacon on the same budget.
    //
    // We still go to the network when the snapshot genuinely can't answer:
    //   • no snapshot at all (SSR fetch failed, or a demo/uncached path), or
    //   • a per-guest token is present — `guestRsvp` is deliberately NOT part of the
    //     shared cached payload, so the prefill/lock state only exists client-side.
    // fetchEvent stays a shared useCallback because the password-retry form calls it
    // imperatively. The IIFE keeps state updates inside a nested async callback
    // rather than in the effect body itself (see useRsvpResolver.js for the pattern).
    // The early-out lives INSIDE the IIFE for the same reason the fetch does:
    // out here it is a setState in the effect body, which is what the comment
    // above says this pattern exists to avoid (and what lint flags as an
    // error). Behaviour is unchanged — the branch still just skips the fetch.
    (async () => {
      if (initialEvent && !effectiveRsvpId) { setLoading(false); return; }
      await fetchEvent();
    })();
  }, [slug, isDemoSlug, fetchEvent, initialEvent, effectiveRsvpId]);

  /* ─── Countdown ─── */
  // Depends on the DATE, not the whole `event` object: keying this on `event` meant
  // every refetch handed back a new object identity and tore down/rebuilt the
  // interval for no reason. It also now stops itself once the date passes instead
  // of running a setState every second forever on a page that never goes idle
  // (which, alongside the infinite decorative animations, is what makes low-end
  // phones and in-app browsers evict the tab mid-load).
  useEffect(() => {
    const target = event?.event_date ? +new Date(event.event_date) : null;
    if (!target || Number.isNaN(target)) return undefined;
    let timer;
    const tick = () => {
      const difference = target - Date.now();
      if (difference <= 0) { setTimeLeft({}); clearInterval(timer); return; }
      setTimeLeft({
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((difference / 1000 / 60) % 60),
        seconds: Math.floor((difference / 1000) % 60),
      });
    };
    tick();
    timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [event?.event_date]);

  /* ─── Document meta & fonts ─── */
  useEffect(() => {
    if (event) {
      // This OVERWRITES the server-rendered <title> on hydration, so a
      // white-label event that arrived correctly branded would get "| Fancy
      // RSVP" put back into the tab a moment after it loaded. Both halves have
      // to agree or the fix is only visible with JavaScript disabled.
      document.title = guestTitle(event);
      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc) { metaDesc.setAttribute('content', event.description || `RSVP to ${event.title}`); }
      else { const meta = document.createElement('meta'); meta.name = 'description'; meta.content = event.description || `RSVP to ${event.title}`; document.head.appendChild(meta); }

      if (event.custom_fonts) {
        const headingFont = sanitizeFontName(event.custom_fonts.heading) || 'Playfair Display';
        const bodyFont = sanitizeFontName(event.custom_fonts.body) || 'Inter';
        [headingFont, bodyFont].forEach(fontName => {
          const id = `font-link-${fontName.replace(/ /g, '-').toLowerCase()}`;
          if (!document.getElementById(id)) {
            const link = document.createElement('link');
            link.id = id;
            link.rel = 'stylesheet';
            link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(/ /g, '+')}&display=swap`;
            // Organizer-chosen faces are genuinely dynamic, so this one third-party
            // request has to stay. It must NOT be render-blocking though: load it as
            // a print stylesheet (browsers fetch those without blocking paint) and
            // promote it to `all` once it lands. Where fonts.googleapis.com is
            // unreachable it now simply never applies instead of freezing the page.
            link.media = 'print';
            link.onload = () => { link.media = 'all'; };
            document.head.appendChild(link);
          }
        });
      }
    }
  }, [event]);

  // Track page view once event loads
  useEffect(() => {
    if (event && !loading && !error) {
      trackEvent('page_view', { template: event.template_type });
    }
  }, [event, loading, error, trackEvent]);

  /* ═══════════════════════════════════════════════════════════════
     STATUS SCREENS
     ═══════════════════════════════════════════════════════════════ */

  // ─── LOADING ───
  if (loading) {
    return (
      <PageTransition>
        <div style={{ minHeight: '100dvh', background: '#F8F4EC', fontFamily: 'var(--font-sans)' }}>
          {/* Hero shimmer */}
          <ShimmerPlaceholder width="100%" height="70vh" borderRadius="0" />
          {/* Content shimmers */}
          <div style={{ maxWidth: '960px', margin: '0 auto', padding: '48px 24px', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '48px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <ShimmerPlaceholder width="100%" height="220px" borderRadius="20px" />
              <ShimmerPlaceholder width="100%" height="120px" borderRadius="20px" />
              <ShimmerPlaceholder width="60%" height="24px" />
              <ShimmerPlaceholder width="90%" height="16px" />
              <ShimmerPlaceholder width="75%" height="16px" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <ShimmerPlaceholder width="100%" height="240px" borderRadius="20px" />
              <ShimmerPlaceholder width="100%" height="200px" borderRadius="20px" />
            </div>
          </div>
        </div>
        <style>{`
          @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
          @media (max-width: 768px) {
            div[style*="grid-template-columns: 2fr 1fr"] { grid-template-columns: 1fr !important; }
          }
        `}</style>
      </PageTransition>
    );
  }

  // ─── PAYMENT REQUIRED ───
  if (error === 'PAYMENT_REQUIRED') {
    return (
      <PageTransition>
        <div style={{ minHeight: '100dvh', background: '#F8F4EC', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: 'var(--font-sans)' }}>
          <ScaleIn>
            <GlassmorphismCard bg="rgba(255,255,255,0.92)" style={{ maxWidth: '440px', width: '100%', textAlign: 'center', padding: '48px 32px' }}>
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 12, delay: 0.2 }} style={{ display: 'flex', justifyContent: 'center' }}><Icon name="creditCard" size={48} color="#B8944F" strokeWidth={1.3} /></motion.div>
              <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '24px', fontWeight: 600, color: '#B8944F', marginTop: '12px' }}>Event Unpaid</h1>
              <p style={{ color: '#77736A', marginTop: '12px', fontSize: '14px', lineHeight: 1.7, fontWeight: 300 }}>This Fancy RSVP event page is currently offline pending license activation.</p>
            </GlassmorphismCard>
          </ScaleIn>
        </div>
      </PageTransition>
    );
  }

  // ─── EVENT CLOSED (paused / completed) ───
  if (error === 'EVENT_CLOSED') {
    return (
      <PageTransition>
        <div style={{ minHeight: '100dvh', background: '#F8F4EC', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: 'var(--font-sans)' }}>
          <ScaleIn>
            <GlassmorphismCard bg="rgba(255,255,255,0.92)" style={{ maxWidth: '440px', width: '100%', textAlign: 'center', padding: '48px 32px' }}>
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 12, delay: 0.2 }} style={{ display: 'flex', justifyContent: 'center' }}><Icon name="dove" size={48} color="#B8944F" strokeWidth={1.3} /></motion.div>
              <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '24px', fontWeight: 600, color: '#B8944F', marginTop: '12px' }}>This Event Has Closed</h1>
              <p style={{ color: '#77736A', marginTop: '12px', fontSize: '14px', lineHeight: 1.7, fontWeight: 300 }}>RSVPs for this event are no longer being accepted. Please reach out to the host directly with any questions.</p>
            </GlassmorphismCard>
          </ScaleIn>
        </div>
      </PageTransition>
    );
  }

  // ─── UNDER REVIEW ───
  if (underReview) {
    return (
      <PageTransition>
        <div style={{ minHeight: '100dvh', background: '#F8F4EC', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: 'var(--font-sans)' }}>
          <ScaleIn>
            <GlassmorphismCard bg="rgba(255,255,255,0.92)" style={{ maxWidth: '440px', width: '100%', textAlign: 'center', padding: '48px 32px' }}>
              <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 12, delay: 0.2 }} style={{ display: 'flex', justifyContent: 'center' }}><Icon name="sparkle" size={44} color="#B8944F" strokeWidth={1.3} /></motion.div>
              <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '24px', fontWeight: 600, color: '#B8944F', marginTop: '12px' }}>Almost Ready</h1>
              <p style={{ color: '#77736A', marginTop: '12px', fontSize: '14px', lineHeight: 1.7, fontWeight: 300 }}>
                This invitation is being given its final touches and will be live very soon. Please check back shortly.
              </p>
            </GlassmorphismCard>
          </ScaleIn>
        </div>
      </PageTransition>
    );
  }

  // ─── PRIVATE ───
  if (isPrivate) {
    return (
      <PageTransition>
        <div style={{ minHeight: '100dvh', background: '#F8F4EC', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: 'var(--font-sans)' }}>
          <ScaleIn>
            <GlassmorphismCard bg="rgba(255,255,255,0.92)" style={{ maxWidth: '440px', width: '100%', textAlign: 'center', padding: '48px 32px' }}>
              <div style={{ width: '64px', height: '64px', margin: '0 auto 16px', borderRadius: '50%', background: '#F8F4EC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: 0.2 }}><Icon name="lock" size={30} color="#B8944F" strokeWidth={1.4} /></motion.div>
              </div>
              <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '24px', fontWeight: 600, color: '#191B1E' }}>Private Event</h1>
              <p style={{ color: '#77736A', marginTop: '12px', fontSize: '14px', lineHeight: 1.7, fontWeight: 300 }}>This event is private and can only be accessed through a direct invitation link from the host.</p>
              <Link href="/" style={{ display: 'inline-block', marginTop: '24px', padding: '12px 28px', background: '#B8944F', color: '#FFFFFF', borderRadius: '12px', textDecoration: 'none', fontWeight: 700, fontSize: '14px' }}>Go to Homepage</Link>
            </GlassmorphismCard>
          </ScaleIn>
        </div>
      </PageTransition>
    );
  }

  // ─── PASSWORD ───
  if (passwordRequired) {
    return (
      <PageTransition>
        <div style={{ minHeight: '100dvh', background: '#F8F4EC', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: 'var(--font-sans)' }}>
          <ScaleIn>
            <GlassmorphismCard bg="rgba(255,255,255,0.92)" style={{ maxWidth: '440px', width: '100%', textAlign: 'center', padding: '48px 32px' }}>
              <div style={{ width: '64px', height: '64px', margin: '0 auto 16px', borderRadius: '50%', background: 'rgba(184,148,79,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: 0.15 }}><Icon name="lockKey" size={30} color="#B8944F" strokeWidth={1.4} /></motion.div>
              </div>
              <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '24px', fontWeight: 600, color: '#191B1E' }}>Password Protected</h1>
              <p style={{ color: '#77736A', marginTop: '12px', marginBottom: '24px', fontSize: '14px', lineHeight: 1.7, fontWeight: 300 }}>This event requires a password to access. Please enter the password provided by the host.</p>
              <form onSubmit={(e) => { e.preventDefault(); if (passwordInput.trim() && fetchEventWithPasswordRef.current) fetchEventWithPasswordRef.current(passwordInput.trim()); }} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <input type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} placeholder="Enter event password" autoFocus
                  style={{ ...inputStyle, textAlign: 'center', letterSpacing: '4px' }}
                  onFocus={inputFocus} onBlur={(e) => inputBlur(e)} />
                <PremiumButton variant="gold" fullWidth onClick={() => { if (passwordInput.trim() && fetchEventWithPasswordRef.current) fetchEventWithPasswordRef.current(passwordInput.trim()); }}>
                  Access Event
                </PremiumButton>
              </form>
              {/* Only a genuinely rejected password says "incorrect" — a throttled
                  or timed-out retry sets TEMPORARILY_UNAVAILABLE and must not
                  accuse the guest of typing the wrong password. */}
              {error === 'WRONG_PASSWORD' && <p style={{ color: '#C45E5E', fontSize: '13px', marginTop: '12px' }}>Incorrect password. Please try again.</p>}
              {error === 'TEMPORARILY_UNAVAILABLE' && <p style={{ color: '#77736A', fontSize: '13px', marginTop: '12px' }}>We couldn’t reach the server. Please try again in a few seconds.</p>}
            </GlassmorphismCard>
          </ScaleIn>
        </div>
      </PageTransition>
    );
  }

  // ─── NOT LIVE YET (paid gate not satisfied) ───
  if (notLive) {
    return (
      <PageTransition>
        <div style={{ minHeight: '100dvh', background: '#F8F4EC', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: 'var(--font-sans)' }}>
          <ScaleIn>
            <GlassmorphismCard bg="rgba(255,255,255,0.92)" style={{ maxWidth: '440px', width: '100%', textAlign: 'center', padding: '48px 32px' }}>
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: 0.15 }} style={{ display: 'flex', justifyContent: 'center' }}><Icon name="hourglass" size={44} color="#B8944F" strokeWidth={1.3} /></motion.div>
              <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '24px', fontWeight: 600, color: '#191B1E', marginTop: '12px' }}>Not Live Yet</h1>
              <p style={{ color: '#77736A', marginTop: '12px', fontSize: '14px', lineHeight: 1.7, fontWeight: 300 }}>
                This event isn’t active yet. If you’re the host, please complete the platform fee — your event goes live once payment is confirmed.
              </p>
              <Link href="/" style={{ display: 'inline-block', marginTop: '24px', padding: '12px 28px', background: '#B8944F', color: '#FFFFFF', borderRadius: '12px', textDecoration: 'none', fontWeight: 700, fontSize: '14px' }}>Go to Homepage</Link>
            </GlassmorphismCard>
          </ScaleIn>
        </div>
      </PageTransition>
    );
  }

  // ─── TEMPORARILY UNAVAILABLE (throttled / server hiccup / timed out) ───
  // Distinct from "not found" on purpose. This state is recoverable and usually
  // clears within seconds, so it offers a retry instead of telling a guest their
  // invitation is dead — which is what a 429 used to render as.
  if (error === 'TEMPORARILY_UNAVAILABLE') {
    return (
      <PageTransition>
        <div style={{ minHeight: '100dvh', background: '#F8F4EC', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: 'var(--font-sans)' }}>
          <ScaleIn>
            <GlassmorphismCard bg="rgba(255,255,255,0.92)" style={{ maxWidth: '440px', width: '100%', textAlign: 'center', padding: '48px 32px' }}>
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 12, delay: 0.2 }} style={{ display: 'flex', justifyContent: 'center' }}>
                <Icon name="hourglass" size={44} color="#B8944F" strokeWidth={1.3} />
              </motion.div>
              <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '24px', fontWeight: 600, color: '#191B1E', marginTop: '12px' }}>Just a moment</h1>
              <p style={{ color: '#77736A', marginTop: '12px', fontSize: '14px', lineHeight: 1.7, fontWeight: 300 }}>
                We couldn’t load this invitation right now. Your link is fine — please try again in a few seconds.
              </p>
              <div style={{ marginTop: '24px' }}>
                <PremiumButton variant="gold" onClick={() => { setError(null); setLoading(true); fetchEvent(); }}>
                  Try Again
                </PremiumButton>
              </div>
            </GlassmorphismCard>
          </ScaleIn>
        </div>
      </PageTransition>
    );
  }

  // ─── NOT FOUND ───
  if (error || !event) {
    return (
      <PageTransition>
        <div style={{ minHeight: '100dvh', background: '#F8F4EC', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: 'var(--font-sans)' }}>
          <ScaleIn>
            <div style={{ maxWidth: '440px', width: '100%', textAlign: 'center' }}>
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: 0.1 }} style={{ display: 'flex', justifyContent: 'center' }}><Icon name="search" size={52} color="#B8944F" strokeWidth={1.2} /></motion.div>
              <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '28px', fontWeight: 600, color: '#191B1E', marginTop: '12px' }}>Event Not Found</h1>
              <p style={{ color: '#77736A', marginTop: '12px', fontSize: '14px', lineHeight: 1.7, fontWeight: 300 }}>The event link you clicked seems to be incorrect or has been archived by the host.</p>
              <Link href="/" style={{ display: 'inline-block', marginTop: '24px', padding: '12px 28px', background: '#B8944F', color: '#FFFFFF', borderRadius: '12px', textDecoration: 'none', fontWeight: 700, fontSize: '14px' }}>Go to Homepage</Link>
            </div>
          </ScaleIn>
        </div>
      </PageTransition>
    );
  }

  /* ═══════════════════════════════════════════════════════════════
     MAIN EVENT PAGE
     ═══════════════════════════════════════════════════════════════ */


  const isRTL = lang === 'ar';
  const t = translations[lang];
  // Arabic translations: the DB has no dedicated title_ar / description_ar columns.
  // Organizers store Arabic overrides inside the template_data JSON object, or
  // as top-level event fields if they were injected (e.g. demo data). Check both.
  const td = event.template_data || {};
  const titleAr = event.title_ar || td.title_ar || null;
  const descAr  = event.description_ar || td.description_ar || null;
  const dressAr = event.dress_code_ar || td.dress_code_ar || null;
  const localizedTitle = isRTL && titleAr ? titleAr : event.title;
  const localizedDesc = isRTL && descAr ? descAr : event.description;
  const isContentLTR = !(/[\u0600-\u06FF]/.test(localizedTitle || ''));
  const localizedDressCode = isRTL && dressAr ? dressAr : event.dress_code;
  const eventPassed = isClient && event.event_date && new Date(event.event_date) < new Date();

  // Digital invitation card — same artwork the organizer previewed in
  // Stage1_TemplatesSimulator, now rendered with this event's real data.
  const invitationPattern = INVITATION_PATTERN_BY_TEMPLATE[event.template_type] || 'serif';
  const invitationGuestName = guestRsvp?.guest_name || (isRTL ? 'ضيفنا الكريم' : 'Esteemed Guest');
  const invitationTheme = { primary: themeColor, secondary: customColors.secondary || '#D7BE80' };
  const invitationData = buildInvitationCardData(event, isRTL);

  // Velvet Ring / Door of Joy / Swan Lake. Null for every other template,
  // which is what keeps the envelope branch below the default.
  const cinematicTemplate = getCinematicTemplate(event.template_type);
  const CinematicOpening = cinematicTemplate ? CINEMATIC_OPENINGS[cinematicTemplate.opening] : null;
  /* Fixed for the templates that are one occasion; read from the organizer's
     Step 2 answer for Swan Lake, which serves both. Drives the opening's and
     the hero's kicker and tagline. */
  const cinematicOccasion = getCinematicOccasion(cinematicTemplate, td);
  // The names carved on the cover, before any section has rendered. Same
  // resolution order the hero uses — Arabic title override, then the couple,
  // then the event's own title — so the cover and the page never disagree
  // about whose celebration this is.
  const cinematicOpeningNames = (() => {
    if (isRTL && titleAr) return titleAr;
    const a = td.groom_name || td.partner1Name || td.partner1;
    const b = td.bride_name || td.partner2Name || td.partner2;
    return a && b ? `${a} & ${b}` : (localizedTitle || event.title || '');
  })();

  /* Door of Joy's hero video is 1.7MB and sits directly behind the door. The
     knocks plus the door swing take roughly eight seconds — spending them
     fetching means the doves are already decoded when the guest arrives,
     instead of a poster that pops a beat later. Fired on the FIRST knock,
     not at page load, so it never competes with the door video that is on
     screen right now. A bare <link rel=preload> in the document head would;
     this doesn't.

     A plain function rather than useCallback deliberately: this sits below
     nine early returns (loading, error, private, password, not-live…), so a
     hook here would be a CONDITIONAL hook — the render that bails at
     `if (loading)` would run fewer hooks than the one that reaches this line,
     and React would throw on the transition between them. It guards against
     re-entry with a DOM lookup instead of a stable identity. */
  const preloadCinematicHeroVideo = () => {
    const src = cinematicTemplate?.assets?.heroVideo;
    if (!src || typeof document === 'undefined') return;
    if (document.querySelector(`link[data-cine-preload="${src}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'video';
    link.href = src;
    link.setAttribute('data-cine-preload', src);
    document.head.appendChild(link);
  };
  const hasGallery = !!(event.gallery_urls && Array.isArray(event.gallery_urls) && event.gallery_urls.length > 0);
  const hasMap = !!(event.location_address || (event.location_lat && event.location_lng));

  // Once a guest has answered, the public RSVP form is locked by default —
  // the backend (submit_rsvp_v2) rejects a second submission outright. The
  // host can opt back in per-event via "Allow guests to change their
  // response" (event.allow_guest_edits); only then do we surface an edit link.
  const hasResponded = !!guestRsvp && ['yes', 'no', 'maybe'].includes(guestRsvp.response);
  const allowGuestEdits = !!event.allow_guest_edits;
  const RSVP_STATUS = {
    yes: { label: isRTL ? 'تأكيد الحضور' : 'Attending', color: '#3B9B6D' },
    no: { label: isRTL ? 'الاعتذار عن الحضور' : 'Declined', color: '#C45E5E' },
    maybe: { label: isRTL ? 'ربما' : 'Tentative', color: '#6366f1' },
  };
  const responseStatus = hasResponded ? RSVP_STATUS[guestRsvp.response] : null;

  // RSVP now lives inline as the page's final section (#rsvp-section) for every
  // link type — every CTA on this page scrolls there instead of navigating away.
  const scrollToRsvpSection = () => {
    const el = document.getElementById('rsvp-section');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Heritage Arch renders a completely different full-viewport, snap-scrolled
  // page shell — everything above this point (fetch, countdown, music,
  // envelope-reveal state, RSVP resolution) stays shared; only the render
  // diverges, so this returns before the continuous-scroll JSX below.
  if (FULL_PAGE_TEMPLATES.has(event.template_type)) {
    return (
      <PageTransition>
        {/* The arrival. Every full-page template gets exactly one of these,
            gated by the same `showReveal` — so `reveal_enabled`,
            `reveal_replay` and the ?noreveal=1 compliance bypass all keep
            working identically whichever one is mounted.

            The cinematic templates bring their own: a velvet box that opens
            on film, or a door you knock on. Their opening IS their envelope,
            so mounting both would mean breaking a wax seal only to be handed
            a second gate. Everything else keeps InvitationReveal. */}
        <AnimatePresence>
          {showReveal && (
            CinematicOpening ? (
              <CinematicOpening
                key="guest-opening"
                template={cinematicTemplate}
                names={cinematicOpeningNames}
                lang={lang}
                occasion={cinematicOccasion}
                sessionKey={revealSessionKey}
                onComplete={handleRevealComplete}
                onGesture={resumeIfNotUserPaused}
                /* Door of Joy alone reads this — its hero is a video sitting
                   directly behind the door, and the knocks are the only spare
                   seconds to fetch it in. Harmless on the others: an opening
                   that never calls it never preloads anything, and the
                   function itself no-ops when the template has no heroVideo. */
                onFirstKnock={preloadCinematicHeroVideo}
              />
            ) : (
              <InvitationReveal
                key="guest-reveal"
                mode="invitation"
                event={event}
                guestName={guestRsvp?.guest_name || ''}
                lang={lang}
                sessionKey={revealSessionKey}
                onComplete={handleRevealComplete}
                musicRef={musicRef}
              />
            )
          )}
        </AnimatePresence>
        {youtubeMusicId ? (
          <div aria-hidden style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
            <div ref={ytPlayerElRef} />
          </div>
        ) : event.background_music_url && (
          <audio
            ref={musicRef}
            src={event.background_music_url}
            loop
            autoPlay
            preload="auto"
            onPlay={() => setMusicPlaying(true)}
            onPause={() => { setMusicPlaying(false); resumeIfNotUserPaused(); }}
          />
        )}
        <HeritageArchPage
          event={event}
          guestRsvp={guestRsvp}
          lang={lang}
          setLang={setLang}
          isRTL={isRTL}
          t={t}
          timeLeft={timeLeft}
          musicPlaying={musicPlaying}
          toggleMusic={toggleMusic}
          hasBackgroundMusic={!youtubeMusicBlocked && !!(event.background_music_url || youtubeMusicId)}
          hasResponded={hasResponded}
          responseStatus={responseStatus}
          allowGuestEdits={allowGuestEdits}
          slug={slug}
          effectiveRsvpId={effectiveRsvpId}
          trackEvent={trackEvent}
          invitationPattern={invitationPattern}
          invitationTheme={invitationTheme}
          invitationGuestName={invitationGuestName}
          invitationData={invitationData}
          isPreview={isDemoSlug}
          /* Swan Lake's hero arrives embossed in ivory and blooms into colour
             as the cover dissolves. It mounts underneath the opening several
             seconds before the guest can see it, so it needs to know the cover
             is still up — otherwise the whole effect plays behind it. */
          openingActive={showReveal}
        />
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      {/* One-time premium envelope reveal — fixed overlay above the page; the
          page tree below is rendered untouched underneath it. */}
      <AnimatePresence>
        {showReveal && (
          <InvitationReveal
            key="guest-reveal"
            mode="invitation"
            event={event}
            guestName={guestRsvp?.guest_name || ''}
            lang={lang}
            sessionKey={revealSessionKey}
            onComplete={handleRevealComplete}
            musicRef={musicRef}
          />
        )}
      </AnimatePresence>
      {youtubeMusicId ? (
        <div aria-hidden style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
          <div ref={ytPlayerElRef} />
        </div>
      ) : event.background_music_url && (
        <audio
          ref={musicRef}
          src={event.background_music_url}
          loop
          autoPlay
          preload="auto"
          onPlay={() => setMusicPlaying(true)}
          onPause={() => { setMusicPlaying(false); resumeIfNotUserPaused(); }}
          onError={(e) => console.error('Background music failed to load:', event.background_music_url, e.target.error)}
        />
      )}
      <div dir={isRTL ? 'rtl' : 'ltr'} style={{
        minHeight: '100dvh', position: 'relative',
        backgroundColor: customColors.background || '#F8F4EC', color: '#191B1E',
        fontFamily: 'var(--font-sans)', textAlign: isRTL ? 'right' : 'left',
      }}>
        {/* ─── Custom Font Override ─── */}
        {event.custom_fonts && (() => {
          const headingFont = sanitizeFontName(event.custom_fonts.heading) || 'Playfair Display';
          const bodyFont = sanitizeFontName(event.custom_fonts.body) || 'Inter';
          return (
            <style dangerouslySetInnerHTML={{ __html: `
              h1, h2, h3, h4, h5, h6, .font-serif {
                font-family: '${headingFont}', Georgia, serif !important;
              }
              .font-sans, button, input, select, textarea, label {
                font-family: '${bodyFont}', sans-serif !important;
              }
              div, p, span, a, td, th {
                font-family: '${bodyFont}', sans-serif;
              }
            `}} />
          );
        })()}

        {/* ═══ BACKGROUND MUSIC TOGGLE ═══ */}
        {event.background_music_url && !youtubeMusicBlocked && (
          <motion.button
            type="button"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={toggleMusic}
            aria-label={musicPlaying ? (isRTL ? 'إيقاف الموسيقى' : 'Pause music') : (isRTL ? 'تشغيل الموسيقى' : 'Play music')}
            style={{
              // Fixed (not absolute) so it stays visible in the same spot while
              // the guest scrolls, and always on the right regardless of
              // language — offset lower in LTR so it doesn't sit on top of the
              // language toggle, which stays on the right in that direction.
              position: 'fixed', top: isRTL ? '24px' : '76px', right: '24px', zIndex: 30,
              width: '40px', height: '40px', borderRadius: '50%', cursor: 'pointer',
              border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.15)',
              backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
              color: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.3s ease',
            }}
          >
            {musicPlaying ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 12c0-1.77-1-3.29-2.5-4.03v8.06c1.5-.74 2.5-2.26 2.5-4.03z"/><path d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 12L19 9.5M19 9.5L21.5 7M19 9.5L16.5 7M19 9.5L21.5 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/></svg>
            )}
          </motion.button>
        )}

        {/* ═══ GUEST-EXPERIENCE CHROME (progress bar / nav dots / calendar /
            scroll hint) — the continuous-scroll equivalent of HeritageArch's
            SnapShell chrome; see components/guest/LegacyChrome.js. ═══ */}
        {(() => {
          const legacySections = [
            { id: 'lg-hero', label: isRTL ? 'الرئيسية' : 'Home' },
            event.cover_image_url && { id: 'lg-cover-photo', label: isRTL ? 'صورة الغلاف' : 'Cover Photo' },
            { id: 'lg-details', label: isRTL ? 'التفاصيل' : 'Details' },
            (hasGallery || hasMap) && { id: 'lg-more-details', label: isRTL ? 'الصور والموقع' : 'Photos & Location' },
            { id: 'rsvp-section', label: isRTL ? 'تأكيد الحضور' : 'RSVP' },
          ].filter(Boolean);
          const calendarLinks = buildCalendarLinks(event);
          return (
            <>
              <LegacyScrollProgressBar progress={legacyScrollProgress} color={themeColor} />
              <LegacyDotNav
                sections={legacySections}
                active={legacyActiveSectionId}
                color={themeColor}
                isRTL={isRTL}
                onSelect={(id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              />
              {calendarLinks && (
                <LegacyFloatingCalendarButton event={event} isRTL={isRTL} downloadIcs={calendarLinks.downloadIcs} />
              )}
              <LegacyScrollHint visible={legacyShowScrollHint} isRTL={isRTL} color={themeColor} />
            </>
          );
        })()}

        {/* ═══ LANGUAGE TOGGLE ═══ */}
        <div className="ep-lang-toggle" style={{ position: 'absolute', top: '24px', zIndex: 30, display: 'flex', gap: '8px', ...(isRTL ? { left: '24px' } : { right: '24px' }) }}>
          {['en', 'ar'].map(l => (
            <motion.button
              key={l}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setLang(l)}
              aria-label={l === 'en' ? 'Switch to English' : 'التبديل إلى العربية'}
              style={{
                padding: '8px 16px', borderRadius: '10px', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                border: lang === l ? '1px solid rgba(184,148,79,0.4)' : '1px solid rgba(255,255,255,0.3)',
                background: lang === l ? 'rgba(184,148,79,0.9)' : 'rgba(255,255,255,0.15)',
                backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
                color: lang === l ? '#FFFFFF' : 'rgba(255,255,255,0.85)',
                fontFamily: 'var(--font-sans)', transition: 'all 0.3s ease',
              }}
            >
              {l === 'en' ? 'English' : 'العربية'}
            </motion.button>
          ))}
        </div>

        {/* ═══ CINEMATIC HERO ═══ */}
        <div id="lg-hero" ref={heroRef} style={{ position: 'relative', minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: '120px 24px 80px' }}>
          
          {/* Ambient themed background — the cover photo now lives in its own
              framed section further down, so the hero is a clean, dark, themed
              stage for the invitation card. */}
          <div
            style={{
              position: 'absolute', inset: 0, zIndex: 0,
              background: `radial-gradient(circle at 50% 18%, ${themeColor}4D 0%, transparent 55%), linear-gradient(160deg, #14161A 0%, #191B1E 55%, #0E0F11 100%)`,
            }}
            aria-hidden="true"
          />

          <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
            <FloatingParticles count={30} color={themeColor} />
          </div>

          {/* Hero Content — centered text above a centered photo flanked by
              theme-colored floral accents, instead of a side-by-side split. */}
          <div style={{
            position: 'relative', zIndex: 10, maxWidth: '820px', width: '100%',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '56px',
          }}>

            {/* Text Content — centered */}
            <div style={{
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              maxWidth: '680px',
            }} dir={isContentLTR ? 'ltr' : 'rtl'}>
              <FadeInUp delay={0.1} y={20}>
                <span style={{
                  fontSize: '11px', textTransform: 'uppercase', letterSpacing: '3px', color: '#D7BE80',
                  fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '24px', fontFamily: 'var(--font-sans)',
                  padding: '6px 20px', borderRadius: '100px',
                  background: 'rgba(215,190,128,0.06)', border: '1px solid rgba(215,190,128,0.2)',
                  backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                }} dir="auto">
                  <span style={{
                    width: '6px', height: '6px', borderRadius: '50%',
                    background: '#D7BE80', display: 'inline-block',
                    animation: 'pulseDot 2s infinite'
                  }} />
                  {/* Template first (the retired keys name themselves), then
                      the event's own occasion, then a neutral fallback. The
                      raw template key was being printed verbatim — "swans
                      invitation" — for anything unnamed. */}
                  {templateLabels[lang]?.[event.template_type]
                    || occasionKicker(cinematicOccasion, isRTL).toLowerCase()
                    || (isRTL ? 'تفاصيل الفعالية' : 'invitation')}
                </span>
              </FadeInUp>

              <AnimatedText
                text={localizedTitle}
                tag="h1"
                delay={0.2}
                dir={isContentLTR ? 'ltr' : 'rtl'}
                style={{
                  fontSize: 'clamp(42px, 5.5vw, 64px)',
                  fontWeight: isRomantic ? 400 : 800,
                  color: '#FFFFFF',
                  letterSpacing: isRomantic ? '0px' : '-0.5px',
                  marginBottom: '24px',
                  fontFamily: isRomantic ? 'var(--font-serif)' : 'var(--font-sans)',
                  lineHeight: 1.1,
                  textShadow: '0 4px 30px rgba(0,0,0,0.5)',
                  textAlign: 'center',
                }}
                className="ep-hero-title"
              />

              <FadeInUp delay={0.5} y={20}>
                <p style={{
                  color: 'rgba(255,255,255,0.8)',
                  fontWeight: 300,
                  fontSize: '17px',
                  lineHeight: 1.85,
                  marginBottom: '40px',
                  maxWidth: '560px',
                  fontFamily: 'var(--font-sans)',
                  textShadow: '0 2px 10px rgba(0,0,0,0.3)',
                  textAlign: 'center',
                }} dir={isContentLTR ? 'ltr' : 'rtl'}>
                  {localizedDesc}
                </p>
              </FadeInUp>

              <FadeInUp delay={0.7} y={20}>
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' }}>
                  {/* Jump straight to the RSVP section — the most important action
                      on this page, surfaced from the very first screen instead of
                      making guests scroll past everything to find it. */}
                  <GlowPulse color={themeColor === '#191B1E' ? '#B8944F' : themeColor} intensity={0.35}>
                    <MagneticButton
                      variant={themeColor === '#191B1E' ? 'gold' : 'gold'}
                      onClick={scrollToRsvpSection}
                      style={themeColor !== '#191B1E' ? {
                        background: themeColor,
                        color: '#FFFFFF',
                        boxShadow: `0 8px 25px ${themeColor}4D`
                      } : {}}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <Icon name={hasResponded ? 'pencil' : 'envelope'} size={15} strokeWidth={1.6} />
                        {hasResponded ? (isRTL ? 'تعديل ردّك' : 'Update Response') : t.rsvp_now}
                      </span>
                    </MagneticButton>
                  </GlowPulse>
                  <CalendarButton event={event} isRTL={isRTL} variant="outline-gold" />
                  <ShareButton title={event.title} text={event.description} isRTL={isRTL} variant="ghost-gold" />
                </div>
              </FadeInUp>
            </div>

            {/* Featured invitation card — the exact template shape the organizer
                chose (matching their live simulator), flanked by floral accents.
                The cover photo now lives in its own framed section below. */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'clamp(4px, 2vw, 20px)', width: '100%' }}>
              <HeroFloralAccent color={themeColor === '#191B1E' ? '#B8944F' : themeColor} />

              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', perspective: '1000px', minWidth: 0 }}
              >
                <motion.div
                  onClick={() => setCardLightboxOpen(true)}
                  whileHover={{
                    scale: 1.025,
                    y: -5,
                    boxShadow: `0 45px 90px rgba(0,0,0,0.6), 0 0 30px ${themeColor === '#191B1E' ? 'rgba(184,148,79,0.25)' : themeColor + '2A'}, 0 0 0 1.5px rgba(255,255,255,0.25)`
                  }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  id="invitation-card-capture"
                  style={{
                    width: 'min(78vw, 300px)',
                    aspectRatio: '210 / 290', position: 'relative',
                    borderRadius: '16px', overflow: 'hidden',
                    boxShadow: '0 40px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.15)',
                    transformStyle: 'preserve-3d', background: '#FAF8F5',
                    cursor: 'pointer'
                  }}
                >
                  <InvitationCard
                    template={{ pattern: invitationPattern }}
                    theme={invitationTheme}
                    guestName={invitationGuestName}
                    config={invitationPattern === 'custom' ? event.template_data : undefined}
                    data={invitationData}
                  />
                </motion.div>

                {/* Download the invitation card (captures #invitation-card-capture) */}
                <motion.button
                  type="button"
                  onClick={handleDownloadCard}
                  disabled={downloading}
                  whileHover={{ scale: 1.02, y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '10px',
                    padding: '12px 28px', background: 'rgba(215, 190, 128, 0.12)',
                    border: '1.5px solid rgba(215, 190, 128, 0.5)', borderRadius: '12px',
                    color: '#F0DFB4', fontSize: '13px', fontWeight: 700,
                    cursor: downloading ? 'not-allowed' : 'pointer',
                    fontFamily: 'var(--font-sans)', transition: 'all 0.2s',
                    backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                  }}
                >
                  {downloading ? (
                    <>
                      <div style={{ width: '16px', height: '16px', border: '2px solid transparent', borderTop: '2px solid currentColor', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                      <span>{isRTL ? 'جاري التحميل...' : 'Downloading...'}</span>
                    </>
                  ) : (
                    <>
                      <Icon name="download" size={16} strokeWidth={1.6} />
                      <span>{isRTL ? 'تحميل بطاقة الدعوة' : 'Download Invitation'}</span>
                    </>
                  )}
                </motion.button>
              </motion.div>

              <HeroFloralAccent color={themeColor === '#191B1E' ? '#B8944F' : themeColor} mirror />
            </div>
          </div>
        </div>

        {/* ═══ MAIN CONTENT GRID ═══ */}
        <div className="ep-content-grid" style={{ maxWidth: '960px', margin: '0 auto', padding: '64px 24px', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '48px' }}>

          {/* ─── LEFT COLUMN: Details ─── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

            {/* Cover Photo Showcase — the template card is now the hero
                centerpiece, so the organizer's cover photo gets its own framed
                showcase here. Shown only when a cover photo was uploaded. */}
            {event.cover_image_url && (
              <ScaleIn delay={0.05}>
                <div id="lg-cover-photo" style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '24px',
                  width: '100%',
                  padding: '32px 24px',
                  borderRadius: '24px',
                  background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.03) 100%)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  boxShadow: '0 24px 50px -12px rgba(0, 0, 0, 0.25)',
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                }}>
                  <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                    <span style={{
                      fontSize: '11px', textTransform: 'uppercase', letterSpacing: '3px',
                      color: '#D7BE80', fontWeight: 700, display: 'block', marginBottom: '4px',
                      fontFamily: 'var(--font-sans)',
                    }}>
                      {isRTL ? 'لمحة' : 'A Glimpse'}
                    </span>
                    <span style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.5)', fontFamily: 'var(--font-serif)', fontStyle: 'italic' }}>
                      {isRTL ? 'لحظة من مناسبتنا' : 'A moment from our celebration'}
                    </span>
                  </div>

                  {/* Framed cover photo */}
                  <motion.div
                    whileHover={{
                      scale: 1.025,
                      y: -6,
                      boxShadow: '0 35px 70px rgba(0,0,0,0.45), 0 0 30px rgba(215, 190, 128, 0.2)'
                    }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    style={{
                      width: '100%', maxWidth: '340px', aspectRatio: '4/5',
                      borderRadius: '16px', overflow: 'hidden',
                      boxShadow: '0 20px 45px rgba(0,0,0,0.3)',
                      background: 'rgba(0,0,0,0.2)',
                      position: 'relative'
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={event.cover_image_url}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      alt="Event Cover"
                    />
                    <div aria-hidden="true" style={{ position: 'absolute', inset: '10px', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '10px', pointerEvents: 'none' }} />
                    {/* Small gold bokeh circles drifting over the photo — same ambient
                        particle system as the hero stage above, scoped to this frame. */}
                    <FloatingParticles count={18} color={themeColor === '#191B1E' ? '#B8944F' : themeColor} shape="circle" />
                  </motion.div>
                </div>
              </ScaleIn>
            )}

            {/* ═══ EVENT INFO ═══ (When/Where/Dress Code + Countdown merged into
                one section — previously two separately-stacked cards) */}
            <div id="lg-details">
            <FadeInUp delay={0.1}>
              <AnimatedText
                text={t.details_title}
                tag="h2"
                delay={0.1}
                style={{ fontFamily: 'var(--font-serif)', fontSize: '26px', fontWeight: 600, color: '#191B1E', marginBottom: '20px' }}
              />
              <StaggerChildren staggerDelay={0.15} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }} className="ep-bento-grid">
                  {/* When BentoCard */}
                  <StaggerItem>
                    <BentoCard bg="rgba(255,255,255,0.85)" border="rgba(255,255,255,0.6)" style={{ height: '100%', justifyContent: 'center' }}>
                      <span style={{ fontSize: '12px', color: themeColor, textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
                        <Icon name="calendar" size={13} strokeWidth={1.6} /> {t.when}
                      </span>
                      <span style={{ fontSize: '18px', color: '#191B1E', fontWeight: 600, display: 'block', marginBottom: '10px' }}>
                        {new Date(event.event_date).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: safeZone(event.timezone) })}
                      </span>
                      {/* Event Time — its own clearly bordered badge so start
                          (and end, when the host set one) time never reads as
                          an afterthought next to the date. */}
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '7px',
                        padding: '7px 14px', borderRadius: '999px',
                        background: `${themeColor}0F`, border: `1px solid ${themeColor}40`,
                      }}>
                        <Icon name="clock" size={13} color={themeColor} strokeWidth={1.8} />
                        <span style={{ fontSize: '13px', color: '#191B1E', fontWeight: 700 }}>
                          {new Date(event.event_date).toLocaleTimeString(lang === 'ar' ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit', timeZone: safeZone(event.timezone) })}
                          {event.event_end_date && (
                            <> – {new Date(event.event_end_date).toLocaleTimeString(lang === 'ar' ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit', timeZone: safeZone(event.timezone) })}</>
                          )}
                        </span>
                      </span>
                    </BentoCard>
                  </StaggerItem>

                  {/* Where BentoCard */}
                  <StaggerItem>
                    <BentoCard bg="rgba(255,255,255,0.85)" border="rgba(255,255,255,0.6)" style={{ height: '100%', justifyContent: 'center' }}>
                      <span style={{ fontSize: '12px', color: themeColor, textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
                        <Icon name="mapPin" size={13} strokeWidth={1.6} /> {t.where}
                      </span>
                      <span style={{ fontSize: '18px', color: '#191B1E', fontWeight: 600, display: 'block', marginBottom: '8px' }}>{event.location_name}</span>
                      <span style={{ fontSize: '14px', color: '#77736A', display: 'block', marginBottom: '16px' }}>{event.location_address}</span>
                      {(event.location_lat && event.location_lng || event.location_address) && (
                        <MagneticButton variant="outline" size="sm" onClick={() => window.open(getDirectionsUrl(event.location_lat, event.location_lng, event.location_address, isClient), '_blank')}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Icon name="compass" size={13} strokeWidth={1.6} /> {isRTL ? 'الاتجاهات' : 'Get Directions'}</span>
                        </MagneticButton>
                      )}
                    </BentoCard>
                  </StaggerItem>

                  {/**
                    * DRESS CODE — a plain card. It used to be an accordion, and
                    * the accordion did nothing.
                    *
                    * Both branches rendered `localizedDressCode`: collapsed
                    * showed it, expanded showed it again in a taller box. So the
                    * chevron promised hidden detail, and clicking it revealed the
                    * same two words that were already on screen — a control whose
                    * only visible effect was the row growing by 4px. There is one
                    * short string here and there has never been anything else to
                    * reveal; the honest presentation is to simply show it.
                    *
                    * The icon went with it. A pictogram of a suit next to a label
                    * that already reads "Dress Code" is a second, worse copy of
                    * the word, and it was the only Icon in this row of cards that
                    * was decorative rather than pointing somewhere (Where has a
                    * pin because it maps to a place, Directions has a compass
                    * because it opens one).
                    */}
                  {event.dress_code && (
                    <StaggerItem style={{ gridColumn: '1 / -1' }}>
                      <BentoCard bg="rgba(255,255,255,0.85)" border="rgba(255,255,255,0.6)">
                        <span style={{ fontSize: '12px', color: themeColor, textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700, display: 'block', fontFamily: 'var(--font-sans)' }}>
                          {t.dress_code}
                        </span>
                        <span style={{ fontSize: '18px', color: '#191B1E', fontWeight: 600, display: 'block', marginTop: '8px' }}>
                          {localizedDressCode}
                        </span>
                      </BentoCard>
                    </StaggerItem>
                  )}
              </StaggerChildren>

              {/* Countdown — a slim strip folded into this same section instead
                  of its own separate full-height dark card. */}
              {timeLeft.days !== undefined ? (
                <div style={{
                  marginTop: '20px', padding: '20px 24px', borderRadius: '16px',
                  background: 'rgba(25,27,30,0.95)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}>
                  <p style={{ textAlign: 'center', fontSize: '10px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.2em', fontWeight: 700, marginBottom: '14px', fontFamily: 'var(--font-sans)' }}>
                    {t.countdown_title || (isRTL ? 'متبقي على الاحتفال' : 'Celebrating In')}
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <CountdownDigit value={timeLeft.days} label={t.days} color={themeColor} />
                    <div style={{ display: 'flex', alignItems: 'center', paddingBottom: '28px' }}>
                      <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '28px', fontWeight: 300 }}>:</span>
                    </div>
                    <CountdownDigit value={timeLeft.hours} label={t.hours} color={themeColor} />
                    <div style={{ display: 'flex', alignItems: 'center', paddingBottom: '28px' }}>
                      <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '28px', fontWeight: 300 }}>:</span>
                    </div>
                    <CountdownDigit value={timeLeft.minutes} label={t.minutes} color={themeColor} />
                    <div style={{ display: 'flex', alignItems: 'center', paddingBottom: '28px' }}>
                      <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '28px', fontWeight: 300 }}>:</span>
                    </div>
                    <CountdownDigit value={timeLeft.seconds} label={t.seconds} color={themeColor} />
                  </div>
                </div>
              ) : eventPassed && (
                <div style={{ marginTop: '20px', textAlign: 'center', padding: '24px', borderRadius: '16px', background: 'rgba(196,94,94,0.06)', border: '1px solid rgba(196,94,94,0.2)' }}>
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: 0.2 }} style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}><Icon name="clock" size={26} color="#C45E5E" strokeWidth={1.4} /></motion.div>
                  <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '16px', fontWeight: 600, color: '#C45E5E' }}>
                    {lang === 'ar' ? 'لقد انتهت هذه الفعالية' : 'This event has already occurred'}
                  </h3>
                  <p style={{ color: '#77736A', fontSize: '13px', marginTop: '6px', lineHeight: 1.6 }}>
                    {lang === 'ar' ? 'كان موعد الفعالية قد مضى. شكراً لكم على اهتمامكم.' : 'The event date has passed. Thank you for your interest.'}
                  </p>
                </div>
              )}
            </FadeInUp>
            </div>

            {/* ═══════════════════════════════════════════
                TEMPLATE-SPECIFIC SECTIONS
                ═══════════════════════════════════════════ */}

            {/* ─── WEDDING (one consolidated "Our Story" panel) — also covers the ─── */}
            {/* ─── Tuscan Vineyard template, a visual variant of a wedding ─── */}
            {isWedding && event.template_data && (
              <FadeInUp delay={0.15}>
                <GlassmorphismCard bg="rgba(255,255,255,0.92)" border="rgba(232,226,214,0.6)">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {/* Partners */}
                    {(event.template_data.partner1Name || event.template_data.partner2Name || event.template_data.groom_name || event.template_data.bride_name || event.template_data.partner1 || event.template_data.partner2) && (
                      <div style={{ textAlign: 'center', position: 'relative' }}>
                        <span style={{ fontFamily: 'var(--font-serif)', fontSize: '28px', color: themeColor, fontWeight: 500, lineHeight: 1.4 }}>
                          {event.template_data.groom_name || event.template_data.partner1Name || event.template_data.partner1}
                          <span style={{ display: 'block', fontSize: '16px', opacity: 0.5, margin: '4px 0' }}>&amp;</span>
                          {event.template_data.bride_name || event.template_data.partner2Name || event.template_data.partner2}
                        </span>
                      </div>
                    )}

                    {/* Family names */}
                    {event.template_data.family_names && (
                      <div style={{ textAlign: 'center', color: '#77736A', fontSize: '13px', fontStyle: 'italic' }}>
                        {isRTL ? 'بدعوة من' : 'With the honor of'} {event.template_data.family_names}
                      </div>
                    )}

                    {/* Love Story */}
                    {event.template_data.loveStory && (
                      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', borderTop: '1px solid #F0ECE3', paddingTop: '20px' }}>
                        <div style={{
                          width: '4px', minHeight: '60px', borderRadius: '2px', flexShrink: 0,
                          background: `linear-gradient(to bottom, ${themeColor}, rgba(184,148,79,0.2))`,
                        }} />
                        <div>
                          <h4 style={{ fontFamily: 'var(--font-serif)', fontSize: '17px', fontWeight: 600, color: '#191B1E', marginBottom: '12px' }}>
                            {isRTL ? 'قصة حبنا' : 'Our Love Story'}
                          </h4>
                          <p style={{ fontSize: '14px', color: '#77736A', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{event.template_data.loveStory}</p>
                        </div>
                      </div>
                    )}

                    {/* Ceremony & Reception */}
                    {(invitationData.ceremonyLine || invitationData.receptionLine) && (
                      <StaggerChildren staggerDelay={0.15} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', borderTop: '1px solid #F0ECE3', paddingTop: '20px' }} className="ep-ceremony-grid">
                        {invitationData.ceremonyLine && (
                          <StaggerItem>
                            <div style={{ textAlign: 'center' }}>
                              <Icon name="chapel" size={26} color={themeColor} strokeWidth={1.4} style={{ display: 'block', margin: '0 auto 8px' }} />
                              <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.15em', color: '#77736A', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
                                {isRTL ? 'مراسم الزواج' : 'Ceremony'}
                              </span>
                              <span style={{ fontSize: '14px', color: '#191B1E', fontWeight: 500 }}>{invitationData.ceremonyLine}</span>
                            </div>
                          </StaggerItem>
                        )}
                        {invitationData.receptionLine && (
                          <StaggerItem>
                            <div style={{ textAlign: 'center' }}>
                              <Icon name="toast" size={26} color={themeColor} strokeWidth={1.4} style={{ display: 'block', margin: '0 auto 8px' }} />
                              <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.15em', color: '#77736A', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
                                {isRTL ? 'حفل الاستقبال' : 'Reception'}
                              </span>
                              <span style={{ fontSize: '14px', color: '#191B1E', fontWeight: 500 }}>{invitationData.receptionLine}</span>
                            </div>
                          </StaggerItem>
                        )}
                      </StaggerChildren>
                    )}

                    {/* Accommodations */}
                    {event.template_data.accommodations && (
                      <div style={{ borderTop: '1px solid #F0ECE3', paddingTop: '20px' }}>
                        <h4 style={{ fontFamily: 'var(--font-serif)', fontSize: '16px', fontWeight: 600, color: '#191B1E', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}><Icon name="hotel" size={16} color="#191B1E" strokeWidth={1.5} /> {isRTL ? 'الإقامة' : 'Accommodations'}</h4>
                        <p style={{ fontSize: '13px', color: '#77736A', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{event.template_data.accommodations}</p>
                      </div>
                    )}

                    {/* Gift Registry */}
                    {(event.template_data.registryUrl || event.template_data.giftRegistry) && (
                      <a href={event.template_data.registryUrl || event.template_data.giftRegistry} target="_blank" rel="noopener noreferrer" style={{
                        display: 'block', textAlign: 'center', padding: '16px',
                        background: 'rgba(184,148,79,0.06)', border: '1px solid rgba(184,148,79,0.15)',
                        borderRadius: '14px', color: themeColor, fontWeight: 600, fontSize: '13px', textDecoration: 'none',
                        transition: 'all 0.3s ease',
                      }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Icon name="gift" size={14} strokeWidth={1.5} /> {isRTL ? 'عرض قائمة الهدايا' : 'View Our Gift Registry'} →</span>
                      </a>
                    )}
                  </div>
                </GlassmorphismCard>
              </FadeInUp>
            )}

            {/* ─── ENGAGEMENT (one consolidated panel) ─── */}
            {event.template_type === 'engagement' && event.template_data && (
              <FadeInUp delay={0.15}>
                <GlassmorphismCard bg="rgba(255,255,255,0.92)" border="rgba(232,226,214,0.6)">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {(event.template_data.partner1Name || event.template_data.partner2Name || event.template_data.partner1 || event.template_data.partner2) && (
                      <div style={{ textAlign: 'center' }}>
                        <span style={{ fontFamily: 'var(--font-serif)', fontSize: '26px', color: themeColor }}>
                          {event.template_data.partner1Name || event.template_data.partner1} &amp; {event.template_data.partner2Name || event.template_data.partner2}
                        </span>
                      </div>
                    )}
                    {(event.template_data.ourStory || event.template_data.proposalStory) && (
                      <div style={{ borderTop: '1px solid #F0ECE3', paddingTop: '20px' }}>
                        <h4 style={{ fontFamily: 'var(--font-serif)', fontSize: '16px', fontWeight: 600, color: '#191B1E', marginBottom: '12px' }}>
                          {isRTL ? 'قصتنا' : 'Our Story'}
                        </h4>
                        <p style={{ fontSize: '14px', color: '#77736A', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{event.template_data.ourStory || event.template_data.proposalStory}</p>
                      </div>
                    )}
                    {(event.template_data.registryUrl || event.template_data.giftRegistry) && (
                      <a href={event.template_data.registryUrl || event.template_data.giftRegistry} target="_blank" rel="noopener noreferrer" style={{ display: 'block', textAlign: 'center', padding: '14px', background: 'rgba(194,123,142,0.06)', border: '1px solid rgba(194,123,142,0.15)', borderRadius: '14px', color: themeColor, fontWeight: 600, fontSize: '13px', textDecoration: 'none' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Icon name="gift" size={14} strokeWidth={1.5} /> {isRTL ? 'عرض قائمة الهدايا' : 'View Our Gift Registry'} →</span>
                      </a>
                    )}
                  </div>
                </GlassmorphismCard>
              </FadeInUp>
            )}

            {/* ─── CORPORATE (one consolidated panel) ─── */}
            {event.template_type === 'corporate' && event.template_data && (
              <FadeInUp delay={0.15}>
                <GlassmorphismCard bg="rgba(255,255,255,0.92)" border="rgba(232,226,214,0.6)">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {(event.template_data.companyName || event.template_data.company_name || event.template_data.company) && (
                      <div style={{ textAlign: 'center' }}>
                        <span style={{ fontSize: '14px', fontWeight: 700, color: '#1E293B', letterSpacing: '0.5px' }}>
                          {isRTL ? 'بتنظيم من' : 'Hosted by'} {event.template_data.company_name || event.template_data.companyName || event.template_data.company}
                        </span>
                      </div>
                    )}
                    {event.template_data.agenda && (
                      <div style={{ borderTop: '1px solid #F0ECE3', paddingTop: '20px' }}>
                        <h4 style={{ fontFamily: 'var(--font-serif)', fontSize: '16px', fontWeight: 600, color: '#191B1E', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}><Icon name="clipboard" size={16} color="#191B1E" strokeWidth={1.5} /> {isRTL ? 'أجندة الفعالية' : 'Event Agenda'}</h4>
                        <div style={{ fontSize: '14px', color: '#77736A', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{event.template_data.agenda}</div>
                      </div>
                    )}
                    {event.template_data.speakers && (
                      <div style={{ borderTop: '1px solid #F0ECE3', paddingTop: '20px' }}>
                        <h4 style={{ fontFamily: 'var(--font-serif)', fontSize: '16px', fontWeight: 600, color: '#191B1E', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}><Icon name="mic" size={16} color="#191B1E" strokeWidth={1.5} /> {isRTL ? 'المتحدثون' : 'Speakers & Presenters'}</h4>
                        <div style={{ fontSize: '14px', color: '#77736A', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{event.template_data.speakers}</div>
                      </div>
                    )}
                    {event.template_data.sponsors && (
                      <div style={{ textAlign: 'center', borderTop: '1px solid #F0ECE3', paddingTop: '20px' }}>
                        <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.15em', color: '#77736A', fontWeight: 700, display: 'block', marginBottom: '8px' }}>
                          {isRTL ? 'برعاية' : 'Sponsored By'}
                        </span>
                        <span style={{ fontSize: '14px', color: '#1E293B' }}>{event.template_data.sponsors}</span>
                      </div>
                    )}
                    {event.template_data.networkingNotes && (
                      <div style={{ borderTop: '1px solid #F0ECE3', paddingTop: '20px' }}>
                        <span style={{ fontSize: '13px', color: '#77736A', lineHeight: 1.7, display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                          <Icon name="handshake" size={15} strokeWidth={1.5} style={{ flexShrink: 0, marginTop: '1px' }} /> {event.template_data.networkingNotes}
                        </span>
                      </div>
                    )}
                  </div>
                </GlassmorphismCard>
              </FadeInUp>
            )}

            {/* ─── BIRTHDAY (one consolidated panel) ─── */}
            {event.template_type === 'birthday' && event.template_data && (
              <FadeInUp delay={0.15}>
                <GlassmorphismCard bg="rgba(255,255,255,0.92)" border="rgba(232,226,214,0.6)">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {(event.template_data.birthdayPersonName || event.template_data.celebrant) && (
                      <div style={{ textAlign: 'center' }}>
                        <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', delay: 0.3 }} style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}><Icon name="partyPopper" size={30} color={themeColor} strokeWidth={1.4} /></motion.div>
                        <span style={{ fontFamily: 'var(--font-serif)', fontSize: '22px', fontWeight: 600, color: themeColor, display: 'block' }}>
                          {event.template_data.birthdayPersonName || event.template_data.celebrant}
                        </span>
                        {(event.template_data.ageMilestone || event.template_data.age) && (
                          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: 0.5 }} style={{
                            display: 'inline-block', marginTop: '10px', padding: '5px 20px',
                            background: themeColor, color: '#FFFFFF', borderRadius: '20px',
                            fontSize: '13px', fontWeight: 700,
                          }}>
                            {event.template_data.ageMilestone || event.template_data.age}
                          </motion.span>
                        )}
                      </div>
                    )}
                    {(event.template_data.theme || event.template_data.partyTheme) && (
                      <div style={{ textAlign: 'center', borderTop: '1px solid #F0ECE3', paddingTop: '20px' }}>
                        <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.15em', color: '#77736A', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '6px' }}><Icon name="masks" size={13} strokeWidth={1.6} /> {isRTL ? 'ثيم الحفلة' : 'Party Theme'}</span>
                        <span style={{ fontSize: '15px', color: '#191B1E', fontWeight: 500 }}>{event.template_data.theme || event.template_data.partyTheme}</span>
                      </div>
                    )}
                    {(event.template_data.registryUrl || event.template_data.giftRegistry) && (
                      <a href={event.template_data.registryUrl || event.template_data.giftRegistry} target="_blank" rel="noopener noreferrer" style={{ display: 'block', textAlign: 'center', padding: '14px', background: 'rgba(232,93,117,0.06)', border: '1px solid rgba(232,93,117,0.15)', borderRadius: '14px', color: themeColor, fontWeight: 600, fontSize: '13px', textDecoration: 'none' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Icon name="gift" size={14} strokeWidth={1.5} /> {isRTL ? 'عرض قائمة الهدايا' : 'View Gift Registry'} →</span>
                      </a>
                    )}
                  </div>
                </GlassmorphismCard>
              </FadeInUp>
            )}

            {/* ─── GALA (one consolidated panel) ─── */}
            {event.template_type === 'gala' && event.template_data && (
              <FadeInUp delay={0.15}>
                <GlassmorphismCard bg="rgba(255,255,255,0.92)" border="rgba(232,226,214,0.6)">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {(event.template_data.honorees || event.template_data.honoree) && (
                      <div style={{ textAlign: 'center' }}>
                        <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.2em', color: '#B8944F', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', marginBottom: '10px' }}><Icon name="sparkle" size={12} strokeWidth={1.6} /> {isRTL ? 'تكريم' : 'Honoring'}</span>
                        <span style={{ fontFamily: 'var(--font-serif)', fontSize: '20px', fontWeight: 600, color: '#191B1E' }}>{event.template_data.honorees || event.template_data.honoree}</span>
                      </div>
                    )}
                    {event.template_data.program && (
                      <div style={{ borderTop: '1px solid #F0ECE3', paddingTop: '20px' }}>
                        <h4 style={{ fontFamily: 'var(--font-serif)', fontSize: '16px', fontWeight: 600, color: '#191B1E', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}><Icon name="music" size={16} color="#191B1E" strokeWidth={1.5} /> {isRTL ? 'البرنامج والترفيه' : 'Program & Entertainment'}</h4>
                        <div style={{ fontSize: '14px', color: '#77736A', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{event.template_data.program}</div>
                      </div>
                    )}
                    {(event.template_data.sponsorTiers || event.template_data.sponsorPackages) && (
                      <div style={{ borderTop: '1px solid #F0ECE3', paddingTop: '20px' }}>
                        <h4 style={{ fontFamily: 'var(--font-serif)', fontSize: '16px', fontWeight: 600, color: '#191B1E', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}><Icon name="trophy" size={16} color="#191B1E" strokeWidth={1.5} /> {isRTL ? 'فئات الرعاة' : 'Sponsor Tiers'}</h4>
                        <div style={{ fontSize: '14px', color: '#77736A', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{event.template_data.sponsorTiers || event.template_data.sponsorPackages}</div>
                      </div>
                    )}
                  </div>
                </GlassmorphismCard>
              </FadeInUp>
            )}

          </div>

          {/* ─── RIGHT COLUMN: RSVP ─── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', position: 'sticky', top: '32px', alignSelf: 'start' }}>

            {/* RSVP Card — points at the single in-page RSVP section below
                regardless of link type (no more navigating to a separate page). */}
            <div ref={rsvpCardRef}>
              <ScaleIn delay={0.2}>
                {hasResponded ? (
                  <BentoCard bg="rgba(255,255,255,0.94)" border="rgba(232,226,214,0.6)" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '14px', padding: '36px 28px' }}>
                    <div style={{
                      width: '52px', height: '52px', margin: '0 auto', borderRadius: '50%',
                      background: `${responseStatus.color}14`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={responseStatus.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '20px', fontWeight: 600, color: '#191B1E', margin: 0 }}>
                      {isRTL ? 'تم تسجيل ردّك' : "You've already responded"}
                    </h3>
                    <span style={{
                      display: 'inline-flex', alignSelf: 'center', alignItems: 'center', gap: '6px',
                      padding: '6px 16px', borderRadius: '999px', background: `${responseStatus.color}14`,
                      color: responseStatus.color, fontWeight: 700, fontSize: '13px', fontFamily: 'var(--font-sans)',
                    }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: responseStatus.color }} />
                      {responseStatus.label}
                    </span>
                    {allowGuestEdits ? (
                      <button type="button" onClick={scrollToRsvpSection} style={{
                        marginTop: '6px', fontSize: '13px', fontWeight: 600, color: themeColor, textDecoration: 'none', fontFamily: 'var(--font-sans)',
                        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                      }}>
                        {isRTL ? 'تعديل ردّك ←' : 'Update your response →'}
                      </button>
                    ) : (
                      <p style={{ fontSize: '12px', color: '#A09A91', lineHeight: 1.6, margin: 0, fontFamily: 'var(--font-sans)' }}>
                        {isRTL ? 'الردود مقفلة. لتغيير ردك، تواصل مع المُنظّم مباشرة.' : 'Responses are locked. To make a change, please contact the host directly.'}
                      </p>
                    )}
                  </BentoCard>
                ) : (
                  <BentoCard bg="rgba(255,255,255,0.94)" border="rgba(232,226,214,0.6)" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '18px', padding: '36px 28px' }}>
                    <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '22px', fontWeight: 600, color: '#191B1E' }}>{t.card_title}</h3>
                    {event.rsvp_deadline && (() => {
                      const status = getRsvpDeadlineStatus(event.rsvp_deadline);
                      // Fixed semantic colors for urgent/passed (not the event's
                      // own theme color) so these warning states read the same
                      // regardless of custom colors — same reasoning as the
                      // RSVP wizard's pill above.
                      const tone = status.passed ? '#C45E5E' : status.urgent ? '#B8944F' : themeColor;
                      const deadlineText = new Date(event.rsvp_deadline).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: safeZone(event.timezone) });
                      const label = status.passed
                        ? t.reply_by_passed.replace('{date}', deadlineText)
                        : status.urgent
                          ? t.reply_by_urgent.replace('{date}', deadlineText).replace('{daysPhrase}', daysLeftPhrase(status.daysLeft, isRTL))
                          : `${t.reply_by} ${deadlineText}`;
                      // A full-width banner, not a small inline pill — the
                      // passed/urgent states are the single most time-critical
                      // thing a guest can read here, easy to miss as a 13px pill.
                      return (
                        <div style={{
                          display: 'flex', alignSelf: 'stretch', alignItems: 'center', gap: '14px',
                          padding: '14px 18px', borderRadius: '14px',
                          background: `${tone}14`, border: `1.5px solid ${tone}40`,
                        }}>
                          <span style={{
                            flexShrink: 0, width: '34px', height: '34px', borderRadius: '50%',
                            background: `${tone}1E`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <Icon name={status.passed ? 'warning' : 'clock'} size={17} color={tone} strokeWidth={1.8} />
                          </span>
                          <span style={{ fontSize: '14px', fontWeight: 700, lineHeight: 1.4, textAlign: 'left', color: status.passed || status.urgent ? tone : '#191B1E' }}>
                            {label}
                          </span>
                        </div>
                      );
                    })()}
                    <p style={{ fontSize: '13px', color: '#77736A', lineHeight: 1.6, margin: 0 }}>
                      {t.card_desc}
                    </p>
                    <GlowPulse color={themeColor} intensity={0.25}>
                      <button type="button" onClick={scrollToRsvpSection} style={{
                        display: 'block', width: '100%', padding: '16px', textAlign: 'center', color: '#FFFFFF', fontWeight: 700,
                        fontSize: '14px', borderRadius: '12px', textDecoration: 'none', fontFamily: 'var(--font-sans)',
                        background: themeColor, letterSpacing: '0.5px', boxSizing: 'border-box', border: 'none', cursor: 'pointer',
                      }}>
                        {t.rsvp_now}
                      </button>
                    </GlowPulse>
                  </BentoCard>
                )}
              </ScaleIn>
            </div>

          </div>
        </div>

        {/* ═══ MORE DETAILS (Photos & Location) — one collapsible disclosure
            instead of two always-fully-rendered sections. ═══ */}
        {(hasGallery || hasMap) && (
          <div id="lg-more-details" style={{ maxWidth: '960px', margin: '0 auto', padding: '0 24px 48px' }}>
            <button
              onClick={() => setMoreDetailsExpanded(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(232,226,214,0.6)',
                borderRadius: '14px', padding: '18px 24px', cursor: 'pointer', fontFamily: 'var(--font-sans)',
              }}
            >
              <span style={{ fontSize: '15px', fontWeight: 600, color: '#191B1E', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ display: 'inline-flex', gap: '2px' }}><Icon name="camera" size={16} strokeWidth={1.5} /><Icon name="mapPin" size={16} strokeWidth={1.5} /></span>
                {isRTL ? 'صور الموقع والخريطة' : 'Photos & Location'}
              </span>
              <motion.span animate={{ rotate: moreDetailsExpanded ? 180 : 0 }} transition={{ duration: 0.25 }} style={{ fontSize: '14px', color: themeColor }}>
                ▼
              </motion.span>
            </button>

            <AnimatePresence>
              {moreDetailsExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  style={{ overflow: 'hidden' }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '20px' }}>
                    {hasGallery && (
                      <ScaleIn>
                        <GlassmorphismCard bg="rgba(255,255,255,0.92)" border="rgba(232,226,214,0.6)" style={{ padding: '36px' }}>
                          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '22px', fontWeight: 600, color: '#191B1E', marginBottom: '24px', textAlign: 'center' }}>
                            {isRTL ? 'معرض الصور' : 'Photo Gallery'}
                          </h2>
                          <StaggerChildren
                            staggerDelay={0.08}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: event.gallery_urls.length === 1 ? '1fr' : event.gallery_urls.length === 2 ? '1fr 1fr' : 'repeat(3, 1fr)',
                              gap: '12px',
                            }}
                            className="ep-gallery-grid"
                          >
                            {event.gallery_urls.map((url, i) => (
                              <StaggerItem key={i}>
                                <motion.div
                                  whileHover={{ scale: 1.03 }}
                                  transition={{ duration: 0.3 }}
                                  onClick={() => { setLightboxIndex(i); setLightboxOpen(true); }}
                                  style={{
                                    borderRadius: '12px', overflow: 'hidden', cursor: 'pointer',
                                    height: event.gallery_urls.length <= 2 ? '280px' : '200px',
                                    background: '#F0ECE3', position: 'relative',
                                  }}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={url}
                                    alt={`Gallery photo ${i + 1}`}
                                    loading="lazy"
                                    style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.5s ease' }}
                                    onError={e => e.target.style.display = 'none'}
                                  />
                                  {/* Hover overlay */}
                                  <div style={{
                                    position: 'absolute', inset: 0, background: 'rgba(25,27,30,0)', transition: 'background 0.3s',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  }}
                                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(25,27,30,0.25)'; e.currentTarget.querySelector('span').style.opacity = '1'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(25,27,30,0)'; e.currentTarget.querySelector('span').style.opacity = '0'; }}
                                  >
                                    <span style={{ color: '#FFFFFF', fontSize: '24px', opacity: 0, transition: 'opacity 0.3s' }}>⤢</span>
                                  </div>
                                </motion.div>
                              </StaggerItem>
                            ))}
                          </StaggerChildren>
                        </GlassmorphismCard>
                      </ScaleIn>
                    )}

                    {hasMap && (
                      <ScaleIn>
                        <GlassmorphismCard bg="rgba(255,255,255,0.92)" border="rgba(232,226,214,0.6)" style={{ padding: '36px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                            <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '22px', fontWeight: 600, color: '#191B1E' }}>
                              {isRTL ? 'الموقع' : 'Location'}
                            </h2>
                            <a
                              href={getDirectionsUrl(event.location_lat, event.location_lng, event.location_address, isClient)}
                              target="_blank" rel="noopener noreferrer"
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: '6px',
                                padding: '8px 18px', borderRadius: '10px',
                                background: 'rgba(184,148,79,0.08)', border: '1px solid rgba(184,148,79,0.15)',
                                color: themeColor, fontWeight: 600, fontSize: '12px', textDecoration: 'none',
                                fontFamily: 'var(--font-sans)',
                              }}
                            >
                              <Icon name="compass" size={13} strokeWidth={1.6} /> {isRTL ? 'الاتجاهات' : 'Get Directions'}
                            </a>
                          </div>
                          <div style={{ borderRadius: '14px', overflow: 'hidden', height: '300px', border: '1px solid #E8E2D6' }}>
                            {process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ? (
                              <iframe
                                title="Event Location Map"
                                width="100%" height="100%" style={{ border: 0 }}
                                loading="lazy" referrerPolicy="no-referrer-when-downgrade"
                                src={`https://www.google.com/maps/embed/v1/place?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&q=${event.location_lat && event.location_lng ? `${event.location_lat},${event.location_lng}` : encodeURIComponent(event.location_address || '')}&zoom=15`}
                              />
                            ) : (
                              <iframe
                                title="Event Location Map"
                                width="100%" height="100%" style={{ border: 0 }}
                                loading="lazy" referrerPolicy="no-referrer-when-downgrade"
                                src={`https://maps.google.com/maps?q=${encodeURIComponent(event.location_address || (event.location_lat && event.location_lng ? `${event.location_lat},${event.location_lng}` : ''))}&t=&z=15&ie=UTF8&iwloc=&output=embed`}
                              />
                            )}
                          </div>
                          {event.location_address && (
                            <p style={{ fontSize: '13px', color: '#77736A', marginTop: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <Icon name="mapPin" size={13} strokeWidth={1.6} /> {event.location_address}
                            </p>
                          )}
                        </GlassmorphismCard>
                      </ScaleIn>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Lightbox */}
            <AnimatePresence>
              {lightboxOpen && (
                <GalleryLightbox
                  images={event.gallery_urls}
                  initialIndex={lightboxIndex}
                  onClose={() => setLightboxOpen(false)}
                />
              )}
            </AnimatePresence>

            {/* Fullscreen Card Lightbox */}
            <AnimatePresence>
              {cardLightboxOpen && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setCardLightboxOpen(false)}
                  style={{
                    position: 'fixed', inset: 0, zIndex: 1000,
                    background: 'rgba(20,22,25,0.92)',
                    backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    padding: '24px', cursor: 'zoom-out'
                  }}
                >
                  {/* Close Button */}
                  <button 
                    onClick={() => setCardLightboxOpen(false)}
                    style={{
                      position: 'absolute', top: '24px', right: '24px',
                      background: 'rgba(255,255,255,0.1)', border: 'none',
                      width: '44px', height: '44px', borderRadius: '50%',
                      color: '#FFFFFF', fontSize: '20px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'background 0.2s', zIndex: 1010
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                  >
                    ✕
                  </button>

                  {/* Large Card Container */}
                  <motion.div 
                    initial={{ scale: 0.9, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    exit={{ scale: 0.9, y: 20 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                    onClick={e => e.stopPropagation()} // prevent closing when clicking the card itself
                    style={{
                      width: '100%', maxWidth: '420px', aspectRatio: '210 / 290',
                      borderRadius: '20px', overflow: 'hidden',
                      boxShadow: '0 30px 90px rgba(0,0,0,0.6), 0 0 50px rgba(215, 190, 128, 0.15)',
                      background: '#FAF8F5',
                      cursor: 'default',
                      position: 'relative'
                    }}
                  >
                    <InvitationCard
                      template={{ pattern: invitationPattern }}
                      theme={invitationTheme}
                      guestName={invitationGuestName}
                      config={invitationPattern === 'custom' ? event.template_data : undefined}
                      data={invitationData}
                    />
                  </motion.div>

                  {/* Plaque actions under the card */}
                  <div 
                    onClick={e => e.stopPropagation()}
                    style={{ marginTop: '24px', display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' }}
                  >
                    <button
                      type="button"
                      onClick={handleDownloadCard}
                      disabled={downloading}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '8px',
                        padding: '12px 28px', background: '#D7BE80', color: '#121212',
                        border: 'none', borderRadius: '12px', fontSize: '13px', fontWeight: 700,
                        cursor: downloading ? 'not-allowed' : 'pointer',
                        fontFamily: 'var(--font-sans)', transition: 'all 0.2s',
                        boxShadow: '0 8px 25px rgba(215, 190, 128, 0.3)'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#FFFFFF'}
                      onMouseLeave={e => e.currentTarget.style.background = '#D7BE80'}
                    >
                      {downloading ? (
                        <>
                          <div style={{
                            width: '14px', height: '14px', border: '2px solid transparent',
                            borderTop: '2px solid currentColor', borderRadius: '50%',
                            animation: 'spin 0.8s linear infinite',
                          }} />
                          <span>{isRTL ? 'جاري التحميل...' : 'Downloading...'}</span>
                        </>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Icon name="download" size={14} strokeWidth={1.6} /> {isRTL ? 'تحميل الكارت' : 'Download Card'}</span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setCardLightboxOpen(false)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '8px',
                        padding: '12px 28px', background: 'transparent', color: '#FFFFFF',
                        border: '1.5px solid rgba(255,255,255,0.4)', borderRadius: '12px', fontSize: '13px', fontWeight: 700,
                        cursor: 'pointer', fontFamily: 'var(--font-sans)', transition: 'all 0.2s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      {isRTL ? 'إغلاق' : 'Close'}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* ═══ RSVP SECTION ═══
            The one unmistakable RSVP moment — every CTA on this page (sidebar
            card, floating bar) scrolls here instead of navigating to a separate
            page. RsvpExperience independently resolves this guest's identity
            (token / ?g= / device-remembered) and owns the lock + idempotent
            submit; RsvpWizard renders embedded (no second envelope, no second
            language toggle — both already happened above on this same page). */}
        <div id="rsvp-section" style={{ padding: '0 24px 64px' }}>
          <FadeInUp>
            <RsvpExperience context={{ kind: 'slug', slug, guestId: invitationGuestId, partyId: invitationRsvpId }} lang={lang}>
              {(api) => (
                <RsvpWizard
                  {...api}
                  embedded
                  lang={lang}
                  onGuestIdentified={(g) => setGuestRsvp((prev) => ({ ...(prev || {}), ...g }))}
                />
              )}
            </RsvpExperience>
          </FadeInUp>
        </div>

        {/* ═══ FLOATING RSVP CTA ═══ */}
        {/* Hidden once the response is locked — there is nothing actionable left
            to surface here when the host hasn't enabled guest self-edits. */}
        <AnimatePresence>
          {showFloatingCTA && !eventPassed && !(hasResponded && !allowGuestEdits) && (
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              style={{
                position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
                background: 'rgba(25,27,30,0.95)',
                backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                padding: '14px 24px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '20px',
              }}
              className="ep-floating-cta"
            >
              <div style={{ flex: 1, minWidth: 0, maxWidth: '400px' }}>
                <p style={{
                  fontSize: '13px', fontWeight: 600, color: '#FFFFFF', margin: 0,
                  fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {localizedTitle}
                </p>
                {event.rsvp_deadline && (() => {
                  const status = getRsvpDeadlineStatus(event.rsvp_deadline);
                  const deadlineText = new Date(event.rsvp_deadline).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric', timeZone: safeZone(event.timezone) });
                  const label = status.passed
                    ? t.reply_by_passed.replace('{date}', deadlineText)
                    : status.urgent
                      ? t.reply_by_urgent.replace('{date}', deadlineText).replace('{daysPhrase}', daysLeftPhrase(status.daysLeft, isRTL))
                      : `${t.reply_by} ${deadlineText}`;
                  return (
                    <p style={{ fontSize: '11px', color: status.passed ? '#F2A0A0' : status.urgent ? '#F0C36B' : 'rgba(255,255,255,0.5)', margin: '2px 0 0', fontFamily: 'var(--font-sans)' }}>
                      {label}
                    </p>
                  );
                })()}
              </div>
              <GlowPulse color={themeColor} intensity={0.3} style={{ flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={scrollToRsvpSection}
                  style={{
                    display: 'inline-block', padding: '10px 28px', background: themeColor, color: '#FFFFFF',
                    fontWeight: 700, fontSize: '13px', borderRadius: '10px', textDecoration: 'none',
                    fontFamily: 'var(--font-sans)', letterSpacing: '0.3px', whiteSpace: 'nowrap',
                    border: 'none', cursor: 'pointer',
                  }}
                >
                  {hasResponded ? (isRTL ? 'تعديل ردّك' : 'Update Response') : t.rsvp_now}
                </button>
              </GlowPulse>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ═══ FOOTER ═══ */}
        {!event.tier_remove_watermark && (
          <FadeInUp>
            <div style={{
              textAlign: 'center', padding: '48px 24px 32px',
              borderTop: '1px solid rgba(232,226,214,0.4)',
            }}>
              <p style={{ fontSize: '11px', color: '#77736A', fontFamily: 'var(--font-sans)', fontWeight: 300, letterSpacing: '0.05em' }}>
                {isRTL ? 'صُمم بعناية بواسطة' : 'Crafted with elegance by'}{' '}
                <span style={{ fontWeight: 600, color: '#B8944F' }}>Fancy RSVP</span>
              </p>
            </div>
          </FadeInUp>
        )}

        {/* ═══ GLOBAL STYLES ═══ */}
        <style>{`
          @keyframes pulseDot {
            0% { transform: scale(0.85); opacity: 0.5; box-shadow: 0 0 0 0 rgba(215,190,128,0.7); }
            70% { transform: scale(1); opacity: 1; box-shadow: 0 0 0 6px rgba(215,190,128,0); }
            100% { transform: scale(0.85); opacity: 0.5; box-shadow: 0 0 0 0 rgba(215,190,128,0); }
          }
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          @keyframes pulseBar {
            0% { height: 4px; }
            100% { height: 18px; }
          }
          @keyframes shimmer {
            0% { background-position: -200% 0; }
            100% { background-position: 200% 0; }
          }

          /* ─── Mobile Responsive ─── */
          @media (max-width: 768px) {
            .ep-content-grid {
              grid-template-columns: 1fr !important;
              padding: 40px 16px !important;
              gap: 32px !important;
            }
            .ep-hero-title {
              font-size: 32px !important;
            }
            .ep-hero-floral {
              width: 36px !important;
            }
            .ep-details-grid {
              grid-template-columns: 1fr !important;
            }
            .ep-ceremony-grid {
              grid-template-columns: 1fr !important;
            }
            .ep-gallery-grid {
              grid-template-columns: 1fr 1fr !important;
            }
            .ep-floating-cta {
              padding: 12px 16px !important;
              gap: 12px !important;
            }
            .ep-lang-toggle {
              top: 16px !important;
            }
          }

          @media (max-width: 639.98px) {
            .ep-hero-title {
              font-size: 26px !important;
            }
            .ep-hero-floral {
              display: none !important;
            }
            .ep-gallery-grid {
              grid-template-columns: 1fr !important;
            }
          }
        `}</style>
      </div>
    </PageTransition>
  );
}
