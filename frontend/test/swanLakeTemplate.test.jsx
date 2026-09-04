import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/* Same reason cinematicTemplates.test.jsx mocks it: framer-motion caches its
   matchMedia result in module scope on the first call, so overriding
   window.matchMedia inside a test never reaches it. */
let reducedMotion = false;
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useReducedMotion: () => reducedMotion };
});

import WaxEnvelopeOpening from '../src/app/components/guest/openings/WaxEnvelopeOpening';
import SwanLakeHero from '../src/app/components/templates/cinematic/SwanLakeHero';
import {
  CINEMATIC_TEMPLATES,
  CINEMATIC_KEYS,
  getCinematicOccasion,
  getCinematicCopy,
} from '../src/app/components/templates/cinematic/cinematicThemes';
import { OPENING_TIMINGS } from '../src/app/components/guest/openings/openingSafety';
import { getTemplateOpening } from '../src/app/utils/templateOpening';
import { buildInvitationCardData } from '../src/app/utils/invitationCardData';
import { buildPalette } from '../src/app/components/templates/heritageArch/theme';
import { TEMPLATES } from '../src/app/utils/curatedTemplates';

/* ═══════════════════════════════════════════════════════════════════════════
   SWAN LAKE — the third cinematic template, and the first offered for two
   occasions.

   Contract tests, not appearance tests (jsdom lays out nothing and decodes no
   video). What they pin down is behaviour with no visual tell until it fails
   in front of a guest, plus the two things that are genuinely new here:

     • the guest always gets through the opening, whatever the video does
     • a dual-occasion template says the right thing on BOTH occasions, in
       every place that reads the occasion
     • the four dispatch maps resolve every registered template, so a fifth
       one cannot silently render somebody else's cover

   Appearance is covered by the screenshot pass.
   ═══════════════════════════════════════════════════════════════════════════ */

const SWANS = CINEMATIC_TEMPLATES.swans;
const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function stubMediaElements({ play = () => Promise.resolve() } = {}) {
  window.HTMLMediaElement.prototype.play = vi.fn(play);
  window.HTMLMediaElement.prototype.pause = vi.fn();
  window.HTMLMediaElement.prototype.load = vi.fn();
}

beforeEach(() => {
  reducedMotion = false;
  stubMediaElements();
  // The opening builds an AudioContext at mount to decode its wax-seal sample.
  window.AudioContext = vi.fn(() => ({
    state: 'running',
    currentTime: 0,
    sampleRate: 44100,
    resume: () => Promise.resolve(),
    close: () => {},
    createOscillator: () => ({ type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, value: 0 }, connect: () => ({ connect: () => {} }), start() {}, stop() {} }),
    createGain: () => ({ gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({ connect: () => {} }) }),
    createBiquadFilter: () => ({ type: '', frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, Q: { value: 0 }, connect: () => ({ connect: () => {} }) }),
    createBufferSource: () => ({ buffer: null, playbackRate: { value: 1 }, connect: () => ({ connect: () => {} }), start() {} }),
    createBuffer: (_c, len) => ({ getChannelData: () => new Float32Array(len) }),
    decodeAudioData: () => Promise.reject(new Error('no decoder in jsdom')),
    destination: {},
  }));
});

afterEach(() => { vi.useRealTimers(); });

/* ════════════════════════════════════════════════════════════════════
   1. The guest always gets in
   ════════════════════════════════════════════════════════════════════ */
