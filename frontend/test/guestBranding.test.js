import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isWhiteLabel, guestTitle } from '../src/app/utils/guestBranding';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const readApp = (rel) => fs.readFileSync(path.join(ROOT, '..', 'src', 'app', rel), 'utf8');

/**
 * WHITE LABEL ON THE SURFACES THE FRONTEND BRANDS BY ITSELF.
 *
 * The backend strips our marks from the watermark, the entry pass and every
 * event email. Four more decisions are made here, and every one of them is
 * invisible in a screenshot — which is exactly why the first pass at this
 * feature missed them:
 *
 *   • the share preview WhatsApp and iMessage build from the OG tags. This is
 *     the FIRST thing a guest sees, before the unbranded page even loads;
 *   • the browser tab, set once by the server and again on hydration — miss the
 *     second and the fix is only visible with JavaScript off;
 *   • the JSON-LD organizer, read by search engines and preview builders;
 *   • the .ics file the guest downloads into their calendar.
 */
describe('isWhiteLabel', () => {
  it('is true only when the entitlement column says so', () => {
    expect(isWhiteLabel({ tier_white_label: true })).toBe(true);
    expect(isWhiteLabel({ tier_white_label: false })).toBe(false);
  });

  it('treats an unknown entitlement as NOT white-labelled', () => {
    // A deployment that has not applied 20260830000003 yet sends no column at
    // all. The mark stays on until the entitlement is certain — the opposite
    // default would strip branding from every event on a mis-ordered deploy.
    expect(isWhiteLabel({})).toBe(false);
    expect(isWhiteLabel(null)).toBe(false);
    expect(isWhiteLabel(undefined)).toBe(false);
  });
});

describe('guestTitle', () => {
  const EVENT = { title: 'Evan & Angelina' };

  it('appends our name for an ordinary event', () => {
    expect(guestTitle(EVENT)).toBe('Evan & Angelina | Fancy RSVP');
  });

  it('gives a white-label event the host name alone', () => {
    expect(guestTitle({ ...EVENT, tier_white_label: true })).toBe('Evan & Angelina');
  });

  it('keeps the caller prefix in both cases', () => {
    expect(guestTitle(EVENT, 'RSVP - ')).toBe('RSVP - Evan & Angelina | Fancy RSVP');
    expect(guestTitle({ ...EVENT, tier_white_label: true }, 'RSVP - ')).toBe('RSVP - Evan & Angelina');
  });

  it('never renders "undefined" when an event has no title', () => {
    expect(guestTitle({ tier_white_label: true })).toBe('Event');
    expect(guestTitle(null)).toBe('Event | Fancy RSVP');
  });
});

/**
 * The helper being correct proves nothing if a surface stopped calling it. These
 * bind the four to it — a source check, because importing a Next server page or
 * the guest bundle into vitest pulls in half the app to assert one string.
 */
describe('every guest surface asks the helper', () => {
  it.each([
    ['[slug]/page.js', 'the share preview and JSON-LD'],
    ['[slug]/EventPageClient.js', 'the invitation tab title'],
    ['[slug]/rsvp/RsvpWizard.js', 'the RSVP tab title'],
    ['components/guest/GuestUI.js', 'the .ics calendar file'],
  ])('%s brands %s through utils/guestBranding', (file) => {
    const src = readApp(file);

    expect(src).toMatch(/from '.*utils\/guestBranding'/);
    // And no hand-rolled copy of the condition left behind beside it.
    expect(src).not.toMatch(/tier_white_label\s*\?/);
  });

  it('the share preview drops our fallback card as well as our name', () => {
    // A white-label event with no cover image used to fall back to og-image.png
    // — our artwork, with our name on it, as the preview for someone's wedding.
    const src = readApp('[slug]/page.js');
    const fallback = src.slice(src.indexOf('og-image.png') - 400, src.indexOf('og-image.png'));

    expect(fallback).toMatch(/whiteLabel/);
  });
});
