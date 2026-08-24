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

import SealedLetterOpening from '../src/app/components/guest/openings/SealedLetterOpening';
import LetterPortraitHero from '../src/app/components/templates/cinematic/LetterPortraitHero';
import LetterPortraitFields from '../src/app/components/LetterPortraitFields';
import {
  CINEMATIC_TEMPLATES,
  LETTER_FOCUS,
  LETTER_FOCUS_DEFAULT,
  LETTER_TEXT_POS,
  LETTER_TEXT_POS_DEFAULT,
  LETTER_SCRIM,
  getCinematicCopy,
} from '../src/app/components/templates/cinematic/cinematicThemes';
import { OPENING_TIMINGS } from '../src/app/components/guest/openings/openingSafety';
import { getTemplateOpening } from '../src/app/utils/templateOpening';
import { buildPalette } from '../src/app/components/templates/heritageArch/theme';
import { TEMPLATES } from '../src/app/utils/curatedTemplates';
import { occasionPolicyFor } from '../src/app/utils/eventOccasion';

/* ═══════════════════════════════════════════════════════════════════════════
   SEALED LETTER — the fourth cinematic template, and the first whose hero the
   ORGANIZER fills in.

   Contract tests, not appearance tests (jsdom lays out nothing and decodes no
   image). What they pin down is behaviour with no visual tell until it fails
   in front of a guest, plus the two things genuinely new here:

     • the guest always gets through a cover that is a sprite sheet rather
       than a film, including the ways a sprite can fail that a film cannot
     • the hero is the ORGANIZER'S photograph and nothing else — no shipped
       artwork, no stock couple, and no placeholder when they have not
       uploaded one yet

   The four dispatch maps are asserted from CINEMATIC_KEYS by
   swanLakeTemplate.test.jsx, so this template is covered there with no edit —
   which was the entire point of replacing those ternaries. Appearance is
   covered by the screenshot pass.
   ═══════════════════════════════════════════════════════════════════════════ */

const LETTER = CINEMATIC_TEMPLATES.letter;
const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* Every template_data key this template owns. Listed once, so the guest page,
   the settings hydration and the wizard's pruner are all checked against the
   same set — adding a fifth field and forgetting one of those three is the
   failure this catches. */
const LETTER_FIELD_KEYS = [
  'letter_hero_photo',
  'letter_hero_focus',
  'letter_hero_text_pos',
  'letter_hero_caption',
  'letter_hero_caption_sub',
];

/** Past the readiness hard-arm: jsdom decodes no image, so nothing else arms. */
async function arm() {
  await act(async () => { vi.advanceTimersByTime(OPENING_TIMINGS.readyHardArmMs + 20); });
}

/* jsdom loads no resources, and reports `complete === true` on an Image that
   has a src and has therefore "finished" doing nothing. useImageReadiness
   reads that flag — correctly, because in a real browser it means the sprite
   was already in cache — so under jsdom the cover armed instantly and the
   "still loading" rung could not be tested at all.

   This stub is a sprite that never arrives: complete stays false and neither
   handler ever fires, so only the 7s hard arm can open the gate. That is the
   slow-network case, which is the one worth pinning. */
