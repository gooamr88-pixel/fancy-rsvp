const logger = require('./logger');

/**
 * Said once, at boot, because this default is OFF and a silent default that
 * changes behaviour is how you lose a feature without noticing.
 *
 * If Realtime is switched back on in the Supabase dashboard and nobody sets
 * this, broadcasts stop happening and nothing complains — the call sites are
 * fire-and-forget by design. One line in the startup log is what makes that
 * discoverable instead of mysterious. Mirrors how server.js announces the live
 * SMS carrier for the same reason.
 */
if (process.env.REALTIME_BROADCAST_ENABLED === 'true') {
  logger.info('📡 Realtime broadcasts ENABLED (REALTIME_BROADCAST_ENABLED=true)');
} else {
  logger.info('📡 Realtime broadcasts OFF — the project\'s Realtime service is disabled and nothing subscribes. Set REALTIME_BROADCAST_ENABLED=true to re-enable.');
}

/**
 * Fire-and-forget realtime broadcast over Supabase's REST broadcast endpoint.
 *
 * Why not supabase.channel(...).send(...)?
 * The JS client's channel().send() stands up a *websocket* realtime connection,
 * sends one message, then tears it down — on EVERY request. Under load that
 * socket churn dominates the latency of writes (RSVP submit, check-in, seating).
 *
 * The REST endpoint (`POST /realtime/v1/api/broadcast`) delivers the same message
 * to subscribers of the topic with a single stateless HTTP call and no socket
 * lifecycle. We never await it on the request's critical path and never throw —
 * a dropped broadcast must never fail the underlying write.
 *
 * @param {string} eventId  the event whose topic (`event-<id>`) to publish on
 * @param {string} event    the broadcast event name (e.g. 'rsvp_submitted')
 * @param {object} payload  the message body
 * @returns {Promise<void>} resolves regardless of delivery success
 */
async function broadcast(eventId, event, payload) {
  /**
   * ── OFF BY REQUEST, BECAUSE NOTHING IS LISTENING ──
   *
   * Realtime was disabled on this project on 2026-09-10, on four independent
   * pieces of evidence: the `supabase_realtime` publication is empty, there are
   * no replication slots, "Realtime Concurrent Peak Connections" reads 0 across
   * a full billing month, and a grep of the front end finds no `.channel()` or
   * `postgres_changes` anywhere (the dashboard's RSVP hook was replaced with
   * polling when the PII lockdown removed anon table access).
   *
   * The service being off does not break anything here — every call site below
   * is fire-and-forget and this function never throws. What it WOULD do is make
   * each broadcast a doomed HTTP round trip that logs
   *
   *     realtime broadcast non-OK
   *
   * on the check-in and RSVP paths. That is the same failure mode as the
   * `devices` unique-violation fixed the same day: an error you expect on the
   * happy path is an error you stop reading, and it buries the ones that matter.
   * Reading the 2026-09-03 outage logs meant scrolling past exactly that kind of
   * noise.
   *
   * So: skip the request entirely rather than make it and swallow the result.
   * Set REALTIME_BROADCAST_ENABLED=true to turn it back on the day something
   * actually subscribes — the call sites never changed and need no edit.
   */
  if (process.env.REALTIME_BROADCAST_ENABLED !== 'true') return;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return; // not configured (e.g. tests) — silently skip

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000); // never hang a request
    const res = await fetch(`${url.replace(/\/$/, '')}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [{ topic: `event-${eventId}`, event, payload }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      logger.warn({ status: res.status, eventId, event }, 'realtime broadcast non-OK');
    }
  } catch (err) {
    // AbortError / network blip — broadcasts are best-effort.
    logger.warn({ err: err.message, eventId, event }, 'realtime broadcast failed');
  }
}

module.exports = { broadcast };
