import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/collection',
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));

import CollectionGallery from '../src/app/collection/CollectionGallery';
import {
  COLLECTION, COLLECTION_BY_KEY, COLLECTION_KEYS, FILTERS,
  collectionFor, countFor, isCollectionKey, collectionItem, ARRIVAL,
} from '../src/app/collection/collectionCatalogue';
import { generateStaticParams } from '../src/app/collection/[key]/page';
import { TEMPLATES } from '../src/app/utils/curatedTemplates';
import { CINEMATIC_KEYS } from '../src/app/components/templates/cinematic/cinematicThemes';
import { resolveOccasion, occasionPolicyFor } from '../src/app/utils/eventOccasion';
import { buildDemoEvent, DEMO_OCCASION_COPY } from '../src/app/demo/fixtures/demoEvent.mjs';

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Same helper, same shape, as scripts/deadLandingCode.js — a source check
 *  that reads comments reports the explanation of a rule as a breach of it. */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const CATALOGUE = read('src/app/collection/collectionCatalogue.js');
const GALLERY = read('src/app/collection/CollectionGallery.js');
const INDEX = read('src/app/collection/page.js');
const DETAIL = read('src/app/collection/[key]/page.js');
const LIVE = read('src/app/collection/[key]/LiveInvitation.js');
const DEMO_STAGE = read('src/app/demo/invitation/page.js');

/* ═══════════════════════════════════════════════════════════════════════════
   THE COLLECTION.

   /collection is the gallery the four invitations never had. Until it
   shipped, the homepage band that showed them ended with a button pointing at
   /register and a comment in the source saying the gallery did not exist —
   so the most differentiated thing this product makes could be looked at in
   one band and nowhere else, and could not be OPENED anywhere at all outside
   the demo.

   What these cases actually protect, in rough order of what would hurt most:

     1. THE URL SEGMENT IS AN ALLOWLIST. `[key]` becomes `template_type` on an
        event object a renderer reads, and `template_type` is free text with no
        CHECK constraint anywhere in the schema — nothing downstream refuses a
        bad one. The same is true of the demo stage's `?t=`.
     2. THE WORDS AND THE COVER AGREE. Velvet Ring is locked to engagement and
        every renderer clamps to that, so the fixture has to word itself to
        match or the page prints an engagement kicker over "we are getting
        married".
     3. NOTHING IS TYPED TWICE. Four surfaces name these templates; all four
        read one array.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Does `/foo` resolve to a real page?
 *
 *  Not a path join: Next ROUTE GROUPS are directories in parentheses that do
 *  not appear in the URL, so `/register` lives at `(auth)/register/page.js`.
 *  A dynamic segment directory (`[key]`) counts for any single segment.
 *  Copied in shape from templatesShowcase.test.jsx, which needed the same. */
