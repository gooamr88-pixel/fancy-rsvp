/**
 * Does every source file still PARSE?
 *
 * WHY THIS EXISTS
 *
 * A syntax error shipped to a deploy while `npx vitest run` reported 612
 * passing tests. The suite never caught it because no test imports
 * `dashboard/seating-map/page.js` — and most route files in this app are never
 * imported by a test. A green suite is evidence about the files the tests
 * reach, and says nothing at all about the rest.
 *
 * The error itself was an import inserted INSIDE another multi-line import:
 *
 *     import {
 *     import { formatInZone } from '../../utils/timezone';
 *       WORLD_W, WORLD_H, ...
 *     } from '../../utils/seatingGeometry';
 *
 * `next build` catches that — in about ten minutes. This catches it in about
 * two seconds, which is the difference between a check that runs and one that
 * gets skipped.
 *
 * WHAT IT DOES AND DOES NOT PROVE
 *
 * It proves every file is syntactically valid ES module + JSX. Because an
 * `import` statement is only legal at the top level of a module, that also
 * rules out the whole class of misplaced-import bugs above — one inside a
 * function body or another import is a parse error, not a runtime surprise.
 *
 * It does NOT type-check, resolve module specifiers, or evaluate anything. A
 * file importing a name that does not exist still parses. `next build` remains
 * the authority before a deploy; this is the fast gate that keeps obvious
 * breakage from ever getting that far.
 *
 *   node scripts/parseCheck.js        # exits non-zero on any parse error
 *   node scripts/parseCheck.js DIR    # check DIR instead of src/
 *
 * ── WHY THE DIRECTORY IS AN ARGUMENT ──
 *
 * Only its own test uses it, and for a reason worth stating. That test proves
 * the checker still FAILS on a file that cannot parse, which means writing a
 * deliberately broken file somewhere the walk reaches. Writing it into the live
 * `src/` tree worked, and raced: three other test files walk the same tree and
 * read every file in it, in sibling vitest workers, and any of them landing
 * between the decoy's creation and its deletion crashed with ENOENT — a red
 * suite on a green codebase, on a schedule nobody could predict.
 *
 * With a root argument the decoy goes in a temp directory and touches nothing
 * shared. The default is unchanged, so every caller keeps working.
 */
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const CUSTOM_ROOT = Boolean(process.argv[2]);
const ROOT = CUSTOM_ROOT
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', 'src');
const REPORT_BASE = CUSTOM_ROOT ? ROOT : path.join(__dirname, '..');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = walk(ROOT);
const failures = [];

for (const file of files) {
  try {
    // `loader: 'jsx'` rather than 'js': every route file here is JSX, and the
    // js loader would report the first tag as a syntax error in all of them.
    esbuild.transformSync(fs.readFileSync(file, 'utf8'), {
      loader: 'jsx',
      jsx: 'automatic',
      format: 'esm',
    });
  } catch (err) {
    const first = (err.errors || [])[0];
    failures.push({
      // Relative to the project when checking src/, relative to the given root
      // otherwise — a custom root can be anywhere, and "../../../AppData/..."
      // tells a reader nothing.
      file: path.relative(REPORT_BASE, file).replace(/\\/g, '/'),
      line: first?.location?.line,
      text: first?.text || err.message,
    });
  }
}

if (failures.length === 0) {
  console.log(`ok — ${files.length} files parse`);
  process.exit(0);
}

console.error(`${failures.length} file(s) failed to parse:\n`);
for (const f of failures) {
  console.error(`  ${f.file}${f.line ? `:${f.line}` : ''}`);
  console.error(`      ${f.text}\n`);
}
process.exit(1);
