import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import SeatingChartPrintModal from '../src/app/dashboard/seating-map/SeatingChartPrint';

/* ═══════════════════════════════════════════════════════════════════════════
   SOMETHING ACTUALLY RENDERS THE PRINT PREVIEW.

   This is the hole the whole feature keeps falling through. The preview has now
   shipped completely dead TWICE for reasons that no build and no linter could
   see, and both times the suite was green because not one test had ever
   rendered the component:

     • 2026-08-26 — a top-level function read `eventTimezone`, a page-component
       local it never received, and threw ReferenceError on every render.
     • during this rebuild — the `React` import was removed as apparently dead
       code. Next compiles this file with the automatic JSX runtime so the app
       build stayed green, but vitest's esbuild pass uses the CLASSIC transform,
       where every element is `React.createElement`. Same error, same silence.

   `seatingPrintScope.test.js` reasons about the source text, which is a good
   guard and a fundamentally indirect one. This file just renders the thing. Any
   throw anywhere in the modal — a missing prop, a missing import, a bad
   destructure — fails here immediately and by name.

   The assertions afterwards are about the document being USABLE on the night:
   the pack has to name the event, find a guest by name, and account for someone
   who has no table. Those three are what the sheets are carried for.
   ═══════════════════════════════════════════════════════════════════════════ */

const elements = [
  {
    id: 't1', table_name: '1', shape: 'round', element_type: 'table',
    max_capacity: 10, position_x: 20, position_y: 30,
  },
  {
    id: 't2', table_name: '2', shape: 'rectangle', element_type: 'table',
    max_capacity: 10, position_x: 50, position_y: 30,
  },
  {
    id: 'z1', table_name: 'Dance Floor', shape: 'dance_floor', element_type: 'zone',
    width: 300, height: 260, position_x: 35, position_y: 60,
  },
];

const partiesByTable = {
  t1: [{ id: 'p1', name: 'Ahmed Hassan', size: 3 }],
  t2: [{ id: 'p2', name: 'Bea Okoro', size: 1 }],
};
const membersByParty = {
  p1: ['Ahmed Hassan', 'Sara Hassan', 'Omar Hassan'],
  p2: ['Bea Okoro'],
};
const unseatedParties = [{ id: 'p3', name: 'Carla Diaz', size: 2 }];

function renderPack(overrides = {}) {
  return render(
    <SeatingChartPrintModal
      eventTitle="Nour & Adam"
      eventDate="2026-09-19T17:00:00.000Z"
      eventTimezone="Africa/Cairo"
      organizerName="Nour Mansour"
      elements={elements}
      partiesByTable={partiesByTable}
      unseatedParties={unseatedParties}
      membersByParty={membersByParty}
      occByTable={{ t1: 3, t2: 1 }}
      summary={{ attendingGuests: 6, seatedGuests: 4, unseatedGuests: 2 }}
      membersLoading={false}
      onClose={() => {}}
      {...overrides}
    />,
  );
}

/** The modal portals to <body>, so assertions read the document, not the container. */
const text = () => document.body.textContent;

describe('the seating pack renders', () => {
  afterEach(cleanup);

  it('mounts without throwing', () => {
    expect(() => renderPack()).not.toThrow();
    expect(document.querySelector('.ppm-overlay')).toBeTruthy();
  });

  it('names the event on the sheet', () => {
    renderPack();
    expect(text()).toContain('Nour & Adam');
    expect(text()).toContain('Prepared for Nour Mansour');
  });

  it('draws the plan, with a numeral per table', () => {
    renderPack();
    const svg = document.querySelector('.psc-plan-figure svg');
    expect(svg).toBeTruthy();
    const marks = [...svg.querySelectorAll('text')].map((t) => t.textContent);
    expect(marks).toContain('1');
    expect(marks).toContain('2');
  });

  it('finds a companion by their own name in the index', () => {
    // The reason the index exists: the door hears "Sara", not the booking.
    renderPack();
    expect(text()).toContain('Sara Hassan');
  });

  it('accounts for a guest who has no table yet', () => {
    renderPack();
    expect(text()).toContain('Awaiting a Table');
    expect(text()).toContain('Carla Diaz');
  });

  it('still renders when the optional data has not arrived', () => {
    // membersByParty is fetched lazily and can legitimately be null; occByTable
    // and summary can be missing on a slow first paint. None of them may take
    // the sheet down with them.
    expect(() => renderPack({
      membersByParty: null,
      occByTable: undefined,
      summary: undefined,
      unseatedParties: undefined,
      organizerName: '',
      eventDate: null,
    })).not.toThrow();
    expect(text()).toContain('Ahmed Hassan');
  });

  it('tells the organizer what to do instead of drawing an empty room', () => {
    renderPack({ elements: [] });
    expect(text()).toContain('Add at least one table or zone');
  });

  it('writes an @page rule for the chosen paper', () => {
    // The page size cannot be an inline style, so it is a real stylesheet rule
    // written at runtime. Without it the pack prints on whatever the browser
    // defaults to, which is portrait Letter — the plan sideways on the page.
    renderPack();
    const style = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    expect(style).toMatch(/@page\s*\{\s*size:\s*A4 landscape/);
  });
});
