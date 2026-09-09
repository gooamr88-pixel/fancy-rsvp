import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(''), usePathname: () => '/' }));

import TemplatesShowcaseSection from '../src/app/components/landing/TemplatesShowcaseSection';
import { TEMPLATES } from '../src/app/utils/curatedTemplates';
import { CINEMATIC_KEYS } from '../src/app/components/templates/cinematic/cinematicThemes';
import { occasionPolicyFor } from '../src/app/utils/eventOccasion';
import { COLLECTION, OWN_PHOTO_NOTE } from '../src/app/collection/collectionCatalogue';

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SECTION = read('src/app/components/landing/TemplatesShowcaseSection.js');

/**
 * Does `/foo` resolve to a real page?
 *
 * Not a path join, for two reasons:
 *
 * · Next ROUTE GROUPS are directories in parentheses that do not appear in the
 *   URL, so `/register` lives at `(auth)/register/page.js`.
 * · DYNAMIC SEGMENTS are directories in square brackets. `/collection/ring` is
 *   served by `collection/[key]/page.js`, and without this the rail's own
 *   card links were reported dead.
 *
 * Kept in step with the copy in landingHomepage.test.jsx.
 */
function routeExists(href) {
  const segments = href.replace(/^\//, '').split('/').filter(Boolean);
  const walk = (dir, rest) => {
    if (rest.length === 0) return fs.existsSync(path.join(dir, 'page.js'));
    const [head, ...tail] = rest;
    if (fs.existsSync(path.join(dir, head)) && walk(path.join(dir, head), tail)) return true;
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    return entries.filter((e) => /^\[.+\]$/.test(e.name)).some((d) => walk(path.join(dir, d.name), tail))
      || entries.filter((e) => /^\(.+\)$/.test(e.name)).some((g) => walk(path.join(dir, g.name), rest));
  };
  return walk(path.join(ROOT, 'src/app'), segments);
}

/* THE BAND IS AN ASYNC SERVER COMPONENT (since 2026-08-21).
   It fetches the studio's WhatsApp number for the commission strip, so it
   cannot be handed to the client renderer as an element — it is CALLED, and
   the element it returns is what renders. Same shape the page probe uses.

   `settings` is answered here rather than left to the network: unmocked, the
   fetch reaches for localhost:5000, fails, is caught, and the strip silently
   does not render — which would make every assertion about it vacuous. */
const SHOP_SETTINGS = {
  enabled: true,
  whatsapp_number: '19055550134',
  whatsapp_greeting: 'Hello! I would like to order printed invitations.',
};

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ success: true, enabled: true, settings: SHOP_SETTINGS, products: [], categories: [] }),
  }));
});

/** Renders the awaited band. Every case below needs it, so it is one helper. */
const renderBand = async () => render(await TemplatesShowcaseSection());

