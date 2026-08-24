// Named import, not the default — the same reason revealAssets.js gives: this
// module is read by both a server component (the event page, for the preload
// below) and client ones, and `preload` is a named export in every react-dom
// build while reaching it through the default export is not.
import { preload } from 'react-dom';
import {
  CUSTOM_CATEGORY_BY_KEY, occasionKicker, occasionLatin, occasionTagline,
} from '../../../utils/customEventCategories';

/* ═══════════════════════════════════════════════════════════════
   The cinematic templates, as data.

   Everything that differs between Velvet Ring, Door of Joy, Swan Lake and
   Sealed Letter lives here: the asset paths, the CSS custom properties their
   shared stylesheet reads, the type pairing, the ambient-FX recipe, and the
   copy their openings and heroes need. cinematic.css holds the composition;
   this holds the identity. Adding a fifth should mean adding an entry here
   plus one opening component — not a new branch in five files.

   That claim was false once, and it is worth saying how. Every dispatch site
   used to be `opening === 'velvetBox' ? A : B`, so template #3 would silently
   have rendered Door of Joy's cover. They are all keyed maps now, asserted
   from CINEMATIC_KEYS by test/swanLakeTemplate.test.jsx — which is why adding
   #4 needed no new branch anywhere.

   ── A template is a LOOK, not an occasion ─────────────────────────────────
   Each entry once carried `occasion: 'engagement' | 'wedding'`, and that key
   was load-bearing: it decided the cover's kicker, the hero's tagline, the
   invitation card's wording and the guest list's side labels. An organizer
   who wanted the knocking-door film for a birthday could not have it.

   Now each carries `defaultOccasion` instead, which is consulted only when
   the organizer has not chosen one. All 25 occasions in
   utils/customEventCategories.js work on all of these, and the per-occasion
   wording comes from that catalogue rather than from here — otherwise every
   new template would owe 50 more strings.

   The palette keys mirror what src/app/styles/cinematic.css reads. Keep the
   two in step: an unset property there falls back to nothing, which reads as
   a transparent or black element rather than an error.
   ═══════════════════════════════════════════════════════════════ */

