/* ═══════════════════════════════════════════════════════════════════════════
   THE SEATING PLAN ON THE HOMEPAGE, staged from the real component.

   WHY THIS EXISTS

   templateShots.dump.jsx does this for the four invitations. This does it for
   the seating chart, which the homepage used to draw by hand — a floor plan at
   hardcoded coordinates inside 1,029 lines of invented JSX. Every frame
   produced here is the component that actually ships, rendering real-shaped
   data.

   TABLES below is SAMPLE data, not invented UI. That distinction is the whole
   point: the room is made up the way any demo's room is, but every pixel of it
   is drawn by SeatingMiniMap itself. Change that component and re-run this,
   and the homepage follows. Change it and do NOT re-run this, and the homepage
   is out of date rather than fictional — which is the failure mode you want,
   because it is the one somebody notices.

   THE DASHBOARD FRAMES ARE NOT HERE. See landingTabs.dump.jsx and the note
   above the describe block below.

   ── Running it ───────────────────────────────────────────────────────────
   0. The app's real CSS comes from a build, and this degrades to source CSS
      with a banner in the staged page when there is not a usable one:
        npx next build

   1. Stage the HTML (writes .visual/landing/stage/*.html):
        npx vitest run --config vitest.shots.config.mjs

   2. Photograph it. The iframe is a TRUE width; density comes from
      --force-device-scale-factor. Do NOT scale the iframe with a CSS
      transform — a scaled iframe paints only its own unscaled surface and the
      bottom half of the capture comes out solid black.

        chrome --headless=new --disable-gpu --hide-scrollbars \
          --allow-file-access-from-files --force-device-scale-factor=2 \
          --window-size=1060,800 --virtual-time-budget=8000 \
          --screenshot=raw-seating.png frame-dash-seating.html

   3. Crop the window surplus AND the 40px banner strip (see stage()), then
      size for the page:

        ffmpeg -i raw-seating.png -vf "crop=1960:1400:0:0,scale=980:-1" \
          -quality 68 public/images/landing/dash-seating.webp

   BUDGET: test/templatesShowcase.test.jsx caps public/images/landing at a
   fixed KB total. Check it after converting, and do not raise the cap to fit
   a lazily-compressed file.
   ═══════════════════════════════════════════════════════════════════════════ */
import React from 'react';
import { describe, it, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

/* The dashboard FIXTURE and the apiFetch mock that fed it were deleted with
   the overview shot on 2026-09-09 — see the note above the describe block.
   The four dashboard frames now come from the demo's own fixtures, in
   test/shots/landingTabs.dump.jsx, which is a better source for them: the
   demo is a shipping surface with its own tests, so its sample event cannot
   quietly drift into a shape the product never produces the way a fixture
   living only in a screenshot harness can. */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(''),
}));

/**
 * `globalThis.React = React` — a HARNESS shim, not a fix to product code.
 *
 * vitest.config.mjs hands .js files to esbuild with `loader: 'jsx'`, which
 * uses the CLASSIC runtime and compiles JSX to `React.createElement(...)`.
 * That needs React in the module's scope. Seventeen components under
 * dashboard/components — UpcomingEventsCards, RecentActivityFeed,
 * DashboardNav and the rest — legitimately do not import React, because Next
 * compiles them with the AUTOMATIC runtime where the import is injected.
 *
 * They are correct as written and this dump is simply the first thing to
 * render them under vitest, so the shim belongs here. Adding an unused React
 * import to seventeen product files to satisfy a screenshot harness would be
 * the tail wagging the dog — the same argument vitest.config.mjs already
 * makes about not renaming 200 components to .jsx.
 *
 * Deliberately NOT done by overriding `esbuild.jsx` in vitest.shots.config —
 * that config is shared with five other probe dumps that currently pass, and
 * changing the JSX runtime under all of them to fix one is a wide blast
 * radius for a narrow problem.
 */
globalThis.React = React;

import SeatingMiniMap from '../../src/app/[slug]/rsvp/SeatingMiniMap';

const ROOT = process.cwd();
const OUT = path.join(ROOT, '..', '.visual', 'landing');
const STAGE = path.join(OUT, 'stage');
const PUBLIC = path.join(ROOT, 'public').replace(/\\/g, '/');

