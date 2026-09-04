require('./helpers/env');
const { test } = require('node:test');
const t = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createMockSupabase } = require('./helpers/mockSupabase');
const { injectModule } = require('./helpers/inject');

const mock = createMockSupabase();
injectModule('../../config/supabase', { supabase: mock.supabase });
injectModule('../../utils/realtime', { broadcast: async () => {} });

const svc = require('../services/checkinSyncService');

const EVENT = '11111111-1111-4111-8111-111111111111';

t.beforeEach(() => mock.reset());

/**
 * Builds a resolver for getBundleManifest's five parallel reads.
 *
 * The `guests` table is queried twice with different shapes (once for the hash
 * over the full set, once per page), so this returns the manifest-shaped rows.
 */
/** Honours a `.range(from, to)` the way PostgREST does; returns all rows without one. */
const slice = (rows, range) => (range ? rows.slice(range[0], range[1] + 1) : rows);

const manifestResolver = ({ guests = [], checkIns = [], staff = [], tables = [], changes = [], event = {} } = {}) => (s) => {
  if (s.table === 'events') {
    return { data: { id: EVENT, title: 'Nadia & Omar', event_date: '2026-08-01T18:00:00Z', location_name: 'Grand Hall', custom_colors: { primary: '#B8944F' }, no_kids_allowed: true, ...event } };
  }
  // Sliced, because the manifest reads these two sets in .range() chunks —
  // PostgREST silently truncates an unranged select, and a short read here
  // would publish a recordCount the paged bundle cannot match.
  if (s.table === 'guests' && s.op === 'select') return { data: slice(guests, s.range) };
  if (s.table === 'check_ins' && s.op === 'select') return { data: slice(checkIns, s.range) };
  if (s.table === 'event_staff') return { data: staff };
  if (s.table === 'tables') return { data: tables };
  if (s.table === 'event_checkin_cursors') return { data: { last_seq: 7 } };
  if (s.table === 'event_guest_changes') return { data: changes };
  return {};
};

const guestRow = (id, name, table = 'Table 4', category = 'standard') => ({
  id, party_id: `p-${id}`, full_name: name, category,
  rsvp_parties: { seating_assignments: [{ tables: { table_name: table, element_type: 'table' } }] },
});

// ══════════════════════════════════════════════════════════════════
// Integrity figures (§21.1)
// ══════════════════════════════════════════════════════════════════

test('the manifest carries a record count and a content hash over the FULL guest set', async () => {
  mock.setResolver(manifestResolver({
    guests: [guestRow('g1', 'Alice'), guestRow('g2', 'Bob'), guestRow('g3', 'Carol')],
    changes: [{ seq: 42 }],
  }));

  const m = await svc.getBundleManifest(EVENT);
  assert.equal(m.integrity.recordCount, 3);
  assert.equal(m.integrity.contentHash.length, 64);
  assert.equal(m.bundleVersion, 42);
});

test('the content hash equals the canonical hash of the same guests', async () => {
  const guests = [guestRow('g2', 'Bob', 'Table 2'), guestRow('g1', 'Alice', 'Table 1')];
  mock.setResolver(manifestResolver({ guests }));

  const m = await svc.getBundleManifest(EVENT);
  const expected = crypto.createHash('sha256').update(svc.canonicalizeGuests([
    { id: 'g1', partyId: 'p-g1', fullName: 'Alice', tableName: 'Table 1', category: 'standard' },
    { id: 'g2', partyId: 'p-g2', fullName: 'Bob', tableName: 'Table 2', category: 'standard' },
  ])).digest('hex');
  assert.equal(m.integrity.contentHash, expected);
});

test('totalPages is derived from the record count, so a device knows when it is done', async () => {
  const guests = Array.from({ length: 1200 }, (_, i) => guestRow(`g${i}`, `Guest ${i}`));
  mock.setResolver(manifestResolver({ guests }));

  const m = await svc.getBundleManifest(EVENT);
  assert.equal(m.integrity.pageSize, svc.BUNDLE_PAGE_SIZE);
  assert.equal(m.integrity.totalPages, Math.ceil(1200 / svc.BUNDLE_PAGE_SIZE));
});

/**
 * ── THE BUG THIS TEST EXISTS FOR ──
 *
 * The manifest read the full guest list and the full set of existing arrivals
 * with no range at all. PostgREST applies its own row ceiling and truncates
 * SILENTLY — a successful response, no flag. On a large event the manifest
 * would then publish a recordCount the paged bundle could never match, and the
 * seeded arrivals the device uses for its duplicate guard would be short. A
 * partial duplicate guard looks exactly like a working one, right up until a
 * tablet admits somebody twice.
 */
