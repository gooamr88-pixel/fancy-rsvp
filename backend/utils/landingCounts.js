const { supabase } = require('../config/supabase');

/**
 * The two live counters behind the marketing home page's stat band, cached.
 *
 * ── WHY THIS IS NOT JUST TWO QUERIES IN THE ROUTE ──
 *
 * `select('*', { count: 'exact', head: true })` is a literal `SELECT count(*)`
 * with no WHERE clause. PostgreSQL has no O(1) row count, so each one is a full
 * scan — and one of them is over `guests`, the table that gains a row for every
 * person on every guest list ever imported, i.e. the fastest-growing table in
 * the schema. GET /public/landing-stats is the marketing home page, so before
 * this cache every visit, every crawler and every uptime probe paid for two
 * sequential scans whose cost grows with the size of the business.
 *
 * The `Cache-Control: public, max-age=30` header the route sets is not a
 * substitute. It is advice to one browser: it does nothing for a first-time
 * visitor, nothing for a bot, and nothing for a Next.js server render.
 *
 * Five minutes, because these render as rounded vanity figures ("30,000+ guests
 * welcomed") that nobody can see change. The TTL is the only thing making the
 * cost of this endpoint independent of how much traffic it gets.
 *
 * ── ON FAILURE, KEEP THE LAST GOOD NUMBER ──
 *
 * A failed count returns the previous value rather than null, and still moves
 * the expiry forward. Both halves matter: a stale figure reads better than a
 * missing one, and re-arming the TTL is what stops a database that is already
 * struggling from being handed a full scan by every single request that arrives
 * while it recovers — which is precisely when it can least afford one.
 */
const TTL_MS = 5 * 60 * 1000;

let cached = { events: null, guests: null, expires: 0 };

/**
 * @param {{ needsEvents?: boolean, needsGuests?: boolean }} want which counters
 *   the admin-configured stat list actually asks for — an unused counter is
 *   never scanned for.
 * @returns {Promise<{ events: number|null, guests: number|null }>}
 */
async function getLandingCounts({ needsEvents = false, needsGuests = false } = {}) {
  if (cached.expires > Date.now()) return cached;

  const [eventsRes, guestsRes] = await Promise.all([
    needsEvents ? supabase.from('events').select('*', { count: 'exact', head: true }) : null,
    needsGuests ? supabase.from('guests').select('*', { count: 'exact', head: true }) : null,
  ]);

  cached = {
    events: (eventsRes && !eventsRes.error ? eventsRes.count : null) ?? cached.events,
    guests: (guestsRes && !guestsRes.error ? guestsRes.count : null) ?? cached.guests,
    expires: Date.now() + TTL_MS,
  };
  return cached;
}

/**
 * Forces the next call to re-read.
 *
 * Expires the entry rather than erasing it, deliberately: the last good figures
 * stay available as the fallback described above, so an invalidate followed by
 * a failed count still answers with a number instead of a hole.
 */
function invalidate() { cached = { ...cached, expires: 0 }; }

module.exports = { getLandingCounts, invalidate, TTL_MS };