/**
 * The app's REAL compiled CSS, concatenated from every chunk.
 *
 * src/app/globals.css is useless on its own here — `@import "tailwindcss"`
 * generates nothing outside the build, and `theme()` inside a media condition
 * is a parse error in a browser. The built stylesheet is also SPLIT across
 * chunks, and the .fx-* primitives are NOT in the biggest one, so picking a
 * file by name or size yields a page with no grid at all. That looks exactly
 * like a broken layout rather than a broken harness, which is why the assert
 * below exists: fail loudly instead of photographing a lie.
 */
/* ── AND WHEN THERE IS NO USABLE BUILD ────────────────────────────────────
   This threw on 2026-09-09 rather than producing a picture: .next held CSS
   chunks with no .fx-* rule and no @font-face in any of them, which is what an
   interrupted `next build` leaves behind. A partial build is not a build, and
   `npx next build` on this machine has stalled outright more than once — so
   the alternative to a fallback is a shot that never gets remade and a
   homepage carrying a stale one.

   SOURCE is honest for THIS component specifically, and that is worth stating
   rather than assuming: SeatingMiniMap computes its whole geometry in JS into
   inline absolute pixels, so what globals.css supplies is the page ground and
   the type. What is lost is Tailwind's utilities, which it does not use. The
   staged page says which mode it used. */
