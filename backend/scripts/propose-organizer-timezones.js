/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PROPOSE A TIMEZONE FOR EVERY PRE-EXISTING ACCOUNT — AND CHANGE NOTHING.
 *
 * New accounts resolve their zone from the IP they sign up on. Accounts that
 * already existed when that shipped have no signup IP to resolve, and guessing
 * wrong is not a cosmetic error: the follow-up migration reinterprets each
 * event's stored digits under its organization's zone, so an account wrongly
 * placed in San Diego when its organizer is in Cairo moves that organizer's
 * events by ten hours. Permanently, and after invitations have gone out.
 *
 * So this script proposes and reports. It performs NO writes — not to
 * organizations, not to events. Its output is a table for a human to read and
 * a JSON file for the apply step to consume once that human agrees. Running it
 * twice changes nothing and costs only lookups.
 *
 * WHAT IT INFERS FROM
 *
 * The best available evidence of where an account was created is the EARLIEST
 * IP we ever recorded for it — the first successful login, else the first
 * session. Earliest rather than latest on purpose: the most recent IP is where
 * the organizer happens to be today, which is exactly the signal the whole
 * design rejects. First-seen is the closest surviving proxy for signup.
 *
 * Accounts with no usable IP at all are reported as `unknown` and proposed at
 * the platform default. They are listed separately and loudly, because they
 * are the rows where a human actually has to decide something.
 *
 * Usage:  node scripts/propose-organizer-timezones.js [--all] [--out <path>]
 *           --all   also re-examine accounts that already have a timezone
 *                   (default: only rows where it is null)
 * ─────────────────────────────────────────────────────────────────────────────
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { supabase } = require('../config/supabase');
const { resolveTimezoneFromIp, normalizeIp } = require('../utils/timezoneFromIp');
const { PLATFORM_TIMEZONE, zoneOffsetMs, safeZone } = require('../utils/timezone');

const args = process.argv.slice(2);
const INCLUDE_ALL = args.includes('--all');
const OUT_PATH = (() => {
  const i = args.indexOf('--out');
  return i >= 0 && args[i + 1]
    ? args[i + 1]
    : path.join(__dirname, 'proposed-organizer-timezones.json');
})();

/**
 * Distinct IPs are resolved once and reused. Organizers commonly share an
 * office IP, and the free tiers of geo providers are quota'd per day — a naive
 * per-account loop would spend that quota re-asking about the same address.
 */
const ipCache = new Map();

/** Free geo tiers are rate-limited per second; this keeps a large run from tripping them. */
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function lookup(ip) {
  if (ipCache.has(ip)) return ipCache.get(ip);
  const result = await resolveTimezoneFromIp(ip);
  ipCache.set(ip, result);
  await pause(1200);
  return result;
}

/**
 * The earliest IP ever recorded for this account, or null.
 *
 * login_history is consulted before sessions and matched on email as well as
 * user_id: a successful login is written on the very first sign-in, whereas a
 * session row can be missing entirely for an account whose only sessions have
 * since been pruned. Both are best-effort tables written fire-and-forget, so
 * neither is guaranteed to hold anything — hence the fallthrough to null.
 */
async function earliestIpFor(org) {
  // Built conditionally: PostgREST's `or` takes a comma-separated filter
  // string, so interpolating a null owner_user_id produces "user_id.eq.null"
  // — a silently malformed filter that matches nothing rather than erroring,
  // which would look exactly like "this account has no history".
  const clauses = [];
  if (org.owner_user_id) clauses.push(`user_id.eq.${org.owner_user_id}`);
  if (org.email && !/[,()]/.test(org.email)) clauses.push(`email.eq.${org.email}`);

  const { data: logins } = clauses.length
    ? await supabase
      .from('login_history')
      .select('ip, created_at')
      .or(clauses.join(','))
      .eq('success', true)
      .order('created_at', { ascending: true })
      .limit(20)
    : { data: [] };

  for (const row of logins || []) {
    const ip = normalizeIp(row.ip);
    if (ip) return { ip, seenAt: row.created_at, from: 'login_history' };
  }

  const { data: sessions } = org.owner_user_id
    ? await supabase
      .from('sessions')
      .select('ip, created_at')
      .eq('user_id', org.owner_user_id)
      .order('created_at', { ascending: true })
      .limit(20)
    : { data: [] };

  for (const row of sessions || []) {
    const ip = normalizeIp(row.ip);
    if (ip) return { ip, seenAt: row.created_at, from: 'sessions' };
  }

  return null;
}

/**
 * How far the follow-up migration would move this org's events, in hours.
 *
 * This is the number that matters to a human reviewing the table — not the
 * zone name, but "your events move by N hours". It is computed against each
 * event's own stored date rather than once per org, because the answer differs
 * across a daylight-saving boundary: the same organizer's January and July
 * events shift by 8 and 7 hours respectively.
 */
