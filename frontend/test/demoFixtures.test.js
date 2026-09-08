import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildDemoEvent, eventInstant, rsvpDeadlineInstant, DEMO_MEALS, DEMO_SLUG,
} from '../src/app/demo/fixtures/demoEvent.mjs';
import {
  answerFor, demoGuests, demoGuestsApi, demoAnalytics, demoDashboard,
  demoEvents, DEMO_TABLES, DEMO_TIER_FEATURES,
} from '../src/app/demo/fixtures/demoOrganizer.mjs';
import { findMealField } from '../src/app/utils/mealField';
import { isSeatingRevealed } from '../src/app/utils/seating';

/* ═══════════════════════════════════════════════════════════════════════════
   THE FIXTURE HAS TO SATISFY THE COMPONENTS, NOT A PLAUSIBLE IDEA OF THEM.

   The failure this file exists to catch is documented in the video pipeline
   and has happened twice: every AGGREGATE correct and every INDIVIDUAL
   blank. Forty guests, the right counts on every tile, and forty cards
   reading "?" and "NO NUMBER", because the components read `guest_name` and
   the fixture supplied `label`.

   Nothing about that is visible in the data. It is only visible on screen,
   and only if somebody looks at the right screen. So the field names the
   mounted components actually read are asserted here, one by one.
   ═══════════════════════════════════════════════════════════════════════════ */

const SRC = path.join(process.cwd(), 'src', 'app');
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');

describe('the demo wedding never goes stale', () => {
  it('is far enough out that the countdown, the deadline and the form all work', () => {
    const event = buildDemoEvent();
    expect(new Date(event.event_date).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(event.rsvp_deadline).getTime()).toBeGreaterThan(Date.now());
  });

  it('stays outside the seating window, so the confirmation makes no lookup', () => {
    /* isSeatingRevealed unlocks at event start − 24h, and RsvpSection fetches
       a guest's table the moment it does. The demo has no server to answer
       that call, so the date is not a taste decision — it is the reason there
       is a boundary. */
    expect(isSeatingRevealed(buildDemoEvent().event_date)).toBe(false);
  });

  it('computes both dates from one instant, so they can never disagree', () => {
    const now = Date.UTC(2030, 0, 1);
    expect(rsvpDeadlineInstant(now).getTime()).toBeLessThan(eventInstant(now).getTime());
    expect(buildDemoEvent({ now }).event_date).toBe(eventInstant(now).toISOString());
  });

  it('renders the same event on the server and in the browser', () => {
    /* Floored to UTC midnight. Two Date.now() readings milliseconds apart
       would otherwise produce two different countdowns and a hydration
       mismatch on the one page that has to look effortless. */
    const a = buildDemoEvent({ now: Date.UTC(2030, 0, 1, 3, 15, 42, 118) });
    const b = buildDemoEvent({ now: Date.UTC(2030, 0, 1, 19, 4, 9, 771) });
    expect(a.event_date).toBe(b.event_date);
  });
});

describe('every control on the customize stage is wired to a real field', () => {
  it('turns the meal question on and off by adding or removing the field', () => {
    const on = buildDemoEvent({ meals: DEMO_MEALS });
    expect(findMealField(on.custom_form_fields)?.options).toEqual(DEMO_MEALS);

    /* Removed, not emptied. A flagged meal field with no options renders a
       required select that nobody can answer. */
    const off = buildDemoEvent({ meals: [] });
    expect(findMealField(off.custom_form_fields)).toBeUndefined();
  });

  it('sets the adults-only flag RsvpSection actually reads', () => {
    expect(buildDemoEvent({ noKids: true }).no_kids_allowed).toBe(true);
    expect(buildDemoEvent({ noKids: false }).no_kids_allowed).toBe(false);
  });

  it('offers no control the product does not have', () => {
    /* The stage was first sketched around an "allow plus-ones" toggle.
       RsvpSection renders its party stepper unconditionally and nothing in
       the frontend reads max_party_size, so the control would have
       demonstrated a setting that does not exist. If one is ever added, this
       fails and the demo gets to grow a real fourth switch. */
    const frontend = ['components/templates/heritageArch/sections/RsvpSection.js', '[slug]/rsvp/RsvpWizard.js']
      .map(read).join('\n');
    expect(frontend).not.toMatch(/max_party_size|allow_plus_ones/);
  });
});

