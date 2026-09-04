/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ORGANIZER-AUTHORED SMS BODIES.
 *
 * An organizer can now rewrite the text of any message type, in either
 * language. Three things have to remain true no matter what they type, and each
 * one is a way the organizer or their guests get hurt if it stops being true:
 *
 *   the compliance footer survives   — an SMS without STOP/HELP is the thing
 *                                      that gets a toll-free number rejected
 *   the clip ceilings survive        — otherwise one long guest name doubles the
 *                                      bill for the entire list
 *   an empty override falls back     — "I cleared the box" must mean "use yours",
 *                                      never "send my guests a blank text"
 * ─────────────────────────────────────────────────────────────────────────────
 */
require('./helpers/env');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { renderSmsBody } = require('../utils/smsTemplates');
const { computeSmsSegments } = require('../utils/smsSegments');
const { COMPLIANCE_FOOTER } = require('../services/smsDispatch');
const {
  validateTemplate, sanitizeSmsTemplates, measureTemplate, extractTags,
  MAX_TEMPLATE_SEGMENTS, MAX_TEMPLATE_CHARS,
} = require('../utils/smsTemplateValidation');
const { tagsForType, sampleContext, buildTagValues } = require('../config/smsMergeTags');
const { SMS_MESSAGE_TYPES } = require('../config/smsMessageTypes');

/* ── Rendering ───────────────────────────────────────────────────────────── */

test('an override replaces the built-in body and interpolates its tags', () => {
  const body = renderSmsBody('invitation', 'en', {
    guestName: 'Sara', eventTitle: 'The Wedding', rsvpUrl: 'https://fncy.rs/a1b2c3d',
  }, { override: 'Hi {name}, join us at {event}: {rsvp_link}' });

  assert.equal(body, 'Hi Sara, join us at The Wedding: https://fncy.rs/a1b2c3d');
});

test('both brace syntaxes work, and tag names are case-insensitive', () => {
  // renderTemplate accepts {tag} and {{tag}}; the composer only emits the first,
  // but an organizer pasting from another tool will produce the second.
  const body = renderSmsBody('invitation', 'en', { guestName: 'Sara' },
    { override: '{name} / {{name}} / {NAME}' });
  assert.equal(body, 'Sara / Sara / Sara');
});

test('an empty, blank or absent override falls back to the built-in body', () => {
  const context = { guestName: 'Sara', eventTitle: 'The Wedding', rsvpUrl: 'https://fncy.rs/a1b2c3d' };
  const builtIn = renderSmsBody('invitation', 'en', context);

  for (const override of [null, undefined, '', '   ', '\n\t ']) {
    assert.equal(renderSmsBody('invitation', 'en', context, { override }), builtIn,
      `an override of ${JSON.stringify(override)} must fall through to our copy`);
  }
});

test('an override whose every tag resolves empty falls back rather than sending punctuation', () => {
  // A guest with no table, on a body that is nothing but the table. Sending
  // "Your table is ." is worse than sending our version.
  const body = renderSmsBody('seating_reminder', 'en',
    { guestName: 'Sara', eventTitle: 'The Wedding', tableName: null, ticketUrl: 'https://fncy.rs/a1b2c3d' },
    { override: '  {table}  ' });
  assert.match(body, /Sara/, 'expected the built-in body, which still names the guest');
});

test('an unknown tag is left visible rather than blanked', () => {
  // A silently-removed tag is a typo the organizer never finds out about.
  const body = renderSmsBody('invitation', 'en', { guestName: 'Sara' },
    { override: 'Hi {name}, see {nonsense}' });
  assert.match(body, /\{nonsense\}/);
});

test('a value containing $ is not eaten by the replacer', () => {
  /* The reason renderTemplate uses a FUNCTION replacer. With a string
     replacement, `$&` expands to the matched text and corrupts the message —
     for the handful of guests whose data contains a dollar sign, which is to
     say in production and never in a test. */
  const body = renderSmsBody('invitation', 'en', { guestName: 'A$&B' },
    { override: 'Hi {name}!' });
  assert.equal(body, 'Hi A$&B!');
});

/* ── The ceilings the organizer cannot type past ─────────────────────────── */

test('interpolated values are still clipped to the same caps as the built-in copy', () => {
  const longName = 'Abdulrahman Al-Mohammed Al-Otaibi Al-Qahtani';
  const body = renderSmsBody('invitation', 'en', { guestName: longName },
    { override: '{name}' });

  assert.ok(body.length < longName.length, 'a custom body must not bypass clip()');
  assert.ok(body.endsWith('...'), 'the GSM-7-safe three-dot marker must still be used');
  assert.equal(computeSmsSegments(body).encoding, 'GSM-7',
    'the truncation marker must not push the message out of GSM-7 — that doubles the cost');
});

