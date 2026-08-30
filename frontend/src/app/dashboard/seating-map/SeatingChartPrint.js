'use client';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE EVENT-DAY SEATING PACK — what the organizer actually carries on the night.
 *
 * This replaces a single sheet that was clipped by CSS. The old export set
 * `.print-page { height: 186mm; overflow: hidden }`, put the floor plan and the
 * whole table roster side by side inside it, and threw away everything that did
 * not fit. On a real event — forty tables, three hundred guests — that is not a
 * layout compromise, it is missing guests on the one document the door staff
 * are holding. Nothing here is ever clipped: the document flows and the browser
 * paginates it.
 *
 * ── WHAT THE PACK CONTAINS, AND WHY EACH PART EARNS ITS PAPER ──
 *
 *   1. FLOOR PLAN — one page, as large as the paper allows. The room, drawn to
 *      scale, every table carrying its numeral and its seats. This is what an
 *      usher walks with.
 *
 *   2. GUEST INDEX (A→Z) — the part that did not exist before, and the part
 *      most used at the door. A guest gives you a NAME; a roster sorted by
 *      table cannot answer that, so staff were left scanning forty blocks for
 *      one word. Sorted alphabetically, dot-leadered to a table number, it
 *      answers "which table is Sara on" in a second. Where the party's member
 *      names are known, every person is listed under their own name — a
 *      companion who arrives before the host is still findable.
 *
 *   3. TABLE ASSIGNMENTS — the reverse lookup, table by table, with capacity
 *      and occupancy. This is what you hand the person laying out place cards.
 *
 *   4. AWAITING A TABLE — anyone attending with no seat yet. Printing the
 *      chart without them is how a guest arrives and appears on no document at
 *      all.
 *
 *   5. TABLE CARDS (optional) — one card per table, set large, to cut out and
 *      stand on the table itself.
 *
 * ── PRINT MECHANICS ──
 *
 * Page geometry is real: the sheet is sized in millimetres from the chosen
 * paper, so the on-screen preview is the printed page at 1:1 (scaled only by a
 * `zoom` the organizer controls). Sections start on a fresh page
 * (`break-before: page`); every list item is `break-inside: avoid`, so a table
 * block or a guest row is never cut in half by a page edge. The floor plan is
 * the one fixed-height page in the document, and it cannot clip either, because
 * an SVG with `preserveAspectRatio="xMidYMid meet"` scales to whatever box it
 * is given.
 *
 * ── ONE INK ──
 *
 * Everything is `INK` on white. Half of these charts go through an office mono
 * laser where a #6B5FA8 dance floor and a #4A7C59 entrance both arrive as the
 * same grey wash sitting behind the one thing anybody is reading. Weight, dash
 * pattern, glyph and rule carry every distinction instead, and all four survive
 * a photocopier. The only artwork is the Fancy wordmark, which is a signature,
 * not decoration.
 *
 * ── SCOPE DISCIPLINE (see test/seatingPrintScope.test.js) ──
 *
 * Every function in this module takes what it needs as a parameter. The print
 * preview once shipped completely dead because a top-level function read
 * `eventTimezone` — a `useState` local of the page component, a different scope
 * entirely — and threw ReferenceError on every render while the build, eslint
 * and the whole test suite stayed green. That test now scans this file too.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * `React` LOOKS UNUSED AND IS NOT. Do not "clean it up".
 *
 * Next.js compiles this file with the automatic JSX runtime, where the import
 * genuinely is unnecessary — but the test runner does not. vitest.config.mjs
 * hands .js files to esbuild with `loader: 'jsx'`, which uses the CLASSIC
 * transform, so every element in this file becomes `React.createElement(...)`
 * and the identifier has to be in scope. Removing it does not fail the build or
 * the linter; it throws "React is not defined" the moment anything renders the
 * modal, which is the same shape of invisible breakage this file's history is
 * already full of. `seatingChartPrintRender.test.jsx` is what catches it.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ICON_PATHS } from '../../components/icons/Icon';
import {
  WORLD_W, WORLD_H, shapeMeta, isZone,
  elWidth, elHeight, pctToPx, elCenterX, elCenterY, elBox,
} from '../../utils/seatingGeometry';
/**
 * The printed plan reads from the SAME look module as the two guest-facing
 * maps, and that is a deliberate change of side.
 *
 * The editor canvas is a work surface: it wants names, capacities, occupancy
 * and handles on every element, and its density is a feature. A printed chart
 * is the opposite — a finished artefact, read at arm's length, in a room, in a
 * hurry. It is bound by the same legibility rule the guest maps are: a table
 * carries a NUMERAL, a zone carries a GLYPH, and the words live in the legend.
 *
 * `planNumeral` is what makes that work for real data. The old export drew the
 * raw table_name at 38px inside a 96px circle, so an organizer who named their
 * tables "Table 12" got eight characters spilling out of every table on the
 * plan. planNumeral turns that into "12" — the number kept, the word dropped —
 * and falls back to initials for a genuinely named table.
 */
import { planNumeral, seatPositions } from '../../utils/seatingPlanStyle';
import { formatInZone } from '../../utils/timezone';

/** The one ink. See the file header. */
const INK = '#101215';
/** Screen-only accent (selection, moved-marker, controls). Never printed. */
const GOLD = '#B8944F';

/**
 * Paper, in portrait millimetres. `orientation` swaps them.
 *
 * A4 and US Letter only: those are the two trays a venue office actually has,
 * and offering A3 would promise a size most of these printers cannot feed.
 */
export const PAPERS = {
  // `css` is the keyword the @page rule takes; `label` is what the organizer
  // reads. They are separate fields because "US Letter" is not a valid page
  // size and deriving one from the other is the kind of cleverness that prints
  // an A4 document on a Letter tray.
  a4: { label: 'A4', css: 'A4', w: 210, h: 297 },
  letter: { label: 'US Letter', css: 'letter', w: 215.9, h: 279.4 },
};

/**
 * Page margin. 12mm is inside the unprintable edge of every consumer laser
 * (typically 5–6.4mm) with room left for a hole punch on the long edge.
 */
export const PAGE_MARGIN_MM = 12;

/** CSS pixels per millimetre at the 96dpi CSS reference — used only to count preview pages. */
const PX_PER_MM = 96 / 25.4;

/**
 * The page box for a paper/orientation pair, in millimetres.
 *
 * `content` is what a sheet can actually hold once the margins are taken off,
 * and it is the number every fixed-height decision in this file is derived
 * from. Exported because the tests assert against it — a wrong content height
 * is exactly how a "one page" plan silently became two.
 */
export function paperBox(paperKey, orientation) {
  const paper = PAPERS[paperKey] || PAPERS.a4;
  const landscape = orientation === 'landscape';
  const w = landscape ? paper.h : paper.w;
  const h = landscape ? paper.w : paper.h;
  return {
    w,
    h,
    contentW: w - PAGE_MARGIN_MM * 2,
    contentH: h - PAGE_MARGIN_MM * 2,
  };
}

/**
 * Numeric-aware compare so "Table 2" sorts before "Table 10" instead of after
 * it, and numbered tables come before named zones. Plain string compare puts
 * "10" before "2", which on a printed roster reads as a shuffled list.
 */
export function compareTableNames(a, b) {
  const an = parseInt(a, 10); const bn = parseInt(b, 10);
  const aIsNum = !isNaN(an) && String(an) === String(a).trim();
  const bIsNum = !isNaN(bn) && String(bn) === String(b).trim();
  if (aIsNum && bIsNum) return an - bn;
  if (aIsNum !== bIsNum) return aIsNum ? -1 : 1;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/** Case/diacritic-insensitive people sort, so an Arabic and a Latin list each order sanely. */
const byName = (a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });

/**
 * Every table on the plan with who is on it — INCLUDING the empty ones.
 *
 * Empty tables stay in the roster on purpose. "Table 14 — 0 of 10" is the line
 * that tells a host where they can still put a late arrival; dropping it (which
 * the old export did, by filtering on `names.length > 0`) leaves the only
 * document in the room silently disagreeing with the plan printed beside it.
 *
 * `seated` is the real headcount, not the number of reservations. A party row
 * is one RSVP that may cover four people, so counting rows made a table of ten
 * print "3" while ten chairs were occupied — the single most misleading number
 * that could appear on an event-day chart.
 */
export function buildRoster(elements, partiesByTable, occByTable, membersByParty) {
  return (elements || [])
    .filter((el) => !isZone(el))
    .map((el) => {
      const parties = [...(partiesByTable?.[el.id] || [])]
        .map((p) => ({
          ...p,
          members: (membersByParty?.[p.id] || []).filter(Boolean),
        }))
        .sort((a, b) => byName(a.name, b.name));
      const seatedFromParties = parties.reduce((n, p) => n + (Number(p.size) || 1), 0);
      return {
        id: el.id,
        name: el.table_name || 'Table',
        capacity: Number(el.max_capacity) || 0,
        // Prefer the live occupancy the editor already tracks (server + staged
        // moves); fall back to the party sizes when it is not supplied.
        seated: occByTable && occByTable[el.id] != null ? Number(occByTable[el.id]) : seatedFromParties,
        parties,
      };
    })
    .sort((a, b) => compareTableNames(a.name, b.name));
}

