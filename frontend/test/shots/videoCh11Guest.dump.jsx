/* ═══════════════════════════════════════════════════════════════════════════
   CHAPTER 11 — THE GUEST JOURNEY. Screens staged for the walkthrough video.

   Every frame here is the component that actually ships, rendering
   real-shaped data. The couple, the date and the venue are sample data the
   way any demo's are; every pixel around them is drawn by RsvpSection,
   WaxEnvelopeOpening and SwanLakeHero themselves.

   ── Running it ───────────────────────────────────────────────────────────
     cd frontend
     npx next build                                       # once; supplies the CSS
     npx vitest run --config vitest.shots.config.mjs test/shots/videoCh11Guest.dump.jsx
     node ../e2e/video/record.js ch11 --verify            # contact sheet first
     node ../e2e/video/record.js ch11                     # then the video

   Output: .visual/video/stage/ch11/*.html  (git-ignored)

   NOTE ON THE FILE NAME: it lives in test/shots/ rather than a video/
   subfolder on purpose. vitest.shots.config.mjs includes exactly
   'test/shots/*.dump.jsx' — one level, no glob star — so a subfolder would be
   collected by nothing and stage silently. The `video` prefix keeps the
   chapters together in a directory listing without touching that config.
   ═══════════════════════════════════════════════════════════════════════════ */
import React from 'react';
import { describe, it, vi, beforeEach, beforeAll } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import { stageScreen, settle } from './videoStage';

/* Reduced motion would skip precisely the entrances this chapter is about. */
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useReducedMotion: () => false };
});

/* The RSVP section asks the backend three things on mount: whether this
   contact has already answered, the seating lookup, and the submit endpoint.
   Mocked at the module boundary, so the component under the camera is
   untouched. An empty answer is the correct one for a guest arriving fresh. */
vi.mock('../../src/app/utils/publicApi', () => ({
  publicApiFetch: vi.fn(async () => ({})),
  PublicApiError: class extends Error {},
  API_URL: 'http://localhost:5000',
}));

import RsvpSection from '../../src/app/components/templates/heritageArch/sections/RsvpSection';
import { FullPageThemeProvider, buildPalette } from '../../src/app/components/templates/heritageArch/theme';
import GuestPassCard from '../../src/app/components/guest/GuestPassGenerator';
import WaxEnvelopeOpening from '../../src/app/components/guest/openings/WaxEnvelopeOpening';
import SwanLakeHero from '../../src/app/components/templates/cinematic/SwanLakeHero';
import { CINEMATIC_TEMPLATES } from '../../src/app/components/templates/cinematic/cinematicThemes';
import { OPENING_TIMINGS } from '../../src/app/components/guest/openings/openingSafety';

import fs from 'node:fs';
import path from 'node:path';

/* The cinematic templates ship their own standalone stylesheet; the built app
   CSS is neither needed nor wanted around them. */
const CINE_CSS = fs.readFileSync(
  path.join(process.cwd(), 'src/app/styles/cinematic.css'), 'utf8',
);

/* ── The sample event ────────────────────────────────────────────────────
   Shaped exactly like a row of `events` as the guest renderer reads it —
   snake_case, template_data as a nested object. Kept deliberately RICH: this
   is the frame that has to show a viewer what the form can ask, so the meal
   options, the two sides and a custom question all need to exist. */
const EVENT = {
  id: 'demo-event',
  slug: 'nadia-and-omar',
  title: 'Nadia & Omar',
  event_type: 'wedding',
  template_type: 'swans',
  /* A REAL INSTANT, read back in the organizer's zone. The venue is in
     Alexandria, so the zone is Cairo: 16:30Z renders as 6:30 PM on the
     pass and the invitation. With the harness's Los_Angeles default the
     same instant printed "11:30 AM" on a wedding pass for a venue eleven
     hours away — true to the data and obviously wrong to a viewer. */
  event_date: '2027-05-14T16:30:00.000Z',
  timezone: 'Africa/Cairo',
  venue_name: 'Beit Al Qamar',
  venue_address: '12 Corniche Road, Alexandria',
  collect_dietary_restrictions: true,
  ask_which_side: true,
  no_kids_allowed: true,
  allow_guest_edits: true,
  rsvp_deadline: '2027-04-20',
  max_party_size: 20,
  custom_colors: { primary: '#7a2f3a', accent: '#c9a45c', background: '#f6f1e4' },
  template_data: {
    groom_name: 'Omar',
    bride_name: 'Nadia',
    meal_options: ['Beef Short Rib', 'Sea Bass', 'Wild Mushroom Risotto'],
  },
  custom_form_fields: [
    {
      id: 'song',
      label: 'A song that will get you on the dance floor',
      type: 'text',
      required: false,
      condition: 'attending',
      scope: 'party',
      placeholder: 'Artist — Title',
    },
  ],
};

