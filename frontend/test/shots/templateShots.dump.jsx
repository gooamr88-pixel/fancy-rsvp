/* ═══════════════════════════════════════════════════════════════════════════
   The invitation screenshots on the homepage, staged from the real components.

   WHY THIS EXISTS

   The landing page used to draw its own approximations of the product. Every
   frame in TemplatesShowcaseSection is now a photograph of the actual thing:
   VelvetBoxOpening, KnockDoorOpening, WaxEnvelopeOpening and their heroes,
   rendered at a true 390px phone width with the real cinematic.css.

   Redesign a template and re-run this, and the homepage cannot go on showing
   an invitation that no longer exists. That is the whole point — a hand-drawn
   copy silently would, and did.

   ── Running it ───────────────────────────────────────────────────────────
   1. Stage the HTML (writes .visual/landing/stage/*.html):
        npx vitest run --config vitest.shots.config.mjs

   2. Photograph each one. The iframe is a TRUE 390px; density comes from
      --force-device-scale-factor. Do NOT scale the iframe with a CSS
      transform — a scaled iframe paints only its own unscaled surface and the
      bottom half of every capture comes out black. Chrome on Windows will not
      open a window under ~500px, so the surplus is cropped afterwards:

        chrome --headless=new --disable-gpu --hide-scrollbars \
          --allow-file-access-from-files --force-device-scale-factor=2 \
          --window-size=500,844 --virtual-time-budget=8000 \
          --screenshot=raw-<name>.png frame-<name>.html

   3. Crop the window surplus and size for the page (displayed at ~208px, so
      468 is comfortably past 2x):

        ffmpeg -i raw-<name>.png -vf "crop=780:1688:0:0,scale=468:-1" \
          -quality 74 frontend/public/images/landing/<name>.webp

   Keep the whole set under ~250KB. The frame-*.html wrappers live beside the
   staged output in .visual/landing/.
   ═══════════════════════════════════════════════════════════════════════════ */
import React from 'react';
import { describe, it, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useReducedMotion: () => false };
});

import VelvetBoxOpening from '../../src/app/components/guest/openings/VelvetBoxOpening';
import KnockDoorOpening from '../../src/app/components/guest/openings/KnockDoorOpening';
import WaxEnvelopeOpening from '../../src/app/components/guest/openings/WaxEnvelopeOpening';
import SealedLetterOpening from '../../src/app/components/guest/openings/SealedLetterOpening';
import VelvetRingHero from '../../src/app/components/templates/cinematic/VelvetRingHero';
import DoorOfJoyHero from '../../src/app/components/templates/cinematic/DoorOfJoyHero';
import SwanLakeHero from '../../src/app/components/templates/cinematic/SwanLakeHero';
import LetterPortraitHero from '../../src/app/components/templates/cinematic/LetterPortraitHero';
import { CINEMATIC_TEMPLATES } from '../../src/app/components/templates/cinematic/cinematicThemes';
import { OPENING_TIMINGS } from '../../src/app/components/guest/openings/openingSafety';

const ROOT = process.cwd();
const OUT = path.join(ROOT, '..', '.visual', 'landing');
const STAGE = path.join(OUT, 'stage');
const CSS = fs.readFileSync(path.join(ROOT, 'src/app/styles/cinematic.css'), 'utf8');
const PUBLIC = path.join(ROOT, 'public').replace(/\\/g, '/');

/* next/font is unavailable offline; the nearest local faces keep the type at
   roughly the right texture. Arabic display faces fall back to a serif. */
const FONTS = `
  *,*::before,*::after { box-sizing: border-box; }
  :root {
    --font-aref:'Traditional Arabic','Amiri',serif; --font-amiri:'Traditional Arabic','Amiri',serif;
    --font-messiri:'Segoe UI'; --font-reem:'Segoe UI'; --font-tajawal:'Segoe UI';
    --font-cormorant:Georgia; --font-sans:'Segoe UI'; --font-serif:Georgia;
  }
  html,body { margin:0; padding:0; height:100%; background:#000; }
`;

