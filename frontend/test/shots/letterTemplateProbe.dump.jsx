/* ═══════════════════════════════════════════════════════════════════════════
   SEALED LETTER — the verification contact sheet.

   Everything about this template that a unit test cannot see, on one page:
   the sprite cover in both languages, the hero WITH a photograph and WITHOUT
   one (the frame's own illustration has to stand), the caption plate present
   and absent, and the same landscape photograph at all three focal points —
   which is the control the whole 1:2 panel argument rests on.

   ── Running it ───────────────────────────────────────────────────────────
   1. Stage the HTML (writes .visual/letter/stage/*.html and sheet-*.html):
        npx vitest run --config vitest.shots.config.mjs test/shots/letterTemplateProbe.dump.jsx

   2. Photograph the sheets. ONE page of iframes rather than N invocations:
      Chrome on Windows refuses to open a window under ~500px, so a
      --window-size=390 gives a 500px LAYOUT cropped to a 390px image, which
      looks exactly like horizontal overflow and is not. An iframe is a true
      390px. Each cold start here costs ~40s, so a sheet is also 8x faster.

        chrome --headless=new --disable-gpu --hide-scrollbars \
          --allow-file-access-from-files --user-data-dir=<UNIQUE PER RUN> \
          --window-size=2560,1000 --virtual-time-budget=9000 \
          --screenshot=sheet-390.png sheet-390.html

      --user-data-dir must be unique per invocation: a stale Chrome holding
      the default profile makes every later call hand off and exit silently,
      reporting success and writing nothing.
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

import SealedLetterOpening from '../../src/app/components/guest/openings/SealedLetterOpening';
import LetterFrameHero from '../../src/app/components/templates/cinematic/LetterFrameHero';
import LetterPortraitFields from '../../src/app/components/LetterPortraitFields';
import { CINEMATIC_TEMPLATES } from '../../src/app/components/templates/cinematic/cinematicThemes';
import { OPENING_TIMINGS } from '../../src/app/components/guest/openings/openingSafety';

const LETTER = CINEMATIC_TEMPLATES.letter;
const ROOT = process.cwd();
const OUT = path.join(ROOT, '..', '.visual', 'letter');
const STAGE = path.join(OUT, 'stage');
const CSS = fs.readFileSync(path.join(ROOT, 'src/app/styles/cinematic.css'), 'utf8');
const PUBLIC = path.join(ROOT, 'public').replace(/\\/g, '/');

/* A LANDSCAPE photograph, on purpose. The panel is 1:2, so this is the case
   the focal-point control exists for — a portrait would look fine at every
   setting and prove nothing. Already in public/, so nothing new ships. */
const PHOTO = '/images/hero-wedding.png';
/* A DARK photograph, and the case the first pass never looked at. The caption
   is dark brown on a translucent ivory plate — over white roses that is
   obviously fine, and over a near-black frame it is the one place this design
   can fail. Borrowed from another template's artwork rather than shipped. */
const DARK_PHOTO = '/templates/ring/video-poster.jpg';

const FONTS = `
  *,*::before,*::after { box-sizing: border-box; }
  :root {
    --font-aref:'Traditional Arabic','Amiri',serif; --font-amiri:'Traditional Arabic','Amiri',serif;
    --font-messiri:'Segoe UI'; --font-reem:'Segoe UI'; --font-tajawal:'Segoe UI';
    --font-cormorant:Georgia; --font-sans:'Segoe UI'; --font-serif:Georgia;
    --fx-micro: 11px;
  }
  html,body { margin:0; padding:0; height:100%; background:#f6efe4; }
`;

