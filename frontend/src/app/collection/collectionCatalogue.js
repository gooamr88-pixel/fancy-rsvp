import { TEMPLATES } from '../utils/curatedTemplates';
import { CINEMATIC_KEYS, getCinematicTemplate } from '../components/templates/cinematic/cinematicThemes';
import { occasionPolicyFor, isOccasionAllowed, isOccasionLocked } from '../utils/eventOccasion';
import { CUSTOM_CATEGORY_BY_KEY } from '../utils/customEventCategories';

/* ═══════════════════════════════════════════════════════════════════════════
   THE COLLECTION — one description, read by the gallery, the detail pages,
   the sitemap and the homepage teaser.

   ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────

   Four surfaces are about to name the same four invitations: /collection,
   /collection/[key], the homepage teaser, and sitemap.js. Every one of them
   needs the key, the label, the tagline, a picture and an occasion badge.
   Writing that list four times is how the sitemap ends up advertising a
   template the gallery no longer shows — the exact class of drift that
   landingTokens.js and platformCapabilities.js were each created to stop.

   NOTHING HERE IS TYPED OUT TWICE. The label, tagline and description come
   from `curatedTemplates.js` (the array the create-event wizard renders); the
   occasion badge comes from `occasionPolicyFor` (the function the wizard's
   picker enforces); the opening's first frame comes from the template's own
   `assets.poster` in cinematicThemes.js. This module adds exactly two things
   the product did not already own: which committed photograph represents each
   template in a gallery grid, and one line naming what the guest physically
   does to open it.

   ── WHY THE GALLERY IS CINEMATIC-ONLY ────────────────────────────────────

   `TEMPLATES` carries five entries and this shows four. Custom Canvas is the
   build-your-own template: it has no photography BY DEFINITION — it is the
   organizer's own colours and type — so a plate for it would either be blank
   or be a picture of a thing it is not. It gets a line of its own at the foot
   of the gallery instead, which is honest and still reachable.

   The same filter that TemplatesShowcaseSection applies, for the same reason.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The committed photograph that represents each template in a grid.
 *
 *  THESE ARE THE FILES THE HOMEPAGE ALREADY SHIPS. Not new art: every one is
 *  already in `public/images/landing`, already inside the 320KB budget that
 *  templatesShowcase.test.jsx enforces, and already produced by test/shots
 *  from the real template — so a redesign of a template cannot leave a stale
 *  picture in the gallery any more than it can on the homepage.
 *
 *  `letter` is the SEALED envelope rather than an opened page, and that is the
 *  same deliberate exception the homepage makes: Sealed Letter opens onto the
 *  couple's OWN photograph, so any "opened" shot would be a stock couple
 *  standing in for theirs — precisely the impression the template exists to
 *  avoid giving. */
const PLATE_ART = {
  ring: '/images/landing/hero-ring.webp',
  bab: '/images/landing/hero-bab.webp',
  swans: '/images/landing/hero-swans.webp',
  letter: '/images/landing/cover-letter.webp',
};

/** The photograph that fills the fold when a template ships none of its own.
 *
 *  ── ONLY SEALED LETTER HAS A SLOT HERE, AND IT IS EMPTY ─────────────────
 *
 *  Velvet Ring, Door of Joy and Swan Lake each open onto photography we
 *  supply, so every event on them arrives at the same picture and there is
 *  nothing for this to fill. Sealed Letter arrives at THEIRS: it is the only
 *  template that ships no hero artwork at all, by design.
 *
 *  With `null`, LetterPortraitHero renders a typographic hero on the
 *  template's own paper — names, date, occasion. That is a deliberate,
 *  finished state, not a placeholder and not a grey box, and an organizer who
 *  never uploads anything still has a good invitation. So the gallery is
 *  correct today.
 *
 *  It is simply not what the template is FOR, and the plate beside it says
 *  "your photograph fills the page". Dropping one owned or licensed portrait
 *  into `public/images/collection/` and naming it here is the whole change —
 *  nothing else has to move. It is left empty rather than filled with a stock
 *  couple on purpose: a stand-in bride is exactly the impression this
 *  template exists to avoid giving, which is the same reason the homepage
 *  plate shows the sealed envelope instead of an opened page.
 *
 *  The file must be one we own or have licensed for marketing use. A photo of
 *  real people published on a pricing funnel is not a detail to guess at. */
