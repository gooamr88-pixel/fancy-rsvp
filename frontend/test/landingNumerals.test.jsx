import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ═══════════════════════════════════════════════════════════════════════════
   THE SECTION NUMERALS ARE A SEQUENCE, NOT BAND POSITIONS.

   They were first written as each section's index in BAND_ORDER, which
   rendered as II, IV, V, VI, IX — a numbered sequence with four visible gaps,
   because the bands in between either carry no numeral (hero, statement,
   footer) or render conditionally.

   The conditional ones are the real problem. PrintedInvitationsSection and
   ProofSection both return null until an admin has data behind them, so ANY
   numbering keyed to position is wrong on a fresh install and right only on a
   fully populated one — the kind of defect that never shows up in the
   environment it was built in.

   So the numerals run across exactly the sections that always render — I..V
   until 2026-09-09, I..VIII since the four feature bands were added. This test
   pins both halves of that: the sequence is complete, and a conditional
   section never joins it.

   The hero carries no numeral, and that is not an omission: a sequence that
   starts before the reader has been told what they are looking at is counting
   for its own sake. I is the first thing being SHOWN.
   ═══════════════════════════════════════════════════════════════════════════ */

/** In render order — see BAND_ORDER and page.js. */
const NUMBERED = [
  ['TemplatesShowcaseSection.js', 'tss-secnum', 'I'],
  ['GuestExperienceSection.js', 'ge-numeral', 'II'],
  ['DashboardShowcaseSection.js', 'dash-numeral', 'III'],
  ['SeatingSection.js', 'seat-numeral', 'IV'],
  ['RemindersSection.js', 'rem-numeral', 'V'],
  ['CheckinSection.js', 'door-numeral', 'VI'],
  ['CapabilitiesSection.js', 'cap-numeral', 'VII'],
  ['FaqCtaSection.js', 'fc-numeral', 'VIII'],
];

/** Sections that render null without data, and so must never be numbered. */
const CONDITIONAL = ['PrintedInvitationsSection.js', 'ProofSection.js'];

const src = (file) => read(`src/app/components/landing/${file}`);

describe('landing section numerals', () => {
  it('run in sequence with no gaps, in render order', () => {
    NUMBERED.forEach(([file, cls, numeral]) => {
      const needle = `className="${cls}" aria-hidden="true">${numeral}<`;
      expect(src(file), `${file} should carry numeral ${numeral}`).toContain(needle);
    });
  });

  it('numbers exactly the sections that always render', () => {
    const all = fs.readdirSync(path.join(ROOT, 'src/app/components/landing'))
      .filter((f) => f.endsWith('Section.js'));
    const numbered = all.filter((f) => /aria-hidden="true">[IVX]+</.test(src(f)));
    expect(numbered.sort()).toEqual(NUMBERED.map(([f]) => f).sort());
  });

  it('never numbers a section that can render nothing', () => {
    CONDITIONAL.forEach((file) => {
      const body = src(file);
      // These really are conditional — if one stops returning null this test
      // is telling you the wrong thing and should be revisited.
      expect(body, `${file} is no longer conditional`).toMatch(/return null/);
      expect(body, `${file} must not carry a section numeral`)
        .not.toMatch(/aria-hidden="true">[IVX]+</);
    });
  });

  it('the numerals are decorative and hidden from assistive tech', () => {
    // A screen reader announcing "one" before a heading is noise; the numeral
    // is a typographic device, not content.
    NUMBERED.forEach(([file, cls]) => {
      const re = new RegExp(`className="${cls}"[^>]*aria-hidden="true"`);
      expect(src(file), `${file}'s numeral must be aria-hidden`).toMatch(re);
    });
  });
});