function stage(name, html) {
  fs.mkdirSync(STAGE, { recursive: true });
  // Absolute asset paths ignore <base>, so make them relative to public/.
  fs.writeFileSync(path.join(STAGE, `${name}.html`),
    `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8">
<base href="file:///${PUBLIC}/"><style>${FONTS}</style><style>${CSS}</style>
</head><body>${html.replace(/\/templates\//g, 'templates/')}</body></html>`, 'utf8');

  fs.writeFileSync(path.join(OUT, `frame-${name}.html`),
    `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#000;overflow:hidden;}
  iframe{position:absolute;top:0;left:0;width:390px;height:844px;border:0;}
</style></head><body><iframe src="stage/${name}.html" scrolling="no"></iframe></body></html>`, 'utf8');
}

beforeEach(() => {
  window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  window.HTMLMediaElement.prototype.pause = vi.fn();
  window.HTMLMediaElement.prototype.load = vi.fn();
  // The knock and wax openings build one at mount to decode their samples.
  window.AudioContext = vi.fn(() => ({
    state: 'running', currentTime: 0, sampleRate: 44100,
    resume: () => Promise.resolve(), close: () => {},
    createOscillator: () => ({ type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, value: 0 }, connect: () => ({ connect: () => {} }), start() {}, stop() {} }),
    createGain: () => ({ gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({ connect: () => {} }) }),
    createBiquadFilter: () => ({ type: '', frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, Q: { value: 0 }, connect: () => ({ connect: () => {} }) }),
    createBufferSource: () => ({ buffer: null, playbackRate: { value: 1 }, connect: () => ({ connect: () => {} }), start() {} }),
    createBuffer: (_c, len) => ({ getChannelData: () => new Float32Array(len) }),
    decodeAudioData: () => Promise.reject(new Error('no decoder in jsdom')), destination: {},
  }));
});

/* Sample couples, one per template, so the rows do not repeat a name. */
const OPENINGS = [
  ['ring', VelvetBoxOpening, 'Aria & Julian'],
  ['bab', KnockDoorOpening, 'Layla & Karim'],
  ['swans', WaxEnvelopeOpening, 'Adam & Mira'],
  ['letter', SealedLetterOpening, 'Noor & Yusuf'],
];
const HEROES = [
  ['ring', VelvetRingHero, ['Aria', 'Julian']],
  ['bab', DoorOfJoyHero, ['Layla', 'Karim']],
  ['swans', SwanLakeHero, ['Adam', 'Mira']],
  /* Sealed Letter is photographed AS SHIPPED — no organizer photograph in the
     panel, so the frame keeps its own illustration.

     That is a deliberate choice, not an omission. The band's whole guarantee
     is that every picture is the real template and not an artist's
     impression; dropping a stand-in couple into the panel would be
     photographing an event that does not exist and implying the picture came
     with the template. The plate's copy carries the claim instead — "with
     your own photograph inside it" — and the empty panel is the template's
     genuine, finished default state. */
  ['letter', LetterPortraitHero, ['Noor', 'Yusuf']],
];

describe('landing — template shots', () => {
  it('stages every cover', async () => {
    for (const [key, Comp, names] of OPENINGS) {
      vi.useFakeTimers();
      const { container, unmount } = render(
        <Comp template={CINEMATIC_TEMPLATES[key]} lang="en" names={names} onComplete={() => {}} />,
      );
      /* Past the readiness hard-arm, so the cover shows its real "touch this"
         hint rather than "Loading…". */
      await act(async () => { vi.advanceTimersByTime(OPENING_TIMINGS.readyHardArmMs + 20); });
      stage(`cover-${key}`, container.innerHTML);
      unmount();
      vi.useRealTimers();
    }
  });

  it('stages every hero', async () => {
    for (const [key, Comp, couple] of HEROES) {
      const r = render(
        <Comp
          template={CINEMATIC_TEMPLATES[key]}
          names={couple.join(' & ')}
          coupleNames={couple}
          dateLine="Saturday, 12 September 2026"
          isRTL={false}
          // Swan Lake holds its embossed state while a cover is up; this is
          // the opened page, so the bloom has already run.
          openingActive={false}
          invitationPattern="serif"
          invitationTheme={{}}
          invitationGuestName="Guest"
          invitationData={{}}
        />,
      );
      await act(async () => { await new Promise((res) => setTimeout(res, 250)); });
      stage(`hero-${key}`, r.container.innerHTML);
      r.unmount();
    }
  });
});
