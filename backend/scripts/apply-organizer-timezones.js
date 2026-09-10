/**
 * ─────────────────────────────────────────────────────────────────────────────
 * APPLY THE REVIEWED TIMEZONE PROPOSAL.
 *
 * The second half of propose-organizer-timezones.js. That script writes a JSON
 * file and changes nothing; a human reads the table, corrects whatever is wrong
 * in the JSON, and then runs this. Nothing here re-derives a zone — the file is
 * the decision, and if it is wrong the fix is to edit the file and run again.
 *
 * TWO PHASES, AND THE SECOND ONE IS DESTRUCTIVE
 *
 *   1. Organizations get their `timezone` / `timezone_source` /
 *      `signup_ip_country`. Harmless and re-runnable: it only ever writes the
 *      value the reviewed file names.
 *
 *   2. Events are REINTERPRETED. Their stored digits were filed as though the
 *      organizer lived in UTC, so each one is re-read as a wall clock in the
 *      organization's zone and rewritten as the instant it actually names. This
 *      moves real event times by real hours. It is what makes the reminders
 *      fire correctly and the guest pages agree with the emails, and it is also
 *      the step that cannot be undone by running something else afterwards.
 *
 * THE IDEMPOTENCY GUARD, WHICH IS THE WHOLE SAFETY STORY
 *
 * Phase 2 touches ONLY events whose `timezone` is still null, and it stamps
 * that column as it goes. An event created since the feature shipped already
 * has a zone and is skipped; an event converted by an earlier run of this
 * script has one too, and is skipped. So running this twice does not
 * double-shift anything — which matters, because a double shift is silent,
 * looks exactly like the original bug, and has no marker distinguishing it.
 *
 * Nothing here writes unless --confirm is passed. The default is a dry run
 * that prints what would change.
 *
 * Usage:
 *   node scripts/apply-organizer-timezones.js                 # dry run
 *   node scripts/apply-organizer-timezones.js --confirm       # write
 *   node scripts/apply-organizer-timezones.js --in <path>     # a different proposal file
 * ─────────────────────────────────────────────────────────────────────────────
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { supabase } = require('../config/supabase');
const { isValidTimeZone, wallClockToInstant, instantToWallClock } = require('../utils/timezone');

const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const IN_PATH = (() => {
  const i = args.indexOf('--in');
  return i >= 0 && args[i + 1]
    ? args[i + 1]
    : path.join(__dirname, 'proposed-organizer-timezones.json');
})();

/**
 * The stored digits, re-read as a wall clock in `zone`.
 *
 * The old value was written as though the typed digits were UTC, so reading
 * those same digits back OUT of UTC recovers exactly what the organizer typed
 * — and converting that through the real zone produces the instant it always
 * should have been. `instantToWallClock(iso, 'UTC')` is how the digits are
 * recovered; it is not a claim that the value was ever really UTC.
 */
