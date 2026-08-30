import { describe, it, expect } from 'vitest';
import {
  paperBox, compareTableNames, buildRoster, buildGuestIndex, groupIndexRows,
  numeralSizeFor, countSizeFor, PAGE_MARGIN_MM,
} from '../src/app/dashboard/seating-map/SeatingChartPrint';

/* ═══════════════════════════════════════════════════════════════════════════
   WHAT THE PRINTED SEATING PACK IS ALLOWED TO SAY.

   This is the document somebody stands at a door holding. Every assertion here
   is about a way it could be quietly, confidently WRONG — which is worse than
   ugly, because nobody checks a printed chart against the database at 9pm.

   The bugs these pin are all real ones from the version this replaced.
   ═══════════════════════════════════════════════════════════════════════════ */

const table = (id, name, cap = 10) => ({
  id, table_name: name, shape: 'round', element_type: 'table', max_capacity: cap,
  position_x: 10, position_y: 10,
});
const zone = (id, name, shape = 'bar') => ({
  id, table_name: name, shape, element_type: 'zone', position_x: 20, position_y: 20,
});

describe('paperBox', () => {
  it('turns paper and orientation into a real page box', () => {
    const a4l = paperBox('a4', 'landscape');
    expect(a4l.w).toBe(297);
    expect(a4l.h).toBe(210);
    expect(a4l.contentW).toBe(297 - PAGE_MARGIN_MM * 2);
    expect(a4l.contentH).toBe(210 - PAGE_MARGIN_MM * 2);

    const a4p = paperBox('a4', 'portrait');
    expect(a4p.w).toBe(210);
    expect(a4p.h).toBe(297);
  });

  it('knows US Letter, and falls back rather than producing NaN', () => {
    expect(paperBox('letter', 'portrait').w).toBeCloseTo(215.9, 5);
    // A stored value from a future release, or a typo: a page box of NaN
    // millimetres lays the whole document out at zero height.
    expect(paperBox('foolscap', 'landscape').w).toBe(297);
  });
});

describe('compareTableNames', () => {
  it('sorts table 2 before table 10', () => {
    expect(['10', '2', '1'].sort(compareTableNames)).toEqual(['1', '2', '10']);
  });

  it('puts numbered tables before named ones', () => {
    expect(['Head Table', '3'].sort(compareTableNames)).toEqual(['3', 'Head Table']);
  });
});

describe('buildRoster', () => {
  const elements = [table('t1', '2'), table('t2', '10'), table('t3', '1'), zone('z1', 'Bar')];
  const partiesByTable = {
    t1: [{ id: 'p1', name: 'Ahmed Hassan', size: 4 }, { id: 'p2', name: 'Bea Okoro', size: 2 }],
    t3: [{ id: 'p3', name: 'Zara Ali', size: 1 }],
  };

  it('is tables only, in table order', () => {
    const roster = buildRoster(elements, partiesByTable, {}, {});
    expect(roster.map((t) => t.name)).toEqual(['1', '2', '10']);
  });

  it('keeps EMPTY tables on the sheet', () => {
    // The old export filtered these out, so the roster and the floor plan
    // printed on the same page disagreed about how many tables the room had —
    // and the host lost the one line that says where a late arrival can go.
    const roster = buildRoster(elements, partiesByTable, {}, {});
    const t2 = roster.find((t) => t.name === '10');
    expect(t2).toBeTruthy();
    expect(t2.parties).toEqual([]);
    expect(t2.seated).toBe(0);
  });

  it('counts PEOPLE, not reservations', () => {
    // THE number that mattered most. A party row is one RSVP that may cover
    // four people; counting rows printed "2" against a table with six chairs
    // taken, on the one document nobody cross-checks.
    const roster = buildRoster(elements, partiesByTable, {}, {});
    expect(roster.find((t) => t.name === '2').seated).toBe(6);
  });

  it('prefers the editor\'s live occupancy when it is supplied', () => {
    // occByTable already folds in seat moves the organizer has staged but not
    // saved. Printing the un-staged number would contradict the screen they are
    // looking at while they print.
    const roster = buildRoster(elements, partiesByTable, { t1: 9 }, {});
    expect(roster.find((t) => t.name === '2').seated).toBe(9);
  });

  it('sorts the parties at a table by name', () => {
    const roster = buildRoster(elements, partiesByTable, {}, {});
    expect(roster.find((t) => t.name === '2').parties.map((p) => p.name))
      .toEqual(['Ahmed Hassan', 'Bea Okoro']);
  });

  it('attaches each party\'s member names when they are known', () => {
    const roster = buildRoster(elements, partiesByTable, {}, {
      p1: ['Ahmed Hassan', 'Sara Hassan', 'Omar Hassan', 'Lina Hassan'],
    });
    expect(roster.find((t) => t.name === '2').parties[0].members).toHaveLength(4);
  });

  it('survives no data at all', () => {
    expect(buildRoster(null, null, null, null)).toEqual([]);
    expect(buildRoster(elements, null, null, null).every((t) => t.parties.length === 0)).toBe(true);
  });
});