/* ═══════════════════════════════════════════════════════════════════════════
   THE HOMEPAGE SHOWS THE ACTUAL INVITATIONS.

   Everything on the landing page used to be drawn by hand — a 39KB "decorative
   mockup" of the dashboard and four hand-built phone screens — while the three
   cinematic templates, the most differentiated thing this platform makes,
   appeared on it nowhere.

   These pin the two properties that matter: the imagery is real and current,
   and the words next to it come from the same source the product does.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the invitations are shown, and they are real', () => {
  it('shows every cinematic template', async () => {
    await renderBand();
    CINEMATIC_KEYS.forEach((key) => {
      const tpl = TEMPLATES.find((t) => t.key === key);
      expect(tpl, `${key} is not in the picker`).toBeTruthy();
      expect(screen.getByText(tpl.label), `${tpl.label} is missing from the homepage`).toBeTruthy();
    });
  });

  it('shows a real shot of each template, opened where there is one to show', async () => {
    /* Three of these open onto photography we supply, so the OPENED page is
       the thing worth showing and `hero-<key>.webp` is it.

       Sealed Letter is the exception, and deliberately: it opens onto the
       couple's own photograph, so there is no honest picture of its opened
       page — anything here would be a stock couple standing in for theirs,
       which is the exact impression that template exists to avoid giving. Its
       plate shows the sealed envelope we really do ship, and says the rest in
       words. Asserted as "one of the two", so a template cannot quietly end
       up with NO shot at all. */
    const { container } = await renderBand();
    const srcs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    CINEMATIC_KEYS.forEach((key) => {
      const opened = `/images/landing/hero-${key}.webp`;
      const sealed = `/images/landing/cover-${key}.webp`;
      expect(
        srcs.includes(opened) || srcs.includes(sealed),
        `${key} has no shot on its plate at all`,
      ).toBe(true);
    });
  });

  it('says whose photograph it is wherever it cannot show one', async () => {
    /* The other half of the exception above. A card that shows a sealed
       envelope and says nothing has simply told the visitor less than the
       other three did — the claim has to be made in words instead, and it is
       the strongest thing this template has to say.

       It was a margin note with a 64px stand-in illustration beside it until
       2026-09-09, when the plates became a 206px rail card and a footnote
       about what is behind one of them stopped fitting on it. The SENTENCE is
       the whole of the value and it now sits under the rail, read from the
       catalogue — which is also where the gallery can pick it up. The
       illustration is gone: it was decoration on top of a disclaimer. */
    const { container } = await renderBand();
    expect(container.textContent, 'the "your own photograph" claim is gone')
      .toMatch(/your own photograph/i);

    // From the catalogue, not typed into the band — the same rule ARRIVAL
    // follows and for the same reason.
    expect(SECTION).toContain('OWN_PHOTO_NOTE');
    expect(Object.values(OWN_PHOTO_NOTE).join(' ')).toMatch(/your own photograph/i);
  });

  it('the sealed-and-opened pair is still made, across the hero and the demo band', async () => {
    /* The claim is "it opens on film before it becomes a page", and one image
       cannot make that point. This band used to carry the pair for all three
       templates — six tall photographs in a row, which showed the same idea
       three times.

       Since 2026-09-09 the two halves are one band apart and that is the
       point of the arrangement: the HERO holds Swan Lake sealed, and the
       guest-experience band holds the same invitation open, under a heading
       about what opening one is like. So the guarantee did not go away, it
       moved twice — assert it where it now lives, or the page can quietly
       lose the pair entirely. */
    const hero = read('src/app/components/landing/HeroSection.js');
    expect(hero, 'the hero no longer shows a sealed invitation')
      .toContain('/images/landing/cover-swans.webp');
    const experience = read('src/app/components/landing/GuestExperienceSection.js');
    expect(experience, 'no band shows the invitation opened any more')
      .toContain('/images/landing/hero-swans.webp');
  });

  it('every image it names is actually shipped', async () => {
    const { container } = await renderBand();
    [...container.querySelectorAll('img')].forEach((img) => {
      const src = img.getAttribute('src');
      const file = path.join(ROOT, 'public', src.replace(/^\//, ''));
      expect(fs.existsSync(file), `${src} is not in public/`).toBe(true);
    });
  });

  it('keeps the whole set inside a sane page budget', async () => {
    /* Every invitation photograph and every dashboard frame on the homepage
       lives in this folder. Most are lazy, but they are still the page's
       weight, and the hero's is the LCP image.

       ── 320 -> 360 on 2026-09-09, and the arithmetic is the point ────────
       That pass added FIVE files — the hero photograph and one frame per
       dashboard tab — and the folder grew by 25KB, from 296 to 321, because
       three dead ones went with them: cover-bab (69KB) and cover-ring (12KB)
       were left behind when the band stopped showing sealed covers, and
       couple-illustration (9KB) was the stand-in drawing beside a footnote
       that is now one sentence.

       The ceiling moves to 360 rather than to whatever the folder happens to
       weigh: a budget with no headroom fails the next person for adding one
       honest file, and a budget set to the current total is not a budget. What
       it must never do is move to FIT a lazily compressed file — the four
       dashboard frames are 1120px wide at quality 62 and land at 20-30KB
       each. If one arrives at 90, compress it. */
    const dir = path.join(ROOT, 'public/images/landing');
    const total = fs.readdirSync(dir)
      .reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0);
    expect(Math.round(total / 1024), 'the landing imagery has grown past its budget')
      .toBeLessThan(360);
  });

  it('ships no landing image that nothing on the site references', async () => {
    /* THE OTHER HALF OF THE BUDGET, and the half that actually leaked. Three
       files sat in this folder unreferenced for weeks — 90KB, 30% of the whole
       allowance — because deleting the code that showed a picture does not
       delete the picture. Every byte of that was being deployed.

       Scoped to src/ plus the shots harness: an image referenced only by a
       test fixture is still dead as far as the site is concerned.

       ── WHY IT COLLECTS NAMES RATHER THAN CONCATENATING FILES ────────────
       The first version read every .js under src/ into an array and joined it
       into one string, then ran 11 `includes` over the result. In isolation
       that took 14s. In a FULL SUITE RUN it took more than 60 and timed out —
       and took `committedImports` down with it, which is a whole-tree walk of
       its own that had been passing. vitest.config.mjs already documents five
       such walks fighting over one oversubscribed machine; this was the sixth,
       and it was the greediest.

       One regex pass per file into a Set costs the same reads and none of the
       megabytes of string joining. */
    const dir = path.join(ROOT, 'public/images/landing');
    const referenced = new Set();
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!/\.(js|jsx|mjs|css)$/.test(e.name)) continue;
        const src = fs.readFileSync(full, 'utf8');
        for (const m of src.matchAll(/images\/landing\/([\w.-]+)/g)) referenced.add(m[1]);
      }
    };
    [path.join(ROOT, 'src'), path.join(ROOT, 'test/shots')].forEach(walk);

    fs.readdirSync(dir).forEach((f) => {
      expect(referenced.has(f), `${f} is shipped and referenced nowhere`).toBe(true);
    });
  }, 120000);

  it('declares dimensions and defers loading', async () => {
    const { container } = await renderBand();
    [...container.querySelectorAll('img')].forEach((img) => {
      // Without both, six tall images below the fold are a layout shift and a
      // blocking download.
      expect(img.getAttribute('width'), 'no width — this will shift the layout').toBeTruthy();
      expect(img.getAttribute('height')).toBeTruthy();
      expect(img.getAttribute('loading')).toBe('lazy');
      expect((img.getAttribute('alt') || '').length, 'alt text is too thin').toBeGreaterThan(30);
    });
  });
});

