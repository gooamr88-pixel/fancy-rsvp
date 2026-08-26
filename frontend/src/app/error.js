'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import ErrorState from './components/ErrorState';

export default function Error({ error, reset }) {
  const headingRef = useRef(null);

  useEffect(() => {
    console.error('Application error:', error);

    // STALE BUILD RECOVERY: `next start` serves a pre-built .next/, and a redeploy
    // replaces it in place — so a document that was loaded before the deploy asks
    // for /_next/static chunks that no longer exist on disk (nginx caches that path
    // `immutable` for a year, which makes it worse, not better). Any client still
    // holding the old HTML — an open tab, a bfcache entry, an in-app browser like
    // WhatsApp or Gmail resurrecting a backgrounded page — then fails to hydrate and
    // just sits there. Re-fetching the document is the only in-page fix. The
    // sessionStorage flag makes this strictly one attempt, so a genuinely broken
    // build can never turn into a reload loop.
    if (/Loading chunk|ChunkLoadError|Failed to fetch dynamically imported|error loading dynamically imported/i.test(String(error?.message || ''))) {
      try {
        if (!sessionStorage.getItem('fancy_chunk_reloaded')) {
          sessionStorage.setItem('fancy_chunk_reloaded', '1');
          window.location.reload();
          return;
        }
      } catch { /* storage unavailable (private mode) — fall through to the card */ }
    }

    // A11Y-10: a client-side navigation into this boundary doesn't reset
    // focus/announce the route change on its own — move focus to the
    // heading so screen-reader users know they've landed on an error page.
    headingRef.current?.focus();
  }, [error]);

  return (
    <ErrorState
      ref={headingRef}
      title="Something went wrong"
      // Never interpolate error.message here — a render-time exception is a
      // technical/developer detail, not a crafted user-facing string (unlike
      // apiFetch errors), and could leak internals.
      message="An unexpected error stopped this page from loading. Trying again usually resolves it."
      actions={(
        <>
          <button type="button" onClick={reset} className="fx-errstate-btn fx-errstate-btn--primary">
            Try again
          </button>
          <Link href="/" className="fx-errstate-btn fx-errstate-btn--ghost">
            Go home
          </Link>
        </>
      )}
    />
  );
}
