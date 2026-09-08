/* ═══════════════════════════════════════════════════════════════════════════
   THE DEMO'S THREE STAGES, STAGED FOR A PHOTOGRAPH.

     cd frontend
     npx next build                                    # once — supplies the CSS
     npx vitest run --config vitest.shots.config.mjs test/shots/demoStages.dump.jsx

   Output: .visual/video/stage/demo/*.html  (git-ignored), which is then
   painted by headless Chrome at 390 / 768 / 1440.

   ── WHY PreviewFrame IS REPLACED HERE, AND WHAT THAT COSTS ───────────────

   The phone on stages 1 and 3 is a real same-origin iframe with the React
   tree portalled into it. In jsdom that portal lands in the FRAME's document,
   which `container.innerHTML` does not reach — so a faithful dump of these
   pages would contain an empty box where the invitation is, and a photograph
   of it would say nothing about either.

   So the frame is replaced by a labelled plate of the same size. What these
   pictures then check is the ROOM: the bar, the rail, the lit ground, the
   bezel geometry, the control panel, the dashboard shell at every width.
   What they do NOT check is the invitation inside it — that is the guest page,
   and it has probes of its own (guestPageAudit, swanLakeTemplate). Saying so
   here rather than letting a future reader assume this covered both.
   ═══════════════════════════════════════════════════════════════════════════ */
/**
 * The demo router only answers while the pathname is inside /demo — the guard
 * that keeps a real organizer out of this data. Under the harness's default
 * jsdom URL it declines everything, and the Overview would stage as a page of
 * loading skeletons.
 *
 * @vitest-environment-options { "url": "https://fancyrsvp.com/demo/dashboard" }
 */
import React from 'react';
import { describe, it, vi, beforeAll } from 'vitest';
import { render, act, fireEvent, screen } from '@testing-library/react';
import { stageScreen, settle } from './videoStage';

/* The entrance staggers are part of what these pages are; reduced motion
   would stage them already-arrived and hide the thing being checked. */
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useReducedMotion: () => false };
});

/* App Router hooks do not exist outside a Next render, and DemoChrome reads
   the pathname to decide whether the stage is the dark one. */
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: () => {}, replace: () => {}, back: () => {},
    forward: () => {}, refresh: () => {}, prefetch: () => {},
  }),
  usePathname: () => globalThis.__DEMO_PATH__ || '/demo/dashboard',
  useSearchParams: () => new URLSearchParams(''),
  redirect: () => {},
}));

/* See the header. A plate of the same size, so the bezel, the ground and the
   sticky column around it are all photographed at their real dimensions. */
vi.mock('../../src/app/components/templates/PreviewFrame', () => ({
  default: function StubFrame({ style, className }) {
    return (
      <div
        className={className}
        style={{
          ...style,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(160deg,#F8F4E9,#EDE4D0)',
          color: '#6B1B2A',
          fontFamily: 'var(--font-sans)',
          fontSize: 12,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
        }}
      >
        the guest page
      </div>
    );
  },
}));

import DemoChrome from '../../src/app/demo/components/DemoChrome';
import DemoInvitationPage from '../../src/app/demo/invitation/page';
import DemoDashboardPage from '../../src/app/demo/dashboard/page';
import DemoCustomizePage from '../../src/app/demo/customize/page';

const CHAPTER = 'demo';

/* FREEZE THE ANIMATION. videoStage is built for the film, where a real
   browser plays entrances over real seconds, so it deliberately does NOT do
   this. These are STILLS — and the first pass proved the difference: the
   Overview staged correctly, its injected CSS was harvested correctly, and
   the photograph came back blank, because `.ov-section { opacity: 0 }` is the
   FIRST frame of an animation that had not been given time to run.

   Same rule the still probes in this folder use. Delays to zero as well as
   durations: the Overview staggers its sections at 100 / 250 / 400ms, and a
   1ms duration starting 400ms late is still a section that is not there. */
const FROZEN = `
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    transition-delay: 0s !important;
  }
`;

beforeAll(() => {
  // vitest compiles this repo with the classic JSX runtime, and several
  // components never import React themselves.
  global.React = React;

  // jsdom has no layout engine, so anything that measures itself collapses to
  // zero and stages as an empty box.
  global.ResizeObserver = class {
    observe() { this.cb?.([{ contentRect: { width: 1120, height: 860 } }]); }
    unobserve() {}
    disconnect() {}
    constructor(cb) { this.cb = cb; }
  };
  global.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; }
    observe() { this.cb?.([{ isIntersecting: true, intersectionRatio: 1 }]); }
    unobserve() {}
    disconnect() {}
  };

  window.scrollTo = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
  localStorage.clear();
});

async function stage(name, path, ui, opts = {}) {
  globalThis.__DEMO_PATH__ = path;
  const { container, unmount } = render(<DemoChrome>{ui}</DemoChrome>);
  await settle(act, 12);
  stageScreen(CHAPTER, name, container, { extraCss: FROZEN, ...opts });
  unmount();
}

describe('the demo, staged', () => {
  it('1 · the arrival', async () => {
    await stage('01-invitation', '/demo/invitation', <DemoInvitationPage />, {
      background: '#0E0D0C',
    });
  }, 120000);

  it('2 · the overview', async () => {
    await stage('02-dashboard-overview', '/demo/dashboard', <DemoDashboardPage />, {
      background: '#FAFAF8',
    });
  }, 120000);

  it('2 · the guest list', async () => {
    globalThis.__DEMO_PATH__ = '/demo/dashboard';
    const { container, unmount } = render(<DemoChrome><DemoDashboardPage /></DemoChrome>);
    await settle(act, 6);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Guest list/i })); });
    await settle(act, 10);
    stageScreen(CHAPTER, '03-dashboard-guests', container, { background: '#FAFAF8', extraCss: FROZEN });
    unmount();
  }, 120000);

  it('2 · the seating', async () => {
    globalThis.__DEMO_PATH__ = '/demo/dashboard';
    const { container, unmount } = render(<DemoChrome><DemoDashboardPage /></DemoChrome>);
    await settle(act, 6);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Seating/i })); });
    await settle(act, 10);
    stageScreen(CHAPTER, '04-dashboard-seating', container, { background: '#FAFAF8', extraCss: FROZEN });
    unmount();
  }, 120000);

  it('2 · the analytics', async () => {
    globalThis.__DEMO_PATH__ = '/demo/dashboard';
    const { container, unmount } = render(<DemoChrome><DemoDashboardPage /></DemoChrome>);
    await settle(act, 6);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Analytics/i })); });
    await settle(act, 14);
    stageScreen(CHAPTER, '05-dashboard-analytics', container, { background: '#FAFAF8', extraCss: FROZEN });
    unmount();
  }, 120000);

  it('3 · make it yours', async () => {
    await stage('06-customize', '/demo/customize', <DemoCustomizePage />, {
      background: '#FCFBF8',
    });
  }, 120000);
});
