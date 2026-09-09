/* ═══════════════════════════════════════════════════════════════════════════
   THE FOUR DASHBOARD TABS ON THE HOMEPAGE.

   DashboardShowcaseSection shows the organizer's side as a tab strip — one
   chrome, four screens. Every frame here is the component the organizer's own
   dashboard renders, driven by the DEMO's fixtures, so the homepage cannot end
   up showing a dashboard the product does not have.

   ── Why this is not in landingShots.dump.jsx ─────────────────────────────

   That file mocks `utils/apiClient` at the module boundary to feed one
   component. The demo dashboard needs the OPPOSITE: the real module, with the
   demo router installed into its slot by `installDemoApi`, because that is how
   /demo answers OrganizerOverview and the analytics page in a browser. A
   module mock and a runtime install of the same module cannot coexist in one
   file, and forcing them to would mean testing a shape neither surface uses.

   ── The four screens are the demo's own four ─────────────────────────────

   Overview, Guest list, Seating, Analytics — clicked through the demo's own
   sidebar rather than by rendering four components side by side, so the
   chrome, the spacing and the heading of every frame are identical and the
   strip reads as one application changing rather than four screenshots.

   The mockup's fourth tab was "Reminders". The messages page is not part of
   the demo and would need its own mock stack; analytics IS in the demo and is
   the same kind of answer to "what do I get". The reminder marks get their own
   band further down the page, where the message itself is the subject.

   ── Running it ────────────────────────────────────────────────────────────
   0. npx next build                       (the real CSS comes from the build)
   1. npx vitest run --config vitest.shots.config.mjs
   2. For each of the four, from frontend/:

        chrome --headless=new --disable-gpu --hide-scrollbars
          --allow-file-access-from-files --force-device-scale-factor=2
          --window-size=1180,960 --virtual-time-budget=9000
          --user-data-dir=<unique>
          --screenshot=<abs>/raw-dash-overview.png
          <abs>/.visual/landing/tabs/frame-dash-overview.html

        ffmpeg -y -i raw-dash-overview.png -vf "crop=2240:1720:0:0,scale=1120:-1"
          -quality 68 public/images/landing/dash-overview.webp

   BUDGET: test/templatesShowcase.test.jsx caps public/images/landing. Check it
   after converting, and compress to the cap rather than raising it to fit.
   ═══════════════════════════════════════════════════════════════════════════ */
import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, act, fireEvent, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { settle } from './videoStage';

/* App Router hooks do not exist outside a Next render. */
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: () => {}, replace: () => {}, back: () => {},
    forward: () => {}, refresh: () => {}, prefetch: () => {},
  }),
  usePathname: () => '/demo/dashboard',
  useSearchParams: () => new URLSearchParams(''),
  redirect: () => {},
}));

/**
 * The demo's own fixtures, wired at the module boundary rather than through
 * `installDemoApi`.
 *
 * The runtime slot was the first thing tried, and every frame came back
 * reading "Unable to load dashboard". apiClient consults the demo router only
 * while `window.location.pathname` is inside /demo — a deliberate guard, so
 * the fixtures can never answer a real organizer — and a jsdom document is not
 * at that path. `history.replaceState` did not move it either.
 *
 * Mocking the transport is both simpler and closer to what the other probes in
 * this folder do: the components under the camera are untouched, only the
 * fetch is answered. `/public/…` is declined by `answerFor` on purpose (the
 * real endpoints serve a demo visitor exactly as they serve anyone), and there
 * is no server here to fall through to, so those are answered empty: the shop
 * card renders nothing without a published catalogue, and a printed-cards
 * promo inside a screenshot of the dashboard would be a second product
 * intruding on the one this frame is about.
 */
vi.mock('../../src/app/utils/apiClient', async (importOriginal) => {
  const actual = await importOriginal();
  const { answerFor } = await import('../../src/app/demo/fixtures/demoOrganizer.mjs');
  return {
    ...actual,
    apiFetch: vi.fn(async (route) => {
      if (/^\/public\/shop/.test(String(route))) return { enabled: false, products: [] };
      const answer = answerFor(route);
      return answer === undefined ? { success: true } : answer;
    }),
  };
});

import DemoDashboardPage from '../../src/app/demo/dashboard/page';

const ROOT = process.cwd();
const STAGE_DIR = path.join(ROOT, '..', '.visual', 'landing', 'tabs');
const PUBLIC = path.join(ROOT, 'public').replace(/\\/g, '/');