export const CINEMATIC_TEMPLATES = {
  /* ── Velvet Ring ──────────────────────────────────────────────────────
     A photographic velvet box on a dark stage. Tap it and it opens onto the
     ring. Warm reds and gold; every surface below the hero inherits the same
     deep velvet ground, which buildPalette resolves as a dark theme. */
  ring: {
    key: 'ring',
    defaultOccasion: 'engagement',
    /* LOCKED, and the only one that is. Every frame of this template is a
       ring box opening onto a ring — there is no reading of that artwork
       under which it is a birthday or a baby shower, and offering it would be
       the product promising something it cannot deliver.

       `occasions: 'any'` on the others is the opposite promise, and both are
       stated on the template card by occasionPolicyFor() so the picker can
       never offer what the card refuses. See utils/eventOccasion.js. */
    occasions: ['engagement'],
    opening: 'velvetBox',
    hero: 'velvetRing',

    assets: {
      poster: '/templates/ring/video-poster.jpg',
      video: '/templates/ring/box-video.mp4',
      revealed: '/templates/ring/box-open.jpg',
    },

    /* The frame at which the lid is fully back and the stone is lit. Read off
       the footage, not guessed — the reveal is timed to the video's own clock
       so a slow decode delays the cut rather than desynchronising it. */
    revealAtSeconds: 4.35,

    // Seeds buildPalette() for every section below the hero.
    colors: {
      primary: '#8f3c52',
      secondary: '#d4af6a',
      accent: '#d4af6a',
      background: '#2a100b',
    },

    cssVars: {
      '--cine-deep': '#2a100b',
      '--cine-mid': '#4a1a10',
      '--cine-hi': '#6e2c1d',
      '--cine-gold': '#d4af6a',
      '--cine-gold-hi': '#ffe9b0',
      '--cine-gold-dp': '#9d6f2c',
      /* Channel triplets for the same three colours, because several rules
         need them at partial alpha. `color-mix()` would be the tidy way and is
         the wrong one here: it is unsupported below Safari 16.2 / Chrome 111,
         and an unsupported function invalidates the WHOLE declaration. The
         Velvet Ring hero scrim is one such declaration — losing it drops the
         couple's names onto bare photography with no contrast at all, on
         exactly the older handsets least able to cope. `rgba(var(--x-rgb), a)`
         has no such cliff. Keep these in step with the hexes above. */
      '--cine-deep-rgb': '42, 16, 11',
      '--cine-gold-rgb': '212, 175, 106',
      '--cine-gold-hi-rgb': '255, 233, 176',
      '--cine-accent': '#e79aac',
      '--cine-blush': '#eec3c9',
      '--cine-text': '#f9e7ec',
      '--cine-display': 'var(--font-aref), "Aref Ruqaa", serif',
      '--cine-serif': 'var(--font-amiri), "Amiri", serif',
      '--cine-label': 'var(--font-messiri), "El Messiri", sans-serif',
      '--cine-body': 'var(--font-tajawal), "Tajawal", system-ui, sans-serif',
      '--cine-latin': 'var(--font-cormorant), "Cormorant Garamond", serif',
    },

    /* Gold dust and rose petals over a velvet room, plus a sparkle that
       follows the pointer. `trail` is suppressed over content surfaces by the
       pool itself — see AmbientFx. */
    fx: { dust: true, petals: true, trail: true, petalEveryMs: 3800 },

    /* Only the occasion-INDEPENDENT lines live here now. `kicker` and `latin`
       come from the chosen occasion (occasionKicker / occasionLatin); what is
       left describes the physical act of opening this particular cover, which
       is the same whatever the celebration is. */
    copy: {
      en: { hint: 'Touch the box', loading: 'Loading…', preparing: 'Preparing the scene…', scroll: 'Scroll down' },
      ar: { hint: 'المس الصندوق', loading: 'جارٍ التحميل…', preparing: 'يجهَّز المشهد…', scroll: 'مرّر للأسفل' },
    },
  },

  /* ── Door of Joy — wedding ────────────────────────────────────────────
     A carved door with purple blossom. Knock three times and it opens onto
     the light. Warm wood, cream stone and lilac; a light theme below. */
  bab: {
    key: 'bab',
    /* A default, not a restriction: a carved door opening onto light is as
       true of a graduation or a baby shower as of a wedding. */
    defaultOccasion: 'wedding',
    occasions: 'any',
    opening: 'knockDoor',
    hero: 'doorOfJoy',

    assets: {
      poster: '/templates/bab/door-poster.jpg',
      video: '/templates/bab/door.mp4',
      heroPoster: '/templates/bab/hero-poster.jpg',
      heroVideo: '/templates/bab/hero.mp4',
      // Absent from the source folder. useOpeningSfx falls through to its
      // synthesiser when a fetch or decode fails, so the opening is never
      // silent; dropping real recordings in at these paths upgrades it with
      // no code change.
      knockSfx: '/templates/bab/knock.wav',
      doorSfx: '/templates/bab/door-open.m4a',
    },

    /* Both leaves stay shut for the first beat of the footage. Firing the
       hinge sound on play() instead would creak at a closed door. */
    doorSfxAtSeconds: 1.3,
    knocksRequired: 3,

    colors: {
      primary: '#7d5694',
      secondary: '#c9a45c',
      accent: '#a97fc0',
      background: '#f6f1e4',
    },

    cssVars: {
      '--cine-deep': '#3d3226',
      '--cine-mid': '#5a3a20',
      '--cine-hi': '#7a4f2c',
      '--cine-gold': '#c9a45c',
      '--cine-gold-hi': '#f0e0b4',
      '--cine-gold-dp': '#96763c',
      // See the note on Velvet Ring's triplets above.
      '--cine-deep-rgb': '61, 50, 38',
      '--cine-gold-rgb': '201, 164, 92',
      '--cine-gold-hi-rgb': '240, 224, 180',
      '--cine-accent': '#a97fc0',
      '--cine-blush': '#d8c2e6',
      '--cine-text': '#4c3a28',
      '--cine-display': 'var(--font-aref), "Aref Ruqaa", serif',
      '--cine-serif': 'var(--font-amiri), "Amiri", serif',
      '--cine-label': 'var(--font-reem), "Reem Kufi", sans-serif',
      '--cine-body': 'var(--font-tajawal), "Tajawal", system-ui, sans-serif',
      '--cine-latin': 'var(--font-cormorant), "Cormorant Garamond", serif',
    },

    // No pointer trail here: the door template's page is light and the
    // sparkle reads as dirt on a cream ground rather than as light.
    fx: { dust: false, petals: true, trail: false, petalEveryMs: 3200, petalGlyphs: ['❀', '✿', '❁', '✽'] },

    /* `sub` is this template's OWN voice, not occasion copy — it is about the
       door, which is the same door whatever is being celebrated. It is used
       only when the chosen occasion is this template's defaultOccasion; any
       other occasion takes the catalogue's own tagline, so a birthday behind
       this door is not told it has opened the door to its joy. Velvet Ring
       and Swan Lake carry no `sub`: theirs said exactly what the catalogue
       already says, and two copies of one sentence is one too many. */
    copy: {
      en: { hint: 'Knock three times to open', scroll: 'Scroll down', sub: 'We have opened the door to our joy — and it calls to you' },
      ar: { hint: 'دُقّوا على الباب ثلاث دقّاتٍ ليُفتح', scroll: 'مرّر للأسفل', sub: 'فتحنا باب فرحتنا… وطارت البشائر تدعوكم' },
    },
  },

  /* ── Swan Lake — wedding OR engagement ────────────────────────────────
     An olive envelope, engraved with foliage and closed with an ivory wax
     seal of two swans. It unseals on film, the four flaps fall open, and an
     embossed ivory card rises out of it.

     What the card carries is the hero: a painted swan lake with calla lilies
     and orchids. It arrives EMBOSSED — the same ivory relief the video ended
     on — and then the colour floods into it. See SwanLakeHero: one photograph
     under a filter, not two assets, so the two states can never drift apart.

     The first template here that serves two occasions. Every other one is
     fixed to a single one; this one asks the organizer in Step 2 and reads
     the answer through getCinematicOccasion() below. */
  swans: {
    key: 'swans',
    // A default, not a restriction — a sealed envelope suits any celebration.
    defaultOccasion: 'wedding',
    occasions: 'any',
    opening: 'waxEnvelope',
    hero: 'swanLake',

    assets: {
      poster: '/templates/swans/envelope-poster.jpg',
      video: '/templates/swans/envelope.mp4',
      // The video's own last frame, so the plate the opening dissolves FROM
      // and the state the hero arrives IN are the same picture.
      revealed: '/templates/swans/card-embossed.jpg',
      /* The hero photograph. Preloaded at LOW priority (see
         preloadCinematicAssets): the whole effect is that the embossed card
         becomes this picture, so a hero still arriving late doesn't merely pop
         — it breaks the one illusion this template is built on. The opening
         runs ~5s, which is the budget it has to arrive in. */
      lake: '/templates/swans/lake.jpg',
      /* No separate orchid cut-out. The source page used one as a section
         divider; ours are drawn by the shared sections, and the hero's own
         orchids are painted into `lake` — so shipping it meant 151KB in
         public/ that nothing ever requested. */
    },

    /* Read off the footage frame by frame, not guessed. The seal lifts at
       ~1.5s, the flaps fall open by ~3s, the card is fully risen and legible
       at frame 135 (4.50s) and settled by 145 (4.83s). 4.9 leaves ~1.4s of
       the 6.3s clip in hand, so the cross-fade lands mid-shot rather than on
       a frozen last frame. */
    revealAtSeconds: 4.9,

    // Ivory ground — buildPalette resolves this as a LIGHT theme, like Door
    // of Joy and unlike Velvet Ring.
    colors: {
      primary: '#33492f',    // forest — headings
      secondary: '#6d6f4e',  // olive — eyebrow labels, dividers
      accent: '#5c2331',     // burgundy, off the hanging calla lilies
      background: '#f8f4e9', // the card's own ivory
    },

    cssVars: {
      // The envelope, three depths — this is what the opening sits on.
      '--cine-deep': '#3a3826',
      '--cine-mid': '#504e37',
      '--cine-hi': '#67654a',
      /* The "metal" here is the warm stone of the gazebo and the bridge in
         the painting, not gold — a yellow metal on an olive-and-ivory page
         reads as a different template's palette leaking in. */
      '--cine-gold': '#a98a5c',
      '--cine-gold-hi': '#e8dcc0',
      '--cine-gold-dp': '#7d6540',
      // See the note on Velvet Ring's triplets: rgba(var(--x-rgb), a) rather
      // than color-mix(), which invalidates the whole declaration below
      // Safari 16.2 / Chrome 111.
      '--cine-deep-rgb': '58, 56, 38',
      '--cine-gold-rgb': '169, 138, 92',
      '--cine-gold-hi-rgb': '232, 220, 192',
      '--cine-accent': '#5c2331',
      '--cine-blush': '#8b9070',
      '--cine-text': '#f4f0e0',
      /* Amiri + Aref Ruqaa, the pairing the artwork was set in. Both are
         already self-hosted through layout.js. Never reach for a remote font
         host here — a blackholed one hangs the whole invitation, which is why
         the residue test in cinematicTemplates.test.jsx scans these files for
         that hostname and why it is not spelled out in this comment. */
      '--cine-display': 'var(--font-aref), "Aref Ruqaa", serif',
      '--cine-serif': 'var(--font-amiri), "Amiri", serif',
      '--cine-label': 'var(--font-messiri), "El Messiri", sans-serif',
      '--cine-body': 'var(--font-tajawal), "Tajawal", system-ui, sans-serif',
      '--cine-latin': 'var(--font-cormorant), "Cormorant Garamond", serif',
    },

    /* Drifting blooms only. No gold dust and no pointer trail, for the same
       reason Door of Joy has neither: the page below is ivory, and a sparkle
       on a pale ground reads as dirt rather than as light. */
    /* Glyphs restricted to the same Dingbats block Door of Joy uses. '⚘'
       (U+2698 FLOWER) reads as a flower in a font that has it and as tofu in
       one that does not, and this drifts across a guest's whole page. */
    fx: { dust: false, petals: true, trail: false, petalEveryMs: 3600, petalGlyphs: ['❀', '✿', '❁'] },

    /* `sub` is this template's own line for its own occasion — see the note on
       Door of Joy's. Any other occasion takes the catalogue's wording. */
    copy: {
      en: { hint: 'Touch to break the seal', loading: 'Loading…', preparing: 'Preparing the scene…', scroll: 'Scroll down', sub: 'invite you to share the joy of their wedding' },
      ar: { hint: 'المس الختم لفتح الدعوة', loading: 'جارٍ التحميل…', preparing: 'يجهَّز المشهد…', scroll: 'مرّر للأسفل', sub: 'يتشرّفان بدعوتكم لمشاركتهما فرحة الزفاف' },
    },
  },

  /* ── Sealed Letter — the one that is not a video ───────────────────────
     A blush envelope closed with a burgundy wax seal. Touch it: the seal
     catches the light, gilds, and the flaps fall open.

     ── Why a sprite and not a film ──────────────────────────────────────
     Every other opening here streams an .mp4, and openingSafety.js exists
     almost entirely to survive the ways that can fail — a refused autoplay, a
     decode that stalls without firing an event, a device in low-power mode.
     This one is 17 frames on a single 220KB JPEG, stepped by CSS. There is no
     decoder to stall and no autoplay policy to be refused by: once the image
     has loaded, the animation cannot fail. That makes it the right cover for
     the slowest handsets on the worst connections, and it is worth having one
     of those in the catalogue.

     ── The hero is the ORGANIZER'S, and ONLY the organizer's ────────────
     The other three heroes are photography we shipped, so every event using
     them opens on the same picture. This one ships NO hero artwork at all:
     the couple's own photograph fills the fold, and their own words sit on
     it wherever they choose to put them.

     It shipped once with a carved ivory frame and a stock illustrated couple
     printed into it, the photograph fitted into the frame's panel. That was
     wrong in the way that matters: the invitation's biggest image was still
     somebody else's, and the couple's was a smaller inset inside it. The
     frame artwork is gone (its illustration lives on at a postage stamp on
     the marketing page, which is the size that claim deserves). See
     LetterPortraitHero. */
  letter: {
    key: 'letter',
    // A default, not a restriction — a sealed letter suits any celebration.
    defaultOccasion: 'wedding',
    occasions: 'any',
    opening: 'sealedLetter',
    hero: 'letterPortrait',

    assets: {
      /* Frame 0, cut out of the sheet below — the same picture, 22KB instead
         of 220. It earns its place three times over: the opening paints it
         UNDER the sprite layer so the guest sees a sealed envelope
         immediately rather than a blank cream screen while 220KB arrives; the
         picker card shows it (`object-fit: cover` on the sheet itself would
         crop a smear out of the middle of frame eight); and it is what the
         landing page photographs. Because it is cut from the sheet rather
         than shot separately, none of those three can drift from what the
         guest actually lands on. */
      poster: '/templates/letter/envelope-poster.jpg',
      /* 7480×782: SEVENTEEN frames of 440×782, laid out horizontally. Frame 0
         is the sealed envelope with no glow; frame 16 has both flaps open.
         440/782 is 9:16, which is why the cover can be sized to the viewport
         with `aspect-ratio` and never letterbox on a phone. */
      sprite: '/templates/letter/envelope-sprite.jpg',
      /* NO hero artwork. Deliberately — the fold is the organizer's own
         photograph, full bleed, and anything we shipped here would be a
         second picture competing with theirs. An event with no photograph
         yet gets a typographic hero built from the palette below, not a
         placeholder and not a stock couple. */
      /* No sealSfx ships. useOpeningSfx falls through to its synthesiser when
         the URL is missing, so the seal is never silent; dropping a real
         recording in at a path here upgrades it with no code change. */
    },

    /* The sprite's own clock. `spriteFrames` drives BOTH the background-size
       (frames × 100%) and the step count (frames − 1) — see the note on
       .cine-letter__anim in cinematic.css. Deriving both from one number is
       what stops a re-cut sheet from producing an animation that ends one
       frame early and freezes on a half-open envelope. */
    spriteFrames: 17,
    spriteDurationMs: 1150,
    /* When the cross-fade to the invitation begins, measured from the tap.
       Deliberately BEFORE spriteDurationMs: the flaps are mid-swing at 950ms
       and the dark gap between them is opening, so starting the dissolve here
       covers that gap with the hero instead of holding on it. */
    revealAtMs: 950,

    // Cream ground — buildPalette resolves this as a LIGHT theme, like Door of
    // Joy and Swan Lake and unlike Velvet Ring.
    colors: {
      primary: '#a6705f',    // deep rose — headings
      secondary: '#c2a05a',  // gold — eyebrow labels, dividers
      accent: '#8c1f2b',     // the wax
      background: '#f6efe4', // the source's own cream
    },

    cssVars: {
      // The envelope, three depths. Blush paper rather than a dark stage —
      // this is the only cover here that is lighter than the page below it.
      '--cine-deep': '#a6705f',
      '--cine-mid': '#c39a8e',
      '--cine-hi': '#f3e3dd',
      '--cine-gold': '#c2a05a',
      '--cine-gold-hi': '#ddc185',
      '--cine-gold-dp': '#997b38',
      // See the note on Velvet Ring's triplets: rgba(var(--x-rgb), a) rather
      // than color-mix(), which invalidates the whole declaration below
      // Safari 16.2 / Chrome 111.
      '--cine-deep-rgb': '166, 112, 95',
      '--cine-gold-rgb': '194, 160, 90',
      '--cine-gold-hi-rgb': '221, 193, 133',
      '--cine-accent': '#8c1f2b',
      '--cine-blush': '#f3e3dd',
      '--cine-text': '#5f463f',
      /* The wax. This template's own, and the only one that needs it by name:
         it is what the cover's tap hint is set in. */
      '--cine-wax': '#8c1f2b',
      /* The ivory the hero's type sits on, as CHANNELS only — every rule that
         uses it wants a partial alpha (the halo behind the names, the caption
         plate), so a hex form would be declared and never read. `--cine-wax-hi`
         and `--cine-ivory` were both here for exactly that reason and both
         were dead; the scope-aware var test in cinematicTemplates.test.jsx
         catches the opposite mistake, not this one. */
      '--cine-ivory-rgb': '248, 242, 233',
      /* The hero scrim's own dark, and it has to be its OWN.
         `--cine-deep` on the other three templates is a genuinely dark ground
         (#2a100b, #3d3226, #3a3826) and the obvious thing was to reuse it
         here — but this template's `--cine-deep` is #a6705f, a light rose,
         because it describes a BLUSH ENVELOPE. Building the scrim from it
         produced a pale wash that darkened nothing, and ivory names over a lit
         chandelier disappeared completely. Caught in the screenshot pass;
         invisible in jsdom and invisible over any dark photograph. */
      '--cine-lhero-shade-rgb': '46, 24, 18',
      /* El Messiri for display here, not Aref Ruqaa: this artwork is a
         plaster relief with clean geometric scrollwork, and Aref Ruqaa's
         calligraphic stroke fights it. Both are already self-hosted through
         layout.js — never reach for a remote font host, which is why the
         residue test scans these files for one. */
      '--cine-display': 'var(--font-messiri), "El Messiri", serif',
      '--cine-serif': 'var(--font-amiri), "Amiri", serif',
      '--cine-label': 'var(--font-messiri), "El Messiri", sans-serif',
      '--cine-body': 'var(--font-tajawal), "Tajawal", system-ui, sans-serif',
      '--cine-latin': 'var(--font-cormorant), "Cormorant Garamond", serif',
    },

    /* Falling petals only. No gold dust and no pointer trail, for the same
       reason Door of Joy and Swan Lake have neither: the page below is cream,
       and a sparkle on a pale ground reads as dirt rather than as light.
       Glyphs restricted to the Dingbats block the other two use — '⚘'
       (U+2698) renders as tofu in fonts that lack it, and this drifts across
       a guest's whole page. */
    fx: { dust: false, petals: true, trail: false, petalEveryMs: 3400, petalGlyphs: ['❀', '✿', '❁'] },

    /* No `sub`. The source page's line said what the occasion catalogue
       already says, and two copies of one sentence is one too many — see the
       note on Door of Joy's, which is kept only because it is about the door
       itself. */
    copy: {
      en: { hint: 'Touch to open the letter', loading: 'Loading…', preparing: 'Preparing the scene…', scroll: 'Scroll down' },
      ar: { hint: 'المس الرسالة لفتحها', loading: 'جارٍ التحميل…', preparing: 'يجهَّز المشهد…', scroll: 'مرّر للأسفل' },
    },
  },
};