describe('the words come from the product, not a second copy', () => {
  it('reads the catalogue rather than rebuilding its own view of it', async () => {
    /* THE BAND USED TO BE THE FIFTH SURFACE ASSEMBLING THIS LIST. It filtered
       TEMPLATES by CINEMATIC_KEYS, resolved the badge through
       occasionPolicyFor, held its own map of which webp represents each
       template, and imported ARRIVAL for the opening line — which is exactly
       what collection/collectionCatalogue.js does, for the gallery, the detail
       pages and the sitemap, and whose whole docstring is about why that list
       must exist once.

       So the assertion moved up a level: the band renders COLLECTION, and the
       CATALOGUE is what has to agree with the registry and the picker. Both
       halves are still pinned — the second by the tests below. */
    /* Matched on the IMPORT LINES, not on the file's text. The header above
       names the four things the band used to assemble for itself, and a test
       that fails on the sentence explaining what was fixed punishes writing
       the explanation down. */
    const imports = SECTION.slice(0, SECTION.indexOf('/* ═'));
    expect(imports).toMatch(/import \{[^}]*COLLECTION/);
    expect(imports, 'the band is reassembling the catalogue again')
      .not.toMatch(/CINEMATIC_KEYS|curatedTemplates|eventOccasion/);

    /* THE CARD IS A PICTURE, A NAME AND AN OCCASION. It also carried the
       template's ARRIVAL line ("They break the seal. The card rises out.") in
       italic underneath — charming, and a fourth line on each of four cards in
       a band whose subject is photographs. The sentences are not lost: they
       are still in the catalogue, and /collection prints all four. */
    const { container } = await renderBand();
    COLLECTION.forEach((c) => {
      expect(screen.getByText(c.label), `${c.label} is missing from the rail`).toBeTruthy();
    });
    expect(container.querySelectorAll('.tss-slide').length).toBe(COLLECTION.length);
  });

  it('the catalogue it reads still takes its names from the template registry', async () => {
    /* One level down from the band: whatever COLLECTION says a template is
       called, it has to be what the create-event wizard calls it. */
    TEMPLATES.filter((t) => CINEMATIC_KEYS.includes(t.key)).forEach((t) => {
      const item = COLLECTION.find((c) => c.key === t.key);
      expect(item, `${t.key} is in the picker and not in the collection`).toBeTruthy();
      expect(item.label).toBe(t.label);
      expect(item.desc).toBe(t.desc);
    });
  });

  it('takes the occasion badge from the same policy the picker offers from', async () => {
    /* Otherwise the homepage can advertise "any occasion" on a template the
       wizard then refuses — Velvet Ring is engagements only. Read through the
       catalogue now, which is where occasionPolicyFor is consulted. */
    const catalogue = read('src/app/collection/collectionCatalogue.js');
    expect(catalogue).toContain('occasionPolicyFor');
    await renderBand();
    expect(screen.getAllByText(occasionPolicyFor('ring').label).length).toBeGreaterThan(0);
    expect(screen.getAllByText(occasionPolicyFor('bab').label).length).toBeGreaterThan(0);
  });

  it('gives the rail a dot per invitation, and marks where you are', async () => {
    /* The mockup's carousel indicator, and it is not decoration: a rail with
       no indicator does not say how much more there is or where you are in it.
       It is also what let the ARROWS be hidden below 768 — two controls for
       one gesture is the doubling that made the first pass at this page busy.

       Real buttons, because they move the rail. Labelled by the template each
       one leads to rather than "slide 2 of 4", which tells a screen-reader
       user nothing they can act on. */
    const { container } = await renderBand();
    const dots = [...container.querySelectorAll('.tss-dot')];
    expect(dots.length, 'the rail has no dots').toBe(COLLECTION.length);
    dots.forEach((d, i) => {
      expect(d.tagName, 'a dot that moves the rail must be a button').toBe('BUTTON');
      expect(d.getAttribute('aria-label')).toContain(COLLECTION[i].label);
    });
    // Exactly one is current before anything is scrolled, and it is the first.
    const on = dots.filter((d) => d.getAttribute('aria-current') === 'true');
    expect(on.length, 'more than one dot is marked current').toBe(1);
    expect(on[0]).toBe(dots[0]);
  });

  it('does not link anywhere that does not exist', async () => {
    // There is no /templates route; the place a visitor actually picks one is
    // step 1 of the wizard.
    expect(SECTION).not.toMatch(/href="\/templates"/);
    const { container } = await renderBand();
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs.length).toBeGreaterThan(0);
    /* INTERNAL only. Since 2026-08-21 the band also carries an outbound
       wa.me link, and routeExists() answers "is there a page.js for this
       path" — the honest answer for an external URL is that the question does
       not apply, not that the link is broken. The commission strip's own
       describe block checks that one. */
    const internal = hrefs.filter((h) => h && h.startsWith('/'));
    expect(internal.length, 'the band has stopped linking into the product').toBeGreaterThan(0);
    internal.forEach((h) => {
      expect(routeExists(h), `${h} resolves to no page.js`).toBe(true);
    });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THREE INVITATIONS READ AS A MENU

   A visitor whose event is not one of the three concludes the product cannot
   do it. It can — the studio designs one — and that was said nowhere on the
   page. The strip says it where the assumption is formed.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the commission strip', () => {
  const commissionLink = (container) => container.querySelector('.tss-comm__btn');

  it('offers a custom invitation on the studio WhatsApp number', async () => {
    const { container } = await renderBand();
    const a = commissionLink(container);
    expect(a, 'the band says these three are all there is').toBeTruthy();
    expect(a.getAttribute('href')).toContain('wa.me/19055550134');
  });

  it('opens the right conversation, not the printed-goods one', async () => {
    /* buildWhatsappUrl falls back to settings.whatsapp_greeting, which is
       "I would like to order printed invitations" — the wrong conversation
       from a band about designing one, and it reads as a mis-wired link. */
    const { container } = await renderBand();
    const text = decodeURIComponent(commissionLink(container).getAttribute('href'));
    expect(text).toMatch(/custom invitation design/i);
    expect(text).not.toMatch(/order printed invitations/i);
  });

  it('does not open a new tab without cutting the opener reference', async () => {
    const { container } = await renderBand();
    const a = commissionLink(container);
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
  });

  it('says nothing at all when no number is configured', async () => {
    /* A CTA that opens "wa.me/" and nothing else is worse than no CTA — the
       same rule isShopLive states for the catalogue. */
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ settings: { enabled: true, whatsapp_number: '' } }),
    }));
    const { container } = await renderBand();
    expect(commissionLink(container)).toBeNull();
  });

  it('still shows the invitations when the settings call fails', async () => {
    // The band's reason to exist is the photography; the strip is an extra.
    global.fetch = vi.fn(() => Promise.reject(new Error('down')));
    const { container } = await renderBand();
    expect(commissionLink(container)).toBeNull();
    expect(container.querySelectorAll('.tss-slide').length).toBe(CINEMATIC_KEYS.length);
  });
});