const LIVE_PHOTO = {
  letter: null,
};

/** What the guest physically does. One line, present tense, no adjectives.
 *
 *  READ BY THE HOMEPAGE BAND TOO (TemplatesShowcaseSection), not written again
 *  there. It held a verbatim second copy of these four sentences until this
 *  module took them over — two copies of the most-read prose in the product,
 *  in the two places a visitor meets it, which is the drift this file exists
 *  to stop rather than to join in with. */
export const ARRIVAL = {
  ring: 'They touch the box. It opens on film.',
  bab: 'They knock three times. It answers.',
  swans: 'They break the seal. The card rises out.',
  /* Short, like the other three. The "your own photograph" claim lives in the
     note beside it on the homepage plate — saying it here as well made that
     plate state the same thing three times over, in the arrival, the note and
     the description. */
  letter: 'They touch the wax. Both flaps fall open.',
};

/** The occasion chips, in the order they are offered.
 *
 *  `key` is a real entry in `customEventCategories.js` — the same catalogue
 *  the organizer picks from in Step 2 — so a chip can never offer an occasion
 *  the product has never heard of. `null` is the "everything" chip. */
export const FILTERS = [
  { key: null, label: 'All' },
  { key: 'wedding', label: 'Wedding' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'celebration', label: 'Celebration' },
];

/**
 * One gallery entry.
 *
 * @typedef {object} CollectionItem
 * @property {string}  key       the template key, e.g. 'swans'
 * @property {string}  label     'Swan Lake'
 * @property {string}  tagline   'Cinematic · Olive & Ivory'
 * @property {string}  desc      the long description, from curatedTemplates
 * @property {string}  arrival   what the guest does to open it
 * @property {string}  art       committed webp for the grid plate
 * @property {string}  poster    the opening's own first frame, for the live view
 * @property {string[]} specs    the template's promises
 * @property {boolean} locked    true when it serves exactly one occasion
 * @property {string}  badge     'Engagement' or 'Any occasion'
 * @property {string}  note      why the badge says what it says
 * @property {string}  occasion  what an event on this template IS, once the
 *                               renderer has clamped it — 'engagement' for
 *                               Velvet Ring, 'wedding' for the rest
 */

/** Every template in the collection, in the picker's own order. */
export const COLLECTION = TEMPLATES
  .filter((t) => CINEMATIC_KEYS.includes(t.key))
  .map((t) => {
    const policy = occasionPolicyFor(t.key);
    const cine = getCinematicTemplate(t.key);
    return {
      key: t.key,
      label: t.label,
      tagline: t.tagline,
      desc: t.desc,
      arrival: ARRIVAL[t.key] || '',
      art: PLATE_ART[t.key],
      /* The opening's own first frame. The live view paints this as a still
         and then mounts the real invitation behind it, so the picture the
         visitor is looking at and the frame the film starts on are the same
         pixels — there is no cut. */
      poster: cine?.assets?.poster || PLATE_ART[t.key],
      specs: t.specs || [],
      locked: policy.locked,
      badge: policy.label,
      note: policy.note,
      /* WHAT THE PAGE WILL ACTUALLY SAY IT IS.
         `occasionPolicyFor` resolves this the same way the renderers do —
         a locked template's one occasion, else the template's default — so
         the words in the demo event can be chosen to match the kicker the
         cover is going to print. Without it, opening Velvet Ring (locked to
         engagement) on the wedding fixture gave an engagement kicker over
         "we are getting married". See DEMO_OCCASION_COPY in demoEvent.mjs. */
      occasion: policy.occasion,
      /** Sealed Letter's fold, or null. See LIVE_PHOTO. */
      livePhoto: LIVE_PHOTO[t.key] || null,
    };
  });

/** Fast lookup, for the detail route. */
export const COLLECTION_BY_KEY = Object.fromEntries(COLLECTION.map((c) => [c.key, c]));