/**
 * The alphabetical index — one row per PERSON where we know their name, one row
 * per party where we only know the booking.
 *
 * Unseated guests are included with a dash instead of a table. They are the
 * ones most likely to cause a problem at the door, and leaving them off the
 * only alphabetical list in the pack means the person holding it concludes the
 * guest is not invited.
 */
export function buildGuestIndex(roster, unseatedParties, membersByParty) {
  const rows = [];

  const pushParty = (party, tableName) => {
    const members = (membersByParty?.[party.id] || []).filter(Boolean);
    if (members.length > 0) {
      // Named people, each findable under their own name. The party label is
      // carried along as `party` so a row can still say who they came with.
      //
      // The key is the party id plus the member's POSITION, not their name:
      // two people in one party genuinely can share a name (a father and son,
      // or two rows imported as "Guest"), and a name-based key would collide,
      // at which point React renders one row and the other guest is missing
      // from the printed index entirely.
      members.forEach((full, i) => {
        rows.push({
          key: `${party.id}:${i}`,
          name: full,
          table: tableName,
          party: members.length > 1 ? party.name : null,
          extra: 0,
        });
      });
      return;
    }
    // No member names available — the party label is the only name there is,
    // and "+3" is how the door staff know three more people arrive with them.
    rows.push({
      key: party.id,
      name: party.name,
      table: tableName,
      party: null,
      extra: Math.max(0, (Number(party.size) || 1) - 1),
    });
  };

  (roster || []).forEach((t) => t.parties.forEach((p) => pushParty(p, t.name)));
  (unseatedParties || []).forEach((p) => pushParty(p, null));

  rows.sort((a, b) => byName(a.name, b.name) || byName(a.table || '', b.table || ''));
  return rows;
}

/**
 * Index rows grouped under their initial, so the list reads as a directory
 * rather than as one long run of names.
 *
 * The group key is the first character as the reader sees it, uppercased.
 * Anything that is not a letter — a digit, a bracket, an emoji somebody typed
 * into a guest name — collects under "#" rather than creating a group of one.
 */
export function groupIndexRows(rows) {
  const groups = [];
  let current = null;
  (rows || []).forEach((row) => {
    /**
     * Stripped of diacritics before grouping, and that is not cosmetic.
     *
     * The rows are sorted with `sensitivity: 'base'`, which treats É and E as
     * the same letter — so "Emile, Émile, Eva" is a correctly sorted run. Group
     * on the raw character and that run becomes THREE groups: E, É, E. Two of
     * them carry the key "E", React sees a duplicate key among siblings, and
     * one group's guests do not render at all. A guest silently missing from
     * the door list is the worst failure this document has.
     *
     * Grouping on the base letter also happens to be what a reader wants: they
     * look for Émile under E.
     */
    // `\p{M}` (every combining mark), NOT `\p{Diacritic}`. Diacritic does not
    // match U+0654 ARABIC HAMZA ABOVE in V8, so after NFD split أ into
    // alef + hamza the hamza survived, the key was a two-code-unit string that
    // still rendered as أ, and every alef form kept its own group — the exact
    // bug this normalization was added to prevent, hiding behind a heading that
    // looked correct. Stripping marks by category is what "fold the accents"
    // actually means.
    const first = String(row.name || '').trim().charAt(0)
      .normalize('NFD').replace(/\p{M}/gu, '')
      .toUpperCase()
      .charAt(0);
    const letter = first && /\p{L}/u.test(first) ? first : '#';
    if (!current || current.letter !== letter) {
      current = { letter, rows: [] };
      groups.push(current);
    }
    current.rows.push(row);
  });
  return groups;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Document furniture
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `eventTimezone` IS A PROP, and leaving it out killed the whole feature once.
 *
 * It used to be read straight out of the body below without being declared here
 * or passed in — but it is a `useState` local of the seating-map PAGE component,
 * a different function entirely, so the identifier resolved nowhere and every
 * render threw ReferenceError. The print preview opened the dashboard's error
 * boundary for everybody, and `next build`, eslint and the full test suite were
 * all green while it did. `test/seatingPrintScope.test.js` pins it now.
 */
/**
 * ── THE BRAND MARK, DRAWN RATHER THAN LOADED ──
 *
 * `<img src="/logo.svg">` DOES NOT WORK ON THIS DOCUMENT, for two independent
 * reasons, and the organizer's report was simply "the name and logo don't show
 * at all".
 *
 *  1. THE FONT NEVER LOADS. public/logo.svg sets its wordmark in 'Great Vibes'
 *     and 'Playfair Display' via an `@import` of Google Fonts INSIDE the file.
 *     An SVG referenced by <img> is rendered in the browser's secure static
 *     mode: no scripts, and no external resource loading of any kind. The
 *     @import is ignored, both faces fall back, and the signature comes out as
 *     a squashed generic cursive.
 *  2. IT IS GOLD ON WHITE. The mark is a #EBD9A6→#8A6D34 gradient. At the ~17px
 *     a document letterhead gives it, that is faint on a good inkjet and a pale
 *     grey smear on the office mono laser half these charts are printed on —
 *     which is the entire reason everything else on this sheet is one ink.
 *
 * So it is drawn here instead: the envelope monogram as real geometry with a
 * non-scaling hairline (crisp at any size, on any printer), and the wordmark in
 * the document's own faces — which are already loaded, because the rest of the
 * sheet is set in them. Ink only, like everything else. It cannot fail to load,
 * cannot fall back, and cannot disappear into the paper.
 *
 * The geometry is the monogram from public/logo.svg, re-expressed in its own
 * 56×50 box. If that artwork ever changes, this is the second place to edit.
 */
function BrandMark({ height = 15, wordmark = true }) {
  const h = height;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: h * 0.4, color: INK, lineHeight: 1 }}>
      <svg
        width={h * (56 / 50)} height={h} viewBox="0 0 56 50" fill="none"
        aria-hidden="true" style={{ display: 'block', flexShrink: 0, overflow: 'visible' }}
      >
        {/* non-scaling-stroke: the mark is drawn at 15px in the letterhead,
            11px on a section head and 10px in a footer, and a scaled stroke
            would go from a hairline to a thread across the three.
            The 2.5-unit inset is what that costs: a non-scaling stroke is half
            its width OUTSIDE the path in device pixels, which at this scale is
            a couple of user units — drawn flush to the viewBox the left edge of
            the envelope would sit on the boundary. */}
        <rect x="2.5" y="16.5" width="51" height="31.5" rx="3" stroke={INK} strokeWidth="1.3" vectorEffect="non-scaling-stroke" />
        <path d="M2.5 20.6 L28 41.5 L53.5 20.6" stroke={INK} strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <path d="M5.5 16.5 L28 2.5 L50.5 16.5" stroke={INK} strokeWidth="1.1" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <path d="M28 5.6 L31.4 9.7 L28 13.8 L24.6 9.7 Z" fill={INK} />
      </svg>
      {wordmark && (
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: h * 0.28 }}>
          <span style={{ fontFamily: 'var(--font-serif, serif)', fontSize: h * 0.92, fontWeight: 600, letterSpacing: '0.005em' }}>
            Fancy
          </span>
          {/* 0.72, not 0.6: this is 6px tracked caps, and on a mono laser a
              lighter grey is rendered as a halftone dot pattern rather than as
              type. Small text wants density. */}
          <span style={{ fontSize: h * 0.4, fontWeight: 800, letterSpacing: '0.26em', opacity: 0.72 }}>
            RSVP
          </span>
        </span>
      )}
    </span>
  );
}

/**
 * A TITLE BLOCK, NOT A COVER.
 *
 * This used to be a centred stack — wordmark row, then a 26px event name, then
 * a meta line, then a row of figures, then a rule — about 45mm of a 186mm page.
 * On the one sheet whose entire job is to be a large drawing of a room, a
 * third of the paper was masthead, and the plan below it was squeezed until an
 * eight-millimetre table carried a four-millimetre number.
 *
 * Everything it said is still here, arranged as a title block across the head
 * of the sheet the way a drawing is titled: identity left, subject centre,
 * figures right, one rule under all three. It costs about 14mm, and the ~30mm
 * that buys goes straight into the size of every table on the plan.
 *
 * `eventTimezone` IS A PROP, and leaving it out killed the whole feature once:
 * it used to be read straight out of the body below without being declared here
 * or passed in — but it is a `useState` local of the seating-map PAGE component,
 * a different function entirely, so the identifier resolved nowhere and every
 * render threw ReferenceError. The print preview opened the dashboard's error
 * boundary for everybody, and `next build`, eslint and the full test suite were
 * all green while it did. `test/seatingPrintScope.test.js` pins it now.
 */