/**
 * Where the organizer's words sit on their photograph.
 *
 * The photograph is full bleed, so unlike the other heroes there is no fixed
 * safe area — the sky might be at the top of one couple's picture and their
 * faces at the top of another's. This is the control that answers that, and
 * the scrim follows it (see `.cine-lhero` in cinematic.css): the gradient is
 * drawn from whichever edge the type is anchored to, so the words always have
 * ground under them and the rest of the picture stays uncovered.
 *
 * Read by the hero AND the editor's live preview, so what an organizer
 * positions is what a guest gets.
 */
export const LETTER_TEXT_POS = {
  top: 'flex-start',
  center: 'center',
  bottom: 'flex-end',
};
/** Bottom, because that is where a caption sits on a photograph by default. */
export const LETTER_TEXT_POS_DEFAULT = 'bottom';

/** The shade the hero's scrim is built from. See the cssVars note above. */
const LETTER_SHADE = CINEMATIC_TEMPLATES.letter.cssVars['--cine-lhero-shade-rgb'];

/**
 * The hero scrim, per text position, as finished CSS gradients.
 *
 * These exist in TWO places by necessity — here for the editor's live preview,
 * and in cinematic.css for the page — because a stylesheet cannot read a
 * JavaScript constant. That duplication has already produced one real bug: the
 * scrim's colour was changed in the CSS (from the blush `--cine-deep` to a
 * genuinely dark shade) and the preview kept painting the old pale wash, so an
 * organizer would have positioned their words against one scrim and their
 * guests seen another.
 *
 * What makes it safe now is not discipline, it is a test:
 * sealedLetterTemplate.test.jsx parses the three rules out of cinematic.css,
 * substitutes the custom property, and compares them to these strings
 * character for character. Change one and the other fails.
 */
