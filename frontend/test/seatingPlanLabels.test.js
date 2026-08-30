import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { planNumeral, numeralFits, planLegend } from '../src/app/utils/seatingPlanStyle';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT A GUEST'S SEATING PLAN IS ALLOWED TO SAY.
 *
 * The rule, in one line: a table is marked with its NUMBER, a zone with its
 * GLYPH, and nothing on the plan is spelled out.
 *
 * It is a rule about legibility, not taste. The thumbnail on the entry pass
 * draws a 96px table at roughly 13 screen pixels; "Table 12" set inside that is
 * seven-pixel type — unreadable, while still pulling the eye evenly across
 * fifteen tables, which is the exact opposite of what a guest opened the map to
 * do. "12" is two characters, so the same space sets it three times larger.
 *
 * The failure mode this file guards is quiet and specific: somebody adds
 * `{el.table_name}` back into one of the two maps because a table "looked
 * unlabelled", and the plan silently returns to fifteen unreadable captions.
 * There is no visual test in this repo that would catch it (jsdom has no layout
 * engine), so the guard is a source assertion.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const SRC = path.join(process.cwd(), 'src', 'app');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const GUEST_MAPS = [
  '[slug]/rsvp/SeatingMiniMap.js',
  '[slug]/rsvp/SeatingMapFullscreen.js',
];

describe('the guest plan is numbered, not labelled', () => {
  it.each(GUEST_MAPS)('%s never prints an element name onto the plan', (rel) => {
    const src = read(rel);
    expect(src).not.toMatch(/\{\s*el\.table_name\s*\}/);
    // `planNumeral(el.table_name)` is the ONLY permitted read of the name — it
    // returns a mark, not a caption.
    const reads = src.match(/el\.table_name/g) || [];
    const viaNumeral = src.match(/planNumeral\(el\.table_name\)/g) || [];
    expect(reads.length).toBe(viaNumeral.length);
  });

  it.each(GUEST_MAPS)('%s takes its look from the shared module, not a local copy', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/from '\.\.\/(\.\.\/)?utils\/seatingPlanStyle'/);
  });

  it('the organizer editor is deliberately NOT bound by this rule', () => {
    // It is a work surface — it needs names, capacities and occupancy on every
    // element. Asserting the opposite here documents that the omission is a
    // decision rather than a file somebody forgot.
    const src = read('dashboard/seating-map/page.js');
    expect(src).not.toMatch(/seatingPlanStyle/);
  });

  it('the PRINTED plan is bound by it, and that is the point of the split', () => {
    // The editor and the export used to be the same file, which made "is this
    // surface a work surface or a finished artefact" unanswerable. It is
    // answerable now: the canvas is a work surface, the printed pack is an
    // artefact read at arm's length in a room, and it takes the same numeral
    // rule the guest maps take. Before this, the export drew {el.table_name}
    // raw at 38px inside a 96px table, so an organizer who named their tables
    // "Table 12" printed eight characters spilling out of every one of them.
    const src = read('dashboard/seating-map/SeatingChartPrint.js');
    expect(src).toMatch(/from '\.\.\/\.\.\/utils\/seatingPlanStyle'/);
    expect(src).toMatch(/planNumeral\(el\.table_name\)/);
    expect(src).not.toMatch(/\{\s*el\.table_name\s*\}/);
  });
});

describe('planNumeral', () => {
  it('keeps a bare number as it is', () => {
    expect(planNumeral('5')).toBe('5');
    expect(planNumeral('12')).toBe('12');
  });

  it('drops the word and keeps the number', () => {
    expect(planNumeral('Table 8')).toBe('8');
    expect(planNumeral('Table 12')).toBe('12');
    expect(planNumeral('Table-7')).toBe('7');
    expect(planNumeral('Table 100')).toBe('100');
  });

  it('does not swallow the tail of the preceding word', () => {
    // The bug this case exists for: an unanchored letter group turns
    // "Table 12" into "LE12".
    expect(planNumeral('Table 12')).not.toContain('L');
    expect(planNumeral('Round 3')).toBe('3');
  });

  it('keeps a section letter that belongs to the number', () => {
    expect(planNumeral('Table A3')).toBe('A3');
    expect(planNumeral('A3')).toBe('A3');
  });

  it('reads Arabic table names and Arabic-Indic digits', () => {
    expect(planNumeral('طاولة ٧')).toBe('٧');
    expect(planNumeral('طاولة 15')).toBe('15');
  });

  it('falls back to initials for a named table', () => {
    expect(planNumeral('Rose Garden')).toBe('RG');
    expect(planNumeral('Head Table')).toBe('HT');
  });

  it('never returns more than three characters', () => {
    for (const name of ['Table 8', 'Rose Garden', 'The Long Head Table', 'VIP', 'طاولة العروسين']) {
      expect(planNumeral(name).length).toBeLessThanOrEqual(3);
    }
  });

  it('returns nothing for an empty name', () => {
    expect(planNumeral('')).toBe(null);
    expect(planNumeral(null)).toBe(null);
    expect(planNumeral('   ')).toBe(null);
  });
});

describe('numeralFits', () => {
  it('draws the numeral once the table can carry legible type', () => {
    expect(numeralFits(96)).toBe(true);   // world px, the expanded plan
    expect(numeralFits(14)).toBe(true);   // a table on the entry-pass thumbnail
  });

  it('refuses below the legibility floor', () => {
    // Decoration that looks like information is worse than none: at this size
    // the mark would be an illegible smudge a guest might mistake for their
    // table number.
    expect(numeralFits(6)).toBe(false);
  });
});

describe('planLegend', () => {
  const el = (shape, id) => ({ id, shape, element_type: 'zone' });

  it('names each kind of zone once, however many are on the plan', () => {
    const legend = planLegend([
      el('bar', 'a'), el('bar', 'b'), el('stage', 'c'),
      { id: 'd', shape: 'round', element_type: 'table' },
    ]);
    expect(legend.map((z) => z.shape)).toEqual(['bar', 'stage']);
    expect(legend[0].label).toBe('Bar');
    expect(legend[0].icon).toBeTruthy();
  });

  it('is empty for a room with no zones, so no empty bar is rendered', () => {
    expect(planLegend([{ id: 'a', shape: 'round' }])).toEqual([]);
    expect(planLegend(null)).toEqual([]);
  });
});
