/* ═══════════════════════════════════════════════════════════════════════════
   THE COLLECTION, AS A PICTURE.

   Nothing here ships. This stages /collection and one /collection/[key] so
   both can be PHOTOGRAPHED at a desktop width and at a real 390px phone
   before either is called finished. That is the standing rule on this
   project and it is not ceremony: there is no dev server here, and string
   assertions are not verification — test/collection.test.jsx can prove the
   gallery renders four links with the right hrefs and still tell you nothing
   about whether the plates line up or the chips wrap into a mess.

   ── WHAT IS STAGED, AND WHAT CANNOT BE ───────────────────────────────────

   The gallery is staged whole. The detail page is staged in its UNOPENED
   state — the still, the copy, the specs, the breadcrumb, the prev/next rail
   — which is the state every visitor arrives in.

   The OPENED state is deliberately not staged, and that is a limit worth
   stating rather than hiding. Pressing the seal mounts GuestExperiencePreview
   inside PreviewFrame, which portals its whole tree into an IFRAME document;
   jsdom will not paint it and `container.innerHTML` cannot reach it, which is
   why demoStages.dump.jsx replaces PreviewFrame with a flat plate to stage
   the demo at all. What lives behind that button is the shipping guest page,
   already photographed by templateShots.dump.jsx and already reviewed on its
   own — this probe covers the part that is NEW.

     npx next build
     npx vitest run --config vitest.shots.config.mjs collectionProbe

   then photograph, from inside the output directory (a Chrome
   --screenshot= path containing a space writes nothing at all, silently):

     chrome --headless=new --disable-gpu --hide-scrollbars \
       --allow-file-access-from-files --force-device-scale-factor=2 \
       --window-size=1280,2600 --virtual-time-budget=9000 \
       --screenshot=raw-collection1280.png frame-collection1280.html
   ═══════════════════════════════════════════════════════════════════════════ */
import React from 'react';
import { describe, it, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/collection',
  useSearchParams: () => new URLSearchParams(''),
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));

/* Logged out — the state a first-time visitor is in, and the one whose nav
   and CTA copy actually matter. */
vi.mock('../../src/app/hooks/useAuth', () => ({
  useAuth: () => ({ isLoggedIn: false, loading: false, logout: () => {} }),
}));

globalThis.React = React;

import CollectionPage from '../../src/app/collection/page';
import CollectionTemplatePage from '../../src/app/collection/[key]/page';
import { COLLECTION } from '../../src/app/collection/collectionCatalogue';

const ROOT = process.cwd();
const OUT = path.join(ROOT, '..', '.visual', 'collection');
const STAGE = path.join(OUT, 'stage');
const PUBLIC = path.join(ROOT, 'public').replace(/\\/g, '/');

/* Verbatim from landingPageProbe.dump.jsx, and deliberately not imported from
   it: a .dump.jsx is not a module anything should depend on, and vitest.shots
   includes every one of them as a test file. The three asserts are what stop
   this drifting into a lie — a missing font is invisible in a screenshot,
   which is exactly how the homepage was once reviewed entirely in Georgia. */