export const LETTER_SCRIM = {
  bottom: `linear-gradient(180deg, rgba(${LETTER_SHADE}, 0.34) 0%, rgba(${LETTER_SHADE}, 0.12) 24%, rgba(${LETTER_SHADE}, 0.52) 58%, rgba(${LETTER_SHADE}, 0.84) 84%, rgba(${LETTER_SHADE}, 0.92) 100%)`,
  top: `linear-gradient(180deg, rgba(${LETTER_SHADE}, 0.90) 0%, rgba(${LETTER_SHADE}, 0.70) 24%, rgba(${LETTER_SHADE}, 0.22) 54%, rgba(${LETTER_SHADE}, 0.36) 80%, rgba(${LETTER_SHADE}, 0.76) 100%)`,
  center: `radial-gradient(ellipse 100% 48% at 50% 46%, rgba(${LETTER_SHADE}, 0.80), rgba(${LETTER_SHADE}, 0) 76%), linear-gradient(180deg, rgba(${LETTER_SHADE}, 0.38) 0%, rgba(${LETTER_SHADE}, 0.14) 38%, rgba(${LETTER_SHADE}, 0.70) 100%)`,
};

/**
 * What the organizer's focal-point choice means, as an `object-position`.
 *
 * Lives here rather than in the hero because the EDITOR needs it too: its live
 * preview has to crop the way the guest page crops, and a second copy of these
 * three values is a preview that can quietly start lying. A phone's fold is a
 * tall portrait and most photographs are not, so this is what decides whether
 * the couple's faces or their knees survive the crop.
 */
