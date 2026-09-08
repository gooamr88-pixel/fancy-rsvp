/**
 * WHO IS PAYING FOR THE MAIL.
 *
 * `remainingEmailBudget` picks one of two daily ceilings, and the whole value
 * of the guard is that it picks the right one. Getting it wrong in the
 * generous direction hands a stranger our Brevo account; getting it wrong in
 * the strict direction throttles a paying customer's wedding invitations and
 * tells them, in writing, that their free trial is out of sends.
 *
 * The second one shipped. Paying does NOT clear `trial_ends_at` — every
 * activation path rewrites `tier_*` and leaves the trial columns alone, on
 * purpose: the stamp is how an expired trial is recognised at all. So "has a
 * deadline stamped" is permanent, and reading it alone
 * meant an organizer who converted on day 3 kept the 150-a-day trial ceiling
 * for the life of their event.
 *
 * The question that actually decides the ceiling is whether money arrived, and
 * that is `tier_price_cents`.
 */
require('./helpers/env');

const { test } = require('node:test');
const t = require('node:test');
const assert = require('node:assert/strict');
const { createMockSupabase } = require('./helpers/mockSupabase');
const { injectModule } = require('./helpers/inject');

const mock = createMockSupabase();
injectModule('../../config/supabase', { supabase: mock.supabase });
injectModule('../../utils/logger', {
  error: () => {}, warn: () => {}, info: () => {}, debug: () => {},
  child: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
});

const { remainingEmailBudget, TRIAL_DAILY, PAID_DAILY } = require('../utils/emailBudget');

const EVENT = '55555555-5555-4555-8555-555555555555';
const FUTURE = new Date(Date.now() + 4 * 86400000).toISOString();
const PAST = new Date(Date.now() - 4 * 86400000).toISOString();

t.beforeEach(() => mock.reset());

/** Answers the event row and the email_log count. */
function scenario(eventRow, used = 0) {
  mock.setResolver((s) => {
    if (s.table === 'events') return { data: eventRow };
    if (s.table === 'email_log') return { count: used };
    return {};
  });
}

test('an event that was never on a trial gets the paid ceiling', async () => {
  scenario({ trial_ends_at: null, tier_price_cents: 14900 });
  const b = await remainingEmailBudget(EVENT);
  assert.equal(b.isTrial, false);
  assert.equal(b.cap, PAID_DAILY);
});

test('a running trial gets the trial ceiling', async () => {
  scenario({ trial_ends_at: FUTURE, tier_price_cents: 0 });
  const b = await remainingEmailBudget(EVENT);
  assert.equal(b.isTrial, true);
  assert.equal(b.cap, TRIAL_DAILY);
});

test('a lapsed trial that never paid keeps the trial ceiling', async () => {
  /* Still live, still free, still ours to pay for. The deadline passing is not
     a reason to raise somebody's allowance. */
  scenario({ trial_ends_at: PAST, tier_price_cents: 0 });
  const b = await remainingEmailBudget(EVENT);
  assert.equal(b.isTrial, true);
  assert.equal(b.cap, TRIAL_DAILY);
});

test('AN ORGANIZER WHO CONVERTED IS NOT STILL ON THE TRIAL CEILING', async () => {
  /* The bug. They upgraded on day 3, so the row carries both a trial deadline
     and a real price — and the deadline is never cleared. Before this, they
     were capped at 150 sends a day forever and told "your free trial can send
     150 emails a day" while paying us. */
  scenario({ trial_ends_at: FUTURE, tier_price_cents: 4900 });
  const b = await remainingEmailBudget(EVENT);
  assert.equal(b.isTrial, false);
  assert.equal(b.cap, PAID_DAILY);
});

test('and neither is one who converted after the trial ended', async () => {
  scenario({ trial_ends_at: PAST, tier_price_cents: 4900 });
  const b = await remainingEmailBudget(EVENT);
  assert.equal(b.isTrial, false);
});

test('usage is subtracted, and the remainder never goes negative', async () => {
  scenario({ trial_ends_at: FUTURE, tier_price_cents: 0 }, TRIAL_DAILY + 40);
  const b = await remainingEmailBudget(EVENT);
  assert.equal(b.allowed, 0);
  assert.equal(b.used, TRIAL_DAILY + 40);
});

test('an unreadable event row falls back to the paid ceiling, not to nothing', async () => {
  /* Including the case that matters most: a database without the trial
     migration, where selecting these columns is a 42703. The send path must
     not break for everybody because one guard could not answer. */
  mock.setResolver((s) => {
    if (s.table === 'events') return { error: { code: '42703', message: 'column does not exist' } };
    if (s.table === 'email_log') return { count: 0 };
    return {};
  });
  const b = await remainingEmailBudget(EVENT);
  assert.equal(b.isTrial, false);
  assert.equal(b.cap, PAID_DAILY);
});

test('an unreadable COUNT fails OPEN — the send proceeds', async () => {
  /* A cost ceiling, not an entitlement gate. featureGate fails closed; this
     deliberately does not, because refusing to send a wedding invitation over
     a timed-out COUNT is the wrong trade by a distance. */
  mock.setResolver((s) => {
    if (s.table === 'events') return { data: { trial_ends_at: FUTURE, tier_price_cents: 0 } };
    if (s.table === 'email_log') return { error: { message: 'timeout' } };
    return {};
  });
  const b = await remainingEmailBudget(EVENT);
  assert.equal(b.allowed, TRIAL_DAILY, 'the full allowance, not zero');
});
