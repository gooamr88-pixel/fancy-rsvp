import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/* ═══════════════════════════════════════════════════════════════════════════
   A COMPONENT MUST NOT READ THE SEATING PAGE'S STATE BY NAME.

   The seating map's print preview was dead for everyone, on every device: the
   Print/Export button opened the dashboard's black error boundary instead of
   the chart.

   The cause was one missing prop. `PrintLetterhead` is a top-level function and
   it read `eventTimezone` — a `useState` local belonging to the PAGE component,
   a different scope entirely. The identifier resolved nowhere, so every render
   threw ReferenceError.

   What makes this worth a test rather than a fix-and-move-on is that NOTHING in
   the toolchain objected. `next build` does not scope-analyse, so the build was
   green. eslint exits 0 on this project without checking anything. The full
   vitest suite was green too, because no test ever rendered that modal. A
   feature can be completely broken here with every signal reading healthy.

   So this asserts the property directly, from the source: no top-level function
   in either print-related module may reference a name that only exists inside
   the page component. It is deliberately about the files as a whole rather than
   about `PrintLetterhead`, because the next occurrence will be in a different
   component.

   ── WHY TWO FILES ──
   The printed pack now lives in its own module. Moving it out does not weaken
   the property, it widens it: a free variable in a separate module is exactly
   as undefined at runtime, and it is exactly as invisible to the build. The
   page's hook locals are still the reference set, because they are still the
   names most likely to be reached for by mistake.
   ═══════════════════════════════════════════════════════════════════════════ */

const SEATING = path.join(process.cwd(), 'src', 'app', 'dashboard', 'seating-map');
const PAGE = path.join(SEATING, 'page.js');
const PRINT = path.join(SEATING, 'SeatingChartPrint.js');

/**
 * Comments and string/template literals are removed before any identifier
 * matching. Without this the check drowns in prose: these files name `shape`,
 * `guests` and `elements` constantly in their commentary, and every mention
 * would read as a scope violation.
 */
function stripNonCode(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

/** The page component's own body — from its declaration to its closing brace. */
const PAGE_COMPONENT = 'SeatingMapPage';
function pageComponentBody(code) {
  const lines = code.split('\n');
  const start = lines.findIndex((l) => new RegExp(`function ${PAGE_COMPONENT}\\s*\\(`).test(l));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^\}/.test(lines[end])) end += 1;
  return lines.slice(start, end + 1).join('\n');
}

/**
 * Names created by hooks INSIDE the page component.
 *
 * Scoped to that function's body rather than to "every two-space-indented hook
 * in the file", which is what it used to be. Every other top-level function in
 * page.js is also indented two spaces inside itself, so `AddElementModal`'s own
 * `const [capacity, setCapacity] = useState(...)` was being collected as page
 * state — and the moment the scan widened to cover exported functions, that
 * mis-collection reported the page component as reading a name it declares two
 * lines above. A guard that cries wolf is a guard nobody reads.
 */
function pageComponentLocals(body) {
  const names = new Set();
  for (const line of (body || '').split('\n')) {
    const destructured = line.match(/^ {2}const \[([A-Za-z0-9_]+),\s*set[A-Za-z0-9_]*\]\s*=\s*useState/);
    if (destructured) names.add(destructured[1]);
    const single = line.match(/^ {2}const ([A-Za-z0-9_]+)\s*=\s*(useMemo|useRef|useCallback)\(/);
    if (single) names.add(single[1]);
  }
  return names;
}

/**
 * Every top-level `function Name(...) { ... }` with its body and bound names.
 *
 * `export` and `export default` are part of the pattern because the print
 * module exports most of its surface; without them the guard would silently
 * skip the very functions it was extended to cover — the failure mode this
 * whole file exists to avoid.
 */
function topLevelFunctions(code) {
  const lines = code.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(?:export\s+(?:default\s+)?)?function ([A-Za-z0-9_]+)\s*\(([^)]*)/);
    if (!m) continue;

    // Parameter list can wrap; collect until the closing paren of the signature.
    let sig = m[2];
    let j = i;
    while (!/\)\s*\{?\s*$/.test(lines[j]) && j < lines.length - 1) { j += 1; sig += lines[j]; }

    let end = j + 1;
    while (end < lines.length && !/^\}/.test(lines[end])) end += 1;

    const bound = new Set(
      sig.replace(/[{}[\]]/g, ' ').split(',')
        .map((s) => s.trim().split(/[:=]/)[0].trim())
        .filter(Boolean),
    );

    const body = lines.slice(i, end + 1).join('\n');
    // Anything the function declares for itself is equally fine.
    for (const line of body.split('\n')) {
      const c = line.match(/(?:const|let|var)\s+([A-Za-z0-9_]+)/);
      if (c) bound.add(c[1]);
      const d = line.match(/(?:const|let|var)\s*\{([^}]*)\}/);
      if (d) d[1].split(',').forEach((s) => bound.add(s.trim().split(/[:=]/)[0].trim()));
      const a = line.match(/(?:const|let|var)\s*\[([^\]]*)\]/);
      if (a) a[1].split(',').forEach((s) => bound.add(s.trim().split(/[:=]/)[0].trim()));
    }

    out.push({ name: m[1], line: i + 1, body, bound });
    i = end;
  }
  return out;
}