beforeEach(() => {
  reducedMotion = false;
  window.Image = class {
    constructor() {
      this.complete = false;
      this.onload = null;
      this.onerror = null;
      this._src = '';
    }
    get src() { return this._src; }
    set src(value) { this._src = value; }
  };
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
describe('sealed letter opening — the guest always gets through', () => {
  it('opens even when animationend never fires', async () => {
    /* THE failure this cover has that the video ones do not. CSS animations
       are throttled or suspended in a backgrounded tab, so a guest who taps
       and switches apps can come back to an animation that never ended and an
       event that never fired. jsdom fires no animationend at all, which is
       exactly that case — the duration backstop has to carry it. */
    vi.useFakeTimers();
    const onComplete = vi.fn();

    render(<SealedLetterOpening template={LETTER} names="Noor & Yusuf" onComplete={onComplete} />);
    await arm();
    fireEvent.click(screen.getByTestId('cine-opening-tap'));
    await act(async () => { vi.advanceTimersByTime(20000); });

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('calls onComplete exactly once when animationend AND the backstop land', async () => {
    // finish() is latched. Both rungs end the opening and both can fire;
    // arriving at the invitation twice is not a recoverable state.
    vi.useFakeTimers();
    const onComplete = vi.fn();

    render(<SealedLetterOpening template={LETTER} names="Noor & Yusuf" onComplete={onComplete} />);
    await arm();
    fireEvent.click(screen.getByTestId('cine-opening-tap'));
    // The real event, fired by hand, plus the backstop behind it.
    await act(async () => { fireEvent.animationEnd(screen.getByTestId('cine-letter-anim')); });
    await act(async () => { vi.advanceTimersByTime(60000); });

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('reduced motion skips straight through', async () => {
    reducedMotion = true;
    vi.useFakeTimers();
    const onComplete = vi.fn();

    render(<SealedLetterOpening template={LETTER} names="Noor & Yusuf" onComplete={onComplete} />);
    // No readiness wait: with reduced motion there is no sprite to arm on.
    fireEvent.click(screen.getByTestId('cine-opening-tap'));
    await act(async () => { vi.advanceTimersByTime(4000); });

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('a tap before the sprite has arrived is ignored, not queued', async () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();

    render(<SealedLetterOpening template={LETTER} names="Noor & Yusuf" onComplete={onComplete} />);
    fireEvent.click(screen.getByTestId('cine-opening-tap'));
    await act(async () => { vi.advanceTimersByTime(3000); });

    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByTestId('cine-opening-hint').textContent).toBe(LETTER.copy.en.loading);
  });

  it('arms anyway, so the tap is never withheld forever', async () => {
    /* useImageReadiness's unconditional arm. A cover whose tap does nothing is
       indistinguishable from a broken page, so the gate exists to let the UI
       say "loading" — not to refuse the guest. */
    vi.useFakeTimers();
    render(<SealedLetterOpening template={LETTER} names="Noor & Yusuf" onComplete={() => {}} />);
    await arm();
    expect(screen.getByTestId('cine-opening-hint').textContent).toBe(LETTER.copy.en.hint);
  });

  it('starts music inside the tap, not after it', async () => {
    /* iOS grants audio to the gesture's own call stack. Called from a timer or
       a promise callback the invitation would open silently on exactly the
       devices that matter most. */
    vi.useFakeTimers();
    const onGesture = vi.fn();

    render(<SealedLetterOpening template={LETTER} names="Noor & Yusuf" onComplete={() => {}} onGesture={onGesture} />);
    await arm();

    fireEvent.click(screen.getByTestId('cine-opening-tap'));
    // Synchronously, with no timers advanced.
    expect(onGesture).toHaveBeenCalledTimes(1);
  });

  it('a guest who has already seen it this session is let straight through', async () => {
    window.sessionStorage.setItem('cine-opening:evt-1', '1');
    const onComplete = vi.fn();
    render(<SealedLetterOpening template={LETTER} names="Noor & Yusuf" sessionKey="evt-1" onComplete={onComplete} />);
    await act(async () => {});
    expect(onComplete).toHaveBeenCalledTimes(1);
    window.sessionStorage.clear();
  });

  it('paints the poster under the sprite, so the cover is never bare paper', async () => {
    vi.useFakeTimers();
    const { container } = render(<SealedLetterOpening template={LETTER} names="Noor & Yusuf" onComplete={() => {}} />);
    const poster = container.querySelector('.cine-letter__poster');
    expect(poster, 'nothing holds the composition while 220KB arrives').toBeTruthy();
    expect(poster.getAttribute('src')).toBe(LETTER.assets.poster);
  });
});

/* ════════════════════════════════════════════════════════════════════
   2. The sprite's arithmetic
   ════════════════════════════════════════════════════════════════════ */
describe('the sprite sheet and the animation agree', () => {
  it('derives the sheet width and the step count from one number', async () => {
    /* N frames laid out horizontally are N x 100% wide and take N-1 steps to
       walk. Two numbers written by hand would drift the moment the sheet is
       re-cut, and the failure is an envelope frozen half-open — not an error.
       Both come from spriteFrames; this asserts the component still does the
       arithmetic rather than hardcoding 17. */
    vi.useFakeTimers();
    const { container } = render(<SealedLetterOpening template={LETTER} names="Noor & Yusuf" onComplete={() => {}} />);
    const anim = container.querySelector('.cine-letter__anim');
    const style = anim.getAttribute('style') || '';

    expect(style).toContain(`--cine-letter-sheet: ${LETTER.spriteFrames * 100}%`);
    expect(style).toContain(`--cine-letter-steps: ${LETTER.spriteFrames - 1}`);
    expect(style).toContain(`--cine-letter-dur: ${LETTER.spriteDurationMs}ms`);
  });

  it('the stylesheet reads those properties rather than its own numbers', () => {
    const css = read('src/app/styles/cinematic.css');
    const rule = css.match(/\.cine-letter\.is-opening \.cine-letter__anim \{([\s\S]*?)\}/)?.[1];
    expect(rule, 'the sprite no longer animates').toBeTruthy();
    expect(rule).toContain('steps(var(--cine-letter-steps))');
    expect(rule).toContain('var(--cine-letter-dur)');
  });

  it('the sheet really holds the number of frames it claims', () => {
    /* Read off the file, not trusted. A re-export at a different frame count
       with the same filename would otherwise sail through every other test
       and produce a cover that stops one frame short. 440x782 per frame, and
       782/440 is the 9:16 the cover is sized to. */
    const file = path.join(ROOT, 'public', LETTER.assets.sprite.replace(/^\//, ''));
    const buf = fs.readFileSync(file);
    const { width, height } = jpegSize(buf);
    expect(width % LETTER.spriteFrames, 'the sheet does not divide into whole frames').toBe(0);
    const frameW = width / LETTER.spriteFrames;
    // 9:16 within a pixel of rounding.
    expect(Math.abs(frameW / height - 9 / 16)).toBeLessThan(0.01);
  });

  it('reveals before the sprite finishes, so the flaps never hang open', () => {
    expect(LETTER.revealAtMs).toBeLessThan(LETTER.spriteDurationMs);
    expect(LETTER.revealAtMs).toBeGreaterThan(LETTER.spriteDurationMs * 0.6);
  });
});

/** Minimal JPEG SOF reader — enough to get the dimensions with no dependency. */
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    // SOF0..SOF15, skipping the four that are not frame headers.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  throw new Error('not a JPEG');
}

/* ════════════════════════════════════════════════════════════════════
   3. The cover names the occasion, not the template
   ════════════════════════════════════════════════════════════════════ */
describe('the sealed letter names the occasion it was given', () => {
  it('prints the occasion', () => {
    const { unmount } = render(
      <SealedLetterOpening template={LETTER} names="Noor & Yusuf" occasion="wedding" onComplete={() => {}} />,
    );
    expect(screen.getByText('Wedding Invitation')).toBeTruthy();
    unmount();

    render(<SealedLetterOpening template={LETTER} names="Noor & Yusuf" occasion="graduation" onComplete={() => {}} />);
    expect(screen.getByText('Graduation Invitation')).toBeTruthy();
  });

  it('keeps its own hint whatever the occasion', () => {
    // The tap hint describes opening THIS letter; it is not occasion copy and
    // must not be swapped out with the kicker.
    ['wedding', 'engagement', 'babyShower', 'memorial'].forEach((occasion) => {
      expect(getCinematicCopy(LETTER, { occasion }).hint).toBe(LETTER.copy.en.hint);
    });
  });

  it('carries no `sub` of its own to shadow an occasion tagline', () => {
    /* Door of Joy's "We have opened the door to our joy" is right for its own
       wedding and wrong for a baby shower behind the same door — the trap that
       whole mechanism exists to close. This template simply does not have one,
       so every occasion speaks in the catalogue's voice. */
    expect(LETTER.copy.en.sub).toBeUndefined();
    expect(LETTER.copy.ar.sub).toBeUndefined();
  });
});

/* ════════════════════════════════════════════════════════════════════
   4. The hero is the organizer's photograph and nothing else
   ════════════════════════════════════════════════════════════════════ */
describe('the organizer\'s photograph is the hero', () => {
  const heroProps = {
    template: LETTER, names: 'Noor & Yusuf', isRTL: false,
    invitationPattern: 'serif', invitationTheme: {}, invitationGuestName: 'Guest', invitationData: {},
  };

  it('ships no hero artwork of its own', () => {
    /* The point of the whole template. Every other cinematic key supplies the
       picture at the fold; this one must not, or an organizer's photograph is
       competing with ours on their own invitation. */
    const shipped = Object.entries(LETTER.assets).map(([k]) => k);
    expect(shipped, 'a hero asset came back').not.toContain('frame');
    expect(shipped).not.toContain('lake');
    expect(shipped).not.toContain('heroPoster');
    // And no stylesheet rule may put one back.
    const css = read('src/app/styles/cinematic.css');
    const block = css.slice(css.indexOf('.cine-lhero {'), css.indexOf('6. RESPONSIVE'));
    expect(block, 'the hero paints artwork we shipped').not.toMatch(/url\(["']?\/templates\//);
  });

  it('falls back to a typographic hero, never a placeholder or a stock couple', () => {
    render(<LetterPortraitHero {...heroProps} />);
    expect(screen.queryByTestId('cine-lhero-photo')).toBeNull();
    // Still a finished page: the names are there and the root says which
    // ground it is painting, so the CSS can invert the ink.
    expect(screen.getByTestId('cine-hero-letter').className).toContain('is-bare');
    expect(screen.getByText('Noor & Yusuf')).toBeTruthy();
  });

  it('fills the fold with the photograph when there is one', () => {
    render(<LetterPortraitHero {...heroProps} heroPhoto="https://cdn.example/couple.jpg" />);
    expect(screen.getByTestId('cine-lhero-photo').getAttribute('src')).toBe('https://cdn.example/couple.jpg');
    expect(screen.getByTestId('cine-hero-letter').className).toContain('has-photo');

    // Full bleed, asserted where it actually lives.
    const css = read('src/app/styles/cinematic.css');
    const photo = css.match(/\.cine-lhero__photo \{([\s\S]*?)\n\}/)?.[1] || '';
    expect(photo).toContain('width: 100%');
    expect(photo).toContain('height: 100%');
    expect(photo).toContain('object-fit: cover');
  });

  it('the focal point reaches object-position', () => {
    /* A phone's fold is a tall portrait and most photographs are not, so this
       decides which part survives. A control that writes a value nothing reads
       is the "Design tab dead controls" bug all over again. */
    const seen = Object.keys(LETTER_FOCUS).map((focus) => {
      const { unmount } = render(<LetterPortraitHero {...heroProps} heroPhoto="/p.jpg" heroFocus={focus} />);
      const style = screen.getByTestId('cine-lhero-photo').getAttribute('style') || '';
      unmount();
      return style;
    });
    seen.forEach((style) => expect(style).toMatch(/object-position/));
    expect(new Set(seen).size, 'the three focal points render identically').toBe(3);
  });

  it('an unknown focal point falls back rather than rendering nothing', () => {
    // template_data is free-form JSON on a row anybody with API access can
    // write; an unrecognised value must not blank the crop.
    render(<LetterPortraitHero {...heroProps} heroPhoto="/p.jpg" heroFocus="sideways" />);
    expect(screen.getByTestId('cine-lhero-photo').getAttribute('style')).toMatch(/object-position/);
  });

  it('anchors the words where the organizer put them, and the scrim with them', () => {
    /* The words move and the shading has to move with them — a scrim drawn
       from the bottom while the type sits at the top is type on bare
       photograph, which is the failure this control exists to prevent. */
    const css = read('src/app/styles/cinematic.css');
    Object.keys(LETTER_TEXT_POS).forEach((pos) => {
      const { unmount } = render(<LetterPortraitHero {...heroProps} heroPhoto="/p.jpg" heroTextPos={pos} />);
      expect(screen.getByTestId('cine-hero-letter').className).toContain(`pos-${pos}`);
      unmount();
      expect(css, `pos-${pos} has no scrim of its own`)
        .toMatch(new RegExp(`\\.cine-lhero\\.pos-${pos} \\.cine-lhero__scrim \\{`));

      /* Gated on `.has-photo`, and the VALUE has to match LETTER_TEXT_POS —
         which the editor's preview reads directly. Two things ride on the
         gate: the empty state centres regardless (the control positions words
         against a photograph, and with none the type just looked fallen), and
         naming it removes a specificity tie that a bare
         `.cine-lhero.is-bare` rule was winning on source order alone. */
      const rule = css.match(new RegExp(`\\.cine-lhero\\.has-photo\\.pos-${pos} \\{([^}]*)\\}`))?.[1];
      expect(rule, `pos-${pos} does not move the type, or is not gated on a photo`).toBeTruthy();
      expect(rule, `pos-${pos} disagrees with LETTER_TEXT_POS`)
        .toContain(`justify-content: ${LETTER_TEXT_POS[pos]}`);
    });

    // And the base — what a hero with no photograph gets whatever is set.
    const base = css.match(/\n\.cine-lhero \{([\s\S]*?)\n\}/)?.[1] || '';
    expect(base, 'the empty hero no longer centres its type')
      .toContain('justify-content: center');
  });

  it('the scroll cue stays at the foot whatever the words do', () => {
    /* It travelled with the type at first, which put "scroll down" halfway up
       a photograph pointing at nothing — a cue points at the edge you scroll
       from. The save button DOES travel with the words, because it is part of
       the invitation rather than a hint about the page. */
    const css = read('src/app/styles/cinematic.css');
    const cue = css.match(/\.cine-lhero__cue \{([\s\S]*?)\n\}/)?.[1] || '';
    expect(cue, 'the cue is no longer pinned').toBeTruthy();
    expect(cue).toContain('position: absolute');
    expect(cue).toContain('bottom:');

    // And the moving column reserves room for it, or the two overlap at the
    // one position where both want the foot.
    const inner = css.match(/\.cine-lhero__inner \{([\s\S]*?)\n\}/)?.[1] || '';
    expect(inner, 'nothing reserves the pinned cue\'s height').toMatch(/padding[\s\S]*8\dpx/);
  });

  it('an unknown text position falls back to the default', () => {
    render(<LetterPortraitHero {...heroProps} heroPhoto="/p.jpg" heroTextPos="sideways" />);
    expect(screen.getByTestId('cine-hero-letter').className).toContain(`pos-${LETTER_TEXT_POS_DEFAULT}`);
  });

  it('no scrim at all without a photograph', () => {
    // The ground is already paper; a scrim over it is just dirt.
    const { container } = render(<LetterPortraitHero {...heroProps} />);
    expect(container.querySelector('.cine-lhero__scrim')).toBeNull();
  });

  it('shows either caption line on its own', () => {
    const { unmount } = render(<LetterPortraitHero {...heroProps} heroCaption="Where it all begins" />);
    expect(screen.getByText('Where it all begins')).toBeTruthy();
    unmount();

    render(<LetterPortraitHero {...heroProps} heroCaptionSub="Beirut, 2026" />);
    expect(screen.getByText('Beirut, 2026')).toBeTruthy();
  });

  it('the occasion tagline yields to the organizer\'s own words', () => {
    /* Both would be two sentences saying the same thing, and the generic one
       would be the weaker. Theirs wins; the catalogue's shows only when they
       have written nothing. */
    const tagline = 'invite you to share the joy of their wedding';
    const { unmount } = render(<LetterPortraitHero {...heroProps} tagline={tagline} />);
    expect(screen.getByText(tagline)).toBeTruthy();
    unmount();

    render(<LetterPortraitHero {...heroProps} tagline={tagline} heroCaption="Where it all begins" />);
    expect(screen.queryByText(tagline)).toBeNull();
  });

  it('holds its entrance while the cover is still up', () => {
    /* The hero mounts UNDERNEATH the opening, a second or two before the guest
       can see it. Arriving on mount spends the whole entrance behind a sealed
       envelope. */
    render(<LetterPortraitHero {...heroProps} openingActive />);
    expect(screen.getByTestId('cine-hero-letter').className).toContain('is-arriving');
  });

  it('releases when the cover goes', async () => {
    const { rerender } = render(<LetterPortraitHero {...heroProps} openingActive />);
    await act(async () => { rerender(<LetterPortraitHero {...heroProps} openingActive={false} />); });
    // requestAnimationFrame plus a timer backstop; jsdom runs rAF on a timer.
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(screen.getByTestId('cine-hero-letter').className).not.toContain('is-arriving');
  });

  it('an event with the opening turned off arrives already settled', () => {
    render(<LetterPortraitHero {...heroProps} openingActive={false} />);
    expect(screen.getByTestId('cine-hero-letter').className).not.toContain('is-arriving');
  });

  it('reduced motion gets the settled hero outright', () => {
    reducedMotion = true;
    render(<LetterPortraitHero {...heroProps} openingActive />);
    expect(screen.getByTestId('cine-hero-letter').className).not.toContain('is-arriving');
  });

  it('the settled state is the default and the entrance is the class', () => {
    /* A browser that freezes transitions, or a render that never reaches the
       effect, must show the correct finished hero — never one stuck
       mid-entrance. Same shape as Swan Lake's is-embossed. */
    const css = read('src/app/styles/cinematic.css');
    expect(css).toMatch(/\.cine-lhero\.is-arriving \.cine-lhero__photo \{/);
    const block = css.match(/\.cine-lhero\.is-arriving \.cine-lhero__photo \{([\s\S]*?)\}/)[1];
    expect(block, 'the hero would animate INTO its entrance on mount').toContain('transition: none');
  });

  it('the page passes the cover state down', () => {
    // Without this the prop is always false and the entrance never runs.
    expect(read('src/app/[slug]/EventPageClient.js')).toMatch(/openingActive=\{showReveal\}/);
    expect(read('src/app/components/templates/GuestExperiencePreview.js')).toMatch(/openingActive=\{!openingDone\}/);
  });

  it('the guest page reads every field the editor writes', () => {
    /* The whole feature, end to end, in one assertion. Every one of these has
       a silent failure mode: the organizer fills the field in, it saves, and
       the guest page simply never looks at it. */
    const page = read('src/app/components/templates/heritageArch/HeritageArchPage.js');
    LETTER_FIELD_KEYS.forEach((key) => {
      expect(page, `${key} is written but never read`).toContain(key);
    });
  });
});

/* ════════════════════════════════════════════════════════════════════
   5. The editor shows what the guest will get
   ════════════════════════════════════════════════════════════════════ */
describe('the preview cannot drift from the page', () => {
  it('the hero and the editor read the SAME focal-point positions', () => {
    /* Both had their own copy of the three object-position values for a
       while. A preview that crops differently from the page is the one
       failure mode a preview must not have — it is a confident answer to the
       wrong question — and nothing about it looks wrong until an organizer
       positions a photograph here and their guests see something else. */
    expect(Object.keys(LETTER_FOCUS).sort()).toEqual(['bottom', 'center', 'top']);
    expect(LETTER_FOCUS[LETTER_FOCUS_DEFAULT], 'the fallback is not a real option').toBeTruthy();

    [
      'src/app/components/LetterPortraitFields.js',
      'src/app/components/templates/cinematic/LetterPortraitHero.js',
    ].forEach((file) => {
      const src = read(file);
      expect(src, `${file} keeps its own copy of the focal points`).toContain('LETTER_FOCUS');
      expect(src, `${file} hardcodes an object-position`).not.toMatch(/'50% (18|82)%'/);
    });
  });

  it('the hero and the editor read the SAME text positions', () => {
    expect(Object.keys(LETTER_TEXT_POS).sort()).toEqual(['bottom', 'center', 'top']);
    expect(LETTER_TEXT_POS[LETTER_TEXT_POS_DEFAULT], 'the fallback is not a real option').toBeTruthy();
    [
      'src/app/components/LetterPortraitFields.js',
      'src/app/components/templates/cinematic/LetterPortraitHero.js',
    ].forEach((file) => {
      expect(read(file), `${file} keeps its own copy of the text positions`).toContain('LETTER_TEXT_POS');
    });
  });

  it('the preview centres an empty hero, exactly as the page does', () => {
    /* The page ignores the position control until there is a photograph to
       position against (`.cine-lhero`'s base is `center`, and the pos-* rules
       are gated on `.has-photo`). The preview applied it regardless, so an
       organizer with no photo yet saw their names pinned low on a page that
       centres them. Both directions of this drift have now happened once. */
    const { container } = render(
      <LetterPortraitFields
        value={{ letter_hero_text_pos: 'bottom' }}
        onChange={() => {}}
        onUploadImage={async () => null}
      />,
    );
    const preview = container.querySelector('[data-testid="letter-portrait-preview"]');
    expect(preview.getAttribute('style')).toMatch(/justify-content:\s*center/);
  });

  it('previews the real aspect ratio, not a square', () => {
    /* The crop is the whole reason the focal point exists, and it only
       happens because the fold is a tall portrait. A preview in any other
       shape hides precisely the decision it is there to inform. */
    const editor = read('src/app/components/LetterPortraitFields.js');
    expect(editor, 'the preview is no longer a phone').toContain("aspectRatio: '390 / 844'");
  });

  it('the cover scene cannot drift in one language only', () => {
    /* Two direction traps, and this box could hit either.

       a) `inset-inline: 0` (or `inset: 0`) together with `left: 50%` is an
          over-constrained absolute box; the spec discards `right` in LTR and
          `left` in RTL. That put Swan Lake's Arabic hero at [-195, 195] of a
          390px screen while English was perfect.
       b) `margin-inline: auto` centres only while the box FITS. Two auto
          margins that would resolve negative are handled by zeroing the
          start-side one (CSS 2.1 §10.3.7) — margin-left in LTR,
          margin-right in RTL.

       This scene is deliberately WIDER than a narrow viewport, so (b) rules
       out auto margins and it must centre with a physical transform. Getting
       it backwards is invisible in English. */
    const css = read('src/app/styles/cinematic.css');
    const raw = css.match(/\.cine-letter__scene \{([\s\S]*?)\n\}/)?.[1] || '';
    expect(raw, 'the scene rule is gone').toBeTruthy();
    /* Comments stripped FIRST. The rule explains the trap it avoids, in prose
       that necessarily contains the very declarations being searched for — so
       a check that reads the comments finds the bug it is looking for in the
       note saying the bug was avoided. */
    const block = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(block, 'the scene is an over-constrained absolute box')
      .not.toMatch(/inset(-inline)?:[^;]*;[\s\S]*?(^|[^-])left:\s*50%/m);
    expect(block, 'a box wider than the viewport cannot centre with auto margins')
      .not.toContain('margin-inline: auto');
    expect(block).toMatch(/transform: translate\(-50%, -50%\)/);
  });

  it('the stylesheet and the editor paint the SAME scrim, stop for stop', () => {
    /* The one duplication this design genuinely cannot remove: a stylesheet
       cannot read a JS constant, so the gradients exist in cinematic.css for
       the page and in LETTER_SCRIM for the editor's preview. That has already
       cost one real bug — the CSS moved from the blush `--cine-deep` to a dark
       shade and the preview kept painting the old pale wash, so the organizer
       positioned their words against one scrim and their guests saw another.

       Discipline did not catch it and would not catch it next time. This does:
       the rules are parsed out, the custom property is substituted, and the
       result is compared character for character. */
    const css = read('src/app/styles/cinematic.css');
    const shade = LETTER.cssVars['--cine-lhero-shade-rgb'];
    const squash = (s) => s.replace(/\s+/g, ' ').trim();

    Object.keys(LETTER_TEXT_POS).forEach((pos) => {
      const rule = css.match(new RegExp(`\\.cine-lhero\\.pos-${pos} \\.cine-lhero__scrim \\{([\\s\\S]*?)\\n\\}`))?.[1] || '';
      expect(rule, `pos-${pos} has no scrim rule`).toBeTruthy();

      const fromCss = squash(
        rule.replace(/^\s*background:\s*/m, '')
          .replace(/;\s*$/, '')
          .replace(/rgba\(var\(--cine-lhero-shade-rgb\),/g, `rgba(${shade},`),
      );
      expect(fromCss, `pos-${pos} differs between the page and the preview`)
        .toBe(squash(LETTER_SCRIM[pos]));
    });
  });

  it('the scrim is built from a genuinely dark colour', () => {
    /* --cine-deep is the obvious variable and the wrong one HERE: on this
       template it is #a6705f, a light rose describing the blush envelope, so
       a scrim made from it darkened nothing and ivory names disappeared into
       a lit chandelier. Nothing in jsdom can see that, and it is invisible
       over a dark photograph too — only a bright one shows it. */
    const css = read('src/app/styles/cinematic.css');
    Object.keys(LETTER_TEXT_POS).forEach((pos) => {
      const rule = css.match(new RegExp(`\\.cine-lhero\\.pos-${pos} \\.cine-lhero__scrim \\{([\\s\\S]*?)\\n\\}`))?.[1] || '';
      expect(rule, `pos-${pos} has no scrim`).toBeTruthy();
      expect(rule, `pos-${pos} shades with the blush envelope's colour`)
        .not.toContain('--cine-deep-rgb');
      expect(rule).toContain('--cine-lhero-shade-rgb');
    });

    // And the value really is dark — every channel well below mid-grey.
    const shade = LETTER.cssVars['--cine-lhero-shade-rgb'];
    expect(shade, 'the template never declares its shade').toBeTruthy();
    shade.split(',').forEach((ch) => {
      expect(Number(ch.trim()), `${shade} is not a dark colour`).toBeLessThan(90);
    });
  });

  it('the names are solid ink over a photograph, never a moving gradient', () => {
    /* The gold sweep spends half its cycle with a mid-tone across the
       letterforms, and `background-clip: text` forces a transparent fill that
       text-shadow cannot paint on — so over a photograph the one treatment
       that would rescue legibility is unavailable. Scoped to .is-bare, and it
       has to STAY scoped: an unscoped rule leaves a transparent fill standing
       on the photo hero, which is invisible names, not faint ones. */
    const css = read('src/app/styles/cinematic.css');
    expect(css, 'the shimmer is no longer limited to the bare hero')
      .toMatch(/\.cine-lhero\.is-bare \.cine-lhero__shimmer \{/);

    /* No rule whose selector STARTS with the shimmer — that is what "unscoped"
       means here. Anchoring to line start is the whole trick: matching on
       whitespace-then-shimmer also matches the descendant half of
       `.cine-lhero.is-bare .cine-lhero__shimmer`, so the check fired on the
       correctly-scoped rule it was written to protect. */
    expect(css, 'an unscoped shimmer leaves a transparent fill on the photo hero')
      .not.toMatch(/^\s*\.cine-lhero__shimmer\s*[,{]/m);
  });

  it('the measure is not expressed in ch', () => {
    /* `ch` resolves against the containing box's font-size, not the names' —
       22ch on a block inheriting 16px came out at ~176px and wrapped the date
       inside a 390px screen with room for it twice over. */
    const css = read('src/app/styles/cinematic.css');
    const type = css.match(/\.cine-lhero__type \{([\s\S]*?)\n\}/)?.[1] || '';
    expect(type, 'the measure is gone').toBeTruthy();
    expect(type, 'a display measure cannot be written in the container\'s ch')
      .not.toMatch(/max-width:[^;]*ch/);
  });

  it('the hero photograph is full bleed with inset-inline, not 100vw', () => {
    // 100vw counts the scrollbar gutter but the scroll container's content
    // box does not, so a 100vw layer overflows by half a scrollbar on every
    // desktop — real horizontal overflow, hidden only by SnapShell's clip.
    const css = read('src/app/styles/cinematic.css');
    const photo = css.match(/\.cine-lhero__photo \{([\s\S]*?)\n\}/)?.[1] || '';
    expect(photo).toContain('inset-inline: 0');
    expect(photo).not.toContain('100vw');
  });
});

/* ════════════════════════════════════════════════════════════════════
   6. The editor
   ════════════════════════════════════════════════════════════════════ */
describe('the organizer can actually fill the panel in', () => {
  it('writes the focal point the hero reads', () => {
    const onChange = vi.fn();
    render(<LetterPortraitFields value={{}} onChange={onChange} onUploadImage={async () => null} />);
    fireEvent.click(screen.getByTestId('letter-focus-top'));
    expect(onChange).toHaveBeenCalledWith({ letter_hero_focus: 'top' });
  });

  it('stores the uploaded URL under the key the guest page reads', async () => {
    const onChange = vi.fn();
    const upload = vi.fn(async () => 'https://cdn.example/couple.jpg');
    const { container } = render(
      <LetterPortraitFields value={{}} onChange={onChange} onUploadImage={upload} />,
    );
    const input = container.querySelector('input[type="file"]');
    const file = new File(['x'], 'couple.jpg', { type: 'image/jpeg' });
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });

    expect(upload).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ letter_hero_photo: 'https://cdn.example/couple.jpg' });
  });

  it('a failed upload writes nothing rather than an empty photo', async () => {
    // The uploader returns null once it has already told the organizer why.
    // Writing '' here would silently clear a photo they already had.
    const onChange = vi.fn();
    const { container } = render(
      <LetterPortraitFields value={{ letter_hero_photo: '/old.jpg' }} onChange={onChange} onUploadImage={async () => null} />,
    );
    const input = container.querySelector('input[type="file"]');
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['x'], 'c.jpg', { type: 'image/jpeg' })] } });
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('refuses a file that is not an image, without calling the uploader', async () => {
    const upload = vi.fn();
    const onError = vi.fn();
    const { container } = render(
      <LetterPortraitFields value={{}} onChange={() => {}} onUploadImage={upload} onError={onError} />,
    );
    const input = container.querySelector('input[type="file"]');
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['x'], 'notes.pdf', { type: 'application/pdf' })] } });
    });
    expect(upload).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
  });

  it('shows the organizer the crop they are choosing', () => {
    // The panel is 1:2 and nobody can be asked to imagine that.
    render(<LetterPortraitFields value={{ letter_hero_photo: '/p.jpg' }} onChange={() => {}} onUploadImage={async () => null} />);
    expect(screen.getByTestId('letter-portrait-preview')).toBeTruthy();
  });

  it('is the same component on both editing surfaces', () => {
    /* One control, one description. Two copies is two descriptions of one
       switch, which is how a feature earns a reputation for being
       unpredictable — it has already happened here with the adults-only
       notice. */
    expect(read('src/app/dashboard/create-event/components/Stage2_FormConfiguration.js'))
      .toContain('LetterPortraitFields');
    expect(read('src/app/dashboard/components/EventSettings.js'))
      .toContain('LetterPortraitFields');
  });

  it('the settings screen hydrates the fields it renders', () => {
    /* setTemplateData there REPLACES local state from a whitelist rather than
       spreading event.template_data. A key missing from that list reads as
       undefined in the editor — so an event WITH a photograph would open on an
       empty upload box and a preview of the stock illustration, and the first
       save would look like it had worked. */
    const settings = read('src/app/dashboard/components/EventSettings.js');
    LETTER_FIELD_KEYS.forEach((key) => {
      expect(settings, `${key} is edited but never hydrated`)
        .toContain(`${key}: event.template_data?.${key}`);
    });
  });

  it('the wizard never prunes the portrait when switching templates', () => {
    /* handleTemplateSelect drops keys belonging to OTHER templates' field
       sets. These are in no set at all — the same treatment ha_schedule_day1
       gets — so trying Swan Lake and coming back cannot delete the couple's
       photograph. */
    const wizard = read('src/app/dashboard/create-event/page.js');
    const maps = wizard.match(/const TEMPLATE_TYPE_FIELD_KEYS = \{[\s\S]*?\n\};/)?.[0] || '';
    const fieldLists = wizard.match(/const (HA_SECTION|WEDDING|CUSTOM_CATEGORY|FULL_PAGE)_FIELD_KEYS = \[[\s\S]*?\];/g) || [];
    [maps, ...fieldLists].forEach((block) => {
      expect(block, 'a template switch would delete the portrait').not.toContain('letter_hero');
    });
  });
});