function appCss() {
  const dir = path.join(ROOT, '.next/static/chunks');
  if (!fs.existsSync(dir)) throw new Error('No .next build. Run `npx next build` first.');
  const css = fs.readdirSync(dir).filter((f) => f.endsWith('.css'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  if (!css.includes('.fx-grid')) throw new Error('Built CSS has no .fx-grid — stale build.');

  /* URL-ENCODED. This repo lives under "C:/Users/yousef amr/", and a raw space
     inside an unquoted CSS url() ends the token — the rule parses as garbage
     and the font falls back silently. */
  const media = encodeURI(path.join(ROOT, '.next/static/media').split(path.sep).join('/'));
  const withFonts = css.replace(/url\(\.\.\/media\//g, 'url(file:///' + media + '/');
  if (!/@font-face\{font-family:Aboreto;/.test(withFonts)) {
    throw new Error('No Aboreto @font-face in the built CSS — the font pipeline moved.');
  }
  return withFonts;
}

/* next/font emits its family names onto a class layout.js puts on <html>. The
   staged page has no such class, so var(--font-cormorant) would be UNDEFINED
   — and an invalid var() inside a font-family list invalidates the whole
   declaration, which silently drops the display face off every heading. */
const FONT_VARS = `
  :root {
    --font-heading: "Aboreto", "Aboreto Fallback";
    --font-body: "Google Sans";
    --font-cormorant: "Cormorant Garamond", "Cormorant Garamond Fallback";
    --font-playfair: "Playfair Display", "Playfair Display Fallback";
    --font-montserrat: "Montserrat", "Montserrat Fallback";
    --font-script: "Great Vibes", "Great Vibes Fallback";
  }
`;

const FONTS = `
  *,*::before,*::after { box-sizing: border-box; }
  html,body { margin:0; padding:0; background:#fff; }
`;

beforeEach(() => {
  global.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; }
    observe() { this.cb([{ isIntersecting: true }]); }
    unobserve() {} disconnect() {}
  };
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  /* The footer's newsletter form and the navbar do not fetch, but FooterSection
     shares a tree with components that might; answer rather than reject so a
     rejection cannot empty a band out of the picture. */
  global.fetch = vi.fn(() => Promise.resolve({
    ok: true, json: () => Promise.resolve({ success: true }),
  }));
});

/** Stage one page at both widths. */
async function stage(name, element, heights) {
  const { container } = render(element);
  await act(async () => { await new Promise((r) => setTimeout(r, 400)); });

  /* An ABSOLUTE src ignores <base>, so every image would render as a broken
     icon and the page would be measured at the wrong heights. Both the
     landing webp plates and the /templates posters need the rewrite. */
  const html = container.innerHTML
    .replace(/src="\/images\//g, 'src="images/')
    .replace(/src="\/templates\//g, 'src="templates/');
  const head = [...document.head.querySelectorAll('style')].map((s) => s.textContent).join('\n');

  fs.mkdirSync(STAGE, { recursive: true });
  fs.writeFileSync(path.join(STAGE, `${name}.html`),
    `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8">
<base href="file:///${PUBLIC}/">
<style>${FONTS}</style><style>${appCss()}</style><style>${FONT_VARS}</style><style>${head}</style>
<style>
  /* Entrance animations run to their end state: this is a still. */
  *,*::before,*::after { animation-duration: 1ms !important; animation-delay: 0s !important; }
  /* The navbar is position:fixed and renders its own 78px spacer. In a
     scrolling iframe capture the fixed bar would paint once at the top and
     the spacer would leave a gap; static puts it back in the flow so the
     capture shows the page as a reader scrolls it. */
  #main-navbar { position: static !important; }
</style>
</head><body>${html}</body></html>`, 'utf8');

  // eslint-disable-next-line no-console
  console.log(`PROBE staged ${name}.html bytes:`, html.length);

  /* A TRUE-WIDTH, UNSCALED iframe. Scaling one with a CSS transform yields
     half-black captures — density comes from --force-device-scale-factor. */
  for (const [suffix, w, h] of heights) {
    fs.writeFileSync(path.join(OUT, `frame-${name}${suffix}.html`),
      `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#fff;overflow:hidden;}
  iframe{position:absolute;top:0;left:0;width:${w}px;height:${h}px;border:0;}
</style></head><body><iframe src="stage/${name}.html" scrolling="no"></iframe></body></html>`, 'utf8');
  }
}

describe('the collection — visual probe', () => {
  it('stages the gallery at both widths', async () => {
    await stage('collection', <CollectionPage />, [['1280', 1280, 2700], ['390', 390, 5200]]);
  });

  it('stages a template page at both widths', async () => {
    /* Swan Lake: the one with the most to lay out — a four-item spec list, a
       long description, an unlocked occasion note, and prev/next on both
       sides. If the composition holds here it holds for the other three.
       An async Server Component, so it is CALLED and the element it returns
       is what renders. */
    const el = await CollectionTemplatePage({ params: Promise.resolve({ key: 'swans' }) });
    await stage('template-swans', el, [['1280', 1280, 1900], ['390', 390, 3000]]);
  });

  it('stages the locked-occasion template, whose badge reads differently', async () => {
    // Velvet Ring is the only one with occasions: ['engagement'], so it is the
    // only page where the occasion note is a restriction rather than a freedom.
    const el = await CollectionTemplatePage({ params: Promise.resolve({ key: 'ring' }) });
    await stage('template-ring', el, [['390', 390, 3000]]);
  });

  it('names every template it did not stage, so nothing is silently unreviewed', () => {
    const staged = ['swans', 'ring'];
    const rest = COLLECTION.filter((c) => !staged.includes(c.key)).map((c) => c.key);
    // eslint-disable-next-line no-console
    console.log('PROBE not staged (same layout, different art):', rest.join(', ') || 'none');
  });
});