function PrintLetterhead({ eventTitle, eventTimezone, organizerName, formattedDate, stats }) {
  const metaParts = [
    formattedDate,
    organizerName ? `Prepared for ${organizerName}` : null,
    `Printed ${formatInZone(Date.now(), eventTimezone, { year: 'numeric', month: 'long', day: 'numeric' })}`,
  ].filter(Boolean);
  return (
    <header style={{ flexShrink: 0, color: INK }}>
      {/* Wrappable, even though the sheet is a fixed 273mm and this row always
          fits. Wrapping is a no-op at any width that has room, and the failure
          it guards against is real: a very long event name with the title block
          already at `minWidth: 0` would otherwise push the stats past the paper
          edge rather than dropping them to a second line. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ flexShrink: 0 }}>
          <BrandMark height={15} />
          <p style={{ fontSize: 7.5, margin: '4px 0 0', letterSpacing: '0.22em', textTransform: 'uppercase', fontWeight: 800, opacity: 0.55 }}>
            Seating Chart
          </p>
        </div>

        <div style={{ textAlign: 'center', minWidth: 0, flex: 1 }}>
          <h1 style={{
            fontFamily: 'var(--font-serif, serif)', fontSize: 19, fontWeight: 600, margin: 0,
            lineHeight: 1.2, letterSpacing: '-0.01em', unicodeBidi: 'plaintext',
          }}>
            {eventTitle || 'Seating Chart'}
          </h1>
          {metaParts.length > 0 && (
            <p style={{ fontSize: 8.5, opacity: 0.6, margin: '2px 0 0', letterSpacing: '0.02em' }}>
              {metaParts.join('  ·  ')}
            </p>
          )}
        </div>

        {stats && stats.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexShrink: 0, flexWrap: 'wrap' }}>
            {stats.map((s) => (
              <span key={s.label} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.15 }}>
                <span style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{s.value}</span>
                <span style={{ fontSize: 6.5, opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, whiteSpace: 'nowrap' }}>{s.label}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ height: 1, margin: '8px 0 0', background: INK, opacity: 0.85 }} />
    </header>
  );
}

/**
 * The head of every section after the first — a running title so a sheet that
 * gets separated from the pack still says what it is and which event it belongs
 * to. `break-after: avoid` (in globals.css) keeps it from being orphaned at the
 * foot of a page with its list starting on the next one.
 */
function SectionHead({ title, note, eventTitle, count }) {
  return (
    <div className="psc-sectionhead">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <h2 style={{
          fontFamily: 'var(--font-serif, serif)', fontSize: 17, fontWeight: 600, margin: 0,
          color: INK, letterSpacing: '0.01em',
        }}>
          {title}
          {count != null && (
            <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.5, marginInlineStart: 8, letterSpacing: '0.08em' }}>
              {count}
            </span>
          )}
        </h2>
        {/* The corner signature. Every sheet in the pack carries it, so a page
            that gets separated from the rest still says whose document it is
            and which event it belongs to — at a size that stays out of the way
            of the list underneath. */}
        <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
          <span style={{ fontSize: 8.5, textTransform: 'uppercase', letterSpacing: '0.16em', fontWeight: 700, opacity: 0.5, unicodeBidi: 'plaintext' }}>
            {eventTitle}
          </span>
          <BrandMark height={11} />
        </span>
      </div>
      {note && <p style={{ margin: '3px 0 0', fontSize: 9.5, opacity: 0.55 }}>{note}</p>}
      <div style={{ height: 1, marginTop: 7, background: INK, opacity: 0.85 }} />
    </div>
  );
}

/**
 * A quiet brand credit at the foot of the sheet, so a page separated from the
 * pack is still identifiable. Deliberately not a running page footer: a
 * `position: fixed` footer repeats on every printed page in Chrome but overlaps
 * the flow in every other engine, and a chart with a line struck through its
 * last row is worse than a chart with the credit only at the end of a section.
 */
function PrintFooter() {
  return (
    <div className="psc-foot" style={{ flexShrink: 0, marginTop: 'auto', paddingTop: 10, textAlign: 'center' }}>
      <div style={{ width: 64, height: 1, margin: '0 auto 7px', background: INK, opacity: 0.22 }} />
      {/* The mark rather than "Crafted with Fancy RSVP". A signature is what a
          finished document carries at its foot; a sentence about the tool that
          made it is what a template carries. */}
      <BrandMark height={10} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   The floor plan
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * One element on the printed plan.
 *
 * A table is a solid outline; a zone is a dashed one — which is how every real
 * floor plan separates "furniture you sit at" from "an area of the room"
 * without spending a drop of colour. Every stroke carries
 * `vectorEffect="non-scaling-stroke"`, so a hairline stays a hairline whether
 * the room is 8 tables or 80: without it the stroke widths are in world units
 * and shrink with the viewBox, and a large venue prints as a plan drawn in
 * invisible pencil.
 */
/**
 * SVG text takes its font through `style`, NOT through the presentation
 * attribute.
 *
 * `font-family="var(--font-sans, sans-serif)"` as an attribute does not resolve
 * in Chrome — custom properties are not substituted in presentation attributes
 * — so every label on the plan silently fell back to the browser's default
 * serif. It looked deliberate on the table numerals (which want a serif) and
 * was invisible on everything else, right up until a zone name measured half
 * again as wide as its own box and printed across the table next to it.
 */
const SANS = { fontFamily: 'var(--font-sans, sans-serif)' };
const SERIF = { fontFamily: 'var(--font-serif, serif)' };

/** Below this a printed label is a smudge that looks like information. */
const LABEL_MIN_MM = 1.9;
/** Digits survive a little smaller than tracked uppercase words do. */
const FIGURE_MIN_MM = 1.7;

/**
 * The size of a table's numeral, in world units.
 *
 * A module function rather than a line inside the renderer because the plan has
 * to make ONE decision about whether the occupancy line is legible, for every
 * table at once. Deciding per element produced a sheet where seventeen tables
 * carried "10/10" and the eighteenth — a head table, shorter than the rest and
 * so a fraction below the floor — carried nothing, which reads as a bug rather
 * than as a judgement about legibility.
 */
export function numeralSizeFor(el, numeral) {
  const small = Math.min(elWidth(el), elHeight(el));
  return Math.max(24, Math.min(46, small * (numeral && numeral.length > 2 ? 0.34 : 0.46)));
}
/** The occupancy line under it. */
export const countSizeFor = (numSize) => numSize * 0.44;

function PlanElement({ el, seated, showSeats, showCounts, names, mmPerWorld, onPointerDown, grabbing }) {
  const zone = isZone(el);
  const meta = shapeMeta(el.shape);
  const w = elWidth(el);
  const h = elHeight(el);
  const cx = elCenterX(el);
  const cy = elCenterY(el);
  const rot = Number(el.rotation) || 0;
  const capacity = Number(el.max_capacity) || meta.defaultCap || 0;

  const glyph = zone ? ICON_PATHS[meta.icon] : null;
  const glyphSize = Math.max(34, Math.min(78, Math.min(w, h) * 0.44));
  /**
   * A zone's name, ON the zone — when the zone is big enough to carry it.
   *
   * The glyph-and-legend rule exists because "DANCE FLOOR" set inside a 130px
   * booth either shrinks below reading size or spills across a table sitting
   * next to it. That is a rule about SMALL zones, and it was being applied to
   * all of them: a 420×150 stage has room for its own name three times over,
   * and making a floor manager look up "what is the microphone" in a key at the
   * foot of the sheet is exactly the kind of small friction that matters when
   * the room is dark and somebody is asking where the bar is.
   *
   * So it is measured rather than assumed. The name is drawn only if it fits
   * inside the zone at a legible size, and the legend still names every zone
   * underneath — including the ones too small to be labelled here.
   */
  const zoneName = zone ? (el.table_name || meta.label || '').trim() : '';
  // Sized to fit rather than tested for fit: the largest type that still sits
  // inside the zone's width (0.78em per character covers uppercase sans plus
  // the tracking set below) and inside its height, capped so a hall outline
  // does not get a headline.
  const zoneNameSize = Math.min(
    h * 0.26,
    (w * 0.86) / Math.max(1, zoneName.length * 0.78),
    30,
  );
  // Then gated in MILLIMETRES ON PAPER, not in world units. A world unit is a
  // different physical size on every plan — it is the room's own scale — so a
  // floor expressed in world units let a 12-table room print crisp zone names
  // and a 60-table room print the same names at half a millimetre.
  const zoneNameFits = !!zoneName
    && zoneNameSize * (mmPerWorld || 0) >= LABEL_MIN_MM
    && h >= glyphSize * 0.9 + zoneNameSize * 1.9;
  const numeral = zone ? null : planNumeral(el.table_name);
  // Two characters can be set far larger than eight, which is the entire reason
  // planNumeral exists. Bounded so a 96px round table and a 250px head table
  // both land inside the legibility band.
  const numSize = numeralSizeFor(el, numeral);
  /* `showCounts` arrives already answered for the whole plan — see
     countsLegible in the modal. It used to be `max(12, numSize * 0.34)` world
     units with no floor at all, which on an A4 plan of a real ballroom is a
     millimetre and a half: a grey smudge under every table number that reads as
     information and cannot be read. */
  const countSize = countSizeFor(numSize);
  const countFits = showCounts && capacity > 0;
  /* Guest names under a table are set in world units too, so on a large room
     they would shrink with everything else. Held at a real 2.1mm instead — the
     names either print legibly or the toggle is the wrong choice for this room,
     and the roster carries the same list at full size regardless. */
  const nameSize = mmPerWorld > 0 ? 2.1 / mmPerWorld : 12;

  const seats = !zone && showSeats && capacity > 0
    ? seatPositions({ ...el, capacity })
    : [];

  return (
    <g onPointerDown={onPointerDown} style={{ cursor: grabbing ? 'grabbing' : 'grab' }}>
      {/* Chairs first, so the table body prints over them and a seat never
          appears to sit inside the tabletop. */}
      {seats.length > 0 && (
        <g transform={`translate(${cx} ${cy}) rotate(${rot}) translate(${-w / 2} ${-h / 2})`}>
          {seats.map((p, i) => (
            <circle
              key={i}
              cx={p.x} cy={p.y} r={5.2}
              fill={i < seated ? INK : '#FFFFFF'}
              stroke={INK}
              strokeOpacity={0.65}
              strokeWidth={0.8}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      )}

      <g transform={`translate(${cx} ${cy}) rotate(${rot})`}>
        {meta.round ? (
          <ellipse
            rx={w / 2} ry={h / 2} fill="#FFFFFF" stroke={INK}
            strokeWidth={zone ? 1 : 1.7} strokeOpacity={zone ? 0.6 : 1}
            strokeDasharray={zone ? '7 5' : undefined}
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <rect
            x={-w / 2} y={-h / 2} width={w} height={h} rx={zone ? 10 : 12}
            fill="#FFFFFF" stroke={INK}
            strokeWidth={zone ? 1 : 1.7} strokeOpacity={zone ? 0.6 : 1}
            strokeDasharray={zone ? '7 5' : undefined}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </g>

      {/* The mark. Upright regardless of how the shape is rotated — a plan that
          makes you tilt your head to read "12" is the cheapness this replaces. */}
      <g transform={`translate(${cx} ${cy})`} style={{ pointerEvents: 'none' }}>
        {zone ? (
          <>
            {glyph && (
              <g
                transform={`translate(${-glyphSize / 2} ${-glyphSize / 2 - (zoneNameFits ? zoneNameSize * 0.85 : 0)}) scale(${glyphSize / 24})`}
                fill="none" stroke={INK} strokeOpacity={0.75}
                strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
              >
                {glyph}
              </g>
            )}
            {zoneNameFits && (
              <text
                y={glyphSize * 0.5 + zoneNameSize * 0.2}
                textAnchor="middle"
                fontSize={zoneNameSize}
                fontWeight={700}
                letterSpacing={zoneNameSize * 0.11}
                fill={INK}
                fillOpacity={0.72}
                style={{ ...SANS, unicodeBidi: 'plaintext' }}
              >
                {zoneName.toUpperCase()}
              </text>
            )}
          </>
        ) : (
          <>
            <text
              // SVG text sits on its baseline, so optically centring means
              // dropping it by about a third of the cap height. Scaled with the
              // type rather than a fixed offset, which floats high on a head
              // table and sits low on a small round one. With the occupancy
              // line below it, the pair is centred instead of the numeral.
              y={countFits ? numSize * 0.06 : numSize * 0.35}
              textAnchor="middle"
              fontSize={numSize}
              fontWeight={600}
              fill={INK}
              style={{ ...SERIF, fontVariantNumeric: 'tabular-nums lining-nums' }}
            >
              {numeral}
            </text>
            {countFits && (
              /* 0.44 of the numeral, not 0.34 with a 12-unit floor. The floor
                 was doing nothing — 12 world units is a millimetre and a half on
                 an A4 plan — so the occupancy printed as an illegible smudge
                 under every table number, which is worse than not printing it.
                 At this size it is a small second line, and it is a toggle for
                 anyone who wants the number alone. */
              <text
                y={numSize * 0.68}
                textAnchor="middle"
                fontSize={countSize}
                fontWeight={700}
                fill={INK}
                fillOpacity={0.6}
                style={{ ...SANS, fontVariantNumeric: 'tabular-nums' }}
              >
                {seated}/{capacity}
              </text>
            )}
          </>
        )}
      </g>

      {/* Names on the plan — off by default, and worth having anyway. In a room
          of a dozen tables this turns the plan into the whole document: the
          host can point at a table and read who is on it without going to the
          index. Set under the table, never inside it, so it can never crowd the
          numeral, and the gap below the table scales with the type rather than
          being a flat offset — a fixed one is a hair's breadth on a small room
          and a visible gutter on a large one. */}
      {names && names.length > 0 && (
        <g transform={`translate(${cx} ${cy + h / 2 + nameSize * 1.2})`} style={{ pointerEvents: 'none' }}>
          {names.map((n, i) => (
            <text
              key={i}
              y={i * nameSize * 1.25}
              textAnchor="middle"
              fontSize={nameSize}
              fill={INK}
              fillOpacity={0.8}
              style={{ ...SANS, unicodeBidi: 'plaintext' }}
            >
              {n}
            </text>
          ))}
        </g>
      )}
    </g>
  );
}

/**
 * The plan figure: ruled paper, the room, and the key beneath it.
 *
 * The key sits INSIDE the framed figure rather than under it, so the drawing
 * and the words that explain it can never be separated by a page break.
 */
function FloorPlanFigure({
  svgRef, viewBox, gridLines, displayElements, occByTable, namesOnPlan, showSeats, showCounts, mmPerWorld,
  selectedIds, overrides, marquee, dragging, onElPointerDown, onBackgroundPointerDown, onPointerMove, onPointerUp,
  zoneLegend,
}) {
  return (
    <figure className="psc-plan-figure">
      <svg
        ref={svgRef}
        viewBox={viewBox.value}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', flex: 1, minHeight: 0, display: 'block', touchAction: 'none' }}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <rect x={viewBox.minX} y={viewBox.minY} width={viewBox.boxW} height={viewBox.boxH} fill="#FFFFFF" />

        {/* The ruled floor. One line per 100 world units — the same module the
            editor's grid uses — at an opacity that reads as paper texture on a
            laser and disappears on a photocopy. It is what makes the sheet look
            like a plan rather than a screenshot of some shapes. */}
        <g stroke={INK} strokeOpacity={0.075} strokeWidth={0.5} vectorEffect="non-scaling-stroke">
          {gridLines.v.map((x) => <line key={`v${x}`} x1={x} y1={viewBox.minY} x2={x} y2={viewBox.minY + viewBox.boxH} vectorEffect="non-scaling-stroke" />)}
          {gridLines.h.map((y) => <line key={`h${y}`} x1={viewBox.minX} y1={y} x2={viewBox.minX + viewBox.boxW} y2={y} vectorEffect="non-scaling-stroke" />)}
        </g>

        {displayElements.map((el) => {
          const selected = selectedIds.has(el.id);
          const moved = !!overrides[el.id];
          return (
            <g key={el.id}>
              {/* Preview affordances. They live in the same SVG the printer
                  sees, so `.ppm-screen-only` (globals.css) hides them at print
                  time — a sheet printed with something still selected comes out
                  identical to one printed with nothing selected. */}
              {selected && (
                <g className="ppm-screen-only" transform={`translate(${elCenterX(el)} ${elCenterY(el)}) rotate(${Number(el.rotation) || 0})`}>
                  <rect
                    x={-elWidth(el) / 2 - 8} y={-elHeight(el) / 2 - 8}
                    width={elWidth(el) + 16} height={elHeight(el) + 16}
                    rx={16} fill="none" stroke={GOLD} strokeWidth={2.5} strokeOpacity={0.5}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )}
              {moved && (
                <g className="ppm-screen-only" transform={`translate(${elCenterX(el)} ${elCenterY(el)}) rotate(${Number(el.rotation) || 0})`}>
                  <rect
                    x={-elWidth(el) / 2 - 3} y={-elHeight(el) / 2 - 3}
                    width={elWidth(el) + 6} height={elHeight(el) + 6}
                    rx={14} fill="none" stroke={GOLD} strokeWidth={2} strokeDasharray="9 6"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )}
              <PlanElement
                el={el}
                seated={occByTable?.[el.id] || 0}
                showSeats={showSeats}
                showCounts={showCounts}
                names={namesOnPlan?.[el.id]}
                mmPerWorld={mmPerWorld}
                grabbing={dragging}
                onPointerDown={(e) => onElPointerDown(e, el)}
              />
            </g>
          );
        })}

        {marquee && (
          <rect
            className="ppm-screen-only"
            x={Math.min(marquee.x0, marquee.x1)} y={Math.min(marquee.y0, marquee.y1)}
            width={Math.abs(marquee.x1 - marquee.x0)} height={Math.abs(marquee.y1 - marquee.y0)}
            fill="rgba(184,148,79,0.12)" stroke={GOLD} strokeWidth={1.5} strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: 'none' }}
          />
        )}
      </svg>

      <figcaption className="psc-plan-key">
        <span className="psc-key-item">
          <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true">
            <rect x="1" y="1" width="14" height="10" rx="3" fill="none" stroke={INK} strokeWidth="1.4" />
          </svg>
          Table
        </span>
        <span className="psc-key-item">
          <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true">
            <rect x="1" y="1" width="14" height="10" rx="3" fill="none" stroke={INK} strokeOpacity="0.6" strokeWidth="1.1" strokeDasharray="3 2.4" />
          </svg>
          Venue zone
        </span>
        <span className="psc-key-item">
          <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true">
            <circle cx="5" cy="6" r="3.2" fill={INK} />
            <circle cx="12" cy="6" r="3.2" fill="none" stroke={INK} strokeOpacity="0.65" strokeWidth="1" />
          </svg>
          Seat taken / free
        </span>
        {zoneLegend.map((z) => (
          <span key={z.key} className="psc-key-item">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={INK} strokeOpacity="0.75" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {ICON_PATHS[z.icon]}
            </svg>
            <span style={{ unicodeBidi: 'plaintext' }}>{z.name}</span>
            {z.count > 1 && <span style={{ opacity: 0.55, fontWeight: 600 }}>×{z.count}</span>}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   The lists
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * One index row, dot-leadered.
 *
 * The leader is not decoration. Three columns of names with a table number
 * floated right is unreadable at arm's length — the eye loses the line between
 * "Nadia Farouk" and "17". A rule of dots is how every printed directory, index
 * and programme has solved that, and it costs one flexible element.
 */
function IndexRow({ row, fontSize }) {
  return (
    <div className="psc-idx-row psc-item" style={{ fontSize }}>
      <span className="psc-idx-name" style={{ unicodeBidi: 'plaintext' }}>
        {row.name}
        {row.extra > 0 && <span className="psc-idx-extra">+{row.extra}</span>}
      </span>
      <span className="psc-dots" aria-hidden="true" />
      <span className={row.table ? 'psc-idx-table' : 'psc-idx-table psc-idx-none'}>
        {row.table || '—'}
      </span>
    </div>
  );
}

/** One table's block on the assignments sheet. Never split across a page. */
function TableBlock({ table, fontSize }) {
  const free = Math.max(0, table.capacity - table.seated);
  return (
    <section className="psc-table-block psc-item" style={{ fontSize }}>
      <div className="psc-table-head">
        <span className="psc-table-name" style={{ unicodeBidi: 'plaintext' }}>{table.name}</span>
        <span className="psc-table-count">
          {table.seated}<span style={{ opacity: 0.45 }}>/{table.capacity || '—'}</span>
        </span>
      </div>
      {table.parties.length === 0 ? (
        <p className="psc-table-empty">Empty{table.capacity ? ` — ${table.capacity} seats free` : ''}</p>
      ) : (
        <ul className="psc-party-list">
          {table.parties.map((p) => (
            <li key={p.id} className="psc-party">
              <span className="psc-party-name" style={{ unicodeBidi: 'plaintext' }}>
                {p.name}
                {(Number(p.size) || 1) > 1 && <span className="psc-party-size">{p.size}</span>}
              </span>
              {p.members.length > 1 && (
                <span className="psc-party-members" style={{ unicodeBidi: 'plaintext' }}>
                  {p.members.filter((m) => m !== p.name).join(' · ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {free > 0 && table.parties.length > 0 && (
        <p className="psc-table-free">{free} seat{free === 1 ? '' : 's'} free</p>
      )}
    </section>
  );
}

/**
 * A card to cut out and stand on the table.
 *
 * Sized to a fixed fraction of the page so the cards come off the guillotine
 * the same size, and set at a type size that can be read while standing over
 * the table rather than leaning onto it.
 */
function TableCard({ table, eventTitle, heightMm }) {
  return (
    // min-height, not height: the cards want to be the same size so they cut
    // cleanly, but a twenty-seat head table must be allowed to grow rather than
    // have its last four guests clipped off the card that sits on their table.
    <section className="psc-card psc-item" style={{ minHeight: `${heightMm}mm` }}>
      <div className="psc-card-inner">
        <p className="psc-card-event" style={{ unicodeBidi: 'plaintext' }}>{eventTitle}</p>
        <p className="psc-card-numeral" style={{ unicodeBidi: 'plaintext' }}>{table.name}</p>
        <div className="psc-card-rule" />
        <ul className="psc-card-guests">
          {table.parties.flatMap((p) => (p.members.length > 0 ? p.members : [p.name]))
            .map((n, i) => <li key={`${n}-${i}`} style={{ unicodeBidi: 'plaintext' }}>{n}</li>)}
        </ul>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Preview chrome
   ═══════════════════════════════════════════════════════════════════════════ */

function Toggle({ checked, onChange, label, hint, disabled, count }) {
  return (
    <label className={`ppm-opt${disabled ? ' is-disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="ppm-opt-body">
        <span className="ppm-opt-label">
          {label}
          {count != null && <span className="ppm-opt-count">{count}</span>}
        </span>
        {hint && <span className="ppm-opt-hint">{hint}</span>}
      </span>
    </label>
  );
}

function Segmented({ value, onChange, options, label }) {
  return (
    <div className="ppm-seg-wrap">
      <span className="ppm-seg-label">{label}</span>
      <div className="ppm-seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`ppm-seg-btn${value === o.value ? ' is-on' : ''}`}
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * One printable sheet.
 *
 * The box is the real page: `--psc-page-w/h` are millimetres taken from the
 * chosen paper, so what is on screen is the printed page at 1:1 before the
 * organizer's own zoom. `pages` (measured, not guessed) drives the page-break
 * rules and the "Page n" ticks down the margin, both of which are screen-only.
 */
function Sheet({ children, pages, fixedHeight, label, innerRef }) {
  const marks = [];
  for (let i = 1; i < (pages || 1); i += 1) marks.push(i);
  return (
    <div className="psc-sheet-outer">
      <div className={`psc-sheet${fixedHeight ? ' is-fixed' : ''}`} ref={innerRef}>
        {children}
        {marks.map((i) => (
          <div
            key={i}
            className="psc-pagemark ppm-screen-only"
            // The sheet's own top padding is the first page's top margin; every
            // break after that lands one CONTENT height further down, not one
            // page height — the pages in between each keep their two margins.
            style={{ top: `calc(var(--psc-margin) + (var(--psc-page-h) - var(--psc-margin) * 2) * ${i})` }}
          >
            <span>page {i + 1}</span>
          </div>
        ))}
      </div>
      <p className="psc-sheet-label ppm-screen-only">
        {label}
        {pages > 1 && <span className="psc-sheet-pages">{pages} pages</span>}
      </p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   The modal
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `namesByTable` is deliberately NOT a prop any more. It carried one label per
 * RSVP — a party of four arrived as a single string — so every count derived
 * from it was a count of bookings presented as a count of people. The modal
 * takes `partiesByTable` (label + size) and `occByTable` (the editor's live
 * occupancy) instead, and `membersByParty` when the individual names have been
 * fetched.
 */
export default function SeatingChartPrintModal({
  eventTitle,
  eventDate,
  eventTimezone,
  organizerName,
  elements,
  partiesByTable,
  unseatedParties,
  membersByParty,
  occByTable,
  summary,
  membersLoading,
  onClose,
}) {
  /* ── document options ── */
  const [paper, setPaper] = useState('a4');
  const [orientation, setOrientation] = useState('landscape');
  const [density, setDensity] = useState('normal');
  const [sections, setSections] = useState({ plan: true, index: true, tables: true, unseated: true, cards: false });
  const [showSeats, setShowSeats] = useState(true);
  const [showCounts, setShowCounts] = useState(true);
  const [showNames, setShowNames] = useState(false);
  /* Off: the lists flow and no paper is wasted between them. On: each list
     opens its own page, for handing the index to the door and the assignments
     to whoever is laying out place cards. */
  const [splitParts, setSplitParts] = useState(false);

  /* ── this printout's element positions (never written back) ── */
  const [overrides, setOverrides] = useState({});
  const [dragging, setDragging] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [marquee, setMarquee] = useState(null);
  const svgRef = useRef(null);
  const elementsRef = useRef(elements);
  elementsRef.current = elements;
  const dragRef = useRef(null);
  const marqueeRef = useRef(null);

  /* ── preview zoom ── */
  const [zoom, setZoom] = useState(1);
  const [autoZoom, setAutoZoom] = useState(true);
  const stageRef = useRef(null);
  const [railOpen, setRailOpen] = useState(false);

  const geom = useMemo(() => paperBox(paper, orientation), [paper, orientation]);

  /**
   * Paint order, back to front: zones (largest first), then tables.
   *
   * SVG has no z-index — it paints strictly in document order. Left in raw
   * insertion order, a zone created after a table painted straight over it, and
   * a zone is large enough to swallow a table number sitting inside it. That is
   * the "elements merge into each other" the export used to be reported for.
   */
  const displayElements = useMemo(() => {
    const positioned = (elements || []).map((el) => {
      const o = overrides[el.id];
      return o ? { ...el, position_x: o.x, position_y: o.y } : el;
    });
    const area = (el) => (Number(elWidth(el)) || 0) * (Number(elHeight(el)) || 0);
    return positioned.sort((a, b) => {
      const az = isZone(a); const bz = isZone(b);
      if (az !== bz) return az ? -1 : 1;
      if (az && bz) return area(b) - area(a);
      return 0;
    });
  }, [elements, overrides]);

  const isEmpty = !elements || elements.length === 0;

  /**
   * The drawing's bounding box, padded, in world units — then STRETCHED to the
   * shape of the frame it is about to be drawn in.
   *
   * `preserveAspectRatio="xMidYMid meet"` letterboxes: a room that is 1.37 wide
   * for every 1 tall, drawn into a frame that is 2.0 wide, leaves a third of the
   * sheet as bare white paper down each side, with the ruled floor stopping
   * abruptly where the bounding box ends. It reads as a small drawing lost in a
   * big box rather than as a plan of a room.
   *
   * Growing the box symmetrically to the frame's own aspect does not shrink the
   * drawing by one pixel — `meet` was already fitting on the other axis — it
   * just extends the paper and its ruling out to the frame's edges, with the
   * room centred on it. The aspect is measured rather than assumed, because it
   * depends on the paper, the orientation and how tall the title block came out.
   */
  const [planAspect, setPlanAspect] = useState(null);
  const viewBox = useMemo(() => {
    const PAD = 70;
    if (isEmpty) return { minX: 0, minY: 0, boxW: 1, boxH: 1, value: '0 0 1 1' };
    let mnX = Infinity; let mnY = Infinity; let mxX = -Infinity; let mxY = -Infinity;
    displayElements.forEach((el) => {
      const b = elBox(el);
      mnX = Math.min(mnX, b.x); mnY = Math.min(mnY, b.y);
      mxX = Math.max(mxX, b.right); mxY = Math.max(mxY, b.bottom);
    });
    let minX = mnX - PAD; let minY = mnY - PAD;
    let boxW = Math.max(1, mxX + PAD - minX);
    let boxH = Math.max(1, mxY + PAD - minY);

    if (planAspect && isFinite(planAspect) && planAspect > 0) {
      if (planAspect > boxW / boxH) {
        const grown = boxH * planAspect;
        minX -= (grown - boxW) / 2;
        boxW = grown;
      } else {
        const grown = boxW / planAspect;
        minY -= (grown - boxH) / 2;
        boxH = grown;
      }
    }
    return { minX, minY, boxW, boxH, value: `${minX} ${minY} ${boxW} ${boxH}` };
  }, [displayElements, isEmpty, planAspect]);

  /* Measured, not assumed. The SVG's own box is the frame, and it never changes
     size in response to the viewBox, so this cannot feed back on itself. */
  useEffect(() => {
    const node = svgRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const read = () => {
      const r = node.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setPlanAspect(r.width / r.height);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(node);
    return () => ro.disconnect();
  }, [sections.plan, isEmpty, orientation, paper]);

  /** Ruling every 100 world units, clipped to the drawing's own box. */
  const gridLines = useMemo(() => {
    const STEP = 100;
    const v = []; const h = [];
    if (isEmpty) return { v, h };
    for (let x = Math.ceil(viewBox.minX / STEP) * STEP; x < viewBox.minX + viewBox.boxW; x += STEP) v.push(x);
    for (let y = Math.ceil(viewBox.minY / STEP) * STEP; y < viewBox.minY + viewBox.boxH; y += STEP) h.push(y);
    return { v, h };
  }, [viewBox, isEmpty]);

  const roster = useMemo(
    () => buildRoster(elements, partiesByTable, occByTable, membersByParty),
    [elements, partiesByTable, occByTable, membersByParty],
  );
  const indexRows = useMemo(
    () => buildGuestIndex(roster, unseatedParties, membersByParty),
    [roster, unseatedParties, membersByParty],
  );
  const indexGroups = useMemo(() => groupIndexRows(indexRows), [indexRows]);

  /** Names drawn under each table on the plan — only when asked for. */
  const namesOnPlan = useMemo(() => {
    if (!showNames) return null;
    const m = {};
    roster.forEach((t) => {
      const all = t.parties.flatMap((p) => (p.members.length > 0 ? p.members : [p.name]));
      // Past a dozen lines the block is taller than the table it belongs to and
      // starts colliding with its neighbours; the roster carries the full list.
      m[t.id] = all.length > 12 ? [...all.slice(0, 11), `+${all.length - 11} more`] : all;
    });
    return m;
  }, [roster, showNames]);

  /** One row per zone actually placed, keyed by NAME so a renamed "Champagne Bar" keeps its own line. */
  const zoneLegend = useMemo(() => {
    const seen = new Map();
    (elements || []).filter(isZone).forEach((el) => {
      const meta = shapeMeta(el.shape);
      if (!meta.icon || !ICON_PATHS[meta.icon]) return;
      const name = (el.table_name || meta.label || '').trim() || meta.label;
      const key = `${meta.icon}::${name.toLowerCase()}`;
      if (seen.has(key)) { seen.get(key).count += 1; return; }
      seen.set(key, { key, icon: meta.icon, name, count: 1 });
    });
    return [...seen.values()].sort((a, b) => byName(a.name, b.name));
  }, [elements]);

  const tableCount = roster.length;
  const zoneCount = (elements || []).filter(isZone).length;
  /**
   * The headline figure is the one the SHEETS add up to, not the server's.
   *
   * `summary.seatedGuests` is the saved state; the roster is built from
   * `occByTable`, which folds in seat moves the organizer has staged but not
   * yet saved. Preferring the summary meant a chart whose title block said 196
   * over a plan and a roster that both totalled 198 — an internal contradiction
   * on a document nobody can re-check at the venue. The summary stays as the
   * fallback for the case where no occupancy was passed in.
   */
  const rosterSeated = roster.reduce((n, t) => n + t.seated, 0);
  const seatedGuests = roster.length > 0 ? rosterSeated : (summary?.seatedGuests ?? 0);
  const unseatedCount = (unseatedParties || []).reduce((n, p) => n + (Number(p.size) || 1), 0);
  const totalCapacity = roster.reduce((n, t) => n + (t.capacity || 0), 0);
  const hasLists = (sections.index && indexRows.length > 0)
    || (sections.tables && roster.length > 0)
    || (sections.unseated && (unseatedParties || []).length > 0);

  const formattedDate = eventDate
    ? formatInZone(eventDate, eventTimezone, { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  const stats = [
    { label: 'Tables', value: tableCount },
    { label: 'Guests Seated', value: seatedGuests },
    ...(unseatedCount > 0 ? [{ label: 'To Seat', value: unseatedCount }] : []),
    ...(zoneCount > 0 ? [{ label: 'Venue Zones', value: zoneCount }] : []),
  ];

  /**
   * Millimetres of paper per world unit — the plan's real scale.
   *
   * Every label on the drawing is sized in world units, which means its
   * physical size depends on how big the room is. This is what lets each of
   * them ask the only question that matters on paper: "will anybody be able to
   * read me?" The figure spans the sheet's content width, so the width ratio is
   * the scale (`preserveAspectRatio` uses one factor for both axes).
   */
  const mmPerWorld = viewBox.boxW > 0 ? geom.contentW / viewBox.boxW : 0;

  /**
   * Is the occupancy line readable on THIS plan? One answer for every table.
   *
   * Taken from the smallest table in the room, so the sheet is either
   * consistently annotated or consistently clean. A room dense enough to fail
   * this also trips `planAdvice` below, which tells the organizer what to do
   * about it instead of leaving them to notice.
   */
  const countsLegible = useMemo(() => {
    const tables = (elements || []).filter((el) => !isZone(el));
    if (tables.length === 0 || !mmPerWorld) return false;
    const smallest = Math.min(...tables.map((el) => countSizeFor(numeralSizeFor(el, planNumeral(el.table_name)))));
    return smallest * mmPerWorld >= FIGURE_MIN_MM;
  }, [elements, mmPerWorld]);

  /* ── type scale ──
     One multiplier, so "make it fit on fewer pages" is a single decision rather
     than a hunt through twenty font sizes. */
  const D = density === 'compact' ? 0.88 : density === 'fine' ? 0.78 : 1;
  const idxFont = 11 * D;
  const rosterFont = 10.5 * D;
  /* Columns follow the page, not the data: a 273mm landscape content box holds
     four comfortable columns; a 186mm portrait one holds three. One value for
     every list in the pack — two identically-valued constants read as though
     the lists differ on purpose, and they do not. */
  const maxColumns = orientation === 'landscape' ? 4 : 3;
  /**
   * …but a SHORT list does not get the full four.
   *
   * Seven people waiting for a table, spread over four columns, is two names
   * per column: a row of stubs with a dot leader running most of the way across
   * the paper and nothing under it. The column count is capped by how much
   * there is to put in it, so a short list reads as a short list instead of as
   * a wide one that failed to fill.
   *
   * `per` is roughly how many lines one entry occupies — an index row is one
   * line, a table block is about five — so both sections are asking the same
   * question in their own units.
   */
  const colsFor = (count, per) => Math.max(2, Math.min(maxColumns, Math.ceil(count / per)));

  /* ── measured page counts, for the preview's page marks ── */
  const sheetRefs = useRef({});
  const [pageCounts, setPageCounts] = useState({});
  const measure = useCallback(() => {
    // A printed page carries `contentH` of content, not `h`: every page after
    // the first pays for its own top and bottom margin again. Counting against
    // the full page height under-reports a long index by one page for every
    // four or five it actually prints.
    const contentHpx = geom.contentH * PX_PER_MM;
    const marginPx = PAGE_MARGIN_MM * PX_PER_MM;
    const next = {};
    Object.entries(sheetRefs.current).forEach(([key, node]) => {
      if (!node) return;
      // The rect is in zoomed pixels; dividing by the same zoom cancels it out,
      // so the ratio is the honest number of pages either way.
      const contentPx = node.getBoundingClientRect().height / (zoom || 1) - marginPx * 2;
      // The -0.01 keeps a sheet that fills its page exactly at one page rather
      // than rounding up into a phantom blank second one.
      next[key] = Math.max(1, Math.ceil(contentPx / contentHpx - 0.01) || 1);
    });
    setPageCounts(next);
  }, [geom.contentH, zoom]);

  useEffect(() => {
    const id = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(id);
  }, [measure, sections, density, orientation, paper, roster, indexRows, showNames]);

  /* ── fit-to-width ──
     A print preview that needs horizontal scrolling on a phone is the responsive
     complaint this rebuild started from. The sheet keeps its real millimetre
     size and the whole document is scaled down to the space available. */
  useEffect(() => {
    const node = stageRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const fit = () => {
      if (!autoZoom) return;
      const available = node.clientWidth - 32;
      const sheetPx = geom.w * PX_PER_MM;
      setZoom(Math.max(0.25, Math.min(1, available / sheetPx)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(node);
    return () => ro.disconnect();
  }, [geom.w, autoZoom]);

  /* ── close on Escape ── */
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /* ── select + drag-to-arrange (this printout only) ──
     `overrides` is component state and is never written back to `elements` or
     the database. Closing and reopening always starts from the organizer's real
     arrangement: a printout tidied for one night can never bleed into the live
     plan, and the live plan can never be "fixed" by someone rearranging paper. */
  const toSvgPoint = (clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg || !svg.createSVGPoint) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const posOf = (id) => {
    const o = overrides[id];
    if (o) return o;
    const el = (elementsRef.current || []).find((x) => x.id === id);
    return { x: Number(el?.position_x) || 0, y: Number(el?.position_y) || 0 };
  };
  const onElPointerDown = (e, el) => {
    e.stopPropagation();
    e.preventDefault();
    const p = toSvgPoint(e.clientX, e.clientY);
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(el.id)) next.delete(el.id); else next.add(el.id);
        return next;
      });
      return;
    }
    if (selectedIds.size > 1 && selectedIds.has(el.id)) {
      const origins = {};
      selectedIds.forEach((id) => { origins[id] = posOf(id); });
      dragRef.current = { mode: 'group', ids: Array.from(selectedIds), startP: p, origins };
    } else {
      setSelectedIds(new Set([el.id]));
      // Grab offset from the element's TOP-LEFT, because that is what the move
      // handler writes back into `overrides` and what position_x/y mean.
      // Measuring it from the centre made every element jump by half its own
      // size the instant it was picked up.
      dragRef.current = {
        mode: 'single',
        id: el.id,
        offX: p.x - pctToPx(el.position_x, WORLD_W),
        offY: p.y - pctToPx(el.position_y, WORLD_H),
      };
    }
    setDragging(true);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointermove on the svg still covers it */ }
  };
  const onBackgroundPointerDown = (e) => {
    if (e.shiftKey) {
      const p = toSvgPoint(e.clientX, e.clientY);
      const rect = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      marqueeRef.current = rect;
      setMarquee(rect);
      return;
    }
    setSelectedIds(new Set());
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (d) {
      const p = toSvgPoint(e.clientX, e.clientY);
      const cl = (v) => Math.max(0, Math.min(100, v));
      if (d.mode === 'single') {
        setOverrides((prev) => ({
          ...prev,
          [d.id]: { x: cl(((p.x - d.offX) / WORLD_W) * 100), y: cl(((p.y - d.offY) / WORLD_H) * 100) },
        }));
      } else {
        const dxPct = ((p.x - d.startP.x) / WORLD_W) * 100;
        const dyPct = ((p.y - d.startP.y) / WORLD_H) * 100;
        setOverrides((prev) => {
          const next = { ...prev };
          d.ids.forEach((id) => {
            const o = d.origins[id];
            if (o) next[id] = { x: cl(o.x + dxPct), y: cl(o.y + dyPct) };
          });
          return next;
        });
      }
      return;
    }
    if (marqueeRef.current) {
      const p = toSvgPoint(e.clientX, e.clientY);
      const next = { ...marqueeRef.current, x1: p.x, y1: p.y };
      marqueeRef.current = next;
      setMarquee(next);
    }
  };
  const onPointerUp = () => {
    dragRef.current = null;
    setDragging(false);
    const m = marqueeRef.current;
    if (!m) return;
    marqueeRef.current = null;
    setMarquee(null);
    const left = Math.min(m.x0, m.x1); const right = Math.max(m.x0, m.x1);
    const top = Math.min(m.y0, m.y1); const bottom = Math.max(m.y0, m.y1);
    if (right - left < 4 && bottom - top < 4) return;
    const hits = (elementsRef.current || []).filter((el) => {
      const p = posOf(el.id);
      const b = elBox({ ...el, position_x: p.x, position_y: p.y });
      return b.x < right && b.right > left && b.y < bottom && b.bottom > top;
    }).map((el) => el.id);
    if (hits.length > 0) setSelectedIds(new Set(hits));
  };

  const hasOverrides = Object.keys(overrides).length > 0;
  const setSection = (key) => (on) => setSections((prev) => ({ ...prev, [key]: on }));

  /**
   * How large a table's numeral actually lands on the paper.
   *
   * A 40-table room scaled onto one A4 page draws a 96mm-world table at a few
   * millimetres, and its number below the point where anybody can read it in a
   * dim ballroom. Saying so — with the fix, which is landscape, or a bigger
   * sheet from the browser's own scale — is more use than silently printing an
   * illegible plan.
   */
  const planAdvice = useMemo(() => {
    if (isEmpty || !sections.plan) return null;
    const smallest = Math.min(...displayElements.filter((el) => !isZone(el)).map((el) => Math.min(elWidth(el), elHeight(el))), Infinity);
    if (!isFinite(smallest)) return null;
    const numeralMm = smallest * 0.46 * mmPerWorld;
    if (numeralMm >= 3) return null;
    return orientation === 'portrait'
      ? 'This room is wide for a portrait page — switch to landscape so the table numbers print large enough to read.'
      : 'This room has more tables than one sheet reads comfortably. Print the plan at A3, or raise the scale in your printer dialog.';
  }, [isEmpty, sections.plan, mmPerWorld, displayElements, orientation]);

  // Rendered into <body> rather than in place. The print stylesheet keeps one
  // top-level node alive (`body > *:not(.ppm-overlay)` is display:none — see
  // globals.css), and that only works if this overlay really IS a direct child
  // of body: nested in the dashboard tree, its ancestors would either be hidden
  // with it or keep emitting their own page boxes, which is what produced the
  // stray sheets. Safe without a mounted guard — the parent renders this only
  // after a click, so it never runs during SSR.
  return createPortal(
    <div className="ppm-overlay" role="dialog" aria-modal="true" aria-label="Print preview">
      {/* @page cannot be expressed as an inline style, and the paper size has to
          follow the organizer's choice, so it is written as a real stylesheet
          rule here. Plain <style>, not styled-jsx: scoped styles in a nested,
          non-default-export component do not reliably compile in this build. */}
      <style>{`@page { size: ${(PAPERS[paper] || PAPERS.a4).css} ${orientation}; margin: ${PAGE_MARGIN_MM}mm; }`}</style>

      <div className="ppm-topbar">
        <div className="ppm-topbar-copy">
          <h2 className="ppm-title">Print Preview</h2>
          <p className="ppm-sub">
            {selectedIds.size > 1
              ? `${selectedIds.size} elements selected — drag any one of them to move the whole group.`
              : 'Drag a table to tidy this printout. Your live seating map is untouched.'}
          </p>
        </div>
        <div className="ppm-topbar-actions">
          <button
            type="button"
            className="ppm-btn ppm-btn-ghost ppm-rail-toggle"
            aria-expanded={railOpen}
            onClick={() => setRailOpen((v) => !v)}
          >
            {railOpen ? 'Hide options' : 'Options'}
          </button>
          {selectedIds.size > 0 && (
            <button type="button" onClick={() => setSelectedIds(new Set())} className="ppm-btn ppm-btn-ghost">Deselect</button>
          )}
          {hasOverrides && (
            <button type="button" onClick={() => { setOverrides({}); setSelectedIds(new Set()); }} className="ppm-btn ppm-btn-ghost">Reset layout</button>
          )}
          <button type="button" onClick={() => window.print()} disabled={isEmpty} className="ppm-btn ppm-btn-primary">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9V2h12v7" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            Print / Save as PDF
          </button>
          <button type="button" onClick={onClose} className="ppm-btn ppm-btn-ghost">Close</button>
        </div>
      </div>

      <div className="ppm-body">
        <aside className={`ppm-rail${railOpen ? ' is-open' : ''}`}>
          <div className="ppm-rail-scroll">
            <h3 className="ppm-rail-head">In this pack</h3>
            <Toggle
              checked={sections.plan} onChange={setSection('plan')}
              label="Floor plan" hint="The room, drawn to scale" count={tableCount + zoneCount}
            />
            <Toggle
              checked={sections.index} onChange={setSection('index')}
              label="Guest index A–Z" hint="Name to table — the door list" count={indexRows.length}
            />
            <Toggle
              checked={sections.tables} onChange={setSection('tables')}
              label="Table assignments" hint="Table by table, with free seats" count={tableCount}
            />
            <Toggle
              checked={sections.unseated} onChange={setSection('unseated')}
              label="Awaiting a table" hint="Attending, not seated yet"
              count={(unseatedParties || []).length}
              disabled={(unseatedParties || []).length === 0}
            />
            <Toggle
              checked={sections.cards} onChange={setSection('cards')}
              label="Table cards" hint="Cut out and stand on each table" count={tableCount}
            />

            <Toggle
              checked={splitParts} onChange={setSplitParts}
              label="Start each list on a new page"
              hint="Off, the lists flow and use less paper"
              disabled={!hasLists}
            />

            <h3 className="ppm-rail-head">Floor plan</h3>
            <Toggle checked={showSeats} onChange={setShowSeats} label="Draw the chairs" hint="Filled where a seat is taken" />
            <Toggle
              checked={showCounts}
              onChange={setShowCounts}
              label="Seats used on each table"
              hint={countsLegible ? 'e.g. 8/10' : 'Hidden — this room prints too small to read it'}
            />
            <Toggle checked={showNames} onChange={setShowNames} label="Guest names on the plan" hint="Best for rooms of a dozen tables" />

            <h3 className="ppm-rail-head">Paper</h3>
            {/* Driven from PAPERS so a paper is added in one place, rather
                than in the catalogue and again in this list. */}
            <Segmented
              label="Size" value={paper} onChange={setPaper}
              options={Object.entries(PAPERS).map(([value, p]) => ({ value, label: p.label }))}
            />
            <Segmented
              label="Orientation" value={orientation} onChange={setOrientation}
              options={[{ value: 'landscape', label: 'Landscape' }, { value: 'portrait', label: 'Portrait' }]}
            />
            <Segmented
              label="Density" value={density} onChange={setDensity}
              options={[
                { value: 'normal', label: 'Roomy' },
                { value: 'compact', label: 'Compact' },
                { value: 'fine', label: 'Fine' },
              ]}
            />
            <div className="ppm-zoom">
              <span className="ppm-seg-label">Preview</span>
              <div className="ppm-seg">
                <button type="button" className="ppm-seg-btn" onClick={() => { setAutoZoom(false); setZoom((z) => Math.max(0.25, z - 0.1)); }} aria-label="Zoom out">−</button>
                <button type="button" className={`ppm-seg-btn${autoZoom ? ' is-on' : ''}`} onClick={() => setAutoZoom(true)}>Fit</button>
                <button type="button" className="ppm-seg-btn" onClick={() => { setAutoZoom(false); setZoom((z) => Math.min(2, z + 0.1)); }} aria-label="Zoom in">+</button>
              </div>
            </div>

            <p className="ppm-rail-note">
              In the print dialog, set <strong>Margins: Default</strong> and leave{' '}
              <strong>Headers and footers</strong> off. Everything on these sheets is
              drawn in one ink, so a mono printer loses nothing.
            </p>
          </div>
        </aside>

        <div className="ppm-stage" ref={stageRef}>
          {isEmpty ? (
            <div className="ppm-empty">Add at least one table or zone to the seating map before printing.</div>
          ) : (
            <div
              className={`print-seating-chart psc-doc${splitParts ? ' is-split' : ''}`}
              style={{
                '--psc-page-w': `${geom.w}mm`,
                '--psc-page-h': `${geom.h}mm`,
                '--psc-margin': `${PAGE_MARGIN_MM}mm`,
                '--psc-zoom': zoom,
              }}
            >
              {planAdvice && <p className="ppm-advice ppm-screen-only">{planAdvice}</p>}
              {membersLoading && (
                <p className="ppm-advice ppm-screen-only">Loading each party&apos;s guest names — the index will fill in on its own.</p>
              )}

              {sections.plan && (
                <Sheet
                  innerRef={(n) => { sheetRefs.current.plan = n; }}
                  pages={1}
                  fixedHeight
                  label="Floor plan"
                >
                  <PrintLetterhead
                    eventTitle={eventTitle}
                    eventTimezone={eventTimezone}
                    organizerName={organizerName}
                    formattedDate={formattedDate}
                    stats={stats}
                  />
                  <FloorPlanFigure
                    svgRef={svgRef}
                    viewBox={viewBox}
                    gridLines={gridLines}
                    displayElements={displayElements}
                    occByTable={occByTable}
                    namesOnPlan={namesOnPlan}
                    showSeats={showSeats}
                    showCounts={showCounts && countsLegible}
                    mmPerWorld={mmPerWorld}
                    selectedIds={selectedIds}
                    overrides={overrides}
                    marquee={marquee}
                    dragging={dragging}
                    onElPointerDown={onElPointerDown}
                    onBackgroundPointerDown={onBackgroundPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    zoneLegend={zoneLegend}
                  />
                  {/* No footer on this sheet. The plan page is one drawing and
                      every millimetre it gives up comes off the size of the
                      tables; the mark is in the letterhead above, and on every
                      other sheet in the pack. */}
                </Sheet>
              )}

              {/* ── THE LISTS SHARE ONE RUN OF PAPER ──
                  Every list used to open its own sheet, and that is where the
                  blank space came from. A section that ran nine millimetres
                  past a page printed a second page that was ninety percent
                  white; "Awaiting a Table" — seven names — took a whole sheet
                  of its own. Three sections, three ragged tails.

                  They flow now, one after another, the way the reference pages
                  of any printed programme do: a ruled section head, a little
                  air above it, and the paper carries on. The break rules below
                  still keep a head off the foot of a page and never split a
                  table's block, so nothing lands badly — there is simply no
                  deliberate blank left between one list and the next.

                  "Start each list on a new page" in the options rail puts the
                  old behaviour back for anyone handing different lists to
                  different people. */}
              {hasLists && (
                <Sheet
                  innerRef={(n) => { sheetRefs.current.lists = n; }}
                  pages={pageCounts.lists || 1}
                  label="Guest lists"
                >
                  {sections.index && indexRows.length > 0 && (
                    <section className="psc-part">
                      <SectionHead
                        title="Guest Index"
                        note="Everyone attending, A to Z, with the table they are seated at."
                        eventTitle={eventTitle}
                        count={indexRows.length}
                      />
                      <div className="psc-cols" style={{ columnCount: colsFor(indexRows.length, 9), columnGap: '9mm' }}>
                        {indexGroups.map((g) => (
                          <div key={g.letter} className="psc-idx-group">
                            <p className="psc-idx-letter">{g.letter}</p>
                            {g.rows.map((row) => <IndexRow key={row.key} row={row} fontSize={idxFont} />)}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {sections.tables && roster.length > 0 && (
                    <section className="psc-part">
                      <SectionHead
                        title="Table Assignments"
                        note={`${seatedGuests} of ${totalCapacity || '—'} seats filled across ${tableCount} table${tableCount === 1 ? '' : 's'}.`}
                        eventTitle={eventTitle}
                        count={tableCount}
                      />
                      <div className="psc-cols" style={{ columnCount: colsFor(roster.length, 4), columnGap: '9mm' }}>
                        {roster.map((t) => <TableBlock key={t.id} table={t} fontSize={rosterFont} />)}
                      </div>
                    </section>
                  )}

                  {sections.unseated && (unseatedParties || []).length > 0 && (
                    <section className="psc-part">
                      <SectionHead
                        title="Awaiting a Table"
                        note="Attending, with no seat assigned yet. The figure is how many people arrive in the party."
                        eventTitle={eventTitle}
                        count={unseatedCount}
                      />
                      <div className="psc-cols" style={{ columnCount: colsFor(unseatedParties.length, 9), columnGap: '9mm' }}>
                        {[...(unseatedParties || [])].sort((a, b) => byName(a.name, b.name)).map((p) => (
                          <div key={p.id} className="psc-idx-row psc-item" style={{ fontSize: idxFont }}>
                            <span className="psc-idx-name" style={{ unicodeBidi: 'plaintext' }}>{p.name}</span>
                            <span className="psc-dots" aria-hidden="true" />
                            <span className="psc-idx-table">{p.size}<span style={{ opacity: 0.45, fontWeight: 600 }}> pax</span></span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  <PrintFooter />
                </Sheet>
              )}

              {sections.cards && roster.length > 0 && (
                <Sheet
                  innerRef={(n) => { sheetRefs.current.cards = n; }}
                  pages={pageCounts.cards || 1}
                  label="Table cards"
                >
                  <SectionHead
                    title="Table Cards"
                    note="Cut along the rules and stand one on each table."
                    eventTitle={eventTitle}
                    count={tableCount}
                  />
                  <div className="psc-cards">
                    {roster.map((t) => (
                      <TableCard
                        key={t.id}
                        table={t}
                        eventTitle={eventTitle}
                        // Two to a landscape page, three to a portrait one, with
                        // the section head's height taken off the first.
                        heightMm={(geom.contentH - 16) / (orientation === 'landscape' ? 2 : 3)}
                      />
                    ))}
                  </div>
                  {/* No footer here either, for the opposite reason to the plan
                      page: these sheets get cut up, so a credit at the foot of
                      the page ends up in the bin with the offcut. */}
                </Sheet>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
