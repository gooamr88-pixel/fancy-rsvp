import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/* ═══════════════════════════════════════════════════════════════════════════
   The frontend's first test setup.

   The backend has had ~30 test files for a long time; the frontend had none,
   and nothing stopped a change to the guest reveal — a pixel-positioned
   layout across five breakpoints that every single guest sees before anything
   else — from shipping broken.

   jsdom, not a browser: these are contract tests. They assert what the
   component PROMISES its callers (test ids, onComplete firing exactly once,
   session memory, the reduced-motion path), not what it looks like. jsdom
   cannot lay out an @container query or run a CSS transition, and pretending
   otherwise would produce tests that pass while the envelope is visibly
   broken. Appearance is covered separately — see visual-regression.md.
   ═══════════════════════════════════════════════════════════════════════════ */
export default defineConfig({
  /* This codebase writes JSX in plain .js files, which Next.js accepts and
     Vite's default esbuild pass does not. Widening the React plugin's include
     hands those files to Babel, which does. Renaming ~200 components to .jsx
     to satisfy the test runner would be the tail wagging the dog. */
  plugins: [react({ include: /\.(js|jsx|mjs)$/ })],
  // The plugin alone is not enough: Vite's own esbuild pass runs first and
  // rejects the file before Babel ever sees it, so esbuild has to be told to
  // read .js under src/ as JSX too.
  // Both trees, because setting `include` REPLACES Vite's default (which
  // already covered .jsx) rather than adding to it — scoping it to src/ alone
  // silently stopped the .jsx test files themselves from being transformed.
  // Matched on extension and narrowed by an exclude, rather than by directory:
  // these patterns run against absolute paths, and a directory-anchored one is
  // at the mercy of how the path separators come through on Windows. Note that
  // setting `include` REPLACES Vite's default (which already covered .jsx), so
  // it has to cover the test files as well as the source.
  esbuild: { loader: 'jsx', include: /\.[jt]sx?$/, exclude: /node_modules/ },
  optimizeDeps: { esbuildOptions: { loader: { '.js': 'jsx' } } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.{js,jsx}'],
    css: false,
    /**
     * 60s, not the 5s default, and this is about flakiness rather than slowness.
     *
     * ── Why it started at 15s ────────────────────────────────────────────────
     * The FIRST test in invitationReveal.test.jsx pays for the whole reveal module
     * graph — framer-motion, the artwork manifest, a jsdom document — inside its own
     * timed window, because that import is what the first render triggers. On its
     * own it lands in ~2s; in a full-suite run sharing a machine it was measured at
     * 6.4s and failed against the 5s default, then passed twice in isolation moments
     * later.
     *
     * ── Why it is now 60s ────────────────────────────────────────────────────
     * The suite has grown FIVE separate whole-tree walks — parseCheck (twice, via a
     * spawned child process), cinematicTemplates' third-party-residue scan, and
     * responsiveCheck (twice) — and they all read every file under src/ at once, in
     * parallel workers, on a machine that is already oversubscribed. Which one loses
     * the race is different on every run: three consecutive full runs failed on
     * three different tests, none of which had failed before, and all of which pass
     * alone in seconds.
     *
     * That was being patched one `it(..., N)` at a time, which is whack-a-mole with
     * a moving target and leaves five separate numbers to rediscover by failure.
     * One ceiling, raised here. Per-test overrides now exist only where the work is
     * genuinely heavier than the rest (see parseCheck.test.js and guestPreview's
     * beforeAll) — and any override BELOW this value is a mistake, because it makes
     * that test stricter than the suite it runs in.
     *
     * A test that fails only when other tests are running is worse than a slow one:
     * it teaches everybody to re-run the suite instead of reading it. The cost of a
     * higher ceiling is that a genuinely hung test takes longer to report, which is
     * the cheaper failure by a distance.
     */
    testTimeout: 60000,
    hookTimeout: 60000,
  },
  resolve: {
    alias: { '@': path.resolve(process.cwd(), 'src') },
  },
});
