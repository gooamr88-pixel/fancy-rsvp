import { describe, it, expect } from 'vitest';
import { assetUrl, assetSrcSet, ASSET_SIZES } from '../src/app/utils/assetUrl';

/* ═══════════════════════════════════════════════════════════════════════════
   assetUrl rewrites a Supabase public-object URL to its transformed copy.

   Most of these tests are about what it must NOT touch. The win — appending
   width and quality — is one line and hard to get wrong. The damage is all in
   the false positives: an mp3 routed through an image transformer stops playing,
   an animated gif stops moving, an SVG seal gets rasterised into a blurry
   bitmap that is BIGGER than the vector it replaced, and an external logo 404s.
   Every one of those fails silently in a browser, which is why they are pinned
   here instead of being left to review.
   ═══════════════════════════════════════════════════════════════════════════ */

const BUCKET = 'https://xbmttllukdwykqcamowj.supabase.co/storage/v1/object/public/event-assets';
const RENDER = 'https://xbmttllukdwykqcamowj.supabase.co/storage/v1/render/image/public/event-assets';

describe('assetUrl — the transformation', () => {
  it('rewrites the object path to the render path and appends the size', () => {
    expect(assetUrl(`${BUCKET}/gallery/photo.jpg`, 'card'))
      .toBe(`${RENDER}/gallery/photo.jpg?width=800&quality=72`);
  });

  it('accepts an explicit size object as well as a named one', () => {
    expect(assetUrl(`${BUCKET}/covers/a.png`, { width: 1000, quality: 60 }))
      .toBe(`${RENDER}/covers/a.png?width=1000&quality=60`);
  });

  it('every named size produces a real transformation', () => {
    for (const name of Object.keys(ASSET_SIZES)) {
      const out = assetUrl(`${BUCKET}/covers/a.jpg`, name);
      expect(out, `size "${name}"`).toContain('/render/image/public/');
      expect(out, `size "${name}"`).toMatch(/width=\d+&quality=\d+/);
    }
  });

  it('merges with a query string the object key already carries', () => {
    // An admin cache-buster must survive, not be replaced.
    expect(assetUrl(`${BUCKET}/covers/a.jpg?v=2`, 'thumb'))
      .toBe(`${RENDER}/covers/a.jpg?v=2&width=400&quality=70`);
  });

  it('preserves the project host — it does not hardcode one', () => {
    const other = 'https://someotherproject.supabase.co/storage/v1/object/public/event-assets/x.jpg';
    expect(assetUrl(other, 'card')).toContain('https://someotherproject.supabase.co/storage/v1/render/');
  });
});

describe('assetUrl — what it must leave alone', () => {
  /**
   * The music files are the single biggest per-visit asset in the product
   * (avg 4,461 kB, played from `<audio autoPlay loop>`), so this is the guard
   * most likely to be reached by someone trying to shrink the right thing in
   * the wrong way. An image transformer cannot re-encode audio; handing it an
   * mp3 produces a player that never starts and no error anyone will see.
   */
  it.each(['mp3', 'm4a', 'ogg', 'wav', 'flac', 'aac'])('leaves .%s audio untouched', (ext) => {
    const url = `${BUCKET}/music/track.${ext}`;
    expect(assetUrl(url, 'card')).toBe(url);
  });

  it.each(['mp4', 'mov', 'webm', 'm4v'])('leaves .%s video untouched', (ext) => {
    const url = `${BUCKET}/hero-video/clip.${ext}`;
    expect(assetUrl(url, 'hero')).toBe(url);
  });

  it('leaves SVG alone — rasterising a vector makes it bigger AND blurry', () => {
    const url = `${BUCKET}/seals/wax.svg`;
    expect(assetUrl(url, 'thumb')).toBe(url);
  });

  it('leaves GIF alone — transforming one returns a single still frame', () => {
    const url = `${BUCKET}/gallery/confetti.gif`;
    expect(assetUrl(url, 'card')).toBe(url);
  });

  it('leaves data: URIs alone', () => {
    const url = 'data:image/png;base64,iVBORw0KGgo=';
    expect(assetUrl(url, 'card')).toBe(url);
  });

  it('leaves relative paths alone — bundled template art is served by Next, not Supabase', () => {
    expect(assetUrl('/templates/bab/hero.mp4', 'hero')).toBe('/templates/bab/hero.mp4');
    expect(assetUrl('/images/logo.png', 'thumb')).toBe('/images/logo.png');
  });

  it('leaves third-party URLs alone', () => {
    const url = 'https://images.unsplash.com/photo-123.jpg';
    expect(assetUrl(url, 'card')).toBe(url);
  });

  it('returns falsy input unchanged, with its original type', () => {
    expect(assetUrl(null, 'card')).toBe(null);
    expect(assetUrl(undefined, 'card')).toBe(undefined);
    expect(assetUrl('', 'card')).toBe('');
  });

  it('returns the original when the named size does not exist', () => {
    const url = `${BUCKET}/covers/a.jpg`;
    expect(assetUrl(url, 'enormous')).toBe(url);
  });

  it('is idempotent — a URL already pointing at /render/ is not rewritten again', () => {
    const already = `${RENDER}/covers/a.jpg?width=800&quality=72`;
    expect(assetUrl(already, 'card')).toBe(already);
  });
});

describe('assetSrcSet', () => {
  it('offers each width with its w descriptor', () => {
    const out = assetSrcSet(`${BUCKET}/gallery/p.jpg`);
    expect(out).toContain('width=400&quality=72 400w');
    expect(out).toContain('width=800&quality=72 800w');
    expect(out).toContain('width=1400&quality=72 1400w');
  });

  /**
   * undefined, not '' — so `<img srcSet={assetSrcSet(u)} />` omits the attribute
   * entirely rather than emitting `srcset=""`, which some browsers treat as a
   * candidate list containing nothing and others ignore. Neither is a size win,
   * and one of them is a broken image.
   */
  it('returns undefined for anything untransformable', () => {
    expect(assetSrcSet(`${BUCKET}/music/t.mp3`)).toBeUndefined();
    expect(assetSrcSet('data:image/png;base64,xx')).toBeUndefined();
    expect(assetSrcSet('/templates/bab/hero.mp4')).toBeUndefined();
    expect(assetSrcSet(null)).toBeUndefined();
  });
});
