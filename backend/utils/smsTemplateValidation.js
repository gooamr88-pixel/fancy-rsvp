/**
 * SAVE-TIME VALIDATION FOR ORGANIZER-AUTHORED SMS BODIES.
 *
 * An organizer writes a message once and it is sent to every guest on the list.
 * So the moment to catch "this costs four segments in Arabic" is when they press
 * Save, in the composer, next to the sentence that caused it — not on an invoice
 * three weeks later, and not as a per-guest skip in the send log.
 *
 * ── MEASURED AT THE CEILING, NOT AT THE PREVIEW ──
 *
 * The single most important thing here. An organizer previews their body against
 * whatever sample the UI shows, and the naive sample is short: "Sara", "12".
 * "Hi {name}, your table is {table}" measures as one comfortable GSM-7 segment
 * that way — and bills three for a guest called Abdulrahman Al-Otaibi seated at
 * "Garden Terrace 14".
 *
 * `worstCaseTagValues` renders every tag at the clip ceiling smsTemplates will
 * actually enforce, with links at the real length shortLinks produces. What this
 * module reports is therefore the maximum the organizer can ever be charged per
 * guest, which is the only number worth quoting.
 *
 * ── AND WITH THE REAL FOOTER ──
 *
 * `COMPLIANCE_FOOTER` is 78 characters and smsDispatch appends it to every body.
 * Measuring the organizer's text alone would understate a one-segment message by
 * half a segment in English and a whole one in Arabic. It is included here for
 * the same reason it is included in test/smsCopyBudget.test.js: the billed unit
 * is the message that leaves the building, not the part somebody typed.
 */

const { computeSmsSegments, renderTemplate } = require('./smsSegments');
const { tagsForType, worstCaseTagValues, getMergeTag } = require('../config/smsMergeTags');
const { getSmsType } = require('../config/smsMessageTypes');
const { COMPLIANCE_FOOTER } = require('../services/smsDispatch');

/**
 * The hard ceiling on a custom body, in segments, measured at worst case.
 *
 * ── WHY EIGHT, AND WHY IT IS NOT SIX ──
 *
 * The rule this number implements is "an organizer may write anything as
 * expensive as something we already send". So it is derived from the costliest
 * BUILT-IN body rather than picked.
 *
 * That body is `rsvp_confirmation`, and the note on it in
 * config/smsMessageTypes.js records it at 3 English segments and 6 Arabic. Six
 * was therefore the obvious ceiling — and it is wrong, because those figures are
 * a REALISTIC case and everything in this file is measured at the WORST one.
 * Rendered with every tag at its clip cap, the same body is:
 *
 *     rsvp_confirmation  EN  4 segments
 *     rsvp_confirmation  AR  7 segments      ← above a ceiling of 6
 *
 * A limit of six would have refused a message the platform itself sends, and the
 * composer would have opened showing "our version: 7 texts — limit 6", which
 * reads as a bug in the product rather than a budget.
 *
 * Eight is EXACTLY that worst case, with no headroom, and the precision is not
 * an accident — it was arrived at twice.
 *
 * Six came first, from the registry's realistic-case note (3 EN / 6 AR). Then
 * measuring at the ceiling gave 4 EN / 7 AR, so it became eight "= 7 plus one
 * segment of headroom". That was still wrong: the 7 came from rendering the
 * body against sampleContext, whose values are realistic rather than maximal.
 * Rendered against config/smsMergeTags.maxContext, the Arabic confirmation is
 * EIGHT. There is no headroom; the ceiling and the costliest built-in body are
 * the same number.
 *
 * That is the correct place for it — the rule is "as expensive as something we
 * already send", not "more" — and it makes the ceiling and the copy tightly
 * coupled on purpose: `templateCeilingCoversDefaults` in
 * test/smsTemplateOverride.test.js measures every built-in body at maxContext,
 * so any copy edit that pushes one past this fails loudly rather than silently
 * making the composer quote a limit below its own default.
 *
 * At the 3.0c list price an 8-segment message is 24c per guest: $48 for a
 * 200-guest list, for ONE send. That is the number the composer shows, and it is
 * why crossing it is a refusal rather than a warning.
 *
 * Env-overridable because it is a pricing decision, not a correctness one — the
 * same reasoning as the ceilings in smsCopyBudget.test.js being editable on
 * purpose.
 */
const MAX_TEMPLATE_SEGMENTS = Math.max(1, parseInt(process.env.SMS_TEMPLATE_MAX_SEGMENTS, 10) || 8);

/**
 * A raw-character cap applied BEFORE segment measurement.
 *
 * Belt and braces over the segment ceiling, and it catches a different failure:
 * a body pasted from a document can be tens of thousands of characters, and
 * measuring that through `computeSmsSegments` plus a full tag substitution on
 * every save is work we should decline to do rather than do quickly. It also
 * bounds what lands in the jsonb column.
 */
const MAX_TEMPLATE_CHARS = 1600;

/**
 * Every `{tag}` the organizer actually wrote, lowercased and deduplicated.
 *
 * The pattern mirrors renderTemplate's exactly — including the optional second
 * brace — because a tag this function does not see is a tag the renderer WILL
 * see, and reporting "unknown tag" for something that renders fine (or missing
 * one that does not) is worse than not checking at all.
 */
function extractTags(template) {
  const out = new Set();
  const re = /\{\{?\s*([a-zA-Z0-9_]+)\s*\}?\}/g;
  let match;
  while ((match = re.exec(String(template || ''))) !== null) {
    out.add(String(match[1]).toLowerCase());
  }
  return [...out];
}

