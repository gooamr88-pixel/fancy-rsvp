import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/* ═══════════════════════════════════════════════════════════════════════════
   THE DEMO MUST NOT DRAW THE PRODUCT A SECOND TIME.

   This repo has already paid for that mistake at scale: the homepage carried
   ~1,900 lines of hand-drawn imitations of its own dashboard and RSVP flow —
   a fake guest list, four fake phone screens — all of which could drift from
   the software they depicted, and did. They were deleted, and the preview
   components that replaced them carry the rule in their headers: "this file
   must never draw anything."

   A demo is the most tempting place in a codebase to break that rule, because
   nobody logs into it and nothing it shows has to be true. So the rule is
   asserted here rather than left to good intentions.

   These are source-text assertions, which is a blunt instrument — but the
   thing being protected is an architectural promise, not a behaviour, and a
   rendering test cannot tell a real component from a convincing copy of one.
   ═══════════════════════════════════════════════════════════════════════════ */

const DEMO = path.join(process.cwd(), 'src', 'app', 'demo');
const read = (rel) => fs.readFileSync(path.join(DEMO, rel), 'utf8');

/** Every file under src/app/demo, so a new one cannot slip past these. */
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}

describe('stage 2 mounts the organizer\'s real screens', () => {
  const page = read(path.join('dashboard', 'page.js'));

  it('renders the four screens from the dashboard itself', () => {
    /* If any of these stops being an import from ../../dashboard, somebody
       has started drawing a dashboard inside the demo. */
    expect(page).toMatch(/import OrganizerOverview from '\.\.\/\.\.\/dashboard\/components\/OrganizerOverview'/);
    expect(page).toMatch(/import GuestsTab from '\.\.\/\.\.\/dashboard\/components\/GuestsTab'/);
    expect(page).toMatch(/import SeatingManager from '\.\.\/\.\.\/dashboard\/components\/SeatingManager'/);
    expect(page).toMatch(/import SeatingProgress from '\.\.\/\.\.\/dashboard\/components\/SeatingProgress'/);
    expect(page).toMatch(/import AnalyticsPage from '\.\.\/\.\.\/dashboard\/analytics\/page'/);
  });

  it('hands FeatureGate a real array, not an object pretending to be one', () => {
    /* `Array.isArray(tierFeatures) ? tierFeatures : []` is FeatureGate's
       first line, so a Proxy answering true to everything collapses to empty
       and padlocks every control it was meant to open. The video probe did
       exactly that for months while its comment claimed the opposite. */
    expect(page).toContain('tierFeatures={DEMO_TIER_FEATURES}');
    expect(page).not.toMatch(/new Proxy/);
  });

  it('gives every write path an inert handler or a stated refusal', () => {
    expect(page).toContain('demoMode');
    expect(page).toMatch(/onOpenImport=\{\(\) => demoBlocked/);
    expect(page).toMatch(/onOpenFloorPlan=\{\(\) => demoBlocked/);
  });
});

describe('stages 1 and 3 mount the guest page itself', () => {
  const invitation = read(path.join('invitation', 'page.js'));
  const customize = read(path.join('customize', 'page.js'));

  it('renders through GuestExperiencePreview, never a section directly', () => {
    [invitation, customize].forEach((src) => {
      expect(src).toMatch(/import GuestExperiencePreview from/);
      // Reaching into the template's own sections would be the first step
      // toward a second guest page.
      expect(src).not.toMatch(/heritageArch\/sections/);
    });
  });

  it('never fills the invitation with sample content', () => {
    /* `isPreview` invents hotels, an itinerary and a love story for empty
       sections. Right when an organizer is judging a bare template; wrong
       here, where the demo event has real content of its own and a visitor
       would be shown a page nobody could have written. */
    expect(invitation).toContain('showSampleContent={false}');
    expect(customize).toContain('showSampleContent={false}');
  });

  it('lets the RSVP complete only on the stage a visitor answers', () => {
    // Stage 1 completes locally; stage 3 does not, because the visitor has
    // already answered once and the question there is what the form LOOKS
    // like. No `simulate` on the customize stage.
    expect(invitation).toMatch(/\n\s*simulate\b/);
    expect(customize).not.toMatch(/\n\s*simulate\b/);
  });

  /* "the customize stage offers no control the product does not have" is
     asserted in demoFixtures.test.js, against RsvpSection and RsvpWizard —
     the files that would have to grow the setting — rather than here.

     It was written here first, as a grep over this file for "plus_one" and
     "max_party_size", and it failed on its first run: it matched the header
     comment that EXPLAINS why the plus-ones toggle was rejected. A check
     that cannot tell a comment from code is the kind this codebase has
     already thrown out once for a 100% false-positive rate. */
});

describe('the shell borrows the product\'s vocabulary', () => {
  it('reads the nav labels from the module the real sidebar reads', () => {
    const shell = read(path.join('components', 'DemoDashboardShell.js'));
    expect(shell).toMatch(/from '\.\.\/\.\.\/dashboard\/components\/dashboardNavItems'/);
    // "Guest list" and "Seating" are the product's words. Typing them here
    // would let the demo and the dashboard describe the same screen
    // differently.
    expect(shell).not.toMatch(/label: 'Guest list'|label: 'Seating'/);
  });

  it('takes its palette and type from the landing tokens', () => {
    walk(DEMO)
      .filter((f) => f.endsWith('.js') && /(page|Demo)/.test(path.basename(f)))
      .forEach((f) => {
        const src = fs.readFileSync(f, 'utf8');
        if (!/<style>/.test(src)) return;
        expect(src, `${path.basename(f)} re-declares brand colours`).toMatch(/landingTokens/);
      });
  });
});

describe('the demo cannot write', () => {
  it('has no fetch, no POST and no mutation anywhere under src/app/demo', () => {
    /* The whole surface is client-side against a fixture. A fetch appearing
       here means somebody has wired the demo to the real API, which is the
       one thing it must never do — a stranger's click would then land in a
       real organizer's data or fail loudly on their marketing page. */
    walk(DEMO).forEach((file) => {
      const src = fs.readFileSync(file, 'utf8');
      expect(src, `${path.relative(DEMO, file)} performs a request`)
        .not.toMatch(/\bfetch\s*\(|method:\s*'(POST|PUT|PATCH|DELETE)'/);
    });
  });
});