function shiftHours(eventDateIso, zone) {
  const ts = new Date(eventDateIso).getTime();
  if (Number.isNaN(ts)) return null;
  return -zoneOffsetMs(ts, zone) / 3600000;
}

/*
 * Runs only when invoked directly.
 *
 * Without this guard the script executes — and calls process.exit() — the
 * moment anything REQUIRES the file. That is not hypothetical: any tool that
 * walks and imports the tree (a coverage run, a dependency graph, a
 * module-load smoke check) terminates on the first one of these it touches,
 * with no error and no indication which file did it. Nothing in the
 * application requires these, so the cost was borne entirely by tooling.
 */
if (require.main === module) {
  (async () => {
    let query = supabase
      .from('organizations')
      .select('id, owner_user_id, name, email, created_at, timezone, timezone_source')
      .order('created_at', { ascending: true });
    if (!INCLUDE_ALL) query = query.is('timezone', null);

    const { data: orgs, error } = await query;
    if (error) {
      console.error('Could not read organizations:', error.message);
      console.error('If this is an "unknown column" error, the timezone migration has not been applied yet.');
      process.exit(1);
    }

    if (!orgs || orgs.length === 0) {
      console.log(INCLUDE_ALL ? 'No organizations found.' : 'Every organization already has a timezone. Nothing to propose.');
      process.exit(0);
    }

    console.log(`\nExamining ${orgs.length} account(s). No data will be modified.\n`);

    const proposals = [];

    for (const org of orgs) {
      const evidence = await earliestIpFor(org);
      const geo = evidence ? await lookup(evidence.ip) : null;

      const proposed = geo ? geo.timeZone : PLATFORM_TIMEZONE;
      const source = geo ? 'ip' : 'default';

      /* Only the events the apply step will actually touch.
         That step is scoped to `timezone IS NULL` — its idempotency guard — so
         counting every event with a date over-reports the blast radius. A human
         being asked to approve a destructive shift needs the real number: told
         "47 events will move" when 12 will, they are reviewing a decision that
         was described to them wrongly. */
      const { data: events } = await supabase
        .from('events')
        .select('id, title, event_date')
        .eq('org_id', org.id)
        .is('timezone', null)
        .not('event_date', 'is', null);

      const shifts = (events || [])
        .map((e) => shiftHours(e.event_date, safeZone(proposed)))
        .filter((h) => h !== null);
      const uniqueShifts = [...new Set(shifts)].sort((a, b) => a - b);

      proposals.push({
        orgId: org.id,
        name: org.name,
        email: org.email,
        createdAt: org.created_at,
        currentTimezone: org.timezone || null,
        proposedTimezone: proposed,
        proposedSource: source,
        country: geo ? geo.country : null,
        evidence: evidence ? { from: evidence.from, seenAt: evidence.seenAt } : null,
        eventCount: (events || []).length,
        eventShiftHours: uniqueShifts,
      });
    }

    // ── The review table ──────────────────────────────────────────────────────
    const pad = (v, n) => String(v == null ? '—' : v).slice(0, n).padEnd(n);
    console.log(
      pad('ACCOUNT', 26), pad('PROPOSED ZONE', 24), pad('FROM', 9),
      pad('EVENTS', 7), 'SHIFT',
    );
    console.log('─'.repeat(96));
    for (const p of proposals) {
      const shift = p.eventShiftHours.length
        ? p.eventShiftHours.map((h) => `${h > 0 ? '+' : ''}${h}h`).join(', ')
        : '—';
      console.log(
        pad(p.name || p.email, 26),
        pad(p.proposedTimezone, 24),
        pad(p.proposedSource === 'ip' ? p.country || 'ip' : 'DEFAULT', 9),
        pad(p.eventCount, 7),
        shift,
      );
    }

    const guessed = proposals.filter((p) => p.proposedSource === 'default');
    const affected = proposals.reduce((n, p) => n + p.eventCount, 0);

    console.log('\n' + '─'.repeat(96));
    console.log(`${proposals.length} account(s) · ${affected} event(s) would be reinterpreted.`);

    if (guessed.length) {
      console.log(
        `\n⚠  ${guessed.length} account(s) had NO usable IP on record and fall back to ${PLATFORM_TIMEZONE}.\n` +
        '   These are guesses, not detections. Check them by hand before applying —\n' +
        '   a wrong zone here moves real events by real hours:\n',
      );
      for (const p of guessed) {
        console.log(`     · ${p.name || p.email}  (${p.eventCount} event(s))`);
      }
    }

    fs.writeFileSync(OUT_PATH, JSON.stringify(proposals, null, 2));
    console.log(`\nProposal written to ${OUT_PATH}`);
    console.log('Nothing has been changed. Review the table above, edit the JSON where it is wrong,');
    console.log('and only then run the apply step.\n');

    process.exit(0);
  })().catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  });
}
