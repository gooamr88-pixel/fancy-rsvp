/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY DID THE DAY-BEFORE REMINDER ARRIVE AT THE WRONG TIME?
 *
 * Read-only. Writes nothing, changes nothing, takes no --confirm. Run it and
 * read the output; every fix is a separate, deliberate step afterwards.
 *
 * The day-before reminder fires when `event_date - 24h` passes, and BOTH halves
 * of that subtraction can be wrong independently:
 *
 *   • `event_date` is an INSTANT derived from the wall clock the organizer
 *     typed plus `events.timezone` — a snapshot frozen when the event was
 *     created. An event created while the organization had no timezone froze
 *     the platform default (San Diego) instead, and its stored instant is off
 *     by the whole offset between that and the organizer's real zone.
 *     Correcting the ACCOUNT timezone afterwards does not touch it: the
 *     snapshot is deliberate, `timezone` is not an updatable event field, and
 *     no screen displays it. So the error is both permanent and invisible —
 *     which is exactly why this script exists.
 *
 *   • the SWEEP that notices the moment has passed runs on an interval, so
 *     even a perfectly stored instant is served late by up to one tick.
 *
 * The two produce very different symptoms, and the fixes are unrelated: a zone
 * mismatch costs HOURS, the sweep interval costs MINUTES. The MISMATCH / OK
 * verdict per event tells you which one you are looking at, so read that column
 * before changing anything.
 *
 * Usage:
 *   node scripts/diagnose-reminder-timing.js                  # upcoming events
 *   node scripts/diagnose-reminder-timing.js --event <id>     # one event
 *   node scripts/diagnose-reminder-timing.js --all            # past ones too
 * ─────────────────────────────────────────────────────────────────────────────
 */
require('dotenv').config();
const { supabase } = require('../config/supabase');
const {
  PLATFORM_TIMEZONE, safeZone, formatInZone, instantToWallClock, zoneOffsetMs,
} = require('../utils/timezone');

const args = process.argv.slice(2);
const ALL = args.includes('--all');
const ONE = (() => {
  const i = args.indexOf('--event');
  return i >= 0 ? args[i + 1] : null;
})();

const DAY_MS = 24 * 3600 * 1000;
const hoursBetween = (ms) => (ms / 3600000).toFixed(2).replace(/\.00$/, '');

/** An instant plus the zone it is being read in — the only honest way to print one. */
const show = (iso, zone) => (iso
  ? `${formatInZone(iso, zone, {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  })} (${zone})`
  : '—');