test('a list value is joined and capped, not dumped raw', () => {
  const body = renderSmsBody('rsvp_confirmation', 'en',
    { guestName: 'Sara', companions: ['A Name', 'B Name', 'C Name', 'D Name', 'E Name'] },
    { override: 'With: {companions}' });

  assert.match(body, /\+2 more/, 'a party of five must be capped with a tail, not listed in full');
  assert.doesNotMatch(body, /\[object Object\]|A Name,B Name/);
});

test('a capped list keeps its "+N more" tail — it is NOT clipped a second time', () => {
  /* THE BUG THIS PINS.
   *
   * buildTagValues used to run clipList (which caps the list and appends the
   * tail) and then clip the RESULT to the tag's `max`. For companions that max
   * was 62 against a clipList ceiling of ~66, so the second pass ate the tail:
   * a party of twelve rendered "A, B, C..." — three names, and no indication
   * that nine more people were coming.
   *
   * It spared {meals} (86 under a max of 96), so the defect appeared on one tag
   * and not the other, which is exactly how it reads as data rather than as a
   * bug. Both are asserted here. */
  const entries = (n, c) => Array.from({ length: n }, (_, i) => c.repeat(17) + i);

  const companions = renderSmsBody('rsvp_confirmation', 'en',
    { guestName: 'S', companions: entries(12, 'N') }, { override: '{companions}' });
  assert.match(companions, /\+9 more$/, 'the companions tail was truncated away');
  assert.doesNotMatch(companions, /\.\.\.$/, 'a list must never end in the clip marker');

  const meals = renderSmsBody('rsvp_confirmation', 'en',
    { guestName: 'S', meals: entries(12, 'M') }, { override: '{meals}' });
  assert.match(meals, /\+8 more$/, 'the meals tail was truncated away');
});

test('an empty or missing list renders as nothing, not as punctuation', () => {
  for (const context of [{ guestName: 'S', companions: [] }, { guestName: 'S' }]) {
    const body = renderSmsBody('rsvp_confirmation', 'en', context, { override: 'A{companions}B' });
    assert.equal(body, 'AB');
  }
});

test('buildTagValues never returns an array or an object for any tag of any type', () => {
  // Anything non-primitive reaching renderTemplate becomes "[object Object]" in
  // a message somebody pays for.
  const { clip, clipList } = require('../utils/smsTemplates');
  for (const type of SMS_MESSAGE_TYPES) {
    const values = buildTagValues(type.key, sampleContext(type.key), { clip, clipList });
    for (const [tag, value] of Object.entries(values)) {
      assert.equal(typeof value, 'string', `${type.key}.${tag} rendered a ${typeof value}`);
    }
  }
});

test('every list tag declares a max at or above what clipList can actually produce', () => {
  /* The invariant behind the bug above, checked directly rather than through a
     rendered body — so a future third list tag cannot repeat it. */
  const { clipList } = require('../utils/smsTemplates');
  const { SMS_MERGE_TAGS } = require('../config/smsMergeTags');

  for (const tag of SMS_MERGE_TAGS.filter((t) => t.list)) {
    const worst = clipList(
      Array.from({ length: 9999 }, () => 'W'.repeat(tag.list.each + 10)),
      tag.list.each, tag.list.keep,
    );
    assert.ok(worst.length <= tag.max,
      `{${tag.tag}} can render ${worst.length} characters but declares max ${tag.max} — the tail will be clipped off`);
  }
});

/* ── The footer, which is not the organizer's to remove ──────────────────── */

test('the compliance footer is appended by the dispatcher, not by the template', () => {
  /* renderSmsBody deliberately returns the body WITHOUT the footer, and
     sendTransactionalSms concatenates it. That is what makes the footer
     unremovable: there is no code path where a body reaches the carrier
     without passing through that concatenation. */
  const body = renderSmsBody('invitation', 'en', { guestName: 'Sara' },
    { override: 'Hi {name}!' });
  assert.doesNotMatch(body, /Reply STOP/, 'renderSmsBody must not carry the footer itself');

  const fs = require('fs');
  const path = require('path');
  const dispatch = fs.readFileSync(path.join(__dirname, '..', 'services', 'smsDispatch.js'), 'utf8');
  assert.match(dispatch, /const body = `\$\{rendered\}\$\{COMPLIANCE_FOOTER\}`/,
    'the footer must still be concatenated onto every rendered body');
});