beforeAll(() => {
  /* vitest compiles JSX with the CLASSIC runtime, so every component needs
     `React` in scope; Next uses the automatic runtime, so a component that
     never touches the React namespace has no reason to import it. Supplied as
     a global rather than by switching the shared vitest.shots.config.mjs,
     which every other probe in this folder already runs green under. */
  global.React = React;

  /* jsdom has no layout engine, so anything that measures itself reports zero
     and lays out as if it had no room. The seating panel and the confetti
     canvas both do. A hardcoded rect is what the still probes feed them too. */
  global.ResizeObserver = class {
    constructor(cb) { this.cb = cb; }
    observe(el) { this.cb([{ target: el, contentRect: { width: 358, height: 520 } }], this); }
    unobserve() {} disconnect() {}
  };
  global.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; }
    observe(el) { this.cb([{ target: el, isIntersecting: true, intersectionRatio: 1 }], this); }
    unobserve() {} disconnect() {} takeRecords() { return []; }
  };
});

beforeEach(() => {
  window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  window.HTMLMediaElement.prototype.pause = vi.fn();
  window.HTMLMediaElement.prototype.load = vi.fn();
  window.scrollTo = vi.fn();

  /* The wax opening builds an AudioContext at mount to decode its samples.
     jsdom has none, and the throw takes the whole cover down with it. */
  window.AudioContext = vi.fn(() => ({
    state: 'running', currentTime: 0, sampleRate: 44100,
    resume: () => Promise.resolve(), close: () => {},
    createOscillator: () => ({ type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, value: 0 }, connect: () => ({ connect: () => {} }), start() {}, stop() {} }),
    createGain: () => ({ gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({ connect: () => {} }) }),
    createBiquadFilter: () => ({ type: '', frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, Q: { value: 0 }, connect: () => ({ connect: () => {} }) }),
    createBufferSource: () => ({ buffer: null, playbackRate: { value: 1 }, connect: () => ({ connect: () => {} }), start() {} }),
    createBuffer: (_c, len) => ({ getChannelData: () => new Float32Array(len) }),
    decodeAudioData: () => Promise.reject(new Error('no decoder in jsdom')),
    destination: {},
  }));
});

/* A phone-width shell. The video composes at a true 390px and never scales,
   so the staged page must BE 390px rather than be shrunk into it later. */
const PHONE = `
  html,body{width:390px;margin:0;}
  body{overflow-x:hidden;}
`;

function stageRsvp(name, extraProps = {}) {
  return render(
    <FullPageThemeProvider palette={buildPalette(EVENT.custom_colors, 'swans')}>
      <div style={{ width: 390 }}>
        <RsvpSection
          event={EVENT}
          slug={EVENT.slug}
          guestRsvp={null}
          hasResponded={false}
          responseStatus={null}
          allowGuestEdits
          effectiveRsvpId={null}
          isRTL={false}
          trackEvent={() => {}}
          {...extraProps}
        />
      </div>
    </FullPageThemeProvider>,
  );
}

/* The cinematic pages are their own full-bleed surface: no app CSS, black
   ground, and the phone's true 390x844. */
const CINE_SHELL = `
  html,body{width:390px;height:844px;margin:0;background:#000;overflow:hidden;}
`;