function routeExists(href) {
  const segments = href.replace(/^\//, '').split('/').filter(Boolean);
  const walk = (dir, rest) => {
    if (rest.length === 0) return fs.existsSync(path.join(dir, 'page.js'));
    const [head, ...tail] = rest;
    if (fs.existsSync(path.join(dir, head)) && walk(path.join(dir, head), tail)) return true;
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    // A route group is invisible in the URL; a dynamic segment eats one.
    if (entries.filter((e) => /^\(.+\)$/.test(e.name)).some((g) => walk(path.join(dir, g.name), rest))) return true;
    return entries.filter((e) => /^\[.+\]$/.test(e.name)).some((d) => walk(path.join(dir, d.name), tail));
  };
  return walk(path.join(ROOT, 'src/app'), segments);
}

describe('the key in the URL is an allowlist, not a parameter', () => {
  it('serves exactly the cinematic templates and nothing else', () => {
    expect(COLLECTION_KEYS).toEqual(CINEMATIC_KEYS);
    expect(generateStaticParams()).toEqual(CINEMATIC_KEYS.map((key) => ({ key })));
  });

  it('turns off on-demand rendering, so an unknown path cannot reach a renderer', () => {
    /* generateStaticParams alone only decides what is PREBUILT. Without
       `dynamicParams = false`, /collection/<anything> still renders at request
       time and the only thing between an arbitrary string and template_type
       is a notFound() somebody has to remember to write. */
    expect(DETAIL).toMatch(/export const dynamicParams = false/);
  });

  it('still calls notFound() for the dev server, where params stay dynamic', () => {
    expect(DETAIL).toMatch(/if \(!item\) notFound\(\)/);
  });

  it('rejects every shape of bad key, including inherited property names', () => {
    ['', 'wedding', 'custom', '../../etc', 'constructor', 'toString', '__proto__']
      .forEach((bad) => {
        expect(isCollectionKey(bad), `${bad} must not be a collection key`).toBe(false);
      });
    COLLECTION_KEYS.forEach((k) => expect(isCollectionKey(k)).toBe(true));
  });

  it('resolves an untrusted key to null rather than to an inherited function', () => {
    /* THE BUG THIS PINS. `COLLECTION_BY_KEY['constructor']` is
       Object.prototype.constructor — a function, and therefore truthy — so
       `const item = COLLECTION_BY_KEY[key]; if (!item) notFound();` never
       fires its own 404 and goes on to render `item.label` as undefined.
       Every place that turns a URL segment into a template goes through
       collectionItem instead. */
    ['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty']
      .forEach((bad) => {
        expect(collectionItem(bad), `${bad} resolved to something`).toBeNull();
      });
    expect(collectionItem('swans')).toBe(COLLECTION_BY_KEY.swans);
  });

  it('uses that accessor at both places a key arrives from outside', () => {
    /* COMMENTS STRIPPED — both files carry a note naming the bare index as
       the thing NOT to do, and matching raw source reports the warning as the
       offence. Third time this file has needed it; see the styled-jsx case. */
    expect(stripComments(DETAIL)).not.toMatch(/COLLECTION_BY_KEY\[/);
    expect(stripComments(DEMO_STAGE)).not.toMatch(/COLLECTION_BY_KEY\[/);
    // The route guards twice: generateMetadata and the page body.
    expect((stripComments(DETAIL).match(/collectionItem\(key\)/g) || []).length,
      'generateMetadata and the page body must both guard').toBe(2);
  });

  it('does not treat an inherited name as a real occasion either', () => {
    /* Same class, different object: collectionFor's first line asks "is this
       a real occasion" of CUSTOM_CATEGORY_BY_KEY, and a bare index answers
       yes for constructor — which then filtered the gallery as though the
       catalogue knew it. */
    ['constructor', 'toString', '__proto__'].forEach((bad) => {
      expect(collectionFor(bad), `${bad} filtered the gallery`).toEqual(COLLECTION);
    });
  });

  it('guards the demo stage query parameter the same way', () => {
    /* ?t= lands on template_type too. It must be a LOOKUP against the
       catalogue, never the raw value threaded through — and an unknown key
       must fall back to a real template rather than error, because the
       failure mode of a shared link is a typo. */
    expect(DEMO_STAGE).toMatch(/COLLECTION_BY_KEY\[params\.get\('t'\) \|\| ''\] \|\| null/);
    expect(DEMO_STAGE).toMatch(/chosen\?\.key \|\| 'swans'/);
    /* The raw parameter must never be what gets rendered. If this ever reads
       templateType={params.get(...)} the guard above has been bypassed. */
    expect(DEMO_STAGE).not.toMatch(/templateType:\s*params\.get/);
  });

  it('re-checks the key inside the component that builds the event', () => {
    // A prop is not a promise: the route guards the URL, this guards reuse.
    expect(LIVE).toMatch(/isCollectionKey\(templateKey\)/);
  });
});

describe('the invitation and its words agree about what is being celebrated', () => {
  /* THE BUG THIS EXISTS FOR. Velvet Ring declares occasions: ['engagement'].
     resolveOccasion and getCinematicOccasion both CLAMP to that on read, so
     an event on Velvet Ring is an engagement whatever the row says. The demo
     fixture was a wedding and only a wedding, so opening Velvet Ring from the
     collection printed an engagement kicker over a page whose own description
     read "We are getting married on the Corniche". */

  it('gives every template the occasion its renderer will actually use', () => {
    COLLECTION.forEach((item) => {
      const event = buildDemoEvent({ templateType: item.key, occasion: item.occasion });
      expect(
        resolveOccasion(event.template_type, event.template_data),
        `${item.label} says ${item.occasion} but renders as something else`,
      ).toBe(item.occasion);
    });
  });

  it('has words written for every occasion the collection can produce', () => {
    COLLECTION.forEach((item) => {
      expect(
        DEMO_OCCASION_COPY[item.occasion],
        `no demo copy for ${item.occasion} (${item.label}) — it would fall back to a wedding`,
      ).toBeTruthy();
    });
  });

  it('words Velvet Ring as an engagement, not a wedding', () => {
    const ring = buildDemoEvent({ templateType: 'ring', occasion: COLLECTION_BY_KEY.ring.occasion });
    expect(COLLECTION_BY_KEY.ring.occasion).toBe('engagement');
    expect(ring.event_type).toBe('engagement');
    expect(ring.description).toMatch(/getting engaged/);
    expect(ring.description, 'the ring box still says the couple are getting married')
      .not.toMatch(/getting married/);
    expect(ring.template_data.ha_days[0].label).toBe('The engagement');
  });

  it('leaves every other template, and every existing caller, on the wedding', () => {
    // No argument at all is what the three demo stages and the organizer
    // fixture pass. It must be the event it has always been.
    const bare = buildDemoEvent();
    expect(bare.event_type).toBe('wedding');
    expect(bare.description).toMatch(/getting married/);
    expect(bare.template_data.ha_days[0].label).toBe('The wedding');

    ['bab', 'swans', 'letter'].forEach((key) => {
      expect(COLLECTION_BY_KEY[key].occasion).toBe('wedding');
    });
  });

  it('falls back to the wedding rather than rendering undefined into the story', () => {
    /* The occasion catalogue has 25 entries and this fixture is written for
       two. That is a content limit, and it must fail soft — a page whose
       story reads "undefined" is worse than one that reads as a wedding. */
    const odd = buildDemoEvent({ occasion: 'quinceanera' });
    expect(odd.description).toBe(buildDemoEvent().description);
    expect(odd.template_data.ha_our_story).toBeTruthy();
  });
});

describe('Sealed Letter can be given the photograph it is built around', () => {
  /* It is the only template that ships no artwork: the couple's own picture
     IS the fold. With none it renders a finished typographic hero, which is
     deliberate — but a gallery promising "your photograph fills the page"
     should be able to demonstrate the page with one. */

  it('puts the photo on letter_hero_photo, NOT on cover_image_url', () => {
    /* HeritageArchPage pushes cover_image_url into its own framed section
       further down the page, so using it for the fold prints the same
       picture twice. The distinction is documented on the heroPhoto prop and
       is easy to get backwards. */
    const withPhoto = buildDemoEvent({ templateType: 'letter', letterHeroPhoto: '/x.jpg' });
    expect(withPhoto.template_data.letter_hero_photo).toBe('/x.jpg');
    expect(withPhoto.cover_image_url).toBeNull();
  });

  it('treats no photograph as a finished state, not a missing one', () => {
    const bare = buildDemoEvent({ templateType: 'letter' });
    expect(bare.template_data.letter_hero_photo).toBeNull();
    // The hero still knows where to put the words, so the typographic
    // fallback is composed rather than defaulted at random.
    expect(bare.template_data.letter_hero_text_pos).toBe('bottom');
  });
});

describe('nothing about these templates is typed out twice', () => {
  it('takes name, tagline and description from the template registry', () => {
    COLLECTION.forEach((item) => {
      const source = TEMPLATES.find((t) => t.key === item.key);
      expect(item.label).toBe(source.label);
      expect(item.tagline).toBe(source.tagline);
      expect(item.desc).toBe(source.desc);
    });
  });

  it('takes the occasion badge from the same policy the wizard enforces', () => {
    COLLECTION.forEach((item) => {
      const policy = occasionPolicyFor(item.key);
      expect(item.badge).toBe(policy.label);
      expect(item.locked).toBe(policy.locked);
      expect(item.note).toBe(policy.note);
    });
  });

  it('takes the live view first frame from the template own asset list', () => {
    // Not a hand-picked still: the poster IS the opening's first frame, so
    // the picture on screen and the frame the film starts on cannot drift.
    expect(CATALOGUE).toMatch(/cine\?\.assets\?\.poster/);
  });

  it('builds the sitemap entries from the catalogue rather than a second list', () => {
    const sitemap = read('src/app/sitemap.js');
    expect(sitemap).toMatch(/COLLECTION_KEYS\.map/);
    expect(sitemap, 'a template path was typed into the sitemap by hand')
      .not.toMatch(/'\/collection\/(ring|bab|swans|letter)'/);
  });

  it('builds the structured data from the array the page renders', () => {
    expect(INDEX).toMatch(/COLLECTION\.map\(\(item, i\)/);
  });
});

describe('every picture and every link is real', () => {
  it('ships every plate photograph', () => {
    COLLECTION.forEach((item) => {
      expect(fs.existsSync(path.join(ROOT, 'public', item.art.replace(/^\//, ''))),
        `${item.art} is not in public/`).toBe(true);
    });
  });

  it('ships every live-view poster', () => {
    COLLECTION.forEach((item) => {
      expect(fs.existsSync(path.join(ROOT, 'public', item.poster.replace(/^\//, ''))),
        `${item.poster} is not in public/`).toBe(true);
    });
  });

  it('adds no new bytes to the landing image budget', () => {
    /* The gallery deliberately reuses the photographs the homepage already
       ships. templatesShowcase.test.jsx caps this directory at 320KB and it
       sits at ~297 — there is not room for a second set, and the right
       answer was never to raise the cap. */
    const dir = path.join(ROOT, 'public/images/landing');
    const total = fs.readdirSync(dir).reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
    expect(Math.round(total / 1024)).toBeLessThan(320);

    COLLECTION.forEach((item) => {
      expect(item.art, 'the gallery is pulling art from outside the committed landing set')
        .toMatch(/^\/images\/landing\//);
    });
  });

  it('points every internal link at a route that exists', () => {
    const hrefs = [INDEX, DETAIL, LIVE, GALLERY]
      .flatMap((src) => [...src.matchAll(/href="(\/[^"{]*)"/g)].map((m) => m[1]));
    expect(hrefs.length).toBeGreaterThan(0);
    hrefs.forEach((href) => {
      expect(routeExists(href), `${href} is a dead link`).toBe(true);
    });
  });

  it('does not link /templates, which is still a 308 to the homepage', () => {
    /* next.config.mjs redirects /templates permanently. A gallery link
       pointing there would bounce to the homepage with no error anywhere. */
    [INDEX, DETAIL, LIVE, GALLERY, CATALOGUE].forEach((src) => {
      expect(src).not.toMatch(/href="\/templates"/);
    });
    expect(read('next.config.mjs'), 'the retired /templates redirect was removed')
      .toMatch(/source: '\/templates'/);
  });
});

describe('the occasion chips do something when you press them', () => {
  it('never offers an occasion the catalogue has never heard of', () => {
    // A chip whose key is not a real occasion silently shows everything.
    FILTERS.filter((f) => f.key).forEach((f) => {
      expect(countFor(f.key), `the ${f.label} chip matches nothing`).toBeGreaterThan(0);
    });
  });

  it('excludes a template the product would refuse for that occasion', () => {
    // Velvet Ring is a ring box; it is not a wedding and not a celebration.
    expect(collectionFor('wedding').map((c) => c.key)).not.toContain('ring');
    expect(collectionFor('celebration').map((c) => c.key)).not.toContain('ring');
  });

  it('promotes the template made for an occasion above the ones that allow it', () => {
    /* Three of four declare occasions: 'any', so the Engagement chip
       excludes nothing at all. Without the promotion it would be a button
       that visibly does nothing, which reads as broken. */
    const engagement = collectionFor('engagement');
    expect(engagement).toHaveLength(COLLECTION.length);
    expect(engagement[0].key, 'Velvet Ring should lead its own occasion').toBe('ring');
  });

  it('leaves the picker order alone when no chip is pressed', () => {
    expect(collectionFor(null)).toEqual(COLLECTION);
    expect(COLLECTION.map((c) => c.key)).toEqual(
      TEMPLATES.filter((t) => CINEMATIC_KEYS.includes(t.key)).map((t) => t.key),
    );
  });

  it('re-orders the rendered list when a chip is pressed', async () => {
    const user = userEvent.setup();
    render(<CollectionGallery />);

    const names = () => [...document.querySelectorAll('.col-name')].map((n) => n.textContent);
    expect(names()[0]).toBe('Velvet Ring');

    await user.click(screen.getByRole('button', { name: /wedding/i }));
    expect(names(), 'Velvet Ring is an engagement template and must leave the wedding list')
      .not.toContain('Velvet Ring');

    await user.click(screen.getByRole('button', { name: /^all/i }));
    expect(names()).toHaveLength(COLLECTION.length);
  });

  it('announces which chip is active', async () => {
    const user = userEvent.setup();
    render(<CollectionGallery />);
    const wedding = screen.getByRole('button', { name: /wedding/i });
    expect(wedding).toHaveAttribute('aria-pressed', 'false');
    await user.click(wedding);
    expect(wedding).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('the gallery reads as a gallery', () => {
  it('renders every invitation with one link, not three to the same place', () => {
    /* A card with a linked picture, a linked title and a linked "view live"
       is three tab stops and three identical announcements. */
    render(<CollectionGallery />);
    COLLECTION.forEach((item) => {
      const links = screen.getAllByRole('link').filter(
        (a) => a.getAttribute('href') === `/collection/${item.key}`,
      );
      expect(links, `${item.label} has ${links.length} links to itself`).toHaveLength(1);
      /* The photograph is inside the one link rather than beside it, so the
         picture is part of the target instead of a second target. Queried as
         a NODE, not by role: an alt="" image has no accessible role at all,
         which is the entire point of it. */
      expect(links[0].querySelector('.col-device img')).toBeTruthy();
    });
  });

  it('gives every photograph dimensions, so nothing shifts as they load', () => {
    /* Scoped to the render container, not `document`. Testing Library cleans
       up between cases, but a document-wide query in a file that renders this
       component in six of them is one stray mount away from counting the
       previous case's plates. */
    const { container } = render(<CollectionGallery />);
    const imgs = [...container.querySelectorAll('.col-device img')];
    expect(imgs).toHaveLength(COLLECTION.length);
    imgs.forEach((img) => {
      expect(img.getAttribute('width'), 'no width — this will shift the layout').toBeTruthy();
      expect(img.getAttribute('height')).toBeTruthy();
    });
  });

  it('keeps the plate photographs decorative, so the link says each thing once', () => {
    /* NOT an oversight, and the opposite of the homepage band's rule — the
       difference is that there the picture stands beside its own caption, and
       here the whole plate is ONE link whose text already reads the name, the
       occasion, the style and how it opens. A described image would make the
       link announce the same two facts twice before reaching the useful ones. */
    const { container } = render(<CollectionGallery />);
    const imgs = [...container.querySelectorAll('.col-device img')];
    expect(imgs).toHaveLength(COLLECTION.length);
    imgs.forEach((img) => expect(img.getAttribute('alt')).toBe(''));
  });

  it('names each plate link by what it leads to, not by its picture', () => {
    render(<CollectionGallery />);
    COLLECTION.forEach((item) => {
      const link = screen.getAllByRole('link').find(
        (a) => a.getAttribute('href') === `/collection/${item.key}`,
      );
      // The visible text carries the whole label, so the picture need not.
      expect(link.textContent).toContain(item.label);
      expect(link.textContent).toContain(item.arrival);
      expect(link.textContent).toContain('View live');
    });
  });

  it('says what the guest physically does with each one', () => {
    COLLECTION.forEach((item) => {
      expect(ARRIVAL[item.key], `${item.label} has no arrival line`).toBeTruthy();
      expect(item.arrival).toBe(ARRIVAL[item.key]);
    });
  });

  it('writes those four sentences once, not once per surface', () => {
    /* The homepage band held a verbatim second copy of ARRIVAL until this
       module took it over — the same prose in the two places a visitor meets
       it, which is how one of them ends up describing an opening a template
       no longer has. */
    const band = read('src/app/components/landing/TemplatesShowcaseSection.js');
    expect(band, 'the band is declaring its own ARRIVAL again')
      .not.toMatch(/^const ARRIVAL = \{/m);
    expect(band, 'the band should read ARRIVAL from the collection catalogue')
      .toMatch(/import \{ ARRIVAL \} from ["'][^"']*collectionCatalogue["']/);
  });

  it('never types the number of templates into a call to action', () => {
    /* The invitations band already had to fix exactly this: it counted its
       templates in two places, and shipping a fourth left the homepage saying
       "three" twice. This page shipped "See all four", which would have gone
       the same way on the fifth.

       PINNED PRECISELY, not by a clever regex. The first version of this case
       looked for any number word within twenty characters of "invitation",
       "template" or "collection" anywhere in the file — which fires on every
       ordinary sentence that happens to say "one invitation", and did. A
       check with false positives is one people learn to ignore, which is
       where a real finding goes to die (AGENTS.md says so about the greps
       this repo already deleted for the same reason). */
    [INDEX, DETAIL, GALLERY].forEach((src) => {
      expect(stripComments(src), 'a call to action is counting the catalogue')
        .not.toMatch(/(See|View|Browse|Explore|All)\s+(all\s+)?(one|two|three|four|five|six|seven|\d+)\b/i);
    });
  });

  it('shows counts only where they are computed from the catalogue', () => {
    // The occasion chips DO show a number, and that is fine because it is
    // countFor() rather than a digit somebody typed.
    expect(GALLERY).toMatch(/\{countFor\(f\.key\)\}/);
  });
});

describe('the gallery survives a catalogue that is not four items long', () => {
  it('never offers a template as its own previous or next', () => {
    /* A modulus wrap over a short list points at the page it is on: with one
       template both neighbours ARE that template. Templates do get retired
       here — two were in 2026-08-16 — so this is a state to survive, not a
       hypothetical. */
    expect(DETAIL).toMatch(/if \(i < 0 \|\| n < 2\) return \{ prev: null, next: null \}/);
    // With exactly two, prev and next resolve to the same entry.
    expect(DETAIL).toMatch(/const prev = n > 2 \?/);
  });

  it('renders a distinct previous and next for the catalogue we have', () => {
    // Sanity on the real list: four items, so every page gets two different
    // neighbours and neither is itself.
    expect(COLLECTION.length).toBeGreaterThan(2);
  });

  it('does not put the reply form on a marketing page', () => {
    /* Completing an RSVP produces a confirmation and a QR entry pass with a
       name on it. The demo has a whole chrome framing that as a demo; this
       page has none, so it must not pass `simulate`. GuestExperiencePreview
       renders readOnly whenever simulate is absent. */
    // Stripped, because the header comment explains at length why simulate is
    // absent — see the styled-jsx case above for the same trap.
    expect(stripComments(LIVE)).not.toMatch(/\bsimulate\b/);
    expect(LIVE, 'the live view should hand the reply to the demo instead')
      .toMatch(/\/demo\/invitation\?t=/);
  });

  it('remounts the live view when the prev/next rail changes template', () => {
    /* Those two links move between /collection/swans and /collection/ring —
       the SAME dynamic route — so React reconciles to the same component
       instance and `event`, being lazy initial state, is never rebuilt. Page
       two would render page one's invitation. */
    expect(DETAIL).toMatch(/key=\{item\.key\}\s*\n\s*templateKey=\{item\.key\}/);
  });

  it('waits for a gesture before mounting the heaviest tree in the product', () => {
    // The still is the poster and the poster is the film's first frame, so
    // the page paints a JPEG rather than hydrating an iframe and a video.
    expect(LIVE).toMatch(/useState\(false\)/);
    expect(LIVE).toMatch(/onClick=\{\(\) => setLive\(true\)\}/);
  });
});

describe('it obeys the house rules the landing page learned the hard way', () => {
  const FILES = {
    'collectionCatalogue.js': CATALOGUE,
    'CollectionGallery.js': GALLERY,
    'collection/page.js': INDEX,
    'collection/[key]/page.js': DETAIL,
    'LiveInvitation.js': LIVE,
  };

  it('never aims a styled-jsx scoped rule at a next/link', () => {
    /* COMMENTS STRIPPED FIRST, and that is not incidental — this case failed
       on its first run against the very files it guards, because four of them
       carry a comment explaining why they use a plain style element and NOT
       styled-jsx. Matching raw source reports the explanation as the offence.
       scripts/deadLandingCode.js carries the same helper for the same reason
       (a "dead" export that was only mentioned in a comment), and AGENTS.md
       records it as the rule for every checker here. */
    Object.entries(FILES).forEach(([name, src]) => {
      expect(stripComments(src), `${name} uses styled-jsx, whose hash never reaches a next/link`)
        .not.toMatch(/<style\s+jsx/);
    });
  });

  it('has no backtick inside a CSS comment', () => {
    // One ends the template literal: a parse error, not a style bug. It has
    // cost this repo four build failures, and one of these five files.
    Object.entries(FILES).forEach(([name, src]) => {
      const blocks = [...src.matchAll(/<style>\{`([\s\S]*?)`\}<\/style>/g)].map((m) => m[1]);
      blocks.forEach((css) => {
        [...css.matchAll(/\/\*([\s\S]*?)\*\//g)].forEach(([, body]) => {
          expect(body.includes('`'), `${name} has a backtick in a CSS comment`).toBe(false);
        });
      });
    });
  });

  it('uses only the four breakpoints on the scale', () => {
    Object.entries(FILES).forEach(([name, src]) => {
      [...src.matchAll(/\((?:max|min)-width:\s*([0-9.]+)px\)/g)].forEach(([, px]) => {
        expect(['639.98', '640', '767.98', '768', '1023.98', '1024', '1279.98', '1280', '44'],
          `${name} introduced a fifth breakpoint at ${px}px`).toContain(px);
      });
    });
  });

  it('keeps the gallery grid intrinsically responsive', () => {
    // A fixed-column grid cannot fit a 320px phone at all — see AGENTS.md on
    // min-content width. .fx-grid walks its own column count down.
    expect(GALLERY).toMatch(/className="col-plates fx-grid"/);
    /* Stripped: AGENTS.md records that five of the old grep's "fixed grids"
       were the text repeat(3, 1fr) inside a comment saying the grid had been
       removed. */
    expect(stripComments(GALLERY)).not.toMatch(/repeat\(\d+,\s*1fr\)/);
  });

  it('honours prefers-reduced-motion everywhere it animates', () => {
    Object.entries(FILES).forEach(([name, src]) => {
      if (!/transition:/.test(src)) return;
      expect(src, `${name} animates without a reduced-motion branch`)
        .toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    });
  });

  it('keeps the pages that need no state as Server Components', () => {
    expect(INDEX).not.toMatch(/^'use client'/m);
    expect(DETAIL).not.toMatch(/^'use client'/m);
    // Only the two that genuinely hold state are client components.
    expect(GALLERY).toMatch(/^'use client'/m);
    expect(LIVE).toMatch(/^'use client'/m);
  });

  it('preloads the template assets from a render pass, not an effect', () => {
    /* react-dom preload only emits a link tag if it happens during render.
       In an effect it is far too late and the still flashes. */
    expect(DETAIL).toMatch(/preloadCinematicAssets\(item\.key\)/);
    expect(DETAIL).not.toMatch(/useEffect/);
  });

  it('rebuilds the demo event when ?t= changes, not just the chrome round it', () => {
    /* THE BUG THIS PINS, and it survived a first review. `useState(() => …)`
       runs its initializer ONCE for the life of the component, and this
       component stays mounted across a client-side navigation between two
       collection plates. So ?t= changed, the caption changed, and the
       invitation in the frame did not.

       A key on DemoPhone does not fix it either — a key remounts the CHILD,
       and the event is state in the PARENT. The memo is the fix; the key is
       what additionally makes the cover play again. Both are needed and they
       do different jobs. */
    expect(DEMO_STAGE, 'the event is lazy state again — it will not follow ?t=')
      .not.toMatch(/const \[event\] = useState/);
    expect(DEMO_STAGE).toMatch(/const event = useMemo\(/);
    expect(DEMO_STAGE).toMatch(/\}\), \[templateType, chosen\]\)/);
    expect(DEMO_STAGE, 'the cover will not replay between templates')
      .toMatch(/key=\{templateType\}/);
  });

  it('words the customize stage for the occasion its template is locked to', () => {
    /* Stage 3 offers Velvet Ring in a picker beside the phone. Ring is locked
       to engagement and every renderer clamps to it, so without an occasion
       the fixture printed an engagement kicker over "we are getting married"
       — on the one screen built to prove the settings are real. */
    const customize = read('src/app/demo/customize/page.js');
    expect(customize).toMatch(/occasion: occasionPolicyFor\(templateType\)\.occasion/);
  });

  it('keeps the demo stage static despite reading a query parameter', () => {
    // useSearchParams opts its whole subtree out of static rendering unless
    // it sits under a Suspense boundary. This is the most-linked page in the
    // funnel; it must not become per-request.
    expect(DEMO_STAGE).toMatch(/<Suspense fallback=\{null\}>/);
  });
});
