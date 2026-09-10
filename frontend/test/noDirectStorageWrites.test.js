import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/* ═══════════════════════════════════════════════════════════════════════════
   NOTHING IN THE BROWSER MAY WRITE TO STORAGE DIRECTLY.

   `NEXT_PUBLIC_SUPABASE_ANON_KEY` is compiled into this bundle, so anything the
   browser can do with it, any visitor can do. Until 2026-09-10 the app uploaded
   with that key, which meant the bucket's `allow_insert_images` policy had to
   grant INSERT to `anon` — and it could not be revoked, because the product
   itself depended on it. This platform has no Supabase Auth (Monthly Active
   Users reads 0), so every upload it made WAS anonymous.

   All uploads now go through POST /api/v1/uploads, authenticated by the app's
   own session cookie and executed server-side with the service role. That is
   what allows the anon INSERT grant to be dropped.

   ── WHY THIS IS A TEST AND NOT A NOTE IN A README ──

   The failure is invisible. Re-adding `supabase.storage.…upload()` to one
   component would work perfectly in development and in production — right up
   until the anon policy is revoked, at which point that one uploader breaks and
   nothing else does. Six months later nobody connects the two.

   Modelled on the existing "the demo cannot write" test, for the same reason:
   some invariants are only enforceable by reading the source.
   ═══════════════════════════════════════════════════════════════════════════ */

const SRC = path.join(process.cwd(), 'src');

/**
 * Strip comments before scanning, or this test reads the PROSE.
 *
 * The first version of this file failed on two sources, and both were innocent:
 * `utils/uploadAsset.js` and `dashboard/components/EventSettings.js` each carry
 * a comment EXPLAINING that they used to call `supabase.storage` and no longer
 * do. Documenting the ban was being reported as breaking it.
 *
 * That is the second time this exact mistake has been made in this repo —
 * backend/test/dbHardeningChain.test.js flagged a migration for a comment
 * warning against the very pattern it enforces. A source scanner that does not
 * strip comments will eventually accuse the person who wrote the warning.
 *
 * `[^\n\r]` rather than `.` on the line-comment branch: some of these files are
 * CRLF, and a JS regex `.` does not match `\r`, so `//.*$` leaves the carriage
 * return and can swallow the newline handling in subtle ways.
 *
 * A regex is not a JS parser: a `//` inside a string literal is stripped too.
 * That direction is safe here — it can only ever REMOVE text from the haystack,
 * so the worst case is a missed detection in a file that embeds source code in
 * a string, which none of these do. The opposite trade (false accusations) is
 * the one that wastes people's time.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n\r]*/g, '');
}

/** Every .js/.jsx under src/, as [relativePath, codeWithoutComments]. */
function sourceFiles() {
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(entry.name)) {
        out.push([
          path.relative(SRC, full).replace(/\\/g, '/'),
          stripComments(fs.readFileSync(full, 'utf8')),
        ]);
      }
    }
  }(SRC));
  return out;
}

describe('the browser cannot write to Supabase Storage', () => {
  const files = sourceFiles();

  it('finds source files at all (the walk is not silently empty)', () => {
    // Without this the assertions below pass vacuously if the tree moves.
    expect(files.length).toBeGreaterThan(100);
  });

  it('the scanner can still detect a violation (it is not blinded by stripComments)', () => {
    /**
     * The guard on the guard. `stripComments` was added to stop false positives,
     * and a stripper that is slightly too greedy would silently delete real code
     * and make every assertion below pass forever.
     *
     * So: run the same regexes over a synthetic file that genuinely violates
     * each rule, and require that they still fire.
     */
    const violating = stripComments(`
      import { supabase } from '../../utils/supabaseClient';
      export async function bad(file) {
        await supabase.storage.from('event-assets').upload('x/y.jpg', file);
      }
    `);
    expect(/supabase\s*(\?\.)?\s*\.\s*storage/.test(violating)).toBe(true);
    expect(/from\s+['"][^'"]*supabaseClient['"]/.test(violating)).toBe(true);
  });

  it('no component calls supabase.storage', () => {
    const offenders = files
      .filter(([rel]) => rel !== 'app/utils/supabaseClient.js')
      .filter(([, src]) => /supabase\s*(\?\.)?\s*\.\s*storage/.test(src))
      .map(([rel]) => rel);

    expect(offenders, (
      'These write to Storage with the anon key that ships in the browser bundle. '
      + 'Upload through POST /api/v1/uploads instead — see src/app/utils/uploadAsset.js. '
      + 'Leaving one caller here means the bucket must stay writable by anyone.'
    )).toEqual([]);
  });

  it('no component imports the anon Supabase client', () => {
    const offenders = files
      .filter(([rel]) => rel !== 'app/utils/supabaseClient.js')
      .filter(([, src]) => /from\s+['"][^'"]*supabaseClient['"]/.test(src))
      .map(([rel]) => rel);

    expect(offenders, (
      'The anon client has no remaining legitimate use in this app: uploads go '
      + 'through the API, and every read already did. An import here is the first '
      + 'step back to an anon-writable bucket.'
    )).toEqual([]);
  });

  it('no uploader falls back to embedding a file as a base64 data URI', () => {
    /**
     * The removed fallback caught a failed upload and stored the file as a
     * `data:` URI in a database column instead. That is re-sent through the API
     * on EVERY page load, inflated ~33% by the encoding, and cacheable by
     * nothing — one image down that path cost more egress than a hundred
     * uploaded properly, while looking like a success.
     *
     * Matched narrowly: `readAsDataURL` is legitimate for previews. What is
     * banned is reading a file as a data URI in the same breath as an upload
     * failing, which in practice always appeared as a `catch` containing it.
     */
    const offenders = files
      .filter(([, src]) => /catch[\s\S]{0,600}?readAsDataURL/.test(src))
      .map(([rel]) => rel);

    expect(offenders, (
      'An upload failure must be visible, not silently converted into an '
      + 'uncacheable base64 blob in a database row.'
    )).toEqual([]);
  });
});