describe('buildGuestIndex', () => {
  const elements = [table('t1', '2'), table('t2', '7')];
  const partiesByTable = {
    t1: [{ id: 'p1', name: 'Ahmed Hassan', size: 4 }],
    t2: [{ id: 'p2', name: 'bea okoro', size: 1 }],
  };
  const unseated = [{ id: 'p3', name: 'Carla Diaz', size: 3 }];

  it('lists every PERSON under their own name when the members are known', () => {
    // The door hears a name, not a booking. A companion arriving before the
    // host was previously findable under nothing at all.
    const roster = buildRoster(elements, partiesByTable, {}, {});
    const rows = buildGuestIndex(roster, [], {
      p1: ['Ahmed Hassan', 'Sara Hassan', 'Omar Hassan', 'Lina Hassan'],
    });
    const sara = rows.find((r) => r.name === 'Sara Hassan');
    expect(sara).toBeTruthy();
    expect(sara.table).toBe('2');
    expect(rows.filter((r) => r.table === '2')).toHaveLength(4);
  });

  it('falls back to the party label, marked with the extra heads', () => {
    const roster = buildRoster(elements, partiesByTable, {}, {});
    const rows = buildGuestIndex(roster, [], {});
    const ahmed = rows.find((r) => r.name === 'Ahmed Hassan');
    expect(ahmed.extra).toBe(3);
    expect(ahmed.table).toBe('2');
  });

  it('includes people with no table, rather than omitting them', () => {
    const roster = buildRoster(elements, partiesByTable, {}, {});
    const rows = buildGuestIndex(roster, unseated, {});
    const carla = rows.find((r) => r.name === 'Carla Diaz');
    expect(carla).toBeTruthy();
    expect(carla.table).toBe(null);
  });

  it('sorts case-insensitively, so a lowercase name is not exiled to the end', () => {
    const roster = buildRoster(elements, partiesByTable, {}, {});
    const rows = buildGuestIndex(roster, unseated, {});
    expect(rows.map((r) => r.name)).toEqual(['Ahmed Hassan', 'bea okoro', 'Carla Diaz']);
  });

  it('gives every row a stable, unique key', () => {
    // Two members of one party, or two parties with the same label, must not
    // collide into a single React key and drop a guest from the printed list.
    const roster = buildRoster(elements, partiesByTable, {}, {});
    const rows = buildGuestIndex(roster, unseated, {
      p1: ['Ahmed Hassan', 'Sara Hassan'],
    });
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it('keeps both guests when one party contains the same name twice', () => {
    // A father and son, or two rows imported as "Guest". A name-based key
    // collides here, React renders one of them, and a real person is missing
    // from the only alphabetical list at the door.
    const roster = buildRoster(elements, partiesByTable, {}, {});
    const rows = buildGuestIndex(roster, [], { p1: ['Omar Diaz', 'Omar Diaz'] });
    const omars = rows.filter((r) => r.name === 'Omar Diaz');
    expect(omars).toHaveLength(2);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });
});

describe('groupIndexRows', () => {
  it('groups by initial, in the order the rows arrive', () => {
    const groups = groupIndexRows([
      { key: 'a', name: 'Ahmed' }, { key: 'b', name: 'Amira' }, { key: 'c', name: 'Bea' },
    ]);
    expect(groups.map((g) => g.letter)).toEqual(['A', 'B']);
    expect(groups[0].rows).toHaveLength(2);
  });

  it('groups an Arabic name under its own letter, not under #', () => {
    // ا, not أ. The same diacritic folding that files Émile under E files every
    // form of alef — أ, إ, آ, ا — under bare alef, which is how an Arabic index
    // is ordered anyway. Without it, a guest list of أحمد / احمد / إبراهيم
    // printed three separate one-name groups.
    const groups = groupIndexRows([{ key: 'a', name: 'أحمد حسن' }]);
    expect(groups[0].letter).toBe('ا');
  });

  it('files every form of alef in the same group', () => {
    const groups = groupIndexRows([
      { key: 'a', name: 'أحمد حسن' },
      { key: 'b', name: 'احمد منصور' },
      { key: 'c', name: 'إبراهيم فؤاد' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(3);
  });

  it('collects anything that is not a letter under #', () => {
    const groups = groupIndexRows([{ key: 'a', name: '3rd Floor Party' }, { key: 'b', name: '' }]);
    expect(groups.map((g) => g.letter)).toEqual(['#']);
    expect(groups[0].rows).toHaveLength(2);
  });

  it('files an accented name under its base letter, in ONE group', () => {
    // buildGuestIndex sorts with sensitivity 'base', so É sorts among the Es.
    // Grouping on the raw character split that run into E / É / E — two groups
    // keyed "E", a duplicate React key, and one group's guests not rendered at
    // all. There must be exactly one E group, and it must hold all three.
    const groups = groupIndexRows([
      { key: 'a', name: 'Emile Okoro' },
      { key: 'b', name: 'Émile Rahman' },
      { key: 'c', name: 'Eva Sultan' },
    ]);
    expect(groups.map((g) => g.letter)).toEqual(['E']);
    expect(groups[0].rows).toHaveLength(3);
    expect(new Set(groups.map((g) => g.letter)).size).toBe(groups.length);
  });
});

describe('plan label sizing', () => {
  const t = (w, h, cap = 10) => ({ shape: 'round', element_type: 'table', max_capacity: cap, width: w, height: h });

  it('sets a short numeral larger than a long one, in the same table', () => {
    // The whole reason planNumeral exists: two characters can be set far bigger
    // than three in the same circle.
    expect(numeralSizeFor(t(96, 96), '12')).toBeGreaterThan(numeralSizeFor(t(96, 96), 'RGB'));
  });

  it('stays inside the legibility band for every table in the catalogue', () => {
    // Tables take their size from the shape catalogue, never from stored
    // width/height, so this covers every table that can exist.
    for (const shape of ['round', 'oval', 'square', 'rectangle', 'banquet', 'head']) {
      for (const numeral of ['1', '12', 'A12']) {
        const size = numeralSizeFor({ shape, element_type: 'table' }, numeral);
        expect(size, `${shape} / ${numeral}`).toBeGreaterThanOrEqual(24);
        expect(size, `${shape} / ${numeral}`).toBeLessThanOrEqual(46);
      }
    }
  });

  it('keeps the occupancy line clearly smaller than the numeral it sits under', () => {
    const n = numeralSizeFor(t(96, 96), '5');
    expect(countSizeFor(n)).toBeLessThan(n * 0.6);
    expect(countSizeFor(n)).toBeGreaterThan(n * 0.3);
  });
});