describe('wax envelope opening — the guest always gets through', () => {
  it('a video that never produces a frame still opens the invitation', async () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();

    render(<WaxEnvelopeOpening template={SWANS} names="Adam & Mira" onComplete={onComplete} />);

    // Armed by the 7s hard arm even though jsdom fires no canplay — the rung
    // that stops a tap being ignored forever.
    await act(async () => { vi.advanceTimersByTime(OPENING_TIMINGS.readyHardArmMs + 10); });
    fireEvent.click(screen.getByTestId('cine-opening-tap'));

    // Nothing ever plays. The 6s never-started rung takes the stills path,
    // which finishes on its own.
    await act(async () => { vi.advanceTimersByTime(20000); });

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('calls onComplete exactly once even when several rungs fire', async () => {
    // finish() is latched. The stills timeline and the ceiling can both land;
    // arriving at the invitation twice is not a recoverable state.
    vi.useFakeTimers();
    const onComplete = vi.fn();

    render(<WaxEnvelopeOpening template={SWANS} names="Adam & Mira" onComplete={onComplete} />);
    await act(async () => { vi.advanceTimersByTime(OPENING_TIMINGS.readyHardArmMs + 10); });
    fireEvent.click(screen.getByTestId('cine-opening-tap'));
    await act(async () => { vi.advanceTimersByTime(60000); });

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('reduced motion skips straight to the revealed card', async () => {
    reducedMotion = true;
    vi.useFakeTimers();
    const onComplete = vi.fn();

    render(<WaxEnvelopeOpening template={SWANS} names="Adam & Mira" onComplete={onComplete} />);
    // No readiness wait: with reduced motion there is no video to be ready.
    fireEvent.click(screen.getByTestId('cine-opening-tap'));
    await act(async () => { vi.advanceTimersByTime(4000); });

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('a tap before the video is ready is ignored, not queued', async () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();

    render(<WaxEnvelopeOpening template={SWANS} names="Adam & Mira" onComplete={onComplete} />);
    // Still loading — the hint says so and the tap must do nothing rather than
    // start a sequence with nothing to show.
    fireEvent.click(screen.getByTestId('cine-opening-tap'));
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByTestId('cine-opening-hint').textContent).toBe(SWANS.copy.en.loading);
  });

  it('reduced motion invites the tap instead of saying "Loading…" forever', () => {
    /* `useMediaReadiness` takes `enabled: !reduceMotion`, and disabled used to
       leave `ready` false permanently — while `open()` skips the readiness
       check on the reduced-motion path. So this cover was tappable the whole
       time and told the guest it was still loading, on both video templates.
       See the twin of this test in cinematicTemplates.test.jsx. */
    reducedMotion = true;
    render(<WaxEnvelopeOpening template={SWANS} names="Adam & Mira" onComplete={vi.fn()} />);
    expect(screen.getByTestId('cine-opening-hint').textContent).toBe(SWANS.copy.en.hint);
  });

  it('starts music inside the tap, not after it', async () => {
    /* iOS grants audio to the gesture's own call stack. If onGesture were
       called from a timer or a promise callback the invitation would open
       silently on the devices that matter most. */
    vi.useFakeTimers();
    const onGesture = vi.fn();

    render(<WaxEnvelopeOpening template={SWANS} names="Adam & Mira" onComplete={() => {}} onGesture={onGesture} />);
    await act(async () => { vi.advanceTimersByTime(OPENING_TIMINGS.readyHardArmMs + 10); });

    fireEvent.click(screen.getByTestId('cine-opening-tap'));
    // Synchronously, with no timers advanced.
    expect(onGesture).toHaveBeenCalledTimes(1);
  });

  it('a guest who has already seen it this session is let straight through', async () => {
    window.sessionStorage.setItem('cine-opening:evt-1', '1');
    const onComplete = vi.fn();
    render(<WaxEnvelopeOpening template={SWANS} names="Adam & Mira" sessionKey="evt-1" onComplete={onComplete} />);
    await act(async () => {});
    expect(onComplete).toHaveBeenCalledTimes(1);
    window.sessionStorage.clear();
  });
});

/* ════════════════════════════════════════════════════════════════════
   2. The cover says whatever the organizer's occasion is
   (Occasion behaviour across ALL templates lives in
   test/templateOccasions.test.jsx; this covers the wax envelope itself.)
   ════════════════════════════════════════════════════════════════════ */
describe('the wax envelope names the occasion it was given', () => {
  it('prints the occasion, not the template', () => {
    const { unmount } = render(
      <WaxEnvelopeOpening template={SWANS} names="Adam & Mira" occasion="engagement" onComplete={() => {}} />,
    );
    expect(screen.getByText('Engagement Invitation')).toBeTruthy();
    unmount();

    const second = render(
      <WaxEnvelopeOpening template={SWANS} names="Adam & Mira" occasion="birthday" onComplete={() => {}} />,
    );
    expect(screen.getByText('Birthday Invitation')).toBeTruthy();
    second.unmount();

    render(<WaxEnvelopeOpening template={SWANS} names="Adam & Mira" occasion="wedding" onComplete={() => {}} />);
    expect(screen.getByText('Wedding Invitation')).toBeTruthy();
  });

  it('keeps its own hint whatever the occasion', () => {
    // The tap hint describes breaking THIS seal; it is not occasion copy and
    // must not be swapped out with the kicker.
    ['wedding', 'engagement', 'babyShower', 'memorial'].forEach((occasion) => {
      expect(getCinematicCopy(SWANS, { occasion }).hint).toBe(SWANS.copy.en.hint);
    });
  });
});

/* ════════════════════════════════════════════════════════════════════
   3. The dispatch maps resolve every registered template
   ════════════════════════════════════════════════════════════════════ */
describe('no template can silently render another template\'s cover', () => {
  /* Every one of these was `x === 'velvetBox' ? A : B`, which is correct for
     exactly two templates and wrong — silently, with no error anywhere — for
     the third. These assertions are what make a fourth fail loudly. */
  const OPENING_SITES = [
    ['src/app/[slug]/EventPageClient.js', 'CINEMATIC_OPENINGS'],
    ['src/app/components/templates/GuestExperiencePreview.js', 'CINEMATIC_OPENINGS'],
    ['src/app/dashboard/components/EventSettings.js', 'CINEMATIC_OPENINGS'],
  ];

  it.each(OPENING_SITES)('%s maps every opening', (file, mapName) => {
    const map = read(file).match(new RegExp(`const ${mapName} = \\{([\\s\\S]*?)\\n\\};`))?.[1];
    expect(map, `${file} has no ${mapName} map`).toBeTruthy();
    CINEMATIC_KEYS.forEach((key) => {
      const { opening } = CINEMATIC_TEMPLATES[key];
      expect(map, `${key} would mount nothing: "${opening}" is not in ${mapName}`).toContain(`${opening}:`);
    });
  });

  it('HeritageArchPage maps every hero', () => {
    const map = read('src/app/components/templates/heritageArch/HeritageArchPage.js')
      .match(/const CINEMATIC_HEROES = \{([\s\S]*?)\n\};/)?.[1];
    expect(map).toBeTruthy();
    CINEMATIC_KEYS.forEach((key) => {
      const { hero } = CINEMATIC_TEMPLATES[key];
      expect(map, `${key} would render no hero: "${hero}" is not mapped`).toContain(`${hero}:`);
    });
  });

  it('every opening and hero name is distinct across templates', () => {
    // Two templates sharing an opening key would be a copy/paste, not a
    // decision — and the map would quietly give them the same cover.
    const openings = CINEMATIC_KEYS.map((k) => CINEMATIC_TEMPLATES[k].opening);
    const heroes = CINEMATIC_KEYS.map((k) => CINEMATIC_TEMPLATES[k].hero);
    expect(new Set(openings).size).toBe(openings.length);
    expect(new Set(heroes).size).toBe(heroes.length);
  });
});

/* ════════════════════════════════════════════════════════════════════
   4. The template is wired into everything a template needs
   ════════════════════════════════════════════════════════════════════ */
describe('Swan Lake is a first-class template', () => {
  it('ships every asset it names', () => {
    Object.entries(SWANS.assets).forEach(([name, src]) => {
      const file = path.join(ROOT, 'public', src.replace(/^\//, ''));
      expect(fs.existsSync(file), `${name} → ${src} is not in public/`).toBe(true);
    });
  });

  it('names every asset it ships', () => {
    /* The other direction, and the one that actually caught something: the
       port copied an orchid cut-out the source used as a section divider,
       declared it in `assets`, and never rendered it — 151KB sitting in
       public/ that no page ever requested. A file here that nothing points at
       is either dead weight or a wiring bug, and both are worth failing on. */
    const named = new Set(Object.values(SWANS.assets).map((s) => path.basename(s)));
    const orphans = fs.readdirSync(path.join(ROOT, 'public/templates/swans'))
      .filter((f) => !named.has(f));
    expect(orphans, 'shipped but never referenced by the template').toEqual([]);
  });

  it('the picker card shows the cover a guest actually lands on', () => {
    const entry = TEMPLATES.find((t) => t.key === 'swans');
    expect(entry, 'Swan Lake is not in the picker').toBeTruthy();
    expect(entry.preview.src).toBe(SWANS.assets.poster);
    expect(entry.presets.length).toBeGreaterThan(0);
  });

  it('the Design tab names the arrival this template has', () => {
    const opening = getTemplateOpening('swans');
    expect(opening.cinematic).toBe(SWANS);
    // The seal is filmed, so seal_text / reveal_tone reach nothing — offering
    // a monogram field would be the product misinforming the organizer.
    expect(opening.hasSeal).toBe(false);
    expect(opening.previewLabel).toBe('Preview the opening');
  });

  it('reveals before the footage runs out', () => {
    // 6.30s of film. A reveal at or past the end means the guest watches a
    // frozen last frame instead of a cross-fade.
    expect(SWANS.revealAtSeconds).toBeGreaterThan(4);
    expect(SWANS.revealAtSeconds).toBeLessThan(6.3);
  });

  it('sections recolour from its own palette when the event has none', () => {
    const palette = buildPalette({}, 'swans');
    expect(palette.background).toBe(SWANS.colors.background);
    // Ivory ground — this template must resolve LIGHT, like Door of Joy and
    // unlike Velvet Ring, or every section below the hero inverts.
    expect(buildPalette({}, 'swans').ink).toBeTruthy();
    expect(buildPalette({ background: '#123456' }, 'swans').background).toBe('#123456');
  });

  it('the guest slug comes from the couple, like every other couple template', () => {
    // Previously ring/bab/swans all fell to slugHelper's default arm and took
    // their URL from the event title instead of the names.
    const helper = read('../backend/utils/slugHelper.js');
    const weddingArm = helper.match(/case 'wedding':([\s\S]*?)break;/)?.[1] || '';
    ['engagement', 'ring', 'bab', 'swans'].forEach((key) => {
      expect(weddingArm, `${key} does not derive its slug from the partner names`).toContain(`case '${key}':`);
    });
  });
});

/* ════════════════════════════════════════════════════════════════════
   5. The hero blooms with the cover, not behind it
   ════════════════════════════════════════════════════════════════════ */
describe('the engraving blooms into colour at the right moment', () => {
  const heroProps = {
    template: SWANS, names: 'Adam & Mira', isRTL: false,
    invitationPattern: 'serif', invitationTheme: {}, invitationGuestName: 'Guest', invitationData: {},
  };

  it('holds the embossed state while the opening still covers it', () => {
    /* The hero mounts UNDERNEATH the opening, seconds before the guest can
       see it. Blooming on mount spends the whole effect behind a cover. */
    render(<SwanLakeHero {...heroProps} openingActive />);
    expect(screen.getByTestId('cine-hero-swans').className).toContain('is-embossed');
  });

  it('releases when the cover goes', async () => {
    const { rerender } = render(<SwanLakeHero {...heroProps} openingActive />);
    await act(async () => { rerender(<SwanLakeHero {...heroProps} openingActive={false} />); });
    // requestAnimationFrame plus a timer backstop; jsdom runs rAF on a timer.
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(screen.getByTestId('cine-hero-swans').className).not.toContain('is-embossed');
  });

  it('an event with the opening turned off arrives already coloured', () => {
    // There was no envelope to be embossed from, so performing a transition
    // out of a state the guest never saw is just a page that looks broken.
    render(<SwanLakeHero {...heroProps} openingActive={false} />);
    expect(screen.getByTestId('cine-hero-swans').className).not.toContain('is-embossed');
  });

  it('reduced motion gets the finished picture outright', () => {
    reducedMotion = true;
    render(<SwanLakeHero {...heroProps} openingActive />);
    expect(screen.getByTestId('cine-hero-swans').className).not.toContain('is-embossed');
  });

  it('the page passes the cover state down', () => {
    // Without this the prop is always false and the bloom never runs.
    expect(read('src/app/[slug]/EventPageClient.js')).toMatch(/openingActive=\{showReveal\}/);
    expect(read('src/app/components/templates/GuestExperiencePreview.js')).toMatch(/openingActive=\{!openingDone\}/);
  });

  it('the un-embossed state is the default, not a class', () => {
    /* A browser that freezes transitions, or a render that never reaches the
       effect, must show the correct finished hero — never a grey one. */
    const css = read('src/app/styles/cinematic.css');
    expect(css).toMatch(/\.cine-shero\.is-embossed \.cine-shero__scene \{/);
    // And the embossed state must not animate INTO itself on mount.
    const block = css.match(/\.cine-shero\.is-embossed \.cine-shero__scene \{([\s\S]*?)\}/)[1];
    expect(block, 'the hero would drain of colour behind the cover').toContain('transition: none');
  });
});

/* ════════════════════════════════════════════════════════════════════
   6. Nothing from the source page came with it
   ════════════════════════════════════════════════════════════════════ */
describe('the port left the source platform behind', () => {
  it('no analytics or tracking bundle reached public/', () => {
    /* The source folder ships a 566KB Google tag bundle and a 410KB Facebook
       pixel beside the artwork. Copying the directory wholesale is the
       obvious mistake and would put both on every guest's invitation. */
    const dir = path.join(ROOT, 'public/templates/swans');
    const shipped = fs.readdirSync(dir);
    expect(shipped).not.toContain('fbevents.js');
    expect(shipped).not.toContain('js.js');
    shipped.forEach((file) => {
      expect(file, `${file} is not artwork`).toMatch(/\.(jpg|png|mp4|webm|m4a|wav)$/);
    });
  });

  it('the source folder is not committed, and the ignore rule is anchored', () => {
    /* Both halves matter, and the second one broke the deploy.

       A bare `templates/` in .gitignore is NOT "the templates folder at the
       root" — it matches a directory of that name at ANY depth. This repo has
       two more that matter: the entire template component tree
       (frontend/src/app/components/templates/) and every template's artwork
       (frontend/public/templates/). Written unanchored, git silently refused
       to track SwanLakeHero.js and all four swans assets. Already-tracked
       files were unaffected and the tree still built locally, so nothing
       looked wrong until `next build` failed on the server with
       "Can't resolve '../cinematic/SwanLakeHero'". */
    const ignore = read('../.gitignore');
    expect(ignore, 'the source folders are no longer ignored').toMatch(/^\/envelop\/$/m);
    expect(ignore, 'the source folders are no longer ignored').toMatch(/^\/templates\/$/m);
    expect(ignore, 'an unanchored `templates/` also swallows src and public')
      .not.toMatch(/^templates\/$/m);
    expect(ignore).not.toMatch(/^envelop\/$/m);
  });

  it('git actually tracks the files the build imports', () => {
    /* The assertion above reads the rules; this one asks git. A pattern can be
       correct and still be defeated by a second rule elsewhere in the file, and
       the failure mode is invisible locally — the module is on disk, the tests
       pass, and only the deploy notices it was never committed. */
    const needed = [
      'frontend/src/app/components/templates/cinematic/SwanLakeHero.js',
      'frontend/src/app/components/guest/openings/WaxEnvelopeOpening.js',
      ...Object.values(SWANS.assets).map((s) => `frontend/public${s}`),
    ];
    let tracked;
    try {
      tracked = new Set(
        execFileSync('git', ['ls-files', '--', ...needed], { cwd: path.join(ROOT, '..'), encoding: 'utf8' })
          .split('\n').map((s) => s.trim()).filter(Boolean),
      );
    } catch {
      return; // no git here (a tarball, a sandbox) — the rule check above stands
    }
    const missing = needed.filter((f) => !tracked.has(f));
    expect(missing, 'on disk but never committed — the deploy will not have these').toEqual([]);
  });
});
