/**
 * The real, currently-selectable event templates — the single source of truth
 * shared by the create-event wizard (Stage1_TemplatesSimulator) and the
 * organizer's Visual Template picker in EventSettings.
 *
 * Four templates: the three cinematic ones and the build-your-own canvas.
 *
 * RETIRED — 'wedding' (Royale Wedding) and 'engagement' (Eternal Love).
 * They were the same stationery-envelope page as each other with different
 * copy, and the cinematic pair supersedes them on both occasions: Door of Joy
 * is the wedding, Velvet Ring is the engagement. Their render paths are
 * deliberately still intact everywhere else — INVITATION_PATTERN_BY_TEMPLATE
 * and FULL_PAGE_TEMPLATES in EventPageClient.js, the field-key maps in
 * create-event/page.js, WEDDING_VARIANT_TEMPLATES in templateFamilies.js — so
 * a row still carrying either key renders exactly as it always did. The
 * migration that moves those rows over (supabase/migrations/
 * 20260824000000_retire_wedding_engagement_templates.sql) is a separate,
 * deliberate step; nothing here depends on it having run.
 *
 * Every template shares the same full-page guest experience (see
 * FULL_PAGE_TEMPLATES in EventPageClient.js) with every optional section
 * (story, schedule, venues, accommodation, menu, gift list, FAQ, gallery,
 * dress code, things-to-do, getting-there, invited-to-city) available and
 * independently toggleable — see the "Sections" panel in Stage 2 and
 * enabledSections in HeritageArchPage — plus full custom colour pickers, so
 * every template gets equal design, colour, and content control.
 */

/* ── `preview`: what the picker card SHOWS ────────────────────────────────
   Every card used to render <InvitationCard template={{ pattern: tpl.pattern }}>
   — and no entry in this file has ever had a `pattern` key (the mapping lives
   in TEMPLATE_PREVIEW_PATTERN below, keyed separately). So `pattern` was
   undefined on every card, InvitationCard fell through to its `default:` arm,
   and all five templates drew the SAME generic "Aria & Julian · The Grand
   Ballroom, New York" card, differing only in accent tint. Nothing errored.

   The fix is not to thread the right pattern through — all of them map to
   'serif', so the cards would still be identical. It is to show what the
   guest actually opens on:

     kind: 'poster'  the template's own hero still, full-bleed. This is the
                     first frame of the opening the guest sees, so the card
                     cannot drift from the product.
     kind: 'card'    Custom Canvas has no photography — it IS the organizer's
                     colours and type — so it renders the live builder-driven
                     `custom` InvitationCard instead, and changes as they
                     change it.

   test/templatePicker.test.jsx asserts every entry resolves to something real,
   so a template added without a preview fails loudly rather than silently
   re-introducing the generic card. */

