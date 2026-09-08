/* ═══════════════════════════════════════════════════════════════════════════
   THE ADMIN CONTROL THAT MAKES THE TRIAL EXIST.

     cd frontend
     npx next build                                   # once — supplies the CSS
     npx vitest run --config vitest.shots.config.mjs test/shots/adminTrialPlan.dump.jsx

   The free trial is a PLAN, and until this screen could create one the whole
   feature was invisible — the code read a tier that nothing could write. So
   this is the screen the fix rests on, and it gets photographed rather than
   asserted.

   It mounts the REAL config page with a mocked `adminApi`, not a copy of the
   switch row. A reproduction would prove the reproduction renders.

   Two frames, and the second is the one worth looking at:

     01  an ordinary paid plan — the trial switch present but off, and the
         checkbox row still fitting on one line beside the three that were
         already there
     02  the trial plan selected — the switch on, "Days" revealed beside it,
         and the note that says what will be quietly overruled on save
   ═══════════════════════════════════════════════════════════════════════════ */
/**
 * @vitest-environment-options { "url": "https://fancyrsvp.com/admin/config" }
 */
import React from 'react';
import { describe, it, vi, beforeAll } from 'vitest';
import { render, act, screen, fireEvent } from '@testing-library/react';
import { stageScreen, settle } from './videoStage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, forward: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => '/admin/config',
  useSearchParams: () => new URLSearchParams(''),
  redirect: () => {},
}));

/* The plan list as 20260903000000_seed_trial_plan.sql leaves it: the operator's
   own plans, with the trial appended last. Deliberately the real shape — the
   seed's key, cap and feature list — so the frame shows what an admin actually
   opens after applying the migration, not an invented example. */
const TRIAL_FEATURES = [
  'rsvp_custom_fields', 'add_guest_manual', 'import_guests_csv', 'guest_export_csv',
  'seating_map', 'table_management', 'qr_checkin', 'manual_checkin',
  'analytics_advanced', 'custom_branding', 'sms_campaigns',
];

const TIERS = [
  { key: 'free', name: 'Free', price_cents: 0, max_guests: 50, max_events: 0, remove_watermark: false, recommended: false, is_custom: false, is_trial: false, features: [] },
  { key: 'essential', name: 'Essential', price_cents: 4900, max_guests: 150, max_events: 0, remove_watermark: true, recommended: true, is_custom: false, is_trial: false, features: ['seating_map', 'table_management', 'qr_checkin'] },
  {
    key: 'free_trial', name: 'Free trial', price_cents: 0, max_guests: 25, max_events: 0,
    remove_watermark: false, recommended: false, is_custom: false,
    is_trial: true, trial_days: 7,
    price_label: 'Free for 7 days', cta_label: 'Start my free days',
    description: 'Publish a real event and try everything for a week. No card.',
    features: TRIAL_FEATURES,
  },
];

const f = (key, label, description, extra = {}) => ({
  key, label, description, freeDefault: false, builtIn: true, alwaysOn: false, comingSoon: false, ...extra,
});

/* `categories` is an ARRAY of category ids, not a label map — the selector maps
   over it and indexes `features` with each id. (Written the other way first;
   the render threw, which is the whole reason this is photographed.) */
const REGISTRY = {
  categories: ['Guests & RSVP', 'Seating & venue', 'At the door'],
  features: {
    'Guests & RSVP': [
      f('rsvp_custom_fields', 'Custom RSVP questions', 'Ask your own questions on the RSVP form.'),
      f('import_guests_csv', 'Import guests from a spreadsheet', 'Bring an existing list in.'),
      f('guest_export_csv', 'Export guests to CSV', 'Take the list back out again.'),
    ],
    'Seating & venue': [
      f('seating_map', 'Seating map', 'Draw the venue and place guests on it.'),
      f('table_management', 'Tables', 'Name and size every table.'),
    ],
    'At the door': [
      f('qr_checkin', 'QR check-in', 'Scan the entry pass at the door.'),
      f('manual_checkin', 'Manual check-in', 'Tick guests in by hand.'),
    ],
  },
};
REGISTRY.allFeatures = Object.entries(REGISTRY.features)
  .flatMap(([category, list]) => list.map((x) => ({ ...x, category })));

vi.mock('../../src/app/admin/_lib/adminApi', () => {
  const api = {
    get: async (path) => {
      if (path === '/feature-registry') return REGISTRY;
      if (path === '/pricing') {
        return {
          config: {
            sms_rate_cents_per_credit: 8, sms_markup_percentage: 40,
            platform_commission_pct: 0, pricing_tiers: TIERS,
            manual_payment_methods: [], landing_stats: [],
          },
          smsPricing: null, smsMessageTypes: [],
        };
      }
      return {};
    },
    post: async () => ({}), put: async () => ({}), patch: async () => ({}), del: async () => ({}),
  };
  return { adminApi: api, default: api };
});

import ConfigPage from '../../src/app/admin/(panel)/config/page';

const CHAPTER = 'admin-trial';

/* Stills: entrances frozen at their finished frame. An unfrozen capture once
   photographed a whole dashboard at opacity: 0 — see demoStages.dump.jsx. */
const FROZEN = `
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-delay: 0s !important;
    transition-duration: 1ms !important;
    transition-delay: 0s !important;
  }
  body { background: #F6F5F2; padding: 0; }
`;

beforeAll(() => {
  global.React = React;
  global.ResizeObserver = class {
    constructor(cb) { this.cb = cb; }
    observe() { this.cb?.([{ contentRect: { width: 1100, height: 700 } }]); }
    unobserve() {} disconnect() {}
  };
  window.scrollTo = () => {};
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  }));
});

/** Mounts the page, opens the Plans tab, and selects a plan by its name. */
async function openTier(name) {
  const view = render(<ConfigPage />);
  await settle(act, 6);

  // The tab strip and the plan rail are both plain buttons carrying their label.
  const byText = (text) => screen.getAllByText(text).map((el) => el.closest('button')).find(Boolean);

  const tab = byText('Subscription Tiers');
  await act(async () => { fireEvent.click(tab); });
  await settle(act, 3);

  const plan = byText(name);
  await act(async () => { fireEvent.click(plan); });
  await settle(act, 4);

  return view;
}

async function stage(name, container) {
  stageScreen(CHAPTER, name, container, { background: '#F6F5F2', extraCss: FROZEN });
}

describe('the trial plan, in the admin', () => {
  it('an ordinary plan — the switch present and off', async () => {
    const { container, unmount } = await openTier('Essential');
    await stage('01-ordinary-plan', container);
    unmount();
  }, 120000);

  it('the trial plan — the switch on, its length, and the rules said out loud', async () => {
    const { container, unmount } = await openTier('Free trial');
    await stage('02-trial-plan', container);
    unmount();
  }, 120000);
});