test('a guest list larger than one chunk is read in full, not silently truncated', async () => {
  const guests = Array.from({ length: 2300 }, (_, i) => guestRow(`g${i}`, `Guest ${i}`));
  const checkIns = Array.from({ length: 1400 }, (_, i) => ({
    id: `ci-${i}`, guest_id: `g${i}`, party_id: `p-g${i}`,
    checked_in_at: '2026-08-01T19:00:00Z', method: 'qr_scan', server_seq: i + 1,
  }));

  let guestReads = 0;
  mock.setResolver((s) => {
    if (s.table === 'guests' && s.op === 'select') guestReads += 1;
    return manifestResolver({ guests, checkIns })(s);
  });

  const m = await svc.getBundleManifest(EVENT);

  assert.equal(m.integrity.recordCount, 2300, 'every guest must reach the hash');
  assert.equal(m.existingCheckIns.length, 1400, 'every existing arrival must seed the duplicate guard');
  assert.ok(guestReads > 1, 'a set this size cannot be read in one request');
});

test('an event with no guests still reports one page rather than zero', async () => {
  mock.setResolver(manifestResolver({ guests: [] }));
  const m = await svc.getBundleManifest(EVENT);
  assert.equal(m.integrity.recordCount, 0);
  // A device looping `for page in 1..totalPages` must make at least one request
  // or it never learns the list is legitimately empty.
  assert.equal(m.integrity.totalPages, 1);
});

test('a non-table venue element is excluded from the hash, matching the bundle pages', async () => {
  // If the manifest hashed "Dance Floor" as a table name but the pages filtered
  // it out, verification would fail on every download of that event.
  const guests = [{
    id: 'g1', party_id: 'p1', full_name: 'Alice', category: 'standard',
    rsvp_parties: { seating_assignments: [{ tables: { table_name: 'Dance Floor', element_type: 'zone' } }] },
  }];
  mock.setResolver(manifestResolver({ guests }));

  const m = await svc.getBundleManifest(EVENT);
  const expected = crypto.createHash('sha256').update(svc.canonicalizeGuests([
    { id: 'g1', partyId: 'p1', fullName: 'Alice', tableName: '', category: 'standard' },
  ])).digest('hex');
  assert.equal(m.integrity.contentHash, expected);
});

// ══════════════════════════════════════════════════════════════════
// Existing check-ins (§7) — the Layer 1 guard depends on these
// ══════════════════════════════════════════════════════════════════

test('arrivals already recorded are included, so a fresh device knows who is inside', async () => {
  mock.setResolver(manifestResolver({
    guests: [guestRow('g1', 'Alice')],
    checkIns: [{
      id: 'chk-1',
      guest_id: 'g1', party_id: 'p-g1', checked_in_at: '2026-08-01T19:00:00Z',
      method: 'manual_search', server_seq: 3, staff_display_name: 'Amina', device_label: 'Web kiosk',
    }],
  }));

  const m = await svc.getBundleManifest(EVENT);
  assert.equal(m.existingCheckIns.length, 1);
  assert.equal(m.existingCheckIns[0].guestId, 'g1');
  assert.equal(m.existingCheckIns[0].serverSeq, 3);
  assert.equal(m.existingCheckIns[0].staffName, 'Amina');
});

/**
 * A seeded arrival is rebuilt on the device under an invented `seed:` key, so
 * the server id is the ONLY handle a supervisor can reverse it by. Without it
 * the undo 404s and the guest stays counted as present — which at a two-gate
 * event is most of the guest list.
 */
test('a seeded arrival carries its server id, or it can never be reversed from a tablet', async () => {
  mock.setResolver(manifestResolver({
    guests: [guestRow('g1', 'Alice')],
    checkIns: [{
      id: 'chk-1', guest_id: 'g1', party_id: 'p-g1',
      checked_in_at: '2026-08-01T19:00:00Z', method: 'manual_search', server_seq: 3,
    }],
  }));

  const m = await svc.getBundleManifest(EVENT);
  assert.equal(m.existingCheckIns[0].serverId, 'chk-1');
});

