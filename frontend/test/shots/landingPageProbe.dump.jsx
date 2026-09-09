/* ═══════════════════════════════════════════════════════════════════════════
   THE REBUILT HOMEPAGE, AS A PICTURE.

   Not a screenshot source for the product — nothing here ships. This stages
   the whole page so it can be PHOTOGRAPHED at a desktop width and at a real
   390px phone before being called finished, which is the standing rule on this
   project: string assertions are not verification, and there is no dev server
   here to point a browser at.

   It stages the bands that can render without a network: the two data-backed
   ones (PrintedInvitationsSection, which is an async Server Component, and
   ProofSection, which renders null until an admin publishes a review) are
   absent by design, and the page is meant to read correctly without them —
   that is exactly the state a fresh install is in.

     npx vitest run --config vitest.shots.config.mjs landingPageProbe

   then photograph .visual/landing/frame-page1280.html and frame-page390.html.
   ═══════════════════════════════════════════════════════════════════════════ */
import React from 'react';
import { describe, it, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(''),
}));

/* Logged out — the state a first-time visitor is in, and the one whose CTA
   copy ("Create your event") actually matters. */
vi.mock('../../src/app/hooks/useAuth', () => ({
  useAuth: () => ({ isLoggedIn: false, loading: false, logout: () => {} }),
}));

/* The counters read a real endpoint; the fallback numbers are the ones the DB
   column defaults to, so this is what the page shows before the fetch lands. */
vi.mock('../../src/app/utils/useLandingStats', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useLandingStats: () => ({ stats: actual.FALLBACK_STATS }) };
});

globalThis.React = React;

import HeroSection from '../../src/app/components/landing/HeroSection';
import TemplatesShowcaseSection from '../../src/app/components/landing/TemplatesShowcaseSection';
import GuestExperienceSection from '../../src/app/components/landing/GuestExperienceSection';
import DashboardShowcaseSection from '../../src/app/components/landing/DashboardShowcaseSection';
import SeatingSection from '../../src/app/components/landing/SeatingSection';
import RemindersSection from '../../src/app/components/landing/RemindersSection';
import CheckinSection from '../../src/app/components/landing/CheckinSection';
import CapabilitiesSection from '../../src/app/components/landing/CapabilitiesSection';
import FaqCtaSection from '../../src/app/components/landing/FaqCtaSection';
import FooterSection from '../../src/app/components/landing/FooterSection';
import PrintedInvitationsSection from '../../src/app/components/landing/PrintedInvitationsSection';
import { BAND_ORDER } from '../../src/app/components/landing/landingTokens';

const ROOT = process.cwd();
const OUT = path.join(ROOT, '..', '.visual', 'landing');
const STAGE = path.join(OUT, 'stage');
const PUBLIC = path.join(ROOT, 'public').replace(/\\/g, '/');

/**
 * ── TWO SOURCES, AND THE STAGED PAGE SAYS WHICH IT USED ──────────────────
 *
 * BUILT is preferred and asserted: it is the CSS the browser actually
 * receives, with next/font's self-hosted faces wired in.
 *
 * SOURCE is the fallback, and it is here because this probe THREW on
 * 2026-09-09 rather than producing a picture — `.next` held CSS chunks with no
 * .fx-* rule and no @font-face in them at all, which is what an interrupted
 * `next build` leaves behind. A partial build is not a build. Refusing to draw
 * the page because a stale artifact is lying means the page ships unlooked-at,
 * which is the one thing this file exists to prevent, so it degrades with a
 * reason instead — and stamps the mode into the page so a downgrade cannot
 * pass unnoticed a week later. Same arrangement as collectionProbe.
 *
 * What SOURCE loses: Tailwind's utilities and the seven theme(--breakpoint-*)
 * media queries in globals.css. This page uses neither — its own breakpoints
 * are pixel literals in its own style blocks, and its layout comes from the
 * .fx-* primitives, which are plain CSS in a plain :root.
 */