/* ── TWO SOURCES FOR THE STYLESHEET, AND THE PAGE SAYS WHICH IT USED ──────
   The same arrangement collectionProbe.dump.jsx settled on, and it earned its
   place here immediately: the build in .next on this machine was a PARTIAL one
   — CSS chunks present, not a single .fx-* rule or @font-face among them — so
   the first run of this file died on "the built CSS has no .fx-grid" rather
   than producing a picture. Refusing to draw one because a stale artifact is
   lying is the wrong trade; degrading with a banner in the page is the right
   one.

   BUILT is still preferred and still asserted, because it is the CSS the
   browser actually receives, with next/font's self-hosted faces wired in. */
function appCss() {
  const dir = path.join(ROOT, '.next/static/chunks');
  const built = fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.css'));

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
  if (!globals.includes('.fx-grid')) throw new Error('globals.css has no .fx-grid.');
  /* The two @import lines resolve to nothing from a file:// page and Tailwind
     is not needed by these screens. Dropped so the browser does not wait. */
  return { mode: 'SOURCE', css: globals.replace(/^@import\s+[^;]+;\s*$/gm, '') };
}

/** Real faces over the network, for the SOURCE path only. */
const WEBFONTS = '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
  + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2'
  + '?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400'
  + '&family=Aboreto&display=swap">';

/* next/font emits its family names onto a class layout.js puts on <html>. A
   staged page has no such class, so var(--font-cormorant) would be UNDEFINED
   — and an invalid var() inside a font-family list invalidates the whole
   declaration, which silently drops the display face off every heading. */
const FONT_VARS = `
  *,*::before,*::after { box-sizing: border-box; }
  html,body { margin:0; padding:0; }
  :root {
    --font-heading: "Aboreto", "Aboreto Fallback", Georgia, serif;
    --font-body: "Google Sans", "Segoe UI", system-ui, sans-serif;
    --font-sans: "Segoe UI", system-ui, sans-serif;
    --font-serif: "Aboreto", Georgia, serif;
    --font-cormorant: "Cormorant Garamond", Georgia, serif;
    --font-script: "Segoe Script", cursive;
  }
`;

/**
 * Write every live form value back onto the markup as an ATTRIBUTE.
 *
 * A controlled `<select value={…}>` sets a DOM *property*, and properties are
 * not serialised by innerHTML — so a fully seated guest list stages with every
 * table assignment showing "No table". That failure looks like DATA rather
 * than like a staging bug, which is exactly why it has to be done here and not
 * noticed later in a photograph.
 */
function reflectFormState(root) {
  for (const el of root.querySelectorAll('select')) {
    for (const opt of el.options) {
      if (opt.selected) opt.setAttribute('selected', '');
      else opt.removeAttribute('selected');
    }
  }
  for (const el of root.querySelectorAll('input')) {
    if (el.type === 'checkbox' || el.type === 'radio') {
      if (el.checked) el.setAttribute('checked', '');
      else el.removeAttribute('checked');
    } else if (el.value != null && el.value !== '') {
      el.setAttribute('value', el.value);
    }
  }
}

/** An absolute asset path ignores <base href> and resolves against the
 *  filesystem root, so every image renders as a broken icon. */