describe('the guest list satisfies the screens that render it', () => {
  const guests = demoGuests();

  it('gives every guest the fields the cards print', () => {
    /* `guest_name`, not `label` — the API shape is what dashboard/page.js
       MAPS FROM, and these rows are handed straight to the components. */
    guests.forEach((g) => {
      expect(g.guest_name, 'a card with no name prints "?"').toBeTruthy();
      expect(g.email).toBeTruthy();
      expect(g.phone).toBeTruthy();
      expect(g.id).toBeTruthy();
      expect(typeof g.party_size).toBe('number');
      // camelCase. The snake_case one renders every seated guest "No Table".
      expect(g).toHaveProperty('tableId');
    });
  });

  it('names every person in every party', () => {
    // A party row without full_name prints the literal "Unnamed guest".
    guests.forEach((g) => {
      expect(g.guests.length).toBeGreaterThan(0);
      g.guests.forEach((row) => expect(row.full_name).toBeTruthy());
      expect(g.guests.filter((r) => r.is_primary_contact)).toHaveLength(1);
    });
  });

  it('has a party size that agrees with the party', () => {
    guests.filter((g) => g.response === 'yes')
      .forEach((g) => expect(g.guests).toHaveLength(g.party_size));
  });

  it('has replies of every kind, so no screen is a single empty state', () => {
    const by = (r) => guests.filter((g) => g.response === r).length;
    expect(by('yes')).toBeGreaterThan(0);
    expect(by('no')).toBeGreaterThan(0);
    expect(guests.filter((g) => !g.response).length).toBeGreaterThan(0);
  });

  it('leaves somebody unseated, so the seating screen has a job to do', () => {
    const accepted = guests.filter((g) => g.response === 'yes');
    expect(accepted.some((g) => !g.tableId)).toBe(true);
    expect(accepted.some((g) => g.tableId)).toBe(true);
  });

  it('derives the API shape from the component shape rather than beside it', () => {
    const api = demoGuestsApi();
    expect(api).toHaveLength(guests.length);
    expect(api[0].label).toBe(guests[0].guest_name);
    // Contact details on the primary row only — the product's own rule.
    const primary = api[0].guests.find((r) => r.is_primary_contact);
    expect(primary.email).toBe(guests[0].email);
    expect(api[0].guests.filter((r) => !r.is_primary_contact).every((r) => r.email === null)).toBe(true);
  });
});

describe('the room can actually be seated', () => {
  it('names every table with the key the chart reads', () => {
    // `table_name`, not `name`: the wrong one renders unlabelled circles.
    DEMO_TABLES.forEach((t) => {
      expect(t.table_name).toBeTruthy();
      expect(typeof t.max_capacity).toBe('number');
      expect(t.max_capacity).toBeGreaterThan(0);
    });
  });

  it('leaves room at more than one table', () => {
    /* SeatingManager renders each option as max_capacity − occupied and
       disables it at zero. A fixture whose tables are all full offers a
       seating screen on which nobody can be seated. */
    const occupancy = (tableId) => demoGuests()
      .filter((g) => g.response === 'yes' && g.tableId === tableId)
      .reduce((n, g) => n + g.party_size, 0);
    const withRoom = DEMO_TABLES.filter((t) => t.max_capacity - occupancy(t.id) > 0);
    expect(withRoom.length).toBeGreaterThan(1);
  });
});