export const LETTER_FOCUS = {
  top: '50% 18%',
  center: '50% 50%',
  bottom: '50% 82%',
};
/** The fallback when `letter_hero_focus` is absent or unrecognised. */
export const LETTER_FOCUS_DEFAULT = 'center';

/** The template keys that render a cinematic opening instead of the envelope. */
export const CINEMATIC_KEYS = Object.keys(CINEMATIC_TEMPLATES);

/** Definition for a template key, or null for every non-cinematic template. */
export function getCinematicTemplate(templateType) {
  return CINEMATIC_TEMPLATES[templateType] || null;
}

/**
 * Which occasion this event is actually for.
 *
 * The organizer's own answer wins; the template only supplies the default.
 * That ordering is the whole point of the change that introduced it — a
 * template used to BE an occasion, so the artwork and the celebration were
 * one decision and a birthday could not use the velvet box.
 *
 * The default is what makes this safe to deploy: every event created before
 * the picker existed has no `custom_category`, and falls through to exactly
 * the occasion its template always meant.
 *
 * @param {object|null} template  a CINEMATIC_TEMPLATES entry
 * @param {object} [templateData] the event's template_data
 * @returns {string|null}
 */
export function getCinematicOccasion(template, templateData) {
  if (!template) return null;
  /* Two guards, and both must match utils/eventOccasion.js's
     resolveOccasion() exactly. The two resolve the same event from different
     places — this one where the template object is already in hand — so any
     difference between them is a page whose COVER and whose SECTIONS disagree
     about what is being celebrated.

     1. a key the catalogue has never heard of, and
     2. a key this template is not for. Velvet Ring declares
        `occasions: ['engagement']`; without this check a row carrying
        'graduation' opened on a graduation kicker over a ring box while every
        section below it correctly said engagement.

     Not imported from eventOccasion.js because that module imports this one —
     the policy lives on the template, so the check is one line either way. */
  const chosen = templateData?.custom_category;
  const allowed = template.occasions;
  const permitted = !allowed || allowed === 'any' || allowed.includes(chosen);
  if (chosen && CUSTOM_CATEGORY_BY_KEY[chosen] && permitted) return chosen;
  return template.defaultOccasion || null;
}

