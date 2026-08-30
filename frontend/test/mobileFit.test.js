import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ═══════════════════════════════════════════════════════════════════════════
   DOES THE ORGANIZER DASHBOARD FIT A PHONE?

   The dashboard has now been through two "make it responsive" passes. The first
   (2026-08-11) fixed the gutter and the fixed-column grids; the organizer's
   verdict afterwards was still "very terrible in mobile", and an audit found
   why — the loud failures were gone and the quiet, pervasive ones were
   untouched: two whole routes rendering edge-to-edge, 366 nowrap flex rows, and
   221 controls around 26px tall.

   None of that is visible to the existing greps in AGENTS.md, and none of it is
   visible to me at all: visual verification is off-limits on this project, so a
   browser is never going to catch the third regression either.

   So the rules become tests. Each one below encodes a specific, arithmetic
   property from AGENTS.md — not a style opinion — and each has an explicit
   allowlist rather than a threshold, so adding a violation is a deliberate act
   with a name attached rather than a number quietly ticking up.

   THE ARITHMETIC these enforce: inside an .fx-section a 320px viewport offers
   280px. A wrapping row's min-content is max(children); a NOWRAP row's is the
   SUM. That is the whole reason rule 2 exists — no amount of shrinking the
   children rescues a nowrap row.
   ═══════════════════════════════════════════════════════════════════════════ */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DASH = path.join(HERE, '..', 'src', 'app', 'dashboard');

/** Every .js under src/app/dashboard, as { rel, src }. */
function dashboardFiles(dir = DASH, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) dashboardFiles(full, out);
    else if (entry.name.endsWith('.js')) {
      out.push({
        rel: path.relative(DASH, full).replace(/\\/g, '/'),
        src: fs.readFileSync(full, 'utf8'),
      });
    }
  }
  return out;
}

const FILES = dashboardFiles();

/** Each `style={{ … }}` object in a file, flattened, with its line number. */
function styleObjects(src) {
  const out = [];
  for (const m of src.matchAll(/style=\{\{([\s\S]{0,600}?)\}\}/g)) {
    out.push({
      body: m[1].replace(/\s+/g, ' '),
      line: src.slice(0, m.index).split('\n').length,
      index: m.index,
    });
  }
  return out;
}

