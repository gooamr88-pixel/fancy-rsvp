import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      /**
       * A NAME THAT DOES NOT EXIST IS AN ERROR, NOT A STYLE PREFERENCE.
       *
       * `next/core-web-vitals` does not enable this — it is aimed at TypeScript,
       * where the compiler already answers the question. This is a JavaScript
       * codebase with no such compiler, so nothing was asking it at all.
       *
       * What that cost: /admin/checkin-devices shipped `onRefresh={load}` against
       * a function actually named `reload`. It threw
       * `ReferenceError: load is not defined` while building the JSX, so the page
       * never mounted for anybody — the operator got the App Router's error
       * boundary and its "Try again" button, which reads as a flaky network
       * rather than a screen that has never once worked. Running eslint on that
       * exact file exited 0 with no output.
       *
       * It is not covered by anything else either: scripts/parseCheck.js only
       * proves a file PARSES, and this one parsed perfectly.
       *
       * Turning it on found no other violations anywhere under src/ — it is a
       * ratchet against the next one, not a cleanup. Browser and Node globals
       * come from eslint-config-next's own languageOptions, so this needs no
       * `globals` block and no new dependency; verified by linting a file that
       * only touches `window`/`process` and one that references a name that does
       * not exist, and getting silence from the first and an error from the
       * second.
       */
      "no-undef": "error",
    },
  },
  {
    /**
     * The test tree runs under vitest with `globals: true` (see
     * vitest.config.mjs), so `describe` / `it` / `expect` and friends are
     * genuinely in scope there without being imported. eslint has no way to know
     * that, so enabling `no-undef` above reported them as undefined.
     *
     * Found by exactly one file — test/shots/landingPageProbe.dump.jsx imports
     * `{ describe, it, vi, beforeEach }` but calls a bare `expect`, which is
     * correct at runtime and looked like a bug from here. Every other test file
     * happens to import what it uses, which would have made this look fine right
     * up until somebody relied on the globals the runner already provides.
     *
     * Declared by hand rather than pulling in the `globals` package for one
     * list: this is the whole vitest surface and it does not move.
     */
    files: ["test/**/*.{js,jsx,mjs}"],
    languageOptions: {
      globals: {
        suite: "readonly", test: "readonly", describe: "readonly", it: "readonly",
        expect: "readonly", assert: "readonly", vitest: "readonly", vi: "readonly",
        beforeAll: "readonly", afterAll: "readonly",
        beforeEach: "readonly", afterEach: "readonly",
        onTestFailed: "readonly", onTestFinished: "readonly",
      },
    },
  },
]);

export default eslintConfig;