/**
 * The copy an opening or hero should render, for a given occasion.
 *
 * `kicker` and `latin` come from the OCCASION catalogue rather than from the
 * template, so all 25 occasions work on all 3 templates without anybody
 * writing 150 strings. What the template still owns is the wording about its
 * own cover (the tap hint, the loading line) and one optional `sub`.
 *
 * `sub` is used ONLY on the template's own default occasion. Door of Joy's
 * "We have opened the door to our joy" is right for the wedding it was
 * written for and wrong for a baby shower behind the same door; every other
 * occasion takes the catalogue's tagline instead.
 */
export function getCinematicCopy(template, { isRTL = false, occasion = null } = {}) {
  const lang = isRTL ? 'ar' : 'en';
  const base = template?.copy?.[lang] || {};
  /* Same two guards as getCinematicOccasion, applied again here rather than
     trusted from the caller. An occasion the catalogue does not know produces
     no kicker at all — a blank line above the names looks broken rather than
     plain — and an occasion this template is not for would put a graduation
     kicker over a ring box. Callers already resolve; this makes the function
     impossible to misuse rather than merely unlikely to be. */
  const allowedHere = template?.occasions;
  const permitted = !allowedHere || allowedHere === 'any' || allowedHere.includes(occasion);
  const asked = occasion && CUSTOM_CATEGORY_BY_KEY[occasion] && permitted ? occasion : null;
  const resolved = asked || template?.defaultOccasion;

  const kicker = occasionKicker(resolved, isRTL);
  const latin = occasionLatin(resolved);
  /* The template's own line is used ONLY on its own occasion. The trailing
     fallback you might expect here — `|| base.sub` — is deliberately absent:
     with it, a baby shower behind Door of Joy would be told "We have opened
     the door to our joy", which is the exact class of mistake this whole
     change exists to remove. Empty is correct; the caller then falls back to
     the occasion's own wording. */
  const isOwnOccasion = resolved === template?.defaultOccasion;
  const sub = (isOwnOccasion && base.sub) || occasionTagline(resolved, isRTL) || '';

  /* `sub` is set UNCONDITIONALLY, even to ''. Spreading it only when truthy
     looks tidier and is wrong: an occasion with no tagline of its own (every
     'honoree' kind) computed '' and so left `base.sub` standing — which is
     how a baby shower behind Door of Joy was still told "We have opened the
     door to our joy". Empty is a real answer here; the caller falls back to
     the milestone the organizer typed.

     `kicker` and `latin` stay conditional: they have no base value to shadow. */
  return {
    ...base,
    ...(kicker ? { kicker } : {}),
    ...(latin ? { latin } : {}),
    sub,
  };
}