/** The keys the detail route may serve. THE ALLOWLIST.
 *
 *  `/collection/[key]` feeds this straight into `template_type` on a rendered
 *  event, so it is not a convenience — it is the boundary. The route builds
 *  `generateStaticParams` from it and calls `notFound()` on anything else, so
 *  an unknown key is a 404 by construction rather than by a runtime check
 *  somebody can forget to write. */
export const COLLECTION_KEYS = COLLECTION.map((c) => c.key);

const KEY_SET = new Set(COLLECTION_KEYS);

/** True when `key` is a template the collection actually serves.
 *
 *  A Set rather than a property probe on COLLECTION_BY_KEY: an inherited name
 *  like "constructor" or "toString" answers true to `in` and to a bare
 *  `obj[key]` truthiness test, and this function guards a URL segment. */
export const isCollectionKey = (key) => KEY_SET.has(key);

/**
 * The entry for `key`, or null — the ONLY way a caller should turn an
 * untrusted string into a template.
 *
 * `COLLECTION_BY_KEY[key]` is a plain object index, so "constructor" hands
 * back Object.prototype.constructor — a function, and therefore truthy. A
 * route that does `const item = COLLECTION_BY_KEY[key]; if (!item) notFound()`
 * would sail past its own 404 and then render `item.label` as undefined. The
 * two places that read a key out of a URL (the [key] route and the demo
 * stage's ?t=) both go through here instead.
 *
 * @param {string} key
 * @returns {CollectionItem|null}
 */
export const collectionItem = (key) => (isCollectionKey(key) ? COLLECTION_BY_KEY[key] : null);

/**
 * The items to show for an occasion chip, most relevant first.
 *
 * ── WHY THIS SORTS RATHER THAN ONLY FILTERING ────────────────────────────
 *
 * Three of the four templates declare `occasions: 'any'`, so an occasion
 * filter over today's catalogue excludes at most one card — and the
 * "Engagement" chip excludes NONE, because Velvet Ring is for engagements and
 * the other three suit anything. A chip that visibly does nothing when you
 * press it reads as broken, and the fix is not to hide the chip: search
 * intent for these pages really is "wedding invitation", and the catalogue
 * will grow.
 *
 * So a chip does two things. It removes what the product would genuinely
 * refuse — `isOccasionAllowed` is the same guard `resolveOccasion` clamps
 * against, so the gallery can never offer a pairing the event page would
 * override — and it promotes the templates MADE for that occasion above the
 * ones that merely allow it. Pressing "Engagement" moves Velvet Ring to the
 * front under its own badge. Every chip changes the page.
 *
 * @param {string|null} occasion  a key from customEventCategories, or null
 * @returns {CollectionItem[]}
 */
/* Own keys only. `CUSTOM_CATEGORY_BY_KEY[occasion]` is a plain object lookup,
   so "constructor", "toString" and "valueOf" all answer truthily off the
   prototype — and this function's whole first line is a check for "is this a
   real occasion". Without the Set, collectionFor('constructor') sails past the
   guard and returns the three unlocked templates as though the catalogue knew
   the occasion. Same reason isCollectionKey above is a Set. */
const OCCASION_KEYS = new Set(Object.keys(CUSTOM_CATEGORY_BY_KEY));

export function collectionFor(occasion) {
  if (!occasion || !OCCASION_KEYS.has(occasion)) return COLLECTION;

  const allowed = COLLECTION.filter((c) => isOccasionAllowed(c.key, occasion));
  /* A stable partition, not a comparator. `Array.prototype.sort` is stable in
     every engine we target, but a comparator returning 0 for the whole tail
     still invites somebody to add a tie-break later and quietly reorder the
     picker's own order — which is the order these four are meant to be read
     in. Two passes say the intent outright. */
  const madeFor = allowed.filter((c) => isOccasionLocked(c.key));
  const suits = allowed.filter((c) => !isOccasionLocked(c.key));
  return [...madeFor, ...suits];
}

/** How many templates a chip would show. Rendered into the chip itself.
 *
 *  A count is what keeps a lightly-filtering chip honest: "Engagement 4"
 *  beside "All 4" tells the visitor the catalogue is small, which is true,
 *  rather than leaving them to wonder whether the button worked. */
export const countFor = (occasion) => collectionFor(occasion).length;
