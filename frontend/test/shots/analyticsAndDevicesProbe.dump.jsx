/* Stages the two screens this session repaired so they can be LOOKED AT.
   Output lands in .visual/analytics-devices/.

     npx vitest run --config vitest.shots.config.mjs test/shots/analyticsAndDevicesProbe.dump.jsx

   Then, from .visual/analytics-devices (absolute short paths BOTH ways):

     chrome --headless=new --disable-gpu --hide-scrollbars \
       --allow-file-access-from-files --window-size=1160,900 \
       --virtual-time-budget=3000 --screenshot=<abs>/shot-devices-1080.png <abs>/frame-devices-1080.html

   WHY THIS EXISTS. Both screens were fixed blind:

     • /admin/checkin-devices threw `ReferenceError: load is not defined` on every
       render since it shipped, so NOBODY — not the author, not the operator —
       has ever seen it. A mount test proves it no longer throws; it says nothing
       about whether the thing that appears is usable.
     • The analytics engagement cards could never populate (no beacon was ever
       fired), so "What guests did" and the interactions timeline have never been
       photographed with data in them.

   Both also get their failure states staged, because those are the states that
   ship untested: the devices registry with a stolen tablet holding old data, and
   analytics with the beacon table unreadable. */
import React from 'react';
import { describe, it, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, '..', '.visual', 'analytics-devices');
const GLOBALS = fs.readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8');

/* Prefer the BUILT css for real @font-face, exactly as collectionProbe does, and
   fall back loudly rather than throwing — a partial `next build` leaves the
   chunks populated with no @font-face at all, and a probe that only checks for
   a layout rule paints happily in Georgia and looks like a font bug. */
