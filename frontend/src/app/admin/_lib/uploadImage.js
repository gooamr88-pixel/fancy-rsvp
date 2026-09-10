import { uploadAsset, uploadMany, MAX_UPLOAD_BYTES } from '../../utils/uploadAsset';

/**
 * Shared upload handlers for admin forms.
 *
 * ── WHAT CHANGED, AND WHY THE FALLBACK IS GONE ──
 *
 * These used to upload straight to Supabase Storage with the anon key and, when
 * that failed, silently embed the image as a base64 `data:` URI in a database
 * column instead. Both halves were problems, and the fallback was the worse one.
 *
 * A base64 image in a row is served through the API on EVERY page load, inflated
 * a third by the encoding, and cannot be cached by anything. One image down that
 * path cost more egress than a hundred uploaded properly — and because it looked
 * like a success, nobody ever found out it had happened. On 2026-09-10 this
 * project's services were restricted by Supabase for exceeding its egress
 * allowance; a silent path that multiplies egress on failure is exactly the kind
 * of thing that gets you there.
 *
 * (Checked before removing: both `events.cover_image_url` and
 * `organizations.logo_url` had ZERO rows containing a `data:` URI, so nothing in
 * production is relying on it today.)
 *
 * Uploads now go through the app's own API — authenticated by session, resized
 * and re-encoded server-side, and named by a hash of the resulting bytes so the
 * same image cannot be stored twice. See utils/uploadAsset.js.
 *
 * `pathPrefix` became `kind`: the server owns the folder mapping now. The client
 * choosing its own storage path was, with an anon-writable bucket, an
 * arbitrary-write primitive.
 */

export { MAX_UPLOAD_BYTES };

/**
 * Returns an <input type="file"> onChange handler bound to the caller's own
 * field/uploading state setters.
 *
 * @param {{
 *   kind: string,
 *   setField: (url: string) => void,
 *   setUploading: (busy: boolean) => void,
 *   showAlert: (msg: string, title: string, kind: string) => void,
 * }} opts
 */
export function makeImageUploadHandler({ kind, setField, setUploading, showAlert }) {
  return async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Clear the input so re-picking the SAME file fires change again. Without
    // it, retrying after an error looks like the uploader is dead.
    e.target.value = '';

    setUploading(true);
    try {
      const { url } = await uploadAsset(file, kind);
      setField(url);
    } catch (err) {
      showAlert(err?.message || 'The upload did not complete.', 'Upload Failed', 'error');
    } finally {
      setUploading(false);
    }
  };
}

/**
 * Uploads ONE file and resolves to its URL, or rejects — no state setters and
 * no alerts, so a caller handling many files can decide once what to say about
 * the batch rather than firing an alert per file.
 *
 * @returns {Promise<string>} public URL
 */
export async function uploadOneImage(file, kind) {
  const { url } = await uploadAsset(file, kind);
  return url;
}

/**
 * MANY files from one <input type="file" multiple> — a gallery, not a field.
 *
 * Still sequential. Parallel uploads from a browser get throttled, the order
 * they finish in would decide the gallery's order, and each one now costs the
 * server an image encode.
 *
 * @param {{
 *   kind: string,
 *   onImage: (url: string) => void,
 *   setUploading: (busy: boolean) => void,
 *   showAlert: (msg: string, title: string, kind: string) => void,
 *   setProgress?: (done: number, total: number) => void,
 * }} opts
 */
export function makeMultiImageUploadHandler({ kind, onImage, setUploading, showAlert, setProgress }) {
  return async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    e.target.value = '';

    setUploading(true);
    setProgress?.(0, files.length);

    const { urls, failures } = await uploadMany(files, kind, (done, total) => setProgress?.(done, total));
    urls.forEach((u) => onImage(u));

    setUploading(false);
    setProgress?.(0, 0);

    if (failures.length) {
      const added = files.length - failures.length;
      showAlert(
        `${added} of ${files.length} photos were added.\n\n${failures.join('\n')}`,
        failures.length === files.length ? 'Upload failed' : 'Some photos were not added',
        failures.length === files.length ? 'error' : 'warning',
      );
    }
  };
}

export default makeImageUploadHandler;