export const TEMPLATES = [
  /* ── The cinematic templates ─────────────────────────────────────────
     All run the same full-page engine, the same organizer-configured
     sections and the same RSVP as everything else; what makes them their own
     templates is the opening and the hero. A guest taps a velvet box, knocks
     on a door, or breaks a wax seal, and the fold is photographic rather than
     stationery. See components/templates/cinematic/.

     `tier` reads "Any occasion" on all of them, and that is the product
     promise, not a slogan: a template is artwork now, and the organizer picks
     wedding / engagement / birthday / anything else in Step 2. Each still has
     a `defaultOccasion` in cinematicThemes.js for events created before the
     picker existed.

     Their presets lead with the template's native palette, because that is
     the colour story the photography was shot in; the alternates are there
     for organizers who want to shift it, not because the first is a
     placeholder. */
  {
    /* `tier` describes the LOOK, never the occasion. What a template may be
       used for is the badge on the card, from occasionPolicyFor() — one
       source, so the card cannot promise what the picker refuses. */
    key: 'ring', label: 'Velvet Ring', tier: 'Cinematic',
    tagline: 'Cinematic · Velvet & Gold',
    desc: 'A velvet ring box on a darkened stage. Your guests touch it, the lid opens on film, and the invitation dissolves out of the light — then the whole page carries gold dust and drifting petals as they scroll.',
    // The video's own poster frame — the exact image a guest lands on.
    preview: { kind: 'poster', src: '/templates/ring/video-poster.jpg', position: '50% 45%', tone: 'dark' },
    presets: [
      { name: 'Velvet Rose', primary: '#8f3c52', secondary: '#d4af6a', accent: '#d4af6a', background: '#2a100b' },
      { name: 'Midnight Gold', primary: '#6b3b5a', secondary: '#e0c07d', accent: '#e0c07d', background: '#1d0f18' },
      { name: 'Deep Garnet', primary: '#7d2438', secondary: '#c9973f', accent: '#c9973f', background: '#25090c' },
    ],
    // No "any occasion" here: this one is engagements only, and the badge on
    // the card says so. See `occasions` in cinematic/cinematicThemes.js.
    specs: ['Cinematic Box Opening', 'Gold Dust & Petals Throughout', 'Made for Engagements', 'Arabic Display Typography', 'Every Section Toggleable'],
    fields: ['Partner Names', 'Proposal Story', 'Gift Registry'],
  },
  {
    key: 'bab', label: 'Door of Joy', tier: 'Cinematic',
    tagline: 'Cinematic · Wood & Lilac',
    desc: 'A carved door your guests knock on three times — it answers, swings open on the light beyond, and doves lift from the garden gate behind your names. Blossom drifts down the page as they read.',
    preview: { kind: 'poster', src: '/templates/bab/door-poster.jpg', position: '50% 40%', tone: 'dark' },
    presets: [
      { name: 'Lilac Bloom', primary: '#7d5694', secondary: '#c9a45c', accent: '#a97fc0', background: '#f6f1e4' },
      { name: 'Olive Courtyard', primary: '#5c6b4a', secondary: '#c9a45c', accent: '#7d8f66', background: '#f4f1e2' },
      { name: 'Rose Stone', primary: '#9c5a63', secondary: '#c9a45c', accent: '#c98a93', background: '#f8f2ea' },
    ],
    specs: ['Knock-to-Enter Opening', 'Sound & Haptics', 'Living Hero Video', 'Any Occasion You Choose', 'Every Section Toggleable'],
    fields: ['Your Occasion', 'Names', 'Your Story', 'Ceremony & Reception', 'Gift Registry'],
  },
  /* ── Swan Lake — the first template offered for two occasions ─────────
     An olive envelope with an ivory swan seal, opened on film; the embossed
     card that rises out of it becomes the hero, colour flooding into the
     engraving. Wedding or engagement — the organizer answers in Step 2 and
     the kicker, tagline, invitation card and Groom's/Bride's Side labels all
     follow that one answer. See cinematic/cinematicThemes.js. */
  {
    key: 'swans', label: 'Swan Lake', tier: 'Cinematic',
    tagline: 'Cinematic · Olive & Ivory',
    desc: 'An olive envelope engraved with foliage and sealed with ivory wax. Your guests break the seal, the flaps fall open, and an embossed card rises out — then the engraving fills with colour and becomes a painted lake with two swans.',
    preview: { kind: 'poster', src: '/templates/swans/envelope-poster.jpg', position: '50% 45%', tone: 'dark' },
    presets: [
      { name: 'Olive & Ivory', primary: '#33492f', secondary: '#6d6f4e', accent: '#5c2331', background: '#f8f4e9' },
      { name: 'Burgundy Calla', primary: '#5c2331', secondary: '#8b9070', accent: '#5c2331', background: '#f6f0e6' },
      { name: 'Still Water', primary: '#2f4550', secondary: '#7d8f7a', accent: '#2f4550', background: '#f4f2ea' },
    ],
    specs: ['Wax-Seal Film Opening', 'Engraving Blooms Into Colour', 'Any Occasion You Choose', 'Arabic Display Typography', 'Every Section Toggleable'],
    fields: ['Your Occasion', 'Names', 'Your Story', 'Ceremony & Reception', 'Gift Registry'],
  },
  /* ── Sealed Letter — the one the couple fills in themselves ───────────
     A blush envelope with a burgundy wax seal that gilds and opens. What is
     behind it is not our photography but THEIRS, full screen, with their own
     words on it. The only template here that ships no hero artwork at all. */
  {
    key: 'letter', label: 'Sealed Letter', tier: 'Cinematic',
    tagline: 'Cinematic · Blush & Wax',
    desc: 'A blush envelope sealed in burgundy wax. Your guests touch it, the seal catches the light and gilds, and both flaps fall open. It is the only template that ships no picture of its own — what lies behind the envelope is yours, and so are the words on it.',
    /* The POSTER, not the sprite sheet. The sheet is 7480px of seventeen
       frames side by side, and `object-fit: cover` in the card's 4:5 box
       would crop a sliver out of the middle of frame eight — 220KB fetched to
       show a smear. The poster is frame 0 cut out of that same sheet, so the
       card still cannot drift from what the guest lands on. */
    preview: { kind: 'poster', src: '/templates/letter/envelope-poster.jpg', position: '50% 46%', tone: 'light' },
    presets: [
      { name: 'Blush & Wax', primary: '#a6705f', secondary: '#c2a05a', accent: '#8c1f2b', background: '#f6efe4' },
      { name: 'Rose Gold', primary: '#b57c6c', secondary: '#ddc185', accent: '#a6705f', background: '#fbf6ec' },
      { name: 'Sage Letter', primary: '#7e8c63', secondary: '#c2a05a', accent: '#5f463f', background: '#f4f1e6' },
    ],
    /* "Sprite" and "Hero" are OUR words, not an organizer's — this card is
       read by someone choosing a wedding invitation, not by a developer. The
       thing worth promising about the sprite is what it buys them: it opens
       instantly, on any phone, because there is no video to load. */
    specs: ['Opens Instantly On Any Phone', 'Your Photograph Fills The Page', 'Your Words, Placed Where You Want', 'Any Occasion You Choose', 'Every Section Toggleable'],
    fields: ['Your Occasion', 'Names', 'Your Photograph', 'Your Story', 'Ceremony & Reception', 'Gift Registry'],
  },
  {
    key: 'custom', label: 'Custom Canvas', tier: 'Build your own',
    tagline: 'Fully editable',
    desc: 'A clean slate for any occasion — wedding, engagement, birthday, baby shower, or something entirely your own. Choose your colors, typography and cover image, then build the page section by section from the same full feature set every curated template shares.',
    preview: { kind: 'card', tone: 'light' },
    presets: [
      { name: 'Clean Linen', primary: '#8B7355', secondary: '#D4C5A9', accent: '#8B7355', background: '#FAF8F5' },
      { name: 'Warm Cream', primary: '#A0845C', secondary: '#E8D5B7', accent: '#A0845C', background: '#FFFCF5' },
      { name: 'Obsidian Slate', primary: '#475569', secondary: '#94A3B8', accent: '#475569', background: '#F8FAFC' },
    ],
    specs: ['Editable Colors & Fonts', 'Custom Cover Image', 'Every Feature, Toggle Anything', 'Full-Page Guest Experience'],
    fields: ['Any Section You Choose'],
  },
];

