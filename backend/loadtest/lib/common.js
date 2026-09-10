// Shared config + helpers for the k6 load scripts.
// All tunables come from env so the same scripts drive every concurrency level.
import { Trend, Rate, Counter } from 'k6/metrics';

export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
export const SLUG = __ENV.SLUG || 'demo'; // the 'demo' event bypasses the payment gate (see submitPublicRSVP)
export const LEVEL = Number(__ENV.LEVEL || 100); // target simultaneous users
export const ENABLE_PAYMENTS = __ENV.ENABLE_PAYMENTS === 'true'; // hits Stripe (test mode) — off by default
export const ORG_EMAIL = __ENV.ORG_EMAIL || '';
export const ORG_PASSWORD = __ENV.ORG_PASSWORD || '';
export const EVENT_ID = __ENV.EVENT_ID || ''; // an owned event id for organizer/dashboard calls

// ── Per-endpoint latency trends (tagged so the summary breaks them out) ──
export const browseTrend = new Trend('t_browse', true);
export const searchTrend = new Trend('t_search', true);
export const rsvpTrend = new Trend('t_rsvp_submit', true);
export const loginTrend = new Trend('t_login', true);
export const dashTrend = new Trend('t_dashboard', true);
export const checkoutTrend = new Trend('t_checkout', true);

export const rsvpDup = new Counter('rsvp_duplicate_409');
export const bizErrors = new Rate('business_errors'); // non-2xx that aren't expected 409s

/**
 * DID THE RSVP ACTUALLY GET WRITTEN?
 *
 * `business_errors` deliberately forgives a 409, because a real duplicate is
 * not a server fault. That forgiveness is also how a run can pass having
 * written nothing: when every guest sent the same phone number, submit_rsvp_v2
 * answered PHONE_ALREADY_REGISTERED → 409 from the second submission onward,
 * the journey returned early, and every threshold went green over a workload
 * that never reached the advisory lock, the cascades or the guest-cap count.
 *
 * This rate is the separate question — of the RSVPs we sent, how many became
 * rows — and it carries its own threshold so that failure can no longer look
 * like success.
 */
export const rsvpWritten = new Rate('rsvp_written');

// Ramp profile for a given concurrency level: warm up, hold steady (the real
// measurement window), then drain. Steady state is where you read avg/p95/p99.
export function stagesFor(level) {
  const target = Number(level) || 100;
  return [
    { duration: '30s', target: Math.ceil(target * 0.5) }, // ramp to 50%
    { duration: '1m', target },                            // ramp to 100%
    { duration: '3m', target },                            // ← STEADY STATE (measure here)
    { duration: '30s', target: 0 },                        // drain
  ];
}

// Global pass/fail gates. A run that breaches these marks the level as the
// breaking point. Tighten per your SLO.
export const thresholds = {
  http_req_failed: ['rate<0.01'],                 // <1% hard errors
  http_req_duration: ['p(95)<800', 'p(99)<1500'], // overall
  t_browse: ['p(95)<500'],
  t_rsvp_submit: ['p(95)<1200'],
  t_login: ['p(95)<2000'],                        // PBKDF2 is intentionally slow
  business_errors: ['rate<0.02'],
  // ≥95% of RSVPs must actually become rows. Below that the run is not a slow
  // result, it is an INVALID one — see rsvpWritten.
  rsvp_written: ['rate>0.95'],
};

export const JSON_HEADERS = { 'Content-Type': 'application/json' };

const FIRST = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Jamie', 'Avery', 'Quinn'];
const LAST = ['Smith', 'Lee', 'Patel', 'Garcia', 'Khan', 'Nguyen', 'Brown', 'Diaz', 'Ali', 'Cohen'];
export const pick = (a) => a[Math.floor(Math.random() * a.length)];
export const randName = () => `${pick(FIRST)} ${pick(LAST)}`;

// Unique per (VU, iteration, time) so RSVP inserts never collide on the partial
// unique email index (which would return a 409 and skew the numbers).
export function uniqueEmail() {
  return `lt_${__VU}_${__ITER}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@loadtest.example`;
}

/**
 * A unique, E.164-valid US number per submission.
 *
 * `guests` has a unique index on (event_id, phone) WHERE is_primary_contact,
 * and submit_rsvp_v2 auto-merges on a matching number — so a shared number does
 * not produce a slower write, it produces NO write. See rsvpWritten.
 *
 * +1 555 + 7 digits keeps utils/phone.normalizeToE164 happy (11 digits total),
 * and the 555 exchange is the reserved fictional range, so a stray SMS send in
 * a misconfigured environment cannot reach a real handset.
 *
 * `__VU * 1000 + __ITER` is DETERMINISTIC rather than random on purpose: random
 * 7-digit numbers birthday-collide a few thousand times across a 250k-submission
 * run, and every collision is a submission that silently measured nothing. This
 * is collision-free for up to 9,999 VUs at 999 iterations each.
 *
 * ── IT REPEATS ACROSS RUNS, AND THAT IS THE ONE THING TO WATCH ──
 *
 * Run twice against the same event and the second run reuses the first run's
 * numbers, so every submission merges into the rows already there and
 * `rsvp_written` collapses. Either clear the load-test rows between runs
 * (see loadtest/README.md) or pass a different `-e PHONE_SALT=<n>`.
 */
const PHONE_SALT = Number(__ENV.PHONE_SALT || 0);
export function uniquePhone() {
  const n = (PHONE_SALT + __VU * 1000 + __ITER) % 10000000;
  return `+1555${String(n).padStart(7, '0')}`;
}
