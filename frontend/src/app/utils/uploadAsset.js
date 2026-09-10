import { apiFetch } from './apiClient';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UPLOAD THROUGH OUR OWN API, NOT STRAIGHT INTO THE BUCKET
 *
 * Every uploader in this app used to call
 *
 *     supabase.storage.from('event-assets').upload(path, file, …)
 *
 * with `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which is compiled into this bundle.
 * Three consequences, all measured on 2026-09-10 rather than supposed:
 *
 *   • Anyone who opened the site could write to the bucket. The Storage policy
 *     `allow_insert_images` grants INSERT to `anon`, and it could not be revoked
 *     while the product itself depended on it — this platform has no Supabase
 *     Auth, so every upload it made WAS anonymous.
 *   • Nothing was resized. Gallery photos averaged 1,469 kB and ran to 7,994 kB,
 *     served at their full size to every guest. 8.7 GB of egress in six days is
 *     what got this project's services restricted.
 *   • Every upload minted a fresh `wizard-<timestamp>` name, so the same file
 *     was stored again and again — 19 music objects, 10 distinct by SHA-256,
 *     one track present five times.
 *
 * The server endpoint fixes all three: it authenticates with the app's own
 * session, resizes and re-encodes with sharp, and names the object after a hash
 * of its processed bytes so identical content can only ever occupy one key.
 *
 * ── THE FALLBACK THAT WAS REMOVED, AND WHY ──
 *
 * The old helper caught upload failures and embedded the image as a base64
 * `data:` URI in a database column instead. It meant a broken bucket never
 * surfaced — and every page load then re-sent that image through the API,
 * inflated 33% by base64 and impossible to cache. One image down that path cost
 * more than a hundred uploaded properly.
 *
 * A visible failure is better than an invisible cost. This throws.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Kinds the server accepts. Mirrors KINDS in backend/controllers/uploadController.js. */
export const UPLOAD_KINDS = [
  'cover', 'gallery', 'portrait', 'logo', 'seal', 'invitation-bg', 'venue',
  'shop', 'shop-category', 'blog-cover', 'testimonial', 'press-logo', 'music',
];

/**
 * The server's own ceiling, repeated here so the file is rejected before it is
 * sent rather than after 12 MB has crossed the wire and come back a 413.
 */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/**
 * Upload one file and resolve to its public URL.
 *
 * @param {File|Blob} file
 * @param {string} kind one of UPLOAD_KINDS — decides the folder AND the
 *        permitted content types, server-side. The caller no longer chooses a
 *        path: it used to, which made "where this writes" a client decision.
 * @returns {Promise<{url: string, bytes: number, originalBytes: number}>}
 * @throws {Error} with a message fit to show a person
 */
export async function uploadAsset(file, kind) {
  if (!file) throw new Error('No file selected.');
  if (!UPLOAD_KINDS.includes(kind)) throw new Error(`Unknown upload kind "${kind}".`);

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `${file.name || 'That file'} is ${(file.size / 1048576).toFixed(1)} MB. `
      + `The limit is ${MAX_UPLOAD_BYTES / 1048576} MB.`,
    );
  }
  if (file.size === 0) throw new Error(`${file.name || 'That file'} is empty.`);

  /**
   * The raw bytes, with the file's own type as Content-Type.
   *
   * Not FormData and not base64. FormData would need a multipart parser on the
   * server; base64 would inflate every upload by a third on the exact axis —
   * bytes over the wire — this whole change exists to reduce.
   *
   * apiFetch only defaults Content-Type to JSON when the caller has not set one,
   * so passing it explicitly is enough to opt out.
   */
  /**
   * ── A LONGER DEADLINE THAN apiFetch'S DEFAULT 30 SECONDS ──
   *
   * apiFetch aborts every request after 30s. That is right for a JSON call and
   * wrong for this one: 12 MB over a hotel or mobile connection at ~500 kbps
   * takes about three minutes, and the old direct-to-Supabase upload had no
   * client-side cap at all. Keeping the default would have turned "move uploads
   * server-side" into "large photos now fail on slow connections", which is
   * exactly the kind of regression that only shows up on somebody else's phone.
   *
   * Passing our own signal is what opts out — apiFetch uses
   * `options.signal || controller.signal`, so a supplied signal replaces the
   * 30-second one entirely.
   *
   * Built by hand rather than with `AbortSignal.timeout()` so this does not
   * depend on a browser API newer than the rest of the bundle targets.
   */
  const uploadAbort = new AbortController();
  const deadline = setTimeout(() => uploadAbort.abort(), 3 * 60 * 1000);

  let res;
  try {
    res = await apiFetch(`/uploads/${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
      signal: uploadAbort.signal,
    });
  } catch (err) {
    // An abort surfaces as a bare "The user aborted a request", which tells the
    // organizer nothing about what to do next.
    if (err?.name === 'AbortError' || uploadAbort.signal.aborted) {
      throw new Error('The upload timed out. Check your connection, or try a smaller file.');
    }
    throw err;
  } finally {
    clearTimeout(deadline);
  }

  if (!res?.success || !res?.data?.url) {
    throw new Error(res?.message || 'The upload did not complete.');
  }
  return res.data;
}

/**
 * MANY files, sequentially, collecting failures instead of losing the batch.
 *
 * Sequential rather than Promise.all for the same two reasons the old helper
 * gave: parallel uploads from one browser get throttled, and the order they
 * finish in would otherwise decide the gallery's order. Each upload now also
 * costs the server a sharp encode, which is a second reason not to fire six at
 * once.
 *
 * @returns {Promise<{urls: string[], failures: string[]}>}
 */
export async function uploadMany(files, kind, onProgress) {
  const urls = [];
  const failures = [];

  for (let i = 0; i < files.length; i += 1) {
    try {
      const { url } = await uploadAsset(files[i], kind);
      urls.push(url);
    } catch (err) {
      failures.push(err?.message || `${files[i]?.name || 'A file'} failed to upload.`);
    }
    onProgress?.(i + 1, files.length);
  }

  return { urls, failures };
}

export default uploadAsset;
