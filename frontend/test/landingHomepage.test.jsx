import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/',
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }),
}));

import HeroSection from '../src/app/components/landing/HeroSection';
import GuestExperienceSection from '../src/app/components/landing/GuestExperienceSection';
import SeatingSection from '../src/app/components/landing/SeatingSection';
import RemindersSection from '../src/app/components/landing/RemindersSection';
import CheckinSection from '../src/app/components/landing/CheckinSection';
import CapabilitiesSection from '../src/app/components/landing/CapabilitiesSection';
import DashboardShowcaseSection from '../src/app/components/landing/DashboardShowcaseSection';
import FaqCtaSection, { FAQS } from '../src/app/components/landing/FaqCtaSection';
import FooterSection from '../src/app/components/landing/FooterSection';
import ProofSection from '../src/app/components/landing/ProofSection';
import ShopRail from '../src/app/components/landing/ShopRail';
import {
  CAPABILITIES,
  HOMEPAGE_CAPABILITIES,
  REST_CAPABILITIES,
  REMAINING_CAPABILITY_COUNT,
  FLOW_LABEL,
} from '../src/app/components/landing/platformCapabilities';
import { BAND_ORDER, C } from '../src/app/components/landing/landingTokens';

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const LANDING = path.join(ROOT, 'src/app/components/landing');

/**
 * Source with its COMMENTS REMOVED.
 *
 * Every one of these files carries a long header explaining what it replaced
 * and why, and those explanations necessarily name the very things these tests
 * forbid — "ScrollReveal", "nth-child", "<style jsx>". Asserting against raw
 * text made four of these tests fail on their own documentation, which is the
 * worst kind of false positive: it punishes writing down the reason.
 *
 * Handles block comments, JSX `{/* … *\/}` comments (the braces are stripped by
 * the block rule leaving `{}`), and whole-line `//`. Newlines are preserved so
 * reported line numbers still mean something.
 */
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/^[ \t]*\/\/.*$/gm, '');

/** Every `<style …>{` … `}</style>` in a file, scoped or plain, as its CSS.
 *  Module scope: two separate describes need it. */
const styleBlocks = (src) =>
  [...src.matchAll(/<style(?: jsx)?(?: global)?>\{`([\s\S]*?)`\}<\/style>/g)].map((m) => m[1]);

const PAGE = code(read('src/app/page.js'));
const FOOTER_RAW = read('src/app/components/landing/FooterSection.js');
const FOOTER = code(FOOTER_RAW);
const NAVBAR = read('src/app/components/landing/Navbar.js');

/**
 * Does `/foo` resolve to a real page?
 *
 * Not a path join, for two reasons this checker has been taught the hard way:
 *
 * · Next ROUTE GROUPS are directories in parentheses that do not appear in the
 *   URL, so `/register` lives at `(auth)/register/page.js`. Checking
 *   `src/app/register/page.js` reports a real route as broken.
 * · DYNAMIC SEGMENTS are directories in square brackets. `/collection/ring` is
 *   served by `collection/[key]/page.js`, and without this the first homepage
 *   link into the collection gallery was reported dead — a checker crying wolf
 *   over a working link is how a real one gets ignored.
 */