describe('it survives a phone', () => {
  /** The rail's own rule block, up to its closing brace. */
  const rule = (selector) => {
    const at = SECTION.indexOf(`${selector} {`);
    expect(at, `${selector} is gone`).toBeGreaterThan(-1);
    return SECTION.slice(at, SECTION.indexOf('}', at));
  };

  it('scrolls sideways instead of stacking four handsets down the page', async () => {
    /* THE FAILURE THIS REPLACED, TWICE OVER. The images are 468x1013 — whole
       phone screens. As grid items they set a min-content floor no phone can
       meet (fixed 2026-08-21 with min-width: 0 and a max-width cap), and even
       capped, one column on a phone meant four of them stacked: about 2,400px
       of scrolling for four pictures.

       A rail is one screen at every width. The three properties that make it
       one are asserted here rather than left to a reviewer's eye: the port
       scrolls, the cards do not shrink to fit, and the scroll snaps so a
       half-card is never where a swipe leaves you. */
    const rail = rule('.tss-rail');
    expect(rail, 'the rail no longer scrolls').toMatch(/overflow-x:\s*auto/);
    expect(rail, 'the rail lost its snap').toMatch(/scroll-snap-type:\s*x/);

    const slide = rule('.tss-slide');
    expect(slide, 'a slide can shrink, so four will squeeze onto one screen')
      .toMatch(/flex:\s*none/);
    expect(slide, 'a slide has no width, so it collapses to its content')
      .toMatch(/width:\s*\d+px/);
  });

  it('shows a card and a half on the narrowest phone, so the rail reads as one', async () => {
    /* A rail whose first card exactly fills the port looks like a single
       static card and nobody swipes it. The arithmetic, per AGENTS.md, rather
       than a browser: inside .fx-gutter at 320px there are 280px of usable
       width, and the card plus one gap has to leave a visible slice of the
       next one — but not so narrow that the card itself stops being a
       photograph. */
    const width = Number(rule('.tss-slide').match(/width:\s*(\d+)px/)[1]);
    const gap = Number(rule('.tss-rail').match(/gap:\s*(\d+)px/)[1]);
    const AVAILABLE = 280;

    const peek = AVAILABLE - width - gap;
    expect(peek, `a ${width}px card leaves ${peek}px of the next one — no reason to swipe`)
      .toBeGreaterThan(30);
    expect(width, 'the card is too narrow to read as an invitation').toBeGreaterThanOrEqual(180);
  });

  it('uses only breakpoints on the four-value scale', async () => {
    const widths = [...SECTION.matchAll(/\((?:max|min)-width: *([\d.]+)px\)/g)].map((m) => m[1]);
    const ALLOWED = new Set(['639.98', '640', '767.98', '768', '1023.98', '1024', '1279.98', '1280', '44']);
    widths.forEach((w) => expect(ALLOWED.has(w), `${w}px is off the scale`).toBe(true));
  });

  it('uses a plain style element, so next/link cannot lose its rules', async () => {
    /* This used to need a SEPARATE "style jsx global" block, because
       styled-jsx stamps its hash only onto lowercase intrinsic elements and a
       scoped rule aimed at a class on a next/link matches nothing — the bug
       that once made every footer link invisible in production only.

       A plain <style> has no scoped/global distinction to get wrong, so the
       stronger assertion is that styled-jsx is not here at all. Scoping is
       replaced by the "tss-" prefix on every class. */
    expect(SECTION, 'styled-jsx is back, and next/link will silently lose its rules')
      .not.toContain('style jsx');
    expect(SECTION).toMatch(/<style>\{`/);
    expect(SECTION).toMatch(/\.tss-btn \{/);
  });

  it('has no backtick inside its style block', async () => {
    // One backtick in a CSS comment ends the template literal and the file
    // stops parsing. It has cost three build failures across this codebase —
    // scripts/backtickInCssComment.js now checks the whole tree for it.
    const blocks = [...SECTION.matchAll(/<style>\{`([\s\S]*?)`\}<\/style>/g)];
    expect(blocks.length, 'the style block moved').toBe(1);
    blocks.forEach(([, css], i) => {
      expect(css.includes('`'), `a backtick is inside style block ${i}`).toBe(false);
    });
  });
});

describe('the imagery can be regenerated', () => {
  it('the shots harness exists and is kept out of the test suite', async () => {
    /* If the only way to regenerate these is to remember how, they go stale
       the first time a template changes. */
    const dump = read('test/shots/templateShots.dump.jsx');
    expect(dump).toContain('VelvetBoxOpening');
    expect(dump).toContain('WaxEnvelopeOpening');
    expect(dump).toContain('force-device-scale-factor');

    const cfg = read('vitest.shots.config.mjs');
    expect(cfg).toContain("config.test.include = ['test/shots/*.dump.jsx']");

    // ...and the default suite must not pick it up.
    const base = read('vitest.config.mjs');
    expect(base).toContain("include: ['test/**/*.test.{js,jsx}']");
  });
});
