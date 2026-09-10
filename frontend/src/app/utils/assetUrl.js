/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SERVE STORED IMAGES AT THE SIZE THEY ARE ACTUALLY DISPLAYED
 *
 * ── THE MEASUREMENT THIS EXISTS FOR ──
 *
 * On 2026-09-10 the `event-assets` bucket held 449 MB across 283 files, and the
 * project had just been restricted by Supabase for exceeding the free tier's
 * egress allowance — 8.7 GB of cached egress in six days against 0.4 GB stored,
 * i.e. every stored byte was delivered about twenty-one times.
 *
 * Nothing in the upload path had ever resized anything. `uploadImage.js` caps a
 * file at 8 MB and sends it as-is, so what a guest downloads is whatever came
 * off the organizer's phone:
 *
 *     gallery   70 files   100 MB   avg 1469 kB   max 7994 kB
 *     shop     119 files   106 MB   avg  911 kB   max 3071 kB
 *     covers    24 files    38 MB   avg 1610 kB   max 6708 kB
 *
 * A guest opening one invitation with a six-photo gallery pulled roughly 15 MB.
 *
 * ── WHY A URL HELPER AND NOT A RE-UPLOAD ──
 *
 * Supabase serves a transformed copy from `/render/image/public/…` for any
 * object already in the bucket. Verified against production before this file
 * was written, on a real object:
 *
 *     original            190,795 bytes
 *     ?width=1200&q=75    124,298 bytes   -35%
 *     ?width=800&q=70      77,285 bytes   -60%
 *     ?width=400&q=70      39,189 bytes   -79%
 *
 * That is the entire fix for images, it needs no backfill, and it is reversible
 * by deleting one function call. Re-compressing and re-uploading the 260 stored
 * images is the permanent version and comes later; this stops the bleeding now.
 *
 * ── WHAT THIS DELIBERATELY REFUSES TO TOUCH ──
 *
 * The single biggest per-visit asset is NOT an image. Background music averages
 * 4,461 kB and plays from `<audio autoPlay loop>` on every guest page open — one
 * music file outweighs three gallery photos, and no image transform can help it.
 * Audio needs re-encoding, which is a separate job. The guards below exist so
 * that nobody, having read that this helper "shrinks assets", pipes an mp3
 * through it and gets a broken player instead of a smaller one.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The public-object path Supabase serves untransformed bytes from. */
const OBJECT_PATH = '/storage/v1/object/public/';
/** The same object, resized and re-encoded on the fly. */
const RENDER_PATH = '/storage/v1/render/image/public/';

/**
 * Extensions the render endpoint must never be handed.
 *
 * - audio/video: not images. The endpoint would fail and the asset would simply
 *   not play, which on a `<audio autoPlay>` is a silent failure nobody notices.
 * - svg: vector already, and rasterising it makes the file BIGGER while making
 *   it blurry. The wax seals are SVG and are 9 kB each — there is nothing here
 *   to win and a crisp mark to lose.
 * - gif: transformation returns a single still frame. An animation that stops
 *   moving reads as a broken image, not a small one.
 */
const NEVER_TRANSFORM = /\.(mp3|m4a|aac|ogg|oga|wav|flac|mp4|mov|webm|m4v|svg|gif|pdf)(\?|#|$)/i;

/**
 * Sizes named after where they are used, not after their pixel count.
 *
 * A caller that has to pick a number picks the wrong one — usually the original,
 * because it is the only value that is definitely safe. Naming the SLOT means
 * the decision is made once, here, next to the reasoning.
 *
 * Widths are the CSS slot doubled, so the image is still sharp on a 2× phone
 * screen, which is what almost every guest is holding.
 */
export const ASSET_SIZES = {
  /** Grid squares, avatars, small cards. ~180 CSS px. */
  thumb: { width: 400, quality: 70 },
  /** Gallery tiles, shop cards, blog cards. ~400 CSS px. */
  card: { width: 800, quality: 72 },
  /** Full-bleed covers and hero images. ~600-900 CSS px. */
  hero: { width: 1400, quality: 76 },
  /** The lightbox — the one place a guest deliberately asks to see detail. */
  full: { width: 2000, quality: 82 },
};

/**
 * Rewrite a Supabase public object URL to its transformed equivalent.
 *
 * Anything this cannot confidently improve is returned EXACTLY as given, which
 * is the property that makes it safe to sprinkle across render paths: a data
 * URI, an external CDN link, a relative `/templates/…` path, an empty value, an
 * mp3 — all pass through untouched.
 *
 * @param {string|null|undefined} url
 * @param {{width?: number, quality?: number, resize?: 'cover'|'contain'|'fill'}|keyof typeof ASSET_SIZES} [opts]
 *        A named size from ASSET_SIZES, or an explicit object.
 * @returns {string|null|undefined} the same type of falsy value it was given
 */
export function assetUrl(url, opts = 'card') {
  if (!url || typeof url !== 'string') return url;

  // Data URIs, blobs and relative paths are not in the bucket. `/templates/…`
  // hero videos and the bundled artwork live in the Next.js public folder and
  // are served by the app, not by Supabase.
  if (!/^https?:\/\//i.test(url)) return url;

  // Only OUR storage. A logo pasted in from another site must not be routed
  // through a render endpoint that has never heard of it.
  const idx = url.indexOf(OBJECT_PATH);
  if (idx === -1) return url;

  if (NEVER_TRANSFORM.test(url)) return url;

  const size = typeof opts === 'string' ? ASSET_SIZES[opts] : opts;
  if (!size || !size.width) return url;

  // Preserve everything before the path (scheme + project host) and the object
  // key after it, swapping only the middle segment.
  const rendered = url.slice(0, idx) + RENDER_PATH + url.slice(idx + OBJECT_PATH.length);

  // The object key can legitimately carry its own query string (a cache-buster
  // added by an admin, say). Merge rather than clobber.
  const joiner = rendered.includes('?') ? '&' : '?';
  const params = [`width=${size.width}`, `quality=${size.quality ?? 75}`];
  if (size.resize) params.push(`resize=${size.resize}`);

  return `${rendered}${joiner}${params.join('&')}`;
}

/**
 * `srcSet` for an <img>, so the browser picks by its own screen rather than
 * being handed one guess.
 *
 * Worth having even though `assetUrl` alone captures most of the win: on a
 * narrow phone the 400 px copy is a quarter the bytes of the 800 px one, and
 * phones are the overwhelming majority of guest traffic.
 *
 * @param {string|null|undefined} url
 * @param {number[]} [widths]
 * @returns {string|undefined} undefined when the URL is not transformable, so
 *          it can be spread onto an <img> without emitting an empty attribute
 */
export function assetSrcSet(url, widths = [400, 800, 1400]) {
  if (!url || typeof url !== 'string') return undefined;
  if (!/^https?:\/\//i.test(url)) return undefined;
  if (!url.includes(OBJECT_PATH)) return undefined;
  if (NEVER_TRANSFORM.test(url)) return undefined;

  return widths
    .map((w) => `${assetUrl(url, { width: w, quality: 72 })} ${w}w`)
    .join(', ');
}

export default assetUrl;