const relativise = (s) => s
  .replace(/(src|href|poster)="\/(images|templates)\//g, '$1="$2/')
  .replace(/url\((['"]?)\/(images|templates)\//g, 'url($1$2/');

/** A still cannot photograph a shutter-timed frame. Delays as well as
 *  durations: a 1ms animation starting 400ms late is still absent. */
const FROZEN = `
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    transition-delay: 0s !important;
  }
  /* The demo's own closing note belongs to the demo, not to a product
     screenshot on the front page. */
  .dscreen__foot { display: none !important; }
  /* And neither does the door-app ANNOUNCEMENT (.caa). It is a dismissible
     promo the product shows an organizer once; inside a homepage screenshot it
     is our own marketing quoted back at the reader, in a picture that is
     supposed to be showing them their dashboard. It also takes the whole lower
     half of the frame, which is where the RSVP trend and the upcoming events
     are — the two things worth photographing. */
  .caa { display: none !important; }
`;

const WIDTH = 1120;
/* 900, and the capture is cropped to 860. The 40px difference is where the
   staged page's "CSS: BUILT|SOURCE" banner sits — it has to be IN the staged
   document (a console line scrolls away, and a SOURCE capture is only as
   trustworthy for type as the network was) and OUT of the published webp. */
const HEIGHT = 900;
const CROP_H = 860;

beforeAll(() => {
  // vitest compiles this repo with the classic JSX runtime and several
  // dashboard components legitimately never import React themselves.
  global.React = React;

  global.ResizeObserver = class {
    constructor(cb) { this.cb = cb; }
    observe() { this.cb?.([{ contentRect: { width: WIDTH, height: HEIGHT } }]); }
    unobserve() {}
    disconnect() {}
  };
  global.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; }
    observe() { this.cb?.([{ isIntersecting: true, intersectionRatio: 1 }]); }
    unobserve() {}
    disconnect() {}
  };
  window.scrollTo = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
});

/**
 * Write one staged screen and the iframe wrapper Chrome photographs.
 *
 * The wrapper is what gives the capture a TRUE viewport of WIDTH: headless
 * Chrome on this machine cannot make a window narrower than about 494px, and
 * a --window-size that is ignored produces a picture of a layout no browser
 * has ever rendered. Density comes from --force-device-scale-factor, never
 * from a CSS transform on the iframe — a scaled iframe paints only its own
 * unscaled surface and the bottom half of the capture comes out black.
 */
function write(name, container) {
  fs.mkdirSync(STAGE_DIR, { recursive: true });

  reflectFormState(container);
  const body = relativise(container.innerHTML);
  /* Several dashboard components build a <style> element in an effect and
     append it to document.head. None of that is in container.innerHTML, and
     without it every entrance animation stays at its opacity:0 start frame —
     a capture of blank cards that looks like a data problem. */
  const injected = relativise(
    [...document.head.querySelectorAll('style')].map((s) => s.textContent).join('\n'),
  );
  const { mode, css } = appCss();

  fs.writeFileSync(
    path.join(STAGE_DIR, `${name}.html`),
    `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8">
<base href="file:///${PUBLIC}/">
${mode === 'SOURCE' ? WEBFONTS : ''}
<style>${FONT_VARS}</style><style>${css}</style><style>${injected}</style>
<style>body{background:#FAFAF8;}${FROZEN}</style>
</head><body>
<!-- WHICH STYLESHEET THIS CAPTURE USED. In the page, not only in a console
     line that scrolls away: a SOURCE capture is trustworthy for layout and
     colour and only as trustworthy for TYPE as the network was when it was
     taken. It is cropped off by the ffmpeg step; it is here for whoever opens
     the staged HTML. -->
<div style="position:fixed;z-index:99999;bottom:0;right:0;padding:3px 9px;font:11px/1.4 monospace;background:${mode === 'BUILT' ? '#1b5e20' : '#8a4b00'};color:#fff">CSS: ${mode}</div>
${body}</body></html>`,
    'utf8',
  );

  fs.writeFileSync(
    path.join(STAGE_DIR, `frame-${name}.html`),
    `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#FAFAF8;overflow:hidden;}
  iframe{position:absolute;top:0;left:0;width:${WIDTH}px;height:${HEIGHT}px;border:0;}
</style></head><body><iframe src="${name}.html" scrolling="no"></iframe></body></html>`,
    'utf8',
  );
}

async function stageTab(name, tabLabel, after) {
  const { container, unmount } = render(<DemoDashboardPage />);
  await settle(act, 6);

  if (tabLabel) {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(tabLabel, 'i') }));
    });
  }
  if (after) await after(container);
  await settle(act, 12);

  /* FAIL LOUDLY RATHER THAN PHOTOGRAPH A LIE. Every one of these frames is
     going on the front page; an error card or an empty panel in one of them is
     invisible until somebody looks, and by then it has shipped. */
  const html = container.innerHTML;
  expect(html, `${name}: the fixtures did not answer`).not.toMatch(/Unable to load/i);
  expect(html.length, `${name}: staged almost nothing`).toBeGreaterThan(4000);
  // The sample event's own name. Present on every screen through the shell's
  // sidebar, so its absence means the shell rendered without its data rather
  // than that this particular tab is empty.
  expect(html, `${name}: no sample data reached the screen`).toContain('Nadia');

  write(name, container);
  unmount();
}

describe('landing — the organizer tab strip', () => {
  it('stages the overview', async () => {
    await stageTab('dash-overview', null);
  }, 120000);

  it('stages the guest list', async () => {
    await stageTab('dash-guests', 'Guest');
  }, 120000);

  it('stages the seating', async () => {
    /* THE FILTER HAS TO BE MOVED OFF ITS DEFAULT.
       The demo opens this screen on "Still need a table", which is the right
       default for somebody working through a seating chart and the wrong one
       for a photograph of it: four unseated guests over half a page of white
       is a picture of an empty product. "All Responses" fills the table with
       the room as it stands, tables assigned and all. */
    await stageTab('dash-seating-plan', 'Seating', async (container) => {
      const select = [...container.querySelectorAll('select')]
        .find((s) => [...s.options].some((o) => o.value === 'unseated'));
      expect(select, 'the seating filter moved — the frame would stage nearly empty').toBeTruthy();
      await act(async () => { fireEvent.change(select, { target: { value: 'all' } }); });
    });
  }, 120000);

  it('stages the analytics', async () => {
    await stageTab('dash-analytics', 'Analytics');
  }, 120000);
});
