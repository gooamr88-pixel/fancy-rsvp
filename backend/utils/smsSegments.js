/**
 * SMS segmentation + safe template interpolation.
 *
 * Carriers bill per *segment*, not per message: a single SMS holds 160 GSM-7
 * characters (70 for Unicode/UCS-2); longer bodies are split into concatenated
 * segments of 153 (GSM-7) / 67 (UCS-2) chars each. Charging "1 credit per message"
 * silently under-bills multi-segment sends. These helpers compute the true segment
 * count so the wallet is debited for the exact cost.
 */

// GSM 03.38 basic set — each char is one 7-bit septet.
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_BASIC_SET = new Set(Array.from(GSM_BASIC));
// Extension chars cost two septets (they are escape-prefixed on the wire).
const GSM_EXT_SET = new Set(['^', '{', '}', '\\', '[', '~', ']', '|', '€']);

/**
 * Classify a message body and count its billable segments.
 * @returns {{ encoding: 'GSM-7'|'UCS-2', length: number, segments: number, perSegment: number }}
 */
function computeSmsSegments(text) {
  const body = text == null ? '' : String(text);
  if (body.length === 0) return { encoding: 'GSM-7', length: 0, segments: 1, perSegment: 160 };

  let isGsm = true;
  let gsmUnits = 0;
  for (const ch of body) {
    if (GSM_BASIC_SET.has(ch)) gsmUnits += 1;
    else if (GSM_EXT_SET.has(ch)) gsmUnits += 2;
    else { isGsm = false; break; }
  }

  if (isGsm) {
    const segments = gsmUnits <= 160 ? 1 : Math.ceil(gsmUnits / 153);
    return { encoding: 'GSM-7', length: gsmUnits, segments: Math.max(1, segments), perSegment: gsmUnits <= 160 ? 160 : 153 };
  }

  // UCS-2: count UTF-16 code units (an emoji = 2 units, matching carrier behaviour).
  const units = body.length;
  const segments = units <= 70 ? 1 : Math.ceil(units / 67);
  return { encoding: 'UCS-2', length: units, segments: Math.max(1, segments), perSegment: units <= 70 ? 70 : 67 };
}

/**
 * Render a message template against a values map.
 *
 * Supports both `{tag}` and `{{tag}}` syntaxes, is case-insensitive, and — crucially —
 * uses a *function* replacer so guest-supplied values containing `$` sequences
 * (e.g. "$5", "A$&B") can never be misread as `String.replace` special patterns.
 * Unknown tags are left intact rather than blanked, so typos are visible.
 *
 * ── This function had no callers for a while, and was kept ──
 *
 * It was written for the free-text campaign blaster, which the four-type rebuild
 * deleted. From then until the organizer-authored bodies shipped it was reachable
 * from nowhere — the kind of orphan a dead-code sweep removes on sight.
 *
 * Deleting it would have been the wrong call, and the `$` note above is why. The
 * obvious re-implementation is `template.replace(/\{(\w+)\}/g, values[key])` with
 * a STRING replacement, and that version is silently wrong: a guest called
 * "A$&B", or a table named "$5 Room", makes `$&` expand to the matched text and
 * corrupts the message. It is a bug that appears only for the handful of guests
 * whose data contains a dollar sign, which is to say it appears in production and
 * never in a test.
 *
 * @param {string} template
 * @param {Record<string, string|number|null|undefined>} values  keys should be lowercase
 */
function renderTemplate(template, values = {}) {
  if (template == null) return '';
  return String(template).replace(/\{\{?\s*([a-zA-Z0-9_]+)\s*\}?\}/g, (match, rawKey) => {
    const key = String(rawKey).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      const v = values[key];
      return v == null ? '' : String(v);
    }
    return match;
  });
}

/* `SUPPORTED_TAGS` lived here and has moved to config/smsMergeTags.js.
 *
 * It was a flat array of seven strings — ['name', 'url', 'rsvp_link',
 * 'table_number', 'table', 'event', 'event_name'] — with no callers, and by the
 * time anything wanted to use it three of those tags named nothing any template
 * produces, two were duplicate names for one value, and none could reach a
 * guest's table, companions, meals or entry pass.
 *
 * A tag list also cannot be flat: which tags are offered depends on the message
 * type (`{table}` is meaningless in an invitation, where nobody is seated yet),
 * and each tag needs a clip ceiling so the composer can price a body at its
 * worst case rather than at whatever sample the organizer happened to preview.
 * That is a table, not an array, and it belongs next to the type registry it
 * mirrors.
 */

module.exports = { computeSmsSegments, renderTemplate };
