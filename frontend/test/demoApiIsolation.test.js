import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, installDemoApi, demoApiInstalled } from '../src/app/utils/apiClient';
import { answerFor } from '../src/app/demo/fixtures/demoOrganizer.mjs';

/* ═══════════════════════════════════════════════════════════════════════════
   THE GUARD THAT PROTECTS PAYING ORGANIZERS.

   /demo mounts the real dashboard screens against a sample wedding, and two
   of those screens fetch their own data, so `apiFetch` carries a slot a demo
   router can occupy. The failure mode of that slot is not a broken demo — it
   is a signed-in organizer opening their own dashboard and being shown Nadia
   and Omar's guest list.

   Three things have to hold, and none of them is checkable by eye:

     1. an empty slot changes nothing — apiFetch still goes to the network;
     2. an installed router answers ONLY inside /demo, decided per call
        rather than at install time, so a client-side navigation out of the
        demo cannot outlive it;
     3. uninstalling actually uninstalls.

   Guard 2 is the one worth the most: it is what makes guard 1 and 3
   redundant rather than load-bearing. A test that only proved the cleanup
   ran would pass on a build where the cleanup was the only thing standing
   between an organizer and somebody else's data.
   ═══════════════════════════════════════════════════════════════════════════ */

const okJson = (body) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'application/json' },
  json: async () => body,
});

/** jsdom will not let `location.pathname` be assigned; history will. */
const goTo = (path) => window.history.pushState({}, '', path);

describe('the demo API router cannot reach a real organizer', () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.fn(async () => okJson({ success: true, from: 'network' }));
    vi.stubGlobal('fetch', fetchSpy);
    goTo('/');
  });

  afterEach(() => {
    installDemoApi(null);
    vi.unstubAllGlobals();
    goTo('/');
  });

  it('starts with an empty slot', () => {
    expect(demoApiInstalled()).toBe(false);
  });

  it('goes to the network when nothing is installed, even on a /demo path', async () => {
    goTo('/demo/dashboard');
    const res = await apiFetch('/dashboard');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.from).toBe('network');
  });

  it('answers from the fixture inside /demo', async () => {
    installDemoApi((path) => answerFor(path));
    goTo('/demo/dashboard');

    const res = await apiFetch('/dashboard');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.dashboard.totalEvents).toBeGreaterThan(0);
  });

  it('REFUSES to answer outside /demo, even while installed', async () => {
    /* The whole point. Installed at /demo, still installed after a
       client-side navigation to the organizer's own dashboard — and silent
       there, because the pathname is read on every call and not remembered
       from install time. */
    installDemoApi((path) => answerFor(path));
    goTo('/demo/dashboard');
    await apiFetch('/dashboard');
    expect(fetchSpy).not.toHaveBeenCalled();

    goTo('/dashboard');
    const res = await apiFetch('/dashboard');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.from).toBe('network');
  });

  it('is not fooled by a path that merely begins with the letters "demo"', async () => {
    installDemoApi((path) => answerFor(path));
    goTo('/demolition-derby');
    await apiFetch('/dashboard');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('uninstalls when the demo layout unmounts', async () => {
    const uninstall = installDemoApi((path) => answerFor(path));
    expect(demoApiInstalled()).toBe(true);

    uninstall();
    expect(demoApiInstalled()).toBe(false);

    goTo('/demo/dashboard');
    await apiFetch('/dashboard');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('lets a router DECLINE a path, which is how /public still reaches the real API', async () => {
    /* `answerFor` returns undefined for /public/*. Those endpoints need no
       session and answer a demo visitor exactly as they answer an organizer,
       so the shop card and the door-app announcement inside the demo show the
       real catalogue rather than a fixture's guess at it. undefined is a
       decline; `{}` would be an answer. */
    installDemoApi((path) => answerFor(path));
    goTo('/demo/dashboard');

    expect(answerFor('/public/shop')).toBeUndefined();
    const res = await apiFetch('/public/shop');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.from).toBe('network');
  });
});