describe('the overview and analytics screens render full, not empty', () => {
  it('has events, or the whole overview is replaced by the first-run panel', () => {
    // OrganizerOverview: totalEvents === 0 renders <FirstRun /> and nothing else.
    expect(demoDashboard().dashboard.totalEvents).toBeGreaterThan(0);
    expect(demoEvents().length).toBeGreaterThan(1);
  });

  it('uses the API key names OrganizerOverview remaps from', () => {
    // acceptedCount, not accepted — the component maps one to the other, and
    // supplying the mapped names leaves every card and the donut at zero.
    const o = demoDashboard().dashboard.rsvpOverview;
    expect(o.acceptedCount + o.declinedCount + o.pendingCount).toBeGreaterThan(0);
  });

  it('keys the analytics timeline on `date`, which is what the page reads', () => {
    /* The page computes its own label with formatDay(t.date), and
       formatDay(undefined) is the empty string — so a `label` here renders a
       chart with every day on its x-axis blank. */
    demoAnalytics().timeline.forEach((row) => {
      expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row).not.toHaveProperty('label');
    });
  });

  it('uses engagement keys the analytics page has a sentence for', () => {
    // Asserted against the page's OWN map, read from source, because it is
    // not exported. An unrecognised key does not error — it prints raw, so a
    // chart reads "saved_the_date" instead of "Added to calendar".
    const src = read('dashboard/analytics/page.js');
    const block = src.slice(src.indexOf('const ENGAGEMENT_LABELS'), src.indexOf('};', src.indexOf('const ENGAGEMENT_LABELS')));
    const known = [...block.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
    expect(known.length).toBeGreaterThan(3);
    Object.keys(demoAnalytics().engagementActions).forEach((key) => {
      expect(known, `"${key}" would print as a raw key`).toContain(key);
    });
  });

  it('reports a funnel and a reveal with something in them', () => {
    const a = demoAnalytics();
    expect(a.advanced).toBe(true);
    expect(a.reveal.shown).toBeGreaterThan(0);
    expect(a.funnel.some((s) => s.count > 0)).toBe(true);
  });
});

describe('the plan is described the way FeatureGate reads it', () => {
  it('is a plain array of key strings', () => {
    /* Not an object, and NOT a Proxy answering true to everything.
       FeatureGate's first line is `Array.isArray(tierFeatures) ? … : []`, so
       anything else collapses to empty and padlocks every control it was
       meant to open — which is what the video probe did for months while its
       comment claimed the opposite. */
    expect(Array.isArray(DEMO_TIER_FEATURES)).toBe(true);
    DEMO_TIER_FEATURES.forEach((k) => expect(typeof k).toBe('string'));
    expect(DEMO_TIER_FEATURES).toContain('seating_map');
  });

  it('withholds at least one feature, so a padlock in the demo is honest', () => {
    // The fixture's plan is Premium. Excel export belongs to the tier above,
    // and showing that lock is truer than unlocking everything.
    expect(DEMO_TIER_FEATURES).not.toContain('guest_export_excel');
  });
});

describe('the router answers what the screens ask for', () => {
  it('serves every authenticated path the four screens fetch', () => {
    expect(answerFor('/dashboard').dashboard).toBeTruthy();
    expect(answerFor('/events').events.length).toBeGreaterThan(0);
    expect(answerFor('/events/demo-nadia-omar').event.slug).toBe(DEMO_SLUG);
    expect(answerFor('/events/demo-nadia-omar/analytics').analytics.overview).toBeTruthy();
    expect(answerFor('/events/demo-nadia-omar/rsvps').data.rsvps.length).toBeGreaterThan(0);
    expect(answerFor('/events/demo-nadia-omar/tables').tables.length).toBeGreaterThan(0);
    expect(answerFor('/auth/profile').user).toBeTruthy();
  });

  it('returns the guest list in the envelope the caller unwraps', () => {
    // dashboard/page.js reads first.data.rsvps and
    // first.meta.pagination.total, never a top-level array.
    const res = answerFor('/events/demo-nadia-omar/rsvps');
    expect(res.meta.pagination.total).toBe(res.data.rsvps.length);
  });

  it('strips a full URL down to a path, so the film can call it too', () => {
    expect(answerFor('http://localhost:5000/api/v1/dashboard').dashboard).toBeTruthy();
  });

  it('declines /public, and answers everything else harmlessly', () => {
    expect(answerFor('/public/shop')).toBeUndefined();
    expect(answerFor('/something/nobody/planned')).toEqual({ success: true });
  });
});
