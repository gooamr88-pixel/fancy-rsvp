/**
 * Slug utilities for auto-generating unique, URL-safe event links.
 *
 * The PRD requires the platform to "automatically generate a unique event link"
 * upon publication. These helpers turn human text (couple names, title, etc.) into
 * a clean slug and resolve collisions against existing events.
 */

/**
 * Convert arbitrary text into a lowercase, dash-separated, URL-safe slug.
 * Strips diacritics but keeps non-ASCII letters (particularly Arabic) so that
 * Arabic event names produce readable, valid URL slugs.
 * Falls back to the ASCII-only format if the input contains no non-ASCII letters.
 */
const slugify = (text) => {
  const s = String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-') // non-letter/non-digit sequences -> dash
    .replace(/-{2,}/g, '-') // collapse repeats
    .replace(/^-+|-+$/g, ''); // trim leading/trailing dashes
  // Encode non-ASCII for URL safety while keeping readability
  return s;
};

/**
 * Derive a base slug from event details, preferring the most identifying names
 * per template type (e.g. couple names for weddings) and falling back to title.
 */
/* The occasion an organizer picked, mapped to the field that best names the
   event. A template is artwork now, not an occasion, so a birthday on Velvet
   Ring must slug from the celebrant rather than from a couple who do not
   exist. Mirrors `kind` in frontend utils/customEventCategories.js — kept as a
   small local map rather than an import because the backend has no build step
   that could share that module. */
const OCCASION_SLUG_SOURCE = {
  couple: (td) => [td.partner1, td.partner2].filter(Boolean).join('-'),
  honoree: (td) => td.custom_honoree,
  babyShower: (td) => td.custom_baby_name || td.custom_parents,
};
const COUPLE_OCCASIONS = new Set(['wedding', 'engagement', 'vowRenewal']);
const BABY_OCCASIONS = new Set(['babyShower']);

const deriveBaseSlug = ({ title, templateType, templateData = {} } = {}) => {
  const td = templateData || {};
  let source;

  /* The organizer's own answer wins over whatever the template implies. Only
     when they have not answered does the per-template guess below apply. */
  const occasion = td.custom_category;
  if (occasion) {
    const kind = COUPLE_OCCASIONS.has(occasion) ? 'couple'
      : BABY_OCCASIONS.has(occasion) ? 'babyShower'
      : 'honoree';
    const named = OCCASION_SLUG_SOURCE[kind](td);
    if (named) return slugify(named) || slugify(title) || `event-${Date.now().toString(36)}`;
  }

  switch (templateType) {
    case 'wedding':
    case 'engagement':
    // The cinematic couple templates. They store the same partner1/partner2
    // keys, so without them here a Velvet Ring, Door of Joy, Swan Lake or
    // Sealed Letter event silently fell to the `default` arm and took its URL
    // from the title ("our-big-day") instead of the couple ("julian-sophia")
    // — unlike every other wedding template.
    case 'ring':
    case 'bab':
    case 'swans':
    case 'letter':
      if (td.partner1 || td.partner2) {
        source = [td.partner1, td.partner2].filter(Boolean).join('-');
      }
      break;
    case 'birthday':
      source = td.celebrant;
      break;
    case 'gala':
      source = td.honoree;
      break;
    case 'corporate':
      source = td.company;
      break;
    default:
      source = undefined;
  }

  const base = slugify(source) || slugify(title);
  // Guard against empty/degenerate input
  return base || `event-${Date.now().toString(36)}`;
};

/**
 * Return a slug guaranteed not to collide with an existing event.
 * Tries the base, then `base-<year>`, then `base-2`, `base-3`, ...,
 * and finally falls back to a short random suffix.
 *
 * The DB UNIQUE constraint on events.slug remains the source of truth; this only
 * reduces the chance of a collision before insert.
 */
const generateUniqueSlug = async (supabase, base, { year } = {}) => {
  const exists = async (candidate) => {
    const { data } = await supabase
      .from('events')
      .select('id')
      .eq('slug', candidate)
      .limit(1);
    return Array.isArray(data) && data.length > 0;
  };

  if (!(await exists(base))) return base;

  if (year) {
    const withYear = `${base}-${year}`;
    if (!(await exists(withYear))) return withYear;
  }

  for (let i = 2; i <= 100; i++) {
    const candidate = `${base}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }

  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
};

module.exports = { slugify, deriveBaseSlug, generateUniqueSlug };