/**
 * Poster frames worth having in cache before the opening paints, requested
 * from the server render so the <link rel=preload> tags leave with the
 * document rather than waiting for the overlay to mount.
 *
 * Stills only. The videos are megabytes and are what the opening streams for
 * itself — preloading those here would compete for bandwidth with the very
 * poster the guest is looking at while they load.
 *
 * Sealed Letter is the exception that proves the rule: its `sprite` IS the
 * animation — a 220KB JPEG, not a stream — so it is not merely worth
 * preloading, it is the asset the tap gate waits on. It is fetched at high
 * priority alongside the poster rather than behind the hero artwork.
 *
 * The mirror of preloadRevealAssets() (components/guest/revealAssets.js), for
 * the templates that open on a box or a door instead of an envelope. Both are
 * called during render, never from an effect: React hoists them into <head>,
 * and on the server that only happens if it is asked during the render pass.
 */
export function preloadCinematicAssets(templateType) {
  const tpl = getCinematicTemplate(templateType);
  if (!tpl) return;
  /* Priority is stated per asset rather than inferred from position, because
     "urgent" is not always just the first one. The cover's first frame is
     urgent everywhere; for Sealed Letter the SPRITE is urgent too, since the
     tap gate stays shut until it decodes — a guest looking at a poster whose
     sheet is still queued behind the hero artwork is a cover that cannot be
     opened. Everything else is wanted a beat later and must not delay those. */
  const urgent = [tpl.assets.poster, tpl.assets.sprite];
  const later = [tpl.assets.revealed, tpl.assets.heroPoster, tpl.assets.lake, tpl.assets.frame];

  urgent.filter(Boolean).forEach((href) => preload(href, { as: 'image', fetchPriority: 'high' }));
  later.filter(Boolean).forEach((href) => preload(href, { as: 'image', fetchPriority: 'low' }));
}