function reinterpret(storedIso, zone) {
  if (!storedIso) return null;
  const typedDigits = instantToWallClock(storedIso, 'UTC');
  if (!typedDigits) return null;
  return wallClockToInstant(typedDigits, zone);
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
    if (!fs.existsSync(IN_PATH)) {
      console.error(`No proposal file at ${IN_PATH}.`);
      console.error('Run: node scripts/propose-organizer-timezones.js');
      process.exit(1);
    }

    const proposals = JSON.parse(fs.readFileSync(IN_PATH, 'utf8'));
    if (!Array.isArray(proposals) || proposals.length === 0) {
      console.log('The proposal file is empty. Nothing to apply.');
      process.exit(0);
    }

    // Validated up front, all of them, before a single write. A typo introduced
    // while hand-editing the file would otherwise be discovered halfway through
    // — with some organizations updated and some not, and no record of where it
    // stopped.
    const invalid = proposals.filter((p) => !isValidTimeZone(p.proposedTimezone));
    if (invalid.length) {
      console.error('These proposed zones are not recognised IANA names:\n');
      for (const p of invalid) console.error(`  · ${p.name || p.email}: ${JSON.stringify(p.proposedTimezone)}`);
      console.error('\nFix them in the file and run again. Nothing was written.');
      process.exit(1);
    }

    console.log(CONFIRM ? '\nAPPLYING.\n' : '\nDRY RUN — nothing will be written. Pass --confirm to apply.\n');

    let orgsWritten = 0;
    let orgsSkipped = 0;
    let eventsShifted = 0;
    let eventsSkipped = 0;

    for (const p of proposals) {
      const zone = p.proposedTimezone;

      // ── Phase 1: the organization ──
      //
      // A HUMAN DECISION OUTRANKS A LOOKUP.
      //
      // If an organizer has corrected their own zone from the settings screen,
      // the row is stamped `manual` — and this script must not undo that. The
      // propose step only selects rows where `timezone IS NULL`, so a manual row
      // never reaches a fresh proposal; but `--all` re-examines every account,
      // and a proposal file can also be edited or re-run days later. Re-reading
      // the current source here rather than trusting the file is what makes
      // those paths safe, and it is the rule the migration's own column comment
      // states.
      const { data: current } = await supabase
        .from('organizations')
        .select('timezone_source')
        .eq('id', p.orgId)
        .maybeSingle();

      if (current?.timezone_source === 'manual') {
        console.log(`  · ${(p.name || p.email)} — set by hand, left alone`);
        orgsSkipped += 1;
        continue;
      }

      if (CONFIRM) {
        const { error } = await supabase
          .from('organizations')
          .update({
            timezone: zone,
            timezone_source: p.proposedSource === 'ip' ? 'ip' : 'default',
            signup_ip_country: p.country || null,
          })
          .eq('id', p.orgId);
        if (error) {
          console.error(`  ! ${p.name || p.email}: ${error.message}`);
          continue;
        }
      }
      orgsWritten += 1;

      // ── Phase 2: that organization's un-converted events ──
      const { data: events, error: evErr } = await supabase
        .from('events')
        .select('id, title, event_date, event_end_date, rsvp_deadline, timezone')
        .eq('org_id', p.orgId)
        .is('timezone', null);

      if (evErr) {
        console.error(`  ! reading events for ${p.name || p.email}: ${evErr.message}`);
        continue;
      }

      for (const ev of events || []) {
        const next = {
          event_date: reinterpret(ev.event_date, zone),
          event_end_date: reinterpret(ev.event_end_date, zone),
          rsvp_deadline: reinterpret(ev.rsvp_deadline, zone),
          // Stamped in the SAME write as the shifted dates. If this were a
          // separate statement, a crash between the two would leave an event
          // shifted but unmarked — and the next run would shift it again.
          timezone: zone,
        };

        if (!next.event_date && ev.event_date) {
          console.error(`  ! ${ev.title}: could not reinterpret ${ev.event_date} — skipped`);
          eventsSkipped += 1;
          continue;
        }

        if (!CONFIRM) {
          console.log(
            `  ${(p.name || p.email).padEnd(24).slice(0, 24)} ${String(ev.title).padEnd(28).slice(0, 28)} ` +
            `${ev.event_date} → ${next.event_date}`,
          );
        } else {
          const { error } = await supabase.from('events').update(next).eq('id', ev.id);
          if (error) {
            console.error(`  ! ${ev.title}: ${error.message}`);
            eventsSkipped += 1;
            continue;
          }
        }
        eventsShifted += 1;
      }
    }

    console.log(`\n${orgsWritten} organization(s) · ${eventsShifted} event(s)${eventsSkipped ? ` · ${eventsSkipped} skipped` : ''}`);
    if (!CONFIRM) {
      console.log('\nDry run complete. Re-run with --confirm to write these changes.');
    } else {
      console.log('\nDone. Events already carrying a timezone were left alone, so this is safe to re-run.');
    }
    process.exit(0);
  })().catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  });
}
