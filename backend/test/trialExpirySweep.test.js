/**
 * THE SWEEP — what it may touch, and what it must never touch.
 *
 * The sweep does not enforce the trial; `entitledFeatures` already has, on
 * every request, since the second the deadline passed. Its job is to make the
 * STORED row agree with that, and to send the two emails.
 *
 * Which makes the interesting assertions negative ones. This is the only
 * background job in the codebase that rewrites the plan on a live customer
 * event, so the test is mostly about the columns it leaves alone:
 *
 *   is_paid / status   the event STAYS LIVE. Guests were invited by a person,
 *                      not by us, and did not agree to anything — a link that
 *                      dies because a host's trial lapsed is a failure they
 *                      report to the host, who reports it to us, correctly, as
 *                      ours.
 *   nothing deleted    the guest list and the seating chart are untouched and
 *                      come back exactly as they were when somebody pays.
 *   a paying customer  an organizer who upgraded mid-trial still carries the
 *                      old deadline; landing them would take away a plan they
 *                      bought.
 */
require('./helpers/env');

const { test } = require('node:test');
const t = require('node:test');
const assert = require('node:assert/strict');
const { injectModule } = require('./helpers/inject');

const TRIAL = { key: 'trial', name: 'Free trial', is_trial: true, trial_days: 7, price_cents: 0, max_guests: 25, features: ['seating_map', 'sms_campaigns'] };
const FREE = { key: 'free', name: 'Free', price_cents: 0, max_guests: 100, features: [] };
const PREMIUM = { key: 'prem', name: 'Premium', price_cents: 14900, max_guests: 300, features: ['seating_map'] };

/** Every update the sweep issued: { table, payload, id }. */
let writes = [];
/** Rows the fake `events` table hands back for a select. */
let rows = [];
/** Emails dispatched. */
let mails = [];

function makeSupabase() {
  return {
    from(table) {
      const q = { _table: table, _payload: null, _id: null };
      q.select = () => q;
      q.update = (payload) => { q._payload = payload; return q; };
      q.eq = (col, val) => { if (col === 'id') q._id = val; return q; };
      q.is = () => q;
      q.not = () => q;
      q.lte = () => q;
      q.gt = () => q;
      q.gte = () => q;
      q.limit = () => Promise.resolve({ data: rows, error: null });
      q.single = () => Promise.resolve({ data: rows[0] || null, error: null });
      q.then = (res) => {
        if (q._payload) writes.push({ table: q._table, payload: q._payload, id: q._id });
        return Promise.resolve({ data: null, error: null }).then(res);
      };
      return q;
    },
  };
}

injectModule('../../config/supabase', { supabase: makeSupabase() });
injectModule('../../utils/logger', {
  error: () => {}, warn: () => {}, info: () => {}, debug: () => {},
  child: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
});
injectModule('../../services/emailService', {
  dispatch: async (o) => { mails.push(o); return { sent: true }; },
  alreadyLogged: async () => false,
});
injectModule('../../utils/configCache', {
  getPlatformConfig: async () => ({ pricing_tiers: [TRIAL, FREE, PREMIUM] }),
});

const { landDueTrials, warnEndingTrials } = require('../services/trialExpiry');

const PAST = new Date(Date.now() - 1000).toISOString();
const SOON = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();

const expiredTrial = (over = {}) => ({
  id: 'evt-1', title: 'Nadia & Omar', slug: 'nadia-and-omar', timezone: 'Africa/Cairo',
  // A trial's own row: the grant forces the price to zero, which is what both
  // the sweep and the gate now read to decide whether anybody paid.
  tier_key: 'trial', tier_price_cents: 0,
  trial_ends_at: PAST, trial_expired_at: null, trial_warned_at: null,
  organizations: { name: 'Yara', email: 'host@example.com' },
  ...over,
});

t.beforeEach(() => { writes = []; rows = []; mails = []; });

test('an expired trial is moved onto the free plan', async () => {
  rows = [expiredTrial()];
  const landed = await landDueTrials(FREE);

  assert.equal(landed, 1);
  const update = writes.find((w) => w.payload?.tier_key === 'free');
  assert.ok(update, 'the stored plan snapshot is rewritten to the landing plan');
  assert.equal(update.payload.tier_name, 'Free');
  assert.equal(update.payload.tier_max_guests, 100);
  assert.equal(update.payload.tier_price_cents, 0);
  assert.ok(update.payload.trial_expired_at, 'and stamped so it is never done twice');
});

test('THE EVENT STAYS LIVE — is_paid and status are never written', async () => {
  rows = [expiredTrial()];
  await landDueTrials(FREE);

  writes.forEach((w) => {
    assert.equal('is_paid' in w.payload, false, 'taking a live invitation offline is never this job');
    assert.equal('status' in w.payload, false);
  });
});

test('nothing is deleted', async () => {
  rows = [expiredTrial()];
  await landDueTrials(FREE);
  // The fake client would have to expose .delete() for a delete to be possible
  // at all; asserting the shape here documents that the sweep never reaches
  // for one, so a future edit that does will fail loudly rather than quietly.
  assert.ok(writes.every((w) => w.payload && typeof w.payload === 'object'),
    'every operation this job performs is an update');
});

test('an organizer who upgraded mid-trial is left alone', async () => {
  /* They paid. Their event carries the deadline stamped on day 0 because the
     payment path rewrites the plan, not the trial columns — landing them would
     take away the plan they bought.

     What marks them is the PRICE on the row, not the plan key: asking which
     plan they were on broke in both directions as soon as an admin edited the
     price list, so the sweep and the gate now ask the same money question. */
  rows = [expiredTrial({ tier_key: 'prem', tier_price_cents: 14900 })];
  const landed = await landDueTrials(FREE);

  assert.equal(landed, 0, 'a paying customer is not landed');
  const downgrade = writes.find((w) => w.payload?.tier_key === 'free');
  assert.equal(downgrade, undefined);
  const stamp = writes.find((w) => w.payload?.trial_expired_at);
  assert.ok(stamp, 'but they are stamped so the query stops returning them');
  assert.equal('tier_key' in stamp.payload, false, 'and their plan is not touched');
});

test('the ending email is sent once, then stamped', async () => {
  rows = [expiredTrial({ trial_ends_at: SOON, trial_expired_at: null })];
  const sent = await warnEndingTrials();

  assert.equal(sent, 1);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].kind, 'trial_ending');
  assert.equal(mails[0].ref, 'evt-1', 'keyed on the event, so a re-run cannot mail twice');
  assert.match(mails[0].subject, /left on your Fancy trial/);
  assert.ok(writes.some((w) => w.payload?.trial_warned_at));
});

test('the ended email says the invitation still works', async () => {
  rows = [expiredTrial()];
  await landDueTrials(FREE);

  const mail = mails.find((m) => m.kind === 'trial_ended');
  assert.ok(mail);
  assert.match(mail.subject, /still live/i);
  assert.match(mail.html, /still works/i);
  assert.equal(mail.ref, 'evt-1');
});

test('an organizer with no email address is stamped rather than retried forever', async () => {
  rows = [expiredTrial({ trial_ends_at: SOON, organizations: { name: 'Yara', email: null } })];
  const sent = await warnEndingTrials();

  assert.equal(sent, 0);
  assert.equal(mails.length, 0);
  assert.ok(writes.some((w) => w.payload?.trial_warned_at),
    'otherwise this row is selected on every pass, forever');
});
