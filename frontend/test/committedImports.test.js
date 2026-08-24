import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/* ═══════════════════════════════════════════════════════════════════════════
   EVERY RELATIVE IMPORT IN **HEAD** RESOLVES TO A FILE **HEAD** HAS.

   This exists because two separate deploys have now failed on the same class
   of bug, and neither the test suite nor the parse check could see either one:

     2026-08-17  An unanchored `templates/` in .gitignore silently refused to
                 track SwanLakeHero.js. The module was on disk, every test
                 passed, and the server failed with "Can't resolve
                 '../cinematic/SwanLakeHero'".

     2026-08-25  LetterFrameHero.js was renamed to LetterPortraitHero.js. The
                 rename was staged; the edit to HeritageArchPage.js that stops
                 importing the old name was NOT. A commit took the staged half,
                 so HEAD deleted the file AND kept the import of it. Same error
                 message, entirely different cause.

   What both have in common is that the WORKING TREE was fine. Every existing
   guard reads the working tree — the parse check, the import-smoke tests, the
   `git ls-files` assertion in sealedLetterTemplate.test.jsx (which only asks
   whether a named list of files is tracked, not whether the code that imports
   them still compiles). A half-committed tree is invisible to all of them and
   visible to the build server immediately.

   So this one asks git about git: it reads the imports out of HEAD and checks
   them against the files in HEAD. It is deliberately blind to the working
   tree, which is the whole point.

   ── Cost ─────────────────────────────────────────────────────────────────
   Two subprocesses, not a directory walk. `git grep` searches the commit
   directly and `git ls-tree` lists it; neither touches the filesystem tree.
   That matters — the suite already has five whole-tree walks racing each other
   (see vitest.config.mjs), and this must not become a sixth.
   ═══════════════════════════════════════════════════════════════════════════ */

const REPO = path.join(process.cwd(), '..');
const SCOPE = 'frontend/src';

/** Extensions a bare specifier may resolve to, in the order bundlers try. */
const CANDIDATES = ['', '.js', '.jsx', '.ts', '.tsx', '/index.js', '/index.jsx'];

function git(args) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

describe('the committed tree can actually build', () => {
  it('every relative import in HEAD points at a file HEAD contains', () => {
    let tracked;
    let hits;
    try {
      tracked = new Set(
        git(['ls-tree', '-r', 'HEAD', '--name-only', '--', SCOPE])
          .split('\n').map((s) => s.trim()).filter(Boolean),
      );
      /* -I so binary-ish blobs are skipped, -n for the line number, and the
         pattern deliberately matches both `from '...'` and `import('...')`. */
      hits = git([
        'grep', '-n', '-I', '-E',
        "(from|import\\()\\s*['\"]\\.\\.?/",
        'HEAD', '--', SCOPE,
      ]);
    } catch (err) {
      // `git grep` exits 1 when it matches nothing, and git is absent in a
      // tarball or a sandbox. Neither is a failure of the codebase.
      if (!tracked || !tracked.size) return;
      hits = err.stdout || '';
    }

    const missing = [];
    for (const line of hits.split('\n')) {
      if (!line.trim()) continue;
      // HEAD:frontend/src/.../File.js:14:import X from '../y/Z';
      const m = line.match(/^HEAD:([^:]+):\d+:(.*)$/);
      if (!m) continue;
      const [, file, code] = m;

      for (const spec of [...code.matchAll(/['"](\.\.?\/[^'"]+)['"]/g)].map((x) => x[1])) {
        // Assets are resolved by the bundler's loaders, not by this rule.
        if (/\.(css|scss|json|svg|png|jpe?g|webp|mp4|woff2?)$/.test(spec)) continue;

        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
        const found = CANDIDATES.some((ext) => tracked.has(resolved + ext));
        if (!found) missing.push(`${file} imports '${spec}' → ${resolved} (not in HEAD)`);
      }
    }

    expect(
      missing,
      'HEAD imports modules HEAD does not contain — the build server will fail even though the working tree is fine',
    ).toEqual([]);
  });
});
