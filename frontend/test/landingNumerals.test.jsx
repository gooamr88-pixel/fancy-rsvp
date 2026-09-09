import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const LANDING = path.join(ROOT, 'src/app/components/landing');

/* ═══════════════════════════════════════════════════════════════════════════
   THE SECTION NUMERALS ARE GONE, AND THIS IS WHAT KEEPS THEM GONE.

   ── What they were ──────────────────────────────────────────────────────

   A small roman numeral in the corner of every band's header — I, II, III …
   set in the display italic, hidden from assistive tech. This file used to
   assert that they ran in an unbroken sequence across exactly the bands that
   always render, because keying them to a band's POSITION was wrong on a
   fresh install: two bands render nothing until an admin has data behind
   them, so any position-derived numbering was right only on a fully populated
   site and had visible gaps everywhere else.

   ── Why they went ────────────────────────────────────────────────────────

   The 2026-09-09 review of the approved mockup. Every band header carried a
   kicker, a gold rule beside the kicker, a numeral in the opposite corner, a
   headline and a sub-heading — five elements before the reader reaches the
   thing the band is about. The mockup gives a band three: kicker, headline,
   one sentence. The numeral was the piece with the least to say and the most
   competition for the eye, so it went first, and the rule went with it.

   ── Why this file stayed ────────────────────────────────────────────────

   Because "add a small numeral to each section" is a good idea that will
   occur to somebody again, and it is not obviously wrong until eight of them
   are on one page. The test now pins the DECISION rather than the sequence:
   no landing section prints a roman numeral, and the reason is here in one
   place rather than in a commit message nobody will find.

   If they come back deliberately, delete this file — do not weaken it. A test
   that has been loosened until it passes is worse than no test.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Every band file, including the shared shell they now all render through. */
const sections = () =>
  fs.readdirSync(LANDING).filter((f) => f.endsWith('Section.js') || f === 'FeatureBand.js');

describe('landing section numerals', () => {
  it('no band prints a roman numeral in its header', () => {
    /* The exact shape they took: an aria-hidden span whose whole content is
       roman digits. Matched narrowly on purpose — "IV" inside a sentence, or
       a viewBox, or the word "I" is not what this is about. */
    sections().forEach((file) => {
      const src = read(`src/app/components/landing/${file}`);
      const found = [...src.matchAll(/aria-hidden="true"\s*>\s*([IVXLC]+)\s*</g)].map((m) => m[1]);
      expect(found, `${file} has grown a section numeral again: ${found.join(', ')}`).toEqual([]);
    });
  });

  it('no band draws the gold rule that used to sit beside its kicker', () => {
    /* The numeral's other half. It was a 28px hairline after the kicker text,
       and with eight bands it read as eight small ticks down the left edge of
       the page rather than as ornament. */
    sections().forEach((file) => {
      const src = read(`src/app/components/landing/${file}`);
      expect(src, `${file} has a kicker rule again`).not.toMatch(/kicker__rule/);
    });
  });

  it('every band header is built from the same three parts', () => {
    /* THE POSITIVE HALF. Deleting the numeral is only half the decision; the
       other half is that a band header is a kicker, a title and one sentence,
       and that this is stated in ONE file rather than repeated in seven.
       FeatureBand is that file — if a band stops rendering through it, the
       rhythm can drift again without anything failing. */
    const shell = read('src/app/components/landing/FeatureBand.js');
    ['fb-kicker', 'fb-title', 'fb-sub'].forEach((cls) => {
      expect(shell, `FeatureBand no longer renders ${cls}`).toContain(cls);
    });

    const THROUGH_THE_SHELL = [
      'GuestExperienceSection.js',
      'DashboardShowcaseSection.js',
      'SeatingSection.js',
      'RemindersSection.js',
      'CheckinSection.js',
      'CapabilitiesSection.js',
    ];
    THROUGH_THE_SHELL.forEach((file) => {
      const src = read(`src/app/components/landing/${file}`);
      expect(src, `${file} stopped rendering through FeatureBand`).toContain('<FeatureBand');
      expect(src, `${file} declares its own <h2> instead of using the shell's`)
        .not.toMatch(/<h2/);
    });
  });
});