(async () => {
  /* ── The scheduler's own configuration ──────────────────────────────────
     Printed first because when automation is off, every per-event line below
     is describing a message that was never going to be sent at all, and the
     timezone analysis is a distraction from that. */
  const enabled = process.env.EMAIL_AUTOMATION_ENABLED === 'true';
  const intervalMin = Math.max(5, parseInt(process.env.EMAIL_SCHEDULER_INTERVAL_MIN, 10) || 15);

  console.log('══ SCHEDULER ══');
  console.log(`  EMAIL_AUTOMATION_ENABLED : ${process.env.EMAIL_AUTOMATION_ENABLED || '(unset)'}`
    + `  →  ${enabled ? 'ON' : 'OFF — no automatic guest message is ever sent'}`);
  console.log(`  sweep interval           : every ${intervalMin} min  →  a reminder can be up to ${intervalMin} min late`);
  console.log(`  PLATFORM_TIMEZONE        : ${PLATFORM_TIMEZONE}  (the fallback for any event with no zone)`);
  console.log(`  server clock now         : ${new Date().toISOString()}`);
  console.log('');

  /* ── Organizations: is the account zone even set, and how was it decided? ── */
  const { data: orgs, error: orgErr } = await supabase
    .from('organizations')
    .select('id, name, email, timezone, timezone_source');

  if (orgErr) {
    // Almost always the unapplied migration rather than a real query problem:
    // PostgREST fails the WHOLE select on one unknown column, so a missing
    // `timezone` reads as a total failure here. Say so, because the fix is a
    // deploy step and not anything in this file.
    console.error('Could not read organizations:', orgErr.message);
    console.error('If this names the `timezone` column, migration 20260828000000_organizer_timezone.sql');
    console.error('is NOT applied on this database — that alone explains hours of drift.');
    process.exit(1);
  }

  const orgById = new Map((orgs || []).map((o) => [o.id, o]));

  /* Only the ones with a PROBLEM get a line each.
     Printing every organization buries the events section — which is the
     point of the tool — under hundreds of rows that all say "fine" on any
     database bigger than a dev copy. A count carries the same information. */
  const missingZone = (orgs || []).filter((o) => !o.timezone);
  console.log('══ ORGANIZATIONS ══');
  console.log(`  ${(orgs || []).length} total · ${missingZone.length} with no timezone of their own`);
  for (const o of missingZone.slice(0, 25)) {
    console.log(`    ⚠ ${o.name || o.email || o.id} — falls back to ${PLATFORM_TIMEZONE}`
      + `  (source: ${o.timezone_source || 'unset'})`);
  }
  if (missingZone.length > 25) console.log(`    …and ${missingZone.length - 25} more`);
  if (missingZone.length === 0) console.log('    every organization has an explicit timezone');
  console.log('');

  /* ── Events ─────────────────────────────────────────────────────────────── */
  let q = supabase
    .from('events')
    .select('id, org_id, title, status, is_paid, event_date, timezone, sms_addon_purchased_at')
    .order('event_date', { ascending: true });

  if (ONE) q = q.eq('id', ONE);
  else if (!ALL) q = q.gte('event_date', new Date().toISOString());

  const { data: events, error: evErr } = await q.limit(200);
  if (evErr) { console.error('Could not read events:', evErr.message); process.exit(1); }

  if (!events || events.length === 0) {
    console.log('No matching events. Try --all, or --event <id>.');
    process.exit(0);
  }

  console.log('══ EVENTS ══');
  let mismatches = 0;
  let unset = 0;

  for (const ev of events) {
    const org = orgById.get(ev.org_id);
    const orgZone = safeZone(org?.timezone);
    const evZone = safeZone(ev.timezone);

    /* The heart of it. Both zones are applied to the SAME stored instant, so
       any difference in the printed wall clock is the error the organizer is
       living with — the hour the guest page and the reminder believe in versus
       the hour the organizer meant. */
    const asStored = show(ev.event_date, evZone);
    const asOrgReads = show(ev.event_date, orgZone);

    // Offset gap at the event's own instant, not "now" — DST makes those differ.
    const at = ev.event_date ? new Date(ev.event_date).getTime() : Date.now();
    const gapMs = zoneOffsetMs(at, orgZone) - zoneOffsetMs(at, evZone);

    /**
     * THREE STATES, NOT TWO — and the third is the one that matters.
     *
     * The first version of this script asked only "do the event's zone and the
     * organization's zone agree?" On a row where BOTH are null, safeZone()
     * resolves both to the platform default, they compare equal, and it printed
     * a reassuring "zones agree" over an event that has no timezone at all.
     *
     * That is the opposite of the truth. Two guesses matching is not agreement;
     * it is the same guess made twice. An organizer in Cairo whose event is
     * silently filed as San Diego gets a tick from a tool built to catch
     * exactly that.
     *
     * So an absent zone is now its own verdict, and it is louder than a
     * mismatch: a mismatch is a known error of known size, while this is the
     * platform not knowing what clock the event keeps.
     */
    const zoneUnset = !ev.timezone;
    const zoneMismatch = !zoneUnset && evZone !== orgZone && gapMs !== 0;
    if (zoneMismatch) mismatches++;
    if (zoneUnset) unset++;

    const dueAt = ev.event_date ? new Date(new Date(ev.event_date).getTime() - DAY_MS) : null;

    console.log(`\n  ── ${ev.title || '(untitled)'}`);
    console.log(`     id            : ${ev.id}`);
    console.log(`     status        : ${ev.status}   is_paid: ${ev.is_paid}`
      + `   sms add-on: ${ev.sms_addon_purchased_at ? 'yes' : 'NO — no SMS will be sent'}`);
    console.log(`     stored instant: ${ev.event_date}`);
    console.log(`     events.timezone (frozen at creation): ${ev.timezone || 'NULL'}`);
    console.log(`     organizer's account timezone        : ${org?.timezone || 'NULL'}`);
    console.log(`     the event reads as : ${asStored}`);
    console.log(`     organizer reads it : ${asOrgReads}`);

    if (zoneUnset) {
      const typed = instantToWallClock(ev.event_date, evZone);
      console.log(`     ⚠ NO TIMEZONE — this event is running on the platform default`);
      console.log(`        The platform believes this event starts at "${typed}" ${evZone}.`);
      console.log(`        That is a GUESS, not something the organizer chose. If the venue`);
      console.log(`        clock says something else, the reminder, the seating reveal and`);
      console.log(`        every printed time are all wrong by the difference.`);
      console.log(`        Same moment on other clocks, to check against the real start time:`);
      for (const z of ['Africa/Cairo', 'Asia/Riyadh', 'Asia/Dubai', 'America/New_York']) {
        console.log(`          ${z.padEnd(18)} ${show(ev.event_date, z)}`);
      }
      console.log(`        Fix: open the event's settings and set Event Timezone. That keeps`);
      console.log(`        the hour on screen and moves the real moment to match it.`);
    } else if (zoneMismatch) {
      /* Recovering the typed digits: the instant was BUILT from a wall clock in
         the frozen zone, so rendering it back in that zone returns exactly what
         was typed. Comparing that to the organizer's zone is what turns "the
         time looks odd" into a number of hours. */
      const typed = instantToWallClock(ev.event_date, evZone);
      console.log(`     ⚠ MISMATCH — off by ${hoursBetween(gapMs)}h`);
      console.log(`        The organizer typed "${typed}" and it was filed as ${evZone},`);
      console.log(`        but they meant ${orgZone}. The reminder, the seating reveal and`);
      console.log(`        every printed time on this event are all ${hoursBetween(gapMs)}h out.`);
    } else {
      console.log('     ✓ zones agree — any lateness here is the sweep interval, not the timezone');
    }

    console.log(`     reminder due  : ${show(dueAt?.toISOString(), orgZone)}`);
    if (dueAt) {
      const delta = dueAt.getTime() - Date.now();
      console.log(`                     ${delta > 0 ? `in ${hoursBetween(delta)}h` : `${hoursBetween(-delta)}h ago`}`
        + `   → sweep serves it up to ${intervalMin} min after that`);
    }
  }

  console.log(`\n══ VERDICT ══`);
  if (unset > 0) {
    console.log(`  ⚠ ${unset} event(s) have NO timezone and are running on ${PLATFORM_TIMEZONE}.`);
    console.log('    Nothing here proves that is right or wrong — the platform simply was not');
    console.log('    told. Check each one against the real start time above. If it is off, the');
    console.log('    error is HOURS and no scheduler change touches it.');
  }
  if (mismatches > 0) {
    console.log(`  ⚠ ${mismatches} event(s) carry a timezone that disagrees with their organizer's.`);
    console.log('    This is the HOURS-scale error. Fixing the sweep interval will not help these.');
  }
  if (unset === 0 && mismatches === 0) {
    console.log('  Every event names its own timezone and it agrees with the organizer.');
    console.log('  Any lateness is the sweep interval — MINUTES, not hours.');
  }
  if (!enabled) console.log('  ⚠ EMAIL_AUTOMATION_ENABLED is not "true": nothing is being sent at all.');
  /* Organizations with no zone are a FUTURE problem, not a past one: every new
     event they create freezes the platform default the moment it is created. */
  if (missingZone.length > 0) {
    console.log(`  ⚠ ${missingZone.length} organization(s) have no timezone — every NEW event they`);
    console.log('    create will be filed as ' + PLATFORM_TIMEZONE + ' too. Run');
    console.log('    scripts/propose-organizer-timezones.js, review it, then apply.');
  }

  process.exit(0);
})();
