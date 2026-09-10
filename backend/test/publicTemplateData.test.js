require('./helpers/env');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { publicTemplateData, isPrivateTemplateKey } = require('../utils/publicTemplateData');

const REPO = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

/* ── The addresses that started this ────────────────────────────────────── */

test("the hosts' own email addresses never reach a guest", () => {
  /* `partner1_email` / `partner2_email` are collected on the event settings
     screen so the platform can copy the couple on each RSVP notification. No
     guest-facing surface renders them. Both public endpoints used to spread
     `template_data` wholesale, so on a public event anybody who could open the
     invitation could read both out of the JSON. */
  const out = publicTemplateData({
    partner1: 'Sara',
    partner2: 'Khalid',
    partner1_email: 'sara@example.com',
    partner2_email: 'khalid@example.com',
    loveStory: 'They met in Cairo.',
  });

  assert.equal(out.partner1_email, undefined);
  assert.equal(out.partner2_email, undefined);
  assert.equal(JSON.stringify(out).includes('@example.com'), false,
    'no address may survive anywhere in the serialized payload');
});

test('the content a guest page renders is left completely alone', () => {
  /* The failure mode in the other direction is a field the organizer filled in
     that silently never appears — which is why this is a targeted strip and not
     a whitelist. */
  const input = {
    partner1: 'Sara',
    loveStory: 'They met in Cairo.',
    ceremony_venue_name: 'St Mark',
    ceremony_lat: 30.06,
    ha_faq: [{ q: 'Parking?', a: 'Yes' }],
    ha_gift_iban: 'EG12345',
    giftRegistry: 'https://example.com/registry',
    custom_category: 'engagement',
  };
  assert.deepEqual(publicTemplateData(input), input);
});

test('a contact field nobody has invented yet is private on the day it appears', () => {
  /* The point of matching by shape rather than by name: this file should not
     have to be edited when a template grows a third host. */
  assert.equal(isPrivateTemplateKey('partner3_email'), true);
  assert.equal(isPrivateTemplateKey('planner_email'), true);
  assert.equal(isPrivateTemplateKey('venue_phone'), true);
  assert.equal(isPrivateTemplateKey('emergency_contact_phone'), true);

  assert.equal(isPrivateTemplateKey('partner1'), false);
  assert.equal(isPrivateTemplateKey('loveStory'), false);
  assert.equal(isPrivateTemplateKey('ha_gift_iban'), false);
});

test('a missing or malformed column degrades to an empty object', () => {
  // Callers spread the result, so it must never be null.
  assert.deepEqual(publicTemplateData(null), {});
  assert.deepEqual(publicTemplateData(undefined), {});
  assert.deepEqual(publicTemplateData('not an object'), {});
  assert.deepEqual(publicTemplateData(['an', 'array']), {});
});

/* ── Both public endpoints go through it ────────────────────────────────── */

test('every public endpoint that returns an event strips template_data', () => {
  /* Two endpoints serve a full event row to an unauthenticated caller, and they
     have drifted apart before — getRsvpInvite's own comment records that
     `no_kids_allowed` was added to one and not the other. So the check is that
     BOTH call the strip, not that one does. */
  const eventCtl = read('backend/controllers/eventController.js');
  const rsvpCtl = read('backend/controllers/rsvpController.js');

  for (const [name, src] of [['eventController', eventCtl], ['rsvpController', rsvpCtl]]) {
    assert.ok(src.includes("require('../utils/publicTemplateData')"),
      `${name} must import the strip`);
    assert.ok(src.includes('publicTemplateData(event.template_data)'),
      `${name} must apply the strip to the event it serves publicly`);
  }
});

test('no public handler spreads a raw event without re-setting template_data', () => {
  /* The exact shape of the bug: `const { access_password, ...publicEvent } = event`
     keeps every remaining column, `template_data` included. That destructure is
     the right way to drop the password hash — it just cannot be the last word on
     what leaves the server. */
  for (const rel of ['backend/controllers/eventController.js', 'backend/controllers/rsvpController.js']) {
    const src = read(rel);
    const spreads = [...src.matchAll(/const \{ access_password[^}]*\} = event;/g)];
    assert.ok(spreads.length > 0, `${rel}: expected at least one public event destructure`);

    for (const m of spreads) {
      // The strip must appear within a short window after the destructure —
      // same statement group, not somewhere else entirely in the file.
      const after = src.slice(m.index, m.index + 700);
      assert.ok(after.includes('publicTemplateData('),
        `${rel}: an event is spread to a public response without stripping template_data`);
    }
  }
});
