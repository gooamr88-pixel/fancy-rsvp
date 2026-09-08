import path from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: path.resolve('..'),
  },
  // /templates (the "Template Gallery" marketing page) has been retired —
  // every internal link to it (Navbar, FooterSection, solutions/planners,
  // sitemap.js) was removed alongside this. The redirect exists for what
  // those removals can't reach: search-engine listings, other sites' links,
  // and anyone with the URL bookmarked. `permanent: true` (308) tells
  // crawlers to update their index to the new URL rather than keep the old
  // one live — the correct signal for a page that is gone for good, not
  // temporarily moved.
  async redirects() {
    return [
      { source: '/templates', destination: '/', permanent: true },
      /* /demo-wedding was a fixed showcase event served by the [slug] route
         from a hardcoded object in EventPageClient. Nothing on the site ever
         linked to it and it was never in the sitemap, so it had become a
         second, dormant demo that could drift from the real one — and its
         RSVP would have posted to an event with no row behind it.

         It is now /demo, which is the same wedding, done properly. The
         redirect covers what deleting the code cannot: anyone who has the
         old URL. */
      { source: '/demo-wedding', destination: '/demo/invitation', permanent: true },
    ];
  },
  async headers() {
    const isDev = process.env.NODE_ENV !== 'production';

    // Dev mode (Turbopack/webpack) needs 'unsafe-eval' to reconstruct stack traces for
    // debugging; production builds never call eval(), so the prod CSP stays unrelaxed.
    const scriptSrc = isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com https://maps.googleapis.com https://challenges.cloudflare.com https://www.youtube.com https://s.ytimg.com"
      : "script-src 'self' 'unsafe-inline' https://accounts.google.com https://maps.googleapis.com https://challenges.cloudflare.com https://www.youtube.com https://s.ytimg.com";

    // connect-src: in development include localhost:5000 for the local API server;
    // in production use the configured API URL or the production domain only.
    const apiConnectSrc = isDev
      ? 'http://localhost:5000'
      : (process.env.NEXT_PUBLIC_API_URL || 'https://fancyrsvp.com');

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
          // HSTS (L2): enforce HTTPS for a year incl. subdomains (browsers ignore it on http/localhost in dev).
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
          // CSP (L2): existing policy hardened with object-src / base-uri / frame-ancestors
          // as defense-in-depth complementing the H2 JSON-LD escaping fix.
          // Kept in sync with deployment/nginx.conf (both edge layers emit a CSP; the
          // browser enforces the intersection, so they MUST allow the same sources).
          // Any change here must be mirrored there.
          { key: 'Content-Security-Policy', value: `default-src 'self'; ${scriptSrc}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: blob:; media-src 'self' data: https: blob:; connect-src 'self' ${apiConnectSrc} https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://fancyrsvp.com https://accounts.google.com https://oauth2.googleapis.com https://maps.googleapis.com https://challenges.cloudflare.com; frame-src 'self' https://accounts.google.com https://www.google.com https://maps.googleapis.com https://challenges.cloudflare.com https://www.youtube.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'` },
        ],
      },
    ];
  },
};

export default nextConfig;