describe('the seating map print preview can actually render', () => {
  const pageRaw = fs.readFileSync(PAGE, 'utf8');
  const printRaw = fs.readFileSync(PRINT, 'utf8');
  const pageCode = stripNonCode(pageRaw);
  const printCode = stripNonCode(printRaw);
  const body = pageComponentBody(pageCode);
  const locals = pageComponentLocals(body);

  it('the page component really does own the state these checks are about', () => {
    // Guards the guard: if the hook style changes and this set comes back
    // empty, every assertion below would pass by finding nothing.
    expect(body, `${PAGE_COMPONENT} was renamed — the guard is scanning nothing`).toBeTruthy();
    expect(locals.size).toBeGreaterThan(10);
    expect(locals.has('eventTimezone')).toBe(true);
    // And it must be page state only: this one belongs to AddElementModal.
    expect(locals.has('capacity')).toBe(false);
  });

  it('the print module is actually being scanned', () => {
    // Same guard-the-guard reasoning. `topLevelFunctions` used to match only a
    // bare `function` at column 0; the print module exports nearly everything,
    // so an un-widened matcher would have found zero functions there and
    // reported a clean sheet.
    const names = topLevelFunctions(printCode).map((f) => f.name);
    expect(names).toContain('SeatingChartPrintModal');
    expect(names).toContain('PrintLetterhead');
    expect(names).toContain('buildGuestIndex');
  });

  it.each([
    ['page.js', () => pageCode],
    ['SeatingChartPrint.js', () => printCode],
  ])('%s: no top-level function reads a name that lives in the page component', (_label, getCode) => {
    const violations = [];

    for (const fn of topLevelFunctions(getCode())) {
      // The owner is allowed to read its own state; the property is about
      // everybody else.
      if (fn.name === PAGE_COMPONENT) continue;
      for (const name of locals) {
        if (fn.bound.has(name)) continue;
        // A bare identifier: not a property access (`el.shape`), not a key
        // (`shape:`), not a JSX prop name (`shape=`).
        const bare = new RegExp(`(^|[^A-Za-z0-9_.$])${name}(?![A-Za-z0-9_$:=])`, 'm');
        if (bare.test(fn.body)) violations.push(`${fn.name} (line ${fn.line}) reads "${name}"`);
      }
    }

    expect(
      violations,
      'These functions reference page-component state they never receive. Each one throws\n'
      + 'ReferenceError the moment it renders — which is exactly how the print preview\n'
      + 'shipped broken. Pass the value in as a prop:\n  ' + violations.join('\n  '),
    ).toEqual([]);
  });

  it('PrintLetterhead is handed the timezone it formats with', () => {
    // The specific regression, pinned by name as well: the letterhead prints
    // "Printed <date>" through formatInZone, which silently falls back to the
    // platform zone when handed undefined — so even a version that did not
    // throw would quietly stamp San Diego's date on a Cairo organizer's chart.
    const decl = printCode.match(/function PrintLetterhead\s*\(\{([^}]*)\}/);
    expect(decl, 'PrintLetterhead was renamed or its signature changed').toBeTruthy();
    expect(decl[1]).toMatch(/\beventTimezone\b/);

    const usage = printCode.match(/<PrintLetterhead[\s\S]*?\/>/);
    expect(usage, 'PrintLetterhead is never rendered').toBeTruthy();
    expect(usage[0]).toMatch(/eventTimezone=\{eventTimezone\}/);
  });

  it('the page hands the print modal everything it destructures', () => {
    // The same failure one level up: a prop the modal reads but the page never
    // passes is `undefined`, and `undefined.map` is the error boundary again.
    const decl = printCode.match(/export default function SeatingChartPrintModal\s*\(\{([\s\S]*?)\}\)/);
    expect(decl, 'the modal was renamed or its signature changed').toBeTruthy();
    const props = decl[1].split(',').map((s) => s.trim().split(/[:=]/)[0].trim()).filter(Boolean);
    expect(props.length).toBeGreaterThan(5);

    const usage = pageCode.match(/<SeatingChartPrintModal[\s\S]*?\/>/);
    expect(usage, 'the page never renders the print modal').toBeTruthy();
    const missing = props.filter((p) => !new RegExp(`\\b${p}=\\{`).test(usage[0]));
    expect(missing, `props the modal reads but the page never passes: ${missing.join(', ')}`).toEqual([]);
  });
});
