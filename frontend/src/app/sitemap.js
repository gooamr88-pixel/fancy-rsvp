// Sitemap of the public marketing/legal surface, plus every published blog
// post and every invitation in the collection. Event pages are per-customer
// and deliberately excluded; the compliance-relevant URLs (/sms-opt-in,
// /privacy, /terms) are always present.
import { COLLECTION_KEYS } from './collection/collectionCatalogue';

const BASE = 'https://fancyrsvp.com';
// Loopback for server-side fetches — see the comment in [slug]/page.js.
const API_URL = process.env.INTERNAL_API_URL
  || process.env.NEXT_PUBLIC_API_URL
  || 'http://localhost:5000/api/v1';

// Individual /blog/[slug] posts were never listed here even after the real,
// admin-authored blog shipped — a real SEO-oriented blog needs its posts
// discoverable via the sitemap, not just linked from /blog. Best-effort:
// a fetch failure degrades to the static routes only, same as the blog
// pages' own fetch helpers.
async function fetchBlogSlugs() {
  try {
    const res = await fetch(`${API_URL}/public/blog`, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.posts || []).map((p) => ({ slug: p.slug, publishedAt: p.published_at }));
  } catch {
    return [];
  }
}

export default async function sitemap() {
  const routes = [
    '',
    /* The working demo — and the URL listed is the STAGE, not /demo.

       /demo is the address to paste into a message, but it is a redirect, and
       listing a redirecting URL in a sitemap only tells a crawler to fetch a
       page that immediately sends it somewhere else. That is the same mistake
       the retired /templates entry was removed for, a few lines below.

       Only the first stage. The other two are the same argument further along
       and would compete with it for the same query. */
    '/demo/invitation',
    '/about',
    '/careers',
    '/contact',
    '/features',
    '/pricing',
    // '/templates' removed — the page is retired and now redirects (see
    // next.config.mjs); listing a redirecting URL in the sitemap only tells
    // search engines to crawl a page that immediately sends them elsewhere.
    //
    // /collection is NOT that page coming back. It is a new gallery at a new
    // address, and the 308 on /templates stays exactly where it is: other
    // sites still link the old URL and it is still correct to tell a crawler
    // that page is gone. These entries are added below, from the catalogue
    // rather than typed here, so a fifth template appears in the sitemap by
    // existing rather than by somebody remembering this list.
    '/collection',
    '/integrations',
    '/help',
    '/blog',
    '/privacy',
    '/terms',
    '/sms-opt-in',
    '/solutions/planners',
    '/solutions/venues',
    '/solutions/corporate',
  ];
  const lastModified = new Date();
  const staticEntries = routes.map((path) => ({
    url: `${BASE}${path}`,
    lastModified,
    changeFrequency: path === '' ? 'weekly' : 'monthly',
    priority: path === '' ? 1 : path === '/sms-opt-in' || path === '/privacy' || path === '/terms' ? 0.8 : 0.6,
  }));

  /* The template pages, from the array the gallery itself renders. Typed out
     here they would be a second catalogue, and the one that goes stale is
     always the one nobody looks at. (No count in this sentence either — see
     the note on the routes list above.)

     0.6, the same as every other marketing page including /collection itself.
     It was 0.7 for a moment, which quietly told crawlers each template
     outranks the gallery that indexes them. */
  const collectionEntries = COLLECTION_KEYS.map((key) => ({
    url: `${BASE}/collection/${key}`,
    lastModified,
    changeFrequency: 'monthly',
    priority: 0.6,
  }));

  const posts = await fetchBlogSlugs();
  const blogEntries = posts
    .filter((p) => p.slug)
    .map((p) => ({
      url: `${BASE}/blog/${p.slug}`,
      lastModified: p.publishedAt ? new Date(p.publishedAt) : lastModified,
      changeFrequency: 'monthly',
      priority: 0.6,
    }));

  return [...staticEntries, ...collectionEntries, ...blogEntries];
}