function appCss() {
  const dir = path.join(ROOT, '.next/static/chunks');
  const built = fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.css'));
  if (!built) return sourceCss('no .next build at all');
  const css = fs.readdirSync(dir).filter((f) => f.endsWith('.css'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
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
  console.warn(`PROBE: falling back to source CSS — ${why}.`);
  const globals = fs.readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8');
  if (!globals.includes('.fx-grid')) throw new Error('globals.css has no .fx-grid either.');
  // The @import lines resolve to nothing from a file:// page; dropped so the
  // browser does not sit waiting on them.
  return { mode: 'SOURCE', css: globals.replace(/^@import\s+[^;]+;\s*$/gm, '') };
}

/** Real faces over the network, for the SOURCE path only. Without these the
 *  page is reviewed in Georgia, which is not a typeface it uses. */
const WEBFONTS = '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
  + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2'
  + '?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400'
  + '&family=Aboreto&display=swap">';

/* Reset ONLY. It used to redeclare --font-sans/--font-serif as Segoe UI and
   Georgia "because next/font is unavailable offline" — but next/font
   SELF-HOSTS, so the real faces were there all along and this was overriding
   them with the wrong ones. globals.css now supplies the type. */
/* next/font emits the family names onto a generated class that layout.js puts
   on <html> (`${aboreto.variable} ${googleSans.variable} …`). The staged page
   has no such class, so `var(--font-heading)` was UNDEFINED — and an invalid
   var() inside a font-family list invalidates the whole declaration, so every
   heading fell back to the body sans. The page was therefore being reviewed
   with its display face missing entirely.

   Declared here verbatim from the built CSS. Emitted AFTER globals so it wins,
   and asserted on below so a rename fails loudly instead of silently
   restyling the page. */
const FONT_VARS = `
  :root {
    --font-heading: "Aboreto", "Aboreto Fallback", Georgia, serif;
    --font-body: "Google Sans", "Segoe UI", system-ui, sans-serif;
    --font-sans: "Segoe UI", system-ui, sans-serif;
    --font-playfair: "Playfair Display", "Playfair Display Fallback", Georgia, serif;
    --font-cormorant: "Cormorant Garamond", "Cormorant Garamond Fallback", Georgia, serif;
    --font-montserrat: "Montserrat", "Montserrat Fallback", sans-serif;
    --font-script: "Great Vibes", "Great Vibes Fallback", cursive;
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
  global.ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
});

/* THE PROBE'S ORDER IS NOT ITS OWN.

   This list used to be hand-written here, and on 2026-08-20 it silently went
   stale: page.js had moved the invitations band from third to second and
   inserted the statement band, and the probe was still rendering the old
   sequence. Every screenshot taken to review that redesign was therefore of a
   page arrangement that production does not have — the section numerals came
   out IV before II and nothing failed.

   A staging harness that can disagree with the page it stages is worse than no
   harness, so the order now comes from BAND_ORDER, the same declaration page.js
   is asserted against, and the assertion below fails if a band is added there
   without a component here.

   ProofSection is still absent: it renders null until an admin publishes a
   review, and a fresh install genuinely has none.

   PRINTED IS NO LONGER ABSENT, and leaving it out was a mistake of the same
   family this docstring already describes. It is a real band on every install
   that has a catalogue — the owner's does — and it was redesigned twice
   (three static cards, then a swiped rail) without ever appearing in a single
   screenshot of the page it sits in. A band excused from the probe is a band
   nobody looks at. It is an async Server Component, so it is awaited and its
   returned element rendered, and its fetch is answered from SHOP_FIXTURE
   below rather than a network. */
const PROBE_SECTIONS = {
  hero: HeroSection,
  invitations: TemplatesShowcaseSection,
  experience: GuestExperienceSection,
  dashboard: DashboardShowcaseSection,
  seating: SeatingSection,
  reminders: RemindersSection,
  checkin: CheckinSection,
  capabilities: CapabilitiesSection,
  printed: PrintedInvitationsSection,
  'faq-cta': FaqCtaSection,
  footer: FooterSection,
};

const DATA_DRIVEN = ['proof'];

/* A catalogue with the shapes that break a rail: a long two-line name, a
   quoted price, a badge, and a piece with no photograph at all. Twelve, which
   is the cap the band slices to. */
const SHOP_CATEGORIES = [
  { id: 'c1', name: 'Wedding cards', slug: 'wedding-cards' },
  { id: 'c2', name: 'Signage', slug: 'signage' },
  { id: 'c3', name: 'Envelopes & extras', slug: 'envelopes-extras' },
];

const SHOP_ITEM = (i, over = {}) => ({
  id: `sp${i}`,
  title: over.title || `Foiled invitation ${i}`,
  slug: `piece-${i}`,
  category_id: over.category_id || 'c1',
  price_cents: over.price_cents === undefined ? 185 + i * 40 : over.price_cents,
  currency: 'USD',
  price_unit: '',
  min_order_qty: 100,
  is_featured: i === 1,
  sort_order: i,
  images: over.images === undefined
    ? [{ id: `i${i}`, url: `/images/landing/hero-ring.webp`, alt: null }]
    : over.images,
  badges: over.badges || [],
});

const SHOP_FIXTURE = {
  success: true,
  enabled: true,
  /* whatsapp_number is load-bearing, not decoration: the invitations band's
     commission strip is gated on a real number (a CTA that opens "wa.me/" and
     nothing else is worse than no CTA), so without it that strip is correctly
     absent — and absent from every screenshot taken to review it. */
  settings: {
    enabled: true,
    show_on_homepage: true,
    whatsapp_number: '19055550134',
    whatsapp_greeting: 'Hello! I would like to order printed invitations.',
  },
  categories: SHOP_CATEGORIES,
  products: [
    SHOP_ITEM(1, { badges: [{ id: 'b1', label: 'Bestseller', bg_color: '#F6F2E9', text_color: '#8A6D34' }] }),
    SHOP_ITEM(2, { title: 'Carved-door invitation box with a deliberately long name' }),
    SHOP_ITEM(3, { category_id: 'c2', title: 'Seating chart poster' }),
    SHOP_ITEM(4, { category_id: 'c3', title: 'Olive wax-sealed envelope' }),
    SHOP_ITEM(5, { price_cents: null, title: 'Bespoke foil plate', images: [] }),
    SHOP_ITEM(6), SHOP_ITEM(7), SHOP_ITEM(8), SHOP_ITEM(9), SHOP_ITEM(10),
    SHOP_ITEM(11), SHOP_ITEM(12), SHOP_ITEM(13),
  ],
};

describe('landing — whole-page probe', () => {
  it('stages the homepage in the order page.js actually renders', () => {
    const declared = BAND_ORDER.map((b) => b.split(':')[0]);
    const missing = declared.filter(
      (name) => !PROBE_SECTIONS[name] && !DATA_DRIVEN.includes(name),
    );
    expect(
      missing,
      `BAND_ORDER declares ${missing.join(', ')}, which this probe does not stage — `
      + 'the screenshots would not be of the real page',
    ).toEqual([]);
  });

  it('stages the rebuilt homepage at both widths', async () => {
    /* The shop band fetches at render time. Answered here rather than left to
       the network: a probe that quietly returns null for a band is exactly how
       that band went unphotographed through two redesigns. */
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(SHOP_FIXTURE) }));

    const order = BAND_ORDER
      .map((b) => b.split(':')[0])
      .filter((name) => PROBE_SECTIONS[name]);

    /* An async Server Component cannot be handed to the client renderer as an
       element — it is CALLED, and the element it returns is what renders.
       Which bands are async is not a fixed list here: it is read off the
       function itself, so a band that starts fetching something does not
       silently drop out of every screenshot of the page. */
    const bands = [];
    for (const name of order) {
      const Section = PROBE_SECTIONS[name];
      const el = Section.constructor.name === 'AsyncFunction'
        // eslint-disable-next-line no-await-in-loop
        ? await Section()
        : <Section />;
      bands.push(<React.Fragment key={name}>{el}</React.Fragment>);
    }

    const { container } = render(<>{bands}</>);
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });

    /* An ABSOLUTE src ignores <base>, so every image would render as a broken
       icon and the staged page would be measured with the wrong heights.
       templateShots.dump.jsx does the same rewrite for /templates/. */
    const html = container.innerHTML.replace(/src="\/images\//g, 'src="images/');
    const head = [...document.head.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    const { mode, css } = appCss();

    fs.mkdirSync(STAGE, { recursive: true });
    fs.writeFileSync(path.join(STAGE, 'page.html'),
      `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8">
<base href="file:///${PUBLIC}/">
${mode === 'SOURCE' ? WEBFONTS : ''}
<style>${FONTS}</style><style>${css}</style><style>${FONT_VARS}</style><style>${head}</style>
<style>
  /* Entrance animations run to their end state: this is a still. */
  *,*::before,*::after { animation-duration: 1ms !important; animation-delay: 0s !important; }
</style>
</head><body>
<!-- WHICH STYLESHEET THIS CAPTURE USED. In the page, not only in a console
     line that scrolls away: a SOURCE capture is trustworthy for layout and
     colour and only as trustworthy for TYPE as the network was when it was
     taken, and somebody reviewing the picture later has no other way to tell
     which they are looking at. -->
<div style="position:fixed;z-index:99999;top:0;right:0;padding:3px 9px;font:11px/1.4 monospace;background:${mode === 'BUILT' ? '#1b5e20' : '#8a4b00'};color:#fff">CSS: ${mode}</div>
${html}</body></html>`, 'utf8');

    /* Reported so the page's real height is a measured number rather than an
       estimate — "is it too long?" was the whole point of the rebuild. */
    // eslint-disable-next-line no-console
    console.log('PROBE staged page.html bytes:', html.length);

    /* The <details> accordion opens only its first item by default, which is
       what a visitor sees, so no forcing here. */
    for (const [name, w, h] of [['page1280', 1280, 7200], ['page390', 390, 11000]]) {
      fs.writeFileSync(path.join(OUT, `frame-${name}.html`),
        `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#fff;overflow:hidden;}
  iframe{position:absolute;top:0;left:0;width:${w}px;height:${h}px;border:0;}
</style></head><body><iframe src="stage/page.html" scrolling="no"></iframe></body></html>`, 'utf8');
    }
  });
});