/* ════════════════════════════════════════════════════════════════════
   7. A first-class template
   ════════════════════════════════════════════════════════════════════ */
describe('Sealed Letter is wired into everything a template needs', () => {
  it('ships every asset it names', () => {
    Object.entries(LETTER.assets).forEach(([name, src]) => {
      const file = path.join(ROOT, 'public', src.replace(/^\//, ''));
      expect(fs.existsSync(file), `${name} → ${src} is not in public/`).toBe(true);
    });
  });

  it('names every asset it ships', () => {
    /* The other direction, and the one that caught something real on the
       swans pass: a 151KB orchid declared in `assets` and never rendered. A
       file here that nothing points at is either dead weight or a wiring bug.
       Both are worth failing on. */
    const named = new Set(Object.values(LETTER.assets).map((s) => path.basename(s)));
    const orphans = fs.readdirSync(path.join(ROOT, 'public/templates/letter'))
      .filter((f) => !named.has(f));
    expect(orphans, 'shipped but never referenced by the template').toEqual([]);
  });

  it('the picker card shows the cover a guest actually lands on', () => {
    const entry = TEMPLATES.find((t) => t.key === 'letter');
    expect(entry, 'Sealed Letter is not in the picker').toBeTruthy();
    expect(entry.preview.src).toBe(LETTER.assets.poster);
    expect(entry.presets.length).toBeGreaterThan(0);
  });

  it('the picker card does not try to show the sprite sheet', () => {
    /* 7480px of seventeen frames under object-fit: cover crops a smear out of
       the middle of frame eight — 220KB fetched to show nothing legible. */
    const entry = TEMPLATES.find((t) => t.key === 'letter');
    expect(entry.preview.src).not.toBe(LETTER.assets.sprite);
  });

  it('the Design tab names the arrival this template has', () => {
    const opening = getTemplateOpening('letter');
    expect(opening.cinematic).toBe(LETTER);
    // The seal is part of the artwork, so seal_text / reveal_tone reach
    // nothing — offering a monogram field would misinform the organizer.
    expect(opening.hasSeal).toBe(false);
    expect(opening.previewLabel).toBe('Preview the opening');
  });

  it('is offered for any occasion, and says so', () => {
    const policy = occasionPolicyFor('letter');
    expect(policy.locked).toBe(false);
    expect(policy.label).toBe('Any occasion');
  });

  it('sections recolour from its own palette when the event has none', () => {
    const palette = buildPalette({}, 'letter');
    expect(palette.background).toBe(LETTER.colors.background);
    // Cream ground — this must resolve LIGHT, like Door of Joy and Swan Lake
    // and unlike Velvet Ring, or every section below the hero inverts.
    expect(palette.ink).toBeTruthy();
    expect(buildPalette({ background: '#123456' }, 'letter').background).toBe('#123456');
  });

  it('the guest slug comes from the couple, like every other couple template', () => {
    const helper = read('../backend/utils/slugHelper.js');
    const weddingArm = helper.match(/case 'wedding':([\s\S]*?)break;/)?.[1] || '';
    expect(weddingArm, 'letter does not derive its slug from the partner names')
      .toContain("case 'letter':");
  });

  it('the landing band shows it, with its own arrival line', () => {
    const band = read('src/app/components/landing/TemplatesShowcaseSection.js');
    /* The SEALED envelope, not an opened page — this is the one template
       whose opened page is the couple's own photograph, and any hero shot
       here would be a stock couple standing in for theirs. */
    expect(band).toContain('/images/landing/cover-letter.webp');
    expect(band, 'the plate never says the photograph is the organizer\'s')
      .toMatch(/your own photograph/i);
    expect(band, 'the "your photo here" inset is gone')
      .toContain('/images/landing/couple-illustration.webp');
    // The band renders ARRIVAL[key]; a template missing from that map prints
    // an empty line under its photograph rather than erroring.
    const arrivals = band.match(/const ARRIVAL = \{([\s\S]*?)\n\};/)?.[1] || '';
    expect(arrivals).toContain('letter:');
  });
});

/* ════════════════════════════════════════════════════════════════════
   8. Nothing from the source page came with it
   ════════════════════════════════════════════════════════════════════ */
describe('the port left the source platform behind', () => {
  it('no analytics or tracking bundle reached public/', () => {
    /* The source page carries a Facebook pixel and a Google tag bundle beside
       the artwork. Copying the directory wholesale is the obvious mistake and
       would put both on every guest's invitation. */
    const dir = path.join(ROOT, 'public/templates/letter');
    fs.readdirSync(dir).forEach((file) => {
      expect(file, `${file} is not artwork`).toMatch(/\.(jpg|png|webp|mp4|webm|m4a|wav)$/);
    });
  });

  it('the source folder is not committed, and the ignore rule is anchored', () => {
    /* Both halves matter, and the second one broke a deploy once. A bare
       `envelop1/` is NOT "the folder at the root" — it matches a directory of
       that name at ANY depth, and this repo has two `templates/` directories
       that the unanchored version silently untracked: the whole component
       tree and every template's artwork. Already-tracked files were
       unaffected and the tree still built locally, so nothing looked wrong
       until the server failed on a missing module. */
    const ignore = read('../.gitignore');
    expect(ignore, 'the source folder is no longer ignored').toMatch(/^\/envelop1\/$/m);
    expect(ignore, 'an unanchored rule also swallows src and public')
      .not.toMatch(/^envelop1\/$/m);
  });

  it('git actually tracks the files the build imports', () => {
    /* The assertion above reads the rules; this one asks git. A pattern can be
       correct and still be defeated by a second rule elsewhere in the file,
       and the failure mode is invisible locally — the module is on disk, the
       tests pass, and only the deploy notices it was never committed. */
    const needed = [
      'frontend/src/app/components/templates/cinematic/LetterPortraitHero.js',
      'frontend/src/app/components/guest/openings/SealedLetterOpening.js',
      'frontend/src/app/components/LetterPortraitFields.js',
      ...Object.values(LETTER.assets).map((s) => `frontend/public${s}`),
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
