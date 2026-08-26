/* ─────────────────────────────────────────────────────────────────────────────
 * THE SEATING TEXT IS RETIRED — REPRICE THE TYPE THAT CARRIED IT.
 *
 * `seating_reminder` used to fire TWICE per guest: once ~10 minutes after the
 * organizer seated them, and again in the 24 hours before the event. It was
 * weighted 1.2 in `type_weights` for exactly that reason — the heaviest guest
 * type on the list.
 *
 * The seating send has been removed (see emailScheduler.jobSeatingNotices,
 * which is now email-only). Only the day-before text remains, so the type now
 * costs one message per guest — the same as `invitation`, which is weighted
 * 1.0 and is likewise a single send.
 *
 * ── WHY THIS IS A MIGRATION AND NOT JUST A CODE CHANGE ──
 *
 * `backend/config/smsMessageTypes.js` already carries `weight: 1.0`. That value
 * is a FALLBACK. `utils/smsEstimator.js` reads
 * `super_admin_config.sms_pricing_config.type_weights` first and only falls back
 * to the registry when a key is absent:
 *
 *     const configured = weights[type.key];
 *     const weight = Number.isFinite(configured) ? configured : (type.weight || 0);
 *
 * So on any database seeded by 20260823000000 — which wrote an explicit 1.2 —
 * the code change alone changes nothing. Every allowance estimate and every
 * "how many messages will this cost" figure shown to an organizer keeps quoting
 * a message that is no longer sent, and quotes it high.
 *
 * ── WHY IT ONLY TOUCHES ROWS STILL HOLDING 1.2 ──
 *
 * The whole point of `type_weights` is that a super-admin can tune it. If
 * someone has already moved this weight — to 0.9, to 1.4, to anything — that is
 * a deliberate pricing decision made with knowledge this migration does not
 * have, and overwriting it would be this file substituting its own judgement
 * for theirs.
 *
 * 1.2 is specifically the value seeded by 20260822000000 and 20260823000000,
 * i.e. "nobody has touched this". Restricting to it makes the migration
 * idempotent for free: a second run matches nothing.
 *
 * A row with no `type_weights` at all is deliberately left alone too — the
 * estimator falls back to the registry there, which now says 1.0, so it is
 * already correct and writing a partial object would only create a way for it
 * to drift.
 *
 * NOT REVERSIBLE by re-running anything: to go back, set the key to 1.2
 * explicitly.
 * ───────────────────────────────────────────────────────────────────────────── */

UPDATE public.super_admin_config
   SET sms_pricing_config = jsonb_set(
         sms_pricing_config,
         '{type_weights,seating_reminder}',
         '1.0'::jsonb,
         false  -- never CREATE the key: an absent one already resolves to the
                -- registry's 1.0, and inventing it here would freeze a value
                -- that currently tracks the code.
       )
 WHERE sms_pricing_config -> 'type_weights' ? 'seating_reminder'
   AND (sms_pricing_config -> 'type_weights' ->> 'seating_reminder')::numeric = 1.2;

COMMENT ON COLUMN public.super_admin_config.sms_pricing_config IS
    'The whole editable SMS pricing model. guest_bands = messages per invitation, laddered down by guest count. type_weights = relative shares of that budget across GUEST message types — seating_reminder dropped 1.2 → 1.0 on 2026-08-29 when the send-on-seating text was retired and it became a single day-before message. type_frequencies = absolute messages per EVENT for ORGANIZER types. volume_discounts = tiered and never cumulative. Interpreted only by backend/config/smsPricing.js, which normalizes and clamps on both read and write.';
