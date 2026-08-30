import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  planNumeral, numeralFits, planLegend, zoneLabel, labelObstacles,
} from '../src/app/utils/seatingPlanStyle';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT A GUEST'S SEATING PLAN IS ALLOWED TO SAY.
 *
 * The rule, in one line: a TABLE is marked with its NUMBER and never with a
 * caption; a ZONE carries its glyph, and its name too when it is drawn big
 * enough to set one.
 *
 * It is a rule about legibility, not taste. The thumbnail on the entry pass
 * draws a 96px table at roughly 13 screen pixels; "Table 12" set inside that is
 * seven-pixel type — unreadable, while still pulling the eye evenly across
 * fifteen tables, which is the exact opposite of what a guest opened the map to
 * do. "12" is two characters, so the same space sets it three times larger.
 *
 * ── WHY THE ZONE HALF CHANGED (2026-08-30) ──
 *
 * It used to read "nothing on the plan is spelled out", zones included. That
 * was a rule about SMALL zones applied to all of them, and the cost was real:
 * on the entry pass and at the end of the RSVP — between them the map most
 * guests will ever see — the venue's zones were coloured boxes with a 9px glyph
 * and no name anywhere on the screen, because only the expanded map had a
 * legend. A 420×150 stage has room for its name three times over.
 *
 * So a zone names itself when `zoneLabel` measures that it fits at a legible
 * size IN SCREEN PIXELS, and falls back to the glyph otherwise — and the legend
 * now appears under BOTH maps, in the host's own words. The table half of the
 * rule is untouched, and is still what this file mainly guards: somebody adds
 * `{el.table_name}` back into a map because a table "looked unlabelled", and
 * the plan silently returns to fifteen unreadable captions. There is no visual
 * test in this repo that would catch that (jsdom has no layout engine), so the
 * guard is a source assertion.
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

  it.each(GUEST_MAPS)('%s names its zones through the measured helper, never raw', (rel) => {
    // A zone may be named — but only via zoneLabel, which decides in screen
    // pixels whether the name will actually be readable at the size the zone is
    // being drawn. Interpolating the name directly would put "DANCE FLOOR"
    // inside a DJ booth again.
    const src = read(rel);
    expect(src).toMatch(/zoneLabel\(el, \{ x: left, y: top, w, h \}/);
    expect(src).not.toMatch(/\{\s*el\.table_name\s*\}/);
  });

  it.each(GUEST_MAPS)('%s tells zoneLabel what is drawn over the zones', (rel) => {
    // Without the obstacle list a zone cannot know a table is sitting on it,
    // and the name goes back to being printed underneath one.
    const src = read(rel);
    expect(src).toMatch(/labelObstacles\(placed\)/);
    expect(src).toMatch(/obstacles\)/);
  });

  it.each(GUEST_MAPS)('%s shows a legend, so an unnamed zone is still explained', (rel) => {
    // The thumbnail had none, which is what made a glyph-only zone a dead end.
    expect(read(rel)).toMatch(/<SeatingLegend/);
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
  const el = (shape, id, name) => ({ id, shape, element_type: 'zone', table_name: name });

  it('folds identical zones together and counts them', () => {
    const legend = planLegend([
      el('bar', 'a'), el('bar', 'b'), el('stage', 'c'),
      { id: 'd', shape: 'round', element_type: 'table' },
    ]);
    expect(legend.map((z) => z.shape)).toEqual(['bar', 'stage']);
    expect(legend[0].label).toBe('Bar');
    expect(legend[0].count).toBe(2);
    expect(legend[0].icon).toBeTruthy();
  });

  it("uses the HOST's name for a zone, not the catalogue's", () => {
    // A host who called it the Champagne Bar got a key that said "Bar" — the
    // plan quietly disagreeing with their invitation and their signage.
    const legend = planLegend([el('bar', 'a', 'Champagne Bar')]);
    expect(legend[0].label).toBe('Champagne Bar');
  });

  it('keeps two same-shaped zones with different names as separate rows', () => {
    // Keyed on shape alone, one of these vanished from the key entirely.
    const legend = planLegend([el('bar', 'a', 'Champagne Bar'), el('bar', 'b', 'Coffee Bar')]);
    expect(legend.map((z) => z.label)).toEqual(['Champagne Bar', 'Coffee Bar']);
    expect(legend.every((z) => z.count === 1)).toBe(true);
  });

  it('gives every row a unique key, so none is dropped in render', () => {
    const legend = planLegend([el('bar', 'a', 'Champagne Bar'), el('bar', 'b', 'Coffee Bar'), el('stage', 'c')]);
    expect(new Set(legend.map((z) => z.key)).size).toBe(legend.length);
  });

  it('is empty for a room with no zones, so no empty bar is rendered', () => {
    expect(planLegend([{ id: 'a', shape: 'round' }])).toEqual([]);
    expect(planLegend(null)).toEqual([]);
  });
});