/**
 * Measure a candidate body exactly as it would be billed.
 *
 * @returns {{segments:number, encoding:string, length:number, body:string}}
 */
function measureTemplate(type, template) {
  const values = worstCaseTagValues(type);
  const rendered = renderTemplate(template, values);
  const body = `${rendered}${COMPLIANCE_FOOTER}`;
  const { segments, encoding, length } = computeSmsSegments(body);
  return { segments, encoding, length, body };
}

/**
 * Is this body safe to persist?
 *
 * ── NO `lang` PARAMETER, DELIBERATELY ──
 *
 * It had one, and it was never read. That is worse than merely dead: a
 * `validateTemplate(type, lang, body)` signature states that validation is
 * language-aware — that Arabic might get its own ceiling, say — and it is not.
 * `computeSmsSegments` reads the encoding off the characters themselves, so an
 * Arabic body is measured as UCS-2 because it IS UCS-2, not because anybody
 * told this function which language it was.
 *
 * The caller still knows the language and uses it where it genuinely matters:
 * sanitizeSmsTemplates puts it in the error so the composer can highlight the
 * right editor.
 *
 * @returns {{ok:true, measured:object} | {ok:false, error:string, message:string, measured?:object}}
 */
function validateTemplate(type, template) {
  if (!getSmsType(type)) {
    return { ok: false, error: 'UNKNOWN_TYPE', message: `"${type}" is not a message type.` };
  }

  // Clearing the box is how an organizer returns to the built-in wording. It is
  // a valid save, not an empty-value error — see renderSmsBody's fallthrough.
  if (template === null || template === undefined || String(template).trim() === '') {
    return { ok: true, cleared: true, measured: null };
  }

  const text = String(template);

  if (text.length > MAX_TEMPLATE_CHARS) {
    return {
      ok: false,
      error: 'TEMPLATE_TOO_LONG',
      message: `That message is ${text.length} characters. The limit is ${MAX_TEMPLATE_CHARS}.`,
    };
  }

  const allowed = new Set(tagsForType(type).map((t) => t.tag));
  const unknown = extractTags(text).filter((tag) => !allowed.has(tag));
  if (unknown.length > 0) {
    /**
     * A tag that exists but is not offered for THIS type gets a different
     * sentence from one that does not exist at all, and the difference is what
     * makes the error actionable. "{table} is not available in an invitation —
     * nobody is seated yet" tells the organizer why; "unknown tag {table}"
     * sends them looking for a typo that is not there.
     */
    const detail = unknown.map((tag) => (getMergeTag(tag)
      ? `{${tag}} is not available in this message type`
      : `{${tag}} is not a known tag`)).join('; ');
    return { ok: false, error: 'UNKNOWN_TAG', message: `${detail}.` };
  }

  const measured = measureTemplate(type, text);
  if (measured.segments > MAX_TEMPLATE_SEGMENTS) {
    return {
      ok: false,
      error: 'TEMPLATE_TOO_EXPENSIVE',
      message: `At its longest this message is ${measured.segments} texts per guest (${measured.encoding}). The limit is ${MAX_TEMPLATE_SEGMENTS}. Shorten it, or remove a tag.`,
      measured,
    };
  }

  return { ok: true, measured };
}

/**
 * Validate and normalize a whole `{ type: { en, ar } }` patch.
 *
 * Known types and the two known languages ONLY, strings only — an organizer's
 * PATCH cannot introduce new keys or smuggle an object into the jsonb column.
 * Mirrors sanitizeSmsSettings' posture in config/smsMessageTypes.js.
 *
 * Cleared entries are written as `null` rather than dropped, so the merge in the
 * controller can tell "reset this one" apart from "I did not touch this one".
 *
 * @returns {{ok:true, templates:object, measured:object} | {ok:false, ...}}
 */
function sanitizeSmsTemplates(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'VALIDATION_ERROR', message: 'templates must be an object.' };
  }

  const templates = {};
  const measured = {};

  for (const [type, byLang] of Object.entries(raw)) {
    if (!getSmsType(type)) {
      return { ok: false, error: 'UNKNOWN_TYPE', message: `"${type}" is not a message type.` };
    }
    if (!byLang || typeof byLang !== 'object' || Array.isArray(byLang)) {
      return { ok: false, error: 'VALIDATION_ERROR', message: `templates.${type} must be an object of { en, ar }.` };
    }

    for (const lang of ['en', 'ar']) {
      if (!Object.prototype.hasOwnProperty.call(byLang, lang)) continue;
      const value = byLang[lang];
      if (value !== null && typeof value !== 'string') {
        return { ok: false, error: 'VALIDATION_ERROR', message: `templates.${type}.${lang} must be text.` };
      }

      const result = validateTemplate(type, value);
      if (!result.ok) return { ...result, type, lang };

      if (!templates[type]) templates[type] = {};
      templates[type][lang] = result.cleared ? null : String(value);
      if (result.measured) {
        if (!measured[type]) measured[type] = {};
        measured[type][lang] = {
          segments: result.measured.segments,
          encoding: result.measured.encoding,
          length: result.measured.length,
        };
      }
    }
  }

  return { ok: true, templates, measured };
}

module.exports = {
  MAX_TEMPLATE_SEGMENTS,
  MAX_TEMPLATE_CHARS,
  extractTags,
  measureTemplate,
  validateTemplate,
  sanitizeSmsTemplates,
};