describe('the organizer dashboard fits a 320px phone', () => {
  /**
   * RULE 1 — every page root has a horizontal gutter.
   *
   * `.fx-container` deliberately carries NO padding (it assumes an `.fx-section`
   * above supplied one, see globals.css). On a /dashboard/* route there is
   * nothing above but `.dnav-content`, which sets margin-left and padding-bottom
   * only — so `.fx-container` alone means the page touches both screen edges.
   *
   * That is exactly what `campaigns` and `sms-plans` did: every card, heading and
   * back-link flush to the glass, on the two sections an organizer visits when
   * they are about to spend money.
   */
  it('no fx-container is left without a gutter', () => {
    const naked = [];

    for (const { rel, src } of FILES) {
      const lines = src.split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!/className=["`{][^"`}]*fx-container/.test(line)) return;
        if (/fx-gutter|fx-section/.test(line)) return;
        // An ancestor may pad instead — the seating map's `.sm-page` does. Only
        // the element's own tag is inspected, so those are listed by name.
        const tag = lines.slice(i, i + 4).join(' ');
        if (/padding(Left|Right|Inline)/.test(tag)) return;
        if (/padding: *['"`][^'"`]*\d+px +\d+px/.test(tag)) return;
        naked.push(`${rel}:${i + 1}`);
      });
    }

    /* Padded by an ancestor rather than by themselves. Named individually so
       that moving one out from under its parent fails this test. */
    const PADDED_BY_ANCESTOR = [
      'seating-map/page.js', // .sm-page: padding 24 → 12 under 639.98px
    ];

    expect(naked.filter((n) => !PADDED_BY_ANCESTOR.some((p) => n.startsWith(p)))).toEqual([]);
  });

  /**
   * RULE 2 — a horizontal flex row must be able to break.
   *
   * `flex-wrap: wrap` is the default in `.fx-row` "not an option" (globals.css),
   * because a nowrap row's min-content width is the SUM of its children's. A
   * three-button toolbar cannot fit 280px however small the buttons get; it
   * pushes the page sideways, and `html { overflow-x: clip }` then HIDES the
   * overflow rather than making it reachable.
   *
   * Only rows that actually carry several things are counted — a two-element
   * icon+label pair is not the failure mode. Columns are exempt: they cannot
   * overflow horizontally.
   */
  it('no multi-child horizontal flex row is unable to wrap', () => {
    const rigid = [];

    for (const { rel, src } of FILES) {
      for (const { body, line, index } of styleObjects(src)) {
        if (!/display: *['"]flex/.test(body)) continue;
        if (/flexDirection: *['"]column/.test(body)) continue;
        if (/flexWrap/.test(body)) continue;
        if (/overflowX/.test(body)) continue;          // scrolls instead, fine
        /**
         * A TRUNCATING PILL is bounded, and therefore not the failure mode.
         *
         * `textOverflow: 'ellipsis'` only works with nowrap and a clipped box,
         * and it always comes with a maxWidth — which caps the element's
         * min-content contribution outright, so it cannot push the page sideways
         * however long the text is. Making it wrap does not fix an overflow that
         * cannot happen; it breaks the ellipsis and drops the icon onto a second
         * line inside a 120px badge. (The blanket sweep did exactly that to the
         * guest list's meal badge, and this rule then demanded it stay broken.)
         */
        if (/textOverflow: *['"]ellipsis/.test(body)) continue;
        /**
         * A BUTTON IS A LEAF, NOT A TOOLBAR.
         *
         * A control's own icon and label must never wrap onto two lines — that
         * is not a layout adapting, it is a button coming apart. If a row of
         * buttons does not fit, the PARENT wraps and the buttons move as whole
         * units; that is what the rule above is for.
         *
         * The blanket sweep did not make this distinction and put
         * `flexWrap: 'wrap'` inside 58 buttons and links across the dashboard,
         * which is what "broken in mobile" turned out to mean in the guest-sheet
         * card. Exempted here so the guard cannot ask for them back.
         */
        const owner = src.slice(Math.max(0, index - 320), index);
        const tags = [...owner.matchAll(/<([A-Za-z][\w.]*)/g)].map((t) => t[1]);
        if (['button', 'a', 'Link'].includes(tags[tags.length - 1])) continue;
        /**
         * `.fx-row--scroll` is the sanctioned exception, and it has to be
         * recognised rather than budgeted.
         *
         * A few rows genuinely must stay on one line — a tab strip stops
         * reading as tabs the moment it stacks — and for those the answer is a
         * row that SCROLLS, not one that wraps. The class supplies
         * `flex-wrap: nowrap` plus the scroll port; adding `flexWrap: 'wrap'`
         * inline would beat it and undo exactly the thing it is there for.
         *
         * Matched on the element's own opening tag, so a scrolling ancestor
         * does not excuse a rigid row nested inside it.
         */
        if (/fx-row--scroll|fx-scroll-x/.test(src.slice(Math.max(0, index - 300), index))) continue;
        /**
         * gap OR justifyContent, not AND — and the difference is not academic.
         *
         * This test first required both, which sounded stricter and was the
         * opposite: it matched 43 rows out of a real 397, so it passed on the
         * day it was written over a dashboard nobody could use. A row with a gap
         * and no justify-content (a label beside a badge beside a button) is
         * exactly as rigid as one with both; requiring both only excused it.
         *
         * A bare `display:flex` with neither is left out, because that is
         * overwhelmingly a two-element alignment wrapper rather than a toolbar.
         */
        if (!/gap:/.test(body) && !/justifyContent/.test(body)) continue;
        rigid.push(`${rel}:${line}`);
      }
    }

    /**
     * The budget, per file, for rows this test has not yet been through.
     *
     * A count and not an ignore-list on purpose: it can only ever be lowered.
     * When a section is worked on, drop its number to what remains; when it
     * reaches zero, delete the line. Adding a rigid row to a finished file
     * fails immediately.
     */
    /**
     * EMPTY, AND IT SHOULD STAY EMPTY.
     *
     * This started at 397 — every horizontal flex row in the dashboard that
     * could not break, whose min-content is therefore the SUM of its children
     * and which no amount of shrinking makes fit a 320px screen. They are all
     * wrappable now, so the budget is a ratchet with nothing left in it.
     *
     * Wrapping is a no-op wherever the row already fits, which is why this
     * could be done in one pass: at desktop widths nothing moves, and on a
     * phone the rows that were pushing the page sideways now break instead.
     *
     * A file appearing here again is a regression, not a backlog item. The one
     * legitimate exception — a row that must stay on a single line — is
     * `.fx-row--scroll`, which the check above recognises directly.
     */
    const BUDGET = {};

    const counts = {};
    for (const r of rigid) {
      const f = r.slice(0, r.lastIndexOf(':'));
      counts[f] = (counts[f] || 0) + 1;
    }

    const over = Object.entries(counts)
      .filter(([f, n]) => n > (BUDGET[f] ?? 0))
      .map(([f, n]) => `${f}: ${n} rigid rows, budget ${BUDGET[f] ?? 0}`);

    expect(over).toEqual([]);
  });

  /**
   * RULE 3 — the reading floor holds where it has been applied.
   *
   * Not a sweep of every size: raising all 200-odd at once would be one
   * unreviewable diff. This asserts that a file already converted to the
   * `var(--fx-label)` tokens has not had a raw sub-11px size added back beside
   * them — the way a fixed section quietly un-fixes itself.
   */
  it('a file using the reading-floor tokens has no raw sub-11px sizes left', () => {
    const regressed = [];

    /**
     * MINIATURES ARE EXEMPT, and nothing else is.
     *
     * This used to skip any file that did not already use a type token, which
     * sounded like "only police what has been converted" and actually meant a
     * file could dodge the rule by not being converted — including two I wrote
     * myself during this pass, which shipped 10px labels the guard happily
     * ignored. The exemption is now a NAMED list of files where small type is
     * the point, so escaping it takes an edit somebody has to justify.
     *
     * These render miniatures: a fake phone, a card thumbnail, SVG chart labels,
     * canvas text that scales with zoom. Enlarging those does not help anyone
     * read them — it breaks the illusion or the scale.
     */
    const MINIATURES = new Set([
      'create-event/components/PhoneSimulator.js',
      'create-event/components/TemplateCard.js',
      'create-event/components/Stage1_TemplatesSimulator.js',
      'components/RsvpProgressDonut.js',
      'components/RsvpTrendChart.js',
      'components/ResponsiveChartBoard.js',
      'seating-map/page.js',
      /**
       * The printed seating pack. Its type sizes are not screen sizes.
       *
       * This file lays a document out in MILLIMETRES on a fixed page box — a
       * 297mm sheet, rendered at 1:1 and then scaled to the viewport with
       * `zoom`. A 7.5px small-cap eyebrow on that sheet is about 5.6pt of ink
       * on paper, which is ordinary document typography, and nobody reads it at
       * 1 CSS pixel per pixel on a phone: they read it on paper, or in a
       * preview that has been scaled to fit.
       *
       * Raising these to the 11px screen floor does not make anything more
       * legible; it makes the guest index roughly twice as many printed pages
       * and the title block look like a web page somebody printed. Same
       * category as the entries above — text whose size belongs to a scale
       * other than the viewport's.
       *
       * The modal's SCREEN chrome is deliberately NOT covered by this: every
       * .ppm-* rule lives in globals.css and obeys the ordinary floor.
       */
      'seating-map/SeatingChartPrint.js',
    ]);

    for (const { rel, src } of FILES) {
      if (MINIATURES.has(rel)) continue;
      /**
       * PIXELS AND UNITLESS NUMBERS ONLY.
       *
       * The looser `['"]?(\d+)(?:px)?['"]?` this replaces also matched
       * `fontSize: '0.92em'` — capturing 0.92 and reporting it as a 0.92px
       * violation. A relative unit is not a reading-floor problem at all: 0.92em
       * on an inline <code> is 92% of whatever it sits in, which already went
       * through the floor. Requiring the `px` inside the quotes excludes em, rem
       * and %, and the unitless branch still catches `fontSize: 10`.
       */
      for (const m of src.matchAll(/fontSize: *(?:['"](\d+(?:\.\d+)?)px['"]|(\d+(?:\.\d+)?)(?=[,}\s]))/g)) {
        const px = Number(m[1] ?? m[2]);
        if (px >= 11) continue;
        regressed.push(`${rel}:${src.slice(0, m.index).split('\n').length} → ${px}px`);
      }
    }

    expect(regressed).toEqual([]);
  });

  /**
   * RULE 4 — the tokens themselves grow on a phone, not shrink.
   *
   * The clamps are written backwards from the usual instinct (the LARGER bound
   * is the phone one), which is exactly the kind of thing a well-meaning tidy-up
   * "corrects". If the vw coefficient is ever made positive, every label in the
   * dashboard silently gets smaller on the device that needed it bigger.
   */
  it('the type tokens scale UP as the viewport narrows', () => {
    const css = fs.readFileSync(path.join(HERE, '..', 'src', 'app', 'globals.css'), 'utf8');

    for (const token of ['--fx-micro', '--fx-label', '--fx-meta', '--fx-body']) {
      const decl = css.match(new RegExp(`${token}: *clamp\\(([^;]+)\\);`));
      expect(decl, `${token} must be declared as a clamp()`).toBeTruthy();
      expect(decl[1], `${token} must subtract its vw term, so it grows as the viewport narrows`)
        .toMatch(/-\s*[\d.]+vw/);
    }

    expect(css).toMatch(/--fx-touch: *44px/);
  });
});
