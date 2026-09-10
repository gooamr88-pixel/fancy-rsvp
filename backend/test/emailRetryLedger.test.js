require('./helpers/env');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

/**
 * THE (kind, ref) LEDGER HAS THREE ANSWERS, NOT TWO.
 *
 *   delivered        → never send again
 *   failed, recent   → send again; the guest still has not been told
 *   failed, stale    → stop; the message is no longer worth delivering
 *
 * It used to have one: any row at all meant "duplicate". Since `record()`
 * writes a row for a FAILURE too, the first delivery failure permanently
 * silenced that message — and for rsvp_reminder, event_reminder, final_call,
 * thank_you and event_update this ledger is the only guard there is, so the
 * guest was simply never told.
 *
 * The middle case is the fix. The third is the bound on it: without a window,
 * one undeliverable address would be retried on every sweep for ever, spending
 * an event's daily email budget on mail that cannot arrive.
 */

/** Runs emailService against a stubbed supabase whose email_log returns `row`. */
function withLoggedRow(row) {
  const stub = {
    from() {
      const q = {
        select: () => q,
        eq: () => q,
        limit: () => Promise.resolve({ data: row ? [row] : [], error: null }),
        insert: () => Promise.resolve({ error: null }),
        update: () => q,
      };
      return q;
    },
  };

  const resolved = require.resolve('../config/supabase');
  const original = require.cache[resolved];
  require.cache[resolved] = new Module(resolved, null);
  require.cache[resolved].exports = { supabase: stub };
  require.cache[resolved].loaded = true;

  delete require.cache[require.resolve('../services/emailService')];
  const svc = require('../services/emailService');

  return {
    svc,
    restore() {
      if (original) require.cache[resolved] = original;
      else delete require.cache[resolved];
      delete require.cache[require.resolve('../services/emailService')];
    },
  };
}

const agoMs = (ms) => new Date(Date.now() - ms).toISOString();

test('a delivered message is never sent twice', async () => {
  const { svc, restore } = withLoggedRow({ status: 'sent', created_at: agoMs(1000) });
  try {
    assert.equal(await svc.alreadyLogged('rsvp_reminder', 'rsvp:p1'), true);
  } finally { restore(); }
});

test('a delivered message stays blocked no matter how old it is', async () => {
  // The window must apply to FAILURES only. If it leaked onto 'sent', every
  // guest would be re-mailed their reminder a day later.
  const { svc, restore } = withLoggedRow({ status: 'sent', created_at: agoMs(400 * 24 * 3600 * 1000) });
  try {
    assert.equal(await svc.alreadyLogged('rsvp_reminder', 'rsvp:p1'), true);
  } finally { restore(); }
});

test('a recent failure is retried — this is the message that used to be lost', async () => {
  const { svc, restore } = withLoggedRow({ status: 'failed', created_at: agoMs(60 * 1000) });
  try {
    assert.equal(await svc.alreadyLogged('rsvp_reminder', 'rsvp:p1'), false,
      'a failed send must be retryable, or one Brevo hiccup silences the message for ever');
  } finally { restore(); }
});

test('a failure older than the window is given up on', async () => {
  const { svc, restore } = withLoggedRow({
    status: 'failed',
    created_at: agoMs(svcWindow() + 60 * 1000),
  });
  try {
    assert.equal(await svc.alreadyLogged('rsvp_reminder', 'rsvp:p1'), true,
      'an undeliverable address must not be retried on every sweep for ever');
  } finally { restore(); }
});

test('no ledger row at all means send', async () => {
  const { svc, restore } = withLoggedRow(null);
  try {
    assert.equal(await svc.alreadyLogged('rsvp_reminder', 'rsvp:p1'), false);
  } finally { restore(); }
});

test('a message with no ref is never deduplicated', async () => {
  // The unique index is partial (WHERE ref IS NOT NULL), so a ref-less send has
  // no key to be deduplicated by and must not be blocked by another row.
  const { svc, restore } = withLoggedRow({ status: 'sent', created_at: agoMs(1000) });
  try {
    assert.equal(await svc.alreadyLogged('rsvp_reminder', null), false);
    assert.equal(await svc.alreadyLogged('rsvp_reminder', undefined), false);
  } finally { restore(); }
});

/** The window, read from the module rather than restated here. */
function svcWindow() {
  const { svc, restore } = withLoggedRow(null);
  try { return svc.FAILED_RETRY_WINDOW_MS; } finally { restore(); }
}

test('the retry window is long enough to be useful and short enough to end', () => {
  const w = svcWindow();
  assert.ok(w >= 60 * 60 * 1000, 'a window under an hour would give up before the next sweep on a slow interval');
  assert.ok(w <= 7 * 24 * 3600 * 1000, 'a window over a week outlives the moment every one of these messages is about');
});
