import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

/* ═══════════════════════════════════════════════════════════════════════════
   EVERY ADMIN SECTION CAN ACTUALLY MOUNT.

   `/admin/checkin-devices` shipped with `onRefresh={load}` against a function
   that was named `reload` — there has never been a `load` in that file. It threw
   `ReferenceError: load is not defined` while building the JSX, so the component
   never mounted on any render, for any operator, ever. What the operator saw was
   the App Router error boundary and its "Try again" button, which reads as a
   flaky network rather than a screen that has never once worked.

   Three separate safety nets had nothing to say about it:

     • eslint — `no-undef` was not enabled (it is now; see eslint.config.mjs).
       Running eslint on the broken file exited 0 with no output.
     • scripts/parseCheck.js — the file is syntactically perfect. A reference to
       a name that does not exist is a RUNTIME error.
     • the test suite — 52 files and 952 tests, and NOT ONE rendered anything
       under src/app/admin. The admin panel had no coverage of any kind.

   This closes the third. It is deliberately the shallowest possible test: mount
   each section, assert it did not throw. It asserts nothing about what any of
   them display, because a smoke test that also pins content is one everybody
   learns to update without reading — and the failure being guarded here is
   "the screen is dead", which mounting catches on its own.

   The `no-undef` rule now catches this class before the tests run. Both exist
   because they fail differently: the lint rule cannot see a name that IS defined
   but is undefined at the moment it is read (a TDZ, a hoisting mistake, a
   conditional import), and mounting cannot see an unreachable branch.
   ═══════════════════════════════════════════════════════════════════════════ */

/* The one thing that must not be real. Every page fetches on mount; without this
   they would reach the network, and `usePermissions` falls back to its own
   GET /admin/me when no provider is present (which is the case here — these are
   mounted bare, not under AdminShell).

   The shape is deliberately permissive rather than accurate: `data` carries the
   containers the list screens read, and `me` grants everything so permission-
   gated branches render instead of being skipped. A page that needs a shape
   this does not provide should say so by failing. */
function emptyResponse() {
  /* `data` is an EMPTY ARRAY CARRYING NAMED PROPERTIES, and that is not a trick
     for its own sake — the two admin data-loading styles disagree about what
     `data` is, and one mock has to satisfy both.

       • useAdminList's default `pick` is `(r) => r?.data || []`, so it needs an
         ARRAY, and hands the result straight to `rows.map(...)`.
       • The screens that load by hand — checkin-devices is one — read
         `res.data.devices`, `res.data.counts`, so they need an OBJECT.

     An array IS an object, so one value is honestly both: `.map` iterates
     nothing, and every named container reads as empty. The alternative is a
     per-page mock table, which is a second copy of the API contract that nobody
     updates. */
  const data = Object.assign([], {
    devices: [], counts: null, rows: [], items: [], events: [], users: [],
    organizers: [], payments: [], credits: [], roles: [], codes: [], posts: [],
    inquiries: [], testimonials: [], mentions: [], products: [], categories: [],
    orders: [], entries: [], logs: [], sessions: [],
  });

  return {
    success: true,
    me: { id: 'admin-1', email: 'ops@fancyrsvp.com', isSuperAdmin: true, permissions: ['*'] },
    data,
    rows: [],
    items: [],
    pagination: { page: 1, totalPages: 1, total: 0 },
  };
}

vi.mock('../src/app/admin/_lib/adminApi', () => {
  const api = {
    get: vi.fn(async () => emptyResponse()),
    post: vi.fn(async () => emptyResponse()),
    put: vi.fn(async () => emptyResponse()),
    patch: vi.fn(async () => emptyResponse()),
    del: vi.fn(async () => emptyResponse()),
  };
  return { adminApi: api, default: api };
});

/**
 * Every section under /admin, by route segment.
 *
 * Listed explicitly rather than globbed. A glob would silently cover a new
 * section — which sounds better until one is added that this harness cannot
 * mount, and the fix becomes "delete it from the glob" in a file nobody is
 * reading. Adding a line here is the deliberate act.
 */
const SECTIONS = [
  ['audit', () => import('../src/app/admin/(panel)/audit/page')],
  ['checkin-devices', () => import('../src/app/admin/(panel)/checkin-devices/page')],
  ['cms', () => import('../src/app/admin/(panel)/cms/page')],
  ['config', () => import('../src/app/admin/(panel)/config/page')],
  ['credits', () => import('../src/app/admin/(panel)/credits/page')],
  ['events', () => import('../src/app/admin/(panel)/events/page')],
  ['finance', () => import('../src/app/admin/(panel)/finance/page')],
  ['health', () => import('../src/app/admin/(panel)/health/page')],
  ['marketing', () => import('../src/app/admin/(panel)/marketing/page')],
  ['organizers', () => import('../src/app/admin/(panel)/organizers/page')],
  ['overview', () => import('../src/app/admin/(panel)/overview/page')],
  ['payments', () => import('../src/app/admin/(panel)/payments/page')],
  ['promo-codes', () => import('../src/app/admin/(panel)/promo-codes/page')],
  ['roles', () => import('../src/app/admin/(panel)/roles/page')],
  ['security', () => import('../src/app/admin/(panel)/security/page')],
  ['shop', () => import('../src/app/admin/(panel)/shop/page')],
  ['users', () => import('../src/app/admin/(panel)/users/page')],
];

beforeEach(() => { vi.clearAllMocks(); });

describe('every /admin section mounts', () => {
  for (const [name, load] of SECTIONS) {
    it(`/admin/${name} renders without throwing`, async () => {
      const mod = await load();
      const Page = mod.default;
      expect(typeof Page, `/admin/${name} has no default export`).toBe('function');

      let error = null;
      /* Wrapped in act and awaited so the mount effects — every one of these
         pages fetches on mount — settle inside the assertion rather than after
         it. A crash in the effect's setState path lands here too, not as an
         unhandled rejection in whichever test happens to run next. */
      await act(async () => {
        try {
          render(<Page />);
        } catch (err) {
          error = err;
        }
      });

      expect(error, `/admin/${name} threw on mount: ${error?.message}`).toBe(null);
    });
  }
});