describe('video ch11 — the guest journey', () => {
  /**
   * The sealed envelope and the invitation under it, staged HERE rather than
   * reused from templateShots.dump.jsx.
   *
   * That probe stages the same two components for the marketing page, with a
   * different sample couple per template so the homepage rows do not repeat a
   * name — "Adam & Mira" for Swan Lake. Borrowing them put a film on screen
   * whose envelope and invitation said Adam & Mira while the entry pass three
   * shots later said Nadia & Omar. Nobody needs to know the product to catch
   * that, so the couple is staged here, once, from this chapter's own EVENT.
   */
  it('stages the sealed envelope', async () => {
    vi.useFakeTimers();
    const { container, unmount } = render(
      <WaxEnvelopeOpening
        template={CINEMATIC_TEMPLATES.swans}
        lang="en"
        /* A STRING, not an array. WaxEnvelopeOpening renders `{names}`
           straight out, so an array of two strings concatenates with no
           separator and the envelope reads "NadiaOmar". */
        names="Nadia &amp; Omar"
        onComplete={() => {}}
      />,
    );
    /* Past the readiness hard-arm, so the cover shows its real "touch this"
       hint rather than "Loading…". */
    await act(async () => { vi.advanceTimersByTime(OPENING_TIMINGS.readyHardArmMs + 20); });
    stageScreen('ch11', 'cover', container, {
      bare: true, background: '#000', extraCss: CINE_CSS + CINE_SHELL,
    });
    unmount();
    vi.useRealTimers();
  }, 120000);

  it('stages the invitation itself', async () => {
    const { container, unmount } = render(
      <SwanLakeHero
        template={CINEMATIC_TEMPLATES.swans}
        names="Nadia & Omar"
        coupleNames={['Nadia', 'Omar']}
        dateLine="Friday, 14 May 2027"
        isRTL={false}
        // This is the OPENED page: the cover is gone, so the bloom has run.
        openingActive={false}
        invitationPattern="serif"
        invitationTheme={{}}
        invitationGuestName="Nour Haddad"
        invitationData={{}}
      />,
    );
    await settle(act, 8);
    stageScreen('ch11', 'hero', container, {
      bare: true, background: '#000', extraCss: CINE_CSS + CINE_SHELL,
    });
    unmount();
  }, 120000);

  /* The RSVP section as a guest first meets it: the two reply cards, and
     nothing below them yet. Everything under the choice is deliberately not
     rendered until a choice exists, which is the point the caption makes. */
  it('stages the RSVP section, unanswered', async () => {
    const { container, unmount } = stageRsvp('rsvp-choice');
    await settle(act);
    stageScreen('ch11', 'rsvp-choice', container, {
      background: '#f6f1e4',
      extraCss: PHONE,
    });
    unmount();
  }, 120000);

  /**
   * The same section AFTER the guest says yes.
   *
   * Attendance is the component's own internal state, so there is no prop that
   * sets it. Rather than stage a second, hand-built approximation of the
   * "opened" form, the real button is clicked — the state that follows is the
   * component's, reached the way a guest reaches it. That is the difference
   * between filming the product and filming a drawing of it.
   */
  it('stages the RSVP form once the guest accepts', async () => {
    const { container, unmount } = stageRsvp();
    await settle(act);

    const yes = container.querySelector('[role="radiogroup"] button');
    if (!yes) throw new Error('No attendance button — RsvpSection\'s markup moved.');
    await act(async () => { fireEvent.click(yes); });
    await settle(act);

    stageScreen('ch11', 'rsvp-attending', container, {
      background: '#f6f1e4',
      extraCss: PHONE,
    });
    unmount();
  }, 180000);

  /**
   * The entry pass a guest is given once they have replied.
   *
   * `qrData` is what actually gets encoded, so the code on screen is a real,
   * scannable code for this guest's token — not a picture of one.
   */
  it('stages the QR entry pass', async () => {
    const { container, unmount } = render(
      <div style={{ width: 390, padding: 16 }}>
        <GuestPassCard
          guestName="Nour Haddad"
          eventTitle="Nadia & Omar"
          eventDate={EVENT.event_date}
          eventLocation="Beit Al Qamar, Alexandria"
          eventTimezone={EVENT.timezone}
          tableName="Table 4"
          response="yes"
          qrData="https://fancyrsvp.com/ticket/tok-1"
          themeColor="#B8944F"
          onDownload={() => {}}
          removeWatermark
        />
      </div>,
    );
    await settle(act);
    stageScreen('ch11', 'pass', container, {
      background: '#f6f1e4',
      extraCss: PHONE,
    });
    unmount();
  }, 120000);
});