test('the footer text itself still carries every element a carrier requires', () => {
  assert.match(COMPLIANCE_FOOTER, /Fancy RSVP/, 'sender identification');
  assert.match(COMPLIANCE_FOOTER, /Msg&data rates may apply/i, 'rates disclosure');
  assert.match(COMPLIANCE_FOOTER, /STOP/, 'opt-out keyword');
  assert.match(COMPLIANCE_FOOTER, /HELP/, 'help keyword');
});

/* ── Save-time validation ────────────────────────────────────────────────── */

test('clearing a template is a valid save, not an error', () => {
  for (const value of ['', '   ', null]) {
    const r = validateTemplate('invitation', value);
    assert.equal(r.ok, true, `clearing with ${JSON.stringify(value)} must be accepted`);
    assert.equal(r.cleared, true);
  }
});

test('a tag that does not exist and one that is wrong for this type read differently', () => {
  const unknown = validateTemplate('invitation', 'Hi {nonsense}');
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error, 'UNKNOWN_TAG');
  assert.match(unknown.message, /not a known tag/);

  // {table} is real, but an invitation is sent before anyone is seated.
  const misplaced = validateTemplate('invitation', 'Your table is {table}');
  assert.equal(misplaced.ok, false);
  assert.equal(misplaced.error, 'UNKNOWN_TAG');
  assert.match(misplaced.message, /not available in this message type/,
    'the organizer needs to know WHY, or they go hunting for a typo that is not there');
});

test('extractTags sees exactly what the renderer sees', () => {
  /* If these two patterns drift, the validator approves a tag the renderer
     leaves as literal text, or rejects one that renders fine.
     `{NOT_A_TAG-x}` is in the sample precisely because a hyphen is NOT in the
     tag character class — neither side treats it as a tag, and the assertion
     below is what keeps that agreement. */
  const { renderTemplate } = require('../utils/smsSegments');
  const sample = '{name} {{event}} {  date  } {NOT_A_TAG-x}';

  assert.deepEqual(extractTags(sample).sort(), ['date', 'event', 'name']);

  // The other half: anything extractTags did NOT report must survive rendering
  // as literal text, and everything it DID report must be substituted.
  const rendered = renderTemplate(sample, { name: 'N', event: 'E', date: 'D', not_a_tag: 'SHOULD NOT APPEAR' });
  assert.equal(rendered, 'N E D {NOT_A_TAG-x}');
});

test('a template that would bill more than the ceiling is refused, with the number in the message', () => {
  /* Sized from the ceiling rather than hard-coded, so raising
     MAX_TEMPLATE_SEGMENTS (a legitimate pricing decision) does not turn this
     into a test that quietly stops testing anything. GSM-7 packs 153 units per
     segment; one full segment past the limit is unambiguous. */
  const huge = 'Details: '.repeat(Math.ceil(((MAX_TEMPLATE_SEGMENTS + 1) * 153) / 9)) + '{name}';
  const r = validateTemplate('rsvp_confirmation', huge);
  assert.equal(r.ok, false, `expected a refusal; it measured ${measureTemplate('rsvp_confirmation', huge).segments} segments`);
  assert.equal(r.error, 'TEMPLATE_TOO_EXPENSIVE');
  assert.match(r.message, new RegExp(String(MAX_TEMPLATE_SEGMENTS)),
    'the organizer has to be told what the limit actually is');
  assert.ok(r.measured.segments > MAX_TEMPLATE_SEGMENTS);
});

test('a pasted wall of text is refused on characters before it is measured', () => {
  const r = validateTemplate('invitation', 'x'.repeat(MAX_TEMPLATE_CHARS + 1));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'TEMPLATE_TOO_LONG');
});

test('the cost is measured at the WORST case, not at a short sample', () => {
  /* The whole reason worstCaseTagValues exists. Measured against "Sara" this
     body is comfortable; measured against a real long name at the clip ceiling
     it is not, and the organizer is billed for the second one. */
  const body = 'Hi {name}, you are coming to {event} on {date} at {venue}. Your table is {table}. Coming with you: {companions}. Food: {meals}. Your pass: {pass_link}';
  const worst = measureTemplate('rsvp_confirmation', body);
  const optimistic = computeSmsSegments(
    body.replace(/\{\w+\}/g, 'x') + COMPLIANCE_FOOTER,
  );
  assert.ok(worst.segments > optimistic.segments,
    'the quoted cost must exceed the cost of a body rendered with trivial values');
});