test('the existing-check-ins query excludes undone rows', async () => {
  let filters = null;
  mock.setResolver((s) => {
    if (s.table === 'check_ins' && s.op === 'select') { filters = s.filters; return { data: [] }; }
    return manifestResolver({ guests: [guestRow('g1', 'Alice')] })(s);
  });

  await svc.getBundleManifest(EVENT);
  // A reversed admission must not seed the device's duplicate guard, or the
  // guest could never be re-admitted after a supervisor's correction.
  assert.deepEqual(filters.is, [['deleted_at', null]]);
});

test('lastSeq is reported so the device knows where the check-in stream stands', async () => {
  mock.setResolver(manifestResolver({ guests: [guestRow('g1', 'Alice')] }));
  const m = await svc.getBundleManifest(EVENT);
  assert.equal(m.lastSeq, 7);
});

// ══════════════════════════════════════════════════════════════════
// Roster and branding
// ══════════════════════════════════════════════════════════════════

test('the roster ships PIN HASHES, never plaintext', async () => {
  mock.setResolver(manifestResolver({
    guests: [guestRow('g1', 'Alice')],
    staff: [{ id: 's1', display_name: 'Amina', role: 'supervisor', pin_hash: 'abc:def' }],
  }));

  const m = await svc.getBundleManifest(EVENT);
  assert.equal(m.staff[0].pinHash, 'abc:def');
  assert.equal(m.staff[0].displayName, 'Amina');
  assert.equal(m.staff[0].role, 'supervisor');
  assert.equal(JSON.stringify(m).includes('"pin"'), false);
});

test('branding colour is extracted from custom_colors', async () => {
  mock.setResolver(manifestResolver({ guests: [] }));
  const m = await svc.getBundleManifest(EVENT);
  assert.equal(m.event.brandingPrimaryColor, '#B8944F');
  assert.equal(m.event.venue, 'Grand Hall');
  assert.equal(m.event.noKidsAllowed, true);
});

// ══════════════════════════════════════════════════════════════════
// The event photograph (§9.8)
// ══════════════════════════════════════════════════════════════════

test('the cover photograph is carried on the manifest so the device can cache it', async () => {
  mock.setResolver(manifestResolver({
    guests: [],
    event: { cover_image_url: 'https://cdn.fancyrsvp.com/events/nadia-omar.jpg' },
  }));
  const m = await svc.getBundleManifest(EVENT);
  assert.equal(m.event.coverImageUrl, 'https://cdn.fancyrsvp.com/events/nadia-omar.jpg');
});

test('an event with no photograph reports null rather than omitting the field', async () => {
  mock.setResolver(manifestResolver({ guests: [] }));
  const m = await svc.getBundleManifest(EVENT);
  assert.equal(m.event.coverImageUrl, null);
});

/**
 * The device downloads this once, at an office, and renders it offline at a
 * venue. Anything it cannot fetch must be nulled HERE — a `data:` URI or a
 * relative path shipped to the tablet becomes a missing photograph at a wedding
 * with nobody present who can explain it.
 */
test('a non-https cover value is nulled rather than shipped to a device that cannot fetch it', async () => {
  const rejected = [
    'data:image/png;base64,iVBORw0KGgo=',
    '/uploads/cover.jpg',
    'javascript:alert(1)',
    // Cleartext is refused by the app's own network security config, so an
    // http:// address would fail on the device no matter what.
    'http://cdn.fancyrsvp.com/cover.jpg',
    '   ',
    null,
  ];
  for (const bad of rejected) {
    mock.setResolver(manifestResolver({ guests: [], event: { cover_image_url: bad } }));
    const m = await svc.getBundleManifest(EVENT);
    assert.equal(m.event.coverImageUrl, null, `expected null for ${JSON.stringify(bad)}`);
  }
});

// ══════════════════════════════════════════════════════════════════
// The venue layout — the tablet draws the room, not a table list
// ══════════════════════════════════════════════════════════════════

const tableRow = (over = {}) => ({
  id: 't1', table_name: 'Table 12', max_capacity: 10, element_type: 'table',
  shape: 'round', position_x: 26.9, position_y: 75.8,
  width: null, height: null, rotation: 0, color: null, ...over,
});

test('the layout carries geometry, not just names, or the device cannot draw a room', async () => {
  mock.setResolver(manifestResolver({ guests: [], tables: [tableRow()] }));
  const m = await svc.getBundleManifest(EVENT);

  assert.equal(m.tables.length, 1);
  const t = m.tables[0];
  // `name` and `capacity` keep their original keys: a tablet already in the
  // field parses them, and it can ignore a field it does not know but cannot
  // invent one it stops receiving.
  assert.equal(t.name, 'Table 12');
  assert.equal(t.capacity, 10);
  assert.equal(t.elementType, 'table');
  assert.equal(t.shape, 'round');
  assert.equal(t.positionX, 26.9);
  assert.equal(t.positionY, 75.8);
  assert.equal(t.rotation, 0);
});

