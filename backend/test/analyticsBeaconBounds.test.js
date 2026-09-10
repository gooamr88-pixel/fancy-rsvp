require('./helpers/env');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  boundedMetadata, METADATA_MAX_KEYS, METADATA_MAX_VALUE_LENGTH,
} = require('../controllers/analyticsController');

/**
 * THE ONLY UNAUTHENTICATED WRITE THAT STORES CALLER-SUPPLIED SHAPE.
 *
 * `POST /public/events/:slug/analytics` is a fire-and-forget beacon anybody can
 * call, and `metadata` lands in a jsonb column. It had no bound of any kind —
 * not on key count, not on key length, not on value size — while `user_agent`
 * on the very next line was truncated at 500. An unbounded value meant an
 * unbounded ROW, written by anyone, on the endpoint least likely to be watched;
 * storage and egress are the resource class that has already had this project's
 * services restricted once.
 *
 * These tests are about the BOUND holding, not about the shape of any
 * particular beacon.
 */

const big = 'z'.repeat(50000);

test('an ordinary beacon passes through untouched', () => {
  // The reveal funnel is what actually sends metadata; it must be unaffected.
  const input = { via: 'decoded', msToTap: 1840, reason: 'artwork-failed' };
  assert.deepEqual(boundedMetadata(input), input);
});

test('a long value is truncated, not dropped', () => {
  // Truncating keeps the signal; dropping would lose the event entirely for a
  // field that is mostly decorative.
  const out = boundedMetadata({ note: big });
  assert.equal(out.note.length, METADATA_MAX_VALUE_LENGTH);
});

test('key count is capped', () => {
  const input = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, i]));
  assert.equal(Object.keys(boundedMetadata(input)).length, METADATA_MAX_KEYS);
});

test('an absurdly long key is dropped rather than stored', () => {
  const out = boundedMetadata({ ['k'.repeat(5000)]: 1, ok: 2 });
  assert.deepEqual(out, { ok: 2 });
});

test('nested structure is refused, so the bound cannot be evaded by depth', () => {
  /* This is the one that matters. Every other limit here is about width; a
     nested object or array would carry an arbitrary amount of data past all of
     them, and computing a size limit recursively is exactly the complexity this
     avoids. Nothing legitimate sends nesting. */
  assert.deepEqual(boundedMetadata({ a: { deep: { deeper: big } } }), {});
  assert.deepEqual(boundedMetadata({ a: [big, big, big] }), {});
  assert.deepEqual(boundedMetadata({ a: { x: 1 }, keep: 'yes' }), { keep: 'yes' });
});

test('scalars that are not strings are preserved as themselves', () => {
  assert.deepEqual(boundedMetadata({ n: 42, b: true, z: null }), { n: 42, b: true, z: null });
});

test('a non-object body yields an empty object, never a crash', () => {
  for (const bad of ['a string', 42, true, null, undefined, ['an', 'array']]) {
    assert.deepEqual(boundedMetadata(bad), {}, `input ${JSON.stringify(bad)} must yield {}`);
  }
});

test('a __proto__ payload cannot pollute the prototype', () => {
  /* The value arrives as parsed JSON on a public endpoint, so it is worth
     asserting rather than assuming: building the result with plain assignment
     onto a fresh object means `__proto__` is copied as data or skipped, never
     applied. */
  const out = boundedMetadata(JSON.parse('{"__proto__":{"polluted":true},"x":1}'));
  assert.equal({}.polluted, undefined, 'Object.prototype was polluted');
  assert.equal(out.x, 1);
});

test('the worst case a caller can force stays small', () => {
  /* The bound that actually protects the table: max keys, each at max value
     length. Anything materially above this means one of the limits has been
     loosened without the consequence being noticed. */
  const hostile = Object.fromEntries(
    Array.from({ length: 500 }, (_, i) => [`key_number_${i}`, big]),
  );
  const bytes = JSON.stringify(boundedMetadata(hostile)).length;
  const ceiling = METADATA_MAX_KEYS * (METADATA_MAX_VALUE_LENGTH + 80);
  assert.ok(bytes <= ceiling, `worst case ${bytes} bytes exceeds the expected ceiling ${ceiling}`);
});