function appCss() {
  const dir = path.join(ROOT, '.next/static/chunks');
  const built = fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.css'));
  if (!built) return sourceCss('no .next build at all');
  const css = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n');
  if (!css.includes('.fx-grid')) return sourceCss('the built CSS has no .fx-grid');

  /* THE FONTS, WHICH I HAD BEEN RENDERING WITHOUT.

     next/font self-hosts every face into .next/static/media and writes each
     @font-face src as `url(../media/...)`, relative to the chunks folder.
     Under our <base href=".../public/"> that resolved to nothing, so every
     capture silently fell back to Georgia — the page was being judged in a
     typeface it does not use. --font-serif is Aboreto, which looks nothing
     like Georgia and ships a SINGLE weight.

     Rewritten to absolute file: URLs so the staged page uses the real faces.
     The assert is the point: a missing font is invisible in a screenshot,
     which is exactly how this went unnoticed. */
  /* URL-ENCODED. This repo lives under "C:/Users/yousef amr/", and a raw space
     inside an unquoted CSS url() ends the token — the rule parses as garbage
     and the font falls back silently, which is the exact failure this block
     exists to remove. */
  const media = encodeURI(path.join(ROOT, '.next/static/media').split(path.sep).join('/'));
  const withFonts = css.replace(/url\(\.\.\/media\//g, 'url(file:///' + media + '/');
  if (!/@font-face\{font-family:Aboreto;/.test(withFonts)) {
    return sourceCss('the built CSS has no Aboreto @font-face');
  }
  return { mode: 'BUILT', css: withFonts };
}

function sourceCss(why) {
  // eslint-disable-next-line no-console
  console.warn(`SHOTS: falling back to source CSS — ${why}.`);
  const globals = fs.readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8');
  if (!globals.includes('.fx-grid')) throw new Error('globals.css has no .fx-grid either.');
  // The @import lines resolve to nothing from a file:// page.
  return { mode: 'SOURCE', css: globals.replace(/^@import\s+[^;]+;\s*$/gm, '') };
}

/** Real faces over the network, for the SOURCE path only. */
const WEBFONTS = '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
  + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2'
  + '?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400'
  + '&family=Aboreto&display=swap">';

/* next/font emits its family names onto a class layout.js puts on <html>, and
   a staged page has no such class — an invalid var() inside a font-family list
   invalidates the whole declaration, so every heading would silently fall back
   to the body sans. */
const FONTS = `
  *,*::before,*::after { box-sizing: border-box; }
  :root {
    --font-sans:'Segoe UI',system-ui,sans-serif;
    --font-serif:'Aboreto',Georgia,serif;
    --font-heading:'Aboreto','Aboreto Fallback',Georgia,serif;
    --font-body:'Google Sans','Segoe UI',system-ui,sans-serif;
    --font-cormorant:'Cormorant Garamond',Georgia,serif;
    --font-script:'Segoe Script','Brush Script MT',cursive;
  }
  html,body { margin:0; padding:0; }
`;

/**
 * Styles the components inject into document.head at runtime.
 *
 * Five of these components build a <style> element in an effect and append it
 * (`organizer-overview-styles`, the trend chart's, the activity feed's, the
 * upcoming-events one). None of that is in `container.innerHTML`, and without
 * it every entrance animation stays at its `opacity: 0` start frame — the
 * capture comes out as a page of blank cards that looks like a data problem.
 */
function injectedStyles() {
  return [...document.head.querySelectorAll('style')].map((s) => s.textContent).join('\n');
}

function stage(name, html, { width, height, background = '#FDFCF9', pad = 0 }) {
  fs.mkdirSync(STAGE, { recursive: true });
  const { mode, css } = appCss();

  fs.writeFileSync(
    path.join(STAGE, `${name}.html`),
    `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8">
<base href="file:///${PUBLIC}/">
${mode === 'SOURCE' ? WEBFONTS : ''}
<style>${FONTS}</style>
<style>${css}</style>
<style>${injectedStyles()}</style>
<style>
  body { background:${background}; padding:${pad}px; }
  /* Every entrance animation in these components is written as
     "…s both" with a stagger. The capture is a still, so run them all to
     their end state rather than trying to time the shutter. */
  *, *::before, *::after {
    animation-delay: 0s !important;
    animation-duration: 1ms !important;
    transition: none !important;
  }
</style>
</head><body>
<div style="position:fixed;z-index:99999;bottom:0;right:0;padding:2px 7px;font:10px/1.3 monospace;background:${mode === 'BUILT' ? '#1b5e20' : '#8a4b00'};color:#fff">CSS: ${mode}</div>
${html}</body></html>`,
    'utf8',
  );

  /* THE FRAME IS 40px TALLER THAN THE SHOT, and that band of surplus is where
     the "CSS: BUILT|SOURCE" stamp sits. The stamp has to be IN the staged
     document — a console line scrolls away, and a SOURCE capture is only as
     trustworthy for type as the network was when it was taken — and it must
     never reach the published webp. It got there once: the first 980x700
     seating plan shipped with an orange "CSS: SOURCE" badge in its corner.
     Crop to the height above and it is gone. */
  fs.writeFileSync(
    path.join(OUT, `frame-${name}.html`),
    `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:${background};overflow:hidden;}
  iframe{position:absolute;top:0;left:0;width:${width}px;height:${height + 40}px;border:0;}
</style></head><body><iframe src="stage/${name}.html" scrolling="no"></iframe></body></html>`,
    'utf8',
  );
}

/* A real room: a head table, ten rounds, and the venue furniture that makes a
   floor plan read as a floor plan rather than a scatter of circles.
   Two field names that are NOT interchangeable, both learned the hard way:

     table_name — NOT `name`. The plan renders a NUMERAL derived from
       `el.table_name` (planNumeral strips "Table " and sets the digits three
       times larger than the full label would fit). With the wrong key the
       tables draw perfectly, with seats and shadows, and simply have no
       numbers on them — which reads as a design choice, not a bug.

     position_x / position_y — the element's TOP-LEFT corner, as a PERCENTAGE
       of the 2600x1700 world. Not its centre. Reading them as centres is what
       once scrambled an entire exported layout. */
const TABLES = [
  { id: 'z1', shape: 'stage', element_type: 'zone', position_x: 36, position_y: 3, width: 360, height: 150 },
  { id: 't0', shape: 'head', table_name: 'Head Table', capacity: 12, position_x: 34, position_y: 18 },
  { id: 't1', shape: 'round', table_name: 'Table 1', capacity: 10, position_x: 14, position_y: 30 },
  { id: 't2', shape: 'round', table_name: 'Table 2', capacity: 10, position_x: 30, position_y: 30 },
  { id: 't3', shape: 'round', table_name: 'Table 3', capacity: 10, position_x: 46, position_y: 30 },
  { id: 't4', shape: 'round', table_name: 'Table 4', capacity: 10, position_x: 62, position_y: 30 },
  { id: 't5', shape: 'round', table_name: 'Table 5', capacity: 10, position_x: 14, position_y: 45 },
  { id: 't6', shape: 'round', table_name: 'Table 6', capacity: 10, position_x: 30, position_y: 45 },
  { id: 't7', shape: 'round', table_name: 'Table 7', capacity: 10, position_x: 46, position_y: 45 },
  { id: 't8', shape: 'round', table_name: 'Table 8', capacity: 10, position_x: 62, position_y: 45 },
  { id: 't9', shape: 'oval', table_name: 'Table 9', capacity: 10, position_x: 12, position_y: 62 },
  { id: 't10', shape: 'oval', table_name: 'Table 10', capacity: 10, position_x: 60, position_y: 62 },
  { id: 'z2', shape: 'dance_floor', element_type: 'zone', position_x: 33, position_y: 60, width: 250, height: 190 },
  { id: 'z3', shape: 'bar', element_type: 'zone', position_x: 4, position_y: 80, width: 240, height: 92 },
  { id: 'z4', shape: 'dj_booth', element_type: 'zone', position_x: 74, position_y: 20, width: 132, height: 112 },
  { id: 'z5', shape: 'entrance', element_type: 'zone', position_x: 44, position_y: 88, width: 150, height: 70 },
  { id: 'z6', shape: 'cake_table', element_type: 'zone', position_x: 76, position_y: 78, width: 130, height: 100 },
];

beforeEach(() => {
  /* SeatingMiniMap sizes itself from a ResizeObserver and renders nothing
     measurable until one fires. jsdom has no layout, so report the staged
     width directly — the plan's geometry is computed in JS into inline px
     from this number, which is exactly why the dumped HTML paints correctly
     in a real browser despite jsdom never laying anything out. */
  global.ResizeObserver = class {
    constructor(cb) { this.cb = cb; }
    observe(el) { this.cb([{ target: el, contentRect: { width: 980, height: 700 } }]); }
    unobserve() {}
    disconnect() {}
  };
  global.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; }
    observe() { this.cb([{ isIntersecting: true }]); }
    unobserve() {}
    disconnect() {}
  };

});

/* ── THE ORGANIZER DASHBOARD IS NOT SHOT HERE ANY MORE ────────────────────

   It was, and the block that did it lived at exactly this point in the file:
   OrganizerOverview alone, on a mocked /dashboard, staged at 1120x860, with a
   long note about pumping two independent animation clocks in slices so the
   stat figures and the card entrances both finished before the shutter. That
   note has moved with the work; the technique is still exactly right and is
   still needed.

   What changed is that the homepage now shows FOUR dashboard screens in one
   tab strip, and they have to be four frames of one application — same
   chrome, same spacing, same heading — or the strip reads as four screenshots
   taken from different places. That means staging the demo's own dashboard
   page rather than one component in isolation, which needs the demo fixtures
   answering the transport, which cannot coexist in one file with the module
   mock at the top of this one. See test/shots/landingTabs.dump.jsx.

   Removed rather than left in place, because it wrote `dash-overview` — the
   SAME name the tab strip's first frame carries. Two harnesses producing one
   published filename is a trap with a delay on it: re-run the wrong one, crop
   it, and the strip ships with one frame that has a sidebar and three that do
   not.

   This file keeps the seating plan, which has no such conflict and is the one
   picture the seating band is entirely about. */
describe('landing — product shots', () => {
  it('stages the seating plan', async () => {
    const { container, unmount } = render(
      <SeatingMiniMap tables={TABLES} myTableId="t3" maxHeight={660} />,
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

    /* 980x700, up from 760x560 on 2026-09-09.
       The plan is the whole subject of its own band now rather than a plate
       overlapping the dashboard window, and at the old size the table numerals
       — which are the point of the drawing — were about four pixels tall by
       the time the band scaled it into a phone. Reported to the component
       through the ResizeObserver stub above, because it computes its geometry
       in JS from that number rather than from CSS. */
    stage('dash-seating', container.innerHTML, {
      width: 980, height: 700, background: '#FFFFFF', pad: 16,
    });
    unmount();
  });
});