describe('zoneLabel', () => {
  const stage = { id: 'z', shape: 'stage', element_type: 'zone', table_name: 'Stage' };
  const box = (x, y, w, h) => ({ x, y, w, h });

  it('names a zone that is drawn large enough to read', () => {
    expect(zoneLabel(stage, box(0, 0, 420, 150), 1).text).toBe('Stage');
  });

  it('stays silent on a zone too small for the name to be read', () => {
    // The thumbnail under a QR code: the same stage at 65×23 screen px.
    expect(zoneLabel(stage, box(0, 0, 65, 23), 1)).toBe(null);
  });

  it('measures in SCREEN pixels, not the caller units', () => {
    /**
     * The bug this pins: SeatingMapFullscreen draws in world px inside one
     * `scale(view.scale)` layer, so a label sized against world units renders
     * at a fraction of it. Handed the same box at a scale of 0.05, the name has
     * to be refused — it would be under a pixel tall on the guest's screen.
     */
    expect(zoneLabel(stage, box(0, 0, 420, 150), 1)).toBeTruthy();
    expect(zoneLabel(stage, box(0, 0, 420, 150), 0.05)).toBe(null);
  });

  it("returns the size in the CALLER's units, so it draws at the size it chose", () => {
    // scale 0.5 means the returned size, once the layer scales it, lands back
    // on the screen size the fit was decided against.
    const at1 = zoneLabel(stage, box(0, 0, 420, 150), 1);
    const atHalf = zoneLabel(stage, box(0, 0, 420, 150), 0.5);
    expect(atHalf.size).toBeCloseTo(at1.size * 2, 5);
  });

  it('shrinks the type for a longer name rather than letting it spill', () => {
    // 150 wide, so the NAME is what binds. On a roomier box both names hit the
    // same ceiling — the label is capped so a hall outline cannot be given a
    // headline — and comparing them there would be comparing the cap to itself.
    const short = zoneLabel({ ...stage, table_name: 'Bar' }, box(0, 0, 150, 92), 1);
    const long = zoneLabel({ ...stage, table_name: 'Champagne Bar' }, box(0, 0, 150, 92), 1);
    expect(long.size).toBeLessThan(short.size);
  });

  it('never speaks for a table, only a zone', () => {
    expect(zoneLabel({ id: 't', shape: 'round', element_type: 'table', table_name: '12' }, box(0, 0, 400, 400), 1)).toBe(null);
  });

  it('falls back to the catalogue label when the host never named it', () => {
    expect(zoneLabel({ id: 'z', shape: 'dance_floor', element_type: 'zone' }, box(0, 0, 300, 240), 1).text)
      .toBe('Dance Floor');
  });

  /* ── placement: a zone is drawn UNDER the tables, so its name has to move ── */

  it('centres the name when nothing is on the zone', () => {
    expect(zoneLabel(stage, box(0, 0, 420, 150), 1, []).justify).toBe('center');
  });

  it('moves the name off a table sitting in the middle of the zone', () => {
    // A cocktail table on the dance floor: dead centre, so the centred name
    // would print as "DANCE FL(table)OR".
    const dance = { id: 'z', shape: 'dance_floor', element_type: 'zone', table_name: 'Dance Floor' };
    const placedOnTop = [{ x: 100, y: 90, w: 96, h: 96 }];
    const label = zoneLabel(dance, box(0, 0, 300, 260), 1, placedOnTop);
    expect(label).toBeTruthy();
    expect(label.justify).not.toBe('center');
  });

  it('drops the name rather than printing half of it', () => {
    // A table wide enough to cover every band. Half a venue name is worse than
    // none — the guest reads it as a different room — and the legend still
    // names the zone underneath the plan.
    const covered = [{ x: -50, y: -50, w: 500, h: 260 }];
    expect(zoneLabel(stage, box(0, 0, 420, 150), 1, covered)).toBe(null);
  });

  it('ignores a table that misses the zone entirely', () => {
    const elsewhere = [{ x: 2000, y: 2000, w: 96, h: 96 }];
    expect(zoneLabel(stage, box(0, 0, 420, 150), 1, elsewhere).justify).toBe('center');
  });

  it('tests the obstacles where the zone actually is, not at the origin', () => {
    // The box carries x/y for exactly this reason: a zone at (800, 400) with a
    // table on it must collide, and a naive origin-relative test would not.
    const onIt = [{ x: 900, y: 440, w: 96, h: 96 }];
    const away = zoneLabel(stage, box(0, 0, 420, 150), 1, onIt);
    const onTop = zoneLabel(stage, box(800, 400, 420, 150), 1, onIt);
    expect(away.justify).toBe('center');
    expect(onTop === null || onTop.justify !== 'center').toBe(true);
  });
});

describe('labelObstacles', () => {
  it('is the tables, because they are what is drawn over a zone', () => {
    const out = labelObstacles([
      { el: { shape: 'round', element_type: 'table' }, x: 1, y: 2, w: 96, h: 96 },
      { el: { shape: 'stage', element_type: 'zone' }, x: 0, y: 0, w: 400, h: 150 },
    ]);
    expect(out).toEqual([{ x: 1, y: 2, w: 96, h: 96 }]);
  });

  it('survives no elements at all', () => {
    expect(labelObstacles(null)).toEqual([]);
  });
});
