/* ═══════════════════════════════════════════════════════════════════════════
   THE TRIAL'S THREE SURFACES, STAGED FOR A PHOTOGRAPH.

     cd frontend
     npx next build                                   # once — supplies the CSS
     npx vitest run --config vitest.shots.config.mjs test/shots/trialSurfaces.dump.jsx

   Output: .visual/video/stage/trial/*.html (git-ignored), painted by headless
   Chrome at 1440 and — through an iframe harness, because Chrome on this
   machine will not make a viewport under ~494px — at a true 390.

   The banner is staged in BOTH of its states, and the ended one is the reason
   this file exists. It is the screen an organizer meets on day 8 with a
   wedding coming and guests already invited, and the thing being checked is
   that it reads as an offer rather than as "your event has broken".
   ═══════════════════════════════════════════════════════════════════════════ */
/**
 * @vitest-environment-options { "url": "https://fancyrsvp.com/dashboard" }
 */
import React from 'react';
import { describe, it, vi, beforeAll } from 'vitest';
import { render, act } from '@testing-library/react';
import { stageScreen, settle } from './videoStage';

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useReducedMotion: () => false };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, forward: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(''),
  redirect: () => {},
}));

import TrialCard from '../../src/app/dashboard/create-event/components/TrialCard';
import TrialBanner from '../../src/app/dashboard/components/TrialBanner';

const CHAPTER = 'trial';

/* Stills, so entrances are frozen at their finished frame rather than their
   first one — see the note in demoStages.dump.jsx, where an unfrozen capture
   photographed a whole dashboard at opacity: 0. */
const FROZEN = `
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-delay: 0s !important;
    transition-duration: 1ms !important;
    transition-delay: 0s !important;
  }
  body { padding: 28px; background: #FAFAF8; }
  .stage-pad { max-width: 720px; margin: 0 auto; }
`;

const DAY = 24 * 60 * 60 * 1000;

beforeAll(() => {
  global.React = React;
  global.ResizeObserver = class {
    constructor(cb) { this.cb = cb; }
    observe() { this.cb?.([{ contentRect: { width: 720, height: 400 } }]); }
    unobserve() {} disconnect() {}
  };
  window.scrollTo = () => {};
});

async function stage(name, ui) {
  const { container, unmount } = render(<div className="stage-pad">{ui}</div>);
  await settle(act, 8);
  stageScreen(CHAPTER, name, container, { background: '#FAFAF8', extraCss: FROZEN });
  unmount();
}

describe('the trial, staged', () => {
  it('the offer, on the payment step', async () => {
    await stage('01-offer', <TrialCard onStartTrial={async () => ({ ok: true })} days={7} maxGuests={25} />);
  }, 120000);

  it('counting down, early', async () => {
    await stage('02-counting', (
      <TrialBanner
        event={{ trial_ends_at: new Date(Date.now() + 5 * DAY).toISOString(), tier_name: 'Free trial' }}
        upgradeHref="/dashboard?tab=settings"
      />
    ));
  }, 120000);

  it('counting down, last two days', async () => {
    await stage('03-urgent', (
      <TrialBanner
        event={{ trial_ends_at: new Date(Date.now() + 1.2 * DAY).toISOString(), tier_name: 'Free trial' }}
        upgradeHref="/dashboard?tab=settings"
      />
    ));
  }, 120000);

  it('ended — the screen that must not read as a breakage', async () => {
    await stage('04-ended', (
      <TrialBanner
        /* `trial_expired` is the SERVER's verdict and the banner requires it —
            a passed clock alone is not enough, because a paying upgrader also
            carries a passed deadline. Staging without it would photograph
            nothing at all. */
        event={{ trial_ends_at: new Date(Date.now() - 2 * DAY).toISOString(), trial_expired: true, tier_name: 'Free' }}
        upgradeHref="/dashboard?tab=settings"
      />
    ));
  }, 120000);
});
