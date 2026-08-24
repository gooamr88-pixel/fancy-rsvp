const { test } = require('node:test');
const assert = require('node:assert/strict');
const { slugify, deriveBaseSlug, generateUniqueSlug } = require('../utils/slugHelper');

test('slugify lowercases, strips accents, and dashes non-alphanumerics', () => {
  assert.equal(slugify('Café René!'), 'cafe-rene');
  assert.equal(slugify('  Multiple   Spaces  '), 'multiple-spaces');
  assert.equal(slugify('a--b__c'), 'a-b-c');
});

test('slugify trims leading/trailing dashes and handles empties', () => {
  assert.equal(slugify('---hi---'), 'hi');
  assert.equal(slugify(''), '');
  assert.equal(slugify(null), '');
});

test('deriveBaseSlug prefers couple names for weddings', () => {
  const slug = deriveBaseSlug({ templateType: 'wedding', templateData: { partner1: 'Julian', partner2: 'Sophia' }, title: 'Our Big Day' });
  assert.equal(slug, 'julian-sophia');
});

test('deriveBaseSlug prefers couple names for the cinematic templates too', () => {
  /* ring/bab/swans/letter store the same partner1/partner2 keys as 'wedding',
     but had no case of their own — so every Velvet Ring, Door of Joy, Swan
     Lake and Sealed Letter event fell to the `default` arm and took its URL
     from the event title ("our-big-day") instead of the couple
     ("julian-sophia"), unlike every other couple template. Nothing errored;
     the links were just worse.

     Add every new cinematic key here as it ships — this is the one assertion
     that catches the omission, and its failure mode is invisible otherwise. */
  for (const templateType of ['engagement', 'ring', 'bab', 'swans', 'letter']) {
    const slug = deriveBaseSlug({
      templateType,
      templateData: { partner1: 'Julian', partner2: 'Sophia' },
      title: 'Our Big Day',
    });
    assert.equal(slug, 'julian-sophia', `${templateType} did not use the partner names`);
  }
});

test('deriveBaseSlug falls back to title when template fields are missing', () => {
  const slug = deriveBaseSlug({ templateType: 'wedding', templateData: {}, title: 'Grand Gala' });
  assert.equal(slug, 'grand-gala');
});

test('deriveBaseSlug never returns empty (degenerate input)', () => {
  const slug = deriveBaseSlug({ templateType: 'corporate', templateData: {}, title: '!!!' });
  assert.match(slug, /^event-[a-z0-9]+$/);
});

// Minimal fake matching the supabase query-builder surface used by generateUniqueSlug.
function fakeSupabase(existingSlugs) {
  return {
    from() {
      const builder = {
        _slug: null,
        select() { return builder; },
        eq(_col, val) { builder._slug = val; return builder; },
        limit() {
          const hit = existingSlugs.has(builder._slug);
          return Promise.resolve({ data: hit ? [{ id: '1' }] : [] });
        },
      };
      return builder;
    },
  };
}

test('generateUniqueSlug returns the base when free', async () => {
  const slug = await generateUniqueSlug(fakeSupabase(new Set()), 'julian-sophia');
  assert.equal(slug, 'julian-sophia');
});

test('generateUniqueSlug appends the year, then numeric suffixes, on collision', async () => {
  const withYear = await generateUniqueSlug(fakeSupabase(new Set(['gala'])), 'gala', { year: 2026 });
  assert.equal(withYear, 'gala-2026');

  const numeric = await generateUniqueSlug(fakeSupabase(new Set(['gala', 'gala-2026'])), 'gala', { year: 2026 });
  assert.equal(numeric, 'gala-2');
});
