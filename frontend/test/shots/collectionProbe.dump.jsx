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

   ── THE NAVIGATION LINKS COME OUT BLUE. THAT IS THIS HARNESS, NOT THE PAGE.

   Navbar.js sets `:global(.desktop-nav-link) { color: #191815 }` inside a
   <style jsx> block, and styled-jsx does not compile under vitest — so that
   rule reaches the real build and never reaches a staged capture. The links
   fall back to the browser's default link blue in every screenshot taken
   here, on every page that renders the navbar.

   Do not "fix" it, and do not read a capture as evidence the nav is broken.
   If you want to check the navbar itself, navbarWidthProbe.dump.jsx measures
   geometry (which IS faithful — layout comes from globals.css, not from
   styled-jsx). The same caveat applies to any other styled-jsx component
   pulled into a stage: colour and type set that way are simply absent.

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

/* ── TWO SOURCES FOR THE STYLESHEET, AND THE PAGE SAYS WHICH IT USED ──────

   BUILT is the truth and is preferred: it is the CSS the browser actually
   receives, with next/font's self-hosted faces wired in. The three asserts on
   that path are what stop it drifting into a lie — a missing font is
   invisible in a screenshot, which is exactly how the homepage was once
   reviewed entirely in Georgia.

   SOURCE is the fallback, and it exists because `npx next build` on this
   machine takes tens of minutes and has stalled outright, which in practice
   meant these pages were going to be shipped having never been looked at —
   and looking at them is the whole point of this file. It is honest for THESE
   pages specifically, and that is a claim worth justifying rather than
   assuming: everything they lean on from globals.css (--fx-w-*, --fx-pad-x,
   .fx-container, .fx-grid, .fx-gutter) is plain CSS in a plain :root, using
   plain var() and a plain clamp(). None of it is behind an @theme block or a
   theme() call, so none of it needs PostCSS. Their own media queries are
   pixel literals in their own <style> blocks. What IS lost: the seven
   theme(--breakpoint-*) media queries elsewhere in globals.css, which these
   pages do not use, and Tailwind's utility classes, which they do not use
   either.

   The faces come from Google Fonts over the network in that mode — real
   Cormorant Garamond and real Aboreto, not a Georgia stand-in. If the network
   is unavailable the banner in the staged page is what tells you the type is
   not to be trusted; do not review type from a SOURCE capture without it. */
function appCss() {
  const dir = path.join(ROOT, '.next/static/chunks');
  const built = fs.existsSync(dir)
    && fs.readdirSync(dir).some((f) => f.endsWith('.css'));

  /* A PARTIAL BUILD IS NOT A BUILD, and this probe met one: an interrupted
     `next build` leaves .next/static/chunks populated with CSS that has no
     next/font @font-face rules in it at all. Both conditions are checked and
     an unusable build DEGRADES to SOURCE with a reason on stdout rather than
     throwing — the point of this file is to get a picture of the page, and
     refusing to draw one because a stale artifact is lying is the wrong
     trade. The banner in the staged page still says which was used, so a
     silent downgrade is not possible. */
  if (built) {
    const css = fs.readdirSync(dir).filter((f) => f.endsWith('.css'))
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');

    /* URL-ENCODED. This repo lives under "C:/Users/yousef amr/", and a raw
       space inside an unquoted CSS url() ends the token — the rule parses as
       garbage and the font falls back silently. */
    const media = encodeURI(path.join(ROOT, '.next/static/media').split(path.sep).join('/'));
    const withFonts = css.replace(/url\(\.\.\/media\//g, 'url(file:///' + media + '/');

    const bad = [];
    if (!css.includes('.fx-grid')) bad.push('no .fx-grid');
    if (!/@font-face\{font-family:Aboreto;/.test(withFonts)) bad.push('no Aboreto @font-face');
    if (bad.length === 0) return { mode: 'BUILT', css: withFonts };
    // eslint-disable-next-line no-console
    console.warn(`PROBE: .next exists but is unusable (${bad.join(', ')}) — `
      + 'almost certainly a partial or interrupted build. Falling back to source CSS.');
  }

  const globals = fs.readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8');
  const cinematic = fs.readFileSync(path.join(ROOT, 'src/app/styles/cinematic.css'), 'utf8');
  if (!globals.includes('.fx-grid')) throw new Error('globals.css has no .fx-grid.');
  /* The two @import lines at the top would resolve to nothing from a file://
     page and Tailwind is not needed here — see the header. Dropped so the
     browser does not sit waiting on them. */
  const css = globals.replace(/^@import\s+[^;]+;\s*$/gm, '') + '\n' + cinematic;
  return { mode: 'SOURCE', css };
}

/** Real faces over the network, for the SOURCE path only. */
const WEBFONTS = '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
  + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2'
  + '?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400'
  + '&family=Aboreto&display=swap">';

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

  const { mode, css } = appCss();

  fs.mkdirSync(STAGE, { recursive: true });
  fs.writeFileSync(path.join(STAGE, `${name}.html`),
    `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8">
<base href="file:///${PUBLIC}/">
${mode === 'SOURCE' ? WEBFONTS : ''}
<style>${FONTS}</style><style>${css}</style><style>${FONT_VARS}</style><style>${head}</style>
<style>
  /* Entrance animations run to their end state: this is a still. */
  *,*::before,*::after { animation-duration: 1ms !important; animation-delay: 0s !important; }
  /* The navbar is position:fixed and renders its own 78px spacer. In a
     scrolling iframe capture the fixed bar would paint once at the top and
     the spacer would leave a gap; static puts it back in the flow so the
     capture shows the page as a reader scrolls it. */
  #main-navbar { position: static !important; }
</style>
</head><body>
<!-- WHICH STYLESHEET THIS CAPTURE USED. Says so IN THE PAGE, not only in a
     console line that scrolls away: a SOURCE capture is trustworthy for
     layout and colour and only as trustworthy for TYPE as the network was
     when it was taken, and somebody reviewing the picture a week later has
     no other way to know which they are looking at. -->
<div style="position:fixed;z-index:99999;top:0;right:0;padding:3px 9px;font:11px/1.4 monospace;background:${mode === 'BUILT' ? '#1b5e20' : '#8a4b00'};color:#fff">CSS: ${mode}</div>
${html}</body></html>`, 'utf8');

  // eslint-disable-next-line no-console
  console.log(`PROBE staged ${name}.html [css=${mode}] bytes:`, html.length);

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