function routeExists(href) {
  const segments = href.replace(/^\//, '').split('/').filter(Boolean);
  const walk = (dir, rest) => {
    if (rest.length === 0) return fs.existsSync(path.join(dir, 'page.js'));
    const [head, ...tail] = rest;
    if (fs.existsSync(path.join(dir, head)) && walk(path.join(dir, head), tail)) return true;
    const entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    // A dynamic segment matches this URL segment; a route group matches none of
    // them and is descended through with `rest` intact.
    return entries.filter((e) => /^\[.+\]$/.test(e.name)).some((d) => walk(path.join(dir, d.name), tail))
      || entries.filter((e) => /^\(.+\)$/.test(e.name)).some((g) => walk(path.join(dir, g.name), rest));
  };
  return walk(path.join(ROOT, 'src/app'), segments);
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE HOMEPAGE DOES NOT DRAW ITS OWN PRODUCT, AND IT SAYS WHAT THE PRODUCT IS.

   Both properties were false. The page carried ~1,900 lines of hand-drawn
   imitations of components that actually ship (a fake dashboard with a fake
   donut and hardcoded seating coordinates; four fake phone screens with a fake
   notch), and it named none of the thirteen real capabilities.

   Neither failure was loud. A drawn dashboard renders perfectly forever, and a
   page that omits your seating feature looks fine — it just quietly sells
   something narrower than what you built. These pin both.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the homepage shows the product, not a drawing of it', () => {
  it('has deleted every hand-drawn mockup section', () => {
    /* Named individually rather than by a pattern: each of these was a
       specific, large, invented imitation of a real component, and the point
       is that re-adding one has to be a deliberate act with a name attached. */
    const GONE = [
      'DashboardPreviewSection.js', // 1,029 lines — fake dashboard
      'RSVPFlowSection.js',         // 889 lines — four fake phone screens
      'SocialProofBar.js',          // a whole band for three numbers
      'HeroEnvelope.js',            // a drawn imitation of the real reveal
    ];
    GONE.forEach((f) => {
      expect(fs.existsSync(path.join(LANDING, f)), `${f} is back`).toBe(false);
      expect(PAGE.includes(f.replace('.js', '')) && PAGE.includes(`import ${f.replace('.js', '')}`),
        `page.js imports ${f} again`).toBe(false);
    });
  });

  it('every product image it names is a real file that is actually shipped', () => {
    [DashboardShowcaseSection, HeroSection, GuestExperienceSection,
      SeatingSection, CheckinSection].forEach((Section) => {
      const { container, unmount } = render(<Section />);
      const imgs = [...container.querySelectorAll('img')];
      expect(imgs.length, 'a product section with no product imagery').toBeGreaterThan(0);
      imgs.forEach((img) => {
        const src = img.getAttribute('src');
        expect(fs.existsSync(path.join(ROOT, 'public', src.replace(/^\//, ''))),
          `${src} is not in public/`).toBe(true);
      });
      unmount();
    });
  });

  it('declares dimensions on every image, so nothing shifts as they decode', () => {
    [HeroSection, DashboardShowcaseSection, GuestExperienceSection,
      SeatingSection, CheckinSection].forEach((Section) => {
      const { container, unmount } = render(<Section />);
      [...container.querySelectorAll('img')].forEach((img) => {
        expect(img.getAttribute('width'), 'no width — this will shift the layout').toBeTruthy();
        expect(img.getAttribute('height')).toBeTruthy();
        /* The hero's photograph is the one image on the page with an EMPTY
           alt, and that is correct rather than lax: it is a blurred backdrop
           behind an object, it carries no information the headline beside it
           does not, and a screen reader describing the wallpaper before the
           headline is noise. Every image that is a picture OF something still
           has to describe itself. */
        const alt = img.getAttribute('alt');
        expect(alt, 'no alt attribute at all').not.toBeNull();
        if (alt !== '') {
          expect(alt.length, 'alt text is too thin').toBeGreaterThan(30);
        }
      });
      unmount();
    });
  });

  it('can regenerate the product shots it depends on', () => {
    // If the only way to remake these is to remember how, they go stale the
    // first time the dashboard changes.
    const shots = read('test/shots/landingShots.dump.jsx');
    expect(shots).toContain('SeatingMiniMap');
    expect(shots).toContain('force-device-scale-factor');

    // The four tab frames come from the demo's own screens — see the header
    // of that file for why they are not in landingShots.
    const tabs = read('test/shots/landingTabs.dump.jsx');
    expect(tabs).toContain('DemoDashboardPage');
    expect(tabs).toContain('force-device-scale-factor');

    expect(read('vitest.shots.config.mjs')).toContain("config.test.include = ['test/shots/*.dump.jsx']");
  });

  it('shows the four tab screens it promises, one image per tab', () => {
    /* A strip with four labels and three panels is a dead tab: it renders an
       empty window and looks like a failed download. */
    const { container, unmount } = render(<DashboardShowcaseSection />);
    const tabs = container.querySelectorAll('[role="tab"]');
    const panels = container.querySelectorAll('[role="tabpanel"]');
    expect(tabs.length).toBeGreaterThanOrEqual(3);
    expect(panels.length).toBe(tabs.length);
    expect(container.querySelectorAll('[role="tabpanel"] img').length).toBe(tabs.length);

    // Exactly one panel is visible before hydration, and it is the first.
    const shown = [...panels].filter((p) => !p.hasAttribute('hidden'));
    expect(shown.length, 'more than one tab panel is showing at once').toBe(1);
    expect(shown[0]).toBe(panels[0]);
    unmount();
  });
});

describe('the page explains the platform', () => {
  it('draws eight real capabilities, from the same array /features renders', () => {
    const { container, unmount } = render(<CapabilitiesSection />);
    expect(HOMEPAGE_CAPABILITIES.length).toBe(8);

    /* EIGHT MARKS AND EIGHT NOUNS. Each node carried its capability's one-line
       caption underneath until 2026-09-09 — eighty words inside a diagram,
       which stopped being a diagram and became a table of contents with
       pictures. The name is what a node needs; the caption is on /features,
       which the link under the drawing goes to.

       Checked against FLOW_LABEL falling back to the title, exactly as the
       component resolves it, so a capability added without a short label
       still has to appear. */
    HOMEPAGE_CAPABILITIES.forEach((c) => {
      const shown = FLOW_LABEL[c.key] || c.title;
      expect(container.textContent, `${c.title} is missing from the diagram`)
        .toContain(shown);
    });
    unmount();

    // The /features page must not have re-declared its own copy.
    const features = read('src/app/features/page.js');
    expect(features).toContain('platformCapabilities');
    expect(features, '/features declared its own features array again').not.toMatch(/^const features = \[/m);
  });

  it('names EVERY capability somewhere on the page, not just the diagram eight', () => {
    /* The specific omission the capabilities band was created to fix: a
       visitor could read the entire old front page and not learn that this
       does seating, runs a door, sends SMS, or lays out Arabic.

       The diagram shows the eight that are STEPS in an event. The five that
       are not — SMS campaigns and bilingual invitations among them — are
       printed by name under it rather than hidden behind the link to
       /features, which is what keeps that fix in place after the 2026-09-09
       reshuffle changed which eight are in the diagram. */
    const { container, unmount } = render(<CapabilitiesSection />);
    CAPABILITIES.forEach((c) => {
      const named = HOMEPAGE_CAPABILITIES.includes(c)
        ? container.textContent.includes(FLOW_LABEL[c.key] || c.title)
        : container.textContent.includes(c.title);
      expect(named, `${c.title} appears nowhere in the capabilities band`).toBe(true);
    });
    ['Seating Charts', 'QR Check-In', 'SMS Campaigns', 'Bilingual Invitations']
      .forEach((t) => expect(REST_CAPABILITIES.concat(HOMEPAGE_CAPABILITIES).some((c) => c.title === t),
        `${t} is not in the registry any more`).toBe(true));
    unmount();
  });

  it('counts the remaining capabilities instead of hardcoding a number', () => {
    const src = read('src/app/components/landing/CapabilitiesSection.js');
    expect(src).toContain('REMAINING_CAPABILITY_COUNT');
    expect(REMAINING_CAPABILITY_COUNT).toBe(CAPABILITIES.length - 8);
    // A hardcoded "and 5 more" is wrong the first time anyone adds a feature.
    expect(src, 'the count is written out rather than computed')
      .not.toMatch(/And \d+ more/);
  });

  it('shows the whole job — seat them, remind them, run the door — as screens', () => {
    /* This replaced a three-step "how it works" list. The steps are not gone,
       they are the bands: each one now has a picture of the thing it
       describes and a link into the live demo of it. If a band stops saying
       what it is for, this fails in the same place the list used to. */
    const seating = render(<SeatingSection />);
    expect(screen.getByText(/Seat everyone/)).toBeTruthy();
    expect(seating.container.querySelector('a[href="/demo/dashboard"]')).toBeTruthy();
    seating.unmount();

    const reminders = render(<RemindersSection />);
    expect(screen.getByText(/Remind them before the night begins/)).toBeTruthy();
    reminders.unmount();

    const door = render(<CheckinSection />);
    expect(screen.getByText(/Check-in, made elegant/)).toBeTruthy();
    expect(door.container.querySelector('a[href="/checkin-app"]')).toBeTruthy();
    door.unmount();

    const guest = render(<GuestExperienceSection />);
    expect(guest.container.querySelector('a[href="/demo/invitation"]'),
      'the guest-experience band does not open the demo').toBeTruthy();
    guest.unmount();
  });

  it('quotes the reminder schedule the scheduler actually runs', () => {
    /* The three marks on that band are backend/services/emailScheduler.js. A
       marketing page naming a time the platform does not send at is worse than
       one naming none, because somebody will plan an evening around it. This
       reads the scheduler's own comment block rather than trusting the band.

       The mockup this page was built from drew a PUSH notification and a
       "custom reminders" toggle. Neither exists — hence this test. */
    const scheduler = read('../backend/services/emailScheduler.js');
    ['T-24h', 'T-6h', 'T-2h'].forEach((mark) => {
      expect(scheduler, `${mark} is no longer a mark in the scheduler`).toContain(mark);
    });

    const { container, unmount } = render(<RemindersSection />);
    const text = container.textContent;
    expect(text).toContain('24 hours before');
    expect(text).toContain('6 hours before');
    expect(text).toContain('2 hours before');
    expect(text, 'the band promises a push notification, which this platform does not send')
      .not.toMatch(/push notification/i);
    unmount();
  });

  it('shows the text message with the compliance footer it is actually sent with', () => {
    /* smsDispatch appends COMPLIANCE_FOOTER to every outbound body — a CTIA
       requirement for the toll-free number this platform sends on, charged for
       in every segment estimate. A screenshot of the message with it cropped
       off is a picture of a message we do not send. */
    const dispatch = read('../backend/services/smsDispatch.js');
    expect(dispatch).toMatch(/Reply STOP to opt out, HELP for help/);

    const { container, unmount } = render(<RemindersSection />);
    expect(container.textContent).toContain('Reply STOP to opt out, HELP for help');
    unmount();
  });
});

describe('the page is not longer than it needs to be', () => {
  it('renders twelve bands, in the declared rhythm', () => {
    /* BAND_ORDER is the one place the arrangement is stated. If a section is
       added, removed or moved in page.js without updating it, this fails —
       which is the only way "does this page still alternate?" stays a
       question you answer by reading twelve lines.

       TEN until 2026-09-09. The four feature bands added there took the page
       from arguing about the seating chart, the messages and the door to
       showing them; two bands (how-it-works, statement) were retired to pay
       for them. See the note on BAND_ORDER. */
    const names = BAND_ORDER.map((b) => b.split(':')[0]);
    expect(names.length).toBe(12);

    const EXPECTED_COMPONENT = {
      hero: 'HeroSection',
      invitations: 'TemplatesShowcaseSection',
      experience: 'GuestExperienceSection',
      dashboard: 'DashboardShowcaseSection',
      seating: 'SeatingSection',
      reminders: 'RemindersSection',
      checkin: 'CheckinSection',
      capabilities: 'CapabilitiesSection',
      printed: 'PrintedInvitationsSection',
      proof: 'ProofSection',
      'faq-cta': 'FaqCtaSection',
      footer: 'FooterSection',
    };

    // Every declared band has a component, rendered in that order in page.js.
    const positions = names.map((n) => {
      const comp = EXPECTED_COMPONENT[n];
      expect(comp, `BAND_ORDER names "${n}", which maps to no component`).toBeTruthy();
      const at = PAGE.indexOf(`<${comp} />`);
      expect(at, `page.js does not render <${comp} />`).toBeGreaterThan(-1);
      return at;
    });
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions, 'page.js renders the bands in a different order than BAND_ORDER declares')
      .toEqual(sorted);
  });

  it('never puts two bands of the same background next to each other', () => {
    const tones = BAND_ORDER.map((b) => b.split(':')[1]);
    tones.forEach((tone, i) => {
      if (i === 0) return;
      // The footer sits directly under the FAQ band. Since 2026-08-20 those
      // are two different tones (light → deep) so this exemption is no longer
      // load-bearing, but it stays: the footer is the one band whose tone is
      // chosen to close the page rather than to alternate with its neighbour.
      if (BAND_ORDER[i].startsWith('footer')) return;
      expect(tone === tones[i - 1], `bands ${i - 1} and ${i} are both "${tone}"`).toBe(false);
    });
  });

  it('each band actually paints the tone it declares', () => {
    /* BAND_ORDER was a promise nothing kept. The test above only checks that
       the DECLARATION is internally consistent — that no two adjacent entries
       name the same tone. It never opened a component to see whether the CSS
       agreed, so on 2026-08-20 ProofSection declared "deep" and painted
       "warm" and the whole suite stayed green.

       This reads the background out of each section's own style block and
       compares it to BAND, which is where the three tones are defined. */
    const TONE_HEX = { light: C.paper, warm: C.paper2, deep: C.paper3 };

    const FILE = {
      hero: 'HeroSection',
      invitations: 'TemplatesShowcaseSection',
      experience: 'GuestExperienceSection',
      dashboard: 'DashboardShowcaseSection',
      seating: 'SeatingSection',
      reminders: 'RemindersSection',
      checkin: 'CheckinSection',
      capabilities: 'CapabilitiesSection',
      printed: 'PrintedInvitationsSection',
      proof: 'ProofSection',
      'faq-cta': 'FaqCtaSection',
      footer: 'FooterSection',
    };

    /* ── TWO WAYS A BAND CAN PAINT ITS GROUND, SINCE 2026-09-09 ──────────
       Six bands now render through FeatureBand, which owns their background:
       they declare `tone="light"` or `tone="warm"` as a PROP and never name a
       paper themselves. Reading those files for `background: C.paper2` finds
       nothing at all, which this test would have reported as a failure on six
       correct components.

       So the tone is resolved the way the band actually resolves it, and
       FeatureBand's own mapping from tone to paper is checked once below —
       which is stricter than before, not looser: previously nothing verified
       that "warm" meant paper2 anywhere. */
    const shell = fs.readFileSync(path.join(LANDING, 'FeatureBand.js'), 'utf8');
    expect(shell, 'FeatureBand no longer maps light -> paper')
      .toMatch(/\.fb--light\s*\{\s*background:\s*\$\{C\.paper\}/);
    expect(shell, 'FeatureBand no longer maps warm -> paper2')
      .toMatch(/\.fb--warm\s*\{\s*background:\s*\$\{C\.paper2\}/);

    BAND_ORDER.forEach((entry) => {
      const [name, tone] = entry.split(':');
      const src = fs.readFileSync(path.join(LANDING, `${FILE[name]}.js`), 'utf8');
      const expected = TONE_HEX[tone];
      expect(expected, `BAND_ORDER names an unknown tone "${tone}"`).toBeTruthy();

      const TOKEN_FOR = { light: 'paper', warm: 'paper2', deep: 'paper3' };

      if (src.includes('<FeatureBand')) {
        const declared = src.match(/tone="(\w+)"/)?.[1];
        expect(
          declared,
          `${FILE[name]} is declared "${tone}" in BAND_ORDER but passes tone="${declared}"`,
        ).toBe(tone);
        return;
      }

      /* The section's own ground is the first `background:` that names one of
         the three tones — either as the literal hex or as the token that
         resolves to it. Inner surfaces (cards, the ink block) name other
         colours and are not matched. */
      const named = [...src.matchAll(/background:\s*(?:\$\{)?C\.(paper3|paper2|paper)\}?/g)]
        .map((m) => m[1]);

      expect(
        named.includes(TOKEN_FOR[tone]),
        `${FILE[name]} is declared "${tone}" (C.${TOKEN_FOR[tone]}) but its `
        + `backgrounds are: ${named.join(', ') || 'none found'}`,
      ).toBe(true);
    });
  });

  it('every band still carries the anchor id its section is known by', () => {
    /* ── THESE OUTLIVED THE THING THAT USED THEM ─────────────────────────
       An in-page index of six anchor chips sat above the invitations heading
       for exactly one review; see the note where PAGE_INDEX used to be in
       landingTokens.js. The chips went because they were more furniture on the
       band the owner pointed at when they said the page was crowded.

       The IDS stay, and are pinned here, for two reasons that have nothing to
       do with that index: /demo and the footer both deep-link into this page,
       and an anchor is a link no route checker can see — routeExists() walks
       the filesystem, so "#seating" is invisible to it and a renamed section
       breaks the link silently. */
    const bands = BAND_ORDER.map((b) => b.split(':')[0]);
    const ANCHORED = {
      invitations: 'TemplatesShowcaseSection',
      experience: 'GuestExperienceSection',
      dashboard: 'DashboardShowcaseSection',
      seating: 'SeatingSection',
      reminders: 'RemindersSection',
      checkin: 'CheckinSection',
      capabilities: 'CapabilitiesSection',
    };

    Object.entries(ANCHORED).forEach(([id, file]) => {
      expect(bands, `"${id}" is anchored but is not a band`).toContain(id);
      const src = read(`src/app/components/landing/${file}.js`);
      expect(src, `${file} no longer carries id="${id}"`).toContain(`id="${id}"`);
    });
  });

  it('does not wrap the page in scroll-reveal wrappers', () => {
    /* ScrollReveal server-rendered everything below the fold at opacity:0 and
       needed an IntersectionObserver to bring it back — a slow or failed
       hydration left the page blank under the hero — and it had no
       prefers-reduced-motion branch. */
    expect(PAGE).not.toContain('ScrollReveal');
    expect(fs.existsSync(path.join(LANDING, 'ScrollReveal.js'))).toBe(false);
  });

  it('keeps the primary nav short enough to read as navigation', () => {
    /* The bar once carried ELEVEN targets — nine links plus Log In and a gold
       Get Started — which is not a navigation bar, it is a list, and all nine
       had to fit beside the logo before the mobile menu takes over.
       Seven for a while: Home and Contact Us were both added back on
       2026-08-21 at the owner's direction. The ceiling exists to catch drift,
       not to overrule a decision, so it moves with the decision and stays
       tight enough to keep catching one.

       EIGHT NOW, for Collection. /collection is a page that did not exist
       until the gallery shipped — the four invitations had no home, and the
       homepage band that showed them pointed its own call to action at
       /register because there was nowhere else to send anybody. A product's
       showcase is not a page you reach only by scrolling the front page to
       the right band, so it is in the bar.

       Eight is the ceiling, not a target. The next addition should replace
       something rather than raise this again. */
    const block = NAVBAR.slice(NAVBAR.indexOf('const NAV_LINKS'), NAVBAR.indexOf('export default function Navbar'));
    // SHOP_LABEL is a constant, not a quoted literal, so it is counted here.
    const items = [...block.matchAll(/href:\s*(?:"|SHOP_PATH)/g)];
    expect(items.length, 'the nav is growing back toward a list').toBeLessThanOrEqual(8);
  });

  it('offers the way home from the menu, not only from the logo', () => {
    const block = NAVBAR.slice(NAVBAR.indexOf('const NAV_LINKS'), NAVBAR.indexOf('export default function Navbar'));
    expect(block).toMatch(/label:\s*"Home",\s*href:\s*"\/"/);
  });

  it('offers a way to reach a person from the menu, and does not offer the blog', () => {
    /* 2026-08-21, at the owner's direction. Blog is still in the footer's
       Company column; Contact was only in the footer and the FAQ band, which
       means somebody who wants to talk to a human had to first scroll to the
       bottom or find the right band. */
    const block = NAVBAR.slice(NAVBAR.indexOf('const NAV_LINKS'), NAVBAR.indexOf('export default function Navbar'));
    expect(block).toMatch(/href:\s*"\/contact"/);
    expect(block).not.toMatch(/href:\s*"\/blog"/);
    expect(FOOTER, 'the blog is now unreachable from the chrome entirely').toMatch(/'\/blog'/);
  });

  it('sets the menu in the interface face, not the display serif', () => {
    /* The phone menu's links were var(--font-cormorant) at 24px while the
       desktop bar above them and "Log In" directly below them were both
       var(--font-sans). One menu, two typographic systems, three lines apart. */
    const menu = NAVBAR.slice(NAVBAR.indexOf('{NAV_LINKS.map', NAVBAR.indexOf('mobileMenuOpen')));
    const firstLink = menu.slice(0, menu.indexOf('</Link>'));
    expect(firstLink).toMatch(/fontFamily:\s*"var\(--font-sans\)"/);
    expect(firstLink).not.toMatch(/font-cormorant/);
  });
});

describe('the footer', () => {
  it('gives the newsletter its own row instead of a sixth grid column', () => {
    /* Six tracks in a 1200px container left the newsletter's input and its
       Subscribe button sharing ~170px. */
    expect(FOOTER).toContain('.foot-top');
    expect(FOOTER, 'the six-column grid is back').not.toMatch(/minmax\(0, 1\.4fr\)/);
  });

  it('never targets a link list by DOM position', () => {
    /* The old rules were `footer > div:nth-child(2) > div:first-child`, so
       inserting anything into the footer silently stopped the mobile collapse
       from applying — six fixed columns on a 320px phone, failing only on
       mobile and only after an unrelated edit. */
    styleBlocks(FOOTER_RAW).forEach((css, i) => {
      expect(css.includes('nth-child'), `nth-child is back in footer style block ${i}`).toBe(false);
    });
  });

  it('colours its links inline, not through a scoped rule on a next/link', () => {
    /* A scoped className on a Link failed to attach in the production
       Turbopack build and left every footer link invisible against the
       near-black background. */
    const linkFn = FOOTER.slice(FOOTER.indexOf('function FooterLink'), FOOTER.indexOf('function SocialIcon'));
    expect(linkFn).toContain('color: active ?');
    expect(linkFn, 'FooterLink is using a className again').not.toMatch(/className=/);
  });

  it('offers a way to actually reach a human', () => {
    const { container } = render(<FooterSection />);
    const mailto = [...container.querySelectorAll('a')]
      .map((a) => a.getAttribute('href'))
      .filter((h) => h && h.startsWith('mailto:'));
    expect(mailto.length, 'the footer has no email address on it').toBeGreaterThan(0);
    expect(mailto[0]).toContain('info@fancyrsvp.com');
  });

  it('does not shrink its input below the size that zooms iOS Safari', () => {
    /* Anything under 16px makes iOS zoom the page on focus and leave it
       zoomed. It was 13px here. */
    const news = FOOTER_RAW.slice(FOOTER_RAW.indexOf('function Newsletter'), FOOTER_RAW.indexOf('export default function FooterSection'));
    const size = news.match(/fontSize:\s*'(\d+)px'/);
    expect(size, 'the newsletter input has no explicit font size').toBeTruthy();
    expect(Number(size[1])).toBeGreaterThanOrEqual(16);
  });
});

describe('nothing links into a hole', () => {
  it('every internal href on the page resolves to a real page.js', () => {
    const sections = [HeroSection, GuestExperienceSection, CapabilitiesSection,
      DashboardShowcaseSection, SeatingSection, RemindersSection, CheckinSection,
      FaqCtaSection, FooterSection];
    sections.forEach((Section) => {
      const { container, unmount } = render(<Section />);
      [...container.querySelectorAll('a')]
        .map((a) => a.getAttribute('href'))
        .filter((h) => h && h.startsWith('/'))
        /* Drop the QUERY and the FRAGMENT before resolving. Both are part of
           a URL that the filesystem knows nothing about: "/#invitations" is
           this page plus an anchor, and "/contact?subject=refund" is
           /contact with the form pre-filled. Asking for a route literally
           named "contact?subject=refund" fails a link that works perfectly.

           The query half was missing until 2026-08-22 and this case caught
           the first homepage link to use one, which is the checker working —
           but a checker that rejects a valid URL shape trains people to
           ignore it, so it learns the shape rather than the link being
           changed to suit it. A bare "#foo" or "?foo" is already excluded by
           the startsWith('/') filter above. */
        .map((h) => h.split(/[?#]/)[0] || '/')
        .forEach((h) => expect(routeExists(h), `${h} resolves to no page.js`).toBe(true));
      unmount();
    });
  });
});

describe('the FAQ and its structured data cannot disagree', () => {
  it('builds the FAQPage JSON-LD from the array the accordion renders', () => {
    expect(PAGE).toContain('FAQS.map');
    expect(PAGE).toContain("'@type': 'FAQPage'");
    render(<FaqCtaSection />);
    FAQS.forEach((f) => expect(screen.getByText(f.q), `${f.q} is not rendered`).toBeTruthy());
  });

  it('uses native disclosure rather than hand-rolled aria state', () => {
    const { container } = render(<FaqCtaSection />);
    const details = container.querySelectorAll('details');
    expect(details.length).toBe(FAQS.length);
    expect(container.querySelectorAll('details > summary').length).toBe(FAQS.length);
  });

  it('never imports a VALUE into page.js from a client module', () => {
    /* THE BUG THIS EXISTS FOR, and it is invisible to every other check here.
     *
     * FAQS was originally exported from FaqCtaSection.js, which is
     * `'use client'`, and page.js — a Server Component — imported it to build
     * the JSON-LD. That renders in development, passes every test in this
     * file, and then fails the PRODUCTION BUILD:
     *
     *     TypeError: I.FAQS.map is not a function
     *     Failed to collect page data for /
     *
     * A Server Component importing across a client boundary receives client
     * REFERENCES, not values. Only `next build` models that, which is why the
     * homepage has to keep its shared data in modules that carry no
     * 'use client' — here, faqContent.js.
     */
    const importLines = [...PAGE.matchAll(/import\s+\{([^}]+)\}\s+from\s+"([^"]+)"/g)];
    expect(importLines.length, 'page.js stopped using named imports').toBeGreaterThan(0);

    importLines.forEach(([, names, spec]) => {
      if (!spec.startsWith('./components/landing/')) return;
      const file = path.join(ROOT, 'src/app', `${spec.replace(/^\.\//, '')}.js`);
      if (!fs.existsSync(file)) return;
      const head = read(path.relative(ROOT, file)).trimStart();
      const isClient = head.startsWith("'use client'") || head.startsWith('"use client"');
      expect(isClient,
        `page.js imports { ${names.trim()} } from ${spec}, which is a Client Component. `
        + 'On the server those are client references, not values — this fails `next build`.')
        .toBe(false);
    });
  });

  it('points the refund answer at the request, and says how to make one', () => {
    /* The link was /terms until 2026-08-22. Someone reading this answer has
       already decided they want a refund, so a legal document is the wrong
       next step — the form is. /pricing still links the terms, because its
       reader is deciding whether to buy rather than asking for money back.
       Pinned across both surfaces in test/refundPolicy.test.js. */
    const refund = FAQS.find((f) => /refund/i.test(f.q));
    expect(refund, 'the refund question is gone').toBeTruthy();
    expect(refund.link?.href).toBe('/contact?subject=refund');
    expect(refund.a, 'the answer states a rule but no route').toMatch(/refund request/i);
  });
});

describe('the shop band', () => {
  const SHOP_BAND = read('src/app/components/landing/PrintedInvitationsSection.js');
  const RAIL = read('src/app/components/landing/ShopRail.js');

  it('sits after the software explanation, and before the closing ask', () => {
    /* ── THIS BAND HAS MOVED TWICE, AND BOTH MOVES WERE DELIBERATE ────────
       Seventh → THIRD on 2026-08-21, at the owner's direction: the
       highest-value order on the page was sitting behind four bands of
       feature copy.

       Third → NINTH on 2026-09-09. What sat below it then was four bands of
       prose; what sits below it now is four bands that SHOW the seating chart,
       the messages and the door, in the order an event happens. A catalogue of
       paper cards in the middle of that broke the sentence — and a reader who
       has just watched the whole product work is a better prospect for a
       printed order than one who has seen three photographs.

       What this test protects is unchanged: it must never be last-but-one
       before the footer, where nobody scrolls, and it must never be so early
       that it interrupts the argument. Between the capabilities diagram and
       the closing ask is both. */
    const names = BAND_ORDER.map((b) => b.split(':')[0]);
    expect(names.indexOf('printed')).toBe(names.indexOf('capabilities') + 1);
    expect(names.indexOf('printed')).toBeLessThan(names.indexOf('faq-cta'));
  });

  it('links each piece at a URL that exists', () => {
    /* A piece lives at /shop/<category>/<slug>. This band built /shop/<slug>
       — one segment — which the router hands to the category route, where an
       unknown category slug is a 404. Every card in the teaser was dead, the
       same defect the product page's related links carried. */
    expect(code(SHOP_BAND)).not.toMatch(/\$\{SHOP_PATH\}\/\$\{p\.slug\}/);
    expect(code(SHOP_BAND)).toMatch(/productPath\(/);
  });

  it('shows more than a shelf-end of a catalogue that sells six categories', () => {
    expect(code(SHOP_BAND)).toMatch(/\.slice\(0,\s*12\)/);
  });

  it('keeps the fetch on the server and ships only the arrows', () => {
    // The band must stay an async Server Component: a client fetch here
    // flashes an empty band, and an unpublished piece could reach the page.
    expect(SHOP_BAND).not.toMatch(/^'use client'/m);
    expect(SHOP_BAND).toMatch(/export default async function/);
    expect(RAIL).toMatch(/^'use client'/m);
  });

  /* THE ARROWS ARE THE ONE THING A SCREENSHOT CANNOT CHECK.
     The page probe stages static HTML with no React runtime, so an effect that
     measures the rail never runs there and the arrows never appear in a shot.
     jsdom does no layout either — scrollWidth and clientWidth are both 0 — so
     the measurement is fed here explicitly, which is also the only way to
     assert the "nothing to scroll, no controls" case at all. */
  const ITEMS = (n) => Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, title: `Piece ${i}`, price: '$1.85 card', cover: null, badge: null,
    href: `/shop/wedding-cards/piece-${i}`,
  }));

  const railWith = ({ scrollWidth, clientWidth }) => {
    const { container } = render(<ShopRail items={ITEMS(6)} />);
    const rail = container.querySelector('.pis-rail');
    Object.defineProperty(rail, 'scrollWidth', { value: scrollWidth, configurable: true });
    Object.defineProperty(rail, 'clientWidth', { value: clientWidth, configurable: true });
    // act(): the listener calls setState, and without a flush the assertion
    // reads the tree from before the measurement landed.
    act(() => { rail.dispatchEvent(new Event('scroll')); });
    return container;
  };

  it('shows no controls when there is nothing to scroll', () => {
    const container = railWith({ scrollWidth: 600, clientWidth: 600 });
    expect(container.querySelectorAll('.pis-arrow').length).toBe(0);
  });

  it('offers a way forward once the rail overflows, and no way back at the start', () => {
    const container = railWith({ scrollWidth: 2400, clientWidth: 800 });
    const arrows = container.querySelectorAll('.pis-arrow');
    expect(arrows.length).toBe(2);
    // scrollLeft is 0, so "previous" is present for layout but cannot act.
    expect(arrows[0].disabled).toBe(true);
    expect(arrows[1].disabled).toBe(false);
  });

  it('actually scrolls the rail when an arrow is clicked', () => {
    /* The arrows are the one part of this band no screenshot can check — the
       page probe stages static HTML with no React runtime — so the wiring is
       asserted here instead of assumed. jsdom implements no scrolling at all:
       Element.scrollBy does not exist, so a handler that calls it would throw
       "not a function" in this test and silently do nothing in a browser that
       had the same gap. Stubbed, then asserted on. */
    const { container } = render(<ShopRail items={ITEMS(6)} />);
    const rail = container.querySelector('.pis-rail');
    Object.defineProperty(rail, 'scrollWidth', { value: 2400, configurable: true });
    Object.defineProperty(rail, 'clientWidth', { value: 800, configurable: true });
    const scrollBy = vi.fn();
    rail.scrollBy = scrollBy;
    act(() => { rail.dispatchEvent(new Event('scroll')); });

    const next = container.querySelectorAll('.pis-arrow')[1];
    act(() => { next.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(scrollBy, 'the forward arrow does nothing').toHaveBeenCalledTimes(1);
    const [arg] = scrollBy.mock.calls[0];
    expect(arg.left, 'it scrolls backwards, or not at all').toBeGreaterThan(0);
    expect(arg.left, 'one nudge jumps further than the rail is wide').toBeLessThanOrEqual(800);
  });

  it('renders every piece as a link at its category-scoped URL', () => {
    const { container } = render(<ShopRail items={ITEMS(6)} />);
    const hrefs = [...container.querySelectorAll('.pis-card')].map((a) => a.getAttribute('href'));
    expect(hrefs.length).toBe(6);
    hrefs.forEach((h) => expect(h.split('/').filter(Boolean).length).toBe(3));
  });

  it('puts no CSS inside the client child', () => {
    // A <style jsx> in a nested component does not reliably compile in this
    // build, and a scoped rule would never attach to the next/link cards.
    // Comments stripped: the file's own docstring says where its CSS lives,
    // and naming the thing you forbid must not fail the test that forbids it.
    expect(code(RAIL)).not.toMatch(/<style/);
  });
});

describe('the sections that need real data render nothing without it', () => {
  it('the proof band disappears when there are no reviews and no press', () => {
    /* This is the state of a fresh install — both endpoints return empty
       arrays — so the page has to read correctly with this band absent. */
    const { container } = render(<ProofSection />);
    expect(container.innerHTML).toBe('');
  });
});

describe('the styled-jsx traps this codebase has already paid for', () => {
  const FILES = [
    'HeroSection.js', 'GuestExperienceSection.js', 'CapabilitiesSection.js',
    'DashboardShowcaseSection.js', 'SeatingSection.js', 'RemindersSection.js',
    'CheckinSection.js', 'FaqCtaSection.js', 'FooterSection.js',
    'ProofSection.js',
  ];

  it('has no backtick inside any style block', () => {
    /* One backtick in a CSS comment ends the template literal and the file
       stops parsing — a syntax error, not a style bug. AGENTS.md says to run
       the build rather than grep for it, and the build DID catch it here: two
       of these files shipped one on the first pass. This is the cheap check
       that catches it before the 3-minute build does. */
    FILES.forEach((f) => {
      styleBlocks(read(`src/app/components/landing/${f}`)).forEach((css, i) => {
        expect(css.includes('`'), `a backtick is inside style block ${i} of ${f}`).toBe(false);
      });
    });
  });

  it('never aims a SCOPED styled-jsx rule at a next/link', () => {
    /* styled-jsx stamps its hash only onto lowercase intrinsic elements, so a
       scoped rule for a class sitting on a next/link compiles to
       `.foo.jsx-hash` and matches NOTHING — the failure that once made every
       alert on this platform invisible, and the footer's links along with it.
       Two escapes are legitimate: a `style jsx global` block, or a plain
       `<style>` element (which is also the only option in a Server Component,
       since styled-jsx cannot be imported into one at all). */
    FILES.forEach((f) => {
      const src = read(`src/app/components/landing/${f}`);
      if (!/<Link[^>]*className=/.test(code(src))) return;
      const hasScoped = /<style jsx>\{`/.test(src);
      if (!hasScoped) return; // plain <style> — global by nature, fine.
      expect(/<style jsx global>\{`/.test(src),
        `${f} puts a className on a next/link, uses a scoped block, and has no global one`).toBe(true);
    });
  });

  it('uses only breakpoints on the four-value scale', () => {
    /* AGENTS.md: four values, and a fifth is never introduced. Three crept in
       on the first pass here (479.98, 899.98, 860) and each had a plausible
       local reason — which is exactly why this is a test and not a habit. */
    const ALLOWED = new Set(['639.98', '640', '767.98', '768', '1023.98', '1024', '1279.98', '1280', '44']);
    FILES.concat(['TemplatesShowcaseSection.js']).forEach((f) => {
      const src = read(`src/app/components/landing/${f}`);
      [...src.matchAll(/\((?:max|min)-width: *([\d.]+)px\)/g)]
        .forEach((m) => expect(ALLOWED.has(m[1]), `${f}: ${m[1]}px is off the scale`).toBe(true));
    });
  });

  it('keeps the no-interaction bands as Server Components', () => {
    /* They render markup and nothing else. Marking one "use client" to get
       styled-jsx scoping back would ship JavaScript to draw static type — and
       it is how the first pass of the 2026-08-19 rebuild failed the build
       outright.

       DashboardShowcaseSection is on this list even though its band has a tab
       strip: the strip is a separate client CHILD (DashboardTabs.js), which is
       the arrangement that keeps the heading, the chrome and every rule of CSS
       on the server. Same split as PrintedInvitationsSection and ShopRail. */
    ['GuestExperienceSection.js', 'CapabilitiesSection.js', 'DashboardShowcaseSection.js',
      'SeatingSection.js', 'RemindersSection.js', 'CheckinSection.js']
      .forEach((f) => {
        const src = read(`src/app/components/landing/${f}`);
        expect(src.trimStart().startsWith("'use client'") || src.trimStart().startsWith('"use client"'),
          `${f} became a Client Component`).toBe(false);
        expect(src, `${f} imports styled-jsx, which a Server Component cannot`)
          .not.toMatch(/<style jsx(?: global)?>\{`/);
      });
  });
});