function fontFaces() {
  const dir = path.join(ROOT, '.next/static/chunks');
  if (!fs.existsSync(dir)) return { css: '', source: 'SOURCE (no build)' };
  const css = fs.readdirSync(dir).filter((f) => f.endsWith('.css'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const media = encodeURI(path.join(ROOT, '.next/static/media').split(path.sep).join('/'));
  const faces = css.replace(/url\(\.\.\/media\//g, `url(file:///${media}/`).match(/@font-face\{[^}]*\}/g);
  if (!faces) return { css: '', source: 'SOURCE (build has no @font-face)' };
  return { css: faces.join('\n'), source: 'BUILT' };
}

const FONTS = fontFaces();

/* Ground from the token, never a literal: globals.css redefines every --admin-*
   inside `@media (prefers-color-scheme: dark)` and headless Chrome reports dark,
   so a forced light background renders light text on light and the component
   looks broken when it is fine. */
const VARS = `
  :root {
    --font-sans: "Google Sans", system-ui, sans-serif;
    --font-serif: "Cormorant Garamond", "Cormorant Garamond Fallback", Georgia, serif;
  }
  html, body { margin: 0; padding: 0; background: var(--admin-bg, #FAFAF8); }
  .stage { padding: 24px; }
  /* Entrances caught mid-fade photograph as washed-out or absent content.
     Delays zeroed as well as durations — a 1ms animation starting 400ms late is
     still missing from the still. */
  *, *::before, *::after {
    animation-duration: 1ms !important; animation-delay: 0s !important;
    transition-duration: 1ms !important; transition-delay: 0s !important;
  }
`;

const BANNER = `<div style="position:fixed;top:0;left:0;z-index:99999;background:${
  FONTS.source === 'BUILT' ? '#2F6F4F' : '#C8871B'
};color:#fff;font:700 11px/1.6 system-ui;padding:2px 10px">CSS: ${FONTS.source}</div>`;

function page(inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<style>${FONTS.css}</style><style>${GLOBALS}</style><style>${VARS}</style></head>
<body>${BANNER}<div class="stage">${inner}</div></body></html>`;
}

/* The iframe is what gives a TRUE viewport width. Headless Chrome on Windows
   cannot make a window narrower than ~494px, so `--window-size=390,…` produces a
   390px-wide PICTURE of a 494px layout — content appears to overflow when it does
   not. The frame is staged 40px taller than the shot so the CSS banner sits in a
   strip that a crop can drop. */
function frame(name, w, h = 1400) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#666;}
  iframe{display:block;width:${w}px;height:${h}px;border:0;background:#FAFAF8;}
</style></head><body><iframe src="${name}.html" scrolling="no"></iframe></body></html>`;
}

/* ── The device registry fixture ──
   Written from checkinAdminController.listAllDevices' own output mapping, not
   invented: a fixture whose keys do not match renders every cell as an em dash
   and photographs an empty table looking perfectly tidy. */
const DEVICES = [
  {
    id: 'd1', label: 'Main Gate — iPad', appVersion: '1.5.0',
    orgName: 'Bayt Al Nour Events', eventTitle: 'Nadia & Karim — Wedding',
    isActive: true, wipePending: false, holdingStaleData: false,
    batteryLevel: 82, storageFreeMb: 4120, queueDepth: 0, bundleVersion: 7,
    lastSeenAt: new Date(Date.now() - 4 * 60000).toISOString(),
  },
  {
    // The row this whole screen exists for: switched off in a drawer, still
    // holding a private guest list, with arrivals it never managed to send.
    id: 'd2', label: 'Garden Entrance', appVersion: '1.4.0',
    orgName: 'Coastline Weddings & Events of Greater San Diego',
    eventTitle: 'The Al-Mansouri Family Reunion and Fiftieth Anniversary Celebration',
    isActive: true, wipePending: false, holdingStaleData: true,
    batteryLevel: 11, storageFreeMb: 230, queueDepth: 14, bundleVersion: 3,
    lastSeenAt: new Date(Date.now() - 31 * 86400000).toISOString(),
  },
  {
    id: 'd3', label: 'Back Door', appVersion: '1.5.0',
    orgName: 'Bayt Al Nour Events', eventTitle: 'Nadia & Karim — Wedding',
    isActive: true, wipePending: true, holdingStaleData: false,
    batteryLevel: 64, storageFreeMb: 2900, queueDepth: 0, bundleVersion: 7,
    lastSeenAt: new Date(Date.now() - 3 * 3600000).toISOString(),
  },
  {
    id: 'd4', label: 'Loaner tablet', appVersion: null,
    orgName: 'Harbour House', eventTitle: 'Spring Gala',
    isActive: false, wipePending: false, holdingStaleData: false,
    batteryLevel: null, storageFreeMb: null, queueDepth: 0, bundleVersion: null,
    lastSeenAt: null,
  },
];

const DEVICE_COUNTS = { total: 4, active: 3, wipePending: 1, holdingStaleData: 1 };

vi.mock('../../src/app/admin/_lib/adminApi', () => {
  const api = {
    get: vi.fn(async (p) => {
      if (String(p).includes('/checkin/devices')) {
        return { success: true, data: { devices: DEVICES, counts: DEVICE_COUNTS } };
      }
      return { success: true, me: { isSuperAdmin: true, permissions: ['*'] }, data: [] };
    }),
    post: vi.fn(async () => ({ success: true })),
    put: vi.fn(async () => ({ success: true })),
    patch: vi.fn(async () => ({ success: true })),
    del: vi.fn(async () => ({ success: true })),
  };
  return { adminApi: api, default: api };
});

/* ── The analytics fixture ──
   Shaped from getEventAnalytics' own response object. The engagement numbers are
   the ones that were structurally unreachable until this session. */
function analyticsPayload({ engagementAvailable = true } = {}) {
  const base = {
    rangeApplied: false,
    truncated: false,
    advanced: true,
    engagementAvailable,
    overview: {
      totalPageViews: engagementAvailable ? 812 : null,
      uniqueVisitors: engagementAvailable ? 474 : null,
      totalRsvps: 268,
      attendingCount: 191,
      declinedCount: 52,
      maybeCount: 25,
      pendingCount: 96,
      totalHeadcount: 347,
      conversionRate: engagementAvailable ? 33 : null,
      engagementRate: engagementAvailable ? 57 : null,
    },
    declineReasons: { travel_distance: 21, prior_commitment: 17, health: 8, unspecified: 6 },
    sources: { web_form: 233, email: 28, sms: 7 },
  };
  if (!engagementAvailable) return base;
  return {
    ...base,
    funnel: [
      { step: 'Page Views', count: 812, dropOff: null },
      { step: 'RSVP Started', count: 517, dropOff: 36 },
      { step: 'Name Entered', count: 463, dropOff: 10 },
      { step: 'Attendance Selected', count: 401, dropOff: 13 },
      { step: 'Details Filled', count: 312, dropOff: 22 },
      { step: 'RSVP Completed', count: 268, dropOff: 14 },
    ],
    engagementActions: {
      calendar_added: 143, directions_clicked: 118, guest_pass_downloaded: 96,
      gallery_viewed: 74, share_clicked: 41, music_played: 33, seating_searched: 22,
    },
    reveal: { shown: 640, opened: 511, skipped: 96, failed: 3, openRate: 80, medianMsToOpen: 3400 },
    timeline: Array.from({ length: 14 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 7, 18 + i));
      const wave = Math.round(40 + 70 * Math.sin((i / 13) * Math.PI));
      return {
        date: d.toISOString().slice(0, 10),
        views: wave + 12,
        rsvps: Math.round(wave / 3),
        engagements: Math.round(wave / 2),
      };
    }),
  };
}

let analyticsMode = { engagementAvailable: true };

vi.mock('../../src/app/utils/apiClient', () => ({
  apiFetch: vi.fn(async (p) => {
    if (String(p).includes('/analytics')) return { analytics: analyticsPayload(analyticsMode) };
    if (String(p) === '/events') {
      return { events: [{ id: 'e1', title: 'Nadia & Karim — Wedding', timezone: 'America/Los_Angeles' }] };
    }
    return {};
  }),
}));

vi.mock('../../src/app/utils/usePublicPricing', () => ({
  usePublicPricing: () => ({ tiers: [], loading: false }),
}));

const CheckinDevicesPage = (await import('../../src/app/admin/(panel)/checkin-devices/page')).default;
const AnalyticsPage = (await import('../../src/app/dashboard/analytics/page')).default;

async function stage(name, element, width) {
  const r = render(element);
  // Awaited act so the mount fetch settles — without it every screen
  // photographs as its loading skeleton, which looks like a data bug.
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  fs.writeFileSync(path.join(OUT, `${name}.html`), page(r.container.innerHTML), 'utf8');
  fs.writeFileSync(path.join(OUT, `frame-${name}-${width}.html`), frame(name, width), 'utf8');
  r.unmount();
}

describe('analytics + check-in devices probe', () => {
  it('stages both repaired screens, at desktop and at a real phone width', async () => {
    fs.mkdirSync(OUT, { recursive: true });

    for (const w of [1080, 390]) {
      await stage(`devices-${w}`, <CheckinDevicesPage />, w);

      analyticsMode = { engagementAvailable: true };
      await stage(`analytics-${w}`, <AnalyticsPage />, w);

      // The state that previously rendered as a confident wall of zeroes.
      analyticsMode = { engagementAvailable: false };
      await stage(`analytics-degraded-${w}`, <AnalyticsPage />, w);
    }
    analyticsMode = { engagementAvailable: true };

    // eslint-disable-next-line no-console
    console.log('STAGED ->', OUT, '| CSS:', FONTS.source);
  });
});