function stage(name, html, { dir = 'ltr', bg = '#f6efe4' } = {}) {
  fs.mkdirSync(STAGE, { recursive: true });
  // Absolute asset paths ignore <base>, so make them relative to public/.
  const body = html.replace(/\/templates\//g, 'templates/').replace(/\/images\//g, 'images/');
  fs.writeFileSync(path.join(STAGE, `${name}.html`),
    `<!doctype html><html lang="${dir === 'rtl' ? 'ar' : 'en'}" dir="${dir}"><head><meta charset="utf-8">
<base href="file:///${PUBLIC}/"><style>${FONTS}</style><style>html,body{background:${bg};}</style>
<style>${CSS}</style></head><body>${body}</body></html>`, 'utf8');
}

/** One contact sheet, N true-width iframes side by side, each captioned. */
function sheet(file, width, height, names) {
  const cells = names.map(([name, label]) => `
    <figure>
      <iframe src="stage/${name}.html" scrolling="no"
              style="width:${width}px;height:${height}px"></iframe>
      <figcaption>${label}</figcaption>
    </figure>`).join('');

  fs.writeFileSync(path.join(OUT, file), `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#111;font:12px/1.4 'Segoe UI',sans-serif;color:#ddd;}
  .row{display:flex;gap:14px;padding:14px;align-items:flex-start;}
  figure{margin:0;}
  iframe{border:0;display:block;background:#fff;}
  figcaption{padding:6px 2px 0;text-align:center;}
</style></head><body><div class="row">${cells}</div></body></html>`, 'utf8');
}

beforeEach(() => {
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

const heroBase = {
  template: LETTER,
  invitationPattern: 'serif',
  invitationTheme: {},
  invitationGuestName: 'Guest',
  invitationData: {},
  openingActive: false,
};

async function stageHero(name, props, opts) {
  const r = render(<LetterFrameHero {...heroBase} {...props} />);
  await act(async () => { await new Promise((res) => setTimeout(res, 250)); });
  stage(name, r.container.innerHTML, opts);
  r.unmount();
}

describe('sealed letter — contact sheet', () => {
  it('stages the cover in both languages', async () => {
    for (const [name, lang, names] of [
      ['cover-en', 'en', 'Noor & Yusuf'],
      ['cover-ar', 'ar', 'نور & يوسف'],
    ]) {
      vi.useFakeTimers();
      const { container, unmount } = render(
        <SealedLetterOpening template={LETTER} lang={lang} names={names} onComplete={() => {}} />,
      );
      // Past the readiness hard-arm, so the cover shows its real hint rather
      // than "Loading…".
      await act(async () => { vi.advanceTimersByTime(OPENING_TIMINGS.readyHardArmMs + 20); });
      stage(name, container.innerHTML, { dir: lang === 'ar' ? 'rtl' : 'ltr' });
      unmount();
      vi.useRealTimers();
    }
  });

  it('stages the hero, with and without the organizer content', async () => {
    const en = {
      names: 'Noor & Yusuf', coupleNames: ['Noor', 'Yusuf'],
      dateLine: 'Saturday, 12 September 2026', isRTL: false, occasion: 'wedding',
    };

    // The finished, filled-in article.
    await stageHero('hero-photo-en', {
      ...en, heroPhoto: PHOTO, heroFocus: 'center',
      heroCaption: 'Where it all begins', heroCaptionSub: 'Beirut · September 2026',
    });

    // Arabic, RTL — the direction traps live here, not in English.
    await stageHero('hero-photo-ar', {
      names: 'نور & يوسف', coupleNames: ['نور', 'يوسف'],
      dateLine: 'السبت ١٢ سبتمبر ٢٠٢٦', isRTL: true, occasion: 'wedding',
      heroPhoto: PHOTO, heroFocus: 'center',
      heroCaption: 'حيث يبدأ كل شيء', heroCaptionSub: 'بيروت · سبتمبر ٢٠٢٦',
    }, { dir: 'rtl' });

    /* THE state that must not look broken: nothing uploaded, so the frame's
       own illustrated couple has to stand on its own. This is also the ONLY
       state that renders the occasion tagline — with a photograph there is no
       room for it above the picture — so it is passed here and nowhere else,
       and this is where that branch gets looked at. */
    await stageHero('hero-empty-en', {
      ...en,
      tagline: 'invite you to share the joy of their wedding',
    });

    // A photograph but no words — the plate must be absent, not an empty band.
    await stageHero('hero-nocaption-en', { ...en, heroPhoto: PHOTO, heroFocus: 'top' });

    // The contrast case: dark type on a translucent plate over a dark picture.
    await stageHero('hero-dark-en', {
      ...en, heroPhoto: DARK_PHOTO, heroFocus: 'center',
      heroCaption: 'Where it all begins', heroCaptionSub: 'Beirut · September 2026',
    });

    // The control, on a landscape photo in a 1:2 panel.
    for (const focus of ['top', 'center', 'bottom']) {
      await stageHero(`hero-focus-${focus}`, {
        ...en, heroPhoto: PHOTO, heroFocus: focus, heroCaption: `Focus: ${focus}`,
      });
    }
  });

  it('stages the organizer editor', async () => {
    const r = render(
      <div style={{ padding: 20, background: '#fff', fontFamily: "'Segoe UI',sans-serif" }}>
        <LetterPortraitFields
          value={{
            letter_hero_photo: PHOTO,
            letter_hero_focus: 'center',
            letter_hero_caption: 'Where it all begins',
            letter_hero_caption_sub: 'Beirut · September 2026',
          }}
          onChange={() => {}}
          onUploadImage={async () => null}
        />
      </div>,
    );
    await act(async () => { await new Promise((res) => setTimeout(res, 100)); });
    stage('editor', r.container.innerHTML, { bg: '#ffffff' });
    r.unmount();
  });

  it('writes the sheets', () => {
    sheet('sheet-390.html', 390, 844, [
      ['cover-en', 'cover · en'],
      ['cover-ar', 'cover · ar'],
      ['hero-photo-en', 'hero · photo · en'],
      ['hero-photo-ar', 'hero · photo · ar'],
      ['hero-empty-en', 'hero · NO photo'],
      ['hero-nocaption-en', 'hero · no caption'],
      ['hero-dark-en', 'hero · DARK photo'],
    ]);

    sheet('sheet-focus.html', 390, 844, [
      ['hero-focus-top', 'focus: top'],
      ['hero-focus-center', 'focus: centre'],
      ['hero-focus-bottom', 'focus: bottom'],
    ]);

    // 768px: the frame stops growing and centres on more paper. Worth seeing,
    // because that is where the reserved foot and the type sizes change.
    sheet('sheet-768.html', 768, 1024, [
      ['hero-photo-en', 'hero · photo · en'],
      ['hero-empty-en', 'hero · NO photo'],
      ['cover-en', 'cover · en'],
    ]);

    sheet('sheet-editor.html', 720, 640, [['editor', 'organizer editor']]);
  });
});
