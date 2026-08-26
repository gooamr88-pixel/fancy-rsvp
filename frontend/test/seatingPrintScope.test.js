import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/* ═══════════════════════════════════════════════════════════════════════════
   A NESTED COMPONENT MUST NOT READ THE PAGE'S STATE BY NAME.

   The seating map's print preview was dead for everyone, on every device: the
   Print/Export button opened the dashboard's black error boundary instead of
   the chart.

   The cause was one missing prop. `PrintLetterhead` is a top-level function in
   the same file as the page component, and it read `eventTimezone` — a
   `useState` local belonging to the PAGE function, a different scope entirely.
   The identifier resolved nowhere, so every render threw ReferenceError.

   What makes this worth a test rather than a fix-and-move-on is that NOTHING
   in the toolchain objected. `next build` does not scope-analyse, so the build
   was green. eslint exits 0 on this project without checking anything. The
   full vitest suite was green too, because no test ever rendered that modal.
   A feature can be completely broken here with every signal reading healthy.

   So this asserts the property directly, from the source: no top-level
   function in the page module may reference a name that only exists inside the
   page component. It is deliberately about the file as a whole rather than
   about `PrintLetterhead`, because the next occurrence will be in a different
   component.
   ═══════════════════════════════════════════════════════════════════════════ */

const PAGE = path.join(
  process.cwd(), 'src', 'app', 'dashboard', 'seating-map', 'page.js',
);

/**
 * Comments and string/template literals are removed before any identifier
 * matching. Without this the check drowns in prose: the file's commentary
 * names `shape`, `guests` and `elements` constantly, and every mention would
 * read as a scope violation.
 */
function stripNonCode(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

/** Names created by hooks at the page component's own indent level. */
function pageComponentLocals(code) {
  const names = new Set();
  for (const line of code.split('\n')) {
    const destructured = line.match(/^ {2}const \[([A-Za-z0-9_]+),\s*set[A-Za-z0-9_]*\]\s*=\s*useState/);
    if (destructured) names.add(destructured[1]);
    const single = line.match(/^ {2}const ([A-Za-z0-9_]+)\s*=\s*(useMemo|useRef|useCallback)\(/);
    if (single) names.add(single[1]);
  }
  return names;
}

/** Every top-level `function Name(...) { ... }` with its body and bound names. */
function topLevelFunctions(code) {
  const lines = code.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^function ([A-Za-z0-9_]+)\s*\(([^)]*)/);
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
  const raw = fs.readFileSync(PAGE, 'utf8');
  const code = stripNonCode(raw);
  const locals = pageComponentLocals(code);

  it('the page component really does own the state these checks are about', () => {
    // Guards the guard: if the hook style changes and this set comes back
    // empty, every assertion below would pass by finding nothing.
    expect(locals.size).toBeGreaterThan(10);
    expect(locals.has('eventTimezone')).toBe(true);
  });

  it('no top-level function reads a name that lives in the page component', () => {
    const violations = [];

    for (const fn of topLevelFunctions(code)) {
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
      `These functions reference page-component state they never receive. Each one throws\n`
      + `ReferenceError the moment it renders — which is exactly how the print preview\n`
      + `shipped broken. Pass the value in as a prop:\n  ${violations.join('\n  ')}`,
    ).toEqual([]);
  });

  it('PrintLetterhead is handed the timezone it formats with', () => {
    // The specific regression, pinned by name as well: the letterhead prints
    // "Printed <date>" through formatInZone, which silently falls back to the
    // platform zone when handed undefined — so even a version that did not
    // throw would quietly stamp San Diego's date on a Cairo organizer's chart.
    const decl = code.match(/function PrintLetterhead\s*\(\{([^}]*)\}/);
    expect(decl, 'PrintLetterhead was renamed or its signature changed').toBeTruthy();
    expect(decl[1]).toMatch(/\beventTimezone\b/);

    const usage = code.match(/<PrintLetterhead[^>]*>/);
    expect(usage, 'PrintLetterhead is never rendered').toBeTruthy();
    expect(usage[0]).toMatch(/eventTimezone=\{eventTimezone\}/);
  });
});