/**
 * The stage, the dance floor and above all the ENTRANCE are what make a plan
 * read as a venue rather than as scattered circles. The old query filtered them
 * out, because all it was feeding was a list of seatable tables.
 */
test('venue zones are included alongside seatable tables', async () => {
  mock.setResolver(manifestResolver({
    guests: [],
    tables: [
      tableRow(),
      tableRow({
        id: 'z1', table_name: 'Main Entrance', max_capacity: null, element_type: 'zone',
        shape: 'entrance', width: 150, height: 70, rotation: 15, color: '#4A7C59',
      }),
    ],
  }));
  const m = await svc.getBundleManifest(EVENT);

  const zone = m.tables.find((t) => t.id === 'z1');
  assert.ok(zone, 'the entrance must reach the device');
  assert.equal(zone.elementType, 'zone');
  assert.equal(zone.width, 150);
  assert.equal(zone.height, 70);
  assert.equal(zone.rotation, 15);
  assert.equal(zone.color, '#4A7C59');
});

/**
 * PostgREST returns Postgres DECIMAL as a JSON STRING. Passed through, the
 * device's parser rejects "26.9" against a Double and the whole manifest fails —
 * one event that silently cannot be armed, with nothing in the response to say why.
 */
test('decimal geometry is coerced to numbers, and blanks stay null rather than becoming zero', async () => {
  mock.setResolver(manifestResolver({
    guests: [],
    tables: [tableRow({ position_x: '26.9', position_y: '75.8', width: '', height: null, rotation: '0' })],
  }));
  const m = await svc.getBundleManifest(EVENT);
  const t = m.tables[0];

  assert.strictEqual(t.positionX, 26.9);
  assert.strictEqual(t.positionY, 75.8);
  assert.strictEqual(t.rotation, 0);
  // null means "no explicit size — use the shape catalogue's". Folding it to 0
  // would draw every unsized zone as a point.
  assert.strictEqual(t.width, null);
  assert.strictEqual(t.height, null);
});

/**
 * The catalogue is edited on the web side and the device falls back to a round
 * table for anything it cannot name. A shape this backend has never heard of
 * must therefore travel intact rather than being normalised or dropped here.
 */
test('an unrecognised shape is passed through untouched', async () => {
  mock.setResolver(manifestResolver({ guests: [], tables: [tableRow({ shape: 'chocolate_fountain' })] }));
  const m = await svc.getBundleManifest(EVENT);
  assert.equal(m.tables[0].shape, 'chocolate_fountain');
});

/**
 * The integrity contract covers the GUEST set (see canonicalizeGuests). If the
 * layout ever entered the hash, every device armed before a table was nudged
 * would fail verification and refuse to arm — at 14:00 on the day.
 */
test('widening the layout does not disturb the bundle content hash', async () => {
  const guests = [guestRow('g1', 'Alice')];
  mock.setResolver(manifestResolver({ guests, tables: [] }));
  const withoutLayout = (await svc.getBundleManifest(EVENT)).integrity;

  mock.setResolver(manifestResolver({
    guests,
    tables: [tableRow(), tableRow({ id: 'z1', element_type: 'zone', shape: 'stage' })],
  }));
  const withLayout = (await svc.getBundleManifest(EVENT)).integrity;

  assert.equal(withLayout.contentHash, withoutLayout.contentHash);
  assert.equal(withLayout.recordCount, withoutLayout.recordCount);
});

test('an event whose organizer never drew a plan reports an empty layout, not an error', async () => {
  mock.setResolver(manifestResolver({ guests: [guestRow('g1', 'Alice')], tables: [] }));
  const m = await svc.getBundleManifest(EVENT);
  assert.deepEqual(m.tables, []);
});

test('an unknown event throws EVENT_NOT_FOUND rather than returning a hollow manifest', async () => {
  mock.setResolver((s) => {
    if (s.table === 'events') return { data: null, error: { code: 'PGRST116' } };
    return {};
  });
  await assert.rejects(() => svc.getBundleManifest(EVENT), (err) => err.code === 'EVENT_NOT_FOUND');
});