test('templateCeilingCoversDefaults — the ceiling admits every body we ourselves send', () => {
  /* THE RELATIONSHIP THE CEILING IS DERIVED FROM.
   *
   * MAX_TEMPLATE_SEGMENTS is "as expensive as the costliest thing this platform
   * already sends". Getting the right-hand side of that took three attempts and
   * the last two were measurement errors, not judgement calls:
   *
   *   6  from the registry's realistic-case note (3 EN / 6 AR)
   *   7  rendering the body against sampleContext — still realistic values,
   *      "Abdulrahman Al-Otaibi" being 21 characters against a 24 cap
   *   8  rendering against maxContext, which is the actual ceiling
   *
   * THIS TEST USED sampleContext AND SO REPRODUCED THE SECOND ERROR. It passed
   * on a 7 while the real figure was 8, which is exactly the kind of test that
   * makes a wrong number feel verified. maxContext is the whole point. */
  const { maxContext } = require('../config/smsMergeTags');

  for (const type of SMS_MESSAGE_TYPES) {
    for (const lang of ['en', 'ar']) {
      const body = renderSmsBody(type.key, lang, maxContext(type.key));
      const { segments } = measureTemplate(type.key, body);
      assert.ok(segments <= MAX_TEMPLATE_SEGMENTS,
        `the built-in ${type.key}/${lang} body measures ${segments} segments at worst case, above the ${MAX_TEMPLATE_SEGMENTS}-segment ceiling organizers are held to`);
    }
  }
});

test('maxContext really is worse than sampleContext where it matters', () => {
  /* Guards the guard. If maxContext ever stopped padding — a tag losing its
     `max`, say — the test above would quietly go back to measuring typical
     values and pass on a ceiling that is too low. At least one body must cost
     MORE at the ceiling than at the sample, or the distinction is not being
     made at all. */
  const { maxContext } = require('../config/smsMergeTags');

  const worse = SMS_MESSAGE_TYPES.flatMap((type) => ['en', 'ar'].map((lang) => {
    const s = measureTemplate(type.key, renderSmsBody(type.key, lang, sampleContext(type.key))).segments;
    const m = measureTemplate(type.key, renderSmsBody(type.key, lang, maxContext(type.key))).segments;
    assert.ok(m >= s, `${type.key}/${lang}: the ceiling measured CHEAPER than the sample`);
    return m > s;
  }));

  assert.ok(worse.some(Boolean),
    'no body costs more at the ceiling than at the sample — maxContext is not padding anything');
});

test('every tag a type advertises actually renders for that type', () => {
  // A tag offered in the composer that resolves to nothing produces a message
  // with a hole in it, sent to everyone at once.
  for (const type of SMS_MESSAGE_TYPES) {
    const context = sampleContext(type.key);
    for (const tag of tagsForType(type.key)) {
      const rendered = renderSmsBody(type.key, 'en', context, { override: `[{${tag.tag}}]` });
      assert.ok(rendered && rendered !== '[]',
        `${type.key} advertises {${tag.tag}} but it renders empty`);
      assert.doesNotMatch(rendered, /\{/, `${type.key}: {${tag.tag}} was not substituted`);
    }
  }
});

/* ── The whole-patch sanitizer ───────────────────────────────────────────── */

test('the sanitizer accepts only known types, known languages and strings', () => {
  assert.equal(sanitizeSmsTemplates({ not_a_type: { en: 'x' } }).ok, false);
  assert.equal(sanitizeSmsTemplates({ invitation: { klingon: 'x' } }).ok, true,
    'an unknown language key is ignored rather than rejected');
  assert.deepEqual(sanitizeSmsTemplates({ invitation: { klingon: 'x' } }).templates, {},
    'and nothing is persisted for it');
  assert.equal(sanitizeSmsTemplates({ invitation: { en: 42 } }).ok, false);
  assert.equal(sanitizeSmsTemplates('nope').ok, false);
  assert.equal(sanitizeSmsTemplates(['nope']).ok, false);
});

test('the sanitizer reports WHICH editor failed', () => {
  const r = sanitizeSmsTemplates({ invitation: { ar: 'Hi {table}' } });
  assert.equal(r.ok, false);
  assert.equal(r.type, 'invitation');
  assert.equal(r.lang, 'ar');
});

test('a cleared entry survives as null so the merge can tell it from untouched', () => {
  const r = sanitizeSmsTemplates({ invitation: { en: '' } });
  assert.equal(r.ok, true);
  assert.equal(r.templates.invitation.en, null,
    'a cleared box must be distinguishable from a language the organizer never opened');
});
