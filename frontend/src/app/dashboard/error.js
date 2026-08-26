'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import ErrorState from '../components/ErrorState';

export default function DashboardError({ error, reset }) {
  const headingRef = useRef(null);

  useEffect(() => {
    console.error('Dashboard error:', error);
    // A11Y-10: focus the heading so screen-reader users know they've landed
    // on an error state after a client-side navigation.
    headingRef.current?.focus();
  }, [error]);

  return (
    <ErrorState
      ref={headingRef}
      title="Something went wrong"
      /* Never interpolate error.message — a caught render exception is a
         technical/developer detail, not a crafted user-facing string. */
      message="We could not load this part of your dashboard. Your event and your guest list are safe."
      actions={(
        <>
          <button type="button" onClick={() => reset()} className="fx-errstate-btn fx-errstate-btn--primary">
            Try again
          </button>
          <Link href="/dashboard" className="fx-errstate-btn fx-errstate-btn--ghost">
            Back to dashboard
          </Link>
        </>
      )}
    />
  );
}