/**
 * Curated InvitationCard preview pattern per template key.
 *
 * The two retired keys stay listed: this map is also read by the wizard's
 * PreviewModal and by the guest hero, and an event still carrying 'wedding' or
 * 'engagement' must keep printing the stationery card it was created with.
 */
export const TEMPLATE_PREVIEW_PATTERN = {
  // Retired from the picker, still rendered for existing events.
  wedding: 'serif',
  engagement: 'serif',
  // The cinematic pair open on their own hero photography rather than showing
  // a stationery card at the fold, but the card still exists — it is what the
  // "Save the invitation" button captures (see cinematic/HeroCardDownload.js)
  // — so it needs a pattern like every other template.
  ring: 'serif',
  bab: 'serif',
  swans: 'serif',
  letter: 'serif',
  custom: 'custom',
};

/** Template keys retired from the picker but still renderable. @see TEMPLATES */
export const RETIRED_TEMPLATE_KEYS = ['wedding', 'engagement'];

/* ── Palettes ─────────────────────────────────────────────────────────────
   The organizer's Design tab used to offer four bare `<input type="color">`
   boxes and nothing else: no presets, no names, no way back. The wizard shows
   the curated palettes at creation time, so somebody who picked "Velvet Rose"
   on Monday came back on Tuesday to four hex fields and no "Velvet Rose" in
   sight — and every combination in between, including the ones where the
   heading and the paper are the same colour. buildPalette() clamps the worst
   contrast failures but it cannot invent a colour story.

   These two helpers are what let the settings screen offer the same named
   palettes the wizard does, for whatever template the event is actually on. */

/** The curated palettes an event on `templateType` may choose from. */
export function palettesFor(templateType) {
  const own = TEMPLATES.find((t) => t.key === templateType);
  if (own) return own.presets;

  /* A retired template's event keeps its own key until the migration runs, and
     the successor is the same design at a different fold, so its palettes are
     the right ones to offer. */
  const successor = TEMPLATES.find((t) => t.key === RETIRED_TEMPLATE_SUCCESSOR[templateType]);
  if (successor) return successor.presets;

  /* An older style entirely (tuscany, orchid, heritageArch…). There is no
     "its own" set to fall back to, and showing nothing would leave the one
     colour control on the screen empty — so offer every curated palette
     rather than sending them back to raw hex. */
  const seen = new Set();
  return TEMPLATES.flatMap((t) => t.presets).filter((p) => {
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    return true;
  });
}

/**
 * Index of the palette matching `colors`, or -1.
 *
 * Compared case-insensitively on the three values that actually reach
 * buildPalette. `accent` is left out on purpose: it is derived from `primary`
 * in every preset here and in the wizard's colour sync, so including it would
 * make a saved event that predates one of those defaults look "custom" when it
 * is sitting on an exact palette.
 */
export function matchPaletteIndex(presets, colors) {
  if (!colors) return -1;
  const eq = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();
  return presets.findIndex((p) => eq(p.primary, colors.primary)
    && eq(p.secondary, colors.secondary)
    && eq(p.background, colors.background));
}

/**
 * Where a retired template's events are migrated to. Read by the SQL
 * migration's comment and by the drift test, so the two can never disagree
 * about which replacement inherits which occasion.
 */
export const RETIRED_TEMPLATE_SUCCESSOR = {
  wedding: 'bab',      // Door of Joy — the cinematic wedding, same field set
  engagement: 'ring',  // Velvet Ring — the cinematic engagement, same field set
};
